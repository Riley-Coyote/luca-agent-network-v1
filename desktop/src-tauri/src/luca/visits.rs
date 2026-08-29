//! Temporary, ordinary room membership for same-owner residents.
//!
//! A visit has no interior capability gate. The desktop adds the resident
//! through the existing member command, records the arrival threshold, and
//! removes that same membership when the centralized fade rule says the visit
//! is over.

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};

use luca_protocol::{Hex64, OpaqueId};
use serde::Serialize;

use super::exchange_relay::{ExchangeRelay, ExchangeRelayError};
use super::exchange_store::{ExchangeStore, VisitGrant, VisitRecord};

/// The one of two events that can end a V1 visit.
pub(crate) enum VisitFadeTrigger<'a> {
    /// The owner's next room message omitted these existing guests.
    OwnerMessage {
        /// Same-owner residents explicitly mentioned by the owner.
        mentioned: &'a BTreeSet<Hex64>,
        /// Owner-message timestamp used only to recognize expired exchanges.
        now_unix_secs: u64,
    },
    /// The owner stopped an exchange involving a guest.
    ExchangeStopped {
        /// Exchange the owner stopped.
        exchange_id: &'a Hex64,
        /// Stop timestamp used only to recognize other expired exchanges.
        now_unix_secs: u64,
    },
}

/// Frozen visit work for one owner-authored room message.
///
/// Planning is read-only. The command may provision the listed memberships so
/// the public message can be validated and delivered, but no durable visit
/// state or room note is committed until the relay accepts that message.
#[derive(Clone)]
pub(crate) struct OwnerMessageVisitPlan {
    conversation_id: OpaqueId,
    new_visitors: Vec<Hex64>,
    memberships_to_provision: Vec<Hex64>,
    faded: Vec<Hex64>,
    active_visitors: Vec<Hex64>,
}

impl OwnerMessageVisitPlan {
    /// Visitors whose old delivery tags must not be carried by this message.
    pub(crate) fn faded(&self) -> &[Hex64] {
        &self.faded
    }

    /// Guests that remain visitors for this message. Conversation-wide
    /// activation excludes them; an explicit directed mention still wakes one.
    pub(crate) fn active_visitors(&self) -> &[Hex64] {
        &self.active_visitors
    }
}

/// Read the complete visit consequence of one owner message without mutating
/// membership, the visit store, or the room timeline.
pub(crate) fn plan_owner_message_visits(
    relay: &dyn ExchangeRelay,
    store: &Arc<Mutex<ExchangeStore>>,
    conversation_id: &OpaqueId,
    mentioned_pubkeys: &[String],
    now_unix_secs: u64,
) -> Result<OwnerMessageVisitPlan, ExchangeRelayError> {
    let mentioned = normalized_visit_mentions(mentioned_pubkeys);
    let visits = store
        .lock()
        .map_err(|_| ExchangeRelayError::Unavailable("visit store is locked".to_owned()))?
        .visits_in(conversation_id);

    let faded: Vec<Hex64> = {
        let store = store
            .lock()
            .map_err(|_| ExchangeRelayError::Unavailable("visit store is locked".to_owned()))?;
        visits
            .iter()
            .filter(|visit| {
                !mentioned.contains(&visit.grant.resident)
                    && !store.has_open_exchange_involving(
                        conversation_id,
                        &visit.grant.resident,
                        now_unix_secs,
                    )
            })
            .map(|visit| visit.grant.resident.clone())
            .collect()
    };
    let faded_set: BTreeSet<Hex64> = faded.iter().cloned().collect();
    let active_visitors = visits
        .iter()
        .filter(|visit| !faded_set.contains(&visit.grant.resident))
        .map(|visit| visit.grant.resident.clone())
        .collect();

    let mut new_visitors = Vec::new();
    let mut memberships_to_provision = Vec::new();
    if !mentioned.is_empty() {
        let owned = relay.owned_residents()?;
        let room = relay.conversation_members(conversation_id)?;
        for resident in mentioned {
            if !owned.contains(&resident) {
                continue;
            }
            let existing_visit = visits.iter().find(|visit| visit.grant.resident == resident);
            if room.contains(&resident) {
                // A regular member is never silently converted into a visitor.
                continue;
            }
            memberships_to_provision.push(resident.clone());
            if existing_visit.is_none() {
                new_visitors.push(resident);
            }
        }
    }

    Ok(OwnerMessageVisitPlan {
        conversation_id: conversation_id.clone(),
        new_visitors,
        memberships_to_provision,
        faded,
        active_visitors,
    })
}

/// Provision only the memberships required to deliver the planned message.
/// If any add fails, prior adds from this same attempt are rolled back before
/// the error is returned.
pub(crate) fn provision_owner_message_visits(
    relay: &dyn ExchangeRelay,
    plan: &OwnerMessageVisitPlan,
) -> Result<Vec<Hex64>, ExchangeRelayError> {
    let mut provisioned = Vec::new();
    for resident in &plan.memberships_to_provision {
        if let Err(error) = relay.add_conversation_member(&plan.conversation_id, resident) {
            rollback_owner_message_visit_memberships(relay, plan, &provisioned);
            return Err(error);
        }
        provisioned.push(resident.clone());
    }
    Ok(provisioned)
}

/// Undo membership writes made by one unaccepted owner-send attempt. Existing
/// members and durable visits are never part of `provisioned`, so this cannot
/// remove authority that predates the failed send.
pub(crate) fn rollback_owner_message_visit_memberships(
    relay: &dyn ExchangeRelay,
    plan: &OwnerMessageVisitPlan,
    provisioned: &[Hex64],
) {
    for resident in provisioned.iter().rev() {
        if let Err(error) = relay.remove_conversation_member(&plan.conversation_id, resident) {
            eprintln!(
                "luca-visit: failed owner-send membership rollback for {}: {error}",
                resident.as_str()
            );
        }
    }
}

/// Commit the visit state and visible thresholds after the owner message has
/// been accepted. Re-running this after a partial failure is idempotent: the
/// store keeps one visit per room/resident, and the relay deduplicates notes by
/// their frozen visit correlation.
pub(crate) fn commit_owner_message_visits(
    relay: &dyn ExchangeRelay,
    store: &Arc<Mutex<ExchangeStore>>,
    plan: &OwnerMessageVisitPlan,
    correlation_id: &Hex64,
    arrived_at: u64,
) -> Result<(), ExchangeRelayError> {
    for resident in &plan.new_visitors {
        let grant = VisitGrant {
            conversation_id: plan.conversation_id.clone(),
            resident: resident.clone(),
            arrived_at,
            exchange_id: None,
            correlation_id: correlation_id.clone(),
        };
        let visit = store
            .lock()
            .map_err(|_| ExchangeRelayError::Unavailable("visit store is locked".to_owned()))?
            .record_visit(grant.clone())
            .map_err(ExchangeRelayError::Unavailable)?;
        if !visit.arrival_noted {
            relay.publish_note(&plan.conversation_id, &arrival_note(relay, &visit.grant))?;
            store
                .lock()
                .map_err(|_| ExchangeRelayError::Unavailable("visit store is locked".to_owned()))?
                .mark_visit_arrival_noted(&plan.conversation_id, resident)
                .map_err(ExchangeRelayError::Unavailable)?;
        }
    }

    for resident in &plan.faded {
        end_visit(relay, store, &plan.conversation_id, resident)?;
    }
    Ok(())
}

/// End one active visit immediately without changing the conversation's
/// permanent participant set. The membership removal is recorded before the
/// departure note so retrying after a partial relay failure is safe.
pub(crate) fn end_visit(
    relay: &dyn ExchangeRelay,
    store: &Arc<Mutex<ExchangeStore>>,
    conversation_id: &OpaqueId,
    resident: &Hex64,
) -> Result<bool, ExchangeRelayError> {
    let Some(visit) = store
        .lock()
        .map_err(|_| ExchangeRelayError::Unavailable("visit store is locked".to_owned()))?
        .visit(conversation_id, resident)
        .cloned()
    else {
        return Ok(false);
    };

    if !visit.membership_removed {
        relay.remove_conversation_member(conversation_id, resident)?;
        store
            .lock()
            .map_err(|_| ExchangeRelayError::Unavailable("visit store is locked".to_owned()))?
            .mark_visit_membership_removed(conversation_id, resident)
            .map_err(ExchangeRelayError::Unavailable)?;
    }
    relay.publish_note(conversation_id, &left_note(relay, &visit))?;
    store
        .lock()
        .map_err(|_| ExchangeRelayError::Unavailable("visit store is locked".to_owned()))?
        .remove_visit(conversation_id, resident)
        .map_err(ExchangeRelayError::Unavailable)?;
    Ok(true)
}

#[derive(Serialize)]
struct VisitNotePayload<'a> {
    r#type: &'static str,
    resident: &'a str,
    exchange_id: &'a str,
    text: String,
}

/// Create the exact arrival payload understood by the desktop timeline.
pub(crate) fn arrival_note(relay: &dyn ExchangeRelay, grant: &VisitGrant) -> String {
    serde_json::to_string(&VisitNotePayload {
        r#type: "visit_arrived",
        resident: grant.resident.as_str(),
        exchange_id: grant.correlation_id.as_str(),
        text: format!("{} is visiting.", relay.display_name(&grant.resident)),
    })
    .expect("visit note payload is infallible")
}

/// Create the exact departure payload understood by the desktop timeline.
pub(crate) fn left_note(relay: &dyn ExchangeRelay, visit: &VisitRecord) -> String {
    serde_json::to_string(&VisitNotePayload {
        r#type: "visit_left",
        resident: visit.grant.resident.as_str(),
        exchange_id: visit.grant.correlation_id.as_str(),
        text: format!("{} left.", relay.display_name(&visit.grant.resident)),
    })
    .expect("visit note payload is infallible")
}

/// Establish frozen visit grants exactly once, recovering partial attempts.
///
/// A regular member is never converted into a visitor. An already-recorded
/// visitor is repaired if its membership write did not survive, and its
/// arrival note is retried until the store records that it reached the room.
pub(crate) fn settle_visit_grants(
    relay: &dyn ExchangeRelay,
    store: &Arc<Mutex<ExchangeStore>>,
    grants: &[VisitGrant],
) -> Result<(), ExchangeRelayError> {
    if grants.is_empty() {
        return Ok(());
    }
    let mut members = relay.conversation_members(&grants[0].conversation_id)?;
    for grant in grants {
        if grant.conversation_id != grants[0].conversation_id {
            return Err(ExchangeRelayError::Unavailable(
                "one visit settlement crossed room boundaries".to_owned(),
            ));
        }
        let existing = store
            .lock()
            .map_err(|_| ExchangeRelayError::Unavailable("visit store is locked".to_owned()))?
            .visit(&grant.conversation_id, &grant.resident)
            .cloned();
        if existing.is_none() && members.contains(&grant.resident) {
            continue;
        }
        let was_existing = existing.is_some();
        let visit = match existing {
            Some(visit) => visit,
            None => store
                .lock()
                .map_err(|_| ExchangeRelayError::Unavailable("visit store is locked".to_owned()))?
                .record_visit(grant.clone())
                .map_err(ExchangeRelayError::Unavailable)?,
        };
        if !members.contains(&grant.resident) {
            if let Err(error) =
                relay.add_conversation_member(&grant.conversation_id, &grant.resident)
            {
                if !was_existing {
                    let rollback = store
                        .lock()
                        .map_err(|_| {
                            ExchangeRelayError::Unavailable("visit store is locked".to_owned())
                        })?
                        .remove_visit(&grant.conversation_id, &grant.resident)
                        .map_err(ExchangeRelayError::Unavailable);
                    if let Err(rollback_error) = rollback {
                        eprintln!("luca-visit: failed membership grant also failed to roll back: {rollback_error}");
                    }
                }
                return Err(error);
            }
            members.insert(grant.resident.clone());
        }
        if !visit.arrival_noted {
            relay.publish_note(&grant.conversation_id, &arrival_note(relay, &visit.grant))?;
            store
                .lock()
                .map_err(|_| ExchangeRelayError::Unavailable("visit store is locked".to_owned()))?
                .mark_visit_arrival_noted(&grant.conversation_id, &grant.resident)
                .map_err(ExchangeRelayError::Unavailable)?;
        }
    }
    Ok(())
}

/// Add newly mentioned same-owner residents and fade omitted existing guests.
pub(crate) fn handle_owner_mentions(
    relay: &dyn ExchangeRelay,
    store: &Arc<Mutex<ExchangeStore>>,
    conversation_id: &OpaqueId,
    mentioned_pubkeys: &[String],
    correlation_id: &Hex64,
    arrived_at: u64,
) -> Result<(), ExchangeRelayError> {
    let mentioned = normalized_visit_mentions(mentioned_pubkeys);
    fade_owner_message_visits(relay, store, conversation_id, mentioned_pubkeys, arrived_at)?;
    if mentioned.is_empty() {
        return Ok(());
    }
    let owned = relay.owned_residents()?;
    let room = relay.conversation_members(conversation_id)?;
    let grants: Vec<VisitGrant> = mentioned
        .into_iter()
        .filter(|resident| owned.contains(resident))
        .filter(|resident| !room.contains(resident))
        .map(|resident| VisitGrant {
            conversation_id: conversation_id.clone(),
            resident,
            arrived_at,
            exchange_id: None,
            correlation_id: correlation_id.clone(),
        })
        .collect();
    settle_visit_grants(relay, store, &grants)
}

fn normalized_visit_mentions(mentioned_pubkeys: &[String]) -> BTreeSet<Hex64> {
    mentioned_pubkeys
        .iter()
        .filter_map(|value| Hex64::parse(value.trim().to_ascii_lowercase()).ok())
        .collect()
}

/// Fade guests omitted by an owner message and return the residents removed.
///
/// The send command uses this before constructing the public message so stale
/// sticky-audience recipients can be removed from that message's `p` tags.
pub(crate) fn fade_owner_message_visits(
    relay: &dyn ExchangeRelay,
    store: &Arc<Mutex<ExchangeStore>>,
    conversation_id: &OpaqueId,
    mentioned_pubkeys: &[String],
    now_unix_secs: u64,
) -> Result<Vec<Hex64>, ExchangeRelayError> {
    let mentioned = normalized_visit_mentions(mentioned_pubkeys);
    fade_visits(
        relay,
        store,
        conversation_id,
        VisitFadeTrigger::OwnerMessage {
            mentioned: &mentioned,
            now_unix_secs,
        },
    )
}

/// Apply the complete V1 fade rule in one place.
pub(crate) fn fade_visits(
    relay: &dyn ExchangeRelay,
    store: &Arc<Mutex<ExchangeStore>>,
    conversation_id: &OpaqueId,
    trigger: VisitFadeTrigger<'_>,
) -> Result<Vec<Hex64>, ExchangeRelayError> {
    let visits = store
        .lock()
        .map_err(|_| ExchangeRelayError::Unavailable("visit store is locked".to_owned()))?
        .visits_in(conversation_id);
    let mut faded = Vec::new();
    for visit in visits {
        let should_fade = match &trigger {
            VisitFadeTrigger::OwnerMessage {
                mentioned,
                now_unix_secs,
            } => {
                let has_open_exchange = store
                    .lock()
                    .map_err(|_| {
                        ExchangeRelayError::Unavailable("visit store is locked".to_owned())
                    })?
                    .has_open_exchange_involving(
                        conversation_id,
                        &visit.grant.resident,
                        *now_unix_secs,
                    );
                !has_open_exchange && !mentioned.contains(&visit.grant.resident)
            }
            VisitFadeTrigger::ExchangeStopped {
                exchange_id,
                now_unix_secs,
            } => {
                let store = store.lock().map_err(|_| {
                    ExchangeRelayError::Unavailable("visit store is locked".to_owned())
                })?;
                let stopped_involved_guest = visit.grant.exchange_id.as_ref() == Some(*exchange_id)
                    || store.head(exchange_id).is_some_and(|head| {
                        &head.record.conversation_id == conversation_id
                            && head.record.members.contains(&visit.grant.resident)
                    });
                stopped_involved_guest
                    && !store.has_open_exchange_involving(
                        conversation_id,
                        &visit.grant.resident,
                        *now_unix_secs,
                    )
            }
        };
        if !should_fade {
            continue;
        }
        if !visit.membership_removed {
            relay.remove_conversation_member(conversation_id, &visit.grant.resident)?;
            store
                .lock()
                .map_err(|_| ExchangeRelayError::Unavailable("visit store is locked".to_owned()))?
                .mark_visit_membership_removed(conversation_id, &visit.grant.resident)
                .map_err(ExchangeRelayError::Unavailable)?;
        }
        relay.publish_note(conversation_id, &left_note(relay, &visit))?;
        store
            .lock()
            .map_err(|_| ExchangeRelayError::Unavailable("visit store is locked".to_owned()))?
            .remove_visit(conversation_id, &visit.grant.resident)
            .map_err(ExchangeRelayError::Unavailable)?;
        faded.push(visit.grant.resident);
    }
    Ok(faded)
}

#[cfg(test)]
#[path = "visits_tests.rs"]
mod visits_tests;
