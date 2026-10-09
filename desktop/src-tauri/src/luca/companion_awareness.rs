//! One host serialization boundary for optional companion awareness.
//!
//! Store, buffer and effect admission share this lock. A withdrawal is durable
//! before bytes are evicted; a consuming sink finishes before withdrawal can
//! return. The lock never waits for a model or continuity decryption. A caller
//! must not acquire continuity lifecycle while holding it: deny commits first,
//! then separately purges canonical material to preserve lock ordering.

#[cfg(unix)]
pub(crate) mod browser_bridge;
#[cfg(unix)]
pub(crate) mod browser_configuration;
#[cfg(unix)]
pub(crate) mod browser_runtime;
#[cfg(unix)]
pub(crate) mod browser_native_host;
pub(crate) mod artifact_access;
mod buffer;
pub(crate) mod catalog;
#[cfg(test)]
mod controller_tests;
mod live_owner;
pub(crate) mod machine_activity;
pub(crate) mod machine_catalog;
pub(crate) mod machine_runner;
pub(crate) mod native_profile;
pub(crate) mod profile_catalog;
pub(crate) mod native_work;
mod schema;
mod scope;
pub(crate) mod selected_files;
pub(crate) mod source_runtime;
pub(crate) mod turn_context;
pub(crate) mod conversation;
mod store;
#[cfg(test)]
mod tests;
mod types;

use std::{path::Path, sync::Mutex};

use luca_protocol::{
    AwarenessAuthoritySnapshotV1, AwarenessGrantStateV1, AwarenessGrantV1,
    AwarenessObservationRefV1, AwarenessSourceStateV1, AwarenessUseV1, CanonicalTimestamp, Hex64,
    OpaqueId, SafeU53,
};

use buffer::EphemeralAwarenessBuffer;
pub(crate) use live_owner::{LiveAwarenessLease, LiveAwarenessOwner};
use scope::ControlScope;
use store::AwarenessStore;
pub(crate) use store::{NativeHistoryChoiceV1, NATIVE_HISTORY_DISCLOSURE_REVISION};
pub(crate) use store::{
    AwarenessDependentKindV1, AwarenessGrantKeyV1, AwarenessGrantListV1, AwarenessHostFactsV1,
    AwarenessMaterialFactsV1, AwarenessMutationReceiptV1, AwarenessResidentStateV1,
    AwarenessSourceKeyV1, AwarenessStoreError, AwarenessStoredAuthorityV1, AwarenessWithdrawalV1,
    AwarenessProfileChildV1, AwarenessProfileChildBindingV1,
};

struct Controller {
    scope: ControlScope,
    directory: std::path::PathBuf,
    store: AwarenessStore,
    buffer: EphemeralAwarenessBuffer,
}

/// Private AppState-owned runtime; absent initialization never implies consent.
#[derive(Default)]
pub(crate) struct CompanionAwarenessRuntime {
    inner: Mutex<Option<Controller>>,
}

impl CompanionAwarenessRuntime {
    /// Best-effort startup of body-free authority only. No source is observed,
    /// granted, resumed or started by initialization.
    pub(crate) fn initialize(&self, app_data_dir: &Path, authenticated_owner: Option<&Hex64>) {
        let ready = scope::open_scope(app_data_dir, authenticated_owner)
            .and_then(|(directory, scope)| {
                Ok(Controller {
                    scope,
                    store: AwarenessStore::open(&directory.join(store::AWARENESS_STORE_FILENAME))?,
                    buffer: EphemeralAwarenessBuffer::default(),
                    directory,
                })
            })
            .ok();
        if let Ok(mut inner) = self.inner.lock() {
            *inner = ready;
        }
    }

    /// Last authenticated public owner, solely for narrowing Pause/withdrawal.
    /// This is not a signing key or authorization to disclose/use material.
    pub(crate) fn control_owner(&self) -> Option<Hex64> {
        self.inner
            .lock()
            .ok()?
            .as_ref()
            .map(|value| value.scope.owner.clone())
    }

    /// Host-only private operational directory, never returned through IPC.
    pub(crate) fn private_directory(
        &self,
        owner: &Hex64,
    ) -> Result<std::path::PathBuf, AwarenessStoreError> {
        self.with_controller(owner, |controller| Ok(controller.directory.clone()))
    }

    /// Host-issued device scope; renderer/model content cannot choose it.
    pub(crate) fn device(&self, owner: &Hex64) -> Result<OpaqueId, AwarenessStoreError> {
        self.with_controller(owner, |controller| Ok(controller.scope.device.clone()))
    }

    /// Body-free state is inspectable without a signing key or resident memory.
    pub(crate) fn resident_state(
        &self,
        owner: &Hex64,
        resident: &Hex64,
    ) -> Result<AwarenessResidentStateV1, AwarenessStoreError> {
        self.with_controller(owner, |controller| {
            controller.store.resident_state(owner, resident)
        })
    }

    /// List only this exact companion's body-free sources and grant choices.
    pub(crate) fn list_grants(
        &self,
        owner: &Hex64,
        resident: &Hex64,
        limit: usize,
    ) -> Result<AwarenessGrantListV1, AwarenessStoreError> {
        self.with_controller(owner, |controller| {
            controller.store.list_grants(owner, resident, limit)
        })
    }

    /// Pause always narrows access. Resume additionally requires the current
    /// authenticated owner, never just the retained public control scope.
    pub(crate) fn set_paused(
        &self,
        owner: &Hex64,
        resident: &Hex64,
        authenticated_owner: Option<&LiveAwarenessOwner<'_>>,
        expected_revision: Option<SafeU53>,
        paused: bool,
        now: &CanonicalTimestamp,
        operation: &OpaqueId,
    ) -> Result<AwarenessMutationReceiptV1, AwarenessStoreError> {
        let apply = || {
            self.with_controller(owner, |controller| {
                let receipt = controller.store.set_resident_paused(
                    owner,
                    resident,
                    expected_revision,
                    paused,
                    now,
                    operation,
                )?;
                if paused {
                    controller.buffer.invalidate_resident(owner, resident);
                }
                Ok(receipt)
            })
        };
        if paused {
            apply()
        } else {
            let live = authenticated_owner.ok_or(AwarenessStoreError::Invalid)?;
            if live.owner() != owner {
                return Err(AwarenessStoreError::Invalid);
            }
            live.with_current(apply)
        }
    }

    /// Register a host-resolved source, without a grant or implicit activation.
    pub(crate) fn register_source(
        &self,
        authenticated_owner: &LiveAwarenessOwner<'_>,
        key: &AwarenessSourceKeyV1,
        operation: &OpaqueId,
    ) -> Result<AwarenessMutationReceiptV1, AwarenessStoreError> {
        if authenticated_owner.owner() != &key.owner_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        authenticated_owner.with_current(|| {
            self.with_controller(authenticated_owner.owner(), |controller| {
                if key.device_id != controller.scope.device {
                    return Err(AwarenessStoreError::Invalid);
                }
                controller.store.register_source(key, operation)
            })
        })
    }

    /// Exact live adapter health; neither connectivity nor recency is consent.
    pub(crate) fn set_source_health(
        &self,
        live: &LiveAwarenessOwner<'_>,
        key: &AwarenessSourceKeyV1,
        expected_revision: SafeU53,
        health: AwarenessSourceStateV1,
        operation: &OpaqueId,
    ) -> Result<AwarenessMutationReceiptV1, AwarenessStoreError> {
        if live.owner() != &key.owner_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        live.with_current(|| {
            self.with_controller(live.owner(), |controller| {
                controller
                    .store
                    .set_source_health(key, expected_revision, health, operation)
            })
        })
    }

    /// Store one explicit companion grant under current authenticated ownership.
    pub(crate) fn put_grant(
        &self,
        authenticated_owner: &LiveAwarenessOwner<'_>,
        grant: &AwarenessGrantV1,
        expected_revision: Option<SafeU53>,
        operation: &OpaqueId,
    ) -> Result<AwarenessMutationReceiptV1, AwarenessStoreError> {
        if authenticated_owner.owner() != &grant.owner_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        authenticated_owner.with_current(|| {
            self.with_controller(authenticated_owner.owner(), |controller| {
                if grant.device_id != controller.scope.device {
                    return Err(AwarenessStoreError::Invalid);
                }
                let receipt = controller
                    .store
                    .put_grant(grant, expected_revision, operation)?;
                controller.buffer.invalidate_grant(
                    &grant.owner_pubkey,
                    &grant.resident_pubkey,
                    &grant.grant_id,
                );
                Ok(receipt)
            })
        })
    }

    /// Commit the keyless deny barrier before evicting this exact grant's bytes.
    pub(crate) fn withdraw_grant(
        &self,
        owner: &Hex64,
        key: &AwarenessGrantKeyV1,
        expected_revision: SafeU53,
        kind: AwarenessWithdrawalV1,
        operation: &OpaqueId,
    ) -> Result<AwarenessMutationReceiptV1, AwarenessStoreError> {
        if owner != &key.source.owner_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        self.with_controller(owner, |controller| {
            let current = controller.store.snapshot(key)?;
            let receipt =
                controller
                    .store
                    .withdraw_grant(key, expected_revision, kind, operation)?;
            controller.buffer.invalidate_grant(
                owner,
                &key.resident_pubkey,
                &current.grant.grant_id,
            );
            Ok(receipt)
        })
    }

    /// Source-wide durable deny, independent of memory/model availability.
    pub(crate) fn withdraw_source(
        &self,
        owner: &Hex64,
        key: &AwarenessSourceKeyV1,
        expected_revision: SafeU53,
        kind: AwarenessWithdrawalV1,
        operation: &OpaqueId,
    ) -> Result<AwarenessMutationReceiptV1, AwarenessStoreError> {
        if owner != &key.owner_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        self.with_controller(owner, |controller| {
            let receipt =
                controller
                    .store
                    .withdraw_source(key, expected_revision, kind, operation)?;
            controller
                .buffer
                .invalidate_source(owner, &key.source_id, &key.device_id);
            Ok(receipt)
        })
    }

    /// Current body-free authority, not a cached reusable access decision.
    pub(crate) fn snapshot(
        &self,
        owner: &Hex64,
        key: &AwarenessGrantKeyV1,
    ) -> Result<AwarenessStoredAuthorityV1, AwarenessStoreError> {
        if owner != &key.source.owner_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        self.with_controller(owner, |controller| controller.store.snapshot(key))
    }

    /// Exact saved native-history destination choice. Does not read source data.
    pub(crate) fn native_history_choice(
        &self, owner: &Hex64, key: &AwarenessGrantKeyV1,
    ) -> Result<Option<NativeHistoryChoiceV1>, AwarenessStoreError> {
        if owner != &key.source.owner_pubkey { return Err(AwarenessStoreError::Invalid); }
        self.with_controller(owner, |controller| controller.store.native_history_choice(key))
    }

    /// Separate native destination consent. Only widening needs a live owner;
    /// OFF remains possible during keychain recovery without a running model.
    pub(crate) fn set_native_history_choice(
        &self, owner: &Hex64, key: &AwarenessGrantKeyV1, live: Option<&LiveAwarenessOwner<'_>>,
        expected: SafeU53, allowed: bool, binding: Option<&luca_protocol::Sha256Ref>,
        now: &CanonicalTimestamp, operation: &OpaqueId,
    ) -> Result<(NativeHistoryChoiceV1, bool), AwarenessStoreError> {
        if owner != &key.source.owner_pubkey { return Err(AwarenessStoreError::Invalid); }
        let apply = || self.with_controller(owner, |controller| {
            if key.source.device_id != controller.scope.device { return Err(AwarenessStoreError::Invalid); }
            controller.store.set_native_history_choice(key, expected, allowed, binding, now, operation)
        });
        if allowed {
            let live = live.ok_or(AwarenessStoreError::Invalid)?;
            if live.owner() != owner { return Err(AwarenessStoreError::Invalid); }
            live.with_current(apply)
        } else { apply() }
    }

    /// Saved consent must still match the source's exact current runtime/grant.
    /// This is not a current material/capture/transport or publication permit.
    pub(crate) fn recheck_native_history_choice(
        &self, owner: &Hex64, key: &AwarenessGrantKeyV1, binding: &luca_protocol::Sha256Ref,
    ) -> Result<(), AwarenessStoreError> {
        if owner != &key.source.owner_pubkey { return Err(AwarenessStoreError::Invalid); }
        self.with_controller(owner, |controller| controller.store.recheck_native_history_choice(key, binding))
    }

    /// Next durable exact-grant sequence. The source driver serializes capture;
    /// this coordinate alone grants nothing and final admission still does CAS.
    pub(crate) fn next_sequence(
        &self,
        live: &LiveAwarenessOwner<'_>,
        key: &AwarenessGrantKeyV1,
    ) -> Result<SafeU53, AwarenessStoreError> {
        if live.owner() != &key.source.owner_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        live.with_current(|| {
            self.with_controller(live.owner(), |controller| {
                let durable = controller.store.next_sequence(key)?;
                let grant = controller.store.snapshot(key)?.grant;
                let watermark = controller.buffer.sequence_watermark(
                    live.owner(), &key.resident_pubkey, &grant.grant_id,
                ).map_or(0, SafeU53::get);
                // A rejected durable admission must not trap later real source
                // changes behind the buffer's correctly retained replay fence.
                let next = watermark.checked_add(1).ok_or(AwarenessStoreError::Capacity)?;
                SafeU53::new(durable.get().max(next)).map_err(|_| AwarenessStoreError::Capacity)
            })
        })
    }

    /// Body-free source state for explicit grant creation. This grants no read.
    pub(crate) fn source_snapshot(
        &self,
        owner: &Hex64,
        key: &AwarenessSourceKeyV1,
    ) -> Result<(luca_protocol::AwarenessSourceV1, SafeU53), AwarenessStoreError> {
        if owner != &key.owner_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        self.with_controller(owner, |controller| controller.store.source_snapshot(key))
    }

    /// Fence one bounded source read with current consent and withdrawal. An
    /// unavailable/unknown source can be probed only after explicit observation
    /// consent; successful reading is not permission to retain or send its bytes.
    /// The reader must not await, lock continuity, or call this controller again.
    pub(crate) fn with_granted_source_read<T>(
        &self,
        live: &LiveAwarenessOwner<'_>,
        key: &AwarenessGrantKeyV1,
        reader: impl FnOnce(&AwarenessStoredAuthorityV1) -> Result<T, AwarenessStoreError>,
    ) -> Result<T, AwarenessStoreError> {
        if live.owner() != &key.source.owner_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        live.with_current(|| {
            self.with_controller(live.owner(), |controller| {
                let authority = controller.store.snapshot(key)?;
                if authority.source.state == AwarenessSourceStateV1::Disabled
                    || authority.grant.state != AwarenessGrantStateV1::Active
                    || !authority.grant.choices.observe
                    || authority.source.deny_epoch != authority.grant.deny_epoch
                    || key.source.device_id != controller.scope.device
                {
                    return Err(AwarenessStoreError::Invalid);
                }
                if controller
                    .store
                    .resident_state(live.owner(), &key.resident_pubkey)?
                    .paused
                {
                    return Err(AwarenessStoreError::Paused);
                }
                reader(&authority)
            })
        })
    }

    /// Admit verified adapter bytes and metadata under the same deny/effect lock.
    /// Facts are trusted host facts, not a deserialized collector permission.
    pub(crate) fn admit(
        &self,
        live: &LiveAwarenessOwner<'_>,
        facts: &AwarenessHostFactsV1<'_>,
        reference: AwarenessObservationRefV1,
        payload: Vec<u8>,
    ) -> Result<bool, AwarenessStoreError> {
        if live.owner() != facts.owner_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        live.with_current(|| {
            self.with_controller(facts.owner_pubkey, |controller| {
                let key = grant_key(&reference);
                let authority = controller.store.snapshot(&key)?;
                let snapshot = authority_snapshot(&authority, facts);
                // Validate bytes before any durable observation edge is admitted.
                let replayed = controller
                    .buffer
                    .insert(&snapshot, reference.clone(), payload)
                    .map_err(|_| AwarenessStoreError::Invalid)?;
                if let Err(error) = controller.store.admit_observation(&reference, facts) {
                    controller.buffer.invalidate_grant(
                        facts.owner_pubkey,
                        facts.resident_pubkey,
                        &reference.grant_id,
                    );
                    return Err(error);
                }
                Ok(replayed)
            })
        })
    }

    /// Admit profile bytes and their opaque exact-child binding in one deny
    /// barrier. Neither a path nor a native UUID enters the authority database.
    pub(crate) fn admit_profile(
        &self, live: &LiveAwarenessOwner<'_>, facts: &AwarenessHostFactsV1<'_>,
        reference: AwarenessObservationRefV1, payload: Vec<u8>, child: &AwarenessProfileChildV1,
    ) -> Result<bool, AwarenessStoreError> {
        if live.owner() != facts.owner_pubkey { return Err(AwarenessStoreError::Invalid); }
        live.with_current(|| self.with_controller(facts.owner_pubkey, |controller| {
            let authority = controller.store.snapshot(&grant_key(&reference))?;
            let replayed = controller.buffer.insert(&authority_snapshot(&authority, facts), reference.clone(), payload)
                .map_err(|_| AwarenessStoreError::Invalid)?;
            if let Err(error) = controller.store.admit_profile_observation(&reference, facts, child) {
                controller.buffer.invalidate_grant(facts.owner_pubkey, facts.resident_pubkey, &reference.grant_id);
                return Err(error);
            }
            Ok(replayed)
        }))
    }

    /// Body-free exact full-reference correlations for preloading before effect
    /// locks. This metadata is not permission to read, enable or disclose bytes.
    pub(crate) fn profile_child_bindings(&self, owner: &Hex64, resident: &Hex64)
        -> Result<Vec<AwarenessProfileChildBindingV1>, AwarenessStoreError> {
        self.with_controller(owner, |controller| controller.store.profile_children(owner, resident))
    }

    /// Deliver raw material only to a synchronous host-owned sink while revoke
    /// is serialized. The sink must not await, call a model or lock continuity.
    pub(crate) fn with_payload<T>(
        &self,
        live: &LiveAwarenessOwner<'_>,
        facts: &AwarenessHostFactsV1<'_>,
        reference: &AwarenessObservationRefV1,
        intended_use: AwarenessUseV1<'_>,
        sink: impl FnOnce(&[u8]) -> T,
    ) -> Result<T, AwarenessStoreError> {
        if live.owner() != facts.owner_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        live.with_current(|| {
            self.with_controller(facts.owner_pubkey, |controller| {
                controller
                    .store
                    .recheck_raw_observation(reference, facts, intended_use)?;
                let authority = controller.store.snapshot(&grant_key(reference))?;
                controller
                    .buffer
                    .with_payload(
                        &authority_snapshot(&authority, facts),
                        reference,
                        intended_use,
                        sink,
                    )
                    .map_err(|_| AwarenessStoreError::Invalid)
            })
        })
    }

    /// Attach an opaque context/job/canonical ID, never store another memory body.
    /// Read a small exact observation set and frame its context under one current
    /// denial barrier. Raw bytes are zeroized on return, never a cached caller
    /// capability. The sink is bounded local serialization/socket IO only.
    pub(crate) fn with_payloads_lease<T>(
        &self,
        lease: &LiveAwarenessLease<'_>,
        facts: &AwarenessHostFactsV1<'_>,
        references: &[AwarenessObservationRefV1],
        intended_use: AwarenessUseV1<'_>,
        mut resolve: impl FnMut(&AwarenessObservationRefV1, bool) -> AwarenessMaterialFactsV1,
        context_node: Option<&OpaqueId>,
        sink: impl FnOnce(&[zeroize::Zeroizing<Vec<u8>>]) -> T,
    ) -> Result<T, AwarenessStoreError> {
        self.with_payloads_for_sink_lease(lease, facts, references, intended_use, &mut resolve, context_node, None, sink)
    }

    /// Ordinary conversation is a separately approved native-history sink,
    /// not a raw local archive. Consent is rechecked under the same lock as
    /// source admission and framing; a stale preparation cannot widen it.
    pub(crate) fn with_native_history_payloads_lease<T>(
        &self,
        lease: &LiveAwarenessLease<'_>,
        facts: &AwarenessHostFactsV1<'_>,
        references: &[AwarenessObservationRefV1],
        binding: &luca_protocol::Sha256Ref,
        mut resolve: impl FnMut(&AwarenessObservationRefV1, bool) -> AwarenessMaterialFactsV1,
        context_node: &OpaqueId,
        sink: impl FnOnce(&[zeroize::Zeroizing<Vec<u8>>]) -> T,
    ) -> Result<T, AwarenessStoreError> {
        self.with_payloads_for_sink_lease(lease, facts, references,
            AwarenessUseV1 { provider_egress_binding: Some(binding), ..Default::default() },
            &mut resolve, Some(context_node), Some(binding), sink)
    }

    fn with_payloads_for_sink_lease<T>(
        &self,
        lease: &LiveAwarenessLease<'_>,
        facts: &AwarenessHostFactsV1<'_>,
        references: &[AwarenessObservationRefV1],
        intended_use: AwarenessUseV1<'_>,
        resolve: &mut impl FnMut(&AwarenessObservationRefV1, bool) -> AwarenessMaterialFactsV1,
        context_node: Option<&OpaqueId>,
        native_history_binding: Option<&luca_protocol::Sha256Ref>,
        sink: impl FnOnce(&[zeroize::Zeroizing<Vec<u8>>]) -> T,
    ) -> Result<T, AwarenessStoreError> {
        if lease.owner() != facts.owner_pubkey || references.is_empty() || references.len() > 4 {
            return Err(AwarenessStoreError::Invalid);
        }
        self.with_controller(lease.owner(), |controller| {
            let mut payloads = Vec::with_capacity(references.len());
            let mut total = 0usize;
            for reference in references {
                let material = resolve(reference, false);
                let current = AwarenessHostFactsV1 {
                    owner_pubkey: facts.owner_pubkey, resident_pubkey: facts.resident_pubkey,
                    now: facts.now, source_fresh: material.source_fresh,
                    material_state: material.material_state,
                };
                controller.store.recheck_raw_observation(reference, &current, intended_use)?;
                let key = AwarenessGrantKeyV1 {
                    source: AwarenessSourceKeyV1 {
                        owner_pubkey: reference.owner_pubkey.clone(), source_id: reference.source_id.clone(),
                        device_id: reference.device_id.clone(),
                    }, resident_pubkey: reference.resident_pubkey.clone(),
                };
                if let Some(binding) = native_history_binding {
                    controller.store.recheck_native_history_choice(&key, binding)?;
                }
                let authority = controller.store.snapshot(&key)?;
                let payload = controller.buffer.with_payload(
                    &authority_snapshot(&authority, &current), reference, intended_use,
                    |bytes| zeroize::Zeroizing::new(bytes.to_vec()),
                ).map_err(|_| AwarenessStoreError::Invalid)?;
                total = total.checked_add(payload.len()).ok_or(AwarenessStoreError::Capacity)?;
                if total > 256 * 1024 { return Err(AwarenessStoreError::Capacity); }
                payloads.push(payload);
            }
            if let Some(node) = context_node {
                let parents = references.iter().map(|reference| reference.observation_id.clone()).collect::<Vec<_>>();
                controller.store.register_dependent(node, AwarenessDependentKindV1::Context, &parents, facts, &mut *resolve)?;
                controller.store.recheck_dependency(node, facts, intended_use, &mut *resolve)?;
            }
            Ok(sink(&payloads))
        })
    }

    /// Attach an opaque context/job/canonical ID, never store another memory body.
    pub(crate) fn register_dependent(
        &self,
        live: &LiveAwarenessOwner<'_>,
        node: &OpaqueId,
        kind: AwarenessDependentKindV1,
        parents: &[OpaqueId],
        facts: &AwarenessHostFactsV1<'_>,
        resolve: impl FnMut(&AwarenessObservationRefV1, bool) -> AwarenessMaterialFactsV1,
    ) -> Result<bool, AwarenessStoreError> {
        if live.owner() != facts.owner_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        live.with_current(|| {
            self.with_controller(facts.owner_pubkey, |controller| {
                controller
                    .store
                    .register_dependent(node, kind, parents, facts, resolve)
            })
        })
    }

    /// Recheck all current source/grant/deny dependencies immediately at an
    /// effect boundary. Retained paths do not depend on raw-buffer lifetime.
    pub(crate) fn with_dependency<T>(
        &self,
        live: &LiveAwarenessOwner<'_>,
        node: &OpaqueId,
        facts: &AwarenessHostFactsV1<'_>,
        intended_use: AwarenessUseV1<'_>,
        resolve: impl FnMut(&AwarenessObservationRefV1, bool) -> AwarenessMaterialFactsV1,
        effect: impl FnOnce() -> T,
    ) -> Result<T, AwarenessStoreError> {
        if live.owner() != facts.owner_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        live.with_current(|| {
            self.with_controller(facts.owner_pubkey, |controller| {
                controller
                    .store
                    .recheck_dependency(node, facts, intended_use, resolve)?;
                Ok(effect())
            })
        })
    }

    /// Exact dependency effect under an already-held live identity lease.
    /// Order is identity -> continuity (when present) -> awareness. Effect must
    /// be bounded framing/local commit only, never model wait or another lock.
    pub(crate) fn with_dependency_lease<T>(
        &self,
        lease: &LiveAwarenessLease<'_>,
        node: &OpaqueId,
        facts: &AwarenessHostFactsV1<'_>,
        intended_use: AwarenessUseV1<'_>,
        resolve: impl FnMut(&AwarenessObservationRefV1, bool) -> AwarenessMaterialFactsV1,
        effect: impl FnOnce() -> T,
    ) -> Result<T, AwarenessStoreError> {
        if lease.owner() != facts.owner_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        self.with_controller(lease.owner(), |controller| {
            controller
                .store
                .recheck_dependency(node, facts, intended_use, resolve)?;
            Ok(effect())
        })
    }

    /// One short admission fence for a reply derived from an ordinary native
    /// turn. All dependencies and destination-specific consent are checked
    /// together. The caller issues the already-admitted external effect after
    /// releasing this lock; revocation cannot retract a request already issued.
    pub(crate) fn admit_native_history_reply(
        &self, lease: &LiveAwarenessLease<'_>,
        facts: &AwarenessHostFactsV1<'_>, binding: &luca_protocol::Sha256Ref,
        nodes: &[OpaqueId], references: &[AwarenessObservationRefV1],
        mut resolve: impl FnMut(&AwarenessObservationRefV1, bool) -> AwarenessMaterialFactsV1,
    ) -> Result<(), AwarenessStoreError> {
        if lease.owner() != facts.owner_pubkey || nodes.is_empty() || references.is_empty() {
            return Err(AwarenessStoreError::Invalid);
        }
        self.with_controller(lease.owner(), |controller| {
            for reference in references {
                let key = AwarenessGrantKeyV1 {
                    source: AwarenessSourceKeyV1 { owner_pubkey: reference.owner_pubkey.clone(), source_id: reference.source_id.clone(), device_id: reference.device_id.clone() },
                    resident_pubkey: reference.resident_pubkey.clone(),
                };
                controller.store.recheck_native_history_choice(&key, binding)?;
            }
            for node in nodes {
                controller.store.recheck_dependency(node, facts,
                    AwarenessUseV1 { provider_egress_binding: Some(binding), ..Default::default() },
                    &mut resolve)?;
            }
            Ok(())
        })
    }

    /// Register a prospective stable creation dependency before preserving its
    /// bytes, under one effect barrier. Failure cannot leave an untracked gift.
    /// The prospective node may remain unused after a failed local commit; it
    /// grants no additional access or body retention by itself.
    pub(crate) fn with_promotion_lease<T>(
        &self,
        lease: &LiveAwarenessLease<'_>,
        node: &OpaqueId,
        parents: &[OpaqueId],
        facts: &AwarenessHostFactsV1<'_>,
        mut resolve: impl FnMut(&AwarenessObservationRefV1, bool) -> AwarenessMaterialFactsV1,
        effect: impl FnOnce() -> Result<T, AwarenessStoreError>,
    ) -> Result<T, AwarenessStoreError> {
        if lease.owner() != facts.owner_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        self.with_controller(lease.owner(), |controller| {
            controller.store.register_dependent(
                node,
                AwarenessDependentKindV1::Promoted,
                parents,
                facts,
                &mut resolve,
            )?;
            controller.store.recheck_dependency(
                node,
                facts,
                AwarenessUseV1 {
                    promote: true,
                    ..Default::default()
                },
                &mut resolve,
            )?;
            effect()
        })
    }

    /// Consume one genuine authored/promoted artifact under the denial barrier.
    /// The resolver supplies preloaded exact material/exclusion facts; this does
    /// not probe a source or revive its expired raw bytes. Pause alone preserves
    /// lawful retained creations, while withdrawal/quarantine still deny them.
    pub(crate) fn with_promoted_artifact_access<T>(
        &self,
        lease: &LiveAwarenessLease<'_>,
        resident: &Hex64,
        node: &OpaqueId,
        now: &CanonicalTimestamp,
        resolve: impl FnMut(&AwarenessObservationRefV1, bool) -> AwarenessMaterialFactsV1,
        effect: impl FnOnce() -> T,
    ) -> Result<T, AwarenessStoreError> {
        self.with_controller(lease.owner(), |controller| {
            controller.store.recheck_promoted_artifact(
                node,
                &AwarenessHostFactsV1 {
                    owner_pubkey: lease.owner(),
                    resident_pubkey: resident,
                    now,
                    // Per-root facts come from the resolver, never these defaults.
                    source_fresh: false,
                    material_state: luca_protocol::AwarenessMaterialStateV1::Unavailable,
                },
                resolve,
            )?;
            Ok(effect())
        })
    }

    fn with_controller<T>(
        &self,
        owner: &Hex64,
        use_controller: impl FnOnce(&mut Controller) -> Result<T, AwarenessStoreError>,
    ) -> Result<T, AwarenessStoreError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| AwarenessStoreError::Unavailable)?;
        let controller = inner.as_mut().ok_or(AwarenessStoreError::Unavailable)?;
        if &controller.scope.owner != owner {
            return Err(AwarenessStoreError::Invalid);
        }
        use_controller(controller)
    }
}

fn grant_key(reference: &AwarenessObservationRefV1) -> AwarenessGrantKeyV1 {
    AwarenessGrantKeyV1 {
        source: AwarenessSourceKeyV1 {
            owner_pubkey: reference.owner_pubkey.clone(),
            source_id: reference.source_id.clone(),
            device_id: reference.device_id.clone(),
        },
        resident_pubkey: reference.resident_pubkey.clone(),
    }
}

fn authority_snapshot<'a>(
    stored: &'a AwarenessStoredAuthorityV1,
    facts: &'a AwarenessHostFactsV1<'_>,
) -> AwarenessAuthoritySnapshotV1<'a> {
    AwarenessAuthoritySnapshotV1 {
        owner_pubkey: facts.owner_pubkey,
        resident_pubkey: facts.resident_pubkey,
        source: &stored.source,
        grant: &stored.grant,
        now: facts.now,
        source_fresh: facts.source_fresh,
        material_state: facts.material_state,
    }
}
