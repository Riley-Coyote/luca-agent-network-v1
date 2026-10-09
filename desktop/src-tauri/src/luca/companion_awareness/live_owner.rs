//! Live access authority is distinct from a retained public denial scope.

use luca_protocol::Hex64;

use super::store::AwarenessStoreError;
use crate::app_state::AppState;

/// Non-serializable borrowed owner proof. It retains no key and rechecks the
/// current signable identity immediately before each synchronous host effect.
/// Its private fields cannot be constructed from renderer/model public keys.
pub(crate) struct LiveAwarenessOwner<'a> {
    state: &'a AppState,
    owner: Hex64,
}

/// Borrowed proof holding current identity mutation authority. It is neither
/// clonable nor serializable and cannot outlive the short synchronous effect.
pub(crate) struct LiveAwarenessLease<'a> {
    owner: &'a Hex64,
    _guard: std::sync::MutexGuard<'a, ()>,
}
impl LiveAwarenessLease<'_> {
    /// Public identity only; the private held guard establishes current scope.
    pub(crate) fn owner(&self) -> &Hex64 {
        self.owner
    }
}

impl<'a> LiveAwarenessOwner<'a> {
    /// Authenticate through native AppState rather than input content.
    pub(crate) fn authenticate(state: &'a AppState) -> Result<Self, AwarenessStoreError> {
        Ok(Self {
            state,
            owner: current_owner(state)?,
        })
    }

    /// Public identity only; this value alone cannot authorize an awareness use.
    pub(crate) fn owner(&self) -> &Hex64 {
        &self.owner
    }

    /// Identity mutation precedes the awareness lock. An imported/recovery
    /// identity cannot inherit a previous owner's admitted effect mid-call.
    pub(crate) fn with_current<T>(
        &self,
        effect: impl FnOnce() -> Result<T, AwarenessStoreError>,
    ) -> Result<T, AwarenessStoreError> {
        let _lease = self.lease()?;
        effect()
    }

    /// Acquire once before continuity/awareness effect locks. Nested authority
    /// checks use this proof instead of reacquiring a non-reentrant identity lock.
    pub(crate) fn lease(&self) -> Result<LiveAwarenessLease<'_>, AwarenessStoreError> {
        let guard = self
            .state
            .identity_mutation
            .lock()
            .map_err(|_| AwarenessStoreError::Unavailable)?;
        if current_owner(self.state)? != self.owner {
            return Err(AwarenessStoreError::Invalid);
        }
        Ok(LiveAwarenessLease {
            owner: &self.owner,
            _guard: guard,
        })
    }
}

fn current_owner(state: &AppState) -> Result<Hex64, AwarenessStoreError> {
    let keys = state
        .signing_keys()
        .map_err(|_| AwarenessStoreError::Unavailable)?;
    Hex64::parse(keys.public_key().to_hex()).map_err(|_| AwarenessStoreError::Invalid)
}
