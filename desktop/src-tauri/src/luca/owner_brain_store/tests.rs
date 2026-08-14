use super::*;
use crate::luca::{
    continuity_store::{ContinuityStore, ContinuityStoreCustody, ContinuityStoreOpen},
    owner_brain::{create_preview, create_preview_with_prior},
};

fn owner() -> Hex64 {
    Hex64::parse("a".repeat(64)).unwrap()
}

fn runtime(temp: &tempfile::TempDir) -> ContinuityRuntime {
    let store = match ContinuityStore::open(temp.path(), ContinuityStoreCustody::Ready).unwrap() {
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
fn absent_owner_catalogs_are_empty_without_loading_custody_or_writing_state() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(&temp);
    assert!(runtime
        .store
        .load_revision_generation(&owner())
        .unwrap()
        .is_none());

    let catalog = read_catalog_with_runtime(&runtime, &owner(), || {
        panic!("an absent owner catalog must not load key custody")
    })
    .unwrap();
    assert!(catalog.sources.is_empty());
    assert!(catalog.grants.is_empty());

    let connected = super::connected::read_connected_catalog_with_runtime(&runtime, || {
        panic!("an absent connected catalog must not load key custody")
    })
    .unwrap();
    assert!(connected.sources.is_empty());
    assert!(connected.recall_grants.is_empty());
    assert!(connected.repository_grants.is_empty());
    assert!(runtime
        .store
        .load_revision_generation(&owner())
        .unwrap()
        .is_none());
}

#[test]
fn owner_mismatch_remains_invalid_and_does_not_initialize_a_catalog() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(&temp);
    let state = ContinuityRuntimeState::Ready(runtime);
    assert!(matches!(
        ready_runtime(&state, &resident('b')),
        Err(OwnerBrainStoreError::Invalid)
    ));
    let ContinuityRuntimeState::Ready(runtime) = state else {
        unreachable!()
    };
    assert!(runtime
        .store
        .load_revision_generation(&owner())
        .unwrap()
        .is_none());
}

fn connected_candidate(
    path: &Path,
) -> crate::luca::connected_brain::ConnectedBrainDiscoveryCandidateV1 {
    crate::luca::connected_brain::ConnectedBrainDiscoveryCandidateV1 {
        discovery_id: OpaqueId::parse("discovery-connected-fixture").unwrap(),
        source_kind: luca_protocol::ConnectedBrainSourceKindV1::Repository,
        display_name: "Connected fixture".to_owned(),
        canonical_root: path.canonicalize().unwrap(),
        item_count: 1,
        earliest_at: None,
        latest_at: None,
        discovered_at: Instant::now(),
    }
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
fn connected_repository_is_body_free_at_rest_and_hash_verified_on_retrieval() {
    let temp = tempfile::tempdir().unwrap();
    let repository = temp.path().join("repository");
    fs::create_dir(&repository).unwrap();
    std::process::Command::new("git")
        .args(["init", "--quiet"])
        .arg(&repository)
        .status()
        .unwrap();
    let canary = "The corpus-only launch color is cobalt.";
    fs::write(repository.join("fact.md"), canary).unwrap();
    let candidate = connected_candidate(&repository);
    let source_id = crate::luca::connected_brain::source_id_for_candidate(&candidate).unwrap();
    let build = crate::luca::connected_brain::build_index(&source_id, &candidate).unwrap();
    let root = ContinuityMasterKey::new_for_test([11_u8; 32]);
    let mut runtime = runtime(&temp);
    let resident = resident('b');
    let authority = ConnectedBrainResidentAuthorityV1 {
        resident_pubkey: resident.clone(),
        binding_ref: binding('1'),
        provider_egress: ProviderEgressV1::Remote,
    };

    let connected_result = connect_source_with_runtime(
        &root,
        &mut runtime,
        owner(),
        candidate,
        build,
        std::slice::from_ref(&authority),
    );
    let generation_after_connect = runtime.store.load_revision_generation(&owner()).unwrap();
    assert!(
        connected_result.is_ok(),
        "connect failed {:?}; generation records={:?} lineages={:?}",
        connected_result.as_ref().err(),
        generation_after_connect
            .as_ref()
            .map(|generation| generation.snapshot.records.len()),
        generation_after_connect
            .as_ref()
            .map(|generation| generation.snapshot.lineages.len())
    );
    let connected = connected_result.unwrap();
    assert!(!connected.replayed);
    assert_eq!(connected.source.source.source_id, source_id);
    let generation = runtime
        .store
        .load_revision_generation(&owner())
        .unwrap()
        .unwrap();
    let serialized = serde_json::to_string(&generation.snapshot).unwrap();
    assert!(!serialized.contains(canary));
    assert!(!serialized.contains(repository.to_str().unwrap()));

    let key_version = runtime.store.active_owner_key_version(&owner()).unwrap();
    let namespace = owner_brain_namespace(&owner(), key_version).unwrap();
    let namespace_key = derive_namespace_key(&root, &namespace).unwrap();
    let ready = retrieve_from_generation(
        &generation,
        &namespace,
        namespace_key.as_bytes(),
        OwnerBrainRetrievalRequestV1 {
            request_id: OpaqueId::parse("request-connected-ready").unwrap(),
            owner_pubkey: owner(),
            resident_pubkey: resident.clone(),
            binding_ref: binding('1'),
            provider_egress: ProviderEgressV1::Remote,
            cue: RetrievalText::from("launch color cobalt"),
            deadline: Instant::now() + std::time::Duration::from_secs(2),
        },
    )
    .unwrap();
    assert_eq!(ready.status, ContinuityLayerStatusV1::Ready);
    assert_eq!(ready.selected.len(), 1);
    assert_eq!(ready.selected[0].body.as_str(), canary);

    fs::write(repository.join("fact.md"), "The launch color changed.").unwrap();
    let stale = retrieve_from_generation(
        &generation,
        &namespace,
        namespace_key.as_bytes(),
        OwnerBrainRetrievalRequestV1 {
            request_id: OpaqueId::parse("request-connected-stale").unwrap(),
            owner_pubkey: owner(),
            resident_pubkey: resident,
            binding_ref: binding('1'),
            provider_egress: ProviderEgressV1::Remote,
            cue: RetrievalText::from("launch color cobalt"),
            deadline: Instant::now() + std::time::Duration::from_secs(2),
        },
    )
    .unwrap();
    assert_eq!(stale.status, ContinuityLayerStatusV1::Stale);
    assert!(stale.selected.is_empty());
}

#[test]
fn connected_refresh_reconfirm_future_resident_and_disconnect_are_fail_closed() {
    let temp = tempfile::tempdir().unwrap();
    let repository = temp.path().join("repository-lifecycle");
    fs::create_dir(&repository).unwrap();
    std::process::Command::new("git")
        .args(["init", "--quiet"])
        .arg(&repository)
        .status()
        .unwrap();
    fs::write(repository.join("fact.md"), "The release bird is a heron.").unwrap();
    let root = ContinuityMasterKey::new_for_test([12_u8; 32]);
    let mut runtime = runtime(&temp);
    let candidate = connected_candidate(&repository);
    let source_id = crate::luca::connected_brain::source_id_for_candidate(&candidate).unwrap();
    let first_authority = ConnectedBrainResidentAuthorityV1 {
        resident_pubkey: resident('b'),
        binding_ref: binding('1'),
        provider_egress: ProviderEgressV1::Remote,
    };
    connect_source_with_runtime(
        &root,
        &mut runtime,
        owner(),
        candidate,
        crate::luca::connected_brain::build_index(&source_id, &connected_candidate(&repository))
            .unwrap(),
        std::slice::from_ref(&first_authority),
    )
    .unwrap();

    assert!(super::connected::owner_catalog_accepts_connected(
        &root, &runtime
    ));

    let before_replay = runtime
        .store
        .load_revision_generation(&owner())
        .unwrap()
        .unwrap()
        .token;
    let replay = connect_source_with_runtime(
        &root,
        &mut runtime,
        owner(),
        connected_candidate(&repository),
        crate::luca::connected_brain::build_index(&source_id, &connected_candidate(&repository))
            .unwrap(),
        std::slice::from_ref(&first_authority),
    )
    .unwrap();
    assert!(replay.replayed);
    assert_eq!(
        before_replay,
        runtime
            .store
            .load_revision_generation(&owner())
            .unwrap()
            .unwrap()
            .token
    );

    let changed_binding = ConnectedBrainResidentAuthorityV1 {
        resident_pubkey: first_authority.resident_pubkey.clone(),
        binding_ref: binding('2'),
        provider_egress: ProviderEgressV1::Remote,
    };
    let generation = runtime
        .store
        .load_revision_generation(&owner())
        .unwrap()
        .unwrap();
    let key_version = runtime.store.active_owner_key_version(&owner()).unwrap();
    let namespace = owner_brain_namespace(&owner(), key_version).unwrap();
    let namespace_key = derive_namespace_key(&root, &namespace).unwrap();
    let stale = retrieve_from_generation(
        &generation,
        &namespace,
        namespace_key.as_bytes(),
        OwnerBrainRetrievalRequestV1 {
            request_id: OpaqueId::parse("request-connected-binding-stale").unwrap(),
            owner_pubkey: owner(),
            resident_pubkey: changed_binding.resident_pubkey.clone(),
            binding_ref: changed_binding.binding_ref.clone(),
            provider_egress: ProviderEgressV1::Remote,
            cue: RetrievalText::from("release bird heron"),
            deadline: Instant::now() + std::time::Duration::from_secs(2),
        },
    )
    .unwrap();
    assert_eq!(stale.status, ContinuityLayerStatusV1::Stale);
    super::connected::ensure_connected_grants(
        &root,
        &mut runtime,
        &replay.source.source,
        &changed_binding,
    )
    .unwrap();

    let future_authority = ConnectedBrainResidentAuthorityV1 {
        resident_pubkey: resident('c'),
        binding_ref: binding('3'),
        provider_egress: ProviderEgressV1::Local,
    };
    super::connected::ensure_connected_grants(
        &root,
        &mut runtime,
        &replay.source.source,
        &future_authority,
    )
    .unwrap();

    super::connected_lifecycle::revoke_connected_resident_with_runtime(
        &root,
        &mut runtime,
        &source_id,
        future_authority.resident_pubkey.clone(),
    )
    .unwrap();
    let (revoked_generation, revoked_namespace, revoked_namespace_key) =
        super::connected::connected_generation(&root, &runtime)
            .unwrap()
            .unwrap();
    let revoked_catalog = super::connected::catalog_from_generation(
        &revoked_generation,
        &revoked_namespace,
        revoked_namespace_key.as_bytes(),
    )
    .unwrap();
    assert!(revoked_catalog.recall_grants.iter().any(|stored| {
        stored.grant.resident_pubkey == future_authority.resident_pubkey
            && stored.grant.state == BrainGrantStateV1::Revoked
    }));
    assert!(revoked_catalog.repository_grants.iter().any(|grant| {
        grant.resident_pubkey == future_authority.resident_pubkey
            && grant.state == luca_protocol::RepositoryWorkGrantStateV1::Revoked
    }));
    super::connected::ensure_connected_grants(
        &root,
        &mut runtime,
        &replay.source.source,
        &future_authority,
    )
    .unwrap();

    let before_refresh = runtime
        .store
        .load_revision_generation(&owner())
        .unwrap()
        .unwrap();
    let old_index_lineages = before_refresh
        .snapshot
        .lineages
        .iter()
        .filter(|lineage| lineage.record_type.as_str() == CONNECTED_INDEX_PAGE_RECORD)
        .map(|lineage| lineage.lineage_root_id.clone())
        .collect::<Vec<_>>();
    fs::write(
        repository.join("fact.md"),
        "The release bird is a heron. The release tree is cedar.",
    )
    .unwrap();
    connect_source_with_runtime(
        &root,
        &mut runtime,
        owner(),
        connected_candidate(&repository),
        crate::luca::connected_brain::build_index(&source_id, &connected_candidate(&repository))
            .unwrap(),
        &[changed_binding.clone(), future_authority.clone()],
    )
    .unwrap();
    let refreshed = runtime
        .store
        .load_revision_generation(&owner())
        .unwrap()
        .unwrap();
    for lineage_id in &old_index_lineages {
        let lineage = refreshed
            .snapshot
            .lineages
            .iter()
            .find(|lineage| lineage.lineage_root_id == *lineage_id)
            .unwrap();
        assert_eq!(lineage.lifecycle, RevisionLifecycle::Forgotten);
        assert_eq!(
            lineage.purge_execution.as_ref().unwrap().status,
            luca_continuity::PurgeExecutionStatusV1::Completed
        );
        assert!(lineage.record_ids.iter().all(|record_id| refreshed
            .snapshot
            .records
            .iter()
            .all(|record| record.record_id != *record_id)));
    }

    super::connected_lifecycle::disconnect_source_with_runtime(
        &root,
        &mut runtime,
        &owner(),
        &source_id,
    )
    .unwrap();
    let (generation, namespace, namespace_key) =
        super::connected::connected_generation(&root, &runtime)
            .unwrap()
            .unwrap();
    let catalog = super::connected::catalog_from_generation(
        &generation,
        &namespace,
        namespace_key.as_bytes(),
    )
    .unwrap();
    assert_eq!(
        catalog.sources[0].source.status,
        luca_protocol::ConnectedBrainSourceStatusV1::Disconnected
    );
    assert!(catalog
        .repository_grants
        .iter()
        .all(|grant| grant.state == luca_protocol::RepositoryWorkGrantStateV1::Revoked));
    assert!(generation.snapshot.lineages.iter().all(|lineage| {
        lineage.record_type.as_str() != CONNECTED_INDEX_PAGE_RECORD
            || lineage.purge_execution.as_ref().is_some_and(|purge| {
                purge.status == luca_continuity::PurgeExecutionStatusV1::Completed
            })
    }));
    let denied = retrieve_from_generation(
        &generation,
        &namespace,
        namespace_key.as_bytes(),
        OwnerBrainRetrievalRequestV1 {
            request_id: OpaqueId::parse("request-connected-disconnected").unwrap(),
            owner_pubkey: owner(),
            resident_pubkey: changed_binding.resident_pubkey,
            binding_ref: changed_binding.binding_ref,
            provider_egress: ProviderEgressV1::Remote,
            cue: RetrievalText::from("release bird heron"),
            deadline: Instant::now() + std::time::Duration::from_secs(2),
        },
    )
    .unwrap();
    assert_eq!(denied.status, ContinuityLayerStatusV1::Denied);
    assert!(denied.selected.is_empty());
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

    let prior =
        read_prior_snapshot_with_runtime(&root, &runtime, &fs::canonicalize(&source_root).unwrap())
            .unwrap()
            .unwrap();
    let second_handle =
        create_preview_with_prior(&cache, owner(), &source_root, Some(&prior)).unwrap();
    assert!(second_handle.preview.rows.iter().all(|row| {
        !eligible(row.status) || row.status == OwnerBrainPreviewRowStatusV1::Duplicate
    }));
    let (second, replayed) =
        commit_preview_with_runtime(&root, &mut runtime, pending(&cache, &second_handle)).unwrap();
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

    assert!(cancel_preview(&cache, &owner(), &handle.preview.preview_id, &handle.token,).unwrap());
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
        read_catalog_from_generation(&generation, &namespace, namespace_key.as_bytes()).unwrap();
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
