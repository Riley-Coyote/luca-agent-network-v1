//! Verified native dispatch lanes. Native app work stays externally owned.

use std::collections::HashSet;

use luca_protocol::{BrainGrantStateV1, Hex64, OpaqueId};
use tokio::io::AsyncReadExt as _;

use super::targets::{RuntimeTaskExistingTargetV1, RuntimeTaskTargetSourceV1};
use super::*;

const CONTROL_OUTPUT_BYTES: usize = 64 * 1024;
const CONTROL_TIMEOUT: Duration = Duration::from_secs(20);

pub(super) fn owner(app: &AppHandle) -> Result<Hex64, String> {
    Hex64::parse(
        app.state::<crate::app_state::AppState>()
            .signing_keys()?
            .public_key()
            .to_hex(),
    )
    .map_err(|_| "active owner identity is invalid".into())
}

pub(super) fn authorized_source(
    app: &AppHandle,
    resident: &str,
    source_id: &OpaqueId,
) -> Result<RuntimeTaskTargetSourceV1, String> {
    let owner = owner(app)?;
    let resident = Hex64::parse(resident.to_ascii_lowercase())
        .map_err(|_| "task resident identity is invalid".to_owned())?;
    let (binding, egress) =
        crate::managed_agents::current_owner_brain_runtime_authority(app, &resident)?;
    let state = app.state::<crate::app_state::AppState>();
    let (catalog, candidate) = state
        .try_read_connected_brain_catalog_and_candidate(&owner, source_id)
        .map_err(|_| "Connected session authority is unavailable.".to_owned())?
        .ok_or_else(|| "Connected session authority is busy; try again.".to_owned())?;
    let summary = catalog
        .sources
        .iter()
        .find(|entry| entry.source.source_id == *source_id && entry.source.owner_pubkey == owner)
        .ok_or_else(|| "The selected session source is not connected for this owner.".to_owned())?;
    let granted = catalog.recall_grants.iter().any(|entry| {
        entry.source_id == *source_id
            && entry.grant.owner_pubkey == owner
            && entry.grant.resident_pubkey == resident
            && super::super::owner_brain_store::effective_grant_state(
                &entry.grant,
                Some(&binding),
                Some(egress),
            ) == BrainGrantStateV1::Active
    });
    if !granted {
        return Err("This resident needs current access to the selected session source before proposing control.".into());
    }
    Ok(RuntimeTaskTargetSourceV1 {
        source_id: source_id.clone(),
        source_kind: candidate.source_kind,
        canonical_root: candidate.canonical_root,
        status: summary.source.status,
    })
}

fn exclusions(app: &AppHandle, runtime: &str) -> Result<HashSet<String>, String> {
    let root = app
        .buzz_path()
        .app_data_dir()
        .map_err(|_| "Local session purpose storage is unavailable.".to_owned())?;
    super::super::runtime_session_purpose::exclusions_before(
        &root,
        runtime,
        Instant::now() + Duration::from_secs(2),
    )
}

#[allow(clippy::too_many_arguments)] // Keep exact target and conversation authority explicit.
pub(super) fn resolve_target(
    app: &AppHandle,
    resident: &str,
    conversation: &str,
    runtime: &str,
    operation: RuntimeTaskOperationV1,
    source_id: Option<&str>,
    session_id: Option<&str>,
    folder: Option<&Path>,
) -> Result<RuntimeTaskExistingTargetV1, String> {
    let source_id = OpaqueId::parse(source_id.unwrap_or_default().to_owned()).map_err(|_| {
        "Choose an exact session source returned by native session lookup.".to_owned()
    })?;
    let session_id = OpaqueId::parse(session_id.unwrap_or_default().to_owned()).map_err(|_| {
        "Choose an exact session; titles or latest-session guesses cannot dispatch.".to_owned()
    })?;
    let source = if native_sources::is_native_source(&source_id) {
        native_sources::resolve_source(app, resident, conversation, &source_id, &session_id)?
    } else {
        authorized_source(app, resident, &source_id)?
    };
    let target = targets::resolve_connected_session_target(
        &source,
        &session_id,
        runtime,
        folder,
        &exclusions(app, runtime)?,
    )?;
    validate_operation(&target, operation)?;
    validate_default_profile(&source)?;
    validate_working_folder(&target.canonical_working_folder)?;
    Ok(target)
}

pub(super) fn revalidate_target(
    app: &AppHandle,
    resident: &str,
    conversation: &str,
    target: &RuntimeTaskExistingTargetV1,
    operation: RuntimeTaskOperationV1,
) -> Result<(), String> {
    let source = if native_sources::is_native_source(&target.source_id) {
        native_sources::resolve_source(
            app,
            resident,
            conversation,
            &target.source_id,
            &target.session_ref,
        )?
    } else {
        authorized_source(app, resident, &target.source_id)?
    };
    let current = targets::revalidate_connected_session_target(
        &source,
        target,
        Some(&target.canonical_working_folder),
        &exclusions(app, &target.runtime_family)?,
    )?;
    validate_operation(&current, operation)?;
    validate_default_profile(&source)
}

fn validate_operation(
    target: &RuntimeTaskExistingTargetV1,
    operation: RuntimeTaskOperationV1,
) -> Result<(), String> {
    match operation {
        RuntimeTaskOperationV1::SendMessage => target.require_codex_app_queue(),
        RuntimeTaskOperationV1::ContinueSession => target.require_saved_codex_cli(),
        RuntimeTaskOperationV1::NewTask => {
            Err("An existing target cannot be used as a new task.".into())
        }
    }
}

fn validate_default_profile(source: &RuntimeTaskTargetSourceV1) -> Result<(), String> {
    // Do not point the default CLI at an unrelated imported/backup profile.
    // Supporting another profile requires separately verified native routing.
    let expected = native_sources::current_profile_root("codex")?;
    if source.canonical_root != expected {
        return Err("The selected source is not the CLI's current native profile; review it in the native app.".into());
    }
    Ok(())
}

fn scrub_resident_environment(command: &mut Command) {
    for (key, _) in std::env::vars_os() {
        if key.to_str().is_some_and(|value| {
            value.starts_with("LUCA_")
                || value.starts_with("BUZZ_")
                || matches!(
                    value,
                    "NOSTR_PRIVATE_KEY" | "CODEX_CONFIG" | "INITIAL_AGENT_MODE"
                )
        }) {
            command.env_remove(key);
        }
    }
}

async fn bounded_control(mut command: Command) -> Result<(bool, String), String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    scrub_resident_environment(&mut command);
    let mut child = command
        .spawn()
        .map_err(|_| "Native Codex control could not start.".to_owned())?;
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        stop_control_child(&mut child).await;
        return Err("Native Codex control output is unavailable.".into());
    };
    let operation = async {
        let stdout = async {
            let mut bytes = Vec::new();
            stdout
                .take((CONTROL_OUTPUT_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .await?;
            Ok::<_, std::io::Error>(bytes)
        };
        let stderr = async {
            let mut bytes = Vec::new();
            stderr
                .take((CONTROL_OUTPUT_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .await?;
            Ok::<_, std::io::Error>(bytes)
        };
        let (out, err) = tokio::try_join!(stdout, stderr)
            .map_err(|_| "Native Codex control output was lost.".to_owned())?;
        if out.len() > CONTROL_OUTPUT_BYTES || err.len() > CONTROL_OUTPUT_BYTES {
            return Err("Native Codex control output exceeded its bound.".into());
        }
        let status = child
            .wait()
            .await
            .map_err(|_| "Native Codex control acknowledgement was lost.".to_owned())?;
        let out = String::from_utf8(out)
            .map_err(|_| "Native Codex control acknowledgement is invalid.".to_owned())?;
        Ok((status.success(), out))
    };
    let outcome = match tokio::time::timeout(CONTROL_TIMEOUT, operation).await {
        Ok(result) => result,
        Err(_) => Err("Native Codex control timed out; delivery may be uncertain.".into()),
    };
    if outcome.is_err() {
        stop_control_child(&mut child).await;
    }
    outcome
}

async fn stop_control_child(child: &mut Child) {
    if let Some(pid) = child.id() {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            crate::managed_agents::terminate_process(pid)
        })
        .await;
    }
    let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
}

async fn native_cli(operation: RuntimeTaskOperationV1, folder: &Path) -> Result<PathBuf, String> {
    let runtime = crate::managed_agents::known_acp_runtime_exact("codex")
        .ok_or_else(|| "Native Codex discovery is unavailable.".to_owned())?;
    let resolution = tauri::async_runtime::spawn_blocking(move || {
        crate::managed_agents::resolve_runtime_cli(runtime)
    })
    .await
    .map_err(|_| "Native Codex discovery is unavailable.".to_owned())?;
    let executable = resolution
        .path
        .ok_or_else(|| "Install or update the native Codex CLI before dispatching.".to_owned())?;
    let mut probe = Command::new(&executable);
    probe.current_dir(folder);
    let required = if operation == RuntimeTaskOperationV1::SendMessage {
        probe.args(["queue", "--help"]);
        &["--thread", "--message"][..]
    } else {
        probe.args(["exec", "resume", "--help"]);
        &["SESSION_ID", "PROMPT", "--json"][..]
    };
    let (success, help) = bounded_control(probe).await?;
    if !success || !required.iter().all(|flag| help.contains(flag)) {
        return Err(
            "This native Codex version does not expose the required verified operation.".into(),
        );
    }
    Ok(executable)
}

fn queue_acknowledgement(output: &str, target: Uuid) -> Result<String, String> {
    let mut acknowledgements = output
        .lines()
        .filter_map(|line| line.trim().strip_prefix("Queued message "));
    let value = acknowledgements
        .next()
        .ok_or_else(|| "Native queued-message acknowledgement is missing.".to_owned())?;
    if acknowledgements.next().is_some() {
        return Err("Native queue acknowledgement is ambiguous.".into());
    }
    // The verified public 0.160 CLI ends this acknowledgement with a period.
    // Also accept the earlier fixture shape, but never arbitrary suffix text.
    let value = value.strip_suffix('.').unwrap_or(value);
    let (message, thread) = value
        .split_once(" for thread ")
        .ok_or_else(|| "Native queue acknowledgement is invalid.".to_owned())?;
    let message = Uuid::parse_str(message)
        .map_err(|_| "Native queue acknowledgement is invalid.".to_owned())?;
    let thread = Uuid::parse_str(thread)
        .map_err(|_| "Native queue target acknowledgement is invalid.".to_owned())?;
    if message.is_nil() || thread != target {
        return Err("Native queue acknowledgement did not match the selected session.".into());
    }
    Ok(message.to_string())
}

pub(super) async fn start_existing(
    app: AppHandle,
    input: StartRuntimeTaskInputV1,
    retry_of_task_id: Option<String>,
) -> Result<RuntimeTaskProjectionV1, String> {
    let dispatch_owner = owner(&app)?;
    if retry_of_task_id.is_some() || input.permission_mode != "normal" {
        return Err(
            "Existing native work preserves its permission policy and cannot be blindly retried."
                .into(),
        );
    }
    let target = resolve_target(
        &app,
        &input.resident_pubkey,
        &input.conversation_id,
        &input.runtime_family,
        input.operation,
        input.source_id.as_deref(),
        input.session_id.as_deref(),
        Some(Path::new(&input.working_folder)),
    )?;
    let executable = native_cli(input.operation, &target.canonical_working_folder).await?;
    revalidate_target(
        &app,
        &input.resident_pubkey,
        &input.conversation_id,
        &target,
        input.operation,
    )?;
    if owner(&app)? != dispatch_owner {
        return Err("The active owner changed before dispatch. Nothing ran.".into());
    }
    let now = Utc::now().to_rfc3339();
    let mut projection = RuntimeTaskProjectionV1 {
        task_id: Uuid::new_v4().to_string(),
        owner_pubkey: dispatch_owner.as_str().to_owned(),
        origin_relay_ref: Some(delivery::current_origin(&app)?.0),
        conversation_id: input.conversation_id.clone(),
        resident_pubkey: input.resident_pubkey.to_ascii_lowercase(),
        runtime_family: target.runtime_family.clone(),
        summary: bounded_single_line(&input.summary, 240, "task summary")?,
        working_folder: target
            .canonical_working_folder
            .to_string_lossy()
            .into_owned(),
        permission_mode: "normal".into(),
        operation: input.operation,
        control_owner: if input.operation == RuntimeTaskOperationV1::SendMessage {
            RuntimeTaskControlOwnerV1::NativeApp
        } else {
            RuntimeTaskControlOwnerV1::Polyphonic
        },
        target_label: Some(target.label.clone()),
        target_session_ref: Some(target.session_ref.as_str().to_owned()),
        target_source_ref: Some(target.source_id.as_str().to_owned()),
        native_acknowledgement_id: None,
        delivery_state: None,
        delivery_can_retry: false,
        state: RuntimeTaskStateV1::Queued,
        provider_session_id: Some(target.provider_session_id.to_string()),
        current_step: Some("Dispatching to the selected native session".into()),
        completed_steps: 0,
        steps: Vec::new(),
        started_at: now.clone(),
        updated_at: now,
        completed_at: None,
        error: None,
        can_retry: false,
        retry_of_task_id: None,
    };
    // Resolve and encode everything before intent. A missing host or malformed
    // input must never leave a queued receipt for work that cannot dispatch.
    let owned_dispatch = if input.operation == RuntimeTaskOperationV1::ContinueSession {
        let host = crate::managed_agents::resolve_command("buzz-acp")
            .ok_or_else(|| "Polyphonic's native task host is unavailable.".to_owned())?;
        let mut process = Command::new(host);
        process
            .arg("runtime-task")
            .current_dir(&target.canonical_working_folder)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        scrub_resident_environment(&mut process);
        process
            .env("BUZZ_ACP_AGENT_COMMAND", &executable)
            .env("BUZZ_ACP_AGENT_ARGS", "");
        #[cfg(unix)]
        process.process_group(0);
        let encoded = serde_json::to_vec(&serde_json::json!({
            "taskId": projection.task_id, "conversationId": projection.conversation_id,
            "prompt": input.prompt, "workingFolder": projection.working_folder,
            "permissionMode": "normal", "operation": "continue_session",
            "providerSessionId": target.provider_session_id.to_string(),
        }))
        .map_err(|_| "Native task input could not be encoded.".to_owned())?;
        Some((process, encoded))
    } else {
        None
    };
    // This is an in-app exclusion, not ownership over a native client's work.
    {
        let mut state = memory()
            .lock()
            .map_err(|_| "Runtime task state is unavailable.".to_owned())?;
        if state.owner_pubkey.as_deref() != Some(projection.owner_pubkey.as_str()) {
            return Err("The active owner changed before dispatch. Nothing ran.".into());
        }
        if state.projections.values().any(|task| {
            task.owner_pubkey == projection.owner_pubkey
                && task.provider_session_id == projection.provider_session_id
                && task.runtime_family == projection.runtime_family
                && matches!(
                    task.state,
                    RuntimeTaskStateV1::Queued
                        | RuntimeTaskStateV1::Active
                        | RuntimeTaskStateV1::Stopping
                        | RuntimeTaskStateV1::Interrupted
                )
        }) {
            return Err("This exact session has active or uncertain Polyphonic work; review its receipt before another dispatch.".into());
        }
        delivery::ensure_current_scope(&app, &projection)?;
        if app
            .state::<crate::app_state::AppState>()
            .shutdown_started
            .load(std::sync::atomic::Ordering::Acquire)
        {
            return Err("The app is shutting down. Nothing ran.".into());
        }
        if input.operation == RuntimeTaskOperationV1::SendMessage {
            persist_projection(&app, &projection)?;
            state
                .projections
                .insert(projection.task_id.clone(), projection.clone());
        }
    }
    if input.operation == RuntimeTaskOperationV1::SendMessage {
        emit_projection_in_scope(&app, &projection);
        let mut command = Command::new(executable);
        command
            .current_dir(&target.canonical_working_folder)
            .args(["queue", "--thread"])
            .arg(target.provider_session_id.to_string())
            .arg("--message")
            .arg(&input.prompt);
        let outcome = bounded_control(command).await.and_then(|(success, output)| {
            if !success { return Err("Native Codex did not acknowledge delivery; inspect the exact chat before resending.".into()); }
            queue_acknowledgement(&output, target.provider_session_id)
        });
        match outcome {
            Ok(ack) => {
                projection.state = RuntimeTaskStateV1::AwaitingNative;
                projection.native_acknowledgement_id = Some(ack);
                projection.current_step = Some(
                    "Queued in Codex; progress, questions and stopping remain in Codex".into(),
                );
            }
            Err(_) => {
                projection.state = RuntimeTaskStateV1::Interrupted;
                projection.current_step = None;
                projection.error = Some("Delivery could not be confirmed. Review the selected chat in Codex; Polyphonic will not resend automatically.".into());
            }
        }
        projection.updated_at = Utc::now().to_rfc3339();
        update_projection(&app, &projection)?;
        return Ok(projection);
    }
    let (process, encoded) = owned_dispatch.ok_or_else(|| {
        "The requested native operation was not prepared. Nothing ran.".to_owned()
    })?;
    execution::launch_owned_task(app, projection, process, encoded, None, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_ack_is_correlated_and_never_implies_completion() {
        let target = Uuid::new_v4();
        let ack = Uuid::new_v4();
        let line = format!("Queued message {ack} for thread {target}\n");
        assert_eq!(
            queue_acknowledgement(&line, target).unwrap(),
            ack.to_string()
        );
        assert!(queue_acknowledgement(&line, Uuid::new_v4()).is_err());
        assert!(queue_acknowledgement("success", target).is_err());
        assert!(queue_acknowledgement(&format!("{line}{line}"), target).is_err());
        assert!(queue_acknowledgement(
            &format!("Queued message {} for thread {target}", Uuid::nil()),
            target
        )
        .is_err());
    }

    #[test]
    fn actual_native_queue_acknowledgement_keeps_the_exact_target() {
        let target = Uuid::parse_str("01a1082d-50c1-7d03-a5f4-ca00e0361a78").unwrap();
        let ack = "01a10929-2076-7320-bd6a-0286709cc5c7";
        let line = format!("Queued message {ack} for thread {target}.\n");
        assert_eq!(queue_acknowledgement(&line, target).unwrap(), ack);
        for suffix in ["..", ". extra", ",", "!"] {
            assert!(queue_acknowledgement(
                &format!("Queued message {ack} for thread {target}{suffix}"),
                target
            )
            .is_err());
        }
    }
}
