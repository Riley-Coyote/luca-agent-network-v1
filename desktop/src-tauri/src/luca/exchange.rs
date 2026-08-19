//! The exchange, desktop side: what a refusal is called, where an exchange
//! belongs, what the room is told, and the owner's Stop and Go.
//!
//! The resolver that mints and tags lives in [`super::exchange_plan`]; this
//! module holds the vocabulary it speaks and the two commands the owner drives.

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};

use luca_protocol::{ExchangePhase, ExchangeRecordV1, Hex64, OpaqueId};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::exchange_relay::{AppExchangeRelay, ExchangeRelay};
use super::exchange_store::{global_exchange_store, ExchangeHead, ExchangeStore};

/// Tauri event emitted whenever an exchange head changes under the owner's hand.
pub(crate) const EXCHANGE_UPDATED_EVENT: &str = "exchange-updated";

/// Why a managed final was refused a place in an exchange.
///
/// Every variant is a sentence the resident can be told, not just a code: a
/// resident that is refused always learns which door was closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExchangeDenial {
    /// No owner-authored head answers for this exchange, or the head belongs to
    /// another room. Includes a sibling-triggered final with no exchange at all.
    Unknown,
    /// The author, or someone the reply addresses, is not a member.
    NotMember,
    /// The owner said "Stop here".
    Closed,
    /// The deadline passed while it was still open.
    Expired,
    /// Every turn in the bucket has been spoken.
    Exhausted,
    /// The exchange could not be minted — the record was refused, or the room's
    /// membership could not be established.
    MintRefused,
    /// The exchange authority itself could not be reached, so nothing can be
    /// decided. Refusing is the only honest answer.
    Unavailable,
}

impl ExchangeDenial {
    /// The body-free `Denied { code }` the ACP side receives.
    pub(crate) const fn code(self) -> &'static str {
        match self {
            Self::Unknown => "exchange_unknown",
            Self::NotMember => "exchange_not_member",
            Self::Closed => "exchange_closed",
            Self::Expired => "exchange_expired",
            Self::Exhausted => "exchange_exhausted",
            Self::MintRefused => "exchange_mint_refused",
            Self::Unavailable => "exchange_unavailable",
        }
    }

    /// One sentence, written to the resident whose turn this was.
    pub(crate) const fn sentence(self) -> &'static str {
        match self {
            Self::Unknown => "there is no open exchange for this reply, so it was not sent",
            Self::NotMember => {
                "this reply addressed someone outside the exchange, so it was not sent"
            }
            Self::Closed => "the exchange was stopped, so this reply was held",
            Self::Expired => "the exchange ran out of time, so this reply was held",
            Self::Exhausted => {
                "the exchange has spent every turn it was given, so this reply was held"
            }
            Self::MintRefused => {
                "the exchange for this reply could not be opened, so it was not sent"
            }
            Self::Unavailable => "the exchange could not be checked, so this reply was held",
        }
    }

    /// How the room's own sentence ends when a reply is held for this reason.
    ///
    /// `None` means the room is told nothing, and there are exactly two such
    /// reasons: the exchange could not be *opened*, and the exchange could not
    /// be *reached*. Neither is a decision about the reply, and neither can
    /// reach the room anyway — the same authority that would carry the sentence
    /// is the one that just failed.
    pub(crate) const fn held_note_tail(self) -> Option<&'static str> {
        match self {
            Self::Closed => Some("the exchange was stopped."),
            Self::Expired => Some("the exchange expired."),
            Self::Exhausted => Some("the exchange is paused."),
            Self::NotMember | Self::Unknown => Some("it was outside any open exchange."),
            Self::MintRefused | Self::Unavailable => None,
        }
    }
}

impl std::fmt::Display for ExchangeDenial {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.sentence())
    }
}

/// What an exchange refusal *from the relay* means for frozen bytes.
///
/// The desktop refuses before the relay has to, but it cannot refuse a race:
/// two members can reach for the same turn number at the same moment, and only
/// the relay's advisory lock decides who got it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExchangeRefusal {
    /// Another member reached this turn number first. The identical draft is
    /// re-signed on the next free turn; a reply is never dropped for a race.
    TurnTaken,
    /// The exchange will not admit this reply at all. It is held, the room is
    /// told, and the resident hears the reason.
    ///
    /// The denial travels rather than its code so the sentence written into the
    /// room can never drift from the code returned to the resident.
    Held(ExchangeDenial),
}

/// Read the relay's refusal, if this refusal came from an exchange gate.
///
/// The strings are the relay's own (`crates/buzz-relay/src/handlers/exchange.rs`).
/// An unrecognised `restricted: exchange` refusal is still *held* — a refusal we
/// do not understand is never treated as permission to try again.
pub(crate) fn classify_exchange_refusal(message: &str) -> Option<ExchangeRefusal> {
    if !message.contains("restricted: exchange") {
        return None;
    }
    if message.contains("turn already spoken") {
        return Some(ExchangeRefusal::TurnTaken);
    }
    let denial = if message.contains("exchange closed") {
        ExchangeDenial::Closed
    } else if message.contains("exchange expired") {
        ExchangeDenial::Expired
    } else if message.contains("exchange exhausted") {
        ExchangeDenial::Exhausted
    } else if message.contains("not a member") {
        ExchangeDenial::NotMember
    } else {
        ExchangeDenial::Unknown
    };
    Some(ExchangeRefusal::Held(denial))
}

/// Where an exchange between these people can actually live.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Placement {
    /// Everyone addressed is already in the room the trigger arrived in.
    InPlace {
        /// The addressed residents, sorted and unique.
        members: Vec<Hex64>,
    },
    /// One addressed resident is elsewhere; the owner, the resident who spoke,
    /// and that addressed resident share a pair DM. This chunk turns the arm
    /// into a sentence in the room instead of opening the DM.
    PairDm {
        /// The owner, the speaker and the addressed resident, sorted and
        /// unique — everybody the pair DM would have to hold.
        participants: Vec<Hex64>,
    },
    /// More than one addressed resident is elsewhere. A pair DM cannot hold
    /// them; that needs a room, which is a later chunk.
    NeedsProjectRoom {
        /// The addressed residents outside the origin room, sorted and unique.
        addressed: Vec<Hex64>,
    },
}

/// Decide where an exchange addressed to `addressed` belongs, given the room it
/// was spoken in and the resident who spoke.
///
/// Pure and deterministic — same inputs, same answer, in any order. Only the
/// [`Placement::InPlace`] arm is wired in this chunk; the other two become the
/// exchange-note the room sees.
///
/// `speaker` is the resident whose draft did the addressing. A pair DM that
/// left them out would not be the conversation anybody asked for, so they are
/// always among its participants.
pub(crate) fn place_exchange(
    origin_members: &BTreeSet<Hex64>,
    addressed: &[Hex64],
    owner: &Hex64,
    speaker: &Hex64,
) -> Placement {
    let mut wanted: Vec<Hex64> = addressed.to_vec();
    wanted.sort();
    wanted.dedup();
    let outside: Vec<Hex64> = wanted
        .iter()
        .filter(|pubkey| !origin_members.contains(*pubkey))
        .cloned()
        .collect();
    match outside.len() {
        0 => Placement::InPlace { members: wanted },
        1 => {
            let mut participants = outside;
            participants.push(owner.clone());
            participants.push(speaker.clone());
            participants.sort();
            participants.dedup();
            Placement::PairDm { participants }
        }
        _ => Placement::NeedsProjectRoom { addressed: outside },
    }
}

/// One sentence the room is shown when the exchange did something the people in
/// it should know about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExchangeNote {
    /// The exchange this is about, when there is one.
    pub exchange_id: Option<Hex64>,
    /// The resident the sentence is about.
    pub resident: Hex64,
    /// The sentence itself.
    pub text: String,
}

impl ExchangeNote {
    /// "<Resident> mentioned <Name>, who isn't here — asking across rooms comes next."
    pub(crate) fn mentioned_someone_absent(resident: Hex64, speaker: &str, absent: &str) -> Self {
        Self {
            exchange_id: None,
            resident,
            text: format!(
                "{speaker} mentioned {absent}, who isn't here — asking across rooms comes next."
            ),
        }
    }

    /// "<Resident> mentioned <Name> — one hop is the limit for now."
    pub(crate) fn mentioned_a_third(
        exchange_id: Option<Hex64>,
        resident: Hex64,
        speaker: &str,
        third: &str,
    ) -> Self {
        Self {
            exchange_id,
            resident,
            text: format!("{speaker} mentioned {third} — one hop is the limit for now."),
        }
    }

    /// "<Name>'s reply was held — <why>."
    ///
    /// The tail is chosen by the refusal itself, so the room hears the same
    /// reason the resident was given rather than a stock sentence about a Stop
    /// that may never have happened. `None` for the two refusals the room is
    /// deliberately not told about — see [`ExchangeDenial::held_note_tail`].
    pub(crate) fn reply_was_held(
        exchange_id: Option<Hex64>,
        resident: Hex64,
        name: &str,
        denial: ExchangeDenial,
    ) -> Option<Self> {
        let tail = denial.held_note_tail()?;
        Some(Self {
            exchange_id,
            resident,
            text: format!("{name}'s reply was held — {tail}"),
        })
    }

    /// The exact `kind:40099` content this note is published as.
    pub(crate) fn to_content(&self) -> String {
        serde_json::json!({
            "type": "exchange-note",
            "exchange_id": self.exchange_id.as_ref().map(Hex64::as_str),
            "resident": self.resident.as_str(),
            "text": self.text,
        })
        .to_string()
    }
}

/// What the owner's controls return and what the strip renders.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExchangeSnapshot {
    /// The exchange record exactly as the relay holds it.
    pub record: ExchangeRecordV1,
    /// Turns already spoken, counted from the relay.
    pub spent: u8,
    /// Turns still speakable.
    pub remaining: u8,
    /// The lived phase this renders as.
    pub phase: ExchangePhase,
}

fn now_unix_secs() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "system clock is before the Unix epoch".to_string())
        .map(|elapsed| elapsed.as_secs())
}

fn owner_pubkey(app: &AppHandle) -> Result<Hex64, String> {
    let state = app.state::<crate::app_state::AppState>();
    let keys = state.signing_keys()?;
    Hex64::parse(keys.public_key().to_hex())
        .map_err(|error| format!("owner key is invalid: {error}"))
}

fn lock_store(
    store: &Arc<Mutex<ExchangeStore>>,
) -> Result<std::sync::MutexGuard<'_, ExchangeStore>, String> {
    store
        .lock()
        .map_err(|_| "luca exchange store lock is unavailable".to_string())
}

/// The head the *relay* holds, which is the only head the owner's controls act
/// on.
///
/// The local store is a cache, not a second opinion: an exchange the owner
/// stopped on another device is already stopped, and deriving the next record
/// from a stale copy would quietly undo it. The cache answers only when the
/// relay could not be reached at all, and says so when it does. A relay that
/// answers "no such head" is believed — that is an answer, not a failure.
fn authoritative_head(
    relay: &dyn ExchangeRelay,
    store: &Arc<Mutex<ExchangeStore>>,
    exchange_id: &Hex64,
    owner: &Hex64,
) -> Result<Option<ExchangeHead>, String> {
    match relay.fetch_head(exchange_id, owner) {
        Ok(Some(head)) => {
            if &head.record.owner != owner {
                return Err("that exchange was signed by somebody else".to_string());
            }
            lock_store(store)?.adopt_head(head.clone())?;
            Ok(Some(head))
        }
        Ok(None) => Ok(None),
        Err(error) => {
            eprintln!(
                "luca-exchange: the relay could not be read ({error}) — answering for {} from the copy this desktop holds",
                exchange_id.as_str()
            );
            Ok(lock_store(store)?.head(exchange_id).cloned())
        }
    }
}

/// Read back whichever head the relay actually kept after a re-signed record
/// was published.
///
/// A replaceable write can be dominated — the relay answers `duplicate:` and
/// keeps the head it already had — and that answer arrives as a success. The
/// only way to know what the owner's Stop or Go really did is to look again.
fn settled_head(
    relay: &dyn ExchangeRelay,
    store: &Arc<Mutex<ExchangeStore>>,
    published: ExchangeRecordV1,
    owner: &Hex64,
) -> Result<ExchangeRecordV1, String> {
    match relay.fetch_head(&published.exchange_id, owner) {
        Ok(Some(head)) => {
            if head.record != published {
                eprintln!(
                    "luca-exchange: the relay kept a different head for {} — reporting the relay's record, not the one just signed",
                    published.exchange_id.as_str()
                );
            }
            lock_store(store)?.adopt_head(head.clone())?;
            Ok(head.record)
        }
        Ok(None) => {
            eprintln!(
                "luca-exchange: the relay does not hold the head just published for {} — reporting the record that was signed",
                published.exchange_id.as_str()
            );
            Ok(published)
        }
        Err(error) => {
            eprintln!(
                "luca-exchange: the head just published for {} could not be re-read ({error}) — reporting the record that was signed",
                published.exchange_id.as_str()
            );
            Ok(published)
        }
    }
}

fn snapshot_for(
    relay: &dyn ExchangeRelay,
    record: ExchangeRecordV1,
    now: u64,
) -> Result<ExchangeSnapshot, String> {
    let spent = relay
        .spent_turns(&record)
        .map_err(|error| error.to_string())?;
    let spent = u8::try_from(spent.len()).unwrap_or(u8::MAX);
    Ok(ExchangeSnapshot {
        remaining: record.remaining(spent),
        phase: record.phase(spent, now),
        spent,
        record,
    })
}

/// The owner's Stop and Go, against any relay and any store.
///
/// `stop` closes the exchange; `go` grants three more turns and a fresh
/// deadline, and refuses at the ceiling — no signature raises it. The re-signed
/// head always carries a `created_at` strictly after the head it replaces, so
/// two devices resolving at the same second converge on one record instead of
/// fighting; and the head that comes back is the one the relay kept, not the
/// one this desktop hoped for.
pub(crate) fn apply_owner_decision(
    relay: &dyn ExchangeRelay,
    store: &Arc<Mutex<ExchangeStore>>,
    exchange_id: &Hex64,
    owner: &Hex64,
    action: &str,
    now: u64,
) -> Result<ExchangeSnapshot, String> {
    let head = authoritative_head(relay, store, exchange_id, owner)?
        .ok_or_else(|| "that exchange is not one of ours".to_string())?;
    let next = match action {
        "stop" => head.record.stopped(),
        "go" => head
            .record
            .continued(now)
            .map_err(|error| format!("exchange could not be continued: {error}"))?
            .ok_or_else(|| "at the ceiling".to_string())?,
        other => return Err(format!("unknown exchange action: {other}")),
    };
    let created_at = buzz_core_pkg::engram::monotonic_created_at(now, Some(head.created_at));
    let event_id = relay
        .publish_record(&next, created_at)
        .map_err(|error| error.to_string())?;
    lock_store(store)?.upsert_head(ExchangeHead {
        record: next.clone(),
        created_at,
        event_id,
    })?;
    let settled = settled_head(relay, store, next, owner)?;
    snapshot_for(relay, settled, now)
}

/// The exchange head the relay holds plus the turns it has counted, against any
/// relay and any store.
pub(crate) fn read_exchange(
    relay: &dyn ExchangeRelay,
    store: &Arc<Mutex<ExchangeStore>>,
    exchange_id: &Hex64,
    owner: &Hex64,
    now: u64,
) -> Result<Option<ExchangeSnapshot>, String> {
    let Some(head) = authoritative_head(relay, store, exchange_id, owner)? else {
        return Ok(None);
    };
    snapshot_for(relay, head.record, now).map(Some)
}

/// The owner's Stop and Go.
#[tauri::command]
pub(crate) async fn resolve_exchange(
    app: AppHandle,
    exchange_id: String,
    action: String,
) -> Result<ExchangeSnapshot, String> {
    tokio::task::spawn_blocking(move || {
        let exchange_id = Hex64::parse(exchange_id)
            .map_err(|error| format!("exchange id is invalid: {error}"))?;
        let relay = AppExchangeRelay::new(app.clone());
        let snapshot = apply_owner_decision(
            &relay,
            &global_exchange_store(&app)?,
            &exchange_id,
            &owner_pubkey(&app)?,
            action.as_str(),
            now_unix_secs()?,
        )?;
        let _ = app.emit(
            EXCHANGE_UPDATED_EVENT,
            serde_json::json!({
                "exchangeId": snapshot.record.exchange_id.as_str(),
                "record": &snapshot.record,
                "spent": snapshot.spent,
                "phase": snapshot.phase,
            }),
        );
        Ok(snapshot)
    })
    .await
    .map_err(|error| format!("exchange worker failed: {error}"))?
}

/// The exchange head plus the turns the relay has counted, or `None` when this
/// house holds no such exchange.
#[tauri::command]
pub(crate) async fn get_exchange(
    app: AppHandle,
    exchange_id: String,
) -> Result<Option<ExchangeSnapshot>, String> {
    tokio::task::spawn_blocking(move || {
        let exchange_id = Hex64::parse(exchange_id)
            .map_err(|error| format!("exchange id is invalid: {error}"))?;
        let relay = AppExchangeRelay::new(app.clone());
        read_exchange(
            &relay,
            &global_exchange_store(&app)?,
            &exchange_id,
            &owner_pubkey(&app)?,
            now_unix_secs()?,
        )
    })
    .await
    .map_err(|error| format!("exchange worker failed: {error}"))?
}

/// Publish one exchange-note into a room under the owner's key.
///
/// Best-effort by design: the note explains something that already happened, so
/// a failure to publish it is logged as a sentence rather than turned into a
/// second failure on top of the first.
pub(crate) fn publish_note(
    relay: &dyn ExchangeRelay,
    conversation_id: &OpaqueId,
    note: &ExchangeNote,
) {
    if let Err(error) = relay.publish_note(conversation_id, &note.to_content()) {
        eprintln!(
            "luca-exchange: could not tell {} that \"{}\": {error}",
            note.resident.as_str(),
            note.text
        );
    }
}

#[cfg(test)]
#[path = "exchange_tests.rs"]
mod exchange_tests;
