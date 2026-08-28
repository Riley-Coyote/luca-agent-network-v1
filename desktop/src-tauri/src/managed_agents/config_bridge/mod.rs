mod buzz_agent;
mod claude;
mod codex;
mod goose;
pub(crate) mod reader;
mod schema_walker;
pub(crate) mod types;

pub(crate) use types::*;

/// Read the goose harness config file (`~/.config/goose/config.yaml`).
///
/// Used by readiness evaluation to silence requirements that are already
/// satisfied in the file config layer — the harness reads this file at startup
/// so env vars we would otherwise require are not needed from Buzz.
pub(crate) fn read_goose_file_config() -> Option<RuntimeFileConfig> {
    goose::read_config_file()
}

/// Read only the already-sanitized MCP name/status projection for a runtime.
///
/// Runtime-owned commands, arguments, environment values, credentials, and
/// config paths never cross this boundary. Callers must treat `None` as an
/// unreadable/unavailable source rather than assuming there are no servers.
pub(crate) fn read_runtime_owned_mcp_extensions(runtime_id: &str) -> Option<Vec<ExtensionEntry>> {
    match runtime_id {
        "claude" => claude::read_mcp_extensions(),
        "codex" => codex::read_mcp_extensions(),
        _ => None,
    }
}
