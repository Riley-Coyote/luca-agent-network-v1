use std::{collections::BTreeMap, fs, path::Path};

use serde_yaml::{Mapping, Value};

use super::{
    hermes_journal::{HermesJournal, ProfileGuard},
    run_native_command, NativeProvisioningChangeV1, NativeProvisioningPreviewV1,
    NativeProvisioningRequestV1, ProvisionedNative,
};
use crate::{
    luca::operator_forge::{AgentProvisioningModeV1, NativeRuntimeFamilyV1},
    managed_agents::DiscoveredResidentCandidate,
};

const MAX_CLONE_FILES: usize = 512;
const MAX_CLONE_BYTES: u64 = 32 * 1024 * 1024;

pub(super) fn ensure_name_available(
    source: &DiscoveredResidentCandidate,
    slug: &str,
) -> Result<(), String> {
    HermesJournal::prepare("", "", "", source.binding_preview.clone(), slug).map(|_| ())
}

pub(super) fn preview(
    request: &NativeProvisioningRequestV1,
    source: &DiscoveredResidentCandidate,
    transaction_id: String,
    slug: String,
) -> NativeProvisioningPreviewV1 {
    let mut changes = vec![
        NativeProvisioningChangeV1 {
            subject: "Hermes profile".into(),
            action: "Create".into(),
            detail: format!("Create the isolated profile {slug}."),
        },
        NativeProvisioningChangeV1 {
            subject: "Polyphonic resident".into(),
            action: "Link".into(),
            detail: "Create one stable resident identity and link it to the new profile.".into(),
        },
    ];
    if request.mode != AgentProvisioningModeV1::Fresh {
        changes.push(NativeProvisioningChangeV1 {
            subject: "Template".into(),
            action: "Copy selected".into(),
            detail: "Copy only reviewed instructions, model preferences, and selected skills. Credentials and sessions remain excluded.".into(),
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
        runtime: NativeRuntimeFamilyV1::Hermes,
        mode: request.mode.clone(),
        intended_slug: slug,
        source_label: (request.mode != AgentProvisioningModeV1::Fresh)
            .then(|| source.display_name.clone()),
        changes,
        permission_defaults: "Hermes-owned authentication; no schedules, gateways, or external bindings are created.".into(),
        recovery_action: "If creation fails, remove only the incomplete new profile. The selected source is never modified.".into(),
    }
}

fn contains_sensitive_key(value: &Value) -> bool {
    match value {
        Value::Mapping(mapping) => mapping.iter().any(|(key, value)| {
            key.as_str().is_some_and(|key| {
                let key = key.to_ascii_lowercase();
                ["key", "token", "secret", "password", "credential", "auth"]
                    .iter()
                    .any(|needle| key.contains(needle))
            }) || contains_sensitive_key(value)
        }),
        Value::Sequence(values) => values.iter().any(contains_sensitive_key),
        _ => false,
    }
}

fn copy_model_preferences(source: &Path, destination: &Path) -> Result<(), String> {
    let source_path = source.join("config.yaml");
    if !source_path.is_file() {
        return Ok(());
    }
    let source_value: Value = serde_yaml::from_slice(
        &fs::read(&source_path).map_err(|_| "Hermes model preferences could not be read")?,
    )
    .map_err(|_| "Hermes model preferences are invalid")?;
    let source_mapping = source_value
        .as_mapping()
        .ok_or_else(|| "Hermes model preferences are invalid".to_string())?;
    let destination_path = destination.join("config.yaml");
    let mut destination_value: Value = if destination_path.is_file() {
        serde_yaml::from_slice(
            &fs::read(&destination_path)
                .map_err(|_| "new Hermes configuration could not be read")?,
        )
        .map_err(|_| "new Hermes configuration is invalid")?
    } else {
        Value::Mapping(Mapping::new())
    };
    let destination_mapping = destination_value
        .as_mapping_mut()
        .ok_or_else(|| "new Hermes configuration is invalid".to_string())?;
    for key in ["model", "reasoning", "temperature"] {
        let yaml_key = Value::String(key.into());
        if let Some(value) = source_mapping.get(&yaml_key) {
            if contains_sensitive_key(value) {
                return Err("Hermes model preferences contain credential-shaped fields".into());
            }
            destination_mapping.insert(yaml_key, value.clone());
        }
    }
    let bytes = serde_yaml::to_string(&destination_value)
        .map_err(|_| "new Hermes configuration could not be encoded")?;
    fs::write(destination_path, bytes)
        .map_err(|_| "new Hermes model preferences could not be saved".to_string())
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
    let mut stack = vec![(source_root.clone(), destination.to_path_buf())];
    let mut files = 0usize;
    let mut bytes = 0u64;
    while let Some((current_source, current_destination)) = stack.pop() {
        fs::create_dir_all(&current_destination)
            .map_err(|_| "clone destination could not be prepared")?;
        for entry in fs::read_dir(&current_source).map_err(|_| "clone source could not be read")? {
            let entry = entry.map_err(|_| "clone source could not be read")?;
            let metadata = entry
                .file_type()
                .map_err(|_| "clone source could not be inspected")?;
            if metadata.is_symlink() {
                return Err("clone sources may not contain symlinks".into());
            }
            let destination_entry = current_destination.join(entry.file_name());
            if metadata.is_dir() {
                stack.push((entry.path(), destination_entry));
            } else if metadata.is_file() {
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
    source_home: &Path,
    source_workspace: Option<&Path>,
    destination_home: &Path,
) -> Result<(), String> {
    if request.mode == AgentProvisioningModeV1::Fresh {
        return Ok(());
    }
    copy_model_preferences(source_home, destination_home)?;
    for skill in &request.selected_skills {
        copy_tree_bounded(
            &source_home.join("skills").join(skill),
            &destination_home.join("skills").join(skill),
        )?;
    }
    if request.mode == AgentProvisioningModeV1::Advanced {
        if request.include_memory {
            for directory in ["memory", "memories"] {
                copy_tree_bounded(
                    &source_home.join(directory),
                    &destination_home.join(directory),
                )?;
            }
        }
        if !request.workspace_documents.is_empty() {
            let source_workspace = source_workspace
                .ok_or_else(|| "selected Hermes profile has no verified workspace".to_string())?;
            for document in &request.workspace_documents {
                copy_file_bounded(
                    &source_workspace.join(document),
                    &destination_home.join("workspace").join(document),
                )?;
            }
        }
    }
    Ok(())
}

fn native_environment(journal: &HermesJournal) -> BTreeMap<String, String> {
    BTreeMap::from([("HERMES_HOME".into(), journal.root.display().to_string())])
}

fn verify_version(journal: &HermesJournal) -> Result<std::path::PathBuf, String> {
    journal.validate_scope()?;
    let crate::managed_agents::RuntimeBinding::Hermes {
        executable_path,
        runtime_version,
        ..
    } = &journal.source
    else {
        return Err("Hermes setup provenance is invalid.".into());
    };
    let output = run_native_command(
        executable_path,
        &["--version".into()],
        &native_environment(journal),
    )?;
    let bytes = if output.stdout.is_empty() {
        &output.stderr
    } else {
        &output.stdout
    };
    let plain = strip_ansi_escapes::strip(bytes);
    if !output.status.success() || String::from_utf8_lossy(&plain).trim() != runtime_version {
        return Err("Hermes changed since this setup was reviewed. Review the native runtime before retrying.".into());
    }
    Ok(executable_path.clone())
}

fn check_new_profile_writes(destination: &Path) -> Result<(), String> {
    let mut directories = vec![destination.to_path_buf()];
    let mut entries = 0;
    while let Some(directory) = directories.pop() {
        for entry in
            fs::read_dir(directory).map_err(|_| "New Hermes profile could not be inspected.")?
        {
            let entry = entry.map_err(|_| "New Hermes profile could not be inspected.")?;
            let metadata = fs::symlink_metadata(entry.path())
                .map_err(|_| "New Hermes profile could not be inspected.")?;
            entries += 1;
            if entries > 10_000 || metadata.file_type().is_symlink() {
                return Err("New Hermes profile contains links or too many entries for safe setup. Review it in Hermes.".into());
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if metadata.is_file() && metadata.nlink() != 1 {
                    return Err(
                        "New Hermes profile contains a shared file; setup was stopped.".into(),
                    );
                }
            }
            if metadata.is_dir() {
                directories.push(entry.path());
            }
        }
    }
    Ok(())
}

pub(super) fn execute(
    request: &NativeProvisioningRequestV1,
    journal: &mut HermesJournal,
    path: &Path,
) -> Result<ProvisionedNative, String> {
    let _profile = ProfileGuard::acquire(journal)?;
    journal.ensure_available()?;
    let executable = verify_version(journal)?;
    // Persisted before the command; failed/ambiguous creation is never replayed.
    journal.save(path)?;
    let output = run_native_command(
        &executable,
        &[
            "profile".into(),
            "create".into(),
            journal.slug.clone(),
            "--no-alias".into(),
            "--description".into(),
            request.system_prompt.chars().take(240).collect(),
        ],
        &native_environment(journal),
    )?;
    if !output.status.success() {
        return Err("Hermes profile creation failed. Review native setup before recovery.".into());
    }
    journal.witness_creation()?;
    journal.save(path)?;
    journal.verify_created()?;
    check_new_profile_writes(&journal.destination)?;
    fs::write(journal.destination.join("SOUL.md"), &request.system_prompt)
        .map_err(|_| "Hermes role instructions could not be saved")?;
    let (_, source_home, _, workspace) = journal
        .source
        .hermes_provisioning_context()
        .ok_or("Selected source is not a Hermes profile.")?;
    apply_clone(
        request,
        &source_home,
        workspace.as_deref(),
        &journal.destination,
    )?;
    let binding = journal.binding()?;
    journal.configured = true;
    journal.save(path)?;
    Ok(ProvisionedNative { binding })
}

pub(super) fn candidate(journal: &HermesJournal) -> Result<DiscoveredResidentCandidate, String> {
    if !journal.configured {
        return Err(
            "The native profile has not completed its reviewed setup. Review it before linking."
                .into(),
        );
    }
    let binding = journal.binding()?;
    let crate::managed_agents::RuntimeBinding::Hermes {
        runtime_version, ..
    } = &binding
    else {
        return Err("Expected Hermes provenance.".into());
    };
    Ok(DiscoveredResidentCandidate {
        native_type: crate::managed_agents::NativeRuntimeKind::Hermes,
        native_id: journal.slug.clone(),
        semantic_id: crate::managed_agents::native_runtime_semantic_key(&binding),
        binding_fingerprint: crate::managed_agents::native_runtime_binding_fingerprint(&binding),
        display_name: journal.slug.clone(),
        canonical_location: Some(journal.destination.clone()),
        workspace: None,
        model_summary: None,
        runtime_version: Some(runtime_version.clone()),
        readiness: crate::managed_agents::ResidentReadiness::Discovered {
            message: "Exact created Hermes profile verified; session readiness is not yet tested."
                .into(),
        },
        warnings: Vec::new(),
        binding_preview: binding,
    })
}

pub(super) fn rollback(journal: &mut HermesJournal, path: &Path) -> Result<(), String> {
    let home = dirs::home_dir().ok_or(
        "Native home is unavailable. Remove the incomplete profile in Hermes after review.",
    )?;
    rollback_at_home(journal, path, &home)
}

pub(super) fn rollback_at_home(
    journal: &mut HermesJournal,
    path: &Path,
    home: &Path,
) -> Result<(), String> {
    let _profile = ProfileGuard::acquire(journal)?;
    if journal.removed {
        return match fs::symlink_metadata(&journal.destination) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            _ => Err(
                "The removed profile location has been reused. No further cleanup was performed."
                    .into(),
            ),
        };
    }
    journal.verify_created()?;
    let executable = verify_version(journal)?;
    let crate::managed_agents::RuntimeBinding::Hermes {
        runtime_version, ..
    } = &journal.source
    else {
        return Err("Expected Hermes provenance.".into());
    };
    if !runtime_version
        .split_whitespace()
        .any(|part| matches!(part, "0.17.0" | "v0.17.0"))
    {
        return Err("Safe automatic cleanup is not verified for this Hermes version. Review and remove the incomplete profile in Hermes.".into());
    }
    // Hermes 0.17 delete also removes global slug aliases/services. A profile
    // created with --no-alias has no authority to remove those shared objects.
    let conflicts = [
        home.join(".local/bin").join(&journal.slug),
        home.join("Library/LaunchAgents")
            .join(format!("ai.hermes.gateway-{}.plist", journal.slug)),
        home.join(".config/systemd/user")
            .join(format!("hermes-gateway-{}.service", journal.slug)),
        std::path::PathBuf::from("/run/service").join(format!("gateway-{}", journal.slug)),
        journal.destination.join("gateway.pid"),
        journal.destination.join("gateway_state.json"),
        journal.destination.join("processes.json"),
    ];
    for conflict in conflicts {
        match fs::symlink_metadata(conflict) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err("A native alias, service, or runtime activity may share this profile name. Review cleanup in Hermes; nothing was removed.".into()),
        }
    }
    journal.verify_created()?;
    let output = run_native_command(
        &executable,
        &[
            "profile".into(),
            "delete".into(),
            journal.slug.clone(),
            "-y".into(),
        ],
        &native_environment(journal),
    )?;
    if !output.status.success()
        || !matches!(fs::symlink_metadata(&journal.destination), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
    {
        return Err(
            "Hermes cleanup could not be confirmed. Review the incomplete profile before retrying."
                .into(),
        );
    }
    journal.removed = true;
    journal.save(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_template_copy_excludes_credentials_and_sessions() {
        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        fs::write(
            source.path().join("config.yaml"),
            "model:\n  default: anthropic/sonnet\nauth:\n  token: SECRET\n",
        )
        .unwrap();
        fs::write(source.path().join(".env"), "API_KEY=SECRET").unwrap();
        fs::create_dir_all(source.path().join("sessions")).unwrap();
        fs::write(source.path().join("sessions/history.json"), "SECRET").unwrap();
        fs::create_dir_all(source.path().join("skills/research")).unwrap();
        fs::write(
            source.path().join("skills/research/SKILL.md"),
            "Research carefully.",
        )
        .unwrap();
        let request = NativeProvisioningRequestV1 {
            display_name: "Research".into(),
            system_prompt: "Research carefully.".into(),
            runtime: NativeRuntimeFamilyV1::Hermes,
            mode: AgentProvisioningModeV1::Template,
            source_semantic_id: Some("source".into()),
            selected_skills: vec!["research".into()],
            include_memory: false,
            workspace_documents: Vec::new(),
        };

        apply_clone(&request, source.path(), None, destination.path()).unwrap();

        let config = fs::read_to_string(destination.path().join("config.yaml")).unwrap();
        assert!(config.contains("anthropic/sonnet"));
        assert!(!config.contains("SECRET"));
        assert!(destination
            .path()
            .join("skills/research/SKILL.md")
            .is_file());
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
