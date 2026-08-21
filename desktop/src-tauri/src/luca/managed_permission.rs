//! Desktop-owned, local-only approval transport for managed ACP permissions.

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    sync::{mpsc, Mutex, OnceLock},
    time::Duration,
};

use luca_protocol::{
    CapabilityKind, CapabilityRisk, ManagedPermissionDecisionV1, ManagedPermissionDispositionV1,
    ManagedPermissionRequestV1, ManagedPermissionRequestV2, ResidentAccessLevel,
    MANAGED_PERMISSION_PROTOCOL, MANAGED_PERMISSION_TIMEOUT_SECS,
};
use tauri::{AppHandle, Emitter};

const PENDING_EVENT: &str = "managed-permission-pending";
const RESOLVED_EVENT: &str = "managed-permission-resolved";

struct Pending {
    request: ManagedPermissionRequestV1,
    decision_tx: mpsc::Sender<ResolvedManagedPermission>,
}

struct PendingCapability {
    owner_pubkey: String,
    request: ManagedPermissionRequestV2,
    decision_tx: mpsc::Sender<CapabilityPermissionDecision>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CapabilityPermissionDecision {
    AllowOnce,
    AlwaysAllow,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ManagedPermissionResolutionOutcome {
    Approved,
    Rejected,
    Cancelled,
    Expired,
    SessionReplaced,
    ApplicationClosed,
}

#[derive(Debug, Clone)]
struct ResolvedManagedPermission {
    decision: ManagedPermissionDecisionV1,
    outcome: ManagedPermissionResolutionOutcome,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedPermissionResolvedEvent {
    pending_id: String,
    outcome: ManagedPermissionResolutionOutcome,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingManagedPermission {
    pub pending_id: String,
    pub request: PendingManagedPermissionRequest,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(untagged)]
pub(crate) enum PendingManagedPermissionRequest {
    Runtime(ManagedPermissionRequestV1),
    Capability(ManagedPermissionRequestV2),
}

static PENDING: OnceLock<Mutex<HashMap<String, Pending>>> = OnceLock::new();
static CAPABILITY_PENDING: OnceLock<Mutex<HashMap<String, PendingCapability>>> = OnceLock::new();

fn pending() -> &'static Mutex<HashMap<String, Pending>> {
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn capability_pending() -> &'static Mutex<HashMap<String, PendingCapability>> {
    CAPABILITY_PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn pending_id(request: &ManagedPermissionRequestV1) -> String {
    luca_protocol::canonical_sha256(request).unwrap_or_else(|_| uuid::Uuid::new_v4().to_string())
}

fn cancelled(request: &ManagedPermissionRequestV1) -> ManagedPermissionDecisionV1 {
    ManagedPermissionDecisionV1 {
        protocol: MANAGED_PERMISSION_PROTOCOL.into(),
        resident_pubkey: request.resident_pubkey.clone(),
        session_epoch: request.session_epoch,
        turn_id: request.turn_id.clone(),
        conversation_id: request.conversation_id.clone(),
        acp_request_id: request.acp_request_id.clone(),
        disposition: ManagedPermissionDispositionV1::Cancelled,
        option_id: None,
    }
}

fn cancelled_resolution(
    request: &ManagedPermissionRequestV1,
    outcome: ManagedPermissionResolutionOutcome,
) -> ResolvedManagedPermission {
    ResolvedManagedPermission {
        decision: cancelled(request),
        outcome,
    }
}

fn selected_outcome(
    request: &ManagedPermissionRequestV1,
    option_id: &str,
) -> ManagedPermissionResolutionOutcome {
    // The option ID remains the only protocol decision. This classification
    // reads the runtime-advertised semantic kind solely for local presentation
    // and never infers authority from its display label.
    if request.options.iter().any(|option| {
        option.option_id == option_id && option.kind.to_ascii_lowercase().starts_with("reject")
    }) {
        ManagedPermissionResolutionOutcome::Rejected
    } else {
        ManagedPermissionResolutionOutcome::Approved
    }
}

/// Child-side descriptor for the anonymous local permission socket.
#[cfg(unix)]
pub(crate) struct ManagedPermissionChildFd(std::os::fd::OwnedFd);

#[cfg(unix)]
impl ManagedPermissionChildFd {
    pub(crate) fn raw_fd(&self) -> std::os::fd::RawFd {
        use std::os::fd::AsRawFd;
        self.0.as_raw_fd()
    }
}

/// Create a per-resident local socket and start its desktop-owned blocking server.
#[cfg(unix)]
pub(crate) fn create_endpoint(
    app: AppHandle,
    resident_pubkey: luca_protocol::Hex64,
    session_epoch: luca_protocol::SafeU53,
) -> Result<ManagedPermissionChildFd, String> {
    use std::os::fd::{FromRawFd, IntoRawFd};
    let (desktop, child) = std::os::unix::net::UnixStream::pair()
        .map_err(|error| format!("create managed permission socketpair: {error}"))?;
    std::thread::Builder::new()
        .name("luca-managed-permission".into())
        .spawn(move || serve(app, desktop, resident_pubkey, session_epoch))
        .map_err(|error| format!("start managed permission server: {error}"))?;
    // The raw fd is immediately re-owned, avoiding a path/token/env secret.
    let owned = unsafe { std::os::fd::OwnedFd::from_raw_fd(child.into_raw_fd()) };
    Ok(ManagedPermissionChildFd(owned))
}

#[cfg(unix)]
fn serve(
    app: AppHandle,
    stream: std::os::unix::net::UnixStream,
    resident_pubkey: luca_protocol::Hex64,
    session_epoch: luca_protocol::SafeU53,
) {
    let writer = match stream.try_clone() {
        Ok(writer) => writer,
        Err(_) => return,
    };
    let mut reader = BufReader::new(stream);
    loop {
        let mut line = String::new();
        let Ok(read) = reader.read_line(&mut line) else {
            break;
        };
        if read == 0 || line.len() > 64 * 1024 {
            break;
        }
        let Ok(request) = serde_json::from_str::<ManagedPermissionRequestV1>(&line) else {
            break;
        };
        if request.validate().is_err()
            || request.resident_pubkey != resident_pubkey
            || request.session_epoch != session_epoch
        {
            break;
        }
        let decision = await_local_decision(&app, request.clone());
        let Ok(bytes) = serde_json::to_vec(&decision) else {
            break;
        };
        let mut writer = &writer;
        if writer
            .write_all(&bytes)
            .and_then(|_| writer.write_all(b"\n"))
            .and_then(|_| writer.flush())
            .is_err()
        {
            break;
        }
    }
}

/// Present one desktop-owned permission request through the existing local UI.
/// The caller supplies only display-safe metadata and receives one exact,
/// request-bound decision; no capability or payload enters the event.
pub(crate) fn await_local_decision(
    app: &AppHandle,
    request: ManagedPermissionRequestV1,
) -> ManagedPermissionDecisionV1 {
    if request.validate().is_err() {
        return cancelled(&request);
    }
    let id = pending_id(&request);
    let (tx, rx) = mpsc::channel();
    let inserted = pending().lock().ok().and_then(|mut entries| {
        if entries.contains_key(&id) {
            None
        } else {
            entries.insert(
                id.clone(),
                Pending {
                    request: request.clone(),
                    decision_tx: tx,
                },
            );
            Some(())
        }
    });
    let decision = if inserted.is_some() {
        let _ = app.emit(
            PENDING_EVENT,
            PendingManagedPermission {
                pending_id: id.clone(),
                request: PendingManagedPermissionRequest::Runtime(request.clone()),
            },
        );
        match rx.recv_timeout(Duration::from_secs(MANAGED_PERMISSION_TIMEOUT_SECS)) {
            Ok(resolution) => resolution,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                cancelled_resolution(&request, ManagedPermissionResolutionOutcome::Expired)
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                cancelled_resolution(&request, ManagedPermissionResolutionOutcome::Cancelled)
            }
        }
    } else {
        cancelled_resolution(&request, ManagedPermissionResolutionOutcome::Cancelled)
    };
    if let Ok(mut entries) = pending().lock() {
        entries.remove(&id);
    }
    let _ = app.emit(
        RESOLVED_EVENT,
        ManagedPermissionResolvedEvent {
            pending_id: id,
            outcome: decision.outcome,
        },
    );
    decision.decision
}

pub(crate) fn list_pending() -> Result<Vec<PendingManagedPermission>, String> {
    let entries = pending()
        .lock()
        .map_err(|_| "managed permission registry unavailable".to_string())?;
    let mut result = entries
        .iter()
        .map(|(id, pending)| PendingManagedPermission {
            pending_id: id.clone(),
            request: PendingManagedPermissionRequest::Runtime(pending.request.clone()),
        })
        .collect::<Vec<_>>();
    drop(entries);
    let capability_entries = capability_pending()
        .lock()
        .map_err(|_| "capability permission registry unavailable".to_string())?;
    result.extend(
        capability_entries
            .iter()
            .map(|(id, pending)| PendingManagedPermission {
                pending_id: id.clone(),
                request: PendingManagedPermissionRequest::Capability(pending.request.clone()),
            }),
    );
    Ok(result)
}

pub(crate) fn resolve(pending_id: &str, option_id: Option<String>) -> Result<(), String> {
    let mut entries = pending()
        .lock()
        .map_err(|_| "managed permission registry unavailable".to_string())?;
    let pending = entries.get(pending_id).ok_or_else(|| {
        "managed permission request is unknown, expired, or already resolved".to_string()
    })?;
    let outcome = option_id
        .as_deref()
        .map_or(ManagedPermissionResolutionOutcome::Cancelled, |option_id| {
            selected_outcome(&pending.request, option_id)
        });
    let decision = ManagedPermissionDecisionV1 {
        protocol: MANAGED_PERMISSION_PROTOCOL.into(),
        resident_pubkey: pending.request.resident_pubkey.clone(),
        session_epoch: pending.request.session_epoch,
        turn_id: pending.request.turn_id.clone(),
        conversation_id: pending.request.conversation_id.clone(),
        acp_request_id: pending.request.acp_request_id.clone(),
        disposition: if option_id.is_some() {
            ManagedPermissionDispositionV1::Selected
        } else {
            ManagedPermissionDispositionV1::Cancelled
        },
        option_id,
    };
    decision
        .validate_for(&pending.request)
        .map_err(|error| error.to_string())?;
    let pending = entries
        .remove(pending_id)
        .ok_or_else(|| "managed permission request disappeared".to_string())?;
    pending
        .decision_tx
        .send(ResolvedManagedPermission { decision, outcome })
        .map_err(|_| "managed permission request is no longer waiting".to_string())
}

pub(crate) fn resolve_with_app(
    app: &AppHandle,
    pending_id: &str,
    option_id: Option<String>,
) -> Result<(), String> {
    if pending()
        .lock()
        .map_err(|_| "managed permission registry unavailable".to_string())?
        .contains_key(pending_id)
    {
        return resolve(pending_id, option_id);
    }
    let mut entries = capability_pending()
        .lock()
        .map_err(|_| "capability permission registry unavailable".to_string())?;
    let pending = entries.remove(pending_id).ok_or_else(|| {
        "managed permission request is unknown, expired, or already resolved".to_string()
    })?;
    let decision = match option_id.as_deref() {
        Some("allow_once") => CapabilityPermissionDecision::AllowOnce,
        Some("always_allow") => {
            super::resident_capability_authority::grant(
                app,
                &pending.owner_pubkey,
                pending.request.resident_pubkey.as_str(),
                pending.request.capability,
                pending.request.resource.clone(),
            )?;
            CapabilityPermissionDecision::AlwaysAllow
        }
        None | Some("deny") => CapabilityPermissionDecision::Deny,
        Some(_) => return Err("capability permission decision is invalid".into()),
    };
    let outcome = if decision == CapabilityPermissionDecision::Deny {
        ManagedPermissionResolutionOutcome::Rejected
    } else {
        ManagedPermissionResolutionOutcome::Approved
    };
    pending
        .decision_tx
        .send(decision)
        .map_err(|_| "capability permission request is no longer waiting".to_string())?;
    let _ = app.emit(
        RESOLVED_EVENT,
        ManagedPermissionResolvedEvent {
            pending_id: pending_id.to_owned(),
            outcome,
        },
    );
    Ok(())
}

fn full_access_must_confirm(capability: CapabilityKind, risk: CapabilityRisk) -> bool {
    risk == CapabilityRisk::HighImpact
        || matches!(
            capability,
            CapabilityKind::ExternalCommunication
                | CapabilityKind::DestructiveAction
                | CapabilityKind::CredentialUse
        )
}

/// Resolve one structured operator permission against resident access policy,
/// an exact durable grant, or the existing inline conversation UI.
pub(crate) fn await_capability_decision(
    app: &AppHandle,
    owner_pubkey: &str,
    request: ManagedPermissionRequestV2,
) -> CapabilityPermissionDecision {
    if request.validate().is_err() {
        return CapabilityPermissionDecision::Deny;
    }
    let level = super::resident_capability_authority::effective_access(
        app,
        owner_pubkey,
        request.resident_pubkey.as_str(),
    )
    .unwrap_or(ResidentAccessLevel::Restricted);
    if super::resident_capability_authority::is_granted(
        app,
        owner_pubkey,
        request.resident_pubkey.as_str(),
        request.capability,
        &request.resource.kind,
        &request.resource.resource_ref,
    )
    .unwrap_or(false)
    {
        return CapabilityPermissionDecision::AlwaysAllow;
    }
    if level == ResidentAccessLevel::Full
        && !full_access_must_confirm(request.capability, request.risk)
    {
        return CapabilityPermissionDecision::AllowOnce;
    }
    let id = luca_protocol::canonical_sha256(&request)
        .unwrap_or_else(|_| uuid::Uuid::new_v4().to_string());
    let (tx, rx) = mpsc::channel();
    let inserted = capability_pending().lock().ok().and_then(|mut entries| {
        if entries.contains_key(&id) {
            None
        } else {
            entries.insert(
                id.clone(),
                PendingCapability {
                    owner_pubkey: owner_pubkey.to_owned(),
                    request: request.clone(),
                    decision_tx: tx,
                },
            );
            Some(())
        }
    });
    if inserted.is_none() {
        return CapabilityPermissionDecision::Deny;
    }
    let _ = app.emit(
        PENDING_EVENT,
        PendingManagedPermission {
            pending_id: id.clone(),
            request: PendingManagedPermissionRequest::Capability(request),
        },
    );
    let decision = rx
        .recv_timeout(Duration::from_secs(MANAGED_PERMISSION_TIMEOUT_SECS))
        .unwrap_or(CapabilityPermissionDecision::Deny);
    if let Ok(mut entries) = capability_pending().lock() {
        entries.remove(&id);
    }
    decision
}

pub(crate) fn cancel_all() {
    if let Ok(mut entries) = pending().lock() {
        for (_, pending) in entries.drain() {
            let _ = pending.decision_tx.send(cancelled_resolution(
                &pending.request,
                ManagedPermissionResolutionOutcome::ApplicationClosed,
            ));
        }
    }
    if let Ok(mut entries) = capability_pending().lock() {
        for (_, pending) in entries.drain() {
            let _ = pending.decision_tx.send(CapabilityPermissionDecision::Deny);
        }
    }
}

/// Cancel pending prompts owned by an ACP session that exited or was replaced.
pub(crate) fn cancel_resident_session(resident_pubkey: &str, session_epoch: u64) {
    if let Ok(mut entries) = pending().lock() {
        let doomed: Vec<String> = entries
            .iter()
            .filter(|(_, pending)| {
                pending.request.resident_pubkey.as_str() == resident_pubkey
                    && pending.request.session_epoch.get() == session_epoch
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in doomed {
            if let Some(pending) = entries.remove(&id) {
                let _ = pending.decision_tx.send(cancelled_resolution(
                    &pending.request,
                    ManagedPermissionResolutionOutcome::SessionReplaced,
                ));
            }
        }
    }
    if let Ok(mut entries) = capability_pending().lock() {
        let doomed = entries
            .iter()
            .filter(|(_, pending)| {
                pending.request.resident_pubkey.as_str() == resident_pubkey
                    && pending.request.session_epoch.get() == session_epoch
            })
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in doomed {
            if let Some(pending) = entries.remove(&id) {
                let _ = pending.decision_tx.send(CapabilityPermissionDecision::Deny);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;

    use luca_protocol::{
        Hex64, ManagedPermissionOptionV1, OpaqueId, SafeU53, MANAGED_PERMISSION_PROTOCOL,
    };
    use serde::Deserialize;

    use super::*;

    #[derive(Debug, Deserialize)]
    struct ContinuityAbsentFixture {
        schema: String,
        fixture_class: String,
        proof_scope: String,
        semantic_fixtures: Vec<SemanticFixture>,
    }

    #[derive(Debug, Deserialize)]
    struct SemanticFixture {
        binding: String,
    }

    fn fixture() -> ContinuityAbsentFixture {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/luca-conformance/f10/continuity_absent.json"
        )))
        .expect("F10 fixture must be valid JSON")
    }

    #[test]
    fn full_access_still_confirms_high_impact_operations() {
        assert!(!full_access_must_confirm(
            CapabilityKind::FilesystemWrite,
            CapabilityRisk::Elevated
        ));
        assert!(full_access_must_confirm(
            CapabilityKind::DestructiveAction,
            CapabilityRisk::Routine
        ));
        assert!(full_access_must_confirm(
            CapabilityKind::ExternalCommunication,
            CapabilityRisk::Routine
        ));
        assert!(full_access_must_confirm(
            CapabilityKind::ProcessExecute,
            CapabilityRisk::HighImpact
        ));
    }

    fn request(acp_request_id: &str, session_epoch: u64) -> ManagedPermissionRequestV1 {
        ManagedPermissionRequestV1 {
            protocol: MANAGED_PERMISSION_PROTOCOL.into(),
            resident_pubkey: Hex64::parse("1".repeat(64)).expect("synthetic resident"),
            session_epoch: SafeU53::new(session_epoch).expect("synthetic epoch"),
            turn_id: OpaqueId::parse(format!("turn-{acp_request_id}")).expect("synthetic turn"),
            conversation_id: OpaqueId::parse("conversation-f10").expect("synthetic conversation"),
            acp_request_id: acp_request_id.into(),
            title: "Synthetic managed permission".into(),
            tool_call_id: None,
            options: vec![
                ManagedPermissionOptionV1 {
                    option_id: "runtime-allow".into(),
                    name: "Allow".into(),
                    kind: "allow_once".into(),
                },
                ManagedPermissionOptionV1 {
                    option_id: "runtime-reject".into(),
                    name: "Reject".into(),
                    kind: "reject_once".into(),
                },
            ],
        }
    }

    fn insert_pending(
        request: ManagedPermissionRequestV1,
    ) -> (String, mpsc::Receiver<ResolvedManagedPermission>) {
        let id = pending_id(&request);
        let (tx, rx) = mpsc::channel();
        pending().lock().expect("pending registry").insert(
            id.clone(),
            Pending {
                request,
                decision_tx: tx,
            },
        );
        (id, rx)
    }

    #[test]
    fn f10_continuity_absence_keeps_managed_permission_selection_and_cancellation_independent() {
        let fixture = fixture();
        assert_eq!(fixture.schema, "luca.f10.continuity-absent.v2");
        assert_eq!(fixture.fixture_class, "generated_synthetic");
        assert_eq!(
            fixture.proof_scope,
            "synthetic_bindings_not_native_runtime_proof"
        );
        let bindings = fixture
            .semantic_fixtures
            .iter()
            .map(|semantic| semantic.binding.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(
            bindings,
            std::collections::BTreeSet::from(["hermes", "openclaw"])
        );

        cancel_all();
        let allow_request = request("allow", 7);
        let (allow_id, allow_rx) = insert_pending(allow_request.clone());
        resolve(&allow_id, Some("runtime-allow".into())).expect("advertised allow resolves");
        let allow = allow_rx.recv().expect("allow decision delivered");
        assert_eq!(allow.outcome, ManagedPermissionResolutionOutcome::Approved);
        assert_eq!(
            allow.decision.disposition,
            ManagedPermissionDispositionV1::Selected
        );
        assert_eq!(allow.decision.option_id.as_deref(), Some("runtime-allow"));
        allow
            .decision
            .validate_for(&allow_request)
            .expect("allow binds exact request");
        assert!(
            resolve(&allow_id, Some("runtime-allow".into())).is_err(),
            "resolved ID is stale"
        );

        let reject_request = request("reject", 7);
        let (reject_id, reject_rx) = insert_pending(reject_request.clone());
        resolve(&reject_id, Some("runtime-reject".into())).expect("advertised reject resolves");
        let reject = reject_rx.recv().expect("reject decision delivered");
        assert_eq!(reject.outcome, ManagedPermissionResolutionOutcome::Rejected);
        assert_eq!(
            reject.decision.disposition,
            ManagedPermissionDispositionV1::Selected
        );
        assert_eq!(reject.decision.option_id.as_deref(), Some("runtime-reject"));
        reject
            .decision
            .validate_for(&reject_request)
            .expect("reject binds exact request");

        let cancel_request = request("cancel", 7);
        let (cancel_id, cancel_rx) = insert_pending(cancel_request.clone());
        resolve(&cancel_id, None).expect("explicit cancellation resolves");
        let cancellation = cancel_rx.recv().expect("cancellation delivered");
        assert_eq!(
            cancellation.outcome,
            ManagedPermissionResolutionOutcome::Cancelled
        );
        assert_eq!(
            cancellation.decision.disposition,
            ManagedPermissionDispositionV1::Cancelled
        );
        cancellation
            .decision
            .validate_for(&cancel_request)
            .expect("cancellation binds exact request");

        let session_request = request("session", 7);
        let resident = session_request.resident_pubkey.as_str().to_owned();
        let (session_id, session_rx) = insert_pending(session_request.clone());
        cancel_resident_session(&resident, 8);
        assert!(
            session_rx.try_recv().is_err(),
            "wrong epoch cannot cancel pending request"
        );
        assert!(list_pending()
            .expect("pending list")
            .iter()
            .any(|entry| entry.pending_id == session_id));
        cancel_resident_session(&resident, 7);
        let session_cancellation = session_rx.recv().expect("matching epoch cancels");
        assert_eq!(
            session_cancellation.outcome,
            ManagedPermissionResolutionOutcome::SessionReplaced
        );
        assert_eq!(
            session_cancellation.decision.disposition,
            ManagedPermissionDispositionV1::Cancelled
        );
        session_cancellation
            .decision
            .validate_for(&session_request)
            .expect("session cancellation binds request");
        assert!(
            resolve(&session_id, None).is_err(),
            "cancelled ID is stale or unknown"
        );
        assert!(list_pending().expect("pending list").is_empty());

        let close_request = request("close", 8);
        let (_close_id, close_rx) = insert_pending(close_request.clone());
        cancel_all();
        let application_closed = close_rx.recv().expect("application close resolves");
        assert_eq!(
            application_closed.outcome,
            ManagedPermissionResolutionOutcome::ApplicationClosed
        );
        application_closed
            .decision
            .validate_for(&close_request)
            .expect("application close cancellation binds request");

        assert_eq!(
            cancelled_resolution(
                &request("expired", 9),
                ManagedPermissionResolutionOutcome::Expired,
            )
            .outcome,
            ManagedPermissionResolutionOutcome::Expired
        );
        let safe_event = serde_json::to_value(ManagedPermissionResolvedEvent {
            pending_id: "safe-id".into(),
            outcome: ManagedPermissionResolutionOutcome::Rejected,
        })
        .expect("serialize safe resolution event");
        assert_eq!(
            safe_event,
            serde_json::json!({"pendingId": "safe-id", "outcome": "rejected"})
        );
        assert_eq!(
            safe_event
                .as_object()
                .expect("safe resolution object")
                .len(),
            2,
            "resolution events never expose permission request metadata"
        );
        // This test reaches only the private desktop registry and local decisions;
        // it neither creates a relay event nor calls publication/signing authority.
    }
}
