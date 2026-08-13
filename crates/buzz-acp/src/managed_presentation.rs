//! Sanitized one-way presentation feed from the managed ACP host to desktop.

use std::{collections::HashMap, sync::Arc};

use luca_protocol::{
    Hex64, ManagedPresentationFailureV1, ManagedPresentationFrameV1, ManagedPresentationKindV1,
    ManagedPresentationPhaseV1, OpaqueId, SafeU53, MANAGED_PRESENTATION_PROTOCOL,
    MAX_MANAGED_PRESENTATION_CHUNK_BYTES, MAX_MANAGED_PRESENTATION_FRAME_BYTES,
};
use tokio::io::AsyncWriteExt;

use crate::{
    luca_final_publisher::CODEX_SKILL_CONTEXT_NOTICE,
    observer::{ObserverEvent, ObserverHandle},
};

const PRESENTATION_FD_ENV: &str = "LUCA_MANAGED_PRESENTATION_FD";

#[derive(Clone)]
pub(crate) struct ManagedPresentationPublisher {
    writer: Arc<tokio::sync::Mutex<tokio::net::UnixStream>>,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
}

struct TurnState {
    conversation_id: OpaqueId,
    turn_id: OpaqueId,
    dispatch_receipt_id: OpaqueId,
    sequence: u64,
    phase: Option<ManagedPresentationPhaseV1>,
    notice_gate: RuntimeNoticeGate,
    terminal_emitted: bool,
}

#[derive(Default)]
struct RuntimeNoticeGate {
    buffered: String,
    decided: bool,
}

impl RuntimeNoticeGate {
    fn push(&mut self, chunk: &str) -> Option<String> {
        if self.decided {
            return (!chunk.is_empty()).then(|| chunk.to_owned());
        }
        self.buffered.push_str(chunk);
        if CODEX_SKILL_CONTEXT_NOTICE.starts_with(&self.buffered) {
            return None;
        }
        if let Some(remainder) = self.buffered.strip_prefix(CODEX_SKILL_CONTEXT_NOTICE) {
            if remainder.is_empty() {
                return None;
            }
            if remainder.starts_with('\n') {
                let public = remainder.trim_start().to_owned();
                self.buffered.clear();
                self.decided = true;
                return (!public.is_empty()).then_some(public);
            }
        }
        self.decided = true;
        Some(std::mem::take(&mut self.buffered))
    }
}

impl ManagedPresentationPublisher {
    #[cfg(unix)]
    pub(crate) fn from_env() -> anyhow::Result<Option<Self>> {
        use nix::fcntl::{fcntl, FcntlArg, FdFlag};
        use std::os::fd::{AsRawFd, OwnedFd};

        let raw = match std::env::var(PRESENTATION_FD_ENV) {
            Ok(value) => value
                .parse::<i32>()
                .map_err(|_| anyhow::anyhow!("invalid managed presentation descriptor"))?,
            Err(std::env::VarError::NotPresent) => return Ok(None),
            Err(_) => return Err(anyhow::anyhow!("invalid managed presentation descriptor")),
        };
        if raw < 3 {
            return Err(anyhow::anyhow!(
                "managed presentation descriptor is not dedicated"
            ));
        }
        let file = std::fs::File::open(format!("/dev/fd/{raw}"))?;
        fcntl(&file, FcntlArg::F_SETFD(FdFlag::FD_CLOEXEC))?;
        if file.as_raw_fd() == raw {
            return Err(anyhow::anyhow!(
                "managed presentation descriptor was not duplicated"
            ));
        }
        let stream = std::os::unix::net::UnixStream::from(OwnedFd::from(file));
        nix::unistd::close(raw)?;
        stream.set_nonblocking(true)?;
        let resident_pubkey = std::env::var("LUCA_MANAGED_RESIDENT_PUBKEY")
            .ok()
            .and_then(|value| Hex64::parse(value).ok())
            .ok_or_else(|| anyhow::anyhow!("managed presentation resident is missing"))?;
        let session_epoch = std::env::var("LUCA_MANAGED_SESSION_EPOCH")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .and_then(|value| SafeU53::new(value).ok())
            .ok_or_else(|| anyhow::anyhow!("managed presentation epoch is missing"))?;
        Ok(Some(Self {
            writer: Arc::new(tokio::sync::Mutex::new(tokio::net::UnixStream::from_std(
                stream,
            )?)),
            resident_pubkey,
            session_epoch,
        }))
    }

    #[cfg(not(unix))]
    pub(crate) fn from_env() -> anyhow::Result<Option<Self>> {
        Ok(None)
    }

    pub(crate) fn spawn(self, observer: ObserverHandle) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut receiver = observer.subscribe();
            let mut turns = HashMap::<String, TurnState>::new();
            loop {
                match receiver.recv().await {
                    Ok(event) => self.ingest(event, &mut turns).await,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                }
            }
        })
    }

    async fn ingest(&self, event: ObserverEvent, turns: &mut HashMap<String, TurnState>) {
        match event.kind.as_str() {
            "turn_started" => {
                let Some(turn_id) = event.turn_id.as_deref() else {
                    return;
                };
                let Some(channel_id) = event.channel_id.as_deref() else {
                    return;
                };
                let Some(receipt_id) = managed_dispatch_receipt_id(&event.payload) else {
                    return;
                };
                let Ok(conversation_id) = OpaqueId::parse(channel_id) else {
                    return;
                };
                let Ok(turn_id_value) = OpaqueId::parse(turn_id) else {
                    return;
                };
                let Ok(dispatch_receipt_id) = OpaqueId::parse(receipt_id) else {
                    return;
                };
                let mut state = TurnState {
                    conversation_id,
                    turn_id: turn_id_value,
                    dispatch_receipt_id,
                    sequence: 0,
                    phase: None,
                    notice_gate: RuntimeNoticeGate::default(),
                    terminal_emitted: false,
                };
                self.emit(
                    &mut state,
                    ManagedPresentationKindV1::TurnStarted,
                    None,
                    None,
                    None,
                )
                .await;
                self.emit_phase(&mut state, ManagedPresentationPhaseV1::Thinking)
                    .await;
                turns.insert(turn_id.to_owned(), state);
            }
            "acp_read" => {
                let Some(turn_id) = event.turn_id.as_deref() else {
                    return;
                };
                let Some(state) = turns.get_mut(turn_id) else {
                    return;
                };
                let update = &event.payload["params"]["update"];
                match update.get("sessionUpdate").and_then(|value| value.as_str()) {
                    Some("agent_message_chunk") => {
                        let Some(chunk) = update["content"]["text"].as_str() else {
                            return;
                        };
                        self.emit_phase(state, ManagedPresentationPhaseV1::Writing)
                            .await;
                        if let Some(public) = state.notice_gate.push(chunk) {
                            for part in bounded_chunks(&public) {
                                self.emit(
                                    state,
                                    ManagedPresentationKindV1::PublicChunk,
                                    None,
                                    Some(part),
                                    None,
                                )
                                .await;
                            }
                        }
                    }
                    Some("tool_call" | "tool_call_update" | "plan") => {
                        self.emit_phase(state, ManagedPresentationPhaseV1::Working)
                            .await;
                    }
                    _ => {}
                }
            }
            "turn_terminal" => {
                let Some(turn_id) = event.turn_id.as_deref() else {
                    return;
                };
                let Some(state) = turns.get_mut(turn_id) else {
                    return;
                };
                if state.terminal_emitted {
                    return;
                }
                state.terminal_emitted = true;
                match event.payload.get("status").and_then(|value| value.as_str()) {
                    Some("finalizing") => {
                        self.emit_phase(state, ManagedPresentationPhaseV1::Finalizing)
                            .await;
                        self.emit(
                            state,
                            ManagedPresentationKindV1::Completed,
                            None,
                            None,
                            None,
                        )
                        .await;
                    }
                    Some("cancelled") => {
                        self.emit(
                            state,
                            ManagedPresentationKindV1::Cancelled,
                            None,
                            None,
                            None,
                        )
                        .await;
                    }
                    _ => {
                        self.emit(
                            state,
                            ManagedPresentationKindV1::Failed,
                            None,
                            None,
                            Some(ManagedPresentationFailureV1::Runtime),
                        )
                        .await;
                    }
                }
            }
            "turn_publication_terminal" => {
                let Some(turn_id) = event.turn_id.as_deref() else {
                    return;
                };
                let Some(state) = turns.get_mut(turn_id) else {
                    return;
                };
                if state.terminal_emitted {
                    return;
                }
                state.terminal_emitted = true;
                if event.payload.get("status").and_then(|value| value.as_str()) == Some("cancelled")
                {
                    self.emit(
                        state,
                        ManagedPresentationKindV1::Cancelled,
                        None,
                        None,
                        None,
                    )
                    .await;
                } else {
                    self.emit(
                        state,
                        ManagedPresentationKindV1::Failed,
                        None,
                        None,
                        Some(ManagedPresentationFailureV1::Publication),
                    )
                    .await;
                }
            }
            "turn_completed" => {
                let Some(turn_id) = event.turn_id.as_deref() else {
                    return;
                };
                if let Some(mut state) = turns.remove(turn_id) {
                    if !state.terminal_emitted {
                        self.emit(
                            &mut state,
                            ManagedPresentationKindV1::Failed,
                            None,
                            None,
                            Some(ManagedPresentationFailureV1::Runtime),
                        )
                        .await;
                    }
                }
            }
            _ => {}
        }
    }

    async fn emit_phase(&self, state: &mut TurnState, phase: ManagedPresentationPhaseV1) {
        if state.phase == Some(phase) {
            return;
        }
        state.phase = Some(phase);
        self.emit(
            state,
            ManagedPresentationKindV1::Phase,
            Some(phase),
            None,
            None,
        )
        .await;
    }

    async fn emit(
        &self,
        state: &mut TurnState,
        kind: ManagedPresentationKindV1,
        phase: Option<ManagedPresentationPhaseV1>,
        public_chunk: Option<String>,
        failure: Option<ManagedPresentationFailureV1>,
    ) {
        state.sequence = state.sequence.saturating_add(1);
        let Ok(sequence) = SafeU53::new(state.sequence) else {
            return;
        };
        let frame = ManagedPresentationFrameV1 {
            protocol: MANAGED_PRESENTATION_PROTOCOL.into(),
            kind,
            resident_pubkey: self.resident_pubkey.clone(),
            conversation_id: state.conversation_id.clone(),
            turn_id: state.turn_id.clone(),
            dispatch_receipt_id: state.dispatch_receipt_id.clone(),
            session_epoch: self.session_epoch,
            sequence,
            phase,
            public_chunk,
            failure,
        };
        if frame.validate().is_err() {
            return;
        }
        let Ok(mut bytes) = serde_json::to_vec(&frame) else {
            return;
        };
        if bytes.len() > MAX_MANAGED_PRESENTATION_FRAME_BYTES {
            return;
        }
        bytes.push(b'\n');
        let mut writer = self.writer.lock().await;
        let _ = writer.write_all(&bytes).await;
        let _ = writer.flush().await;
    }
}

fn managed_dispatch_receipt_id(payload: &serde_json::Value) -> Option<&str> {
    payload
        .get("managedDispatchReceiptId")
        .and_then(|value| value.as_str())
        .or_else(|| {
            payload
                .get("triggeringEventIds")
                .and_then(|value| value.as_array())
                .and_then(|values| values.last())
                .and_then(|value| value.as_str())
        })
}

fn bounded_chunks(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut remaining = value;
    while !remaining.is_empty() {
        let mut end = remaining.len().min(MAX_MANAGED_PRESENTATION_CHUNK_BYTES);
        while !remaining.is_char_boundary(end) {
            end -= 1;
        }
        parts.push(remaining[..end].to_owned());
        remaining = &remaining[end..];
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notice_is_withheld_until_exact_prefix_is_resolved() {
        let mut gate = RuntimeNoticeGate::default();
        let split = CODEX_SKILL_CONTEXT_NOTICE.len() / 2;
        assert_eq!(gate.push(&CODEX_SKILL_CONTEXT_NOTICE[..split]), None);
        assert_eq!(
            gate.push(&format!(
                "{}\n\nAnswer",
                &CODEX_SKILL_CONTEXT_NOTICE[split..]
            )),
            Some("Answer".into())
        );
    }

    #[test]
    fn arbitrary_model_text_is_not_filtered() {
        let mut gate = RuntimeNoticeGate::default();
        assert_eq!(
            gate.push("Warning: a real answer"),
            Some("Warning: a real answer".into())
        );
    }

    #[test]
    fn sequential_turns_use_each_exact_managed_dispatch_not_batch_tail() {
        let owner_one = "11".repeat(32);
        let resident_tail_one = "aa".repeat(32);
        let owner_two = "22".repeat(32);
        let resident_tail_two = "bb".repeat(32);

        let first = serde_json::json!({
            "triggeringEventIds": [owner_one, resident_tail_one],
            "managedDispatchReceiptId": owner_one,
        });
        let second = serde_json::json!({
            "triggeringEventIds": [owner_two, resident_tail_two],
            "managedDispatchReceiptId": owner_two,
        });

        assert_eq!(
            managed_dispatch_receipt_id(&first),
            Some(owner_one.as_str())
        );
        assert_eq!(
            managed_dispatch_receipt_id(&second),
            Some(owner_two.as_str())
        );
    }

    #[test]
    fn legacy_turn_started_payload_keeps_last_event_fallback() {
        let older = "33".repeat(32);
        let latest = "44".repeat(32);
        let payload = serde_json::json!({"triggeringEventIds": [older, latest]});
        assert_eq!(managed_dispatch_receipt_id(&payload), Some(latest.as_str()));
    }
}
