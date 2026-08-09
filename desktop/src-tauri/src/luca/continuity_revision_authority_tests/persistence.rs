use super::*;

#[test]
fn first_create_reopen_stale_cas_and_exact_replay_are_atomic() {
    let temp = TempDir::new().unwrap();
    let mut store = open(&temp);
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
    let create_key = create.idempotency_key.clone();
    let created = store
        .apply_revision_transition_cas(&expectation, create.clone())
        .unwrap();
    assert_eq!(created.token.generation.get(), 1);
    assert!(!created.replayed);
    drop(store);
    let mut reopened = open(&temp);
    let loaded = reopened.load_revision_generation(&owner).unwrap().unwrap();
    assert_eq!(loaded.token, created.token);
    assert_eq!(loaded.snapshot.records.len(), 1);

    let changes_before = reopened.connection.total_changes();
    let replay = reopened
        .apply_revision_transition_cas(&expectation, create)
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.token, created.token);
    assert_eq!(reopened.connection.total_changes(), changes_before);
    assert_eq!(
        reopened
            .register_artifacts_transition_cas(
                &AuthorityExpectationV1::Existing(created.token.clone()),
                create_key,
                sha('8'),
                &id("record-0"),
                &id("record-0"),
                vec![sha('9')],
            )
            .unwrap_err(),
        ContinuityStoreError::ReplayConflict
    );

    let revise = request(
        RevisionOperation::Revise,
        '7',
        Some(record("record-1", 1, Some("record-0"))),
        Some("record-0"),
    );
    assert_eq!(
        reopened
            .apply_revision_transition_cas(&expectation, revise.clone())
            .unwrap_err(),
        ContinuityStoreError::CompareAndSwapConflict
    );
    let revised = reopened
        .apply_revision_transition_cas(
            &AuthorityExpectationV1::Existing(created.token.clone()),
            revise,
        )
        .unwrap();
    assert_eq!(revised.token.generation.get(), 2);
    assert_eq!(
        reopened
            .load_revision_generation(&owner)
            .unwrap()
            .unwrap()
            .snapshot
            .records
            .len(),
        2
    );
    let correction = request(
        RevisionOperation::OwnerCorrection,
        '8',
        Some(record_authored("record-2", 2, Some("record-1"), "owner")),
        Some("record-1"),
    );
    let corrected = reopened
        .apply_revision_transition_cas(&AuthorityExpectationV1::Existing(revised.token), correction)
        .unwrap();
    drop(reopened);
    let reopened = open(&temp);
    let loaded = reopened.load_revision_generation(&owner).unwrap().unwrap();
    assert_eq!(loaded.token, corrected.token);
    assert!(loaded.snapshot.lineages[0].pinned_owner_correction);
    assert_eq!(loaded.snapshot.records.len(), 3);
}

#[test]
fn artifact_forget_purge_and_whole_owner_replace_survive_reopen() {
    let temp = TempDir::new().unwrap();
    let mut store = open(&temp);
    let owner = hex('1');
    let uninitialized = AuthorityExpectationV1::UninitializedOwner {
        owner_pubkey: owner.clone(),
        active_root_key_version: SafeU53::new(1).unwrap(),
    };
    let create = request(
        RevisionOperation::Create,
        '6',
        Some(record("record-0", 0, None)),
        None,
    );
    let create_replay = create.clone();
    let mut token = store
        .apply_revision_transition_cas(&uninitialized, create)
        .unwrap()
        .token;
    let artifacts = vec![sha('8')];
    let loaded = store.load_revision_generation(&owner).unwrap().unwrap();
    let ledger = RevisionLedger::from_snapshot(loaded.snapshot).unwrap();
    let request_ref = sha('9');
    let artifact_key = ledger
        .derive_artifact_registration_idempotency_key(
            &id("record-0"),
            &id("record-0"),
            &request_ref,
            &artifacts,
        )
        .unwrap();
    token = store
        .register_artifacts_transition_cas(
            &AuthorityExpectationV1::Existing(token),
            artifact_key.clone(),
            request_ref.clone(),
            &id("record-0"),
            &id("record-0"),
            artifacts.clone(),
        )
        .unwrap()
        .token;
    let stale_artifact_token = token.clone();
    let loaded = store.load_revision_generation(&owner).unwrap().unwrap();
    let lineage = &loaded.snapshot.lineages[0];
    let mut archive = RevisionRequest {
        idempotency_key: sha('0'),
        operation: RevisionOperation::Archive,
        lineage_root_id: id("record-0"),
        expected_head_record_id: Some(id("record-0")),
        actor: RevisionActor::Owner,
        signed_source_event_refs: vec![sha('b')],
        request_ref: sha('b'),
        successor: None,
        successor_ciphertext_ref: None,
        rollback_source_record_id: None,
        derived_artifact_refs: Vec::new(),
    };
    archive.idempotency_key = derive_revision_idempotency_key(
        &lineage.namespace,
        &lineage.scope,
        &lineage.record_type,
        lineage.lineage_envelope_key_version,
        &archive,
    )
    .unwrap();
    token = store
        .apply_revision_transition_cas(&AuthorityExpectationV1::Existing(token), archive)
        .unwrap()
        .token;
    drop(store);
    let mut store = open(&temp);
    let archived = store.load_revision_generation(&owner).unwrap().unwrap();
    assert_eq!(archived.token, token);
    assert_eq!(
        archived.snapshot.lineages[0].lifecycle,
        RevisionLifecycle::Archived
    );
    let mut forget = RevisionRequest {
        idempotency_key: sha('0'),
        operation: RevisionOperation::Forget,
        lineage_root_id: id("record-0"),
        expected_head_record_id: Some(id("record-0")),
        actor: RevisionActor::Owner,
        signed_source_event_refs: vec![sha('a')],
        request_ref: sha('a'),
        successor: None,
        successor_ciphertext_ref: None,
        rollback_source_record_id: None,
        derived_artifact_refs: artifacts,
    };
    let loaded = store.load_revision_generation(&owner).unwrap().unwrap();
    let lineage = &loaded.snapshot.lineages[0];
    forget.idempotency_key = derive_revision_idempotency_key(
        &lineage.namespace,
        &lineage.scope,
        &lineage.record_type,
        lineage.lineage_envelope_key_version,
        &forget,
    )
    .unwrap();
    let forget_replay = forget.clone();
    token = store
        .apply_revision_transition_cas(&AuthorityExpectationV1::Existing(token), forget)
        .unwrap()
        .token;
    token = store
        .advance_purge_transition_cas(
            &AuthorityExpectationV1::Existing(token),
            &id("record-0"),
            PurgeExecutionStatusV1::InProgress,
        )
        .unwrap();
    token = store
        .advance_purge_transition_cas(
            &AuthorityExpectationV1::Existing(token),
            &id("record-0"),
            PurgeExecutionStatusV1::Completed,
        )
        .unwrap();
    let completed = store.load_revision_generation(&owner).unwrap().unwrap();
    assert!(completed.snapshot.records.is_empty());
    assert_eq!(completed.snapshot.lineages[0].record_ids.len(), 1);
    let purge = completed.snapshot.lineages[0]
        .purge_execution
        .as_ref()
        .unwrap();
    assert_eq!(purge.status, PurgeExecutionStatusV1::Completed);
    assert_eq!(purge.record_tombstones.len(), 1);
    assert_eq!(purge.artifact_tombstones.len(), 1);
    assert_eq!(completed.token, token);
    let changes_before = store.connection.total_changes();
    let create_again = store
        .apply_revision_transition_cas(&uninitialized, create_replay)
        .unwrap();
    assert!(create_again.replayed);
    assert_eq!(create_again.token, token);
    let forget_again = store
        .apply_revision_transition_cas(
            &AuthorityExpectationV1::Existing(token.clone()),
            forget_replay,
        )
        .unwrap();
    assert!(forget_again.replayed);
    assert_eq!(forget_again.token, token);
    let artifact_again = store
        .register_artifacts_transition_cas(
            &AuthorityExpectationV1::Existing(stale_artifact_token),
            artifact_key,
            request_ref,
            &id("record-0"),
            &id("record-0"),
            vec![sha('8')],
        )
        .unwrap();
    assert!(artifact_again.replayed);
    assert_eq!(artifact_again.token, token);
    assert_eq!(store.connection.total_changes(), changes_before);
    let purged_nonces: i64 = store
        .connection
        .query_row(
            "SELECT COUNT(*) FROM continuity_nonce_reservations
             WHERE owner_pubkey=?1 AND reservation_state='purged'",
            [owner.as_str()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(purged_nonces, 1);
    drop(store);
    let mut reopened = open(&temp);
    let completed = reopened.load_revision_generation(&owner).unwrap().unwrap();
    assert!(completed.snapshot.records.is_empty());
    let replaced = reopened
        .replace_owner_revision_generation_atomically(
            &AuthorityExpectationV1::Existing(completed.token.clone()),
            SafeU53::new(1).unwrap(),
            &completed.snapshot,
        )
        .unwrap();
    assert_ne!(replaced.store_epoch, completed.token.store_epoch);
    assert_eq!(
        replaced.snapshot_fingerprint,
        completed.token.snapshot_fingerprint
    );
    assert_eq!(
        replaced.generation.get(),
        completed.token.generation.get() + 1
    );
}

#[test]
fn malformed_or_mixed_generation_authority_never_hydrates() {
    let temp = TempDir::new().unwrap();
    let mut store = open(&temp);
    let owner = hex('1');
    let expectation = AuthorityExpectationV1::UninitializedOwner {
        owner_pubkey: owner.clone(),
        active_root_key_version: SafeU53::new(1).unwrap(),
    };
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
    store
        .connection
        .pragma_update(None, "foreign_keys", false)
        .unwrap();
    store.connection.execute("UPDATE continuity_revision_membership SET authority_generation=2 WHERE owner_pubkey=?1", [owner.as_str()]).unwrap();
    store
        .connection
        .pragma_update(None, "foreign_keys", true)
        .unwrap();
    assert_eq!(
        store.load_revision_generation(&owner).unwrap_err(),
        ContinuityStoreError::CompareAndSwapConflict
    );
}

#[test]
fn normalized_authority_tamper_and_transaction_abort_fail_closed() {
    let temp = TempDir::new().unwrap();
    let mut store = open(&temp);
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
    let created = store
        .apply_revision_transition_cas(&expectation, create)
        .unwrap();
    store
        .connection
        .execute_batch(
            "CREATE TRIGGER continuity_test_abort_meta BEFORE UPDATE ON continuity_authority_meta
             BEGIN SELECT RAISE(ABORT, 'abort authority cas'); END;",
        )
        .unwrap();
    let revise = request(
        RevisionOperation::Revise,
        '7',
        Some(record("record-1", 1, Some("record-0"))),
        Some("record-0"),
    );
    assert_eq!(
        store
            .apply_revision_transition_cas(
                &AuthorityExpectationV1::Existing(created.token.clone()),
                revise,
            )
            .unwrap_err(),
        ContinuityStoreError::Unavailable
    );
    store
        .connection
        .execute_batch("DROP TRIGGER continuity_test_abort_meta")
        .unwrap();
    let unchanged = store.load_revision_generation(&owner).unwrap().unwrap();
    assert_eq!(unchanged.token, created.token);
    assert_eq!(unchanged.snapshot.records.len(), 1);

    store
        .connection
        .execute(
            "UPDATE continuity_revision_lineages SET scope_ref=?2 WHERE owner_pubkey=?1",
            params![owner.as_str(), sha('f').as_str()],
        )
        .unwrap();
    assert_eq!(
        store.load_revision_generation(&owner).unwrap_err(),
        ContinuityStoreError::InvalidRecord
    );
}

#[test]
fn weakened_v4_authority_schema_is_rejected_on_reopen() {
    let temp = TempDir::new().unwrap();
    let store = open(&temp);
    drop(store);
    let path = temp.path().join("continuity").join("continuity-v1.sqlite3");
    let connection = Connection::open(path).unwrap();
    connection
        .execute_batch(
            "DROP INDEX continuity_revision_active_scope;
             CREATE INDEX continuity_revision_active_scope
             ON continuity_revision_lineages(owner_pubkey)
             WHERE lifecycle='active';
             PRAGMA wal_checkpoint(TRUNCATE);",
        )
        .unwrap();
    drop(connection);
    assert!(matches!(
        ContinuityStore::open(
            temp.path(),
            super::super::super::continuity_store::ContinuityStoreCustody::Ready
        ),
        Err(ContinuityStoreError::SchemaIncompatible)
    ));
}
