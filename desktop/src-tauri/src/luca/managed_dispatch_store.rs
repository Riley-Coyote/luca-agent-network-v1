//! Desktop-owned admission records for Luca-managed resident turns.
//!
//! Relay chronology is not authority to publish a fresh resident response. A
//! row is created only while this desktop is sending the exact signed owner
//! event that triggered the turn. The broker later consumes that row after an
//! exact routing/session comparison.

use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

use atomic_write_file::AtomicWriteFile;
use luca_protocol::{Hex64, ManagedMessagePublishRequestV1};
use nostr::{Event, EventId};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const STORE_SCHEMA: &str = "luca.managed-dispatch-store.v1";
const MAX_DISPATCHES: usize = 512;
const DISPATCH_TTL_SECONDS: u64 = 30 * 60;

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
}

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
    pub resolved_p_tags: Vec<String>,
    pub created_at: u64,
    pub expires_at: u64,
    pub session_epoch: Option<u64>,
    pub state: ManagedDispatchState,
    #[serde(default)]
    pub submitted_event_id: Option<String>,
    pub published_event_id: Option<String>,
    #[serde(default)]
    pub outbox_finalized: bool,
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
    Expired,
    Terminal,
    WrongOwner,
    WrongResident,
    WrongConversation,
    WrongThread,
    WrongRecipients,
    WrongSession,
    Cancelled,
    Persistence,
}

/// Bounded desktop-owned store. It contains no resident secret or model output.
pub(crate) struct ManagedDispatchStore {
    path: PathBuf,
    dispatches: HashMap<(String, String), ActiveDispatch>,
    active_sessions: HashMap<String, u64>,
}

impl ManagedDispatchStore {
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
            if persisted.schema != STORE_SCHEMA || persisted.dispatches.len() > MAX_DISPATCHES {
                return Err("managed dispatch store schema or row count is invalid".into());
            }
            let mut dispatches = HashMap::with_capacity(persisted.dispatches.len());
            for dispatch in persisted.dispatches {
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
    pub(crate) fn activate_session(
        &mut self,
        resident_pubkey: &str,
        session_epoch: u64,
    ) -> Result<(), String> {
        if session_epoch == 0 {
            return Err("managed dispatch session epoch must be nonzero".into());
        }
        self.active_sessions
            .insert(resident_pubkey.to_ascii_lowercase(), session_epoch);
        Ok(())
    }

    /// Atomically stage rows for all managed residents named by one exact owner event.
    pub(crate) fn stage_owner_event(
        &mut self,
        event: &Event,
        managed_residents: &[String],
        now_unix_secs: u64,
    ) -> Result<Vec<(String, String)>, String> {
        if event.kind != nostr::Kind::Custom(9)
            || !event.verify_id()
            || !event.verify_signature()
            || event.created_at.as_secs() > now_unix_secs + 60
        {
            return Err("managed dispatch trigger event is invalid".into());
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
                // G1 is owner-only dispatch. A resident final replies to the
                // exact owner trigger and addresses only its author; copying
                // trigger recipients would recursively invoke residents before
                // F10's causal-ledger authorizer exists.
                resolved_p_tags: vec![event.pubkey.to_hex()],
                created_at: now_unix_secs,
                expires_at: now_unix_secs.saturating_add(DISPATCH_TTL_SECONDS),
                session_epoch: None,
                state: ManagedDispatchState::Pending,
                submitted_event_id: None,
                published_event_id: None,
                outbox_finalized: false,
            };
            if let Some(existing) = self.dispatches.get(&key) {
                if existing.trigger_event_id != candidate.trigger_event_id
                    || existing.owner_pubkey != candidate.owner_pubkey
                    || existing.resident_pubkey != candidate.resident_pubkey
                    || existing.conversation_id != candidate.conversation_id
                    || existing.thread_id != candidate.thread_id
                    || existing.root_event_id != candidate.root_event_id
                    || existing.reply_event_id != candidate.reply_event_id
                    || existing.resolved_p_tags != candidate.resolved_p_tags
                    || existing.submitted_event_id != candidate.submitted_event_id
                    || existing.outbox_finalized != candidate.outbox_finalized
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
                ManagedDispatchState::Rejected | ManagedDispatchState::Published => {
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
            ManagedDispatchState::Rejected | ManagedDispatchState::Published => {
                Err(DispatchAuthorizationError::Terminal)
            }
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
            ManagedDispatchState::Rejected | ManagedDispatchState::Published => {
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
            ManagedDispatchState::Published => Err(DispatchAuthorizationError::Terminal),
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
            ManagedDispatchState::Cancelled | ManagedDispatchState::Rejected
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
    if dispatch.owner_pubkey == dispatch.resident_pubkey
        || uuid::Uuid::parse_str(&dispatch.conversation_id).is_err()
        || dispatch.created_at > dispatch.expires_at
        || dispatch.expires_at.saturating_sub(dispatch.created_at) != DISPATCH_TTL_SECONDS
        || dispatch.resolved_p_tags != vec![dispatch.owner_pubkey.clone()]
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
        ManagedDispatchState::Published => {
            dispatch.session_epoch.is_some()
                && dispatch.submitted_event_id.is_some()
                && dispatch.submitted_event_id == dispatch.published_event_id
        }
    };
    if !coherent {
        return Err("managed dispatch lifecycle tuple is invalid".into());
    }
    Ok(())
}

struct EventRouting {
    conversation_id: String,
    thread_id: Option<String>,
    root_event_id: Option<String>,
    reply_event_id: Option<String>,
    trigger_p_tags: Vec<String>,
}

fn routing_from_event(event: &Event) -> Result<EventRouting, String> {
    let mut conversations = Vec::new();
    let mut root = None;
    let mut reply = None;
    let mut recipients = Vec::new();
    for tag in event.tags.iter() {
        let values = tag.as_slice();
        match values.first().map(String::as_str) {
            Some("h") if values.len() == 2 => {
                uuid::Uuid::parse_str(&values[1])
                    .map_err(|_| "event contains invalid conversation tag".to_string())?;
                conversations.push(values[1].clone());
            }
            Some("h") => return Err("event contains malformed conversation tag".into()),
            Some("p") if values.len() >= 2 => {
                Hex64::parse(values[1].to_ascii_lowercase())
                    .map_err(|_| "event contains invalid p tag".to_string())?;
                recipients.push(values[1].to_ascii_lowercase());
            }
            Some("e") if values.len() >= 4 && values[3] == "root" => {
                EventId::from_hex(&values[1])
                    .map_err(|_| "event contains invalid root event ID".to_string())?;
                if root.replace(values[1].clone()).is_some() {
                    return Err("event contains ambiguous root tags".into());
                }
            }
            Some("e") if values.len() >= 4 && values[3] == "reply" => {
                EventId::from_hex(&values[1])
                    .map_err(|_| "event contains invalid reply event ID".to_string())?;
                if reply.replace(values[1].clone()).is_some() {
                    return Err("event contains ambiguous reply tags".into());
                }
            }
            Some("e") => return Err("event contains unmarked or malformed thread tag".into()),
            _ => {}
        }
    }
    if conversations.len() != 1 {
        return Err("event must contain exactly one conversation tag".into());
    }
    recipients.sort();
    recipients.dedup();
    let (final_root, final_reply) = match (root, reply) {
        (None, None) => (event.id.to_hex(), event.id.to_hex()),
        (None, Some(reply)) => (reply.clone(), reply),
        (Some(root), Some(reply)) => (root, reply),
        (Some(_), None) => return Err("event thread routing is incomplete".into()),
    };
    Ok(EventRouting {
        conversation_id: conversations.remove(0),
        thread_id: Some(format!("thread:{final_root}")),
        root_event_id: Some(final_root),
        reply_event_id: Some(final_reply),
        trigger_p_tags: recipients,
    })
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

fn atomic_write_restricted(path: &Path, bytes: &[u8]) -> Result<(), String> {
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
            resolved_p_tags: vec![Hex64::parse(owner.public_key().to_hex()).expect("owner")],
            final_draft: "final answer".into(),
            dispatch_receipt_id: receipt,
            cancellation_epoch: SafeU53::new(epoch).expect("epoch"),
        }
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
}
