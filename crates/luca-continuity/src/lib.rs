//! Pure, deterministic continuity namespace and scope enforcement.
//!
//! This crate does not perform key custody, disk persistence, network access,
//! or platform integration. It establishes exact authority boundaries and the
//! pure authenticated-record primitives that later storage and retrieval
//! components must preserve.

#![forbid(unsafe_code)]

mod envelope;
mod error;
mod fixtures;
mod namespace;
mod repository;
mod retrieval;
mod retrieval_fts;
mod retrieval_graph;
mod revision;
mod scope;

pub use envelope::{
    canonical_record_aad, decrypt_record, encrypt_record, DecryptedRecordBody, RecordMetadata,
    RECORD_AAD_DOMAIN_V1,
};
pub use error::ContinuityError;
pub use fixtures::{synthetic_fixture_index, FixtureIndex, SyntheticFixture};
pub use namespace::NamespaceKey;
pub use repository::{
    AuthenticatedRecord, CorruptRecordDiagnostic, EncryptedRecordRepository,
    InMemoryEncryptedRecordRepository, RecordWriteOutcome, MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES,
};
pub use retrieval::{
    InMemoryRetrievalIndex, InMemoryVectorIndex, RetrievalEdge, RetrievalHit, RetrievalPathNode,
    RetrievalQuery, RetrievalRecord, RetrievalRecordInput, RetrievalRecordState, RetrievalRelation,
    RetrievalResult, MAX_ACTIVATED_CANDIDATES, MAX_GRAPH_DEPTH, MAX_HYDRATED_BODY_BYTES,
    MAX_HYDRATED_EDGES, MAX_HYDRATED_RECORDS, MAX_HYDRATED_TAG_BYTES, MAX_LEXICAL_SEEDS,
    MAX_OUTGOING_EDGES, MAX_RETRIEVAL_CUE_BYTES, MAX_RETRIEVAL_HITS, MAX_VECTOR_COMPONENTS,
    MAX_VECTOR_ENTRIES,
};
pub use revision::{
    derive_revision_idempotency_key, encrypted_record_reference, ArtifactRegistrationReceipt,
    DurableContinuityRecordKind, PurgePlan, RevisionActor, RevisionLedger, RevisionLifecycle,
    RevisionOperation, RevisionReceipt, RevisionRequest,
};
pub use scope::NamespaceScope;
