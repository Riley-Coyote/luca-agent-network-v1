//! Explicit owner task replies and frozen fresh-attempt sends.

use std::sync::OnceLock;

use luca_protocol::{ExchangePhase, ExchangeRecordV1, ExchangeTurnTag, Hex64};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use super::{
    agent_inbox::{active_scope, read_task_for_actor, InboxScope},
    agent_inbox_send_store as intents,
};
use crate::models::SendChannelMessageResponse;

static SEND_COORDINATOR: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
pub(super) const TASK_REPLY_TAG: &str = "luca-task-reply";

/// Exact task, recipient and retry key remain visible before sending.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InboxReplyInput {
    pub exchange_id: Hex64,
    pub reply_event_id: Option<Hex64>,
    pub recipient_pubkey: Hex64,
    pub content: String,
    pub media_tags: Option<Vec<Vec<String>>>,
    pub idempotency_key: String,
    pub continuation_intent: bool,
}

fn validate_input(input: &InboxReplyInput) -> Result<(), String> {
    if input.idempotency_key.is_empty()
        || input.idempotency_key.len() > 128
        || !input
            .idempotency_key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("inbox_invalid_retry_key: keep the original bounded retry key".into());
    }
    if input.content.trim().is_empty()
        || input.content.len() > 64 * 1024
        || input.content.trim() == "!cancel"
    {
        return Err(
            "inbox_invalid_reply: use a nonempty clarification; use task Stop to cancel".into(),
        );
    }
    Ok(())
}

async fn persist_intent(
    app: &AppHandle,
    path: &std::path::Path,
    intent: &intents::ReplyIntent,
) -> Result<(), String> {
    let app = app.clone();
    let path = path.to_owned();
    let intent = intent.clone();
    tokio::task::spawn_blocking(move || intents::persist(&app, &path, &intent))
        .await
        .map_err(|_| "inbox intent storage task failed")?
}

async fn load_intent(
    app: &AppHandle,
    path: &std::path::Path,
    scope: &InboxScope,
) -> Result<Option<intents::ReplyIntent>, String> {
    let app = app.clone();
    let path = path.to_owned();
    let scope = scope.clone();
    tokio::task::spawn_blocking(move || intents::load(&app, &path, &scope))
        .await
        .map_err(|_| "inbox intent storage task failed")?
}

fn exact_source(event: &nostr::Event, source: &str) -> bool {
    let sources: Vec<_> = event
        .tags
        .iter()
        .map(|tag| tag.as_slice())
        .filter(|tag| tag.first().map(String::as_str) == Some("h"))
        .collect();
    sources.len() == 1 && sources[0].get(1).map(String::as_str) == Some(source)
}

fn validate_parent(
    record: &ExchangeRecordV1,
    event: &nostr::Event,
    recipient: &Hex64,
) -> Result<(), String> {
    let tags: Vec<Vec<String>> = event
        .tags
        .iter()
        .map(|tag| tag.as_slice().to_vec())
        .collect();
    let turn =
        ExchangeTurnTag::find(&tags).map_err(|_| "inbox_invalid_parent: malformed task turn")?;
    if !record.members.contains(recipient)
        || event.pubkey.to_hex() != recipient.as_str()
        || !event.verify_id()
        || !event.verify_signature()
        || event.kind != nostr::Kind::Custom(9)
        || !exact_source(event, record.conversation_id.as_str())
        || !turn.is_some_and(|tag| tag.exchange_id == record.exchange_id)
    {
        return Err("inbox_invalid_parent: select an exact message authored by this task's intended resident".into());
    }
    Ok(())
}

fn validate_initial_parent(record: &ExchangeRecordV1, event: &nostr::Event) -> bool {
    event.id.to_hex() == record.root_event_id.as_str()
        && (event.pubkey.to_hex() == record.owner.as_str()
            || event.pubkey.to_hex() == record.opened_by.as_str())
        && event.kind == nostr::Kind::Custom(9)
        && event.verify_id()
        && event.verify_signature()
        && exact_source(event, record.conversation_id.as_str())
}

async fn active_task(
    app: &AppHandle,
    scope: &InboxScope,
    exchange_id: &Hex64,
    recipient: &Hex64,
) -> Result<ExchangeRecordV1, String> {
    let snapshot = super::exchange::get_exchange(app.clone(), exchange_id.as_str().to_owned())
        .await?
        .ok_or("inbox_task_unavailable: refresh the original task")?;
    if snapshot.record.owner != scope.owner_pubkey || !snapshot.record.members.contains(recipient) {
        return Err(
            "inbox_unauthorized_recipient: the task or resident belongs to another scope".into(),
        );
    }
    if snapshot.phase != ExchangePhase::Open {
        return Err("inbox_task_not_active: stopped, paused or expired work requires an explicit linked continuation, not an ordinary reply".into());
    }
    let app_copy = app.clone();
    let conversation = snapshot.record.conversation_id.clone();
    let owner = scope.owner_pubkey.clone();
    let recipient = recipient.clone();
    tokio::task::spawn_blocking(move || {
        let members = super::runtime_task_delivery::verified_conversation_members(&app_copy, &conversation)?;
        if !members.contains(&owner) || !members.contains(&recipient) {
            return Err("inbox_source_access_revoked: reopen the authorized source conversation; no membership was changed".to_owned());
        }
        Ok(())
    }).await.map_err(|_| "inbox_source_unavailable: source membership could not be checked")??;
    if active_scope(app).await? != *scope {
        return Err("inbox_scope_changed: reopen this task in the current workspace".into());
    }
    Ok(snapshot.record)
}

/// Recheck Stop, source consent and exact dispatch cancellation immediately
/// before the ordinary pipeline submits the frozen owner event.
pub(crate) async fn recheck_before_publication(
    app: &AppHandle,
    event: &nostr::Event,
) -> Result<(), String> {
    let recipients: Vec<_> = event
        .tags
        .iter()
        .map(|tag| tag.as_slice())
        .filter(|tag| tag.first().map(String::as_str) == Some("p"))
        .collect();
    if recipients.len() != 1 {
        return Err("inbox_invalid_intent: one exact recipient is required".into());
    }
    let recipient = Hex64::parse(
        recipients[0]
            .get(1)
            .ok_or("inbox_invalid_intent: recipient is missing")?,
    )
    .map_err(|_| "inbox_invalid_intent: recipient is invalid")?;
    let binding = super::managed_dispatch_store::global_dispatch_store(app)?
        .lock()
        .map_err(|_| "inbox_dispatch_unavailable")?
        .inbox_task_binding(&event.id.to_hex(), recipient.as_str())
        .ok_or("inbox_invalid_intent: frozen task binding is missing")?;
    recheck_binding(app, event, &binding).await
}

async fn recheck_binding(
    app: &AppHandle,
    event: &nostr::Event,
    binding: &super::agent_inbox_binding::InboxTaskBinding,
) -> Result<(), String> {
    let scope = active_scope(app).await?;
    if binding.scope != scope
        || !binding.matches_owner_event(event)
        || event.pubkey.to_hex() != scope.owner_pubkey.as_str()
    {
        return Err("inbox_scope_changed: owner identity changed".into());
    }
    let record = active_task(
        app,
        &scope,
        &binding.attempt_exchange_id,
        &binding.recipient_pubkey,
    )
    .await?;
    if !exact_source(event, record.conversation_id.as_str())
        || &record.root_event_id != binding.attempt_root()
    {
        return Err("inbox_invalid_intent: source changed".into());
    }
    if let (Some(parent), Some(expected)) = (
        &binding.parent_attempt_exchange_id,
        &binding.parent_attempt_record_event_id,
    ) {
        use super::exchange_relay::ExchangeRelay;
        let app = app.clone();
        let parent = parent.clone();
        let owner = scope.owner_pubkey.clone();
        let expected = expected.clone();
        tokio::task::spawn_blocking(move || {
            let head = super::exchange_relay::AppExchangeRelay::new(app)
                .fetch_head(&parent, &owner)
                .map_err(|e| e.to_string())?
                .ok_or("inbox_previous_attempt_missing")?;
            if head.event_id != expected {
                return Err(
                    "inbox_previous_attempt_changed: this continuation was superseded or stopped"
                        .to_owned(),
                );
            }
            Ok(())
        })
        .await
        .map_err(|_| "inbox previous attempt check failed")??;
    }
    if active_scope(app).await? != scope {
        return Err("inbox_scope_changed: reopen this task in the current workspace".into());
    }
    let store = super::managed_dispatch_store::global_dispatch_store(app)?;
    let mut store = store.lock().map_err(|_| "inbox_dispatch_unavailable")?;
    let trigger = event.id.to_hex();
    let recipient = binding.recipient_pubkey.as_str();
    // A crash can occur between staging the exact signed event and persisting
    // its lineage. Repair only from this validated immutable intent, never
    // from message tags or inferred room membership.
    if store.inbox_task_binding(&trigger, recipient).is_none()
        && matches!(
            store.owner_trigger_state(&trigger, recipient),
            Some(super::managed_dispatch_store::ManagedDispatchState::Pending)
        )
    {
        store.bind_inbox_task(event, recipient, binding.clone())?;
    }
    store.owner_trigger_may_submit(&trigger, recipient)?;
    Ok(())
}

#[derive(Serialize)]
pub(crate) struct InboxSendReceipt {
    #[serde(flatten)]
    message: SendChannelMessageResponse,
    task_id: Hex64,
    attempt_id: Hex64,
    correspondence_id: Option<String>,
}

fn intent_receipt(intent: &intents::ReplyIntent) -> InboxSendReceipt {
    let binding = &intent.task_binding;
    InboxSendReceipt {
        message: receipt(&intent.event),
        task_id: binding.logical_task_id.clone(),
        attempt_id: binding.attempt_exchange_id.clone(),
        correspondence_id: intent.correspondence_id.clone().or_else(|| {
            intent.attempt.as_ref().and_then(|attempt| {
                super::agent_inbox::correspondence_id(&binding.scope, &attempt.record.members)
            })
        }),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InboxMessageInput {
    source_exchange_id: Hex64,
    recipient_pubkey: Hex64,
    content: String,
    media_tags: Option<Vec<Vec<String>>>,
    idempotency_key: String,
}

#[tauri::command]
pub(crate) async fn send_agent_inbox_message(
    app: AppHandle,
    input: InboxMessageInput,
) -> Result<InboxSendReceipt, String> {
    send(
        app,
        InboxReplyInput {
            exchange_id: input.source_exchange_id,
            reply_event_id: None,
            recipient_pubkey: input.recipient_pubkey,
            content: input.content,
            media_tags: input.media_tags,
            idempotency_key: input.idempotency_key,
            continuation_intent: false,
        },
        true,
    )
    .await
}

fn receipt(event: &nostr::Event) -> SendChannelMessageResponse {
    let mut root = None;
    let mut parent = None;
    for tag in event.tags.iter() {
        let tag = tag.as_slice();
        if tag.first().map(String::as_str) == Some("e") {
            if tag.get(3).map(String::as_str) == Some("root") {
                root = tag.get(1).cloned();
            }
            if tag.get(3).map(String::as_str) == Some("reply") {
                parent = tag.get(1).cloned();
            }
        }
    }
    let root = root.or_else(|| parent.clone());
    SendChannelMessageResponse {
        event_id: event.id.to_hex(),
        parent_event_id: parent.clone(),
        root_event_id: root.clone(),
        depth: if parent.is_none() {
            0
        } else if root == parent {
            1
        } else {
            2
        },
        created_at: event.created_at.as_secs() as i64,
    }
}

/// One owner-authored active-task clarification, with a durable exact-event
/// intent. An uncertain or accepted retry never signs another owner event.
#[tauri::command]
pub(crate) async fn send_agent_inbox_reply(
    app: AppHandle,
    input: InboxReplyInput,
) -> Result<InboxSendReceipt, String> {
    send(app, input, false).await
}

async fn send(
    app: AppHandle,
    input: InboxReplyInput,
    new_topic: bool,
) -> Result<InboxSendReceipt, String> {
    validate_input(&input)?;
    let _serial = SEND_COORDINATOR
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let scope = active_scope(&app).await?;
    let path = intents::path(&app, &scope, &input.idempotency_key)?;
    let fingerprint = hex::encode(Sha256::digest(
        serde_json::to_vec(&(new_topic, &input)).map_err(|_| "inbox_invalid_reply")?,
    ));
    let mut intent = if let Some(existing) = load_intent(&app, &path, &scope).await? {
        if existing.input_fingerprint != fingerprint {
            return Err(
                "inbox_retry_conflict: this retry key already belongs to a different message"
                    .into(),
            );
        }
        existing
    } else if input.continuation_intent || new_topic {
        let intent =
            super::agent_inbox_continue::prepare(&app, &scope, &input, fingerprint, new_topic)
                .await?;
        persist_intent(&app, &path, &intent).await?;
        intent
    } else {
        let resolved =
            super::agent_inbox_lineage::resolve_current(&app, &scope, &input.exchange_id).await?;
        if resolved.current_record.exchange_id != input.exchange_id {
            return Err("inbox_stale_attempt: refresh this task before replying".into());
        }
        let record = active_task(&app, &scope, &input.exchange_id, &input.recipient_pubkey).await?;
        let transcript =
            read_task_for_actor(&app, scope.owner_pubkey.clone(), input.exchange_id.clone())
                .await?;
        let events: Vec<nostr::Event> = serde_json::from_value(transcript["events"].clone())
            .map_err(|_| "inbox_history_unavailable")?;
        let parent = if let Some(reply) = &input.reply_event_id {
            events.iter().find(|event| event.id.to_hex() == reply.as_str())
        } else {
            events.iter().rev().find(|event| validate_parent(&record, event, &input.recipient_pubkey).is_ok())
                .or_else(|| events.iter().find(|event| validate_initial_parent(&record, event)))
        }.ok_or("inbox_reply_target_required: the authorized task request or a resident reply must be available")?;
        // Before the first resident response, the exact authorized request is
        // a valid clarification target. An explicitly selected reply is never
        // silently replaced, and its author still must be the chosen resident.
        if input.reply_event_id.is_some() || !validate_initial_parent(&record, parent) {
            validate_parent(&record, parent, &input.recipient_pubkey)?;
        }
        let mut root = None;
        let mut reply = None;
        for tag in parent.tags.iter() {
            let raw = tag.as_slice();
            if raw.first().map(String::as_str) == Some("e") {
                if raw.get(3).map(String::as_str) == Some("root")
                    && root.replace(raw.get(1).cloned()).is_some()
                {
                    return Err("inbox_invalid_parent: ambiguous root".into());
                }
                if raw.get(3).map(String::as_str) == Some("reply") {
                    reply = raw.get(1).cloned();
                }
            }
        }
        let root = root
            .flatten()
            .or(reply)
            .unwrap_or_else(|| parent.id.to_hex());
        let thread = crate::events::ThreadRef {
            root_event_id: nostr::EventId::from_hex(&root)
                .map_err(|_| "inbox_invalid_parent: root is invalid")?,
            parent_event_id: parent.id,
        };
        let source = uuid::Uuid::parse_str(record.conversation_id.as_str())
            .map_err(|_| "inbox_invalid_source")?;
        let media =
            crate::commands::relay_media_tags(input.media_tags.as_deref().unwrap_or_default());
        let event = crate::events::build_message(
            source,
            input.content.trim(),
            Some(&thread),
            &[input.recipient_pubkey.as_str()],
            &media,
            &[],
            &[],
        )?
        .tag(
            nostr::Tag::parse([
                TASK_REPLY_TAG,
                resolved.logical_record.exchange_id.as_str(),
                input.exchange_id.as_str(),
            ])
            .map_err(|_| "inbox_invalid_task_correlation")?,
        )
        .sign_with_keys(&app.state::<crate::app_state::AppState>().signing_keys()?)
        .map_err(|_| "inbox_reply_signing_unavailable")?;
        let context = super::conversation_context::freeze_for_dispatch(
            &app,
            record.conversation_id.as_str(),
        )?;
        let binding = super::agent_inbox_binding::InboxTaskBinding {
            scope: scope.clone(),
            logical_task_id: resolved.logical_record.exchange_id.clone(),
            attempt_exchange_id: input.exchange_id.clone(),
            origin_conversation_id: record.conversation_id.clone(),
            origin_request_event_id: resolved.logical_record.root_event_id,
            attempt_request_event_id: Some(record.root_event_id.clone()),
            initiator_pubkey: record.opened_by.clone(),
            recipient_pubkey: input.recipient_pubkey.clone(),
            parent_attempt_exchange_id: None,
            parent_attempt_record_event_id: None,
            result_event_id: None,
            return_acknowledged: false,
        };
        let mut intent = intents::new_intent(scope.clone(), fingerprint, event, context, binding);
        intent.correspondence_id = super::agent_inbox::correspondence_id(&scope, &record.members);
        persist_intent(&app, &path, &intent).await?;
        intent
    };
    let state = app.state::<crate::app_state::AppState>();
    let existing = crate::relay::query_relay(
        &state,
        &[serde_json::json!({"ids":[intent.event.id.to_hex()], "limit":1})],
    )
    .await?;
    let accepted = existing
        .iter()
        .any(|event| event == &intent.event && event.verify_id() && event.verify_signature());
    if !accepted {
        super::agent_inbox_continue::ensure_attempt(&app, &intent).await?;
        recheck_binding(&app, &intent.event, &intent.task_binding).await?;
        let parent = receipt(&intent.event).parent_event_id;
        crate::commands::send_frozen_agent_inbox_reply(
            &app,
            intent.event.clone(),
            parent,
            input.recipient_pubkey.clone(),
            input.media_tags.clone().unwrap_or_default(),
            intent.context.clone(),
            intent.task_binding.clone(),
        )
        .await?;
    }
    if active_scope(&app).await? != scope {
        return Err(
            "inbox_scope_changed: reply acceptance belongs to the original workspace".into(),
        );
    }
    let execution = super::managed_dispatch_store::global_dispatch_store(&app)?
        .lock()
        .map_err(|_| "inbox_dispatch_unavailable")?
        .owner_trigger_state(&intent.event.id.to_hex(), input.recipient_pubkey.as_str());
    match execution {
        Some(
            super::managed_dispatch_store::ManagedDispatchState::Active
            | super::managed_dispatch_store::ManagedDispatchState::Published,
        ) => {
            // The already-running receiver claimed/completed it before our
            // acknowledgement. Acceptance is success; do not wake it again.
            intent.wake = intents::WakeState::Ready;
            persist_intent(&app, &path, &intent).await?;
            return Ok(intent_receipt(&intent));
        }
        Some(
            super::managed_dispatch_store::ManagedDispatchState::Cancelled
            | super::managed_dispatch_store::ManagedDispatchState::Failed
            | super::managed_dispatch_store::ManagedDispatchState::Interrupted
            | super::managed_dispatch_store::ManagedDispatchState::Rejected,
        ) => {
            return Err("inbox_execution_ended: reply was accepted but this invocation stopped or failed; no duplicate wake was attempted".into());
        }
        _ => {}
    }
    // Acceptance is not completion. A wake attempt is checkpointed before
    // startup; ambiguous crash recovery never blindly starts it a second time.
    match &intent.wake {
        intents::WakeState::Ready => return Ok(intent_receipt(&intent)),
        intents::WakeState::Requested => return Err("inbox_wake_uncertain: reply was accepted; inspect the resident runtime before another wake".into()),
        intents::WakeState::Failed(reason) => return Err(format!("inbox_wake_failed: reply was accepted; {reason}")),
        intents::WakeState::NotRequested => {}
    }
    recheck_binding(&app, &intent.event, &intent.task_binding).await?;
    intent.wake = intents::WakeState::Requested;
    persist_intent(&app, &path, &intent).await?;
    let now = chrono::Utc::now().timestamp().max(0) as u64;
    let wake = format!(
        "{}:{}:{now}",
        intent.event.id.to_hex(),
        intent.event.created_at.as_secs()
    );
    match crate::commands::start_exchange_resident(
        &app,
        input.recipient_pubkey.as_str(),
        scope.owner_pubkey.as_str(),
        wake,
    )
    .await
    {
        Ok(_) => {
            intent.wake = intents::WakeState::Ready;
            persist_intent(&app, &path, &intent).await?;
        }
        Err(reason) => {
            intent.wake = intents::WakeState::Failed(reason.clone());
            persist_intent(&app, &path, &intent).await?;
            return Err(format!("inbox_wake_failed: reply was accepted; {reason}"));
        }
    }
    if active_scope(&app).await? != scope {
        return Err("inbox_scope_changed: reply belongs to the original workspace".into());
    }
    let execution = super::managed_dispatch_store::global_dispatch_store(&app)?
        .lock()
        .map_err(|_| "inbox_dispatch_unavailable")?
        .owner_trigger_state(&intent.event.id.to_hex(), input.recipient_pubkey.as_str());
    if matches!(
        execution,
        Some(super::managed_dispatch_store::ManagedDispatchState::Cancelled)
    ) {
        return Err(
            "inbox_execution_stopped: reply was accepted but Stop cancelled its exact invocation"
                .into(),
        );
    }
    if !matches!(
        execution,
        Some(
            super::managed_dispatch_store::ManagedDispatchState::Active
                | super::managed_dispatch_store::ManagedDispatchState::Published
        )
    ) {
        recheck_binding(&app, &intent.event, &intent.task_binding).await?;
    }
    Ok(intent_receipt(&intent))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn initial_clarification_requires_the_exact_signed_task_root_and_source() {
        let owner = nostr::Keys::parse(&"11".repeat(32)).unwrap();
        let resident = nostr::Keys::parse(&"22".repeat(32)).unwrap();
        let source = uuid::Uuid::parse_str("11111111-1111-4111-8111-111111111111").unwrap();
        let event = crate::events::build_message(
            source,
            "Synthetic pending task",
            None,
            &[],
            &[],
            &[],
            &[],
        )
        .unwrap()
        .sign_with_keys(&owner)
        .unwrap();
        let record = ExchangeRecordV1::open(
            Hex64::parse(owner.public_key().to_hex()).unwrap(),
            vec![
                Hex64::parse(resident.public_key().to_hex()).unwrap(),
                Hex64::parse("aa".repeat(32)).unwrap(),
            ],
            luca_protocol::OpaqueId::parse(source.to_string()).unwrap(),
            Hex64::parse(event.id.to_hex()).unwrap(),
            Hex64::parse(resident.public_key().to_hex()).unwrap(),
            None,
            event.created_at.as_secs(),
        )
        .unwrap();
        assert!(validate_initial_parent(&record, &event));
        let mut wrong = record.clone();
        wrong.root_event_id = Hex64::parse("bb".repeat(32)).unwrap();
        assert!(!validate_initial_parent(&wrong, &event));
        wrong = record.clone();
        wrong.conversation_id =
            luca_protocol::OpaqueId::parse("22222222-2222-4222-8222-222222222222").unwrap();
        assert!(!validate_initial_parent(&wrong, &event));
        wrong = record;
        wrong.owner = Hex64::parse("cc".repeat(32)).unwrap();
        assert!(!validate_initial_parent(&wrong, &event));
    }

    #[test]
    fn explicit_continuation_is_valid_but_cancel_shortcuts_are_not_replies() {
        let mut input = InboxReplyInput {
            exchange_id: Hex64::parse("a".repeat(64)).unwrap(),
            reply_event_id: None,
            recipient_pubkey: Hex64::parse("b".repeat(64)).unwrap(),
            content: "Clarification".into(),
            media_tags: None,
            idempotency_key: "synthetic-key".into(),
            continuation_intent: true,
        };
        assert!(validate_input(&input).is_ok());
        input.continuation_intent = false;
        assert!(validate_input(&input).is_ok());
        input.content = "!cancel".into();
        assert!(validate_input(&input).is_err());
    }
}
