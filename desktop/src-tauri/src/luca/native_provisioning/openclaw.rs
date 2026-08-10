use std::{collections::BTreeMap, fs, path::Path};

use serde::Deserialize;

use super::{
    run_native_command, NativeProvisioningChangeV1, NativeProvisioningPreviewV1,
    NativeProvisioningRequestV1, ProvisionedNative,
};
use crate::{
    luca::operator_forge::{AgentProvisioningModeV1, NativeRuntimeFamilyV1},
    managed_agents::{DiscoveredResidentCandidate, NativeRuntimeKind},
};

const MAX_CLONE_FILES: usize = 512;
const MAX_CLONE_BYTES: u64 = 32 * 1024 * 1024;

pub(super) fn ensure_name_available(slug: &str) -> Result<(), String> {
    let exists = crate::managed_agents::discover_native_resident_outcome()
        .runtimes
        .into_iter()
        .flat_map(|runtime| runtime.candidates)
        .any(|candidate| {
            candidate.native_type == NativeRuntimeKind::Openclaw && candidate.native_id == slug
        });
    if exists {
        return Err("an OpenClaw agent with this name already exists".into());
    }
    Ok(())
}

pub(super) fn preview(
    request: &NativeProvisioningRequestV1,
    source: &DiscoveredResidentCandidate,
    transaction_id: String,
    slug: String,
) -> NativeProvisioningPreviewV1 {
    let mut changes = vec![
        NativeProvisioningChangeV1 {
            subject: "OpenClaw agent".into(),
            action: "Create".into(),
            detail: format!("Create {slug} with an isolated workspace and agent directory."),
        },
        NativeProvisioningChangeV1 {
            subject: "Identity".into(),
            action: "Configure".into(),
            detail: "Apply the reviewed name and role through supported OpenClaw commands and instruction files.".into(),
        },
        NativeProvisioningChangeV1 {
            subject: "Polyphonic resident".into(),
            action: "Link".into(),
            detail: "Create one stable resident identity and link it to the new native agent.".into(),
        },
    ];
    if request.mode != AgentProvisioningModeV1::Fresh {
        changes.push(NativeProvisioningChangeV1 {
            subject: "Template".into(),
            action: "Copy selected".into(),
            detail: "Copy only allowlisted instructions, reviewed model behavior, and selected skills. Credentials, sessions, routes, and schedules remain excluded.".into(),
        });
    }
    if request.mode == AgentProvisioningModeV1::Advanced {
        changes.push(NativeProvisioningChangeV1 {
            subject: "Advanced clone".into(),
            action: "Copy selected".into(),
            detail: "Copy only the memory and workspace documents selected in this review.".into(),
        });
    }
    NativeProvisioningPreviewV1 {
        schema_version: 1,
        transaction_id,
        display_name: request.display_name.clone(),
        runtime: NativeRuntimeFamilyV1::Openclaw,
        mode: request.mode.clone(),
        intended_slug: slug,
        source_label: (request.mode != AgentProvisioningModeV1::Fresh)
            .then(|| source.display_name.clone()),
        changes,
        permission_defaults: "OpenClaw-owned authentication and isolation; no routes, schedules, or credential copies are created.".into(),
        recovery_action: "If creation fails, Polyphonic uses OpenClaw's supported delete command and reports any retained workspace.".into(),
    }
}

fn command_environment(state_directory: &Path) -> BTreeMap<String, String> {
    BTreeMap::from([(
        "OPENCLAW_STATE_DIR".into(),
        state_directory.display().to_string(),
    )])
}

fn copy_file_bounded(source: &Path, destination: &Path) -> Result<u64, String> {
    let metadata =
        fs::symlink_metadata(source).map_err(|_| "selected clone file is unavailable")?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("selected clone file must be a regular file".into());
    }
    if metadata.len() > MAX_CLONE_BYTES {
        return Err("selected clone file is too large".into());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|_| "clone destination could not be prepared")?;
    }
    fs::copy(source, destination).map_err(|_| "selected clone file could not be copied")?;
    Ok(metadata.len())
}

fn copy_tree_bounded(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    let source_root = source
        .canonicalize()
        .map_err(|_| "selected clone directory is unavailable")?;
    let mut stack = vec![(source_root, destination.to_path_buf())];
    let mut files = 0usize;
    let mut bytes = 0u64;
    while let Some((current_source, current_destination)) = stack.pop() {
        fs::create_dir_all(&current_destination)
            .map_err(|_| "clone destination could not be prepared")?;
        for entry in fs::read_dir(current_source).map_err(|_| "clone source could not be read")? {
            let entry = entry.map_err(|_| "clone source could not be read")?;
            let file_type = entry
                .file_type()
                .map_err(|_| "clone source could not be inspected")?;
            if file_type.is_symlink() {
                return Err("clone sources may not contain symlinks".into());
            }
            let destination_entry = current_destination.join(entry.file_name());
            if file_type.is_dir() {
                stack.push((entry.path(), destination_entry));
            } else if file_type.is_file() {
                files += 1;
                bytes += copy_file_bounded(&entry.path(), &destination_entry)?;
                if files > MAX_CLONE_FILES || bytes > MAX_CLONE_BYTES {
                    return Err("selected clone content exceeds safe limits".into());
                }
            }
        }
    }
    Ok(())
}

fn apply_clone(
    request: &NativeProvisioningRequestV1,
    source_workspace: Option<&Path>,
    destination_workspace: &Path,
) -> Result<(), String> {
    if request.mode == AgentProvisioningModeV1::Fresh {
        return Ok(());
    }
    let source_workspace = source_workspace
        .ok_or_else(|| "selected OpenClaw agent has no verified workspace".to_string())?;
    for instruction in ["AGENTS.md", "IDENTITY.md", "USER.md"] {
        let source = source_workspace.join(instruction);
        if source.is_file() {
            copy_file_bounded(&source, &destination_workspace.join(instruction))?;
        }
    }
    for skill in &request.selected_skills {
        copy_tree_bounded(
            &source_workspace.join("skills").join(skill),
            &destination_workspace.join("skills").join(skill),
        )?;
    }
    if request.mode == AgentProvisioningModeV1::Advanced {
        if request.include_memory {
            for directory in ["memory", "memories"] {
                copy_tree_bounded(
                    &source_workspace.join(directory),
                    &destination_workspace.join(directory),
                )?;
            }
        }
        for document in &request.workspace_documents {
            copy_file_bounded(
                &source_workspace.join(document),
                &destination_workspace.join(document),
            )?;
        }
    }
    Ok(())
}

pub(super) fn execute(
    request: &NativeProvisioningRequestV1,
    source: &DiscoveredResidentCandidate,
    slug: &str,
) -> Result<ProvisionedNative, String> {
    let (_, executable, state_directory, source_workspace) =
        crate::managed_agents::openclaw_provisioning_context(&source.binding_preview)
            .ok_or_else(|| "selected source is not an OpenClaw agent".to_string())?;
    let state_directory = state_directory
        .canonicalize()
        .map_err(|_| "OpenClaw state directory is unavailable")?;
    let workspace = state_directory.join(format!("workspace-{slug}"));
    let agent_directory = state_directory.join("agents").join(slug).join("agent");
    let mut args = vec![
        "agents".into(),
        "add".into(),
        slug.into(),
        "--workspace".into(),
        workspace.display().to_string(),
        "--agent-dir".into(),
        agent_directory.display().to_string(),
    ];
    if request.mode != AgentProvisioningModeV1::Fresh {
        if let Some(model) = source
            .model_summary
            .as_ref()
            .filter(|model| !model.trim().is_empty())
        {
            args.push("--model".into());
            args.push(model.clone());
        }
    }
    args.extend(["--non-interactive".into(), "--json".into()]);
    let environment = command_environment(&state_directory);
    let output = run_native_command(&executable, &args, &environment)?;
    if !output.status.success() {
        return Err("OpenClaw agent creation failed".into());
    }
    let workspace = workspace
        .canonicalize()
        .map_err(|_| "OpenClaw created a workspace at an unexpected location")?;
    if !workspace.starts_with(&state_directory) {
        return Err("OpenClaw workspace escaped its expected state directory".into());
    }
    apply_clone(request, source_workspace.as_deref(), &workspace)?;
    fs::write(workspace.join("SOUL.md"), &request.system_prompt)
        .map_err(|_| "OpenClaw role instructions could not be saved")?;
    let identity_output = run_native_command(
        &executable,
        &[
            "agents".into(),
            "set-identity".into(),
            "--agent".into(),
            slug.into(),
            "--name".into(),
            request.display_name.clone(),
            "--json".into(),
        ],
        &environment,
    )?;
    if !identity_output.status.success() {
        return Err("OpenClaw agent identity could not be configured".into());
    }
    let validation = run_native_command(
        &executable,
        &["config".into(), "validate".into(), "--json".into()],
        &environment,
    )?;
    if !validation.status.success() {
        return Err("OpenClaw configuration validation failed".into());
    }
    let binding = crate::managed_agents::with_openclaw_agent(
        &source.binding_preview,
        slug.to_string(),
        workspace,
    )
    .ok_or_else(|| "OpenClaw binding could not be prepared".to_string())?;
    crate::managed_agents::resolve_native_runtime_binding(&binding)?;
    Ok(ProvisionedNative { binding })
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteResult {
    #[serde(default)]
    workspace_retained: bool,
}

pub(super) fn rollback(slug: &str) -> Result<bool, String> {
    let candidate = crate::managed_agents::discover_native_resident_outcome()
        .runtimes
        .into_iter()
        .flat_map(|runtime| runtime.candidates)
        .find(|candidate| {
            candidate.native_type == NativeRuntimeKind::Openclaw && candidate.native_id == slug
        })
        .ok_or_else(|| "OpenClaw agent is unavailable for rollback".to_string())?;
    let (_, executable, state_directory, _) =
        crate::managed_agents::openclaw_provisioning_context(&candidate.binding_preview)
            .ok_or_else(|| "OpenClaw rollback binding is invalid".to_string())?;
    let output = run_native_command(
        &executable,
        &[
            "agents".into(),
            "delete".into(),
            slug.into(),
            "--force".into(),
            "--json".into(),
        ],
        &command_environment(&state_directory),
    )?;
    if !output.status.success() {
        return Err("OpenClaw could not remove the incomplete agent".into());
    }
    Ok(serde_json::from_slice::<DeleteResult>(&output.stdout)
        .unwrap_or_default()
        .workspace_retained)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_clone_copies_only_allowlisted_content() {
        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        fs::write(source.path().join("AGENTS.md"), "Template instructions").unwrap();
        fs::write(source.path().join("SOUL.md"), "Old role").unwrap();
        fs::write(source.path().join(".env"), "TOKEN=SECRET").unwrap();
        fs::create_dir_all(source.path().join("sessions")).unwrap();
        fs::write(source.path().join("sessions/history.json"), "SECRET").unwrap();
        fs::create_dir_all(source.path().join("skills/research")).unwrap();
        fs::write(source.path().join("skills/research/SKILL.md"), "Research").unwrap();
        let request = NativeProvisioningRequestV1 {
            display_name: "Research".into(),
            system_prompt: "New role".into(),
            runtime: NativeRuntimeFamilyV1::Openclaw,
            mode: AgentProvisioningModeV1::Template,
            source_semantic_id: Some("source".into()),
            selected_skills: vec!["research".into()],
            include_memory: false,
            workspace_documents: Vec::new(),
        };

        apply_clone(&request, Some(source.path()), destination.path()).unwrap();

        assert!(destination.path().join("AGENTS.md").is_file());
        assert!(destination
            .path()
            .join("skills/research/SKILL.md")
            .is_file());
        assert!(!destination.path().join("SOUL.md").exists());
        assert!(!destination.path().join(".env").exists());
        assert!(!destination.path().join("sessions").exists());
    }

    #[cfg(unix)]
    #[test]
    fn clone_rejects_symlinks() {
        use std::os::unix::fs::symlink;

        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        fs::create_dir_all(source.path().join("skills/research")).unwrap();
        symlink(
            source.path().join(".env"),
            source.path().join("skills/research/secret"),
        )
        .unwrap();
        assert!(copy_tree_bounded(
            &source.path().join("skills/research"),
            &destination.path().join("research")
        )
        .is_err());
    }
}
