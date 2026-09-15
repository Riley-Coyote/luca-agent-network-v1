//! Chat answer as consent: creating a resident without opening a window.
//!
//! The owner asks Luca for a specialist, Luca asks which runtime and which
//! model — offering only what this desktop can actually start — says plainly
//! what it is about to create, and the owner's own reply is the consent. There
//! is no review dialog on this path: the reply *is* the review, so the host
//! verifies it as one. The agreeing message must be signed by the current
//! owner, belong to the same conversation, come after Luca's proposal message,
//! and be recent. A request without a valid agreeing message keeps the existing
//! review dialog.
//!
//! Creation then runs the same code the renderer's review runs — a definition,
//! then `create_luca_resident` — and returns the moment the record exists. The
//! process, its relay profile and the channel attachment finish afterwards, so
//! the honest word for what the owner is told is "waking", never "ready".

use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use luca_protocol::OpaqueId;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::{ProposalArguments, ResidentProposalScope};
use crate::managed_agents::{AcpAvailabilityStatus, NativeDiscoveryStatus, NativeRuntimeKind};

/// How long an agreeing message stays usable. Matches the review's own
/// lifetime: consent given a quarter of an hour ago is no longer this moment's
/// answer.
const CONSENT_LIFETIME_SECONDS: i64 = 15 * 60;
/// Tolerance for a message stamped slightly ahead of this machine's clock.
const CONSENT_FUTURE_SKEW_SECONDS: i64 = 60;
/// Recent conversation messages read when verifying consent.
const CONSENT_HISTORY_LIMIT: usize = 64;
const CONSENT_READ_DEADLINE: Duration = Duration::from_secs(8);
/// Model discovery starts a short-lived subprocess per runtime.
const MODEL_DISCOVERY_DEADLINE: Duration = Duration::from_secs(30);
/// One agreeing message creates one resident, however often the tool retries.
const CONSENT_RECEIPT_LIFETIME: Duration = Duration::from_secs(30 * 60);
const MAX_CONSENT_RECEIPTS: usize = 64;

/// The runtime families Luca may propose, and the discovery id each one
/// actually runs as. Hermes and OpenClaw have no ACP runtime of their own and
/// keep the existing owner review for now.
const RUNTIME_FAMILIES: &[(&str, Option<&str>, &str)] = &[
    ("codex", Some("codex"), "Codex"),
    ("claude_code", Some("claude"), "Claude Code"),
    ("hermes", None, "Hermes"),
    ("openclaw", None, "OpenClaw"),
];

/// The ACP runtime id a family starts on, when it has one.
pub(super) fn managed_runtime_id(family: &str) -> Option<&'static str> {
    RUNTIME_FAMILIES
        .iter()
        .find(|(name, _, _)| *name == family)
        .and_then(|(_, runtime, _)| *runtime)
}

// ── Reading the catalogue ────────────────────────────────────────────────────

/// Answer `list_resident_runtimes`: what this desktop can start, and the exact
/// model IDs each runtime reports. Read-only; it creates nothing.
pub(crate) fn list_resident_runtimes(app: &AppHandle, arguments: Value) -> Result<String, String> {
    if arguments
        .as_object()
        .is_none_or(|arguments| !arguments.is_empty())
    {
        return Err("Runtime catalogue arguments are invalid.".into());
    }
    let managed = crate::managed_agents::discover_acp_runtimes();
    let native = crate::managed_agents::discover_native_resident_outcome();
    let mut runtimes = Vec::new();
    for (family, runtime_id, label) in RUNTIME_FAMILIES {
        let entry = match runtime_id {
            Some(runtime_id) => {
                let Some(entry) = managed
                    .iter()
                    .find(|entry| entry.id.as_str() == *runtime_id)
                else {
                    runtimes.push(json!({
                        "family": family, "id": runtime_id, "label": label,
                        "available": false, "models": [],
                        "unavailableReason": "This runtime was not found on this computer."
                    }));
                    continue;
                };
                entry
            }
            None => {
                let kind = if *family == "hermes" {
                    NativeRuntimeKind::Hermes
                } else {
                    NativeRuntimeKind::Openclaw
                };
                let outcome = native
                    .runtimes
                    .iter()
                    .find(|outcome| outcome.native_type == kind);
                let available =
                    outcome.is_some_and(|outcome| outcome.status == NativeDiscoveryStatus::Available);
                runtimes.push(json!({
                    "family": family, "id": family, "label": label, "available": available,
                    "models": [],
                    "unavailableReason": if available { None } else {
                        Some(outcome.and_then(|outcome| outcome.message.clone())
                            .unwrap_or_else(|| "Not found on this computer.".to_owned()))
                    },
                    "note": "An existing native agent is set up through Polyphonic's owner review, and keeps the model it is already configured with."
                }));
                continue;
            }
        };
        if entry.availability != AcpAvailabilityStatus::Available {
            runtimes.push(json!({
                "family": family, "id": entry.id, "label": entry.label,
                "available": false, "models": [],
                "unavailableReason": entry.install_hint
            }));
            continue;
        }
        let (models, reason) = match discover_runtime_models(app, entry) {
            Ok(models) => (models, None),
            Err(error) => (Vec::new(), Some(error)),
        };
        runtimes.push(json!({
            "family": family, "id": entry.id, "label": entry.label,
            "available": true,
            "models": models.iter().map(|model| json!({
                "id": model.0, "label": model.1
            })).collect::<Vec<_>>(),
            "modelsUnavailableReason": reason
        }));
    }
    serde_json::to_string(&json!({
        "runtimes": runtimes,
        "message": "Offer the owner only runtimes marked available, and only these exact model IDs. Pass the chosen ID back unchanged; a model that is not listed here is refused rather than replaced."
    }))
    .map_err(|_| "The runtime catalogue could not be encoded.".into())
}

/// The exact model IDs one available runtime reports, as `(id, label)`.
fn discover_runtime_models(
    app: &AppHandle,
    entry: &crate::managed_agents::AcpRuntimeCatalogEntry,
) -> Result<Vec<(String, String)>, String> {
    let Some(command) = entry.command.clone() else {
        return Err("This runtime did not report a command to query.".into());
    };
    let input = crate::commands::DiscoverAgentModelsInput {
        acp_command: None,
        agent_command: command,
        agent_args: entry.default_args.clone(),
        provider: None,
        env_vars: std::collections::BTreeMap::new(),
    };
    let app = app.clone();
    let response = tauri::async_runtime::block_on(async move {
        tokio::time::timeout(MODEL_DISCOVERY_DEADLINE, async {
            let state = app.state::<crate::app_state::AppState>();
            crate::commands::discover_agent_models(input, state).await
        })
        .await
        .map_err(|_| "Reading this runtime's models took too long.".to_owned())?
    })?;
    Ok(response
        .models
        .into_iter()
        .map(|model| {
            let label = model.name.unwrap_or_else(|| model.id.clone());
            (model.id, label)
        })
        .collect())
}

/// Resolve the owner's chosen model against what the runtime really offers.
/// A model this runtime does not list is refused with the real list; it is
/// never quietly replaced with a working one.
fn resolve_model(
    app: &AppHandle,
    entry: &crate::managed_agents::AcpRuntimeCatalogEntry,
    requested: Option<&str>,
) -> Result<String, Value> {
    let models = discover_runtime_models(app, entry).map_err(|error| {
        json!({
            "status": "model_unavailable", "runtime": entry.id, "models": [],
            "reason": error,
            "message": "This runtime's model list could not be read, so no model can be confirmed. Tell the owner plainly and try again rather than choosing one."
        })
    })?;
    let listed = || {
        models
            .iter()
            .map(|(id, label)| json!({"id": id, "label": label}))
            .collect::<Vec<_>>()
    };
    let Some(requested) = requested.map(str::trim).filter(|value| !value.is_empty()) else {
        return Err(json!({
            "status": "model_required", "runtime": entry.id, "models": listed(),
            "message": "Ask the owner which of these models to use, then propose again with that exact ID."
        }));
    };
    if let Some((id, _)) = models.iter().find(|(id, _)| id == requested) {
        return Ok(id.clone());
    }
    Err(json!({
        "status": "model_unavailable", "runtime": entry.id, "requested": requested,
        "models": listed(),
        "message": "This runtime does not offer that model. Tell the owner which models it does offer and ask again; do not substitute one."
    }))
}

// ── Verifying the owner's answer ─────────────────────────────────────────────

/// One recent conversation message, reduced to the facts consent turns on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ConversationMessage {
    pub id: String,
    pub author: String,
    pub conversation: String,
    pub created_at: i64,
    pub signature_valid: bool,
}

/// Decide whether one message really is this owner agreeing to this proposal.
///
/// Pure on purpose: every refusal below is a case the review dialog used to
/// make impossible, so each one is worth a test.
pub(super) fn verified_consent<'a>(
    messages: &'a [ConversationMessage],
    consent_event_id: &str,
    owner: &str,
    resident: &str,
    conversation: &str,
    now: i64,
) -> Result<&'a ConversationMessage, String> {
    let consent = messages
        .iter()
        .find(|message| message.id == consent_event_id)
        .ok_or("The agreeing message is not in this conversation's recent history.")?;
    if !consent.signature_valid {
        return Err("The agreeing message could not be verified.".into());
    }
    if consent.conversation != conversation {
        return Err("The agreeing message belongs to another conversation.".into());
    }
    if consent.author != owner {
        return Err("Only the owner's own message can agree to a new resident.".into());
    }
    if consent.created_at > now + CONSENT_FUTURE_SKEW_SECONDS {
        return Err("The agreeing message is not yet valid on this computer.".into());
    }
    if now - consent.created_at > CONSENT_LIFETIME_SECONDS {
        return Err("That agreement is too old. Ask again before creating a resident.".into());
    }
    let proposed = messages.iter().any(|message| {
        message.signature_valid
            && message.author == resident
            && message.conversation == conversation
            && message.created_at < consent.created_at
    });
    if !proposed {
        return Err(
            "Say what you are about to create and let the owner answer that; the message you named came before any proposal.".into(),
        );
    }
    Ok(consent)
}

/// Read this conversation's recent messages from the relay and verify consent.
fn verify_owner_consent(
    app: &AppHandle,
    scope: &ResidentProposalScope,
    consent_event_id: &str,
) -> Result<(), String> {
    let state = app.state::<crate::app_state::AppState>();
    let owner = scope.owner.as_str().to_owned();
    let resident = scope.resident.as_str().to_owned();
    let conversation = scope.conversation.as_str().to_owned();
    let events = tauri::async_runtime::block_on(async {
        tokio::time::timeout(
            CONSENT_READ_DEADLINE,
            crate::relay::query_relay(
                &state,
                &[json!({
                    "kinds": [9],
                    "authors": [owner.as_str(), resident.as_str()],
                    "#h": [conversation.as_str()],
                    "limit": CONSENT_HISTORY_LIMIT
                })],
            ),
        )
        .await
        .map_err(|_| "Reading this conversation took too long.".to_owned())?
    })?;
    let messages: Vec<ConversationMessage> = events
        .into_iter()
        .map(|event| ConversationMessage {
            id: event.id.to_hex(),
            author: event.pubkey.to_hex(),
            conversation: event
                .tags
                .iter()
                .find_map(|tag| {
                    let parts = tag.as_slice();
                    (parts.len() >= 2 && parts[0] == "h").then(|| parts[1].clone())
                })
                .unwrap_or_default(),
            created_at: event.created_at.as_secs() as i64,
            signature_valid: event.verify().is_ok(),
        })
        .collect();
    verified_consent(
        &messages,
        consent_event_id,
        &owner,
        &resident,
        &conversation,
        chrono::Utc::now().timestamp(),
    )
    .map(|_| ())
}

// ── One agreement, one resident ──────────────────────────────────────────────

#[derive(Clone)]
struct ConsentReceipt {
    result: Value,
    deadline: Instant,
}

fn consent_receipts() -> &'static Mutex<HashMap<String, ConsentReceipt>> {
    static RECEIPTS: OnceLock<Mutex<HashMap<String, ConsentReceipt>>> = OnceLock::new();
    RECEIPTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn existing_receipt(consent_event_id: &str) -> Option<Value> {
    let mut receipts = consent_receipts().lock().ok()?;
    receipts.retain(|_, receipt| Instant::now() < receipt.deadline);
    receipts
        .get(consent_event_id)
        .map(|receipt| receipt.result.clone())
}

fn remember_receipt(consent_event_id: &str, result: &Value) {
    let Ok(mut receipts) = consent_receipts().lock() else {
        return;
    };
    receipts.retain(|_, receipt| Instant::now() < receipt.deadline);
    while receipts.len() >= MAX_CONSENT_RECEIPTS {
        let Some(oldest) = receipts
            .iter()
            .min_by_key(|(_, receipt)| receipt.deadline)
            .map(|(id, _)| id.clone())
        else {
            break;
        };
        receipts.remove(&oldest);
    }
    receipts.insert(
        consent_event_id.to_owned(),
        ConsentReceipt {
            result: result.clone(),
            deadline: Instant::now() + CONSENT_RECEIPT_LIFETIME,
        },
    );
}

// ── Creating it ──────────────────────────────────────────────────────────────

/// Whether this request should skip the review dialog. Only a fresh managed
/// creation with an agreeing message qualifies; import and native provisioning
/// keep the owner review.
pub(super) fn takes_direct_path(arguments: &ProposalArguments) -> bool {
    arguments.consent_event_id.is_some()
        && arguments.provisioning_intent.as_deref() != Some("import")
        && arguments.native_profile_name.is_none()
}

/// Create the resident the owner just agreed to, and return once its record
/// exists. Startup continues in the background.
pub(super) fn create_from_consent(
    app: &AppHandle,
    scope: &ResidentProposalScope,
    arguments: &ProposalArguments,
) -> Result<Value, String> {
    let consent_event_id = arguments
        .consent_event_id
        .as_deref()
        .ok_or("No agreeing message was supplied.")?;
    if let Some(result) = existing_receipt(consent_event_id) {
        return Ok(result);
    }
    let Some(family) = arguments.runtime_family.as_deref() else {
        return Ok(json!({
            "status": "runtime_required",
            "message": "Ask the owner which runtime to use. Call list_resident_runtimes and offer only the available ones.",
            "authenticatedReady": false
        }));
    };
    let Some(runtime_id) = managed_runtime_id(family) else {
        return Err("An existing native agent is still set up through Polyphonic's owner review. Propose it without an agreeing message.".into());
    };
    let runtimes = crate::managed_agents::discover_acp_runtimes();
    let Some(entry) = runtimes.iter().find(|entry| {
        entry.id.as_str() == runtime_id
            && entry.availability == AcpAvailabilityStatus::Available
            && entry.command.is_some()
    }) else {
        return Ok(json!({
            "status": "runtime_unavailable", "runtime": runtime_id,
            "message": "This computer cannot start that runtime right now. Call list_resident_runtimes and offer the owner one that is available.",
            "authenticatedReady": false
        }));
    };
    let model = match resolve_model(app, entry, arguments.model.as_deref()) {
        Ok(model) => model,
        Err(refusal) => return Ok(refusal),
    };
    // Re-verify the origin after the model subprocess: owner or runtime
    // replacement may have happened while it ran.
    super::verify_origin(app, scope)?;
    verify_owner_consent(app, scope, consent_event_id)?;
    if let Some(result) = existing_receipt(consent_event_id) {
        return Ok(result);
    }

    let display_name = arguments.display_name.trim().to_owned();
    let persona = tauri::async_runtime::block_on(crate::commands::create_persona(
        serde_json::from_value(json!({
            "displayName": display_name,
            "avatarUrl": entry.avatar_url,
            "systemPrompt": arguments.system_prompt.trim(),
            "runtime": entry.id,
            "model": model
        }))
        .map_err(|_| "The agreed definition could not be prepared.")?,
        app.clone(),
    ))?;

    // Mark before creating: the rail reads this the moment the record is saved,
    // which happens inside the call below.
    crate::managed_agents::waking::mark_waking(&persona.id);
    let created = tauri::async_runtime::block_on(super::super::resident_registry::create_luca_resident(
        serde_json::from_value(json!({
            "name": display_name,
            "personaId": persona.id,
            "systemPrompt": arguments.system_prompt.trim(),
            "avatarUrl": entry.avatar_url,
            "acpCommand": "buzz-acp",
            "agentCommand": entry.command,
            "agentArgs": entry.default_args,
            "mcpCommand": entry.mcp_command.clone().unwrap_or_default(),
            "harnessOverride": true,
            "model": model,
            "parallelism": 1,
            // The record must exist before this call returns; the process is
            // started by the background bring-up below.
            "spawnAfterCreate": false,
            "startOnAppLaunch": true,
            "backend": {"type": "local"}
        }))
        .map_err(|_| "The agreed resident could not be prepared.")?,
        app.clone(),
        app.state::<crate::app_state::AppState>(),
    ));
    let created = match created {
        Ok(created) => created,
        Err(error) => {
            crate::managed_agents::waking::clear_waking(&persona.id);
            return Err(error.message);
        }
    };

    let resident_pubkey = created.resident.resident_pubkey.as_str().to_owned();
    let result = json!({
        "status": "created_waking",
        "residentPubkey": resident_pubkey,
        "displayName": created.resident.display_name,
        "personaId": persona.id,
        "runtime": entry.id,
        "model": model,
        "purpose": arguments.purpose,
        "conversationId": scope.conversation,
        "attached": false,
        "processRunning": false,
        "authenticatedReady": false,
        "setupWarning": created
            .profile_sync_error
            .clone()
            .or(created.brain_access_error.clone())
            .or(created.recovery_notice.clone()),
        "message": "This resident exists and is waking. It is not running yet and has not replied; say created and waking, never ready. Read polyphonic_status before claiming it can answer."
    });
    remember_receipt(consent_event_id, &result);
    start_in_background(app, scope, persona.id.clone(), resident_pubkey);
    Ok(result)
}

/// Finish bringing the resident up after the answer has already been returned:
/// start its process, then attach it to the conversation it was asked for.
/// Failures are written to the record, where the rail shows them.
fn start_in_background(
    app: &AppHandle,
    scope: &ResidentProposalScope,
    persona_id: String,
    resident_pubkey: String,
) {
    let app = app.clone();
    let conversation = scope.conversation.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let started = tauri::async_runtime::block_on(crate::commands::start_managed_agent(
            resident_pubkey.clone(),
            app.clone(),
            app.state::<crate::app_state::AppState>(),
        ));
        match started {
            Err(error) => record_bringup_error(&app, &resident_pubkey, &error),
            Ok(_) => {
                if let Err(error) = attach_to_conversation(&app, &conversation, &resident_pubkey) {
                    record_bringup_error(&app, &resident_pubkey, &error);
                }
            }
        }
        crate::managed_agents::waking::clear_waking(&persona_id);
        let _ = tauri::Emitter::emit(&app, "agents-data-changed", ());
    });
}

/// Add the new resident to the conversation it was created for. A direct
/// conversation is left alone: adding a third participant there would make a
/// different conversation, which is not what the owner agreed to.
fn attach_to_conversation(
    app: &AppHandle,
    conversation: &OpaqueId,
    resident_pubkey: &str,
) -> Result<(), String> {
    let event = super::current_conversation_event(app, conversation, 39000)?;
    let channel = crate::nostr_convert::channel_info_from_event(&event, None, None)?;
    if channel.channel_type == "dm" {
        return Ok(());
    }
    let outcome = tauri::async_runtime::block_on(crate::commands::add_channel_members(
        conversation.as_str().to_owned(),
        vec![resident_pubkey.to_owned()],
        Some("bot".to_owned()),
        app.state::<crate::app_state::AppState>(),
    ))?;
    let failed = outcome
        .get("errors")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|error| error.get("pubkey").and_then(Value::as_str) == Some(resident_pubkey))
        .and_then(|error| error.get("error").and_then(Value::as_str).map(str::to_owned));
    match failed {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

/// Write a bring-up failure where the owner can see it: the resident's own
/// record, which the rail reads.
fn record_bringup_error(app: &AppHandle, resident_pubkey: &str, error: &str) {
    let app = app.clone();
    let resident_pubkey = resident_pubkey.to_owned();
    let error = bounded_error(error);
    let _ = (|| -> Result<(), String> {
        let state = app.state::<crate::app_state::AppState>();
        let _store_guard = state
            .managed_agents_store_lock
            .lock()
            .map_err(|error| error.to_string())?;
        let mut records = crate::managed_agents::load_managed_agents(&app)?;
        let record = crate::managed_agents::find_managed_agent_mut(&mut records, &resident_pubkey)?;
        record.last_error = Some(error);
        record.updated_at = crate::util::now_iso();
        crate::managed_agents::save_managed_agents(&app, &records)
    })();
}

fn bounded_error(error: &str) -> String {
    let error: String = error
        .chars()
        .filter(|character| !character.is_control())
        .take(240)
        .collect();
    if error.trim().is_empty() {
        "Starting this resident did not finish.".to_owned()
    } else {
        error
    }
}

#[cfg(test)]
mod tests;
