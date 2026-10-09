use luca_protocol::{
    derive_initiative_thread_ref, CanonicalTimestamp, Hex64, InitiativeDispositionV1,
    InitiativeSemanticThreadV1, InitiativeThreadError, SafeU53,
    INITIATIVE_SEMANTIC_THREAD_PROTOCOL, MAX_INITIATIVE_THREAD_BODY_BYTES,
};
use serde_json::json;

fn thread() -> InitiativeSemanticThreadV1 {
    serde_json::from_value(json!({
        "protocol": INITIATIVE_SEMANTIC_THREAD_PROTOCOL,
        "thread_id": "carried:old-question",
        "owner_pubkey": "a".repeat(64),
        "resident_pubkey": "b".repeat(64),
        "kind": "shared", "disposition": "carried", "revision": 0,
        "body": "An older explicit commitment stays carried until it is settled.",
        "source_event_ids": ["c".repeat(64)],
        "source_refs": [format!("sha256:{}", "c".repeat(64))],
        "created_at": "2026-01-01T10:00:00Z", "updated_at": "2026-01-01T10:00:00Z"
    }))
    .expect("private fixture semantic thread")
}

#[test]
fn canonical_semantic_roundtrip_preserves_older_carried_material() {
    let original = thread();
    let encoded = serde_json::to_vec(&original).expect("fixture serialization");
    let restored: InitiativeSemanticThreadV1 =
        serde_json::from_slice(&encoded).expect("strict restore");
    assert!(restored == original);
    assert_eq!(
        restored.revision_ref().expect("revision ref"),
        original.revision_ref().expect("revision ref")
    );
    let identity = derive_initiative_thread_ref(
        &original.owner_pubkey,
        &original.resident_pubkey,
        &original.thread_id,
    )
    .expect("identity ref");
    let mut next = original.clone();
    next.revision = SafeU53::new(1).expect("successor revision");
    next.disposition = InitiativeDispositionV1::Retired;
    next.updated_at = CanonicalTimestamp::parse("2026-10-08T10:00:00Z").expect("later timestamp");
    next.validate_successor_of(&original)
        .expect("explicit disposition successor");
    assert_eq!(
        derive_initiative_thread_ref(&next.owner_pubkey, &next.resident_pubkey, &next.thread_id)
            .expect("identity"),
        identity
    );
    assert_ne!(
        next.revision_ref().expect("revision ref"),
        original.revision_ref().expect("revision ref")
    );
    assert_eq!(next.body, original.body);
}

#[test]
fn successor_rejects_wrong_principal_stale_revision_and_creation_rewrite() {
    let original = thread();
    let mut next = original.clone();
    next.revision = SafeU53::new(1).expect("successor revision");
    let mut wrong = next.clone();
    wrong.resident_pubkey = Hex64::parse("d".repeat(64)).expect("other resident");
    assert_eq!(
        wrong.validate_successor_of(&original),
        Err(InitiativeThreadError::Binding)
    );
    let mut stale = next.clone();
    stale.revision = SafeU53::new(2).expect("wrong revision");
    assert_eq!(
        stale.validate_successor_of(&original),
        Err(InitiativeThreadError::Revision)
    );
    next.created_at =
        CanonicalTimestamp::parse("2026-01-01T09:00:00Z").expect("rewritten creation");
    assert_eq!(
        next.validate_successor_of(&original),
        Err(InitiativeThreadError::Revision)
    );
}

#[test]
fn semantic_body_rejects_unbounded_provenance_and_authority_fields() {
    let valid = serde_json::to_value(thread()).expect("fixture JSON");
    for field in [
        "model",
        "provider",
        "grant",
        "budget",
        "working_folder",
        "checkpoint_ref",
        "actor",
    ] {
        let mut invalid = valid.clone();
        invalid[field] = json!("untrusted selection");
        assert!(
            serde_json::from_value::<InitiativeSemanticThreadV1>(invalid).is_err(),
            "{field}"
        );
    }
    for (field, value) in [
        ("protocol", json!("polyphonic.initiative-thread.v2")),
        (
            "body",
            json!("x".repeat(MAX_INITIATIVE_THREAD_BODY_BYTES + 1)),
        ),
        ("source_refs", json!([])),
        ("source_event_ids", json!(["d".repeat(64)])),
        ("eligible_after", json!("2026-10-08T12:00:00Z")),
    ] {
        let mut invalid = valid.clone();
        invalid[field] = value;
        assert!(
            serde_json::from_value::<InitiativeSemanticThreadV1>(invalid).is_err(),
            "{field}"
        );
    }
}
