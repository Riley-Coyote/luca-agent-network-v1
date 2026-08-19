use super::*;
use std::{
    collections::VecDeque,
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread::JoinHandle,
};

use luca_protocol::{
    canonicalize, derive_message_publish_idempotency_key, Hex64, SafeU53, MESSAGE_PUBLISH_PROTOCOL,
};
use nostr::{EventBuilder, Tag, Timestamp};

const CHANNEL: &str = "11111111-1111-4111-8111-111111111111";

#[derive(Default)]
struct FakeRelayState {
    submissions: Vec<String>,
    probes: Vec<String>,
    submit_results: VecDeque<ManagedRelaySubmitOutcome>,
    probe_results: VecDeque<ManagedRelayProbeOutcome>,
}

struct FakeRelayTransport {
    state: Arc<Mutex<FakeRelayState>>,
}

impl ManagedRelayTransport for FakeRelayTransport {
    fn submit_exact(
        &mut self,
        signed_event_json: &str,
        _timeout: Duration,
    ) -> ManagedRelaySubmitOutcome {
        let mut state = self.state.lock().expect("state");
        state.submissions.push(signed_event_json.to_owned());
        state
            .submit_results
            .pop_front()
            .unwrap_or(ManagedRelaySubmitOutcome::Retryable)
    }

    fn probe_exact(
        &mut self,
        signed_event_json: &str,
        _expected_event_id: &str,
        _timeout: Duration,
    ) -> ManagedRelayProbeOutcome {
        let mut state = self.state.lock().expect("state");
        state.probes.push(signed_event_json.to_owned());
        state
            .probe_results
            .pop_front()
            .unwrap_or(ManagedRelayProbeOutcome::Retryable)
    }
}

struct Fixture {
    resident: Keys,
    request: ManagedMessagePublishRequestV1,
    store: Arc<Mutex<ManagedDispatchStore>>,
    outbox: ManagedMessageOutbox,
    session: OpaqueId,
    exact_event_json: String,
    event_id: String,
    dispatch_path: PathBuf,
}

fn fixture() -> Fixture {
    fixture_with(None)
}

/// The same fixture, optionally with the final already placed inside an
/// exchange — request and frozen bytes both carrying the turn tag.
fn fixture_with(exchange: Option<luca_protocol::ExchangeTurnTag>) -> Fixture {
    let owner = Keys::parse(&"91".repeat(32)).expect("owner");
    let resident = Keys::parse(&"92".repeat(32)).expect("resident");
    let trigger = EventBuilder::new(Kind::Custom(9), "owner trigger")
        .tags([
            Tag::parse(["h", CHANNEL]).expect("h"),
            Tag::public_key(owner.public_key()),
            Tag::public_key(resident.public_key()),
        ])
        .custom_created_at(Timestamp::from(100))
        .sign_with_keys(&owner)
        .expect("trigger");
    let resident_pubkey = Hex64::parse(resident.public_key().to_hex()).expect("resident");
    let receipt = OpaqueId::parse(trigger.id.to_hex()).expect("receipt");
    let request = ManagedMessagePublishRequestV1 {
        protocol: MESSAGE_PUBLISH_PROTOCOL.to_owned(),
        turn_id: OpaqueId::parse(trigger.id.to_hex()).expect("turn"),
        idempotency_key: derive_message_publish_idempotency_key(&receipt, &resident_pubkey)
            .expect("idempotency"),
        owner_pubkey: Hex64::parse(owner.public_key().to_hex()).expect("owner"),
        resident_pubkey,
        conversation_id: OpaqueId::parse(CHANNEL).expect("channel"),
        thread_id: Some(
            OpaqueId::parse(format!("thread:{}", trigger.id.to_hex())).expect("thread"),
        ),
        root_event_id: Some(Hex64::parse(trigger.id.to_hex()).expect("root")),
        reply_event_id: Some(Hex64::parse(trigger.id.to_hex()).expect("reply")),
        response_surface: Some(luca_protocol::ManagedResponseSurfaceV1::Timeline),
        resolved_p_tags: vec![Hex64::parse(owner.public_key().to_hex()).expect("owner")],
        final_draft: "exact resident final".to_owned(),
        dispatch_receipt_id: receipt,
        cancellation_epoch: SafeU53::new(7).expect("epoch"),
        exchange,
        bucket_hint: None,
    };
    let final_event = EventBuilder::new(Kind::Custom(9), request.final_draft.clone())
        .tags(super::super::managed_message_event::managed_message_tags(&request).expect("tags"))
        .custom_created_at(Timestamp::from(101))
        .sign_with_keys(&resident)
        .expect("final");
    let exact_event_json =
        String::from_utf8(canonicalize(&final_event).expect("canonical")).expect("UTF-8");
    let event_id = final_event.id.to_hex();
    let frozen = super::super::managed_message_outbox::FrozenManagedMessageEvent::parse(
        exact_event_json.clone(),
        &request,
    )
    .expect("frozen");
    let temp = tempfile::tempdir().expect("temp");
    let dispatch_path = temp.keep().join("dispatches.json");
    let mut store = ManagedDispatchStore::load(dispatch_path.clone()).expect("store");
    store
        .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
        .expect("stage");
    store
        .activate_session(&resident.public_key().to_hex(), 7)
        .expect("session");
    let store = Arc::new(Mutex::new(store));
    let session = OpaqueId::parse("installation-publisher").expect("installation");
    let mut outbox = ManagedMessageOutbox::new(session.clone());
    outbox
        .prepare(&request, frozen, &session, 7, false)
        .expect("prepare");
    Fixture {
        resident,
        request,
        store,
        outbox,
        session,
        exact_event_json,
        event_id,
        dispatch_path,
    }
}

fn publisher(fixture: &Fixture, state: Arc<Mutex<FakeRelayState>>) -> ManagedMessagePublisher {
    ManagedMessagePublisher::with_transport(
        fixture.resident.public_key().to_hex(),
        Arc::clone(&fixture.store),
        Box::new(FakeRelayTransport { state }),
    )
}

fn one_shot_http_response(
    status: u16,
    body: Vec<u8>,
    expected_path: Option<&'static str>,
) -> (String, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test relay");
    let address = listener.local_addr().expect("test relay address");
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept request");
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("read timeout");
        let mut request = Vec::new();
        let mut chunk = [0_u8; 1024];
        let (header_end, content_length) = loop {
            let read = stream.read(&mut chunk).expect("read request");
            assert_ne!(read, 0, "request closed before headers");
            request.extend_from_slice(&chunk[..read]);
            if let Some(index) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                let header_end = index + 4;
                let headers = String::from_utf8_lossy(&request[..header_end]);
                if let Some(expected_path) = expected_path {
                    assert_eq!(
                        headers
                            .lines()
                            .next()
                            .and_then(|line| line.split_whitespace().nth(1)),
                        Some(expected_path)
                    );
                }
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().expect("content length"))
                    })
                    .unwrap_or(0);
                break (header_end, content_length);
            }
        };
        while request.len() < header_end + content_length {
            let read = stream.read(&mut chunk).expect("read request body");
            assert_ne!(read, 0, "request closed before body");
            request.extend_from_slice(&chunk[..read]);
        }
        let reason = if status == 200 { "OK" } else { "Test" };
        let response = format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream
            .write_all(response.as_bytes())
            .expect("write headers");
        stream.write_all(&body).expect("write body");
        stream.flush().expect("flush response");
    });
    (format!("http://{address}"), handle)
}

#[test]
fn managed_publisher_submits_retained_exact_bytes_and_finalizes_both_stores() {
    let mut fixture = fixture();
    let state = Arc::new(Mutex::new(FakeRelayState {
        submit_results: VecDeque::from([ManagedRelaySubmitOutcome::Response(
            crate::relay::SubmitEventResponse {
                event_id: fixture.event_id.clone(),
                accepted: true,
                message: "accepted".into(),
            },
        )]),
        ..Default::default()
    }));
    let mut publisher = publisher(&fixture, Arc::clone(&state));
    publisher
        .authorize_request(&fixture.request, 101)
        .expect("authorize");
    publisher
        .publish_prepared(&fixture.request, &mut fixture.outbox, &fixture.session)
        .expect("publish");
    assert_eq!(
        state.lock().expect("state").submissions,
        vec![fixture.exact_event_json.clone()]
    );
    assert!(matches!(
        fixture
            .outbox
            .accepted_result(&fixture.request.idempotency_key)
            .expect("result"),
        luca_protocol::ManagedMessagePublishResultV1::Published { .. }
    ));
    assert!(fixture.outbox.reconciliation_entries().is_empty());
}

#[test]
fn managed_publisher_response_loss_reconciles_by_exact_id_and_bytes() {
    let mut fixture = fixture();
    let first_state = Arc::new(Mutex::new(FakeRelayState {
        submit_results: VecDeque::from([ManagedRelaySubmitOutcome::Retryable]),
        ..Default::default()
    }));
    let mut first = publisher(&fixture, Arc::clone(&first_state));
    first
        .authorize_request(&fixture.request, 101)
        .expect("authorize");
    assert_eq!(
        first.publish_prepared(&fixture.request, &mut fixture.outbox, &fixture.session),
        Err(ManagedPublicationAuthorityError::Unavailable)
    );

    let restart_state = Arc::new(Mutex::new(FakeRelayState {
        probe_results: VecDeque::from([ManagedRelayProbeOutcome::Absent]),
        submit_results: VecDeque::from([ManagedRelaySubmitOutcome::Response(
            crate::relay::SubmitEventResponse {
                event_id: fixture.event_id.clone(),
                accepted: true,
                message: "accepted".into(),
            },
        )]),
        ..Default::default()
    }));
    let mut restarted = publisher(&fixture, Arc::clone(&restart_state));
    restarted
        .reconcile_on_start(&mut fixture.outbox, &fixture.session)
        .expect("reconcile");
    let state = restart_state.lock().expect("state");
    assert_eq!(state.probes, vec![fixture.exact_event_json.clone()]);
    assert_eq!(state.submissions, vec![fixture.exact_event_json]);
}

#[test]
fn managed_http_submit_classifies_only_bad_request_as_terminal() {
    for status in [401, 403, 404, 408, 409, 413, 422, 429, 500, 503] {
        let (relay_url, server) =
            one_shot_http_response(status, b"SECRET-SERVER-BODY".to_vec(), Some("/events"));
        let resident = Keys::parse(&"93".repeat(32)).expect("resident");
        let mut transport =
            HttpManagedRelayTransport::new(resident, &relay_url, None).expect("transport");
        assert!(matches!(
            transport.submit_exact("{}", Duration::from_secs(2)),
            ManagedRelaySubmitOutcome::Retryable
        ));
        server.join().expect("server");
    }

    let (relay_url, server) =
        one_shot_http_response(400, b"SECRET-INVALID-EVENT-BODY".to_vec(), Some("/events"));
    let resident = Keys::parse(&"94".repeat(32)).expect("resident");
    let mut transport =
        HttpManagedRelayTransport::new(resident, &relay_url, None).expect("transport");
    assert!(matches!(
        transport.submit_exact("{}", Duration::from_secs(2)),
        ManagedRelaySubmitOutcome::TerminalRejected { .. }
    ));
    server.join().expect("server");
}

#[test]
fn managed_http_submit_bounds_success_response_before_json_parse() {
    let (relay_url, server) = one_shot_http_response(
        200,
        vec![b'x'; usize::try_from(MAX_RELAY_RESPONSE_BYTES + 1).expect("size")],
        Some("/events"),
    );
    let resident = Keys::parse(&"95".repeat(32)).expect("resident");
    let mut transport =
        HttpManagedRelayTransport::new(resident, &relay_url, None).expect("transport");
    assert!(matches!(
        transport.submit_exact("{}", Duration::from_secs(2)),
        ManagedRelaySubmitOutcome::Retryable
    ));
    server.join().expect("server");
}

#[test]
fn managed_http_probe_uses_payload_bound_mode_and_typed_absence() {
    let event_id = "ab".repeat(32);
    let response = serde_json::to_vec(&crate::relay::SubmitEventResponse {
        event_id: event_id.clone(),
        accepted: false,
        message: "absent:".into(),
    })
    .expect("response");
    let (relay_url, server) = one_shot_http_response(200, response, Some("/events?mode=probe"));
    let resident = Keys::parse(&"96".repeat(32)).expect("resident");
    let mut transport =
        HttpManagedRelayTransport::new(resident, &relay_url, None).expect("transport");
    assert!(matches!(
        transport.probe_exact("{}", &event_id, Duration::from_secs(2)),
        ManagedRelayProbeOutcome::Absent
    ));
    server.join().expect("server");
}

#[test]
fn ambiguous_dispatch_lookup_is_denied_without_detail() {
    assert_eq!(
        ManagedMessagePublisher::map_dispatch_error(DispatchAuthorizationError::Ambiguous),
        ManagedPublicationAuthorityError::Denied
    );
}

#[test]
fn terminal_bad_request_rejects_and_finalizes_both_stores() {
    let mut fixture = fixture();
    let state = Arc::new(Mutex::new(FakeRelayState {
        submit_results: VecDeque::from([ManagedRelaySubmitOutcome::TerminalRejected {
            reason: None,
        }]),
        ..Default::default()
    }));
    let mut publisher = publisher(&fixture, state);
    publisher
        .authorize_request(&fixture.request, 101)
        .expect("authorize");
    assert_eq!(
        publisher.publish_prepared(&fixture.request, &mut fixture.outbox, &fixture.session),
        Err(ManagedPublicationAuthorityError::Denied)
    );
    assert!(fixture.outbox.reconciliation_entries().is_empty());
    assert_eq!(
        fixture
            .store
            .lock()
            .expect("store")
            .authorize_reconciliation(&fixture.request, &fixture.event_id, 101)
            .expect("terminal state"),
        ManagedDispatchReconciliation::Rejected
    );
}

#[test]
fn terminal_probe_rejection_serializes_late_cancellation_through_outbox_finalization() {
    let mut fixture = fixture();
    let first_state = Arc::new(Mutex::new(FakeRelayState {
        submit_results: VecDeque::from([ManagedRelaySubmitOutcome::Retryable]),
        ..Default::default()
    }));
    let mut first = publisher(&fixture, first_state);
    first
        .authorize_request(&fixture.request, 101)
        .expect("authorize");
    assert_eq!(
        first.publish_prepared(&fixture.request, &mut fixture.outbox, &fixture.session),
        Err(ManagedPublicationAuthorityError::Unavailable)
    );
    let entry = fixture
        .outbox
        .reconciliation_entries()
        .into_iter()
        .next()
        .expect("submitted entry");

    let (decision_tx, decision_rx) = std::sync::mpsc::channel();
    let (attempt_tx, attempt_rx) = std::sync::mpsc::channel();
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    let cancel_store = Arc::clone(&fixture.store);
    let owner = fixture.request.owner_pubkey.as_str().to_owned();
    let conversation = fixture.request.conversation_id.as_str().to_owned();
    let thread = fixture
        .request
        .thread_id
        .as_ref()
        .map(|value| value.as_str().to_owned());
    let resident = fixture.request.resident_pubkey.as_str().to_owned();
    let cancellation = std::thread::spawn(move || {
        decision_rx.recv().expect("dispatch decision");
        attempt_tx.send(()).expect("cancellation attempt");
        let cancelled = cancel_store
            .lock()
            .expect("cancel store")
            .cancel_matching(&owner, &conversation, thread.as_deref(), &[resident])
            .expect("late cancel");
        done_tx.send(cancelled).expect("cancel result");
    });

    let state = Arc::new(Mutex::new(FakeRelayState::default()));
    let mut restarted = publisher(&fixture, state);
    let decision = restarted
        .settle_probe_terminal_rejection_with(&entry, &mut fixture.outbox, 101, || {
            decision_tx.send(()).expect("release cancellation");
            attempt_rx.recv().expect("cancellation is waiting");
            assert!(matches!(
                done_rx.try_recv(),
                Err(std::sync::mpsc::TryRecvError::Empty)
            ));
        })
        .expect("settle terminal rejection");
    assert_eq!(decision, ManagedDispatchReconciliation::Rejected);
    assert_eq!(done_rx.recv().expect("late cancellation result"), 0);
    cancellation.join().expect("join cancellation");
    assert_eq!(
        fixture
            .outbox
            .preflight_existing(&fixture.request)
            .expect("outbox receipt")
            .expect("retained outbox row")
            .state,
        ManagedOutboxState::Rejected,
        "the outbox must retain the same terminal decision as dispatch authority"
    );
    assert!(fixture.outbox.reconciliation_entries().is_empty());
    assert_eq!(
        fixture
            .store
            .lock()
            .expect("store")
            .authorize_reconciliation(&fixture.request, &fixture.event_id, 101)
            .expect("terminal state"),
        ManagedDispatchReconciliation::Rejected
    );
}

#[test]
fn terminal_probe_rejection_preserves_cancellation_that_linearized_first() {
    let mut fixture = fixture();
    let first_state = Arc::new(Mutex::new(FakeRelayState {
        submit_results: VecDeque::from([ManagedRelaySubmitOutcome::Retryable]),
        ..Default::default()
    }));
    let mut first = publisher(&fixture, first_state);
    first
        .authorize_request(&fixture.request, 101)
        .expect("authorize");
    assert_eq!(
        first.publish_prepared(&fixture.request, &mut fixture.outbox, &fixture.session),
        Err(ManagedPublicationAuthorityError::Unavailable)
    );
    assert_eq!(
        fixture
            .store
            .lock()
            .expect("store")
            .cancel_matching(
                fixture.request.owner_pubkey.as_str(),
                fixture.request.conversation_id.as_str(),
                fixture.request.thread_id.as_ref().map(OpaqueId::as_str),
                &[fixture.request.resident_pubkey.as_str().to_owned()],
            )
            .expect("cancel"),
        1
    );
    let entry = fixture
        .outbox
        .reconciliation_entries()
        .into_iter()
        .next()
        .expect("submitted entry");
    let state = Arc::new(Mutex::new(FakeRelayState::default()));
    let mut restarted = publisher(&fixture, state);
    assert_eq!(
        restarted
            .settle_probe_terminal_rejection(&entry, &mut fixture.outbox, 101)
            .expect("settle cancellation"),
        ManagedDispatchReconciliation::Cancelled
    );
    assert_eq!(
        fixture
            .outbox
            .preflight_existing(&fixture.request)
            .expect("outbox receipt")
            .expect("retained outbox row")
            .state,
        ManagedOutboxState::Cancelled,
        "a cancellation that linearized first must remain the shared terminal decision"
    );
    assert_eq!(
        fixture
            .store
            .lock()
            .expect("store")
            .authorize_reconciliation(&fixture.request, &fixture.event_id, 101)
            .expect("terminal state"),
        ManagedDispatchReconciliation::Cancelled
    );
    assert!(fixture.outbox.reconciliation_entries().is_empty());
}

#[test]
fn prepared_cancelled_restart_never_queries_or_submits() {
    let mut fixture = fixture();
    assert_eq!(
        fixture
            .store
            .lock()
            .expect("store")
            .cancel_matching(
                fixture.request.owner_pubkey.as_str(),
                fixture.request.conversation_id.as_str(),
                fixture.request.thread_id.as_ref().map(OpaqueId::as_str),
                &[fixture.request.resident_pubkey.as_str().to_owned()],
            )
            .expect("cancel"),
        1
    );
    let state = Arc::new(Mutex::new(FakeRelayState::default()));
    let mut restarted = publisher(&fixture, Arc::clone(&state));
    restarted
        .reconcile_on_start(&mut fixture.outbox, &fixture.session)
        .expect("reconcile cancellation");
    let state = state.lock().expect("state");
    assert!(state.probes.is_empty());
    assert!(state.submissions.is_empty());
    assert!(fixture.outbox.reconciliation_entries().is_empty());
}

#[test]
fn cancelled_ambiguous_submission_probes_presence_and_records_publication() {
    let mut fixture = fixture();
    let first_state = Arc::new(Mutex::new(FakeRelayState {
        submit_results: VecDeque::from([ManagedRelaySubmitOutcome::Retryable]),
        ..Default::default()
    }));
    let mut first = publisher(&fixture, first_state);
    first
        .authorize_request(&fixture.request, 101)
        .expect("authorize");
    assert_eq!(
        first.publish_prepared(&fixture.request, &mut fixture.outbox, &fixture.session),
        Err(ManagedPublicationAuthorityError::Unavailable)
    );
    assert_eq!(
        fixture
            .store
            .lock()
            .expect("store")
            .cancel_matching(
                fixture.request.owner_pubkey.as_str(),
                fixture.request.conversation_id.as_str(),
                fixture.request.thread_id.as_ref().map(OpaqueId::as_str),
                &[fixture.request.resident_pubkey.as_str().to_owned()],
            )
            .expect("cancel after submit"),
        1
    );

    let restart_state = Arc::new(Mutex::new(FakeRelayState {
        probe_results: VecDeque::from([ManagedRelayProbeOutcome::Present(
            crate::relay::SubmitEventResponse {
                event_id: fixture.event_id.clone(),
                accepted: true,
                message: "duplicate:".into(),
            },
        )]),
        ..Default::default()
    }));
    let mut restarted = publisher(&fixture, Arc::clone(&restart_state));
    restarted
        .reconcile_on_start(&mut fixture.outbox, &fixture.session)
        .expect("reconcile exact submission");
    let state = restart_state.lock().expect("state");
    assert_eq!(state.probes, vec![fixture.exact_event_json.clone()]);
    assert!(state.submissions.is_empty());
}

#[test]
fn cancelled_ambiguous_submission_probes_absence_and_never_resubmits() {
    let mut fixture = fixture();
    let first_state = Arc::new(Mutex::new(FakeRelayState {
        submit_results: VecDeque::from([ManagedRelaySubmitOutcome::Retryable]),
        ..Default::default()
    }));
    let mut first = publisher(&fixture, first_state);
    first
        .authorize_request(&fixture.request, 101)
        .expect("authorize");
    assert_eq!(
        first.publish_prepared(&fixture.request, &mut fixture.outbox, &fixture.session),
        Err(ManagedPublicationAuthorityError::Unavailable)
    );

    let mut persisted: serde_json::Value = serde_json::from_slice(
        &std::fs::read(&fixture.dispatch_path).expect("read dispatch store"),
    )
    .expect("dispatch JSON");
    persisted["dispatches"][0]["state"] = serde_json::json!("cancelled");
    persisted["dispatches"][0]["outbox_finalized"] = serde_json::json!(false);
    std::fs::write(
        &fixture.dispatch_path,
        serde_json::to_vec(&persisted).expect("serialize"),
    )
    .expect("write legacy race state");
    fixture.store = Arc::new(Mutex::new(
        ManagedDispatchStore::load(fixture.dispatch_path.clone()).expect("reload"),
    ));

    let restart_state = Arc::new(Mutex::new(FakeRelayState {
        probe_results: VecDeque::from([ManagedRelayProbeOutcome::Absent]),
        ..Default::default()
    }));
    let mut restarted = publisher(&fixture, Arc::clone(&restart_state));
    restarted
        .reconcile_on_start(&mut fixture.outbox, &fixture.session)
        .expect("reconcile cancelled absence");
    let state = restart_state.lock().expect("state");
    assert_eq!(state.probes, vec![fixture.exact_event_json.clone()]);
    assert!(state.submissions.is_empty());
    assert!(fixture.outbox.reconciliation_entries().is_empty());
    assert_eq!(
        fixture
            .store
            .lock()
            .expect("store")
            .authorize_reconciliation(&fixture.request, &fixture.event_id, 101)
            .expect("terminal state"),
        ManagedDispatchReconciliation::Cancelled
    );
}

#[test]
fn accepted_outbox_can_finish_after_safely_compacted_dispatch() {
    let mut fixture = fixture();
    fixture
        .outbox
        .mark_submitted(&fixture.request.idempotency_key, &fixture.session, false)
        .expect("submitted");
    fixture
        .outbox
        .mark_accepted(
            &fixture.request.idempotency_key,
            OpaqueId::parse(fixture.event_id.clone()).expect("receipt"),
        )
        .expect("accepted");
    let empty_store = Arc::new(Mutex::new(
        ManagedDispatchStore::load(
            tempfile::tempdir()
                .expect("temp")
                .keep()
                .join("dispatches.json"),
        )
        .expect("empty store"),
    ));
    let state = Arc::new(Mutex::new(FakeRelayState::default()));
    let mut publisher = ManagedMessagePublisher::with_transport(
        fixture.resident.public_key().to_hex(),
        empty_store,
        Box::new(FakeRelayTransport { state }),
    );
    publisher
        .reconcile_on_start(&mut fixture.outbox, &fixture.session)
        .expect("finish retained acceptance");
    assert!(fixture.outbox.reconciliation_entries().is_empty());
}

#[test]
fn cancelled_outbox_can_finish_after_safely_compacted_dispatch() {
    let mut fixture = fixture();
    fixture
        .outbox
        .cancel_during_reconciliation(&fixture.request.idempotency_key)
        .expect("cancelled");
    let empty_store = Arc::new(Mutex::new(
        ManagedDispatchStore::load(
            tempfile::tempdir()
                .expect("temp")
                .keep()
                .join("dispatches.json"),
        )
        .expect("empty store"),
    ));
    let state = Arc::new(Mutex::new(FakeRelayState::default()));
    let mut publisher = ManagedMessagePublisher::with_transport(
        fixture.resident.public_key().to_hex(),
        empty_store,
        Box::new(FakeRelayTransport { state }),
    );
    publisher
        .reconcile_on_start(&mut fixture.outbox, &fixture.session)
        .expect("finish retained cancellation");
    assert!(fixture.outbox.reconciliation_entries().is_empty());
}

#[path = "managed_message_publisher_exchange_tests.rs"]
mod managed_message_publisher_exchange_tests;
