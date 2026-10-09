//! Bounded, process-memory-only payloads, separate from the body-free deny store.
//! The host owns authority/clock/exclusion facts and must recheck the durable
//! store immediately before use. Zeroizing buffers limit retained copies here;
//! this is not a claim about provider memory or copies made by a consuming sink.

use luca_protocol::{
    recheck_awareness_eligibility, AwarenessAuthoritySnapshotV1, AwarenessError,
    AwarenessObservationRefV1, AwarenessUseV1, CanonicalTimestamp, Hex64, OpaqueId, SafeU53,
};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fmt,
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

pub(crate) const MAX_AWARENESS_PAYLOAD_BYTES: usize = 256 * 1024;
pub(crate) const MAX_AWARENESS_BUFFER_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const MAX_AWARENESS_BUFFER_ENTRIES: usize = 128;
const MAX_BUFFER_SCOPES: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AwarenessBufferError {
    Denied(AwarenessError),
    Missing,
    Binding,
    Capacity,
    Evidence,
}
impl fmt::Display for AwarenessBufferError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "awareness buffer: {self:?}")
    }
}
impl std::error::Error for AwarenessBufferError {}
impl From<AwarenessError> for AwarenessBufferError {
    fn from(value: AwarenessError) -> Self {
        Self::Denied(value)
    }
}

struct Entry {
    reference: AwarenessObservationRefV1,
    payload: Zeroizing<Vec<u8>>,
    admitted: Instant,
    lifetime: Duration,
}
type Key = (Hex64, Hex64, OpaqueId);
/// No serialization, persistence, global cache, or payload-bearing Debug exists.
#[derive(Default)]
pub(crate) struct EphemeralAwarenessBuffer {
    entries: BTreeMap<Key, Entry>,
    /// Body-free watermarks prevent replay from resurrecting dropped payloads.
    sequences: BTreeMap<Key, SafeU53>,
    bytes: usize,
}
impl fmt::Debug for EphemeralAwarenessBuffer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EphemeralAwarenessBuffer")
            .field("entries", &self.entries.len())
            .field("bytes", &self.bytes)
            .field("payloads", &"[REDACTED]")
            .finish()
    }
}
impl EphemeralAwarenessBuffer {
    /// A validated capture can advance this replay watermark before its durable
    /// admission is rejected (for example, at the exact Resume clock boundary).
    /// Payload invalidation deliberately does not rewind it. Host allocation
    /// must respect both this process watermark and the durable accepted stream.
    pub(crate) fn sequence_watermark(
        &self,
        owner: &Hex64,
        resident: &Hex64,
        grant: &OpaqueId,
    ) -> Option<SafeU53> {
        self.sequences.get(&(owner.clone(), resident.clone(), grant.clone())).copied()
    }

    /// Admit current, non-excluded bytes under one exact source/grant reference.
    /// Evidence is SHA-256 of these exact bytes; a different payload is rejected.
    pub(crate) fn insert(
        &mut self,
        authority: &AwarenessAuthoritySnapshotV1<'_>,
        reference: AwarenessObservationRefV1,
        payload: Vec<u8>,
    ) -> Result<bool, AwarenessBufferError> {
        let payload = Zeroizing::new(payload);
        self.prune(authority.now);
        recheck_awareness_eligibility(authority, &reference, AwarenessUseV1::default())?;
        if payload.is_empty() || payload.len() > MAX_AWARENESS_PAYLOAD_BYTES {
            return Err(AwarenessBufferError::Capacity);
        }
        let digest = format!("sha256:{}", hex::encode(Sha256::digest(payload.as_slice())));
        if reference.evidence_ref.as_str() != digest {
            return Err(AwarenessBufferError::Evidence);
        }
        let key = key(&reference);
        if let Some(old) = self.entries.get(&key) {
            if old.reference != reference {
                return Err(AwarenessBufferError::Binding);
            }
            return Ok(true);
        }
        let stream = (
            reference.owner_pubkey.clone(),
            reference.resident_pubkey.clone(),
            reference.grant_id.clone(),
        );
        if self
            .sequences
            .get(&stream)
            .is_some_and(|previous| reference.sequence <= *previous)
        {
            return Err(AwarenessBufferError::Binding);
        }
        if !self.sequences.contains_key(&stream) && self.sequences.len() >= MAX_BUFFER_SCOPES {
            return Err(AwarenessBufferError::Capacity);
        }
        let bytes = self
            .bytes
            .checked_add(payload.len())
            .ok_or(AwarenessBufferError::Capacity)?;
        if self.entries.len() >= MAX_AWARENESS_BUFFER_ENTRIES || bytes > MAX_AWARENESS_BUFFER_BYTES
        {
            return Err(AwarenessBufferError::Capacity);
        }
        let expires = chrono::DateTime::parse_from_rfc3339(reference.expires_at.as_str())
            .map_err(|_| AwarenessBufferError::Binding)?;
        let now = chrono::DateTime::parse_from_rfc3339(authority.now.as_str())
            .map_err(|_| AwarenessBufferError::Binding)?;
        let lifetime = expires
            .signed_duration_since(now)
            .to_std()
            .map_err(|_| AwarenessBufferError::Binding)?;
        self.sequences.insert(stream, reference.sequence);
        self.entries.insert(
            key,
            Entry {
                reference,
                payload,
                admitted: Instant::now(),
                lifetime,
            },
        );
        self.bytes = bytes;
        Ok(false)
    }

    /// Lend payload only under current host authority, exact metadata, and TTL.
    /// The host wrapper holds its effect/revocation lock across this sink call.
    pub(crate) fn with_payload<T>(
        &mut self,
        authority: &AwarenessAuthoritySnapshotV1<'_>,
        reference: &AwarenessObservationRefV1,
        intended_use: AwarenessUseV1<'_>,
        sink: impl FnOnce(&[u8]) -> T,
    ) -> Result<T, AwarenessBufferError> {
        self.prune(authority.now);
        recheck_awareness_eligibility(authority, reference, intended_use)?;
        let entry = self
            .entries
            .get(&key(reference))
            .ok_or(AwarenessBufferError::Missing)?;
        if entry.reference != *reference {
            return Err(AwarenessBufferError::Binding);
        }
        Ok(sink(entry.payload.as_slice()))
    }

    /// Both host-time expiry and a monotonic elapsed-time ceiling drop raw bytes.
    /// Clock rollback cannot extend an existing entry; no canonical note changes.
    pub(crate) fn prune(&mut self, now: &CanonicalTimestamp) {
        self.entries.retain(|_, entry| {
            now < &entry.reference.expires_at && entry.admitted.elapsed() < entry.lifetime
        });
        self.bytes = self.entries.values().map(|entry| entry.payload.len()).sum();
    }

    /// Drop exactly the denied companion grant after its durable barrier commits.
    pub(crate) fn invalidate_grant(&mut self, owner: &Hex64, resident: &Hex64, grant: &OpaqueId) {
        self.entries.retain(|_, entry| {
            &entry.reference.owner_pubkey != owner
                || &entry.reference.resident_pubkey != resident
                || &entry.reference.grant_id != grant
        });
        self.bytes = self.entries.values().map(|entry| entry.payload.len()).sum();
    }

    /// Drop this owner's exact source/device after source-wide withdrawal.
    pub(crate) fn invalidate_source(
        &mut self,
        owner: &Hex64,
        source: &OpaqueId,
        device: &OpaqueId,
    ) {
        self.entries.retain(|_, entry| {
            &entry.reference.owner_pubkey != owner
                || &entry.reference.source_id != source
                || &entry.reference.device_id != device
        });
        self.bytes = self.entries.values().map(|entry| entry.payload.len()).sum();
    }

    /// Companion Pause can clear its ephemeral payloads without touching others.
    pub(crate) fn invalidate_resident(&mut self, owner: &Hex64, resident: &Hex64) {
        self.entries.retain(|_, entry| {
            &entry.reference.owner_pubkey != owner || &entry.reference.resident_pubkey != resident
        });
        self.bytes = self.entries.values().map(|entry| entry.payload.len()).sum();
    }
}
fn key(reference: &AwarenessObservationRefV1) -> Key {
    (
        reference.owner_pubkey.clone(),
        reference.resident_pubkey.clone(),
        reference.observation_id.clone(),
    )
}
