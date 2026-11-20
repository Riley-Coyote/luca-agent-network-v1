//! A resident asks the owner to start a project; the owner answers on a card.
//!
//! The project list lives in the window (a device-local grouping of chats), so
//! the window does the creating, through the same steps as the rail's + button.
//! This module holds the ask, waits for the owner's answer, and before it tells
//! the resident "created" it confirms on the relay that the first chat exists,
//! is private, and holds the owner and every requested resident. Model input
//! can name the project, its purpose and the owner's own residents; it can never
//! choose the owner, the conversation, the chat, sources or roles.

use std::{
    collections::{BTreeSet, HashMap},
    sync::{atomic::Ordering, Mutex, MutexGuard, OnceLock},
    thread,
    time::{Duration, Instant},
};

use luca_protocol::{Hex64, OpaqueId};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use super::{
    exchange_relay::{AppExchangeRelay, ExchangeRelay},
    resident_proposals::{verify_origin, ResidentProposalScope},
};

const EVENT: &str = "luca://project-proposal";
const RESOLVED_EVENT: &str = "luca://project-proposal-resolved";
/// How long the owner has to answer: the same quarter hour as every other ask.
const LIFETIME: Duration = Duration::from_secs(15 * 60);
/// The first chat of a project an agent asks for, as the + dialog names it.
const FIRST_CHAT_NAME: &str = "general";
const MAX_NAME_BYTES: usize = 120;
const MAX_PURPOSE_BYTES: usize = 200;
const MAX_INCLUDED_RESIDENTS: usize = 8;
const MAX_PROBLEM_BYTES: usize = 300;
/// The relay records a new chat's members a moment after the chat itself.
const MEMBERSHIP_ATTEMPTS: usize = 10;
const MEMBERSHIP_RETRY_DELAY: Duration = Duration::from_millis(500);
const POLL: Duration = Duration::from_millis(50);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Arguments {
    name: String,
    purpose: String,
    #[serde(default)]
    include_residents: Vec<String>,
}

/// A request after validation: the asking resident first, then each included one.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedRequest {
    name: String,
    purpose: String,
    residents: Vec<Hex64>,
}

fn bounded_line(value: &str, max_bytes: usize) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty() && trimmed.len() <= max_bytes && !trimmed.chars().any(char::is_control))
        .then(|| trimmed.to_owned())
}

fn parse_request(arguments: Value, asker: &Hex64) -> Result<ParsedRequest, String> {
    let arguments: Arguments = serde_json::from_value(arguments)
        .map_err(|_| "Project request arguments are invalid.".to_owned())?;
    let name = bounded_line(&arguments.name, MAX_NAME_BYTES)
        .ok_or("Give the project a one-line name of at most 120 bytes.")?;
    let purpose = bounded_line(&arguments.purpose, MAX_PURPOSE_BYTES)
        .ok_or("Give the project one short purpose of at most 200 bytes.")?;
    if arguments.include_residents.len() > MAX_INCLUDED_RESIDENTS {
        return Err("A project request may include at most 8 other residents.".into());
    }
    let mut residents = vec![asker.clone()];
    let mut seen = BTreeSet::from([asker.clone()]);
    for key in arguments.include_residents {
        let exact = key.len() == 64
            && key
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
        let resident = Hex64::parse(key)
            .ok()
            .filter(|_| exact)
            .ok_or("Include residents by their exact keys from polyphonic_status.")?;
        if seen.insert(resident.clone()) {
            residents.push(resident);
        } else if &resident != asker {
            return Err("Name each included resident once.".into());
        }
    }
    Ok(ParsedRequest {
        name,
        purpose,
        residents,
    })
}

/// Every resident a request names must be one of this owner's own.
fn require_owned(residents: &[Hex64], owned: &BTreeSet<Hex64>) -> Result<(), String> {
    if residents.iter().all(|resident| owned.contains(resident)) {
        Ok(())
    } else {
        Err("Only your owner's own residents can join a project you ask for.".into())
    }
}

/// Only a turn the owner started may ask; a sibling-triggered turn may not.
fn require_owner_turn(
    dispatch_owner: &str,
    descendant_depth: u8,
    owner: &Hex64,
) -> Result<(), String> {
    if dispatch_owner != owner.as_str() || descendant_depth != 0 {
        return Err("A project can be asked for only in a turn the owner started.".into());
    }
    Ok(())
}

fn current_owner_turn(app: &AppHandle, scope: &ResidentProposalScope) -> Result<(), String> {
    let dispatches = super::managed_dispatch_store::global_dispatch_store(app)?;
    let store = dispatches
        .lock()
        .map_err(|_| "Turn authority is unavailable.")?;
    let current = store
        .resolve_unique_cancellable(
            scope.owner.as_str(),
            scope.conversation.as_str(),
            scope.resident.as_str(),
        )
        .map_err(|_| "A project can be asked for only in a turn the owner started.")?;
    if current.session_epoch != scope.session_epoch.get() {
        return Err("This resident session is no longer current.".into());
    }
    let dispatch = store
        .recheck_communication_turn(
            &current.dispatch_receipt_id,
            scope.resident.as_str(),
            scope.conversation.as_str(),
            scope.session_epoch.get(),
            u64::try_from(chrono::Utc::now().timestamp()).unwrap_or(0),
        )
        .map_err(|_| "The owner's current turn changed.")?;
    require_owner_turn(
        &dispatch.owner_pubkey,
        dispatch.descendant_depth,
        &scope.owner,
    )
}

/// What the window is asked to make. Only a new project today; a new chat in a
/// project that already exists can become another variant without renaming.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectRequestKindV1 {
    /// A new project with its first chat.
    NewProject,
}

/// One pending ask, as the window draws it. Host-derived except name and purpose.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProposalV1 {
    request_id: String,
    kind: ProjectRequestKindV1,
    owner_pubkey: String,
    resident_pubkey: String,
    conversation_id: String,
    project_name: String,
    purpose: String,
    chat_name: String,
    /// The asking resident first, then each included one.
    resident_pubkeys: Vec<String>,
    created_at: String,
}

struct Pending {
    scope: ResidentProposalScope,
    projection: ProjectProposalV1,
    residents: Vec<Hex64>,
    deadline: Instant,
    result: Option<Value>,
}

#[derive(Default)]
struct Store {
    pending: HashMap<String, Pending>,
}

fn store() -> &'static Mutex<Store> {
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(Store::default()))
}

fn lock(store: &Mutex<Store>) -> Result<MutexGuard<'_, Store>, String> {
    store
        .lock()
        .map_err(|_| "Project requests are unavailable.".into())
}

fn waiting(pending: &Pending) -> bool {
    pending.result.is_none()
        && Instant::now() < pending.deadline
        && pending.scope.active.load(Ordering::SeqCst)
}

/// One request at a time in a conversation; others may wait in other conversations.
fn admit(state: &mut Store, request_id: String, pending: Pending) -> Result<(), String> {
    let busy = state.pending.values().any(|other| {
        other.scope.owner == pending.scope.owner
            && other.scope.conversation == pending.scope.conversation
            && waiting(other)
    });
    if busy {
        return Err("A project request is already waiting for the owner's answer in this conversation. Wait for that answer first.".into());
    }
    state.pending.insert(request_id, pending);
    Ok(())
}

fn ended(reason: &str) -> Value {
    let message = match reason {
        "no_answer" => "The owner did not answer within 15 minutes. Nothing was created. Don't ask again unless they raise it.",
        _ => "This request ended before an answer came back. Ask the owner whether the project exists before asking again.",
    };
    let status = if reason == "no_answer" {
        "no_answer"
    } else {
        "incomplete"
    };
    json!({"status": status, "reason": reason, "message": message})
}

fn declined() -> Value {
    json!({
        "status": "declined",
        "message": "The owner chose Not now. Nothing was created. Don't ask again unless they raise it."
    })
}

/// Set a request's one answer. A second answer for the same request is ignored.
fn settle(
    state: &mut Store,
    request_id: &str,
    owner: &Hex64,
    result: Value,
) -> Result<bool, String> {
    let pending = state
        .pending
        .get_mut(request_id)
        .ok_or("This project request has ended.")?;
    if &pending.scope.owner != owner {
        return Err("This project request belongs to another owner.".into());
    }
    if !waiting(pending) {
        return Ok(false);
    }
    pending.result = Some(result);
    Ok(true)
}

/// Wait for the owner's answer, the deadline, the session's end or the caller leaving.
fn await_answer(
    store: &Mutex<Store>,
    request_id: &str,
    mut cancelled: impl FnMut() -> bool,
) -> Result<Value, String> {
    loop {
        // The caller is probed outside the lock; a probe can take its read timeout.
        let caller_gone = cancelled();
        let mut state = lock(store)?;
        let pending = state
            .pending
            .get_mut(request_id)
            .ok_or("This project request has ended.")?;
        if let Some(result) = pending.result.clone() {
            return Ok(result);
        }
        let reason = if !pending.scope.active.load(Ordering::SeqCst) {
            Some("resident_session_ended")
        } else if Instant::now() >= pending.deadline {
            Some("no_answer")
        } else if caller_gone {
            Some("caller_disconnected")
        } else {
            None
        };
        if let Some(reason) = reason {
            let result = ended(reason);
            pending.result = Some(result.clone());
            return Ok(result);
        }
        drop(state);
        thread::sleep(POLL);
    }
}

struct PendingGuard<'a> {
    app: AppHandle,
    store: &'a Mutex<Store>,
    request_id: String,
    conversation_id: String,
}

impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.store.lock() {
            state.pending.remove(&self.request_id);
        }
        let _ = self.app.emit(
            RESOLVED_EVENT,
            json!({"requestId": self.request_id, "conversationId": self.conversation_id}),
        );
    }
}

/// Show the owner one project card in the asking conversation and wait for the answer.
pub(crate) fn propose_project(
    app: &AppHandle,
    scope: ResidentProposalScope,
    arguments: Value,
    cancelled: impl FnMut() -> bool,
) -> Result<String, String> {
    let request = parse_request(arguments, &scope.resident)?;
    verify_origin(app, &scope)?;
    current_owner_turn(app, &scope)?;
    let owned = AppExchangeRelay::new(app.clone())
        .owned_residents()
        .map_err(|_| "Your owner's residents could not be verified.")?;
    require_owned(&request.residents, &owned)?;
    let request_id = format!("project-proposal-{}", uuid::Uuid::new_v4());
    let projection = ProjectProposalV1 {
        request_id: request_id.clone(),
        kind: ProjectRequestKindV1::NewProject,
        owner_pubkey: scope.owner.as_str().to_owned(),
        resident_pubkey: scope.resident.as_str().to_owned(),
        conversation_id: scope.conversation.as_str().to_owned(),
        project_name: request.name,
        purpose: request.purpose,
        chat_name: FIRST_CHAT_NAME.to_owned(),
        resident_pubkeys: request
            .residents
            .iter()
            .map(|resident| resident.as_str().to_owned())
            .collect(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    admit(
        &mut *lock(store())?,
        request_id.clone(),
        Pending {
            scope: scope.clone(),
            projection: projection.clone(),
            residents: request.residents,
            deadline: Instant::now() + LIFETIME,
            result: None,
        },
    )?;
    let _guard = PendingGuard {
        app: app.clone(),
        store: store(),
        request_id: request_id.clone(),
        conversation_id: projection.conversation_id.clone(),
    };
    app.emit(EVENT, &projection)
        .map_err(|_| "The project card could not be shown.")?;
    let mut result = await_answer(store(), &request_id, cancelled)?;
    let owner = AppExchangeRelay::new(app.clone())
        .owner()
        .map_err(|_| "The current owner is unavailable.")?;
    if owner != scope.owner {
        return Err("This project answer belongs to another owner.".into());
    }
    result["requestId"] = json!(request_id);
    serde_json::to_string(&result).map_err(|_| "The project answer could not be encoded.".into())
}

/// The current owner's waiting project cards, so a reloaded window draws them again.
#[tauri::command]
pub fn list_project_proposals(app: AppHandle) -> Result<Vec<ProjectProposalV1>, String> {
    let owner = AppExchangeRelay::new(app)
        .owner()
        .map_err(|_| "Current owner unavailable.")?;
    let state = lock(store())?;
    let mut proposals = state
        .pending
        .values()
        .filter(|pending| pending.scope.owner == owner && waiting(pending))
        .map(|pending| pending.projection.clone())
        .collect::<Vec<_>>();
    proposals.sort_by(|left, right| left.created_at.cmp(&right.created_at));
    Ok(proposals)
}

fn waiting_scope(request_id: &str) -> Result<ResidentProposalScope, String> {
    let state = lock(store())?;
    let pending = state
        .pending
        .get(request_id)
        .filter(|pending| waiting(pending))
        .ok_or("This project request is no longer waiting.")?;
    Ok(pending.scope.clone())
}

/// Recheck the asking resident and conversation right before the window creates anything.
#[tauri::command]
pub async fn authorize_project_proposal(app: AppHandle, request_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || verify_origin(&app, &waiting_scope(&request_id)?))
        .await
        .map_err(|_| "Project request check failed.".to_owned())?
}

/// The owner's answer, as the window reports it after running the creation.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case", deny_unknown_fields)]
pub enum ProjectProposalAnswerV1 {
    /// Create ran to the end; the host confirms the chat before saying so.
    Created {
        /// The window's id for the new project.
        #[serde(rename = "projectId")]
        project_id: String,
        /// The first chat's id on the relay.
        #[serde(rename = "chatId")]
        chat_id: String,
    },
    /// Create stopped part-way; what exists is reported, nothing is retried.
    Partial {
        /// The project's id, when the project itself was saved.
        #[serde(rename = "projectId", default)]
        project_id: Option<String>,
        /// The first chat's id, when it was made.
        #[serde(rename = "chatId", default)]
        chat_id: Option<String>,
        /// What went wrong, in the window's words.
        problem: String,
    },
    /// The owner chose Not now.
    Declined,
}

fn valid_window_id(value: &str) -> bool {
    OpaqueId::parse(value.to_owned()).is_ok()
}

/// What the relay says about the first chat at one moment.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ChatFacts {
    private_chat: bool,
    members: BTreeSet<Hex64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ChatCheck {
    Confirmed,
    NotFound,
    NotPrivate,
    MembersMissing(Vec<Hex64>),
}

/// Read until the chat and all its members show, a bounded number of times.
fn confirm_chat(
    mut read: impl FnMut() -> Option<ChatFacts>,
    expected: &[Hex64],
    attempts: usize,
    mut wait: impl FnMut(),
) -> ChatCheck {
    let mut last = ChatCheck::NotFound;
    for attempt in 0..attempts.max(1) {
        if attempt > 0 {
            wait();
        }
        last = match read() {
            None => ChatCheck::NotFound,
            Some(facts) if !facts.private_chat => return ChatCheck::NotPrivate,
            Some(facts) => {
                let missing = expected
                    .iter()
                    .filter(|key| !facts.members.contains(*key))
                    .cloned()
                    .collect::<Vec<_>>();
                if missing.is_empty() {
                    return ChatCheck::Confirmed;
                }
                ChatCheck::MembersMissing(missing)
            }
        };
    }
    last
}

fn read_chat(app: &AppHandle, chat: &OpaqueId) -> Option<ChatFacts> {
    let metadata = super::resident_proposals::current_conversation_event(app, chat, 39000).ok()?;
    let info = crate::nostr_convert::channel_info_from_event(&metadata, None, None).ok()?;
    let members = super::resident_proposals::current_members(app, chat).unwrap_or_default();
    Some(ChatFacts {
        private_chat: info.channel_type == "stream" && info.visibility == "private",
        members,
    })
}

fn keys(residents: &[Hex64]) -> Vec<&str> {
    residents.iter().map(Hex64::as_str).collect()
}

fn created_result(
    projection: &ProjectProposalV1,
    residents: &[Hex64],
    project_id: &str,
    chat_id: &str,
) -> Value {
    json!({
        "status": "project_created",
        "projectId": project_id,
        "projectName": projection.project_name,
        "chatId": chat_id,
        "chatName": projection.chat_name,
        "residents": keys(residents),
        "ownerIncluded": true,
        "conversationId": projection.conversation_id,
        "message": format!(
            "The owner created the project \"{}\". Its first chat, {}, holds the owner and the residents listed here, you included, and it shows in the owner's projects. Your reply now stays in this conversation; you answer in the new chat when the owner writes there. Do not ask for this project again.",
            projection.project_name, projection.chat_name
        ),
    })
}

fn partial_result(
    projection: &ProjectProposalV1,
    project_id: Option<&str>,
    chat_id: Option<&str>,
    missing_residents: &[Hex64],
    problem: &str,
) -> Value {
    let mut exists = Vec::new();
    let mut absent = Vec::new();
    if project_id.is_some() {
        exists.push("project");
    } else {
        absent.push("project");
    }
    if chat_id.is_some() {
        exists.push("first chat");
    } else {
        absent.push("first chat");
    }
    if !missing_residents.is_empty() {
        absent.push("some members");
    }
    json!({
        "status": "partly_created",
        "projectId": project_id,
        "projectName": projection.project_name,
        "chatId": chat_id,
        "exists": exists,
        "missing": absent,
        "missingResidents": keys(missing_residents),
        "problem": problem,
        "message": format!(
            "The owner chose Create, but \"{}\" was only partly made: {}. Tell the owner plainly what exists and what does not; do not ask again or try another way.",
            projection.project_name, problem
        ),
    })
}

fn snapshot(
    request_id: &str,
) -> Result<(ResidentProposalScope, ProjectProposalV1, Vec<Hex64>), String> {
    let state = lock(store())?;
    let pending = state
        .pending
        .get(request_id)
        .filter(|pending| waiting(pending))
        .ok_or("This project request is no longer waiting.")?;
    Ok((
        pending.scope.clone(),
        pending.projection.clone(),
        pending.residents.clone(),
    ))
}

fn answer_result(
    app: &AppHandle,
    request_id: &str,
    answer: ProjectProposalAnswerV1,
) -> Result<(Hex64, Value), String> {
    let (scope, projection, residents) = snapshot(request_id)?;
    let result = match answer {
        ProjectProposalAnswerV1::Declined => declined(),
        ProjectProposalAnswerV1::Partial {
            project_id,
            chat_id,
            problem,
        } => {
            if project_id.as_deref().is_some_and(|id| !valid_window_id(id))
                || chat_id.as_deref().is_some_and(|id| !valid_window_id(id))
            {
                return Err("The partial answer is invalid.".into());
            }
            let problem = bounded_line(&problem, MAX_PROBLEM_BYTES)
                .unwrap_or_else(|| "it stopped before finishing".into());
            partial_result(
                &projection,
                project_id.as_deref(),
                chat_id.as_deref(),
                &[],
                &problem,
            )
        }
        ProjectProposalAnswerV1::Created {
            project_id,
            chat_id,
        } => {
            let chat = OpaqueId::parse(chat_id.clone())
                .ok()
                .filter(|_| valid_window_id(&project_id))
                .ok_or("The created project's ids are invalid.")?;
            let mut expected = vec![scope.owner.clone()];
            expected.extend(residents.iter().cloned());
            match confirm_chat(
                || read_chat(app, &chat),
                &expected,
                MEMBERSHIP_ATTEMPTS,
                || thread::sleep(MEMBERSHIP_RETRY_DELAY),
            ) {
                ChatCheck::Confirmed => {
                    created_result(&projection, &residents, &project_id, &chat_id)
                }
                ChatCheck::NotFound => partial_result(
                    &projection,
                    Some(&project_id),
                    None,
                    &[],
                    "its first chat could not be found on the relay",
                ),
                ChatCheck::NotPrivate => partial_result(
                    &projection,
                    Some(&project_id),
                    Some(&chat_id),
                    &[],
                    "its first chat is not a private chat",
                ),
                ChatCheck::MembersMissing(missing) => partial_result(
                    &projection,
                    Some(&project_id),
                    Some(&chat_id),
                    &missing,
                    "not every member shows in its first chat yet",
                ),
            }
        }
    };
    Ok((scope.owner, result))
}

/// Record the owner's answer; the waiting resident receives it. True when this was the answer.
#[tauri::command]
pub async fn finish_project_proposal(
    app: AppHandle,
    request_id: String,
    answer: ProjectProposalAnswerV1,
) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let current = AppExchangeRelay::new(app.clone())
            .owner()
            .map_err(|_| "Current owner unavailable.")?;
        let (owner, result) = answer_result(&app, &request_id, answer)?;
        if owner != current {
            return Err("This project request belongs to another owner.".into());
        }
        settle(&mut *lock(store())?, &request_id, &current, result)
    })
    .await
    .map_err(|_| "Project answer could not be recorded.".to_owned())?
}

#[cfg(test)]
#[path = "project_proposals_tests.rs"]
mod tests;
