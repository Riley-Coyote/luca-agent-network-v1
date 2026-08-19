use super::*;

use std::collections::BTreeMap;

use luca_protocol::{ExchangeStateV1, EXCHANGE_DEFAULT_BUCKET, EXCHANGE_GO_INCREMENT};

use super::super::exchange_relay::ExchangeRelayError;

const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const LUCA: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const VEKTOR: &str = "3333333333333333333333333333333333333333333333333333333333333333";
const KAI: &str = "4444444444444444444444444444444444444444444444444444444444444444";
const CHANNEL: &str = "11111111-1111-4111-8111-111111111111";
const NOW: u64 = 1_700_000_000;

fn hex(value: &str) -> Hex64 {
    Hex64::parse(value).expect("fixture hex64")
}

fn room(members: &[&str]) -> BTreeSet<Hex64> {
    members.iter().map(|value| hex(value)).collect()
}

#[test]
fn everyone_addressed_is_already_here_so_the_exchange_stays_in_place() {
    let placement = place_exchange(
        &room(&[OWNER, LUCA, VEKTOR]),
        &[hex(VEKTOR)],
        &hex(OWNER),
        &hex(LUCA),
    );
    assert_eq!(
        placement,
        Placement::InPlace {
            members: vec![hex(VEKTOR)]
        }
    );
}

#[test]
fn placement_is_order_independent_and_deduplicated() {
    let addressed = [hex(VEKTOR), hex(KAI), hex(VEKTOR)];
    let placement = place_exchange(
        &room(&[OWNER, LUCA, VEKTOR, KAI]),
        &addressed,
        &hex(OWNER),
        &hex(LUCA),
    );
    assert_eq!(
        placement,
        Placement::InPlace {
            members: vec![hex(VEKTOR), hex(KAI)]
        }
    );
}

#[test]
fn one_person_elsewhere_is_a_pair_dm_with_the_owner_and_whoever_spoke() {
    let placement = place_exchange(
        &room(&[OWNER, LUCA]),
        &[hex(VEKTOR)],
        &hex(OWNER),
        &hex(LUCA),
    );
    assert_eq!(
        placement,
        Placement::PairDm {
            // Sorted: OWNER, then the speaker, then the resident elsewhere. A
            // pair DM without the resident who did the addressing would not be
            // the conversation anybody asked for.
            participants: vec![hex(OWNER), hex(LUCA), hex(VEKTOR)]
        }
    );
}

#[test]
fn the_speaker_is_never_listed_twice_in_a_pair_dm() {
    // The speaker is in the origin room, so they can never be "outside" — but
    // the union must still be a set if that ever changes.
    let placement = place_exchange(&room(&[OWNER]), &[hex(LUCA)], &hex(OWNER), &hex(LUCA));
    assert_eq!(
        placement,
        Placement::PairDm {
            participants: vec![hex(OWNER), hex(LUCA)]
        }
    );
}

#[test]
fn two_people_elsewhere_need_a_room_of_their_own() {
    let placement = place_exchange(
        &room(&[OWNER, LUCA]),
        &[hex(KAI), hex(VEKTOR)],
        &hex(OWNER),
        &hex(LUCA),
    );
    assert_eq!(
        placement,
        Placement::NeedsProjectRoom {
            addressed: vec![hex(VEKTOR), hex(KAI)]
        }
    );
}

#[test]
fn addressing_nobody_places_nobody() {
    assert_eq!(
        place_exchange(&room(&[OWNER, LUCA]), &[], &hex(OWNER), &hex(LUCA)),
        Placement::InPlace { members: vec![] }
    );
}

#[test]
fn every_denial_has_a_code_the_protocol_accepts_and_a_sentence_to_read() {
    for denial in [
        ExchangeDenial::Unknown,
        ExchangeDenial::NotMember,
        ExchangeDenial::Closed,
        ExchangeDenial::Expired,
        ExchangeDenial::Exhausted,
        ExchangeDenial::MintRefused,
        ExchangeDenial::Unavailable,
    ] {
        OpaqueId::parse(denial.code()).expect("denial code must be a valid opaque id");
        assert!(
            denial.sentence().len() > 20,
            "every refusal owes the resident a sentence"
        );
    }
    assert_eq!(ExchangeDenial::Closed.code(), "exchange_closed");
    assert_eq!(ExchangeDenial::Exhausted.code(), "exchange_exhausted");
}

#[test]
fn the_absent_mention_note_says_asking_across_rooms_comes_next() {
    let note = ExchangeNote::mentioned_someone_absent(hex(LUCA), "Luca", "Vektor");
    assert_eq!(
        note.text,
        "Luca mentioned Vektor, who isn't here — asking across rooms comes next."
    );
    let content: serde_json::Value =
        serde_json::from_str(&note.to_content()).expect("note content is JSON");
    assert_eq!(content["type"], "exchange-note");
    assert_eq!(content["resident"], LUCA);
    assert!(content["exchange_id"].is_null());
    assert_eq!(content["text"], note.text);
}

#[test]
fn the_third_resident_note_says_one_hop_is_the_limit() {
    let note = ExchangeNote::mentioned_a_third(Some(hex(KAI)), hex(LUCA), "Luca", "Kai");
    assert_eq!(
        note.text,
        "Luca mentioned Kai — one hop is the limit for now."
    );
    let content: serde_json::Value =
        serde_json::from_str(&note.to_content()).expect("note content is JSON");
    assert_eq!(content["exchange_id"], KAI);
}

#[test]
fn a_held_reply_is_announced_rather_than_dropped() {
    let note = ExchangeNote::reply_was_held(
        Some(hex(KAI)),
        hex(VEKTOR),
        "Vektor",
        ExchangeDenial::Closed,
    )
    .expect("a stopped exchange owes the room a sentence");
    assert_eq!(
        note.text,
        "Vektor's reply was held — the exchange was stopped."
    );
    let content: serde_json::Value =
        serde_json::from_str(&note.to_content()).expect("note content is JSON");
    assert_eq!(content["resident"], VEKTOR);
}

#[test]
fn the_room_hears_the_reason_it_was_held_and_not_a_stock_sentence() {
    let sentence = |denial| {
        ExchangeNote::reply_was_held(Some(hex(KAI)), hex(VEKTOR), "Vektor", denial)
            .map(|note| note.text)
    };
    assert_eq!(
        sentence(ExchangeDenial::Closed).as_deref(),
        Some("Vektor's reply was held — the exchange was stopped.")
    );
    assert_eq!(
        sentence(ExchangeDenial::Expired).as_deref(),
        Some("Vektor's reply was held — the exchange expired.")
    );
    assert_eq!(
        sentence(ExchangeDenial::Exhausted).as_deref(),
        Some("Vektor's reply was held — the exchange is paused.")
    );
    assert_eq!(
        sentence(ExchangeDenial::NotMember).as_deref(),
        Some("Vektor's reply was held — it was outside any open exchange.")
    );
    assert_eq!(
        sentence(ExchangeDenial::Unknown).as_deref(),
        Some("Vektor's reply was held — it was outside any open exchange.")
    );
    // Nothing was decided about the reply in these two, and the authority that
    // would carry the sentence is the one that just failed.
    assert_eq!(sentence(ExchangeDenial::MintRefused), None);
    assert_eq!(sentence(ExchangeDenial::Unavailable), None);
}

#[test]
fn the_relays_exchange_refusals_are_read_exactly() {
    assert_eq!(
        classify_exchange_refusal("restricted: exchange turn already spoken"),
        Some(ExchangeRefusal::TurnTaken)
    );
    assert_eq!(
        classify_exchange_refusal("restricted: exchange closed"),
        Some(ExchangeRefusal::Held(ExchangeDenial::Closed))
    );
    assert_eq!(
        classify_exchange_refusal("restricted: exchange expired"),
        Some(ExchangeRefusal::Held(ExchangeDenial::Expired))
    );
    assert_eq!(
        classify_exchange_refusal("restricted: exchange exhausted"),
        Some(ExchangeRefusal::Held(ExchangeDenial::Exhausted))
    );
    assert_eq!(
        classify_exchange_refusal("restricted: exchange: not a member"),
        Some(ExchangeRefusal::Held(ExchangeDenial::NotMember))
    );
    // A refusal we have never seen is still held — never retried around.
    assert_eq!(
        classify_exchange_refusal("restricted: exchange: something new"),
        Some(ExchangeRefusal::Held(ExchangeDenial::Unknown))
    );
    assert_eq!(classify_exchange_refusal("invalid: bad signature"), None);
    assert_eq!(classify_exchange_refusal(""), None);
}

// ── the owner's controls ────────────────────────────────────────────────────

/// A relay whose head can be seeded, made unreadable, or made to keep its own
/// record when a replaceable write is dominated.
#[derive(Default)]
struct StubRelay {
    heads: Mutex<BTreeMap<String, ExchangeHead>>,
    head_unavailable: Mutex<bool>,
    dominate_writes: Mutex<bool>,
    spent: Mutex<BTreeSet<u8>>,
    published: Mutex<Vec<(ExchangeRecordV1, u64)>>,
}

impl StubRelay {
    fn seed_head(&self, record: &ExchangeRecordV1, created_at: u64) {
        self.heads.lock().expect("heads").insert(
            record.exchange_id.as_str().to_owned(),
            head_of(record, created_at),
        );
    }

    fn set<T>(cell: &Mutex<T>, value: T) {
        *cell.lock().expect("flag") = value;
    }

    fn published(&self) -> Vec<(ExchangeRecordV1, u64)> {
        self.published.lock().expect("published").clone()
    }
}

impl ExchangeRelay for StubRelay {
    fn fetch_head(
        &self,
        exchange_id: &Hex64,
        _owner: &Hex64,
    ) -> Result<Option<ExchangeHead>, ExchangeRelayError> {
        if *self.head_unavailable.lock().expect("flag") {
            return Err(ExchangeRelayError::Unavailable("no relay".to_owned()));
        }
        Ok(self
            .heads
            .lock()
            .expect("heads")
            .get(exchange_id.as_str())
            .cloned())
    }

    fn spent_turns(&self, _record: &ExchangeRecordV1) -> Result<BTreeSet<u8>, ExchangeRelayError> {
        Ok(self.spent.lock().expect("spent").clone())
    }

    fn publish_record(
        &self,
        record: &ExchangeRecordV1,
        created_at: u64,
    ) -> Result<Hex64, ExchangeRelayError> {
        self.published
            .lock()
            .expect("published")
            .push((record.clone(), created_at));
        if !*self.dominate_writes.lock().expect("flag") {
            self.seed_head(record, created_at);
        }
        Hex64::parse("ee".repeat(32)).map_err(|_| ExchangeRelayError::Unavailable("id".to_owned()))
    }

    fn publish_note(
        &self,
        _conversation_id: &OpaqueId,
        _content: &str,
    ) -> Result<(), ExchangeRelayError> {
        Ok(())
    }

    fn conversation_members(
        &self,
        _conversation_id: &OpaqueId,
    ) -> Result<BTreeSet<Hex64>, ExchangeRelayError> {
        Err(ExchangeRelayError::Unavailable("not used here".to_owned()))
    }

    fn owned_residents(&self) -> Result<BTreeSet<Hex64>, ExchangeRelayError> {
        Err(ExchangeRelayError::Unavailable("not used here".to_owned()))
    }

    fn resolve_resident_name(
        &self,
        _owned: &BTreeSet<Hex64>,
        _name: &str,
    ) -> Result<Option<Hex64>, ExchangeRelayError> {
        Ok(None)
    }

    fn display_name(&self, _pubkey: &Hex64) -> String {
        "Vektor".to_owned()
    }
}

fn open_record() -> ExchangeRecordV1 {
    ExchangeRecordV1::open(
        hex(OWNER),
        vec![hex(LUCA), hex(VEKTOR)],
        OpaqueId::parse(CHANNEL).expect("channel"),
        hex(KAI),
        hex(LUCA),
        None,
        NOW,
    )
    .expect("record")
}

fn head_of(record: &ExchangeRecordV1, created_at: u64) -> ExchangeHead {
    ExchangeHead {
        record: record.clone(),
        created_at,
        event_id: Hex64::parse("ee".repeat(32)).expect("event id"),
    }
}

fn empty_store() -> Arc<Mutex<ExchangeStore>> {
    Arc::new(Mutex::new(ExchangeStore::in_memory()))
}

#[test]
fn stop_acts_on_the_head_the_relay_holds_not_the_one_this_desktop_cached() {
    let record = open_record();
    let continued = record
        .continued(NOW)
        .expect("continue")
        .expect("not at the ceiling");
    let store = empty_store();
    store
        .lock()
        .expect("store")
        .upsert_head(head_of(&record, NOW))
        .expect("seed the stale local head");
    let relay = StubRelay::default();
    // Another device already pressed Go; the relay's head is the newer one.
    relay.seed_head(&continued, NOW + 5);

    let snapshot = apply_owner_decision(
        &relay,
        &store,
        &record.exchange_id,
        &hex(OWNER),
        "stop",
        NOW + 10,
    )
    .expect("stop");

    assert_eq!(
        snapshot.record.bucket,
        EXCHANGE_DEFAULT_BUCKET + EXCHANGE_GO_INCREMENT,
        "the Stop is derived from the relay's head, not the cached one"
    );
    assert_eq!(snapshot.record.state, ExchangeStateV1::Closed);
    assert_eq!(snapshot.phase, ExchangePhase::Closed);
    let published = relay.published();
    assert_eq!(published.len(), 1);
    assert!(
        published[0].1 > NOW + 5,
        "the re-signed head is strictly newer than the head it replaces"
    );
}

#[test]
fn a_dominated_write_reports_the_head_the_relay_kept() {
    let record = open_record();
    let store = empty_store();
    let relay = StubRelay::default();
    relay.seed_head(&record, NOW);
    // The relay accepts the submission and keeps the head it already had.
    StubRelay::set(&relay.dominate_writes, true);

    let snapshot = apply_owner_decision(
        &relay,
        &store,
        &record.exchange_id,
        &hex(OWNER),
        "stop",
        NOW + 10,
    )
    .expect("stop");

    assert_eq!(relay.published().len(), 1, "the Stop really was submitted");
    assert_eq!(
        snapshot.record, record,
        "a write the relay dominated is reported as the relay's head, not as our guess"
    );
    assert_eq!(snapshot.phase, ExchangePhase::Open);
    assert_eq!(
        store
            .lock()
            .expect("store")
            .head(&record.exchange_id)
            .map(|head| head.record.clone()),
        Some(record),
        "the local copy is corrected to whatever the relay kept"
    );
}

#[test]
fn a_relay_that_cannot_be_read_answers_from_the_copy_this_desktop_holds() {
    let record = open_record();
    let store = empty_store();
    store
        .lock()
        .expect("store")
        .upsert_head(head_of(&record, NOW))
        .expect("seed");
    let relay = StubRelay::default();
    StubRelay::set(&relay.head_unavailable, true);

    let snapshot = read_exchange(&relay, &store, &record.exchange_id, &hex(OWNER), NOW)
        .expect("read")
        .expect("the cached head answers when the relay cannot");
    assert_eq!(snapshot.record, record);
}

#[test]
fn a_relay_that_holds_no_head_is_unknown_even_when_the_cache_remembers_one() {
    let record = open_record();
    let store = empty_store();
    store
        .lock()
        .expect("store")
        .upsert_head(head_of(&record, NOW))
        .expect("seed");
    let relay = StubRelay::default();

    assert!(
        read_exchange(&relay, &store, &record.exchange_id, &hex(OWNER), NOW)
            .expect("read")
            .is_none(),
        "the relay is the truth: no head there means no exchange here"
    );
    assert_eq!(
        apply_owner_decision(
            &relay,
            &store,
            &record.exchange_id,
            &hex(OWNER),
            "stop",
            NOW
        )
        .err()
        .as_deref(),
        Some("that exchange is not one of ours")
    );
}

#[test]
fn go_at_the_ceiling_refuses_and_publishes_nothing() {
    let mut record = open_record();
    record.bucket = luca_protocol::EXCHANGE_BUCKET_CEILING;
    let store = empty_store();
    let relay = StubRelay::default();
    relay.seed_head(&record, NOW);

    assert_eq!(
        apply_owner_decision(&relay, &store, &record.exchange_id, &hex(OWNER), "go", NOW)
            .err()
            .as_deref(),
        Some("at the ceiling")
    );
    assert!(relay.published().is_empty());
}

#[test]
fn an_action_nobody_defined_changes_nothing() {
    let record = open_record();
    let store = empty_store();
    let relay = StubRelay::default();
    relay.seed_head(&record, NOW);

    assert_eq!(
        apply_owner_decision(
            &relay,
            &store,
            &record.exchange_id,
            &hex(OWNER),
            "pause",
            NOW
        )
        .err()
        .as_deref(),
        Some("unknown exchange action: pause")
    );
    assert!(relay.published().is_empty());
}

#[test]
fn a_head_somebody_else_signed_is_never_acted_on() {
    let record = open_record();
    let store = empty_store();
    let relay = StubRelay::default();
    relay.seed_head(&record, NOW);

    assert_eq!(
        apply_owner_decision(&relay, &store, &record.exchange_id, &hex(KAI), "stop", NOW)
            .err()
            .as_deref(),
        Some("that exchange was signed by somebody else")
    );
    assert!(relay.published().is_empty());
}
