use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use luca_continuity::{
    derive_revision_idempotency_key, encrypt_record, encrypted_record_reference,
    synthetic_fixture_index, ContinuityContextResolver, ContinuityError, ContinuityLayerMaterial,
    ContinuityReadSnapshot, NamespaceScope, PurgeExecutionStatusV1, RecordMetadata, RevisionActor,
    RevisionLedger, RevisionLifecycle, RevisionOperation, RevisionRequest,
};
use luca_protocol::{
    CanonicalTimestamp, ContinuityContextRequestV1, ContinuityLayerStatusV1,
    ContinuityNamespaceKindV1, ContinuityNamespaceV1, ContinuityRecordV1, ContinuityScopeV1, Hex64,
    OpaqueId, ProviderEgressV1, SafeU53, Sha256Ref, CONTINUITY_PROTOCOL,
};
use serde_json::Value;

const KEY: [u8; 32] = [17; 32];
const FIXTURE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/luca-conformance/continuity/spine-v1.json"
));

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("spine conformance fixture must be valid JSON")
}

fn hex(digit: char) -> Hex64 {
    Hex64::parse(digit.to_string().repeat(64)).expect("fixed hex")
}

fn sha(digit: char) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", digit.to_string().repeat(64))).expect("fixed sha")
}

fn id(value: &str) -> OpaqueId {
    OpaqueId::parse(value).expect("fixed opaque id")
}

fn namespace() -> ContinuityNamespaceV1 {
    ContinuityNamespaceV1 {
        protocol: CONTINUITY_PROTOCOL.into(),
        owner_pubkey: hex('1'),
        kind: ContinuityNamespaceKindV1::ResidentPrivate,
        resident_pubkey: Some(hex('2')),
        namespace_ref: sha('3'),
        key_version: SafeU53::new(1).expect("fixed key version"),
    }
}

fn scope(namespace: &ContinuityNamespaceV1) -> ContinuityScopeV1 {
    ContinuityScopeV1 {
        protocol: CONTINUITY_PROTOCOL.into(),
        namespace_ref: namespace.namespace_ref.clone(),
        scope_ref: sha('4'),
        source_id: Some(id("source-spine")),
        project_id: None,
        room_id: None,
        conversation_id: Some(id("conversation-spine")),
    }
}

fn record(
    record_id: &str,
    revision: u64,
    predecessor_record_id: Option<OpaqueId>,
    author_kind: &str,
    body: &str,
) -> ContinuityRecordV1 {
    let namespace = namespace();
    encrypt_record(
        RecordMetadata {
            protocol: CONTINUITY_PROTOCOL.into(),
            record_id: id(record_id),
            namespace: namespace.clone(),
            scope: scope(&namespace),
            record_type: id("handoff"),
            revision: SafeU53::new(revision).expect("fixed revision"),
            predecessor_record_id,
            created_at: CanonicalTimestamp::parse("2026-08-29T00:00:00Z").expect("fixed timestamp"),
            author_kind: id(author_kind),
            provenance_refs: vec![sha('5')],
            key_version: SafeU53::new(1).expect("fixed key version"),
        },
        &KEY,
        body.as_bytes(),
    )
    .expect("fixed record")
}

fn request(
    operation: RevisionOperation,
    root: &str,
    expected_head: Option<&str>,
    actor: RevisionActor,
    successor: Option<ContinuityRecordV1>,
) -> RevisionRequest {
    let successor_ciphertext_ref = successor
        .as_ref()
        .map(encrypted_record_reference)
        .transpose()
        .expect("record reference");
    let mut request = RevisionRequest {
        idempotency_key: sha('a'),
        operation,
        lineage_root_id: id(root),
        expected_head_record_id: expected_head.map(id),
        actor,
        signed_source_event_refs: vec![sha('6')],
        request_ref: sha('7'),
        successor,
        successor_ciphertext_ref,
        rollback_source_record_id: None,
        derived_artifact_refs: Vec::new(),
    };
    let (binding_namespace, binding_scope, record_type, key_version) = request
        .successor
        .as_ref()
        .map(|record| {
            (
                record.namespace.clone(),
                record.scope.clone(),
                record.record_type.clone(),
                record.key_version,
            )
        })
        .unwrap_or_else(|| {
            let namespace = namespace();
            (
                namespace.clone(),
                scope(&namespace),
                id("handoff"),
                SafeU53::new(1).expect("fixed key version"),
            )
        });
    request.idempotency_key = derive_revision_idempotency_key(
        &binding_namespace,
        &binding_scope,
        &record_type,
        key_version,
        &request,
    )
    .expect("idempotency key");
    request
}

fn context_request(deadline_unix_ms: u64) -> ContinuityContextRequestV1 {
    ContinuityContextRequestV1 {
        protocol: CONTINUITY_PROTOCOL.into(),
        request_id: id("spine-fail-open"),
        owner_pubkey: hex('1'),
        resident_pubkey: hex('2'),
        conversation_id: id("conversation-spine"),
        binding_ref: sha('3'),
        canonical_dispatch_ref: sha('4'),
        provider_egress: ProviderEgressV1::Local,
        deadline_unix_ms: SafeU53::new(deadline_unix_ms).expect("fixed deadline"),
        max_packet_bytes: SafeU53::new(49_152).expect("fixed packet budget"),
        history_event_ids: vec![hex('5')],
    }
}

fn status_layer(status: ContinuityLayerStatusV1) -> ContinuityLayerMaterial {
    ContinuityLayerMaterial::status(status, None).expect("status-only layer")
}

fn status_snapshot(status: ContinuityLayerStatusV1) -> ContinuityReadSnapshot {
    ContinuityReadSnapshot {
        capsule: status_layer(status),
        handoff: status_layer(status),
        hypomnema: status_layer(status),
        associative_recall: status_layer(status),
        owner_brain: status_layer(status),
    }
}

#[test]
fn frozen_spine_fixture_matches_the_approved_contract() {
    let fixture = fixture();
    assert_eq!(fixture["prompt_protocol"], "luca.continuity.prompt.v1");
    assert_eq!(fixture["wake_protocol"], "luca.continuity.wake.v1");
    assert_eq!(fixture["compiler_version"], "wake-spine-v1");
    assert_eq!(fixture["limits"]["outer_packet_bytes"], 49_152);
    assert_eq!(fixture["limits"]["item_body_bytes"], 4_096);
    assert_eq!(fixture["limits"]["reflection_prompts"], 0);
    assert_eq!(
        fixture["capture"]["allowed_outcomes"],
        serde_json::json!(["no_change", "handoff"])
    );
    assert_eq!(
        fixture["capture"]["automatic_writable_record_kinds"],
        serde_json::json!(["handoff"])
    );
    assert_eq!(fixture["required_cases"].as_array().map(Vec::len), Some(12));
}

#[test]
fn every_frozen_fail_open_state_returns_a_body_free_result_without_a_packet() {
    let statuses = [
        ContinuityLayerStatusV1::Empty,
        ContinuityLayerStatusV1::Denied,
        ContinuityLayerStatusV1::Stale,
        ContinuityLayerStatusV1::Locked,
        ContinuityLayerStatusV1::Unavailable,
        ContinuityLayerStatusV1::Timeout,
        ContinuityLayerStatusV1::Invalid,
    ];
    for status in statuses {
        let output = ContinuityContextResolver::resolve(
            &context_request(10_000),
            status_snapshot(status),
            1,
        )
        .expect("a failed continuity layer must not fail the managed turn");
        assert!(!output.has_packet());
        assert!(output.layers().iter().all(|layer| layer.status == status));
        let debug = format!("{output:?}");
        assert!(!debug.contains("CASSIOPEIA-A-ONLY"));
        assert!(!debug.contains("ORION-B-ONLY"));
    }

    let timeout = ContinuityContextResolver::resolve(
        &context_request(10),
        status_snapshot(ContinuityLayerStatusV1::Empty),
        10,
    )
    .expect("deadline expiry is a typed fail-open result");
    assert!(!timeout.has_packet());
    assert!(timeout
        .layers()
        .iter()
        .all(|layer| layer.status == ContinuityLayerStatusV1::Timeout));
}

#[test]
fn resident_private_scope_is_exact_and_owner_brain_cannot_alias_it() {
    let index = synthetic_fixture_index().expect("synthetic isolation index");
    let resident_a = &index.all()[0].address;
    let resident_b = &index.all()[1].address;
    assert_eq!(
        index
            .read_exact(resident_a)
            .iter()
            .map(|fixture| fixture.fixture_id.as_str())
            .collect::<Vec<_>>(),
        vec!["owner-a-resident-a"]
    );
    assert_eq!(
        resident_a.require_exact(resident_b),
        Err(ContinuityError::AccessDenied)
    );

    let resident_protocol = resident_a.namespace().as_protocol();
    let owner_brain_namespace = luca_continuity::NamespaceKey::new(ContinuityNamespaceV1 {
        protocol: CONTINUITY_PROTOCOL.into(),
        owner_pubkey: resident_protocol.owner_pubkey.clone(),
        kind: ContinuityNamespaceKindV1::OwnerBrain,
        resident_pubkey: None,
        namespace_ref: resident_protocol.namespace_ref.clone(),
        key_version: resident_protocol.key_version,
    })
    .expect("owner Brain namespace");
    let brain_scope = NamespaceScope::new(owner_brain_namespace, resident_a.as_protocol().clone())
        .expect("scope remains structurally valid inside its own namespace");
    assert_eq!(
        resident_a.require_exact(&brain_scope),
        Err(ContinuityError::AccessDenied)
    );
}

#[test]
fn pinned_correction_blocks_automatic_reversal_and_forget_survives_restart() {
    let root = record(
        "handoff-root",
        0,
        None,
        "resident",
        "SUPERSEDED-RED-MUST-NOT-BE-CURRENT",
    );
    let mut ledger = RevisionLedger::default();
    let create = request(
        RevisionOperation::Create,
        "handoff-root",
        None,
        RevisionActor::Resident,
        Some(root),
    );
    ledger.apply(create).expect("create handoff lineage");

    let correction = record(
        "handoff-corrected",
        1,
        Some(id("handoff-root")),
        "owner",
        "CORRECTED-BLUE-IS-CURRENT",
    );
    let correction_request = request(
        RevisionOperation::OwnerCorrection,
        "handoff-root",
        Some("handoff-root"),
        RevisionActor::Owner,
        Some(correction),
    );
    ledger
        .apply(correction_request)
        .expect("owner correction must be admitted");

    let automatic_reversal = record(
        "handoff-automatic-reversal",
        2,
        Some(id("handoff-corrected")),
        "automatic",
        "SUPERSEDED-RED-MUST-NOT-BE-CURRENT",
    );
    let automatic_request = request(
        RevisionOperation::Revise,
        "handoff-root",
        Some("handoff-corrected"),
        RevisionActor::Automatic,
        Some(automatic_reversal),
    );
    assert_eq!(
        ledger.apply(automatic_request),
        Err(ContinuityError::PinnedOwnerCorrection)
    );
    assert_eq!(
        ledger
            .active_head(&id("handoff-root"))
            .map(|record| record.record_id.clone()),
        Some(id("handoff-corrected"))
    );

    let forget_request = request(
        RevisionOperation::Forget,
        "handoff-root",
        Some("handoff-corrected"),
        RevisionActor::Owner,
        None,
    );
    let forget_receipt = ledger
        .apply(forget_request.clone())
        .expect("Forget must be authorized");
    assert_eq!(forget_receipt.lifecycle, RevisionLifecycle::Forgotten);
    assert!(ledger.active_head(&id("handoff-root")).is_none());
    assert!(ledger.history(&id("handoff-root")).is_empty());

    ledger
        .advance_purge(&id("handoff-root"), PurgeExecutionStatusV1::InProgress)
        .expect("start purge");
    ledger
        .advance_purge(&id("handoff-root"), PurgeExecutionStatusV1::Completed)
        .expect("complete purge");
    let snapshot = ledger.export_snapshot().expect("body-free ledger snapshot");
    let encoded = serde_json::to_vec(&snapshot).expect("encode snapshot");
    assert!(!String::from_utf8_lossy(&encoded).contains("FORGOTTEN-LANTERN-MUST-NOT-RETURN"));
    let mut restored = RevisionLedger::from_snapshot(snapshot.clone()).expect("restore snapshot");
    assert_eq!(
        restored.lifecycle(&id("handoff-root")),
        Some(RevisionLifecycle::Forgotten)
    );
    assert!(restored.active_head(&id("handoff-root")).is_none());
    assert!(restored.history(&id("handoff-root")).is_empty());
    assert_eq!(
        restored.apply(forget_request).expect("exact replay"),
        forget_receipt
    );
    assert_eq!(
        restored.export_snapshot().expect("stable snapshot"),
        snapshot
    );
}

#[test]
fn operational_debug_and_fixture_receipts_are_body_free() {
    let fixture = fixture();
    let serialized = serde_json::to_string(&fixture).expect("serialize fixture");
    assert!(!serialized.contains("private_key"));
    assert!(!serialized.contains("credential"));
    assert!(!serialized.contains("provider_session"));
    assert!(!serialized.contains("/Users/"));

    let debug_record = record(
        "body-free-debug",
        0,
        None,
        "resident",
        "FORGOTTEN-LANTERN-MUST-NOT-RETURN",
    );
    let debug = format!("{debug_record:?}");
    assert!(!debug.contains("FORGOTTEN-LANTERN-MUST-NOT-RETURN"));
    assert!(BASE64_STANDARD.decode(&debug_record.ciphertext_b64).is_ok());
}
