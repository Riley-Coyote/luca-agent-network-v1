use std::time::Duration;

use chrono::Utc;
use serde::Serialize;
use tauri::AppHandle;

use crate::{
    luca::mcp_registry::{
        self, LucaMcpRegistryV1, McpConnectionHealthV1, McpReadinessV1,
        SaveLucaMcpConnectionInputV1,
    },
    managed_agents::{
        AcpAvailabilityStatus, AuthStatus, NativeDiscoveryStatus, NativeRuntimeKind,
    },
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeReadinessV1 {
    Ready,
    Degraded,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeAuthenticationV1 {
    Ready,
    Required,
    Unknown,
    NotApplicable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConnectionStatusV1 {
    runtime_id: String,
    label: String,
    executable: Option<String>,
    version: Option<String>,
    readiness: RuntimeReadinessV1,
    authentication: RuntimeAuthenticationV1,
    last_verified_at: Option<String>,
    reason: Option<String>,
}

#[tauri::command]
pub async fn list_luca_mcp_registry(app: AppHandle) -> Result<LucaMcpRegistryV1, String> {
    tokio::task::spawn_blocking(move || mcp_registry::load_registry(&app))
        .await
        .map_err(|_| "MCP registry task failed".to_string())?
}

#[tauri::command]
pub async fn save_luca_mcp_connection(
    app: AppHandle,
    input: SaveLucaMcpConnectionInputV1,
) -> Result<LucaMcpRegistryV1, String> {
    tokio::task::spawn_blocking(move || mcp_registry::save_connection(&app, input))
        .await
        .map_err(|_| "MCP registry task failed".to_string())?
}

#[tauri::command]
pub async fn delete_luca_mcp_connection(
    app: AppHandle,
    connection_id: String,
) -> Result<LucaMcpRegistryV1, String> {
    tokio::task::spawn_blocking(move || mcp_registry::delete_connection(&app, &connection_id))
        .await
        .map_err(|_| "MCP registry task failed".to_string())?
}

#[tauri::command]
pub async fn set_agent_mcp_grant(
    app: AppHandle,
    connection_id: String,
    resident_pubkey: String,
    granted: bool,
) -> Result<LucaMcpRegistryV1, String> {
    tokio::task::spawn_blocking(move || {
        mcp_registry::set_grant(&app, &connection_id, &resident_pubkey, granted)
    })
    .await
    .map_err(|_| "MCP grant task failed".to_string())?
}

#[tauri::command]
pub async fn test_luca_mcp_connection(
    app: AppHandle,
    connection_id: String,
) -> Result<McpConnectionHealthV1, String> {
    let resolved = {
        let app = app.clone();
        let connection_id = connection_id.clone();
        tokio::task::spawn_blocking(move || {
            mcp_registry::resolve_connection(&app, &connection_id)
        })
        .await
        .map_err(|_| "MCP connection test task failed".to_string())?
    };
    let tested_at = Utc::now().to_rfc3339();
    let health = match resolved {
        Ok(server) => {
            let spec = buzz_agent_pkg::types::McpServerStdio {
                name: server.name,
                command: server.command,
                args: server.args,
                env: server
                    .environment
                    .into_iter()
                    .map(|(name, value)| buzz_agent_pkg::types::EnvVar { name, value })
                    .collect(),
            };
            let cwd = dirs::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("/"))
                .to_string_lossy()
                .to_string();
            match buzz_agent_pkg::probe_stdio_server(&spec, &cwd, Duration::from_secs(10)).await {
                Ok(tools) => McpConnectionHealthV1 {
                    connection_id: connection_id.clone(),
                    readiness: McpReadinessV1::Ready,
                    tool_count: Some(tools.len().min(u32::MAX as usize) as u32),
                    last_tested_at: Some(tested_at),
                    error_code: None,
                    diagnostic: Some("MCP initialize and tools/list succeeded.".into()),
                },
                Err(_) => McpConnectionHealthV1 {
                    connection_id: connection_id.clone(),
                    readiness: McpReadinessV1::Failed,
                    tool_count: None,
                    last_tested_at: Some(tested_at),
                    error_code: Some("MCP_TEST_FAILED".into()),
                    diagnostic: Some("MCP initialize or tools/list failed.".into()),
                },
            }
        }
        Err(error) => McpConnectionHealthV1 {
            connection_id: connection_id.clone(),
            readiness: if error.to_ascii_lowercase().contains("locked")
                || error.to_ascii_lowercase().contains("keychain")
            {
                McpReadinessV1::Locked
            } else {
                McpReadinessV1::Failed
            },
            tool_count: None,
            last_tested_at: Some(tested_at),
            error_code: Some(if error.to_ascii_lowercase().contains("locked") {
                "MCP_SECRET_LOCKED".into()
            } else {
                "MCP_CONNECTION_INVALID".into()
            }),
            diagnostic: Some("MCP connection could not be prepared.".into()),
        },
    };
    let app_for_store = app.clone();
    tokio::task::spawn_blocking(move || mcp_registry::set_health(&app_for_store, health))
        .await
        .map_err(|_| "MCP health task failed".to_string())?
}

#[tauri::command]
pub async fn list_runtime_connection_status() -> Result<Vec<RuntimeConnectionStatusV1>, String> {
    tokio::task::spawn_blocking(|| {
        crate::managed_agents::clear_resolve_cache();
        crate::managed_agents::refresh_login_shell_path();
        let verified_at = Utc::now().to_rfc3339();
        let mut statuses = crate::managed_agents::discover_acp_runtimes()
            .into_iter()
            .filter(|runtime| runtime.id == "claude-code" || runtime.id == "codex")
            .map(|runtime| {
                let readiness = match runtime.availability {
                    AcpAvailabilityStatus::Available => RuntimeReadinessV1::Ready,
                    AcpAvailabilityStatus::AdapterOutdated => RuntimeReadinessV1::Degraded,
                    _ => RuntimeReadinessV1::Unavailable,
                };
                let authentication = match runtime.auth_status {
                    AuthStatus::LoggedIn => RuntimeAuthenticationV1::Ready,
                    AuthStatus::LoggedOut | AuthStatus::ConfigInvalid { .. } => {
                        RuntimeAuthenticationV1::Required
                    }
                    AuthStatus::NotApplicable => RuntimeAuthenticationV1::NotApplicable,
                    AuthStatus::Unknown => RuntimeAuthenticationV1::Unknown,
                };
                let ready = matches!(readiness, RuntimeReadinessV1::Ready);
                RuntimeConnectionStatusV1 {
                    runtime_id: if runtime.id == "claude-code" {
                        "claude_code".into()
                    } else {
                        runtime.id.clone()
                    },
                    label: runtime.label,
                    executable: runtime.binary_path.or(runtime.underlying_cli_path),
                    version: None,
                    readiness,
                    authentication,
                    last_verified_at: ready.then(|| verified_at.clone()),
                    reason: (!ready).then(|| runtime.install_hint),
                }
            })
            .collect::<Vec<_>>();

        for runtime in crate::managed_agents::discover_native_resident_outcome().runtimes {
            let (runtime_id, label) = match runtime.native_type {
                NativeRuntimeKind::Hermes => ("hermes", "Hermes"),
                NativeRuntimeKind::Openclaw => ("openclaw", "OpenClaw"),
            };
            let readiness = match runtime.status {
                NativeDiscoveryStatus::Available => RuntimeReadinessV1::Ready,
                NativeDiscoveryStatus::Degraded => RuntimeReadinessV1::Degraded,
                NativeDiscoveryStatus::Absent | NativeDiscoveryStatus::Failed => {
                    RuntimeReadinessV1::Unavailable
                }
            };
            let ready = matches!(readiness, RuntimeReadinessV1::Ready);
            let first = runtime.candidates.first();
            statuses.push(RuntimeConnectionStatusV1 {
                runtime_id: runtime_id.into(),
                label: label.into(),
                executable: first
                    .and_then(|candidate| candidate.canonical_location.as_ref())
                    .map(|path| path.to_string_lossy().to_string()),
                version: first.and_then(|candidate| candidate.runtime_version.clone()),
                readiness,
                authentication: RuntimeAuthenticationV1::NotApplicable,
                last_verified_at: ready.then(|| verified_at.clone()),
                reason: runtime.message,
            });
        }
        statuses.sort_by_key(|status| match status.runtime_id.as_str() {
            "claude_code" => 0,
            "codex" => 1,
            "hermes" => 2,
            "openclaw" => 3,
            _ => 4,
        });
        Ok(statuses)
    })
    .await
    .map_err(|_| "runtime discovery task failed".to_string())?
}
