use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    time::Instant,
};

use luca_protocol::{ConnectedBrainSourceStatusV1, Hex64, OpaqueId, Sha256Ref};
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Manager};

use crate::{
    app_state::AppState,
    luca::owner_brain_store::{self, OwnerBrainStoreError},
};

use super::refresh_queue::{RefreshOutcome, RefreshQueue};

/// Directory names whose churn is tooling noise, never knowledge.
///
/// A connected source's roots are living working trees: version control,
/// package managers, build systems and agent worktrees write into them
/// constantly, and every such write used to enqueue a full re-index of the
/// whole source. On a machine where builds run all day that meant the refresh
/// worker never went quiet — one core pinned and the index rebuilt in a loop.
/// Content under these components cannot change what the index has to say, so
/// events under them are dropped before they reach the refresh queue.
const NOISE_COMPONENTS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".claude-worktrees",
    ".codex-workspaces",
    "BuildCaches",
    "test-results",
    ".DS_Store",
];

/// True when every insight in this path is tooling churn (see
/// [`NOISE_COMPONENTS`]).
fn is_noise_path(path: &Path) -> bool {
    path.components().any(|component| {
        let name = component.as_os_str();
        NOISE_COMPONENTS
            .iter()
            .any(|noise| name == std::ffi::OsStr::new(noise))
    })
}

pub(crate) struct ConnectedBrainWatcherState {
    runtime: Mutex<Option<ConnectedBrainWatcherRuntime>>,
}

impl Default for ConnectedBrainWatcherState {
    fn default() -> Self {
        Self {
            runtime: Mutex::new(None),
        }
    }
}

struct ConnectedBrainWatcherRuntime {
    _watcher: RecommendedWatcher,
    roots: Arc<Mutex<BTreeMap<PathBuf, OpaqueId>>>,
    queue: Arc<Mutex<RefreshQueue<OpaqueId>>>,
}

pub(crate) fn start_connected_source_watcher(app: AppHandle) -> Result<(), String> {
    // Operational escape hatch: manual refresh remains available. Normal
    // background refresh reuses unchanged files from the encrypted index.
    if std::env::var_os("LUCA_DISABLE_BRAIN_WATCHER").is_some() {
        luca_log!(
            info,
            "buzz-desktop: connected Brain watcher disabled by LUCA_DISABLE_BRAIN_WATCHER"
        );
        return Ok(());
    }
    let state = app.state::<AppState>();
    let mut runtime_guard = state
        .connected_brain_watcher
        .runtime
        .lock()
        .map_err(|_| "connected Brain watcher is unavailable".to_owned())?;
    if runtime_guard.is_some() {
        return Ok(());
    }
    let roots = Arc::new(Mutex::new(BTreeMap::<PathBuf, OpaqueId>::new()));
    let queue = Arc::new(Mutex::new(RefreshQueue::default()));
    let callback_roots = Arc::clone(&roots);
    let callback_queue = Arc::clone(&queue);
    // Changes live in the coalesced queue, not in one allocation per event.
    // A single pending wake-up is enough even during large filesystem bursts.
    let (refresh_tx, refresh_rx) = mpsc::sync_channel::<()>(1);
    let watcher = RecommendedWatcher::new(
        move |event: notify::Result<notify::Event>| {
            let Ok(event) = event else {
                return;
            };
            if event.kind.is_access() {
                return;
            }
            let Ok(roots) = callback_roots.lock() else {
                return;
            };
            let source_ids = event
                .paths
                .iter()
                .filter(|path| !is_noise_path(path))
                .flat_map(|path| {
                    roots.iter().filter_map(move |(root, source_id)| {
                        path.starts_with(root).then_some(source_id.clone())
                    })
                })
                .collect::<BTreeSet<_>>();
            if source_ids.is_empty() {
                return;
            }
            if let Ok(mut queue) = callback_queue.lock() {
                let now = Instant::now();
                let mut recorded = false;
                for source_id in source_ids {
                    recorded |= queue.record_change(source_id, now);
                }
                if recorded {
                    let _ = refresh_tx.try_send(());
                }
            }
        },
        Config::default(),
    )
    .map_err(|_| "connected Brain watcher could not start".to_owned())?;
    let worker_app = app.clone();
    let worker_queue = Arc::clone(&queue);
    let worker_roots = Arc::clone(&roots);
    std::thread::Builder::new()
        .name("luca-connected-brain-refresh".to_owned())
        .spawn(move || refresh_worker(worker_app, refresh_rx, worker_queue, worker_roots))
        .map_err(|_| "connected Brain refresh worker could not start".to_owned())?;
    *runtime_guard = Some(ConnectedBrainWatcherRuntime {
        _watcher: watcher,
        roots,
        queue,
    });
    drop(runtime_guard);
    std::thread::Builder::new()
        .name("luca-connected-brain-startup".to_owned())
        .spawn(move || {
            if let Err(error) = reconcile_connected_sources(&app) {
                luca_log!(
                    warn,
                    "buzz-desktop: connected Brain startup reconciliation unavailable: {error}"
                );
            }
        })
        .map_err(|_| "connected Brain startup reconciliation could not start".to_owned())?;
    Ok(())
}

pub(crate) fn register_connected_source(
    state: &AppState,
    source_id: OpaqueId,
    root: &Path,
) -> Result<(), String> {
    let canonical = root
        .canonicalize()
        .map_err(|_| "connected source is unavailable".to_owned())?;
    let mut guard = state
        .connected_brain_watcher
        .runtime
        .lock()
        .map_err(|_| "connected Brain watcher is unavailable".to_owned())?;
    let runtime = guard
        .as_mut()
        .ok_or_else(|| "connected Brain watcher is not ready".to_owned())?;
    let mut roots = runtime
        .roots
        .lock()
        .map_err(|_| "connected Brain watcher roots are unavailable".to_owned())?;
    if let std::collections::btree_map::Entry::Occupied(mut entry) = roots.entry(canonical.clone())
    {
        entry.insert(source_id.clone());
    } else {
        runtime
            ._watcher
            .watch(&canonical, RecursiveMode::Recursive)
            .map_err(|_| "connected source could not be watched".to_owned())?;
        // The encrypted persisted index is already authoritative at startup and
        // after an explicit connection/refresh. Registering its watcher must not
        // immediately rebuild the entire source; real filesystem events below
        // enqueue the next refresh when the source actually changes.
        roots.insert(canonical, source_id.clone());
    }
    // A successful explicit connection/refresh is the recovery seam for a
    // source whose background refresh was blocked by continuity capacity.
    runtime
        .queue
        .lock()
        .map_err(|_| "connected Brain refresh queue is unavailable".to_owned())?
        .reset_failure(&source_id);
    Ok(())
}

pub(crate) fn unregister_connected_source(
    state: &AppState,
    source_id: &OpaqueId,
) -> Result<(), String> {
    let mut guard = state
        .connected_brain_watcher
        .runtime
        .lock()
        .map_err(|_| "connected Brain watcher is unavailable".to_owned())?;
    let runtime = guard
        .as_mut()
        .ok_or_else(|| "connected Brain watcher is not ready".to_owned())?;
    let mut roots = runtime
        .roots
        .lock()
        .map_err(|_| "connected Brain watcher roots are unavailable".to_owned())?;
    let root = roots
        .iter()
        .find_map(|(root, existing)| (existing == source_id).then_some(root.clone()));
    if let Some(root) = root {
        runtime
            ._watcher
            .unwatch(&root)
            .map_err(|_| "connected source watcher could not stop".to_owned())?;
        roots.remove(&root);
    }
    runtime
        .queue
        .lock()
        .map_err(|_| "connected Brain refresh queue is unavailable".to_owned())?
        .forget(source_id);
    Ok(())
}

/// Invalidate a queued worker completion before an explicit owner refresh or
/// rebind begins. The existing backoff/capacity state is retained until that
/// explicit operation succeeds and registers the source again.
pub(crate) fn begin_connected_source_owner_refresh(
    state: &AppState,
    source_id: &OpaqueId,
) -> Result<(), String> {
    let guard = state
        .connected_brain_watcher
        .runtime
        .lock()
        .map_err(|_| "connected Brain watcher is unavailable".to_owned())?;
    let runtime = guard
        .as_ref()
        .ok_or_else(|| "connected Brain watcher is not ready".to_owned())?;
    runtime
        .queue
        .lock()
        .map_err(|_| "connected Brain refresh queue is unavailable".to_owned())?
        .invalidate_attempt(source_id);
    Ok(())
}

/// Project process-local capacity failures into owner-visible inventory when
/// the bounded continuity store could not persist the equivalent status.
pub(crate) fn capacity_blocked_source_ids(state: &AppState) -> BTreeSet<OpaqueId> {
    let Ok(guard) = state.connected_brain_watcher.runtime.lock() else {
        return BTreeSet::new();
    };
    let Some(runtime) = guard.as_ref() else {
        return BTreeSet::new();
    };
    runtime
        .queue
        .lock()
        .map(|queue| queue.capacity_blocked_keys())
        .unwrap_or_default()
}

fn reconcile_connected_sources(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let owner = active_owner(&state)?;
    let startup = state
        .read_connected_brain_startup_sources(&owner)
        .map_err(|error| error.code().to_owned())?;
    let owner_brain_store::ConnectedBrainStartupReadV1 {
        catalog,
        registrations,
    } = startup;
    debug_assert_eq!(
        registrations.len(),
        catalog
            .sources
            .iter()
            .filter(|source| source.source.status != ConnectedBrainSourceStatusV1::Disconnected)
            .count()
    );
    for registration in registrations {
        match registration.candidate {
            Ok(candidate) => {
                if register_connected_source(
                    &state,
                    registration.source_id,
                    &candidate.canonical_root,
                )
                .is_err()
                {
                    luca_log!(info,
                        "buzz-desktop: Brain source remains readable but background watch is unavailable"
                    );
                }
            }
            Err(_) => {
                let _ = state.set_connected_brain_status(
                    &owner,
                    &registration.source_id,
                    ConnectedBrainSourceStatusV1::NeedsAttention,
                );
            }
        }
    }
    Ok(())
}

fn refresh_worker(
    app: AppHandle,
    receiver: mpsc::Receiver<()>,
    queue: Arc<Mutex<RefreshQueue<OpaqueId>>>,
    roots: Arc<Mutex<BTreeMap<PathBuf, OpaqueId>>>,
) {
    loop {
        let pending = match queue.lock() {
            Ok(mut queue) => queue.take_ready(Instant::now()),
            Err(_) => return,
        };
        for attempt in pending {
            let source_id = attempt.key.clone();
            let result = refresh_one_source(&app, &source_id);
            // A disconnect may finish while indexing. Do not recreate retry
            // state for a source the owner has removed. Lock order matches the
            // filesystem callback and unregister path (roots, then queue).
            let registered = match roots.lock() {
                Ok(roots) => roots.values().any(|existing| existing == &source_id),
                Err(_) => return,
            };
            if registered {
                complete_refresh_attempt(&queue, attempt, result.outcome, || {
                    report_refresh_failure(&app.state::<AppState>(), &source_id, result.failure);
                });
            }
        }
        let deadline = match queue.lock() {
            Ok(queue) => queue.next_deadline(),
            Err(_) => return,
        };
        match deadline {
            Some(deadline) => {
                match receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                    Ok(()) | Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            None => {
                if receiver.recv().is_err() {
                    return;
                }
            }
        }
    }
}

/// Accept one worker result and apply its status effect in the same queue
/// critical section. Owner refresh/rebind begins by taking this queue lock and
/// invalidating the attempt, so the only possible orders are:
///
/// 1. owner invalidation first, making this result stale; or
/// 2. worker status effect first, followed by the owner's authoritative write.
///
/// No lifecycle operation retains its lifecycle lock while taking this queue
/// lock: explicit connect/rebind/disconnect finish persistence before watcher
/// registration or removal. Keeping this order avoids the replay race where a
/// late background failure could overwrite a successful no-op owner refresh.
fn complete_refresh_attempt<K, F>(
    queue: &Arc<Mutex<RefreshQueue<K>>>,
    attempt: super::refresh_queue::RefreshAttempt<K>,
    outcome: RefreshOutcome,
    report: F,
) -> bool
where
    K: Ord + Clone,
    F: FnOnce(),
{
    let Ok(mut queue) = queue.lock() else {
        return false;
    };
    if !queue.record_result(attempt, Instant::now(), outcome) {
        return false;
    }
    report();
    true
}

struct RefreshFailure {
    owner: Option<Hex64>,
    expected_generation: Option<Sha256Ref>,
    stage: &'static str,
    reason: &'static str,
    outcome: RefreshOutcome,
}

struct RefreshResult {
    outcome: RefreshOutcome,
    failure: Option<RefreshFailure>,
}

impl RefreshResult {
    fn succeeded() -> Self {
        Self {
            outcome: RefreshOutcome::Succeeded,
            failure: None,
        }
    }

    fn failed(
        owner: Option<Hex64>,
        expected_generation: Option<Sha256Ref>,
        stage: &'static str,
        reason: &'static str,
        outcome: RefreshOutcome,
    ) -> Self {
        Self {
            outcome,
            failure: Some(RefreshFailure {
                owner,
                expected_generation,
                stage,
                reason,
                outcome,
            }),
        }
    }
}

fn refresh_one_source(app: &AppHandle, source_id: &OpaqueId) -> RefreshResult {
    let state = app.state::<AppState>();
    let owner = match active_owner(&state) {
        Ok(owner) => owner,
        Err(_) => {
            return RefreshResult::failed(
                None,
                None,
                "owner",
                "owner-unavailable",
                RefreshOutcome::RetryableFailure,
            );
        }
    };
    let expected_generation = match state.connected_brain_source_generation(&owner, source_id) {
        Ok(generation) => generation,
        Err(error) => {
            return RefreshResult::failed(
                Some(owner),
                None,
                "generation",
                error.code(),
                refresh_outcome_for_store_error(error),
            );
        }
    };
    let candidate = match state.read_connected_brain_candidate(&owner, source_id) {
        Ok(candidate) => candidate,
        Err(error) => {
            return refresh_store_failure(owner, expected_generation, "source", error);
        }
    };
    let build = match state.build_connected_brain_index(&owner, source_id, &candidate) {
        Ok(build) => build,
        Err(_) => {
            return RefreshResult::failed(
                Some(owner),
                Some(expected_generation),
                "index",
                "index-refresh-failed",
                RefreshOutcome::RetryableFailure,
            );
        }
    };
    let authorities = match resident_authorities(app, &state) {
        Ok(authorities) => authorities,
        Err(_) => {
            return RefreshResult::failed(
                Some(owner),
                Some(expected_generation),
                "authority",
                "authority-unavailable",
                RefreshOutcome::RetryableFailure,
            );
        }
    };
    if let Err(error) = state.connect_brain_source(owner.clone(), candidate, build, &authorities) {
        return refresh_store_failure(owner, expected_generation, "persist", error);
    }
    RefreshResult::succeeded()
}

fn refresh_store_failure(
    owner: Hex64,
    expected_generation: Sha256Ref,
    stage: &'static str,
    error: OwnerBrainStoreError,
) -> RefreshResult {
    let outcome = refresh_outcome_for_store_error(error);
    RefreshResult::failed(
        Some(owner),
        Some(expected_generation),
        stage,
        error.code(),
        outcome,
    )
}

fn refresh_outcome_for_store_error(error: OwnerBrainStoreError) -> RefreshOutcome {
    if error == OwnerBrainStoreError::Capacity {
        RefreshOutcome::CapacityBlocked
    } else {
        RefreshOutcome::RetryableFailure
    }
}

fn report_refresh_failure(state: &AppState, source_id: &OpaqueId, failure: Option<RefreshFailure>) {
    let Some(failure) = failure else {
        return;
    };
    // Codes and stages are body-free. Never log source paths, file content, or
    // arbitrary adapter/provider errors.
    let attention_updated = failure
        .owner
        .as_ref()
        .zip(failure.expected_generation.as_ref())
        .is_some_and(|(owner, expected_generation)| {
            state
                .mark_connected_brain_needs_attention_if_generation(
                    owner,
                    source_id,
                    expected_generation,
                )
                .unwrap_or(false)
        });
    let recovery = if failure.outcome == RefreshOutcome::CapacityBlocked {
        "automatic refresh paused until an explicit owner retry"
    } else {
        "keeping the last verified index and backing off"
    };
    let status = if attention_updated {
        "source marked needs-attention"
    } else {
        "needs-attention update unavailable"
    };
    let stage = failure.stage;
    let reason = failure.reason;
    luca_log!(
        warn,
        "buzz-desktop: background Brain refresh failed at {stage} ({reason}); {recovery}; {status}"
    );
}

fn resident_authorities(
    app: &AppHandle,
    state: &AppState,
) -> Result<Vec<owner_brain_store::ConnectedBrainResidentAuthorityV1>, String> {
    Ok(
        crate::luca::resident_registry::load_resident_registry(app, state)?
            .residents
            .into_iter()
            .filter_map(|resident| {
                crate::managed_agents::current_owner_brain_runtime_authority(
                    app,
                    &resident.resident_pubkey,
                )
                .ok()
                .map(|(binding_ref, provider_egress)| {
                    owner_brain_store::ConnectedBrainResidentAuthorityV1 {
                        resident_pubkey: resident.resident_pubkey,
                        binding_ref,
                        provider_egress,
                    }
                })
            })
            .collect(),
    )
}

fn active_owner(state: &AppState) -> Result<Hex64, String> {
    Hex64::parse(state.signing_keys()?.public_key().to_hex())
        .map_err(|_| "active owner identity is invalid".to_owned())
}

#[cfg(test)]
mod noise_tests {
    use super::*;
    use std::sync::TryLockError;

    #[test]
    fn tooling_churn_is_noise() {
        assert!(is_noise_path(Path::new("/repos/luca/.git/objects/ab/cdef")));
        assert!(is_noise_path(Path::new(
            "/repos/luca/desktop/node_modules/react/index.js"
        )));
        assert!(is_noise_path(Path::new("/repos/luca/desktop/dist/app.js")));
        assert!(is_noise_path(Path::new(
            "/repos/.claude-worktrees/feel/src/a.ts"
        )));
    }

    #[test]
    fn real_work_is_not_noise() {
        assert!(!is_noise_path(Path::new("/repos/luca/desktop/src/App.tsx")));
        assert!(!is_noise_path(Path::new("/repos/luca/README.md")));
        // A component must MATCH a noise name, not merely contain one.
        assert!(!is_noise_path(Path::new(
            "/repos/luca/distribution/notes.md"
        )));
        assert!(!is_noise_path(Path::new("/repos/luca/rebuild/plan.md")));
    }

    #[test]
    fn continuity_capacity_pauses_automatic_rebuilds() {
        assert_eq!(
            refresh_outcome_for_store_error(OwnerBrainStoreError::Capacity),
            RefreshOutcome::CapacityBlocked
        );
        assert_eq!(
            refresh_outcome_for_store_error(OwnerBrainStoreError::Unavailable),
            RefreshOutcome::RetryableFailure
        );
    }

    #[test]
    fn accepted_worker_report_is_linearized_before_owner_recovery() {
        let now = Instant::now();
        let queue = Arc::new(Mutex::new(RefreshQueue::default()));
        let attempt = {
            let mut guard = queue.lock().unwrap();
            guard.record_change("source", now);
            let ready_at = guard.next_deadline().unwrap();
            guard.take_ready(ready_at).pop().unwrap()
        };
        let observed = Arc::clone(&queue);

        assert!(complete_refresh_attempt(
            &queue,
            attempt,
            RefreshOutcome::CapacityBlocked,
            || {
                assert!(matches!(observed.try_lock(), Err(TryLockError::WouldBlock)));
            },
        ));

        // The owner's later reset is authoritative because it cannot interleave
        // between result acceptance and the status report above.
        queue.lock().unwrap().reset_failure(&"source");
        assert!(!queue.lock().unwrap().is_capacity_blocked(&"source"));
    }
}
