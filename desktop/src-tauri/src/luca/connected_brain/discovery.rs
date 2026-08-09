use std::{
    collections::{BTreeSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    time::{Instant, UNIX_EPOCH},
};

use chrono::{DateTime, Utc};
use luca_protocol::{ConnectedBrainSourceKindV1, OpaqueId, MAX_CONNECTED_REPOSITORIES};
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{sessions, ConnectedBrainDiscoveryCandidateV1};

const MAX_DISCOVERY_DEPTH: usize = 6;
const MAX_DISCOVERY_ENTRIES: usize = 50_000;
const COMMON_REPOSITORY_DIRS: &[&str] = &[
    "Developer",
    "Development",
    "Code",
    "Projects",
    "Repositories",
    "GitHub",
    "src",
    "Documents/Repositories",
];

/// Body-free metadata shown by the Brain inventory.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectedBrainDiscoveryViewV1 {
    discovery_id: String,
    source_kind: &'static str,
    display_name: String,
    item_count: usize,
    earliest_at: Option<String>,
    latest_at: Option<String>,
}

impl From<&ConnectedBrainDiscoveryCandidateV1> for ConnectedBrainDiscoveryViewV1 {
    fn from(candidate: &ConnectedBrainDiscoveryCandidateV1) -> Self {
        Self {
            discovery_id: candidate.discovery_id.as_str().to_owned(),
            source_kind: source_kind_value(candidate.source_kind),
            display_name: candidate.display_name.clone(),
            item_count: candidate.item_count,
            earliest_at: candidate.earliest_at.clone(),
            latest_at: candidate.latest_at.clone(),
        }
    }
}

fn source_kind_value(kind: ConnectedBrainSourceKindV1) -> &'static str {
    match kind {
        ConnectedBrainSourceKindV1::Repository => "repository",
        ConnectedBrainSourceKindV1::CodexHistory => "codex_history",
        ConnectedBrainSourceKindV1::ClaudeHistory => "claude_history",
    }
}

pub(crate) fn discover() -> Result<Vec<ConnectedBrainDiscoveryCandidateV1>, String> {
    let home = dirs::home_dir().ok_or_else(|| "home directory is unavailable".to_owned())?;
    let mut roots = Vec::new();
    if let Some(nest) = crate::managed_agents::nest_dir() {
        roots.push(nest.join("REPOS"));
    }
    roots.extend(
        COMMON_REPOSITORY_DIRS
            .iter()
            .map(|relative| home.join(relative)),
    );

    let mut candidates = discover_repositories(&roots)?;
    if let Some(candidate) = discover_session_root(
        &home.join(".codex").join("sessions"),
        ConnectedBrainSourceKindV1::CodexHistory,
        "Codex",
    )? {
        candidates.push(candidate);
    }
    if let Some(candidate) = discover_session_root(
        &home.join(".claude").join("projects"),
        ConnectedBrainSourceKindV1::ClaudeHistory,
        "Claude Code",
    )? {
        candidates.push(candidate);
    }
    candidates.sort_by(|left, right| {
        left.source_kind
            .cmp(&right.source_kind)
            .then_with(|| {
                left.display_name
                    .to_lowercase()
                    .cmp(&right.display_name.to_lowercase())
            })
            .then_with(|| left.discovery_id.cmp(&right.discovery_id))
    });
    Ok(candidates)
}

pub(crate) fn discover_in_added_root(
    selected_root: &Path,
) -> Result<Vec<ConnectedBrainDiscoveryCandidateV1>, String> {
    let canonical = selected_root
        .canonicalize()
        .map_err(|_| "selected folder is unavailable".to_owned())?;
    if !canonical.is_dir() {
        return Err("selected folder is not a directory".to_owned());
    }
    if dirs::home_dir()
        .and_then(|home| home.canonicalize().ok())
        .as_ref()
        == Some(&canonical)
    {
        return Err("choose a specific development folder, not the home directory".to_owned());
    }
    discover_repositories(&[canonical])
}

fn discover_repositories(
    roots: &[PathBuf],
) -> Result<Vec<ConnectedBrainDiscoveryCandidateV1>, String> {
    let mut canonical_roots = roots
        .iter()
        .filter_map(|root| root.canonicalize().ok())
        .filter(|root| root.is_dir())
        .collect::<Vec<_>>();
    canonical_roots.sort();
    canonical_roots.dedup();

    let mut seen = BTreeSet::new();
    let mut repositories = Vec::new();
    let mut visited = 0_usize;
    for root in canonical_roots {
        let mut queue = VecDeque::from([(root.clone(), 0_usize)]);
        while let Some((directory, depth)) = queue.pop_front() {
            if repositories.len() >= MAX_CONNECTED_REPOSITORIES || visited >= MAX_DISCOVERY_ENTRIES
            {
                break;
            }
            visited += 1;
            if directory.join(".git").exists() {
                if seen.insert(directory.clone()) {
                    repositories.push(repository_candidate(directory)?);
                }
                continue;
            }
            if depth >= MAX_DISCOVERY_DEPTH {
                continue;
            }
            let Ok(entries) = fs::read_dir(&directory) else {
                continue;
            };
            for entry in entries.flatten() {
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if file_type.is_symlink() || !file_type.is_dir() {
                    continue;
                }
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if matches!(
                    name.as_ref(),
                    ".git" | "node_modules" | "target" | "build" | "dist"
                ) {
                    continue;
                }
                let path = entry.path();
                let Ok(canonical) = path.canonicalize() else {
                    continue;
                };
                if canonical.starts_with(&root) {
                    queue.push_back((canonical, depth + 1));
                }
            }
        }
    }
    Ok(repositories)
}

fn repository_candidate(path: PathBuf) -> Result<ConnectedBrainDiscoveryCandidateV1, String> {
    let display_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Repository")
        .to_owned();
    candidate(
        ConnectedBrainSourceKindV1::Repository,
        display_name,
        path,
        1,
        None,
        None,
    )
}

fn discover_session_root(
    path: &Path,
    kind: ConnectedBrainSourceKindV1,
    display_name: &str,
) -> Result<Option<ConnectedBrainDiscoveryCandidateV1>, String> {
    let Ok(canonical_root) = path.canonicalize() else {
        return Ok(None);
    };
    if !canonical_root.is_dir() {
        return Ok(None);
    }
    let metadata = sessions::session_metadata(&canonical_root, kind)?;
    if metadata.count == 0 {
        return Ok(None);
    }
    candidate(
        kind,
        display_name.to_owned(),
        canonical_root,
        metadata.count,
        metadata.earliest_at,
        metadata.latest_at,
    )
    .map(Some)
}

fn candidate(
    kind: ConnectedBrainSourceKindV1,
    display_name: String,
    canonical_root: PathBuf,
    item_count: usize,
    earliest_at: Option<String>,
    latest_at: Option<String>,
) -> Result<ConnectedBrainDiscoveryCandidateV1, String> {
    let mut digest = Sha256::new();
    digest.update(b"luca-connected-discovery-v1\0");
    digest.update(source_kind_value(kind).as_bytes());
    digest.update(b"\0");
    digest.update(canonical_root.as_os_str().as_encoded_bytes());
    let discovery_id = OpaqueId::parse(format!("discovery-{}", hex::encode(digest.finalize())))
        .map_err(|_| "connected Brain discovery ID is invalid".to_owned())?;
    Ok(ConnectedBrainDiscoveryCandidateV1 {
        discovery_id,
        source_kind: kind,
        display_name,
        canonical_root,
        item_count,
        earliest_at,
        latest_at,
        discovered_at: Instant::now(),
    })
}

pub(super) fn modified_timestamp(path: &Path) -> Option<String> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    let duration = modified.duration_since(UNIX_EPOCH).ok()?;
    DateTime::<Utc>::from_timestamp(duration.as_secs() as i64, duration.subsec_nanos())
        .map(|value| value.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}
