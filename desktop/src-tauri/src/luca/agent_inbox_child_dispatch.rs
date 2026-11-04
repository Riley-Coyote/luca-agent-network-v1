//! Bounded child publication slots on the existing native dispatch authority.
use super::*;
use crate::luca::agent_inbox_binding::{InboxChildActionBinding, InboxChildActionPhase};
use std::collections::BTreeSet;

impl ManagedDispatchStore {
    /// Source audiences already granted by accepted tool requests from this
    /// exact live invocation. Receipts from other turns/sessions never count.
    pub(crate) fn inbox_awareness_task_proofs(
        &self,
        request: &ManagedMessagePublishRequestV1,
    ) -> Vec<InboxChildActionBinding> {
        let Some(row) = self.dispatches.get(&(
            request.dispatch_receipt_id.as_str().to_owned(),
            request.resident_pubkey.as_str().to_owned(),
        )) else {
            return Vec::new();
        };
        let parent_id = row
            .inbox_action
            .as_ref()
            .map(|action| action.parent_dispatch_id.as_str())
            .unwrap_or(request.dispatch_receipt_id.as_str());
        let Some(parent) = self.dispatches.get(&(
            parent_id.to_owned(),
            request.resident_pubkey.as_str().to_owned(),
        )) else {
            return Vec::new();
        };
        if parent.state != ManagedDispatchState::Active
            || parent.inbox_action.is_some()
            || parent.owner_pubkey != request.owner_pubkey.as_str()
            || parent.conversation_id != request.conversation_id.as_str()
            || parent.session_epoch != Some(request.cancellation_epoch.get())
            || row.owner_pubkey != parent.owner_pubkey
            || row.conversation_id != parent.conversation_id
            || row.session_epoch != parent.session_epoch
        {
            return Vec::new();
        }
        self.dispatches
            .values()
            .filter_map(|child| {
                let action = child.inbox_action.as_ref()?;
                (child.state == ManagedDispatchState::Published
                    && child.published_event_id.is_some()
                    && child.submitted_event_id == child.published_event_id
                    && child.resident_pubkey == parent.resident_pubkey
                    && child.owner_pubkey == parent.owner_pubkey
                    && child.conversation_id == parent.conversation_id
                    && child.session_epoch == parent.session_epoch
                    && action.parent_dispatch_id.as_str() == parent_id
                    && action.scope.owner_pubkey.as_str() == parent.owner_pubkey
                    && action.phase == InboxChildActionPhase::Request
                    && action.anchor_event_id.is_some()
                    && action.exchange_id.is_some())
                .then(|| action.clone())
            })
            .collect()
    }
    pub(crate) fn has_inbox_owner_status(&self, parent: &str, actor: &str) -> bool {
        self.dispatches
            .get(&(parent.to_owned(), actor.to_owned()))
            .is_some_and(|row| row.inbox_owner_status.is_some())
    }
    /// Only an accepted explicit reply (not a newly opened tool task) may
    /// discharge this exact parent's ordinary final as an owner-only status.
    pub(crate) fn accepted_inbox_reply_status(
        &self,
        parent: &str,
        actor: &str,
    ) -> Option<InboxChildActionBinding> {
        let parent_row = self
            .dispatches
            .get(&(parent.to_owned(), actor.to_owned()))?;
        if parent_row.inbox_action.is_some() {
            return None;
        }
        let mut proof = None;
        for row in self.dispatches.values() {
            let Some(action) = &row.inbox_action else {
                continue;
            };
            if row.resident_pubkey != actor
                || action.parent_dispatch_id.as_str() != parent
                || action.phase != InboxChildActionPhase::Request
                || action.anchor_event_id.is_some()
                || action.exchange_id.is_none()
                || row.state != ManagedDispatchState::Published
                || row.published_event_id.is_none()
                || row.owner_pubkey != parent_row.owner_pubkey
                || row.conversation_id != parent_row.conversation_id
            {
                continue;
            }
            if proof
                .as_ref()
                .is_some_and(|prior: &InboxChildActionBinding| {
                    prior.exchange_id != action.exchange_id
                        || prior.recipient_pubkey != action.recipient_pubkey
                        || prior.scope != action.scope
                })
            {
                return None;
            }
            proof = Some(action.clone());
        }
        proof
    }

    pub(crate) fn bind_inbox_owner_status(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        proof: &InboxChildActionBinding,
        now: u64,
    ) -> Result<(), DispatchAuthorizationError> {
        if self
            .accepted_inbox_reply_status(
                request.dispatch_receipt_id.as_str(),
                request.resident_pubkey.as_str(),
            )
            .as_ref()
            != Some(proof)
        {
            return Err(DispatchAuthorizationError::Unknown);
        }
        let key = (
            request.dispatch_receipt_id.as_str().to_owned(),
            request.resident_pubkey.as_str().to_owned(),
        );
        let row = self
            .dispatches
            .get(&key)
            .ok_or(DispatchAuthorizationError::Unknown)?;
        if row
            .inbox_owner_status
            .as_ref()
            .is_some_and(|prior| prior != proof)
        {
            return Err(DispatchAuthorizationError::Unknown);
        }
        if row.resolved_p_tags == [request.owner_pubkey.as_str()] {
            let mut effective = request.clone();
            effective.resolved_p_tags = vec![request.owner_pubkey.clone()];
            if let Some(event) = &row.submitted_event_id {
                self.authorize_reconciliation(&effective, event, now)?;
            } else {
                self.authorize_publication(&effective, now)?;
            }
        } else {
            self.authorize_publication(request, now)?;
            if self.dispatches[&key].submitted_event_id.is_some() {
                return Err(DispatchAuthorizationError::Terminal);
            }
        }
        if self.dispatches[&key].inbox_owner_status.as_ref() == Some(proof) {
            return Ok(());
        }
        let previous = self.dispatches.clone();
        let row = self
            .dispatches
            .get_mut(&key)
            .ok_or(DispatchAuthorizationError::Unknown)?;
        row.resolved_p_tags = vec![request.owner_pubkey.as_str().to_owned()];
        row.inbox_owner_status = Some(proof.clone());
        if self.persist().is_err() {
            self.dispatches = previous;
            return Err(DispatchAuthorizationError::Persistence);
        }
        Ok(())
    }
    /// Naming an already-contacted resident in the ordinary final is not a
    /// second request. The message body remains completely unchanged.
    pub(crate) fn inbox_child_recipients(&self, parent: &str, actor: &str) -> BTreeSet<Hex64> {
        self.dispatches
            .values()
            .filter_map(|row| {
                let action = row.inbox_action.as_ref()?;
                (row.resident_pubkey == actor
                    && action.parent_dispatch_id.as_str() == parent
                    && action.phase == InboxChildActionPhase::Request)
                    .then(|| action.recipient_pubkey.clone())
            })
            .collect()
    }
    /// A staged inbox trigger without its second-stage lineage is recoverable
    /// bookkeeping only, never authority to claim/sign/submit as ordinary work.
    pub(crate) fn check_inbox_lineage_ready(
        &self,
        dispatch: &str,
        resident: &str,
    ) -> Result<(), DispatchAuthorizationError> {
        if self
            .dispatches
            .get(&(dispatch.to_owned(), resident.to_owned()))
            .is_some_and(|row| row.inbox_binding_required && row.inbox_task.is_none())
        {
            return Err(DispatchAuthorizationError::Unknown);
        }
        Ok(())
    }
    /// Recheck the exact parent under the same store lock used for publication;
    /// a child cannot outlive Stop just because it owns a separate final slot.
    pub(crate) fn check_inbox_child_parent(
        &self,
        child: &str,
        resident: &str,
        now: u64,
    ) -> Result<(), DispatchAuthorizationError> {
        let Some(row) = self
            .dispatches
            .get(&(child.to_owned(), resident.to_owned()))
        else {
            return Ok(());
        };
        let Some(action) = &row.inbox_action else {
            return Ok(());
        };
        if matches!(
            row.state,
            ManagedDispatchState::Published
                | ManagedDispatchState::Cancelled
                | ManagedDispatchState::Rejected
                | ManagedDispatchState::Failed
                | ManagedDispatchState::Interrupted
        ) {
            return Ok(()); // Reconcile prior outcomes, never authorize new bytes.
        }
        let parent = self
            .dispatches
            .get(&(
                action.parent_dispatch_id.as_str().to_owned(),
                resident.to_owned(),
            ))
            .ok_or(DispatchAuthorizationError::Unknown)?;
        if parent.state == ManagedDispatchState::Cancelled {
            return Err(DispatchAuthorizationError::Cancelled);
        }
        if parent.state != ManagedDispatchState::Active
            || parent.submitted_event_id.is_some()
            || now > parent.expires_at
            || parent.session_epoch != row.session_epoch
            || parent.owner_pubkey != row.owner_pubkey
            || parent.conversation_id != row.conversation_id
            || parent.inbox_action.is_some()
        {
            return Err(DispatchAuthorizationError::Terminal);
        }
        Ok(())
    }

    /// In-memory part of exact cancellation; caller persists parent+children
    /// in one transaction and rolls the full map back on failure.
    pub(crate) fn cancel_inbox_children(&mut self, parent: &str) {
        for row in self.dispatches.values_mut() {
            if row
                .inbox_action
                .as_ref()
                .is_some_and(|action| action.parent_dispatch_id.as_str() == parent)
                && matches!(
                    row.state,
                    ManagedDispatchState::Pending | ManagedDispatchState::Active
                )
            {
                row.state = ManagedDispatchState::Cancelled;
                row.interruption_reason = None;
                row.outbox_finalized = row.session_epoch.is_none();
            }
        }
    }

    /// A retry in a later live turn can return the exact accepted action,
    /// without reparenting, allocating slots, waking or signing any new event.
    pub(crate) fn accepted_inbox_action(
        &self,
        key: &Hex64,
        fingerprint: &Hex64,
        scope: &crate::luca::agent_inbox::InboxScope,
        resident: &str,
        source: &str,
    ) -> Result<Option<(Hex64, Option<Hex64>, Option<Hex64>, Hex64)>, String> {
        for row in self.dispatches.values() {
            let Some(action) = &row.inbox_action else {
                continue;
            };
            if &action.action_key != key {
                continue;
            }
            if &action.input_fingerprint != fingerprint
                || &action.scope != scope
                || row.resident_pubkey != resident
                || row.conversation_id != source
            {
                return Err("inbox idempotency key belongs to a different original action".into());
            }
            if action.phase == InboxChildActionPhase::Request {
                if row.state == ManagedDispatchState::Published {
                    let event = Hex64::parse(
                        row.published_event_id
                            .as_deref()
                            .ok_or("accepted inbox action has no event id")?,
                    )
                    .map_err(|_| "accepted inbox action has invalid event id")?;
                    return Ok(Some((
                        event,
                        action.anchor_event_id.clone(),
                        action.exchange_id.clone(),
                        action.parent_dispatch_id.clone(),
                    )));
                }
                if self
                    .dispatches
                    .get(&(
                        action.parent_dispatch_id.as_str().to_owned(),
                        resident.to_owned(),
                    ))
                    .is_none_or(|parent| parent.state != ManagedDispatchState::Active)
                {
                    return Err("original inbox action is uncertain or ended; it will not be reissued under a different turn".into());
                }
            }
        }
        Ok(None)
    }
    /// Allocate at most four semantic actions (two publication slots each) per
    /// current invocation. Replays never consume another slot or normal final.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn stage_inbox_child_action(
        &mut self,
        parent: &str,
        child: &Hex64,
        resident: &str,
        conversation: &str,
        epoch: u64,
        binding: InboxChildActionBinding,
        recipients: Vec<String>,
        now: u64,
    ) -> Result<ActiveDispatch, String> {
        self.authorize_continuity_turn(parent, resident, conversation, epoch, now)
            .map_err(|_| "inbox action parent is no longer authorized")?;
        let key = (child.as_str().to_owned(), resident.to_owned());
        if let Some(existing) = self.dispatches.get(&key) {
            let mut frozen = existing.inbox_action.clone();
            if binding.phase == InboxChildActionPhase::Request && binding.exchange_id.is_none() {
                if let Some(frozen) = &mut frozen {
                    frozen.exchange_id = None;
                }
            }
            if frozen.as_ref() != Some(&binding) {
                return Err("inbox action retry conflicts with its frozen intent".into());
            }
            return Ok(existing.clone());
        }
        if self
            .dispatches
            .values()
            .filter_map(|row| row.inbox_action.as_ref())
            .filter(|action| action.parent_dispatch_id.as_str() == parent)
            .count()
            >= 8
        {
            return Err("inbox action allowance exhausted for this owner request".into());
        }
        let previous = self.dispatches.clone();
        let mut row = self
            .dispatches
            .get(&(parent.to_owned(), resident.to_owned()))
            .cloned()
            .ok_or("inbox action parent is unavailable")?;
        if row.state != ManagedDispatchState::Active || row.submitted_event_id.is_some() {
            return Err("inbox actions cannot begin after the parent final is frozen".into());
        }
        row.trigger_event_id = child.as_str().to_owned();
        row.source_dispatch_id = Some(parent.to_owned());
        row.causal_parent_action_id = Some(binding.action_key.as_str().to_owned());
        if let Some(root) = &binding.root_event_id {
            row.root_event_id = Some(root.as_str().to_owned());
            row.thread_id = Some(format!("thread:{}", root.as_str()));
        }
        if let Some(reply) = binding.reply_event_id.as_ref() {
            row.reply_event_id = Some(reply.as_str().to_owned());
        }
        if let Some(surface) = binding.response_surface {
            row.response_surface = Some(surface);
        }
        // New tasks inherit the original source surface so the existing exact
        // owner-return verifier keeps the same route. Explicit task replies
        // supply their validated placement separately.
        row.inbox_task = None;
        row.inbox_binding_required = false;
        row.inbox_action = Some(binding);
        row.inbox_owner_status = None;
        // Retain the parent's total execution/time deadline, not a fresh TTL.
        row.resolved_p_tags = recipients;
        row.awareness_context_binding = None;
        row.awareness_reply_lease = None;
        row.state = ManagedDispatchState::Active;
        row.session_epoch = Some(epoch);
        row.submitted_event_id = None;
        row.published_event_id = None;
        row.outbox_finalized = false;
        self.dispatches.insert(key, row.clone());
        self.prune(now);
        if let Err(error) = self.persist() {
            self.dispatches = previous;
            return Err(error);
        }
        Ok(row)
    }

    /// Immutable host action metadata; never inferred from model-supplied tags.
    pub(crate) fn inbox_child_action(
        &self,
        dispatch: &str,
        resident: &str,
    ) -> Option<InboxChildActionBinding> {
        self.dispatches
            .get(&(dispatch.to_owned(), resident.to_owned()))?
            .inbox_action
            .clone()
    }

    /// Freeze the bounded exchange chosen by the resolver on its host action.
    pub(crate) fn bind_inbox_child_exchange(
        &mut self,
        dispatch: &str,
        resident: &str,
        exchange: &Hex64,
    ) -> Result<(), String> {
        let previous = self.dispatches.clone();
        let Some(row) = self
            .dispatches
            .get_mut(&(dispatch.to_owned(), resident.to_owned()))
        else {
            return Ok(());
        };
        let Some(action) = &mut row.inbox_action else {
            return Ok(());
        };
        if action.phase != InboxChildActionPhase::Request {
            return Err("an inbox anchor cannot spend an exchange turn".into());
        }
        if action
            .exchange_id
            .as_ref()
            .is_some_and(|current| current != exchange)
        {
            return Err("inbox action exchange cannot change".into());
        }
        action.exchange_id = Some(exchange.clone());
        if let Err(error) = self.persist() {
            self.dispatches = previous;
            return Err(error);
        }
        Ok(())
    }

    /// Stop only publication actions mapped to this exact bounded exchange.
    pub(crate) fn cancel_inbox_exchange_actions(
        &mut self,
        owner: &str,
        source: &str,
        exchange: &Hex64,
    ) -> Result<(), String> {
        let previous = self.dispatches.clone();
        let parents: BTreeSet<_> = self
            .dispatches
            .values()
            .filter(|row| row.owner_pubkey == owner && row.conversation_id == source)
            .filter_map(|row| {
                row.inbox_action
                    .as_ref()
                    .filter(|action| action.exchange_id.as_ref() == Some(exchange))
                    .map(|action| {
                        (
                            action.parent_dispatch_id.as_str().to_owned(),
                            row.resident_pubkey.clone(),
                        )
                    })
            })
            .collect();
        let mut changed = false;
        for row in self.dispatches.values_mut() {
            if row.owner_pubkey == owner
                && row.conversation_id == source
                && (parents.contains(&(row.trigger_event_id.clone(), row.resident_pubkey.clone()))
                    || row
                        .inbox_action
                        .as_ref()
                        .is_some_and(|action| action.exchange_id.as_ref() == Some(exchange)))
                && matches!(
                    row.state,
                    ManagedDispatchState::Pending | ManagedDispatchState::Active
                )
            {
                row.state = ManagedDispatchState::Cancelled;
                row.interruption_reason = None;
                row.outbox_finalized = row.session_epoch.is_none();
                changed = true;
            }
        }
        if changed {
            if let Err(error) = self.persist() {
                self.dispatches = previous;
                return Err(error);
            }
        }
        Ok(())
    }
}
