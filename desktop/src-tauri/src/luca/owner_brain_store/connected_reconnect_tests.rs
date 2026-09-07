use super::*;
use crate::luca::{
    connected_brain::{build_index, source_id_for_candidate, ConnectedBrainDiscoveryCandidateV1},
    continuity_store::{ContinuityStore, ContinuityStoreCustody, ContinuityStoreOpen},
};
use luca_continuity::{
    PurgeExecutionStatusV1, RetrievalText, RevisionLedger, RevisionLedgerSnapshotV1,
    RevisionLifecycle,
};
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

fn purge_fixture_lineage(
    ledger: &mut RevisionLedger,
    root_id: &str,
    source: &OpaqueId,
    kind: &str,
    revisions: usize,
    body_bytes: usize,
) {
    let namespace = owner_brain_namespace(&owner(), SafeU53::new(1).unwrap()).unwrap();
    let address = owner_brain_source_address(namespace.clone(), source.clone()).unwrap();
    let root_id = OpaqueId::parse(root_id).unwrap();
    let mut previous = None;
    for revision in 0..revisions {
        let record_id = if revision == 0 {
            root_id.clone()
        } else {
            OpaqueId::parse(format!("{}-{revision}", root_id.as_str())).unwrap()
        };
        let successor = encrypt_record(
            luca_continuity::RecordMetadata {
                protocol: CONTINUITY_PROTOCOL.into(),
                record_id: record_id.clone(),
                namespace: namespace.as_protocol().clone(),
                scope: address.as_protocol().clone(),
                record_type: OpaqueId::parse(kind).unwrap(),
                revision: SafeU53::new(revision as u64).unwrap(),
                predecessor_record_id: previous.clone(),
                created_at: CanonicalTimestamp::parse("2026-09-07T00:00:00Z").unwrap(),
                author_kind: OpaqueId::parse("owner").unwrap(),
                provenance_refs: Vec::new(),
                key_version: SafeU53::new(1).unwrap(),
            },
            &[23; 32],
            &vec![b'x'; body_bytes],
        )
        .unwrap();
        let mut request = RevisionRequest {
            idempotency_key: sha_ref_for(&record_id).unwrap(),
            operation: if revision == 0 {
                RevisionOperation::Create
            } else {
                RevisionOperation::Revise
            },
            lineage_root_id: root_id.clone(),
            expected_head_record_id: previous,
            actor: RevisionActor::Owner,
            signed_source_event_refs: Vec::new(),
            request_ref: sha_ref_for(&record_id).unwrap(),
            successor_ciphertext_ref: Some(encrypted_record_reference(&successor).unwrap()),
            successor: Some(successor),
            rollback_source_record_id: None,
            derived_artifact_refs: Vec::new(),
        };
        request.idempotency_key = derive_revision_idempotency_key(
            namespace.as_protocol(),
            address.as_protocol(),
            &OpaqueId::parse(kind).unwrap(),
            SafeU53::new(1).unwrap(),
            &request,
        )
        .unwrap();
        ledger.apply(request).unwrap();
        previous = Some(record_id);
    }
    let head = previous.unwrap();
    let artifact = sha_ref_for(&serde_json::json!({"artifact": root_id})).unwrap();
    let request_ref = sha_ref_for(&serde_json::json!({"register": root_id})).unwrap();
    let artifacts = vec![artifact];
    let key = ledger
        .derive_artifact_registration_idempotency_key(&root_id, &head, &request_ref, &artifacts)
        .unwrap();
    ledger
        .register_derived_artifacts(key, request_ref, &root_id, &head, artifacts)
        .unwrap();
}

// The pre-batching request and execution order, retained as an independent
// semantic/cost oracle. It uses the original single-transition store methods.
fn original_purge_request(lineage: &luca_continuity::RevisionLineageSnapshotV1) -> RevisionRequest {
    let request_ref = sha_ref_for(&serde_json::json!({
        "domain": "luca.connected-brain.forget-index.v1",
        "lineage_root_id": lineage.lineage_root_id,
        "head_record_id": lineage.lineage_head_record_id,
    }))
    .unwrap();
    let mut request = RevisionRequest {
        idempotency_key: request_ref.clone(),
        operation: RevisionOperation::Forget,
        lineage_root_id: lineage.lineage_root_id.clone(),
        expected_head_record_id: Some(lineage.lineage_head_record_id.clone()),
        actor: RevisionActor::Owner,
        signed_source_event_refs: Vec::new(),
        request_ref,
        successor: None,
        successor_ciphertext_ref: None,
        rollback_source_record_id: None,
        derived_artifact_refs: lineage.derived_artifact_refs.clone(),
    };
    request.idempotency_key = derive_revision_idempotency_key(
        &lineage.namespace,
        &lineage.scope,
        &lineage.record_type,
        lineage.lineage_envelope_key_version,
        &request,
    )
    .unwrap();
    request
}

fn original_purge(runtime: &mut ContinuityRuntime, source: &OpaqueId, retained: &[OpaqueId]) {
    let generation = runtime
        .store
        .load_revision_generation(&owner())
        .unwrap()
        .unwrap();
    let ids = generation
        .snapshot
        .lineages
        .iter()
        .filter(|lineage| {
            lineage.record_type.as_str() == CONNECTED_INDEX_PAGE_RECORD
                && lineage.scope.source_id.as_ref() == Some(source)
                && !retained.contains(&lineage.lineage_root_id)
                && lineage
                    .purge_execution
                    .as_ref()
                    .is_none_or(|purge| purge.status != PurgeExecutionStatusV1::Completed)
        })
        .map(|lineage| lineage.lineage_root_id.clone())
        .collect::<Vec<_>>();
    for id in ids {
        let generation = runtime
            .store
            .load_revision_generation(&owner())
            .unwrap()
            .unwrap();
        let lineage = generation
            .snapshot
            .lineages
            .iter()
            .find(|lineage| lineage.lineage_root_id == id)
            .unwrap();
        let (mut token, status) = if lineage.lifecycle == RevisionLifecycle::Forgotten {
            (
                generation.token.clone(),
                lineage.purge_execution.as_ref().unwrap().status,
            )
        } else {
            (
                runtime
                    .store
                    .apply_revision_transition_cas(
                        &AuthorityExpectationV1::Existing(generation.token.clone()),
                        original_purge_request(lineage),
                    )
                    .unwrap()
                    .token,
                PurgeExecutionStatusV1::Authorized,
            )
        };
        if matches!(
            status,
            PurgeExecutionStatusV1::Authorized | PurgeExecutionStatusV1::Failed
        ) {
            token = runtime
                .store
                .advance_purge_transition_cas(
                    &AuthorityExpectationV1::Existing(token),
                    &id,
                    PurgeExecutionStatusV1::InProgress,
                )
                .unwrap();
        }
        runtime
            .store
            .advance_purge_transition_cas(
                &AuthorityExpectationV1::Existing(token),
                &id,
                PurgeExecutionStatusV1::Completed,
            )
            .unwrap();
    }
}

fn seed_purge_snapshot(runtime: &mut ContinuityRuntime, snapshot: &RevisionLedgerSnapshotV1) {
    runtime
        .store
        .replace_owner_revision_generation_atomically(
            &AuthorityExpectationV1::UninitializedOwner {
                owner_pubkey: owner(),
                active_root_key_version: SafeU53::new(1).unwrap(),
            },
            SafeU53::new(1).unwrap(),
            snapshot,
        )
        .unwrap();
}

fn nonce_reservations(runtime: &ContinuityRuntime) -> Vec<(String, i64, String, String, String)> {
    let mut query = runtime.store.connection.prepare(
        "SELECT namespace_ref,key_version,nonce_b64,record_id,reservation_state
         FROM continuity_nonce_reservations WHERE owner_pubkey=?1 ORDER BY namespace_ref,key_version,nonce_b64"
    ).unwrap();
    query
        .query_map([owner().as_str()], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

#[test]
fn connected_purge_batches_match_65_sequential_pages_and_preserve_controls() {
    let source = OpaqueId::parse("purge-source").unwrap();
    let other_source = OpaqueId::parse("other-source").unwrap();
    let retained = vec![OpaqueId::parse("retained-page").unwrap()];
    let mut ledger = RevisionLedger::default();
    for page in 0..65 {
        purge_fixture_lineage(
            &mut ledger,
            &format!("page-{page:03}"),
            &source,
            CONNECTED_INDEX_PAGE_RECORD,
            2,
            256,
        );
    }
    purge_fixture_lineage(
        &mut ledger,
        "retained-page",
        &source,
        CONNECTED_INDEX_PAGE_RECORD,
        1,
        256,
    );
    purge_fixture_lineage(
        &mut ledger,
        "other-page",
        &other_source,
        CONNECTED_INDEX_PAGE_RECORD,
        1,
        256,
    );
    for kind in [
        OWNER_BRAIN_CHUNK_PAGE_RECORD,
        OWNER_BRAIN_SOURCE_RECORD,
        OWNER_BRAIN_BINDING_RECORD,
        CONNECTED_SOURCE_RECORD,
        CONNECTED_BINDING_RECORD,
    ] {
        purge_fixture_lineage(&mut ledger, kind, &source, kind, 1, 256);
    }
    let snapshot = ledger.export_snapshot().unwrap();
    let left_dir = tempfile::tempdir().unwrap();
    let right_dir = tempfile::tempdir().unwrap();
    let mut sequential = runtime(&left_dir);
    let mut batched = runtime(&right_dir);
    seed_purge_snapshot(&mut sequential, &snapshot);
    seed_purge_snapshot(&mut batched, &snapshot);
    original_purge(&mut sequential, &source, &retained);
    connected_lifecycle::purge_orphaned_index_pages(&mut batched, &owner(), &source, &retained)
        .unwrap();
    let expected = sequential
        .store
        .load_revision_generation(&owner())
        .unwrap()
        .unwrap();
    let actual = batched
        .store
        .load_revision_generation(&owner())
        .unwrap()
        .unwrap();
    assert_eq!(actual.snapshot, expected.snapshot);
    assert_eq!(
        actual.token.snapshot_fingerprint,
        expected.token.snapshot_fingerprint
    );
    assert_eq!(actual.token.generation.get(), 1 + 3 * 65_u64.div_ceil(32));
    assert_eq!(expected.token.generation.get(), 1 + 3 * 65);
    assert_eq!(
        nonce_reservations(&batched),
        nonce_reservations(&sequential)
    );
    assert_eq!(actual.snapshot.records.len(), 7);
    for lineage in &actual.snapshot.lineages {
        if lineage.lineage_root_id.as_str().starts_with("page-") {
            let purge = lineage.purge_execution.as_ref().unwrap();
            assert_eq!(lineage.lifecycle, RevisionLifecycle::Forgotten);
            assert_eq!(purge.status, PurgeExecutionStatusV1::Completed);
            assert_eq!(purge.record_tombstones.len(), 2);
            assert_eq!(purge.artifact_tombstones.len(), 1);
        } else {
            assert_eq!(lineage.lifecycle, RevisionLifecycle::Active);
        }
    }
    let changes = batched.store.connection.total_changes();
    connected_lifecycle::purge_orphaned_index_pages(&mut batched, &owner(), &source, &retained)
        .unwrap();
    assert_eq!(batched.store.connection.total_changes(), changes);
    assert_eq!(
        batched
            .store
            .load_revision_generation(&owner())
            .unwrap()
            .unwrap(),
        actual
    );
}

#[test]
fn connected_purge_resumes_authorized_in_progress_failed_and_completed_after_reopen() {
    let source = OpaqueId::parse("recovery-source").unwrap();
    let mut ledger = RevisionLedger::default();
    for name in ["active", "authorized", "in-progress", "failed", "completed"] {
        purge_fixture_lineage(
            &mut ledger,
            name,
            &source,
            CONNECTED_INDEX_PAGE_RECORD,
            2,
            512,
        );
    }
    let initial = ledger.export_snapshot().unwrap();
    for lineage in initial
        .lineages
        .iter()
        .filter(|lineage| lineage.lineage_root_id.as_str() != "active")
    {
        ledger.apply(original_purge_request(lineage)).unwrap();
        match lineage.lineage_root_id.as_str() {
            "in-progress" | "completed" => ledger
                .advance_purge(&lineage.lineage_root_id, PurgeExecutionStatusV1::InProgress)
                .unwrap(),
            "failed" => ledger
                .advance_purge(&lineage.lineage_root_id, PurgeExecutionStatusV1::Failed)
                .unwrap(),
            _ => {}
        }
        if lineage.lineage_root_id.as_str() == "completed" {
            ledger
                .advance_purge(&lineage.lineage_root_id, PurgeExecutionStatusV1::Completed)
                .unwrap();
        }
    }
    let partial = ledger.export_snapshot().unwrap();
    assert_eq!(partial.records.len(), 8);
    let temp = tempfile::tempdir().unwrap();
    let mut fixture = runtime(&temp);
    seed_purge_snapshot(&mut fixture, &partial);
    drop(fixture);
    let mut reopened = runtime(&temp);
    connected_lifecycle::purge_orphaned_index_pages(&mut reopened, &owner(), &source, &[]).unwrap();
    let recovered = reopened
        .store
        .load_revision_generation(&owner())
        .unwrap()
        .unwrap();
    for lineage in &initial.lineages {
        let mut expected = RevisionLedger::from_snapshot(initial.clone()).unwrap();
        expected.apply(original_purge_request(lineage)).unwrap();
        expected
            .advance_purge(&lineage.lineage_root_id, PurgeExecutionStatusV1::InProgress)
            .unwrap();
        expected
            .advance_purge(&lineage.lineage_root_id, PurgeExecutionStatusV1::Completed)
            .unwrap();
        assert_eq!(
            recovered
                .snapshot
                .lineages
                .iter()
                .find(|item| item.lineage_root_id == lineage.lineage_root_id),
            expected
                .export_snapshot()
                .unwrap()
                .lineages
                .iter()
                .find(|item| item.lineage_root_id == lineage.lineage_root_id)
        );
    }
    assert!(recovered.snapshot.records.is_empty());
    assert_eq!(
        recovered.snapshot.revision_idempotency.len(),
        initial.revision_idempotency.len() + 5
    );
    assert_eq!(recovered.token.generation.get(), 4);
}

#[test]
fn connected_purge_synthetic_cost_observation() {
    // Opt-in scale retains the live incident's order of magnitude of historical
    // lineages, using only generated ciphertext and body-free authority.
    let history = if std::env::var_os("LUCA_R26_LARGE_COST").is_some() {
        1024
    } else {
        8
    };
    let source = OpaqueId::parse("cost-source").unwrap();
    let mut ledger = RevisionLedger::default();
    for page in 0..history {
        purge_fixture_lineage(
            &mut ledger,
            &format!("history-{page:04}"),
            &source,
            CONNECTED_INDEX_PAGE_RECORD,
            1,
            16,
        );
    }
    for lineage in ledger.export_snapshot().unwrap().lineages {
        ledger.apply(original_purge_request(&lineage)).unwrap();
        ledger
            .advance_purge(&lineage.lineage_root_id, PurgeExecutionStatusV1::InProgress)
            .unwrap();
        ledger
            .advance_purge(&lineage.lineage_root_id, PurgeExecutionStatusV1::Completed)
            .unwrap();
    }
    for page in 0..8 {
        purge_fixture_lineage(
            &mut ledger,
            &format!("pending-{page}"),
            &source,
            CONNECTED_INDEX_PAGE_RECORD,
            2,
            32 * 1024,
        );
    }
    let snapshot = ledger.export_snapshot().unwrap();
    let mut results = Vec::new();
    let mut final_snapshot = None;
    for batched in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let mut fixture = runtime(&temp);
        seed_purge_snapshot(&mut fixture, &snapshot);
        let changes = fixture.store.connection.total_changes();
        let started = Instant::now();
        if batched {
            connected_lifecycle::purge_orphaned_index_pages(&mut fixture, &owner(), &source, &[])
                .unwrap();
        } else {
            original_purge(&mut fixture, &source, &[]);
        }
        let elapsed = started.elapsed().as_micros();
        let result = fixture
            .store
            .load_revision_generation(&owner())
            .unwrap()
            .unwrap();
        let commits = result.token.generation.get() - 1;
        assert_eq!(commits, if batched { 3 } else { 24 });
        if let Some(expected) = &final_snapshot {
            assert_eq!(&result.snapshot, expected);
        }
        final_snapshot = Some(result.snapshot);
        results.push(serde_json::json!({"batched": batched, "elapsed_micros": elapsed,
            "committed_generations": commits, "sqlite_row_changes": fixture.store.connection.total_changes() - changes}));
    }
    println!(
        "R26_SYNTHETIC_PURGE {}",
        serde_json::json!({
        "historical_completed_lineages": history, "pending_pages": 8, "revisions_per_pending_page": 2,
        "body_bytes_per_pending_record": 32 * 1024, "canonical_snapshot_bytes": canonicalize(&snapshot).unwrap().len(),
        "revision_replay_rows": snapshot.revision_idempotency.len(), "results": results,
        "timing_assertion": false, "fixture": "generated temporary encrypted stores only"})
    );
}
