//! The harness half of the exchange object: what this resident knows about the
//! bounded conversations it has been made a member of.
//!
//! A sibling resident's message only earns a turn when it carries a well-formed
//! `["exchange", <id>, <turn>]` tag whose record — the owner-authored
//! `KIND_LUCA_EXCHANGE` head — says this resident is a member, the exchange is
//! open and unexpired, and the turn fits inside the bucket. Everything else is
//! refused, and every refusal has a sentence.
//!
//! Heads arrive two ways: a live REQ on kind 30178 with `#p` = this resident
//! (kept here as the current head per exchange under last-write-wins), and a
//! bounded REST fallback by `#d` when a tag names an exchange this cache has
//! not seen or has not seen recently. The relay is the real enforcer; this
//! cache is defence in depth on the harness's own hot path, and it fails
//! closed — an unverifiable head refuses the turn rather than granting it.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use buzz_core::kind::KIND_LUCA_EXCHANGE;
use luca_protocol::{ExchangeRecordV1, ExchangeStateV1, ExchangeTurnTag, Hex64};
use serde_json::Value;

use crate::relay::RestClient;

/// How long a cached head is trusted **once the live subscription is down**.
///
/// Heads only change at mint, "Stop here" and "Let them go on", and the live
/// subscription delivers those within a socket round-trip — while that leg is
/// carrying, a stored head is current by construction. This bound exists so a
/// Stop still lands within a minute when the leg is abandoned or the socket is
/// gone.
const HEAD_MAX_AGE: Duration = Duration::from_secs(60);

/// Bound on the REST fallback so the main loop can never stall on the relay.
/// Mirrors the sibling-attestation lookup's budget.
const HEAD_REST_TIMEOUT: Duration = Duration::from_millis(2000);

/// How long a refusal that cost a fetch is remembered, so a sibling cannot
/// spend the main loop's time by repeating an exchange the relay will not
/// answer for. Only refusals that come *from* a fetch are remembered; a Stop,
/// an expiry or a spent bucket is decided from a head already in hand.
const NEGATIVE_TTL: Duration = Duration::from_secs(30);

/// Maximum exchanges held at once. A house is not a crowd; on overflow the map
/// is cleared and heads are re-fetched on demand.
const MAX_CACHED_HEADS: usize = 128;

/// Maximum remembered refusals. Same overflow rule as the head map: clear and
/// re-learn rather than grow without bound.
const MAX_CACHED_REFUSALS: usize = 128;

/// How many bounded head fetches a single author may cost the main loop inside
/// [`GATE_FETCH_WINDOW`].
///
/// The negative cache is keyed per exchange id, so it only stops a sibling
/// repeating *the same* unanswerable id. A sibling that fabricates a fresh id
/// every message would still buy a serialized [`HEAD_REST_TIMEOUT`] of the main
/// loop per message. This budget is the bound that closes that: after three
/// fetches inside a minute, the fourth unknown exchange from that author is
/// refused without touching the relay.
const GATE_FETCH_BUDGET: usize = 3;

/// The sliding window [`GATE_FETCH_BUDGET`] is measured over.
const GATE_FETCH_WINDOW: Duration = Duration::from_secs(60);

/// Maximum authors tracked for the fetch budget at once. Authors whose window
/// has fully passed are dropped first; if the table is still full, a *new*
/// author is refused rather than admitted for free — the gate fails closed.
const MAX_TRACKED_FETCH_AUTHORS: usize = 128;

/// The first eight characters of a pubkey — enough to name who a refusal
/// happened to in a log line, without printing a whole key.
fn author_prefix(pubkey: &str) -> &str {
    pubkey.get(..8).unwrap_or(pubkey)
}

/// Whether the live kind-30178 subscription is currently carrying head
/// replacements to this resident.
///
/// The relay task owns the writes; the gate reads it to decide whether a stored
/// head may be trusted without a refresh. Fails closed: a fresh handle reads as
/// down, so nothing is trusted longer than [`HEAD_MAX_AGE`] until the leg has
/// actually said it is up.
#[derive(Debug, Clone, Default)]
pub struct ExchangeLiveLeg(Arc<AtomicBool>);

impl ExchangeLiveLeg {
    /// A handle that starts down.
    pub fn new() -> Self {
        Self::default()
    }

    /// The REQ is registered and the socket is live.
    pub fn mark_healthy(&self) {
        self.0.store(true, Ordering::Relaxed);
    }

    /// The REQ failed, was refused, was parked, or the socket went away.
    pub fn mark_down(&self) {
        self.0.store(false, Ordering::Relaxed);
    }

    /// Is the relay currently pushing head replacements?
    pub fn is_healthy(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

/// What the inbound gate learned about one admitted sibling event.
///
/// Bound to `event_id` on purpose: trust earned by one event's tag can never be
/// transplanted onto another event later in the batch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdmittedExchange {
    /// The event whose tag was checked. Nothing else may claim this admission.
    pub event_id: nostr::EventId,
    /// The exchange the event spends a turn of.
    pub exchange_id: Hex64,
    /// The turn this event spoke (1-based).
    pub turn: u8,
    /// The bucket the head carried when the turn was admitted.
    pub bucket: u8,
    /// The member whose message opened the exchange (turn 1). At depth 1 that
    /// is the resident the owner spoke to; at depth 2 it is the resident who
    /// delegated one hop further.
    pub opened_by: Hex64,
    /// 1 for an exchange opened from an owner-triggered turn, 2 for one hop
    /// further. The sentence the resident reads differs between them.
    pub depth: u8,
}

/// Why a sibling's event did not earn a turn. Every variant has a sentence — a
/// state that happens to a resident is never a silent drop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExchangeRefusal {
    /// No owner is configured, so no exchange can be trusted.
    NoOwner,
    /// A sibling spoke without an exchange tag.
    MissingTag,
    /// The exchange tag was malformed, or more than one was present.
    MalformedTag,
    /// No head for this exchange is known and none could be fetched.
    Unknown,
    /// The head exists but this resident is not one of its members.
    NotAMember,
    /// The owner said "Stop here".
    Closed,
    /// The deadline passed.
    Expired,
    /// The bucket is spent — the turn is beyond it.
    Exhausted,
    /// A head was found but could not be verified as the owner's word.
    HeadUnverifiable,
    /// The wall clock could not be read, so no deadline or budget can be judged.
    ClockUnavailable,
    /// This author has already spent its share of the main loop on exchanges
    /// that could not be verified. Nothing is fetched and nothing is learned.
    FetchBudgetExhausted,
}

impl ExchangeRefusal {
    /// The sentence written for this refusal, addressed to the resident it
    /// happened to.
    pub fn reason(&self) -> &'static str {
        match self {
            Self::NoOwner => "exchange gate has no owner — dropped",
            Self::MissingTag => "sibling spoke without an exchange — dropped",
            Self::MalformedTag => "exchange tag was malformed or repeated — dropped",
            Self::Unknown => "exchange unknown — dropped",
            Self::NotAMember => "not a member of this exchange — dropped",
            Self::Closed => "exchange closed — dropped",
            Self::Expired => "exchange expired — dropped",
            Self::Exhausted => "exchange exhausted — dropped",
            Self::HeadUnverifiable => "exchange record could not be verified — dropped",
            Self::ClockUnavailable => "clock unreadable — the exchange cannot be judged, dropped",
            Self::FetchBudgetExhausted => {
                "too many unverifiable exchanges from this sender — dropped"
            }
        }
    }

    /// Whether this refusal cost a relay round-trip and is therefore worth
    /// remembering for [`NEGATIVE_TTL`]. State refusals decided from a head
    /// already held are cheap and are never cached — a live Go must take effect
    /// on the next message, not thirty seconds later. A
    /// [`Self::FetchBudgetExhausted`] is not remembered either: it already cost
    /// nothing, and caching it would keep refusing after the window has slid.
    fn is_worth_remembering(&self) -> bool {
        matches!(
            self,
            Self::Unknown | Self::NotAMember | Self::HeadUnverifiable
        )
    }
}

/// One cached exchange head, with the ordering data needed for last-write-wins.
#[derive(Debug, Clone)]
struct CachedHead {
    record: ExchangeRecordV1,
    created_at: u64,
    event_id: String,
    seen_at: Instant,
}

/// What happened to a head offered to the cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HeadUpdate {
    /// A new or strictly newer head replaced what was held.
    Stored,
    /// The cache already held a head at least as new; its freshness was renewed.
    Confirmed,
    /// The head was not the owner's word at all — wrong owner, unreadable
    /// record, or an unorderable body.
    Rejected,
    /// The head *was* the owner's valid word about the exchange asked for, and
    /// it does not list this resident. A different sentence from
    /// [`Self::Rejected`]: nothing about it is suspect, the resident simply was
    /// not invited.
    NotAMember,
    /// The head was the owner's word, but about a *different* exchange than the
    /// one asked for. Nothing is learned about the exchange in question.
    WrongExchange,
}

/// The resident's view of the exchanges it belongs to.
///
/// Cheap and non-blocking on a cache hit; at most one bounded REST round-trip
/// on a miss or a stale head. Never grants a turn it could not verify.
pub struct ExchangeCache {
    self_pubkey: Hex64,
    owner: Option<Hex64>,
    heads: Mutex<HashMap<String, CachedHead>>,
    /// Refusals that cost a fetch, remembered for [`NEGATIVE_TTL`] so a sibling
    /// cannot make the main loop pay the same 2 s twice.
    refusals: Mutex<HashMap<String, (ExchangeRefusal, Instant)>>,
    /// When each author last spent a head fetch, so no one author can spend the
    /// main loop on a stream of exchange ids the relay cannot answer for.
    /// Keyed by the event's pubkey; entries older than [`GATE_FETCH_WINDOW`]
    /// are dropped on every check.
    fetch_budget: Mutex<HashMap<String, Vec<Instant>>>,
    /// Whether the live head subscription is carrying replacements right now.
    live_leg: ExchangeLiveLeg,
    /// Set once the first relay-attested (signature-stripped) head is accepted,
    /// so the compromise is stated in the log exactly once.
    attested_head_logged: AtomicBool,
}

impl ExchangeCache {
    /// Build a cache for this resident. `owner` is the harness's configured
    /// owner; without it no head can be trusted and every sibling turn refuses.
    ///
    /// The live leg starts down: until the relay says the subscription is
    /// registered, a stored head ages out after [`HEAD_MAX_AGE`].
    pub fn new(self_pubkey: Hex64, owner: Option<Hex64>) -> Self {
        Self {
            self_pubkey,
            owner,
            heads: Mutex::new(HashMap::new()),
            refusals: Mutex::new(HashMap::new()),
            fetch_budget: Mutex::new(HashMap::new()),
            live_leg: ExchangeLiveLeg::new(),
            attested_head_logged: AtomicBool::new(false),
        }
    }

    /// Bind this cache to the relay's live-leg health flag, so a stored head is
    /// only aged out while the relay is *not* pushing replacements.
    pub fn with_live_leg(mut self, live_leg: ExchangeLiveLeg) -> Self {
        self.live_leg = live_leg;
        self
    }

    /// Ingest a head delivered by the live kind-30178 subscription.
    ///
    /// Verifies the event itself (id + signature), that the author is this
    /// harness's owner, that the content is a valid record naming that owner,
    /// and that this resident is a member. Returns `true` when the head was
    /// stored (or replaced an older one).
    pub fn ingest_head(&self, event: &nostr::Event) -> bool {
        let Some(owner) = self.owner.as_ref() else {
            tracing::debug!("exchange head ignored — no owner configured");
            return false;
        };
        if event.kind.as_u16() as u32 != KIND_LUCA_EXCHANGE {
            tracing::debug!(
                kind = event.kind.as_u16(),
                "exchange head ignored — wrong kind"
            );
            return false;
        }
        if !event.verify_id() || !event.verify_signature() {
            tracing::debug!("exchange head ignored — signature did not verify");
            return false;
        }
        if !event.pubkey.to_hex().eq_ignore_ascii_case(owner.as_str()) {
            tracing::debug!(
                author = %event.pubkey.to_hex(),
                "exchange head ignored — not authored by this resident's owner"
            );
            return false;
        }
        let record = match ExchangeRecordV1::from_content(&event.content) {
            Ok(record) => record,
            Err(error) => {
                tracing::debug!("exchange head ignored — invalid record: {error}");
                return false;
            }
        };
        self.store_head(record, event.created_at.as_secs(), event.id.to_hex()) == HeadUpdate::Stored
    }

    /// Store a validated head under last-write-wins, mirroring the relay's
    /// NIP-33 tie rule (later `created_at` wins; a same-second tie goes to the
    /// lower event id).
    ///
    /// A head the cache already holds — the same event, or one the held head
    /// supersedes — is not stored again but does renew freshness: the relay has
    /// just re-confirmed what this resident believes.
    ///
    /// A valid owner-authored head that simply does not list this resident is
    /// [`HeadUpdate::NotAMember`], not [`HeadUpdate::Rejected`]: nothing about
    /// it failed to verify, so the resident is told it was not invited rather
    /// than that the record could not be read.
    fn store_head(
        &self,
        record: ExchangeRecordV1,
        created_at: u64,
        event_id: String,
    ) -> HeadUpdate {
        let Some(owner) = self.owner.as_ref() else {
            return HeadUpdate::Rejected;
        };
        if &record.owner != owner {
            tracing::debug!("exchange head ignored — record names a different owner");
            return HeadUpdate::Rejected;
        }
        if !record.is_member(&self.self_pubkey) {
            tracing::debug!(
                exchange_id = record.exchange_id.as_str(),
                "exchange head ignored — this resident is not a member"
            );
            return HeadUpdate::NotAMember;
        }
        let Ok(mut heads) = self.heads.lock() else {
            tracing::warn!("exchange head cache is poisoned — head not stored");
            return HeadUpdate::Rejected;
        };
        let key = record.exchange_id.as_str().to_owned();
        if let Some(existing) = heads.get_mut(&key) {
            let newer = created_at > existing.created_at
                || (created_at == existing.created_at && event_id < existing.event_id);
            if !newer {
                existing.seen_at = Instant::now();
                drop(heads);
                self.forget_refusal(&key);
                return HeadUpdate::Confirmed;
            }
        }
        if heads.len() >= MAX_CACHED_HEADS && !heads.contains_key(&key) {
            heads.clear();
        }
        tracing::debug!(
            exchange_id = %key,
            bucket = record.bucket,
            state = ?record.state,
            "exchange head stored"
        );
        heads.insert(
            key.clone(),
            CachedHead {
                record,
                created_at,
                event_id,
                seen_at: Instant::now(),
            },
        );
        drop(heads);
        self.forget_refusal(&key);
        HeadUpdate::Stored
    }

    /// Look up a head that may be trusted without a refresh.
    ///
    /// While the live REQ leg is carrying, the relay pushes every replacement,
    /// so a stored head *is* the current one and age is irrelevant. When that
    /// leg is down — abandoned, rate-parked, or the socket is gone — a head is
    /// only trusted for [`HEAD_MAX_AGE`], so a "Stop here" still lands.
    fn fresh_head(&self, exchange_id: &str) -> Option<ExchangeRecordV1> {
        let heads = self.heads.lock().ok()?;
        let head = heads.get(exchange_id)?;
        let trusted = self.live_leg.is_healthy() || head.seen_at.elapsed() <= HEAD_MAX_AGE;
        trusted.then(|| head.record.clone())
    }

    /// Look up a head regardless of age. Test-only: the grant path reads
    /// [`Self::fresh_head`], never this.
    #[cfg(test)]
    fn any_head(&self, exchange_id: &str) -> Option<ExchangeRecordV1> {
        let heads = self.heads.lock().ok()?;
        heads.get(exchange_id).map(|head| head.record.clone())
    }

    /// A refusal this cache already paid for and that has not yet expired.
    fn cached_refusal(&self, exchange_id: &str) -> Option<ExchangeRefusal> {
        let mut refusals = self.refusals.lock().ok()?;
        let (refusal, at) = refusals.get(exchange_id).copied()?;
        if at.elapsed() > NEGATIVE_TTL {
            refusals.remove(exchange_id);
            return None;
        }
        Some(refusal)
    }

    /// Remember a refusal that cost a relay round-trip.
    fn note_refusal(&self, exchange_id: &str, refusal: ExchangeRefusal) {
        if !refusal.is_worth_remembering() {
            return;
        }
        let Ok(mut refusals) = self.refusals.lock() else {
            return;
        };
        if refusals.len() >= MAX_CACHED_REFUSALS && !refusals.contains_key(exchange_id) {
            refusals.clear();
        }
        refusals.insert(exchange_id.to_owned(), (refusal, Instant::now()));
    }

    /// Forget a remembered refusal — a head just arrived, so whatever the cache
    /// could not learn before, it knows now.
    fn forget_refusal(&self, exchange_id: &str) {
        if let Ok(mut refusals) = self.refusals.lock() {
            refusals.remove(exchange_id);
        }
    }

    /// Charge one bounded head fetch to `author`, or refuse it.
    ///
    /// The per-exchange negative cache stops a sibling repeating one
    /// unanswerable id; this stops it inventing a new one every message. At
    /// most [`GATE_FETCH_BUDGET`] fetches per author per [`GATE_FETCH_WINDOW`],
    /// sliding. Fails closed: a poisoned lock or a full table spends nothing
    /// and refuses.
    fn charge_fetch(&self, author: &str) -> Result<(), ExchangeRefusal> {
        let Ok(mut budgets) = self.fetch_budget.lock() else {
            tracing::warn!("exchange fetch budget is poisoned — refusing the fetch");
            return Err(ExchangeRefusal::FetchBudgetExhausted);
        };
        // Authors whose whole window has passed are forgotten, so the table
        // only ever holds who is spending right now.
        budgets.retain(|_, spent| {
            spent.retain(|at| at.elapsed() < GATE_FETCH_WINDOW);
            !spent.is_empty()
        });
        if budgets.len() >= MAX_TRACKED_FETCH_AUTHORS && !budgets.contains_key(author) {
            tracing::warn!(
                author = author_prefix(author),
                "exchange fetch budget table is full — refusing the fetch"
            );
            return Err(ExchangeRefusal::FetchBudgetExhausted);
        }
        let spent = budgets.entry(author.to_owned()).or_default();
        if spent.len() >= GATE_FETCH_BUDGET {
            return Err(ExchangeRefusal::FetchBudgetExhausted);
        }
        spent.push(Instant::now());
        Ok(())
    }

    /// Decide whether a sibling-authored event earns a turn.
    ///
    /// `now_unix` is the current wall clock in seconds — `None` means the clock
    /// could not be read, and the turn is refused rather than judged against a
    /// zero. `rest` is the HTTP bridge used for the bounded fallback fetch
    /// (pass `None` to forbid network access, in which case an unknown or stale
    /// head refuses).
    ///
    /// A fetch is charged to the event's author against
    /// [`GATE_FETCH_BUDGET`]: past that, the turn is refused with
    /// [`ExchangeRefusal::FetchBudgetExhausted`] before the relay is touched,
    /// so a sibling inventing exchange ids cannot own the main loop.
    pub async fn admit(
        &self,
        event: &nostr::Event,
        now_unix: Option<u64>,
        rest: Option<&RestClient>,
    ) -> Result<AdmittedExchange, ExchangeRefusal> {
        let Some(owner) = self.owner.clone() else {
            return Err(ExchangeRefusal::NoOwner);
        };
        let Some(now_unix) = now_unix else {
            return Err(ExchangeRefusal::ClockUnavailable);
        };
        let tags: Vec<Vec<String>> = event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect();
        let turn_tag = match ExchangeTurnTag::find(&tags) {
            Ok(Some(tag)) => tag,
            Ok(None) => return Err(ExchangeRefusal::MissingTag),
            Err(_) => return Err(ExchangeRefusal::MalformedTag),
        };
        let exchange_id = turn_tag.exchange_id.as_str().to_owned();

        // A refusal this cache already paid a round-trip for is answered from
        // memory: a sibling must not be able to make the main loop spend two
        // seconds per message on an exchange the relay will not answer for.
        if let Some(remembered) = self.cached_refusal(&exchange_id) {
            return Err(remembered);
        }

        let record = match self.fresh_head(&exchange_id) {
            Some(record) => record,
            // Only the head that this refresh actually produced *for this id*
            // may grant the turn. A stale or unrelated head never does.
            None => {
                // The fetch is the expensive half of this gate. A head arriving
                // on the live leg costs nothing and is never charged; asking the
                // relay about an id this resident has never heard of is, and one
                // author may only do so a few times a minute.
                if rest.is_some() {
                    let author = event.pubkey.to_hex();
                    if let Err(refusal) = self.charge_fetch(&author) {
                        tracing::debug!(
                            "too many unverifiable exchanges from {} — dropped",
                            author_prefix(&author)
                        );
                        return Err(refusal);
                    }
                }
                match self.refresh_head(&exchange_id, &owner, rest).await {
                    Ok(record) => record,
                    Err(refusal) => {
                        self.note_refusal(&exchange_id, refusal);
                        return Err(refusal);
                    }
                }
            }
        };

        if !record.is_member(&self.self_pubkey) {
            self.note_refusal(&exchange_id, ExchangeRefusal::NotAMember);
            return Err(ExchangeRefusal::NotAMember);
        }
        if record.state == ExchangeStateV1::Closed {
            return Err(ExchangeRefusal::Closed);
        }
        if now_unix > record.deadline.get() {
            return Err(ExchangeRefusal::Expired);
        }
        if !record.admits_turn(turn_tag.turn, now_unix) {
            return Err(ExchangeRefusal::Exhausted);
        }
        Ok(AdmittedExchange {
            event_id: event.id,
            exchange_id: turn_tag.exchange_id,
            turn: turn_tag.turn,
            bucket: record.bucket,
            opened_by: record.opened_by.clone(),
            depth: record.depth,
        })
    }

    /// One bounded fetch of the current head by `#d`, authored by the owner.
    ///
    /// Returns the head that was stored (or re-confirmed) **for this exact
    /// exchange id**. Any timeout, transport error, empty answer, unverifiable
    /// body, or a body naming a different exchange refuses the turn — as does a
    /// perfectly valid head that does not list this resident, which refuses
    /// with [`ExchangeRefusal::NotAMember`].
    async fn refresh_head(
        &self,
        exchange_id: &str,
        owner: &Hex64,
        rest: Option<&RestClient>,
    ) -> Result<ExchangeRecordV1, ExchangeRefusal> {
        let Some(rest) = rest else {
            return Err(ExchangeRefusal::Unknown);
        };
        let owner_pubkey = nostr::PublicKey::from_hex(owner.as_str())
            .map_err(|_| ExchangeRefusal::HeadUnverifiable)?;
        let filter = nostr::Filter::new()
            .kind(nostr::Kind::Custom(KIND_LUCA_EXCHANGE as u16))
            .identifier(exchange_id)
            .author(owner_pubkey)
            .limit(1);
        let response = match tokio::time::timeout(HEAD_REST_TIMEOUT, rest.query(&[filter])).await {
            Ok(Ok(value)) => value,
            Ok(Err(error)) => {
                tracing::debug!(exchange_id, "exchange head fetch failed: {error}");
                return Err(ExchangeRefusal::HeadUnverifiable);
            }
            Err(_) => {
                tracing::debug!(exchange_id, "exchange head fetch timed out");
                return Err(ExchangeRefusal::HeadUnverifiable);
            }
        };
        let events = response.as_array().ok_or(ExchangeRefusal::Unknown)?;
        let head = events.first().ok_or(ExchangeRefusal::Unknown)?;
        match self.ingest_head_json(head, owner, exchange_id) {
            HeadUpdate::Stored | HeadUpdate::Confirmed => {
                // Read back the head this refresh just settled for this id —
                // never "whatever the cache happens to hold".
                self.fresh_head(exchange_id).ok_or(ExchangeRefusal::Unknown)
            }
            HeadUpdate::WrongExchange => Err(ExchangeRefusal::Unknown),
            // The owner's word arrived and it does not name this resident. Say
            // that, rather than blaming the record.
            HeadUpdate::NotAMember => Err(ExchangeRefusal::NotAMember),
            HeadUpdate::Rejected => Err(ExchangeRefusal::HeadUnverifiable),
        }
    }

    /// Ingest a head delivered as raw REST JSON, for the exchange named by
    /// `expected_id`.
    ///
    /// A body that carries a `sig` must verify like the live path — a present
    /// but wrong signature is a forgery, not a stripped body, and is refused.
    /// The HTTP bridge may return signature-stripped bodies; such a head is
    /// accepted only as *relay-attested* — author must still equal the
    /// configured owner, the record must still validate, and `created_at` and
    /// `id` must still be well formed — and the compromise is logged once.
    fn ingest_head_json(&self, value: &Value, owner: &Hex64, expected_id: &str) -> HeadUpdate {
        let claims_signature = value
            .get("sig")
            .and_then(Value::as_str)
            .is_some_and(|sig| !sig.is_empty());
        if claims_signature {
            let Ok(event) = serde_json::from_value::<nostr::Event>(value.clone()) else {
                tracing::debug!("exchange head ignored — signed body did not parse");
                return HeadUpdate::Rejected;
            };
            if !event.verify_id() || !event.verify_signature() {
                tracing::debug!("exchange head ignored — signature did not verify");
                return HeadUpdate::Rejected;
            }
            if event.kind.as_u16() as u32 != KIND_LUCA_EXCHANGE
                || !event.pubkey.to_hex().eq_ignore_ascii_case(owner.as_str())
            {
                tracing::debug!("exchange head ignored — wrong kind or author");
                return HeadUpdate::Rejected;
            }
            return match ExchangeRecordV1::from_content(&event.content) {
                Ok(record) => {
                    if record.exchange_id.as_str() != expected_id {
                        tracing::debug!(
                            expected_id,
                            got = record.exchange_id.as_str(),
                            "exchange head ignored — answer named a different exchange"
                        );
                        return HeadUpdate::WrongExchange;
                    }
                    self.store_head(record, event.created_at.as_secs(), event.id.to_hex())
                }
                Err(error) => {
                    tracing::debug!("exchange head ignored — invalid record: {error}");
                    HeadUpdate::Rejected
                }
            };
        }
        let kind = value
            .get("kind")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        if kind != u64::from(KIND_LUCA_EXCHANGE) {
            tracing::debug!(kind, "exchange head ignored — wrong kind");
            return HeadUpdate::Rejected;
        }
        let Some(author) = value.get("pubkey").and_then(Value::as_str) else {
            tracing::debug!("exchange head ignored — no author");
            return HeadUpdate::Rejected;
        };
        if !author.eq_ignore_ascii_case(owner.as_str()) {
            tracing::debug!(
                author,
                "exchange head ignored — not authored by this resident's owner"
            );
            return HeadUpdate::Rejected;
        }
        let Some(content) = value.get("content").and_then(Value::as_str) else {
            tracing::debug!("exchange head ignored — no content");
            return HeadUpdate::Rejected;
        };
        let record = match ExchangeRecordV1::from_content(content) {
            Ok(record) => record,
            Err(error) => {
                tracing::debug!("exchange head ignored — invalid record: {error}");
                return HeadUpdate::Rejected;
            }
        };
        if record.exchange_id.as_str() != expected_id {
            tracing::debug!(
                expected_id,
                got = record.exchange_id.as_str(),
                "exchange head ignored — answer named a different exchange"
            );
            return HeadUpdate::WrongExchange;
        }
        // Last-write-wins needs a real ordering key. A body without a readable
        // `created_at` or a 64-hex `id` cannot be ordered against what is held,
        // so it is refused rather than stored under defaults — a defaulted
        // refresh would silently renew a stale open head's lease.
        let Some(created_at) = value.get("created_at").and_then(Value::as_u64) else {
            tracing::debug!("exchange head ignored — no readable created_at");
            return HeadUpdate::Rejected;
        };
        let Some(event_id) = value
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| Hex64::parse(*id).is_ok())
            .map(str::to_owned)
        else {
            tracing::debug!("exchange head ignored — no 64-hex event id");
            return HeadUpdate::Rejected;
        };
        let update = self.store_head(record, created_at, event_id);
        if matches!(update, HeadUpdate::Stored | HeadUpdate::Confirmed)
            && !self.attested_head_logged.swap(true, Ordering::Relaxed)
        {
            tracing::debug!(
                "exchange heads from the HTTP bridge carry no signature — accepting them as \
                 relay-attested after checking the author is this resident's owner"
            );
        }
        update
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::OpaqueId;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    const NOW: u64 = 1_800_000_000;

    fn owner_keys() -> Keys {
        Keys::parse("1111111111111111111111111111111111111111111111111111111111111111")
            .expect("owner keys")
    }

    fn resident_keys() -> Keys {
        Keys::parse("2222222222222222222222222222222222222222222222222222222222222222")
            .expect("resident keys")
    }

    fn sibling_keys() -> Keys {
        Keys::parse("3333333333333333333333333333333333333333333333333333333333333333")
            .expect("sibling keys")
    }

    fn stranger_keys() -> Keys {
        Keys::parse("4444444444444444444444444444444444444444444444444444444444444444")
            .expect("stranger keys")
    }

    fn hex_of(keys: &Keys) -> Hex64 {
        Hex64::parse(keys.public_key().to_hex()).expect("hex64")
    }

    fn record(members: Vec<Hex64>, bucket: Option<u8>) -> ExchangeRecordV1 {
        let opened_by = members.iter().min().cloned().expect("member");
        ExchangeRecordV1::open(
            hex_of(&owner_keys()),
            members,
            OpaqueId::parse("11111111-1111-4111-8111-111111111111").expect("conversation"),
            Hex64::parse("ab".repeat(32)).expect("root"),
            opened_by,
            bucket,
            NOW,
        )
        .expect("record")
    }

    fn pair_record(bucket: Option<u8>) -> ExchangeRecordV1 {
        record(
            vec![hex_of(&resident_keys()), hex_of(&sibling_keys())],
            bucket,
        )
    }

    fn head_event(record: &ExchangeRecordV1, keys: &Keys, created_at: u64) -> nostr::Event {
        let tags: Vec<Tag> = record
            .event_tags()
            .into_iter()
            .map(|tag| Tag::parse(tag).expect("tag"))
            .collect();
        EventBuilder::new(
            Kind::Custom(KIND_LUCA_EXCHANGE as u16),
            record.to_content().expect("content"),
        )
        .tags(tags)
        .custom_created_at(nostr::Timestamp::from(created_at))
        .sign_with_keys(keys)
        .expect("head event")
    }

    fn turn_event(keys: &Keys, tags: Vec<Tag>) -> nostr::Event {
        EventBuilder::new(Kind::Custom(9), "a sentence")
            .tags(tags)
            .sign_with_keys(keys)
            .expect("turn event")
    }

    fn turn_tag(exchange_id: &Hex64, turn: u8) -> Tag {
        Tag::parse(vec![
            "exchange".to_owned(),
            exchange_id.as_str().to_owned(),
            turn.to_string(),
        ])
        .expect("turn tag")
    }

    fn resident_cache() -> ExchangeCache {
        ExchangeCache::new(hex_of(&resident_keys()), Some(hex_of(&owner_keys())))
    }

    /// A head body as the HTTP bridge returns it: the owner's event with the
    /// signature stripped off.
    fn attested_body(record: &ExchangeRecordV1, created_at: u64) -> Value {
        serde_json::json!({
            "id": "cd".repeat(32),
            "pubkey": hex_of(&owner_keys()).as_str(),
            "created_at": created_at,
            "kind": KIND_LUCA_EXCHANGE,
            "tags": record.event_tags(),
            "content": record.to_content().expect("content"),
        })
    }

    /// Push a stored head's `seen_at` back so ageing can be exercised without
    /// sleeping for a minute.
    fn age_head(cache: &ExchangeCache, exchange_id: &str, by: Duration) {
        let mut heads = cache.heads.lock().expect("head cache");
        let head = heads.get_mut(exchange_id).expect("stored head");
        head.seen_at = head.seen_at.checked_sub(by).expect("aged instant");
    }

    /// The same, for a remembered refusal.
    fn age_refusal(cache: &ExchangeCache, exchange_id: &str, by: Duration) {
        let mut refusals = cache.refusals.lock().expect("refusal cache");
        let entry = refusals.get_mut(exchange_id).expect("remembered refusal");
        entry.1 = entry.1.checked_sub(by).expect("aged instant");
    }

    /// The same, for one author's spent fetches, so the sliding window can be
    /// exercised without waiting out a minute.
    fn age_fetch_budget(cache: &ExchangeCache, author: &Hex64, by: Duration) {
        let mut budgets = cache.fetch_budget.lock().expect("fetch budget");
        let spent = budgets.get_mut(author.as_str()).expect("spent fetches");
        for at in spent.iter_mut() {
            *at = at.checked_sub(by).expect("aged instant");
        }
    }

    /// A well-formed exchange id that no head will ever be found for. Distinct
    /// per `seed`, so each one is a fresh miss in the negative cache.
    fn fabricated_id(seed: u8) -> Hex64 {
        Hex64::parse(format!("{seed:02x}").repeat(32)).expect("hex64")
    }

    /// A one-shot local stand-in for the relay's HTTP bridge.
    ///
    /// `RestClient` talks plain HTTP/1.1 to `base_url`, so a raw TCP listener
    /// is enough to exercise the fallback fetch end to end — including the
    /// paths that have no answer at all.
    struct FakeRelay {
        base_url: String,
        /// One per accepted connection. Every response closes the connection,
        /// so the client never pools one and this counts requests exactly.
        requests: Arc<std::sync::atomic::AtomicUsize>,
        _task: tokio::task::JoinHandle<()>,
    }

    impl FakeRelay {
        async fn spawn(behaviour: FakeRelayBehaviour) -> Self {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .expect("bind fake relay");
            let address = listener.local_addr().expect("fake relay address");
            let requests = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let counter = requests.clone();
            let task = tokio::spawn(async move {
                loop {
                    let Ok((mut stream, _)) = listener.accept().await else {
                        return;
                    };
                    counter.fetch_add(1, Ordering::Relaxed);
                    let behaviour = behaviour.clone();
                    tokio::spawn(async move {
                        use tokio::io::{AsyncReadExt, AsyncWriteExt};
                        // Drain whatever the client sends; the reply does not
                        // depend on it.
                        let mut scratch = [0_u8; 4096];
                        let _ = stream.read(&mut scratch).await;
                        let response = match behaviour {
                            // Never answer: the caller's 2 s budget must fire.
                            FakeRelayBehaviour::Hang => {
                                tokio::time::sleep(Duration::from_secs(30)).await;
                                return;
                            }
                            FakeRelayBehaviour::Fail => {
                                "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\
                                 Content-Length: 0\r\n\r\n"
                                    .to_owned()
                            }
                            FakeRelayBehaviour::Respond(body) => format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                                 Connection: close\r\nContent-Length: {}\r\n\r\n{body}",
                                body.len()
                            ),
                        };
                        let _ = stream.write_all(response.as_bytes()).await;
                        let _ = stream.flush().await;
                    });
                }
            });
            Self {
                base_url: format!("http://{address}"),
                requests,
                _task: task,
            }
        }

        /// How many HTTP requests this relay has been asked for so far.
        fn request_count(&self) -> usize {
            self.requests.load(Ordering::Relaxed)
        }

        async fn responding(body: &str) -> Self {
            Self::spawn(FakeRelayBehaviour::Respond(body.to_owned())).await
        }

        async fn failing() -> Self {
            Self::spawn(FakeRelayBehaviour::Fail).await
        }

        async fn hanging() -> Self {
            Self::spawn(FakeRelayBehaviour::Hang).await
        }

        fn rest_client(&self) -> RestClient {
            RestClient {
                http: reqwest::Client::new(),
                base_url: self.base_url.clone(),
                identity: crate::relay::RelayIdentity::Legacy {
                    keys: Box::new(nostr::Keys::generate()),
                    auth_tag: None,
                },
                auth_tag_json: None,
            }
        }
    }

    #[derive(Clone)]
    enum FakeRelayBehaviour {
        Respond(String),
        Fail,
        Hang,
    }

    #[tokio::test]
    async fn valid_sibling_turn_is_admitted_and_bound_to_its_event() {
        let cache = resident_cache();
        let record = pair_record(None);
        assert!(cache.ingest_head(&head_event(&record, &owner_keys(), NOW)));
        let event = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 2)]);
        let admitted = cache
            .admit(&event, Some(NOW + 5), None)
            .await
            .expect("admitted turn");
        assert_eq!(admitted.event_id, event.id);
        assert_eq!(admitted.exchange_id, record.exchange_id);
        assert_eq!(admitted.turn, 2);
        assert_eq!(admitted.bucket, 3);
    }

    #[tokio::test]
    async fn a_sibling_without_a_tag_is_refused() {
        let cache = resident_cache();
        let event = turn_event(&sibling_keys(), vec![]);
        assert_eq!(
            cache.admit(&event, Some(NOW), None).await.unwrap_err(),
            ExchangeRefusal::MissingTag
        );
    }

    #[tokio::test]
    async fn malformed_and_duplicated_tags_are_refused() {
        let cache = resident_cache();
        let record = pair_record(None);
        assert!(cache.ingest_head(&head_event(&record, &owner_keys(), NOW)));
        let malformed = turn_event(
            &sibling_keys(),
            vec![Tag::parse(vec![
                "exchange".to_owned(),
                "not-hex".to_owned(),
                "1".to_owned(),
            ])
            .expect("tag")],
        );
        assert_eq!(
            cache.admit(&malformed, Some(NOW), None).await.unwrap_err(),
            ExchangeRefusal::MalformedTag
        );
        let doubled = turn_event(
            &sibling_keys(),
            vec![
                turn_tag(&record.exchange_id, 1),
                turn_tag(&record.exchange_id, 2),
            ],
        );
        assert_eq!(
            cache.admit(&doubled, Some(NOW), None).await.unwrap_err(),
            ExchangeRefusal::MalformedTag
        );
    }

    #[tokio::test]
    async fn an_unknown_exchange_is_refused_when_no_rest_is_available() {
        let cache = resident_cache();
        let record = pair_record(None);
        let event = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 1)]);
        assert_eq!(
            cache.admit(&event, Some(NOW), None).await.unwrap_err(),
            ExchangeRefusal::Unknown
        );
    }

    #[tokio::test]
    async fn closed_expired_and_exhausted_each_refuse_with_their_own_sentence() {
        let record = pair_record(None);

        let stopped = resident_cache();
        assert!(stopped.ingest_head(&head_event(&record.stopped(), &owner_keys(), NOW)));
        let event = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 1)]);
        assert_eq!(
            stopped.admit(&event, Some(NOW), None).await.unwrap_err(),
            ExchangeRefusal::Closed
        );

        let live = resident_cache();
        assert!(live.ingest_head(&head_event(&record, &owner_keys(), NOW)));
        assert_eq!(
            live.admit(&event, Some(record.deadline.get() + 1), None)
                .await
                .unwrap_err(),
            ExchangeRefusal::Expired
        );

        let over = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 4)]);
        assert_eq!(
            live.admit(&over, Some(NOW), None).await.unwrap_err(),
            ExchangeRefusal::Exhausted
        );
    }

    #[tokio::test]
    async fn a_head_from_a_foreign_author_is_never_stored() {
        let cache = resident_cache();
        let record = pair_record(None);
        assert!(!cache.ingest_head(&head_event(&record, &stranger_keys(), NOW)));
        let event = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 1)]);
        assert_eq!(
            cache.admit(&event, Some(NOW), None).await.unwrap_err(),
            ExchangeRefusal::Unknown
        );
    }

    #[tokio::test]
    async fn a_head_whose_members_exclude_this_resident_is_never_stored() {
        let cache = resident_cache();
        let elsewhere = record(
            vec![hex_of(&sibling_keys()), hex_of(&stranger_keys())],
            None,
        );
        assert!(!cache.ingest_head(&head_event(&elsewhere, &owner_keys(), NOW)));
        let event = turn_event(&sibling_keys(), vec![turn_tag(&elsewhere.exchange_id, 1)]);
        assert_eq!(
            cache.admit(&event, Some(NOW), None).await.unwrap_err(),
            ExchangeRefusal::Unknown
        );
    }

    #[tokio::test]
    async fn without_an_owner_no_exchange_is_trusted() {
        let cache = ExchangeCache::new(hex_of(&resident_keys()), None);
        let record = pair_record(None);
        assert!(!cache.ingest_head(&head_event(&record, &owner_keys(), NOW)));
        let event = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 1)]);
        assert_eq!(
            cache.admit(&event, Some(NOW), None).await.unwrap_err(),
            ExchangeRefusal::NoOwner
        );
    }

    #[test]
    fn a_later_head_replaces_an_earlier_one_and_an_earlier_head_never_wins() {
        let cache = resident_cache();
        let record = pair_record(None);
        assert!(cache.ingest_head(&head_event(&record, &owner_keys(), NOW)));
        let widened = record.continued(NOW + 10).expect("go").expect("not capped");
        assert!(cache.ingest_head(&head_event(&widened, &owner_keys(), NOW + 10)));
        assert_eq!(
            cache
                .any_head(record.exchange_id.as_str())
                .expect("head")
                .bucket,
            6
        );
        // The original head, re-delivered late, must not undo the Go.
        assert!(!cache.ingest_head(&head_event(&record, &owner_keys(), NOW)));
        assert_eq!(
            cache
                .any_head(record.exchange_id.as_str())
                .expect("head")
                .bucket,
            6
        );
    }

    #[test]
    fn a_same_second_tie_is_broken_by_the_lower_event_id() {
        let cache = resident_cache();
        let record = pair_record(None);
        let stopped = record.stopped();
        let open_head = head_event(&record, &owner_keys(), NOW);
        let closed_head = head_event(&stopped, &owner_keys(), NOW);
        assert_eq!(open_head.created_at, closed_head.created_at);
        // Same second: the lower event id is the winner, whichever record it
        // carries. Ingest the higher id first, then the lower.
        let (higher, lower) = if closed_head.id.to_hex() < open_head.id.to_hex() {
            (open_head, closed_head)
        } else {
            (closed_head, open_head)
        };
        let lower_is_closed = lower.content == stopped.to_content().expect("content");
        assert!(cache.ingest_head(&higher));
        assert!(cache.ingest_head(&lower), "lower event id must win the tie");
        let stored = cache.any_head(record.exchange_id.as_str()).expect("head");
        assert_eq!(stored.state == ExchangeStateV1::Closed, lower_is_closed);
        // The loser, re-delivered, never displaces the winner.
        assert!(!cache.ingest_head(&higher));
        let stored = cache.any_head(record.exchange_id.as_str()).expect("head");
        assert_eq!(stored.state == ExchangeStateV1::Closed, lower_is_closed);
    }

    #[test]
    fn a_relay_attested_head_is_accepted_only_from_the_owner() {
        let cache = resident_cache();
        let record = pair_record(None);
        let owner = hex_of(&owner_keys());
        let id = record.exchange_id.as_str().to_owned();
        let body = attested_body(&record, NOW);
        assert_eq!(
            cache.ingest_head_json(&body, &owner, &id),
            HeadUpdate::Stored
        );
        assert!(cache.any_head(&id).is_some());
        // Re-fetching the head the cache already holds renews its freshness
        // rather than reading as an unverifiable answer.
        assert_eq!(
            cache.ingest_head_json(&body, &owner, &id),
            HeadUpdate::Confirmed
        );

        let impostor = resident_cache();
        let mut foreign = body.clone();
        foreign["pubkey"] = serde_json::json!(hex_of(&stranger_keys()).as_str());
        assert_eq!(
            impostor.ingest_head_json(&foreign, &owner, &id),
            HeadUpdate::Rejected
        );
        assert!(impostor.any_head(&id).is_none());
    }

    #[test]
    fn a_head_the_live_leg_already_delivered_is_confirmed_not_refused() {
        let cache = resident_cache();
        let record = pair_record(None);
        let head = head_event(&record, &owner_keys(), NOW);
        assert!(cache.ingest_head(&head));
        let owner = hex_of(&owner_keys());
        let body = serde_json::to_value(&head).expect("event json");
        assert_eq!(
            cache.ingest_head_json(&body, &owner, record.exchange_id.as_str()),
            HeadUpdate::Confirmed
        );
    }

    #[test]
    fn a_body_that_carries_a_broken_signature_is_refused_not_treated_as_attested() {
        let cache = resident_cache();
        let record = pair_record(None);
        let owner = hex_of(&owner_keys());
        let head = head_event(&record, &owner_keys(), NOW);
        let mut forged = serde_json::to_value(&head).expect("event json");
        // A signature that is present but wrong is a forgery, not a stripped
        // body: it must never fall through to the relay-attested branch.
        forged["sig"] = serde_json::json!("ff".repeat(64));
        assert_eq!(
            cache.ingest_head_json(&forged, &owner, record.exchange_id.as_str()),
            HeadUpdate::Rejected
        );
        assert!(cache.any_head(record.exchange_id.as_str()).is_none());

        // The same body with the content swapped under a valid-looking sig —
        // the id no longer commits to the content, so verify_id fails.
        let stopped = record.stopped();
        let mut tampered = serde_json::to_value(&head).expect("event json");
        tampered["content"] = serde_json::json!(stopped.to_content().expect("content"));
        assert_eq!(
            cache.ingest_head_json(&tampered, &owner, record.exchange_id.as_str()),
            HeadUpdate::Rejected
        );
        assert!(cache.any_head(record.exchange_id.as_str()).is_none());
    }

    #[test]
    fn an_attested_body_without_ordering_fields_is_refused_and_never_renews_a_head() {
        let cache = resident_cache();
        let record = pair_record(None);
        let owner = hex_of(&owner_keys());
        let id = record.exchange_id.as_str().to_owned();

        for (label, mutate) in [
            (
                "missing created_at",
                Box::new(|body: &mut Value| {
                    body.as_object_mut().expect("object").remove("created_at");
                }) as Box<dyn Fn(&mut Value)>,
            ),
            (
                "non-integer created_at",
                Box::new(|body: &mut Value| body["created_at"] = serde_json::json!("soon")),
            ),
            (
                "missing id",
                Box::new(|body: &mut Value| {
                    body.as_object_mut().expect("object").remove("id");
                }),
            ),
            (
                "short id",
                Box::new(|body: &mut Value| body["id"] = serde_json::json!("cafe")),
            ),
        ] {
            let mut body = attested_body(&record, NOW);
            mutate(&mut body);
            assert_eq!(
                cache.ingest_head_json(&body, &owner, &id),
                HeadUpdate::Rejected,
                "{label} must be refused"
            );
            assert!(cache.any_head(&id).is_none(), "{label} must not store");
        }

        // And a malformed refresh must not renew a head the cache already
        // holds: the held head keeps whatever lease it had.
        assert_eq!(
            cache.ingest_head_json(&attested_body(&record, NOW), &owner, &id),
            HeadUpdate::Stored
        );
        let mut broken = attested_body(&record, NOW);
        broken["created_at"] = serde_json::json!("soon");
        assert_eq!(
            cache.ingest_head_json(&broken, &owner, &id),
            HeadUpdate::Rejected
        );
    }

    #[test]
    fn a_head_naming_a_different_exchange_teaches_the_cache_nothing() {
        let cache = resident_cache();
        let asked_about = pair_record(None);
        let answered_with = record(
            vec![hex_of(&resident_keys()), hex_of(&stranger_keys())],
            None,
        );
        assert_ne!(asked_about.exchange_id, answered_with.exchange_id);
        let owner = hex_of(&owner_keys());
        assert_eq!(
            cache.ingest_head_json(
                &attested_body(&answered_with, NOW),
                &owner,
                asked_about.exchange_id.as_str(),
            ),
            HeadUpdate::WrongExchange
        );
        assert!(cache.any_head(asked_about.exchange_id.as_str()).is_none());
        assert!(cache.any_head(answered_with.exchange_id.as_str()).is_none());
    }

    #[tokio::test]
    async fn an_unreadable_clock_refuses_rather_than_judging_against_zero() {
        let cache = resident_cache();
        let record = pair_record(None);
        assert!(cache.ingest_head(&head_event(&record, &owner_keys(), NOW)));
        let event = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 1)]);
        assert_eq!(
            cache.admit(&event, None, None).await.unwrap_err(),
            ExchangeRefusal::ClockUnavailable
        );
    }

    #[tokio::test]
    async fn an_admitted_turn_carries_the_records_opener_and_depth() {
        let cache = resident_cache();
        let record = pair_record(None);
        assert!(cache.ingest_head(&head_event(&record, &owner_keys(), NOW)));
        let event = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 1)]);
        let admitted = cache
            .admit(&event, Some(NOW), None)
            .await
            .expect("admitted turn");
        assert_eq!(admitted.opened_by, record.opened_by);
        assert_eq!(admitted.depth, record.depth);
    }

    #[tokio::test]
    async fn a_stored_head_does_not_age_out_while_the_live_leg_is_carrying() {
        let record = pair_record(None);
        let event = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 1)]);

        // Live leg down: a head older than HEAD_MAX_AGE is not trusted, and
        // with no REST bridge there is nothing to refresh it with.
        let aged = resident_cache();
        assert!(aged.ingest_head(&head_event(&record, &owner_keys(), NOW)));
        age_head(&aged, record.exchange_id.as_str(), HEAD_MAX_AGE * 2);
        assert_eq!(
            aged.admit(&event, Some(NOW), None).await.unwrap_err(),
            ExchangeRefusal::Unknown
        );

        // Live leg up: the relay pushes every replacement, so the same head is
        // still the current one and the turn is admitted without a fetch.
        let leg = ExchangeLiveLeg::new();
        let carried = resident_cache().with_live_leg(leg.clone());
        assert!(carried.ingest_head(&head_event(&record, &owner_keys(), NOW)));
        age_head(&carried, record.exchange_id.as_str(), HEAD_MAX_AGE * 2);
        leg.mark_healthy();
        assert!(carried.admit(&event, Some(NOW), None).await.is_ok());

        // And the moment the leg goes down again, the same head ages out.
        leg.mark_down();
        assert_eq!(
            carried.admit(&event, Some(NOW), None).await.unwrap_err(),
            ExchangeRefusal::Unknown
        );
    }

    #[tokio::test]
    async fn a_refusal_that_cost_a_fetch_is_remembered_and_a_head_forgets_it() {
        let cache = resident_cache();
        let record = pair_record(None);
        let event = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 1)]);

        assert_eq!(
            cache.admit(&event, Some(NOW), None).await.unwrap_err(),
            ExchangeRefusal::Unknown
        );
        assert_eq!(
            cache.cached_refusal(record.exchange_id.as_str()),
            Some(ExchangeRefusal::Unknown),
            "an unknown exchange must be remembered so the next message is free"
        );

        // A head arriving on the live leg clears the memory immediately — a Go
        // must not wait out the negative TTL.
        assert!(cache.ingest_head(&head_event(&record, &owner_keys(), NOW)));
        assert_eq!(cache.cached_refusal(record.exchange_id.as_str()), None);
        assert!(cache.admit(&event, Some(NOW), None).await.is_ok());
    }

    #[tokio::test]
    async fn state_refusals_are_never_remembered_so_a_go_lands_at_once() {
        let cache = resident_cache();
        let record = pair_record(None);
        assert!(cache.ingest_head(&head_event(&record, &owner_keys(), NOW)));
        let over = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 4)]);
        assert_eq!(
            cache.admit(&over, Some(NOW), None).await.unwrap_err(),
            ExchangeRefusal::Exhausted
        );
        assert_eq!(cache.cached_refusal(record.exchange_id.as_str()), None);

        // "Let them go on" widens the bucket; turn 4 is speakable on the very
        // next message rather than thirty seconds later.
        let widened = record.continued(NOW).expect("go").expect("not capped");
        assert!(cache.ingest_head(&head_event(&widened, &owner_keys(), NOW + 1)));
        assert!(cache.admit(&over, Some(NOW), None).await.is_ok());
    }

    #[tokio::test]
    async fn a_remembered_refusal_expires_and_is_paid_for_again() {
        let cache = resident_cache();
        let record = pair_record(None);
        let event = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 1)]);
        assert!(cache.admit(&event, Some(NOW), None).await.is_err());
        age_refusal(&cache, record.exchange_id.as_str(), NEGATIVE_TTL * 2);
        assert_eq!(cache.cached_refusal(record.exchange_id.as_str()), None);
    }

    #[tokio::test]
    async fn a_rest_answer_that_is_not_an_array_or_is_empty_leaves_the_exchange_unknown() {
        let record = pair_record(None);
        let event = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 1)]);

        for body in ["{}", "[]"] {
            let server = FakeRelay::responding(body).await;
            let cache = resident_cache();
            assert_eq!(
                cache
                    .admit(&event, Some(NOW), Some(&server.rest_client()))
                    .await
                    .unwrap_err(),
                ExchangeRefusal::Unknown,
                "answer {body} must leave the exchange unknown"
            );
        }
    }

    #[tokio::test]
    async fn a_rest_transport_failure_refuses_the_turn() {
        let server = FakeRelay::failing().await;
        let cache = resident_cache();
        let record = pair_record(None);
        let event = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 1)]);
        assert_eq!(
            cache
                .admit(&event, Some(NOW), Some(&server.rest_client()))
                .await
                .unwrap_err(),
            ExchangeRefusal::HeadUnverifiable
        );
    }

    #[tokio::test]
    async fn a_rest_answer_that_never_arrives_times_out_and_refuses() {
        let server = FakeRelay::hanging().await;
        let cache = resident_cache();
        let record = pair_record(None);
        let event = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 1)]);
        assert_eq!(
            cache
                .admit(&event, Some(NOW), Some(&server.rest_client()))
                .await
                .unwrap_err(),
            ExchangeRefusal::HeadUnverifiable
        );
    }

    #[tokio::test]
    async fn a_signed_head_fetched_over_rest_admits_the_turn() {
        let record = pair_record(None);
        let head = head_event(&record, &owner_keys(), NOW);
        let body = serde_json::to_string(&[&head]).expect("head array");
        let server = FakeRelay::responding(&body).await;
        let cache = resident_cache();
        let event = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 2)]);
        let admitted = cache
            .admit(&event, Some(NOW), Some(&server.rest_client()))
            .await
            .expect("admitted turn");
        assert_eq!(admitted.turn, 2);
        assert_eq!(admitted.exchange_id, record.exchange_id);
    }

    #[tokio::test]
    async fn a_sig_stripped_head_from_the_owner_is_accepted_as_relay_attested() {
        let record = pair_record(None);
        let body = serde_json::to_string(&[attested_body(&record, NOW)]).expect("head array");
        let server = FakeRelay::responding(&body).await;
        let cache = resident_cache();
        let event = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, 1)]);
        assert!(cache
            .admit(&event, Some(NOW), Some(&server.rest_client()))
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn a_rest_answer_about_another_exchange_never_grants_the_asked_for_turn() {
        let asked_about = pair_record(None);
        let answered_with = record(
            vec![hex_of(&resident_keys()), hex_of(&stranger_keys())],
            None,
        );
        let body =
            serde_json::to_string(&[attested_body(&answered_with, NOW)]).expect("head array");
        let server = FakeRelay::responding(&body).await;
        let cache = resident_cache();
        // The cache already holds a (stale) head for the *other* exchange, so a
        // grant path reading "any head" would have found something to admit.
        assert!(cache.ingest_head(&head_event(&asked_about, &owner_keys(), NOW)));
        age_head(&cache, asked_about.exchange_id.as_str(), HEAD_MAX_AGE * 2);
        let event = turn_event(&sibling_keys(), vec![turn_tag(&asked_about.exchange_id, 1)]);
        assert_eq!(
            cache
                .admit(&event, Some(NOW), Some(&server.rest_client()))
                .await
                .unwrap_err(),
            ExchangeRefusal::Unknown
        );
    }

    #[tokio::test]
    async fn a_fetched_head_that_leaves_this_resident_out_says_so_plainly() {
        let elsewhere = record(
            vec![hex_of(&sibling_keys()), hex_of(&stranger_keys())],
            None,
        );
        // A perfectly valid, owner-authored head for exactly the exchange asked
        // about — it simply does not list this resident.
        let body = serde_json::to_string(&[attested_body(&elsewhere, NOW)]).expect("head array");
        let server = FakeRelay::responding(&body).await;
        let cache = resident_cache();
        let event = turn_event(&sibling_keys(), vec![turn_tag(&elsewhere.exchange_id, 1)]);
        assert_eq!(
            cache
                .admit(&event, Some(NOW), Some(&server.rest_client()))
                .await
                .unwrap_err(),
            ExchangeRefusal::NotAMember,
            "an uninvited resident must be told that, not that the record was unreadable"
        );
        // Remembered like any other refusal that cost a round-trip.
        assert_eq!(
            cache.cached_refusal(elsewhere.exchange_id.as_str()),
            Some(ExchangeRefusal::NotAMember)
        );
        assert!(cache.any_head(elsewhere.exchange_id.as_str()).is_none());
    }

    #[tokio::test]
    async fn one_author_may_only_spend_a_few_head_fetches_a_minute() {
        // Every fetch is answered with "no such head", so each distinct id costs
        // a full round-trip and teaches the cache nothing it can reuse.
        let server = FakeRelay::responding("[]").await;
        let rest = server.rest_client();
        let cache = resident_cache();
        let sibling = hex_of(&sibling_keys());

        for seed in 0..GATE_FETCH_BUDGET as u8 {
            let event = turn_event(
                &sibling_keys(),
                vec![turn_tag(&fabricated_id(0xa0 + seed), 1)],
            );
            assert_eq!(
                cache
                    .admit(&event, Some(NOW), Some(&rest))
                    .await
                    .unwrap_err(),
                ExchangeRefusal::Unknown
            );
        }
        assert_eq!(server.request_count(), GATE_FETCH_BUDGET);

        // The next fabricated id from the same author is refused before the
        // relay is touched — a fresh id per message must not buy a fresh 2 s.
        let over = fabricated_id(0xa0 + GATE_FETCH_BUDGET as u8);
        let flood = turn_event(&sibling_keys(), vec![turn_tag(&over, 1)]);
        assert_eq!(
            cache
                .admit(&flood, Some(NOW), Some(&rest))
                .await
                .unwrap_err(),
            ExchangeRefusal::FetchBudgetExhausted
        );
        assert_eq!(
            server.request_count(),
            GATE_FETCH_BUDGET,
            "a budget refusal must cost the main loop nothing"
        );
        assert_eq!(
            cache.cached_refusal(over.as_str()),
            None,
            "a budget refusal remembers nothing about the exchange"
        );

        // The budget is the author's own: a second sibling is unaffected.
        let elsewhere = turn_event(&stranger_keys(), vec![turn_tag(&fabricated_id(0xb0), 1)]);
        assert_eq!(
            cache
                .admit(&elsewhere, Some(NOW), Some(&rest))
                .await
                .unwrap_err(),
            ExchangeRefusal::Unknown
        );
        assert_eq!(server.request_count(), GATE_FETCH_BUDGET + 1);

        // And the window slides: once it has passed, the first author is heard
        // again rather than being refused forever.
        age_fetch_budget(&cache, &sibling, GATE_FETCH_WINDOW * 2);
        let later = turn_event(&sibling_keys(), vec![turn_tag(&fabricated_id(0xc0), 1)]);
        assert_eq!(
            cache
                .admit(&later, Some(NOW), Some(&rest))
                .await
                .unwrap_err(),
            ExchangeRefusal::Unknown
        );
        assert_eq!(server.request_count(), GATE_FETCH_BUDGET + 2);
    }

    #[tokio::test]
    async fn a_head_already_in_hand_is_never_charged_to_the_budget() {
        let server = FakeRelay::responding("[]").await;
        let rest = server.rest_client();
        let cache = resident_cache();
        let record = pair_record(None);
        // Delivered on the live leg: no fetch, so no budget is spent however
        // many turns the exchange runs.
        assert!(cache.ingest_head(&head_event(&record, &owner_keys(), NOW)));
        for turn in 1..=3 {
            let event = turn_event(&sibling_keys(), vec![turn_tag(&record.exchange_id, turn)]);
            assert!(cache.admit(&event, Some(NOW), Some(&rest)).await.is_ok());
        }
        assert_eq!(server.request_count(), 0);
        assert!(
            cache
                .fetch_budget
                .lock()
                .expect("fetch budget")
                .get(hex_of(&sibling_keys()).as_str())
                .is_none(),
            "a turn served from a stored head must not be charged"
        );
    }

    #[test]
    fn every_refusal_has_its_own_sentence() {
        let all = [
            ExchangeRefusal::NoOwner,
            ExchangeRefusal::MissingTag,
            ExchangeRefusal::MalformedTag,
            ExchangeRefusal::Unknown,
            ExchangeRefusal::NotAMember,
            ExchangeRefusal::Closed,
            ExchangeRefusal::Expired,
            ExchangeRefusal::Exhausted,
            ExchangeRefusal::HeadUnverifiable,
            ExchangeRefusal::ClockUnavailable,
            ExchangeRefusal::FetchBudgetExhausted,
        ];
        let mut seen = std::collections::HashSet::new();
        for refusal in all {
            let reason = refusal.reason();
            assert!(!reason.is_empty());
            assert!(seen.insert(reason), "duplicate sentence: {reason}");
        }
    }
}
