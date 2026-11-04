//! The exchange side of the resident publisher: what it may do without an
//! exchange authority, how it reads a relay refusal, and how a held reply is
//! settled and announced.
//!
//! A child module rather than a sibling, so it keeps the publisher's private
//! state without widening anything. The trait implementation itself stays next
//! to the publisher; only the machinery it leans on lives here.

use super::*;

impl ManagedMessagePublisher {
    pub(super) fn admit_inbox_owner_status(
        &self,
        request: &ManagedMessagePublishRequestV1,
        now: u64,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        if !self
            .dispatch_store
            .lock()
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .has_inbox_owner_status(
                request.dispatch_receipt_id.as_str(),
                request.resident_pubkey.as_str(),
            )
        {
            return Ok(());
        }
        if request.exchange.is_some() || request.resolved_p_tags != [request.owner_pubkey.clone()] {
            return Err(ManagedPublicationAuthorityError::Denied);
        }
        let authority = self
            .exchange
            .as_ref()
            .ok_or(ManagedPublicationAuthorityError::Unavailable)?;
        if ExchangeResolver::new(
            authority.relay.as_ref(),
            &authority.store,
            &self.dispatch_store,
        )
        .inbox_owner_status_plan(request, now)
        .map_err(|denial| ManagedPublicationAuthorityError::ExchangeDenied(denial.code()))?
        .is_none()
        {
            return Err(ManagedPublicationAuthorityError::Denied);
        }
        Ok(())
    }
    /// Freeze exact resident request provenance before waking/publishing. This
    /// authorizes no effect by itself: readers also require the signed event
    /// to exist canonically and match this exact child dispatch receipt.
    pub(super) fn persist_inbox_action_provenance(
        &self,
        entry: &ManagedOutboxReconcileEntry,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        let action = self
            .dispatch_store
            .lock()
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .inbox_child_action(
                entry.request.dispatch_receipt_id.as_str(),
                entry.request.resident_pubkey.as_str(),
            );
        let Some(action) = action.filter(|action| {
            action.phase == super::super::agent_inbox_binding::InboxChildActionPhase::Request
        }) else {
            return Ok(());
        };
        let app = &self
            .handoff_scheduler
            .as_ref()
            .ok_or(ManagedPublicationAuthorityError::Unavailable)?
            .app;
        if tauri::async_runtime::block_on(super::super::agent_inbox::active_scope(app))
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            != action.scope
        {
            return Err(ManagedPublicationAuthorityError::Denied);
        }
        let tag = entry
            .request
            .exchange
            .as_ref()
            .ok_or(ManagedPublicationAuthorityError::Denied)?;
        let authority = self
            .exchange
            .as_ref()
            .ok_or(ManagedPublicationAuthorityError::Unavailable)?;
        let head = authority
            .relay
            .fetch_head(&tag.exchange_id, &entry.request.owner_pubkey)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .ok_or(ManagedPublicationAuthorityError::Denied)?;
        let root = authority
            .relay
            .fetch_trigger(&head.record.root_event_id)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .ok_or(ManagedPublicationAuthorityError::Denied)?;
        if !root.verify_id()
            || !root.verify_signature()
            || root.id.to_hex() != head.record.root_event_id.as_str()
        {
            return Err(ManagedPublicationAuthorityError::Denied);
        }
        let origin = if root.pubkey.to_hex() == entry.request.owner_pubkey.as_str() {
            head.record.root_event_id.clone()
        } else {
            authority
                .relay
                .task_anchor_origin(
                    &head.record.root_event_id,
                    &entry.request.owner_pubkey,
                    &head.record.opened_by,
                    &head.record.conversation_id,
                )
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
                .ok_or(ManagedPublicationAuthorityError::Denied)?
        };
        super::super::agent_inbox_anchors::record(
            app,
            super::super::agent_inbox_anchors::TaskAnchor {
                scope: action.scope,
                anchor_event_id: entry.event_id.clone(),
                owner_trigger_event_id: origin,
                source: entry.request.conversation_id.clone(),
                initiator: entry.request.resident_pubkey.clone(),
                recipient: action.recipient_pubkey,
                action_key: action.action_key,
                input_fingerprint: action.input_fingerprint,
                parent_dispatch_id: action.parent_dispatch_id,
                anchor_dispatch_id: Hex64::parse(entry.request.dispatch_receipt_id.as_str())
                    .map_err(|_| ManagedPublicationAuthorityError::Invalid)?,
                exchange_id: Some(tag.exchange_id.clone()),
            },
        )
        .map_err(|_| ManagedPublicationAuthorityError::Unavailable)
    }

    /// A child slot retains its original turn, source grants and exact audience.
    /// It never manufactures another clean context or borrows a later turn.
    pub(super) fn admit_inbox_child_action(
        &self,
        request: &ManagedMessagePublishRequestV1,
        now: u64,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        let action = self
            .dispatch_store
            .lock()
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .inbox_child_action(
                request.dispatch_receipt_id.as_str(),
                request.resident_pubkey.as_str(),
            );
        let Some(action) = action else {
            return Ok(());
        };
        let app = &self
            .handoff_scheduler
            .as_ref()
            .ok_or(ManagedPublicationAuthorityError::Unavailable)?
            .app;
        if tauri::async_runtime::block_on(super::super::agent_inbox::active_scope(app))
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            != action.scope
        {
            return Err(ManagedPublicationAuthorityError::Denied);
        }
        self.dispatch_store
            .lock()
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .check_inbox_child_parent(
                request.dispatch_receipt_id.as_str(),
                request.resident_pubkey.as_str(),
                now,
            )
            .map_err(Self::map_dispatch_error)?;
        let exchange = self
            .exchange
            .as_ref()
            .ok_or(ManagedPublicationAuthorityError::Unavailable)?;
        let members = exchange
            .relay
            .verified_source_members(&request.conversation_id)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        if !members.contains(&request.owner_pubkey)
            || !members.contains(&request.resident_pubkey)
            || action.scope.owner_pubkey != request.owner_pubkey
        {
            return Err(ManagedPublicationAuthorityError::Denied);
        }
        match action.phase {
            super::super::agent_inbox_binding::InboxChildActionPhase::Anchor => {
                if request.exchange.is_some()
                    || request.resolved_p_tags != [request.owner_pubkey.clone()]
                {
                    return Err(ManagedPublicationAuthorityError::Denied);
                }
            }
            super::super::agent_inbox_binding::InboxChildActionPhase::Request => {
                let tag = request
                    .exchange
                    .as_ref()
                    .ok_or(ManagedPublicationAuthorityError::Denied)?;
                let head = exchange
                    .relay
                    .fetch_head(&tag.exchange_id, &request.owner_pubkey)
                    .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
                    .ok_or(ManagedPublicationAuthorityError::Denied)?;
                if !head.record.admits_turn(tag.turn, now)
                    || head.record.conversation_id != request.conversation_id
                    || !head.record.members.contains(&request.resident_pubkey)
                    || !head.record.members.contains(&action.recipient_pubkey)
                    || !members.contains(&action.recipient_pubkey)
                    || request
                        .resolved_p_tags
                        .iter()
                        .any(|key| key != &request.owner_pubkey && key != &action.recipient_pubkey)
                    || !request.resolved_p_tags.contains(&action.recipient_pubkey)
                {
                    return Err(ManagedPublicationAuthorityError::Denied);
                }
            }
        }
        Ok(())
    }

    /// Mapped owner clarifications are one exact invocation, not permission to
    /// mint another ping-pong exchange or redirect a result after navigation.
    pub(super) fn admit_inbox_task_reply(
        &self,
        request: &ManagedMessagePublishRequestV1,
        now: u64,
    ) -> Result<bool, ManagedPublicationAuthorityError> {
        if self
            .dispatch_store
            .lock()
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .has_inbox_owner_status(
                request.dispatch_receipt_id.as_str(),
                request.resident_pubkey.as_str(),
            )
        {
            return Ok(false);
        }
        let binding = self
            .dispatch_store
            .lock()
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .inbox_task_binding(
                request.dispatch_receipt_id.as_str(),
                request.resident_pubkey.as_str(),
            );
        let Some(binding) = binding else {
            return Ok(false);
        };
        let app = &self
            .handoff_scheduler
            .as_ref()
            .ok_or(ManagedPublicationAuthorityError::Unavailable)?
            .app;
        if tauri::async_runtime::block_on(super::super::agent_inbox::active_scope(app))
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            != binding.scope
        {
            return Err(ManagedPublicationAuthorityError::Denied);
        }
        let exchange = self
            .exchange
            .as_ref()
            .ok_or(ManagedPublicationAuthorityError::Unavailable)?;
        let head = exchange
            .relay
            .fetch_head(&binding.attempt_exchange_id, &request.owner_pubkey)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .ok_or(ManagedPublicationAuthorityError::Denied)?;
        let spent = exchange
            .relay
            .spent_turns(&head.record)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        let members = exchange
            .relay
            .verified_source_members(&binding.origin_conversation_id)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        if request.exchange.as_ref().is_some_and(|tag| {
            tag.exchange_id != binding.attempt_exchange_id
                || !head.record.admits_turn(tag.turn, now)
        }) || binding.scope.owner_pubkey != request.owner_pubkey
            || exchange
                .relay
                .owner()
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
                != request.owner_pubkey
            || binding.recipient_pubkey != request.resident_pubkey
            || binding.origin_conversation_id != request.conversation_id
            || request.resolved_p_tags != [request.owner_pubkey.clone()]
            || head.record.owner != request.owner_pubkey
            || head.record.conversation_id != binding.origin_conversation_id
            || &head.record.root_event_id != binding.attempt_root()
            || head.record.opened_by != binding.initiator_pubkey
            || !head.record.members.contains(&request.resident_pubkey)
            || head
                .record
                .phase(u8::try_from(spent.len()).unwrap_or(u8::MAX), now)
                != luca_protocol::ExchangePhase::Open
            || !members.contains(&request.owner_pubkey)
            || !members.contains(&request.resident_pubkey)
        {
            return Err(ManagedPublicationAuthorityError::Denied);
        }
        Ok(true)
    }

    /// User text spends no turn; its resident answer spends exactly one of
    /// the attempt's bounded turns under an ordinary frozen outbox decision.
    pub(super) fn inbox_task_exchange_plan(
        &self,
        request: &ManagedMessagePublishRequestV1,
        now: u64,
    ) -> Result<ExchangePlan, ManagedPublicationAuthorityError> {
        let binding = self
            .dispatch_store
            .lock()
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .inbox_task_binding(
                request.dispatch_receipt_id.as_str(),
                request.resident_pubkey.as_str(),
            )
            .ok_or(ManagedPublicationAuthorityError::Denied)?;
        let authority = self
            .exchange
            .as_ref()
            .ok_or(ManagedPublicationAuthorityError::Unavailable)?;
        let key = super::super::exchange_store::decision_key(
            request.dispatch_receipt_id.as_str(),
            request.resident_pubkey.as_str(),
        );
        let existing = authority
            .store
            .lock()
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .decision(&key)
            .cloned();
        let tag = if let Some(decision) = existing {
            decision
                .exchange
                .ok_or(ManagedPublicationAuthorityError::Denied)?
        } else {
            let head = authority
                .relay
                .fetch_head(&binding.attempt_exchange_id, &request.owner_pubkey)
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
                .ok_or(ManagedPublicationAuthorityError::Denied)?;
            let spent = authority
                .relay
                .spent_turns(&head.record)
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            let turn = (1..=head.record.bucket)
                .find(|turn| !spent.contains(turn))
                .ok_or(ManagedPublicationAuthorityError::ExchangeDenied(
                    "exchange_exhausted",
                ))?;
            if !head.record.admits_turn(turn, now) {
                return Err(ManagedPublicationAuthorityError::Denied);
            }
            let tag = ExchangeTurnTag::new(binding.attempt_exchange_id, turn)
                .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
            authority
                .store
                .lock()
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
                .record_decision(
                    &key,
                    super::super::exchange_store::ExchangeDecision {
                        exchange: Some(tag.clone()),
                        ..Default::default()
                    },
                )
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            tag
        };
        Ok(ExchangePlan {
            exchange: Some(tag),
            granted_p_tags: Vec::new(),
            replace_p_tags: false,
        })
    }

    /// Only a current owner-authorized bounded exchange can widen the reply
    /// audience. Source consent is checked separately for every dependency.
    pub(super) fn awareness_exchange_guests(
        &self,
        request: &ManagedMessagePublishRequestV1,
        now: u64,
    ) -> Result<std::collections::BTreeSet<luca_protocol::Hex64>, ManagedPublicationAuthorityError>
    {
        let Some(tag) = &request.exchange else {
            return Ok(Default::default());
        };
        let authority = self
            .exchange
            .as_ref()
            .ok_or(ManagedPublicationAuthorityError::Unavailable)?;
        let relay = authority.relay.as_ref();
        let head = relay
            .fetch_head(&tag.exchange_id, &request.owner_pubkey)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .ok_or(ManagedPublicationAuthorityError::Denied)?;
        let owned = relay
            .owned_residents()
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        if relay
            .owner()
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            != request.owner_pubkey
            || head.record.owner != request.owner_pubkey
            || head.record.conversation_id != request.conversation_id
            || !head.record.admits_turn(tag.turn, now)
            || !head.record.members.contains(&request.resident_pubkey)
            || head
                .record
                .members
                .iter()
                .any(|key| key != &request.owner_pubkey && !owned.contains(key))
            || request
                .resolved_p_tags
                .iter()
                .any(|key| key != &request.owner_pubkey && !head.record.members.contains(key))
        {
            return Err(ManagedPublicationAuthorityError::Denied);
        }
        Ok(head
            .record
            .members
            .into_iter()
            .filter(|key| key != &request.owner_pubkey && key != &request.resident_pubkey)
            .collect())
    }

    /// Wake recipients only after exact dispatch and live exchange checks, with
    /// no authority/store lock held during runtime startup. Submission rechecks
    /// cancellation afterwards; a concurrent Stop still prevents the message.
    pub(super) fn prepare_exchange_delivery(
        &self,
        entry: &ManagedOutboxReconcileEntry,
        now: u64,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        let request = &entry.request;
        let Some(tag) = &request.exchange else {
            return Ok(());
        };
        if request.resolved_p_tags == [request.owner_pubkey.clone()] {
            return Ok(());
        }
        let readiness = self
            .dispatch_store
            .lock()
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .authorize_reconciliation(request, entry.event_id.as_str(), now)
            .map_err(Self::map_dispatch_error)?;
        if !matches!(readiness, ManagedDispatchReconciliation::Ready) {
            return Ok(());
        }
        if self.admit_awareness_reply(request, now).is_err() {
            // The ordinary serialized publication gate settles the refusal.
            // This preflight must not start a process for a revoked scope.
            return Ok(());
        }
        let exchange = self
            .exchange
            .as_ref()
            .ok_or(ManagedPublicationAuthorityError::Unavailable)?;
        let head = exchange
            .relay
            .fetch_head(&tag.exchange_id, &request.owner_pubkey)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .ok_or(ManagedPublicationAuthorityError::Denied)?;
        if head.record.owner != request.owner_pubkey
            || head.record.conversation_id != request.conversation_id
            || !head.record.members.contains(&request.resident_pubkey)
            || !head.record.admits_turn(tag.turn, now)
        {
            // Leave closed/expired/raced turns to the existing relay refusal
            // and visible held-reply settlement, without waking anyone.
            return Ok(());
        }
        let owned = exchange
            .relay
            .owned_residents()
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        // Validate the complete audience before starting any process.
        let targets: Vec<_> = request
            .resolved_p_tags
            .iter()
            .filter(|key| **key != request.owner_pubkey && **key != request.resident_pubkey)
            .collect();
        if targets
            .iter()
            .any(|key| !owned.contains(*key) || !head.record.members.contains(key))
        {
            return Err(ManagedPublicationAuthorityError::Denied);
        }
        let event = Self::parse_exact_event(request, &entry.signed_event_json)?;
        for target in targets {
            if exchange
                .relay
                .wake_resident(
                    target,
                    &request.owner_pubkey,
                    &entry.event_id,
                    event.created_at.as_secs(),
                )
                .is_err()
            {
                // Never claim delivery, switch harnesses, or change approvals.
                // The caller settles this attempt once, rather than spawning
                // a broken runtime repeatedly on every outbox sweep.
                luca_log!(
                    warn,
                    "luca-exchange: configured recipient runtime could not be started"
                );
                return Err(ManagedPublicationAuthorityError::ExchangeDenied(
                    "exchange_recipient_unavailable",
                ));
            }
        }
        Ok(())
    }

    /// What a publisher with no exchange authority attached may still do.
    ///
    /// Nothing that needs an exchange. A final that claims a turn cannot be
    /// checked, and a final whose trigger was a sibling has no business
    /// publishing outside one; both are refused. An ordinary owner-triggered
    /// reply is unaffected.
    pub(super) fn resolve_without_exchange_authority(
        &self,
        request: &ManagedMessagePublishRequestV1,
    ) -> Result<ExchangePlan, ManagedPublicationAuthorityError> {
        if request.exchange.is_some() {
            return Err(ManagedPublicationAuthorityError::ExchangeDenied(
                ExchangeDenial::Unavailable.code(),
            ));
        }
        let depth = self
            .dispatch_store
            .lock()
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .descendant_depth(
                request.dispatch_receipt_id.as_str(),
                request.resident_pubkey.as_str(),
            );
        match depth {
            Ok(0) => Ok(ExchangePlan::unchanged()),
            Ok(_) => Err(ManagedPublicationAuthorityError::ExchangeDenied(
                ExchangeDenial::Unknown.code(),
            )),
            // An unknown dispatch is not this gate's refusal to make; the
            // dispatch authority refuses it a moment later, by name.
            Err(DispatchAuthorizationError::Unknown) => Ok(ExchangePlan::unchanged()),
            Err(_) => Err(ManagedPublicationAuthorityError::Unavailable),
        }
    }

    /// Turn one relay refusal into a durable decision, holding the dispatch's
    /// authority open only for a turn collision.
    pub(super) fn settle_relay_refusal(
        store: &mut ManagedDispatchStore,
        entry: &ManagedOutboxReconcileEntry,
        message: &str,
    ) -> Result<SerializedSubmission, ManagedPublicationAuthorityError> {
        if classify_exchange_refusal(message) == Some(ExchangeRefusal::TurnTaken) {
            luca_log!(
                info,
                "luca-exchange: {} lost the race for that turn — re-signing on the next free one",
                entry.request.resident_pubkey.as_str()
            );
            return Ok(SerializedSubmission::ExchangeTurnTaken);
        }
        store
            .mark_rejected(&[(
                entry.request.dispatch_receipt_id.as_str().to_owned(),
                entry.request.resident_pubkey.as_str().to_owned(),
            )])
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        match classify_exchange_refusal(message) {
            Some(ExchangeRefusal::Held(denial)) => Ok(SerializedSubmission::ExchangeHeld(denial)),
            Some(ExchangeRefusal::TurnTaken) | None => Ok(SerializedSubmission::Rejected),
        }
    }

    /// A reply the exchange refused is never discarded silently: the room is
    /// told, in the owner's voice, that it was held — and why.
    ///
    /// Every held path passes through here: the desktop's own pre-check, the
    /// relay's refusal of frozen bytes, and a retune that a Stop ended. A turn
    /// collision never does; that reply is not held, it is re-signed.
    pub(super) fn tell_the_room_the_reply_was_held(
        &self,
        request: &ManagedMessagePublishRequestV1,
        denial: ExchangeDenial,
    ) {
        if denial.held_note_tail().is_none() {
            return;
        }
        let Some(exchange) = &self.exchange else {
            luca_log!(
                warn,
                "luca-exchange: {}'s reply was held ({}) and the room could not be told",
                request.resident_pubkey.as_str(),
                denial.code()
            );
            return;
        };
        let name = exchange.relay.display_name(&request.resident_pubkey);
        let Some(note) = ExchangeNote::reply_was_held(
            request.exchange.as_ref().map(|tag| tag.exchange_id.clone()),
            request.resident_pubkey.clone(),
            &name,
            denial,
        ) else {
            return;
        };
        crate::luca::exchange::publish_note(
            exchange.relay.as_ref(),
            &request.conversation_id,
            &note,
        );
    }

    /// End a retune the exchange refused: unbind the refused bytes, take the
    /// entry to its terminal state, and tell the room why.
    ///
    /// A collision leaves the row deliberately live so the draft can be
    /// re-signed. When the retune itself is refused — a Stop landed mid-race,
    /// the deadline passed, the bucket emptied — that liveness becomes a reply
    /// suspended forever against bytes the relay already threw away. This is
    /// where it ends instead.
    pub(super) fn hold_after_failed_retune(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        refused_event_id: &str,
        outbox: &mut ManagedMessageOutbox,
        denial: ExchangeDenial,
    ) -> ManagedPublicationAuthorityError {
        if let Err(error) = self.settle_failed_retune(request, refused_event_id, outbox) {
            luca_log!(warn,
                "luca-exchange: {} was refused ({}) but the reply could not be settled — the room is not told, and this stays open",
                request.resident_pubkey.as_str(),
                denial.code()
            );
            return error;
        }
        self.tell_the_room_the_reply_was_held(request, denial);
        ManagedPublicationAuthorityError::ExchangeDenied(denial.code())
    }

    pub(super) fn settle_failed_retune(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        refused_event_id: &str,
        outbox: &mut ManagedMessageOutbox,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        let receipt = request.dispatch_receipt_id.as_str().to_owned();
        let resident = request.resident_pubkey.as_str().to_owned();
        {
            let mut store = self
                .dispatch_store
                .lock()
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            // The refused bytes are provably not stored — the relay is the one
            // that refused them — so the binding goes before the row does. A
            // dispatch that already moved on has nothing to unbind, and saying
            // so is not a reason to leave the reply hanging.
            if let Err(error) = store.release_exchange_submission(
                &receipt,
                &resident,
                request.cancellation_epoch.get(),
                refused_event_id,
            ) {
                luca_log!(warn,
                    "luca-exchange: {resident}'s refused bytes could not be unbound ({error:?}) — settling the held reply anyway"
                );
            }
            store
                .mark_rejected(&[(receipt.clone(), resident.clone())])
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        }
        outbox
            .reject_during_reconciliation(&request.idempotency_key)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        {
            let mut store = self
                .dispatch_store
                .lock()
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            store
                .recover_terminal_outbox_finalization(
                    &receipt,
                    &resident,
                    refused_event_id,
                    crate::luca::managed_dispatch_store::ManagedDispatchState::Rejected,
                )
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        }
        outbox
            .mark_authority_finalized(&request.idempotency_key)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)
    }
}
