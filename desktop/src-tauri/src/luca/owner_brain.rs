//! Read-only local source preview for the V1.2 scoped Owner Brain.
//!
//! Preview canonicalizes one user-selected root, never follows child
//! symlinks, never writes source or app data, and stores only an expiring
//! in-memory commit handle. Persistent encrypted ingestion belongs to B23.

use chrono::{Duration, SecondsFormat, Utc};
use luca_protocol::{
    CanonicalTimestamp, Hex64, OpaqueId, OwnerBrainImportPreviewV1, OwnerBrainPreviewRowStatusV1,
    OwnerBrainPreviewRowV1, OwnerBrainSourceKindV1, SafeU53, Sha256Ref, CONTINUITY_PROTOCOL,
    MAX_OWNER_BRAIN_FILE_BYTES, MAX_OWNER_BRAIN_IMPORT_BYTES, MAX_OWNER_BRAIN_PREVIEW_ROWS,
    OWNER_BRAIN_PREVIEW_TTL_SECS,
};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc, Mutex},
};

#[derive(Clone)]
pub(crate) struct PendingOwnerBrainPreviewV1 {
    pub(crate) preview: OwnerBrainImportPreviewV1,
    pub(crate) canonical_path: PathBuf,
    pub(crate) cancelled: Arc<AtomicBool>,
    pub(crate) commit_claimed: Arc<AtomicBool>,
}

impl std::fmt::Debug for PendingOwnerBrainPreviewV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PendingOwnerBrainPreviewV1")
            .field("preview_id", &self.preview.preview_id)
            .field("canonical_path", &"[REDACTED]")
            .finish()
    }
}

pub(crate) type OwnerBrainPreviewCache = Mutex<HashMap<String, PendingOwnerBrainPreviewV1>>;

const MAX_PENDING_OWNER_BRAIN_PREVIEWS: usize = 32;

#[derive(Clone)]
pub(crate) struct OwnerBrainPreviewHandleV1 {
    pub(crate) token: String,
    pub(crate) preview: OwnerBrainImportPreviewV1,
}

impl std::fmt::Debug for OwnerBrainPreviewHandleV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OwnerBrainPreviewHandleV1")
            .field("token", &"[REDACTED]")
            .field("preview", &self.preview)
            .finish()
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct PriorOwnerBrainSnapshotV1 {
    pub(crate) hashes_by_path: BTreeMap<String, Sha256Ref>,
}

impl PriorOwnerBrainSnapshotV1 {
    pub(crate) fn from_hashes(hashes_by_path: BTreeMap<String, Sha256Ref>) -> Self {
        Self { hashes_by_path }
    }

    #[cfg(test)]
    fn from_pairs(pairs: impl IntoIterator<Item = (String, Sha256Ref)>) -> Self {
        Self::from_hashes(pairs.into_iter().collect())
    }
}

#[cfg(test)]
pub(crate) fn create_preview(
    cache: &OwnerBrainPreviewCache,
    owner_pubkey: Hex64,
    selected_path: &Path,
) -> Result<OwnerBrainPreviewHandleV1, String> {
    create_preview_with_prior(cache, owner_pubkey, selected_path, None)
}

pub(crate) fn create_preview_with_prior(
    cache: &OwnerBrainPreviewCache,
    owner_pubkey: Hex64,
    selected_path: &Path,
    prior: Option<&PriorOwnerBrainSnapshotV1>,
) -> Result<OwnerBrainPreviewHandleV1, String> {
    let canonical_path = fs::canonicalize(selected_path)
        .map_err(|_| "selected Brain source is unavailable".to_owned())?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    let token_hash = sha256_ref(token.as_bytes())?;
    let preview = preview_source_at_path(&canonical_path, owner_pubkey, token_hash.clone(), prior)?;
    let now = Utc::now().timestamp();
    let mut guard = cache
        .lock()
        .map_err(|_| "Brain preview cache is unavailable".to_owned())?;
    guard.retain(|_, pending| {
        chrono::DateTime::parse_from_rfc3339(pending.preview.expires_at.as_str())
            .map(|timestamp| timestamp.timestamp() > now)
            .unwrap_or(false)
    });
    while guard.len() >= MAX_PENDING_OWNER_BRAIN_PREVIEWS {
        let Some(oldest_key) = guard
            .iter()
            .min_by_key(|(_, pending)| pending.preview.created_at.as_str())
            .map(|(key, _)| key.clone())
        else {
            break;
        };
        guard.remove(&oldest_key);
    }
    guard.insert(
        token_hash.as_str().to_owned(),
        PendingOwnerBrainPreviewV1 {
            preview: preview.clone(),
            canonical_path,
            cancelled: Arc::new(AtomicBool::new(false)),
            commit_claimed: Arc::new(AtomicBool::new(false)),
        },
    );
    Ok(OwnerBrainPreviewHandleV1 { token, preview })
}

pub(crate) fn preview_source_at_path(
    canonical_path: &Path,
    owner_pubkey: Hex64,
    preview_token_hash: Sha256Ref,
    prior: Option<&PriorOwnerBrainSnapshotV1>,
) -> Result<OwnerBrainImportPreviewV1, String> {
    if !canonical_path.is_absolute() {
        return Err("Brain source path must be absolute".into());
    }
    let metadata = fs::metadata(canonical_path)
        .map_err(|_| "selected Brain source is unavailable".to_owned())?;
    let source_kind = if metadata.is_dir() {
        OwnerBrainSourceKindV1::TextFolder
    } else if metadata.is_file() {
        source_kind_for_file(canonical_path)
            .ok_or_else(|| "selected Brain source must be Markdown or UTF-8 text".to_owned())?
    } else {
        return Err("selected Brain source is not a file or folder".into());
    };
    let display_name = canonical_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| "selected Brain source has no safe display name".to_owned())?
        .to_owned();

    let mut rows = Vec::new();
    if metadata.is_dir() {
        scan_directory(canonical_path, canonical_path, prior, &mut rows)?;
    } else {
        scan_file(
            canonical_path,
            canonical_path.parent().unwrap_or(canonical_path),
            prior,
            &mut rows,
        )?;
    }
    rows.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    if rows.is_empty() {
        return Err("selected Brain source contains no previewable rows".into());
    }
    if rows.len() > MAX_OWNER_BRAIN_PREVIEW_ROWS {
        return Err(format!(
            "selected Brain source exceeds the {MAX_OWNER_BRAIN_PREVIEW_ROWS}-row preview limit"
        ));
    }
    let accepted_bytes = rows
        .iter()
        .filter(|row| {
            matches!(
                row.status,
                OwnerBrainPreviewRowStatusV1::Accepted
                    | OwnerBrainPreviewRowStatusV1::Duplicate
                    | OwnerBrainPreviewRowStatusV1::Changed
            )
        })
        .map(|row| row.byte_count.get())
        .sum::<u64>();
    if accepted_bytes > MAX_OWNER_BRAIN_IMPORT_BYTES {
        return Err(format!(
            "selected Brain source exceeds the {} MiB import limit",
            MAX_OWNER_BRAIN_IMPORT_BYTES / (1024 * 1024)
        ));
    }

    let root_snapshot_hash = snapshot_hash(&rows)?;
    let created = Utc::now();
    let expires = created + Duration::seconds(OWNER_BRAIN_PREVIEW_TTL_SECS as i64);
    let preview = OwnerBrainImportPreviewV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        preview_id: opaque_id("preview")?,
        preview_token_hash,
        owner_pubkey,
        source_kind,
        display_name,
        root_snapshot_hash,
        created_at: canonical_timestamp(created)?,
        expires_at: canonical_timestamp(expires)?,
        rows,
        accepted_bytes: SafeU53::new(accepted_bytes)
            .map_err(|_| "Brain preview byte count is invalid".to_owned())?,
        write_count: SafeU53::new(0).map_err(|_| "Brain preview is invalid".to_owned())?,
    };
    preview
        .validate()
        .map_err(|_| "Brain source preview failed validation".to_owned())?;
    Ok(preview)
}

fn scan_directory(
    root: &Path,
    directory: &Path,
    prior: Option<&PriorOwnerBrainSnapshotV1>,
    rows: &mut Vec<OwnerBrainPreviewRowV1>,
) -> Result<(), String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|_| "selected Brain folder could not be read".to_owned())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "selected Brain folder changed during preview".to_owned())?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        if rows.len() >= MAX_OWNER_BRAIN_PREVIEW_ROWS {
            return Err(format!(
                "selected Brain source exceeds the {MAX_OWNER_BRAIN_PREVIEW_ROWS}-row preview limit"
            ));
        }
        let path = entry.path();
        let relative = relative_path(root, &path)?;
        let metadata = fs::symlink_metadata(&path)
            .map_err(|_| "selected Brain source changed during preview".to_owned())?;
        if metadata.file_type().is_symlink() {
            rows.push(excluded_row(
                relative,
                OwnerBrainPreviewRowStatusV1::UnsafePath,
                0,
                "symlink-not-followed",
            )?);
            continue;
        }
        if metadata.is_dir() {
            if is_hidden(&entry.file_name().to_string_lossy()) {
                rows.push(excluded_row(
                    relative,
                    OwnerBrainPreviewRowStatusV1::Skipped,
                    0,
                    "hidden-directory",
                )?);
            } else {
                scan_directory(root, &path, prior, rows)?;
            }
        } else if metadata.is_file() {
            scan_file(&path, root, prior, rows)?;
        }
    }
    Ok(())
}

fn scan_file(
    path: &Path,
    root: &Path,
    prior: Option<&PriorOwnerBrainSnapshotV1>,
    rows: &mut Vec<OwnerBrainPreviewRowV1>,
) -> Result<(), String> {
    let relative = relative_path(root, path)?;
    let metadata =
        fs::metadata(path).map_err(|_| "selected Brain file changed during preview".to_owned())?;
    let byte_count = metadata.len();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if credential_like_name(&file_name) {
        rows.push(excluded_row(
            relative,
            OwnerBrainPreviewRowStatusV1::CredentialLike,
            byte_count,
            "credential-like-name",
        )?);
        return Ok(());
    }
    if is_hidden(&file_name) {
        rows.push(excluded_row(
            relative,
            OwnerBrainPreviewRowStatusV1::Skipped,
            byte_count,
            "hidden-file",
        )?);
        return Ok(());
    }
    if source_kind_for_file(path).is_none() {
        rows.push(excluded_row(
            relative,
            OwnerBrainPreviewRowStatusV1::Unsupported,
            byte_count,
            "unsupported-extension",
        )?);
        return Ok(());
    }
    if byte_count > MAX_OWNER_BRAIN_FILE_BYTES {
        rows.push(excluded_row(
            relative,
            OwnerBrainPreviewRowStatusV1::Oversized,
            byte_count,
            "file-too-large",
        )?);
        return Ok(());
    }
    let bytes = fs::read(path).map_err(|_| "selected Brain file could not be read".to_owned())?;
    let Ok(text) = std::str::from_utf8(&bytes) else {
        rows.push(excluded_row(
            relative,
            OwnerBrainPreviewRowStatusV1::Binary,
            byte_count,
            "invalid-utf8",
        )?);
        return Ok(());
    };
    if text.contains('\0') {
        rows.push(excluded_row(
            relative,
            OwnerBrainPreviewRowStatusV1::Binary,
            byte_count,
            "nul-byte",
        )?);
        return Ok(());
    }
    if credential_like_content(text) {
        rows.push(excluded_row(
            relative,
            OwnerBrainPreviewRowStatusV1::CredentialLike,
            byte_count,
            "credential-like-content",
        )?);
        return Ok(());
    }
    if text.trim().is_empty() {
        rows.push(excluded_row(
            relative,
            OwnerBrainPreviewRowStatusV1::Skipped,
            byte_count,
            "empty-file",
        )?);
        return Ok(());
    }
    let content_hash = sha256_ref(&bytes)?;
    let status = match prior.and_then(|snapshot| snapshot.hashes_by_path.get(&relative)) {
        Some(previous) if previous == &content_hash => OwnerBrainPreviewRowStatusV1::Duplicate,
        Some(_) => OwnerBrainPreviewRowStatusV1::Changed,
        None => OwnerBrainPreviewRowStatusV1::Accepted,
    };
    rows.push(OwnerBrainPreviewRowV1 {
        relative_path: relative,
        status,
        byte_count: SafeU53::new(byte_count)
            .map_err(|_| "Brain preview file size is invalid".to_owned())?,
        content_hash: Some(content_hash),
        reason_code: None,
    });
    Ok(())
}

fn excluded_row(
    relative_path: String,
    status: OwnerBrainPreviewRowStatusV1,
    byte_count: u64,
    reason: &str,
) -> Result<OwnerBrainPreviewRowV1, String> {
    let row = OwnerBrainPreviewRowV1 {
        relative_path,
        status,
        byte_count: SafeU53::new(byte_count)
            .map_err(|_| "Brain preview file size is invalid".to_owned())?,
        content_hash: None,
        reason_code: Some(
            OpaqueId::parse(reason.to_owned())
                .map_err(|_| "Brain preview reason is invalid".to_owned())?,
        ),
    };
    row.validate()
        .map_err(|_| "Brain preview exclusion is invalid".to_owned())?;
    Ok(row)
}

fn source_kind_for_file(path: &Path) -> Option<OwnerBrainSourceKindV1> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("md" | "markdown") => Some(OwnerBrainSourceKindV1::MarkdownFile),
        Some("txt") => Some(OwnerBrainSourceKindV1::TextFile),
        _ => None,
    }
}

fn relative_path(root: &Path, path: &Path) -> Result<String, String> {
    let relative = if path == root {
        path.file_name()
            .map(PathBuf::from)
            .ok_or_else(|| "Brain preview path is invalid".to_owned())?
    } else {
        path.strip_prefix(root)
            .map(PathBuf::from)
            .map_err(|_| "Brain preview path escaped the selected root".to_owned())?
    };
    let value = relative
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/");
    if value.is_empty() {
        path.file_name()
            .and_then(|name| name.to_str())
            .map(str::to_owned)
            .ok_or_else(|| "Brain preview path is invalid".to_owned())
    } else {
        Ok(value)
    }
}

fn is_hidden(file_name: &str) -> bool {
    file_name.starts_with('.')
}

fn credential_like_name(file_name: &str) -> bool {
    matches!(
        file_name,
        ".env"
            | ".env.local"
            | ".env.production"
            | "credentials"
            | "credentials.json"
            | "id_rsa"
            | "id_ed25519"
    ) || file_name.ends_with(".pem")
        || file_name.ends_with(".key")
        || file_name.ends_with(".p12")
}

fn credential_like_content(text: &str) -> bool {
    let lowered = text.to_ascii_lowercase();
    [
        "-----begin private key-----",
        "-----begin openssh private key-----",
        "api_key=",
        "apikey=",
        "secret_key=",
        "access_token=",
        "private_key=",
    ]
    .iter()
    .any(|pattern| lowered.contains(pattern))
}

fn snapshot_hash(rows: &[OwnerBrainPreviewRowV1]) -> Result<Sha256Ref, String> {
    let mut hasher = Sha256::new();
    hasher.update(b"luca.owner-brain.preview-snapshot.v1\0");
    for row in rows {
        hasher.update((row.relative_path.len() as u64).to_be_bytes());
        hasher.update(row.relative_path.as_bytes());
        let status = match row.status {
            OwnerBrainPreviewRowStatusV1::Accepted
            | OwnerBrainPreviewRowStatusV1::Duplicate
            | OwnerBrainPreviewRowStatusV1::Changed => "eligible",
            OwnerBrainPreviewRowStatusV1::Skipped => "skipped",
            OwnerBrainPreviewRowStatusV1::Unsupported => "unsupported",
            OwnerBrainPreviewRowStatusV1::Oversized => "oversized",
            OwnerBrainPreviewRowStatusV1::Binary => "binary",
            OwnerBrainPreviewRowStatusV1::CredentialLike => "credential-like",
            OwnerBrainPreviewRowStatusV1::UnsafePath => "unsafe-path",
        };
        hasher.update(status.as_bytes());
        hasher.update(row.byte_count.get().to_be_bytes());
        if let Some(hash) = &row.content_hash {
            hasher.update(hash.as_str().as_bytes());
        }
        if let Some(reason) = &row.reason_code {
            hasher.update(reason.as_str().as_bytes());
        }
    }
    Sha256Ref::parse(format!("sha256:{}", hex::encode(hasher.finalize())))
        .map_err(|_| "Brain preview snapshot hash is invalid".to_owned())
}

pub(crate) fn sha256_ref(bytes: &[u8]) -> Result<Sha256Ref, String> {
    Sha256Ref::parse(format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
        .map_err(|_| "Brain preview hash is invalid".to_owned())
}

pub(crate) fn opaque_id(prefix: &str) -> Result<OpaqueId, String> {
    OpaqueId::parse(format!("{prefix}-{}", uuid::Uuid::new_v4().simple()))
        .map_err(|_| "Brain preview identifier is invalid".to_owned())
}

pub(crate) fn canonical_timestamp(
    timestamp: chrono::DateTime<Utc>,
) -> Result<CanonicalTimestamp, String> {
    CanonicalTimestamp::parse(timestamp.to_rfc3339_opts(SecondsFormat::Secs, true))
        .map_err(|_| "Brain preview timestamp is invalid".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn owner() -> Hex64 {
        Hex64::parse("a".repeat(64)).unwrap()
    }

    fn preview_token_hash() -> Sha256Ref {
        sha256_ref(b"test-preview-token").unwrap()
    }

    fn tree_snapshot(root: &Path) -> Vec<(String, Vec<u8>)> {
        fn visit(root: &Path, directory: &Path, output: &mut Vec<(String, Vec<u8>)>) {
            let mut entries = fs::read_dir(directory)
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            entries.sort_by_key(|entry| entry.file_name());
            for entry in entries {
                let path = entry.path();
                let metadata = fs::symlink_metadata(&path).unwrap();
                if metadata.is_dir() {
                    visit(root, &path, output);
                } else if metadata.file_type().is_symlink() {
                    output.push((relative_path(root, &path).unwrap(), b"[symlink]".to_vec()));
                } else {
                    output.push((relative_path(root, &path).unwrap(), fs::read(path).unwrap()));
                }
            }
        }
        let mut output = Vec::new();
        visit(root, root, &mut output);
        output
    }

    #[test]
    fn preview_is_zero_write_and_classifies_every_safety_state() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("brain");
        fs::create_dir_all(root.join("notes")).unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();
        fs::write(root.join("notes/accepted.md"), "Launch is Monday.\n").unwrap();
        fs::write(root.join("notes/unsupported.pdf"), b"not really pdf").unwrap();
        fs::write(root.join("notes/binary.txt"), [0xff, 0xfe, 0xfd]).unwrap();
        fs::write(root.join(".env"), "API_KEY=do-not-read\n").unwrap();
        fs::write(root.join(".hidden/ignored.md"), "hidden\n").unwrap();
        let mut oversized = fs::File::create(root.join("notes/oversized.txt")).unwrap();
        oversized.set_len(MAX_OWNER_BRAIN_FILE_BYTES + 1).unwrap();
        oversized.flush().unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("accepted.md", root.join("notes/link.md")).unwrap();

        let before = tree_snapshot(&root);
        let canonical = fs::canonicalize(&root).unwrap();
        let preview =
            preview_source_at_path(&canonical, owner(), preview_token_hash(), None).unwrap();
        let after = tree_snapshot(&root);
        assert_eq!(before, after);
        assert_eq!(preview.write_count.get(), 0);
        let statuses = preview
            .rows
            .iter()
            .map(|row| row.status)
            .collect::<Vec<_>>();
        for expected in [
            OwnerBrainPreviewRowStatusV1::Accepted,
            OwnerBrainPreviewRowStatusV1::Skipped,
            OwnerBrainPreviewRowStatusV1::Unsupported,
            OwnerBrainPreviewRowStatusV1::Oversized,
            OwnerBrainPreviewRowStatusV1::Binary,
            OwnerBrainPreviewRowStatusV1::CredentialLike,
            OwnerBrainPreviewRowStatusV1::UnsafePath,
        ] {
            assert!(statuses.contains(&expected), "missing {expected:?}");
        }
        let serialized = serde_json::to_string(&preview).unwrap();
        assert!(!serialized.contains(temp.path().to_string_lossy().as_ref()));
        assert!(!serialized.contains("do-not-read"));
    }

    #[test]
    fn prior_snapshot_distinguishes_duplicate_and_changed_without_writes() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("brain");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("same.md"), "same\n").unwrap();
        fs::write(root.join("changed.md"), "new\n").unwrap();
        let same_hash = sha256_ref(b"same\n").unwrap();
        let old_changed_hash = sha256_ref(b"old\n").unwrap();
        let prior = PriorOwnerBrainSnapshotV1::from_pairs([
            ("same.md".to_owned(), same_hash),
            ("changed.md".to_owned(), old_changed_hash),
        ]);
        let preview = preview_source_at_path(
            &fs::canonicalize(&root).unwrap(),
            owner(),
            preview_token_hash(),
            Some(&prior),
        )
        .unwrap();
        let status = |path: &str| {
            preview
                .rows
                .iter()
                .find(|row| row.relative_path == path)
                .unwrap()
                .status
        };
        assert_eq!(status("same.md"), OwnerBrainPreviewRowStatusV1::Duplicate);
        assert_eq!(status("changed.md"), OwnerBrainPreviewRowStatusV1::Changed);
    }

    #[test]
    fn preview_handle_is_bound_to_a_redacted_expiring_cache_capability() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("brain.md");
        fs::write(&source, "A bounded thought.\n").unwrap();
        let cache = OwnerBrainPreviewCache::default();

        let handle = create_preview(&cache, owner(), &source).unwrap();
        let token_hash = sha256_ref(handle.token.as_bytes()).unwrap();
        assert_eq!(token_hash, handle.preview.preview_token_hash);
        assert!(cache.lock().unwrap().contains_key(token_hash.as_str()));
        assert!(!format!("{handle:?}").contains(&handle.token));
    }
}
