use super::*;
use luca_protocol::{
    CommunicationContractError, CommunicationDestinationV1, CommunicationOperationV1,
    COMMUNICATION_ACTION_PROTOCOL,
};

fn hex(value: char) -> Hex64 {
    Hex64::parse(value.to_string().repeat(64)).expect("fixture hex")
}

fn sha(value: char) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", value.to_string().repeat(64))).expect("fixture hash")
}

fn id(value: &str) -> OpaqueId {
    OpaqueId::parse(value).expect("fixture opaque ID")
}

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("fixture safe integer")
}

fn time(value: &str) -> CanonicalTimestamp {
    CanonicalTimestamp::parse(value).expect("fixture timestamp")
}

fn request(body: &str) -> CommunicationActionRequestV1 {
    let mut request = CommunicationActionRequestV1 {
        protocol: COMMUNICATION_ACTION_PROTOCOL.to_owned(),
        action_id: id("action-1"),
        idempotency_key: hex('0'),
        action_fingerprint: sha('0'),
        actor_pubkey: hex('2'),
        owner_pubkey: hex('1'),
        resident_pubkey: hex('2'),
        session_epoch: safe(4),
        runtime_binding_ref: sha('3'),
        source_conversation_id: id("source-conversation"),
        destination: CommunicationDestinationV1::ExistingConversation {
            conversation_id: id("destination-conversation"),
            participant_set_version: safe(7),
            participant_set_ref: sha('4'),
        },
        turn_id: id("turn-1"),
        dispatch_receipt_id: id("dispatch-1"),
        causal_root_id: id("causal-root-1"),
        causal_parent_action_id: None,
        causal_depth: safe(0),
        cancellation_epoch: safe(2),
        expires_at: time("2026-08-11T13:00:00Z"),
        approval_id: None,
        operation: CommunicationOperationV1::SendMessage {
            body: body.to_owned(),
            reply_to_event_id: None,
            mention_pubkeys: Vec::new(),
            activation_pubkeys: Vec::new(),
            artifact_handles: Vec::new(),
        },
    };
    request.action_fingerprint = request
        .derive_action_fingerprint()
        .expect("fixture fingerprint");
    request.idempotency_key = request.derive_idempotency_key().expect("fixture key");
    request
}

fn prepare(
    outbox: &mut CommunicationActionOutbox,
    request: &CommunicationActionRequestV1,
    session: &OpaqueId,
) -> CommunicationActionOutboxReceipt {
    outbox
        .prepare(
            request,
            id("sealed-event-1"),
            hex('a'),
            hex('b'),
            session,
            2,
            false,
            time("2026-08-11T12:00:00Z"),
        )
        .expect("prepare action")
}

#[test]
fn action_outbox_has_one_way_exact_lifecycle_and_suppresses_late_finalization() {
    let session = id("installation-1");
    let request = request("message body sentinel");
    let mut outbox = CommunicationActionOutbox::new(session.clone());

    let prepared = prepare(&mut outbox, &request, &session);
    assert_eq!(prepared.state, CommunicationActionOutboxStateV1::Prepared);
    assert_eq!(prepared.actor_pubkey, request.actor_pubkey);
    assert_eq!(prepared.turn_id, request.turn_id);
    assert_eq!(prepared.cancellation_epoch, request.cancellation_epoch);

    let submitted = outbox
        .mark_submitted(
            &request.idempotency_key,
            &session,
            2,
            false,
            time("2026-08-11T12:00:01Z"),
        )
        .expect("submit action");
    assert_eq!(submitted.state, CommunicationActionOutboxStateV1::Submitted);

    let accepted = outbox
        .mark_accepted(
            &request.idempotency_key,
            hex('b'),
            id("publication-receipt-1"),
            time("2026-08-11T12:00:02Z"),
        )
        .expect("accept action");
    assert_eq!(accepted.state, CommunicationActionOutboxStateV1::Accepted);
    assert!(matches!(
        outbox.mark_publication_unknown(&request.idempotency_key),
        Err(CommunicationActionOutboxError::InvalidTransition)
    ));
}

#[test]
fn cancellation_wins_before_submission_and_blocks_late_acceptance() {
    let session = id("installation-2");
    let request = request("cancelled message sentinel");
    let mut outbox = CommunicationActionOutbox::new(session.clone());
    prepare(&mut outbox, &request, &session);

    let cancelled = outbox
        .mark_submitted(
            &request.idempotency_key,
            &session,
            2,
            true,
            time("2026-08-11T12:00:01Z"),
        )
        .expect("cancellation terminalizes prepared row");
    assert_eq!(cancelled.state, CommunicationActionOutboxStateV1::Cancelled);
    assert!(matches!(
        outbox.mark_accepted(
            &request.idempotency_key,
            hex('b'),
            id("publication-receipt-2"),
            time("2026-08-11T12:00:02Z")
        ),
        Err(CommunicationActionOutboxError::InvalidTransition)
    ));
    assert!(outbox.reconciliation_entries().is_empty());
}

#[test]
fn relay_absence_becomes_nonterminal_publication_unknown() {
    let session = id("installation-3");
    let request = request("submitted message sentinel");
    let mut outbox = CommunicationActionOutbox::new(session.clone());
    prepare(&mut outbox, &request, &session);
    outbox
        .mark_submitted(
            &request.idempotency_key,
            &session,
            2,
            false,
            time("2026-08-11T12:00:01Z"),
        )
        .expect("submit action");

    assert!(matches!(
        outbox.cancel_before_submission(&request.idempotency_key, time("2026-08-11T12:00:02Z")),
        Err(CommunicationActionOutboxError::InvalidTransition)
    ));
    let unknown = outbox
        .mark_publication_unknown(&request.idempotency_key)
        .expect("record unknown publication outcome");
    assert_eq!(
        unknown.state,
        CommunicationActionOutboxStateV1::PublicationUnknown
    );
    assert_eq!(outbox.reconciliation_entries().len(), 1);
    assert_eq!(
        outbox
            .row_for_submission(&request.idempotency_key)
            .expect("same frozen event remains retryable")
            .expected_event_id,
        hex('b')
    );
}

#[test]
fn exact_duplicate_is_idempotent_and_any_binding_drift_collides() {
    let session = id("installation-4");
    let request = request("stable duplicate sentinel");
    let mut outbox = CommunicationActionOutbox::new(session.clone());
    let first = prepare(&mut outbox, &request, &session);
    let duplicate = outbox
        .prepare(
            &request,
            id("sealed-event-1"),
            hex('a'),
            hex('b'),
            &session,
            2,
            false,
            time("2026-08-11T12:00:05Z"),
        )
        .expect("exact replay");
    assert_eq!(first, duplicate);

    assert!(matches!(
        outbox.preflight_existing(&request, &id("sealed-event-2"), &hex('a'), &hex('b')),
        Err(CommunicationActionOutboxError::IdempotencyCollision)
    ));
    assert!(matches!(
        outbox.preflight_existing(&request, &id("sealed-event-1"), &hex('c'), &hex('b')),
        Err(CommunicationActionOutboxError::IdempotencyCollision)
    ));
    assert!(matches!(
        outbox.preflight_existing(&request, &id("sealed-event-1"), &hex('a'), &hex('c')),
        Err(CommunicationActionOutboxError::IdempotencyCollision)
    ));
}

#[test]
fn stale_session_cancellation_epoch_and_expiry_fail_closed() {
    let session = id("installation-5");
    let request = request("authority sentinel");
    let mut outbox = CommunicationActionOutbox::new(session.clone());

    assert!(matches!(
        outbox.prepare(
            &request,
            id("sealed-event-1"),
            hex('a'),
            hex('b'),
            &id("wrong-installation"),
            2,
            false,
            time("2026-08-11T12:00:00Z")
        ),
        Err(CommunicationActionOutboxError::InactiveSession)
    ));
    assert!(matches!(
        outbox.prepare(
            &request,
            id("sealed-event-1"),
            hex('a'),
            hex('b'),
            &session,
            3,
            false,
            time("2026-08-11T12:00:00Z")
        ),
        Err(CommunicationActionOutboxError::Cancelled)
    ));
    assert!(matches!(
        outbox.prepare(
            &request,
            id("sealed-event-1"),
            hex('a'),
            hex('b'),
            &session,
            2,
            false,
            time("2026-08-11T13:00:01Z")
        ),
        Err(CommunicationActionOutboxError::Expired)
    ));
}

#[test]
fn encrypted_disk_and_body_free_diagnostics_do_not_leak_semantic_content() {
    const BODY: &str = "PLAINTEXT-BODY-MUST-NOT-APPEAR";
    const SECRET: &str = "PASSPHRASE-MUST-NOT-APPEAR";
    const PATH_CANARY: &str = "/Users/example/private/repository";
    const RAW_EVENT: &str = "{\"kind\":9,\"content\":\"raw-event\"}";

    let session = id("installation-encrypted");
    let request = request(BODY);
    let passphrase = SecretString::from(SECRET.to_owned());
    let temp = tempfile::tempdir().expect("temporary directory");
    let path = temp.path().join("communication-actions.age");
    let mut outbox = CommunicationActionOutbox::load_encrypted(
        session.clone(),
        path.clone(),
        passphrase.clone(),
    )
    .expect("create encrypted outbox");
    let receipt = prepare(&mut outbox, &request, &session);

    let ciphertext = std::fs::read(&path).expect("read ciphertext");
    for canary in [BODY, SECRET, PATH_CANARY, RAW_EVENT] {
        assert!(
            !ciphertext
                .windows(canary.len())
                .any(|window| window == canary.as_bytes()),
            "ciphertext must not reveal a canary"
        );
        assert!(!format!("{receipt:?}").contains(canary));
    }
    assert!(!format!("{:?}", CommunicationActionOutboxError::Persistence).contains(BODY));

    let reloaded = CommunicationActionOutbox::load_encrypted(session, path, passphrase)
        .expect("reload encrypted outbox");
    let entries = reloaded.reconciliation_entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].row().request, request);
    let debug = format!("{:?}", entries[0]);
    assert!(!debug.contains(BODY));
    assert!(!debug.contains("operation"));
}

#[test]
fn restart_reconciliation_returns_only_nonterminal_rows_in_fair_order() {
    let session = id("installation-reconcile");
    let passphrase = SecretString::from("reconcile passphrase".to_owned());
    let temp = tempfile::tempdir().expect("temporary directory");
    let path = temp.path().join("communication-actions.age");
    let mut outbox = CommunicationActionOutbox::load_encrypted(
        session.clone(),
        path.clone(),
        passphrase.clone(),
    )
    .expect("create outbox");

    let first = request("first action");
    prepare(&mut outbox, &first, &session);
    let mut second = request("second action");
    second.action_id = id("action-2");
    second.action_fingerprint = second
        .derive_action_fingerprint()
        .expect("second fingerprint");
    second.idempotency_key = second.derive_idempotency_key().expect("second key");
    outbox
        .prepare(
            &second,
            id("sealed-event-2"),
            hex('b'),
            hex('c'),
            &session,
            2,
            false,
            time("2026-08-11T12:00:00Z"),
        )
        .expect("prepare second");
    outbox
        .mark_submitted(
            &second.idempotency_key,
            &session,
            2,
            false,
            time("2026-08-11T12:00:01Z"),
        )
        .expect("submit second");

    let before = outbox.reconciliation_entries();
    assert_eq!(before.len(), 2);
    outbox
        .advance_reconcile_cursor(before[0].created_order)
        .expect("advance cursor");
    let rotated = outbox.reconciliation_entries();
    assert_eq!(
        rotated[0].row().request.idempotency_key,
        second.idempotency_key
    );

    outbox
        .fail_before_submission(&first.idempotency_key, time("2026-08-11T12:00:02Z"))
        .expect("terminalize first");
    let reloaded = CommunicationActionOutbox::load_encrypted(session, path, passphrase)
        .expect("reload outbox");
    let pending = reloaded.reconciliation_entries();
    assert_eq!(pending.len(), 1);
    assert_eq!(
        pending[0].row().request.idempotency_key,
        second.idempotency_key
    );
    assert_eq!(
        pending[0].row().state,
        CommunicationActionOutboxStateV1::Submitted
    );
}

#[test]
fn persist_failure_rolls_back_the_in_memory_transition() {
    let session = id("installation-rollback");
    let passphrase = SecretString::from("rollback passphrase".to_owned());
    let temp = tempfile::tempdir().expect("temporary directory");
    let path = temp.path().join("communication-actions.age");
    let mut outbox = CommunicationActionOutbox::load_encrypted(session.clone(), path, passphrase)
        .expect("create outbox");
    let request = request("rollback body");
    prepare(&mut outbox, &request, &session);

    outbox.persistence_path = Some(temp.path().join("directory-target"));
    std::fs::create_dir(outbox.persistence_path.as_ref().expect("path"))
        .expect("create invalid file target");
    assert!(matches!(
        outbox.mark_submitted(
            &request.idempotency_key,
            &session,
            2,
            false,
            time("2026-08-11T12:00:01Z")
        ),
        Err(CommunicationActionOutboxError::Persistence)
    ));
    assert_eq!(
        outbox
            .entries
            .get(request.idempotency_key.as_str())
            .expect("retained entry")
            .row
            .state,
        CommunicationActionOutboxStateV1::Prepared
    );
}

#[test]
fn invalid_timestamp_transition_leaves_the_prepared_row_unchanged() {
    let session = id("installation-invalid-transition");
    let request = request("timestamp rollback body");
    let mut outbox = CommunicationActionOutbox::new(session.clone());
    prepare(&mut outbox, &request, &session);

    assert!(matches!(
        outbox.mark_submitted(
            &request.idempotency_key,
            &session,
            2,
            false,
            time("2026-08-11T11:59:59Z")
        ),
        Err(CommunicationActionOutboxError::InvalidTransition)
    ));
    assert_eq!(
        outbox
            .entries
            .get(request.idempotency_key.as_str())
            .expect("retained entry")
            .row
            .state,
        CommunicationActionOutboxStateV1::Prepared
    );
}

#[test]
fn protocol_fingerprint_validation_remains_the_first_boundary() {
    let session = id("installation-invalid");
    let mut request = request("valid body");
    request.action_fingerprint = sha('f');
    assert!(matches!(
        request.validate(),
        Err(CommunicationContractError::Binding)
    ));

    let mut outbox = CommunicationActionOutbox::new(session.clone());
    assert!(matches!(
        outbox.prepare(
            &request,
            id("sealed-event-1"),
            hex('a'),
            hex('b'),
            &session,
            2,
            false,
            time("2026-08-11T12:00:00Z")
        ),
        Err(CommunicationActionOutboxError::InvalidRequest)
    ));
}

#[test]
fn acceptance_is_bound_to_the_exact_expected_event_id() {
    let session = id("installation-exact-event");
    let request = request("exact event sentinel");
    let mut outbox = CommunicationActionOutbox::new(session.clone());
    prepare(&mut outbox, &request, &session);
    outbox
        .mark_submitted(
            &request.idempotency_key,
            &session,
            2,
            false,
            time("2026-08-11T12:00:01Z"),
        )
        .expect("submit exact event");

    assert!(matches!(
        outbox.mark_accepted(
            &request.idempotency_key,
            hex('c'),
            id("publication-receipt-wrong"),
            time("2026-08-11T12:00:02Z")
        ),
        Err(CommunicationActionOutboxError::IdempotencyCollision)
    ));
    assert_eq!(
        outbox
            .row_for_submission(&request.idempotency_key)
            .expect("wrong acceptance leaves exact row retryable")
            .state,
        CommunicationActionOutboxStateV1::Submitted
    );

    outbox
        .mark_publication_unknown(&request.idempotency_key)
        .expect("record uncertain relay result");
    let accepted = outbox
        .mark_accepted(
            &request.idempotency_key,
            hex('b'),
            id("publication-receipt-exact"),
            time("2026-08-11T12:00:03Z"),
        )
        .expect("accept exact event after reconciliation");
    assert_eq!(accepted.state, CommunicationActionOutboxStateV1::Accepted);
    assert_eq!(accepted.expected_event_id, hex('b'));
}

#[test]
fn terminal_tombstones_are_body_free_and_preserve_exact_replay_identity() {
    const BODY: &str = "TOMBSTONE-BODY-MUST-NOT-APPEAR";
    const HANDLE: &str = "sealed-event-capability-must-not-appear";

    let session = id("installation-tombstone");
    let request = request(BODY);
    let mut outbox = CommunicationActionOutbox::new(session.clone());
    outbox
        .prepare(
            &request,
            id(HANDLE),
            hex('a'),
            hex('b'),
            &session,
            2,
            false,
            time("2026-08-11T12:00:00Z"),
        )
        .expect("prepare terminal action");
    let failed = outbox
        .fail_before_submission(&request.idempotency_key, time("2026-08-11T12:00:01Z"))
        .expect("compact terminal action");

    assert!(outbox.entries.is_empty());
    assert_eq!(outbox.tombstones.len(), 1);
    let encoded = serde_json::to_string(&outbox.tombstones).expect("serialize tombstone");
    assert!(!encoded.contains(BODY));
    assert!(!encoded.contains(HANDLE));

    let replay = outbox
        .preflight_existing(&request, &id(HANDLE), &hex('a'), &hex('b'))
        .expect("exact tombstone replay")
        .expect("terminal receipt");
    assert_eq!(replay, failed);
    assert!(matches!(
        outbox.preflight_existing(&request, &id("different-handle"), &hex('a'), &hex('b')),
        Err(CommunicationActionOutboxError::IdempotencyCollision)
    ));
}

#[test]
fn accepted_terminal_retains_private_cleanup_authority_until_acknowledged() {
    const BODY: &str = "CLEANUP-BODY-MUST-NOT-APPEAR";
    const HANDLE: &str = "sealed-event-cleanup-capability";
    let session = id("installation-cleanup");
    let request = request(BODY);
    let mut outbox = CommunicationActionOutbox::new(session.clone());
    outbox
        .prepare(
            &request,
            id(HANDLE),
            hex('a'),
            hex('b'),
            &session,
            2,
            false,
            time("2026-08-11T12:00:00Z"),
        )
        .expect("prepare");
    outbox
        .mark_submitted(&request.idempotency_key, &session, 2, false, time("2026-08-11T12:00:01Z"))
        .expect("submit");
    outbox
        .mark_accepted(
            &request.idempotency_key,
            hex('b'),
            id("cleanup-publication-receipt"),
            time("2026-08-11T12:00:02Z"),
        )
        .expect("accept");

    let cleanup = outbox
        .terminal_cleanup_for_request(&request)
        .expect("cleanup lookup")
        .expect("pending cleanup");
    assert_eq!(cleanup.sealed_event_handle, id(HANDLE));
    assert_eq!(cleanup.expected_event_id, hex('b'));
    assert!(!format!("{cleanup:?}").contains(HANDLE));
    assert!(!serde_json::to_string(&outbox.tombstones).unwrap().contains(BODY));

    outbox
        .complete_terminal_cleanup(&request.idempotency_key)
        .expect("acknowledge cleanup");
    assert!(outbox
        .terminal_cleanup_for_request(&request)
        .expect("cleanup lookup")
        .is_none());
}

#[test]
fn failed_terminal_retains_never_submitted_cleanup_authority_until_acknowledged() {
    let session = id("installation-failed-cleanup");
    let request = request("failed cleanup body");
    let mut outbox = CommunicationActionOutbox::new(session.clone());
    prepare(&mut outbox, &request, &session);
    outbox
        .fail_before_submission(&request.idempotency_key, time("2026-08-11T12:00:01Z"))
        .expect("fail before submission");

    let cleanup = outbox
        .terminal_cleanup_for_request(&request)
        .expect("cleanup lookup")
        .expect("failed cleanup remains pending");
    assert_eq!(cleanup.terminal, CommunicationActionOutboxStateV1::Failed);
    assert_eq!(cleanup.sealed_event_handle, id("sealed-event-1"));
    outbox
        .complete_terminal_cleanup(&request.idempotency_key)
        .expect("acknowledge cleanup");
    assert!(outbox
        .terminal_cleanup_for_request(&request)
        .expect("cleanup lookup")
        .is_none());
}

#[test]
fn expired_tombstone_with_pending_cleanup_is_not_pruned() {
    let session = id("installation-expired-cleanup");
    let request = request("expired cleanup body");
    let mut outbox = CommunicationActionOutbox::new(session.clone());
    prepare(&mut outbox, &request, &session);
    outbox
        .fail_before_submission(&request.idempotency_key, time("2026-08-11T12:00:01Z"))
        .expect("fail before submission");

    outbox.prune_expired_tombstones(&time("2026-08-11T14:00:00Z"));
    assert!(outbox
        .terminal_cleanup_for_request(&request)
        .expect("cleanup lookup")
        .is_some());
    outbox
        .complete_terminal_cleanup(&request.idempotency_key)
        .expect("acknowledge cleanup");
    outbox.prune_expired_tombstones(&time("2026-08-11T14:00:00Z"));
    assert!(outbox.tombstones.is_empty());
}

#[test]
fn request_preflight_reuses_frozen_nonterminal_and_terminal_identity() {
    let session = id("installation-request-preflight");
    let request = request("request-only preflight sentinel");
    let mut outbox = CommunicationActionOutbox::new(session.clone());
    prepare(&mut outbox, &request, &session);

    let CommunicationActionRequestPreflight::Nonterminal(prepared) = outbox
        .preflight_request(&request)
        .expect("preflight prepared request")
        .expect("prepared request exists")
    else {
        panic!("expected nonterminal row");
    };
    assert_eq!(prepared.sealed_event_handle, id("sealed-event-1"));
    assert_eq!(prepared.exact_event_sha256, hex('a'));
    assert_eq!(prepared.expected_event_id, hex('b'));

    outbox
        .mark_submitted(
            &request.idempotency_key,
            &session,
            2,
            false,
            time("2026-08-11T12:00:01Z"),
        )
        .expect("submit action");
    outbox
        .mark_publication_unknown(&request.idempotency_key)
        .expect("record ambiguous publication");
    let CommunicationActionRequestPreflight::Nonterminal(ambiguous) = outbox
        .preflight_request(&request)
        .expect("preflight ambiguous request")
        .expect("ambiguous request exists")
    else {
        panic!("expected nonterminal row");
    };
    assert_eq!(
        ambiguous.state,
        CommunicationActionOutboxStateV1::PublicationUnknown
    );
    assert_eq!(ambiguous.sealed_event_handle, id("sealed-event-1"));

    outbox
        .mark_accepted(
            &request.idempotency_key,
            hex('b'),
            id("publication-receipt-request-preflight"),
            time("2026-08-11T12:00:02Z"),
        )
        .expect("accept exact event");
    let CommunicationActionRequestPreflight::Terminal(accepted) = outbox
        .preflight_request(&request)
        .expect("preflight accepted request")
        .expect("accepted request exists")
    else {
        panic!("expected terminal receipt");
    };
    assert_eq!(accepted.state, CommunicationActionOutboxStateV1::Accepted);

    let mut collision = request.clone();
    collision.operation = CommunicationOperationV1::SendMessage {
        body: "changed body".to_owned(),
        reply_to_event_id: None,
        mention_pubkeys: Vec::new(),
        activation_pubkeys: Vec::new(),
        artifact_handles: Vec::new(),
    };
    assert!(matches!(
        outbox.preflight_request(&collision),
        Err(CommunicationActionOutboxError::IdempotencyCollision)
            | Err(CommunicationActionOutboxError::InvalidRequest)
    ));
}

#[test]
fn terminal_compaction_does_not_exhaust_the_nonterminal_capacity() {
    let session = id("installation-capacity");
    let mut outbox = CommunicationActionOutbox::new(session.clone());

    for index in 0..=MAX_NONTERMINAL_OUTBOX_ENTRIES {
        let mut request = request("bounded terminal body");
        request.action_id = id(&format!("terminal-action-{index}"));
        request.action_fingerprint = request
            .derive_action_fingerprint()
            .expect("terminal fingerprint");
        request.idempotency_key = request.derive_idempotency_key().expect("terminal key");
        outbox
            .prepare(
                &request,
                id(&format!("sealed-terminal-{index}")),
                hex('a'),
                hex('b'),
                &session,
                2,
                false,
                time("2026-08-11T12:00:00Z"),
            )
            .expect("terminal records do not consume the active cap");
        outbox
            .fail_before_submission(&request.idempotency_key, time("2026-08-11T12:00:01Z"))
            .expect("compact terminal record");
    }

    assert_eq!(outbox.nonterminal_entry_count(), 0);
    assert_eq!(outbox.tombstones.len(), MAX_NONTERMINAL_OUTBOX_ENTRIES + 1);
}

#[test]
fn outbox_debug_redacts_the_sealed_event_capability() {
    const HANDLE: &str = "sealed-event-super-secret-capability";

    let session = id("installation-debug-redaction");
    let request = request("debug body sentinel");
    let mut outbox = CommunicationActionOutbox::new(session.clone());
    outbox
        .prepare(
            &request,
            id(HANDLE),
            hex('a'),
            hex('b'),
            &session,
            2,
            false,
            time("2026-08-11T12:00:00Z"),
        )
        .expect("prepare redacted row");

    let debug = format!(
        "{:?}",
        outbox
            .row_for_submission(&request.idempotency_key)
            .expect("debug row")
    );
    assert!(!debug.contains(HANDLE));
    assert!(debug.contains("[REDACTED]"));
}
