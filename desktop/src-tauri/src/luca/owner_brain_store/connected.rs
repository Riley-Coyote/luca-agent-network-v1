use super::*;
use crate::luca::connected_brain::{
    context_for_indexed_session, list_indexed_sessions, source_id_for_candidate,
    ConnectedBrainDiscoveryCandidateV1, ConnectedBrainIndexBuildV1, IndexedSessionContextV1,
    IndexedSessionListV1, SessionReadBudget,
};
use luca_protocol::{
    ConnectedBrainBindingV1, ConnectedBrainCapabilityV1, ConnectedBrainIndexEntryV1,
    ConnectedBrainPolicyV1, ConnectedBrainSourceKindV1, ConnectedBrainSourceStatusV1,
    ConnectedBrainSourceV1, RepositoryWorkGrantStateV1, RepositoryWorkGrantV1,
    CONNECTED_BRAIN_PROTOCOL, MAX_CONNECTED_INDEX_PAGE_ENTRIES, REPOSITORY_WORK_PROTOCOL,
};

pub(super) const CONNECTED_SOURCE_RECORD: &str = "connected-brain-source";
pub(super) const CONNECTED_BINDING_RECORD: &str = "connected-brain-binding";
pub(super) const CONNECTED_INDEX_PAGE_RECORD: &str = "connected-brain-index-page";
pub(super) const REPOSITORY_WORK_GRANT_RECORD: &str = "repository-work-grant";
const MAX_CONNECTED_INDEX_PAGES: usize =
    super::super::continuity_revision_authority::MAX_OWNER_BRAIN_IMPORT_TRANSITIONS - 2;
const MAX_CONNECTED_INDEX_PAGE_PLAINTEXT_BYTES: usize = 768 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ConnectedBrainManifestV1 {
    pub(super) protocol: String,
    pub(super) source: ConnectedBrainSourceV1,
    pub(super) policy: ConnectedBrainPolicyV1,
    pub(super) index_page_lineage_ids: Vec<OpaqueId>,
    pub(super) item_count: SafeU53,
    pub(super) entry_count: SafeU53,
}

impl ConnectedBrainManifestV1 {
    pub(super) fn validate(&self) -> Result<(), OwnerBrainStoreError> {
        self.source
            .validate()
            .map_err(|_| OwnerBrainStoreError::Invalid)?;
        self.policy
            .validate()
            .map_err(|_| OwnerBrainStoreError::Invalid)?;
        let minimum_pages =
            (self.entry_count.get() as usize).div_ceil(MAX_CONNECTED_INDEX_PAGE_ENTRIES);
        if self.protocol != CONNECTED_BRAIN_PROTOCOL
            || self.source.protocol != CONNECTED_BRAIN_PROTOCOL
            || self.index_page_lineage_ids.is_empty()
            || self.index_page_lineage_ids.len() < minimum_pages
            || self.index_page_lineage_ids.len() > MAX_CONNECTED_INDEX_PAGES
            || self.item_count.get() == 0
            || self.entry_count.get() == 0
            || self
                .index_page_lineage_ids
                .iter()
                .collect::<BTreeSet<_>>()
                .len()
                != self.index_page_lineage_ids.len()
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ConnectedBrainIndexPageV1 {
    pub(super) protocol: String,
    pub(super) source_id: OpaqueId,
    pub(super) page_index: SafeU53,
    pub(super) entries: Vec<ConnectedBrainIndexEntryV1>,
}

impl ConnectedBrainIndexPageV1 {
    pub(super) fn validate(&self) -> Result<(), OwnerBrainStoreError> {
        if self.protocol != CONNECTED_BRAIN_PROTOCOL
            || self.entries.is_empty()
            || self.entries.len() > MAX_CONNECTED_INDEX_PAGE_ENTRIES
            || self
                .entries
                .iter()
                .any(|entry| entry.source_id != self.source_id || entry.validate().is_err())
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        Ok(())
    }
}

/// Trusted current authority for one resident at connection time.
#[derive(Clone)]
pub(crate) struct ConnectedBrainResidentAuthorityV1 {
    pub resident_pubkey: Hex64,
    pub binding_ref: Sha256Ref,
    pub provider_egress: ProviderEgressV1,
}

/// Owner-visible connected source summary without paths or bodies.
#[derive(Clone, Debug)]
pub(crate) struct ConnectedBrainSourceSummaryV1 {
    pub source: ConnectedBrainSourceV1,
    pub item_count: SafeU53,
    pub entry_count: SafeU53,
}

/// Safe catalog for the Brain connection inventory.
#[derive(Clone, Debug, Default)]
pub(crate) struct ConnectedBrainCatalogV1 {
    pub sources: Vec<ConnectedBrainSourceSummaryV1>,
    pub recall_grants: Vec<OwnerBrainStoredGrantV1>,
    pub repository_grants: Vec<RepositoryWorkGrantV1>,
}

/// Result of one explicit connect or refresh action.
#[derive(Clone, Debug)]
pub(crate) struct ConnectedBrainConnectResultV1 {
    pub source: ConnectedBrainSourceSummaryV1,
    pub replayed: bool,
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn connect_source(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: Hex64,
    candidate: ConnectedBrainDiscoveryCandidateV1,
    build: ConnectedBrainIndexBuildV1,
    authorities: &[ConnectedBrainResidentAuthorityV1],
) -> Result<ConnectedBrainConnectResultV1, OwnerBrainStoreError> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let root = load_root_key()?;
    let mut state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime_mut(&mut state, &owner_pubkey)?;
    connect_source_with_runtime(&root, runtime, owner_pubkey, candidate, build, authorities)
}

/// Rebind one existing connected source to a newly selected local root while
/// preserving its opaque source ID and all existing resident grants.
pub(crate) fn rebind_source(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: Hex64,
    source_id: OpaqueId,
    candidate: ConnectedBrainDiscoveryCandidateV1,
    build: ConnectedBrainIndexBuildV1,
) -> Result<ConnectedBrainConnectResultV1, OwnerBrainStoreError> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let root = load_root_key()?;
    let mut state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime_mut(&mut state, &owner_pubkey)?;
    rebind_source_with_runtime(&root, runtime, owner_pubkey, source_id, candidate, build)
}

pub(crate) fn read_connected_catalog(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
) -> Result<ConnectedBrainCatalogV1, OwnerBrainStoreError> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime(&state, owner_pubkey)?;
    read_connected_catalog_with_runtime(runtime, load_root_key)
}

pub(crate) fn rebind_source_with_runtime(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    owner_pubkey: Hex64,
    source_id: OpaqueId,
    candidate: ConnectedBrainDiscoveryCandidateV1,
    build: ConnectedBrainIndexBuildV1,
) -> Result<ConnectedBrainConnectResultV1, OwnerBrainStoreError> {
    if candidate.source_kind != ConnectedBrainSourceKindV1::Repository {
        return Err(OwnerBrainStoreError::Invalid);
    }
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
    let existing = find_connected_manifest(
        &generation,
        &namespace,
        namespace_key.as_bytes(),
        &source_id,
    )?
    .ok_or(OwnerBrainStoreError::Invalid)?;
    if existing.source.source_kind != ConnectedBrainSourceKindV1::Repository
        || existing.source.status == ConnectedBrainSourceStatusV1::Disconnected
    {
        return Err(OwnerBrainStoreError::Invalid);
    }
    let (build, pages) = bounded_index_pages(&source_id, build)?;
    let root_ref = canonical_sha256(&serde_json::json!({
        "domain": "connected-source-rebind-root.v1",
        "canonical_root": candidate
            .canonical_root
            .to_str()
            .ok_or(OwnerBrainStoreError::Invalid)?,
    }))
    .map_err(|_| OwnerBrainStoreError::Invalid)?;
    let persistence_revision = sha_ref_for(&serde_json::json!({
        "domain": "connected-index-rebind.v1",
        "source_id": source_id,
        "index_revision": build.index_revision,
        "root_ref": root_ref,
    }))?;
    persist_connected_index(
        runtime,
        Some(&generation),
        namespace,
        namespace_key.as_bytes(),
        owner_pubkey.clone(),
        source_id.clone(),
        &candidate,
        build,
        pages,
        Some(&existing),
        key_version,
        Some(persistence_revision),
    )?;
    let source =
        connected_source_by_id(root, runtime, &source_id)?.ok_or(OwnerBrainStoreError::Invalid)?;
    super::connected_lifecycle::purge_orphaned_index_pages(
        runtime,
        &owner_pubkey,
        &source_id,
        &source.index_page_lineage_ids,
    )?;
    Ok(ConnectedBrainConnectResultV1 {
        source: ConnectedBrainSourceSummaryV1 {
            source: source.source,
            item_count: source.item_count,
            entry_count: source.entry_count,
        },
        replayed: false,
    })
}

pub(super) fn read_connected_catalog_with_runtime(
    runtime: &ContinuityRuntime,
    load_root: impl FnOnce() -> Result<ContinuityMasterKey, OwnerBrainStoreError>,
) -> Result<ConnectedBrainCatalogV1, OwnerBrainStoreError> {
    let Some(generation) = runtime
        .store
        .load_revision_generation(&runtime.owner_pubkey)
        .map_err(map_store_read_error)?
    else {
        return Ok(ConnectedBrainCatalogV1::default());
    };
    let root = load_root()?;
    let key_version = runtime
        .store
        .active_owner_key_version(&runtime.owner_pubkey)
        .map_err(map_store_read_error)?;
    let namespace = owner_brain_namespace(&runtime.owner_pubkey, key_version)?;
    let namespace_key =
        derive_namespace_key(&root, &namespace).map_err(|_| OwnerBrainStoreError::Invalid)?;
    catalog_from_generation(&generation, &namespace, namespace_key.as_bytes())
}

pub(crate) fn read_connected_candidate(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
    source_id: &OpaqueId,
) -> Result<ConnectedBrainDiscoveryCandidateV1, OwnerBrainStoreError> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let root = load_root_key()?;
    let state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime(&state, owner_pubkey)?;
    let Some((generation, namespace, namespace_key)) = connected_generation(&root, runtime)? else {
        return Err(OwnerBrainStoreError::Invalid);
    };
    let manifest =
        find_connected_manifest(&generation, &namespace, namespace_key.as_bytes(), source_id)?
            .ok_or(OwnerBrainStoreError::Invalid)?;
    let binding =
        find_connected_binding(&generation, &namespace, namespace_key.as_bytes(), source_id)?;
    let canonical_root = PathBuf::from(binding.canonical_root)
        .canonicalize()
        .map_err(|_| OwnerBrainStoreError::Stale)?;
    Ok(ConnectedBrainDiscoveryCandidateV1 {
        discovery_id: digest_id("connected-refresh", &[source_id.as_str()])?,
        source_kind: manifest.source.source_kind,
        display_name: manifest.source.display_name,
        canonical_root,
        item_count: manifest.item_count.get() as usize,
        earliest_at: None,
        latest_at: manifest
            .source
            .last_refreshed_at
            .as_ref()
            .map(|value| value.as_str().to_owned()),
        discovered_at: Instant::now(),
    })
}

/// Read the bounded, renderer-safe session projection for one already-connected
/// Codex or Claude history source. The encrypted binding and relative locators
/// remain native-only; visible excerpts are reverified against the stored index.
pub(crate) fn read_connected_sessions(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
    source_id: &OpaqueId,
    budget: &mut SessionReadBudget,
) -> Result<IndexedSessionListV1, OwnerBrainStoreError> {
    let (canonical_root, kind, entries) = {
        let _guard = lifecycle
            .lock()
            .map_err(|_| OwnerBrainStoreError::Unavailable)?;
        let root = load_root_key()?;
        let state = runtime_state
            .lock()
            .map_err(|_| OwnerBrainStoreError::Unavailable)?;
        let runtime = ready_runtime(&state, owner_pubkey)?;
        connected_session_material(&root, runtime, source_id)?
    };
    list_indexed_sessions(&canonical_root, kind, source_id, &entries, budget)
        .map_err(|_| OwnerBrainStoreError::Invalid)
}

/// Resolve one opaque session selection into a bounded visible context
/// summary. A missing opaque ID is not an integrity error so callers can scan
/// multiple connected sources of the same runtime kind without exposing IDs.
pub(crate) fn read_connected_session_context(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
    source_id: &OpaqueId,
    session_id: &OpaqueId,
) -> Result<Option<IndexedSessionContextV1>, OwnerBrainStoreError> {
    let (canonical_root, kind, entries) = {
        let _guard = lifecycle
            .lock()
            .map_err(|_| OwnerBrainStoreError::Unavailable)?;
        let root = load_root_key()?;
        let state = runtime_state
            .lock()
            .map_err(|_| OwnerBrainStoreError::Unavailable)?;
        let runtime = ready_runtime(&state, owner_pubkey)?;
        connected_session_material(&root, runtime, source_id)?
    };
    context_for_indexed_session(&canonical_root, kind, source_id, &entries, session_id)
        .map_err(|_| OwnerBrainStoreError::Stale)
}

fn connected_session_material(
    root: &ContinuityMasterKey,
    runtime: &ContinuityRuntime,
    source_id: &OpaqueId,
) -> Result<
    (
        PathBuf,
        ConnectedBrainSourceKindV1,
        Vec<ConnectedBrainIndexEntryV1>,
    ),
    OwnerBrainStoreError,
> {
    let Some((generation, namespace, namespace_key)) = connected_generation(root, runtime)? else {
        return Err(OwnerBrainStoreError::Invalid);
    };
    let manifest =
        find_connected_manifest(&generation, &namespace, namespace_key.as_bytes(), source_id)?
            .ok_or(OwnerBrainStoreError::Invalid)?;
    if manifest.source.status == ConnectedBrainSourceStatusV1::Disconnected
        || !matches!(
            manifest.source.source_kind,
            ConnectedBrainSourceKindV1::CodexHistory | ConnectedBrainSourceKindV1::ClaudeHistory
        )
    {
        return Err(OwnerBrainStoreError::Invalid);
    }
    let binding =
        find_connected_binding(&generation, &namespace, namespace_key.as_bytes(), source_id)?;
    let canonical_root = PathBuf::from(binding.canonical_root)
        .canonicalize()
        .map_err(|_| OwnerBrainStoreError::Stale)?;
    let address = owner_brain_source_address(namespace, source_id.clone())?;
    let entries = super::connected_retrieval::load_connected_entries(
        &generation,
        &address,
        namespace_key.as_bytes(),
        &manifest,
        Instant::now() + std::time::Duration::from_secs(5),
    )?;
    Ok((canonical_root, manifest.source.source_kind, entries))
}

pub(super) fn connect_source_with_runtime(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    owner_pubkey: Hex64,
    candidate: ConnectedBrainDiscoveryCandidateV1,
    build: ConnectedBrainIndexBuildV1,
    authorities: &[ConnectedBrainResidentAuthorityV1],
) -> Result<ConnectedBrainConnectResultV1, OwnerBrainStoreError> {
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
        .map_err(map_store_read_error)?;
    let existing = generation
        .as_ref()
        .map(|generation| {
            connected_by_root(
                generation,
                &namespace,
                namespace_key.as_bytes(),
                &candidate.canonical_root,
            )
        })
        .transpose()?
        .flatten();
    let restore_disconnected_grants = existing.as_ref().is_some_and(|(manifest, _)| {
        manifest.source.status == ConnectedBrainSourceStatusV1::Disconnected
    });
    let source_id = existing
        .as_ref()
        .map(|(manifest, _)| manifest.source.source_id.clone())
        .unwrap_or(source_id_for_candidate(&candidate).map_err(|_| OwnerBrainStoreError::Invalid)?);
    let (build, pages) = bounded_index_pages(&source_id, build)?;
    let replayed = existing.as_ref().is_some_and(|(manifest, _)| {
        manifest.source.index_revision == build.index_revision
            && manifest.source.status == ConnectedBrainSourceStatusV1::Current
    });
    if !replayed {
        persist_connected_index(
            runtime,
            generation.as_ref(),
            namespace,
            namespace_key.as_bytes(),
            owner_pubkey.clone(),
            source_id.clone(),
            &candidate,
            build,
            pages,
            existing.as_ref().map(|(manifest, _)| manifest),
            key_version,
            None,
        )?;
    }
    let source =
        connected_source_by_id(root, runtime, &source_id)?.ok_or(OwnerBrainStoreError::Invalid)?;
    super::connected_lifecycle::purge_orphaned_index_pages(
        runtime,
        &owner_pubkey,
        &source_id,
        &source.index_page_lineage_ids,
    )?;
    for authority in authorities {
        if restore_disconnected_grants {
            restore_connected_grants(root, runtime, &source.source, authority)?;
        } else {
            ensure_connected_grants(root, runtime, &source.source, authority)?;
        }
    }
    Ok(ConnectedBrainConnectResultV1 {
        source: ConnectedBrainSourceSummaryV1 {
            source: source.source,
            item_count: source.item_count,
            entry_count: source.entry_count,
        },
        replayed,
    })
}

fn bounded_index_pages(
    source_id: &OpaqueId,
    mut build: ConnectedBrainIndexBuildV1,
) -> Result<(ConnectedBrainIndexBuildV1, Vec<ConnectedBrainIndexPageV1>), OwnerBrainStoreError> {
    let input_entries = std::mem::take(&mut build.entries);
    let mut entry_pages = Vec::<Vec<ConnectedBrainIndexEntryV1>>::new();
    let mut current = Vec::new();
    let mut current_bytes = 256_usize;

    for entry in input_entries {
        let entry_bytes = serde_json::to_vec(&entry)
            .map_err(|_| OwnerBrainStoreError::Invalid)?
            .len()
            .saturating_add(1);
        if entry_bytes.saturating_add(256) > MAX_CONNECTED_INDEX_PAGE_PLAINTEXT_BYTES {
            return Err(OwnerBrainStoreError::Invalid);
        }
        if !current.is_empty()
            && (current.len() == MAX_CONNECTED_INDEX_PAGE_ENTRIES
                || current_bytes.saturating_add(entry_bytes)
                    > MAX_CONNECTED_INDEX_PAGE_PLAINTEXT_BYTES)
        {
            entry_pages.push(std::mem::take(&mut current));
            current_bytes = 256;
            if entry_pages.len() == MAX_CONNECTED_INDEX_PAGES {
                break;
            }
        }
        current_bytes = current_bytes.saturating_add(entry_bytes);
        current.push(entry);
    }
    if !current.is_empty() && entry_pages.len() < MAX_CONNECTED_INDEX_PAGES {
        entry_pages.push(current);
    }
    let retained_entries = entry_pages
        .iter()
        .flat_map(|entries| entries.iter().cloned())
        .collect::<Vec<_>>();
    if retained_entries.is_empty() {
        return Err(OwnerBrainStoreError::Invalid);
    }
    build.index_revision = sha_ref_for(&retained_entries)?;
    build.refresh_cursor = build.index_revision.as_str().to_owned();
    build.entries = retained_entries;

    let pages = entry_pages
        .into_iter()
        .enumerate()
        .map(|(page_index, entries)| {
            let page = ConnectedBrainIndexPageV1 {
                protocol: CONNECTED_BRAIN_PROTOCOL.to_owned(),
                source_id: source_id.clone(),
                page_index: SafeU53::new(page_index as u64)
                    .map_err(|_| OwnerBrainStoreError::Invalid)?,
                entries,
            };
            page.validate()?;
            if serde_json::to_vec(&page)
                .map_err(|_| OwnerBrainStoreError::Invalid)?
                .len()
                > MAX_CONNECTED_INDEX_PAGE_PLAINTEXT_BYTES
            {
                return Err(OwnerBrainStoreError::Invalid);
            }
            Ok(page)
        })
        .collect::<Result<Vec<_>, OwnerBrainStoreError>>()?;
    Ok((build, pages))
}

#[allow(clippy::too_many_arguments)]
fn persist_connected_index(
    runtime: &mut ContinuityRuntime,
    generation: Option<&StoredRevisionGenerationV1>,
    namespace: NamespaceKey,
    namespace_key: &[u8; 32],
    owner_pubkey: Hex64,
    source_id: OpaqueId,
    candidate: &ConnectedBrainDiscoveryCandidateV1,
    build: ConnectedBrainIndexBuildV1,
    pages: Vec<ConnectedBrainIndexPageV1>,
    existing: Option<&ConnectedBrainManifestV1>,
    key_version: SafeU53,
    persistence_revision_override: Option<Sha256Ref>,
) -> Result<(), OwnerBrainStoreError> {
    let address = owner_brain_source_address(namespace, source_id.clone())?;
    let now = canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let created_at = existing
        .map(|manifest| manifest.source.created_at.clone())
        .unwrap_or_else(|| now.clone());
    let reconnect_generation = if existing.is_some_and(|manifest| {
        manifest.source.status == ConnectedBrainSourceStatusV1::Disconnected
    }) {
        Some(
            &generation
                .ok_or(OwnerBrainStoreError::Invalid)?
                .token
                .snapshot_fingerprint,
        )
    } else {
        None
    };
    let persistence_revision = persistence_revision_override.unwrap_or(
        reconnect_generation
            .map(|fingerprint| {
                sha_ref_for(&serde_json::json!({
                    "domain": "connected-index-reconnect",
                    "index_revision": build.index_revision,
                    "reconnect_generation": fingerprint,
                }))
            })
            .transpose()?
            .unwrap_or_else(|| build.index_revision.clone()),
    );
    let page_lineages = pages
        .iter()
        .map(|page| {
            let page_index = page.page_index.get().to_string();
            if let Some(reconnect_generation) = reconnect_generation {
                digest_id(
                    "connected-index-page-reconnect",
                    &[
                        source_id.as_str(),
                        build.index_revision.as_str(),
                        reconnect_generation.as_str(),
                        &page_index,
                    ],
                )
            } else {
                digest_id(
                    "connected-index-page",
                    &[
                        source_id.as_str(),
                        build.index_revision.as_str(),
                        &page_index,
                    ],
                )
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    let capabilities = if candidate.source_kind == ConnectedBrainSourceKindV1::Repository {
        vec![
            ConnectedBrainCapabilityV1::Recall,
            ConnectedBrainCapabilityV1::RepositoryRead,
            ConnectedBrainCapabilityV1::RepositoryRequestWrite,
        ]
    } else {
        vec![ConnectedBrainCapabilityV1::Recall]
    };
    let source = ConnectedBrainSourceV1 {
        protocol: CONNECTED_BRAIN_PROTOCOL.to_owned(),
        source_id: source_id.clone(),
        owner_pubkey: owner_pubkey.clone(),
        source_kind: candidate.source_kind,
        display_name: candidate.display_name.clone(),
        status: ConnectedBrainSourceStatusV1::Current,
        capabilities,
        index_revision: build.index_revision.clone(),
        created_at,
        updated_at: now.clone(),
        last_refreshed_at: Some(now.clone()),
    };
    source
        .validate()
        .map_err(|_| OwnerBrainStoreError::Invalid)?;
    let manifest = ConnectedBrainManifestV1 {
        protocol: CONNECTED_BRAIN_PROTOCOL.to_owned(),
        source,
        policy: default_policy(),
        index_page_lineage_ids: page_lineages.clone(),
        item_count: SafeU53::new(build.item_count as u64)
            .map_err(|_| OwnerBrainStoreError::Invalid)?,
        entry_count: SafeU53::new(build.entries.len() as u64)
            .map_err(|_| OwnerBrainStoreError::Invalid)?,
    };
    manifest.validate()?;
    let binding = ConnectedBrainBindingV1 {
        protocol: CONNECTED_BRAIN_PROTOCOL.to_owned(),
        source_id: source_id.clone(),
        owner_pubkey: owner_pubkey.clone(),
        canonical_root: candidate
            .canonical_root
            .to_str()
            .ok_or(OwnerBrainStoreError::Invalid)?
            .to_owned(),
        adapter_version: OpaqueId::parse("connected-v1")
            .map_err(|_| OwnerBrainStoreError::Invalid)?,
        refresh_cursor: Some(build.refresh_cursor),
    };
    binding
        .validate()
        .map_err(|_| OwnerBrainStoreError::Invalid)?;
    let operation_id = digest_id(
        "connected-index-operation",
        &[source_id.as_str(), persistence_revision.as_str()],
    )?;
    let mut requests = pages
        .iter()
        .zip(page_lineages)
        .map(|(page, lineage)| {
            prepare_revision(
                generation,
                &address,
                key_version,
                namespace_key,
                CONNECTED_INDEX_PAGE_RECORD,
                lineage,
                &persistence_revision,
                &operation_id,
                now.clone(),
                page,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    requests.push(prepare_revision(
        generation,
        &address,
        key_version,
        namespace_key,
        CONNECTED_BINDING_RECORD,
        digest_id("connected-binding", &[source_id.as_str()])?,
        &persistence_revision,
        &operation_id,
        now.clone(),
        &binding,
    )?);
    requests.push(prepare_revision(
        generation,
        &address,
        key_version,
        namespace_key,
        CONNECTED_SOURCE_RECORD,
        source_id,
        &persistence_revision,
        &operation_id,
        now,
        &manifest,
    )?);
    let expectation = generation
        .map(|value| AuthorityExpectationV1::Existing(value.token.clone()))
        .unwrap_or_else(|| AuthorityExpectationV1::UninitializedOwner {
            owner_pubkey,
            active_root_key_version: key_version,
        });
    runtime
        .store
        .apply_connected_brain_cas(&expectation, requests)
        .map_err(map_store_write_error)?;
    Ok(())
}

pub(super) fn ensure_connected_grants(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    source: &ConnectedBrainSourceV1,
    authority: &ConnectedBrainResidentAuthorityV1,
) -> Result<(), OwnerBrainStoreError> {
    ensure_connected_grants_with_reactivation(root, runtime, source, authority, false)
}

pub(super) fn restore_connected_grants(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    source: &ConnectedBrainSourceV1,
    authority: &ConnectedBrainResidentAuthorityV1,
) -> Result<(), OwnerBrainStoreError> {
    ensure_connected_grants_with_reactivation(root, runtime, source, authority, true)
}

fn ensure_connected_grants_with_reactivation(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    source: &ConnectedBrainSourceV1,
    authority: &ConnectedBrainResidentAuthorityV1,
    reactivate_revoked: bool,
) -> Result<(), OwnerBrainStoreError> {
    if source.owner_pubkey == authority.resident_pubkey {
        return Err(OwnerBrainStoreError::Invalid);
    }
    let key_version = runtime
        .store
        .active_owner_key_version(&source.owner_pubkey)
        .map_err(map_store_read_error)?;
    let namespace = owner_brain_namespace(&source.owner_pubkey, key_version)?;
    let namespace_key =
        derive_namespace_key(root, &namespace).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let generation = runtime
        .store
        .load_revision_generation(&source.owner_pubkey)
        .map_err(map_store_read_error)?
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let address = owner_brain_source_address(namespace, source.source_id.clone())?;
    let grant_id = grant_lineage_id(&source.source_id, &authority.resident_pubkey)?;
    let existing = find_grant(
        &generation,
        &address,
        namespace_key.as_bytes(),
        &grant_id,
        &authority.resident_pubkey,
    )?;
    let now = canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let provider_egress = effective_provider_egress(authority.provider_egress);
    let recall_is_current = existing.as_ref().is_some_and(|grant| {
        effective_grant_state(grant, Some(&authority.binding_ref), Some(provider_egress))
            == BrainGrantStateV1::Active
    });
    let preserve_revocation = !reactivate_revoked
        && existing
            .as_ref()
            .is_some_and(|grant| grant.state == BrainGrantStateV1::Revoked);
    if !recall_is_current && !preserve_revocation {
        let version = existing
            .as_ref()
            .map(|grant| grant.grant_version.get())
            .unwrap_or(0)
            .checked_add(1)
            .and_then(|value| SafeU53::new(value).ok())
            .ok_or(OwnerBrainStoreError::Invalid)?;
        let recall = BrainGrantV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            grant_id: grant_id.clone(),
            owner_pubkey: source.owner_pubkey.clone(),
            resident_pubkey: authority.resident_pubkey.clone(),
            source_scope_ref: address.as_protocol().scope_ref.clone(),
            provider_egress,
            binding_ref: authority.binding_ref.clone(),
            grant_version: version,
            state: BrainGrantStateV1::Active,
            created_at: existing
                .as_ref()
                .map(|grant| grant.created_at.clone())
                .unwrap_or_else(|| now.clone()),
            revoked_at: None,
        };
        recall
            .validate()
            .map_err(|_| OwnerBrainStoreError::Invalid)?;
        let recall_ref = sha_ref_for(&recall)?;
        let recall_operation = digest_id(
            "connected-recall-grant-operation",
            &[grant_id.as_str(), recall_ref.as_str()],
        )?;
        let recall_request = prepare_revision(
            Some(&generation),
            &address,
            key_version,
            namespace_key.as_bytes(),
            OWNER_BRAIN_GRANT_RECORD,
            grant_id,
            &recall_ref,
            &recall_operation,
            now.clone(),
            &recall,
        )?;
        runtime
            .store
            .apply_owner_brain_grant_cas(
                &AuthorityExpectationV1::Existing(generation.token),
                recall_request,
            )
            .map_err(map_store_write_error)?;
    }

    if source.source_kind == ConnectedBrainSourceKindV1::Repository {
        ensure_repository_grant(root, runtime, source, authority, now, reactivate_revoked)?;
    }
    Ok(())
}

fn ensure_repository_grant(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    source: &ConnectedBrainSourceV1,
    authority: &ConnectedBrainResidentAuthorityV1,
    now: CanonicalTimestamp,
    reactivate_revoked: bool,
) -> Result<(), OwnerBrainStoreError> {
    let key_version = runtime
        .store
        .active_owner_key_version(&source.owner_pubkey)
        .map_err(map_store_read_error)?;
    let namespace = owner_brain_namespace(&source.owner_pubkey, key_version)?;
    let namespace_key =
        derive_namespace_key(root, &namespace).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let generation = runtime
        .store
        .load_revision_generation(&source.owner_pubkey)
        .map_err(map_store_read_error)?
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let address = owner_brain_source_address(namespace, source.source_id.clone())?;
    let grant_id = repository_grant_lineage_id(&source.source_id, &authority.resident_pubkey)?;
    let existing =
        find_repository_grant(&generation, &address, namespace_key.as_bytes(), &grant_id)?;
    if existing.as_ref().is_some_and(|grant| {
        grant.state == RepositoryWorkGrantStateV1::Active
            && grant.binding_ref == authority.binding_ref
    }) {
        return Ok(());
    }
    if !reactivate_revoked
        && existing
            .as_ref()
            .is_some_and(|grant| grant.state == RepositoryWorkGrantStateV1::Revoked)
    {
        return Ok(());
    }
    let grant = RepositoryWorkGrantV1 {
        protocol: REPOSITORY_WORK_PROTOCOL.to_owned(),
        grant_id: grant_id.clone(),
        source_id: source.source_id.clone(),
        resident_pubkey: authority.resident_pubkey.clone(),
        binding_ref: authority.binding_ref.clone(),
        state: RepositoryWorkGrantStateV1::Active,
        created_at: existing
            .as_ref()
            .map(|grant| grant.created_at.clone())
            .unwrap_or_else(|| now.clone()),
        updated_at: now.clone(),
    };
    grant
        .validate()
        .map_err(|_| OwnerBrainStoreError::Invalid)?;
    let grant_ref = sha_ref_for(&grant)?;
    let operation_id = digest_id(
        "repository-work-grant-operation",
        &[grant_id.as_str(), grant_ref.as_str()],
    )?;
    let request = prepare_revision(
        Some(&generation),
        &address,
        key_version,
        namespace_key.as_bytes(),
        REPOSITORY_WORK_GRANT_RECORD,
        grant_id,
        &grant_ref,
        &operation_id,
        now,
        &grant,
    )?;
    runtime
        .store
        .apply_connected_brain_cas(
            &AuthorityExpectationV1::Existing(generation.token),
            vec![request],
        )
        .map_err(map_store_write_error)?;
    Ok(())
}

pub(super) fn connected_generation(
    root: &ContinuityMasterKey,
    runtime: &ContinuityRuntime,
) -> Result<
    Option<(
        StoredRevisionGenerationV1,
        NamespaceKey,
        ContinuityNamespaceKey,
    )>,
    OwnerBrainStoreError,
> {
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
    Ok(generation.map(|generation| (generation, namespace, namespace_key)))
}

pub(super) fn connected_source_by_id(
    root: &ContinuityMasterKey,
    runtime: &ContinuityRuntime,
    source_id: &OpaqueId,
) -> Result<Option<ConnectedBrainManifestV1>, OwnerBrainStoreError> {
    let Some((generation, namespace, namespace_key)) = connected_generation(root, runtime)? else {
        return Ok(None);
    };
    find_connected_manifest(&generation, &namespace, namespace_key.as_bytes(), source_id)
}

pub(super) fn catalog_from_generation(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
    namespace_key: &[u8; 32],
) -> Result<ConnectedBrainCatalogV1, OwnerBrainStoreError> {
    let mut sources = Vec::new();
    let mut source_ids = BTreeSet::new();
    for lineage in generation.snapshot.lineages.iter().filter(|lineage| {
        lineage.namespace == *namespace.as_protocol()
            && lineage.record_type.as_str() == CONNECTED_SOURCE_RECORD
            && lineage.lifecycle == RevisionLifecycle::Active
    }) {
        let manifest: ConnectedBrainManifestV1 = decrypt_active_body(
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
        if lineage.scope != *address.as_protocol()
            || manifest.source.owner_pubkey != generation.token.owner_pubkey
            || !source_ids.insert(manifest.source.source_id.clone())
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        sources.push(ConnectedBrainSourceSummaryV1 {
            source: manifest.source,
            item_count: manifest.item_count,
            entry_count: manifest.entry_count,
        });
    }
    sources.sort_by(|left, right| left.source.source_id.cmp(&right.source.source_id));
    let mut recall_grants = Vec::new();
    for lineage in generation.snapshot.lineages.iter().filter(|lineage| {
        lineage.namespace == *namespace.as_protocol()
            && lineage.record_type.as_str() == OWNER_BRAIN_GRANT_RECORD
            && lineage.lifecycle == RevisionLifecycle::Active
            && lineage
                .scope
                .source_id
                .as_ref()
                .is_some_and(|source_id| source_ids.contains(source_id))
    }) {
        let source_id = lineage
            .scope
            .source_id
            .clone()
            .ok_or(OwnerBrainStoreError::Invalid)?;
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
        let address = owner_brain_source_address(namespace.clone(), source_id.clone())?;
        if lineage.scope != *address.as_protocol()
            || grant.owner_pubkey != generation.token.owner_pubkey
            || grant.source_scope_ref != address.as_protocol().scope_ref
            || grant.grant_id != lineage.lineage_root_id
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        recall_grants.push(OwnerBrainStoredGrantV1 { source_id, grant });
    }
    recall_grants.sort_by(|left, right| {
        left.source_id
            .cmp(&right.source_id)
            .then_with(|| left.grant.resident_pubkey.cmp(&right.grant.resident_pubkey))
    });
    let mut repository_grants = Vec::new();
    for lineage in generation.snapshot.lineages.iter().filter(|lineage| {
        lineage.namespace == *namespace.as_protocol()
            && lineage.record_type.as_str() == REPOSITORY_WORK_GRANT_RECORD
            && lineage.lifecycle == RevisionLifecycle::Active
    }) {
        let grant: RepositoryWorkGrantV1 = decrypt_active_body(
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
        if !source_ids.contains(&grant.source_id) || grant.grant_id != lineage.lineage_root_id {
            return Err(OwnerBrainStoreError::Invalid);
        }
        repository_grants.push(grant);
    }
    repository_grants.sort_by(|left, right| {
        left.source_id
            .cmp(&right.source_id)
            .then_with(|| left.resident_pubkey.cmp(&right.resident_pubkey))
    });
    Ok(ConnectedBrainCatalogV1 {
        sources,
        recall_grants,
        repository_grants,
    })
}

pub(super) fn connected_source_ids_from_generation(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
    namespace_key: &[u8; 32],
) -> Result<BTreeSet<OpaqueId>, OwnerBrainStoreError> {
    let catalog = catalog_from_generation(generation, namespace, namespace_key)?;
    Ok(catalog
        .sources
        .into_iter()
        .map(|source| source.source.source_id)
        .collect())
}

#[cfg(test)]
pub(super) fn owner_catalog_accepts_connected(
    root: &ContinuityMasterKey,
    runtime: &ContinuityRuntime,
) -> bool {
    let Ok(Some((generation, namespace, namespace_key))) = connected_generation(root, runtime)
    else {
        return false;
    };
    super::grants::read_catalog_from_generation(&generation, &namespace, namespace_key.as_bytes())
        .is_ok()
}

fn connected_by_root(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
    namespace_key: &[u8; 32],
    root: &Path,
) -> Result<Option<(ConnectedBrainManifestV1, ConnectedBrainBindingV1)>, OwnerBrainStoreError> {
    let root = root.to_str().ok_or(OwnerBrainStoreError::Invalid)?;
    let mut found = None;
    for lineage in generation.snapshot.lineages.iter().filter(|lineage| {
        lineage.namespace == *namespace.as_protocol()
            && lineage.record_type.as_str() == CONNECTED_BINDING_RECORD
            && lineage.lifecycle == RevisionLifecycle::Active
    }) {
        let binding: ConnectedBrainBindingV1 = decrypt_active_body(
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
        if binding.canonical_root == root {
            if found.is_some() {
                return Err(OwnerBrainStoreError::Invalid);
            }
            let manifest =
                find_connected_manifest(generation, namespace, namespace_key, &binding.source_id)?
                    .ok_or(OwnerBrainStoreError::Invalid)?;
            found = Some((manifest, binding));
        }
    }
    Ok(found)
}

pub(super) fn find_connected_manifest(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
    namespace_key: &[u8; 32],
    source_id: &OpaqueId,
) -> Result<Option<ConnectedBrainManifestV1>, OwnerBrainStoreError> {
    let address = owner_brain_source_address(namespace.clone(), source_id.clone())?;
    let matches = generation
        .snapshot
        .lineages
        .iter()
        .filter(|lineage| {
            lineage.namespace == *namespace.as_protocol()
                && lineage.scope == *address.as_protocol()
                && lineage.record_type.as_str() == CONNECTED_SOURCE_RECORD
                && lineage.lifecycle == RevisionLifecycle::Active
        })
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [] => Ok(None),
        [lineage] => {
            let manifest: ConnectedBrainManifestV1 = decrypt_active_body(
                generation,
                lineage
                    .active_head_record_id
                    .as_ref()
                    .ok_or(OwnerBrainStoreError::Invalid)?,
                namespace_key,
            )?;
            manifest.validate()?;
            (manifest.source.source_id == *source_id)
                .then_some(manifest)
                .ok_or(OwnerBrainStoreError::Invalid)
                .map(Some)
        }
        _ => Err(OwnerBrainStoreError::Invalid),
    }
}

pub(super) fn find_connected_binding(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
    namespace_key: &[u8; 32],
    source_id: &OpaqueId,
) -> Result<ConnectedBrainBindingV1, OwnerBrainStoreError> {
    let address = owner_brain_source_address(namespace.clone(), source_id.clone())?;
    let lineage_id = digest_id("connected-binding", &[source_id.as_str()])?;
    let lineage = generation
        .snapshot
        .lineages
        .iter()
        .find(|lineage| {
            lineage.lineage_root_id == lineage_id
                && lineage.namespace == *namespace.as_protocol()
                && lineage.scope == *address.as_protocol()
                && lineage.record_type.as_str() == CONNECTED_BINDING_RECORD
                && lineage.lifecycle == RevisionLifecycle::Active
        })
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let binding: ConnectedBrainBindingV1 = decrypt_active_body(
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
    Ok(binding)
}

pub(super) fn find_repository_grant(
    generation: &StoredRevisionGenerationV1,
    address: &NamespaceScope,
    namespace_key: &[u8; 32],
    grant_id: &OpaqueId,
) -> Result<Option<RepositoryWorkGrantV1>, OwnerBrainStoreError> {
    let matches = generation
        .snapshot
        .lineages
        .iter()
        .filter(|lineage| {
            lineage.lineage_root_id == *grant_id
                && lineage.namespace == *address.namespace().as_protocol()
                && lineage.scope == *address.as_protocol()
                && lineage.record_type.as_str() == REPOSITORY_WORK_GRANT_RECORD
                && lineage.lifecycle == RevisionLifecycle::Active
        })
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [] => Ok(None),
        [lineage] => {
            let grant: RepositoryWorkGrantV1 = decrypt_active_body(
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
            Ok(Some(grant))
        }
        _ => Err(OwnerBrainStoreError::Invalid),
    }
}

pub(super) fn repository_grant_lineage_id(
    source_id: &OpaqueId,
    resident_pubkey: &Hex64,
) -> Result<OpaqueId, OwnerBrainStoreError> {
    digest_id(
        "repository-work-grant",
        &[source_id.as_str(), resident_pubkey.as_str()],
    )
}

fn default_policy() -> ConnectedBrainPolicyV1 {
    ConnectedBrainPolicyV1 {
        protocol: CONNECTED_BRAIN_PROTOCOL.to_owned(),
        all_current_residents: true,
        all_future_residents: true,
        remote_excerpt_egress: true,
        repository_read: true,
        repository_request_write: true,
    }
}

#[cfg(test)]
mod bounded_index_page_tests {
    use super::*;
    const REALISTIC_TOKEN_HASHES_PER_ENTRY: usize = 16;

    fn hash(value: usize) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{value:064x}")).expect("valid test hash")
    }

    #[test]
    fn large_session_indexes_fit_encrypted_record_and_revision_bounds() {
        let source_id = OpaqueId::parse("connected-large-session-fixture").unwrap();
        let token_hashes = (1..=REALISTIC_TOKEN_HASHES_PER_ENTRY)
            .map(hash)
            .collect::<Vec<_>>();
        let entries = (0..16_384)
            .map(|index| ConnectedBrainIndexEntryV1 {
                protocol: CONNECTED_BRAIN_PROTOCOL.to_owned(),
                entry_id: OpaqueId::parse(format!("connected-entry-{index}")).unwrap(),
                source_id: source_id.clone(),
                relative_locator: format!("sessions/{index:05}/conversation.jsonl"),
                ordinal: SafeU53::new(index as u64).unwrap(),
                content_hash: hash(index + REALISTIC_TOKEN_HASHES_PER_ENTRY + 1),
                token_hashes: token_hashes.clone(),
                captured_at: None,
            })
            .collect::<Vec<_>>();
        let original_entry_count = entries.len();
        let build = ConnectedBrainIndexBuildV1 {
            index_revision: hash(0),
            refresh_cursor: hash(0).as_str().to_owned(),
            item_count: 2_048,
            entries,
        };

        let (bounded, pages) = bounded_index_pages(&source_id, build).unwrap();

        assert!(!bounded.entries.is_empty());
        assert_eq!(bounded.entries.len(), original_entry_count);
        assert_eq!(
            pages.iter().map(|page| page.entries.len()).sum::<usize>(),
            bounded.entries.len()
        );
        assert!(pages.len() <= MAX_CONNECTED_INDEX_PAGES);
        assert!(pages.iter().all(|page| {
            serde_json::to_vec(page).unwrap().len() <= MAX_CONNECTED_INDEX_PAGE_PLAINTEXT_BYTES
        }));
        assert_ne!(bounded.index_revision, hash(0));
        assert_eq!(bounded.refresh_cursor, bounded.index_revision.as_str());
    }
}
