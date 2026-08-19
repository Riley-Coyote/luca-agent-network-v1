//! The exchange: one bounded resident↔resident conversation in the owner's house.
//!
//! An exchange is a relay object, not a counter in a UI. It has an id, its
//! members, a turn bucket (default 3, a hard ceiling of 10 that no signature
//! raises), a depth (a delegated resident may delegate one hop further; deeper
//! needs the owner), a state (`open` | `closed`) and a deadline. Two things are
//! deliberately *derived* and never written: `spent` (the relay counts accepted
//! kind:9 events carrying the turn tag) and `paused` (spent ≥ bucket while
//! open). One writer — the owner — touches the record, at mint, Stop, and Go.
//!
//! On the wire the record is `KIND_LUCA_EXCHANGE` (30178, parameterized
//! replaceable, global): `["d", exchange_id]`, one `["p", member]` per member,
//! content = the canonical JSON of [`ExchangeRecordV1`]. Every resident-authored
//! kind:9 inside the exchange carries `["exchange", <id>, <turn>]`
//! ([`ExchangeTurnTag`]). Owner messages never carry it and never count.
//!
//! This module holds the shape and the derivations only. Enforcement lives in
//! the relay (rejects exhausted / closed / expired / already-spoken turns), the
//! harness (a sibling's event fires a turn only inside a speakable exchange) and
//! the desktop (mints, tags, and refuses before the relay has to).

use crate::{Hex64, OpaqueId, ProtocolValueError, SafeU53};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};

/// Exchange record protocol identifier.
pub const EXCHANGE_PROTOCOL: &str = "luca.exchange.v1";
/// Tag name carried by every resident-authored message inside an exchange:
/// `["exchange", <exchange_id>, <turn>]`.
pub const EXCHANGE_TAG: &str = "exchange";
/// Turns one owner utterance mints by default.
pub const EXCHANGE_DEFAULT_BUCKET: u8 = 3;
/// The hard ceiling. Speech cannot raise it; neither can an owner signature.
pub const EXCHANGE_BUCKET_CEILING: u8 = 10;
/// Turns "Let them go on" adds, capped at the ceiling.
pub const EXCHANGE_GO_INCREMENT: u8 = 3;
/// A delegated resident may delegate one hop further. Deeper needs the owner.
pub const EXCHANGE_MAX_DEPTH: u8 = 2;
/// Smallest exchange: two residents.
pub const EXCHANGE_MIN_MEMBERS: usize = 2;
/// Bounded member set. Rooms are small; a house is not a crowd.
pub const EXCHANGE_MAX_MEMBERS: usize = 16;
/// Default lifetime of an exchange from mint (seconds). Go extends it by the same.
pub const EXCHANGE_DEFAULT_TTL_SECS: u64 = 30 * 60;

/// Validation failure for an exchange record or turn tag.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ExchangeError {
    /// A validated scalar was invalid.
    #[error(transparent)]
    Value(#[from] ProtocolValueError),
    /// The record named the wrong protocol.
    #[error("protocol must be luca.exchange.v1")]
    Protocol,
    /// Members must be 2..=16 residents, sorted, unique, and never the owner.
    #[error("members must be 2..=16 unique sorted resident pubkeys excluding the owner")]
    Members,
    /// `opened_by` must be one of the members.
    #[error("opened_by must be a member")]
    OpenedBy,
    /// Bucket must be 1..=10.
    #[error("bucket must be 1..=10")]
    Bucket,
    /// Depth must be 1 or 2; depth 2 requires a parent, depth 1 forbids one.
    #[error("depth must be 1 or 2, with a parent exactly when depth is 2")]
    Depth,
    /// The exchange id does not re-derive from root, members and parent.
    #[error("exchange_id does not match derive_exchange_id(root, members, parent)")]
    Id,
    /// A turn tag was malformed or out of range.
    #[error("exchange turn tag must be [\"exchange\", <hex64>, <1..=10>]")]
    TurnTag,
}

/// Written state of an exchange. `paused` is derived, never written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExchangeStateV1 {
    /// Turns may still be spoken while the bucket lasts.
    Open,
    /// The owner said "Stop here" — no further turn is accepted.
    Closed,
}

/// The lived phase of an exchange, derived from the record plus what the relay
/// has counted. This is what a strip renders and what a gate checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExchangePhase {
    /// Open, unexpired, and turns remain.
    Open,
    /// Open and unexpired, but the bucket is spent — waiting on the owner.
    Paused,
    /// The owner stopped it.
    Closed,
    /// The deadline passed while it was still open.
    Expired,
}

/// The exchange record — content of a `KIND_LUCA_EXCHANGE` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExchangeRecordV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// `derive_exchange_id(root_event_id, members, parent_exchange_id)`; also the `d` tag.
    pub exchange_id: Hex64,
    /// The owner of the house. The only author the relay accepts for this record.
    pub owner: Hex64,
    /// Resident members, sorted and unique, excluding the owner. Each is a `p` tag.
    pub members: Vec<Hex64>,
    /// The conversation (channel) the exchange lives in.
    pub conversation_id: OpaqueId,
    /// The owner utterance that minted the budget (or the opening event when
    /// no owner utterance is on the causal path).
    pub root_event_id: Hex64,
    /// Present exactly when `depth == 2`: the depth-1 exchange this hangs off.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_exchange_id: Option<Hex64>,
    /// 1 for an exchange opened from an owner-triggered turn, 2 for one hop further.
    pub depth: u8,
    /// Turns this exchange may spend in total. 1..=10.
    pub bucket: u8,
    /// Written state. `paused` is derived from `spent` and never stored.
    pub state: ExchangeStateV1,
    /// Unix seconds after which no further turn is accepted.
    pub deadline: SafeU53,
    /// The member whose message opened the exchange (turn 1).
    pub opened_by: Hex64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawExchangeRecordV1 {
    protocol: String,
    exchange_id: Hex64,
    owner: Hex64,
    members: Vec<Hex64>,
    conversation_id: OpaqueId,
    root_event_id: Hex64,
    parent_exchange_id: Option<Hex64>,
    depth: u8,
    bucket: u8,
    state: ExchangeStateV1,
    deadline: SafeU53,
    opened_by: Hex64,
}

impl ExchangeRecordV1 {
    /// Open a new depth-1 exchange from an owner-triggered turn.
    ///
    /// `bucket_hint` is clamped to the ceiling; `None` means the default 3.
    /// `members` may arrive in any order and may repeat; they are normalised.
    /// The opener must be among the members. Fails closed on any bound.
    #[allow(clippy::too_many_arguments)]
    pub fn open(
        owner: Hex64,
        members: Vec<Hex64>,
        conversation_id: OpaqueId,
        root_event_id: Hex64,
        opened_by: Hex64,
        bucket_hint: Option<u8>,
        now_unix: u64,
    ) -> Result<Self, ExchangeError> {
        Self::open_at_depth(
            owner,
            members,
            conversation_id,
            root_event_id,
            None,
            opened_by,
            bucket_hint,
            now_unix,
        )
    }

    /// Open a depth-2 exchange hanging off `parent`. Same normalisation as [`Self::open`].
    #[allow(clippy::too_many_arguments)]
    pub fn open_child(
        parent: &ExchangeRecordV1,
        members: Vec<Hex64>,
        conversation_id: OpaqueId,
        root_event_id: Hex64,
        opened_by: Hex64,
        bucket_hint: Option<u8>,
        now_unix: u64,
    ) -> Result<Self, ExchangeError> {
        if parent.depth != 1 {
            return Err(ExchangeError::Depth);
        }
        Self::open_at_depth(
            parent.owner.clone(),
            members,
            conversation_id,
            root_event_id,
            Some(parent.exchange_id.clone()),
            opened_by,
            bucket_hint,
            now_unix,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn open_at_depth(
        owner: Hex64,
        mut members: Vec<Hex64>,
        conversation_id: OpaqueId,
        root_event_id: Hex64,
        parent_exchange_id: Option<Hex64>,
        opened_by: Hex64,
        bucket_hint: Option<u8>,
        now_unix: u64,
    ) -> Result<Self, ExchangeError> {
        members.sort();
        members.dedup();
        let depth = if parent_exchange_id.is_some() { 2 } else { 1 };
        let bucket = bucket_hint
            .unwrap_or(EXCHANGE_DEFAULT_BUCKET)
            .clamp(1, EXCHANGE_BUCKET_CEILING);
        let deadline = SafeU53::new(now_unix.saturating_add(EXCHANGE_DEFAULT_TTL_SECS))?;
        let exchange_id =
            derive_exchange_id(&root_event_id, &members, parent_exchange_id.as_ref())?;
        let record = Self {
            protocol: EXCHANGE_PROTOCOL.to_owned(),
            exchange_id,
            owner,
            members,
            conversation_id,
            root_event_id,
            parent_exchange_id,
            depth,
            bucket,
            state: ExchangeStateV1::Open,
            deadline,
            opened_by,
        };
        record.validate()?;
        Ok(record)
    }

    /// Validate every invariant, including that the id re-derives.
    pub fn validate(&self) -> Result<(), ExchangeError> {
        if self.protocol != EXCHANGE_PROTOCOL {
            return Err(ExchangeError::Protocol);
        }
        if self.members.len() < EXCHANGE_MIN_MEMBERS
            || self.members.len() > EXCHANGE_MAX_MEMBERS
            || self.members.windows(2).any(|pair| pair[0] >= pair[1])
            || self.members.contains(&self.owner)
        {
            return Err(ExchangeError::Members);
        }
        if !self.members.contains(&self.opened_by) {
            return Err(ExchangeError::OpenedBy);
        }
        if self.bucket == 0 || self.bucket > EXCHANGE_BUCKET_CEILING {
            return Err(ExchangeError::Bucket);
        }
        match (self.depth, &self.parent_exchange_id) {
            (1, None) | (2, Some(_)) => {}
            _ => return Err(ExchangeError::Depth),
        }
        let expected = derive_exchange_id(
            &self.root_event_id,
            &self.members,
            self.parent_exchange_id.as_ref(),
        )?;
        if expected != self.exchange_id {
            return Err(ExchangeError::Id);
        }
        Ok(())
    }

    /// Is `pubkey` a member (the owner is never a member; owner messages don't count)?
    pub fn is_member(&self, pubkey: &Hex64) -> bool {
        self.members.binary_search(pubkey).is_ok()
    }

    /// Turns still speakable given what the relay has counted.
    pub fn remaining(&self, spent: u8) -> u8 {
        self.bucket.saturating_sub(spent)
    }

    /// The lived phase, given the counted `spent` and the current unix time.
    pub fn phase(&self, spent: u8, now_unix: u64) -> ExchangePhase {
        match self.state {
            ExchangeStateV1::Closed => ExchangePhase::Closed,
            ExchangeStateV1::Open if now_unix > self.deadline.get() => ExchangePhase::Expired,
            ExchangeStateV1::Open if spent >= self.bucket => ExchangePhase::Paused,
            ExchangeStateV1::Open => ExchangePhase::Open,
        }
    }

    /// May a member publish `turn` right now? Pure bucket/state/deadline check —
    /// duplicate-turn detection is the relay's (it holds the count).
    pub fn admits_turn(&self, turn: u8, now_unix: u64) -> bool {
        self.state == ExchangeStateV1::Open
            && now_unix <= self.deadline.get()
            && turn >= 1
            && turn <= self.bucket
    }

    /// "Stop here": the record the owner re-signs. Idempotent.
    pub fn stopped(&self) -> Self {
        Self {
            state: ExchangeStateV1::Closed,
            ..self.clone()
        }
    }

    /// "Let them go on": three more turns (never past the ceiling) and a fresh
    /// deadline. Returns `None` at the ceiling — the button should be disabled.
    pub fn continued(&self, now_unix: u64) -> Result<Option<Self>, ExchangeError> {
        if self.bucket >= EXCHANGE_BUCKET_CEILING {
            return Ok(None);
        }
        let bucket = self
            .bucket
            .saturating_add(EXCHANGE_GO_INCREMENT)
            .min(EXCHANGE_BUCKET_CEILING);
        let deadline = SafeU53::new(now_unix.saturating_add(EXCHANGE_DEFAULT_TTL_SECS))?;
        Ok(Some(Self {
            bucket,
            deadline,
            state: ExchangeStateV1::Open,
            ..self.clone()
        }))
    }

    /// The `d` tag plus one `p` tag per member, in that order.
    pub fn event_tags(&self) -> Vec<Vec<String>> {
        let mut tags = Vec::with_capacity(1 + self.members.len());
        tags.push(vec!["d".to_owned(), self.exchange_id.as_str().to_owned()]);
        for member in &self.members {
            tags.push(vec!["p".to_owned(), member.as_str().to_owned()]);
        }
        tags
    }

    /// Canonical JSON content for the relay event.
    pub fn to_content(&self) -> Result<String, crate::CanonicalError> {
        let bytes = crate::canonicalize(self)?;
        String::from_utf8(bytes)
            .map_err(|_| crate::CanonicalError::InvalidJson("non-UTF-8 canonical bytes".into()))
    }

    /// Parse and validate a record from relay event content.
    pub fn from_content(content: &str) -> Result<Self, ExchangeError> {
        serde_json::from_str::<Self>(content)
            .map_err(|_| ExchangeError::Protocol)
            .and_then(|record| {
                record.validate()?;
                Ok(record)
            })
    }
}

impl<'de> Deserialize<'de> for ExchangeRecordV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawExchangeRecordV1::deserialize(deserializer)?;
        let record = Self {
            protocol: raw.protocol,
            exchange_id: raw.exchange_id,
            owner: raw.owner,
            members: raw.members,
            conversation_id: raw.conversation_id,
            root_event_id: raw.root_event_id,
            parent_exchange_id: raw.parent_exchange_id,
            depth: raw.depth,
            bucket: raw.bucket,
            state: raw.state,
            deadline: raw.deadline,
            opened_by: raw.opened_by,
        };
        record.validate().map_err(serde::de::Error::custom)?;
        Ok(record)
    }
}

/// Derive the exchange id: SHA-256 over a domain tag, the root event id, the
/// length-prefixed sorted member set, and the optional parent id.
///
/// Deterministic on purpose — a crashed mint replays to the same id and the
/// relay's NIP-33 LWW swallows the duplicate record. `members` must already be
/// sorted and unique (the record constructor normalises; callers deriving an
/// id by hand must too).
pub fn derive_exchange_id(
    root_event_id: &Hex64,
    members: &[Hex64],
    parent_exchange_id: Option<&Hex64>,
) -> Result<Hex64, ExchangeError> {
    if members.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(ExchangeError::Members);
    }
    let member_count = u32::try_from(members.len()).map_err(|_| ExchangeError::Members)?;
    let mut hasher = Sha256::new();
    hasher.update(b"luca.exchange.id.v1\0");
    hasher.update(root_event_id.decode()?);
    hasher.update(member_count.to_be_bytes());
    for member in members {
        hasher.update(member.decode()?);
    }
    match parent_exchange_id {
        Some(parent) => {
            hasher.update([1u8]);
            hasher.update(parent.decode()?);
        }
        None => hasher.update([0u8]),
    }
    Ok(Hex64::parse(hex::encode(hasher.finalize()))?)
}

/// The turn tag on a resident-authored message: `["exchange", <id>, <turn>]`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExchangeTurnTag {
    /// The exchange this message spends a turn of.
    pub exchange_id: Hex64,
    /// 1-based turn number, at most the ceiling.
    pub turn: u8,
}

impl ExchangeTurnTag {
    /// Construct, refusing turns outside 1..=10.
    pub fn new(exchange_id: Hex64, turn: u8) -> Result<Self, ExchangeError> {
        if turn == 0 || turn > EXCHANGE_BUCKET_CEILING {
            return Err(ExchangeError::TurnTag);
        }
        Ok(Self { exchange_id, turn })
    }

    /// Parse from a raw tag (`["exchange", id, turn]`). `None` for any other tag
    /// name; `Err` when the name matches but the shape doesn't — a malformed
    /// exchange tag must be rejected, not ignored.
    pub fn parse_tag(tag: &[String]) -> Option<Result<Self, ExchangeError>> {
        if tag.first().map(String::as_str) != Some(EXCHANGE_TAG) {
            return None;
        }
        Some(Self::parse_tag_body(tag))
    }

    fn parse_tag_body(tag: &[String]) -> Result<Self, ExchangeError> {
        if tag.len() != 3 {
            return Err(ExchangeError::TurnTag);
        }
        let exchange_id = Hex64::parse(tag[1].clone()).map_err(|_| ExchangeError::TurnTag)?;
        let turn = tag[2].parse::<u8>().map_err(|_| ExchangeError::TurnTag)?;
        Self::new(exchange_id, turn)
    }

    /// Find the exchange tag among an event's tags. `Ok(None)` when absent,
    /// `Err` when present but malformed or when more than one is present (one
    /// exchange per message in this version).
    pub fn find(tags: &[Vec<String>]) -> Result<Option<Self>, ExchangeError> {
        let mut found = None;
        for tag in tags {
            if let Some(parsed) = Self::parse_tag(tag) {
                if found.is_some() {
                    return Err(ExchangeError::TurnTag);
                }
                found = Some(parsed?);
            }
        }
        Ok(found)
    }

    /// Render as a raw tag.
    pub fn to_tag(&self) -> Vec<String> {
        vec![
            EXCHANGE_TAG.to_owned(),
            self.exchange_id.as_str().to_owned(),
            self.turn.to_string(),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const LUCA: &str = "2222222222222222222222222222222222222222222222222222222222222222";
    const VEKTOR: &str = "3333333333333333333333333333333333333333333333333333333333333333";
    const KAI: &str = "4444444444444444444444444444444444444444444444444444444444444444";
    const ROOT: &str = "abababababababababababababababababababababababababababababababab";

    fn hex(value: &str) -> Hex64 {
        Hex64::parse(value).unwrap()
    }

    fn opened(bucket_hint: Option<u8>) -> ExchangeRecordV1 {
        ExchangeRecordV1::open(
            hex(OWNER),
            vec![hex(VEKTOR), hex(LUCA)],
            OpaqueId::parse("conv-1").unwrap(),
            hex(ROOT),
            hex(LUCA),
            bucket_hint,
            1_000_000,
        )
        .unwrap()
    }

    #[test]
    fn open_normalises_members_and_defaults_bucket_and_deadline() {
        let record = opened(None);
        assert_eq!(record.members, vec![hex(LUCA), hex(VEKTOR)]);
        assert_eq!(record.bucket, EXCHANGE_DEFAULT_BUCKET);
        assert_eq!(record.depth, 1);
        assert_eq!(record.state, ExchangeStateV1::Open);
        assert_eq!(record.deadline.get(), 1_000_000 + EXCHANGE_DEFAULT_TTL_SECS);
        assert!(record.is_member(&hex(LUCA)));
        assert!(!record.is_member(&hex(OWNER)));
    }

    #[test]
    fn bucket_hint_is_clamped_to_the_ceiling() {
        assert_eq!(opened(Some(5)).bucket, 5);
        assert_eq!(opened(Some(50)).bucket, EXCHANGE_BUCKET_CEILING);
        assert_eq!(opened(Some(0)).bucket, 1);
    }

    #[test]
    fn id_is_deterministic_and_order_independent() {
        let a = derive_exchange_id(&hex(ROOT), &[hex(LUCA), hex(VEKTOR)], None).unwrap();
        let b = opened(None).exchange_id;
        assert_eq!(a, b);
        // Different root, members, or parent → different id.
        let other_root = derive_exchange_id(&hex(KAI), &[hex(LUCA), hex(VEKTOR)], None).unwrap();
        let other_members = derive_exchange_id(&hex(ROOT), &[hex(LUCA), hex(KAI)], None).unwrap();
        let with_parent =
            derive_exchange_id(&hex(ROOT), &[hex(LUCA), hex(VEKTOR)], Some(&hex(KAI))).unwrap();
        assert_ne!(a, other_root);
        assert_ne!(a, other_members);
        assert_ne!(a, with_parent);
        // Unsorted input is refused rather than silently sorted here.
        assert!(matches!(
            derive_exchange_id(&hex(ROOT), &[hex(VEKTOR), hex(LUCA)], None),
            Err(ExchangeError::Members)
        ));
    }

    #[test]
    fn phase_and_admits_turn_follow_the_model() {
        let record = opened(None);
        let now = 1_000_010;
        assert_eq!(record.phase(0, now), ExchangePhase::Open);
        assert_eq!(record.phase(2, now), ExchangePhase::Open);
        assert_eq!(record.phase(3, now), ExchangePhase::Paused);
        assert_eq!(record.remaining(2), 1);
        assert!(record.admits_turn(1, now));
        assert!(record.admits_turn(3, now));
        assert!(!record.admits_turn(4, now));
        assert!(!record.admits_turn(0, now));
        let late = record.deadline.get() + 1;
        assert_eq!(record.phase(0, late), ExchangePhase::Expired);
        assert!(!record.admits_turn(1, late));
        let stopped = record.stopped();
        assert_eq!(stopped.phase(0, now), ExchangePhase::Closed);
        assert!(!stopped.admits_turn(1, now));
        assert!(stopped.validate().is_ok());
    }

    #[test]
    fn continued_adds_three_up_to_the_ceiling_then_none() {
        let record = opened(None);
        let go1 = record.continued(2_000_000).unwrap().unwrap();
        assert_eq!(go1.bucket, 6);
        assert_eq!(go1.deadline.get(), 2_000_000 + EXCHANGE_DEFAULT_TTL_SECS);
        let go2 = go1.continued(2_000_000).unwrap().unwrap();
        assert_eq!(go2.bucket, 9);
        let go3 = go2.continued(2_000_000).unwrap().unwrap();
        assert_eq!(go3.bucket, 10);
        assert!(go3.continued(2_000_000).unwrap().is_none());
        // Go after Stop reopens — the owner's latest word wins.
        let reopened = record.stopped().continued(2_000_000).unwrap().unwrap();
        assert_eq!(reopened.state, ExchangeStateV1::Open);
        assert!(reopened.validate().is_ok());
    }

    #[test]
    fn child_exchange_is_depth_two_and_cannot_nest_further() {
        let parent = opened(None);
        let child = ExchangeRecordV1::open_child(
            &parent,
            vec![hex(VEKTOR), hex(KAI)],
            OpaqueId::parse("conv-1").unwrap(),
            hex(ROOT),
            hex(VEKTOR),
            None,
            1_000_000,
        )
        .unwrap();
        assert_eq!(child.depth, 2);
        assert_eq!(child.parent_exchange_id, Some(parent.exchange_id.clone()));
        assert!(matches!(
            ExchangeRecordV1::open_child(
                &child,
                vec![hex(KAI), hex(LUCA)],
                OpaqueId::parse("conv-1").unwrap(),
                hex(ROOT),
                hex(KAI),
                None,
                1_000_000,
            ),
            Err(ExchangeError::Depth)
        ));
    }

    #[test]
    fn validate_rejects_every_bad_shape() {
        let good = opened(None);
        let mut owner_in_members = good.clone();
        owner_in_members.members = vec![hex(OWNER), hex(LUCA)];
        assert!(matches!(
            owner_in_members.validate(),
            Err(ExchangeError::Members)
        ));
        let mut one_member = good.clone();
        one_member.members = vec![hex(LUCA)];
        assert!(matches!(one_member.validate(), Err(ExchangeError::Members)));
        let mut opener_outside = good.clone();
        opener_outside.opened_by = hex(KAI);
        assert!(matches!(
            opener_outside.validate(),
            Err(ExchangeError::OpenedBy)
        ));
        let mut over_ceiling = good.clone();
        over_ceiling.bucket = 11;
        assert!(matches!(
            over_ceiling.validate(),
            Err(ExchangeError::Bucket)
        ));
        let mut zero_bucket = good.clone();
        zero_bucket.bucket = 0;
        assert!(matches!(zero_bucket.validate(), Err(ExchangeError::Bucket)));
        let mut depth_without_parent = good.clone();
        depth_without_parent.depth = 2;
        assert!(matches!(
            depth_without_parent.validate(),
            Err(ExchangeError::Depth)
        ));
        let mut wrong_id = good.clone();
        wrong_id.exchange_id = hex(KAI);
        assert!(matches!(wrong_id.validate(), Err(ExchangeError::Id)));
        let mut wrong_protocol = good;
        wrong_protocol.protocol = "luca.exchange.v0".into();
        assert!(matches!(
            wrong_protocol.validate(),
            Err(ExchangeError::Protocol)
        ));
    }

    #[test]
    fn content_round_trips_through_canonical_json_and_validates_on_read() {
        let record = opened(Some(5));
        let content = record.to_content().unwrap();
        let parsed = ExchangeRecordV1::from_content(&content).unwrap();
        assert_eq!(parsed, record);
        // Tampering with the content breaks the id check on read.
        let tampered = content.replace("\"bucket\":5", "\"bucket\":9");
        let parsed = ExchangeRecordV1::from_content(&tampered).unwrap();
        assert_eq!(
            parsed.bucket, 9,
            "bucket is not part of the id — owner may raise it"
        );
        let tampered_members = content.replace(VEKTOR, KAI);
        assert!(ExchangeRecordV1::from_content(&tampered_members).is_err());
        assert!(serde_json::from_str::<ExchangeRecordV1>("{\"protocol\":\"x\"}").is_err());
    }

    #[test]
    fn event_tags_are_d_then_members() {
        let record = opened(None);
        let tags = record.event_tags();
        assert_eq!(tags[0], vec!["d", record.exchange_id.as_str()]);
        assert_eq!(tags[1], vec!["p", LUCA]);
        assert_eq!(tags[2], vec!["p", VEKTOR]);
        assert_eq!(tags.len(), 3);
    }

    #[test]
    fn turn_tag_parses_renders_and_rejects() {
        let tag = ExchangeTurnTag::new(hex(ROOT), 2).unwrap();
        let raw = tag.to_tag();
        assert_eq!(raw, vec!["exchange", ROOT, "2"]);
        assert_eq!(ExchangeTurnTag::parse_tag(&raw).unwrap().unwrap(), tag);
        assert!(ExchangeTurnTag::parse_tag(&["p".to_owned(), ROOT.to_owned()]).is_none());
        let short = vec!["exchange".to_owned(), ROOT.to_owned()];
        assert!(ExchangeTurnTag::parse_tag(&short).unwrap().is_err());
        let zero = vec!["exchange".to_owned(), ROOT.to_owned(), "0".to_owned()];
        assert!(ExchangeTurnTag::parse_tag(&zero).unwrap().is_err());
        let eleven = vec!["exchange".to_owned(), ROOT.to_owned(), "11".to_owned()];
        assert!(ExchangeTurnTag::parse_tag(&eleven).unwrap().is_err());
        let bad_id = vec!["exchange".to_owned(), "zz".to_owned(), "1".to_owned()];
        assert!(ExchangeTurnTag::parse_tag(&bad_id).unwrap().is_err());
        assert!(ExchangeTurnTag::new(hex(ROOT), 11).is_err());
    }

    #[test]
    fn find_returns_none_one_or_error_on_two() {
        let p = vec!["p".to_owned(), LUCA.to_owned()];
        assert_eq!(
            ExchangeTurnTag::find(std::slice::from_ref(&p)).unwrap(),
            None
        );
        let one = ExchangeTurnTag::new(hex(ROOT), 1).unwrap().to_tag();
        assert_eq!(
            ExchangeTurnTag::find(&[p.clone(), one.clone()])
                .unwrap()
                .unwrap()
                .turn,
            1
        );
        let two = ExchangeTurnTag::new(hex(KAI), 2).unwrap().to_tag();
        assert!(ExchangeTurnTag::find(&[p, one, two]).is_err());
    }
}
