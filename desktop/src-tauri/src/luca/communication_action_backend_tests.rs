use luca_protocol::{CanonicalTimestamp, Sha256Ref};

use super::*;
use crate::luca::communication_bridge::CommunicationTurnCoordinates;

const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const RESIDENT: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const OTHER: &str = "3333333333333333333333333333333333333333333333333333333333333333";

fn authority() -> CommunicationTurnAuthoritySnapshot {
    CommunicationTurnAuthoritySnapshot {
        owner_pubkey: hex64(OWNER),
        resident_pubkey: hex64(RESIDENT),
        session_epoch: SafeU53::new(7).expect("session epoch"),
        runtime_binding_ref: Sha256Ref::parse(format!("sha256:{}", "a".repeat(64)))
            .expect("binding"),
        coordinates: CommunicationTurnCoordinates {
            source_conversation_id: opaque("conversation-1"),
            turn_id: opaque("turn-1"),
            dispatch_receipt_id: opaque("dispatch-1"),
            cancellation_epoch: SafeU53::new(7).expect("cancellation epoch"),
        },
        causal_root_id: opaque("dispatch-1"),
        owned_resident_pubkeys: [hex64(RESIDENT), hex64(OTHER)].into_iter().collect(),
        expires_at: CanonicalTimestamp::parse("2099-01-01T00:00:00Z").expect("expiry"),
    }
}

#[test]
fn managed_room_uuid_is_retry_stable_and_payload_scoped() {
    let authority = authority();
    let participants = [hex64(OWNER), hex64(RESIDENT), hex64(OTHER)]
        .into_iter()
        .collect::<BTreeSet<_>>();
    let first = managed_room_uuid(
        &authority,
        &opaque("operation-1"),
        "Release room",
        Some("Coordinate the preview."),
        &participants,
    )
    .expect("first room id");
    let retry = managed_room_uuid(
        &authority,
        &opaque("operation-1"),
        "Release room",
        Some("Coordinate the preview."),
        &participants,
    )
    .expect("retry room id");
    let changed_operation = managed_room_uuid(
        &authority,
        &opaque("operation-2"),
        "Release room",
        Some("Coordinate the preview."),
        &participants,
    )
    .expect("changed operation room id");
    let changed_label = managed_room_uuid(
        &authority,
        &opaque("operation-1"),
        "Other room",
        Some("Coordinate the preview."),
        &participants,
    )
    .expect("changed label room id");

    assert_eq!(first, retry);
    assert_ne!(first, changed_operation);
    assert_ne!(first, changed_label);
}

#[test]
fn managed_room_uuid_is_independent_of_participant_insertion_order() {
    let authority = authority();
    let forward = [hex64(OWNER), hex64(RESIDENT), hex64(OTHER)]
        .into_iter()
        .collect::<BTreeSet<_>>();
    let reverse = [hex64(OTHER), hex64(RESIDENT), hex64(OWNER)]
        .into_iter()
        .collect::<BTreeSet<_>>();

    assert_eq!(
        managed_room_uuid(&authority, &opaque("operation-1"), "Room", None, &forward,)
            .expect("forward room id"),
        managed_room_uuid(&authority, &opaque("operation-1"), "Room", None, &reverse,)
            .expect("reverse room id"),
    );
}

#[test]
fn durable_artifact_binding_projects_only_path_free_semantic_metadata() {
    let handles = protocol_artifact_handles(vec![
        crate::luca::managed_dispatch_store::ManagedArtifactBinding {
            handle_id: "artifact-upload-1".to_owned(),
            url: "https://relay.invalid/private-blob".to_owned(),
            content_sha256: "a".repeat(64),
            byte_length: 42,
            media_type: "text/plain".to_owned(),
            display_name: Some("notes.txt".to_owned()),
            expires_at: 1_000,
        },
    ])
    .expect("semantic handle");
    assert_eq!(handles.len(), 1);
    assert_eq!(handles[0].handle_id, opaque("artifact-upload-1"));
    assert_eq!(handles[0].content_sha256, hex64(&"a".repeat(64)));
    assert_eq!(handles[0].byte_length, SafeU53::new(42).unwrap());
    assert_eq!(handles[0].media_type, "text/plain");
    assert_eq!(handles[0].display_name.as_deref(), Some("notes.txt"));
    let serialized = serde_json::to_string(&handles).expect("serialize");
    assert!(!serialized.contains("relay.invalid"));
    assert!(!serialized.contains("private-blob"));
}

fn hex64(value: &str) -> Hex64 {
    Hex64::parse(value.to_owned()).expect("hex64")
}

fn opaque(value: &str) -> OpaqueId {
    OpaqueId::parse(value.to_owned()).expect("opaque id")
}
