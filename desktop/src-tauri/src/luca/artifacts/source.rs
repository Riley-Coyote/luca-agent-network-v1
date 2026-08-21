use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
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
            let path = resolve_contained(root, &normalized, false)?;
            let metadata = fs::metadata(&path).map_err(|_| ArtifactStoreError::SourceMissing)?;
            if !metadata.is_file() || metadata.len() > MAX_ARTIFACT_FILE_BYTES {
                return Err(if metadata.len() > MAX_ARTIFACT_FILE_BYTES {
                    ArtifactStoreError::TooLarge
                } else {
                    ArtifactStoreError::InvalidSource
                });
            }
            let mut file = File::open(path).map_err(|_| ArtifactStoreError::SourceMissing)?;
            let mut bytes = Vec::with_capacity(metadata.len().min(8 * 1024 * 1024) as usize);
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
            let path = resolve_contained(root, &normalized, true)?;
            if !path.is_dir() {
                return Err(ArtifactStoreError::InvalidSource);
            }
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

fn normalize_relative_path(value: &str) -> Result<String, ArtifactStoreError> {
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

fn resolve_contained(
    working_root: &Path,
    relative_path: &str,
    expect_directory: bool,
) -> Result<PathBuf, ArtifactStoreError> {
    let canonical_root = working_root
        .canonicalize()
        .map_err(|_| ArtifactStoreError::WorkingRootUnavailable)?;
    if !canonical_root.is_dir() {
        return Err(ArtifactStoreError::WorkingRootUnavailable);
    }

    let mut candidate = canonical_root.clone();
    for part in relative_path.split('/') {
        candidate.push(part);
        let metadata =
            fs::symlink_metadata(&candidate).map_err(|_| ArtifactStoreError::SourceMissing)?;
        if metadata.file_type().is_symlink() {
            return Err(ArtifactStoreError::UnsafePath);
        }
    }
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|_| ArtifactStoreError::SourceMissing)?;
    if !canonical_candidate.starts_with(&canonical_root)
        || (expect_directory && !canonical_candidate.is_dir())
        || (!expect_directory && !canonical_candidate.is_file())
    {
        return Err(ArtifactStoreError::UnsafePath);
    }
    Ok(canonical_candidate)
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

pub(super) fn publish_blob(
    blobs_root: &Path,
    staging_root: &Path,
    hash: &str,
    bytes: &[u8],
) -> Result<(), ArtifactStoreError> {
    let shard = hash.get(..2).ok_or(ArtifactStoreError::InvalidSource)?;
    let directory = blobs_root.join("sha256").join(shard);
    ensure_private_directory(&directory)?;
    let destination = directory.join(hash);
    if destination.exists() {
        let metadata = destination
            .metadata()
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        if metadata.len() != bytes.len() as u64 {
            return Err(ArtifactStoreError::CorruptBlob);
        }
        return Ok(());
    }

    ensure_private_directory(staging_root)?;
    let temporary = staging_root.join(format!("{}.tmp", uuid::Uuid::new_v4().simple()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|_| ArtifactStoreError::Unavailable)?;
    set_private_file(&temporary)?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| ArtifactStoreError::Unavailable)?;
    drop(file);
    match fs::rename(&temporary, &destination) {
        Ok(()) => {}
        Err(_) if destination.exists() => {
            let _ = fs::remove_file(&temporary);
        }
        Err(_) => {
            let _ = fs::remove_file(&temporary);
            return Err(ArtifactStoreError::Unavailable);
        }
    }
    set_private_file(&destination)?;
    if let Ok(directory_file) = File::open(&directory) {
        let _ = directory_file.sync_all();
    }
    Ok(())
}

pub(super) fn ensure_private_directory(path: &Path) -> Result<(), ArtifactStoreError> {
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
