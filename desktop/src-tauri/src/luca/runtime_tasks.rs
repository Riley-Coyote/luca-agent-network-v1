//! Explicit, owner-approved Codex and Claude root tasks.
//!
//! This is a small native coordinator over the user's existing runtime CLI and
//! profile. It owns confirmation receipts, cancellation and presentation only;
//! the provider remains the worker and retains its own session history.

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{mpsc, Arc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

use chrono::Utc;
use luca_protocol::ResidentAccessLevel;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::watch,
};
use uuid::Uuid;

const EVENT_NAME: &str = "luca://runtime-task";
const PROPOSAL_EVENT_NAME: &str = "luca://runtime-task-proposal";
const PROPOSAL_RESOLVED_EVENT_NAME: &str = "luca://runtime-task-proposal-resolved";
const HOST_PROTOCOL: &str = "polyphonic.runtime-task.v1";
const RECEIPT_DIRECTORY: &str = "runtime-task-receipts";
const RESULT_DIRECTORY: &str = "runtime-task-results";
const MAX_TEXT_BYTES: usize = 1_048_576;
const MAX_RECEIPTS: usize = 512;
const PROPOSAL_CONFIRMATION_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const MAX_RUNTIME_TASK_DURATION: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeTaskStateV1 {
    Queued,
    Active,
    Stopping,
    Succeeded,
    Stopped,
    Failed,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTaskStepV1 {
    label: String,
    state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTaskProjectionV1 {
    task_id: String,
    conversation_id: String,
    resident_pubkey: String,
    runtime_family: String,
    summary: String,
    working_folder: String,
    permission_mode: String,
    state: RuntimeTaskStateV1,
    provider_session_id: Option<String>,
    current_step: Option<String>,
    completed_steps: u64,
    #[serde(default)]
    steps: Vec<RuntimeTaskStepV1>,
    started_at: String,
    updated_at: String,
    completed_at: Option<String>,
    error: Option<String>,
    #[serde(default)]
    can_retry: bool,
    #[serde(default)]
    retry_of_task_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartRuntimeTaskInputV1 {
    conversation_id: String,
    resident_pubkey: String,
    runtime_family: String,
    summary: String,
    prompt: String,
    working_folder: String,
    permission_mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTaskResultV1 {
    task_id: String,
    state: RuntimeTaskStateV1,
    result: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTaskProposalV1 {
    proposal_id: String,
    conversation_id: String,
    resident_pubkey: String,
    runtime_family: String,
    summary: String,
    created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RespondRuntimeTaskProposalInputV1 {
    proposal_id: String,
    approved: bool,
    runtime_family: Option<String>,
    working_folder: Option<String>,
    permission_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimeTaskProposalArgumentsV1 {
    target_runtime: String,
    summary: String,
    task: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimeTaskResultArgumentsV1 {
    task_id: String,
}

enum RuntimeTaskProposalDecision {
    Cancel,
    Run {
        runtime_family: String,
        working_folder: String,
        permission_mode: String,
    },
}

struct PendingRuntimeTaskProposal {
    projection: RuntimeTaskProposalV1,
    response: mpsc::SyncSender<RuntimeTaskProposalDecision>,
}

fn proposals() -> &'static Mutex<HashMap<String, PendingRuntimeTaskProposal>> {
    static PROPOSALS: OnceLock<Mutex<HashMap<String, PendingRuntimeTaskProposal>>> =
        OnceLock::new();
    PROPOSALS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct RunningTask {
    cancel: watch::Sender<bool>,
    child: Arc<tokio::sync::Mutex<Child>>,
}

#[derive(Default)]
struct RuntimeTaskMemory {
    receipts_loaded: bool,
    projections: HashMap<String, RuntimeTaskProjectionV1>,
    results: HashMap<String, String>,
    task_inputs: HashMap<String, StartRuntimeTaskInputV1>,
    running: HashMap<String, RunningTask>,
}

fn memory() -> &'static Mutex<RuntimeTaskMemory> {
    static MEMORY: OnceLock<Mutex<RuntimeTaskMemory>> = OnceLock::new();
    MEMORY.get_or_init(|| Mutex::new(RuntimeTaskMemory::default()))
}

pub async fn pick_runtime_task_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt as _;
    let selected = app
        .dialog()
        .file()
        .set_title("Choose task working folder")
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "selected folder is unavailable".to_owned())?;
    validate_working_folder(&path).map(|path| Some(path.to_string_lossy().into_owned()))
}

/// Resolve the one current repository explicitly attached to the conversation's
/// project. Multiple repositories remain an owner choice in the confirmation
/// card; history sources are never treated as working directories.
pub fn resolve_runtime_task_project_folder(
    app: AppHandle,
    source_ids: Vec<String>,
) -> Result<Option<String>, String> {
    if source_ids.is_empty() {
        return Ok(None);
    }
    if source_ids.len() > luca_protocol::MAX_CONNECTED_BRAIN_ROOTS {
        return Err("project context has too many sources".to_owned());
    }
    let mut selected = source_ids
        .into_iter()
        .map(|source_id| {
            luca_protocol::OpaqueId::parse(source_id)
                .map_err(|_| "project context source is invalid".to_owned())
        })
        .collect::<Result<Vec<_>, _>>()?;
    selected.sort();
    selected.dedup();

    let state = app.state::<crate::app_state::AppState>();
    let owner = luca_protocol::Hex64::parse(state.signing_keys()?.public_key().to_hex())
        .map_err(|_| "active owner identity is invalid".to_owned())?;
    let catalog = state
        .read_connected_brain_catalog(&owner)
        .map_err(|error| error.code().to_owned())?;
    let repositories = catalog
        .sources
        .iter()
        .filter(|summary| {
            selected.contains(&summary.source.source_id)
                && summary.source.source_kind
                    == luca_protocol::ConnectedBrainSourceKindV1::Repository
                && summary.source.status == luca_protocol::ConnectedBrainSourceStatusV1::Current
        })
        .map(|summary| summary.source.source_id.clone())
        .collect::<Vec<_>>();
    let [source_id] = repositories.as_slice() else {
        return Ok(None);
    };
    let candidate = state
        .read_connected_brain_candidate(&owner, source_id)
        .map_err(|error| error.code().to_owned())?;
    if candidate.source_kind != luca_protocol::ConnectedBrainSourceKindV1::Repository {
        return Ok(None);
    }
    validate_working_folder(&candidate.canonical_root)
        .map(|path| Some(path.to_string_lossy().into_owned()))
}

pub async fn start_runtime_task(
    app: AppHandle,
    input: StartRuntimeTaskInputV1,
) -> Result<RuntimeTaskProjectionV1, String> {
    start_runtime_task_internal(app, input, None).await
}

async fn start_runtime_task_internal(
    app: AppHandle,
    input: StartRuntimeTaskInputV1,
    retry_of_task_id: Option<String>,
) -> Result<RuntimeTaskProjectionV1, String> {
    load_receipts(&app)?;
    let retry_input = input.clone();
    validate_identity(&input.resident_pubkey)?;
    validate_opaque(&input.conversation_id, 128, "conversation")?;
    let runtime_family = match input.runtime_family.as_str() {
        "codex" => "codex",
        "claude" | "claude_code" => "claude_code",
        _ => return Err("Beta runtime tasks support Codex and Claude Code only.".to_owned()),
    };
    let summary = bounded_single_line(&input.summary, 240, "task summary")?;
    let prompt = bounded_text(&input.prompt, 64 * 1024, "task prompt")?;
    let working_folder = validate_working_folder(Path::new(&input.working_folder))?;
    let requested_permission_mode = input.permission_mode.as_str();
    if requested_permission_mode != "normal" && requested_permission_mode != "full_access" {
        return Err("task permission mode is invalid".to_owned());
    }
    let resident_pubkey = luca_protocol::Hex64::parse(input.resident_pubkey.to_ascii_lowercase())
        .map_err(|_| "task resident identity is invalid".to_owned())?;
    let owner_pubkey = app
        .state::<crate::app_state::AppState>()
        .signing_keys()?
        .public_key()
        .to_hex();
    let effective_access = super::resident_capability_authority::effective_access(
        &app,
        &owner_pubkey,
        resident_pubkey.as_str(),
    )?;
    let permission_mode = permission_mode_for_access(requested_permission_mode, effective_access)?;
    #[cfg(not(unix))]
    return Err("Explicit runtime tasks require Polyphonic's local managed host.".into());
    let (command, adapter) = command_for(runtime_family)?;
    let session_epoch = next_session_epoch()?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "runtime session purpose storage is unavailable".to_owned())?;
    let purpose_store = super::runtime_session_purpose::prepare_resident_store(
        &app_data_dir,
        resident_pubkey.as_str(),
    )?;
    let binding_ref = format!(
        "sha256:{}",
        luca_protocol::canonical_sha256(&serde_json::json!({
            "domain": "polyphonic.explicit-runtime-task-binding.v1",
            "residentPubkey": resident_pubkey.as_str(),
            "runtimeFamily": runtime_family,
            "adapter": adapter.file_name().and_then(|value| value.to_str()).unwrap_or_default(),
        }))
        .map_err(|_| "runtime task binding could not be recorded".to_owned())?
    );
    #[cfg(unix)]
    let managed_permission_fd = super::managed_permission::create_endpoint(
        app.clone(),
        resident_pubkey.clone(),
        session_epoch,
    )?;
    #[cfg(unix)]
    let managed_mcp_fd =
        super::managed_mcp::create_endpoint(app.clone(), resident_pubkey.clone(), session_epoch)
            .ok();
    let mut process = Command::new(command);
    process
        .arg("runtime-task")
        .current_dir(&working_folder)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    process.env("BUZZ_ACP_AGENT_COMMAND", adapter);
    process.env("BUZZ_ACP_AGENT_ARGS", "");
    process.env("LUCA_MANAGED_RESIDENT_PUBKEY", resident_pubkey.as_str());
    process.env("LUCA_MANAGED_BINDING_REF", binding_ref);
    process.env(
        "LUCA_MANAGED_SESSION_EPOCH",
        session_epoch.get().to_string(),
    );
    process.env("LUCA_MANAGED_PERMISSION_FD", "3");
    process.env(
        super::runtime_session_purpose::SESSION_PURPOSE_STORE_ENV,
        purpose_store,
    );
    process.env(
        super::runtime_session_purpose::SESSION_RUNTIME_FAMILY_ENV,
        runtime_family,
    );
    #[cfg(unix)]
    match managed_mcp_fd.as_ref() {
        Some(_) => {
            process.env("LUCA_MANAGED_MCP_FD", "6");
        }
        None => {
            process.env_remove("LUCA_MANAGED_MCP_FD");
        }
    }
    process.env_remove("LUCA_MANAGED_PRESENTATION_FD");
    process.env_remove("LUCA_MANAGED_CONTINUITY_FD");
    process.env_remove("LUCA_MANAGED_COGNITION_FD");
    process.env_remove("BUZZ_PRIVATE_KEY");
    process.env_remove("NOSTR_PRIVATE_KEY");
    #[cfg(unix)]
    {
        process.process_group(0);
        let permission_fd = managed_permission_fd.raw_fd();
        let mcp_fd = managed_mcp_fd.as_ref().map(|fd| fd.raw_fd());
        unsafe {
            process.pre_exec(move || {
                crate::managed_agents::inherited_fds::install_runtime_task_descriptors(
                    permission_fd,
                    mcp_fd,
                )
            });
        }
    }
    let mut child = process
        .spawn()
        .map_err(|_| format!("{runtime_family} could not start with the existing profile"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "runtime task input is unavailable".to_owned())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "runtime task output is unavailable".to_owned())?;
    let stderr = child.stderr.take();

    let task_id = Uuid::new_v4().to_string();
    let task_input = serde_json::json!({
        "taskId": task_id,
        "conversationId": input.conversation_id.clone(),
        "prompt": prompt,
        "workingFolder": working_folder.to_string_lossy(),
        "permissionMode": permission_mode,
    });
    let encoded_input = serde_json::to_vec(&task_input)
        .map_err(|_| "runtime task input could not be encoded".to_owned())?;
    stdin
        .write_all(&encoded_input)
        .await
        .map_err(|_| "runtime task input could not be delivered".to_owned())?;
    stdin
        .shutdown()
        .await
        .map_err(|_| "runtime task input could not be completed".to_owned())?;
    let now = Utc::now().to_rfc3339();
    let projection = RuntimeTaskProjectionV1 {
        task_id: task_id.clone(),
        conversation_id: input.conversation_id,
        resident_pubkey: resident_pubkey.as_str().to_owned(),
        runtime_family: runtime_family.to_owned(),
        summary,
        working_folder: working_folder.to_string_lossy().into_owned(),
        permission_mode: permission_mode.to_owned(),
        state: RuntimeTaskStateV1::Queued,
        provider_session_id: None,
        current_step: Some(format!("Starting {}", runtime_label(runtime_family))),
        completed_steps: 0,
        steps: vec![RuntimeTaskStepV1 {
            label: format!("Starting {}", runtime_label(runtime_family)),
            state: "active".to_owned(),
        }],
        started_at: now.clone(),
        updated_at: now,
        completed_at: None,
        error: None,
        can_retry: false,
        retry_of_task_id,
    };
    let (cancel_tx, cancel_rx) = watch::channel(false);
    let child = Arc::new(tokio::sync::Mutex::new(child));
    {
        let mut state = memory()
            .lock()
            .map_err(|_| "runtime task state is unavailable".to_owned())?;
        state
            .projections
            .insert(task_id.clone(), projection.clone());
        state.task_inputs.insert(task_id.clone(), retry_input);
        state.running.insert(
            task_id.clone(),
            RunningTask {
                cancel: cancel_tx,
                child: Arc::clone(&child),
            },
        );
    }
    persist_projection(&app, &projection)?;
    let _ = app.emit(EVENT_NAME, &projection);

    let runner_app = app.clone();
    let runner_projection = projection.clone();
    tauri::async_runtime::spawn(async move {
        run_task(
            runner_app,
            runner_projection,
            child,
            stdout,
            stderr,
            cancel_rx,
        )
        .await;
    });
    Ok(projection)
}

fn permission_mode_for_access(
    requested: &str,
    effective_access: ResidentAccessLevel,
) -> Result<&'static str, String> {
    match requested {
        "normal" => Ok("normal"),
        "full_access" if effective_access == ResidentAccessLevel::Full => Ok("full_access"),
        "full_access" => Err(
            "Enable Full Access for this resident in Settings before using it for a task."
                .to_owned(),
        ),
        _ => Err("task permission mode is invalid".to_owned()),
    }
}

pub async fn retry_runtime_task(
    app: AppHandle,
    task_id: String,
) -> Result<RuntimeTaskProjectionV1, String> {
    validate_opaque(&task_id, 128, "task")?;
    let input = memory()
        .lock()
        .map_err(|_| "runtime task state is unavailable".to_owned())?
        .task_inputs
        .get(&task_id)
        .cloned()
        .ok_or_else(|| {
            "This task can no longer be retried without reviewing its request.".to_owned()
        })?;
    start_runtime_task_internal(app, input, Some(task_id)).await
}

pub async fn cancel_runtime_task(
    app: AppHandle,
    task_id: String,
) -> Result<RuntimeTaskProjectionV1, String> {
    let (cancel, child, projection) = {
        let mut state = memory()
            .lock()
            .map_err(|_| "runtime task state is unavailable".to_owned())?;
        let running = state
            .running
            .get(&task_id)
            .ok_or_else(|| "runtime task is no longer active".to_owned())?;
        let cancel = running.cancel.clone();
        let child = Arc::clone(&running.child);
        let projection = state
            .projections
            .get_mut(&task_id)
            .ok_or_else(|| "runtime task is unavailable".to_owned())?;
        projection.state = RuntimeTaskStateV1::Stopping;
        projection.current_step = Some("Stopping task".to_owned());
        projection.updated_at = Utc::now().to_rfc3339();
        (cancel, child, projection.clone())
    };
    persist_projection(&app, &projection)?;
    let _ = app.emit(EVENT_NAME, &projection);
    let _ = cancel.send(true);
    let pid = child.lock().await.id();
    if let Some(pid) = pid {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            crate::managed_agents::terminate_process(pid)
        })
        .await;
    } else {
        let _ = child.lock().await.start_kill();
    }
    Ok(projection)
}

pub fn list_runtime_tasks(
    app: AppHandle,
    conversation_id: String,
) -> Result<Vec<RuntimeTaskProjectionV1>, String> {
    validate_opaque(&conversation_id, 128, "conversation")?;
    load_receipts(&app)?;
    let mut tasks = memory()
        .lock()
        .map_err(|_| "runtime task state is unavailable".to_owned())?
        .projections
        .values()
        .filter(|task| task.conversation_id == conversation_id)
        .cloned()
        .collect::<Vec<_>>();
    tasks.sort_by(|left, right| right.started_at.cmp(&left.started_at));
    Ok(tasks)
}

pub fn get_runtime_task_result(
    app: AppHandle,
    task_id: String,
) -> Result<RuntimeTaskResultV1, String> {
    validate_opaque(&task_id, 128, "task")?;
    load_receipts(&app)?;
    let (projection, in_memory_result) = {
        let state = memory()
            .lock()
            .map_err(|_| "runtime task state is unavailable".to_owned())?;
        let projection = state
            .projections
            .get(&task_id)
            .cloned()
            .ok_or_else(|| "runtime task is unavailable".to_owned())?;
        let result = state.results.get(&task_id).cloned();
        (projection, result)
    };
    Ok(RuntimeTaskResultV1 {
        task_id,
        state: projection.state,
        result: in_memory_result.or_else(|| load_result(&app, &projection.task_id)),
        error: projection.error.clone(),
    })
}

pub fn list_runtime_task_proposals(
    conversation_id: String,
) -> Result<Vec<RuntimeTaskProposalV1>, String> {
    validate_opaque(&conversation_id, 128, "conversation")?;
    let mut values = proposals()
        .lock()
        .map_err(|_| "runtime task proposal state is unavailable".to_owned())?
        .values()
        .filter(|pending| pending.projection.conversation_id == conversation_id)
        .map(|pending| pending.projection.clone())
        .collect::<Vec<_>>();
    values.sort_by(|left, right| left.created_at.cmp(&right.created_at));
    Ok(values)
}

pub fn respond_runtime_task_proposal(
    app: AppHandle,
    input: RespondRuntimeTaskProposalInputV1,
) -> Result<(), String> {
    validate_opaque(&input.proposal_id, 128, "proposal")?;
    let decision = if input.approved {
        let runtime_family = match input.runtime_family.as_deref() {
            Some("codex") => "codex".to_owned(),
            Some("claude" | "claude_code") => "claude_code".to_owned(),
            _ => return Err("Beta runtime tasks support Codex and Claude Code only.".to_owned()),
        };
        let working_folder = input
            .working_folder
            .as_deref()
            .ok_or_else(|| "Choose a task working folder before Run.".to_owned())?;
        let working_folder = validate_working_folder(Path::new(working_folder))?
            .to_string_lossy()
            .into_owned();
        let permission_mode = match input.permission_mode.as_deref() {
            Some("normal") => "normal".to_owned(),
            Some("full_access") => "full_access".to_owned(),
            _ => return Err("task permission mode is invalid".to_owned()),
        };
        RuntimeTaskProposalDecision::Run {
            runtime_family,
            working_folder,
            permission_mode,
        }
    } else {
        RuntimeTaskProposalDecision::Cancel
    };
    let pending = proposals()
        .lock()
        .map_err(|_| "runtime task proposal state is unavailable".to_owned())?
        .remove(&input.proposal_id)
        .ok_or_else(|| "This runtime task proposal is no longer pending.".to_owned())?;
    let send_result = pending
        .response
        .try_send(decision)
        .map_err(|_| "This runtime task proposal is no longer pending.".to_owned());
    let _ = app.emit(
        PROPOSAL_RESOLVED_EVENT_NAME,
        serde_json::json!({
            "proposalId": input.proposal_id,
            "conversationId": pending.projection.conversation_id,
        }),
    );
    send_result
}

pub(crate) fn propose_runtime_task(
    app: &AppHandle,
    resident_pubkey: &str,
    conversation_id: &str,
    arguments: serde_json::Value,
) -> Result<String, String> {
    validate_identity(resident_pubkey)?;
    validate_opaque(conversation_id, 128, "conversation")?;
    let arguments: RuntimeTaskProposalArgumentsV1 = serde_json::from_value(arguments)
        .map_err(|_| "runtime task proposal is invalid".to_owned())?;
    let runtime_family = match arguments.target_runtime.as_str() {
        "codex" => "codex".to_owned(),
        "claude" | "claude_code" => "claude_code".to_owned(),
        _ => return Err("Beta runtime tasks support Codex and Claude Code only.".to_owned()),
    };
    let summary = bounded_single_line(&arguments.summary, 240, "task summary")?;
    let prompt = bounded_text(&arguments.task, 64 * 1024, "task prompt")?;
    let proposal_id = Uuid::new_v4().to_string();
    let projection = RuntimeTaskProposalV1 {
        proposal_id: proposal_id.clone(),
        conversation_id: conversation_id.to_owned(),
        resident_pubkey: resident_pubkey.to_ascii_lowercase(),
        runtime_family,
        summary,
        created_at: Utc::now().to_rfc3339(),
    };
    let (response, decision) = mpsc::sync_channel(1);
    proposals()
        .lock()
        .map_err(|_| "runtime task proposal state is unavailable".to_owned())?
        .insert(
            proposal_id.clone(),
            PendingRuntimeTaskProposal {
                projection: projection.clone(),
                response,
            },
        );
    let _ = app.emit(PROPOSAL_EVENT_NAME, &projection);
    let decision = decision.recv_timeout(PROPOSAL_CONFIRMATION_TIMEOUT);
    if let Ok(mut pending) = proposals().lock() {
        if pending.remove(&proposal_id).is_some() {
            let _ = app.emit(
                PROPOSAL_RESOLVED_EVENT_NAME,
                serde_json::json!({
                    "proposalId": proposal_id,
                    "conversationId": conversation_id,
                }),
            );
        }
    }
    let (runtime_family, working_folder, permission_mode) = match decision {
        Ok(RuntimeTaskProposalDecision::Cancel) => {
            return Ok("The owner cancelled the proposed runtime task. Nothing ran.".to_owned())
        }
        Ok(RuntimeTaskProposalDecision::Run {
            runtime_family,
            working_folder,
            permission_mode,
        }) => (runtime_family, working_folder, permission_mode),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            return Ok(
                "The runtime task proposal expired without confirmation. Nothing ran.".to_owned(),
            )
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            return Err("runtime task confirmation became unavailable".to_owned())
        }
    };
    let task = tauri::async_runtime::block_on(start_runtime_task(
        app.clone(),
        StartRuntimeTaskInputV1 {
            conversation_id: conversation_id.to_owned(),
            resident_pubkey: resident_pubkey.to_owned(),
            runtime_family,
            summary: projection.summary,
            prompt,
            working_folder,
            permission_mode,
        },
    ))?;
    wait_for_runtime_task(app, &task.task_id)
}

pub(crate) fn read_runtime_task_result_for_resident(
    app: &AppHandle,
    resident_pubkey: &str,
    conversation_id: &str,
    arguments: serde_json::Value,
) -> Result<String, String> {
    validate_identity(resident_pubkey)?;
    validate_opaque(conversation_id, 128, "conversation")?;
    let arguments: RuntimeTaskResultArgumentsV1 = serde_json::from_value(arguments)
        .map_err(|_| "runtime task result reference is invalid".to_owned())?;
    validate_opaque(&arguments.task_id, 128, "task")?;
    let projection = memory()
        .lock()
        .map_err(|_| "runtime task state is unavailable".to_owned())?
        .projections
        .get(&arguments.task_id)
        .cloned()
        .ok_or_else(|| "runtime task result is unavailable".to_owned())?;
    if !runtime_task_result_matches_scope(&projection, resident_pubkey, conversation_id) {
        return Err("runtime task result is unavailable for this conversation".to_owned());
    }
    let result = load_result(app, &arguments.task_id)
        .ok_or_else(|| "runtime task completed without an available result".to_owned())?;
    Ok(bounded_output(&result, 512 * 1024))
}

fn runtime_task_result_matches_scope(
    projection: &RuntimeTaskProjectionV1,
    resident_pubkey: &str,
    conversation_id: &str,
) -> bool {
    projection.resident_pubkey == resident_pubkey.to_ascii_lowercase()
        && projection.conversation_id == conversation_id
        && projection.state == RuntimeTaskStateV1::Succeeded
}

fn wait_for_runtime_task(app: &AppHandle, task_id: &str) -> Result<String, String> {
    let deadline = Instant::now() + MAX_RUNTIME_TASK_DURATION + Duration::from_secs(30);
    loop {
        let snapshot = {
            let state = memory()
                .lock()
                .map_err(|_| "runtime task state is unavailable".to_owned())?;
            state
                .projections
                .get(task_id)
                .cloned()
                .map(|projection| (projection, state.results.get(task_id).cloned()))
        }
        .ok_or_else(|| "runtime task is unavailable".to_owned())?;
        match snapshot.0.state {
            RuntimeTaskStateV1::Succeeded => {
                return snapshot
                    .1
                    .or_else(|| load_result(app, task_id))
                    .ok_or_else(|| "runtime task completed without a result".to_owned())
            }
            RuntimeTaskStateV1::Stopped => {
                return Ok("The owner stopped the runtime task before completion.".to_owned())
            }
            RuntimeTaskStateV1::Failed | RuntimeTaskStateV1::Interrupted => {
                return Err(snapshot
                    .0
                    .error
                    .unwrap_or_else(|| "runtime task could not complete".to_owned()))
            }
            RuntimeTaskStateV1::Queued
            | RuntimeTaskStateV1::Active
            | RuntimeTaskStateV1::Stopping => {}
        }
        if Instant::now() >= deadline {
            return Err("runtime task exceeded the beta duration limit".to_owned());
        }
        thread::sleep(Duration::from_millis(250));
    }
}

async fn run_task(
    app: AppHandle,
    mut projection: RuntimeTaskProjectionV1,
    child: Arc<tokio::sync::Mutex<Child>>,
    stdout: tokio::process::ChildStdout,
    stderr: Option<tokio::process::ChildStderr>,
    mut cancel: watch::Receiver<bool>,
) {
    projection.state = RuntimeTaskStateV1::Active;
    let runtime_name = runtime_label(&projection.runtime_family);
    advance_step(&mut projection, format!("Working in {runtime_name}"));
    update_projection(&app, &projection);
    let mut lines = BufReader::new(stdout).lines();
    let stderr_task = stderr.map(|stderr| {
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                // Drain provider diagnostics so the pipe cannot back up. Raw
                // stderr is intentionally never promoted into a receipt.
                let _ = line;
            }
        })
    });
    let mut result = String::new();
    let mut output_closed = false;
    let mut cancelled = false;
    let mut timed_out = false;
    let duration_limit = tokio::time::sleep(MAX_RUNTIME_TASK_DURATION);
    tokio::pin!(duration_limit);
    let exit_status = loop {
        tokio::select! {
            changed = cancel.changed() => {
                if changed.is_ok() && *cancel.borrow() {
                    cancelled = true;
                    let _ = child.lock().await.start_kill();
                }
            }
            line = lines.next_line(), if !output_closed => {
                match line {
                    Ok(Some(line)) => observe_provider_line(&app, &mut projection, &line, &mut result),
                    _ => output_closed = true,
                }
            }
            _ = &mut duration_limit => {
                timed_out = true;
                let pid = child.lock().await.id();
                if let Some(pid) = pid {
                    let _ = tauri::async_runtime::spawn_blocking(move || {
                        crate::managed_agents::terminate_process(pid)
                    }).await;
                } else {
                    let _ = child.lock().await.start_kill();
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(120)) => {}
        }
        match child.lock().await.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {}
            Err(_) => break None,
        }
    };
    if let Some(task) = stderr_task {
        let _ = task.await;
    }
    let now = Utc::now().to_rfc3339();
    projection.updated_at = now.clone();
    projection.completed_at = Some(now);
    projection.current_step = None;
    if timed_out {
        projection.state = RuntimeTaskStateV1::Failed;
        finish_active_step(&mut projection, "failed");
        projection.error = Some("The task reached Polyphonic's 24-hour beta limit.".into());
    } else if cancelled {
        projection.state = RuntimeTaskStateV1::Stopped;
        finish_active_step(&mut projection, "failed");
    } else if projection.state == RuntimeTaskStateV1::Failed {
        finish_active_step(&mut projection, "failed");
        if projection.error.is_none() {
            projection.error = Some(format!(
                "{} task failed",
                runtime_label(&projection.runtime_family)
            ));
        }
    } else if exit_status.as_ref().is_some_and(|status| status.success()) {
        projection.state = RuntimeTaskStateV1::Succeeded;
        finish_active_step(&mut projection, "done");
        if result.trim().is_empty() {
            result = "The runtime completed without a textual result.".to_owned();
        }
    } else {
        projection.state = RuntimeTaskStateV1::Failed;
        finish_active_step(&mut projection, "failed");
        projection.error = Some(format!(
            "{} task failed",
            runtime_label(&projection.runtime_family)
        ));
    }
    projection.can_retry = projection.state == RuntimeTaskStateV1::Failed;
    if !result.trim().is_empty() {
        let result = bounded_output(&result, MAX_TEXT_BYTES);
        let _ = persist_result(&app, &projection.task_id, &result);
        if let Ok(mut state) = memory().lock() {
            state.results.insert(projection.task_id.clone(), result);
        }
    }
    if let Ok(mut state) = memory().lock() {
        state.running.remove(&projection.task_id);
        if !projection.can_retry {
            state.task_inputs.remove(&projection.task_id);
        }
    }
    update_projection(&app, &projection);
}

fn observe_provider_line(
    app: &AppHandle,
    projection: &mut RuntimeTaskProjectionV1,
    line: &str,
    result: &mut String,
) {
    if line.len() > 256 * 1024 {
        return;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };
    if value.get("protocol").and_then(serde_json::Value::as_str) != Some(HOST_PROTOCOL) {
        return;
    }
    if projection.provider_session_id.is_none() {
        projection.provider_session_id = value
            .get("providerSessionId")
            .and_then(serde_json::Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 512)
            .map(str::to_owned);
        if projection.provider_session_id.is_some() {
            projection.updated_at = Utc::now().to_rfc3339();
            update_projection(app, projection);
        }
    }
    let kind = value
        .get("kind")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if kind == "result"
        && value.get("stopReason").and_then(serde_json::Value::as_str) != Some("end_turn")
    {
        projection.state = RuntimeTaskStateV1::Failed;
        projection.error = Some("The runtime stopped before completing the task.".into());
    }
    if let Some(text) = (kind == "result")
        .then(|| value.get("result").and_then(serde_json::Value::as_str))
        .flatten()
    {
        *result = bounded_output(text, MAX_TEXT_BYTES);
    }
    if kind == "failed" {
        projection.state = RuntimeTaskStateV1::Failed;
        projection.error = value
            .get("error")
            .and_then(serde_json::Value::as_str)
            .map(|error| bounded_output(error, 512))
            .or_else(|| Some("The runtime task could not complete.".into()));
    }
    if let Some(label) = (kind == "step")
        .then(|| value.get("label").and_then(serde_json::Value::as_str))
        .flatten()
        .filter(|label| !label.is_empty() && label.len() <= 128)
    {
        advance_step(projection, label.to_owned());
        projection.updated_at = Utc::now().to_rfc3339();
        update_projection(app, projection);
    }
}

fn advance_step(projection: &mut RuntimeTaskProjectionV1, label: String) {
    if projection.current_step.as_deref() == Some(label.as_str()) {
        return;
    }
    if let Some(active) = projection
        .steps
        .iter_mut()
        .rev()
        .find(|step| step.state == "active")
    {
        active.state = "done".to_owned();
        projection.completed_steps = projection.completed_steps.saturating_add(1);
    }
    projection.current_step = Some(label.clone());
    projection.steps.push(RuntimeTaskStepV1 {
        label,
        state: "active".to_owned(),
    });
}

fn finish_active_step(projection: &mut RuntimeTaskProjectionV1, state: &str) {
    if let Some(active) = projection
        .steps
        .iter_mut()
        .rev()
        .find(|step| step.state == "active")
    {
        active.state = state.to_owned();
        if state == "done" {
            projection.completed_steps = projection.completed_steps.saturating_add(1);
        }
    }
}

fn command_for(runtime: &str) -> Result<(PathBuf, PathBuf), String> {
    let host = crate::managed_agents::resolve_command("buzz-acp")
        .ok_or_else(|| "Polyphonic's managed runtime host is unavailable".to_owned())?;
    let candidates: &[&str] = if runtime == "codex" {
        &["codex-acp"]
    } else {
        &["claude-agent-acp", "claude-code-acp"]
    };
    let adapter = candidates
        .iter()
        .find_map(|candidate| crate::managed_agents::resolve_command(candidate))
        .ok_or_else(|| format!("{} is not ready", runtime_label(runtime)))?;
    Ok((host, adapter))
}

fn next_session_epoch() -> Result<luca_protocol::SafeU53, String> {
    let random = Uuid::new_v4().as_u128() as u64;
    let epoch = (random & luca_protocol::JSON_SAFE_INTEGER_MAX).max(1);
    luca_protocol::SafeU53::new(epoch).map_err(|error| error.to_string())
}

fn validate_working_folder(path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|_| "Choose an existing working folder.".to_owned())?;
    if !canonical.is_dir() || canonical.parent().is_none() {
        return Err("Choose a specific working folder, not a filesystem root.".to_owned());
    }
    if dirs::home_dir().is_some_and(|home| home == canonical) {
        return Err("Choose a project folder, not your home folder.".to_owned());
    }
    Ok(canonical)
}

fn validate_identity(value: &str) -> Result<(), String> {
    if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("task resident identity is invalid".to_owned())
    }
}

fn validate_opaque(value: &str, max: usize, label: &str) -> Result<(), String> {
    if !value.is_empty()
        && value.len() <= max
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._:-".contains(character))
    {
        Ok(())
    } else {
        Err(format!("task {label} identity is invalid"))
    }
}

fn bounded_text(value: &str, max: usize, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > max
        || value
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(format!("{label} is invalid"));
    }
    Ok(value.to_owned())
}

fn bounded_single_line(value: &str, max: usize, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err(format!("{label} is invalid"));
    }
    Ok(value.to_owned())
}

fn bounded_output(value: &str, max: usize) -> String {
    let value = value.trim();
    if value.len() <= max {
        value.to_owned()
    } else {
        let mut boundary = max.saturating_sub(3).min(value.len());
        while boundary > 0 && !value.is_char_boundary(boundary) {
            boundary -= 1;
        }
        format!("{}…", &value[..boundary])
    }
}

fn runtime_label(runtime: &str) -> &'static str {
    if runtime == "codex" {
        "Codex"
    } else {
        "Claude Code"
    }
}

fn update_projection(app: &AppHandle, projection: &RuntimeTaskProjectionV1) {
    if let Ok(mut state) = memory().lock() {
        state
            .projections
            .insert(projection.task_id.clone(), projection.clone());
    }
    let _ = persist_projection(app, projection);
    let _ = app.emit(EVENT_NAME, projection);
}

fn receipt_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "runtime task receipt storage is unavailable".to_owned())?
        .join("luca")
        .join(RECEIPT_DIRECTORY);
    fs::create_dir_all(&directory).map_err(|_| "create runtime task receipt storage".to_owned())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let _ = fs::set_permissions(&directory, fs::Permissions::from_mode(0o700));
    }
    Ok(directory)
}

fn result_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "runtime task result storage is unavailable".to_owned())?
        .join("luca")
        .join(RESULT_DIRECTORY);
    fs::create_dir_all(&directory).map_err(|_| "create runtime task result storage".to_owned())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let _ = fs::set_permissions(&directory, fs::Permissions::from_mode(0o700));
    }
    Ok(directory)
}

fn persist_projection(app: &AppHandle, projection: &RuntimeTaskProjectionV1) -> Result<(), String> {
    let directory = receipt_directory(app)?;
    let path = directory.join(format!("{}.json", projection.task_id));
    let bytes =
        serde_json::to_vec(projection).map_err(|_| "encode runtime task receipt".to_owned())?;
    fs::write(&path, bytes).map_err(|_| "write runtime task receipt".to_owned())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn persist_result(app: &AppHandle, task_id: &str, result: &str) -> Result<(), String> {
    validate_opaque(task_id, 128, "task")?;
    let path = result_directory(app)?.join(format!("{task_id}.txt"));
    fs::write(&path, result.as_bytes()).map_err(|_| "write runtime task result".to_owned())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn load_result(app: &AppHandle, task_id: &str) -> Option<String> {
    validate_opaque(task_id, 128, "task").ok()?;
    let path = result_directory(app).ok()?.join(format!("{task_id}.txt"));
    let bytes = fs::read(path).ok()?;
    if bytes.is_empty() || bytes.len() > MAX_TEXT_BYTES {
        return None;
    }
    String::from_utf8(bytes).ok()
}

fn load_receipts(app: &AppHandle) -> Result<(), String> {
    {
        let mut state = memory()
            .lock()
            .map_err(|_| "runtime task state is unavailable".to_owned())?;
        if state.receipts_loaded {
            return Ok(());
        }
        state.receipts_loaded = true;
    }
    let result = load_receipts_once(app);
    if result.is_err() {
        if let Ok(mut state) = memory().lock() {
            state.receipts_loaded = false;
        }
    }
    result
}

fn load_receipts_once(app: &AppHandle) -> Result<(), String> {
    let directory = receipt_directory(app)?;
    let mut loaded = Vec::new();
    for entry in fs::read_dir(directory)
        .map_err(|_| "read runtime task receipts".to_owned())?
        .flatten()
        .take(MAX_RECEIPTS)
    {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(bytes) = fs::read(path) else { continue };
        let Ok(mut projection) = serde_json::from_slice::<RuntimeTaskProjectionV1>(&bytes) else {
            continue;
        };
        projection.can_retry = false;
        if matches!(
            projection.state,
            RuntimeTaskStateV1::Queued | RuntimeTaskStateV1::Active | RuntimeTaskStateV1::Stopping
        ) {
            projection.state = RuntimeTaskStateV1::Interrupted;
            projection.current_step = None;
            projection.completed_at = Some(Utc::now().to_rfc3339());
            projection.updated_at = projection.completed_at.clone().unwrap_or_default();
            let _ = persist_projection(app, &projection);
        }
        loaded.push(projection);
    }
    let mut state = memory()
        .lock()
        .map_err(|_| "runtime task state is unavailable".to_owned())?;
    for projection in loaded {
        state
            .projections
            .entry(projection.task_id.clone())
            .or_insert(projection);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_home_and_filesystem_root() {
        assert!(validate_working_folder(Path::new("/")).is_err());
        if let Some(home) = dirs::home_dir() {
            assert!(validate_working_folder(&home).is_err());
        }
    }

    #[test]
    fn bounded_output_is_utf8_safe() {
        assert_eq!(bounded_output("éééé", 5), "é…");
    }

    #[test]
    fn full_access_requires_the_residents_existing_setting() {
        assert_eq!(
            permission_mode_for_access("normal", ResidentAccessLevel::Restricted).unwrap(),
            "normal"
        );
        assert_eq!(
            permission_mode_for_access("full_access", ResidentAccessLevel::Full).unwrap(),
            "full_access"
        );
        assert!(permission_mode_for_access("full_access", ResidentAccessLevel::Standard).is_err());
        assert!(
            permission_mode_for_access("full_access", ResidentAccessLevel::Restricted).is_err()
        );
    }

    #[test]
    fn task_prompts_allow_lines_but_receipts_never_serialize_bodies() {
        assert_eq!(
            bounded_text("first line\nsecond line", 64, "task prompt").unwrap(),
            "first line\nsecond line"
        );
        let projection = RuntimeTaskProjectionV1 {
            task_id: "task-1".into(),
            conversation_id: "conversation-1".into(),
            resident_pubkey: "11".repeat(32),
            runtime_family: "codex".into(),
            summary: "Inspect the project".into(),
            working_folder: "/tmp/project".into(),
            permission_mode: "normal".into(),
            state: RuntimeTaskStateV1::Active,
            provider_session_id: Some("provider-session".into()),
            current_step: Some("Reading files".into()),
            completed_steps: 1,
            steps: vec![RuntimeTaskStepV1 {
                label: "Reading files".into(),
                state: "active".into(),
            }],
            started_at: "2026-09-01T00:00:00Z".into(),
            updated_at: "2026-09-01T00:01:00Z".into(),
            completed_at: None,
            error: None,
            can_retry: false,
            retry_of_task_id: None,
        };
        let encoded = serde_json::to_value(&projection).unwrap();
        assert!(encoded.get("prompt").is_none());
        assert!(encoded.get("result").is_none());
        let mut succeeded = projection.clone();
        succeeded.state = RuntimeTaskStateV1::Succeeded;
        assert!(runtime_task_result_matches_scope(
            &succeeded,
            &"11".repeat(32),
            "conversation-1"
        ));
        assert!(!runtime_task_result_matches_scope(
            &succeeded,
            &"22".repeat(32),
            "conversation-1"
        ));
        assert!(!runtime_task_result_matches_scope(
            &succeeded,
            &"11".repeat(32),
            "conversation-2"
        ));

        let proposal = RuntimeTaskProposalV1 {
            proposal_id: "proposal-1".into(),
            conversation_id: "conversation-1".into(),
            resident_pubkey: "11".repeat(32),
            runtime_family: "codex".into(),
            summary: "Inspect the project".into(),
            created_at: "2026-09-01T00:00:00Z".into(),
        };
        let encoded = serde_json::to_value(&proposal).unwrap();
        assert!(encoded.get("task").is_none());
        assert!(encoded.get("prompt").is_none());
    }
}
