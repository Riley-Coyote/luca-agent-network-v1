//! Exact owner reply intents, encrypted before the existing dispatch pipeline.

use std::{
    io::{Read, Write},
    path::PathBuf,
};

use age::secrecy::SecretString;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use zeroize::{Zeroize, Zeroizing};

use super::{agent_inbox::InboxScope, conversation_context::DispatchContextBindingV1};
use crate::data_dir::BuzzPathExt;

const MAX_BYTES: usize = 1024 * 1024;
const SCHEMA: &str = "luca.agent-inbox.reply-intent.v1";

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ReplyIntent {
    pub schema: String,
    pub scope: InboxScope,
    pub input_fingerprint: String,
    pub event: nostr::Event,
    pub context: Option<DispatchContextBindingV1>,
    pub task_binding: super::agent_inbox_binding::InboxTaskBinding,
    #[serde(default)]
    pub correspondence_id: Option<String>,
    #[serde(default)]
    pub attempt: Option<super::agent_inbox_continue::PreparedAttempt>,
    pub wake: WakeState,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum WakeState {
    NotRequested,
    Requested,
    Ready,
    Failed(String),
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct WakeCheckpoint {
    scope: InboxScope,
    event_id: String,
    input_fingerprint: String,
    wake: WakeState,
}

pub(super) fn new_intent(
    scope: InboxScope,
    input_fingerprint: String,
    event: nostr::Event,
    context: Option<DispatchContextBindingV1>,
    task_binding: super::agent_inbox_binding::InboxTaskBinding,
) -> ReplyIntent {
    ReplyIntent {
        schema: SCHEMA.into(),
        scope,
        input_fingerprint,
        event,
        context,
        task_binding,
        correspondence_id: None,
        attempt: None,
        wake: WakeState::NotRequested,
    }
}

pub(super) fn path(app: &AppHandle, scope: &InboxScope, key: &str) -> Result<PathBuf, String> {
    let root = app
        .buzz_path()
        .app_data_dir()
        .map_err(|_| "inbox intent storage is unavailable")?;
    let key_hash = hex::encode(Sha256::digest(key.as_bytes()));
    Ok(root
        .join("luca")
        .join("inbox-reply-intents-v1")
        .join(&scope.community_id)
        .join(scope.owner_pubkey.as_str())
        .join(format!("{key_hash}.age")))
}

fn passphrase(app: &AppHandle) -> Result<SecretString, String> {
    let keys = app.state::<crate::app_state::AppState>().signing_keys()?;
    let mut private = keys.secret_key().to_secret_hex();
    let mut hash = Sha256::new();
    hash.update(b"luca-agent-inbox-owner-reply-intent-v1\0");
    hash.update(private.as_bytes());
    private.zeroize();
    Ok(SecretString::from(hex::encode(hash.finalize())))
}

pub(super) fn load(
    app: &AppHandle,
    path: &PathBuf,
    scope: &InboxScope,
) -> Result<Option<ReplyIntent>, String> {
    if !path.exists() {
        return Ok(None);
    }
    if std::fs::metadata(path)
        .map_err(|_| "inbox reply intent is unavailable")?
        .len()
        > MAX_BYTES as u64
    {
        return Err("inbox reply intent exceeds its size limit".into());
    }
    let encrypted = std::fs::read(path).map_err(|_| "inbox reply intent is unavailable")?;
    let decryptor = age::Decryptor::new_buffered(encrypted.as_slice())
        .map_err(|_| "inbox reply intent is invalid")?;
    let identity = age::scrypt::Identity::new(passphrase(app)?);
    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|_| "inbox reply intent cannot be decrypted")?;
    let mut bytes = Zeroizing::new(Vec::new());
    reader
        .by_ref()
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "inbox reply intent cannot be read")?;
    if bytes.len() > MAX_BYTES {
        return Err("inbox reply intent exceeds its size limit".into());
    }
    let mut intent: ReplyIntent =
        serde_json::from_slice(&bytes).map_err(|_| "inbox reply intent is malformed")?;
    if intent.schema != SCHEMA
        || &intent.scope != scope
        || intent.event.pubkey.to_hex() != scope.owner_pubkey.as_str()
        || !intent.event.verify_id()
        || !intent.event.verify_signature()
    {
        return Err("inbox reply intent owner or scope is invalid".into());
    }
    let wake_path = path.with_extension("wake.json");
    if wake_path.exists() {
        if std::fs::metadata(&wake_path)
            .map_err(|_| "inbox wake checkpoint is unavailable")?
            .len()
            > 16 * 1024
        {
            return Err("inbox wake checkpoint exceeds its size limit".into());
        }
        let wake: WakeCheckpoint = serde_json::from_slice(
            &std::fs::read(&wake_path).map_err(|_| "inbox wake checkpoint is unavailable")?,
        )
        .map_err(|_| "inbox wake checkpoint is invalid")?;
        if wake.scope != intent.scope
            || wake.event_id != intent.event.id.to_hex()
            || wake.input_fingerprint != intent.input_fingerprint
        {
            return Err("inbox wake checkpoint does not match its immutable intent".into());
        }
        intent.wake = wake.wake;
    }
    Ok(Some(intent))
}

pub(super) fn persist(app: &AppHandle, path: &PathBuf, intent: &ReplyIntent) -> Result<(), String> {
    // Immutable ciphertext is encrypted only once; subsequent body-free wake
    // checkpoints never repeat an expensive password KDF.
    if path.exists() {
        return persist_wake(path, intent);
    }
    let bytes = Zeroizing::new(
        serde_json::to_vec(intent).map_err(|_| "inbox reply intent cannot be encoded")?,
    );
    if bytes.len() > MAX_BYTES {
        return Err("inbox reply intent exceeds its size limit".into());
    }
    let encryptor = age::Encryptor::with_user_passphrase(passphrase(app)?);
    let mut encrypted = Vec::new();
    let mut writer = encryptor
        .wrap_output(&mut encrypted)
        .map_err(|_| "inbox reply intent cannot be encrypted")?;
    writer
        .write_all(&bytes)
        .map_err(|_| "inbox reply intent cannot be encrypted")?;
    writer
        .finish()
        .map_err(|_| "inbox reply intent cannot be encrypted")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|_| "inbox reply intent directory is unavailable")?;
    }
    super::managed_dispatch_store::atomic_write_restricted(path, &encrypted)?;
    persist_wake(path, intent)
}

fn persist_wake(path: &PathBuf, intent: &ReplyIntent) -> Result<(), String> {
    let wake = WakeCheckpoint {
        scope: intent.scope.clone(),
        event_id: intent.event.id.to_hex(),
        input_fingerprint: intent.input_fingerprint.clone(),
        wake: intent.wake.clone(),
    };
    let bytes = serde_json::to_vec(&wake).map_err(|_| "inbox wake checkpoint cannot be encoded")?;
    super::managed_dispatch_store::atomic_write_restricted(
        &path.with_extension("wake.json"),
        &bytes,
    )
}
