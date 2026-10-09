//! Owned source lifecycle glue, not a scheduler, model lane or consent authority.
//!
//! One event pump owns the mutable catalog/collectors without a registry mutex.
//! A separate short metadata lock never crosses Live identity/awareness calls.
//! Initialization restores private configuration only, with every collector off;
//! the independent privacy timer expires raw bytes even when keys/sources are idle.
//! Parent commits durable Pause/revoke first and calls the exact stop hooks below.

use super::catalog::{
    prune_expired_payloads, SelectedSourceCatalogV1, SelectedSourceClassV1,
    SelectedSourceCollectorsV1, SelectedSourceSelectionV1, PAYLOAD_PRUNE_INTERVAL,
};
use super::native_profile::{
    NativeProfileAdapter, NativeProfilePurposeFactsV1, NativeProfileSamplingOutcomeV1,
    NativeProfileSelectionV1,
};
use super::native_work::NativeWorkActivityFactV1;
use super::profile_catalog::{NativeProfileCatalogV1, NativeProfileRegistrationV1};
use super::selected_files::SamplingOutcomeV1;
use super::{
    AwarenessGrantKeyV1, AwarenessSourceKeyV1, AwarenessStoreError, CompanionAwarenessRuntime,
    LiveAwarenessOwner,
};
use crate::app_state::AppState;
use luca_protocol::{AwarenessMaterialStateV1, CanonicalTimestamp, Hex64, OpaqueId};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

#[path = "source_material.rs"]
mod material;
#[path = "profile_runtime.rs"]
mod profiles;
#[path = "machine_runtime.rs"]
mod machines;
use machines::{MachineCommand, MachineSourceStopsV1, MachineSourcesV1};
pub(crate) use profiles::desktop_source_bindings;
use material::MaterialBook;
pub(crate) use material::{
    preload_retained_source_facts, preload_source_facts_before,
    SourceMaterialScopeV1, SourceMaterialSnapshotV1,
};

const MAX_ACTIVE_SCOPES: usize = 64;
const MAX_MATERIAL_REFS: usize = 128;
const MAX_PENDING_PROFILE_CHILDREN: usize = 32;
const MAX_PRIORITY_STOPS: usize = MAX_ACTIVE_SCOPES * 3;
const COMMAND_CAPACITY: usize = 32;
const COMMAND_DEADLINE: Duration = Duration::from_secs(5);
const DEBOUNCE: Duration = Duration::from_millis(750);

type ActivityResolver = dyn Fn(
        &AppState,
        &AwarenessGrantKeyV1,
        Option<&OpaqueId>,
        &CanonicalTimestamp,
    ) -> Option<NativeWorkActivityFactV1>
    + Send
    + Sync;
type SavedProfileResolver = dyn Fn(&AppState, &NativeProfileSelectionV1) -> bool + Send + Sync;
type PurposeResolver = dyn Fn(
        &AppState,
        &NativeProfileSelectionV1,
        &CanonicalTimestamp,
    ) -> Option<NativeProfilePurposeFactsV1>
    + Send
    + Sync;
type ExactExclusionsResolver = dyn Fn(
        &AppState,
        &AwarenessGrantKeyV1,
        SelectedSourceClassV1,
        &CanonicalTimestamp,
    ) -> Option<std::collections::HashSet<String>>
    + Send
    + Sync;

/// Trusted bounded, non-mutating host facts. Defaults establish neither saved
/// profile consent nor complete exclusions. Callbacks must not invoke a model,
/// discover native profiles, await, or reenter this runtime. They are not serde
/// selectors/capabilities; parent derives them from current native authorities.
pub(crate) struct SourceRuntimeBindingsV1 {
    pub(crate) activity: Arc<ActivityResolver>,
    pub(crate) profile_selection_is_saved: Arc<SavedProfileResolver>,
    pub(crate) profile_purpose: Arc<PurposeResolver>,
    pub(crate) exact_exclusions: Arc<ExactExclusionsResolver>,
}
impl Default for SourceRuntimeBindingsV1 {
    fn default() -> Self {
        Self {
            activity: Arc::new(|_, _, _, _| None),
            profile_selection_is_saved: Arc::new(|_, _| false),
            profile_purpose: Arc::new(|_, _, _| None),
            exact_exclusions: Arc::new(|_, _, class, _| {
                (class == SelectedSourceClassV1::SelectedFile).then(std::collections::HashSet::new)
            }),
        }
    }
}


#[derive(Clone, PartialEq, Eq)]
enum StopScope {
    Grant(AwarenessGrantKeyV1),
    Resident(Hex64),
    Source(AwarenessSourceKeyV1),
}
impl StopScope {
    fn matches(&self, key: &AwarenessGrantKeyV1) -> bool {
        match self {
            Self::Grant(exact) => exact == key,
            Self::Resident(resident) => &key.resident_pubkey == resident,
            Self::Source(source) => source == &key.source,
        }
    }
}
struct Shared {
    facts: Arc<Mutex<MaterialBook>>,
    priority: Mutex<VecDeque<StopScope>>,
    closing: AtomicBool,
    wake: mpsc::SyncSender<()>,
    machine_stops: Arc<MachineSourceStopsV1>,
}
struct RuntimeHandle {
    owner: Hex64,
    device: OpaqueId,
    commands: mpsc::SyncSender<Envelope>,
    shared: Arc<Shared>,
    worker: JoinHandle<()>,
}
type Reply<T> = mpsc::Sender<Result<T, AwarenessStoreError>>;
enum Command {
    Inspect(Hex64, Reply<Vec<SelectedSourceSelectionV1>>),
    Select(SelectedSourceSelectionV1, Reply<()>),
    Remove(AwarenessGrantKeyV1, Reply<()>),
    Resume(
        AwarenessGrantKeyV1,
        std::collections::HashSet<String>,
        Reply<()>,
    ),
    Profile(NativeProfileSelectionV1, Reply<()>),
    SelectProfile(NativeProfileRegistrationV1, Reply<()>),
    InspectProfiles(Hex64, Reply<Vec<NativeProfileRegistrationV1>>),
    RemoveProfile(AwarenessGrantKeyV1, Reply<()>),
    ProfileChanged(AwarenessGrantKeyV1, String),
    Machine(MachineCommand),
}
struct Envelope {
    deadline: Instant,
    cancelled: Arc<AtomicBool>,
    command: Command,
}

/// Thin AppState-owned handle. Default launches nothing. No registry/catalog
/// mutex is held while waiting for a command or acquiring Live identity.
#[derive(Default)]
pub(crate) struct CompanionSourceRuntimeV1 {
    inner: Mutex<Option<RuntimeHandle>>,
    facts: Arc<Mutex<MaterialBook>>,
    machine_stops: Arc<MachineSourceStopsV1>,
}
impl CompanionSourceRuntimeV1 {
    /// First relevant feature initialization: restore only/off, then start one
    /// owned idle event pump + privacy timer. False means the private catalog is
    /// unavailable (not repaired); privacy housekeeping still runs. Call outside
    /// identity/continuity/awareness locks and call shutdown from app shutdown.
    pub(crate) fn initialize(
        &self,
        app: AppHandle,
        bindings: SourceRuntimeBindingsV1,
    ) -> Result<bool, AwarenessStoreError> {
        self.shutdown();
        let state = app.state::<AppState>();
        if state.shutdown_started.load(Ordering::Acquire) {
            return Err(AwarenessStoreError::Unavailable);
        }
        let runtime = &state.companion_awareness;
        let owner = runtime
            .control_owner()
            .ok_or(AwarenessStoreError::Unavailable)?;
        let device = runtime.device(&owner)?;
        let catalog =
            SelectedSourceCatalogV1::open(&runtime.private_directory(&owner)?, &owner, &device);
        let profile_catalog = NativeProfileCatalogV1::open(&runtime.private_directory(&owner)?, &owner, &device);
        let machines = MachineSourcesV1::open(&runtime.private_directory(&owner)?, &owner, &device, Arc::clone(&self.machine_stops));
        // Machine policy failures are isolated to their own command path; do
        // not change the existing exact-file/native-profile readiness contract.
        let ready = catalog.is_ok() && profile_catalog.is_ok();
        *self
            .facts
            .lock()
            .map_err(|_| AwarenessStoreError::Unavailable)? = MaterialBook {
            owner: Some(owner.clone()),
            ..Default::default()
        };
        let (commands, receiver) = mpsc::sync_channel(COMMAND_CAPACITY);
        let (wake, events) = mpsc::sync_channel(1);
        let shared = Arc::new(Shared {
            facts: Arc::clone(&self.facts),
            priority: Mutex::new(VecDeque::new()),
            closing: AtomicBool::new(false),
            wake,
            machine_stops: Arc::clone(&self.machine_stops),
        });
        let mut engine = SourceEngine {
            owner: owner.clone(),
            device: device.clone(),
            catalog,
            profile_catalog,
            exact: BTreeMap::new(),
            profiles: Vec::new(),
            machines,
            bindings,
            shared: Arc::clone(&shared),
            commands: commands.clone(),
        };
        if state.shutdown_started.load(Ordering::Acquire) {
            return Err(AwarenessStoreError::Unavailable);
        }
        drop(state);
        let worker_app = app.clone();
        let worker = thread::Builder::new()
            .name("luca-companion-source-events".into())
            .spawn(move || event_loop(worker_app, &mut engine, receiver, events))
            .map_err(|_| AwarenessStoreError::Unavailable)?;
        // The event loop checks AppState.shutdown_started before each effect;
        // publishing the handle under this lock lets shutdown always take/join it.
        match self.inner.lock() {
            Ok(mut inner) => {
                if app
                    .state::<AppState>()
                    .shutdown_started
                    .load(Ordering::Acquire)
                {
                    shared.closing.store(true, Ordering::Release);
                    let _ = shared.wake.try_send(());
                    drop(inner);
                    let _ = worker.join();
                    return Err(AwarenessStoreError::Unavailable);
                }
                *inner = Some(RuntimeHandle {
                    owner,
                    device,
                    commands,
                    shared,
                    worker,
                });
            }
            Err(_) => {
                shared.closing.store(true, Ordering::Release);
                let _ = shared.wake.try_send(());
                let _ = worker.join();
                return Err(AwarenessStoreError::Unavailable);
            }
        }
        Ok(ready)
    }
    /// Known saved exact handles only; private locators must never leave host IPC
    /// adapters. Reading this inventory does not authorize collection or egress.
    pub(crate) fn selected(
        &self,
        owner: &Hex64,
        resident: &Hex64,
    ) -> Result<Vec<SelectedSourceSelectionV1>, AwarenessStoreError> {
        self.call(owner, |reply| Command::Inspect(resident.clone(), reply))
    }
    /// Explicit configuration selection; worker reauthenticates current owner.
    /// Call with borrowed Live proof, never while holding a Live lease/effect lock.
    pub(crate) fn select(
        &self,
        live: &LiveAwarenessOwner<'_>,
        selection: SelectedSourceSelectionV1,
    ) -> Result<(), AwarenessStoreError> {
        self.call(live.owner(), |reply| Command::Select(selection, reply))
    }
    /// Forget only configuration after parent's durable withdrawal. Canonical
    /// Forget/promotion cleanup remains the existing parent authority's job.
    pub(crate) fn remove(
        &self,
        retained_owner: &Hex64,
        key: &AwarenessGrantKeyV1,
    ) -> Result<(), AwarenessStoreError> {
        self.after_grant_withdrawal(retained_owner, key)?;
        self.call(retained_owner, |reply| Command::Remove(key.clone(), reply))
    }
    /// Explicit exact selection Resume with fresh host-owned private exclusions.
    /// Saved configuration, historical source Current and mtime are not Live proof.
    pub(crate) fn resume(
        &self,
        live: &LiveAwarenessOwner<'_>,
        key: &AwarenessGrantKeyV1,
        excluded: std::collections::HashSet<String>,
    ) -> Result<(), AwarenessStoreError> {
        self.call(live.owner(), |reply| {
            Command::Resume(key.clone(), excluded, reply)
        })
    }
    /// Durable Pause precedes this keyless priority intent. Queued ordinary
    /// commands cannot defeat denial; no model/key is needed to stop owned work.
    pub(crate) fn after_pause(
        &self,
        owner: &Hex64,
        resident: &Hex64,
    ) -> Result<(), AwarenessStoreError> {
        self.stop(owner, StopScope::Resident(resident.clone()))
    }
    /// Exact grant hook after durable deny/buffer eviction, never D0 task stop.
    pub(crate) fn after_grant_withdrawal(
        &self,
        owner: &Hex64,
        key: &AwarenessGrantKeyV1,
    ) -> Result<(), AwarenessStoreError> {
        if &key.source.owner_pubkey != owner {
            return Err(AwarenessStoreError::Invalid);
        }
        self.stop(owner, StopScope::Grant(key.clone()))
    }
    /// Exact source-wide hook after parent's durable source withdrawal.
    pub(crate) fn after_source_withdrawal(
        &self,
        owner: &Hex64,
        key: &AwarenessSourceKeyV1,
    ) -> Result<(), AwarenessStoreError> {
        if &key.owner_pubkey != owner {
            return Err(AwarenessStoreError::Invalid);
        }
        self.stop(owner, StopScope::Source(key.clone()))
    }
    /// Pure body-free snapshot: no queue wait, Live/key request or source read.
    /// Preload it before effect leases; callbacks must use preloaded child facts.
    pub(crate) fn snapshot(
        &self,
        owner: &Hex64,
        resident: &Hex64,
        now: &CanonicalTimestamp,
    ) -> Result<SourceMaterialSnapshotV1, AwarenessStoreError> {
        let facts = self
            .facts
            .lock()
            .map_err(|_| AwarenessStoreError::Unavailable)?;
        if facts.owner.as_ref() != Some(owner) {
            return Err(AwarenessStoreError::Invalid);
        }
        Ok(SourceMaterialSnapshotV1 {
            now: now.clone(),
            known_exact: facts
                .known_exact
                .iter()
                .filter(|(key, _)| &key.resident_pubkey == resident)
                .cloned()
                .collect(),
            records: facts
                .records
                .iter()
                .filter(|record| &record.binding.reference.resident_pubkey == resident)
                .cloned()
                .collect(),
            collecting: facts
                .active
                .iter()
                .filter(|key| &key.resident_pubkey == resident)
                .cloned()
                .collect(),
        })
    }
    fn call<T>(
        &self,
        owner: &Hex64,
        command: impl FnOnce(Reply<T>) -> Command,
    ) -> Result<T, AwarenessStoreError> {
        let (commands, shared) = {
            let inner = self
                .inner
                .lock()
                .map_err(|_| AwarenessStoreError::Unavailable)?;
            let handle = inner.as_ref().ok_or(AwarenessStoreError::Unavailable)?;
            if &handle.owner != owner || handle.shared.closing.load(Ordering::Acquire) {
                return Err(AwarenessStoreError::Invalid);
            }
            (handle.commands.clone(), Arc::clone(&handle.shared))
        };
        let (reply, response) = mpsc::channel();
        let cancelled = Arc::new(AtomicBool::new(false));
        let envelope = Envelope {
            deadline: Instant::now()
                .checked_add(COMMAND_DEADLINE)
                .ok_or(AwarenessStoreError::Unavailable)?,
            cancelled: Arc::clone(&cancelled),
            command: command(reply),
        };
        commands.try_send(envelope).map_err(|error| match error {
            mpsc::TrySendError::Full(_) => AwarenessStoreError::Capacity,
            _ => AwarenessStoreError::Unavailable,
        })?;
        let _ = shared.wake.try_send(());
        match response.recv_timeout(COMMAND_DEADLINE) {
            Ok(result) => result,
            Err(_) => {
                cancelled.store(true, Ordering::Release);
                Err(AwarenessStoreError::Unavailable)
            }
        }
    }
    fn stop(&self, owner: &Hex64, scope: StopScope) -> Result<(), AwarenessStoreError> {
        let shared = {
            let inner = self
                .inner
                .lock()
                .map_err(|_| AwarenessStoreError::Unavailable)?;
            let Some(handle) = inner.as_ref() else {
                return Ok(());
            };
            if &handle.owner != owner {
                return Err(AwarenessStoreError::Invalid);
            }
            match &scope {
                StopScope::Grant(key) if key.source.device_id != handle.device => {
                    return Err(AwarenessStoreError::Invalid)
                }
                StopScope::Source(key) if key.device_id != handle.device => {
                    return Err(AwarenessStoreError::Invalid)
                }
                _ => {}
            }
            Arc::clone(&handle.shared)
        };
        shared.machine_stops.cancel(Some(&scope))?;
        {
            let mut facts = shared
                .facts
                .lock()
                .map_err(|_| AwarenessStoreError::Unavailable)?;
            facts.invalidate(&scope);
            facts.active.retain(|key| !scope.matches(key));
        }
        let mut priority = shared
            .priority
            .lock()
            .map_err(|_| AwarenessStoreError::Unavailable)?;
        if !priority.contains(&scope) {
            if priority.len() == MAX_PRIORITY_STOPS {
                return Err(AwarenessStoreError::Capacity);
            }
            priority.push_back(scope);
        }
        drop(priority);
        let _ = shared.wake.try_send(());
        Ok(())
    }
    /// Stop/wake/join all owned loops and drop owned watchers. Call outside
    /// authority locks; local bounded reads may finish first, never a model wait.
    pub(crate) fn shutdown(&self) {
        let handle = self.inner.lock().ok().and_then(|mut inner| inner.take());
        if let Some(handle) = handle {
            handle.shared.closing.store(true, Ordering::Release);
            let _ = handle.shared.machine_stops.cancel(None);
            let _ = handle.shared.wake.try_send(());
            let _ = handle.worker.join();
        }
        if let Ok(mut facts) = self.facts.lock() {
            *facts = MaterialBook::default();
        }
    }
}
impl Drop for CompanionSourceRuntimeV1 {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct ChangedProfileChild {
    child: OpaqueId,
    changed_at: Instant,
}
struct ProfileCollector {
    adapter: NativeProfileAdapter,
    pending: VecDeque<ChangedProfileChild>,
    _watcher: notify::RecommendedWatcher,
    fault: Arc<AtomicBool>,
}
struct SourceEngine {
    owner: Hex64,
    device: OpaqueId,
    catalog: Result<SelectedSourceCatalogV1, AwarenessStoreError>,
    profile_catalog: Result<NativeProfileCatalogV1, AwarenessStoreError>,
    exact: BTreeMap<Hex64, SelectedSourceCollectorsV1>,
    profiles: Vec<ProfileCollector>,
    machines: MachineSourcesV1,
    bindings: SourceRuntimeBindingsV1,
    shared: Arc<Shared>,
    commands: mpsc::SyncSender<Envelope>,
}
impl SourceEngine {
    fn key_current(&self, key: &AwarenessGrantKeyV1) -> bool {
        key.source.owner_pubkey == self.owner && key.source.device_id == self.device
    }
    fn authenticate<'a>(
        &self,
        state: &'a AppState,
    ) -> Result<LiveAwarenessOwner<'a>, AwarenessStoreError> {
        let live = LiveAwarenessOwner::authenticate(state)?;
        if live.owner() != &self.owner {
            return Err(AwarenessStoreError::Invalid);
        }
        Ok(live)
    }
    fn active(&self, key: &AwarenessGrantKeyV1, enabled: bool) -> Result<(), AwarenessStoreError> {
        let mut facts = self
            .shared
            .facts
            .lock()
            .map_err(|_| AwarenessStoreError::Unavailable)?;
        facts.active.retain(|existing| existing != key);
        if enabled {
            facts.active.push(key.clone());
        }
        Ok(())
    }
    fn inspect(
        &self,
        resident: &Hex64,
    ) -> Result<Vec<SelectedSourceSelectionV1>, AwarenessStoreError> {
        let selected = self
            .catalog
            .as_ref()
            .map_err(|error| *error)?
            .selections(resident)?;
        let mut facts = self
            .shared
            .facts
            .lock()
            .map_err(|_| AwarenessStoreError::Unavailable)?;
        facts
            .known_exact
            .retain(|(key, _)| &key.resident_pubkey != resident);
        facts.known_exact.extend(
            selected
                .iter()
                .map(|selection| (selection.key().clone(), selection.class())),
        );
        Ok(selected)
    }
    fn command(&mut self, state: &AppState, envelope: Envelope, now: &CanonicalTimestamp) {
        let expired =
            envelope.cancelled.load(Ordering::Acquire) || Instant::now() >= envelope.deadline;
        let cancellation = Arc::clone(&envelope.cancelled);
        match envelope.command {
            Command::Inspect(resident, reply) => {
                let _ = reply.send(if expired {
                    Err(AwarenessStoreError::Unavailable)
                } else {
                    self.inspect(&resident)
                });
            }
            Command::Select(selection, reply) => {
                let result = if expired {
                    Err(AwarenessStoreError::Unavailable)
                } else {
                    self.authenticate(state).and_then(|live| {
                        self.catalog
                            .as_mut()
                            .map_err(|error| *error)?
                            .select(&live, selection)
                    })
                };
                let _ = reply.send(result);
            }
            Command::Remove(key, reply) => {
                let result = if expired || !self.key_current(&key) {
                    Err(AwarenessStoreError::Invalid)
                } else {
                    self.catalog
                        .as_mut()
                        .map_err(|error| *error)
                        .and_then(|catalog| catalog.remove(&self.owner, &key))
                };
                if result.is_ok() {
                    let _ = self.inspect(&key.resident_pubkey);
                }
                let _ = reply.send(result);
            }
            Command::Resume(key, excluded, reply) => {
                let result = if expired {
                    Err(AwarenessStoreError::Unavailable)
                } else {
                    self.resume(state, &key, excluded)
                };
                if cancellation.load(Ordering::Acquire) {
                    let _ = self.apply_stop(&state.companion_awareness, &StopScope::Grant(key));
                }
                let _ = reply.send(result);
            }
            Command::Profile(selection, reply) => {
                let key = selection.grant_key().clone();
                let result = if expired {
                    Err(AwarenessStoreError::Unavailable)
                } else {
                    self.register_profile(state, selection, now)
                };
                if cancellation.load(Ordering::Acquire) {
                    let _ = self.apply_stop(&state.companion_awareness, &StopScope::Grant(key));
                }
                let _ = reply.send(result);
            }
            Command::SelectProfile(registration, reply) => {
                let result = if expired { Err(AwarenessStoreError::Unavailable) } else {
                    self.authenticate(state).and_then(|live| self.profile_catalog.as_mut().map_err(|e|*e)?.select(&live, registration))
                };
                let _ = reply.send(result);
            }
            Command::InspectProfiles(resident, reply) => {
                let result = if expired { Err(AwarenessStoreError::Unavailable) } else {
                    self.profile_catalog.as_ref().map_err(|e|*e).and_then(|catalog| catalog.profiles(&resident))
                };
                let _ = reply.send(result);
            }
            Command::RemoveProfile(key, reply) => {
                let result = if expired || !self.key_current(&key) { Err(AwarenessStoreError::Invalid) } else {
                    self.profile_catalog.as_mut().map_err(|e|*e).and_then(|catalog| catalog.remove(&self.owner, &key))
                };
                let _ = reply.send(result);
            }
            Command::ProfileChanged(key, locator) => {
                if !expired {
                    if self.profile_event(&key, locator).is_err() {
                        let _ = self.apply_stop(&state.companion_awareness, &StopScope::Grant(key));
                    }
                }
            }
            Command::Machine(command) => self.machine_command(state, command, expired, &cancellation),
        }
    }
    fn resume(
        &mut self,
        state: &AppState,
        key: &AwarenessGrantKeyV1,
        _excluded: std::collections::HashSet<String>,
    ) -> Result<(), AwarenessStoreError> {
        if !self.key_current(key) {
            return Err(AwarenessStoreError::Invalid);
        }
        let selection = self
            .inspect(&key.resident_pubkey)?
            .into_iter()
            .find(|selection| selection.key() == key)
            .ok_or(AwarenessStoreError::Missing)?;
        let started = Instant::now();
        let excluded = (self.bindings.exact_exclusions)(state, key, selection.class(), &utc_now()?)
            .ok_or(AwarenessStoreError::Unavailable)?;
        if started.elapsed() > Duration::from_secs(1) {
            return Err(AwarenessStoreError::Unavailable);
        }
        if selection
            .safe_exclusion_scope(&excluded)?
            .material
            .material_state
            == AwarenessMaterialStateV1::Excluded
        {
            return Err(AwarenessStoreError::Unavailable);
        }
        let active = self
            .shared
            .facts
            .lock()
            .map_err(|_| AwarenessStoreError::Unavailable)?
            .active
            .clone();
        if !active.contains(key) && active.len() >= MAX_ACTIVE_SCOPES {
            return Err(AwarenessStoreError::Capacity);
        }
        let live = self.authenticate(state)?;
        let collectors = self
            .exact
            .entry(key.resident_pubkey.clone())
            .or_insert_with(|| {
                SelectedSourceCollectorsV1::new(
                    self.owner.clone(),
                    key.resident_pubkey.clone(),
                    self.device.clone(),
                )
            });
        collectors.resume(
            self.catalog.as_ref().map_err(|error| *error)?,
            &live,
            &state.companion_awareness,
            key,
            excluded,
            self.shared.wake.clone(),
        )?;
        self.active(key, true)
    }
    fn apply_stop(
        &mut self,
        runtime: &CompanionAwarenessRuntime,
        scope: &StopScope,
    ) -> Result<(), AwarenessStoreError> {
        let mut error = self.stop_machines(runtime, Some(scope)).err();
        for (resident, collectors) in &mut self.exact {
            let result = match scope {
                StopScope::Grant(key) if &key.resident_pubkey == resident => {
                    collectors.stop_grant(runtime, key)
                }
                StopScope::Resident(target) if target == resident => {
                    collectors.stop_resident(runtime, &self.owner, resident)
                }
                StopScope::Source(key) => collectors.stop_source(runtime, key),
                _ => Ok(()),
            };
            if let Err(value) = result {
                error = Some(value);
            }
        }
        self.profiles.retain_mut(|profile| {
            if !scope.matches(profile.adapter.selection().grant_key()) {
                return true;
            }
            let key = profile.adapter.selection().grant_key().clone();
            profile.adapter.set_enabled(false);
            let result = runtime.with_controller(&self.owner, |controller| {
                if let Ok(authority) = controller.store.snapshot(&key) {
                    controller.buffer.invalidate_grant(
                        &self.owner,
                        &key.resident_pubkey,
                        &authority.grant.grant_id,
                    );
                }
                Ok(())
            });
            if let Err(value) = result {
                error = Some(value);
            }
            false
        });
        let mut facts = self
            .shared
            .facts
            .lock()
            .map_err(|_| AwarenessStoreError::Unavailable)?;
        facts.invalidate(scope);
        facts.active.retain(|key| !scope.matches(key));
        error.map_or(Ok(()), Err)
    }
    fn priority(&mut self, runtime: &CompanionAwarenessRuntime) {
        let stops = self
            .shared
            .priority
            .lock()
            .ok()
            .map(|mut priority| priority.drain(..).collect::<Vec<_>>())
            .unwrap_or_default();
        for stop in stops {
            let _ = self.apply_stop(runtime, &stop);
        }
    }
    fn delay(&self) -> Option<Duration> {
        let now = Instant::now();
        self.exact
            .values()
            .filter_map(SelectedSourceCollectorsV1::next_sample_delay)
            .chain(self.profiles.iter().flat_map(|profile| {
                profile.pending.iter().map(|pending| {
                    DEBOUNCE.saturating_sub(now.saturating_duration_since(pending.changed_at))
                })
            }))
            .chain(self.machines.delay())
            .min()
    }
    fn sample(&mut self, state: &AppState, now: &CanonicalTimestamp) {
        let runtime = &state.companion_awareness;
        for collectors in self.exact.values_mut() {
            for key in collectors.ready_keys() {
                let class = self.shared.facts.lock().ok().and_then(|facts| {
                    facts
                        .known_exact
                        .iter()
                        .find(|(known, _)| known == &key)
                        .map(|(_, class)| *class)
                });
                let Some(class) = class else {
                    let _ = collectors.stop_grant(runtime, &key);
                    continue;
                };
                if class == SelectedSourceClassV1::SelectedFile {
                    continue;
                }
                let started = Instant::now();
                let exclusions = (self.bindings.exact_exclusions)(state, &key, class, now);
                let updated = if started.elapsed() <= Duration::from_secs(1) {
                    exclusions
                        .ok_or(AwarenessStoreError::Unavailable)
                        .and_then(|excluded| {
                            let selected = self
                                .catalog
                                .as_ref()
                                .map_err(|error| *error)?
                                .selections(&key.resident_pubkey)?
                                .into_iter()
                                .find(|selection| selection.key() == &key)
                                .ok_or(AwarenessStoreError::Missing)?;
                            let material = selected
                                .safe_exclusion_scope(&excluded)?
                                .material
                                .material_state;
                            if material == AwarenessMaterialStateV1::Excluded {
                                if let Ok(mut facts) = self.shared.facts.lock() {
                                    facts.scope_state(&key, material);
                                }
                                return Err(AwarenessStoreError::Unavailable);
                            }
                            collectors.update_native_exclusions(&key, excluded)
                        })
                } else {
                    Err(AwarenessStoreError::Unavailable)
                };
                if updated.is_err() {
                    let _ = collectors.stop_grant(runtime, &key);
                    if let Ok(mut facts) = self.shared.facts.lock() {
                        facts.invalidate(&StopScope::Grant(key.clone()));
                        facts.active.retain(|active| active != &key);
                    }
                }
            }
            let Ok(probes) = collectors.sample_pending(state, runtime, now, |key| {
                (self.bindings.activity)(state, key, None, now)
            }) else {
                continue;
            };
            if let Ok(mut facts) = self.shared.facts.lock() {
                for probe in probes {
                    match probe.outcome {
                        Ok(SamplingOutcomeV1::Admitted(reference)) => {
                            let class = facts
                                .known_exact
                                .iter()
                                .find(|(key, _)| key == &probe.key)
                                .map(|(_, class)| *class);
                            if let Some(class) = class {
                                facts.remember(reference, SourceMaterialScopeV1::Exact(class));
                            }
                        }
                        Ok(SamplingOutcomeV1::Unchanged) => {}
                        _ => facts.invalidate(&StopScope::Grant(probe.key)),
                    }
                }
            }
        }
        self.sample_profiles(state, now);
        self.sample_machines(state, now);
    }
    fn close(&mut self, runtime: &CompanionAwarenessRuntime) {
        let residents = self
            .shared
            .facts
            .lock()
            .ok()
            .map(|facts| {
                facts
                    .active
                    .iter()
                    .map(|key| key.resident_pubkey.clone())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for resident in residents {
            let _ = self.apply_stop(runtime, &StopScope::Resident(resident));
        }
        self.exact.clear();
        self.profiles.clear();
        let _ = self.stop_machines(runtime, None);
    }
}

fn utc_now() -> Result<CanonicalTimestamp, AwarenessStoreError> {
    CanonicalTimestamp::parse(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .map_err(|_| AwarenessStoreError::Invalid)
}
fn event_loop(
    app: AppHandle,
    engine: &mut SourceEngine,
    commands: mpsc::Receiver<Envelope>,
    events: mpsc::Receiver<()>,
) {
    let mut next_prune = Instant::now() + PAYLOAD_PRUNE_INTERVAL;
    while !engine.shared.closing.load(Ordering::Acquire) {
        let state = app.state::<AppState>();
        if state.shutdown_started.load(Ordering::Acquire) {
            break;
        }
        engine.priority(&state.companion_awareness);
        if utc_now().is_ok() {
            for _ in 0..COMMAND_CAPACITY {
                let Ok(command) = commands.try_recv() else {
                    break;
                };
                if state.shutdown_started.load(Ordering::Acquire) {
                    break;
                }
                engine.priority(&state.companion_awareness);
                if let Ok(now) = utc_now() {
                    engine.command(&state, command, &now);
                }
            }
            engine.priority(&state.companion_awareness);
            if state.shutdown_started.load(Ordering::Acquire) {
                break;
            }
            if engine.delay().is_some_and(|delay| delay == Duration::ZERO) {
                if let Ok(now) = utc_now() {
                    engine.sample(&state, &now);
                }
            }
            if Instant::now() >= next_prune {
                if let Ok(now) = utc_now() {
                    let _ = prune_expired_payloads(&state.companion_awareness, &engine.owner, &now);
                }
                next_prune = Instant::now() + PAYLOAD_PRUNE_INTERVAL;
            }
        } else {
            // Invalid host clocks deny capture and must not become a busy loop.
            next_prune = Instant::now() + PAYLOAD_PRUNE_INTERVAL;
        }
        drop(state);
        let timeout = engine.delay().map_or(
            next_prune.saturating_duration_since(Instant::now()),
            |delay| delay.min(next_prune.saturating_duration_since(Instant::now())),
        );
        let _ = events.recv_timeout(timeout);
    }
    engine.close(&app.state::<AppState>().companion_awareness);
}

#[cfg(all(test, unix))]
#[path = "source_runtime_tests.rs"]
mod tests;
