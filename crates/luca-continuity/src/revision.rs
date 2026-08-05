//! Append-only, encrypted-body-blind continuity revision lifecycle.
//!
//! This module deliberately treats encrypted record envelopes as opaque. It
//! establishes deterministic lineage, authority, lifecycle, and purge-plan
//! semantics without decrypting, indexing, persisting, or deleting content.

use crate::{envelope::validate_envelope, ContinuityError};
use luca_protocol::{
    canonicalize, ContinuityNamespaceV1, ContinuityRecordV1, ContinuityScopeV1, OpaqueId, SafeU53,
    Sha256Ref,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fmt;

const REVISION_IDEMPOTENCY_DOMAIN_V1: &str = "luca.continuity.revision.idempotency.v1";
const ENCRYPTED_RECORD_REFERENCE_DOMAIN_V1: &str = "luca.continuity.encrypted-record-ref.v1";
const ARTIFACT_REGISTRATION_IDEMPOTENCY_DOMAIN_V1: &str =
    "luca.continuity.artifact-registration.idempotency.v1";

/// Schema version of the body-free revision-authority projection.
pub const REVISION_AUTHORITY_SCHEMA_V1: u16 = 1;
/// Maximum lineage-authority rows returned by one deterministic projection.
pub const MAX_REVISION_AUTHORITY_HEADS: usize = 4_096;
/// Maximum derived-artifact references retained by one lineage.
pub const MAX_DERIVED_ARTIFACTS_PER_LINEAGE: usize = 256;
/// Maximum derived-artifact references retained by one complete ledger.
pub const MAX_DERIVED_ARTIFACTS_PER_LEDGER: usize = 16_384;

/// The operational retrieval state of one immutable record lineage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RevisionLifecycle {
    /// The current head is eligible for normal retrieval.
    Active,
    /// History remains available for owner inspection but is not retrieval eligible.
    Archived,
    /// The lineage is terminal and has a deterministic purge plan.
    Forgotten,
}

/// One append-only lifecycle operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RevisionOperation {
    /// Establish a revision-zero lineage.
    Create,
    /// Append a normal successor to an active lineage.
    Revise,
    /// Append an explicit owner-authored correction and pin it.
    OwnerCorrection,
    /// Append a new successor sourced from an earlier revision.
    Rollback,
    /// Retire an active lineage from retrieval without deleting history.
    Archive,
    /// Terminally schedule a complete lineage for purge.
    Forget,
}

/// Stable, non-prose authority category for a lifecycle operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RevisionActor {
    /// The cryptographic owner explicitly initiated the operation.
    Owner,
    /// The resident runtime authored an allowed continuity successor.
    Resident,
    /// Deterministic trusted-desktop maintenance initiated the operation.
    System,
    /// A bounded automatic continuity job initiated the operation.
    Automatic,
}

impl RevisionActor {
    fn required_author_kind(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Resident => "resident",
            Self::System => "system",
            Self::Automatic => "automatic",
        }
    }
}

/// Closed set of durable record kinds permitted by the G2 continuity kernel.
///
/// This is an exact, case-sensitive machine allowlist. Content-level screening
/// for sensitive profiling or psychometric inference must happen before
/// encryption; K05 is encrypted-body-blind and cannot claim semantic inspection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DurableContinuityRecordKind {
    /// Compact state needed to hand work into a fresh runtime session.
    Handoff,
    /// An unresolved question or task carried across turns.
    OpenThread,
    /// A durable commitment made by the owner or resident.
    Commitment,
    /// An explicitly supported preference.
    Preference,
    /// Resident-private notebook material.
    Hypomnema,
    /// Resident-private journal material.
    Journal,
    /// Resident-authored bounded reflection.
    Reflection,
    /// Associative resident-private memory.
    AssociativeEngram,
    /// Typed source-backed connection between records.
    TypedConnection,
    /// High-evidence identity continuity state.
    Identity,
    /// High-evidence relationship continuity state.
    Relationship,
    /// High-evidence conviction continuity state.
    Conviction,
}

impl DurableContinuityRecordKind {
    /// Parse one exact durable record type; aliases and case variants fail closed.
    pub fn parse(record_type: &OpaqueId) -> Result<Self, ContinuityError> {
        match record_type.as_str() {
            "handoff" => Ok(Self::Handoff),
            "open-thread" => Ok(Self::OpenThread),
            "commitment" => Ok(Self::Commitment),
            "preference" => Ok(Self::Preference),
            "hypomnema" => Ok(Self::Hypomnema),
            "journal" => Ok(Self::Journal),
            "reflection" => Ok(Self::Reflection),
            "associative-engram" => Ok(Self::AssociativeEngram),
            "typed-connection" => Ok(Self::TypedConnection),
            "identity" => Ok(Self::Identity),
            "relationship" => Ok(Self::Relationship),
            "conviction" => Ok(Self::Conviction),
            _ => Err(ContinuityError::UnsupportedRecordType),
        }
    }
}

/// A body-free reference to a deterministic encrypted envelope representation.
#[derive(Serialize)]
struct EncryptedRecordReference<'a> {
    domain: &'static str,
    record: &'a ContinuityRecordV1,
}

/// Return the canonical body-free reference expected for an encrypted successor.
pub fn encrypted_record_reference(
    record: &ContinuityRecordV1,
) -> Result<Sha256Ref, ContinuityError> {
    let bytes = canonicalize(&EncryptedRecordReference {
        domain: ENCRYPTED_RECORD_REFERENCE_DOMAIN_V1,
        record,
    })
    .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
    Sha256Ref::parse(format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
        .map_err(|_| ContinuityError::InvalidRevisionRequest)
}

/// Request to apply exactly one body-blind lifecycle operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RevisionRequest {
    /// Domain-derived key for the complete canonical operation binding.
    pub idempotency_key: Sha256Ref,
    /// Requested immutable lifecycle operation.
    pub operation: RevisionOperation,
    /// Immutable lineage root identifier; create uses its successor's identifier.
    pub lineage_root_id: OpaqueId,
    /// Head observed by the caller; this makes idempotent replay stable after append.
    pub expected_head_record_id: Option<OpaqueId>,
    /// Actor authority initiating the operation.
    pub actor: RevisionActor,
    /// Sorted unique signed source-event references supporting the operation.
    pub signed_source_event_refs: Vec<Sha256Ref>,
    /// Body-free request correlation reference supplied by the caller.
    pub request_ref: Sha256Ref,
    /// Newly encrypted successor for create, revise, correction, or rollback.
    pub successor: Option<ContinuityRecordV1>,
    /// Canonical reference to the supplied encrypted successor.
    pub successor_ciphertext_ref: Option<Sha256Ref>,
    /// Named historical revision used by a rollback operation.
    pub rollback_source_record_id: Option<OpaqueId>,
    /// Sorted unique body-free artifacts derived from this lineage for forget.
    pub derived_artifact_refs: Vec<Sha256Ref>,
}

/// Derive the exact domain-separated idempotency key for one operation.
///
/// Callers must provide the exact currently authorized lineage binding. The
/// ledger independently verifies that binding before allowing a first apply.
pub fn derive_revision_idempotency_key(
    namespace: &ContinuityNamespaceV1,
    scope: &ContinuityScopeV1,
    record_type: &OpaqueId,
    key_version: SafeU53,
    request: &RevisionRequest,
) -> Result<Sha256Ref, ContinuityError> {
    let canonical = canonical_idempotency_binding(
        namespace,
        scope,
        record_type,
        key_version,
        request.expected_head_record_id.as_ref(),
        request,
    )?;
    Sha256Ref::parse(format!("sha256:{}", hex::encode(Sha256::digest(canonical))))
        .map_err(|_| ContinuityError::InvalidRevisionRequest)
}

/// A body-free deterministic plan for later physical purge executors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PurgePlan {
    /// Terminal lineage root scheduled for purge.
    pub lineage_root_id: OpaqueId,
    /// Entire immutable lineage in revision order.
    pub record_ids: Vec<OpaqueId>,
    /// Sorted unique references from the lineage's authoritative artifact inventory.
    pub derived_artifact_refs: Vec<Sha256Ref>,
}

/// Body-free result of idempotently extending one lineage's artifact inventory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactRegistrationReceipt {
    /// Exact lineage receiving derived artifact references.
    pub lineage_root_id: OpaqueId,
    /// Newly retained references from this call, in canonical order.
    pub newly_registered: Vec<Sha256Ref>,
    /// Complete authoritative append-only inventory after this call.
    pub complete_inventory: Vec<Sha256Ref>,
}

#[derive(Serialize)]
struct CanonicalArtifactRegistrationBinding<'a> {
    domain: &'static str,
    namespace: &'a ContinuityNamespaceV1,
    scope: &'a ContinuityScopeV1,
    record_type: &'a OpaqueId,
    lineage_envelope_key_version: SafeU53,
    lineage_root_id: &'a OpaqueId,
    expected_head_record_id: &'a OpaqueId,
    request_ref: &'a Sha256Ref,
    derived_artifact_refs: &'a [Sha256Ref],
}

/// A body-free receipt retained for idempotent replay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RevisionReceipt {
    /// Root of the affected lineage.
    pub lineage_root_id: OpaqueId,
    /// Applied operation.
    pub operation: RevisionOperation,
    /// Lifecycle state after the operation.
    pub lifecycle: RevisionLifecycle,
    /// Current immutable head, absent after terminal forget.
    pub head_record_id: Option<OpaqueId>,
    /// Deterministic terminal purge plan when the operation forgot a lineage.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purge_plan: Option<PurgePlan>,
}

/// Body-free authoritative state for one known immutable record lineage.
///
/// This projection deliberately distinguishes the lineage's exact last head
/// from the head eligible for retrieval. Archived and forgotten lineages keep
/// their explicit lifecycle authority while exposing no active head; callers
/// must never reconstruct either value from revision ordering.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ActiveRevisionHead {
    /// Version of this body-free authority projection.
    pub schema_version: u16,
    /// Exact owner/resident namespace authority for the lineage.
    pub namespace: ContinuityNamespaceV1,
    /// Exact source, project, room, and conversation binding for the lineage.
    pub scope: ContinuityScopeV1,
    /// Immutable lineage root identifier.
    pub lineage_root_id: OpaqueId,
    /// Exact last immutable head retained by the lineage lifecycle.
    pub lineage_head_record_id: OpaqueId,
    /// Retrieval-eligible head, present only while the lifecycle is active.
    pub active_head_record_id: Option<OpaqueId>,
    /// Explicit lifecycle authority; never inferred from envelope order.
    pub lifecycle: RevisionLifecycle,
    /// Whether an owner correction currently pins successor authority.
    pub pinned_owner_correction: bool,
    /// Exact durable record kind shared by the complete lineage.
    pub record_type: OpaqueId,
    /// Envelope key version authenticated by every retained lineage record.
    ///
    /// This is not K06's globally active root-key version. Rotation or restore
    /// must reconcile it through an authenticated desktop transaction before
    /// hydration; the pure ledger never infers or advances it.
    pub lineage_envelope_key_version: SafeU53,
    /// Complete sorted body-free derived-artifact inventory.
    pub derived_artifact_refs: Vec<Sha256Ref>,
    /// Idempotency key of the exact authority mutation producing this state.
    pub authority_mutation_idempotency_key: Sha256Ref,
}

#[derive(Serialize)]
struct CanonicalIdempotencyBinding<'a> {
    domain: &'static str,
    namespace: &'a ContinuityNamespaceV1,
    scope: &'a ContinuityScopeV1,
    record_type: &'a OpaqueId,
    key_version: SafeU53,
    current_head_record_id: Option<&'a OpaqueId>,
    operation: RevisionOperation,
    successor: Option<&'a ContinuityRecordV1>,
    successor_ciphertext_ref: Option<&'a Sha256Ref>,
    rollback_source_record_id: Option<&'a OpaqueId>,
    actor: RevisionActor,
    successor_author_kind: Option<&'a OpaqueId>,
    signed_source_event_refs: &'a [Sha256Ref],
    request_ref: &'a Sha256Ref,
    derived_artifact_refs: &'a [Sha256Ref],
}

#[derive(Debug, Clone)]
struct IdempotencyEntry {
    canonical_request: Vec<u8>,
    receipt: RevisionReceipt,
}

#[derive(Debug, Clone)]
struct ArtifactIdempotencyEntry {
    canonical_request: Vec<u8>,
    receipt: ArtifactRegistrationReceipt,
}

#[derive(Debug, Clone)]
struct Lineage {
    lineage_root_id: OpaqueId,
    namespace: ContinuityNamespaceV1,
    scope: ContinuityScopeV1,
    record_type: OpaqueId,
    lineage_envelope_key_version: SafeU53,
    record_ids: Vec<OpaqueId>,
    head_record_id: OpaqueId,
    lifecycle: RevisionLifecycle,
    pinned_owner_correction: bool,
    derived_artifact_inventory: Vec<Sha256Ref>,
    authority_mutation_idempotency_key: Sha256Ref,
}

/// Pure in-memory append-only encrypted-record lifecycle ledger.
#[derive(Default)]
pub struct RevisionLedger {
    records: BTreeMap<String, ContinuityRecordV1>,
    lineages: BTreeMap<String, Lineage>,
    idempotency: BTreeMap<String, IdempotencyEntry>,
    artifact_idempotency: BTreeMap<String, ArtifactIdempotencyEntry>,
}

impl fmt::Debug for RevisionLedger {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let lifecycles: Vec<_> = self
            .lineages
            .iter()
            .map(|(root, lineage)| (root, lineage.lifecycle, lineage.record_ids.len()))
            .collect();
        formatter
            .debug_struct("RevisionLedger")
            .field("lineages", &lifecycles)
            .field("record_count", &self.records.len())
            .field("idempotency_receipt_count", &self.idempotency.len())
            .field(
                "artifact_idempotency_receipt_count",
                &self.artifact_idempotency.len(),
            )
            .finish()
    }
}

impl RevisionLedger {
    /// Apply one operation atomically, returning its original receipt on exact replay.
    pub fn apply(&mut self, request: RevisionRequest) -> Result<RevisionReceipt, ContinuityError> {
        self.validate_request_shape(&request)?;
        let key = request.idempotency_key.as_str().to_owned();
        if let Some(existing) = self.idempotency.get(&key) {
            let canonical = self.canonical_for_existing_or_create(&request)?;
            return if existing.canonical_request == canonical {
                Ok(existing.receipt.clone())
            } else {
                Err(ContinuityError::IdempotencyConflict)
            };
        }

        let canonical = self.canonical_for_existing_or_create(&request)?;
        let expected_key = self.derive_request_key(&request)?;
        if request.idempotency_key != expected_key {
            return Err(ContinuityError::InvalidRevisionRequest);
        }
        let receipt = match request.operation {
            RevisionOperation::Create => self.create(&request)?,
            RevisionOperation::Revise => self.append_successor(&request, false, None)?,
            RevisionOperation::OwnerCorrection => self.append_successor(&request, true, None)?,
            RevisionOperation::Rollback => {
                self.append_successor(&request, false, request.rollback_source_record_id.as_ref())?
            }
            RevisionOperation::Archive => self.archive(&request)?,
            RevisionOperation::Forget => self.forget(&request)?,
        };
        self.idempotency.insert(
            key,
            IdempotencyEntry {
                canonical_request: canonical,
                receipt: receipt.clone(),
            },
        );
        Ok(receipt)
    }

    /// Return whether the exact lineage is currently eligible for retrieval.
    pub fn retrieval_eligible(&self, lineage_root_id: &OpaqueId) -> bool {
        self.lineage(lineage_root_id)
            .is_some_and(|lineage| lineage.lifecycle == RevisionLifecycle::Active)
    }

    /// Return immutable encrypted history for owner-facing inspection, never forgotten data.
    pub fn history(&self, lineage_root_id: &OpaqueId) -> Vec<ContinuityRecordV1> {
        let Some(lineage) = self.lineage(lineage_root_id) else {
            return Vec::new();
        };
        if lineage.lifecycle == RevisionLifecycle::Forgotten {
            return Vec::new();
        }
        lineage
            .record_ids
            .iter()
            .filter_map(|id| self.records.get(id.as_str()).cloned())
            .collect()
    }

    /// Return the current encrypted head only when it remains retrieval eligible.
    pub fn active_head(&self, lineage_root_id: &OpaqueId) -> Option<&ContinuityRecordV1> {
        let lineage = self.lineage(lineage_root_id)?;
        (lineage.lifecycle == RevisionLifecycle::Active)
            .then(|| self.records.get(lineage.head_record_id.as_str()))
            .flatten()
    }

    /// Return the body-free lifecycle state for one known lineage.
    pub fn lifecycle(&self, lineage_root_id: &OpaqueId) -> Option<RevisionLifecycle> {
        self.lineage(lineage_root_id)
            .map(|lineage| lineage.lifecycle)
    }

    /// Return a bounded, stable-ID-ordered authority projection for every lineage.
    ///
    /// Archived and forgotten lineages remain in the projection with an absent
    /// `active_head_record_id`, preventing restart code from resurrecting a
    /// ciphertext merely because it has the largest revision number.
    pub fn active_heads(&self) -> Result<Vec<ActiveRevisionHead>, ContinuityError> {
        if self.lineages.len() > MAX_REVISION_AUTHORITY_HEADS {
            return Err(ContinuityError::InvalidRevisionRequest);
        }
        self.validate_artifact_authority_bounds()?;
        if self
            .lineages
            .values()
            .any(|lineage| lineage.namespace.key_version != lineage.lineage_envelope_key_version)
        {
            return Err(ContinuityError::RevisionConflict);
        }

        Ok(self
            .lineages
            .values()
            .map(|lineage| ActiveRevisionHead {
                schema_version: REVISION_AUTHORITY_SCHEMA_V1,
                namespace: lineage.namespace.clone(),
                scope: lineage.scope.clone(),
                lineage_root_id: lineage.lineage_root_id.clone(),
                lineage_head_record_id: lineage.head_record_id.clone(),
                active_head_record_id: (lineage.lifecycle == RevisionLifecycle::Active)
                    .then(|| lineage.head_record_id.clone()),
                lifecycle: lineage.lifecycle,
                pinned_owner_correction: lineage.pinned_owner_correction,
                record_type: lineage.record_type.clone(),
                lineage_envelope_key_version: lineage.lineage_envelope_key_version,
                derived_artifact_refs: lineage.derived_artifact_inventory.clone(),
                authority_mutation_idempotency_key: lineage
                    .authority_mutation_idempotency_key
                    .clone(),
            })
            .collect())
    }

    /// Verify one lineage's authenticated envelope key version without rekeying it.
    ///
    /// K06 rotation and restore own envelope replacement and generation CAS.
    /// They must rebuild or hydrate revision authority from one authenticated
    /// generation. A mismatch fails closed here; this method never guesses,
    /// advances, or mutates key-version authority.
    pub fn verify_lineage_envelope_key_version(
        &self,
        lineage_root_id: &OpaqueId,
        authenticated_envelope_key_version: SafeU53,
    ) -> Result<(), ContinuityError> {
        let lineage = self
            .lineage(lineage_root_id)
            .ok_or(ContinuityError::RevisionConflict)?;
        if lineage.lineage_envelope_key_version != authenticated_envelope_key_version
            || lineage.namespace.key_version != lineage.lineage_envelope_key_version
        {
            return Err(ContinuityError::RevisionConflict);
        }
        Ok(())
    }

    /// Derive the domain-separated idempotency key for one artifact mutation.
    pub fn derive_artifact_registration_idempotency_key(
        &self,
        lineage_root_id: &OpaqueId,
        expected_head_record_id: &OpaqueId,
        request_ref: &Sha256Ref,
        artifacts: &[Sha256Ref],
    ) -> Result<Sha256Ref, ContinuityError> {
        require_bounded_sorted_unique_artifacts(artifacts)?;
        if artifacts.is_empty() {
            return Err(ContinuityError::InvalidRevisionRequest);
        }
        let canonical = self.canonical_artifact_registration_binding(
            lineage_root_id,
            expected_head_record_id,
            request_ref,
            artifacts,
        )?;
        Sha256Ref::parse(format!("sha256:{}", hex::encode(Sha256::digest(canonical))))
            .map_err(|_| ContinuityError::InvalidRevisionRequest)
    }

    /// Idempotently append body-free derived artifacts to one exact lineage.
    ///
    /// References are never removed. Forget must later present the exact full
    /// inventory so incomplete or injected purge targets fail atomically.
    pub fn register_derived_artifacts(
        &mut self,
        idempotency_key: Sha256Ref,
        request_ref: Sha256Ref,
        lineage_root_id: &OpaqueId,
        expected_head_record_id: &OpaqueId,
        artifacts: Vec<Sha256Ref>,
    ) -> Result<ArtifactRegistrationReceipt, ContinuityError> {
        require_bounded_sorted_unique_artifacts(&artifacts)?;
        if artifacts.is_empty() {
            return Err(ContinuityError::InvalidRevisionRequest);
        }
        let canonical = self.canonical_artifact_registration_binding(
            lineage_root_id,
            expected_head_record_id,
            &request_ref,
            &artifacts,
        )?;
        if let Some(existing) = self.artifact_idempotency.get(idempotency_key.as_str()) {
            return if existing.canonical_request == canonical {
                Ok(existing.receipt.clone())
            } else {
                Err(ContinuityError::IdempotencyConflict)
            };
        }
        let expected_key = Sha256Ref::parse(format!(
            "sha256:{}",
            hex::encode(Sha256::digest(&canonical))
        ))
        .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
        if idempotency_key != expected_key {
            return Err(ContinuityError::InvalidRevisionRequest);
        }

        let aggregate_count = self.validate_artifact_authority_bounds()?;
        let lineage = self
            .lineage(lineage_root_id)
            .ok_or(ContinuityError::RevisionConflict)?;
        if &lineage.head_record_id != expected_head_record_id {
            return Err(ContinuityError::RevisionConflict);
        }
        if lineage.lifecycle == RevisionLifecycle::Forgotten {
            return Err(ContinuityError::LifecycleConflict);
        }
        let new_count = artifacts
            .iter()
            .filter(|artifact| !lineage.derived_artifact_inventory.contains(artifact))
            .count();
        if new_count == 0 {
            return Err(ContinuityError::InvalidRevisionRequest);
        }
        let next_lineage_count = lineage
            .derived_artifact_inventory
            .len()
            .checked_add(new_count)
            .ok_or(ContinuityError::InvalidRevisionRequest)?;
        let next_aggregate_count = aggregate_count
            .checked_add(new_count)
            .ok_or(ContinuityError::InvalidRevisionRequest)?;
        if next_lineage_count > MAX_DERIVED_ARTIFACTS_PER_LINEAGE
            || next_aggregate_count > MAX_DERIVED_ARTIFACTS_PER_LEDGER
        {
            return Err(ContinuityError::InvalidRevisionRequest);
        }

        let lineage = self
            .lineage_mut(lineage_root_id)
            .ok_or(ContinuityError::RevisionConflict)?;
        let newly_registered: Vec<_> = artifacts
            .iter()
            .filter(|artifact| !lineage.derived_artifact_inventory.contains(artifact))
            .cloned()
            .collect();
        lineage
            .derived_artifact_inventory
            .extend(newly_registered.iter().cloned());
        lineage.derived_artifact_inventory.sort();
        lineage.authority_mutation_idempotency_key = idempotency_key.clone();
        let receipt = ArtifactRegistrationReceipt {
            lineage_root_id: lineage_root_id.clone(),
            newly_registered,
            complete_inventory: lineage.derived_artifact_inventory.clone(),
        };
        self.artifact_idempotency.insert(
            idempotency_key.as_str().to_owned(),
            ArtifactIdempotencyEntry {
                canonical_request: canonical,
                receipt: receipt.clone(),
            },
        );
        Ok(receipt)
    }

    fn canonical_artifact_registration_binding(
        &self,
        lineage_root_id: &OpaqueId,
        expected_head_record_id: &OpaqueId,
        request_ref: &Sha256Ref,
        artifacts: &[Sha256Ref],
    ) -> Result<Vec<u8>, ContinuityError> {
        let lineage = self
            .lineage(lineage_root_id)
            .ok_or(ContinuityError::RevisionConflict)?;
        canonicalize(&CanonicalArtifactRegistrationBinding {
            domain: ARTIFACT_REGISTRATION_IDEMPOTENCY_DOMAIN_V1,
            namespace: &lineage.namespace,
            scope: &lineage.scope,
            record_type: &lineage.record_type,
            lineage_envelope_key_version: lineage.lineage_envelope_key_version,
            lineage_root_id,
            expected_head_record_id,
            request_ref,
            derived_artifact_refs: artifacts,
        })
        .map_err(|_| ContinuityError::InvalidRevisionRequest)
    }

    fn validate_artifact_authority_bounds(&self) -> Result<usize, ContinuityError> {
        self.lineages.values().try_fold(0_usize, |total, lineage| {
            if lineage.derived_artifact_inventory.len() > MAX_DERIVED_ARTIFACTS_PER_LINEAGE {
                return Err(ContinuityError::InvalidRevisionRequest);
            }
            require_sorted_unique(&lineage.derived_artifact_inventory)?;
            total
                .checked_add(lineage.derived_artifact_inventory.len())
                .filter(|next| *next <= MAX_DERIVED_ARTIFACTS_PER_LEDGER)
                .ok_or(ContinuityError::InvalidRevisionRequest)
        })
    }

    fn lineage(&self, lineage_root_id: &OpaqueId) -> Option<&Lineage> {
        self.lineages.get(lineage_root_id.as_str())
    }

    fn lineage_mut(&mut self, lineage_root_id: &OpaqueId) -> Option<&mut Lineage> {
        self.lineages.get_mut(lineage_root_id.as_str())
    }

    fn validate_request_shape(&self, request: &RevisionRequest) -> Result<(), ContinuityError> {
        require_sorted_unique(&request.signed_source_event_refs)?;
        require_bounded_sorted_unique_artifacts(&request.derived_artifact_refs)?;
        match request.operation {
            RevisionOperation::Create
            | RevisionOperation::Revise
            | RevisionOperation::OwnerCorrection
            | RevisionOperation::Rollback => {
                let successor = request
                    .successor
                    .as_ref()
                    .ok_or(ContinuityError::InvalidRevisionRequest)?;
                successor
                    .validate()
                    .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
                validate_envelope(successor)
                    .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
                let expected_ref = encrypted_record_reference(successor)?;
                if request.successor_ciphertext_ref.as_ref() != Some(&expected_ref)
                    || successor.author_kind.as_str() != request.actor.required_author_kind()
                    || (request.operation == RevisionOperation::Rollback)
                        != request.rollback_source_record_id.is_some()
                    || (request.operation != RevisionOperation::Forget
                        && !request.derived_artifact_refs.is_empty())
                {
                    return Err(ContinuityError::InvalidRevisionRequest);
                }
            }
            RevisionOperation::Archive => {
                if request.successor.is_some()
                    || request.successor_ciphertext_ref.is_some()
                    || request.rollback_source_record_id.is_some()
                    || !request.derived_artifact_refs.is_empty()
                {
                    return Err(ContinuityError::InvalidRevisionRequest);
                }
            }
            RevisionOperation::Forget => {
                if request.successor.is_some()
                    || request.successor_ciphertext_ref.is_some()
                    || request.rollback_source_record_id.is_some()
                {
                    return Err(ContinuityError::InvalidRevisionRequest);
                }
            }
        }
        Ok(())
    }

    fn canonical_for_existing_or_create(
        &self,
        request: &RevisionRequest,
    ) -> Result<Vec<u8>, ContinuityError> {
        let (namespace, scope, record_type, key_version) =
            if request.operation == RevisionOperation::Create {
                let successor = request
                    .successor
                    .as_ref()
                    .ok_or(ContinuityError::InvalidRevisionRequest)?;
                (
                    &successor.namespace,
                    &successor.scope,
                    &successor.record_type,
                    successor.key_version,
                )
            } else {
                let lineage = self
                    .lineage(&request.lineage_root_id)
                    .ok_or(ContinuityError::RevisionConflict)?;
                (
                    &lineage.namespace,
                    &lineage.scope,
                    &lineage.record_type,
                    lineage.lineage_envelope_key_version,
                )
            };
        canonical_idempotency_binding(
            namespace,
            scope,
            record_type,
            key_version,
            request.expected_head_record_id.as_ref(),
            request,
        )
    }

    fn derive_request_key(&self, request: &RevisionRequest) -> Result<Sha256Ref, ContinuityError> {
        if request.operation == RevisionOperation::Create {
            let successor = request
                .successor
                .as_ref()
                .ok_or(ContinuityError::InvalidRevisionRequest)?;
            derive_revision_idempotency_key(
                &successor.namespace,
                &successor.scope,
                &successor.record_type,
                successor.key_version,
                request,
            )
        } else {
            let lineage = self
                .lineage(&request.lineage_root_id)
                .ok_or(ContinuityError::RevisionConflict)?;
            derive_revision_idempotency_key(
                &lineage.namespace,
                &lineage.scope,
                &lineage.record_type,
                lineage.lineage_envelope_key_version,
                request,
            )
        }
    }
}

fn canonical_idempotency_binding(
    namespace: &ContinuityNamespaceV1,
    scope: &ContinuityScopeV1,
    record_type: &OpaqueId,
    key_version: SafeU53,
    current_head_record_id: Option<&OpaqueId>,
    request: &RevisionRequest,
) -> Result<Vec<u8>, ContinuityError> {
    canonicalize(&CanonicalIdempotencyBinding {
        domain: REVISION_IDEMPOTENCY_DOMAIN_V1,
        namespace,
        scope,
        record_type,
        key_version,
        current_head_record_id,
        operation: request.operation,
        successor: request.successor.as_ref(),
        successor_ciphertext_ref: request.successor_ciphertext_ref.as_ref(),
        rollback_source_record_id: request.rollback_source_record_id.as_ref(),
        actor: request.actor,
        successor_author_kind: request.successor.as_ref().map(|record| &record.author_kind),
        signed_source_event_refs: &request.signed_source_event_refs,
        request_ref: &request.request_ref,
        derived_artifact_refs: &request.derived_artifact_refs,
    })
    .map_err(|_| ContinuityError::InvalidRevisionRequest)
}

impl RevisionLedger {
    fn create(&mut self, request: &RevisionRequest) -> Result<RevisionReceipt, ContinuityError> {
        let successor = request
            .successor
            .as_ref()
            .ok_or(ContinuityError::InvalidRevisionRequest)?;
        if request.lineage_root_id != successor.record_id
            || request.expected_head_record_id.is_some()
            || successor.revision.get() != 0
            || successor.predecessor_record_id.is_some()
            || self.lineage(&request.lineage_root_id).is_some()
            || self.records.contains_key(successor.record_id.as_str())
        {
            return Err(ContinuityError::RevisionConflict);
        }
        if self.lineages.len() >= MAX_REVISION_AUTHORITY_HEADS {
            return Err(ContinuityError::InvalidRevisionRequest);
        }
        DurableContinuityRecordKind::parse(&successor.record_type)?;
        self.require_unique_namespace_nonce(successor)?;
        let root = request.lineage_root_id.clone();
        let head = successor.record_id.clone();
        self.records
            .insert(head.as_str().to_owned(), successor.clone());
        self.lineages.insert(
            root.as_str().to_owned(),
            Lineage {
                lineage_root_id: root.clone(),
                namespace: successor.namespace.clone(),
                scope: successor.scope.clone(),
                record_type: successor.record_type.clone(),
                lineage_envelope_key_version: successor.key_version,
                record_ids: vec![head.clone()],
                head_record_id: head.clone(),
                lifecycle: RevisionLifecycle::Active,
                pinned_owner_correction: false,
                derived_artifact_inventory: Vec::new(),
                authority_mutation_idempotency_key: request.idempotency_key.clone(),
            },
        );
        Ok(RevisionReceipt {
            lineage_root_id: root,
            operation: RevisionOperation::Create,
            lifecycle: RevisionLifecycle::Active,
            head_record_id: Some(head),
            purge_plan: None,
        })
    }

    fn append_successor(
        &mut self,
        request: &RevisionRequest,
        owner_correction: bool,
        rollback_source: Option<&OpaqueId>,
    ) -> Result<RevisionReceipt, ContinuityError> {
        let successor = request
            .successor
            .as_ref()
            .ok_or(ContinuityError::InvalidRevisionRequest)?;
        let lineage = self
            .lineage(&request.lineage_root_id)
            .ok_or(ContinuityError::RevisionConflict)?;
        if request.expected_head_record_id.as_ref() != Some(&lineage.head_record_id) {
            return Err(ContinuityError::RevisionConflict);
        }
        if lineage.lifecycle == RevisionLifecycle::Forgotten {
            return Err(ContinuityError::LifecycleConflict);
        }
        if lineage.lifecycle == RevisionLifecycle::Archived
            && !(request.operation == RevisionOperation::Rollback
                && request.actor == RevisionActor::Owner)
        {
            return Err(ContinuityError::LifecycleConflict);
        }
        if owner_correction && request.actor != RevisionActor::Owner {
            return Err(ContinuityError::LifecycleConflict);
        }
        if request.operation == RevisionOperation::Rollback && request.actor != RevisionActor::Owner
        {
            return Err(ContinuityError::LifecycleConflict);
        }
        if lineage.pinned_owner_correction && !owner_correction {
            return Err(ContinuityError::PinnedOwnerCorrection);
        }
        if let Some(rollback_source) = rollback_source {
            let source = self
                .records
                .get(rollback_source.as_str())
                .ok_or(ContinuityError::RevisionConflict)?;
            if !lineage.record_ids.contains(rollback_source)
                || source.revision
                    >= self.records[&lineage.head_record_id.as_str().to_owned()].revision
            {
                return Err(ContinuityError::RevisionConflict);
            }
        }
        self.validate_successor(lineage, successor)?;
        let root = request.lineage_root_id.clone();
        let head = successor.record_id.clone();
        let next_lifecycle = if request.operation == RevisionOperation::Rollback {
            RevisionLifecycle::Active
        } else {
            lineage.lifecycle
        };
        let lineage = self
            .lineage_mut(&root)
            .ok_or(ContinuityError::RevisionConflict)?;
        lineage.record_ids.push(head.clone());
        lineage.head_record_id = head.clone();
        lineage.lifecycle = next_lifecycle;
        lineage.authority_mutation_idempotency_key = request.idempotency_key.clone();
        if owner_correction {
            lineage.pinned_owner_correction = true;
        }
        self.records
            .insert(head.as_str().to_owned(), successor.clone());
        Ok(RevisionReceipt {
            lineage_root_id: root,
            operation: request.operation,
            lifecycle: next_lifecycle,
            head_record_id: Some(head),
            purge_plan: None,
        })
    }

    fn validate_successor(
        &self,
        lineage: &Lineage,
        successor: &ContinuityRecordV1,
    ) -> Result<(), ContinuityError> {
        let current = self
            .records
            .get(lineage.head_record_id.as_str())
            .ok_or(ContinuityError::RevisionConflict)?;
        let next_revision = current
            .revision
            .get()
            .checked_add(1)
            .and_then(|value| SafeU53::new(value).ok())
            .ok_or(ContinuityError::RevisionConflict)?;
        if successor.namespace != lineage.namespace
            || successor.scope != lineage.scope
            || successor.record_type != lineage.record_type
            || successor.key_version != lineage.lineage_envelope_key_version
            || successor.revision != next_revision
            || successor.predecessor_record_id.as_ref() != Some(&lineage.head_record_id)
            || self.records.contains_key(successor.record_id.as_str())
        {
            return Err(ContinuityError::RevisionConflict);
        }
        DurableContinuityRecordKind::parse(&successor.record_type)?;
        self.require_unique_namespace_nonce(successor)
    }

    fn require_unique_namespace_nonce(
        &self,
        candidate: &ContinuityRecordV1,
    ) -> Result<(), ContinuityError> {
        if self.records.values().any(|existing| {
            existing.namespace == candidate.namespace
                && existing.key_version == candidate.key_version
                && existing.nonce_b64 == candidate.nonce_b64
        }) {
            Err(ContinuityError::NonceCollision)
        } else {
            Ok(())
        }
    }

    fn archive(&mut self, request: &RevisionRequest) -> Result<RevisionReceipt, ContinuityError> {
        if request.actor != RevisionActor::Owner {
            return Err(ContinuityError::LifecycleConflict);
        }
        let lineage = self
            .lineage_mut(&request.lineage_root_id)
            .ok_or(ContinuityError::RevisionConflict)?;
        if request.expected_head_record_id.as_ref() != Some(&lineage.head_record_id) {
            return Err(ContinuityError::RevisionConflict);
        }
        if lineage.lifecycle != RevisionLifecycle::Active {
            return Err(ContinuityError::LifecycleConflict);
        }
        lineage.lifecycle = RevisionLifecycle::Archived;
        lineage.authority_mutation_idempotency_key = request.idempotency_key.clone();
        Ok(RevisionReceipt {
            lineage_root_id: request.lineage_root_id.clone(),
            operation: RevisionOperation::Archive,
            lifecycle: RevisionLifecycle::Archived,
            head_record_id: Some(lineage.head_record_id.clone()),
            purge_plan: None,
        })
    }

    fn forget(&mut self, request: &RevisionRequest) -> Result<RevisionReceipt, ContinuityError> {
        if request.actor != RevisionActor::Owner {
            return Err(ContinuityError::LifecycleConflict);
        }
        let lineage = self
            .lineage_mut(&request.lineage_root_id)
            .ok_or(ContinuityError::RevisionConflict)?;
        if request.expected_head_record_id.as_ref() != Some(&lineage.head_record_id) {
            return Err(ContinuityError::RevisionConflict);
        }
        if lineage.lifecycle == RevisionLifecycle::Forgotten {
            return Err(ContinuityError::LifecycleConflict);
        }
        if request.derived_artifact_refs != lineage.derived_artifact_inventory {
            return Err(ContinuityError::InvalidRevisionRequest);
        }
        let purge_plan = PurgePlan {
            lineage_root_id: request.lineage_root_id.clone(),
            record_ids: lineage.record_ids.clone(),
            derived_artifact_refs: lineage.derived_artifact_inventory.clone(),
        };
        lineage.lifecycle = RevisionLifecycle::Forgotten;
        lineage.authority_mutation_idempotency_key = request.idempotency_key.clone();
        Ok(RevisionReceipt {
            lineage_root_id: request.lineage_root_id.clone(),
            operation: RevisionOperation::Forget,
            lifecycle: RevisionLifecycle::Forgotten,
            head_record_id: None,
            purge_plan: Some(purge_plan),
        })
    }
}

fn require_sorted_unique(values: &[Sha256Ref]) -> Result<(), ContinuityError> {
    if values.windows(2).any(|pair| pair[0] >= pair[1]) {
        Err(ContinuityError::InvalidRevisionRequest)
    } else {
        Ok(())
    }
}

fn require_bounded_sorted_unique_artifacts(values: &[Sha256Ref]) -> Result<(), ContinuityError> {
    if values.len() > MAX_DERIVED_ARTIFACTS_PER_LINEAGE {
        return Err(ContinuityError::InvalidRevisionRequest);
    }
    require_sorted_unique(values)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::envelope::{encrypt_record, RecordMetadata};
    use luca_protocol::{
        CanonicalTimestamp, ContinuityNamespaceKindV1, Hex64, CONTINUITY_PROTOCOL,
    };

    fn opaque(value: &str) -> OpaqueId {
        OpaqueId::parse(value).unwrap()
    }

    fn hash(digit: char) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{}", digit.to_string().repeat(64))).unwrap()
    }

    fn indexed_hash(index: usize) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{index:064x}")).unwrap()
    }

    fn namespace() -> ContinuityNamespaceV1 {
        ContinuityNamespaceV1 {
            protocol: CONTINUITY_PROTOCOL.into(),
            owner_pubkey: Hex64::parse("1".repeat(64)).unwrap(),
            kind: ContinuityNamespaceKindV1::ResidentPrivate,
            resident_pubkey: Some(Hex64::parse("2".repeat(64)).unwrap()),
            namespace_ref: hash('3'),
            key_version: SafeU53::new(1).unwrap(),
        }
    }

    fn scope(namespace: &ContinuityNamespaceV1) -> ContinuityScopeV1 {
        ContinuityScopeV1 {
            protocol: CONTINUITY_PROTOCOL.into(),
            namespace_ref: namespace.namespace_ref.clone(),
            scope_ref: hash('4'),
            source_id: Some(opaque("source-1")),
            project_id: Some(opaque("project-1")),
            room_id: Some(opaque("room-1")),
            conversation_id: Some(opaque("conversation-1")),
        }
    }

    fn lineage(
        root: &str,
        head: &str,
        lifecycle: RevisionLifecycle,
        pinned_owner_correction: bool,
        transition_key: char,
    ) -> Lineage {
        let namespace = namespace();
        Lineage {
            lineage_root_id: opaque(root),
            namespace: namespace.clone(),
            scope: scope(&namespace),
            record_type: opaque("hypomnema"),
            lineage_envelope_key_version: SafeU53::new(1).unwrap(),
            record_ids: vec![opaque(root), opaque(head)],
            head_record_id: opaque(head),
            lifecycle,
            pinned_owner_correction,
            derived_artifact_inventory: vec![hash('8'), hash('9')],
            authority_mutation_idempotency_key: hash(transition_key),
        }
    }

    fn initial_record(record_id: &str) -> ContinuityRecordV1 {
        let namespace = namespace();
        encrypt_record(
            RecordMetadata {
                protocol: CONTINUITY_PROTOCOL.into(),
                record_id: opaque(record_id),
                namespace: namespace.clone(),
                scope: scope(&namespace),
                record_type: opaque("hypomnema"),
                revision: SafeU53::new(0).unwrap(),
                predecessor_record_id: None,
                created_at: CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
                author_kind: opaque("owner"),
                provenance_refs: vec![hash('5')],
                key_version: SafeU53::new(1).unwrap(),
            },
            &[7; 32],
            b"private test body",
        )
        .unwrap()
    }

    fn lifecycle_request(
        operation: RevisionOperation,
        root: &str,
        successor: Option<ContinuityRecordV1>,
    ) -> RevisionRequest {
        let successor_ciphertext_ref = successor
            .as_ref()
            .map(encrypted_record_reference)
            .transpose()
            .unwrap();
        let namespace = namespace();
        let mut request = RevisionRequest {
            idempotency_key: hash('f'),
            operation,
            lineage_root_id: opaque(root),
            expected_head_record_id: (operation != RevisionOperation::Create).then(|| opaque(root)),
            actor: RevisionActor::Owner,
            signed_source_event_refs: vec![hash('6')],
            request_ref: hash('7'),
            successor,
            successor_ciphertext_ref,
            rollback_source_record_id: None,
            derived_artifact_refs: Vec::new(),
        };
        request.idempotency_key = derive_revision_idempotency_key(
            &namespace,
            &scope(&namespace),
            &opaque("hypomnema"),
            SafeU53::new(1).unwrap(),
            &request,
        )
        .unwrap();
        request
    }

    fn create_lineage(ledger: &mut RevisionLedger, root: &str) {
        ledger
            .apply(lifecycle_request(
                RevisionOperation::Create,
                root,
                Some(initial_record(root)),
            ))
            .unwrap();
    }

    #[test]
    fn active_heads_are_deterministic_and_preserve_body_free_authority() {
        let mut ledger = RevisionLedger::default();
        ledger.lineages.insert(
            "root-z".into(),
            lineage("root-z", "head-z", RevisionLifecycle::Active, false, 'b'),
        );
        ledger.lineages.insert(
            "root-a".into(),
            lineage("root-a", "head-a", RevisionLifecycle::Active, true, 'a'),
        );

        let first = ledger.active_heads().unwrap();
        let second = ledger.active_heads().unwrap();

        assert_eq!(first, second);
        assert_eq!(
            first
                .iter()
                .map(|head| head.lineage_root_id.as_str())
                .collect::<Vec<_>>(),
            vec!["root-a", "root-z"]
        );
        assert_eq!(first[0].schema_version, REVISION_AUTHORITY_SCHEMA_V1);
        assert_eq!(first[0].lineage_head_record_id, opaque("head-a"));
        assert_eq!(first[0].active_head_record_id, Some(opaque("head-a")));
        assert!(first[0].pinned_owner_correction);
        assert_eq!(first[0].derived_artifact_refs, vec![hash('8'), hash('9')]);
        assert_eq!(first[0].authority_mutation_idempotency_key, hash('a'));
        assert_eq!(first[0].scope.source_id, Some(opaque("source-1")));
    }

    #[test]
    fn archived_and_forgotten_lineages_have_explicit_absent_active_heads() {
        let mut ledger = RevisionLedger::default();
        create_lineage(&mut ledger, "archived-root");
        create_lineage(&mut ledger, "forgotten-root");
        let archive = lifecycle_request(RevisionOperation::Archive, "archived-root", None);
        let archive_key = archive.idempotency_key.clone();
        ledger.apply(archive).unwrap();
        let forget = lifecycle_request(RevisionOperation::Forget, "forgotten-root", None);
        let forget_key = forget.idempotency_key.clone();
        ledger.apply(forget).unwrap();

        let heads = ledger.active_heads().unwrap();
        assert_eq!(heads.len(), 2);
        assert_eq!(heads[0].lifecycle, RevisionLifecycle::Archived);
        assert_eq!(heads[0].lineage_head_record_id, opaque("archived-root"));
        assert_eq!(heads[0].active_head_record_id, None);
        assert_eq!(heads[0].authority_mutation_idempotency_key, archive_key);
        assert_eq!(heads[1].lifecycle, RevisionLifecycle::Forgotten);
        assert_eq!(heads[1].lineage_head_record_id, opaque("forgotten-root"));
        assert_eq!(heads[1].active_head_record_id, None);
        assert_eq!(heads[1].authority_mutation_idempotency_key, forget_key);
    }

    #[test]
    fn public_create_rejects_lineage_overflow_without_mutation() {
        let mut ledger = RevisionLedger::default();
        for index in 0..MAX_REVISION_AUTHORITY_HEADS {
            let root = format!("root-{index:04}");
            create_lineage(&mut ledger, &root);
        }
        let record_count = ledger.records.len();
        let idempotency_count = ledger.idempotency.len();
        let overflow = lifecycle_request(
            RevisionOperation::Create,
            "root-overflow",
            Some(initial_record("root-overflow")),
        );

        assert_eq!(
            ledger.apply(overflow),
            Err(ContinuityError::InvalidRevisionRequest)
        );
        assert_eq!(ledger.records.len(), record_count);
        assert_eq!(ledger.idempotency.len(), idempotency_count);
        assert_eq!(ledger.lineages.len(), MAX_REVISION_AUTHORITY_HEADS);
        assert_eq!(
            ledger.active_heads().unwrap().len(),
            MAX_REVISION_AUTHORITY_HEADS
        );
        assert_eq!(ledger.lifecycle(&opaque("root-overflow")), None);
    }

    #[test]
    fn artifact_registration_replays_exact_receipt_and_changes_projection_authority() {
        let mut ledger = RevisionLedger::default();
        create_lineage(&mut ledger, "artifact-root");
        let before = ledger.active_heads().unwrap()[0]
            .authority_mutation_idempotency_key
            .clone();
        let artifacts = vec![hash('8'), hash('9')];
        let request_ref = hash('a');
        let key = ledger
            .derive_artifact_registration_idempotency_key(
                &opaque("artifact-root"),
                &opaque("artifact-root"),
                &request_ref,
                &artifacts,
            )
            .unwrap();
        let first = ledger
            .register_derived_artifacts(
                key.clone(),
                request_ref.clone(),
                &opaque("artifact-root"),
                &opaque("artifact-root"),
                artifacts.clone(),
            )
            .unwrap();
        let next_artifacts = vec![hash('a')];
        let next_request_ref = hash('c');
        let next_key = ledger
            .derive_artifact_registration_idempotency_key(
                &opaque("artifact-root"),
                &opaque("artifact-root"),
                &next_request_ref,
                &next_artifacts,
            )
            .unwrap();
        ledger
            .register_derived_artifacts(
                next_key.clone(),
                next_request_ref,
                &opaque("artifact-root"),
                &opaque("artifact-root"),
                next_artifacts,
            )
            .unwrap();
        let replay = ledger
            .register_derived_artifacts(
                key.clone(),
                request_ref,
                &opaque("artifact-root"),
                &opaque("artifact-root"),
                artifacts,
            )
            .unwrap();

        assert_eq!(first, replay);
        assert_eq!(first.newly_registered, vec![hash('8'), hash('9')]);
        let projected = &ledger.active_heads().unwrap()[0];
        assert_ne!(projected.authority_mutation_idempotency_key, before);
        assert_eq!(projected.authority_mutation_idempotency_key, next_key);
        assert_eq!(
            projected.derived_artifact_refs,
            vec![hash('8'), hash('9'), hash('a')]
        );

        assert_eq!(
            ledger.register_derived_artifacts(
                key,
                hash('b'),
                &opaque("artifact-root"),
                &opaque("artifact-root"),
                vec![hash('8'), hash('9')],
            ),
            Err(ContinuityError::IdempotencyConflict)
        );
        assert_eq!(
            ledger.active_heads().unwrap()[0].derived_artifact_refs,
            vec![hash('8'), hash('9'), hash('a')]
        );
    }

    #[test]
    fn cumulative_artifact_caps_fail_before_authority_mutation() {
        let mut per_lineage = RevisionLedger::default();
        create_lineage(&mut per_lineage, "per-lineage-root");
        let full_inventory: Vec<_> = (0..MAX_DERIVED_ARTIFACTS_PER_LINEAGE)
            .map(indexed_hash)
            .collect();
        let request_ref = hash('a');
        let initial_key = per_lineage
            .derive_artifact_registration_idempotency_key(
                &opaque("per-lineage-root"),
                &opaque("per-lineage-root"),
                &request_ref,
                &full_inventory,
            )
            .unwrap();
        per_lineage
            .register_derived_artifacts(
                initial_key.clone(),
                request_ref,
                &opaque("per-lineage-root"),
                &opaque("per-lineage-root"),
                full_inventory.clone(),
            )
            .unwrap();
        let overflow_ref = hash('b');
        let overflow_artifact = vec![indexed_hash(MAX_DERIVED_ARTIFACTS_PER_LINEAGE)];
        let overflow_key = per_lineage
            .derive_artifact_registration_idempotency_key(
                &opaque("per-lineage-root"),
                &opaque("per-lineage-root"),
                &overflow_ref,
                &overflow_artifact,
            )
            .unwrap();
        assert_eq!(
            per_lineage.register_derived_artifacts(
                overflow_key,
                overflow_ref,
                &opaque("per-lineage-root"),
                &opaque("per-lineage-root"),
                overflow_artifact,
            ),
            Err(ContinuityError::InvalidRevisionRequest)
        );
        let projected = &per_lineage.active_heads().unwrap()[0];
        assert_eq!(projected.derived_artifact_refs, full_inventory);
        assert_eq!(projected.authority_mutation_idempotency_key, initial_key);

        let mut aggregate = RevisionLedger::default();
        for index in 0..(MAX_DERIVED_ARTIFACTS_PER_LEDGER / MAX_DERIVED_ARTIFACTS_PER_LINEAGE) {
            let root = format!("aggregate-root-{index:02}");
            let mut state = lineage(&root, &root, RevisionLifecycle::Active, false, 'c');
            state.derived_artifact_inventory = (0..MAX_DERIVED_ARTIFACTS_PER_LINEAGE)
                .map(indexed_hash)
                .collect();
            aggregate.lineages.insert(root, state);
        }
        let mut target = lineage(
            "aggregate-target",
            "aggregate-target",
            RevisionLifecycle::Active,
            false,
            'd',
        );
        target.derived_artifact_inventory.clear();
        aggregate.lineages.insert("aggregate-target".into(), target);
        let aggregate_ref = hash('e');
        let artifact = vec![hash('f')];
        let aggregate_key = aggregate
            .derive_artifact_registration_idempotency_key(
                &opaque("aggregate-target"),
                &opaque("aggregate-target"),
                &aggregate_ref,
                &artifact,
            )
            .unwrap();
        assert_eq!(
            aggregate.register_derived_artifacts(
                aggregate_key,
                aggregate_ref,
                &opaque("aggregate-target"),
                &opaque("aggregate-target"),
                artifact,
            ),
            Err(ContinuityError::InvalidRevisionRequest)
        );
        assert!(aggregate
            .lineage(&opaque("aggregate-target"))
            .unwrap()
            .derived_artifact_inventory
            .is_empty());
        assert_eq!(aggregate.active_heads().unwrap().len(), 65);
    }

    #[test]
    fn envelope_key_version_mismatch_fails_closed_without_rekey_inference() {
        let mut ledger = RevisionLedger::default();
        create_lineage(&mut ledger, "version-root");
        assert_eq!(
            ledger.verify_lineage_envelope_key_version(
                &opaque("version-root"),
                SafeU53::new(1).unwrap(),
            ),
            Ok(())
        );
        assert_eq!(
            ledger.verify_lineage_envelope_key_version(
                &opaque("version-root"),
                SafeU53::new(2).unwrap(),
            ),
            Err(ContinuityError::RevisionConflict)
        );

        ledger
            .lineage_mut(&opaque("version-root"))
            .unwrap()
            .lineage_envelope_key_version = SafeU53::new(2).unwrap();
        assert_eq!(
            ledger.active_heads(),
            Err(ContinuityError::RevisionConflict)
        );
    }
}
