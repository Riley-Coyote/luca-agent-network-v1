//! Durable action outcomes survive bounded dispatch/outbox cache eviction.
use crate::luca::{
    agent_inbox::InboxScope,
    agent_inbox_anchors::TaskAnchor,
    exchange_relay::{AppExchangeRelay, ExchangeRelay},
};
use luca_protocol::{ExchangeTurnTag, Hex64, OpaqueId};
use tauri::AppHandle;

pub(crate) enum RecoveredAction {
    New,
    Accepted(TaskAnchor),
    Pending {
        parent: Hex64,
        anchor: Option<Hex64>,
    },
}

pub(crate) fn recover_action(
    app: &AppHandle,
    scope: &InboxScope,
    key: &Hex64,
    fingerprint: &Hex64,
    actor: &Hex64,
    source: &OpaqueId,
) -> Result<RecoveredAction, String> {
    let rows = crate::luca::agent_inbox_anchors::action_records(
        app,
        scope,
        key,
        fingerprint,
        actor,
        source,
    )?;
    recover_records(&rows, &AppExchangeRelay::new(app.clone()))
}

fn recover_records(
    rows: &[TaskAnchor],
    relay: &dyn ExchangeRelay,
) -> Result<RecoveredAction, String> {
    let Some(first) = rows.first() else {
        return Ok(RecoveredAction::New);
    };
    if rows.len() > luca_protocol::EXCHANGE_BUCKET_CEILING as usize + 2
        || rows
            .iter()
            .any(|row| row.parent_dispatch_id != first.parent_dispatch_id)
    {
        return Err("inbox retry provenance is inconsistent or exceeds its bound".into());
    }
    let mut accepted = None;
    let mut anchor = None;
    for row in rows {
        let Some(event) = relay
            .fetch_trigger(&row.anchor_event_id)
            .map_err(|error| error.to_string())?
        else {
            continue;
        };
        let tags: Vec<_> = event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect();
        let sources: Vec<_> = tags
            .iter()
            .filter(|tag| tag.first().map(String::as_str) == Some("h"))
            .collect();
        let receipts: Vec<_> = tags
            .iter()
            .filter(|tag| {
                tag.first().map(String::as_str) == Some(luca_protocol::MANAGED_DISPATCH_RECEIPT_TAG)
            })
            .collect();
        let recipients: Vec<_> = tags
            .iter()
            .filter(|tag| tag.first().map(String::as_str) == Some("p"))
            .filter_map(|tag| tag.get(1))
            .collect();
        if event.id.to_hex() != row.anchor_event_id.as_str()
            || event.kind != nostr::Kind::Custom(9)
            || !event.verify_id()
            || !event.verify_signature()
            || event.pubkey.to_hex() != row.initiator.as_str()
            || sources.len() != 1
            || sources[0].get(1).map(String::as_str) != Some(row.source.as_str())
            || receipts.len() != 1
            || receipts[0].get(1).map(String::as_str) != Some(row.anchor_dispatch_id.as_str())
        {
            return Err(
                "inbox retry canonical proof does not match its original signed intent".into(),
            );
        }
        let exchange =
            ExchangeTurnTag::find(&tags).map_err(|_| "inbox retry task tag is invalid")?;
        if let Some(task) = &row.exchange_id {
            if !exchange.is_some_and(|tag| &tag.exchange_id == task)
                || !recipients
                    .iter()
                    .any(|key| key.as_str() == row.recipient.as_str())
                || recipients.iter().any(|key| {
                    key.as_str() != row.recipient.as_str()
                        && key.as_str() != row.scope.owner_pubkey.as_str()
                })
            {
                return Err("inbox retry task audience or identity changed".into());
            }
            if accepted
                .as_ref()
                .is_some_and(|prior: &TaskAnchor| prior.anchor_event_id != row.anchor_event_id)
            {
                return Err(
                    "inbox retry has multiple uncertain accepted events; no new work was started"
                        .into(),
                );
            }
            accepted = Some(row.clone());
        } else {
            if exchange.is_some()
                || recipients.len() != 1
                || recipients[0].as_str() != row.scope.owner_pubkey.as_str()
            {
                return Err("inbox retry anchor is not owner-only".into());
            }
            anchor = Some(row.anchor_event_id.clone());
        }
    }
    if let Some(row) = accepted {
        return Ok(RecoveredAction::Accepted(row));
    }
    if rows.iter().any(|row| row.exchange_id.is_none()) && anchor.is_none() {
        return Err(
            "the original accepted task anchor is unavailable; it will not be replaced".into(),
        );
    }
    Ok(RecoveredAction::Pending {
        parent: first.parent_dispatch_id.clone(),
        anchor,
    })
}

#[cfg(test)]
#[path = "agent_inbox_action_recovery_tests.rs"]
mod tests;
