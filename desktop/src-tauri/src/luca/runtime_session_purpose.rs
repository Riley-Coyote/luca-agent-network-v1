//! Local purpose records for provider sessions created by Polyphonic.
//!
//! The native runtime remains the owner of its session history. Polyphonic
//! keeps only a body-free exclusion ledger so resident conversation and
//! internal continuity sessions never reappear as user-selectable Brain
//! context. Explicit runtime tasks are retained as ordinary user work.

use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
};

use serde::Deserialize;

pub(crate) const SESSION_PURPOSE_STORE_ENV: &str = "LUCA_RUNTIME_SESSION_PURPOSE_STORE";
pub(crate) const SESSION_RUNTIME_FAMILY_ENV: &str = "LUCA_MANAGED_RUNTIME_FAMILY";
pub(crate) const SESSION_MAP_ENV: &str = "LUCA_RUNTIME_SESSION_MAP";
pub(crate) const SESSION_IDENTITY_ENV: &str = "LUCA_RUNTIME_SESSION_IDENTITY_REF";
pub(crate) const SESSION_RELAY_SCOPE_ENV: &str = "LUCA_RUNTIME_SESSION_RELAY_SCOPE";

const STORE_DIRECTORY: &str = "runtime-session-purposes";
const STORE_PROTOCOL: &str = "polyphonic.runtime-session-purpose.v1";
const MAX_RECORD_BYTES: usize = 16 * 1024;
const MAX_STORE_FILES: usize = 512;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSessionPurposeRecordV1 {
    protocol: String,
    provider_session_id: String,
    runtime_family: String,
    purpose: RuntimeSessionPurposeV1,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum RuntimeSessionPurposeV1 {
    ResidentConversation,
    ContinuityInternal,
    ExplicitRuntimeTask,
}

pub(crate) fn prepare_resident_store(
    app_data_dir: &Path,
    resident_pubkey: &str,
) -> Result<PathBuf, String> {
    if resident_pubkey.len() != 64
        || !resident_pubkey
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("runtime session purpose resident is invalid".to_owned());
    }
    let directory = app_data_dir.join("luca").join(STORE_DIRECTORY);
    fs::create_dir_all(&directory)
        .map_err(|_| "create runtime session purpose store".to_owned())?;
    let path = directory.join(format!("{resident_pubkey}.jsonl"));
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|_| "open runtime session purpose store".to_owned())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| "secure runtime session purpose directory".to_owned())?;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| "secure runtime session purpose store".to_owned())?;
    }
    Ok(path)
}

/// The app-owned relay's loopback port changes on restart; its conversation
/// namespace does not. Arbitrary loopback servers must remain distinct.
pub(crate) fn native_session_relay_scope(
    effective_url: &str,
    supervised_local_url: Option<&str>,
    owner_pubkey: &str,
) -> String {
    use sha2::{Digest, Sha256};
    let logical_url = if supervised_local_url == Some(effective_url) {
        crate::local_relay::LOCAL_RELAY_SENTINEL
    } else {
        effective_url
    };
    let material = format!("polyphonic.native-relay-scope.v1\0{owner_pubkey}\0{logical_url}");
    format!(
        "sha256:{}",
        hex::encode(Sha256::digest(material.as_bytes()))
    )
}

/// Identify the provider-owned transcript store independently of mutable model,
/// permission, prompt, and build settings. This is a history locator, not a grant.
pub(crate) fn native_session_identity_ref(
    family: &str,
    runtime_identifier: &str,
    native_semantic_key: Option<&str>,
    command: &std::process::Command,
) -> String {
    use sha2::{Digest, Sha256};
    let mut digest = Sha256::new();
    let mut add = |value: &[u8]| {
        digest.update((value.len() as u64).to_be_bytes());
        digest.update(value);
    };
    add(b"polyphonic.native-session-identity.v1");
    add(family.as_bytes());
    if family == "unknown" {
        add(runtime_identifier.as_bytes());
    }
    add(native_semantic_key.unwrap_or("").as_bytes());
    // These are locations/profile names, never credentials. A native account or
    // profile change must select different history; a model or access-tier edit must not.
    for key in [
        "HOME",
        "CODEX_HOME",
        "CLAUDE_CONFIG_DIR",
        "HERMES_HOME",
        "OPENCLAW_STATE_DIR",
        "OPENCLAW_CONFIG_PATH",
        "OPENCLAW_PROFILE",
        "XDG_CONFIG_HOME",
    ] {
        let explicit = command
            .get_envs()
            .find(|(name, _)| *name == std::ffi::OsStr::new(key));
        let value = match explicit {
            Some((_, value)) => value.map(std::ffi::OsStr::to_os_string),
            None => std::env::var_os(key),
        };
        add(key.as_bytes());
        if let Some(value) = value {
            add(value.as_encoded_bytes());
        } else {
            add(b"");
        }
    }
    format!("sha256:{}", hex::encode(digest.finalize()))
}

/// Prepare a private directory for native-session pointers, without touching transcripts.
pub(crate) fn prepare_resident_session_map(
    app_data_dir: &Path,
    resident_pubkey: &str,
) -> Result<PathBuf, String> {
    if resident_pubkey.len() != 64
        || !resident_pubkey
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("invalid native session map resident".into());
    }
    let directory = app_data_dir.join("luca").join("runtime-sessions");
    fs::create_dir_all(&directory).map_err(|_| "create native session map directory")?;
    if !fs::symlink_metadata(&directory).is_ok_and(|m| m.is_dir()) {
        return Err("native session map directory must not be a symlink".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| "secure native session map directory")?;
    }
    Ok(directory.join(format!("{resident_pubkey}.json")))
}

pub(crate) fn excluded_provider_session_ids(
    app_data_dir: &Path,
    runtime_family: &str,
) -> HashSet<String> {
    let directory = app_data_dir.join("luca").join(STORE_DIRECTORY);
    let Ok(entries) = fs::read_dir(directory) else {
        return HashSet::new();
    };
    let mut excluded = HashSet::new();
    for entry in entries.flatten().take(MAX_STORE_FILES) {
        let path = entry.path();
        if entry.file_type().is_ok_and(|kind| kind.is_file())
            && path.extension().and_then(|value| value.to_str()) == Some("jsonl")
        {
            read_exclusions(&path, runtime_family, &mut excluded);
        }
    }
    excluded
}

/// First-meeting discovery requires a complete exclusion set within its budget.
/// Busy, oversized or incomplete ledgers omit discovery rather than exposing
/// an internal session through a partially read exclusion set.
pub(crate) fn exclusions_before(
    app_data_dir: &Path,
    runtime_family: &str,
    deadline: std::time::Instant,
) -> Result<HashSet<String>, String> {
    use std::io::Read;
    let directory = app_data_dir.join("luca").join(STORE_DIRECTORY);
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(HashSet::new()),
        Err(_) => return Err("Session exclusions unavailable".into()),
    };
    let mut excluded = HashSet::new();
    for (index, entry) in entries.enumerate() {
        if index >= MAX_STORE_FILES || std::time::Instant::now() >= deadline {
            return Err("Session exclusion budget exhausted".into());
        }
        let entry = entry.map_err(|_| "Session exclusions unavailable")?;
        if !entry.file_type().is_ok_and(|kind| kind.is_file())
            || entry.path().extension().and_then(|v| v.to_str()) != Some("jsonl")
        {
            continue;
        }
        let mut reader = BufReader::new(
            fs::File::open(entry.path()).map_err(|_| "Session exclusions unavailable")?,
        );
        loop {
            if std::time::Instant::now() >= deadline {
                return Err("Session exclusion budget exhausted".into());
            }
            let mut line = String::new();
            let length = reader
                .by_ref()
                .take((MAX_RECORD_BYTES + 1) as u64)
                .read_line(&mut line)
                .map_err(|_| "Session exclusions unavailable")?;
            if length == 0 {
                break;
            }
            if length > MAX_RECORD_BYTES {
                return Err("Session exclusion record exceeds bound".into());
            }
            let Ok(record) = serde_json::from_str::<RuntimeSessionPurposeRecordV1>(&line) else {
                continue;
            };
            if record.protocol == STORE_PROTOCOL
                && record.runtime_family == runtime_family
                && record.purpose != RuntimeSessionPurposeV1::ExplicitRuntimeTask
            {
                excluded.insert(record.provider_session_id);
            }
        }
    }
    Ok(excluded)
}

fn read_exclusions(path: &Path, runtime_family: &str, excluded: &mut HashSet<String>) {
    let Ok(file) = fs::File::open(path) else {
        return;
    };
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if line.len() > MAX_RECORD_BYTES {
            continue;
        }
        let Ok(record) = serde_json::from_str::<RuntimeSessionPurposeRecordV1>(&line) else {
            continue;
        };
        if record.protocol == STORE_PROTOCOL
            && record.runtime_family == runtime_family
            && record.purpose != RuntimeSessionPurposeV1::ExplicitRuntimeTask
            && !record.provider_session_id.is_empty()
            && record.provider_session_id.len() <= 512
        {
            excluded.insert(record.provider_session_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn excludes_internal_and_conversation_sessions_but_retains_tasks() {
        let root = tempdir().expect("temp app data");
        let resident = "a".repeat(64);
        let path = prepare_resident_store(root.path(), &resident).expect("purpose store");
        let mut file = OpenOptions::new()
            .append(true)
            .open(path)
            .expect("append purpose records");
        for (provider_session_id, purpose) in [
            ("conversation-id", "resident_conversation"),
            ("continuity-id", "continuity_internal"),
            ("task-id", "explicit_runtime_task"),
        ] {
            writeln!(
                file,
                "{}",
                serde_json::json!({
                    "protocol": STORE_PROTOCOL,
                    "providerSessionId": provider_session_id,
                    "runtimeFamily": "codex",
                    "purpose": purpose,
                })
            )
            .expect("write record");
        }
        let excluded = excluded_provider_session_ids(root.path(), "codex");
        assert_eq!(
            excluded,
            HashSet::from(["conversation-id".to_owned(), "continuity-id".to_owned()])
        );
    }
    #[test]
    fn native_session_identity_survives_model_permission_and_build_edits() {
        let mut first = std::process::Command::new("test-runtime");
        first
            .env("CODEX_HOME", "/test/profile-a")
            .env("MODEL", "before");
        let mut next = std::process::Command::new("new-test-runtime-build");
        next.env("CODEX_HOME", "/test/profile-a")
            .env("MODEL", "after")
            .env("BUZZ_ACP_PERMISSION_MODE", "acceptEdits")
            .env("LUCA_MANAGED_BINDING_REF", "different-execution-binding");
        assert_eq!(
            native_session_identity_ref("codex", "codex-acp", None, &first),
            native_session_identity_ref("codex", "codex-acp", None, &next)
        );
        next.env("CODEX_HOME", "/test/profile-b");
        assert_ne!(
            native_session_identity_ref("codex", "codex-acp", None, &first),
            native_session_identity_ref("codex", "codex-acp", None, &next)
        );
    }

    #[test]
    fn native_session_identity_isolates_imported_profiles_and_runtime_families() {
        let command = std::process::Command::new("test-runtime");
        assert_ne!(
            native_session_identity_ref("hermes", "hermes", Some("profile-a"), &command),
            native_session_identity_ref("hermes", "hermes", Some("profile-b"), &command)
        );
        assert_ne!(
            native_session_identity_ref("codex", "codex-acp", None, &command),
            native_session_identity_ref("claude_code", "claude-agent-acp", None, &command)
        );
    }

    #[test]
    fn native_session_scope_survives_owned_relay_port_changes_only() {
        let first = native_session_relay_scope(
            "ws://127.0.0.1:42001",
            Some("ws://127.0.0.1:42001"),
            "owner",
        );
        let restarted = native_session_relay_scope(
            "ws://127.0.0.1:42099",
            Some("ws://127.0.0.1:42099"),
            "owner",
        );
        assert_eq!(first, restarted);
        assert_ne!(
            first,
            native_session_relay_scope("ws://127.0.0.1:42001", None, "owner")
        );
        assert_ne!(
            first,
            native_session_relay_scope(
                "ws://127.0.0.1:42001",
                Some("ws://127.0.0.1:42001"),
                "different-owner"
            )
        );
        assert_ne!(
            native_session_relay_scope("wss://relay-a.test", None, "owner"),
            native_session_relay_scope("wss://relay-b.test", None, "owner")
        );
    }
}
