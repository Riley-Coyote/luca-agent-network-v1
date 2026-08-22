use super::*;
use crate::luca::{
    connected_brain::{build_index, source_id_for_candidate, ConnectedBrainDiscoveryCandidateV1},
    continuity_store::{ContinuityStore, ContinuityStoreCustody, ContinuityStoreOpen},
};
use luca_continuity::{RetrievalText, RevisionLifecycle};
use luca_protocol::{
    ConnectedBrainSourceKindV1, ConnectedBrainSourceStatusV1, ContinuityLayerStatusV1,
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

fn candidate(path: &Path) -> ConnectedBrainDiscoveryCandidateV1 {
    ConnectedBrainDiscoveryCandidateV1 {
        discovery_id: OpaqueId::parse("discovery-reconnect-fixture").unwrap(),
        source_kind: ConnectedBrainSourceKindV1::Repository,
        display_name: "Reconnect fixture".to_owned(),
        canonical_root: path.canonicalize().unwrap(),
        item_count: 1,
        earliest_at: None,
        latest_at: None,
        discovered_at: Instant::now(),
    }
}

#[test]
fn disconnected_repository_reconnects_unchanged_without_reviving_forgotten_pages() {
    let temp = tempfile::tempdir().unwrap();
    let repository = temp.path().join("repository");
    fs::create_dir(&repository).unwrap();
    std::process::Command::new("git")
        .args(["init", "--quiet"])
        .arg(&repository)
        .status()
        .unwrap();
    fs::write(repository.join("fact.md"), "The reconnect bird is a heron.").unwrap();
    let root = ContinuityMasterKey::new_for_test([31_u8; 32]);
    let mut runtime = runtime(&temp);
    let candidate = candidate(&repository);
    let source_id = source_id_for_candidate(&candidate).unwrap();
    let authority = ConnectedBrainResidentAuthorityV1 {
        resident_pubkey: Hex64::parse("b".repeat(64)).unwrap(),
        binding_ref: Sha256Ref::parse(format!("sha256:{}", "1".repeat(64))).unwrap(),
        provider_egress: ProviderEgressV1::Remote,
    };

    connect_source_with_runtime(
        &root,
        &mut runtime,
        owner(),
        candidate.clone(),
        build_index(&source_id, &candidate).unwrap(),
        std::slice::from_ref(&authority),
    )
    .unwrap();
    fs::write(
        repository.join("fact.md"),
        "The reconnect bird is a heron. The reconnect tree is cedar.",
    )
    .unwrap();
    connect_source_with_runtime(
        &root,
        &mut runtime,
        owner(),
        candidate.clone(),
        build_index(&source_id, &candidate).unwrap(),
        std::slice::from_ref(&authority),
    )
    .unwrap();
    connected_lifecycle::disconnect_source_with_runtime(&root, &mut runtime, &owner(), &source_id)
        .unwrap();
    let disconnected = runtime
        .store
        .load_revision_generation(&owner())
        .unwrap()
        .unwrap();
    let forgotten_pages = disconnected
        .snapshot
        .lineages
        .iter()
        .filter(|lineage| lineage.record_type.as_str() == CONNECTED_INDEX_PAGE_RECORD)
        .map(|lineage| lineage.lineage_root_id.clone())
        .collect::<Vec<_>>();
    assert!(!forgotten_pages.is_empty());

    let reconnected = connect_source_with_runtime(
        &root,
        &mut runtime,
        owner(),
        candidate.clone(),
        build_index(&source_id, &candidate).unwrap(),
        std::slice::from_ref(&authority),
    )
    .unwrap();
    assert!(!reconnected.replayed);
    assert_eq!(
        reconnected.source.source.status,
        ConnectedBrainSourceStatusV1::Current
    );
    let generation = runtime
        .store
        .load_revision_generation(&owner())
        .unwrap()
        .unwrap();
    assert!(forgotten_pages.iter().all(|lineage_id| generation
        .snapshot
        .lineages
        .iter()
        .find(|lineage| lineage.lineage_root_id == *lineage_id)
        .is_some_and(|lineage| lineage.lifecycle == RevisionLifecycle::Forgotten)));
    assert!(generation.snapshot.lineages.iter().any(|lineage| {
        lineage.record_type.as_str() == CONNECTED_INDEX_PAGE_RECORD
            && lineage.lifecycle == RevisionLifecycle::Active
            && !forgotten_pages.contains(&lineage.lineage_root_id)
    }));

    let key_version = runtime.store.active_owner_key_version(&owner()).unwrap();
    let namespace = owner_brain_namespace(&owner(), key_version).unwrap();
    let namespace_key = derive_namespace_key(&root, &namespace).unwrap();
    let retrieved = retrieve_from_generation(
        &generation,
        &namespace,
        namespace_key.as_bytes(),
        OwnerBrainRetrievalRequestV1 {
            request_id: OpaqueId::parse("request-reconnected-repository").unwrap(),
            owner_pubkey: owner(),
            resident_pubkey: authority.resident_pubkey,
            binding_ref: authority.binding_ref,
            provider_egress: ProviderEgressV1::Remote,
            cue: RetrievalText::from("reconnect bird heron"),
            selected_source_ids: std::collections::BTreeSet::new(),
            deadline: Instant::now() + std::time::Duration::from_secs(2),
        },
    )
    .unwrap();
    assert_eq!(retrieved.status, ContinuityLayerStatusV1::Ready);
    assert!(!retrieved.selected.is_empty());
}

#[test]
fn moved_repository_rebind_preserves_source_identity_and_grants() {
    let temp = tempfile::tempdir().unwrap();
    let first_repository = temp.path().join("repository-first");
    let moved_repository = temp.path().join("repository-moved");
    for repository in [&first_repository, &moved_repository] {
        fs::create_dir(repository).unwrap();
        std::process::Command::new("git")
            .args(["init", "--quiet"])
            .arg(repository)
            .status()
            .unwrap();
    }
    fs::write(
        first_repository.join("fact.md"),
        "The old signal is quartz.",
    )
    .unwrap();
    fs::write(
        moved_repository.join("fact.md"),
        "The moved repository signal is juniper.",
    )
    .unwrap();
    let root = ContinuityMasterKey::new_for_test([41_u8; 32]);
    let mut runtime = runtime(&temp);
    let first_candidate = candidate(&first_repository);
    let source_id = source_id_for_candidate(&first_candidate).unwrap();
    let authority = ConnectedBrainResidentAuthorityV1 {
        resident_pubkey: Hex64::parse("c".repeat(64)).unwrap(),
        binding_ref: Sha256Ref::parse(format!("sha256:{}", "2".repeat(64))).unwrap(),
        provider_egress: ProviderEgressV1::Remote,
    };
    connect_source_with_runtime(
        &root,
        &mut runtime,
        owner(),
        first_candidate.clone(),
        build_index(&source_id, &first_candidate).unwrap(),
        std::slice::from_ref(&authority),
    )
    .unwrap();

    let moved_candidate = candidate(&moved_repository);
    let rebound = rebind_source_with_runtime(
        &root,
        &mut runtime,
        owner(),
        source_id.clone(),
        moved_candidate.clone(),
        build_index(&source_id, &moved_candidate).unwrap(),
    )
    .unwrap();
    assert_eq!(rebound.source.source.source_id, source_id);

    let generation = runtime
        .store
        .load_revision_generation(&owner())
        .unwrap()
        .unwrap();
    let key_version = runtime.store.active_owner_key_version(&owner()).unwrap();
    let namespace = owner_brain_namespace(&owner(), key_version).unwrap();
    let namespace_key = derive_namespace_key(&root, &namespace).unwrap();
    let binding = find_connected_binding(
        &generation,
        &namespace,
        namespace_key.as_bytes(),
        &source_id,
    )
    .unwrap();
    assert_eq!(
        PathBuf::from(binding.canonical_root),
        moved_repository.canonicalize().unwrap()
    );

    let retrieved = retrieve_from_generation(
        &generation,
        &namespace,
        namespace_key.as_bytes(),
        OwnerBrainRetrievalRequestV1 {
            request_id: OpaqueId::parse("request-rebound-repository").unwrap(),
            owner_pubkey: owner(),
            resident_pubkey: authority.resident_pubkey,
            binding_ref: authority.binding_ref,
            provider_egress: ProviderEgressV1::Remote,
            cue: RetrievalText::from("moved repository juniper"),
            selected_source_ids: std::collections::BTreeSet::from([source_id.clone()]),
            deadline: Instant::now() + std::time::Duration::from_secs(2),
        },
    )
    .unwrap();
    assert_eq!(retrieved.status, ContinuityLayerStatusV1::Ready);
    assert!(retrieved
        .selected
        .iter()
        .all(|chunk| chunk.source_id == source_id));
    assert_eq!(retrieved.receipts[0].selected_source_count.get(), 1);
    assert_eq!(retrieved.receipts[0].background_source_count.get(), 0);
}
