use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};

use luca_protocol::{ConnectedBrainSourceStatusV1, Hex64, OpaqueId};
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Manager};

use crate::{app_state::AppState, luca::owner_brain_store};

const REFRESH_DEBOUNCE: Duration = Duration::from_millis(750);

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
}

pub(crate) fn start_connected_source_watcher(app: AppHandle) -> Result<(), String> {
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
    let callback_roots = Arc::clone(&roots);
    let (refresh_tx, refresh_rx) = mpsc::channel::<OpaqueId>();
    let callback_tx = refresh_tx.clone();
    let watcher = RecommendedWatcher::new(
        move |event: notify::Result<notify::Event>| {
            let Ok(event) = event else {
                return;
            };
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
            for source_id in source_ids {
                let _ = callback_tx.send(source_id);
            }
        },
        Config::default(),
    )
    .map_err(|_| "connected Brain watcher could not start".to_owned())?;
    let worker_app = app.clone();
    std::thread::Builder::new()
        .name("luca-connected-brain-refresh".to_owned())
        .spawn(move || refresh_worker(worker_app, refresh_rx))
        .map_err(|_| "connected Brain refresh worker could not start".to_owned())?;
    *runtime_guard = Some(ConnectedBrainWatcherRuntime {
        _watcher: watcher,
        roots,
    });
    drop(runtime_guard);
    std::thread::Builder::new()
        .name("luca-connected-brain-startup".to_owned())
        .spawn(move || {
            if let Err(error) = reconcile_connected_sources(&app) {
                eprintln!(
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
    Ok(())
}

fn reconcile_connected_sources(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let owner = active_owner(&state)?;
    let catalog = state
        .read_connected_brain_catalog(&owner)
        .map_err(|error| error.code().to_owned())?;
    for source in catalog
        .sources
        .into_iter()
        .filter(|source| source.source.status != ConnectedBrainSourceStatusV1::Disconnected)
    {
        match state.read_connected_brain_candidate(&owner, &source.source.source_id) {
            Ok(candidate) => {
                if register_connected_source(
                    &state,
                    source.source.source_id.clone(),
                    &candidate.canonical_root,
                )
                .is_err()
                {
                    let _ = state.set_connected_brain_status(
                        &owner,
                        &source.source.source_id,
                        ConnectedBrainSourceStatusV1::NeedsAttention,
                    );
                }
            }
            Err(_) => {
                let _ = state.set_connected_brain_status(
                    &owner,
                    &source.source.source_id,
                    ConnectedBrainSourceStatusV1::NeedsAttention,
                );
            }
        }
    }
    Ok(())
}

fn refresh_worker(app: AppHandle, receiver: mpsc::Receiver<OpaqueId>) {
    while let Ok(first) = receiver.recv() {
        let mut pending = BTreeSet::from([first]);
        while let Ok(next) = receiver.recv_timeout(REFRESH_DEBOUNCE) {
            pending.insert(next);
        }
        for source_id in pending {
            refresh_one_source(&app, &source_id);
        }
    }
}

fn refresh_one_source(app: &AppHandle, source_id: &OpaqueId) {
    let state = app.state::<AppState>();
    let result = (|| {
        let owner = active_owner(&state)?;
        let candidate = state
            .read_connected_brain_candidate(&owner, source_id)
            .map_err(|error| error.code().to_owned())?;
        let build = super::build_index(source_id, &candidate)?;
        let authorities = resident_authorities(app, &state)?;
        state
            .connect_brain_source(owner.clone(), candidate, build, &authorities)
            .map_err(|error| error.code().to_owned())?;
        state
            .set_connected_brain_status(&owner, source_id, ConnectedBrainSourceStatusV1::Current)
            .map_err(|error| error.code().to_owned())
    })();
    if result.is_err() {
        if let Ok(owner) = active_owner(&state) {
            let _ = state.set_connected_brain_status(
                &owner,
                source_id,
                ConnectedBrainSourceStatusV1::NeedsAttention,
            );
        }
    }
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
