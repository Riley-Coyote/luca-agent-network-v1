//! The owner's access level, translated into the runtime's own policy.
//!
//! Polyphonic's three rungs — Manual, Accept edits, Full access — are the
//! owner's language. Each runtime family has its own: Claude takes a permission
//! mode, Codex takes an approval policy and a sandbox. This module is the one
//! place the translation lives, so the ladder cannot drift between them.
//!
//! A family Polyphonic cannot steer is reported as `Advisory` rather than
//! silently claimed: the resident keeps its own settings, and the ledger is
//! what stops the cards repeating.

use luca_protocol::ResidentAccessLevel;
use serde_json::json;
use tauri::AppHandle;

/// How much of the owner's rung actually reaches the runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RuntimeTierControl {
    /// The runtime takes a native permission mode.
    NativeMode,
    /// The runtime takes a native approval policy and sandbox.
    NativePolicy,
    /// The runtime keeps its own settings; Polyphonic only remembers answers.
    Advisory,
}

/// One runtime's settings for one owner rung.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RuntimeTier {
    /// Value for `BUZZ_ACP_PERMISSION_MODE`.
    pub buzz_acp_mode: &'static str,
    /// Value for `BUZZ_ACP_CODEX_POLICY`, exactly `approval_policy` and
    /// `sandbox_mode` and nothing else.
    pub codex_policy: Option<serde_json::Value>,
    pub control: RuntimeTierControl,
}

/// Translate one owner rung for one runtime family.
pub(crate) fn for_family(family: &str, level: ResidentAccessLevel) -> RuntimeTier {
    match family {
        "claude_code" => RuntimeTier {
            buzz_acp_mode: match level {
                ResidentAccessLevel::Restricted => "default",
                ResidentAccessLevel::Standard => "accept-edits",
                ResidentAccessLevel::Full => "bypass-permissions",
            },
            codex_policy: None,
            control: RuntimeTierControl::NativeMode,
        },
        "codex" => RuntimeTier {
            // Codex takes its tier through CODEX_CONFIG, not through the mode
            // call, so the neutral mode is the honest value here.
            buzz_acp_mode: "default",
            codex_policy: Some(match level {
                ResidentAccessLevel::Restricted => json!({
                    "approval_policy": "untrusted",
                    "sandbox_mode": "read-only",
                }),
                ResidentAccessLevel::Standard => json!({
                    "approval_policy": "on-request",
                    "sandbox_mode": "workspace-write",
                }),
                ResidentAccessLevel::Full => json!({
                    "approval_policy": "never",
                    "sandbox_mode": "danger-full-access",
                }),
            }),
            control: RuntimeTierControl::NativePolicy,
        },
        // hermes, kimi, grok, goose, openclaw and anything unrecognised.
        _ => RuntimeTier {
            buzz_acp_mode: "default",
            codex_policy: None,
            control: RuntimeTierControl::Advisory,
        },
    }
}

/// The runtime family behind one stable resident identity.
///
/// Resolved exactly the way the spawn path resolves it, so the tier the owner
/// is shown and the tier the resident is started with cannot disagree.
pub(crate) fn resident_runtime_family(app: &AppHandle, resident_pubkey: &str) -> &'static str {
    let Ok(records) = crate::managed_agents::storage::load_agent_definitions(app) else {
        return "unknown";
    };
    let Some(record) = records
        .iter()
        .find(|record| record.pubkey.eq_ignore_ascii_case(resident_pubkey))
    else {
        return "unknown";
    };
    let personas = crate::managed_agents::load_personas(app).unwrap_or_default();
    let command = record
        .native_runtime_binding
        .as_ref()
        .map(|binding| binding.launch_preview().0)
        .unwrap_or_else(|| crate::managed_agents::record_agent_command(record, &personas));
    family_for_command(&command)
}

/// The same mapping the spawn path applies to a resolved harness command.
pub(crate) fn family_for_command(command: &str) -> &'static str {
    match crate::managed_agents::known_acp_runtime(command).map(|runtime| runtime.id) {
        Some("claude") => "claude_code",
        Some(runtime) => runtime,
        None => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_is_accept_edits_on_claude_and_on_request_workspace_write_on_codex() {
        let claude = for_family("claude_code", ResidentAccessLevel::Standard);
        assert_eq!(claude.buzz_acp_mode, "accept-edits");
        assert_eq!(claude.codex_policy, None);
        assert_eq!(claude.control, RuntimeTierControl::NativeMode);

        let codex = for_family("codex", ResidentAccessLevel::Standard);
        assert_eq!(
            codex.codex_policy,
            Some(json!({
                "approval_policy": "on-request",
                "sandbox_mode": "workspace-write",
            }))
        );
        assert_eq!(codex.control, RuntimeTierControl::NativePolicy);
        // Standard is the default rung, so this is what most residents get.
        assert_eq!(
            for_family("claude_code", ResidentAccessLevel::default()).buzz_acp_mode,
            "accept-edits"
        );
    }

    #[test]
    fn restricted_is_the_manual_rung_on_both_steerable_families() {
        assert_eq!(
            for_family("claude_code", ResidentAccessLevel::Restricted).buzz_acp_mode,
            "default"
        );
        assert_eq!(
            for_family("codex", ResidentAccessLevel::Restricted).codex_policy,
            Some(json!({
                "approval_policy": "untrusted",
                "sandbox_mode": "read-only",
            }))
        );
    }

    #[test]
    fn full_maps_to_bypass_and_never_full_access() {
        assert_eq!(
            for_family("claude_code", ResidentAccessLevel::Full).buzz_acp_mode,
            "bypass-permissions"
        );
        assert_eq!(
            for_family("codex", ResidentAccessLevel::Full).codex_policy,
            Some(json!({
                "approval_policy": "never",
                "sandbox_mode": "danger-full-access",
            }))
        );
    }

    #[test]
    fn advisory_families_get_default_mode_and_no_policy() {
        for family in ["hermes", "kimi", "grok", "goose", "openclaw", "unknown", ""] {
            for level in [
                ResidentAccessLevel::Restricted,
                ResidentAccessLevel::Standard,
                ResidentAccessLevel::Full,
            ] {
                let tier = for_family(family, level);
                assert_eq!(tier.buzz_acp_mode, "default", "{family} {level:?}");
                assert_eq!(tier.codex_policy, None, "{family} {level:?}");
                assert_eq!(tier.control, RuntimeTierControl::Advisory, "{family}");
            }
        }
    }

    /// The policy Polyphonic forces carries the tier and nothing else: no
    /// network flag, no writable roots, no inherited persona settings.
    #[test]
    fn the_codex_policy_carries_only_the_two_tier_keys() {
        for level in [
            ResidentAccessLevel::Restricted,
            ResidentAccessLevel::Standard,
            ResidentAccessLevel::Full,
        ] {
            let policy = for_family("codex", level).codex_policy.expect("policy");
            let object = policy.as_object().expect("policy object");
            assert_eq!(object.len(), 2, "{level:?}");
            assert!(object.contains_key("approval_policy"));
            assert!(object.contains_key("sandbox_mode"));
        }
    }

    #[test]
    fn the_spawn_family_mapping_renames_only_claude() {
        assert_eq!(family_for_command("claude-agent-acp"), "claude_code");
        assert_eq!(family_for_command("codex-acp"), "codex");
        assert_eq!(family_for_command("definitely-not-a-runtime"), "unknown");
    }
}
