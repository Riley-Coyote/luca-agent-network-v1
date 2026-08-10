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

    /// Whether this exact frame belongs to a turn that already authenticated
    /// its `turn_started` frame against the durable dispatch store.
    ///
    /// Subsequent frames are still checked by `accept` for resident, epoch,
    /// turn, sequence, and terminal state. Avoiding a second durable-state
    /// check is intentional: cancellation may make the dispatch terminal just
    /// before the ACP host emits its final process-memory cancellation frame.
    fn is_bound(&self, frame: &ManagedPresentationFrameV1) -> bool {
        if frame.resident_pubkey != self.resident_pubkey
            || frame.session_epoch != self.session_epoch
        {
            return false;
        }
        self.dispatch_turns
            .get(&(
                frame.conversation_id.as_str().to_owned(),
                frame.dispatch_receipt_id.as_str().to_owned(),
            ))
            .is_some_and(|turn_id| turn_id == frame.turn_id.as_str())
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
        let already_bound = gate.is_bound(&frame);
        let authorized_start = already_bound
            || dispatch_store.lock().is_ok_and(|store| {
                store
                    .authorize_continuity_turn(
                        frame.dispatch_receipt_id.as_str(),
                        frame.resident_pubkey.as_str(),
                        frame.conversation_id.as_str(),
                        frame.session_epoch.get(),
                        chrono::Utc::now().timestamp().max(0) as u64,
                    )
                    .is_ok()
            });
        if !authorized_start {
            continue;
        }
        if !gate.accept(&frame) {
            continue;
        }
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
        assert!(gate.is_bound(&frame(
            resident.clone(),
            epoch,
            2,
            ManagedPresentationKindV1::Phase,
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
