//! Exact scope enforcement with no partial matching or membership inference.

use crate::{ContinuityError, NamespaceKey};
use luca_protocol::ContinuityScopeV1;

/// One validated protocol scope bound to one exact validated namespace.
///
/// The `scope_ref` is retained as protocol data but is never used as a lookup
/// shortcut: matching requires equality of the entire namespace and scope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamespaceScope {
    namespace: NamespaceKey,
    scope: ContinuityScopeV1,
}

impl NamespaceScope {
    /// Bind an exact scope to an exact namespace.
    pub fn new(namespace: NamespaceKey, scope: ContinuityScopeV1) -> Result<Self, ContinuityError> {
        scope
            .validate()
            .map_err(|_| ContinuityError::InvalidScope)?;
        if scope.namespace_ref != namespace.as_protocol().namespace_ref {
            return Err(ContinuityError::ScopeNamespaceMismatch);
        }
        Ok(Self { namespace, scope })
    }

    /// Borrow the namespace authority for this scope.
    pub fn namespace(&self) -> &NamespaceKey {
        &self.namespace
    }

    /// Borrow the exact protocol scope.
    pub fn as_protocol(&self) -> &ContinuityScopeV1 {
        &self.scope
    }

    /// Return whether a request supplies the same complete namespace and scope.
    pub fn permits(&self, requested: &NamespaceScope) -> bool {
        self == requested
    }

    /// Require an exact full-field namespace and scope match.
    pub fn require_exact(&self, requested: &NamespaceScope) -> Result<(), ContinuityError> {
        self.permits(requested)
            .then_some(())
            .ok_or(ContinuityError::AccessDenied)
    }
}
