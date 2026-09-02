//! One explicit, desktop-confirmed provider root task.
//!
//! This is deliberately a mode of the existing ACP host, not a second task
//! engine. The desktop owns confirmation, receipts and cancellation. The ACP
//! adapter owns execution and the user's existing provider profile.

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
const MAX_INPUT_BYTES: u64 = 72 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeTaskInputV1 {
    task_id: String,
    conversation_id: String,
    prompt: String,
    working_folder: String,
    permission_mode: String,
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
    let agent_args = normalize_agent_args(&args.agent.agent_command, args.agent.agent_args);
    let observer = ObserverHandle::in_process();
    let observer_task = spawn_safe_observer(observer.clone());
    let mcp_servers = managed_mcp_provider::read_inherited_servers().unwrap_or_default();
    let purpose_store = RuntimeSessionPurposeStore::from_environment()
        .map_err(anyhow::Error::msg)?
        .ok_or_else(|| anyhow::anyhow!("runtime session purpose store is unavailable"))?;

    let mut client = AcpClient::spawn_managed(&args.agent.agent_command, &agent_args, &[], false)
        .await
        .context("runtime adapter could not start")?;
    client.set_observer(Some(observer), 0);
    client.set_managed_turn_context(&input.task_id, Some(&input.conversation_id));
    client.set_observer_context(ObserverContext {
        channel_id: Some(input.conversation_id.clone()),
        session_id: None,
        turn_id: Some(input.task_id.clone()),
        started_at: Some(chrono::Utc::now().to_rfc3339()),
    });

    let outcome = async {
        client.initialize().await?;
        let session = client
            .session_new_full(
                &input.working_folder,
                mcp_servers,
                Some(
                    "You are running one explicit user-approved root task from Polyphonic. \
                     Complete only the requested task. Do not invoke or propose another runtime task.",
                ),
            )
            .await?;
        purpose_store
            .record_created(
                &session.session_id,
                RuntimeSessionPurposeV1::ExplicitRuntimeTask,
            )
            .map_err(crate::acp::AcpError::Protocol)?;
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
    }
    .await;

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
    client.shutdown().await;
    observer_task.abort();
    Ok(())
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
    tokio::spawn(async move {
        let mut receiver = observer.subscribe();
        let mut last_label = None;
        while let Ok(event) = receiver.recv().await {
            let Some(label) = safe_step(&event) else {
                continue;
            };
            if last_label == Some(label) {
                continue;
            }
            last_label = Some(label);
            emit(RuntimeTaskOutputV1 {
                protocol: PROTOCOL,
                kind: "step",
                provider_session_id: None,
                label: Some(label),
                result: None,
                stop_reason: None,
                error: None,
            });
        }
    })
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
    if lower.contains("permission") {
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
}
