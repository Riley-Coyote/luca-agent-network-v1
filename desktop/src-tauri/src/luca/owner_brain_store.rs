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
    continuity_key_derivation::derive_namespace_key,
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
    let root = load_root_key()?;
    let state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime(&state, owner_pubkey)?;
    let key_version = runtime
        .store
        .active_owner_key_version(owner_pubkey)
        .map_err(map_store_read_error)?;
    let namespace = owner_brain_namespace(owner_pubkey, key_version)?;
    let namespace_key =
        derive_namespace_key(&root, &namespace).map_err(|_| OwnerBrainStoreError::Invalid)?;
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

fn read_catalog_from_generation(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
    namespace_key: &[u8; 32],
) -> Result<OwnerBrainCatalogV1, OwnerBrainStoreError> {
    let mut sources = Vec::new();
    for lineage in generation.snapshot.lineages.iter().filter(|lineage| {
        lineage.namespace == *namespace.as_protocol()
            && lineage.record_type.as_str() == OWNER_BRAIN_SOURCE_RECORD
            && lineage.lifecycle == RevisionLifecycle::Active
    }) {
        let manifest: OwnerBrainSourceManifestV1 = decrypt_active_body(
            generation,
            lineage
                .active_head_record_id
                .as_ref()
                .ok_or(OwnerBrainStoreError::Invalid)?,
            namespace_key,
        )?;
        manifest.validate()?;
        let address =
            owner_brain_source_address(namespace.clone(), manifest.source.source_id.clone())?;
        if manifest.source.owner_pubkey != generation.token.owner_pubkey
            || lineage.scope != *address.as_protocol()
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        sources.push(OwnerBrainSourceSummaryV1 {
            source: manifest.source,
            file_count: manifest.file_count,
            chunk_count: manifest.chunk_count,
        });
    }
    sources.sort_by(|left, right| left.source.source_id.cmp(&right.source.source_id));
    let source_ids = sources
        .iter()
        .map(|source| source.source.source_id.clone())
        .collect::<BTreeSet<_>>();

    let mut grants = Vec::new();
    for lineage in generation.snapshot.lineages.iter().filter(|lineage| {
        lineage.namespace == *namespace.as_protocol()
            && lineage.record_type.as_str() == OWNER_BRAIN_GRANT_RECORD
            && lineage.lifecycle == RevisionLifecycle::Active
    }) {
        let source_id = lineage
            .scope
            .source_id
            .clone()
            .ok_or(OwnerBrainStoreError::Invalid)?;
        let address = owner_brain_source_address(namespace.clone(), source_id.clone())?;
        if lineage.scope != *address.as_protocol() || !source_ids.contains(&source_id) {
            return Err(OwnerBrainStoreError::Invalid);
        }
        let grant: BrainGrantV1 = decrypt_active_body(
            generation,
            lineage
                .active_head_record_id
                .as_ref()
                .ok_or(OwnerBrainStoreError::Invalid)?,
            namespace_key,
        )?;
        grant
            .validate()
            .map_err(|_| OwnerBrainStoreError::Invalid)?;
        if grant.owner_pubkey != generation.token.owner_pubkey
            || grant.source_scope_ref != address.as_protocol().scope_ref
            || grant.grant_id != lineage.lineage_root_id
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        grants.push(OwnerBrainStoredGrantV1 { source_id, grant });
    }
    grants.sort_by(|left, right| {
        left.source_id
            .cmp(&right.source_id)
            .then_with(|| left.grant.resident_pubkey.cmp(&right.grant.resident_pubkey))
    });
    Ok(OwnerBrainCatalogV1 { sources, grants })
}

#[allow(clippy::too_many_arguments)]
fn mutate_grant_with_runtime(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    source_id: OpaqueId,
    binding_ref: Sha256Ref,
    provider_egress: ProviderEgressV1,
    action: OwnerBrainGrantActionV1,
) -> Result<OwnerBrainGrantMutationResultV1, OwnerBrainStoreError> {
    if owner_pubkey == resident_pubkey {
        return Err(OwnerBrainStoreError::Invalid);
    }
    let provider_egress = effective_provider_egress(provider_egress);
    let key_version = runtime
        .store
        .active_owner_key_version(&owner_pubkey)
        .map_err(map_store_read_error)?;
    let namespace = owner_brain_namespace(&owner_pubkey, key_version)?;
    let namespace_key =
        derive_namespace_key(root, &namespace).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let generation = runtime
        .store
        .load_revision_generation(&owner_pubkey)
        .map_err(map_store_read_error)?
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let _manifest = find_source_by_id(
        &generation,
        &namespace,
        namespace_key.as_bytes(),
        &source_id,
    )?
    .ok_or(OwnerBrainStoreError::Invalid)?;
    let address = owner_brain_source_address(namespace, source_id.clone())?;
    let grant_id = grant_lineage_id(&source_id, &resident_pubkey)?;
    let existing = find_grant(
        &generation,
        &address,
        namespace_key.as_bytes(),
        &grant_id,
        &resident_pubkey,
    )?;
    let existing_effective = existing
        .as_ref()
        .map(|grant| effective_grant_state(grant, Some(&binding_ref), Some(provider_egress)));

    let replay = matches!(
        (action, existing_effective),
        (
            OwnerBrainGrantActionV1::Grant,
            Some(BrainGrantStateV1::Active)
        ) | (
            OwnerBrainGrantActionV1::Reconfirm,
            Some(BrainGrantStateV1::Active)
        ) | (
            OwnerBrainGrantActionV1::Revoke,
            Some(BrainGrantStateV1::Revoked)
        )
    );
    if replay {
        return Ok(OwnerBrainGrantMutationResultV1 {
            source_id,
            grant: existing.ok_or(OwnerBrainStoreError::Invalid)?,
            replayed: true,
        });
    }
    match (action, existing_effective) {
        (OwnerBrainGrantActionV1::Grant, None | Some(BrainGrantStateV1::Revoked))
        | (OwnerBrainGrantActionV1::Reconfirm, Some(BrainGrantStateV1::Stale))
        | (
            OwnerBrainGrantActionV1::Revoke,
            Some(BrainGrantStateV1::Active | BrainGrantStateV1::Stale),
        ) => {}
        (OwnerBrainGrantActionV1::Grant, Some(BrainGrantStateV1::Stale)) => {
            return Err(OwnerBrainStoreError::Stale);
        }
        _ => return Err(OwnerBrainStoreError::Invalid),
    }

    let now = canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let version = existing
        .as_ref()
        .map(|grant| grant.grant_version.get())
        .unwrap_or(0)
        .checked_add(1)
        .and_then(|value| SafeU53::new(value).ok())
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let state = if action == OwnerBrainGrantActionV1::Revoke {
        BrainGrantStateV1::Revoked
    } else {
        BrainGrantStateV1::Active
    };
    let grant = BrainGrantV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        grant_id: grant_id.clone(),
        owner_pubkey: owner_pubkey.clone(),
        resident_pubkey,
        source_scope_ref: address.as_protocol().scope_ref.clone(),
        provider_egress,
        binding_ref,
        grant_version: version,
        state,
        created_at: existing
            .as_ref()
            .map(|grant| grant.created_at.clone())
            .unwrap_or_else(|| now.clone()),
        revoked_at: (state == BrainGrantStateV1::Revoked).then_some(now.clone()),
    };
    grant
        .validate()
        .map_err(|_| OwnerBrainStoreError::Invalid)?;
    let content_ref = sha_ref_for(&grant)?;
    let grant_version = grant.grant_version.get().to_string();
    let operation_id = digest_id(
        "brain-grant-operation",
        &[grant_id.as_str(), &grant_version, content_ref.as_str()],
    )?;
    let request = prepare_revision(
        Some(&generation),
        &address,
        key_version,
        namespace_key.as_bytes(),
        OWNER_BRAIN_GRANT_RECORD,
        grant_id,
        &content_ref,
        &operation_id,
        now,
        &grant,
    )?;
    let expectation = AuthorityExpectationV1::Existing(generation.token);
    let result = runtime
        .store
        .apply_owner_brain_grant_cas(&expectation, request)
        .map_err(map_store_write_error)?;
    let _authority_token = result.token;
    let _receipt = result.receipt;
    Ok(OwnerBrainGrantMutationResultV1 {
        source_id,
        grant,
        replayed: result.replayed,
    })
}

struct RankedOwnerBrainChunkV1 {
    source_id: OpaqueId,
    grant_id: OpaqueId,
    chunk_id: OpaqueId,
    body: RetrievalText,
    content_hash: Sha256Ref,
    score: i64,
}

struct OwnerBrainSourceDecisionV1 {
    source_id: OpaqueId,
    grant_id: OpaqueId,
    status: ContinuityLayerStatusV1,
    candidate_count: usize,
}

fn retrieve_from_generation(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
    namespace_key: &[u8; 32],
    request: OwnerBrainRetrievalRequestV1,
) -> Result<OwnerBrainRetrievalResultV1, OwnerBrainStoreError> {
    let started = Instant::now();
    require_before_deadline(request.deadline)?;
    let source_ids = active_source_ids(generation, namespace)?;
    if source_ids.is_empty() {
        return Ok(OwnerBrainRetrievalResultV1 {
            status: ContinuityLayerStatusV1::Empty,
            selected: Vec::new(),
            receipts: Vec::new(),
        });
    }

    let provider_egress = effective_provider_egress(request.provider_egress);
    let mut decisions = Vec::with_capacity(source_ids.len());
    let mut candidates = Vec::new();
    for source_id in source_ids {
        require_before_deadline(request.deadline)?;
        let address = owner_brain_source_address(namespace.clone(), source_id.clone())?;
        let grant_id = grant_lineage_id(&source_id, &request.resident_pubkey)?;
        let Some(grant) = find_grant(
            generation,
            &address,
            namespace_key,
            &grant_id,
            &request.resident_pubkey,
        )?
        else {
            decisions.push(OwnerBrainSourceDecisionV1 {
                source_id,
                grant_id,
                status: ContinuityLayerStatusV1::Denied,
                candidate_count: 0,
            });
            continue;
        };
        match effective_grant_state(&grant, Some(&request.binding_ref), Some(provider_egress)) {
            BrainGrantStateV1::Revoked => {
                decisions.push(OwnerBrainSourceDecisionV1 {
                    source_id,
                    grant_id,
                    status: ContinuityLayerStatusV1::Denied,
                    candidate_count: 0,
                });
                continue;
            }
            BrainGrantStateV1::Stale => {
                decisions.push(OwnerBrainSourceDecisionV1 {
                    source_id,
                    grant_id,
                    status: ContinuityLayerStatusV1::Stale,
                    candidate_count: 0,
                });
                continue;
            }
            BrainGrantStateV1::Active => {}
        }

        // Source manifests and chunk pages are decrypted only after the exact
        // resident grant has passed binding and egress validation above.
        let manifest = find_source_by_id(generation, namespace, namespace_key, &source_id)?
            .ok_or(OwnerBrainStoreError::Invalid)?;
        let chunks = load_active_source_chunks(
            generation,
            &address,
            namespace_key,
            &manifest,
            request.deadline,
        )?;
        let mut source_candidate_count = 0_usize;
        let records = chunks
            .into_iter()
            .map(|chunk| {
                RetrievalRecord::new(RetrievalRecordInput {
                    address: address.clone(),
                    record_id: chunk.chunk_id,
                    record_type: OpaqueId::parse("owner-brain-chunk")
                        .map_err(|_| OwnerBrainStoreError::Invalid)?,
                    revision: SafeU53::new(0).map_err(|_| OwnerBrainStoreError::Invalid)?,
                    body: RetrievalText::from(chunk.body),
                    tags: Vec::new(),
                    confidence_basis_points: 10_000,
                    provenance_refs: vec![chunk.content_hash],
                    outgoing_edges: Vec::new(),
                    state: RetrievalRecordState::Active,
                })
                .map_err(|_| OwnerBrainStoreError::Invalid)
            })
            .collect::<Result<Vec<_>, _>>()?;
        for batch in records.chunks(MAX_HYDRATED_RECORDS) {
            require_before_deadline(request.deadline)?;
            let index = InMemoryRetrievalIndex::hydrate(batch)
                .map_err(|_| OwnerBrainStoreError::Invalid)?;
            let retrieval = index
                .retrieve(
                    &RetrievalQuery {
                        address: address.clone(),
                        cue: request.cue.clone(),
                        query_vector: None,
                    },
                    None,
                )
                .map_err(|_| OwnerBrainStoreError::Invalid)?;
            source_candidate_count = source_candidate_count
                .checked_add(retrieval.hits.len())
                .ok_or(OwnerBrainStoreError::Invalid)?;
            for hit in retrieval.hits {
                let record = hit.record();
                let [content_hash] = record.provenance_refs() else {
                    return Err(OwnerBrainStoreError::Invalid);
                };
                candidates.push(RankedOwnerBrainChunkV1 {
                    source_id: source_id.clone(),
                    grant_id: grant_id.clone(),
                    chunk_id: record.record_id().clone(),
                    body: RetrievalText::from(record.body()),
                    content_hash: content_hash.clone(),
                    score: hit.score(),
                });
            }
        }
        decisions.push(OwnerBrainSourceDecisionV1 {
            source_id,
            grant_id,
            status: ContinuityLayerStatusV1::Empty,
            candidate_count: source_candidate_count,
        });
    }
    require_before_deadline(request.deadline)?;
    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.chunk_id.cmp(&right.chunk_id))
            .then_with(|| left.source_id.cmp(&right.source_id))
    });

    let mut selected = Vec::new();
    let mut selected_hashes = BTreeSet::new();
    let mut selected_bytes = 0_usize;
    for candidate in candidates {
        if selected.len() >= MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS {
            break;
        }
        let body_bytes = candidate.body.as_str().len();
        if selected_hashes.contains(&candidate.content_hash)
            || selected_bytes.saturating_add(body_bytes) > MAX_OWNER_BRAIN_RETRIEVAL_BYTES
        {
            continue;
        }
        selected_bytes += body_bytes;
        selected_hashes.insert(candidate.content_hash.clone());
        selected.push(OwnerBrainSelectedChunkV1 {
            source_id: candidate.source_id,
            grant_id: candidate.grant_id,
            chunk_id: candidate.chunk_id,
            body: candidate.body,
            content_hash: candidate.content_hash,
        });
    }

    let elapsed_ms = u64::try_from(started.elapsed().as_millis())
        .ok()
        .and_then(|value| SafeU53::new(value).ok())
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let created_at = canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let mut receipts = Vec::with_capacity(decisions.len());
    for decision in &decisions {
        let mut hashes = selected
            .iter()
            .filter(|chunk| chunk.source_id == decision.source_id)
            .map(|chunk| chunk.content_hash.clone())
            .collect::<Vec<_>>();
        hashes.sort();
        hashes.dedup();
        let byte_count = selected
            .iter()
            .filter(|chunk| chunk.source_id == decision.source_id)
            .try_fold(0_usize, |total, chunk| {
                total.checked_add(chunk.body.as_str().len())
            })
            .ok_or(OwnerBrainStoreError::Invalid)?;
        let status = if hashes.is_empty() {
            decision.status
        } else {
            ContinuityLayerStatusV1::Ready
        };
        let receipt = OwnerBrainContextReceiptV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            receipt_id: opaque_id("brain-receipt").map_err(|_| OwnerBrainStoreError::Invalid)?,
            request_id: request.request_id.clone(),
            owner_pubkey: request.owner_pubkey.clone(),
            resident_pubkey: request.resident_pubkey.clone(),
            source_id: decision.source_id.clone(),
            grant_id: decision.grant_id.clone(),
            status,
            selected_chunk_hashes: hashes,
            selected_byte_count: SafeU53::new(byte_count as u64)
                .map_err(|_| OwnerBrainStoreError::Invalid)?,
            truncated: decision.candidate_count
                > selected
                    .iter()
                    .filter(|chunk| chunk.source_id == decision.source_id)
                    .count(),
            duration_ms: elapsed_ms,
            created_at: created_at.clone(),
        };
        receipt
            .validate()
            .map_err(|_| OwnerBrainStoreError::Invalid)?;
        receipts.push(receipt);
    }
    let status = if !selected.is_empty() {
        ContinuityLayerStatusV1::Ready
    } else if decisions
        .iter()
        .any(|decision| decision.status == ContinuityLayerStatusV1::Empty)
    {
        ContinuityLayerStatusV1::Empty
    } else if decisions
        .iter()
        .any(|decision| decision.status == ContinuityLayerStatusV1::Stale)
    {
        ContinuityLayerStatusV1::Stale
    } else {
        ContinuityLayerStatusV1::Denied
    };
    Ok(OwnerBrainRetrievalResultV1 {
        status,
        selected,
        receipts,
    })
}

fn active_source_ids(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
) -> Result<Vec<OpaqueId>, OwnerBrainStoreError> {
    let mut source_ids = Vec::new();
    for lineage in generation.snapshot.lineages.iter().filter(|lineage| {
        lineage.namespace == *namespace.as_protocol()
            && lineage.record_type.as_str() == OWNER_BRAIN_SOURCE_RECORD
            && lineage.lifecycle == RevisionLifecycle::Active
    }) {
        let source_id = lineage
            .scope
            .source_id
            .clone()
            .ok_or(OwnerBrainStoreError::Invalid)?;
        let address = owner_brain_source_address(namespace.clone(), source_id.clone())?;
        if lineage.scope != *address.as_protocol() {
            return Err(OwnerBrainStoreError::Invalid);
        }
        source_ids.push(source_id);
    }
    source_ids.sort();
    if source_ids.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(OwnerBrainStoreError::Invalid);
    }
    Ok(source_ids)
}

fn load_active_source_chunks(
    generation: &StoredRevisionGenerationV1,
    address: &NamespaceScope,
    namespace_key: &[u8; 32],
    manifest: &OwnerBrainSourceManifestV1,
    deadline: Instant,
) -> Result<Vec<OwnerBrainChunkV1>, OwnerBrainStoreError> {
    let mut chunks = Vec::with_capacity(manifest.chunk_count.get() as usize);
    for (expected_index, lineage_id) in manifest.chunk_page_lineage_ids.iter().enumerate() {
        require_before_deadline(deadline)?;
        let matches = generation
            .snapshot
            .lineages
            .iter()
            .filter(|lineage| lineage.lineage_root_id == *lineage_id)
            .collect::<Vec<_>>();
        let [lineage] = matches.as_slice() else {
            return Err(OwnerBrainStoreError::Invalid);
        };
        if lineage.namespace != *address.namespace().as_protocol()
            || lineage.scope != *address.as_protocol()
            || lineage.record_type.as_str() != OWNER_BRAIN_CHUNK_PAGE_RECORD
            || lineage.lifecycle != RevisionLifecycle::Active
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        let page: OwnerBrainChunkPageV1 = decrypt_active_body(
            generation,
            lineage
                .active_head_record_id
                .as_ref()
                .ok_or(OwnerBrainStoreError::Invalid)?,
            namespace_key,
        )?;
        page.validate()?;
        if page.source_id != manifest.source.source_id
            || page.page_index.get() != expected_index as u64
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        for stored in page.chunks {
            chunks.push(stored.decode()?);
        }
    }
    chunks.sort_by_key(|chunk| chunk.ordinal);
    if chunks.len() != manifest.chunk_count.get() as usize
        || chunks
            .iter()
            .enumerate()
            .any(|(index, chunk)| chunk.ordinal.get() != index as u64)
        || chunks
            .iter()
            .map(|chunk| chunk.chunk_id.clone())
            .collect::<BTreeSet<_>>()
            .len()
            != chunks.len()
    {
        return Err(OwnerBrainStoreError::Invalid);
    }
    Ok(chunks)
}

fn require_before_deadline(deadline: Instant) -> Result<(), OwnerBrainStoreError> {
    if Instant::now() >= deadline {
        Err(OwnerBrainStoreError::Timeout)
    } else {
        Ok(())
    }
}

fn read_prior_snapshot_with_runtime(
    root: &ContinuityMasterKey,
    runtime: &ContinuityRuntime,
    canonical_path: &Path,
) -> Result<Option<PriorOwnerBrainSnapshotV1>, OwnerBrainStoreError> {
    let key_version = runtime
        .store
        .active_owner_key_version(&runtime.owner_pubkey)
        .map_err(map_store_read_error)?;
    let namespace = owner_brain_namespace(&runtime.owner_pubkey, key_version)?;
    let namespace_key =
        derive_namespace_key(root, &namespace).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let generation = runtime
        .store
        .load_revision_generation(&runtime.owner_pubkey)
        .map_err(map_store_read_error)?;
    let Some(generation) = generation else {
        return Ok(None);
    };
    let existing = find_source_by_path(
        &generation,
        &namespace,
        namespace_key.as_bytes(),
        canonical_path,
    )?;
    Ok(existing.map(|source| PriorOwnerBrainSnapshotV1::from_hashes(source.manifest.file_hashes)))
}

fn commit_preview_with_runtime(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    pending: PendingOwnerBrainPreviewV1,
) -> Result<(OwnerBrainImportCommitV1, bool), OwnerBrainStoreError> {
    require_not_cancelled(&pending)?;
    let owner = pending.preview.owner_pubkey.clone();
    let key_version = runtime
        .store
        .active_owner_key_version(&owner)
        .map_err(map_store_read_error)?;
    let namespace = owner_brain_namespace(&owner, key_version)?;
    let namespace_key =
        derive_namespace_key(root, &namespace).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let generation = runtime
        .store
        .load_revision_generation(&owner)
        .map_err(map_store_read_error)?;
    let existing = generation
        .as_ref()
        .map(|generation| {
            find_source_by_path(
                generation,
                &namespace,
                namespace_key.as_bytes(),
                &pending.canonical_path,
            )
        })
        .transpose()?
        .flatten();
    let source_id = existing
        .as_ref()
        .map(|source| source.manifest.source.source_id.clone())
        .unwrap_or(opaque_id("source").map_err(|_| OwnerBrainStoreError::Invalid)?);
    let address = owner_brain_source_address(namespace.clone(), source_id.clone())?;
    let staged = stage_source(&pending, &source_id)?;

    if let Some(existing) = &existing {
        if existing.manifest.source.root_hash == pending.preview.root_snapshot_hash {
            claim_commit(&pending)?;
            let commit = committed_receipt(
                &pending,
                existing.manifest.source.import_transaction_id.clone(),
                source_id,
                existing.manifest.file_count,
                existing.manifest.chunk_count,
            )?;
            return Ok((commit, true));
        }
    }

    let import_transaction_id = opaque_id("import").map_err(|_| OwnerBrainStoreError::Invalid)?;
    let now = canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let created_at = existing
        .as_ref()
        .map(|value| value.manifest.source.created_at.clone())
        .unwrap_or_else(|| now.clone());
    let pages = build_chunk_pages(&source_id, &staged.chunks)?;
    if pages.len() > MAX_OWNER_BRAIN_CHUNK_PAGES {
        return Err(OwnerBrainStoreError::Invalid);
    }
    let page_lineages = pages
        .iter()
        .map(|page| page_lineage_id(&source_id, page.page_index))
        .collect::<Result<Vec<_>, _>>()?;
    let source = OwnerBrainSourceV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        source_id: source_id.clone(),
        owner_pubkey: owner.clone(),
        source_kind: pending.preview.source_kind,
        display_name: pending.preview.display_name.clone(),
        root_hash: pending.preview.root_snapshot_hash.clone(),
        import_transaction_id: import_transaction_id.clone(),
        created_at,
        updated_at: now.clone(),
        status: OwnerBrainSourceStatusV1::Ready,
    };
    source
        .validate()
        .map_err(|_| OwnerBrainStoreError::Invalid)?;
    let manifest = OwnerBrainSourceManifestV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        source,
        file_hashes: staged.file_hashes,
        chunk_page_lineage_ids: page_lineages.clone(),
        file_count: SafeU53::new(
            pending
                .preview
                .rows
                .iter()
                .filter(|row| eligible(row.status))
                .count() as u64,
        )
        .map_err(|_| OwnerBrainStoreError::Invalid)?,
        chunk_count: SafeU53::new(staged.chunks.len() as u64)
            .map_err(|_| OwnerBrainStoreError::Invalid)?,
    };
    manifest.validate()?;
    let canonical_path = pending
        .canonical_path
        .to_str()
        .ok_or(OwnerBrainStoreError::Invalid)?
        .to_owned();
    let binding = OwnerBrainSourceBindingV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        source_id: source_id.clone(),
        owner_pubkey: owner.clone(),
        canonical_path,
        last_snapshot_hash: pending.preview.root_snapshot_hash.clone(),
    };
    binding
        .validate()
        .map_err(|_| OwnerBrainStoreError::Invalid)?;

    let mut requests = Vec::with_capacity(pages.len() + 2);
    for (page, lineage_root) in pages.iter().zip(page_lineages) {
        require_not_cancelled(&pending)?;
        requests.push(prepare_revision(
            generation.as_ref(),
            &address,
            key_version,
            namespace_key.as_bytes(),
            OWNER_BRAIN_CHUNK_PAGE_RECORD,
            lineage_root,
            &pending.preview.root_snapshot_hash,
            &import_transaction_id,
            now.clone(),
            page,
        )?);
    }
    requests.push(prepare_revision(
        generation.as_ref(),
        &address,
        key_version,
        namespace_key.as_bytes(),
        OWNER_BRAIN_BINDING_RECORD,
        binding_lineage_id(&source_id)?,
        &pending.preview.root_snapshot_hash,
        &import_transaction_id,
        now.clone(),
        &binding,
    )?);
    requests.push(prepare_revision(
        generation.as_ref(),
        &address,
        key_version,
        namespace_key.as_bytes(),
        OWNER_BRAIN_SOURCE_RECORD,
        source_id.clone(),
        &pending.preview.root_snapshot_hash,
        &import_transaction_id,
        now,
        &manifest,
    )?);
    let expectation = generation
        .as_ref()
        .map(|value| AuthorityExpectationV1::Existing(value.token.clone()))
        .unwrap_or_else(|| AuthorityExpectationV1::UninitializedOwner {
            owner_pubkey: owner,
            active_root_key_version: key_version,
        });
    claim_commit(&pending)?;
    let result = runtime
        .store
        .apply_owner_brain_import_cas(&expectation, requests)
        .map_err(map_store_write_error);
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            pending.commit_claimed.store(false, Ordering::Release);
            return Err(error);
        }
    };
    let _authority_token = result.token;
    let commit = committed_receipt(
        &pending,
        import_transaction_id,
        source_id,
        manifest.file_count,
        manifest.chunk_count,
    )?;
    Ok((commit, result.replayed))
}

fn committed_receipt(
    pending: &PendingOwnerBrainPreviewV1,
    import_transaction_id: OpaqueId,
    source_id: OpaqueId,
    imported_file_count: SafeU53,
    imported_chunk_count: SafeU53,
) -> Result<OwnerBrainImportCommitV1, OwnerBrainStoreError> {
    let commit = OwnerBrainImportCommitV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        import_transaction_id,
        preview_id: pending.preview.preview_id.clone(),
        source_id: Some(source_id),
        root_snapshot_hash: pending.preview.root_snapshot_hash.clone(),
        state: OwnerBrainImportStateV1::Committed,
        imported_file_count,
        imported_chunk_count,
        completed_at: canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?,
        error_code: None,
    };
    commit
        .validate()
        .map_err(|_| OwnerBrainStoreError::Invalid)?;
    Ok(commit)
}

fn stage_source(
    pending: &PendingOwnerBrainPreviewV1,
    source_id: &OpaqueId,
) -> Result<StagedOwnerBrainSourceV1, OwnerBrainStoreError> {
    require_not_cancelled(pending)?;
    let token_hash = pending.preview.preview_token_hash.clone();
    let before = preview_source_at_path(
        &pending.canonical_path,
        pending.preview.owner_pubkey.clone(),
        token_hash.clone(),
        None,
    )
    .map_err(|_| OwnerBrainStoreError::Invalid)?;
    if before.root_snapshot_hash != pending.preview.root_snapshot_hash {
        return Err(OwnerBrainStoreError::Stale);
    }
    let created_at = canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let mut chunks = Vec::new();
    let mut file_hashes = BTreeMap::new();
    for row in pending
        .preview
        .rows
        .iter()
        .filter(|row| eligible(row.status))
    {
        require_not_cancelled(pending)?;
        let expected_hash = row
            .content_hash
            .as_ref()
            .ok_or(OwnerBrainStoreError::Invalid)?;
        let path = source_row_path(&pending.canonical_path, &row.relative_path)?;
        let metadata = fs::symlink_metadata(&path).map_err(|_| OwnerBrainStoreError::Stale)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(OwnerBrainStoreError::Stale);
        }
        let bytes = fs::read(&path).map_err(|_| OwnerBrainStoreError::Stale)?;
        if bytes.len() as u64 != row.byte_count.get()
            || sha256_ref(&bytes).map_err(|_| OwnerBrainStoreError::Invalid)? != *expected_hash
        {
            return Err(OwnerBrainStoreError::Stale);
        }
        let text = std::str::from_utf8(&bytes).map_err(|_| OwnerBrainStoreError::Stale)?;
        let normalized = normalized_chunks(text);
        if normalized.is_empty() {
            return Err(OwnerBrainStoreError::Stale);
        }
        file_hashes.insert(row.relative_path.clone(), expected_hash.clone());
        for body in normalized {
            require_not_cancelled(pending)?;
            let ordinal =
                SafeU53::new(chunks.len() as u64).map_err(|_| OwnerBrainStoreError::Invalid)?;
            let content_hash =
                sha256_ref(body.as_bytes()).map_err(|_| OwnerBrainStoreError::Invalid)?;
            let ordinal_label = ordinal.get().to_string();
            let chunk_id = digest_id(
                "chunk",
                &[
                    source_id.as_str(),
                    ordinal_label.as_str(),
                    content_hash.as_str(),
                ],
            )?;
            let chunk = OwnerBrainChunkV1 {
                protocol: CONTINUITY_PROTOCOL.to_owned(),
                chunk_id,
                source_id: source_id.clone(),
                ordinal,
                body,
                content_hash,
                source_locator: row.relative_path.clone(),
                created_at: created_at.clone(),
            };
            chunk
                .validate()
                .map_err(|_| OwnerBrainStoreError::Invalid)?;
            chunks.push(chunk);
        }
    }
    if file_hashes.is_empty()
        || chunks.is_empty()
        || chunks.len() > MAX_OWNER_BRAIN_CHUNK_PAGES * OWNER_BRAIN_CHUNKS_PER_PAGE
    {
        return Err(OwnerBrainStoreError::Invalid);
    }
    let after = preview_source_at_path(
        &pending.canonical_path,
        pending.preview.owner_pubkey.clone(),
        token_hash,
        None,
    )
    .map_err(|_| OwnerBrainStoreError::Stale)?;
    if after.root_snapshot_hash != pending.preview.root_snapshot_hash {
        return Err(OwnerBrainStoreError::Stale);
    }
    Ok(StagedOwnerBrainSourceV1 {
        file_hashes,
        chunks,
    })
}

fn require_not_cancelled(pending: &PendingOwnerBrainPreviewV1) -> Result<(), OwnerBrainStoreError> {
    if pending.cancelled.load(Ordering::Acquire) {
        Err(OwnerBrainStoreError::Cancelled)
    } else {
        Ok(())
    }
}

fn claim_commit(pending: &PendingOwnerBrainPreviewV1) -> Result<(), OwnerBrainStoreError> {
    require_not_cancelled(pending)?;
    pending
        .commit_claimed
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map(|_| ())
        .map_err(|_| OwnerBrainStoreError::Stale)
}

fn normalized_chunks(text: &str) -> Vec<String> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut remaining = normalized.trim();
    let mut chunks = Vec::new();
    while !remaining.is_empty() {
        let mut end = remaining.len().min(MAX_OWNER_BRAIN_CHUNK_BYTES);
        while !remaining.is_char_boundary(end) {
            end -= 1;
        }
        let body = remaining[..end].trim();
        if !body.is_empty() {
            chunks.push(body.to_owned());
        }
        remaining = remaining[end..].trim_start();
    }
    chunks
}

fn build_chunk_pages(
    source_id: &OpaqueId,
    chunks: &[OwnerBrainChunkV1],
) -> Result<Vec<OwnerBrainChunkPageV1>, OwnerBrainStoreError> {
    chunks
        .chunks(OWNER_BRAIN_CHUNKS_PER_PAGE)
        .enumerate()
        .map(|(page_index, chunks)| {
            let page = OwnerBrainChunkPageV1 {
                protocol: CONTINUITY_PROTOCOL.to_owned(),
                source_id: source_id.clone(),
                page_index: SafeU53::new(page_index as u64)
                    .map_err(|_| OwnerBrainStoreError::Invalid)?,
                chunks: chunks
                    .iter()
                    .map(StoredOwnerBrainChunkV1::encode)
                    .collect::<Result<Vec<_>, _>>()?,
            };
            page.validate()?;
            Ok(page)
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn prepare_revision<T: Serialize>(
    generation: Option<&StoredRevisionGenerationV1>,
    address: &NamespaceScope,
    key_version: SafeU53,
    namespace_key: &[u8; 32],
    record_type: &'static str,
    lineage_root_id: OpaqueId,
    root_hash: &Sha256Ref,
    import_transaction_id: &OpaqueId,
    created_at: CanonicalTimestamp,
    body: &T,
) -> Result<RevisionRequest, OwnerBrainStoreError> {
    let record_type = OpaqueId::parse(record_type).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let (operation, expected_head_record_id, revision) =
        revision_coordinates(generation, address, &record_type, &lineage_root_id)?;
    let record_id = if operation == RevisionOperation::Create {
        lineage_root_id.clone()
    } else {
        digest_id(
            "brain-revision",
            &[lineage_root_id.as_str(), root_hash.as_str()],
        )?
    };
    let plaintext = canonicalize(body).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let successor = encrypt_record(
        luca_continuity::RecordMetadata {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            record_id,
            namespace: address.namespace().as_protocol().clone(),
            scope: address.as_protocol().clone(),
            record_type: record_type.clone(),
            revision,
            predecessor_record_id: expected_head_record_id.clone(),
            created_at,
            author_kind: OpaqueId::parse("owner").map_err(|_| OwnerBrainStoreError::Invalid)?,
            provenance_refs: vec![root_hash.clone()],
            key_version,
        },
        namespace_key,
        &plaintext,
    )
    .map_err(|_| OwnerBrainStoreError::Invalid)?;
    let request_ref = sha_ref_for(&serde_json::json!({
        "domain": OWNER_BRAIN_REQUEST_DOMAIN,
        "import_transaction_id": import_transaction_id,
        "lineage_root_id": lineage_root_id,
        "root_hash": root_hash,
        "operation": match operation {
            RevisionOperation::Create => "create",
            RevisionOperation::Revise => "revise",
            _ => return Err(OwnerBrainStoreError::Invalid),
        },
    }))?;
    let successor_ref =
        encrypted_record_reference(&successor).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let mut request = RevisionRequest {
        idempotency_key: request_ref.clone(),
        operation,
        lineage_root_id,
        expected_head_record_id,
        actor: RevisionActor::Owner,
        signed_source_event_refs: Vec::new(),
        request_ref,
        successor: Some(successor),
        successor_ciphertext_ref: Some(successor_ref),
        rollback_source_record_id: None,
        derived_artifact_refs: Vec::new(),
    };
    let record = request
        .successor
        .as_ref()
        .ok_or(OwnerBrainStoreError::Invalid)?;
    request.idempotency_key = derive_revision_idempotency_key(
        &record.namespace,
        &record.scope,
        &record.record_type,
        record.key_version,
        &request,
    )
    .map_err(|_| OwnerBrainStoreError::Invalid)?;
    Ok(request)
}

fn revision_coordinates(
    generation: Option<&StoredRevisionGenerationV1>,
    address: &NamespaceScope,
    record_type: &OpaqueId,
    lineage_root_id: &OpaqueId,
) -> Result<(RevisionOperation, Option<OpaqueId>, SafeU53), OwnerBrainStoreError> {
    let Some(generation) = generation else {
        return Ok((RevisionOperation::Create, None, SafeU53::new(0).unwrap()));
    };
    let lineage = generation
        .snapshot
        .lineages
        .iter()
        .find(|lineage| lineage.lineage_root_id == *lineage_root_id);
    let Some(lineage) = lineage else {
        return Ok((RevisionOperation::Create, None, SafeU53::new(0).unwrap()));
    };
    if lineage.namespace != *address.namespace().as_protocol()
        || lineage.scope != *address.as_protocol()
        || lineage.record_type != *record_type
        || lineage.lifecycle != RevisionLifecycle::Active
    {
        return Err(OwnerBrainStoreError::Invalid);
    }
    let head = lineage
        .active_head_record_id
        .clone()
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let head_record = generation
        .snapshot
        .records
        .iter()
        .find(|record| record.record_id == head)
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let revision = SafeU53::new(
        head_record
            .revision
            .get()
            .checked_add(1)
            .ok_or(OwnerBrainStoreError::Invalid)?,
    )
    .map_err(|_| OwnerBrainStoreError::Invalid)?;
    Ok((RevisionOperation::Revise, Some(head), revision))
}

fn find_source_by_path(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
    namespace_key: &[u8; 32],
    canonical_path: &Path,
) -> Result<Option<ExistingOwnerBrainSourceV1>, OwnerBrainStoreError> {
    let canonical_path = canonical_path
        .to_str()
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let mut matched = None;
    for lineage in generation.snapshot.lineages.iter().filter(|lineage| {
        lineage.namespace == *namespace.as_protocol()
            && lineage.record_type.as_str() == OWNER_BRAIN_BINDING_RECORD
            && lineage.lifecycle == RevisionLifecycle::Active
    }) {
        let binding: OwnerBrainSourceBindingV1 = decrypt_active_body(
            generation,
            lineage
                .active_head_record_id
                .as_ref()
                .ok_or(OwnerBrainStoreError::Invalid)?,
            namespace_key,
        )?;
        binding
            .validate()
            .map_err(|_| OwnerBrainStoreError::Invalid)?;
        if binding.owner_pubkey != generation.token.owner_pubkey {
            return Err(OwnerBrainStoreError::Invalid);
        }
        let address = owner_brain_source_address(namespace.clone(), binding.source_id.clone())?;
        if lineage.scope != *address.as_protocol() {
            return Err(OwnerBrainStoreError::Invalid);
        }
        if binding.canonical_path != canonical_path {
            continue;
        }
        if matched.is_some() {
            return Err(OwnerBrainStoreError::Invalid);
        }
        let source_lineages = generation
            .snapshot
            .lineages
            .iter()
            .filter(|candidate| {
                candidate.namespace == *address.namespace().as_protocol()
                    && candidate.scope == *address.as_protocol()
                    && candidate.record_type.as_str() == OWNER_BRAIN_SOURCE_RECORD
                    && candidate.lifecycle == RevisionLifecycle::Active
            })
            .collect::<Vec<_>>();
        let [source_lineage] = source_lineages.as_slice() else {
            return Err(OwnerBrainStoreError::Invalid);
        };
        let manifest: OwnerBrainSourceManifestV1 = decrypt_active_body(
            generation,
            source_lineage
                .active_head_record_id
                .as_ref()
                .ok_or(OwnerBrainStoreError::Invalid)?,
            namespace_key,
        )?;
        manifest.validate()?;
        if manifest.source.source_id != binding.source_id
            || manifest.source.owner_pubkey != binding.owner_pubkey
            || manifest.source.root_hash != binding.last_snapshot_hash
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        matched = Some(ExistingOwnerBrainSourceV1 { manifest, binding });
    }
    if matched
        .as_ref()
        .is_some_and(|source| source.binding.canonical_path != canonical_path)
    {
        return Err(OwnerBrainStoreError::Invalid);
    }
    Ok(matched)
}

fn find_source_by_id(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
    namespace_key: &[u8; 32],
    source_id: &OpaqueId,
) -> Result<Option<OwnerBrainSourceManifestV1>, OwnerBrainStoreError> {
    let address = owner_brain_source_address(namespace.clone(), source_id.clone())?;
    let matches = generation
        .snapshot
        .lineages
        .iter()
        .filter(|lineage| {
            lineage.namespace == *namespace.as_protocol()
                && lineage.scope == *address.as_protocol()
                && lineage.record_type.as_str() == OWNER_BRAIN_SOURCE_RECORD
                && lineage.lifecycle == RevisionLifecycle::Active
        })
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [] => Ok(None),
        [lineage] => {
            let manifest: OwnerBrainSourceManifestV1 = decrypt_active_body(
                generation,
                lineage
                    .active_head_record_id
                    .as_ref()
                    .ok_or(OwnerBrainStoreError::Invalid)?,
                namespace_key,
            )?;
            manifest.validate()?;
            if manifest.source.source_id != *source_id
                || manifest.source.owner_pubkey != generation.token.owner_pubkey
            {
                return Err(OwnerBrainStoreError::Invalid);
            }
            Ok(Some(manifest))
        }
        _ => Err(OwnerBrainStoreError::Invalid),
    }
}

fn find_grant(
    generation: &StoredRevisionGenerationV1,
    address: &NamespaceScope,
    namespace_key: &[u8; 32],
    grant_id: &OpaqueId,
    resident_pubkey: &Hex64,
) -> Result<Option<BrainGrantV1>, OwnerBrainStoreError> {
    let Some(lineage) = generation
        .snapshot
        .lineages
        .iter()
        .find(|lineage| lineage.lineage_root_id == *grant_id)
    else {
        return Ok(None);
    };
    if lineage.namespace != *address.namespace().as_protocol()
        || lineage.scope != *address.as_protocol()
        || lineage.record_type.as_str() != OWNER_BRAIN_GRANT_RECORD
        || lineage.lifecycle != RevisionLifecycle::Active
    {
        return Err(OwnerBrainStoreError::Invalid);
    }
    let grant: BrainGrantV1 = decrypt_active_body(
        generation,
        lineage
            .active_head_record_id
            .as_ref()
            .ok_or(OwnerBrainStoreError::Invalid)?,
        namespace_key,
    )?;
    grant
        .validate()
        .map_err(|_| OwnerBrainStoreError::Invalid)?;
    if grant.grant_id != *grant_id
        || grant.owner_pubkey != generation.token.owner_pubkey
        || grant.resident_pubkey != *resident_pubkey
        || grant.source_scope_ref != address.as_protocol().scope_ref
    {
        return Err(OwnerBrainStoreError::Invalid);
    }
    Ok(Some(grant))
}

fn decrypt_active_body<T: DeserializeOwned + Serialize>(
    generation: &StoredRevisionGenerationV1,
    record_id: &OpaqueId,
    namespace_key: &[u8; 32],
) -> Result<T, OwnerBrainStoreError> {
    let record = generation
        .snapshot
        .records
        .iter()
        .find(|record| record.record_id == *record_id)
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let body = decrypt_record(record, namespace_key).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let value =
        serde_json::from_slice::<T>(body.as_bytes()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    if canonicalize(&value).map_err(|_| OwnerBrainStoreError::Invalid)? != body.as_bytes() {
        return Err(OwnerBrainStoreError::Invalid);
    }
    Ok(value)
}

fn owner_brain_namespace(
    owner_pubkey: &Hex64,
    key_version: SafeU53,
) -> Result<NamespaceKey, OwnerBrainStoreError> {
    let namespace_ref = sha_ref_for(&serde_json::json!({
        "domain": OWNER_BRAIN_NAMESPACE_DOMAIN,
        "owner_pubkey": owner_pubkey,
    }))?;
    ContinuityNamespaceV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        owner_pubkey: owner_pubkey.clone(),
        kind: ContinuityNamespaceKindV1::OwnerBrain,
        resident_pubkey: None,
        namespace_ref,
        key_version,
    }
    .try_into()
    .map_err(|_| OwnerBrainStoreError::Invalid)
}

fn owner_brain_source_address(
    namespace: NamespaceKey,
    source_id: OpaqueId,
) -> Result<NamespaceScope, OwnerBrainStoreError> {
    let namespace_ref = namespace.as_protocol().namespace_ref.clone();
    let scope_ref = sha_ref_for(&serde_json::json!({
        "domain": OWNER_BRAIN_SCOPE_DOMAIN,
        "namespace_ref": namespace_ref,
        "source_id": source_id,
    }))?;
    NamespaceScope::new(
        namespace,
        ContinuityScopeV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            namespace_ref,
            scope_ref,
            source_id: Some(source_id),
            project_id: None,
            room_id: None,
            conversation_id: None,
        },
    )
    .map_err(|_| OwnerBrainStoreError::Invalid)
}

fn source_row_path(root: &Path, relative_path: &str) -> Result<PathBuf, OwnerBrainStoreError> {
    let relative = Path::new(relative_path);
    if !valid_relative_locator(relative_path) {
        return Err(OwnerBrainStoreError::Invalid);
    }
    let candidate = if root.is_file() {
        let file_name = root
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(OwnerBrainStoreError::Invalid)?;
        if relative_path != file_name {
            return Err(OwnerBrainStoreError::Invalid);
        }
        root.to_owned()
    } else {
        root.join(relative)
    };
    let canonical = fs::canonicalize(&candidate).map_err(|_| OwnerBrainStoreError::Stale)?;
    if root.is_file() && canonical != root || root.is_dir() && !canonical.starts_with(root) {
        return Err(OwnerBrainStoreError::Stale);
    }
    Ok(canonical)
}

fn valid_relative_locator(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= luca_protocol::MAX_OWNER_BRAIN_LOCATOR_BYTES
        && !Path::new(value).is_absolute()
        && !Path::new(value).components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
}

fn page_lineage_id(
    source_id: &OpaqueId,
    page_index: SafeU53,
) -> Result<OpaqueId, OwnerBrainStoreError> {
    let page = page_index.get().to_string();
    digest_id("brain-page", &[source_id.as_str(), &page])
}

fn binding_lineage_id(source_id: &OpaqueId) -> Result<OpaqueId, OwnerBrainStoreError> {
    digest_id("brain-binding", &[source_id.as_str()])
}

fn grant_lineage_id(
    source_id: &OpaqueId,
    resident_pubkey: &Hex64,
) -> Result<OpaqueId, OwnerBrainStoreError> {
    digest_id(
        "brain-grant",
        &[source_id.as_str(), resident_pubkey.as_str()],
    )
}

fn digest_id(prefix: &str, values: &[&str]) -> Result<OpaqueId, OwnerBrainStoreError> {
    let digest = canonical_sha256(&serde_json::json!({
        "domain": OWNER_BRAIN_RECORD_DOMAIN,
        "prefix": prefix,
        "values": values,
    }))
    .map_err(|_| OwnerBrainStoreError::Invalid)?;
    OpaqueId::parse(format!("{prefix}-{}", &digest[..40]))
        .map_err(|_| OwnerBrainStoreError::Invalid)
}

fn sha_ref_for<T: Serialize>(value: &T) -> Result<Sha256Ref, OwnerBrainStoreError> {
    canonical_sha256(value)
        .ok()
        .and_then(|digest| Sha256Ref::parse(format!("sha256:{digest}")).ok())
        .ok_or(OwnerBrainStoreError::Invalid)
}

fn eligible(status: OwnerBrainPreviewRowStatusV1) -> bool {
    matches!(
        status,
        OwnerBrainPreviewRowStatusV1::Accepted
            | OwnerBrainPreviewRowStatusV1::Duplicate
            | OwnerBrainPreviewRowStatusV1::Changed
    )
}

fn preview_expired(pending: &PendingOwnerBrainPreviewV1) -> bool {
    chrono::DateTime::parse_from_rfc3339(pending.preview.expires_at.as_str())
        .map(|expires| expires.timestamp() <= Utc::now().timestamp())
        .unwrap_or(true)
}

fn map_store_read_error(error: ContinuityStoreError) -> OwnerBrainStoreError {
    match error {
        ContinuityStoreError::LifecycleConflict | ContinuityStoreError::CompareAndSwapConflict => {
            OwnerBrainStoreError::Stale
        }
        ContinuityStoreError::Unavailable => OwnerBrainStoreError::Unavailable,
        _ => OwnerBrainStoreError::Invalid,
    }
}

fn map_store_write_error(error: ContinuityStoreError) -> OwnerBrainStoreError {
    map_store_read_error(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::luca::{
        continuity_store::{ContinuityStore, ContinuityStoreCustody, ContinuityStoreOpen},
        owner_brain::{create_preview, create_preview_with_prior},
    };

    fn owner() -> Hex64 {
        Hex64::parse("a".repeat(64)).unwrap()
    }

    fn runtime(temp: &tempfile::TempDir) -> ContinuityRuntime {
        let store = match ContinuityStore::open(temp.path(), ContinuityStoreCustody::Ready).unwrap()
        {
            ContinuityStoreOpen::Ready(store) => store,
            ContinuityStoreOpen::Degraded(_) => panic!("expected ready store"),
        };
        ContinuityRuntime {
            owner_pubkey: owner(),
            store,
        }
    }

    fn pending(
        cache: &OwnerBrainPreviewCache,
        handle: &super::super::owner_brain::OwnerBrainPreviewHandleV1,
    ) -> PendingOwnerBrainPreviewV1 {
        cache
            .lock()
            .unwrap()
            .get(handle.preview.preview_token_hash.as_str())
            .unwrap()
            .clone()
    }

    fn resident(fill: char) -> Hex64 {
        Hex64::parse(fill.to_string().repeat(64)).unwrap()
    }

    fn binding(fill: char) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{}", fill.to_string().repeat(64))).unwrap()
    }

    fn import_test_source(
        root: &ContinuityMasterKey,
        runtime: &mut ContinuityRuntime,
        source_path: &Path,
    ) -> OpaqueId {
        let cache = OwnerBrainPreviewCache::default();
        let handle = create_preview(&cache, owner(), source_path).unwrap();
        commit_preview_with_runtime(root, runtime, pending(&cache, &handle))
            .unwrap()
            .0
            .source_id
            .unwrap()
    }

    #[test]
    fn normalization_is_deterministic_utf8_bounded_and_nonblank() {
        let text = format!("  alpha\r\n{} omega  ", "🦊".repeat(2_000));
        let chunks = normalized_chunks(&text);
        assert!(chunks.len() > 1);
        assert!(chunks
            .iter()
            .all(|chunk| !chunk.trim().is_empty() && chunk.len() <= MAX_OWNER_BRAIN_CHUNK_BYTES));
        assert_eq!(chunks, normalized_chunks(&text));
    }

    #[test]
    fn stored_chunk_body_is_canonical_base64_and_round_trips() {
        let chunk = OwnerBrainChunkV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            chunk_id: OpaqueId::parse("chunk-fixture").unwrap(),
            source_id: OpaqueId::parse("source-fixture").unwrap(),
            ordinal: SafeU53::new(0).unwrap(),
            body: "A source-backed thought.".to_owned(),
            content_hash: sha256_ref(b"A source-backed thought.").unwrap(),
            source_locator: "notes/thought.md".to_owned(),
            created_at: CanonicalTimestamp::parse("2026-08-08T20:00:00Z").unwrap(),
        };
        let stored = StoredOwnerBrainChunkV1::encode(&chunk).unwrap();
        assert_eq!(stored.decode().unwrap(), chunk);
    }

    #[test]
    fn import_is_atomic_encrypted_idempotent_and_source_read_only() {
        let temp = tempfile::tempdir().unwrap();
        let source_root = temp.path().join("source");
        fs::create_dir(&source_root).unwrap();
        fs::write(source_root.join("one.md"), "Alpha fact.\n").unwrap();
        fs::write(source_root.join("two.txt"), "Beta fact.\n").unwrap();
        let before = [
            fs::read(source_root.join("one.md")).unwrap(),
            fs::read(source_root.join("two.txt")).unwrap(),
        ];
        let cache = OwnerBrainPreviewCache::default();
        let handle = create_preview(&cache, owner(), &source_root).unwrap();
        let first_pending = pending(&cache, &handle);
        let root = ContinuityMasterKey::new_for_test([7_u8; 32]);
        let mut runtime = runtime(&temp);

        let (first, replayed) =
            commit_preview_with_runtime(&root, &mut runtime, first_pending).unwrap();
        assert!(!replayed);
        assert_eq!(first.imported_file_count.get(), 2);
        assert!(first.imported_chunk_count.get() >= 2);
        assert_eq!(
            before,
            [
                fs::read(source_root.join("one.md")).unwrap(),
                fs::read(source_root.join("two.txt")).unwrap(),
            ]
        );
        let record_count = runtime
            .store
            .load_revision_generation(&owner())
            .unwrap()
            .unwrap()
            .snapshot
            .records
            .len();
        assert!(record_count >= 3);

        let prior = read_prior_snapshot_with_runtime(
            &root,
            &runtime,
            &fs::canonicalize(&source_root).unwrap(),
        )
        .unwrap()
        .unwrap();
        let second_handle =
            create_preview_with_prior(&cache, owner(), &source_root, Some(&prior)).unwrap();
        assert!(second_handle.preview.rows.iter().all(|row| {
            !eligible(row.status) || row.status == OwnerBrainPreviewRowStatusV1::Duplicate
        }));
        let (second, replayed) =
            commit_preview_with_runtime(&root, &mut runtime, pending(&cache, &second_handle))
                .unwrap();
        assert!(replayed);
        assert_eq!(first.source_id, second.source_id);
        assert_eq!(
            runtime
                .store
                .load_revision_generation(&owner())
                .unwrap()
                .unwrap()
                .snapshot
                .records
                .len(),
            record_count
        );
    }

    #[test]
    fn stale_preview_exposes_no_partial_records() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.md");
        fs::write(&source, "Original fact.\n").unwrap();
        let cache = OwnerBrainPreviewCache::default();
        let handle = create_preview(&cache, owner(), &source).unwrap();
        let pending = pending(&cache, &handle);
        fs::write(&source, "Changed after preview.\n").unwrap();
        let root = ContinuityMasterKey::new_for_test([8_u8; 32]);
        let mut runtime = runtime(&temp);

        assert_eq!(
            commit_preview_with_runtime(&root, &mut runtime, pending).unwrap_err(),
            OwnerBrainStoreError::Stale
        );
        assert!(runtime
            .store
            .load_revision_generation(&owner())
            .unwrap()
            .is_none());
    }

    #[test]
    fn cancellation_before_commit_claim_exposes_no_records() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.md");
        fs::write(&source, "Cancelable fact.\n").unwrap();
        let cache = OwnerBrainPreviewCache::default();
        let handle = create_preview(&cache, owner(), &source).unwrap();
        let pending = pending(&cache, &handle);

        assert!(
            cancel_preview(&cache, &owner(), &handle.preview.preview_id, &handle.token,).unwrap()
        );
        assert!(cache.lock().unwrap().is_empty());
        let root = ContinuityMasterKey::new_for_test([6_u8; 32]);
        let mut runtime = runtime(&temp);
        assert_eq!(
            commit_preview_with_runtime(&root, &mut runtime, pending).unwrap_err(),
            OwnerBrainStoreError::Cancelled
        );
        assert!(runtime
            .store
            .load_revision_generation(&owner())
            .unwrap()
            .is_none());
    }

    #[test]
    fn imports_create_no_grants_and_grant_lifecycles_are_independent() {
        let temp = tempfile::tempdir().unwrap();
        let first_path = temp.path().join("first.md");
        let second_path = temp.path().join("second.md");
        fs::write(&first_path, "First source fact.\n").unwrap();
        fs::write(&second_path, "Second source fact.\n").unwrap();
        let root = ContinuityMasterKey::new_for_test([3_u8; 32]);
        let mut runtime = runtime(&temp);
        let first_source = import_test_source(&root, &mut runtime, &first_path);
        let second_source = import_test_source(&root, &mut runtime, &second_path);

        let key_version = runtime.store.active_owner_key_version(&owner()).unwrap();
        let namespace = owner_brain_namespace(&owner(), key_version).unwrap();
        let namespace_key = derive_namespace_key(&root, &namespace).unwrap();
        let initial = read_catalog_from_generation(
            &runtime
                .store
                .load_revision_generation(&owner())
                .unwrap()
                .unwrap(),
            &namespace,
            namespace_key.as_bytes(),
        )
        .unwrap();
        assert_eq!(initial.sources.len(), 2);
        assert!(initial.grants.is_empty());

        let resident_b = resident('b');
        let resident_c = resident('c');
        let first_b = mutate_grant_with_runtime(
            &root,
            &mut runtime,
            owner(),
            resident_b.clone(),
            first_source.clone(),
            binding('1'),
            ProviderEgressV1::Remote,
            OwnerBrainGrantActionV1::Grant,
        )
        .unwrap();
        assert!(!first_b.replayed);
        let replay = mutate_grant_with_runtime(
            &root,
            &mut runtime,
            owner(),
            resident_b.clone(),
            first_source.clone(),
            binding('1'),
            ProviderEgressV1::Remote,
            OwnerBrainGrantActionV1::Grant,
        )
        .unwrap();
        assert!(replay.replayed);
        for (source, resident_key, fingerprint) in [
            (first_source.clone(), resident_c.clone(), binding('2')),
            (second_source.clone(), resident_b.clone(), binding('1')),
        ] {
            mutate_grant_with_runtime(
                &root,
                &mut runtime,
                owner(),
                resident_key,
                source,
                fingerprint,
                ProviderEgressV1::Remote,
                OwnerBrainGrantActionV1::Grant,
            )
            .unwrap();
        }
        let revoked = mutate_grant_with_runtime(
            &root,
            &mut runtime,
            owner(),
            resident_b.clone(),
            first_source.clone(),
            binding('1'),
            ProviderEgressV1::Remote,
            OwnerBrainGrantActionV1::Revoke,
        )
        .unwrap();
        assert_eq!(revoked.grant.state, BrainGrantStateV1::Revoked);

        let generation = runtime
            .store
            .load_revision_generation(&owner())
            .unwrap()
            .unwrap();
        let catalog =
            read_catalog_from_generation(&generation, &namespace, namespace_key.as_bytes())
                .unwrap();
        assert_eq!(catalog.grants.len(), 3);
        assert_eq!(
            catalog
                .grants
                .iter()
                .find(|stored| {
                    stored.source_id == first_source && stored.grant.resident_pubkey == resident_b
                })
                .unwrap()
                .grant
                .state,
            BrainGrantStateV1::Revoked
        );
        assert!(
            catalog
                .grants
                .iter()
                .filter(|stored| { stored.grant.state == BrainGrantStateV1::Active })
                .count()
                == 2
        );

        let restored = mutate_grant_with_runtime(
            &root,
            &mut runtime,
            owner(),
            resident_b,
            first_source,
            binding('1'),
            ProviderEgressV1::Remote,
            OwnerBrainGrantActionV1::Grant,
        )
        .unwrap();
        assert_eq!(restored.grant.state, BrainGrantStateV1::Active);
        assert_eq!(restored.grant.grant_version.get(), 3);
    }

    #[test]
    fn binding_or_egress_drift_is_stale_and_requires_reconfirmation() {
        let temp = tempfile::tempdir().unwrap();
        let source_path = temp.path().join("source.md");
        fs::write(&source_path, "Scoped source fact.\n").unwrap();
        let root = ContinuityMasterKey::new_for_test([4_u8; 32]);
        let mut runtime = runtime(&temp);
        let source_id = import_test_source(&root, &mut runtime, &source_path);
        let resident = resident('b');
        let original_binding = binding('1');
        let changed_binding = binding('2');

        let granted = mutate_grant_with_runtime(
            &root,
            &mut runtime,
            owner(),
            resident.clone(),
            source_id.clone(),
            original_binding.clone(),
            ProviderEgressV1::Unknown,
            OwnerBrainGrantActionV1::Grant,
        )
        .unwrap();
        assert_eq!(granted.grant.provider_egress, ProviderEgressV1::Remote);
        assert_eq!(
            effective_grant_state(
                &granted.grant,
                Some(&original_binding),
                Some(ProviderEgressV1::Unknown),
            ),
            BrainGrantStateV1::Active
        );
        assert_eq!(
            effective_grant_state(
                &granted.grant,
                Some(&changed_binding),
                Some(ProviderEgressV1::Remote),
            ),
            BrainGrantStateV1::Stale
        );
        assert_eq!(
            effective_grant_state(
                &granted.grant,
                Some(&original_binding),
                Some(ProviderEgressV1::Local),
            ),
            BrainGrantStateV1::Stale
        );
        assert_eq!(
            mutate_grant_with_runtime(
                &root,
                &mut runtime,
                owner(),
                resident.clone(),
                source_id.clone(),
                changed_binding.clone(),
                ProviderEgressV1::Remote,
                OwnerBrainGrantActionV1::Grant,
            )
            .unwrap_err(),
            OwnerBrainStoreError::Stale
        );

        let reconfirmed = mutate_grant_with_runtime(
            &root,
            &mut runtime,
            owner(),
            resident,
            source_id,
            changed_binding.clone(),
            ProviderEgressV1::Remote,
            OwnerBrainGrantActionV1::Reconfirm,
        )
        .unwrap();
        assert_eq!(reconfirmed.grant.grant_version.get(), 2);
        assert_eq!(
            effective_grant_state(
                &reconfirmed.grant,
                Some(&changed_binding),
                Some(ProviderEgressV1::Remote),
            ),
            BrainGrantStateV1::Active
        );
    }

    fn retrieval_request(
        resident_pubkey: Hex64,
        binding_ref: Sha256Ref,
        cue: &str,
    ) -> OwnerBrainRetrievalRequestV1 {
        OwnerBrainRetrievalRequestV1 {
            request_id: OpaqueId::parse("brain-context-request").unwrap(),
            owner_pubkey: owner(),
            resident_pubkey,
            binding_ref,
            provider_egress: ProviderEgressV1::Unknown,
            cue: RetrievalText::from(cue),
            deadline: Instant::now() + std::time::Duration::from_secs(2),
        }
    }

    fn corrupt_active_chunk_pages(generation: &mut StoredRevisionGenerationV1) {
        for record in &mut generation.snapshot.records {
            if record.record_type.as_str() == OWNER_BRAIN_CHUNK_PAGE_RECORD {
                record.ciphertext_b64 = "AAAA".to_owned();
            }
        }
    }

    #[test]
    fn retrieval_checks_grant_before_source_decryption_and_is_bounded() {
        let temp = tempfile::tempdir().unwrap();
        let source_path = temp.path().join("source.md");
        fs::write(&source_path, "vesper ".repeat(6_000)).unwrap();
        let root = ContinuityMasterKey::new_for_test([5_u8; 32]);
        let mut runtime = runtime(&temp);
        let source_id = import_test_source(&root, &mut runtime, &source_path);
        let resident = resident('b');
        let current_binding = binding('1');
        let key_version = runtime.store.active_owner_key_version(&owner()).unwrap();
        let namespace = owner_brain_namespace(&owner(), key_version).unwrap();
        let namespace_key = derive_namespace_key(&root, &namespace).unwrap();

        let mut denied_generation = runtime
            .store
            .load_revision_generation(&owner())
            .unwrap()
            .unwrap();
        corrupt_active_chunk_pages(&mut denied_generation);
        let denied = retrieve_from_generation(
            &denied_generation,
            &namespace,
            namespace_key.as_bytes(),
            retrieval_request(resident.clone(), current_binding.clone(), "vesper"),
        )
        .unwrap();
        assert_eq!(denied.status, ContinuityLayerStatusV1::Denied);
        assert!(denied.selected.is_empty());
        assert_eq!(denied.receipts.len(), 1);
        assert_eq!(denied.receipts[0].status, ContinuityLayerStatusV1::Denied);

        mutate_grant_with_runtime(
            &root,
            &mut runtime,
            owner(),
            resident.clone(),
            source_id.clone(),
            current_binding.clone(),
            ProviderEgressV1::Remote,
            OwnerBrainGrantActionV1::Grant,
        )
        .unwrap();
        let before = runtime
            .store
            .load_revision_generation(&owner())
            .unwrap()
            .unwrap();
        let retrieved = retrieve_from_generation(
            &before,
            &namespace,
            namespace_key.as_bytes(),
            retrieval_request(resident.clone(), current_binding.clone(), "vesper"),
        )
        .unwrap();
        assert_eq!(retrieved.status, ContinuityLayerStatusV1::Ready);
        assert!(!retrieved.selected.is_empty());
        assert!(retrieved.selected.len() <= MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS);
        assert!(
            retrieved
                .selected
                .iter()
                .map(|chunk| chunk.body.as_str().len())
                .sum::<usize>()
                <= MAX_OWNER_BRAIN_RETRIEVAL_BYTES
        );
        assert!(retrieved
            .selected
            .iter()
            .all(|chunk| chunk.source_id == source_id && chunk.body.as_str().contains("vesper")));
        assert_eq!(retrieved.receipts.len(), 1);
        assert_eq!(retrieved.receipts[0].status, ContinuityLayerStatusV1::Ready);
        assert!(retrieved.receipts[0].truncated);
        let receipt_json = serde_json::to_string(&retrieved.receipts).unwrap();
        assert!(!receipt_json.contains("vesper"));
        assert!(!receipt_json.contains(source_path.to_str().unwrap()));
        assert_eq!(
            before,
            runtime
                .store
                .load_revision_generation(&owner())
                .unwrap()
                .unwrap(),
            "retrieval must not advance persistent authority"
        );

        mutate_grant_with_runtime(
            &root,
            &mut runtime,
            owner(),
            resident.clone(),
            source_id.clone(),
            current_binding.clone(),
            ProviderEgressV1::Remote,
            OwnerBrainGrantActionV1::Revoke,
        )
        .unwrap();
        let mut revoked_generation = runtime
            .store
            .load_revision_generation(&owner())
            .unwrap()
            .unwrap();
        corrupt_active_chunk_pages(&mut revoked_generation);
        let revoked = retrieve_from_generation(
            &revoked_generation,
            &namespace,
            namespace_key.as_bytes(),
            retrieval_request(resident.clone(), current_binding.clone(), "vesper"),
        )
        .unwrap();
        assert_eq!(revoked.status, ContinuityLayerStatusV1::Denied);
        assert!(revoked.selected.is_empty());

        mutate_grant_with_runtime(
            &root,
            &mut runtime,
            owner(),
            resident.clone(),
            source_id,
            current_binding,
            ProviderEgressV1::Remote,
            OwnerBrainGrantActionV1::Grant,
        )
        .unwrap();
        let mut stale_generation = runtime
            .store
            .load_revision_generation(&owner())
            .unwrap()
            .unwrap();
        corrupt_active_chunk_pages(&mut stale_generation);
        let stale = retrieve_from_generation(
            &stale_generation,
            &namespace,
            namespace_key.as_bytes(),
            retrieval_request(resident, binding('2'), "vesper"),
        )
        .unwrap();
        assert_eq!(stale.status, ContinuityLayerStatusV1::Stale);
        assert!(stale.selected.is_empty());
        assert_eq!(stale.receipts[0].status, ContinuityLayerStatusV1::Stale);
    }

    #[test]
    fn owner_brain_batch_rolls_back_when_a_later_transition_is_invalid() {
        let temp = tempfile::tempdir().unwrap();
        let source_path = temp.path().join("source.md");
        fs::write(&source_path, "Atomic fact.\n").unwrap();
        let root = ContinuityMasterKey::new_for_test([9_u8; 32]);
        let mut runtime = runtime(&temp);
        let key_version = runtime.store.active_owner_key_version(&owner()).unwrap();
        let namespace = owner_brain_namespace(&owner(), key_version).unwrap();
        let namespace_key = derive_namespace_key(&root, &namespace).unwrap();
        let source_id = OpaqueId::parse("source-atomic-fixture").unwrap();
        let address = owner_brain_source_address(namespace, source_id.clone()).unwrap();
        let root_hash = sha256_ref(b"atomic-root").unwrap();
        let binding = OwnerBrainSourceBindingV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            source_id: source_id.clone(),
            owner_pubkey: owner(),
            canonical_path: fs::canonicalize(&source_path)
                .unwrap()
                .to_str()
                .unwrap()
                .to_owned(),
            last_snapshot_hash: root_hash.clone(),
        };
        let lineage = binding_lineage_id(&source_id).unwrap();
        let first = prepare_revision(
            None,
            &address,
            key_version,
            namespace_key.as_bytes(),
            OWNER_BRAIN_BINDING_RECORD,
            lineage.clone(),
            &root_hash,
            &OpaqueId::parse("import-one").unwrap(),
            CanonicalTimestamp::parse("2026-08-08T20:00:00Z").unwrap(),
            &binding,
        )
        .unwrap();
        let conflicting_second = prepare_revision(
            None,
            &address,
            key_version,
            namespace_key.as_bytes(),
            OWNER_BRAIN_BINDING_RECORD,
            lineage,
            &root_hash,
            &OpaqueId::parse("import-two").unwrap(),
            CanonicalTimestamp::parse("2026-08-08T20:00:01Z").unwrap(),
            &binding,
        )
        .unwrap();
        let expectation = AuthorityExpectationV1::UninitializedOwner {
            owner_pubkey: owner(),
            active_root_key_version: key_version,
        };

        assert!(runtime
            .store
            .apply_owner_brain_import_cas(&expectation, vec![first, conflicting_second])
            .is_err());
        assert!(runtime
            .store
            .load_revision_generation(&owner())
            .unwrap()
            .is_none());
    }
}
