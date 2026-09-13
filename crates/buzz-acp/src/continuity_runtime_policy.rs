//! Provider-specific tool isolation for private continuity sessions.
//!
//! This policy is intentionally narrow: it only supplies session metadata when
//! the installed adapter documents a way to prevent its on-disk MCP sources
//! from entering a continuity turn. It never treats an empty ACP `mcpServers`
//! list as an exclusion request.

use serde_json::{Map, Value};

/// An adapter identity recorded by the runtime probe before a continuity
/// session is created.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContinuityRuntimeAdapter<'a> {
    /// The adapter's installed package name.
    pub package: &'a str,
    /// The adapter package version returned by the runtime probe.
    pub version: &'a str,
}

/// The supported way to keep private continuity from inheriting native tools.
#[derive(Debug, Clone, PartialEq)]
pub enum ContinuityToolIsolation {
    /// Claude Agent ACP forwards this SDK option to Claude Code. The
    /// SDK documents that it limits MCP loading to ACP-passed servers and
    /// explicitly-passed agent definitions.
    StrictClaudeMcpConfig,
    /// The installed Codex ACP adapter has no per-session metadata path for
    /// replacing inherited `mcp_servers`: an empty ACP list leaves its merged
    /// native config intact. The caller must use provider session/process
    /// lifecycle isolation instead.
    DedicatedCodexProcess,
    /// No documented provider-scoped isolation is available.
    RequiresProviderLifecycle,
}

/// The non-secret session setup decision for one private continuity turn.
#[derive(Debug, Clone, PartialEq)]
pub struct ContinuityRuntimePolicy {
    /// Metadata to pass unchanged to `session/new`, apart from the documented
    /// Claude-only strict MCP option when it is supported.
    pub session_metadata: Option<Value>,
    /// A process-local `CODEX_CONFIG` fragment. It contains only explicit
    /// disabled entries discovered from the configured native Codex runtime.
    /// It is absent when the runtime has no discovered MCP servers so callers
    /// never rely on undocumented empty-map replacement semantics.
    pub codex_config_overlay: Option<Value>,
    pub tool_isolation: ContinuityToolIsolation,
}

/// A caller supplied metadata value cannot be safely augmented unless it is an
/// object at every extension boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContinuityRuntimePolicyError {
    MetadataMustBeObject,
    ClaudeCodeMetadataMustBeObject,
    ClaudeCodeOptionsMustBeObject,
}

impl std::fmt::Display for ContinuityRuntimePolicyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MetadataMustBeObject => {
                f.write_str("continuity session metadata must be an object")
            }
            Self::ClaudeCodeMetadataMustBeObject => {
                f.write_str("continuity Claude Code metadata must be an object")
            }
            Self::ClaudeCodeOptionsMustBeObject => {
                f.write_str("continuity Claude Code options must be an object")
            }
        }
    }
}

impl std::error::Error for ContinuityRuntimePolicyError {}

/// Return the adapter-supported metadata policy for a private continuity turn.
///
/// Normal conversation setup must not call this function. For the installed
/// Claude Agent ACP, this adds `strictMcpConfig: true` and an empty tool list
/// to the SDK options that its adapter passes through. For Codex ACP it emits
/// only explicit per-server disables for a dedicated process; unrecognised
/// adapters retain their supplied metadata without an unsupported override.
pub fn private_continuity_runtime_policy(
    adapter: ContinuityRuntimeAdapter<'_>,
    existing_metadata: Option<&Value>,
    native_mcp_server_names: &[String],
) -> Result<ContinuityRuntimePolicy, ContinuityRuntimePolicyError> {
    if matches!(
        adapter.package,
        "@agentclientprotocol/claude-agent-acp" | "claude-agent-acp"
    ) {
        return Ok(ContinuityRuntimePolicy {
            session_metadata: Some(with_strict_claude_mcp_config(existing_metadata)?),
            codex_config_overlay: None,
            tool_isolation: ContinuityToolIsolation::StrictClaudeMcpConfig,
        });
    }

    if matches!(
        adapter.package,
        "@agentclientprotocol/codex-acp" | "codex-acp"
    ) {
        validate_metadata(existing_metadata)?;
        return Ok(ContinuityRuntimePolicy {
            session_metadata: existing_metadata.cloned(),
            codex_config_overlay: codex_disabled_mcp_overlay(native_mcp_server_names),
            tool_isolation: ContinuityToolIsolation::DedicatedCodexProcess,
        });
    }

    validate_metadata(existing_metadata)?;
    Ok(ContinuityRuntimePolicy {
        session_metadata: existing_metadata.cloned(),
        codex_config_overlay: None,
        tool_isolation: ContinuityToolIsolation::RequiresProviderLifecycle,
    })
}

fn validate_metadata(
    existing_metadata: Option<&Value>,
) -> Result<(), ContinuityRuntimePolicyError> {
    if existing_metadata.is_some_and(|metadata| !metadata.is_object()) {
        return Err(ContinuityRuntimePolicyError::MetadataMustBeObject);
    }
    Ok(())
}

fn with_strict_claude_mcp_config(
    existing_metadata: Option<&Value>,
) -> Result<Value, ContinuityRuntimePolicyError> {
    validate_metadata(existing_metadata)?;
    let mut metadata = existing_metadata
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));
    let metadata = metadata
        .as_object_mut()
        .ok_or(ContinuityRuntimePolicyError::MetadataMustBeObject)?;
    let claude_code = metadata
        .entry("claudeCode")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or(ContinuityRuntimePolicyError::ClaudeCodeMetadataMustBeObject)?;
    let options = claude_code
        .entry("options")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or(ContinuityRuntimePolicyError::ClaudeCodeOptionsMustBeObject)?;
    options.insert("strictMcpConfig".to_owned(), Value::Bool(true));
    options.insert("tools".to_owned(), Value::Array(Vec::new()));
    Ok(Value::Object(metadata.clone()))
}

/// Make explicit per-server disables for a child process. A non-empty map is
/// required: Codex documents `-c mcp_servers.<name>.enabled=false`, while an
/// empty `mcp_servers` map has no documented replacement meaning.
pub fn codex_disabled_mcp_overlay(native_mcp_server_names: &[String]) -> Option<Value> {
    let servers = native_mcp_server_names
        .iter()
        .filter(|name| !name.is_empty())
        .map(|name| (name.clone(), serde_json::json!({ "enabled": false })))
        .collect::<Map<_, _>>();
    (!servers.is_empty()).then(|| serde_json::json!({ "mcp_servers": servers }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const CLAUDE: ContinuityRuntimeAdapter<'static> = ContinuityRuntimeAdapter {
        package: "@agentclientprotocol/claude-agent-acp",
        version: "0.61.0",
    };

    #[test]
    fn installed_claude_adapter_enables_only_its_documented_strict_mcp_option() {
        let existing = json!({
            "luca": { "sessionEpoch": "public-binding" },
            "claudeCode": { "options": { "tools": ["Bash"] } },
        });

        let policy = private_continuity_runtime_policy(CLAUDE, Some(&existing), &[]).unwrap();

        assert_eq!(
            policy.tool_isolation,
            ContinuityToolIsolation::StrictClaudeMcpConfig
        );
        assert_eq!(
            policy.session_metadata,
            Some(json!({
                "luca": { "sessionEpoch": "public-binding" },
                "claudeCode": {
                    "options": { "tools": [], "strictMcpConfig": true },
                },
            }))
        );
    }

    #[test]
    fn installed_claude_adapter_creates_the_required_metadata_shape() {
        let policy = private_continuity_runtime_policy(CLAUDE, None, &[]).unwrap();

        assert_eq!(
            policy.session_metadata,
            Some(json!({
                "claudeCode": { "options": { "strictMcpConfig": true, "tools": [] } }
            }))
        );
    }

    #[test]
    fn installed_codex_uses_explicit_per_server_process_overlay() {
        let existing = json!({ "luca": { "sessionEpoch": "public-binding" } });
        let adapter = ContinuityRuntimeAdapter {
            package: "@agentclientprotocol/codex-acp",
            version: "1.11.0",
        };

        let names = vec!["playwright".to_owned(), "mnemos".to_owned()];
        let policy = private_continuity_runtime_policy(adapter, Some(&existing), &names).unwrap();

        assert_eq!(
            policy.tool_isolation,
            ContinuityToolIsolation::DedicatedCodexProcess
        );
        assert_eq!(policy.session_metadata, Some(existing));
        assert_eq!(
            policy.codex_config_overlay,
            Some(json!({
                "mcp_servers": {
                    "playwright": { "enabled": false },
                    "mnemos": { "enabled": false },
                }
            }))
        );
    }

    #[test]
    fn unknown_adapter_stays_on_the_lifecycle_path() {
        let adapter = ContinuityRuntimeAdapter {
            package: "unrecognized-adapter",
            version: "1.0.0",
        };

        let policy = private_continuity_runtime_policy(adapter, None, &[]).unwrap();

        assert_eq!(
            policy.tool_isolation,
            ContinuityToolIsolation::RequiresProviderLifecycle
        );
        assert_eq!(policy.session_metadata, None);
    }

    #[test]
    fn invalid_existing_metadata_fails_before_any_adapter_policy_is_emitted() {
        let error = private_continuity_runtime_policy(CLAUDE, Some(&json!("not-an-object")), &[])
            .unwrap_err();

        assert_eq!(error, ContinuityRuntimePolicyError::MetadataMustBeObject);
    }

    #[test]
    fn codex_never_emits_an_undocumented_empty_mcp_servers_map() {
        assert_eq!(codex_disabled_mcp_overlay(&[]), None);
        assert_eq!(codex_disabled_mcp_overlay(&[String::new()]), None);
    }
}
