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
pub use scope::NamespaceScope;
