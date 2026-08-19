//! Documents of a resident bound to a native runtime — read and written in
//! the runtime's own files, in place.
//!
//! An imported Hermes profile or OpenClaw agent already *has* a soul, an
//! identity, an owner model: they live where that runtime reads them, and the
//! runtime composes its own prompt from them. So for these residents the
//! Documents page is a window onto those files, not onto our folder — the
//! kinds map to the runtime's file names (shown as they are, `SOUL.md`), kinds
//! the runtime has no file for are said to be not part of it, and a write goes
//! to the runtime's file with that runtime's rules:
//!
//! - **Hermes** resolves symlinks before its own atomic replace so a profile
//!   symlinked into a dotfiles repo survives — we do the same, and we respect
//!   the `.lock` Hermes puts beside the memory files it writes concurrently.
//! - **OpenClaw** refuses to write through a symlink and writes atomically via
//!   rename — so do we.
//!
//! Every write is still journalled in the resident's own folder
//! (`residents/<pubkey>/writes.jsonl`), so "the desktop is the one writer" holds
//! for natives too, and `documents_hash` is computed over these files, so an
//! edit still surfaces as "needs restart" (both runtimes assemble their prompt
//! at session start).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::managed_agents::RuntimeBinding;

use super::{
    bytes_hash, documents_hash, file_hash, modified_seconds, now_seconds, DocumentContent,
    DocumentEntry, DocumentKind, DocumentTarget, DocumentWriter, DocumentsInspector,
    DocumentsSource, ExtraFile, ExtraFileEntry, LoadedDocuments, WriteError, WriteReceipt,
    MAX_DOCUMENT_BYTES, MAX_EXTRA_FILES, MAX_EXTRA_FILE_BYTES,
};

/// The on-disk shape of one native runtime's documents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum NativeLayout {
    /// A Hermes profile home (`~/.hermes` or `~/.hermes/profiles/<name>`).
    Hermes { home: PathBuf },
    /// An OpenClaw agent workspace.
    Openclaw { workspace: PathBuf },
}

impl NativeLayout {
    /// The layout a binding points at, or `None` when the binding does not
    /// tell us where the files are (then the folder is all we can show).
    pub(crate) fn from_binding(binding: &RuntimeBinding) -> Option<Self> {
        match binding {
            RuntimeBinding::Hermes { hermes_home, .. } => Some(NativeLayout::Hermes {
                home: hermes_home.clone(),
            }),
            RuntimeBinding::Openclaw {
                agent_id,
                state_directory,
                default_workspace,
                ..
            } => {
                let workspace = default_workspace.clone().or_else(|| {
                    // OpenClaw's own resolution: the default agent lives in
                    // `<state>/workspace`, every other agent in
                    // `<state>/workspace-<agentId>`.
                    let state = state_directory
                        .clone()
                        .or_else(|| dirs::home_dir().map(|home| home.join(".openclaw")))?;
                    Some(if agent_id == "main" {
                        state.join("workspace")
                    } else {
                        state.join(format!("workspace-{agent_id}"))
                    })
                })?;
                Some(NativeLayout::Openclaw { workspace })
            }
        }
    }

    /// "Hermes" / "OpenClaw" — for copy.
    pub(crate) fn runtime_label(&self) -> &'static str {
        match self {
            NativeLayout::Hermes { .. } => "Hermes",
            NativeLayout::Openclaw { .. } => "OpenClaw",
        }
    }

    /// The directory the documents live in.
    pub(crate) fn root(&self) -> &Path {
        match self {
            NativeLayout::Hermes { home } => home,
            NativeLayout::Openclaw { workspace } => workspace,
        }
    }

    /// The runtime's file for a kind, relative to [`Self::root`], or `None`
    /// when the runtime has no such document.
    ///
    /// Hermes: `SOUL.md` is slot one of its prompt; `memories/USER.md` is its
    /// owner model, written by the agent's memory tool; `IDENTITY.md` is a
    /// convention (five of seven profiles on the observed install carry one)
    /// that Hermes itself does not read — shown because it exists in the wild,
    /// with the honest name. Hermes has no home-scoped instructions file.
    /// OpenClaw: all four are first-class workspace files.
    pub(crate) fn file_for(&self, kind: DocumentKind) -> Option<&'static str> {
        match (self, kind) {
            (NativeLayout::Hermes { .. }, DocumentKind::Soul) => Some("SOUL.md"),
            (NativeLayout::Hermes { .. }, DocumentKind::SelfModel) => Some("IDENTITY.md"),
            (NativeLayout::Hermes { .. }, DocumentKind::UserModel) => Some("memories/USER.md"),
            (NativeLayout::Openclaw { .. }, DocumentKind::Soul) => Some("SOUL.md"),
            (NativeLayout::Openclaw { .. }, DocumentKind::SelfModel) => Some("IDENTITY.md"),
            (NativeLayout::Openclaw { .. }, DocumentKind::UserModel) => Some("USER.md"),
            (NativeLayout::Openclaw { .. }, DocumentKind::Instructions) => Some("AGENTS.md"),
            _ => None,
        }
    }

    /// Where the runtime keeps its dated/curated memory files, relative to root;
    /// listed as extra files so they can be read raw.
    fn memory_dir(&self) -> &'static str {
        match self {
            NativeLayout::Hermes { .. } => "memories",
            NativeLayout::Openclaw { .. } => "memory",
        }
    }

    /// Hermes preserves symlinks (writes through to the target); OpenClaw
    /// refuses them.
    fn preserves_symlinks(&self) -> bool {
        matches!(self, NativeLayout::Hermes { .. })
    }
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
}

/// Resolve a target to a path under the layout root. Kinds the runtime has no
/// file for are refused by name; free paths must be relative, non-hidden,
/// non-traversing markdown.
fn resolve_target(
    layout: &NativeLayout,
    target: &DocumentTarget,
) -> Result<(PathBuf, usize), String> {
    match target {
        DocumentTarget::Kind { kind } => layout
            .file_for(*kind)
            .map(|rel| (layout.root().join(rel), MAX_DOCUMENT_BYTES))
            .ok_or_else(|| {
                format!(
                    "{} has no {} document",
                    layout.runtime_label(),
                    kind.label().to_ascii_lowercase()
                )
            }),
        DocumentTarget::RelPath { rel_path } => {
            let trimmed = rel_path.trim();
            if trimmed.is_empty() {
                return Err("empty document path".to_owned());
            }
            let candidate = Path::new(trimmed);
            if candidate.is_absolute() {
                return Err("document path must be relative".to_owned());
            }
            let mut resolved = layout.root().to_path_buf();
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
            if !is_markdown(&resolved) {
                return Err(format!(
                    "only markdown files of a {} {} are editable here",
                    layout.runtime_label(),
                    match layout {
                        NativeLayout::Hermes { .. } => "profile",
                        NativeLayout::Openclaw { .. } => "workspace",
                    }
                ));
            }
            Ok((resolved, MAX_EXTRA_FILE_BYTES))
        }
    }
}

/// Everything readable in the runtime's directory: mapped kinds that exist,
/// plus the other markdown files (top level and the memory directory).
pub(crate) fn load(layout: &NativeLayout) -> Result<LoadedDocuments, String> {
    let root = layout.root();
    if !root.is_dir() {
        return Ok(LoadedDocuments::default());
    }
    let mut by_kind = BTreeMap::new();
    let mut mapped: Vec<PathBuf> = Vec::new();
    for kind in DocumentKind::ALL {
        let Some(rel) = layout.file_for(kind) else {
            continue;
        };
        let path = root.join(rel);
        mapped.push(path.clone());
        if let Ok(body) = std::fs::read_to_string(&path) {
            by_kind.insert(kind, body);
        }
    }
    let mut extra = Vec::new();
    let mut push_dir = |dir: &Path, prefix: &str| {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            if extra.len() >= MAX_EXTRA_FILES {
                break;
            }
            let path = entry.path();
            let Ok(metadata) = std::fs::metadata(&path) else {
                continue;
            };
            if !metadata.is_file() || !is_markdown(&path) || mapped.contains(&path) {
                continue;
            }
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if name.starts_with('.') {
                continue;
            }
            let Ok(bytes) = std::fs::read(&path) else {
                continue;
            };
            extra.push(ExtraFile {
                rel_path: format!("{prefix}{name}"),
                bytes: metadata.len(),
                modified_at: modified_seconds(&metadata),
                content_hash: bytes_hash(&bytes),
            });
        }
    };
    push_dir(root, "");
    let memory = root.join(layout.memory_dir());
    push_dir(&memory, &format!("{}/", layout.memory_dir()));
    extra.sort_by(|left, right| left.rel_path.cmp(&right.rel_path));
    Ok(LoadedDocuments { by_kind, extra })
}

/// Project the runtime's documents for the frontend. Kinds the runtime has no
/// file for are simply absent from `documents`; the page says so.
pub(crate) fn inspect(layout: &NativeLayout, pubkey: &str) -> Result<DocumentsInspector, String> {
    let loaded = load(layout)?;
    let root = layout.root();
    let documents = DocumentKind::ALL
        .into_iter()
        .filter_map(|kind| {
            let rel = layout.file_for(kind)?;
            let metadata = std::fs::metadata(root.join(rel)).ok();
            Some(DocumentEntry {
                kind,
                file_name: rel.to_owned(),
                writer: kind.writer(),
                exists: metadata.is_some(),
                bytes: metadata.as_ref().map(std::fs::Metadata::len).unwrap_or(0),
                modified_at: metadata.as_ref().map(modified_seconds),
            })
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
        dir: root.display().to_string(),
        source: DocumentsSource::Native,
        native_runtime: Some(layout.runtime_label().to_owned()),
        documents,
        extra_files,
        hash: documents_hash(&loaded),
    })
}

/// Read one of the runtime's documents.
pub(crate) fn read(
    layout: &NativeLayout,
    target: DocumentTarget,
) -> Result<DocumentContent, String> {
    let (path, _) = resolve_target(layout, &target)?;
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
    let content = std::fs::read_to_string(&path)
        .map_err(|error| format!("read {}: {error}", path.display()))?;
    Ok(DocumentContent {
        hash: Some(file_hash(&content)),
        modified_at: Some(modified_seconds(&metadata)),
        exists: true,
        content,
        target,
    })
}

/// The path a write should land on, under the runtime's symlink rule.
fn write_destination(layout: &NativeLayout, path: &Path) -> Result<PathBuf, String> {
    let Ok(link_metadata) = std::fs::symlink_metadata(path) else {
        return Ok(path.to_path_buf()); // new file
    };
    if !link_metadata.file_type().is_symlink() {
        return Ok(path.to_path_buf());
    }
    if !layout.preserves_symlinks() {
        return Err(format!(
            "{} refuses writes through a symlink ({}); edit the target file directly",
            layout.runtime_label(),
            path.display()
        ));
    }
    let target = std::fs::canonicalize(path)
        .map_err(|error| format!("resolve symlink {}: {error}", path.display()))?;
    if !target.is_file() {
        return Err(format!("{} does not point at a file", path.display()));
    }
    Ok(target)
}

/// Write one of the runtime's documents in place, atomically, keeping the
/// file's existing permission bits, honouring the runtime's symlink rule and
/// its `.lock` sidecar, and journalling the write in the resident's own folder.
pub(crate) fn write(
    layout: &NativeLayout,
    journal_dir: &Path,
    target: DocumentTarget,
    content: &str,
    expected_hash: Option<&str>,
    writer: DocumentWriter,
) -> Result<WriteReceipt, WriteError> {
    let (path, max_bytes) = resolve_target(layout, &target).map_err(WriteError::Rejected)?;
    if content.len() > max_bytes {
        return Err(WriteError::Rejected(format!(
            "document exceeds the {max_bytes}-byte limit"
        )));
    }
    let destination = write_destination(layout, &path).map_err(WriteError::Rejected)?;
    let lock = destination.with_extension(
        destination
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| format!("{ext}.lock"))
            .unwrap_or_else(|| "lock".to_owned()),
    );
    if lock.exists() {
        return Err(WriteError::Rejected(format!(
            "{} is writing this file right now — try again in a moment",
            layout.runtime_label()
        )));
    }
    let on_disk = super::current_hash(&destination);
    match (expected_hash, on_disk.as_deref()) {
        (None, None) => {}
        (Some(expected), Some(actual)) if expected == actual => {}
        _ => {
            return Err(WriteError::Conflict {
                current_hash: on_disk,
            })
        }
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            WriteError::Rejected(format!("create {}: {error}", parent.display()))
        })?;
    }
    atomic_write_preserving_mode(&destination, content.as_bytes()).map_err(WriteError::Rejected)?;

    let hash = file_hash(content);
    let bytes = content.len() as u64;
    let modified_at = std::fs::metadata(&destination)
        .map(|metadata| modified_seconds(&metadata))
        .unwrap_or_else(|_| now_seconds());
    super::append_journal(
        journal_dir,
        &target,
        writer,
        bytes,
        &hash,
        Some(&destination),
    );
    let loaded = load(layout).map_err(WriteError::Rejected)?;
    Ok(WriteReceipt {
        target,
        hash,
        documents_hash: documents_hash(&loaded),
        bytes,
        modified_at,
    })
}

/// Temp-then-rename write that keeps the existing file's mode (these are the
/// runtime's files, not ours to tighten); a new file gets `0o644`, the mode
/// both runtimes create their documents with.
fn atomic_write_preserving_mode(path: &Path, payload: &[u8]) -> Result<(), String> {
    use atomic_write_file::AtomicWriteFile;
    use std::io::Write as _;

    let mut file = AtomicWriteFile::open(path)
        .map_err(|error| format!("open {} for atomic write: {error}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let mode = std::fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o777)
            .unwrap_or(0o644);
        file.set_permissions(std::fs::Permissions::from_mode(mode))
            .map_err(|error| format!("set {} permissions: {error}", path.display()))?;
    }
    file.write_all(payload)
        .map_err(|error| format!("write {}: {error}", path.display()))?;
    file.commit()
        .map_err(|error| format!("commit {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::managed_agents::RuntimeBinding;

    fn hermes(home: &Path) -> RuntimeBinding {
        RuntimeBinding::Hermes {
            schema_version: 1,
            profile_name: "field".into(),
            hermes_home: home.to_path_buf(),
            executable_path: home.join("bin/hermes"),
            runtime_version: "1.9.0".into(),
            default_workspace: None,
        }
    }

    #[test]
    fn hermes_kinds_map_to_the_profile_files_and_unmapped_kinds_are_absent() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("SOUL.md"), "I am field.\n").unwrap();
        std::fs::create_dir_all(dir.path().join("memories")).unwrap();
        std::fs::write(dir.path().join("memories/USER.md"), "Riley: night owl.\n").unwrap();
        std::fs::write(dir.path().join("memories/MEMORY.md"), "§ facts\n").unwrap();
        std::fs::write(dir.path().join("OPERATIONS.md"), "ops\n").unwrap();
        std::fs::write(dir.path().join(".env"), "SECRET=1\n").unwrap();
        let layout = NativeLayout::from_binding(&hermes(dir.path())).unwrap();
        let inspector = inspect(&layout, &"ab".repeat(32)).unwrap();
        assert_eq!(inspector.source, DocumentsSource::Native);
        assert_eq!(inspector.native_runtime.as_deref(), Some("Hermes"));
        let kinds: Vec<_> = inspector
            .documents
            .iter()
            .map(|d| (d.kind, d.file_name.clone(), d.exists))
            .collect();
        assert_eq!(
            kinds,
            vec![
                (DocumentKind::Soul, "SOUL.md".to_owned(), true),
                (DocumentKind::SelfModel, "IDENTITY.md".to_owned(), false),
                (DocumentKind::UserModel, "memories/USER.md".to_owned(), true),
            ]
        );
        let extras: Vec<_> = inspector
            .extra_files
            .iter()
            .map(|e| e.rel_path.clone())
            .collect();
        assert_eq!(
            extras,
            vec!["OPERATIONS.md", "memories/MEMORY.md"],
            "markdown only, no dotfiles"
        );
    }

    #[test]
    fn a_kind_the_runtime_lacks_is_refused_by_name() {
        let dir = tempfile::tempdir().unwrap();
        let layout = NativeLayout::from_binding(&hermes(dir.path())).unwrap();
        let error = read(
            &layout,
            DocumentTarget::Kind {
                kind: DocumentKind::Instructions,
            },
        )
        .unwrap_err();
        assert!(
            error.contains("Hermes has no instructions document"),
            "{error}"
        );
    }

    #[test]
    fn hermes_writes_through_a_symlink_and_keeps_the_link() {
        let dir = tempfile::tempdir().unwrap();
        let dotfiles = tempfile::tempdir().unwrap();
        let real = dotfiles.path().join("SOUL.md");
        std::fs::write(&real, "old\n").unwrap();
        std::os::unix::fs::symlink(&real, dir.path().join("SOUL.md")).unwrap();
        let journal = tempfile::tempdir().unwrap();
        let layout = NativeLayout::from_binding(&hermes(dir.path())).unwrap();
        let loaded = read(
            &layout,
            DocumentTarget::Kind {
                kind: DocumentKind::Soul,
            },
        )
        .unwrap();
        write(
            &layout,
            journal.path(),
            DocumentTarget::Kind {
                kind: DocumentKind::Soul,
            },
            "new\n",
            loaded.hash.as_deref(),
            DocumentWriter::Owner,
        )
        .unwrap();
        assert!(
            std::fs::symlink_metadata(dir.path().join("SOUL.md"))
                .unwrap()
                .file_type()
                .is_symlink(),
            "the link survives"
        );
        assert_eq!(
            std::fs::read_to_string(&real).unwrap(),
            "new\n",
            "the target changed"
        );
        assert!(
            journal.path().join("writes.jsonl").exists(),
            "journalled in our folder"
        );
    }

    #[test]
    fn a_hermes_lock_beside_the_file_refuses_the_write() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("memories")).unwrap();
        std::fs::write(dir.path().join("memories/USER.md"), "x\n").unwrap();
        std::fs::write(dir.path().join("memories/USER.md.lock"), "").unwrap();
        let journal = tempfile::tempdir().unwrap();
        let layout = NativeLayout::from_binding(&hermes(dir.path())).unwrap();
        let error = write(
            &layout,
            journal.path(),
            DocumentTarget::Kind {
                kind: DocumentKind::UserModel,
            },
            "y\n",
            Some(&file_hash("x\n")),
            DocumentWriter::Owner,
        )
        .unwrap_err();
        assert!(
            error.to_string().contains("writing this file right now"),
            "{error}"
        );
    }

    #[test]
    fn openclaw_refuses_symlinks_and_resolves_the_workspace_from_state() {
        let state = tempfile::tempdir().unwrap();
        let binding = RuntimeBinding::Openclaw {
            schema_version: 1,
            agent_id: "research".into(),
            executable_path: state.path().join("openclaw"),
            runtime_version: "2026.8.1".into(),
            gateway_identity: "g".into(),
            gateway_url_ref: crate::managed_agents::SecretRef {
                provider: crate::managed_agents::SecretRefProvider::NativeStore,
                locator: "openclaw.gateway.url".into(),
                identity_hash: None,
            },
            gateway_token_file_ref: None,
            gateway_password_file_ref: None,
            open_claw_profile: None,
            state_directory: Some(state.path().to_path_buf()),
            default_workspace: None,
        };
        let layout = NativeLayout::from_binding(&binding).unwrap();
        assert_eq!(layout.root(), state.path().join("workspace-research"));
        std::fs::create_dir_all(layout.root()).unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        std::fs::write(elsewhere.path().join("AGENTS.md"), "a\n").unwrap();
        std::os::unix::fs::symlink(
            elsewhere.path().join("AGENTS.md"),
            layout.root().join("AGENTS.md"),
        )
        .unwrap();
        let journal = tempfile::tempdir().unwrap();
        let error = write(
            &layout,
            journal.path(),
            DocumentTarget::Kind {
                kind: DocumentKind::Instructions,
            },
            "b\n",
            Some(&file_hash("a\n")),
            DocumentWriter::Owner,
        )
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("refuses writes through a symlink"),
            "{error}"
        );
    }

    #[test]
    fn a_native_write_keeps_the_files_existing_mode() {
        use std::os::unix::fs::PermissionsExt as _;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("SOUL.md");
        std::fs::write(&path, "old\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o664)).unwrap();
        let journal = tempfile::tempdir().unwrap();
        let layout = NativeLayout::from_binding(&hermes(dir.path())).unwrap();
        write(
            &layout,
            journal.path(),
            DocumentTarget::Kind {
                kind: DocumentKind::Soul,
            },
            "new\n",
            Some(&file_hash("old\n")),
            DocumentWriter::Owner,
        )
        .unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o664
        );
    }
}
