//! Local, body-free pointers to provider-owned conversations.
//!
//! This map stores no prompts, transcripts, credentials, or tool grants. An
//! entry only selects an existing native session; it never authorizes a tool.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, VecDeque},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

pub(crate) const STORE_ENV: &str = "LUCA_RUNTIME_SESSION_MAP";
const PROTOCOL: &str = "polyphonic.runtime-session-map.v1";
const MAX_BYTES: u64 = 12 * 1024 * 1024;
const MAX_ENTRIES: usize = 512;
const MAX_DELIVERED: usize = 256;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RuntimeSessionEntry {
    pub(crate) provider_session_id: String,
    pub(crate) family: String,
    pub(crate) cwd: String,
    pub(crate) native_roots_ref: Option<String>,
    pub(crate) delivered_ids: VecDeque<String>,
    pub(crate) context_hashes: VecDeque<String>,
    pub(crate) turn_count: u64,
    pub(crate) last_used_ms: i64,
}

impl RuntimeSessionEntry {
    pub(crate) fn new(provider_session_id: String, family: String, cwd: String) -> Self {
        Self {
            provider_session_id,
            family,
            cwd,
            native_roots_ref: None,
            delivered_ids: VecDeque::new(),
            context_hashes: VecDeque::new(),
            turn_count: 0,
            last_used_ms: chrono::Utc::now().timestamp_millis(),
        }
    }

    #[cfg(test)]
    pub(crate) fn record_delivery(
        &mut self,
        ids: impl IntoIterator<Item = String>,
        hashes: impl IntoIterator<Item = String>,
    ) {
        append_bounded(&mut self.delivered_ids, ids);
        append_bounded(&mut self.context_hashes, hashes);
        self.turn_count = self.turn_count.saturating_add(1);
        self.last_used_ms = chrono::Utc::now().timestamp_millis();
    }

    fn valid(&self) -> bool {
        bounded(&self.provider_session_id, 512)
            && bounded(&self.family, 64)
            && self.cwd.len() <= 4096
            && Path::new(&self.cwd).is_absolute()
            && self
                .native_roots_ref
                .as_ref()
                .is_none_or(|v| bounded(v, 128))
            && self.delivered_ids.len() <= MAX_DELIVERED
            && self.context_hashes.len() <= MAX_DELIVERED
            && self
                .delivered_ids
                .iter()
                .chain(&self.context_hashes)
                .all(|v| valid_digest(v))
    }
}

#[cfg(test)]
fn append_bounded(target: &mut VecDeque<String>, values: impl IntoIterator<Item = String>) {
    for value in values {
        if valid_digest(&value) && !target.contains(&value) {
            target.push_back(value);
        }
    }
    while target.len() > MAX_DELIVERED {
        target.pop_front();
    }
}

fn bounded(value: &str, maximum: usize) -> bool {
    !value.is_empty() && value.len() <= maximum && !value.chars().any(char::is_control)
}
fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MapFile {
    protocol: String,
    #[serde(default)]
    reset_revision: u64,
    entries: BTreeMap<String, RuntimeSessionEntry>,
}

impl Default for MapFile {
    fn default() -> Self {
        Self {
            protocol: PROTOCOL.to_owned(),
            reset_revision: 0,
            entries: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct RuntimeSessionMap {
    path: PathBuf,
    scope: String,
    family: String,
    mutex: Arc<Mutex<()>>,
}

impl RuntimeSessionMap {
    #[cfg(not(unix))]
    pub(crate) fn from_environment(_relay_scope: &str) -> Result<Option<Self>, String> {
        Ok(None)
    }

    #[cfg(unix)]
    pub(crate) fn from_environment(relay_scope: &str) -> Result<Option<Self>, String> {
        let Some(path) = std::env::var_os(STORE_ENV).map(PathBuf::from) else {
            return Ok(None);
        };
        let stable_relay_scope = std::env::var("LUCA_RUNTIME_SESSION_RELAY_SCOPE")
            .unwrap_or_else(|_| relay_scope.to_owned());
        if !bounded(&stable_relay_scope, 4096) {
            return Err("invalid native session relay scope".into());
        }
        let resident = required_env("LUCA_MANAGED_RESIDENT_PUBKEY")?;
        let binding = match std::env::var("LUCA_RUNTIME_SESSION_IDENTITY_REF") {
            Ok(identity) => identity,
            Err(std::env::VarError::NotPresent) => required_env("LUCA_MANAGED_BINDING_REF")?,
            Err(_) => return Err("invalid native session identity encoding".into()),
        };
        let family = required_env("LUCA_MANAGED_RUNTIME_FAMILY")?;
        if !valid_digest(&resident)
            || !bounded(&binding, 128)
            || !bounded(&family, 64)
            || !path.is_absolute()
        {
            return Err("invalid native session map binding".into());
        }
        let scope = hex::encode(Sha256::digest(
            serde_json::to_vec(&(resident, binding, stable_relay_scope, &family))
                .map_err(|_| "encode native session scope")?,
        ));
        Ok(Some(Self {
            path,
            scope,
            family,
            mutex: Arc::new(Mutex::new(())),
        }))
    }

    pub(crate) fn family(&self) -> &str {
        &self.family
    }

    fn key(&self, conversation: &str) -> Result<String, String> {
        if !bounded(conversation, 1024) {
            return Err("invalid session conversation".into());
        }
        Ok(hex::encode(Sha256::digest(
            format!("{}\0{}", self.scope, conversation).as_bytes(),
        )))
    }

    #[cfg(test)]
    pub(crate) fn get(&self, conversation: &str) -> Result<Option<RuntimeSessionEntry>, String> {
        self.snapshot(conversation).map(|(entry, _)| entry)
    }

    /// Capture both the session pointer and the current explicit-reset revision.
    pub(crate) fn snapshot(
        &self,
        conversation: &str,
    ) -> Result<(Option<RuntimeSessionEntry>, u64), String> {
        let _guard = self
            .mutex
            .lock()
            .map_err(|_| "native session map is busy")?;
        let _file_guard = self.lock_file()?;
        let file = self.read()?;
        Ok((
            file.entries.get(&self.key(conversation)?).cloned(),
            file.reset_revision,
        ))
    }

    #[cfg(test)]
    pub(crate) fn save(
        &self,
        conversation: &str,
        entry: RuntimeSessionEntry,
    ) -> Result<(), String> {
        let (_, revision) = self.snapshot(conversation)?;
        self.save_at_revision(conversation, entry, revision)
    }

    pub(crate) fn save_at_revision(
        &self,
        conversation: &str,
        mut entry: RuntimeSessionEntry,
        revision: u64,
    ) -> Result<(), String> {
        if !entry.valid() || entry.family != self.family {
            return Err("invalid native session record".into());
        }
        let _guard = self
            .mutex
            .lock()
            .map_err(|_| "native session map is busy")?;
        let _file_guard = self.lock_file()?;
        let mut file = self.read()?;
        if file.reset_revision != revision {
            return Err(
                "native session changed during setup; the explicit reset was preserved".into(),
            );
        }
        let key = self.key(conversation)?;
        if file
            .entries
            .get(&key)
            .is_some_and(|existing| existing.provider_session_id != entry.provider_session_id)
        {
            return Err("another worker already established this native conversation; its history was not replaced".into());
        }
        entry.last_used_ms = chrono::Utc::now().timestamp_millis();
        file.entries.insert(key, entry);
        while file.entries.len() > MAX_ENTRIES {
            let oldest = file
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_used_ms)
                .map(|(key, _)| key.clone());
            if let Some(key) = oldest {
                file.entries.remove(&key);
            }
        }
        self.write(&file)
    }

    pub(crate) fn forget(&self, conversation: &str) -> Result<(), String> {
        let _guard = self
            .mutex
            .lock()
            .map_err(|_| "native session map is busy")?;
        let _file_guard = self.lock_file()?;
        let mut file = self.read()?;
        file.reset_revision = file
            .reset_revision
            .checked_add(1)
            .ok_or("native session reset revision exhausted")?;
        file.entries.remove(&self.key(conversation)?);
        // Write even when the entry did not exist: an in-flight session/new
        // must not resurrect the old conversation after an explicit reset.
        self.write(&file)
    }

    #[cfg(unix)]
    fn lock_file(&self) -> Result<nix::fcntl::Flock<File>, String> {
        use std::os::unix::fs::OpenOptionsExt;
        let lock_path = self.path.with_extension("lock");
        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(nix::libc::O_NOFOLLOW);
        let file = options
            .open(lock_path)
            .map_err(|_| "native session map lock is unavailable")?;
        nix::fcntl::Flock::lock(file, nix::fcntl::FlockArg::LockExclusiveNonblock)
            .map_err(|_| "native session map is in use by another process".to_owned())
    }

    #[cfg(not(unix))]
    fn lock_file(&self) -> Result<(), String> {
        // Persistent native conversation restoration is currently validated on
        // Unix transports only. Unsupported hosts never pretend to persist.
        Err("native session map locking is unavailable on this platform".into())
    }

    fn read(&self) -> Result<MapFile, String> {
        let metadata = match fs::symlink_metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(MapFile::default())
            }
            Err(_) => return Err("native session map cannot be inspected".into()),
        };
        if !metadata.is_file() || metadata.len() > MAX_BYTES {
            return Err("invalid native session map file".into());
        }
        let mut bytes = Vec::new();
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(nix::libc::O_NOFOLLOW);
        }
        options
            .open(&self.path)
            .map_err(|_| "open native session map")?
            .take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "read native session map")?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("native session map exceeds size bound".into());
        }
        let file: MapFile = serde_json::from_slice(&bytes)
            .map_err(|_| "native session map is malformed; existing records were not changed")?;
        if file.protocol != PROTOCOL
            || file.entries.len() > MAX_ENTRIES
            || file
                .entries
                .iter()
                .any(|(key, value)| !valid_digest(key) || !value.valid())
        {
            return Err("native session map has an unsupported record".into());
        }
        Ok(file)
    }

    fn write(&self, file: &MapFile) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or("native session map has no directory")?;
        if !fs::symlink_metadata(parent).is_ok_and(|m| m.is_dir()) {
            return Err("native session map directory is unavailable".into());
        }
        let bytes = serde_json::to_vec(file).map_err(|_| "encode native session map")?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("native session map exceeds size bound".into());
        }
        let temporary = parent.join(format!(".session-map-{}.tmp", uuid::Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut output = options
            .open(&temporary)
            .map_err(|_| "create private native session map")?;
        let result = (|| {
            output
                .write_all(&bytes)
                .and_then(|_| output.sync_all())
                .map_err(|_| "write native session map")?;
            fs::rename(&temporary, &self.path).map_err(|_| "commit native session map")?;
            #[cfg(unix)]
            File::open(parent)
                .and_then(|directory| directory.sync_all())
                .map_err(|_| "sync native session directory")?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }

    #[cfg(test)]
    pub(crate) fn test_fixture(path: PathBuf, scope: &str) -> Self {
        Self {
            path,
            scope: scope.to_owned(),
            family: "fixture".into(),
            mutex: Arc::new(Mutex::new(())),
        }
    }
}

#[cfg(unix)]
fn required_env(key: &str) -> Result<String, String> {
    std::env::var(key)
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("native session map is missing {key}"))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    fn fixture() -> (RuntimeSessionMap, PathBuf) {
        let root =
            std::env::temp_dir().join(format!("luca-session-map-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        (
            RuntimeSessionMap::test_fixture(root.join("sessions.json"), "scope-a"),
            root,
        )
    }
    fn entry(id: &str) -> RuntimeSessionEntry {
        RuntimeSessionEntry::new(id.into(), "fixture".into(), "/tmp/project".into())
    }
    #[test]
    fn session_map_roundtrip_keeps_provider_identity_without_transcript_bodies() {
        let (map, root) = fixture();
        let mut value = entry("native-session-1");
        value.record_delivery(["a".repeat(64)], ["b".repeat(64)]);
        map.save("room", value).unwrap();
        let reopened = RuntimeSessionMap::test_fixture(map.path.clone(), "scope-a");
        let restored = reopened.get("room").unwrap().unwrap();
        assert_eq!(restored.provider_session_id, "native-session-1");
        assert_eq!(restored.turn_count, 1);
        assert_eq!(restored.delivered_ids.front().unwrap(), &"a".repeat(64));
        let text = fs::read_to_string(&map.path).unwrap();
        for field in ["transcript", "prompt", "capability", "credential"] {
            assert!(!text.contains(field));
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn session_map_scope_isolates_binding_relay_and_resident() {
        let (map, root) = fixture();
        map.save("room", entry("native-session-1")).unwrap();
        assert!(
            RuntimeSessionMap::test_fixture(map.path.clone(), "other-scope")
                .get("room")
                .unwrap()
                .is_none()
        );
        assert!(map.get("other-room").unwrap().is_none());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn session_map_forget_removes_only_requested_conversation() {
        let (map, root) = fixture();
        map.save("a", entry("a-session")).unwrap();
        map.save("b", entry("b-session")).unwrap();
        map.forget("a").unwrap();
        assert!(map.get("a").unwrap().is_none());
        assert!(map.get("b").unwrap().is_some());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn concurrent_creation_cannot_replace_an_established_native_conversation() {
        let (map, root) = fixture();
        let (_, first_revision) = map.snapshot("room").unwrap();
        let (_, competing_revision) = map.snapshot("room").unwrap();
        map.save_at_revision("room", entry("first"), first_revision)
            .unwrap();
        assert!(map
            .save_at_revision("room", entry("competing"), competing_revision)
            .is_err());
        assert_eq!(
            map.get("room").unwrap().unwrap().provider_session_id,
            "first"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn session_map_malformed_existing_file_is_not_overwritten() {
        let (map, root) = fixture();
        fs::write(&map.path, b"malformed").unwrap();
        assert!(map.save("room", entry("native-session")).is_err());
        assert_eq!(fs::read(&map.path).unwrap(), b"malformed");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn session_map_delivery_deduplicates_and_bounds_identifiers() {
        let mut value = entry("native-session");
        value.record_delivery((0..300).map(|i| format!("{i:064x}")), []);
        assert_eq!(value.delivered_ids.len(), 256);
        value.record_delivery([format!("{:064x}", 299), "invalid".into()], []);
        assert_eq!(value.delivered_ids.len(), 256);
    }
    #[cfg(unix)]
    #[test]
    fn session_map_file_is_private_and_symlink_target_is_rejected() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let (map, root) = fixture();
        map.save("room", entry("session")).unwrap();
        assert_eq!(
            fs::metadata(&map.path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let link = root.join("linked.json");
        symlink(&map.path, &link).unwrap();
        let linked = RuntimeSessionMap::test_fixture(link, "scope-a");
        assert!(linked.save("room", entry("replacement")).is_err());
        assert_eq!(
            map.get("room").unwrap().unwrap().provider_session_id,
            "session"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn explicit_reset_wins_over_in_flight_session_creation() {
        let (map, root) = fixture();
        let (_, old_revision) = map.snapshot("room").unwrap();
        map.forget("room").unwrap();
        assert!(map
            .save_at_revision("room", entry("old-in-flight"), old_revision)
            .is_err());
        assert!(map.get("room").unwrap().is_none());
        let (_, current_revision) = map.snapshot("room").unwrap();
        map.save_at_revision("room", entry("new-intent"), current_revision)
            .unwrap();
        assert_eq!(
            map.get("room").unwrap().unwrap().provider_session_id,
            "new-intent"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn independently_opened_maps_cannot_write_through_an_active_file_lock() {
        let (map, root) = fixture();
        let locked = map.lock_file().unwrap();
        let other = RuntimeSessionMap::test_fixture(map.path.clone(), "scope-a");
        assert!(other.forget("room").is_err());
        drop(locked);
        other.save("room", entry("safe-after-unlock")).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}
