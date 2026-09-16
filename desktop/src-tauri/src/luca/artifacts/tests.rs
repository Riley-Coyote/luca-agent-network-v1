use std::{fs, path::Path};

use luca_protocol::{
    ArtifactCreateArgsV1, ArtifactKindV1, ArtifactReadModeV1, ArtifactReceiptStateV1,
    ArtifactSourceV1, ArtifactUpdateArgsV1, Hex64, OpaqueId, SafeU53, MAX_ARTIFACT_READ_BYTES,
};
use sha2::Digest as _;

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
        attach_to_reply: true,
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
        attach_to_reply: true,
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
        attach_to_reply: true,
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

#[cfg(unix)]
#[test]
fn garbage_collection_never_traverses_an_external_shard_symlink() {
    let temp = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    let bytes = b"outside-cas-must-survive";
    let hash = hex::encode(sha2::Sha256::digest(bytes));
    let outside_blob = outside.path().join(&hash);
    fs::write(&outside_blob, bytes).unwrap();
    fs::create_dir_all(store.root.join("blobs/sha256")).unwrap();
    std::os::unix::fs::symlink(
        outside.path(),
        store.root.join("blobs/sha256").join(&hash[..2]),
    )
    .unwrap();

    assert_eq!(store.garbage_collect(Duration::ZERO).unwrap(), 0);
    assert_eq!(fs::read(outside_blob).unwrap(), bytes);
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

// ── images a turn asked to put in its reply ─────────────────────────────────

const ONE_PIXEL_PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0x64, 0xf8, 0xcf, 0x50,
    0x0f, 0x00, 0x03, 0x86, 0x01, 0x80, 0x5a, 0x34, 0x7d, 0x6b, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

fn png_with_suffix(len: usize) -> Vec<u8> {
    let mut bytes = ONE_PIXEL_PNG.to_vec();
    bytes.extend(std::iter::repeat_n(b'\n', len));
    bytes
}

fn image_args(key: &str, relative_path: &str, attach_to_reply: bool) -> ArtifactCreateArgsV1 {
    ArtifactCreateArgsV1 {
        title: "A plot".into(),
        kind: ArtifactKindV1::Image,
        source: ArtifactSourceV1::WorkspaceFile {
            relative_path: relative_path.into(),
            declared_media_type: None,
        },
        idempotency_key: id(key),
        attach_to_reply,
    }
}

#[test]
fn a_turn_offers_only_the_images_it_asked_to_attach() {
    let temp = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("first.png"), png_with_suffix(1)).unwrap();
    fs::write(workspace.path().join("second.png"), png_with_suffix(2)).unwrap();
    fs::write(workspace.path().join("private.png"), png_with_suffix(3)).unwrap();
    fs::write(workspace.path().join("note.md"), "# text").unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();

    store
        .create(
            &context('1'),
            &image_args("img-1", "first.png", true),
            Some(workspace.path()),
        )
        .unwrap();
    store
        .create(
            &context('1'),
            &image_args("img-2", "second.png", true),
            Some(workspace.path()),
        )
        .unwrap();
    store
        .create(
            &context('1'),
            &image_args("img-3", "private.png", false),
            Some(workspace.path()),
        )
        .unwrap();
    let mut markdown = create_args("note-1", "unused");
    markdown.kind = ArtifactKindV1::Markdown;
    markdown.source = ArtifactSourceV1::WorkspaceFile {
        relative_path: "note.md".into(),
        declared_media_type: None,
    };
    store
        .create(&context('1'), &markdown, Some(workspace.path()))
        .unwrap();
    // Another turn's picture must never reach this reply.
    fs::write(workspace.path().join("other.png"), png_with_suffix(4)).unwrap();
    store
        .create(
            &context_for('1', "conversation-1", "turn-2", "dispatch-2"),
            &image_args("img-4", "other.png", true),
            Some(workspace.path()),
        )
        .unwrap();

    let found = store
        .turn_reply_images(&hex('1'), &id("conversation-1"), &id("turn-1"), 4)
        .unwrap();
    assert_eq!(found.total, 2);
    assert_eq!(found.images.len(), 2);
    assert_eq!(
        found
            .images
            .iter()
            .map(|image| image.filename.as_str())
            .collect::<Vec<_>>(),
        vec!["first.png", "second.png"],
        "in the order the resident made them"
    );
    assert!(found
        .images
        .iter()
        .all(|image| image.media_type == "image/png"));
    assert_eq!(found.images[0].bytes, png_with_suffix(1));
}

#[test]
fn the_reply_image_limit_reports_what_it_left_behind() {
    let temp = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    for index in 0..6 {
        let name = format!("plot-{index}.png");
        fs::write(workspace.path().join(&name), png_with_suffix(index + 1)).unwrap();
        store
            .create(
                &context('1'),
                &image_args(&format!("img-{index}"), &name, true),
                Some(workspace.path()),
            )
            .unwrap();
    }
    let found = store
        .turn_reply_images(&hex('1'), &id("conversation-1"), &id("turn-1"), 4)
        .unwrap();
    assert_eq!(found.total, 6);
    assert_eq!(found.images.len(), 4);
}

#[test]
fn a_deleted_image_no_longer_rides_the_reply() {
    let temp = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("gone.png"), png_with_suffix(1)).unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    let created = store
        .create(
            &context('1'),
            &image_args("img-1", "gone.png", true),
            Some(workspace.path()),
        )
        .unwrap();
    store
        .soft_delete(&hex('1'), &id(&created.artifact.artifact_id))
        .unwrap();
    let found = store
        .turn_reply_images(&hex('1'), &id("conversation-1"), &id("turn-1"), 4)
        .unwrap();
    assert_eq!(found.total, 0);
}

#[test]
fn an_owner_import_has_no_reply_to_ride() {
    let temp = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("owned.png"), png_with_suffix(1)).unwrap();
    let mut store = ArtifactStore::open(temp.path()).unwrap();
    store
        .create(
            &ArtifactWriteContext {
                conversation_id: None,
                turn_id: None,
                dispatch_receipt_id: None,
                receipt_state: ArtifactReceiptStateV1::Linked,
                ..context('1')
            },
            &image_args("img-1", "owned.png", true),
            Some(workspace.path()),
        )
        .unwrap();
    // No conversation and no turn: nothing can ask for it.
    let found = store
        .turn_reply_images(&hex('1'), &id("conversation-1"), &id("turn-1"), 4)
        .unwrap();
    assert_eq!(found.total, 0);
}

#[test]
fn a_v2_library_migrates_without_attaching_anything_retroactively() {
    let temp = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("old.png"), png_with_suffix(1)).unwrap();
    {
        let mut store = ArtifactStore::open(temp.path()).unwrap();
        store
            .create(
                &context('1'),
                &image_args("img-1", "old.png", true),
                Some(workspace.path()),
            )
            .unwrap();
        // Rebuild the receipts table exactly as a beta.9 install had it:
        // every column except the one this migration adds.
        store
            .connection
            .execute_batch(
                "PRAGMA foreign_keys = OFF;
                 CREATE TABLE artifact_receipts_v2 (
                    owner_pubkey TEXT NOT NULL,
                    receipt_id TEXT NOT NULL,
                    artifact_id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    resident_pubkey TEXT NOT NULL,
                    conversation_id TEXT,
                    turn_id TEXT,
                    dispatch_receipt_id TEXT,
                    message_id TEXT,
                    state TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    linked_at TEXT,
                    PRIMARY KEY (owner_pubkey, receipt_id),
                    FOREIGN KEY (owner_pubkey, artifact_id, version)
                      REFERENCES artifact_versions(owner_pubkey, artifact_id, version)
                      ON DELETE CASCADE
                 ) STRICT;
                 INSERT INTO artifact_receipts_v2
                   SELECT owner_pubkey, receipt_id, artifact_id, version, resident_pubkey,
                          conversation_id, turn_id, dispatch_receipt_id, message_id, state,
                          created_at, linked_at
                     FROM artifact_receipts;
                 DROP TABLE artifact_receipts;
                 ALTER TABLE artifact_receipts_v2 RENAME TO artifact_receipts;
                 PRAGMA foreign_keys = ON;
                 PRAGMA user_version = 2;",
            )
            .unwrap();
    }
    let store = ArtifactStore::open(temp.path()).expect("a v2 library opens and migrates");
    let found = store
        .turn_reply_images(&hex('1'), &id("conversation-1"), &id("turn-1"), 4)
        .unwrap();
    assert_eq!(
        found.total, 0,
        "a picture made before this existed does not retroactively join a reply"
    );
}

#[test]
fn an_attached_filename_is_safe_for_a_tag_and_a_download() {
    assert_eq!(
        reply_image_filename(Some("plots/q3 final.png"), "Ignored", "image/png"),
        "q3-final.png"
    );
    assert_eq!(
        reply_image_filename(None, "A plot", "image/jpeg"),
        "A-plot.jpg"
    );
    assert_eq!(
        reply_image_filename(Some("run.agent.png"), "A plot", "image/png"),
        "image.png",
        "a name the renderer would treat as a snapshot card is dropped"
    );
    assert_eq!(
        reply_image_filename(Some("..."), "   ", "image/webp"),
        "image.webp"
    );
    assert_eq!(
        reply_image_filename(Some("a\nb.png"), "t", "image/png"),
        "a-b.png"
    );
}
