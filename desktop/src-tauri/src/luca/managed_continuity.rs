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
    ContinuityLayerResultV1, ContinuityLayerStatusV1, Hex64, OpaqueId, ProviderEgressV1, SafeU53,
    Sha256Ref, CONTINUITY_PROTOCOL, MAX_CONTINUITY_PACKET_BYTES, MAX_CONTINUITY_REFS,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

use crate::app_state::AppState;

use super::{
    continuity_capsule::{capsule_context_layer, ContinuityCapsuleDesktopError},
    continuity_capsule_relay::load_current_capsule,
    continuity_context::{resident_notebook_address, resolve_desktop_continuity_context},
    managed_dispatch_store::{global_dispatch_store, ManagedDispatchStore},
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
#[serde(deny_unknown_fields)]
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
            if write_session_context_result(&app, &mut writer, &intent).is_err() {
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
        let owner_brain = load_owner_brain_context_layer(
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
        let capsule = load_capsule_context_layer(
            &state,
            &request.owner_pubkey,
            &request.resident_pubkey,
            remaining.clamp(1, MAX_CAPSULE_LOAD_MILLIS),
        );
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
            capsule,
            owner_brain,
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
            Some(Ok(AuthorizedPacketWrite::Written)) => {}
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
    };
    let now_unix_ms = unix_time_millis();
    let result = if now_unix_ms >= intent.deadline_unix_ms.get() {
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
            Some(authority) => match authority.context_binding {
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
                                        revision: SafeU53::new(resolved.revision).unwrap_or_else(
                                            |_| SafeU53::new(0).expect("zero safe sentinel"),
                                        ),
                                        cwd,
                                        additional_directories,
                                        selected_source_ids: resolved.selected_source_ids,
                                        native_roots_ref: Some(resolved.native_roots_ref),
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
            },
        }
    };
    let bytes = serde_json::to_vec(&result)
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "context encoding"))?;
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

fn load_owner_brain_context_layer(
    state: &AppState,
    request: OwnerBrainRetrievalRequestV1,
) -> ContinuityLayerMaterial {
    let status = |status| {
        ContinuityLayerMaterial::status(status, None).unwrap_or_else(|_| {
            ContinuityLayerMaterial::status(ContinuityLayerStatusV1::Invalid, None)
                .expect("fixed invalid owner-brain layer status")
        })
    };
    match state.retrieve_owner_brain(request) {
        Ok(result) if result.status == ContinuityLayerStatusV1::Ready => {
            let items = result
                .selected
                .into_iter()
                .map(|chunk| {
                    ContinuityReferenceItem::new(
                        chunk.chunk_id,
                        chunk.body.as_str().to_owned(),
                        vec![chunk.content_hash],
                    )
                })
                .collect::<Result<Vec<_>, _>>();
            match items.and_then(ContinuityLayerMaterial::ready) {
                Ok(material) => material,
                Err(_) => status(ContinuityLayerStatusV1::Invalid),
            }
        }
        Ok(result) => status(result.status),
        Err(OwnerBrainStoreError::Locked) => status(ContinuityLayerStatusV1::Locked),
        Err(OwnerBrainStoreError::Timeout) => status(ContinuityLayerStatusV1::Timeout),
        Err(OwnerBrainStoreError::Stale) => status(ContinuityLayerStatusV1::Stale),
        Err(OwnerBrainStoreError::Unavailable) => status(ContinuityLayerStatusV1::Unavailable),
        Err(OwnerBrainStoreError::Cancelled | OwnerBrainStoreError::Invalid) => {
            status(ContinuityLayerStatusV1::Invalid)
        }
    }
}

fn load_capsule_context_layer(
    state: &AppState,
    expected_owner: &Hex64,
    expected_resident: &Hex64,
    timeout_millis: u64,
) -> ContinuityLayerMaterial {
    let fallback = |status| {
        ContinuityLayerMaterial::status(status, None).unwrap_or_else(|_| {
            ContinuityLayerMaterial::status(ContinuityLayerStatusV1::Invalid, None)
                .expect("fixed invalid layer status")
        })
    };
    let handle =
        match crate::managed_agents::managed_capsule_broker_handle(expected_resident.as_str()) {
            Ok(handle)
                if handle.owner_pubkey() == expected_owner
                    && handle.resident_pubkey() == expected_resident =>
            {
                handle
            }
            Ok(_) => return fallback(ContinuityLayerStatusV1::Denied),
            Err(_) => return fallback(ContinuityLayerStatusV1::Unavailable),
        };
    let result = tauri::async_runtime::block_on(async {
        tokio::time::timeout(
            Duration::from_millis(timeout_millis),
            load_current_capsule(state, &handle),
        )
        .await
    });
    match result {
        Ok(Ok(state)) => capsule_context_layer(state)
            .unwrap_or_else(|_| fallback(ContinuityLayerStatusV1::Invalid)),
        Err(_) | Ok(Err(ContinuityCapsuleDesktopError::Timeout)) => {
            fallback(ContinuityLayerStatusV1::Timeout)
        }
        Ok(Err(ContinuityCapsuleDesktopError::OwnerLocked)) => {
            fallback(ContinuityLayerStatusV1::Locked)
        }
        Ok(Err(ContinuityCapsuleDesktopError::WrongOwner)) => {
            fallback(ContinuityLayerStatusV1::Denied)
        }
        Ok(Err(ContinuityCapsuleDesktopError::StaleBinding)) => {
            fallback(ContinuityLayerStatusV1::Stale)
        }
        Ok(Err(
            ContinuityCapsuleDesktopError::RelayUnavailable
            | ContinuityCapsuleDesktopError::BrokerBusy
            | ContinuityCapsuleDesktopError::BrokerUnavailable,
        )) => fallback(ContinuityLayerStatusV1::Unavailable),
        Ok(Err(_)) => fallback(ContinuityLayerStatusV1::Invalid),
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
