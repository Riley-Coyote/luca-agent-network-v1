use luca_continuity::{
    build_body_free_run_record, build_generation_packet, build_reader_packet, validate_assay_v1,
    AssayConditionV1, AssayFaultModeV1, AssayGoldenLifeV1, AssayHardGateResultV1,
    AssayLayerStatusV1, AssayManifestV1, AssayPrivateRunV1, AssayRunMetadataV1,
    ASSAY_PRIVATE_RUN_SCHEMA_V1,
};
use std::{collections::BTreeMap, fs, path::PathBuf};

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("assay/v1")
        .join(name)
}

fn load() -> (AssayManifestV1, AssayGoldenLifeV1) {
    let manifest = serde_json::from_slice(
        &fs::read(fixture_path("manifest.json")).expect("read assay manifest"),
    )
    .expect("parse assay manifest");
    let fixture = serde_json::from_slice(
        &fs::read(fixture_path("golden-life.json")).expect("read golden life"),
    )
    .expect("parse golden life");
    (manifest, fixture)
}

#[test]
fn frozen_v1_panel_validates_with_nine_core_and_four_extensions() {
    let (manifest, fixture) = load();
    validate_assay_v1(&manifest, &fixture).expect("valid frozen assay");
    assert_eq!(
        manifest
            .scenarios
            .iter()
            .filter(|scenario| scenario.scenario_id.starts_with('C'))
            .count(),
        9
    );
    assert_eq!(
        manifest
            .scenarios
            .iter()
            .filter(|scenario| scenario.scenario_id.starts_with('E'))
            .count(),
        4
    );
}

#[test]
fn matched_dossier_and_wake_use_exactly_the_same_selected_events() {
    let (manifest, fixture) = load();
    let dossier = build_generation_packet(
        &manifest,
        &fixture,
        "C02",
        AssayConditionV1::Dossier,
        "run-dossier",
        None,
    )
    .expect("dossier packet");
    let wake = build_generation_packet(
        &manifest,
        &fixture,
        "C02",
        AssayConditionV1::Wake,
        "run-wake",
        None,
    )
    .expect("wake packet");
    assert_eq!(dossier.source_event_refs, wake.source_event_refs);
    assert_eq!(
        dossier
            .continuity_material
            .iter()
            .map(|item| &item.item_id)
            .collect::<Vec<_>>(),
        wake.continuity_material
            .iter()
            .map(|item| &item.item_id)
            .collect::<Vec<_>>()
    );
    assert!(dossier
        .continuity_material
        .iter()
        .all(|item| !item.resident_voice));
    assert!(wake
        .continuity_material
        .iter()
        .all(|item| item.resident_voice));
    assert_ne!(
        dossier.continuity_material[0].content,
        wake.continuity_material[0].content
    );
    assert!(dossier
        .provider_context
        .as_deref()
        .is_some_and(|context| context.starts_with("ASSAY DOSSIER V1")));
    let wake_context = wake.provider_context.as_deref().expect("wake wire");
    let wake_wire = serde_json::from_str::<serde_json::Value>(wake_context)
        .expect("current resolver emits canonical JSON");
    assert_eq!(wake_wire["protocol"], "luca.continuity.v1");
    assert!(wake_wire["packet"]["content"]
        .as_str()
        .is_some_and(|content| content.contains("LUCA CONTINUITY REFERENCE V1")));
}

#[test]
fn no_continuity_has_no_lived_material_and_fault_requires_an_enabled_mode() {
    let (manifest, fixture) = load();
    let none = build_generation_packet(
        &manifest,
        &fixture,
        "C01",
        AssayConditionV1::NoContinuity,
        "run-none",
        None,
    )
    .expect("no-continuity packet");
    assert!(none.continuity_material.is_empty());
    assert!(none.provider_context.is_none());
    assert!(none.source_event_refs.is_empty());
    assert!(none
        .layer_statuses
        .values()
        .all(|status| *status == AssayLayerStatusV1::Empty));

    assert!(build_generation_packet(
        &manifest,
        &fixture,
        "C01",
        AssayConditionV1::Faulted,
        "bad-fault",
        Some(AssayFaultModeV1::Timeout),
    )
    .is_err());
    let faulted = build_generation_packet(
        &manifest,
        &fixture,
        "C08",
        AssayConditionV1::Faulted,
        "run-fault",
        Some(AssayFaultModeV1::Timeout),
    )
    .expect("enabled fault packet");
    assert!(faulted.continuity_material.is_empty());
    assert!(faulted.provider_context.is_none());
    assert!(faulted
        .layer_statuses
        .values()
        .all(|status| *status == AssayLayerStatusV1::Timeout));
}

#[test]
fn forgetting_and_false_premise_canaries_never_enter_condition_material() {
    let (manifest, fixture) = load();
    for condition in [AssayConditionV1::Dossier, AssayConditionV1::Wake] {
        let forgotten =
            build_generation_packet(&manifest, &fixture, "C04", condition, "run-forget", None)
                .expect("forget packet");
        let encoded = serde_json::to_string(&forgotten).expect("encode forget packet");
        assert!(!encoded.contains("copper umbrella"));
        assert!(!encoded.contains("glass orchard"));

        let false_premise = build_generation_packet(
            &manifest,
            &fixture,
            "C09",
            condition,
            "run-false-premise",
            None,
        )
        .expect("false-premise packet");
        let continuity = serde_json::to_string(&false_premise.continuity_material)
            .expect("encode false-premise continuity");
        assert!(!continuity.to_lowercase().contains("paris"));
        assert!(!continuity.to_lowercase().contains("blue cafe"));
        assert!(false_premise.opening_prompt.contains("Paris"));
    }
}

#[test]
fn reader_packet_is_blind_to_condition_and_compiler_material() {
    let (manifest, fixture) = load();
    let generation = build_generation_packet(
        &manifest,
        &fixture,
        "C01",
        AssayConditionV1::Wake,
        "opaque-run-17",
        None,
    )
    .expect("wake packet");
    let private_run = AssayPrivateRunV1 {
        schema: ASSAY_PRIVATE_RUN_SCHEMA_V1.to_owned(),
        generation,
        response_event_id: "response-event-17".to_owned(),
        response: "Let's return to the naming question: I think Stillwater is the honest choice."
            .to_owned(),
    };
    let reader = build_reader_packet(&manifest, &private_run).expect("reader packet");
    let encoded = serde_json::to_value(reader).expect("encode reader packet");
    assert!(encoded.get("condition").is_none());
    assert!(encoded.get("compiler_policy_version").is_none());
    assert!(encoded.get("continuity_material").is_none());
    assert_eq!(encoded["scenario_id"], "C01");
}

#[test]
fn public_run_record_hashes_private_identity_process_and_response_values() {
    let (manifest, fixture) = load();
    let generation = build_generation_packet(
        &manifest,
        &fixture,
        "C09",
        AssayConditionV1::Wake,
        "opaque-run-22",
        None,
    )
    .expect("wake packet");
    let private_run = AssayPrivateRunV1 {
        schema: ASSAY_PRIVATE_RUN_SCHEMA_V1.to_owned(),
        generation,
        response_event_id: "response-event-22".to_owned(),
        response: "I don't have a basis for remembering that trip, but I'd like to hear the story."
            .to_owned(),
    };
    let metadata = AssayRunMetadataV1 {
        app_commit: "abc123".to_owned(),
        app_bundle_hash: None,
        owner_pubkey: "owner-secret-pubkey".to_owned(),
        resident_pubkey: "resident-secret-pubkey".to_owned(),
        runtime_family: "fixture".to_owned(),
        model_binding_fingerprint: "fixture-model-v1".to_owned(),
        process_ids: vec!["9911".to_owned(), "9912".to_owned()],
        session_epoch: 2,
        wake_receipt_id: Some("sha256:wake".to_owned()),
        packet_size: 512,
        layer_statuses: BTreeMap::from([("handoff".to_owned(), AssayLayerStatusV1::Ready)]),
        hard_gate_results: vec![AssayHardGateResultV1 {
            gate_id: "false_premise".to_owned(),
            passed: true,
            evidence_ref: Some("sha256:evidence".to_owned()),
        }],
        native_state_before_hashes: BTreeMap::new(),
        native_state_after_hashes: BTreeMap::new(),
        artifact_refs: vec!["private:run:22".to_owned()],
        created_at: "2026-08-29T12:00:00Z".to_owned(),
    };
    let record = build_body_free_run_record(&private_run, metadata).expect("body-free record");
    let encoded = serde_json::to_string(&record).expect("encode body-free record");
    assert!(!encoded.contains("owner-secret-pubkey"));
    assert!(!encoded.contains("resident-secret-pubkey"));
    assert!(!encoded.contains("9911"));
    assert!(!encoded.contains("response-event-22"));
    assert!(!encoded.contains("remembering that trip"));
    assert!(record.owner_pubkey_hash.starts_with("sha256:"));
    assert!(record.response_event_id_hash.starts_with("sha256:"));

    let schema = serde_json::from_slice::<serde_json::Value>(
        &fs::read(fixture_path("run-record.schema.json")).expect("read run-record schema"),
    )
    .expect("parse run-record schema");
    let value = serde_json::to_value(record).expect("encode run record value");
    let object = value.as_object().expect("run record object");
    let properties = schema["properties"].as_object().expect("schema properties");
    for key in object.keys() {
        assert!(properties.contains_key(key), "schema is missing {key}");
    }
    for required in schema["required"].as_array().expect("required fields") {
        let required = required.as_str().expect("required field name");
        assert!(
            object.contains_key(required),
            "record is missing {required}"
        );
    }
}

#[test]
fn unknown_manifest_fields_fail_closed() {
    let bytes = fs::read(fixture_path("manifest.json")).expect("read manifest");
    let mut value = serde_json::from_slice::<serde_json::Value>(&bytes).expect("parse value");
    value["unexpected_authority"] = serde_json::Value::Bool(true);
    assert!(serde_json::from_value::<AssayManifestV1>(value).is_err());
}
