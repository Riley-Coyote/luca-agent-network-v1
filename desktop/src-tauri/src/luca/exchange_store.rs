//! The owner's own record of the exchanges in this house.
//!
//! Three things live here and nothing else:
//!
//! * **Heads** — the latest [`ExchangeRecordV1`] this desktop has seen for an
//!   exchange id, replaced under the same last-writer-wins rule the relay uses
//!   for NIP-33 (`created_at` wins; a same-second tie goes to the lower event
//!   id). A head we do not hold is fetched from the relay; a head we cannot
//!   fetch is *unknown*, and unknown always refuses.
//! * **Decisions** — the exchange placement frozen for one managed final,
//!   keyed by `(dispatch_receipt_id, resident_pubkey)`. The managed outbox
//!   compares whole requests, so a replay must produce byte-identical bytes.
//!   Re-deriving the placement cannot promise that (the registry, the room
//!   membership, or the spent set may have drifted between attempts), so the
//!   first decision is written down and every later attempt reads it back
//!   verbatim.
//! * **Visits** — ordinary room memberships temporarily granted to a resident,
//!   with the arrival threshold and the exchange (when any) that brought them.
//!
//! Nothing in here reaches the network. Persistence is the same atomically
//! replaced, owner-only JSON file the managed dispatch store uses.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use luca_protocol::{ExchangeRecordV1, ExchangeTurnTag, Hex64, OpaqueId};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::managed_dispatch_store::atomic_write_restricted;

const STORE_SCHEMA: &str = "luca.exchange-store.v1";
const MAX_HEADS: usize = 256;
const MAX_DECISIONS: usize = 256;
const MAX_VISITS: usize = 256;
const MAX_STORE_BYTES: usize = 4 * 1024 * 1024;

static GLOBAL_STORE: OnceLock<Arc<Mutex<ExchangeStore>>> = OnceLock::new();

/// One exchange head exactly as this desktop last observed it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ExchangeHead {
    /// The validated record carried in the event content.
    pub record: ExchangeRecordV1,
    /// `created_at` of the event that carried it — the LWW ordering key.
    pub created_at: u64,
    /// The event id, which breaks a same-second tie exactly as the relay does.
    pub event_id: Hex64,
}

/// One visit a frozen final is authorized to establish.
///
/// This lives on the decision before the membership write happens. Replaying
/// the same final therefore settles the same grant instead of deriving another
/// arrival from mutable room state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct VisitGrant {
    /// Room the guest temporarily joins.
    pub conversation_id: OpaqueId,
    /// Same-owner resident joining as an ordinary member.
    pub resident: Hex64,
    /// Arrival threshold used by the visit timeline.
    pub arrived_at: u64,
    /// Exchange that caused the visit, when a resident minted it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exchange_id: Option<Hex64>,
    /// Stable id carried in both threshold notes.
    pub correlation_id: Hex64,
}

/// One currently active visit, persisted beside exchange heads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct VisitRecord {
    /// Frozen grant that established the membership.
    #[serde(flatten)]
    pub grant: VisitGrant,
    /// Whether the arrival threshold note reached the room.
    #[serde(default)]
    pub arrival_noted: bool,
    /// Whether fade already removed the ordinary membership.
    #[serde(default)]
    pub membership_removed: bool,
    /// Insertion order, used only to prune the oldest rows first.
    #[serde(default)]
    pub order: u64,
}

/// The frozen exchange placement for one managed final.
///
/// `granted_p_tags` are the recipients a mint added to the resident's reply;
/// `exchange` is the turn tag the final carries. `notes_published` records
/// that the owner-key exchange-notes for this decision already reached the
/// room, so a replay explains itself once rather than twice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub(crate) struct ExchangeDecision {
    /// Turn tag applied to the final, if this final speaks inside an exchange.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exchange: Option<ExchangeTurnTag>,
    /// Recipients added to the reply under a minted exchange's authority.
    #[serde(default)]
    pub granted_p_tags: Vec<Hex64>,
    /// A fresh exchange inside another exchange replaces the old audience.
    #[serde(default)]
    pub replace_p_tags: bool,
    /// Visit memberships this final is authorized to establish.
    #[serde(default)]
    pub visit_grants: Vec<VisitGrant>,
    /// Exchange record this decision must publish before the final, if minted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mint_record: Option<ExchangeRecordV1>,
    /// Stable relay ordering timestamp for `mint_record`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mint_created_at: Option<u64>,
    /// Whether the record and widened dispatch audience were settled.
    #[serde(default)]
    pub mint_published: bool,
    /// Owner-key exchange-note sentences owed to the room for this decision.
    #[serde(default)]
    pub notes: Vec<String>,
    /// Whether those sentences have already been published.
    #[serde(default)]
    pub notes_published: bool,
    /// Insertion order, used only to prune the oldest rows first.
    #[serde(default)]
    pub order: u64,
}

#[derive(Serialize, Deserialize)]
struct PersistedExchangeStore {
    schema: String,
    next_order: u64,
    heads: BTreeMap<String, ExchangeHead>,
    decisions: BTreeMap<String, ExchangeDecision>,
    #[serde(default)]
    visits: BTreeMap<String, VisitRecord>,
}

/// Bounded, owner-only store of exchange heads and frozen final decisions.
pub(crate) struct ExchangeStore {
    path: Option<PathBuf>,
    heads: BTreeMap<String, ExchangeHead>,
    decisions: BTreeMap<String, ExchangeDecision>,
    visits: BTreeMap<String, VisitRecord>,
    next_order: u64,
}

/// The decision key for one managed final: the dispatch receipt plus the
/// resident that authored it. This is the same pair the outbox idempotency key
/// is derived from, so one final has exactly one decision.
pub(crate) fn decision_key(dispatch_receipt_id: &str, resident_pubkey: &str) -> String {
    format!("{dispatch_receipt_id}:{resident_pubkey}")
}

impl ExchangeStore {
    /// An in-memory store with no persistence, for exercising the resolver
    /// without touching the owner's disk.
    #[cfg(test)]
    pub(crate) fn in_memory() -> Self {
        Self {
            path: None,
            heads: BTreeMap::new(),
            decisions: BTreeMap::new(),
            visits: BTreeMap::new(),
            next_order: 1,
        }
    }

    /// Load a bounded store, refusing malformed or oversized durable state.
    pub(crate) fn load(path: PathBuf) -> Result<Self, String> {
        if !path.exists() {
            return Ok(Self {
                path: Some(path),
                heads: BTreeMap::new(),
                decisions: BTreeMap::new(),
                visits: BTreeMap::new(),
                next_order: 1,
            });
        }
        let bytes =
            std::fs::read(&path).map_err(|error| format!("read luca exchange store: {error}"))?;
        if bytes.len() > MAX_STORE_BYTES {
            return Err("luca exchange store exceeds its size limit".into());
        }
        let persisted: PersistedExchangeStore = serde_json::from_slice(&bytes)
            .map_err(|error| format!("parse luca exchange store: {error}"))?;
        if persisted.schema != STORE_SCHEMA
            || persisted.next_order == 0
            || persisted.heads.len() > MAX_HEADS
            || persisted.decisions.len() > MAX_DECISIONS
            || persisted.visits.len() > MAX_VISITS
        {
            return Err("luca exchange store schema or row count is invalid".into());
        }
        for (id, head) in &persisted.heads {
            if head.record.exchange_id.as_str() != id || head.record.validate().is_err() {
                return Err("luca exchange store head does not match its key".into());
            }
        }
        for (key, visit) in &persisted.visits {
            if key != &visit_key(&visit.grant.conversation_id, &visit.grant.resident)
                || visit.grant.arrived_at == 0
                || visit
                    .grant
                    .exchange_id
                    .as_ref()
                    .is_some_and(|exchange_id| exchange_id != &visit.grant.correlation_id)
            {
                return Err("luca exchange store visit does not match its key".into());
            }
        }
        Ok(Self {
            path: Some(path),
            heads: persisted.heads,
            decisions: persisted.decisions,
            visits: persisted.visits,
            next_order: persisted.next_order,
        })
    }

    /// The head this desktop holds for `exchange_id`, if any.
    pub(crate) fn head(&self, exchange_id: &Hex64) -> Option<&ExchangeHead> {
        self.heads.get(exchange_id.as_str())
    }

    /// Replace the stored head when the candidate is genuinely newer.
    ///
    /// The rule mirrors the relay's NIP-33 replacement: a later `created_at`
    /// wins, and a same-second tie goes to the lower event id. A record whose
    /// id does not match its own content is refused rather than stored.
    pub(crate) fn upsert_head(&mut self, head: ExchangeHead) -> Result<(), String> {
        head.record
            .validate()
            .map_err(|error| format!("luca exchange head is invalid: {error}"))?;
        let key = head.record.exchange_id.as_str().to_owned();
        if let Some(existing) = self.heads.get(&key) {
            let newer = head.created_at > existing.created_at
                || (head.created_at == existing.created_at && head.event_id < existing.event_id);
            if !newer {
                return Ok(());
            }
        }
        let previous = self.heads.clone();
        self.heads.insert(key, head);
        self.prune_heads();
        if let Err(error) = self.persist() {
            self.heads = previous;
            return Err(error);
        }
        Ok(())
    }

    /// Take the relay's head verbatim, whatever this desktop currently holds.
    ///
    /// [`Self::upsert_head`] arbitrates between two *candidate* heads. This
    /// records an *observation*: the relay has already arbitrated, and its
    /// answer is the answer. A local copy that claims a later `created_at` than
    /// the relay's head is a write the relay dominated, and keeping it would
    /// leave the owner's controls acting on a record that no longer exists.
    pub(crate) fn adopt_head(&mut self, head: ExchangeHead) -> Result<(), String> {
        head.record
            .validate()
            .map_err(|error| format!("luca exchange head is invalid: {error}"))?;
        let key = head.record.exchange_id.as_str().to_owned();
        if self.heads.get(&key) == Some(&head) {
            return Ok(());
        }
        let previous = self.heads.clone();
        self.heads.insert(key, head);
        self.prune_heads();
        if let Err(error) = self.persist() {
            self.heads = previous;
            return Err(error);
        }
        Ok(())
    }

    /// The frozen decision for one managed final, if one was already written.
    pub(crate) fn decision(&self, key: &str) -> Option<&ExchangeDecision> {
        self.decisions.get(key)
    }

    /// Freeze the exchange decision for one managed final.
    ///
    /// Idempotent: an existing decision under the same key is returned
    /// unchanged, so a replay can never re-place a final that already spoke.
    pub(crate) fn record_decision(
        &mut self,
        key: &str,
        decision: ExchangeDecision,
    ) -> Result<ExchangeDecision, String> {
        if let Some(existing) = self.decisions.get(key) {
            return Ok(existing.clone());
        }
        let previous = self.decisions.clone();
        let previous_order = self.next_order;
        let order = self.next_order;
        self.next_order = self.next_order.saturating_add(1);
        let stored = ExchangeDecision { order, ..decision };
        self.decisions.insert(key.to_owned(), stored.clone());
        self.prune_decisions();
        if let Err(error) = self.persist() {
            self.decisions = previous;
            self.next_order = previous_order;
            return Err(error);
        }
        Ok(stored)
    }

    /// Record that this decision's exchange-notes have reached the room.
    pub(crate) fn mark_notes_published(&mut self, key: &str) -> Result<(), String> {
        let previous = self.decisions.clone();
        let Some(decision) = self.decisions.get_mut(key) else {
            return Err("luca exchange decision is unknown".into());
        };
        if decision.notes_published {
            return Ok(());
        }
        decision.notes_published = true;
        if let Err(error) = self.persist() {
            self.decisions = previous;
            return Err(error);
        }
        Ok(())
    }

    /// Record that a frozen mint reached the relay and dispatch authority.
    pub(crate) fn mark_mint_published(&mut self, key: &str) -> Result<(), String> {
        let previous = self.decisions.clone();
        let Some(decision) = self.decisions.get_mut(key) else {
            return Err("luca exchange decision is unknown".into());
        };
        if decision.mint_published {
            return Ok(());
        }
        decision.mint_published = true;
        if let Err(error) = self.persist() {
            self.decisions = previous;
            return Err(error);
        }
        Ok(())
    }

    /// The active visit for one guest in one room, if any.
    pub(crate) fn visit(
        &self,
        conversation_id: &OpaqueId,
        resident: &Hex64,
    ) -> Option<&VisitRecord> {
        self.visits.get(&visit_key(conversation_id, resident))
    }

    /// All active visits in one room, in arrival order.
    pub(crate) fn visits_in(&self, conversation_id: &OpaqueId) -> Vec<VisitRecord> {
        let mut visits: Vec<VisitRecord> = self
            .visits
            .values()
            .filter(|visit| &visit.grant.conversation_id == conversation_id)
            .cloned()
            .collect();
        visits.sort_by_key(|visit| (visit.grant.arrived_at, visit.order));
        visits
    }

    /// Record a newly granted visit, idempotently.
    pub(crate) fn record_visit(&mut self, grant: VisitGrant) -> Result<VisitRecord, String> {
        let key = visit_key(&grant.conversation_id, &grant.resident);
        if let Some(existing) = self.visits.get(&key) {
            return Ok(existing.clone());
        }
        if self.visits.len() == MAX_VISITS {
            return Err("luca exchange store visit limit reached".into());
        }
        let previous = self.visits.clone();
        let previous_order = self.next_order;
        let record = VisitRecord {
            grant,
            arrival_noted: false,
            membership_removed: false,
            order: self.next_order,
        };
        self.next_order = self.next_order.saturating_add(1);
        self.visits.insert(key, record.clone());
        if let Err(error) = self.persist() {
            self.visits = previous;
            self.next_order = previous_order;
            return Err(error);
        }
        Ok(record)
    }

    /// Remember that the room received this visit's arrival threshold.
    pub(crate) fn mark_visit_arrival_noted(
        &mut self,
        conversation_id: &OpaqueId,
        resident: &Hex64,
    ) -> Result<(), String> {
        let previous = self.visits.clone();
        let Some(visit) = self.visits.get_mut(&visit_key(conversation_id, resident)) else {
            return Err("luca visit is unknown".into());
        };
        if visit.arrival_noted {
            return Ok(());
        }
        visit.arrival_noted = true;
        if let Err(error) = self.persist() {
            self.visits = previous;
            return Err(error);
        }
        Ok(())
    }

    /// Forget a faded visit after its membership was removed.
    pub(crate) fn remove_visit(
        &mut self,
        conversation_id: &OpaqueId,
        resident: &Hex64,
    ) -> Result<Option<VisitRecord>, String> {
        let previous = self.visits.clone();
        let removed = self.visits.remove(&visit_key(conversation_id, resident));
        if removed.is_none() {
            return Ok(None);
        }
        if let Err(error) = self.persist() {
            self.visits = previous;
            return Err(error);
        }
        Ok(removed)
    }

    /// Remember the irreversible membership half of fade before noting it.
    pub(crate) fn mark_visit_membership_removed(
        &mut self,
        conversation_id: &OpaqueId,
        resident: &Hex64,
    ) -> Result<(), String> {
        let previous = self.visits.clone();
        let Some(visit) = self.visits.get_mut(&visit_key(conversation_id, resident)) else {
            return Err("luca visit is unknown".into());
        };
        if visit.membership_removed {
            return Ok(());
        }
        visit.membership_removed = true;
        if let Err(error) = self.persist() {
            self.visits = previous;
            return Err(error);
        }
        Ok(())
    }

    /// Move one frozen decision onto a different turn of the *same* exchange.
    ///
    /// This is the only mutation a decision ever accepts, and it exists for one
    /// reason: the relay refused the frozen final with `exchange turn already
    /// spoken`, so the desktop re-signs the identical draft on the next
    /// unspoken turn. Changing the exchange itself, or setting a turn on a
    /// decision that never had one, is refused.
    pub(crate) fn retune_decision(
        &mut self,
        key: &str,
        exchange: &ExchangeTurnTag,
    ) -> Result<(), String> {
        let previous = self.decisions.clone();
        let Some(decision) = self.decisions.get_mut(key) else {
            return Err("luca exchange decision is unknown".into());
        };
        match &decision.exchange {
            Some(current) if current.exchange_id == exchange.exchange_id => {}
            _ => return Err("luca exchange decision cannot change exchange".into()),
        }
        decision.exchange = Some(exchange.clone());
        if let Err(error) = self.persist() {
            self.decisions = previous;
            return Err(error);
        }
        Ok(())
    }

    fn prune_heads(&mut self) {
        while self.heads.len() > MAX_HEADS {
            let Some(oldest) = self
                .heads
                .iter()
                .min_by_key(|(id, head)| (head.created_at, (*id).clone()))
                .map(|(id, _)| id.clone())
            else {
                return;
            };
            self.heads.remove(&oldest);
        }
    }

    fn prune_decisions(&mut self) {
        while self.decisions.len() > MAX_DECISIONS {
            let Some(oldest) = self
                .decisions
                .iter()
                .min_by_key(|(key, decision)| (decision.order, (*key).clone()))
                .map(|(key, _)| key.clone())
            else {
                return;
            };
            self.decisions.remove(&oldest);
        }
    }

    fn persist(&self) -> Result<(), String> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let bytes = serde_json::to_vec(&PersistedExchangeStore {
            schema: STORE_SCHEMA.to_owned(),
            next_order: self.next_order,
            heads: self.heads.clone(),
            decisions: self.decisions.clone(),
            visits: self.visits.clone(),
        })
        .map_err(|error| format!("serialize luca exchange store: {error}"))?;
        if bytes.len() > MAX_STORE_BYTES {
            return Err("luca exchange store exceeds its size limit".into());
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("create luca exchange store directory: {error}"))?;
        }
        atomic_write_restricted(path, &bytes)
    }
}

fn visit_key(conversation_id: &OpaqueId, resident: &Hex64) -> String {
    format!("{}:{}", conversation_id.as_str(), resident.as_str())
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve app data directory: {error}"))?;
    Ok(root.join("luca").join("exchanges.json"))
}

/// Shared store used by both Tauri commands and resident broker threads.
pub(crate) fn global_exchange_store(app: &AppHandle) -> Result<Arc<Mutex<ExchangeStore>>, String> {
    if let Some(store) = GLOBAL_STORE.get() {
        return Ok(Arc::clone(store));
    }
    let candidate = Arc::new(Mutex::new(ExchangeStore::load(store_path(app)?)?));
    let _ = GLOBAL_STORE.set(Arc::clone(&candidate));
    Ok(Arc::clone(GLOBAL_STORE.get().ok_or_else(|| {
        "initialize luca exchange store".to_string()
    })?))
}

#[cfg(test)]
#[path = "exchange_store_tests.rs"]
mod exchange_store_tests;
