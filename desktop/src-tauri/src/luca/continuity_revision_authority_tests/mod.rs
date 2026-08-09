use super::*;
use luca_continuity::{
    derive_revision_idempotency_key, encrypt_record, RecordMetadata, RevisionActor,
    RevisionOperation,
};
use luca_protocol::{CanonicalTimestamp, ContinuityNamespaceKindV1, CONTINUITY_PROTOCOL};
use std::{sync::mpsc, thread, time::Duration};
use tempfile::TempDir;

fn hex(digit: char) -> Hex64 {
    Hex64::parse(digit.to_string().repeat(64)).unwrap()
}
fn sha(digit: char) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", digit.to_string().repeat(64))).unwrap()
}
fn id(value: &str) -> OpaqueId {
    OpaqueId::parse(value).unwrap()
}

fn record(record_id: &str, revision: u64, predecessor: Option<&str>) -> ContinuityRecordV1 {
    record_authored(
        record_id,
        revision,
        predecessor,
        if revision == 0 { "owner" } else { "resident" },
    )
}

fn record_authored(
    record_id: &str,
    revision: u64,
    predecessor: Option<&str>,
    author_kind: &str,
) -> ContinuityRecordV1 {
    let namespace = ContinuityNamespaceV1 {
        protocol: CONTINUITY_PROTOCOL.into(),
        owner_pubkey: hex('1'),
        kind: ContinuityNamespaceKindV1::ResidentPrivate,
        resident_pubkey: Some(hex('2')),
        namespace_ref: sha('3'),
        key_version: SafeU53::new(1).unwrap(),
    };
    encrypt_record(
        RecordMetadata {
            protocol: CONTINUITY_PROTOCOL.into(),
            record_id: id(record_id),
            namespace: namespace.clone(),
            scope: ContinuityScopeV1 {
                protocol: CONTINUITY_PROTOCOL.into(),
                namespace_ref: namespace.namespace_ref.clone(),
                scope_ref: sha('4'),
                source_id: Some(id("source")),
                project_id: None,
                room_id: None,
                conversation_id: Some(id("conversation")),
            },
            record_type: id("hypomnema"),
            revision: SafeU53::new(revision).unwrap(),
            predecessor_record_id: predecessor.map(id),
            created_at: CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
            author_kind: id(author_kind),
            provenance_refs: vec![sha('5')],
            key_version: SafeU53::new(1).unwrap(),
        },
        &[7; 32],
        b"private",
    )
    .unwrap()
}

fn request(
    operation: RevisionOperation,
    key_seed: char,
    successor: Option<ContinuityRecordV1>,
    expected: Option<&str>,
) -> RevisionRequest {
    request_for_lineage("record-0", operation, key_seed, successor, expected)
}

fn request_for_lineage(
    lineage_root_id: &str,
    operation: RevisionOperation,
    key_seed: char,
    successor: Option<ContinuityRecordV1>,
    expected: Option<&str>,
) -> RevisionRequest {
    let mut value = RevisionRequest {
        idempotency_key: sha('0'),
        operation,
        lineage_root_id: id(lineage_root_id),
        expected_head_record_id: expected.map(id),
        actor: if matches!(operation, RevisionOperation::Revise) {
            RevisionActor::Resident
        } else {
            RevisionActor::Owner
        },
        signed_source_event_refs: vec![sha(key_seed)],
        request_ref: sha(key_seed),
        successor_ciphertext_ref: successor
            .as_ref()
            .map(|value| luca_continuity::encrypted_record_reference(value).unwrap()),
        successor,
        rollback_source_record_id: None,
        derived_artifact_refs: Vec::new(),
    };
    let authority_record = value.successor.as_ref().unwrap();
    value.idempotency_key = derive_revision_idempotency_key(
        &authority_record.namespace,
        &authority_record.scope,
        &authority_record.record_type,
        authority_record.key_version,
        &value,
    )
    .unwrap();
    value
}

fn namespace_scope(record: &ContinuityRecordV1) -> NamespaceScope {
    NamespaceScope::new(
        record.namespace.clone().try_into().unwrap(),
        record.scope.clone(),
    )
    .unwrap()
}

fn open(temp: &TempDir) -> ContinuityStore {
    match ContinuityStore::open(
        temp.path(),
        super::super::continuity_store::ContinuityStoreCustody::Ready,
    )
    .unwrap()
    {
        super::super::continuity_store::ContinuityStoreOpen::Ready(value) => value,
        _ => panic!("expected ready"),
    }
}

fn begin_generation_bump(store: &ContinuityStore) {
    store
        .connection
        .execute_batch("BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON;")
        .unwrap();
}

fn commit_generation_bump(store: &ContinuityStore, owner: &Hex64, current: u64, next: u64) {
    for table in AUTHORITY_TABLES
        .iter()
        .copied()
        .filter(|table| *table != "continuity_authority_meta")
    {
        store
            .connection
            .execute(
                &format!(
                    "UPDATE {table} SET authority_generation=?3
                     WHERE owner_pubkey=?1 AND authority_generation=?2"
                ),
                params![owner.as_str(), current as i64, next as i64],
            )
            .unwrap();
    }
    store
        .connection
        .execute(
            "UPDATE continuity_authority_meta SET generation=?3
             WHERE owner_pubkey=?1 AND generation=?2",
            params![owner.as_str(), current as i64, next as i64],
        )
        .unwrap();
    store.connection.execute_batch("COMMIT").unwrap();
}

fn assert_replay_waits_for_writer<T>(receiver: &mpsc::Receiver<T>) {
    assert!(matches!(
        receiver.recv_timeout(Duration::from_millis(200)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
}

mod capture;
mod persistence;
