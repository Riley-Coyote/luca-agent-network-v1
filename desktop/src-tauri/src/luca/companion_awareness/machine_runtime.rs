//! Machine child of the existing owned source event actor. Restoration is OFF;
//! only explicit live-owner Resume can start an exact AppMetadata notification
//! stream. AX/OCR receive a one-shot request, never activation-driven capture.

use super::*;
use crate::luca::companion_awareness::{
    machine_activity::{MachineActivityAdapter, MachineObservationClassV1},
    machine_catalog::{MachineSourceCatalogV1, MachineSourceSelectionV1},
    machine_runner::{MachineActivationWatcherV1, MachineHelperRunnerV1},
    selected_files::new_id,
};
use luca_protocol::AwarenessSourceStateV1;
use std::cell::Cell;

const MAX_MACHINE_SCOPES: usize = 32;
const STOP_BUDGET: Duration = Duration::from_secs(2);

struct OwnedMachineScope {
    key: AwarenessGrantKeyV1,
    stopped: AtomicBool,
    watcher_attempted: AtomicBool,
    watcher: Mutex<Option<Arc<MachineActivationWatcherV1>>>,
}
impl OwnedMachineScope {
    fn watcher(&self) -> Result<Option<Arc<MachineActivationWatcherV1>>, AwarenessStoreError> {
        self.watcher.lock().map(|watcher| watcher.clone()).map_err(|_| AwarenessStoreError::Unavailable)
    }
    fn cancel(&self, runner: &MachineHelperRunnerV1) {
        self.stopped.store(true, Ordering::Release);
        let _ = runner.cancel_grant(&self.key);
        if let Ok(Some(watcher)) = self.watcher() { watcher.cancel_grant(&self.key); }
    }
    fn terminal(&self, runner: &MachineHelperRunnerV1) -> bool {
        if !self.stopped.load(Ordering::Acquire) { return false; }
        let watcher_terminal = match self.watcher() {
            Ok(Some(watcher)) => watcher.status().terminal_seen,
            // A failed start may have spawned/reaped asynchronously without
            // returning a handle. No automatic retry claims terminal from Err.
            Ok(None) => !self.watcher_attempted.load(Ordering::Acquire),
            Err(_) => false,
        };
        watcher_terminal && runner.status(&self.key).is_ok_and(|status| status.is_none_or(|run| run.terminal_seen))
    }
}

/// Runtime-owned exact cancellation registry. It survives source-pump restarts
/// and never clears an unknown failed startup or an unreaped owned child. No
/// public PID, arbitrary command or native app/model process enters this table.
#[derive(Default)]
pub(super) struct MachineSourceStopsV1 {
    runner: Arc<MachineHelperRunnerV1>,
    scopes: Mutex<Vec<Arc<OwnedMachineScope>>>,
}
impl MachineSourceStopsV1 {
    fn reserve(&self, key: &AwarenessGrantKeyV1) -> Result<Arc<OwnedMachineScope>, AwarenessStoreError> {
        let mut scopes = self.scopes.lock().map_err(|_| AwarenessStoreError::Unavailable)?;
        scopes.retain(|scope| !scope.terminal(&self.runner));
        if scopes.iter().any(|scope| &scope.key == key) { return Err(AwarenessStoreError::Unavailable); }
        if scopes.len() >= MAX_MACHINE_SCOPES { return Err(AwarenessStoreError::Capacity); }
        let scope = Arc::new(OwnedMachineScope { key: key.clone(), stopped: AtomicBool::new(false),
            watcher_attempted: AtomicBool::new(false), watcher: Mutex::new(None) });
        scopes.push(Arc::clone(&scope)); Ok(scope)
    }
    fn matching(&self, stop: Option<&StopScope>) -> Result<Vec<Arc<OwnedMachineScope>>, AwarenessStoreError> {
        Ok(self.scopes.lock().map_err(|_| AwarenessStoreError::Unavailable)?.iter()
            .filter(|scope| stop.is_none_or(|stop| stop.matches(&scope.key))).cloned().collect())
    }
    /// Narrow cancellation intent immediately, without waiting for the event
    /// queue or holding an identity/awareness/continuity or registry lock.
    pub(super) fn cancel(&self, stop: Option<&StopScope>) -> Result<(), AwarenessStoreError> {
        for scope in self.matching(stop)? { scope.cancel(&self.runner); }
        Ok(())
    }
    fn wait(&self, stop: Option<&StopScope>) {
        let deadline = Instant::now() + STOP_BUDGET;
        if let Ok(scopes) = self.matching(stop) {
            for scope in scopes {
                if let Ok(Some(watcher)) = scope.watcher() { watcher.wait_terminal(&scope.key, deadline); }
            }
        }
        // Unproved terminal slots stay present. A later reserve can prune only
        // handles whose real runner/watcher already observed terminal.
    }
}

struct MachineCollector {
    selection: MachineSourceSelectionV1,
    adapter: MachineActivityAdapter,
    owned: Arc<OwnedMachineScope>,
    pending: Cell<Option<Instant>>,
}
/// Mutable collectors are owned by the one existing event actor, never shared
/// behind a catalog mutex that crosses Live source-read or effect locks.
pub(super) struct MachineSourcesV1 {
    catalog: Result<MachineSourceCatalogV1, AwarenessStoreError>,
    stops: Arc<MachineSourceStopsV1>,
    collectors: Vec<MachineCollector>,
}
impl MachineSourcesV1 {
    /// Restore only the fixed private policy catalog; all collectors stay OFF.
    pub(super) fn open(directory: &std::path::Path, owner: &Hex64, device: &OpaqueId, stops: Arc<MachineSourceStopsV1>) -> Self {
        Self { catalog: MachineSourceCatalogV1::open(directory, owner, device), stops, collectors: Vec::new() }
    }
    fn prepare(&self, state: &AppState, runtime: &CompanionAwarenessRuntime, key: &AwarenessGrantKeyV1)
        -> Result<MachineCollector, AwarenessStoreError> {
        let selection = self.catalog.as_ref().map_err(|error| *error)?.selections(&key.resident_pubkey)?
            .into_iter().find(|selection| selection.key() == key).ok_or(AwarenessStoreError::Missing)?;
        let live = LiveAwarenessOwner::authenticate(state)?;
        runtime.with_granted_source_read(&live, key, |_| Ok(()))?;
        let handle = selection.handle()?;
        let owned = self.stops.reserve(key)?;
        let mut adapter = MachineActivityAdapter::new(handle);
        adapter.set_enabled(true);
        // Only explicit Resume requests this initial probe. Restore/selection
        // creates no collector, dirty event, notification stream or raw sample.
        Ok(MachineCollector { selection, adapter, owned, pending: Cell::new(Some(Instant::now())) })
    }
    /// Cancel/drop only matched collectors and wait outside authority locks.
    pub(super) fn stop(&mut self, stop: Option<&StopScope>) -> Result<Vec<AwarenessGrantKeyV1>, AwarenessStoreError> {
        self.stops.cancel(stop)?;
        let mut keys = Vec::new();
        self.collectors.retain_mut(|collector| {
            if stop.is_some_and(|stop| !stop.matches(collector.selection.key())) { return true; }
            collector.adapter.set_enabled(false); collector.pending.set(None);
            keys.push(collector.selection.key().clone()); false
        });
        // All authority callbacks above have returned. This wait is strictly
        // outside identity/control/continuity/material locks and is <=2s total.
        self.stops.wait(stop); Ok(keys)
    }
    /// Coalesce verified dirty signals; this never reads an app or window.
    pub(super) fn delay(&self) -> Option<Duration> {
        let now = Instant::now();
        self.collectors.iter().filter_map(|collector| {
            if collector.owned.stopped.load(Ordering::Acquire) { return Some(Duration::ZERO); }
            match collector.owned.watcher() {
                Ok(Some(watcher)) => {
                    let status = watcher.status();
                    if status.cancel_requested || status.terminal_seen || status.unavailable { return Some(Duration::ZERO); }
                    if watcher.take_changed(collector.selection.key()) { collector.pending.set(Some(now)); }
                }
                Ok(None) => {}, Err(_) => return Some(Duration::ZERO),
            }
            collector.pending.get().map(|changed| DEBOUNCE.saturating_sub(now.saturating_duration_since(changed)))
        }).min()
    }
}

pub(super) enum MachineCommand {
    Inspect(Hex64, Reply<Vec<MachineSourceSelectionV1>>),
    Select(MachineSourceSelectionV1, Reply<()>),
    Resume(AwarenessGrantKeyV1, Reply<()>),
    Remove(AwarenessGrantKeyV1, Reply<()>),
}
impl CompanionSourceRuntimeV1 {
    /// Save just an explicit host machine policy; no OS collection/grant starts.
    pub(crate) fn select_machine(&self, live: &LiveAwarenessOwner<'_>, selection: MachineSourceSelectionV1)
        -> Result<(), AwarenessStoreError> { self.call(live.owner(), |reply| Command::Machine(MachineCommand::Select(selection, reply))) }
    /// Metadata-only inventory for one exact resident. Policies remain private
    /// host values; returned selections are not source health or access proof.
    pub(crate) fn list_machines(&self, owner: &Hex64, resident: &Hex64)
        -> Result<Vec<MachineSourceSelectionV1>, AwarenessStoreError> { self.call(owner, |reply| Command::Machine(MachineCommand::Inspect(resident.clone(), reply))) }
    /// Explicit Resume of one saved grant/class. Only AppMetadata starts a
    /// notification stream; separate AX/OCR choices get one bounded probe only.
    pub(crate) fn resume_machine(&self, live: &LiveAwarenessOwner<'_>, key: &AwarenessGrantKeyV1)
        -> Result<(), AwarenessStoreError> { self.call(live.owner(), |reply| Command::Machine(MachineCommand::Resume(key.clone(), reply))) }
    /// Remove configuration only after the parent's durable denial. Existing
    /// stop hooks cancel precisely this owned scope, not external app work.
    pub(crate) fn remove_machine(&self, owner: &Hex64, key: &AwarenessGrantKeyV1) -> Result<(), AwarenessStoreError> {
        self.after_grant_withdrawal(owner, key)?;
        self.call(owner, |reply| Command::Machine(MachineCommand::Remove(key.clone(), reply)))
    }
}

impl SourceEngine {
    pub(super) fn machine_command(&mut self, state: &AppState, command: MachineCommand, expired: bool, cancellation: &AtomicBool) {
        match command {
            MachineCommand::Inspect(resident, reply) => {
                let result = if expired { Err(AwarenessStoreError::Unavailable) } else {
                    self.machines.catalog.as_ref().map_err(|error| *error).and_then(|catalog| catalog.selections(&resident))
                }; let _ = reply.send(result);
            }
            MachineCommand::Select(selection, reply) => {
                let result = if expired || !self.key_current(selection.key()) { Err(AwarenessStoreError::Invalid) } else {
                    self.authenticate(state).and_then(|live| self.machines.catalog.as_mut().map_err(|error| *error)?.select(&live, selection))
                }; let _ = reply.send(result);
            }
            MachineCommand::Resume(key, reply) => {
                let result = if expired { Err(AwarenessStoreError::Unavailable) } else { self.resume_machine(state, &key) };
                if cancellation.load(Ordering::Acquire) { let _ = self.apply_stop(&state.companion_awareness, &StopScope::Grant(key)); }
                let _ = reply.send(result);
            }
            MachineCommand::Remove(key, reply) => {
                let result = if expired || !self.key_current(&key) { Err(AwarenessStoreError::Invalid) } else {
                    self.machines.catalog.as_mut().map_err(|error| *error).and_then(|catalog| catalog.remove(&self.owner, &key))
                }; let _ = reply.send(result);
            }
        }
    }
    fn resume_machine(&mut self, state: &AppState, key: &AwarenessGrantKeyV1) -> Result<(), AwarenessStoreError> {
        if !self.key_current(key) { return Err(AwarenessStoreError::Invalid); }
        let active = self.shared.facts.lock().map_err(|_| AwarenessStoreError::Unavailable)?.active.clone();
        if !active.contains(key) && active.len() >= MAX_ACTIVE_SCOPES { return Err(AwarenessStoreError::Capacity); }
        // Retire any earlier owned collector BEFORE a new source-read callback;
        // actual terminal proof is still required by the reservation registry.
        self.apply_stop(&state.companion_awareness, &StopScope::Grant(key.clone()))?;
        let live = self.authenticate(state)?;
        let collector = self.machines.prepare(state, &state.companion_awareness, key)?;
        let result = (|| {
            let authority = state.companion_awareness.snapshot(&self.owner, key)?;
            if authority.source.state != AwarenessSourceStateV1::Unknown {
                state.companion_awareness.set_source_health(&live, &key.source, authority.source_revision,
                    AwarenessSourceStateV1::Unknown, &new_id("machine-resume")?)?;
            }
            if collector.selection.class() == MachineObservationClassV1::AppMetadata {
                if collector.owned.stopped.load(Ordering::Acquire) { return Err(AwarenessStoreError::Unavailable); }
                collector.owned.watcher_attempted.store(true, Ordering::Release);
                let watcher = Arc::new(collector.adapter.start_activation_watcher(state, &state.companion_awareness, self.shared.wake.clone())?);
                *collector.owned.watcher.lock().map_err(|_| AwarenessStoreError::Unavailable)? = Some(Arc::clone(&watcher));
                if collector.owned.stopped.load(Ordering::Acquire) { watcher.cancel_grant(key); return Err(AwarenessStoreError::Unavailable); }
            }
            // A durable Pause/revoke between startup and registration wins.
            state.companion_awareness.with_granted_source_read(&live, key, |_| {
                if collector.owned.stopped.load(Ordering::Acquire) { Err(AwarenessStoreError::Unavailable) } else { Ok(()) }
            })?;
            self.active(key, true)?;
            // Keep the material lock outside the authority fence. A deny-first
            // Stop racing that small registration gap cannot re-current it.
            if collector.owned.stopped.load(Ordering::Acquire) {
                self.active(key, false)?; Err(AwarenessStoreError::Unavailable)
            } else { Ok(()) }
        })();
        if let Err(error) = result { collector.owned.cancel(&self.machines.stops.runner); self.machines.stops.wait(Some(&StopScope::Grant(key.clone()))); return Err(error); }
        self.machines.collectors.push(collector); Ok(())
    }
    pub(super) fn stop_machines(&mut self, runtime: &CompanionAwarenessRuntime, stop: Option<&StopScope>) -> Result<(), AwarenessStoreError> {
        let keys = self.machines.stop(stop)?;
        for key in keys {
            runtime.with_controller(&self.owner, |controller| {
                if let Ok(authority) = controller.store.snapshot(&key) {
                    controller.buffer.invalidate_grant(&self.owner, &key.resident_pubkey, &authority.grant.grant_id);
                } Ok(())
            })?;
        } Ok(())
    }
    pub(super) fn sample_machines(&mut self, state: &AppState, now: &CanonicalTimestamp) {
        let runner = Arc::clone(&self.machines.stops.runner);
        self.sample_machines_with(state, now, |adapter, _| {
            adapter.sample_embedded(state, &state.companion_awareness, now, &runner)
        });
    }
    fn sample_machines_with(&mut self, state: &AppState, _now: &CanonicalTimestamp,
        mut sample: impl FnMut(&mut MachineActivityAdapter, &AwarenessGrantKeyV1) -> Result<SamplingOutcomeV1, AwarenessStoreError>) {
        let mut stop = Vec::new();
        for collector in &mut self.machines.collectors {
            let key = collector.selection.key().clone();
            let fault = collector.owned.watcher().map_or(true, |watcher| watcher.is_some_and(|watcher| {
                let status = watcher.status(); status.cancel_requested || status.unavailable || status.terminal_seen
            }));
            if collector.owned.stopped.load(Ordering::Acquire) || fault { stop.push(key); continue; }
            if collector.pending.get().is_none_or(|changed| changed.elapsed() < DEBOUNCE) { continue; }
            let saved = self.machines.catalog.as_ref().map_err(|error| *error)
                .and_then(|catalog| catalog.selections(&key.resident_pubkey))
                .is_ok_and(|selections| selections.iter().any(|selection| selection.key() == &key && selection.class() == collector.selection.class()));
            if !saved { stop.push(key); continue; }
            collector.pending.set(None);
            collector.adapter.mark_changed();
            let outcome = sample(&mut collector.adapter, &key);
            if let Ok(mut facts) = self.shared.facts.lock() {
                match &outcome {
                    Ok(SamplingOutcomeV1::Admitted(reference)) => facts.remember(reference.clone(), SourceMaterialScopeV1::Machine(collector.selection.class())),
                    Ok(SamplingOutcomeV1::Unchanged) => {},
                    _ => facts.invalidate(&StopScope::Grant(key.clone())),
                }
            }
            if outcome.is_err() { stop.push(key); }
            // Yield to priority Stop/commands/privacy housekeeping after every
            // bounded native read; never serially capture every selected scope.
            break;
        }
        for key in stop { let _ = self.apply_stop(&state.companion_awareness, &StopScope::Grant(key)); }
    }
}

#[cfg(all(test, unix))]
#[path = "machine_runtime_tests.rs"]
mod tests;
