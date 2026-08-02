//! F10 ACP-side proof that final-response and cancellation semantics do not
//! acquire a Continuity Capsule, Continuity Service, or Mnemos dependency.

use buzz_acp::luca_final_publisher::{
    FinalChunkAccumulator, FinalPublicationError, ManagedFinalTurn,
};
use luca_protocol::{derive_message_publish_idempotency_key, Hex64, OpaqueId, SafeU53};
use nostr::Keys;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct ContinuityAbsentFixture {
    schema: String,
    fixture_class: String,
    components: ContinuityComponents,
    expected: ExpectedOutcomes,
}

#[derive(Debug, Deserialize)]
struct ContinuityComponents {
    continuity_capsule: String,
    continuity_service: String,
    mnemos_profile: String,
}

#[derive(Debug, Deserialize)]
struct ExpectedOutcomes {
    context_status: String,
    normal_final_publication: String,
    cancelled_turn: String,
}

fn absent_fixture() -> ContinuityAbsentFixture {
    serde_json::from_str(include_str!(
        "../../../tests/luca-conformance/f10/continuity_absent.json"
    ))
    .expect("F10 fixture must be valid JSON")
}

fn assert_all_continuity_absent(fixture: &ContinuityAbsentFixture) {
    assert_eq!(fixture.schema, "luca.f10.continuity-absent.v1");
    assert_eq!(fixture.fixture_class, "generated_synthetic");
    assert_eq!(fixture.components.continuity_capsule, "absent");
    assert_eq!(fixture.components.continuity_service, "absent");
    assert_eq!(fixture.components.mnemos_profile, "absent");
    assert_eq!(fixture.expected.context_status, "unavailable");
}

fn opaque(value: &str) -> OpaqueId {
    OpaqueId::parse(value).expect("valid synthetic opaque ID")
}

fn final_turn() -> ManagedFinalTurn {
    let owner = Keys::generate();
    let resident = Keys::generate();
    let dispatch = opaque("f10-synthetic-dispatch");
    let resident_pubkey =
        Hex64::parse(resident.public_key().to_hex()).expect("generated resident pubkey");
    ManagedFinalTurn {
        turn_id: opaque("f10-synthetic-turn"),
        dispatch_receipt_id: dispatch.clone(),
        cancellation_epoch: SafeU53::new(7).expect("valid synthetic epoch"),
        owner_pubkey: Hex64::parse(owner.public_key().to_hex()).expect("generated owner pubkey"),
        resident_pubkey: resident_pubkey.clone(),
        conversation_id: opaque("f10-synthetic-conversation"),
        thread_id: None,
        root_event_id: None,
        reply_event_id: None,
        resolved_p_tags: Vec::new(),
    }
}

#[test]
fn luca_f10_normal_final_reaches_the_real_typed_publication_boundary_when_continuity_is_absent() {
    let fixture = absent_fixture();
    assert_all_continuity_absent(&fixture);

    let mut chunks = FinalChunkAccumulator::default();
    chunks
        .push_agent_message_chunk("synthetic ")
        .expect("bounded first final chunk");
    chunks
        .push_agent_message_chunk("final")
        .expect("bounded second final chunk");
    let final_draft = chunks.finish(false).expect("normal ACP completion");

    let turn = final_turn();
    let request = turn
        .request(final_draft)
        .expect("actual F09 typed publication request");
    request.validate().expect("valid publication contract");
    assert_eq!(
        request.idempotency_key,
        derive_message_publish_idempotency_key(
            &request.dispatch_receipt_id,
            &request.resident_pubkey
        )
        .expect("deterministic publication key")
    );
    assert_eq!(fixture.expected.normal_final_publication, "published");
}

#[test]
fn luca_f10_cancel_remains_terminal_before_publication_when_continuity_is_absent() {
    let fixture = absent_fixture();
    assert_all_continuity_absent(&fixture);

    let mut chunks = FinalChunkAccumulator::default();
    chunks
        .push_agent_message_chunk("synthetic partial")
        .expect("bounded provisional chunk");
    assert_eq!(
        chunks.finish(true),
        Err(FinalPublicationError::Cancelled),
        "continuity absence must not weaken cancellation"
    );
    assert_eq!(fixture.expected.cancelled_turn, "cancelled");
}
