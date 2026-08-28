//! Metadata-only discovery and live, body-free indexing for connected Brain sources.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

use luca_protocol::{ConnectedBrainSourceKindV1, OpaqueId};
use sha2::{Digest, Sha256};

mod discovery;
mod index;
pub(crate) mod repository;
mod session_context;
mod sessions;
mod watcher;

pub(crate) use discovery::{discover, discover_in_added_root, ConnectedBrainDiscoveryViewV1};
pub(crate) use index::{build_index, read_verified_excerpt, ConnectedBrainIndexBuildV1};
pub(crate) use session_context::{
    context_for_indexed_session, list_indexed_sessions, IndexedSessionContextV1,
    IndexedSessionListV1,
};
pub(crate) use sessions::SessionReadBudget;
pub(crate) use watcher::{
    register_connected_source, start_connected_source_watcher, unregister_connected_source,
    ConnectedBrainWatcherState,
};

const DISCOVERY_TTL: Duration = Duration::from_secs(15 * 60);

/// A sensitive discovery result retained only in process memory until connect.
#[derive(Clone)]
pub(crate) struct ConnectedBrainDiscoveryCandidateV1 {
    pub discovery_id: OpaqueId,
    pub source_kind: ConnectedBrainSourceKindV1,
    pub display_name: String,
    pub canonical_root: PathBuf,
    pub item_count: usize,
    pub earliest_at: Option<String>,
    pub latest_at: Option<String>,
    pub discovered_at: Instant,
}

/// Expiring process-memory discovery capabilities. Paths never cross IPC.
pub(crate) type ConnectedBrainDiscoveryCache =
    Mutex<HashMap<String, ConnectedBrainDiscoveryCandidateV1>>;

pub(crate) fn cache_candidates(
    cache: &ConnectedBrainDiscoveryCache,
    candidates: Vec<ConnectedBrainDiscoveryCandidateV1>,
) -> Result<Vec<ConnectedBrainDiscoveryViewV1>, String> {
    let now = Instant::now();
    let mut guard = cache
        .lock()
        .map_err(|_| "connected Brain discovery is unavailable".to_owned())?;
    guard.retain(|_, candidate| now.duration_since(candidate.discovered_at) < DISCOVERY_TTL);
    let views = candidates
        .iter()
        .map(ConnectedBrainDiscoveryViewV1::from)
        .collect();
    for candidate in candidates {
        guard.insert(candidate.discovery_id.as_str().to_owned(), candidate);
    }
    Ok(views)
}

pub(crate) fn take_candidate(
    cache: &ConnectedBrainDiscoveryCache,
    discovery_id: &OpaqueId,
) -> Result<ConnectedBrainDiscoveryCandidateV1, String> {
    let guard = cache
        .lock()
        .map_err(|_| "connected Brain discovery is unavailable".to_owned())?;
    let candidate = guard
        .get(discovery_id.as_str())
        .cloned()
        .ok_or_else(|| "connected Brain discovery expired".to_owned())?;
    if candidate.discovered_at.elapsed() >= DISCOVERY_TTL {
        return Err("connected Brain discovery expired".to_owned());
    }
    Ok(candidate)
}

pub(crate) fn source_id_for_candidate(
    candidate: &ConnectedBrainDiscoveryCandidateV1,
) -> Result<OpaqueId, String> {
    let kind = match candidate.source_kind {
        ConnectedBrainSourceKindV1::Repository => "repository",
        ConnectedBrainSourceKindV1::CodexHistory => "codex-history",
        ConnectedBrainSourceKindV1::ClaudeHistory => "claude-history",
    };
    let mut digest = Sha256::new();
    digest.update(b"luca-connected-source-v1\0");
    digest.update(kind.as_bytes());
    digest.update(b"\0");
    digest.update(candidate.canonical_root.as_os_str().as_encoded_bytes());
    OpaqueId::parse(format!("connected-{}", hex::encode(digest.finalize())))
        .map_err(|_| "connected Brain source ID is invalid".to_owned())
}

#[cfg(test)]
mod tests;
