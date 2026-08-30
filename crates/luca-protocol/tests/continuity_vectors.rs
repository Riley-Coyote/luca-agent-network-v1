use luca_protocol::{
    canonicalize, parse_strict_json, BrainGrantV1, CognitionScheduleV1, ContinuityContextRequestV1,
    ContinuityContextResultV1, ContinuityJobV1, ContinuityLayerStatusV1, ContinuityMutationV1,
    ContinuityNamespaceV1, ContinuityPacketV1, ContinuityPromptPayloadV1, ContinuityRecordV1,
    ContinuityScopeV1, ContinuityWakePacketV1, ImportCommitReceiptV1, ImportDiscoveryReportV1,
    ImportPlanV1, LucaBackupManifestV1, PortableContinuityCapsuleV1, ProactiveMessageCandidateV1,
    CONTINUITY_PROMPT_PROTOCOL_V1, CONTINUITY_WAKE_COMPILER_V1, CONTINUITY_WAKE_PROTOCOL_V1,
    MAX_CONTINUITY_PACKET_BYTES, MAX_CONTINUITY_WAKE_ITEM_BYTES,
};
use serde::de::DeserializeOwned;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};

fn vector() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/luca-conformance/continuity/v1.json");
    parse_strict_json(&fs::read(path).expect("read continuity vector"), 131_072)
        .expect("strict continuity vector")
}

fn assert_rejects_wrong_protocol_and_unknown<T: DeserializeOwned>(value: &Value) {
    let mut wrong_protocol = value.clone();
    wrong_protocol["protocol"] = Value::String("luca.continuity.v2".into());
    assert!(serde_json::from_value::<T>(wrong_protocol).is_err());
    let mut unknown = value.clone();
    unknown["unknown_field"] = Value::Bool(true);
    assert!(serde_json::from_value::<T>(unknown).is_err());
}

#[test]
fn golden_vectors_deserialize_all_sixteen_named_interfaces() {
    let root = vector();
    let contracts = &root["contracts"];
    macro_rules! valid {
        ($name:literal, $ty:ty) => {
            serde_json::from_value::<$ty>(contracts[$name].clone())
                .unwrap_or_else(|error| panic!("{}: {error}", $name));
        };
    }
    valid!("namespace", ContinuityNamespaceV1);
    valid!("scope", ContinuityScopeV1);
    valid!("record", ContinuityRecordV1);
    valid!("context_request", ContinuityContextRequestV1);
    valid!("context_result", ContinuityContextResultV1);
    valid!("packet", ContinuityPacketV1);
    valid!("mutation", ContinuityMutationV1);
    valid!("job", ContinuityJobV1);
    valid!("grant", BrainGrantV1);
    valid!("import_discovery", ImportDiscoveryReportV1);
    valid!("import_plan", ImportPlanV1);
    valid!("import_receipt", ImportCommitReceiptV1);
    valid!("schedule", CognitionScheduleV1);
    valid!("candidate", ProactiveMessageCandidateV1);
    valid!("capsule", PortableContinuityCapsuleV1);
    valid!("backup", LucaBackupManifestV1);
}

#[test]
fn all_contracts_reject_wrong_protocol_and_unknown_fields_during_deserialize() {
    let root = vector();
    let c = &root["contracts"];
    assert_rejects_wrong_protocol_and_unknown::<ContinuityNamespaceV1>(&c["namespace"]);
    assert_rejects_wrong_protocol_and_unknown::<ContinuityScopeV1>(&c["scope"]);
    assert_rejects_wrong_protocol_and_unknown::<ContinuityRecordV1>(&c["record"]);
    assert_rejects_wrong_protocol_and_unknown::<ContinuityContextRequestV1>(&c["context_request"]);
    assert_rejects_wrong_protocol_and_unknown::<ContinuityContextResultV1>(&c["context_result"]);
    assert_rejects_wrong_protocol_and_unknown::<ContinuityPacketV1>(&c["packet"]);
    assert_rejects_wrong_protocol_and_unknown::<ContinuityMutationV1>(&c["mutation"]);
    assert_rejects_wrong_protocol_and_unknown::<ContinuityJobV1>(&c["job"]);
    assert_rejects_wrong_protocol_and_unknown::<BrainGrantV1>(&c["grant"]);
    assert_rejects_wrong_protocol_and_unknown::<ImportDiscoveryReportV1>(&c["import_discovery"]);
    assert_rejects_wrong_protocol_and_unknown::<ImportPlanV1>(&c["import_plan"]);
    assert_rejects_wrong_protocol_and_unknown::<ImportCommitReceiptV1>(&c["import_receipt"]);
    assert_rejects_wrong_protocol_and_unknown::<CognitionScheduleV1>(&c["schedule"]);
    assert_rejects_wrong_protocol_and_unknown::<ProactiveMessageCandidateV1>(&c["candidate"]);
    assert_rejects_wrong_protocol_and_unknown::<PortableContinuityCapsuleV1>(&c["capsule"]);
    assert_rejects_wrong_protocol_and_unknown::<LucaBackupManifestV1>(&c["backup"]);
}

#[test]
fn canonical_packet_bytes_and_hash_match_checked_vector() {
    let root = vector();
    let packet: ContinuityPacketV1 =
        serde_json::from_value(root["contracts"]["packet"].clone()).unwrap();
    let canonical = canonicalize(&packet).unwrap();
    assert_eq!(
        canonical,
        root["canonical_packet_json"].as_str().unwrap().as_bytes()
    );
    assert_eq!(
        hex::encode(Sha256::digest(&canonical)),
        root["canonical_packet_sha256"].as_str().unwrap()
    );
}

#[test]
fn packet_limit_counts_total_canonical_bytes_and_multibyte_content() {
    let root = vector();
    let template: ContinuityPacketV1 =
        serde_json::from_value(root["contracts"]["packet"].clone()).unwrap();
    let mut ascii = template.clone();
    ascii.content.clear();
    let overhead = canonicalize(&ascii).unwrap().len();
    ascii.content = "a".repeat(MAX_CONTINUITY_PACKET_BYTES - overhead);
    assert_eq!(
        canonicalize(&ascii).unwrap().len(),
        MAX_CONTINUITY_PACKET_BYTES
    );
    ascii.validate().unwrap();
    ascii.content.push('a');
    assert!(ascii.validate().is_err());

    let mut multibyte = template;
    multibyte.content.clear();
    let available = MAX_CONTINUITY_PACKET_BYTES - canonicalize(&multibyte).unwrap().len();
    multibyte.content = "é".repeat(available / 2);
    if available % 2 == 1 {
        multibyte.content.push('a');
    }
    assert_eq!(
        canonicalize(&multibyte).unwrap().len(),
        MAX_CONTINUITY_PACKET_BYTES
    );
    multibyte.validate().unwrap();
    multibyte.content.push('é');
    assert!(multibyte.validate().is_err());
}

#[test]
fn closed_status_and_cross_field_invariants_fail_during_deserialize() {
    let root = vector();
    let c = &root["contracts"];
    for status in root["all_layer_statuses"].as_array().unwrap() {
        serde_json::from_value::<ContinuityLayerStatusV1>(status.clone()).unwrap();
    }
    assert!(
        serde_json::from_value::<ContinuityLayerStatusV1>(Value::String("error".into())).is_err()
    );

    let mut record = c["record"].clone();
    record["nonce_b64"] = Value::String("AQ==".into());
    assert!(serde_json::from_value::<ContinuityRecordV1>(record).is_err());
    let mut record = c["record"].clone();
    record["ciphertext_b64"] = Value::String(String::new());
    assert!(serde_json::from_value::<ContinuityRecordV1>(record).is_err());

    let mut result = c["context_result"].clone();
    result.as_object_mut().unwrap().remove("packet");
    assert!(serde_json::from_value::<ContinuityContextResultV1>(result).is_err());
    let mut result = c["context_result"].clone();
    result["layers"][0]["status"] = Value::String("empty".into());
    result["layers"][0]
        .as_object_mut()
        .unwrap()
        .remove("provenance_ref");
    assert!(serde_json::from_value::<ContinuityContextResultV1>(result).is_err());

    let mut grant = c["grant"].clone();
    grant["provider_egress"] = Value::String("unknown".into());
    assert!(serde_json::from_value::<BrainGrantV1>(grant).is_err());
    let mut grant = c["grant"].clone();
    grant["state"] = Value::String("revoked".into());
    assert!(serde_json::from_value::<BrainGrantV1>(grant).is_err());

    let mut receipt = c["import_receipt"].clone();
    receipt["state"] = Value::String("failed".into());
    assert!(serde_json::from_value::<ImportCommitReceiptV1>(receipt).is_err());

    let mut candidate = c["candidate"].clone();
    candidate["privacy_passed"] = Value::Bool(false);
    assert!(serde_json::from_value::<ProactiveMessageCandidateV1>(candidate).is_err());
    let mut candidate = c["candidate"].clone();
    candidate
        .as_object_mut()
        .unwrap()
        .remove("publication_receipt_id");
    assert!(serde_json::from_value::<ProactiveMessageCandidateV1>(candidate).is_err());
}

#[test]
fn continuity_schema_is_strict_body_safe_and_names_all_interfaces() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../schemas/luca/continuity/v1.schema.json");
    let schema = parse_strict_json(&fs::read(path).unwrap(), 131_072).unwrap();
    assert_eq!(
        schema["$schema"],
        "https://json-schema.org/draft/2020-12/schema"
    );
    let text = serde_json::to_string(&schema).unwrap();
    for forbidden in ["\"tags\"", "\"credential\"", "\"secret_key\""] {
        assert!(!text.contains(forbidden), "forbidden metadata: {forbidden}");
    }
    for definition in [
        "namespace",
        "scope",
        "record",
        "context_request",
        "context_result",
        "packet",
        "mutation",
        "job",
        "grant",
        "import_discovery",
        "import_plan",
        "import_receipt",
        "schedule",
        "candidate",
        "capsule",
        "backup",
    ] {
        assert!(
            schema["$defs"].get(definition).is_some(),
            "missing {definition}"
        );
    }
}

fn wake_payload_vector() -> Value {
    serde_json::json!({
        "protocol": CONTINUITY_PROMPT_PROTOCOL_V1,
        "wake": {
            "protocol": CONTINUITY_WAKE_PROTOCOL_V1,
            "compiler_version": CONTINUITY_WAKE_COMPILER_V1,
            "owner_pubkey": "11".repeat(32),
            "resident_pubkey": "22".repeat(32),
            "relationship_scope_ref": format!("sha256:{}", "33".repeat(32)),
            "request_id": "wake-vector-1",
            "identity_orientation": [{
                "item_id": "identity-1",
                "record_kind": "identity",
                "author_kind": "resident",
                "body": "I remain Orin.",
                "source_event_ids": ["44".repeat(32)],
                "provenance_refs": [format!("sha256:{}", "55".repeat(32))]
            }],
            "relationship_orientation": [],
            "current_handoff": {
                "active_record_id": "handoff-1",
                "revision": 2,
                "handoff": {
                    "summary": "Naming remains open.",
                    "unresolved_threads": ["Choose Hearthline or Stillwater"],
                    "commitments": [],
                    "explicit_preferences": [],
                    "source_event_ids": ["66".repeat(32)],
                    "updated_at": "2026-08-29T00:00:00Z"
                },
                "provenance_refs": [format!("sha256:{}", "77".repeat(32))]
            },
            "relevant_continuity_items": [],
            "ambient_continuity_items": [],
            "recent_corrections": [],
            "open_commitments": [],
            "reflection_prompts": [],
            "layer_statuses": [
                { "layer": "capsule", "status": "empty" },
                {
                    "layer": "handoff",
                    "status": "ready",
                    "provenance_ref": format!("sha256:{}", "88".repeat(32))
                },
                { "layer": "hypomnema", "status": "empty" },
                { "layer": "associative_recall", "status": "empty" },
                { "layer": "owner_brain", "status": "empty" }
            ],
            "body_free_receipt_ref": format!("sha256:{}", "99".repeat(32))
        },
        "owner_brain_references": [{
            "item_id": "brain-1",
            "body": "The target is macOS.",
            "source_event_ids": [],
            "provenance_refs": [format!("sha256:{}", "aa".repeat(32))]
        }]
    })
}

#[test]
fn wake_prompt_vector_round_trips_canonically_and_keeps_brain_separate() {
    let vector = wake_payload_vector();
    let payload: ContinuityPromptPayloadV1 = serde_json::from_value(vector.clone()).unwrap();
    payload.validate().unwrap();
    let canonical = canonicalize(&payload).unwrap();
    let reparsed: ContinuityPromptPayloadV1 = serde_json::from_slice(&canonical).unwrap();
    assert_eq!(canonicalize(&reparsed).unwrap(), canonical);
    let wake = reparsed.wake.as_ref().unwrap();
    assert_eq!(
        wake.identity_orientation[0].record_kind.as_str(),
        "identity"
    );
    assert_eq!(
        reparsed.owner_brain_references[0].item_id.as_str(),
        "brain-1"
    );
    assert!(!wake
        .identity_orientation
        .iter()
        .any(|item| item.item_id.as_str() == "brain-1"));
}

#[test]
fn wake_contract_rejects_unknown_fields_kinds_authors_and_partial_utf8_overflow() {
    let vector = wake_payload_vector();
    let mut unknown = vector.clone();
    unknown["wake"]["unknown"] = Value::Bool(true);
    assert!(serde_json::from_value::<ContinuityPromptPayloadV1>(unknown).is_err());

    let mut wrong_protocol = vector.clone();
    wrong_protocol["wake"]["protocol"] = Value::String("luca.continuity.wake.v2".into());
    assert!(
        serde_json::from_value::<ContinuityWakePacketV1>(wrong_protocol["wake"].clone()).is_err()
    );

    let mut unknown_kind = vector.clone();
    unknown_kind["wake"]["identity_orientation"][0]["record_kind"] =
        Value::String("identity-ish".into());
    assert!(serde_json::from_value::<ContinuityPromptPayloadV1>(unknown_kind).is_err());

    let mut unknown_author = vector.clone();
    unknown_author["wake"]["identity_orientation"][0]["author_kind"] =
        Value::String("assistant".into());
    assert!(serde_json::from_value::<ContinuityPromptPayloadV1>(unknown_author).is_err());

    let mut oversized = vector;
    oversized["wake"]["identity_orientation"][0]["body"] =
        Value::String("🧠".repeat(MAX_CONTINUITY_WAKE_ITEM_BYTES / 4 + 1));
    assert!(serde_json::from_value::<ContinuityPromptPayloadV1>(oversized).is_err());
}

#[test]
fn wake_contract_rejects_cross_category_items_and_reordered_layers() {
    let vector = wake_payload_vector();

    let mut wrong_category = vector.clone();
    wrong_category["wake"]["identity_orientation"][0]["record_kind"] =
        Value::String("memory-note".into());
    assert!(serde_json::from_value::<ContinuityPromptPayloadV1>(wrong_category).is_err());

    let mut brain_smuggling = vector.clone();
    brain_smuggling["wake"]["identity_orientation"][0]["record_kind"] =
        Value::String("owner-brain-source".into());
    assert!(serde_json::from_value::<ContinuityPromptPayloadV1>(brain_smuggling).is_err());

    let mut reordered = vector;
    reordered["wake"]["layer_statuses"]
        .as_array_mut()
        .unwrap()
        .swap(0, 1);
    assert!(serde_json::from_value::<ContinuityPromptPayloadV1>(reordered).is_err());
}

#[test]
fn wake_debug_surfaces_are_body_redacted() {
    let payload: ContinuityPromptPayloadV1 = serde_json::from_value(wake_payload_vector()).unwrap();
    let debug = format!("{payload:?}");
    assert!(!debug.contains("I remain Orin"));
    assert!(!debug.contains("The target is macOS"));
    assert!(debug.contains("[REDACTED]"));
}
