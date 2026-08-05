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
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for ContinuityError {}
