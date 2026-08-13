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

fn approved_delete_request() -> CommunicationActionRequestV1 {
    let authority = authority();
    let mut request = CommunicationActionRequestV1 {
        protocol: luca_protocol::COMMUNICATION_ACTION_PROTOCOL.into(),
        action_id: opaque("delete-action-1"),
        idempotency_key: hex64(&"0".repeat(64)),
        action_fingerprint: Sha256Ref::parse(format!("sha256:{}", "0".repeat(64)))
            .expect("zero fingerprint"),
        actor_pubkey: authority.resident_pubkey.clone(),
        owner_pubkey: authority.owner_pubkey.clone(),
        resident_pubkey: authority.resident_pubkey.clone(),
        session_epoch: authority.session_epoch,
        runtime_binding_ref: authority.runtime_binding_ref.clone(),
        source_conversation_id: authority.coordinates.source_conversation_id.clone(),
        destination: CommunicationDestinationV1::ExistingConversation {
            conversation_id: opaque("conversation-1"),
            participant_set_version: SafeU53::new(1).expect("version"),
            participant_set_ref: Sha256Ref::parse(format!("sha256:{}", "4".repeat(64)))
                .expect("participant ref"),
        },
        turn_id: authority.coordinates.turn_id.clone(),
        dispatch_receipt_id: authority.coordinates.dispatch_receipt_id.clone(),
        causal_root_id: authority.causal_root_id.clone(),
        causal_parent_action_id: None,
        causal_depth: SafeU53::new(0).expect("depth"),
        cancellation_epoch: authority.coordinates.cancellation_epoch,
        expires_at: authority.expires_at.clone(),
        approval_id: Some(opaque("delete-approval-1")),
        operation: CommunicationOperationV1::DeleteOwnMessage {
            target_event_id: hex64(&"d".repeat(64)),
        },
    };
    request.action_fingerprint = request.derive_action_fingerprint().expect("fingerprint");
    request.idempotency_key = request.derive_idempotency_key().expect("idempotency");
    request.validate().expect("approved request");
    request
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

#[test]
fn delete_permission_surface_is_one_shot_and_body_free() {
    let request = approved_delete_request();
    let permission = delete_permission_request(&request).expect("permission request");
    assert_eq!(
        permission.acp_request_id,
        request.action_fingerprint.as_str()
    );
    assert_eq!(permission.resident_pubkey, request.resident_pubkey);
    assert_eq!(permission.turn_id, request.turn_id);
    assert_eq!(permission.conversation_id, opaque("conversation-1"));
    assert_eq!(permission.options.len(), 2);
    assert_eq!(permission.options[0].option_id, COMMUNICATION_ALLOW_ONCE);
    assert_eq!(permission.options[0].kind, "allow_once");
    assert_eq!(permission.options[1].option_id, COMMUNICATION_REJECT);
    assert_eq!(permission.options[1].kind, "reject_once");
    let serialized = serde_json::to_string(&permission).expect("serialize permission");
    assert!(!serialized.contains("d".repeat(64).as_str()));
}

#[test]
fn approval_binding_is_exact_and_rejects_action_drift() {
    let request = approved_delete_request();
    let now = CanonicalTimestamp::parse("2026-08-12T00:00:00Z").expect("now");
    let approval = exact_approval_binding(&request, now.clone()).expect("exact approval");
    approval
        .validate_request(&request, &now)
        .expect("approval matches exact request");

    let mut changed = request.clone();
    changed.operation = CommunicationOperationV1::DeleteOwnMessage {
        target_event_id: hex64(&"e".repeat(64)),
    };
    changed.action_fingerprint = changed
        .derive_action_fingerprint()
        .expect("changed fingerprint");
    changed.idempotency_key = changed
        .derive_idempotency_key()
        .expect("changed idempotency");
    assert!(approval.validate_request(&changed, &now).is_err());

    let ordinary = CommunicationActionRequestV1 {
        approval_id: None,
        operation: CommunicationOperationV1::AddReaction {
            target_event_id: hex64(&"d".repeat(64)),
            reaction: "+".into(),
        },
        ..request
    };
    assert!(delete_permission_request(&ordinary).is_err());
}

fn hex64(value: &str) -> Hex64 {
    Hex64::parse(value.to_owned()).expect("hex64")
}

fn opaque(value: &str) -> OpaqueId {
    OpaqueId::parse(value.to_owned()).expect("opaque id")
}
