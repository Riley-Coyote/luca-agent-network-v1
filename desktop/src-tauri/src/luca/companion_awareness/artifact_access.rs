//! Narrow consumption barrier for host-authored initiative Library creations.
//! Ordinary artifacts keep their existing owner/conversation policy. A prefix
//! identifies the extra check; it is not a signature or an authorization claim.
//! Native tools with unrestricted database writes remain outside this boundary.

use super::{
    source_runtime::preload_retained_source_facts, AwarenessMaterialFactsV1,
    CompanionAwarenessRuntime, LiveAwarenessOwner,
};
use crate::{
    app_state::AppState,
    data_dir::BuzzPathExt,
    luca::artifacts::{
        presentation::{self, PreparedArtifactPreviewV1},
        ArtifactLastPreviewRecord, ArtifactListPage, ArtifactListQuery, ArtifactPreviewRecord,
        ArtifactReceiptRecord, ArtifactRecord, ArtifactStore, ArtifactStoreError,
        ArtifactVersionRecord,
    },
};
use base64::Engine as _;
use luca_protocol::{
    ArtifactReadModeV1, AwarenessObservationRefV1, CanonicalTimestamp, Hex64, OpaqueId, SafeU53,
};
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Reserved host-issued identity of a creation with source-derived parents.
pub(crate) const DERIVED_CREATION_PREFIX: &str = "initiative-creation-derived:";
/// Reserved host-issued identity for independently authorized canonical work
/// with no source-derived parents. Never fabricate an empty awareness DAG node.
pub(crate) const CANONICAL_CREATION_PREFIX: &str = "initiative-creation-canonical:";
const RESERVED_CREATION_PREFIX: &str = "initiative-creation-";
const MAX_VISIBLE_PAGE_PROBES: usize = 4;

/// Namespace detection only, never access authority. The native artifact broker
/// has no initiative provider-egress binding; these creations stay local there.
pub(crate) fn is_initiative_creation(record: &ArtifactRecord) -> bool {
    record
        .source_turn_id
        .as_deref()
        .is_some_and(|turn| turn.starts_with(RESERVED_CREATION_PREFIX))
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CreationScope {
    Ordinary,
    Canonical { resident: Hex64 },
    Derived { resident: Hex64, node: OpaqueId },
}

fn creation_scope(
    owner: &Hex64,
    record: &ArtifactRecord,
) -> Result<CreationScope, ArtifactStoreError> {
    let Some(turn) = record.source_turn_id.as_deref() else {
        return Ok(CreationScope::Ordinary);
    };
    if !turn.starts_with(RESERVED_CREATION_PREFIX) {
        return Ok(CreationScope::Ordinary);
    }
    let (hash, derived) = if let Some(hash) = turn.strip_prefix(DERIVED_CREATION_PREFIX) {
        (hash, true)
    } else if let Some(hash) = turn.strip_prefix(CANONICAL_CREATION_PREFIX) {
        (hash, false)
    } else {
        return Err(ArtifactStoreError::NotFound);
    };
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ArtifactStoreError::NotFound);
    }
    let resident =
        Hex64::parse(record.created_by_pubkey.clone()).map_err(|_| ArtifactStoreError::NotFound)?;
    if &resident == owner {
        return Err(ArtifactStoreError::NotFound);
    }
    if derived {
        Ok(CreationScope::Derived {
            resident,
            node: OpaqueId::parse(turn.to_owned()).map_err(|_| ArtifactStoreError::NotFound)?,
        })
    } else {
        Ok(CreationScope::Canonical { resident })
    }
}

/// Serve one bounded local effect from a record just resolved through the
/// owner-scoped ArtifactStore. Derived material is rechecked under live identity
/// and awareness locks, using preloaded exact host exclusions, not DTO booleans.
/// This local-owner check is not native worker/provider-egress authorization.
pub(crate) fn with_artifact_access<T>(
    state: &AppState,
    owner: &Hex64,
    record: &ArtifactRecord,
    effect: impl FnOnce() -> T,
) -> Result<T, ArtifactStoreError> {
    let scope = creation_scope(owner, record)?;
    if scope == CreationScope::Ordinary {
        return Ok(effect());
    }
    let live = LiveAwarenessOwner::authenticate(state).map_err(|_| ArtifactStoreError::NotFound)?;
    if live.owner() != owner {
        return Err(ArtifactStoreError::NotFound);
    }
    match scope {
        CreationScope::Ordinary => Ok(effect()),
        CreationScope::Canonical { .. } => {
            // Pause stops new work, not disclosure of an already-owned authored
            // Library creation. Owner-scoped storage supplies its durable author;
            // this branch does not claim observation or source promotion consent.
            let _lease = live.lease().map_err(|_| ArtifactStoreError::NotFound)?;
            Ok(effect())
        }
        CreationScope::Derived { resident, node } => {
            let now = CanonicalTimestamp::parse(
                chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            )
            .map_err(|_| ArtifactStoreError::NotFound)?;
            // Bounded purpose/pairing metadata preloads precede the identity/
            // control lease. Exact native child + browser pairing/class/policy
            // roots resolve below synchronously; unknown roots remain denied.
            let material = preload_retained_source_facts(state, owner, &resident, &now)
                .map_err(|_| ArtifactStoreError::NotFound)?;
            with_derived_access(
                &live,
                &state.companion_awareness,
                &resident,
                &node,
                &now,
                |observation, retained| material.resolve(observation, retained),
                effect,
            )
        }
    }
}

fn with_derived_access<T>(
    live: &LiveAwarenessOwner<'_>,
    runtime: &CompanionAwarenessRuntime,
    resident: &Hex64,
    node: &OpaqueId,
    now: &CanonicalTimestamp,
    resolve: impl FnMut(&AwarenessObservationRefV1, bool) -> AwarenessMaterialFactsV1,
    effect: impl FnOnce() -> T,
) -> Result<T, ArtifactStoreError> {
    let lease = live.lease().map_err(|_| ArtifactStoreError::NotFound)?;
    runtime
        .with_promoted_artifact_access(&lease, resident, node, now, resolve, effect)
        .map_err(|_| ArtifactStoreError::NotFound)
}

/// Small local Library facade. It preserves the existing store formats and
/// ordinary behavior; only initiative-prefixed records require the extra fence.
pub(crate) struct ArtifactAccess<'a> {
    state: &'a AppState,
    owner: &'a Hex64,
    store: &'a ArtifactStore,
}
impl<'a> ArtifactAccess<'a> {
    pub(crate) fn new(state: &'a AppState, owner: &'a Hex64, store: &'a ArtifactStore) -> Self {
        Self {
            state,
            owner,
            store,
        }
    }
    pub(crate) fn get(&self, id: &OpaqueId) -> Result<ArtifactRecord, ArtifactStoreError> {
        let record = self.store.get(self.owner, id)?;
        with_artifact_access(self.state, self.owner, &record, || record.clone())
    }
    fn effect<T>(
        &self,
        id: &OpaqueId,
        use_store: impl FnOnce() -> Result<T, ArtifactStoreError>,
    ) -> Result<T, ArtifactStoreError> {
        let record = self.store.get(self.owner, id)?;
        with_artifact_access(self.state, self.owner, &record, use_store)?
    }
    pub(crate) fn read(
        &self,
        id: &OpaqueId,
        version: Option<SafeU53>,
        mode: ArtifactReadModeV1,
    ) -> Result<ArtifactPreviewRecord, ArtifactStoreError> {
        self.effect(id, || self.store.read(self.owner, id, version, mode))
    }
    pub(crate) fn read_binary(
        &self,
        id: &OpaqueId,
        version: Option<SafeU53>,
    ) -> Result<ArtifactPreviewRecord, ArtifactStoreError> {
        self.effect(id, || self.store.read_binary(self.owner, id, version))
    }
    pub(crate) fn versions(
        &self,
        id: &OpaqueId,
    ) -> Result<Vec<ArtifactVersionRecord>, ArtifactStoreError> {
        self.effect(id, || self.store.versions(self.owner, id))
    }
    pub(crate) fn last_preview(
        &self,
        id: &OpaqueId,
    ) -> Result<Option<ArtifactLastPreviewRecord>, ArtifactStoreError> {
        self.effect(id, || self.store.last_preview(self.owner, id))
    }
    pub(crate) fn prepare(
        &self,
        id: &OpaqueId,
        version: Option<SafeU53>,
    ) -> Result<PreparedArtifactPreviewV1, ArtifactStoreError> {
        self.effect(id, || {
            presentation::prepare(self.store, self.owner, id, version)
        })
    }

    /// Hide title/provenance, hidden cardinality and hidden cursor coordinates.
    /// Once an excluded record is encountered, total is only a visible lower
    /// bound. At most four native pages are inspected; no whole Library scan.
    pub(crate) fn list_page(
        &self,
        query: &ArtifactListQuery,
    ) -> Result<ArtifactListPage, ArtifactStoreError> {
        visible_page(
            query,
            self.store.has_reserved_creation_scope(self.owner)?,
            |query| self.store.list_page(self.owner, query),
            |record| with_artifact_access(self.state, self.owner, record, || ()).is_ok(),
        )
    }
    pub(crate) fn receipts(
        &self,
        conversation: Option<&OpaqueId>,
        limit: u16,
    ) -> Result<Vec<ArtifactReceiptRecord>, ArtifactStoreError> {
        self.store
            .receipts(self.owner, conversation, limit)?
            .into_iter()
            .filter_map(|receipt| {
                let id = OpaqueId::parse(receipt.artifact_id.clone()).ok()?;
                self.get(&id).ok().map(|_| Ok(receipt))
            })
            .collect()
    }
}

fn visible_page(
    query: &ArtifactListQuery,
    contains_creation_scope: bool,
    mut fetch: impl FnMut(&ArtifactListQuery) -> Result<ArtifactListPage, ArtifactStoreError>,
    mut allowed: impl FnMut(&ArtifactRecord) -> bool,
) -> Result<ArtifactListPage, ArtifactStoreError> {
    let mut next_query = query.clone();
    let mut visible = Vec::new();
    let mut more = false;
    for probe in 0..MAX_VISIBLE_PAGE_PROBES {
        let page = fetch(&next_query)?;
        let page_had_more = page.next_cursor.is_some();
        let mut local_hidden = false;
        let mut page_visible = Vec::new();
        for record in page.artifacts {
            if allowed(&record) {
                page_visible.push(record);
            } else {
                local_hidden = true;
            }
        }
        if probe == 0 && !contains_creation_scope && !local_hidden {
            return Ok(ArtifactListPage {
                artifacts: page_visible,
                next_cursor: page.next_cursor,
                total: page.total,
            });
        }
        let available = usize::from(query.limit).saturating_sub(visible.len());
        more = page_had_more || page_visible.len() > available;
        visible.extend(page_visible.into_iter().take(available));
        if visible.len() == usize::from(query.limit) || !page_had_more {
            break;
        }
        next_query.cursor = page.next_cursor;
    }
    let next_cursor = if more {
        visible.last().map(visible_cursor).transpose()?
    } else {
        None
    };
    Ok(ArtifactListPage {
        total: visible.len() as u64,
        artifacts: visible,
        next_cursor,
    })
}
fn visible_cursor(record: &ArtifactRecord) -> Result<String, ArtifactStoreError> {
    #[derive(Serialize)]
    struct Cursor<'a> {
        pinned: bool,
        updated_at: &'a str,
        artifact_id: &'a str,
    }
    let bytes = serde_json::to_vec(&Cursor {
        pinned: record.pinned,
        updated_at: &record.updated_at,
        artifact_id: &record.artifact_id,
    })
    .map_err(|_| ArtifactStoreError::SchemaIncompatible)?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

/// Scheme callback seam: recheck the owner-scoped durable record and derivative
/// authority around the actual cached-byte response, not only token preparation.
pub(crate) fn serve_static_presentation(
    app: &AppHandle,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let state = app.state::<AppState>();
    let owner = state
        .signing_keys()
        .ok()
        .and_then(|keys| Hex64::parse(keys.public_key().to_hex()).ok());
    presentation::handle_guarded(
        owner.as_ref().map(Hex64::as_str),
        request,
        |_, artifact_id, turn, author, serve| {
            // Ordinary cached tokens retain their original behavior without opening
            // a store or introducing awareness/source availability prerequisites.
            if !turn.is_some_and(|turn| turn.starts_with(RESERVED_CREATION_PREFIX)) {
                return Some(serve());
            }
            let owner = owner.as_ref()?;
            let directory = app.buzz_path().app_data_dir().ok()?;
            let store = ArtifactStore::open(&directory).ok()?;
            let id = OpaqueId::parse(artifact_id.to_owned()).ok()?;
            let record = store.get(owner, &id).ok()?;
            if record.source_turn_id.as_deref() != turn || record.created_by_pubkey != author {
                return None;
            }
            with_artifact_access(&state, owner, &record, serve).ok()
        },
    )
}

#[cfg(test)]
#[path = "artifact_access_tests.rs"]
mod tests;
