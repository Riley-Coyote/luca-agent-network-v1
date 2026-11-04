//! In-process requests to the existing sole resident signing/outbox thread.
//! This is not a second resident broker, endpoint, harness or key holder.

use luca_protocol::{Hex64, OpaqueId};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    sync::{mpsc, Arc, Mutex, OnceLock, Weak},
    time::Duration,
};
use tauri::AppHandle;

#[path = "agent_inbox_action_recovery.rs"]
mod recovery;
pub(crate) use recovery::{recover_action, RecoveredAction};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentMessageInput {
    pub recipient_pubkey: Hex64,
    pub content: String,
    pub idempotency_key: String,
    pub exchange_id: Option<Hex64>,
    pub reply_event_id: Option<Hex64>,
}

pub(crate) struct ActionRequest {
    pub recovered_anchor: Option<Hex64>,
    pub expected_scope: super::agent_inbox::InboxScope,
    pub expected_relay: String,
    pub turn: super::communication_turn_registry::ActiveCommunicationTurn,
    pub app: AppHandle,
    pub owner: Hex64,
    pub resident: Hex64,
    pub epoch: u64,
    pub conversation: OpaqueId,
    pub input: AgentMessageInput,
    pub response: mpsc::SyncSender<Result<serde_json::Value, String>>,
}

struct Route {
    sender: mpsc::SyncSender<ActionRequest>,
    live: Weak<()>,
}
pub(crate) struct ActionReceiver {
    receiver: mpsc::Receiver<ActionRequest>,
    _live: Arc<()>,
}

fn routes() -> &'static Mutex<BTreeMap<(String, u64), Route>> {
    static ROUTES: OnceLock<Mutex<BTreeMap<(String, u64), Route>>> = OnceLock::new();
    ROUTES.get_or_init(|| Mutex::new(BTreeMap::new()))
}

pub(crate) fn channel(resident: &Hex64, epoch: u64) -> ActionReceiver {
    let (sender, receiver) = mpsc::sync_channel(8);
    let live = Arc::new(());
    if let Ok(mut routes) = routes().lock() {
        routes.retain(|_, route| route.live.upgrade().is_some());
        routes.insert(
            (resident.as_str().to_owned(), epoch),
            Route {
                sender,
                live: Arc::downgrade(&live),
            },
        );
    }
    ActionReceiver {
        receiver,
        _live: live,
    }
}

impl ActionReceiver {
    pub(crate) fn next(&self) -> Option<ActionRequest> {
        self.receiver.try_recv().ok()
    }
}

/// Dispatch only from an authenticated live repository-tool context. The sole
/// signing thread independently rechecks the exact current turn and ledger.
pub(crate) fn send(
    app: &AppHandle,
    owner: &Hex64,
    resident: &Hex64,
    epoch: u64,
    conversation: &OpaqueId,
    expected_relay: &str,
    input: AgentMessageInput,
) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let expected_scope = tauri::async_runtime::block_on(super::agent_inbox::active_scope(app))?;
    if &expected_scope.owner_pubkey != owner
        || crate::relay::relay_ws_url_with_override(&app.state::<crate::app_state::AppState>())
            != expected_relay
    {
        return Err("agent inbox action belongs to a stale workspace session".into());
    }
    if input.content.trim().is_empty()
        || input.content.len() > luca_protocol::MAX_FINAL_DRAFT_BYTES
        || input.content.trim() == "!cancel"
        || input.idempotency_key.is_empty()
        || input.idempotency_key.len() > 128
    {
        return Err("agent inbox message needs bounded text and an unchanged retry key".into());
    }
    use super::exchange_relay::ExchangeRelay;
    use sha2::{Digest, Sha256};
    let relay = super::exchange_relay::AppExchangeRelay::new(app.clone());
    if !relay
        .owned_residents()
        .map_err(|error| error.to_string())?
        .contains(resident)
        || !relay
            .verified_source_members(conversation)
            .map_err(|error| error.to_string())?
            .contains(resident)
    {
        return Err("agent inbox source authority is unavailable or revoked".into());
    }
    let key = Hex64::parse(hex::encode(Sha256::digest(
        serde_json::to_vec(&serde_json::json!([
            "luca.inbox.action.v1",
            expected_scope,
            resident,
            input.idempotency_key
        ]))
        .map_err(|_| "inbox action key is invalid")?,
    )))
    .map_err(|_| "inbox action key is invalid")?;
    let fingerprint = Hex64::parse(hex::encode(Sha256::digest(
        serde_json::to_vec(&input).map_err(|_| "inbox action fingerprint is invalid")?,
    )))
    .map_err(|_| "inbox action fingerprint is invalid")?;
    let accepted = {
        let store = super::managed_dispatch_store::global_dispatch_store(app)?;
        let guard = store
            .lock()
            .map_err(|_| "inbox dispatch store unavailable")?;
        guard.accepted_inbox_action(
            &key,
            &fingerprint,
            &expected_scope,
            resident.as_str(),
            conversation.as_str(),
        )?
    };
    if let Some((event, anchor, exchange, origin)) = accepted {
        if tauri::async_runtime::block_on(super::agent_inbox::active_scope(app))? != expected_scope
            || crate::relay::relay_ws_url_with_override(&app.state::<crate::app_state::AppState>())
                != expected_relay
        {
            return Err("inbox action receipt workspace changed".into());
        }
        return Ok(
            serde_json::json!({"state":"delivered","eventId":event,"taskId":exchange,
            "correspondenceId":super::agent_inbox::correspondence_id(&expected_scope,&[resident.clone(),input.recipient_pubkey.clone()]),
            "anchorEventId":anchor,"originRequestEventId":origin,"replayed":true,"agentFinalSlotConsumed":false}),
        );
    }
    let recovered = recover_action(
        app,
        &expected_scope,
        &key,
        &fingerprint,
        resident,
        conversation,
    )?;
    if let RecoveredAction::Accepted(row) = &recovered {
        if tauri::async_runtime::block_on(super::agent_inbox::active_scope(app))? != expected_scope
            || crate::relay::relay_ws_url_with_override(&app.state::<crate::app_state::AppState>())
                != expected_relay
        {
            return Err("inbox action receipt workspace changed".into());
        }
        return Ok(
            serde_json::json!({"state":"delivered","eventId":row.anchor_event_id,"taskId":row.exchange_id,
            "correspondenceId":super::agent_inbox::correspondence_id(&expected_scope,&[resident.clone(),row.recipient.clone()]),
            "originRequestEventId":row.owner_trigger_event_id,"replayed":true,"agentFinalSlotConsumed":false}),
        );
    }
    let turn = super::communication_turn_registry::authorize_unique(
        resident.as_str(),
        epoch,
        conversation.as_str(),
    )
    .map_err(|_| "agent inbox send requires one exact current authorized turn")?;
    let recovered_anchor = match recovered {
        RecoveredAction::Pending { parent, anchor } => {
            if parent.as_str() != turn.dispatch_receipt_id.as_str() {
                return Err("original inbox action is uncertain or ended; it will not be moved to another turn".into());
            }
            anchor
        }
        RecoveredAction::New => {
            let parent = Hex64::parse(turn.dispatch_receipt_id.as_str())
                .map_err(|_| "inbox original turn is invalid")?;
            if super::agent_inbox_anchors::parent_action_count(
                app,
                &expected_scope,
                &parent,
                resident,
            )? >= 4
            {
                return Err("inbox action allowance is exhausted for this owner request".into());
            }
            None
        }
        RecoveredAction::Accepted(_) => {
            return Err("inbox action recovery changed unexpectedly".into())
        }
    };
    let sender = routes()
        .lock()
        .map_err(|_| "resident signing route is unavailable")?
        .get(&(resident.as_str().to_owned(), epoch))
        .filter(|route| route.live.upgrade().is_some())
        .map(|route| route.sender.clone())
        .ok_or("resident signing session is unavailable")?;
    let (response, receiver) = mpsc::sync_channel(1);
    sender
        .try_send(ActionRequest {
            recovered_anchor,
            expected_scope,
            expected_relay: expected_relay.to_owned(),
            turn,
            app: app.clone(),
            owner: owner.clone(),
            resident: resident.clone(),
            epoch,
            conversation: conversation.clone(),
            input,
            response,
        })
        .map_err(|_| "resident signing queue is full or ended")?;
    receiver.recv_timeout(Duration::from_secs(120))
        .map_err(|_| "agent inbox delivery is uncertain; retry only with the same message and idempotency key")?
}
