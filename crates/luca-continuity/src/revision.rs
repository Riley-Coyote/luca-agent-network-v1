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
struct Lineage {
    namespace: ContinuityNamespaceV1,
    scope: ContinuityScopeV1,
    record_type: OpaqueId,
    key_version: SafeU53,
    record_ids: Vec<OpaqueId>,
    head_record_id: OpaqueId,
    lifecycle: RevisionLifecycle,
    pinned_owner_correction: bool,
    derived_artifact_inventory: Vec<Sha256Ref>,
}

/// Pure in-memory append-only encrypted-record lifecycle ledger.
#[derive(Default)]
pub struct RevisionLedger {
    records: BTreeMap<String, ContinuityRecordV1>,
    lineages: BTreeMap<String, Lineage>,
    idempotency: BTreeMap<String, IdempotencyEntry>,
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

    /// Idempotently append body-free derived artifacts to one exact lineage.
    ///
    /// References are never removed. Forget must later present the exact full
    /// inventory so incomplete or injected purge targets fail atomically.
    pub fn register_derived_artifacts(
        &mut self,
        lineage_root_id: &OpaqueId,
        expected_head_record_id: &OpaqueId,
        artifacts: Vec<Sha256Ref>,
    ) -> Result<ArtifactRegistrationReceipt, ContinuityError> {
        require_sorted_unique(&artifacts)?;
        let lineage = self
            .lineage_mut(lineage_root_id)
            .ok_or(ContinuityError::RevisionConflict)?;
        if &lineage.head_record_id != expected_head_record_id {
            return Err(ContinuityError::RevisionConflict);
        }
        if lineage.lifecycle == RevisionLifecycle::Forgotten {
            return Err(ContinuityError::LifecycleConflict);
        }
        let newly_registered: Vec<_> = artifacts
            .iter()
            .filter(|artifact| !lineage.derived_artifact_inventory.contains(artifact))
            .cloned()
            .collect();
        lineage
            .derived_artifact_inventory
            .extend(newly_registered.iter().cloned());
        lineage.derived_artifact_inventory.sort();
        Ok(ArtifactRegistrationReceipt {
            lineage_root_id: lineage_root_id.clone(),
            newly_registered,
            complete_inventory: lineage.derived_artifact_inventory.clone(),
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
        require_sorted_unique(&request.derived_artifact_refs)?;
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
                    lineage.key_version,
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
                lineage.key_version,
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
        DurableContinuityRecordKind::parse(&successor.record_type)?;
        self.require_unique_namespace_nonce(successor)?;
        let root = request.lineage_root_id.clone();
        let head = successor.record_id.clone();
        self.records
            .insert(head.as_str().to_owned(), successor.clone());
        self.lineages.insert(
            root.as_str().to_owned(),
            Lineage {
                namespace: successor.namespace.clone(),
                scope: successor.scope.clone(),
                record_type: successor.record_type.clone(),
                key_version: successor.key_version,
                record_ids: vec![head.clone()],
                head_record_id: head.clone(),
                lifecycle: RevisionLifecycle::Active,
                pinned_owner_correction: false,
                derived_artifact_inventory: Vec::new(),
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
            || successor.key_version != lineage.key_version
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
