//! Deterministic, encrypted desktop outbox for managed final publication.

use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
};

use age::secrecy::SecretString;
use atomic_write_file::AtomicWriteFile;
use luca_protocol::{
    canonical_sha256, canonicalize, Hex64, ManagedMessagePublishRequestV1,
    ManagedMessagePublishResultV1, OpaqueId,
};
use nostr::{JsonUtil, Kind};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const OUTBOX_SCHEMA: &str = "luca.managed-message-outbox.v1";
const MAX_OUTBOX_ENTRIES: usize = 256;
const MAX_CIPHERTEXT_BYTES: usize = 8 * 1024 * 1024;
const MAX_PLAINTEXT_BYTES: usize = 4 * 1024 * 1024;

/// Validation or lifecycle failure for one managed final-message record.
#[derive(Debug)]
pub(crate) enum ManagedMessageOutboxError {
    /// The typed publication request failed its frozen protocol rules.
    InvalidRequest,
    /// The supplied event was noncanonical, invalid, unsigned, or authored by another resident.
    InvalidEvent,
    /// A different request or event reused an existing idempotency key.
    IdempotencyCollision,
    /// The request did not belong to the active local installation session.
    InactiveSession,
    /// Cancellation won before the event was frozen or submitted.
    Cancelled,
    /// The requested transition is not legal from the current state.
    InvalidTransition,
    /// The requested idempotency key was not present.
    NotFound,
    /// Canonical hashing failed.
    Canonicalization,
    /// Encrypted durable state could not be loaded or committed.
    Persistence,
}

impl std::fmt::Display for ManagedMessageOutboxError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidRequest => "managed publication request is invalid",
            Self::InvalidEvent => "managed publication event is invalid",
            Self::IdempotencyCollision => "managed publication idempotency collision",
            Self::InactiveSession => "managed publication session is inactive",
            Self::Cancelled => "managed publication turn is cancelled",
            Self::InvalidTransition => "managed publication outbox transition is invalid",
            Self::NotFound => "managed publication outbox entry was not found",
            Self::Canonicalization => "managed publication canonical hashing failed",
            Self::Persistence => "managed publication encrypted persistence failed",
        })
    }
}

impl std::error::Error for ManagedMessageOutboxError {}

/// Frozen, exact signed event retained only inside desktop authority.
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct FrozenManagedMessageEvent {
    event_id: Hex64,
    event_sha256: Hex64,
    content_sha256: Hex64,
    signed_event_json: String,
}

impl std::fmt::Debug for FrozenManagedMessageEvent {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FrozenManagedMessageEvent")
            .field("event_id", &self.event_id)
            .field("event_sha256", &self.event_sha256)
            .field("signed_event_json", &"<desktop-only>")
            .finish()
    }
}

impl FrozenManagedMessageEvent {
    /// Parse and freeze one canonical event that exactly represents the typed request.
    pub(crate) fn parse(
        signed_event_json: String,
        request: &ManagedMessagePublishRequestV1,
    ) -> Result<Self, ManagedMessageOutboxError> {
        let event = nostr::Event::from_json(&signed_event_json)
            .map_err(|_| ManagedMessageOutboxError::InvalidEvent)?;
        if !event.verify_id()
            || !event.verify_signature()
            || event.pubkey.to_hex() != request.resident_pubkey.as_str()
            || event.kind != Kind::Custom(9)
            || event.content != request.final_draft
            || !event_tags_match_request(&event, request)
        {
            return Err(ManagedMessageOutboxError::InvalidEvent);
        }
        let canonical =
            canonicalize(&event).map_err(|_| ManagedMessageOutboxError::Canonicalization)?;
        if canonical.as_slice() != signed_event_json.as_bytes() {
            return Err(ManagedMessageOutboxError::InvalidEvent);
        }
        let event_id =
            Hex64::parse(event.id.to_hex()).map_err(|_| ManagedMessageOutboxError::InvalidEvent)?;
        let event_sha256 = Hex64::parse(hex::encode(Sha256::digest(&canonical)))
            .map_err(|_| ManagedMessageOutboxError::Canonicalization)?;
        let content_sha256 = Hex64::parse(hex::encode(Sha256::digest(event.content.as_bytes())))
            .map_err(|_| ManagedMessageOutboxError::Canonicalization)?;
        Ok(Self {
            event_id,
            event_sha256,
            content_sha256,
            signed_event_json,
        })
    }

    /// Exact canonical signed event retained inside desktop authority.
    #[cfg(test)]
    pub(crate) fn signed_event_json(&self) -> &str {
        &self.signed_event_json
    }

    fn validate_self(&self) -> bool {
        let Ok(event) = nostr::Event::from_json(&self.signed_event_json) else {
            return false;
        };
        let Ok(canonical) = canonicalize(&event) else {
            return false;
        };
        event.verify_id()
            && event.verify_signature()
            && event.kind == Kind::Custom(9)
            && event.id.to_hex() == self.event_id.as_str()
            && canonical.as_slice() == self.signed_event_json.as_bytes()
            && hex::encode(Sha256::digest(&canonical)) == self.event_sha256.as_str()
            && hex::encode(Sha256::digest(event.content.as_bytes())) == self.content_sha256.as_str()
    }
}

fn event_tags_match_request(
    event: &nostr::Event,
    request: &ManagedMessagePublishRequestV1,
) -> bool {
    let mut expected = vec![vec![
        "h".to_owned(),
        request.conversation_id.as_str().to_owned(),
    ]];
    match (&request.root_event_id, &request.reply_event_id) {
        (None, None) => {}
        (Some(root), Some(reply)) if root == reply => expected.push(vec![
            "e".to_owned(),
            root.as_str().to_owned(),
            String::new(),
            "reply".to_owned(),
        ]),
        (Some(root), Some(reply)) => {
            expected.push(vec![
                "e".to_owned(),
                root.as_str().to_owned(),
                String::new(),
                "root".to_owned(),
            ]);
            expected.push(vec![
                "e".to_owned(),
                reply.as_str().to_owned(),
                String::new(),
                "reply".to_owned(),
            ]);
        }
        _ => return false,
    }
    expected.extend(
        request
            .resolved_p_tags
            .iter()
            .map(|pubkey| vec!["p".to_owned(), pubkey.as_str().to_owned()]),
    );
    event.tags.iter().map(|tag| tag.as_slice()).eq(expected)
}

/// Body-free state observable by the ACP-side typed client.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ManagedOutboxState {
    /// Exact request and event are frozen.
    Prepared,
    /// The exact event has been submitted to the relay.
    Submitted,
    /// Relay acceptance was durably observed.
    Accepted,
    /// Cancellation won before submission.
    Cancelled,
    /// Relay explicitly rejected the exact event.
    Rejected,
}

/// Body-free receipt for prepare/reconcile status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ManagedOutboxReceipt {
    /// Stable request key.
    pub idempotency_key: Hex64,
    /// Exact frozen Nostr event ID.
    pub event_id: Hex64,
    /// SHA-256 of the exact retained event JSON.
    pub event_sha256: Hex64,
    /// Current deterministic lifecycle state.
    pub state: ManagedOutboxState,
}

#[derive(Clone, Serialize, Deserialize)]
struct ManagedOutboxEntry {
    created_order: u64,
    request_sha256: Hex64,
    request: ManagedMessagePublishRequestV1,
    event: FrozenManagedMessageEvent,
    state: ManagedOutboxState,
    publication_receipt_id: Option<OpaqueId>,
    initial_result_delivered: bool,
    authority_finalized: bool,
    /// New V1B rows remain recoverable until the idempotent continuity job is
    /// durably present. Older outboxes predate handoffs and default to true so
    /// an upgrade never backfills arbitrary historical conversations.
    #[serde(default = "legacy_handoff_recorded")]
    handoff_recorded: bool,
}

const fn legacy_handoff_recorded() -> bool {
    true
}

#[derive(Serialize, Deserialize)]
struct PersistedManagedOutbox {
    schema: String,
    installation_session_id: OpaqueId,
    next_order: u64,
    reconcile_cursor: u64,
    entries: HashMap<String, ManagedOutboxEntry>,
}

/// Desktop-local state machine. Production instances persist only age-encrypted
/// bytes and atomically replace the ciphertext after every transition.
pub(crate) struct ManagedMessageOutbox {
    installation_session_id: OpaqueId,
    entries: HashMap<String, ManagedOutboxEntry>,
    next_order: u64,
    reconcile_cursor: u64,
    persistence_path: Option<PathBuf>,
    passphrase: Option<SecretString>,
}

/// Body-free exact event retained for startup reconciliation.
#[derive(Clone)]
pub(crate) struct ManagedOutboxReconcileEntry {
    pub idempotency_key: Hex64,
    pub event_id: Hex64,
    pub signed_event_json: String,
    pub state: ManagedOutboxState,
    pub request: ManagedMessagePublishRequestV1,
    pub created_order: u64,
}

/// Proof produced by one bounded startup reconciliation pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StartupOutboxReconciliation {
    /// Every entry present at the start reached durable terminal state and no
    /// reconciliation work remains.
    FullyTerminal,
    /// At least one entry was unavailable/deferred, or work still remains.
    Deferred,
}

/// Typed failure returned by a desktop-owned publication authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ManagedPublicationAuthorityError {
    /// No authenticated relay publication authority is attached yet.
    Unavailable,
    /// The desktop policy denied this otherwise valid request.
    Denied,
    /// Cancellation won before relay acceptance.
    Cancelled,
    /// The authority could not reconcile the exact prepared event.
    Invalid,
}

impl ManagedPublicationAuthorityError {
    pub(crate) fn into_protocol_result(self) -> ManagedMessagePublishResultV1 {
        let code = match self {
            Self::Unavailable => "publication-authority-unavailable",
            Self::Denied => "publication-policy-denied",
            Self::Cancelled => "publication-cancelled",
            Self::Invalid => "publication-reconciliation-invalid",
        };
        let code = OpaqueId::parse(code).expect("fixed publication status code is valid");
        match self {
            Self::Unavailable => ManagedMessagePublishResultV1::Unavailable { code },
            Self::Denied => ManagedMessagePublishResultV1::Denied { code },
            Self::Cancelled => ManagedMessagePublishResultV1::Cancelled { code },
            Self::Invalid => ManagedMessagePublishResultV1::Invalid { code },
        }
    }
}

/// Desktop-owned seam for F09 relay submission and reconciliation.
///
/// The broker has already validated and frozen the exact signed event before
/// invoking this authority. An implementation must read that event through
/// [`ManagedMessageOutbox::event_for_submission`], mark it submitted before
/// network I/O, and mark it accepted only after honest relay acceptance. On
/// success this method must leave the entry accepted; the broker derives the
/// body-free protocol result from the outbox rather than trusting the adapter.
pub(crate) trait ManagedMessagePublicationAuthority: Send {
    /// Reauthorize the exact typed request against desktop-owned dispatch state
    /// before the resident event is constructed or signed.
    fn authorize_request(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        now_unix_secs: u64,
    ) -> Result<(), ManagedPublicationAuthorityError>;

    fn publish_prepared(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        outbox: &mut ManagedMessageOutbox,
        installation_session_id: &OpaqueId,
    ) -> Result<(), ManagedPublicationAuthorityError>;

    /// Reconcile exact submitted bytes after desktop/broker restart.
    fn reconcile_on_start(
        &mut self,
        _outbox: &mut ManagedMessageOutbox,
        _installation_session_id: &OpaqueId,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        Ok(())
    }
}

/// F14 default: validate and stage exactly, then report unavailable without
/// closing the signing session or pretending network publication occurred.
#[cfg(test)]
pub(crate) struct UnavailableManagedMessagePublicationAuthority;

#[cfg(test)]
impl ManagedMessagePublicationAuthority for UnavailableManagedMessagePublicationAuthority {
    fn authorize_request(
        &mut self,
        _request: &ManagedMessagePublishRequestV1,
        _now_unix_secs: u64,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        Err(ManagedPublicationAuthorityError::Unavailable)
    }

    fn publish_prepared(
        &mut self,
        _request: &ManagedMessagePublishRequestV1,
        _outbox: &mut ManagedMessageOutbox,
        _installation_session_id: &OpaqueId,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        Err(ManagedPublicationAuthorityError::Unavailable)
    }
}

impl ManagedMessageOutbox {
    /// Create an empty outbox bound to the active desktop installation session.
    #[cfg(test)]
    pub(crate) fn new(installation_session_id: OpaqueId) -> Self {
        Self {
            installation_session_id,
            entries: HashMap::new(),
            next_order: 1,
            reconcile_cursor: 0,
            persistence_path: None,
            passphrase: None,
        }
    }

    /// Load or create an atomically persisted age-passphrase-encrypted outbox.
    pub(crate) fn load_encrypted(
        installation_session_id: OpaqueId,
        path: PathBuf,
        passphrase: SecretString,
    ) -> Result<Self, ManagedMessageOutboxError> {
        if !path.exists() {
            return Ok(Self {
                installation_session_id,
                entries: HashMap::new(),
                next_order: 1,
                reconcile_cursor: 0,
                persistence_path: Some(path),
                passphrase: Some(passphrase),
            });
        }
        let ciphertext =
            std::fs::read(&path).map_err(|_| ManagedMessageOutboxError::Persistence)?;
        if ciphertext.len() > MAX_CIPHERTEXT_BYTES {
            return Err(ManagedMessageOutboxError::Persistence);
        }
        let decryptor = age::Decryptor::new_buffered(ciphertext.as_slice())
            .map_err(|_| ManagedMessageOutboxError::Persistence)?;
        let identity = age::scrypt::Identity::new(passphrase.clone());
        let mut reader = decryptor
            .decrypt(std::iter::once(&identity as &dyn age::Identity))
            .map_err(|_| ManagedMessageOutboxError::Persistence)?;
        let mut plaintext = Vec::new();
        reader
            .by_ref()
            .take((MAX_PLAINTEXT_BYTES + 1) as u64)
            .read_to_end(&mut plaintext)
            .map_err(|_| ManagedMessageOutboxError::Persistence)?;
        if plaintext.len() > MAX_PLAINTEXT_BYTES {
            return Err(ManagedMessageOutboxError::Persistence);
        }
        let persisted: PersistedManagedOutbox = serde_json::from_slice(&plaintext)
            .map_err(|_| ManagedMessageOutboxError::Persistence)?;
        if canonicalize(&persisted)
            .map(|canonical| canonical != plaintext)
            .unwrap_or(true)
        {
            return Err(ManagedMessageOutboxError::Persistence);
        }
        if persisted.schema != OUTBOX_SCHEMA
            || persisted.installation_session_id != installation_session_id
            || persisted.next_order == 0
            || persisted.reconcile_cursor >= persisted.next_order
            || persisted.entries.len() > MAX_OUTBOX_ENTRIES
        {
            return Err(ManagedMessageOutboxError::Persistence);
        }
        for (key, entry) in &persisted.entries {
            let receipt_state_valid = match entry.state {
                ManagedOutboxState::Accepted => entry.publication_receipt_id.is_some(),
                ManagedOutboxState::Prepared
                | ManagedOutboxState::Submitted
                | ManagedOutboxState::Cancelled
                | ManagedOutboxState::Rejected => entry.publication_receipt_id.is_none(),
            };
            let request_sha256 = canonical_sha256(&entry.request)
                .ok()
                .and_then(|value| Hex64::parse(value).ok());
            let event_matches_request = FrozenManagedMessageEvent::parse(
                entry.event.signed_event_json.clone(),
                &entry.request,
            )
            .map(|event| {
                event.event_id == entry.event.event_id
                    && event.event_sha256 == entry.event.event_sha256
            })
            .unwrap_or(false);
            if key.len() != 64
                || Hex64::parse(key.clone()).is_err()
                || !entry.event.validate_self()
                || entry.request.validate().is_err()
                || entry.request.idempotency_key.as_str() != key
                || request_sha256.as_ref() != Some(&entry.request_sha256)
                || !event_matches_request
                || !receipt_state_valid
                || (entry.initial_result_delivered && entry.state != ManagedOutboxState::Accepted)
                || (entry.authority_finalized
                    && !matches!(
                        entry.state,
                        ManagedOutboxState::Accepted
                            | ManagedOutboxState::Cancelled
                            | ManagedOutboxState::Rejected
                    ))
                || entry.created_order == 0
                || entry.created_order >= persisted.next_order
            {
                return Err(ManagedMessageOutboxError::Persistence);
            }
        }
        Ok(Self {
            installation_session_id,
            entries: persisted.entries,
            next_order: persisted.next_order,
            reconcile_cursor: persisted.reconcile_cursor,
            persistence_path: Some(path),
            passphrase: Some(passphrase),
        })
    }

    /// Submitted exact events that need relay query/resubmission on restart.
    pub(crate) fn reconciliation_entries(&self) -> Vec<ManagedOutboxReconcileEntry> {
        let mut entries: Vec<_> = self
            .entries
            .iter()
            .filter(|(_, entry)| {
                matches!(
                    entry.state,
                    ManagedOutboxState::Prepared | ManagedOutboxState::Submitted
                ) || (matches!(
                    entry.state,
                    ManagedOutboxState::Accepted
                        | ManagedOutboxState::Cancelled
                        | ManagedOutboxState::Rejected
                ) && (!entry.authority_finalized
                    || (entry.state == ManagedOutboxState::Accepted && !entry.handoff_recorded)))
            })
            .filter_map(|(key, entry)| {
                Some(ManagedOutboxReconcileEntry {
                    idempotency_key: Hex64::parse(key.clone()).ok()?,
                    event_id: entry.event.event_id.clone(),
                    signed_event_json: entry.event.signed_event_json.clone(),
                    state: entry.state,
                    request: entry.request.clone(),
                    created_order: entry.created_order,
                })
            })
            .collect();
        entries.sort_by_key(|entry| {
            (
                entry.created_order <= self.reconcile_cursor,
                entry.created_order,
            )
        });
        entries
    }

    /// Persist fair rotation after each attempted startup reconciliation row.
    pub(crate) fn advance_reconcile_cursor(
        &mut self,
        created_order: u64,
    ) -> Result<(), ManagedMessageOutboxError> {
        if created_order == 0 || created_order >= self.next_order {
            return Err(ManagedMessageOutboxError::InvalidTransition);
        }
        let previous = self.reconcile_cursor;
        self.reconcile_cursor = created_order;
        if let Err(error) = self.persist() {
            self.reconcile_cursor = previous;
            return Err(error);
        }
        Ok(())
    }

    /// Inspect an exact durable request before consulting fresh dispatch authority.
    ///
    /// This is the only path that lets a desktop-restart duplicate recover an
    /// accepted receipt. Any semantic or event-binding drift under the same key
    /// fails closed as an idempotency collision.
    pub(crate) fn preflight_existing(
        &self,
        request: &ManagedMessagePublishRequestV1,
    ) -> Result<Option<ManagedOutboxReceipt>, ManagedMessageOutboxError> {
        request
            .validate()
            .map_err(|_| ManagedMessageOutboxError::InvalidRequest)?;
        let Some(entry) = self.entries.get(request.idempotency_key.as_str()) else {
            return Ok(None);
        };
        let request_sha256 = canonical_sha256(request)
            .map_err(|_| ManagedMessageOutboxError::Canonicalization)
            .and_then(|digest| {
                Hex64::parse(digest).map_err(|_| ManagedMessageOutboxError::Canonicalization)
            })?;
        let event_matches =
            FrozenManagedMessageEvent::parse(entry.event.signed_event_json.clone(), request)
                .map(|event| {
                    event.event_id == entry.event.event_id
                        && event.event_sha256 == entry.event.event_sha256
                        && event.content_sha256 == entry.event.content_sha256
                })
                .unwrap_or(false);
        if entry.request_sha256 != request_sha256 || entry.request != *request || !event_matches {
            return Err(ManagedMessageOutboxError::IdempotencyCollision);
        }
        Ok(Some(receipt_for(&request.idempotency_key, entry)))
    }

    /// Freeze exactly one signed final event before any network I/O.
    pub(crate) fn prepare(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        event: FrozenManagedMessageEvent,
        observed_installation_session_id: &OpaqueId,
        active_cancellation_epoch: u64,
        turn_is_cancelled: bool,
    ) -> Result<ManagedOutboxReceipt, ManagedMessageOutboxError> {
        request
            .validate()
            .map_err(|_| ManagedMessageOutboxError::InvalidRequest)?;
        if observed_installation_session_id != &self.installation_session_id {
            return Err(ManagedMessageOutboxError::InactiveSession);
        }
        if turn_is_cancelled || active_cancellation_epoch != request.cancellation_epoch.get() {
            return Err(ManagedMessageOutboxError::Cancelled);
        }
        let expected_content_sha256 =
            Hex64::parse(hex::encode(Sha256::digest(request.final_draft.as_bytes())))
                .map_err(|_| ManagedMessageOutboxError::Canonicalization)?;
        if event.content_sha256 != expected_content_sha256 {
            return Err(ManagedMessageOutboxError::InvalidEvent);
        }
        let request_sha256 = canonical_sha256(request)
            .map_err(|_| ManagedMessageOutboxError::Canonicalization)
            .and_then(|digest| {
                Hex64::parse(digest).map_err(|_| ManagedMessageOutboxError::Canonicalization)
            })?;
        let key = request.idempotency_key.as_str().to_owned();

        if let Some(existing) = self.entries.get(&key) {
            if existing.request_sha256 != request_sha256
                || existing.event.event_id != event.event_id
                || existing.event.event_sha256 != event.event_sha256
            {
                return Err(ManagedMessageOutboxError::IdempotencyCollision);
            }
            return Ok(receipt_for(&request.idempotency_key, existing));
        }

        let previous = self.entries.clone();
        let previous_next_order = self.next_order;
        let next_order = self
            .next_order
            .checked_add(1)
            .ok_or(ManagedMessageOutboxError::Persistence)?;
        self.compact_terminal_for_capacity();
        if self.entries.len() >= MAX_OUTBOX_ENTRIES {
            return Err(ManagedMessageOutboxError::Persistence);
        }
        let entry = ManagedOutboxEntry {
            created_order: self.next_order,
            request_sha256,
            request: request.clone(),
            event,
            state: ManagedOutboxState::Prepared,
            publication_receipt_id: None,
            initial_result_delivered: false,
            authority_finalized: false,
            handoff_recorded: false,
        };
        let receipt = receipt_for(&request.idempotency_key, &entry);
        self.next_order = next_order;
        self.entries.insert(key, entry);
        if let Err(error) = self.persist() {
            self.entries = previous;
            self.next_order = previous_next_order;
            return Err(error);
        }
        Ok(receipt)
    }

    /// Return the exact frozen event for the desktop-authorized F09 publisher.
    pub(crate) fn event_for_submission(
        &self,
        idempotency_key: &Hex64,
    ) -> Result<&str, ManagedMessageOutboxError> {
        let entry = self
            .entries
            .get(idempotency_key.as_str())
            .ok_or(ManagedMessageOutboxError::NotFound)?;
        if !matches!(
            entry.state,
            ManagedOutboxState::Prepared | ManagedOutboxState::Submitted
        ) {
            return Err(ManagedMessageOutboxError::InvalidTransition);
        }
        Ok(&entry.event.signed_event_json)
    }

    /// Record that the exact retained event was submitted, without re-signing it.
    pub(crate) fn mark_submitted(
        &mut self,
        idempotency_key: &Hex64,
        observed_installation_session_id: &OpaqueId,
        turn_is_cancelled: bool,
    ) -> Result<ManagedOutboxReceipt, ManagedMessageOutboxError> {
        if observed_installation_session_id != &self.installation_session_id {
            return Err(ManagedMessageOutboxError::InactiveSession);
        }
        if turn_is_cancelled {
            return self.cancel_before_submission(idempotency_key);
        }
        let previous = self.entries.clone();
        let entry = self
            .entries
            .get_mut(idempotency_key.as_str())
            .ok_or(ManagedMessageOutboxError::NotFound)?;
        if entry.state == ManagedOutboxState::Submitted {
            return Ok(receipt_for(idempotency_key, entry));
        }
        if entry.state != ManagedOutboxState::Prepared {
            return Err(ManagedMessageOutboxError::InvalidTransition);
        }
        entry.state = ManagedOutboxState::Submitted;
        let receipt = receipt_for(idempotency_key, entry);
        if let Err(error) = self.persist() {
            self.entries = previous;
            return Err(error);
        }
        Ok(receipt)
    }

    /// Record honest relay acceptance of the exact submitted event.
    pub(crate) fn mark_accepted(
        &mut self,
        idempotency_key: &Hex64,
        publication_receipt_id: OpaqueId,
    ) -> Result<ManagedOutboxReceipt, ManagedMessageOutboxError> {
        let previous = self.entries.clone();
        let entry = self
            .entries
            .get_mut(idempotency_key.as_str())
            .ok_or(ManagedMessageOutboxError::NotFound)?;
        if entry.state == ManagedOutboxState::Accepted {
            if entry.publication_receipt_id.as_ref() != Some(&publication_receipt_id) {
                return Err(ManagedMessageOutboxError::IdempotencyCollision);
            }
            return Ok(receipt_for(idempotency_key, entry));
        }
        if entry.state != ManagedOutboxState::Submitted {
            return Err(ManagedMessageOutboxError::InvalidTransition);
        }
        entry.state = ManagedOutboxState::Accepted;
        entry.publication_receipt_id = Some(publication_receipt_id);
        let receipt = receipt_for(idempotency_key, entry);
        if let Err(error) = self.persist() {
            self.entries = previous;
            return Err(error);
        }
        Ok(receipt)
    }

    /// Cancel only while the exact event is prepared and unsent.
    pub(crate) fn cancel_before_submission(
        &mut self,
        idempotency_key: &Hex64,
    ) -> Result<ManagedOutboxReceipt, ManagedMessageOutboxError> {
        let previous = self.entries.clone();
        let entry = self
            .entries
            .get_mut(idempotency_key.as_str())
            .ok_or(ManagedMessageOutboxError::NotFound)?;
        if entry.state != ManagedOutboxState::Prepared {
            return Err(ManagedMessageOutboxError::InvalidTransition);
        }
        entry.state = ManagedOutboxState::Cancelled;
        let receipt = receipt_for(idempotency_key, entry);
        if let Err(error) = self.persist() {
            self.entries = previous;
            return Err(error);
        }
        Ok(receipt)
    }

    /// Terminalize a startup-reconciled entry after proving relay absence and
    /// observing that durable cancellation won.
    pub(crate) fn cancel_during_reconciliation(
        &mut self,
        idempotency_key: &Hex64,
    ) -> Result<ManagedOutboxReceipt, ManagedMessageOutboxError> {
        let previous = self.entries.clone();
        let entry = self
            .entries
            .get_mut(idempotency_key.as_str())
            .ok_or(ManagedMessageOutboxError::NotFound)?;
        if !matches!(
            entry.state,
            ManagedOutboxState::Prepared | ManagedOutboxState::Submitted
        ) {
            return Err(ManagedMessageOutboxError::InvalidTransition);
        }
        entry.state = ManagedOutboxState::Cancelled;
        let receipt = receipt_for(idempotency_key, entry);
        if let Err(error) = self.persist() {
            self.entries = previous;
            return Err(error);
        }
        Ok(receipt)
    }

    /// Terminalize a startup-reconciled entry after durable dispatch rejection.
    pub(crate) fn reject_during_reconciliation(
        &mut self,
        idempotency_key: &Hex64,
    ) -> Result<ManagedOutboxReceipt, ManagedMessageOutboxError> {
        let previous = self.entries.clone();
        let entry = self
            .entries
            .get_mut(idempotency_key.as_str())
            .ok_or(ManagedMessageOutboxError::NotFound)?;
        if !matches!(
            entry.state,
            ManagedOutboxState::Prepared | ManagedOutboxState::Submitted
        ) {
            return Err(ManagedMessageOutboxError::InvalidTransition);
        }
        entry.state = ManagedOutboxState::Rejected;
        let receipt = receipt_for(idempotency_key, entry);
        if let Err(error) = self.persist() {
            self.entries = previous;
            return Err(error);
        }
        Ok(receipt)
    }

    /// Return `published` once and `replayed` thereafter for an accepted entry.
    pub(crate) fn accepted_result(
        &mut self,
        idempotency_key: &Hex64,
    ) -> Result<ManagedMessagePublishResultV1, ManagedMessageOutboxError> {
        let previous = self.entries.clone();
        let entry = self
            .entries
            .get_mut(idempotency_key.as_str())
            .ok_or(ManagedMessageOutboxError::NotFound)?;
        if entry.state != ManagedOutboxState::Accepted {
            return Err(ManagedMessageOutboxError::InvalidTransition);
        }
        let publication_receipt_id = entry
            .publication_receipt_id
            .clone()
            .ok_or(ManagedMessageOutboxError::InvalidTransition)?;
        let result = if entry.initial_result_delivered {
            ManagedMessagePublishResultV1::Replayed {
                event_id: entry.event.event_id.clone(),
                event_sha256: entry.event.event_sha256.clone(),
                publication_receipt_id,
            }
        } else {
            entry.initial_result_delivered = true;
            ManagedMessagePublishResultV1::Published {
                event_id: entry.event.event_id.clone(),
                event_sha256: entry.event.event_sha256.clone(),
                publication_receipt_id,
            }
        };
        if let Err(error) = self.persist() {
            self.entries = previous;
            return Err(error);
        }
        Ok(result)
    }

    /// Confirm the durable dispatch store now references this accepted outbox row.
    pub(crate) fn mark_authority_finalized(
        &mut self,
        idempotency_key: &Hex64,
    ) -> Result<(), ManagedMessageOutboxError> {
        let previous = self.entries.clone();
        let entry = self
            .entries
            .get_mut(idempotency_key.as_str())
            .ok_or(ManagedMessageOutboxError::NotFound)?;
        if !matches!(
            entry.state,
            ManagedOutboxState::Accepted
                | ManagedOutboxState::Cancelled
                | ManagedOutboxState::Rejected
        ) {
            return Err(ManagedMessageOutboxError::InvalidTransition);
        }
        if entry.authority_finalized {
            return Ok(());
        }
        entry.authority_finalized = true;
        if let Err(error) = self.persist() {
            self.entries = previous;
            return Err(error);
        }
        Ok(())
    }

    /// Record that the accepted event has a durable, idempotent continuity
    /// outcome. A crash before this transition intentionally leaves the
    /// encrypted outbox row eligible for startup reconciliation.
    pub(crate) fn mark_handoff_recorded(
        &mut self,
        idempotency_key: &Hex64,
    ) -> Result<(), ManagedMessageOutboxError> {
        let previous = self.entries.clone();
        let entry = self
            .entries
            .get_mut(idempotency_key.as_str())
            .ok_or(ManagedMessageOutboxError::NotFound)?;
        if entry.state != ManagedOutboxState::Accepted || !entry.authority_finalized {
            return Err(ManagedMessageOutboxError::InvalidTransition);
        }
        if entry.handoff_recorded {
            return Ok(());
        }
        entry.handoff_recorded = true;
        if let Err(error) = self.persist() {
            self.entries = previous;
            return Err(error);
        }
        Ok(())
    }

    fn persist(&self) -> Result<(), ManagedMessageOutboxError> {
        let (Some(path), Some(passphrase)) = (&self.persistence_path, &self.passphrase) else {
            return Ok(());
        };
        if self.entries.len() > MAX_OUTBOX_ENTRIES {
            return Err(ManagedMessageOutboxError::Persistence);
        }
        let plaintext = canonicalize(&PersistedManagedOutbox {
            schema: OUTBOX_SCHEMA.to_owned(),
            installation_session_id: self.installation_session_id.clone(),
            next_order: self.next_order,
            reconcile_cursor: self.reconcile_cursor,
            entries: self.entries.clone(),
        })
        .map_err(|_| ManagedMessageOutboxError::Persistence)?;
        if plaintext.len() > MAX_PLAINTEXT_BYTES {
            return Err(ManagedMessageOutboxError::Persistence);
        }
        let encryptor = age::Encryptor::with_user_passphrase(passphrase.clone());
        let mut ciphertext = Vec::new();
        {
            let mut writer = encryptor
                .wrap_output(&mut ciphertext)
                .map_err(|_| ManagedMessageOutboxError::Persistence)?;
            writer
                .write_all(&plaintext)
                .map_err(|_| ManagedMessageOutboxError::Persistence)?;
            writer
                .finish()
                .map_err(|_| ManagedMessageOutboxError::Persistence)?;
        }
        atomic_write_ciphertext(path, &ciphertext)
    }

    fn compact_terminal_for_capacity(&mut self) {
        if self.entries.len() < MAX_OUTBOX_ENTRIES {
            return;
        }
        let mut terminal: Vec<_> = self
            .entries
            .iter()
            .filter(|(_, entry)| {
                matches!(
                    entry.state,
                    ManagedOutboxState::Accepted
                        | ManagedOutboxState::Cancelled
                        | ManagedOutboxState::Rejected
                ) && entry.authority_finalized
                    && (entry.state != ManagedOutboxState::Accepted || entry.handoff_recorded)
            })
            .map(|(key, entry)| (entry.created_order, key.clone()))
            .collect();
        terminal.sort();
        let remove_count = self
            .entries
            .len()
            .saturating_add(1)
            .saturating_sub(MAX_OUTBOX_ENTRIES);
        for (_, key) in terminal.into_iter().take(remove_count) {
            self.entries.remove(&key);
        }
    }
}

fn atomic_write_ciphertext(
    path: &Path,
    ciphertext: &[u8],
) -> Result<(), ManagedMessageOutboxError> {
    let parent = path
        .parent()
        .ok_or(ManagedMessageOutboxError::Persistence)?;
    std::fs::create_dir_all(parent).map_err(|_| ManagedMessageOutboxError::Persistence)?;
    let mut file =
        AtomicWriteFile::open(path).map_err(|_| ManagedMessageOutboxError::Persistence)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| ManagedMessageOutboxError::Persistence)?;
    }
    file.write_all(ciphertext)
        .map_err(|_| ManagedMessageOutboxError::Persistence)?;
    file.commit()
        .map_err(|_| ManagedMessageOutboxError::Persistence)
}

fn receipt_for(idempotency_key: &Hex64, entry: &ManagedOutboxEntry) -> ManagedOutboxReceipt {
    ManagedOutboxReceipt {
        idempotency_key: idempotency_key.clone(),
        event_id: entry.event.event_id.clone(),
        event_sha256: entry.event.event_sha256.clone(),
        state: entry.state,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::{
        derive_message_publish_idempotency_key, SafeU53, MESSAGE_PUBLISH_PROTOCOL,
    };
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn hex(value: char) -> Hex64 {
        Hex64::parse(value.to_string().repeat(64)).expect("valid fixture hex")
    }

    fn request(keys: &Keys) -> ManagedMessagePublishRequestV1 {
        let resident_pubkey =
            Hex64::parse(keys.public_key().to_hex()).expect("valid resident pubkey");
        let dispatch_receipt_id = OpaqueId::parse("dispatch-1").expect("valid dispatch receipt ID");
        ManagedMessagePublishRequestV1 {
            protocol: MESSAGE_PUBLISH_PROTOCOL.to_owned(),
            turn_id: OpaqueId::parse("turn-1").expect("valid turn ID"),
            idempotency_key: derive_message_publish_idempotency_key(
                &dispatch_receipt_id,
                &resident_pubkey,
            )
            .expect("valid idempotency key"),
            owner_pubkey: hex('a'),
            resident_pubkey,
            conversation_id: OpaqueId::parse("conversation-1").expect("valid conversation ID"),
            thread_id: None,
            root_event_id: None,
            reply_event_id: None,
            resolved_p_tags: Vec::new(),
            final_draft: "A bounded final answer.".to_owned(),
            dispatch_receipt_id,
            cancellation_epoch: SafeU53::new(3).expect("valid cancellation epoch"),
        }
    }

    fn frozen_event(
        keys: &Keys,
        request: &ManagedMessagePublishRequestV1,
    ) -> FrozenManagedMessageEvent {
        let tags =
            vec![Tag::parse(["h", request.conversation_id.as_str()])
                .expect("valid conversation tag")];
        let event = EventBuilder::new(Kind::Custom(9), request.final_draft.clone())
            .tags(tags)
            .sign_with_keys(keys)
            .expect("sign fixture event");
        let canonical =
            String::from_utf8(canonicalize(&event).expect("canonical event")).expect("UTF-8 event");
        FrozenManagedMessageEvent::parse(canonical, request).expect("valid frozen event")
    }

    #[test]
    fn luca_signing_outbox_has_one_way_exact_event_lifecycle() {
        let keys = Keys::parse(&"02".repeat(32)).expect("valid fixture key");
        let request = request(&keys);
        let event = frozen_event(&keys, &request);
        let session = OpaqueId::parse("installation-1").expect("valid installation ID");
        let mut outbox = ManagedMessageOutbox::new(session.clone());

        let prepared = outbox
            .prepare(&request, event, &session, 3, false)
            .expect("prepare");
        assert_eq!(prepared.state, ManagedOutboxState::Prepared);
        let exact_event = outbox
            .event_for_submission(&request.idempotency_key)
            .expect("exact event")
            .to_owned();
        let submitted = outbox
            .mark_submitted(&request.idempotency_key, &session, false)
            .expect("submit");
        assert_eq!(submitted.state, ManagedOutboxState::Submitted);
        assert_eq!(
            exact_event,
            outbox
                .entries
                .get(request.idempotency_key.as_str())
                .expect("retained entry")
                .event
                .signed_event_json,
            "submission must retain the same exact signed event"
        );

        let accepted = outbox
            .mark_accepted(
                &request.idempotency_key,
                OpaqueId::parse("publication-1").expect("valid receipt"),
            )
            .expect("accept");
        assert_eq!(accepted.state, ManagedOutboxState::Accepted);
        assert!(matches!(
            outbox
                .accepted_result(&request.idempotency_key)
                .expect("first result"),
            ManagedMessagePublishResultV1::Published { .. }
        ));
        assert!(matches!(
            outbox
                .accepted_result(&request.idempotency_key)
                .expect("replay result"),
            ManagedMessagePublishResultV1::Replayed { .. }
        ));
    }

    #[test]
    fn luca_signing_outbox_cancellation_wins_before_submit_only() {
        let keys = Keys::parse(&"03".repeat(32)).expect("valid fixture key");
        let request = request(&keys);
        let event = frozen_event(&keys, &request);
        let session = OpaqueId::parse("installation-1").expect("valid installation ID");
        let mut outbox = ManagedMessageOutbox::new(session.clone());
        outbox
            .prepare(&request, event, &session, 3, false)
            .expect("prepare");
        let cancelled = outbox
            .cancel_before_submission(&request.idempotency_key)
            .expect("cancel");
        assert_eq!(cancelled.state, ManagedOutboxState::Cancelled);
        assert!(matches!(
            outbox.mark_submitted(&request.idempotency_key, &session, false),
            Err(ManagedMessageOutboxError::InvalidTransition)
        ));
    }

    #[test]
    fn luca_signing_outbox_rejects_any_tag_not_derived_from_typed_request() {
        let keys = Keys::parse(&"03".repeat(32)).expect("valid fixture key");
        let request = request(&keys);
        let event = EventBuilder::new(Kind::Custom(9), request.final_draft.clone())
            .tags([
                Tag::parse(["h", request.conversation_id.as_str()])
                    .expect("valid conversation tag"),
                Tag::parse(["p", hex('f').as_str()]).expect("valid unauthorized mention"),
            ])
            .sign_with_keys(&keys)
            .expect("sign fixture event");
        let canonical =
            String::from_utf8(canonicalize(&event).expect("canonical event")).expect("UTF-8 event");
        assert!(matches!(
            FrozenManagedMessageEvent::parse(canonical, &request),
            Err(ManagedMessageOutboxError::InvalidEvent)
        ));
    }

    #[test]
    fn luca_signing_outbox_encrypts_and_reloads_exact_prepared_event() {
        let keys = Keys::parse(&"04".repeat(32)).expect("valid fixture key");
        let mut request = request(&keys);
        request.final_draft = "PLAINTEXT-FINAL-MUST-NOT-APPEAR".to_owned();
        let event = frozen_event(&keys, &request);
        let exact_event = event.signed_event_json().to_owned();
        let exact_event_id = event.event_id.clone();
        let session = OpaqueId::parse("installation-encrypted").expect("valid installation ID");
        let passphrase = SecretString::from("RESIDENT-SECRET-SENTINEL".to_owned());
        let temp = tempfile::tempdir().expect("temp");
        let path = temp.path().join("managed-outbox.age");
        let mut outbox =
            ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
                .expect("new encrypted outbox");

        outbox
            .prepare(&request, event, &session, 3, false)
            .expect("durable prepare");
        let ciphertext = std::fs::read(&path).expect("ciphertext");
        assert!(!ciphertext
            .windows(request.final_draft.len())
            .any(|window| window == request.final_draft.as_bytes()));
        assert!(!ciphertext
            .windows("RESIDENT-SECRET-SENTINEL".len())
            .any(|window| window == b"RESIDENT-SECRET-SENTINEL"));

        let reloaded =
            ManagedMessageOutbox::load_encrypted(session, path, passphrase).expect("reload");
        let entries = reloaded.reconciliation_entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].event_id, exact_event_id);
        assert_eq!(entries[0].signed_event_json, exact_event);
        assert_eq!(entries[0].request, request);
        assert_eq!(entries[0].state, ManagedOutboxState::Prepared);
    }

    #[test]
    fn luca_signing_outbox_persists_every_transition_and_replay_bit() {
        let keys = Keys::parse(&"05".repeat(32)).expect("valid fixture key");
        let request = request(&keys);
        let event = frozen_event(&keys, &request);
        let session = OpaqueId::parse("installation-transitions").expect("valid installation ID");
        let passphrase = SecretString::from("transition-passphrase".to_owned());
        let temp = tempfile::tempdir().expect("temp");
        let path = temp.path().join("managed-outbox.age");
        let mut outbox =
            ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
                .expect("new encrypted outbox");
        outbox
            .prepare(&request, event, &session, 3, false)
            .expect("prepare");

        let mut outbox =
            ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
                .expect("reload prepared");
        assert_eq!(
            outbox
                .mark_submitted(&request.idempotency_key, &session, false)
                .expect("submitted")
                .state,
            ManagedOutboxState::Submitted
        );
        let mut outbox =
            ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
                .expect("reload submitted");
        assert_eq!(
            outbox.reconciliation_entries()[0].state,
            ManagedOutboxState::Submitted
        );
        outbox
            .mark_accepted(
                &request.idempotency_key,
                OpaqueId::parse("relay-receipt").expect("receipt"),
            )
            .expect("accepted");

        let mut outbox =
            ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
                .expect("reload accepted");
        assert!(matches!(
            outbox
                .accepted_result(&request.idempotency_key)
                .expect("published"),
            ManagedMessagePublishResultV1::Published { .. }
        ));
        let mut outbox = ManagedMessageOutbox::load_encrypted(session, path, passphrase)
            .expect("reload replay bit");
        assert!(matches!(
            outbox
                .accepted_result(&request.idempotency_key)
                .expect("replayed"),
            ManagedMessagePublishResultV1::Replayed { .. }
        ));
    }

    #[test]
    fn accepted_outbox_remains_recoverable_until_handoff_is_durable() {
        let keys = Keys::parse(&"0c".repeat(32)).expect("valid fixture key");
        let request = request(&keys);
        let event = frozen_event(&keys, &request);
        let session =
            OpaqueId::parse("installation-handoff-transfer").expect("valid installation ID");
        let passphrase = SecretString::from("handoff-transfer-passphrase".to_owned());
        let temp = tempfile::tempdir().expect("temp");
        let path = temp.path().join("managed-outbox.age");
        let mut outbox =
            ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
                .expect("new encrypted outbox");
        outbox
            .prepare(&request, event, &session, 3, false)
            .expect("prepare");
        outbox
            .mark_submitted(&request.idempotency_key, &session, false)
            .expect("submitted");
        outbox
            .mark_accepted(
                &request.idempotency_key,
                OpaqueId::parse("handoff-transfer-receipt").expect("receipt"),
            )
            .expect("accepted");
        outbox
            .mark_authority_finalized(&request.idempotency_key)
            .expect("authority finalized");

        // Simulate an application crash after publication authority commits but
        // before the continuity scheduler records its idempotent job.
        let mut reloaded =
            ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
                .expect("reload crash window");
        let pending = reloaded.reconciliation_entries();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].state, ManagedOutboxState::Accepted);
        assert_eq!(pending[0].idempotency_key, request.idempotency_key);

        reloaded
            .mark_handoff_recorded(&request.idempotency_key)
            .expect("handoff recorded");
        let completed = ManagedMessageOutbox::load_encrypted(session, path, passphrase)
            .expect("reload completed transfer");
        assert!(completed.reconciliation_entries().is_empty());
    }

    #[test]
    fn luca_signing_outbox_persistence_failure_rolls_back_for_retry() {
        let keys = Keys::parse(&"06".repeat(32)).expect("valid fixture key");
        let request = request(&keys);
        let event = frozen_event(&keys, &request);
        let session = OpaqueId::parse("installation-failure").expect("valid installation ID");
        let passphrase = SecretString::from("failure-passphrase".to_owned());
        let temp = tempfile::tempdir().expect("temp");
        let directory_target = temp.path().join("directory-target");
        std::fs::create_dir(&directory_target).expect("directory target");
        let mut outbox = ManagedMessageOutbox::load_encrypted(
            session.clone(),
            temp.path().join("initial-valid-target.age"),
            passphrase.clone(),
        )
        .expect("outbox");
        outbox.persistence_path = Some(directory_target);
        assert!(matches!(
            outbox.prepare(&request, event.clone(), &session, 3, false),
            Err(ManagedMessageOutboxError::Persistence)
        ));
        assert!(outbox.entries.is_empty());

        let valid_path = temp.path().join("managed-outbox.age");
        outbox.persistence_path = Some(valid_path.clone());
        outbox
            .prepare(&request, event, &session, 3, false)
            .expect("retry prepare");
        assert!(ManagedMessageOutbox::load_encrypted(session, valid_path, passphrase).is_ok());
    }

    #[test]
    fn luca_signing_outbox_rejects_corrupt_accepted_invariant_on_load() {
        let keys = Keys::parse(&"07".repeat(32)).expect("valid fixture key");
        let request = request(&keys);
        let event = frozen_event(&keys, &request);
        let session = OpaqueId::parse("installation-corrupt").expect("valid installation ID");
        let passphrase = SecretString::from("corrupt-passphrase".to_owned());
        let temp = tempfile::tempdir().expect("temp");
        let path = temp.path().join("managed-outbox.age");
        let mut outbox =
            ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
                .expect("outbox");
        outbox
            .prepare(&request, event, &session, 3, false)
            .expect("prepare");
        let entry = outbox
            .entries
            .get_mut(request.idempotency_key.as_str())
            .expect("entry");
        entry.state = ManagedOutboxState::Accepted;
        entry.publication_receipt_id = None;
        outbox
            .persist()
            .expect("persist deliberately corrupt fixture");

        assert!(matches!(
            ManagedMessageOutbox::load_encrypted(session, path, passphrase),
            Err(ManagedMessageOutboxError::Persistence)
        ));
    }

    #[test]
    fn luca_signing_outbox_capacity_evicts_only_oldest_finalized_terminal() {
        let keys = Keys::parse(&"08".repeat(32)).expect("valid fixture key");
        let request = request(&keys);
        let event = frozen_event(&keys, &request);
        let session = OpaqueId::parse("installation-capacity").expect("valid installation ID");
        let mut outbox = ManagedMessageOutbox::new(session.clone());
        outbox
            .prepare(&request, event.clone(), &session, 3, false)
            .expect("seed");
        let template = outbox
            .entries
            .remove(request.idempotency_key.as_str())
            .expect("template");
        let mut unresolved_keys = Vec::new();
        for index in 0..MAX_OUTBOX_ENTRIES {
            let key = hex::encode(Sha256::digest(index.to_be_bytes()));
            let mut entry = template.clone();
            entry.created_order = index as u64 + 1;
            if index == 0 {
                entry.state = ManagedOutboxState::Accepted;
                entry.publication_receipt_id =
                    Some(OpaqueId::parse("accepted-receipt").expect("receipt"));
                entry.authority_finalized = true;
                entry.handoff_recorded = true;
            } else {
                unresolved_keys.push(key.clone());
            }
            outbox.entries.insert(key, entry);
        }
        outbox.next_order = MAX_OUTBOX_ENTRIES as u64 + 1;
        outbox
            .prepare(&request, event, &session, 3, false)
            .expect("terminal compaction");
        assert_eq!(outbox.entries.len(), MAX_OUTBOX_ENTRIES);
        let oldest = hex::encode(Sha256::digest(0_usize.to_be_bytes()));
        assert!(!outbox.entries.contains_key(&oldest));
        assert!(unresolved_keys
            .iter()
            .all(|key| outbox.entries.contains_key(key)));

        for entry in outbox.entries.values_mut() {
            entry.state = ManagedOutboxState::Prepared;
            entry.publication_receipt_id = None;
            entry.authority_finalized = false;
        }
        let mut different = request.clone();
        different.dispatch_receipt_id = OpaqueId::parse("different-dispatch").expect("dispatch");
        different.idempotency_key = derive_message_publish_idempotency_key(
            &different.dispatch_receipt_id,
            &different.resident_pubkey,
        )
        .expect("idempotency");
        let different_event = frozen_event(&keys, &different);
        assert!(matches!(
            outbox.prepare(&different, different_event, &session, 3, false),
            Err(ManagedMessageOutboxError::Persistence)
        ));
        assert_eq!(outbox.entries.len(), MAX_OUTBOX_ENTRIES);
    }

    #[test]
    fn luca_signing_outbox_capacity_retains_unfinalized_cancelled_and_rejected_rows() {
        let keys = Keys::parse(&"0b".repeat(32)).expect("valid fixture key");
        let request = request(&keys);
        let event = frozen_event(&keys, &request);
        let session =
            OpaqueId::parse("installation-terminal-capacity").expect("valid installation ID");
        let mut outbox = ManagedMessageOutbox::new(session.clone());
        outbox
            .prepare(&request, event.clone(), &session, 3, false)
            .expect("seed");
        let template = outbox
            .entries
            .remove(request.idempotency_key.as_str())
            .expect("template");

        for index in 0..MAX_OUTBOX_ENTRIES {
            let key = hex::encode(Sha256::digest(index.to_be_bytes()));
            let mut entry = template.clone();
            entry.created_order = index as u64 + 1;
            entry.state = if index == 0 {
                ManagedOutboxState::Cancelled
            } else if index == 1 {
                ManagedOutboxState::Rejected
            } else {
                ManagedOutboxState::Prepared
            };
            entry.authority_finalized = false;
            outbox.entries.insert(key, entry);
        }
        outbox.next_order = MAX_OUTBOX_ENTRIES as u64 + 1;

        assert!(matches!(
            outbox.prepare(&request, event.clone(), &session, 3, false),
            Err(ManagedMessageOutboxError::Persistence)
        ));
        let cancelled_key = hex::encode(Sha256::digest(0_usize.to_be_bytes()));
        let rejected_key = hex::encode(Sha256::digest(1_usize.to_be_bytes()));
        assert!(outbox.entries.contains_key(&cancelled_key));
        assert!(outbox.entries.contains_key(&rejected_key));

        outbox
            .entries
            .get_mut(&cancelled_key)
            .expect("cancelled")
            .authority_finalized = true;
        outbox
            .prepare(&request, event, &session, 3, false)
            .expect("finalized terminal can compact");
        assert!(!outbox.entries.contains_key(&cancelled_key));
        assert!(outbox.entries.contains_key(&rejected_key));
    }

    #[test]
    fn luca_signing_outbox_rejects_noncanonical_encrypted_envelope() {
        let keys = Keys::parse(&"09".repeat(32)).expect("valid fixture key");
        let request = request(&keys);
        let event = frozen_event(&keys, &request);
        let session = OpaqueId::parse("installation-canonical").expect("valid installation ID");
        let passphrase = SecretString::from("canonical-passphrase".to_owned());
        let temp = tempfile::tempdir().expect("temp");
        let path = temp.path().join("managed-outbox.age");
        let mut outbox = ManagedMessageOutbox::new(session.clone());
        outbox
            .prepare(&request, event, &session, 3, false)
            .expect("prepare");
        let noncanonical = serde_json::to_vec_pretty(&PersistedManagedOutbox {
            schema: OUTBOX_SCHEMA.to_owned(),
            installation_session_id: session.clone(),
            next_order: outbox.next_order,
            reconcile_cursor: outbox.reconcile_cursor,
            entries: outbox.entries.clone(),
        })
        .expect("pretty JSON");
        let encryptor = age::Encryptor::with_user_passphrase(passphrase.clone());
        let mut ciphertext = Vec::new();
        {
            let mut writer = encryptor.wrap_output(&mut ciphertext).expect("encrypt");
            writer.write_all(&noncanonical).expect("write");
            writer.finish().expect("finish");
        }
        std::fs::write(&path, ciphertext).expect("write ciphertext");
        assert!(matches!(
            ManagedMessageOutbox::load_encrypted(session, path, passphrase),
            Err(ManagedMessageOutboxError::Persistence)
        ));
    }

    #[test]
    fn luca_signing_outbox_reconciliation_cursor_rotates_after_failed_early_row() {
        let keys = Keys::parse(&"0a".repeat(32)).expect("valid fixture key");
        let session = OpaqueId::parse("installation-cursor").expect("valid installation ID");
        let mut outbox = ManagedMessageOutbox::new(session.clone());
        for index in 0..4 {
            let mut request = request(&keys);
            request.dispatch_receipt_id =
                OpaqueId::parse(format!("dispatch-{index}")).expect("dispatch");
            request.idempotency_key = derive_message_publish_idempotency_key(
                &request.dispatch_receipt_id,
                &request.resident_pubkey,
            )
            .expect("idempotency");
            let event = frozen_event(&keys, &request);
            outbox
                .prepare(&request, event, &session, 3, false)
                .expect("prepare");
        }
        let initial: Vec<_> = outbox
            .reconciliation_entries()
            .iter()
            .map(|entry| entry.created_order)
            .collect();
        assert_eq!(initial, vec![1, 2, 3, 4]);
        // The publisher advances this cursor even when an early relay attempt
        // fails, so the next bounded pass starts after that unavailable row.
        outbox.advance_reconcile_cursor(2).expect("advance");
        let rotated: Vec<_> = outbox
            .reconciliation_entries()
            .iter()
            .map(|entry| entry.created_order)
            .collect();
        assert_eq!(rotated, vec![3, 4, 1, 2]);
    }
}
