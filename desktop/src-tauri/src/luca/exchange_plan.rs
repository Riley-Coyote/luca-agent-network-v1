//! Mint, continue, or refuse: the one decision every managed final passes through.
//!
//! This runs *before* the outbox sees the request, because the outbox compares
//! whole requests and a final that gains recipients or a turn tag afterwards
//! would look like a different request on replay. The resolver therefore
//! produces an **effective request**, and that is the only request the rest of
//! the pipeline ever handles.
//!
//! The decision is written down before it is acted on twice: the first
//! resolution for `(dispatch_receipt_id, resident_pubkey)` is frozen in the
//! exchange store, and every later attempt reads it back verbatim. Registry
//! drift, membership drift and a moving spent set can then never change the
//! bytes of a final that already spoke.
//!
//! Everything refuses rather than guesses. A head we cannot fetch, a room whose
//! membership we cannot establish, a relay that cannot count the spent turns —
//! each one produces an [`ExchangeDenial`], and each denial carries a sentence
//! written to the resident whose turn it was.

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};

use luca_protocol::{
    ExchangePhase, ExchangeRecordV1, ExchangeTurnTag, Hex64, ManagedMessagePublishRequestV1,
    EXCHANGE_BUCKET_CEILING,
};

use super::exchange::{place_exchange, ExchangeDenial, ExchangeNote, Placement};
use super::exchange_relay::ExchangeRelay;
use super::exchange_store::{decision_key, ExchangeDecision, ExchangeHead, ExchangeStore};
use super::managed_dispatch_store::ManagedDispatchStore;

/// Longest `@name` token the mention scanner will consider.
const MAX_MENTION_NAME_BYTES: usize = 64;
/// Most distinct `@name` tokens one draft can address.
const MAX_MENTIONS_PER_DRAFT: usize = 8;

/// The exchange placement decided for one managed final.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct ExchangePlan {
    /// The turn tag this final carries, when it speaks inside an exchange.
    pub exchange: Option<ExchangeTurnTag>,
    /// Recipients added to the reply under a minted exchange's authority.
    pub granted_p_tags: Vec<Hex64>,
}

impl ExchangePlan {
    /// The plan for a final that has nothing to do with any exchange.
    pub(crate) fn unchanged() -> Self {
        Self::default()
    }

    /// Produce the effective request: the only request the outbox, the dispatch
    /// authority, the event builder and the publisher ever see.
    pub(crate) fn apply(
        &self,
        request: &ManagedMessagePublishRequestV1,
    ) -> Result<ManagedMessagePublishRequestV1, luca_protocol::MessagePublishError> {
        if self.exchange.is_none() && self.granted_p_tags.is_empty() {
            return Ok(request.clone());
        }
        let mut effective = request.clone();
        effective
            .resolved_p_tags
            .extend(self.granted_p_tags.iter().cloned());
        effective.resolved_p_tags.sort();
        effective.resolved_p_tags.dedup();
        effective.exchange = self.exchange.clone();
        effective.validate()?;
        Ok(effective)
    }
}

/// One resolution: what the final carries, and what the room is owed.
struct Decided {
    plan: ExchangePlan,
    /// Ready-to-publish `kind:40099` contents, frozen with the decision so a
    /// replay says exactly the same sentences.
    notes: Vec<String>,
}

impl Decided {
    fn unchanged() -> Self {
        Self {
            plan: ExchangePlan::unchanged(),
            notes: Vec::new(),
        }
    }
}

/// The owner authority that mints, continues, and refuses.
pub(crate) struct ExchangeResolver<'a> {
    relay: &'a dyn ExchangeRelay,
    store: &'a Arc<Mutex<ExchangeStore>>,
    dispatch: &'a Arc<Mutex<ManagedDispatchStore>>,
}

impl<'a> ExchangeResolver<'a> {
    /// Bind one resolution to the owner authority, the exchange store and the
    /// dispatch store.
    pub(crate) fn new(
        relay: &'a dyn ExchangeRelay,
        store: &'a Arc<Mutex<ExchangeStore>>,
        dispatch: &'a Arc<Mutex<ManagedDispatchStore>>,
    ) -> Self {
        Self {
            relay,
            store,
            dispatch,
        }
    }

    /// Decide this final's place in the world, once and for all.
    pub(crate) fn resolve(
        &self,
        request: &ManagedMessagePublishRequestV1,
        now_unix_secs: u64,
    ) -> Result<ExchangePlan, ExchangeDenial> {
        let key = decision_key(
            request.dispatch_receipt_id.as_str(),
            request.resident_pubkey.as_str(),
        );
        if let Some(decision) = self.cached_decision(&key)? {
            self.settle_notes(request, &key, &decision);
            return Ok(ExchangePlan {
                exchange: decision.exchange,
                granted_p_tags: decision.granted_p_tags,
            });
        }
        let decided = match &request.exchange {
            Some(proposed) => self.continue_exchange(request, proposed, now_unix_secs)?,
            None => self.mint_or_pass(request, now_unix_secs)?,
        };
        let frozen = self.freeze(&key, &decided)?;
        self.settle_notes(request, &key, &frozen);
        Ok(ExchangePlan {
            exchange: frozen.exchange,
            granted_p_tags: frozen.granted_p_tags,
        })
    }

    /// Choose the next unspoken turn after the relay answered "that turn is
    /// already spoken", and record it so a replay lands on the same one.
    ///
    /// The head is re-read from the relay rather than the local store, so a
    /// "Stop here" that arrived between the two attempts is honored instead of
    /// being papered over by a stale copy.
    pub(crate) fn retune_turn(
        &self,
        request: &ManagedMessagePublishRequestV1,
        now_unix_secs: u64,
    ) -> Result<ExchangeTurnTag, ExchangeDenial> {
        let proposed = request.exchange.as_ref().ok_or(ExchangeDenial::Unknown)?;
        let record = self.refresh_head(&proposed.exchange_id, &request.owner_pubkey)?;
        let spent = self.spent(&record)?;
        self.guard_phase(&record, &spent, now_unix_secs)?;
        let turn = first_free_turn(&record, &spent).ok_or(ExchangeDenial::Exhausted)?;
        let tag = ExchangeTurnTag::new(record.exchange_id.clone(), turn)
            .map_err(|_| ExchangeDenial::Exhausted)?;
        let key = decision_key(
            request.dispatch_receipt_id.as_str(),
            request.resident_pubkey.as_str(),
        );
        self.store
            .lock()
            .map_err(|_| ExchangeDenial::Unavailable)?
            .retune_decision(&key, &tag)
            .map_err(|error| {
                eprintln!("luca-exchange: could not record the retuned turn: {error}");
                ExchangeDenial::Unavailable
            })?;
        Ok(tag)
    }

    // ── continue ────────────────────────────────────────────────────────────

    fn continue_exchange(
        &self,
        request: &ManagedMessagePublishRequestV1,
        proposed: &ExchangeTurnTag,
        now_unix_secs: u64,
    ) -> Result<Decided, ExchangeDenial> {
        let record = self.head_or_fetch(&proposed.exchange_id, &request.owner_pubkey)?;
        if record.conversation_id != request.conversation_id {
            eprintln!(
                "luca-exchange: {} was refused — that exchange lives in another room",
                request.resident_pubkey.as_str()
            );
            return Err(ExchangeDenial::Unknown);
        }
        if !record.is_member(&request.resident_pubkey) {
            return Err(ExchangeDenial::NotMember);
        }
        // The owner is never a member, so a reply that addresses the owner from
        // inside an exchange is refused here rather than at the relay.
        if request
            .resolved_p_tags
            .iter()
            .any(|pubkey| !record.is_member(pubkey))
        {
            return Err(ExchangeDenial::NotMember);
        }
        let spent = self.spent(&record)?;
        self.guard_phase(&record, &spent, now_unix_secs)?;
        if !record.admits_turn(proposed.turn, now_unix_secs) {
            return Err(ExchangeDenial::Exhausted);
        }
        let turn = if spent.contains(&proposed.turn) {
            first_free_turn(&record, &spent).ok_or(ExchangeDenial::Exhausted)?
        } else {
            proposed.turn
        };
        let tag = ExchangeTurnTag::new(record.exchange_id.clone(), turn)
            .map_err(|_| ExchangeDenial::Exhausted)?;
        let notes = self.third_resident_notes(request, &record)?;
        Ok(Decided {
            plan: ExchangePlan {
                exchange: Some(tag),
                granted_p_tags: Vec::new(),
            },
            notes,
        })
    }

    /// A resident already inside an exchange who names a third resident gets one
    /// sentence in the room and no new exchange. One hop is the limit for now.
    fn third_resident_notes(
        &self,
        request: &ManagedMessagePublishRequestV1,
        record: &ExchangeRecordV1,
    ) -> Result<Vec<String>, ExchangeDenial> {
        let mentioned = self.resolve_mentions(request)?;
        let speaker = self.relay.display_name(&request.resident_pubkey);
        Ok(mentioned
            .into_iter()
            .filter(|(_, pubkey)| !record.is_member(pubkey))
            .map(|(name, _)| {
                ExchangeNote::mentioned_a_third(
                    Some(record.exchange_id.clone()),
                    request.resident_pubkey.clone(),
                    &speaker,
                    &name,
                )
                .to_content()
            })
            .collect())
    }

    // ── mint ────────────────────────────────────────────────────────────────

    fn mint_or_pass(
        &self,
        request: &ManagedMessagePublishRequestV1,
        now_unix_secs: u64,
    ) -> Result<Decided, ExchangeDenial> {
        // A final whose trigger was a sibling can never publish outside an
        // exchange. The harness proposes the turn; if none arrived, refuse.
        let depth = self
            .dispatch
            .lock()
            .map_err(|_| ExchangeDenial::Unavailable)?
            .descendant_depth(
                request.dispatch_receipt_id.as_str(),
                request.resident_pubkey.as_str(),
            )
            .map_err(|_| ExchangeDenial::Unavailable)?;
        if depth != 0 {
            eprintln!(
                "luca-exchange: {} was refused — a sibling-triggered reply needs an exchange",
                request.resident_pubkey.as_str()
            );
            return Err(ExchangeDenial::Unknown);
        }
        let mentioned = self.resolve_mentions(request)?;
        if mentioned.is_empty() {
            return Ok(Decided::unchanged());
        }
        let room = self
            .relay
            .conversation_members(&request.conversation_id)
            .map_err(|error| {
                eprintln!("luca-exchange: mint refused — {error}");
                ExchangeDenial::MintRefused
            })?;
        let mut addressed: Vec<Hex64> = mentioned.iter().map(|(_, key)| key.clone()).collect();
        addressed.sort();
        addressed.dedup();
        let placement = place_exchange(
            &room,
            &addressed,
            &request.owner_pubkey,
            &request.resident_pubkey,
        );
        let in_room: Vec<Hex64> = match &placement {
            Placement::InPlace { members } => members.clone(),
            Placement::PairDm { .. } | Placement::NeedsProjectRoom { .. } => addressed
                .iter()
                .filter(|pubkey| room.contains(*pubkey))
                .cloned()
                .collect(),
        };
        let speaker = self.relay.display_name(&request.resident_pubkey);
        let notes: Vec<String> = mentioned
            .iter()
            .filter(|(_, pubkey)| !room.contains(pubkey))
            .map(|(name, _)| {
                ExchangeNote::mentioned_someone_absent(
                    request.resident_pubkey.clone(),
                    &speaker,
                    name,
                )
                .to_content()
            })
            .collect();
        if in_room.is_empty() {
            return Ok(Decided {
                plan: ExchangePlan::unchanged(),
                notes,
            });
        }
        let tag = self.mint(request, &in_room, now_unix_secs)?;
        Ok(Decided {
            plan: ExchangePlan {
                exchange: Some(tag),
                granted_p_tags: in_room,
            },
            notes,
        })
    }

    fn mint(
        &self,
        request: &ManagedMessagePublishRequestV1,
        in_room: &[Hex64],
        now_unix_secs: u64,
    ) -> Result<ExchangeTurnTag, ExchangeDenial> {
        // The dispatch receipt *is* the owner utterance that minted the budget.
        let root = Hex64::parse(request.dispatch_receipt_id.as_str().to_owned())
            .map_err(|_| ExchangeDenial::MintRefused)?;
        let mut members = in_room.to_vec();
        members.push(request.resident_pubkey.clone());
        let record = ExchangeRecordV1::open(
            request.owner_pubkey.clone(),
            members,
            request.conversation_id.clone(),
            root,
            request.resident_pubkey.clone(),
            request.bucket_hint,
            now_unix_secs,
        )
        .map_err(|error| {
            eprintln!("luca-exchange: mint refused — {error}");
            ExchangeDenial::MintRefused
        })?;
        let prior = self
            .store
            .lock()
            .map_err(|_| ExchangeDenial::Unavailable)?
            .head(&record.exchange_id)
            .map(|head| head.created_at);
        let created_at = buzz_core_pkg::engram::monotonic_created_at(now_unix_secs, prior);
        let event_id = self
            .relay
            .publish_record(&record, created_at)
            .map_err(|error| {
                eprintln!("luca-exchange: the exchange record was refused — {error}");
                ExchangeDenial::MintRefused
            })?;
        self.store
            .lock()
            .map_err(|_| ExchangeDenial::Unavailable)?
            .upsert_head(ExchangeHead {
                record: record.clone(),
                created_at,
                event_id,
            })
            .map_err(|error| {
                eprintln!("luca-exchange: the exchange head could not be stored — {error}");
                ExchangeDenial::MintRefused
            })?;
        let additional: Vec<String> = in_room
            .iter()
            .map(|pubkey| pubkey.as_str().to_owned())
            .collect();
        self.dispatch
            .lock()
            .map_err(|_| ExchangeDenial::Unavailable)?
            .grant_exchange_recipients(
                request.dispatch_receipt_id.as_str(),
                request.resident_pubkey.as_str(),
                &additional,
                now_unix_secs,
            )
            .map_err(|error| {
                eprintln!("luca-exchange: the reply audience could not be widened — {error}");
                ExchangeDenial::MintRefused
            })?;
        ExchangeTurnTag::new(record.exchange_id, 1).map_err(|_| ExchangeDenial::MintRefused)
    }

    // ── shared ──────────────────────────────────────────────────────────────

    fn cached_decision(&self, key: &str) -> Result<Option<ExchangeDecision>, ExchangeDenial> {
        Ok(self
            .store
            .lock()
            .map_err(|_| ExchangeDenial::Unavailable)?
            .decision(key)
            .cloned())
    }

    fn freeze(&self, key: &str, decided: &Decided) -> Result<ExchangeDecision, ExchangeDenial> {
        self.store
            .lock()
            .map_err(|_| ExchangeDenial::Unavailable)?
            .record_decision(
                key,
                ExchangeDecision {
                    exchange: decided.plan.exchange.clone(),
                    granted_p_tags: decided.plan.granted_p_tags.clone(),
                    notes: decided.notes.clone(),
                    notes_published: false,
                    order: 0,
                },
            )
            .map_err(|error| {
                eprintln!("luca-exchange: the exchange decision could not be frozen — {error}");
                ExchangeDenial::Unavailable
            })
    }

    /// Say the sentences this decision owes the room, then remember that they
    /// were said. A failed note is logged, never turned into a second refusal —
    /// the reply it explains has already been decided.
    fn settle_notes(
        &self,
        request: &ManagedMessagePublishRequestV1,
        key: &str,
        decision: &ExchangeDecision,
    ) {
        if decision.notes_published || decision.notes.is_empty() {
            return;
        }
        for note in &decision.notes {
            if let Err(error) = self.relay.publish_note(&request.conversation_id, note) {
                eprintln!("luca-exchange: an exchange note could not be published — {error}");
                return;
            }
        }
        match self.store.lock() {
            Ok(mut store) => {
                if let Err(error) = store.mark_notes_published(key) {
                    eprintln!("luca-exchange: exchange notes may be repeated — {error}");
                }
            }
            Err(_) => eprintln!("luca-exchange: exchange notes may be repeated — store is locked"),
        }
    }

    fn head_or_fetch(
        &self,
        exchange_id: &Hex64,
        owner: &Hex64,
    ) -> Result<ExchangeRecordV1, ExchangeDenial> {
        if let Some(head) = self
            .store
            .lock()
            .map_err(|_| ExchangeDenial::Unavailable)?
            .head(exchange_id)
        {
            return Ok(head.record.clone());
        }
        self.refresh_head(exchange_id, owner)
    }

    fn refresh_head(
        &self,
        exchange_id: &Hex64,
        owner: &Hex64,
    ) -> Result<ExchangeRecordV1, ExchangeDenial> {
        let fetched = self
            .relay
            .fetch_head(exchange_id, owner)
            .map_err(|error| {
                eprintln!("luca-exchange: the exchange head could not be read — {error}");
                ExchangeDenial::Unavailable
            })?
            .ok_or(ExchangeDenial::Unknown)?;
        if &fetched.record.owner != owner {
            return Err(ExchangeDenial::Unknown);
        }
        // The relay has already arbitrated between candidate heads, so its
        // answer replaces the local copy outright rather than competing with it.
        self.store
            .lock()
            .map_err(|_| ExchangeDenial::Unavailable)?
            .adopt_head(fetched.clone())
            .map_err(|error| {
                eprintln!("luca-exchange: the exchange head could not be stored — {error}");
                ExchangeDenial::Unavailable
            })?;
        Ok(fetched.record)
    }

    fn spent(&self, record: &ExchangeRecordV1) -> Result<BTreeSet<u8>, ExchangeDenial> {
        self.relay.spent_turns(record).map_err(|error| {
            eprintln!("luca-exchange: the spent turns could not be counted — {error}");
            ExchangeDenial::Unavailable
        })
    }

    fn guard_phase(
        &self,
        record: &ExchangeRecordV1,
        spent: &BTreeSet<u8>,
        now_unix_secs: u64,
    ) -> Result<(), ExchangeDenial> {
        let count = u8::try_from(spent.len()).unwrap_or(u8::MAX);
        match record.phase(count, now_unix_secs) {
            ExchangePhase::Closed => Err(ExchangeDenial::Closed),
            ExchangePhase::Expired => Err(ExchangeDenial::Expired),
            ExchangePhase::Open | ExchangePhase::Paused => Ok(()),
        }
    }

    /// Every `@name` in the draft that resolves to one of this owner's other
    /// residents, in first-seen order. An unknown or ambiguous name is not a
    /// resident and simply does not match.
    fn resolve_mentions(
        &self,
        request: &ManagedMessagePublishRequestV1,
    ) -> Result<Vec<(String, Hex64)>, ExchangeDenial> {
        let names = mentioned_names(&request.final_draft);
        if names.is_empty() {
            return Ok(Vec::new());
        }
        let owned = self.relay.owned_residents().map_err(|error| {
            eprintln!("luca-exchange: the resident registry could not be read — {error}");
            ExchangeDenial::Unavailable
        })?;
        let mut matched = Vec::new();
        let mut seen = BTreeSet::new();
        for name in names {
            let resolved = self
                .relay
                .resolve_resident_name(&owned, &name)
                .map_err(|error| {
                    eprintln!("luca-exchange: the resident registry could not be read — {error}");
                    ExchangeDenial::Unavailable
                })?;
            let Some(pubkey) = resolved else {
                eprintln!("luca-exchange: \"@{name}\" is not one of this house's residents");
                continue;
            };
            if pubkey == request.resident_pubkey || pubkey == request.owner_pubkey {
                continue;
            }
            if seen.insert(pubkey.clone()) {
                matched.push((name, pubkey));
            }
        }
        Ok(matched)
    }
}

/// The lowest turn in the bucket that nobody has spoken.
fn first_free_turn(record: &ExchangeRecordV1, spent: &BTreeSet<u8>) -> Option<u8> {
    (1..=record.bucket.min(EXCHANGE_BUCKET_CEILING)).find(|turn| !spent.contains(turn))
}

/// Every `@name` token in a draft, in first-seen order, case-insensitively
/// deduplicated.
///
/// A mention starts at an `@` that follows the start of the draft or a
/// non-word character, and runs over `[A-Za-z0-9._-]`. Trailing punctuation is
/// trimmed, so `"ask @Vektor."` addresses `Vektor`. Multi-word display names
/// cannot be written as a single token and therefore do not match.
pub(crate) fn mentioned_names(draft: &str) -> Vec<String> {
    let bytes = draft.as_bytes();
    let mut names: Vec<String> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] != b'@' {
            index += 1;
            continue;
        }
        let preceded_by_word = index
            .checked_sub(1)
            .is_some_and(|previous| is_word_byte(bytes[previous]));
        if preceded_by_word {
            index += 1;
            continue;
        }
        let start = index + 1;
        let mut end = start;
        while end < bytes.len() && is_mention_byte(bytes[end]) {
            end += 1;
        }
        let mut name = &draft[start..end];
        name = name.trim_end_matches(['.', '-', '_']);
        index = end.max(start + 1);
        if name.is_empty() || name.len() > MAX_MENTION_NAME_BYTES {
            continue;
        }
        if seen.insert(name.to_lowercase()) {
            names.push(name.to_owned());
            if names.len() == MAX_MENTIONS_PER_DRAFT {
                break;
            }
        }
    }
    names
}

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn is_mention_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-')
}

#[cfg(test)]
#[path = "exchange_plan_tests.rs"]
mod exchange_plan_tests;
