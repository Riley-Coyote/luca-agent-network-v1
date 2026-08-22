//! Truthful capability manifests for supported resident harnesses.
//!
//! These manifests describe what Polyphonic preserves and how operator work is
//! routed. They do not grant authority; the resident/conversation capability
//! broker and the native runtime policy still decide every operation.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeCapabilityManifestV1 {
    pub schema_version: u32,
    pub family: &'static str,
    pub availability: &'static str,
    pub native_capabilities: &'static [&'static str],
    pub typed_harness_operations: &'static [&'static str],
    pub native_cli_first: bool,
    pub general_command_fallback: bool,
    pub validates_native_mutations: bool,
    pub file_edit_fallback: &'static str,
    pub full_access_translation: &'static str,
    pub surface_navigation: &'static str,
}

pub(crate) fn manifest(family: &str) -> Option<RuntimeCapabilityManifestV1> {
    match family {
        "claude_code" => Some(RuntimeCapabilityManifestV1 {
            schema_version: 1,
            family: "claude_code",
            availability: "declared_adapter_contract",
            native_capabilities: &[
                "built_in_tools",
                "project_instructions",
                "skills",
                "plugins",
                "hooks",
                "mcps",
                "subagents",
                "working_directories",
                "native_permission_modes",
            ],
            typed_harness_operations: &["runtime_status"],
            native_cli_first: false,
            general_command_fallback: false,
            validates_native_mutations: false,
            file_edit_fallback: "unavailable",
            full_access_translation: "luca_scoped_operations_only_native_policy_unchanged",
            surface_navigation: "owner_encrypted_cli",
        }),
        "hermes" => Some(RuntimeCapabilityManifestV1 {
            schema_version: 1,
            family: "hermes",
            availability: "declared_adapter_contract",
            native_capabilities: &[
                "profile_identity",
                "toolsets",
                "skills",
                "plugins",
                "mcps",
                "memory_provider",
                "projects",
                "hooks",
                "computer_use",
                "schedules",
                "native_acp_tools",
            ],
            typed_harness_operations: &["runtime_status", "native_agent_provisioning"],
            native_cli_first: true,
            general_command_fallback: false,
            validates_native_mutations: true,
            file_edit_fallback: "unavailable",
            full_access_translation: "luca_scoped_operations_only_native_policy_unchanged",
            surface_navigation: "unavailable_in_native_session",
        }),
        "openclaw" => Some(RuntimeCapabilityManifestV1 {
            schema_version: 1,
            family: "openclaw",
            availability: "declared_adapter_contract",
            native_capabilities: &[
                "bound_workspace",
                "plugins",
                "skills",
                "mcps",
                "models",
                "memory",
                "tasks",
                "schedules",
                "gateway_tools",
                "exec_policy",
            ],
            typed_harness_operations: &["runtime_status", "native_agent_provisioning"],
            native_cli_first: true,
            general_command_fallback: false,
            validates_native_mutations: true,
            file_edit_fallback: "unavailable",
            full_access_translation: "luca_scoped_operations_only_native_policy_unchanged",
            surface_navigation: "unavailable_in_native_session",
        }),
        "codex" => Some(RuntimeCapabilityManifestV1 {
            schema_version: 1,
            family: "codex",
            availability: "declared_adapter_contract",
            native_capabilities: &[
                "workspace_and_additional_directories",
                "shell",
                "file_edits",
                "tests",
                "web_research",
                "mcps",
                "plugins",
                "skills",
                "subagents",
                "sandbox_modes",
                "approval_policies",
            ],
            typed_harness_operations: &["runtime_status"],
            native_cli_first: false,
            general_command_fallback: false,
            validates_native_mutations: false,
            file_edit_fallback: "unavailable",
            full_access_translation: "luca_scoped_operations_only_native_policy_unchanged",
            surface_navigation: "owner_encrypted_cli",
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_adapters_report_only_implemented_operator_operations() {
        for family in ["codex", "claude_code", "hermes", "openclaw"] {
            let manifest = manifest(family).expect("known adapter manifest");
            assert_eq!(manifest.family, family);
            assert!(!manifest.native_capabilities.is_empty());
            assert!(!manifest.general_command_fallback);
            assert!(manifest.typed_harness_operations.contains(&"runtime_status"));
            assert_eq!(
                manifest.full_access_translation,
                "luca_scoped_operations_only_native_policy_unchanged"
            );
        }
    }

    #[test]
    fn unknown_runtime_is_truthfully_unavailable() {
        assert!(manifest("custom").is_none());
    }

    #[test]
    fn native_sessions_do_not_advertise_unavailable_surface_navigation() {
        for family in ["hermes", "openclaw"] {
            assert_eq!(
                manifest(family).expect("known adapter").surface_navigation,
                "unavailable_in_native_session"
            );
        }
    }
}
