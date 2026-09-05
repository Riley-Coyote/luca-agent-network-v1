//! Every owner-authority operation the exchange half needs, behind one trait.
//!
//! Minting, continuing and refusing a turn all require things the resident
//! signing broker deliberately does not hold: the owner key, the relay, the
//! resident registry, and the room's membership. They are gathered here so the
//! resolver can be exercised offline, and so there is exactly one place where
//! "the desktop asked the relay" happens.
//!
//! Everything fails closed. A transport error, an unparseable record, a
//! malformed turn tag, or a relay that does not understand the `#exchange`
//! filter yet all produce [`ExchangeRelayError`], and every caller turns that
//! into a refusal rather than an untagged publication.

use std::collections::BTreeSet;

use luca_protocol::{ExchangeRecordV1, ExchangeTurnTag, Hex64, OpaqueId};
use nostr::{EventBuilder, Kind, Tag, Timestamp};
use tauri::{AppHandle, Manager};
use zeroize::Zeroize;

use super::exchange_store::ExchangeHead;

/// Largest number of tagged messages the spent-turn read will consider.
///
/// The ceiling is ten turns, so a well-formed exchange cannot exceed it; the
/// slack absorbs owner-authored or junk-tagged rows the relay's own recheck
/// already discards.
const MAX_SPENT_TURN_ROWS: usize = 64;

/// Why an owner-authority operation could not be completed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ExchangeRelayError {
    /// The lookup or write could not be performed at all.
    Unavailable(String),
    /// The relay answered, and its answer was "no".
    Refused(String),
}

impl std::fmt::Display for ExchangeRelayError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unavailable(reason) => {
                write!(formatter, "exchange authority unavailable: {reason}")
            }
            Self::Refused(reason) => write!(formatter, "exchange authority refused: {reason}"),
        }
    }
}

impl std::error::Error for ExchangeRelayError {}

/// The owner-side operations the exchange resolver performs.
pub(crate) trait ExchangeRelay: Send {
    /// The current owner-authored head for `exchange_id`, or `None` when the
    /// relay holds no record this owner signed.
    fn fetch_head(
        &self,
        exchange_id: &Hex64,
        owner: &Hex64,
    ) -> Result<Option<ExchangeHead>, ExchangeRelayError>;

    /// The exact set of turns already spoken inside `record`.
    ///
    /// This is a set, not a count: the desktop needs the next *free* turn, and
    /// deleted turns stay spent, so a bare cardinality cannot answer it.
    fn spent_turns(&self, record: &ExchangeRecordV1) -> Result<BTreeSet<u8>, ExchangeRelayError>;

    /// The exact signed kind-9 event `event_id`, when the relay holds it.
    ///
    /// Used to stage a wake dispatch from a turn's own trigger — the event is
    /// the authority; the dispatch row is bookkeeping derived from it.
    fn fetch_trigger(&self, event_id: &Hex64) -> Result<Option<nostr::Event>, ExchangeRelayError>;

    /// The owner of this house.
    fn owner(&self) -> Result<Hex64, ExchangeRelayError>;

    /// Publish the owner-signed exchange record and wait for the relay's OK.
    fn publish_record(
        &self,
        record: &ExchangeRecordV1,
        created_at: u64,
    ) -> Result<Hex64, ExchangeRelayError>;

    /// Publish one owner-signed exchange-note into the room.
    fn publish_note(
        &self,
        conversation_id: &OpaqueId,
        content: &str,
    ) -> Result<(), ExchangeRelayError>;

    /// Add a same-owner resident to a room as an ordinary visiting member.
    fn add_conversation_member(
        &self,
        _conversation_id: &OpaqueId,
        _resident: &Hex64,
    ) -> Result<(), ExchangeRelayError> {
        Err(ExchangeRelayError::Unavailable(
            "visit membership add is unavailable".to_owned(),
        ))
    }

    /// Remove a visiting resident through the room's ordinary member path.
    fn remove_conversation_member(
        &self,
        _conversation_id: &OpaqueId,
        _resident: &Hex64,
    ) -> Result<(), ExchangeRelayError> {
        Err(ExchangeRelayError::Unavailable(
            "visit membership removal is unavailable".to_owned(),
        ))
    }

    /// Everyone currently in `conversation_id` — channel members and DM
    /// participants alike.
    fn conversation_members(
        &self,
        conversation_id: &OpaqueId,
    ) -> Result<BTreeSet<Hex64>, ExchangeRelayError>;

    /// Residents this desktop holds verified keys for.
    fn owned_residents(&self) -> Result<BTreeSet<Hex64>, ExchangeRelayError>;

    /// Resolve a read-only mention snapshot; legacy implementations retain token scanning.
    fn resolve_resident_mentions(
        &self,
        owned: &BTreeSet<Hex64>,
        _owner: &Hex64,
        draft: &str,
    ) -> Result<Vec<(String, Hex64)>, ExchangeRelayError> {
        let mut resolved = Vec::new();
        for name in super::exchange_plan::mentioned_names(draft) {
            if let Some(pubkey) = self.resolve_resident_name(owned, &name)? {
                resolved.push((name, pubkey));
            }
        }
        Ok(resolved)
    }

    /// Resolve one `@Name` against the resident registry. An unknown or
    /// ambiguous name is `Ok(None)` — not an error, just not a resident.
    fn resolve_resident_name(
        &self,
        owned: &BTreeSet<Hex64>,
        name: &str,
    ) -> Result<Option<Hex64>, ExchangeRelayError>;

    /// A human name for `pubkey`, for the sentence written into the room.
    fn display_name(&self, pubkey: &Hex64) -> String;
}

/// The production implementation: the owner's keys, the owner's relay.
pub(crate) struct AppExchangeRelay {
    app: AppHandle,
}

impl AppExchangeRelay {
    /// Bind the exchange authority to the running application.
    pub(crate) fn new(app: AppHandle) -> Self {
        Self { app }
    }

    fn query(
        &self,
        filters: &[serde_json::Value],
    ) -> Result<Vec<nostr::Event>, ExchangeRelayError> {
        let state = self.app.state::<crate::app_state::AppState>();
        tauri::async_runtime::block_on(crate::relay::query_relay(&state, filters))
            .map_err(ExchangeRelayError::Unavailable)
    }

    fn submit(&self, builder: EventBuilder) -> Result<Hex64, ExchangeRelayError> {
        let state = self.app.state::<crate::app_state::AppState>();
        let response = tauri::async_runtime::block_on(crate::relay::submit_event(builder, &state))
            .map_err(ExchangeRelayError::Refused)?;
        Hex64::parse(response.event_id).map_err(|error| {
            ExchangeRelayError::Unavailable(format!("relay returned an invalid event id: {error}"))
        })
    }
}

// The HTTP query deserializes full events; it does not authenticate them.
// Owner-authority decisions must validate the envelope before trusting its body.
fn verified_exchange_head(
    event: &nostr::Event,
    exchange_id: &Hex64,
    owner: &Hex64,
) -> Result<ExchangeHead, ExchangeRelayError> {
    if event.kind != Kind::Custom(buzz_core_pkg::kind::KIND_LUCA_EXCHANGE as u16)
        || !event.verify_id()
        || !event.verify_signature()
        || event.pubkey.to_hex() != owner.as_str()
    {
        return Err(ExchangeRelayError::Unavailable(
            "exchange owner signature is invalid".into(),
        ));
    }
    let record = ExchangeRecordV1::from_content(&event.content).map_err(|_| {
        ExchangeRelayError::Unavailable("exchange record content is invalid".into())
    })?;
    if &record.exchange_id != exchange_id || &record.owner != owner {
        return Err(ExchangeRelayError::Unavailable(
            "exchange record does not match the requested id".into(),
        ));
    }
    let mut actual = Vec::new();
    for tag in event.tags.iter() {
        let values = tag.as_slice();
        if matches!(values.first().map(String::as_str), Some("d" | "p")) {
            if values.len() < 2 {
                return Err(ExchangeRelayError::Unavailable(
                    "exchange record tag is malformed".into(),
                ));
            }
            actual.push(values[..2].to_vec());
        }
    }
    let mut required = record.event_tags();
    actual.sort();
    required.sort();
    if actual != required {
        return Err(ExchangeRelayError::Unavailable(
            "exchange record tags do not match its data".into(),
        ));
    }
    Ok(ExchangeHead {
        record,
        created_at: event.created_at.as_secs(),
        event_id: Hex64::parse(event.id.to_hex()).map_err(|_| {
            ExchangeRelayError::Unavailable("exchange record event id is invalid".into())
        })?,
    })
}

impl ExchangeRelay for AppExchangeRelay {
    fn fetch_head(
        &self,
        exchange_id: &Hex64,
        owner: &Hex64,
    ) -> Result<Option<ExchangeHead>, ExchangeRelayError> {
        let events = self.query(&[serde_json::json!({
            "kinds": [buzz_core_pkg::kind::KIND_LUCA_EXCHANGE],
            "#d": [exchange_id.as_str()],
            "authors": [owner.as_str()],
            "limit": 1,
        })])?;
        let Some(event) = events.first() else {
            return Ok(None);
        };
        verified_exchange_head(event, exchange_id, owner).map(Some)
    }

    fn fetch_trigger(&self, event_id: &Hex64) -> Result<Option<nostr::Event>, ExchangeRelayError> {
        let events = self.query(&[serde_json::json!({
            "ids": [event_id.as_str()],
            "kinds": [buzz_core_pkg::kind::KIND_STREAM_MESSAGE],
            "limit": 1,
        })])?;
        Ok(events.into_iter().next())
    }

    fn owner(&self) -> Result<Hex64, ExchangeRelayError> {
        let state = self.app.state::<crate::app_state::AppState>();
        let keys = state
            .signing_keys()
            .map_err(ExchangeRelayError::Unavailable)?;
        Hex64::parse(keys.public_key().to_hex()).map_err(|error| {
            ExchangeRelayError::Unavailable(format!("owner key is invalid: {error}"))
        })
    }

    fn spent_turns(&self, record: &ExchangeRecordV1) -> Result<BTreeSet<u8>, ExchangeRelayError> {
        let members: Vec<&str> = record.members.iter().map(Hex64::as_str).collect();
        // Scoped to the members so an owner-authored tagged message — accepted
        // by the relay, never counted — cannot inflate the number, and to the
        // room so a stray tag elsewhere cannot either.
        let events = self.query(&[serde_json::json!({
            "kinds": [buzz_core_pkg::kind::KIND_STREAM_MESSAGE],
            "#exchange": [record.exchange_id.as_str()],
            "#h": [record.conversation_id.as_str()],
            "authors": members,
            "limit": MAX_SPENT_TURN_ROWS,
        })])?;
        let mut spent = BTreeSet::new();
        for event in &events {
            let tags: Vec<Vec<String>> = event
                .tags
                .iter()
                .map(|tag| tag.as_slice().to_vec())
                .collect();
            // The containment prefilter is set-like, so every candidate row is
            // re-parsed here. A malformed tag is an error, never an omission.
            match ExchangeTurnTag::find(&tags) {
                Ok(Some(tag)) if tag.exchange_id == record.exchange_id => {
                    spent.insert(tag.turn);
                }
                Ok(_) => {
                    return Err(ExchangeRelayError::Unavailable(
                        "relay returned a row without this exchange's turn tag".to_owned(),
                    ));
                }
                Err(error) => {
                    return Err(ExchangeRelayError::Unavailable(format!(
                        "relay returned a malformed exchange turn tag: {error}"
                    )));
                }
            }
        }
        Ok(spent)
    }

    fn publish_record(
        &self,
        record: &ExchangeRecordV1,
        created_at: u64,
    ) -> Result<Hex64, ExchangeRelayError> {
        let content = record.to_content().map_err(|error| {
            ExchangeRelayError::Unavailable(format!("exchange record is not canonical: {error}"))
        })?;
        let mut tags = Vec::new();
        for raw in record.event_tags() {
            tags.push(Tag::parse(raw).map_err(|error| {
                ExchangeRelayError::Unavailable(format!("exchange record tag is invalid: {error}"))
            })?);
        }
        let builder = EventBuilder::new(
            Kind::Custom(buzz_core_pkg::kind::KIND_LUCA_EXCHANGE as u16),
            content,
        )
        .tags(tags)
        .custom_created_at(Timestamp::from(created_at));
        self.submit(builder)
    }

    fn publish_note(
        &self,
        conversation_id: &OpaqueId,
        content: &str,
    ) -> Result<(), ExchangeRelayError> {
        // The room's system voice is relay-signed, so the note is a command:
        // the relay validates it and answers with its own kind-40099. A
        // duplicate submission says nothing twice.
        let tag = Tag::parse(["h", conversation_id.as_str()]).map_err(|error| {
            ExchangeRelayError::Unavailable(format!("exchange note tag is invalid: {error}"))
        })?;
        let builder = EventBuilder::new(
            Kind::Custom(buzz_core_pkg::kind::KIND_LUCA_EXCHANGE_NOTE as u16),
            content.to_owned(),
        )
        .tags([tag]);
        self.submit(builder).map(|_| ())
    }

    fn add_conversation_member(
        &self,
        conversation_id: &OpaqueId,
        resident: &Hex64,
    ) -> Result<(), ExchangeRelayError> {
        let channel_id = uuid::Uuid::parse_str(conversation_id.as_str()).map_err(|error| {
            ExchangeRelayError::Unavailable(format!("visit room id is invalid: {error}"))
        })?;
        let builder = crate::events::build_add_member(channel_id, resident.as_str(), Some("guest"))
            .map_err(|error| {
                ExchangeRelayError::Unavailable(format!("visit membership is invalid: {error}"))
            })?;
        self.submit(builder).map(|_| ())
    }

    fn remove_conversation_member(
        &self,
        conversation_id: &OpaqueId,
        resident: &Hex64,
    ) -> Result<(), ExchangeRelayError> {
        let channel_id = uuid::Uuid::parse_str(conversation_id.as_str()).map_err(|error| {
            ExchangeRelayError::Unavailable(format!("visit room id is invalid: {error}"))
        })?;
        let builder =
            crate::events::build_remove_member(channel_id, resident.as_str()).map_err(|error| {
                ExchangeRelayError::Unavailable(format!("visit membership is invalid: {error}"))
            })?;
        self.submit(builder).map(|_| ())
    }

    fn conversation_members(
        &self,
        conversation_id: &OpaqueId,
    ) -> Result<BTreeSet<Hex64>, ExchangeRelayError> {
        // 39002 carries a channel's member list; 39000 carries a DM's
        // participants. One read covers both room shapes.
        let events = self.query(&[serde_json::json!({
            "kinds": [39000, 39002],
            "#d": [conversation_id.as_str()],
            "limit": 8,
        })])?;
        if events.is_empty() {
            return Err(ExchangeRelayError::Unavailable(
                "conversation membership is unknown".to_owned(),
            ));
        }
        let mut members = BTreeSet::new();
        for event in &events {
            for tag in event.tags.iter() {
                let parts = tag.as_slice();
                if parts.len() >= 2 && parts[0] == "p" {
                    if let Ok(pubkey) = Hex64::parse(parts[1].to_ascii_lowercase()) {
                        members.insert(pubkey);
                    }
                }
            }
        }
        Ok(members)
    }

    fn owned_residents(&self) -> Result<BTreeSet<Hex64>, ExchangeRelayError> {
        verified_owned_residents(&self.app)
    }

    fn resolve_resident_mentions(
        &self,
        owned: &BTreeSet<Hex64>,
        owner: &Hex64,
        draft: &str,
    ) -> Result<Vec<(String, Hex64)>, ExchangeRelayError> {
        super::resident_registry::read_owned_resident_mentions(&self.app, owned, owner, draft)
            .map_err(|_| {
                ExchangeRelayError::Unavailable("resident mention inventory is unavailable".into())
            })
    }

    fn resolve_resident_name(
        &self,
        owned: &BTreeSet<Hex64>,
        name: &str,
    ) -> Result<Option<Hex64>, ExchangeRelayError> {
        use super::resident_registry::ResidentNameResolutionError;
        match super::resident_registry::resolve_owned_resident_name(&self.app, owned, name) {
            Ok(pubkey) => Ok(Some(pubkey)),
            Err(
                ResidentNameResolutionError::NotFound
                | ResidentNameResolutionError::Ambiguous
                | ResidentNameResolutionError::Invalid,
            ) => Ok(None),
            Err(ResidentNameResolutionError::Unavailable) => Err(ExchangeRelayError::Unavailable(
                "resident registry is unavailable".to_owned(),
            )),
        }
    }

    fn display_name(&self, pubkey: &Hex64) -> String {
        let Ok(mut records) = crate::managed_agents::load_managed_agents(&self.app) else {
            return short_name(pubkey);
        };
        let resolved = records
            .iter()
            .find(|record| record.pubkey.eq_ignore_ascii_case(pubkey.as_str()))
            .map(|record| {
                record
                    .display_name
                    .clone()
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or_else(|| record.name.clone())
            })
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| short_name(pubkey));
        for record in &mut records {
            record.private_key_nsec.zeroize();
        }
        resolved
    }
}

/// A last-resort human label when no registry name is available.
fn short_name(pubkey: &Hex64) -> String {
    format!("resident {}", &pubkey.as_str()[..8])
}

/// Residents this desktop holds a private key for and can prove it.
///
/// Deliberately narrower than "every managed agent record": a record whose
/// stored secret does not derive its own public key is not an owned resident,
/// and must never become a member of an exchange.
fn verified_owned_residents(app: &AppHandle) -> Result<BTreeSet<Hex64>, ExchangeRelayError> {
    let mut records = crate::managed_agents::load_managed_agents(app).map_err(|error| {
        ExchangeRelayError::Unavailable(format!("managed agent registry is unavailable: {error}"))
    })?;
    let mut verified = BTreeSet::new();
    for record in &records {
        if record.pubkey.is_empty() || record.private_key_nsec.is_empty() {
            continue;
        }
        let Ok(pubkey) = Hex64::parse(record.pubkey.to_ascii_lowercase()) else {
            continue;
        };
        let Ok(keys) = nostr::Keys::parse(record.private_key_nsec.trim()) else {
            continue;
        };
        if keys.public_key().to_hex() == pubkey.as_str() {
            verified.insert(pubkey);
        }
    }
    for record in &mut records {
        record.private_key_nsec.zeroize();
    }
    Ok(verified)
}

#[cfg(test)]
mod verified_head_tests {
    use super::*;
    use nostr::{Event, EventId, Keys};

    fn fixture() -> (Keys, ExchangeRecordV1) {
        let owner = Keys::parse(&"71".repeat(32)).expect("synthetic owner");
        let resident = Keys::parse(&"72".repeat(32)).expect("synthetic resident");
        let worker = Keys::parse(&"73".repeat(32)).expect("synthetic worker");
        let resident = Hex64::parse(resident.public_key().to_hex()).expect("resident");
        let record = ExchangeRecordV1::open(
            Hex64::parse(owner.public_key().to_hex()).expect("owner"),
            vec![
                resident.clone(),
                Hex64::parse(worker.public_key().to_hex()).expect("worker"),
            ],
            OpaqueId::parse("11111111-1111-4111-8111-111111111111").expect("room"),
            Hex64::parse("ab".repeat(32)).expect("root"),
            resident,
            None,
            100,
        )
        .expect("pair");
        (owner, record)
    }

    fn signed(
        owner: &Keys,
        record: &ExchangeRecordV1,
        kind: Kind,
        tags: Vec<Vec<String>>,
    ) -> Event {
        EventBuilder::new(kind, record.to_content().expect("content"))
            .tags(tags.into_iter().map(|tag| Tag::parse(tag).expect("tag")))
            .custom_created_at(Timestamp::from(100))
            .sign_with_keys(owner)
            .expect("sign")
    }

    #[test]
    fn owner_head_accepts_only_authenticated_matching_record_and_envelope() {
        let (owner, record) = fixture();
        let kind = Kind::Custom(buzz_core_pkg::kind::KIND_LUCA_EXCHANGE as u16);
        let event = signed(&owner, &record, kind, record.event_tags());
        let head = verified_exchange_head(&event, &record.exchange_id, &record.owner)
            .expect("signed matching head");
        assert_eq!(head.record, record);
        assert_eq!(head.event_id.as_str(), event.id.to_hex());
        for failure in [
            "id",
            "body",
            "signature",
            "kind",
            "owner",
            "lookup id",
            "d tag",
            "member",
            "duplicate",
            "malformed",
        ] {
            let mut candidate = event.clone();
            let mut lookup = record.exchange_id.clone();
            match failure {
                "id" => candidate.id = EventId::from_hex(&"fe".repeat(32)).expect("id"),
                "body" => candidate.content.push(' '),
                "signature" => {
                    candidate.sig = signed(
                        &Keys::parse(&"74".repeat(32)).expect("other signer"),
                        &record,
                        kind,
                        record.event_tags(),
                    )
                    .sig
                }
                "kind" => candidate = signed(&owner, &record, Kind::Custom(9), record.event_tags()),
                "owner" => {
                    candidate = signed(
                        &Keys::parse(&"74".repeat(32)).expect("other signer"),
                        &record,
                        kind,
                        record.event_tags(),
                    )
                }
                "lookup id" => lookup = Hex64::parse("ef".repeat(32)).expect("different id"),
                _ => {
                    let mut tags = record.event_tags();
                    match failure {
                        "d tag" => tags[0][1] = "ef".repeat(32),
                        "member" => {
                            tags.pop();
                        }
                        "duplicate" => tags.push(tags[0].clone()),
                        _ => tags.push(vec!["p".into()]),
                    }
                    candidate = signed(&owner, &record, kind, tags);
                }
            }
            assert!(
                verified_exchange_head(&candidate, &lookup, &record.owner).is_err(),
                "{failure}"
            );
        }
    }
}
