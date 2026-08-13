//! Encrypted exact-event vault for resident-authored communication actions.
//!
//! The communication action outbox stores only an opaque handle and hashes.
//! This separate vault retains the one already-signed canonical event needed
//! for ambiguity-safe relay retries. It never exposes a filesystem path or
//! event body through its public API or diagnostics.

use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
};

use age::secrecy::SecretString;
use atomic_write_file::AtomicWriteFile;
use luca_protocol::{
    canonicalize, CommunicationActionRequestV1, CommunicationDestinationV1,
    CommunicationOperationV1, Hex64, OpaqueArtifactHandleV1, OpaqueId, Sha256Ref,
};
use nostr::{Event, JsonUtil};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

const VAULT_SCHEMA: &str = "luca.communication-event-vault.v1";
const MAX_EVENT_PLAINTEXT_BYTES: usize = 512 * 1024;
const MAX_EVENT_CIPHERTEXT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommunicationEventVaultError {
    Invalid,
    Collision,
    NotFound,
    Persistence,
}

impl CommunicationEventVaultError {
    pub(crate) const fn diagnostic_code(self) -> &'static str {
        match self {
            Self::Invalid => "communication-event-vault-invalid",
            Self::Collision => "communication-event-vault-collision",
            Self::NotFound => "communication-event-vault-not-found",
            Self::Persistence => "communication-event-vault-persistence",
        }
    }
}

impl std::fmt::Display for CommunicationEventVaultError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.diagnostic_code())
    }
}

impl std::error::Error for CommunicationEventVaultError {}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct SealedCommunicationEvent {
    pub(crate) handle: OpaqueId,
    pub(crate) event_id: Hex64,
    pub(crate) event_sha256: Hex64,
}

/// Terminal proofs for which deleting frozen ciphertext is sound.
///
/// Publication-unknown and relay-absence deliberately have no representation:
/// callers must retain the one exact signed event in both cases.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommunicationEventVaultTerminal {
    /// Durable state plus an author-bound exact-event probe proves the frozen
    /// event was not published.
    ProvenNotPublished,
    /// The relay or exact probe returned one explicit deterministic rejection.
    ExplicitlyRejected,
    /// Acceptance and every downstream recovery receipt are durably finalized.
    AcceptedAndFinalized,
}

impl std::fmt::Debug for SealedCommunicationEvent {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SealedCommunicationEvent")
            .field("handle", &"[REDACTED]")
            .field("event_id", &self.event_id)
            .field("event_sha256", &self.event_sha256)
            .finish()
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredCommunicationEventV1 {
    schema: String,
    resident_pubkey: Hex64,
    action_id: OpaqueId,
    idempotency_key: Hex64,
    action_fingerprint: Sha256Ref,
    destination_ref: Sha256Ref,
    conversation_id: OpaqueId,
    event_kind: u16,
    event_id: Hex64,
    event_sha256: Hex64,
    signed_event_json: String,
}

impl Drop for StoredCommunicationEventV1 {
    fn drop(&mut self) {
        self.signed_event_json.zeroize();
    }
}

struct CommunicationEventBinding {
    action_id: OpaqueId,
    idempotency_key: Hex64,
    action_fingerprint: Sha256Ref,
    destination_ref: Sha256Ref,
    conversation_id: OpaqueId,
}

pub(crate) struct CommunicationEventVault {
    directory: PathBuf,
    passphrase: SecretString,
    resident_pubkey: Hex64,
}

impl CommunicationEventVault {
    pub(crate) fn open(
        directory: PathBuf,
        passphrase: SecretString,
        resident_pubkey: Hex64,
    ) -> Result<Self, CommunicationEventVaultError> {
        ensure_restricted_directory(&directory)?;
        Ok(Self {
            directory,
            passphrase,
            resident_pubkey,
        })
    }

    /// Seal canonical signed event bytes before their handle enters the outbox.
    /// Repeating the exact action/event is idempotent; any drift is rejected.
    pub(crate) fn seal(
        &self,
        request: &CommunicationActionRequestV1,
        signed_event_json: &str,
    ) -> Result<SealedCommunicationEvent, CommunicationEventVaultError> {
        let binding = binding_for_request(request, &self.resident_pubkey)?;
        let canonical_event = canonical_signed_event(signed_event_json, &self.resident_pubkey)?;
        let event = parse_verified_event(canonical_event.as_str(), &self.resident_pubkey)?;
        verify_event_binding(&event, request, &binding)?;
        let event_id =
            Hex64::parse(event.id.to_hex()).map_err(|_| CommunicationEventVaultError::Invalid)?;
        let event_sha256 = sha256_hex(canonical_event.as_bytes())?;
        // One semantic action owns exactly one vault slot. Event identity must
        // not participate in this handle or the same idempotency key could
        // freeze multiple differently signed events under different files.
        let handle = derive_handle(&binding, &self.resident_pubkey)?;
        let path = self.path_for(&handle)?;
        let stored = StoredCommunicationEventV1 {
            schema: VAULT_SCHEMA.to_owned(),
            resident_pubkey: self.resident_pubkey.clone(),
            action_id: binding.action_id,
            idempotency_key: binding.idempotency_key,
            action_fingerprint: binding.action_fingerprint,
            destination_ref: binding.destination_ref,
            conversation_id: binding.conversation_id,
            event_kind: event.kind.as_u16(),
            event_id: event_id.clone(),
            event_sha256: event_sha256.clone(),
            signed_event_json: canonical_event.to_string(),
        };
        if path.exists() {
            let existing = self.load_stored(&handle)?;
            if !stored_fields_match(&existing, &stored) {
                return Err(CommunicationEventVaultError::Collision);
            }
            return Ok(SealedCommunicationEvent {
                handle,
                event_id,
                event_sha256,
            });
        }
        self.persist(&path, &stored)?;
        Ok(SealedCommunicationEvent {
            handle,
            event_id,
            event_sha256,
        })
    }

    /// Return the already-frozen event for this semantic action, or seal the
    /// supplied candidate if no slot exists yet.  In particular, callers must
    /// probe with `None` before constructing another signature after a crash
    /// between this vault commit and outbox preparation.
    pub(crate) fn seal_or_recover(
        &self,
        request: &CommunicationActionRequestV1,
        candidate_signed_event_json: Option<&str>,
    ) -> Result<SealedCommunicationEvent, CommunicationEventVaultError> {
        let binding = binding_for_request(request, &self.resident_pubkey)?;
        let handle = derive_handle(&binding, &self.resident_pubkey)?;
        if self.path_for(&handle)?.exists() {
            let stored = self.load_stored(&handle)?;
            // Re-run the complete exact binding check; an existing slot is
            // authoritative only when it is exactly this semantic action.
            drop(self.load_exact(&handle, request, &stored.event_id, &stored.event_sha256)?);
            return Ok(SealedCommunicationEvent {
                handle,
                event_id: stored.event_id.clone(),
                event_sha256: stored.event_sha256.clone(),
            });
        }
        let candidate =
            candidate_signed_event_json.ok_or(CommunicationEventVaultError::NotFound)?;
        self.seal(request, candidate)
    }

    /// Delete using only body-free terminal cleanup authority held in the
    /// encrypted outbox tombstone.  The vault still re-verifies event identity
    /// before deleting; no filesystem path or plaintext is exposed.
    pub(crate) fn delete_terminal_cleanup(
        &self,
        handle: &OpaqueId,
        expected_event_id: &Hex64,
        expected_event_sha256: &Hex64,
        _terminal: CommunicationEventVaultTerminal,
    ) -> Result<(), CommunicationEventVaultError> {
        let path = self.path_for(handle)?;
        if !path.exists() {
            return Ok(());
        }
        let stored = self.load_stored(handle)?;
        if stored.event_id != *expected_event_id || stored.event_sha256 != *expected_event_sha256 {
            return Err(CommunicationEventVaultError::Collision);
        }
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(CommunicationEventVaultError::Persistence),
        }
    }

    /// Load and re-verify the one exact signed event selected by the outbox.
    pub(crate) fn load_exact(
        &self,
        handle: &OpaqueId,
        request: &CommunicationActionRequestV1,
        expected_event_id: &Hex64,
        expected_event_sha256: &Hex64,
    ) -> Result<Zeroizing<String>, CommunicationEventVaultError> {
        let binding = binding_for_request(request, &self.resident_pubkey)?;
        let stored = self.load_stored(handle)?;
        if stored.schema != VAULT_SCHEMA
            || stored.resident_pubkey != self.resident_pubkey
            || stored.action_id != binding.action_id
            || stored.idempotency_key != binding.idempotency_key
            || stored.action_fingerprint != binding.action_fingerprint
            || stored.destination_ref != binding.destination_ref
            || stored.conversation_id != binding.conversation_id
            || stored.event_kind != expected_event_kind(request)?
            || &stored.event_id != expected_event_id
            || &stored.event_sha256 != expected_event_sha256
        {
            return Err(CommunicationEventVaultError::Collision);
        }
        let canonical =
            canonical_signed_event(stored.signed_event_json.as_str(), &self.resident_pubkey)?;
        if sha256_hex(canonical.as_bytes())? != *expected_event_sha256 {
            return Err(CommunicationEventVaultError::Collision);
        }
        let event = parse_verified_event(canonical.as_str(), &self.resident_pubkey)?;
        verify_event_binding(&event, request, &binding)?;
        if event.id.to_hex() != expected_event_id.as_str() {
            return Err(CommunicationEventVaultError::Collision);
        }
        Ok(canonical)
    }

    /// Delete exact-event bytes only after the caller holds a safe terminal proof.
    ///
    /// Loading the exact binding first prevents an unrelated terminal receipt
    /// from deleting another action's retry bytes. The terminal enum excludes
    /// ambiguous publication outcomes by construction.
    #[cfg(test)]
    pub(crate) fn delete_after_terminal(
        &self,
        handle: &OpaqueId,
        request: &CommunicationActionRequestV1,
        expected_event_id: &Hex64,
        expected_event_sha256: &Hex64,
        _terminal: CommunicationEventVaultTerminal,
    ) -> Result<(), CommunicationEventVaultError> {
        let binding = binding_for_request(request, &self.resident_pubkey)?;
        let expected_handle = derive_handle(&binding, &self.resident_pubkey)?;
        if &expected_handle != handle {
            return Err(CommunicationEventVaultError::Collision);
        }
        let path = self.path_for(handle)?;
        if !path.exists() {
            return Ok(());
        }
        drop(self.load_exact(handle, request, expected_event_id, expected_event_sha256)?);
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(CommunicationEventVaultError::Persistence),
        }
    }

    fn path_for(&self, handle: &OpaqueId) -> Result<PathBuf, CommunicationEventVaultError> {
        let name = sha256_hex(handle.as_str().as_bytes())?;
        Ok(self.directory.join(format!("{}.age", name.as_str())))
    }

    fn load_stored(
        &self,
        handle: &OpaqueId,
    ) -> Result<StoredCommunicationEventV1, CommunicationEventVaultError> {
        let path = self.path_for(handle)?;
        let ciphertext = std::fs::read(path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                CommunicationEventVaultError::NotFound
            } else {
                CommunicationEventVaultError::Persistence
            }
        })?;
        if ciphertext.len() > MAX_EVENT_CIPHERTEXT_BYTES {
            return Err(CommunicationEventVaultError::Persistence);
        }
        let decryptor = age::Decryptor::new_buffered(ciphertext.as_slice())
            .map_err(|_| CommunicationEventVaultError::Persistence)?;
        let identity = age::scrypt::Identity::new(self.passphrase.clone());
        let mut reader = decryptor
            .decrypt(std::iter::once(&identity as &dyn age::Identity))
            .map_err(|_| CommunicationEventVaultError::Persistence)?;
        let mut plaintext = Zeroizing::new(Vec::new());
        reader
            .by_ref()
            .take((MAX_EVENT_PLAINTEXT_BYTES + 1) as u64)
            .read_to_end(&mut plaintext)
            .map_err(|_| CommunicationEventVaultError::Persistence)?;
        if plaintext.len() > MAX_EVENT_PLAINTEXT_BYTES {
            return Err(CommunicationEventVaultError::Persistence);
        }
        let stored: StoredCommunicationEventV1 = serde_json::from_slice(plaintext.as_slice())
            .map_err(|_| CommunicationEventVaultError::Persistence)?;
        let canonical =
            canonicalize(&stored).map_err(|_| CommunicationEventVaultError::Persistence)?;
        if canonical.as_slice() != plaintext.as_slice() {
            return Err(CommunicationEventVaultError::Persistence);
        }
        if stored.schema != VAULT_SCHEMA || stored.resident_pubkey != self.resident_pubkey {
            return Err(CommunicationEventVaultError::Invalid);
        }
        Ok(stored)
    }

    fn persist(
        &self,
        path: &Path,
        stored: &StoredCommunicationEventV1,
    ) -> Result<(), CommunicationEventVaultError> {
        let plaintext = Zeroizing::new(
            canonicalize(stored).map_err(|_| CommunicationEventVaultError::Persistence)?,
        );
        if plaintext.len() > MAX_EVENT_PLAINTEXT_BYTES {
            return Err(CommunicationEventVaultError::Persistence);
        }
        let encryptor = age::Encryptor::with_user_passphrase(self.passphrase.clone());
        let mut ciphertext = Vec::new();
        {
            let mut writer = encryptor
                .wrap_output(&mut ciphertext)
                .map_err(|_| CommunicationEventVaultError::Persistence)?;
            writer
                .write_all(plaintext.as_slice())
                .map_err(|_| CommunicationEventVaultError::Persistence)?;
            writer
                .finish()
                .map_err(|_| CommunicationEventVaultError::Persistence)?;
        }
        if ciphertext.len() > MAX_EVENT_CIPHERTEXT_BYTES {
            return Err(CommunicationEventVaultError::Persistence);
        }
        atomic_write_restricted(path, &ciphertext)
    }
}

fn canonical_signed_event(
    signed_event_json: &str,
    resident_pubkey: &Hex64,
) -> Result<Zeroizing<String>, CommunicationEventVaultError> {
    if signed_event_json.len() > MAX_EVENT_PLAINTEXT_BYTES {
        return Err(CommunicationEventVaultError::Invalid);
    }
    // Nostr's JSON representation has a stable field order.  Do not apply
    // generic object-key canonicalization here: that would change the exact
    // signed byte representation retained across seal/recovery.
    let event = parse_verified_event(signed_event_json, resident_pubkey)?;
    Ok(Zeroizing::new(event.as_json()))
}

fn parse_verified_event(
    signed_event_json: &str,
    resident_pubkey: &Hex64,
) -> Result<Event, CommunicationEventVaultError> {
    let event =
        Event::from_json(signed_event_json).map_err(|_| CommunicationEventVaultError::Invalid)?;
    if event.pubkey.to_hex() != resident_pubkey.as_str()
        || !event.verify_id()
        || !event.verify_signature()
    {
        return Err(CommunicationEventVaultError::Invalid);
    }
    Ok(event)
}

fn derive_handle(
    binding: &CommunicationEventBinding,
    resident_pubkey: &Hex64,
) -> Result<OpaqueId, CommunicationEventVaultError> {
    let material = serde_json::json!({
        "domain": "luca.communication-event-vault.handle.v1",
        "resident_pubkey": resident_pubkey,
        "action_id": binding.action_id,
        "idempotency_key": binding.idempotency_key,
        "action_fingerprint": binding.action_fingerprint,
        "destination_ref": binding.destination_ref,
        "conversation_id": binding.conversation_id,
    });
    let digest = luca_protocol::canonical_sha256(&material)
        .map_err(|_| CommunicationEventVaultError::Invalid)?;
    OpaqueId::parse(format!("communication-event-{digest}"))
        .map_err(|_| CommunicationEventVaultError::Invalid)
}

fn stored_fields_match(
    left: &StoredCommunicationEventV1,
    right: &StoredCommunicationEventV1,
) -> bool {
    left.schema == right.schema
        && left.resident_pubkey == right.resident_pubkey
        && left.action_id == right.action_id
        && left.idempotency_key == right.idempotency_key
        && left.action_fingerprint == right.action_fingerprint
        && left.destination_ref == right.destination_ref
        && left.conversation_id == right.conversation_id
        && left.event_kind == right.event_kind
        && left.event_id == right.event_id
        && left.event_sha256 == right.event_sha256
        && left.signed_event_json == right.signed_event_json
}

fn binding_for_request(
    request: &CommunicationActionRequestV1,
    resident_pubkey: &Hex64,
) -> Result<CommunicationEventBinding, CommunicationEventVaultError> {
    request
        .validate()
        .map_err(|_| CommunicationEventVaultError::Invalid)?;
    if &request.resident_pubkey != resident_pubkey || &request.actor_pubkey != resident_pubkey {
        return Err(CommunicationEventVaultError::Invalid);
    }
    expected_event_kind(request)?;
    let CommunicationDestinationV1::ExistingConversation {
        conversation_id, ..
    } = &request.destination
    else {
        return Err(CommunicationEventVaultError::Invalid);
    };
    Ok(CommunicationEventBinding {
        action_id: request.action_id.clone(),
        idempotency_key: request.idempotency_key.clone(),
        action_fingerprint: request.action_fingerprint.clone(),
        destination_ref: request
            .destination_ref()
            .map_err(|_| CommunicationEventVaultError::Invalid)?,
        conversation_id: conversation_id.clone(),
    })
}

fn verify_event_binding(
    event: &Event,
    request: &CommunicationActionRequestV1,
    binding: &CommunicationEventBinding,
) -> Result<(), CommunicationEventVaultError> {
    if event.kind.as_u16() != expected_event_kind(request)? {
        return Err(CommunicationEventVaultError::Invalid);
    }

    match &request.operation {
        CommunicationOperationV1::SendMessage {
            body,
            reply_to_event_id,
            mention_pubkeys,
            artifact_handles,
            ..
        } => verify_message_binding(
            event,
            binding,
            body,
            reply_to_event_id.as_ref(),
            mention_pubkeys,
            artifact_handles,
        ),
        CommunicationOperationV1::AddReaction {
            target_event_id,
            reaction,
        } => {
            if event.content != *reaction {
                return Err(CommunicationEventVaultError::Invalid);
            }
            verify_exact_event_reference(event, target_event_id)
        }
        CommunicationOperationV1::RemoveOwnReaction {
            reaction_event_id, ..
        } => {
            if !event.content.is_empty() {
                return Err(CommunicationEventVaultError::Invalid);
            }
            verify_exact_event_reference(event, reaction_event_id)
        }
        CommunicationOperationV1::EditOwnMessage {
            target_event_id,
            replacement_body,
            artifact_handles,
        } => {
            if !artifact_handles.is_empty() || event.content != *replacement_body {
                return Err(CommunicationEventVaultError::Invalid);
            }
            verify_exact_channel(event, &binding.conversation_id)?;
            verify_exact_event_reference(event, target_event_id)
        }
        _ => Err(CommunicationEventVaultError::Invalid),
    }
}

fn expected_event_kind(
    request: &CommunicationActionRequestV1,
) -> Result<u16, CommunicationEventVaultError> {
    match &request.operation {
        CommunicationOperationV1::SendMessage { .. } => Ok(9),
        CommunicationOperationV1::AddReaction { .. } => Ok(7),
        CommunicationOperationV1::RemoveOwnReaction { .. } => Ok(5),
        CommunicationOperationV1::EditOwnMessage { .. } => Ok(40_003),
        _ => Err(CommunicationEventVaultError::Invalid),
    }
}

fn verify_message_binding(
    event: &Event,
    binding: &CommunicationEventBinding,
    body: &str,
    reply_to_event_id: Option<&Hex64>,
    mention_pubkeys: &[Hex64],
    artifact_handles: &[OpaqueArtifactHandleV1],
) -> Result<(), CommunicationEventVaultError> {
    if event.content != body {
        return Err(CommunicationEventVaultError::Invalid);
    }

    verify_exact_channel(event, &binding.conversation_id)?;

    let mut actual_mentions = Vec::new();
    for values in event.tags.iter().filter_map(|tag| {
        let values = tag.as_slice();
        (values.first().map(String::as_str) == Some("p")).then_some(values)
    }) {
        let value = values.get(1).ok_or(CommunicationEventVaultError::Invalid)?;
        actual_mentions
            .push(Hex64::parse(value.clone()).map_err(|_| CommunicationEventVaultError::Invalid)?);
    }
    actual_mentions.sort();
    if actual_mentions.windows(2).any(|pair| pair[0] == pair[1])
        || actual_mentions != mention_pubkeys
    {
        return Err(CommunicationEventVaultError::Invalid);
    }

    verify_reply_tags(event, reply_to_event_id)?;
    verify_artifact_tags(event, artifact_handles)
}

fn verify_exact_channel(
    event: &Event,
    conversation_id: &OpaqueId,
) -> Result<(), CommunicationEventVaultError> {
    let channel_tags = event
        .tags
        .iter()
        .filter_map(|tag| {
            let values = tag.as_slice();
            (values.first().map(String::as_str) == Some("h")).then_some(values)
        })
        .collect::<Vec<_>>();
    if channel_tags.len() != 1
        || channel_tags[0].len() != 2
        || channel_tags[0].get(1).map(String::as_str) != Some(conversation_id.as_str())
    {
        return Err(CommunicationEventVaultError::Invalid);
    }
    Ok(())
}

fn verify_exact_event_reference(
    event: &Event,
    expected_event_id: &Hex64,
) -> Result<(), CommunicationEventVaultError> {
    let references = event
        .tags
        .iter()
        .filter_map(|tag| {
            let values = tag.as_slice();
            (values.first().map(String::as_str) == Some("e")).then_some(values)
        })
        .collect::<Vec<_>>();
    if references.len() != 1
        || references[0].len() != 2
        || references[0].get(1).map(String::as_str) != Some(expected_event_id.as_str())
    {
        return Err(CommunicationEventVaultError::Invalid);
    }
    Ok(())
}

fn verify_reply_tags(
    event: &Event,
    expected_reply: Option<&Hex64>,
) -> Result<(), CommunicationEventVaultError> {
    let event_references = event
        .tags
        .iter()
        .filter_map(|tag| {
            let values = tag.as_slice();
            (values.first().map(String::as_str) == Some("e")).then_some(values)
        })
        .collect::<Vec<_>>();
    if expected_reply.is_none() {
        return event_references
            .is_empty()
            .then_some(())
            .ok_or(CommunicationEventVaultError::Invalid);
    }

    let mut root = None;
    let mut reply = None;
    for values in event_references {
        let event_id = Hex64::parse(
            values
                .get(1)
                .ok_or(CommunicationEventVaultError::Invalid)?
                .clone(),
        )
        .map_err(|_| CommunicationEventVaultError::Invalid)?;
        match values.get(3).map(String::as_str) {
            Some("root") if root.replace(event_id.clone()).is_none() => {}
            Some("reply") if reply.replace(event_id).is_none() => {}
            _ => return Err(CommunicationEventVaultError::Invalid),
        }
    }
    let expected_reply = expected_reply.ok_or(CommunicationEventVaultError::Invalid)?;
    if reply.as_ref() != Some(expected_reply) || root.as_ref() == Some(expected_reply) {
        return Err(CommunicationEventVaultError::Invalid);
    }
    Ok(())
}

fn verify_artifact_tags(
    event: &Event,
    artifact_handles: &[OpaqueArtifactHandleV1],
) -> Result<(), CommunicationEventVaultError> {
    let imeta_tags = event
        .tags
        .iter()
        .filter_map(|tag| {
            let values = tag.as_slice();
            (values.first().map(String::as_str) == Some("imeta")).then_some(values)
        })
        .collect::<Vec<_>>();
    if imeta_tags.len() != artifact_handles.len() {
        return Err(CommunicationEventVaultError::Invalid);
    }

    let mut actual = Vec::with_capacity(imeta_tags.len());
    for values in imeta_tags {
        let url = exact_imeta_field(values, "url")?.ok_or(CommunicationEventVaultError::Invalid)?;
        if url.is_empty() {
            return Err(CommunicationEventVaultError::Invalid);
        }
        let content_sha256 = Hex64::parse(
            exact_imeta_field(values, "x")?
                .ok_or(CommunicationEventVaultError::Invalid)?
                .to_owned(),
        )
        .map_err(|_| CommunicationEventVaultError::Invalid)?;
        let byte_length = exact_imeta_field(values, "size")?
            .ok_or(CommunicationEventVaultError::Invalid)?
            .parse::<u64>()
            .map_err(|_| CommunicationEventVaultError::Invalid)?;
        let media_type = exact_imeta_field(values, "m")?
            .ok_or(CommunicationEventVaultError::Invalid)?
            .to_owned();
        let display_name = exact_imeta_field(values, "filename")?.map(str::to_owned);
        actual.push((content_sha256, byte_length, media_type, display_name));
    }
    actual.sort();

    let mut expected = artifact_handles
        .iter()
        .map(|handle| {
            (
                handle.content_sha256.clone(),
                handle.byte_length.get(),
                handle.media_type.clone(),
                handle.display_name.clone(),
            )
        })
        .collect::<Vec<_>>();
    expected.sort();
    if actual != expected {
        return Err(CommunicationEventVaultError::Invalid);
    }
    Ok(())
}

fn exact_imeta_field<'a>(
    values: &'a [String],
    field: &str,
) -> Result<Option<&'a str>, CommunicationEventVaultError> {
    let mut found = None;
    for value in values.iter().skip(1) {
        let Some((name, contents)) = value.split_once(' ') else {
            continue;
        };
        if name == field && (contents.is_empty() || found.replace(contents).is_some()) {
            return Err(CommunicationEventVaultError::Invalid);
        }
    }
    Ok(found)
}

fn sha256_hex(bytes: &[u8]) -> Result<Hex64, CommunicationEventVaultError> {
    Hex64::parse(hex::encode(Sha256::digest(bytes)))
        .map_err(|_| CommunicationEventVaultError::Invalid)
}

fn ensure_restricted_directory(path: &Path) -> Result<(), CommunicationEventVaultError> {
    std::fs::create_dir_all(path).map_err(|_| CommunicationEventVaultError::Persistence)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| CommunicationEventVaultError::Persistence)?;
    }
    Ok(())
}

fn atomic_write_restricted(path: &Path, bytes: &[u8]) -> Result<(), CommunicationEventVaultError> {
    let mut file =
        AtomicWriteFile::open(path).map_err(|_| CommunicationEventVaultError::Persistence)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| CommunicationEventVaultError::Persistence)?;
    }
    file.write_all(bytes)
        .map_err(|_| CommunicationEventVaultError::Persistence)?;
    file.commit()
        .map_err(|_| CommunicationEventVaultError::Persistence)
}

#[cfg(test)]
#[path = "communication_event_vault_tests.rs"]
mod tests;
