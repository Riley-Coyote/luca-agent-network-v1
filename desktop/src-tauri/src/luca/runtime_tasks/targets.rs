//! Exact, local-only target resolution over an already-authorized source.
//!
//! A context attachment, transcript title, or native UUID supplied by a model is
//! not action authority. The caller checks owner, resident, native lookup
//! authority or connected-source grants, and explicit action consent before
//! entering this capsule and again at dispatch.

use std::{
    collections::{HashSet, VecDeque},
    fs::{self, File, Metadata},
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
    time::{Duration, Instant, SystemTime},
};

use luca_protocol::{ConnectedBrainSourceKindV1, ConnectedBrainSourceStatusV1, OpaqueId};
use serde::Deserialize;
use uuid::Uuid;

use super::super::connected_brain::{native_session_opaque_id, native_session_reference};

const MAX_LOOKUP_ENTRIES: usize = 40_000;
const MAX_LOOKUP_DEPTH: usize = 8;
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_METADATA_BYTES: usize = 256 * 1024;
const MAX_METADATA_LINES: usize = 64;
const MAX_LOCATOR_BYTES: usize = 4096;
const MAX_LISTED_TARGETS: usize = 50;
const MAX_WORKSPACE_LABEL_CHARS: usize = 96;

/// A current source snapshot supplied by the host after its authority checks.
/// Native profiles use short-lived local lookup permission, never Brain recall.
#[derive(Clone)]
pub(super) struct RuntimeTaskTargetSourceV1 {
    pub source_id: OpaqueId,
    pub source_kind: ConnectedBrainSourceKindV1,
    pub canonical_root: PathBuf,
    pub status: ConnectedBrainSourceStatusV1,
}

/// Origin metadata is a routing restriction, not proof of live availability.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CodexSessionOriginV1 {
    NativeApp,
    SavedCli,
    Unknown,
}

/// Sensitive target handle. Do not serialize this type into renderer events,
/// conversation messages, logs, or a provider prompt.
#[derive(Clone)]
pub(super) struct RuntimeTaskExistingTargetV1 {
    pub runtime_family: String,
    pub provider_session_id: Uuid,
    pub canonical_working_folder: PathBuf,
    pub source_id: OpaqueId,
    pub session_ref: OpaqueId,
    pub label: String,
    pub updated_at: Option<String>,
    pub codex_origin: Option<CodexSessionOriginV1>,
    /// Saved native policy, read only from metadata in this exact root file.
    pub claude_permission_mode: Option<String>,
    relative_locator: String,
    canonical_source_root: PathBuf,
}

/// Body-free selection candidate. The host may project these fields after its
/// grant checks, but catalogue access alone never authorizes an action.
pub(super) struct RuntimeTaskTargetCandidateV1 {
    pub session_ref: OpaqueId,
    pub label: String,
    pub workspace_basename: String,
    pub updated_at: Option<String>,
    pub codex_origin: Option<CodexSessionOriginV1>,
    pub claude_can_continue: bool,
}

/// A bounded catalogue whose incomplete result must remain visible to callers.
pub(super) struct RuntimeTaskTargetListV1 {
    pub candidates: Vec<RuntimeTaskTargetCandidateV1>,
    pub truncated: bool,
}

impl RuntimeTaskExistingTargetV1 {
    /// Require the native-app origin proved for the public queue. The caller
    /// must separately probe the exact executable's version and queue help.
    pub(super) fn require_codex_app_queue(&self) -> Result<(), String> {
        if self.runtime_family != "codex"
            || self.codex_origin != Some(CodexSessionOriginV1::NativeApp)
        {
            return Err("The selected session is not a verified Codex app target.".into());
        }
        Ok(())
    }

    /// Do not substitute CLI resume for a session owned by the native app.
    /// Explicit saved-session consent and live-session exclusion are additional
    /// caller-owned gates; an old transcript is not proof that work is idle.
    pub(super) fn require_saved_codex_cli(&self) -> Result<(), String> {
        if self.runtime_family != "codex"
            || self.codex_origin != Some(CodexSessionOriginV1::SavedCli)
        {
            return Err("Continuation requires the explicitly selected saved Codex CLI session; app or unknown sessions cannot be substituted.".into());
        }
        Ok(())
    }

    /// Claude restoration is eligible only with known original native policy.
    /// Availability must still be rechecked through `claude agents --json`.
    pub(super) fn require_saved_claude(&self) -> Result<(), String> {
        if self.runtime_family != "claude_code" || self.claude_permission_mode.is_none() {
            return Err("The selected Claude session has no verified native permission policy; review it in Claude Code instead of guessing a policy.".into());
        }
        Ok(())
    }
}

/// Resolve only the explicit opaque selection, without reading unrelated
/// transcript bodies, title matching, or choosing a recent/latest session.
pub(super) fn resolve_connected_session_target(
    source: &RuntimeTaskTargetSourceV1,
    session_ref: &OpaqueId,
    runtime_family: &str,
    requested_folder: Option<&Path>,
    excluded: &HashSet<String>,
) -> Result<RuntimeTaskExistingTargetV1, String> {
    validate_source(source, runtime_family)?;
    let relative_locator = find_selected_locator(
        source,
        session_ref,
        Instant::now() + LOOKUP_TIMEOUT,
        MAX_LOOKUP_ENTRIES,
        MAX_LOOKUP_DEPTH,
    )?;
    resolve_locator(
        source,
        session_ref,
        &relative_locator,
        runtime_family,
        requested_folder,
        excluded,
    )
}

/// List metadata-only choices for one explicitly authorized source. File
/// modification metadata is sorted before limiting; only those bounded chosen
/// prefixes are resolved. This is not a "latest session" dispatch operation.
pub(super) fn list_connected_session_targets(
    source: &RuntimeTaskTargetSourceV1,
    runtime_family: &str,
    excluded: &HashSet<String>,
    limit: usize,
) -> Result<RuntimeTaskTargetListV1, String> {
    if !(1..=MAX_LISTED_TARGETS).contains(&limit) {
        return Err("Session target listing requires a limit from 1 to 50.".into());
    }
    validate_source(source, runtime_family)?;
    let mut files = Vec::new();
    let deadline = Instant::now() + LOOKUP_TIMEOUT;
    let outcome = visit_session_filenames(
        source,
        deadline,
        MAX_LOOKUP_ENTRIES,
        MAX_LOOKUP_DEPTH,
        |path, locator| {
            let Some(id) = filename_session_uuid(path, source.source_kind) else {
                return Ok(false);
            };
            if excluded.contains(&id.hyphenated().to_string()) {
                return Ok(false);
            }
            let metadata = fs::symlink_metadata(path)
                .map_err(|_| "The connected session catalogue changed while listing.".to_owned())?;
            if metadata.is_file() {
                files.push(TargetFileMetadataV1 {
                    relative_locator: locator.to_owned(),
                    modified: metadata.modified().ok(),
                });
            }
            Ok(false)
        },
    )?;
    files.sort_by(|left, right| {
        right
            .modified
            .cmp(&left.modified)
            .then_with(|| left.relative_locator.cmp(&right.relative_locator))
    });
    let mut truncated = !matches!(outcome, FilenameWalkOutcomeV1::Complete) || files.len() > limit;
    let mut candidates = Vec::with_capacity(files.len().min(limit));
    for file in files.into_iter().take(limit) {
        if Instant::now() >= deadline {
            truncated = true;
            break;
        }
        let session_ref = native_session_opaque_id(&source.source_id, &file.relative_locator)?;
        let Ok(target) = resolve_locator(
            source,
            &session_ref,
            &file.relative_locator,
            runtime_family,
            None,
            excluded,
        ) else {
            // A malformed, changed, internal, or inaccessible file is not a
            // candidate. Do not scan progressively older transcript bodies to
            // fill a successful-looking list after the read limit is reached.
            continue;
        };
        let basename = target
            .canonical_working_folder
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or("The native session workspace label is unavailable.")?;
        let mut workspace_basename = basename
            .chars()
            .take(MAX_WORKSPACE_LABEL_CHARS)
            .collect::<String>();
        if basename.chars().count() > MAX_WORKSPACE_LABEL_CHARS {
            workspace_basename.pop();
            workspace_basename.push('…');
        }
        candidates.push(RuntimeTaskTargetCandidateV1 {
            session_ref: target.session_ref,
            label: target.label,
            workspace_basename,
            updated_at: target.updated_at,
            codex_origin: target.codex_origin,
            claude_can_continue: target.claude_permission_mode.is_some(),
        });
    }
    Ok(RuntimeTaskTargetListV1 {
        candidates,
        truncated,
    })
}

/// Recheck the exact known file after owner confirmation. A source rebind,
/// provider/identity change, or different real folder invalidates the handle;
/// ordinary transcript appends between checks need not invalidate it.
pub(super) fn revalidate_connected_session_target(
    source: &RuntimeTaskTargetSourceV1,
    target: &RuntimeTaskExistingTargetV1,
    requested_folder: Option<&Path>,
    excluded: &HashSet<String>,
) -> Result<RuntimeTaskExistingTargetV1, String> {
    if source.source_id != target.source_id || source.canonical_root != target.canonical_source_root
    {
        return Err(
            "The selected connected source changed; select the exact session again.".into(),
        );
    }
    let current = resolve_locator(
        source,
        &target.session_ref,
        &target.relative_locator,
        &target.runtime_family,
        requested_folder,
        excluded,
    )?;
    if current.provider_session_id != target.provider_session_id
        || current.canonical_working_folder != target.canonical_working_folder
        || current.codex_origin != target.codex_origin
        || current.claude_permission_mode != target.claude_permission_mode
    {
        return Err("The selected native session identity or working folder changed; confirmation is no longer valid.".into());
    }
    Ok(current)
}

fn runtime_for_kind(kind: ConnectedBrainSourceKindV1) -> Result<&'static str, String> {
    match kind {
        ConnectedBrainSourceKindV1::CodexHistory => Ok("codex"),
        ConnectedBrainSourceKindV1::ClaudeHistory => Ok("claude_code"),
        ConnectedBrainSourceKindV1::Repository => {
            Err("Choose a connected native session source, not a repository.".into())
        }
    }
}

fn validate_source(source: &RuntimeTaskTargetSourceV1, runtime_family: &str) -> Result<(), String> {
    if source.status != ConnectedBrainSourceStatusV1::Current {
        return Err("The selected session source is stale, unavailable, or disconnected.".into());
    }
    let expected_runtime = runtime_for_kind(source.source_kind)?;
    let requested_runtime = match runtime_family {
        "claude" => "claude_code",
        value => value,
    };
    if requested_runtime != expected_runtime {
        return Err(
            "The selected session belongs to a different runtime; no substitution is allowed."
                .into(),
        );
    }
    validate_source_root(&source.canonical_root)
}

fn validate_source_root(root: &Path) -> Result<(), String> {
    if !root.is_absolute()
        || root.parent().is_none()
        || root.canonicalize().ok().as_deref() != Some(root)
        || !root.is_dir()
    {
        return Err("The connected session source moved or is unavailable.".into());
    }
    Ok(())
}

fn find_selected_locator(
    source: &RuntimeTaskTargetSourceV1,
    selected: &OpaqueId,
    deadline: Instant,
    max_entries: usize,
    max_depth: usize,
) -> Result<String, String> {
    let mut selected_locator = None;
    let outcome = visit_session_filenames(
        source,
        deadline,
        max_entries,
        max_depth,
        |_path, locator| {
            if native_session_opaque_id(&source.source_id, locator)? == *selected {
                selected_locator = Some(locator.to_owned());
                Ok(true)
            } else {
                Ok(false)
            }
        },
    )?;
    match (outcome, selected_locator) {
        (FilenameWalkOutcomeV1::Selected, Some(locator)) => Ok(locator),
        (FilenameWalkOutcomeV1::Timeout, _) => {
            Err("Exact session lookup timed out; no task was dispatched.".into())
        }
        (FilenameWalkOutcomeV1::EntryBound, _) => {
            Err("Exact session lookup exceeded its bounded metadata budget.".into())
        }
        (FilenameWalkOutcomeV1::DepthBound, _) => {
            Err("Exact session lookup exceeded its directory-depth bound.".into())
        }
        _ => Err("The exact selected session is missing, excluded, or no longer connected.".into()),
    }
}

struct TargetFileMetadataV1 {
    relative_locator: String,
    modified: Option<SystemTime>,
}

enum FilenameWalkOutcomeV1 {
    Complete,
    Selected,
    Timeout,
    EntryBound,
    DepthBound,
}

fn visit_session_filenames(
    source: &RuntimeTaskTargetSourceV1,
    deadline: Instant,
    max_entries: usize,
    max_depth: usize,
    mut visitor: impl FnMut(&Path, &str) -> Result<bool, String>,
) -> Result<FilenameWalkOutcomeV1, String> {
    let mut queue = VecDeque::from([(source.canonical_root.clone(), 0_usize)]);
    let mut visited = 0_usize;
    while let Some((directory, depth)) = queue.pop_front() {
        if Instant::now() >= deadline {
            return Ok(FilenameWalkOutcomeV1::Timeout);
        }
        let entries = fs::read_dir(directory)
            .map_err(|_| "The selected session source cannot be read completely.".to_owned())?;
        for entry in entries {
            if Instant::now() >= deadline {
                return Ok(FilenameWalkOutcomeV1::Timeout);
            }
            if visited >= max_entries {
                return Ok(FilenameWalkOutcomeV1::EntryBound);
            }
            visited += 1;
            let entry = entry
                .map_err(|_| "The selected session source cannot be read completely.".to_owned())?;
            let file_type = entry
                .file_type()
                .map_err(|_| "The selected session source changed during lookup.".to_owned())?;
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                if source.source_kind == ConnectedBrainSourceKindV1::ClaudeHistory
                    && entry.file_name() == "subagents"
                {
                    continue;
                }
                if depth >= max_depth {
                    return Ok(FilenameWalkOutcomeV1::DepthBound);
                }
                queue.push_back((path, depth + 1));
            } else if file_type.is_file()
                && path.extension().and_then(|value| value.to_str()) == Some("jsonl")
            {
                let locator = path
                    .strip_prefix(&source.canonical_root)
                    .ok()
                    .and_then(Path::to_str)
                    .ok_or("The selected session has an invalid source locator.")?
                    .replace('\\', "/");
                if visitor(&path, &locator)? {
                    return Ok(FilenameWalkOutcomeV1::Selected);
                }
            }
        }
    }
    Ok(FilenameWalkOutcomeV1::Complete)
}

fn filename_session_uuid(path: &Path, kind: ConnectedBrainSourceKindV1) -> Option<Uuid> {
    let stem = path.file_stem()?.to_str()?;
    let native_id = stem.get(stem.len().checked_sub(36)?..)?;
    let id = exact_uuid(native_id).ok()?;
    if kind == ConnectedBrainSourceKindV1::ClaudeHistory && stem != native_id {
        return None;
    }
    Some(id)
}

fn checked_session_path(
    source: &RuntimeTaskTargetSourceV1,
    locator: &str,
) -> Result<PathBuf, String> {
    validate_source_root(&source.canonical_root)?;
    let relative = Path::new(locator);
    if locator.is_empty()
        || locator.len() > MAX_LOCATOR_BYTES
        || locator.contains('\\')
        || locator.chars().any(char::is_control)
        || relative.is_absolute()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("The selected session locator is unsafe.".into());
    }
    let mut path = source.canonical_root.clone();
    for part in relative.components() {
        if source.source_kind == ConnectedBrainSourceKindV1::ClaudeHistory
            && part.as_os_str() == "subagents"
        {
            return Err("Internal and subagent sessions cannot be delegated to.".into());
        }
        path.push(part);
        let metadata = fs::symlink_metadata(&path)
            .map_err(|_| "The exact selected session is unavailable.".to_owned())?;
        if metadata.file_type().is_symlink() {
            return Err(
                "The selected session locator follows a symlink; no task was dispatched.".into(),
            );
        }
    }
    if path.canonicalize().ok().as_deref() != Some(path.as_path())
        || !fs::symlink_metadata(&path)
            .map_err(|_| "The exact selected session is unavailable.".to_owned())?
            .is_file()
    {
        return Err("The selected session escaped or changed its connected source.".into());
    }
    Ok(path)
}

fn exact_uuid(value: &str) -> Result<Uuid, String> {
    let id = Uuid::parse_str(value)
        .map_err(|_| "The selected session has malformed native UUID metadata.".to_owned())?;
    if id.is_nil() || id.hyphenated().to_string() != value {
        return Err("The selected session has noncanonical native UUID metadata.".into());
    }
    Ok(id)
}

fn canonical_folder(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if value.is_empty()
        || value.len() > MAX_LOCATOR_BYTES
        || value.chars().any(char::is_control)
        || !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("The native session has missing or ambiguous working-folder metadata.".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "The native session working folder moved or is unavailable.".to_owned())?;
    if !canonical.is_dir() || canonical.parent().is_none() {
        return Err("The native session does not identify a specific working folder.".into());
    }
    Ok(canonical)
}

fn resolve_locator(
    source: &RuntimeTaskTargetSourceV1,
    session_ref: &OpaqueId,
    relative_locator: &str,
    runtime_family: &str,
    requested_folder: Option<&Path>,
    excluded: &HashSet<String>,
) -> Result<RuntimeTaskExistingTargetV1, String> {
    validate_source(source, runtime_family)?;
    let path = checked_session_path(source, relative_locator)?;
    let reference = native_session_reference(
        &source.canonical_root,
        source.source_kind,
        &source.source_id,
        session_ref,
        relative_locator,
        excluded,
    )
    .map_err(|_| "The exact selected session is missing, excluded, or invalid.".to_owned())?;
    let expected_runtime = runtime_for_kind(source.source_kind)?;
    if reference
        .get("provider")
        .and_then(serde_json::Value::as_str)
        != Some(expected_runtime)
        || reference
            .get("transcript_path")
            .and_then(serde_json::Value::as_str)
            != path.to_str()
    {
        return Err(
            "The selected native session reference changed or has the wrong provider.".into(),
        );
    }
    let native_id = exact_uuid(
        reference
            .get("session_id")
            .and_then(serde_json::Value::as_str)
            .ok_or("The selected session has no native UUID.")?,
    )?;
    if source.source_kind == ConnectedBrainSourceKindV1::ClaudeHistory
        && path.file_stem().and_then(|value| value.to_str())
            != Some(native_id.hyphenated().to_string().as_str())
    {
        return Err("The selected Claude session filename is ambiguous.".into());
    }

    let before = fs::symlink_metadata(&path)
        .map_err(|_| "The exact selected session is unavailable.".to_owned())?;
    let file = File::open(&path)
        .map_err(|_| "The exact selected session metadata is unavailable.".to_owned())?;
    if !same_file_snapshot(
        &before,
        &file
            .metadata()
            .map_err(|_| "Session metadata unavailable")?,
    ) {
        return Err("The selected session metadata changed before it could be read.".into());
    }
    let mut reader = BufReader::with_capacity(4096, file);
    let metadata = match source.source_kind {
        ConnectedBrainSourceKindV1::CodexHistory => read_codex_metadata(&mut reader, native_id)?,
        ConnectedBrainSourceKindV1::ClaudeHistory => read_claude_metadata(&mut reader, native_id)?,
        ConnectedBrainSourceKindV1::Repository => return Err("Not a native session source".into()),
    };
    let claude_permission_mode = if source.source_kind == ConnectedBrainSourceKindV1::ClaudeHistory
    {
        read_claude_policy_tail(&mut reader, native_id, &metadata.cwd)?
    } else {
        None
    };
    if checked_session_path(source, relative_locator)? != path {
        return Err("The selected session source changed while reading metadata.".into());
    }
    let after = reader
        .get_ref()
        .metadata()
        .map_err(|_| "The selected session metadata became unavailable.".to_owned())?;
    let after_path = fs::symlink_metadata(&path)
        .map_err(|_| "The selected session metadata became unavailable.".to_owned())?;
    if !same_file_snapshot(&before, &after) || !same_file_snapshot(&after, &after_path) {
        return Err("The selected session metadata changed while it was being read; no task was dispatched.".into());
    }
    if let Some(requested) = requested_folder {
        let requested = requested
            .to_str()
            .ok_or("The requested working folder is invalid.")?;
        if canonical_folder(requested)? != metadata.cwd {
            return Err("The requested working folder differs from the native session; select the intended session or clarify the project.".into());
        }
    }
    let short_id = native_id
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>();
    Ok(RuntimeTaskExistingTargetV1 {
        runtime_family: expected_runtime.to_owned(),
        provider_session_id: native_id,
        canonical_working_folder: metadata.cwd,
        source_id: source.source_id.clone(),
        session_ref: session_ref.clone(),
        label: format!(
            "{} session {short_id}",
            if expected_runtime == "codex" {
                "Codex"
            } else {
                "Claude Code"
            }
        ),
        updated_at: after
            .modified()
            .ok()
            .map(|value| chrono::DateTime::<chrono::Utc>::from(value).to_rfc3339()),
        codex_origin: metadata.codex_origin,
        claude_permission_mode,
        relative_locator: relative_locator.to_owned(),
        canonical_source_root: source.canonical_root.clone(),
    })
}

fn same_file_snapshot(left: &Metadata, right: &Metadata) -> bool {
    if !left.is_file()
        || !right.is_file()
        || left.len() != right.len()
        || left.modified().ok() != right.modified().ok()
    {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if left.dev() != right.dev() || left.ino() != right.ino() {
            return false;
        }
    }
    true
}

struct NativeIdentityMetadataV1 {
    cwd: PathBuf,
    codex_origin: Option<CodexSessionOriginV1>,
}

#[derive(Deserialize)]
struct CodexMetadataRow {
    #[serde(rename = "type")]
    kind: String,
    payload: CodexMetadataPayload,
}

#[derive(Deserialize)]
struct CodexMetadataPayload {
    id: String,
    cwd: String,
    source: Option<String>,
    originator: Option<String>,
}

fn read_codex_metadata(
    reader: &mut impl BufRead,
    native_id: Uuid,
) -> Result<NativeIdentityMetadataV1, String> {
    let mut remaining = MAX_METADATA_BYTES;
    let line = read_metadata_line(reader, &mut remaining)?
        .ok_or("The selected Codex session has no original metadata header.")?;
    let row: CodexMetadataRow = serde_json::from_slice(&line)
        .map_err(|_| "The selected Codex session header is malformed or truncated.".to_owned())?;
    if row.kind != "session_meta" || exact_uuid(&row.payload.id)? != native_id {
        return Err("The selected Codex path UUID and original metadata UUID do not match.".into());
    }
    let origin = match (
        row.payload.source.as_deref(),
        row.payload.originator.as_deref(),
    ) {
        (Some("vscode"), Some("Codex Desktop")) => CodexSessionOriginV1::NativeApp,
        (Some("exec"), Some("codex_exec")) => CodexSessionOriginV1::SavedCli,
        _ => CodexSessionOriginV1::Unknown,
    };
    Ok(NativeIdentityMetadataV1 {
        cwd: canonical_folder(&row.payload.cwd)?,
        codex_origin: Some(origin),
    })
}

#[derive(Deserialize)]
struct ClaudeMetadataRow {
    #[serde(rename = "type")]
    kind: String,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    cwd: Option<String>,
    #[serde(rename = "isSidechain")]
    is_sidechain: Option<bool>,
    #[serde(rename = "permissionMode")]
    permission_mode: Option<String>,
}

fn read_claude_policy_tail(
    reader: &mut BufReader<File>,
    native_id: Uuid,
    original_cwd: &Path,
) -> Result<Option<String>, String> {
    let len = reader
        .get_ref()
        .metadata()
        .map_err(|_| "Claude metadata unavailable")?
        .len();
    let start = len.saturating_sub(MAX_METADATA_BYTES as u64);
    reader
        .seek(SeekFrom::Start(start.saturating_sub(1)))
        .map_err(|_| "Claude metadata unavailable")?;
    let mut bytes = Vec::new();
    reader
        .take(MAX_METADATA_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Claude metadata unavailable")?;
    let tail = if start == 0 {
        bytes.as_slice()
    } else if bytes.first() == Some(&b'\n') {
        &bytes[1..]
    } else if let Some(end) = bytes.iter().position(|byte| *byte == b'\n') {
        &bytes[end + 1..]
    } else {
        // One giant final row must not hide an otherwise valid catalogue
        // target. Policy is unverified, so continuation remains unavailable.
        return Ok(None);
    };
    let mut mode = None;
    for line in tail
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        let Ok(row) = serde_json::from_slice::<ClaudeMetadataRow>(line) else {
            // Tail bodies are not catalogue authority. If their metadata
            // cannot be bounded/decoded, retain listing but forbid restore.
            return Ok(None);
        };
        if row.is_sidechain == Some(true) {
            return Err("The selected Claude file contains sidechain metadata.".into());
        }
        if let Some(id) = row.session_id.as_deref() {
            if exact_uuid(id)? != native_id {
                return Err(
                    "Claude tail identity differs from the selected native session.".into(),
                );
            }
        }
        if let Some(folder) = row.cwd.as_deref() {
            if row.session_id.is_none() || canonical_folder(folder)? != original_cwd {
                return Err("The selected Claude session working folder changed.".into());
            }
        }
        if let Some(policy) = row.permission_mode {
            if row.session_id.is_none() {
                return Err("Claude permission metadata has no native identity.".into());
            }
            mode = match policy.as_str() {
                "manual" | "default" => Some("default".into()),
                "auto" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions" => Some(policy),
                _ => None,
            };
        }
    }
    Ok(mode)
}

fn read_claude_metadata(
    reader: &mut impl BufRead,
    native_id: Uuid,
) -> Result<NativeIdentityMetadataV1, String> {
    let mut remaining = MAX_METADATA_BYTES;
    let mut cwd = None;
    for _ in 0..MAX_METADATA_LINES {
        let Some(line) = read_metadata_line(reader, &mut remaining)? else {
            return claude_identity(cwd);
        };
        let row: ClaudeMetadataRow = serde_json::from_slice(&line).map_err(|_| {
            "The selected Claude session metadata is malformed or truncated.".to_owned()
        })?;
        if row.kind == "session_meta" || row.kind.is_empty() || row.is_sidechain == Some(true) {
            return Err("The selected file is not an eligible root Claude session.".into());
        }
        if let Some(id) = row.session_id.as_deref() {
            if exact_uuid(id)? != native_id {
                return Err(
                    "The selected Claude path UUID and native metadata UUID do not match.".into(),
                );
            }
        }
        if let Some(folder) = row.cwd.as_deref() {
            if row.session_id.is_none() {
                return Err(
                    "Claude working-folder metadata has no exact native session identity.".into(),
                );
            }
            let canonical = canonical_folder(folder)?;
            if cwd.as_ref().is_some_and(|previous| previous != &canonical) {
                return Err(
                    "The selected Claude session has ambiguous working-folder metadata.".into(),
                );
            }
            cwd = Some(canonical);
        }
        // Only native metadata surrounding the first message is needed. Serde
        // ignores message/prompt fields rather than retaining or replaying them.
        if matches!(row.kind.as_str(), "user" | "assistant") {
            if row.session_id.is_none() || row.cwd.is_none() {
                return Err(
                    "The selected Claude session lacks original identity/folder metadata.".into(),
                );
            }
            return claude_identity(cwd);
        }
    }
    Err("The selected Claude metadata prefix exceeds its bounded read limit.".into())
}

fn claude_identity(cwd: Option<PathBuf>) -> Result<NativeIdentityMetadataV1, String> {
    Ok(NativeIdentityMetadataV1 {
        cwd: cwd.ok_or("The selected Claude session has no unambiguous native working folder; project-directory names are not authoritative.")?,
        codex_origin: None,
    })
}

fn read_metadata_line(
    reader: &mut impl BufRead,
    remaining: &mut usize,
) -> Result<Option<Vec<u8>>, String> {
    if *remaining == 0 {
        return Err("The selected session metadata exceeds its bounded read limit.".into());
    }
    let mut bytes = Vec::new();
    let read = (&mut *reader)
        .take(*remaining as u64 + 1)
        .read_until(b'\n', &mut bytes)
        .map_err(|_| "The selected session metadata could not be read.".to_owned())?;
    if read == 0 {
        return Ok(None);
    }
    if read > *remaining {
        return Err("The selected session metadata exceeds its bounded read limit.".into());
    }
    if bytes.last() != Some(&b'\n') {
        return Err("The selected session metadata is truncated or incomplete.".into());
    }
    *remaining -= read;
    bytes.pop();
    Ok(Some(bytes))
}

#[cfg(test)]
#[path = "targets_tests.rs"]
mod tests;
