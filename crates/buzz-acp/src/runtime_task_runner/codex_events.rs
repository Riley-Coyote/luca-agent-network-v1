//! Body-free progress and exact-ID terminal evidence from public Codex JSONL.

use serde::Deserialize;

pub(super) const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_STREAM_BYTES: usize = 8 * 1024 * 1024;
const MAX_EVENTS: usize = 16_384;
const MAX_RESULT_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum NativeFailure {
    InvalidTarget,
    UnsupportedArguments,
    Isolation,
    Spawn,
    Protocol,
    SessionMismatch,
    Provider,
    MissingCompletion,
    OutputBound,
    Timeout,
    Interrupted,
    Exit,
}

impl NativeFailure {
    pub(super) fn message(self) -> &'static str {
        match self {
            Self::InvalidTarget => "The saved native session target could not be verified.",
            Self::UnsupportedArguments => {
                "Native continuation cannot apply adapter or permission overrides."
            }
            Self::Isolation => "The native worker could not be isolated from resident authority.",
            Self::Spawn => "The native Codex worker could not start.",
            Self::Protocol => "The native Codex event stream could not be verified.",
            Self::SessionMismatch => {
                "Codex returned a different native session; the continuation was not accepted."
            }
            Self::Provider => "The native Codex turn reported a provider failure.",
            Self::MissingCompletion => "Codex did not report a verified completed turn and result.",
            Self::OutputBound => "The native Codex output exceeded its safe bound.",
            Self::Timeout => "The native Codex continuation timed out.",
            Self::Interrupted => "The native Codex continuation was interrupted.",
            Self::Exit => "The native Codex worker exited without a verified successful outcome.",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Progress {
    Session,
    Step(&'static str),
}

// Typed coordinates reject duplicate keys; optional opaque envelopes are
// discarded and can never become a receipt, activity label or error body.
#[derive(Deserialize)]
struct Event {
    #[serde(rename = "type")]
    kind: String,
    thread_id: Option<String>,
    item: Option<Item>,
    usage: Option<Usage>,
    error: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct Usage {
    #[serde(rename = "input_tokens")]
    _input_tokens: u64,
    #[serde(rename = "cached_input_tokens")]
    _cached_input_tokens: u64,
    #[serde(rename = "output_tokens")]
    _output_tokens: u64,
}

#[derive(Deserialize)]
struct Item {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
    phase: Option<String>,
}

pub(super) struct CodexEvents<'a> {
    expected_session: &'a str,
    session_verified: bool,
    turn_started: bool,
    turn_completed: bool,
    result: Option<String>,
    bytes: usize,
    count: usize,
    failure: Option<NativeFailure>,
}

impl<'a> CodexEvents<'a> {
    pub(super) fn new(expected_session: &'a str) -> Self {
        Self {
            expected_session,
            session_verified: false,
            turn_started: false,
            turn_completed: false,
            result: None,
            bytes: 0,
            count: 0,
            failure: None,
        }
    }

    pub(super) fn accept(&mut self, line: &str) -> Result<Option<Progress>, NativeFailure> {
        if let Some(failure) = self.failure {
            return Err(failure);
        }
        let outcome = self.parse(line);
        if let Err(failure) = outcome {
            self.failure = Some(failure);
        }
        outcome
    }

    fn parse(&mut self, line: &str) -> Result<Option<Progress>, NativeFailure> {
        self.bytes = self.bytes.saturating_add(line.len().saturating_add(1));
        self.count = self.count.saturating_add(1);
        if line.len() > MAX_LINE_BYTES || self.bytes > MAX_STREAM_BYTES || self.count > MAX_EVENTS {
            return Err(NativeFailure::OutputBound);
        }
        let event: Event = serde_json::from_str(line).map_err(|_| NativeFailure::Protocol)?;
        if event
            .thread_id
            .as_deref()
            .is_some_and(|id| id != self.expected_session)
        {
            return Err(NativeFailure::SessionMismatch);
        }
        if matches!(event.kind.as_str(), "turn.failed" | "error") || event.error.is_some() {
            return Err(NativeFailure::Provider);
        }
        if event.kind == "thread.started" {
            if event.thread_id.as_deref() != Some(self.expected_session) {
                return Err(NativeFailure::SessionMismatch);
            }
            if self.session_verified {
                return Err(NativeFailure::Protocol);
            }
            self.session_verified = true;
            return Ok(Some(Progress::Session));
        }
        // A matched first thread acknowledgement is mandatory, including for
        // metadata/progress. Nothing after terminal completion can change it.
        if !self.session_verified || self.turn_completed {
            return Err(NativeFailure::Protocol);
        }
        // Codex 0.160 emits startup feature warnings as completed `error`
        // items between thread.started and turn.started. They are not turn
        // failures. Discard their bounded bodies, never promote them to a
        // result, and still require the subsequent verified terminal turn.
        // Actual error/turn.failed events above and error items during a turn
        // remain fatal, including anything after its completion marker.
        if !self.turn_started && event.kind == "item.completed" {
            let item = event.item.as_ref().ok_or(NativeFailure::Protocol)?;
            if item.kind == "error" && !item.id.is_empty() && item.id.len() <= 128 {
                return Ok(None);
            }
        }
        match event.kind.as_str() {
            "turn.started" if !self.turn_started => {
                self.turn_started = true;
                Ok(None)
            }
            "turn.started" => Err(NativeFailure::Protocol),
            "turn.completed" if self.turn_started && event.usage.is_some() => {
                self.turn_completed = true;
                Ok(None)
            }
            "turn.completed" => Err(NativeFailure::Protocol),
            "item.started" | "item.updated" | "item.completed" if self.turn_started => {
                let item = event.item.ok_or(NativeFailure::Protocol)?;
                if item.id.is_empty() || item.id.len() > 128 || item.kind.is_empty() {
                    return Err(NativeFailure::Protocol);
                }
                if item.kind == "error" {
                    return Err(NativeFailure::Provider);
                }
                let label = match item.kind.as_str() {
                    "agent_message" => {
                        if event.kind == "item.completed"
                            && matches!(item.phase.as_deref(), None | Some("final_answer"))
                        {
                            let text = item.text.ok_or(NativeFailure::Protocol)?;
                            if text.len() > MAX_RESULT_BYTES {
                                return Err(NativeFailure::OutputBound);
                            }
                            self.result = Some(text);
                        }
                        Some("Writing the result")
                    }
                    "command_execution" => Some("Running a command"),
                    "file_change" => Some("Editing files"),
                    "mcp_tool_call" => Some("Using a tool"),
                    "web_search" => Some("Searching the web"),
                    "todo_list" => Some("Planning the work"),
                    _ => None, // No reasoning, commands, paths or tool envelopes.
                };
                Ok(label.map(Progress::Step))
            }
            "item.started" | "item.updated" | "item.completed" => Err(NativeFailure::Protocol),
            _ if self.turn_started => Ok(None), // Bounded future nonterminal metadata.
            _ => Err(NativeFailure::Protocol),
        }
    }

    // Called only after the entire stream is parsed and the worker is reaped.
    // A turn.completed marker alone does not hide trailing errors or bad exit.
    pub(super) fn finish(self, successful_exit: bool) -> Result<String, NativeFailure> {
        if let Some(failure) = self.failure {
            return Err(failure);
        }
        if !successful_exit {
            return Err(NativeFailure::Exit);
        }
        if !self.session_verified || !self.turn_started || !self.turn_completed {
            return Err(NativeFailure::MissingCompletion);
        }
        self.result
            .filter(|result| !result.trim().is_empty())
            .ok_or(NativeFailure::MissingCompletion)
    }
}

#[cfg(test)]
#[path = "codex_events_tests.rs"]
mod tests;
