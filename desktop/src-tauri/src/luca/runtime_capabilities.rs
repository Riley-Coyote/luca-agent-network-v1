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
    pub native_capabilities: &'static [&'static str],
    pub typed_harness_operations: &'static [&'static str],
    pub native_cli_first: bool,
    pub general_command_fallback: bool,
    pub validates_native_mutations: bool,
    pub file_edit_fallback: &'static str,
    pub full_access_translation: &'static str,
}

pub(crate) fn manifest(family: &str) -> RuntimeCapabilityManifestV1 {
    let common_operations = &[
        "agents",
        "models_and_providers",
        "skills",
        "plugins",
        "mcps",
        "schedules",
        "permissions",
        "runtime_health",
    ];
    match family {
        "claude_code" => RuntimeCapabilityManifestV1 {
            schema_version: 1,
            family: "claude_code",
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
            typed_harness_operations: common_operations,
            native_cli_first: true,
            general_command_fallback: true,
            validates_native_mutations: true,
            file_edit_fallback: "protected_backup_atomic_replace_validate_restore",
            full_access_translation: "native_bypass_permissions_when_owner_selected",
        },
        "hermes" => RuntimeCapabilityManifestV1 {
            schema_version: 1,
            family: "hermes",
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
            typed_harness_operations: common_operations,
            native_cli_first: true,
            general_command_fallback: true,
            validates_native_mutations: true,
            file_edit_fallback: "protected_backup_atomic_replace_validate_restore",
            full_access_translation: "native_yolo_only_when_owner_selected",
        },
        "openclaw" => RuntimeCapabilityManifestV1 {
            schema_version: 1,
            family: "openclaw",
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
            typed_harness_operations: common_operations,
            native_cli_first: true,
            general_command_fallback: true,
            validates_native_mutations: true,
            file_edit_fallback: "protected_backup_atomic_replace_validate_restore",
            full_access_translation: "native_exec_policy_with_turn_scoped_overlay",
        },
        _ => RuntimeCapabilityManifestV1 {
            schema_version: 1,
            family: "codex",
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
            typed_harness_operations: common_operations,
            native_cli_first: true,
            general_command_fallback: true,
            validates_native_mutations: true,
            file_edit_fallback: "protected_backup_atomic_replace_validate_restore",
            full_access_translation: "native_approval_and_sandbox_policy",
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_supported_adapter_preserves_native_tools_and_future_cli_fallback() {
        for family in ["codex", "claude_code", "hermes", "openclaw"] {
            let manifest = manifest(family);
            assert_eq!(manifest.family, family);
            assert!(!manifest.native_capabilities.is_empty());
            assert!(manifest.general_command_fallback);
            assert!(manifest.native_cli_first);
            assert!(manifest.validates_native_mutations);
            assert!(manifest
                .typed_harness_operations
                .contains(&"runtime_health"));
        }
    }

    #[test]
    fn hermes_yolo_is_never_the_default_translation() {
        assert_eq!(
            manifest("hermes").full_access_translation,
            "native_yolo_only_when_owner_selected"
        );
    }
}
