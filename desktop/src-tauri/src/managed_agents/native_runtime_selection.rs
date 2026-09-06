//! App-owned installation selection. Native profiles and resident bindings are
//! deliberately outside this store; only a trusted native picker can select.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, Metadata, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager};

const STORE_NAME: &str = "native-runtime-selection.json";
const INTENT_NAME: &str = "native-runtime-selection.intent";
const INTENT_BYTES: &[u8] = b"luca-native-runtime-selection-v1\n";
const MAX_RECORD_BYTES: u64 = 16 * 1024;
const MAX_EXECUTABLE_BYTES: u64 = 128 * 1024 * 1024;
const RECOVER: &str = " Open Settings → Defaults & permissions and choose the Hermes installation again, or use automatic discovery.";
const STORAGE_UNSAFE: &str = "Hermes installation selection cannot be read or safely saved. Repair Luca's app-data selection file or directory, then restart Luca.";
static STORE: OnceLock<Mutex<Result<SelectionStore, String>>> = OnceLock::new();

/// Installation identity only; this status does not verify a native session,
/// tools, authentication, or a provider subscription.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesRuntimeSelectionV1 {
    pub mode: &'static str,
    pub status: &'static str,
    pub executable_path: Option<String>,
    pub runtime_version: Option<String>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Identity {
    len: u64,
    modified_ns: u128,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(unix)]
    mode: u32,
    #[cfg(unix)]
    uid: u32,
    #[cfg(unix)]
    gid: u32,
    #[cfg(unix)]
    changed: (i64, i64),
}

fn identity(metadata: &Metadata, directory: bool) -> Result<Identity, String> {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    Ok(Identity {
        len: if directory { 0 } else { metadata.len() },
        modified_ns: if directory {
            0
        } else {
            metadata
                .modified()
                .map_err(|_| "File modification time is unavailable.")?
                .duration_since(UNIX_EPOCH)
                .map_err(|_| "File modification time is invalid.")?
                .as_nanos()
        },
        #[cfg(unix)]
        device: metadata.dev(),
        #[cfg(unix)]
        inode: metadata.ino(),
        #[cfg(unix)]
        mode: metadata.mode(),
        #[cfg(unix)]
        uid: metadata.uid(),
        #[cfg(unix)]
        gid: metadata.gid(),
        #[cfg(unix)]
        changed: if directory {
            (0, 0)
        } else {
            (metadata.ctime(), metadata.ctime_nsec())
        },
    })
}

fn directory_identity(path: &Path) -> Result<Identity, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "Selection directory is unavailable.")?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Selection directory must be a real directory.".into());
    }
    identity(&metadata, true)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct FileWitness {
    identity: Identity,
    sha256: String,
}

// Refuse symlinks/nonregular files before opening; O_NOFOLLOW closes the final
// component race on Unix. Recheck descriptor and pathname after the bounded read.
fn read_file(path: &Path, max: u64) -> Result<(Vec<u8>, FileWitness), String> {
    let before = fs::symlink_metadata(path).map_err(|_| "Selected file is unavailable.")?;
    if !before.is_file() || before.file_type().is_symlink() || before.len() > max {
        return Err("Selected file must be a bounded regular file.".into());
    }
    let before = identity(&before, false)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(path)
        .map_err(|_| "Selected file could not be opened.")?;
    if identity(
        &file
            .metadata()
            .map_err(|_| "Selected file is unavailable.")?,
        false,
    )? != before
    {
        return Err("Selected file changed while opening.".into());
    }
    let mut bytes = Vec::new();
    (&file)
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Selected file could not be read.")?;
    let after = fs::symlink_metadata(path).map_err(|_| "Selected file disappeared.")?;
    if bytes.len() as u64 > max
        || after.file_type().is_symlink()
        || identity(&after, false)? != before
        || identity(
            &file
                .metadata()
                .map_err(|_| "Selected file is unavailable.")?,
            false,
        )? != before
    {
        return Err("Selected file changed while reading.".into());
    }
    let witness = FileWitness {
        identity: before,
        sha256: hex::encode(Sha256::digest(&bytes)),
    };
    Ok((bytes, witness))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SelectedExecutable {
    path: PathBuf,
    runtime_version: String,
    witness: FileWitness,
}

fn executable_witness(path: &Path) -> Result<FileWitness, String> {
    if !path.is_absolute()
        || path
            .canonicalize()
            .map_err(|_| "Hermes executable is missing.")?
            != path
    {
        return Err("Hermes executable path changed.".into());
    }
    let (_, witness) = read_file(path, MAX_EXECUTABLE_BYTES)?;
    #[cfg(unix)]
    if witness.identity.mode & 0o111 == 0 {
        return Err("Selected Hermes file is not executable.".into());
    }
    Ok(witness)
}

impl SelectedExecutable {
    fn validate(&self) -> Result<(), String> {
        if self.runtime_version.is_empty() || executable_witness(&self.path)? != self.witness {
            return Err("The selected Hermes installation changed.".into());
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Record {
    schema_version: u8,
    revision: String,
    selected: Option<SelectedExecutable>,
}

// The shared storage helper preserves destination symlinks. An installation
// trust record instead needs AtomicWriteFile's native replace-the-link behavior.
fn replace_restricted(path: &Path, payload: &[u8]) -> Result<(), String> {
    let mut file = atomic_write_file::AtomicWriteFile::open(path)
        .map_err(|_| "Installation selection could not be prepared for saving.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| "Installation selection permissions could not be set.")?;
    }
    file.write_all(payload)
        .map_err(|_| "Installation selection could not be written.")?;
    file.commit()
        .map_err(|_| "Installation selection could not be saved.".into())
}

struct SelectionStore {
    root: PathBuf,
    root_identity: Identity,
    parent: PathBuf,
    parent_identity: Identity,
    observed: Option<FileWitness>,
    intent: Option<FileWitness>,
}

impl SelectionStore {
    fn open(root: &Path) -> Result<Self, String> {
        let root_identity = directory_identity(root)?;
        let parent = root.join("agents");
        if !parent
            .try_exists()
            .map_err(|_| "Selection directory is unavailable.")?
        {
            fs::create_dir(&parent).map_err(|_| "Selection directory could not be created.")?;
        }
        let parent_identity = directory_identity(&parent)?;
        let mut store = Self {
            root: root.into(),
            root_identity,
            parent,
            parent_identity,
            observed: None,
            intent: None,
        };
        let existing = store.snapshot()?;
        let intent_path = store.parent.join(INTENT_NAME);
        match fs::symlink_metadata(&intent_path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // Genuine first use gets an explicit automatic record. Writing
                // it before the marker makes interruption recoverable without
                // inventing an absent prior choice. An existing record is kept.
                if existing.is_none() {
                    let automatic = serde_json::to_vec_pretty(&Record {
                        schema_version: 1,
                        revision: uuid::Uuid::new_v4().to_string(),
                        selected: None,
                    })
                    .map_err(|_| "Installation selection could not be encoded.")?;
                    store.check_parent()?;
                    replace_restricted(&store.path(), &automatic)?;
                }
                store.check_parent()?;
                replace_restricted(&intent_path, INTENT_BYTES)?;
            }
            Err(_) => return Err(STORAGE_UNSAFE.into()),
            Ok(_) => {}
        }
        let (bytes, intent) = read_file(&intent_path, INTENT_BYTES.len() as u64)?;
        if bytes != INTENT_BYTES {
            return Err(STORAGE_UNSAFE.into());
        }
        store.intent = Some(intent);
        store.observed = store.snapshot()?.map(|(_, witness)| witness);
        Ok(store)
    }

    fn check_parent(&self) -> Result<(), String> {
        if directory_identity(&self.root)? != self.root_identity
            || directory_identity(&self.parent)? != self.parent_identity
        {
            return Err("Selection directory was replaced. Restart Luca before changing its installation selection.".into());
        }
        Ok(())
    }

    fn path(&self) -> PathBuf {
        self.parent.join(STORE_NAME)
    }

    fn snapshot(&self) -> Result<Option<(Vec<u8>, FileWitness)>, String> {
        self.check_parent()?;
        if let Some(expected) = &self.intent {
            let (_, current) = read_file(&self.parent.join(INTENT_NAME), INTENT_BYTES.len() as u64)
                .map_err(|_| STORAGE_UNSAFE.to_string())?;
            if &current != expected {
                return Err(STORAGE_UNSAFE.into());
            }
        }
        match fs::symlink_metadata(self.path()) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err("Installation selection cannot be read.".into()),
            Ok(metadata)
                if !metadata.is_file()
                    || metadata.file_type().is_symlink()
                    || metadata.len() > MAX_RECORD_BYTES =>
            {
                Err(STORAGE_UNSAFE.into())
            }
            Ok(_) => read_file(&self.path(), MAX_RECORD_BYTES).map(Some),
        }
    }

    fn record_selection(&self) -> Result<Option<SelectedExecutable>, String> {
        let snapshot = self.snapshot()?;
        if snapshot.as_ref().map(|(_, witness)| witness) != self.observed.as_ref() {
            return Err("Installation selection changed outside this app.".into());
        }
        let Some((bytes, _)) = snapshot else {
            return Err("The saved Hermes installation choice is missing.".into());
        };
        let record: Record =
            serde_json::from_slice(&bytes).map_err(|_| "Installation selection is invalid.")?;
        if record.schema_version != 1 || uuid::Uuid::parse_str(&record.revision).is_err() {
            return Err("Installation selection version is unsupported.".into());
        }
        Ok(record.selected)
    }

    fn selected(&self) -> Result<Option<SelectedExecutable>, String> {
        let selected = self.record_selection()?;
        if let Some(selected) = &selected {
            selected.validate()?;
        }
        Ok(selected)
    }

    fn status(&self) -> HermesRuntimeSelectionV1 {
        let result = self.record_selection();
        if let Ok(Some(selected)) = &result {
            if let Err(error) = selected.validate() {
                let mut status = view(Err(error));
                status.executable_path = Some(selected.path.to_string_lossy().into_owned());
                status.runtime_version = Some(selected.runtime_version.clone());
                return status;
            }
        }
        view(result)
    }

    fn save(
        &mut self,
        expected: Option<FileWitness>,
        selected: Option<SelectedExecutable>,
    ) -> Result<(), String> {
        if self.snapshot()?.map(|(_, witness)| witness) != expected {
            return Err(
                "Installation selection changed while the picker was open. Choose again.".into(),
            );
        }
        if let Some(selected) = &selected {
            selected.validate()?;
        }
        let payload = serde_json::to_vec_pretty(&Record {
            schema_version: 1,
            revision: uuid::Uuid::new_v4().to_string(),
            selected,
        })
        .map_err(|_| "Installation selection could not be encoded.")?;
        self.check_parent()?;
        // Hashing the executable can take time. Repeat the record CAS at the
        // publication boundary; even a later raced link cannot redirect writing.
        if self.snapshot()?.map(|(_, witness)| witness) != expected {
            return Err("Installation selection changed before it could be saved.".into());
        }
        replace_restricted(&self.path(), &payload)?;
        self.observed = self.snapshot()?.map(|(_, witness)| witness);
        Ok(())
    }
}

/// Initialize before runtime discovery. Initialization failure blocks explicit
/// Hermes resolution instead of falling back to an ambient installation.
pub(crate) fn init_native_runtime_selection(root: Option<&Path>) {
    STORE.get_or_init(|| {
        Mutex::new(
            root.ok_or_else(|| "App data directory is unavailable.".into())
                .and_then(SelectionStore::open),
        )
    });
}

fn with_store<T>(
    operation: impl FnOnce(&mut SelectionStore) -> Result<T, String>,
) -> Result<T, String> {
    let mutex = STORE
        .get()
        .ok_or("Hermes installation selection is not initialized.")?;
    let mut guard = mutex
        .lock()
        .map_err(|_| "Hermes installation selection is busy.")?;
    match guard.as_mut() {
        Ok(store) => {
            store
                .check_parent()
                .map_err(|_| STORAGE_UNSAFE.to_string())?;
            operation(store)
        }
        Err(_) => Err(STORAGE_UNSAFE.into()),
    }
}

fn recovery_message(error: String) -> String {
    if error == STORAGE_UNSAFE {
        error
    } else {
        format!("{error}{RECOVER}")
    }
}

/// None means automatic discovery; errors deliberately prohibit PATH fallback.
pub(crate) fn selected_hermes_executable() -> Result<Option<PathBuf>, String> {
    // Library fixtures and early non-app callers retain automatic resolution.
    // Actual setup always initializes the store before any resident restoration.
    if STORE.get().is_none() {
        return Ok(None);
    }
    with_store(|store| {
        store
            .selected()
            .map(|selected| selected.map(|selected| selected.path))
    })
    .map_err(recovery_message)
}

fn view(result: Result<Option<SelectedExecutable>, String>) -> HermesRuntimeSelectionV1 {
    match result {
        Ok(None) => HermesRuntimeSelectionV1 {
            mode: "automatic",
            status: "automatic",
            executable_path: None,
            runtime_version: None,
            message: None,
        },
        Ok(Some(selected)) => HermesRuntimeSelectionV1 {
            mode: "selected",
            status: "selected",
            executable_path: Some(selected.path.to_string_lossy().into_owned()),
            runtime_version: Some(selected.runtime_version),
            message: None,
        },
        Err(error) => HermesRuntimeSelectionV1 {
            mode: "selected",
            status: "invalid",
            executable_path: None,
            runtime_version: None,
            message: Some(recovery_message(error)),
        },
    }
}

fn owner(app: &AppHandle) -> Result<String, String> {
    Ok(app
        .state::<crate::AppState>()
        .signing_keys()?
        .public_key()
        .to_hex())
}

fn validate_picked(
    path: &Path,
    probe: impl FnOnce(&Path) -> Result<String, String>,
) -> Result<SelectedExecutable, String> {
    let path = path
        .canonicalize()
        .map_err(|_| "Selected Hermes executable is unavailable.")?;
    let witness = executable_witness(&path)?;
    let runtime_version = probe(&path)?;
    let selected = SelectedExecutable {
        path,
        runtime_version,
        witness,
    };
    selected.validate()?;
    Ok(selected)
}

/// Read installation status without invoking a native command.
#[tauri::command]
pub async fn get_hermes_runtime_selection() -> Result<HermesRuntimeSelectionV1, String> {
    tauri::async_runtime::spawn_blocking(|| {
        with_store(|store| Ok(store.status())).unwrap_or_else(|error| view(Err(error)))
    })
    .await
    .map_err(|_| "Hermes installation selection is unavailable.".into())
}

/// Select via the trusted native picker, validate fixed --version, then save
/// only if both active owner and selection revision still match the review.
#[tauri::command]
pub async fn choose_hermes_runtime_selection(
    app: AppHandle,
) -> Result<Option<HermesRuntimeSelectionV1>, String> {
    use tauri_plugin_dialog::DialogExt;
    let original_owner = owner(&app)?;
    let expected = with_store(|store| Ok(store.snapshot()?.map(|(_, witness)| witness)))?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose Hermes executable")
        .pick_file(move |selection| {
            let _ = sender.send(selection);
        });
    let Some(selection) = receiver
        .await
        .map_err(|_| "Hermes executable picker is unavailable.")?
    else {
        return Ok(None);
    };
    let path = selection
        .as_path()
        .map(Path::to_path_buf)
        .ok_or("Choose a local Hermes executable.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let selected = validate_picked(&path, super::native_runtime::validate_hermes_version)?;
        if owner(&app)? != original_owner {
            return Err("Active owner changed while the picker was open.".into());
        }
        let result = with_store(|store| {
            store.save(expected, Some(selected))?;
            Ok(Some(store.status()))
        });
        if result.is_ok() {
            super::clear_resolve_cache();
        }
        result
    })
    .await
    .map_err(|_| "Hermes installation selection is unavailable.".to_owned())?
}

/// Explicitly restore automatic discovery; existing residents are not changed.
#[tauri::command]
pub async fn clear_hermes_runtime_selection(
    app: AppHandle,
) -> Result<HermesRuntimeSelectionV1, String> {
    let original_owner = owner(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        if owner(&app)? != original_owner {
            return Err("Active owner changed.".into());
        }
        let result = with_store(|store| {
            let expected = store.snapshot()?.map(|(_, witness)| witness);
            store.save(expected, None)?;
            Ok(store.status())
        });
        if result.is_ok() {
            super::clear_resolve_cache();
        }
        result
    })
    .await
    .map_err(|_| "Hermes installation selection is unavailable.".to_owned())?
}

#[cfg(test)]
mod tests;
