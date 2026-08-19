use super::*;

// ── the exchange half ───────────────────────────────────────────────────────

/// Records the sentences the room is told; everything else is unreachable in
/// these tests and says so.
#[derive(Default)]
struct NoteRecordingExchangeRelay {
    notes: Arc<Mutex<Vec<String>>>,
    /// The head this relay answers with, when the test seeded one.
    head: Mutex<Option<crate::luca::exchange_store::ExchangeHead>>,
}

impl crate::luca::exchange_relay::ExchangeRelay for NoteRecordingExchangeRelay {
    fn fetch_head(
        &self,
        _exchange_id: &Hex64,
        _owner: &Hex64,
    ) -> Result<
        Option<crate::luca::exchange_store::ExchangeHead>,
        crate::luca::exchange_relay::ExchangeRelayError,
    > {
        Ok(self.head.lock().expect("head").clone())
    }

    fn spent_turns(
        &self,
        _record: &luca_protocol::ExchangeRecordV1,
    ) -> Result<std::collections::BTreeSet<u8>, crate::luca::exchange_relay::ExchangeRelayError>
    {
        Ok(std::collections::BTreeSet::new())
    }

    fn publish_record(
        &self,
        _record: &luca_protocol::ExchangeRecordV1,
        _created_at: u64,
    ) -> Result<Hex64, crate::luca::exchange_relay::ExchangeRelayError> {
        Err(crate::luca::exchange_relay::ExchangeRelayError::Unavailable("not used".to_owned()))
    }

    fn publish_note(
        &self,
        _conversation_id: &OpaqueId,
        content: &str,
    ) -> Result<(), crate::luca::exchange_relay::ExchangeRelayError> {
        self.notes.lock().expect("notes").push(content.to_owned());
        Ok(())
    }

    fn conversation_members(
        &self,
        _conversation_id: &OpaqueId,
    ) -> Result<std::collections::BTreeSet<Hex64>, crate::luca::exchange_relay::ExchangeRelayError>
    {
        Ok(std::collections::BTreeSet::new())
    }

    fn owned_residents(
        &self,
    ) -> Result<std::collections::BTreeSet<Hex64>, crate::luca::exchange_relay::ExchangeRelayError>
    {
        Ok(std::collections::BTreeSet::new())
    }

    fn resolve_resident_name(
        &self,
        _owned: &std::collections::BTreeSet<Hex64>,
        _name: &str,
    ) -> Result<Option<Hex64>, crate::luca::exchange_relay::ExchangeRelayError> {
        Ok(None)
    }

    fn display_name(&self, _pubkey: &Hex64) -> String {
        "Vektor".to_owned()
    }
}

fn exchange_publisher(
    fixture: &Fixture,
    state: Arc<Mutex<FakeRelayState>>,
) -> (ManagedMessagePublisher, Arc<Mutex<Vec<String>>>) {
    exchange_publisher_with_head(fixture, state, None)
}

fn exchange_publisher_with_head(
    fixture: &Fixture,
    state: Arc<Mutex<FakeRelayState>>,
    head: Option<luca_protocol::ExchangeRecordV1>,
) -> (ManagedMessagePublisher, Arc<Mutex<Vec<String>>>) {
    let notes = Arc::new(Mutex::new(Vec::new()));
    let relay = NoteRecordingExchangeRelay {
        notes: Arc::clone(&notes),
        head: Mutex::new(
            head.map(|record| crate::luca::exchange_store::ExchangeHead {
                record,
                created_at: 100,
                event_id: Hex64::parse("ee".repeat(32)).expect("event id"),
            }),
        ),
    };
    let publisher = publisher(fixture, state).with_exchange(
        Box::new(relay),
        Arc::new(Mutex::new(
            crate::luca::exchange_store::ExchangeStore::in_memory(),
        )),
    );
    (publisher, notes)
}

/// An exchange the fixture's resident belongs to, rooted at the same owner
/// utterance the fixture's dispatch was staged from.
fn seeded_record(
    request: &ManagedMessagePublishRequestV1,
    bucket: Option<u8>,
    deadline_now: u64,
) -> luca_protocol::ExchangeRecordV1 {
    luca_protocol::ExchangeRecordV1::open(
        request.owner_pubkey.clone(),
        vec![
            request.resident_pubkey.clone(),
            Hex64::parse("3".repeat(64)).expect("sibling"),
        ],
        request.conversation_id.clone(),
        Hex64::parse(request.dispatch_receipt_id.as_str().to_owned()).expect("root"),
        request.resident_pubkey.clone(),
        bucket,
        deadline_now,
    )
    .expect("record")
}

fn note_texts(notes: &Arc<Mutex<Vec<String>>>) -> Vec<String> {
    notes
        .lock()
        .expect("notes")
        .iter()
        .map(|content| {
            serde_json::from_str::<serde_json::Value>(content)
                .expect("exchange notes are JSON")
                .get("text")
                .and_then(serde_json::Value::as_str)
                .expect("every exchange note carries a sentence")
                .to_owned()
        })
        .collect()
}

#[test]
fn a_reply_the_exchange_held_is_terminal_and_the_room_is_told() {
    let mut fixture = fixture();
    let state = Arc::new(Mutex::new(FakeRelayState {
        submit_results: VecDeque::from([ManagedRelaySubmitOutcome::TerminalRejected {
            reason: Some("restricted: exchange closed".to_owned()),
        }]),
        ..Default::default()
    }));
    let (mut publisher, notes) = exchange_publisher(&fixture, state);
    publisher
        .authorize_request(&fixture.request, 101)
        .expect("authorize");
    assert_eq!(
        publisher.publish_prepared(&fixture.request, &mut fixture.outbox, &fixture.session),
        Err(ManagedPublicationAuthorityError::ExchangeDenied(
            "exchange_closed"
        ))
    );
    assert!(
        fixture.outbox.reconciliation_entries().is_empty(),
        "the outbox row reaches its terminal state"
    );
    assert_eq!(
        fixture
            .store
            .lock()
            .expect("store")
            .authorize_reconciliation(&fixture.request, &fixture.event_id, 101)
            .expect("terminal state"),
        ManagedDispatchReconciliation::Rejected
    );
    let notes = notes.lock().expect("notes");
    assert_eq!(notes.len(), 1, "a held reply is never a silent discard");
    assert!(notes[0].contains("Vektor's reply was held — the exchange was stopped."));
    assert!(notes[0].contains("exchange-note"));
}

#[test]
fn a_lost_turn_race_keeps_the_dispatch_alive_for_a_second_attempt() {
    let mut fixture = fixture();
    let state = Arc::new(Mutex::new(FakeRelayState {
        submit_results: VecDeque::from([ManagedRelaySubmitOutcome::TerminalRejected {
            reason: Some("restricted: exchange turn already spoken".to_owned()),
        }]),
        ..Default::default()
    }));
    let (mut publisher, notes) = exchange_publisher(&fixture, state);
    publisher
        .authorize_request(&fixture.request, 101)
        .expect("authorize");
    assert_eq!(
        publisher.publish_prepared(&fixture.request, &mut fixture.outbox, &fixture.session),
        Err(ManagedPublicationAuthorityError::ExchangeTurnTaken)
    );
    assert!(
        notes.lock().expect("notes").is_empty(),
        "a turn collision is not something the room needs to hear about"
    );
    assert_eq!(
        fixture
            .store
            .lock()
            .expect("store")
            .authorize_reconciliation(&fixture.request, &fixture.event_id, 101)
            .expect("still live"),
        ManagedDispatchReconciliation::Ready,
        "the dispatch keeps its authority so the same draft can be re-signed"
    );
    assert_eq!(
        fixture
            .outbox
            .reconciliation_entries()
            .first()
            .expect("the frozen row survives")
            .state,
        ManagedOutboxState::Submitted
    );
}

#[test]
fn a_publisher_with_no_exchange_authority_refuses_a_final_that_claims_a_turn() {
    let fixture = fixture();
    let state = Arc::new(Mutex::new(FakeRelayState::default()));
    let mut publisher = publisher(&fixture, state);
    let mut claiming = fixture.request.clone();
    claiming.exchange = Some(
        luca_protocol::ExchangeTurnTag::new(Hex64::parse("7".repeat(64)).expect("id"), 1)
            .expect("turn"),
    );
    assert_eq!(
        publisher.resolve_exchange(&claiming, 101),
        Err(ManagedPublicationAuthorityError::ExchangeDenied(
            "exchange_unavailable"
        ))
    );
    // An ordinary owner-triggered reply is untouched.
    assert_eq!(
        publisher
            .resolve_exchange(&fixture.request, 101)
            .expect("unchanged"),
        ExchangePlan::unchanged()
    );
}

/// The refusal this desktop makes before anything is signed is the *common*
/// held path — far more common than a relay refusal — and it owes the room the
/// same sentence, naming the same reason.
#[test]
fn a_reply_this_desktop_refuses_before_signing_is_announced_in_the_room() {
    let fixture = fixture();
    let state = Arc::new(Mutex::new(FakeRelayState::default()));
    let (mut publisher, notes) = exchange_publisher(&fixture, state);
    let mut claiming = fixture.request.clone();
    claiming.exchange = Some(
        luca_protocol::ExchangeTurnTag::new(Hex64::parse("7".repeat(64)).expect("id"), 1)
            .expect("turn"),
    );

    assert_eq!(
        publisher.resolve_exchange(&claiming, 101),
        Err(ManagedPublicationAuthorityError::ExchangeDenied(
            "exchange_unknown"
        ))
    );
    assert_eq!(
        note_texts(&notes),
        vec!["Vektor's reply was held — it was outside any open exchange.".to_owned()],
        "a refusal this desktop makes is never a silent discard either"
    );
}

#[test]
fn every_pre_check_refusal_writes_its_own_reason_into_the_room() {
    let base = fixture();
    let sibling = Hex64::parse("3".repeat(64)).expect("sibling");
    let stranger = Hex64::parse("5".repeat(64)).expect("stranger");

    let stopped = seeded_record(&base.request, None, 101).stopped();
    let expired = seeded_record(&base.request, None, 101);
    let open = seeded_record(&base.request, None, 101);
    // An exchange between two other residents entirely.
    let outsiders = luca_protocol::ExchangeRecordV1::open(
        base.request.owner_pubkey.clone(),
        vec![sibling.clone(), stranger],
        base.request.conversation_id.clone(),
        Hex64::parse(base.request.dispatch_receipt_id.as_str().to_owned()).expect("root"),
        sibling.clone(),
        None,
        101,
    )
    .expect("record");

    let cases: Vec<(luca_protocol::ExchangeRecordV1, u8, u64, &str, &str)> = vec![
        (
            stopped,
            1,
            101,
            "exchange_closed",
            "Vektor's reply was held — the exchange was stopped.",
        ),
        (
            expired,
            1,
            1_000_000,
            "exchange_expired",
            "Vektor's reply was held — the exchange expired.",
        ),
        (
            // Turn four of a three-turn bucket: the exchange has nothing left
            // to give this reply.
            open,
            4,
            101,
            "exchange_exhausted",
            "Vektor's reply was held — the exchange is paused.",
        ),
        (
            outsiders,
            1,
            101,
            "exchange_not_member",
            "Vektor's reply was held — it was outside any open exchange.",
        ),
    ];

    for (record, turn, now, code, sentence) in cases {
        let fixture = fixture();
        let state = Arc::new(Mutex::new(FakeRelayState::default()));
        let (mut publisher, notes) =
            exchange_publisher_with_head(&fixture, state, Some(record.clone()));
        let mut inside = fixture.request.clone();
        inside.resolved_p_tags = vec![sibling.clone()];
        inside.exchange = Some(
            luca_protocol::ExchangeTurnTag::new(record.exchange_id.clone(), turn).expect("turn"),
        );

        assert_eq!(
            publisher.resolve_exchange(&inside, now),
            Err(ManagedPublicationAuthorityError::ExchangeDenied(code)),
            "{code}"
        );
        assert_eq!(note_texts(&notes), vec![sentence.to_owned()], "{code}");
    }
}

/// A Stop that lands between the collision and the retune must not leave the
/// reply suspended: nothing publishes, nothing retries, and the room is told.
#[test]
fn a_stop_that_lands_mid_race_ends_the_reply_and_tells_the_room() {
    let base = fixture();
    let record = seeded_record(&base.request, None, 101);
    let turn = luca_protocol::ExchangeTurnTag::new(record.exchange_id.clone(), 1).expect("turn");
    let mut fixture = fixture_with(Some(turn));
    let state = Arc::new(Mutex::new(FakeRelayState {
        submit_results: VecDeque::from([ManagedRelaySubmitOutcome::TerminalRejected {
            reason: Some("restricted: exchange turn already spoken".to_owned()),
        }]),
        ..Default::default()
    }));
    // By the time the retune asks, the owner has pressed Stop.
    let (mut publisher, notes) =
        exchange_publisher_with_head(&fixture, state, Some(record.stopped()));
    publisher
        .authorize_request(&fixture.request, 101)
        .expect("authorize");
    assert_eq!(
        publisher.publish_prepared(&fixture.request, &mut fixture.outbox, &fixture.session),
        Err(ManagedPublicationAuthorityError::ExchangeTurnTaken)
    );
    assert!(
        notes.lock().expect("notes").is_empty(),
        "the collision itself is not news"
    );

    assert_eq!(
        publisher.retune_exchange_turn(
            &fixture.request,
            &fixture.event_id,
            &mut fixture.outbox,
            101
        ),
        Err(ManagedPublicationAuthorityError::ExchangeDenied(
            "exchange_closed"
        ))
    );
    assert!(
        fixture.outbox.reconciliation_entries().is_empty(),
        "the reply reaches a terminal state instead of waiting forever"
    );
    assert_eq!(
        fixture
            .store
            .lock()
            .expect("store")
            .authorize_reconciliation(&fixture.request, &fixture.event_id, 101)
            .expect("terminal state"),
        ManagedDispatchReconciliation::Rejected
    );
    assert_eq!(
        note_texts(&notes),
        vec!["Vektor's reply was held — the exchange was stopped.".to_owned()]
    );
}
