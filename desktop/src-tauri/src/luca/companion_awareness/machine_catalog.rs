//! Fixed private operational policies, not observations, memory or permission.
//! Opening restores selections only/OFF. No app, window, OS trust or helper is
//! inspected; native isolation, not this plain JSON, protects these host choices.

use super::machine_activity::{
    MachineActivityHandleV1, MachineCaptureRequestV1, MachineObservationClassV1,
    MACHINE_REQUEST_PROTOCOL,
};
use super::{AwarenessGrantKeyV1, AwarenessSourceKeyV1, AwarenessStoreError, LiveAwarenessOwner};
use luca_protocol::{Hex64, OpaqueId, SafeU53};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fmt, fs, io::{Read, Write}, path::{Component, Path, PathBuf}};
use zeroize::Zeroizing;

/// Fixed private operational-policy filename, never an observation archive.
pub(crate) const MACHINE_CATALOG_FILENAME: &str = "machine-sources-v1.json";
const PROTOCOL: &str = "polyphonic.awareness-machine-sources.v1";
const MAX_SELECTIONS: usize = 32;
const MAX_BYTES: usize = 256 * 1024;

/// Host-issued immutable policy for one resident/device/source class. A policy
/// is operational configuration only; the independent live grant gates every use.
#[derive(Clone)]
pub(crate) struct MachineSourceSelectionV1 {
    key: AwarenessGrantKeyV1,
    request: MachineCaptureRequestV1,
}
/// Body-free operational limits only, not current consent or OS availability.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MachinePolicyCountsV1 {
    pub(crate) allowed_app_count: usize,
    pub(crate) excluded_app_count: usize,
    pub(crate) title_exclusion_count: usize,
    pub(crate) max_text_bytes: usize,
}
impl fmt::Debug for MachineSourceSelectionV1 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MachineSourceSelectionV1").field("key", &self.key)
            .field("class", &self.class()).field("policy", &"[REDACTED]").finish()
    }
}
impl MachineSourceSelectionV1 {
    /// Pure exact policy/source validation. No all-app or text capability is
    /// derived from a metadata grant, and no helper is constructed or launched.
    pub(crate) fn new(key: AwarenessGrantKeyV1, request: MachineCaptureRequestV1)
        -> Result<Self, AwarenessStoreError> {
        MachineActivityHandleV1::new(key.clone(), request.clone())?;
        Ok(Self { key, request })
    }
    /// Exact host scope, including current owner, selected resident and device.
    pub(crate) fn key(&self) -> &AwarenessGrantKeyV1 { &self.key }
    /// Metadata, AX and OCR remain separate immutable source classes.
    pub(crate) fn class(&self) -> MachineObservationClassV1 { self.request.class() }
    /// Safe list projection without chosen app IDs, titles or exclusion terms.
    pub(crate) fn policy_counts(&self) -> Result<MachinePolicyCountsV1, AwarenessStoreError> {
        let policy = SavedPolicy::from_request(&self.request)?;
        Ok(MachinePolicyCountsV1 { allowed_app_count: policy.allowed_bundle_ids.len(), excluded_app_count: policy.excluded_bundle_ids.len(),
            title_exclusion_count: policy.excluded_title_terms.len(), max_text_bytes: policy.max_text_bytes })
    }
    pub(super) fn handle(&self) -> Result<MachineActivityHandleV1, AwarenessStoreError> {
        MachineActivityHandleV1::new(self.key.clone(), self.request.clone())
    }
}

// A closed private serialization seam. Reconstruct only through the existing
// validated policy constructor; neither a saved enabled bit nor a grant is read.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedPolicy {
    protocol: String,
    observation_class: MachineObservationClassV1,
    allowed_bundle_ids: Vec<String>,
    excluded_bundle_ids: Vec<String>,
    excluded_title_terms: Vec<String>,
    max_text_bytes: usize,
}
impl SavedPolicy {
    fn from_request(request: &MachineCaptureRequestV1) -> Result<Self, AwarenessStoreError> {
        serde_json::from_slice(&request.encode()?).map_err(|_| AwarenessStoreError::Invalid)
    }
    fn request(&self) -> Result<MachineCaptureRequestV1, AwarenessStoreError> {
        if self.protocol != MACHINE_REQUEST_PROTOCOL { return Err(AwarenessStoreError::Invalid); }
        let request = MachineCaptureRequestV1::new(self.observation_class,
            self.allowed_bundle_ids.clone(), self.excluded_bundle_ids.clone(),
            self.excluded_title_terms.clone(), self.max_text_bytes)?;
        if Self::from_request(&request)? != *self { return Err(AwarenessStoreError::Invalid); }
        Ok(request)
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedSelection { resident: Hex64, source: OpaqueId, policy: SavedPolicy }
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    protocol: String, owner: Hex64, device: OpaqueId, revision: SafeU53,
    selections: Vec<SavedSelection>,
}
impl Manifest {
    fn selection(&self, saved: &SavedSelection) -> Result<MachineSourceSelectionV1, AwarenessStoreError> {
        MachineSourceSelectionV1::new(AwarenessGrantKeyV1 {
            source: AwarenessSourceKeyV1 { owner_pubkey: self.owner.clone(), source_id: saved.source.clone(), device_id: self.device.clone() },
            resident_pubkey: saved.resident.clone(),
        }, saved.policy.request()?)
    }
    fn validate(&self, owner: &Hex64, device: &OpaqueId) -> Result<(), AwarenessStoreError> {
        if self.protocol != PROTOCOL || &self.owner != owner || &self.device != device
            || self.revision.get() == 0 || self.selections.len() > MAX_SELECTIONS {
            return Err(AwarenessStoreError::Invalid);
        }
        let mut seen = HashSet::new();
        for saved in &self.selections {
            self.selection(saved)?;
            if !seen.insert((saved.resident.clone(), saved.source.clone())) { return Err(AwarenessStoreError::Invalid); }
        }
        Ok(())
    }
}

/// Bounded, fixed-name host catalog. Policies may reveal chosen app IDs or
/// exclusion terms, so they stay in this 0700/0600 internal namespace, never
/// ordinary snapshots, logs, model context or the body-free authority database.
pub(crate) struct MachineSourceCatalogV1 {
    path: PathBuf, owner: Hex64, device: OpaqueId, saved: Option<Manifest>,
}
impl MachineSourceCatalogV1 {
    /// Metadata-only restore. Foreign, aliased, malformed or stale files are
    /// denied, not migrated, overwritten, repaired or treated as consent.
    pub(crate) fn open(directory: &Path, owner: &Hex64, device: &OpaqueId) -> Result<Self, AwarenessStoreError> {
        let path = directory.join(MACHINE_CATALOG_FILENAME);
        let saved = read_manifest(&path, owner, device)?;
        Ok(Self { path, owner: owner.clone(), device: device.clone(), saved })
    }
    /// One exact resident's operational selections; every restored adapter is
    /// OFF. Private policy values must be redacted before renderer delivery.
    pub(crate) fn selections(&self, resident: &Hex64) -> Result<Vec<MachineSourceSelectionV1>, AwarenessStoreError> {
        self.ensure_current()?;
        self.saved.as_ref().map_or(Ok(Vec::new()), |manifest| manifest.selections.iter()
            .filter(|saved| &saved.resident == resident).map(|saved| manifest.selection(saved)).collect())
    }
    /// Save a pure chosen policy under a current authenticated owner. This does
    /// not grant, enable, sample, start a watcher, or ask for OS permission.
    pub(crate) fn select(&mut self, live: &LiveAwarenessOwner<'_>, selection: MachineSourceSelectionV1)
        -> Result<(), AwarenessStoreError> {
        if live.owner() != &self.owner || selection.key.source.owner_pubkey != self.owner
            || selection.key.source.device_id != self.device { return Err(AwarenessStoreError::Invalid); }
        live.with_current(|| self.save(selection))
    }
    fn save(&mut self, selection: MachineSourceSelectionV1) -> Result<(), AwarenessStoreError> {
        self.ensure_current()?;
        let saved = SavedSelection { resident: selection.key.resident_pubkey.clone(), source: selection.key.source.source_id.clone(),
            policy: SavedPolicy::from_request(&selection.request)? };
        let mut next = self.saved.clone().unwrap_or(Manifest { protocol: PROTOCOL.into(), owner: self.owner.clone(), device: self.device.clone(),
            revision: SafeU53::new(1).map_err(|_| AwarenessStoreError::Invalid)?, selections: Vec::new() });
        if let Some(prior) = next.selections.iter().find(|prior| prior.resident == saved.resident && prior.source == saved.source) {
            return if prior == &saved { Ok(()) } else { Err(AwarenessStoreError::Conflict) };
        }
        if next.selections.len() == MAX_SELECTIONS { return Err(AwarenessStoreError::Capacity); }
        if self.saved.is_some() { next.revision = advance(next.revision)?; }
        next.selections.push(saved); self.persist(next)
    }
    /// Keyless narrowing of just this owned configuration after the parent's
    /// durable withdrawal and exact helper-stop hook. It cannot revoke provider
    /// copies or any external app-owned work, and never grants another resident.
    pub(crate) fn remove(&mut self, owner: &Hex64, key: &AwarenessGrantKeyV1) -> Result<(), AwarenessStoreError> {
        if owner != &self.owner || key.source.owner_pubkey != self.owner || key.source.device_id != self.device {
            return Err(AwarenessStoreError::Invalid);
        }
        self.ensure_current()?; let Some(mut next) = self.saved.clone() else { return Ok(()); };
        let before = next.selections.len();
        next.selections.retain(|saved| saved.resident != key.resident_pubkey || saved.source != key.source.source_id);
        if before == next.selections.len() { return Ok(()); }
        next.revision = advance(next.revision)?; self.persist(next)
    }
    fn ensure_current(&self) -> Result<(), AwarenessStoreError> {
        if read_manifest(&self.path, &self.owner, &self.device)? != self.saved { return Err(AwarenessStoreError::Conflict); }
        Ok(())
    }
    fn persist(&mut self, next: Manifest) -> Result<(), AwarenessStoreError> {
        // The owning event actor serializes writes. This CAS detects detached
        // stale host instances; it is not a cross-process tamper-proof database.
        self.ensure_current()?; next.validate(&self.owner, &self.device)?;
        let bytes = Zeroizing::new(serde_json::to_vec(&next).map_err(|_| AwarenessStoreError::Invalid)?);
        if bytes.len() > MAX_BYTES { return Err(AwarenessStoreError::Capacity); }
        let parent = self.path.parent().ok_or(AwarenessStoreError::UnsafePath)?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|_| AwarenessStoreError::Unavailable)?;
        validate_file(temporary.path(), parent)?;
        temporary.write_all(&bytes).and_then(|_| temporary.as_file().sync_all()).map_err(|_| AwarenessStoreError::Unavailable)?;
        self.ensure_current()?;
        if self.saved.is_some() { temporary.persist(&self.path).map_err(|_| AwarenessStoreError::Unavailable)?; }
        else { temporary.persist_noclobber(&self.path).map_err(|_| AwarenessStoreError::Conflict)?; }
        fs::File::open(parent).and_then(|file| file.sync_all()).map_err(|_| AwarenessStoreError::Unavailable)?;
        self.saved = Some(next); Ok(())
    }
}
fn advance(revision: SafeU53) -> Result<SafeU53, AwarenessStoreError> {
    SafeU53::new(revision.get().checked_add(1).ok_or(AwarenessStoreError::Capacity)?).map_err(|_| AwarenessStoreError::Capacity)
}
fn validate_path(path: &Path) -> Result<(), AwarenessStoreError> {
    #[cfg(not(unix))] return Err(AwarenessStoreError::Unavailable);
    if !path.is_absolute() || path.starts_with("/Volumes") || path.file_name().and_then(|part| part.to_str()) != Some(MACHINE_CATALOG_FILENAME)
        || path.components().any(|part| matches!(part, Component::CurDir | Component::ParentDir)) { return Err(AwarenessStoreError::UnsafePath); }
    let parent = path.parent().ok_or(AwarenessStoreError::UnsafePath)?;
    let metadata = fs::symlink_metadata(parent).map_err(|_| AwarenessStoreError::UnsafePath)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || fs::canonicalize(parent).map_err(|_| AwarenessStoreError::UnsafePath)? != parent {
        return Err(AwarenessStoreError::UnsafePath);
    }
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o777 != 0o700 { return Err(AwarenessStoreError::UnsafePath); } }
    match fs::symlink_metadata(path) { Ok(_) => validate_file(path, parent), Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(AwarenessStoreError::UnsafePath) }
}
fn validate_file(path: &Path, parent: &Path) -> Result<(), AwarenessStoreError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| AwarenessStoreError::UnsafePath)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() { return Err(AwarenessStoreError::UnsafePath); }
    #[cfg(unix)] { use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let directory = fs::symlink_metadata(parent).map_err(|_| AwarenessStoreError::UnsafePath)?;
        if metadata.nlink() != 1 || metadata.uid() != directory.uid() || metadata.permissions().mode() & 0o777 != 0o600 {
            return Err(AwarenessStoreError::UnsafePath);
        } }
    Ok(())
}
fn read_manifest(path: &Path, owner: &Hex64, device: &OpaqueId) -> Result<Option<Manifest>, AwarenessStoreError> {
    validate_path(path)?; let mut options = fs::OpenOptions::new(); options.read(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.custom_flags(libc::O_NOFOLLOW); }
    let file = match options.open(path) { Ok(file) => file, Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(AwarenessStoreError::Unavailable) };
    #[cfg(unix)] { use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let opened = file.metadata().map_err(|_| AwarenessStoreError::UnsafePath)?;
        let current = fs::symlink_metadata(path).map_err(|_| AwarenessStoreError::UnsafePath)?;
        if !opened.is_file() || opened.nlink() != 1 || opened.permissions().mode() & 0o777 != 0o600 || opened.uid() != current.uid()
            || opened.dev() != current.dev() || opened.ino() != current.ino() { return Err(AwarenessStoreError::UnsafePath); } }
    let mut bytes = Zeroizing::new(Vec::new()); file.take((MAX_BYTES + 1) as u64).read_to_end(&mut bytes).map_err(|_| AwarenessStoreError::Unavailable)?;
    if bytes.len() > MAX_BYTES { return Err(AwarenessStoreError::Capacity); }
    let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|_| AwarenessStoreError::Invalid)?;
    manifest.validate(owner, device)?; Ok(Some(manifest))
}

#[cfg(all(test, unix))]
#[path = "machine_catalog_tests.rs"]
mod tests;
