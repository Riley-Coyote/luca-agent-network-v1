use luca_protocol::{
    OwnerBrainChunkV1, OwnerBrainContextReceiptV1, OwnerBrainImportCommitV1,
    OwnerBrainImportPreviewV1, OwnerBrainPreviewRowV1, OwnerBrainSourceBindingV1,
    OwnerBrainSourceV1, MAX_OWNER_BRAIN_CHUNK_BYTES,
};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

fn hash(character: char) -> String {
    format!("sha256:{}", character.to_string().repeat(64))
}

fn owner() -> String {
    "a".repeat(64)
}

fn valid_source() -> Value {
    json!({
        "protocol": "luca.continuity.v1",
        "source_id": "source-alpha",
        "owner_pubkey": owner(),
        "source_kind": "text_folder",
        "display_name": "Field Notes",
        "root_hash": hash('1'),
        "import_transaction_id": "import-alpha",
        "created_at": "2026-08-08T20:00:00Z",
        "updated_at": "2026-08-08T20:00:00Z",
        "status": "ready"
    })
}

fn valid_binding() -> Value {
    json!({
        "protocol": "luca.continuity.v1",
        "source_id": "source-alpha",
        "owner_pubkey": owner(),
        "canonical_path": "/Users/example/Documents/Field Notes",
        "last_snapshot_hash": hash('1')
    })
}

fn valid_chunk() -> Value {
    json!({
        "protocol": "luca.continuity.v1",
        "chunk_id": "chunk-alpha-0",
        "source_id": "source-alpha",
        "ordinal": 0,
        "body": "The launch review is scheduled for Monday.",
        "content_hash": hash('2'),
        "source_locator": "planning/launch.md#chunk-0000",
        "created_at": "2026-08-08T20:00:00Z"
    })
}

fn accepted_row(path: &str, byte_count: u64, hash_character: char) -> Value {
    json!({
        "relative_path": path,
        "status": "accepted",
        "byte_count": byte_count,
        "content_hash": hash(hash_character)
    })
}

fn valid_preview() -> Value {
    json!({
        "protocol": "luca.continuity.v1",
        "preview_id": "preview-alpha",
        "preview_token_hash": hash('3'),
        "owner_pubkey": owner(),
        "source_kind": "text_folder",
        "display_name": "Field Notes",
        "root_snapshot_hash": hash('1'),
        "created_at": "2026-08-08T20:00:00Z",
        "expires_at": "2026-08-08T20:15:00Z",
        "rows": [
            accepted_row("planning/launch.md", 48, '4'),
            {
                "relative_path": "private/.env",
                "status": "credential_like",
                "byte_count": 32,
                "reason_code": "credential-pattern"
            }
        ],
        "accepted_bytes": 48,
        "write_count": 0
    })
}

fn valid_commit() -> Value {
    json!({
        "protocol": "luca.continuity.v1",
        "import_transaction_id": "import-alpha",
        "preview_id": "preview-alpha",
        "source_id": "source-alpha",
        "root_snapshot_hash": hash('1'),
        "state": "committed",
        "imported_file_count": 1,
        "imported_chunk_count": 1,
        "completed_at": "2026-08-08T20:01:00Z"
    })
}

fn valid_receipt() -> Value {
    json!({
        "protocol": "luca.continuity.v1",
        "receipt_id": "receipt-alpha",
        "request_id": "request-alpha",
        "owner_pubkey": owner(),
        "resident_pubkey": "b".repeat(64),
        "source_id": "source-alpha",
        "grant_id": "grant-alpha",
        "status": "ready",
        "selected_chunk_hashes": [hash('4'), hash('5')],
        "selected_byte_count": 512,
        "truncated": false,
        "duration_ms": 4,
        "created_at": "2026-08-08T20:02:00Z"
    })
}

fn rejects_unknown_and_wrong_protocol<T: DeserializeOwned>(value: Value) {
    let mut wrong_protocol = value.clone();
    wrong_protocol["protocol"] = Value::String("luca.continuity.v2".into());
    assert!(serde_json::from_value::<T>(wrong_protocol).is_err());

    let mut unknown = value;
    unknown["unknown_field"] = Value::Bool(true);
    assert!(serde_json::from_value::<T>(unknown).is_err());
}

#[test]
fn scoped_brain_contract_vectors_accept_the_narrow_valid_loop() {
    serde_json::from_value::<OwnerBrainSourceV1>(valid_source()).unwrap();
    serde_json::from_value::<OwnerBrainSourceBindingV1>(valid_binding()).unwrap();
    serde_json::from_value::<OwnerBrainChunkV1>(valid_chunk()).unwrap();
    serde_json::from_value::<OwnerBrainPreviewRowV1>(accepted_row("notes.md", 12, '4')).unwrap();
    serde_json::from_value::<OwnerBrainImportPreviewV1>(valid_preview()).unwrap();
    serde_json::from_value::<OwnerBrainImportCommitV1>(valid_commit()).unwrap();
    serde_json::from_value::<OwnerBrainContextReceiptV1>(valid_receipt()).unwrap();
}

#[test]
fn every_scoped_brain_contract_is_strict_during_deserialization() {
    rejects_unknown_and_wrong_protocol::<OwnerBrainSourceV1>(valid_source());
    rejects_unknown_and_wrong_protocol::<OwnerBrainSourceBindingV1>(valid_binding());
    rejects_unknown_and_wrong_protocol::<OwnerBrainChunkV1>(valid_chunk());
    rejects_unknown_and_wrong_protocol::<OwnerBrainImportPreviewV1>(valid_preview());
    rejects_unknown_and_wrong_protocol::<OwnerBrainImportCommitV1>(valid_commit());
    rejects_unknown_and_wrong_protocol::<OwnerBrainContextReceiptV1>(valid_receipt());
}

#[test]
fn paths_bodies_preview_snapshots_and_terminal_states_fail_closed() {
    let mut binding = valid_binding();
    binding["canonical_path"] = Value::String("../outside".into());
    assert!(serde_json::from_value::<OwnerBrainSourceBindingV1>(binding).is_err());

    let mut chunk = valid_chunk();
    chunk["source_locator"] = Value::String("../../secret.md".into());
    assert!(serde_json::from_value::<OwnerBrainChunkV1>(chunk).is_err());
    let mut chunk = valid_chunk();
    chunk["body"] = Value::String("x".repeat(MAX_OWNER_BRAIN_CHUNK_BYTES + 1));
    assert!(serde_json::from_value::<OwnerBrainChunkV1>(chunk).is_err());

    let mut preview = valid_preview();
    preview["write_count"] = json!(1);
    assert!(serde_json::from_value::<OwnerBrainImportPreviewV1>(preview).is_err());
    let mut preview = valid_preview();
    preview["accepted_bytes"] = json!(47);
    assert!(serde_json::from_value::<OwnerBrainImportPreviewV1>(preview).is_err());
    let mut preview = valid_preview();
    preview["expires_at"] = preview["created_at"].clone();
    assert!(serde_json::from_value::<OwnerBrainImportPreviewV1>(preview).is_err());

    let mut commit = valid_commit();
    commit["state"] = Value::String("failed".into());
    assert!(serde_json::from_value::<OwnerBrainImportCommitV1>(commit).is_err());
}

#[test]
fn receipts_are_body_free_and_require_ready_selection_symmetry() {
    let receipt = serde_json::from_value::<OwnerBrainContextReceiptV1>(valid_receipt()).unwrap();
    let encoded = serde_json::to_string(&receipt).unwrap();
    for forbidden in ["body", "path", "locator", "Field Notes", "launch review"] {
        assert!(!encoded.contains(forbidden), "receipt leaked {forbidden}");
    }

    let mut denied = valid_receipt();
    denied["status"] = Value::String("denied".into());
    assert!(serde_json::from_value::<OwnerBrainContextReceiptV1>(denied).is_err());
}

#[test]
fn sensitive_debug_output_is_redacted() {
    let source = serde_json::from_value::<OwnerBrainSourceV1>(valid_source()).unwrap();
    assert!(!format!("{source:?}").contains("Field Notes"));
    let binding = serde_json::from_value::<OwnerBrainSourceBindingV1>(valid_binding()).unwrap();
    assert!(!format!("{binding:?}").contains("/Users/example"));
    let chunk = serde_json::from_value::<OwnerBrainChunkV1>(valid_chunk()).unwrap();
    assert!(!format!("{chunk:?}").contains("launch review"));
}
