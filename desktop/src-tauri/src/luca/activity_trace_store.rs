//! Bounded public work history. Never stores observer frames or final reply text.
//! Like the local effort store, the on-disk file is atomic and mode 0600, not
//! encrypted. Scope is the owner and hashed relay captured by the native host.

type DispatchKey = (String, String, String);
type DispatchOutcome = (ManagedDispatchState, Option<String>, Option<u64>);
type DispatchOutcomes = HashMap<DispatchKey, DispatchOutcome>;

use std::{collections::HashMap, path::PathBuf};

use luca_protocol::{
    ManagedPresentationActivityKindV1 as Kind, ManagedPresentationActivityStatusV1 as StepStatus,
    ManagedPresentationFrameV1, ManagedPresentationKindV1,
};
use serde::{Deserialize, Serialize};

use super::super::managed_dispatch_store::{atomic_write_restricted, ManagedDispatchState};

const SCHEMA: &str = "luca.activity-traces.v1";
const MAX_TRACES: usize = 512;
const MAX_ENTRIES: usize = 256;
const MAX_TEXT_BYTES: usize = 2048;
const MAX_TRACE_TEXT_BYTES: usize = 64 * 1024;
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TraceStatus {
    Working,
    Completed,
    Cancelled,
    Failed,
    Interrupted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TraceEntry {
    pub(crate) id: String,
    pub(crate) sequence: u64,
    pub(crate) kind: String,
    pub(crate) text: String,
    pub(crate) room_text: String,
    pub(crate) status: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ActivityTrace {
    pub(crate) conversation_id: String,
    pub(crate) resident_pubkey: String,
    pub(crate) dispatch_receipt_id: String,
    pub(crate) turn_id: String,
    pub(crate) final_message_id: Option<String>,
    #[serde(default)]
    pub(crate) anchor_message_id: Option<String>,
    #[serde(default)]
    pub(crate) response_surface: Option<luca_protocol::ManagedResponseSurfaceV1>,
    #[serde(default)]
    pub(crate) thread_root_id: Option<String>,
    pub(crate) started_at: u64,
    pub(crate) ended_at: Option<u64>,
    pub(crate) status: TraceStatus,
    pub(crate) entries: Vec<TraceEntry>,
    pub(crate) truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct Scope {
    pub(crate) owner: String,
    pub(crate) relay: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct StoredTrace {
    scope: Scope,
    session_epoch: u64,
    trace: ActivityTrace,
    // Pending public text remains process-local until a following new tool
    // call proves this segment was interim commentary, not the final answer.
    #[serde(skip)]
    pending: String,
    #[serde(skip)]
    pending_truncated: bool,
    #[serde(skip)]
    last_sequence: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoreFile {
    schema: String,
    traces: Vec<StoredTrace>,
}

pub(super) struct TraceStore {
    path: PathBuf,
    traces: Vec<StoredTrace>,
}

fn bounded(value: &str, bound: usize) -> (String, bool) {
    let mut end = value.len().min(bound);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    (value[..end].to_owned(), end < value.len())
}

/// Apply redaction to the complete segment, after stream fragments are joined.
/// Suspected credential-bearing lines are withheld wholesale: no command
/// payload or arbitrary credential value is needed to understand a work step.
fn public_text(value: &str, fallback: &str) -> (String, bool) {
    let lower = value.to_ascii_lowercase();
    let sensitive = [
        "nsec1",
        "sprt_tok_",
        "sk-",
        "ghp_",
        "github_pat_",
        "xoxb-",
        "xoxp-",
        "bearer ",
        "authorization",
        "api_key",
        "apikey",
        "api-key",
        "token",
        "password",
        "passwd",
        "secret",
        "private key",
        "-----begin",
        "credential",
        "--auth",
        "eyj",
        "akia",
        "asia",
    ];
    let contains_url_secret = value
        .split_whitespace()
        .any(|word| word.contains("://") && (word.contains('@') || word.contains('?')));
    if sensitive.iter().any(|pattern| lower.contains(pattern)) || contains_url_secret {
        return (fallback.into(), false);
    }
    let clean: String = value
        .chars()
        .filter(|c| {
            (!c.is_control() || matches!(c, '\n' | '\r' | '\t'))
                && !matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
        .collect();
    bounded(&clean, MAX_TEXT_BYTES)
}

fn room_label(kind: Kind, label: &str) -> &'static str {
    match kind {
        Kind::File if label.starts_with("Editing") || label.starts_with("Writing") => {
            "Editing files"
        }
        Kind::File => "Reading files",
        Kind::Command => "Running a command",
        Kind::Web => "Browsing the web",
        Kind::Search => "Searching",
        Kind::Thinking => "Thinking",
        Kind::Delegation => "Delegating work",
        Kind::Other => "Working",
    }
}

/// Derive an action and its object only from the emitter's bounded display
/// detail. Raw tool arguments and output are never available to this store.
fn owner_label(activity: &luca_protocol::ManagedPresentationActivityV1) -> String {
    let Some(detail) = activity.detail.as_deref() else {
        return activity.label.clone();
    };
    let object = match activity.kind {
        Kind::File => detail.rsplit(['/', '\\']).next().unwrap_or(detail),
        Kind::Command | Kind::Search | Kind::Web => detail,
        _ => return activity.label.clone(),
    };
    if object.is_empty() || activity.label.contains(object) {
        return activity.label.clone();
    }
    let verb = match activity.kind {
        Kind::Command => "Running",
        Kind::Search => "Searching for",
        Kind::File
            if activity.label.to_ascii_lowercase().contains("edit")
                || activity.label.to_ascii_lowercase().contains("writ") =>
        {
            "Editing"
        }
        _ => "Reading",
    };
    format!("{verb} {object}")
}

impl StoredTrace {
    fn append(&mut self, entry: TraceEntry) {
        if self.trace.entries.len() >= MAX_ENTRIES
            || self
                .trace
                .entries
                .iter()
                .map(|e| e.text.len() + e.room_text.len())
                .sum::<usize>()
                + entry.text.len()
                + entry.room_text.len()
                > MAX_TRACE_TEXT_BYTES
        {
            self.trace.truncated = true;
        } else {
            self.trace.entries.push(entry);
        }
    }

    fn finish(&mut self, status: TraceStatus, now: u64) {
        self.trace.status = status;
        self.trace.ended_at.get_or_insert(now);
        self.pending.clear();
        for entry in &mut self.trace.entries {
            if entry.status == "active" {
                entry.status = if self.trace.status == TraceStatus::Completed {
                    "done"
                } else {
                    "failed"
                }
                .into();
            }
        }
    }
}

impl TraceStore {
    /// Called once per native process, never on ordinary renderer hydration.
    pub(super) fn load(path: PathBuf, now: u64) -> Result<Self, String> {
        let mut traces = if path.exists() {
            if std::fs::metadata(&path)
                .map_err(|_| "activity trace metadata unavailable")?
                .len()
                > MAX_FILE_BYTES
            {
                return Err("activity trace file exceeds limit".into());
            }
            let bytes = std::fs::read(&path).map_err(|_| "activity traces unavailable")?;
            let file: StoreFile =
                serde_json::from_slice(&bytes).map_err(|_| "activity trace file is invalid")?;
            if file.schema != SCHEMA || file.traces.len() > MAX_TRACES {
                return Err("activity trace schema or count is invalid".into());
            }
            if file.traces.iter().any(|row| {
                row.trace.entries.len() > MAX_ENTRIES
                    || row
                        .trace
                        .entries
                        .iter()
                        .map(|e| e.text.len() + e.room_text.len())
                        .sum::<usize>()
                        > MAX_TRACE_TEXT_BYTES
                    || row.trace.entries.iter().any(|e| {
                        e.text.len() > MAX_TEXT_BYTES
                            || e.room_text.len() > MAX_TEXT_BYTES
                            || !matches!(e.kind.as_str(), "activity" | "narration" | "permission")
                            || !matches!(e.status.as_str(), "active" | "done" | "failed")
                    })
            }) {
                return Err("activity trace bounds are invalid".into());
            }
            file.traces
        } else {
            Vec::new()
        };
        let mut interrupted = false;
        for row in &mut traces {
            if row.trace.status == TraceStatus::Working {
                row.finish(TraceStatus::Interrupted, now);
                interrupted = true;
            }
        }
        let store = Self { path, traces };
        if interrupted {
            store.save()?;
        }
        Ok(store)
    }

    pub(super) fn save(&self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| "activity trace directory unavailable")?;
        }
        let bytes = serde_json::to_vec(&StoreFile {
            schema: SCHEMA.into(),
            traces: self.traces.clone(),
        })
        .map_err(|_| "activity traces could not be encoded")?;
        atomic_write_restricted(&self.path, &bytes)
            .map_err(|_| "activity traces could not be saved".into())
    }

    pub(super) fn observe(
        &mut self,
        scope: &Scope,
        frame: &ManagedPresentationFrameV1,
        now: u64,
    ) -> bool {
        let index = self.traces.iter().position(|r| {
            &r.scope == scope
                && r.trace.resident_pubkey == frame.resident_pubkey.as_str()
                && r.trace.conversation_id == frame.conversation_id.as_str()
                && r.trace.dispatch_receipt_id == frame.dispatch_receipt_id.as_str()
        });
        let index = match index {
            Some(i) => i,
            None if frame.kind == ManagedPresentationKindV1::TurnStarted => {
                if self.traces.len() >= MAX_TRACES {
                    let oldest = self
                        .traces
                        .iter()
                        .enumerate()
                        .filter(|(_, r)| r.trace.status != TraceStatus::Working)
                        .min_by_key(|(_, r)| r.trace.started_at)
                        .map(|(i, _)| i);
                    let Some(oldest) = oldest else {
                        return false;
                    };
                    self.traces.remove(oldest);
                }
                self.traces.push(StoredTrace {
                    scope: scope.clone(),
                    session_epoch: frame.session_epoch.get(),
                    pending: String::new(),
                    pending_truncated: false,
                    last_sequence: 0,
                    trace: ActivityTrace {
                        conversation_id: frame.conversation_id.as_str().into(),
                        resident_pubkey: frame.resident_pubkey.as_str().into(),
                        dispatch_receipt_id: frame.dispatch_receipt_id.as_str().into(),
                        turn_id: frame.turn_id.as_str().into(),
                        final_message_id: None,
                        anchor_message_id: None,
                        response_surface: None,
                        thread_root_id: None,
                        started_at: now,
                        ended_at: None,
                        status: TraceStatus::Working,
                        entries: Vec::new(),
                        truncated: false,
                    },
                });
                self.traces.len() - 1
            }
            None => return false,
        };
        let row = &mut self.traces[index];
        if row.session_epoch != frame.session_epoch.get()
            || row.trace.turn_id != frame.turn_id.as_str()
            || frame.sequence.get() <= row.last_sequence
            || row.trace.status != TraceStatus::Working
        {
            return false;
        }
        row.last_sequence = frame.sequence.get();
        match frame.kind {
            // Heartbeats are transient presentation state, not durable work.
            ManagedPresentationKindV1::Liveness => return false,
            ManagedPresentationKindV1::PublicChunk => {
                if let Some(text) = frame.public_chunk.as_ref() {
                    let (text, truncated) =
                        bounded(text, MAX_TEXT_BYTES.saturating_sub(row.pending.len()));
                    row.pending.push_str(&text);
                    row.pending_truncated |= truncated;
                }
                // Public reply text is never itself a durable trace entry.
                return false;
            }
            ManagedPresentationKindV1::Phase => {
                let Some(activity) = frame.activity.as_ref() else {
                    return false;
                };
                let step = activity
                    .step
                    .map(|s| s.get())
                    .unwrap_or(frame.sequence.get());
                let id = format!("step-{step}");
                let existing = row.trace.entries.iter().position(|e| e.id == id);
                if existing.is_none()
                    && activity.status == Some(StepStatus::Active)
                    && !row.pending.is_empty()
                {
                    let (text, truncated) = public_text(&row.pending, "Work update withheld");
                    row.trace.truncated |= truncated || row.pending_truncated;
                    row.pending.clear();
                    row.pending_truncated = false;
                    if !text.is_empty() {
                        row.append(TraceEntry {
                            id: format!("narration-{}", frame.sequence.get()),
                            sequence: frame.sequence.get(),
                            kind: "narration".into(),
                            text,
                            room_text: "Work update".into(),
                            status: "done".into(),
                        });
                    }
                }
                let room = room_label(activity.kind, &activity.label);
                let (text, truncated) = public_text(&owner_label(activity), room);
                row.trace.truncated |= truncated;
                let status = match activity.status {
                    Some(StepStatus::Done) => "done",
                    Some(StepStatus::Failed) => "failed",
                    _ => "active",
                };
                if let Some(i) = existing {
                    row.trace.entries[i].status = status.into();
                    let total = row
                        .trace
                        .entries
                        .iter()
                        .map(|e| e.text.len() + e.room_text.len())
                        .sum::<usize>();
                    if total - row.trace.entries[i].text.len() + text.len() <= MAX_TRACE_TEXT_BYTES
                    {
                        row.trace.entries[i].text = text;
                    } else {
                        row.trace.truncated = true;
                    }
                } else {
                    row.append(TraceEntry {
                        id,
                        sequence: frame.sequence.get(),
                        kind: "activity".into(),
                        text,
                        room_text: room.into(),
                        status: status.into(),
                    });
                }
            }
            ManagedPresentationKindV1::Completed => row.finish(TraceStatus::Completed, now),
            ManagedPresentationKindV1::Cancelled => row.finish(TraceStatus::Cancelled, now),
            ManagedPresentationKindV1::Failed => row.finish(TraceStatus::Failed, now),
            ManagedPresentationKindV1::TurnStarted => {}
        }
        true
    }

    /// Record one permission answer on the turn it belongs to.
    ///
    /// The row is found the way [`observe`](Self::observe) finds it — scope,
    /// resident, conversation and dispatch receipt — or, when the harness sent
    /// no receipt, by the turn it named. `text` is the owner's line and passes
    /// the same credential redaction as any other work step; `room_text` is
    /// what everybody else sees and must already be free of commands, paths and
    /// hosts when it arrives here.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn record_permission(
        &mut self,
        scope: &Scope,
        resident_pubkey: &str,
        conversation_id: &str,
        dispatch_receipt_id: Option<&str>,
        turn_id: &str,
        text: &str,
        room_text: &str,
        allowed: bool,
    ) -> bool {
        let Some(row) = self.traces.iter_mut().find(|row| {
            &row.scope == scope
                && row.trace.status == TraceStatus::Working
                && row.trace.resident_pubkey == resident_pubkey
                && row.trace.conversation_id == conversation_id
                && match dispatch_receipt_id {
                    Some(receipt) => row.trace.dispatch_receipt_id == receipt,
                    None => row.trace.turn_id == turn_id,
                }
        }) else {
            return false;
        };
        let (room_text, room_truncated) = bounded(room_text, MAX_TEXT_BYTES);
        let (text, truncated) = public_text(text, &room_text);
        row.trace.truncated |= truncated || room_truncated;
        let ordinal = row
            .trace
            .entries
            .iter()
            .filter(|entry| entry.kind == "permission")
            .count()
            .saturating_add(1);
        row.append(TraceEntry {
            id: format!("permission-{ordinal}"),
            sequence: row.last_sequence,
            kind: "permission".into(),
            text,
            room_text,
            status: if allowed { "done" } else { "failed" }.into(),
        });
        true
    }

    pub(super) fn set_placement(
        &mut self,
        scope: &Scope,
        frame: &ManagedPresentationFrameV1,
        placement: (
            String,
            luca_protocol::ManagedResponseSurfaceV1,
            Option<String>,
        ),
    ) -> bool {
        let Some(row) = self.traces.iter_mut().find(|r| {
            &r.scope == scope
                && r.trace.resident_pubkey == frame.resident_pubkey.as_str()
                && r.trace.conversation_id == frame.conversation_id.as_str()
                && r.trace.dispatch_receipt_id == frame.dispatch_receipt_id.as_str()
        }) else {
            return false;
        };
        if row.trace.anchor_message_id.is_some() {
            return false;
        }
        row.trace.anchor_message_id = Some(placement.0);
        row.trace.response_surface = Some(placement.1);
        row.trace.thread_root_id = placement.2;
        true
    }

    pub(super) fn interrupt_session(
        &mut self,
        scope: &Scope,
        resident: &str,
        epoch: u64,
        now: u64,
    ) -> bool {
        let mut changed = false;
        for row in &mut self.traces {
            if &row.scope == scope
                && row.trace.resident_pubkey == resident
                && row.session_epoch == epoch
                && row.trace.status == TraceStatus::Working
            {
                row.finish(TraceStatus::Interrupted, now);
                changed = true;
            }
        }
        changed
    }

    /// Retain relay acceptance immediately, even with no renderer mounted.
    /// Only exact native publication coordinates are read from the request;
    /// its final draft never enters activity history.
    pub(super) fn record_published(
        &mut self,
        scope: &Scope,
        request: &luca_protocol::ManagedMessagePublishRequestV1,
        session_epoch: u64,
        event_id: &str,
        now: u64,
    ) -> bool {
        if request.owner_pubkey.as_str() != scope.owner {
            return false;
        }
        let Some(row) = self.traces.iter_mut().find(|row| {
            &row.scope == scope
                && row.session_epoch == session_epoch
                && row.trace.resident_pubkey == request.resident_pubkey.as_str()
                && row.trace.conversation_id == request.conversation_id.as_str()
                && row.trace.dispatch_receipt_id == request.dispatch_receipt_id.as_str()
                && row.trace.turn_id == request.turn_id.as_str()
        }) else {
            return false;
        };
        if row.trace.final_message_id.as_deref() == Some(event_id) {
            return false;
        }
        if row.trace.final_message_id.is_some() || luca_protocol::Hex64::parse(event_id).is_err() {
            return false;
        }
        row.trace.final_message_id = Some(event_id.into());
        row.finish(TraceStatus::Completed, now);
        true
    }

    /// Exact native publication authority supersedes any provisional outcome.
    pub(super) fn reconcile(
        &mut self,
        scope: &Scope,
        outcomes: &DispatchOutcomes,
        now: u64,
    ) -> bool {
        let mut changed = false;
        for row in &mut self.traces {
            if &row.scope != scope {
                continue;
            }
            let key = (
                row.trace.resident_pubkey.clone(),
                row.trace.conversation_id.clone(),
                row.trace.dispatch_receipt_id.clone(),
            );
            let Some((state, final_id, epoch)) = outcomes.get(&key) else {
                continue;
            };
            if epoch.is_some_and(|epoch| epoch != row.session_epoch) {
                continue;
            }
            if *state == ManagedDispatchState::Published {
                if final_id.is_some()
                    && (row.trace.final_message_id != *final_id
                        || row.trace.status != TraceStatus::Completed)
                {
                    row.trace.final_message_id = final_id.clone();
                    row.finish(TraceStatus::Completed, now);
                    changed = true;
                }
            } else {
                let status = match state {
                    ManagedDispatchState::Cancelled => Some(TraceStatus::Cancelled),
                    ManagedDispatchState::Failed | ManagedDispatchState::Rejected => {
                        Some(TraceStatus::Failed)
                    }
                    ManagedDispatchState::Interrupted => Some(TraceStatus::Interrupted),
                    _ => None,
                };
                if let Some(status) = status {
                    if row.trace.status != status && row.trace.final_message_id.is_none() {
                        row.finish(status, now);
                        changed = true;
                    }
                }
            }
        }
        changed
    }

    pub(super) fn list(&self, scope: &Scope) -> Vec<ActivityTrace> {
        self.traces
            .iter()
            .filter(|row| &row.scope == scope)
            .map(|row| row.trace.clone())
            .collect()
    }
}

#[cfg(test)]
#[path = "activity_trace_store_tests.rs"]
mod tests;
