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
}
