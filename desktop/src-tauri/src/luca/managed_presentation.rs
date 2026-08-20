//! Desktop endpoint for ephemeral managed response presentation frames.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    io::{BufRead, BufReader, Read},
};

use luca_protocol::{
    Hex64, ManagedPresentationFrameV1, ManagedPresentationKindV1, SafeU53,
    MAX_MANAGED_PRESENTATION_FRAME_BYTES,
};
use tauri::{AppHandle, Emitter};

pub(crate) const PRESENTATION_EVENT: &str = "luca://managed-presentation";
const MAX_TERMINAL_TOMBSTONES: usize = 512;

type FrameKey = (String, String, String);

#[derive(Clone)]
struct PresentationFrameGate {
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    sequences: HashMap<FrameKey, u64>,
    dispatch_turns: HashMap<(String, String), String>,
    terminal: HashSet<FrameKey>,
    terminal_order: VecDeque<FrameKey>,
}

impl PresentationFrameGate {
    fn new(resident_pubkey: Hex64, session_epoch: SafeU53) -> Self {
        Self {
            resident_pubkey,
            session_epoch,
            sequences: HashMap::new(),
            dispatch_turns: HashMap::new(),
            terminal: HashSet::new(),
            terminal_order: VecDeque::new(),
        }
    }

    fn accept(&mut self, frame: &ManagedPresentationFrameV1) -> bool {
        if frame.validate().is_err()
            || frame.resident_pubkey != self.resident_pubkey
            || frame.session_epoch != self.session_epoch
        {
            return false;
        }
        let key = (
            frame.conversation_id.as_str().to_owned(),
            frame.turn_id.as_str().to_owned(),
            frame.dispatch_receipt_id.as_str().to_owned(),
        );
        let dispatch_key = (key.0.clone(), key.2.clone());
        if self.terminal.contains(&key) {
            return false;
        }
        match self.dispatch_turns.get(&dispatch_key) {
            Some(turn_id) if turn_id != &key.1 => return false,
            Some(_) if frame.kind == ManagedPresentationKindV1::TurnStarted => return false,
            Some(_) => {}
            None if frame.kind != ManagedPresentationKindV1::TurnStarted
                || frame.sequence.get() != 1 =>
            {
                return false;
            }
            None => {
                self.dispatch_turns.insert(dispatch_key, key.1.clone());
            }
        }
        let last = self.sequences.entry(key.clone()).or_default();
        if frame.sequence.get() != last.saturating_add(1) {
            return false;
        }
        *last = frame.sequence.get();
        if matches!(
            frame.kind,
            ManagedPresentationKindV1::Completed
                | ManagedPresentationKindV1::Cancelled
                | ManagedPresentationKindV1::Failed
        ) {
            self.sequences.remove(&key);
            self.terminal.insert(key.clone());
            self.terminal_order.push_back(key);
            if self.terminal_order.len() > MAX_TERMINAL_TOMBSTONES {
                if let Some(oldest) = self.terminal_order.pop_front() {
                    self.terminal.remove(&oldest);
                    self.dispatch_turns
                        .remove(&(oldest.0.clone(), oldest.2.clone()));
                }
            }
        }
        true
    }
}

/// Child-side descriptor for the one-way presentation socket.
#[cfg(unix)]
pub(crate) struct ManagedPresentationChildFd(std::os::fd::OwnedFd);

#[cfg(unix)]
impl ManagedPresentationChildFd {
    pub(crate) fn raw_fd(&self) -> std::os::fd::RawFd {
        use std::os::fd::AsRawFd;
        self.0.as_raw_fd()
    }
}

/// Create a session-scoped presentation endpoint and start its strict reader.
#[cfg(unix)]
pub(crate) fn create_endpoint(
    app: AppHandle,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
) -> Result<ManagedPresentationChildFd, String> {
    let (desktop, child) = std::os::unix::net::UnixStream::pair()
        .map_err(|error| format!("create managed presentation socketpair: {error}"))?;
    let dispatch_store = super::managed_dispatch_store::global_dispatch_store(&app)?;
    std::thread::Builder::new()
        .name("luca-managed-presentation".into())
        .spawn(move || serve(app, desktop, resident_pubkey, session_epoch, dispatch_store))
        .map_err(|error| format!("start managed presentation reader: {error}"))?;
    Ok(ManagedPresentationChildFd(child.into()))
}

#[cfg(unix)]
fn serve(
    app: AppHandle,
    stream: std::os::unix::net::UnixStream,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    dispatch_store: std::sync::Arc<
        std::sync::Mutex<super::managed_dispatch_store::ManagedDispatchStore>,
    >,
) {
    struct SessionAuthorityGuard {
        resident_pubkey: Hex64,
        session_epoch: SafeU53,
    }

    impl Drop for SessionAuthorityGuard {
        fn drop(&mut self) {
            let _ = super::communication_turn_registry::clear_session(
                self.resident_pubkey.as_str(),
                self.session_epoch.get(),
            );
        }
    }

    let _authority_guard = SessionAuthorityGuard {
        resident_pubkey: resident_pubkey.clone(),
        session_epoch,
    };
    let mut reader = BufReader::new(stream);
    let mut gate = PresentationFrameGate::new(resident_pubkey, session_epoch);
    loop {
        let mut line = Vec::new();
        let read = {
            let mut bounded = reader
                .by_ref()
                .take((MAX_MANAGED_PRESENTATION_FRAME_BYTES + 1) as u64);
            bounded.read_until(b'\n', &mut line)
        };
        let Ok(read) = read else { break };
        if read == 0 {
            break;
        }
        if line.len() > MAX_MANAGED_PRESENTATION_FRAME_BYTES || line.last() != Some(&b'\n') {
            break;
        }
        let Ok(frame) = serde_json::from_slice::<ManagedPresentationFrameV1>(&line) else {
            continue;
        };
        let mut candidate_gate = gate.clone();
        if !candidate_gate.accept(&frame) {
            continue;
        }
        let now = chrono::Utc::now().timestamp().max(0) as u64;
        match frame.kind {
            ManagedPresentationKindV1::TurnStarted => {
                // A turn woken by another resident (or by an owner message
                // from another device) has no locally staged dispatch. Stage
                // one from the trigger event itself so the turn presents and
                // publishes like any other; failure is logged, never fatal —
                // the binding below still decides, visibly.
                // TODO(ship): permissive-staging default chosen for build
                // velocity (2026-08); review the security posture before
                // shipping and confirm we are happy with how turns acquire
                // dispatch rows.
                super::exchange::ensure_wake_dispatch(
                    &app,
                    &dispatch_store,
                    frame.dispatch_receipt_id.as_str(),
                    frame.resident_pubkey.as_str(),
                    now,
                );
                // Reserve the exact process-memory tuple first. A broker action
                // cannot use this brief reservation because every action also
                // rechecks that the durable dispatch is Active. If durable
                // binding fails, revoke the reservation before continuing.
                if super::communication_turn_registry::observe_accepted_frame(&frame).is_err() {
                    continue;
                }
                let bound = dispatch_store.lock().is_ok_and(|mut store| {
                    store
                        .bind_communication_turn_start(
                            frame.dispatch_receipt_id.as_str(),
                            frame.resident_pubkey.as_str(),
                            frame.conversation_id.as_str(),
                            frame.session_epoch.get(),
                            now,
                        )
                        .is_ok()
                });
                if !bound {
                    super::communication_turn_registry::revoke_exact(
                        frame.resident_pubkey.as_str(),
                        frame.session_epoch.get(),
                        frame.conversation_id.as_str(),
                        frame.turn_id.as_str(),
                        frame.dispatch_receipt_id.as_str(),
                    );
                    continue;
                }

                // Cancellation or runtime replacement can win while the
                // durable Pending -> Active transition is being persisted.
                // Recheck both authorities after that transition and before
                // making the start frame visible to the UI. The broker still
                // performs the same dual recheck for every privileged action;
                // this closes the corresponding stale-presentation window.
                let active = super::communication_turn_registry::authorize(
                    frame.resident_pubkey.as_str(),
                    frame.session_epoch.get(),
                    frame.conversation_id.as_str(),
                    frame.turn_id.as_str(),
                    frame.dispatch_receipt_id.as_str(),
                )
                .is_ok();
                let durable = dispatch_store.lock().is_ok_and(|store| {
                    store
                        .recheck_communication_turn(
                            frame.dispatch_receipt_id.as_str(),
                            frame.resident_pubkey.as_str(),
                            frame.conversation_id.as_str(),
                            frame.session_epoch.get(),
                            now,
                        )
                        .is_ok()
                });
                if !active || !durable {
                    super::communication_turn_registry::revoke_exact(
                        frame.resident_pubkey.as_str(),
                        frame.session_epoch.get(),
                        frame.conversation_id.as_str(),
                        frame.turn_id.as_str(),
                        frame.dispatch_receipt_id.as_str(),
                    );
                    continue;
                }
            }
            ManagedPresentationKindV1::Completed
            | ManagedPresentationKindV1::Cancelled
            | ManagedPresentationKindV1::Failed => {
                // Revoke before the terminal frame is visible. This ordering is
                // the synchronous cancellation/publication race boundary.
                super::communication_turn_registry::revoke_exact(
                    frame.resident_pubkey.as_str(),
                    frame.session_epoch.get(),
                    frame.conversation_id.as_str(),
                    frame.turn_id.as_str(),
                    frame.dispatch_receipt_id.as_str(),
                );
            }
            ManagedPresentationKindV1::Phase | ManagedPresentationKindV1::PublicChunk => {
                let active = super::communication_turn_registry::authorize(
                    frame.resident_pubkey.as_str(),
                    frame.session_epoch.get(),
                    frame.conversation_id.as_str(),
                    frame.turn_id.as_str(),
                    frame.dispatch_receipt_id.as_str(),
                )
                .is_ok();
                let durable = dispatch_store.lock().is_ok_and(|store| {
                    store
                        .recheck_communication_turn(
                            frame.dispatch_receipt_id.as_str(),
                            frame.resident_pubkey.as_str(),
                            frame.conversation_id.as_str(),
                            frame.session_epoch.get(),
                            now,
                        )
                        .is_ok()
                });
                if !active || !durable {
                    continue;
                }
            }
        }
        gate = candidate_gate;
        let _ = app.emit(PRESENTATION_EVENT, frame);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::{ManagedPresentationKindV1, OpaqueId, MANAGED_PRESENTATION_PROTOCOL};

    fn frame(
        resident_pubkey: Hex64,
        session_epoch: SafeU53,
        sequence: u64,
        kind: ManagedPresentationKindV1,
    ) -> ManagedPresentationFrameV1 {
        ManagedPresentationFrameV1 {
            protocol: MANAGED_PRESENTATION_PROTOCOL.into(),
            kind,
            resident_pubkey,
            conversation_id: OpaqueId::parse("conversation-1").unwrap(),
            turn_id: OpaqueId::parse("turn-1").unwrap(),
            dispatch_receipt_id: OpaqueId::parse("dispatch-1").unwrap(),
            session_epoch,
            sequence: SafeU53::new(sequence).unwrap(),
            phase: None,
            public_chunk: None,
            failure: None,
        }
    }

    #[test]
    fn event_name_is_namespaced_and_process_local() {
        assert_eq!(PRESENTATION_EVENT, "luca://managed-presentation");
    }

    #[test]
    fn gate_rejects_wrong_binding_out_of_order_and_post_terminal_frames() {
        let resident = Hex64::parse("11".repeat(32)).unwrap();
        let epoch = SafeU53::new(7).unwrap();
        let mut gate = PresentationFrameGate::new(resident.clone(), epoch);

        let wrong_resident = frame(
            Hex64::parse("22".repeat(32)).unwrap(),
            epoch,
            1,
            ManagedPresentationKindV1::TurnStarted,
        );
        assert!(!gate.accept(&wrong_resident));
        assert!(!gate.accept(&frame(
            resident.clone(),
            SafeU53::new(8).unwrap(),
            1,
            ManagedPresentationKindV1::TurnStarted,
        )));
        assert!(!gate.accept(&frame(
            resident.clone(),
            epoch,
            2,
            ManagedPresentationKindV1::TurnStarted,
        )));
        assert!(!gate.accept(&frame(
            resident.clone(),
            epoch,
            1,
            ManagedPresentationKindV1::PublicChunk,
        )));
        assert!(gate.accept(&frame(
            resident.clone(),
            epoch,
            1,
            ManagedPresentationKindV1::TurnStarted,
        )));
        let mut wrong_turn = frame(resident.clone(), epoch, 2, ManagedPresentationKindV1::Phase);
        wrong_turn.turn_id = OpaqueId::parse("turn-2").unwrap();
        assert!(!gate.accept(&wrong_turn));
        assert!(gate.accept(&frame(
            resident.clone(),
            epoch,
            2,
            ManagedPresentationKindV1::Completed,
        )));
        assert!(!gate.accept(&frame(
            resident,
            epoch,
            3,
            ManagedPresentationKindV1::Completed,
        )));
    }
}
