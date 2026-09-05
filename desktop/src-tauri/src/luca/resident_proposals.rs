//! Conversation-scoped resident creation proposals over the existing host broker.
//!
//! A proposal opens the ordinary owner review. It grants no creation authority,
//! carries no signing material, and returns only host-verified setup outcomes.

use std::{
    collections::{BTreeSet, HashMap},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

use chrono::Utc;
use luca_protocol::{Hex64, OpaqueId, SafeU53, Sha256Ref};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use super::exchange_relay::{AppExchangeRelay, ExchangeRelay};

mod native_import;
mod native_link;

pub use native_import::*;

pub(crate) fn validate_native_execution_link(
    app: &AppHandle,
    transaction: &super::operator_forge::NativeProvisioningTransactionV1,
    request_id: Option<&str>,
) -> Result<(), String> {
    native_link::validate_execution(app, transaction, request_id)
}

const PROPOSAL_EVENT: &str = "luca://resident-proposal";
const RESOLVED_EVENT: &str = "luca://resident-proposal-resolved";
const PROPOSAL_LIFETIME: Duration = Duration::from_secs(15 * 60);

#[derive(Clone)]
pub(crate) struct ResidentProposalScope {
    pub owner: Hex64,
    pub resident: Hex64,
    pub session_epoch: SafeU53,
    pub binding: Sha256Ref,
    pub conversation: OpaqueId,
    pub active: Arc<AtomicBool>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ProposalArguments {
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    system_prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    runtime_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provisioning_intent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    native_profile_name: Option<String>,
}

impl ProposalArguments {
    fn validate(&self) -> Result<(), String> {
        let name = self.display_name.trim();
        let prompt = self.system_prompt.trim();
        if self.provisioning_intent.as_deref() == Some("import") {
            return if self.runtime_family.as_deref() == Some("hermes")
                && name.is_empty()
                && prompt.is_empty()
                && self.native_profile_name.as_deref().is_some_and(|profile| {
                    !profile.trim().is_empty()
                        && profile.len() <= 120
                        && !profile.chars().any(char::is_control)
                }) {
                Ok(())
            } else {
                Err("Hermes import requires the exact profile name without replacement instructions.".into())
            };
        }
        if name.is_empty()
            || self.native_profile_name.is_some()
            || name.len() > 120
            || name.chars().any(char::is_control)
            || prompt.is_empty()
            || prompt.len() > 20_000
            || prompt
                .chars()
                .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
            || self.runtime_family.as_deref().is_some_and(|runtime| {
                !matches!(runtime, "codex" | "claude_code" | "hermes" | "openclaw")
            })
            || self
                .provisioning_intent
                .as_deref()
                .is_some_and(|intent| !matches!(intent, "fresh" | "template" | "advanced"))
        {
            return Err(
                "Resident proposal needs a short name, instructions, and a supported runtime."
                    .into(),
            );
        }
        Ok(())
    }
}

/// An ephemeral, owner-scoped request for the existing creation review.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentProposalV1 {
    request_id: String,
    owner_pubkey: String,
    resident_pubkey: String,
    conversation_id: String,
    display_name: String,
    system_prompt: String,
    runtime_family: Option<String>,
    provisioning_intent: Option<String>,
    native_profile_name: Option<String>,
    created_at: String,
}

struct PendingProposal {
    scope: ResidentProposalScope,
    projection: ResidentProposalV1,
    deadline: Instant,
    native_transaction_id: Option<String>,
    native_import: Option<NativeImportAttempt>,
    result: Option<Value>,
    completion: Option<ResidentProposalCompletionV1>,
}

#[derive(Clone)]
struct CompletedProposal {
    scope: ResidentProposalScope,
    completion: ResidentProposalCompletionV1,
    deadline: Instant,
    native_import: Option<NativeImportAttempt>,
}

fn completed_proposals() -> &'static Mutex<HashMap<String, CompletedProposal>> {
    static COMPLETED: OnceLock<Mutex<HashMap<String, CompletedProposal>>> = OnceLock::new();
    COMPLETED.get_or_init(|| Mutex::new(HashMap::new()))
}

fn proposals() -> &'static Mutex<HashMap<String, PendingProposal>> {
    static PROPOSALS: OnceLock<Mutex<HashMap<String, PendingProposal>>> = OnceLock::new();
    PROPOSALS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_proposals(
) -> Result<std::sync::MutexGuard<'static, HashMap<String, PendingProposal>>, String> {
    proposals()
        .lock()
        .map_err(|_| "Resident proposal state is unavailable.".into())
}

fn validate_origin_snapshot(
    scope: &ResidentProposalScope,
    owner: &Hex64,
    owned: &BTreeSet<Hex64>,
    binding: &Sha256Ref,
    members: &BTreeSet<Hex64>,
) -> Result<(), String> {
    if !scope.active.load(Ordering::SeqCst)
        || scope.session_epoch.get() == 0
        || owner != &scope.owner
        || !owned.contains(&scope.resident)
        || binding != &scope.binding
        || !members.contains(&scope.owner)
        || !members.contains(&scope.resident)
    {
        return Err(
            "This resident setup request is no longer authorized in its conversation.".into(),
        );
    }
    Ok(())
}

fn verify_local_origin(app: &AppHandle, scope: &ResidentProposalScope) -> Result<(), String> {
    let relay = AppExchangeRelay::new(app.clone());
    let owner = relay
        .owner()
        .map_err(|_| "The current owner is unavailable.")?;
    let owned = relay
        .owned_residents()
        .map_err(|_| "The resident's ownership could not be verified.")?;
    let (binding, _) =
        crate::managed_agents::current_owner_brain_runtime_authority(app, &scope.resident)?;
    let members = BTreeSet::from([scope.owner.clone(), scope.resident.clone()]);
    validate_origin_snapshot(scope, &owner, &owned, &binding, &members)
}

fn current_conversation_event(
    app: &AppHandle,
    conversation: &OpaqueId,
    kind: u16,
) -> Result<nostr::Event, String> {
    let state = app.state::<crate::app_state::AppState>();
    let events = tauri::async_runtime::block_on(async {
        tokio::time::timeout(
            Duration::from_secs(5),
            crate::relay::query_relay(
                &state,
                &[json!({
                    "kinds": [kind], "#d": [conversation.as_str()], "limit": 1
                })],
            ),
        )
        .await
        .map_err(|_| "Conversation membership check timed out.".to_owned())?
    })?;
    let event = events
        .into_iter()
        .next()
        .ok_or("Current conversation membership is not available yet.")?;
    if event.kind != nostr::Kind::Custom(kind)
        || event
            .tags
            .iter()
            .filter(|tag| {
                let parts = tag.as_slice();
                parts.first().is_some_and(|part| part == "d")
            })
            .count()
            != 1
        || !event.tags.iter().any(|tag| {
            let parts = tag.as_slice();
            parts.len() == 2 && parts[0] == "d" && parts[1] == conversation.as_str()
        })
        || event.verify().is_err()
    {
        return Err("Current conversation membership could not be verified.".into());
    }
    Ok(event)
}

fn current_members(app: &AppHandle, conversation: &OpaqueId) -> Result<BTreeSet<Hex64>, String> {
    let event = current_conversation_event(app, conversation, 39002)?;
    let response = crate::nostr_convert::channel_members_from_event(&event)?;
    response
        .members
        .into_iter()
        .map(|member| {
            Hex64::parse(member.pubkey.to_ascii_lowercase())
                .map_err(|_| "Conversation membership contains an invalid identity.".to_owned())
        })
        .collect()
}

fn dm_participants(app: &AppHandle, conversation: &OpaqueId) -> Result<BTreeSet<Hex64>, String> {
    let event = current_conversation_event(app, conversation, 39000)?;
    let channel = crate::nostr_convert::channel_info_from_event(&event, None, None)?;
    if channel.channel_type != "dm" {
        return Err("An expanded setup conversation must be a direct conversation.".into());
    }
    channel
        .participant_pubkeys
        .into_iter()
        .map(|pubkey| {
            Hex64::parse(pubkey.to_ascii_lowercase())
                .map_err(|_| "Direct conversation participants are invalid.".to_owned())
        })
        .collect()
}

pub(crate) fn verify_origin(app: &AppHandle, scope: &ResidentProposalScope) -> Result<(), String> {
    verify_local_origin(app, scope)?;
    let members = current_members(app, &scope.conversation)?;
    if !members.contains(&scope.owner) || !members.contains(&scope.resident) {
        return Err(
            "You and the requesting resident must still belong to the originating conversation."
                .into(),
        );
    }
    // Recheck after the relay read: owner/runtime replacement may occur while it waits.
    verify_local_origin(app, scope)
}

fn pending_scope(request_id: &str) -> Result<ResidentProposalScope, String> {
    let pending = lock_proposals()?;
    let proposal = pending
        .get(request_id)
        .ok_or("This resident setup request is no longer waiting.")?;
    if Instant::now() >= proposal.deadline || proposal.result.is_some() {
        return Err("This resident setup request is no longer waiting.".into());
    }
    Ok(proposal.scope.clone())
}

struct PendingGuard {
    app: AppHandle,
    request_id: String,
}

impl Drop for PendingGuard {
    fn drop(&mut self) {
        if let Ok(mut pending) = proposals().lock() {
            if let Some(proposal) = pending.remove(&self.request_id) {
                if proposal
                    .result
                    .as_ref()
                    .is_some_and(|result| result["status"] != "incomplete")
                {
                    if let Some(completion) = proposal.completion {
                        if let Ok(mut completed) = completed_proposals().lock() {
                            completed.retain(|_, value| Instant::now() < value.deadline);
                            if completed.len() >= 64 {
                                if let Some(oldest) = completed
                                    .iter()
                                    .min_by_key(|(_, value)| value.deadline)
                                    .map(|(id, _)| id.clone())
                                {
                                    completed.remove(&oldest);
                                }
                            }
                            completed.insert(
                                self.request_id.clone(),
                                CompletedProposal {
                                    scope: proposal.scope.clone(),
                                    completion,
                                    deadline: proposal.deadline,
                                    native_import: proposal.native_import,
                                },
                            );
                        }
                    }
                }
                let _ = self.app.emit(
                    RESOLVED_EVENT,
                    json!({
                        "requestId": self.request_id,
                        "conversationId": proposal.scope.conversation,
                    }),
                );
            }
        }
    }
}

fn incomplete_result(request_id: &str, transaction_id: Option<&str>, reason: &str) -> Value {
    json!({
        "requestId": request_id, "status": "incomplete", "reason": reason,
        "transactionId": transaction_id,
        "message": "No completed setup result was returned. Creation may have begun. Check the existing resident or native setup receipt before proposing another creation.",
        "authenticatedReady": false
    })
}

fn add_import_incomplete(result: &mut Value, attempt: Option<&NativeImportAttempt>) {
    if let Some(attempt) = attempt {
        result["residentPubkey"] = json!(attempt.resident_pubkey);
        result["nativeProfileName"] = json!(attempt.profile_name);
        result["message"] = json!("The import review ended without returning a verified result. A resident may already be saved; inspect the existing Hermes profile in Agents before requesting another import. Native configuration was not replaced.");
    }
}

#[cfg(unix)]
pub(crate) fn caller_disconnected(caller: &mut std::os::unix::net::UnixStream) -> bool {
    use std::io::Read;
    match caller.read(&mut [0_u8; 1]) {
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
            ) =>
        {
            false
        }
        // The existing broker admits exactly one frame per connection.
        _ => true,
    }
}

/// Open one owner review and wait for its actual result on the caller's existing tool call.
pub(crate) fn propose_resident(
    app: &AppHandle,
    scope: ResidentProposalScope,
    arguments: Value,
    mut caller_cancelled: impl FnMut() -> bool,
) -> Result<String, String> {
    let arguments: ProposalArguments = serde_json::from_value(arguments)
        .map_err(|_| "Resident proposal arguments are invalid.".to_owned())?;
    arguments.validate()?;
    verify_origin(app, &scope)?;
    let request_id = format!("resident-proposal-{}", uuid::Uuid::new_v4());
    let projection = ResidentProposalV1 {
        request_id: request_id.clone(),
        owner_pubkey: scope.owner.as_str().to_owned(),
        resident_pubkey: scope.resident.as_str().to_owned(),
        conversation_id: scope.conversation.as_str().to_owned(),
        display_name: arguments.display_name.trim().to_owned(),
        system_prompt: arguments.system_prompt.trim().to_owned(),
        runtime_family: arguments.runtime_family,
        provisioning_intent: arguments.provisioning_intent,
        native_profile_name: arguments
            .native_profile_name
            .map(|name| name.trim().to_ascii_lowercase()),
        created_at: Utc::now().to_rfc3339(),
    };
    {
        let mut pending = lock_proposals()?;
        // The existing global creation review presents one proposal at a time.
        // Reject another explicitly instead of dropping it or leaving a caller waiting.
        if !pending.is_empty() {
            return Err("Another resident creation review is open. Finish or close it before proposing another.".into());
        }
        pending.insert(
            request_id.clone(),
            PendingProposal {
                scope: scope.clone(),
                projection: projection.clone(),
                deadline: Instant::now() + PROPOSAL_LIFETIME,
                native_transaction_id: None,
                native_import: None,
                result: None,
                completion: None,
            },
        );
    }
    let _guard = PendingGuard {
        app: app.clone(),
        request_id: request_id.clone(),
    };
    app.emit(PROPOSAL_EVENT, &projection)
        .map_err(|_| "The creation review could not be opened.")?;
    let result = wait_for_result(proposals(), &request_id, &scope, &mut caller_cancelled)?;
    let current_owner = AppExchangeRelay::new(app.clone())
        .owner()
        .map_err(|_| "The current owner is unavailable.")?;
    validate_terminal_scope(&scope, &result, &current_owner, || {
        verify_origin(app, &scope)
    })?;
    serde_json::to_string(&result).map_err(|_| "Resident setup result could not be encoded.".into())
}

fn validate_terminal_scope(
    scope: &ResidentProposalScope,
    result: &Value,
    owner: &Hex64,
    verify_success: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if owner != &scope.owner {
        return Err("This setup result belongs to a different owner.".into());
    }
    if result.get("status").and_then(Value::as_str) == Some("incomplete") {
        return Ok(());
    }
    verify_success()
}

fn wait_for_result(
    store: &Mutex<HashMap<String, PendingProposal>>,
    request_id: &str,
    scope: &ResidentProposalScope,
    mut caller_cancelled: impl FnMut() -> bool,
) -> Result<Value, String> {
    loop {
        let (deadline, result) = {
            let pending = store
                .lock()
                .map_err(|_| "Resident proposal state is unavailable.")?;
            let proposal = pending
                .get(request_id)
                .ok_or("Resident setup request became unavailable.")?;
            (proposal.deadline, proposal.result.clone())
        };
        if let Some(result) = result {
            return Ok(result);
        }
        let reason = if !scope.active.load(Ordering::SeqCst) {
            Some("resident_session_ended")
        } else if caller_cancelled() {
            Some("caller_disconnected")
        } else if Instant::now() >= deadline {
            Some("review_expired")
        } else {
            None
        };
        if let Some(reason) = reason {
            let mut pending = store
                .lock()
                .map_err(|_| "Resident proposal state is unavailable.")?;
            let proposal = pending
                .get_mut(request_id)
                .ok_or("Resident setup request became unavailable.")?;
            // Completion and cancellation share one terminal slot. Once a
            // disconnected caller is resolved, no queued owner action may
            // revive its request while the delivery guard is being dropped.
            let transaction_id = proposal.native_transaction_id.clone();
            let result = proposal.result.get_or_insert_with(|| {
                let mut result = incomplete_result(request_id, transaction_id.as_deref(), reason);
                add_import_incomplete(&mut result, proposal.native_import.as_ref());
                result
            });
            return Ok(result.clone());
        }
        thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(test)]
fn complete_pending(
    store: &Mutex<HashMap<String, PendingProposal>>,
    request_id: &str,
    result: Value,
) -> Result<bool, String> {
    complete_pending_with_receipt(store, request_id, result, None)
}

fn complete_pending_with_receipt(
    store: &Mutex<HashMap<String, PendingProposal>>,
    request_id: &str,
    result: Value,
    completion: Option<ResidentProposalCompletionV1>,
) -> Result<bool, String> {
    let mut pending = store
        .lock()
        .map_err(|_| "Resident proposal state is unavailable.")?;
    let Some(proposal) = pending.get_mut(request_id) else {
        if completion.is_some() {
            return Err("This setup request ended before its result could be returned. Review the existing agent before starting another creation.".into());
        }
        return Ok(false);
    };
    if proposal.result.is_some() {
        if completion.is_some() && proposal.completion != completion {
            return Err("This setup request already ended with a different outcome.".into());
        }
        return Ok(false);
    }
    if !proposal.scope.active.load(Ordering::SeqCst) || Instant::now() >= proposal.deadline {
        return Err("The requesting runtime is no longer waiting for setup.".into());
    }
    proposal.result = Some(result);
    proposal.completion = completion;
    Ok(true)
}

/// Replay only this owner's live pending review after renderer initialization.
#[tauri::command]
pub fn list_resident_proposals(app: AppHandle) -> Result<Vec<ResidentProposalV1>, String> {
    let owner = AppExchangeRelay::new(app)
        .owner()
        .map_err(|_| "The current owner is unavailable.")?;
    Ok(lock_proposals()?
        .values()
        .filter(|proposal| {
            proposal.scope.owner == owner
                && proposal.scope.active.load(Ordering::SeqCst)
                && Instant::now() < proposal.deadline
                && proposal.result.is_none()
        })
        .map(|proposal| proposal.projection.clone())
        .collect())
}

/// Revalidate the live request before an action in the existing owner review.
#[tauri::command]
pub async fn authorize_resident_proposal(app: AppHandle, request_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let scope = pending_scope(&request_id)?;
        verify_origin(&app, &scope)?;
        pending_scope(&request_id)?;
        Ok(())
    })
    .await
    .map_err(|_| "Resident setup authorization worker failed.".to_owned())?
}

/// Link a reviewed native transaction before the native execution/reuse path.
pub(crate) async fn bind_native_transaction(
    app: AppHandle,
    request_id: String,
    transaction_id: String,
    owner: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let scope = pending_scope(&request_id)?;
        if scope.owner.as_str() != owner {
            return Err("Native setup belongs to a different owner.".into());
        }
        verify_origin(&app, &scope)?;
        let mut pending = lock_proposals()?;
        let proposal = pending
            .get_mut(&request_id)
            .ok_or("This resident setup request is no longer waiting.")?;
        if !proposal.scope.active.load(Ordering::SeqCst)
            || Instant::now() >= proposal.deadline
            || proposal.result.is_some()
            || proposal
                .native_transaction_id
                .as_ref()
                .is_some_and(|id| id != &transaction_id)
        {
            return Err("This request is no longer available for a new native creation.".into());
        }
        if proposal.projection.provisioning_intent.as_deref() == Some("import") {
            return Err("Existing-profile import cannot authorize native provisioning.".into());
        }
        let transaction =
            super::operator_forge::load_native_transaction(&app, &owner, &transaction_id)?;
        native_link::bind(
            &app,
            &transaction,
            &request_id,
            &proposal.projection.created_at,
        )?;
        proposal.native_transaction_id = Some(transaction_id);
        Ok(())
    })
    .await
    .map_err(|_| "Native setup authorization worker failed.".to_owned())?
}

/// Only trusted renderer completion paths may identify a created artifact.
#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ResidentProposalCompletionV1 {
    NativeImported {},
    NativeCreated {
        transaction_id: String,
        #[serde(default)]
        attached_conversation_id: Option<String>,
    },
    ManagedCreated {
        resident_pubkey: String,
        persona_id: String,
        #[serde(default)]
        attached_conversation_id: Option<String>,
    },
    DefinitionSaved {
        persona_id: String,
    },
    Closed {
        busy: bool,
    },
}

fn completion_scope(
    request_id: &str,
    completion: &ResidentProposalCompletionV1,
) -> Result<Option<(ResidentProposalScope, bool)>, String> {
    completion_scope_from(proposals(), completed_proposals(), request_id, completion)
}

fn completion_scope_from(
    pending: &Mutex<HashMap<String, PendingProposal>>,
    completed: &Mutex<HashMap<String, CompletedProposal>>,
    request_id: &str,
    completion: &ResidentProposalCompletionV1,
) -> Result<Option<(ResidentProposalScope, bool)>, String> {
    let closed = matches!(completion, ResidentProposalCompletionV1::Closed { .. });
    if let Some(proposal) = pending
        .lock()
        .map_err(|_| "Setup request state is unavailable.")?
        .get(request_id)
    {
        if proposal.projection.provisioning_intent.as_deref() == Some("import")
            && !matches!(
                completion,
                ResidentProposalCompletionV1::NativeImported {}
                    | ResidentProposalCompletionV1::Closed { .. }
            )
        {
            return Err(
                "An import request requires its host-correlated imported resident result.".into(),
            );
        }
        if proposal.result.is_none() && Instant::now() < proposal.deadline {
            return Ok(Some((proposal.scope.clone(), false)));
        }
        if proposal
            .result
            .as_ref()
            .is_some_and(|result| result["status"] != "incomplete")
            && proposal.completion.as_ref() == Some(completion)
            && Instant::now() < proposal.deadline
        {
            return Ok(Some((proposal.scope.clone(), true)));
        }
    }
    if let Some(proposal) = completed
        .lock()
        .map_err(|_| "Setup receipt state is unavailable.")?
        .get(request_id)
    {
        if &proposal.completion == completion && Instant::now() < proposal.deadline {
            return Ok(Some((proposal.scope.clone(), true)));
        }
    }
    if closed {
        return Ok(None);
    }
    Err("The requesting session is no longer waiting for this setup result. Review the existing agent in Agents before starting another creation.".into())
}

fn native_result(
    app: &AppHandle,
    scope: &ResidentProposalScope,
    request_id: &str,
    transaction_id: &str,
    attached_conversation_id: Option<&str>,
) -> Result<Value, String> {
    let transaction =
        super::operator_forge::load_native_transaction(app, scope.owner.as_str(), transaction_id)?;
    native_link::require_completed_link(app, &transaction, request_id)?;
    if transaction.status != super::operator_forge::NativeProvisioningStatusV1::Complete {
        return Err("Native setup has not returned a completed receipt for this request.".into());
    }
    let resident = transaction
        .reserved_resident_pubkey
        .as_deref()
        .ok_or("The native receipt has no resident identity.")?;
    let mut result = resident_result(
        app,
        scope,
        resident,
        transaction.persona_id.as_deref(),
        attached_conversation_id,
    )?;
    result["status"] = json!("resident_created");
    result["message"] = json!("The native receipt confirms this resident was created for the reviewed request. Attachment and process state are reported separately; authentication has not been verified by this setup receipt.");
    result["runtime"] =
        serde_json::to_value(transaction.runtime).map_err(|_| "Invalid native runtime receipt.")?;
    result["transactionId"] = json!(transaction_id);
    Ok(result)
}

fn resident_result(
    app: &AppHandle,
    scope: &ResidentProposalScope,
    resident: &str,
    persona_id: Option<&str>,
    attached_conversation_id: Option<&str>,
) -> Result<Value, String> {
    let resident = Hex64::parse(resident.to_ascii_lowercase())
        .map_err(|_| "Invalid created resident identity.")?;
    let relay = AppExchangeRelay::new(app.clone());
    if !relay
        .owned_residents()
        .map_err(|_| "Created resident ownership is unavailable.")?
        .contains(&resident)
    {
        return Err("The created resident is not owned by this desktop.".into());
    }
    // A saved definition may be active before it starts or after its child exits.
    tauri::async_runtime::block_on(crate::commands::list_managed_agents(app.clone()))?;
    let state = app.state::<crate::app_state::AppState>();
    let registry = super::resident_registry::load_resident_registry(app, &state)?;
    let record = registry
        .residents
        .iter()
        .find(|record| record.resident_pubkey == resident)
        .ok_or("The created resident is not available.")?;
    if persona_id.is_none() || record.persona_id.as_deref() != persona_id {
        return Err("The creation result does not match the reviewed agent definition.".into());
    }
    let origin_members = current_members(app, &scope.conversation)?;
    let target = match attached_conversation_id {
        Some(id) => {
            OpaqueId::parse(id.to_owned()).map_err(|_| "The attached conversation is invalid.")?
        }
        None => scope.conversation.clone(),
    };
    let target_members = if target == scope.conversation {
        origin_members.clone()
    } else {
        current_members(app, &target)?
    };
    let attached = verified_attachment(scope, &resident, &origin_members, &target_members);
    if target != scope.conversation
        && !verified_dm_expansion(
            scope,
            &resident,
            &dm_participants(app, &scope.conversation)?,
            &dm_participants(app, &target)?,
        )
    {
        return Err("The expanded conversation does not match the original direct participants and new resident.".into());
    }
    if attached_conversation_id.is_some() && !attached {
        return Err("The resident's current conversation attachment could not be verified.".into());
    }
    Ok(project_resident_result(scope, record, target, attached))
}

fn project_resident_result(
    scope: &ResidentProposalScope,
    record: &super::resident_registry::ResidentRegistryEntry,
    target: OpaqueId,
    attached: bool,
) -> Value {
    json!({
        "status": "resident_available", "residentPubkey": record.resident_pubkey,
        "displayName": record.display_name, "personaId": record.persona_id,
        "conversationId": scope.conversation, "attached": attached,
        "attachedConversationId": if attached { Some(target) } else { None },
        "runtimeState": record.status, "processRunning": record.status == "running",
        "authenticatedReady": false,
        "message": "This owned resident and definition are available. This result alone does not establish when they were created. Attachment and process state are reported separately; authentication has not been verified."
    })
}

fn verified_attachment(
    scope: &ResidentProposalScope,
    resident: &Hex64,
    origin_members: &BTreeSet<Hex64>,
    target_members: &BTreeSet<Hex64>,
) -> bool {
    origin_members.contains(&scope.owner)
        && origin_members.contains(&scope.resident)
        && target_members.contains(&scope.owner)
        && target_members.contains(&scope.resident)
        && target_members.contains(resident)
}

fn verified_dm_expansion(
    scope: &ResidentProposalScope,
    resident: &Hex64,
    origin_participants: &BTreeSet<Hex64>,
    target_participants: &BTreeSet<Hex64>,
) -> bool {
    let mut expected = origin_participants.clone();
    expected.insert(resident.clone());
    origin_participants.contains(&scope.owner)
        && origin_participants.contains(&scope.resident)
        && &expected == target_participants
}

/// Return a real receipt, or a truthful closed-review outcome, to the waiting runtime.
#[tauri::command]
pub async fn finish_resident_proposal(
    app: AppHandle,
    request_id: String,
    completion: ResidentProposalCompletionV1,
) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        // A retry is acknowledged only when this exact completion was already
        // verified. Missing or cancelled requests never count as success.
        let Some((scope, acknowledged)) = completion_scope(&request_id, &completion)? else { return Ok(false); };
        let closed = matches!(completion, ResidentProposalCompletionV1::Closed { .. });
        if closed {
            // A close grants nothing and must remain possible after departure.
            let owner = AppExchangeRelay::new(app.clone()).owner()
                .map_err(|_| "The current owner is unavailable.")?;
            if owner != scope.owner { return Err("This setup review belongs to another owner.".into()); }
        } else {
            verify_origin(&app, &scope)?;
        }
        let mut result = match completion.clone() {
            ResidentProposalCompletionV1::NativeImported {} => {
                let attempt = lock_proposals()?.get(&request_id).and_then(|proposal| proposal.native_import.clone())
                    .or_else(|| completed_proposals().lock().ok().and_then(|completed| completed.get(&request_id).and_then(|proposal| proposal.native_import.clone())))
                    .ok_or("No owner-reviewed import belongs to this request.")?;
                if attempt.busy { return Err("The import is still underway.".into()); }
                if !attempt.preferences_applied { return Err("The reviewed import settings have not been saved. Retry reviewed settings before returning success.".into()); }
                let imported = import_result(&app, &scope, &attempt)?;
                let mut result = serde_json::to_value(imported).map_err(|_| "The import result could not be encoded.")?;
                result["status"] = json!("resident_imported");
                result["conversationId"] = json!(scope.conversation);
                result["attached"] = json!(false);
                result["message"] = json!("The exact owner-selected Hermes profile is linked to this resident. Existing native configuration is unchanged. Import does not add the resident to this conversation; process state does not prove an authenticated reply.");
                result
            },
            ResidentProposalCompletionV1::NativeCreated { transaction_id, attached_conversation_id } => {
                native_result(&app, &scope, &request_id, &transaction_id, attached_conversation_id.as_deref())?
            },
            ResidentProposalCompletionV1::ManagedCreated { resident_pubkey, persona_id, attached_conversation_id } =>
                resident_result(&app, &scope, &resident_pubkey, Some(&persona_id), attached_conversation_id.as_deref())?,
            ResidentProposalCompletionV1::DefinitionSaved { persona_id } => {
                let persona = crate::managed_agents::load_personas(&app)?.into_iter()
                    .find(|persona| persona.id == persona_id).ok_or("The saved definition is unavailable.")?;
                json!({"status": "definition_available", "personaId": persona.id, "displayName": persona.display_name,
                    "message": "This agent definition is available. This result alone does not establish when it was saved or establish a running resident.", "authenticatedReady": false})
            },
            ResidentProposalCompletionV1::Closed { busy } => {
                let transaction = lock_proposals()?.get(&request_id)
                    .and_then(|proposal| proposal.native_transaction_id.clone());
                let mut result = incomplete_result(&request_id, transaction.as_deref(), if busy { "another_review_open" } else { "review_closed" });
                add_import_incomplete(&mut result, lock_proposals()?.get(&request_id).and_then(|proposal| proposal.native_import.as_ref()));
                result
            }
        };
        result["requestId"] = json!(request_id);
        if !closed { verify_origin(&app, &scope)?; }
        if acknowledged { return Ok(false); }
        complete_pending_with_receipt(proposals(), &request_id, result, Some(completion))
    }).await.map_err(|_| "Resident setup result worker failed.".to_owned())?
}

#[cfg(test)]
mod tests;
