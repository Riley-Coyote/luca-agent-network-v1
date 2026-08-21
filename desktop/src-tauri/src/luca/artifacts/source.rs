use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

#[cfg(unix)]
use rustix::fs::{
    fchmod, fstat, mkdirat, open, openat, renameat, unlinkat, AtFlags, FileType, Mode, OFlags,
};

use image::ImageReader;
use luca_protocol::{
    ArtifactKindV1, ArtifactSourceV1, OpaqueId, MAX_ARTIFACT_FILE_BYTES, MAX_ARTIFACT_INLINE_BYTES,
};
use sha2::{Digest, Sha256};

use super::ArtifactStoreError;

const MAX_IMAGE_PIXELS: u64 = 100_000_000;

#[derive(Debug)]
pub(super) struct CapturedSource {
    pub bytes: Option<Vec<u8>>,
    pub blob_hash: Option<String>,
    pub media_type: String,
    pub size_bytes: u64,
    pub source_type: &'static str,
    pub relative_path: Option<String>,
    pub working_root_id: Option<String>,
}

pub(super) fn capture_source(
    kind: ArtifactKindV1,
    source: &ArtifactSourceV1,
    working_root_id: Option<&OpaqueId>,
    working_root: Option<&Path>,
) -> Result<CapturedSource, ArtifactStoreError> {
    source
        .validate()
        .map_err(|_| ArtifactStoreError::InvalidSource)?;
    match source {
        ArtifactSourceV1::InlineText {
            content_utf8,
            declared_media_type,
        } => {
            if content_utf8.len() > MAX_ARTIFACT_INLINE_BYTES {
                return Err(ArtifactStoreError::TooLarge);
            }
            capture_bytes(
                kind,
                content_utf8.as_bytes().to_vec(),
                "inline",
                None,
                None,
                declared_media_type.as_deref(),
            )
        }
        ArtifactSourceV1::WorkspaceFile {
            relative_path,
            declared_media_type,
        } => {
            let (root_id, root) = required_root(working_root_id, working_root)?;
            let normalized = normalize_relative_path(relative_path)?;
            let (mut file, size_bytes) = open_relative_file(root, &normalized)?;
            if size_bytes > MAX_ARTIFACT_FILE_BYTES {
                return Err(ArtifactStoreError::TooLarge);
            }
            let mut bytes = Vec::with_capacity(size_bytes.min(8 * 1024 * 1024) as usize);
            Read::by_ref(&mut file)
                .take(MAX_ARTIFACT_FILE_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| ArtifactStoreError::Unavailable)?;
            if bytes.len() as u64 > MAX_ARTIFACT_FILE_BYTES {
                return Err(ArtifactStoreError::TooLarge);
            }
            capture_bytes(
                kind,
                bytes,
                "workspace_file",
                Some(normalized),
                Some(root_id.as_str().to_owned()),
                declared_media_type.as_deref(),
            )
        }
        ArtifactSourceV1::WorkspaceDirectory { relative_path } => {
            if kind != ArtifactKindV1::App {
                return Err(ArtifactStoreError::InvalidSource);
            }
            let (root_id, root) = required_root(working_root_id, working_root)?;
            let normalized = normalize_relative_path(relative_path)?;
            validate_relative_directory(root, &normalized)?;
            Ok(CapturedSource {
                bytes: None,
                blob_hash: None,
                media_type: "application/x-luca-app".into(),
                size_bytes: 0,
                source_type: "workspace_directory",
                relative_path: Some(normalized),
                working_root_id: Some(root_id.as_str().to_owned()),
            })
        }
    }
}

fn required_root<'a>(
    id: Option<&'a OpaqueId>,
    root: Option<&'a Path>,
) -> Result<(&'a OpaqueId, &'a Path), ArtifactStoreError> {
    match (id, root) {
        (Some(id), Some(root)) => Ok((id, root)),
        _ => Err(ArtifactStoreError::WorkingRootUnavailable),
    }
}

pub(super) fn normalize_relative_path(value: &str) -> Result<String, ArtifactStoreError> {
    let slash = value.replace('\\', "/");
    let path = Path::new(&slash);
    if path.is_absolute() {
        return Err(ArtifactStoreError::UnsafePath);
    }
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let part = part.to_str().ok_or(ArtifactStoreError::UnsafePath)?;
                if part.is_empty() {
                    return Err(ArtifactStoreError::UnsafePath);
                }
                parts.push(part);
            }
            _ => return Err(ArtifactStoreError::UnsafePath),
        }
    }
    if parts.is_empty() {
        return Err(ArtifactStoreError::UnsafePath);
    }
    Ok(parts.join("/"))
}

#[cfg(unix)]
fn open_root_directory(working_root: &Path) -> Result<std::os::fd::OwnedFd, ArtifactStoreError> {
    let descriptor = open(
        working_root,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|_| ArtifactStoreError::WorkingRootUnavailable)?;
    let metadata = fstat(&descriptor).map_err(|_| ArtifactStoreError::WorkingRootUnavailable)?;
    if FileType::from_raw_mode(metadata.st_mode) != FileType::Directory {
        return Err(ArtifactStoreError::WorkingRootUnavailable);
    }
    Ok(descriptor)
}

#[cfg(unix)]
fn open_relative_descriptor<F>(
    working_root: &Path,
    relative_path: &str,
    final_flags: OFlags,
    before_final_open: F,
) -> Result<std::os::fd::OwnedFd, ArtifactStoreError>
where
    F: FnOnce(),
{
    let mut directory = open_root_directory(working_root)?;
    let mut components = relative_path.split('/').peekable();
    let mut before_final_open = Some(before_final_open);
    while let Some(component) = components.next() {
        let is_final = components.peek().is_none();
        if is_final {
            if let Some(hook) = before_final_open.take() {
                hook();
            }
        }
        let flags = if is_final {
            final_flags | OFlags::NOFOLLOW | OFlags::CLOEXEC
        } else {
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC
        };
        directory = openat(&directory, component, flags, Mode::empty()).map_err(|error| {
            if matches!(error, rustix::io::Errno::LOOP | rustix::io::Errno::XDEV) {
                ArtifactStoreError::UnsafePath
            } else {
                ArtifactStoreError::SourceMissing
            }
        })?;
    }
    Ok(directory)
}

#[cfg(unix)]
fn open_relative_file(
    working_root: &Path,
    relative_path: &str,
) -> Result<(File, u64), ArtifactStoreError> {
    open_relative_file_with_hook(working_root, relative_path, || {})
}

#[cfg(unix)]
fn open_relative_file_with_hook<F>(
    working_root: &Path,
    relative_path: &str,
    before_final_open: F,
) -> Result<(File, u64), ArtifactStoreError>
where
    F: FnOnce(),
{
    let descriptor = open_relative_descriptor(
        working_root,
        relative_path,
        OFlags::RDONLY,
        before_final_open,
    )?;
    let metadata = fstat(&descriptor).map_err(|_| ArtifactStoreError::SourceMissing)?;
    if FileType::from_raw_mode(metadata.st_mode) != FileType::RegularFile {
        return Err(ArtifactStoreError::InvalidSource);
    }
    let size = u64::try_from(metadata.st_size).map_err(|_| ArtifactStoreError::InvalidSource)?;
    Ok((File::from(descriptor), size))
}

#[cfg(unix)]
fn validate_relative_directory(
    working_root: &Path,
    relative_path: &str,
) -> Result<(), ArtifactStoreError> {
    let descriptor = open_relative_descriptor(
        working_root,
        relative_path,
        OFlags::RDONLY | OFlags::DIRECTORY,
        || {},
    )?;
    let metadata = fstat(descriptor).map_err(|_| ArtifactStoreError::SourceMissing)?;
    if FileType::from_raw_mode(metadata.st_mode) != FileType::Directory {
        return Err(ArtifactStoreError::InvalidSource);
    }
    Ok(())
}

#[cfg(not(unix))]
fn open_relative_file(
    _working_root: &Path,
    _relative_path: &str,
) -> Result<(File, u64), ArtifactStoreError> {
    Err(ArtifactStoreError::Unsupported)
}

#[cfg(not(unix))]
fn validate_relative_directory(
    _working_root: &Path,
    _relative_path: &str,
) -> Result<(), ArtifactStoreError> {
    Err(ArtifactStoreError::Unsupported)
}

fn capture_bytes(
    kind: ArtifactKindV1,
    bytes: Vec<u8>,
    source_type: &'static str,
    relative_path: Option<String>,
    working_root_id: Option<String>,
    declared_media_type: Option<&str>,
) -> Result<CapturedSource, ArtifactStoreError> {
    let media_type = authoritative_media_type(kind, &bytes)?;
    if declared_media_type.is_some_and(|declared| !media_types_match(declared, &media_type)) {
        return Err(ArtifactStoreError::MediaTypeMismatch);
    }
    let blob_hash = hex::encode(Sha256::digest(&bytes));
    Ok(CapturedSource {
        size_bytes: bytes.len() as u64,
        bytes: Some(bytes),
        blob_hash: Some(blob_hash),
        media_type,
        source_type,
        relative_path,
        working_root_id,
    })
}

fn media_types_match(declared: &str, authoritative: &str) -> bool {
    fn essence(value: &str) -> Option<String> {
        let value = value.split(';').next()?.trim().to_ascii_lowercase();
        let (type_name, subtype) = value.split_once('/')?;
        if type_name.is_empty()
            || subtype.is_empty()
            || !type_name.bytes().chain(subtype.bytes()).all(|byte| {
                byte.is_ascii_alphanumeric()
                    || matches!(
                        byte,
                        b'!' | b'#' | b'$' | b'&' | b'^' | b'_' | b'.' | b'+' | b'-'
                    )
            })
        {
            return None;
        }
        Some(value)
    }

    essence(declared).is_some_and(|declared| essence(authoritative).as_ref() == Some(&declared))
}

fn authoritative_media_type(
    kind: ArtifactKindV1,
    bytes: &[u8],
) -> Result<String, ArtifactStoreError> {
    let sniffed = infer::get(bytes).map(|kind| kind.mime_type());
    let utf8 = std::str::from_utf8(bytes).ok();
    match kind {
        ArtifactKindV1::Html => utf8
            .map(|_| "text/html; charset=utf-8".into())
            .ok_or(ArtifactStoreError::MediaTypeMismatch),
        ArtifactKindV1::Markdown => utf8
            .map(|_| "text/markdown; charset=utf-8".into())
            .ok_or(ArtifactStoreError::MediaTypeMismatch),
        ArtifactKindV1::Text | ArtifactKindV1::Code => utf8
            .map(|_| "text/plain; charset=utf-8".into())
            .ok_or(ArtifactStoreError::MediaTypeMismatch),
        ArtifactKindV1::Svg => {
            let text = utf8.ok_or(ArtifactStoreError::MediaTypeMismatch)?;
            let lower = text.trim_start().to_ascii_lowercase();
            if lower.starts_with("<svg") || (lower.starts_with("<?xml") && lower.contains("<svg")) {
                Ok("image/svg+xml".into())
            } else {
                Err(ArtifactStoreError::MediaTypeMismatch)
            }
        }
        ArtifactKindV1::Image => {
            let media_type = sniffed
                .filter(|value| value.starts_with("image/") && *value != "image/svg+xml")
                .ok_or(ArtifactStoreError::MediaTypeMismatch)?;
            let reader = ImageReader::new(std::io::Cursor::new(bytes))
                .with_guessed_format()
                .map_err(|_| ArtifactStoreError::MediaTypeMismatch)?;
            let (width, height) = reader
                .into_dimensions()
                .map_err(|_| ArtifactStoreError::MediaTypeMismatch)?;
            if u64::from(width).saturating_mul(u64::from(height)) > MAX_IMAGE_PIXELS {
                return Err(ArtifactStoreError::TooLarge);
            }
            Ok(media_type.into())
        }
        ArtifactKindV1::Pdf if sniffed == Some("application/pdf") => Ok("application/pdf".into()),
        ArtifactKindV1::Pdf => Err(ArtifactStoreError::MediaTypeMismatch),
        ArtifactKindV1::File => Ok(sniffed.unwrap_or("application/octet-stream").into()),
        ArtifactKindV1::App => Err(ArtifactStoreError::InvalidSource),
    }
}

#[cfg(unix)]
fn open_directory_nofollow(path: &Path) -> Result<std::os::fd::OwnedFd, ArtifactStoreError> {
    open(
        path,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|error| {
        if matches!(error, rustix::io::Errno::LOOP | rustix::io::Errno::NOTDIR) {
            ArtifactStoreError::UnsafePath
        } else {
            ArtifactStoreError::Unavailable
        }
    })
}

#[cfg(unix)]
fn open_or_create_directory_at(
    parent: &std::os::fd::OwnedFd,
    name: &str,
) -> Result<std::os::fd::OwnedFd, ArtifactStoreError> {
    let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    match openat(parent, name, flags, Mode::empty()) {
        Ok(directory) => return Ok(directory),
        Err(error) if error != rustix::io::Errno::NOENT => {
            return Err(
                if matches!(error, rustix::io::Errno::LOOP | rustix::io::Errno::NOTDIR) {
                    ArtifactStoreError::UnsafePath
                } else {
                    ArtifactStoreError::Unavailable
                },
            );
        }
        Err(_) => {}
    }
    match mkdirat(parent, name, Mode::from_raw_mode(0o700)) {
        Ok(()) | Err(rustix::io::Errno::EXIST) => {}
        Err(_) => return Err(ArtifactStoreError::Unavailable),
    }
    openat(parent, name, flags, Mode::empty()).map_err(|error| {
        if matches!(error, rustix::io::Errno::LOOP | rustix::io::Errno::NOTDIR) {
            ArtifactStoreError::UnsafePath
        } else {
            ArtifactStoreError::Unavailable
        }
    })
}

#[cfg(unix)]
fn publish_blob_with_hooks_impl<F, G>(
    blobs_root: &Path,
    staging_root: &Path,
    hash: &str,
    bytes: &[u8],
    before_shard_open: F,
    before_rename: G,
) -> Result<(), ArtifactStoreError>
where
    F: FnOnce(),
    G: FnOnce(),
{
    blob_path(blobs_root, hash)?;
    if hex::encode(Sha256::digest(bytes)) != hash {
        return Err(ArtifactStoreError::CorruptBlob);
    }
    let shard = hash.get(..2).ok_or(ArtifactStoreError::InvalidSource)?;
    let blobs = open_directory_nofollow(blobs_root)?;
    let sha256 = open_or_create_directory_at(&blobs, "sha256")?;
    before_shard_open();
    let directory = open_or_create_directory_at(&sha256, shard)?;
    match openat(
        &directory,
        hash,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    ) {
        Ok(descriptor) => {
            let mut existing = Vec::new();
            File::from(descriptor)
                .read_to_end(&mut existing)
                .map_err(|_| ArtifactStoreError::CorruptBlob)?;
            return if existing == bytes {
                Ok(())
            } else {
                Err(ArtifactStoreError::CorruptBlob)
            };
        }
        Err(error) if error == rustix::io::Errno::NOENT => {}
        Err(error) if error == rustix::io::Errno::LOOP => {
            return Err(ArtifactStoreError::UnsafePath);
        }
        Err(_) => return Err(ArtifactStoreError::Unavailable),
    }

    let staging = open_directory_nofollow(staging_root)?;
    let temporary = format!("{}.tmp", uuid::Uuid::new_v4().simple());
    let descriptor = openat(
        &staging,
        temporary.as_str(),
        OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::from_raw_mode(0o600),
    )
    .map_err(|_| ArtifactStoreError::Unavailable)?;
    fchmod(&descriptor, Mode::from_raw_mode(0o600)).map_err(|_| ArtifactStoreError::Unavailable)?;
    let mut file = File::from(descriptor);
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| ArtifactStoreError::Unavailable)?;
    drop(file);
    before_rename();
    if renameat(&staging, temporary.as_str(), &directory, hash).is_err() {
        let _ = unlinkat(&staging, temporary.as_str(), AtFlags::empty());
        return Err(ArtifactStoreError::Unavailable);
    }
    File::from(directory)
        .sync_all()
        .map_err(|_| ArtifactStoreError::Unavailable)?;
    Ok(())
}

#[cfg(unix)]
pub(super) fn publish_blob(
    blobs_root: &Path,
    staging_root: &Path,
    hash: &str,
    bytes: &[u8],
) -> Result<(), ArtifactStoreError> {
    publish_blob_with_hooks_impl(blobs_root, staging_root, hash, bytes, || {}, || {})
}

#[cfg(not(unix))]
pub(super) fn publish_blob(
    _blobs_root: &Path,
    _staging_root: &Path,
    _hash: &str,
    _bytes: &[u8],
) -> Result<(), ArtifactStoreError> {
    Err(ArtifactStoreError::Unsupported)
}

pub(super) fn ensure_private_directory(path: &Path) -> Result<(), ArtifactStoreError> {
    if fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err(ArtifactStoreError::UnsafePath);
    }
    fs::create_dir_all(path).map_err(|_| ArtifactStoreError::Unavailable)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| ArtifactStoreError::Unavailable)?;
    }
    Ok(())
}

pub(super) fn set_private_file(path: &Path) -> Result<(), ArtifactStoreError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|_| ArtifactStoreError::Unavailable)?;
    }
    Ok(())
}

pub(super) fn blob_path(root: &Path, hash: &str) -> Result<PathBuf, ArtifactStoreError> {
    if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ArtifactStoreError::CorruptBlob);
    }
    Ok(root.join("sha256").join(&hash[..2]).join(hash))
}

pub(super) fn read_blob(root: &Path, hash: &str) -> Result<Vec<u8>, ArtifactStoreError> {
    blob_path(root, hash)?;
    let relative = format!("sha256/{}/{hash}", &hash[..2]);
    let (mut file, size) =
        open_relative_file(root, &relative).map_err(|_| ArtifactStoreError::CorruptBlob)?;
    if size > MAX_ARTIFACT_FILE_BYTES {
        return Err(ArtifactStoreError::CorruptBlob);
    }
    let mut bytes = Vec::with_capacity(size.min(8 * 1024 * 1024) as usize);
    file.read_to_end(&mut bytes)
        .map_err(|_| ArtifactStoreError::CorruptBlob)?;
    if bytes.len() as u64 != size || hex::encode(Sha256::digest(&bytes)) != hash {
        return Err(ArtifactStoreError::CorruptBlob);
    }
    Ok(bytes)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn final_component_swap_to_symlink_fails_closed() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("nested")).unwrap();
        fs::write(root.path().join("nested/artifact.txt"), b"safe").unwrap();
        fs::write(outside.path().join("secret.txt"), b"secret").unwrap();

        let result = open_relative_file_with_hook(root.path(), "nested/artifact.txt", || {
            fs::remove_file(root.path().join("nested/artifact.txt")).unwrap();
            symlink(
                outside.path().join("secret.txt"),
                root.path().join("nested/artifact.txt"),
            )
            .unwrap();
        });

        assert!(matches!(result, Err(ArtifactStoreError::UnsafePath)));
    }

    #[test]
    fn parent_swap_cannot_redirect_an_open_directory_descriptor() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("nested")).unwrap();
        fs::write(root.path().join("nested/artifact.txt"), b"safe").unwrap();
        fs::write(outside.path().join("artifact.txt"), b"secret").unwrap();

        let (mut file, _) =
            open_relative_file_with_hook(root.path(), "nested/artifact.txt", || {
                fs::rename(root.path().join("nested"), root.path().join("parked")).unwrap();
                symlink(outside.path(), root.path().join("nested")).unwrap();
            })
            .unwrap();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).unwrap();

        assert_eq!(bytes, b"safe");
    }

    #[test]
    fn publication_rejects_an_intermediate_shard_symlink_swap() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let blobs = root.path().join("blobs");
        let staging = root.path().join("staging");
        fs::create_dir(&blobs).unwrap();
        fs::create_dir(&staging).unwrap();
        fs::create_dir(blobs.join("sha256")).unwrap();
        let bytes = b"descriptor publication";
        let hash = hex::encode(Sha256::digest(bytes));
        let shard = &hash[..2];
        fs::create_dir(blobs.join("sha256").join(shard)).unwrap();

        let result = publish_blob_with_hooks_impl(
            &blobs,
            &staging,
            &hash,
            bytes,
            || {
                fs::rename(
                    blobs.join("sha256").join(shard),
                    blobs.join("sha256/swapped"),
                )
                .unwrap();
                symlink(outside.path(), blobs.join("sha256").join(shard)).unwrap();
            },
            || {},
        );

        assert!(matches!(result, Err(ArtifactStoreError::UnsafePath)));
        assert!(!outside.path().join(&hash).exists());
    }

    #[test]
    fn publication_swap_after_open_cannot_redirect_atomic_rename() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let blobs = root.path().join("blobs");
        let staging = root.path().join("staging");
        fs::create_dir(&blobs).unwrap();
        fs::create_dir(&staging).unwrap();
        let bytes = b"atomic descriptor publication";
        let hash = hex::encode(Sha256::digest(bytes));
        let shard = hash[..2].to_owned();

        publish_blob_with_hooks_impl(
            &blobs,
            &staging,
            &hash,
            bytes,
            || {},
            || {
                let directory = blobs.join("sha256").join(&shard);
                fs::rename(&directory, blobs.join("sha256/parked")).unwrap();
                symlink(outside.path(), directory).unwrap();
            },
        )
        .unwrap();

        assert!(!outside.path().join(&hash).exists());
        assert_eq!(
            fs::read(blobs.join("sha256/parked").join(hash)).unwrap(),
            bytes
        );
    }
}
