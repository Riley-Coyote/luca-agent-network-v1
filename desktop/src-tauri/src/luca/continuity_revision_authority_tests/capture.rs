use super::*;

#[test]
fn immutable_scope_capture_orders_exact_active_heads_and_revalidates_full_token() {
    let temp = TempDir::new().unwrap();
    let owner = hex('1');
    let mut store = open(&temp);
    let first_record = record("lineage-b", 0, None);
    let requested = namespace_scope(&first_record);
    let created_b = store
        .apply_revision_transition_cas(
            &AuthorityExpectationV1::UninitializedOwner {
                owner_pubkey: owner.clone(),
                active_root_key_version: SafeU53::new(1).unwrap(),
            },
            request_for_lineage(
                "lineage-b",
                RevisionOperation::Create,
                '6',
                Some(first_record),
                None,
            ),
        )
        .unwrap();
    let created_a = store
        .apply_revision_transition_cas(
            &AuthorityExpectationV1::Existing(created_b.token),
            request_for_lineage(
                "lineage-a",
                RevisionOperation::Create,
                '7',
                Some(record("lineage-a", 0, None)),
                None,
            ),
        )
        .unwrap();

    let captured = store
        .capture_immutable_active_scope(&owner, &requested)
        .unwrap()
        .unwrap();
    assert_eq!(captured.token, created_a.token);
    assert_eq!(
        captured
            .active_heads
            .iter()
            .map(|record| record.record_id.as_str())
            .collect::<Vec<_>>(),
        vec!["lineage-a", "lineage-b"]
    );
    assert!(store.revalidate_immutable_capture(&captured.token).unwrap());

    let revised = store
        .apply_revision_transition_cas(
            &AuthorityExpectationV1::Existing(created_a.token),
            request_for_lineage(
                "lineage-b",
                RevisionOperation::Revise,
                '8',
                Some(record("lineage-b-1", 1, Some("lineage-b"))),
                Some("lineage-b"),
            ),
        )
        .unwrap();
    assert!(!store.revalidate_immutable_capture(&captured.token).unwrap());
    let current = store
        .capture_immutable_active_scope(&owner, &requested)
        .unwrap()
        .unwrap();
    assert_eq!(current.token, revised.token);
    assert_eq!(
        current
            .active_heads
            .iter()
            .map(|record| record.record_id.as_str())
            .collect::<Vec<_>>(),
        vec!["lineage-a", "lineage-b-1"]
    );
}

#[test]
fn immutable_scope_capture_isolates_every_scope_field_and_owner() {
    let temp = TempDir::new().unwrap();
    let owner = hex('1');
    let mut store = open(&temp);
    let stored = record("record-0", 0, None);
    let created = store
        .apply_revision_transition_cas(
            &AuthorityExpectationV1::UninitializedOwner {
                owner_pubkey: owner.clone(),
                active_root_key_version: SafeU53::new(1).unwrap(),
            },
            request(RevisionOperation::Create, '6', Some(stored.clone()), None),
        )
        .unwrap();

    let mut other_scope = stored.scope.clone();
    other_scope.conversation_id = Some(id("other-conversation"));
    let other_scope =
        NamespaceScope::new(stored.namespace.clone().try_into().unwrap(), other_scope).unwrap();
    let empty = store
        .capture_immutable_active_scope(&owner, &other_scope)
        .unwrap()
        .unwrap();
    assert_eq!(empty.token, created.token);
    assert!(empty.active_heads.is_empty());

    let mut other_namespace = stored.namespace.clone();
    other_namespace.owner_pubkey = hex('9');
    let other_owner =
        NamespaceScope::new(other_namespace.try_into().unwrap(), stored.scope.clone()).unwrap();
    assert_eq!(
        store.capture_immutable_active_scope(&owner, &other_owner),
        Err(ContinuityStoreError::InvalidRecord)
    );
}

#[test]
fn immutable_scope_capture_rejects_rotation_and_authority_tamper() {
    let temp = TempDir::new().unwrap();
    let owner = hex('1');
    let mut store = open(&temp);
    let stored = record("record-0", 0, None);
    let requested = namespace_scope(&stored);
    let created = store
        .apply_revision_transition_cas(
            &AuthorityExpectationV1::UninitializedOwner {
                owner_pubkey: owner.clone(),
                active_root_key_version: SafeU53::new(1).unwrap(),
            },
            request(RevisionOperation::Create, '6', Some(stored), None),
        )
        .unwrap();
    store
        .connection
        .execute(
            "INSERT INTO continuity_rotation_journals(owner_pubkey,rotation_id,envelope_json)
             VALUES(?1,?2,?3)",
            params![owner.as_str(), "capture-test", vec![0_u8]],
        )
        .unwrap();
    assert_eq!(
        store.capture_immutable_active_scope(&owner, &requested),
        Err(ContinuityStoreError::LifecycleConflict)
    );
    assert_eq!(
        store.revalidate_immutable_capture(&created.token),
        Err(ContinuityStoreError::LifecycleConflict)
    );
    store
        .connection
        .execute(
            "DELETE FROM continuity_rotation_journals WHERE owner_pubkey=?1",
            [owner.as_str()],
        )
        .unwrap();
    store
        .connection
        .execute(
            "UPDATE continuity_records SET envelope_json=?2 WHERE record_id=?1",
            params!["record-0", b"{}".as_slice()],
        )
        .unwrap();
    assert!(matches!(
        store.capture_immutable_active_scope(&owner, &requested),
        Err(ContinuityStoreError::InvalidRecord)
            | Err(ContinuityStoreError::CompareAndSwapConflict)
    ));
    assert!(matches!(
        store.revalidate_immutable_capture(&created.token),
        Err(ContinuityStoreError::InvalidRecord)
            | Err(ContinuityStoreError::CompareAndSwapConflict)
    ));
}

#[test]
fn historical_replays_reload_the_complete_generation_under_the_writer_lock() {
    let temp = TempDir::new().unwrap();
    let owner = hex('1');
    let expectation = AuthorityExpectationV1::UninitializedOwner {
        owner_pubkey: owner.clone(),
        active_root_key_version: SafeU53::new(1).unwrap(),
    };
    let create = request(
        RevisionOperation::Create,
        '6',
        Some(record("record-0", 0, None)),
        None,
    );
    let mut writer = open(&temp);
    let created = writer
        .apply_revision_transition_cas(&expectation, create.clone())
        .unwrap();

    let mut replay_store = open(&temp);
    begin_generation_bump(&writer);
    let (sender, receiver) = mpsc::channel();
    let replay_thread = thread::spawn(move || {
        sender
            .send(replay_store.apply_revision_transition_cas(&expectation, create))
            .unwrap();
    });
    assert_replay_waits_for_writer(&receiver);
    commit_generation_bump(&writer, &owner, 1, 2);
    let replay = receiver
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap();
    replay_thread.join().unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.token.generation.get(), 2);
    assert_ne!(replay.token, created.token);

    let loaded = writer.load_revision_generation(&owner).unwrap().unwrap();
    let ledger = RevisionLedger::from_snapshot(loaded.snapshot).unwrap();
    let artifacts = vec![sha('8')];
    let request_ref = sha('9');
    let artifact_key = ledger
        .derive_artifact_registration_idempotency_key(
            &id("record-0"),
            &id("record-0"),
            &request_ref,
            &artifacts,
        )
        .unwrap();
    let artifact = writer
        .register_artifacts_transition_cas(
            &AuthorityExpectationV1::Existing(replay.token),
            artifact_key.clone(),
            request_ref.clone(),
            &id("record-0"),
            &id("record-0"),
            artifacts.clone(),
        )
        .unwrap();
    assert_eq!(artifact.token.generation.get(), 3);

    let mut replay_store = open(&temp);
    begin_generation_bump(&writer);
    let (sender, receiver) = mpsc::channel();
    let stale_token = artifact.token.clone();
    let replay_thread = thread::spawn(move || {
        sender
            .send(replay_store.register_artifacts_transition_cas(
                &AuthorityExpectationV1::Existing(stale_token),
                artifact_key,
                request_ref,
                &id("record-0"),
                &id("record-0"),
                artifacts,
            ))
            .unwrap();
    });
    assert_replay_waits_for_writer(&receiver);
    commit_generation_bump(&writer, &owner, 3, 4);
    let replay = receiver
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap();
    replay_thread.join().unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.token.generation.get(), 4);
    assert_ne!(replay.token, artifact.token);
}

#[test]
fn hydration_is_one_snapshot_and_consumes_the_preflight_manifest_exactly() {
    let temp = TempDir::new().unwrap();
    let owner = hex('1');
    let expectation = AuthorityExpectationV1::UninitializedOwner {
        owner_pubkey: owner.clone(),
        active_root_key_version: SafeU53::new(1).unwrap(),
    };
    let create = request(
        RevisionOperation::Create,
        '6',
        Some(record("record-0", 0, None)),
        None,
    );
    let mut writer = open(&temp);
    let created = writer
        .apply_revision_transition_cas(&expectation, create)
        .unwrap();
    let reader = open(&temp);
    let transaction = reader.connection.unchecked_transaction().unwrap();
    let observed_generation: i64 = transaction
        .query_row(
            "SELECT generation FROM continuity_authority_meta WHERE owner_pubkey=?1",
            [owner.as_str()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(observed_generation, 1);

    let revise = request(
        RevisionOperation::Revise,
        '7',
        Some(record("record-1", 1, Some("record-0"))),
        Some("record-0"),
    );
    let revised = writer
        .apply_revision_transition_cas(&AuthorityExpectationV1::Existing(created.token), revise)
        .unwrap();
    let old = load_generation_in_snapshot(&transaction, &owner)
        .unwrap()
        .unwrap();
    assert_eq!(old.token.generation.get(), 1);
    let mut manifest =
        preflight_authority_bounds(&transaction, &owner, old.token.generation).unwrap();
    *manifest
        .counts
        .get_mut("continuity_revision_lineages")
        .unwrap() += 1;
    assert_eq!(
        load_snapshot(&transaction, &owner, old.token.generation, &manifest).unwrap_err(),
        ContinuityStoreError::CompareAndSwapConflict
    );
    transaction.commit().unwrap();

    let current = reader.load_revision_generation(&owner).unwrap().unwrap();
    assert_eq!(current.token, revised.token);
    assert_eq!(current.snapshot.records.len(), 2);
}

#[test]
fn normalized_scalar_and_meta_oversize_fail_before_hydration() {
    for meta in [false, true] {
        let temp = TempDir::new().unwrap();
        let owner = hex('1');
        let expectation = AuthorityExpectationV1::UninitializedOwner {
            owner_pubkey: owner.clone(),
            active_root_key_version: SafeU53::new(1).unwrap(),
        };
        let mut store = open(&temp);
        store
            .apply_revision_transition_cas(
                &expectation,
                request(
                    RevisionOperation::Create,
                    '6',
                    Some(record("record-0", 0, None)),
                    None,
                ),
            )
            .unwrap();
        if meta {
            store
                .connection
                .execute(
                    "UPDATE continuity_authority_meta
                     SET snapshot_fingerprint=zeroblob(?1) WHERE owner_pubkey=?2",
                    params![MAX_TYPED_BLOB_BYTES as i64 + 1, owner.as_str()],
                )
                .unwrap();
        } else {
            store
                .connection
                .execute(
                    "UPDATE continuity_revision_lineages SET record_type=zeroblob(?1)
                     WHERE owner_pubkey=?2",
                    params![MAX_TYPED_BLOB_BYTES as i64 + 1, owner.as_str()],
                )
                .unwrap();
        }
        assert!(matches!(
            store.load_revision_generation(&owner),
            Err(ContinuityStoreError::InvalidRecord)
                | Err(ContinuityStoreError::SnapshotBoundExceeded)
        ));
    }
}

#[test]
fn complete_owner_replacement_is_atomic_and_legacy_seam_refuses_authority() {
    let temp = TempDir::new().unwrap();
    let owner = hex('1');
    let expectation = AuthorityExpectationV1::UninitializedOwner {
        owner_pubkey: owner.clone(),
        active_root_key_version: SafeU53::new(1).unwrap(),
    };
    let mut store = open(&temp);
    let created = store
        .apply_revision_transition_cas(
            &expectation,
            request(
                RevisionOperation::Create,
                '6',
                Some(record("record-0", 0, None)),
                None,
            ),
        )
        .unwrap();
    let snapshot = store
        .load_revision_generation(&owner)
        .unwrap()
        .unwrap()
        .snapshot;
    let first_mapping = ContinuitySourceMapping {
        mapping_ref: sha('a'),
        source_ref: sha('b'),
        resident_pubkey: Some(hex('2')),
    };
    let replaced = store
        .replace_complete_owner_generation_atomically(
            &AuthorityExpectationV1::Existing(created.token.clone()),
            SafeU53::new(1).unwrap(),
            &snapshot,
            std::slice::from_ref(&first_mapping),
        )
        .unwrap();
    assert_ne!(replaced.store_epoch, created.token.store_epoch);
    assert_eq!(
        store.source_mappings_for_test(&owner).unwrap(),
        vec![first_mapping.clone()]
    );

    assert_eq!(
        store.replace_owner_snapshot_atomically(
            &owner,
            &snapshot.records,
            &[],
            SafeU53::new(1).unwrap(),
        ),
        Err(ContinuityStoreError::LifecycleConflict)
    );
    assert_eq!(
        store
            .load_revision_generation(&owner)
            .unwrap()
            .unwrap()
            .token,
        replaced
    );

    store
        .connection
        .execute_batch(
            "CREATE TRIGGER fail_complete_owner_replace
             BEFORE UPDATE ON continuity_authority_meta
             BEGIN SELECT RAISE(ABORT, 'forced'); END;",
        )
        .unwrap();
    let second_mapping = ContinuitySourceMapping {
        mapping_ref: sha('c'),
        source_ref: sha('d'),
        resident_pubkey: None,
    };
    assert_eq!(
        store.replace_complete_owner_generation_atomically(
            &AuthorityExpectationV1::Existing(replaced.clone()),
            SafeU53::new(1).unwrap(),
            &snapshot,
            std::slice::from_ref(&second_mapping),
        ),
        Err(ContinuityStoreError::Unavailable)
    );
    store
        .connection
        .execute_batch("DROP TRIGGER fail_complete_owner_replace;")
        .unwrap();
    assert_eq!(
        store.source_mappings_for_test(&owner).unwrap(),
        vec![first_mapping]
    );
    assert_eq!(
        store
            .load_revision_generation(&owner)
            .unwrap()
            .unwrap()
            .token,
        replaced
    );
}
