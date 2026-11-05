//! Explicit owner-triggered fresh attempts, using the existing exchange and send paths.
use luca_protocol::{ExchangePhase, ExchangeRecordV1, Hex64};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::{
    agent_inbox::{active_scope, InboxScope},
    agent_inbox_binding::InboxTaskBinding,
    agent_inbox_send::{InboxReplyInput, TASK_REPLY_TAG},
    agent_inbox_send_store as intents,
    exchange_relay::{AppExchangeRelay, ExchangeRelay},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PreparedAttempt {
    pub record: ExchangeRecordV1,
    pub previous: ExchangeRecordV1,
    pub previous_head: Hex64,
    pub created_at: u64,
}

fn same_attempt_authority(actual: &ExchangeRecordV1, frozen: &ExchangeRecordV1) -> bool {
    // Only lifecycle state may advance after our immutable attempt was accepted.
    let mut original = frozen.clone();
    original.state = actual.state.clone();
    &original == actual
}

/// Preparation signs and freezes, but never publishes, invites or wakes.
pub(super) async fn prepare(
    app: &AppHandle,
    scope: &InboxScope,
    input: &InboxReplyInput,
    fingerprint: String,
    new_topic: bool,
) -> Result<intents::ReplyIntent, String> {
    // Owner visibility is checked before any lineage or source-derived context.
    let page = super::agent_inbox::query_for_actor(
        app,
        scope.owner_pubkey.clone(),
        super::agent_inbox::InboxQuery {
            exchange_id: Some(input.exchange_id.clone()),
            limit: Some(1),
            ..Default::default()
        },
    )
    .await?;
    let visible = page.tasks.first().ok_or("inbox_task_unavailable")?;
    if visible.history_access != "current_source"
        || visible.record.members.len() != 2
        || !visible.record.members.contains(&input.recipient_pubkey)
    {
        return Err("inbox_source_unavailable: this operation requires the original authorized pair and source".into());
    }
    let resolved =
        super::agent_inbox_lineage::resolve_current(app, scope, &input.exchange_id).await?;
    if resolved.current_record.exchange_id != input.exchange_id {
        return Err(
            "inbox_stale_attempt: refresh this task before continuing or starting a topic".into(),
        );
    }
    let app_copy = app.clone();
    let previous = resolved.current_record.clone();
    let owner = scope.owner_pubkey.clone();
    let head = tokio::task::spawn_blocking(move || {
        AppExchangeRelay::new(app_copy)
            .fetch_head(&previous.exchange_id, &owner)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "inbox authority task failed")??
    .ok_or("inbox_task_unavailable")?;
    if !new_topic {
        let snapshot =
            super::exchange::get_exchange(app.clone(), input.exchange_id.as_str().to_owned())
                .await?
                .ok_or("inbox_task_unavailable")?;
        if snapshot.phase == ExchangePhase::Open {
            return Err("inbox_task_active: send an ordinary reply to this active attempt".into());
        }
    }
    let source = uuid::Uuid::parse_str(head.record.conversation_id.as_str())
        .map_err(|_| "inbox_invalid_source")?;
    let media = crate::commands::relay_media_tags(input.media_tags.as_deref().unwrap_or_default());
    let tag = if new_topic {
        vec!["luca-task-new", input.exchange_id.as_str()]
    } else {
        vec![
            TASK_REPLY_TAG,
            resolved.logical_record.exchange_id.as_str(),
            input.exchange_id.as_str(),
            "continue",
        ]
    };
    // This is a genuinely new execution root. The original return root is
    // separately frozen below; do not overload execution thread placement.
    let builder = crate::events::build_message(
        source,
        input.content.trim(),
        None,
        &[input.recipient_pubkey.as_str()],
        &media,
        &[],
        &[],
    )?
    .tag(nostr::Tag::parse(tag).map_err(|_| "inbox_invalid_task_correlation")?);
    let builder = if new_topic {
        builder
    } else {
        builder.tag(
            nostr::Tag::parse([
                "d",
                super::agent_inbox_lineage::continuation_index(
                    &resolved.logical_record.exchange_id,
                )
                .as_str(),
            ])
            .map_err(|_| "inbox_invalid_task_index")?,
        )
    };
    let event = builder
        .sign_with_keys(&app.state::<crate::app_state::AppState>().signing_keys()?)
        .map_err(|_| "inbox_reply_signing_unavailable")?;
    let root = Hex64::parse(event.id.to_hex()).map_err(|e| e.to_string())?;
    let mut record = ExchangeRecordV1::open(
        scope.owner_pubkey.clone(),
        head.record.members.clone(),
        head.record.conversation_id.clone(),
        root.clone(),
        head.record.opened_by.clone(),
        None,
        event.created_at.as_secs(),
    )
    .map_err(|e| e.to_string())?;
    super::agent_inbox_binding::prepare_new_task_window(&mut record, event.created_at.as_secs())?;
    let binding = InboxTaskBinding {
        scope: scope.clone(),
        logical_task_id: if new_topic {
            record.exchange_id.clone()
        } else {
            resolved.logical_record.exchange_id
        },
        attempt_exchange_id: record.exchange_id.clone(),
        attempt_request_event_id: Some(root.clone()),
        origin_conversation_id: record.conversation_id.clone(),
        origin_request_event_id: if new_topic {
            root
        } else {
            resolved.logical_record.root_event_id
        },
        initiator_pubkey: record.opened_by.clone(),
        recipient_pubkey: input.recipient_pubkey.clone(),
        parent_attempt_exchange_id: (!new_topic).then_some(head.record.exchange_id.clone()),
        parent_attempt_record_event_id: (!new_topic).then_some(head.event_id.clone()),
        result_event_id: None,
        return_acknowledged: false,
    };
    let context =
        super::conversation_context::freeze_for_dispatch(app, record.conversation_id.as_str())?;
    let mut intent = intents::new_intent(scope.clone(), fingerprint, event, context, binding);
    intent.attempt = Some(PreparedAttempt {
        record,
        previous: head.record,
        previous_head: head.event_id,
        created_at: intent.event.created_at.as_secs(),
    });
    if active_scope(app).await? != *scope {
        return Err("inbox_scope_changed".into());
    }
    Ok(intent)
}

/// The intent is durable before this is called. Reconcile record acceptance
/// rather than re-opening a stopped or exhausted attempt on retry.
pub(super) async fn ensure_attempt(
    app: &AppHandle,
    intent: &intents::ReplyIntent,
) -> Result<(), String> {
    let Some(attempt) = &intent.attempt else {
        return Ok(());
    };
    if active_scope(app).await? != intent.scope {
        return Err("inbox_scope_changed".into());
    }
    let app_copy = app.clone();
    let frozen = attempt.clone();
    let scope = intent.scope.clone();
    tokio::task::spawn_blocking(move || {
        let relay = AppExchangeRelay::new(app_copy.clone());
        if let Some(head) = relay
            .fetch_head(&frozen.record.exchange_id, &scope.owner_pubkey)
            .map_err(|e| e.to_string())?
        {
            if !same_attempt_authority(&head.record, &frozen.record) {
                return Err("inbox_attempt_conflict".to_owned());
            }
            // A crash can occur between record acceptance and grant issuance.
            // Repair only the deterministic grant, never republish the open
            // record or re-invite anyone in this reconciliation branch.
            let owned = relay.owned_residents().map_err(|e| e.to_string())?;
            let members = relay
                .verified_source_members(&frozen.record.conversation_id)
                .map_err(|e| e.to_string())?;
            if relay.owner().map_err(|e| e.to_string())? != scope.owner_pubkey
                || !members.contains(&scope.owner_pubkey)
                || frozen
                    .record
                    .members
                    .iter()
                    .any(|member| !owned.contains(member) || !members.contains(member))
            {
                return Err("inbox_source_access_revoked".into());
            }
            relay
                .issue_task_history(&frozen.record, frozen.created_at)
                .map_err(|e| e.to_string())?;
            super::exchange_store::global_exchange_store(&app_copy)?
                .lock()
                .map_err(|_| "inbox exchange store unavailable")?
                .upsert_head(head)?;
            return Ok(()); // Preserve the accepted head, including Stop.
        }
        let previous = relay
            .fetch_head(&frozen.previous.exchange_id, &scope.owner_pubkey)
            .map_err(|e| e.to_string())?
            .ok_or("inbox_previous_attempt_missing")?;
        if previous.event_id != frozen.previous_head {
            return Err("inbox_previous_attempt_changed: refresh before sending".into());
        }
        let owned = relay.owned_residents().map_err(|e| e.to_string())?;
        let members = relay
            .verified_source_members(&frozen.record.conversation_id)
            .map_err(|e| e.to_string())?;
        if relay.owner().map_err(|e| e.to_string())? != scope.owner_pubkey
            || !members.contains(&scope.owner_pubkey)
            || frozen
                .record
                .members
                .iter()
                .any(|member| !owned.contains(member))
        {
            return Err("inbox_source_access_revoked".into());
        }
        let store = super::exchange_store::global_exchange_store(&app_copy)?;
        // This is an explicit owner send through the existing same-owner visit
        // policy. Historical replay alone never grants general source access.
        for resident in frozen
            .record
            .members
            .iter()
            .filter(|key| !members.contains(*key))
        {
            tauri::async_runtime::block_on(super::agent_inbox_history::read_granted_turns(
                &app_copy,
                resident,
                &frozen.previous,
                1,
            ))?;
            relay
                .add_conversation_member_for_task(
                    &frozen.record.conversation_id,
                    resident,
                    &frozen.previous.exchange_id,
                )
                .map_err(|e| e.to_string())?;
            store
                .lock()
                .map_err(|_| "inbox visit store unavailable")?
                .record_visit(super::exchange_store::VisitGrant {
                    conversation_id: frozen.record.conversation_id.clone(),
                    resident: resident.clone(),
                    arrived_at: frozen.created_at,
                    exchange_id: Some(frozen.record.exchange_id.clone()),
                    correlation_id: frozen.record.exchange_id.clone(),
                })?;
        }
        // Recheck the source immediately before publishing authority.
        let current = relay
            .verified_source_members(&frozen.record.conversation_id)
            .map_err(|e| e.to_string())?;
        if !current.contains(&scope.owner_pubkey)
            || frozen
                .record
                .members
                .iter()
                .any(|key| !current.contains(key))
        {
            return Err("inbox_source_access_revoked".into());
        }
        let event_id = relay
            .publish_record(&frozen.record, frozen.created_at)
            .map_err(|e| e.to_string())?;
        relay
            .issue_task_history(&frozen.record, frozen.created_at)
            .map_err(|e| e.to_string())?;
        store
            .lock()
            .map_err(|_| "inbox exchange store unavailable")?
            .upsert_head(super::exchange_store::ExchangeHead {
                record: frozen.record,
                created_at: frozen.created_at,
                event_id,
            })?;
        Ok(())
    })
    .await
    .map_err(|_| "inbox attempt preparation failed")??;
    if active_scope(app).await? != intent.scope {
        return Err("inbox_scope_changed".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepted_attempt_allows_lifecycle_but_not_authority_changes() {
        let key = |s: &str| Hex64::parse(s.repeat(64)).unwrap();
        let frozen = ExchangeRecordV1::open(
            key("a"),
            vec![key("b"), key("c")],
            luca_protocol::OpaqueId::parse("source").unwrap(),
            key("d"),
            key("b"),
            None,
            100,
        )
        .unwrap();
        let mut actual = frozen.clone();
        actual.state = luca_protocol::ExchangeStateV1::Closed;
        assert!(same_attempt_authority(&actual, &frozen));
        actual.opened_by = key("c");
        assert!(!same_attempt_authority(&actual, &frozen));
    }
}
