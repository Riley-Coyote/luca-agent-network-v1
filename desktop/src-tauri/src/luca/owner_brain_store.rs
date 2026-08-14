//! Atomic encrypted persistence for the V1.2 scoped Owner Brain.
//!
//! Source bodies, relative locators, display names, and canonical paths remain
//! inside authenticated owner-brain envelopes. Imports stage in memory and
//! advance the existing owner-global revision authority in one SQLite CAS.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path, PathBuf},
    sync::{atomic::Ordering, Mutex},
    time::Instant,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::Utc;
use luca_continuity::{
    decrypt_record, derive_revision_idempotency_key, encrypt_record, encrypted_record_reference,
    InMemoryRetrievalIndex, NamespaceKey, NamespaceScope, RetrievalQuery, RetrievalRecord,
    RetrievalRecordInput, RetrievalRecordState, RetrievalText, RevisionActor, RevisionLifecycle,
    RevisionOperation, RevisionRequest, MAX_HYDRATED_RECORDS,
};
use luca_protocol::{
    canonical_sha256, canonicalize, BrainGrantStateV1, BrainGrantV1, CanonicalTimestamp,
    ContinuityLayerStatusV1, ContinuityNamespaceKindV1, ContinuityNamespaceV1, ContinuityScopeV1,
    Hex64, OpaqueId, OwnerBrainChunkV1, OwnerBrainContextReceiptV1, OwnerBrainImportCommitV1,
    OwnerBrainImportStateV1, OwnerBrainPreviewRowStatusV1, OwnerBrainSourceBindingV1,
    OwnerBrainSourceStatusV1, OwnerBrainSourceV1, ProviderEgressV1, SafeU53, Sha256Ref,
    CONTINUITY_PROTOCOL, MAX_OWNER_BRAIN_CHUNK_BYTES, MAX_OWNER_BRAIN_RETRIEVAL_BYTES,
    MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::app_state::ContinuityLifecycleLock;

use super::{
    continuity_key_custody::{
        load_existing_desktop_master_key, ContinuityMasterKey, ContinuityMasterKeyState,
    },
    continuity_key_derivation::{derive_namespace_key, ContinuityNamespaceKey},
    continuity_revision_authority::{AuthorityExpectationV1, StoredRevisionGenerationV1},
    continuity_runtime::{
        ContinuityRuntime, ContinuityRuntimeDegradedReason, ContinuityRuntimeState,
    },
    continuity_store::ContinuityStoreError,
    owner_brain::{
        canonical_timestamp, opaque_id, preview_source_at_path, sha256_ref, OwnerBrainPreviewCache,
        PendingOwnerBrainPreviewV1, PriorOwnerBrainSnapshotV1,
    },
};

const OWNER_BRAIN_NAMESPACE_DOMAIN: &str = "luca.owner-brain.namespace.v1";
const OWNER_BRAIN_SCOPE_DOMAIN: &str = "luca.owner-brain.source-scope.v1";
const OWNER_BRAIN_RECORD_DOMAIN: &str = "luca.owner-brain.record.v1";
const OWNER_BRAIN_REQUEST_DOMAIN: &str = "luca.owner-brain.import-request.v1";
const OWNER_BRAIN_SOURCE_RECORD: &str = "owner-brain-source";
const OWNER_BRAIN_BINDING_RECORD: &str = "owner-brain-binding";
const OWNER_BRAIN_CHUNK_PAGE_RECORD: &str = "owner-brain-chunk-page";
const OWNER_BRAIN_GRANT_RECORD: &str = "owner-brain-grant";
const OWNER_BRAIN_CHUNKS_PER_PAGE: usize = 128;
const MAX_OWNER_BRAIN_CHUNK_PAGES: usize = 38;

/// Body-free operation failure. No path, source text, or key material is kept.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum OwnerBrainStoreError {
    Cancelled,
    Locked,
    Timeout,
    Unavailable,
    Stale,
    Invalid,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct OwnerBrainSourceManifestV1 {
    protocol: String,
    source: OwnerBrainSourceV1,
    file_hashes: BTreeMap<String, Sha256Ref>,
    chunk_page_lineage_ids: Vec<OpaqueId>,
    file_count: SafeU53,
    chunk_count: SafeU53,
}

impl OwnerBrainSourceManifestV1 {
    fn validate(&self) -> Result<(), OwnerBrainStoreError> {
        if self.protocol != CONTINUITY_PROTOCOL
            || self.source.validate().is_err()
            || self.source.status != OwnerBrainSourceStatusV1::Ready
            || self.file_hashes.is_empty()
            || self.file_hashes.len() != self.file_count.get() as usize
            || self.chunk_page_lineage_ids.is_empty()
            || self.chunk_page_lineage_ids.len() > MAX_OWNER_BRAIN_CHUNK_PAGES
            || self.chunk_count.get() == 0
            || self.chunk_count.get() as usize
                > MAX_OWNER_BRAIN_CHUNK_PAGES * OWNER_BRAIN_CHUNKS_PER_PAGE
            || self
                .file_hashes
                .keys()
                .any(|path| !valid_relative_locator(path))
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        let unique_pages = self
            .chunk_page_lineage_ids
            .iter()
            .map(OpaqueId::as_str)
            .collect::<BTreeSet<_>>();
        if unique_pages.len() != self.chunk_page_lineage_ids.len() {
            return Err(OwnerBrainStoreError::Invalid);
        }
        Ok(())
    }
}

impl OwnerBrainStoreError {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Cancelled => "owner-brain-cancelled",
            Self::Locked => "owner-brain-locked",
            Self::Timeout => "owner-brain-timeout",
            Self::Unavailable => "owner-brain-unavailable",
            Self::Stale => "owner-brain-stale",
            Self::Invalid => "owner-brain-invalid",
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredOwnerBrainChunkV1 {
    chunk_id: OpaqueId,
    source_id: OpaqueId,
    ordinal: SafeU53,
    body_b64: String,
    content_hash: Sha256Ref,
    source_locator: String,
    created_at: CanonicalTimestamp,
}

impl StoredOwnerBrainChunkV1 {
    fn encode(chunk: &OwnerBrainChunkV1) -> Result<Self, OwnerBrainStoreError> {
        chunk
            .validate()
            .map_err(|_| OwnerBrainStoreError::Invalid)?;
        Ok(Self {
            chunk_id: chunk.chunk_id.clone(),
            source_id: chunk.source_id.clone(),
            ordinal: chunk.ordinal,
            body_b64: BASE64_STANDARD.encode(chunk.body.as_bytes()),
            content_hash: chunk.content_hash.clone(),
            source_locator: chunk.source_locator.clone(),
            created_at: chunk.created_at.clone(),
        })
    }

    fn decode(&self) -> Result<OwnerBrainChunkV1, OwnerBrainStoreError> {
        let body = BASE64_STANDARD
            .decode(&self.body_b64)
            .map_err(|_| OwnerBrainStoreError::Invalid)?;
        if BASE64_STANDARD.encode(&body) != self.body_b64
            || body.len() > MAX_OWNER_BRAIN_CHUNK_BYTES
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        let body = String::from_utf8(body).map_err(|_| OwnerBrainStoreError::Invalid)?;
        let chunk = OwnerBrainChunkV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            chunk_id: self.chunk_id.clone(),
            source_id: self.source_id.clone(),
            ordinal: self.ordinal,
            body,
            content_hash: self.content_hash.clone(),
            source_locator: self.source_locator.clone(),
            created_at: self.created_at.clone(),
        };
        chunk
            .validate()
            .map_err(|_| OwnerBrainStoreError::Invalid)?;
        Ok(chunk)
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct OwnerBrainChunkPageV1 {
    protocol: String,
    source_id: OpaqueId,
    page_index: SafeU53,
    chunks: Vec<StoredOwnerBrainChunkV1>,
}

impl OwnerBrainChunkPageV1 {
    fn validate(&self) -> Result<(), OwnerBrainStoreError> {
        if self.protocol != CONTINUITY_PROTOCOL
            || self.chunks.is_empty()
            || self.chunks.len() > OWNER_BRAIN_CHUNKS_PER_PAGE
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        let mut previous = None;
        for stored in &self.chunks {
            let chunk = stored.decode()?;
            if chunk.source_id != self.source_id
                || previous.is_some_and(|ordinal| ordinal >= chunk.ordinal.get())
            {
                return Err(OwnerBrainStoreError::Invalid);
            }
            previous = Some(chunk.ordinal.get());
        }
        Ok(())
    }
}

struct ExistingOwnerBrainSourceV1 {
    manifest: OwnerBrainSourceManifestV1,
    binding: OwnerBrainSourceBindingV1,
}

struct StagedOwnerBrainSourceV1 {
    file_hashes: BTreeMap<String, Sha256Ref>,
    chunks: Vec<OwnerBrainChunkV1>,
}

/// Deliberate owner action for one exact resident/source authorization.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum OwnerBrainGrantActionV1 {
    Grant,
    Revoke,
    Reconfirm,
}

/// Decrypted owner-only source summary. It deliberately excludes paths and
/// source bodies so it can be mapped to the renderer contract safely.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct OwnerBrainSourceSummaryV1 {
    pub source: OwnerBrainSourceV1,
    pub file_count: SafeU53,
    pub chunk_count: SafeU53,
}

/// One persisted grant associated with its encrypted source scope.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct OwnerBrainStoredGrantV1 {
    pub source_id: OpaqueId,
    pub grant: BrainGrantV1,
}

/// Owner-only catalog data needed by the narrow Brain Setup surface.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct OwnerBrainCatalogV1 {
    pub sources: Vec<OwnerBrainSourceSummaryV1>,
    pub grants: Vec<OwnerBrainStoredGrantV1>,
}

/// Result of one idempotent owner grant mutation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct OwnerBrainGrantMutationResultV1 {
    pub source_id: OpaqueId,
    pub grant: BrainGrantV1,
    pub replayed: bool,
}

/// Trusted, bounded retrieval request. The cue is zeroizing and never enters
/// receipts, diagnostics, persistence, or renderer state.
pub(crate) struct OwnerBrainRetrievalRequestV1 {
    pub request_id: OpaqueId,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub binding_ref: Sha256Ref,
    pub provider_egress: ProviderEgressV1,
    pub cue: RetrievalText,
    pub deadline: Instant,
}

impl std::fmt::Debug for OwnerBrainRetrievalRequestV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OwnerBrainRetrievalRequestV1")
            .field("request_id", &self.request_id)
            .field("owner_pubkey", &self.owner_pubkey)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("binding_ref", &self.binding_ref)
            .field("provider_egress", &self.provider_egress)
            .field("cue", &"[REDACTED]")
            .finish()
    }
}

/// One selected source chunk. Its body remains zeroizing until the immediate
/// continuity packet assembly boundary consumes it.
pub(crate) struct OwnerBrainSelectedChunkV1 {
    pub source_id: OpaqueId,
    pub grant_id: OpaqueId,
    pub chunk_id: OpaqueId,
    pub body: RetrievalText,
    pub content_hash: Sha256Ref,
}

impl std::fmt::Debug for OwnerBrainSelectedChunkV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OwnerBrainSelectedChunkV1")
            .field("source_id", &self.source_id)
            .field("grant_id", &self.grant_id)
            .field("chunk_id", &self.chunk_id)
            .field("body", &"[REDACTED]")
            .field("content_hash", &self.content_hash)
            .finish()
    }
}

/// Body-safe retrieval result. Only `selected` contains plaintext, and every
/// item remains within the frozen eight-chunk / 24 KiB bound.
pub(crate) struct OwnerBrainRetrievalResultV1 {
    pub status: ContinuityLayerStatusV1,
    pub selected: Vec<OwnerBrainSelectedChunkV1>,
    pub receipts: Vec<OwnerBrainContextReceiptV1>,
}

impl std::fmt::Debug for OwnerBrainRetrievalResultV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OwnerBrainRetrievalResultV1")
            .field("status", &self.status)
            .field("selected_count", &self.selected.len())
            .field("receipts", &self.receipts)
            .finish()
    }
}

/// Read the encrypted committed file-hash inventory for a selected path.
pub(crate) fn read_prior_snapshot(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
    selected_path: &Path,
) -> Result<Option<PriorOwnerBrainSnapshotV1>, OwnerBrainStoreError> {
    let canonical_path =
        fs::canonicalize(selected_path).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let root = load_root_key()?;
    let state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime(&state, owner_pubkey)?;
    read_prior_snapshot_with_runtime(&root, runtime, &canonical_path)
}

/// Commit one exact preview capability through an all-or-nothing encrypted
/// transaction. The token remains retryable after a body-free failure and is
/// consumed only after a committed or idempotently replayed result.
pub(crate) fn commit_preview(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    cache: &OwnerBrainPreviewCache,
    owner_pubkey: Hex64,
    preview_id: &OpaqueId,
    token: &str,
) -> Result<(OwnerBrainImportCommitV1, bool), OwnerBrainStoreError> {
    let token_hash = sha256_ref(token.as_bytes()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let pending = {
        let guard = cache
            .lock()
            .map_err(|_| OwnerBrainStoreError::Unavailable)?;
        let pending = guard
            .get(token_hash.as_str())
            .cloned()
            .ok_or(OwnerBrainStoreError::Stale)?;
        if pending.preview.preview_id != *preview_id
            || pending.preview.preview_token_hash != token_hash
            || pending.preview.owner_pubkey != owner_pubkey
            || preview_expired(&pending)
        {
            return Err(OwnerBrainStoreError::Stale);
        }
        pending
    };
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let root = load_root_key()?;
    let mut state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime_mut(&mut state, &owner_pubkey)?;
    let result = commit_preview_with_runtime(&root, runtime, pending);
    if matches!(&result, Ok(_) | Err(OwnerBrainStoreError::Cancelled)) {
        if let Ok(mut guard) = cache.lock() {
            guard.remove(token_hash.as_str());
        }
    }
    result
}

/// Cooperatively cancel one preview/import before the SQLite commit claim.
pub(crate) fn cancel_preview(
    cache: &OwnerBrainPreviewCache,
    owner_pubkey: &Hex64,
    preview_id: &OpaqueId,
    token: &str,
) -> Result<bool, OwnerBrainStoreError> {
    let token_hash = sha256_ref(token.as_bytes()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let mut guard = cache
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let pending = guard
        .get(token_hash.as_str())
        .ok_or(OwnerBrainStoreError::Stale)?;
    if pending.preview.owner_pubkey != *owner_pubkey
        || pending.preview.preview_id != *preview_id
        || pending.preview.preview_token_hash != token_hash
        || preview_expired(pending)
    {
        return Err(OwnerBrainStoreError::Stale);
    }
    if pending.commit_claimed.load(Ordering::Acquire) {
        return Ok(false);
    }
    pending.cancelled.store(true, Ordering::Release);
    guard.remove(token_hash.as_str());
    Ok(true)
}

/// Read the owner-visible source and grant catalog. Source bodies, relative
/// locators, and canonical device paths never leave the encrypted store.
pub(crate) fn read_catalog(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
) -> Result<OwnerBrainCatalogV1, OwnerBrainStoreError> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime(&state, owner_pubkey)?;
    read_catalog_with_runtime(runtime, owner_pubkey, load_root_key)
}

fn read_catalog_with_runtime(
    runtime: &ContinuityRuntime,
    owner_pubkey: &Hex64,
    load_root: impl FnOnce() -> Result<ContinuityMasterKey, OwnerBrainStoreError>,
) -> Result<OwnerBrainCatalogV1, OwnerBrainStoreError> {
    let Some(generation) = runtime
        .store
        .load_revision_generation(owner_pubkey)
        .map_err(map_store_read_error)?
    else {
        return Ok(OwnerBrainCatalogV1 {
            sources: Vec::new(),
            grants: Vec::new(),
        });
    };
    let root = load_root()?;
    let key_version = runtime
        .store
        .active_owner_key_version(owner_pubkey)
        .map_err(map_store_read_error)?;
    let namespace = owner_brain_namespace(owner_pubkey, key_version)?;
    let namespace_key =
        derive_namespace_key(&root, &namespace).map_err(|_| OwnerBrainStoreError::Invalid)?;
    read_catalog_from_generation(&generation, &namespace, namespace_key.as_bytes())
}

/// Apply one explicit grant, revoke, or reconfirm action. Runtime binding and
/// egress are supplied only by trusted desktop code, never by the renderer.
#[allow(clippy::too_many_arguments)]
pub(crate) fn mutate_grant(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    source_id: OpaqueId,
    binding_ref: Sha256Ref,
    provider_egress: ProviderEgressV1,
    action: OwnerBrainGrantActionV1,
) -> Result<OwnerBrainGrantMutationResultV1, OwnerBrainStoreError> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let root = load_root_key()?;
    let mut state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime_mut(&mut state, &owner_pubkey)?;
    mutate_grant_with_runtime(
        &root,
        runtime,
        owner_pubkey,
        resident_pubkey,
        source_id,
        binding_ref,
        provider_egress,
        action,
    )
}

/// Resolve all exact-source grants for one resident, then decrypt and rank
/// only authorized source chunks. This function is read-only and holds the
/// continuity lifecycle boundary for one immutable owner generation.
pub(crate) fn retrieve(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    request: OwnerBrainRetrievalRequestV1,
) -> Result<OwnerBrainRetrievalResultV1, OwnerBrainStoreError> {
    if request.owner_pubkey == request.resident_pubkey {
        return Err(OwnerBrainStoreError::Invalid);
    }
    require_before_deadline(request.deadline)?;
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let root = load_root_key()?;
    let state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime(&state, &request.owner_pubkey)?;
    let key_version = runtime
        .store
        .active_owner_key_version(&request.owner_pubkey)
        .map_err(map_store_read_error)?;
    let namespace = owner_brain_namespace(&request.owner_pubkey, key_version)?;
    let namespace_key =
        derive_namespace_key(&root, &namespace).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let Some(generation) = runtime
        .store
        .load_revision_generation(&request.owner_pubkey)
        .map_err(map_store_read_error)?
    else {
        return Ok(OwnerBrainRetrievalResultV1 {
            status: ContinuityLayerStatusV1::Empty,
            selected: Vec::new(),
            receipts: Vec::new(),
        });
    };
    retrieve_from_generation(&generation, &namespace, namespace_key.as_bytes(), request)
}

/// Interpret unknown egress as remote and fail a missing or changed runtime
/// binding closed as stale. Revocation always remains authoritative.
pub(crate) fn effective_grant_state(
    grant: &BrainGrantV1,
    current_binding_ref: Option<&Sha256Ref>,
    current_provider_egress: Option<ProviderEgressV1>,
) -> BrainGrantStateV1 {
    if grant.state == BrainGrantStateV1::Revoked {
        return BrainGrantStateV1::Revoked;
    }
    if grant.state == BrainGrantStateV1::Stale {
        return BrainGrantStateV1::Stale;
    }
    let current_egress = current_provider_egress.map(effective_provider_egress);
    if current_binding_ref != Some(&grant.binding_ref)
        || current_egress != Some(grant.provider_egress)
    {
        BrainGrantStateV1::Stale
    } else {
        BrainGrantStateV1::Active
    }
}

fn effective_provider_egress(provider_egress: ProviderEgressV1) -> ProviderEgressV1 {
    match provider_egress {
        ProviderEgressV1::Local => ProviderEgressV1::Local,
        ProviderEgressV1::Remote | ProviderEgressV1::Unknown => ProviderEgressV1::Remote,
    }
}

fn load_root_key() -> Result<ContinuityMasterKey, OwnerBrainStoreError> {
    match load_existing_desktop_master_key() {
        ContinuityMasterKeyState::Ready(root) => Ok(root),
        ContinuityMasterKeyState::Locked => Err(OwnerBrainStoreError::Locked),
        ContinuityMasterKeyState::Unavailable => Err(OwnerBrainStoreError::Unavailable),
        ContinuityMasterKeyState::Corrupt => Err(OwnerBrainStoreError::Invalid),
    }
}

fn ready_runtime<'a>(
    state: &'a ContinuityRuntimeState,
    owner: &Hex64,
) -> Result<&'a ContinuityRuntime, OwnerBrainStoreError> {
    match state {
        ContinuityRuntimeState::Ready(runtime) if &runtime.owner_pubkey == owner => Ok(runtime),
        ContinuityRuntimeState::Ready(_) => Err(OwnerBrainStoreError::Invalid),
        ContinuityRuntimeState::Degraded(ContinuityRuntimeDegradedReason::KeyLocked) => {
            Err(OwnerBrainStoreError::Locked)
        }
        ContinuityRuntimeState::Degraded(ContinuityRuntimeDegradedReason::RestorePending) => {
            Err(OwnerBrainStoreError::Stale)
        }
        ContinuityRuntimeState::Degraded(_) | ContinuityRuntimeState::Uninitialized => {
            Err(OwnerBrainStoreError::Unavailable)
        }
    }
}

fn ready_runtime_mut<'a>(
    state: &'a mut ContinuityRuntimeState,
    owner: &Hex64,
) -> Result<&'a mut ContinuityRuntime, OwnerBrainStoreError> {
    match state {
        ContinuityRuntimeState::Ready(runtime) if &runtime.owner_pubkey == owner => Ok(runtime),
        ContinuityRuntimeState::Ready(_) => Err(OwnerBrainStoreError::Invalid),
        ContinuityRuntimeState::Degraded(ContinuityRuntimeDegradedReason::KeyLocked) => {
            Err(OwnerBrainStoreError::Locked)
        }
        ContinuityRuntimeState::Degraded(ContinuityRuntimeDegradedReason::RestorePending) => {
            Err(OwnerBrainStoreError::Stale)
        }
        ContinuityRuntimeState::Degraded(_) | ContinuityRuntimeState::Uninitialized => {
            Err(OwnerBrainStoreError::Unavailable)
        }
    }
}

mod connected;
mod connected_lifecycle;
mod connected_retrieval;
mod grants;
mod imports;
mod records;
mod repository_bridge;
mod retrieval;

pub(crate) use connected::*;
pub(crate) use connected_lifecycle::*;
use connected_retrieval::*;
use grants::*;
use imports::*;
use records::*;
pub(crate) use repository_bridge::*;
use retrieval::*;

#[cfg(test)]
mod connected_reconnect_tests;
#[cfg(test)]
mod tests;
