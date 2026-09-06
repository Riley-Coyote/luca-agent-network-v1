use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::Path,
};

use sha2::{Digest, Sha256};

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

const MAX_MODEL_CONFIG_BYTES: u64 = 256 * 1024;
const FRESH_SETUP: &str = "Configure an explicit provider and model in Hermes for this installation's root profile (hermes -p default model), then review again.";
const FRESH_REVIEW: &str = "The native model preferences changed or were not reviewed. Close this setup and review it again. If its Hermes profile already exists, inspect or roll back that exact profile before starting another creation.";

pub(super) struct FreshModelPreferences {
    values: Mapping,
    provider: String,
    model: String,
    hash: String,
}

fn model_text(value: &Value) -> Result<String, String> {
    let text = value.as_str().ok_or(FRESH_SETUP)?.trim();
    if text.is_empty()
        || text.len() > 512
        || !text
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.:/@+".contains(&byte))
        || text.starts_with("sk-")
        || text.starts_with("sk_")
        || text.starts_with("eyJ")
    {
        return Err(FRESH_SETUP.into());
    }
    Ok(text.to_string())
}

fn empty_model_value(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => true,
        Some(Value::String(value)) => value.is_empty(),
        Some(Value::Mapping(value)) => value.is_empty(),
        Some(Value::Sequence(value)) => value.is_empty(),
        Some(Value::Number(value)) => value.as_f64() == Some(0.0),
        _ => false,
    }
}

fn vetted_url_path(url: &url::Url) -> bool {
    let Some(segments) = url.path_segments() else {
        return false;
    };
    for segment in segments {
        let mut decoded = Vec::new();
        let mut bytes = segment.bytes();
        while let Some(byte) = bytes.next() {
            if byte == b'%' {
                let Some(high) = bytes.next().and_then(|byte| (byte as char).to_digit(16)) else {
                    return false;
                };
                let Some(low) = bytes.next().and_then(|byte| (byte as char).to_digit(16)) else {
                    return false;
                };
                decoded.push((high * 16 + low) as u8);
            } else {
                decoded.push(byte);
            }
        }
        let Ok(decoded) = String::from_utf8(decoded) else {
            return false;
        };
        if decoded
            .split('/')
            .filter(|part| !part.is_empty())
            .any(|part| model_text(&Value::String(part.to_string())).is_err())
        {
            return false;
        }
    }
    true
}

fn model_projection(source: &Value) -> Result<FreshModelPreferences, String> {
    let source = source.as_mapping().ok_or(FRESH_SETUP)?;
    let key = |name: &str| Value::String(name.into());
    let mut model = match source.get(key("model")) {
        Some(Value::Mapping(value)) => value.clone(),
        Some(Value::String(value)) => {
            Mapping::from_iter([(key("default"), Value::String(value.clone()))])
        }
        _ => return Err(FRESH_SETUP.into()),
    };
    // Match Hermes config.py's fallback-only legacy normalization. Never
    // resolve ${ENV} here: credentials and environment policy belong to Hermes.
    for name in ["provider", "base_url", "context_length"] {
        if empty_model_value(model.get(key(name))) {
            if let Some(value) = source
                .get(key(name))
                .filter(|value| !empty_model_value(Some(value)))
            {
                model.insert(key(name), value.clone());
            }
        }
    }
    for value in [
        source.get(key("api_base")).cloned(),
        model.remove(key("api_base")),
    ]
    .into_iter()
    .flatten()
    {
        if empty_model_value(model.get(key("base_url"))) && !empty_model_value(Some(&value)) {
            model.insert(key("base_url"), value);
        }
    }
    if empty_model_value(model.get(key("default"))) {
        if let Some(value) = model.get(key("model")).cloned() {
            model.insert(key("default"), value);
        }
    }
    model.remove(key("model"));
    let provider = model_text(model.get(key("provider")).ok_or(FRESH_SETUP)?)?;
    let name = model_text(model.get(key("default")).ok_or(FRESH_SETUP)?)?;
    if provider.eq_ignore_ascii_case("auto")
        || provider.to_ascii_lowercase().starts_with("custom:")
        || name.eq_ignore_ascii_case("auto")
    {
        return Err(FRESH_SETUP.into());
    }
    // Named providers can supply additional routing/credentials. Copying their
    // name alone would silently change the native route; leave setup to Hermes.
    for name in ["providers", "custom_providers"] {
        if source.get(key(name)).is_some_and(|value| match value {
            Value::Null => false,
            Value::Mapping(value) => !value.is_empty(),
            Value::Sequence(value) => !value.is_empty(),
            _ => true,
        }) {
            return Err(FRESH_SETUP.into());
        }
    }
    const MODEL_KEYS: &[&str] = &[
        "default",
        "provider",
        "base_url",
        "context_length",
        "max_tokens",
        "api_mode",
        "transport",
        "openai_runtime",
    ];
    if model.keys().any(|value| {
        !value
            .as_str()
            .is_some_and(|name| MODEL_KEYS.contains(&name))
    }) {
        return Err(FRESH_SETUP.into());
    }
    let mut vetted = Mapping::new();
    for name in MODEL_KEYS {
        let Some(value) = model.get(key(name)) else {
            continue;
        };
        let value = match *name {
            "context_length" | "max_tokens" => {
                if value.as_u64().filter(|value| *value > 0).is_none() {
                    return Err(FRESH_SETUP.into());
                }
                value.clone()
            }
            "base_url" => {
                let text = value.as_str().ok_or(FRESH_SETUP)?.trim();
                if text.is_empty() {
                    continue;
                }
                let url = url::Url::parse(text).map_err(|_| FRESH_SETUP)?;
                if !matches!(url.scheme(), "https" | "http")
                    || url.host_str().is_none()
                    || !url.username().is_empty()
                    || url.password().is_some()
                    || url.query().is_some()
                    || url.fragment().is_some()
                    || !vetted_url_path(&url)
                    || text.contains('$')
                    || text.contains('{')
                    || text.chars().any(char::is_control)
                {
                    return Err(FRESH_SETUP.into());
                }
                Value::String(text.into())
            }
            _ => Value::String(model_text(value)?),
        };
        vetted.insert(key(name), value);
    }
    let mut values = Mapping::from_iter([(key("model"), Value::Mapping(vetted))]);
    if let Some(agent) = source.get(key("agent")) {
        let agent = agent.as_mapping().ok_or(FRESH_SETUP)?;
        if let Some(effort) = agent
            .get(key("reasoning_effort"))
            .filter(|value| !empty_model_value(Some(value)))
        {
            values.insert(
                key("agent"),
                Value::Mapping(Mapping::from_iter([(
                    key("reasoning_effort"),
                    Value::String(model_text(effort)?),
                )])),
            );
        }
    }
    let bytes = serde_json::to_vec(&values).map_err(|_| FRESH_SETUP)?;
    Ok(FreshModelPreferences {
        values,
        provider,
        model: name,
        hash: hex::encode(Sha256::digest(bytes)),
    })
}

#[cfg(unix)]
#[derive(PartialEq, Eq)]
struct ConfigIdentity {
    device: u64,
    inode: u64,
    length: u64,
    modified: (i64, i64),
    changed: (i64, i64),
}

#[cfg(unix)]
fn config_identity(metadata: &fs::Metadata) -> Result<ConfigIdentity, String> {
    use std::os::unix::fs::MetadataExt;
    if !metadata.is_file() || metadata.nlink() != 1 || metadata.len() > MAX_MODEL_CONFIG_BYTES {
        return Err(FRESH_SETUP.into());
    }
    Ok(ConfigIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
        length: metadata.len(),
        modified: (metadata.mtime(), metadata.mtime_nsec()),
        changed: (metadata.ctime(), metadata.ctime_nsec()),
    })
}

#[cfg(unix)]
fn read_model_preferences(home: &Path) -> Result<FreshModelPreferences, String> {
    use rustix::fs::{open, openat, Mode, OFlags};
    use std::os::unix::fs::MetadataExt;
    if home.canonicalize().map_err(|_| FRESH_SETUP)? != home {
        return Err(FRESH_SETUP.into());
    }
    let directory = fs::File::from(
        open(
            home,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| FRESH_SETUP)?,
    );
    let mut file = fs::File::from(
        openat(
            &directory,
            "config.yaml",
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| FRESH_SETUP)?,
    );
    let before = config_identity(&file.metadata().map_err(|_| FRESH_SETUP)?)?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(MAX_MODEL_CONFIG_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| FRESH_SETUP)?;
    let current = fs::symlink_metadata(home.join("config.yaml")).map_err(|_| FRESH_SETUP)?;
    let dir = fs::metadata(home).map_err(|_| FRESH_SETUP)?;
    let opened = directory.metadata().map_err(|_| FRESH_SETUP)?;
    if bytes.len() as u64 > MAX_MODEL_CONFIG_BYTES
        || current.file_type().is_symlink()
        || config_identity(&current)? != before
        || config_identity(&file.metadata().map_err(|_| FRESH_SETUP)?)? != before
        || dir.dev() != opened.dev()
        || dir.ino() != opened.ino()
        || home.canonicalize().map_err(|_| FRESH_SETUP)? != home
    {
        return Err(FRESH_SETUP.into());
    }
    model_projection(&serde_yaml::from_slice::<Value>(&bytes).map_err(|_| FRESH_SETUP)?)
}

#[cfg(not(unix))]
fn read_model_preferences(_home: &Path) -> Result<FreshModelPreferences, String> {
    Err(FRESH_SETUP.into())
}

pub(super) fn fresh_preferences(
    source: &crate::managed_agents::RuntimeBinding,
) -> Result<FreshModelPreferences, String> {
    let (_, home, _, _) = source.hermes_provisioning_context().ok_or(FRESH_SETUP)?;
    read_model_preferences(&crate::managed_agents::hermes_profile_root(&home)?)
}

impl FreshModelPreferences {
    pub(super) fn bind_review(&self, journal: &mut HermesJournal) {
        journal.fresh_model_preferences_hash = Some(self.hash.clone());
    }

    #[cfg(unix)]
    fn write_new_profile(&self, journal: &HermesJournal) -> Result<(), String> {
        use rustix::fs::{open, openat, Mode, OFlags};
        use std::os::unix::fs::MetadataExt;
        journal.verify_created()?;
        let directory = fs::File::from(
            open(
                &journal.destination,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| FRESH_REVIEW)?,
        );
        journal.verify_created()?;
        let current = fs::metadata(&journal.destination).map_err(|_| FRESH_REVIEW)?;
        let opened = directory.metadata().map_err(|_| FRESH_REVIEW)?;
        if current.dev() != opened.dev() || current.ino() != opened.ino() {
            return Err(FRESH_REVIEW.into());
        }
        // Native Fresh creates no config. Refuse an unexpected existing entry,
        // and write relative to the verified directory handle, never a raced path.
        let mut file = fs::File::from(openat(&directory, "config.yaml", OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC, Mode::from_raw_mode(0o600)).map_err(|_| "The new Hermes configuration already exists or cannot be safely written. Review this exact profile before recovery.")?);
        let bytes = serde_yaml::to_string(&self.values).map_err(|_| FRESH_REVIEW)?;
        file.write_all(bytes.as_bytes()).and_then(|_| file.sync_all()).map_err(|_| "The new Hermes model preferences could not be saved. Review this exact profile before recovery.")?;
        journal.verify_created()
    }

    #[cfg(not(unix))]
    fn write_new_profile(&self, _journal: &HermesJournal) -> Result<(), String> {
        Err(FRESH_SETUP.into())
    }
}

fn require_fresh_review(
    journal: &HermesJournal,
    mode: &AgentProvisioningModeV1,
) -> Result<(), String> {
    if *mode == AgentProvisioningModeV1::Fresh && journal.fresh_model_preferences_hash.is_none() {
        return Err(FRESH_REVIEW.into());
    }
    Ok(())
}

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
    fresh: Option<&FreshModelPreferences>,
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
    if let Some(fresh) = fresh {
        changes.push(NativeProvisioningChangeV1 {
            subject: "Native model preferences".into(),
            action: "Inherit".into(),
            detail: format!("Use {} with {}, from this Hermes installation's root settings. Memory, sessions and credentials are not copied.", fresh.model, fresh.provider),
        });
    }
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
    require_fresh_review(journal, &request.mode)?;
    let executable = verify_version(journal)?;
    let fresh = if request.mode == AgentProvisioningModeV1::Fresh {
        let preferences = read_model_preferences(&journal.root)?;
        if journal.fresh_model_preferences_hash.as_ref() != Some(&preferences.hash) {
            return Err(FRESH_REVIEW.into());
        }
        Some(preferences)
    } else {
        None
    };
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
    if let Some(preferences) = fresh {
        preferences.write_new_profile(journal)?;
    } else {
        apply_clone(
            request,
            &source_home,
            workspace.as_deref(),
            &journal.destination,
        )?;
    }
    let binding = journal.binding()?;
    journal.configured = true;
    journal.save(path)?;
    Ok(ProvisionedNative { binding })
}

pub(super) fn candidate(
    journal: &HermesJournal,
    mode: &AgentProvisioningModeV1,
) -> Result<DiscoveredResidentCandidate, String> {
    require_fresh_review(journal, mode)?;
    if !journal.configured {
        return Err(
            "The native profile has not completed its reviewed setup. Review it before linking."
                .into(),
        );
    }
    let binding = journal.binding()?;
    if *mode == AgentProvisioningModeV1::Fresh {
        let preferences = read_model_preferences(&journal.destination).map_err(|_| FRESH_REVIEW)?;
        if journal.fresh_model_preferences_hash.as_ref() != Some(&preferences.hash) {
            return Err(FRESH_REVIEW.into());
        }
    }
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
