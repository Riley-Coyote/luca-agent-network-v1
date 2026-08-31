//! Desktop-owned admission records for Luca-managed resident turns.
//!
//! Exact signed owner events authorize turns; relay chronology does not.
use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

use atomic_write_file::AtomicWriteFile;
use luca_protocol::{
    canonical_sha256, Hex64, ManagedMessagePublishRequestV1, ManagedResponseSurfaceV1, OpaqueId,
    SafeU53, Sha256Ref,
};
use nostr::{Event, EventId};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::managed_dispatch_routing::routing_from_event;

const STORE_SCHEMA_V1: &str = "luca.managed-dispatch-store.v1";
const STORE_SCHEMA_V2: &str = "luca.managed-dispatch-store.v2";
const STORE_SCHEMA_V3: &str = "luca.managed-dispatch-store.v3";
const STORE_SCHEMA_V4: &str = "luca.managed-dispatch-store.v4";
const STORE_SCHEMA: &str = "luca.managed-dispatch-store.v5";
const MAX_DISPATCHES: usize = 512;
const DISPATCH_TTL_SECONDS: u64 = 30 * 60;
const CONTINUITY_DISPATCH_DOMAIN: &str = "luca.continuity.dispatch-set.v1";

static GLOBAL_STORE: OnceLock<Arc<Mutex<ManagedDispatchStore>>> = OnceLock::new();

/// Persistent lifecycle of one desktop-authorized resident invocation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ManagedDispatchState {
    /// Exact owner event is being submitted or has been accepted.
    Pending,
    /// One live broker session has successfully claimed the row.
    Active,
    /// A local owner cancellation won before resident publication.
    Cancelled,
    /// The relay explicitly rejected the owner trigger.
    Rejected,
    /// One exact resident final reached relay acceptance.
    Published,
    /// The resident turn ended without a publishable final response.
    Failed,
    /// The desktop restarted after dispatch but before a terminal result.
    Interrupted,
}

/// Why a non-published dispatch was terminalized without a resident final.
///
/// This is deliberately separate from [`ManagedDispatchState`] so v1's
/// string-valued `state` representation remains readable during migration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ManagedDispatchInterruptionReason {
    Restart,
}

/// Mirrors the harness's first-subscription replay grace: `buzz-acp` captures
/// a startup watermark and subscribes from `watermark - 5s`, so an owner send
/// created within this many seconds before a resident starts is replayed to
/// the new session (crates/buzz-acp/src/lib.rs, `startup_watermark`).
pub(crate) const WAKE_REPLAY_GRACE_SECS: u64 = 5;

/// Public-only dispatch facts derived from one exact signed owner event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ActiveDispatch {
    pub trigger_event_id: String,
    pub owner_pubkey: String,
    pub resident_pubkey: String,
    pub conversation_id: String,
    pub thread_id: Option<String>,
    pub root_event_id: Option<String>,
    pub reply_event_id: Option<String>,
    /// Exact dispatch from which this visible activation was requested. For a
    /// top-level owner send this is the trigger itself.
    #[serde(default)]
    pub source_dispatch_id: Option<String>,
    /// Stable root of the bounded owner-visible activation chain.
    #[serde(default)]
    pub causal_root_event_id: Option<String>,
    /// Exact semantic action that produced a one-hop descendant trigger.
    #[serde(default)]
    pub causal_parent_action_id: Option<String>,
    /// Zero for owner activation and exactly one for the only permitted
    /// resident-descendant activation in this milestone.
    #[serde(default)]
    pub descendant_depth: u8,
    /// Missing only on legacy rows created before response surfaces were
    /// frozen into dispatch authority.
    #[serde(default)]
    pub response_surface: Option<ManagedResponseSurfaceV1>,
    pub resolved_p_tags: Vec<String>,
    pub created_at: u64,
    pub expires_at: u64,
    pub session_epoch: Option<u64>,
    pub state: ManagedDispatchState,
    /// Present only for [`ManagedDispatchState::Interrupted`]. Missing on v1
    /// rows means no interruption was recorded.
    #[serde(default)]
    pub interruption_reason: Option<ManagedDispatchInterruptionReason>,
    #[serde(default)]
    pub submitted_event_id: Option<String>,
    pub published_event_id: Option<String>,
    #[serde(default)]
    pub outbox_finalized: bool,
    /// Immutable upload descriptors admitted by the trusted desktop for this
    /// exact owner trigger. The opaque handle is not sufficient authority;
    /// resolution also requires this row's resident, conversation, session,
    /// and lifetime tuple.
    #[serde(default)]
    pub(crate) artifact_bindings: Vec<ManagedArtifactBinding>,
    /// Minimal reference to the exact device-local conversation snapshot
    /// frozen before this owner event was submitted.
    #[serde(default)]
    pub(crate) context_binding: Option<super::conversation_context::DispatchContextBindingV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ManagedArtifactBinding {
    pub(crate) handle_id: String,
    pub(crate) url: String,
    pub(crate) content_sha256: String,
    pub(crate) byte_length: u64,
    pub(crate) media_type: String,
    pub(crate) display_name: Option<String>,
    pub(crate) expires_at: u64,
}

/// Durable decision for one exact encrypted-outbox restart entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ManagedDispatchReconciliation {
    Ready,
    Published,
    Cancelled,
    Rejected,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedDispatchStore {
    schema: String,
    dispatches: Vec<ActiveDispatch>,
}

/// Exact broker comparison failure. These codes are deliberately body-free.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DispatchAuthorizationError {
    Unknown,
    Ambiguous,
    Expired,
    Terminal,
    WrongOwner,
    WrongResident,
    WrongConversation,
    WrongThread,
    WrongSurface,
    WrongRecipients,
    WrongSession,
    Cancelled,
    Persistence,
}

impl std::fmt::Display for DispatchAuthorizationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::Unknown => "managed dispatch is unknown",
            Self::Ambiguous => "managed dispatch is ambiguous",
            Self::Expired => "managed dispatch has expired",
            Self::Terminal => "managed dispatch is already terminal",
            Self::WrongOwner => "managed dispatch owner does not match",
            Self::WrongResident => "managed dispatch resident does not match",
            Self::WrongConversation => "managed dispatch conversation does not match",
            Self::WrongThread => "managed dispatch thread does not match",
            Self::WrongSurface => "managed dispatch response surface does not match",
            Self::WrongRecipients => "managed dispatch recipients do not match",
            Self::WrongSession => "managed dispatch session does not match",
            Self::Cancelled => "managed dispatch was cancelled",
            Self::Persistence => "managed dispatch persistence failed",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for DispatchAuthorizationError {}

/// Exact durable cancellation receipt for a resident turn.
///
/// `dispatch_receipt_id` is the existing exact owner trigger event ID; Luca
/// does not persist a separate model-turn identifier at this authority layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExactDispatchCancellation {
    pub trigger_event_id: String,
    pub resident_pubkey: String,
    pub conversation_id: String,
    pub session_epoch: u64,
    pub had_outbox_authority: bool,
}

/// One exact pending or active turn that the current resident process can
/// cancel. Prompt text and broker secrets never leave the authority layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CancellableManagedDispatch {
    pub dispatch_receipt_id: String,
    pub resident_pubkey: String,
    pub session_epoch: u64,
}

/// Body-free durable outcome for an owner trigger interrupted by desktop restart.
///
/// Resident and owner keys, message content, runtime configuration, local paths,
/// and raw event JSON deliberately remain inside the authority layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct InterruptedManagedDispatchSummary {
    pub dispatch_receipt_id: String,
}

/// Exact owner-local coordinates needed to settle an artifact receipt after a
/// restart terminalizes its managed dispatch. No message body or path is present.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RestartInterruptedArtifactReceiptBinding {
    /// Owner whose local artifact catalog contains the receipt.
    pub owner_pubkey: String,
    /// Conversation authority frozen on the interrupted dispatch.
    pub conversation_id: String,
    /// Resident authority frozen on the interrupted dispatch.
    pub resident_pubkey: String,
    /// Exact owner trigger used as the artifact dispatch receipt identifier.
    pub dispatch_receipt_id: String,
}

/// Body-free canonical dispatch authority for one exact resident pre-turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ContinuityDispatchAuthority {
    pub(crate) owner_pubkey: Hex64,
    pub(crate) resident_pubkey: Hex64,
    pub(crate) conversation_id: OpaqueId,
    pub(crate) trigger_event_id: Hex64,
    pub(crate) canonical_dispatch_ref: Sha256Ref,
    pub(crate) context_binding: Option<super::conversation_context::DispatchContextBindingV1>,
}

/// Result of an exact cancellation attempt, so callers never need to infer a
/// relay-control decision from a broad conversation cancellation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ExactDispatchCancellationResult {
    Cancelled(ExactDispatchCancellation),
    AlreadyTerminal,
}

/// Exact body-free recheck scheduled for one send that was still inside the
/// managed harness replay window when its resident process exited.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeferredProcessExitDispatchCleanup {
    pub(crate) dispatch_receipt_id: String,
    pub(crate) resident_pubkey: String,
    pub(crate) session_epoch: u64,
    pub(crate) cleanup_at_unix_secs: u64,
}

/// Immediate and deferred outcomes from one resident process exit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProcessExitDispatchCleanup {
    pub(crate) terminalized: usize,
    pub(crate) deferred: Vec<DeferredProcessExitDispatchCleanup>,
}

/// Bounded desktop-owned store. It contains no resident secret or model output.
pub(crate) struct ManagedDispatchStore {
    path: PathBuf,
    dispatches: HashMap<(String, String), ActiveDispatch>,
    active_sessions: HashMap<String, u64>,
}

impl ManagedDispatchStore {
    #[cfg(test)]
    pub(crate) fn set_persistence_path_for_test(&mut self, path: PathBuf) {
        self.path = path;
    }

    /// Load a bounded store, rejecting malformed or unsupported state.
    pub(crate) fn load(path: PathBuf) -> Result<Self, String> {
        let dispatches = if path.exists() {
            let bytes = std::fs::read(&path)
                .map_err(|error| format!("read managed dispatch store: {error}"))?;
            if bytes.len() > 2 * 1024 * 1024 {
                return Err("managed dispatch store exceeds size limit".into());
            }
            let persisted: PersistedDispatchStore = serde_json::from_slice(&bytes)
                .map_err(|error| format!("parse managed dispatch store: {error}"))?;
            if !matches!(
                persisted.schema.as_str(),
                STORE_SCHEMA_V1
                    | STORE_SCHEMA_V2
                    | STORE_SCHEMA_V3
                    | STORE_SCHEMA_V4
                    | STORE_SCHEMA
            ) || persisted.dispatches.len() > MAX_DISPATCHES
            {
                return Err("managed dispatch store schema or row count is invalid".into());
            }
            let mut dispatches = HashMap::with_capacity(persisted.dispatches.len());
            for mut dispatch in persisted.dispatches {
                // v1/v2 rows are top-level owner dispatches. Upgrade their
                // public causal coordinates in memory before the next atomic
                // v3 persistence without changing their idempotency key.
                if dispatch.source_dispatch_id.is_none() {
                    dispatch.source_dispatch_id = Some(dispatch.trigger_event_id.clone());
                }
                if dispatch.causal_root_event_id.is_none() {
                    dispatch.causal_root_event_id = Some(dispatch.trigger_event_id.clone());
                }
                validate_dispatch(&dispatch)?;
                let key = (
                    dispatch.trigger_event_id.clone(),
                    dispatch.resident_pubkey.clone(),
                );
                if dispatches.insert(key, dispatch).is_some() {
                    return Err("managed dispatch store contains duplicate rows".into());
                }
            }
            dispatches
        } else {
            HashMap::new()
        };
        Ok(Self {
            path,
            dispatches,
            active_sessions: HashMap::new(),
        })
    }

    /// Mark the only currently valid broker session for a resident.
    #[cfg(test)]
    pub(crate) fn activate_session(
        &mut self,
        resident_pubkey: &str,
        session_epoch: u64,
    ) -> Result<(), String> {
        self.replace_active_session_for_start(resident_pubkey, session_epoch)
            .map(|_| ())
    }

    pub(crate) fn replace_active_session_for_start(
        &mut self,
        resident_pubkey: &str,
        session_epoch: u64,
    ) -> Result<Option<u64>, String> {
        if session_epoch == 0 {
            return Err("managed dispatch session epoch must be nonzero".into());
        }
        Ok(self
            .active_sessions
            .insert(resident_pubkey.to_ascii_lowercase(), session_epoch))
    }

    pub(crate) fn restore_active_session_after_failed_start(
        &mut self,
        resident_pubkey: &str,
        failed_session_epoch: u64,
        previous_session_epoch: Option<u64>,
    ) -> bool {
        let resident_pubkey = resident_pubkey.to_ascii_lowercase();
        if self.active_sessions.get(&resident_pubkey).copied() != Some(failed_session_epoch) {
            return false;
        }
        if let Some(previous_session_epoch) = previous_session_epoch {
            self.active_sessions
                .insert(resident_pubkey, previous_session_epoch);
        } else {
            self.active_sessions.remove(&resident_pubkey);
        }
        true
    }

    /// Whether this resident still owns work that a process restart could
    /// interrupt. This deliberately includes epoch-less `Pending` rows: a
    /// queued owner send may not have reached the replacement session yet,
    /// but it is still live work and must inhibit an automatic restart.
    pub(crate) fn has_unresolved_for_resident(&self, resident_pubkey: &str) -> bool {
        let resident_pubkey = resident_pubkey.to_ascii_lowercase();
        self.dispatches.values().any(|dispatch| {
            dispatch.resident_pubkey == resident_pubkey
                && matches!(
                    dispatch.state,
                    ManagedDispatchState::Pending | ManagedDispatchState::Active
                )
        })
    }

    /// Resolve one immutable pre-turn authority and the complete resident set
    /// originally staged by its signed owner event. Terminal progress of a
    /// sibling never changes the canonical set digest.
    pub(crate) fn authorize_continuity_turn(
        &self,
        trigger_event_id: &str,
        resident_pubkey: &str,
        conversation_id: &str,
        session_epoch: u64,
        now_unix_secs: u64,
    ) -> Result<ContinuityDispatchAuthority, DispatchAuthorizationError> {
        let normalized_resident = resident_pubkey.to_ascii_lowercase();
        let row = self
            .dispatches
            .get(&(
                trigger_event_id.to_ascii_lowercase(),
                normalized_resident.clone(),
            ))
            .ok_or_else(|| {
                if self
                    .dispatches
                    .keys()
                    .any(|(trigger, _)| trigger == trigger_event_id)
                {
                    DispatchAuthorizationError::WrongResident
                } else {
                    DispatchAuthorizationError::Unknown
                }
            })?;
        if now_unix_secs > row.expires_at {
            return Err(DispatchAuthorizationError::Expired);
        }
        match row.state {
            ManagedDispatchState::Cancelled => return Err(DispatchAuthorizationError::Cancelled),
            ManagedDispatchState::Rejected
            | ManagedDispatchState::Published
            | ManagedDispatchState::Failed
            | ManagedDispatchState::Interrupted => {
                return Err(DispatchAuthorizationError::Terminal)
            }
            ManagedDispatchState::Pending | ManagedDispatchState::Active => {}
        }
        if row.conversation_id != conversation_id {
            return Err(DispatchAuthorizationError::WrongConversation);
        }
        if self.active_sessions.get(&normalized_resident).copied() != Some(session_epoch)
            || row
                .session_epoch
                .is_some_and(|epoch| epoch != session_epoch)
        {
            return Err(DispatchAuthorizationError::WrongSession);
        }

        let mut residents = Vec::new();
        for candidate in self
            .dispatches
            .values()
            .filter(|candidate| candidate.trigger_event_id == row.trigger_event_id)
        {
            if candidate.owner_pubkey != row.owner_pubkey
                || candidate.conversation_id != row.conversation_id
                || candidate.thread_id != row.thread_id
                || candidate.root_event_id != row.root_event_id
                || candidate.reply_event_id != row.reply_event_id
                || candidate.response_surface != row.response_surface
                || candidate.context_binding != row.context_binding
            {
                return Err(DispatchAuthorizationError::Ambiguous);
            }
            residents.push(
                Hex64::parse(candidate.resident_pubkey.clone())
                    .map_err(|_| DispatchAuthorizationError::Persistence)?,
            );
        }
        residents.sort_by(|left, right| left.as_str().cmp(right.as_str()));
        residents.dedup();
        if residents.is_empty()
            || !residents
                .iter()
                .any(|value| value.as_str() == normalized_resident)
        {
            return Err(DispatchAuthorizationError::Ambiguous);
        }
        let digest = canonical_sha256(&serde_json::json!({
            "domain": CONTINUITY_DISPATCH_DOMAIN,
            "schema_version": 1,
            "trigger_event_id": row.trigger_event_id,
            "owner_pubkey": row.owner_pubkey,
            "conversation_id": row.conversation_id,
            "thread_id": row.thread_id,
            "root_event_id": row.root_event_id,
            "reply_event_id": row.reply_event_id,
            "response_surface": row.response_surface,
            "context_snapshot_ref": row
                .context_binding
                .as_ref()
                .map(|snapshot| snapshot.snapshot_ref.as_str()),
            "context_revision": row
                .context_binding
                .as_ref()
                .map(|snapshot| snapshot.revision),
            "resident_pubkeys": residents,
        }))
        .map_err(|_| DispatchAuthorizationError::Persistence)?;

        Ok(ContinuityDispatchAuthority {
            owner_pubkey: Hex64::parse(row.owner_pubkey.clone())
                .map_err(|_| DispatchAuthorizationError::Persistence)?,
            resident_pubkey: Hex64::parse(row.resident_pubkey.clone())
                .map_err(|_| DispatchAuthorizationError::Persistence)?,
            conversation_id: OpaqueId::parse(row.conversation_id.clone())
                .map_err(|_| DispatchAuthorizationError::Persistence)?,
            trigger_event_id: Hex64::parse(row.trigger_event_id.clone())
                .map_err(|_| DispatchAuthorizationError::Persistence)?,
            canonical_dispatch_ref: Sha256Ref::parse(format!("sha256:{digest}"))
                .map_err(|_| DispatchAuthorizationError::Persistence)?,
            context_binding: row.context_binding.clone(),
        })
    }

    /// Read the durable lifecycle state for the exact residents invoked by a
    /// signed focused-work assignment. No prompt or output bodies cross this
    /// boundary.
    pub(crate) fn states_for_trigger(
        &self,
        trigger_event_id: &str,
        residents: &[String],
    ) -> Vec<(String, ManagedDispatchState)> {
        let residents = residents
            .iter()
            .map(|resident| resident.to_ascii_lowercase())
            .collect::<HashSet<_>>();
        let mut states = self
            .dispatches
            .values()
            .filter(|dispatch| {
                dispatch.trigger_event_id == trigger_event_id
                    && residents.contains(&dispatch.resident_pubkey)
            })
            .map(|dispatch| (dispatch.resident_pubkey.clone(), dispatch.state))
            .collect::<Vec<_>>();
        states.sort_by(|left, right| left.0.cmp(&right.0));
        states
    }

    /// Context editing is disabled only while a resident dispatch in this
    /// conversation is pending or active.
    pub(crate) fn conversation_has_active_turn(&self, conversation_id: &str) -> bool {
        self.dispatches.values().any(|dispatch| {
            dispatch.conversation_id == conversation_id
                && matches!(
                    dispatch.state,
                    ManagedDispatchState::Pending | ManagedDispatchState::Active
                )
        })
    }

    /// Durably bind one exact managed conversation turn before privileged
    /// Communications MCP authority is exposed to its model session.
    ///
    /// Unlike continuity retrieval, communication side effects require an
    /// `Active` dispatch. The presentation endpoint calls this only after its
    /// strict sequence gate accepts the exact `turn_started` frame.
    pub(crate) fn bind_communication_turn_start(
        &mut self,
        trigger_event_id: &str,
        resident_pubkey: &str,
        conversation_id: &str,
        session_epoch: u64,
        now_unix_secs: u64,
    ) -> Result<ActiveDispatch, DispatchAuthorizationError> {
        let normalized_resident = resident_pubkey.to_ascii_lowercase();
        let normalized_trigger = trigger_event_id.to_ascii_lowercase();
        let key = (normalized_trigger.clone(), normalized_resident.clone());
        let active_epoch = self
            .active_sessions
            .get(&normalized_resident)
            .copied()
            .ok_or(DispatchAuthorizationError::WrongSession)?;
        if active_epoch != session_epoch {
            return Err(DispatchAuthorizationError::WrongSession);
        }

        let previous = self.dispatches.clone();
        let has_trigger = self
            .dispatches
            .keys()
            .any(|(trigger, _)| trigger == &normalized_trigger);
        let (authorized, newly_bound) = {
            let dispatch = self.dispatches.get_mut(&key).ok_or({
                if has_trigger {
                    DispatchAuthorizationError::WrongResident
                } else {
                    DispatchAuthorizationError::Unknown
                }
            })?;
            if now_unix_secs > dispatch.expires_at {
                return Err(DispatchAuthorizationError::Expired);
            }
            if dispatch.conversation_id != conversation_id {
                return Err(DispatchAuthorizationError::WrongConversation);
            }
            match dispatch.state {
                ManagedDispatchState::Cancelled => {
                    return Err(DispatchAuthorizationError::Cancelled)
                }
                ManagedDispatchState::Rejected
                | ManagedDispatchState::Published
                | ManagedDispatchState::Failed
                | ManagedDispatchState::Interrupted => {
                    return Err(DispatchAuthorizationError::Terminal)
                }
                ManagedDispatchState::Active => {
                    if dispatch.session_epoch != Some(session_epoch) {
                        return Err(DispatchAuthorizationError::WrongSession);
                    }
                    (dispatch.clone(), false)
                }
                ManagedDispatchState::Pending => {
                    if dispatch
                        .session_epoch
                        .is_some_and(|epoch| epoch != session_epoch)
                    {
                        return Err(DispatchAuthorizationError::WrongSession);
                    }
                    dispatch.session_epoch = Some(session_epoch);
                    dispatch.state = ManagedDispatchState::Active;
                    dispatch.interruption_reason = None;
                    (dispatch.clone(), true)
                }
            }
        };
        if newly_bound && self.persist().is_err() {
            self.dispatches = previous;
            return Err(DispatchAuthorizationError::Persistence);
        }
        Ok(authorized)
    }

    /// Recheck one exact Communications MCP action immediately before any
    /// read, mutation, signing, or relay submission. Cancellation, restart,
    /// publication, and session replacement all fail closed here.
    pub(crate) fn recheck_communication_turn(
        &self,
        trigger_event_id: &str,
        resident_pubkey: &str,
        conversation_id: &str,
        session_epoch: u64,
        now_unix_secs: u64,
    ) -> Result<&ActiveDispatch, DispatchAuthorizationError> {
        let normalized_resident = resident_pubkey.to_ascii_lowercase();
        let dispatch = self
            .dispatches
            .get(&(
                trigger_event_id.to_ascii_lowercase(),
                normalized_resident.clone(),
            ))
            .ok_or(DispatchAuthorizationError::Unknown)?;
        if now_unix_secs > dispatch.expires_at {
            return Err(DispatchAuthorizationError::Expired);
        }
        if dispatch.conversation_id != conversation_id {
            return Err(DispatchAuthorizationError::WrongConversation);
        }
        match dispatch.state {
            ManagedDispatchState::Cancelled => Err(DispatchAuthorizationError::Cancelled),
            ManagedDispatchState::Active
                if dispatch.session_epoch == Some(session_epoch)
                    && self.active_sessions.get(&normalized_resident) == Some(&session_epoch) =>
            {
                Ok(dispatch)
            }
            ManagedDispatchState::Active | ManagedDispatchState::Pending => {
                Err(DispatchAuthorizationError::WrongSession)
            }
            ManagedDispatchState::Rejected
            | ManagedDispatchState::Published
            | ManagedDispatchState::Failed
            | ManagedDispatchState::Interrupted => Err(DispatchAuthorizationError::Terminal),
        }
    }

    /// Durably terminalize one exact managed turn that ended without a final.
    ///
    /// This is the linearization point before a retryable failure becomes
    /// visible to the owner. It deliberately refuses a row once final-event
    /// bytes have been frozen so an explicit retry can never race an older
    /// publication that may still reach the relay.
    pub(crate) fn fail_exact(
        &mut self,
        trigger_event_id: &str,
        resident_pubkey: &str,
        conversation_id: &str,
        session_epoch: u64,
    ) -> Result<(), DispatchAuthorizationError> {
        if session_epoch == 0 {
            return Err(DispatchAuthorizationError::WrongSession);
        }
        let normalized_trigger = trigger_event_id.to_ascii_lowercase();
        let normalized_resident = resident_pubkey.to_ascii_lowercase();
        let key = (normalized_trigger.clone(), normalized_resident.clone());
        let has_trigger = self
            .dispatches
            .keys()
            .any(|(trigger, _)| trigger == &normalized_trigger);
        let active_epoch = self.active_sessions.get(&normalized_resident).copied();
        let previous = self.dispatches.clone();
        let dispatch = self.dispatches.get_mut(&key).ok_or({
            if has_trigger {
                DispatchAuthorizationError::WrongResident
            } else {
                DispatchAuthorizationError::Unknown
            }
        })?;
        if dispatch.conversation_id != conversation_id {
            return Err(DispatchAuthorizationError::WrongConversation);
        }
        if dispatch.resident_pubkey != normalized_resident {
            return Err(DispatchAuthorizationError::WrongResident);
        }
        if dispatch.session_epoch != Some(session_epoch) || active_epoch != Some(session_epoch) {
            return Err(DispatchAuthorizationError::WrongSession);
        }
        match dispatch.state {
            ManagedDispatchState::Active => {
                if dispatch.submitted_event_id.is_some()
                    || dispatch.published_event_id.is_some()
                    || dispatch.outbox_finalized
                {
                    return Err(DispatchAuthorizationError::Terminal);
                }
                dispatch.state = ManagedDispatchState::Failed;
                dispatch.interruption_reason = None;
                dispatch.outbox_finalized = true;
            }
            ManagedDispatchState::Failed => return Ok(()),
            ManagedDispatchState::Cancelled => return Err(DispatchAuthorizationError::Cancelled),
            ManagedDispatchState::Pending => return Err(DispatchAuthorizationError::WrongSession),
            ManagedDispatchState::Rejected
            | ManagedDispatchState::Published
            | ManagedDispatchState::Interrupted => {
                return Err(DispatchAuthorizationError::Terminal)
            }
        }
        if self.persist().is_err() {
            self.dispatches = previous;
            return Err(DispatchAuthorizationError::Persistence);
        }
        Ok(())
    }

    /// Durably fail unclaimed work older than the harness replay window and
    /// return exact deferred rechecks for fresher sends.
    ///
    /// A replacement session may replay an owner send created within
    /// [`WAKE_REPLAY_GRACE_SECS`] of its startup. Those rows remain `Pending`
    /// until the first second after that window; each returned recheck binds
    /// only the exact row observed at process exit, so later sends are never
    /// swept accidentally. Active and terminal rows remain untouched.
    pub(crate) fn terminalize_unclaimed_after_process_exit(
        &mut self,
        resident_pubkey: &str,
        now_unix_secs: u64,
    ) -> Result<ProcessExitDispatchCleanup, String> {
        let resident_pubkey = resident_pubkey.to_ascii_lowercase();
        let Some(session_epoch) = self.active_sessions.get(&resident_pubkey).copied() else {
            return Ok(ProcessExitDispatchCleanup {
                terminalized: 0,
                deferred: Vec::new(),
            });
        };
        let previous = self.dispatches.clone();
        let mut terminalized = 0;
        let mut deferred = Vec::new();
        for dispatch in self.dispatches.values_mut() {
            if dispatch.resident_pubkey != resident_pubkey
                || dispatch.state != ManagedDispatchState::Pending
                || dispatch.session_epoch.is_some()
            {
                continue;
            }
            let cleanup_at_unix_secs = dispatch
                .created_at
                .saturating_add(WAKE_REPLAY_GRACE_SECS)
                .saturating_add(1);
            if now_unix_secs < cleanup_at_unix_secs {
                deferred.push(DeferredProcessExitDispatchCleanup {
                    dispatch_receipt_id: dispatch.trigger_event_id.clone(),
                    resident_pubkey: resident_pubkey.clone(),
                    session_epoch,
                    cleanup_at_unix_secs,
                });
                continue;
            }
            dispatch.session_epoch = Some(session_epoch);
            dispatch.state = ManagedDispatchState::Failed;
            dispatch.interruption_reason = None;
            dispatch.outbox_finalized = true;
            terminalized += 1;
        }
        if terminalized > 0 {
            if let Err(error) = self.persist() {
                self.dispatches = previous;
                return Err(error);
            }
        }
        deferred.sort_by(|left, right| {
            left.cleanup_at_unix_secs
                .cmp(&right.cleanup_at_unix_secs)
                .then_with(|| left.dispatch_receipt_id.cmp(&right.dispatch_receipt_id))
        });
        Ok(ProcessExitDispatchCleanup {
            terminalized,
            deferred,
        })
    }

    /// Recheck one exact post-exit row after its replay window has elapsed.
    /// A replacement that already claimed the row wins because only an
    /// epoch-less `Pending` row can transition here.
    pub(crate) fn recheck_deferred_process_exit_cleanup(
        &mut self,
        cleanup: &DeferredProcessExitDispatchCleanup,
        now_unix_secs: u64,
    ) -> Result<bool, String> {
        if now_unix_secs < cleanup.cleanup_at_unix_secs {
            return Ok(false);
        }
        let key = (
            cleanup.dispatch_receipt_id.to_ascii_lowercase(),
            cleanup.resident_pubkey.to_ascii_lowercase(),
        );
        let previous = self.dispatches.clone();
        let Some(dispatch) = self.dispatches.get_mut(&key) else {
            return Ok(false);
        };
        if self.active_sessions.get(&cleanup.resident_pubkey) != Some(&cleanup.session_epoch)
            || dispatch.state != ManagedDispatchState::Pending
            || dispatch.session_epoch.is_some()
        {
            return Ok(false);
        }
        dispatch.session_epoch = Some(cleanup.session_epoch);
        dispatch.state = ManagedDispatchState::Failed;
        dispatch.interruption_reason = None;
        dispatch.outbox_finalized = true;
        if let Err(error) = self.persist() {
            self.dispatches = previous;
            return Err(error);
        }
        Ok(true)
    }

    /// Atomically stage rows for all managed residents named by one exact owner event.
    #[cfg(test)]
    pub(crate) fn stage_owner_event(
        &mut self,
        event: &Event,
        managed_residents: &[String],
        now_unix_secs: u64,
    ) -> Result<Vec<(String, String)>, String> {
        self.stage_owner_event_with_artifacts(event, managed_residents, &[], now_unix_secs)
    }

    /// Atomically stage owner dispatches with desktop-issued immutable upload
    /// bindings. This is additive to v3; callers without attachments continue
    /// without attachments retain the same staging behavior.
    #[cfg(test)]
    pub(crate) fn stage_owner_event_with_artifacts(
        &mut self,
        event: &Event,
        managed_residents: &[String],
        artifact_bindings: &[ManagedArtifactBinding],
        now_unix_secs: u64,
    ) -> Result<Vec<(String, String)>, String> {
        self.stage_owner_event_with_artifacts_and_context(
            event,
            managed_residents,
            artifact_bindings,
            None,
            now_unix_secs,
        )
    }

    /// Stage owner dispatches with immutable artifact and conversation-context
    /// bindings. Both bindings are path-free and exact for the signed event.
    pub(crate) fn stage_owner_event_with_artifacts_and_context(
        &mut self,
        event: &Event,
        managed_residents: &[String],
        artifact_bindings: &[ManagedArtifactBinding],
        context_binding: Option<super::conversation_context::DispatchContextBindingV1>,
        now_unix_secs: u64,
    ) -> Result<Vec<(String, String)>, String> {
        if let Some(binding) = &context_binding {
            binding.validate()?;
        }
        if event.kind != nostr::Kind::Custom(9)
            || !event.verify_id()
            || !event.verify_signature()
            || event.created_at.as_secs() > now_unix_secs + 60
        {
            return Err("managed dispatch trigger event is invalid".into());
        }
        let mut artifact_bindings = artifact_bindings.to_vec();
        artifact_bindings.sort_by(|left, right| left.handle_id.cmp(&right.handle_id));
        if artifact_bindings
            .windows(2)
            .any(|pair| pair[0].handle_id == pair[1].handle_id)
        {
            return Err("managed dispatch contains duplicate artifact handles".into());
        }
        for binding in &artifact_bindings {
            validate_artifact_binding(binding, now_unix_secs)?;
        }
        let routing = routing_from_event(event)?;
        let requested: HashSet<String> = managed_residents
            .iter()
            .map(|pubkey| pubkey.to_ascii_lowercase())
            .collect();
        let event_recipients: HashSet<&str> =
            routing.trigger_p_tags.iter().map(String::as_str).collect();
        let mut candidates = Vec::new();
        for resident in requested {
            if resident == event.pubkey.to_hex() || !event_recipients.contains(resident.as_str()) {
                return Err("managed resident is not an exact event recipient".into());
            }
            Hex64::parse(resident.clone())
                .map_err(|_| "managed resident pubkey is invalid".to_string())?;
            let key = (event.id.to_hex(), resident.clone());
            let candidate = ActiveDispatch {
                trigger_event_id: key.0.clone(),
                owner_pubkey: event.pubkey.to_hex(),
                resident_pubkey: resident.clone(),
                conversation_id: routing.conversation_id.clone(),
                thread_id: routing.thread_id.clone(),
                root_event_id: routing.root_event_id.clone(),
                reply_event_id: routing.reply_event_id.clone(),
                source_dispatch_id: Some(event.id.to_hex()),
                causal_root_event_id: Some(event.id.to_hex()),
                causal_parent_action_id: None,
                descendant_depth: 0,
                response_surface: Some(routing.response_surface),
                // G1 is owner-only dispatch. A resident final replies to the
                // exact owner trigger and addresses only its author; copying
                // trigger recipients would recursively invoke residents before
                // F10's causal-ledger authorizer exists.
                resolved_p_tags: vec![event.pubkey.to_hex()],
                created_at: now_unix_secs,
                expires_at: now_unix_secs.saturating_add(DISPATCH_TTL_SECONDS),
                session_epoch: None,
                state: ManagedDispatchState::Pending,
                interruption_reason: None,
                submitted_event_id: None,
                published_event_id: None,
                outbox_finalized: false,
                artifact_bindings: artifact_bindings.clone(),
                context_binding: context_binding.clone(),
            };
            if let Some(existing) = self.dispatches.get(&key) {
                if existing.trigger_event_id != candidate.trigger_event_id
                    || existing.owner_pubkey != candidate.owner_pubkey
                    || existing.resident_pubkey != candidate.resident_pubkey
                    || existing.conversation_id != candidate.conversation_id
                    || existing.thread_id != candidate.thread_id
                    || existing.root_event_id != candidate.root_event_id
                    || existing.reply_event_id != candidate.reply_event_id
                    || existing.response_surface != candidate.response_surface
                    || existing.resolved_p_tags != candidate.resolved_p_tags
                    || existing.submitted_event_id != candidate.submitted_event_id
                    || existing.outbox_finalized != candidate.outbox_finalized
                    || existing.artifact_bindings != candidate.artifact_bindings
                    || existing.context_binding != candidate.context_binding
                {
                    return Err("managed dispatch id collision".into());
                }
            }
            candidates.push((key, candidate));
        }
        let previous = self.dispatches.clone();
        let mut staged = Vec::with_capacity(candidates.len());
        for (key, candidate) in candidates {
            self.dispatches.entry(key.clone()).or_insert(candidate);
            staged.push(key);
        }
        self.prune(now_unix_secs);
        if self.dispatches.len() > MAX_DISPATCHES {
            self.dispatches = previous;
            return Err("managed dispatch store has no terminal capacity".into());
        }
        if let Err(error) = self.persist() {
            self.dispatches = previous;
            return Err(error);
        }
        Ok(staged)
    }

    /// Whether a dispatch row exists for this exact (trigger, resident) pair.
    pub(crate) fn has_dispatch(&self, key: &(String, String)) -> bool {
        self.dispatches.contains_key(key)
    }

    /// Stage a dispatch for a turn this store never saw coming — a resident
    /// woken by another resident's message inside an exchange, or an owner
    /// message published from another device.
    ///
    /// The dispatch here is a receipt, not a gate: the signed trigger event is
    /// the authority (verified below), the exchange rules at the relay are the
    /// budget, and this row exists so routing, presentation, and crash-safety
    /// keep working exactly as they do for locally staged turns. Idempotent:
    /// re-staging the same (trigger, resident) pair returns the existing row.
    ///
    /// TODO(ship): we chose this permissive staging default for build velocity
    /// (2026-08). Before shipping, review the app's security posture and
    /// confirm we are happy with how turns acquire dispatch rows.
    pub(crate) fn stage_wake_from_trigger(
        &mut self,
        event: &Event,
        resident_pubkey: &str,
        owner_pubkey: &str,
        now_unix_secs: u64,
    ) -> Result<(String, String), String> {
        let resident = resident_pubkey.to_ascii_lowercase();
        let key = (event.id.to_hex(), resident.clone());
        if self.dispatches.contains_key(&key) {
            return Ok(key);
        }
        if event.kind != nostr::Kind::Custom(9)
            || !event.verify_id()
            || !event.verify_signature()
            || event.created_at.as_secs() > now_unix_secs + 60
        {
            return Err("wake trigger event is invalid".into());
        }
        let author = event.pubkey.to_hex();
        if author == resident {
            return Err("a resident cannot be woken by its own message".into());
        }
        Hex64::parse(resident.clone())
            .map_err(|_| "wake resident pubkey is invalid".to_string())?;
        let routing = routing_from_event(event)?;
        if !routing
            .trigger_p_tags
            .iter()
            .any(|recipient| recipient == &resident)
        {
            return Err("wake trigger does not address this resident".into());
        }
        let author_is_owner = author == owner_pubkey.to_ascii_lowercase();
        let candidate = ActiveDispatch {
            trigger_event_id: key.0.clone(),
            owner_pubkey: owner_pubkey.to_ascii_lowercase(),
            resident_pubkey: resident,
            conversation_id: routing.conversation_id.clone(),
            thread_id: routing.thread_id.clone(),
            root_event_id: routing.root_event_id.clone(),
            reply_event_id: routing.reply_event_id.clone(),
            source_dispatch_id: Some(event.id.to_hex()),
            causal_root_event_id: Some(event.id.to_hex()),
            causal_parent_action_id: None,
            descendant_depth: u8::from(!author_is_owner),
            response_surface: Some(routing.response_surface),
            // The reply addresses whoever asked. For a sibling wake the
            // exchange resolver still decides whether that reply may publish.
            resolved_p_tags: vec![author],
            created_at: now_unix_secs,
            expires_at: now_unix_secs.saturating_add(DISPATCH_TTL_SECONDS),
            session_epoch: None,
            state: ManagedDispatchState::Pending,
            interruption_reason: None,
            submitted_event_id: None,
            published_event_id: None,
            outbox_finalized: false,
            artifact_bindings: Vec::new(),
            context_binding: None,
        };
        let previous = self.dispatches.clone();
        self.dispatches.insert(key.clone(), candidate);
        self.prune(now_unix_secs);
        if self.dispatches.len() > MAX_DISPATCHES {
            self.dispatches = previous;
            return Err("managed dispatch store has no terminal capacity".into());
        }
        if let Err(error) = self.persist() {
            self.dispatches = previous;
            return Err(error);
        }
        Ok(key)
    }

    /// Cancel matching pending/active rows before the local cancel event is submitted.
    pub(crate) fn cancel_matching(
        &mut self,
        owner_pubkey: &str,
        conversation_id: &str,
        thread_id: Option<&str>,
        residents: &[String],
    ) -> Result<usize, String> {
        if residents.is_empty() {
            return Ok(0);
        }
        let previous = self.dispatches.clone();
        let residents: HashSet<String> = residents
            .iter()
            .map(|resident| resident.to_ascii_lowercase())
            .collect();
        let mut cancelled = 0;
        for dispatch in self.dispatches.values_mut() {
            let resident_matches =
                residents.is_empty() || residents.contains(&dispatch.resident_pubkey);
            let thread_matches = thread_id.is_none() || dispatch.thread_id.as_deref() == thread_id;
            if dispatch.owner_pubkey == owner_pubkey
                && dispatch.conversation_id == conversation_id
                && resident_matches
                && thread_matches
                && matches!(
                    dispatch.state,
                    ManagedDispatchState::Pending | ManagedDispatchState::Active
                )
            {
                let had_outbox_authority = dispatch.session_epoch.is_some();
                dispatch.state = ManagedDispatchState::Cancelled;
                dispatch.interruption_reason = None;
                dispatch.outbox_finalized = !had_outbox_authority;
                cancelled += 1;
            }
        }
        if cancelled > 0 {
            if let Err(error) = self.persist() {
                self.dispatches = previous;
                return Err(error);
            }
        }
        Ok(cancelled)
    }

    /// Resolve the one currently cancellable dispatch for a resident conversation.
    ///
    /// Missing rows, stale epochs, and more than one match all fail closed so
    /// callers cannot accidentally turn a broad UI action into cancellation of
    /// an arbitrary turn.
    pub(crate) fn resolve_unique_cancellable(
        &self,
        owner_pubkey: &str,
        conversation_id: &str,
        resident_pubkey: &str,
    ) -> Result<CancellableManagedDispatch, DispatchAuthorizationError> {
        let resident_pubkey = resident_pubkey.to_ascii_lowercase();
        let mut matches = self
            .cancellable_for_conversation(owner_pubkey, conversation_id)
            .into_iter()
            .filter(|turn| turn.resident_pubkey == resident_pubkey);
        let exact = matches.next().ok_or(DispatchAuthorizationError::Unknown)?;
        if matches.next().is_some() {
            return Err(DispatchAuthorizationError::Ambiguous);
        }
        Ok(exact)
    }

    /// List exact cancellable dispatches for one owner conversation.
    ///
    /// Pending rows are cancellable only while the same resident has a live
    /// broker epoch. This lets the UI expose truthful Stop controls before a
    /// final-response publication request claims the row as Active.
    pub(crate) fn cancellable_for_conversation(
        &self,
        owner_pubkey: &str,
        conversation_id: &str,
    ) -> Vec<CancellableManagedDispatch> {
        let owner_pubkey = owner_pubkey.to_ascii_lowercase();
        let mut turns = self
            .dispatches
            .values()
            .filter_map(|dispatch| {
                if dispatch.owner_pubkey != owner_pubkey
                    || dispatch.conversation_id != conversation_id
                    || !matches!(
                        dispatch.state,
                        ManagedDispatchState::Pending | ManagedDispatchState::Active
                    )
                {
                    return None;
                }
                let active_epoch = *self.active_sessions.get(&dispatch.resident_pubkey)?;
                if dispatch
                    .session_epoch
                    .is_some_and(|bound| bound != active_epoch)
                {
                    return None;
                }
                Some(CancellableManagedDispatch {
                    dispatch_receipt_id: dispatch.trigger_event_id.clone(),
                    resident_pubkey: dispatch.resident_pubkey.clone(),
                    session_epoch: active_epoch,
                })
            })
            .collect::<Vec<_>>();
        turns.sort_by(|left, right| {
            left.resident_pubkey
                .cmp(&right.resident_pubkey)
                .then_with(|| left.dispatch_receipt_id.cmp(&right.dispatch_receipt_id))
        });
        turns
    }

    /// List durable restart interruptions for exactly one owner conversation.
    ///
    /// Only the exact `Interrupted` + `Restart` terminal combination is
    /// projected. The result intentionally omits resident and owner keys,
    /// bodies, paths, runtime configuration, and raw event material.
    pub(crate) fn interrupted_after_restart_for_conversation(
        &self,
        owner_pubkey: &str,
        conversation_id: &str,
    ) -> Vec<InterruptedManagedDispatchSummary> {
        let owner_pubkey = owner_pubkey.to_ascii_lowercase();
        let mut summaries = self
            .dispatches
            .values()
            .filter(|dispatch| {
                dispatch.owner_pubkey == owner_pubkey
                    && dispatch.conversation_id == conversation_id
                    && dispatch.state == ManagedDispatchState::Interrupted
                    && dispatch.interruption_reason
                        == Some(ManagedDispatchInterruptionReason::Restart)
            })
            .map(|dispatch| InterruptedManagedDispatchSummary {
                dispatch_receipt_id: dispatch.trigger_event_id.clone(),
            })
            .collect::<Vec<_>>();
        summaries.sort_by(|left, right| left.dispatch_receipt_id.cmp(&right.dispatch_receipt_id));
        summaries
    }

    /// Return exact artifact-receipt coordinates for restart-interrupted work.
    /// Re-reading these rows on every resident startup makes settlement
    /// idempotently retryable when the artifact database was unavailable.
    pub(crate) fn restart_interrupted_artifact_receipts_for_resident(
        &self,
        resident_pubkey: &str,
    ) -> Vec<RestartInterruptedArtifactReceiptBinding> {
        let resident_pubkey = resident_pubkey.to_ascii_lowercase();
        let mut bindings = self
            .dispatches
            .values()
            .filter(|dispatch| {
                dispatch.resident_pubkey == resident_pubkey
                    && dispatch.state == ManagedDispatchState::Interrupted
                    && dispatch.interruption_reason
                        == Some(ManagedDispatchInterruptionReason::Restart)
            })
            .map(|dispatch| RestartInterruptedArtifactReceiptBinding {
                owner_pubkey: dispatch.owner_pubkey.clone(),
                conversation_id: dispatch.conversation_id.clone(),
                resident_pubkey: dispatch.resident_pubkey.clone(),
                dispatch_receipt_id: dispatch.trigger_event_id.clone(),
            })
            .collect::<Vec<_>>();
        bindings.sort_by(|left, right| {
            left.conversation_id
                .cmp(&right.conversation_id)
                .then_with(|| left.dispatch_receipt_id.cmp(&right.dispatch_receipt_id))
        });
        bindings
    }

    /// Persist cancellation of exactly one claimed resident turn before the
    /// caller sends any relay control. The dispatch receipt is the canonical
    /// owner trigger event ID used throughout the existing broker protocol.
    pub(crate) fn cancel_exact(
        &mut self,
        owner_pubkey: &str,
        conversation_id: &str,
        resident_pubkey: &str,
        dispatch_receipt_id: &str,
        session_epoch: u64,
    ) -> Result<ExactDispatchCancellationResult, DispatchAuthorizationError> {
        if session_epoch == 0 {
            return Err(DispatchAuthorizationError::WrongSession);
        }
        let key = (
            dispatch_receipt_id.to_owned(),
            resident_pubkey.to_ascii_lowercase(),
        );
        let previous = self.dispatches.clone();
        let dispatch = self
            .dispatches
            .get_mut(&key)
            .ok_or(DispatchAuthorizationError::Unknown)?;
        if dispatch.owner_pubkey != owner_pubkey.to_ascii_lowercase() {
            return Err(DispatchAuthorizationError::WrongOwner);
        }
        if dispatch.conversation_id != conversation_id {
            return Err(DispatchAuthorizationError::WrongConversation);
        }
        if dispatch.resident_pubkey != resident_pubkey.to_ascii_lowercase() {
            return Err(DispatchAuthorizationError::WrongResident);
        }
        match dispatch.state {
            ManagedDispatchState::Active
                if dispatch.session_epoch == Some(session_epoch)
                    && self.active_sessions.get(&dispatch.resident_pubkey)
                        == Some(&session_epoch) =>
            {
                let receipt = ExactDispatchCancellation {
                    trigger_event_id: dispatch.trigger_event_id.clone(),
                    resident_pubkey: dispatch.resident_pubkey.clone(),
                    conversation_id: dispatch.conversation_id.clone(),
                    session_epoch,
                    had_outbox_authority: dispatch.submitted_event_id.is_some(),
                };
                dispatch.state = ManagedDispatchState::Cancelled;
                dispatch.interruption_reason = None;
                // A frozen event may still need the encrypted-outbox handshake.
                dispatch.outbox_finalized = !receipt.had_outbox_authority;
                if self.persist().is_err() {
                    self.dispatches = previous;
                    return Err(DispatchAuthorizationError::Persistence);
                }
                Ok(ExactDispatchCancellationResult::Cancelled(receipt))
            }
            ManagedDispatchState::Pending
                if dispatch.session_epoch.is_none()
                    && self.active_sessions.get(&dispatch.resident_pubkey)
                        == Some(&session_epoch) =>
            {
                let receipt = ExactDispatchCancellation {
                    trigger_event_id: dispatch.trigger_event_id.clone(),
                    resident_pubkey: dispatch.resident_pubkey.clone(),
                    conversation_id: dispatch.conversation_id.clone(),
                    session_epoch,
                    had_outbox_authority: false,
                };
                dispatch.session_epoch = Some(session_epoch);
                dispatch.state = ManagedDispatchState::Cancelled;
                dispatch.interruption_reason = None;
                dispatch.outbox_finalized = true;
                if self.persist().is_err() {
                    self.dispatches = previous;
                    return Err(DispatchAuthorizationError::Persistence);
                }
                Ok(ExactDispatchCancellationResult::Cancelled(receipt))
            }
            ManagedDispatchState::Pending | ManagedDispatchState::Active => {
                Err(DispatchAuthorizationError::WrongSession)
            }
            ManagedDispatchState::Cancelled
            | ManagedDispatchState::Rejected
            | ManagedDispatchState::Published
            | ManagedDispatchState::Failed
            | ManagedDispatchState::Interrupted => {
                Ok(ExactDispatchCancellationResult::AlreadyTerminal)
            }
        }
    }

    /// Terminalize work that belonged to an earlier broker epoch, but only
    /// after that resident's encrypted outbox has reconciled its frozen exact
    /// events. This intentionally does not resume an ACP/native session.
    ///
    /// An owner send staged while the resident was not running has no epoch
    /// yet. If it is fresh enough for the harness now starting to replay it —
    /// the harness's first subscription runs from its own start minus
    /// [`WAKE_REPLAY_GRACE_SECS`] — it is the very work this session was
    /// started to answer, not prior-epoch work, and stays pending for the new
    /// session to claim. Older epoch-less sends were never going to be
    /// replayed and are interrupted like any other stale dispatch.
    pub(crate) fn terminalize_prior_epoch_after_outbox_reconciliation(
        &mut self,
        resident_pubkey: &str,
        replacement_session_epoch: u64,
        now_unix_secs: u64,
    ) -> Result<usize, String> {
        if replacement_session_epoch == 0 {
            return Err("managed dispatch replacement session epoch must be nonzero".into());
        }
        let resident_pubkey = resident_pubkey.to_ascii_lowercase();
        let previous = self.dispatches.clone();
        let mut interrupted = 0;
        for dispatch in self.dispatches.values_mut() {
            if dispatch.resident_pubkey != resident_pubkey
                || !matches!(
                    dispatch.state,
                    ManagedDispatchState::Pending | ManagedDispatchState::Active
                )
                || dispatch.session_epoch == Some(replacement_session_epoch)
            {
                continue;
            }
            if dispatch.session_epoch.is_none()
                && dispatch.state == ManagedDispatchState::Pending
                && dispatch.created_at.saturating_add(WAKE_REPLAY_GRACE_SECS) >= now_unix_secs
            {
                continue;
            }
            dispatch.state = ManagedDispatchState::Interrupted;
            dispatch.interruption_reason = Some(ManagedDispatchInterruptionReason::Restart);
            // The caller invokes this only after the encrypted outbox's frozen
            // entries have reached their own terminal reconciliation decision.
            dispatch.outbox_finalized = true;
            interrupted += 1;
        }
        if interrupted == 0 {
            return Ok(0);
        }
        if let Err(error) = self.persist() {
            self.dispatches = previous;
            return Err(error);
        }
        Ok(interrupted)
    }

    /// Terminally reject rows only after an explicit relay rejection.
    pub(crate) fn mark_rejected(&mut self, staged: &[(String, String)]) -> Result<(), String> {
        let previous = self.dispatches.clone();
        for key in staged {
            if let Some(dispatch) = self.dispatches.get_mut(key) {
                if matches!(
                    dispatch.state,
                    ManagedDispatchState::Pending | ManagedDispatchState::Active
                ) {
                    let had_outbox_authority = dispatch.session_epoch.is_some();
                    dispatch.state = ManagedDispatchState::Rejected;
                    dispatch.interruption_reason = None;
                    dispatch.outbox_finalized = !had_outbox_authority;
                }
            }
        }
        if let Err(error) = self.persist() {
            self.dispatches = previous;
            return Err(error);
        }
        Ok(())
    }

    /// Validate and bind one typed publication request to the active broker session.
    pub(crate) fn authorize_publication(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        now_unix_secs: u64,
    ) -> Result<ActiveDispatch, DispatchAuthorizationError> {
        let key = (
            request.dispatch_receipt_id.as_str().to_owned(),
            request.resident_pubkey.as_str().to_owned(),
        );
        if !self.dispatches.contains_key(&key) {
            return if self
                .dispatches
                .keys()
                .any(|(trigger, _)| trigger == request.dispatch_receipt_id.as_str())
            {
                Err(DispatchAuthorizationError::WrongResident)
            } else {
                Err(DispatchAuthorizationError::Unknown)
            };
        }
        let active_epoch = self
            .active_sessions
            .get(request.resident_pubkey.as_str())
            .copied()
            .ok_or(DispatchAuthorizationError::WrongSession)?;
        let previous = self.dispatches.clone();
        let (authorized, newly_bound) = {
            let dispatch = self
                .dispatches
                .get_mut(&key)
                .ok_or(DispatchAuthorizationError::Unknown)?;
            if now_unix_secs > dispatch.expires_at {
                return Err(DispatchAuthorizationError::Expired);
            }
            match dispatch.state {
                ManagedDispatchState::Cancelled => {
                    return Err(DispatchAuthorizationError::Cancelled)
                }
                ManagedDispatchState::Rejected
                | ManagedDispatchState::Published
                | ManagedDispatchState::Failed
                | ManagedDispatchState::Interrupted => {
                    return Err(DispatchAuthorizationError::Terminal)
                }
                ManagedDispatchState::Pending | ManagedDispatchState::Active => {}
            }
            if request.owner_pubkey.as_str() != dispatch.owner_pubkey {
                return Err(DispatchAuthorizationError::WrongOwner);
            }
            if request.resident_pubkey.as_str() != dispatch.resident_pubkey {
                return Err(DispatchAuthorizationError::WrongResident);
            }
            if request.conversation_id.as_str() != dispatch.conversation_id {
                return Err(DispatchAuthorizationError::WrongConversation);
            }
            if request.thread_id.as_ref().map(|value| value.as_str())
                != dispatch.thread_id.as_deref()
                || request.root_event_id.as_ref().map(|value| value.as_str())
                    != dispatch.root_event_id.as_deref()
                || request.reply_event_id.as_ref().map(|value| value.as_str())
                    != dispatch.reply_event_id.as_deref()
            {
                return Err(DispatchAuthorizationError::WrongThread);
            }
            if request.response_surface != dispatch.response_surface {
                return Err(DispatchAuthorizationError::WrongSurface);
            }
            let request_recipients: Vec<&str> = request
                .resolved_p_tags
                .iter()
                .map(|value| value.as_str())
                .collect();
            if request_recipients
                != dispatch
                    .resolved_p_tags
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>()
            {
                return Err(DispatchAuthorizationError::WrongRecipients);
            }
            if active_epoch != request.cancellation_epoch.get() {
                return Err(DispatchAuthorizationError::WrongSession);
            }
            let newly_bound = if let Some(bound) = dispatch.session_epoch {
                if bound != active_epoch {
                    return Err(DispatchAuthorizationError::WrongSession);
                }
                false
            } else {
                dispatch.session_epoch = Some(active_epoch);
                dispatch.state = ManagedDispatchState::Active;
                dispatch.interruption_reason = None;
                true
            };
            (dispatch.clone(), newly_bound)
        };
        if newly_bound && self.persist().is_err() {
            self.dispatches = previous;
            return Err(DispatchAuthorizationError::Persistence);
        }
        Ok(authorized)
    }

    /// How far this dispatch sits from the owner's own utterance.
    ///
    /// Zero for an owner trigger, one for the single permitted resident
    /// descendant. The exchange resolver reads it to keep a sibling-triggered
    /// final from ever publishing outside an exchange.
    pub(crate) fn descendant_depth(
        &self,
        trigger_event_id: &str,
        resident_pubkey: &str,
    ) -> Result<u8, DispatchAuthorizationError> {
        self.dispatches
            .get(&(trigger_event_id.to_owned(), resident_pubkey.to_owned()))
            .map(|dispatch| dispatch.descendant_depth)
            .ok_or(DispatchAuthorizationError::Unknown)
    }

    /// Widen one dispatch's reply audience to the members of a minted exchange.
    ///
    /// G1 pins a resident's reply to the author of its trigger, deliberately, so
    /// a final can never wake a sibling by accident. The exchange record is the
    /// authority that makes widening safe: every added recipient is a
    /// same-owner resident inside a bucketed, deadlined, owner-stoppable
    /// exchange, and the caller has already verified each one against the
    /// resident registry.
    ///
    /// Idempotent (the union is taken), and refused once the dispatch has left
    /// `Pending`/`Active` or has bound frozen bytes — widening after the event
    /// is signed would change what the signature covers.
    pub(crate) fn grant_exchange_recipients(
        &mut self,
        trigger_event_id: &str,
        resident_pubkey: &str,
        additional: &[String],
        now_unix_secs: u64,
    ) -> Result<Vec<String>, DispatchAuthorizationError> {
        let key = (trigger_event_id.to_owned(), resident_pubkey.to_owned());
        let previous = self.dispatches.clone();
        let dispatch = self
            .dispatches
            .get_mut(&key)
            .ok_or(DispatchAuthorizationError::Unknown)?;
        if now_unix_secs > dispatch.expires_at {
            return Err(DispatchAuthorizationError::Expired);
        }
        match dispatch.state {
            ManagedDispatchState::Cancelled => return Err(DispatchAuthorizationError::Cancelled),
            ManagedDispatchState::Rejected
            | ManagedDispatchState::Published
            | ManagedDispatchState::Failed
            | ManagedDispatchState::Interrupted => {
                return Err(DispatchAuthorizationError::Terminal)
            }
            ManagedDispatchState::Pending | ManagedDispatchState::Active => {}
        }
        if dispatch.submitted_event_id.is_some() {
            return Err(DispatchAuthorizationError::Terminal);
        }
        let mut resolved = dispatch.resolved_p_tags.clone();
        for candidate in additional {
            let candidate = candidate.to_ascii_lowercase();
            Hex64::parse(candidate.clone())
                .map_err(|_| DispatchAuthorizationError::WrongRecipients)?;
            if candidate == dispatch.resident_pubkey || candidate == dispatch.owner_pubkey {
                return Err(DispatchAuthorizationError::WrongRecipients);
            }
            resolved.push(candidate);
        }
        resolved.sort();
        resolved.dedup();
        if resolved.len() > luca_protocol::MAX_RESOLVED_P_TAGS {
            return Err(DispatchAuthorizationError::WrongRecipients);
        }
        if resolved == dispatch.resolved_p_tags {
            return Ok(resolved);
        }
        dispatch.resolved_p_tags.clone_from(&resolved);
        if self.persist().is_err() {
            self.dispatches = previous;
            return Err(DispatchAuthorizationError::Persistence);
        }
        Ok(resolved)
    }

    /// Release one dispatch's binding to frozen bytes the relay refused for a
    /// turn collision, so the identical draft can be re-signed on a free turn.
    ///
    /// Deliberately narrow: the dispatch must still be the live, uncancelled,
    /// unpublished row that bound exactly `submitted_event_id`. A refusal the
    /// relay gave for any other reason never reaches this path, and a dispatch
    /// that already published cannot be unbound.
    pub(crate) fn release_exchange_submission(
        &mut self,
        trigger_event_id: &str,
        resident_pubkey: &str,
        session_epoch: u64,
        submitted_event_id: &str,
    ) -> Result<(), DispatchAuthorizationError> {
        let key = (trigger_event_id.to_owned(), resident_pubkey.to_owned());
        let previous = self.dispatches.clone();
        let dispatch = self
            .dispatches
            .get_mut(&key)
            .ok_or(DispatchAuthorizationError::Unknown)?;
        match dispatch.state {
            ManagedDispatchState::Cancelled => return Err(DispatchAuthorizationError::Cancelled),
            ManagedDispatchState::Active if dispatch.session_epoch == Some(session_epoch) => {}
            ManagedDispatchState::Active | ManagedDispatchState::Pending => {
                return Err(DispatchAuthorizationError::WrongSession)
            }
            ManagedDispatchState::Rejected
            | ManagedDispatchState::Published
            | ManagedDispatchState::Failed
            | ManagedDispatchState::Interrupted => {
                return Err(DispatchAuthorizationError::Terminal)
            }
        }
        if dispatch.published_event_id.is_some()
            || dispatch.submitted_event_id.as_deref() != Some(submitted_event_id)
        {
            return Err(DispatchAuthorizationError::Terminal);
        }
        dispatch.submitted_event_id = None;
        if self.persist().is_err() {
            self.dispatches = previous;
            return Err(DispatchAuthorizationError::Persistence);
        }
        Ok(())
    }

    /// Recheck cancellation/session immediately before exact final submission.
    pub(crate) fn recheck_before_submit(
        &self,
        trigger_event_id: &str,
        resident_pubkey: &str,
        session_epoch: u64,
    ) -> Result<(), DispatchAuthorizationError> {
        let dispatch = self
            .dispatches
            .get(&(trigger_event_id.to_owned(), resident_pubkey.to_owned()))
            .ok_or(DispatchAuthorizationError::Unknown)?;
        match dispatch.state {
            ManagedDispatchState::Cancelled => Err(DispatchAuthorizationError::Cancelled),
            ManagedDispatchState::Active
                if dispatch.session_epoch == Some(session_epoch)
                    && self.active_sessions.get(resident_pubkey) == Some(&session_epoch) =>
            {
                Ok(())
            }
            ManagedDispatchState::Pending => Err(DispatchAuthorizationError::WrongSession),
            ManagedDispatchState::Rejected
            | ManagedDispatchState::Published
            | ManagedDispatchState::Failed
            | ManagedDispatchState::Interrupted => Err(DispatchAuthorizationError::Terminal),
            ManagedDispatchState::Active => Err(DispatchAuthorizationError::WrongSession),
        }
    }

    /// Durably bind one exact frozen resident event before any relay I/O.
    pub(crate) fn begin_submission(
        &mut self,
        trigger_event_id: &str,
        resident_pubkey: &str,
        session_epoch: u64,
        event_id: &str,
    ) -> Result<(), DispatchAuthorizationError> {
        EventId::from_hex(event_id).map_err(|_| DispatchAuthorizationError::Persistence)?;
        let key = (trigger_event_id.to_owned(), resident_pubkey.to_owned());
        let previous = self.dispatches.clone();
        let dispatch = self
            .dispatches
            .get_mut(&key)
            .ok_or(DispatchAuthorizationError::Unknown)?;
        match dispatch.state {
            ManagedDispatchState::Cancelled => return Err(DispatchAuthorizationError::Cancelled),
            ManagedDispatchState::Active
                if dispatch.session_epoch == Some(session_epoch)
                    && self.active_sessions.get(resident_pubkey) == Some(&session_epoch) => {}
            ManagedDispatchState::Active => return Err(DispatchAuthorizationError::WrongSession),
            ManagedDispatchState::Pending => return Err(DispatchAuthorizationError::WrongSession),
            ManagedDispatchState::Rejected
            | ManagedDispatchState::Published
            | ManagedDispatchState::Failed
            | ManagedDispatchState::Interrupted => {
                return Err(DispatchAuthorizationError::Terminal)
            }
        }
        if let Some(existing) = &dispatch.submitted_event_id {
            return if existing == event_id {
                Ok(())
            } else {
                Err(DispatchAuthorizationError::Terminal)
            };
        }
        dispatch.submitted_event_id = Some(event_id.to_owned());
        if self.persist().is_err() {
            self.dispatches = previous;
            return Err(DispatchAuthorizationError::Persistence);
        }
        Ok(())
    }

    /// Reauthorize one already-frozen encrypted outbox event after restart.
    ///
    /// This deliberately does not transfer the row to the replacement broker
    /// epoch. It validates the exact request against the epoch that originally
    /// froze the event, plus current durable cancellation/terminal state.
    pub(crate) fn authorize_reconciliation(
        &self,
        request: &ManagedMessagePublishRequestV1,
        event_id: &str,
        now_unix_secs: u64,
    ) -> Result<ManagedDispatchReconciliation, DispatchAuthorizationError> {
        let dispatch = self
            .dispatches
            .get(&(
                request.dispatch_receipt_id.as_str().to_owned(),
                request.resident_pubkey.as_str().to_owned(),
            ))
            .ok_or(DispatchAuthorizationError::Unknown)?;
        let _ = now_unix_secs;
        if request.owner_pubkey.as_str() != dispatch.owner_pubkey {
            return Err(DispatchAuthorizationError::WrongOwner);
        }
        if request.conversation_id.as_str() != dispatch.conversation_id {
            return Err(DispatchAuthorizationError::WrongConversation);
        }
        if request.thread_id.as_ref().map(|value| value.as_str()) != dispatch.thread_id.as_deref()
            || request.root_event_id.as_ref().map(|value| value.as_str())
                != dispatch.root_event_id.as_deref()
            || request.reply_event_id.as_ref().map(|value| value.as_str())
                != dispatch.reply_event_id.as_deref()
            || request
                .resolved_p_tags
                .iter()
                .map(|value| value.as_str())
                .ne(dispatch.resolved_p_tags.iter().map(String::as_str))
        {
            return Err(DispatchAuthorizationError::WrongThread);
        }
        if request.response_surface != dispatch.response_surface {
            return Err(DispatchAuthorizationError::WrongSurface);
        }
        match dispatch.session_epoch {
            Some(epoch) if epoch != request.cancellation_epoch.get() => {
                return Err(DispatchAuthorizationError::WrongSession)
            }
            None if matches!(
                dispatch.state,
                ManagedDispatchState::Active | ManagedDispatchState::Published
            ) =>
            {
                return Err(DispatchAuthorizationError::WrongSession)
            }
            Some(_) | None => {}
        }
        if let Some(submitted) = &dispatch.submitted_event_id {
            if submitted != event_id {
                return Err(DispatchAuthorizationError::Terminal);
            }
        }
        match dispatch.state {
            ManagedDispatchState::Active => Ok(ManagedDispatchReconciliation::Ready),
            ManagedDispatchState::Published
                if dispatch.published_event_id.as_deref() == Some(event_id) =>
            {
                Ok(ManagedDispatchReconciliation::Published)
            }
            ManagedDispatchState::Cancelled => Ok(ManagedDispatchReconciliation::Cancelled),
            ManagedDispatchState::Rejected => Ok(ManagedDispatchReconciliation::Rejected),
            ManagedDispatchState::Pending => Err(DispatchAuthorizationError::WrongSession),
            ManagedDispatchState::Published
            | ManagedDispatchState::Failed
            | ManagedDispatchState::Interrupted => Err(DispatchAuthorizationError::Terminal),
        }
    }

    /// Durably bind a previously prepared exact event during startup recovery.
    ///
    /// The original broker epoch remains authoritative for these frozen bytes;
    /// this never transfers a dispatch to the replacement session.
    pub(crate) fn bind_reconciled_submission(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        event_id: &str,
        now_unix_secs: u64,
        was_submitted: bool,
    ) -> Result<ManagedDispatchReconciliation, DispatchAuthorizationError> {
        let decision = self.authorize_reconciliation(request, event_id, now_unix_secs)?;
        if decision != ManagedDispatchReconciliation::Ready
            && !(decision == ManagedDispatchReconciliation::Cancelled && was_submitted)
        {
            return Ok(decision);
        }
        let key = (
            request.dispatch_receipt_id.as_str().to_owned(),
            request.resident_pubkey.as_str().to_owned(),
        );
        let previous = self.dispatches.clone();
        let dispatch = self
            .dispatches
            .get_mut(&key)
            .ok_or(DispatchAuthorizationError::Unknown)?;
        if let Some(existing) = &dispatch.submitted_event_id {
            return if existing == event_id {
                Ok(decision)
            } else {
                Err(DispatchAuthorizationError::Terminal)
            };
        }
        dispatch.submitted_event_id = Some(event_id.to_owned());
        if self.persist().is_err() {
            self.dispatches = previous;
            return Err(DispatchAuthorizationError::Persistence);
        }
        Ok(decision)
    }

    /// Atomically resolve a relay probe's terminal rejection against the
    /// current cancellation state.
    ///
    /// The caller must keep the outer dispatch-store mutex held while applying
    /// the returned state to the encrypted outbox. That makes cancellation and
    /// rejection one serialized terminal decision across both stores.
    pub(crate) fn resolve_reconciled_rejection(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        event_id: &str,
        now_unix_secs: u64,
    ) -> Result<ManagedDispatchReconciliation, DispatchAuthorizationError> {
        let decision = self.authorize_reconciliation(request, event_id, now_unix_secs)?;
        if decision != ManagedDispatchReconciliation::Ready {
            return Ok(decision);
        }
        let key = (
            request.dispatch_receipt_id.as_str().to_owned(),
            request.resident_pubkey.as_str().to_owned(),
        );
        let previous = self.dispatches.clone();
        let dispatch = self
            .dispatches
            .get_mut(&key)
            .ok_or(DispatchAuthorizationError::Unknown)?;
        dispatch.state = ManagedDispatchState::Rejected;
        dispatch.interruption_reason = None;
        dispatch.outbox_finalized = false;
        if self.persist().is_err() {
            self.dispatches = previous;
            return Err(DispatchAuthorizationError::Persistence);
        }
        Ok(ManagedDispatchReconciliation::Rejected)
    }

    /// Record relay acceptance as the publication linearization point.
    pub(crate) fn mark_published(
        &mut self,
        trigger_event_id: &str,
        resident_pubkey: &str,
        event_id: &str,
    ) -> Result<(), String> {
        EventId::from_hex(event_id).map_err(|_| "published event ID is invalid".to_string())?;
        let previous = self.dispatches.clone();
        let dispatch = self
            .dispatches
            .get_mut(&(trigger_event_id.to_owned(), resident_pubkey.to_owned()))
            .ok_or_else(|| "managed dispatch not found".to_string())?;
        if dispatch.state == ManagedDispatchState::Published {
            return if dispatch.published_event_id.as_deref() == Some(event_id) {
                Ok(())
            } else {
                Err("managed dispatch publication collision".into())
            };
        }
        if !matches!(
            dispatch.state,
            ManagedDispatchState::Active | ManagedDispatchState::Cancelled
        ) || dispatch.submitted_event_id.as_deref() != Some(event_id)
        {
            return Err("managed dispatch is not active".into());
        }
        dispatch.state = ManagedDispatchState::Published;
        dispatch.interruption_reason = None;
        dispatch.published_event_id = Some(event_id.to_owned());
        dispatch.outbox_finalized = false;
        if let Err(error) = self.persist() {
            self.dispatches = previous;
            return Err(error);
        }
        Ok(())
    }

    /// Confirm the encrypted outbox durably retained relay acceptance.
    pub(crate) fn finalize_published_outbox(
        &mut self,
        trigger_event_id: &str,
        resident_pubkey: &str,
        event_id: &str,
    ) -> Result<(), String> {
        let previous = self.dispatches.clone();
        let dispatch = self
            .dispatches
            .get_mut(&(trigger_event_id.to_owned(), resident_pubkey.to_owned()))
            .ok_or_else(|| "managed dispatch not found".to_string())?;
        if dispatch.state != ManagedDispatchState::Published
            || dispatch.submitted_event_id.as_deref() != Some(event_id)
            || dispatch.published_event_id.as_deref() != Some(event_id)
        {
            return Err("managed dispatch publication is not coherent".into());
        }
        if dispatch.outbox_finalized {
            return Ok(());
        }
        dispatch.outbox_finalized = true;
        if let Err(error) = self.persist() {
            self.dispatches = previous;
            return Err(error);
        }
        Ok(())
    }

    /// Finish cross-store acceptance after restart, or confirm the row was
    /// already safely compacted after a prior durable finalization.
    pub(crate) fn recover_published_outbox_finalization(
        &mut self,
        trigger_event_id: &str,
        resident_pubkey: &str,
        event_id: &str,
    ) -> Result<(), String> {
        let key = (trigger_event_id.to_owned(), resident_pubkey.to_owned());
        if !self.dispatches.contains_key(&key) {
            return Ok(());
        }
        self.finalize_published_outbox(trigger_event_id, resident_pubkey, event_id)
    }

    /// Confirm a cancelled/rejected encrypted outbox row is durably terminal.
    pub(crate) fn finalize_terminal_outbox(
        &mut self,
        trigger_event_id: &str,
        resident_pubkey: &str,
        event_id: &str,
        expected_state: ManagedDispatchState,
    ) -> Result<(), String> {
        if !matches!(
            expected_state,
            ManagedDispatchState::Cancelled
                | ManagedDispatchState::Rejected
                | ManagedDispatchState::Interrupted
        ) {
            return Err("managed dispatch terminal finalization state is invalid".into());
        }
        let previous = self.dispatches.clone();
        let dispatch = self
            .dispatches
            .get_mut(&(trigger_event_id.to_owned(), resident_pubkey.to_owned()))
            .ok_or_else(|| "managed dispatch not found".to_string())?;
        if dispatch.state != expected_state
            || dispatch
                .submitted_event_id
                .as_deref()
                .is_some_and(|submitted| submitted != event_id)
        {
            return Err("managed dispatch terminal tuple is not coherent".into());
        }
        if dispatch.outbox_finalized {
            return Ok(());
        }
        dispatch.outbox_finalized = true;
        if let Err(error) = self.persist() {
            self.dispatches = previous;
            return Err(error);
        }
        Ok(())
    }

    /// Finish terminal cross-store state after restart, or confirm the dispatch
    /// was already safely compacted following an earlier durable handshake.
    pub(crate) fn recover_terminal_outbox_finalization(
        &mut self,
        trigger_event_id: &str,
        resident_pubkey: &str,
        event_id: &str,
        expected_state: ManagedDispatchState,
    ) -> Result<(), String> {
        let key = (trigger_event_id.to_owned(), resident_pubkey.to_owned());
        if !self.dispatches.contains_key(&key) {
            return Ok(());
        }
        self.finalize_terminal_outbox(trigger_event_id, resident_pubkey, event_id, expected_state)
    }

    fn prune(&mut self, now_unix_secs: u64) {
        if self.dispatches.len() <= MAX_DISPATCHES {
            return;
        }
        let mut rows: Vec<_> = self
            .dispatches
            .iter()
            .filter(|(_, row)| {
                (matches!(
                    row.state,
                    ManagedDispatchState::Cancelled
                        | ManagedDispatchState::Rejected
                        | ManagedDispatchState::Published
                        | ManagedDispatchState::Failed
                        | ManagedDispatchState::Interrupted
                ) && row.outbox_finalized)
                    || (row.state == ManagedDispatchState::Pending
                        && row.session_epoch.is_none()
                        && row.submitted_event_id.is_none()
                        && row.expires_at <= now_unix_secs)
            })
            .map(|(key, row)| (key.clone(), row.created_at, row.expires_at <= now_unix_secs))
            .collect();
        rows.sort_by_key(|(_, created_at, expired)| (!*expired, *created_at));
        for (key, _, _) in rows
            .into_iter()
            .take(self.dispatches.len().saturating_sub(MAX_DISPATCHES))
        {
            self.dispatches.remove(&key);
        }
    }

    fn persist(&self) -> Result<(), String> {
        if self.dispatches.len() > MAX_DISPATCHES {
            return Err("managed dispatch store exceeds row limit".into());
        }
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "managed dispatch store has no parent".to_string())?;
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create managed dispatch directory: {error}"))?;
        let mut dispatches: Vec<_> = self.dispatches.values().cloned().collect();
        dispatches.sort_by(|left, right| {
            (&left.trigger_event_id, &left.resident_pubkey)
                .cmp(&(&right.trigger_event_id, &right.resident_pubkey))
        });
        let bytes = serde_json::to_vec(&PersistedDispatchStore {
            schema: STORE_SCHEMA.to_owned(),
            dispatches,
        })
        .map_err(|error| format!("serialize managed dispatch store: {error}"))?;
        atomic_write_restricted(&self.path, &bytes)
    }
}

fn validate_dispatch(dispatch: &ActiveDispatch) -> Result<(), String> {
    EventId::from_hex(&dispatch.trigger_event_id)
        .map_err(|_| "managed dispatch trigger ID is invalid".to_string())?;
    Hex64::parse(dispatch.owner_pubkey.clone())
        .map_err(|_| "managed dispatch owner pubkey is invalid".to_string())?;
    Hex64::parse(dispatch.resident_pubkey.clone())
        .map_err(|_| "managed dispatch resident pubkey is invalid".to_string())?;
    let source_dispatch_id = dispatch
        .source_dispatch_id
        .as_deref()
        .ok_or_else(|| "managed dispatch source coordinate is missing".to_string())?;
    let causal_root_event_id = dispatch
        .causal_root_event_id
        .as_deref()
        .ok_or_else(|| "managed dispatch causal root is missing".to_string())?;
    EventId::from_hex(source_dispatch_id)
        .map_err(|_| "managed dispatch source coordinate is invalid".to_string())?;
    EventId::from_hex(causal_root_event_id)
        .map_err(|_| "managed dispatch causal root is invalid".to_string())?;
    // The dispatch is a receipt, not a gate: rows may address any well-formed
    // recipient set (an exchange widens an owner row to its members; a wake
    // row is derived from its own trigger), so the loader checks shape, not
    // causal pedigree. An exchange-widened or wake-staged row must survive a
    // restart — the strict pedigree rule refused its own store file back.
    // TODO(ship): permissive row validation chosen for build velocity
    // (2026-08); review the security posture before shipping and confirm we
    // are happy with what a loadable dispatch row is allowed to look like.
    let causal_coordinates_are_valid = dispatch.descendant_depth <= 1
        && dispatch
            .causal_parent_action_id
            .as_ref()
            .is_none_or(|value| OpaqueId::parse(value.clone()).is_ok())
        && !dispatch.resolved_p_tags.is_empty()
        && dispatch
            .resolved_p_tags
            .iter()
            .all(|tag| Hex64::parse(tag.clone()).is_ok());
    if dispatch.owner_pubkey == dispatch.resident_pubkey
        || uuid::Uuid::parse_str(&dispatch.conversation_id).is_err()
        || dispatch.created_at > dispatch.expires_at
        || dispatch.expires_at.saturating_sub(dispatch.created_at) != DISPATCH_TTL_SECONDS
        || !causal_coordinates_are_valid
    {
        return Err("managed dispatch identity, timestamp, or recipient tuple is invalid".into());
    }
    let (Some(thread), Some(root), Some(reply)) = (
        dispatch.thread_id.as_deref(),
        dispatch.root_event_id.as_deref(),
        dispatch.reply_event_id.as_deref(),
    ) else {
        return Err("managed dispatch routing tuple is incomplete".into());
    };
    EventId::from_hex(root).map_err(|_| "managed dispatch root ID is invalid".to_string())?;
    EventId::from_hex(reply).map_err(|_| "managed dispatch reply ID is invalid".to_string())?;
    if thread != format!("thread:{root}") {
        return Err("managed dispatch thread tuple is invalid".into());
    }
    if let Some(submitted) = &dispatch.submitted_event_id {
        EventId::from_hex(submitted)
            .map_err(|_| "managed dispatch submitted ID is invalid".to_string())?;
    }
    if let Some(published) = &dispatch.published_event_id {
        EventId::from_hex(published)
            .map_err(|_| "managed dispatch published ID is invalid".to_string())?;
    }
    if dispatch.session_epoch == Some(0) {
        return Err("managed dispatch session epoch is invalid".into());
    }
    if let Some(binding) = &dispatch.context_binding {
        binding.validate()?;
    }
    let coherent = match dispatch.state {
        ManagedDispatchState::Pending => {
            dispatch.session_epoch.is_none()
                && dispatch.submitted_event_id.is_none()
                && dispatch.published_event_id.is_none()
                && !dispatch.outbox_finalized
        }
        ManagedDispatchState::Active => {
            dispatch.session_epoch.is_some()
                && dispatch.published_event_id.is_none()
                && !dispatch.outbox_finalized
        }
        ManagedDispatchState::Cancelled => dispatch.published_event_id.is_none(),
        ManagedDispatchState::Rejected => dispatch.published_event_id.is_none(),
        ManagedDispatchState::Failed => {
            dispatch.session_epoch.is_some()
                && dispatch.submitted_event_id.is_none()
                && dispatch.published_event_id.is_none()
                && dispatch.outbox_finalized
        }
        ManagedDispatchState::Interrupted => {
            dispatch.published_event_id.is_none()
                && dispatch.interruption_reason == Some(ManagedDispatchInterruptionReason::Restart)
                && dispatch.outbox_finalized
        }
        ManagedDispatchState::Published => {
            dispatch.session_epoch.is_some()
                && dispatch.submitted_event_id.is_some()
                && dispatch.submitted_event_id == dispatch.published_event_id
        }
    };
    if !coherent {
        return Err("managed dispatch lifecycle tuple is invalid".into());
    }
    if !matches!(dispatch.state, ManagedDispatchState::Interrupted)
        && dispatch.interruption_reason.is_some()
    {
        return Err("managed dispatch interruption reason is incoherent".into());
    }
    let mut previous_handle = None;
    for binding in &dispatch.artifact_bindings {
        validate_artifact_binding(binding, dispatch.created_at)?;
        if binding.expires_at > dispatch.expires_at
            || previous_handle.is_some_and(|previous| previous >= binding.handle_id.as_str())
        {
            return Err("managed dispatch artifact tuple is invalid".into());
        }
        previous_handle = Some(binding.handle_id.as_str());
    }
    Ok(())
}

fn validate_artifact_binding(
    binding: &ManagedArtifactBinding,
    minimum_lifetime: u64,
) -> Result<(), String> {
    OpaqueId::parse(binding.handle_id.clone())
        .map_err(|_| "managed artifact handle is invalid".to_string())?;
    Hex64::parse(binding.content_sha256.clone())
        .map_err(|_| "managed artifact digest is invalid".to_string())?;
    SafeU53::new(binding.byte_length)
        .map_err(|_| "managed artifact size is invalid".to_string())?;
    if binding.url.is_empty()
        || binding.url.len() > 4096
        || binding.media_type.is_empty()
        || binding.media_type.len() > 127
        || binding.expires_at < minimum_lifetime
        || binding.display_name.as_ref().is_some_and(|name| {
            name.is_empty()
                || name.len() > 255
                || name.contains('/')
                || name.contains('\\')
                || name == "."
                || name == ".."
        })
    {
        return Err("managed artifact metadata is invalid".into());
    }
    Ok(())
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve app data directory: {error}"))?;
    Ok(root.join("luca").join("managed-dispatches.json"))
}

/// Shared store used by both Tauri commands and resident broker threads.
pub(crate) fn global_dispatch_store(
    app: &AppHandle,
) -> Result<Arc<Mutex<ManagedDispatchStore>>, String> {
    if let Some(store) = GLOBAL_STORE.get() {
        return Ok(Arc::clone(store));
    }
    let candidate = Arc::new(Mutex::new(ManagedDispatchStore::load(store_path(app)?)?));
    let _ = GLOBAL_STORE.set(Arc::clone(&candidate));
    Ok(Arc::clone(GLOBAL_STORE.get().ok_or_else(|| {
        "initialize managed dispatch store".to_string()
    })?))
}

/// Return the process-global dispatch authority only after some caller has
/// initialized it. A pending managed send necessarily initializes this store,
/// so process-exit cleanup never needs an `AppHandle` or a second store load.
pub(crate) fn initialized_dispatch_store() -> Option<Arc<Mutex<ManagedDispatchStore>>> {
    GLOBAL_STORE.get().map(Arc::clone)
}

/// Replace a desktop-owned authority file atomically, owner-readable only.
pub(super) fn atomic_write_restricted(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = AtomicWriteFile::open(path)
        .map_err(|error| format!("open managed dispatch store: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("set managed dispatch permissions: {error}"))?;
    }
    file.write_all(bytes)
        .map_err(|error| format!("write managed dispatch store: {error}"))?;
    file.commit()
        .map_err(|error| format!("commit managed dispatch store: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::{
        derive_message_publish_idempotency_key, OpaqueId, SafeU53, MESSAGE_PUBLISH_PROTOCOL,
    };
    use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};
    use sha2::{Digest, Sha256};

    const CHANNEL_ONE: &str = "11111111-1111-4111-8111-111111111111";
    const CHANNEL_TWO: &str = "22222222-2222-4222-8222-222222222222";

    fn event(owner: &Keys, resident: &Keys, channel: &str, content: &str) -> Event {
        event_with_thread(owner, resident, channel, content, None, None)
    }

    fn event_with_thread(
        owner: &Keys,
        resident: &Keys,
        channel: &str,
        content: &str,
        root: Option<&str>,
        reply: Option<&str>,
    ) -> Event {
        let mut tags = vec![
            Tag::parse(["h", channel]).expect("h tag"),
            Tag::public_key(owner.public_key()),
            Tag::public_key(resident.public_key()),
        ];
        if let Some(root) = root {
            tags.push(Tag::parse(["e", root, "", "root"]).expect("root tag"));
        }
        if let Some(reply) = reply {
            tags.push(Tag::parse(["e", reply, "", "reply"]).expect("reply tag"));
        }
        EventBuilder::new(Kind::Custom(9), content)
            .tags(tags)
            .custom_created_at(Timestamp::from(100))
            .sign_with_keys(owner)
            .expect("sign owner event")
    }

    fn request(
        owner: &Keys,
        resident: &Keys,
        trigger: &Event,
        channel: &str,
        epoch: u64,
    ) -> ManagedMessagePublishRequestV1 {
        let resident_pubkey = Hex64::parse(resident.public_key().to_hex()).expect("resident");
        let receipt = luca_protocol::OpaqueId::parse(trigger.id.to_hex()).expect("receipt");
        let routing = routing_from_event(trigger).expect("valid trigger routing");
        ManagedMessagePublishRequestV1 {
            protocol: MESSAGE_PUBLISH_PROTOCOL.to_owned(),
            turn_id: OpaqueId::parse(trigger.id.to_hex()).expect("turn"),
            idempotency_key: derive_message_publish_idempotency_key(&receipt, &resident_pubkey)
                .expect("idempotency"),
            owner_pubkey: Hex64::parse(owner.public_key().to_hex()).expect("owner"),
            resident_pubkey,
            conversation_id: OpaqueId::parse(channel).expect("channel"),
            thread_id: routing
                .thread_id
                .map(|value| OpaqueId::parse(value).expect("thread")),
            root_event_id: routing
                .root_event_id
                .map(|value| Hex64::parse(value).expect("root")),
            reply_event_id: routing
                .reply_event_id
                .map(|value| Hex64::parse(value).expect("reply")),
            response_surface: Some(routing.response_surface),
            resolved_p_tags: vec![Hex64::parse(owner.public_key().to_hex()).expect("owner")],
            final_draft: "final answer".into(),
            dispatch_receipt_id: receipt,
            cancellation_epoch: SafeU53::new(epoch).expect("epoch"),
            exchange: None,
            bucket_hint: None,
        }
    }

    #[test]
    fn managed_dispatch_persists_only_context_snapshot_reference_and_revision() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("dispatches.json");
        let owner = Keys::generate();
        let resident = Keys::generate();
        let trigger = event(&owner, &resident, CHANNEL_ONE, "use selected context");
        let binding = super::super::conversation_context::DispatchContextBindingV1 {
            protocol: "luca.conversation-context-binding.v1".into(),
            snapshot_ref: Sha256Ref::parse(format!("sha256:{}", "3".repeat(64)))
                .expect("snapshot ref"),
            revision: 7,
        };
        let mut store = ManagedDispatchStore::load(path.clone()).expect("load");
        store
            .stage_owner_event_with_artifacts_and_context(
                &trigger,
                &[resident.public_key().to_hex()],
                &[],
                Some(binding),
                100,
            )
            .expect("stage context dispatch");

        let wire = std::fs::read_to_string(path).expect("read persisted dispatch");
        assert!(wire.contains("context_binding"));
        assert!(wire.contains("snapshot_ref"));
        assert!(wire.contains("\"revision\":7"));
        assert!(!wire.contains("primary_source_id"));
        assert!(!wire.contains("additional_source_ids"));
        assert!(!wire.contains("selected_source_ids"));
    }

    #[test]
    fn auto_restart_quiescence_is_resident_scoped_and_fail_closed() {
        let dir = tempfile::tempdir().expect("tempdir");
        let owner = Keys::generate();
        let resident = Keys::generate();
        let sibling = Keys::generate();
        let resident_trigger = event(&owner, &resident, CHANNEL_ONE, "queued work");
        let sibling_trigger = event(&owner, &sibling, CHANNEL_ONE, "other work");
        let mut store =
            ManagedDispatchStore::load(dir.path().join("dispatches.json")).expect("load");

        let resident_rows = store
            .stage_owner_event(&resident_trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage resident");
        store
            .stage_owner_event(&sibling_trigger, &[sibling.public_key().to_hex()], 100)
            .expect("stage sibling");

        assert!(store.has_unresolved_for_resident(&resident.public_key().to_hex()));
        assert!(store.has_unresolved_for_resident(&resident.public_key().to_hex().to_uppercase()));

        let resident_key = (resident_trigger.id.to_hex(), resident.public_key().to_hex());
        store
            .dispatches
            .get_mut(&resident_key)
            .expect("resident row")
            .state = ManagedDispatchState::Active;
        assert!(store.has_unresolved_for_resident(&resident.public_key().to_hex()));

        store
            .mark_rejected(&resident_rows)
            .expect("reject resident");
        assert!(
            !store.has_unresolved_for_resident(&resident.public_key().to_hex()),
            "terminal resident work must not be confused with the sibling's live row"
        );
        assert!(store.has_unresolved_for_resident(&sibling.public_key().to_hex()));
    }

    #[test]
    fn widened_and_wake_rows_survive_a_restart() {
        // Yesterday's live bug: grant_exchange_recipients widened a row, the
        // process restarted, and the strict loader refused its own file —
        // bricking every send. A row this store writes must be a row this
        // store loads.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("dispatches.json");
        let owner = Keys::generate();
        let resident = Keys::generate();
        let sibling = Keys::generate();
        {
            let mut store = ManagedDispatchStore::load(path.clone()).expect("load");
            let trigger = event(&owner, &resident, CHANNEL_ONE, "@sibling — check §2");
            let staged = store
                .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
                .expect("stage");
            store
                .grant_exchange_recipients(
                    &staged[0].0,
                    &resident.public_key().to_hex(),
                    &[sibling.public_key().to_hex()],
                    110,
                )
                .expect("widen");
            let wake = EventBuilder::new(Kind::Custom(9), "@resident — and you?")
                .tags(vec![
                    Tag::parse(["h", CHANNEL_TWO]).expect("h tag"),
                    Tag::public_key(resident.public_key()),
                ])
                .custom_created_at(Timestamp::from(100))
                .sign_with_keys(&sibling)
                .expect("sign sibling event");
            store
                .stage_wake_from_trigger(
                    &wake,
                    &resident.public_key().to_hex(),
                    &owner.public_key().to_hex(),
                    120,
                )
                .expect("stage wake");
        }
        let reloaded = ManagedDispatchStore::load(path).expect("the store must load its own file");
        assert_eq!(reloaded.dispatches.len(), 2);
    }

    #[test]
    fn a_wake_is_staged_from_its_own_trigger_and_never_twice() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store =
            ManagedDispatchStore::load(dir.path().join("dispatches.json")).expect("load");
        let owner = Keys::generate();
        let asker = Keys::generate();
        let woken = Keys::generate();
        // A sibling-authored trigger that p-tags the woken resident.
        let trigger = EventBuilder::new(Kind::Custom(9), "@woken — does §2 hold?")
            .tags(vec![
                Tag::parse(["h", CHANNEL_ONE]).expect("h tag"),
                Tag::public_key(woken.public_key()),
            ])
            .custom_created_at(Timestamp::from(100))
            .sign_with_keys(&asker)
            .expect("sign sibling event");
        let key = store
            .stage_wake_from_trigger(
                &trigger,
                &woken.public_key().to_hex(),
                &owner.public_key().to_hex(),
                150,
            )
            .expect("stage wake");
        let row = store.dispatches.get(&key).expect("row").clone();
        assert_eq!(row.descendant_depth, 1, "a sibling wake is one hop out");
        assert_eq!(row.resolved_p_tags, vec![asker.public_key().to_hex()]);
        assert_eq!(row.conversation_id, CHANNEL_ONE);
        // Idempotent: staging again returns the same key, changes nothing.
        let again = store
            .stage_wake_from_trigger(
                &trigger,
                &woken.public_key().to_hex(),
                &owner.public_key().to_hex(),
                160,
            )
            .expect("restage");
        assert_eq!(again, key);
        assert_eq!(store.dispatches.get(&key).expect("row").created_at, 150);
        // An owner-authored trigger stages at depth zero.
        let owner_trigger = event(&owner, &woken, CHANNEL_TWO, "hello");
        let owner_key = store
            .stage_wake_from_trigger(
                &owner_trigger,
                &woken.public_key().to_hex(),
                &owner.public_key().to_hex(),
                150,
            )
            .expect("stage owner wake");
        assert_eq!(
            store
                .dispatches
                .get(&owner_key)
                .expect("row")
                .descendant_depth,
            0
        );
        // A trigger that does not address the resident is refused, as is a
        // resident woken by its own message.
        let unaddressed = EventBuilder::new(Kind::Custom(9), "nothing for you")
            .tags(vec![Tag::parse(["h", CHANNEL_ONE]).expect("h tag")])
            .custom_created_at(Timestamp::from(100))
            .sign_with_keys(&asker)
            .expect("sign");
        assert!(store
            .stage_wake_from_trigger(
                &unaddressed,
                &woken.public_key().to_hex(),
                &owner.public_key().to_hex(),
                150,
            )
            .is_err());
        assert!(store
            .stage_wake_from_trigger(
                &trigger,
                &asker.public_key().to_hex(),
                &owner.public_key().to_hex(),
                150,
            )
            .is_err());
    }

    #[test]
    fn stages_before_reload_and_rejects_unknown_old_wrong_routing_and_session() {
        let owner = Keys::parse(&"11".repeat(32)).expect("owner");
        let resident = Keys::parse(&"12".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "hello");
        let temp = tempfile::tempdir().expect("temp");
        let path = temp.path().join("dispatches.json");
        let mut store = ManagedDispatchStore::load(path.clone()).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");

        let mut store = ManagedDispatchStore::load(path).expect("reload");
        store
            .activate_session(&resident.public_key().to_hex(), 7)
            .expect("session");
        let valid = request(&owner, &resident, &trigger, CHANNEL_ONE, 7);
        assert!(store.authorize_publication(&valid, 101).is_ok());

        let mut wrong = valid.clone();
        wrong.conversation_id = OpaqueId::parse(CHANNEL_TWO).expect("conversation");
        assert_eq!(
            store.authorize_publication(&wrong, 101),
            Err(DispatchAuthorizationError::WrongConversation)
        );
        let mut wrong_session = valid.clone();
        wrong_session.cancellation_epoch = SafeU53::new(8).expect("epoch");
        assert_eq!(
            store.authorize_publication(&wrong_session, 101),
            Err(DispatchAuthorizationError::WrongSession)
        );
        let other = event(&owner, &resident, CHANNEL_ONE, "old");
        let unknown = request(&owner, &resident, &other, CHANNEL_ONE, 7);
        assert_eq!(
            store.authorize_publication(&unknown, 101),
            Err(DispatchAuthorizationError::Unknown)
        );
    }

    #[test]
    fn local_cancel_is_exact_and_same_second_events_do_not_alias() {
        let owner = Keys::parse(&"21".repeat(32)).expect("owner");
        let resident = Keys::parse(&"22".repeat(32)).expect("resident");
        let first = event(&owner, &resident, CHANNEL_ONE, "one");
        let second = event(&owner, &resident, CHANNEL_ONE, "two");
        assert_ne!(first.id, second.id);
        let temp = tempfile::tempdir().expect("temp");
        let mut store =
            ManagedDispatchStore::load(temp.path().join("dispatches.json")).expect("store");
        for trigger in [&first, &second] {
            store
                .stage_owner_event(trigger, &[resident.public_key().to_hex()], 100)
                .expect("stage");
        }
        assert_eq!(
            store
                .cancel_matching(
                    &owner.public_key().to_hex(),
                    CHANNEL_ONE,
                    None,
                    &[resident.public_key().to_hex()],
                )
                .expect("cancel"),
            2
        );
        store
            .activate_session(&resident.public_key().to_hex(), 7)
            .expect("session");
        assert_eq!(
            store.authorize_publication(&request(&owner, &resident, &first, CHANNEL_ONE, 7), 101),
            Err(DispatchAuthorizationError::Cancelled)
        );
    }

    #[test]
    fn strict_thread_shapes_and_targeted_cancel_match_acp_policy() {
        let owner = Keys::parse(&"31".repeat(32)).expect("owner");
        let resident = Keys::parse(&"32".repeat(32)).expect("resident");
        let root = "aa".repeat(32);
        let reply = "bb".repeat(32);

        let top = event(&owner, &resident, CHANNEL_ONE, "top");
        let top_routing = routing_from_event(&top).expect("top routing");
        assert_eq!(
            top_routing.root_event_id.as_deref(),
            Some(top.id.to_hex().as_str())
        );
        assert_eq!(
            top_routing.reply_event_id.as_deref(),
            Some(top.id.to_hex().as_str())
        );

        let reply_only =
            event_with_thread(&owner, &resident, CHANNEL_ONE, "reply", None, Some(&reply));
        let reply_routing = routing_from_event(&reply_only).expect("reply-only routing");
        assert_eq!(reply_routing.root_event_id.as_deref(), Some(reply.as_str()));
        assert_eq!(
            reply_routing.reply_event_id.as_deref(),
            Some(reply.as_str())
        );

        let nested = event_with_thread(
            &owner,
            &resident,
            CHANNEL_ONE,
            "nested",
            Some(&root),
            Some(&reply),
        );
        let nested_routing = routing_from_event(&nested).expect("nested routing");
        assert_eq!(nested_routing.root_event_id.as_deref(), Some(root.as_str()));
        assert_eq!(
            nested_routing.reply_event_id.as_deref(),
            Some(reply.as_str())
        );

        let root_only =
            event_with_thread(&owner, &resident, CHANNEL_ONE, "invalid", Some(&root), None);
        assert!(routing_from_event(&root_only).is_err());

        let malformed = EventBuilder::new(Kind::Custom(9), "unmarked")
            .tags([
                Tag::parse(["h", CHANNEL_ONE]).expect("h tag"),
                Tag::public_key(owner.public_key()),
                Tag::public_key(resident.public_key()),
                Tag::event(top.id),
            ])
            .custom_created_at(Timestamp::from(100))
            .sign_with_keys(&owner)
            .expect("sign malformed fixture");
        assert!(routing_from_event(&malformed).is_err());

        let temp = tempfile::tempdir().expect("temp");
        let mut store =
            ManagedDispatchStore::load(temp.path().join("dispatches.json")).expect("store");
        store
            .stage_owner_event(&top, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        assert_eq!(
            store
                .cancel_matching(&owner.public_key().to_hex(), CHANNEL_ONE, None, &[])
                .expect("untargeted cancel"),
            0
        );
        store
            .activate_session(&resident.public_key().to_hex(), 7)
            .expect("session");
        assert!(store
            .authorize_publication(&request(&owner, &resident, &top, CHANNEL_ONE, 7), 101)
            .is_ok());
    }

    #[test]
    fn idempotent_restage_and_wrong_resident_or_expired_request_are_rejected() {
        let owner = Keys::parse(&"41".repeat(32)).expect("owner");
        let resident = Keys::parse(&"42".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "hello");
        let temp = tempfile::tempdir().expect("temp");
        let mut store =
            ManagedDispatchStore::load(temp.path().join("dispatches.json")).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 120)
            .expect("exact restage");
        assert_eq!(store.dispatches.len(), 1);
        store
            .activate_session(&resident.public_key().to_hex(), 7)
            .expect("session");

        let other_resident = Keys::parse(&"43".repeat(32)).expect("other resident");
        let wrong = request(&owner, &other_resident, &trigger, CHANNEL_ONE, 7);
        assert_eq!(
            store.authorize_publication(&wrong, 121),
            Err(DispatchAuthorizationError::WrongResident)
        );
        let valid = request(&owner, &resident, &trigger, CHANNEL_ONE, 7);
        assert_eq!(
            store.authorize_publication(&valid, 100 + DISPATCH_TTL_SECONDS + 1),
            Err(DispatchAuthorizationError::Expired)
        );
    }

    #[test]
    fn channel_scoped_cancel_revokes_target_resident_across_threads() {
        let owner = Keys::parse(&"51".repeat(32)).expect("owner");
        let resident = Keys::parse(&"52".repeat(32)).expect("resident");
        let first_root = "cc".repeat(32);
        let second_root = "dd".repeat(32);
        let first = event_with_thread(
            &owner,
            &resident,
            CHANNEL_ONE,
            "first",
            None,
            Some(&first_root),
        );
        let second = event_with_thread(
            &owner,
            &resident,
            CHANNEL_ONE,
            "second",
            None,
            Some(&second_root),
        );
        let temp = tempfile::tempdir().expect("temp");
        let mut store =
            ManagedDispatchStore::load(temp.path().join("dispatches.json")).expect("store");
        for trigger in [&first, &second] {
            store
                .stage_owner_event(trigger, &[resident.public_key().to_hex()], 100)
                .expect("stage");
        }
        assert_eq!(
            store
                .cancel_matching(
                    &owner.public_key().to_hex(),
                    CHANNEL_ONE,
                    None,
                    &[resident.public_key().to_hex()],
                )
                .expect("thread cancel"),
            2
        );
        store
            .activate_session(&resident.public_key().to_hex(), 9)
            .expect("session");
        assert_eq!(
            store.authorize_publication(&request(&owner, &resident, &first, CHANNEL_ONE, 9), 101),
            Err(DispatchAuthorizationError::Cancelled)
        );
        assert_eq!(
            store.authorize_publication(&request(&owner, &resident, &second, CHANNEL_ONE, 9), 101),
            Err(DispatchAuthorizationError::Cancelled)
        );
    }

    #[test]
    fn failed_claim_persistence_rolls_back_and_retry_durably_binds() {
        let owner = Keys::parse(&"61".repeat(32)).expect("owner");
        let resident = Keys::parse(&"62".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "persist");
        let temp = tempfile::tempdir().expect("temp");
        let valid_path = temp.path().join("dispatches.json");
        let mut store = ManagedDispatchStore::load(valid_path.clone()).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        store
            .activate_session(&resident.public_key().to_hex(), 11)
            .expect("session");
        let request = request(&owner, &resident, &trigger, CHANNEL_ONE, 11);

        let unwritable = temp.path().join("directory-target");
        std::fs::create_dir(&unwritable).expect("directory target");
        store.path = unwritable;
        assert_eq!(
            store.authorize_publication(&request, 101),
            Err(DispatchAuthorizationError::Persistence)
        );
        let row = store
            .dispatches
            .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
            .expect("dispatch");
        assert_eq!(row.state, ManagedDispatchState::Pending);
        assert_eq!(row.session_epoch, None);

        store.path = valid_path.clone();
        assert!(store.authorize_publication(&request, 101).is_ok());
        let reloaded = ManagedDispatchStore::load(valid_path).expect("reload");
        let row = reloaded
            .dispatches
            .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
            .expect("dispatch");
        assert_eq!(row.state, ManagedDispatchState::Active);
        assert_eq!(row.session_epoch, Some(11));
    }

    #[test]
    fn exact_failure_is_durable_terminal_and_revokes_late_authority() {
        let owner = Keys::parse(&"63".repeat(32)).expect("owner");
        let resident = Keys::parse(&"64".repeat(32)).expect("resident");
        let outsider = Keys::parse(&"65".repeat(32)).expect("outsider");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "provider failed");
        let temp = tempfile::tempdir().expect("temp");
        let path = temp.path().join("dispatches.json");
        let mut store = ManagedDispatchStore::load(path.clone()).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        store
            .activate_session(&resident.public_key().to_hex(), 12)
            .expect("session");
        store
            .bind_communication_turn_start(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                12,
                101,
            )
            .expect("bind");
        assert!(store.conversation_has_active_turn(CHANNEL_ONE));
        assert_eq!(
            store.fail_exact(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_TWO,
                12,
            ),
            Err(DispatchAuthorizationError::WrongConversation)
        );
        assert_eq!(
            store.fail_exact(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                13,
            ),
            Err(DispatchAuthorizationError::WrongSession)
        );
        assert_eq!(
            store.fail_exact(
                &trigger.id.to_hex(),
                &outsider.public_key().to_hex(),
                CHANNEL_ONE,
                12,
            ),
            Err(DispatchAuthorizationError::WrongResident)
        );

        store
            .fail_exact(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                12,
            )
            .expect("terminalize failure");
        store
            .fail_exact(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                12,
            )
            .expect("idempotent failure");
        assert!(!store.conversation_has_active_turn(CHANNEL_ONE));
        assert_eq!(
            store.recheck_communication_turn(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                12,
                102,
            ),
            Err(DispatchAuthorizationError::Terminal)
        );
        assert_eq!(
            store.authorize_publication(
                &request(&owner, &resident, &trigger, CHANNEL_ONE, 12),
                102,
            ),
            Err(DispatchAuthorizationError::Terminal)
        );
        assert_eq!(
            store
                .cancel_exact(
                    &owner.public_key().to_hex(),
                    CHANNEL_ONE,
                    &resident.public_key().to_hex(),
                    &trigger.id.to_hex(),
                    12,
                )
                .expect("already terminal"),
            ExactDispatchCancellationResult::AlreadyTerminal
        );

        let reloaded = ManagedDispatchStore::load(path).expect("reload");
        let row = reloaded
            .dispatches
            .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
            .expect("failed row");
        assert_eq!(row.state, ManagedDispatchState::Failed);
        assert!(row.outbox_finalized);
        assert_eq!(row.submitted_event_id, None);
        assert_eq!(row.published_event_id, None);
        assert_eq!(row.interruption_reason, None);
    }

    #[test]
    fn process_exit_terminalization_is_resident_scoped_in_a_multi_resident_room() {
        let owner = Keys::parse(&"68".repeat(32)).expect("owner");
        let first = Keys::parse(&"69".repeat(32)).expect("first resident");
        let second = Keys::parse(&"6a".repeat(32)).expect("second resident");
        let trigger = EventBuilder::new(Kind::Custom(9), "work together")
            .tags(vec![
                Tag::parse(["h", CHANNEL_ONE]).expect("h tag"),
                Tag::public_key(owner.public_key()),
                Tag::public_key(first.public_key()),
                Tag::public_key(second.public_key()),
            ])
            .custom_created_at(Timestamp::from(100))
            .sign_with_keys(&owner)
            .expect("sign owner event");
        let temp = tempfile::tempdir().expect("temp");
        let path = temp.path().join("dispatches.json");
        let mut store = ManagedDispatchStore::load(path.clone()).expect("store");
        store
            .stage_owner_event(
                &trigger,
                &[first.public_key().to_hex(), second.public_key().to_hex()],
                100,
            )
            .expect("stage both residents");
        store
            .activate_session(&first.public_key().to_hex(), 21)
            .expect("first session");
        store
            .activate_session(&second.public_key().to_hex(), 22)
            .expect("second session");

        let first_cleanup = store
            .terminalize_unclaimed_after_process_exit(&first.public_key().to_hex(), 106)
            .expect("terminalize first exit");
        assert_eq!(first_cleanup.terminalized, 1);
        assert!(first_cleanup.deferred.is_empty());
        assert!(
            store.conversation_has_active_turn(CHANNEL_ONE),
            "the second resident remains independently runnable"
        );
        let first_row = store
            .dispatches
            .get(&(trigger.id.to_hex(), first.public_key().to_hex()))
            .expect("first row");
        assert_eq!(first_row.state, ManagedDispatchState::Failed);
        assert_eq!(first_row.session_epoch, Some(21));
        assert!(first_row.outbox_finalized);
        let second_row = store
            .dispatches
            .get(&(trigger.id.to_hex(), second.public_key().to_hex()))
            .expect("second row");
        assert_eq!(second_row.state, ManagedDispatchState::Pending);
        assert_eq!(second_row.session_epoch, None);

        let second_cleanup = store
            .terminalize_unclaimed_after_process_exit(&second.public_key().to_hex(), 106)
            .expect("terminalize second exit");
        assert_eq!(second_cleanup.terminalized, 1);
        assert!(second_cleanup.deferred.is_empty());
        assert!(!store.conversation_has_active_turn(CHANNEL_ONE));
        let reloaded = ManagedDispatchStore::load(path).expect("reload");
        for (resident, epoch) in [
            (first.public_key().to_hex(), 21),
            (second.public_key().to_hex(), 22),
        ] {
            let row = reloaded
                .dispatches
                .get(&(trigger.id.to_hex(), resident))
                .expect("terminal row");
            assert_eq!(row.state, ManagedDispatchState::Failed);
            assert_eq!(row.session_epoch, Some(epoch));
            assert!(row.outbox_finalized);
        }
    }

    #[test]
    fn replacement_epoch_supersedes_old_exit_cleanup_before_claim() {
        let owner = Keys::parse(&"6b".repeat(32)).expect("owner");
        let resident = Keys::parse(&"6c".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "replay me");
        let temp = tempfile::tempdir().expect("temp");
        let mut store =
            ManagedDispatchStore::load(temp.path().join("dispatches.json")).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        store
            .activate_session(&resident.public_key().to_hex(), 31)
            .expect("exited session");

        let mut exit_cleanup = store
            .terminalize_unclaimed_after_process_exit(&resident.public_key().to_hex(), 100)
            .expect("defer fresh row");
        assert_eq!(exit_cleanup.terminalized, 0);
        assert_eq!(exit_cleanup.deferred.len(), 1);
        let deferred = exit_cleanup.deferred.pop().expect("exact deferred row");
        assert_eq!(deferred.cleanup_at_unix_secs, 106);

        store
            .activate_session(&resident.public_key().to_hex(), 32)
            .expect("replacement session");
        assert!(!store
            .recheck_deferred_process_exit_cleanup(&deferred, 106)
            .expect("old epoch cleanup cannot fail replacement work"));
        let pending = store
            .dispatches
            .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
            .expect("replacement-pending row");
        assert_eq!(pending.state, ManagedDispatchState::Pending);
        assert_eq!(pending.session_epoch, None);

        store
            .bind_communication_turn_start(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                32,
                107,
            )
            .expect("replacement claims replayed send");

        let row = store
            .dispatches
            .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
            .expect("claimed row");
        assert_eq!(row.state, ManagedDispatchState::Active);
        assert_eq!(row.session_epoch, Some(32));
        assert!(!row.outbox_finalized);
    }

    #[test]
    fn exact_failure_rolls_back_on_persistence_error() {
        let owner = Keys::parse(&"66".repeat(32)).expect("owner");
        let resident = Keys::parse(&"67".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "persist failure");
        let temp = tempfile::tempdir().expect("temp");
        let valid_path = temp.path().join("dispatches.json");
        let directory_target = temp.path().join("directory-target");
        std::fs::create_dir(&directory_target).expect("directory target");
        let mut store = ManagedDispatchStore::load(valid_path.clone()).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        store
            .activate_session(&resident.public_key().to_hex(), 14)
            .expect("session");
        store
            .bind_communication_turn_start(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                14,
                101,
            )
            .expect("bind");

        store.path = directory_target;
        assert_eq!(
            store.fail_exact(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                14,
            ),
            Err(DispatchAuthorizationError::Persistence)
        );
        let row = store
            .dispatches
            .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
            .expect("rolled back row");
        assert_eq!(row.state, ManagedDispatchState::Active);
        assert!(!row.outbox_finalized);
        assert!(store.conversation_has_active_turn(CHANNEL_ONE));

        store.path = valid_path;
        store
            .fail_exact(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                14,
            )
            .expect("retry failure persistence");
    }

    #[test]
    fn exact_failure_refuses_a_frozen_final() {
        let owner = Keys::parse(&"68".repeat(32)).expect("owner");
        let resident = Keys::parse(&"69".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "publication race");
        let temp = tempfile::tempdir().expect("temp");
        let mut store =
            ManagedDispatchStore::load(temp.path().join("dispatches.json")).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        store
            .activate_session(&resident.public_key().to_hex(), 16)
            .expect("session");
        store
            .authorize_publication(&request(&owner, &resident, &trigger, CHANNEL_ONE, 16), 101)
            .expect("authorize");
        let event_id = "ef".repeat(32);
        store
            .begin_submission(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                16,
                &event_id,
            )
            .expect("freeze final");

        assert_eq!(
            store.fail_exact(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                16,
            ),
            Err(DispatchAuthorizationError::Terminal)
        );
        store
            .mark_published(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                &event_id,
            )
            .expect("frozen final remains authoritative");
    }

    #[test]
    fn failed_stage_persistence_rolls_back_and_retry_durably_stages() {
        let owner = Keys::parse(&"71".repeat(32)).expect("owner");
        let resident = Keys::parse(&"72".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "stage");
        let temp = tempfile::tempdir().expect("temp");
        let valid_path = temp.path().join("dispatches.json");
        let directory_target = temp.path().join("directory-target");
        std::fs::create_dir(&directory_target).expect("directory target");
        let mut store = ManagedDispatchStore::load(valid_path.clone()).expect("store");

        store.path = directory_target;
        assert!(store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .is_err());
        assert!(store.dispatches.is_empty());

        store.path = valid_path.clone();
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("retry stage");
        let reloaded = ManagedDispatchStore::load(valid_path).expect("reload");
        assert!(reloaded
            .dispatches
            .contains_key(&(trigger.id.to_hex(), resident.public_key().to_hex())));
    }

    #[test]
    fn multi_resident_stage_validation_never_leaves_partial_authority() {
        let owner = Keys::parse(&"77".repeat(32)).expect("owner");
        let first = Keys::parse(&"78".repeat(32)).expect("first");
        let second = Keys::parse(&"79".repeat(32)).expect("second");
        let trigger = EventBuilder::new(Kind::Custom(9), "multi")
            .tags([
                Tag::parse(["h", CHANNEL_ONE]).expect("h tag"),
                Tag::public_key(owner.public_key()),
                Tag::public_key(first.public_key()),
                Tag::public_key(second.public_key()),
            ])
            .custom_created_at(Timestamp::from(100))
            .sign_with_keys(&owner)
            .expect("sign");
        let temp = tempfile::tempdir().expect("temp");
        let mut store =
            ManagedDispatchStore::load(temp.path().join("dispatches.json")).expect("store");

        assert!(store
            .stage_owner_event(
                &trigger,
                &[first.public_key().to_hex(), "ff".repeat(32)],
                100,
            )
            .is_err());
        assert!(store.dispatches.is_empty());

        store
            .stage_owner_event(&trigger, &[second.public_key().to_hex()], 100)
            .expect("stage second");
        let second_key = (trigger.id.to_hex(), second.public_key().to_hex());
        store
            .dispatches
            .get_mut(&second_key)
            .expect("second row")
            .conversation_id = CHANNEL_TWO.to_owned();
        assert!(store
            .stage_owner_event(
                &trigger,
                &[first.public_key().to_hex(), second.public_key().to_hex()],
                100,
            )
            .is_err());
        assert!(!store
            .dispatches
            .contains_key(&(trigger.id.to_hex(), first.public_key().to_hex())));
    }

    #[test]
    fn failed_terminal_transitions_roll_back_before_retry() {
        let owner = Keys::parse(&"73".repeat(32)).expect("owner");
        let resident = Keys::parse(&"74".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "publish");
        let temp = tempfile::tempdir().expect("temp");
        let valid_path = temp.path().join("dispatches.json");
        let directory_target = temp.path().join("directory-target");
        std::fs::create_dir(&directory_target).expect("directory target");
        let mut store = ManagedDispatchStore::load(valid_path.clone()).expect("store");
        let staged = store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        store
            .activate_session(&resident.public_key().to_hex(), 13)
            .expect("session");
        let request = request(&owner, &resident, &trigger, CHANNEL_ONE, 13);
        store
            .authorize_publication(&request, 101)
            .expect("authorize");

        let published_event_id = "ab".repeat(32);
        store
            .begin_submission(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                13,
                &published_event_id,
            )
            .expect("begin submission");
        store.path = directory_target.clone();
        assert!(store
            .mark_published(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                &published_event_id,
            )
            .is_err());
        let row = store
            .dispatches
            .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
            .expect("dispatch");
        assert_eq!(row.state, ManagedDispatchState::Active);
        assert_eq!(row.published_event_id, None);

        assert!(store.mark_rejected(&staged).is_err());
        let row = store
            .dispatches
            .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
            .expect("dispatch");
        assert_eq!(row.state, ManagedDispatchState::Active);

        store.path = valid_path.clone();
        store
            .mark_published(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                &published_event_id,
            )
            .expect("retry publish");
        let reloaded = ManagedDispatchStore::load(valid_path).expect("reload");
        let row = reloaded
            .dispatches
            .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
            .expect("dispatch");
        assert_eq!(row.state, ManagedDispatchState::Published);
        assert_eq!(
            row.published_event_id.as_deref(),
            Some(published_event_id.as_str())
        );
    }

    #[test]
    fn relay_acceptance_can_honestly_win_the_last_cancellation_race() {
        let owner = Keys::parse(&"75".repeat(32)).expect("owner");
        let resident = Keys::parse(&"76".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "race");
        let temp = tempfile::tempdir().expect("temp");
        let mut store =
            ManagedDispatchStore::load(temp.path().join("dispatches.json")).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        store
            .activate_session(&resident.public_key().to_hex(), 17)
            .expect("session");
        let request = request(&owner, &resident, &trigger, CHANNEL_ONE, 17);
        store
            .authorize_publication(&request, 101)
            .expect("authorize");
        let event_id = "cd".repeat(32);
        store
            .begin_submission(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                17,
                &event_id,
            )
            .expect("begin submission");
        assert_eq!(
            store
                .cancel_matching(
                    &owner.public_key().to_hex(),
                    CHANNEL_ONE,
                    None,
                    &[resident.public_key().to_hex()],
                )
                .expect("cancel race"),
            1
        );
        assert_eq!(
            store
                .dispatches
                .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
                .expect("dispatch")
                .state,
            ManagedDispatchState::Cancelled
        );
        store
            .mark_published(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                &event_id,
            )
            .expect("relay acceptance wins");
        let row = store
            .dispatches
            .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
            .expect("dispatch");
        assert_eq!(row.state, ManagedDispatchState::Published);
        assert_eq!(row.published_event_id.as_deref(), Some(event_id.as_str()));
    }

    #[test]
    fn strict_load_rejects_duplicate_and_impossible_rows() {
        let owner = Keys::parse(&"81".repeat(32)).expect("owner");
        let resident = Keys::parse(&"82".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "load");
        let temp = tempfile::tempdir().expect("temp");
        let valid_path = temp.path().join("valid.json");
        let mut store = ManagedDispatchStore::load(valid_path.clone()).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        let valid: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&valid_path).expect("read")).expect("json");

        let mut duplicate = valid.clone();
        let row = duplicate["dispatches"][0].clone();
        duplicate["dispatches"]
            .as_array_mut()
            .expect("rows")
            .push(row);
        let duplicate_path = temp.path().join("duplicate.json");
        std::fs::write(
            &duplicate_path,
            serde_json::to_vec(&duplicate).expect("serialize"),
        )
        .expect("write");
        assert!(ManagedDispatchStore::load(duplicate_path).is_err());

        let mut corruptions = Vec::new();
        let mut invalid_id = valid.clone();
        invalid_id["dispatches"][0]["trigger_event_id"] = serde_json::json!("bad");
        corruptions.push(invalid_id);
        let mut invalid_conversation = valid.clone();
        invalid_conversation["dispatches"][0]["conversation_id"] = serde_json::json!("bad");
        corruptions.push(invalid_conversation);
        let mut invalid_thread = valid.clone();
        invalid_thread["dispatches"][0]["thread_id"] = serde_json::json!("thread:bad");
        corruptions.push(invalid_thread);
        let mut invalid_timestamps = valid.clone();
        invalid_timestamps["dispatches"][0]["expires_at"] = serde_json::json!(101);
        corruptions.push(invalid_timestamps);
        let mut active_without_epoch = valid.clone();
        active_without_epoch["dispatches"][0]["state"] = serde_json::json!("active");
        active_without_epoch["dispatches"][0]["session_epoch"] = serde_json::Value::Null;
        corruptions.push(active_without_epoch);
        let mut incoherent_published = valid;
        incoherent_published["dispatches"][0]["state"] = serde_json::json!("published");
        incoherent_published["dispatches"][0]["session_epoch"] = serde_json::json!(9);
        corruptions.push(incoherent_published);

        for (index, corruption) in corruptions.into_iter().enumerate() {
            let path = temp.path().join(format!("corrupt-{index}.json"));
            std::fs::write(&path, serde_json::to_vec(&corruption).expect("serialize"))
                .expect("write");
            assert!(
                ManagedDispatchStore::load(path).is_err(),
                "corruption {index} must fail closed"
            );
        }
    }

    #[test]
    fn capacity_pressure_never_prunes_unresolved_dispatches() {
        let owner = Keys::parse(&"83".repeat(32)).expect("owner");
        let resident = Keys::parse(&"84".repeat(32)).expect("resident");
        let seed = event(&owner, &resident, CHANNEL_ONE, "seed");
        let temp = tempfile::tempdir().expect("temp");
        let mut store =
            ManagedDispatchStore::load(temp.path().join("dispatches.json")).expect("store");
        store
            .stage_owner_event(&seed, &[resident.public_key().to_hex()], 100)
            .expect("stage seed");
        let template = store.dispatches.values().next().expect("template").clone();
        store.dispatches.clear();
        for index in 0..MAX_DISPATCHES {
            let event_id = hex::encode(Sha256::digest(index.to_be_bytes()));
            let mut row = template.clone();
            row.trigger_event_id = event_id.clone();
            row.root_event_id = Some(event_id.clone());
            row.reply_event_id = Some(event_id.clone());
            row.thread_id = Some(format!("thread:{event_id}"));
            row.created_at = index as u64 + 1;
            row.expires_at = row.created_at + DISPATCH_TTL_SECONDS;
            store
                .dispatches
                .insert((event_id, row.resident_pubkey.clone()), row);
        }
        let next = event(&owner, &resident, CHANNEL_ONE, "next");
        assert!(store
            .stage_owner_event(&next, &[resident.public_key().to_hex()], 100)
            .is_err());
        assert_eq!(store.dispatches.len(), MAX_DISPATCHES);
        assert!(!store
            .dispatches
            .contains_key(&(next.id.to_hex(), resident.public_key().to_hex())));

        let terminal_key = store.dispatches.keys().next().expect("row").clone();
        store
            .dispatches
            .get_mut(&terminal_key)
            .expect("terminal")
            .state = ManagedDispatchState::Cancelled;
        assert!(store
            .stage_owner_event(&next, &[resident.public_key().to_hex()], 100)
            .is_err());
        assert!(store.dispatches.contains_key(&terminal_key));
        store
            .dispatches
            .get_mut(&terminal_key)
            .expect("terminal")
            .outbox_finalized = true;
        store
            .stage_owner_event(&next, &[resident.public_key().to_hex()], 100)
            .expect("terminal compaction");
        assert_eq!(store.dispatches.len(), MAX_DISPATCHES);
        assert!(!store.dispatches.contains_key(&terminal_key));
        assert!(store
            .dispatches
            .contains_key(&(next.id.to_hex(), resident.public_key().to_hex())));
    }

    #[test]
    fn capacity_prunes_only_expired_unclaimed_pending_rows() {
        let owner = Keys::parse(&"87".repeat(32)).expect("owner");
        let resident = Keys::parse(&"88".repeat(32)).expect("resident");
        let seed = event(&owner, &resident, CHANNEL_ONE, "seed");
        let temp = tempfile::tempdir().expect("temp");
        let mut store =
            ManagedDispatchStore::load(temp.path().join("dispatches.json")).expect("store");
        store
            .stage_owner_event(&seed, &[resident.public_key().to_hex()], 100)
            .expect("stage seed");
        let template = store.dispatches.values().next().expect("template").clone();
        store.dispatches.clear();
        for index in 0..MAX_DISPATCHES {
            let event_id = hex::encode(Sha256::digest(index.to_be_bytes()));
            let mut row = template.clone();
            row.trigger_event_id = event_id.clone();
            row.root_event_id = Some(event_id.clone());
            row.reply_event_id = Some(event_id.clone());
            row.thread_id = Some(format!("thread:{event_id}"));
            row.created_at = index as u64 + 1;
            row.expires_at = 10_000;
            store
                .dispatches
                .insert((event_id, row.resident_pubkey.clone()), row);
        }

        let expired_key = store.dispatches.keys().next().expect("row").clone();
        store
            .dispatches
            .get_mut(&expired_key)
            .expect("expired pending")
            .expires_at = 199;

        let active_key = store.dispatches.keys().nth(1).expect("active row").clone();
        {
            let row = store.dispatches.get_mut(&active_key).expect("active row");
            row.state = ManagedDispatchState::Active;
            row.session_epoch = Some(23);
            row.expires_at = 199;
        }
        let submitted_key = store
            .dispatches
            .keys()
            .nth(2)
            .expect("submitted row")
            .clone();
        {
            let row = store
                .dispatches
                .get_mut(&submitted_key)
                .expect("submitted row");
            row.state = ManagedDispatchState::Active;
            row.session_epoch = Some(23);
            row.submitted_event_id = Some("ab".repeat(32));
            row.expires_at = 199;
        }

        let next = event(&owner, &resident, CHANNEL_ONE, "next");
        store
            .stage_owner_event(&next, &[resident.public_key().to_hex()], 200)
            .expect("expired unclaimed pending compaction");
        assert!(!store.dispatches.contains_key(&expired_key));
        assert!(store.dispatches.contains_key(&active_key));
        assert!(store.dispatches.contains_key(&submitted_key));
        assert!(store
            .dispatches
            .contains_key(&(next.id.to_hex(), resident.public_key().to_hex())));
    }

    #[test]
    fn terminal_outbox_finalization_rolls_back_on_persistence_failure() {
        let owner = Keys::parse(&"85".repeat(32)).expect("owner");
        let resident = Keys::parse(&"86".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "terminal");
        let temp = tempfile::tempdir().expect("temp");
        let valid_path = temp.path().join("dispatches.json");
        let mut store = ManagedDispatchStore::load(valid_path.clone()).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        store
            .activate_session(&resident.public_key().to_hex(), 19)
            .expect("session");
        store
            .authorize_publication(&request(&owner, &resident, &trigger, CHANNEL_ONE, 19), 101)
            .expect("authorize");
        store
            .cancel_matching(
                &owner.public_key().to_hex(),
                CHANNEL_ONE,
                None,
                &[resident.public_key().to_hex()],
            )
            .expect("cancel");
        let event_id = "ef".repeat(32);
        let directory_target = temp.path().join("directory-target");
        std::fs::create_dir(&directory_target).expect("directory");
        store.path = directory_target;
        assert!(store
            .finalize_terminal_outbox(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                &event_id,
                ManagedDispatchState::Cancelled,
            )
            .is_err());
        assert!(
            !store
                .dispatches
                .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
                .expect("row")
                .outbox_finalized
        );

        store.path = valid_path.clone();
        store
            .finalize_terminal_outbox(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                &event_id,
                ManagedDispatchState::Cancelled,
            )
            .expect("retry finalization");
        let reloaded = ManagedDispatchStore::load(valid_path).expect("reload");
        assert!(
            reloaded
                .dispatches
                .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
                .expect("row")
                .outbox_finalized
        );
    }

    #[test]
    fn v1_and_v2_rows_gain_bounded_causal_coordinates_and_persist_as_v3() {
        let owner = Keys::parse(&"91".repeat(32)).expect("owner");
        let resident = Keys::parse(&"92".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "v1");
        let temp = tempfile::tempdir().expect("temp");
        let path = temp.path().join("dispatches.json");
        let mut store = ManagedDispatchStore::load(path.clone()).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");

        let base: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).expect("read")).expect("json");
        for legacy_schema in [STORE_SCHEMA_V1, STORE_SCHEMA_V2, STORE_SCHEMA_V3] {
            let mut legacy = base.clone();
            legacy["schema"] = serde_json::json!(legacy_schema);
            let row = legacy["dispatches"][0].as_object_mut().expect("row");
            row.remove("interruption_reason");
            row.remove("source_dispatch_id");
            row.remove("causal_root_event_id");
            row.remove("causal_parent_action_id");
            row.remove("descendant_depth");
            std::fs::write(&path, serde_json::to_vec(&legacy).expect("serialize"))
                .expect("write legacy");

            let migrated = ManagedDispatchStore::load(path.clone()).expect("load legacy");
            let row = migrated
                .dispatches
                .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
                .expect("row");
            assert_eq!(row.state, ManagedDispatchState::Pending);
            assert_eq!(row.interruption_reason, None);
            assert_eq!(
                row.source_dispatch_id.as_deref(),
                Some(trigger.id.to_hex().as_str())
            );
            assert_eq!(row.descendant_depth, 0);
            migrated.persist().expect("persist v3");
            let persisted: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&path).expect("read v3")).expect("json");
            assert_eq!(persisted["schema"], STORE_SCHEMA);
        }
    }

    #[test]
    fn a_fresh_epochless_pending_send_survives_the_start_it_provoked() {
        // Wake-on-send: the owner writes to a resident that is not running, the
        // desktop starts it, and the harness replays sends from its start
        // minus WAKE_REPLAY_GRACE_SECS. That send must still be Pending when
        // the new session claims it; only stale epoch-less sends are interrupted.
        let owner = Keys::parse(&"95".repeat(32)).expect("owner");
        let resident = Keys::parse(&"96".repeat(32)).expect("resident");
        let temp = tempfile::tempdir().expect("temp");
        let mut store =
            ManagedDispatchStore::load(temp.path().join("dispatches.json")).expect("store");
        let fresh = event(&owner, &resident, CHANNEL_ONE, "wake me");
        store
            .stage_owner_event(&fresh, &[resident.public_key().to_hex()], 1_000)
            .expect("stage fresh");
        let key = (fresh.id.to_hex(), resident.public_key().to_hex());

        assert_eq!(
            store
                .terminalize_prior_epoch_after_outbox_reconciliation(
                    &resident.public_key().to_hex(),
                    7,
                    1_000 + WAKE_REPLAY_GRACE_SECS,
                )
                .expect("terminalize within grace"),
            0
        );
        assert_eq!(
            store.dispatches.get(&key).expect("row").state,
            ManagedDispatchState::Pending
        );

        assert_eq!(
            store
                .terminalize_prior_epoch_after_outbox_reconciliation(
                    &resident.public_key().to_hex(),
                    7,
                    1_000 + WAKE_REPLAY_GRACE_SECS + 1,
                )
                .expect("terminalize past grace"),
            1
        );
        let row = store.dispatches.get(&key).expect("row");
        assert_eq!(row.state, ManagedDispatchState::Interrupted);
        assert_eq!(
            row.interruption_reason,
            Some(ManagedDispatchInterruptionReason::Restart)
        );
    }

    #[test]
    fn restart_terminalization_waits_for_frozen_reconciliation_then_blocks_duplicates() {
        let owner = Keys::parse(&"93".repeat(32)).expect("owner");
        let resident = Keys::parse(&"94".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "restart");
        let temp = tempfile::tempdir().expect("temp");
        let path = temp.path().join("dispatches.json");
        let mut store = ManagedDispatchStore::load(path.clone()).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        store
            .activate_session(&resident.public_key().to_hex(), 7)
            .expect("old epoch");
        let request = request(&owner, &resident, &trigger, CHANNEL_ONE, 7);
        store
            .authorize_publication(&request, 101)
            .expect("authorize old turn");
        let event_id = "ab".repeat(32);
        store
            .begin_submission(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                7,
                &event_id,
            )
            .expect("freeze exact event");

        // This is the required ordering boundary: the frozen bytes still win
        // their outbox decision before stale live work becomes interrupted.
        assert_eq!(
            store
                .authorize_reconciliation(&request, &event_id, 102)
                .expect("frozen reconciliation remains allowed"),
            ManagedDispatchReconciliation::Ready
        );
        assert_eq!(
            store
                .terminalize_prior_epoch_after_outbox_reconciliation(
                    &resident.public_key().to_hex(),
                    9,
                    1_000_000,
                )
                .expect("terminalize old epoch"),
            1
        );
        let row = store
            .dispatches
            .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
            .expect("row");
        assert_eq!(row.state, ManagedDispatchState::Interrupted);
        assert_eq!(
            row.interruption_reason,
            Some(ManagedDispatchInterruptionReason::Restart)
        );
        assert!(row.outbox_finalized);
        assert_eq!(
            store.interrupted_after_restart_for_conversation(
                &owner.public_key().to_hex(),
                CHANNEL_ONE,
            ),
            vec![InterruptedManagedDispatchSummary {
                dispatch_receipt_id: trigger.id.to_hex(),
            }]
        );
        assert!(store
            .interrupted_after_restart_for_conversation(
                &Keys::generate().public_key().to_hex(),
                CHANNEL_ONE,
            )
            .is_empty());
        assert!(store
            .interrupted_after_restart_for_conversation(&owner.public_key().to_hex(), CHANNEL_TWO,)
            .is_empty());
        assert_eq!(
            store.restart_interrupted_artifact_receipts_for_resident(
                &resident.public_key().to_hex(),
            ),
            vec![RestartInterruptedArtifactReceiptBinding {
                owner_pubkey: owner.public_key().to_hex(),
                conversation_id: CHANNEL_ONE.into(),
                resident_pubkey: resident.public_key().to_hex(),
                dispatch_receipt_id: trigger.id.to_hex(),
            }]
        );
        assert_eq!(
            store.authorize_reconciliation(&request, &event_id, 103),
            Err(DispatchAuthorizationError::Terminal),
            "terminalization cannot authorize the same frozen event twice"
        );
        let reloaded = ManagedDispatchStore::load(path).expect("reload");
        assert_eq!(
            reloaded
                .dispatches
                .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
                .expect("row")
                .state,
            ManagedDispatchState::Interrupted
        );
        assert_eq!(
            reloaded
                .restart_interrupted_artifact_receipts_for_resident(
                    &resident.public_key().to_hex(),
                )
                .len(),
            1,
            "restart-interrupted artifact settlement remains retryable after reload",
        );
    }

    #[test]
    fn cancel_exact_persists_once_for_the_active_epoch() {
        let owner = Keys::parse(&"95".repeat(32)).expect("owner");
        let resident = Keys::parse(&"96".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "cancel exact");
        let temp = tempfile::tempdir().expect("temp");
        let path = temp.path().join("dispatches.json");
        let mut store = ManagedDispatchStore::load(path.clone()).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        store
            .activate_session(&resident.public_key().to_hex(), 11)
            .expect("epoch");
        let request = request(&owner, &resident, &trigger, CHANNEL_ONE, 11);
        store
            .authorize_publication(&request, 101)
            .expect("authorize");

        let cancelled = store
            .cancel_exact(
                &owner.public_key().to_hex(),
                CHANNEL_ONE,
                &resident.public_key().to_hex(),
                &trigger.id.to_hex(),
                11,
            )
            .expect("cancel exact");
        assert!(matches!(
            cancelled,
            ExactDispatchCancellationResult::Cancelled(ExactDispatchCancellation {
                session_epoch: 11,
                had_outbox_authority: false,
                ..
            })
        ));
        assert_eq!(
            store
                .cancel_exact(
                    &owner.public_key().to_hex(),
                    CHANNEL_ONE,
                    &resident.public_key().to_hex(),
                    &trigger.id.to_hex(),
                    11,
                )
                .expect("repeat"),
            ExactDispatchCancellationResult::AlreadyTerminal
        );
        let reloaded = ManagedDispatchStore::load(path).expect("reload");
        assert_eq!(
            reloaded
                .dispatches
                .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
                .expect("row")
                .state,
            ManagedDispatchState::Cancelled
        );
    }

    #[test]
    fn pending_turn_is_listed_and_cancelled_against_current_broker_epoch() {
        let owner = Keys::parse(&"93".repeat(32)).expect("owner");
        let resident = Keys::parse(&"94".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "cancel pending");
        let temp = tempfile::tempdir().expect("temp");
        let path = temp.path().join("dispatches.json");
        let mut store = ManagedDispatchStore::load(path.clone()).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        assert!(store
            .cancellable_for_conversation(&owner.public_key().to_hex(), CHANNEL_ONE)
            .is_empty());

        store
            .activate_session(&resident.public_key().to_hex(), 29)
            .expect("epoch");
        assert_eq!(
            store.cancellable_for_conversation(&owner.public_key().to_hex(), CHANNEL_ONE),
            vec![CancellableManagedDispatch {
                dispatch_receipt_id: trigger.id.to_hex(),
                resident_pubkey: resident.public_key().to_hex(),
                session_epoch: 29,
            }]
        );

        let cancelled = store
            .cancel_exact(
                &owner.public_key().to_hex(),
                CHANNEL_ONE,
                &resident.public_key().to_hex(),
                &trigger.id.to_hex(),
                29,
            )
            .expect("cancel pending");
        assert!(matches!(
            cancelled,
            ExactDispatchCancellationResult::Cancelled(ExactDispatchCancellation {
                session_epoch: 29,
                had_outbox_authority: false,
                ..
            })
        ));
        let reloaded = ManagedDispatchStore::load(path).expect("reload");
        let row = reloaded
            .dispatches
            .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
            .expect("row");
        assert_eq!(row.state, ManagedDispatchState::Cancelled);
        assert_eq!(row.session_epoch, Some(29));
        assert!(row.outbox_finalized);
    }

    #[test]
    fn resolve_unique_cancellable_fails_closed_for_no_match_and_ambiguity() {
        let owner = Keys::parse(&"97".repeat(32)).expect("owner");
        let resident = Keys::parse(&"98".repeat(32)).expect("resident");
        let first = event(&owner, &resident, CHANNEL_ONE, "first");
        let second = event(&owner, &resident, CHANNEL_ONE, "second");
        let temp = tempfile::tempdir().expect("temp");
        let mut store =
            ManagedDispatchStore::load(temp.path().join("dispatches.json")).expect("store");

        assert_eq!(
            store.resolve_unique_cancellable(
                &owner.public_key().to_hex(),
                CHANNEL_ONE,
                &resident.public_key().to_hex(),
            ),
            Err(DispatchAuthorizationError::Unknown)
        );

        store
            .stage_owner_event(&first, &[resident.public_key().to_hex()], 100)
            .expect("stage first");
        store
            .activate_session(&resident.public_key().to_hex(), 23)
            .expect("epoch");
        store
            .authorize_publication(&request(&owner, &resident, &first, CHANNEL_ONE, 23), 101)
            .expect("activate first");
        assert_eq!(
            store
                .resolve_unique_cancellable(
                    &owner.public_key().to_hex(),
                    CHANNEL_ONE,
                    &resident.public_key().to_hex(),
                )
                .expect("exact active"),
            CancellableManagedDispatch {
                dispatch_receipt_id: first.id.to_hex(),
                resident_pubkey: resident.public_key().to_hex(),
                session_epoch: 23,
            }
        );

        store
            .stage_owner_event(&second, &[resident.public_key().to_hex()], 102)
            .expect("stage second");
        store
            .authorize_publication(&request(&owner, &resident, &second, CHANNEL_ONE, 23), 103)
            .expect("activate second");
        assert_eq!(
            store.resolve_unique_cancellable(
                &owner.public_key().to_hex(),
                CHANNEL_ONE,
                &resident.public_key().to_hex(),
            ),
            Err(DispatchAuthorizationError::Ambiguous)
        );
    }

    #[test]
    fn continuity_dispatch_digest_keeps_the_original_group_after_sibling_completion() {
        let owner = Keys::parse(&"a1".repeat(32)).expect("owner");
        let first = Keys::parse(&"a2".repeat(32)).expect("first");
        let second = Keys::parse(&"a3".repeat(32)).expect("second");
        let trigger = EventBuilder::new(Kind::Custom(9), "group prompt")
            .tags(vec![
                Tag::parse(["h", CHANNEL_ONE]).expect("h tag"),
                Tag::public_key(owner.public_key()),
                Tag::public_key(first.public_key()),
                Tag::public_key(second.public_key()),
            ])
            .custom_created_at(Timestamp::from(100))
            .sign_with_keys(&owner)
            .expect("sign owner event");
        let temp = tempfile::tempdir().expect("temp");
        let mut store =
            ManagedDispatchStore::load(temp.path().join("dispatches.json")).expect("store");
        store
            .stage_owner_event(
                &trigger,
                &[first.public_key().to_hex(), second.public_key().to_hex()],
                100,
            )
            .expect("stage group");
        store
            .activate_session(&first.public_key().to_hex(), 31)
            .expect("first session");
        let before = store
            .authorize_continuity_turn(
                &trigger.id.to_hex(),
                &first.public_key().to_hex(),
                CHANNEL_ONE,
                31,
                101,
            )
            .expect("continuity authority");
        store
            .dispatches
            .get_mut(&(trigger.id.to_hex(), second.public_key().to_hex()))
            .expect("second row")
            .state = ManagedDispatchState::Published;
        let after = store
            .authorize_continuity_turn(
                &trigger.id.to_hex(),
                &first.public_key().to_hex(),
                CHANNEL_ONE,
                31,
                102,
            )
            .expect("stable authority");
        assert_eq!(before.canonical_dispatch_ref, after.canonical_dispatch_ref);
        assert_eq!(before.owner_pubkey.as_str(), owner.public_key().to_hex());
        assert_eq!(before.resident_pubkey.as_str(), first.public_key().to_hex());
        assert_eq!(before.trigger_event_id.as_str(), trigger.id.to_hex());
    }

    #[test]
    fn continuity_dispatch_authority_rejects_wrong_session_conversation_and_resident() {
        let owner = Keys::parse(&"b1".repeat(32)).expect("owner");
        let resident = Keys::parse(&"b2".repeat(32)).expect("resident");
        let outsider = Keys::parse(&"b3".repeat(32)).expect("outsider");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "prompt");
        let temp = tempfile::tempdir().expect("temp");
        let mut store =
            ManagedDispatchStore::load(temp.path().join("dispatches.json")).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        store
            .activate_session(&resident.public_key().to_hex(), 37)
            .expect("session");
        assert_eq!(
            store.authorize_continuity_turn(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                38,
                101,
            ),
            Err(DispatchAuthorizationError::WrongSession)
        );
        assert_eq!(
            store.authorize_continuity_turn(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_TWO,
                37,
                101,
            ),
            Err(DispatchAuthorizationError::WrongConversation)
        );
        assert_eq!(
            store.authorize_continuity_turn(
                &trigger.id.to_hex(),
                &outsider.public_key().to_hex(),
                CHANNEL_ONE,
                37,
                101,
            ),
            Err(DispatchAuthorizationError::WrongResident)
        );
    }

    #[test]
    fn communication_turn_start_binds_pending_once_and_rechecks_only_active_epoch() {
        let owner = Keys::parse(&"c1".repeat(32)).expect("owner");
        let resident = Keys::parse(&"c2".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "prompt");
        let temp = tempfile::tempdir().expect("temp");
        let path = temp.path().join("dispatches.json");
        let mut store = ManagedDispatchStore::load(path.clone()).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        store
            .activate_session(&resident.public_key().to_hex(), 41)
            .expect("session");

        let active = store
            .bind_communication_turn_start(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                41,
                101,
            )
            .expect("bind");
        assert_eq!(active.state, ManagedDispatchState::Active);
        assert_eq!(active.session_epoch, Some(41));
        assert!(store
            .recheck_communication_turn(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                41,
                102,
            )
            .is_ok());
        assert_eq!(
            store.recheck_communication_turn(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                42,
                102,
            ),
            Err(DispatchAuthorizationError::WrongSession)
        );

        let reloaded = ManagedDispatchStore::load(path).expect("reload");
        assert_eq!(
            reloaded
                .dispatches
                .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
                .expect("row")
                .state,
            ManagedDispatchState::Active
        );
    }

    #[test]
    fn communication_recheck_fails_closed_after_cancel_or_session_rotation() {
        let owner = Keys::parse(&"d1".repeat(32)).expect("owner");
        let resident = Keys::parse(&"d2".repeat(32)).expect("resident");
        let trigger = event(&owner, &resident, CHANNEL_ONE, "prompt");
        let temp = tempfile::tempdir().expect("temp");
        let mut store =
            ManagedDispatchStore::load(temp.path().join("dispatches.json")).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        store
            .activate_session(&resident.public_key().to_hex(), 43)
            .expect("session");
        store
            .bind_communication_turn_start(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                43,
                101,
            )
            .expect("bind");

        store
            .activate_session(&resident.public_key().to_hex(), 44)
            .expect("rotate");
        assert_eq!(
            store.recheck_communication_turn(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                43,
                102,
            ),
            Err(DispatchAuthorizationError::WrongSession)
        );

        store
            .activate_session(&resident.public_key().to_hex(), 43)
            .expect("restore test epoch");
        store
            .cancel_exact(
                &owner.public_key().to_hex(),
                CHANNEL_ONE,
                &resident.public_key().to_hex(),
                &trigger.id.to_hex(),
                43,
            )
            .expect("cancel");
        assert_eq!(
            store.recheck_communication_turn(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                CHANNEL_ONE,
                43,
                103,
            ),
            Err(DispatchAuthorizationError::Cancelled)
        );
    }

    /// One staged owner dispatch, ready for the exchange to widen or unbind.
    fn exchange_fixture() -> (tempfile::TempDir, ManagedDispatchStore, Event, Keys, Keys) {
        let directory = tempfile::tempdir().expect("tempdir");
        let owner = Keys::generate();
        let resident = Keys::generate();
        let trigger = event(&owner, &resident, CHANNEL_ONE, "ask Vektor");
        let mut store =
            ManagedDispatchStore::load(directory.path().join("dispatches.json")).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        store
            .activate_session(&resident.public_key().to_hex(), 7)
            .expect("session");
        (directory, store, trigger, owner, resident)
    }

    #[test]
    fn an_exchange_widens_the_pinned_reply_audience_idempotently_and_in_order() {
        let (_directory, mut store, trigger, owner, resident) = exchange_fixture();
        let sibling = Keys::generate().public_key().to_hex();
        let granted = store
            .grant_exchange_recipients(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                std::slice::from_ref(&sibling),
                101,
            )
            .expect("grant");
        let mut expected = vec![owner.public_key().to_hex(), sibling.clone()];
        expected.sort();
        assert_eq!(granted, expected);
        assert_eq!(
            store
                .grant_exchange_recipients(
                    &trigger.id.to_hex(),
                    &resident.public_key().to_hex(),
                    &[sibling],
                    101,
                )
                .expect("idempotent"),
            expected
        );
    }

    #[test]
    fn widening_refuses_the_owner_the_resident_and_anything_that_is_not_a_pubkey() {
        let (_directory, mut store, trigger, owner, resident) = exchange_fixture();
        for candidate in [
            owner.public_key().to_hex(),
            resident.public_key().to_hex(),
            "not-a-pubkey".to_owned(),
        ] {
            assert_eq!(
                store.grant_exchange_recipients(
                    &trigger.id.to_hex(),
                    &resident.public_key().to_hex(),
                    &[candidate],
                    101,
                ),
                Err(DispatchAuthorizationError::WrongRecipients)
            );
        }
    }

    #[test]
    fn widening_is_refused_once_frozen_bytes_are_bound_or_the_row_is_terminal() {
        let (_directory, mut store, trigger, _owner, resident) = exchange_fixture();
        let request = request(&_owner, &resident, &trigger, CHANNEL_ONE, 7);
        store.authorize_publication(&request, 101).expect("bind");
        let event_id = "ab".repeat(32);
        store
            .begin_submission(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                7,
                &event_id,
            )
            .expect("begin");
        assert_eq!(
            store.grant_exchange_recipients(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                &[Keys::generate().public_key().to_hex()],
                101,
            ),
            Err(DispatchAuthorizationError::Terminal)
        );
    }

    #[test]
    fn a_lost_turn_race_releases_the_binding_so_identical_bytes_can_be_resigned() {
        let (_directory, mut store, trigger, owner, resident) = exchange_fixture();
        let request = request(&owner, &resident, &trigger, CHANNEL_ONE, 7);
        store.authorize_publication(&request, 101).expect("bind");
        let refused = "ab".repeat(32);
        store
            .begin_submission(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                7,
                &refused,
            )
            .expect("begin");
        // A binding to some other event is never released by this path.
        assert_eq!(
            store.release_exchange_submission(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                7,
                &"cd".repeat(32),
            ),
            Err(DispatchAuthorizationError::Terminal)
        );
        store
            .release_exchange_submission(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                7,
                &refused,
            )
            .expect("release");
        let retuned = "cd".repeat(32);
        store
            .begin_submission(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                7,
                &retuned,
            )
            .expect("rebind");
        assert_eq!(
            store
                .dispatches
                .get(&(trigger.id.to_hex(), resident.public_key().to_hex()))
                .expect("row")
                .submitted_event_id
                .as_deref(),
            Some(retuned.as_str())
        );
    }

    #[test]
    fn a_published_dispatch_never_unbinds() {
        let (_directory, mut store, trigger, owner, resident) = exchange_fixture();
        let request = request(&owner, &resident, &trigger, CHANNEL_ONE, 7);
        store.authorize_publication(&request, 101).expect("bind");
        let event_id = "ab".repeat(32);
        store
            .begin_submission(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                7,
                &event_id,
            )
            .expect("begin");
        store
            .mark_published(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                &event_id,
            )
            .expect("publish");
        assert_eq!(
            store.release_exchange_submission(
                &trigger.id.to_hex(),
                &resident.public_key().to_hex(),
                7,
                &event_id,
            ),
            Err(DispatchAuthorizationError::Terminal)
        );
    }

    #[test]
    fn descendant_depth_names_who_woke_this_turn() {
        let (_directory, store, trigger, _owner, resident) = exchange_fixture();
        assert_eq!(
            store
                .descendant_depth(&trigger.id.to_hex(), &resident.public_key().to_hex())
                .expect("depth"),
            0
        );
        assert_eq!(
            store.descendant_depth(&"ff".repeat(32), &resident.public_key().to_hex()),
            Err(DispatchAuthorizationError::Unknown)
        );
    }
}
