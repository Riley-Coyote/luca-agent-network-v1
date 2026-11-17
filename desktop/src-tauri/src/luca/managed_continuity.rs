//! Desktop-owned, local-only continuity transport for Luca-managed ACP turns.
//!
//! The inherited socket carries one authority-minimized retrieval intent from
//! the managed ACP process. The desktop independently binds it to the exact
//! dispatch, runtime session, provider egress, key version, and encrypted
//! resident namespace before any body-bearing read occurs.

use std::{
    io::{BufRead, BufReader, Read, Write},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use luca_continuity::{ContinuityLayerMaterial, ContinuityReferenceItem, RetrievalText};
use luca_protocol::{
    canonical_sha256, canonicalize, ContinuityContextRequestV1, ContinuityContextResultV1,
    ContinuityLayerResultV1, ContinuityLayerStatusV1, ContinuityWorkingReferenceV1, Hex64,
    OpaqueId, ProviderEgressV1, SafeU53, Sha256Ref, CONTINUITY_PROTOCOL,
    MAX_CONTINUITY_PACKET_BYTES, MAX_CONTINUITY_REFS,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

#[cfg(unix)]
#[path = "managed_source_notes.rs"]
mod source_notes;

use crate::app_state::AppState;

use super::{
    continuity_capsule::{
        capsule_context_layer, capsule_wake_orientation, ContinuityCapsuleDesktopError,
    },
    continuity_capsule_relay::load_current_capsule,
    continuity_context::{
        resident_notebook_address, resolve_desktop_continuity_context, DesktopWakeSupplementV1,
    },
    conversation_context::active_scope,
    managed_dispatch_store::{
        global_dispatch_store, ManagedDispatchStore, ManagedTurnSessionContextStatusV1,
    },
    owner_brain_store::{OwnerBrainRetrievalRequestV1, OwnerBrainStoreError},
};

const INTENT_PROTOCOL: &str = "luca.managed.continuity-intent.v1";
const SESSION_CONTEXT_INTENT_PROTOCOL: &str = "luca.managed.session-context-intent.v1";
const SESSION_CONTEXT_RESULT_PROTOCOL: &str = "luca.managed.session-context-result.v1";
const MAX_FRAME_BYTES: usize = 384 * 1024;
const MAX_CUE_BYTES: usize = 4 * 1024;
const MAX_RESOLUTION_MILLIS: u64 = 3_000;
const MAX_CAPSULE_LOAD_MILLIS: u64 = 750;
const LAYERS: [&str; 5] = [
    "capsule",
    "handoff",
    "hypomnema",
    "associative_recall",
    "owner_brain",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AuthorizedPacketWrite {
    Written,
    Denied,
}

#[derive(Deserialize)]
// This is only the protocol discriminator for a complete intent frame, so the
// request-specific fields must remain available to the strict parser below.
struct IntentEnvelopeV1 {
    protocol: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ManagedSessionContextIntentV1 {
    protocol: String,
    request_id: OpaqueId,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    conversation_id: OpaqueId,
    trigger_event_id: Hex64,
    deadline_unix_ms: SafeU53,
    #[serde(default)]
    quickchat_report: Option<super::quickchat::RuntimeReport>,
    #[serde(default)]
    isolate_exchange_history: bool,
}

impl ManagedSessionContextIntentV1 {
    fn validate(&self) -> bool {
        self.protocol == SESSION_CONTEXT_INTENT_PROTOCOL
            && self.session_epoch.get() > 0
            && self.deadline_unix_ms.get() > 0
    }
}

impl std::fmt::Debug for ManagedSessionContextIntentV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ManagedSessionContextIntentV1")
            .field("protocol", &self.protocol)
            .field("request_id", &self.request_id)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("session_epoch", &self.session_epoch)
            .field("conversation_id", &self.conversation_id)
            .field("trigger_event_id", &self.trigger_event_id)
            .field("deadline_unix_ms", &self.deadline_unix_ms)
            .finish()
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum ManagedSessionContextStatusV1 {
    Empty,
    Ready,
    MissingPrimary,
    Degraded,
    Denied,
    Unavailable,
}

#[derive(Serialize)]
struct ManagedSessionContextResultV1 {
    protocol: String,
    request_id: OpaqueId,
    resident_pubkey: Hex64,
    status: ManagedSessionContextStatusV1,
    snapshot_ref: Option<Sha256Ref>,
    revision: SafeU53,
    cwd: Option<String>,
    additional_directories: Vec<String>,
    selected_source_ids: Vec<OpaqueId>,
    native_roots_ref: Option<Sha256Ref>,
    attached_session_context: Option<String>,
    #[serde(default)]
    quick_chat_effort: Option<super::quickchat::EffortRequest>,
    #[serde(default)]
    quick_chat_context: Option<String>,
    first_meeting_context: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    awareness_context: Option<super::companion_awareness::turn_context::AwarenessTurnContextV1>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    isolate_awareness_history: bool,
    /// Exact clean finals admitted by host provenance, never model assertions.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    clean_conversation_reply_ids: Vec<Hex64>,
}

/// Strict mirror of the authority-minimized ACP request. Its custom Debug
/// implementation never exposes the retrieval cue.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ManagedContinuityTurnIntentV1 {
    protocol: String,
    request_id: OpaqueId,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    turn_id: OpaqueId,
    conversation_id: OpaqueId,
    trigger_event_id: Hex64,
    history_event_ids: Vec<Hex64>,
    retrieval_cue: String,
    deadline_unix_ms: SafeU53,
    max_packet_bytes: SafeU53,
}

impl ManagedContinuityTurnIntentV1 {
    fn validate(&self) -> bool {
        if self.protocol != INTENT_PROTOCOL
            || self.session_epoch.get() == 0
            || self.deadline_unix_ms.get() == 0
            || self.max_packet_bytes.get() == 0
            || self.max_packet_bytes.get() as usize > MAX_CONTINUITY_PACKET_BYTES
            || self.history_event_ids.len() > MAX_CONTINUITY_REFS
            || self.retrieval_cue.is_empty()
            || self.retrieval_cue.len() > MAX_CUE_BYTES
            || self
                .history_event_ids
                .iter()
                .any(|event_id| event_id == &self.trigger_event_id)
        {
            return false;
        }
        let mut unique = self.history_event_ids.clone();
        unique.sort();
        unique.dedup();
        unique.len() == self.history_event_ids.len()
    }
}

impl std::fmt::Debug for ManagedContinuityTurnIntentV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ManagedContinuityTurnIntentV1")
            .field("protocol", &self.protocol)
            .field("request_id", &self.request_id)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("session_epoch", &self.session_epoch)
            .field("turn_id", &self.turn_id)
            .field("conversation_id", &self.conversation_id)
            .field("trigger_event_id", &self.trigger_event_id)
            .field("history_event_count", &self.history_event_ids.len())
            .field("retrieval_cue_bytes", &self.retrieval_cue.len())
            .field("deadline_unix_ms", &self.deadline_unix_ms)
            .field("max_packet_bytes", &self.max_packet_bytes)
            .finish()
    }
}

/// Child-side descriptor for the anonymous local continuity socket.
#[cfg(unix)]
pub(crate) struct ManagedContinuityChildFd(std::os::fd::OwnedFd);

#[cfg(unix)]
impl ManagedContinuityChildFd {
    pub(crate) fn raw_fd(&self) -> std::os::fd::RawFd {
        use std::os::fd::AsRawFd;
        self.0.as_raw_fd()
    }
}

/// Create one per-resident, non-signing continuity endpoint.
#[cfg(unix)]
pub(crate) fn create_endpoint(
    app: AppHandle,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    binding_ref: Sha256Ref,
    provider_egress: ProviderEgressV1,
) -> Result<ManagedContinuityChildFd, String> {
    use std::os::fd::{FromRawFd, IntoRawFd};

    let (desktop, child) = std::os::unix::net::UnixStream::pair()
        .map_err(|error| format!("create managed continuity socketpair: {error}"))?;
    std::thread::Builder::new()
        .name("luca-managed-continuity".into())
        .spawn(move || {
            serve(
                app,
                desktop,
                resident_pubkey,
                session_epoch,
                binding_ref,
                provider_egress,
            )
        })
        .map_err(|error| format!("start managed continuity server: {error}"))?;
    let owned = unsafe { std::os::fd::OwnedFd::from_raw_fd(child.into_raw_fd()) };
    Ok(ManagedContinuityChildFd(owned))
}

#[cfg(unix)]
fn serve(
    app: AppHandle,
    stream: std::os::unix::net::UnixStream,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    binding_ref: Sha256Ref,
    provider_egress: ProviderEgressV1,
) {
    let mut writer = match stream.try_clone() {
        Ok(writer) => writer,
        Err(_) => return,
    };
    let mut reader = BufReader::new(stream);
    loop {
        let mut frame = Zeroizing::new(Vec::new());
        let read = {
            let mut limited = reader.by_ref().take((MAX_FRAME_BYTES + 1) as u64);
            limited.read_until(b'\n', &mut frame)
        };
        let Ok(read) = read else { break };
        if read == 0 {
            break;
        }
        if frame.len() > MAX_FRAME_BYTES || frame.last() != Some(&b'\n') {
            break;
        }
        let Ok(envelope) = serde_json::from_slice::<IntentEnvelopeV1>(&frame) else {
            break;
        };
        if envelope.protocol == SESSION_CONTEXT_INTENT_PROTOCOL {
            let Ok(intent) = serde_json::from_slice::<ManagedSessionContextIntentV1>(&frame) else {
                break;
            };
            if !intent.validate()
                || intent.resident_pubkey != resident_pubkey
                || intent.session_epoch != session_epoch
            {
                break;
            }
            if write_session_context_result(
                &app,
                &mut writer,
                &intent,
                &binding_ref,
                provider_egress,
            )
            .is_err()
            {
                break;
            }
            continue;
        }
        let Ok(mut intent) = serde_json::from_slice::<ManagedContinuityTurnIntentV1>(&frame) else {
            break;
        };
        if !intent.validate()
            || intent.resident_pubkey != resident_pubkey
            || intent.session_epoch != session_epoch
        {
            break;
        }

        let now_unix_ms = unix_time_millis();
        if now_unix_ms >= intent.deadline_unix_ms.get() {
            if write_fallback(&mut writer, &intent, ContinuityLayerStatusV1::Timeout).is_err() {
                break;
            }
            continue;
        }

        let dispatch_store = global_dispatch_store(&app).ok();
        let authority = dispatch_store.as_ref().and_then(|store| {
            store
                .lock()
                .ok()?
                .authorize_continuity_turn(
                    intent.trigger_event_id.as_str(),
                    intent.resident_pubkey.as_str(),
                    intent.conversation_id.as_str(),
                    intent.session_epoch.get(),
                    now_unix_ms / 1_000,
                )
                .ok()
        });
        let Some(authority) = authority else {
            if write_fallback(&mut writer, &intent, ContinuityLayerStatusV1::Denied).is_err() {
                break;
            }
            continue;
        };
        let Some(dispatch_store) = dispatch_store else {
            continue;
        };

        // The resident-private overlay is independently controllable. Its
        // disabled/unavailable state must not suppress separately granted
        // owner-brain material.
        let resident_override_status = match super::continuity_jobs::continuity_mode(
            &app,
            &authority.owner_pubkey,
            &authority.resident_pubkey,
        ) {
            Ok(luca_protocol::ResidentContinuityModeV1::Enabled) => None,
            Ok(luca_protocol::ResidentContinuityModeV1::Disabled) => {
                Some(ContinuityLayerStatusV1::Empty)
            }
            Err(_) => Some(ContinuityLayerStatusV1::Unavailable),
        };

        let state = app.state::<AppState>();
        let receipt_relay_scope = active_scope(&state)
            .ok()
            .filter(|(owner, _)| owner == &authority.owner_pubkey)
            .and_then(|(_, relay_scope)| Sha256Ref::parse(relay_scope).ok());
        let Some(key_version) = state.continuity_owner_key_version(&authority.owner_pubkey) else {
            if write_fallback(&mut writer, &intent, ContinuityLayerStatusV1::Unavailable).is_err() {
                break;
            }
            continue;
        };
        let Ok(address) = resident_notebook_address(
            &authority.owner_pubkey,
            &authority.resident_pubkey,
            key_version,
        ) else {
            if write_fallback(&mut writer, &intent, ContinuityLayerStatusV1::Invalid).is_err() {
                break;
            }
            continue;
        };

        let selected_source_ids = authority
            .context_binding
            .as_ref()
            .and_then(|binding| {
                super::conversation_context::selected_sources_for_dispatch(
                    &app,
                    &authority.owner_pubkey,
                    &authority.conversation_id,
                    binding,
                )
                .ok()
            })
            .unwrap_or_default();
        let receipt_selected_source_ids = selected_source_ids.iter().cloned().collect::<Vec<_>>();
        let receipt_owner = authority.owner_pubkey.clone();
        let receipt_resident = authority.resident_pubkey.clone();
        let receipt_conversation = authority.conversation_id.clone();
        let receipt_trigger = authority.trigger_event_id.clone();
        let receipt_binding = authority.context_binding.clone();
        let request = ContinuityContextRequestV1 {
            protocol: CONTINUITY_PROTOCOL.into(),
            request_id: intent.request_id.clone(),
            owner_pubkey: authority.owner_pubkey,
            resident_pubkey: authority.resident_pubkey,
            conversation_id: authority.conversation_id,
            binding_ref: binding_ref.clone(),
            canonical_dispatch_ref: authority.canonical_dispatch_ref,
            provider_egress,
            deadline_unix_ms: intent.deadline_unix_ms,
            max_packet_bytes: intent.max_packet_bytes,
            history_event_ids: std::mem::take(&mut intent.history_event_ids),
        };
        let cue = RetrievalText::from(std::mem::take(&mut intent.retrieval_cue));
        let remaining = intent
            .deadline_unix_ms
            .get()
            .saturating_sub(now_unix_ms)
            .min(MAX_RESOLUTION_MILLIS);
        let deadline = Instant::now() + Duration::from_millis(remaining);
        let owner_brain = load_owner_brain_context(
            &state,
            OwnerBrainRetrievalRequestV1 {
                request_id: request.request_id.clone(),
                owner_pubkey: request.owner_pubkey.clone(),
                resident_pubkey: request.resident_pubkey.clone(),
                binding_ref: request.binding_ref.clone(),
                provider_egress: request.provider_egress,
                cue: cue.clone(),
                selected_source_ids,
                deadline,
            },
        );
        // A resident linked to a Mnemos mind wakes as that mind, from its own
        // memory: Polyphonic's capsule orientation would be a second identity.
        let capsule = if crate::commands::mnemos_linked(
            &app,
            request.owner_pubkey.as_str(),
            request.resident_pubkey.as_str(),
        ) {
            linked_mind_capsule()
        } else {
            load_capsule_context(
                &state,
                &request.owner_pubkey,
                &request.resident_pubkey,
                remaining.clamp(1, MAX_CAPSULE_LOAD_MILLIS),
            )
        };
        let delivery_trigger = intent.trigger_event_id.clone();
        let delivery_resident = intent.resident_pubkey.clone();
        let delivery_conversation = intent.conversation_id.clone();
        let delivery_session_epoch = intent.session_epoch;
        let delivery_deadline_unix_ms = intent.deadline_unix_ms.get();
        let mut write_result = None;
        let outcome = resolve_desktop_continuity_context(
            &state,
            request,
            address,
            cue,
            DesktopWakeSupplementV1 {
                capsule_layer: capsule.layer,
                capsule_identity_orientation: capsule.identity_orientation,
                capsule_relationship_orientation: capsule.relationship_orientation,
                owner_brain_layer: owner_brain.layer,
                owner_brain_references: owner_brain.references,
            },
            resident_override_status,
            deadline,
            now_unix_ms,
            |wire| {
                write_result = Some(write_authorized_packet(
                    &dispatch_store,
                    &mut writer,
                    wire,
                    &delivery_trigger,
                    &delivery_resident,
                    &delivery_conversation,
                    delivery_session_epoch,
                    delivery_deadline_unix_ms,
                ));
            },
        );
        match write_result {
            Some(Ok(AuthorizedPacketWrite::Written)) => {
                let Some(binding) = receipt_binding else {
                    continue;
                };
                let (active_owner, active_relay_scope) = match active_scope(&state) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                let Some(frozen_relay_scope) = receipt_relay_scope else {
                    continue;
                };
                if active_owner != receipt_owner
                    || Sha256Ref::parse(active_relay_scope).ok().as_ref()
                        != Some(&frozen_relay_scope)
                {
                    continue;
                }
                let _ = dispatch_store.lock().ok().and_then(|mut store| {
                    store
                        .record_turn_context_continuity_delivery(
                            &receipt_owner,
                            frozen_relay_scope,
                            &receipt_trigger,
                            &receipt_resident,
                            &receipt_conversation,
                            delivery_session_epoch,
                            binding.snapshot_ref,
                            SafeU53::new(binding.revision).ok()?,
                            receipt_selected_source_ids,
                            outcome.receipt().status,
                            outcome.receipt().layer_statuses,
                        )
                        .ok()
                });
            }
            Some(Ok(AuthorizedPacketWrite::Denied)) => {
                if write_fallback(&mut writer, &intent, ContinuityLayerStatusV1::Denied).is_err() {
                    break;
                }
            }
            Some(Err(_)) => {
                break;
            }
            None => {
                if write_fallback(&mut writer, &intent, outcome.receipt().status).is_err() {
                    break;
                }
            }
        }
    }
}

#[cfg(unix)]
fn write_session_context_result(
    app: &AppHandle,
    writer: &mut std::os::unix::net::UnixStream,
    intent: &ManagedSessionContextIntentV1,
    binding_ref: &Sha256Ref,
    provider_egress: ProviderEgressV1,
) -> std::io::Result<()> {
    let unavailable = |status| ManagedSessionContextResultV1 {
        protocol: SESSION_CONTEXT_RESULT_PROTOCOL.to_owned(),
        request_id: intent.request_id.clone(),
        resident_pubkey: intent.resident_pubkey.clone(),
        status,
        snapshot_ref: None,
        revision: SafeU53::new(0).expect("zero is a safe revision sentinel"),
        cwd: None,
        additional_directories: Vec::new(),
        selected_source_ids: Vec::new(),
        native_roots_ref: None,
        attached_session_context: None,
        quick_chat_effort: None,
        quick_chat_context: None,
        first_meeting_context: None,
        awareness_context: None,
        isolate_awareness_history: false,
        clean_conversation_reply_ids: Vec::new(),
    };
    let now_unix_ms = unix_time_millis();
    if intent.isolate_exchange_history {
        // An admitted sibling earns a reply, not access to owner/Brain/activity
        // context. Use the existing fresh-session contract without delivering
        // any optional context. Publication still checks the live exchange.
        let mut result = unavailable(ManagedSessionContextStatusV1::Denied);
        if now_unix_ms < intent.deadline_unix_ms.get() && intent.quickchat_report.is_none() {
            if let Ok(store) = global_dispatch_store(app) {
                super::exchange::ensure_wake_dispatch(
                    app, &store, intent.trigger_event_id.as_str(),
                    intent.resident_pubkey.as_str(), now_unix_ms / 1_000,
                );
                let bound = store.lock().ok().and_then(|mut store| {
                    bind_exchange_history_isolation(&mut store, intent, binding_ref, now_unix_ms / 1_000).ok()
                });
                if bound.is_some() {
                    result.status = ManagedSessionContextStatusV1::Empty;
                    result.isolate_awareness_history = true;
                }
            }
        }
        return write_session_context_frame(writer, intent, &result);
    }
    let mut attached_session_context = None;
    let mut quick_chat_effort = None;
    let mut quick_chat_context = None;
    let mut first_meeting_context = None;
    let mut receipt_authority = None;
    let mut receipt_scope = None;
    let mut result = if now_unix_ms >= intent.deadline_unix_ms.get() {
        unavailable(ManagedSessionContextStatusV1::Unavailable)
    } else {
        let authority = global_dispatch_store(app).ok().and_then(|store| {
            store
                .lock()
                .ok()?
                .authorize_continuity_turn(
                    intent.trigger_event_id.as_str(),
                    intent.resident_pubkey.as_str(),
                    intent.conversation_id.as_str(),
                    intent.session_epoch.get(),
                    now_unix_ms / 1_000,
                )
                .ok()
        });
        match authority {
            None => unavailable(ManagedSessionContextStatusV1::Denied),
            Some(authority) => {
                receipt_authority = Some(authority.clone());
                receipt_scope = active_scope(&app.state::<AppState>())
                    .ok()
                    .filter(|(owner, _)| owner == &authority.owner_pubkey)
                    .and_then(|(_, relay_scope)| Sha256Ref::parse(relay_scope).ok());
                if let Some(report) = &intent.quickchat_report {
                    super::quickchat::record_runtime_report(
                        app,
                        &authority.owner_pubkey,
                        intent.resident_pubkey.as_str(),
                        intent.conversation_id.as_str(),
                        intent.trigger_event_id.as_str(),
                        report,
                    );
                    // ACP sends this acknowledgement after resolving the turn's
                    // context. It is not a second context request: reframing here
                    // could discard the reply lease for the already-delivered frame.
                    return write_session_context_frame(
                        writer,
                        intent,
                        &unavailable(ManagedSessionContextStatusV1::Empty),
                    );
                }
                quick_chat_effort = super::quickchat::effort_for_dispatch(
                    &app.state::<AppState>(),
                    &authority.owner_pubkey,
                    intent.resident_pubkey.as_str(),
                    intent.conversation_id.as_str(),
                    intent.trigger_event_id.as_str(),
                );
                attached_session_context = super::session_attachment::for_dispatch(
                    app,
                    &authority.owner_pubkey,
                    intent.conversation_id.as_str(),
                )
                .ok()
                .flatten();
                if let Ok(Some(context)) = super::quickchat::for_dispatch(
                    &app.state::<AppState>(),
                    &authority.owner_pubkey,
                    intent.conversation_id.as_str(),
                    intent.trigger_event_id.as_str(),
                ) {
                    quick_chat_context = Some(context);
                }
                // A linked Mnemos mind already knows the owner: no first-meeting
                // brief introduces them to each other again.
                first_meeting_context = if crate::commands::mnemos_linked(
                    app,
                    authority.owner_pubkey.as_str(),
                    intent.resident_pubkey.as_str(),
                ) {
                    None
                } else {
                    super::first_meeting::for_dispatch(
                        app,
                        &authority.owner_pubkey,
                        intent.resident_pubkey.as_str(),
                        intent.conversation_id.as_str(),
                        intent.trigger_event_id.as_str(),
                        binding_ref,
                        provider_egress,
                        intent.deadline_unix_ms.get(),
                    )
                };
                match authority.context_binding {
                    None => unavailable(ManagedSessionContextStatusV1::Empty),
                    Some(snapshot) => {
                        let state = app.state::<AppState>();
                        match super::conversation_context::resolve_dispatch_context(
                            app,
                            &state,
                            &authority.owner_pubkey,
                            &authority.conversation_id,
                            &snapshot,
                        ) {
                            Ok(resolved) => {
                                let cwd = resolved
                                    .cwd
                                    .as_ref()
                                    .and_then(|path| path.to_str())
                                    .map(str::to_owned);
                                let additional_directories = resolved
                                    .additional_directories
                                    .iter()
                                    .map(|path| path.to_str().map(str::to_owned))
                                    .collect::<Option<Vec<_>>>();
                                match (
                                    resolved.cwd.is_none() || cwd.is_some(),
                                    additional_directories,
                                ) {
                                    (true, Some(additional_directories)) => {
                                        ManagedSessionContextResultV1 {
                                            protocol: SESSION_CONTEXT_RESULT_PROTOCOL.to_owned(),
                                            request_id: intent.request_id.clone(),
                                            resident_pubkey: intent.resident_pubkey.clone(),
                                            status: if resolved.degraded {
                                                ManagedSessionContextStatusV1::Degraded
                                            } else {
                                                ManagedSessionContextStatusV1::Ready
                                            },
                                            snapshot_ref: Some(resolved.snapshot_ref),
                                            revision: SafeU53::new(resolved.revision)
                                                .unwrap_or_else(|_| {
                                                    SafeU53::new(0).expect("zero safe sentinel")
                                                }),
                                            cwd,
                                            additional_directories,
                                            selected_source_ids: resolved.selected_source_ids,
                                            native_roots_ref: Some(resolved.native_roots_ref),
                                            attached_session_context: None,
                                            quick_chat_effort: None,
                                            quick_chat_context: None,
                                            first_meeting_context: None,
                                            awareness_context: None,
                                            isolate_awareness_history: false,
                                            clean_conversation_reply_ids: Vec::new(),
                                        }
                                    }
                                    _ => unavailable(ManagedSessionContextStatusV1::Unavailable),
                                }
                            }
                            Err(error) if error == "conversation_context:missing_primary" => {
                                unavailable(ManagedSessionContextStatusV1::MissingPrimary)
                            }
                            Err(_) => unavailable(ManagedSessionContextStatusV1::Unavailable),
                        }
                    }
                }
            }
        }
    };
    result.attached_session_context = attached_session_context;
    result.quick_chat_effort = quick_chat_effort;
    result.quick_chat_context = quick_chat_context;
    result.first_meeting_context = first_meeting_context;
    if let Some(authority) = &receipt_authority {
        if let Some((isolate, clean_replies)) = global_dispatch_store(app).ok()
            .and_then(|store| {
                store.lock().ok().map(|store| (
                    store.awareness_history_requires_isolation(authority),
                    store.clean_conversation_reply_ids(authority),
                ))
            }) {
            result.isolate_awareness_history = isolate;
            result.clean_conversation_reply_ids = clean_replies;
        } else {
            result.isolate_awareness_history = true;
        }
    }

    // Readiness is host-owned and false until native-history consent and all
    // derivative consumers are coherent. No-source turns retain the old wire.
    let awareness_write = receipt_authority.as_ref().and_then(|authority| {
        write_optional_awareness_context(app, writer, intent, binding_ref, authority, &mut result)
    });
    let write = if let Some(write) = awareness_write {
        write
    } else {
        if let Some(authority) = receipt_authority.as_ref() {
            // Missing current body does not erase prior warm-native taint. The
            // store's sticky marker decides clean/inherited/unknown semantics.
            let _ = global_dispatch_store(app).ok().and_then(|store| {
                store.lock().ok().and_then(|mut store| {
                    if result.isolate_awareness_history {
                        store
                            .bind_isolated_awareness_turn(
                                authority,
                                intent.session_epoch,
                                binding_ref,
                                None,
                                &[],
                                unix_time_millis() / 1000,
                            )
                            .ok()
                    } else {
                        store
                            .bind_turn_without_awareness_context(
                                authority,
                                intent.session_epoch,
                                binding_ref,
                                unix_time_millis() / 1000,
                            )
                            .ok()
                    }
                })
            });
        }
        write_session_context_frame(writer, intent, &result)
    };
    if write.is_ok()
        && matches!(
            result.status,
            ManagedSessionContextStatusV1::Ready | ManagedSessionContextStatusV1::Degraded
        )
    {
        if let (Some(authority), Some(frozen_relay_scope), Some(snapshot_ref)) = (
            receipt_authority,
            receipt_scope,
            result.snapshot_ref.clone(),
        ) {
            let scope_matches =
                active_scope(&app.state::<AppState>())
                    .ok()
                    .is_some_and(|(owner, relay_scope)| {
                        owner == authority.owner_pubkey
                            && Sha256Ref::parse(relay_scope).ok().as_ref()
                                == Some(&frozen_relay_scope)
                    });
            let status = match result.status {
                ManagedSessionContextStatusV1::Ready => {
                    Some(ManagedTurnSessionContextStatusV1::Ready)
                }
                ManagedSessionContextStatusV1::Degraded => {
                    Some(ManagedTurnSessionContextStatusV1::Degraded)
                }
                _ => None,
            };
            if scope_matches {
                if let Some(status) = status {
                    let _ = global_dispatch_store(app).ok().and_then(|store| {
                        store.lock().ok().and_then(|mut store| {
                            store
                                .record_turn_context_session_delivery(
                                    &authority.owner_pubkey,
                                    frozen_relay_scope,
                                    &authority.trigger_event_id,
                                    &authority.resident_pubkey,
                                    &authority.conversation_id,
                                    intent.session_epoch,
                                    snapshot_ref,
                                    result.revision,
                                    result.selected_source_ids.clone(),
                                    status,
                                    result.attached_session_context.is_some(),
                                )
                                .ok()
                        })
                    });
                }
            }
        }
    }
    write
}

/// Body-free binding paired with ACP's mandatory session/new and owner-only
/// history replay. It must never be used for a warm provider session.
fn bind_exchange_history_isolation(
    store: &mut ManagedDispatchStore,
    intent: &ManagedSessionContextIntentV1,
    binding_ref: &Sha256Ref,
    now: u64,
) -> Result<(), super::managed_dispatch_store::DispatchAuthorizationError> {
    let authority = store.authorize_continuity_turn(
        intent.trigger_event_id.as_str(), intent.resident_pubkey.as_str(),
        intent.conversation_id.as_str(), intent.session_epoch.get(), now,
    )?;
    store.bind_isolated_awareness_turn(
        &authority, intent.session_epoch, binding_ref, None, &[], now,
    )?;
    Ok(())
}

#[cfg(unix)]
fn write_session_context_frame(
    writer: &mut std::os::unix::net::UnixStream,
    intent: &ManagedSessionContextIntentV1,
    result: &ManagedSessionContextResultV1,
) -> std::io::Result<()> {
    let bytes =
        Zeroizing::new(serde_json::to_vec(result).map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "context encoding")
        })?);
    if bytes.len() >= MAX_FRAME_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "context frame exceeds bound",
        ));
    }
    let remaining = intent
        .deadline_unix_ms
        .get()
        .saturating_sub(unix_time_millis())
        .clamp(1, MAX_RESOLUTION_MILLIS);
    writer.set_write_timeout(Some(Duration::from_millis(remaining)))?;
    let write = writer
        .write_all(&bytes)
        .and_then(|_| writer.write_all(b"\n"))
        .and_then(|_| writer.flush());
    let _ = writer.set_write_timeout(None);
    write
}

#[cfg(unix)]
fn write_optional_awareness_context(
    app: &AppHandle,
    writer: &mut std::os::unix::net::UnixStream,
    intent: &ManagedSessionContextIntentV1,
    binding_ref: &Sha256Ref,
    expected: &super::managed_dispatch_store::ContinuityDispatchAuthority,
    result: &mut ManagedSessionContextResultV1,
) -> Option<std::io::Result<()>> {
    use super::companion_awareness::{
        source_runtime::preload_source_facts_before,
        turn_context::{AwarenessTurnScopeV1, PreparedAwarenessTurnContextV1},
        AwarenessHostFactsV1, AwarenessMaterialFactsV1, LiveAwarenessOwner,
    };
    use luca_protocol::{AwarenessMaterialStateV1, CanonicalTimestamp};
    if !super::managed_dispatch_store::ordinary_turn_awareness_consumers_ready()
        || !matches!(
            result.status,
            ManagedSessionContextStatusV1::Empty
                | ManagedSessionContextStatusV1::Ready
                | ManagedSessionContextStatusV1::Degraded
        )
    {
        return None;
    }
    if let Some(attempt) = source_notes::write_optional_source_notes(
        app,
        writer,
        intent,
        binding_ref,
        expected,
        result,
    ) {
        return Some(attempt);
    }
    let state = app.state::<AppState>();
    let now_ms = unix_time_millis();
    let remaining = intent.deadline_unix_ms.get().checked_sub(now_ms)?;
    if remaining < 50 {
        return None;
    }
    let now = CanonicalTimestamp::parse(
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    )
    .ok()?;
    let deadline =
        Instant::now().checked_add(Duration::from_millis(remaining.min(MAX_RESOLUTION_MILLIS)))?;
    let material = preload_source_facts_before(
        &state,
        &expected.owner_pubkey,
        &expected.resident_pubkey,
        &now,
        deadline,
    )
    .ok()?;
    let snapshot = material.snapshot();
    if snapshot.references().is_empty() {
        return None;
    }
    let scope = AwarenessTurnScopeV1 {
        request_id: intent.request_id.clone(),
        authority: expected.clone(),
        binding_ref: binding_ref.clone(),
        session_epoch: intent.session_epoch,
        deadline_unix_ms: intent.deadline_unix_ms.get(),
    };
    let prepared = PreparedAwarenessTurnContextV1::prepare(
        scope.clone(),
        snapshot,
        |reference| material.resolve(reference, false),
        |reference| {
            let key = super::companion_awareness::AwarenessGrantKeyV1 {
                source: super::companion_awareness::AwarenessSourceKeyV1 {
                    owner_pubkey: reference.owner_pubkey.clone(),
                    source_id: reference.source_id.clone(),
                    device_id: reference.device_id.clone(),
                },
                resident_pubkey: reference.resident_pubkey.clone(),
            };
            // Persistent native history is not an ephemeral source sink. Even
            // when future readiness is true, mere observe+egress is insufficient.
            state
                .companion_awareness
                .recheck_native_history_choice(&expected.owner_pubkey, &key, binding_ref)
                .is_ok()
        },
    )
    .ok()??;
    if !super::companion_awareness::conversation::verified_private_conversation(
        &state,
        &expected.owner_pubkey,
        &expected.resident_pubkey,
        &expected.conversation_id,
        deadline,
    ) {
        return None;
    }
    // Reserve before Live/awareness effect locks. Capacity/missing fresh facts
    // omit optional context, never block the owner's ordinary clean message.
    let dispatch = global_dispatch_store(app).ok()?;
    let reply_expires = dispatch
        .lock()
        .ok()?
        .awareness_reply_deadline(expected, intent.session_epoch, unix_time_millis() / 1000)
        .ok()?;
    let reply_lease = state
        .companion_sources
        .reserve_reply_lease(
            prepared.receipt(),
            &prepared.bindings(),
            reply_expires,
            &now,
        )
        .ok()?;
    let live = LiveAwarenessOwner::authenticate(&state).ok()?;
    if live.owner() != &expected.owner_pubkey {
        return None;
    }
    let lease = live.lease().ok()?;
    let mut dispatch = dispatch.lock().ok()?;
    let current_ms = unix_time_millis();
    if current_ms >= intent.deadline_unix_ms.get() || Instant::now() >= deadline {
        return None;
    }
    let current = dispatch
        .authorize_continuity_turn(
            intent.trigger_event_id.as_str(),
            intent.resident_pubkey.as_str(),
            intent.conversation_id.as_str(),
            intent.session_epoch.get(),
            current_ms / 1000,
        )
        .ok()?;
    if &current != expected
        || super::managed_cognition::active_binding_ref(&intent.resident_pubkey)
            .ok()
            .as_ref()
            != Some(binding_ref)
        || super::managed_cognition::active_session_epoch(&intent.resident_pubkey).ok()
            != Some(intent.session_epoch)
    {
        return None;
    }
    let now = CanonicalTimestamp::parse(
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    )
    .ok()?;
    let facts = AwarenessHostFactsV1 {
        owner_pubkey: &expected.owner_pubkey,
        resident_pubkey: &expected.resident_pubkey,
        now: &now,
        source_fresh: false,
        material_state: AwarenessMaterialStateV1::Unavailable,
    };
    let receipt = prepared.receipt();
    let mut attempted = None;
    let _ = state
        .companion_awareness
        .with_native_history_payloads_lease(
            &lease,
            &facts,
            &receipt.observations,
            binding_ref,
            |reference, retained| {
                let current = material.resolve(reference, retained);
                let admitted = prepared.material(reference, retained);
                AwarenessMaterialFactsV1 {
                    source_fresh: current.source_fresh && admitted.source_fresh,
                    material_state: current.material_state,
                }
            },
            &receipt.context_node,
            |payloads| {
                let Ok(context) = prepared.compile(&scope, &now, payloads) else {
                    return;
                };
                // Bind BEFORE the first byte. Partial writes stay conservatively
                // tainted; app expiry does not erase native/provider history.
                if dispatch
                    .bind_leased_awareness_turn(receipt, &reply_lease, unix_time_millis() / 1000)
                    .is_err()
                {
                    return;
                }
                result.isolate_awareness_history = true;
                result.awareness_context = Some(context);
                let encoded = serde_json::to_vec(result);
                if let Ok(encoded) = encoded {
                    let bytes = Zeroizing::new(encoded);
                    let ms = intent
                        .deadline_unix_ms
                        .get()
                        .saturating_sub(unix_time_millis());
                    if bytes.len() >= MAX_FRAME_BYTES || ms == 0 {
                        result.awareness_context = None;
                        return;
                    }
                    attempted = Some(
                        writer
                            .set_write_timeout(Some(Duration::from_millis(
                                ms.min(MAX_RESOLUTION_MILLIS),
                            )))
                            .and_then(|_| writer.write_all(&bytes))
                            .and_then(|_| writer.write_all(b"\n"))
                            .and_then(|_| writer.flush()),
                    );
                    let _ = writer.set_write_timeout(None);
                }
            },
        );
    if attempted.is_none() {
        result.awareness_context = None;
        dispatch.discard_awareness_reply_lease(expected, &reply_lease);
    }
    attempted
}

struct OwnerBrainContextV1 {
    layer: ContinuityLayerMaterial,
    references: Vec<ContinuityWorkingReferenceV1>,
}

fn load_owner_brain_context(
    state: &AppState,
    request: OwnerBrainRetrievalRequestV1,
) -> OwnerBrainContextV1 {
    let status = |status| {
        ContinuityLayerMaterial::status(status, None).unwrap_or_else(|_| {
            ContinuityLayerMaterial::status(ContinuityLayerStatusV1::Invalid, None)
                .expect("fixed invalid owner-brain layer status")
        })
    };
    match state.retrieve_owner_brain(request) {
        Ok(result) if result.status == ContinuityLayerStatusV1::Ready => {
            let mut items = Vec::with_capacity(result.selected.len());
            let mut references = Vec::with_capacity(result.selected.len());
            for chunk in result.selected {
                let body = chunk.body.as_str().to_owned();
                let provenance_refs = vec![chunk.content_hash];
                let item = ContinuityReferenceItem::new(
                    chunk.chunk_id.clone(),
                    body.clone(),
                    provenance_refs.clone(),
                );
                let reference = ContinuityWorkingReferenceV1 {
                    item_id: chunk.chunk_id,
                    body,
                    source_event_ids: Vec::new(),
                    provenance_refs,
                };
                if item.is_err() || reference.validate().is_err() {
                    return OwnerBrainContextV1 {
                        layer: status(ContinuityLayerStatusV1::Invalid),
                        references: Vec::new(),
                    };
                }
                items.push(item.expect("validated owner-brain item"));
                references.push(reference);
            }
            match ContinuityLayerMaterial::ready(items) {
                Ok(layer) => OwnerBrainContextV1 { layer, references },
                Err(_) => OwnerBrainContextV1 {
                    layer: status(ContinuityLayerStatusV1::Invalid),
                    references: Vec::new(),
                },
            }
        }
        Ok(result) => OwnerBrainContextV1 {
            layer: status(result.status),
            references: Vec::new(),
        },
        Err(OwnerBrainStoreError::Locked) => OwnerBrainContextV1 {
            layer: status(ContinuityLayerStatusV1::Locked),
            references: Vec::new(),
        },
        Err(OwnerBrainStoreError::Timeout) => OwnerBrainContextV1 {
            layer: status(ContinuityLayerStatusV1::Timeout),
            references: Vec::new(),
        },
        Err(OwnerBrainStoreError::Stale) => OwnerBrainContextV1 {
            layer: status(ContinuityLayerStatusV1::Stale),
            references: Vec::new(),
        },
        Err(OwnerBrainStoreError::Capacity | OwnerBrainStoreError::Unavailable) => {
            OwnerBrainContextV1 {
                layer: status(ContinuityLayerStatusV1::Unavailable),
                references: Vec::new(),
            }
        }
        Err(OwnerBrainStoreError::Cancelled | OwnerBrainStoreError::Invalid) => {
            OwnerBrainContextV1 {
                layer: status(ContinuityLayerStatusV1::Invalid),
                references: Vec::new(),
            }
        }
    }
}

struct CapsuleContextV1 {
    layer: ContinuityLayerMaterial,
    identity_orientation: Vec<luca_protocol::ContinuityWakeItemV1>,
    relationship_orientation: Vec<luca_protocol::ContinuityWakeItemV1>,
}

/// A capsule layer that carries only its status.
fn capsule_layer_status(status: ContinuityLayerStatusV1) -> ContinuityLayerMaterial {
    ContinuityLayerMaterial::status(status, None).unwrap_or_else(|_| {
        ContinuityLayerMaterial::status(ContinuityLayerStatusV1::Invalid, None)
            .expect("fixed invalid layer status")
    })
}

/// The capsule layer for a resident linked to a Mnemos mind: present, and
/// empty by design.
fn linked_mind_capsule() -> CapsuleContextV1 {
    CapsuleContextV1 {
        layer: capsule_layer_status(ContinuityLayerStatusV1::Empty),
        identity_orientation: Vec::new(),
        relationship_orientation: Vec::new(),
    }
}

fn load_capsule_context(
    state: &AppState,
    expected_owner: &Hex64,
    expected_resident: &Hex64,
    timeout_millis: u64,
) -> CapsuleContextV1 {
    let fallback = capsule_layer_status;
    let handle =
        match crate::managed_agents::managed_capsule_broker_handle(expected_resident.as_str()) {
            Ok(handle)
                if handle.owner_pubkey() == expected_owner
                    && handle.resident_pubkey() == expected_resident =>
            {
                handle
            }
            Ok(_) => {
                return CapsuleContextV1 {
                    layer: fallback(ContinuityLayerStatusV1::Denied),
                    identity_orientation: Vec::new(),
                    relationship_orientation: Vec::new(),
                }
            }
            Err(_) => {
                return CapsuleContextV1 {
                    layer: fallback(ContinuityLayerStatusV1::Unavailable),
                    identity_orientation: Vec::new(),
                    relationship_orientation: Vec::new(),
                }
            }
        };
    let result = tauri::async_runtime::block_on(async {
        tokio::time::timeout(
            Duration::from_millis(timeout_millis),
            load_current_capsule(state, &handle),
        )
        .await
    });
    match result {
        Ok(Ok(super::continuity_capsule::ContinuityCapsuleLoadState::Ready(loaded))) => {
            let orientation = capsule_wake_orientation(&loaded);
            let layer = capsule_context_layer(
                super::continuity_capsule::ContinuityCapsuleLoadState::Ready(loaded),
            );
            match (layer, orientation) {
                (Ok(layer), Ok((identity_orientation, relationship_orientation))) => {
                    CapsuleContextV1 {
                        layer,
                        identity_orientation,
                        relationship_orientation,
                    }
                }
                _ => CapsuleContextV1 {
                    layer: fallback(ContinuityLayerStatusV1::Invalid),
                    identity_orientation: Vec::new(),
                    relationship_orientation: Vec::new(),
                },
            }
        }
        Ok(Ok(state)) => CapsuleContextV1 {
            layer: capsule_context_layer(state)
                .unwrap_or_else(|_| fallback(ContinuityLayerStatusV1::Invalid)),
            identity_orientation: Vec::new(),
            relationship_orientation: Vec::new(),
        },
        Err(_) | Ok(Err(ContinuityCapsuleDesktopError::Timeout)) => CapsuleContextV1 {
            layer: fallback(ContinuityLayerStatusV1::Timeout),
            identity_orientation: Vec::new(),
            relationship_orientation: Vec::new(),
        },
        Ok(Err(ContinuityCapsuleDesktopError::OwnerLocked)) => CapsuleContextV1 {
            layer: fallback(ContinuityLayerStatusV1::Locked),
            identity_orientation: Vec::new(),
            relationship_orientation: Vec::new(),
        },
        Ok(Err(ContinuityCapsuleDesktopError::WrongOwner)) => CapsuleContextV1 {
            layer: fallback(ContinuityLayerStatusV1::Denied),
            identity_orientation: Vec::new(),
            relationship_orientation: Vec::new(),
        },
        Ok(Err(ContinuityCapsuleDesktopError::StaleBinding)) => CapsuleContextV1 {
            layer: fallback(ContinuityLayerStatusV1::Stale),
            identity_orientation: Vec::new(),
            relationship_orientation: Vec::new(),
        },
        Ok(Err(
            ContinuityCapsuleDesktopError::RelayUnavailable
            | ContinuityCapsuleDesktopError::BrokerBusy
            | ContinuityCapsuleDesktopError::BrokerUnavailable,
        )) => CapsuleContextV1 {
            layer: fallback(ContinuityLayerStatusV1::Unavailable),
            identity_orientation: Vec::new(),
            relationship_orientation: Vec::new(),
        },
        Ok(Err(_)) => CapsuleContextV1 {
            layer: fallback(ContinuityLayerStatusV1::Invalid),
            identity_orientation: Vec::new(),
            relationship_orientation: Vec::new(),
        },
    }
}

#[cfg(unix)]
#[allow(clippy::too_many_arguments)]
fn write_authorized_packet(
    dispatch_store: &Arc<Mutex<ManagedDispatchStore>>,
    writer: &mut std::os::unix::net::UnixStream,
    wire: &[u8],
    trigger_event_id: &Hex64,
    resident_pubkey: &Hex64,
    conversation_id: &OpaqueId,
    session_epoch: SafeU53,
    deadline_unix_ms: u64,
) -> std::io::Result<AuthorizedPacketWrite> {
    if wire.len() >= MAX_FRAME_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "managed continuity frame exceeds bound",
        ));
    }
    let now_unix_ms = unix_time_millis();
    if now_unix_ms >= deadline_unix_ms {
        return Ok(AuthorizedPacketWrite::Denied);
    }
    let store = match dispatch_store.lock() {
        Ok(store) => store,
        Err(_) => return Ok(AuthorizedPacketWrite::Denied),
    };
    if store
        .authorize_continuity_turn(
            trigger_event_id.as_str(),
            resident_pubkey.as_str(),
            conversation_id.as_str(),
            session_epoch.get(),
            now_unix_ms / 1_000,
        )
        .is_err()
    {
        return Ok(AuthorizedPacketWrite::Denied);
    }

    let remaining = deadline_unix_ms
        .saturating_sub(now_unix_ms)
        .clamp(1, MAX_RESOLUTION_MILLIS);
    writer.set_write_timeout(Some(Duration::from_millis(remaining)))?;
    let result = writer
        .write_all(wire)
        .and_then(|_| writer.write_all(b"\n"))
        .and_then(|_| writer.flush());
    let _ = writer.set_write_timeout(None);
    result.map(|_| AuthorizedPacketWrite::Written)
}

fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn fallback_result(
    intent: &ManagedContinuityTurnIntentV1,
    status: ContinuityLayerStatusV1,
) -> Option<ContinuityContextResultV1> {
    let statuses = [
        ContinuityLayerStatusV1::Empty,
        status,
        status,
        status,
        ContinuityLayerStatusV1::Denied,
    ];
    let layers = LAYERS
        .iter()
        .zip(statuses)
        .map(|(layer, status)| {
            Some(ContinuityLayerResultV1 {
                layer: OpaqueId::parse(*layer).ok()?,
                status,
                provenance_ref: None,
                diagnostic: None,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let digest = canonical_sha256(&serde_json::json!({
        "domain": "luca.managed.continuity-fallback.v1",
        "request_id": intent.request_id,
        "resident_pubkey": intent.resident_pubkey,
        "statuses": statuses,
    }))
    .ok()?;
    let result = ContinuityContextResultV1 {
        protocol: CONTINUITY_PROTOCOL.into(),
        request_id: intent.request_id.clone(),
        resident_pubkey: intent.resident_pubkey.clone(),
        layers,
        packet: None,
        receipt_ref: Sha256Ref::parse(format!("sha256:{digest}")).ok()?,
        diagnostics: Vec::new(),
    };
    result.validate().ok().map(|_| result)
}

fn write_fallback(
    writer: &mut impl Write,
    intent: &ManagedContinuityTurnIntentV1,
    status: ContinuityLayerStatusV1,
) -> std::io::Result<()> {
    let result = fallback_result(intent, status)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "fallback result"))?;
    let bytes = canonicalize(&result)
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "fallback encoding"))?;
    writer.write_all(&bytes)?;
    writer.write_all(b"\n")?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use std::io::Read as _;

    use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};

    use super::*;

    struct ActiveDispatchFixture {
        _temp: tempfile::TempDir,
        store: Arc<Mutex<ManagedDispatchStore>>,
        owner_pubkey: String,
        resident_pubkey: Hex64,
        conversation_id: OpaqueId,
        trigger_event_id: Hex64,
        session_epoch: SafeU53,
    }

    fn active_dispatch() -> ActiveDispatchFixture {
        let owner = Keys::parse(&"51".repeat(32)).unwrap();
        let resident = Keys::parse(&"52".repeat(32)).unwrap();
        let conversation_id = "11111111-1111-4111-8111-111111111111";
        let now = unix_time_millis() / 1_000;
        let event = EventBuilder::new(Kind::Custom(9), "owner prompt")
            .tags(vec![
                Tag::parse(["h", conversation_id]).unwrap(),
                Tag::public_key(owner.public_key()),
                Tag::public_key(resident.public_key()),
            ])
            .custom_created_at(Timestamp::from(now))
            .sign_with_keys(&owner)
            .unwrap();
        let temp = tempfile::tempdir().unwrap();
        let mut store = ManagedDispatchStore::load(temp.path().join("dispatches.json")).unwrap();
        store
            .stage_owner_event(&event, &[resident.public_key().to_hex()], now)
            .unwrap();
        let session_epoch = SafeU53::new(9).unwrap();
        store
            .activate_session(&resident.public_key().to_hex(), session_epoch.get())
            .unwrap();
        ActiveDispatchFixture {
            _temp: temp,
            store: Arc::new(Mutex::new(store)),
            owner_pubkey: owner.public_key().to_hex(),
            resident_pubkey: Hex64::parse(resident.public_key().to_hex()).unwrap(),
            conversation_id: OpaqueId::parse(conversation_id).unwrap(),
            trigger_event_id: Hex64::parse(event.id.to_hex()).unwrap(),
            session_epoch,
        }
    }

    fn intent() -> ManagedContinuityTurnIntentV1 {
        ManagedContinuityTurnIntentV1 {
            protocol: INTENT_PROTOCOL.into(),
            request_id: OpaqueId::parse("request-1").unwrap(),
            resident_pubkey: Hex64::parse("22".repeat(32)).unwrap(),
            session_epoch: SafeU53::new(4).unwrap(),
            turn_id: OpaqueId::parse("turn-1").unwrap(),
            conversation_id: OpaqueId::parse("conversation-1").unwrap(),
            trigger_event_id: Hex64::parse("33".repeat(32)).unwrap(),
            history_event_ids: vec![Hex64::parse("44".repeat(32)).unwrap()],
            retrieval_cue: "private continuity cue".into(),
            deadline_unix_ms: SafeU53::new(10_000).unwrap(),
            max_packet_bytes: SafeU53::new(MAX_CONTINUITY_PACKET_BYTES as u64).unwrap(),
        }
    }

    #[test]
    fn exchange_isolation_binds_only_the_exact_active_turn() {
        use super::super::managed_dispatch_store::ManagedTurnAwarenessLookupV1;
        let fixture = active_dispatch();
        let now = unix_time_millis() / 1_000;
        let binding = Sha256Ref::parse(format!("sha256:{}", "ab".repeat(32))).unwrap();
        let mut store = fixture.store.lock().unwrap();
        let authority = store.authorize_continuity_turn(
            fixture.trigger_event_id.as_str(), fixture.resident_pubkey.as_str(),
            fixture.conversation_id.as_str(), fixture.session_epoch.get(), now,
        ).unwrap();
        // Persist an awareness-tainted scope from an earlier ordinary turn.
        let observation = luca_protocol::AwarenessObservationRefV1 {
            protocol: luca_protocol::AWARENESS_PROTOCOL.into(),
            observation_id: OpaqueId::parse("observation").unwrap(),
            owner_pubkey: authority.owner_pubkey.clone(),
            resident_pubkey: fixture.resident_pubkey.clone(),
            source_id: OpaqueId::parse("source").unwrap(),
            device_id: OpaqueId::parse("device").unwrap(),
            grant_id: OpaqueId::parse("grant").unwrap(),
            grant_revision: SafeU53::new(1).unwrap(),
            deny_epoch: SafeU53::new(0).unwrap(),
            sequence: SafeU53::new(1).unwrap(),
            evidence_ref: binding.clone(),
            captured_at: luca_protocol::CanonicalTimestamp::parse("2026-11-04T00:00:00Z").unwrap(),
            expires_at: luca_protocol::CanonicalTimestamp::parse("2026-11-04T00:05:00Z").unwrap(),
        };
        store.bind_turn_awareness_context(&authority, fixture.session_epoch, &binding,
            &OpaqueId::parse("old-private-context").unwrap(), &[observation], now).unwrap();
        let sibling = Keys::generate();
        let trigger = EventBuilder::new(Kind::Custom(9), "hello")
            .tags([
                Tag::parse(["h", fixture.conversation_id.as_str()]).unwrap(),
                Tag::parse(["p", fixture.resident_pubkey.as_str()]).unwrap(),
            ])
            .custom_created_at(Timestamp::from(now)).sign_with_keys(&sibling).unwrap();
        store.stage_wake_from_trigger(&trigger, fixture.resident_pubkey.as_str(),
            &fixture.owner_pubkey, now).unwrap();
        let mut intent = ManagedSessionContextIntentV1 {
            protocol: SESSION_CONTEXT_INTENT_PROTOCOL.into(),
            request_id: OpaqueId::parse("exchange-isolation").unwrap(),
            resident_pubkey: fixture.resident_pubkey.clone(),
            conversation_id: fixture.conversation_id.clone(),
            session_epoch: fixture.session_epoch,
            trigger_event_id: Hex64::parse(trigger.id.to_hex()).unwrap(),
            deadline_unix_ms: SafeU53::new(unix_time_millis() + 1000).unwrap(),
            quickchat_report: None,
            isolate_exchange_history: true,
        };
        let owner = Hex64::parse(fixture.owner_pubkey.clone()).unwrap();
        assert!(store.conversation_has_awareness_history(&owner, &fixture.resident_pubkey, &fixture.conversation_id));
        assert_eq!(store.turn_awareness_context(&owner, &intent.resident_pubkey,
            &intent.conversation_id, &intent.trigger_event_id), ManagedTurnAwarenessLookupV1::Unknown);
        intent.session_epoch = SafeU53::new(999).unwrap();
        assert!(bind_exchange_history_isolation(&mut store, &intent, &binding, now).is_err());
        intent.session_epoch = fixture.session_epoch;
        intent.resident_pubkey = Hex64::parse(sibling.public_key().to_hex()).unwrap();
        assert!(bind_exchange_history_isolation(&mut store, &intent, &binding, now).is_err());
        intent.resident_pubkey = fixture.resident_pubkey.clone();
        intent.conversation_id = OpaqueId::parse("wrong-room").unwrap();
        assert!(bind_exchange_history_isolation(&mut store, &intent, &binding, now).is_err());
        intent.conversation_id = fixture.conversation_id.clone();
        bind_exchange_history_isolation(&mut store, &intent, &binding, now).unwrap();
        assert_eq!(store.turn_awareness_context(&owner, &intent.resident_pubkey,
            &intent.conversation_id, &intent.trigger_event_id), ManagedTurnAwarenessLookupV1::Untainted);
        // This turn's isolation cannot launder the earlier warm history.
        assert!(store.conversation_has_awareness_history(&owner, &fixture.resident_pubkey, &fixture.conversation_id));
        assert!(matches!(store.turn_awareness_context(&owner, &fixture.resident_pubkey,
            &fixture.conversation_id, &fixture.trigger_event_id), ManagedTurnAwarenessLookupV1::Bound(_)));
        store.cancel_exact(&fixture.owner_pubkey, intent.conversation_id.as_str(),
            intent.resident_pubkey.as_str(), intent.trigger_event_id.as_str(), intent.session_epoch.get()).unwrap();
        assert!(bind_exchange_history_isolation(&mut store, &intent, &binding, now).is_err());
    }

    #[test]
    fn intent_envelope_accepts_the_full_session_context_wire_shape() {
        let wire = serde_json::json!({
            "protocol": SESSION_CONTEXT_INTENT_PROTOCOL,
            "request_id": "request-1",
            "resident_pubkey": "22".repeat(32),
            "session_epoch": 4,
            "conversation_id": "conversation-1",
            "trigger_event_id": "33".repeat(32),
            "deadline_unix_ms": 10_000,
        });

        let envelope: IntentEnvelopeV1 = serde_json::from_value(wire).unwrap();
        assert_eq!(envelope.protocol, SESSION_CONTEXT_INTENT_PROTOCOL);
    }

    #[test]
    fn intent_is_bounded_and_debug_redacts_cue() {
        let mut value = intent();
        assert!(value.validate());
        let debug = format!("{value:?}");
        assert!(!debug.contains("private continuity cue"));
        assert!(debug.contains("retrieval_cue_bytes"));

        value.retrieval_cue = "x".repeat(MAX_CUE_BYTES + 1);
        assert!(!value.validate());
    }

    #[test]
    fn fallback_is_body_free_and_protocol_valid() {
        let value = intent();
        let result = fallback_result(&value, ContinuityLayerStatusV1::Unavailable).unwrap();
        result.validate().unwrap();
        let wire = canonicalize(&result).unwrap();
        assert!(!String::from_utf8(wire)
            .unwrap()
            .contains("private continuity cue"));
        assert!(result.packet.is_none());
        assert_eq!(result.layers[0].status, ContinuityLayerStatusV1::Empty);
        assert_eq!(result.layers[4].status, ContinuityLayerStatusV1::Denied);
    }

    #[test]
    fn wake_delivery_has_no_native_runtime_configuration_write_path() {
        let source = include_str!("managed_continuity.rs");
        for forbidden in [
            ["config", ".toml"].concat(),
            ["CLAUDE", ".md"].concat(),
            ["AGENTS", ".md"].concat(),
            ["settings", ".json"].concat(),
            ["write_native", "_runtime"].concat(),
        ] {
            assert!(
                !source.contains(&forbidden),
                "native config path: {forbidden}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn terminal_recheck_prevents_packet_delivery_after_cancellation() {
        let fixture = active_dispatch();
        fixture
            .store
            .lock()
            .unwrap()
            .cancel_exact(
                &fixture.owner_pubkey,
                fixture.conversation_id.as_str(),
                fixture.resident_pubkey.as_str(),
                fixture.trigger_event_id.as_str(),
                fixture.session_epoch.get(),
            )
            .unwrap();
        let (mut writer, mut peer) = std::os::unix::net::UnixStream::pair().unwrap();
        peer.set_nonblocking(true).unwrap();
        let outcome = write_authorized_packet(
            &fixture.store,
            &mut writer,
            b"private packet body",
            &fixture.trigger_event_id,
            &fixture.resident_pubkey,
            &fixture.conversation_id,
            fixture.session_epoch,
            unix_time_millis() + 1_000,
        )
        .unwrap();
        assert_eq!(outcome, AuthorizedPacketWrite::Denied);
        let mut bytes = [0_u8; 32];
        assert_eq!(
            peer.read(&mut bytes).unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }

    #[cfg(unix)]
    #[test]
    fn same_trigger_can_be_retried_by_a_new_turn() {
        let fixture = active_dispatch();
        let (mut writer, mut peer) = std::os::unix::net::UnixStream::pair().unwrap();
        peer.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
        for expected in [b"first".as_slice(), b"second".as_slice()] {
            assert_eq!(
                write_authorized_packet(
                    &fixture.store,
                    &mut writer,
                    expected,
                    &fixture.trigger_event_id,
                    &fixture.resident_pubkey,
                    &fixture.conversation_id,
                    fixture.session_epoch,
                    unix_time_millis() + 1_000,
                )
                .unwrap(),
                AuthorizedPacketWrite::Written
            );
            let mut received = vec![0_u8; expected.len() + 1];
            peer.read_exact(&mut received).unwrap();
            assert_eq!(&received[..expected.len()], expected);
            assert_eq!(received.last(), Some(&b'\n'));
        }
    }

    #[cfg(unix)]
    #[test]
    fn non_reading_peer_cannot_hold_the_dispatch_lock_past_deadline() {
        use std::os::fd::AsRawFd;

        let fixture = active_dispatch();
        let (mut writer, _peer) = std::os::unix::net::UnixStream::pair().unwrap();
        let send_buffer: libc::c_int = 1_024;
        let result = unsafe {
            libc::setsockopt(
                writer.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_SNDBUF,
                (&send_buffer as *const libc::c_int).cast(),
                std::mem::size_of_val(&send_buffer) as libc::socklen_t,
            )
        };
        assert_eq!(result, 0);
        let wire = vec![b'x'; MAX_FRAME_BYTES - 1];
        let started = Instant::now();
        assert!(write_authorized_packet(
            &fixture.store,
            &mut writer,
            &wire,
            &fixture.trigger_event_id,
            &fixture.resident_pubkey,
            &fixture.conversation_id,
            fixture.session_epoch,
            unix_time_millis() + 30,
        )
        .is_err());
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(fixture.store.try_lock().is_ok());
    }
}
