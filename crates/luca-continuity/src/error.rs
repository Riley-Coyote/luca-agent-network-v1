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
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for ContinuityError {}
