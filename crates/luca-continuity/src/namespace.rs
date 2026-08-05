//! Exact protocol namespace wrappers.

use crate::ContinuityError;
use luca_protocol::ContinuityNamespaceV1;

/// A validated, exact continuity namespace authority key.
///
/// Equality intentionally includes every protocol field. In particular, a
/// matching `namespace_ref` alone never authorizes access across an owner,
/// resident, namespace kind, or key version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamespaceKey(ContinuityNamespaceV1);

impl NamespaceKey {
    /// Wrap a validated protocol namespace without deriving or inferring fields.
    pub fn new(namespace: ContinuityNamespaceV1) -> Result<Self, ContinuityError> {
        namespace
            .validate()
            .map_err(|_| ContinuityError::InvalidNamespace)?;
        Ok(Self(namespace))
    }

    /// Borrow the exact protocol namespace.
    pub fn as_protocol(&self) -> &ContinuityNamespaceV1 {
        &self.0
    }

    /// Consume this wrapper and return the exact protocol namespace.
    pub fn into_protocol(self) -> ContinuityNamespaceV1 {
        self.0
    }

    /// Return whether `candidate` is the same complete namespace authority.
    pub fn permits_namespace(&self, candidate: &ContinuityNamespaceV1) -> bool {
        self.0 == *candidate
    }
}

impl TryFrom<ContinuityNamespaceV1> for NamespaceKey {
    type Error = ContinuityError;

    fn try_from(namespace: ContinuityNamespaceV1) -> Result<Self, Self::Error> {
        Self::new(namespace)
    }
}
