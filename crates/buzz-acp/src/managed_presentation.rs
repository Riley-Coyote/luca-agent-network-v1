//! Sanitized one-way presentation feed from the managed ACP host to desktop.

#![cfg_attr(not(unix), allow(dead_code))]

use std::{collections::HashMap, sync::Arc};

use luca_protocol::{
    CapabilityAuthorityV1, CapabilityConfigurationV1, CapabilityExecutionV1, CapabilitySupportV1,
    Hex64, ManagedPresentationActivityKindV1, ManagedPresentationActivityStatusV1,
    ManagedPresentationActivityV1, ManagedPresentationFailureV1, ManagedPresentationFrameV1,
    ManagedPresentationKindV1, ManagedPresentationPhaseV1, NativeTaskFactsV1, OpaqueId,
    ResidentCapabilityFactV1, ResidentSessionCapabilityV1, ResidentSessionCommandV1, SafeU53,
    MANAGED_PRESENTATION_PROTOCOL, MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES,
    MAX_MANAGED_PRESENTATION_ACTIVITY_LABEL_BYTES, MAX_MANAGED_PRESENTATION_CHUNK_BYTES,
    MAX_MANAGED_PRESENTATION_FRAME_BYTES, MAX_RESIDENT_SESSION_COMMANDS,
    RESIDENT_SESSION_CAPABILITY_PROTOCOL,
};
use tokio::io::AsyncWriteExt;

use crate::{
    luca_final_publisher::{
        PublicTextJoiner, CODEX_SKILL_BUDGET_NOTICE_PREFIXES, CODEX_SKILL_BUDGET_NOTICE_SUFFIX,
        CODEX_SKILL_CONTEXT_NOTICE, SILENT_ACTION_SENTINEL,
    },
    observer::{ObserverEvent, ObserverHandle},
};

const PRESENTATION_FD_ENV: &str = "LUCA_MANAGED_PRESENTATION_FD";

#[cfg(unix)]
type ManagedPresentationStream = tokio::net::UnixStream;

#[cfg(not(unix))]
type ManagedPresentationStream = tokio::io::DuplexStream;

#[derive(Clone)]
pub(crate) struct ManagedPresentationPublisher {
    writer: Arc<tokio::sync::Mutex<ManagedPresentationStream>>,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    runtime_family: String,
}

struct TurnState {
    conversation_id: OpaqueId,
    turn_id: OpaqueId,
    dispatch_receipt_id: OpaqueId,
    sequence: u64,
    phase: Option<ManagedPresentationPhaseV1>,
    public_text: PublicTextStream,
    activity: ActivityLedger,
    terminal_emitted: bool,
}

/// One turn's public-text translation: the shared paragraph-boundary rule
/// followed by the runtime-notice gate.
///
/// The boundary rule is applied to the raw chunk stream — exactly what
/// [`FinalChunkAccumulator`](crate::luca_final_publisher::FinalChunkAccumulator)
/// sees — so the streamed text and the signed final draft stay identical and
/// the desktop's reconciliation never has to snap.
#[derive(Default)]
struct PublicTextStream {
    joiner: PublicTextJoiner,
    notice_gate: RuntimeNoticeGate,
}

impl PublicTextStream {
    /// Record a `tool_call`, `tool_call_update`, or `plan` update.
    fn mark_boundary(&mut self) {
        self.joiner.mark_boundary();
    }

    /// Translate one `agent_message_chunk` into public text, if any.
    fn push(&mut self, chunk: &str) -> Option<String> {
        let separator = self.joiner.separator_for(chunk);
        if separator.is_empty() {
            self.notice_gate.push(chunk)
        } else {
            self.notice_gate.push(&format!("{separator}{chunk}"))
        }
    }
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
        loop {
            if SILENT_ACTION_SENTINEL.starts_with(&self.buffered) {
                return None;
            }
            if self.buffered.starts_with(SILENT_ACTION_SENTINEL) {
                self.decided = true;
                return Some(std::mem::take(&mut self.buffered));
            }
            if CODEX_SKILL_CONTEXT_NOTICE.starts_with(&self.buffered) {
                return None;
            }
            if let Some(remainder) = self.buffered.strip_prefix(CODEX_SKILL_CONTEXT_NOTICE) {
                if remainder.is_empty() {
                    return None;
                }
                if remainder.starts_with('\n') || remainder == SILENT_ACTION_SENTINEL {
                    self.buffered = remainder.trim_start().to_owned();
                    continue;
                }
            }
            if CODEX_SKILL_BUDGET_NOTICE_PREFIXES
                .iter()
                .any(|prefix| prefix.starts_with(&self.buffered))
            {
                return None;
            }
            if CODEX_SKILL_BUDGET_NOTICE_PREFIXES
                .iter()
                .any(|prefix| self.buffered.starts_with(prefix))
            {
                let suffix_start = self.buffered.find(CODEX_SKILL_BUDGET_NOTICE_SUFFIX)?;
                let remainder = self.buffered
                    [suffix_start + CODEX_SKILL_BUDGET_NOTICE_SUFFIX.len()..]
                    .to_owned();
                if remainder.is_empty() {
                    self.buffered.clear();
                    return None;
                }
                if remainder.starts_with('\n') || remainder == SILENT_ACTION_SENTINEL {
                    self.buffered = remainder.trim_start().to_owned();
                    continue;
                }
            }
            self.decided = true;
            return Some(std::mem::take(&mut self.buffered));
        }
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
        let runtime_family = std::env::var("LUCA_MANAGED_RUNTIME_FAMILY")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| {
                !value.is_empty()
                    && value.len() <= 64
                    && value.bytes().all(|byte| {
                        byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'
                    })
            })
            .ok_or_else(|| anyhow::anyhow!("managed presentation runtime family is missing"))?;
        Ok(Some(Self {
            writer: Arc::new(tokio::sync::Mutex::new(tokio::net::UnixStream::from_std(
                stream,
            )?)),
            resident_pubkey,
            session_epoch,
            runtime_family,
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
                    public_text: PublicTextStream::default(),
                    activity: ActivityLedger::default(),
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
                let update = &event.payload["params"]["update"];
                if update.get("sessionUpdate").and_then(|value| value.as_str())
                    == Some("available_commands_update")
                {
                    self.emit_capabilities(event.session_id.as_deref(), update)
                        .await;
                    return;
                }
                let Some(turn_id) = event.turn_id.as_deref() else {
                    return;
                };
                let Some(state) = turns.get_mut(turn_id) else {
                    return;
                };
                match update.get("sessionUpdate").and_then(|value| value.as_str()) {
                    Some("agent_message_chunk") => {
                        let Some(chunk) = update["content"]["text"].as_str() else {
                            return;
                        };
                        self.emit_phase(state, ManagedPresentationPhaseV1::Writing)
                            .await;
                        if let Some(public) = state.public_text.push(chunk) {
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
                    Some(marker @ ("tool_call" | "tool_call_update" | "plan")) => {
                        // Public text that resumes after this marker starts a
                        // new paragraph instead of gluing onto the sentence
                        // written before the tool call.
                        state.public_text.mark_boundary();
                        // A step the runtime named gets its own line; a plan,
                        // or a runtime that named nothing, leaves the phase
                        // word to speak for itself exactly as before.
                        let named = match marker {
                            "tool_call" => state.activity.start(update),
                            "tool_call_update" => state.activity.settle(update),
                            _ => None,
                        };
                        match named {
                            Some(activity) => {
                                self.emit_activity(
                                    state,
                                    ManagedPresentationPhaseV1::Working,
                                    activity,
                                )
                                .await;
                            }
                            None => {
                                self.emit_phase(state, ManagedPresentationPhaseV1::Working)
                                    .await;
                            }
                        }
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
                match event.payload.get("status").and_then(|value| value.as_str()) {
                    Some("completed") => {
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
                            Some(ManagedPresentationFailureV1::Publication),
                        )
                        .await;
                    }
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

    /// Emit one named step.
    ///
    /// Unlike [`Self::emit_phase`] this never dedupes: two file reads in a row
    /// are two lines even though the phase word beneath them never moved.
    async fn emit_activity(
        &self,
        state: &mut TurnState,
        phase: ManagedPresentationPhaseV1,
        activity: ManagedPresentationActivityV1,
    ) {
        state.phase = Some(phase);
        self.emit_frame(
            state,
            ManagedPresentationKindV1::Phase,
            Some(phase),
            None,
            None,
            Some(activity),
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
        self.emit_frame(state, kind, phase, public_chunk, failure, None)
            .await;
    }

    async fn emit_frame(
        &self,
        state: &mut TurnState,
        kind: ManagedPresentationKindV1,
        phase: Option<ManagedPresentationPhaseV1>,
        public_chunk: Option<String>,
        failure: Option<ManagedPresentationFailureV1>,
        activity: Option<ManagedPresentationActivityV1>,
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
            activity,
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

    async fn emit_capabilities(&self, session_id: Option<&str>, update: &serde_json::Value) {
        let mut commands = update
            .get("availableCommands")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
            .filter_map(|value| {
                let raw_name = value.get("name")?.as_str()?.trim();
                if raw_name.is_empty() {
                    return None;
                }
                let canonical_name = if raw_name.starts_with(['/', '$']) {
                    raw_name.to_owned()
                } else {
                    format!("/{raw_name}")
                };
                let description = value
                    .get("description")
                    .and_then(|item| item.as_str())
                    .unwrap_or_default()
                    .trim()
                    .to_owned();
                let input_hint = value
                    .get("inputHint")
                    .or_else(|| value.get("input_hint"))
                    .and_then(|item| item.as_str())
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
                    .map(str::to_owned);
                Some(ResidentSessionCommandV1 {
                    canonical_name,
                    description,
                    input_hint,
                })
            })
            .take(MAX_RESIDENT_SESSION_COMMANDS)
            .collect::<Vec<_>>();
        commands.sort_by(|left, right| left.canonical_name.cmp(&right.canonical_name));
        commands.dedup_by(|left, right| left.canonical_name == right.canonical_name);
        let frame = ResidentSessionCapabilityV1 {
            protocol: RESIDENT_SESSION_CAPABILITY_PROTOCOL.into(),
            resident_pubkey: self.resident_pubkey.clone(),
            runtime_family: self.runtime_family.clone(),
            runtime_version: None,
            adapter_version: None,
            session_id: session_id.map(str::to_owned),
            session_epoch: self.session_epoch,
            observed_at: chrono::Utc::now().to_rfc3339(),
            capabilities: vec![ResidentCapabilityFactV1 {
                capability_id: "runtime_commands".into(),
                provider: "runtime".into(),
                support: CapabilitySupportV1::LiveVerified,
                configuration: CapabilityConfigurationV1::Configured,
                authority: CapabilityAuthorityV1::RuntimeManaged,
                execution: CapabilityExecutionV1::Available,
                evidence_kind: "acp_available_commands_update".into(),
                reason_code: None,
            }],
            commands,
            native_task_facts: NativeTaskFactsV1 {
                root_dispatch: CapabilitySupportV1::Declared,
                child_events: CapabilitySupportV1::Unknown,
                stable_child_ids: CapabilitySupportV1::Unknown,
                root_cancel: CapabilitySupportV1::LiveVerified,
                native_visibility: CapabilitySupportV1::Unknown,
                nonpersistent_internal_sessions: CapabilitySupportV1::Discovered,
            },
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

/// Activity steps tracked for one turn before the harness stops assigning
/// ordinals. A runtime that opens more tool calls than this in a single turn
/// keeps working; its later steps simply fall back to the phase word.
const MAX_TRACKED_ACTIVITY_STEPS: usize = 256;

/// One turn's activity ledger, keyed by ACP `toolCallId` so a settling update
/// lands on the line its start frame opened instead of appending a new one.
#[derive(Default)]
struct ActivityLedger {
    next_step: u64,
    open: HashMap<String, OpenActivityStep>,
}

struct OpenActivityStep {
    step: u64,
    kind: ManagedPresentationActivityKindV1,
    label: String,
    detail: Option<String>,
}

impl ActivityLedger {
    /// Translate a `tool_call` into the step that opens its line.
    ///
    /// Returns `None` when the runtime reported nothing we can name — the
    /// caller then falls back to the phase word rather than inventing one.
    fn start(&mut self, update: &serde_json::Value) -> Option<ManagedPresentationActivityV1> {
        if self.open.len() >= MAX_TRACKED_ACTIVITY_STEPS {
            return None;
        }
        let kind = activity_kind(update);
        let detail = activity_detail(kind, update);
        let label = activity_label(kind, update, detail.as_deref())?;
        self.next_step = self.next_step.saturating_add(1);
        let step = self.next_step;
        if let Some(tool_call_id) = tool_call_id(update) {
            self.open.insert(
                tool_call_id,
                OpenActivityStep {
                    step,
                    kind,
                    label: label.clone(),
                    detail: detail.clone(),
                },
            );
        }
        Some(ManagedPresentationActivityV1 {
            label,
            kind,
            detail,
            status: Some(ManagedPresentationActivityStatusV1::Active),
            count: None,
            step: SafeU53::new(step).ok(),
        })
    }

    /// Translate a `tool_call_update` into the step that closes its line.
    ///
    /// Only a terminal status settles: an `in_progress` update carries nothing
    /// the owner has not already seen, and emitting one per update would turn
    /// a single step into a stream of identical lines.
    fn settle(&mut self, update: &serde_json::Value) -> Option<ManagedPresentationActivityV1> {
        let status = match update.get("status").and_then(serde_json::Value::as_str)? {
            "completed" => ManagedPresentationActivityStatusV1::Done,
            "failed" => ManagedPresentationActivityStatusV1::Failed,
            _ => return None,
        };
        let opened = tool_call_id(update).and_then(|id| self.open.remove(&id));
        let (step, kind, label, detail) = match opened {
            Some(opened) => (Some(opened.step), opened.kind, opened.label, opened.detail),
            // A runtime that reports the completion without a matching start
            // still gets a line, built from the update itself.
            None => {
                let kind = activity_kind(update);
                let detail = activity_detail(kind, update);
                let label = activity_label(kind, update, detail.as_deref())?;
                (None, kind, label, detail)
            }
        };
        Some(ManagedPresentationActivityV1 {
            label,
            kind,
            detail,
            status: Some(status),
            count: activity_count(update),
            step: step.and_then(|step| SafeU53::new(step).ok()),
        })
    }
}

fn tool_call_id(update: &serde_json::Value) -> Option<String> {
    let value = update.get("toolCallId")?.as_str()?;
    // Long enough for every adapter id in this tree; short enough that a
    // runtime cannot grow the per-turn ledger with the key alone.
    (!value.is_empty() && value.len() <= 128).then(|| value.to_owned())
}

/// Classify one step from what the runtime reported.
///
/// The ACP `kind` field (`read`/`edit`/`search`/`execute`/`fetch`/`think`/…)
/// is the first source. Runtimes that put a bare tool name there instead — or
/// that only report a name — are covered by the same table, which is why it
/// carries both vocabularies. Anything unrecognised is `Other`, never a guess.
fn activity_kind(update: &serde_json::Value) -> ManagedPresentationActivityKindV1 {
    for field in ["kind", "toolName", "title"] {
        let Some(text) = update.get(field).and_then(serde_json::Value::as_str) else {
            continue;
        };
        for token in tool_tokens(text) {
            if let Some(kind) = activity_kind_for_token(&token) {
                return kind;
            }
        }
    }
    ManagedPresentationActivityKindV1::Other
}

/// Reduce a runtime's tool label to the tokens worth classifying: the whole
/// normalized name first, then its trailing one or two segments, which is how
/// an MCP name (`mcp__brave__web_search`, `mcp.luca-artifacts-0a.artifact_create`)
/// gives up the leaf tool it actually is.
fn tool_tokens(value: &str) -> Vec<String> {
    let normalized: String = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '_'
            }
        })
        .collect();
    let parts: Vec<&str> = normalized
        .split('_')
        .filter(|part| !part.is_empty())
        .collect();
    let mut tokens = vec![parts.join("_")];
    if parts.len() > 2 {
        tokens.push(parts[parts.len() - 2..].join("_"));
    }
    if parts.len() > 1 {
        tokens.push(parts[parts.len() - 1].to_owned());
    }
    tokens.retain(|token| !token.is_empty());
    tokens
}

fn activity_kind_for_token(token: &str) -> Option<ManagedPresentationActivityKindV1> {
    let kind = match token {
        // ACP ToolKind, as the spec names it.
        "read" | "edit" | "delete" | "move" => ManagedPresentationActivityKindV1::File,
        "search" => ManagedPresentationActivityKindV1::Search,
        "execute" => ManagedPresentationActivityKindV1::Command,
        "fetch" => ManagedPresentationActivityKindV1::Web,
        "think" => ManagedPresentationActivityKindV1::Thinking,
        // Tool names, as the runtimes in this tree actually report them.
        "read_file" | "write_file" | "write" | "str_replace" | "str_replace_editor"
        | "apply_patch" | "edit_file" | "create_file" | "view_image" | "notebook_edit" => {
            ManagedPresentationActivityKindV1::File
        }
        "grep" | "glob" | "find" | "codebase_search" => ManagedPresentationActivityKindV1::Search,
        "shell" | "bash" | "run" | "run_command" | "terminal" | "exec" | "command" => {
            ManagedPresentationActivityKindV1::Command
        }
        "web_search" | "websearch" | "web_fetch" | "webfetch" | "browse" | "fetch_url"
        | "url_fetch" | "http_fetch" => ManagedPresentationActivityKindV1::Web,
        "reason" | "thinking" | "thought" => ManagedPresentationActivityKindV1::Thinking,
        "spawn_agent" | "delegate" | "delegation" | "subagent" | "sub_agent" | "parallel_agent"
        | "create_agent" => ManagedPresentationActivityKindV1::Delegation,
        _ => return None,
    };
    Some(kind)
}

/// The one fact about a step an owner can act on: the domain, the path, the
/// command, the pattern. Never a result, a body, or a rendered payload.
fn activity_detail(
    kind: ManagedPresentationActivityKindV1,
    update: &serde_json::Value,
) -> Option<String> {
    let raw = match kind {
        ManagedPresentationActivityKindV1::Command => first_string(
            update,
            &["/rawInput/command", "/rawInput/cmd", "/rawInput/script"],
        ),
        ManagedPresentationActivityKindV1::File => location_path(update).or_else(|| {
            first_string(
                update,
                &[
                    "/rawInput/path",
                    "/rawInput/file_path",
                    "/rawInput/filePath",
                    "/rawInput/relative_path",
                    "/rawInput/abs_path",
                    "/rawInput/notebook_path",
                ],
            )
        }),
        ManagedPresentationActivityKindV1::Web => {
            return first_string(update, &["/rawInput/url", "/rawInput/uri"])
                .as_deref()
                .and_then(bare_domain)
        }
        ManagedPresentationActivityKindV1::Search => first_string(
            update,
            &[
                "/rawInput/pattern",
                "/rawInput/query",
                "/rawInput/q",
                "/rawInput/search",
            ],
        ),
        ManagedPresentationActivityKindV1::Thinking
        | ManagedPresentationActivityKindV1::Delegation
        | ManagedPresentationActivityKindV1::Other => None,
    };
    raw.as_deref()
        .and_then(|value| bounded_text(value, MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES))
}

/// Build the bounded, display-only fields carried beside a managed permission.
///
/// The permission broker receives the same ACP `ToolCallUpdate` shape as the
/// activity feed. Reusing this projection keeps commands, paths, and domains
/// under the existing display bounds without transporting raw tool payloads.
pub(crate) fn permission_action_presentation(
    tool_call: &serde_json::Value,
) -> Option<(String, Option<String>)> {
    if let Some(presentation) = permission_mcp_action_presentation(tool_call) {
        return Some(presentation);
    }
    let kind = activity_kind(tool_call);
    let detail = activity_detail(kind, tool_call).or_else(|| match kind {
        ManagedPresentationActivityKindV1::File => typed_diff_path_detail(tool_call),
        _ => None,
    });
    let title = activity_label(kind, tool_call, detail.as_deref())?;
    Some((title, detail))
}

const MAX_PERMISSION_MCP_IDENTIFIER_BYTES: usize = 128;

/// Project the typed MCP envelope used by Codex tool approvals without
/// carrying the argument object into the permission channel.
fn permission_mcp_action_presentation(
    tool_call: &serde_json::Value,
) -> Option<(String, Option<String>)> {
    if !tool_call.pointer("/_meta/is_mcp_tool_call")?.as_bool()? {
        return None;
    }
    let raw_input = tool_call.get("rawInput")?.as_object()?;
    let server = permission_mcp_identifier(raw_input.get("server")?)?;
    let tool = permission_mcp_identifier(raw_input.get("tool")?)?;
    let arguments = raw_input.get("arguments")?.as_object()?;
    let identity = bounded_text(
        &format!("{server}.{tool}"),
        MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES,
    )?;

    if server == "luca-repositories" && tool == "propose_resident" {
        let mut preview = identity;
        if let Some(runtime) = arguments
            .get("runtime_family")
            .and_then(valid_resident_runtime_family)
        {
            preview.push_str(" · runtime ");
            preview.push_str(runtime);
        }
        if let Some(intent) = arguments
            .get("provisioning_intent")
            .and_then(valid_resident_provisioning_intent)
        {
            preview.push_str(" · intent ");
            preview.push_str(intent);
        }
        if let Some(profile) = arguments
            .get("native_profile_name")
            .and_then(valid_native_profile_slug)
        {
            preview.push_str(" · profile ");
            preview.push_str(profile);
        }
        return Some((
            "Prepare resident setup review".to_owned(),
            bounded_text(&preview, MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES),
        ));
    }

    Some(("Use MCP tool".to_owned(), Some(identity)))
}

fn permission_mcp_identifier(value: &serde_json::Value) -> Option<&str> {
    let value = value.as_str()?;
    (!value.is_empty()
        && value.len() <= MAX_PERMISSION_MCP_IDENTIFIER_BYTES
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'-' | b'_' | b'.'))
        }))
    .then_some(value)
}

fn valid_resident_runtime_family(value: &serde_json::Value) -> Option<&str> {
    value
        .as_str()
        .filter(|value| matches!(*value, "codex" | "claude_code" | "hermes" | "openclaw"))
}

fn valid_resident_provisioning_intent(value: &serde_json::Value) -> Option<&str> {
    value
        .as_str()
        .filter(|value| matches!(*value, "fresh" | "template" | "advanced" | "import"))
}

fn valid_native_profile_slug(value: &serde_json::Value) -> Option<&str> {
    let value = value.as_str()?;
    (!value.is_empty()
        && value.len() <= 64
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || (index > 0 && matches!(byte, b'_' | b'-'))
        }))
    .then_some(value)
}

/// Extract only ACP's typed diff paths. Diff bodies and arbitrary content
/// blocks are deliberately ignored by the permission surface.
fn typed_diff_path_detail(tool_call: &serde_json::Value) -> Option<String> {
    let diffs = tool_call.get("content")?.as_array()?;
    let mut paths = diffs.iter().filter_map(|content| {
        if content.get("type").and_then(serde_json::Value::as_str) != Some("diff") {
            return None;
        }
        content.get("path")?.as_str()
    });
    let first = paths.next()?;
    let additional = paths.count();
    if additional == 0 {
        return bounded_text(first, MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES);
    }
    let suffix = if additional == 1 {
        " (+1 file)".to_owned()
    } else {
        format!(" (+{additional} files)")
    };
    let path = bounded_text(
        first,
        MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES.saturating_sub(suffix.len()),
    )?;
    Some(format!("{path}{suffix}"))
}

/// The guard's pre-scrub COUNT: computed from the original update so the
/// sanitizer can carry it after rawOutput is stripped. A count is the one
/// piece of step texture safe to carry through the artifact guard — a
/// number cannot smuggle content the way any free-text detail could (the
/// shell-spoof test is the contract). Guarded steps therefore keep their
/// generic label plus a count; full details remain for unguarded turns,
/// where the ledger reads the raw fields directly.
pub(crate) fn public_activity_count(update: &serde_json::Value) -> Option<u64> {
    activity_count(update).map(SafeU53::get)
}

fn first_string(update: &serde_json::Value, pointers: &[&str]) -> Option<String> {
    pointers.iter().find_map(|pointer| {
        update
            .pointer(pointer)
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned)
    })
}

/// ACP reports the files a tool touches as `locations`; the first is the one
/// the step is about.
fn location_path(update: &serde_json::Value) -> Option<String> {
    update
        .pointer("/locations/0/path")
        .and_then(serde_json::Value::as_str)
        .map(ToOwned::to_owned)
}

/// Reduce a URL to its bare host.
///
/// The domain is what an owner reads; the path and query are where a payload
/// (or a token in a query string) would hide. Userinfo is dropped outright —
/// `https://user:secret@host` must never reach the surface as credentials.
fn bare_domain(value: &str) -> Option<String> {
    let rest = value
        .trim()
        .strip_prefix("https://")
        .or_else(|| value.trim().strip_prefix("http://"))?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority
        .rsplit_once('@')
        .map_or(authority, |(_, after)| after);
    let host = host.split(':').next()?;
    (!host.is_empty()
        && host.len() <= 255
        && host
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-')))
    .then(|| host.to_ascii_lowercase())
}

/// The sentence the owner reads.
///
/// A runtime that already writes a human title keeps it — that is the ACP
/// field's whole purpose. Runtimes that report a bare tool name (`read_file`,
/// `shell`) get a sentence built from the kind and the detail instead, so the
/// surface reads the same whichever runtime answered.
fn activity_label(
    kind: ManagedPresentationActivityKindV1,
    update: &serde_json::Value,
    detail: Option<&str>,
) -> Option<String> {
    let title = update
        .get("title")
        .and_then(serde_json::Value::as_str)
        .and_then(|title| bounded_text(title, MAX_MANAGED_PRESENTATION_ACTIVITY_LABEL_BYTES));
    // A title with a space is prose the runtime wrote; a single token is the
    // tool's identifier wearing the title's clothes.
    if let Some(title) = title.as_deref().filter(|title| title.contains(' ')) {
        return Some(title.to_owned());
    }
    let sentence = match kind {
        ManagedPresentationActivityKindV1::File => {
            let verb = if is_write_token(update) {
                "Editing"
            } else {
                "Reading"
            };
            match detail.and_then(file_name) {
                Some(name) => format!("{verb} {name}"),
                None => format!("{verb} a file"),
            }
        }
        ManagedPresentationActivityKindV1::Command => match detail {
            Some(command) => format!("Running {command}"),
            None => "Running a command".to_owned(),
        },
        ManagedPresentationActivityKindV1::Search => match detail {
            Some(pattern) => format!("Searching for {pattern}"),
            None => "Searching".to_owned(),
        },
        ManagedPresentationActivityKindV1::Web => match detail {
            Some(domain) => format!("Reading {domain}"),
            None => "Searching the web".to_owned(),
        },
        ManagedPresentationActivityKindV1::Thinking => "Thinking".to_owned(),
        ManagedPresentationActivityKindV1::Delegation => "Delegating work".to_owned(),
        // Nothing was recognised and the runtime wrote no prose. A bare tool
        // name is better than a phase word, but an empty title is not.
        ManagedPresentationActivityKindV1::Other => title?,
    };
    bounded_text(&sentence, MAX_MANAGED_PRESENTATION_ACTIVITY_LABEL_BYTES)
}

fn is_write_token(update: &serde_json::Value) -> bool {
    for field in ["kind", "toolName", "title"] {
        let Some(text) = update.get(field).and_then(serde_json::Value::as_str) else {
            continue;
        };
        if tool_tokens(text).iter().any(|token| {
            matches!(
                token.as_str(),
                "edit"
                    | "delete"
                    | "move"
                    | "write"
                    | "write_file"
                    | "edit_file"
                    | "create_file"
                    | "str_replace"
                    | "str_replace_editor"
                    | "apply_patch"
                    | "notebook_edit"
            )
        }) {
            return true;
        }
    }
    false
}

fn file_name(path: &str) -> Option<String> {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    (!name.is_empty()).then(|| name.to_owned())
}

/// A count only when the runtime reported one. Nothing here counts content
/// blocks or output lines — an invented number reads exactly like a real one.
fn activity_count(update: &serde_json::Value) -> Option<SafeU53> {
    for pointer in [
        "/rawOutput/count",
        "/rawOutput/total",
        "/rawOutput/matches",
        "/rawOutput/resultCount",
    ] {
        if let Some(count) = update.pointer(pointer).and_then(serde_json::Value::as_u64) {
            return SafeU53::new(count).ok();
        }
    }
    for pointer in [
        "/rawOutput/results",
        "/rawOutput/files",
        "/rawOutput/matches",
    ] {
        if let Some(values) = update
            .pointer(pointer)
            .and_then(serde_json::Value::as_array)
        {
            return SafeU53::new(values.len() as u64).ok();
        }
    }
    // Sanitized frames carry the guard's pre-scrub count at the top level.
    if let Some(count) = update.pointer("/count").and_then(serde_json::Value::as_u64) {
        return SafeU53::new(count).ok();
    }
    None
}

/// Collapse whitespace, refuse anything that could rewrite the line it renders
/// on, and clip to the protocol's bound with a visible cut.
///
/// The protocol validates the same rule and would drop the whole frame; doing
/// it here costs only the activity, so a noisy title never loses the turn.
fn bounded_text(value: &str, max_bytes: usize) -> Option<String> {
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty()
        || collapsed.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '\u{2028}' | '\u{2029}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'
                )
        })
    {
        return None;
    }
    if collapsed.len() <= max_bytes {
        return Some(collapsed);
    }
    const ELLIPSIS: &str = "…";
    let mut end = max_bytes.saturating_sub(ELLIPSIS.len());
    while end > 0 && !collapsed.is_char_boundary(end) {
        end -= 1;
    }
    (end > 0).then(|| format!("{}{ELLIPSIS}", &collapsed[..end]))
}

#[cfg(test)]
mod tests {

    #[test]
    fn activity_count_accepts_the_guards_presummarized_count() {
        let update = serde_json::json!({ "count": 12 });
        assert_eq!(activity_count(&update).map(SafeU53::get), Some(12));
    }

    #[test]
    fn public_activity_count_carries_numbers_and_nothing_else() {
        let update = serde_json::json!({
            "kind": "search",
            "rawInput": { "query": "PRIVATE_SENTINEL" },
            "rawOutput": { "results": [1, 2, 3] },
        });
        assert_eq!(public_activity_count(&update), Some(3));
    }
    use super::*;
    use crate::luca_final_publisher::FinalChunkAccumulator;

    /// The only two `session/update` kinds that carry public-text ordering.
    #[derive(Clone, Copy)]
    enum PublicUpdate<'a> {
        AgentMessageChunk(&'a str),
        ToolCallOrPlan,
    }

    /// Text the desktop reconstructs from the streamed `PublicChunk` frames.
    fn streamed_text(updates: &[PublicUpdate<'_>]) -> String {
        let mut stream = PublicTextStream::default();
        let mut streamed = String::new();
        for update in updates {
            match update {
                PublicUpdate::AgentMessageChunk(chunk) => {
                    if let Some(public) = stream.push(chunk) {
                        for part in bounded_chunks(&public) {
                            streamed.push_str(&part);
                        }
                    }
                }
                PublicUpdate::ToolCallOrPlan => stream.mark_boundary(),
            }
        }
        streamed
    }

    /// Text the harness hands to the signing broker for the same updates.
    fn signed_final_text(updates: &[PublicUpdate<'_>]) -> String {
        let mut chunks = FinalChunkAccumulator::default();
        for update in updates {
            match update {
                PublicUpdate::AgentMessageChunk(chunk) => {
                    chunks.push_agent_message_chunk(chunk).expect("chunk")
                }
                PublicUpdate::ToolCallOrPlan => chunks.mark_public_text_boundary(),
            }
        }
        chunks.finish(false).expect("final draft")
    }

    #[test]
    fn text_resumed_after_a_tool_call_streams_as_a_new_paragraph() {
        let updates = [
            PublicUpdate::AgentMessageChunk("I'm checking the live local time."),
            PublicUpdate::ToolCallOrPlan,
            PublicUpdate::ToolCallOrPlan,
            PublicUpdate::AgentMessageChunk("It's 3:55 AM CDT for me."),
        ];
        assert_eq!(
            streamed_text(&updates),
            "I'm checking the live local time.\n\nIt's 3:55 AM CDT for me."
        );
    }

    #[test]
    fn streamed_and_signed_text_stay_identical_across_boundaries() {
        for updates in [
            vec![
                PublicUpdate::AgentMessageChunk("I'm checking the live local time."),
                PublicUpdate::ToolCallOrPlan,
                PublicUpdate::AgentMessageChunk("It's 3:55 AM CDT for me."),
            ],
            vec![
                PublicUpdate::AgentMessageChunk("Streaming "),
                PublicUpdate::AgentMessageChunk("one message."),
            ],
            vec![
                PublicUpdate::AgentMessageChunk("Checking.\n"),
                PublicUpdate::ToolCallOrPlan,
                PublicUpdate::AgentMessageChunk("Done."),
            ],
            vec![
                PublicUpdate::AgentMessageChunk("Checking."),
                PublicUpdate::ToolCallOrPlan,
                PublicUpdate::AgentMessageChunk("\n\nDone."),
            ],
            vec![
                PublicUpdate::ToolCallOrPlan,
                PublicUpdate::AgentMessageChunk("Only text, after a tool call."),
            ],
            vec![
                PublicUpdate::AgentMessageChunk(CODEX_SKILL_CONTEXT_NOTICE),
                PublicUpdate::ToolCallOrPlan,
                PublicUpdate::AgentMessageChunk("The useful answer."),
            ],
            vec![
                PublicUpdate::AgentMessageChunk("Looking."),
                PublicUpdate::ToolCallOrPlan,
                PublicUpdate::AgentMessageChunk("Still looking."),
                PublicUpdate::ToolCallOrPlan,
                PublicUpdate::ToolCallOrPlan,
                PublicUpdate::AgentMessageChunk("Found "),
                PublicUpdate::AgentMessageChunk("it."),
            ],
        ] {
            assert_eq!(
                streamed_text(&updates),
                signed_final_text(&updates),
                "streamed text must equal the signed final draft"
            );
        }
    }

    #[test]
    fn a_boundary_before_the_silent_marker_never_streams_public_text() {
        let updates = [
            PublicUpdate::ToolCallOrPlan,
            PublicUpdate::AgentMessageChunk(SILENT_ACTION_SENTINEL),
        ];
        assert_eq!(streamed_text(&updates), "");
        assert_eq!(signed_final_text(&updates), SILENT_ACTION_SENTINEL);
    }

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
    fn silent_action_marker_is_never_exposed_as_public_text() {
        let mut gate = RuntimeNoticeGate::default();
        let split = SILENT_ACTION_SENTINEL.len() / 2;
        assert_eq!(gate.push(&SILENT_ACTION_SENTINEL[..split]), None);
        assert_eq!(gate.push(&SILENT_ACTION_SENTINEL[split..]), None);
    }

    #[test]
    fn variable_skill_budget_notice_then_silent_marker_are_both_suppressed() {
        let mut gate = RuntimeNoticeGate::default();
        assert_eq!(
            gate.push("Warning: Exceeded skills context budget of 2%. All skill descriptions were removed and 1 additional skill was not included in the model-visible skills list."),
            None
        );
        assert_eq!(gate.push(SILENT_ACTION_SENTINEL), None);
    }

    #[test]
    fn current_skill_budget_notice_is_suppressed_across_split_chunks() {
        let notice = "Warning: Exceeded skills context budget. All skill descriptions were removed and 44 additional skills were not included in the model-visible skills list.";
        let mut gate = RuntimeNoticeGate::default();
        assert_eq!(gate.push(&notice[..47]), None);
        assert_eq!(gate.push(&notice[47..103]), None);
        assert_eq!(
            gate.push(&format!("{}\n\nThe useful answer.", &notice[103..])),
            Some("The useful answer.".into())
        );
    }

    // ── Rich activity ────────────────────────────────────────────────────
    //
    // The fixtures below are the shapes this tree's runtimes actually put on
    // the wire, plus the reduced shape the artifact guard leaves behind. A
    // runtime that reports none of them must produce no activity at all.

    fn frame_with(activity: Option<ManagedPresentationActivityV1>) -> ManagedPresentationFrameV1 {
        ManagedPresentationFrameV1 {
            protocol: MANAGED_PRESENTATION_PROTOCOL.into(),
            kind: ManagedPresentationKindV1::Phase,
            resident_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
            conversation_id: OpaqueId::parse("conversation-1").unwrap(),
            turn_id: OpaqueId::parse("turn-1").unwrap(),
            dispatch_receipt_id: OpaqueId::parse("22".repeat(32)).unwrap(),
            session_epoch: SafeU53::new(7).unwrap(),
            sequence: SafeU53::new(1).unwrap(),
            phase: Some(ManagedPresentationPhaseV1::Working),
            public_chunk: None,
            failure: None,
            activity,
        }
    }

    #[test]
    fn a_shell_tool_call_becomes_a_command_step() {
        let mut ledger = ActivityLedger::default();
        let activity = ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "call-shell-rg",
                "status": "executing",
                "title": "shell",
                "kind": "shell",
                "rawInput": {"command": "rg -n \"get_event\" desktop/src"},
            }))
            .expect("a named step");
        assert_eq!(activity.kind, ManagedPresentationActivityKindV1::Command);
        assert_eq!(
            activity.detail.as_deref(),
            Some("rg -n \"get_event\" desktop/src")
        );
        assert_eq!(activity.label, "Running rg -n \"get_event\" desktop/src");
        assert_eq!(
            activity.status,
            Some(ManagedPresentationActivityStatusV1::Active)
        );
        assert_eq!(activity.step.map(SafeU53::get), Some(1));
        assert_eq!(frame_with(Some(activity)).validate(), Ok(()));
    }

    #[test]
    fn permission_preview_is_visibly_clipped_to_the_existing_bound() {
        let command = "x".repeat(MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES + 80);
        let tool_call = serde_json::json!({
            "toolCallId": "call-long-command",
            "title": "shell",
            "kind": "execute",
            "rawInput": {"command": command},
        });
        let (_, preview) = permission_action_presentation(&tool_call).expect("safe presentation");
        let preview = preview.expect("command preview");
        assert_eq!(
            preview.len(),
            MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES
        );
        assert!(preview.ends_with('…'));
    }

    #[test]
    fn permission_preview_projects_only_typed_mcp_identity_and_safe_resident_selectors() {
        let tool_call = serde_json::json!({
            "toolCallId": "exec-f9df6f9e-3990-4f73-b0c3-4b7a7a9ddd21",
            "title": "mcp.luca-repositories.propose_resident",
            "kind": "execute",
            "status": "in_progress",
            "rawInput": {
                "server": "luca-repositories",
                "tool": "propose_resident",
                "arguments": {
                    "runtime_family": "hermes",
                    "provisioning_intent": "import",
                    "native_profile_name": "luca-qa-hermes-20260905-continuation",
                    "system_prompt": "PRIVATE_INSTRUCTIONS",
                    "credential": "PRIVATE_CREDENTIAL",
                    "script": "PRIVATE_SCRIPT"
                }
            },
            "rawOutput": {"body": "PRIVATE_OUTPUT"},
            "_meta": {"is_mcp_tool_call": true}
        });
        let presentation = permission_action_presentation(&tool_call).expect("MCP presentation");
        assert_eq!(presentation.0, "Prepare resident setup review");
        assert_eq!(
            presentation.1.as_deref(),
            Some("luca-repositories.propose_resident · runtime hermes · intent import · profile luca-qa-hermes-20260905-continuation")
        );
        let encoded = format!("{presentation:?}");
        for private in [
            "PRIVATE_INSTRUCTIONS",
            "PRIVATE_CREDENTIAL",
            "PRIVATE_SCRIPT",
            "PRIVATE_OUTPUT",
        ] {
            assert!(!encoded.contains(private));
        }
    }

    #[test]
    fn permission_mcp_projection_requires_marker_and_valid_typed_envelope() {
        let base = serde_json::json!({
            "kind": "execute",
            "rawInput": {
                "server": "example-server",
                "tool": "safe_tool",
                "arguments": {"private": "PRIVATE_BODY"}
            },
            "_meta": {"is_mcp_tool_call": true}
        });
        assert_eq!(
            permission_mcp_action_presentation(&base),
            Some((
                "Use MCP tool".into(),
                Some("example-server.safe_tool".into())
            ))
        );

        for pointer in ["/_meta", "/rawInput/arguments"] {
            let mut malformed = base.clone();
            *malformed.pointer_mut(pointer).unwrap() = serde_json::Value::Null;
            assert!(permission_mcp_action_presentation(&malformed).is_none());
        }
        for (field, value) in [
            ("server", ".bad-server".to_owned()),
            ("tool", "x".repeat(MAX_PERMISSION_MCP_IDENTIFIER_BYTES + 1)),
        ] {
            let mut malformed = base.clone();
            malformed["rawInput"][field] = serde_json::json!(value);
            assert!(permission_mcp_action_presentation(&malformed).is_none());
        }
    }

    #[test]
    fn malformed_resident_selectors_are_omitted_from_mcp_preview() {
        let tool_call = serde_json::json!({
            "kind": "execute",
            "rawInput": {
                "server": "luca-repositories",
                "tool": "propose_resident",
                "arguments": {
                    "runtime_family": "shell",
                    "provisioning_intent": "overwrite",
                    "native_profile_name": "X".repeat(65),
                    "other": "PRIVATE_BODY"
                }
            },
            "_meta": {"is_mcp_tool_call": true}
        });
        let presentation = permission_mcp_action_presentation(&tool_call).expect("safe identity");
        assert_eq!(presentation.0, "Prepare resident setup review");
        assert_eq!(
            presentation.1.as_deref(),
            Some("luca-repositories.propose_resident")
        );
        assert!(!format!("{presentation:?}").contains("PRIVATE_BODY"));
    }

    #[test]
    fn permission_preview_uses_only_typed_diff_paths() {
        let tool_call = serde_json::json!({
            "toolCallId": "call-file-change",
            "title": "Editing files",
            "kind": "edit",
            "content": [
                {
                    "type": "diff",
                    "path": "src/first.rs",
                    "oldText": "PRIVATE_OLD_BODY",
                    "newText": "PRIVATE_NEW_BODY"
                },
                {"type": "diff", "path": "src/second.rs"},
                {"type": "text", "path": "spoofed.rs", "text": "PRIVATE_TEXT_BODY"}
            ]
        });
        let presentation = permission_action_presentation(&tool_call).expect("safe presentation");
        assert_eq!(presentation.0, "Editing files");
        assert_eq!(presentation.1.as_deref(), Some("src/first.rs (+1 file)"));
        let encoded = format!("{presentation:?}");
        assert!(!encoded.contains("PRIVATE_OLD_BODY"));
        assert!(!encoded.contains("PRIVATE_NEW_BODY"));
        assert!(!encoded.contains("PRIVATE_TEXT_BODY"));
        assert!(!encoded.contains("spoofed.rs"));
    }

    #[test]
    fn a_file_read_names_the_file_from_acp_locations() {
        let mut ledger = ActivityLedger::default();
        let activity = ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "call-read",
                "title": "Read",
                "kind": "read",
                "locations": [{"path": "desktop/src/styles/conversation-shell.css"}],
            }))
            .expect("a named step");
        assert_eq!(activity.kind, ManagedPresentationActivityKindV1::File);
        assert_eq!(activity.label, "Reading conversation-shell.css");
        assert_eq!(
            activity.detail.as_deref(),
            Some("desktop/src/styles/conversation-shell.css")
        );
    }

    #[test]
    fn a_write_tool_reads_as_editing_not_reading() {
        let mut ledger = ActivityLedger::default();
        let activity = ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "call-edit",
                "title": "str_replace",
                "kind": "edit",
                "rawInput": {"path": "crates/buzz-acp/src/managed_presentation.rs"},
            }))
            .expect("a named step");
        assert_eq!(activity.label, "Editing managed_presentation.rs");
    }

    #[test]
    fn a_web_fetch_carries_the_bare_domain_and_never_the_url() {
        let mut ledger = ActivityLedger::default();
        let activity = ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "call-fetch",
                "title": "web_fetch",
                "kind": "fetch",
                "rawInput": {"url": "https://user:s3cret@NodeJS.org:443/api/fs.html?token=abc#frag"},
            }))
            .expect("a named step");
        assert_eq!(activity.kind, ManagedPresentationActivityKindV1::Web);
        assert_eq!(activity.detail.as_deref(), Some("nodejs.org"));
        assert_eq!(activity.label, "Reading nodejs.org");
    }

    #[test]
    fn a_web_search_without_a_url_still_reads_as_the_web() {
        let mut ledger = ActivityLedger::default();
        let activity = ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "call-search",
                "title": "mcp__brave__web_search",
                "rawInput": {"query": "acp tool call schema"},
            }))
            .expect("a named step");
        assert_eq!(activity.kind, ManagedPresentationActivityKindV1::Web);
        assert_eq!(activity.detail, None);
        assert_eq!(activity.label, "Searching the web");
    }

    #[test]
    fn a_grep_names_the_pattern_it_searched_for() {
        let mut ledger = ActivityLedger::default();
        let activity = ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "call-grep",
                "title": "grep",
                "rawInput": {"pattern": "emit_phase"},
            }))
            .expect("a named step");
        assert_eq!(activity.kind, ManagedPresentationActivityKindV1::Search);
        assert_eq!(activity.label, "Searching for emit_phase");
    }

    #[test]
    fn a_runtime_written_title_survives_verbatim() {
        let mut ledger = ActivityLedger::default();
        let activity = ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "call-prose",
                "title": "Reading the conversation shell stylesheet",
                "kind": "read",
            }))
            .expect("a named step");
        assert_eq!(activity.label, "Reading the conversation shell stylesheet");
    }

    #[test]
    fn the_artifact_guarded_shape_still_names_the_step() {
        // With the artifact guard active the observer strips rawInput and
        // locations; title / kind / status are all that survive.
        let mut ledger = ActivityLedger::default();
        let activity = ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "call-artifact",
                "title": "artifact_create",
                "kind": "other",
                "status": "pending",
                "bodyRedacted": true,
            }))
            .expect("a named step");
        assert_eq!(activity.kind, ManagedPresentationActivityKindV1::Other);
        assert_eq!(activity.label, "artifact_create");
        assert_eq!(activity.detail, None);
    }

    #[test]
    fn a_step_the_runtime_did_not_name_produces_nothing() {
        let mut ledger = ActivityLedger::default();
        assert!(ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "call-anonymous",
            }))
            .is_none());
        assert!(ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "call-blank",
                "title": "   ",
            }))
            .is_none());
    }

    #[test]
    fn a_completion_settles_the_line_its_start_opened() {
        let mut ledger = ActivityLedger::default();
        let start = ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "call-1",
                "title": "grep",
                "rawInput": {"pattern": "emit_phase"},
            }))
            .expect("a named step");
        let settled = ledger
            .settle(&serde_json::json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": "call-1",
                "status": "completed",
                "rawOutput": {"count": 3},
            }))
            .expect("a settling step");
        assert_eq!(settled.step, start.step);
        assert_eq!(settled.label, start.label);
        assert_eq!(settled.kind, start.kind);
        assert_eq!(
            settled.status,
            Some(ManagedPresentationActivityStatusV1::Done)
        );
        assert_eq!(settled.count.map(SafeU53::get), Some(3));
    }

    #[test]
    fn a_failed_completion_settles_as_failed() {
        let mut ledger = ActivityLedger::default();
        ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call", "toolCallId": "call-1",
                "title": "shell", "rawInput": {"command": "pnpm test"},
            }))
            .expect("a named step");
        let settled = ledger
            .settle(&serde_json::json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": "call-1",
                "status": "failed",
            }))
            .expect("a settling step");
        assert_eq!(
            settled.status,
            Some(ManagedPresentationActivityStatusV1::Failed)
        );
        assert_eq!(settled.count, None);
        assert_eq!(settled.label, "Running pnpm test");
    }

    #[test]
    fn an_in_progress_update_settles_nothing() {
        let mut ledger = ActivityLedger::default();
        ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call", "toolCallId": "call-1",
                "title": "shell", "rawInput": {"command": "pnpm test"},
            }))
            .expect("a named step");
        for status in ["pending", "in_progress", "executing"] {
            assert!(ledger
                .settle(&serde_json::json!({
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": "call-1",
                    "status": status,
                }))
                .is_none());
        }
    }

    #[test]
    fn a_completion_without_a_matching_start_still_gets_a_line() {
        let mut ledger = ActivityLedger::default();
        let settled = ledger
            .settle(&serde_json::json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": "orphan",
                "status": "completed",
                "title": "shell",
                "rawInput": {"command": "pnpm test"},
            }))
            .expect("a settling step");
        assert_eq!(settled.step, None);
        assert_eq!(settled.label, "Running pnpm test");
    }

    #[test]
    fn steps_number_in_the_order_the_runtime_opened_them() {
        let mut ledger = ActivityLedger::default();
        let mut steps = Vec::new();
        for (index, command) in ["pnpm test", "cargo test", "just ci"].iter().enumerate() {
            let activity = ledger
                .start(&serde_json::json!({
                    "sessionUpdate": "tool_call",
                    "toolCallId": format!("call-{index}"),
                    "title": "shell",
                    "rawInput": {"command": command},
                }))
                .expect("a named step");
            steps.push(activity.step.map(SafeU53::get));
        }
        assert_eq!(steps, vec![Some(1), Some(2), Some(3)]);
    }

    #[test]
    fn the_ledger_stops_growing_after_its_cap() {
        let mut ledger = ActivityLedger::default();
        for index in 0..MAX_TRACKED_ACTIVITY_STEPS {
            assert!(ledger
                .start(&serde_json::json!({
                    "sessionUpdate": "tool_call",
                    "toolCallId": format!("call-{index}"),
                    "title": "shell",
                    "rawInput": {"command": "pnpm test"},
                }))
                .is_some());
        }
        assert!(ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "one-too-many",
                "title": "shell",
                "rawInput": {"command": "pnpm test"},
            }))
            .is_none());
    }

    #[test]
    fn an_over_long_command_is_clipped_visibly_and_still_validates() {
        let mut ledger = ActivityLedger::default();
        let command = "echo ".to_owned() + &"x".repeat(4_000);
        let activity = ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "call-long",
                "title": "shell",
                "rawInput": {"command": command},
            }))
            .expect("a named step");
        let detail = activity.detail.clone().expect("a clipped command");
        assert!(detail.len() <= MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES);
        assert!(detail.ends_with('…'), "a clipped command must show the cut");
        assert!(activity.label.len() <= MAX_MANAGED_PRESENTATION_ACTIVITY_LABEL_BYTES);
        assert_eq!(frame_with(Some(activity)).validate(), Ok(()));
    }

    #[test]
    fn a_multi_line_title_collapses_instead_of_losing_the_frame() {
        let mut ledger = ActivityLedger::default();
        let activity = ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "call-noisy",
                "title": "Reading the shell\n\tstylesheet",
                "kind": "read",
            }))
            .expect("a named step");
        assert_eq!(activity.label, "Reading the shell stylesheet");
        assert_eq!(frame_with(Some(activity)).validate(), Ok(()));
    }

    #[test]
    fn a_bidi_override_in_a_title_costs_the_activity_not_the_turn() {
        let mut ledger = ActivityLedger::default();
        assert!(ledger
            .start(&serde_json::json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "call-bidi",
                "title": "Reading \u{202e}sdrawkcab",
            }))
            .is_none());
        assert_eq!(frame_with(None).validate(), Ok(()));
    }

    #[test]
    fn only_a_reported_count_becomes_a_count() {
        assert_eq!(
            activity_count(&serde_json::json!({
                "rawOutput": {"results": [1, 2, 3, 4]},
            }))
            .map(SafeU53::get),
            Some(4)
        );
        // Content blocks and output text are not a result count; inventing one
        // reads exactly like a real one.
        assert_eq!(
            activity_count(&serde_json::json!({
                "content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}],
                "rawOutput": "three\nlines\nhere",
            })),
            None
        );
    }

    /// Drive the real ingest path over a real socket: the ledger is only half
    /// the story, and a wiring mistake between the two would be invisible to
    /// every test above.
    #[cfg(unix)]
    #[tokio::test]
    async fn the_ingest_path_streams_one_activity_frame_per_named_step() {
        use tokio::io::AsyncReadExt;

        let (desktop, harness) = std::os::unix::net::UnixStream::pair().expect("socketpair");
        desktop.set_nonblocking(true).expect("nonblocking");
        harness.set_nonblocking(true).expect("nonblocking");
        let publisher = ManagedPresentationPublisher {
            writer: Arc::new(tokio::sync::Mutex::new(
                tokio::net::UnixStream::from_std(harness).expect("harness end"),
            )),
            resident_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
            session_epoch: SafeU53::new(7).unwrap(),
            runtime_family: "codex".into(),
        };

        fn observer_event(kind: &str, payload: serde_json::Value) -> ObserverEvent {
            ObserverEvent {
                seq: 1,
                timestamp: "1970-01-01T00:00:00Z".into(),
                kind: kind.into(),
                agent_index: None,
                channel_id: Some("conversation-1".into()),
                session_id: None,
                turn_id: Some("turn-1".into()),
                started_at: None,
                payload,
            }
        }

        fn acp_read(update: serde_json::Value) -> ObserverEvent {
            observer_event(
                "acp_read",
                serde_json::json!({"params": {"update": update}}),
            )
        }

        let mut turns = HashMap::new();
        publisher
            .ingest(
                observer_event(
                    "turn_started",
                    serde_json::json!({"managedDispatchReceiptId": "22".repeat(32)}),
                ),
                &mut turns,
            )
            .await;
        for update in [
            serde_json::json!({
                "sessionUpdate": "tool_call", "toolCallId": "call-1",
                "title": "shell", "rawInput": {"command": "pnpm test"},
            }),
            // A plan is not a step: it must leave the phase word alone.
            serde_json::json!({"sessionUpdate": "plan"}),
            serde_json::json!({
                "sessionUpdate": "tool_call_update", "toolCallId": "call-1",
                "status": "completed", "rawOutput": {"count": 2},
            }),
        ] {
            publisher.ingest(acp_read(update), &mut turns).await;
        }
        drop(publisher);

        let mut desktop = tokio::net::UnixStream::from_std(desktop).expect("desktop end");
        let mut raw = Vec::new();
        desktop.read_to_end(&mut raw).await.expect("frames");
        let frames: Vec<ManagedPresentationFrameV1> = String::from_utf8(raw)
            .expect("utf8")
            .lines()
            .map(|line| serde_json::from_str(line).expect("a valid frame"))
            .collect();

        // turn_started, the opening Thinking phase, then exactly two activity
        // frames — the plan in between adds none.
        assert_eq!(frames.len(), 4, "frames: {frames:?}");
        assert_eq!(frames[0].kind, ManagedPresentationKindV1::TurnStarted);
        assert_eq!(frames[1].phase, Some(ManagedPresentationPhaseV1::Thinking));
        assert!(frames[1].activity.is_none());

        let start = frames[2].activity.as_ref().expect("the opening step");
        assert_eq!(frames[2].kind, ManagedPresentationKindV1::Phase);
        assert_eq!(frames[2].phase, Some(ManagedPresentationPhaseV1::Working));
        assert_eq!(start.label, "Running pnpm test");
        assert_eq!(start.kind, ManagedPresentationActivityKindV1::Command);
        assert_eq!(
            start.status,
            Some(ManagedPresentationActivityStatusV1::Active)
        );
        assert_eq!(start.step.map(SafeU53::get), Some(1));

        let settled = frames[3].activity.as_ref().expect("the settling step");
        assert_eq!(
            settled.status,
            Some(ManagedPresentationActivityStatusV1::Done)
        );
        assert_eq!(settled.count.map(SafeU53::get), Some(2));
        assert_eq!(settled.step, start.step);

        for (index, frame) in frames.iter().enumerate() {
            assert_eq!(frame.validate(), Ok(()));
            assert_eq!(frame.sequence.get(), index as u64 + 1);
        }
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
