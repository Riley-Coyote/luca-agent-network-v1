use super::*;

use std::collections::BTreeMap;

use luca_protocol::{
    derive_message_publish_idempotency_key, ManagedResponseSurfaceV1, OpaqueId, SafeU53,
    MESSAGE_PUBLISH_PROTOCOL,
};
use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};

use super::super::exchange_relay::ExchangeRelayError;
use super::super::exchange_store::ExchangeStore;
use super::super::managed_dispatch_store::ManagedDispatchStore;

const CHANNEL: &str = "11111111-1111-4111-8111-111111111111";
const NOW: u64 = 1_700_000_000;

/// An offline stand-in for the owner's relay, registry and rooms.
#[derive(Default)]
struct FakeExchangeRelay {
    heads: Mutex<BTreeMap<String, ExchangeHead>>,
    spent: Mutex<BTreeMap<String, BTreeSet<u8>>>,
    room: Mutex<BTreeSet<Hex64>>,
    owned: Mutex<BTreeSet<Hex64>>,
    names: Mutex<BTreeMap<String, Hex64>>,
    labels: Mutex<BTreeMap<String, String>>,
    published_records: Mutex<Vec<(ExchangeRecordV1, u64)>>,
    published_notes: Mutex<Vec<String>>,
    added_members: Mutex<Vec<Hex64>>,
    removed_members: Mutex<Vec<Hex64>>,
    refuse_record: Mutex<bool>,
    room_unavailable: Mutex<bool>,
    spent_unavailable: Mutex<bool>,
}

impl FakeExchangeRelay {
    fn seed_head(&self, record: &ExchangeRecordV1, created_at: u64) {
        self.heads.lock().expect("heads").insert(
            record.exchange_id.as_str().to_owned(),
            ExchangeHead {
                record: record.clone(),
                created_at,
                event_id: Hex64::parse("ee".repeat(32)).expect("event id"),
            },
        );
    }

    fn seed_spent(&self, record: &ExchangeRecordV1, turns: &[u8]) {
        self.spent.lock().expect("spent").insert(
            record.exchange_id.as_str().to_owned(),
            turns.iter().copied().collect(),
        );
    }

    fn seed_resident(&self, name: &str, pubkey: &Hex64, in_room: bool) {
        self.owned.lock().expect("owned").insert(pubkey.clone());
        self.names
            .lock()
            .expect("names")
            .insert(name.to_lowercase(), pubkey.clone());
        self.labels
            .lock()
            .expect("labels")
            .insert(pubkey.as_str().to_owned(), name.to_owned());
        if in_room {
            self.room.lock().expect("room").insert(pubkey.clone());
        }
    }

    fn records(&self) -> Vec<(ExchangeRecordV1, u64)> {
        self.published_records.lock().expect("records").clone()
    }

    fn notes(&self) -> Vec<String> {
        self.published_notes.lock().expect("notes").clone()
    }
}

impl ExchangeRelay for FakeExchangeRelay {
    fn fetch_trigger(&self, _event_id: &Hex64) -> Result<Option<nostr::Event>, ExchangeRelayError> {
        Ok(None)
    }

    fn owner(&self) -> Result<Hex64, ExchangeRelayError> {
        Hex64::parse("ee".repeat(32)).map_err(|_| ExchangeRelayError::Unavailable("owner".into()))
    }

    fn fetch_head(
        &self,
        exchange_id: &Hex64,
        _owner: &Hex64,
    ) -> Result<Option<ExchangeHead>, ExchangeRelayError> {
        Ok(self
            .heads
            .lock()
            .expect("heads")
            .get(exchange_id.as_str())
            .cloned())
    }

    fn spent_turns(&self, record: &ExchangeRecordV1) -> Result<BTreeSet<u8>, ExchangeRelayError> {
        if *self.spent_unavailable.lock().expect("flag") {
            return Err(ExchangeRelayError::Unavailable("no #exchange".to_owned()));
        }
        Ok(self
            .spent
            .lock()
            .expect("spent")
            .get(record.exchange_id.as_str())
            .cloned()
            .unwrap_or_default())
    }

    fn publish_record(
        &self,
        record: &ExchangeRecordV1,
        created_at: u64,
    ) -> Result<Hex64, ExchangeRelayError> {
        if *self.refuse_record.lock().expect("flag") {
            return Err(ExchangeRelayError::Refused(
                "restricted: exchange record must be authored by its owner".to_owned(),
            ));
        }
        self.published_records
            .lock()
            .expect("records")
            .push((record.clone(), created_at));
        self.seed_head(record, created_at);
        Hex64::parse("ee".repeat(32)).map_err(|_| ExchangeRelayError::Unavailable("id".to_owned()))
    }

    fn publish_note(
        &self,
        _conversation_id: &OpaqueId,
        content: &str,
    ) -> Result<(), ExchangeRelayError> {
        self.published_notes
            .lock()
            .expect("notes")
            .push(content.to_owned());
        Ok(())
    }

    fn add_conversation_member(
        &self,
        _conversation_id: &OpaqueId,
        resident: &Hex64,
    ) -> Result<(), ExchangeRelayError> {
        self.added_members
            .lock()
            .expect("added")
            .push(resident.clone());
        self.room.lock().expect("room").insert(resident.clone());
        Ok(())
    }

    fn remove_conversation_member(
        &self,
        _conversation_id: &OpaqueId,
        resident: &Hex64,
    ) -> Result<(), ExchangeRelayError> {
        self.removed_members
            .lock()
            .expect("removed")
            .push(resident.clone());
        self.room.lock().expect("room").remove(resident);
        Ok(())
    }

    fn conversation_members(
        &self,
        _conversation_id: &OpaqueId,
    ) -> Result<BTreeSet<Hex64>, ExchangeRelayError> {
        if *self.room_unavailable.lock().expect("flag") {
            return Err(ExchangeRelayError::Unavailable("no room".to_owned()));
        }
        Ok(self.room.lock().expect("room").clone())
    }

    fn owned_residents(&self) -> Result<BTreeSet<Hex64>, ExchangeRelayError> {
        Ok(self.owned.lock().expect("owned").clone())
    }

    fn resolve_resident_name(
        &self,
        owned: &BTreeSet<Hex64>,
        name: &str,
    ) -> Result<Option<Hex64>, ExchangeRelayError> {
        Ok(self
            .names
            .lock()
            .expect("names")
            .get(&name.to_lowercase())
            .filter(|pubkey| owned.contains(*pubkey))
            .cloned())
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

struct Fixture {
    owner: Hex64,
    luca: Hex64,
    vektor: Hex64,
    kai: Hex64,
    trigger_id: String,
    relay: Arc<FakeExchangeRelay>,
    store: Arc<Mutex<ExchangeStore>>,
    dispatch: Arc<Mutex<ManagedDispatchStore>>,
    _temp: tempfile::TempDir,
}

impl Fixture {
    fn resolver(&self) -> ExchangeResolver<'_> {
        ExchangeResolver::new(self.relay.as_ref(), &self.store, &self.dispatch)
    }

    fn request(&self, draft: &str) -> ManagedMessagePublishRequestV1 {
        self.request_with(draft, vec![self.owner.clone()], None, None)
    }

    fn request_with(
        &self,
        draft: &str,
        mut resolved_p_tags: Vec<Hex64>,
        exchange: Option<ExchangeTurnTag>,
        bucket_hint: Option<u8>,
    ) -> ManagedMessagePublishRequestV1 {
        resolved_p_tags.sort();
        resolved_p_tags.dedup();
        let receipt = OpaqueId::parse(self.trigger_id.clone()).expect("receipt");
        ManagedMessagePublishRequestV1 {
            protocol: MESSAGE_PUBLISH_PROTOCOL.to_owned(),
            turn_id: receipt.clone(),
            idempotency_key: derive_message_publish_idempotency_key(&receipt, &self.luca)
                .expect("idempotency"),
            owner_pubkey: self.owner.clone(),
            resident_pubkey: self.luca.clone(),
            conversation_id: OpaqueId::parse(CHANNEL).expect("channel"),
            thread_id: None,
            root_event_id: Some(Hex64::parse(self.trigger_id.clone()).expect("root")),
            reply_event_id: Some(Hex64::parse(self.trigger_id.clone()).expect("reply")),
            response_surface: Some(ManagedResponseSurfaceV1::Timeline),
            resolved_p_tags,
            final_draft: draft.to_owned(),
            dispatch_receipt_id: receipt,
            cancellation_epoch: SafeU53::new(7).expect("epoch"),
            exchange,
            bucket_hint,
        }
    }

    /// An exchange between Luca and Vektor rooted at the same owner utterance
    /// the fixture's dispatch was staged from.
    fn exchange_record(&self, bucket_hint: Option<u8>) -> ExchangeRecordV1 {
        ExchangeRecordV1::open(
            self.owner.clone(),
            vec![self.luca.clone(), self.vektor.clone()],
            OpaqueId::parse(CHANNEL).expect("channel"),
            Hex64::parse(self.trigger_id.clone()).expect("root"),
            self.luca.clone(),
            bucket_hint,
            NOW,
        )
        .expect("record")
    }
}

fn fixture() -> Fixture {
    let owner_keys = Keys::parse(&"a1".repeat(32)).expect("owner");
    let luca_keys = Keys::parse(&"a2".repeat(32)).expect("luca");
    let vektor = Hex64::parse("3".repeat(64)).expect("vektor");
    let kai = Hex64::parse("4".repeat(64)).expect("kai");
    let trigger = EventBuilder::new(Kind::Custom(9), "owner trigger")
        .tags([
            Tag::parse(["h", CHANNEL]).expect("h"),
            Tag::public_key(owner_keys.public_key()),
            Tag::public_key(luca_keys.public_key()),
        ])
        .custom_created_at(Timestamp::from(NOW - 10))
        .sign_with_keys(&owner_keys)
        .expect("trigger");
    let temp = tempfile::tempdir().expect("temp");
    let mut dispatch =
        ManagedDispatchStore::load(temp.path().join("dispatches.json")).expect("dispatch store");
    dispatch
        .stage_owner_event(&trigger, &[luca_keys.public_key().to_hex()], NOW - 10)
        .expect("stage");
    dispatch
        .activate_session(&luca_keys.public_key().to_hex(), 7)
        .expect("session");
    let owner = Hex64::parse(owner_keys.public_key().to_hex()).expect("owner");
    let luca = Hex64::parse(luca_keys.public_key().to_hex()).expect("luca");
    let relay = Arc::new(FakeExchangeRelay::default());
    relay.room.lock().expect("room").insert(owner.clone());
    relay.room.lock().expect("room").insert(luca.clone());
    relay
        .labels
        .lock()
        .expect("labels")
        .insert(luca.as_str().to_owned(), "Luca".to_owned());
    relay.seed_resident("Vektor", &vektor, true);
    Fixture {
        owner,
        luca,
        vektor,
        kai,
        trigger_id: trigger.id.to_hex(),
        relay,
        store: Arc::new(Mutex::new(ExchangeStore::in_memory())),
        dispatch: Arc::new(Mutex::new(dispatch)),
        _temp: temp,
    }
}

// ── mention scanning ────────────────────────────────────────────────────────

#[test]
fn mentions_are_found_at_word_boundaries_and_deduplicated() {
    assert_eq!(
        mentioned_names("ask @Vektor whether the atlas covers Hermes"),
        vec!["Vektor".to_owned()]
    );
    assert_eq!(
        mentioned_names("@Vektor, @vektor and @Vektor."),
        vec!["Vektor".to_owned()]
    );
    assert_eq!(
        mentioned_names("write to luca@example.test"),
        Vec::<String>::new()
    );
    assert_eq!(mentioned_names("nothing to see"), Vec::<String>::new());
    assert_eq!(
        mentioned_names("(@Kai) and [@Vektor]"),
        vec!["Kai".to_owned(), "Vektor".to_owned()]
    );
    assert_eq!(mentioned_names("@"), Vec::<String>::new());
    assert!(mentioned_names(&format!("@{}", "n".repeat(200))).is_empty());
}

// ── D2 · mint ───────────────────────────────────────────────────────────────

#[test]
fn mentioning_a_resident_who_is_here_mints_one_exchange_and_tags_turn_one() {
    let fixture = fixture();
    let request = fixture.request("I'll ask @Vektor about the runtime atlas.");
    let plan = fixture.resolver().resolve(&request, NOW).expect("plan");

    let records = fixture.relay.records();
    assert_eq!(records.len(), 1, "one owner-signed record, published first");
    let (record, created_at) = &records[0];
    assert_eq!(record.members, {
        let mut members = vec![fixture.luca.clone(), fixture.vektor.clone()];
        members.sort();
        members
    });
    assert_eq!(record.bucket, luca_protocol::EXCHANGE_DEFAULT_BUCKET);
    assert_eq!(record.opened_by, fixture.luca);
    assert_eq!(record.root_event_id.as_str(), fixture.trigger_id);
    assert_eq!(*created_at, NOW);

    let turn = plan.exchange.clone().expect("turn tag");
    assert_eq!(turn.turn, 1);
    assert_eq!(turn.exchange_id, record.exchange_id);
    assert_eq!(plan.granted_p_tags, vec![fixture.vektor.clone()]);

    // The reply now addresses the owner and the sibling, and carries the tag.
    let effective = plan.apply(&request).expect("effective request");
    assert!(effective.resolved_p_tags.contains(&fixture.vektor));
    assert!(effective.resolved_p_tags.contains(&fixture.owner));
    assert_eq!(effective.exchange, Some(turn));

    // The dispatch's pinned audience was widened under the exchange's authority.
    let dispatch_recipients = fixture
        .dispatch
        .lock()
        .expect("dispatch")
        .grant_exchange_recipients(&fixture.trigger_id, fixture.luca.as_str(), &[], NOW)
        .expect("read back");
    assert!(dispatch_recipients.contains(&fixture.vektor.as_str().to_owned()));
}

#[test]
fn a_replayed_final_reads_the_frozen_decision_and_mints_nothing_twice() {
    let fixture = fixture();
    let request = fixture.request("I'll ask @Vektor about the runtime atlas.");
    let first = fixture.resolver().resolve(&request, NOW).expect("first");
    let replay = fixture
        .resolver()
        .resolve(&request, NOW + 600)
        .expect("replay");
    assert_eq!(first, replay, "a replay produces identical bytes");
    assert_eq!(fixture.relay.records().len(), 1);
}

#[test]
fn the_owner_can_ask_for_a_bigger_bucket_and_never_past_the_ceiling() {
    for (hint, expected) in [(9_u8, 9_u8), (10, luca_protocol::EXCHANGE_BUCKET_CEILING)] {
        let fixture = fixture();
        let request = fixture.request_with(
            "@Vektor, take your time.",
            vec![fixture.owner.clone()],
            None,
            Some(hint),
        );
        fixture.resolver().resolve(&request, NOW).expect("plan");
        assert_eq!(fixture.relay.records()[0].0.bucket, expected);
    }
}

#[test]
fn mentioning_someone_who_is_not_here_visits_and_mints_in_the_same_room() {
    let fixture = fixture();
    fixture.relay.seed_resident("Kai", &fixture.kai, false);
    let request = fixture.request("Maybe @Kai knows.");
    let plan = fixture.resolver().resolve(&request, NOW).expect("plan");
    let record = &fixture.relay.records()[0].0;
    assert_eq!(record.conversation_id.as_str(), CHANNEL);
    assert_eq!(plan.exchange.expect("turn").exchange_id, record.exchange_id);
    assert_eq!(plan.granted_p_tags, vec![fixture.kai.clone()]);
    assert_eq!(
        fixture
            .relay
            .added_members
            .lock()
            .expect("added")
            .as_slice(),
        std::slice::from_ref(&fixture.kai)
    );
    let notes = fixture.relay.notes();
    assert_eq!(notes.len(), 1);
    let note: serde_json::Value = serde_json::from_str(&notes[0]).expect("visit note");
    assert_eq!(note["type"], "visit_arrived");
    assert_eq!(note["resident"], fixture.kai.as_str());
    assert_eq!(note["exchange_id"], record.exchange_id.as_str());
}

#[test]
fn a_replayed_visit_adds_and_announces_the_guest_once() {
    let fixture = fixture();
    fixture.relay.seed_resident("Kai", &fixture.kai, false);
    let request = fixture.request("Maybe @Kai knows.");
    let first = fixture.resolver().resolve(&request, NOW).expect("first");
    let replay = fixture
        .resolver()
        .resolve(&request, NOW + 60)
        .expect("replay");
    assert_eq!(first, replay);
    assert_eq!(fixture.relay.added_members.lock().expect("added").len(), 1);
    assert_eq!(fixture.relay.notes().len(), 1);
    assert_eq!(fixture.relay.records().len(), 1);
}

#[test]
fn a_stranger_is_not_a_resident_and_changes_nothing() {
    let fixture = fixture();
    let request = fixture.request("Ask @Somebody about it.");
    let plan = fixture.resolver().resolve(&request, NOW).expect("plan");
    assert_eq!(plan, ExchangePlan::unchanged());
    assert!(fixture.relay.records().is_empty());
    assert!(fixture.relay.notes().is_empty());
}

#[test]
fn a_room_we_cannot_read_refuses_the_mint_rather_than_guessing() {
    let fixture = fixture();
    *fixture.relay.room_unavailable.lock().expect("flag") = true;
    let request = fixture.request("I'll ask @Vektor.");
    assert_eq!(
        fixture.resolver().resolve(&request, NOW),
        Err(ExchangeDenial::MintRefused)
    );
}

#[test]
fn a_refused_record_is_a_refused_mint() {
    let fixture = fixture();
    *fixture.relay.refuse_record.lock().expect("flag") = true;
    let request = fixture.request("I'll ask @Vektor.");
    assert_eq!(
        fixture.resolver().resolve(&request, NOW),
        Err(ExchangeDenial::MintRefused)
    );
    assert!(fixture.relay.records().is_empty());
}

#[test]
fn a_dispatch_we_cannot_read_is_refused_rather_than_assumed_owner_triggered() {
    let fixture = fixture();
    let request = fixture.request("Here's what I found.");
    let unknown_dispatch = Arc::new(Mutex::new(
        ManagedDispatchStore::load(fixture._temp.path().join("empty.json")).expect("empty store"),
    ));
    let resolver = ExchangeResolver::new(fixture.relay.as_ref(), &fixture.store, &unknown_dispatch);
    assert_eq!(
        resolver.resolve(&request, NOW),
        Err(ExchangeDenial::Unavailable)
    );
}

// ── D1 · continue ───────────────────────────────────────────────────────────

#[test]
fn a_turn_inside_an_open_exchange_is_tagged_as_proposed() {
    let fixture = fixture();
    let record = fixture.exchange_record(None);
    fixture.relay.seed_head(&record, NOW);
    fixture.relay.seed_spent(&record, &[1]);
    let request = fixture.request_with(
        "Yes, it covers Hermes.",
        vec![fixture.vektor.clone()],
        Some(ExchangeTurnTag::new(record.exchange_id.clone(), 2).expect("turn")),
        None,
    );
    let plan = fixture.resolver().resolve(&request, NOW).expect("plan");
    assert_eq!(plan.exchange.expect("turn").turn, 2);
    assert!(plan.granted_p_tags.is_empty());
}

#[test]
fn the_closing_line_at_the_bucket_is_published() {
    let fixture = fixture();
    let record = fixture.exchange_record(None);
    fixture.relay.seed_head(&record, NOW);
    fixture.relay.seed_spent(&record, &[1, 2]);
    let closing = fixture.request_with(
        "Last word.",
        vec![fixture.vektor.clone()],
        Some(ExchangeTurnTag::new(record.exchange_id.clone(), 3).expect("turn")),
        None,
    );
    assert_eq!(
        fixture
            .resolver()
            .resolve(&closing, NOW)
            .expect("plan")
            .exchange
            .expect("turn")
            .turn,
        3
    );
}

#[test]
fn the_turn_past_the_bucket_is_exhausted() {
    let fixture = fixture();
    let record = fixture.exchange_record(None);
    fixture.relay.seed_head(&record, NOW);
    fixture.relay.seed_spent(&record, &[1, 2, 3]);
    let past = fixture.request_with(
        "One more.",
        vec![fixture.vektor.clone()],
        Some(ExchangeTurnTag::new(record.exchange_id.clone(), 4).expect("turn")),
        None,
    );
    assert_eq!(
        fixture.resolver().resolve(&past, NOW),
        Err(ExchangeDenial::Exhausted)
    );
}

#[test]
fn a_turn_somebody_already_spoke_moves_to_the_next_free_one() {
    let fixture = fixture();
    let record = fixture.exchange_record(None);
    fixture.relay.seed_head(&record, NOW);
    fixture.relay.seed_spent(&record, &[1, 2]);
    let request = fixture.request_with(
        "Mine.",
        vec![fixture.vektor.clone()],
        Some(ExchangeTurnTag::new(record.exchange_id.clone(), 2).expect("turn")),
        None,
    );
    assert_eq!(
        fixture
            .resolver()
            .resolve(&request, NOW)
            .expect("plan")
            .exchange
            .expect("turn")
            .turn,
        3
    );
}

#[test]
fn a_collision_with_no_free_turn_left_is_exhausted() {
    let fixture = fixture();
    let record = fixture.exchange_record(None);
    fixture.relay.seed_head(&record, NOW);
    fixture.relay.seed_spent(&record, &[1, 2, 3]);
    let request = fixture.request_with(
        "Mine.",
        vec![fixture.vektor.clone()],
        Some(ExchangeTurnTag::new(record.exchange_id.clone(), 3).expect("turn")),
        None,
    );
    assert_eq!(
        fixture.resolver().resolve(&request, NOW),
        Err(ExchangeDenial::Exhausted)
    );
}

#[test]
fn a_stopped_exchange_holds_the_reply() {
    let fixture = fixture();
    let record = fixture.exchange_record(None).stopped();
    fixture.relay.seed_head(&record, NOW);
    let request = fixture.request_with(
        "Too late.",
        vec![fixture.vektor.clone()],
        Some(ExchangeTurnTag::new(record.exchange_id.clone(), 2).expect("turn")),
        None,
    );
    assert_eq!(
        fixture.resolver().resolve(&request, NOW),
        Err(ExchangeDenial::Closed)
    );
}

#[test]
fn an_expired_exchange_holds_the_reply() {
    let fixture = fixture();
    let record = fixture.exchange_record(None);
    fixture.relay.seed_head(&record, NOW);
    let request = fixture.request_with(
        "Too late.",
        vec![fixture.vektor.clone()],
        Some(ExchangeTurnTag::new(record.exchange_id.clone(), 2).expect("turn")),
        None,
    );
    assert_eq!(
        fixture
            .resolver()
            .resolve(&request, record.deadline.get() + 1),
        Err(ExchangeDenial::Expired)
    );
}

#[test]
fn an_exchange_nobody_signed_is_unknown() {
    let fixture = fixture();
    let request = fixture.request_with(
        "Hello?",
        vec![fixture.vektor.clone()],
        Some(ExchangeTurnTag::new(Hex64::parse("9".repeat(64)).expect("id"), 1).expect("turn")),
        None,
    );
    assert_eq!(
        fixture.resolver().resolve(&request, NOW),
        Err(ExchangeDenial::Unknown)
    );
}

#[test]
fn an_exchange_that_lives_in_another_room_is_unknown_here() {
    let fixture = fixture();
    let record = ExchangeRecordV1::open(
        fixture.owner.clone(),
        vec![fixture.luca.clone(), fixture.vektor.clone()],
        OpaqueId::parse("22222222-2222-4222-8222-222222222222").expect("other channel"),
        Hex64::parse(fixture.trigger_id.clone()).expect("root"),
        fixture.luca.clone(),
        None,
        NOW,
    )
    .expect("record");
    fixture.relay.seed_head(&record, NOW);
    let request = fixture.request_with(
        "Wrong room.",
        vec![fixture.vektor.clone()],
        Some(ExchangeTurnTag::new(record.exchange_id.clone(), 2).expect("turn")),
        None,
    );
    assert_eq!(
        fixture.resolver().resolve(&request, NOW),
        Err(ExchangeDenial::Unknown)
    );
}

#[test]
fn addressing_someone_outside_the_members_is_refused() {
    let fixture = fixture();
    let record = fixture.exchange_record(None);
    fixture.relay.seed_head(&record, NOW);
    // The owner is never a member, so a reply addressed to the owner from
    // inside an exchange is refused here rather than at the relay.
    let request = fixture.request_with(
        "For you.",
        vec![fixture.owner.clone()],
        Some(ExchangeTurnTag::new(record.exchange_id.clone(), 2).expect("turn")),
        None,
    );
    assert_eq!(
        fixture.resolver().resolve(&request, NOW),
        Err(ExchangeDenial::NotMember)
    );
}

#[test]
fn a_relay_that_cannot_count_the_spent_turns_refuses_rather_than_publishes_untagged() {
    let fixture = fixture();
    let record = fixture.exchange_record(None);
    fixture.relay.seed_head(&record, NOW);
    *fixture.relay.spent_unavailable.lock().expect("flag") = true;
    let request = fixture.request_with(
        "Anything.",
        vec![fixture.vektor.clone()],
        Some(ExchangeTurnTag::new(record.exchange_id.clone(), 2).expect("turn")),
        None,
    );
    assert_eq!(
        fixture.resolver().resolve(&request, NOW),
        Err(ExchangeDenial::Unavailable)
    );
}

#[test]
fn naming_a_third_resident_from_inside_an_exchange_mints_a_second_exchange_in_place() {
    let fixture = fixture();
    fixture.relay.seed_resident("Kai", &fixture.kai, true);
    let record = fixture.exchange_record(None);
    fixture.relay.seed_head(&record, NOW);
    let request = fixture.request_with(
        "Good question — @Kai would know.",
        vec![fixture.vektor.clone()],
        Some(ExchangeTurnTag::new(record.exchange_id.clone(), 2).expect("turn")),
        None,
    );
    let plan = fixture.resolver().resolve(&request, NOW).expect("plan");
    let new_turn = plan.exchange.clone().expect("turn");
    assert_eq!(new_turn.turn, 1);
    assert_ne!(new_turn.exchange_id, record.exchange_id);
    assert_eq!(plan.granted_p_tags, vec![fixture.kai.clone()]);
    let effective = plan.apply(&request).expect("effective fresh exchange");
    assert_eq!(effective.resolved_p_tags, vec![fixture.kai.clone()]);
    let records = fixture.relay.records();
    assert_eq!(
        records.len(),
        1,
        "the original was seeded; one fresh record publishes"
    );
    assert_eq!(records[0].0.conversation_id.as_str(), CHANNEL);
    assert_eq!(records[0].0.depth, 2);
    assert_eq!(
        records[0].0.parent_exchange_id,
        Some(record.exchange_id.clone())
    );
    assert_eq!(records[0].0.members, {
        let mut members = vec![fixture.luca.clone(), fixture.kai.clone()];
        members.sort();
        members
    });
    assert!(
        fixture.relay.notes().is_empty(),
        "an in-room resident needs no visit note"
    );
}

#[test]
fn naming_an_absent_third_resident_visits_then_mints_a_second_exchange_here() {
    let fixture = fixture();
    fixture.relay.seed_resident("Kai", &fixture.kai, false);
    let record = fixture.exchange_record(None);
    fixture.relay.seed_head(&record, NOW);
    let request = fixture.request_with(
        "Good question — @Kai would know.",
        vec![fixture.vektor.clone()],
        Some(ExchangeTurnTag::new(record.exchange_id.clone(), 2).expect("turn")),
        None,
    );

    let plan = fixture.resolver().resolve(&request, NOW).expect("plan");
    let fresh = &fixture.relay.records()[0].0;
    assert_ne!(fresh.exchange_id, record.exchange_id);
    assert_eq!(fresh.conversation_id.as_str(), CHANNEL);
    assert_eq!(fresh.depth, 2);
    assert_eq!(fresh.parent_exchange_id, Some(record.exchange_id.clone()));
    assert_eq!(plan.granted_p_tags, vec![fixture.kai.clone()]);
    assert_eq!(fixture.relay.added_members.lock().expect("added").len(), 1);
    let note: serde_json::Value =
        serde_json::from_str(&fixture.relay.notes()[0]).expect("visit note");
    assert_eq!(note["type"], "visit_arrived");
    assert_eq!(note["exchange_id"], fresh.exchange_id.as_str());
}

// ── the retune after a lost race ────────────────────────────────────────────

#[test]
fn retuning_picks_the_next_free_turn_and_records_it() {
    let fixture = fixture();
    let record = fixture.exchange_record(None);
    fixture.relay.seed_head(&record, NOW);
    fixture.relay.seed_spent(&record, &[1]);
    let request = fixture.request_with(
        "Mine.",
        vec![fixture.vektor.clone()],
        Some(ExchangeTurnTag::new(record.exchange_id.clone(), 2).expect("turn")),
        None,
    );
    fixture.resolver().resolve(&request, NOW).expect("plan");
    // Someone else reached turn 2 first.
    fixture.relay.seed_spent(&record, &[1, 2]);
    let retuned = fixture
        .resolver()
        .retune_turn(&request, NOW)
        .expect("retune");
    assert_eq!(retuned.turn, 3);
    let key = decision_key(request.dispatch_receipt_id.as_str(), fixture.luca.as_str());
    assert_eq!(
        fixture
            .store
            .lock()
            .expect("store")
            .decision(&key)
            .expect("decision")
            .exchange
            .clone()
            .expect("turn")
            .turn,
        3,
        "a replay must land on the same retuned turn"
    );
}

#[test]
fn retuning_after_a_stop_holds_the_reply_instead_of_finding_a_turn() {
    let fixture = fixture();
    let record = fixture.exchange_record(None);
    fixture.relay.seed_head(&record, NOW);
    let request = fixture.request_with(
        "Mine.",
        vec![fixture.vektor.clone()],
        Some(ExchangeTurnTag::new(record.exchange_id.clone(), 2).expect("turn")),
        None,
    );
    fixture.resolver().resolve(&request, NOW).expect("plan");
    // The owner said "Stop here" while the first attempt was in flight.
    fixture.relay.seed_head(&record.stopped(), NOW + 1);
    assert_eq!(
        fixture.resolver().retune_turn(&request, NOW + 2),
        Err(ExchangeDenial::Closed)
    );
}

#[test]
fn retuning_with_every_turn_spoken_is_exhausted() {
    let fixture = fixture();
    let record = fixture.exchange_record(None);
    fixture.relay.seed_head(&record, NOW);
    let request = fixture.request_with(
        "Mine.",
        vec![fixture.vektor.clone()],
        Some(ExchangeTurnTag::new(record.exchange_id.clone(), 1).expect("turn")),
        None,
    );
    fixture.resolver().resolve(&request, NOW).expect("plan");
    fixture.relay.seed_spent(&record, &[1, 2, 3]);
    assert_eq!(
        fixture.resolver().retune_turn(&request, NOW),
        Err(ExchangeDenial::Exhausted)
    );
}

// ── applying the plan ───────────────────────────────────────────────────────

#[test]
fn an_unchanged_plan_leaves_the_request_byte_identical() {
    let fixture = fixture();
    let request = fixture.request("nothing to see");
    assert_eq!(
        ExchangePlan::unchanged().apply(&request).expect("apply"),
        request
    );
}

#[test]
fn applying_a_plan_keeps_the_recipients_sorted_and_unique() {
    let fixture = fixture();
    let request = fixture.request("hello");
    let plan = ExchangePlan {
        exchange: Some(ExchangeTurnTag::new(Hex64::parse("7".repeat(64)).unwrap(), 1).unwrap()),
        granted_p_tags: vec![fixture.vektor.clone(), fixture.owner.clone()],
        replace_p_tags: false,
    };
    let effective = plan.apply(&request).expect("apply");
    assert!(effective
        .resolved_p_tags
        .windows(2)
        .all(|pair| pair[0] < pair[1]));
    assert_eq!(effective.resolved_p_tags.len(), 2);
    effective
        .validate()
        .expect("the effective request is valid");
}
