use super::*;

use std::collections::{BTreeMap, BTreeSet};

use luca_protocol::ExchangeRecordV1;

use super::super::exchange_relay::ExchangeRelayError;
use super::super::exchange_store::ExchangeHead;

const CHANNEL: &str = "11111111-1111-4111-8111-111111111111";

#[derive(Default)]
struct FakeRelay {
    room: Mutex<BTreeSet<Hex64>>,
    owned: Mutex<BTreeSet<Hex64>>,
    labels: Mutex<BTreeMap<String, String>>,
    added: Mutex<Vec<Hex64>>,
    removed: Mutex<Vec<Hex64>>,
    notes: Mutex<Vec<String>>,
}

impl FakeRelay {
    fn resident(&self, pubkey: &Hex64, name: &str) {
        self.owned.lock().expect("owned").insert(pubkey.clone());
        self.labels
            .lock()
            .expect("labels")
            .insert(pubkey.as_str().to_owned(), name.to_owned());
    }
}

impl ExchangeRelay for FakeRelay {
    fn fetch_head(
        &self,
        _exchange_id: &Hex64,
        _owner: &Hex64,
    ) -> Result<Option<ExchangeHead>, ExchangeRelayError> {
        Ok(None)
    }

    fn spent_turns(&self, _record: &ExchangeRecordV1) -> Result<BTreeSet<u8>, ExchangeRelayError> {
        Ok(BTreeSet::new())
    }

    fn fetch_trigger(&self, _event_id: &Hex64) -> Result<Option<nostr::Event>, ExchangeRelayError> {
        Ok(None)
    }

    fn owner(&self) -> Result<Hex64, ExchangeRelayError> {
        Hex64::parse("e".repeat(64)).map_err(|error| {
            ExchangeRelayError::Unavailable(format!("fixture owner is invalid: {error}"))
        })
    }

    fn publish_record(
        &self,
        _record: &ExchangeRecordV1,
        _created_at: u64,
    ) -> Result<Hex64, ExchangeRelayError> {
        Hex64::parse("d".repeat(64)).map_err(|error| {
            ExchangeRelayError::Unavailable(format!("fixture event is invalid: {error}"))
        })
    }

    fn publish_note(
        &self,
        _conversation_id: &OpaqueId,
        content: &str,
    ) -> Result<(), ExchangeRelayError> {
        self.notes.lock().expect("notes").push(content.to_owned());
        Ok(())
    }

    fn add_conversation_member(
        &self,
        _conversation_id: &OpaqueId,
        resident: &Hex64,
    ) -> Result<(), ExchangeRelayError> {
        self.added.lock().expect("added").push(resident.clone());
        self.room.lock().expect("room").insert(resident.clone());
        Ok(())
    }

    fn remove_conversation_member(
        &self,
        _conversation_id: &OpaqueId,
        resident: &Hex64,
    ) -> Result<(), ExchangeRelayError> {
        self.removed.lock().expect("removed").push(resident.clone());
        self.room.lock().expect("room").remove(resident);
        Ok(())
    }

    fn conversation_members(
        &self,
        _conversation_id: &OpaqueId,
    ) -> Result<BTreeSet<Hex64>, ExchangeRelayError> {
        Ok(self.room.lock().expect("room").clone())
    }

    fn owned_residents(&self) -> Result<BTreeSet<Hex64>, ExchangeRelayError> {
        Ok(self.owned.lock().expect("owned").clone())
    }

    fn resolve_resident_name(
        &self,
        _owned: &BTreeSet<Hex64>,
        _name: &str,
    ) -> Result<Option<Hex64>, ExchangeRelayError> {
        Ok(None)
    }

    fn display_name(&self, pubkey: &Hex64) -> String {
        self.labels
            .lock()
            .expect("labels")
            .get(pubkey.as_str())
            .cloned()
            .unwrap_or_else(|| "resident".to_owned())
    }
}

fn channel() -> OpaqueId {
    OpaqueId::parse(CHANNEL).expect("channel")
}

fn guest() -> Hex64 {
    Hex64::parse("a".repeat(64)).expect("guest")
}

fn correlation() -> Hex64 {
    Hex64::parse("b".repeat(64)).expect("correlation")
}

fn exchange(root: char, opened_at: u64) -> ExchangeRecordV1 {
    ExchangeRecordV1::open(
        Hex64::parse("e".repeat(64)).expect("owner"),
        vec![
            guest(),
            Hex64::parse("d".repeat(64)).expect("host resident"),
        ],
        channel(),
        Hex64::parse(root.to_string().repeat(64)).expect("root event"),
        Hex64::parse("d".repeat(64)).expect("opened by"),
        None,
        opened_at,
    )
    .expect("exchange")
}

fn seed_head(
    store: &Arc<Mutex<ExchangeStore>>,
    record: ExchangeRecordV1,
    created_at: u64,
    event: char,
) {
    store
        .lock()
        .expect("store")
        .upsert_head(ExchangeHead {
            record,
            created_at,
            event_id: Hex64::parse(event.to_string().repeat(64)).expect("event id"),
        })
        .expect("head");
}

#[test]
fn owner_mention_visits_once_and_emits_the_exact_arrival_payload() {
    let relay = FakeRelay::default();
    let guest = guest();
    relay.resident(&guest, "ziggy");
    let store = Arc::new(Mutex::new(ExchangeStore::in_memory()));

    handle_owner_mentions(
        &relay,
        &store,
        &channel(),
        &[guest.as_str().to_owned()],
        &correlation(),
        1_700_000_000,
    )
    .expect("visit");
    handle_owner_mentions(
        &relay,
        &store,
        &channel(),
        &[guest.as_str().to_owned()],
        &Hex64::parse("c".repeat(64)).expect("second event"),
        1_700_000_001,
    )
    .expect("same visit");

    assert_eq!(
        relay.added.lock().expect("added").as_slice(),
        std::slice::from_ref(&guest)
    );
    assert_eq!(relay.notes.lock().expect("notes").as_slice(), [format!(
        "{{\"type\":\"visit_arrived\",\"resident\":\"{}\",\"exchange_id\":\"{}\",\"text\":\"ziggy is visiting.\"}}",
        guest.as_str(),
        correlation().as_str()
    )]);
    assert_eq!(
        store
            .lock()
            .expect("store")
            .visit(&channel(), &guest)
            .expect("active visit")
            .grant
            .arrived_at,
        1_700_000_000
    );
}

#[test]
fn rejected_owner_send_rolls_back_only_attempt_membership_without_visit_notes() {
    let relay = FakeRelay::default();
    let guest = guest();
    let permanent = Hex64::parse("f".repeat(64)).expect("permanent member");
    relay.resident(&guest, "ziggy");
    relay.resident(&permanent, "luca");
    relay.room.lock().expect("room").insert(permanent.clone());
    let store = Arc::new(Mutex::new(ExchangeStore::in_memory()));

    let plan = plan_owner_message_visits(
        &relay,
        &store,
        &channel(),
        &[guest.as_str().to_owned(), permanent.as_str().to_owned()],
        1_700_000_000,
    )
    .expect("plan");
    assert!(relay.added.lock().expect("added").is_empty());
    assert!(relay.notes.lock().expect("notes").is_empty());
    assert!(store
        .lock()
        .expect("store")
        .visits_in(&channel())
        .is_empty());

    let provisioned = provision_owner_message_visits(&relay, &plan).expect("provision");
    assert_eq!(provisioned, [guest.clone()]);
    rollback_owner_message_visit_memberships(&relay, &plan, &provisioned);

    let room = relay.room.lock().expect("room");
    assert!(!room.contains(&guest));
    assert!(room.contains(&permanent));
    drop(room);
    assert!(store
        .lock()
        .expect("store")
        .visits_in(&channel())
        .is_empty());
    assert!(relay.notes.lock().expect("notes").is_empty());
    assert_eq!(
        relay.removed.lock().expect("removed").as_slice(),
        std::slice::from_ref(&guest)
    );
}

#[test]
fn accepted_owner_send_commits_one_visit_and_retry_is_idempotent() {
    let relay = FakeRelay::default();
    let guest = guest();
    relay.resident(&guest, "ziggy");
    let store = Arc::new(Mutex::new(ExchangeStore::in_memory()));

    let first_plan = plan_owner_message_visits(
        &relay,
        &store,
        &channel(),
        &[guest.as_str().to_owned()],
        1_700_000_000,
    )
    .expect("first plan");
    let first_provision =
        provision_owner_message_visits(&relay, &first_plan).expect("first provision");
    rollback_owner_message_visit_memberships(&relay, &first_plan, &first_provision);

    let retry_plan = plan_owner_message_visits(
        &relay,
        &store,
        &channel(),
        &[guest.as_str().to_owned()],
        1_700_000_001,
    )
    .expect("retry plan");
    provision_owner_message_visits(&relay, &retry_plan).expect("retry provision");
    commit_owner_message_visits(&relay, &store, &retry_plan, &correlation(), 1_700_000_001)
        .expect("commit");
    commit_owner_message_visits(&relay, &store, &retry_plan, &correlation(), 1_700_000_001)
        .expect("idempotent commit");

    assert_eq!(relay.notes.lock().expect("notes").len(), 1);
    assert!(store
        .lock()
        .expect("store")
        .visit(&channel(), &guest)
        .is_some());
}

#[test]
fn an_unaccepted_owner_message_does_not_fade_an_existing_visit() {
    let relay = FakeRelay::default();
    let guest = guest();
    relay.resident(&guest, "ziggy");
    let store = Arc::new(Mutex::new(ExchangeStore::in_memory()));
    settle_visit_grants(
        &relay,
        &store,
        &[VisitGrant {
            conversation_id: channel(),
            resident: guest.clone(),
            arrived_at: 1_700_000_000,
            exchange_id: None,
            correlation_id: correlation(),
        }],
    )
    .expect("seed visit");
    relay.removed.lock().expect("removed").clear();
    relay.notes.lock().expect("notes").clear();

    let plan = plan_owner_message_visits(&relay, &store, &channel(), &[], 1_700_000_010)
        .expect("plan fade");
    assert_eq!(plan.faded(), std::slice::from_ref(&guest));
    assert!(relay.removed.lock().expect("removed").is_empty());
    assert!(relay.notes.lock().expect("notes").is_empty());
    assert!(store
        .lock()
        .expect("store")
        .visit(&channel(), &guest)
        .is_some());

    commit_owner_message_visits(
        &relay,
        &store,
        &plan,
        &Hex64::parse("c".repeat(64)).expect("accepted message"),
        1_700_000_010,
    )
    .expect("commit fade");
    assert_eq!(
        relay.removed.lock().expect("removed").as_slice(),
        std::slice::from_ref(&guest)
    );
    assert_eq!(relay.notes.lock().expect("notes").len(), 1);
}

#[test]
fn the_owners_next_unaddressed_message_fades_the_visit() {
    let relay = FakeRelay::default();
    let guest = guest();
    relay.resident(&guest, "ziggy");
    let store = Arc::new(Mutex::new(ExchangeStore::in_memory()));
    handle_owner_mentions(
        &relay,
        &store,
        &channel(),
        &[guest.as_str().to_owned()],
        &correlation(),
        1_700_000_000,
    )
    .expect("visit");

    handle_owner_mentions(
        &relay,
        &store,
        &channel(),
        &[],
        &Hex64::parse("c".repeat(64)).expect("next event"),
        1_700_000_010,
    )
    .expect("fade");

    assert_eq!(
        relay.removed.lock().expect("removed").as_slice(),
        std::slice::from_ref(&guest)
    );
    assert!(store
        .lock()
        .expect("store")
        .visit(&channel(), &guest)
        .is_none());
    let notes = relay.notes.lock().expect("notes");
    assert_eq!(notes.len(), 2);
    assert_eq!(
        notes[1],
        format!(
            "{{\"type\":\"visit_left\",\"resident\":\"{}\",\"exchange_id\":\"{}\",\"text\":\"ziggy left.\"}}",
            guest.as_str(),
            correlation().as_str()
        )
    );
}

#[test]
fn explicit_end_visit_removes_only_the_guest_and_emits_departure() {
    let relay = FakeRelay::default();
    let guest = guest();
    let permanent = Hex64::parse("f".repeat(64)).expect("permanent member");
    relay.resident(&guest, "ziggy");
    relay.room.lock().expect("room").insert(permanent.clone());
    let store = Arc::new(Mutex::new(ExchangeStore::in_memory()));

    handle_owner_mentions(
        &relay,
        &store,
        &channel(),
        &[guest.as_str().to_owned()],
        &correlation(),
        1_700_000_000,
    )
    .expect("visit");
    relay.notes.lock().expect("notes").clear();

    assert!(end_visit(&relay, &store, &channel(), &guest).expect("end visit"));
    assert!(!end_visit(&relay, &store, &channel(), &guest).expect("idempotent absence"));

    let room = relay.room.lock().expect("room");
    assert!(!room.contains(&guest));
    assert!(room.contains(&permanent));
    drop(room);
    assert!(store
        .lock()
        .expect("store")
        .visit(&channel(), &guest)
        .is_none());
    assert_eq!(
        relay.removed.lock().expect("removed").as_slice(),
        std::slice::from_ref(&guest)
    );
    assert_eq!(
        relay.notes.lock().expect("notes").as_slice(),
        [format!(
            "{{\"type\":\"visit_left\",\"resident\":\"{}\",\"exchange_id\":\"{}\",\"text\":\"ziggy left.\"}}",
            guest.as_str(),
            correlation().as_str()
        )]
    );
}

#[test]
fn stopping_the_exchange_removes_its_guest_and_emits_left() {
    let relay = FakeRelay::default();
    let guest = guest();
    relay.resident(&guest, "ziggy");
    let store = Arc::new(Mutex::new(ExchangeStore::in_memory()));
    let grant = VisitGrant {
        conversation_id: channel(),
        resident: guest.clone(),
        arrived_at: 1_700_000_000,
        exchange_id: Some(correlation()),
        correlation_id: correlation(),
    };
    settle_visit_grants(&relay, &store, &[grant]).expect("visit");

    let faded = fade_visits(
        &relay,
        &store,
        &channel(),
        VisitFadeTrigger::ExchangeStopped {
            exchange_id: &correlation(),
            now_unix_secs: 1_700_000_010,
        },
    )
    .expect("fade");

    assert_eq!(faded, std::slice::from_ref(&guest));
    assert_eq!(relay.removed.lock().expect("removed").as_slice(), [guest]);
    assert_eq!(relay.notes.lock().expect("notes").len(), 2);
}

#[test]
fn a_visit_whose_exchange_head_is_missing_still_fades() {
    // The guest arrived with an exchange, but no head for it is in the store —
    // a pruned or never-recorded head. Treating that as "still open" would pin
    // the membership row forever, because the stop trigger also needs the head.
    let relay = FakeRelay::default();
    let guest = guest();
    relay.resident(&guest, "ziggy");
    let store = Arc::new(Mutex::new(ExchangeStore::in_memory()));
    let grant = VisitGrant {
        conversation_id: channel(),
        resident: guest.clone(),
        arrived_at: 1_700_000_000,
        exchange_id: Some(correlation()),
        correlation_id: correlation(),
    };
    settle_visit_grants(&relay, &store, &[grant]).expect("visit");
    assert!(store.lock().expect("store").head(&correlation()).is_none());

    fade_visits(
        &relay,
        &store,
        &channel(),
        VisitFadeTrigger::OwnerMessage {
            mentioned: &BTreeSet::new(),
            now_unix_secs: 1_700_000_010,
        },
    )
    .expect("fade");

    assert_eq!(
        relay.removed.lock().expect("removed").as_slice(),
        std::slice::from_ref(&guest)
    );
    assert!(store
        .lock()
        .expect("store")
        .visit(&channel(), &guest)
        .is_none());
}

#[test]
fn an_unaddressed_owner_message_keeps_a_guest_while_any_exchange_is_open() {
    let relay = FakeRelay::default();
    let guest = guest();
    relay.resident(&guest, "ziggy");
    let store = Arc::new(Mutex::new(ExchangeStore::in_memory()));
    let first = exchange('1', 1_700_000_000);
    let second = exchange('2', 1_700_000_100);
    let grant = VisitGrant {
        conversation_id: channel(),
        resident: guest.clone(),
        arrived_at: 1_700_000_000,
        exchange_id: Some(first.exchange_id.clone()),
        correlation_id: first.exchange_id.clone(),
    };
    settle_visit_grants(&relay, &store, &[grant]).expect("visit");
    seed_head(&store, first.clone(), 1_700_000_000, '3');
    seed_head(&store, second.clone(), 1_700_000_100, '4');
    let after_first_expired = first.deadline.get() + 1;
    assert!(second.deadline.get() >= after_first_expired);

    let faded = fade_visits(
        &relay,
        &store,
        &channel(),
        VisitFadeTrigger::OwnerMessage {
            mentioned: &BTreeSet::new(),
            now_unix_secs: after_first_expired,
        },
    )
    .expect("keep visit");

    assert!(faded.is_empty());
    assert!(relay.removed.lock().expect("removed").is_empty());
    assert!(store
        .lock()
        .expect("store")
        .visit(&channel(), &guest)
        .is_some());

    let faded = fade_visits(
        &relay,
        &store,
        &channel(),
        VisitFadeTrigger::OwnerMessage {
            mentioned: &BTreeSet::new(),
            now_unix_secs: second.deadline.get() + 1,
        },
    )
    .expect("fade after every exchange expires");
    assert_eq!(faded, [guest]);
}

#[test]
fn stopping_one_exchange_keeps_a_guest_until_their_last_exchange_stops() {
    let relay = FakeRelay::default();
    let guest = guest();
    relay.resident(&guest, "ziggy");
    let store = Arc::new(Mutex::new(ExchangeStore::in_memory()));
    let first = exchange('1', 1_700_000_000);
    let second = exchange('2', 1_700_000_100);
    let grant = VisitGrant {
        conversation_id: channel(),
        resident: guest.clone(),
        arrived_at: 1_700_000_000,
        exchange_id: Some(first.exchange_id.clone()),
        correlation_id: first.exchange_id.clone(),
    };
    settle_visit_grants(&relay, &store, &[grant]).expect("visit");
    seed_head(&store, first.stopped(), 1_700_000_200, '3');
    seed_head(&store, second.clone(), 1_700_000_100, '4');

    let faded = fade_visits(
        &relay,
        &store,
        &channel(),
        VisitFadeTrigger::ExchangeStopped {
            exchange_id: &first.exchange_id,
            now_unix_secs: 1_700_000_200,
        },
    )
    .expect("keep visit");
    assert!(faded.is_empty());
    assert!(relay.removed.lock().expect("removed").is_empty());

    seed_head(&store, second.stopped(), 1_700_000_300, '5');
    let faded = fade_visits(
        &relay,
        &store,
        &channel(),
        VisitFadeTrigger::ExchangeStopped {
            exchange_id: &second.exchange_id,
            now_unix_secs: 1_700_000_300,
        },
    )
    .expect("fade after last stop");
    assert_eq!(faded, [guest]);
}
