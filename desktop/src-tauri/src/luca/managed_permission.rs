//! Desktop-owned, local-only approval transport for managed ACP permissions.

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    sync::{mpsc, Mutex, OnceLock},
    time::Duration,
};

use luca_protocol::{
    ManagedPermissionDecisionV1, ManagedPermissionDispositionV1, ManagedPermissionRequestV1,
    MANAGED_PERMISSION_PROTOCOL, MANAGED_PERMISSION_TIMEOUT_SECS,
};
use tauri::{AppHandle, Emitter};

const PENDING_EVENT: &str = "managed-permission-pending";
const RESOLVED_EVENT: &str = "managed-permission-resolved";

struct Pending {
    request: ManagedPermissionRequestV1,
    decision_tx: mpsc::Sender<ManagedPermissionDecisionV1>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingManagedPermission {
    pub pending_id: String,
    pub request: ManagedPermissionRequestV1,
}

static PENDING: OnceLock<Mutex<HashMap<String, Pending>>> = OnceLock::new();

fn pending() -> &'static Mutex<HashMap<String, Pending>> {
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
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
fn serve(app: AppHandle, stream: std::os::unix::net::UnixStream, resident_pubkey: luca_protocol::Hex64, session_epoch: luca_protocol::SafeU53) {
    let writer = match stream.try_clone() {
        Ok(writer) => writer,
        Err(_) => return,
    };
    let mut reader = BufReader::new(stream);
    loop {
        let mut line = String::new();
        let Ok(read) = reader.read_line(&mut line) else { break };
        if read == 0 || line.len() > 64 * 1024 { break; }
        let Ok(request) = serde_json::from_str::<ManagedPermissionRequestV1>(&line) else { break; };
        if request.validate().is_err() || request.resident_pubkey != resident_pubkey || request.session_epoch != session_epoch { break; }
        let id = pending_id(&request);
        let (tx, rx) = mpsc::channel();
        let inserted = pending().lock().ok().and_then(|mut entries| {
            if entries.contains_key(&id) { None } else {
                entries.insert(id.clone(), Pending { request: request.clone(), decision_tx: tx });
                Some(())
            }
        });
        let decision = if inserted.is_some() {
            let _ = app.emit(PENDING_EVENT, PendingManagedPermission { pending_id: id.clone(), request: request.clone() });
            rx.recv_timeout(Duration::from_secs(MANAGED_PERMISSION_TIMEOUT_SECS))
                .unwrap_or_else(|_| cancelled(&request))
        } else {
            cancelled(&request)
        };
        if let Ok(mut entries) = pending().lock() { entries.remove(&id); }
        let _ = app.emit(RESOLVED_EVENT, serde_json::json!({"pendingId": id, "disposition": decision.disposition}));
        let Ok(bytes) = serde_json::to_vec(&decision) else { break; };
        let mut writer = &writer;
        if writer.write_all(&bytes).and_then(|_| writer.write_all(b"\n")).and_then(|_| writer.flush()).is_err() { break; }
    }
}

pub(crate) fn list_pending() -> Result<Vec<PendingManagedPermission>, String> {
    let entries = pending().lock().map_err(|_| "managed permission registry unavailable".to_string())?;
    Ok(entries.iter().map(|(id, pending)| PendingManagedPermission { pending_id: id.clone(), request: pending.request.clone() }).collect())
}

pub(crate) fn resolve(pending_id: &str, option_id: Option<String>) -> Result<(), String> {
    let mut entries = pending().lock().map_err(|_| "managed permission registry unavailable".to_string())?;
    let pending = entries.get(pending_id)
        .ok_or_else(|| "managed permission request is unknown, expired, or already resolved".to_string())?;
    let decision = ManagedPermissionDecisionV1 {
        protocol: MANAGED_PERMISSION_PROTOCOL.into(),
        resident_pubkey: pending.request.resident_pubkey.clone(),
        session_epoch: pending.request.session_epoch,
        turn_id: pending.request.turn_id.clone(),
        conversation_id: pending.request.conversation_id.clone(),
        acp_request_id: pending.request.acp_request_id.clone(),
        disposition: if option_id.is_some() { ManagedPermissionDispositionV1::Selected } else { ManagedPermissionDispositionV1::Cancelled },
        option_id,
    };
    decision.validate_for(&pending.request).map_err(|error| error.to_string())?;
    let pending = entries.remove(pending_id).ok_or_else(|| "managed permission request disappeared".to_string())?;
    pending.decision_tx.send(decision).map_err(|_| "managed permission request is no longer waiting".to_string())
}

pub(crate) fn cancel_all() {
    if let Ok(mut entries) = pending().lock() {
        for (_, pending) in entries.drain() { let _ = pending.decision_tx.send(cancelled(&pending.request)); }
    }
}

/// Cancel pending prompts owned by an ACP session that exited or was replaced.
pub(crate) fn cancel_resident_session(resident_pubkey: &str, session_epoch: u64) {
    if let Ok(mut entries) = pending().lock() {
        let doomed: Vec<String> = entries.iter().filter_map(|(id, pending)| {
            (pending.request.resident_pubkey.as_str() == resident_pubkey
                && pending.request.session_epoch.get() == session_epoch).then(|| id.clone())
        }).collect();
        for id in doomed {
            if let Some(pending) = entries.remove(&id) {
                let _ = pending.decision_tx.send(cancelled(&pending.request));
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
    ) -> (String, mpsc::Receiver<ManagedPermissionDecisionV1>) {
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
        assert_eq!(allow.disposition, ManagedPermissionDispositionV1::Selected);
        assert_eq!(allow.option_id.as_deref(), Some("runtime-allow"));
        allow
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
        assert_eq!(reject.disposition, ManagedPermissionDispositionV1::Selected);
        assert_eq!(reject.option_id.as_deref(), Some("runtime-reject"));
        reject
            .validate_for(&reject_request)
            .expect("reject binds exact request");

        let cancel_request = request("cancel", 7);
        let (cancel_id, cancel_rx) = insert_pending(cancel_request.clone());
        resolve(&cancel_id, None).expect("explicit cancellation resolves");
        let cancellation = cancel_rx.recv().expect("cancellation delivered");
        assert_eq!(
            cancellation.disposition,
            ManagedPermissionDispositionV1::Cancelled
        );
        cancellation
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
            session_cancellation.disposition,
            ManagedPermissionDispositionV1::Cancelled
        );
        session_cancellation
            .validate_for(&session_request)
            .expect("session cancellation binds request");
        assert!(
            resolve(&session_id, None).is_err(),
            "cancelled ID is stale or unknown"
        );
        assert!(list_pending().expect("pending list").is_empty());
        // This test reaches only the private desktop registry and local decisions;
        // it neither creates a relay event nor calls publication/signing authority.
    }
}
