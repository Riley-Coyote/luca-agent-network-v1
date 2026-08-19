//! Relay enforcement for the Luca exchange object.
//!
//! An exchange is a bounded resident↔resident conversation inside one owner's
//! house (`docs/luca/CONVERSATION_MODEL.md` §"The exchange is a first-class
//! object"). The shape is frozen in [`luca_protocol::exchange`]; this module is
//! the half that says *no*:
//!
//! - **R1** — a `KIND_LUCA_EXCHANGE` (30178) record is accepted only from the
//!   owner of every member it lists, with a `d` tag and `p` tags that match its
//!   own content, and (at depth 2) a real depth-1 parent.
//! - **R2** — a room message carrying `["exchange", <id>, <turn>]` is accepted
//!   only from a member of an open, unexpired exchange, in that exchange's own
//!   room, mentioning nobody outside its members, for a turn inside the bucket
//!   that nobody has spoken yet. The owner never carries the tag at all.
//! - **R3** — a resident-authored room message that `p`-tags a *sibling*
//!   (another resident of the same owner) without an exchange tag is refused —
//!   on every kind that can wake a sibling, not just kind:9 (see
//!   [`EXCHANGE_MENTION_GATE_KINDS`]). That closes the shell / `buzz-cli` side
//!   door independently of the harness.
//!
//! Everything here fails closed: a DB error, a missing head, a malformed tag or
//! an unparseable count refuses the write. Two structural facts drive the
//! implementation and are load-bearing:
//!
//! 1. **JSONB containment on `tags` is set-like, not positional.** A junk tag
//!    such as `["e", <id>, "exchange", "2"]` satisfies `tags @> [["exchange",
//!    <id>]]`. Containment is therefore only ever an index *prefilter*; every
//!    authoritative decision re-parses candidate tags with
//!    [`ExchangeTurnTag::find`] (or the positional predicate handed to the
//!    guarded insert), which requires `len == 3`, a positional lowercase-hex64
//!    id and a turn in `1..=10`.
//! 2. **A deleted turn stays spent.** The uniqueness probe deliberately does not
//!    filter `deleted_at`, so deleting your own turn cannot refund budget.

use std::sync::Arc;

use buzz_core::kind::{
    KIND_LUCA_EXCHANGE, KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_DIFF, KIND_STREAM_MESSAGE_EDIT,
    KIND_STREAM_MESSAGE_SCHEDULED, KIND_STREAM_MESSAGE_V2, KIND_STREAM_REMINDER,
};
use buzz_core::tenant::TenantContext;
use luca_protocol::{
    ExchangeRecordV1, ExchangeStateV1, ExchangeTurnTag, EXCHANGE_MAX_MEMBERS, EXCHANGE_TAG,
};
use nostr::Event;

use crate::state::AppState;

use super::ingest::IngestError;

/// Upper bound on `p` tags the sibling-mention gate (R3) will resolve.
///
/// Each unresolved `p` tag costs one indexed DB read, so an agent-authored
/// message with an unbounded mention fan is refused rather than served.
const MAX_AGENT_MENTION_TAGS: usize = 64;

/// A resident's claim on one turn of one exchange, carried from the validator
/// block down to the guarded insert.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExchangeTurnClaim {
    /// The exchange whose budget this message spends.
    pub exchange_id: String,
    /// The 1-based turn being claimed.
    pub turn: u8,
    /// The exchange's resident members, as pubkey bytes. Handed to the guarded
    /// insert so the uniqueness probe only ever looks at rows the exchange's
    /// own members wrote.
    pub members: Vec<Vec<u8>>,
}

/// Kinds whose messages can spend an exchange turn.
///
/// Both room-speech kinds take the same ingest path, so one gate covers both.
pub const EXCHANGE_SPEECH_KINDS: [i32; 2] =
    [KIND_STREAM_MESSAGE as i32, KIND_STREAM_MESSAGE_V2 as i32];

/// Kinds on which a resident's `p` tag can wake a sibling, so the
/// sibling-mention gate (R3) must run on all of them.
///
/// R2 (the turn tag) only ever rides on [`EXCHANGE_SPEECH_KINDS`], but R3 is a
/// *wake* gate, and the harness's default subscription is
/// `[KIND_STREAM_MESSAGE, KIND_WORKFLOW_APPROVAL_REQUESTED, KIND_STREAM_REMINDER]`
/// filtered by mention (`buzz-acp/src/config.rs::resolve_channel_filters`), with
/// `SubscribeMode::All` widening it to every kind in the room. Gating only
/// kind:9 would leave 40007 as an unmetered doorbell: a resident could wake a
/// sibling with a reminder and no exchange would ever be minted.
///
/// The set is every room kind a resident may author that carries `p` mentions:
///
/// - 9 / 40002 — room speech, the harness's primary wake kind.
/// - 40003 / 40008 — an edit or a diff re-carries the original's `p` tags.
/// - 40006 — a scheduled message is deferred room speech with its mentions intact.
/// - 40007 — a reminder, in the harness's default wake set.
///
/// Deliberately absent: 40004 / 40005 (pin and bookmark are personal markers
/// keyed by `e`, they carry no mention) and 46010
/// (`KIND_WORKFLOW_APPROVAL_REQUESTED` — in the harness wake set, but
/// `required_scope_for_kind` has no arm for it, so a client submitting one is
/// already refused "restricted: unknown event kind").
pub const EXCHANGE_MENTION_GATE_KINDS: [u32; 6] = [
    KIND_STREAM_MESSAGE,
    KIND_STREAM_MESSAGE_V2,
    KIND_STREAM_MESSAGE_EDIT,
    KIND_STREAM_MESSAGE_SCHEDULED,
    KIND_STREAM_REMINDER,
    KIND_STREAM_MESSAGE_DIFF,
];

/// Is this kind ordinary room speech that can spend an exchange turn (R2)?
pub fn is_exchange_speech_kind(kind: u32) -> bool {
    kind == KIND_STREAM_MESSAGE || kind == KIND_STREAM_MESSAGE_V2
}

/// Does the sibling-mention gate (R3) run on this kind?
///
/// See [`EXCHANGE_MENTION_GATE_KINDS`] for the set and why each member is in it.
pub fn is_exchange_mention_gate_kind(kind: u32) -> bool {
    EXCHANGE_MENTION_GATE_KINDS.contains(&kind)
}

/// A stored event's tags as plain string vectors — the shape the protocol
/// parsers take.
pub fn tag_vectors(event: &Event) -> Vec<Vec<String>> {
    event
        .tags
        .iter()
        .map(|tag| tag.as_slice().to_vec())
        .collect()
}

/// Does this tag set positionally claim `turn` of `exchange_id`?
///
/// This is the authoritative uniqueness predicate handed to
/// [`buzz_db::Database::insert_event_if_exchange_turn_unclaimed`] so the
/// containment prefilter's false positives (finding 1 in the module docs) can
/// never register as a spoken turn. `exchange_id` is already validated
/// lowercase hex64 by the caller, and `"02"` / `"+2"` are normalised by the
/// same `u8` parse the contract uses.
pub fn tags_claim_turn(tags: &[Vec<String>], exchange_id: &str, turn: u8) -> bool {
    tags.iter().any(|tag| {
        tag.len() == 3
            && tag[0] == EXCHANGE_TAG
            && tag[1] == exchange_id
            && tag[2].parse::<u8>().is_ok_and(|parsed| parsed == turn)
    })
}

/// Does this event carry a well-formed turn tag for any of `exchange_ids`?
///
/// The `#exchange` COUNT/query sidecar uses this to re-check the containment
/// prefilter's candidate rows before they are counted or returned.
pub fn event_matches_exchange_ids(event: &Event, exchange_ids: &[String]) -> bool {
    match ExchangeTurnTag::find(&tag_vectors(event)) {
        Ok(Some(tag)) => exchange_ids.iter().any(|id| id == tag.exchange_id.as_str()),
        Ok(None) | Err(_) => false,
    }
}

/// Every `p` tag value on the event, in order, as raw strings.
fn p_tag_values(event: &Event) -> Vec<String> {
    event
        .tags
        .iter()
        .filter_map(|tag| {
            let parts = tag.as_slice();
            if parts.len() >= 2 && parts[0] == "p" {
                Some(parts[1].clone())
            } else {
                None
            }
        })
        .collect()
}

/// Static, DB-free half of R1: parse the record and check it against its own
/// envelope. Returns the parsed record for the authorization half.
pub fn validate_exchange_record_envelope(event: &Event) -> Result<ExchangeRecordV1, String> {
    let record = ExchangeRecordV1::from_content(&event.content)
        .map_err(|e| format!("invalid: exchange record {e}"))?;

    let d_tag = buzz_db::event::extract_d_tag(event).unwrap_or_default();
    if d_tag != record.exchange_id.as_str() {
        return Err("invalid: exchange d tag must equal exchange_id".to_owned());
    }

    // `p` tags must be exactly the member set — no extra recipient, no missing
    // member. Members are already sorted and unique by `validate()`.
    let mut p_values = p_tag_values(event);
    p_values.sort();
    p_values.dedup();
    let members: Vec<String> = record
        .members
        .iter()
        .map(|m| m.as_str().to_owned())
        .collect();
    if p_values != members {
        return Err("invalid: exchange p tags must equal members".to_owned());
    }

    if record.owner.as_str() != event.pubkey.to_hex() {
        return Err("restricted: exchange record must be authored by its owner".to_owned());
    }

    if record.deadline.get() <= event.created_at.as_secs() {
        return Err("invalid: exchange deadline must be after created_at".to_owned());
    }

    Ok(record)
}

/// Read-through, **positive-only** agent→owner lookup.
///
/// A hit (`Some(owner)`) is cached for the state's TTL because
/// `users.agent_owner_pubkey` is immutable inside a community. A miss is never
/// cached: a resident minted seconds ago must not be invisible to R2/R3 for the
/// length of a TTL. DB errors propagate so the caller fails closed.
pub async fn resolve_agent_owner(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    pubkey_bytes: &[u8],
) -> Result<Option<Vec<u8>>, IngestError> {
    let key = (tenant.community(), pubkey_bytes.to_vec());
    if let Some(owner) = state.agent_owner_cache.get(&key) {
        return Ok(Some(owner));
    }
    let owner = match state
        .db
        .get_agent_channel_policy(key.0, pubkey_bytes)
        .await
        .map_err(|e| IngestError::Internal(format!("error: exchange owner lookup failed: {e}")))?
    {
        Some((_, Some(owner))) => owner,
        Some((_, None)) | None => return Ok(None),
    };
    state.agent_owner_cache.insert(key, owner.clone());
    Ok(Some(owner))
}

/// Fetch the current head record for `exchange_id` authored by `author_bytes`.
async fn load_exchange_head(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    exchange_id: &str,
    author_bytes: &[u8],
) -> Result<Option<ExchangeRecordV1>, IngestError> {
    let query = buzz_db::EventQuery {
        kinds: Some(vec![KIND_LUCA_EXCHANGE as i32]),
        pubkey: Some(author_bytes.to_vec()),
        d_tag: Some(exchange_id.to_owned()),
        limit: Some(1),
        global_only: true,
        ..buzz_db::EventQuery::for_community(tenant.community())
    };
    let rows =
        state.db.query_events(&query).await.map_err(|e| {
            IngestError::Internal(format!("error: exchange head lookup failed: {e}"))
        })?;
    let Some(head) = rows.into_iter().next() else {
        return Ok(None);
    };
    Ok(ExchangeRecordV1::from_content(&head.event.content).ok())
}

/// Full R1: envelope, then the DB-backed authorization that the author owns
/// every member and that a depth-2 record hangs off a real depth-1 parent.
pub async fn validate_exchange_record(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    event: &Event,
) -> Result<(), IngestError> {
    let record = validate_exchange_record_envelope(event).map_err(IngestError::Rejected)?;
    let author_bytes = event.pubkey.to_bytes().to_vec();

    if record.members.len() > EXCHANGE_MAX_MEMBERS {
        // Belt and braces: `validate()` already bounds this, but the DB loop
        // below must never be unbounded.
        return Err(IngestError::Rejected(
            "invalid: exchange record members exceed the bound".to_owned(),
        ));
    }

    for member in &record.members {
        let member_bytes = hex::decode(member.as_str()).map_err(|_| {
            IngestError::Rejected("invalid: exchange member is not a pubkey".to_owned())
        })?;
        let is_owner = state
            .db
            .is_agent_owner(tenant.community(), &member_bytes, &author_bytes)
            .await
            .map_err(|e| {
                IngestError::Internal(format!("error: exchange membership lookup failed: {e}"))
            })?;
        if !is_owner {
            return Err(IngestError::AuthFailed(
                "restricted: exchange members must all be residents of the author".to_owned(),
            ));
        }
    }

    if record.depth == 2 {
        let Some(parent_id) = record.parent_exchange_id.as_ref() else {
            // Unreachable via `validate()`, kept so the branch cannot fail open.
            return Err(IngestError::Rejected(
                "invalid: exchange depth 2 requires a parent".to_owned(),
            ));
        };
        let parent = load_exchange_head(state, tenant, parent_id.as_str(), &author_bytes).await?;
        match parent {
            Some(parent) if parent.depth == 1 => {}
            _ => {
                return Err(IngestError::Rejected(
                    "restricted: exchange parent not found".to_owned(),
                ))
            }
        }
    }

    Ok(())
}

/// The DB-free half of the room-message gate: what, if anything, this message
/// still has to be authorized for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExchangePreflight {
    /// Nothing to decide — no turn tag and no mention worth a lookup. Most
    /// speech in most rooms lands here and never touches the database.
    Nothing,
    /// The message needs the DB-backed half.
    Authorize {
        /// The turn tag it carries, if any.
        turn_tag: Option<ExchangeTurnTag>,
        /// Its `p` tag values, in order, unfiltered.
        mentions: Vec<String>,
    },
}

/// Decide whether a room message needs exchange authorization at all, and
/// refuse the shapes that are wrong before any state is read.
///
/// Kept pure and separate for two reasons: the cheap exit is the thing that
/// keeps an ordinary kind:9 from paying a DB read (and inheriting a new way to
/// fail), and every refusal here is a static fact about the event that deserves
/// a test without a Postgres.
pub fn exchange_preflight(event: &Event, kind: u32) -> Result<ExchangePreflight, String> {
    let turn_tag = ExchangeTurnTag::find(&tag_vectors(event)).map_err(|_| {
        "invalid: exchange tag must be [\"exchange\", <hex64>, <1..=10>] and appear once".to_owned()
    })?;
    let mentions = p_tag_values(event);

    if turn_tag.is_none() && mentions.is_empty() {
        return Ok(ExchangePreflight::Nothing);
    }

    // A turn tag only means something on a kind that can spend one. Anywhere
    // else it is a claim nobody counts, so refuse it rather than let it look
    // like a licence to wake a sibling.
    if turn_tag.is_some() && !is_exchange_speech_kind(kind) {
        return Err("invalid: exchange tag on a kind that cannot spend a turn".to_owned());
    }

    if mentions.len() > MAX_AGENT_MENTION_TAGS {
        return Err(format!(
            "invalid: too many mentions (max {MAX_AGENT_MENTION_TAGS} for a room message)"
        ));
    }

    Ok(ExchangePreflight::Authorize { turn_tag, mentions })
}

/// R2 + R3 for one room message.
///
/// `Ok(Some(claim))` — the message spends `claim.turn`; the caller must route it
/// through the guarded insert so two concurrent claims cannot both land.
/// `Ok(None)` — nothing to count: neither a turn tag nor a mention worth
/// resolving.
pub async fn authorize_exchange_message(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    event: &Event,
    kind: u32,
    channel_id: Option<uuid::Uuid>,
) -> Result<Option<ExchangeTurnClaim>, IngestError> {
    let (turn_tag, mentions) =
        match exchange_preflight(event, kind).map_err(IngestError::Rejected)? {
            ExchangePreflight::Nothing => return Ok(None),
            ExchangePreflight::Authorize { turn_tag, mentions } => (turn_tag, mentions),
        };

    let author_bytes = event.pubkey.to_bytes().to_vec();
    let author_owner = resolve_agent_owner(state, tenant, &author_bytes).await?;

    let Some(turn_tag) = turn_tag else {
        // No exchange tag: the only remaining question is whether a resident is
        // reaching for a sibling without one (R3).
        let Some(author_owner) = author_owner else {
            // A human (or an unregistered key) mentioning whoever they like.
            return Ok(None);
        };
        if !siblings_mentioned(state, tenant, event, &mentions, &author_owner)
            .await?
            .is_empty()
        {
            return Err(IngestError::AuthFailed(
                "restricted: resident-to-resident mention needs an exchange".to_owned(),
            ));
        }
        return Ok(None);
    };

    let exchange_id = turn_tag.exchange_id.as_str().to_owned();

    // Whose head do we trust? A registered resident's exchange is minted by its
    // own owner; an unregistered author can only be speaking inside an exchange
    // they minted themselves. Either way the head is looked up *by author*, so a
    // resident of one house can never reach another house's exchange.
    let head_author = author_owner.clone().unwrap_or_else(|| author_bytes.clone());
    let Some(record) = load_exchange_head(state, tenant, &exchange_id, &head_author).await? else {
        return Err(IngestError::Rejected(
            "restricted: exchange: no such exchange".to_owned(),
        ));
    };
    if record.owner.as_str() != hex::encode(&head_author) {
        return Err(IngestError::Rejected(
            "restricted: exchange: no such exchange".to_owned(),
        ));
    }

    // The contract is explicit: owner messages never carry the tag and never
    // count. Accepting one "uncounted" would still leave a row that occupies
    // the turn in the uniqueness probe and shows up in the spent COUNT, so a
    // tagged owner message is refused outright.
    if record.owner.as_str() == event.pubkey.to_hex() {
        return Err(IngestError::Rejected(
            "invalid: exchange tag on an owner message".to_owned(),
        ));
    }

    let author_hex = luca_protocol::Hex64::parse(event.pubkey.to_hex())
        .map_err(|_| IngestError::Rejected("invalid: exchange author pubkey".to_owned()))?;
    if !record.is_member(&author_hex) {
        return Err(IngestError::AuthFailed(
            "restricted: exchange: not a member".to_owned(),
        ));
    }

    // An exchange lives in exactly one conversation, and a turn of E may only be
    // spent in E's room. `conversation_id` is the `h` value the desktop writes,
    // so it must name a channel; one that does not is a room we cannot verify,
    // and an unverifiable room fails closed.
    let Ok(conversation) = record.conversation_id.as_str().parse::<uuid::Uuid>() else {
        return Err(IngestError::Rejected(
            "restricted: exchange: wrong conversation".to_owned(),
        ));
    };
    if channel_id != Some(conversation) {
        return Err(IngestError::Rejected(
            "restricted: exchange: wrong conversation".to_owned(),
        ));
    }

    if record.state != ExchangeStateV1::Open {
        return Err(IngestError::Rejected(
            "restricted: exchange closed".to_owned(),
        ));
    }
    // Expiry is decided on server time. `created_at` is client-declared and the
    // drift window admits it up to 900 s in the future, so trusting it alone
    // would hand every resident a quarter hour past the deadline. The declared
    // time is still checked, so a message stamped after the deadline is refused
    // even inside the window.
    let now = chrono::Utc::now().timestamp();
    let now_unix = u64::try_from(now).map_err(|_| {
        IngestError::Internal("error: exchange deadline check has no clock".to_owned())
    })?;
    if now_unix > record.deadline.get() || event.created_at.as_secs() > record.deadline.get() {
        return Err(IngestError::Rejected(
            "restricted: exchange expired".to_owned(),
        ));
    }
    if turn_tag.turn == 0 || turn_tag.turn > record.bucket {
        return Err(IngestError::Rejected(
            "restricted: exchange exhausted".to_owned(),
        ));
    }

    // Last, because it is the only remaining check that costs a DB read per
    // mention: a turn tag is not a licence to reach for anyone. Every sibling
    // this message mentions must be inside the exchange that bounds it —
    // otherwise one 3-turn exchange between Luca and Vektor would let either of
    // them wake every other resident in the house, unmetered.
    let members: Vec<Vec<u8>> = record
        .members
        .iter()
        .map(|member| {
            member.decode().map(|bytes| bytes.to_vec()).map_err(|_| {
                IngestError::Rejected("invalid: exchange member is not a pubkey".to_owned())
            })
        })
        .collect::<Result<_, _>>()?;
    for sibling in siblings_mentioned(state, tenant, event, &mentions, &head_author).await? {
        let sibling_hex = luca_protocol::Hex64::parse(sibling)
            .map_err(|_| IngestError::Rejected("invalid: exchange mention pubkey".to_owned()))?;
        if !record.is_member(&sibling_hex) {
            return Err(IngestError::AuthFailed(
                "restricted: exchange: mention outside members".to_owned(),
            ));
        }
    }

    Ok(Some(ExchangeTurnClaim {
        exchange_id,
        turn: turn_tag.turn,
        members,
    }))
}

/// The `p` tag values worth one owner lookup each, in tag order.
///
/// Lowercased and deduplicated so a repeated mention costs one read, with the
/// author's own key dropped (a self-mention is not a reach) and any value that
/// is not a 32-byte hex pubkey dropped too — it can never match a registered
/// resident row.
pub fn mention_candidates(mentions: &[String], author_hex: &str) -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();
    for mention in mentions {
        let mention = mention.to_ascii_lowercase();
        if mention.eq_ignore_ascii_case(author_hex) || candidates.contains(&mention) {
            continue;
        }
        if hex::decode(&mention).is_ok_and(|bytes| bytes.len() == 32) {
            candidates.push(mention);
        }
    }
    candidates
}

/// Which of this message's `p` tags name a resident of `house_owner`?
///
/// Shared by both mention rules — R3 ("a resident may not reach for a sibling
/// without an exchange") and the tagged-message rule ("a turn may not reach
/// outside its own members") — so the two can never drift apart on what counts
/// as a sibling. Returns lowercase hex pubkeys, deduplicated, in tag order.
///
/// Each unresolved candidate costs one indexed read, bounded by
/// [`MAX_AGENT_MENTION_TAGS`] in [`exchange_preflight`].
async fn siblings_mentioned(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    event: &Event,
    mentions: &[String],
    house_owner: &[u8],
) -> Result<Vec<String>, IngestError> {
    let mut siblings: Vec<String> = Vec::new();
    for mention in mention_candidates(mentions, &event.pubkey.to_hex()) {
        let Ok(mention_bytes) = hex::decode(&mention) else {
            continue;
        };
        let Some(mention_owner) = resolve_agent_owner(state, tenant, &mention_bytes).await? else {
            continue;
        };
        if mention_owner == house_owner {
            siblings.push(mention);
        }
    }
    Ok(siblings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::{Hex64, OpaqueId};
    use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};

    const LUCA: &str = "2222222222222222222222222222222222222222222222222222222222222222";
    const VEKTOR: &str = "3333333333333333333333333333333333333333333333333333333333333333";
    const KAI: &str = "4444444444444444444444444444444444444444444444444444444444444444";
    const ROOT: &str = "abababababababababababababababababababababababababababababababab";

    fn hex(value: &str) -> Hex64 {
        Hex64::parse(value).expect("test vector is hex64")
    }

    fn record_for(owner: &Keys, members: Vec<Hex64>, opened_by: Hex64) -> ExchangeRecordV1 {
        ExchangeRecordV1::open(
            hex(&owner.public_key().to_hex()),
            members,
            OpaqueId::parse("11111111-2222-3333-4444-555555555555").expect("uuid is opaque-safe"),
            hex(ROOT),
            opened_by,
            None,
            1_000_000,
        )
        .expect("record opens")
    }

    /// Sign a 30178 event for `record`, letting the caller mangle the tags.
    fn record_event(keys: &Keys, record: &ExchangeRecordV1, tags: Vec<Vec<String>>) -> Event {
        let nostr_tags: Vec<Tag> = tags
            .iter()
            .map(|t| Tag::parse(t.iter().map(String::as_str)).expect("tag parses"))
            .collect();
        EventBuilder::new(
            Kind::Custom(KIND_LUCA_EXCHANGE as u16),
            record.to_content().expect("canonical content"),
        )
        .tags(nostr_tags)
        .custom_created_at(Timestamp::from(1_000_000u64))
        .sign_with_keys(keys)
        .expect("event signs")
    }

    fn valid_record_event() -> (Keys, ExchangeRecordV1, Event) {
        let owner = Keys::generate();
        let record = record_for(&owner, vec![hex(LUCA), hex(VEKTOR)], hex(LUCA));
        let event = record_event(&owner, &record, record.event_tags());
        (owner, record, event)
    }

    #[test]
    fn envelope_accepts_a_well_formed_owner_authored_record() {
        let (_, record, event) = valid_record_event();
        let parsed = validate_exchange_record_envelope(&event).expect("envelope is valid");
        assert_eq!(parsed.exchange_id, record.exchange_id);
    }

    #[test]
    fn envelope_rejects_a_record_authored_by_anyone_but_its_owner() {
        let owner = Keys::generate();
        let impostor = Keys::generate();
        let record = record_for(&owner, vec![hex(LUCA), hex(VEKTOR)], hex(LUCA));
        let event = record_event(&impostor, &record, record.event_tags());
        let err = validate_exchange_record_envelope(&event).expect_err("non-owner is refused");
        assert!(
            err.starts_with("restricted: exchange record must be authored by its owner"),
            "unexpected reason: {err}"
        );
    }

    #[test]
    fn envelope_rejects_a_d_tag_that_is_not_the_exchange_id() {
        let (owner, record, _) = valid_record_event();
        let mut tags = record.event_tags();
        tags[0] = vec!["d".to_owned(), KAI.to_owned()];
        let event = record_event(&owner, &record, tags);
        let err = validate_exchange_record_envelope(&event).expect_err("d tag mismatch is refused");
        assert!(err.contains("d tag must equal exchange_id"), "{err}");
    }

    #[test]
    fn envelope_rejects_p_tags_that_are_not_exactly_the_members() {
        let (owner, record, _) = valid_record_event();
        // One member dropped.
        let short = vec![
            vec!["d".to_owned(), record.exchange_id.as_str().to_owned()],
            vec!["p".to_owned(), LUCA.to_owned()],
        ];
        let err = validate_exchange_record_envelope(&record_event(&owner, &record, short))
            .expect_err("missing member is refused");
        assert!(err.contains("p tags must equal members"), "{err}");
        // One extra recipient.
        let mut long = record.event_tags();
        long.push(vec!["p".to_owned(), KAI.to_owned()]);
        let err = validate_exchange_record_envelope(&record_event(&owner, &record, long))
            .expect_err("extra recipient is refused");
        assert!(err.contains("p tags must equal members"), "{err}");
    }

    #[test]
    fn envelope_rejects_a_deadline_that_has_already_passed() {
        let owner = Keys::generate();
        let record = record_for(&owner, vec![hex(LUCA), hex(VEKTOR)], hex(LUCA));
        let tags: Vec<Tag> = record
            .event_tags()
            .iter()
            .map(|t| Tag::parse(t.iter().map(String::as_str)).expect("tag parses"))
            .collect();
        let event = EventBuilder::new(
            Kind::Custom(KIND_LUCA_EXCHANGE as u16),
            record.to_content().expect("canonical content"),
        )
        .tags(tags)
        .custom_created_at(Timestamp::from(record.deadline.get()))
        .sign_with_keys(&owner)
        .expect("event signs");
        let err = validate_exchange_record_envelope(&event).expect_err("stale deadline is refused");
        assert!(err.contains("deadline must be after created_at"), "{err}");
    }

    #[test]
    fn envelope_rejects_content_the_contract_refuses() {
        let owner = Keys::generate();
        let record = record_for(&owner, vec![hex(LUCA), hex(VEKTOR)], hex(LUCA));
        let content = record.to_content().expect("canonical content");
        // Bucket above the ceiling, and the owner listed among its own members:
        // both are contract violations, so they never reach our own checks.
        for tampered in [
            content.replace("\"bucket\":3", "\"bucket\":11"),
            content.replace(LUCA, owner.public_key().to_hex().as_str()),
        ] {
            let tags: Vec<Tag> = record
                .event_tags()
                .iter()
                .map(|t| Tag::parse(t.iter().map(String::as_str)).expect("tag parses"))
                .collect();
            let event = EventBuilder::new(Kind::Custom(KIND_LUCA_EXCHANGE as u16), tampered)
                .tags(tags)
                .custom_created_at(Timestamp::from(1_000_000u64))
                .sign_with_keys(&owner)
                .expect("event signs");
            let err = validate_exchange_record_envelope(&event)
                .expect_err("contract violation is refused");
            assert!(err.starts_with("invalid: exchange record"), "{err}");
        }
    }

    /// Only the *contract's* half of the depth rule — a record claiming depth 2
    /// with no `parent_exchange_id` never parses, so the relay never sees it.
    ///
    /// This is deliberately NOT coverage of the relay's parent-existence check
    /// (`restricted: exchange parent not found`): that one needs a real parent
    /// head in a real database, and lives in `e2e_exchange.rs`
    /// (`exchange_depth_two_needs_a_real_depth_one_parent`).
    #[test]
    fn envelope_rejects_depth_two_content_the_contract_itself_refuses_to_parse() {
        let owner = Keys::generate();
        let record = record_for(&owner, vec![hex(LUCA), hex(VEKTOR)], hex(LUCA));
        let content = record
            .to_content()
            .expect("canonical content")
            .replace("\"depth\":1", "\"depth\":2");
        let tags: Vec<Tag> = record
            .event_tags()
            .iter()
            .map(|t| Tag::parse(t.iter().map(String::as_str)).expect("tag parses"))
            .collect();
        let event = EventBuilder::new(Kind::Custom(KIND_LUCA_EXCHANGE as u16), content)
            .tags(tags)
            .custom_created_at(Timestamp::from(1_000_000u64))
            .sign_with_keys(&owner)
            .expect("event signs");
        let err = validate_exchange_record_envelope(&event).expect_err("orphan depth-2 refused");
        assert!(err.starts_with("invalid: exchange record"), "{err}");
    }

    #[test]
    fn containment_false_positives_never_register_as_a_spoken_turn() {
        // These are the exact tag shapes that satisfy the JSONB containment
        // prefilter `tags @> [["exchange","<id>"]]` while meaning nothing.
        let junk_e_tag = vec![
            "e".to_owned(),
            ROOT.to_owned(),
            EXCHANGE_TAG.to_owned(),
            "2".to_owned(),
        ];
        let reordered = vec![EXCHANGE_TAG.to_owned(), "2".to_owned(), ROOT.to_owned()];
        assert!(!tags_claim_turn(std::slice::from_ref(&junk_e_tag), ROOT, 2));
        assert!(!tags_claim_turn(std::slice::from_ref(&reordered), ROOT, 2));
        // And neither parses as a turn tag at all.
        assert!(!event_matches_exchange_ids(
            &speech_event(&Keys::generate(), vec![junk_e_tag]),
            &[ROOT.to_owned()]
        ));
        assert!(!event_matches_exchange_ids(
            &speech_event(&Keys::generate(), vec![reordered]),
            &[ROOT.to_owned()]
        ));
    }

    fn speech_event(keys: &Keys, tags: Vec<Vec<String>>) -> Event {
        let nostr_tags: Vec<Tag> = tags
            .iter()
            .map(|t| Tag::parse(t.iter().map(String::as_str)).expect("tag parses"))
            .collect();
        EventBuilder::new(Kind::Custom(KIND_STREAM_MESSAGE as u16), "hello")
            .tags(nostr_tags)
            .sign_with_keys(keys)
            .expect("event signs")
    }

    #[test]
    fn tags_claim_turn_matches_the_contract_parse() {
        let claim = vec![EXCHANGE_TAG.to_owned(), ROOT.to_owned(), "2".to_owned()];
        assert!(tags_claim_turn(std::slice::from_ref(&claim), ROOT, 2));
        assert!(!tags_claim_turn(std::slice::from_ref(&claim), ROOT, 3));
        assert!(!tags_claim_turn(&[claim], KAI, 2));
        // A zero-padded or signed turn is the same turn — a string compare
        // would have let it claim the slot twice.
        for spelling in ["02", "+2"] {
            let padded = vec![
                EXCHANGE_TAG.to_owned(),
                ROOT.to_owned(),
                spelling.to_owned(),
            ];
            assert!(tags_claim_turn(&[padded], ROOT, 2), "{spelling}");
        }
        let short = vec![EXCHANGE_TAG.to_owned(), ROOT.to_owned()];
        assert!(!tags_claim_turn(&[short], ROOT, 2));
    }

    #[test]
    fn event_matches_exchange_ids_needs_a_well_formed_tag() {
        let keys = Keys::generate();
        let tagged = speech_event(
            &keys,
            vec![vec![
                EXCHANGE_TAG.to_owned(),
                ROOT.to_owned(),
                "1".to_owned(),
            ]],
        );
        assert!(event_matches_exchange_ids(&tagged, &[ROOT.to_owned()]));
        assert!(!event_matches_exchange_ids(&tagged, &[KAI.to_owned()]));
        let untagged = speech_event(&keys, vec![vec!["p".to_owned(), LUCA.to_owned()]]);
        assert!(!event_matches_exchange_ids(&untagged, &[ROOT.to_owned()]));
        // Two exchange tags are a contract error, and an error never counts.
        let doubled = speech_event(
            &keys,
            vec![
                vec![EXCHANGE_TAG.to_owned(), ROOT.to_owned(), "1".to_owned()],
                vec![EXCHANGE_TAG.to_owned(), KAI.to_owned(), "2".to_owned()],
            ],
        );
        assert!(!event_matches_exchange_ids(&doubled, &[ROOT.to_owned()]));
    }

    #[test]
    fn speech_kinds_are_the_two_room_message_kinds() {
        assert!(is_exchange_speech_kind(KIND_STREAM_MESSAGE));
        assert!(is_exchange_speech_kind(KIND_STREAM_MESSAGE_V2));
        assert!(!is_exchange_speech_kind(KIND_LUCA_EXCHANGE));
        assert_eq!(
            EXCHANGE_SPEECH_KINDS,
            [KIND_STREAM_MESSAGE as i32, KIND_STREAM_MESSAGE_V2 as i32]
        );
    }

    #[test]
    fn the_mention_gate_covers_every_kind_that_can_wake_a_sibling() {
        // The hole this closes: 40007 is in the harness's default wake set
        // (`buzz-acp/src/config.rs::resolve_channel_filters`), so gating only
        // kind:9 would leave a reminder as an unmetered doorbell to a sibling.
        for kind in [
            KIND_STREAM_MESSAGE,
            KIND_STREAM_MESSAGE_V2,
            KIND_STREAM_MESSAGE_EDIT,
            KIND_STREAM_MESSAGE_SCHEDULED,
            KIND_STREAM_REMINDER,
            KIND_STREAM_MESSAGE_DIFF,
        ] {
            assert!(is_exchange_mention_gate_kind(kind), "{kind} must be gated");
        }
        // Every kind that can spend a turn must also be gated for mentions —
        // otherwise a turn could be spent on a kind whose mentions nobody checks.
        for kind in EXCHANGE_SPEECH_KINDS {
            assert!(is_exchange_mention_gate_kind(kind as u32), "{kind}");
        }
        // Pins and bookmarks reference an event, not a person, and the exchange
        // record itself is not room speech.
        for kind in [
            buzz_core::kind::KIND_STREAM_MESSAGE_PINNED,
            buzz_core::kind::KIND_STREAM_MESSAGE_BOOKMARKED,
            KIND_LUCA_EXCHANGE,
        ] {
            assert!(!is_exchange_mention_gate_kind(kind), "{kind}");
        }
    }

    #[test]
    fn a_plain_message_with_no_tag_and_no_mention_never_reaches_the_database() {
        // The whole point of the preflight: ordinary speech (the overwhelming
        // majority of kind:9) must not pay an owner lookup, nor gain a new
        // Internal failure mode, for a feature it is not using.
        let plain = speech_event(&Keys::generate(), vec![]);
        assert_eq!(
            exchange_preflight(&plain, KIND_STREAM_MESSAGE).expect("plain speech is fine"),
            ExchangePreflight::Nothing
        );
        let with_e_tag = speech_event(
            &Keys::generate(),
            vec![vec!["e".to_owned(), ROOT.to_owned()]],
        );
        assert_eq!(
            exchange_preflight(&with_e_tag, KIND_STREAM_MESSAGE).expect("a reply is fine"),
            ExchangePreflight::Nothing
        );
    }

    #[test]
    fn preflight_asks_for_authorization_when_there_is_a_tag_or_a_mention() {
        let keys = Keys::generate();
        let tagged = speech_event(
            &keys,
            vec![vec![
                EXCHANGE_TAG.to_owned(),
                ROOT.to_owned(),
                "2".to_owned(),
            ]],
        );
        match exchange_preflight(&tagged, KIND_STREAM_MESSAGE).expect("tagged speech") {
            ExchangePreflight::Authorize { turn_tag, mentions } => {
                assert_eq!(turn_tag.map(|t| t.turn), Some(2));
                assert!(mentions.is_empty());
            }
            other => panic!("expected Authorize, got {other:?}"),
        }
        let mentioning = speech_event(&keys, vec![vec!["p".to_owned(), LUCA.to_owned()]]);
        match exchange_preflight(&mentioning, KIND_STREAM_MESSAGE).expect("a mention") {
            ExchangePreflight::Authorize { turn_tag, mentions } => {
                assert!(turn_tag.is_none());
                assert_eq!(mentions, vec![LUCA.to_owned()]);
            }
            other => panic!("expected Authorize, got {other:?}"),
        }
    }

    #[test]
    fn a_turn_tag_on_a_kind_that_cannot_spend_one_is_refused() {
        // A reminder carrying a turn tag would look like a metered wake while
        // costing nothing — the tag is never counted on 40007. Refuse it rather
        // than let it read as a licence.
        let event = EventBuilder::new(Kind::Custom(KIND_STREAM_REMINDER as u16), "ping")
            .tags(vec![Tag::parse([EXCHANGE_TAG, ROOT, "1"]).expect("tag")])
            .sign_with_keys(&Keys::generate())
            .expect("event signs");
        let err = exchange_preflight(&event, KIND_STREAM_REMINDER)
            .expect_err("a turn tag off a speech kind is refused");
        assert_eq!(
            err,
            "invalid: exchange tag on a kind that cannot spend a turn"
        );
    }

    #[test]
    fn preflight_refuses_a_malformed_tag_and_an_unbounded_mention_fan() {
        let keys = Keys::generate();
        let short = speech_event(&keys, vec![vec![EXCHANGE_TAG.to_owned(), ROOT.to_owned()]]);
        assert!(exchange_preflight(&short, KIND_STREAM_MESSAGE)
            .expect_err("a two-element tag is malformed")
            .starts_with("invalid: exchange tag"));

        // Each unresolved mention is one indexed read; an unbounded fan is a
        // scan dressed up as a message.
        let many: Vec<Vec<String>> = (0..=MAX_AGENT_MENTION_TAGS)
            .map(|i| vec!["p".to_owned(), format!("{i:064x}")])
            .collect();
        let event = speech_event(&keys, many);
        assert!(exchange_preflight(&event, KIND_STREAM_MESSAGE)
            .expect_err("too many mentions")
            .starts_with("invalid: too many mentions"));
    }

    #[test]
    fn mention_candidates_drop_self_duplicates_and_non_pubkeys() {
        let author = Keys::generate();
        let author_hex = author.public_key().to_hex();
        let candidates = mention_candidates(
            &[
                LUCA.to_owned(),
                LUCA.to_uppercase(),       // same key, different spelling
                author_hex.to_owned(),     // self-mention is not a reach
                "not-a-pubkey".to_owned(), // cannot name a resident row
                "abcd".to_owned(),         // hex, but not 32 bytes
                VEKTOR.to_owned(),
            ],
            &author_hex,
        );
        assert_eq!(candidates, vec![LUCA.to_owned(), VEKTOR.to_owned()]);
    }

    #[test]
    fn p_tag_values_are_read_in_order() {
        let event = speech_event(
            &Keys::generate(),
            vec![
                vec!["p".to_owned(), LUCA.to_owned()],
                vec!["e".to_owned(), ROOT.to_owned()],
                vec!["p".to_owned(), VEKTOR.to_owned()],
            ],
        );
        assert_eq!(
            p_tag_values(&event),
            vec![LUCA.to_owned(), VEKTOR.to_owned()]
        );
    }
}
