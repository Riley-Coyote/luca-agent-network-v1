//! Append-only, encrypted-body-blind continuity revision lifecycle.
//!
//! This module deliberately treats encrypted record envelopes as opaque. It
//! establishes deterministic lineage, authority, lifecycle, and purge-plan
//! semantics without decrypting, indexing, or performing external persistence.

use crate::{envelope::validate_envelope, ContinuityError};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use luca_protocol::{
    canonicalize, ContinuityNamespaceV1, ContinuityRecordV1, ContinuityScopeV1, OpaqueId, SafeU53,
    Sha256Ref,
};
use serde::de::{self, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::marker::PhantomData;

const REVISION_IDEMPOTENCY_DOMAIN_V1: &str = "luca.continuity.revision.idempotency.v1";
const ENCRYPTED_RECORD_REFERENCE_DOMAIN_V1: &str = "luca.continuity.encrypted-record-ref.v1";
const ARTIFACT_REGISTRATION_IDEMPOTENCY_DOMAIN_V1: &str =
    "luca.continuity.artifact-registration.idempotency.v1";
const PURGE_PLAN_DIGEST_DOMAIN_V1: &str = "luca.continuity.purge-plan.digest.v1";
const PURGE_PROGRESS_DIGEST_DOMAIN_V1: &str = "luca.continuity.purge-progress.digest.v1";
const REVISION_SNAPSHOT_FINGERPRINT_DOMAIN_V1: &str =
    "luca.continuity.revision-snapshot.fingerprint.v1";
const ENVELOPE_REPLACEMENT_DIGEST_DOMAIN_V1: &str =
    "luca.continuity.envelope-replacement.digest.v1";

/// Schema version of the body-free revision-authority projection.
pub const REVISION_AUTHORITY_SCHEMA_V1: u16 = 1;
/// Maximum lineage-authority rows returned by one deterministic projection.
pub const MAX_REVISION_AUTHORITY_HEADS: usize = 4_096;
/// Maximum derived-artifact references retained by one lineage.
pub const MAX_DERIVED_ARTIFACTS_PER_LINEAGE: usize = 256;
/// Maximum derived-artifact references retained by one complete ledger.
pub const MAX_DERIVED_ARTIFACTS_PER_LEDGER: usize = 16_384;
/// Schema version of the complete restart-safe revision-ledger snapshot.
pub const REVISION_LEDGER_SNAPSHOT_SCHEMA_V1: u16 = 1;
/// Maximum encrypted records retained in one restart snapshot.
pub const MAX_REVISION_SNAPSHOT_RECORDS: usize = 16_384;
/// Maximum ordered immutable members retained by one lineage.
pub const MAX_REVISION_MEMBERS_PER_LINEAGE: usize = 4_096;
/// Maximum lifecycle idempotency decisions retained in one snapshot.
pub const MAX_REVISION_IDEMPOTENCY_ENTRIES: usize = 16_384;
/// Maximum artifact idempotency decisions retained in one snapshot.
pub const MAX_ARTIFACT_IDEMPOTENCY_ENTRIES: usize = 16_384;
/// Maximum aggregate encoded ciphertext retained in one restart snapshot.
pub const MAX_REVISION_SNAPSHOT_ENCODED_CIPHERTEXT_BYTES: usize = 64 * 1024 * 1024;
/// Maximum aggregate canonical body-free replay binding bytes per snapshot.
pub const MAX_REPLAY_BINDING_CANONICAL_BYTES_PER_LEDGER: usize = 32 * 1024 * 1024;
/// Maximum complete canonical snapshot bytes accepted by the pure boundary.
pub const MAX_REVISION_SNAPSHOT_CANONICAL_BYTES: usize = 96 * 1024 * 1024;
/// Maximum explicit lineage members and record tombstones across one ledger.
pub const MAX_REVISION_MEMBERS_PER_LEDGER: usize = 32_768;
/// Maximum aggregate nested replay-binding and replay-receipt references.
pub const MAX_REPLAY_NESTED_REFS_PER_LEDGER: usize = 4_194_304;
/// Maximum authenticated envelope replacements retained across one ledger.
pub const MAX_ENVELOPE_REPLACEMENTS_PER_LEDGER: usize = 32_768;

/// The operational retrieval state of one immutable record lineage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
    /// Compact source-backed resident memory note eligible for bounded recall.
    MemoryNote,
    /// Resident-private journal material.
    Journal,
    /// Visibly owner-authored annotation attached to a journal lineage.
    JournalAnnotation,
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
            "memory-note" => Ok(Self::MemoryNote),
            "journal" => Ok(Self::Journal),
            "journal-annotation" => Ok(Self::JournalAnnotation),
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

/// Return the domain-separated digest authenticating one logical envelope replacement.
///
/// The digest deliberately excludes `replacement_digest` itself. A trusted
/// rotation transaction records this body-free mapping alongside the newly
/// encrypted envelope so restart validation can connect historical replay
/// authority to the retained ciphertext without retaining plaintext.
pub fn derive_envelope_replacement_digest(
    replacement: &EnvelopeReplacementV1,
) -> Result<Sha256Ref, ContinuityError> {
    let bytes = canonicalize(&CanonicalEnvelopeReplacementDigest {
        domain: ENVELOPE_REPLACEMENT_DIGEST_DOMAIN_V1,
        record_id: &replacement.record_id,
        original_key_version: replacement.original_key_version,
        original_nonce_b64: &replacement.original_nonce_b64,
        original_encrypted_record_ref: &replacement.original_encrypted_record_ref,
        replacement_key_version: replacement.replacement_key_version,
        replacement_nonce_b64: &replacement.replacement_nonce_b64,
        replacement_encrypted_record_ref: &replacement.replacement_encrypted_record_ref,
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
    revision_request_digest(namespace, scope, record_type, key_version, request)
}

/// A body-free deterministic plan for later physical purge executors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PurgePlan {
    /// Terminal lineage root scheduled for purge.
    pub lineage_root_id: OpaqueId,
    /// Entire immutable lineage in revision order.
    #[serde(deserialize_with = "deserialize_lineage_members")]
    pub record_ids: Vec<OpaqueId>,
    /// Sorted unique references from the lineage's authoritative artifact inventory.
    #[serde(deserialize_with = "deserialize_artifact_refs")]
    pub derived_artifact_refs: Vec<Sha256Ref>,
}

/// Explicit physical purge execution state; lifecycle alone never implies deletion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PurgeExecutionStatusV1 {
    /// Forget authorized the exact purge plan but deletion has not started.
    Authorized,
    /// A trusted executor started the exact plan; envelopes remain restart-required.
    InProgress,
    /// Every planned envelope and artifact was deleted and permanently tombstoned.
    Completed,
    /// An executor failed; the complete pre-purge envelopes remain restart-required.
    Failed,
}

/// Body-free permanent reservation for one physically purged encrypted record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PurgedRecordTombstoneV1 {
    /// Permanently reserved immutable record identifier.
    pub record_id: OpaqueId,
    /// Original namespace identity reference.
    pub namespace_ref: Sha256Ref,
    /// Original envelope key version.
    pub key_version: SafeU53,
    /// Original canonical 192-bit nonce, retained to prevent reuse.
    pub nonce_b64: String,
    /// Final full encrypted-record reference, retained without ciphertext.
    pub encrypted_record_ref: Sha256Ref,
}

/// Body-free permanent reservation for one physically deleted derived artifact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PurgedArtifactTombstoneV1 {
    /// Permanently reserved derived-artifact reference.
    pub artifact_ref: Sha256Ref,
}

/// Body-free self-authenticating receipt for one exact purge progress state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PurgeProgressReceiptV1 {
    /// Status covered by this receipt.
    pub status: PurgeExecutionStatusV1,
    /// Domain-separated digest of the exact authorized plan.
    pub plan_digest: Sha256Ref,
    /// Domain-separated digest of status, plan, and exact tombstones.
    pub progress_digest: Sha256Ref,
}

/// Authenticated execution state bound to one exact terminal purge plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PurgeExecutionStateV1 {
    /// Current fail-closed execution status.
    pub status: PurgeExecutionStatusV1,
    /// Exact plan authorized by the terminal Forget receipt.
    pub plan: PurgePlan,
    /// Complete record reservations, present only after completed purge.
    #[serde(deserialize_with = "deserialize_record_tombstones")]
    pub record_tombstones: Vec<PurgedRecordTombstoneV1>,
    /// Complete artifact reservations, present only after completed purge.
    #[serde(deserialize_with = "deserialize_artifact_tombstones")]
    pub artifact_tombstones: Vec<PurgedArtifactTombstoneV1>,
    /// Exact body-free receipt for the current progress state.
    pub progress_receipt: PurgeProgressReceiptV1,
}

/// Body-free result of idempotently extending one lineage's artifact inventory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactRegistrationReceipt {
    /// Exact lineage receiving derived artifact references.
    pub lineage_root_id: OpaqueId,
    /// Newly retained references from this call, in canonical order.
    #[serde(deserialize_with = "deserialize_artifact_refs")]
    pub newly_registered: Vec<Sha256Ref>,
    /// Complete authoritative append-only inventory after this call.
    #[serde(deserialize_with = "deserialize_artifact_refs")]
    pub complete_inventory: Vec<Sha256Ref>,
}

/// A body-free receipt retained for idempotent replay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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

/// Complete deterministic restart representation of one immutable lineage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RevisionLineageSnapshotV1 {
    /// Exact namespace authority.
    pub namespace: ContinuityNamespaceV1,
    /// Exact source/project/room/conversation scope.
    pub scope: ContinuityScopeV1,
    /// Immutable lineage root.
    pub lineage_root_id: OpaqueId,
    /// Complete explicit membership in revision order, even after purge.
    #[serde(deserialize_with = "deserialize_lineage_members")]
    pub record_ids: Vec<OpaqueId>,
    /// Explicit retained lineage head; never inferred from stored envelopes.
    pub lineage_head_record_id: OpaqueId,
    /// Retrieval-eligible head, present only for an active lineage.
    pub active_head_record_id: Option<OpaqueId>,
    /// Explicit lifecycle authority.
    pub lifecycle: RevisionLifecycle,
    /// Whether an owner correction has pinned successor authority.
    pub pinned_owner_correction: bool,
    /// Exact durable record kind shared by the lineage.
    pub record_type: OpaqueId,
    /// Authenticated envelope key version shared by the lineage.
    pub lineage_envelope_key_version: SafeU53,
    /// Ordered authenticated logical-envelope replacement history.
    #[serde(default, deserialize_with = "deserialize_envelope_replacements")]
    pub envelope_replacements: Vec<EnvelopeReplacementV1>,
    /// Complete sorted derived-artifact inventory.
    #[serde(deserialize_with = "deserialize_artifact_refs")]
    pub derived_artifact_refs: Vec<Sha256Ref>,
    /// Exact newest authority mutation decision.
    pub authority_mutation_idempotency_key: Sha256Ref,
    /// Explicit physical purge progress, present only for a forgotten lineage.
    pub purge_execution: Option<PurgeExecutionStateV1>,
}

/// Body-free immutable successor metadata needed to validate replay authority.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RevisionSuccessorBindingV1 {
    /// Immutable encrypted-record identifier.
    pub record_id: OpaqueId,
    /// Explicit monotonic revision number.
    pub revision: SafeU53,
    /// Immediate predecessor when this is not revision zero.
    pub predecessor_record_id: Option<OpaqueId>,
    /// Stable author authority category stored by the encrypted record.
    pub author_kind: OpaqueId,
    /// Original canonical 192-bit nonce, retained as body-free replay metadata.
    pub nonce_b64: String,
    /// Hash reference to the complete encrypted successor, never its ciphertext.
    pub encrypted_record_ref: Sha256Ref,
}

/// Authenticated stable-logical-record mapping across one envelope re-encryption.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnvelopeReplacementV1 {
    /// Stable logical record identifier whose ciphertext was replaced.
    pub record_id: OpaqueId,
    /// Original envelope key version.
    pub original_key_version: SafeU53,
    /// Original canonical 192-bit nonce.
    pub original_nonce_b64: String,
    /// Original full encrypted-record reference.
    pub original_encrypted_record_ref: Sha256Ref,
    /// Replacement envelope key version.
    pub replacement_key_version: SafeU53,
    /// Replacement canonical 192-bit nonce.
    pub replacement_nonce_b64: String,
    /// Replacement full encrypted-record reference.
    pub replacement_encrypted_record_ref: Sha256Ref,
    /// Domain-separated digest authenticating the complete mapping.
    pub replacement_digest: Sha256Ref,
}

/// Typed body-free authority binding for one historical lifecycle request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RevisionReplayBindingV1 {
    /// Original namespace authority, including its original envelope key version.
    pub namespace: ContinuityNamespaceV1,
    /// Original exact scope authority.
    pub scope: ContinuityScopeV1,
    /// Original durable record type.
    pub record_type: OpaqueId,
    /// Original envelope key version used to derive the accepted request digest.
    pub key_version: SafeU53,
    /// Head observed by the original request.
    pub expected_head_record_id: Option<OpaqueId>,
    /// Exact lifecycle operation.
    pub operation: RevisionOperation,
    /// Body-free successor binding for append operations.
    pub successor: Option<RevisionSuccessorBindingV1>,
    /// Historical rollback source, when applicable.
    pub rollback_source_record_id: Option<OpaqueId>,
    /// Original authority category.
    pub actor: RevisionActor,
    /// Sorted signed source-event references.
    #[serde(deserialize_with = "deserialize_artifact_refs")]
    pub signed_source_event_refs: Vec<Sha256Ref>,
    /// Original body-free correlation reference.
    pub request_ref: Sha256Ref,
    /// Sorted artifact inventory asserted by Forget.
    #[serde(deserialize_with = "deserialize_artifact_refs")]
    pub derived_artifact_refs: Vec<Sha256Ref>,
}

/// Typed body-free authority binding for one historical artifact request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactReplayBindingV1 {
    /// Original namespace authority, including its original envelope key version.
    pub namespace: ContinuityNamespaceV1,
    /// Original exact scope authority.
    pub scope: ContinuityScopeV1,
    /// Original durable record type.
    pub record_type: OpaqueId,
    /// Original lineage envelope key version.
    pub lineage_envelope_key_version: SafeU53,
    /// Exact lineage root.
    pub lineage_root_id: OpaqueId,
    /// Head observed by the original registration.
    pub expected_head_record_id: OpaqueId,
    /// Original body-free correlation reference.
    pub request_ref: Sha256Ref,
    /// Exact sorted requested artifact references.
    #[serde(deserialize_with = "deserialize_artifact_refs")]
    pub derived_artifact_refs: Vec<Sha256Ref>,
    /// Zero-based exact mutation order within this lineage.
    pub artifact_sequence: SafeU53,
}

/// One exact lifecycle idempotency decision persisted for historical replay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RevisionIdempotencySnapshotV1 {
    /// Domain-derived key of the canonical request.
    pub idempotency_key: Sha256Ref,
    /// Domain-separated digest of the exact canonical request originally accepted.
    pub canonical_request_digest: Sha256Ref,
    /// Minimal typed body-free original authority needed to validate replay.
    pub replay_binding: RevisionReplayBindingV1,
    /// Original immutable receipt returned on every exact replay.
    pub receipt: RevisionReceipt,
}

/// One exact artifact-registration decision persisted for historical replay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactIdempotencySnapshotV1 {
    /// Domain-derived key of the canonical request.
    pub idempotency_key: Sha256Ref,
    /// Domain-separated digest of the exact canonical request originally accepted.
    pub canonical_request_digest: Sha256Ref,
    /// Minimal typed body-free original authority needed to validate replay.
    pub replay_binding: ArtifactReplayBindingV1,
    /// Original immutable receipt returned on every exact replay.
    pub receipt: ArtifactRegistrationReceipt,
}

/// Complete, deterministic, bounded, restart-safe pure revision ledger.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RevisionLedgerSnapshotV1 {
    /// Frozen snapshot schema version.
    pub schema_version: u16,
    /// Retained encrypted envelopes sorted by record identifier.
    #[serde(deserialize_with = "deserialize_snapshot_records")]
    pub records: Vec<ContinuityRecordV1>,
    /// Explicit lineage authority sorted by lineage root.
    #[serde(deserialize_with = "deserialize_snapshot_lineages")]
    pub lineages: Vec<RevisionLineageSnapshotV1>,
    /// Complete lifecycle replay table sorted by idempotency key.
    #[serde(deserialize_with = "deserialize_revision_idempotency")]
    pub revision_idempotency: Vec<RevisionIdempotencySnapshotV1>,
    /// Complete artifact replay table sorted by idempotency key.
    #[serde(deserialize_with = "deserialize_artifact_idempotency")]
    pub artifact_idempotency: Vec<ArtifactIdempotencySnapshotV1>,
}

impl RevisionLedgerSnapshotV1 {
    /// Decode one snapshot behind a hard serialized-size boundary, then
    /// validate every nested and cross-table invariant before returning it.
    pub fn decode_bounded(serialized: &[u8]) -> Result<Self, ContinuityError> {
        if serialized.len() > MAX_REVISION_SNAPSHOT_CANONICAL_BYTES {
            return Err(ContinuityError::InvalidRevisionRequest);
        }
        let snapshot: Self = serde_json::from_slice(serialized)
            .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
        validate_revision_snapshot(&snapshot)?;
        Ok(snapshot)
    }

    /// Return a domain-separated canonical fingerprint for desktop CAS and audit binding.
    pub fn fingerprint(&self) -> Result<Sha256Ref, ContinuityError> {
        validate_revision_snapshot(self)?;
        let canonical = canonicalize(&CanonicalRevisionSnapshotFingerprint {
            domain: REVISION_SNAPSHOT_FINGERPRINT_DOMAIN_V1,
            snapshot: self,
        })
        .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
        Sha256Ref::parse(format!("sha256:{}", hex::encode(Sha256::digest(canonical))))
            .map_err(|_| ContinuityError::InvalidRevisionRequest)
    }
}

struct BoundedVecVisitor<T> {
    maximum: usize,
    label: &'static str,
    marker: PhantomData<T>,
}

impl<'de, T> Visitor<'de> for BoundedVecVisitor<T>
where
    T: Deserialize<'de>,
{
    type Value = Vec<T>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "at most {} {} entries", self.maximum, self.label)
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        if sequence.size_hint().is_some_and(|hint| hint > self.maximum) {
            return Err(de::Error::invalid_length(
                sequence.size_hint().unwrap_or(self.maximum + 1),
                &self,
            ));
        }
        let mut values = Vec::with_capacity(sequence.size_hint().unwrap_or(0).min(self.maximum));
        while let Some(value) = sequence.next_element()? {
            if values.len() == self.maximum {
                return Err(de::Error::invalid_length(values.len() + 1, &self));
            }
            values.push(value);
        }
        Ok(values)
    }
}

fn deserialize_bounded_vec<'de, D, T>(
    deserializer: D,
    maximum: usize,
    label: &'static str,
) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    deserializer.deserialize_seq(BoundedVecVisitor {
        maximum,
        label,
        marker: PhantomData,
    })
}

fn deserialize_snapshot_records<'de, D>(
    deserializer: D,
) -> Result<Vec<ContinuityRecordV1>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_bounded_vec(deserializer, MAX_REVISION_SNAPSHOT_RECORDS, "record")
}

fn deserialize_snapshot_lineages<'de, D>(
    deserializer: D,
) -> Result<Vec<RevisionLineageSnapshotV1>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_bounded_vec(deserializer, MAX_REVISION_AUTHORITY_HEADS, "lineage")
}

fn deserialize_revision_idempotency<'de, D>(
    deserializer: D,
) -> Result<Vec<RevisionIdempotencySnapshotV1>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_bounded_vec(
        deserializer,
        MAX_REVISION_IDEMPOTENCY_ENTRIES,
        "revision idempotency",
    )
}

fn deserialize_artifact_idempotency<'de, D>(
    deserializer: D,
) -> Result<Vec<ArtifactIdempotencySnapshotV1>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_bounded_vec(
        deserializer,
        MAX_ARTIFACT_IDEMPOTENCY_ENTRIES,
        "artifact idempotency",
    )
}

fn deserialize_lineage_members<'de, D>(deserializer: D) -> Result<Vec<OpaqueId>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_bounded_vec(
        deserializer,
        MAX_REVISION_MEMBERS_PER_LINEAGE,
        "lineage member",
    )
}

fn deserialize_artifact_refs<'de, D>(deserializer: D) -> Result<Vec<Sha256Ref>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_bounded_vec(
        deserializer,
        MAX_DERIVED_ARTIFACTS_PER_LINEAGE,
        "artifact reference",
    )
}

fn deserialize_record_tombstones<'de, D>(
    deserializer: D,
) -> Result<Vec<PurgedRecordTombstoneV1>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_bounded_vec(
        deserializer,
        MAX_REVISION_MEMBERS_PER_LINEAGE,
        "record tombstone",
    )
}

fn deserialize_artifact_tombstones<'de, D>(
    deserializer: D,
) -> Result<Vec<PurgedArtifactTombstoneV1>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_bounded_vec(
        deserializer,
        MAX_DERIVED_ARTIFACTS_PER_LINEAGE,
        "artifact tombstone",
    )
}

fn deserialize_envelope_replacements<'de, D>(
    deserializer: D,
) -> Result<Vec<EnvelopeReplacementV1>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_bounded_vec(
        deserializer,
        MAX_REVISION_MEMBERS_PER_LINEAGE,
        "envelope replacement",
    )
}

#[derive(Serialize)]
struct CanonicalRevisionReplayDigest<'a> {
    domain: &'static str,
    binding: &'a RevisionReplayBindingV1,
}

#[derive(Serialize)]
struct CanonicalArtifactReplayDigest<'a> {
    domain: &'static str,
    binding: &'a ArtifactReplayBindingV1,
}

#[derive(Serialize)]
struct CanonicalEnvelopeReplacementDigest<'a> {
    domain: &'static str,
    record_id: &'a OpaqueId,
    original_key_version: SafeU53,
    original_nonce_b64: &'a str,
    original_encrypted_record_ref: &'a Sha256Ref,
    replacement_key_version: SafeU53,
    replacement_nonce_b64: &'a str,
    replacement_encrypted_record_ref: &'a Sha256Ref,
}

#[derive(Serialize)]
struct CanonicalPurgePlanDigest<'a> {
    domain: &'static str,
    plan: &'a PurgePlan,
}

#[derive(Serialize)]
struct CanonicalPurgeProgressDigest<'a> {
    domain: &'static str,
    status: PurgeExecutionStatusV1,
    plan_digest: &'a Sha256Ref,
    record_tombstones: &'a [PurgedRecordTombstoneV1],
    artifact_tombstones: &'a [PurgedArtifactTombstoneV1],
}

#[derive(Serialize)]
struct CanonicalRevisionSnapshotFingerprint<'a> {
    domain: &'static str,
    snapshot: &'a RevisionLedgerSnapshotV1,
}

#[derive(Debug, Clone)]
struct IdempotencyEntry {
    canonical_request_digest: Sha256Ref,
    replay_binding: RevisionReplayBindingV1,
    receipt: RevisionReceipt,
}

#[derive(Debug, Clone)]
struct ArtifactIdempotencyEntry {
    canonical_request_digest: Sha256Ref,
    replay_binding: ArtifactReplayBindingV1,
    receipt: ArtifactRegistrationReceipt,
}

#[derive(Debug, Clone)]
struct Lineage {
    lineage_root_id: OpaqueId,
    namespace: ContinuityNamespaceV1,
    scope: ContinuityScopeV1,
    record_type: OpaqueId,
    lineage_envelope_key_version: SafeU53,
    envelope_replacements: Vec<EnvelopeReplacementV1>,
    record_ids: Vec<OpaqueId>,
    head_record_id: OpaqueId,
    lifecycle: RevisionLifecycle,
    pinned_owner_correction: bool,
    derived_artifact_inventory: Vec<Sha256Ref>,
    authority_mutation_idempotency_key: Sha256Ref,
    purge_execution: Option<PurgeExecutionStateV1>,
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
    /// Export the complete deterministic restart state without dropping replay history.
    pub fn export_snapshot(&self) -> Result<RevisionLedgerSnapshotV1, ContinuityError> {
        let snapshot =
            RevisionLedgerSnapshotV1 {
                schema_version: REVISION_LEDGER_SNAPSHOT_SCHEMA_V1,
                records: self
                    .records
                    .values()
                    .filter(|record| {
                        !self.lineages.values().any(|lineage| {
                            lineage.purge_execution.as_ref().is_some_and(|purge| {
                                purge.status == PurgeExecutionStatusV1::Completed
                            }) && lineage.record_ids.contains(&record.record_id)
                        })
                    })
                    .cloned()
                    .collect(),
                lineages: self
                    .lineages
                    .values()
                    .map(|lineage| RevisionLineageSnapshotV1 {
                        namespace: lineage.namespace.clone(),
                        scope: lineage.scope.clone(),
                        lineage_root_id: lineage.lineage_root_id.clone(),
                        record_ids: lineage.record_ids.clone(),
                        lineage_head_record_id: lineage.head_record_id.clone(),
                        active_head_record_id: (lineage.lifecycle == RevisionLifecycle::Active)
                            .then(|| lineage.head_record_id.clone()),
                        lifecycle: lineage.lifecycle,
                        pinned_owner_correction: lineage.pinned_owner_correction,
                        record_type: lineage.record_type.clone(),
                        lineage_envelope_key_version: lineage.lineage_envelope_key_version,
                        envelope_replacements: lineage.envelope_replacements.clone(),
                        derived_artifact_refs: lineage.derived_artifact_inventory.clone(),
                        authority_mutation_idempotency_key: lineage
                            .authority_mutation_idempotency_key
                            .clone(),
                        purge_execution: lineage.purge_execution.clone(),
                    })
                    .collect(),
                revision_idempotency: self
                    .idempotency
                    .iter()
                    .map(|(key, entry)| {
                        Ok(RevisionIdempotencySnapshotV1 {
                            idempotency_key: Sha256Ref::parse(key.clone())
                                .map_err(|_| ContinuityError::InvalidRevisionRequest)?,
                            canonical_request_digest: entry.canonical_request_digest.clone(),
                            replay_binding: entry.replay_binding.clone(),
                            receipt: entry.receipt.clone(),
                        })
                    })
                    .collect::<Result<Vec<_>, ContinuityError>>()?,
                artifact_idempotency: self
                    .artifact_idempotency
                    .iter()
                    .map(|(key, entry)| {
                        Ok(ArtifactIdempotencySnapshotV1 {
                            idempotency_key: Sha256Ref::parse(key.clone())
                                .map_err(|_| ContinuityError::InvalidRevisionRequest)?,
                            canonical_request_digest: entry.canonical_request_digest.clone(),
                            replay_binding: entry.replay_binding.clone(),
                            receipt: entry.receipt.clone(),
                        })
                    })
                    .collect::<Result<Vec<_>, ContinuityError>>()?,
            };
        validate_revision_snapshot(&snapshot)?;
        Ok(snapshot)
    }

    /// Hydrate a fresh ledger only after validating the complete snapshot.
    ///
    /// No authority or head is inferred from record order. Any invalid field
    /// rejects the whole candidate before a ledger becomes observable.
    pub fn from_snapshot(snapshot: RevisionLedgerSnapshotV1) -> Result<Self, ContinuityError> {
        validate_revision_snapshot(&snapshot)?;

        let records = snapshot
            .records
            .into_iter()
            .map(|record| (record.record_id.as_str().to_owned(), record))
            .collect();
        let lineages = snapshot
            .lineages
            .into_iter()
            .map(|lineage| {
                (
                    lineage.lineage_root_id.as_str().to_owned(),
                    Lineage {
                        lineage_root_id: lineage.lineage_root_id,
                        namespace: lineage.namespace,
                        scope: lineage.scope,
                        record_type: lineage.record_type,
                        lineage_envelope_key_version: lineage.lineage_envelope_key_version,
                        envelope_replacements: lineage.envelope_replacements,
                        record_ids: lineage.record_ids,
                        head_record_id: lineage.lineage_head_record_id,
                        lifecycle: lineage.lifecycle,
                        pinned_owner_correction: lineage.pinned_owner_correction,
                        derived_artifact_inventory: lineage.derived_artifact_refs,
                        authority_mutation_idempotency_key: lineage
                            .authority_mutation_idempotency_key,
                        purge_execution: lineage.purge_execution,
                    },
                )
            })
            .collect();
        let idempotency = snapshot
            .revision_idempotency
            .into_iter()
            .map(|entry| {
                (
                    entry.idempotency_key.as_str().to_owned(),
                    IdempotencyEntry {
                        canonical_request_digest: entry.canonical_request_digest,
                        replay_binding: entry.replay_binding,
                        receipt: entry.receipt,
                    },
                )
            })
            .collect();
        let artifact_idempotency = snapshot
            .artifact_idempotency
            .into_iter()
            .map(|entry| {
                (
                    entry.idempotency_key.as_str().to_owned(),
                    ArtifactIdempotencyEntry {
                        canonical_request_digest: entry.canonical_request_digest,
                        replay_binding: entry.replay_binding,
                        receipt: entry.receipt,
                    },
                )
            })
            .collect();

        Ok(Self {
            records,
            lineages,
            idempotency,
            artifact_idempotency,
        })
    }

    /// Advance physical purge execution without changing terminal Forget authority.
    ///
    /// Completion atomically replaces every planned encrypted envelope and
    /// artifact with a permanent body-free reservation. Failed or in-flight
    /// execution never permits a restart snapshot to omit an envelope.
    pub fn advance_purge(
        &mut self,
        lineage_root_id: &OpaqueId,
        next: PurgeExecutionStatusV1,
    ) -> Result<(), ContinuityError> {
        let lineage = self
            .lineage(lineage_root_id)
            .ok_or(ContinuityError::RevisionConflict)?;
        if lineage.lifecycle != RevisionLifecycle::Forgotten {
            return Err(ContinuityError::LifecycleConflict);
        }
        let current = lineage
            .purge_execution
            .as_ref()
            .ok_or(ContinuityError::RevisionConflict)?;
        let allowed = matches!(
            (current.status, next),
            (
                PurgeExecutionStatusV1::Authorized,
                PurgeExecutionStatusV1::InProgress
            ) | (
                PurgeExecutionStatusV1::Authorized,
                PurgeExecutionStatusV1::Failed
            ) | (
                PurgeExecutionStatusV1::InProgress,
                PurgeExecutionStatusV1::Failed
            ) | (
                PurgeExecutionStatusV1::InProgress,
                PurgeExecutionStatusV1::Completed
            ) | (
                PurgeExecutionStatusV1::Failed,
                PurgeExecutionStatusV1::InProgress
            )
        );
        if !allowed {
            return Err(ContinuityError::LifecycleConflict);
        }

        if next != PurgeExecutionStatusV1::Completed {
            let progress_receipt = purge_progress_receipt(next, &current.plan, &[], &[])?;
            let purge = self
                .lineage_mut(lineage_root_id)
                .ok_or(ContinuityError::RevisionConflict)?
                .purge_execution
                .as_mut()
                .ok_or(ContinuityError::RevisionConflict)?;
            purge.status = next;
            purge.progress_receipt = progress_receipt;
            return Ok(());
        }

        let plan = current.plan.clone();
        let mut record_tombstones = Vec::with_capacity(plan.record_ids.len());
        for record_id in &plan.record_ids {
            let record = self
                .records
                .get(record_id.as_str())
                .ok_or(ContinuityError::RevisionConflict)?;
            record_tombstones.push(PurgedRecordTombstoneV1 {
                record_id: record.record_id.clone(),
                namespace_ref: record.namespace.namespace_ref.clone(),
                key_version: record.key_version,
                nonce_b64: record.nonce_b64.clone(),
                encrypted_record_ref: encrypted_record_reference(record)?,
            });
        }
        let artifact_tombstones: Vec<_> = plan
            .derived_artifact_refs
            .iter()
            .cloned()
            .map(|artifact_ref| PurgedArtifactTombstoneV1 { artifact_ref })
            .collect();
        let progress_receipt = purge_progress_receipt(
            PurgeExecutionStatusV1::Completed,
            &plan,
            &record_tombstones,
            &artifact_tombstones,
        )?;
        for record_id in &plan.record_ids {
            self.records.remove(record_id.as_str());
        }
        let purge = self
            .lineage_mut(lineage_root_id)
            .ok_or(ContinuityError::RevisionConflict)?
            .purge_execution
            .as_mut()
            .ok_or(ContinuityError::RevisionConflict)?;
        purge.status = PurgeExecutionStatusV1::Completed;
        purge.record_tombstones = record_tombstones;
        purge.artifact_tombstones = artifact_tombstones;
        purge.progress_receipt = progress_receipt;
        Ok(())
    }

    /// Apply one operation atomically, returning its original receipt on exact replay.
    pub fn apply(&mut self, request: RevisionRequest) -> Result<RevisionReceipt, ContinuityError> {
        self.validate_request_shape(&request)?;
        let key = request.idempotency_key.as_str().to_owned();
        if self.artifact_idempotency.contains_key(&key) {
            return Err(ContinuityError::IdempotencyConflict);
        }
        if let Some(existing) = self.idempotency.get(&key) {
            let digest = revision_request_digest(
                &existing.replay_binding.namespace,
                &existing.replay_binding.scope,
                &existing.replay_binding.record_type,
                existing.replay_binding.key_version,
                &request,
            )?;
            return if existing.canonical_request_digest == digest
                && existing.replay_binding
                    == revision_replay_binding(
                        &existing.replay_binding.namespace,
                        &existing.replay_binding.scope,
                        &existing.replay_binding.record_type,
                        existing.replay_binding.key_version,
                        &request,
                    )?
            {
                Ok(existing.receipt.clone())
            } else {
                Err(ContinuityError::IdempotencyConflict)
            };
        }

        self.require_idempotency_capacity(false)?;
        let expected_key = self.derive_request_key(&request)?;
        if request.idempotency_key != expected_key {
            return Err(ContinuityError::InvalidRevisionRequest);
        }
        let replay_binding = {
            let (namespace, scope, record_type, key_version) =
                self.original_request_authority(&request)?;
            revision_replay_binding(namespace, scope, record_type, key_version, &request)?
        };
        let canonical_request_digest = digest_revision_replay_binding(&replay_binding)?;
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
                canonical_request_digest,
                replay_binding,
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
        let lineage = self
            .lineage(lineage_root_id)
            .ok_or(ContinuityError::RevisionConflict)?;
        let artifact_sequence = self.next_artifact_sequence(lineage_root_id)?;
        digest_artifact_replay_binding(&ArtifactReplayBindingV1 {
            namespace: lineage.namespace.clone(),
            scope: lineage.scope.clone(),
            record_type: lineage.record_type.clone(),
            lineage_envelope_key_version: lineage.lineage_envelope_key_version,
            lineage_root_id: lineage_root_id.clone(),
            expected_head_record_id: expected_head_record_id.clone(),
            request_ref: request_ref.clone(),
            derived_artifact_refs: artifacts.to_vec(),
            artifact_sequence,
        })
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
        if self.idempotency.contains_key(idempotency_key.as_str()) {
            return Err(ContinuityError::IdempotencyConflict);
        }
        if let Some(existing) = self.artifact_idempotency.get(idempotency_key.as_str()) {
            let binding = ArtifactReplayBindingV1 {
                namespace: existing.replay_binding.namespace.clone(),
                scope: existing.replay_binding.scope.clone(),
                record_type: existing.replay_binding.record_type.clone(),
                lineage_envelope_key_version: existing.replay_binding.lineage_envelope_key_version,
                lineage_root_id: lineage_root_id.clone(),
                expected_head_record_id: expected_head_record_id.clone(),
                request_ref,
                derived_artifact_refs: artifacts,
                artifact_sequence: existing.replay_binding.artifact_sequence,
            };
            let digest = digest_artifact_replay_binding(&binding)?;
            return if existing.canonical_request_digest == digest
                && existing.replay_binding == binding
            {
                Ok(existing.receipt.clone())
            } else {
                Err(ContinuityError::IdempotencyConflict)
            };
        }
        self.require_idempotency_capacity(true)?;
        let artifact_sequence = self.next_artifact_sequence(lineage_root_id)?;
        let lineage = self
            .lineage(lineage_root_id)
            .ok_or(ContinuityError::RevisionConflict)?;
        let replay_binding = ArtifactReplayBindingV1 {
            namespace: lineage.namespace.clone(),
            scope: lineage.scope.clone(),
            record_type: lineage.record_type.clone(),
            lineage_envelope_key_version: lineage.lineage_envelope_key_version,
            lineage_root_id: lineage_root_id.clone(),
            expected_head_record_id: expected_head_record_id.clone(),
            request_ref: request_ref.clone(),
            derived_artifact_refs: artifacts.clone(),
            artifact_sequence,
        };
        let expected_key = digest_artifact_replay_binding(&replay_binding)?;
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
        if artifacts.iter().any(|artifact| {
            self.lineages.values().any(|known| {
                known.lineage_root_id != *lineage_root_id
                    && known.derived_artifact_inventory.contains(artifact)
            })
        }) {
            return Err(ContinuityError::RevisionConflict);
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
                canonical_request_digest: expected_key,
                replay_binding,
                receipt: receipt.clone(),
            },
        );
        Ok(receipt)
    }

    fn validate_artifact_authority_bounds(&self) -> Result<usize, ContinuityError> {
        let mut global_owner = BTreeMap::<&Sha256Ref, &OpaqueId>::new();
        self.lineages.values().try_fold(0_usize, |total, lineage| {
            if lineage.derived_artifact_inventory.len() > MAX_DERIVED_ARTIFACTS_PER_LINEAGE {
                return Err(ContinuityError::InvalidRevisionRequest);
            }
            require_sorted_unique(&lineage.derived_artifact_inventory)?;
            for artifact in &lineage.derived_artifact_inventory {
                if global_owner
                    .insert(artifact, &lineage.lineage_root_id)
                    .is_some()
                {
                    return Err(ContinuityError::RevisionConflict);
                }
            }
            total
                .checked_add(lineage.derived_artifact_inventory.len())
                .filter(|next| *next <= MAX_DERIVED_ARTIFACTS_PER_LEDGER)
                .ok_or(ContinuityError::InvalidRevisionRequest)
        })
    }

    fn next_artifact_sequence(
        &self,
        lineage_root_id: &OpaqueId,
    ) -> Result<SafeU53, ContinuityError> {
        let count = self
            .artifact_idempotency
            .values()
            .filter(|entry| entry.replay_binding.lineage_root_id == *lineage_root_id)
            .count();
        SafeU53::new(count as u64).map_err(|_| ContinuityError::InvalidRevisionRequest)
    }

    fn require_idempotency_capacity(&self, artifact_domain: bool) -> Result<(), ContinuityError> {
        if (!artifact_domain && self.idempotency.len() >= MAX_REVISION_IDEMPOTENCY_ENTRIES)
            || (artifact_domain
                && self.artifact_idempotency.len() >= MAX_ARTIFACT_IDEMPOTENCY_ENTRIES)
        {
            return Err(ContinuityError::InvalidRevisionRequest);
        }
        Ok(())
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

    fn original_request_authority<'a>(
        &'a self,
        request: &'a RevisionRequest,
    ) -> Result<
        (
            &'a ContinuityNamespaceV1,
            &'a ContinuityScopeV1,
            &'a OpaqueId,
            SafeU53,
        ),
        ContinuityError,
    > {
        if request.operation == RevisionOperation::Create {
            let successor = request
                .successor
                .as_ref()
                .ok_or(ContinuityError::InvalidRevisionRequest)?;
            Ok((
                &successor.namespace,
                &successor.scope,
                &successor.record_type,
                successor.key_version,
            ))
        } else {
            let lineage = self
                .lineage(&request.lineage_root_id)
                .ok_or(ContinuityError::RevisionConflict)?;
            Ok((
                &lineage.namespace,
                &lineage.scope,
                &lineage.record_type,
                lineage.lineage_envelope_key_version,
            ))
        }
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

fn revision_request_digest(
    namespace: &ContinuityNamespaceV1,
    scope: &ContinuityScopeV1,
    record_type: &OpaqueId,
    key_version: SafeU53,
    request: &RevisionRequest,
) -> Result<Sha256Ref, ContinuityError> {
    digest_revision_replay_binding(&revision_replay_binding(
        namespace,
        scope,
        record_type,
        key_version,
        request,
    )?)
}

fn digest_revision_replay_binding(
    binding: &RevisionReplayBindingV1,
) -> Result<Sha256Ref, ContinuityError> {
    let canonical = canonicalize(&CanonicalRevisionReplayDigest {
        domain: REVISION_IDEMPOTENCY_DOMAIN_V1,
        binding,
    })
    .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
    Sha256Ref::parse(format!("sha256:{}", hex::encode(Sha256::digest(canonical))))
        .map_err(|_| ContinuityError::InvalidRevisionRequest)
}

fn digest_artifact_replay_binding(
    binding: &ArtifactReplayBindingV1,
) -> Result<Sha256Ref, ContinuityError> {
    let canonical = canonicalize(&CanonicalArtifactReplayDigest {
        domain: ARTIFACT_REGISTRATION_IDEMPOTENCY_DOMAIN_V1,
        binding,
    })
    .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
    Sha256Ref::parse(format!("sha256:{}", hex::encode(Sha256::digest(canonical))))
        .map_err(|_| ContinuityError::InvalidRevisionRequest)
}

fn purge_plan_digest(plan: &PurgePlan) -> Result<Sha256Ref, ContinuityError> {
    let canonical = canonicalize(&CanonicalPurgePlanDigest {
        domain: PURGE_PLAN_DIGEST_DOMAIN_V1,
        plan,
    })
    .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
    Sha256Ref::parse(format!("sha256:{}", hex::encode(Sha256::digest(canonical))))
        .map_err(|_| ContinuityError::InvalidRevisionRequest)
}

fn purge_progress_receipt(
    status: PurgeExecutionStatusV1,
    plan: &PurgePlan,
    record_tombstones: &[PurgedRecordTombstoneV1],
    artifact_tombstones: &[PurgedArtifactTombstoneV1],
) -> Result<PurgeProgressReceiptV1, ContinuityError> {
    let plan_digest = purge_plan_digest(plan)?;
    let canonical = canonicalize(&CanonicalPurgeProgressDigest {
        domain: PURGE_PROGRESS_DIGEST_DOMAIN_V1,
        status,
        plan_digest: &plan_digest,
        record_tombstones,
        artifact_tombstones,
    })
    .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
    let progress_digest =
        Sha256Ref::parse(format!("sha256:{}", hex::encode(Sha256::digest(canonical))))
            .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
    Ok(PurgeProgressReceiptV1 {
        status,
        plan_digest,
        progress_digest,
    })
}

fn revision_replay_binding(
    namespace: &ContinuityNamespaceV1,
    scope: &ContinuityScopeV1,
    record_type: &OpaqueId,
    key_version: SafeU53,
    request: &RevisionRequest,
) -> Result<RevisionReplayBindingV1, ContinuityError> {
    let successor = request
        .successor
        .as_ref()
        .map(|record| {
            Ok(RevisionSuccessorBindingV1 {
                record_id: record.record_id.clone(),
                revision: record.revision,
                predecessor_record_id: record.predecessor_record_id.clone(),
                author_kind: record.author_kind.clone(),
                nonce_b64: record.nonce_b64.clone(),
                encrypted_record_ref: encrypted_record_reference(record)?,
            })
        })
        .transpose()?;
    Ok(RevisionReplayBindingV1 {
        namespace: namespace.clone(),
        scope: scope.clone(),
        record_type: record_type.clone(),
        key_version,
        expected_head_record_id: request.expected_head_record_id.clone(),
        operation: request.operation,
        successor,
        rollback_source_record_id: request.rollback_source_record_id.clone(),
        actor: request.actor,
        signed_source_event_refs: request.signed_source_event_refs.clone(),
        request_ref: request.request_ref.clone(),
        derived_artifact_refs: request.derived_artifact_refs.clone(),
    })
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
            || self.record_id_reserved(&successor.record_id)
        {
            return Err(ContinuityError::RevisionConflict);
        }
        if self.lineages.len() >= MAX_REVISION_AUTHORITY_HEADS
            || self.records.len() >= MAX_REVISION_SNAPSHOT_RECORDS
            || self
                .encoded_ciphertext_bytes()
                .checked_add(successor.ciphertext_b64.len())
                .is_none_or(|bytes| bytes > MAX_REVISION_SNAPSHOT_ENCODED_CIPHERTEXT_BYTES)
        {
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
                envelope_replacements: Vec::new(),
                record_ids: vec![head.clone()],
                head_record_id: head.clone(),
                lifecycle: RevisionLifecycle::Active,
                pinned_owner_correction: false,
                derived_artifact_inventory: Vec::new(),
                authority_mutation_idempotency_key: request.idempotency_key.clone(),
                purge_execution: None,
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
        if lineage.record_ids.len() >= MAX_REVISION_MEMBERS_PER_LINEAGE
            || self.records.len() >= MAX_REVISION_SNAPSHOT_RECORDS
            || self
                .encoded_ciphertext_bytes()
                .checked_add(successor.ciphertext_b64.len())
                .is_none_or(|bytes| bytes > MAX_REVISION_SNAPSHOT_ENCODED_CIPHERTEXT_BYTES)
        {
            return Err(ContinuityError::InvalidRevisionRequest);
        }
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
            || self.record_id_reserved(&successor.record_id)
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
            existing.namespace.namespace_ref == candidate.namespace.namespace_ref
                && existing.key_version == candidate.key_version
                && existing.nonce_b64 == candidate.nonce_b64
        }) || self.lineages.values().any(|lineage| {
            lineage.purge_execution.as_ref().is_some_and(|purge| {
                purge.record_tombstones.iter().any(|tombstone| {
                    tombstone.namespace_ref == candidate.namespace.namespace_ref
                        && tombstone.key_version == candidate.key_version
                        && tombstone.nonce_b64 == candidate.nonce_b64
                })
            })
        }) {
            Err(ContinuityError::NonceCollision)
        } else {
            Ok(())
        }
    }

    fn record_id_reserved(&self, candidate: &OpaqueId) -> bool {
        self.records.contains_key(candidate.as_str())
            || self
                .lineages
                .values()
                .any(|lineage| lineage.record_ids.contains(candidate))
    }

    fn encoded_ciphertext_bytes(&self) -> usize {
        self.records
            .values()
            .map(|record| record.ciphertext_b64.len())
            .sum()
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
        let progress_receipt =
            purge_progress_receipt(PurgeExecutionStatusV1::Authorized, &purge_plan, &[], &[])?;
        lineage.lifecycle = RevisionLifecycle::Forgotten;
        lineage.authority_mutation_idempotency_key = request.idempotency_key.clone();
        lineage.purge_execution = Some(PurgeExecutionStateV1 {
            status: PurgeExecutionStatusV1::Authorized,
            plan: purge_plan.clone(),
            record_tombstones: Vec::new(),
            artifact_tombstones: Vec::new(),
            progress_receipt,
        });
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

fn add_bounded(total: &mut usize, amount: usize, maximum: usize) -> Result<(), ContinuityError> {
    *total = total
        .checked_add(amount)
        .filter(|next| *next <= maximum)
        .ok_or(ContinuityError::InvalidRevisionRequest)?;
    Ok(())
}

fn canonical_nonce(value: &str) -> bool {
    BASE64_STANDARD
        .decode(value)
        .is_ok_and(|decoded| decoded.len() == 24 && BASE64_STANDARD.encode(decoded) == value)
}

fn replacement_chain_matches_retained(
    chain: Option<&Vec<&EnvelopeReplacementV1>>,
    historical_key_version: SafeU53,
    historical: &RevisionSuccessorBindingV1,
    retained: &ContinuityRecordV1,
) -> Result<(), ContinuityError> {
    let retained_ref = encrypted_record_reference(retained)?;
    if historical_key_version == retained.key_version {
        if chain.is_none()
            && historical.nonce_b64 == retained.nonce_b64
            && historical.encrypted_record_ref == retained_ref
        {
            return Ok(());
        }
        return Err(ContinuityError::RevisionConflict);
    }
    let chain = chain.ok_or(ContinuityError::RevisionConflict)?;
    let first = chain.first().ok_or(ContinuityError::RevisionConflict)?;
    let last = chain.last().ok_or(ContinuityError::RevisionConflict)?;
    if first.original_key_version != historical_key_version
        || first.original_nonce_b64 != historical.nonce_b64
        || first.original_encrypted_record_ref != historical.encrypted_record_ref
        || last.replacement_key_version != retained.key_version
        || last.replacement_nonce_b64 != retained.nonce_b64
        || last.replacement_encrypted_record_ref != retained_ref
    {
        return Err(ContinuityError::RevisionConflict);
    }
    Ok(())
}

fn replacement_chain_matches_tombstone(
    chain: Option<&Vec<&EnvelopeReplacementV1>>,
    historical_key_version: SafeU53,
    historical: &RevisionSuccessorBindingV1,
    tombstone: &PurgedRecordTombstoneV1,
) -> Result<(), ContinuityError> {
    if historical_key_version == tombstone.key_version {
        if chain.is_none()
            && historical.nonce_b64 == tombstone.nonce_b64
            && historical.encrypted_record_ref == tombstone.encrypted_record_ref
        {
            return Ok(());
        }
        return Err(ContinuityError::RevisionConflict);
    }
    let chain = chain.ok_or(ContinuityError::RevisionConflict)?;
    let first = chain.first().ok_or(ContinuityError::RevisionConflict)?;
    let last = chain.last().ok_or(ContinuityError::RevisionConflict)?;
    if first.original_key_version != historical_key_version
        || first.original_nonce_b64 != historical.nonce_b64
        || first.original_encrypted_record_ref != historical.encrypted_record_ref
        || last.replacement_key_version != tombstone.key_version
        || last.replacement_nonce_b64 != tombstone.nonce_b64
        || last.replacement_encrypted_record_ref != tombstone.encrypted_record_ref
    {
        return Err(ContinuityError::RevisionConflict);
    }
    Ok(())
}

fn same_namespace_identity(
    historical: &ContinuityNamespaceV1,
    current: &ContinuityNamespaceV1,
) -> bool {
    historical.protocol == current.protocol
        && historical.owner_pubkey == current.owner_pubkey
        && historical.kind == current.kind
        && historical.resident_pubkey == current.resident_pubkey
        && historical.namespace_ref == current.namespace_ref
}

fn validate_revision_snapshot(snapshot: &RevisionLedgerSnapshotV1) -> Result<(), ContinuityError> {
    if snapshot.schema_version != REVISION_LEDGER_SNAPSHOT_SCHEMA_V1
        || snapshot.records.len() > MAX_REVISION_SNAPSHOT_RECORDS
        || snapshot.lineages.len() > MAX_REVISION_AUTHORITY_HEADS
        || snapshot.revision_idempotency.len() > MAX_REVISION_IDEMPOTENCY_ENTRIES
        || snapshot.artifact_idempotency.len() > MAX_ARTIFACT_IDEMPOTENCY_ENTRIES
        || snapshot
            .records
            .windows(2)
            .any(|pair| pair[0].record_id.as_str() >= pair[1].record_id.as_str())
        || snapshot
            .lineages
            .windows(2)
            .any(|pair| pair[0].lineage_root_id.as_str() >= pair[1].lineage_root_id.as_str())
        || snapshot
            .revision_idempotency
            .windows(2)
            .any(|pair| pair[0].idempotency_key.as_str() >= pair[1].idempotency_key.as_str())
        || snapshot
            .artifact_idempotency
            .windows(2)
            .any(|pair| pair[0].idempotency_key.as_str() >= pair[1].idempotency_key.as_str())
    {
        return Err(ContinuityError::InvalidRevisionRequest);
    }

    let encoded_ciphertext_bytes = snapshot
        .records
        .iter()
        .try_fold(0_usize, |total, record| {
            total.checked_add(record.ciphertext_b64.len())
        })
        .ok_or(ContinuityError::InvalidRevisionRequest)?;
    if encoded_ciphertext_bytes > MAX_REVISION_SNAPSHOT_ENCODED_CIPHERTEXT_BYTES {
        return Err(ContinuityError::InvalidRevisionRequest);
    }

    // Bound aggregate nested collections before constructing validation maps
    // or canonical replay buffers. Per-field visitors bound individual JSON
    // arrays; these totals prevent many individually-valid arrays from
    // multiplying restart work or memory use.
    let mut aggregate_members = 0_usize;
    let mut aggregate_replacements = 0_usize;
    let mut aggregate_nested_refs = 0_usize;
    for lineage in &snapshot.lineages {
        add_bounded(
            &mut aggregate_members,
            lineage.record_ids.len(),
            MAX_REVISION_MEMBERS_PER_LEDGER,
        )?;
        add_bounded(
            &mut aggregate_replacements,
            lineage.envelope_replacements.len(),
            MAX_ENVELOPE_REPLACEMENTS_PER_LEDGER,
        )?;
        add_bounded(
            &mut aggregate_nested_refs,
            lineage
                .record_ids
                .len()
                .checked_add(lineage.derived_artifact_refs.len())
                .ok_or(ContinuityError::InvalidRevisionRequest)?,
            MAX_REPLAY_NESTED_REFS_PER_LEDGER,
        )?;
        if let Some(purge) = &lineage.purge_execution {
            add_bounded(
                &mut aggregate_members,
                purge.record_tombstones.len(),
                MAX_REVISION_MEMBERS_PER_LEDGER,
            )?;
            let purge_refs = purge
                .plan
                .record_ids
                .len()
                .checked_add(purge.plan.derived_artifact_refs.len())
                .and_then(|total| total.checked_add(purge.record_tombstones.len()))
                .and_then(|total| total.checked_add(purge.artifact_tombstones.len()))
                .ok_or(ContinuityError::InvalidRevisionRequest)?;
            add_bounded(
                &mut aggregate_nested_refs,
                purge_refs,
                MAX_REPLAY_NESTED_REFS_PER_LEDGER,
            )?;
        }
    }
    for entry in &snapshot.revision_idempotency {
        let nested = entry
            .replay_binding
            .signed_source_event_refs
            .len()
            .checked_add(entry.replay_binding.derived_artifact_refs.len())
            .and_then(|total| {
                total.checked_add(entry.receipt.purge_plan.as_ref().map_or(0, |plan| {
                    plan.record_ids.len() + plan.derived_artifact_refs.len()
                }))
            })
            .ok_or(ContinuityError::InvalidRevisionRequest)?;
        add_bounded(
            &mut aggregate_nested_refs,
            nested,
            MAX_REPLAY_NESTED_REFS_PER_LEDGER,
        )?;
    }
    for entry in &snapshot.artifact_idempotency {
        let nested = entry
            .replay_binding
            .derived_artifact_refs
            .len()
            .checked_add(entry.receipt.newly_registered.len())
            .and_then(|total| total.checked_add(entry.receipt.complete_inventory.len()))
            .ok_or(ContinuityError::InvalidRevisionRequest)?;
        add_bounded(
            &mut aggregate_nested_refs,
            nested,
            MAX_REPLAY_NESTED_REFS_PER_LEDGER,
        )?;
    }

    let record_map: BTreeMap<_, _> = snapshot
        .records
        .iter()
        .map(|record| (record.record_id.as_str(), record))
        .collect();
    let lineage_map: BTreeMap<_, _> = snapshot
        .lineages
        .iter()
        .map(|lineage| (lineage.lineage_root_id.as_str(), lineage))
        .collect();
    let mut member_owner = BTreeMap::<String, String>::new();
    let mut nonce_authority = BTreeSet::<(String, u64, String)>::new();
    let mut aggregate_artifacts = 0_usize;
    let mut artifact_owner = BTreeMap::<String, String>::new();
    let mut replacement_chains = BTreeMap::<(String, String), Vec<&EnvelopeReplacementV1>>::new();

    for record in &snapshot.records {
        record
            .validate()
            .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
        validate_envelope(record).map_err(|_| ContinuityError::InvalidRevisionRequest)?;
        DurableContinuityRecordKind::parse(&record.record_type)?;
    }

    for lineage in &snapshot.lineages {
        lineage
            .namespace
            .validate()
            .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
        lineage
            .scope
            .validate()
            .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
        DurableContinuityRecordKind::parse(&lineage.record_type)?;
        require_bounded_sorted_unique_artifacts(&lineage.derived_artifact_refs)?;
        aggregate_artifacts = aggregate_artifacts
            .checked_add(lineage.derived_artifact_refs.len())
            .filter(|total| *total <= MAX_DERIVED_ARTIFACTS_PER_LEDGER)
            .ok_or(ContinuityError::InvalidRevisionRequest)?;
        for artifact in &lineage.derived_artifact_refs {
            if artifact_owner
                .insert(
                    artifact.as_str().to_owned(),
                    lineage.lineage_root_id.as_str().to_owned(),
                )
                .is_some()
            {
                return Err(ContinuityError::RevisionConflict);
            }
        }
        if lineage.envelope_replacements.windows(2).any(|pair| {
            (
                pair[0].record_id.as_str(),
                pair[0].original_key_version.get(),
            ) >= (
                pair[1].record_id.as_str(),
                pair[1].original_key_version.get(),
            )
        }) {
            return Err(ContinuityError::RevisionConflict);
        }
        for replacement in &lineage.envelope_replacements {
            if !lineage.record_ids.contains(&replacement.record_id)
                || replacement.original_key_version.get() == 0
                || replacement.replacement_key_version.get()
                    <= replacement.original_key_version.get()
                || replacement.replacement_key_version.get()
                    > lineage.lineage_envelope_key_version.get()
                || !canonical_nonce(&replacement.original_nonce_b64)
                || !canonical_nonce(&replacement.replacement_nonce_b64)
                || replacement.replacement_digest
                    != derive_envelope_replacement_digest(replacement)?
            {
                return Err(ContinuityError::RevisionConflict);
            }
            replacement_chains
                .entry((
                    lineage.lineage_root_id.as_str().to_owned(),
                    replacement.record_id.as_str().to_owned(),
                ))
                .or_default()
                .push(replacement);
        }
        for chain in replacement_chains.values().filter(|chain| {
            chain
                .first()
                .is_some_and(|replacement| lineage.record_ids.contains(&replacement.record_id))
        }) {
            if chain.windows(2).any(|pair| {
                pair[0].replacement_key_version != pair[1].original_key_version
                    || pair[0].replacement_nonce_b64 != pair[1].original_nonce_b64
                    || pair[0].replacement_encrypted_record_ref
                        != pair[1].original_encrypted_record_ref
            }) {
                return Err(ContinuityError::RevisionConflict);
            }
        }
        if lineage.scope.namespace_ref != lineage.namespace.namespace_ref
            || lineage.lineage_envelope_key_version != lineage.namespace.key_version
            || lineage.record_ids.is_empty()
            || lineage.record_ids.len() > MAX_REVISION_MEMBERS_PER_LINEAGE
            || lineage.record_ids.first() != Some(&lineage.lineage_root_id)
            || lineage.record_ids.last() != Some(&lineage.lineage_head_record_id)
            || lineage.record_ids.iter().collect::<BTreeSet<_>>().len() != lineage.record_ids.len()
        {
            return Err(ContinuityError::RevisionConflict);
        }
        match lineage.lifecycle {
            RevisionLifecycle::Active
                if lineage.active_head_record_id.as_ref()
                    == Some(&lineage.lineage_head_record_id)
                    && lineage.purge_execution.is_none() => {}
            RevisionLifecycle::Archived
                if lineage.active_head_record_id.is_none() && lineage.purge_execution.is_none() => {
            }
            RevisionLifecycle::Forgotten if lineage.active_head_record_id.is_none() => {}
            _ => return Err(ContinuityError::RevisionConflict),
        }
        for record_id in &lineage.record_ids {
            if member_owner
                .insert(
                    record_id.as_str().to_owned(),
                    lineage.lineage_root_id.as_str().to_owned(),
                )
                .is_some()
            {
                return Err(ContinuityError::RevisionConflict);
            }
        }

        let present_count = lineage
            .record_ids
            .iter()
            .filter(|record_id| record_map.contains_key(record_id.as_str()))
            .count();
        match (&lineage.lifecycle, &lineage.purge_execution) {
            (RevisionLifecycle::Forgotten, Some(purge)) => {
                if purge.plan.lineage_root_id != lineage.lineage_root_id
                    || purge.plan.record_ids != lineage.record_ids
                    || purge.plan.derived_artifact_refs != lineage.derived_artifact_refs
                    || purge.progress_receipt
                        != purge_progress_receipt(
                            purge.status,
                            &purge.plan,
                            &purge.record_tombstones,
                            &purge.artifact_tombstones,
                        )?
                {
                    return Err(ContinuityError::RevisionConflict);
                }
                match purge.status {
                    PurgeExecutionStatusV1::Completed => {
                        if present_count != 0
                            || purge.record_tombstones.len() != lineage.record_ids.len()
                            || purge.artifact_tombstones.len()
                                != lineage.derived_artifact_refs.len()
                        {
                            return Err(ContinuityError::RevisionConflict);
                        }
                        for (record_id, tombstone) in
                            lineage.record_ids.iter().zip(&purge.record_tombstones)
                        {
                            let nonce = BASE64_STANDARD
                                .decode(&tombstone.nonce_b64)
                                .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
                            if &tombstone.record_id != record_id
                                || tombstone.namespace_ref != lineage.namespace.namespace_ref
                                || tombstone.key_version.get() == 0
                                || nonce.len() != 24
                                || BASE64_STANDARD.encode(&nonce) != tombstone.nonce_b64
                                || !nonce_authority.insert((
                                    tombstone.namespace_ref.as_str().to_owned(),
                                    tombstone.key_version.get(),
                                    tombstone.nonce_b64.clone(),
                                ))
                            {
                                return Err(ContinuityError::RevisionConflict);
                            }
                        }
                        for (artifact, tombstone) in lineage
                            .derived_artifact_refs
                            .iter()
                            .zip(&purge.artifact_tombstones)
                        {
                            if &tombstone.artifact_ref != artifact {
                                return Err(ContinuityError::RevisionConflict);
                            }
                        }
                    }
                    PurgeExecutionStatusV1::Authorized
                    | PurgeExecutionStatusV1::InProgress
                    | PurgeExecutionStatusV1::Failed => {
                        if present_count != lineage.record_ids.len()
                            || !purge.record_tombstones.is_empty()
                            || !purge.artifact_tombstones.is_empty()
                        {
                            return Err(ContinuityError::RevisionConflict);
                        }
                    }
                }
            }
            (RevisionLifecycle::Forgotten, None) => return Err(ContinuityError::RevisionConflict),
            (_, Some(_)) => return Err(ContinuityError::RevisionConflict),
            (_, None) if present_count != lineage.record_ids.len() => {
                return Err(ContinuityError::RevisionConflict)
            }
            _ => {}
        }

        for (revision, record_id) in lineage.record_ids.iter().enumerate() {
            let Some(record) = record_map.get(record_id.as_str()) else {
                continue;
            };
            let expected_predecessor = revision
                .checked_sub(1)
                .map(|previous| &lineage.record_ids[previous]);
            if record.namespace != lineage.namespace
                || record.scope != lineage.scope
                || record.record_type != lineage.record_type
                || record.key_version != lineage.lineage_envelope_key_version
                || record.revision.get() != revision as u64
                || record.predecessor_record_id.as_ref() != expected_predecessor
                || !nonce_authority.insert((
                    record.namespace.namespace_ref.as_str().to_owned(),
                    record.key_version.get(),
                    record.nonce_b64.clone(),
                ))
            {
                return Err(ContinuityError::RevisionConflict);
            }
        }
    }
    if snapshot
        .records
        .iter()
        .any(|record| !member_owner.contains_key(record.record_id.as_str()))
    {
        return Err(ContinuityError::RevisionConflict);
    }

    let revision_keys: BTreeSet<_> = snapshot
        .revision_idempotency
        .iter()
        .map(|entry| entry.idempotency_key.as_str())
        .collect();
    if snapshot
        .artifact_idempotency
        .iter()
        .any(|entry| revision_keys.contains(entry.idempotency_key.as_str()))
    {
        return Err(ContinuityError::IdempotencyConflict);
    }

    let mut replay_bytes = 0_usize;
    let mut successor_ids = BTreeMap::<String, BTreeSet<String>>::new();
    let mut successor_bindings = BTreeMap::<(String, String), &RevisionSuccessorBindingV1>::new();
    let mut successor_versions = BTreeMap::<(String, String), SafeU53>::new();
    let mut correction_roots = BTreeSet::<String>::new();
    let mut forget_roots = BTreeSet::<String>::new();
    let mut archived_heads = BTreeSet::<(String, String)>::new();
    for entry in &snapshot.revision_idempotency {
        let binding = &entry.replay_binding;
        let canonical = canonicalize(&CanonicalRevisionReplayDigest {
            domain: REVISION_IDEMPOTENCY_DOMAIN_V1,
            binding,
        })
        .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
        replay_bytes = replay_bytes
            .checked_add(canonical.len())
            .filter(|bytes| *bytes <= MAX_REPLAY_BINDING_CANONICAL_BYTES_PER_LEDGER)
            .ok_or(ContinuityError::InvalidRevisionRequest)?;
        if entry.idempotency_key != entry.canonical_request_digest
            || digest_revision_replay_binding(binding)? != entry.canonical_request_digest
            || entry.receipt.operation != binding.operation
        {
            return Err(ContinuityError::IdempotencyConflict);
        }
        binding
            .namespace
            .validate()
            .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
        binding
            .scope
            .validate()
            .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
        require_bounded_sorted_unique_artifacts(&binding.signed_source_event_refs)?;
        require_bounded_sorted_unique_artifacts(&binding.derived_artifact_refs)?;
        let lineage = lineage_map
            .get(entry.receipt.lineage_root_id.as_str())
            .ok_or(ContinuityError::RevisionConflict)?;
        if !same_namespace_identity(&binding.namespace, &lineage.namespace)
            || binding.namespace.key_version != binding.key_version
            || binding.key_version.get() > lineage.lineage_envelope_key_version.get()
            || binding.scope != lineage.scope
            || binding.record_type != lineage.record_type
        {
            return Err(ContinuityError::RevisionConflict);
        }

        let root = lineage.lineage_root_id.as_str().to_owned();
        let append = matches!(
            binding.operation,
            RevisionOperation::Create
                | RevisionOperation::Revise
                | RevisionOperation::OwnerCorrection
                | RevisionOperation::Rollback
        );
        if append != binding.successor.is_some() {
            return Err(ContinuityError::InvalidRevisionRequest);
        }
        if let Some(successor) = &binding.successor {
            let expected_author = binding.actor.required_author_kind();
            let successor_nonce = BASE64_STANDARD
                .decode(&successor.nonce_b64)
                .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
            if successor.author_kind.as_str() != expected_author
                || successor_nonce.len() != 24
                || BASE64_STANDARD.encode(&successor_nonce) != successor.nonce_b64
                || !lineage.record_ids.contains(&successor.record_id)
                || !successor_ids
                    .entry(root.clone())
                    .or_default()
                    .insert(successor.record_id.as_str().to_owned())
                || successor_bindings
                    .insert(
                        (root.clone(), successor.record_id.as_str().to_owned()),
                        successor,
                    )
                    .is_some()
                || successor_versions
                    .insert(
                        (root.clone(), successor.record_id.as_str().to_owned()),
                        binding.key_version,
                    )
                    .is_some()
            {
                return Err(ContinuityError::RevisionConflict);
            }
            if let Some(record) = record_map.get(successor.record_id.as_str()) {
                if successor.revision != record.revision
                    || successor.predecessor_record_id != record.predecessor_record_id
                    || successor.author_kind != record.author_kind
                {
                    return Err(ContinuityError::RevisionConflict);
                }
                replacement_chain_matches_retained(
                    replacement_chains
                        .get(&(root.clone(), successor.record_id.as_str().to_owned())),
                    binding.key_version,
                    successor,
                    record,
                )?;
            }
        }

        match binding.operation {
            RevisionOperation::Create => {
                let successor = binding.successor.as_ref().unwrap();
                if binding.expected_head_record_id.is_some()
                    || successor.record_id != lineage.lineage_root_id
                    || successor.revision.get() != 0
                    || successor.predecessor_record_id.is_some()
                    || binding.rollback_source_record_id.is_some()
                    || !binding.derived_artifact_refs.is_empty()
                    || entry.receipt.lifecycle != RevisionLifecycle::Active
                    || entry.receipt.head_record_id.as_ref() != Some(&successor.record_id)
                    || entry.receipt.purge_plan.is_some()
                {
                    return Err(ContinuityError::RevisionConflict);
                }
            }
            RevisionOperation::Revise | RevisionOperation::OwnerCorrection => {
                let successor = binding.successor.as_ref().unwrap();
                if binding.expected_head_record_id.as_ref()
                    != successor.predecessor_record_id.as_ref()
                    || binding.rollback_source_record_id.is_some()
                    || !binding.derived_artifact_refs.is_empty()
                    || entry.receipt.lifecycle != RevisionLifecycle::Active
                    || entry.receipt.head_record_id.as_ref() != Some(&successor.record_id)
                    || entry.receipt.purge_plan.is_some()
                    || (binding.operation == RevisionOperation::OwnerCorrection
                        && binding.actor != RevisionActor::Owner)
                {
                    return Err(ContinuityError::RevisionConflict);
                }
                if binding.operation == RevisionOperation::OwnerCorrection {
                    correction_roots.insert(root);
                }
            }
            RevisionOperation::Rollback => {
                let successor = binding.successor.as_ref().unwrap();
                let source = binding
                    .rollback_source_record_id
                    .as_ref()
                    .ok_or(ContinuityError::RevisionConflict)?;
                let source_revision = lineage
                    .record_ids
                    .iter()
                    .position(|record_id| record_id == source)
                    .ok_or(ContinuityError::RevisionConflict)?;
                let expected_revision = lineage
                    .record_ids
                    .iter()
                    .position(|record_id| {
                        Some(record_id) == binding.expected_head_record_id.as_ref()
                    })
                    .ok_or(ContinuityError::RevisionConflict)?;
                if binding.actor != RevisionActor::Owner
                    || binding.expected_head_record_id.as_ref()
                        != successor.predecessor_record_id.as_ref()
                    || !lineage.record_ids.contains(source)
                    || source_revision >= expected_revision
                    || entry.receipt.lifecycle != RevisionLifecycle::Active
                    || entry.receipt.head_record_id.as_ref() != Some(&successor.record_id)
                    || entry.receipt.purge_plan.is_some()
                    || !binding.derived_artifact_refs.is_empty()
                {
                    return Err(ContinuityError::RevisionConflict);
                }
            }
            RevisionOperation::Archive => {
                let head = binding
                    .expected_head_record_id
                    .as_ref()
                    .ok_or(ContinuityError::RevisionConflict)?;
                if binding.actor != RevisionActor::Owner
                    || binding.successor.is_some()
                    || binding.rollback_source_record_id.is_some()
                    || !binding.derived_artifact_refs.is_empty()
                    || !lineage.record_ids.contains(head)
                    || entry.receipt.lifecycle != RevisionLifecycle::Archived
                    || entry.receipt.head_record_id.as_ref() != Some(head)
                    || entry.receipt.purge_plan.is_some()
                {
                    return Err(ContinuityError::RevisionConflict);
                }
                archived_heads.insert((root, head.as_str().to_owned()));
            }
            RevisionOperation::Forget => {
                let purge = entry
                    .receipt
                    .purge_plan
                    .as_ref()
                    .ok_or(ContinuityError::RevisionConflict)?;
                if binding.actor != RevisionActor::Owner
                    || binding.successor.is_some()
                    || binding.rollback_source_record_id.is_some()
                    || binding.expected_head_record_id.as_ref()
                        != Some(&lineage.lineage_head_record_id)
                    || binding.derived_artifact_refs != lineage.derived_artifact_refs
                    || entry.receipt.lifecycle != RevisionLifecycle::Forgotten
                    || entry.receipt.head_record_id.is_some()
                    || purge.lineage_root_id != lineage.lineage_root_id
                    || purge.record_ids != lineage.record_ids
                    || purge.derived_artifact_refs != lineage.derived_artifact_refs
                    || !forget_roots.insert(root)
                {
                    return Err(ContinuityError::RevisionConflict);
                }
            }
        }
    }

    let mut artifact_history =
        BTreeMap::<String, BTreeMap<u64, &ArtifactIdempotencySnapshotV1>>::new();
    for entry in &snapshot.artifact_idempotency {
        let binding = &entry.replay_binding;
        let canonical = canonicalize(&CanonicalArtifactReplayDigest {
            domain: ARTIFACT_REGISTRATION_IDEMPOTENCY_DOMAIN_V1,
            binding,
        })
        .map_err(|_| ContinuityError::InvalidRevisionRequest)?;
        replay_bytes = replay_bytes
            .checked_add(canonical.len())
            .filter(|bytes| *bytes <= MAX_REPLAY_BINDING_CANONICAL_BYTES_PER_LEDGER)
            .ok_or(ContinuityError::InvalidRevisionRequest)?;
        if entry.idempotency_key != entry.canonical_request_digest
            || digest_artifact_replay_binding(binding)? != entry.canonical_request_digest
            || entry.receipt.lineage_root_id != binding.lineage_root_id
        {
            return Err(ContinuityError::IdempotencyConflict);
        }
        let lineage = lineage_map
            .get(binding.lineage_root_id.as_str())
            .ok_or(ContinuityError::RevisionConflict)?;
        require_bounded_sorted_unique_artifacts(&binding.derived_artifact_refs)?;
        require_bounded_sorted_unique_artifacts(&entry.receipt.newly_registered)?;
        require_bounded_sorted_unique_artifacts(&entry.receipt.complete_inventory)?;
        if binding.derived_artifact_refs.is_empty()
            || entry.receipt.newly_registered.is_empty()
            || !same_namespace_identity(&binding.namespace, &lineage.namespace)
            || binding.namespace.key_version != binding.lineage_envelope_key_version
            || binding.lineage_envelope_key_version.get()
                > lineage.lineage_envelope_key_version.get()
            || binding.scope != lineage.scope
            || binding.record_type != lineage.record_type
            || !lineage
                .record_ids
                .contains(&binding.expected_head_record_id)
            || binding
                .derived_artifact_refs
                .iter()
                .any(|artifact| !entry.receipt.complete_inventory.contains(artifact))
            || entry
                .receipt
                .newly_registered
                .iter()
                .any(|artifact| !binding.derived_artifact_refs.contains(artifact))
            || entry
                .receipt
                .complete_inventory
                .iter()
                .any(|artifact| !lineage.derived_artifact_refs.contains(artifact))
        {
            return Err(ContinuityError::RevisionConflict);
        }
        if artifact_history
            .entry(binding.lineage_root_id.as_str().to_owned())
            .or_default()
            .insert(binding.artifact_sequence.get(), entry)
            .is_some()
        {
            return Err(ContinuityError::RevisionConflict);
        }
    }

    let mut artifact_history_inventory = BTreeMap::<String, Vec<Sha256Ref>>::new();
    for (root, entries) in artifact_history {
        let mut inventory = Vec::<Sha256Ref>::new();
        for (expected_sequence, (sequence, entry)) in entries.iter().enumerate() {
            if *sequence != expected_sequence as u64 {
                return Err(ContinuityError::RevisionConflict);
            }
            let expected_new: Vec<_> = entry
                .replay_binding
                .derived_artifact_refs
                .iter()
                .filter(|artifact| !inventory.contains(artifact))
                .cloned()
                .collect();
            if expected_new.is_empty() || entry.receipt.newly_registered != expected_new {
                return Err(ContinuityError::RevisionConflict);
            }
            inventory.extend(expected_new);
            inventory.sort();
            if entry.receipt.complete_inventory != inventory {
                return Err(ContinuityError::RevisionConflict);
            }
        }
        artifact_history_inventory.insert(root, inventory);
    }

    for lineage in &snapshot.lineages {
        let root = lineage.lineage_root_id.as_str();
        let successor_set = successor_ids.get(root).cloned().unwrap_or_default();
        let expected_set: BTreeSet<_> = lineage
            .record_ids
            .iter()
            .map(|record_id| record_id.as_str().to_owned())
            .collect();
        if successor_set != expected_set
            || lineage.pinned_owner_correction != correction_roots.contains(root)
        {
            return Err(ContinuityError::RevisionConflict);
        }
        for (revision, record_id) in lineage.record_ids.iter().enumerate() {
            let successor = successor_bindings
                .get(&(root.to_owned(), record_id.as_str().to_owned()))
                .ok_or(ContinuityError::RevisionConflict)?;
            let predecessor = revision
                .checked_sub(1)
                .map(|previous| &lineage.record_ids[previous]);
            if successor.revision.get() != revision as u64
                || successor.predecessor_record_id.as_ref() != predecessor
            {
                return Err(ContinuityError::RevisionConflict);
            }
        }
        if let Some(purge) = &lineage.purge_execution {
            if purge.status == PurgeExecutionStatusV1::Completed {
                for tombstone in &purge.record_tombstones {
                    let key = (root.to_owned(), tombstone.record_id.as_str().to_owned());
                    let successor = successor_bindings
                        .get(&key)
                        .ok_or(ContinuityError::RevisionConflict)?;
                    replacement_chain_matches_tombstone(
                        replacement_chains.get(&key),
                        *successor_versions
                            .get(&key)
                            .ok_or(ContinuityError::RevisionConflict)?,
                        successor,
                        tombstone,
                    )?;
                }
            }
        }

        match lineage.lifecycle {
            RevisionLifecycle::Active if forget_roots.contains(root) => {
                return Err(ContinuityError::RevisionConflict)
            }
            RevisionLifecycle::Archived
                if forget_roots.contains(root)
                    || !archived_heads.contains(&(
                        root.to_owned(),
                        lineage.lineage_head_record_id.as_str().to_owned(),
                    )) =>
            {
                return Err(ContinuityError::RevisionConflict)
            }
            RevisionLifecycle::Forgotten if !forget_roots.contains(root) => {
                return Err(ContinuityError::RevisionConflict)
            }
            _ => {}
        }

        let seen_artifacts = artifact_history_inventory
            .get(root)
            .map(Vec::as_slice)
            .unwrap_or_default();
        if seen_artifacts != lineage.derived_artifact_refs {
            return Err(ContinuityError::RevisionConflict);
        }

        let revision_entry = snapshot
            .revision_idempotency
            .iter()
            .find(|entry| entry.idempotency_key == lineage.authority_mutation_idempotency_key);
        let artifact_entry = snapshot
            .artifact_idempotency
            .iter()
            .find(|entry| entry.idempotency_key == lineage.authority_mutation_idempotency_key);
        match (revision_entry, artifact_entry) {
            (Some(entry), None) => {
                let expected_head = match lineage.lifecycle {
                    RevisionLifecycle::Forgotten => None,
                    _ => Some(&lineage.lineage_head_record_id),
                };
                if entry.receipt.lineage_root_id != lineage.lineage_root_id
                    || entry.receipt.lifecycle != lineage.lifecycle
                    || entry.receipt.head_record_id.as_ref() != expected_head
                {
                    return Err(ContinuityError::RevisionConflict);
                }
            }
            (None, Some(entry)) => {
                if lineage.lifecycle == RevisionLifecycle::Forgotten
                    || entry.receipt.lineage_root_id != lineage.lineage_root_id
                    || entry.receipt.complete_inventory != lineage.derived_artifact_refs
                    || entry.replay_binding.expected_head_record_id
                        != lineage.lineage_head_record_id
                {
                    return Err(ContinuityError::RevisionConflict);
                }
            }
            _ => return Err(ContinuityError::IdempotencyConflict),
        }
    }

    let canonical_snapshot =
        canonicalize(snapshot).map_err(|_| ContinuityError::InvalidRevisionRequest)?;
    if canonical_snapshot.len() > MAX_REVISION_SNAPSHOT_CANONICAL_BYTES {
        return Err(ContinuityError::InvalidRevisionRequest);
    }
    Ok(())
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
            envelope_replacements: Vec::new(),
            record_ids: vec![opaque(root), opaque(head)],
            head_record_id: opaque(head),
            lifecycle,
            pinned_owner_correction,
            derived_artifact_inventory: vec![hash('8'), hash('9')],
            authority_mutation_idempotency_key: hash(transition_key),
            purge_execution: None,
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
        ledger.lineages.insert("root-z".into(), {
            let mut state = lineage("root-z", "head-z", RevisionLifecycle::Active, false, 'b');
            state.derived_artifact_inventory = vec![hash('a'), hash('b')];
            state
        });
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
                .map(|member| indexed_hash(index * MAX_DERIVED_ARTIFACTS_PER_LINEAGE + member))
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

    #[test]
    fn completed_purge_permanently_reserves_record_id_and_namespace_nonce() {
        let mut ledger = RevisionLedger::default();
        let original = initial_record("reserved-root");
        ledger
            .apply(lifecycle_request(
                RevisionOperation::Create,
                "reserved-root",
                Some(original.clone()),
            ))
            .unwrap();
        ledger
            .apply(lifecycle_request(
                RevisionOperation::Forget,
                "reserved-root",
                None,
            ))
            .unwrap();
        ledger
            .advance_purge(&opaque("reserved-root"), PurgeExecutionStatusV1::InProgress)
            .unwrap();
        ledger
            .advance_purge(&opaque("reserved-root"), PurgeExecutionStatusV1::Completed)
            .unwrap();

        assert!(ledger.record_id_reserved(&opaque("reserved-root")));
        assert_eq!(
            ledger.require_unique_namespace_nonce(&original),
            Err(ContinuityError::NonceCollision)
        );
    }

    #[test]
    fn live_paths_reject_opposite_domain_idempotency_keys_before_mutation() {
        let mut revision_path = RevisionLedger::default();
        create_lineage(&mut revision_path, "cross-domain-revision");
        let artifacts = vec![hash('8')];
        let artifact_ref = hash('a');
        let artifact_key = revision_path
            .derive_artifact_registration_idempotency_key(
                &opaque("cross-domain-revision"),
                &opaque("cross-domain-revision"),
                &artifact_ref,
                &artifacts,
            )
            .unwrap();
        revision_path
            .register_derived_artifacts(
                artifact_key.clone(),
                artifact_ref,
                &opaque("cross-domain-revision"),
                &opaque("cross-domain-revision"),
                artifacts,
            )
            .unwrap();
        let archive = lifecycle_request(RevisionOperation::Archive, "cross-domain-revision", None);
        let artifact_entry = revision_path
            .artifact_idempotency
            .get(artifact_key.as_str())
            .unwrap()
            .clone();
        revision_path
            .artifact_idempotency
            .insert(archive.idempotency_key.as_str().to_owned(), artifact_entry);
        assert_eq!(
            revision_path.apply(archive),
            Err(ContinuityError::IdempotencyConflict)
        );
        assert_eq!(
            revision_path.lifecycle(&opaque("cross-domain-revision")),
            Some(RevisionLifecycle::Active)
        );

        let mut artifact_path = RevisionLedger::default();
        create_lineage(&mut artifact_path, "cross-domain-artifact");
        let artifacts = vec![hash('9')];
        let request_ref = hash('b');
        let artifact_key = artifact_path
            .derive_artifact_registration_idempotency_key(
                &opaque("cross-domain-artifact"),
                &opaque("cross-domain-artifact"),
                &request_ref,
                &artifacts,
            )
            .unwrap();
        let revision_entry = artifact_path.idempotency.values().next().unwrap().clone();
        artifact_path
            .idempotency
            .insert(artifact_key.as_str().to_owned(), revision_entry);
        assert_eq!(
            artifact_path.register_derived_artifacts(
                artifact_key,
                request_ref,
                &opaque("cross-domain-artifact"),
                &opaque("cross-domain-artifact"),
                artifacts,
            ),
            Err(ContinuityError::IdempotencyConflict)
        );
        assert!(artifact_path
            .lineage(&opaque("cross-domain-artifact"))
            .unwrap()
            .derived_artifact_inventory
            .is_empty());
    }
}
