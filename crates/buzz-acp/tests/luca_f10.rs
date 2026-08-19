//! F10 ACP-side proof that final-response and cancellation semantics do not
//! acquire a Continuity Capsule, Continuity Service, or Mnemos dependency.

use buzz_acp::continuity_provider::{
    resolve_continuity_fail_soft, ScriptedContinuityProvider, ScriptedContinuityResponse,
};
use buzz_acp::luca_final_publisher::{
    FinalChunkAccumulator, FinalPublicationError, ManagedFinalTurn,
};
use luca_protocol::{
    derive_message_publish_idempotency_key, ContinuityContextRequestV1, ContinuityLayerStatusV1,
    Hex64, ManagedResponseSurfaceV1, OpaqueId, SafeU53, CONTINUITY_PROTOCOL,
    MAX_CONTINUITY_PACKET_BYTES,
};
use nostr::Keys;
use serde::Deserialize;
use serde_json::json;
use std::collections::BTreeSet;

#[derive(Debug, Deserialize)]
struct ContinuityAbsentFixture {
    schema: String,
    scenario_id: String,
    fixture_class: String,
    proof_scope: String,
    components: ContinuityComponents,
    semantic_fixtures: Vec<SemanticFixture>,
    mixed_room: MixedRoomExpected,
}

#[derive(Debug, Deserialize)]
struct ContinuityComponents {
    continuity_capsule: String,
    continuity_service: String,
    mnemos_profile: String,
}

#[derive(Debug, Deserialize)]
struct SemanticFixture {
    binding: String,
    context_status: String,
    normal_final_publication: String,
    cancelled_turn: String,
    published_final_count: usize,
    cancelled_final_count: usize,
}

#[derive(Debug, Deserialize)]
struct MixedRoomExpected {
    context_status: String,
    correctly_attributed_final_count: usize,
    cancelled_final_count: usize,
}

fn absent_fixture() -> ContinuityAbsentFixture {
    serde_json::from_str(include_str!(
        "../../../tests/luca-conformance/f10/continuity_absent.json"
    ))
    .expect("F10 fixture must be valid JSON")
}

fn assert_all_continuity_absent(fixture: &ContinuityAbsentFixture) {
    assert_eq!(fixture.schema, "luca.f10.continuity-absent.v2");
    assert_eq!(fixture.scenario_id, "all-continuity-components-absent");
    assert_eq!(fixture.fixture_class, "generated_synthetic");
    assert_eq!(
        fixture.proof_scope,
        "synthetic_bindings_not_native_runtime_proof"
    );
    assert_eq!(fixture.components.continuity_capsule, "absent");
    assert_eq!(fixture.components.continuity_service, "absent");
    assert_eq!(fixture.components.mnemos_profile, "absent");
    let bindings = fixture
        .semantic_fixtures
        .iter()
        .map(|semantic| semantic.binding.as_str())
        .collect::<BTreeSet<_>>();
    assert_eq!(bindings, BTreeSet::from(["hermes", "openclaw"]));
    for semantic in &fixture.semantic_fixtures {
        assert!(matches!(semantic.binding.as_str(), "hermes" | "openclaw"));
        assert_eq!(semantic.context_status, "unavailable");
        assert_eq!(semantic.normal_final_publication, "published");
        assert_eq!(semantic.cancelled_turn, "cancelled");
        assert_eq!(semantic.published_final_count, 1);
        assert_eq!(semantic.cancelled_final_count, 0);
    }
    assert_eq!(fixture.mixed_room.context_status, "unavailable");
    assert_eq!(fixture.mixed_room.correctly_attributed_final_count, 2);
    assert_eq!(fixture.mixed_room.cancelled_final_count, 0);
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
        response_surface: ManagedResponseSurfaceV1::Timeline,
        resolved_p_tags: Vec::new(),
        exchange: None,
    }
}

fn continuity_request(binding: &str) -> ContinuityContextRequestV1 {
    serde_json::from_value(json!({
        "protocol": CONTINUITY_PROTOCOL,
        "request_id": format!("f10-{binding}-request"),
        "owner_pubkey": "1".repeat(64),
        "resident_pubkey": "3".repeat(64),
        "conversation_id": format!("f10-{binding}-conversation"),
        "binding_ref": format!("sha256:{}", "5".repeat(64)),
        "canonical_dispatch_ref": format!("sha256:{}", "6".repeat(64)),
        "provider_egress": "local",
        "deadline_unix_ms": 4_102_444_800_000u64,
        "max_packet_bytes": MAX_CONTINUITY_PACKET_BYTES,
        "history_event_ids": []
    }))
    .expect("synthetic continuity request")
}

#[tokio::test]
async fn luca_f10_each_synthetic_runtime_binding_remains_diagnostic_and_nonblocking_when_continuity_is_absent(
) {
    let fixture = absent_fixture();
    assert_all_continuity_absent(&fixture);

    let mut normal_final_count = 0;
    for semantic in &fixture.semantic_fixtures {
        let continuity_request = continuity_request(&semantic.binding);
        let provider = ScriptedContinuityProvider::new([ScriptedContinuityResponse::Error]);
        let context = resolve_continuity_fail_soft(&provider, &continuity_request).await;
        assert_eq!(
            context.layers[0].status,
            ContinuityLayerStatusV1::Unavailable
        );

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
        normal_final_count += 1;
    }
    assert_eq!(
        normal_final_count,
        fixture
            .semantic_fixtures
            .iter()
            .map(|semantic| semantic.published_final_count)
            .sum::<usize>()
    );
}

#[test]
fn luca_f10_cancel_remains_terminal_before_publication_when_continuity_is_absent() {
    let fixture = absent_fixture();
    assert_all_continuity_absent(&fixture);

    let mut cancelled_turn_count = 0;
    for semantic in &fixture.semantic_fixtures {
        let mut chunks = FinalChunkAccumulator::default();
        chunks
            .push_agent_message_chunk("synthetic partial")
            .expect("bounded provisional chunk");
        assert_eq!(
            chunks.finish(true),
            Err(FinalPublicationError::Cancelled),
            "continuity absence must not weaken cancellation"
        );
        cancelled_turn_count += 1;
        assert_eq!(semantic.cancelled_turn, "cancelled");
    }
    assert_eq!(cancelled_turn_count, fixture.semantic_fixtures.len());
    assert_eq!(
        fixture
            .semantic_fixtures
            .iter()
            .map(|semantic| semantic.cancelled_final_count)
            .sum::<usize>(),
        0
    );
}
