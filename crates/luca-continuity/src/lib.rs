//! Pure, deterministic continuity namespace and scope enforcement.
//!
//! This crate does not perform key custody, disk persistence, network access,
//! or platform integration. It establishes exact authority boundaries and the
//! pure authenticated-record primitives that later storage and retrieval
//! components must preserve.

#![forbid(unsafe_code)]

mod assay;
mod capsule;
mod context;
mod envelope;
mod error;
mod fixtures;
mod handoff;
mod namespace;
mod repository;
mod retrieval;
mod retrieval_fts;
mod retrieval_graph;
mod retrieval_material;
mod revision;
mod scope;

pub use assay::{
    build_body_free_run_record, build_generation_packet, build_reader_packet, validate_assay_v1,
    AssayConditionItemV1, AssayConditionV1, AssayError, AssayFaultModeV1, AssayGenerationPacketV1,
    AssayGoldenEventKindV1, AssayGoldenEventStateV1, AssayGoldenEventV1, AssayGoldenLifeV1,
    AssayHardGateResultV1, AssayLayerStatusV1, AssayManifestV1, AssayPrivateRunV1,
    AssayReaderPacketV1, AssayRunMetadataV1, AssayRunRecordV1, AssayScenarioClassV1,
    AssayScenarioV1, ASSAY_GENERATION_PACKET_SCHEMA_V1, ASSAY_GOLDEN_LIFE_SCHEMA_V1,
    ASSAY_MANIFEST_SCHEMA_V1, ASSAY_PRIVATE_RUN_SCHEMA_V1, ASSAY_READER_PACKET_SCHEMA_V1,
    ASSAY_RUN_RECORD_SCHEMA_V1, ASSAY_VERSION_V1,
};
pub use capsule::{
    classify_capsule_successor, derive_portable_capsule_id, parse_portable_capsule_envelope,
    project_portable_capsule, CapsuleSuccessorDisposition, PortableCapsuleBodyValue,
    PortableCapsuleCurrentStateV1, PortableCapsuleEnvelopeV1, MAX_PORTABLE_CAPSULE_BODY_JSON_BYTES,
    MAX_PORTABLE_CAPSULE_ENVELOPE_BYTES, MAX_PORTABLE_CAPSULE_SEGMENT_BYTES,
    MAX_PORTABLE_CAPSULE_STATE_BYTES, PORTABLE_CAPSULE_ENVELOPE_SCHEMA_V1,
    PORTABLE_CAPSULE_NIP_AE_SLUG,
};
pub use context::{
    ContinuityContextOutput, ContinuityContextResolver, ContinuityLayerMaterial,
    ContinuityReadSnapshot, ContinuityReferenceItem, ContinuityWakeCompileInput,
    ContinuityWakeCompileOutput, ContinuityWakeCompileReceipt, ContinuityWakeCompiler,
    ContinuityWakeSourceItem,
};
pub use envelope::{
    canonical_record_aad, decrypt_record, encrypt_record, DecryptedRecordBody, RecordMetadata,
    RECORD_AAD_DOMAIN_V1,
};
pub use error::ContinuityError;
pub use fixtures::{synthetic_fixture_index, FixtureIndex, SyntheticFixture};
pub use handoff::{evaluate_handoff_salience, HandoffSalienceDecision, HandoffSalienceSignals};
pub use namespace::NamespaceKey;
pub use repository::{
    AuthenticatedRecord, CorruptRecordDiagnostic, EncryptedRecordRepository,
    InMemoryEncryptedRecordRepository, RecordWriteOutcome, MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES,
};
pub use retrieval::{
    InMemoryRetrievalIndex, InMemoryVectorIndex, RetrievalEdge, RetrievalHit, RetrievalPathNode,
    RetrievalQuery, RetrievalRecord, RetrievalRecordInput, RetrievalRecordState, RetrievalRelation,
    RetrievalResult, RetrievalText, MAX_ACTIVATED_CANDIDATES, MAX_GRAPH_DEPTH,
    MAX_HYDRATED_BODY_BYTES, MAX_HYDRATED_EDGES, MAX_HYDRATED_RECORDS, MAX_HYDRATED_TAG_BYTES,
    MAX_LEXICAL_SEEDS, MAX_OUTGOING_EDGES, MAX_RETRIEVAL_CUE_BYTES, MAX_RETRIEVAL_HITS,
    MAX_VECTOR_COMPONENTS, MAX_VECTOR_ENTRIES,
};
pub use retrieval_material::{
    RetrievalMaterialV1, RETRIEVAL_MATERIAL_PROTOCOL_V1, RETRIEVAL_MATERIAL_VERSION_V1,
};
pub use revision::{
    derive_envelope_replacement_digest, derive_revision_idempotency_key,
    encrypted_record_reference, ActiveRevisionHead, ArtifactIdempotencySnapshotV1,
    ArtifactRegistrationReceipt, ArtifactReplayBindingV1, DurableContinuityRecordKind,
    EnvelopeReplacementV1, PurgeExecutionStateV1, PurgeExecutionStatusV1, PurgePlan,
    PurgeProgressReceiptV1, PurgedArtifactTombstoneV1, PurgedRecordTombstoneV1, RevisionActor,
    RevisionIdempotencySnapshotV1, RevisionLedger, RevisionLedgerSnapshotV1, RevisionLifecycle,
    RevisionLineageSnapshotV1, RevisionOperation, RevisionReceipt, RevisionReplayBindingV1,
    RevisionRequest, RevisionSuccessorBindingV1, MAX_ARTIFACT_IDEMPOTENCY_ENTRIES,
    MAX_DERIVED_ARTIFACTS_PER_LEDGER, MAX_DERIVED_ARTIFACTS_PER_LINEAGE,
    MAX_ENVELOPE_REPLACEMENTS_PER_LEDGER, MAX_REPLAY_BINDING_CANONICAL_BYTES_PER_LEDGER,
    MAX_REPLAY_NESTED_REFS_PER_LEDGER, MAX_REVISION_AUTHORITY_HEADS,
    MAX_REVISION_IDEMPOTENCY_ENTRIES, MAX_REVISION_MEMBERS_PER_LEDGER,
    MAX_REVISION_MEMBERS_PER_LINEAGE, MAX_REVISION_SNAPSHOT_CANONICAL_BYTES,
    MAX_REVISION_SNAPSHOT_ENCODED_CIPHERTEXT_BYTES, MAX_REVISION_SNAPSHOT_RECORDS,
    REVISION_AUTHORITY_SCHEMA_V1, REVISION_LEDGER_SNAPSHOT_SCHEMA_V1,
};
pub use scope::NamespaceScope;
