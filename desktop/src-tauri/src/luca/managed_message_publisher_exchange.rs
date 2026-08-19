//! The exchange side of the resident publisher: what it may do without an
//! exchange authority, how it reads a relay refusal, and how a held reply is
//! settled and announced.
//!
//! A child module rather than a sibling, so it keeps the publisher's private
//! state without widening anything. The trait implementation itself stays next
//! to the publisher; only the machinery it leans on lives here.

use super::*;

impl ManagedMessagePublisher {
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
            eprintln!(
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
            eprintln!(
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
            eprintln!(
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
                eprintln!(
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
