//! Durable, one-result publication authority for an owner-approved runtime task.
//!
//! This is deliberately not a scheduler and not a second dispatch grant.  One
//! explicit Run confirmation creates one body-free authority row.  The row may
//! later admit exactly one tool-free synthesis and one resident-signed Timeline
//! message back to the conversation in which the task was approved.

use crate::data_dir::BuzzPathExt;
use std::{
    collections::{BTreeSet, HashMap},
    io::Read,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use luca_protocol::{
    canonical_sha256, CanonicalTimestamp, Hex64, ManagedMessagePublishRequestV1,
    ManagedResponseSurfaceV1, OpaqueId, Sha256Ref,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use super::managed_dispatch_store::atomic_write_restricted;

const STORE_SCHEMA: &str = "luca.runtime-task-delivery-store.v1";
const DELIVERY_DOMAIN: &str = "luca.runtime-task-delivery.v1";
const RELAY_DOMAIN: &str = "luca.runtime-task-delivery.relay.v1";
const MAX_DELIVERIES: usize = 512;
const MAX_STORE_BYTES: u64 = 2 * 1024 * 1024;

static GLOBAL_STORE: OnceLock<Arc<Mutex<RuntimeTaskDeliveryStore>>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RuntimeTaskDeliveryOperationV1 {
    NewTask,
    ContinueSession,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RuntimeTaskDeliveryStateV1 {
    AwaitingResult,
    PendingSynthesis,
    Synthesizing,
    Prepared,
    Submitted,
    Published,
    Retryable,
    Rejected,
    Cancelled,
    Blocked,
}

impl RuntimeTaskDeliveryStateV1 {
    fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Published | Self::Rejected | Self::Cancelled | Self::Blocked
        )
    }
}

/// Immutable facts frozen before the provider is spawned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuntimeTaskDeliveryApprovalV1 {
    pub task_id: OpaqueId,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub conversation_id: OpaqueId,
    pub origin_relay_ref: Sha256Ref,
    pub origin_community_id: OpaqueId,
    pub input_sha256: Sha256Ref,
    pub binding_ref: Sha256Ref,
    pub runtime_family: String,
    pub operation: RuntimeTaskDeliveryOperationV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_ref: Option<OpaqueId>,
    pub permission_mode: String,
    pub approved_at: CanonicalTimestamp,
}

/// Body-free coordinator view. Result and prompt bodies are never persisted here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RuntimeTaskDeliveryReceiptV1 {
    pub delivery_id: Option<OpaqueId>,
    pub task_id: OpaqueId,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub conversation_id: OpaqueId,
    pub origin_relay_ref: Sha256Ref,
    pub origin_community_id: OpaqueId,
    pub input_sha256: Sha256Ref,
    pub result_sha256: Option<Sha256Ref>,
    pub binding_ref: Sha256Ref,
    pub state: RuntimeTaskDeliveryStateV1,
    pub synthesis_attempts: u8,
    pub synthesis_lease_deadline_unix_ms: Option<u64>,
    pub updated_at: CanonicalTimestamp,
}

/// Exact current authority facts checked before synthesis or publication.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RuntimeTaskDeliveryScopeV1 {
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub conversation_id: OpaqueId,
    pub origin_relay_ref: Sha256Ref,
    pub origin_community_id: OpaqueId,
    pub binding_ref: Sha256Ref,
    pub session_epoch: u64,
}

/// Exact immutable runtime projection that produced a Succeeded result.
///
/// The coordinator constructs this from the durably stored task projection and
/// checks it under the same store lock immediately before binding the result
/// digest. This prevents a result from a colliding or stale runtime projection
/// from consuming an otherwise valid delivery authority.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RuntimeTaskCompletionScopeV1 {
    pub task_id: OpaqueId,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub conversation_id: OpaqueId,
    pub origin_relay_ref: Sha256Ref,
    pub origin_community_id: OpaqueId,
    pub runtime_family: String,
    pub operation: RuntimeTaskDeliveryOperationV1,
    pub target_ref: Option<OpaqueId>,
    pub permission_mode: String,
}

/// Current resident identity used only after the previous broker has been
/// invalidated and its encrypted outbox has been inspected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RuntimeTaskDeliveryBrokerRecoveryScopeV1 {
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub origin_relay_ref: Sha256Ref,
    pub origin_community_id: OpaqueId,
    pub binding_ref: Sha256Ref,
    pub current_session_epoch: u64,
}

/// A body-free lease for one private, tool-free synthesis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RuntimeTaskSynthesisClaimV1 {
    pub delivery_id: OpaqueId,
    pub task_id: OpaqueId,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub conversation_id: OpaqueId,
    pub origin_relay_ref: Sha256Ref,
    pub origin_community_id: OpaqueId,
    pub input_sha256: Sha256Ref,
    pub result_sha256: Sha256Ref,
    pub binding_ref: Sha256Ref,
    pub session_epoch: u64,
    pub synthesis_attempt: u8,
    pub lease_deadline_unix_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RuntimeTaskDeliveryReconciliationV1 {
    Ready,
    Published,
    Cancelled,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RuntimeTaskDeliveryError {
    Unavailable,
    Denied,
    Cancelled,
    Terminal,
    Persistence,
    Invalid,
}

impl std::fmt::Display for RuntimeTaskDeliveryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::Unavailable => "runtime-task delivery authority is unavailable",
            Self::Denied => "runtime-task delivery authority was denied",
            Self::Cancelled => "runtime-task delivery was cancelled",
            Self::Terminal => "runtime-task delivery is terminal",
            Self::Persistence => "runtime-task delivery persistence failed",
            Self::Invalid => "runtime-task delivery input was invalid",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for RuntimeTaskDeliveryError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimeTaskDeliveryRowV1 {
    approval: RuntimeTaskDeliveryApprovalV1,
    approval_sha256: Sha256Ref,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    delivery_id: Option<OpaqueId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    result_sha256: Option<Sha256Ref>,
    state: RuntimeTaskDeliveryStateV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    synthesis_session_epoch: Option<u64>,
    #[serde(default)]
    synthesis_attempts: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    synthesis_lease_deadline_unix_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    request_sha256: Option<Sha256Ref>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    submitted_event_id: Option<Hex64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    published_event_id: Option<Hex64>,
    #[serde(default)]
    outbox_finalized: bool,
    updated_at: CanonicalTimestamp,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedRuntimeTaskDeliveryStoreV1 {
    schema: String,
    deliveries: Vec<RuntimeTaskDeliveryRowV1>,
}

pub(crate) struct RuntimeTaskDeliveryStore {
    path: PathBuf,
    rows: HashMap<String, RuntimeTaskDeliveryRowV1>,
}

/// Bound the opened stream as well as its metadata. Concurrent growth must not
/// allocate an unbounded authority-store body after the metadata size check.
fn read_delivery_store_bounded(reader: impl Read) -> Result<Vec<u8>, RuntimeTaskDeliveryError> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_STORE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| RuntimeTaskDeliveryError::Persistence)?;
    if bytes.len() as u64 > MAX_STORE_BYTES {
        return Err(RuntimeTaskDeliveryError::Invalid);
    }
    Ok(bytes)
}

impl RuntimeTaskDeliveryStore {
    pub(crate) fn load(path: PathBuf) -> Result<Self, RuntimeTaskDeliveryError> {
        if !path.exists() {
            return Ok(Self {
                path,
                rows: HashMap::new(),
            });
        }
        let metadata =
            std::fs::symlink_metadata(&path).map_err(|_| RuntimeTaskDeliveryError::Persistence)?;
        if !metadata.file_type().is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_STORE_BYTES
        {
            return Err(RuntimeTaskDeliveryError::Invalid);
        }
        let file = std::fs::File::open(&path).map_err(|_| RuntimeTaskDeliveryError::Persistence)?;
        let opened_metadata = file
            .metadata()
            .map_err(|_| RuntimeTaskDeliveryError::Persistence)?;
        if !opened_metadata.is_file() || opened_metadata.len() > MAX_STORE_BYTES {
            return Err(RuntimeTaskDeliveryError::Invalid);
        }
        let bytes = read_delivery_store_bounded(file)?;
        let persisted: PersistedRuntimeTaskDeliveryStoreV1 =
            serde_json::from_slice(&bytes).map_err(|_| RuntimeTaskDeliveryError::Invalid)?;
        if persisted.schema != STORE_SCHEMA || persisted.deliveries.len() > MAX_DELIVERIES {
            return Err(RuntimeTaskDeliveryError::Invalid);
        }
        let mut rows = HashMap::new();
        for row in persisted.deliveries {
            validate_row(&row)?;
            let key = row.approval.task_id.as_str().to_owned();
            if rows.insert(key, row).is_some() {
                return Err(RuntimeTaskDeliveryError::Invalid);
            }
        }
        Ok(Self { path, rows })
    }

    pub(crate) fn create_authority(
        &mut self,
        approval: RuntimeTaskDeliveryApprovalV1,
    ) -> Result<RuntimeTaskDeliveryReceiptV1, RuntimeTaskDeliveryError> {
        validate_approval(&approval)?;
        let approval_sha256 = sha256_ref(&approval)?;
        if let Some(existing) = self.rows.get(approval.task_id.as_str()) {
            return if existing.approval_sha256 == approval_sha256 {
                Ok(receipt(existing))
            } else {
                Err(RuntimeTaskDeliveryError::Denied)
            };
        }
        if self.rows.len() >= MAX_DELIVERIES {
            self.prune_terminal();
        }
        if self.rows.len() >= MAX_DELIVERIES {
            return Err(RuntimeTaskDeliveryError::Unavailable);
        }
        let row = RuntimeTaskDeliveryRowV1 {
            updated_at: approval.approved_at.clone(),
            approval,
            approval_sha256,
            delivery_id: None,
            result_sha256: None,
            state: RuntimeTaskDeliveryStateV1::AwaitingResult,
            synthesis_session_epoch: None,
            synthesis_attempts: 0,
            synthesis_lease_deadline_unix_ms: None,
            request_sha256: None,
            submitted_event_id: None,
            published_event_id: None,
            outbox_finalized: false,
        };
        let key = row.approval.task_id.as_str().to_owned();
        self.rows.insert(key.clone(), row);
        if let Err(error) = self.persist() {
            self.rows.remove(&key);
            return Err(error);
        }
        self.rows
            .get(&key)
            .map(receipt)
            .ok_or(RuntimeTaskDeliveryError::Persistence)
    }

    /// Prove that every immutable runtime projection coordinate still matches
    /// the owner-approved Run authority.
    ///
    /// Callers must hold this store lock continuously from this check through
    /// `bind_succeeded_result`; the approval row itself is immutable, but that
    /// convention also keeps the completion/bind boundary auditable.
    pub(crate) fn verify_completion_scope(
        &self,
        scope: &RuntimeTaskCompletionScopeV1,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        let row = self
            .rows
            .get(scope.task_id.as_str())
            .ok_or(RuntimeTaskDeliveryError::Denied)?;
        let approval = &row.approval;
        if approval.task_id != scope.task_id
            || approval.owner_pubkey != scope.owner_pubkey
            || approval.resident_pubkey != scope.resident_pubkey
            || approval.conversation_id != scope.conversation_id
            || approval.origin_relay_ref != scope.origin_relay_ref
            || approval.origin_community_id != scope.origin_community_id
            || approval.runtime_family != scope.runtime_family
            || approval.operation != scope.operation
            || approval.target_ref != scope.target_ref
            || approval.permission_mode != scope.permission_mode
        {
            return Err(RuntimeTaskDeliveryError::Denied);
        }
        Ok(())
    }

    /// Bind the digest of a host-verified, durably stored Succeeded result.
    /// Calling this method is the coordinator's proof boundary: it must not be
    /// called for an in-memory or non-Succeeded projection.
    pub(crate) fn bind_succeeded_result(
        &mut self,
        task_id: &OpaqueId,
        result_sha256: Sha256Ref,
        updated_at: CanonicalTimestamp,
    ) -> Result<RuntimeTaskDeliveryReceiptV1, RuntimeTaskDeliveryError> {
        let key = task_id.as_str();
        let existing = self.rows.get(key).ok_or(RuntimeTaskDeliveryError::Denied)?;
        if let Some(bound) = &existing.result_sha256 {
            return if bound == &result_sha256 {
                Ok(receipt(existing))
            } else {
                Err(RuntimeTaskDeliveryError::Denied)
            };
        }
        if existing.state != RuntimeTaskDeliveryStateV1::AwaitingResult {
            return Err(RuntimeTaskDeliveryError::Terminal);
        }
        let delivery_id = derive_delivery_id(&existing.approval_sha256, &result_sha256)?;
        let before = existing.clone();
        let row = self
            .rows
            .get_mut(key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        row.delivery_id = Some(delivery_id);
        row.result_sha256 = Some(result_sha256);
        row.state = RuntimeTaskDeliveryStateV1::PendingSynthesis;
        row.updated_at = updated_at;
        if let Err(error) = self.persist() {
            self.rows.insert(key.to_owned(), before);
            return Err(error);
        }
        self.rows
            .get(key)
            .map(receipt)
            .ok_or(RuntimeTaskDeliveryError::Persistence)
    }

    /// Close a Run authority when the provider never produced a Succeeded
    /// result. This is terminal bookkeeping only; it cannot retry, synthesize,
    /// publish, or grant any additional runtime control.
    pub(crate) fn mark_awaiting_result_abandoned(
        &mut self,
        task_id: &OpaqueId,
        updated_at: CanonicalTimestamp,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        let key = task_id.as_str();
        let current = self.rows.get(key).ok_or(RuntimeTaskDeliveryError::Denied)?;
        if current.state == RuntimeTaskDeliveryStateV1::Cancelled
            && current.result_sha256.is_none()
            && current.delivery_id.is_none()
        {
            return Ok(());
        }
        if current.state != RuntimeTaskDeliveryStateV1::AwaitingResult {
            return Err(RuntimeTaskDeliveryError::Terminal);
        }
        let before = current.clone();
        let row = self
            .rows
            .get_mut(key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        row.state = RuntimeTaskDeliveryStateV1::Cancelled;
        // No outbox can exist before a result is bound, so there is no second
        // finalization phase to recover.
        row.outbox_finalized = true;
        row.updated_at = updated_at;
        if let Err(error) = self.persist() {
            self.rows.insert(key.to_owned(), before);
            return Err(error);
        }
        Ok(())
    }

    /// Close an authority when a durable projection claims success but the
    /// retained result or its frozen coordinates cannot be verified.
    ///
    /// This is distinct from provider failure: `Blocked` makes the integrity
    /// problem visible without making the task claimable or implying that a
    /// result delivery was cancelled.
    pub(crate) fn mark_awaiting_result_unverifiable(
        &mut self,
        task_id: &OpaqueId,
        updated_at: CanonicalTimestamp,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        let key = task_id.as_str();
        let current = self.rows.get(key).ok_or(RuntimeTaskDeliveryError::Denied)?;
        if current.state == RuntimeTaskDeliveryStateV1::Blocked
            && current.result_sha256.is_none()
            && current.delivery_id.is_none()
            && current.outbox_finalized
        {
            return Ok(());
        }
        if current.state != RuntimeTaskDeliveryStateV1::AwaitingResult {
            return Err(RuntimeTaskDeliveryError::Terminal);
        }
        let before = current.clone();
        let row = self
            .rows
            .get_mut(key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        row.state = RuntimeTaskDeliveryStateV1::Blocked;
        // No result was bound, so no synthesis or outbox phase can exist.
        row.outbox_finalized = true;
        row.updated_at = updated_at;
        if let Err(error) = self.persist() {
            self.rows.insert(key.to_owned(), before);
            return Err(error);
        }
        Ok(())
    }

    /// A transient preflight failure before a synthesis lease was acquired.
    /// This changes no authority coordinates and does not increment attempts.
    pub(crate) fn mark_pending_retryable(
        &mut self,
        task_id: &OpaqueId,
        updated_at: CanonicalTimestamp,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        let key = task_id.as_str();
        let current = self.rows.get(key).ok_or(RuntimeTaskDeliveryError::Denied)?;
        if current.state == RuntimeTaskDeliveryStateV1::Retryable {
            return Ok(());
        }
        if current.state != RuntimeTaskDeliveryStateV1::PendingSynthesis {
            return Err(RuntimeTaskDeliveryError::Denied);
        }
        let before = current.clone();
        let row = self
            .rows
            .get_mut(key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        row.state = RuntimeTaskDeliveryStateV1::Retryable;
        row.updated_at = updated_at;
        if let Err(error) = self.persist() {
            self.rows.insert(key.to_owned(), before);
            return Err(error);
        }
        Ok(())
    }

    /// Consume one explicit owner summary-retry click before enqueuing work.
    /// Only Retryable may re-enter PendingSynthesis, so repeated clicks cannot
    /// enqueue duplicate jobs. The provider task is never rerun.
    pub(crate) fn requeue_owner_retry(
        &mut self,
        task_id: &OpaqueId,
        updated_at: CanonicalTimestamp,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        let key = task_id.as_str();
        let current = self.rows.get(key).ok_or(RuntimeTaskDeliveryError::Denied)?;
        if current.state != RuntimeTaskDeliveryStateV1::Retryable {
            return Err(RuntimeTaskDeliveryError::Denied);
        }
        let before = current.clone();
        let row = self
            .rows
            .get_mut(key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        row.state = RuntimeTaskDeliveryStateV1::PendingSynthesis;
        row.updated_at = updated_at;
        if let Err(error) = self.persist() {
            self.rows.insert(key.to_owned(), before);
            return Err(error);
        }
        Ok(())
    }

    /// Permanently close an authority after a policy/identity/scope preflight
    /// mismatch. An active synthesis may only be blocked after its lease has
    /// expired; live work cannot be stolen by a concurrent recovery pass.
    pub(crate) fn mark_preflight_blocked(
        &mut self,
        task_id: &OpaqueId,
        now_unix_ms: u64,
        updated_at: CanonicalTimestamp,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        let key = task_id.as_str();
        let current = self.rows.get(key).ok_or(RuntimeTaskDeliveryError::Denied)?;
        if current.state == RuntimeTaskDeliveryStateV1::Blocked {
            return Ok(());
        }
        let allowed = matches!(
            current.state,
            RuntimeTaskDeliveryStateV1::PendingSynthesis | RuntimeTaskDeliveryStateV1::Retryable
        ) || (current.state == RuntimeTaskDeliveryStateV1::Synthesizing
            && current
                .synthesis_lease_deadline_unix_ms
                .is_some_and(|deadline| deadline <= now_unix_ms));
        if !allowed {
            return Err(RuntimeTaskDeliveryError::Denied);
        }
        let before = current.clone();
        let row = self
            .rows
            .get_mut(key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        row.state = RuntimeTaskDeliveryStateV1::Blocked;
        row.synthesis_session_epoch = None;
        row.synthesis_lease_deadline_unix_ms = None;
        // These preflight states precede event preparation, so there is no
        // encrypted outbox row requiring a second finalization phase.
        row.outbox_finalized = true;
        row.updated_at = updated_at;
        if let Err(error) = self.persist() {
            self.rows.insert(key.to_owned(), before);
            return Err(error);
        }
        Ok(())
    }

    pub(crate) fn claim_synthesis(
        &mut self,
        delivery_id: &OpaqueId,
        scope: &RuntimeTaskDeliveryScopeV1,
        now_unix_ms: u64,
        lease_ms: u64,
        updated_at: CanonicalTimestamp,
    ) -> Result<RuntimeTaskSynthesisClaimV1, RuntimeTaskDeliveryError> {
        if scope.session_epoch == 0 || lease_ms == 0 {
            return Err(RuntimeTaskDeliveryError::Invalid);
        }
        let key = self.key_for_delivery(delivery_id)?;
        let current = self
            .rows
            .get(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        if !scope_matches(current, scope) {
            self.block(&key, updated_at)?;
            return Err(RuntimeTaskDeliveryError::Denied);
        }
        let claimable = matches!(
            current.state,
            RuntimeTaskDeliveryStateV1::PendingSynthesis | RuntimeTaskDeliveryStateV1::Retryable
        ) || (current.state == RuntimeTaskDeliveryStateV1::Synthesizing
            && current
                .synthesis_lease_deadline_unix_ms
                .is_some_and(|deadline| deadline <= now_unix_ms));
        if !claimable {
            return Err(if current.state == RuntimeTaskDeliveryStateV1::Cancelled {
                RuntimeTaskDeliveryError::Cancelled
            } else if current.state.is_terminal()
                || matches!(
                    current.state,
                    RuntimeTaskDeliveryStateV1::Prepared | RuntimeTaskDeliveryStateV1::Submitted
                )
            {
                RuntimeTaskDeliveryError::Terminal
            } else {
                RuntimeTaskDeliveryError::Unavailable
            });
        }
        let before = current.clone();
        let row = self
            .rows
            .get_mut(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        row.synthesis_attempts = row
            .synthesis_attempts
            .checked_add(1)
            .ok_or(RuntimeTaskDeliveryError::Terminal)?;
        row.state = RuntimeTaskDeliveryStateV1::Synthesizing;
        row.synthesis_session_epoch = Some(scope.session_epoch);
        row.synthesis_lease_deadline_unix_ms = Some(now_unix_ms.saturating_add(lease_ms));
        row.updated_at = updated_at;
        if let Err(error) = self.persist() {
            self.rows.insert(key.clone(), before);
            return Err(error);
        }
        claim(
            self.rows
                .get(&key)
                .ok_or(RuntimeTaskDeliveryError::Persistence)?,
        )
    }

    pub(crate) fn release_synthesis_retryable(
        &mut self,
        delivery_id: &OpaqueId,
        session_epoch: u64,
        updated_at: CanonicalTimestamp,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        self.transition_claim(
            delivery_id,
            session_epoch,
            RuntimeTaskDeliveryStateV1::Retryable,
            updated_at,
        )
    }

    /// Admission polling may release only its exact still-unstarted lease,
    /// never a later claim in the same runtime epoch or a prepared outbox.
    pub(crate) fn release_unstarted_synthesis(
        &mut self,
        expected: &RuntimeTaskSynthesisClaimV1,
        updated_at: CanonicalTimestamp,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        if !self.has_synthesis_claim(expected) {
            return Err(RuntimeTaskDeliveryError::Denied);
        }
        self.release_synthesis_retryable(&expected.delivery_id, expected.session_epoch, updated_at)
    }

    /// End a stale synthesis lease after its persisted deadline has passed.
    ///
    /// Recovery deliberately keys this by task rather than by the old runtime
    /// epoch: a process restart may make that epoch impossible to prove. Only
    /// an expired `Synthesizing` row is changed. In particular, a draft that
    /// has already been reserved or submitted can never be made claimable
    /// again by lease recovery.
    pub(crate) fn recover_expired_synthesis(
        &mut self,
        task_id: &OpaqueId,
        now_unix_ms: u64,
        updated_at: CanonicalTimestamp,
    ) -> Result<bool, RuntimeTaskDeliveryError> {
        let key = task_id.as_str();
        let current = self.rows.get(key).ok_or(RuntimeTaskDeliveryError::Denied)?;
        if current.state != RuntimeTaskDeliveryStateV1::Synthesizing
            || current
                .synthesis_lease_deadline_unix_ms
                .is_none_or(|deadline| deadline > now_unix_ms)
        {
            return Ok(false);
        }
        let before = current.clone();
        let row = self
            .rows
            .get_mut(key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        row.state = RuntimeTaskDeliveryStateV1::Retryable;
        row.synthesis_session_epoch = None;
        row.synthesis_lease_deadline_unix_ms = None;
        row.updated_at = updated_at;
        if let Err(error) = self.persist() {
            self.rows.insert(key.to_owned(), before);
            return Err(error);
        }
        Ok(true)
    }

    pub(crate) fn mark_synthesis_blocked(
        &mut self,
        delivery_id: &OpaqueId,
        session_epoch: u64,
        updated_at: CanonicalTimestamp,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        self.transition_claim(
            delivery_id,
            session_epoch,
            RuntimeTaskDeliveryStateV1::Blocked,
            updated_at,
        )
    }

    pub(crate) fn pending_for_recovery(
        &self,
        owner: &Hex64,
        limit: usize,
    ) -> Vec<RuntimeTaskDeliveryReceiptV1> {
        let mut rows = self
            .rows
            .values()
            .filter(|row| {
                row.approval.owner_pubkey == *owner
                    && matches!(
                        row.state,
                        RuntimeTaskDeliveryStateV1::AwaitingResult
                            | RuntimeTaskDeliveryStateV1::PendingSynthesis
                            | RuntimeTaskDeliveryStateV1::Synthesizing
                            | RuntimeTaskDeliveryStateV1::Retryable
                            | RuntimeTaskDeliveryStateV1::Prepared
                            | RuntimeTaskDeliveryStateV1::Submitted
                    )
            })
            .map(receipt)
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| left.updated_at.cmp(&right.updated_at));
        rows.truncate(limit.min(MAX_DELIVERIES));
        rows
    }

    /// Terminalize only the narrow crash window between authority reservation
    /// and encrypted-outbox preparation.
    ///
    /// This method may be called only after the old broker has been invalidated
    /// and the retained encrypted outbox has been fully inspected. A retained
    /// receipt, a current-epoch reservation, or any row that reached an event
    /// ID is left byte-for-byte unchanged. Proven orphans are blocked and can
    /// never be synthesized again.
    pub(crate) fn block_orphaned_prepared_after_broker_invalidation(
        &mut self,
        scope: &RuntimeTaskDeliveryBrokerRecoveryScopeV1,
        retained_dispatch_receipt_ids: &BTreeSet<OpaqueId>,
        updated_at: CanonicalTimestamp,
    ) -> Result<Vec<OpaqueId>, RuntimeTaskDeliveryError> {
        if scope.current_session_epoch == 0 {
            return Err(RuntimeTaskDeliveryError::Invalid);
        }
        let orphaned_keys = self
            .rows
            .iter()
            .filter(|(_, row)| {
                row.state == RuntimeTaskDeliveryStateV1::Prepared
                    && row.submitted_event_id.is_none()
                    && row.approval.owner_pubkey == scope.owner_pubkey
                    && row.approval.resident_pubkey == scope.resident_pubkey
                    && row.approval.origin_relay_ref == scope.origin_relay_ref
                    && row.approval.origin_community_id == scope.origin_community_id
                    && row.approval.binding_ref == scope.binding_ref
                    && row
                        .synthesis_session_epoch
                        .is_some_and(|epoch| epoch > 0 && epoch != scope.current_session_epoch)
                    && row.delivery_id.as_ref().is_some_and(|delivery_id| {
                        !retained_dispatch_receipt_ids.contains(delivery_id)
                    })
            })
            .map(|(key, _)| key.clone())
            .collect::<Vec<_>>();
        if orphaned_keys.is_empty() {
            return Ok(Vec::new());
        }
        let before = orphaned_keys
            .iter()
            .map(|key| {
                self.rows
                    .get(key)
                    .cloned()
                    .map(|row| (key.clone(), row))
                    .ok_or(RuntimeTaskDeliveryError::Unavailable)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut task_ids = Vec::with_capacity(orphaned_keys.len());
        for key in &orphaned_keys {
            let row = self
                .rows
                .get_mut(key)
                .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
            task_ids.push(row.approval.task_id.clone());
            row.state = RuntimeTaskDeliveryStateV1::Blocked;
            row.synthesis_session_epoch = None;
            row.synthesis_lease_deadline_unix_ms = None;
            // The caller proved there is no retained encrypted event to
            // reconcile, so this terminal row has no later outbox phase.
            row.outbox_finalized = true;
            row.updated_at = updated_at.clone();
        }
        if let Err(error) = self.persist() {
            for (key, row) in before {
                self.rows.insert(key, row);
            }
            return Err(error);
        }
        task_ids.sort_by(|left, right| left.as_str().cmp(right.as_str()));
        Ok(task_ids)
    }

    pub(crate) fn receipt_for_task(
        &self,
        task_id: &OpaqueId,
    ) -> Option<RuntimeTaskDeliveryReceiptV1> {
        self.rows.get(task_id.as_str()).map(receipt)
    }

    pub(crate) fn has_synthesis_claim(&self, expected: &RuntimeTaskSynthesisClaimV1) -> bool {
        self.rows.get(expected.task_id.as_str()).is_some_and(|row| {
            row.state == RuntimeTaskDeliveryStateV1::Synthesizing
                && claim(row).is_ok_and(|current| current == *expected)
        })
    }

    pub(crate) fn has_authority(&self, delivery_id: &OpaqueId) -> bool {
        self.key_for_delivery(delivery_id).is_ok()
    }

    pub(crate) fn delivery_state(
        &self,
        delivery_id: &OpaqueId,
    ) -> Option<RuntimeTaskDeliveryStateV1> {
        self.key_for_delivery(delivery_id)
            .ok()
            .and_then(|key| self.rows.get(&key))
            .map(|row| row.state)
    }

    pub(crate) fn task_id_for_delivery(&self, delivery_id: &OpaqueId) -> Option<OpaqueId> {
        self.key_for_delivery(delivery_id)
            .ok()
            .and_then(|key| self.rows.get(&key))
            .map(|row| row.approval.task_id.clone())
    }

    pub(crate) fn authorize_publication(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        scope: &RuntimeTaskDeliveryScopeV1,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        let key = self.key_for_delivery(&request.dispatch_receipt_id)?;
        let row = self
            .rows
            .get(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        if !scope_matches(row, scope) || !request_matches(row, request) {
            return Err(RuntimeTaskDeliveryError::Denied);
        }
        if row.state == RuntimeTaskDeliveryStateV1::Cancelled {
            return Err(RuntimeTaskDeliveryError::Cancelled);
        }
        if row.state == RuntimeTaskDeliveryStateV1::Published {
            return Ok(());
        }
        if row.state == RuntimeTaskDeliveryStateV1::Prepared
            && row.request_sha256.as_ref() == Some(&sha256_ref(request)?)
        {
            return Ok(());
        }
        if row.state != RuntimeTaskDeliveryStateV1::Synthesizing {
            return Err(RuntimeTaskDeliveryError::Denied);
        }
        Ok(())
    }

    /// Reserve this exact synthesis before the signing broker constructs or
    /// freezes an event. A crash after this point can only recover an exact
    /// outbox row; it can never lease a second synthesis for the same result.
    pub(crate) fn reserve_publication(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        scope: &RuntimeTaskDeliveryScopeV1,
        updated_at: CanonicalTimestamp,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        let key = self.key_for_delivery(&request.dispatch_receipt_id)?;
        let request_sha256 = sha256_ref(request)?;
        let current = self
            .rows
            .get(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        if current.state == RuntimeTaskDeliveryStateV1::Prepared
            && current.request_sha256.as_ref() == Some(&request_sha256)
            && current.submitted_event_id.is_none()
            && scope_matches(current, scope)
            && request_matches(current, request)
        {
            return Ok(());
        }
        self.authorize_publication(request, scope)?;
        let before = self
            .rows
            .get(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?
            .clone();
        if before.state != RuntimeTaskDeliveryStateV1::Synthesizing {
            return Err(RuntimeTaskDeliveryError::Terminal);
        }
        let row = self
            .rows
            .get_mut(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        row.state = RuntimeTaskDeliveryStateV1::Prepared;
        row.request_sha256 = Some(request_sha256);
        row.synthesis_lease_deadline_unix_ms = None;
        row.updated_at = updated_at;
        if let Err(error) = self.persist() {
            self.rows.insert(key, before);
            return Err(error);
        }
        Ok(())
    }

    pub(crate) fn begin_submission(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        event_id: &Hex64,
        scope: &RuntimeTaskDeliveryScopeV1,
        updated_at: CanonicalTimestamp,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        let key = self.key_for_delivery(&request.dispatch_receipt_id)?;
        let request_sha256 = sha256_ref(request)?;
        let current = self
            .rows
            .get(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        if current.state != RuntimeTaskDeliveryStateV1::Prepared
            || current.request_sha256.as_ref() != Some(&request_sha256)
            || current
                .submitted_event_id
                .as_ref()
                .is_some_and(|bound| bound != event_id)
        {
            return Err(RuntimeTaskDeliveryError::Terminal);
        }
        if !scope_matches(current, scope) || !request_matches(current, request) {
            return Err(RuntimeTaskDeliveryError::Denied);
        }
        if current.submitted_event_id.as_ref() == Some(event_id) {
            return Ok(());
        }
        let before = self
            .rows
            .get(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?
            .clone();
        let row = self
            .rows
            .get_mut(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        row.submitted_event_id = Some(event_id.clone());
        row.updated_at = updated_at;
        if let Err(error) = self.persist() {
            self.rows.insert(key, before);
            return Err(error);
        }
        Ok(())
    }

    pub(crate) fn authorize_reconciliation(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        event_id: &Hex64,
        was_submitted: bool,
        scope: &RuntimeTaskDeliveryScopeV1,
        updated_at: CanonicalTimestamp,
    ) -> Result<RuntimeTaskDeliveryReconciliationV1, RuntimeTaskDeliveryError> {
        let key = self.key_for_delivery(&request.dispatch_receipt_id)?;
        let current = self
            .rows
            .get(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        if !scope_matches(current, scope)
            || !request_matches(current, request)
            || current.request_sha256.as_ref() != Some(&sha256_ref(request)?)
        {
            return Err(RuntimeTaskDeliveryError::Denied);
        }
        if current
            .submitted_event_id
            .as_ref()
            .is_some_and(|bound| bound != event_id)
        {
            return Err(RuntimeTaskDeliveryError::Denied);
        }
        let decision = match current.state {
            RuntimeTaskDeliveryStateV1::Published => RuntimeTaskDeliveryReconciliationV1::Published,
            RuntimeTaskDeliveryStateV1::Cancelled => RuntimeTaskDeliveryReconciliationV1::Cancelled,
            RuntimeTaskDeliveryStateV1::Rejected => RuntimeTaskDeliveryReconciliationV1::Rejected,
            RuntimeTaskDeliveryStateV1::Prepared | RuntimeTaskDeliveryStateV1::Submitted => {
                RuntimeTaskDeliveryReconciliationV1::Ready
            }
            _ => return Err(RuntimeTaskDeliveryError::Denied),
        };
        if current.state == RuntimeTaskDeliveryStateV1::Prepared
            && (current.submitted_event_id.is_none() || was_submitted)
        {
            let before = current.clone();
            let row = self
                .rows
                .get_mut(&key)
                .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
            row.submitted_event_id = Some(event_id.clone());
            if was_submitted {
                row.state = RuntimeTaskDeliveryStateV1::Submitted;
            }
            row.updated_at = updated_at;
            if let Err(error) = self.persist() {
                self.rows.insert(key, before);
                return Err(error);
            }
        }
        Ok(decision)
    }

    pub(crate) fn mark_published(
        &mut self,
        delivery_id: &OpaqueId,
        event_id: &Hex64,
        updated_at: CanonicalTimestamp,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        let key = self.key_for_delivery(delivery_id)?;
        let current = self
            .rows
            .get(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        if current.state == RuntimeTaskDeliveryStateV1::Published {
            return if current.published_event_id.as_ref() == Some(event_id) {
                Ok(())
            } else {
                Err(RuntimeTaskDeliveryError::Denied)
            };
        }
        if !matches!(
            current.state,
            RuntimeTaskDeliveryStateV1::Prepared | RuntimeTaskDeliveryStateV1::Submitted
        ) || current.submitted_event_id.as_ref() != Some(event_id)
        {
            return Err(RuntimeTaskDeliveryError::Denied);
        }
        let before = current.clone();
        let row = self
            .rows
            .get_mut(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        row.state = RuntimeTaskDeliveryStateV1::Published;
        row.published_event_id = Some(event_id.clone());
        row.updated_at = updated_at;
        if let Err(error) = self.persist() {
            self.rows.insert(key, before);
            return Err(error);
        }
        Ok(())
    }

    pub(crate) fn mark_rejected(
        &mut self,
        delivery_id: &OpaqueId,
        event_id: &Hex64,
        updated_at: CanonicalTimestamp,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        self.mark_terminal_event(
            delivery_id,
            event_id,
            RuntimeTaskDeliveryStateV1::Rejected,
            updated_at,
        )
    }

    pub(crate) fn finalize_published_outbox(
        &mut self,
        delivery_id: &OpaqueId,
        event_id: &Hex64,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        self.finalize_outbox(delivery_id, event_id, RuntimeTaskDeliveryStateV1::Published)
    }

    pub(crate) fn recover_terminal_outbox_finalization(
        &mut self,
        delivery_id: &OpaqueId,
        event_id: &Hex64,
        state: RuntimeTaskDeliveryStateV1,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        if !matches!(
            state,
            RuntimeTaskDeliveryStateV1::Rejected | RuntimeTaskDeliveryStateV1::Cancelled
        ) {
            return Err(RuntimeTaskDeliveryError::Invalid);
        }
        self.finalize_outbox(delivery_id, event_id, state)
    }

    fn transition_claim(
        &mut self,
        delivery_id: &OpaqueId,
        session_epoch: u64,
        state: RuntimeTaskDeliveryStateV1,
        updated_at: CanonicalTimestamp,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        let key = self.key_for_delivery(delivery_id)?;
        let current = self
            .rows
            .get(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        if current.state != RuntimeTaskDeliveryStateV1::Synthesizing
            || current.synthesis_session_epoch != Some(session_epoch)
        {
            return Err(RuntimeTaskDeliveryError::Denied);
        }
        let before = current.clone();
        let row = self
            .rows
            .get_mut(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        row.state = state;
        row.synthesis_session_epoch = None;
        row.synthesis_lease_deadline_unix_ms = None;
        if state == RuntimeTaskDeliveryStateV1::Blocked {
            // A blocked synthesis never reached event preparation.
            row.outbox_finalized = true;
        }
        row.updated_at = updated_at;
        if let Err(error) = self.persist() {
            self.rows.insert(key, before);
            return Err(error);
        }
        Ok(())
    }

    fn block(
        &mut self,
        key: &str,
        updated_at: CanonicalTimestamp,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        let before = self
            .rows
            .get(key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?
            .clone();
        let row = self
            .rows
            .get_mut(key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        row.state = RuntimeTaskDeliveryStateV1::Blocked;
        // A scope mismatch before claim cannot have created an outbox entry.
        row.outbox_finalized = true;
        row.updated_at = updated_at;
        if let Err(error) = self.persist() {
            self.rows.insert(key.to_owned(), before);
            return Err(error);
        }
        Ok(())
    }

    fn mark_terminal_event(
        &mut self,
        delivery_id: &OpaqueId,
        event_id: &Hex64,
        state: RuntimeTaskDeliveryStateV1,
        updated_at: CanonicalTimestamp,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        let key = self.key_for_delivery(delivery_id)?;
        let current = self
            .rows
            .get(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        if current.state == state && current.submitted_event_id.as_ref() == Some(event_id) {
            return Ok(());
        }
        if !matches!(
            current.state,
            RuntimeTaskDeliveryStateV1::Prepared | RuntimeTaskDeliveryStateV1::Submitted
        ) || current.submitted_event_id.as_ref() != Some(event_id)
        {
            return Err(RuntimeTaskDeliveryError::Denied);
        }
        let before = current.clone();
        let row = self
            .rows
            .get_mut(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        row.state = state;
        row.updated_at = updated_at;
        if let Err(error) = self.persist() {
            self.rows.insert(key, before);
            return Err(error);
        }
        Ok(())
    }

    fn finalize_outbox(
        &mut self,
        delivery_id: &OpaqueId,
        event_id: &Hex64,
        expected: RuntimeTaskDeliveryStateV1,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        let key = self.key_for_delivery(delivery_id)?;
        let current = self
            .rows
            .get(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?;
        let event_matches = if expected == RuntimeTaskDeliveryStateV1::Published {
            current.published_event_id.as_ref() == Some(event_id)
        } else {
            current.submitted_event_id.as_ref() == Some(event_id)
        };
        if current.state != expected || !event_matches {
            return Err(RuntimeTaskDeliveryError::Denied);
        }
        if current.outbox_finalized {
            return Ok(());
        }
        let before = current.clone();
        self.rows
            .get_mut(&key)
            .ok_or(RuntimeTaskDeliveryError::Unavailable)?
            .outbox_finalized = true;
        if let Err(error) = self.persist() {
            self.rows.insert(key, before);
            return Err(error);
        }
        Ok(())
    }

    fn key_for_delivery(&self, delivery_id: &OpaqueId) -> Result<String, RuntimeTaskDeliveryError> {
        self.rows
            .iter()
            .find(|(_, row)| row.delivery_id.as_ref() == Some(delivery_id))
            .map(|(key, _)| key.clone())
            .ok_or(RuntimeTaskDeliveryError::Denied)
    }

    fn prune_terminal(&mut self) {
        let mut terminal = self
            .rows
            .iter()
            .filter(|(_, row)| row.state.is_terminal() && row.outbox_finalized)
            .map(|(key, row)| (key.clone(), row.updated_at.clone()))
            .collect::<Vec<_>>();
        terminal.sort_by(|left, right| left.1.cmp(&right.1));
        for (key, _) in terminal.into_iter().take(
            self.rows
                .len()
                .saturating_add(1)
                .saturating_sub(MAX_DELIVERIES),
        ) {
            self.rows.remove(&key);
        }
    }

    fn persist(&self) -> Result<(), RuntimeTaskDeliveryError> {
        if self.rows.len() > MAX_DELIVERIES {
            return Err(RuntimeTaskDeliveryError::Persistence);
        }
        let parent = self
            .path
            .parent()
            .ok_or(RuntimeTaskDeliveryError::Persistence)?;
        std::fs::create_dir_all(parent).map_err(|_| RuntimeTaskDeliveryError::Persistence)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| RuntimeTaskDeliveryError::Persistence)?;
        }
        let mut deliveries = self.rows.values().cloned().collect::<Vec<_>>();
        deliveries.sort_by(|left, right| {
            left.approval
                .task_id
                .as_str()
                .cmp(right.approval.task_id.as_str())
        });
        let bytes = serde_json::to_vec(&PersistedRuntimeTaskDeliveryStoreV1 {
            schema: STORE_SCHEMA.to_owned(),
            deliveries,
        })
        .map_err(|_| RuntimeTaskDeliveryError::Persistence)?;
        if bytes.len() as u64 > MAX_STORE_BYTES {
            return Err(RuntimeTaskDeliveryError::Persistence);
        }
        atomic_write_restricted(&self.path, &bytes)
            .map_err(|_| RuntimeTaskDeliveryError::Persistence)
    }
}

pub(crate) fn global_runtime_task_delivery_store(
    app: &AppHandle,
) -> Result<Arc<Mutex<RuntimeTaskDeliveryStore>>, RuntimeTaskDeliveryError> {
    if let Some(store) = GLOBAL_STORE.get() {
        return Ok(Arc::clone(store));
    }
    let root = app
        .buzz_path()
        .app_data_dir()
        .map_err(|_| RuntimeTaskDeliveryError::Persistence)?;
    let candidate = Arc::new(Mutex::new(RuntimeTaskDeliveryStore::load(
        root.join("luca").join("runtime-task-deliveries-v1.json"),
    )?));
    let _ = GLOBAL_STORE.set(Arc::clone(&candidate));
    GLOBAL_STORE
        .get()
        .map(Arc::clone)
        .ok_or(RuntimeTaskDeliveryError::Unavailable)
}

/// Hash a relay coordinate without ever retaining credentials or an auth tag.
/// The supervised local relay uses its stable sentinel across port changes.
pub(crate) fn origin_relay_ref(
    app: &AppHandle,
    relay_url: &str,
) -> Result<Sha256Ref, RuntimeTaskDeliveryError> {
    let supervised =
        crate::local_relay::relay_url(&app.state::<crate::local_relay::RuntimeState>());
    relay_ref_with_supervised_url(relay_url, supervised.as_deref())
}

fn relay_ref_with_supervised_url(
    relay_url: &str,
    supervised_url: Option<&str>,
) -> Result<Sha256Ref, RuntimeTaskDeliveryError> {
    // A persisted marker is never a usable endpoint. Validate the concrete
    // network coordinate before normalizing the exact supervised endpoint.
    let network_ref = relay_ref_from_network_url(relay_url)?;
    if supervised_url == Some(relay_url) {
        hash_canonical_relay_coordinate(crate::local_relay::LOCAL_RELAY_SENTINEL)
    } else {
        Ok(network_ref)
    }
}

pub(crate) fn community_id_for_relay_ref(
    relay_ref: &Sha256Ref,
) -> Result<OpaqueId, RuntimeTaskDeliveryError> {
    OpaqueId::parse(format!(
        "community:{}",
        relay_ref.as_str().trim_start_matches("sha256:")
    ))
    .map_err(|_| RuntimeTaskDeliveryError::Invalid)
}

/// Read the relay's current, signed membership coordinate for one conversation.
///
/// Unlike the general conversation helper, this authority check never unions
/// historical events. It binds the single addressable event to the relay key
/// currently advertised by NIP-11, verifies its signature and exact `d`
/// coordinate, and selects exactly one source of membership: DM metadata for a
/// DM, or the NIP-29 members event for every other room type.
pub(crate) fn verified_conversation_members(
    app: &AppHandle,
    conversation_id: &OpaqueId,
) -> Result<BTreeSet<Hex64>, String> {
    let state = app.state::<crate::app_state::AppState>();
    let conversation = conversation_id.as_str().to_owned();
    let (relay_self, events) = tauri::async_runtime::block_on(async {
        tokio::time::timeout(Duration::from_secs(5), async {
            let relay_self = crate::fetch_relay_self(&state)
                .await?
                .ok_or_else(|| "Relay signing identity is unavailable.".to_owned())?;
            let events = crate::relay::query_relay(
                &state,
                &[
                    serde_json::json!({
                        "authors": [relay_self.clone()],
                        "kinds": [39000],
                        "#d": [conversation.clone()],
                        "limit": 1,
                    }),
                    serde_json::json!({
                        "authors": [relay_self.clone()],
                        "kinds": [39002],
                        "#d": [conversation.clone()],
                        "limit": 1,
                    }),
                ],
            )
            .await?;
            Ok::<_, String>((relay_self, events))
        })
        .await
        .map_err(|_| "Conversation membership verification timed out.".to_owned())?
    })?;
    verified_conversation_members_from_events(&relay_self, conversation_id, &events)
}

fn verified_conversation_members_from_events(
    relay_self: &str,
    conversation_id: &OpaqueId,
    events: &[nostr::Event],
) -> Result<BTreeSet<Hex64>, String> {
    let metadata = exact_relay_coordinate(events, relay_self, conversation_id, 39000)?;
    let channel = crate::nostr_convert::channel_info_from_event(metadata, None, None)
        .map_err(|_| "Conversation metadata is invalid.".to_owned())?;
    let raw_members = if channel.channel_type == "dm" {
        channel.participant_pubkeys
    } else {
        let members = exact_relay_coordinate(events, relay_self, conversation_id, 39002)?;
        crate::nostr_convert::channel_members_from_event(members)
            .map_err(|_| "Conversation membership is invalid.".to_owned())?
            .members
            .into_iter()
            .map(|member| member.pubkey)
            .collect()
    };
    raw_members
        .into_iter()
        .map(|pubkey| {
            Hex64::parse(pubkey.to_ascii_lowercase())
                .map_err(|_| "Conversation membership contains an invalid identity.".to_owned())
        })
        .collect()
}

fn exact_relay_coordinate<'a>(
    events: &'a [nostr::Event],
    relay_self: &str,
    conversation_id: &OpaqueId,
    kind: u16,
) -> Result<&'a nostr::Event, String> {
    let matching = events
        .iter()
        .filter(|event| event.kind == nostr::Kind::Custom(kind))
        .collect::<Vec<_>>();
    if matching.len() != 1 {
        return Err("Current conversation membership is ambiguous or unavailable.".to_owned());
    }
    let event = matching[0];
    let d_tags = event
        .tags
        .iter()
        .filter_map(|tag| {
            let parts = tag.as_slice();
            (parts.first().is_some_and(|part| part == "d")).then_some(parts)
        })
        .collect::<Vec<_>>();
    if !event.pubkey.to_hex().eq_ignore_ascii_case(relay_self)
        || !event.verify_id()
        || !event.verify_signature()
        || d_tags.len() != 1
        || d_tags[0].len() != 2
        || d_tags[0][1] != conversation_id.as_str()
    {
        return Err("Current conversation membership could not be verified.".to_owned());
    }
    Ok(event)
}

fn relay_ref_from_network_url(relay_url: &str) -> Result<Sha256Ref, RuntimeTaskDeliveryError> {
    let mut parsed = url::Url::parse(relay_url).map_err(|_| RuntimeTaskDeliveryError::Invalid)?;
    if !matches!(parsed.scheme(), "ws" | "wss" | "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.host_str().is_none()
    {
        return Err(RuntimeTaskDeliveryError::Invalid);
    }
    parsed.set_query(None);
    parsed.set_fragment(None);
    hash_canonical_relay_coordinate(parsed.as_str().trim_end_matches('/'))
}

fn hash_canonical_relay_coordinate(canonical: &str) -> Result<Sha256Ref, RuntimeTaskDeliveryError> {
    let mut hasher = Sha256::new();
    hasher.update(RELAY_DOMAIN.as_bytes());
    hasher.update(b"\0");
    hasher.update(canonical.as_bytes());
    Sha256Ref::parse(format!("sha256:{}", hex::encode(hasher.finalize())))
        .map_err(|_| RuntimeTaskDeliveryError::Invalid)
}

fn validate_approval(
    approval: &RuntimeTaskDeliveryApprovalV1,
) -> Result<(), RuntimeTaskDeliveryError> {
    if approval.owner_pubkey == approval.resident_pubkey
        || approval.runtime_family.is_empty()
        || approval.runtime_family.len() > 64
        || approval.permission_mode.is_empty()
        || approval.permission_mode.len() > 64
        || community_id_for_relay_ref(&approval.origin_relay_ref)? != approval.origin_community_id
    {
        return Err(RuntimeTaskDeliveryError::Invalid);
    }
    Ok(())
}

fn validate_row(row: &RuntimeTaskDeliveryRowV1) -> Result<(), RuntimeTaskDeliveryError> {
    validate_approval(&row.approval)?;
    if sha256_ref(&row.approval)? != row.approval_sha256 {
        return Err(RuntimeTaskDeliveryError::Invalid);
    }
    let bound_pair = match (&row.delivery_id, &row.result_sha256) {
        (None, None) => false,
        (Some(delivery), Some(result)) => {
            derive_delivery_id(&row.approval_sha256, result)? == *delivery
        }
        _ => return Err(RuntimeTaskDeliveryError::Invalid),
    };
    let coherent = match row.state {
        RuntimeTaskDeliveryStateV1::AwaitingResult => !bound_pair,
        RuntimeTaskDeliveryStateV1::PendingSynthesis | RuntimeTaskDeliveryStateV1::Retryable => {
            bound_pair
        }
        RuntimeTaskDeliveryStateV1::Blocked => {
            bound_pair
                || (row.delivery_id.is_none()
                    && row.result_sha256.is_none()
                    && row.request_sha256.is_none()
                    && row.submitted_event_id.is_none()
                    && row.published_event_id.is_none()
                    && row.outbox_finalized)
        }
        RuntimeTaskDeliveryStateV1::Synthesizing => {
            bound_pair
                && row.synthesis_session_epoch.is_some_and(|value| value > 0)
                && row.synthesis_lease_deadline_unix_ms.is_some()
        }
        RuntimeTaskDeliveryStateV1::Prepared => bound_pair && row.request_sha256.is_some(),
        RuntimeTaskDeliveryStateV1::Submitted => {
            bound_pair && row.request_sha256.is_some() && row.submitted_event_id.is_some()
        }
        RuntimeTaskDeliveryStateV1::Published => {
            bound_pair
                && row.request_sha256.is_some()
                && row.submitted_event_id.is_some()
                && row.published_event_id == row.submitted_event_id
        }
        RuntimeTaskDeliveryStateV1::Rejected => {
            bound_pair && row.submitted_event_id.is_some() && row.published_event_id.is_none()
        }
        RuntimeTaskDeliveryStateV1::Cancelled => {
            (!bound_pair
                && row.delivery_id.is_none()
                && row.result_sha256.is_none()
                && row.request_sha256.is_none()
                && row.submitted_event_id.is_none()
                && row.published_event_id.is_none()
                && row.outbox_finalized)
                || (bound_pair
                    && row.submitted_event_id.is_some()
                    && row.published_event_id.is_none())
        }
    };
    if !coherent || (row.outbox_finalized && !row.state.is_terminal()) {
        return Err(RuntimeTaskDeliveryError::Invalid);
    }
    if row.synthesis_attempts == 0
        && matches!(
            row.state,
            RuntimeTaskDeliveryStateV1::Synthesizing
                | RuntimeTaskDeliveryStateV1::Prepared
                | RuntimeTaskDeliveryStateV1::Submitted
                | RuntimeTaskDeliveryStateV1::Published
                | RuntimeTaskDeliveryStateV1::Rejected
        )
        || (row.synthesis_attempts == 0
            && row.state == RuntimeTaskDeliveryStateV1::Cancelled
            && bound_pair)
    {
        return Err(RuntimeTaskDeliveryError::Invalid);
    }
    Ok(())
}

fn scope_matches(row: &RuntimeTaskDeliveryRowV1, scope: &RuntimeTaskDeliveryScopeV1) -> bool {
    row.approval.owner_pubkey == scope.owner_pubkey
        && row.approval.resident_pubkey == scope.resident_pubkey
        && row.approval.conversation_id == scope.conversation_id
        && row.approval.origin_relay_ref == scope.origin_relay_ref
        && row.approval.origin_community_id == scope.origin_community_id
        && row.approval.binding_ref == scope.binding_ref
        && row
            .synthesis_session_epoch
            .is_none_or(|epoch| epoch == scope.session_epoch)
}

fn request_matches(
    row: &RuntimeTaskDeliveryRowV1,
    request: &ManagedMessagePublishRequestV1,
) -> bool {
    row.delivery_id.as_ref() == Some(&request.dispatch_receipt_id)
        && row.delivery_id.as_ref() == Some(&request.turn_id)
        && row.approval.owner_pubkey == request.owner_pubkey
        && row.approval.resident_pubkey == request.resident_pubkey
        && row.approval.conversation_id == request.conversation_id
        && row.synthesis_session_epoch == Some(request.cancellation_epoch.get())
        && request.response_surface == Some(ManagedResponseSurfaceV1::Timeline)
        && request.resolved_p_tags == [request.owner_pubkey.clone()]
        && request.thread_id.is_none()
        && request.root_event_id.is_none()
        && request.reply_event_id.is_none()
        && request.exchange.is_none()
        && request.bucket_hint.is_none()
        && request.attachments.is_empty()
}

fn derive_delivery_id(
    approval_sha256: &Sha256Ref,
    result_sha256: &Sha256Ref,
) -> Result<OpaqueId, RuntimeTaskDeliveryError> {
    let digest = canonical_sha256(&serde_json::json!({
        "domain": DELIVERY_DOMAIN,
        "approval": approval_sha256,
        "result": result_sha256,
    }))
    .map_err(|_| RuntimeTaskDeliveryError::Invalid)?;
    OpaqueId::parse(format!("task-result:{digest}")).map_err(|_| RuntimeTaskDeliveryError::Invalid)
}

fn sha256_ref<T: Serialize>(value: &T) -> Result<Sha256Ref, RuntimeTaskDeliveryError> {
    Sha256Ref::parse(format!(
        "sha256:{}",
        canonical_sha256(value).map_err(|_| RuntimeTaskDeliveryError::Invalid)?
    ))
    .map_err(|_| RuntimeTaskDeliveryError::Invalid)
}

fn receipt(row: &RuntimeTaskDeliveryRowV1) -> RuntimeTaskDeliveryReceiptV1 {
    RuntimeTaskDeliveryReceiptV1 {
        delivery_id: row.delivery_id.clone(),
        task_id: row.approval.task_id.clone(),
        owner_pubkey: row.approval.owner_pubkey.clone(),
        resident_pubkey: row.approval.resident_pubkey.clone(),
        conversation_id: row.approval.conversation_id.clone(),
        origin_relay_ref: row.approval.origin_relay_ref.clone(),
        origin_community_id: row.approval.origin_community_id.clone(),
        input_sha256: row.approval.input_sha256.clone(),
        result_sha256: row.result_sha256.clone(),
        binding_ref: row.approval.binding_ref.clone(),
        state: row.state,
        synthesis_attempts: row.synthesis_attempts,
        synthesis_lease_deadline_unix_ms: row.synthesis_lease_deadline_unix_ms,
        updated_at: row.updated_at.clone(),
    }
}

fn claim(
    row: &RuntimeTaskDeliveryRowV1,
) -> Result<RuntimeTaskSynthesisClaimV1, RuntimeTaskDeliveryError> {
    Ok(RuntimeTaskSynthesisClaimV1 {
        delivery_id: row
            .delivery_id
            .clone()
            .ok_or(RuntimeTaskDeliveryError::Invalid)?,
        task_id: row.approval.task_id.clone(),
        owner_pubkey: row.approval.owner_pubkey.clone(),
        resident_pubkey: row.approval.resident_pubkey.clone(),
        conversation_id: row.approval.conversation_id.clone(),
        origin_relay_ref: row.approval.origin_relay_ref.clone(),
        origin_community_id: row.approval.origin_community_id.clone(),
        input_sha256: row.approval.input_sha256.clone(),
        result_sha256: row
            .result_sha256
            .clone()
            .ok_or(RuntimeTaskDeliveryError::Invalid)?,
        binding_ref: row.approval.binding_ref.clone(),
        session_epoch: row
            .synthesis_session_epoch
            .ok_or(RuntimeTaskDeliveryError::Invalid)?,
        synthesis_attempt: row.synthesis_attempts,
        lease_deadline_unix_ms: row
            .synthesis_lease_deadline_unix_ms
            .ok_or(RuntimeTaskDeliveryError::Invalid)?,
    })
}

#[cfg(test)]
#[path = "runtime_task_delivery_tests.rs"]
mod runtime_task_delivery_tests;
