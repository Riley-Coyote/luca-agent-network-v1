//! Per-resident local endpoint for Luca conversational actions.
//!
//! The endpoint accepts only a small typed request envelope from the bundled
//! `luca-actions` MCP personality. It never receives or returns signing keys.

use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

const MAX_REQUEST_BYTES: u64 = 128 * 1024;
const MAX_IDEMPOTENCY_ROWS: usize = 512;
const EVENT_NAME: &str = "luca-conversational-action";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BridgeRequest {
    request_id: String,
    token: String,
    resident_pubkey: String,
    source_chat_id: String,
    action: String,
    payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopActionEvent {
    request_id: String,
    resident_pubkey: String,
    source_chat_id: String,
    action: String,
    payload: serde_json::Value,
}

#[derive(Debug, Clone)]
struct DelegationLifecycle {
    delegation_id: String,
    source_chat_id: String,
    focused_chat_id: String,
    delegating_agent: String,
    workers: Vec<String>,
    assignment_event_id: String,
    started_at: i64,
}

struct ActionBridgeOwner {
    shutdown: Arc<AtomicBool>,
    handle: JoinHandle<()>,
    path: PathBuf,
}

fn bridges() -> &'static Mutex<HashMap<String, ActionBridgeOwner>> {
    static BRIDGES: OnceLock<Mutex<HashMap<String, ActionBridgeOwner>>> = OnceLock::new();
    BRIDGES.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) struct ActionBridgeEndpoint {
    pub path: PathBuf,
    pub token: String,
}

#[cfg(unix)]
pub(crate) fn create_endpoint(
    app: &tauri::AppHandle,
    resident_pubkey: &str,
) -> Result<ActionBridgeEndpoint, String> {
    stop_endpoint(resident_pubkey)?;
    if resident_pubkey.len() != 64 || !resident_pubkey.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("conversational action endpoint requires a resident pubkey".into());
    }
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("resolve Luca action cache: {error}"))?
        .join("luca-actions");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("create Luca action cache: {error}"))?;
    let path = directory.join(format!("{}.sock", resident_pubkey.to_ascii_lowercase()));
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|error| format!("remove stale Luca action endpoint: {error}"))?;
    }
    let listener = std::os::unix::net::UnixListener::bind(&path)
        .map_err(|error| format!("bind Luca action endpoint: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("configure Luca action endpoint: {error}"))?;
    let token = uuid::Uuid::new_v4().to_string();
    let shutdown = Arc::new(AtomicBool::new(false));
    let resident = resident_pubkey.to_ascii_lowercase();
    let thread_app = app.clone();
    let thread_token = token.clone();
    let thread_shutdown = Arc::clone(&shutdown);
    let thread_path = path.clone();
    let handle = std::thread::Builder::new()
        .name(format!("luca-actions-{}", &resident[..8]))
        .spawn(move || {
            let mut replies = HashMap::<String, String>::new();
            let mut order = VecDeque::<String>::new();
            while !thread_shutdown.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        if let Err(error) = handle_connection(
                            &thread_app,
                            stream,
                            &resident,
                            &thread_token,
                            &mut replies,
                            &mut order,
                        ) {
                            eprintln!("luca-actions: request failed: {error}");
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    Err(error) => {
                        eprintln!("luca-actions: endpoint closed: {error}");
                        break;
                    }
                }
            }
            let _ = std::fs::remove_file(&thread_path);
        })
        .map_err(|error| format!("start Luca action endpoint: {error}"))?;
    bridges()
        .lock()
        .map_err(|_| "Luca action endpoint registry unavailable".to_string())?
        .insert(
            resident_pubkey.to_ascii_lowercase(),
            ActionBridgeOwner {
                shutdown,
                handle,
                path: path.clone(),
            },
        );
    Ok(ActionBridgeEndpoint { path, token })
}

#[cfg(not(unix))]
pub(crate) fn create_endpoint(
    _app: &tauri::AppHandle,
    _resident_pubkey: &str,
) -> Result<ActionBridgeEndpoint, String> {
    Err("Luca conversational actions are available on the approved Unix target".into())
}

pub(crate) fn stop_endpoint(resident_pubkey: &str) -> Result<(), String> {
    let owner = bridges()
        .lock()
        .map_err(|_| "Luca action endpoint registry unavailable".to_string())?
        .remove(&resident_pubkey.to_ascii_lowercase());
    if let Some(owner) = owner {
        owner.shutdown.store(true, Ordering::Release);
        let _ = owner.handle.join();
        let _ = std::fs::remove_file(owner.path);
    }
    Ok(())
}

#[cfg(unix)]
fn handle_connection(
    app: &tauri::AppHandle,
    mut stream: std::os::unix::net::UnixStream,
    resident_pubkey: &str,
    token: &str,
    replies: &mut HashMap<String, String>,
    order: &mut VecDeque<String>,
) -> Result<(), String> {
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(10)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(std::time::Duration::from_secs(10)))
        .map_err(|error| error.to_string())?;
    let mut line = String::new();
    BufReader::new(stream.try_clone().map_err(|error| error.to_string())?)
        .take(MAX_REQUEST_BYTES)
        .read_line(&mut line)
        .map_err(|error| format!("read request: {error}"))?;
    let request: BridgeRequest =
        serde_json::from_str(&line).map_err(|error| format!("invalid request: {error}"))?;
    if let Some(reply) = replies.get(&request.request_id) {
        stream
            .write_all(reply.as_bytes())
            .map_err(|error| error.to_string())?;
        stream.write_all(b"\n").map_err(|error| error.to_string())?;
        return Ok(());
    }
    let response = match validate_and_dispatch(app, resident_pubkey, token, &request) {
        Ok(value) => serde_json::json!({"ok": true, "result": value}),
        Err(error) => serde_json::json!({"ok": false, "error": error}),
    };
    let encoded = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    stream
        .write_all(encoded.as_bytes())
        .map_err(|error| error.to_string())?;
    stream.write_all(b"\n").map_err(|error| error.to_string())?;
    replies.insert(request.request_id.clone(), encoded);
    order.push_back(request.request_id.clone());
    while order.len() > MAX_IDEMPOTENCY_ROWS {
        if let Some(expired) = order.pop_front() {
            replies.remove(&expired);
        }
    }
    Ok(())
}

fn validate_and_dispatch(
    app: &tauri::AppHandle,
    resident_pubkey: &str,
    token: &str,
    request: &BridgeRequest,
) -> Result<serde_json::Value, String> {
    if request.token != token
        || !request
            .resident_pubkey
            .eq_ignore_ascii_case(resident_pubkey)
    {
        return Err("requesting resident does not own this endpoint".into());
    }
    uuid::Uuid::parse_str(&request.request_id)
        .map_err(|_| "requestId must be a UUID".to_string())?;
    uuid::Uuid::parse_str(&request.source_chat_id)
        .map_err(|_| "sourceChatId must be a canonical Chat UUID".to_string())?;
    const ACTIONS: &[&str] = &[
        "list_agent_creation_options",
        "propose_agent",
        "propose_native_link",
        "propose_team",
        "propose_project",
        "add_participants",
        "delegate_work",
    ];
    if !ACTIONS.contains(&request.action.as_str()) {
        return Err("unsupported conversational action".into());
    }
    validate_source_membership(app, resident_pubkey, &request.source_chat_id)?;
    validate_references(app, request)?;

    if request.action == "list_agent_creation_options" {
        let options = crate::managed_agents::discover_acp_runtimes()
            .into_iter()
            .filter(|runtime| {
                matches!(
                    runtime.availability,
                    crate::managed_agents::AcpAvailabilityStatus::Available
                )
            })
            .map(|runtime| serde_json::json!({"id": runtime.id, "name": runtime.label}))
            .collect::<Vec<_>>();
        return Ok(serde_json::json!({
            "runtimes": options,
            "guidance": "Ask for one runtime choice. Provider and model use Luca defaults and remain editable in confirmation."
        }));
    }

    if request.action == "add_participants" {
        return tauri::async_runtime::block_on(execute_add_participants(app, request));
    }
    if request.action == "delegate_work" {
        return tauri::async_runtime::block_on(execute_delegation(app, request));
    }

    app.emit(
        EVENT_NAME,
        DesktopActionEvent {
            request_id: request.request_id.clone(),
            resident_pubkey: resident_pubkey.to_owned(),
            source_chat_id: request.source_chat_id.clone(),
            action: request.action.clone(),
            payload: request.payload.clone(),
        },
    )
    .map_err(|error| format!("show conversational action in Luca: {error}"))?;
    Ok(serde_json::json!({
        "status": "awaiting_confirmation",
        "requestId": request.request_id,
        "message": "The request was sent to Luca and will leave a result in the source Chat."
    }))
}

async fn execute_add_participants(
    app: &tauri::AppHandle,
    request: &BridgeRequest,
) -> Result<serde_json::Value, String> {
    let target_chat = request
        .payload
        .get("chatId")
        .and_then(|value| value.as_str())
        .unwrap_or(&request.source_chat_id)
        .to_owned();
    uuid::Uuid::parse_str(&target_chat)
        .map_err(|_| "chatId must be a canonical Chat UUID".to_string())?;
    let pubkeys = required_pubkeys(&request.payload, "participantPubkeys")?;
    let state = app.state::<crate::app_state::AppState>();
    let result =
        crate::add_channel_members(target_chat.clone(), pubkeys.clone(), None, state.clone())
            .await?;
    let added = result
        .get("added")
        .and_then(|value| value.as_array())
        .map_or(0, Vec::len);
    let failed = result
        .get("errors")
        .and_then(|value| value.as_array())
        .map_or(0, Vec::len);
    let content = if failed == 0 {
        format!(
            "Added {added} participant{} to this Chat.",
            if added == 1 { "" } else { "s" }
        )
    } else {
        format!(
            "Added {added} participant{}; {failed} could not be added.",
            if added == 1 { "" } else { "s" }
        )
    };
    crate::send_managed_agent_channel_message(
        request.resident_pubkey.clone(),
        request.source_chat_id.clone(),
        content,
        Some(format!("luca-action:{}", request.request_id)),
        Some("agent".into()),
        Some(pubkeys),
        None,
        None,
        app.clone(),
        state,
    )
    .await?;
    Ok(serde_json::json!({
        "status": if failed == 0 { "completed" } else { "completed_with_failures" },
        "chatId": target_chat,
        "added": result.get("added").cloned().unwrap_or_default(),
        "errors": result.get("errors").cloned().unwrap_or_default()
    }))
}

async fn execute_delegation(
    app: &tauri::AppHandle,
    request: &BridgeRequest,
) -> Result<serde_json::Value, String> {
    let assignment = request
        .payload
        .get("assignment")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "assignment is required".to_string())?;
    let mut workers = optional_pubkeys(&request.payload, "workerPubkeys")?;
    let teams = crate::managed_agents::load_teams(app)?;
    let selected_team = request
        .payload
        .get("teamId")
        .and_then(|value| value.as_str())
        .and_then(|id| teams.iter().find(|team| team.id == id));
    if let Some(team) = selected_team {
        workers.extend(team.member_pubkeys.iter().cloned());
    }
    workers.sort();
    workers.dedup();
    workers.retain(|pubkey| !pubkey.eq_ignore_ascii_case(&request.resident_pubkey));
    if workers.is_empty() {
        return Err(
            "delegation requires at least one worker other than the delegating agent".into(),
        );
    }

    let explicit_project = request
        .payload
        .get("projectId")
        .and_then(|value| value.as_str())
        .map(str::to_owned);
    let project_id = match explicit_project {
        Some(project) => Some(project),
        None => source_project_id(app, &request.source_chat_id).await?,
    };
    let mut participants = workers.clone();
    participants.push(request.resident_pubkey.clone());
    let title = request
        .payload
        .get("title")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| selected_team.map(|team| team.name.clone()))
        .unwrap_or_else(|| assignment.chars().take(72).collect());
    let state = app.state::<crate::app_state::AppState>();
    let created = crate::create_chat(
        crate::CreateChatInput {
            participant_pubkeys: participants,
            title: Some(title),
            project_id: project_id.clone(),
        },
        app.clone(),
        state.clone(),
    )
    .await?;
    let focused_chat_id = created.chat.id.clone();
    let delegation_id = uuid::Uuid::new_v4().to_string();
    let team_context = selected_team
        .and_then(|team| team.instructions.as_deref())
        .map(|instructions| format!("\n\nTeam instructions:\n{instructions}"))
        .unwrap_or_default();
    let assignment_message = crate::send_managed_agent_channel_message_impl(
        request.resident_pubkey.clone(),
        focused_chat_id.clone(),
        format!(
            "Assignment: {assignment}{team_context}\n\nReply in this focused Chat with the result. If you cannot continue without input, begin the reply with `BLOCKED:` and explain what you need."
        ),
        Some(format!("luca-delegation:{delegation_id}:assignment")),
        Some("agent".into()),
        Some(workers.clone()),
        None,
        None,
        true,
        app.clone(),
        &state,
    )
    .await?;

    let job_builder = build_job_request(
        &request.source_chat_id,
        &focused_chat_id,
        &delegation_id,
        &request.resident_pubkey,
        &workers,
        assignment,
    )?;
    submit_delegating_agent_event(app, &state, &request.resident_pubkey, job_builder).await?;
    crate::send_managed_agent_channel_message_impl(
        request.resident_pubkey.clone(),
        request.source_chat_id.clone(),
        format!(
            "Delegated this as focused work. Status: requested.\n\nOpen the focused Chat: buzz://message?channel={focused_chat_id}"
        ),
        Some(format!("luca-delegation:{delegation_id}:source")),
        Some("agent".into()),
        None,
        None,
        None,
        false,
        app.clone(),
        &state,
    )
    .await?;
    tauri::async_runtime::spawn(monitor_delegation(
        app.clone(),
        DelegationLifecycle {
            delegation_id: delegation_id.clone(),
            source_chat_id: request.source_chat_id.clone(),
            focused_chat_id: focused_chat_id.clone(),
            delegating_agent: request.resident_pubkey.clone(),
            workers: workers.clone(),
            assignment_event_id: assignment_message.event_id,
            started_at: assignment_message.created_at,
        },
    ));
    Ok(serde_json::json!({
        "status": "requested",
        "delegationId": delegation_id,
        "focusedChatId": focused_chat_id,
        "projectId": project_id,
        "participantFailures": created.participant_failures
    }))
}

fn build_job_request(
    source_chat_id: &str,
    focused_chat_id: &str,
    delegation_id: &str,
    delegating_agent: &str,
    workers: &[String],
    assignment: &str,
) -> Result<nostr::EventBuilder, String> {
    let mut tags = vec![
        nostr::Tag::parse(["h", source_chat_id]).map_err(|error| error.to_string())?,
        nostr::Tag::parse(["d", delegation_id]).map_err(|error| error.to_string())?,
        nostr::Tag::parse(["chat", focused_chat_id]).map_err(|error| error.to_string())?,
        nostr::Tag::parse(["status", "requested"]).map_err(|error| error.to_string())?,
        nostr::Tag::parse(["delegator", delegating_agent]).map_err(|error| error.to_string())?,
    ];
    for worker in workers {
        tags.push(nostr::Tag::parse(["p", worker]).map_err(|error| error.to_string())?);
    }
    Ok(nostr::EventBuilder::new(
        nostr::Kind::Custom(buzz_core_pkg::kind::KIND_JOB_REQUEST as u16),
        assignment,
    )
    .tags(tags))
}

fn build_job_update(
    lifecycle: &DelegationLifecycle,
    kind: u32,
    status: &str,
    content: &str,
) -> Result<nostr::EventBuilder, String> {
    let mut tags = vec![
        nostr::Tag::parse(["h", lifecycle.source_chat_id.as_str()])
            .map_err(|error| error.to_string())?,
        nostr::Tag::parse(["d", lifecycle.delegation_id.as_str()])
            .map_err(|error| error.to_string())?,
        nostr::Tag::parse(["chat", lifecycle.focused_chat_id.as_str()])
            .map_err(|error| error.to_string())?,
        nostr::Tag::parse(["status", status]).map_err(|error| error.to_string())?,
        nostr::Tag::parse(["delegator", lifecycle.delegating_agent.as_str()])
            .map_err(|error| error.to_string())?,
    ];
    for worker in &lifecycle.workers {
        tags.push(nostr::Tag::parse(["p", worker.as_str()]).map_err(|error| error.to_string())?);
    }
    Ok(nostr::EventBuilder::new(nostr::Kind::Custom(kind as u16), content).tags(tags))
}

async fn submit_delegating_agent_event(
    app: &tauri::AppHandle,
    state: &crate::app_state::AppState,
    delegating_agent: &str,
    builder: nostr::EventBuilder,
) -> Result<(), String> {
    let record = {
        let _store_guard = state
            .managed_agents_store_lock
            .lock()
            .map_err(|error| error.to_string())?;
        let mut records = crate::managed_agents::load_managed_agents(app)?;
        crate::managed_agents::find_managed_agent_mut(&mut records, delegating_agent)?.clone()
    };
    let keys = nostr::Keys::parse(record.private_key_nsec.trim())
        .map_err(|error| format!("failed to parse delegating agent identity: {error}"))?;
    if keys.public_key().to_hex() != record.pubkey.to_ascii_lowercase() {
        return Err("delegating agent identity does not match its owned record".into());
    }
    let auth_tag = crate::managed_agent_submission_auth_tag(&record, state, &keys.public_key())?;
    crate::relay::submit_event_with_keys(builder, state, &keys, auth_tag.as_deref())
        .await
        .map(|_| ())
}

async fn publish_delegation_update(
    app: &tauri::AppHandle,
    lifecycle: &DelegationLifecycle,
    kind: u32,
    status: &str,
    content: &str,
) -> Result<(), String> {
    let state = app.state::<crate::app_state::AppState>();
    submit_delegating_agent_event(
        app,
        &state,
        &lifecycle.delegating_agent,
        build_job_update(lifecycle, kind, status, content)?,
    )
    .await?;
    let source_content = match status {
        "working" => format!(
            "Delegated work is now in progress.\n\nOpen the focused Chat: buzz://message?channel={}",
            lifecycle.focused_chat_id
        ),
        "waiting" => format!(
            "Delegated work needs input.\n\n{content}\n\nOpen the focused Chat: buzz://message?channel={}",
            lifecycle.focused_chat_id
        ),
        "completed" => format!(
            "Delegated work completed.\n\n{content}\n\nOpen the focused Chat: buzz://message?channel={}",
            lifecycle.focused_chat_id
        ),
        "cancelled" => format!(
            "Delegated work was cancelled.\n\nOpen the focused Chat: buzz://message?channel={}",
            lifecycle.focused_chat_id
        ),
        _ => format!(
            "Delegated work failed.\n\n{content}\n\nOpen the focused Chat: buzz://message?channel={}",
            lifecycle.focused_chat_id
        ),
    };
    crate::send_managed_agent_channel_message_impl(
        lifecycle.delegating_agent.clone(),
        lifecycle.source_chat_id.clone(),
        source_content,
        Some(format!(
            "luca-delegation:{}:status:{status}",
            lifecycle.delegation_id
        )),
        Some("agent".into()),
        None,
        None,
        None,
        false,
        app.clone(),
        &state,
    )
    .await
    .map(|_| ())
}

fn begins_with_blocker(content: &str) -> bool {
    let normalized = content.trim_start().to_ascii_lowercase();
    normalized.starts_with("blocked:") || normalized.starts_with("waiting:")
}

fn bounded_worker_results(
    workers: &[String],
    messages: &[nostr::Event],
) -> (BTreeMap<String, String>, bool) {
    const PER_WORKER_CHARS: usize = 8_000;
    let wanted = workers
        .iter()
        .map(|worker| worker.to_ascii_lowercase())
        .collect::<std::collections::HashSet<_>>();
    let mut results = BTreeMap::new();
    let mut blocker = false;
    for event in messages {
        let author = event.pubkey.to_hex();
        if !wanted.contains(&author) || event.content.trim().is_empty() {
            continue;
        }
        blocker |= begins_with_blocker(&event.content);
        results.insert(
            author,
            event.content.chars().take(PER_WORKER_CHARS).collect(),
        );
    }
    (results, blocker)
}

fn format_worker_results(results: &BTreeMap<String, String>) -> String {
    if results.len() == 1 {
        return results.values().next().cloned().unwrap_or_default();
    }
    results
        .iter()
        .map(|(worker, content)| format!("{}:\n{}", &worker[..8], content.trim()))
        .collect::<Vec<_>>()
        .join("\n\n")
}

async fn monitor_delegation(app: tauri::AppHandle, lifecycle: DelegationLifecycle) {
    use crate::luca::managed_dispatch_store::ManagedDispatchState;

    const POLL_INTERVAL: Duration = Duration::from_secs(2);
    const MAX_RUNTIME: Duration = Duration::from_secs(31 * 60);
    const TERMINAL_RESULT_GRACE: Duration = Duration::from_secs(12);

    let started = Instant::now();
    let mut working_reported = false;
    let mut terminal_without_result_since: Option<Instant> = None;
    loop {
        tokio::time::sleep(POLL_INTERVAL).await;
        let states = match crate::luca::managed_dispatch_store::global_dispatch_store(&app)
            .and_then(|store| {
                store
                    .lock()
                    .map_err(|error| error.to_string())
                    .map(|store| {
                        store.states_for_trigger(&lifecycle.assignment_event_id, &lifecycle.workers)
                    })
            }) {
            Ok(states) => states,
            Err(_) => {
                let _ = publish_delegation_update(
                    &app,
                    &lifecycle,
                    buzz_core_pkg::kind::KIND_JOB_ERROR,
                    "failed",
                    "Luca could not read the local delegation lifecycle.",
                )
                .await;
                return;
            }
        };

        if states
            .iter()
            .any(|(_, state)| *state == ManagedDispatchState::Cancelled)
        {
            let _ = publish_delegation_update(
                &app,
                &lifecycle,
                buzz_core_pkg::kind::KIND_JOB_CANCEL,
                "cancelled",
                "The focused work was cancelled.",
            )
            .await;
            return;
        }
        if states.iter().any(|(_, state)| {
            matches!(
                state,
                ManagedDispatchState::Rejected | ManagedDispatchState::Interrupted
            )
        }) {
            let _ = publish_delegation_update(
                &app,
                &lifecycle,
                buzz_core_pkg::kind::KIND_JOB_ERROR,
                "failed",
                "A worker could not complete the focused work.",
            )
            .await;
            return;
        }
        if !working_reported
            && states.iter().any(|(_, state)| {
                matches!(
                    state,
                    ManagedDispatchState::Pending | ManagedDispatchState::Active
                )
            })
            && publish_delegation_update(
                &app,
                &lifecycle,
                buzz_core_pkg::kind::KIND_JOB_PROGRESS,
                "working",
                "The focused work is in progress.",
            )
            .await
            .is_ok()
        {
            working_reported = true;
        }

        let state = app.state::<crate::app_state::AppState>();
        let messages = crate::relay::query_relay(
            &state,
            &[serde_json::json!({
                "kinds": [9, 40002],
                "#h": [lifecycle.focused_chat_id],
                "authors": lifecycle.workers,
                "since": lifecycle.started_at.saturating_sub(2),
                "limit": 100
            })],
        )
        .await
        .unwrap_or_default();
        let (results, blocker) = bounded_worker_results(&lifecycle.workers, &messages);
        if blocker {
            let _ = publish_delegation_update(
                &app,
                &lifecycle,
                buzz_core_pkg::kind::KIND_JOB_PROGRESS,
                "waiting",
                &format_worker_results(&results),
            )
            .await;
            return;
        }

        let all_published = states.len() == lifecycle.workers.len()
            && states
                .iter()
                .all(|(_, state)| *state == ManagedDispatchState::Published);
        if all_published && results.len() == lifecycle.workers.len() {
            let _ = publish_delegation_update(
                &app,
                &lifecycle,
                buzz_core_pkg::kind::KIND_JOB_RESULT,
                "completed",
                &format_worker_results(&results),
            )
            .await;
            return;
        }

        if all_published {
            let terminal_since = terminal_without_result_since.get_or_insert_with(Instant::now);
            if terminal_since.elapsed() >= TERMINAL_RESULT_GRACE {
                let message = if results.is_empty() {
                    "The workers finished without publishing a result."
                } else {
                    "Some workers finished without publishing a result. Open the focused Chat to continue."
                };
                let _ = publish_delegation_update(
                    &app,
                    &lifecycle,
                    buzz_core_pkg::kind::KIND_JOB_ERROR,
                    "failed",
                    message,
                )
                .await;
                return;
            }
        } else {
            terminal_without_result_since = None;
        }

        if started.elapsed() >= MAX_RUNTIME {
            let _ = publish_delegation_update(
                &app,
                &lifecycle,
                buzz_core_pkg::kind::KIND_JOB_ERROR,
                "failed",
                "The focused work did not finish before Luca's bounded delegation window ended.",
            )
            .await;
            return;
        }
    }
}

async fn source_project_id(
    app: &tauri::AppHandle,
    source_chat_id: &str,
) -> Result<Option<String>, String> {
    let state = app.state::<crate::app_state::AppState>();
    let events = crate::relay::query_relay(
        &state,
        &[serde_json::json!({"kinds": [39000], "#d": [source_chat_id], "limit": 1})],
    )
    .await?;
    Ok(events.first().and_then(|event| {
        event.tags.iter().find_map(|tag| {
            let parts = tag.as_slice();
            (parts.len() >= 2 && parts[0] == "project").then(|| parts[1].clone())
        })
    }))
}

fn required_pubkeys(payload: &serde_json::Value, field: &str) -> Result<Vec<String>, String> {
    let values = optional_pubkeys(payload, field)?;
    if values.is_empty() {
        Err(format!("{field} requires at least one pubkey"))
    } else {
        Ok(values)
    }
}

fn optional_pubkeys(payload: &serde_json::Value, field: &str) -> Result<Vec<String>, String> {
    payload
        .get(field)
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .map(|value| {
            let pubkey = value
                .as_str()
                .ok_or_else(|| format!("{field} must contain pubkey strings"))?
                .to_ascii_lowercase();
            if pubkey.len() != 64
                || !pubkey
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
            {
                return Err(format!("{field} contains an invalid pubkey"));
            }
            Ok(pubkey)
        })
        .collect()
}

fn validate_source_membership(
    app: &tauri::AppHandle,
    resident_pubkey: &str,
    source_chat_id: &str,
) -> Result<(), String> {
    let state = app.state::<crate::app_state::AppState>();
    let events = tauri::async_runtime::block_on(crate::relay::query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [39002],
            "#d": [source_chat_id],
            "limit": 1
        })],
    ))?;
    let belongs = events.first().is_some_and(|event| {
        event.tags.iter().any(|tag| {
            let parts = tag.as_slice();
            parts.len() >= 2 && parts[0] == "p" && parts[1].eq_ignore_ascii_case(resident_pubkey)
        })
    });
    if belongs {
        Ok(())
    } else {
        Err("requesting agent must belong to the source Chat".into())
    }
}

fn validate_references(app: &tauri::AppHandle, request: &BridgeRequest) -> Result<(), String> {
    let agents = crate::managed_agents::load_managed_agents(app)?;
    let teams = crate::managed_agents::load_teams(app)?;
    if let Some(team_id) = request
        .payload
        .get("teamId")
        .and_then(|value| value.as_str())
    {
        if !teams.iter().any(|team| team.id == team_id) {
            return Err("referenced Team does not exist".into());
        }
    }
    if let Some(project_id) = request
        .payload
        .get("projectId")
        .and_then(|value| value.as_str())
    {
        let owner = app
            .state::<crate::app_state::AppState>()
            .signing_keys()?
            .public_key()
            .to_hex();
        if crate::luca::projects::get_project(app, &owner, project_id)?.is_none() {
            return Err("referenced Project does not exist on this device".into());
        }
    }
    if request.action == "delegate_work" {
        let mut workers = request
            .payload
            .get("workerPubkeys")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
            .filter_map(|value| value.as_str())
            .collect::<Vec<_>>();
        if let Some(team_id) = request
            .payload
            .get("teamId")
            .and_then(|value| value.as_str())
        {
            if let Some(team) = teams.iter().find(|team| team.id == team_id) {
                workers.extend(team.member_pubkeys.iter().map(String::as_str));
            }
        }
        if workers.is_empty() {
            return Err("delegation requires at least one agent or a Team".into());
        }
        if workers.iter().any(|pubkey| {
            !agents
                .iter()
                .any(|agent| agent.pubkey.eq_ignore_ascii_case(pubkey))
        }) {
            return Err("delegation may reference only owned persistent agents".into());
        }
    }
    Ok(())
}
