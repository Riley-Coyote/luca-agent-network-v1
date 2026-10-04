//! Explicit, owner-approved Codex and Claude root tasks.
//!
//! This is a small native coordinator over the user's existing runtime CLI and
//! profile. It owns confirmation receipts, cancellation and presentation only;
//! the provider remains the worker and retains its own session history.

use crate::data_dir::BuzzPathExt;
use std::{
    collections::HashMap,
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
    process::{Child, Command},
    sync::watch,
};
use uuid::Uuid;

mod delegation;
mod delivery;
mod execution;
mod host_events;
mod host_io;
mod lifecycle;
mod storage;
mod targets;

const EVENT_NAME: &str = "luca://runtime-task";
const PROPOSAL_EVENT_NAME: &str = "luca://runtime-task-proposal";
const PROPOSAL_RESOLVED_EVENT_NAME: &str = "luca://runtime-task-proposal-resolved";
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
    AwaitingNative,
    Succeeded,
    Stopped,
    Failed,
    Interrupted,
}

/// The requested native operation; older requests remain explicit new tasks.
#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeTaskOperationV1 {
    #[default]
    NewTask,
    ContinueSession,
    SendMessage,
}

/// Who can stop and approve work, not who merely observes its receipt.
#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeTaskControlOwnerV1 {
    #[default]
    Polyphonic,
    NativeApp,
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
    #[serde(default)]
    owner_pubkey: String,
    #[serde(default)]
    origin_relay_ref: Option<luca_protocol::Sha256Ref>,
    conversation_id: String,
    resident_pubkey: String,
    runtime_family: String,
    summary: String,
    working_folder: String,
    permission_mode: String,
    #[serde(default)]
    operation: RuntimeTaskOperationV1,
    #[serde(default)]
    control_owner: RuntimeTaskControlOwnerV1,
    #[serde(default)]
    target_label: Option<String>,
    #[serde(default)]
    target_session_ref: Option<String>,
    #[serde(default)]
    target_source_ref: Option<String>,
    #[serde(default)]
    native_acknowledgement_id: Option<String>,
    #[serde(default)]
    delivery_state: Option<super::runtime_task_delivery::RuntimeTaskDeliveryStateV1>,
    #[serde(default)]
    delivery_can_retry: bool,
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
    #[serde(default)]
    operation: RuntimeTaskOperationV1,
    source_id: Option<String>,
    session_id: Option<String>,
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
    operation: RuntimeTaskOperationV1,
    source_id: Option<String>,
    session_id: Option<String>,
    target_label: Option<String>,
    target_working_folder: Option<String>,
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
    #[serde(default)]
    operation: RuntimeTaskOperationV1,
    source_id: Option<String>,
    session_id: Option<String>,
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
    owner_pubkey: String,
    origin_relay_ref: luca_protocol::Sha256Ref,
    target: Option<targets::RuntimeTaskExistingTargetV1>,
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
    owner_pubkey: Option<String>,
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
    if input.operation != RuntimeTaskOperationV1::NewTask {
        return delegation::start_existing(app, input, retry_of_task_id).await;
    }
    if input.source_id.is_some() || input.session_id.is_some() {
        return Err("A new task cannot silently adopt an existing session target.".into());
    }
    #[cfg(not(unix))]
    return Err("Explicit runtime tasks require Polyphonic's local managed host.".into());
    let (command, adapter) = command_for(runtime_family)?;
    let session_epoch = next_session_epoch()?;
    let app_data_dir = app
        .buzz_path()
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
        working_folder.clone(),
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
    let now = Utc::now().to_rfc3339();
    let projection = RuntimeTaskProjectionV1 {
        task_id: task_id.clone(),
        owner_pubkey,
        origin_relay_ref: Some(delivery::current_origin(&app)?.0),
        conversation_id: input.conversation_id,
        resident_pubkey: resident_pubkey.as_str().to_owned(),
        runtime_family: runtime_family.to_owned(),
        summary,
        working_folder: working_folder.to_string_lossy().into_owned(),
        permission_mode: permission_mode.to_owned(),
        operation: RuntimeTaskOperationV1::NewTask,
        control_owner: RuntimeTaskControlOwnerV1::Polyphonic,
        target_label: None,
        target_session_ref: None,
        target_source_ref: None,
        native_acknowledgement_id: None,
        delivery_state: None,
        delivery_can_retry: false,
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
    execution::launch_owned_task(app, projection, process, encoded_input, Some(retry_input))
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
    load_receipts(&app)?;
    let input = {
        let state = memory()
            .lock()
            .map_err(|_| "runtime task state is unavailable".to_owned())?;
        let projection = state
            .projections
            .get(&task_id)
            .ok_or_else(|| "runtime task is unavailable".to_owned())?;
        if !projection.can_retry
            || projection.state != RuntimeTaskStateV1::Failed
            || projection.operation != RuntimeTaskOperationV1::NewTask
            || projection.control_owner != RuntimeTaskControlOwnerV1::Polyphonic
        {
            return Err(
                "This task cannot be safely repeated; review the native receipt first.".into(),
            );
        }
        state.task_inputs.get(&task_id).cloned().ok_or_else(|| {
            "This task can no longer be retried without reviewing its request.".to_owned()
        })?
    };
    start_runtime_task_internal(app, input, Some(task_id)).await
}

pub async fn cancel_runtime_task(
    app: AppHandle,
    task_id: String,
) -> Result<RuntimeTaskProjectionV1, String> {
    load_receipts(&app)?;
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
        let mut projection = state
            .projections
            .get(&task_id)
            .cloned()
            .ok_or_else(|| "runtime task is unavailable".to_owned())?;
        if projection.control_owner != RuntimeTaskControlOwnerV1::Polyphonic {
            return Err("Stop this externally owned work in the native app.".into());
        }
        delivery::ensure_current_scope(&app, &projection)?;
        if !lifecycle::can_cancel(projection.state) {
            return Err("The task already finished; no stop request was accepted.".into());
        }
        projection.state = RuntimeTaskStateV1::Stopping;
        projection.current_step = Some("Stopping task".to_owned());
        projection.updated_at = Utc::now().to_rfc3339();
        persist_projection(&app, &projection)?;
        state
            .projections
            .insert(task_id.clone(), projection.clone());
        // The durable stop request and signal are committed under the same
        // lock as progress, so a late activity event cannot restore Active.
        let _ = cancel.send(true);
        (cancel, child, projection)
    };
    emit_projection_in_scope(&app, &projection);
    drop(cancel);
    let _ = execution::stop_owned_child(&child).await;
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
    tasks.retain(|task| delivery::ensure_current_scope(&app, task).is_ok());
    tasks.sort_by(|left, right| right.started_at.cmp(&left.started_at));
    for task in &mut tasks {
        delivery::decorate(&app, task);
    }
    Ok(tasks)
}

/// Reproject durable return state after a private job or broker transition.
/// This never changes the provider outcome or stores a result in an event.
pub(crate) fn refresh_runtime_task_delivery(app: &AppHandle, task_id: &str) {
    // Serialize read/decorate/commit, so an older delivery snapshot cannot
    // acquire a later timestamp and overwrite a published projection.
    static REFRESH: OnceLock<Mutex<()>> = OnceLock::new();
    let Ok(_refresh) = REFRESH.get_or_init(|| Mutex::new(())).lock() else {
        return;
    };
    let projection = memory()
        .lock()
        .ok()
        .and_then(|state| state.projections.get(task_id).cloned());
    if let Some(mut projection) = projection {
        if delivery::ensure_current_scope(app, &projection).is_ok() {
            delivery::decorate(app, &mut projection);
            // A subsecond delivery transition must outrank its prior event.
            let prior_ms = chrono::DateTime::parse_from_rfc3339(&projection.updated_at)
                .map(|value| value.timestamp_millis())
                .unwrap_or_default();
            let next_ms = Utc::now()
                .timestamp_millis()
                .max(prior_ms.saturating_add(1));
            if let Some(timestamp) = chrono::DateTime::from_timestamp_millis(next_ms) {
                projection.updated_at =
                    timestamp.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            }
            let _ = update_projection(app, &projection);
        }
    }
}

pub fn retry_runtime_task_delivery(
    app: AppHandle,
    task_id: String,
) -> Result<RuntimeTaskProjectionV1, String> {
    delivery::retry(app, task_id)
}

/// Wake retained result delivery after a workspace apply or companion restart.
/// Concurrent lifecycle triggers are coalesced without losing a later wakeup.
pub(crate) fn queue_runtime_task_delivery_recovery(app: &AppHandle) {
    delivery::queue_recovery(app);
}

/// Graceful app exit stops only child handles owned by this coordinator.
/// External Codex app sessions never enter `running` and are not signalled.
pub(crate) fn shutdown_owned_runtime_tasks(app: &AppHandle) -> Result<(), String> {
    let children = {
        let mut state = memory()
            .lock()
            .map_err(|_| "Runtime task state is unavailable.".to_owned())?;
        let owned = state
            .running
            .iter()
            .map(|(id, task)| (id.clone(), task.cancel.clone(), Arc::clone(&task.child)))
            .collect::<Vec<_>>();
        let mut children = Vec::with_capacity(owned.len());
        for (id, cancel, child) in owned {
            if let Some(mut projection) = state.projections.get(&id).cloned() {
                if matches!(
                    projection.state,
                    RuntimeTaskStateV1::Queued
                        | RuntimeTaskStateV1::Active
                        | RuntimeTaskStateV1::Stopping
                ) {
                    projection.state = RuntimeTaskStateV1::Interrupted;
                    projection.current_step = None;
                    projection.updated_at = Utc::now().to_rfc3339();
                    projection.can_retry = false;
                    projection.error = Some("The app closed before completion was committed. Review native work before another request; nothing will be restarted automatically.".into());
                    let _ = persist_projection(app, &projection);
                    state.projections.insert(id, projection);
                }
            }
            let _ = cancel.send(true);
            children.push(child);
        }
        children
    };
    if children.is_empty() {
        return Ok(());
    }
    let (sent, received) = mpsc::sync_channel(1);
    tauri::async_runtime::spawn(async move {
        let workers = children
            .into_iter()
            .map(|child| {
                tauri::async_runtime::spawn(
                    async move { execution::stop_owned_child(&child).await },
                )
            })
            .collect::<Vec<_>>();
        let mut all_reaped = true;
        for worker in workers {
            all_reaped &= matches!(worker.await, Ok(true));
        }
        let _ = sent.send(all_reaped);
    });
    match received.recv_timeout(Duration::from_secs(10)) {
        Ok(true) => Ok(()),
        _ => Err("Some owned runtime task cleanup could not be verified.".into()),
    }
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
    delivery::ensure_current_scope(&app, &projection)?;
    Ok(RuntimeTaskResultV1 {
        task_id,
        state: projection.state,
        result: (projection.state == RuntimeTaskStateV1::Succeeded
            && projection.control_owner == RuntimeTaskControlOwnerV1::Polyphonic)
            .then(|| in_memory_result.or_else(|| load_result(&app, &projection.task_id)))
            .flatten(),
        error: projection.error.clone(),
    })
}

/// Open only the exact, validated Codex app target retained by a local receipt.
pub fn open_runtime_task_native_session(app: AppHandle, task_id: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt as _;
    validate_opaque(&task_id, 128, "task")?;
    load_receipts(&app)?;
    let state = memory()
        .lock()
        .map_err(|_| "Runtime task state is unavailable.".to_owned())?;
    let task = state
        .projections
        .get(&task_id)
        .ok_or_else(|| "Runtime task is unavailable.".to_owned())?;
    if task.owner_pubkey != delegation::owner(&app)?.as_str()
        || task.runtime_family != "codex"
        || task.control_owner != RuntimeTaskControlOwnerV1::NativeApp
        || task.operation != RuntimeTaskOperationV1::SendMessage
    {
        return Err("This receipt has no validated native app destination.".into());
    }
    let id = task
        .provider_session_id
        .as_deref()
        .and_then(|value| Uuid::parse_str(value).ok())
        .filter(|value| !value.is_nil())
        .ok_or_else(|| "This receipt has no validated native app destination.".to_owned())?;
    drop(state);
    app.opener()
        .open_url(format!("codex://threads/{id}"), None::<&str>)
        .map_err(|_| "The selected Codex chat could not be opened.".into())
}

pub fn list_runtime_task_proposals(
    app: AppHandle,
    conversation_id: String,
) -> Result<Vec<RuntimeTaskProposalV1>, String> {
    validate_opaque(&conversation_id, 128, "conversation")?;
    let mut values = proposals()
        .lock()
        .map_err(|_| "runtime task proposal state is unavailable".to_owned())?
        .values()
        .filter(|pending| {
            pending.projection.conversation_id == conversation_id
                && delegation::owner(&app).is_ok_and(|owner| owner.as_str() == pending.owner_pubkey)
                && delivery::current_origin(&app)
                    .is_ok_and(|(relay, _)| relay == pending.origin_relay_ref)
        })
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
    let (snapshot, expected_owner, expected_origin, target) = {
        let pending = proposals()
            .lock()
            .map_err(|_| "runtime task proposal state is unavailable".to_owned())?;
        let pending = pending
            .get(&input.proposal_id)
            .ok_or_else(|| "This runtime task proposal is no longer pending.".to_owned())?;
        (
            pending.projection.clone(),
            pending.owner_pubkey.clone(),
            pending.origin_relay_ref.clone(),
            pending.target.clone(),
        )
    };
    if delegation::owner(&app)?.as_str() != expected_owner
        || delivery::current_origin(&app)?.0 != expected_origin
    {
        return Err("This proposal belongs to a different active owner or community.".into());
    }
    let decision = if input.approved {
        if let Some(target) = target {
            if input.runtime_family.as_deref() != Some(snapshot.runtime_family.as_str())
                || input.working_folder.as_deref() != snapshot.target_working_folder.as_deref()
                || input.permission_mode.as_deref() != Some("normal")
            {
                return Err("An existing session's runtime, workspace and native permission policy cannot be changed by confirmation.".into());
            }
            delegation::revalidate_target(
                &app,
                &snapshot.resident_pubkey,
                &target,
                snapshot.operation,
            )?;
            RuntimeTaskProposalDecision::Run {
                runtime_family: snapshot.runtime_family.clone(),
                working_folder: target
                    .canonical_working_folder
                    .to_string_lossy()
                    .into_owned(),
                permission_mode: "normal".into(),
            }
        } else {
            let runtime_family = match input.runtime_family.as_deref() {
                Some("codex") => "codex".to_owned(),
                Some("claude" | "claude_code") => "claude_code".to_owned(),
                _ => {
                    return Err("Beta runtime tasks support Codex and Claude Code only.".to_owned())
                }
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

pub(crate) fn propose_runtime_task<C: FnMut() -> bool>(
    app: &AppHandle,
    resident_pubkey: &str,
    conversation_id: &str,
    arguments: serde_json::Value,
    mut cancelled: C,
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
    let owner = delegation::owner(app)?;
    let origin = delivery::current_origin(app)?.0;
    let target = if arguments.operation == RuntimeTaskOperationV1::NewTask {
        if arguments.source_id.is_some() || arguments.session_id.is_some() {
            return Err("A new task cannot silently adopt an existing session.".into());
        }
        None
    } else {
        Some(delegation::resolve_target(
            app,
            resident_pubkey,
            &runtime_family,
            arguments.operation,
            arguments.source_id.as_deref(),
            arguments.session_id.as_deref(),
            None,
        )?)
    };
    let proposal_id = Uuid::new_v4().to_string();
    let projection = RuntimeTaskProposalV1 {
        proposal_id: proposal_id.clone(),
        conversation_id: conversation_id.to_owned(),
        resident_pubkey: resident_pubkey.to_ascii_lowercase(),
        runtime_family,
        summary,
        operation: arguments.operation,
        source_id: arguments.source_id,
        session_id: arguments.session_id,
        target_label: target.as_ref().map(|value| value.label.clone()),
        target_working_folder: target.as_ref().map(|value| {
            value
                .canonical_working_folder
                .to_string_lossy()
                .into_owned()
        }),
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
                owner_pubkey: owner.as_str().to_owned(),
                origin_relay_ref: origin.clone(),
                target,
            },
        );
    let _ = app.emit(PROPOSAL_EVENT_NAME, &projection);
    let deadline = Instant::now() + PROPOSAL_CONFIRMATION_TIMEOUT;
    let decision = loop {
        if cancelled()
            || delegation::owner(app)?.as_str() != owner.as_str()
            || delivery::current_origin(app)?.0 != origin
            || app
                .state::<crate::app_state::AppState>()
                .shutdown_started
                .load(std::sync::atomic::Ordering::Acquire)
        {
            break Ok(RuntimeTaskProposalDecision::Cancel);
        }
        match decision.recv_timeout(Duration::from_millis(100)) {
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() < deadline => continue,
            value => break value,
        }
    };
    if let Ok(mut pending) = proposals().lock() {
        if pending.remove(&proposal_id).is_some()
            && delegation::owner(app).is_ok_and(|current| current == owner)
            && delivery::current_origin(app).is_ok_and(|(relay, _)| relay == origin)
        {
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
    if cancelled()
        || delegation::owner(app)?.as_str() != owner.as_str()
        || delivery::current_origin(app)?.0 != origin
    {
        return Err("Runtime task authority ended before dispatch. Nothing ran.".into());
    }
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
            operation: projection.operation,
            source_id: projection.source_id,
            session_id: projection.session_id,
        },
    ))?;
    if task.control_owner == RuntimeTaskControlOwnerV1::NativeApp {
        return serde_json::to_string(&serde_json::json!({
            "task_id": task.task_id,
            "operation": task.operation,
            "state": task.state,
            "control_owner": "native_app",
            "target_session_ref": task.target_session_ref,
            "message": if task.state == RuntimeTaskStateV1::AwaitingNative {
                "Codex acknowledged a queued message to the exact selected app chat. This is delivery only, not steering or work completion. Progress, questions, approvals and stopping remain in Codex."
            } else {
                "Delivery is uncertain. Review the selected chat in Codex before another request; do not resend automatically."
            },
        })).map_err(|_| "Runtime task acknowledgement could not be encoded.".into());
    }
    serde_json::to_string(&serde_json::json!({
        "task_id": task.task_id,
        "operation": task.operation,
        "state": task.state,
        "control_owner": "polyphonic",
        "message": "The owner-approved task was dispatched. This is not completion. Progress and permission requests use the existing task surface; one summary from this companion will return to this conversation after verified completion. Do not hold this call open, poll repeatedly, or start a replacement task.",
    })).map_err(|_| "Runtime task acknowledgement could not be encoded.".into())
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
    load_receipts(app)?;
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
    delivery::ensure_current_scope(app, &projection)?;
    let result = load_result(app, &arguments.task_id)
        .ok_or_else(|| "runtime task completed without an available result".to_owned())?;
    Ok(bounded_output(&result, 512 * 1024))
}

/// Body-free, granted target selection. Listing never implies live ownership.
pub(crate) fn list_runtime_task_sessions_for_resident(
    app: &AppHandle,
    resident: &str,
    arguments: serde_json::Value,
) -> Result<String, String> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Input {
        target_runtime: String,
        source_id: Option<String>,
        limit: Option<usize>,
    }
    let input: Input = serde_json::from_value(arguments)
        .map_err(|_| "Native session listing is invalid.".to_owned())?;
    let kind = match input.target_runtime.as_str() {
        "codex" => luca_protocol::ConnectedBrainSourceKindV1::CodexHistory,
        "claude_code" => luca_protocol::ConnectedBrainSourceKindV1::ClaudeHistory,
        _ => return Err("Choose Codex or Claude Code for native session listing.".into()),
    };
    let limit = input.limit.unwrap_or(20);
    if !(1..=50).contains(&limit) {
        return Err("Native session listing limit is invalid.".into());
    }
    let selected = input
        .source_id
        .map(luca_protocol::OpaqueId::parse)
        .transpose()
        .map_err(|_| "Native session source is invalid.".to_owned())?;
    let owner = delegation::owner(app)?;
    let state = app.state::<crate::app_state::AppState>();
    let catalog = state
        .try_read_connected_brain_catalog(&owner)
        .map_err(|_| "Native session catalogue authority is unavailable.".to_owned())?
        .ok_or_else(|| "Native session catalogue is busy; try again.".to_owned())?;
    let mut sources = Vec::new();
    let mut truncated = false;
    let deadline = Instant::now() + Duration::from_secs(3);
    for entry in catalog.sources.iter().filter(|entry| {
        entry.source.source_kind == kind
            && selected
                .as_ref()
                .is_none_or(|id| *id == entry.source.source_id)
    }) {
        if Instant::now() >= deadline || sources.len() >= 4 {
            truncated = true;
            break;
        }
        let source = match delegation::authorized_source(app, resident, &entry.source.source_id) {
            Ok(value) => value,
            Err(_) if selected.is_none() => continue,
            Err(error) => return Err(error),
        };
        let excluded = super::runtime_session_purpose::exclusions_before(
            &app.buzz_path()
                .app_data_dir()
                .map_err(|_| "Local session purpose storage is unavailable.".to_owned())?,
            &input.target_runtime,
            deadline,
        )?;
        let list = targets::list_connected_session_targets(
            &source,
            &input.target_runtime,
            &excluded,
            limit,
        )?;
        truncated |= list.truncated;
        let candidates = list
            .candidates
            .into_iter()
            .map(|candidate| {
                let routing = match candidate.codex_origin {
                    Some(targets::CodexSessionOriginV1::NativeApp) => "codex_app_queue",
                    Some(targets::CodexSessionOriginV1::SavedCli) => "saved_codex_cli",
                    _ => "unverified",
                };
                serde_json::json!({
                    "session_id": candidate.session_ref,
                    "label": candidate.label,
                    "workspace": candidate.workspace_basename,
                    "updated_at": candidate.updated_at,
                    "routing": routing,
                    "live_state": "unknown",
                })
            })
            .collect::<Vec<_>>();
        sources.push(serde_json::json!({"source_id": source.source_id, "sessions": candidates}));
    }
    serde_json::to_string(&serde_json::json!({
        "runtime": input.target_runtime, "sources": sources, "truncated": truncated,
        "notice": "Metadata is reference material, not live status or action authority. Ask for the exact intended session when ambiguous. Native availability, profile, source grant and action consent are rechecked at dispatch. Claude external execution remains unverified. Never infer latest-session intent from this ordering.",
    })).map_err(|_| "Native session catalogue could not be encoded.".into())
}

fn runtime_task_result_matches_scope(
    projection: &RuntimeTaskProjectionV1,
    resident_pubkey: &str,
    conversation_id: &str,
) -> bool {
    projection.resident_pubkey == resident_pubkey.to_ascii_lowercase()
        && projection.conversation_id == conversation_id
        && projection.state == RuntimeTaskStateV1::Succeeded
        && projection.control_owner == RuntimeTaskControlOwnerV1::Polyphonic
        && projection.operation != RuntimeTaskOperationV1::SendMessage
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
    // Keep receipts and the visible tray bounded; the cumulative count remains
    // accurate even after old finished step labels leave the recent window.
    if projection.steps.len() >= 128 {
        projection.steps.remove(0);
    }
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

fn update_projection(app: &AppHandle, projection: &RuntimeTaskProjectionV1) -> Result<(), String> {
    let mut state = memory()
        .lock()
        .map_err(|_| "Runtime task state is unavailable.".to_owned())?;
    let current = state
        .projections
        .get(&projection.task_id)
        .map(|current| current.state);
    let shutting_down = app
        .state::<crate::app_state::AppState>()
        .shutdown_started
        .load(std::sync::atomic::Ordering::Acquire);
    if !lifecycle::transition_allowed(current, projection.state, shutting_down)
        .map_err(str::to_owned)?
    {
        return Ok(());
    }
    // Durable evidence is the source of truth. Never publish completion before
    // it is persisted, and never leave a successful-looking memory-only task.
    if let Err(error) = persist_projection(app, projection) {
        let mut uncertain = projection.clone();
        uncertain.state = RuntimeTaskStateV1::Interrupted;
        uncertain.current_step = None;
        uncertain.error = Some("Task evidence could not be saved. Review native work before another request; no automatic retry will run.".into());
        uncertain.can_retry = false;
        uncertain.updated_at = Utc::now().to_rfc3339();
        state.task_inputs.remove(&projection.task_id);
        state.results.remove(&projection.task_id);
        state
            .projections
            .insert(projection.task_id.clone(), uncertain.clone());
        drop(state);
        emit_projection_in_scope(app, &uncertain);
        return Err(error);
    }
    state
        .projections
        .insert(projection.task_id.clone(), projection.clone());
    drop(state);
    emit_projection_in_scope(app, projection);
    Ok(())
}

fn emit_projection_in_scope(app: &AppHandle, projection: &RuntimeTaskProjectionV1) {
    if delivery::ensure_current_scope(app, projection).is_ok() {
        let _ = app.emit(EVENT_NAME, projection);
    }
}

fn receipt_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .buzz_path()
        .app_data_dir()
        .map_err(|_| "runtime task receipt storage is unavailable".to_owned())?
        .join("luca")
        .join(RECEIPT_DIRECTORY);
    storage::prepare_private_directory(&directory)
        .map_err(|_| "prepare private runtime task receipt storage".to_owned())?;
    Ok(directory)
}

fn result_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .buzz_path()
        .app_data_dir()
        .map_err(|_| "runtime task result storage is unavailable".to_owned())?
        .join("luca")
        .join(RESULT_DIRECTORY);
    storage::prepare_private_directory(&directory)
        .map_err(|_| "prepare private runtime task result storage".to_owned())?;
    Ok(directory)
}

fn persist_projection(app: &AppHandle, projection: &RuntimeTaskProjectionV1) -> Result<(), String> {
    validate_opaque(&projection.task_id, 128, "task")?;
    let directory = receipt_directory(app)?;
    let path = directory.join(format!("{}.json", projection.task_id));
    let bytes =
        serde_json::to_vec(projection).map_err(|_| "encode runtime task receipt".to_owned())?;
    storage::atomic_write_private(&path, &bytes)
        .map_err(|_| "persist runtime task receipt".to_owned())
}

fn persist_result(app: &AppHandle, task_id: &str, result: &str) -> Result<(), String> {
    validate_opaque(task_id, 128, "task")?;
    let path = result_directory(app)?.join(format!("{task_id}.txt"));
    storage::atomic_write_private(&path, result.as_bytes())
        .map_err(|_| "persist runtime task result".to_owned())
}

fn load_result(app: &AppHandle, task_id: &str) -> Option<String> {
    validate_opaque(task_id, 128, "task").ok()?;
    let path = result_directory(app).ok()?.join(format!("{task_id}.txt"));
    let bytes = storage::read_bounded(&path, MAX_TEXT_BYTES).ok()?;
    if bytes.is_empty() {
        return None;
    }
    String::from_utf8(bytes).ok()
}

fn load_receipts(app: &AppHandle) -> Result<(), String> {
    // Serialize first load/profile changes without holding the task-memory lock
    // through disk enumeration. No caller may observe a half-loaded catalogue.
    static RECEIPT_LOAD: OnceLock<Mutex<()>> = OnceLock::new();
    let _load = RECEIPT_LOAD
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Runtime task receipt loading is unavailable.".to_owned())?;
    let owner = delegation::owner(app)?.as_str().to_owned();
    {
        let mut state = memory()
            .lock()
            .map_err(|_| "runtime task state is unavailable".to_owned())?;
        if state.receipts_loaded && state.owner_pubkey.as_deref() == Some(owner.as_str()) {
            return Ok(());
        }
        if state
            .owner_pubkey
            .as_deref()
            .is_some_and(|previous| previous != owner)
        {
            if !state.running.is_empty() {
                return Err("Tasks from the previous owner are still settling; their data cannot cross profiles.".into());
            }
            state.projections.clear();
            state.results.clear();
            state.task_inputs.clear();
        }
        state.owner_pubkey = Some(owner);
        state.receipts_loaded = false;
    }
    let result = load_receipts_once(app);
    if let Ok(mut state) = memory().lock() {
        state.receipts_loaded = result.is_ok();
    }
    result
}

fn load_receipts_once(app: &AppHandle) -> Result<(), String> {
    let owner = delegation::owner(app)?.as_str().to_owned();
    let directory = receipt_directory(app)?;
    let mut loaded = Vec::new();
    let paths = storage::newest_receipt_paths(&directory, MAX_RECEIPTS, MAX_TEXT_BYTES)
        .map_err(|_| "read runtime task receipts".to_owned())?;
    for path in paths {
        let Ok(bytes) = storage::read_bounded(&path, MAX_TEXT_BYTES) else {
            continue;
        };
        let Ok(mut projection) = serde_json::from_slice::<RuntimeTaskProjectionV1>(&bytes) else {
            continue;
        };
        if validate_opaque(&projection.task_id, 128, "task").is_err()
            || path.file_stem().and_then(|value| value.to_str())
                != Some(projection.task_id.as_str())
        {
            continue;
        }
        if !projection.owner_pubkey.is_empty() && projection.owner_pubkey != owner {
            continue;
        }
        // Legacy receipts predate owner scoping. They stay local to this data
        // profile and are attributed once on load; new receipts always bind it.
        if projection.owner_pubkey.is_empty() {
            projection.owner_pubkey = owner.clone();
            persist_projection(app, &projection)?;
        }
        projection.can_retry = false;
        if matches!(
            projection.state,
            RuntimeTaskStateV1::Queued | RuntimeTaskStateV1::Active | RuntimeTaskStateV1::Stopping
        ) {
            projection.state = RuntimeTaskStateV1::Interrupted;
            projection.current_step = None;
            projection.completed_at = Some(Utc::now().to_rfc3339());
            projection.updated_at = projection.completed_at.clone().unwrap_or_default();
            projection.error = Some(if projection.control_owner == RuntimeTaskControlOwnerV1::NativeApp {
                "Delivery was interrupted before a durable acknowledgement. Review the exact native chat; do not resend automatically."
            } else {
                "Polyphonic restarted before completion was verified. Review the native session; no replacement task was started."
            }.into());
            persist_projection(app, &projection)?;
        }
        loaded.push(projection);
    }
    loaded.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
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
            owner_pubkey: "33".repeat(32),
            origin_relay_ref: None,
            conversation_id: "conversation-1".into(),
            resident_pubkey: "11".repeat(32),
            runtime_family: "codex".into(),
            summary: "Inspect the project".into(),
            working_folder: "/tmp/project".into(),
            permission_mode: "normal".into(),
            operation: RuntimeTaskOperationV1::NewTask,
            control_owner: RuntimeTaskControlOwnerV1::Polyphonic,
            target_label: None,
            target_session_ref: None,
            target_source_ref: None,
            native_acknowledgement_id: None,
            delivery_state: None,
            delivery_can_retry: false,
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
            operation: RuntimeTaskOperationV1::NewTask,
            source_id: None,
            session_id: None,
            target_label: None,
            target_working_folder: None,
            created_at: "2026-09-01T00:00:00Z".into(),
        };
        let encoded = serde_json::to_value(&proposal).unwrap();
        assert!(encoded.get("task").is_none());
        assert!(encoded.get("prompt").is_none());
    }
}
