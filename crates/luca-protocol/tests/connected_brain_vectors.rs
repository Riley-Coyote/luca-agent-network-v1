use luca_protocol::{
    ConnectedBrainBindingV1, ConnectedBrainIndexEntryV1, ConnectedBrainPolicyV1,
    ConnectedBrainSourceV1, RepositoryToolDecisionV1, RepositoryToolReceiptV1,
    RepositoryToolRequestV1, RepositoryWorkGrantV1,
};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

fn hash(character: char) -> String {
    format!("sha256:{}", character.to_string().repeat(64))
}

fn public_key(character: char) -> String {
    character.to_string().repeat(64)
}

fn rejects_unknown<T: DeserializeOwned>(mut value: Value) {
    value["unknown"] = Value::Bool(true);
    assert!(serde_json::from_value::<T>(value).is_err());
}

fn source() -> Value {
    json!({
        "protocol": "luca.brain.connected.v1",
        "source_id": "source-repository-one",
        "owner_pubkey": public_key('a'),
        "source_kind": "repository",
        "display_name": "Luca",
        "status": "current",
        "capabilities": ["recall", "repository_read", "repository_request_write"],
        "index_revision": hash('1'),
        "created_at": "2026-08-09T00:00:00Z",
        "updated_at": "2026-08-09T00:01:00Z",
        "last_refreshed_at": "2026-08-09T00:01:00Z"
    })
}

fn request() -> Value {
    json!({
        "protocol": "luca.repository.work.v1",
        "request_id": "request-one",
        "resident_pubkey": public_key('b'),
        "session_epoch": 7,
        "turn_id": "turn-one",
        "conversation_id": "conversation-one",
        "source_id": "source-repository-one",
        "binding_ref": hash('2'),
        "operation": "apply_patch",
        "operation_fingerprint": hash('3'),
        "relative_paths": ["desktop/src/app/App.tsx"],
        "display_summary": "Apply one bounded patch"
    })
}

#[test]
fn connected_source_vectors_accept_body_free_records() {
    let binding = json!({
        "protocol": "luca.brain.connected.v1",
        "source_id": "source-repository-one",
        "owner_pubkey": public_key('a'),
        "canonical_root": "/Users/example/Repositories/luca",
        "adapter_version": "repository-v1",
        "refresh_cursor": "cursor-one"
    });
    let entry = json!({
        "protocol": "luca.brain.connected.v1",
        "entry_id": "entry-one",
        "source_id": "source-repository-one",
        "relative_locator": "desktop/src/app/App.tsx",
        "ordinal": 4,
        "content_hash": hash('4'),
        "token_hashes": [hash('5'), hash('6')],
        "captured_at": "2026-08-09T00:02:00Z"
    });
    let policy = json!({
        "protocol": "luca.brain.connected.v1",
        "all_current_residents": true,
        "all_future_residents": true,
        "remote_excerpt_egress": true,
        "repository_read": true,
        "repository_request_write": true
    });

    serde_json::from_value::<ConnectedBrainSourceV1>(source()).unwrap();
    serde_json::from_value::<ConnectedBrainBindingV1>(binding.clone()).unwrap();
    serde_json::from_value::<ConnectedBrainIndexEntryV1>(entry.clone()).unwrap();
    serde_json::from_value::<ConnectedBrainPolicyV1>(policy.clone()).unwrap();

    rejects_unknown::<ConnectedBrainSourceV1>(source());
    rejects_unknown::<ConnectedBrainBindingV1>(binding);
    rejects_unknown::<ConnectedBrainIndexEntryV1>(entry);
    rejects_unknown::<ConnectedBrainPolicyV1>(policy);
}

#[test]
fn connected_vectors_reject_bodies_paths_and_weakened_defaults() {
    let mut body = source();
    body["body"] = Value::String("must never be stored".into());
    assert!(serde_json::from_value::<ConnectedBrainSourceV1>(body).is_err());

    let unsafe_entry = json!({
        "protocol": "luca.brain.connected.v1",
        "entry_id": "entry-one",
        "source_id": "source-repository-one",
        "relative_locator": "../outside.txt",
        "ordinal": 0,
        "content_hash": hash('4'),
        "token_hashes": [hash('5')]
    });
    assert!(serde_json::from_value::<ConnectedBrainIndexEntryV1>(unsafe_entry).is_err());

    let weakened = json!({
        "protocol": "luca.brain.connected.v1",
        "all_current_residents": true,
        "all_future_residents": false,
        "remote_excerpt_egress": true,
        "repository_read": true,
        "repository_request_write": true
    });
    assert!(serde_json::from_value::<ConnectedBrainPolicyV1>(weakened).is_err());
}

#[test]
fn repository_work_vectors_bind_exact_authority_and_stay_body_free() {
    let grant = json!({
        "protocol": "luca.repository.work.v1",
        "grant_id": "grant-one",
        "source_id": "source-repository-one",
        "resident_pubkey": public_key('b'),
        "binding_ref": hash('2'),
        "state": "active",
        "created_at": "2026-08-09T00:00:00Z",
        "updated_at": "2026-08-09T00:00:00Z"
    });
    let decision = json!({
        "protocol": "luca.repository.work.v1",
        "request_id": "request-one",
        "resident_pubkey": public_key('b'),
        "session_epoch": 7,
        "source_id": "source-repository-one",
        "binding_ref": hash('2'),
        "operation_fingerprint": hash('3'),
        "disposition": "allow_conversation",
        "decided_at": "2026-08-09T00:03:00Z"
    });
    let receipt = json!({
        "protocol": "luca.repository.work.v1",
        "receipt_id": "receipt-one",
        "request_id": "request-one",
        "resident_pubkey": public_key('b'),
        "source_id": "source-repository-one",
        "operation": "apply_patch",
        "status": "completed",
        "changed_path_count": 1,
        "created_at": "2026-08-09T00:04:00Z"
    });

    serde_json::from_value::<RepositoryWorkGrantV1>(grant.clone()).unwrap();
    serde_json::from_value::<RepositoryToolRequestV1>(request()).unwrap();
    serde_json::from_value::<RepositoryToolDecisionV1>(decision.clone()).unwrap();
    serde_json::from_value::<RepositoryToolReceiptV1>(receipt.clone()).unwrap();

    rejects_unknown::<RepositoryWorkGrantV1>(grant);
    rejects_unknown::<RepositoryToolRequestV1>(request());
    rejects_unknown::<RepositoryToolDecisionV1>(decision);
    rejects_unknown::<RepositoryToolReceiptV1>(receipt);
}
