//! End-to-end tests for the Luca exchange object (kind:30178 + the
//! `["exchange", <id>, <turn>]` turn tag on room speech).
//!
//! The unit tests in `buzz-relay` pin the pure validators. These pin the
//! things only a live relay can answer: that the kind is classified at all,
//! that the DB-backed authorization actually reads `users.agent_owner_pubkey`,
//! that the advisory-locked guarded insert refuses a second claim on the same
//! turn, and that the `#exchange` sidecar survives the trip through the HTTP
//! bridge — a filter key `nostr::Filter` throws away before any handler sees it.
//!
//! The arc of `exchange_lifecycle_end_to_end` is one house's story: the owner
//! mints a 3-turn exchange, two residents spend it, the fourth turn is refused,
//! a duplicate is refused, the owner says Stop, the next turn is refused as
//! closed, the owner says Go, turn 4 lands, and the relay can count exactly
//! what was spent.
//!
//! # Running
//!
//! Requires a relay built from THIS tree (30178 is refused as an unknown kind
//! by any earlier binary), plus its Postgres and Redis:
//!
//! ```text
//! RELAY_URL=ws://localhost:3000 cargo test -p buzz-test-client --test e2e_exchange -- --ignored
//! ```

use std::time::Duration;

use buzz_test_client::{BuzzTestClient, RelayMessage};
use luca_protocol::{derive_exchange_id, ExchangeRecordV1, Hex64, OpaqueId, SafeU53};
use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};
use reqwest::Client;
use serde_json::{json, Value};

const KIND_LUCA_EXCHANGE: u16 = 30178;
const KIND_STREAM_MESSAGE: u16 = 9;
const KIND_DELETION: u16 = 5;
/// A reminder — in the harness's default mention-wake set, which is why the
/// sibling-mention gate has to cover it and not just kind:9.
const KIND_STREAM_REMINDER: u16 = 40007;
const KIND_CREATE_CHANNEL: u16 = 9007;
/// The refusal the relay hands back for `#exchange` on a surface that cannot
/// honor it. Mirrors `buzz_relay::protocol::EXCHANGE_FILTER_UNSUPPORTED`.
const EXCHANGE_FILTER_UNSUPPORTED: &str =
    "unsupported: #exchange is only supported on COUNT and POST /query";

fn relay_url() -> String {
    std::env::var("RELAY_URL").unwrap_or_else(|_| "ws://localhost:3000".to_string())
}

fn relay_http_url() -> String {
    relay_url()
        .replace("wss://", "https://")
        .replace("ws://", "http://")
        .trim_end_matches('/')
        .to_string()
}

fn http_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("build HTTP client")
}

fn hex64(keys: &Keys) -> Hex64 {
    Hex64::parse(keys.public_key().to_hex()).expect("pubkey is hex64")
}

fn now() -> u64 {
    Timestamp::now().as_secs()
}

/// Submit an event over the HTTP bridge. Returns `(accepted, message)` — the
/// message is the relay's reason string on refusal, which is the whole point of
/// most assertions below.
async fn submit(client: &Client, keys: &Keys, event: &nostr::Event) -> (bool, String) {
    let resp = client
        .post(format!("{}/events", relay_http_url()))
        .header("X-Pubkey", keys.public_key().to_hex())
        .header("Content-Type", "application/json")
        .body(serde_json::to_string(event).expect("serialize event"))
        .send()
        .await
        .expect("submit event");
    let status = resp.status().as_u16();
    let body: Value = resp.json().await.expect("parse submit response");
    if status == 200 {
        (
            body["accepted"].as_bool().unwrap_or(false),
            body["message"].as_str().unwrap_or("").to_string(),
        )
    } else {
        (false, body["error"].as_str().unwrap_or("").to_string())
    }
}

async fn submit_ok(client: &Client, keys: &Keys, event: &nostr::Event, what: &str) {
    let (accepted, message) = submit(client, keys, event).await;
    assert!(accepted, "{what} should have been accepted, got: {message}");
}

async fn submit_refused(client: &Client, keys: &Keys, event: &nostr::Event, expected: &str) {
    let (accepted, message) = submit(client, keys, event).await;
    assert!(
        !accepted,
        "expected refusal {expected:?}, but it was accepted"
    );
    assert!(
        message.contains(expected),
        "expected refusal containing {expected:?}, got {message:?}"
    );
}

/// `POST /query` with **raw** JSON filters, so `#exchange` survives — a typed
/// `nostr::Filter` would drop it before it left this process.
async fn query_raw(
    client: &Client,
    pubkey_hex: &str,
    filters: Vec<Value>,
) -> Result<Vec<Value>, (u16, String)> {
    let resp = client
        .post(format!("{}/query", relay_http_url()))
        .header("X-Pubkey", pubkey_hex)
        .header("Content-Type", "application/json")
        .json(&filters)
        .send()
        .await
        .expect("query events");
    let status = resp.status().as_u16();
    if status == 200 {
        Ok(resp.json::<Vec<Value>>().await.expect("parse query"))
    } else {
        let body: Value = resp.json().await.expect("parse query error");
        Err((status, body["error"].as_str().unwrap_or("").to_string()))
    }
}

/// `POST /count` with raw JSON filters. Same reason as [`query_raw`].
async fn count_raw(
    client: &Client,
    pubkey_hex: &str,
    filters: Vec<Value>,
) -> Result<u64, (u16, String)> {
    let resp = client
        .post(format!("{}/count", relay_http_url()))
        .header("X-Pubkey", pubkey_hex)
        .header("Content-Type", "application/json")
        .json(&filters)
        .send()
        .await
        .expect("count events");
    let status = resp.status().as_u16();
    let body: Value = resp.json().await.expect("parse count response");
    if status == 200 {
        Ok(body["count"].as_u64().unwrap_or(0))
    } else {
        Err((status, body["error"].as_str().unwrap_or("").to_string()))
    }
}

/// Register `resident` as an agent owned by `owner`, writing
/// `users.agent_owner_pubkey` — the row every exchange gate reads.
///
/// Uses NIP-OA WS auth rather than a privileged path: the owner signs an `auth`
/// tag over the resident's pubkey, and the relay materializes the relationship
/// during authentication.
async fn register_resident(owner: &Keys, resident: &Keys) {
    let auth_tag_json = buzz_sdk::nip_oa::compute_auth_tag(owner, &resident.public_key(), "")
        .expect("mint NIP-OA auth tag");
    let parts: Vec<String> =
        serde_json::from_str(&auth_tag_json).expect("auth tag is a JSON array");
    let tag = Tag::parse(parts.iter().map(String::as_str)).expect("auth tag parses");
    let mut client = BuzzTestClient::connect_unauthenticated(&relay_url())
        .await
        .expect("connect for registration");
    client
        .authenticate_with_nip_oa(resident, &tag)
        .await
        .expect("NIP-OA authentication registers the owner");
    client.disconnect().await.expect("disconnect");
}

/// Create an open stream channel owned by `keys`; returns its UUID string.
async fn create_channel(client: &Client, keys: &Keys) -> String {
    let channel_uuid = uuid::Uuid::new_v4();
    let event = EventBuilder::new(Kind::Custom(KIND_CREATE_CHANNEL), "")
        .tags(vec![
            Tag::parse(["h", &channel_uuid.to_string()]).expect("h tag"),
            Tag::parse(["name", &format!("exchange-{}", channel_uuid.simple())]).expect("name tag"),
            Tag::parse(["channel_type", "stream"]).expect("type tag"),
            Tag::parse(["visibility", "open"]).expect("visibility tag"),
        ])
        .sign_with_keys(keys)
        .expect("sign channel creation");
    submit_ok(client, keys, &event, "channel creation").await;
    channel_uuid.to_string()
}

/// A room message of any kind, optionally carrying a turn tag and/or mentions,
/// at an explicit `created_at`.
fn room_event_at(
    keys: &Keys,
    kind: u16,
    channel: &str,
    content: &str,
    exchange: Option<(&str, u8)>,
    mentions: &[&Keys],
    created_at: u64,
) -> nostr::Event {
    let mut tags = vec![Tag::parse(["h", channel]).expect("h tag")];
    if let Some((exchange_id, turn)) = exchange {
        tags.push(Tag::parse(["exchange", exchange_id, &turn.to_string()]).expect("exchange tag"));
    }
    for mention in mentions {
        tags.push(Tag::parse(["p", &mention.public_key().to_hex()]).expect("p tag"));
    }
    EventBuilder::new(Kind::Custom(kind), content)
        .tags(tags)
        .custom_created_at(Timestamp::from(created_at))
        .sign_with_keys(keys)
        .expect("sign room message")
}

/// A kind:9 room message, optionally carrying a turn tag and/or mentions.
fn room_message(
    keys: &Keys,
    channel: &str,
    content: &str,
    exchange: Option<(&str, u8)>,
    mentions: &[&Keys],
) -> nostr::Event {
    room_event_at(
        keys,
        KIND_STREAM_MESSAGE,
        channel,
        content,
        exchange,
        mentions,
        now(),
    )
}

/// Sign a 30178 head for `record`, at an explicit `created_at` so NIP-33 LWW
/// ordering is deterministic instead of racing whole-second timestamps.
fn record_event(keys: &Keys, record: &ExchangeRecordV1, created_at: u64) -> nostr::Event {
    record_event_with_content(
        keys,
        &record.to_content().expect("canonical content"),
        record.event_tags(),
        created_at,
    )
}

/// The same, with the content and tags supplied verbatim — the only way to put
/// a shape on the wire that the contract's own constructor refuses to build.
///
/// `allow_self_tagging` is load-bearing here. `nostr` 0.44's `EventBuilder`
/// silently drops any `p` tag matching the author's own pubkey
/// (`build_with_ctx`), so a record signed by one of its own members would reach
/// the relay one `p` tag short and be refused for the wrong reason. Production
/// never hits this — the contract forbids the owner from being a member, and
/// only the owner may author the record — but a test that puts a member's
/// signature on a record has to send the tags it actually meant to send.
fn record_event_with_content(
    keys: &Keys,
    content: &str,
    tags: Vec<Vec<String>>,
    created_at: u64,
) -> nostr::Event {
    let nostr_tags: Vec<Tag> = tags
        .iter()
        .map(|t| Tag::parse(t.iter().map(String::as_str)).expect("tag parses"))
        .collect();
    EventBuilder::new(Kind::Custom(KIND_LUCA_EXCHANGE), content)
        .tags(nostr_tags)
        .allow_self_tagging()
        .custom_created_at(Timestamp::from(created_at))
        .sign_with_keys(keys)
        .expect("sign record")
}

/// One owner, two residents, one room, one root utterance — the setup every
/// test below starts from.
struct House {
    http: Client,
    owner: Keys,
    luca: Keys,
    vektor: Keys,
    channel: String,
    root: Hex64,
}

async fn stand_up_house() -> House {
    let http = http_client();
    let owner = Keys::generate();
    let luca = Keys::generate();
    let vektor = Keys::generate();

    register_resident(&owner, &luca).await;
    register_resident(&owner, &vektor).await;

    let channel = create_channel(&http, &owner).await;
    // The owner utterance that mints the budget.
    let root_event = room_message(&owner, &channel, "what do you two think?", None, &[]);
    submit_ok(&http, &owner, &root_event, "owner root utterance").await;
    let root = Hex64::parse(root_event.id.to_hex()).expect("event id is hex64");

    House {
        http,
        owner,
        luca,
        vektor,
        channel,
        root,
    }
}

impl House {
    fn record(&self, bucket: Option<u8>, at: u64) -> ExchangeRecordV1 {
        ExchangeRecordV1::open(
            hex64(&self.owner),
            vec![hex64(&self.luca), hex64(&self.vektor)],
            OpaqueId::parse(&self.channel).expect("channel uuid is opaque-safe"),
            self.root.clone(),
            hex64(&self.luca),
            bucket,
            at,
        )
        .expect("record opens")
    }
}

#[tokio::test]
#[ignore]
async fn exchange_lifecycle_end_to_end() {
    let house = stand_up_house().await;
    let minted_at = now();
    let record = house.record(Some(3), minted_at);
    let exchange_id = record.exchange_id.as_str().to_owned();

    // ---- Mint -------------------------------------------------------------
    submit_ok(
        &house.http,
        &house.owner,
        &record_event(&house.owner, &record, minted_at),
        "owner minting the exchange",
    )
    .await;

    // ---- Three turns, spent by the two residents --------------------------
    for (turn, who, what) in [
        (1u8, &house.luca, "i think we start with the shape"),
        (2, &house.vektor, "agreed, but the shape needs a floor"),
        (3, &house.luca, "the floor is the bucket"),
    ] {
        submit_ok(
            &house.http,
            who,
            &room_message(who, &house.channel, what, Some((&exchange_id, turn)), &[]),
            &format!("turn {turn}"),
        )
        .await;
    }

    // ---- The fourth turn is past the bucket -------------------------------
    submit_refused(
        &house.http,
        &house.vektor,
        &room_message(
            &house.vektor,
            &house.channel,
            "one more thing",
            Some((&exchange_id, 4)),
            &[],
        ),
        "restricted: exchange exhausted",
    )
    .await;

    // ---- A turn is spoken once --------------------------------------------
    submit_refused(
        &house.http,
        &house.vektor,
        &room_message(
            &house.vektor,
            &house.channel,
            "actually, about turn three",
            Some((&exchange_id, 3)),
            &[],
        ),
        "restricted: exchange turn already spoken",
    )
    .await;

    // ---- Owner says Stop --------------------------------------------------
    let stopped = record.stopped();
    submit_ok(
        &house.http,
        &house.owner,
        &record_event(&house.owner, &stopped, minted_at + 1),
        "owner stopping the exchange",
    )
    .await;
    // Closed is checked before the bucket, so even an in-range turn says closed.
    submit_refused(
        &house.http,
        &house.luca,
        &room_message(
            &house.luca,
            &house.channel,
            "but",
            Some((&exchange_id, 4)),
            &[],
        ),
        "restricted: exchange closed",
    )
    .await;

    // ---- Owner says Go: bucket 6, reopened, fresh deadline -----------------
    let continued = stopped
        .continued(now())
        .expect("deadline fits")
        .expect("not at the ceiling");
    assert_eq!(continued.bucket, 6, "Go adds three turns");
    submit_ok(
        &house.http,
        &house.owner,
        &record_event(&house.owner, &continued, minted_at + 2),
        "owner continuing the exchange",
    )
    .await;
    submit_ok(
        &house.http,
        &house.vektor,
        &room_message(
            &house.vektor,
            &house.channel,
            "then the floor holds",
            Some((&exchange_id, 4)),
            &[],
        ),
        "turn 4 after Go",
    )
    .await;

    // ---- The relay can say exactly what was spent -------------------------
    let owner_hex = house.owner.public_key().to_hex();
    let spent_filter = json!({
        "kinds": [KIND_STREAM_MESSAGE],
        "#h": [house.channel],
        "#exchange": [exchange_id],
    });
    let count = count_raw(&house.http, &owner_hex, vec![spent_filter.clone()])
        .await
        .expect("COUNT with #exchange is supported");
    assert_eq!(count, 4, "four turns were accepted, so four were spent");

    // The desktop needs the spent SET, not just the count, to pick its turn.
    let spent = query_raw(&house.http, &owner_hex, vec![spent_filter])
        .await
        .expect("POST /query with #exchange is supported");
    assert_eq!(spent.len(), 4, "the spent set is the four accepted turns");

    // A count with NO `#exchange` sees the owner's root utterance too — which is
    // exactly why the sidecar has to survive the trip. If it were silently
    // dropped, `spent` would read 5 and the strip would show a phantom turn.
    let unfiltered = count_raw(
        &house.http,
        &owner_hex,
        vec![json!({ "kinds": [KIND_STREAM_MESSAGE], "#h": [house.channel] })],
    )
    .await
    .expect("plain COUNT");
    assert!(
        unfiltered > count,
        "the room holds more messages ({unfiltered}) than the exchange spent ({count}) — \
         if these are equal the sidecar is not constraining anything"
    );
}

#[tokio::test]
#[ignore]
async fn exchange_record_is_refused_unless_the_author_owns_every_member() {
    let house = stand_up_house().await;
    let at = now();
    let record = house.record(Some(3), at);

    // A resident cannot mint their owner's exchange.
    submit_refused(
        &house.http,
        &house.luca,
        &record_event(&house.luca, &record, at),
        "restricted: exchange record must be authored by its owner",
    )
    .await;

    // Nor can a stranger claim two of someone else's residents.
    let stranger = Keys::generate();
    let foreign = ExchangeRecordV1::open(
        hex64(&stranger),
        vec![hex64(&house.luca), hex64(&house.vektor)],
        OpaqueId::parse(&house.channel).expect("channel uuid"),
        house.root.clone(),
        hex64(&house.luca),
        Some(3),
        at,
    )
    .expect("record opens");
    submit_refused(
        &house.http,
        &stranger,
        &record_event(&stranger, &foreign, at),
        "restricted: exchange members must all be residents of the author",
    )
    .await;
}

#[tokio::test]
#[ignore]
async fn exchange_record_is_refused_when_the_content_breaks_the_contract() {
    let house = stand_up_house().await;
    let at = now();
    let record = house.record(Some(3), at);
    let content = record.to_content().expect("canonical content");

    // Bucket above the ceiling. The constructor clamps, so the only way to put
    // this on the wire is to sign tampered content — which is exactly what a
    // client trying to buy itself more turns would do.
    submit_refused(
        &house.http,
        &house.owner,
        &record_event_with_content(
            &house.owner,
            &content.replace("\"bucket\":3", "\"bucket\":11"),
            record.event_tags(),
            at,
        ),
        "invalid: exchange record",
    )
    .await;

    // `d` tag that is not the exchange id.
    let mut wrong_d = record.event_tags();
    wrong_d[0] = vec!["d".to_owned(), "ab".repeat(32)];
    submit_refused(
        &house.http,
        &house.owner,
        &record_event_with_content(&house.owner, &content, wrong_d, at),
        "invalid: exchange d tag must equal exchange_id",
    )
    .await;

    // A `p` tag set that is not exactly the members.
    let mut extra_p = record.event_tags();
    extra_p.push(vec!["p".to_owned(), Keys::generate().public_key().to_hex()]);
    submit_refused(
        &house.http,
        &house.owner,
        &record_event_with_content(&house.owner, &content, extra_p, at),
        "invalid: exchange p tags must equal members",
    )
    .await;
}

#[tokio::test]
#[ignore]
async fn a_resident_cannot_reach_a_sibling_without_an_exchange() {
    let house = stand_up_house().await;

    // The side door this closes: a resident with shell access publishing a
    // kind:9 that mentions its sibling, with no exchange to bound the loop.
    submit_refused(
        &house.http,
        &house.luca,
        &room_message(
            &house.luca,
            &house.channel,
            "hey, what do you think?",
            None,
            &[&house.vektor],
        ),
        "restricted: resident-to-resident mention needs an exchange",
    )
    .await;

    // Mentioning the OWNER is ordinary speech and must stay untouched.
    submit_ok(
        &house.http,
        &house.luca,
        &room_message(
            &house.luca,
            &house.channel,
            "here is what I found",
            None,
            &[&house.owner],
        ),
        "a resident answering its owner",
    )
    .await;

    // So is mentioning a human who is nobody's resident.
    let human = Keys::generate();
    submit_ok(
        &house.http,
        &house.luca,
        &room_message(&house.luca, &house.channel, "cc", None, &[&human]),
        "a resident mentioning a human",
    )
    .await;

    // And another house's resident is not a sibling.
    let other_owner = Keys::generate();
    let other_resident = Keys::generate();
    register_resident(&other_owner, &other_resident).await;
    submit_ok(
        &house.http,
        &house.luca,
        &room_message(
            &house.luca,
            &house.channel,
            "different house",
            None,
            &[&other_resident],
        ),
        "a resident mentioning another owner's resident",
    )
    .await;
}

#[tokio::test]
#[ignore]
async fn a_turn_tag_naming_no_exchange_is_refused() {
    let house = stand_up_house().await;
    // A turn tag whose id names nothing. Fail closed: an unknown exchange is
    // not an unconstrained one.
    let unknown_id = "cd".repeat(32);
    submit_refused(
        &house.http,
        &house.luca,
        &room_message(
            &house.luca,
            &house.channel,
            "speaking into a budget that does not exist",
            Some((unknown_id.as_str(), 1)),
            &[],
        ),
        "restricted: exchange: no such exchange",
    )
    .await;

    // A malformed tag is refused as malformed, never ignored.
    let malformed = EventBuilder::new(Kind::Custom(KIND_STREAM_MESSAGE), "malformed")
        .tags(vec![
            Tag::parse(["h", &house.channel]).expect("h tag"),
            Tag::parse(["exchange", &"cd".repeat(32)]).expect("short exchange tag"),
        ])
        .sign_with_keys(&house.luca)
        .expect("sign");
    submit_refused(
        &house.http,
        &house.luca,
        &malformed,
        "invalid: exchange tag",
    )
    .await;
}

/// A turn tag is not a licence to reach for anyone in the house.
///
/// The exchange bounds *who* as well as *how many*: Luca and Vektor's three
/// turns must not become a way for either of them to wake Kai, who was never a
/// member and whose own budget nobody minted.
#[tokio::test]
#[ignore]
async fn an_exchange_turn_may_not_mention_a_resident_outside_its_members() {
    let house = stand_up_house().await;
    let kai = Keys::generate();
    register_resident(&house.owner, &kai).await;

    let minted_at = now();
    let record = house.record(Some(3), minted_at);
    let exchange_id = record.exchange_id.as_str().to_owned();
    submit_ok(
        &house.http,
        &house.owner,
        &record_event(&house.owner, &record, minted_at),
        "owner minting the exchange",
    )
    .await;

    // Kai is a resident of this house and not a member of this exchange.
    submit_refused(
        &house.http,
        &house.luca,
        &room_message(
            &house.luca,
            &house.channel,
            "kai, weigh in",
            Some((&exchange_id, 1)),
            &[&kai],
        ),
        "restricted: exchange: mention outside members",
    )
    .await;

    // A member is exactly who the turn is for.
    submit_ok(
        &house.http,
        &house.luca,
        &room_message(
            &house.luca,
            &house.channel,
            "vektor, weigh in",
            Some((&exchange_id, 1)),
            &[&house.vektor],
        ),
        "turn 1 mentioning a member",
    )
    .await;

    // And the owner is always reachable — that is the whole point of the house.
    submit_ok(
        &house.http,
        &house.vektor,
        &room_message(
            &house.vektor,
            &house.channel,
            "here is what we found",
            Some((&exchange_id, 2)),
            &[&house.owner],
        ),
        "turn 2 mentioning the owner",
    )
    .await;
}

/// An exchange lives in one room, and a turn of it may only be spent there.
#[tokio::test]
#[ignore]
async fn an_exchange_turn_may_only_be_spent_in_its_own_conversation() {
    let house = stand_up_house().await;
    let elsewhere = create_channel(&house.http, &house.owner).await;
    let minted_at = now();
    let record = house.record(Some(3), minted_at);
    let exchange_id = record.exchange_id.as_str().to_owned();
    submit_ok(
        &house.http,
        &house.owner,
        &record_event(&house.owner, &record, minted_at),
        "owner minting the exchange",
    )
    .await;

    submit_refused(
        &house.http,
        &house.luca,
        &room_message(
            &house.luca,
            &elsewhere,
            "spending someone else's budget over here",
            Some((&exchange_id, 1)),
            &[],
        ),
        "restricted: exchange: wrong conversation",
    )
    .await;

    // The same turn, in the exchange's own room, is fine.
    submit_ok(
        &house.http,
        &house.luca,
        &room_message(
            &house.luca,
            &house.channel,
            "in the right room",
            Some((&exchange_id, 1)),
            &[],
        ),
        "turn 1 in the exchange's own conversation",
    )
    .await;
}

/// The sibling-mention gate covers every kind that can wake a sibling, not just
/// kind:9 — otherwise a reminder is an unmetered doorbell.
#[tokio::test]
#[ignore]
async fn a_resident_cannot_wake_a_sibling_with_a_reminder() {
    let house = stand_up_house().await;
    let at = now();

    submit_refused(
        &house.http,
        &house.luca,
        &room_event_at(
            &house.luca,
            KIND_STREAM_REMINDER,
            &house.channel,
            "nudging my sibling without an exchange",
            None,
            &[&house.vektor],
            at,
        ),
        "restricted: resident-to-resident mention needs an exchange",
    )
    .await;

    // Reminding the owner is ordinary house business.
    submit_ok(
        &house.http,
        &house.luca,
        &room_event_at(
            &house.luca,
            KIND_STREAM_REMINDER,
            &house.channel,
            "reminding my owner",
            None,
            &[&house.owner],
            at,
        ),
        "a resident reminding its owner",
    )
    .await;

    // And a turn tag on a kind that cannot spend a turn is refused rather than
    // silently accepted as though it metered anything.
    let record = house.record(Some(3), at);
    submit_ok(
        &house.http,
        &house.owner,
        &record_event(&house.owner, &record, at),
        "owner minting the exchange",
    )
    .await;
    submit_refused(
        &house.http,
        &house.luca,
        &room_event_at(
            &house.luca,
            KIND_STREAM_REMINDER,
            &house.channel,
            "a metered-looking doorbell",
            Some((record.exchange_id.as_str(), 1)),
            &[&house.vektor],
            at,
        ),
        "invalid: exchange tag on a kind that cannot spend a turn",
    )
    .await;
}

/// The contract says owner messages never carry the turn tag. A tagged owner
/// message accepted "uncounted" would still occupy the turn in the uniqueness
/// probe and show up in the spent COUNT, so it is refused outright.
#[tokio::test]
#[ignore]
async fn an_owner_message_may_not_carry_a_turn_tag() {
    let house = stand_up_house().await;
    let minted_at = now();
    let record = house.record(Some(3), minted_at);
    submit_ok(
        &house.http,
        &house.owner,
        &record_event(&house.owner, &record, minted_at),
        "owner minting the exchange",
    )
    .await;

    submit_refused(
        &house.http,
        &house.owner,
        &room_message(
            &house.owner,
            &house.channel,
            "let me tag my own exchange",
            Some((record.exchange_id.as_str(), 1)),
            &[],
        ),
        "invalid: exchange tag on an owner message",
    )
    .await;

    // The owner speaking in the room without the tag is untouched, and the
    // residents' turn 1 is still free.
    submit_ok(
        &house.http,
        &house.owner,
        &room_message(&house.owner, &house.channel, "carry on", None, &[]),
        "an untagged owner message",
    )
    .await;
    submit_ok(
        &house.http,
        &house.luca,
        &room_message(
            &house.luca,
            &house.channel,
            "turn one",
            Some((record.exchange_id.as_str(), 1)),
            &[],
        ),
        "turn 1 is still free",
    )
    .await;
}

/// A retry is not a collision.
///
/// The desktop reads "already spoken" as "re-sign this reply under a fresh
/// turn". If a byte-identical resubmission — a dropped response, a reconnect —
/// answered that, the reply would be posted twice.
#[tokio::test]
#[ignore]
async fn a_resubmitted_turn_answers_duplicate_not_already_spoken() {
    let house = stand_up_house().await;
    let minted_at = now();
    let record = house.record(Some(3), minted_at);
    let exchange_id = record.exchange_id.as_str().to_owned();
    submit_ok(
        &house.http,
        &house.owner,
        &record_event(&house.owner, &record, minted_at),
        "owner minting the exchange",
    )
    .await;

    let turn = room_message(
        &house.luca,
        &house.channel,
        "the same words, twice",
        Some((&exchange_id, 1)),
        &[],
    );
    submit_ok(&house.http, &house.luca, &turn, "turn 1").await;
    let (accepted, message) = submit(&house.http, &house.luca, &turn).await;
    assert!(accepted, "a resubmission must not be refused: {message}");
    assert!(
        message.starts_with("duplicate:"),
        "expected a duplicate, got {message:?} — the desktop would re-sign and double-post"
    );
}

/// Deleting your own turn does not refund it, and does not hide it.
///
/// The ledger the relay enforces and the ledger a client can read have to
/// agree: if a deleted turn vanished from the `#exchange` read, the desktop
/// would pick a number the relay still refuses and strand.
#[tokio::test]
#[ignore]
async fn a_deleted_turn_stays_spent_and_stays_visible() {
    let house = stand_up_house().await;
    let minted_at = now();
    let record = house.record(Some(3), minted_at);
    let exchange_id = record.exchange_id.as_str().to_owned();
    submit_ok(
        &house.http,
        &house.owner,
        &record_event(&house.owner, &record, minted_at),
        "owner minting the exchange",
    )
    .await;

    let turn_one = room_message(
        &house.luca,
        &house.channel,
        "turn one",
        Some((&exchange_id, 1)),
        &[],
    );
    submit_ok(&house.http, &house.luca, &turn_one, "turn 1").await;
    submit_ok(
        &house.http,
        &house.vektor,
        &room_message(
            &house.vektor,
            &house.channel,
            "turn two",
            Some((&exchange_id, 2)),
            &[],
        ),
        "turn 2",
    )
    .await;

    // The author deletes their own turn.
    let deletion = EventBuilder::new(Kind::Custom(KIND_DELETION), "")
        .tags(vec![
            Tag::parse(["e", &turn_one.id.to_hex()]).expect("e tag")
        ])
        .sign_with_keys(&house.luca)
        .expect("sign deletion");
    submit_ok(
        &house.http,
        &house.luca,
        &deletion,
        "a resident deleting their own turn",
    )
    .await;

    // Still spent.
    submit_refused(
        &house.http,
        &house.luca,
        &room_message(
            &house.luca,
            &house.channel,
            "turn one, reborn",
            Some((&exchange_id, 1)),
            &[],
        ),
        "restricted: exchange turn already spoken",
    )
    .await;

    // Still counted, and still in the spent set the desktop reads.
    let owner_hex = house.owner.public_key().to_hex();
    let spent_filter = json!({
        "kinds": [KIND_STREAM_MESSAGE],
        "#h": [house.channel],
        "#exchange": [exchange_id],
    });
    assert_eq!(
        count_raw(&house.http, &owner_hex, vec![spent_filter.clone()])
            .await
            .expect("COUNT with #exchange"),
        2,
        "a deleted turn stays spent, so it stays counted"
    );
    let spent = query_raw(&house.http, &owner_hex, vec![spent_filter])
        .await
        .expect("POST /query with #exchange");
    assert_eq!(
        spent.len(),
        2,
        "the spent set must show the deleted turn, or the turn picker strands"
    );
}

/// Expiry is decided on the relay's clock, not the client's.
///
/// `created_at` is client-declared and the ±900 s drift window admits it well
/// into the past, so a record whose deadline has passed can still be handed a
/// turn whose declared time sits inside it. Only server time closes that.
#[tokio::test]
#[ignore]
async fn exchange_expiry_is_decided_on_server_time() {
    let house = stand_up_house().await;
    // Inside the drift window, so both events are accepted as timely — but the
    // deadline itself is already in the past by the relay's clock.
    let signed_at = now() - 800;
    let mut record = house.record(Some(3), signed_at);
    record.deadline = SafeU53::new(signed_at + 1).expect("deadline fits");
    let exchange_id = record.exchange_id.as_str().to_owned();
    submit_ok(
        &house.http,
        &house.owner,
        &record_event(&house.owner, &record, signed_at),
        "owner minting an exchange whose deadline has already passed",
    )
    .await;

    // `created_at <= deadline` holds, so only the server-time check can refuse
    // this. If it were missing, the drift window would be free budget.
    submit_refused(
        &house.http,
        &house.luca,
        &room_event_at(
            &house.luca,
            KIND_STREAM_MESSAGE,
            &house.channel,
            "speaking past the deadline with a backdated stamp",
            Some((&exchange_id, 1)),
            &[],
            signed_at,
        ),
        "restricted: exchange expired",
    )
    .await;
}

/// Depth 2 is one hop further, not an unbounded chain — and the parent has to
/// be real. Only a live relay can answer this: the contract validates the
/// *shape* of a depth-2 record, the relay validates that its parent exists,
/// belongs to the same owner, and is itself depth 1.
#[tokio::test]
#[ignore]
async fn exchange_depth_two_needs_a_real_depth_one_parent() {
    let house = stand_up_house().await;
    let at = now();
    let members = vec![hex64(&house.luca), hex64(&house.vektor)];
    let conversation = OpaqueId::parse(&house.channel).expect("channel uuid");

    let parent = house.record(Some(3), at);
    submit_ok(
        &house.http,
        &house.owner,
        &record_event(&house.owner, &parent, at),
        "the depth-1 parent",
    )
    .await;

    // A child hanging off a real depth-1 parent lands.
    let child = ExchangeRecordV1::open_child(
        &parent,
        members.clone(),
        conversation.clone(),
        house.root.clone(),
        hex64(&house.luca),
        Some(3),
        at,
    )
    .expect("child opens");
    assert_eq!(child.depth, 2, "open_child is the depth-2 constructor");
    submit_ok(
        &house.http,
        &house.owner,
        &record_event(&house.owner, &child, at),
        "a depth-2 child of a real depth-1 parent",
    )
    .await;

    // A child naming a parent that was never minted is an orphan. Fail closed:
    // an unknown parent is not a permissive one.
    let ghost = ExchangeRecordV1::open(
        hex64(&house.owner),
        members.clone(),
        conversation.clone(),
        Hex64::parse("cd".repeat(32)).expect("hex64"),
        hex64(&house.luca),
        Some(3),
        at,
    )
    .expect("ghost opens");
    let orphan = ExchangeRecordV1::open_child(
        &ghost,
        members.clone(),
        conversation.clone(),
        house.root.clone(),
        hex64(&house.luca),
        Some(3),
        at,
    )
    .expect("orphan opens");
    submit_refused(
        &house.http,
        &house.owner,
        &record_event(&house.owner, &orphan, at),
        "restricted: exchange parent not found",
    )
    .await;

    // And a child whose parent is itself depth 2 would be hop three. The
    // contract's own `open_child` refuses to build it, so the only way onto the
    // wire is by hand — which is exactly what a client trying to chain deeper
    // would do.
    assert!(
        ExchangeRecordV1::open_child(
            &child,
            members.clone(),
            conversation.clone(),
            house.root.clone(),
            hex64(&house.luca),
            Some(3),
            at,
        )
        .is_err(),
        "the contract refuses to build a depth-3 chain"
    );
    let mut grandchild = child.clone();
    grandchild.parent_exchange_id = Some(child.exchange_id.clone());
    grandchild.exchange_id = derive_exchange_id(
        &grandchild.root_event_id,
        &grandchild.members,
        grandchild.parent_exchange_id.as_ref(),
    )
    .expect("id derives");
    grandchild.validate().expect("the shape itself is valid");
    submit_refused(
        &house.http,
        &house.owner,
        &record_event(&house.owner, &grandchild, at),
        "restricted: exchange parent not found",
    )
    .await;
}

#[tokio::test]
#[ignore]
async fn exchange_sidecar_is_refused_on_live_req_and_on_specialised_query_paths() {
    let house = stand_up_house().await;
    let exchange_id = "ab".repeat(32);

    // Live REQ: the fan-out leg matches on `nostr::Filter` alone and cannot see
    // the constraint, so the relay refuses rather than over-delivering.
    let mut ws = BuzzTestClient::connect(&relay_url(), &house.owner)
        .await
        .expect("connect + authenticate");
    let sub = format!("e2e-exchange-{}", uuid::Uuid::new_v4());
    ws.send_raw(&json!([
        "REQ",
        sub,
        { "kinds": [KIND_STREAM_MESSAGE], "#h": [house.channel], "#exchange": [exchange_id] },
    ]))
    .await
    .expect("send REQ");
    let mut closed_reason = None;
    for _ in 0..8 {
        match ws.recv_event(Duration::from_secs(5)).await {
            Ok(RelayMessage::Closed {
                subscription_id,
                message,
            }) if subscription_id == sub => {
                closed_reason = Some(message);
                break;
            }
            Ok(_) => continue,
            Err(e) => panic!("expected CLOSED for the #exchange REQ, got {e}"),
        }
    }
    assert_eq!(
        closed_reason.as_deref(),
        Some(EXCHANGE_FILTER_UNSUPPORTED),
        "live REQ must refuse #exchange, not silently widen the subscription"
    );
    ws.disconnect().await.expect("disconnect");

    // `POST /query` honors the sidecar only on the plain catch-all read path.
    // A specialised path answers from its own query shape and would drop the
    // constraint, so those combinations are refused too.
    let owner_hex = house.owner.public_key().to_hex();
    for specialised in [
        json!({ "kinds": [KIND_STREAM_MESSAGE], "#h": [house.channel], "#exchange": ["ab".repeat(32)], "top_level": true }),
        // A kind the turn tag can never ride on.
        json!({ "kinds": [KIND_LUCA_EXCHANGE], "#exchange": ["ab".repeat(32)] }),
        // No kinds at all — an unbounded #exchange scan.
        json!({ "#h": [house.channel], "#exchange": ["ab".repeat(32)] }),
    ] {
        let err = query_raw(&house.http, &owner_hex, vec![specialised.clone()])
            .await
            .expect_err("specialised path must refuse #exchange");
        assert_eq!(err.0, 400, "expected 400 for {specialised}, got {err:?}");
        assert!(
            err.1.contains("#exchange"),
            "refusal should name the key: {err:?}"
        );
    }

    // A malformed sidecar is a 400, never a silently unconstrained answer.
    let err = count_raw(
        &house.http,
        &owner_hex,
        vec![json!({ "kinds": [KIND_STREAM_MESSAGE], "#exchange": ["not-an-id"] })],
    )
    .await
    .expect_err("malformed #exchange must be refused");
    assert_eq!(err.0, 400, "got {err:?}");
}
