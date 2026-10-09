//! Private canonical carried-thread bodies, stored in existing resident continuity.
//!
//! This is semantic reference material, not an operational scheduler, a second
//! memory graph or a runtime grant. Bodies deliberately have no `Debug` and
//! cannot select a provider, model, tools, paths, grants or resource limits.
//! Journals are distinct authored works and are not used as carried threads.

use crate::{
    canonical_sha256, CanonicalTimestamp, Hex64, InitiativeDispositionV1, InitiativeThreadKindV1,
    OpaqueId, SafeU53, Sha256Ref,
};
use serde::{Deserialize, Deserializer, Serialize};

/// Version discriminator for one encrypted canonical initiative thread body.
pub const INITIATIVE_SEMANTIC_THREAD_PROTOCOL: &str = "polyphonic.initiative-thread.v1";
/// Maximum UTF-8 bytes in one canonical carried-thread body.
pub const MAX_INITIATIVE_THREAD_BODY_BYTES: usize = 4096;
/// Maximum provenance items of each class in one semantic revision.
pub const MAX_INITIATIVE_THREAD_SOURCES: usize = 16;

/// Body-free semantic contract failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum InitiativeThreadError {
    /// Wrong version or discriminator.
    #[error("initiative thread protocol is invalid")]
    Protocol,
    /// Exact principals or canonical thread identity do not agree.
    #[error("initiative thread binding is invalid")]
    Binding,
    /// The proposed semantic revision or creation timestamp does not agree.
    #[error("initiative thread revision is invalid or stale")]
    Revision,
    /// Body exceeds its bound or includes invalid control characters.
    #[error("initiative thread body is invalid")]
    Body,
    /// Provenance is empty, unordered, duplicated, oversized or inconsistent.
    #[error("initiative thread provenance is invalid")]
    Sources,
    /// Explicit disposition and deferral metadata do not agree.
    #[error("initiative thread disposition is invalid")]
    Disposition,
}

/// An immutable semantic revision in the exact resident-private namespace.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct InitiativeSemanticThreadV1 {
    /// Exact version discriminator.
    pub protocol: String,
    /// Stable canonical lineage root; not a latest-chat extraction identifier.
    pub thread_id: OpaqueId,
    /// Exact owner whose encrypted continuity holds the thread.
    pub owner_pubkey: Hex64,
    /// Exact chosen resident; independent of mutable runtime/model selection.
    pub resident_pubkey: Hex64,
    /// Shared commitment/inquiry or the resident's private curiosity.
    pub kind: InitiativeThreadKindV1,
    /// Explicit carried, deferred, declined, retired or completed disposition.
    pub disposition: InitiativeDispositionV1,
    /// Canonical semantic revision; initial zero matches the existing ledger.
    pub revision: SafeU53,
    /// Bounded untrusted semantic content, never executable authority.
    pub body: String,
    /// Sorted unique exact signed event identities independently verified by host.
    pub source_event_ids: Vec<Hex64>,
    /// Sorted unique general canonical/evidence refs, not claimed as signed events.
    /// Every signed event above must also have its `sha256:<event-id>` ref here.
    pub source_refs: Vec<Sha256Ref>,
    /// Present exactly when deferred; earliest eligibility, not a promise to run.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eligible_after: Option<CanonicalTimestamp>,
    /// Immutable creation timestamp of the canonical thread.
    pub created_at: CanonicalTimestamp,
    /// Timestamp of this explicitly authored semantic revision.
    pub updated_at: CanonicalTimestamp,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawThread {
    protocol: String,
    thread_id: OpaqueId,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    kind: InitiativeThreadKindV1,
    disposition: InitiativeDispositionV1,
    revision: SafeU53,
    body: String,
    source_event_ids: Vec<Hex64>,
    source_refs: Vec<Sha256Ref>,
    eligible_after: Option<CanonicalTimestamp>,
    created_at: CanonicalTimestamp,
    updated_at: CanonicalTimestamp,
}

impl<'de> Deserialize<'de> for InitiativeSemanticThreadV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawThread::deserialize(deserializer)?;
        let value = Self {
            protocol: raw.protocol,
            thread_id: raw.thread_id,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            kind: raw.kind,
            disposition: raw.disposition,
            revision: raw.revision,
            body: raw.body,
            source_event_ids: raw.source_event_ids,
            source_refs: raw.source_refs,
            eligible_after: raw.eligible_after,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}

impl InitiativeSemanticThreadV1 {
    /// Validate shape and provenance without granting retention or execution.
    pub fn validate(&self) -> Result<(), InitiativeThreadError> {
        if self.protocol != INITIATIVE_SEMANTIC_THREAD_PROTOCOL {
            return Err(InitiativeThreadError::Protocol);
        }
        if self.owner_pubkey == self.resident_pubkey {
            return Err(InitiativeThreadError::Binding);
        }
        if self.body.trim().is_empty()
            || self.body.trim() != self.body
            || self.body.len() > MAX_INITIATIVE_THREAD_BODY_BYTES
            || self
                .body
                .chars()
                .any(|c| c.is_control() && c != '\n' && c != '\t')
        {
            return Err(InitiativeThreadError::Body);
        }
        if self.source_refs.is_empty()
            || self.source_refs.len() > MAX_INITIATIVE_THREAD_SOURCES
            || self.source_event_ids.len() > MAX_INITIATIVE_THREAD_SOURCES
            || self.source_refs.windows(2).any(|pair| pair[0] >= pair[1])
            || self
                .source_event_ids
                .windows(2)
                .any(|pair| pair[0] >= pair[1])
        {
            return Err(InitiativeThreadError::Sources);
        }
        for event in &self.source_event_ids {
            let reference = Sha256Ref::parse(format!("sha256:{}", event.as_str()))
                .map_err(|_| InitiativeThreadError::Sources)?;
            if self.source_refs.binary_search(&reference).is_err() {
                return Err(InitiativeThreadError::Sources);
            }
        }
        if self.created_at > self.updated_at {
            return Err(InitiativeThreadError::Revision);
        }
        if (self.disposition == InitiativeDispositionV1::Deferred) != self.eligible_after.is_some()
            || self
                .eligible_after
                .as_ref()
                .is_some_and(|after| after <= &self.updated_at)
        {
            return Err(InitiativeThreadError::Disposition);
        }
        Ok(())
    }

    /// Correlate a successor to one exact canonical semantic head.
    ///
    /// Authenticated actor, owner-correction precedence and disposition authority
    /// remain the host's separate checks; this method cannot authorize a writer.
    pub fn validate_successor_of(&self, current: &Self) -> Result<(), InitiativeThreadError> {
        self.validate()?;
        current.validate()?;
        if self.owner_pubkey != current.owner_pubkey
            || self.resident_pubkey != current.resident_pubkey
            || self.thread_id != current.thread_id
            || self.kind != current.kind
        {
            return Err(InitiativeThreadError::Binding);
        }
        if current.revision.get().checked_add(1) != Some(self.revision.get())
            || self.created_at != current.created_at
            || self.updated_at < current.updated_at
        {
            return Err(InitiativeThreadError::Revision);
        }
        Ok(())
    }

    /// Stable content-bound semantic revision reference independent of ciphertext.
    pub fn revision_ref(&self) -> Result<Sha256Ref, InitiativeThreadError> {
        self.validate()?;
        let digest = canonical_sha256(&serde_json::json!({
            "domain": "polyphonic.initiative-thread.semantic-revision.v1",
            "thread": self,
        }))
        .map_err(|_| InitiativeThreadError::Revision)?;
        Sha256Ref::parse(format!("sha256:{digest}")).map_err(|_| InitiativeThreadError::Revision)
    }
}

/// Stable canonical thread identity reference, not a namespace or read grant.
pub fn derive_initiative_thread_ref(
    owner_pubkey: &Hex64,
    resident_pubkey: &Hex64,
    thread_id: &OpaqueId,
) -> Result<Sha256Ref, InitiativeThreadError> {
    if owner_pubkey == resident_pubkey {
        return Err(InitiativeThreadError::Binding);
    }
    let digest = canonical_sha256(&serde_json::json!({
        "domain": "polyphonic.initiative-thread.identity.v1",
        "owner_pubkey": owner_pubkey,
        "resident_pubkey": resident_pubkey,
        "thread_id": thread_id,
    }))
    .map_err(|_| InitiativeThreadError::Binding)?;
    Sha256Ref::parse(format!("sha256:{digest}")).map_err(|_| InitiativeThreadError::Binding)
}
