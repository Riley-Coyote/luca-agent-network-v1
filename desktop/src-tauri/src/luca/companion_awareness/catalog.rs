//! Private selections and owned, event-only collection for exact saved handles.
//!
//! This is not native-profile following: no home discovery, directory traversal,
//! history scan, Brain registration or future-session selection occurs. Following
//! a profile requires a separately declared observation class and permission.
//! Locators are sensitive, private local configuration (0700/0600), not encrypted
//! memory. Neither a saved selection nor a watcher supplies consent. Initialization
//! restores configuration only; every collector starts stopped and health Unknown.

use super::{
    native_work::{
        NativeObservationClassV1, NativeWorkActivityFactV1, NativeWorkAdapter, NativeWorkHandleV1,
    },
    selected_files::{
        new_id, validate_locator, SamplingOutcomeV1, SelectedFileHandleV1, SelectedFilesAdapter,
    },
    AwarenessGrantKeyV1, AwarenessSourceKeyV1, AwarenessStoreError, CompanionAwarenessRuntime,
    LiveAwarenessOwner,
};
use crate::app_state::AppState;
use luca_protocol::{
    AwarenessSourceStateV1, CanonicalTimestamp, ConnectedBrainSourceKindV1, Hex64, OpaqueId,
    SafeU53,
};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fmt, fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{mpsc::SyncSender, Arc, Mutex},
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

/// Fixed filename inside the existing private awareness directory only.
pub(crate) const SELECTED_SOURCE_CATALOG_FILENAME: &str = "selected-sources-v1.json";
const CATALOG_PROTOCOL: &str = "polyphonic.awareness-selected-sources.v1";
const MAX_SELECTIONS: usize = 64;
const MAX_CATALOG_BYTES: usize = 1024 * 1024;
const CHANGE_DEBOUNCE: Duration = Duration::from_millis(750);
/// Parent privacy housekeeping must run independently of capture, keys and models.
pub(crate) const PAYLOAD_PRUNE_INTERVAL: Duration = Duration::from_secs(30);

/// Immutable exact observation class. Excerpts are never a metadata toggle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SelectedSourceClassV1 {
    SelectedFile,
    CodexSessionMetadata,
    CodexSessionVisibleExcerpts,
    ClaudeSessionMetadata,
    ClaudeSessionVisibleExcerpts,
}
impl SelectedSourceClassV1 {
    fn native(self) -> Option<(ConnectedBrainSourceKindV1, NativeObservationClassV1)> {
        Some(match self {
            Self::SelectedFile => return None,
            Self::CodexSessionMetadata => (
                ConnectedBrainSourceKindV1::CodexHistory,
                NativeObservationClassV1::Metadata,
            ),
            Self::CodexSessionVisibleExcerpts => (
                ConnectedBrainSourceKindV1::CodexHistory,
                NativeObservationClassV1::VisibleExcerpts,
            ),
            Self::ClaudeSessionMetadata => (
                ConnectedBrainSourceKindV1::ClaudeHistory,
                NativeObservationClassV1::Metadata,
            ),
            Self::ClaudeSessionVisibleExcerpts => (
                ConnectedBrainSourceKindV1::ClaudeHistory,
                NativeObservationClassV1::VisibleExcerpts,
            ),
        })
    }
    /// Pure ID derivation shared with the existing exact handle constructors.
    pub(crate) fn source_id(
        self,
        root: &Path,
        relative: &str,
    ) -> Result<OpaqueId, AwarenessStoreError> {
        match self.native() {
            None => SelectedFileHandleV1::source_id_for_selection(root, relative),
            Some((kind, class)) => {
                NativeWorkHandleV1::source_id_for_selection(root, relative, kind, class)
            }
        }
    }
}

/// Host-resolved selection. Never serialize this type to a renderer or prompt.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct SelectedSourceSelectionV1 {
    key: AwarenessGrantKeyV1,
    class: SelectedSourceClassV1,
    root: PathBuf,
    relative: String,
}
impl fmt::Debug for SelectedSourceSelectionV1 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SelectedSourceSelectionV1")
            .field("key", &self.key)
            .field("class", &self.class)
            .field("locator", &"[REDACTED]")
            .finish()
    }
}
impl SelectedSourceSelectionV1 {
    /// Pure construction; class/root/path must reproduce this exact source ID.
    pub(crate) fn new(
        key: AwarenessGrantKeyV1,
        class: SelectedSourceClassV1,
        root: PathBuf,
        relative: String,
    ) -> Result<Self, AwarenessStoreError> {
        if root.as_os_str().as_encoded_bytes().len() > 4096 {
            return Err(AwarenessStoreError::Invalid);
        }
        validate_locator(&root, &relative)?;
        let selection = Self {
            key,
            class,
            root,
            relative,
        };
        // Reuse pure constructors, including native session and file exclusions.
        selection.adapter(HashSet::new())?;
        Ok(selection)
    }
    /// Body-free exact grant identity, not an access capability.
    pub(crate) fn key(&self) -> &AwarenessGrantKeyV1 {
        &self.key
    }
    /// Body-free class for access disclosure; never contains a native locator.
    pub(crate) fn class(&self) -> SelectedSourceClassV1 {
        self.class
    }
    /// Private metadata-only helper; never expose these locators through IPC.
    pub(super) fn metadata_locator(&self) -> (&Path, &str) {
        (&self.root, &self.relative)
    }
    fn adapter(&self, excluded: HashSet<String>) -> Result<SelectedAdapter, AwarenessStoreError> {
        Ok(match self.class.native() {
            None => SelectedAdapter::File(SelectedFilesAdapter::new(SelectedFileHandleV1::new(
                self.key.clone(),
                self.root.clone(),
                self.relative.clone(),
            )?)),
            Some((kind, class)) => {
                SelectedAdapter::Native(NativeWorkAdapter::new(NativeWorkHandleV1::new(
                    self.key.clone(),
                    self.root.clone(),
                    self.relative.clone(),
                    kind,
                    class,
                    excluded,
                )?))
            }
        })
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedSelection {
    resident: Hex64,
    source: OpaqueId,
    class: SelectedSourceClassV1,
    root: PathBuf,
    relative: String,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    protocol: String,
    owner: Hex64,
    device: OpaqueId,
    revision: SafeU53,
    selections: Vec<SavedSelection>,
}
impl Manifest {
    fn selection(
        &self,
        saved: &SavedSelection,
    ) -> Result<SelectedSourceSelectionV1, AwarenessStoreError> {
        SelectedSourceSelectionV1::new(
            AwarenessGrantKeyV1 {
                source: AwarenessSourceKeyV1 {
                    owner_pubkey: self.owner.clone(),
                    source_id: saved.source.clone(),
                    device_id: self.device.clone(),
                },
                resident_pubkey: saved.resident.clone(),
            },
            saved.class,
            saved.root.clone(),
            saved.relative.clone(),
        )
    }
    fn validate(&self, owner: &Hex64, device: &OpaqueId) -> Result<(), AwarenessStoreError> {
        if self.protocol != CATALOG_PROTOCOL
            || &self.owner != owner
            || &self.device != device
            || self.revision.get() == 0
            || self.selections.len() > MAX_SELECTIONS
        {
            return Err(AwarenessStoreError::Invalid);
        }
        let mut seen = HashSet::new();
        for saved in &self.selections {
            self.selection(saved)?;
            if !seen.insert((saved.resident.clone(), saved.source.clone())) {
                return Err(AwarenessStoreError::Invalid);
            }
        }
        Ok(())
    }
}

/// AppState owns one serialized catalog instance. No watcher is created by open.
/// Saved configuration is body-free but includes sensitive paths; Unix DAC, not
/// encryption, protects it. It is never a grant or native-account configuration.
pub(crate) struct SelectedSourceCatalogV1 {
    path: PathBuf,
    owner: Hex64,
    device: OpaqueId,
    saved: Option<Manifest>,
}
impl fmt::Debug for SelectedSourceCatalogV1 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SelectedSourceCatalogV1")
            .field("owner", &self.owner)
            .field(
                "selections",
                &self
                    .saved
                    .as_ref()
                    .map_or(0, |value| value.selections.len()),
            )
            .field("locators", &"[REDACTED]")
            .finish()
    }
}
impl SelectedSourceCatalogV1 {
    /// Read only this fixed private configuration; absence stays empty/default-off.
    /// Unknown/malformed/foreign files are rejected without chmod or replacement.
    pub(crate) fn open(
        directory: &Path,
        owner: &Hex64,
        device: &OpaqueId,
    ) -> Result<Self, AwarenessStoreError> {
        let path = directory.join(SELECTED_SOURCE_CATALOG_FILENAME);
        let saved = read_manifest(&path, owner, device)?;
        Ok(Self {
            path,
            owner: owner.clone(),
            device: device.clone(),
            saved,
        })
    }
    /// Known exact selections for one resident only. Returned handles remain off;
    /// their descriptive startup health is Unknown until a real granted probe.
    pub(crate) fn selections(
        &self,
        resident: &Hex64,
    ) -> Result<Vec<SelectedSourceSelectionV1>, AwarenessStoreError> {
        self.ensure_current()?;
        let Some(manifest) = &self.saved else {
            return Ok(Vec::new());
        };
        manifest
            .selections
            .iter()
            .filter(|saved| &saved.resident == resident)
            .map(|saved| manifest.selection(saved))
            .collect()
    }
    /// Startup health is not inherited from a previous process's successful
    /// read. Reset only saved exact handles for this companion, without capture
    /// or activation. Disabled sources stay denied. If no Live proof is available,
    /// parent must display restored health Unknown and must not claim freshness.
    pub(crate) fn reset_restored_health(
        &self,
        live: &LiveAwarenessOwner<'_>,
        runtime: &CompanionAwarenessRuntime,
        resident: &Hex64,
    ) -> Result<(), AwarenessStoreError> {
        if live.owner() != &self.owner {
            return Err(AwarenessStoreError::Invalid);
        }
        for selection in self.selections(resident)? {
            let current = match runtime.snapshot(&self.owner, &selection.key) {
                Ok(current) => current,
                Err(AwarenessStoreError::Missing) => continue,
                Err(error) => return Err(error),
            };
            if !matches!(
                current.source.state,
                AwarenessSourceStateV1::Unknown | AwarenessSourceStateV1::Disabled
            ) {
                runtime.set_source_health(
                    live,
                    &selection.key.source,
                    current.source_revision,
                    AwarenessSourceStateV1::Unknown,
                    &new_id("source-restore-unknown")?,
                )?;
            }
        }
        Ok(())
    }
    /// Save an explicit host selection under current native owner proof. This
    /// does not register, grant, resume, read or start observing the source.
    pub(crate) fn select(
        &mut self,
        live: &LiveAwarenessOwner<'_>,
        selection: SelectedSourceSelectionV1,
    ) -> Result<(), AwarenessStoreError> {
        if live.owner() != &self.owner
            || selection.key.source.owner_pubkey != self.owner
            || selection.key.source.device_id != self.device
        {
            return Err(AwarenessStoreError::Invalid);
        }
        live.with_current(|| self.select_current(selection))
    }
    fn select_current(
        &mut self,
        selection: SelectedSourceSelectionV1,
    ) -> Result<(), AwarenessStoreError> {
        let existing = self
            .selections(&selection.key.resident_pubkey)?
            .into_iter()
            .find(|saved| saved.key == selection.key);
        if let Some(existing) = existing {
            return if existing == selection {
                Ok(())
            } else {
                Err(AwarenessStoreError::Conflict)
            };
        }
        let mut next = self.next_manifest()?;
        if next.selections.len() >= MAX_SELECTIONS {
            return Err(AwarenessStoreError::Capacity);
        }
        next.selections.push(SavedSelection {
            resident: selection.key.resident_pubkey,
            source: selection.key.source.source_id,
            class: selection.class,
            root: selection.root,
            relative: selection.relative,
        });
        self.persist(next)
    }
    /// Keyless configuration removal narrows only this exact selected handle.
    /// Parent must commit grant/source withdrawal first, then stop collection and
    /// quarantine dependents; forgetting a locator alone is not that barrier.
    pub(crate) fn remove(
        &mut self,
        retained_owner: &Hex64,
        key: &AwarenessGrantKeyV1,
    ) -> Result<(), AwarenessStoreError> {
        if retained_owner != &self.owner
            || key.source.owner_pubkey != self.owner
            || key.source.device_id != self.device
        {
            return Err(AwarenessStoreError::Invalid);
        }
        if !self
            .selections(&key.resident_pubkey)?
            .iter()
            .any(|selection| &selection.key == key)
        {
            return Ok(());
        }
        let mut next = self.next_manifest()?;
        next.selections.retain(|saved| {
            saved.resident != key.resident_pubkey || saved.source != key.source.source_id
        });
        self.persist(next)
    }
    fn next_manifest(&self) -> Result<Manifest, AwarenessStoreError> {
        let mut next = self.saved.clone().unwrap_or(Manifest {
            protocol: CATALOG_PROTOCOL.into(),
            owner: self.owner.clone(),
            device: self.device.clone(),
            revision: SafeU53::new(0).map_err(|_| AwarenessStoreError::Invalid)?,
            selections: Vec::new(),
        });
        next.revision = SafeU53::new(
            next.revision
                .get()
                .checked_add(1)
                .ok_or(AwarenessStoreError::Capacity)?,
        )
        .map_err(|_| AwarenessStoreError::Capacity)?;
        Ok(next)
    }
    fn persist(&mut self, next: Manifest) -> Result<(), AwarenessStoreError> {
        next.validate(&self.owner, &self.device)?;
        // The parent serializes this instance. Also reject a detached stale
        // writer; this is not advertised as a cross-process transactional DB.
        self.ensure_current()?;
        let directory = self.path.parent().ok_or(AwarenessStoreError::UnsafePath)?;
        let mut bytes = Zeroizing::new(Vec::new());
        struct Bounded<'a>(&'a mut Vec<u8>);
        impl Write for Bounded<'_> {
            fn write(&mut self, value: &[u8]) -> std::io::Result<usize> {
                if value.len() > MAX_CATALOG_BYTES.saturating_sub(self.0.len()) {
                    return Err(std::io::Error::other("catalog bound"));
                }
                self.0.extend_from_slice(value);
                Ok(value.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        serde_json::to_writer(Bounded(&mut bytes), &next)
            .map_err(|_| AwarenessStoreError::Capacity)?;
        let mut temporary = tempfile::NamedTempFile::new_in(directory)
            .map_err(|_| AwarenessStoreError::Unavailable)?;
        validate_file(temporary.path(), directory)?;
        temporary
            .write_all(&bytes)
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|_| AwarenessStoreError::Unavailable)?;
        if self.saved.is_some() {
            temporary
                .persist(&self.path)
                .map_err(|_| AwarenessStoreError::Unavailable)?;
        } else {
            temporary
                .persist_noclobber(&self.path)
                .map_err(|_| AwarenessStoreError::Conflict)?;
        }
        fs::File::open(directory)
            .and_then(|file| file.sync_all())
            .map_err(|_| AwarenessStoreError::Unavailable)?;
        self.saved = Some(next);
        Ok(())
    }
    fn ensure_current(&self) -> Result<(), AwarenessStoreError> {
        if read_manifest(&self.path, &self.owner, &self.device)? != self.saved {
            return Err(AwarenessStoreError::Conflict);
        }
        Ok(())
    }
}

fn validate_catalog_path(path: &Path) -> Result<(), AwarenessStoreError> {
    // Other platforms need a real equivalent private-file ACL implementation;
    // do not advertise 0700/0600 protection where it has not been established.
    #[cfg(not(unix))]
    return Err(AwarenessStoreError::Unavailable);
    if !path.is_absolute()
        || path.starts_with("/Volumes")
        || path.file_name().and_then(|part| part.to_str()) != Some(SELECTED_SOURCE_CATALOG_FILENAME)
        || path
            .components()
            .any(|part| matches!(part, Component::CurDir | Component::ParentDir))
    {
        return Err(AwarenessStoreError::UnsafePath);
    }
    let parent = path.parent().ok_or(AwarenessStoreError::UnsafePath)?;
    let metadata = fs::symlink_metadata(parent).map_err(|_| AwarenessStoreError::UnsafePath)?;
    if !metadata.is_dir()
        || fs::canonicalize(parent).map_err(|_| AwarenessStoreError::UnsafePath)? != parent
    {
        return Err(AwarenessStoreError::UnsafePath);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o777 != 0o700 {
            return Err(AwarenessStoreError::UnsafePath);
        }
    }
    match fs::symlink_metadata(path) {
        Ok(_) => validate_file(path, parent),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(AwarenessStoreError::UnsafePath),
    }
}
fn validate_file(path: &Path, parent: &Path) -> Result<(), AwarenessStoreError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| AwarenessStoreError::UnsafePath)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(AwarenessStoreError::UnsafePath);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let parent = fs::symlink_metadata(parent).map_err(|_| AwarenessStoreError::UnsafePath)?;
        if metadata.nlink() != 1
            || metadata.uid() != parent.uid()
            || metadata.permissions().mode() & 0o777 != 0o600
        {
            return Err(AwarenessStoreError::UnsafePath);
        }
    }
    Ok(())
}
fn read_manifest(
    path: &Path,
    owner: &Hex64,
    device: &OpaqueId,
) -> Result<Option<Manifest>, AwarenessStoreError> {
    validate_catalog_path(path)?;
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = match options.open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(AwarenessStoreError::Unavailable),
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let metadata = file
            .metadata()
            .map_err(|_| AwarenessStoreError::UnsafePath)?;
        let path_metadata =
            fs::symlink_metadata(path).map_err(|_| AwarenessStoreError::UnsafePath)?;
        if !metadata.is_file()
            || metadata.nlink() != 1
            || metadata.uid() != path_metadata.uid()
            || metadata.permissions().mode() & 0o777 != 0o600
            || metadata.dev() != path_metadata.dev()
            || metadata.ino() != path_metadata.ino()
        {
            return Err(AwarenessStoreError::UnsafePath);
        }
    }
    let mut bytes = Zeroizing::new(Vec::new());
    file.take((MAX_CATALOG_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| AwarenessStoreError::Unavailable)?;
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err(AwarenessStoreError::Capacity);
    }
    let manifest: Manifest =
        serde_json::from_slice(&bytes).map_err(|_| AwarenessStoreError::Invalid)?;
    manifest.validate(owner, device)?;
    Ok(Some(manifest))
}

enum SelectedAdapter {
    File(SelectedFilesAdapter),
    Native(NativeWorkAdapter),
}
impl SelectedAdapter {
    fn set_native_exclusions(
        &mut self,
        excluded: HashSet<String>,
    ) -> Result<(), AwarenessStoreError> {
        match self {
            Self::Native(adapter) => adapter.set_exclusions(excluded),
            Self::File(_) => Err(AwarenessStoreError::Invalid),
        }
    }
    fn set_enabled(&mut self, enabled: bool) {
        match self {
            Self::File(adapter) => adapter.set_enabled(enabled),
            Self::Native(adapter) => adapter.set_enabled(enabled),
        }
    }
    fn mark_changed(&mut self) {
        match self {
            Self::File(adapter) => adapter.mark_changed(),
            Self::Native(adapter) => adapter.mark_changed(),
        }
    }
    fn sample(
        &mut self,
        state: &AppState,
        runtime: &CompanionAwarenessRuntime,
        now: &CanonicalTimestamp,
        sequence: SafeU53,
        activity: Option<&NativeWorkActivityFactV1>,
    ) -> Result<SamplingOutcomeV1, AwarenessStoreError> {
        match self {
            Self::File(adapter) => adapter.sample(state, runtime, now, sequence),
            Self::Native(adapter) => adapter.sample(state, runtime, now, sequence, activity),
        }
    }
}
#[derive(Default)]
struct PendingChange {
    changed_at: Option<Instant>,
    watcher_failed: bool,
}
impl PendingChange {
    fn mark(&mut self, now: Instant) {
        self.changed_at = Some(now);
    }
    fn delay(&self, now: Instant) -> Option<Duration> {
        self.changed_at
            .map(|at| CHANGE_DEBOUNCE.saturating_sub(now.saturating_duration_since(at)))
    }
    fn take_ready(&mut self, now: Instant) -> Option<bool> {
        if self.delay(now)? != Duration::ZERO {
            return None;
        }
        self.changed_at = None;
        Some(self.watcher_failed)
    }
}
struct OwnedCollector {
    key: AwarenessGrantKeyV1,
    adapter: SelectedAdapter,
    _watcher: RecommendedWatcher,
    pending: Arc<Mutex<PendingChange>>,
}
/// Body-free outcome; failures never include source paths, bodies or notify errors.
#[derive(Debug)]
pub(crate) struct SelectedSourceProbeV1 {
    pub(crate) key: AwarenessGrantKeyV1,
    pub(crate) outcome: Result<SamplingOutcomeV1, AwarenessStoreError>,
}
/// Owned exact-companion collectors. No threads, timers or watchers at creation.
/// Parent serializes methods; one granted probe consumes one durable sequence
/// before its bounded existing adapter capture, never an unchanged polling loop.
pub(crate) struct SelectedSourceCollectorsV1 {
    owner: Hex64,
    resident: Hex64,
    device: OpaqueId,
    owned: Vec<OwnedCollector>,
}
impl SelectedSourceCollectorsV1 {
    /// A single companion registry, not all saved residents or future residents.
    pub(crate) fn new(owner: Hex64, resident: Hex64, device: OpaqueId) -> Self {
        Self {
            owner,
            resident,
            device,
            owned: Vec::new(),
        }
    }
    fn owns(&self, key: &AwarenessGrantKeyV1) -> bool {
        key.source.owner_pubkey == self.owner
            && key.resident_pubkey == self.resident
            && key.source.device_id == self.device
    }
    /// Explicit current-grant Resume, never called by catalog open/restore. The
    /// host supplies fresh native internal-session exclusions, not saved prompts.
    /// Only the exact selected path's immediate parent is watched non-recursively;
    /// unrelated path events are discarded before even a dirty bit is set.
    pub(crate) fn resume(
        &mut self,
        catalog: &SelectedSourceCatalogV1,
        live: &LiveAwarenessOwner<'_>,
        runtime: &CompanionAwarenessRuntime,
        key: &AwarenessGrantKeyV1,
        excluded: HashSet<String>,
        wake: SyncSender<()>,
    ) -> Result<(), AwarenessStoreError> {
        if !self.owns(key)
            || live.owner() != &self.owner
            || catalog.owner != self.owner
            || catalog.device != self.device
        {
            return Err(AwarenessStoreError::Invalid);
        }
        let selection = catalog
            .selections(&self.resident)?
            .into_iter()
            .find(|selection| &selection.key == key)
            .ok_or(AwarenessStoreError::Missing)?;
        self.stop_grant(runtime, key)?;
        let current =
            runtime.with_granted_source_read(live, key, |authority| Ok(authority.clone()))?;
        if current.source.state != AwarenessSourceStateV1::Unknown {
            runtime.set_source_health(
                live,
                &key.source,
                current.source_revision,
                AwarenessSourceStateV1::Unknown,
                &new_id("source-resume-unknown")?,
            )?;
        }
        let collector = runtime.with_granted_source_read(live, key, |_| {
            let (target, parent) = exact_watch_target(&selection)?;
            let pending = Arc::new(Mutex::new(PendingChange::default()));
            let callback_pending = Arc::clone(&pending);
            let callback_wake = wake.clone();
            let mut watcher = RecommendedWatcher::new(
                move |event: notify::Result<Event>| {
                    let Ok(mut pending) = callback_pending.lock() else {
                        return;
                    };
                    match event {
                        Ok(event) if relevant_event(&event, &target) => {
                            pending.mark(Instant::now())
                        }
                        Ok(_) => return,
                        Err(_) => {
                            pending.watcher_failed = true;
                            pending.mark(Instant::now());
                        }
                    }
                    // A caller-owned bounded wake queue coalesces the burst. The
                    // callback never reads material, checks keys, spawns or runs models.
                    let _ = callback_wake.try_send(());
                },
                Config::default(),
            )
            .map_err(|_| AwarenessStoreError::Unavailable)?;
            watcher
                .watch(&parent, RecursiveMode::NonRecursive)
                .map_err(|_| AwarenessStoreError::Unavailable)?;
            let mut adapter = selection.adapter(excluded)?;
            adapter.set_enabled(true);
            pending
                .lock()
                .map_err(|_| AwarenessStoreError::Unavailable)?
                .mark(
                    Instant::now()
                        .checked_sub(CHANGE_DEBOUNCE)
                        .ok_or(AwarenessStoreError::Unavailable)?,
                );
            Ok(OwnedCollector {
                key: key.clone(),
                adapter,
                _watcher: watcher,
                pending,
            })
        })?;
        self.owned.push(collector);
        let _ = wake.try_send(());
        Ok(())
    }
    /// Pure event-debounce delay for a one-shot host timer. None means no work;
    /// do not convert this into a periodic source/content poll.
    pub(crate) fn next_sample_delay(&self) -> Option<Duration> {
        let now = Instant::now();
        self.owned
            .iter()
            .filter_map(|owned| owned.pending.lock().ok()?.delay(now))
            .min()
    }
    /// Dirty exact keys only, for fresh complete native exclusions before capture.
    pub(crate) fn ready_keys(&self) -> Vec<AwarenessGrantKeyV1> {
        self.owned
            .iter()
            .filter(|owned| {
                owned
                    .pending
                    .lock()
                    .ok()
                    .and_then(|pending| pending.delay(Instant::now()))
                    == Some(Duration::ZERO)
            })
            .map(|owned| owned.key.clone())
            .collect()
    }
    /// Replace host purpose exclusions without resetting hashes, sampler state
    /// or durable replay coordinates. This setter is not consent/activation.
    pub(crate) fn update_native_exclusions(
        &mut self,
        key: &AwarenessGrantKeyV1,
        excluded: HashSet<String>,
    ) -> Result<(), AwarenessStoreError> {
        if !self.owns(key) {
            return Err(AwarenessStoreError::Invalid);
        }
        self.owned
            .iter_mut()
            .find(|owned| &owned.key == key)
            .ok_or(AwarenessStoreError::Missing)?
            .adapter
            .set_native_exclusions(excluded)
    }
    /// Drain only changed events for this registry. Authentication and current
    /// consent are rechecked per capture; sequence allocation and sample execute
    /// serially under the parent-owned registry, never in the notify callback.
    /// Failed reads await a real next event, not a silent timer retry. Activity
    /// is supplied only by a verified exact native controller, never file mtime.
    pub(crate) fn sample_pending(
        &mut self,
        state: &AppState,
        runtime: &CompanionAwarenessRuntime,
        now: &CanonicalTimestamp,
        activity: impl Fn(&AwarenessGrantKeyV1) -> Option<NativeWorkActivityFactV1>,
    ) -> Result<Vec<SelectedSourceProbeV1>, AwarenessStoreError> {
        if self
            .next_sample_delay()
            .is_none_or(|delay| delay != Duration::ZERO)
        {
            return Ok(Vec::new());
        }
        let live = match LiveAwarenessOwner::authenticate(state) {
            Ok(live) if live.owner() == &self.owner => live,
            _ => {
                self.stop_resident(runtime, &self.owner.clone(), &self.resident.clone())?;
                return Err(AwarenessStoreError::Unavailable);
            }
        };
        let control = runtime.resident_state(&self.owner, &self.resident)?;
        if !control.paused && control.changed_at.as_ref() == Some(now) {
            // Resume uses a conservative whole-second freshness floor. Defer
            // this one pending capture before reading anything, rather than
            // treating the same-second sample as a failed source. This is a
            // one-shot metadata/clock delay, not polling unchanged content.
            let instant = Instant::now();
            for owned in &self.owned {
                let mut pending = owned.pending.lock()
                    .map_err(|_| AwarenessStoreError::Unavailable)?;
                if pending.delay(instant) == Some(Duration::ZERO) {
                    pending.mark(instant);
                }
            }
            return Ok(Vec::new());
        }
        let mut probes = Vec::new();
        let mut index = 0;
        while index < self.owned.len() {
            let ready = self.owned[index]
                .pending
                .lock()
                .map_err(|_| AwarenessStoreError::Unavailable)?
                .take_ready(Instant::now());
            let Some(watcher_failed) = ready else {
                index += 1;
                continue;
            };
            let key = self.owned[index].key.clone();
            let permitted =
                runtime.with_granted_source_read(&live, &key, |authority| Ok(authority.clone()));
            let outcome = match permitted {
                Ok(authority) if watcher_failed => {
                    runtime.set_source_health(
                        &live,
                        &key.source,
                        authority.source_revision,
                        AwarenessSourceStateV1::Unavailable,
                        &new_id("watch-unavailable")?,
                    )?;
                    Err(AwarenessStoreError::Unavailable)
                }
                Ok(_) => {
                    self.owned[index].adapter.mark_changed();
                    runtime.next_sequence(&live, &key).and_then(|sequence| {
                        self.owned[index].adapter.sample(
                            state,
                            runtime,
                            now,
                            sequence,
                            activity(&key).as_ref(),
                        )
                    })
                }
                Err(error) => Err(error),
            };
            let denied = watcher_failed
                || runtime
                    .with_granted_source_read(&live, &key, |_| Ok(()))
                    .is_err();
            probes.push(SelectedSourceProbeV1 {
                key: key.clone(),
                outcome,
            });
            if denied {
                self.stop_grant(runtime, &key)?;
            } else {
                index += 1;
            }
        }
        Ok(probes)
    }
    /// Drop only this exact owned watcher and evict its raw context. Parent
    /// commits durable denial first; this narrowing operation needs no model/key.
    pub(crate) fn stop_grant(
        &mut self,
        runtime: &CompanionAwarenessRuntime,
        key: &AwarenessGrantKeyV1,
    ) -> Result<(), AwarenessStoreError> {
        if !self.owns(key) {
            return Err(AwarenessStoreError::Invalid);
        }
        self.owned.retain(|owned| &owned.key != key);
        evict_grant(runtime, key)
    }
    /// Pause/identity change clears only this owned companion, not other tasks.
    pub(crate) fn stop_resident(
        &mut self,
        runtime: &CompanionAwarenessRuntime,
        owner: &Hex64,
        resident: &Hex64,
    ) -> Result<(), AwarenessStoreError> {
        if owner != &self.owner || resident != &self.resident {
            return Err(AwarenessStoreError::Invalid);
        }
        self.owned.clear();
        runtime.with_controller(owner, |controller| {
            controller.buffer.invalidate_resident(owner, resident);
            Ok(())
        })
    }
    /// Source-wide revoke drops only matching owned watchers. Existing durable
    /// source denial governs other registries; no other watcher/controller is stopped.
    pub(crate) fn stop_source(
        &mut self,
        runtime: &CompanionAwarenessRuntime,
        key: &AwarenessSourceKeyV1,
    ) -> Result<(), AwarenessStoreError> {
        if key.owner_pubkey != self.owner || key.device_id != self.device {
            return Err(AwarenessStoreError::Invalid);
        }
        self.owned.retain(|owned| owned.key.source != *key);
        runtime.with_controller(&self.owner, |controller| {
            controller
                .buffer
                .invalidate_source(&self.owner, &key.source_id, &key.device_id);
            Ok(())
        })
    }
}

fn evict_grant(
    runtime: &CompanionAwarenessRuntime,
    key: &AwarenessGrantKeyV1,
) -> Result<(), AwarenessStoreError> {
    runtime.with_controller(&key.source.owner_pubkey, |controller| {
        match controller.store.snapshot(key) {
            Ok(authority) => controller.buffer.invalidate_grant(
                &key.source.owner_pubkey,
                &key.resident_pubkey,
                &authority.grant.grant_id,
            ),
            Err(AwarenessStoreError::Missing) => {}
            Err(error) => return Err(error),
        }
        Ok(())
    })
}
fn exact_watch_target(
    selection: &SelectedSourceSelectionV1,
) -> Result<(PathBuf, PathBuf), AwarenessStoreError> {
    if fs::canonicalize(&selection.root).map_err(|_| AwarenessStoreError::Unavailable)?
        != selection.root
    {
        return Err(AwarenessStoreError::UnsafePath);
    }
    let target = selection.root.join(&selection.relative);
    let parent = target
        .parent()
        .ok_or(AwarenessStoreError::Invalid)?
        .to_path_buf();
    if fs::canonicalize(&parent).map_err(|_| AwarenessStoreError::Unavailable)? != parent {
        return Err(AwarenessStoreError::UnsafePath);
    }
    if !parent.starts_with(&selection.root) {
        return Err(AwarenessStoreError::UnsafePath);
    }
    match fs::symlink_metadata(&target) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        _ => return Err(AwarenessStoreError::UnsafePath),
    }
    Ok((target, parent))
}
fn relevant_event(event: &Event, target: &Path) -> bool {
    matches!(
        event.kind,
        EventKind::Any | EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    ) && event.paths.iter().any(|path| path == target)
}

/// Privacy-only housekeeping: expires zeroizing raw payloads even while sources
/// are quiet/paused or the signing key/model is unavailable. It never samples,
/// grants, resumes, changes canonical memory or starts a timer. Parent schedules
/// this at PAYLOAD_PRUNE_INTERVAL independently of source-change wakeups.
pub(crate) fn prune_expired_payloads(
    runtime: &CompanionAwarenessRuntime,
    retained_owner: &Hex64,
    now: &CanonicalTimestamp,
) -> Result<(), AwarenessStoreError> {
    runtime.with_controller(retained_owner, |controller| {
        controller.buffer.prune(now);
        Ok(())
    })
}

#[cfg(all(test, unix))]
#[path = "catalog_tests.rs"]
mod tests;
