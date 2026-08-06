//! Errors returned while establishing exact continuity authority.

use core::fmt;

/// A body-free error from namespace, scope, or fixture validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContinuityError {
    /// A protocol namespace failed its own structural validation.
    InvalidNamespace,
    /// A protocol scope failed its own structural validation.
    InvalidScope,
    /// A scope named a different namespace reference than its enclosing namespace.
    ScopeNamespaceMismatch,
    /// A requested namespace or scope was not an exact match.
    AccessDenied,
    /// Fixture identifiers must be unique to preserve deterministic lookup.
    DuplicateFixtureId,
    /// A checked-in synthetic fixture could not be represented by protocol scalars.
    InvalidFixture,
    /// Record metadata or its protocol envelope was structurally invalid.
    InvalidRecord,
    /// Canonical associated-data construction failed.
    CanonicalAssociatedData,
    /// The record's stored associated-data digest did not match its metadata.
    AssociatedDataMismatch,
    /// Authenticated encryption failed without exposing record content.
    EncryptionFailed,
    /// Authenticated decryption failed without exposing record content.
    DecryptionFailed,
    /// A nonce was already used in one namespace/key-version domain.
    NonceCollision,
    /// A logical record identifier was replayed with different canonical data.
    ReplayConflict,
    /// A malformed or internally inconsistent encrypted record was isolated.
    CorruptRecord,
    /// A revision request was incomplete or did not match its operation.
    InvalidRevisionRequest,
    /// A revision successor did not bind to the exact current lineage head.
    RevisionConflict,
    /// The requested operation is not allowed in the lineage lifecycle state.
    LifecycleConflict,
    /// A pinned owner correction requires a later explicit owner correction.
    PinnedOwnerCorrection,
    /// A record type was not in the closed durable continuity allowlist.
    UnsupportedRecordType,
    /// One idempotency key was reused for a different canonical operation.
    IdempotencyConflict,
    /// A decrypted record was not safe to admit to the retrieval index.
    InvalidRetrievalRecord,
    /// An untrusted retrieval cue exceeded the fixed process-memory bound.
    RetrievalCueTooLarge,
    /// The process-memory-only lexical index could not complete an operation.
    RetrievalIndex,
    /// A caller-supplied memory-only vector was empty, duplicate, or oversized.
    InvalidRetrievalVector,
    /// A pre-turn context request failed the frozen protocol contract.
    InvalidContextRequest,
    /// One of the five fixed context layers had an invalid status/material shape.
    InvalidContextLayer,
    /// The caller's packet budget could not contain the fixed safe envelope.
    ContextPacketBudgetTooSmall,
    /// Canonical packet or receipt construction failed without exposing content.
    ContextPacketEncoding,
}

impl fmt::Display for ContinuityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::InvalidNamespace => "invalid continuity namespace",
            Self::InvalidScope => "invalid continuity scope",
            Self::ScopeNamespaceMismatch => "scope does not belong to namespace",
            Self::AccessDenied => "continuity access requires an exact namespace and scope match",
            Self::DuplicateFixtureId => "duplicate synthetic fixture identifier",
            Self::InvalidFixture => "invalid synthetic continuity fixture",
            Self::InvalidRecord => "invalid encrypted continuity record",
            Self::CanonicalAssociatedData => "unable to canonicalize encrypted record metadata",
            Self::AssociatedDataMismatch => "encrypted record associated-data digest mismatch",
            Self::EncryptionFailed => "continuity record encryption failed",
            Self::DecryptionFailed => "continuity record authentication failed",
            Self::NonceCollision => "continuity nonce collision",
            Self::ReplayConflict => "continuity record replay conflict",
            Self::CorruptRecord => "corrupt continuity record isolated",
            Self::InvalidRevisionRequest => "invalid continuity revision request",
            Self::RevisionConflict => "continuity revision does not match the current lineage",
            Self::LifecycleConflict => "continuity lifecycle does not allow this operation",
            Self::PinnedOwnerCorrection => {
                "pinned owner correction requires a later explicit owner correction"
            }
            Self::UnsupportedRecordType => "record type is not allowed for durable continuity",
            Self::IdempotencyConflict => "continuity idempotency key conflicts with prior request",
            Self::InvalidRetrievalRecord => "invalid continuity retrieval record",
            Self::RetrievalCueTooLarge => "continuity retrieval cue exceeds the fixed bound",
            Self::RetrievalIndex => "continuity memory-only retrieval index failed",
            Self::InvalidRetrievalVector => "invalid memory-only continuity retrieval vector",
            Self::InvalidContextRequest => "invalid continuity context request",
            Self::InvalidContextLayer => "invalid continuity context layer",
            Self::ContextPacketBudgetTooSmall => {
                "continuity packet budget cannot contain the fixed safe envelope"
            }
            Self::ContextPacketEncoding => "unable to construct bounded continuity context packet",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for ContinuityError {}
