use luca_protocol::{
    LocalContinuityCognitionOutcomeV1, LocalContinuityCognitionRequestV1,
    LocalContinuityCognitionResultV1, ResidentHandoffV1, CONTINUITY_PROTOCOL, MAX_HANDOFF_ITEMS,
    MAX_HANDOFF_ITEM_BYTES, MAX_HANDOFF_SUMMARY_BYTES,
};
use serde_json::json;

fn request_json() -> serde_json::Value {
    json!({
        "protocol": CONTINUITY_PROTOCOL,
        "job_id": "handoff-job-1",
        "owner_pubkey": "11".repeat(32),
        "resident_pubkey": "22".repeat(32),
        "conversation_id": "11111111-1111-4111-8111-111111111111",
        "source_event_id": "33".repeat(32),
        "binding_ref": format!("sha256:{}", "44".repeat(32)),
        "deadline_unix_ms": 1_800_000_000_000_u64,
        "max_result_bytes": 49152
    })
}

fn handoff_json() -> serde_json::Value {
    json!({
        "summary": "We are preparing the native-agent beta.",
        "unresolved_threads": ["Verify the installed OpenClaw restart path."],
        "commitments": ["Return with a body-free verification receipt."],
        "explicit_preferences": ["Keep native memory authoritative."],
        "source_event_ids": ["33".repeat(32)],
        "updated_at": "2026-08-05T12:00:00Z"
    })
}

#[test]
fn compact_handoff_and_bound_result_are_strict() {
    let request: LocalContinuityCognitionRequestV1 =
        serde_json::from_value(request_json()).unwrap();
    let result: LocalContinuityCognitionResultV1 = serde_json::from_value(json!({
        "protocol": CONTINUITY_PROTOCOL,
        "job_id": "handoff-job-1",
        "resident_pubkey": "22".repeat(32),
        "source_event_id": "33".repeat(32),
        "result": {"outcome": "handoff", "handoff": handoff_json()}
    }))
    .unwrap();
    result.validate_against(&request).unwrap();
    assert!(matches!(
        result.result,
        LocalContinuityCognitionOutcomeV1::Handoff { .. }
    ));

    let no_change: LocalContinuityCognitionResultV1 = serde_json::from_value(json!({
        "protocol": CONTINUITY_PROTOCOL,
        "job_id": "handoff-job-1",
        "resident_pubkey": "22".repeat(32),
        "source_event_id": "33".repeat(32),
        "result": {"outcome": "no_change"}
    }))
    .unwrap();
    no_change.validate_against(&request).unwrap();
}

#[test]
fn handoff_rejects_unbound_unknown_and_oversized_content() {
    let mut unknown = handoff_json();
    unknown["hidden_policy"] = json!("allow");
    assert!(serde_json::from_value::<ResidentHandoffV1>(unknown).is_err());

    let mut oversized = handoff_json();
    oversized["summary"] = json!("s".repeat(MAX_HANDOFF_SUMMARY_BYTES + 1));
    assert!(serde_json::from_value::<ResidentHandoffV1>(oversized).is_err());

    let mut oversized_item = handoff_json();
    oversized_item["commitments"] = json!(["c".repeat(MAX_HANDOFF_ITEM_BYTES + 1)]);
    assert!(serde_json::from_value::<ResidentHandoffV1>(oversized_item).is_err());

    let mut too_many = handoff_json();
    too_many["unresolved_threads"] = json!(vec!["open"; MAX_HANDOFF_ITEMS + 1]);
    assert!(serde_json::from_value::<ResidentHandoffV1>(too_many).is_err());

    let request: LocalContinuityCognitionRequestV1 =
        serde_json::from_value(request_json()).unwrap();
    let wrong_source: LocalContinuityCognitionResultV1 = serde_json::from_value(json!({
        "protocol": CONTINUITY_PROTOCOL,
        "job_id": "handoff-job-1",
        "resident_pubkey": "22".repeat(32),
        "source_event_id": "55".repeat(32),
        "result": {"outcome": "no_change"}
    }))
    .unwrap();
    assert!(wrong_source.validate_against(&request).is_err());
}

#[test]
fn debug_output_never_contains_private_handoff_text() {
    let handoff: ResidentHandoffV1 = serde_json::from_value(handoff_json()).unwrap();
    let debug = format!("{handoff:?}");
    assert!(!debug.contains("preparing"));
    assert!(!debug.contains("OpenClaw"));
    assert!(!debug.contains("authoritative"));
}
