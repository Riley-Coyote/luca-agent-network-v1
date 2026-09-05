//! Owner-reviewed repository connection through the existing conversation broker.
//! Paths and access policy stay with Brain; the caller receives verified metadata only.

use std::{
    collections::HashMap,
    sync::{atomic::Ordering, Mutex, MutexGuard, OnceLock},
    thread,
    time::{Duration, Instant},
};

use luca_protocol::{ConnectedBrainSourceKindV1, ConnectedBrainSourceStatusV1, OpaqueId};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use super::{
    exchange_relay::{AppExchangeRelay, ExchangeRelay},
    owner_brain_store::ConnectedBrainSourceSummaryV1,
    resident_proposals::{verify_origin, ResidentProposalScope},
};

const EVENT: &str = "luca://repository-connection-proposal";
const RESOLVED_EVENT: &str = "luca://repository-connection-proposal-resolved";
const LIFETIME: Duration = Duration::from_secs(15 * 60);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Arguments {
    purpose: String,
}

impl Arguments {
    fn validate(&self) -> Result<(), String> {
        if self.purpose.trim().is_empty()
            || self.purpose.len() > 500
            || self.purpose.chars().any(char::is_control)
        {
            return Err("Explain the repository connection in one short sentence.".into());
        }
        Ok(())
    }
}

/// A host-scoped review; model arguments cannot choose identities, paths or grants.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryConnectionProposalV1 {
    request_id: String,
    owner_pubkey: String,
    resident_pubkey: String,
    conversation_id: String,
    purpose: String,
    created_at: String,
}

#[derive(Clone, Default)]
struct Attempt {
    running: bool,
    source_id: Option<OpaqueId>,
    write_started: bool,
    confirmed: bool,
    replayed: Option<bool>,
}

struct Pending {
    scope: ResidentProposalScope,
    projection: RepositoryConnectionProposalV1,
    deadline: Instant,
    attempt: Option<Attempt>,
    result: Option<Value>,
}

#[derive(Clone)]
struct Completed {
    scope: ResidentProposalScope,
    attempt: Attempt,
    deadline: Instant,
}

#[derive(Default)]
struct Store {
    pending: HashMap<String, Pending>,
    completed: HashMap<String, Completed>,
}

fn store() -> &'static Mutex<Store> {
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(Store::default()))
}

fn lock_store() -> Result<MutexGuard<'static, Store>, String> {
    store()
        .lock()
        .map_err(|_| "Repository review is unavailable.".into())
}

fn require_waiting(pending: &Pending) -> Result<(), String> {
    if pending.result.is_some()
        || Instant::now() >= pending.deadline
        || !pending.scope.active.load(Ordering::SeqCst)
    {
        return Err("This repository review is no longer waiting.".into());
    }
    Ok(())
}

fn waiting_scope(request_id: &str) -> Result<ResidentProposalScope, String> {
    let state = lock_store()?;
    let pending = state
        .pending
        .get(request_id)
        .ok_or("Repository review has ended.")?;
    require_waiting(pending)?;
    Ok(pending.scope.clone())
}

fn incomplete(request_id: &str, pending: &Pending, reason: &str) -> Value {
    json!({
        "requestId": request_id, "status": "incomplete", "reason": reason,
        "sourceId": pending.attempt.as_ref().and_then(|attempt| attempt.source_id.clone()),
        "connectionMayHaveStarted": pending.attempt.as_ref().is_some_and(|attempt| attempt.write_started),
        "message": "No verified connection result was returned. Check existing Brain sources before asking to connect again; an in-progress connection may still finish."
    })
}

fn close_pending(state: &mut Store, request_id: &str, reason: &str) -> Result<Value, String> {
    let pending = state
        .pending
        .get_mut(request_id)
        .ok_or("Repository review has ended.")?;
    if pending.result.is_none() {
        pending.result = Some(incomplete(request_id, pending, reason));
    }
    pending
        .result
        .clone()
        .ok_or_else(|| "Repository review has no result.".into())
}

fn retain_completion(state: &mut Store, request_id: String, pending: Pending) {
    state
        .completed
        .retain(|_, item| Instant::now() < item.deadline);
    if pending
        .result
        .as_ref()
        .is_none_or(|result| result["status"] != "repository_available")
    {
        return;
    }
    let Some(attempt) = pending.attempt else {
        return;
    };
    if state.completed.len() >= 64 {
        if let Some(oldest) = state
            .completed
            .iter()
            .min_by_key(|(_, item)| item.deadline)
            .map(|(id, _)| id.clone())
        {
            state.completed.remove(&oldest);
        }
    }
    state.completed.insert(
        request_id,
        Completed {
            scope: pending.scope,
            attempt,
            deadline: pending.deadline,
        },
    );
}

struct ReviewGuard {
    app: AppHandle,
    request_id: String,
}

impl Drop for ReviewGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = store().lock() {
            if let Some(pending) = state.pending.remove(&self.request_id) {
                retain_completion(&mut state, self.request_id.clone(), pending);
            }
        }
        let _ = self
            .app
            .emit(RESOLVED_EVENT, json!({"requestId": self.request_id}));
    }
}

/// Await one owner-selected repository, without adding authority to model input.
pub(crate) fn propose_repository_connection(
    app: &AppHandle,
    scope: ResidentProposalScope,
    arguments: Value,
    mut caller_cancelled: impl FnMut() -> bool,
) -> Result<String, String> {
    let arguments: Arguments = serde_json::from_value(arguments)
        .map_err(|_| "Repository proposal arguments are invalid.".to_owned())?;
    arguments.validate()?;
    verify_origin(app, &scope)?;
    let request_id = format!("repository-proposal-{}", uuid::Uuid::new_v4());
    let projection = RepositoryConnectionProposalV1 {
        request_id: request_id.clone(),
        owner_pubkey: scope.owner.as_str().to_owned(),
        resident_pubkey: scope.resident.as_str().to_owned(),
        conversation_id: scope.conversation.as_str().to_owned(),
        purpose: arguments.purpose.trim().to_owned(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    {
        let mut state = lock_store()?;
        if !state.pending.is_empty() {
            return Err("Another repository review is open. Finish or close it first.".into());
        }
        state.pending.insert(
            request_id.clone(),
            Pending {
                scope: scope.clone(),
                projection: projection.clone(),
                deadline: Instant::now() + LIFETIME,
                attempt: None,
                result: None,
            },
        );
    }
    let _guard = ReviewGuard {
        app: app.clone(),
        request_id: request_id.clone(),
    };
    app.emit(EVENT, projection)
        .map_err(|_| "Repository review could not be opened.")?;
    let result = loop {
        let (result, deadline) = {
            let state = lock_store()?;
            let pending = state
                .pending
                .get(&request_id)
                .ok_or("Repository review has ended.")?;
            (pending.result.clone(), pending.deadline)
        };
        if let Some(result) = result {
            break result;
        }
        let reason = if !scope.active.load(Ordering::SeqCst) {
            Some("resident_session_ended")
        } else if caller_cancelled() {
            Some("caller_disconnected")
        } else if Instant::now() >= deadline {
            Some("review_expired")
        } else {
            None
        };
        if let Some(reason) = reason {
            break close_pending(&mut *lock_store()?, &request_id, reason)?;
        }
        thread::sleep(Duration::from_millis(50));
    };
    let owner = AppExchangeRelay::new(app.clone())
        .owner()
        .map_err(|_| "Current owner unavailable.")?;
    if owner != scope.owner {
        return Err("Repository result belongs to another owner.".into());
    }
    let result = if result["status"] == "repository_available" {
        let (_, attempt, _) = completion_snapshot(&*lock_store()?, &request_id)?;
        verify_origin(app, &scope)?;
        let mut current = current_result(app, &scope, &attempt)?;
        current["requestId"] = json!(request_id);
        verify_origin(app, &scope)?;
        current
    } else {
        result
    };
    serde_json::to_string(&result).map_err(|_| "Repository result could not be encoded.".into())
}

/// Replay only the current owner's live repository review after renderer initialization.
#[tauri::command]
pub fn list_repository_connection_proposals(
    app: AppHandle,
) -> Result<Vec<RepositoryConnectionProposalV1>, String> {
    let owner = AppExchangeRelay::new(app)
        .owner()
        .map_err(|_| "Current owner unavailable.")?;
    Ok(lock_store()?
        .pending
        .values()
        .filter(|pending| pending.scope.owner == owner && require_waiting(pending).is_ok())
        .map(|pending| pending.projection.clone())
        .collect())
}

/// Recheck the exact requesting session and conversation before presenting owner review.
#[tauri::command]
pub async fn authorize_repository_connection_proposal(
    app: AppHandle,
    request_id: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || verify_origin(&app, &waiting_scope(&request_id)?))
        .await
        .map_err(|_| "Repository review authorization worker failed.".to_owned())?
}

fn begin_attempt(state: &mut Store, request_id: &str) -> Result<(), String> {
    let pending = state
        .pending
        .get_mut(request_id)
        .ok_or("Repository review has ended.")?;
    require_waiting(pending)?;
    if pending.attempt.is_some() {
        return Err("This connection was already attempted. Verify its result or inspect Brain before connecting again.".into());
    }
    pending.attempt = Some(Attempt {
        running: true,
        ..Attempt::default()
    });
    Ok(())
}

/// One mutation attempt per review, held before discovery or indexing can begin.
pub(crate) struct ConnectionAttemptGuard {
    app: AppHandle,
    request_id: String,
}

/// Reserve one host-verified mutation attempt before discovery or indexing.
pub(crate) fn begin_connection(
    app: &AppHandle,
    request_id: &str,
) -> Result<ConnectionAttemptGuard, String> {
    verify_origin(app, &waiting_scope(request_id)?)?;
    begin_attempt(&mut *lock_store()?, request_id)?;
    Ok(ConnectionAttemptGuard {
        app: app.clone(),
        request_id: request_id.to_owned(),
    })
}

impl ConnectionAttemptGuard {
    /// Bind only a host-derived repository identity; histories cannot enter this proposal.
    pub(crate) fn bind_candidate(
        &self,
        source_id: &OpaqueId,
        kind: ConnectedBrainSourceKindV1,
    ) -> Result<(), String> {
        if kind != ConnectedBrainSourceKindV1::Repository {
            return Err(
                "This review connects one repository. Choose a repository discovery.".into(),
            );
        }
        let mut state = lock_store()?;
        let pending = state
            .pending
            .get_mut(&self.request_id)
            .ok_or("Repository review has ended.")?;
        require_waiting(pending)?;
        let attempt = pending
            .attempt
            .as_mut()
            .ok_or("Connection attempt is unavailable.")?;
        if attempt.source_id.is_some() {
            return Err("A repository was already selected for this review.".into());
        }
        attempt.source_id = Some(source_id.clone());
        Ok(())
    }

    /// Revalidate after indexing, immediately before the existing persistence operation.
    pub(crate) fn before_persist(&self) -> Result<(), String> {
        verify_origin(&self.app, &waiting_scope(&self.request_id)?)?;
        let mut state = lock_store()?;
        let pending = state
            .pending
            .get_mut(&self.request_id)
            .ok_or("Repository review has ended.")?;
        require_waiting(pending)?;
        let attempt = pending
            .attempt
            .as_mut()
            .ok_or("Connection attempt is unavailable.")?;
        if attempt.source_id.is_none() || attempt.write_started {
            return Err("Repository connection attempt is invalid.".into());
        }
        attempt.write_started = true;
        Ok(())
    }

    /// Record the actual source returned by Brain (a rebind may preserve an older opaque ID).
    pub(crate) fn record_completed(&self, source_id: &OpaqueId, replayed: bool) {
        if let Ok(mut state) = store().lock() {
            if let Some(attempt) = state
                .pending
                .get_mut(&self.request_id)
                .and_then(|pending| pending.attempt.as_mut())
            {
                attempt.source_id = Some(source_id.clone());
                attempt.confirmed = true;
                attempt.replayed = Some(replayed);
            }
        }
    }
}

impl Drop for ConnectionAttemptGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = store().lock() {
            if let Some(attempt) = state
                .pending
                .get_mut(&self.request_id)
                .and_then(|pending| pending.attempt.as_mut())
            {
                attempt.running = false;
            }
        }
    }
}

/// Owner intent for completing or dismissing this ephemeral review.
#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryConnectionOutcomeV1 {
    Connected,
    Closed,
    Busy,
}

fn completion_snapshot(
    state: &Store,
    request_id: &str,
) -> Result<(ResidentProposalScope, Attempt, bool), String> {
    if let Some(pending) = state.pending.get(request_id) {
        let acknowledged = pending
            .result
            .as_ref()
            .is_some_and(|result| result["status"] == "repository_available");
        if !acknowledged {
            require_waiting(pending)?;
        }
        if Instant::now() >= pending.deadline || !pending.scope.active.load(Ordering::SeqCst) {
            return Err("Repository review has expired.".into());
        }
        return Ok((
            pending.scope.clone(),
            pending
                .attempt
                .clone()
                .ok_or("No repository connection was attempted.")?,
            acknowledged,
        ));
    }
    let completed = state
        .completed
        .get(request_id)
        .filter(|item| Instant::now() < item.deadline)
        .ok_or("Repository review has ended without a verified result.")?;
    Ok((completed.scope.clone(), completed.attempt.clone(), true))
}

fn verified_source_result(
    scope: &ResidentProposalScope,
    attempt: &Attempt,
    authorize_root: impl FnOnce(&OpaqueId) -> Result<(), String>,
    read_source: impl FnOnce(&OpaqueId) -> Result<ConnectedBrainSourceSummaryV1, String>,
) -> Result<Value, String> {
    if attempt.running || !attempt.write_started {
        return Err(
            "The connection has not finished. Check Brain before asking to connect again.".into(),
        );
    }
    let source_id = attempt
        .source_id
        .as_ref()
        .ok_or("The connection has no verified source identity.")?;
    // Grant and current binding are checked before catalog metadata is read.
    authorize_root(source_id)?;
    let source = read_source(source_id)?;
    if &source.source.source_id != source_id
        || source.source.owner_pubkey != scope.owner
        || source.source.source_kind != ConnectedBrainSourceKindV1::Repository
        || source.source.status != ConnectedBrainSourceStatusV1::Current
    {
        return Err("The selected repository is not currently connected.".into());
    }
    Ok(json!({
        "status": "repository_available", "sourceId": source.source.source_id,
        "sourceKind": "repository", "indexRevision": source.source.index_revision,
        "itemCount": source.item_count, "entryCount": source.entry_count,
        "requestingResidentAccess": "verified", "conversationId": scope.conversation,
        "connectionOperationConfirmed": attempt.confirmed, "replayed": attempt.replayed,
        "message": if attempt.confirmed {
            "The reviewed repository is available to this resident under its current binding. The existing Brain connection policy also applies to other current and future eligible residents. Edits and commands still require their normal owner review."
        } else {
            "This repository and this resident's access are available now, but the connection operation did not return a completed receipt. Other resident grants may need attention. Check Brain before another connection attempt."
        }
    }))
}

fn current_result(
    app: &AppHandle,
    scope: &ResidentProposalScope,
    attempt: &Attempt,
) -> Result<Value, String> {
    let state = app.state::<crate::app_state::AppState>();
    let result = verified_source_result(
        scope,
        attempt,
        |id| {
            state
                .authorized_repository_root(&scope.owner, &scope.resident, &scope.binding, id)
                .map(|_| ())
                .map_err(|_| {
                    "Current repository access could not be verified. Review Brain access."
                        .to_owned()
                })
        },
        |id| {
            state
                .read_connected_brain_catalog(&scope.owner)
                .map_err(|_| "Current repository catalog is unavailable.".to_owned())?
                .sources
                .into_iter()
                .find(|source| &source.source.source_id == id)
                .ok_or_else(|| "The connected repository is unavailable.".into())
        },
    )?;
    // Access can change while the catalog is being read; do not return that
    // metadata as a current authorization after a concurrent revocation.
    let source_id = attempt
        .source_id
        .as_ref()
        .ok_or("The connection has no source identity.")?;
    state
        .authorized_repository_root(&scope.owner, &scope.resident, &scope.binding, source_id)
        .map_err(|_| "Repository access changed while its result was checked.".to_owned())?;
    Ok(result)
}

fn complete_success(state: &mut Store, request_id: &str, result: Value) -> Result<bool, String> {
    let pending = state
        .pending
        .get_mut(request_id)
        .ok_or("Repository review ended before its result was returned.")?;
    if pending
        .result
        .as_ref()
        .is_some_and(|value| value["status"] == "repository_available")
    {
        return Ok(false);
    }
    require_waiting(pending)?;
    pending.result = Some(result);
    Ok(true)
}

/// Verify actual current source/access, or return a truthful incomplete result to the caller.
#[tauri::command]
pub async fn finish_repository_connection_proposal(
    app: AppHandle,
    request_id: String,
    outcome: RepositoryConnectionOutcomeV1,
) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        if outcome != RepositoryConnectionOutcomeV1::Connected {
            let owner = AppExchangeRelay::new(app.clone())
                .owner()
                .map_err(|_| "Current owner unavailable.")?;
            let mut state = lock_store()?;
            let Some(pending) = state.pending.get(&request_id) else {
                return Ok(false);
            };
            if pending.scope.owner != owner {
                return Err("This review belongs to another owner.".into());
            }
            if pending.result.is_some() {
                return Ok(false);
            }
            close_pending(
                &mut state,
                &request_id,
                if outcome == RepositoryConnectionOutcomeV1::Busy {
                    "another_review_open"
                } else {
                    "review_closed"
                },
            )?;
            return Ok(true);
        }
        let (scope, attempt, acknowledged) = completion_snapshot(&*lock_store()?, &request_id)?;
        verify_origin(&app, &scope)?;
        let mut result = current_result(&app, &scope, &attempt)?;
        result["requestId"] = json!(request_id);
        verify_origin(&app, &scope)?;
        if acknowledged {
            return Ok(false);
        }
        complete_success(&mut *lock_store()?, &request_id, result)
    })
    .await
    .map_err(|_| "Repository result worker failed.".to_owned())?
}

#[cfg(test)]
#[path = "repository_connection_proposals_tests.rs"]
mod tests;
