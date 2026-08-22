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
        VisitFadeTrigger::ExchangeStopped(&correlation()),
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
