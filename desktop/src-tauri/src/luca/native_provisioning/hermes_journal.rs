//! Host-only provenance for owner-reviewed Hermes provisioning. Never returned over IPC.

use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::managed_agents::{
    build_hermes_runtime_binding, hermes_profile_root, resolve_native_runtime_binding,
    storage::{atomic_write_json_restricted, managed_agents_base_dir},
    RuntimeBinding,
};

const RECOVERY: &str = "Hermes setup provenance is unavailable or changed. Automatic recovery stopped; review the native profile before retrying.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct DirectoryIdentity {
    device: u64,
    inode: u64,
    created: Option<u128>,
}

fn directory_identity(path: &Path) -> Result<DirectoryIdentity, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| RECOVERY)?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || path.canonicalize().map_err(|_| RECOVERY)? != path
    {
        return Err(RECOVERY.into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(DirectoryIdentity {
            device: metadata.dev(),
            inode: metadata.ino(),
            created: metadata
                .created()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|time| time.as_nanos()),
        })
    }
    #[cfg(not(unix))]
    Err("Exact Hermes directory provenance is unsupported on this host.".into())
}

fn executable_digest(path: &Path) -> Result<String, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| RECOVERY)?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || path.canonicalize().map_err(|_| RECOVERY)? != path
        || metadata.len() > 128 * 1024 * 1024
    {
        return Err(RECOVERY.into());
    }
    let mut file = fs::File::open(path).map_err(|_| RECOVERY)?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 8192];
    loop {
        let count = file.read(&mut buffer).map_err(|_| RECOVERY)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(hex::encode(hash.finalize()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct HermesJournal {
    schema: u8,
    owner: String,
    transaction: String,
    request_hash: String,
    pub source: RuntimeBinding,
    pub root: PathBuf,
    pub destination: PathBuf,
    pub slug: String,
    root_identity: DirectoryIdentity,
    source_identity: DirectoryIdentity,
    executable_digest: String,
    creation: Option<DirectoryIdentity>,
    /// Approval of the native root's non-secret Fresh projection; absent in older journals.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fresh_model_preferences_hash: Option<String>,
    pub configured: bool,
    pub removed: bool,
}

impl HermesJournal {
    pub fn prepare(
        owner: &str,
        transaction: &str,
        request_hash: &str,
        source: RuntimeBinding,
        slug: &str,
    ) -> Result<Self, String> {
        let (_, home, executable, _) = source.hermes_provisioning_context().ok_or(RECOVERY)?;
        resolve_native_runtime_binding(&source).map_err(|_| RECOVERY)?;
        let root = hermes_profile_root(&home)?;
        let result = Self {
            schema: 1,
            owner: owner.into(),
            transaction: transaction.into(),
            request_hash: request_hash.into(),
            destination: root.join("profiles").join(slug),
            root_identity: directory_identity(&root)?,
            source_identity: directory_identity(&home)?,
            executable_digest: executable_digest(&executable)?,
            root,
            source,
            slug: slug.into(),
            creation: None,
            fresh_model_preferences_hash: None,
            configured: false,
            removed: false,
        };
        result.validate_scope()?;
        result.ensure_available()?;
        Ok(result)
    }

    pub fn validate_scope(&self) -> Result<(), String> {
        let (_, home, executable, _) = self.source.hermes_provisioning_context().ok_or(RECOVERY)?;
        resolve_native_runtime_binding(&self.source).map_err(|_| RECOVERY)?;
        if self.schema != 1
            || self
                .fresh_model_preferences_hash
                .as_ref()
                .is_some_and(|hash| {
                    hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
            || self.slug.is_empty()
            || self.slug == "default"
            || self.slug.len() > 64
            || !self.slug.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"-_".contains(&byte)
            })
            || hermes_profile_root(&home)? != self.root
            || self.destination != self.root.join("profiles").join(&self.slug)
            || directory_identity(&self.root)? != self.root_identity
            || directory_identity(&home)? != self.source_identity
            || executable_digest(&executable)? != self.executable_digest
        {
            return Err(RECOVERY.into());
        }
        let profiles = self.root.join("profiles");
        match fs::symlink_metadata(&profiles) {
            Ok(_) => {
                directory_identity(&profiles)?;
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::NotFound && self.creation.is_none() => {}
            Err(_) => return Err(RECOVERY.into()),
        }
        Ok(())
    }

    pub fn ensure_available(&self) -> Result<(), String> {
        self.validate_scope()?;
        match fs::symlink_metadata(&self.destination) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && self.creation.is_none() && !self.removed => Ok(()),
            _ => Err("A Hermes profile or filesystem entry already uses this name in the selected root. Choose another name.".into()),
        }
    }

    pub fn witness_creation(&mut self) -> Result<(), String> {
        self.validate_scope()?;
        self.creation = Some(directory_identity(&self.destination)?);
        Ok(())
    }

    pub fn verify_created(&self) -> Result<(), String> {
        self.validate_scope()?;
        if self.removed || self.creation.as_ref() != Some(&directory_identity(&self.destination)?) {
            return Err(RECOVERY.into());
        }
        Ok(())
    }

    pub fn binding(&self) -> Result<RuntimeBinding, String> {
        self.verify_created()?;
        let RuntimeBinding::Hermes {
            executable_path,
            runtime_version,
            ..
        } = &self.source
        else {
            return Err(RECOVERY.into());
        };
        let binding = build_hermes_runtime_binding(
            self.slug.clone(),
            self.destination.clone(),
            executable_path.clone(),
            runtime_version.clone(),
            None,
        );
        resolve_native_runtime_binding(&binding).map_err(|_| RECOVERY)?;
        Ok(binding)
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Ok(metadata) = fs::symlink_metadata(path) {
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(RECOVERY.into());
            }
        }
        directory_identity(path.parent().ok_or(RECOVERY)?)?;
        let bytes = serde_json::to_vec(self).map_err(|_| RECOVERY)?;
        atomic_write_json_restricted(path, &bytes).map_err(|_| RECOVERY.into())
    }

    pub fn load(
        path: &Path,
        owner: &str,
        transaction: &str,
        request_hash: &str,
    ) -> Result<Self, String> {
        directory_identity(path.parent().ok_or(RECOVERY)?)?;
        let metadata = fs::symlink_metadata(path).map_err(|_| RECOVERY)?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 64 * 1024 {
            return Err(RECOVERY.into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err(RECOVERY.into());
            }
        }
        let value: Self =
            serde_json::from_slice(&fs::read(path).map_err(|_| RECOVERY)?).map_err(|_| RECOVERY)?;
        if value.owner != owner
            || value.transaction != transaction
            || value.request_hash != request_hash
        {
            return Err(RECOVERY.into());
        }
        value.validate_scope()?;
        Ok(value)
    }
}

pub(super) fn journal_path(app: &AppHandle, transaction: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(transaction).map_err(|_| RECOVERY)?;
    let directory = managed_agents_base_dir(app)?.join("hermes-provisioning");
    if !directory.exists() {
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&directory).map_err(|_| RECOVERY)?;
    }
    // Reject symlinked journals, including a link to another valid directory.
    if fs::symlink_metadata(&directory)
        .map_err(|_| RECOVERY)?
        .file_type()
        .is_symlink()
    {
        return Err(RECOVERY.into());
    }
    let directory = directory.canonicalize().map_err(|_| RECOVERY)?;
    directory_identity(&directory)?;
    Ok(directory.join(format!("{transaction}.json")))
}

pub(super) struct ProfileGuard(PathBuf);
static ACTIVE: OnceLock<Mutex<BTreeSet<PathBuf>>> = OnceLock::new();
impl ProfileGuard {
    pub fn acquire(journal: &HermesJournal) -> Result<Self, String> {
        journal.validate_scope()?;
        let mut active = ACTIVE
            .get_or_init(Mutex::default)
            .lock()
            .map_err(|_| RECOVERY)?;
        if !active.insert(journal.destination.clone()) {
            return Err("This Hermes profile already has a setup operation in progress.".into());
        }
        Ok(Self(journal.destination.clone()))
    }
}
impl Drop for ProfileGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.get_or_init(Mutex::default).lock() {
            active.remove(&self.0);
        }
    }
}
