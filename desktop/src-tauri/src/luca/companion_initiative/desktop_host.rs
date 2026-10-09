//! Real desktop initiative barriers. No model at construction and no snapshots
//! used as reusable permissions. Native wait belongs to executor, after these
//! short identity/head/gate/awareness/ledger leases have all ended.

use super::{
    creations::{creation_node, InitiativeCreationModeV1},
    driver::{CurrentInitiativeAdmissionV1, InitiativeAdmissionHostV1, InitiativeDriverErrorV1, PreparedInitiativePlanningV1, INITIATIVE_MIN_IDLE_MS},
    executor::{InitiativeExecutionHostV1, InitiativeExecutorErrorV1, VerifiedInitiativePursuitV1},
    host_scope::home_scope,
    own_inquiries::{authenticated_native_parent, native_own_request},
    InitiativeCanonicalFactsV1, InitiativeControlScopeV1, InitiativeJobStateV1, InitiativeRuntimeScopeV1,
    InitiativeStore, InitiativeStoreErrorV1,
};
use crate::{app_state::AppState, data_dir::BuzzPathExt};
use crate::luca::{
    artifacts::ArtifactStore,
    companion_awareness::{source_runtime::preload_source_facts_before, AwarenessGrantKeyV1, AwarenessHostFactsV1, AwarenessMaterialFactsV1, AwarenessSourceKeyV1, LiveAwarenessLease, LiveAwarenessOwner},
    continuity_revision_authority::RevisionAuthorityTokenV1,
    managed_cognition::{self, ManagedInitiativeCancellation},
    managed_dispatch_store::global_dispatch_store,
    resident_notebook::{InitiativeThreadCommitReceiptV1, InitiativeThreadCommitRequestV1, InitiativeThreadHeadV1, InitiativeThreadRevisionViewV1},
};
use luca_continuity::RevisionActor;
use luca_protocol::{
    canonical_sha256, AwarenessMaterialStateV1, AwarenessUseV1, CanonicalTimestamp, Hex64,
    InitiativeDispositionV1, InitiativePlanningEvidenceV1,
    OpaqueId, SafeU53, Sha256Ref,
};
use std::{sync::atomic::Ordering, time::{Duration, Instant}};
use tauri::{AppHandle, Manager};

/// Real OS idle plus trusted in-app explicit-input timestamp. Unsupported OS
/// proof is unavailable, never fabricated idle or a heartbeat treated as input.
pub(crate) fn verified_idle_ms(state: &AppState, now_ms: u64) -> Option<u64> {
    let os = crate::commands::get_os_idle_seconds()?.checked_mul(1000)?;
    let input = state.companion_last_explicit_activity_ms.load(Ordering::Acquire);
    if input == 0 || input > now_ms { return None; }
    Some(os.min(now_ms - input))
}
/// Own conversation-plane metadata only, not D0 task enumeration or a process scan.
pub(crate) fn foreground_active(app: &AppHandle, resident: &Hex64, now_ms: u64) -> bool {
    let state = app.state::<AppState>();
    state.shutdown_started.load(Ordering::Acquire)
        || verified_idle_ms(&state, now_ms).is_none_or(|idle| idle < INITIATIVE_MIN_IDLE_MS)
        || global_dispatch_store(app).ok().and_then(|store| store.lock().ok().map(|store| store.has_unresolved_for_resident(resident.as_str()))).unwrap_or(true)
}
/// Exact current managed resident/profile binding, without creating a runtime.
/// Adapter support is host policy, not a claimed native acceptance certification.
pub(crate) fn runtime_scope(app: &AppHandle, resident: &Hex64) -> Result<InitiativeRuntimeScopeV1, InitiativeExecutorErrorV1> {
    let state = app.state::<AppState>();
    let owner = state.companion_awareness.control_owner().ok_or(InitiativeExecutorErrorV1::Unavailable)?;
    let control = home_scope(&state, &owner, resident)?;
    if !managed_cognition::initiative_adapter_supported(resident) { return Err(InitiativeExecutorErrorV1::Unavailable); }
    let binding_ref = managed_cognition::active_binding_ref(resident).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?;
    let session_epoch = managed_cognition::active_session_epoch(resident).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?;
    let foreground_active = foreground_active(app, resident, control.now_unix_ms);
    Ok(InitiativeRuntimeScopeV1 { control, binding_ref, session_epoch, foreground_active, outreach_authorized: false })
}

/// Body-free proof of the authenticated I1 birthmark/current generation. Only
/// trusted source-clean carry sets it; matching the latest handoff is unnecessary.
struct CanonicalSeedProofV1 { dependency_ref: Sha256Ref }
fn canonical_seed(scope: &InitiativeRuntimeScopeV1, token: &RevisionAuthorityTokenV1, view: &InitiativeThreadRevisionViewV1) -> Result<CanonicalSeedProofV1, InitiativeExecutorErrorV1> {
    let thread = &view.thread;
    if !authenticated_native_parent(view)? || token.owner_pubkey != scope.control.owner_pubkey
        || thread.owner_pubkey != scope.control.owner_pubkey
        || thread.resident_pubkey != scope.control.resident_pubkey {
        return Err(InitiativeExecutorErrorV1::Unavailable);
    }
    let hash = canonical_sha256(&serde_json::json!({
        "domain":"polyphonic.initiative.canonical-seed.v1", "owner":token.owner_pubkey,
        "store_epoch":token.store_epoch,"generation":token.generation,"fingerprint":token.snapshot_fingerprint,
        "record":view.record_id,"semantic":view.canonical_revision_ref,"kind":thread.kind,"source_refs":thread.source_refs,
    })).map_err(|_| InitiativeExecutorErrorV1::Invalid)?;
    Ok(CanonicalSeedProofV1 { dependency_ref: Sha256Ref::parse(format!("sha256:{hash}")).map_err(|_| InitiativeExecutorErrorV1::Invalid)? })
}
fn dependency_ref(seed: &CanonicalSeedProofV1, evidence: &[InitiativePlanningEvidenceV1], node: Option<&OpaqueId>) -> Result<Sha256Ref, InitiativeExecutorErrorV1> {
    if evidence.is_empty() != node.is_none() { return Err(InitiativeExecutorErrorV1::Invalid); }
    let refs = evidence.iter().map(|evidence| &evidence.observation).collect::<Vec<_>>();
    let hash = canonical_sha256(&serde_json::json!({"domain":"polyphonic.initiative.current-dependencies.v1","canonical":seed.dependency_ref,"observations":refs,"node":node})).map_err(|_| InitiativeExecutorErrorV1::Invalid)?;
    Sha256Ref::parse(format!("sha256:{hash}")).map_err(|_| InitiativeExecutorErrorV1::Invalid)
}

/// One chosen target/thread, using the existing resident endpoint and Library.
/// No body Debug/serde and no model, key/profile creation or collector at new().
pub(crate) struct DesktopInitiativeExecutionHostV1 {
    app: AppHandle,
    resident: Hex64,
    thread: OpaqueId,
    dependencies: Vec<AwarenessGrantKeyV1>,
}
impl DesktopInitiativeExecutionHostV1 {
    /// Bind this host to one existing resident/thread and owned evidence keys.
    /// Construction resolves no profile, source, model or authority.
    pub(crate) fn new(app: AppHandle, resident: Hex64, thread: OpaqueId, evidence: &[InitiativePlanningEvidenceV1]) -> Self {
        let dependencies = evidence.iter().map(|evidence| {
            let reference = &evidence.observation;
            AwarenessGrantKeyV1 { source: AwarenessSourceKeyV1 { owner_pubkey: reference.owner_pubkey.clone(), source_id: reference.source_id.clone(), device_id: reference.device_id.clone() }, resident_pubkey: reference.resident_pubkey.clone() }
        }).collect();
        Self { app, resident, thread, dependencies }
    }
    fn scope_matches(&self, scope: &InitiativeRuntimeScopeV1) -> bool { scope.control.resident_pubkey == self.resident && !scope.foreground_active }
    fn with_head<T>(&self, scope: &InitiativeRuntimeScopeV1, prepared: &PreparedInitiativePlanningV1,
        effect: impl FnOnce(&AppState, &LiveAwarenessLease<'_>, &CurrentInitiativeAdmissionV1) -> Result<T, InitiativeExecutorErrorV1>) -> Result<T, InitiativeExecutorErrorV1> {
        if !self.scope_matches(scope) || prepared.request().semantic_thread.thread_id != self.thread { return Err(InitiativeExecutorErrorV1::Invalid); }
        let state = self.app.state::<AppState>();
        let live = LiveAwarenessOwner::authenticate(&state).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?;
        if live.owner() != &scope.control.owner_pubkey { return Err(InitiativeExecutorErrorV1::Invalid); }
        let lease = live.lease().map_err(|_| InitiativeExecutorErrorV1::Unavailable)?;
        state.consume_current_resident_initiative_thread(&lease, &self.resident, &self.thread, prepared.expected_record(), &prepared.request().thread.canonical_revision_ref,
            |token, view| {
                let seed = canonical_seed(scope, token, view)?;
                let dependencies = dependency_ref(&seed, &prepared.request().evidence, prepared.dependency_node())?;
                let current = CurrentInitiativeAdmissionV1::from_held_thread(&lease, scope, token, view, prepared.expected_record(), &prepared.request().thread.canonical_revision_ref, dependencies)?;
                state.companion_execution.with_running(scope, || {
                    Ok(if foreground_active(&self.app, &self.resident, scope.control.now_unix_ms) { Err(InitiativeExecutorErrorV1::Busy) } else { effect(&state, &lease, &current) })
                }).map_err(InitiativeExecutorErrorV1::from)?
            }).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?
    }
}
fn admitted_policy(store: &InitiativeStore, scope: &InitiativeRuntimeScopeV1) -> Result<(), InitiativeExecutorErrorV1> {
    let policy = store.policy(&scope.control)?;
    if !policy.enabled || policy.paused || !policy.allow_local_creations { return Err(InitiativeExecutorErrorV1::Ledger(InitiativeStoreErrorV1::Disabled)); }
    Ok(())
}
fn timestamp(scope: &InitiativeRuntimeScopeV1) -> Result<CanonicalTimestamp, InitiativeExecutorErrorV1> {
    let now = i64::try_from(scope.control.now_unix_ms).ok().and_then(chrono::DateTime::from_timestamp_millis).ok_or(InitiativeExecutorErrorV1::Invalid)?;
    CanonicalTimestamp::parse(now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)).map_err(|_| InitiativeExecutorErrorV1::Invalid)
}
impl InitiativeAdmissionHostV1 for DesktopInitiativeExecutionHostV1 {
    fn current(&self, scope: &InitiativeRuntimeScopeV1, thread_id: &OpaqueId, evidence: &[InitiativePlanningEvidenceV1], node: Option<&OpaqueId>) -> Result<CurrentInitiativeAdmissionV1, InitiativeDriverErrorV1> {
        let prepare = || -> Result<_, InitiativeExecutorErrorV1> {
            if thread_id != &self.thread || !self.scope_matches(scope) { return Err(InitiativeExecutorErrorV1::Invalid); }
            let state = self.app.state::<AppState>();
            let live = LiveAwarenessOwner::authenticate(&state).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?;
            if live.owner() != &scope.control.owner_pubkey { return Err(InitiativeExecutorErrorV1::Invalid); }
            let snapshot = state.read_resident_initiative_threads(&scope.control.owner_pubkey, &self.resident, false).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?.ok_or(InitiativeExecutorErrorV1::Unavailable)?;
            let mut views = snapshot.threads.into_iter().filter(|view| &view.thread.thread_id == thread_id);
            let view = views.next().ok_or(InitiativeExecutorErrorV1::Unavailable)?;
            if views.next().is_some() { return Err(InitiativeExecutorErrorV1::Invalid); }
            let record = view.record_id.clone(); let semantic = view.canonical_revision_ref.clone();
            let lease = live.lease().map_err(|_| InitiativeExecutorErrorV1::Unavailable)?;
            state.consume_current_resident_initiative_thread(&lease, &self.resident, thread_id, &record, &semantic, |token, view| {
                if token != &snapshot.authority { return Err(InitiativeExecutorErrorV1::Invalid); }
                let seed = canonical_seed(scope, token, view)?;
                let dependency = dependency_ref(&seed, evidence, node)?;
                CurrentInitiativeAdmissionV1::from_held_thread(&lease, scope, token, view, &record, &semantic, dependency).map_err(InitiativeExecutorErrorV1::from)
            }).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?
        };
        prepare().map_err(|error| match error { InitiativeExecutorErrorV1::Driver(error) => error, _ => InitiativeDriverErrorV1::Unavailable })
    }
}
impl InitiativeExecutionHostV1<ManagedInitiativeCancellation> for DesktopInitiativeExecutionHostV1 {
    fn current_scope(&self) -> Result<InitiativeRuntimeScopeV1, InitiativeExecutorErrorV1> { runtime_scope(&self.app, &self.resident) }
    fn with_current<T>(&self, scope: &InitiativeRuntimeScopeV1, prepared: &PreparedInitiativePlanningV1,
        effect: impl FnOnce(&mut InitiativeStore, &CurrentInitiativeAdmissionV1) -> Result<T, InitiativeExecutorErrorV1>) -> Result<T, InitiativeExecutorErrorV1> {
        let state = self.app.state::<AppState>();
        let now = timestamp(scope)?;
        let deadline = Instant::now() + Duration::from_millis(prepared.request().deadline_unix_ms.get().saturating_sub(scope.control.now_unix_ms).min(1000));
        let source = if prepared.request().evidence.is_empty() { None } else { Some(preload_source_facts_before(&state, &scope.control.owner_pubkey, &self.resident, &now, deadline).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?) };
        self.with_head(scope, prepared, |state, lease, current| {
            let ledger = || state.companion_initiative.with_execution_ledger(lease, &scope.control, |store| { admitted_policy(store, scope)?; effect(store, current) }).map_err(InitiativeExecutorErrorV1::from)?;
            if let Some(node) = prepared.dependency_node() {
                let references = prepared.request().evidence.iter().map(|evidence| evidence.observation.clone()).collect::<Vec<_>>();
                let facts = AwarenessHostFactsV1 { owner_pubkey: &scope.control.owner_pubkey, resident_pubkey: &self.resident, now: &now, source_fresh: false, material_state: AwarenessMaterialStateV1::Unavailable };
                state.companion_awareness.with_payloads_lease(lease, &facts, &references, AwarenessUseV1 { provider_egress_binding: Some(&scope.binding_ref), ..Default::default() },
                    |reference, retained| source.as_ref().map(|facts| facts.resolve(reference, retained)).unwrap_or(AwarenessMaterialFactsV1 { source_fresh:false,material_state:AwarenessMaterialStateV1::Unavailable }), Some(node), |payloads| {
                        if !prepared.request().evidence.iter().zip(payloads).all(|(evidence, payload)| source.as_ref().is_some_and(|source| {
                            super::observed_evidence::matches(source.snapshot(), &evidence.observation, payload, &evidence.excerpt)
                        })) { return Err(InitiativeExecutorErrorV1::Invalid); }
                        ledger()
                    }).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?
            } else { ledger() }
        })
    }
    fn with_creation<T>(&self, scope: &InitiativeRuntimeScopeV1, prepared: &PreparedInitiativePlanningV1, work: &VerifiedInitiativePursuitV1,
        effect: impl FnOnce(&mut InitiativeStore, &mut ArtifactStore, InitiativeCreationModeV1) -> Result<T, InitiativeExecutorErrorV1>) -> Result<T, InitiativeExecutorErrorV1> {
        let state = self.app.state::<AppState>();
        let root = self.app.buzz_path().app_data_dir().map_err(|_| InitiativeExecutorErrorV1::Unavailable)?;
        if root.starts_with("/Volumes") { return Err(InitiativeExecutorErrorV1::Unavailable); }
        // Existing store lifecycle outside identity/canonical/awareness/ledger
        // locks. No artifact bytes exist until sealed effect below.
        let mut artifacts = ArtifactStore::open(&root).map_err(|_| InitiativeExecutorErrorV1::Creation)?;
        let now = timestamp(scope)?;
        let source = if prepared.dependency_node().is_none() { None } else { Some(preload_source_facts_before(&state, &scope.control.owner_pubkey, &self.resident, &now, Instant::now() + Duration::from_secs(1)).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?) };
        self.with_head(scope, prepared, |state, lease, _| {
            if work.request().job_id != *prepared.job_id() || work.request().semantic_thread.thread_id != self.thread { return Err(InitiativeExecutorErrorV1::Invalid); }
            let mode = if prepared.dependency_node().is_some() { InitiativeCreationModeV1::Derived } else { InitiativeCreationModeV1::CanonicalOnly };
            let commit = || state.companion_initiative.with_execution_ledger(lease, &scope.control, |store| {
                admitted_policy(store, scope)?;
                effect(store, &mut artifacts, mode)
            }).map_err(InitiativeExecutorErrorV1::from)?;
            if let Some(parent) = prepared.dependency_node() {
                let node = creation_node(&scope.control.owner_pubkey, &self.resident, prepared.job_id(), mode).map_err(|_| InitiativeExecutorErrorV1::Invalid)?;
                let facts = AwarenessHostFactsV1 { owner_pubkey:&scope.control.owner_pubkey,resident_pubkey:&self.resident,now:&now,source_fresh:false,material_state:AwarenessMaterialStateV1::Unavailable };
                state.companion_awareness.with_promotion_lease(lease, &node, &[parent.clone()], &facts,
                    |reference, retained| source.as_ref().map(|facts| facts.resolve(reference, retained)).unwrap_or(AwarenessMaterialFactsV1 { source_fresh:false,material_state:AwarenessMaterialStateV1::Unavailable }),
                    || Ok(commit())).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?
            } else { commit() }
        })
    }
    fn with_own_inquiry<T>(&self, scope: &InitiativeRuntimeScopeV1, prepared: &PreparedInitiativePlanningV1, work: &VerifiedInitiativePursuitV1,
        effect: impl FnOnce(&mut InitiativeStore, InitiativeThreadCommitReceiptV1) -> Result<T, InitiativeExecutorErrorV1>) -> Result<T, InitiativeExecutorErrorV1> {
        // No observation-derived Own birth is silently labelled canonical-only.
        // Exact promotion/descendant controls must precede that separate lane.
        if !self.scope_matches(scope) || prepared.dependency_node().is_some()
            || !prepared.request().evidence.is_empty() || !work.request().evidence.is_empty()
            || work.request().job_id != *prepared.job_id() || work.request().semantic_thread.thread_id != self.thread
        { return Err(InitiativeExecutorErrorV1::Unavailable); }
        let state = self.app.state::<AppState>();
        let live = LiveAwarenessOwner::authenticate(&state).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?;
        if live.owner() != &scope.control.owner_pubkey { return Err(InitiativeExecutorErrorV1::Invalid); }
        let lease = live.lease().map_err(|_| InitiativeExecutorErrorV1::Unavailable)?;
        state.consume_current_resident_own_inquiry(&lease, &self.resident, &self.thread, prepared.expected_record(), &prepared.request().thread.canonical_revision_ref,
            |token, view, canonical| {
                canonical_seed(scope, token, view)?;
                state.companion_execution.with_running(scope, || {
                    let result = state.companion_initiative.with_execution_ledger(&lease, &scope.control, |store| {
                        admitted_policy(store, scope)?;
                        if foreground_active(&self.app, &self.resident, scope.control.now_unix_ms)
                            || managed_cognition::active_binding_ref(&self.resident).ok().as_ref() != Some(&scope.binding_ref)
                            || managed_cognition::active_session_epoch(&self.resident).ok() != Some(scope.session_epoch)
                        { return Err(InitiativeExecutorErrorV1::Busy); }
                        store.validate_private_completion(scope, work.request(), work.result())?;
                        let request = native_own_request(scope, token, view, work)?;
                        let receipt = canonical.commit(request).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?;
                        effect(store, receipt)
                    });
                    Ok(result.map_err(InitiativeExecutorErrorV1::from).and_then(|result| result))
                }).map_err(InitiativeExecutorErrorV1::from)?
            }).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?
    }
    fn track_cancellation(&self, scope: &InitiativeRuntimeScopeV1, job: &OpaqueId, cancel: ManagedInitiativeCancellation) -> Result<(), InitiativeExecutorErrorV1> {
        self.app.state::<AppState>().companion_execution.track(scope, job, &self.thread, self.dependencies.clone(), cancel).map_err(InitiativeExecutorErrorV1::from)
    }
    fn clear_cancellation(&self, scope: &InitiativeRuntimeScopeV1, job: &OpaqueId) { self.app.state::<AppState>().companion_execution.clear(scope, job); }
    fn interrupt(&self, scope: &InitiativeControlScopeV1, job: &OpaqueId) {
        let state = self.app.state::<AppState>();
        let _ = state.companion_execution.cancel_job(scope, job);
        let _ = state.companion_initiative.with_control(scope, |store| store.interrupt_private_cycle(scope, job));
    }
}
/// Narrow canonical settlement after a completed private decision. Does not
/// retry a model, reopen a suppressed inquiry or treat Created as completion.
pub(crate) fn settle_disposition(app: &AppHandle, scope: &InitiativeControlScopeV1, job: &OpaqueId, expected_head: &InitiativeThreadHeadV1, expected_ref: &Sha256Ref) -> Result<bool, InitiativeExecutorErrorV1> {
    let state = app.state::<AppState>();
    let (job, operational) = state.companion_initiative.with_control(scope, |store| {
        let job = store.job(scope, job)?.ok_or(InitiativeStoreErrorV1::Stale)?;
        let thread = store.thread(scope, &job.input.thread_id)?.ok_or(InitiativeStoreErrorV1::Stale)?;
        Ok((job, thread))
    })?;
    if !matches!(job.state, InitiativeJobStateV1::Deferred | InitiativeJobStateV1::Declined | InitiativeJobStateV1::Retired) { return Ok(false); }
    let snapshot = state.read_resident_initiative_threads(&scope.owner_pubkey, &scope.resident_pubkey, false).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?.ok_or(InitiativeExecutorErrorV1::Unavailable)?;
    let mut matches = snapshot.threads.into_iter().filter(|view| view.thread.thread_id == job.input.thread_id);
    let current = matches.next().ok_or(InitiativeExecutorErrorV1::Unavailable)?;
    if matches.next().is_some() || current.pinned_owner_correction || current.record_id != expected_head.record_id || current.thread.revision != expected_head.revision || &current.canonical_revision_ref != expected_ref { return Err(InitiativeExecutorErrorV1::Invalid); }
    let mut next = current.thread.clone();
    next.revision = SafeU53::new(next.revision.get().checked_add(1).ok_or(InitiativeExecutorErrorV1::Invalid)?).map_err(|_| InitiativeExecutorErrorV1::Invalid)?;
    next.disposition = operational.disposition; next.eligible_after = operational.eligible_after.clone();
    next.updated_at = CanonicalTimestamp::parse(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)).map_err(|_| InitiativeExecutorErrorV1::Invalid)?;
    let live = LiveAwarenessOwner::authenticate(&state).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?;
    if live.owner() != &scope.owner_pubkey { return Err(InitiativeExecutorErrorV1::Invalid); }
    let _lease = live.lease().map_err(|_| InitiativeExecutorErrorV1::Unavailable)?;
    let request = InitiativeThreadCommitRequestV1 { owner_pubkey: scope.owner_pubkey.clone(), resident_pubkey: scope.resident_pubkey.clone(), request_id: OpaqueId::parse(format!("initiative-disposition-{}", job.input.job_id.as_str())).map_err(|_| InitiativeExecutorErrorV1::Invalid)?, actor: RevisionActor::Resident,
        canonical_source_clean:false,own_authorship_proof:None,completion_cause:None,expected_head:Some(expected_head.clone()),thread:next };
    let receipt = state.commit_resident_initiative_thread(request).map_err(|_| InitiativeExecutorErrorV1::Unavailable)?;
    drop(_lease);
    let lease = live.lease().map_err(|_| InitiativeExecutorErrorV1::Unavailable)?;
    state.consume_current_resident_initiative_settlement(&lease, &scope.resident_pubkey, &job.input.thread_id, &receipt.record_id, &receipt.canonical_revision_ref, |_, current| {
        if current.disposition != operational.disposition || current.eligible_after != operational.eligible_after { return Err(InitiativeExecutorErrorV1::Invalid); }
        let facts = InitiativeCanonicalFactsV1 { owner_pubkey:scope.owner_pubkey.clone(),resident_pubkey:scope.resident_pubkey.clone(),thread_id:current.thread_id.clone(),kind:current.kind,
            canonical_thread_ref:current.canonical_thread_ref.clone(),canonical_revision_ref:current.canonical_revision_ref.clone() };
        state.companion_initiative.with_execution_ledger(&lease, scope, |store| store.sync_canonical_ref(scope, &job.input.thread_id, operational.revision, expected_ref, &facts, current.disposition, current.eligible_after.clone())).map_err(InitiativeExecutorErrorV1::from)?.map_err(InitiativeExecutorErrorV1::from)
    }).map_err(|_| InitiativeExecutorErrorV1::Unavailable)??;
    Ok(true)
}

#[cfg(test)]
#[path = "desktop_host_tests.rs"]
mod tests;
