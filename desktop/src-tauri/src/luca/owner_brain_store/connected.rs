use super::*;
use crate::luca::connected_brain::{
    source_id_for_candidate, ConnectedBrainDiscoveryCandidateV1, ConnectedBrainIndexBuildV1,
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
        let expected_pages =
            (self.entry_count.get() as usize).div_ceil(MAX_CONNECTED_INDEX_PAGE_ENTRIES);
        if self.protocol != CONNECTED_BRAIN_PROTOCOL
            || self.source.protocol != CONNECTED_BRAIN_PROTOCOL
            || self.index_page_lineage_ids.is_empty()
            || self.index_page_lineage_ids.len() != expected_pages
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

pub(crate) fn read_connected_catalog(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
) -> Result<ConnectedBrainCatalogV1, OwnerBrainStoreError> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let root = load_root_key()?;
    let state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime(&state, owner_pubkey)?;
    let Some((generation, namespace, namespace_key)) = connected_generation(&root, runtime)? else {
        return Ok(ConnectedBrainCatalogV1::default());
    };
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
    let source_id = existing
        .as_ref()
        .map(|(manifest, _)| manifest.source.source_id.clone())
        .unwrap_or(source_id_for_candidate(&candidate).map_err(|_| OwnerBrainStoreError::Invalid)?);
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
            existing.as_ref().map(|(manifest, _)| manifest),
            key_version,
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
        ensure_connected_grants(root, runtime, &source.source, authority)?;
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
    existing: Option<&ConnectedBrainManifestV1>,
    key_version: SafeU53,
) -> Result<(), OwnerBrainStoreError> {
    let address = owner_brain_source_address(namespace, source_id.clone())?;
    let now = canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let created_at = existing
        .map(|manifest| manifest.source.created_at.clone())
        .unwrap_or_else(|| now.clone());
    let pages = build
        .entries
        .chunks(MAX_CONNECTED_INDEX_PAGE_ENTRIES)
        .enumerate()
        .map(|(page_index, entries)| {
            let page = ConnectedBrainIndexPageV1 {
                protocol: CONNECTED_BRAIN_PROTOCOL.to_owned(),
                source_id: source_id.clone(),
                page_index: SafeU53::new(page_index as u64)
                    .map_err(|_| OwnerBrainStoreError::Invalid)?,
                entries: entries.to_vec(),
            };
            page.validate()?;
            Ok(page)
        })
        .collect::<Result<Vec<_>, OwnerBrainStoreError>>()?;
    if pages.len() + 2
        > super::super::continuity_revision_authority::MAX_OWNER_BRAIN_IMPORT_TRANSITIONS
    {
        return Err(OwnerBrainStoreError::Invalid);
    }
    let page_lineages = pages
        .iter()
        .map(|page| {
            digest_id(
                "connected-index-page",
                &[
                    source_id.as_str(),
                    build.index_revision.as_str(),
                    &page.page_index.get().to_string(),
                ],
            )
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
        &[source_id.as_str(), manifest.source.index_revision.as_str()],
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
                &manifest.source.index_revision,
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
        &manifest.source.index_revision,
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
        &manifest.source.index_revision,
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
    if !recall_is_current {
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
        ensure_repository_grant(root, runtime, source, authority, now)?;
    }
    Ok(())
}

fn ensure_repository_grant(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    source: &ConnectedBrainSourceV1,
    authority: &ConnectedBrainResidentAuthorityV1,
    now: CanonicalTimestamp,
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
        repository_grants,
    })
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
