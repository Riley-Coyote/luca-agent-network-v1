use super::*;

use luca_protocol::OpaqueId;

const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const LUCA: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const VEKTOR: &str = "3333333333333333333333333333333333333333333333333333333333333333";
const KAI: &str = "4444444444444444444444444444444444444444444444444444444444444444";
const ROOT: &str = "abababababababababababababababababababababababababababababababab";
const OTHER_ROOT: &str = "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";
const LOWEST_ID: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const CHANNEL: &str = "11111111-1111-4111-8111-111111111111";

fn hex(value: &str) -> Hex64 {
    Hex64::parse(value).expect("fixture hex64")
}

fn record(root: &str, bucket: Option<u8>) -> ExchangeRecordV1 {
    ExchangeRecordV1::open(
        hex(OWNER),
        vec![hex(LUCA), hex(VEKTOR)],
        OpaqueId::parse("11111111-1111-4111-8111-111111111111").expect("channel"),
        hex(root),
        hex(LUCA),
        bucket,
        1_000_000,
    )
    .expect("record")
}

fn head(record: ExchangeRecordV1, created_at: u64, event_id: &str) -> ExchangeHead {
    ExchangeHead {
        record,
        created_at,
        event_id: hex(event_id),
    }
}

#[test]
fn a_later_head_replaces_an_earlier_one_and_an_earlier_head_is_ignored() {
    let mut store = ExchangeStore::in_memory();
    let opened = record(ROOT, None);
    let id = opened.exchange_id.clone();
    store
        .upsert_head(head(opened.clone(), 1_000, ROOT))
        .expect("first head");
    assert_eq!(store.head(&id).expect("head").record.bucket, 3);

    let continued = opened.continued(2_000).expect("continue").expect("bucket");
    store
        .upsert_head(head(continued.clone(), 2_000, OTHER_ROOT))
        .expect("later head");
    assert_eq!(store.head(&id).expect("head").record.bucket, 6);

    // An older copy arriving late must not undo the owner's Go.
    store
        .upsert_head(head(opened, 1_000, ROOT))
        .expect("older head is ignored");
    assert_eq!(store.head(&id).expect("head").record.bucket, 6);
}

#[test]
fn the_relays_head_is_adopted_even_when_the_local_copy_looks_newer() {
    let mut store = ExchangeStore::in_memory();
    let opened = record(ROOT, None);
    let id = opened.exchange_id.clone();
    let continued = opened.continued(9_000).expect("continue").expect("bucket");
    // A write this desktop made and the relay then dominated: locally it looks
    // like the latest word, and it is not.
    store
        .upsert_head(head(continued, 9_000, ROOT))
        .expect("local head");
    assert_eq!(store.head(&id).expect("head").record.bucket, 6);

    store
        .adopt_head(head(opened.clone(), 1_000, OTHER_ROOT))
        .expect("the relay's head is an observation, not a candidate");
    assert_eq!(store.head(&id).expect("head").record.bucket, 3);
    assert_eq!(store.head(&id).expect("head").created_at, 1_000);

    // Adopting the same head twice is a no-op rather than a second write.
    store
        .adopt_head(head(opened, 1_000, OTHER_ROOT))
        .expect("idempotent");
    assert_eq!(store.head(&id).expect("head").created_at, 1_000);
}

#[test]
fn a_head_that_does_not_validate_is_never_adopted() {
    let mut store = ExchangeStore::in_memory();
    let mut broken = record(ROOT, None);
    broken.bucket = 0;
    let id = broken.exchange_id.clone();
    assert!(store.adopt_head(head(broken, 1_000, ROOT)).is_err());
    assert!(store.head(&id).is_none());
}

#[test]
fn a_same_second_tie_goes_to_the_lower_event_id_exactly_as_the_relay_decides() {
    let mut store = ExchangeStore::in_memory();
    let opened = record(ROOT, None);
    let id = opened.exchange_id.clone();
    let stopped = opened.stopped();
    store
        .upsert_head(head(stopped, 5_000, ROOT))
        .expect("first head");
    store
        .upsert_head(head(opened.clone(), 5_000, OTHER_ROOT))
        .expect("same-second head with a higher id is ignored");
    assert_eq!(
        store.head(&id).expect("head").record.state,
        luca_protocol::ExchangeStateV1::Closed
    );
    let mut lower = opened;
    lower.bucket = 9;
    store
        .upsert_head(head(lower, 5_000, LOWEST_ID))
        .expect("same-second head with a lower id wins");
    assert_eq!(store.head(&id).expect("head").record.bucket, 9);
}

#[test]
fn an_unknown_exchange_is_simply_absent() {
    let store = ExchangeStore::in_memory();
    assert!(store.head(&hex(KAI)).is_none());
    assert!(store.decision("nobody:nothing").is_none());
}

#[test]
fn the_first_decision_wins_and_a_replay_reads_it_back_verbatim() {
    let mut store = ExchangeStore::in_memory();
    let key = decision_key("receipt", LUCA);
    let first = store
        .record_decision(
            &key,
            ExchangeDecision {
                exchange: Some(ExchangeTurnTag::new(hex(ROOT), 1).expect("turn")),
                granted_p_tags: vec![hex(VEKTOR)],
                notes: vec!["a sentence".to_owned()],
                notes_published: false,
                order: 0,
                ..ExchangeDecision::default()
            },
        )
        .expect("first decision");
    let replay = store
        .record_decision(
            &key,
            ExchangeDecision {
                exchange: Some(ExchangeTurnTag::new(hex(ROOT), 7).expect("turn")),
                granted_p_tags: vec![hex(KAI)],
                notes: Vec::new(),
                notes_published: false,
                order: 0,
                ..ExchangeDecision::default()
            },
        )
        .expect("replay decision");
    assert_eq!(first, replay, "a replay never re-places a final");
    assert_eq!(replay.exchange.expect("turn").turn, 1);
}

#[test]
fn notes_are_marked_published_once() {
    let mut store = ExchangeStore::in_memory();
    let key = decision_key("receipt", LUCA);
    store
        .record_decision(
            &key,
            ExchangeDecision {
                exchange: None,
                granted_p_tags: Vec::new(),
                notes: vec!["a sentence".to_owned()],
                notes_published: false,
                order: 0,
                ..ExchangeDecision::default()
            },
        )
        .expect("decision");
    store.mark_notes_published(&key).expect("mark");
    assert!(store.decision(&key).expect("decision").notes_published);
    store.mark_notes_published(&key).expect("idempotent");
    assert!(store.mark_notes_published("missing").is_err());
}

#[test]
fn a_decision_may_change_its_turn_but_never_its_exchange() {
    let mut store = ExchangeStore::in_memory();
    let key = decision_key("receipt", LUCA);
    store
        .record_decision(
            &key,
            ExchangeDecision {
                exchange: Some(ExchangeTurnTag::new(hex(ROOT), 2).expect("turn")),
                granted_p_tags: Vec::new(),
                notes: Vec::new(),
                notes_published: false,
                order: 0,
                ..ExchangeDecision::default()
            },
        )
        .expect("decision");
    store
        .retune_decision(&key, &ExchangeTurnTag::new(hex(ROOT), 3).expect("turn"))
        .expect("retune to a free turn");
    assert_eq!(
        store.decision(&key).expect("decision").exchange,
        Some(ExchangeTurnTag::new(hex(ROOT), 3).expect("turn"))
    );
    assert!(
        store
            .retune_decision(&key, &ExchangeTurnTag::new(hex(KAI), 1).expect("turn"))
            .is_err(),
        "a retune may not move a final into a different exchange"
    );
}

#[test]
fn a_decision_that_never_had_a_turn_cannot_gain_one() {
    let mut store = ExchangeStore::in_memory();
    let key = decision_key("receipt", LUCA);
    store
        .record_decision(
            &key,
            ExchangeDecision {
                exchange: None,
                granted_p_tags: Vec::new(),
                notes: Vec::new(),
                notes_published: false,
                order: 0,
                ..ExchangeDecision::default()
            },
        )
        .expect("decision");
    assert!(store
        .retune_decision(&key, &ExchangeTurnTag::new(hex(ROOT), 1).expect("turn"))
        .is_err());
}

#[test]
fn durable_state_round_trips_through_the_owner_only_file() {
    let temp = tempfile::tempdir().expect("temp");
    let path = temp.path().join("luca").join("exchanges.json");
    let opened = record(ROOT, Some(5));
    let id = opened.exchange_id.clone();
    {
        let mut store = ExchangeStore::load(path.clone()).expect("load empty");
        store
            .upsert_head(head(opened, 9_000, ROOT))
            .expect("head persists");
        store
            .record_decision(
                &decision_key("receipt", LUCA),
                ExchangeDecision {
                    exchange: Some(ExchangeTurnTag::new(hex(ROOT), 1).expect("turn")),
                    granted_p_tags: vec![hex(VEKTOR)],
                    notes: Vec::new(),
                    notes_published: true,
                    order: 0,
                    ..ExchangeDecision::default()
                },
            )
            .expect("decision persists");
        store
            .record_visit(VisitGrant {
                conversation_id: OpaqueId::parse(CHANNEL).expect("channel"),
                resident: hex(KAI),
                arrived_at: 9_001,
                exchange_id: Some(id.clone()),
                correlation_id: id.clone(),
            })
            .expect("visit persists");
        store
            .mark_visit_arrival_noted(&OpaqueId::parse(CHANNEL).expect("channel"), &hex(KAI))
            .expect("arrival note persists");
    }
    let reloaded = ExchangeStore::load(path).expect("reload");
    assert_eq!(reloaded.head(&id).expect("head").record.bucket, 5);
    let decision = reloaded
        .decision(&decision_key("receipt", LUCA))
        .expect("decision");
    assert_eq!(decision.granted_p_tags, vec![hex(VEKTOR)]);
    assert!(decision.notes_published);
    let visit = reloaded
        .visit(&OpaqueId::parse(CHANNEL).expect("channel"), &hex(KAI))
        .expect("visit");
    assert_eq!(visit.grant.exchange_id, Some(id));
    assert!(visit.arrival_noted);
}

#[test]
fn a_head_whose_key_does_not_match_its_content_is_refused_on_load() {
    let temp = tempfile::tempdir().expect("temp");
    let path = temp.path().join("exchanges.json");
    let opened = record(ROOT, None);
    let stored = serde_json::json!({
        "schema": "luca.exchange-store.v1",
        "next_order": 1,
        "heads": { KAI: { "record": opened, "created_at": 1, "event_id": ROOT } },
        "decisions": {},
    });
    std::fs::write(&path, serde_json::to_vec(&stored).expect("json")).expect("write");
    assert!(ExchangeStore::load(path).is_err());
}
