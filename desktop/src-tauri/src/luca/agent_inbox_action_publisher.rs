//! Trusted semantic actions serviced by the existing resident signing thread.
use super::*;
use crate::luca::{
    agent_inbox_actions::ActionRequest,
    agent_inbox_binding::{InboxChildActionBinding, InboxChildActionPhase},
    exchange_relay::{AppExchangeRelay, ExchangeRelay},
    managed_dispatch_store::{global_dispatch_store, ActiveDispatch},
};
use luca_protocol::{
    derive_message_publish_idempotency_key, OpaqueId, SafeU53, MESSAGE_PUBLISH_PROTOCOL,
};

fn digest(value: &impl serde::Serialize) -> Result<Hex64, String> {
    Hex64::parse(hex::encode(Sha256::digest(
        serde_json::to_vec(value).map_err(|_| "inbox action fingerprint failed")?,
    )))
    .map_err(|_| "inbox action fingerprint failed".into())
}

fn publication_event(result: ManagedMessagePublishResultV1) -> Result<Hex64, String> {
    match result {
        ManagedMessagePublishResultV1::Published { event_id, .. }
        | ManagedMessagePublishResultV1::Replayed { event_id, .. } => Ok(event_id),
        ManagedMessagePublishResultV1::Cancelled { .. } => {
            Err("agent inbox action was cancelled".into())
        }
        ManagedMessagePublishResultV1::Unavailable { .. } => {
            Err("agent inbox action delivery is uncertain; retry the same idempotency key".into())
        }
        _ => Err("agent inbox action was refused by current publication authority".into()),
    }
}

fn request(
    row: &ActiveDispatch,
    draft: String,
    exchange: Option<luca_protocol::ExchangeTurnTag>,
) -> Result<ManagedMessagePublishRequestV1, String> {
    let dispatch =
        OpaqueId::parse(&row.trigger_event_id).map_err(|_| "inbox child dispatch is invalid")?;
    let resident =
        Hex64::parse(&row.resident_pubkey).map_err(|_| "inbox action resident is invalid")?;
    Ok(ManagedMessagePublishRequestV1 {
        protocol: MESSAGE_PUBLISH_PROTOCOL.into(),
        turn_id: dispatch.clone(),
        idempotency_key: derive_message_publish_idempotency_key(&dispatch, &resident)
            .map_err(|_| "inbox action retry key is invalid")?,
        owner_pubkey: Hex64::parse(&row.owner_pubkey).map_err(|_| "inbox owner is invalid")?,
        resident_pubkey: resident,
        conversation_id: OpaqueId::parse(&row.conversation_id)
            .map_err(|_| "inbox source is invalid")?,
        thread_id: row
            .thread_id
            .as_ref()
            .map(OpaqueId::parse)
            .transpose()
            .map_err(|_| "inbox thread is invalid")?,
        root_event_id: row
            .root_event_id
            .as_ref()
            .map(Hex64::parse)
            .transpose()
            .map_err(|_| "inbox root is invalid")?,
        reply_event_id: row
            .reply_event_id
            .as_ref()
            .map(Hex64::parse)
            .transpose()
            .map_err(|_| "inbox reply is invalid")?,
        response_surface: row.response_surface,
        resolved_p_tags: row
            .resolved_p_tags
            .iter()
            .map(Hex64::parse)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "inbox recipients are invalid")?,
        final_draft: draft,
        dispatch_receipt_id: dispatch,
        cancellation_epoch: SafeU53::new(
            row.session_epoch.ok_or("inbox child session is missing")?,
        )
        .map_err(|_| "inbox child session is invalid")?,
        exchange,
        bucket_hint: None,
        attachments: Vec::new(),
    })
}

impl ResidentSigningBroker {
    pub(super) fn service_inbox_actions(&mut self) {
        if let Some(action) = self.inbox_actions.next() {
            let result = self.publish_inbox_action(&action);
            let _ = action.response.send(result);
        }
    }

    fn publish_inbox_action(
        &mut self,
        action: &ActionRequest,
    ) -> Result<serde_json::Value, String> {
        let session = self.session.binding().clone();
        if action.owner != session.owner_pubkey
            || action.resident != session.resident_pubkey
            || action.epoch != session.session_epoch.get()
        {
            return Err("agent inbox action session is stale".into());
        }
        let scope =
            tauri::async_runtime::block_on(crate::luca::agent_inbox::active_scope(&action.app))?;
        if scope != action.expected_scope
            || scope.owner_pubkey != action.owner
            || session.relay_url != action.expected_relay
        {
            return Err("agent inbox owner or community changed".into());
        }
        let active = crate::luca::communication_turn_registry::authorize_unique(
            action.resident.as_str(),
            action.epoch,
            action.conversation.as_str(),
        )
        .map_err(|_| "agent inbox action has no unique active turn")?;
        if active != action.turn {
            return Err(
                "agent inbox action's exact initiating turn ended; another turn cannot replace it"
                    .into(),
            );
        }
        let parent = Hex64::parse(active.dispatch_receipt_id.as_str())
            .map_err(|_| "inbox action origin is invalid")?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "inbox clock unavailable")?
            .as_secs();
        let relay = AppExchangeRelay::new(action.app.clone());
        if relay.owner().map_err(|error| error.to_string())? != action.owner
            || !relay
                .owned_residents()
                .map_err(|error| error.to_string())?
                .contains(&action.input.recipient_pubkey)
            || action.input.recipient_pubkey == action.resident
        {
            return Err("agent inbox recipient must be an exact distinct owned resident".into());
        }
        let members = relay
            .verified_source_members(&action.conversation)
            .map_err(|error| error.to_string())?;
        if !members.contains(&action.owner) || !members.contains(&action.resident) {
            return Err("agent inbox action source access was revoked".into());
        }
        let store = global_dispatch_store(&action.app)?;
        let authority = store
            .lock()
            .map_err(|_| "inbox dispatch store unavailable")?
            .authorize_continuity_turn(
                parent.as_str(),
                action.resident.as_str(),
                action.conversation.as_str(),
                action.epoch,
                now,
            )
            .map_err(|_| "inbox action parent was stopped or expired")?;
        if authority.owner_pubkey != action.owner {
            return Err("inbox action origin owner changed".into());
        }
        let key = digest(&serde_json::json!([
            "luca.inbox.action.v1",
            scope,
            action.resident,
            action.input.idempotency_key
        ]))?;
        let fingerprint = digest(&action.input)?;
        if let Some((event, anchor, exchange, origin)) = store
            .lock()
            .map_err(|_| "inbox dispatch store unavailable")?
            .accepted_inbox_action(
                &key,
                &fingerprint,
                &scope,
                action.resident.as_str(),
                action.conversation.as_str(),
            )?
        {
            return Ok(
                serde_json::json!({"state":"relay_accepted","recipientExecution":"not_confirmed","eventId":event,"taskId":exchange,
                "correspondenceId":crate::luca::agent_inbox::correspondence_id(&scope,&[action.resident.clone(),action.input.recipient_pubkey.clone()]),
                "anchorEventId":anchor,"originRequestEventId":origin,"replayed":true,"agentFinalSlotConsumed":false}),
            );
        }
        let child = digest(&serde_json::json!([key, "request"]))?;
        let mut proposed = None;
        let mut root = None;
        let mut reply = None;
        let mut response_surface = None;
        let anchor = if let Some(exchange_id) = &action.input.exchange_id {
            let record = relay
                .fetch_head(exchange_id, &action.owner)
                .map_err(|error| error.to_string())?
                .ok_or("inbox reply task is unavailable")?
                .record;
            if record.conversation_id != action.conversation
                || !record.members.contains(&action.resident)
                || !record.members.contains(&action.input.recipient_pubkey)
                || !members.contains(&action.input.recipient_pubkey)
            {
                return Err("inbox reply task or source is not authorized".into());
            }
            let reply_id = action
                .input
                .reply_event_id
                .as_ref()
                .ok_or("agent inbox reply needs an exact task message target")?;
            let event = relay
                .fetch_trigger(reply_id)
                .map_err(|error| error.to_string())?
                .ok_or("inbox reply target unavailable")?;
            let tags: Vec<_> = event
                .tags
                .iter()
                .map(|tag| tag.as_slice().to_vec())
                .collect();
            let turn = luca_protocol::ExchangeTurnTag::find(&tags)
                .map_err(|_| "inbox reply target has an invalid task tag")?;
            let routing = crate::luca::managed_dispatch_routing::routing_from_event(&event)?;
            if event.id.to_hex() != reply_id.as_str()
                || event.kind != Kind::Custom(9)
                || !event.verify_id()
                || !event.verify_signature()
                || event.pubkey.to_hex() != action.input.recipient_pubkey.as_str()
                || routing.conversation_id != action.conversation.as_str()
                || !turn.is_some_and(|tag| &tag.exchange_id == exchange_id)
            {
                return Err(
                    "inbox reply target does not belong to the intended task/recipient".into(),
                );
            }
            let spent = relay
                .spent_turns(&record)
                .map_err(|error| error.to_string())?;
            let next = (1..=record.bucket)
                .find(|turn| !spent.contains(turn))
                .ok_or("inbox exchange is exhausted")?;
            if !record.admits_turn(next, now) {
                return Err(
                    "inbox task stopped or expired; explicit owner continuation is required".into(),
                );
            }
            proposed = Some(
                luca_protocol::ExchangeTurnTag::new(record.exchange_id.clone(), next)
                    .map_err(|_| "inbox turn invalid")?,
            );
            response_surface = Some(routing.response_surface);
            root = routing.root_event_id;
            reply = Some(event.id.to_hex());
            None
        } else if let Some(anchor) = &action.recovered_anchor {
            Some(anchor.clone())
        } else {
            if store
                .lock()
                .map_err(|_| "inbox dispatch store unavailable")?
                .descendant_depth(parent.as_str(), action.resident.as_str())
                .map_err(|_| "inbox parent unavailable")?
                != 0
            {
                return Err(
                    "new inbox delegation from a sibling task needs an owner-bounded new request"
                        .into(),
                );
            }
            let anchor_slot = digest(&serde_json::json!([key, "anchor"]))?;
            let binding = InboxChildActionBinding {
                scope: scope.clone(),
                parent_dispatch_id: parent.clone(),
                action_key: key.clone(),
                input_fingerprint: fingerprint.clone(),
                recipient_pubkey: action.input.recipient_pubkey.clone(),
                phase: InboxChildActionPhase::Anchor,
                anchor_event_id: None,
                exchange_id: None,
                root_event_id: None,
                reply_event_id: None,
                response_surface: None,
            };
            let row = store
                .lock()
                .map_err(|_| "inbox dispatch store unavailable")?
                .stage_inbox_child_action(
                    parent.as_str(),
                    &anchor_slot,
                    action.resident.as_str(),
                    action.conversation.as_str(),
                    action.epoch,
                    binding,
                    vec![action.owner.as_str().to_owned()],
                    now,
                )?;
            let subject: String = action
                .input
                .content
                .lines()
                .next()
                .unwrap_or("New request")
                .chars()
                .filter(|character| !character.is_control() && *character != '@')
                .take(120)
                .collect();
            let event_id = publication_event(self.prepare_and_publish_effective(
                &request(&row, format!("Task: {subject}"), None)?,
                now,
            ))?;
            crate::luca::agent_inbox_anchors::record(
                &action.app,
                crate::luca::agent_inbox_anchors::TaskAnchor {
                    scope: scope.clone(),
                    anchor_event_id: event_id.clone(),
                    owner_trigger_event_id: parent.clone(),
                    source: action.conversation.clone(),
                    initiator: action.resident.clone(),
                    recipient: action.input.recipient_pubkey.clone(),
                    action_key: key.clone(),
                    input_fingerprint: fingerprint.clone(),
                    parent_dispatch_id: parent.clone(),
                    anchor_dispatch_id: anchor_slot,
                    exchange_id: None,
                },
            )?;
            Some(event_id)
        };
        let binding = InboxChildActionBinding {
            scope: scope.clone(),
            parent_dispatch_id: parent.clone(),
            action_key: key,
            input_fingerprint: fingerprint,
            recipient_pubkey: action.input.recipient_pubkey.clone(),
            phase: InboxChildActionPhase::Request,
            anchor_event_id: anchor.clone(),
            exchange_id: action.input.exchange_id.clone(),
            root_event_id: root.and_then(|id| Hex64::parse(id).ok()),
            reply_event_id: reply.and_then(|id| Hex64::parse(id).ok()),
            response_surface,
        };
        let row = store
            .lock()
            .map_err(|_| "inbox dispatch store unavailable")?
            .stage_inbox_child_action(
                parent.as_str(),
                &child,
                action.resident.as_str(),
                action.conversation.as_str(),
                action.epoch,
                binding,
                if proposed.is_some() {
                    vec![action.input.recipient_pubkey.as_str().to_owned()]
                } else {
                    vec![action.owner.as_str().to_owned()]
                },
                now,
            )?;
        let event_id = publication_event(self.prepare_and_publish_message(
            &request(&row, action.input.content.trim().to_owned(), proposed)?,
            now,
        ))?;
        let event = relay
            .fetch_trigger(&event_id)
            .map_err(|error| error.to_string())?
            .ok_or("accepted inbox message is awaiting reconciliation")?;
        let tags: Vec<_> = event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect();
        let exchange = luca_protocol::ExchangeTurnTag::find(&tags)
            .map_err(|_| "accepted inbox message has invalid task identity")?
            .ok_or("accepted inbox message has no bounded exchange")?;
        Ok(
            serde_json::json!({"state":"relay_accepted","recipientExecution":"not_confirmed","eventId":event_id,"taskId":exchange.exchange_id,
            "correspondenceId":crate::luca::agent_inbox::correspondence_id(&scope,&[action.resident.clone(),action.input.recipient_pubkey.clone()]),
            "originRequestEventId":parent,"anchorEventId":anchor,"agentFinalSlotConsumed":false}),
        )
    }
}
