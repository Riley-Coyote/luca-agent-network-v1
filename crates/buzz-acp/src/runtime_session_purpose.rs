//! Body-free local ledger for native sessions created by a managed host.

use std::{
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
};

use serde::Serialize;

pub(crate) const STORE_ENV: &str = "LUCA_RUNTIME_SESSION_PURPOSE_STORE";
pub(crate) const RUNTIME_FAMILY_ENV: &str = "LUCA_MANAGED_RUNTIME_FAMILY";

const STORE_PROTOCOL: &str = "polyphonic.runtime-session-purpose.v1";
const MAX_RECORD_BYTES: usize = 16 * 1024;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RuntimeSessionPurposeV1 {
    ResidentConversation,
    ContinuityInternal,
    ExplicitRuntimeTask,
}

#[derive(Clone, Debug)]
pub(crate) struct RuntimeSessionPurposeStore {
    path: PathBuf,
    resident_pubkey: String,
    runtime_binding_ref: String,
    runtime_family: String,
    session_epoch: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSessionPurposeRecordV1<'a> {
    protocol: &'static str,
    app_session_id: String,
    resident_pubkey: &'a str,
    runtime_binding_ref: &'a str,
    runtime_family: &'a str,
    session_epoch: u64,
    provider_session_id: &'a str,
    purpose: RuntimeSessionPurposeV1,
    created_at: String,
    terminal_status: &'static str,
    cleanup_status: &'static str,
}

impl RuntimeSessionPurposeStore {
    pub(crate) fn from_environment() -> Result<Option<Self>, String> {
        let Some(path) = std::env::var_os(STORE_ENV).map(PathBuf::from) else {
            return Ok(None);
        };
        if !path.is_absolute() || !path.is_file() {
            return Err("managed runtime session purpose store is unavailable".to_owned());
        }
        let resident_pubkey = required_env("LUCA_MANAGED_RESIDENT_PUBKEY")?;
        if resident_pubkey.len() != 64
            || !resident_pubkey
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err("managed runtime session purpose resident is invalid".to_owned());
        }
        let runtime_binding_ref = required_env("LUCA_MANAGED_BINDING_REF")?;
        let runtime_family = required_env(RUNTIME_FAMILY_ENV)?;
        if !valid_runtime_family(&runtime_family) {
            return Err("managed runtime session purpose family is invalid".to_owned());
        }
        let session_epoch = required_env("LUCA_MANAGED_SESSION_EPOCH")?
            .parse::<u64>()
            .map_err(|_| "managed runtime session purpose epoch is invalid".to_owned())?;
        Ok(Some(Self {
            path,
            resident_pubkey,
            runtime_binding_ref,
            runtime_family,
            session_epoch,
        }))
    }

    pub(crate) fn record_created(
        &self,
        provider_session_id: &str,
        purpose: RuntimeSessionPurposeV1,
    ) -> Result<(), String> {
        let provider_session_id = provider_session_id.trim();
        if provider_session_id.is_empty() || provider_session_id.len() > 512 {
            return Err("provider session identifier is invalid".to_owned());
        }
        let record = RuntimeSessionPurposeRecordV1 {
            protocol: STORE_PROTOCOL,
            app_session_id: format!("session-{}", uuid::Uuid::new_v4()),
            resident_pubkey: &self.resident_pubkey,
            runtime_binding_ref: &self.runtime_binding_ref,
            runtime_family: &self.runtime_family,
            session_epoch: self.session_epoch,
            provider_session_id,
            purpose,
            created_at: chrono::Utc::now().to_rfc3339(),
            terminal_status: "active",
            cleanup_status: "not_requested",
        };
        let mut bytes = serde_json::to_vec(&record)
            .map_err(|_| "encode runtime session purpose record".to_owned())?;
        bytes.push(b'\n');
        if bytes.len() > MAX_RECORD_BYTES {
            return Err("runtime session purpose record exceeds bound".to_owned());
        }
        append_record(&self.path, &bytes)
    }
}

fn required_env(key: &str) -> Result<String, String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("managed runtime session purpose missing {key}"))
}

fn valid_runtime_family(value: &str) -> bool {
    value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn append_record(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(|_| "open runtime session purpose store".to_owned())?;
    file.write_all(bytes)
        .and_then(|_| file.flush())
        .map_err(|_| "write runtime session purpose store".to_owned())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn writes_body_free_purpose_record() {
        let root = std::env::temp_dir().join(format!(
            "polyphonic-session-purpose-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp store");
        let path = root.join("purpose.jsonl");
        fs::write(&path, []).expect("create store");
        let store = RuntimeSessionPurposeStore {
            path: path.clone(),
            resident_pubkey: "a".repeat(64),
            runtime_binding_ref: format!("sha256:{}", "b".repeat(64)),
            runtime_family: "codex".to_owned(),
            session_epoch: 7,
        };
        store
            .record_created(
                "provider-session",
                RuntimeSessionPurposeV1::ContinuityInternal,
            )
            .expect("record purpose");
        let value: serde_json::Value =
            serde_json::from_str(fs::read_to_string(path).expect("read purpose").trim_end())
                .expect("parse purpose");
        assert_eq!(value["purpose"], "continuity_internal");
        assert_eq!(value["providerSessionId"], "provider-session");
        assert!(value.get("prompt").is_none());
        assert!(value.get("transcript").is_none());
        fs::remove_dir_all(root).expect("remove temp store");
    }
}
