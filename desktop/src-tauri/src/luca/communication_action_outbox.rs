//! Encrypted desktop outbox for resident-authored communication actions.
//!
//! This module persists the semantic request and exact-event binding needed to
//! reconcile one action after a desktop restart. The signed event bytes remain
//! in a separate trusted vault behind `sealed_event_handle`; this store never
//! persists raw event JSON, local paths, credentials, or free-form diagnostics.

use std::{
    collections::{BTreeMap, BTreeSet},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use age::secrecy::SecretString;
use atomic_write_file::AtomicWriteFile;
use luca_protocol::{
    canonical_sha256, canonicalize, CanonicalTimestamp, CommunicationActionOutboxStateV1,
    CommunicationActionOutboxV1, CommunicationActionRequestV1, Hex64, OpaqueId, SafeU53, Sha256Ref,
    COMMUNICATION_ACTION_OUTBOX_PROTOCOL,
};
use serde::{Deserialize, Serialize};

const STORE_SCHEMA: &str = "luca.communication-action-outbox.store.v1";
const MAX_OUTBOX_ENTRIES: usize = 256;
const MAX_CIPHERTEXT_BYTES: usize = 8 * 1024 * 1024;
const MAX_PLAINTEXT_BYTES: usize = 4 * 1024 * 1024;

/// Body-free lifecycle or persistence failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommunicationActionOutboxError {
    /// The strict semantic request or exact-event binding was invalid.
    InvalidRequest,
    /// A different action reused an existing idempotency key.
    IdempotencyCollision,
    /// The caller does not belong to the active desktop session.
    InactiveSession,
    /// Cancellation won before publication could begin.
    Cancelled,
    /// The request expired before submission.
    Expired,
    /// The requested state transition is not legal.
    InvalidTransition,
    /// The requested row does not exist.
    NotFound,
    /// Canonical hashing failed.
    Canonicalization,
    /// Encrypted durable state could not be loaded or committed.
    Persistence,
}

impl CommunicationActionOutboxError {
    /// Stable body-free diagnostic code suitable for Activity and logs.
    pub(crate) const fn diagnostic_code(self) -> &'static str {
        match self {
            Self::InvalidRequest => "communication-outbox-invalid-request",
            Self::IdempotencyCollision => "communication-outbox-idempotency-collision",
            Self::InactiveSession => "communication-outbox-inactive-session",
            Self::Cancelled => "communication-outbox-cancelled",
            Self::Expired => "communication-outbox-expired",
            Self::InvalidTransition => "communication-outbox-invalid-transition",
            Self::NotFound => "communication-outbox-not-found",
            Self::Canonicalization => "communication-outbox-canonicalization",
            Self::Persistence => "communication-outbox-persistence",
        }
    }
}

impl std::fmt::Display for CommunicationActionOutboxError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.diagnostic_code())
    }
}

impl std::error::Error for CommunicationActionOutboxError {}

/// Body-free exact authority receipt for one durable outbox row.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct CommunicationActionOutboxReceipt {
    pub outbox_id: OpaqueId,
    pub action_id: OpaqueId,
    pub idempotency_key: Hex64,
    pub action_fingerprint: Sha256Ref,
    pub actor_pubkey: Hex64,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub session_epoch: SafeU53,
    pub runtime_binding_ref: Sha256Ref,
    pub source_conversation_id: OpaqueId,
    pub destination_ref: Sha256Ref,
    pub turn_id: OpaqueId,
    pub dispatch_receipt_id: OpaqueId,
    pub causal_root_id: OpaqueId,
    pub causal_parent_action_id: Option<OpaqueId>,
    pub causal_depth: SafeU53,
    pub cancellation_epoch: SafeU53,
    pub sealed_event_handle: OpaqueId,
    pub exact_event_sha256: Hex64,
    pub state: CommunicationActionOutboxStateV1,
}

impl std::fmt::Debug for CommunicationActionOutboxReceipt {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CommunicationActionOutboxReceipt")
            .field("outbox_id", &self.outbox_id)
            .field("action_id", &self.action_id)
            .field("idempotency_key", &self.idempotency_key)
            .field("action_fingerprint", &self.action_fingerprint)
            .field("actor_pubkey", &self.actor_pubkey)
            .field("owner_pubkey", &self.owner_pubkey)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("session_epoch", &self.session_epoch)
            .field("runtime_binding_ref", &self.runtime_binding_ref)
            .field("source_conversation_id", &self.source_conversation_id)
            .field("destination_ref", &self.destination_ref)
            .field("turn_id", &self.turn_id)
            .field("dispatch_receipt_id", &self.dispatch_receipt_id)
            .field("causal_root_id", &self.causal_root_id)
            .field("causal_parent_action_id", &self.causal_parent_action_id)
            .field("causal_depth", &self.causal_depth)
            .field("cancellation_epoch", &self.cancellation_epoch)
            .field("sealed_event_handle", &self.sealed_event_handle)
            .field("exact_event_sha256", &self.exact_event_sha256)
            .field("state", &self.state)
            .finish()
    }
}

/// Exact encrypted row eligible for bounded startup reconciliation.
#[derive(Clone)]
pub(crate) struct CommunicationActionReconcileEntry {
    row: CommunicationActionOutboxV1,
    pub created_order: u64,
}

impl CommunicationActionReconcileEntry {
    /// Full semantic authority row for the trusted publication broker.
    pub(crate) fn row(&self) -> &CommunicationActionOutboxV1 {
        &self.row
    }
}

impl std::fmt::Debug for CommunicationActionReconcileEntry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CommunicationActionReconcileEntry")
            .field("outbox_id", &self.row.outbox_id)
            .field("idempotency_key", &self.row.request.idempotency_key)
            .field("action_fingerprint", &self.row.action_fingerprint)
            .field("exact_event_sha256", &self.row.exact_event_sha256)
            .field("state", &self.row.state)
            .field("created_order", &self.created_order)
            .finish()
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredCommunicationAction {
    created_order: u64,
    request_sha256: Hex64,
    row: CommunicationActionOutboxV1,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedCommunicationActionOutbox {
    schema: String,
    installation_session_id: OpaqueId,
    next_order: u64,
    reconcile_cursor: u64,
    entries: BTreeMap<String, StoredCommunicationAction>,
}

/// Desktop-local encrypted state machine for semantic communication actions.
pub(crate) struct CommunicationActionOutbox {
    installation_session_id: OpaqueId,
    entries: BTreeMap<String, StoredCommunicationAction>,
    next_order: u64,
    reconcile_cursor: u64,
    persistence_path: Option<PathBuf>,
    passphrase: Option<SecretString>,
}

impl CommunicationActionOutbox {
    /// Create an in-memory outbox for focused tests or ephemeral desktop use.
    #[cfg(test)]
    pub(crate) fn new(installation_session_id: OpaqueId) -> Self {
        Self {
            installation_session_id,
            entries: BTreeMap::new(),
            next_order: 1,
            reconcile_cursor: 0,
            persistence_path: None,
            passphrase: None,
        }
    }

    /// Load or create an atomically persisted age-encrypted outbox.
    pub(crate) fn load_encrypted(
        installation_session_id: OpaqueId,
        path: PathBuf,
        passphrase: SecretString,
    ) -> Result<Self, CommunicationActionOutboxError> {
        if !path.exists() {
            return Ok(Self {
                installation_session_id,
                entries: BTreeMap::new(),
                next_order: 1,
                reconcile_cursor: 0,
                persistence_path: Some(path),
                passphrase: Some(passphrase),
            });
        }

        let ciphertext =
            std::fs::read(&path).map_err(|_| CommunicationActionOutboxError::Persistence)?;
        if ciphertext.len() > MAX_CIPHERTEXT_BYTES {
            return Err(CommunicationActionOutboxError::Persistence);
        }
        let decryptor = age::Decryptor::new_buffered(ciphertext.as_slice())
            .map_err(|_| CommunicationActionOutboxError::Persistence)?;
        let identity = age::scrypt::Identity::new(passphrase.clone());
        let mut reader = decryptor
            .decrypt(std::iter::once(&identity as &dyn age::Identity))
            .map_err(|_| CommunicationActionOutboxError::Persistence)?;
        let mut plaintext = Vec::new();
        reader
            .by_ref()
            .take((MAX_PLAINTEXT_BYTES + 1) as u64)
            .read_to_end(&mut plaintext)
            .map_err(|_| CommunicationActionOutboxError::Persistence)?;
        if plaintext.len() > MAX_PLAINTEXT_BYTES {
            return Err(CommunicationActionOutboxError::Persistence);
        }

        let persisted_json: serde_json::Value = serde_json::from_slice(&plaintext)
            .map_err(|_| CommunicationActionOutboxError::Persistence)?;
        if canonicalize(&persisted_json)
            .map(|canonical| canonical != plaintext)
            .unwrap_or(true)
        {
            return Err(CommunicationActionOutboxError::Persistence);
        }
        let persisted: PersistedCommunicationActionOutbox = serde_json::from_value(persisted_json)
            .map_err(|_| CommunicationActionOutboxError::Persistence)?;
        validate_persisted(&persisted, &installation_session_id)?;

        Ok(Self {
            installation_session_id,
            entries: persisted.entries,
            next_order: persisted.next_order,
            reconcile_cursor: persisted.reconcile_cursor,
            persistence_path: Some(path),
            passphrase: Some(passphrase),
        })
    }

    /// Inspect a durable duplicate without consulting mutable turn authority.
    pub(crate) fn preflight_existing(
        &self,
        request: &CommunicationActionRequestV1,
        sealed_event_handle: &OpaqueId,
        exact_event_sha256: &Hex64,
    ) -> Result<Option<CommunicationActionOutboxReceipt>, CommunicationActionOutboxError> {
        request
            .validate()
            .map_err(|_| CommunicationActionOutboxError::InvalidRequest)?;
        let Some(entry) = self.entries.get(request.idempotency_key.as_str()) else {
            return Ok(None);
        };
        validate_duplicate(entry, request, sealed_event_handle, exact_event_sha256)?;
        Ok(Some(receipt_for(&entry.row)?))
    }

    /// Persist one exact semantic action before any network I/O.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        request: &CommunicationActionRequestV1,
        sealed_event_handle: OpaqueId,
        exact_event_sha256: Hex64,
        observed_installation_session_id: &OpaqueId,
        active_cancellation_epoch: u64,
        turn_is_cancelled: bool,
        prepared_at: CanonicalTimestamp,
    ) -> Result<CommunicationActionOutboxReceipt, CommunicationActionOutboxError> {
        request
            .validate_at(&prepared_at)
            .map_err(|error| match error {
                luca_protocol::CommunicationContractError::Expired => {
                    CommunicationActionOutboxError::Expired
                }
                _ => CommunicationActionOutboxError::InvalidRequest,
            })?;
        self.validate_active_authority(
            request,
            observed_installation_session_id,
            active_cancellation_epoch,
            turn_is_cancelled,
        )?;

        let key = request.idempotency_key.as_str().to_owned();
        if let Some(existing) = self.entries.get(&key) {
            validate_duplicate(existing, request, &sealed_event_handle, &exact_event_sha256)?;
            return receipt_for(&existing.row);
        }
        if self.entries.len() >= MAX_OUTBOX_ENTRIES {
            return Err(CommunicationActionOutboxError::Persistence);
        }

        let request_sha256 = request_sha256(request)?;
        let outbox_id = derive_outbox_id(request)?;
        let row = CommunicationActionOutboxV1 {
            protocol: COMMUNICATION_ACTION_OUTBOX_PROTOCOL.to_owned(),
            outbox_id,
            request: request.clone(),
            action_fingerprint: request.action_fingerprint.clone(),
            sealed_event_handle,
            exact_event_sha256,
            state: CommunicationActionOutboxStateV1::Prepared,
            prepared_at,
            submitted_at: None,
            terminal_at: None,
            accepted_event_id: None,
            publication_receipt_id: None,
            diagnostic_code: None,
        };
        row.validate()
            .map_err(|_| CommunicationActionOutboxError::InvalidRequest)?;

        let next_order = self
            .next_order
            .checked_add(1)
            .ok_or(CommunicationActionOutboxError::Persistence)?;
        let previous_entries = self.entries.clone();
        let previous_next_order = self.next_order;
        let receipt = receipt_for(&row)?;
        self.entries.insert(
            key,
            StoredCommunicationAction {
                created_order: self.next_order,
                request_sha256,
                row,
            },
        );
        self.next_order = next_order;
        if let Err(error) = self.persist() {
            self.entries = previous_entries;
            self.next_order = previous_next_order;
            return Err(error);
        }
        Ok(receipt)
    }

    /// Return the exact semantic row and opaque event handle for publication.
    pub(crate) fn row_for_submission(
        &self,
        idempotency_key: &Hex64,
    ) -> Result<&CommunicationActionOutboxV1, CommunicationActionOutboxError> {
        let entry = self
            .entries
            .get(idempotency_key.as_str())
            .ok_or(CommunicationActionOutboxError::NotFound)?;
        if !matches!(
            entry.row.state,
            CommunicationActionOutboxStateV1::Prepared
                | CommunicationActionOutboxStateV1::Submitted
        ) {
            return Err(CommunicationActionOutboxError::InvalidTransition);
        }
        Ok(&entry.row)
    }

    /// Mark the exact action submitted after rechecking live cancellation.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn mark_submitted(
        &mut self,
        idempotency_key: &Hex64,
        observed_installation_session_id: &OpaqueId,
        active_cancellation_epoch: u64,
        turn_is_cancelled: bool,
        submitted_at: CanonicalTimestamp,
    ) -> Result<CommunicationActionOutboxReceipt, CommunicationActionOutboxError> {
        if observed_installation_session_id != &self.installation_session_id {
            return Err(CommunicationActionOutboxError::InactiveSession);
        }
        let entry = self
            .entries
            .get(idempotency_key.as_str())
            .ok_or(CommunicationActionOutboxError::NotFound)?;
        if turn_is_cancelled
            || active_cancellation_epoch != entry.row.request.cancellation_epoch.get()
        {
            if entry.row.state == CommunicationActionOutboxStateV1::Prepared {
                return self.cancel_before_submission(idempotency_key, submitted_at);
            }
            return Err(CommunicationActionOutboxError::Cancelled);
        }
        entry
            .row
            .request
            .validate_at(&submitted_at)
            .map_err(|error| match error {
                luca_protocol::CommunicationContractError::Expired => {
                    CommunicationActionOutboxError::Expired
                }
                _ => CommunicationActionOutboxError::InvalidRequest,
            })?;
        if entry.row.state == CommunicationActionOutboxStateV1::Submitted {
            return receipt_for(&entry.row);
        }
        if entry.row.state != CommunicationActionOutboxStateV1::Prepared {
            return Err(CommunicationActionOutboxError::InvalidTransition);
        }

        self.transition(idempotency_key, move |row| {
            row.state = CommunicationActionOutboxStateV1::Submitted;
            row.submitted_at = Some(submitted_at);
            Ok(())
        })
    }

    /// Record honest relay acceptance of the exact submitted event.
    pub(crate) fn mark_accepted(
        &mut self,
        idempotency_key: &Hex64,
        accepted_event_id: Hex64,
        publication_receipt_id: OpaqueId,
        accepted_at: CanonicalTimestamp,
    ) -> Result<CommunicationActionOutboxReceipt, CommunicationActionOutboxError> {
        let entry = self
            .entries
            .get(idempotency_key.as_str())
            .ok_or(CommunicationActionOutboxError::NotFound)?;
        if entry.row.state == CommunicationActionOutboxStateV1::Accepted {
            if entry.row.accepted_event_id.as_ref() != Some(&accepted_event_id)
                || entry.row.publication_receipt_id.as_ref() != Some(&publication_receipt_id)
            {
                return Err(CommunicationActionOutboxError::IdempotencyCollision);
            }
            return receipt_for(&entry.row);
        }
        if entry.row.state != CommunicationActionOutboxStateV1::Submitted {
            return Err(CommunicationActionOutboxError::InvalidTransition);
        }

        self.transition(idempotency_key, move |row| {
            row.state = CommunicationActionOutboxStateV1::Accepted;
            row.terminal_at = Some(accepted_at);
            row.accepted_event_id = Some(accepted_event_id);
            row.publication_receipt_id = Some(publication_receipt_id);
            Ok(())
        })
    }

    /// Cancel an action only while its exact event remains unsent.
    pub(crate) fn cancel_before_submission(
        &mut self,
        idempotency_key: &Hex64,
        cancelled_at: CanonicalTimestamp,
    ) -> Result<CommunicationActionOutboxReceipt, CommunicationActionOutboxError> {
        self.terminalize(
            idempotency_key,
            CommunicationActionOutboxStateV1::Cancelled,
            cancelled_at,
            "cancelled-before-submission",
            false,
        )
    }

    /// Cancel during restart reconciliation only after proving relay absence.
    pub(crate) fn cancel_during_reconciliation(
        &mut self,
        idempotency_key: &Hex64,
        cancelled_at: CanonicalTimestamp,
    ) -> Result<CommunicationActionOutboxReceipt, CommunicationActionOutboxError> {
        self.terminalize(
            idempotency_key,
            CommunicationActionOutboxStateV1::Cancelled,
            cancelled_at,
            "cancelled-after-relay-absence",
            true,
        )
    }

    /// Record explicit relay rejection during bounded reconciliation.
    pub(crate) fn reject_during_reconciliation(
        &mut self,
        idempotency_key: &Hex64,
        rejected_at: CanonicalTimestamp,
    ) -> Result<CommunicationActionOutboxReceipt, CommunicationActionOutboxError> {
        self.terminalize(
            idempotency_key,
            CommunicationActionOutboxStateV1::Rejected,
            rejected_at,
            "relay-rejected-exact-action",
            true,
        )
    }

    /// Record a pre-submission deterministic failure with no publication risk.
    pub(crate) fn fail_before_submission(
        &mut self,
        idempotency_key: &Hex64,
        failed_at: CanonicalTimestamp,
    ) -> Result<CommunicationActionOutboxReceipt, CommunicationActionOutboxError> {
        self.terminalize(
            idempotency_key,
            CommunicationActionOutboxStateV1::Failed,
            failed_at,
            "action-failed-before-submission",
            false,
        )
    }

    /// Prepared and submitted rows requiring bounded restart reconciliation.
    pub(crate) fn reconciliation_entries(&self) -> Vec<CommunicationActionReconcileEntry> {
        let mut entries: Vec<_> = self
            .entries
            .values()
            .filter(|entry| {
                matches!(
                    entry.row.state,
                    CommunicationActionOutboxStateV1::Prepared
                        | CommunicationActionOutboxStateV1::Submitted
                )
            })
            .map(|entry| CommunicationActionReconcileEntry {
                row: entry.row.clone(),
                created_order: entry.created_order,
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

    /// Persist fair startup-reconciliation rotation.
    pub(crate) fn advance_reconcile_cursor(
        &mut self,
        created_order: u64,
    ) -> Result<(), CommunicationActionOutboxError> {
        if created_order == 0 || created_order >= self.next_order {
            return Err(CommunicationActionOutboxError::InvalidTransition);
        }
        let previous = self.reconcile_cursor;
        self.reconcile_cursor = created_order;
        if let Err(error) = self.persist() {
            self.reconcile_cursor = previous;
            return Err(error);
        }
        Ok(())
    }

    fn validate_active_authority(
        &self,
        request: &CommunicationActionRequestV1,
        observed_installation_session_id: &OpaqueId,
        active_cancellation_epoch: u64,
        turn_is_cancelled: bool,
    ) -> Result<(), CommunicationActionOutboxError> {
        if observed_installation_session_id != &self.installation_session_id {
            return Err(CommunicationActionOutboxError::InactiveSession);
        }
        if turn_is_cancelled || active_cancellation_epoch != request.cancellation_epoch.get() {
            return Err(CommunicationActionOutboxError::Cancelled);
        }
        Ok(())
    }

    fn terminalize(
        &mut self,
        idempotency_key: &Hex64,
        state: CommunicationActionOutboxStateV1,
        terminal_at: CanonicalTimestamp,
        diagnostic_code: &str,
        allow_submitted: bool,
    ) -> Result<CommunicationActionOutboxReceipt, CommunicationActionOutboxError> {
        let diagnostic_code = OpaqueId::parse(diagnostic_code.to_owned())
            .map_err(|_| CommunicationActionOutboxError::InvalidRequest)?;
        let entry = self
            .entries
            .get(idempotency_key.as_str())
            .ok_or(CommunicationActionOutboxError::NotFound)?;
        let source_ok = entry.row.state == CommunicationActionOutboxStateV1::Prepared
            || (allow_submitted && entry.row.state == CommunicationActionOutboxStateV1::Submitted);
        if !source_ok {
            return Err(CommunicationActionOutboxError::InvalidTransition);
        }
        self.transition(idempotency_key, move |row| {
            row.state = state;
            row.terminal_at = Some(terminal_at);
            row.diagnostic_code = Some(diagnostic_code);
            Ok(())
        })
    }

    fn transition<F>(
        &mut self,
        idempotency_key: &Hex64,
        mutate: F,
    ) -> Result<CommunicationActionOutboxReceipt, CommunicationActionOutboxError>
    where
        F: FnOnce(&mut CommunicationActionOutboxV1) -> Result<(), CommunicationActionOutboxError>,
    {
        let mut candidate = self
            .entries
            .get(idempotency_key.as_str())
            .ok_or(CommunicationActionOutboxError::NotFound)?
            .row
            .clone();
        mutate(&mut candidate)?;
        candidate
            .validate()
            .map_err(|_| CommunicationActionOutboxError::InvalidTransition)?;
        let receipt = receipt_for(&candidate)?;

        let previous_entries = self.entries.clone();
        self.entries
            .get_mut(idempotency_key.as_str())
            .ok_or(CommunicationActionOutboxError::NotFound)?
            .row = candidate;
        if let Err(error) = self.persist() {
            self.entries = previous_entries;
            return Err(error);
        }
        Ok(receipt)
    }

    fn persist(&self) -> Result<(), CommunicationActionOutboxError> {
        let (Some(path), Some(passphrase)) = (&self.persistence_path, &self.passphrase) else {
            return Ok(());
        };
        if self.entries.len() > MAX_OUTBOX_ENTRIES {
            return Err(CommunicationActionOutboxError::Persistence);
        }
        let plaintext = canonicalize(&PersistedCommunicationActionOutbox {
            schema: STORE_SCHEMA.to_owned(),
            installation_session_id: self.installation_session_id.clone(),
            next_order: self.next_order,
            reconcile_cursor: self.reconcile_cursor,
            entries: self.entries.clone(),
        })
        .map_err(|_| CommunicationActionOutboxError::Persistence)?;
        if plaintext.len() > MAX_PLAINTEXT_BYTES {
            return Err(CommunicationActionOutboxError::Persistence);
        }

        let encryptor = age::Encryptor::with_user_passphrase(passphrase.clone());
        let mut ciphertext = Vec::new();
        {
            let mut writer = encryptor
                .wrap_output(&mut ciphertext)
                .map_err(|_| CommunicationActionOutboxError::Persistence)?;
            writer
                .write_all(&plaintext)
                .map_err(|_| CommunicationActionOutboxError::Persistence)?;
            writer
                .finish()
                .map_err(|_| CommunicationActionOutboxError::Persistence)?;
        }
        atomic_write_ciphertext(path, &ciphertext)
    }
}

fn validate_persisted(
    persisted: &PersistedCommunicationActionOutbox,
    installation_session_id: &OpaqueId,
) -> Result<(), CommunicationActionOutboxError> {
    if persisted.schema != STORE_SCHEMA
        || &persisted.installation_session_id != installation_session_id
        || persisted.next_order == 0
        || persisted.reconcile_cursor >= persisted.next_order
        || persisted.entries.len() > MAX_OUTBOX_ENTRIES
    {
        return Err(CommunicationActionOutboxError::Persistence);
    }

    let mut orders = BTreeSet::new();
    for (key, entry) in &persisted.entries {
        if key != entry.row.request.idempotency_key.as_str()
            || entry.created_order == 0
            || entry.created_order >= persisted.next_order
            || !orders.insert(entry.created_order)
            || entry.row.validate().is_err()
            || entry.row.outbox_id != derive_outbox_id(&entry.row.request)?
            || entry.request_sha256 != request_sha256(&entry.row.request)?
        {
            return Err(CommunicationActionOutboxError::Persistence);
        }
    }
    Ok(())
}

fn validate_duplicate(
    entry: &StoredCommunicationAction,
    request: &CommunicationActionRequestV1,
    sealed_event_handle: &OpaqueId,
    exact_event_sha256: &Hex64,
) -> Result<(), CommunicationActionOutboxError> {
    let request_sha256 = request_sha256(request)?;
    if entry.request_sha256 != request_sha256
        || entry.row.request != *request
        || &entry.row.sealed_event_handle != sealed_event_handle
        || &entry.row.exact_event_sha256 != exact_event_sha256
        || entry.row.action_fingerprint != request.action_fingerprint
        || entry.row.outbox_id != derive_outbox_id(request)?
    {
        return Err(CommunicationActionOutboxError::IdempotencyCollision);
    }
    Ok(())
}

fn request_sha256(
    request: &CommunicationActionRequestV1,
) -> Result<Hex64, CommunicationActionOutboxError> {
    let digest =
        canonical_sha256(request).map_err(|_| CommunicationActionOutboxError::Canonicalization)?;
    Hex64::parse(digest).map_err(|_| CommunicationActionOutboxError::Canonicalization)
}

fn derive_outbox_id(
    request: &CommunicationActionRequestV1,
) -> Result<OpaqueId, CommunicationActionOutboxError> {
    OpaqueId::parse(format!(
        "communication-outbox:{}",
        request.idempotency_key.as_str()
    ))
    .map_err(|_| CommunicationActionOutboxError::InvalidRequest)
}

fn receipt_for(
    row: &CommunicationActionOutboxV1,
) -> Result<CommunicationActionOutboxReceipt, CommunicationActionOutboxError> {
    Ok(CommunicationActionOutboxReceipt {
        outbox_id: row.outbox_id.clone(),
        action_id: row.request.action_id.clone(),
        idempotency_key: row.request.idempotency_key.clone(),
        action_fingerprint: row.action_fingerprint.clone(),
        actor_pubkey: row.request.actor_pubkey.clone(),
        owner_pubkey: row.request.owner_pubkey.clone(),
        resident_pubkey: row.request.resident_pubkey.clone(),
        session_epoch: row.request.session_epoch,
        runtime_binding_ref: row.request.runtime_binding_ref.clone(),
        source_conversation_id: row.request.source_conversation_id.clone(),
        destination_ref: row
            .request
            .destination_ref()
            .map_err(|_| CommunicationActionOutboxError::InvalidRequest)?,
        turn_id: row.request.turn_id.clone(),
        dispatch_receipt_id: row.request.dispatch_receipt_id.clone(),
        causal_root_id: row.request.causal_root_id.clone(),
        causal_parent_action_id: row.request.causal_parent_action_id.clone(),
        causal_depth: row.request.causal_depth,
        cancellation_epoch: row.request.cancellation_epoch,
        sealed_event_handle: row.sealed_event_handle.clone(),
        exact_event_sha256: row.exact_event_sha256.clone(),
        state: row.state,
    })
}

fn atomic_write_ciphertext(
    path: &Path,
    ciphertext: &[u8],
) -> Result<(), CommunicationActionOutboxError> {
    let parent = path
        .parent()
        .ok_or(CommunicationActionOutboxError::Persistence)?;
    std::fs::create_dir_all(parent).map_err(|_| CommunicationActionOutboxError::Persistence)?;
    let mut file =
        AtomicWriteFile::open(path).map_err(|_| CommunicationActionOutboxError::Persistence)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| CommunicationActionOutboxError::Persistence)?;
    }
    file.write_all(ciphertext)
        .map_err(|_| CommunicationActionOutboxError::Persistence)?;
    file.commit()
        .map_err(|_| CommunicationActionOutboxError::Persistence)
}

#[cfg(test)]
#[path = "communication_action_outbox_tests.rs"]
mod communication_action_outbox_tests;
