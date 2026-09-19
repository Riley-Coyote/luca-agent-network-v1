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
                // Current Codex rejects the retired `untrusted` policy at startup.
                // Keep the restricted filesystem sandbox; ask the user for escalation.
                ResidentAccessLevel::Restricted => json!({
                    "approval_policy": "on-request",
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

/// A preset the supported native adapter cannot actually enforce.
/// codex-acp 1.11's preset named read-only uses a workspace-write sandbox.
///
/// The spawn path now migrates ANY resident off Restricted before this is
/// ever called (see [`migrate_unsupported_level`] — beta.13 retired the
/// three-rung picker in favor of two modes, so Restricted is legacy for
/// every family, not only Codex), so in practice this never sees
/// `("codex", Restricted)` any more. It stays as the guard for a
/// combination nothing today knows how to make safe: fail closed rather
/// than start a resident at a level its runtime cannot actually hold to.
pub(crate) fn validate_runtime_level(
    family: &str,
    level: ResidentAccessLevel,
) -> Result<(), String> {
    if family == "codex" && level == ResidentAccessLevel::Restricted {
        return Err("Manual access is unavailable with this Codex connection. The adapter permits project writes even in its read-only preset. No work was started. Choose Accept edits explicitly, or use a runtime that supports Manual access.".to_owned());
    }
    Ok(())
}

/// Owner-facing sentence for a resident moved off the retired Restricted
/// rung. Used both in Settings and in the Activity trace, so the wording
/// never drifts between the two places the owner sees it.
///
/// beta.13 retires the three-rung picker: the UI now offers only "Work in
/// my project" (Standard) and "Don't ask me" (Full), so this note is no
/// longer Codex-specific — any resident still stored at Restricted gets it,
/// on whatever runtime it happens to be running.
pub(crate) const RESTRICTED_LEVEL_MIGRATION_NOTE: &str =
    "Manual access isn't offered anymore, so this resident now runs at Work in my project.";

/// True exactly when this resident's stored level cannot start the way it
/// reads any more — beta.13 retired Restricted, so this is now simply "is it
/// still on Restricted", independent of runtime family.
fn needs_manual_migration(level: ResidentAccessLevel) -> bool {
    level == ResidentAccessLevel::Restricted
}

/// Move a resident off a retired rung, instead of refusing to start it. The
/// move is written through `resident_capability_authority`, so it is
/// durable: the next start reads the new rung directly and this never fires
/// twice for the same resident. Returns the level this spawn should
/// actually use, and whether a migration just happened (so the caller can
/// tell the owner about it once, not on every start).
///
/// If the durable write itself fails, this spawn still runs at Standard
/// ("Work in my project") — the point of migrating is that a resident is
/// never left unable to start over its own access rung, even when
/// persistence has trouble.
pub(crate) fn migrate_unsupported_level(
    app: &AppHandle,
    owner_pubkey: &str,
    resident_pubkey: &str,
    _family: &str,
    level: ResidentAccessLevel,
) -> (ResidentAccessLevel, bool) {
    if !needs_manual_migration(level) {
        return (level, false);
    }
    if let Err(error) = crate::luca::resident_capability_authority::migrate_unsupported_manual(
        app,
        owner_pubkey,
        resident_pubkey,
    ) {
        luca_log!(
            warn,
            "luca-permission-tier: could not durably record the Work-in-my-project migration, running this start at that level anyway: {error}"
        );
    }
    (ResidentAccessLevel::Standard, true)
}

/// The runtime family behind one stable resident identity.
///
/// Resolved exactly the way the spawn path resolves it, so the tier the owner
/// is shown and the tier the resident is started with cannot disagree.
pub(crate) fn resident_runtime_family(app: &AppHandle, resident_pubkey: &str) -> &'static str {
    // Resident records carry a pubkey; `load_agent_definitions` keeps only the
    // persona definitions without one, so a lookup there never matches a
    // running resident (the first walk showed every resident as "Unknown").
    let Ok(records) = crate::managed_agents::storage::load_managed_agents(app) else {
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
    fn codex_manual_is_refused_instead_of_relaxed_to_workspace_write() {
        assert!(validate_runtime_level("codex", ResidentAccessLevel::Restricted).is_err());
        assert!(validate_runtime_level("codex", ResidentAccessLevel::Standard).is_ok());
        assert!(validate_runtime_level("codex", ResidentAccessLevel::Full).is_ok());
        assert!(validate_runtime_level("claude_code", ResidentAccessLevel::Restricted).is_ok());
    }

    /// The migration gate itself, independent of the durable write and of
    /// runtime family: beta.13 retires Restricted for everyone, so ANY
    /// resident still stored at it needs to move, on any runtime; a resident
    /// already past Restricted is untouched regardless of family.
    #[test]
    fn only_a_resident_still_on_restricted_needs_the_manual_migration() {
        assert!(needs_manual_migration(ResidentAccessLevel::Restricted));
        assert!(!needs_manual_migration(ResidentAccessLevel::Standard));
        assert!(!needs_manual_migration(ResidentAccessLevel::Full));
    }

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
                "approval_policy": "on-request",
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
