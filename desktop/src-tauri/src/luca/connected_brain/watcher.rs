use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    time::Instant,
};

use luca_protocol::{ConnectedBrainSourceStatusV1, Hex64, OpaqueId};
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Manager};

use crate::{app_state::AppState, luca::owner_brain_store};

use super::refresh_queue::RefreshQueue;

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
                for source_id in source_ids {
                    queue.record_change(source_id, now);
                }
                let _ = refresh_tx.try_send(());
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
        return Ok(());
    }
    runtime
        ._watcher
        .watch(&canonical, RecursiveMode::Recursive)
        .map_err(|_| "connected source could not be watched".to_owned())?;
    // The encrypted persisted index is already authoritative at startup and
    // after an explicit connection/refresh. Registering its watcher must not
    // immediately rebuild the entire source; real filesystem events below
    // enqueue the next refresh when the source actually changes.
    roots.insert(canonical, source_id);
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
        for source_id in pending {
            let succeeded = refresh_one_source(&app, &source_id);
            // A disconnect may finish while indexing. Do not recreate retry
            // state for a source the owner has removed. Lock order matches the
            // filesystem callback and unregister path (roots, then queue).
            let Ok(roots) = roots.lock() else {
                return;
            };
            if roots.values().any(|existing| existing == &source_id) {
                let Ok(mut queue) = queue.lock() else {
                    return;
                };
                queue.record_result(source_id, Instant::now(), succeeded);
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

fn refresh_one_source(app: &AppHandle, source_id: &OpaqueId) -> bool {
    let state = app.state::<AppState>();
    // Report only the stage: source paths, file content and arbitrary provider
    // errors must never leak into the operational log.
    let mut stage = "owner";
    let result = (|| {
        let owner = active_owner(&state)?;
        stage = "source";
        let candidate = state
            .read_connected_brain_candidate(&owner, source_id)
            .map_err(|error| error.code().to_owned())?;
        stage = "index";
        let build = state.build_connected_brain_index(&owner, source_id, &candidate)?;
        stage = "authority";
        let authorities = resident_authorities(app, &state)?;
        stage = "persist";
        state
            .connect_brain_source(owner.clone(), candidate, build, &authorities)
            .map_err(|error| error.code().to_owned())?;
        stage = "status";
        state
            .set_connected_brain_status(&owner, source_id, ConnectedBrainSourceStatusV1::Current)
            .map_err(|error| error.code().to_owned())
    })();
    if result.is_err() {
        luca_log!(
            warn,
            "buzz-desktop: background Brain refresh failed at {stage}; keeping the last verified index and backing off"
        );
    }
    result.is_ok()
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
}
