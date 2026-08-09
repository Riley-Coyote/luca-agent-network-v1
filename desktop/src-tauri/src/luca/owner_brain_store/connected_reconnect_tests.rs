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
            deadline: Instant::now() + std::time::Duration::from_secs(2),
        },
    )
    .unwrap();
    assert_eq!(retrieved.status, ContinuityLayerStatusV1::Ready);
    assert!(!retrieved.selected.is_empty());
}
