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
        config_bridge::{
            read_runtime_owned_mcp_extensions, ExtensionEntry, RuntimeOwnedMcpExtensionsRead,
        },
        AcpAvailabilityStatus, AuthStatus, NativeDiscoveryStatus, NativeRuntimeKind,
        ResidentReadiness, RuntimeBinding,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeReadinessV1 {
    Ready,
    Degraded,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeAuthenticationV1 {
    Ready,
    Required,
    Unknown,
    NotApplicable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeReadinessBasisV1 {
    BoundedProbe,
    DiscoveryOnly,
    NativeReported,
    BindingValidation,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConnectionStatusV1 {
    status_id: String,
    runtime_id: String,
    label: String,
    executable: Option<String>,
    version: Option<String>,
    readiness: RuntimeReadinessV1,
    authentication: RuntimeAuthenticationV1,
    last_verified_at: Option<String>,
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    native_semantic_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    native_display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    readiness_basis: Option<RuntimeReadinessBasisV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeOwnedMcpCatalogStatusV1 {
    Configured,
    NoneConfigured,
    Unavailable,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeOwnedMcpServerStatusV1 {
    Configured,
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeOwnedMcpServerV1 {
    name: String,
    status: RuntimeOwnedMcpServerStatusV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeOwnedMcpCatalogV1 {
    runtime_id: String,
    label: String,
    source: Option<String>,
    status: RuntimeOwnedMcpCatalogStatusV1,
    servers: Vec<RuntimeOwnedMcpServerV1>,
    reason: Option<String>,
}

enum RuntimeOwnedMcpRead {
    Available(Vec<ExtensionEntry>),
    Unavailable,
    Unsupported,
}

fn project_runtime_owned_mcp_catalog(
    runtime_id: &str,
    label: &str,
    source: Option<&str>,
    read: RuntimeOwnedMcpRead,
) -> RuntimeOwnedMcpCatalogV1 {
    let (status, mut servers, reason) = match read {
        RuntimeOwnedMcpRead::Available(extensions) => {
            let status = if extensions.is_empty() {
                RuntimeOwnedMcpCatalogStatusV1::NoneConfigured
            } else {
                RuntimeOwnedMcpCatalogStatusV1::Configured
            };
            let servers = extensions
                .into_iter()
                .map(|extension| RuntimeOwnedMcpServerV1 {
                    name: extension.name,
                    status: if extension.enabled {
                        RuntimeOwnedMcpServerStatusV1::Configured
                    } else {
                        RuntimeOwnedMcpServerStatusV1::Disabled
                    },
                })
                .collect::<Vec<_>>();
            (status, servers, None)
        }
        RuntimeOwnedMcpRead::Unavailable => (
            RuntimeOwnedMcpCatalogStatusV1::Unavailable,
            Vec::new(),
            Some("Runtime MCP configuration could not be read safely.".into()),
        ),
        RuntimeOwnedMcpRead::Unsupported => (
            RuntimeOwnedMcpCatalogStatusV1::Unsupported,
            Vec::new(),
            Some(
                "Polyphonic does not currently have a safe read-only MCP reader for this runtime."
                    .into(),
            ),
        ),
    };
    servers.sort_by_key(|server| server.name.to_lowercase());
    RuntimeOwnedMcpCatalogV1 {
        runtime_id: runtime_id.into(),
        label: label.into(),
        source: source.map(str::to_owned),
        status,
        servers,
        reason,
    }
}

fn runtime_owned_mcp_catalogs() -> Vec<RuntimeOwnedMcpCatalogV1> {
    let readable = |runtime_id: &str| match read_runtime_owned_mcp_extensions(runtime_id) {
        RuntimeOwnedMcpExtensionsRead::Available(extensions) => {
            RuntimeOwnedMcpRead::Available(extensions)
        }
        RuntimeOwnedMcpExtensionsRead::Unavailable => RuntimeOwnedMcpRead::Unavailable,
    };
    vec![
        project_runtime_owned_mcp_catalog(
            "claude_code",
            "Claude Code",
            Some("Claude Code user configuration"),
            readable("claude"),
        ),
        project_runtime_owned_mcp_catalog(
            "codex",
            "Codex",
            Some("Codex user configuration"),
            readable("codex"),
        ),
        project_runtime_owned_mcp_catalog(
            "goose",
            "Goose",
            Some("Goose user configuration"),
            readable("goose"),
        ),
        project_runtime_owned_mcp_catalog(
            "hermes",
            "Hermes",
            None,
            RuntimeOwnedMcpRead::Unsupported,
        ),
        project_runtime_owned_mcp_catalog(
            "openclaw",
            "OpenClaw",
            None,
            RuntimeOwnedMcpRead::Unsupported,
        ),
    ]
}

fn native_runtime_metadata(native_type: &NativeRuntimeKind) -> (&'static str, &'static str) {
    match native_type {
        NativeRuntimeKind::Hermes => ("hermes", "Hermes"),
        NativeRuntimeKind::Openclaw => ("openclaw", "OpenClaw"),
    }
}

fn include_primary_runtime_connection(runtime_id: &str) -> bool {
    matches!(runtime_id, "claude" | "codex")
}

fn native_binding_executable(binding: &RuntimeBinding) -> String {
    match binding {
        RuntimeBinding::Hermes {
            executable_path, ..
        }
        | RuntimeBinding::Openclaw {
            executable_path, ..
        } => executable_path.to_string_lossy().to_string(),
    }
}

fn project_native_readiness(
    readiness: &ResidentReadiness,
    binding_resolution: Result<(), String>,
) -> (RuntimeReadinessV1, RuntimeReadinessBasisV1, Option<String>) {
    if let Err(error) = binding_resolution {
        return (
            RuntimeReadinessV1::Unavailable,
            RuntimeReadinessBasisV1::BindingValidation,
            Some(format!(
                "Current native binding could not be resolved: {error}"
            )),
        );
    }

    match readiness {
        ResidentReadiness::Ready => (
            RuntimeReadinessV1::Ready,
            RuntimeReadinessBasisV1::BoundedProbe,
            Some("The bounded native ACP readiness probe passed.".into()),
        ),
        ResidentReadiness::Discovered { message } => (
            RuntimeReadinessV1::Degraded,
            RuntimeReadinessBasisV1::DiscoveryOnly,
            Some(message.clone()),
        ),
        ResidentReadiness::Degraded { message, .. } => (
            RuntimeReadinessV1::Degraded,
            RuntimeReadinessBasisV1::NativeReported,
            Some(message.clone()),
        ),
        ResidentReadiness::Unavailable { message, .. } => (
            RuntimeReadinessV1::Unavailable,
            RuntimeReadinessBasisV1::NativeReported,
            Some(message.clone()),
        ),
    }
}

#[tauri::command]
pub async fn list_luca_mcp_registry(app: AppHandle) -> Result<LucaMcpRegistryV1, String> {
    tokio::task::spawn_blocking(move || mcp_registry::load_registry(&app))
        .await
        .map_err(|_| "MCP registry task failed".to_string())?
}

#[tauri::command]
pub async fn list_runtime_owned_mcp_catalog() -> Result<Vec<RuntimeOwnedMcpCatalogV1>, String> {
    tokio::task::spawn_blocking(runtime_owned_mcp_catalogs)
        .await
        .map_err(|_| "runtime MCP catalog task failed".to_string())
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
        tokio::task::spawn_blocking(move || mcp_registry::resolve_connection(&app, &connection_id))
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
            .filter(|runtime| include_primary_runtime_connection(&runtime.id))
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
                    status_id: runtime.id.clone(),
                    runtime_id: if runtime.id == "claude" {
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
                    reason: (!ready).then_some(runtime.install_hint),
                    native_semantic_id: None,
                    native_display_name: None,
                    readiness_basis: None,
                }
            })
            .collect::<Vec<_>>();

        for runtime in crate::managed_agents::discover_native_resident_outcome().runtimes {
            let (runtime_id, runtime_label) = native_runtime_metadata(&runtime.native_type);
            if runtime.candidates.is_empty() {
                let readiness = match runtime.status {
                    NativeDiscoveryStatus::Available | NativeDiscoveryStatus::Degraded => {
                        RuntimeReadinessV1::Degraded
                    }
                    NativeDiscoveryStatus::Absent | NativeDiscoveryStatus::Failed => {
                        RuntimeReadinessV1::Unavailable
                    }
                };
                statuses.push(RuntimeConnectionStatusV1 {
                    status_id: format!("{runtime_id}:family"),
                    runtime_id: runtime_id.into(),
                    label: runtime_label.into(),
                    executable: None,
                    version: None,
                    readiness,
                    authentication: RuntimeAuthenticationV1::NotApplicable,
                    last_verified_at: None,
                    reason: runtime.message.or_else(|| {
                        Some("No native identities were returned by current discovery.".into())
                    }),
                    native_semantic_id: None,
                    native_display_name: None,
                    readiness_basis: Some(RuntimeReadinessBasisV1::DiscoveryOnly),
                });
                continue;
            }

            for candidate in runtime.candidates {
                let binding_resolution = crate::managed_agents::resolve_native_runtime_binding(
                    &candidate.binding_preview,
                )
                .map(|_| ());
                let (readiness, readiness_basis, reason) =
                    project_native_readiness(&candidate.readiness, binding_resolution);
                let ready = matches!(readiness, RuntimeReadinessV1::Ready);
                statuses.push(RuntimeConnectionStatusV1 {
                    status_id: format!("{runtime_id}:{}", candidate.binding_fingerprint),
                    runtime_id: runtime_id.into(),
                    label: format!("{runtime_label} · {}", candidate.display_name),
                    executable: Some(native_binding_executable(&candidate.binding_preview)),
                    version: candidate.runtime_version,
                    readiness,
                    authentication: RuntimeAuthenticationV1::NotApplicable,
                    last_verified_at: ready.then(|| verified_at.clone()),
                    reason,
                    native_semantic_id: Some(candidate.semantic_id),
                    native_display_name: Some(candidate.display_name),
                    readiness_basis: Some(readiness_basis),
                });
            }
        }
        statuses.sort_by(|left, right| {
            let rank = |runtime_id: &str| match runtime_id {
                "claude_code" => 0,
                "codex" => 1,
                "hermes" => 2,
                "openclaw" => 3,
                _ => 4,
            };
            rank(&left.runtime_id)
                .cmp(&rank(&right.runtime_id))
                .then_with(|| left.label.cmp(&right.label))
        });
        Ok(statuses)
    })
    .await
    .map_err(|_| "runtime discovery task failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_only_native_candidate_is_not_reported_ready() {
        let (readiness, basis, reason) = project_native_readiness(
            &ResidentReadiness::Discovered {
                message: "Detected; ACP readiness has not been tested.".into(),
            },
            Ok(()),
        );

        assert_eq!(readiness, RuntimeReadinessV1::Degraded);
        assert_eq!(basis, RuntimeReadinessBasisV1::DiscoveryOnly);
        assert_eq!(
            reason.as_deref(),
            Some("Detected; ACP readiness has not been tested.")
        );
    }

    #[test]
    fn unresolved_native_binding_fails_closed() {
        let (readiness, basis, reason) = project_native_readiness(
            &ResidentReadiness::Ready,
            Err("native executable is unavailable".into()),
        );

        assert_eq!(readiness, RuntimeReadinessV1::Unavailable);
        assert_eq!(basis, RuntimeReadinessBasisV1::BindingValidation);
        assert!(reason
            .as_deref()
            .is_some_and(|message| message.contains("could not be resolved")));
    }

    #[test]
    fn runtime_mcp_projection_contains_only_name_status_and_safe_source() {
        let catalog = project_runtime_owned_mcp_catalog(
            "codex",
            "Codex",
            Some("Codex user configuration"),
            RuntimeOwnedMcpRead::Available(vec![ExtensionEntry {
                name: "filesystem".into(),
                kind: "mcp".into(),
                enabled: true,
            }]),
        );
        let value = serde_json::to_value(catalog).expect("serialize runtime MCP catalog");

        assert_eq!(value["runtimeId"], "codex");
        assert_eq!(value["source"], "Codex user configuration");
        assert_eq!(value["servers"][0]["name"], "filesystem");
        assert_eq!(value["servers"][0]["status"], "configured");
        let serialized = value.to_string();
        for forbidden in ["command", "args", "environment", "credential", "path"] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn unsupported_runtime_mcp_reader_is_reported_honestly() {
        let catalog = project_runtime_owned_mcp_catalog(
            "hermes",
            "Hermes",
            None,
            RuntimeOwnedMcpRead::Unsupported,
        );

        assert_eq!(catalog.status, RuntimeOwnedMcpCatalogStatusV1::Unsupported);
        assert!(catalog.servers.is_empty());
        assert!(catalog.source.is_none());
    }

    #[test]
    fn goose_runtime_mcp_catalog_is_included_with_native_status() {
        let catalogs = runtime_owned_mcp_catalogs();
        let goose = catalogs
            .iter()
            .find(|catalog| catalog.runtime_id == "goose")
            .expect("Goose catalog must be projected");

        assert_eq!(goose.label, "Goose");
        assert_eq!(goose.source.as_deref(), Some("Goose user configuration"));
        assert_ne!(goose.status, RuntimeOwnedMcpCatalogStatusV1::Unsupported);
    }

    #[test]
    fn primary_runtime_filter_uses_the_canonical_claude_id() {
        assert!(include_primary_runtime_connection("claude"));
        assert!(include_primary_runtime_connection("codex"));
        assert!(!include_primary_runtime_connection("claude-code"));
    }
}
