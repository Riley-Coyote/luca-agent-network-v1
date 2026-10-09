//! Host-retained public control scope, never a signing or observation capability.
//!
//! A locked keychain must not prevent Pause or withdrawal. The last successfully
//! authenticated owner is retained inside the candidate's private data directory;
//! callers cannot select an owner through renderer input. Access-widening calls
//! must still present the current signable owner and match this scope.

use std::{fs, io::Read, path::Path};

use luca_protocol::{Hex64, OpaqueId};
use serde::{Deserialize, Serialize};

use super::store::AwarenessStoreError;

const SCOPE_FILE: &str = "control-scope-v1.json";
const MAX_SCOPE_BYTES: u64 = 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ControlScope {
    protocol: String,
    pub(super) owner: Hex64,
    pub(super) device: OpaqueId,
}

/// Opens a scope only at the explicit internal app-data location. It never
/// queries a keychain, repairs an unrelated folder, or starts an adapter.
pub(super) fn open_scope(
    app_data_dir: &Path,
    authenticated_owner: Option<&Hex64>,
) -> Result<(std::path::PathBuf, ControlScope), AwarenessStoreError> {
    if !app_data_dir.is_absolute() || app_data_dir.starts_with("/Volumes") {
        return Err(AwarenessStoreError::UnsafePath);
    }
    let root = fs::canonicalize(app_data_dir).map_err(|_| AwarenessStoreError::UnsafePath)?;
    if root.starts_with("/Volumes") {
        return Err(AwarenessStoreError::UnsafePath);
    }
    let directory = root.join("companion-awareness");
    match fs::symlink_metadata(&directory) {
        Ok(_) => validate_private(&directory, true)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // Recovery cannot create a new identity or an apparently active scope.
            if authenticated_owner.is_none() {
                return Err(AwarenessStoreError::Unavailable);
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                fs::DirBuilder::new()
                    .mode(0o700)
                    .create(&directory)
                    .map_err(|_| AwarenessStoreError::Unavailable)?;
            }
            #[cfg(not(unix))]
            fs::create_dir(&directory).map_err(|_| AwarenessStoreError::Unavailable)?;
            validate_private(&directory, true)?;
        }
        Err(_) => return Err(AwarenessStoreError::UnsafePath),
    }
    let path = directory.join(SCOPE_FILE);
    let old = match fs::symlink_metadata(&path) {
        Ok(_) => Some(read_scope(&path)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return Err(AwarenessStoreError::UnsafePath),
    };
    let scope = match (authenticated_owner, old) {
        (None, Some(scope)) => scope,
        (None, None) => return Err(AwarenessStoreError::Unavailable),
        (Some(owner), Some(scope)) if &scope.owner == owner => scope,
        (Some(owner), old) => {
            let device = match old {
                Some(scope) => scope.device,
                None => OpaqueId::parse(format!("device-{}", uuid::Uuid::new_v4().simple()))
                    .map_err(|_| AwarenessStoreError::Invalid)?,
            };
            let scope = ControlScope {
                protocol: "polyphonic.awareness-control-scope.v1".into(),
                owner: owner.clone(),
                device,
            };
            write_scope(&directory, &path, &scope)?;
            scope
        }
    };
    Ok((directory, scope))
}

fn read_scope(path: &Path) -> Result<ControlScope, AwarenessStoreError> {
    validate_private(path, false)?;
    let file = fs::File::open(path).map_err(|_| AwarenessStoreError::Unavailable)?;
    let mut bytes = Vec::new();
    file.take(MAX_SCOPE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| AwarenessStoreError::Unavailable)?;
    if bytes.len() as u64 > MAX_SCOPE_BYTES {
        return Err(AwarenessStoreError::Invalid);
    }
    let scope: ControlScope =
        serde_json::from_slice(&bytes).map_err(|_| AwarenessStoreError::Invalid)?;
    if scope.protocol != "polyphonic.awareness-control-scope.v1" {
        return Err(AwarenessStoreError::Invalid);
    }
    Ok(scope)
}

fn write_scope(
    directory: &Path,
    path: &Path,
    scope: &ControlScope,
) -> Result<(), AwarenessStoreError> {
    use std::io::Write;
    let bytes = serde_json::to_vec(scope).map_err(|_| AwarenessStoreError::Invalid)?;
    let temporary = directory.join(format!("scope-{}.tmp", uuid::Uuid::new_v4().simple()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|_| AwarenessStoreError::Unavailable)?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| AwarenessStoreError::Unavailable)?;
    fs::rename(&temporary, path).map_err(|_| AwarenessStoreError::Unavailable)?;
    fs::File::open(directory)
        .and_then(|file| file.sync_all())
        .map_err(|_| AwarenessStoreError::Unavailable)
}

fn validate_private(path: &Path, directory: bool) -> Result<(), AwarenessStoreError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| AwarenessStoreError::UnsafePath)?;
    if metadata.file_type().is_symlink()
        || metadata.is_dir() != directory
        || (!directory && !metadata.is_file())
    {
        return Err(AwarenessStoreError::UnsafePath);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if metadata.permissions().mode() & 0o077 != 0 || (!directory && metadata.nlink() != 1) {
            return Err(AwarenessStoreError::UnsafePath);
        }
    }
    Ok(())
}
