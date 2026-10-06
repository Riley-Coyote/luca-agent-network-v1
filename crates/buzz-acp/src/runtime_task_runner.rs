//! One explicit, desktop-confirmed provider root task.
//!
//! This is deliberately a mode of the existing ACP host, not a second task
//! engine. The desktop owns confirmation, receipts and cancellation. The ACP
//! adapter owns execution and the user's existing provider profile.

pub(crate) mod claude_peer;
mod claude_saved;
mod codex_cli;
mod codex_events;
mod native_isolation;

use std::{io::Read as _, time::Duration};

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};

use crate::{
    acp::{AcpClient, StopReason},
    config::{normalize_agent_args, PermissionMode, RuntimeTaskArgs},
    managed_mcp_provider,
    observer::{ObserverContext, ObserverHandle},
    pool::{agent_supports_mode, apply_permission_mode},
    runtime_session_purpose::{RuntimeSessionPurposeStore, RuntimeSessionPurposeV1},
};

const PROTOCOL: &str = "polyphonic.runtime-task.v1";
// JSON escaping can double a valid 64KiB instruction. Bound the encoded frame
// separately from the decoded instruction instead of truncating either.
const MAX_INPUT_BYTES: u64 = 160 * 1024;
// Shorter than AcpClient's internal best-effort wait: a stuck cleanup must
// fail closed here rather than return a successful terminal host event.
const SHUTDOWN_BOUND: Duration = Duration::from_secs(4);
const OBSERVER_DRAIN_BOUND: Duration = Duration::from_secs(1);

#[derive(Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum RuntimeTaskOperation {
    #[default]
    NewTask,
    ContinueSession,
    SendMessage,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeTaskInputV1 {
    task_id: String,
    conversation_id: String,
    prompt: String,
    working_folder: String,
    permission_mode: String,
    #[serde(default)]
    operation: RuntimeTaskOperation,
    provider_session_id: Option<String>,
    runtime_family: Option<String>,
    native_cli: Option<String>,
    native_permission_mode: Option<String>,
    native_target_pid: Option<u32>,
    native_target_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeTaskOutputV1<'a> {
    protocol: &'static str,
    kind: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_session_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stop_reason: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a str>,
}

pub(crate) async fn run(args: RuntimeTaskArgs) -> Result<()> {
    let input = read_input()?;
    validate_input(&input)?;
    if input.operation == RuntimeTaskOperation::SendMessage {
        return claude_peer::run(args, &input).await;
    }
    let claude_resume = input.operation == RuntimeTaskOperation::ContinueSession
        && input.runtime_family.as_deref() == Some("claude_code");
    if input.operation == RuntimeTaskOperation::ContinueSession && !claude_resume {
        // Only the desktop's separately verified saved-CLI target lane enters
        // here. App-owned work must use its native queue/controller, not this
        // subprocess as a replacement. In particular, do not initialize ACP,
        // adopt a resident context or install managed MCP servers for resume.
        return codex_cli::run(&args, &input).await;
    }
    let agent_args = normalize_agent_args(&args.agent.agent_command, args.agent.agent_args);
    // Install before creating the owned ACP child. A host's graceful TERM/INT
    // must enter cleanup instead of bypassing the client's Drop entirely.
    let mut signals = codex_cli::StopSignals::new()
        .map_err(|_| anyhow::anyhow!("runtime task cleanup handler is unavailable"))?;
    let observer = ObserverHandle::in_process();
    let observer_task = spawn_safe_observer(observer.clone());
    let mcp_servers = if claude_resume {
        Vec::new()
    } else {
        managed_mcp_provider::read_inherited_servers().unwrap_or_default()
    };
    let purpose_store = if claude_resume {
        None
    } else {
        Some(
            RuntimeSessionPurposeStore::from_environment()
                .map_err(anyhow::Error::msg)?
                .ok_or_else(|| anyhow::anyhow!("runtime session purpose store is unavailable"))?,
        )
    };

    let mut client = AcpClient::spawn_managed(&args.agent.agent_command, &agent_args, &[], false)
        .await
        .context("runtime adapter could not start")?;
    client.set_observer(Some(observer), 0);
    // A runtime task is not a conversation dispatch; it has no receipt, so a
    // permission raised inside one can only ever be answered Once.
    client.set_managed_turn_context(&input.task_id, Some(&input.conversation_id), None);
    client.set_observer_context(ObserverContext {
        channel_id: Some(input.conversation_id.clone()),
        session_id: None,
        turn_id: Some(input.task_id.clone()),
        started_at: Some(chrono::Utc::now().to_rfc3339()),
    });

    let provider_outcome = async {
        if claude_resume {
            claude_saved::ensure_unclaimed(
                input.native_cli.as_deref().unwrap_or_default(),
                input.provider_session_id.as_deref().unwrap_or_default(),
                &input.working_folder,
                None,
            )
            .await?;
        }
        client.initialize().await?;
        let session = if claude_resume {
            let (session, _) = client
                .session_restore_full_with_context(
                    input.provider_session_id.as_deref().unwrap_or_default(),
                    &input.working_folder,
                    &[],
                    Vec::new(),
                    None,
                    None,
                    true,
                )
                .await?;
            let mode = input.native_permission_mode.as_deref().unwrap_or_default();
            if !agent_supports_mode(&session.raw, mode) {
                return Err(crate::acp::AcpError::Protocol(
                    "saved native Claude permission policy is unsupported".into(),
                ));
            }
            client
                .session_set_native_mode(&session.session_id, mode)
                .await?;
            claude_saved::ensure_unclaimed(
                input.native_cli.as_deref().unwrap_or_default(),
                input.provider_session_id.as_deref().unwrap_or_default(),
                &input.working_folder,
                client.owned_process_id(),
            )
            .await?;
            session
        } else {
            client
            .session_new_full(
                &input.working_folder,
                mcp_servers,
                Some(
                    "You are running one explicit user-approved root task from Polyphonic. \
                     Complete only the requested task. Do not invoke or propose another runtime task.",
                ),
            )
            .await?
        };
        if let Some(purpose_store) = purpose_store {
            purpose_store
                .record_created(
                    &session.session_id,
                    RuntimeSessionPurposeV1::ExplicitRuntimeTask,
                )
                .map_err(crate::acp::AcpError::Protocol)?;
        }
        emit(RuntimeTaskOutputV1 {
            protocol: PROTOCOL,
            kind: "session",
            provider_session_id: Some(&session.session_id),
            label: None,
            result: None,
            stop_reason: None,
            error: None,
        });
        if input.permission_mode == "full_access" {
            let wire = PermissionMode::BypassPermissions.as_wire_str();
            if !agent_supports_mode(&session.raw, wire) {
                return Err(crate::acp::AcpError::Protocol(
                    "this adapter did not verify Full Access support".into(),
                ));
            }
            apply_permission_mode(
                &mut client,
                &session.session_id,
                &PermissionMode::BypassPermissions,
            )
            .await?;
        }
        client.begin_final_message_capture();
        let stop = client
            .session_prompt_with_idle_timeout(
                &session.session_id,
                &input.prompt,
                Duration::from_secs(args.idle_timeout_secs.clamp(30, 3_600)),
                Duration::from_secs(args.max_duration_secs.clamp(60, 604_800)),
            )
            .await?;
        let completed = stop == StopReason::EndTurn;
        let result = client
            .take_final_message_draft(completed)
            .transpose()
            .map_err(|_| {
                crate::acp::AcpError::Protocol(
                    "runtime task final output could not be assembled".into(),
                )
            })?
            .unwrap_or_default();
        Ok::<_, crate::acp::AcpError>((stop, result))
    };
    let outcome = tokio::select! {
        outcome = provider_outcome => outcome,
        () = signals.wait() => Err(crate::acp::AcpError::Protocol(
            "runtime task was interrupted".into(),
        )),
    };

    let shutdown = tokio::time::timeout(SHUTDOWN_BOUND, client.shutdown())
        .await
        .map_err(|_| cleanup_error());
    // The observer task holds only a receiver, not a sender. Detaching the
    // client's last sender closes the bus after its queued progress, which
    // must be drained and joined before any terminal result is emitted.
    client.set_observer(None, 0);
    let observer = finish_safe_observer(observer_task).await;
    let outcome = terminal_outcome(outcome, shutdown.and(observer));
    match outcome {
        Ok((stop, result)) => emit(RuntimeTaskOutputV1 {
            protocol: PROTOCOL,
            kind: "result",
            provider_session_id: None,
            label: None,
            result: Some(&result),
            stop_reason: Some(stop_reason(&stop)),
            error: None,
        }),
        Err(error) => {
            let message = safe_error(&error.to_string());
            emit(RuntimeTaskOutputV1 {
                protocol: PROTOCOL,
                kind: "failed",
                provider_session_id: None,
                label: None,
                result: None,
                stop_reason: None,
                error: Some(&message),
            });
        }
    }
    Ok(())
}

fn cleanup_error() -> crate::acp::AcpError {
    crate::acp::AcpError::Protocol("runtime task shutdown could not be verified".into())
}

fn terminal_outcome(
    outcome: Result<(StopReason, String), crate::acp::AcpError>,
    cleanup: Result<(), crate::acp::AcpError>,
) -> Result<(StopReason, String), crate::acp::AcpError> {
    // A completed provider turn is not a successful host terminal event when
    // our shutdown/drain fence failed. Never retain that candidate result.
    cleanup?;
    outcome
}

fn read_input() -> Result<RuntimeTaskInputV1> {
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(MAX_INPUT_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_INPUT_BYTES {
        anyhow::bail!("runtime task input is invalid");
    }
    serde_json::from_slice(&bytes).context("runtime task input is invalid")
}

fn validate_input(input: &RuntimeTaskInputV1) -> Result<()> {
    if !valid_opaque(&input.task_id)
        || !valid_opaque(&input.conversation_id)
        || input.prompt.trim().is_empty()
        || input.prompt.len() > 64 * 1024
        || input.working_folder.is_empty()
        || input.working_folder.len() > 4_096
        || !matches!(input.permission_mode.as_str(), "normal" | "full_access")
    {
        anyhow::bail!("runtime task input is invalid");
    }
    match input.operation {
        RuntimeTaskOperation::NewTask
            if input.provider_session_id.is_none()
                && input.runtime_family.is_none()
                && input.native_cli.is_none()
                && input.native_permission_mode.is_none()
                && input.native_target_pid.is_none()
                && input.native_target_name.is_none() => {}
        RuntimeTaskOperation::ContinueSession
            if input.permission_mode == "normal"
                && input
                    .provider_session_id
                    .as_deref()
                    .is_some_and(codex_cli::valid_session_id)
                && match input.runtime_family.as_deref() {
                    None | Some("codex") => {
                        input.native_cli.is_none() && input.native_permission_mode.is_none()
                    }
                    Some("claude_code") => {
                        input.native_cli.as_deref().is_some_and(|cli| {
                            cli.len() <= 4096
                                && !cli.chars().any(char::is_control)
                                && std::path::Path::new(cli).is_absolute()
                        }) && input
                            .native_permission_mode
                            .as_deref()
                            .is_some_and(claude_saved::known_mode)
                    }
                    _ => false,
                }
                && input.native_target_pid.is_none()
                && input.native_target_name.is_none() => {}
        RuntimeTaskOperation::SendMessage
            if input.permission_mode == "normal"
                && input.runtime_family.as_deref() == Some("claude_code")
                && input
                    .provider_session_id
                    .as_deref()
                    .is_some_and(codex_cli::valid_session_id)
                && input
                    .native_permission_mode
                    .as_deref()
                    .is_some_and(claude_saved::known_mode)
                && input.native_cli.as_deref().is_some_and(|cli| {
                    cli.len() <= 4096
                        && !cli.chars().any(char::is_control)
                        && std::path::Path::new(cli).is_absolute()
                })
                && input.native_target_pid.is_some_and(|pid| pid > 0)
                && input.native_target_name.as_deref().is_some_and(|name| {
                    !name.trim().is_empty()
                        && name.len() <= 160
                        && !name.chars().any(char::is_control)
                }) => {}
        _ => anyhow::bail!("runtime task input is invalid"),
    }
    Ok(())
}

fn valid_opaque(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn spawn_safe_observer(observer: ObserverHandle) -> tokio::task::JoinHandle<()> {
    spawn_safe_observer_with(observer, |label| {
        emit(RuntimeTaskOutputV1 {
            protocol: PROTOCOL,
            kind: "step",
            provider_session_id: None,
            label: Some(label),
            result: None,
            stop_reason: None,
            error: None,
        });
    })
}

fn spawn_safe_observer_with(
    observer: ObserverHandle,
    mut emit_label: impl FnMut(&'static str) + Send + 'static,
) -> tokio::task::JoinHandle<()> {
    // Subscribe before spawning, so even progress emitted before the task's
    // first poll is queued. Do not capture the sender in the task: dropping
    // the client's observer must actually close and drain this receiver.
    let mut receiver = observer.subscribe();
    tokio::spawn(async move {
        let mut last_label = None;
        loop {
            let event = match receiver.recv().await {
                Ok(event) => event,
                // Observer progress is best effort. A lagged receiver still
                // drains newer safe labels; lag must not look like closure.
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            };
            let Some(label) = safe_step(&event) else {
                continue;
            };
            if last_label == Some(label) {
                continue;
            }
            last_label = Some(label);
            emit_label(label);
        }
    })
}

async fn finish_safe_observer(
    mut task: tokio::task::JoinHandle<()>,
) -> Result<(), crate::acp::AcpError> {
    match tokio::time::timeout(OBSERVER_DRAIN_BOUND, &mut task).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => Err(cleanup_error()),
        Err(_) => {
            task.abort();
            // Abort alone does not fence output. Join even the aborted task,
            // so no scheduled progress can appear after a terminal event.
            let _ = task.await;
            Err(cleanup_error())
        }
    }
}

fn safe_step(event: &crate::observer::ObserverEvent) -> Option<&'static str> {
    if event.kind != "acp_read" {
        return None;
    }
    let update = event.payload.pointer("/params/update")?;
    match update.get("sessionUpdate")?.as_str()? {
        "plan" => Some("Planning the work"),
        "agent_message_chunk" => Some("Writing the result"),
        "tool_call" | "tool_call_update" => {
            let name = update
                .get("kind")
                .or_else(|| update.get("title"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_ascii_lowercase();
            if name.contains("search") || name.contains("web") {
                Some("Searching the web")
            } else if name.contains("read") {
                Some("Reading files")
            } else if name.contains("edit") || name.contains("write") {
                Some("Editing files")
            } else if name.contains("agent") || name.contains("task") {
                Some("Delegating work")
            } else {
                Some("Using a tool")
            }
        }
        _ => None,
    }
}

fn stop_reason(reason: &StopReason) -> &'static str {
    match reason {
        StopReason::EndTurn => "end_turn",
        StopReason::Cancelled => "cancelled",
        StopReason::MaxTokens => "max_tokens",
        StopReason::MaxTurnRequests => "max_turn_requests",
        StopReason::Refusal => "refusal",
    }
}

fn safe_error(error: &str) -> String {
    let lower = error.to_ascii_lowercase();
    if lower.contains("already has an active controller") {
        "This Claude session is open in another controller. Send a follow-up there or close it before continuing; nothing was sent.".into()
    } else if lower.contains("availability") {
        "Native Claude availability could not be verified. Inspect the selected session in Claude Code before another request.".into()
    } else if lower.contains("native claude permission policy") {
        "This session's native permission policy could not be preserved. Review it in Claude Code; no replacement policy was chosen.".into()
    } else if lower.contains("working folder changed") {
        "The selected native session's working folder changed. Refresh session lookup and select the intended project.".into()
    } else if lower.contains("permission") {
        "The runtime task stopped at its permission boundary.".into()
    } else if lower.contains("timed out") || lower.contains("timeout") {
        "The runtime task timed out.".into()
    } else if lower.contains("adapter") || lower.contains("spawn") {
        "The runtime adapter could not start.".into()
    } else {
        "The runtime task could not complete.".into()
    }
}

fn emit(output: RuntimeTaskOutputV1<'_>) {
    if let Ok(line) = serde_json::to_string(&output) {
        println!("{line}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_are_body_free() {
        assert_eq!(
            safe_error("permission request contained PRIVATE_PROMPT"),
            "The runtime task stopped at its permission boundary."
        );
    }

    #[test]
    fn recursive_or_malformed_coordinates_are_rejected() {
        assert!(!valid_opaque("task id with spaces"));
        assert!(valid_opaque("task:1234-abcd"));
    }

    #[test]
    fn existing_input_defaults_to_unchanged_acp_new_task_operation() {
        let input: RuntimeTaskInputV1 = serde_json::from_value(serde_json::json!({
            "taskId": "task:old",
            "conversationId": "conversation:old",
            "prompt": "SYNTHETIC_TASK",
            "workingFolder": "/synthetic/folder",
            "permissionMode": "full_access",
        }))
        .expect("legacy input");
        assert_eq!(input.operation, RuntimeTaskOperation::NewTask);
        assert!(input.provider_session_id.is_none());
        assert!(validate_input(&input).is_ok());
    }

    #[test]
    fn continuation_input_requires_native_id_normal_policy_and_explicit_operation() {
        let mut value = serde_json::json!({
            "taskId": "task:continue",
            "conversationId": "conversation:continue",
            "prompt": "SYNTHETIC_TASK",
            "workingFolder": "/synthetic/folder",
            "permissionMode": "normal",
            "operation": "continue_session",
            "providerSessionId": "01a1083a-f0f0-76a3-b1d9-c0268a062636",
        });
        let input: RuntimeTaskInputV1 = serde_json::from_value(value.clone()).expect("valid input");
        assert!(validate_input(&input).is_ok());
        value["permissionMode"] = serde_json::json!("full_access");
        let input: RuntimeTaskInputV1 = serde_json::from_value(value.clone()).expect("input shape");
        assert!(validate_input(&input).is_err());
        value["permissionMode"] = serde_json::json!("normal");
        for id in [serde_json::Value::Null, serde_json::json!("--last")] {
            value["providerSessionId"] = id;
            let input: RuntimeTaskInputV1 =
                serde_json::from_value(value.clone()).expect("input shape");
            assert!(validate_input(&input).is_err());
        }
        value["providerSessionId"] = serde_json::json!("01a1083a-f0f0-76a3-b1d9-c0268a062636");
        value["operation"] = serde_json::json!("new_task");
        let input: RuntimeTaskInputV1 = serde_json::from_value(value.clone()).expect("input shape");
        assert!(validate_input(&input).is_err());
        value["operation"] = serde_json::json!("fork");
        assert!(serde_json::from_value::<RuntimeTaskInputV1>(value).is_err());
    }
}

#[cfg(test)]
#[path = "runtime_task_runner/legacy_cleanup_tests.rs"]
mod legacy_cleanup_tests;
