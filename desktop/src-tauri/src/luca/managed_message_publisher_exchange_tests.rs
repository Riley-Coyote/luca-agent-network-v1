use super::*;

use crate::luca::{
    exchange_relay::{ExchangeRelay, ExchangeRelayError},
    exchange_store::{ExchangeHead, ExchangeStore, VisitGrant},
};
use std::collections::{BTreeMap, BTreeSet};

struct OwnerReturnRelayState {
    head: ExchangeHead,
    triggers: BTreeMap<String, nostr::Event>,
    fail_close: bool,
    fail_readback: bool,
    fail_note: bool,
    closes: usize,
    removals: usize,
    notes: Vec<String>,
}

struct OwnerReturnRelay(Arc<Mutex<OwnerReturnRelayState>>);

impl ExchangeRelay for OwnerReturnRelay {
    fn fetch_head(
        &self,
        id: &Hex64,
        owner: &Hex64,
    ) -> Result<Option<ExchangeHead>, ExchangeRelayError> {
        let state = self.0.lock().expect("relay");
        assert_eq!(id, &state.head.record.exchange_id);
        assert_eq!(owner, &state.head.record.owner);
        if state.fail_readback && state.closes > 0 {
            return Err(ExchangeRelayError::Unavailable("synthetic readback".into()));
        }
        Ok(Some(state.head.clone()))
    }

    fn spent_turns(
        &self,
        _: &luca_protocol::ExchangeRecordV1,
    ) -> Result<BTreeSet<u8>, ExchangeRelayError> {
        Ok(BTreeSet::from([1, 2]))
    }

    fn fetch_trigger(&self, id: &Hex64) -> Result<Option<nostr::Event>, ExchangeRelayError> {
        Ok(self
            .0
            .lock()
            .expect("relay")
            .triggers
            .get(id.as_str())
            .cloned())
    }

    fn owner(&self) -> Result<Hex64, ExchangeRelayError> {
        Ok(self.0.lock().expect("relay").head.record.owner.clone())
    }

    fn publish_record(
        &self,
        record: &luca_protocol::ExchangeRecordV1,
        at: u64,
    ) -> Result<Hex64, ExchangeRelayError> {
        let mut state = self.0.lock().expect("relay");
        assert_eq!(record.state, luca_protocol::ExchangeStateV1::Closed);
        assert!(
            record.deadline.get() > at,
            "relay requires deadline after record timestamp"
        );
        if state.fail_close {
            return Err(ExchangeRelayError::Unavailable("synthetic close".into()));
        }
        state.closes += 1;
        state.head.record = record.clone();
        state.head.created_at = at;
        Ok(state.head.event_id.clone())
    }

    fn publish_note(&self, _: &OpaqueId, content: &str) -> Result<(), ExchangeRelayError> {
        let mut state = self.0.lock().expect("relay");
        if state.fail_note {
            return Err(ExchangeRelayError::Unavailable("synthetic note".into()));
        }
        state.notes.push(content.into());
        Ok(())
    }

    fn remove_conversation_member(
        &self,
        _: &OpaqueId,
        resident: &Hex64,
    ) -> Result<(), ExchangeRelayError> {
        let mut state = self.0.lock().expect("relay");
        assert!(state.head.record.members.contains(resident));
        assert_ne!(resident, &state.head.record.opened_by);
        state.removals += 1;
        Ok(())
    }

    fn conversation_members(&self, _: &OpaqueId) -> Result<BTreeSet<Hex64>, ExchangeRelayError> {
        self.owned_residents()
    }

    fn owned_residents(&self) -> Result<BTreeSet<Hex64>, ExchangeRelayError> {
        Ok(self
            .0
            .lock()
            .expect("relay")
            .head
            .record
            .members
            .iter()
            .cloned()
            .collect())
    }

    fn resolve_resident_name(
        &self,
        _: &BTreeSet<Hex64>,
        _: &str,
    ) -> Result<Option<Hex64>, ExchangeRelayError> {
        Ok(None)
    }

    fn display_name(&self, _: &Hex64) -> String {
        "Synthetic specialist".into()
    }
}

struct OwnerReturnFixture {
    base: Fixture,
    relay: Arc<Mutex<OwnerReturnRelayState>>,
    exchanges: Arc<Mutex<ExchangeStore>>,
    transport: Arc<Mutex<FakeRelayState>>,
    original_request: ManagedMessagePublishRequestV1,
}

impl OwnerReturnFixture {
    fn publisher(&self) -> ManagedMessagePublisher {
        publisher(&self.base, Arc::clone(&self.transport)).with_exchange(
            Box::new(OwnerReturnRelay(Arc::clone(&self.relay))),
            Arc::clone(&self.exchanges),
        )
    }
}

fn owner_return_publisher_fixture() -> OwnerReturnFixture {
    let mut base = fixture();
    let owner = Keys::parse(&"91".repeat(32)).expect("synthetic owner");
    let worker = Keys::parse(&"93".repeat(32)).expect("synthetic worker");
    let worker_id = Hex64::parse(worker.public_key().to_hex()).expect("worker");
    let origin = EventBuilder::new(Kind::Custom(9), "owner trigger")
        .tags([
            Tag::parse(["h", CHANNEL]).expect("h"),
            Tag::public_key(owner.public_key()),
            Tag::public_key(base.resident.public_key()),
        ])
        .custom_created_at(Timestamp::from(100))
        .sign_with_keys(&owner)
        .expect("origin");
    let record = luca_protocol::ExchangeRecordV1::open(
        base.request.owner_pubkey.clone(),
        vec![base.request.resident_pubkey.clone(), worker_id.clone()],
        base.request.conversation_id.clone(),
        Hex64::parse(origin.id.to_hex()).expect("origin id"),
        base.request.resident_pubkey.clone(),
        None,
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_secs(),
    )
    .expect("pair");
    let reply = EventBuilder::new(Kind::Custom(9), "two synthetic ideas")
        .tags([
            Tag::parse(["h", CHANNEL]).expect("h"),
            Tag::public_key(base.resident.public_key()),
            Tag::parse(["e", &origin.id.to_hex(), "", "root"]).expect("root"),
            Tag::parse(["e", &origin.id.to_hex(), "", "reply"]).expect("reply"),
            Tag::parse(["broadcast", "1"]).expect("surface"),
            Tag::parse(["exchange", record.exchange_id.as_str(), "2"]).expect("turn"),
        ])
        .custom_created_at(Timestamp::from(101))
        .sign_with_keys(&worker)
        .expect("sibling reply");
    base.store
        .lock()
        .expect("dispatch")
        .stage_wake_from_trigger(
            &reply,
            base.request.resident_pubkey.as_str(),
            base.request.owner_pubkey.as_str(),
            101,
        )
        .expect("wake");
    base.request.dispatch_receipt_id = OpaqueId::parse(reply.id.to_hex()).expect("receipt");
    base.request.turn_id = base.request.dispatch_receipt_id.clone();
    base.request.idempotency_key = derive_message_publish_idempotency_key(
        &base.request.dispatch_receipt_id,
        &base.request.resident_pubkey,
    )
    .expect("idempotency");
    base.request.resolved_p_tags = vec![worker_id.clone()];
    base.request.exchange = Some(
        luca_protocol::ExchangeTurnTag::new(record.exchange_id.clone(), 3).expect("third turn"),
    );
    let original_request = base.request.clone();
    let relay = Arc::new(Mutex::new(OwnerReturnRelayState {
        head: ExchangeHead {
            record: record.clone(),
            created_at: 100,
            event_id: Hex64::parse("de".repeat(32)).expect("head id"),
        },
        triggers: BTreeMap::from([(origin.id.to_hex(), origin), (reply.id.to_hex(), reply)]),
        fail_close: false,
        fail_readback: false,
        fail_note: false,
        closes: 0,
        removals: 0,
        notes: Vec::new(),
    }));
    let mut exchanges = ExchangeStore::load(base.dispatch_path.with_file_name("exchanges.json"))
        .expect("exchange store");
    exchanges
        .record_visit(VisitGrant {
            conversation_id: base.request.conversation_id.clone(),
            resident: worker_id,
            arrived_at: 100,
            exchange_id: Some(record.exchange_id.clone()),
            correlation_id: record.exchange_id,
        })
        .expect("visit");
    let mut f = OwnerReturnFixture {
        base,
        relay,
        exchanges: Arc::new(Mutex::new(exchanges)),
        transport: Arc::new(Mutex::new(FakeRelayState::default())),
        original_request,
    };
    let plan = f
        .publisher()
        .resolve_exchange(&f.base.request, 102)
        .expect("verified return");
    f.base.request = plan.apply(&f.base.request).expect("owner audience");
    let final_event = EventBuilder::new(Kind::Custom(9), f.base.request.final_draft.clone())
        .tags(
            crate::luca::managed_message_event::managed_message_tags(&f.base.request)
                .expect("tags"),
        )
        .custom_created_at(Timestamp::from(102))
        .sign_with_keys(&f.base.resident)
        .expect("return");
    f.base.event_id = final_event.id.to_hex();
    f.base.exact_event_json =
        String::from_utf8(canonicalize(&final_event).expect("canonical")).expect("UTF-8");
    let frozen = crate::luca::managed_message_outbox::FrozenManagedMessageEvent::parse(
        f.base.exact_event_json.clone(),
        &f.base.request,
    )
    .expect("frozen");
    f.base.outbox = ManagedMessageOutbox::new(f.base.session.clone());
    f.base
        .outbox
        .prepare(&f.base.request, frozen, &f.base.session, 7, false)
        .expect("prepared");
    f
}

#[test]
fn owner_return_only_closes_after_acceptance_and_retries_cleanup_without_resubmission() {
    for failure in ["close", "readback", "fade"] {
        let mut f = owner_return_publisher_fixture();
        let outbox_path = f.base.dispatch_path.with_file_name("outbox.age");
        let passphrase = age::secrecy::SecretString::from("synthetic owner return test".to_owned());
        let frozen = crate::luca::managed_message_outbox::FrozenManagedMessageEvent::parse(
            f.base.exact_event_json.clone(),
            &f.base.request,
        )
        .expect("frozen");
        f.base.outbox = ManagedMessageOutbox::load_encrypted(
            f.base.session.clone(),
            outbox_path.clone(),
            passphrase.clone(),
        )
        .expect("encrypted outbox");
        f.base
            .outbox
            .prepare(&f.base.request, frozen, &f.base.session, 7, false)
            .expect("prepare encrypted");
        {
            let mut state = f.relay.lock().expect("relay");
            state.fail_close = failure == "close";
            state.fail_readback = failure == "readback";
            state.fail_note = failure == "fade";
        }
        let mut publisher = f.publisher();
        publisher
            .authorize_request(&f.base.request, 102)
            .expect("authorize");
        // Uncertain submission cannot close the exchange or remove the guest.
        assert!(publisher
            .publish_prepared(&f.base.request, &mut f.base.outbox, &f.base.session)
            .is_err());
        assert_eq!(
            f.relay.lock().expect("relay").head.record.state,
            luca_protocol::ExchangeStateV1::Open
        );
        assert_eq!(f.relay.lock().expect("relay").removals, 0);
        // An exact-event probe recovers relay acceptance without another submit.
        f.transport
            .lock()
            .expect("transport")
            .probe_results
            .push_back(ManagedRelayProbeOutcome::Present(
                crate::relay::SubmitEventResponse {
                    event_id: f.base.event_id.clone(),
                    accepted: true,
                    message: "accepted".into(),
                },
            ));
        publisher
            .reconcile_on_start(&mut f.base.outbox, &f.base.session)
            .expect("accepted even if cleanup failed");
        let pending = f.base.outbox.reconciliation_entries();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].state, ManagedOutboxState::Accepted);
        assert!(f
            .base
            .outbox
            .accepted_result(&f.base.request.idempotency_key)
            .is_ok());
        assert_eq!(
            f.relay.lock().expect("relay").removals,
            usize::from(failure == "fade")
        );
        assert!(
            f.relay.lock().expect("relay").notes.is_empty(),
            "normal return never publishes a held warning"
        );
        if failure == "fade" {
            assert!(
                f.exchanges
                    .lock()
                    .expect("exchanges")
                    .visits_in(&f.base.request.conversation_id)[0]
                    .membership_removed
            );
        }
        // Reload all three durable stores as after an app crash.
        drop(publisher);
        f.base.outbox =
            ManagedMessageOutbox::load_encrypted(f.base.session.clone(), outbox_path, passphrase)
                .expect("reopen encrypted outbox");
        f.base.store = Arc::new(Mutex::new(
            ManagedDispatchStore::load(f.base.dispatch_path.clone()).expect("reopen dispatch"),
        ));
        f.exchanges = Arc::new(Mutex::new(
            ExchangeStore::load(f.base.dispatch_path.with_file_name("exchanges.json"))
                .expect("reopen exchange"),
        ));
        {
            let mut state = f.relay.lock().expect("relay");
            state.fail_close = false;
            state.fail_readback = false;
            state.fail_note = false;
        }
        let mut publisher = f.publisher();
        publisher
            .reconcile_on_start(&mut f.base.outbox, &f.base.session)
            .expect("settle accepted return");
        publisher
            .reconcile_on_start(&mut f.base.outbox, &f.base.session)
            .expect("idempotent recovery");
        assert!(f.base.outbox.reconciliation_entries().is_empty());
        assert!(f
            .exchanges
            .lock()
            .expect("exchanges")
            .visits_in(&f.base.request.conversation_id)
            .is_empty());
        let state = f.relay.lock().expect("relay");
        assert_eq!(
            state.head.record.state,
            luca_protocol::ExchangeStateV1::Closed
        );
        assert_eq!((state.closes, state.removals, state.notes.len()), (1, 1, 1));
        drop(state);
        let transport = f.transport.lock().expect("transport");
        assert_eq!(transport.submissions, [f.base.exact_event_json.clone()]);
        assert_eq!(transport.probes, [f.base.exact_event_json.clone()]);
    }
}

#[test]
fn owner_return_frozen_plan_replay_does_not_rewrite_a_submitted_or_cancelled_dispatch() {
    let mut f = owner_return_publisher_fixture();
    let mut publisher = f.publisher();
    publisher
        .authorize_request(&f.base.request, 102)
        .expect("authorize");
    assert!(publisher
        .publish_prepared(&f.base.request, &mut f.base.outbox, &f.base.session)
        .is_err());
    let before = fs::read(&f.base.dispatch_path).expect("dispatch bytes");
    let plan = publisher
        .resolve_exchange(&f.original_request, 103)
        .expect("same frozen plan");
    assert_eq!(
        plan.apply(&f.original_request).expect("effective"),
        f.base.request
    );
    assert_eq!(
        fs::read(&f.base.dispatch_path).expect("dispatch bytes"),
        before
    );
    assert_eq!(
        f.base
            .outbox
            .event_for_submission(&f.base.request.idempotency_key)
            .expect("retained final"),
        f.base.exact_event_json
    );
    f.base
        .store
        .lock()
        .expect("store")
        .cancel_exact(
            f.base.request.owner_pubkey.as_str(),
            CHANNEL,
            f.base.request.resident_pubkey.as_str(),
            f.base.request.dispatch_receipt_id.as_str(),
            7,
        )
        .expect("cancel");
    f.transport
        .lock()
        .expect("transport")
        .probe_results
        .push_back(ManagedRelayProbeOutcome::Absent);
    publisher
        .reconcile_on_start(&mut f.base.outbox, &f.base.session)
        .expect("cancelled without publish");
    assert_eq!(f.transport.lock().expect("transport").submissions.len(), 1);
    assert_eq!(
        f.relay.lock().expect("relay").head.record.state,
        luca_protocol::ExchangeStateV1::Open
    );
    assert_eq!(f.relay.lock().expect("relay").removals, 0);
}

#[test]
fn owner_return_accepted_cleanup_after_expiry_never_writes_an_invalid_close_or_removes_a_busy_guest(
) {
    for protected_guest in [false, true] {
        let mut f = owner_return_publisher_fixture();
        f.relay.lock().expect("relay").fail_close = true;
        f.transport
            .lock()
            .expect("transport")
            .submit_results
            .push_back(ManagedRelaySubmitOutcome::Response(
                crate::relay::SubmitEventResponse {
                    event_id: f.base.event_id.clone(),
                    accepted: true,
                    message: "accepted".into(),
                },
            ));
        let mut publisher = f.publisher();
        publisher
            .authorize_request(&f.base.request, 102)
            .expect("authorize");
        publisher
            .publish_prepared(&f.base.request, &mut f.base.outbox, &f.base.session)
            .expect("accepted final succeeds while close is unavailable");
        assert_eq!(
            f.base.outbox.reconciliation_entries()[0].state,
            ManagedOutboxState::Accepted
        );
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_secs();
        let mut other = f.relay.lock().expect("relay").head.record.clone();
        {
            let mut relay = f.relay.lock().expect("relay");
            relay.fail_close = false;
            relay.head.record.deadline = SafeU53::new(now - 1).expect("expired");
        }
        if protected_guest {
            other = luca_protocol::ExchangeRecordV1::open(
                other.owner,
                other.members,
                other.conversation_id,
                Hex64::parse("ff".repeat(32)).expect("other root"),
                other.opened_by,
                None,
                now,
            )
            .expect("another live exchange");
            f.exchanges
                .lock()
                .expect("exchanges")
                .adopt_head(ExchangeHead {
                    record: other,
                    created_at: now,
                    event_id: Hex64::parse("ef".repeat(32)).expect("other head"),
                })
                .expect("protect live guest");
        }
        publisher
            .reconcile_on_start(&mut f.base.outbox, &f.base.session)
            .expect("expiry settles accepted final");
        publisher
            .reconcile_on_start(&mut f.base.outbox, &f.base.session)
            .expect("idempotent");
        assert!(f.base.outbox.reconciliation_entries().is_empty());
        let relay = f.relay.lock().expect("relay");
        assert_eq!(
            relay.closes, 0,
            "expired records cannot receive a late close timestamp"
        );
        assert_eq!(relay.removals, usize::from(!protected_guest));
        assert_eq!(relay.notes.len(), usize::from(!protected_guest));
        assert_eq!(
            f.exchanges
                .lock()
                .expect("exchanges")
                .visits_in(&f.base.request.conversation_id)
                .len(),
            usize::from(protected_guest)
        );
        let transport = f.transport.lock().expect("transport");
        assert_eq!(transport.submissions, [f.base.exact_event_json.clone()]);
        assert!(transport.probes.is_empty());
    }
}

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
    fn fetch_trigger(
        &self,
        _event_id: &luca_protocol::Hex64,
    ) -> Result<Option<nostr::Event>, crate::luca::exchange_relay::ExchangeRelayError> {
        Ok(None)
    }

    fn owner(
        &self,
    ) -> Result<luca_protocol::Hex64, crate::luca::exchange_relay::ExchangeRelayError> {
        luca_protocol::Hex64::parse("ee".repeat(32)).map_err(|_| {
            crate::luca::exchange_relay::ExchangeRelayError::Unavailable("owner".into())
        })
    }

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
