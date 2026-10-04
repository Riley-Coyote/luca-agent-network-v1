//! Bounded completion evidence from the existing runtime-task host protocol.
//!
//! Result text is staged until the complete stream and worker exit are verified.
//! A later failed, malformed or contradictory event permanently rejects success.

use serde::Deserialize;

const PROTOCOL: &str = "polyphonic.runtime-task.v1";
/// Bound to apply to the child reader before allocating a complete host line.
pub(super) const MAX_HOST_LINE_BYTES: usize = 2 * 1024 * 1024;
const MAX_STREAM_BYTES: usize = 16 * 1024 * 1024;
const MAX_EVENTS: usize = 16_384;
const MAX_RESULT_BYTES: usize = 1024 * 1024;
const MAX_SESSION_BYTES: usize = 512;
const MAX_LABEL_BYTES: usize = 128;

const INVALID_TARGET: &str = "The expected native session could not be verified.";
const INVALID_STREAM: &str = "The runtime host event stream could not be verified.";
const OUTPUT_BOUND: &str = "The runtime host output exceeded its safe bound.";
const SESSION_MISMATCH: &str = "The runtime host returned a different provider session.";
const MISSING_CORRELATION: &str =
    "The runtime result did not match an acknowledged native session.";
const MISSING_COMPLETION: &str = "The runtime host did not report a completed task.";
const EARLY_STOP: &str = "The runtime stopped before completing the task.";
const HOST_FAILED: &str = "The runtime host reported a failed task.";
const BAD_EXIT: &str = "The runtime host exited without a verified successful outcome.";

/// Safe activity, identity and terminal markers accepted by the host validator.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum HostEvent {
    /// The provider acknowledged this exact opaque session identity.
    Session(String),
    /// A control-free, UTF-8-safe bounded activity label, not a completion claim.
    Step(String),
    /// Candidate completion only; result bytes are unavailable until `finish`.
    Result,
    /// A fixed body-free diagnostic; the parser is permanently failed afterward.
    Failed(String),
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Kind {
    Session,
    Step,
    Result,
    Failed,
}

// Typed fields reject duplicate coordinates, wrong types and unknown protocol
// fields. Never include a serde diagnostic or a provider error in a receipt.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    protocol: String,
    kind: Kind,
    provider_session_id: Option<String>,
    label: Option<String>,
    result: Option<String>,
    stop_reason: Option<String>,
    error: Option<String>,
}

/// One child stream's exact provider binding and staged completion evidence.
pub(super) struct HostEvents {
    expected_session: Option<String>,
    provider_session: Option<String>,
    session_acknowledged: bool,
    completed: bool,
    result: Option<String>,
    failure: Option<&'static str>,
    bytes: usize,
    count: usize,
}

impl HostEvents {
    /// `None` preserves legacy new-task IDs; continuation requires a native UUID.
    pub(super) fn new(expected_session: Option<&str>) -> Result<Self, String> {
        if expected_session.is_some_and(|id| !native_uuid(id)) {
            return Err(INVALID_TARGET.to_owned());
        }
        Ok(Self {
            expected_session: expected_session.map(str::to_owned),
            provider_session: None,
            session_acknowledged: false,
            completed: false,
            result: None,
            failure: None,
            bytes: 0,
            count: 0,
        })
    }

    /// Validate one complete JSONL line and permanently latch any rejected input.
    pub(super) fn accept(&mut self, line: &str) -> Result<HostEvent, String> {
        if let Some(failure) = self.failure {
            return Err(failure.to_owned());
        }
        match self.parse(line) {
            Ok(event) => Ok(event),
            Err(failure) => Err(self.poison(failure)),
        }
    }

    /// Reject an I/O, framing or persistence failure without exposing its body.
    pub(super) fn reject_stream(&mut self) -> String {
        self.poison(INVALID_STREAM)
    }

    /// Return the exact bound identity without guessing, trimming or replacement.
    pub(super) fn provider_session_id(&self) -> Option<&str> {
        self.provider_session.as_deref()
    }

    /// Verify terminal evidence after EOF and child reaping, not merely exit zero.
    /// Explicitly completed empty legacy output is `Ok(None)`, never fabricated.
    pub(super) fn finish(self, successful_exit: bool) -> Result<Option<String>, String> {
        if let Some(failure) = self.failure {
            return Err(failure.to_owned());
        }
        if !successful_exit {
            return Err(BAD_EXIT.to_owned());
        }
        if !self.completed {
            return Err(MISSING_COMPLETION.to_owned());
        }
        Ok(self.result.filter(|result| !result.trim().is_empty()))
    }

    fn poison(&mut self, failure: &'static str) -> String {
        let failure = *self.failure.get_or_insert(failure);
        self.result = None;
        failure.to_owned()
    }

    fn validate_session(&self, session: &str) -> Result<(), &'static str> {
        if session.is_empty()
            || session.trim().is_empty()
            || session.len() > MAX_SESSION_BYTES
            || session.chars().any(char::is_control)
        {
            return Err(INVALID_STREAM);
        }
        if self
            .expected_session
            .as_deref()
            .is_some_and(|expected| expected != session)
            || self
                .provider_session
                .as_deref()
                .is_some_and(|bound| bound != session)
        {
            return Err(SESSION_MISMATCH);
        }
        Ok(())
    }

    fn bind(&mut self, session: &str) -> Result<(), &'static str> {
        self.validate_session(session)?;
        if self.provider_session.is_none() {
            self.provider_session = Some(session.to_owned());
        }
        Ok(())
    }

    fn parse(&mut self, line: &str) -> Result<HostEvent, &'static str> {
        self.bytes = self.bytes.saturating_add(line.len().saturating_add(1));
        self.count = self.count.saturating_add(1);
        if line.len() > MAX_HOST_LINE_BYTES
            || self.bytes > MAX_STREAM_BYTES
            || self.count > MAX_EVENTS
        {
            return Err(OUTPUT_BOUND);
        }
        let envelope: Envelope = serde_json::from_str(line).map_err(|_| INVALID_STREAM)?;
        if envelope.protocol != PROTOCOL {
            return Err(INVALID_STREAM);
        }
        // A terminal marker cannot be followed by any further task event.
        // Failed is still normalized below so callers see its safe diagnostic.
        if self.completed && !matches!(envelope.kind, Kind::Failed) {
            return Err(INVALID_STREAM);
        }
        if let Some(session) = envelope.provider_session_id.as_deref() {
            self.validate_session(session)?;
        }
        match envelope.kind {
            Kind::Session => {
                if envelope.label.is_some()
                    || envelope.result.is_some()
                    || envelope.stop_reason.is_some()
                    || envelope.error.is_some()
                {
                    return Err(INVALID_STREAM);
                }
                let session = envelope.provider_session_id.ok_or(INVALID_STREAM)?;
                self.bind(&session)?;
                self.session_acknowledged = true;
                Ok(HostEvent::Session(session))
            }
            Kind::Step => {
                if envelope.result.is_some()
                    || envelope.stop_reason.is_some()
                    || envelope.error.is_some()
                {
                    return Err(INVALID_STREAM);
                }
                let label = bounded_label(&envelope.label.ok_or(INVALID_STREAM)?)?;
                if let Some(session) = envelope.provider_session_id.as_deref() {
                    self.bind(session)?;
                }
                Ok(HostEvent::Step(label))
            }
            Kind::Result => {
                if envelope.label.is_some() || envelope.error.is_some() {
                    return Err(INVALID_STREAM);
                }
                if envelope.stop_reason.as_deref() != Some("end_turn") {
                    return Err(EARLY_STOP);
                }
                if (self.provider_session.is_none() && envelope.provider_session_id.is_none())
                    || (self.expected_session.is_some()
                        && (!self.session_acknowledged
                            || envelope.provider_session_id.as_deref()
                                != self.expected_session.as_deref()))
                {
                    return Err(MISSING_CORRELATION);
                }
                let result = envelope.result.ok_or(INVALID_STREAM)?;
                if result.len() > MAX_RESULT_BYTES {
                    return Err(OUTPUT_BOUND);
                }
                if let Some(session) = envelope.provider_session_id.as_deref() {
                    self.bind(session)?;
                }
                self.completed = true;
                self.result = Some(result);
                Ok(HostEvent::Result)
            }
            Kind::Failed => {
                if envelope.label.is_some()
                    || envelope.result.is_some()
                    || envelope.stop_reason.is_some()
                {
                    return Err(INVALID_STREAM);
                }
                // Provider text is intentionally discarded, never truncated or
                // classified into an authority- or success-bearing message.
                Ok(HostEvent::Failed(self.poison(HOST_FAILED)))
            }
        }
    }
}

fn native_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || matches!(byte, b'a'..=b'f')
            }
        })
        && value.bytes().any(|byte| !matches!(byte, b'0' | b'-'))
}

fn bounded_label(value: &str) -> Result<String, &'static str> {
    let mut label = String::new();
    for character in value.chars().filter(|character| {
        !character.is_control()
            && !matches!(
                character,
                '\u{061c}' | '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'
            )
    }) {
        if label.is_empty() && character.is_whitespace() {
            continue;
        }
        if label.len() + character.len_utf8() > MAX_LABEL_BYTES {
            break;
        }
        label.push(character);
    }
    let label = label.trim().to_owned();
    if label.is_empty() {
        Err(INVALID_STREAM)
    } else {
        Ok(label)
    }
}

#[cfg(test)]
#[path = "host_events_tests.rs"]
mod tests;
