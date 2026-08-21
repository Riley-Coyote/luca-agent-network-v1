use std::{fs, path::Path};

use luca_protocol::{
    ArtifactCreateArgsV1, ArtifactKindV1, ArtifactReadModeV1, ArtifactReceiptStateV1,
    ArtifactSourceV1, ArtifactUpdateArgsV1, Hex64, OpaqueId, SafeU53, MAX_ARTIFACT_READ_BYTES,
};

use super::*;

fn hex(value: char) -> Hex64 {
    Hex64::parse(value.to_string().repeat(64)).unwrap()
}

fn id(value: &str) -> OpaqueId {
    OpaqueId::parse(value).unwrap()
}

fn context(owner: char) -> ArtifactWriteContext {
    ArtifactWriteContext {
        owner_pubkey: hex(owner),
        author_pubkey: hex('2'),
        resident_pubkey: hex('2'),
        conversation_id: Some(id("conversation-1")),
        turn_id: Some(id("turn-1")),
        dispatch_receipt_id: Some(id("dispatch-1")),
        working_root_id: Some(id("root-1")),
        receipt_state: ArtifactReceiptStateV1::Provisional,
    }
}

fn context_for(
    owner: char,
    conversation: &str,
    turn: &str,
    dispatch: &str,
) -> ArtifactWriteContext {
    ArtifactWriteContext {
        conversation_id: Some(id(conversation)),
        turn_id: Some(id(turn)),
        dispatch_receipt_id: Some(id(dispatch)),
        ..context(owner)
    }
}

fn blob_disk_bytes(store: &ArtifactStore) -> u64 {
    fs::read_dir(store.root.join("blobs/sha256"))
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .flat_map(|shard| fs::read_dir(shard.path()).into_iter().flatten())
        .filter_map(Result::ok)
        .filter_map(|entry| entry.metadata().ok())
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len())
        .sum()
}

fn create_args(key: &str, content: &str) -> ArtifactCreateArgsV1 {
    ArtifactCreateArgsV1 {
        title: "Threshold study".into(),
        kind: ArtifactKindV1::Html,
        source: ArtifactSourceV1::InlineText {
            content_utf8: content.into(),
            declared_media_type: Some("text/html".into()),
        },
        idempotency_key: id(key),
    }
}

fn update_args(artifact_id: &str, key: &str, expected: u64, content: &str) -> ArtifactUpdateArgsV1 {
    ArtifactUpdateArgsV1 {
        artifact_id: id(artifact_id),
        expected_current_version: SafeU53::new(expected).unwrap(),
        title: None,
        source: ArtifactSourceV1::InlineText {
            content_utf8: content.into(),
            declared_media_type: None,
        },
        idempotency_key: id(key),
    }
}

#[test]
fn artifact_round_trips_across_reopen_with_immutable_version() {
    let temp = tempfile::tempdir().unwrap();
    let commit = ArtifactStore::open(temp.path())
        .unwrap()
        .create(&context('1'), &create_args("create-1", "<h1>v1</h1>"), None)
        .unwrap();
    let store = ArtifactStore::open(temp.path()).unwrap();
    let read = store
        .read(
            &hex('1'),
            &id(&commit.artifact.artifact_id),
            None,
            ArtifactReadModeV1::BoundedText,
        )
        .unwrap();
    assert_eq!(read.content.unwrap(), b"<h1>v1</h1>");
    assert_eq!(read.version.version, 1);
    assert!(temp
        .path()
        .join("luca/artifacts/artifacts.sqlite3")
        .is_file());
}

#[test]
fn revert_appends_a_version_without_mutating_history_or_duplicating_blob_bytes() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    let created = store
        .create(&context('1'), &create_args("create-1", "v1"), None)
        .unwrap();
    let artifact_id = id(&created.artifact.artifact_id);
    store
        .update(
            &context('1'),
            &update_args(artifact_id.as_str(), "update-1", 1, "v2"),
            None,
        )
        .unwrap();

    let reverted = store
        .revert(
            &hex('1'),
            &artifact_id,
            SafeU53::new(1).unwrap(),
            SafeU53::new(2).unwrap(),
        )
        .unwrap();
    assert_eq!(reverted.version.version, 3);
    assert_eq!(reverted.version.parent_version, Some(2));
    assert_eq!(
        reverted.version.aggregate_hash,
        created.version.aggregate_hash
    );
    let versions = store.versions(&hex('1'), &artifact_id).unwrap();
    assert_eq!(versions.len(), 3);
    assert_eq!(versions[2].version, 1);
    let blob_count = fs::read_dir(store.root.join("blobs/sha256"))
        .unwrap()
        .flat_map(Result::ok)
        .flat_map(|shard| fs::read_dir(shard.path()).into_iter().flatten())
        .filter_map(Result::ok)
        .count();
    assert_eq!(blob_count, 2);
}

#[test]
fn identical_idempotency_replays_and_different_bytes_are_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    let first = store
        .create(&context('1'), &create_args("same-key", "same"), None)
        .unwrap();
    let replay = store
        .create(&context('1'), &create_args("same-key", "same"), None)
        .unwrap();
    assert!(replay.duplicate);
    assert_eq!(replay.artifact.artifact_id, first.artifact.artifact_id);
    assert_eq!(
        store.create(&context('1'), &create_args("same-key", "different"), None),
        Err(ArtifactStoreError::IdempotencyReuse)
    );
}

#[test]
fn expected_version_allows_one_update_and_reports_current_to_loser() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    let created = store
        .create(&context('1'), &create_args("create-1", "v1"), None)
        .unwrap();
    let artifact_id = created.artifact.artifact_id;
    store
        .update(
            &context('1'),
            &update_args(&artifact_id, "update-1", 1, "v2"),
            None,
        )
        .unwrap();
    assert_eq!(
        store.update(
            &context('1'),
            &update_args(&artifact_id, "update-2", 1, "loser"),
            None,
        ),
        Err(ArtifactStoreError::Conflict { current_version: 2 })
    );
    assert_eq!(
        store.versions(&hex('1'), &id(&artifact_id)).unwrap().len(),
        2
    );
}

#[test]
fn owner_scope_delete_restore_and_receipt_link_are_isolated() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    let created = store
        .create(&context('1'), &create_args("create-1", "secret"), None)
        .unwrap();
    let artifact_id = id(&created.artifact.artifact_id);
    assert_eq!(
        store.get(&hex('3'), &artifact_id),
        Err(ArtifactStoreError::NotFound)
    );
    assert!(store
        .soft_delete(&hex('1'), &artifact_id)
        .unwrap()
        .deleted_at
        .is_some());
    assert!(store.list(&hex('1'), false, 10).unwrap().is_empty());
    assert!(store
        .restore(&hex('1'), &artifact_id)
        .unwrap()
        .deleted_at
        .is_none());
    assert_eq!(
        store
            .link_turn_receipts(&hex('1'), &id("conversation-1"), &id("turn-1"), &hex('a'),)
            .unwrap(),
        1
    );
    assert_eq!(
        store.receipts(&hex('1'), None, 10).unwrap()[0].state,
        ArtifactReceiptStateV1::Linked
    );

    let second = store
        .create(&context('1'), &create_args("create-2", "unfinished"), None)
        .unwrap();

    assert_eq!(
        store
            .mark_turn_receipts(
                &hex('1'),
                &id("conversation-1"),
                &id("turn-1"),
                ArtifactReceiptStateV1::Interrupted,
            )
            .unwrap(),
        1
    );
    let receipts = store.receipts(&hex('1'), None, 10).unwrap();
    assert!(receipts.iter().any(|receipt| {
        receipt.artifact_id == second.artifact.artifact_id
            && receipt.state == ArtifactReceiptStateV1::Interrupted
            && receipt.artifact_title == second.artifact.title
    }));
    assert_eq!(
        store
            .get(&hex('1'), &id(&second.artifact.artifact_id))
            .unwrap()
            .receipt_state,
        ArtifactReceiptStateV1::Interrupted
    );

    let third = store
        .create(&context('1'), &create_args("create-3", "cancelled"), None)
        .unwrap();
    assert_eq!(
        store
            .mark_dispatch_receipts(
                &hex('1'),
                &id("conversation-1"),
                &hex('2'),
                &id("dispatch-1"),
                ArtifactReceiptStateV1::Interrupted,
            )
            .unwrap(),
        1
    );
    assert_eq!(
        store
            .get(&hex('1'), &id(&third.artifact.artifact_id))
            .unwrap()
            .receipt_state,
        ArtifactReceiptStateV1::Interrupted
    );
}

#[test]
fn bounded_text_reads_report_truncation_without_loading_in_list() {
    let temp = tempfile::tempdir().unwrap();
    let content = "x".repeat(MAX_ARTIFACT_READ_BYTES + 17);
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    let created = store
        .create(&context('1'), &create_args("large-text", &content), None)
        .unwrap();
    let listed = store.list(&hex('1'), false, 10).unwrap();
    assert_eq!(listed.len(), 1);
    let read = store
        .read(
            &hex('1'),
            &id(&created.artifact.artifact_id),
            None,
            ArtifactReadModeV1::BoundedText,
        )
        .unwrap();
    assert!(read.truncated);
    assert_eq!(read.content.unwrap().len(), MAX_ARTIFACT_READ_BYTES);
}

#[test]
fn quota_rejects_before_metadata_commit() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::open_with_quota(temp.path(), 4).unwrap();
    assert_eq!(
        store.create(&context('1'), &create_args("quota", "12345"), None),
        Err(ArtifactStoreError::QuotaExceeded)
    );
    assert!(store.list(&hex('1'), false, 10).unwrap().is_empty());
    assert_eq!(blob_disk_bytes(&store), 0);
}

#[test]
fn rejected_stale_update_does_not_publish_unreferenced_blob_bytes() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    let created = store
        .create(&context('1'), &create_args("create", "v1"), None)
        .unwrap();
    store
        .update(
            &context('1'),
            &update_args(&created.artifact.artifact_id, "winner", 1, "v2"),
            None,
        )
        .unwrap();
    let before = blob_disk_bytes(&store);
    assert_eq!(
        store.update(
            &context('1'),
            &update_args(&created.artifact.artifact_id, "loser", 1, "unreferenced"),
            None,
        ),
        Err(ArtifactStoreError::Conflict { current_version: 2 })
    );
    assert_eq!(blob_disk_bytes(&store), before);
}

#[test]
fn broker_conversation_scope_hides_other_conversations_without_narrowing_library() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    let first = store
        .create(
            &context_for('1', "conversation-1", "turn-1", "dispatch-1"),
            &create_args("conversation-one", "one"),
            None,
        )
        .unwrap();
    let second = store
        .create(
            &context_for('1', "conversation-2", "turn-2", "dispatch-2"),
            &create_args("conversation-two", "two"),
            None,
        )
        .unwrap();

    assert_eq!(
        store.create(
            &context_for('1', "conversation-2", "turn-2", "dispatch-2"),
            &create_args("conversation-one", "one"),
            None,
        ),
        Err(ArtifactStoreError::IdempotencyReuse)
    );

    assert_eq!(store.list(&hex('1'), false, 10).unwrap().len(), 2);
    assert_eq!(
        store
            .list_for_conversation(&hex('1'), &id("conversation-1"), 10)
            .unwrap()
            .iter()
            .map(|artifact| artifact.artifact_id.as_str())
            .collect::<Vec<_>>(),
        vec![first.artifact.artifact_id.as_str()]
    );
    assert_eq!(
        store.get_for_conversation(
            &hex('1'),
            &id("conversation-1"),
            &id(&second.artifact.artifact_id),
        ),
        Err(ArtifactStoreError::NotFound)
    );
}

#[test]
fn workspace_capture_rejects_traversal_symlinks_and_mime_mismatch() {
    let temp = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("note.txt"), "hello").unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    let mut args = create_args("workspace", "unused");
    args.kind = ArtifactKindV1::Text;
    args.source = ArtifactSourceV1::WorkspaceFile {
        relative_path: "note.txt".into(),
        declared_media_type: None,
    };
    store
        .create(&context('1'), &args, Some(workspace.path()))
        .unwrap();

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("note.txt", workspace.path().join("linked.txt")).unwrap();
        args.idempotency_key = id("symlink");
        args.source = ArtifactSourceV1::WorkspaceFile {
            relative_path: "linked.txt".into(),
            declared_media_type: None,
        };
        assert_eq!(
            store.create(&context('1'), &args, Some(workspace.path())),
            Err(ArtifactStoreError::UnsafePath)
        );
    }

    let binary = ArtifactCreateArgsV1 {
        title: "not image".into(),
        kind: ArtifactKindV1::Image,
        source: ArtifactSourceV1::InlineText {
            content_utf8: "definitely not an image".into(),
            declared_media_type: Some("image/png".into()),
        },
        idempotency_key: id("mime"),
    };
    assert_eq!(
        store.create(&context('1'), &binary, None),
        Err(ArtifactStoreError::MediaTypeMismatch)
    );

    let mut declared_mismatch = create_args("declared-mime", "plain text");
    declared_mismatch.kind = ArtifactKindV1::Text;
    declared_mismatch.source = ArtifactSourceV1::InlineText {
        content_utf8: "plain text".into(),
        declared_media_type: Some("application/pdf".into()),
    };
    assert_eq!(
        store.create(&context('1'), &declared_mismatch, None),
        Err(ArtifactStoreError::MediaTypeMismatch)
    );
}

#[test]
fn app_binding_persists_only_root_handle_and_relative_path() {
    let temp = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    fs::create_dir(workspace.path().join("app")).unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    let args = ArtifactCreateArgsV1 {
        title: "Local app".into(),
        kind: ArtifactKindV1::App,
        source: ArtifactSourceV1::WorkspaceDirectory {
            relative_path: "app".into(),
        },
        idempotency_key: id("app-create"),
    };
    let commit = store
        .create(&context('1'), &args, Some(workspace.path()))
        .unwrap();
    assert_eq!(commit.version.source_relative_path.as_deref(), Some("app"));
    let (relative, root_id): (String, String) = store
        .connection
        .query_row(
            "SELECT source_relative_path, working_root_id FROM artifact_versions LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(relative, "app");
    assert_eq!(root_id, "root-1");
    let database = fs::read(temp.path().join("luca/artifacts/artifacts.sqlite3")).unwrap();
    assert!(
        !String::from_utf8_lossy(&database).contains(workspace.path().to_string_lossy().as_ref())
    );
}

#[test]
fn reconciliation_removes_staging_and_marks_missing_current_blob() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    let created = store
        .create(&context('1'), &create_args("create-1", "blob"), None)
        .unwrap();
    fs::write(store.root.join("staging/abandoned.tmp"), "partial").unwrap();
    let hash: String = store
        .connection
        .query_row(
            "SELECT blob_hash FROM artifact_versions LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    fs::remove_file(blob_path(&store.root.join("blobs"), &hash).unwrap()).unwrap();
    let report = store.reconcile().unwrap();
    assert_eq!(report.removed_staging_entries, 1);
    assert_eq!(report.missing_blob_versions, 1);
    assert_eq!(
        store
            .get(&hex('1'), &id(&created.artifact.artifact_id))
            .unwrap()
            .lifecycle_state,
        "preview_unavailable"
    );
}

#[cfg(unix)]
#[test]
fn managed_blob_reads_reject_symlink_replacement() {
    let temp = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    let created = store
        .create(&context('1'), &create_args("blob-symlink", "safe"), None)
        .unwrap();
    let hash: String = store
        .connection
        .query_row(
            "SELECT blob_hash FROM artifact_versions LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let blob = blob_path(&store.root.join("blobs"), &hash).unwrap();
    fs::remove_file(&blob).unwrap();
    let outside_file = outside.path().join("replacement");
    fs::write(&outside_file, "safe").unwrap();
    std::os::unix::fs::symlink(&outside_file, &blob).unwrap();

    assert_eq!(
        store.read_binary(&hex('1'), &id(&created.artifact.artifact_id), None),
        Err(ArtifactStoreError::CorruptBlob)
    );
}

#[test]
fn schema_identity_is_fail_closed() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("luca/artifacts");
    fs::create_dir_all(&root).unwrap();
    let connection = rusqlite::Connection::open(root.join("artifacts.sqlite3")).unwrap();
    connection
        .execute_batch("PRAGMA application_id = 7; PRAGMA user_version = 99;")
        .unwrap();
    drop(connection);
    assert!(matches!(
        ArtifactStore::open(temp.path()),
        Err(ArtifactStoreError::SchemaIncompatible)
    ));
}

#[test]
fn native_list_paginates_and_filters_metadata_without_loading_bodies() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    for (key, title) in [("list-1", "Alpha"), ("list-2", "Beta"), ("list-3", "Gamma")] {
        let mut args = create_args(key, &format!("<h1>{title}</h1>"));
        args.title = title.into();
        store.create(&context('1'), &args, None).unwrap();
    }
    let query = ArtifactListQuery {
        query: None,
        kinds: vec![ArtifactKindV1::Html, ArtifactKindV1::Html],
        deleted: ArtifactDeletedFilter::Active,
        cursor: None,
        limit: 2,
    };
    let first = store.list_page(&hex('1'), &query).unwrap();
    assert_eq!(first.artifacts.len(), 2);
    assert_eq!(first.total, 3);
    let second = store
        .list_page(
            &hex('1'),
            &ArtifactListQuery {
                cursor: first.next_cursor,
                ..query.clone()
            },
        )
        .unwrap();
    assert_eq!(second.artifacts.len(), 1);
    assert!(second.next_cursor.is_none());

    let by_resident = store
        .list_page(
            &hex('1'),
            &ArtifactListQuery {
                query: Some(hex('2').as_str().into()),
                cursor: None,
                ..query.clone()
            },
        )
        .unwrap();
    assert_eq!(by_resident.total, 3);
    assert_eq!(
        store.list_page(
            &hex('1'),
            &ArtifactListQuery {
                cursor: Some("not-a-cursor".into()),
                ..query
            },
        ),
        Err(ArtifactStoreError::InvalidRequest)
    );
}

#[test]
fn last_preview_metadata_is_owner_scoped_sanitized_input_and_durable() {
    let temp = tempfile::tempdir().unwrap();
    let artifact_id = {
        let mut store = ArtifactStore::open(temp.path()).unwrap();
        let created = store
            .create(&context('1'), &create_args("preview-history", "app"), None)
            .unwrap();
        let artifact_id = id(&created.artifact.artifact_id);
        store
            .record_preview_attachment(
                &hex('1'),
                &artifact_id,
                "http://127.0.0.1",
                5173,
                "2026-08-21T00:00:00Z",
            )
            .unwrap();
        assert_eq!(
            store.record_preview_attachment(
                &hex('1'),
                &artifact_id,
                "http://example.com",
                80,
                "2026-08-21T00:00:00Z",
            ),
            Err(ArtifactStoreError::InvalidRequest)
        );
        artifact_id
    };
    let store = ArtifactStore::open(temp.path()).unwrap();
    assert_eq!(store.last_preview(&hex('3'), &artifact_id).unwrap(), None);
    let preview = store
        .last_preview(&hex('1'), &artifact_id)
        .unwrap()
        .unwrap();
    assert_eq!(preview.origin, "http://127.0.0.1");
    assert_eq!(preview.port, 5173);
}

#[test]
fn accepted_receipt_link_reconciliation_is_idempotent() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    let created = store
        .create(
            &context('1'),
            &create_args("receipt-recovery", "body"),
            None,
        )
        .unwrap();
    assert_eq!(
        store
            .link_turn_receipts(&hex('1'), &id("conversation-1"), &id("turn-1"), &hex('a'))
            .unwrap(),
        1
    );
    assert_eq!(
        store
            .link_turn_receipts(&hex('1'), &id("conversation-1"), &id("turn-1"), &hex('a'))
            .unwrap(),
        0
    );
    let receipt = store
        .latest_receipt(&hex('1'), &id(&created.artifact.artifact_id), 1)
        .unwrap();
    assert_eq!(receipt.state, ArtifactReceiptStateV1::Linked);
    assert_eq!(receipt.message_id.as_deref(), Some(hex('a').as_str()));
}

#[test]
fn older_receipt_settlement_never_overwrites_current_version_state() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    let created = store
        .create(
            &context_for('1', "conversation-1", "turn-1", "dispatch-1"),
            &create_args("out-of-order-create", "v1"),
            None,
        )
        .unwrap();
    store
        .update(
            &context_for('1', "conversation-1", "turn-2", "dispatch-2"),
            &update_args(
                &created.artifact.artifact_id,
                "out-of-order-update",
                1,
                "v2",
            ),
            None,
        )
        .unwrap();

    store
        .link_turn_receipts(&hex('1'), &id("conversation-1"), &id("turn-1"), &hex('a'))
        .unwrap();
    assert_eq!(
        store
            .get(&hex('1'), &id(&created.artifact.artifact_id))
            .unwrap()
            .receipt_state,
        ArtifactReceiptStateV1::Provisional
    );
    store
        .mark_dispatch_receipts(
            &hex('1'),
            &id("conversation-1"),
            &hex('2'),
            &id("dispatch-1"),
            ArtifactReceiptStateV1::Interrupted,
        )
        .unwrap();
    assert_eq!(
        store
            .get(&hex('1'), &id(&created.artifact.artifact_id))
            .unwrap()
            .receipt_state,
        ArtifactReceiptStateV1::Provisional
    );
    store
        .link_turn_receipts(&hex('1'), &id("conversation-1"), &id("turn-2"), &hex('b'))
        .unwrap();
    assert_eq!(
        store
            .get(&hex('1'), &id(&created.artifact.artifact_id))
            .unwrap()
            .receipt_state,
        ArtifactReceiptStateV1::Linked
    );
}

#[test]
fn schema_v1_is_migrated_without_discarding_artifacts() {
    let temp = tempfile::tempdir().unwrap();
    let artifact_id = {
        let mut store = ArtifactStore::open(temp.path()).unwrap();
        let created = store
            .create(&context('1'), &create_args("migrate-v1", "body"), None)
            .unwrap();
        store
            .connection
            .execute_batch("DROP TABLE artifact_preview_history; PRAGMA user_version = 1;")
            .unwrap();
        created.artifact.artifact_id
    };
    let store = ArtifactStore::open(temp.path()).unwrap();
    assert_eq!(
        store.get(&hex('1'), &id(&artifact_id)).unwrap().artifact_id,
        artifact_id
    );
    let version: i64 = store
        .connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, schema::SCHEMA_VERSION);
}

#[allow(dead_code)]
fn assert_relative(_path: &Path) {}
