//! The agent folder: a resident's documents as plain files on disk.
//!
//! Every resident owns `<app_data_dir>/residents/<pubkey>/`. Inside it, six
//! markdown documents split by *who writes them* — the owner authors
//! `soul.md`, `convictions.md` and `instructions.md`; the resident authors
//! `self-model.md`, `user-model.md` and `lessons.md`. Anything else the owner
//! or the resident drops in the folder is carried as an "extra file" and is
//! never assembled into a prompt.
//!
//! ## Why a folder and not a field
//!
//! `ManagedAgentRecord.system_prompt` is a single opaque string stamped at
//! create time and re-pinned from the linked definition. It cannot express
//! "the owner wrote this part, the resident wrote that part", it cannot be
//! edited by the resident, and it cannot be read by a human without going
//! through the app. The folder can. `system_prompt` stays the *pin* — the
//! value a persona re-snapshot writes and the value the harness receives when
//! there is no folder — and `soul.md` is seeded from it, so the two agree
//! until the owner edits one of them.
//!
//! ## Slots
//!
//! [`DocumentKind::ASSEMBLY_SLOTS`] is the assembly order: soul →
//! convictions → self-model → user-model → instructions. `lessons.md` is a
//! document but **not** a slot — it is the resident's own running notebook and
//! is deliberately excluded from the prompt in this chunk.
//!
//! ## The desktop is the only writer
//!
//! Every write from the app goes through [`write`], which is atomic
//! (temp file in the same directory, then rename), owner-only (`0o600`), and
//! append-journals to `writes.jsonl` so a folder carries its own edit history.
//! Concurrency is handled by content hashes rather than locks: an editor loads
//! a document with its `hash` and passes it back as `expected_hash`; a
//! mismatch is [`WriteError::Conflict`], never a silent overwrite.

use std::{
    collections::BTreeMap,
    io::Write as _,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager as _};

use crate::managed_agents::ManagedAgentRecord;

#[path = "resident_documents/native.rs"]
pub(crate) mod native;

#[cfg(test)]
#[path = "resident_documents/tests.rs"]
mod tests;

/// Directory under the app data dir holding every resident's agent folder.
const RESIDENTS_DIR: &str = "residents";

/// Append-only journal of desktop writes, one JSON object per line. Never
/// listed as an extra file and never assembled.
const WRITES_JOURNAL: &str = "writes.jsonl";

/// Largest document body accepted for a slot file. Soft ceiling: a prompt
/// document past a megabyte is a mistake, not a preference.
const MAX_DOCUMENT_BYTES: usize = 1024 * 1024;

/// Largest body accepted for a free-form extra file.
const MAX_EXTRA_FILE_BYTES: usize = 256 * 1024;

/// Cap on how many extra files are listed. A folder past this is being used
/// as a workspace, and the inspector is not a file browser.
const MAX_EXTRA_FILES: usize = 200;

/// Extensions an extra file may carry. Everything else is invisible to the
/// inspector and rejected by [`write`] — the folder is for text the owner and
/// the resident can both read.
const EXTRA_FILE_EXTENSIONS: &[&str] = &["md", "txt", "json", "toml", "yaml", "yml"];

/// Per-section byte cap applied by [`assemble_system_prompt`].
const ASSEMBLY_SECTION_CAP: usize = 20 * 1024;

/// Total byte cap applied by [`assemble_system_prompt`].
const ASSEMBLY_TOTAL_CAP: usize = 60 * 1024;

/// Marker appended to a section cut at [`ASSEMBLY_SECTION_CAP`].
const SECTION_TRUNCATED_MARKER: &str = "\n[… truncated at 20 KiB]";

/// Marker appended when [`ASSEMBLY_TOTAL_CAP`] stops the assembly early.
const ASSEMBLY_OMITTED_MARKER: &str = "\n[… remaining documents omitted at 60 KiB]";

/// Error prefix returned to the frontend when `expected_hash` no longer
/// matches what is on disk. Mirrors `RESIDENT_DOCUMENT_CONFLICT_PREFIX` in
/// `shared/api/tauriResidentDocuments.ts`.
pub(crate) const DOCUMENT_CONFLICT_PREFIX: &str = "document_conflict:";

/// Domain separator so a documents hash can never collide with another
/// digest in the app that happens to cover the same bytes.
const HASH_DOMAIN: &[u8] = b"luca.resident-documents.v1";

/// One of the six documents that make up a resident's agent folder.
///
/// Wire values are camelCase and shared with
/// `shared/api/tauriResidentDocuments.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DocumentKind {
    /// Who the resident is. Owner-authored; seeded from `system_prompt`.
    Soul,
    /// What the resident holds to. Owner-authored.
    Convictions,
    /// How the resident understands itself. Resident-authored.
    SelfModel,
    /// How the resident understands its owner. Resident-authored.
    UserModel,
    /// What the resident has learned. Resident-authored, not a prompt slot.
    Lessons,
    /// Standing operating instructions. Owner-authored.
    Instructions,
}

/// Who is allowed to author a document. The owner may always edit any of them
/// from the desktop; this records whose voice the file is *in*.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DocumentWriter {
    /// The human who owns this Luca workspace.
    Owner,
    /// The resident itself, through its runtime.
    Agent,
}

impl DocumentKind {
    /// Every kind, in slot order. `Lessons` is included — it is a document —
    /// but is not part of [`Self::ASSEMBLY_SLOTS`].
    pub(crate) const ALL: [DocumentKind; 6] = [
        DocumentKind::Soul,
        DocumentKind::Convictions,
        DocumentKind::SelfModel,
        DocumentKind::UserModel,
        DocumentKind::Lessons,
        DocumentKind::Instructions,
    ];

    /// The kinds assembled into a system prompt, in the order they appear.
    pub(crate) const ASSEMBLY_SLOTS: [DocumentKind; 5] = [
        DocumentKind::Soul,
        DocumentKind::Convictions,
        DocumentKind::SelfModel,
        DocumentKind::UserModel,
        DocumentKind::Instructions,
    ];

    /// File name this kind occupies at the root of the folder.
    pub(crate) fn file_name(&self) -> &'static str {
        match self {
            DocumentKind::Soul => "soul.md",
            DocumentKind::Convictions => "convictions.md",
            DocumentKind::SelfModel => "self-model.md",
            DocumentKind::UserModel => "user-model.md",
            DocumentKind::Lessons => "lessons.md",
            DocumentKind::Instructions => "instructions.md",
        }
    }

    /// Whose voice this document is written in.
    pub(crate) fn writer(&self) -> DocumentWriter {
        match self {
            DocumentKind::Soul | DocumentKind::Convictions | DocumentKind::Instructions => {
                DocumentWriter::Owner
            }
            DocumentKind::SelfModel | DocumentKind::UserModel | DocumentKind::Lessons => {
                DocumentWriter::Agent
            }
        }
    }

    /// Human label for this kind, as shown in the app.
    pub(crate) fn label(&self) -> &'static str {
        match self {
            DocumentKind::Soul => "Soul",
            DocumentKind::Convictions => "Convictions",
            DocumentKind::SelfModel => "Self-model",
            DocumentKind::UserModel => "User model",
            DocumentKind::Lessons => "Lessons",
            DocumentKind::Instructions => "Instructions",
        }
    }

    /// Section header this kind contributes to an assembled system prompt.
    ///
    /// Deliberately distinct from [`Self::label`]: the header is part of the
    /// prompt contract with the harness (which composes its own `[System]`,
    /// `[Agent Memory — core]` and `[Channel Canvas]` sections around ours),
    /// while the label is UI copy and may be reworded freely.
    fn assembly_header(&self) -> &'static str {
        match self {
            DocumentKind::Soul => "[Soul]",
            DocumentKind::Convictions => "[Convictions]",
            DocumentKind::SelfModel => "[Self-model]",
            DocumentKind::UserModel => "[User]",
            DocumentKind::Lessons => "[Lessons]",
            DocumentKind::Instructions => "[Instructions]",
        }
    }

    /// Resolve a root-level file name back to its kind, if it is a slot file.
    pub(crate) fn from_file_name(name: &str) -> Option<DocumentKind> {
        DocumentKind::ALL
            .into_iter()
            .find(|kind| kind.file_name() == name)
    }
}

/// A document by kind, or any other file in the folder by relative path.
///
/// Untagged so the wire shape is `{"kind":"soul"}` or
/// `{"relPath":"notes/x.md"}` — matching `ResidentDocumentTarget` in
/// `shared/api/tauriResidentDocuments.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub(crate) enum DocumentTarget {
    /// One of the six slot documents.
    Kind {
        /// Which slot.
        kind: DocumentKind,
    },
    /// Any other file in the folder, by path relative to the folder root.
    RelPath {
        /// Forward-slash relative path; never absolute, never `..`.
        #[serde(rename = "relPath")]
        rel_path: String,
    },
}

/// Where a resident's documents come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DocumentsSource {
    /// The resident's own agent folder under the app data dir.
    Folder,
    /// A bound native runtime's own files, read in place (Hermes profile,
    /// OpenClaw workspace). See [`native`].
    Native,
}

/// One slot document's presence and size, for the inspector.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentEntry {
    kind: DocumentKind,
    file_name: String,
    writer: DocumentWriter,
    exists: bool,
    bytes: u64,
    modified_at: Option<i64>,
}

/// A non-slot file living in the folder, as projected to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtraFileEntry {
    rel_path: String,
    bytes: u64,
    modified_at: i64,
}

/// A non-slot file as loaded from disk.
///
/// Carries `content_hash` on top of the wire projection because
/// [`documents_hash`] must cover extra-file *contents*, not just their names —
/// otherwise editing an extra file in place would leave the folder hash (and
/// therefore the spawn-time "documents changed" signal) unmoved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExtraFile {
    /// Forward-slash path relative to the folder root.
    pub rel_path: String,
    /// Size on disk.
    pub bytes: u64,
    /// Last modification, unix seconds.
    pub modified_at: i64,
    /// Hex sha256 of the file's bytes.
    pub content_hash: String,
}

/// Everything readable in one resident's folder, in memory.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct LoadedDocuments {
    /// Slot documents present on disk, keyed by kind (iteration is slot order).
    pub by_kind: BTreeMap<DocumentKind, String>,
    /// Non-slot files, sorted by relative path.
    pub extra: Vec<ExtraFile>,
}

/// Owner-facing projection of a resident's whole folder.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentsInspector {
    resident_pubkey: String,
    dir: String,
    source: DocumentsSource,
    /// "Hermes" / "OpenClaw" when `source` is native; `None` for the folder.
    native_runtime: Option<String>,
    documents: Vec<DocumentEntry>,
    extra_files: Vec<ExtraFileEntry>,
    hash: String,
}

/// One document's body, as handed to an editor.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentContent {
    target: DocumentTarget,
    exists: bool,
    content: String,
    hash: Option<String>,
    modified_at: Option<i64>,
}

/// What a successful [`write`] produced.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WriteReceipt {
    target: DocumentTarget,
    hash: String,
    documents_hash: String,
    bytes: u64,
    modified_at: i64,
}

/// Why a [`write`] was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WriteError {
    /// Disk no longer holds what the caller loaded. `current_hash` is the
    /// hash on disk now, or `None` when the file has since been removed.
    Conflict {
        /// Hash the caller should reload against.
        current_hash: Option<String>,
    },
    /// Anything else — invalid target, oversized body, I/O failure.
    Rejected(String),
}

impl std::fmt::Display for WriteError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WriteError::Conflict { current_hash } => write!(
                formatter,
                "{DOCUMENT_CONFLICT_PREFIX}{}",
                current_hash.as_deref().unwrap_or_default()
            ),
            WriteError::Rejected(message) => formatter.write_str(message),
        }
    }
}

impl From<WriteError> for String {
    fn from(value: WriteError) -> Self {
        value.to_string()
    }
}

// ── Paths ───────────────────────────────────────────────────────────────────

/// `residents/<pubkey>` — the folder's path relative to the app data dir, as
/// persisted on `ManagedAgentRecord.documents_dir`. Relative on purpose: the
/// same store is shared across dev worktrees whose absolute data dirs differ.
pub(crate) fn relative_dir(pubkey: &str) -> String {
    format!("{RESIDENTS_DIR}/{pubkey}")
}

/// A resident pubkey is a 64-character lowercase hex string. Anything else is
/// refused before it can become a path component.
pub(crate) fn is_valid_pubkey(pubkey: &str) -> bool {
    pubkey.len() == 64
        && pubkey
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn validate_pubkey(pubkey: &str) -> Result<(), String> {
    if is_valid_pubkey(pubkey) {
        Ok(())
    } else {
        Err("invalid resident identity".to_owned())
    }
}

/// Root holding every resident folder. Not created here — see
/// [`ensure_resident_dir`].
pub(crate) fn residents_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "resolve app data dir".to_owned())?
        .join(RESIDENTS_DIR))
}

/// One resident's folder. Validates the pubkey; does not touch the disk.
pub(crate) fn resident_dir(app: &AppHandle, pubkey: &str) -> Result<PathBuf, String> {
    validate_pubkey(pubkey)?;
    Ok(residents_root(app)?.join(pubkey))
}

/// Refuse a path that is a symlink, so a planted link cannot redirect a
/// `0o600` write outside the folder. Mirrors the continuity job store.
fn reject_symlink(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("resident documents path is a symlink".to_owned())
        }
        _ => Ok(()),
    }
}

#[cfg(unix)]
fn restrict(path: &Path, mode: u32) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt as _;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
        .map_err(|_| "secure resident documents path".to_owned())
}

#[cfg(not(unix))]
fn restrict(_path: &Path, _mode: u32) -> Result<(), String> {
    Ok(())
}

/// Create the residents root and this resident's folder, both owner-only.
///
/// The root itself is allowed to be a symlink — `sync_shared_agent_data`
/// links it to the canonical dev data dir so worktrees sharing
/// `managed-agents.json` also share the folders. The per-resident directory
/// is not: it holds the files we write.
pub(crate) fn ensure_resident_dir(app: &AppHandle, pubkey: &str) -> Result<PathBuf, String> {
    ensure_root_at(&residents_root(app)?)?;
    let dir = resident_dir(app, pubkey)?;
    ensure_dir_at(&dir)
}

/// Create the residents root under an arbitrary data dir, owner-only.
/// Deliberately tolerates a symlinked root — see [`ensure_resident_dir`].
pub(crate) fn ensure_root_at(root: &Path) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|_| "create residents directory".to_owned())?;
    restrict(root, 0o700)
}

/// The directory half of [`ensure_resident_dir`], without an `AppHandle`, so
/// the boot migration and the tests can build folders against any data dir.
pub(crate) fn ensure_dir_at(dir: &Path) -> Result<PathBuf, String> {
    reject_symlink(dir)?;
    std::fs::create_dir_all(dir).map_err(|_| "create resident documents directory".to_owned())?;
    restrict(dir, 0o700)?;
    Ok(dir.to_path_buf())
}

// ── Hashing ─────────────────────────────────────────────────────────────────

/// Hex sha256 of one file's body. This is the value an editor round-trips as
/// `expected_hash`.
pub(crate) fn file_hash(content: &str) -> String {
    hex::encode(Sha256::digest(content.as_bytes()))
}

fn bytes_hash(content: &[u8]) -> String {
    hex::encode(Sha256::digest(content))
}

/// Deterministic hash over a whole folder: every slot document's body and
/// every extra file's relative path and content.
///
/// An empty (or missing) folder hashes to a single fixed value, so "nothing
/// here" is a stable answer rather than an absent one.
pub(crate) fn documents_hash(loaded: &LoadedDocuments) -> String {
    let mut hasher = Sha256::new();
    hasher.update(HASH_DOMAIN);
    for kind in DocumentKind::ALL {
        let Some(content) = loaded.by_kind.get(&kind) else {
            continue;
        };
        hasher.update(kind.file_name().as_bytes());
        hasher.update(b"\0");
        hasher.update((content.len() as u64).to_le_bytes());
        hasher.update(content.as_bytes());
        hasher.update(b"\0");
    }
    for extra in &loaded.extra {
        hasher.update(extra.rel_path.as_bytes());
        hasher.update(b"\0");
        hasher.update(extra.content_hash.as_bytes());
        hasher.update(b"\0");
    }
    hex::encode(hasher.finalize())
}

// ── Loading ─────────────────────────────────────────────────────────────────

fn modified_seconds(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|delta| delta.as_secs() as i64)
        .unwrap_or_default()
}

fn has_allowed_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .is_some_and(|ext| EXTRA_FILE_EXTENSIONS.contains(&ext.as_str()))
}

/// Read every document and extra file in `dir`. A missing directory loads as
/// empty rather than failing — a resident with no folder yet is not an error.
pub(crate) fn load(dir: &Path) -> Result<LoadedDocuments, String> {
    let mut loaded = LoadedDocuments::default();
    if !dir.is_dir() {
        return Ok(loaded);
    }
    for kind in DocumentKind::ALL {
        let path = dir.join(kind.file_name());
        if reject_symlink(&path).is_err() || !path.is_file() {
            continue;
        }
        match std::fs::read_to_string(&path) {
            Ok(content) => {
                loaded.by_kind.insert(kind, content);
            }
            // A non-UTF-8 or unreadable slot file is skipped rather than
            // failing the whole folder: the other documents still describe
            // the resident, and the inspector reports the file as present.
            Err(error) => eprintln!(
                "buzz-desktop: resident-documents: skipping {}: {error}",
                path.display()
            ),
        }
    }
    loaded.extra = collect_extra_files(dir);
    Ok(loaded)
}

/// Walk `dir` recursively for readable, allowlisted, non-slot files.
///
/// Skips the write journal, dotfiles and dot-directories, symlinks, and
/// anything past [`MAX_EXTRA_FILES`]. Only root-level slot file names are
/// excluded — a `notes/soul.md` is an ordinary extra file.
fn collect_extra_files(dir: &Path) -> Vec<ExtraFile> {
    let mut found = Vec::new();
    let mut queue = vec![(dir.to_path_buf(), String::new())];
    while let Some((current, prefix)) = queue.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        let mut children: Vec<_> = entries.flatten().collect();
        children.sort_by_key(std::fs::DirEntry::file_name);
        for entry in children {
            if found.len() >= MAX_EXTRA_FILES {
                break;
            }
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            let Ok(metadata) = std::fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            let rel_path = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if metadata.is_dir() {
                queue.push((path, rel_path));
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            if prefix.is_empty()
                && (name == WRITES_JOURNAL || DocumentKind::from_file_name(&name).is_some())
            {
                continue;
            }
            if !has_allowed_extension(&path) {
                continue;
            }
            let Ok(bytes) = std::fs::read(&path) else {
                continue;
            };
            found.push(ExtraFile {
                rel_path,
                bytes: metadata.len(),
                modified_at: modified_seconds(&metadata),
                content_hash: bytes_hash(&bytes),
            });
        }
    }
    found.sort_by(|left, right| left.rel_path.cmp(&right.rel_path));
    found
}

/// The native layout behind a record, when it has one we can locate.
pub(crate) fn native_layout_for(
    record: Option<&ManagedAgentRecord>,
) -> Option<native::NativeLayout> {
    record?
        .native_runtime_binding
        .as_ref()
        .and_then(native::NativeLayout::from_binding)
}

/// Project one resident's folder for the frontend.
pub(crate) fn inspect(dir: &Path, pubkey: &str) -> Result<DocumentsInspector, String> {
    validate_pubkey(pubkey)?;
    let loaded = load(dir)?;
    let documents = DocumentKind::ALL
        .into_iter()
        .map(|kind| {
            let metadata = std::fs::metadata(dir.join(kind.file_name())).ok();
            DocumentEntry {
                kind,
                file_name: kind.file_name().to_owned(),
                writer: kind.writer(),
                exists: metadata.is_some(),
                bytes: metadata.as_ref().map(std::fs::Metadata::len).unwrap_or(0),
                modified_at: metadata.as_ref().map(modified_seconds),
            }
        })
        .collect();
    let extra_files = loaded
        .extra
        .iter()
        .map(|extra| ExtraFileEntry {
            rel_path: extra.rel_path.clone(),
            bytes: extra.bytes,
            modified_at: extra.modified_at,
        })
        .collect();
    Ok(DocumentsInspector {
        resident_pubkey: pubkey.to_owned(),
        dir: relative_dir(pubkey),
        source: DocumentsSource::Folder,
        native_runtime: None,
        documents,
        extra_files,
        hash: documents_hash(&loaded),
    })
}

// ── Targets ─────────────────────────────────────────────────────────────────

/// Resolve a target to a path inside `dir`, refusing anything that could
/// escape it.
fn resolve_target(dir: &Path, target: &DocumentTarget) -> Result<(PathBuf, usize), String> {
    match target {
        DocumentTarget::Kind { kind } => Ok((dir.join(kind.file_name()), MAX_DOCUMENT_BYTES)),
        DocumentTarget::RelPath { rel_path } => {
            let trimmed = rel_path.trim();
            if trimmed.is_empty() {
                return Err("empty document path".to_owned());
            }
            let candidate = Path::new(trimmed);
            if candidate.is_absolute() {
                return Err("document path must be relative".to_owned());
            }
            let mut resolved = dir.to_path_buf();
            for component in candidate.components() {
                match component {
                    std::path::Component::Normal(part) => {
                        let Some(part) = part.to_str() else {
                            return Err("document path is not valid UTF-8".to_owned());
                        };
                        if part.starts_with('.') {
                            return Err("document path may not contain hidden segments".to_owned());
                        }
                        resolved.push(part);
                    }
                    _ => return Err("document path may not traverse directories".to_owned()),
                }
            }
            if resolved == dir.join(WRITES_JOURNAL) {
                return Err("the write journal is not editable".to_owned());
            }
            if !has_allowed_extension(&resolved) {
                return Err("unsupported document file type".to_owned());
            }
            Ok((resolved, MAX_EXTRA_FILE_BYTES))
        }
    }
}

// ── Reading ─────────────────────────────────────────────────────────────────

/// Read one document. A file that does not exist reads as empty with a `None`
/// hash — the value an editor passes back as `expected_hash` for a create.
pub(crate) fn read(dir: &Path, target: DocumentTarget) -> Result<DocumentContent, String> {
    let (path, _) = resolve_target(dir, &target)?;
    reject_symlink(&path)?;
    let Ok(metadata) = std::fs::metadata(&path) else {
        return Ok(DocumentContent {
            target,
            exists: false,
            content: String::new(),
            hash: None,
            modified_at: None,
        });
    };
    if !metadata.is_file() {
        return Err("document path is not a file".to_owned());
    }
    let content =
        std::fs::read_to_string(&path).map_err(|_| "read resident document".to_owned())?;
    Ok(DocumentContent {
        hash: Some(file_hash(&content)),
        modified_at: Some(modified_seconds(&metadata)),
        exists: true,
        content,
        target,
    })
}

// ── Writing ─────────────────────────────────────────────────────────────────

/// Current on-disk hash for `path`, or `None` when there is no file there.
fn current_hash(path: &Path) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|body| file_hash(&body))
}

/// Write `content` atomically, owner-only, and append the write to the folder
/// journal.
///
/// `expected_hash` is the optimistic-concurrency token: `None` means "I
/// expect no file here", `Some(h)` means "I loaded `h`". Any disagreement is
/// [`WriteError::Conflict`] carrying the hash to reload against — the caller
/// never silently overwrites someone else's edit.
///
/// An empty `content` writes an empty file. Removing a document is
/// [`clear`], which is a different intent.
pub(crate) fn write(
    dir: &Path,
    target: DocumentTarget,
    content: &str,
    expected_hash: Option<&str>,
    writer: DocumentWriter,
) -> Result<WriteReceipt, WriteError> {
    let (path, max_bytes) = resolve_target(dir, &target).map_err(WriteError::Rejected)?;
    if content.len() > max_bytes {
        return Err(WriteError::Rejected(format!(
            "document exceeds the {max_bytes}-byte limit"
        )));
    }
    reject_symlink(&path).map_err(WriteError::Rejected)?;
    let on_disk = current_hash(&path);
    match (expected_hash, on_disk.as_deref()) {
        (None, None) => {}
        (Some(expected), Some(actual)) if expected == actual => {}
        _ => {
            return Err(WriteError::Conflict {
                current_hash: on_disk,
            })
        }
    }
    if let Some(parent) = path.parent() {
        ensure_dir_at(parent).map_err(WriteError::Rejected)?;
    }
    atomic_write_restricted(&path, content.as_bytes()).map_err(WriteError::Rejected)?;

    let hash = file_hash(content);
    let bytes = content.len() as u64;
    let modified_at = std::fs::metadata(&path)
        .map(|metadata| modified_seconds(&metadata))
        .unwrap_or_else(|_| now_seconds());
    append_journal(dir, &target, writer, bytes, &hash, None);
    let loaded = load(dir).map_err(WriteError::Rejected)?;
    Ok(WriteReceipt {
        target,
        hash,
        documents_hash: documents_hash(&loaded),
        bytes,
        modified_at,
    })
}

/// Write one slot document verbatim, without journalling it.
///
/// Reserved for the boot migration, which *is* the folder's birth: there was
/// no desktop write to record, and a journal line claiming one would be a
/// fiction. Every other path goes through [`write`].
pub(crate) fn seed_document_verbatim(
    dir: &Path,
    kind: DocumentKind,
    content: &str,
) -> Result<(), String> {
    let path = dir.join(kind.file_name());
    reject_symlink(&path)?;
    atomic_write_restricted(&path, content.as_bytes())
}

/// Remove a slot document. Used by the "clear the pin" path in
/// `update_managed_agent`; a blank document and an absent one are different
/// states and the owner may mean either.
pub(crate) fn clear(dir: &Path, kind: DocumentKind) -> Result<(), String> {
    let path = dir.join(kind.file_name());
    reject_symlink(&path)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("remove resident document: {error}")),
    }
}

/// Temp-file-then-rename write at `0o600`, so a reader never observes a
/// half-written document and the bytes are owner-only before they land.
fn atomic_write_restricted(path: &Path, payload: &[u8]) -> Result<(), String> {
    use atomic_write_file::AtomicWriteFile;

    let mut file = AtomicWriteFile::open(path)
        .map_err(|error| format!("open {} for atomic write: {error}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("set {} permissions: {error}", path.display()))?;
    }
    file.write_all(payload)
        .map_err(|error| format!("write {}: {error}", path.display()))?;
    file.commit()
        .map_err(|error| format!("commit {}: {error}", path.display()))
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|delta| delta.as_secs() as i64)
        .unwrap_or_default()
}

/// Append one line to `writes.jsonl`. Best effort on purpose: the document is
/// already on disk, and a folder that cannot journal is still a valid folder.
fn append_journal(
    dir: &Path,
    target: &DocumentTarget,
    writer: DocumentWriter,
    bytes: u64,
    hash: &str,
    native_path: Option<&Path>,
) {
    let mut entry = serde_json::json!({
        "at": now_seconds(),
        "target": target,
        "writer": writer,
        "bytes": bytes,
        "hash": hash,
    });
    if let (Some(path), Some(object)) = (native_path, entry.as_object_mut()) {
        object.insert(
            "path".to_owned(),
            serde_json::Value::String(path.display().to_string()),
        );
    }
    let Ok(mut line) = serde_json::to_vec(&entry) else {
        return;
    };
    line.push(b'\n');
    let path = dir.join(WRITES_JOURNAL);
    if reject_symlink(&path).is_err() {
        return;
    }
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    if let Ok(mut file) = options.open(&path) {
        let _ = file.write_all(&line);
    }
}

// ── Assembly ────────────────────────────────────────────────────────────────

/// Cut `body` at [`ASSEMBLY_SECTION_CAP`] on a char boundary, marking the cut.
fn cap_section(body: &str) -> String {
    if body.len() <= ASSEMBLY_SECTION_CAP {
        return body.to_owned();
    }
    let mut end = ASSEMBLY_SECTION_CAP;
    while end > 0 && !body.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{SECTION_TRUNCATED_MARKER}", &body[..end])
}

/// Compose the resident's system prompt from its folder.
///
/// Sections appear in [`DocumentKind::ASSEMBLY_SLOTS`] order, each as
/// `"[Header]\n<body>"`, joined by a blank line. Blank and missing documents
/// contribute nothing; `lessons.md` is never a section. Returns `None` when
/// the folder has nothing to say, so a caller can fall back to the pin
/// (`record.system_prompt`) rather than sending an empty prompt.
pub(crate) fn assemble_system_prompt(loaded: &LoadedDocuments) -> Option<String> {
    let mut sections: Vec<String> = Vec::new();
    let mut total = 0usize;
    let mut omitted = false;
    for kind in DocumentKind::ASSEMBLY_SLOTS {
        let Some(body) = loaded
            .by_kind
            .get(&kind)
            .map(|body| body.trim())
            .filter(|body| !body.is_empty())
        else {
            continue;
        };
        if total >= ASSEMBLY_TOTAL_CAP {
            omitted = true;
            break;
        }
        let section = format!("{}\n{}", kind.assembly_header(), cap_section(body));
        total += section.len() + 2;
        sections.push(section);
    }
    if sections.is_empty() {
        return None;
    }
    let mut assembled = sections.join("\n\n");
    if omitted {
        assembled.push_str(ASSEMBLY_OMITTED_MARKER);
    }
    Some(assembled)
}

// ── Record integration ──────────────────────────────────────────────────────

/// Give `record` a folder, seeding only documents that are still absent, and
/// stamp `documents_dir` / `documents_hash` onto the record.
///
/// Called from the two paths that mint a record with a prompt already decided
/// — agent create and persona-snapshot import. The prompt becomes `soul.md`;
/// an unedited Luca, Vektor, or Anima built-in also receives the concise
/// product self-model derived from its approved built-in identity sentence.
/// A folder that already speaks for itself always outranks these defaults.
pub(crate) fn seed_initial_documents_if_absent(
    app: &AppHandle,
    record: &mut ManagedAgentRecord,
    prompt: Option<&str>,
) -> Result<(), String> {
    if validate_pubkey(&record.pubkey).is_err() {
        // Definitions carry no pubkey and therefore no folder.
        return Ok(());
    }
    let dir = ensure_resident_dir(app, &record.pubkey)?;
    if let Some(prompt) = prompt.filter(|value| !value.trim().is_empty()) {
        seed_document_if_absent(&dir, DocumentKind::Soul, prompt)?;
    }
    if let Some(self_model) = record.persona_id.as_deref().and_then(|persona_id| {
        crate::managed_agents::built_in_resident_self_model(persona_id, prompt)
    }) {
        seed_document_if_absent(&dir, DocumentKind::SelfModel, self_model)?;
    }
    record.documents_dir = Some(relative_dir(&record.pubkey));
    record.documents_hash = Some(documents_hash(&load(&dir)?));
    Ok(())
}

/// Seed one document during a resident folder's birth without replacing an
/// existing file. `create_new` makes absence the filesystem-enforced rule,
/// rather than a check followed by a potentially clobbering rename.
fn seed_document_if_absent(dir: &Path, kind: DocumentKind, content: &str) -> Result<bool, String> {
    let path = dir.join(kind.file_name());
    reject_symlink(&path)?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let mut file = match options.open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            reject_symlink(&path)?;
            return Ok(false);
        }
        Err(error) => return Err(format!("create {}: {error}", path.display())),
    };
    if let Err(error) = file.write_all(content.as_bytes()) {
        let _ = std::fs::remove_file(&path);
        return Err(format!("write {}: {error}", path.display()));
    }
    Ok(true)
}

/// Overwrite a slot document whatever is on disk, journalling the write.
///
/// The owner-side escape hatch from optimistic concurrency: an edit made
/// through `update_managed_agent` is the owner deciding, not an editor
/// racing, so there is no hash to reload against.
pub(crate) fn overwrite(
    dir: &Path,
    kind: DocumentKind,
    content: &str,
    writer: DocumentWriter,
) -> Result<(), String> {
    let expected = current_hash(&dir.join(kind.file_name()));
    write(
        dir,
        DocumentTarget::Kind { kind },
        content,
        expected.as_deref(),
        writer,
    )
    .map(|_| ())
    .map_err(String::from)
}

/// Mirror an owner edit of the pin (`record.system_prompt`) onto `soul.md`.
///
/// `update_managed_agent` keeps writing the pin — it is what a runtime with
/// no folder receives, and what the persona re-pin rule compares against — and
/// this carries the same intent into the folder: a new prompt becomes the
/// soul, and clearing the prompt removes it.
pub(crate) fn apply_pin_edit(
    app: &AppHandle,
    record: &mut ManagedAgentRecord,
    pin: Option<&str>,
) -> Result<(), String> {
    if !is_valid_pubkey(&record.pubkey) {
        return Ok(());
    }
    let dir = ensure_resident_dir(app, &record.pubkey)?;
    match pin {
        Some(prompt) => overwrite(&dir, DocumentKind::Soul, prompt, DocumentWriter::Owner)?,
        None => clear(&dir, DocumentKind::Soul)?,
    }
    refresh_documents_hash(app, record)?;
    Ok(())
}

/// Apply the re-pin rule for one record: ensure the folder, run
/// [`repin_soul_in_dir`], then re-stamp the hash.
pub(crate) fn repin_soul_for_record(
    app: &AppHandle,
    record: &mut ManagedAgentRecord,
    old_pin: Option<&str>,
) -> Result<(), String> {
    if !is_valid_pubkey(&record.pubkey) {
        return Ok(());
    }
    let dir = ensure_resident_dir(app, &record.pubkey)?;
    repin_soul_in_dir(&dir, record.system_prompt.as_deref(), old_pin)?;
    refresh_documents_hash(app, record)?;
    Ok(())
}

/// Recompute `documents_hash` from disk. Returns whether the record changed.
///
/// Called at spawn so the value the harness is told about is the folder that
/// is actually there, and after every desktop write.
pub(crate) fn refresh_documents_hash(
    app: &AppHandle,
    record: &mut ManagedAgentRecord,
) -> Result<bool, String> {
    if validate_pubkey(&record.pubkey).is_err() {
        return Ok(false);
    }
    let dir = resident_dir(app, &record.pubkey)?;
    if !dir.is_dir() {
        return Ok(false);
    }
    // A native resident's documents are the runtime's files; hash those, so
    // an edit there is what moves the badge.
    let hash = match native_layout_for(Some(record)) {
        Some(layout) => documents_hash(&native::load(&layout)?),
        None => documents_hash(&load(&dir)?),
    };
    let relative = relative_dir(&record.pubkey);
    let changed = record.documents_hash.as_deref() != Some(&hash) || record.documents_dir.is_none();
    record.documents_hash = Some(hash);
    record.documents_dir = Some(relative);
    Ok(changed)
}

/// Apply the re-pin rule to `soul.md` after a persona snapshot changed the
/// pin. See [`crate::managed_agents::persona_events::repin_soul`] for why the
/// rule is what it is; this is the disk half of it.
///
/// `old_pin` is the record's `system_prompt` *before* the snapshot applied.
pub(crate) fn repin_soul_in_dir(
    dir: &Path,
    new_pin: Option<&str>,
    old_pin: Option<&str>,
) -> Result<(), String> {
    let Some(new_pin) = new_pin.filter(|value| !value.trim().is_empty()) else {
        return Ok(());
    };
    let path = dir.join(DocumentKind::Soul.file_name());
    let existing = std::fs::read_to_string(&path).ok();
    // Missing soul → the folder has nothing to lose. Soul equal to the old
    // pin → nobody has edited it since it was seeded, so it is still a mirror
    // of the pin and should follow it. Anything else is an owner edit and is
    // left exactly as written.
    let owner_edited = existing
        .as_deref()
        .is_some_and(|body| Some(body) != old_pin);
    if owner_edited {
        return Ok(());
    }
    ensure_dir_at(dir)?;
    let expected = existing.as_deref().map(file_hash);
    write(
        dir,
        DocumentTarget::Kind {
            kind: DocumentKind::Soul,
        },
        new_pin,
        expected.as_deref(),
        DocumentWriter::Owner,
    )?;
    Ok(())
}
