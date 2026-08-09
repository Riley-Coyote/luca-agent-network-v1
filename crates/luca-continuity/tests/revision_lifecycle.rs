use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use luca_continuity::{
    derive_envelope_replacement_digest, derive_revision_idempotency_key, encrypt_record,
    encrypted_record_reference, ContinuityError, DurableContinuityRecordKind,
    EnvelopeReplacementV1, PurgeExecutionStatusV1, PurgePlan, RecordMetadata, RevisionActor,
    RevisionLedger, RevisionLedgerSnapshotV1, RevisionLifecycle, RevisionOperation,
    RevisionRequest, MAX_REVISION_MEMBERS_PER_LEDGER, MAX_REVISION_MEMBERS_PER_LINEAGE,
    MAX_REVISION_SNAPSHOT_CANONICAL_BYTES,
};
use luca_protocol::{
    CanonicalTimestamp, ContinuityNamespaceKindV1, ContinuityNamespaceV1, ContinuityScopeV1, Hex64,
    OpaqueId, SafeU53, Sha256Ref, CONTINUITY_PROTOCOL,
};

const KEY: [u8; 32] = [7; 32];

fn hex(digit: char) -> Hex64 {
    Hex64::parse(digit.to_string().repeat(64)).unwrap()
}

fn sha(digit: char) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", digit.to_string().repeat(64))).unwrap()
}

fn id(value: &str) -> OpaqueId {
    OpaqueId::parse(value).unwrap()
}

fn namespace() -> ContinuityNamespaceV1 {
    ContinuityNamespaceV1 {
        protocol: CONTINUITY_PROTOCOL.into(),
        owner_pubkey: hex('1'),
        kind: ContinuityNamespaceKindV1::ResidentPrivate,
        resident_pubkey: Some(hex('2')),
        namespace_ref: sha('3'),
        key_version: SafeU53::new(1).unwrap(),
    }
}

fn scope(namespace: &ContinuityNamespaceV1) -> ContinuityScopeV1 {
    ContinuityScopeV1 {
        protocol: CONTINUITY_PROTOCOL.into(),
        namespace_ref: namespace.namespace_ref.clone(),
        scope_ref: sha('4'),
        source_id: Some(id("source-1")),
        project_id: Some(id("project-1")),
        room_id: Some(id("room-1")),
        conversation_id: Some(id("conversation-1")),
    }
}

fn record(
    record_id: &str,
    revision: u64,
    predecessor: Option<OpaqueId>,
) -> luca_protocol::ContinuityRecordV1 {
    record_with(record_id, revision, predecessor, "resident", "hypomnema")
}

fn owner_record(
    record_id: &str,
    revision: u64,
    predecessor: Option<OpaqueId>,
) -> luca_protocol::ContinuityRecordV1 {
    record_with(record_id, revision, predecessor, "owner", "hypomnema")
}

fn record_with(
    record_id: &str,
    revision: u64,
    predecessor: Option<OpaqueId>,
    author_kind: &str,
    record_type: &str,
) -> luca_protocol::ContinuityRecordV1 {
    let namespace = namespace();
    encrypt_record(
        RecordMetadata {
            protocol: CONTINUITY_PROTOCOL.into(),
            record_id: id(record_id),
            namespace: namespace.clone(),
            scope: scope(&namespace),
            record_type: id(record_type),
            revision: SafeU53::new(revision).unwrap(),
            predecessor_record_id: predecessor,
            created_at: CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
            author_kind: id(author_kind),
            provenance_refs: vec![sha('5')],
            key_version: SafeU53::new(1).unwrap(),
        },
        &KEY,
        b"encrypted private body",
    )
    .unwrap()
}

fn rotate_record(
    original: &luca_protocol::ContinuityRecordV1,
) -> luca_protocol::ContinuityRecordV1 {
    let mut rotated_namespace = original.namespace.clone();
    rotated_namespace.key_version = SafeU53::new(2).unwrap();
    encrypt_record(
        RecordMetadata {
            protocol: original.protocol.clone(),
            record_id: original.record_id.clone(),
            namespace: rotated_namespace,
            scope: original.scope.clone(),
            record_type: original.record_type.clone(),
            revision: original.revision,
            predecessor_record_id: original.predecessor_record_id.clone(),
            created_at: original.created_at.clone(),
            author_kind: original.author_kind.clone(),
            provenance_refs: original.provenance_refs.clone(),
            key_version: SafeU53::new(2).unwrap(),
        },
        &[9; 32],
        b"rotated encrypted private body",
    )
    .unwrap()
}

fn add_rotation_mapping(snapshot: &mut RevisionLedgerSnapshotV1) {
    let original_binding = snapshot
        .revision_idempotency
        .iter()
        .find_map(|entry| entry.replay_binding.successor.as_ref())
        .unwrap()
        .clone();
    let rotated = rotate_record(&snapshot.records[0]);
    let mut replacement = EnvelopeReplacementV1 {
        record_id: rotated.record_id.clone(),
        original_key_version: SafeU53::new(1).unwrap(),
        original_nonce_b64: original_binding.nonce_b64,
        original_encrypted_record_ref: original_binding.encrypted_record_ref,
        replacement_key_version: SafeU53::new(2).unwrap(),
        replacement_nonce_b64: rotated.nonce_b64.clone(),
        replacement_encrypted_record_ref: encrypted_record_reference(&rotated).unwrap(),
        replacement_digest: sha('0'),
    };
    replacement.replacement_digest = derive_envelope_replacement_digest(&replacement).unwrap();
    snapshot.records[0] = rotated;
    snapshot.lineages[0].namespace.key_version = SafeU53::new(2).unwrap();
    snapshot.lineages[0].lineage_envelope_key_version = SafeU53::new(2).unwrap();
    snapshot.lineages[0].envelope_replacements = vec![replacement];
}

struct RequestArgs<'a> {
    key: &'a str,
    operation: RevisionOperation,
    root: &'a str,
    expected_head: Option<&'a str>,
    actor: RevisionActor,
    successor: Option<luca_protocol::ContinuityRecordV1>,
    rollback_source: Option<&'a str>,
    artifacts: Vec<Sha256Ref>,
}

fn make_request(args: RequestArgs<'_>) -> RevisionRequest {
    let successor = args.successor;
    let successor_ciphertext_ref = successor
        .as_ref()
        .map(encrypted_record_reference)
        .transpose()
        .unwrap();
    let mut request = RevisionRequest {
        idempotency_key: sha('a'),
        operation: args.operation,
        lineage_root_id: id(args.root),
        expected_head_record_id: args.expected_head.map(id),
        actor: args.actor,
        signed_source_event_refs: vec![sha('6')],
        request_ref: sha('7'),
        successor,
        successor_ciphertext_ref,
        rollback_source_record_id: args.rollback_source.map(id),
        derived_artifact_refs: args.artifacts,
    };
    let binding = request
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
            (
                namespace(),
                scope(&namespace()),
                id("hypomnema"),
                SafeU53::new(1).unwrap(),
            )
        });
    request.idempotency_key =
        derive_revision_idempotency_key(&binding.0, &binding.1, &binding.2, binding.3, &request)
            .unwrap();
    let _ = args.key;
    request
}

macro_rules! request {
    ($key:expr, $operation:expr, $root:expr, $expected_head:expr, $actor:expr, $successor:expr, $rollback_source:expr, $artifacts:expr $(,)?) => {
        make_request(RequestArgs {
            key: $key,
            operation: $operation,
            root: $root,
            expected_head: $expected_head,
            actor: $actor,
            successor: $successor,
            rollback_source: $rollback_source,
            artifacts: $artifacts,
        })
    };
}

fn create(ledger: &mut RevisionLedger) -> luca_protocol::ContinuityRecordV1 {
    let initial = owner_record("record-0", 0, None);
    ledger
        .apply(request!(
            "create-1",
            RevisionOperation::Create,
            "record-0",
            None,
            RevisionActor::Owner,
            Some(initial.clone()),
            None,
            vec![],
        ))
        .unwrap();
    initial
}

fn revise(
    ledger: &mut RevisionLedger,
    key: &str,
    parent: &str,
    next: &str,
    actor: RevisionActor,
) -> RevisionRequest {
    let successor = record(next, 1, Some(id(parent)));
    let request = request!(
        key,
        RevisionOperation::Revise,
        "record-0",
        Some(parent),
        actor,
        Some(successor),
        None,
        vec![],
    );
    ledger.apply(request.clone()).unwrap();
    request
}

fn register_artifacts(ledger: &mut RevisionLedger, head: &str, artifacts: Vec<Sha256Ref>) {
    let request_ref = sha('b');
    let idempotency_key = ledger
        .derive_artifact_registration_idempotency_key(
            &id("record-0"),
            &id(head),
            &request_ref,
            &artifacts,
        )
        .unwrap();
    ledger
        .register_derived_artifacts(
            idempotency_key,
            request_ref,
            &id("record-0"),
            &id(head),
            artifacts,
        )
        .unwrap();
}

#[test]
fn preserves_monotonic_immutable_history() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    revise(
        &mut ledger,
        "revise-1",
        "record-0",
        "record-1",
        RevisionActor::Resident,
    );
    let history = ledger.history(&id("record-0"));
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].record_id, id("record-0"));
    assert_eq!(history[1].record_id, id("record-1"));
    assert_eq!(history[0].revision.get(), 0);
    assert_eq!(history[1].revision.get(), 1);
    assert_eq!(history[1].predecessor_record_id, Some(id("record-0")));
}

#[test]
fn revise_correction_archive_and_forget_are_idempotent() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    let revise_request = revise(
        &mut ledger,
        "revise-idempotent",
        "record-0",
        "record-1",
        RevisionActor::Resident,
    );
    assert_eq!(
        ledger.apply(revise_request).unwrap().head_record_id,
        Some(id("record-1"))
    );
    let correction = request!(
        "correct-idempotent",
        RevisionOperation::OwnerCorrection,
        "record-0",
        Some("record-1"),
        RevisionActor::Owner,
        Some(owner_record("record-2", 2, Some(id("record-1")))),
        None,
        vec![],
    );
    assert_eq!(
        ledger.apply(correction.clone()).unwrap(),
        ledger.apply(correction).unwrap()
    );
    let archive = request!(
        "archive-idempotent",
        RevisionOperation::Archive,
        "record-0",
        Some("record-2"),
        RevisionActor::Owner,
        None,
        None,
        vec![],
    );
    assert_eq!(
        ledger.apply(archive.clone()).unwrap(),
        ledger.apply(archive).unwrap()
    );
    register_artifacts(&mut ledger, "record-2", vec![sha('8')]);
    let forget = request!(
        "forget-idempotent",
        RevisionOperation::Forget,
        "record-0",
        Some("record-2"),
        RevisionActor::Owner,
        None,
        None,
        vec![sha('8')],
    );
    assert_eq!(
        ledger.apply(forget.clone()).unwrap(),
        ledger.apply(forget).unwrap()
    );
}

#[test]
fn idempotency_key_reuse_with_changed_request_conflicts() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    let first = revise(
        &mut ledger,
        "same-key",
        "record-0",
        "record-1",
        RevisionActor::Resident,
    );
    let changed = RevisionRequest {
        request_ref: sha('8'),
        ..first
    };
    assert_eq!(
        ledger.apply(changed),
        Err(ContinuityError::IdempotencyConflict)
    );
}

#[test]
fn exact_namespace_scope_type_version_and_predecessor_are_required() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    let mut successor = record("record-1", 1, Some(id("record-0")));
    successor.scope.room_id = Some(id("other-room"));
    let mut bad = request!(
        "bad-scope",
        RevisionOperation::Revise,
        "record-0",
        Some("record-0"),
        RevisionActor::Resident,
        Some(successor),
        None,
        vec![],
    );
    bad.successor_ciphertext_ref = bad
        .successor
        .as_ref()
        .map(encrypted_record_reference)
        .transpose()
        .unwrap();
    assert_eq!(
        ledger.apply(bad),
        Err(ContinuityError::InvalidRevisionRequest)
    );
    let bad_pred = request!(
        "bad-pred",
        RevisionOperation::Revise,
        "record-0",
        Some("record-0"),
        RevisionActor::Resident,
        Some(record("record-2", 1, Some(id("not-head")))),
        None,
        vec![],
    );
    assert_eq!(
        ledger.apply(bad_pred),
        Err(ContinuityError::RevisionConflict)
    );
    for (key, mut successor) in [
        ("bad-owner", record("record-owner", 1, Some(id("record-0")))),
        (
            "bad-resident",
            record("record-resident", 1, Some(id("record-0"))),
        ),
        ("bad-type", record("record-type", 1, Some(id("record-0")))),
        (
            "bad-version",
            record("record-version", 1, Some(id("record-0"))),
        ),
    ] {
        match key {
            "bad-owner" => successor.namespace.owner_pubkey = hex('a'),
            "bad-resident" => successor.namespace.resident_pubkey = Some(hex('b')),
            "bad-type" => successor.record_type = id("journal"),
            "bad-version" => {
                successor.namespace.key_version = SafeU53::new(2).unwrap();
                successor.key_version = SafeU53::new(2).unwrap();
            }
            _ => unreachable!(),
        }
        let mut changed = request!(
            key,
            RevisionOperation::Revise,
            "record-0",
            Some("record-0"),
            RevisionActor::Resident,
            Some(successor),
            None,
            vec![],
        );
        changed.successor_ciphertext_ref = changed
            .successor
            .as_ref()
            .map(encrypted_record_reference)
            .transpose()
            .unwrap();
        assert_eq!(
            ledger.apply(changed),
            Err(ContinuityError::InvalidRevisionRequest)
        );
    }
    let duplicate = request!(
        "duplicate-id",
        RevisionOperation::Revise,
        "record-0",
        Some("record-0"),
        RevisionActor::Resident,
        Some(record("record-0", 1, Some(id("record-0")))),
        None,
        vec![],
    );
    assert_eq!(
        ledger.apply(duplicate),
        Err(ContinuityError::RevisionConflict)
    );
    assert_eq!(ledger.history(&id("record-0")).len(), 1);
}

#[test]
fn owner_correction_pins_authority_until_later_owner_correction() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    let correction = request!(
        "correction-1",
        RevisionOperation::OwnerCorrection,
        "record-0",
        Some("record-0"),
        RevisionActor::Owner,
        Some(owner_record("record-1", 1, Some(id("record-0")))),
        None,
        vec![],
    );
    ledger.apply(correction).unwrap();
    let resident = request!(
        "resident-after-pin",
        RevisionOperation::Revise,
        "record-0",
        Some("record-1"),
        RevisionActor::Resident,
        Some(record("record-2", 2, Some(id("record-1")))),
        None,
        vec![],
    );
    assert_eq!(
        ledger.apply(resident),
        Err(ContinuityError::PinnedOwnerCorrection)
    );
    let actor_author_mismatch = request!(
        "owner-authorship-mismatch",
        RevisionOperation::OwnerCorrection,
        "record-0",
        Some("record-1"),
        RevisionActor::Owner,
        Some(record("record-mismatch", 2, Some(id("record-1")))),
        None,
        vec![],
    );
    assert_eq!(
        ledger.apply(actor_author_mismatch),
        Err(ContinuityError::InvalidRevisionRequest)
    );
    let override_correction = request!(
        "correction-2",
        RevisionOperation::OwnerCorrection,
        "record-0",
        Some("record-1"),
        RevisionActor::Owner,
        Some(owner_record("record-2", 2, Some(id("record-1")))),
        None,
        vec![],
    );
    assert_eq!(
        ledger.apply(override_correction).unwrap().head_record_id,
        Some(id("record-2"))
    );
}

#[test]
fn rollback_is_a_new_immutable_successor() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    revise(
        &mut ledger,
        "revise-1",
        "record-0",
        "record-1",
        RevisionActor::Resident,
    );
    let rollback = request!(
        "rollback-1",
        RevisionOperation::Rollback,
        "record-0",
        Some("record-1"),
        RevisionActor::Owner,
        Some(owner_record("record-2", 2, Some(id("record-1")))),
        Some("record-0"),
        vec![],
    );
    assert_eq!(
        ledger.apply(rollback).unwrap().head_record_id,
        Some(id("record-2"))
    );
    assert_eq!(ledger.history(&id("record-0")).len(), 3);
}

#[test]
fn archive_excludes_retrieval_but_retains_history_and_owner_can_rollback() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    revise(
        &mut ledger,
        "revise-before-archive",
        "record-0",
        "record-1",
        RevisionActor::Resident,
    );
    let archive = request!(
        "archive-1",
        RevisionOperation::Archive,
        "record-0",
        Some("record-1"),
        RevisionActor::Owner,
        None,
        None,
        vec![],
    );
    ledger.apply(archive).unwrap();
    assert!(!ledger.retrieval_eligible(&id("record-0")));
    assert!(ledger.active_head(&id("record-0")).is_none());
    assert_eq!(ledger.history(&id("record-0")).len(), 2);
    let rollback = request!(
        "rollback-archive",
        RevisionOperation::Rollback,
        "record-0",
        Some("record-1"),
        RevisionActor::Owner,
        Some(owner_record("record-2", 2, Some(id("record-1")))),
        Some("record-0"),
        vec![],
    );
    ledger.apply(rollback).unwrap();
    assert!(ledger.retrieval_eligible(&id("record-0")));
}

#[test]
fn forget_is_terminal_and_returns_exact_deterministic_purge_plan() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    revise(
        &mut ledger,
        "revise-1",
        "record-0",
        "record-1",
        RevisionActor::Resident,
    );
    let stale_forget = request!(
        "forget-stale-head",
        RevisionOperation::Forget,
        "record-0",
        Some("record-0"),
        RevisionActor::Owner,
        None,
        None,
        vec![sha('8'), sha('9')],
    );
    assert_eq!(
        ledger.apply(stale_forget),
        Err(ContinuityError::RevisionConflict)
    );
    assert!(ledger.retrieval_eligible(&id("record-0")));
    register_artifacts(&mut ledger, "record-1", vec![sha('8'), sha('9')]);
    let forget = request!(
        "forget-1",
        RevisionOperation::Forget,
        "record-0",
        Some("record-1"),
        RevisionActor::Owner,
        None,
        None,
        vec![sha('8'), sha('9')],
    );
    let receipt = ledger.apply(forget).unwrap();
    assert_eq!(receipt.lifecycle, RevisionLifecycle::Forgotten);
    assert_eq!(
        receipt.purge_plan,
        Some(PurgePlan {
            lineage_root_id: id("record-0"),
            record_ids: vec![id("record-0"), id("record-1")],
            derived_artifact_refs: vec![sha('8'), sha('9')],
        })
    );
    assert!(ledger.history(&id("record-0")).is_empty());
    assert_eq!(ledger.active_head(&id("record-0")), None);
}

#[test]
fn forget_purge_plan_covers_descendants_and_derived_artifacts() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    revise(
        &mut ledger,
        "revise-1",
        "record-0",
        "record-1",
        RevisionActor::Resident,
    );
    let third = request!(
        "correction-1",
        RevisionOperation::OwnerCorrection,
        "record-0",
        Some("record-1"),
        RevisionActor::Owner,
        Some(owner_record("record-2", 2, Some(id("record-1")))),
        None,
        vec![],
    );
    ledger.apply(third).unwrap();
    register_artifacts(&mut ledger, "record-2", vec![sha('8'), sha('9')]);
    let receipt = ledger
        .apply(request!(
            "forget-derived",
            RevisionOperation::Forget,
            "record-0",
            Some("record-2"),
            RevisionActor::Owner,
            None,
            None,
            vec![sha('8'), sha('9')],
        ))
        .unwrap();
    assert_eq!(
        receipt.purge_plan.unwrap().record_ids,
        vec![id("record-0"), id("record-1"), id("record-2")]
    );
}

#[test]
fn diagnostics_receipts_and_debug_are_body_free() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    let debug = format!("{ledger:?}");
    assert!(!debug.contains("encrypted private body"));
    let receipt = ledger
        .apply(request!(
            "archive-safe",
            RevisionOperation::Archive,
            "record-0",
            Some("record-0"),
            RevisionActor::Owner,
            None,
            None,
            vec![],
        ))
        .unwrap();
    let receipt_debug = format!("{receipt:?}");
    assert!(!receipt_debug.contains("encrypted private body"));
    assert_eq!(
        format!("{}", ContinuityError::RevisionConflict),
        "continuity revision does not match the current lineage"
    );
}

#[test]
fn idempotency_and_purge_order_have_stable_vectors() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    register_artifacts(&mut ledger, "record-0", vec![sha('8'), sha('9')]);
    let forget = request!(
        "stable-forget",
        RevisionOperation::Forget,
        "record-0",
        Some("record-0"),
        RevisionActor::Owner,
        None,
        None,
        vec![sha('8'), sha('9')],
    );
    let first = ledger.apply(forget.clone()).unwrap();
    let second = ledger.apply(forget).unwrap();
    assert_eq!(first, second);
    assert_eq!(
        first.purge_plan.unwrap().derived_artifact_refs,
        vec![sha('8'), sha('9')]
    );
    let fixed_namespace = namespace();
    let fixed = luca_protocol::ContinuityRecordV1 {
        protocol: CONTINUITY_PROTOCOL.into(),
        record_id: id("vector-0"),
        namespace: fixed_namespace.clone(),
        scope: scope(&fixed_namespace),
        record_type: id("hypomnema"),
        revision: SafeU53::new(0).unwrap(),
        predecessor_record_id: None,
        created_at: CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
        author_kind: id("owner"),
        provenance_refs: vec![sha('5')],
        key_version: SafeU53::new(1).unwrap(),
        aad_sha256: hex('a'),
        nonce_b64: BASE64_STANDARD.encode([0_u8; 24]),
        ciphertext_b64: BASE64_STANDARD.encode([0_u8; 16]),
    };
    let vector_request = RevisionRequest {
        idempotency_key: sha('a'),
        operation: RevisionOperation::Create,
        lineage_root_id: id("vector-0"),
        expected_head_record_id: None,
        actor: RevisionActor::Owner,
        signed_source_event_refs: vec![sha('6')],
        request_ref: sha('7'),
        successor_ciphertext_ref: Some(encrypted_record_reference(&fixed).unwrap()),
        successor: Some(fixed.clone()),
        rollback_source_record_id: None,
        derived_artifact_refs: vec![],
    };
    let idempotency = derive_revision_idempotency_key(
        &fixed.namespace,
        &fixed.scope,
        &fixed.record_type,
        fixed.key_version,
        &vector_request,
    )
    .unwrap();
    assert_eq!(
        idempotency.as_str(),
        "sha256:0637eeef108203022b504cfe0c4ac34f417033c50860360045b96841f8555869"
    );
}

#[test]
fn nonce_is_unique_across_heads_older_revisions_and_lineages() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    let root_nonce = ledger.history(&id("record-0"))[0].nonce_b64.clone();

    let mut head_collision = record("collision-head", 1, Some(id("record-0")));
    head_collision.nonce_b64 = root_nonce.clone();
    let collision = request!(
        "collision-head",
        RevisionOperation::Revise,
        "record-0",
        Some("record-0"),
        RevisionActor::Resident,
        Some(head_collision),
        None,
        vec![],
    );
    assert_eq!(
        ledger.apply(collision),
        Err(ContinuityError::NonceCollision)
    );
    assert_eq!(ledger.history(&id("record-0")).len(), 1);

    revise(
        &mut ledger,
        "revise-after-collision",
        "record-0",
        "record-1",
        RevisionActor::Resident,
    );
    let mut older_collision = record("collision-old", 2, Some(id("record-1")));
    older_collision.nonce_b64 = root_nonce.clone();
    let collision = request!(
        "collision-old",
        RevisionOperation::Revise,
        "record-0",
        Some("record-1"),
        RevisionActor::Resident,
        Some(older_collision),
        None,
        vec![],
    );
    assert_eq!(
        ledger.apply(collision),
        Err(ContinuityError::NonceCollision)
    );
    assert_eq!(ledger.history(&id("record-0")).len(), 2);
    assert_eq!(
        ledger.active_head(&id("record-0")).unwrap().record_id,
        id("record-1")
    );

    let mut cross_lineage = owner_record("other-root", 0, None);
    cross_lineage.nonce_b64 = root_nonce;
    let collision = request!(
        "collision-lineage",
        RevisionOperation::Create,
        "other-root",
        None,
        RevisionActor::Owner,
        Some(cross_lineage),
        None,
        vec![],
    );
    assert_eq!(
        ledger.apply(collision),
        Err(ContinuityError::NonceCollision)
    );
    assert_eq!(ledger.lifecycle(&id("other-root")), None);
}

#[test]
fn restart_snapshot_round_trips_and_replays_historical_receipts_without_writes() {
    let mut ledger = RevisionLedger::default();
    let initial = owner_record("record-0", 0, None);
    let create_request = request!(
        "create-snapshot",
        RevisionOperation::Create,
        "record-0",
        None,
        RevisionActor::Owner,
        Some(initial),
        None,
        vec![],
    );
    let create_receipt = ledger.apply(create_request.clone()).unwrap();
    let revise_request = revise(
        &mut ledger,
        "revise-snapshot",
        "record-0",
        "record-1",
        RevisionActor::Resident,
    );
    register_artifacts(&mut ledger, "record-1", vec![sha('8')]);
    let archive = request!(
        "archive-snapshot",
        RevisionOperation::Archive,
        "record-0",
        Some("record-1"),
        RevisionActor::Owner,
        None,
        None,
        vec![],
    );
    ledger.apply(archive).unwrap();

    let snapshot = ledger.export_snapshot().unwrap();
    let fingerprint = snapshot.fingerprint().unwrap();
    let mut hydrated = RevisionLedger::from_snapshot(snapshot.clone()).unwrap();
    assert_eq!(hydrated.export_snapshot().unwrap(), snapshot);
    assert_eq!(
        hydrated.export_snapshot().unwrap().fingerprint().unwrap(),
        fingerprint
    );

    let before_replay = hydrated.export_snapshot().unwrap();
    assert_eq!(hydrated.apply(create_request).unwrap(), create_receipt);
    let original_revise = snapshot
        .revision_idempotency
        .iter()
        .find(|entry| entry.replay_binding.operation == RevisionOperation::Revise)
        .unwrap()
        .receipt
        .clone();
    assert_eq!(hydrated.apply(revise_request).unwrap(), original_revise);
    assert_eq!(hydrated.export_snapshot().unwrap(), before_replay);
}

#[test]
fn retained_active_and_archived_rotation_hydrate_only_with_exact_replacement_authority() {
    for archived in [false, true] {
        let mut ledger = RevisionLedger::default();
        create(&mut ledger);
        if archived {
            ledger
                .apply(request!(
                    "archive-before-rotation",
                    RevisionOperation::Archive,
                    "record-0",
                    Some("record-0"),
                    RevisionActor::Owner,
                    None,
                    None,
                    vec![],
                ))
                .unwrap();
        }
        let mut rotated = ledger.export_snapshot().unwrap();
        add_rotation_mapping(&mut rotated);
        let hydrated = RevisionLedger::from_snapshot(rotated.clone()).unwrap();
        assert_eq!(hydrated.export_snapshot().unwrap(), rotated);

        let mut missing = rotated.clone();
        missing.lineages[0].envelope_replacements.clear();
        assert_eq!(
            RevisionLedger::from_snapshot(missing).unwrap_err(),
            ContinuityError::RevisionConflict
        );

        let mut tampered = rotated;
        tampered.lineages[0].envelope_replacements[0].replacement_nonce_b64 =
            BASE64_STANDARD.encode([8_u8; 24]);
        assert_eq!(
            RevisionLedger::from_snapshot(tampered).unwrap_err(),
            ContinuityError::RevisionConflict
        );
    }
}

#[test]
fn artifact_references_have_one_global_live_lineage_authority() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    let second = owner_record("second-0", 0, None);
    ledger
        .apply(request!(
            "create-second-artifact-owner",
            RevisionOperation::Create,
            "second-0",
            None,
            RevisionActor::Owner,
            Some(second),
            None,
            vec![],
        ))
        .unwrap();
    register_artifacts(&mut ledger, "record-0", vec![sha('8')]);

    let request_ref = sha('c');
    let duplicate = vec![sha('8')];
    let key = ledger
        .derive_artifact_registration_idempotency_key(
            &id("second-0"),
            &id("second-0"),
            &request_ref,
            &duplicate,
        )
        .unwrap();
    assert_eq!(
        ledger.register_derived_artifacts(
            key,
            request_ref,
            &id("second-0"),
            &id("second-0"),
            duplicate,
        ),
        Err(ContinuityError::RevisionConflict)
    );

    let mut crossed = ledger.export_snapshot().unwrap();
    crossed.lineages[1].derived_artifact_refs = vec![sha('8')];
    assert_eq!(
        RevisionLedger::from_snapshot(crossed).unwrap_err(),
        ContinuityError::RevisionConflict
    );
}

#[test]
fn artifact_history_requires_exact_ordered_inventory_transitions() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    register_artifacts(&mut ledger, "record-0", vec![sha('8')]);
    register_artifacts(&mut ledger, "record-0", vec![sha('9')]);
    let good = ledger.export_snapshot().unwrap();
    assert!(RevisionLedger::from_snapshot(good.clone()).is_ok());

    let mut future_claim = good.clone();
    let first = future_claim
        .artifact_idempotency
        .iter_mut()
        .find(|entry| entry.replay_binding.artifact_sequence.get() == 0)
        .unwrap();
    first.receipt.complete_inventory = vec![sha('8'), sha('9')];
    assert_eq!(
        RevisionLedger::from_snapshot(future_claim).unwrap_err(),
        ContinuityError::RevisionConflict
    );

    let mut duplicate_sequence = good;
    duplicate_sequence
        .artifact_idempotency
        .iter_mut()
        .find(|entry| entry.replay_binding.artifact_sequence.get() == 1)
        .unwrap()
        .replay_binding
        .artifact_sequence = SafeU53::new(0).unwrap();
    assert!(RevisionLedger::from_snapshot(duplicate_sequence).is_err());
}

#[test]
fn snapshot_decode_and_aggregate_membership_are_bounded_before_hydration() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    let good = ledger.export_snapshot().unwrap();
    let serialized = serde_json::to_vec(&good).unwrap();
    assert_eq!(
        RevisionLedgerSnapshotV1::decode_bounded(&serialized).unwrap(),
        good
    );
    assert_eq!(
        RevisionLedgerSnapshotV1::decode_bounded(&vec![
            b' ';
            MAX_REVISION_SNAPSHOT_CANONICAL_BYTES + 1
        ])
        .unwrap_err(),
        ContinuityError::InvalidRevisionRequest
    );

    let mut aggregate = good.clone();
    aggregate.lineages.clear();
    let lineage_template = good.lineages[0].clone();
    let lineage_count = MAX_REVISION_MEMBERS_PER_LEDGER / MAX_REVISION_MEMBERS_PER_LINEAGE + 1;
    for lineage_index in 0..lineage_count {
        let mut lineage = lineage_template.clone();
        lineage.lineage_root_id = id(&format!("aggregate-{lineage_index:04}-0000"));
        lineage.record_ids = (0..MAX_REVISION_MEMBERS_PER_LINEAGE)
            .map(|member| id(&format!("aggregate-{lineage_index:04}-{member:04}")))
            .collect();
        lineage.lineage_head_record_id = lineage.record_ids.last().unwrap().clone();
        lineage.active_head_record_id = Some(lineage.lineage_head_record_id.clone());
        aggregate.lineages.push(lineage);
    }
    assert_eq!(
        RevisionLedger::from_snapshot(aggregate).unwrap_err(),
        ContinuityError::InvalidRevisionRequest
    );
}

#[test]
fn completed_forget_purges_ciphertext_and_survives_restart_without_resurrection() {
    let mut ledger = RevisionLedger::default();
    let initial = create(&mut ledger);
    let revise_request = revise(
        &mut ledger,
        "revise-before-purge",
        "record-0",
        "record-1",
        RevisionActor::Resident,
    );
    let successor_ciphertext = revise_request
        .successor
        .as_ref()
        .unwrap()
        .ciphertext_b64
        .clone();
    register_artifacts(&mut ledger, "record-1", vec![sha('8')]);
    let forget = request!(
        "forget-for-purge",
        RevisionOperation::Forget,
        "record-0",
        Some("record-1"),
        RevisionActor::Owner,
        None,
        None,
        vec![sha('8')],
    );
    ledger.apply(forget).unwrap();
    assert_eq!(ledger.export_snapshot().unwrap().records.len(), 2);
    ledger
        .advance_purge(&id("record-0"), PurgeExecutionStatusV1::InProgress)
        .unwrap();
    ledger
        .advance_purge(&id("record-0"), PurgeExecutionStatusV1::Completed)
        .unwrap();

    let snapshot = ledger.export_snapshot().unwrap();
    assert!(snapshot.records.is_empty());
    let serialized = serde_json::to_string(&snapshot).unwrap();
    assert!(!serialized.contains(&initial.ciphertext_b64));
    assert!(!serialized.contains(&successor_ciphertext));
    assert!(!serialized.contains("ciphertext_b64"));

    let mut hydrated = RevisionLedger::from_snapshot(snapshot.clone()).unwrap();
    assert_eq!(
        hydrated.lifecycle(&id("record-0")),
        Some(RevisionLifecycle::Forgotten)
    );
    assert!(hydrated.active_head(&id("record-0")).is_none());
    assert!(hydrated.history(&id("record-0")).is_empty());
    let replay_receipt = snapshot
        .revision_idempotency
        .iter()
        .find(|entry| entry.replay_binding.operation == RevisionOperation::Revise)
        .unwrap()
        .receipt
        .clone();
    assert_eq!(hydrated.apply(revise_request).unwrap(), replay_receipt);
    assert_eq!(hydrated.export_snapshot().unwrap(), snapshot);
}

#[test]
fn hydration_rejects_missing_extra_cross_lineage_and_partial_purge_authority() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    revise(
        &mut ledger,
        "revise-malformed",
        "record-0",
        "record-1",
        RevisionActor::Resident,
    );
    let good = ledger.export_snapshot().unwrap();

    let mut missing = good.clone();
    missing.records.pop();
    assert!(RevisionLedger::from_snapshot(missing).is_err());

    let mut extra = good.clone();
    extra.lineages.clear();
    assert!(RevisionLedger::from_snapshot(extra).is_err());

    let mut wrong_head = good.clone();
    wrong_head.lineages[0].active_head_record_id = Some(id("record-0"));
    assert!(RevisionLedger::from_snapshot(wrong_head).is_err());

    let second = owner_record("second-0", 0, None);
    ledger
        .apply(request!(
            "create-second",
            RevisionOperation::Create,
            "second-0",
            None,
            RevisionActor::Owner,
            Some(second),
            None,
            vec![],
        ))
        .unwrap();
    let mut crossed = ledger.export_snapshot().unwrap();
    crossed.lineages[1].record_ids.push(id("record-1"));
    crossed.lineages[1].lineage_head_record_id = id("record-1");
    crossed.lineages[1].active_head_record_id = Some(id("record-1"));
    assert!(RevisionLedger::from_snapshot(crossed).is_err());

    let mut purge_ledger = RevisionLedger::default();
    create(&mut purge_ledger);
    let forget = request!(
        "forget-partial",
        RevisionOperation::Forget,
        "record-0",
        Some("record-0"),
        RevisionActor::Owner,
        None,
        None,
        vec![],
    );
    purge_ledger.apply(forget).unwrap();
    purge_ledger
        .advance_purge(&id("record-0"), PurgeExecutionStatusV1::InProgress)
        .unwrap();
    let mut partial = purge_ledger.export_snapshot().unwrap();
    partial.records.clear();
    assert!(RevisionLedger::from_snapshot(partial).is_err());

    let mut unknown = serde_json::to_value(good).unwrap();
    unknown
        .as_object_mut()
        .unwrap()
        .insert("unexpected".into(), serde_json::json!(true));
    assert!(serde_json::from_value::<luca_continuity::RevisionLedgerSnapshotV1>(unknown).is_err());
}

#[test]
fn historical_replay_keeps_original_version_after_completed_purge_reconciliation() {
    let mut ledger = RevisionLedger::default();
    let initial = owner_record("record-0", 0, None);
    let create_request = request!(
        "create-version-one",
        RevisionOperation::Create,
        "record-0",
        None,
        RevisionActor::Owner,
        Some(initial),
        None,
        vec![],
    );
    let original_receipt = ledger.apply(create_request.clone()).unwrap();
    let forget = request!(
        "forget-version-one",
        RevisionOperation::Forget,
        "record-0",
        Some("record-0"),
        RevisionActor::Owner,
        None,
        None,
        vec![],
    );
    ledger.apply(forget).unwrap();
    ledger
        .advance_purge(&id("record-0"), PurgeExecutionStatusV1::InProgress)
        .unwrap();
    ledger
        .advance_purge(&id("record-0"), PurgeExecutionStatusV1::Completed)
        .unwrap();
    let mut reconciled = ledger.export_snapshot().unwrap();
    reconciled.lineages[0].namespace.key_version = SafeU53::new(2).unwrap();
    reconciled.lineages[0].lineage_envelope_key_version = SafeU53::new(2).unwrap();

    let mut hydrated = RevisionLedger::from_snapshot(reconciled).unwrap();
    assert_eq!(hydrated.apply(create_request).unwrap(), original_receipt);
}

#[test]
fn snapshot_collection_bounds_fail_closed() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    let good = ledger.export_snapshot().unwrap();
    let mut oversized = good.clone();
    oversized.lineages =
        vec![good.lineages[0].clone(); luca_continuity::MAX_REVISION_AUTHORITY_HEADS + 1];
    assert!(RevisionLedger::from_snapshot(oversized).is_err());
}

#[test]
fn forget_requires_the_exact_authoritative_artifact_inventory() {
    let mut ledger = RevisionLedger::default();
    create(&mut ledger);
    let request_ref = sha('b');
    let artifacts = vec![sha('8'), sha('9')];
    let idempotency_key = ledger
        .derive_artifact_registration_idempotency_key(
            &id("record-0"),
            &id("record-0"),
            &request_ref,
            &artifacts,
        )
        .unwrap();
    let first = ledger
        .register_derived_artifacts(
            idempotency_key.clone(),
            request_ref.clone(),
            &id("record-0"),
            &id("record-0"),
            artifacts.clone(),
        )
        .unwrap();
    assert_eq!(first.newly_registered, vec![sha('8'), sha('9')]);
    let replay = ledger
        .register_derived_artifacts(
            idempotency_key,
            request_ref,
            &id("record-0"),
            &id("record-0"),
            artifacts,
        )
        .unwrap();
    assert_eq!(replay, first);
    assert_eq!(replay.complete_inventory, vec![sha('8'), sha('9')]);

    for (key, artifacts) in [
        ("forget-incomplete", vec![sha('8')]),
        ("forget-extra", vec![sha('8'), sha('9'), sha('a')]),
    ] {
        let rejected = request!(
            key,
            RevisionOperation::Forget,
            "record-0",
            Some("record-0"),
            RevisionActor::Owner,
            None,
            None,
            artifacts,
        );
        assert_eq!(
            ledger.apply(rejected),
            Err(ContinuityError::InvalidRevisionRequest)
        );
        assert_eq!(
            ledger.lifecycle(&id("record-0")),
            Some(RevisionLifecycle::Active)
        );
    }
    let receipt = ledger
        .apply(request!(
            "forget-exact",
            RevisionOperation::Forget,
            "record-0",
            Some("record-0"),
            RevisionActor::Owner,
            None,
            None,
            vec![sha('8'), sha('9')],
        ))
        .unwrap();
    assert_eq!(
        receipt.purge_plan.unwrap().derived_artifact_refs,
        vec![sha('8'), sha('9')]
    );
}

#[test]
fn durable_record_kind_allowlist_is_closed_and_case_sensitive() {
    for approved in [
        "handoff",
        "open-thread",
        "commitment",
        "preference",
        "hypomnema",
        "journal",
        "reflection",
        "owner-brain-source",
        "owner-brain-binding",
        "owner-brain-chunk-page",
        "owner-brain-grant",
        "owner-brain-receipt",
        "associative-engram",
        "typed-connection",
        "identity",
        "relationship",
        "conviction",
    ] {
        assert!(DurableContinuityRecordKind::parse(&id(approved)).is_ok());
    }
    for rejected in [
        "Hypomnema",
        "open_thread",
        "identity-profile",
        "psychometric-profile",
        "psychometric-inference",
        "journal-v2",
        "mood",
        "dream",
    ] {
        assert_eq!(
            DurableContinuityRecordKind::parse(&id(rejected)),
            Err(ContinuityError::UnsupportedRecordType)
        );
    }
}

#[test]
fn fixed_sensitive_profiling_types_are_rejected() {
    let mut ledger = RevisionLedger::default();
    let sensitive = record_with("sensitive-0", 0, None, "owner", "psychometric-profile");
    let request = request!(
        "sensitive-create",
        RevisionOperation::Create,
        "sensitive-0",
        None,
        RevisionActor::Owner,
        Some(sensitive),
        None,
        vec![],
    );
    assert_eq!(
        ledger.apply(request),
        Err(ContinuityError::UnsupportedRecordType)
    );
}
