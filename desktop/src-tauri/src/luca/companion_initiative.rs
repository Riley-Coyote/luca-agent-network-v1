//! Optional initiative, separate from ordinary conversation and owner delegation.
//! The ledger stores references only; semantic bodies stay in encrypted resident
//! continuity. Initialization never opts in, dispatches a model or retries work.

pub(crate) mod carried;
pub(crate) mod control;
pub(crate) mod coordinator;
pub(crate) mod creations;
pub(crate) mod desktop_host;
pub(crate) mod driver;
pub(crate) mod executor;
pub(crate) mod host_scope;
pub(crate) mod own_inquiries;
mod observed_evidence;
mod policy;
mod schema;
mod store;
#[cfg(test)]
mod tests;
mod types;

use super::companion_awareness::{LiveAwarenessLease, LiveAwarenessOwner};
use luca_protocol::Hex64;
pub(crate) use policy::*;
use std::{path::Path, sync::Mutex};
pub(crate) use store::InitiativeStore;
pub(crate) use types::*;

struct Controller {
    owner: Hex64,
    store: InitiativeStore,
}

/// One AppState-owned optional ledger, without implicit background activation.
#[derive(Default)]
pub(crate) struct CompanionInitiativeRuntime {
    inner: Mutex<Option<Controller>>,
}

impl CompanionInitiativeRuntime {
    /// Bounded body-free discovery of explicit owner-enabled targets only.
    pub(crate) fn enabled_residents(
        &self,
        owner: &Hex64,
    ) -> Result<Vec<Hex64>, InitiativeStoreErrorV1> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
        let controller = inner.as_mut().ok_or(InitiativeStoreErrorV1::Unavailable)?;
        if &controller.owner != owner {
            return Err(InitiativeStoreErrorV1::Scope);
        }
        controller.store.enabled_residents(owner)
    }

    /// Open the already-established private internal control directory. Recovery
    /// retains narrowing authority without available signing keys or a model.
    pub(crate) fn initialize(&self, directory: &Path, owner: &Hex64) {
        let controller = InitiativeStore::open(&directory.join(schema::INITIATIVE_STORE_FILENAME))
            .map(|store| Controller {
                owner: owner.clone(),
                store,
            })
            .ok();
        if let Ok(mut inner) = self.inner.lock() {
            *inner = controller;
        }
    }

    /// Body-free status or narrowing mutation. Scope is derived by the host,
    /// never from model identity fields. Callback is bounded SQLite work only:
    /// no model/IO wait or acquisition of another authority lock.
    pub(crate) fn with_control<T>(
        &self,
        scope: &InitiativeControlScopeV1,
        operate: impl FnOnce(&mut InitiativeStore) -> Result<T, InitiativeStoreErrorV1>,
    ) -> Result<T, InitiativeStoreErrorV1> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
        let controller = inner.as_mut().ok_or(InitiativeStoreErrorV1::Unavailable)?;
        if controller.owner != scope.owner_pubkey {
            return Err(InitiativeStoreErrorV1::Scope);
        }
        operate(&mut controller.store)
    }

    /// Admitted short effect seam. Caller holds live identity, exact canonical
    /// head and execution/source gates. Only bounded native framing or a local
    /// creation commit is allowed, never a model wait.
    pub(crate) fn with_execution_ledger<T>(
        &self,
        lease: &LiveAwarenessLease<'_>,
        scope: &InitiativeControlScopeV1,
        effect: impl FnOnce(&mut InitiativeStore) -> T,
    ) -> Result<T, InitiativeStoreErrorV1> {
        if lease.owner() != &scope.owner_pubkey {
            return Err(InitiativeStoreErrorV1::Scope);
        }
        self.with_control(scope, |store| Ok(effect(store)))
    }

    /// Widening/admission state also rechecks current live identity. Native
    /// effects/await happen after this transaction and their final admission.
    pub(crate) fn with_live<T>(
        &self,
        live: &LiveAwarenessOwner<'_>,
        scope: &InitiativeControlScopeV1,
        operate: impl FnOnce(&mut InitiativeStore) -> Result<T, InitiativeStoreErrorV1>,
    ) -> Result<T, InitiativeStoreErrorV1> {
        if live.owner() != &scope.owner_pubkey {
            return Err(InitiativeStoreErrorV1::Scope);
        }
        live.with_current(|| Ok(self.with_control(scope, operate)))
            .map_err(|_| InitiativeStoreErrorV1::Unavailable)?
    }
}
