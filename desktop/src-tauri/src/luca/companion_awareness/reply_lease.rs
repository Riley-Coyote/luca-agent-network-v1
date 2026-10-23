//! In-memory, body-free lifetime for one already-admitted native turn reply.
//! A reservation is not admission: only its exact committed dispatch may use it.

use super::*;
use crate::luca::companion_awareness::turn_context::{
    AwarenessTurnReceiptV1, AwarenessTurnScopeV1,
};
use crate::luca::managed_dispatch_store::ManagedTurnAwarenessBindingV1;
use luca_protocol::Sha256Ref;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Weak,
};

const MAX_REPLY_LEASES: usize = 64;
const MAX_REPLY_REFERENCES: usize = 4;
const MAX_REPLY_SECONDS: u64 = 30 * 60;

pub(crate) struct ReplyLeaseInner {
    scope: AwarenessTurnScopeV1,
    node: OpaqueId,
    observations: Vec<AwarenessObservationRefV1>,
    native: Vec<SourceMaterialBindingV1>,
    reserved_at: CanonicalTimestamp,
    expires_at: CanonicalTimestamp,
    expires_unix_secs: u64,
    valid: AtomicBool,
}

/// Opaque host reservation. It contains no source bytes and is never serialized.
/// Its lifetime cannot authorize a new prompt, retained history, note or artifact.
#[derive(Clone)]
pub(crate) struct NativeReplyLeaseV1(Arc<ReplyLeaseInner>);
impl std::fmt::Debug for NativeReplyLeaseV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NativeReplyLeaseV1")
            .field("native_references", &self.0.native.len())
            .finish_non_exhaustive()
    }
}
impl PartialEq for NativeReplyLeaseV1 {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}
impl Eq for NativeReplyLeaseV1 {}

impl NativeReplyLeaseV1 {
    /// Permanently invalidate this reservation; later capture/resume cannot revive it.
    pub(crate) fn cancel(&self) {
        self.0.valid.store(false, Ordering::Release);
    }
    /// Existing dispatch expiry, never a fresh duration measured from publication.
    pub(crate) fn expires_unix_secs(&self) -> u64 {
        self.0.expires_unix_secs
    }
    /// Check the real clock without altering capture timestamps or raw expiry.
    pub(crate) fn current(&self, now: &CanonicalTimestamp) -> bool {
        self.0.valid.load(Ordering::Acquire)
            && &self.0.reserved_at <= now
            && now < &self.0.expires_at
    }
    /// Complete receipt membership, including non-native references without a TTL exception.
    pub(crate) fn contains(&self, reference: &AwarenessObservationRefV1) -> bool {
        self.0.observations.contains(reference)
    }
    /// Clock adapter for the existing dispatch authority's Unix-second API.
    pub(crate) fn current_unix_secs(&self, now: u64) -> bool {
        i64::try_from(now)
            .ok()
            .and_then(|value| chrono::DateTime::from_timestamp(value, 0))
            .and_then(|value| {
                CanonicalTimestamp::parse(value.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
                    .ok()
            })
            .is_some_and(|value| self.current(&value))
    }
    /// Exact full-reference membership in the admitted native snapshot.
    pub(crate) fn binding(
        &self,
        reference: &AwarenessObservationRefV1,
    ) -> Option<&SourceMaterialBindingV1> {
        self.0
            .native
            .iter()
            .find(|binding| &binding.reference == reference)
    }
    /// Reply-only lifetime proof, with all current authority checked separately.
    pub(crate) fn allows(
        &self,
        reference: &AwarenessObservationRefV1,
        now: &CanonicalTimestamp,
    ) -> bool {
        self.current(now) && self.binding(reference).is_some() && reference.captured_at <= *now
    }
    /// Match the immutable persisted receipt, not a renderer-provided reference list.
    pub(crate) fn matches_receipt(&self, receipt: &ManagedTurnAwarenessBindingV1) -> bool {
        let scope = &self.0.scope;
        receipt.fresh_native_history
            && receipt.owner_pubkey == scope.authority.owner_pubkey
            && receipt.resident_pubkey == scope.authority.resident_pubkey
            && receipt.conversation_id == scope.authority.conversation_id
            && receipt.trigger_event_id == scope.authority.trigger_event_id
            && receipt.canonical_dispatch_ref.as_ref()
                == Some(&scope.authority.canonical_dispatch_ref)
            && receipt.binding_ref.as_ref() == Some(&scope.binding_ref)
            && receipt.session_epoch == Some(scope.session_epoch)
            && receipt.context_node.as_ref() == Some(&self.0.node)
            && receipt.context_nodes == [self.0.node.clone()]
            && receipt.observations == self.0.observations
    }
    /// Match the actual pre-frame turn and dispatch deadline before attaching.
    pub(crate) fn matches_turn(&self, receipt: &AwarenessTurnReceiptV1, expires: u64) -> bool {
        self.0.scope == receipt.scope
            && self.0.node == receipt.context_node
            && self.0.observations == receipt.observations
            && self.0.expires_unix_secs == expires
    }
    /// Bind the awareness store's final dependency check to these exact coordinates.
    pub(crate) fn matches_admission(
        &self,
        owner: &Hex64,
        resident: &Hex64,
        binding: &Sha256Ref,
        nodes: &[OpaqueId],
        references: &[AwarenessObservationRefV1],
        now: &CanonicalTimestamp,
    ) -> bool {
        self.current(now)
            && &self.0.scope.authority.owner_pubkey == owner
            && &self.0.scope.authority.resident_pubkey == resident
            && &self.0.scope.binding_ref == binding
            && nodes == [self.0.node.clone()]
            && references == self.0.observations
    }
}

impl SourceMaterialScopeV1 {
    fn native_reply_scope(&self) -> bool {
        matches!(
            self,
            Self::ProfileChild(_)
                | Self::Exact(
                    SelectedSourceClassV1::CodexSessionMetadata
                        | SelectedSourceClassV1::CodexSessionVisibleExcerpts
                        | SelectedSourceClassV1::ClaudeSessionMetadata
                        | SelectedSourceClassV1::ClaudeSessionVisibleExcerpts
                )
        )
    }
}

impl MaterialBook {
    /// Reserve only current, exact native metadata before framing admission.
    pub(crate) fn reserve_reply_lease(
        &mut self,
        receipt: &AwarenessTurnReceiptV1,
        bindings: &[SourceMaterialBindingV1],
        expires_unix_secs: u64,
        now: &CanonicalTimestamp,
    ) -> Result<NativeReplyLeaseV1, AwarenessStoreError> {
        let current_secs = chrono::DateTime::parse_from_rfc3339(now.as_str())
            .map_err(|_| AwarenessStoreError::Invalid)?
            .timestamp();
        let current_secs = u64::try_from(current_secs).map_err(|_| AwarenessStoreError::Invalid)?;
        if self.owner.as_ref() != Some(&receipt.scope.authority.owner_pubkey)
            || receipt.scope.session_epoch.get() == 0
            || receipt.observations.is_empty()
            || receipt.observations.len() > MAX_REPLY_REFERENCES
            || bindings.len() != receipt.observations.len()
            || expires_unix_secs <= current_secs
            || expires_unix_secs.saturating_sub(current_secs) > MAX_REPLY_SECONDS
        {
            return Err(AwarenessStoreError::Invalid);
        }
        let mut native = Vec::new();
        for (index, (reference, binding)) in receipt.observations.iter().zip(bindings).enumerate() {
            reference.validate()?;
            if reference != &binding.reference
                || reference.owner_pubkey != receipt.scope.authority.owner_pubkey
                || reference.resident_pubkey != receipt.scope.authority.resident_pubkey
                || receipt.observations[..index]
                    .iter()
                    .any(|prior| prior.observation_id == reference.observation_id)
            {
                return Err(AwarenessStoreError::Invalid);
            }
            if !binding.scope.native_reply_scope() {
                continue;
            }
            let record = self
                .records
                .iter()
                .find(|record| &record.binding == binding)
                .ok_or(AwarenessStoreError::Unavailable)?;
            if !record.raw_current
                || !record.reply_current
                || record.state != AwarenessMaterialStateV1::Available
                || !self.active.contains(&observation_key(reference))
                || reference.captured_at > *now
                || reference.expires_at <= *now
            {
                return Err(AwarenessStoreError::Unavailable);
            }
            native.push(binding.clone());
        }
        self.sweep_reply_leases(now);
        if self.reply_leases.len() >= MAX_REPLY_LEASES {
            return Err(AwarenessStoreError::Capacity);
        }
        let expires_at = chrono::DateTime::from_timestamp(
            i64::try_from(expires_unix_secs).map_err(|_| AwarenessStoreError::Invalid)?,
            0,
        )
        .ok_or(AwarenessStoreError::Invalid)?
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let lease = NativeReplyLeaseV1(Arc::new(ReplyLeaseInner {
            scope: receipt.scope.clone(),
            node: receipt.context_node.clone(),
            observations: receipt.observations.clone(),
            native,
            reserved_at: now.clone(),
            expires_at: CanonicalTimestamp::parse(expires_at)
                .map_err(|_| AwarenessStoreError::Invalid)?,
            expires_unix_secs,
            valid: AtomicBool::new(true),
        }));
        self.reply_leases.push(Arc::downgrade(&lease.0));
        Ok(lease)
    }
    /// Reclaim dead/expired weak registrations without evicting active turns.
    pub(crate) fn sweep_reply_leases(&mut self, now: &CanonicalTimestamp) {
        self.reply_leases.retain(|weak| {
            let Some(inner) = weak.upgrade() else {
                return false;
            };
            let lease = NativeReplyLeaseV1(inner);
            if !lease.current(now) {
                lease.cancel();
                return false;
            }
            true
        });
    }
    /// Permanently cancel every reservation affected by an explicit source stop.
    pub(crate) fn invalidate_reply_leases(
        &self,
        mut matches: impl FnMut(&SourceMaterialBindingV1) -> bool,
    ) {
        for inner in self.reply_leases.iter().filter_map(Weak::upgrade) {
            if inner.native.iter().any(&mut matches) {
                NativeReplyLeaseV1(inner).cancel();
            }
        }
    }
    /// Cancel outstanding reservations before owner/runtime teardown.
    pub(crate) fn invalidate_all_reply_leases(&self) {
        for inner in self.reply_leases.iter().filter_map(Weak::upgrade) {
            NativeReplyLeaseV1(inner).cancel();
        }
    }
    /// Reset under the final metadata lock, including reservations that raced
    /// an earlier stop notification while the worker was still joining.
    pub(crate) fn reset_after_stop(&mut self) {
        self.invalidate_all_reply_leases();
        *self = Self::default();
    }
}

#[cfg(test)]
/// Disposable metadata-only fixture, excluded from production builds.
pub(crate) fn synthetic_reply_lease(
    receipt: &AwarenessTurnReceiptV1,
    bindings: &[SourceMaterialBindingV1],
    expires: u64,
    now: &CanonicalTimestamp,
) -> NativeReplyLeaseV1 {
    let mut book = MaterialBook {
        owner: Some(receipt.scope.authority.owner_pubkey.clone()),
        ..Default::default()
    };
    for binding in bindings {
        book.active.push(observation_key(&binding.reference));
        book.remember(binding.reference.clone(), binding.scope.clone());
    }
    book.reserve_reply_lease(receipt, bindings, expires, now)
        .unwrap()
}
