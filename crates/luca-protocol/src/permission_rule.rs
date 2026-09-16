//! Durable, owner-minted permission rules for managed residents.
//!
//! A rule is a remembered answer to an approval card: this exact command, this
//! path, this MCP tool, this host — allowed or denied, here or everywhere.
//! Rules are local desktop authority. They are never relay events, carry no
//! signing capability, no secret, and no payload body, and they never widen
//! what a resident may do beyond what its owner already approved once.

use serde::{Deserialize, Serialize};

use crate::managed_permission::is_display_safe;
use crate::{
    is_bare_command_token, is_command_argv_token, is_mcp_identifier, is_permission_domain,
    CapabilityContractError, Hex64, OpaqueId, MAX_PERMISSION_COMMAND_ARGV_PREFIX,
};

/// Stable wire identifier for one durable permission rule.
pub const PERMISSION_RULE_PROTOCOL: &str = "luca.permission.rule.v1";
/// Hard ceiling on remembered rules for one owner. Past this the surface asks
/// the owner to prune rather than silently forgetting the oldest answer.
pub const MAX_PERMISSION_RULES_PER_OWNER: usize = 512;
/// Maximum bytes in the sentence a rule shows in the permissions list.
pub const MAX_PERMISSION_RULE_DISPLAY_BYTES: usize = 160;

/// Where a remembered answer applies.
///
/// `Project` is the ordinary case: the owner said yes inside one source, and
/// the rule stays inside it. `Everywhere` is deliberately narrow — see
/// [`PermissionMatcherV1::is_read_only`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "scope")]
pub enum PermissionRuleScopeV1 {
    Project { source_id: OpaqueId },
    Everywhere,
}

/// What a remembered answer matches.
///
/// Every variant is a bare, bounded fact copied from the request that raised
/// the card — a command word, a path, an MCP tool, a host. None of them is a
/// pattern language, and none of them carries a payload body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum PermissionMatcherV1 {
    Command {
        token: String,
        #[serde(default)]
        argv_prefix: Vec<String>,
    },
    Path {
        write: bool,
    },
    McpTool {
        server_family: String,
        tool: String,
    },
    Domain {
        host: String,
    },
}

/// Which way a remembered answer points.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionEffectV1 {
    Allow,
    Deny,
}

/// One durable, revocable permission rule for a stable resident identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PermissionRuleV1 {
    /// Must equal [`PERMISSION_RULE_PROTOCOL`].
    pub protocol: String,
    pub rule_id: OpaqueId,
    pub resident_pubkey: Hex64,
    pub scope: PermissionRuleScopeV1,
    pub matcher: PermissionMatcherV1,
    pub effect: PermissionEffectV1,
    /// The sentence the permissions list shows: "Run `git status` in Luca".
    pub display_name: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoked_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
    #[serde(default)]
    pub use_count: u64,
}

impl PermissionMatcherV1 {
    /// Whether this matcher can only ever describe reading.
    ///
    /// Only a read-only matcher may be remembered [`Everywhere`]: a command, a
    /// write, or an MCP tool outside [`POLYPHONIC_PRE_ALLOWED_TOOLS`] stays
    /// bound to the one source the owner was looking at when they said yes.
    ///
    /// [`Everywhere`]: PermissionRuleScopeV1::Everywhere
    pub fn is_read_only(&self) -> bool {
        match self {
            PermissionMatcherV1::Path { write } => !*write,
            PermissionMatcherV1::Domain { .. } => true,
            PermissionMatcherV1::McpTool {
                server_family,
                tool,
            } => POLYPHONIC_PRE_ALLOWED_TOOLS
                .iter()
                .any(|(family, name)| *family == server_family.as_str() && *name == tool.as_str()),
            PermissionMatcherV1::Command { .. } => false,
        }
    }

    /// Verify this matcher is the bounded, bare shape a permission card can mint.
    pub fn validate(&self) -> Result<(), CapabilityContractError> {
        let bounded = match self {
            PermissionMatcherV1::Command { token, argv_prefix } => {
                is_bare_command_token(token)
                    && argv_prefix.len() <= MAX_PERMISSION_COMMAND_ARGV_PREFIX
                    && argv_prefix.iter().all(|value| is_command_argv_token(value))
            }
            PermissionMatcherV1::Path { .. } => true,
            PermissionMatcherV1::McpTool {
                server_family,
                tool,
            } => is_mcp_identifier(server_family) && is_mcp_identifier(tool),
            PermissionMatcherV1::Domain { host } => is_permission_domain(host),
        };
        if bounded {
            Ok(())
        } else {
            Err(CapabilityContractError::Bounds)
        }
    }
}

impl PermissionRuleV1 {
    /// Verify this rule is bounded, display-safe, and no wider than its matcher allows.
    pub fn validate(&self) -> Result<(), CapabilityContractError> {
        if self.protocol != PERMISSION_RULE_PROTOCOL {
            return Err(CapabilityContractError::Protocol);
        }
        if self.display_name.is_empty()
            || self.display_name.len() > MAX_PERMISSION_RULE_DISPLAY_BYTES
            || !is_display_safe(&self.display_name)
            || self.created_at.is_empty()
        {
            return Err(CapabilityContractError::Bounds);
        }
        if matches!(self.scope, PermissionRuleScopeV1::Everywhere) && !self.matcher.is_read_only() {
            return Err(CapabilityContractError::Bounds);
        }
        self.matcher.validate()
    }
}

/// Strip the per-install suffix from an MCP server name.
///
/// Polyphonic mints server names like `luca-artifacts-0123abcdef45`, one per
/// install. A rule remembers the family, not the install, so it survives a
/// reprovision. Only a trailing `-` plus exactly twelve lowercase hex
/// characters is a suffix; anything else is part of the name.
pub fn mcp_server_family(name: &str) -> &str {
    let Some((family, suffix)) = name.rsplit_once('-') else {
        return name;
    };
    if suffix.len() == 12
        && suffix
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    {
        family
    } else {
        name
    }
}

/// Polyphonic's own tools that never raise an approval card, as
/// (server family, tool).
///
/// Three door rules deliberately live in code rather than in a list, because
/// each of them depends on the request and not only on the name:
///
/// - any `luca-communications` tool that is not pre-allowed here is a door —
///   speaking to somebody else is always the owner's decision;
/// - `buzz` `view_image` is a door when it carries a domain, because that
///   fetches from the network rather than reading a local file;
/// - an ACP `tool_kind` of `"delete"` is a door whichever tool reported it.
pub const POLYPHONIC_PRE_ALLOWED_TOOLS: &[(&str, &str)] = &[
    ("buzz", "read_file"),
    ("buzz", "todo"),
    ("buzz", "_Stop"),
    ("buzz", "_PostCompact"),
    ("luca-repositories", "repositories"),
    ("luca-repositories", "polyphonic_status"),
    ("luca-repositories", "list_resident_runtimes"),
    ("luca-repositories", "read_runtime_task_result"),
    ("luca-repositories", "repo_tree"),
    ("luca-repositories", "repo_search"),
    ("luca-repositories", "repo_read"),
    ("luca-repositories", "repo_status"),
    ("luca-repositories", "repo_diff"),
    ("luca-repositories", "polyphonic_open"),
    ("luca-artifacts", "artifact_read"),
    ("luca-artifacts", "artifact_list"),
    ("luca-artifacts", "canvas_present"),
    ("luca-artifacts", "resident_place_get"),
    ("luca-artifacts", "quickchat_highlight"),
    ("luca-communications", "communications_inbox"),
    ("luca-communications", "communications_conversation"),
];

/// Tools whose side effect already goes through the desktop authority broker.
/// The broker owns the confirmation, so the permission surface does not raise
/// a second card in front of it.
pub const POLYPHONIC_BROKER_GUARDED_TOOLS: &[(&str, &str)] = &[
    ("luca-repositories", "repo_apply_patch"),
    ("luca-repositories", "repo_run"),
    ("luca-repositories", "repo_commit"),
    ("luca-repositories", "propose_resident"),
    ("luca-repositories", "propose_runtime_task"),
    ("luca-repositories", "propose_repository_connection"),
];

/// Tools that write inside the owner's own project or house surfaces. They may
/// be remembered, but only for the source the owner approved them in.
pub const POLYPHONIC_PROJECT_WRITE_TOOLS: &[(&str, &str)] = &[
    ("buzz", "str_replace"),
    ("luca-artifacts", "artifact_create"),
    ("luca-artifacts", "artifact_update"),
    ("luca-artifacts", "resident_place_update"),
    ("luca-artifacts", "preview_attach"),
    ("luca-artifacts", "preview_detach"),
];

/// Tools that always raise a card — a door onto the machine or the world.
pub const POLYPHONIC_DOOR_TOOLS: &[(&str, &str)] = &[("buzz", "shell")];

/// Server families that are a door whatever tool they advertise.
pub const DOOR_SERVER_FAMILIES: &[&str] = &["polyphonic-browser", "polyphonic_browser"];

/// Command words that are never remembered, whatever the owner answered once.
pub const DESTRUCTIVE_COMMAND_TOKENS: &[&str] = &["rm", "rmdir", "shred", "unlink"];

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(scope: PermissionRuleScopeV1, matcher: PermissionMatcherV1) -> PermissionRuleV1 {
        PermissionRuleV1 {
            protocol: PERMISSION_RULE_PROTOCOL.into(),
            rule_id: OpaqueId::parse("rule-1").unwrap(),
            resident_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
            scope,
            matcher,
            effect: PermissionEffectV1::Allow,
            display_name: "Run git status in Luca".into(),
            created_at: "2026-09-16T00:00:00Z".into(),
            revoked_at: None,
            last_used_at: None,
            use_count: 0,
        }
    }

    #[test]
    fn everywhere_scope_requires_read_only_matcher() {
        let reading = rule(
            PermissionRuleScopeV1::Everywhere,
            PermissionMatcherV1::Path { write: false },
        );
        assert_eq!(reading.validate(), Ok(()));

        let browsing = rule(
            PermissionRuleScopeV1::Everywhere,
            PermissionMatcherV1::Domain {
                host: "docs.rs".into(),
            },
        );
        assert_eq!(browsing.validate(), Ok(()));

        let pre_allowed = rule(
            PermissionRuleScopeV1::Everywhere,
            PermissionMatcherV1::McpTool {
                server_family: "luca-repositories".into(),
                tool: "repo_read".into(),
            },
        );
        assert_eq!(pre_allowed.validate(), Ok(()));

        let writing = rule(
            PermissionRuleScopeV1::Everywhere,
            PermissionMatcherV1::Path { write: true },
        );
        assert_eq!(
            writing.validate(),
            Err(CapabilityContractError::Bounds),
            "a write may never be remembered everywhere"
        );

        let running = rule(
            PermissionRuleScopeV1::Everywhere,
            PermissionMatcherV1::Command {
                token: "git".into(),
                argv_prefix: vec!["status".into()],
            },
        );
        assert_eq!(running.validate(), Err(CapabilityContractError::Bounds));

        let writing_tool = rule(
            PermissionRuleScopeV1::Everywhere,
            PermissionMatcherV1::McpTool {
                server_family: "luca-artifacts".into(),
                tool: "artifact_create".into(),
            },
        );
        assert_eq!(
            writing_tool.validate(),
            Err(CapabilityContractError::Bounds)
        );

        // The same command is fine inside one source the owner approved.
        let here = rule(
            PermissionRuleScopeV1::Project {
                source_id: OpaqueId::parse("source-1").unwrap(),
            },
            PermissionMatcherV1::Command {
                token: "git".into(),
                argv_prefix: vec!["status".into()],
            },
        );
        assert_eq!(here.validate(), Ok(()));
    }

    #[test]
    fn server_family_strips_only_a_twelve_hex_suffix() {
        assert_eq!(
            mcp_server_family("luca-artifacts-0123abcdef45"),
            "luca-artifacts"
        );
        assert_eq!(
            mcp_server_family("luca-artifacts-0123ABCDEF45"),
            "luca-artifacts-0123ABCDEF45"
        );
        assert_eq!(
            mcp_server_family("luca-artifacts-0123abcdef4"),
            "luca-artifacts-0123abcdef4"
        );
        assert_eq!(mcp_server_family("luca-repositories"), "luca-repositories");
        assert_eq!(mcp_server_family("buzz"), "buzz");
    }

    #[test]
    fn rule_round_trips_through_json() {
        let original = rule(
            PermissionRuleScopeV1::Project {
                source_id: OpaqueId::parse("source-1").unwrap(),
            },
            PermissionMatcherV1::Command {
                token: "git".into(),
                argv_prefix: vec!["status".into(), "--short".into()],
            },
        );
        let encoded = serde_json::to_value(&original).expect("rule json");
        assert_eq!(encoded["scope"]["scope"], "project");
        assert_eq!(encoded["scope"]["source_id"], "source-1");
        assert_eq!(encoded["matcher"]["kind"], "command");
        assert_eq!(encoded["matcher"]["token"], "git");
        assert_eq!(encoded["effect"], "allow");
        assert!(encoded.get("revoked_at").is_none());
        assert!(encoded.get("last_used_at").is_none());

        let decoded: PermissionRuleV1 = serde_json::from_value(encoded).expect("rule round trip");
        assert_eq!(decoded, original);
        assert_eq!(decoded.validate(), Ok(()));
    }

    #[test]
    fn inventories_name_only_tools_that_exist() {
        // Copied from crates/buzz-dev-mcp/src/{lib,luca_repositories,
        // luca_artifacts,luca_communications}.rs and buzz-acp's
        // ARTIFACT_TOOL_NAMES. A typo in an inventory above fails here.
        const BUZZ: &[&str] = &[
            "shell",
            "read_file",
            "view_image",
            "str_replace",
            "todo",
            "_Stop",
            "_PostCompact",
            "rg",
            "tree",
        ];
        const REPOSITORIES: &[&str] = &[
            "repositories",
            "polyphonic_status",
            "propose_repository_connection",
            "list_resident_runtimes",
            "propose_resident",
            "polyphonic_open",
            "propose_runtime_task",
            "read_runtime_task_result",
            "repo_tree",
            "repo_search",
            "repo_read",
            "repo_apply_patch",
            "repo_run",
            "repo_status",
            "repo_diff",
            "repo_commit",
        ];
        const ARTIFACTS: &[&str] = &[
            "resident_place_get",
            "resident_place_update",
            "quickchat_highlight",
            "artifact_create",
            "artifact_update",
            "artifact_read",
            "artifact_list",
            "canvas_present",
            "preview_attach",
            "preview_detach",
        ];
        const COMMUNICATIONS: &[&str] = &[
            "communications_inbox",
            "communications_conversation",
            "communications_send",
            "communications_message_resident",
            "communications_react",
            "communications_edit_own_message",
            "communications_delete_own_message",
            "communications_invite",
            "communications_create_private_room",
        ];

        let inventories = [
            POLYPHONIC_PRE_ALLOWED_TOOLS,
            POLYPHONIC_BROKER_GUARDED_TOOLS,
            POLYPHONIC_PROJECT_WRITE_TOOLS,
            POLYPHONIC_DOOR_TOOLS,
        ];
        for inventory in inventories {
            for (family, tool) in inventory {
                let known = match *family {
                    "buzz" => BUZZ,
                    "luca-repositories" => REPOSITORIES,
                    "luca-artifacts" => ARTIFACTS,
                    "luca-communications" => COMMUNICATIONS,
                    other => panic!("inventory names an unknown server family: {other}"),
                };
                assert!(
                    known.contains(tool),
                    "inventory names a tool that does not exist: {family}.{tool}"
                );
                // `buzz` advertises two internal hook tools whose names start
                // with `_`, which `is_mcp_identifier` refuses. They are
                // pre-allowed by name and so never raise a card, meaning no
                // `McpTool` matcher is ever minted for them — but a caller
                // that builds one from this inventory would fail validation.
                assert!(
                    is_mcp_identifier(family) && (is_mcp_identifier(tool) || tool.starts_with('_')),
                    "inventory entry is not a valid MCP identifier: {family}.{tool}"
                );
            }
        }
    }
}
