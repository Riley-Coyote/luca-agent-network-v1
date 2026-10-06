//! Ephemeral owner answers to runtime questions, independent of permissions.

use std::{
    collections::{BTreeMap, HashMap},
    sync::{mpsc, Mutex, OnceLock},
    time::{Duration, Instant},
};

use luca_protocol::{
    ManagedInputActionV1, ManagedInputDecisionV1, ManagedInputRequestV1, ManagedInputValueV1,
};
use tauri::{AppHandle, Emitter, Manager};

const PENDING_EVENT: &str = "managed-input-pending";
const RESOLVED_EVENT: &str = "managed-input-resolved";
const MAX_PENDING: usize = 64;
const POLL_INTERVAL: Duration = Duration::from_millis(100);

struct Pending {
    owner: String,
    request: ManagedInputRequestV1,
    request_hash: String,
    deadline: Instant,
    // Taking the sender leaves an answer-free tombstone until waiter cleanup.
    tx: Option<mpsc::Sender<ManagedInputDecisionV1>>,
}

#[derive(Default)]
struct InputRegistry {
    entries: HashMap<String, Pending>,
}

impl InputRegistry {
    fn insert(
        &mut self,
        bound_owner: String,
        request: ManagedInputRequestV1,
        deadline: Instant,
    ) -> Result<(String, mpsc::Receiver<ManagedInputDecisionV1>), String> {
        request.validate().map_err(str::to_owned)?;
        let request_hash = luca_protocol::canonical_sha256(&request)
            .map_err(|_| "Question encoding is invalid.".to_owned())?;
        if self.entries.len() >= MAX_PENDING
            || self
                .entries
                .values()
                .any(|p| p.request_hash == request_hash)
        {
            return Err("This question is already waiting or the registry is full.".into());
        }
        // A stale renderer answer cannot target an identical later question.
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::channel();
        self.entries.insert(
            id.clone(),
            Pending {
                owner: bound_owner,
                request,
                request_hash,
                deadline,
                tx: Some(tx),
            },
        );
        Ok((id, rx))
    }

    fn list(&self, current_owner: &str, now: Instant) -> Vec<PendingManagedInput> {
        self.entries
            .iter()
            .filter(|(_, p)| p.owner == current_owner && p.tx.is_some() && now < p.deadline)
            .map(|(id, p)| PendingManagedInput {
                pending_id: id.clone(),
                request: p.request.clone(),
            })
            .collect()
    }

    fn contains_scope(&self, id: &str) -> bool {
        self.entries.contains_key(id)
    }

    fn resolve(
        &mut self,
        current_owner: &str,
        pending_id: &str,
        action: ManagedInputActionV1,
        answers: BTreeMap<String, ManagedInputValueV1>,
        now: Instant,
    ) -> Result<(), String> {
        let pending = self
            .entries
            .get_mut(pending_id)
            .filter(|p| p.owner == current_owner && now < p.deadline && p.tx.is_some())
            .ok_or("This question is expired, cancelled or belongs to another owner.")?;
        let answer = decision(&pending.request, action, answers);
        answer
            .validate_for(&pending.request)
            .map_err(str::to_owned)?;
        let tx = pending
            .tx
            .take()
            .ok_or("This question is no longer waiting.")?;
        tx.send(answer)
            .map_err(|_| "This question is no longer waiting.".to_owned())
    }

    fn cancel_matching(&mut self, matches: impl Fn(&Pending) -> bool) {
        self.entries.retain(|_, p| {
            if !matches(p) {
                return true;
            }
            if let Some(tx) = p.tx.take() {
                let _ = tx.send(decision(
                    &p.request,
                    ManagedInputActionV1::Cancelled,
                    BTreeMap::new(),
                ));
            }
            false
        });
    }
}

/// Private current-question projection; no answer is retained here.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingManagedInput {
    pub pending_id: String,
    pub request: ManagedInputRequestV1,
}

fn registry() -> &'static Mutex<InputRegistry> {
    static REGISTRY: OnceLock<Mutex<InputRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(InputRegistry::default()))
}

fn owner(app: &AppHandle) -> Result<String, String> {
    Ok(app
        .state::<crate::app_state::AppState>()
        .signing_keys()?
        .public_key()
        .to_hex())
}

fn decision(
    request: &ManagedInputRequestV1,
    action: ManagedInputActionV1,
    answers: BTreeMap<String, ManagedInputValueV1>,
) -> ManagedInputDecisionV1 {
    ManagedInputDecisionV1 {
        protocol: request.protocol.clone(),
        resident_pubkey: request.resident_pubkey.clone(),
        session_epoch: request.session_epoch,
        turn_id: request.turn_id.clone(),
        conversation_id: request.conversation_id.clone(),
        provider_session_id: request.provider_session_id.clone(),
        acp_request_id: request.acp_request_id.clone(),
        tool_call_id: request.tool_call_id.clone(),
        action,
        answers,
    }
}

fn scope_survives(
    bound_owner: &str,
    current_owner: Option<&str>,
    closed: bool,
    shutdown: bool,
    deadline: Instant,
    now: Instant,
) -> bool {
    current_owner == Some(bound_owner) && !closed && !shutdown && now < deadline
}

/// Await one answer while the host, active owner and exact task scope survive.
pub(crate) fn await_response(
    app: &AppHandle,
    request: ManagedInputRequestV1,
    mut closed: impl FnMut() -> bool,
) -> ManagedInputDecisionV1 {
    let cancelled = || decision(&request, ManagedInputActionV1::Cancelled, BTreeMap::new());
    if request.validate().is_err() || closed() {
        return cancelled();
    }
    let Ok(bound_owner) = owner(app) else {
        return cancelled();
    };
    let deadline =
        Instant::now() + Duration::from_secs(luca_protocol::MANAGED_PERMISSION_TIMEOUT_SECS);
    let (id, rx) = {
        let Ok(mut entries) = registry().lock() else {
            return cancelled();
        };
        if closed()
            || !owner(app).is_ok_and(|current| current == bound_owner)
            || app
                .state::<crate::app_state::AppState>()
                .shutdown_started
                .load(std::sync::atomic::Ordering::Acquire)
        {
            return cancelled();
        }
        let Ok(pending) = entries.insert(bound_owner.clone(), request.clone(), deadline) else {
            return cancelled();
        };
        pending
    };
    let _ = app.emit(
        PENDING_EVENT,
        PendingManagedInput {
            pending_id: id.clone(),
            request: request.clone(),
        },
    );
    let mut survives = || {
        scope_survives(
            &bound_owner,
            owner(app).ok().as_deref(),
            closed(),
            app.state::<crate::app_state::AppState>()
                .shutdown_started
                .load(std::sync::atomic::Ordering::Acquire),
            deadline,
            Instant::now(),
        )
    };
    let response = loop {
        if !survives() {
            break cancelled();
        }
        match rx.recv_timeout(POLL_INTERVAL) {
            Ok(answer) => {
                if !survives()
                    || !registry()
                        .lock()
                        .is_ok_and(|entries| entries.contains_scope(&id))
                    || answer.validate_for(&request).is_err()
                {
                    break cancelled();
                }
                break answer;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break cancelled(),
        }
    };
    if let Ok(mut entries) = registry().lock() {
        entries.entries.remove(&id);
    }
    let _ = app.emit(
        RESOLVED_EVENT,
        serde_json::json!({"pendingId":id,"action":response.action}),
    );
    response
}

/// Return only the active owner's current questions, not prior answer history.
pub(crate) fn list_pending(app: &AppHandle) -> Result<Vec<PendingManagedInput>, String> {
    let current = owner(app)?;
    let entries = registry()
        .lock()
        .map_err(|_| "Question registry is unavailable.".to_owned())?;
    Ok(entries.list(&current, Instant::now()))
}

/// Resolve one exact request, validating every value before consuming its slot.
pub(crate) fn resolve(
    app: &AppHandle,
    pending_id: &str,
    action: ManagedInputActionV1,
    answers: BTreeMap<String, ManagedInputValueV1>,
) -> Result<(), String> {
    let current = owner(app)?;
    let mut entries = registry()
        .lock()
        .map_err(|_| "Question registry is unavailable.".to_owned())?;
    entries.resolve(&current, pending_id, action, answers, Instant::now())
}

/// Cancel only questions attached to an exited/replaced exact host epoch.
pub(crate) fn cancel_session(resident: &str, epoch: u64) {
    if let Ok(mut entries) = registry().lock() {
        entries.cancel_matching(|p| {
            p.request.resident_pubkey.as_str() == resident && p.request.session_epoch.get() == epoch
        });
    }
}

/// Closing the app cancels every ephemeral question without granting anything.
pub(crate) fn cancel_all() {
    if let Ok(mut entries) = registry().lock() {
        entries.cancel_matching(|_| true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::{
        Hex64, ManagedInputFieldV1, ManagedInputKindV1, OpaqueId, SafeU53, MANAGED_INPUT_PROTOCOL,
    };

    fn request(turn: &str) -> ManagedInputRequestV1 {
        ManagedInputRequestV1 {
            protocol: MANAGED_INPUT_PROTOCOL.into(),
            resident_pubkey: Hex64::parse("a".repeat(64)).unwrap(),
            session_epoch: SafeU53::new(7).unwrap(),
            turn_id: OpaqueId::parse(turn).unwrap(),
            conversation_id: OpaqueId::parse("conversation-1").unwrap(),
            provider_session_id: "native-1".into(),
            acp_request_id: "4".into(),
            tool_call_id: "ask-1".into(),
            message: "Which approach?".into(),
            fields: vec![ManagedInputFieldV1 {
                key: "question_0".into(),
                label: "Approach".into(),
                description: None,
                kind: ManagedInputKindV1::Text,
                required: true,
                options: vec![],
            }],
        }
    }

    fn answers() -> BTreeMap<String, ManagedInputValueV1> {
        BTreeMap::from([(
            "question_0".into(),
            ManagedInputValueV1::Text("private answer".into()),
        )])
    }

    #[test]
    fn valid_answer_is_one_shot_and_projection_never_contains_answers() {
        let now = Instant::now();
        let mut registry = InputRegistry::default();
        let r = request("turn-1");
        let (id, rx) = registry
            .insert("owner".into(), r.clone(), now + Duration::from_secs(1))
            .unwrap();
        assert!(registry
            .insert("owner".into(), r.clone(), now + Duration::from_secs(1))
            .is_err());
        let projection = serde_json::to_string(&registry.list("owner", now)).unwrap();
        assert!(!projection.contains("private answer"));
        assert!(!projection.contains("answers"));
        registry
            .resolve("owner", &id, ManagedInputActionV1::Answered, answers(), now)
            .unwrap();
        let answer = rx.try_recv().unwrap();
        assert!(answer.validate_for(&r).is_ok());
        assert_eq!(answer.answers, answers());
        assert!(registry.list("owner", now).is_empty());
        assert!(registry.entries[&id].tx.is_none());
        assert!(registry
            .resolve("owner", &id, ManagedInputActionV1::Answered, answers(), now)
            .is_err());
        assert!(registry
            .insert("owner".into(), r, now + Duration::from_secs(1))
            .is_err());
    }

    #[test]
    fn malformed_answer_and_wrong_owner_do_not_consume_waiter() {
        let now = Instant::now();
        let mut registry = InputRegistry::default();
        let (id, rx) = registry
            .insert(
                "owner".into(),
                request("turn-1"),
                now + Duration::from_secs(1),
            )
            .unwrap();
        assert!(registry.list("other-owner", now).is_empty());
        assert!(registry
            .resolve(
                "other-owner",
                &id,
                ManagedInputActionV1::Answered,
                answers(),
                now
            )
            .is_err());
        assert!(registry
            .resolve(
                "owner",
                &id,
                ManagedInputActionV1::Answered,
                BTreeMap::new(),
                now
            )
            .is_err());
        assert!(registry
            .resolve("owner", &id, ManagedInputActionV1::Declined, answers(), now)
            .is_err());
        assert_eq!(registry.list("owner", now).len(), 1);
        assert!(matches!(rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
        registry
            .resolve(
                "owner",
                &id,
                ManagedInputActionV1::Declined,
                BTreeMap::new(),
                now,
            )
            .unwrap();
        let answer = rx.try_recv().unwrap();
        assert_eq!(answer.action, ManagedInputActionV1::Declined);
        assert!(answer.answers.is_empty());
    }

    #[test]
    fn deadline_hides_questions_and_rejects_answers_at_exact_boundary() {
        let now = Instant::now();
        let deadline = now + Duration::from_secs(1);
        let mut registry = InputRegistry::default();
        let (id, rx) = registry
            .insert("owner".into(), request("turn-1"), deadline)
            .unwrap();
        assert_eq!(registry.list("owner", now).len(), 1);
        assert!(registry.list("owner", deadline).is_empty());
        assert!(registry
            .resolve(
                "owner",
                &id,
                ManagedInputActionV1::Answered,
                answers(),
                deadline
            )
            .is_err());
        assert!(matches!(rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
        registry.cancel_matching(|_| true);
        assert_eq!(
            rx.try_recv().unwrap().action,
            ManagedInputActionV1::Cancelled
        );
    }

    #[test]
    fn cancellation_is_exact_resident_epoch_and_keeps_sibling_waiters() {
        let now = Instant::now();
        let mut registry = InputRegistry::default();
        let mut siblings = Vec::new();
        for i in 0..4 {
            let mut r = request(&format!("turn-{i}"));
            if i == 1 {
                r.session_epoch = SafeU53::new(8).unwrap();
            }
            if i == 2 {
                r.resident_pubkey = Hex64::parse("b".repeat(64)).unwrap();
            }
            siblings.push(
                registry
                    .insert("owner".into(), r, now + Duration::from_secs(1))
                    .unwrap(),
            );
        }
        registry.cancel_matching(|p| {
            p.request.resident_pubkey.as_str() == "a".repeat(64)
                && p.request.session_epoch.get() == 7
        });
        for (i, (id, rx)) in siblings.iter().enumerate() {
            if i == 0 || i == 3 {
                let answer = rx.try_recv().unwrap();
                assert_eq!(answer.action, ManagedInputActionV1::Cancelled);
                assert!(answer.answers.is_empty());
                assert!(!registry.entries.contains_key(id));
            } else {
                assert!(matches!(rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
                assert!(registry.entries.contains_key(id));
            }
        }
        registry.cancel_matching(|_| true);
        assert!(registry.entries.is_empty());
        for i in [1, 2] {
            assert_eq!(
                siblings[i].1.try_recv().unwrap().action,
                ManagedInputActionV1::Cancelled
            );
        }
    }

    #[test]
    fn fresh_request_id_prevents_stale_ui_answer_and_old_cleanup_from_crossing() {
        let now = Instant::now();
        let deadline = now + Duration::from_secs(1);
        let mut registry = InputRegistry::default();
        let r = request("turn-1");
        let (old_id, old_rx) = registry
            .insert("owner".into(), r.clone(), deadline)
            .unwrap();
        registry.cancel_matching(|_| true);
        assert_eq!(
            old_rx.try_recv().unwrap().action,
            ManagedInputActionV1::Cancelled
        );
        let (new_id, new_rx) = registry.insert("owner".into(), r, deadline).unwrap();
        assert_ne!(old_id, new_id);
        registry.entries.remove(&old_id);
        assert!(registry
            .resolve(
                "owner",
                &old_id,
                ManagedInputActionV1::Answered,
                answers(),
                now
            )
            .is_err());
        assert!(matches!(new_rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
        registry
            .resolve(
                "owner",
                &new_id,
                ManagedInputActionV1::Answered,
                answers(),
                now,
            )
            .unwrap();
        assert_eq!(
            new_rx.try_recv().unwrap().action,
            ManagedInputActionV1::Answered
        );
    }

    #[test]
    fn sibling_tool_calls_have_independent_waiters_and_exact_responses() {
        let now = Instant::now();
        let mut registry = InputRegistry::default();
        let first = request("turn-1");
        let mut second = first.clone();
        second.tool_call_id = "ask-2".into();
        let (id, rx) = registry
            .insert("owner".into(), first.clone(), now + Duration::from_secs(1))
            .unwrap();
        let (other_id, other_rx) = registry
            .insert("owner".into(), second.clone(), now + Duration::from_secs(1))
            .unwrap();
        registry
            .resolve("owner", &id, ManagedInputActionV1::Answered, answers(), now)
            .unwrap();
        let answer = rx.try_recv().unwrap();
        assert!(answer.validate_for(&first).is_ok());
        assert!(answer.validate_for(&second).is_err());
        assert!(matches!(
            other_rx.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
        assert!(registry.entries[&other_id].tx.is_some());
    }

    #[test]
    fn admission_is_bounded_and_invalid_requests_never_get_a_slot() {
        let now = Instant::now();
        let deadline = now + Duration::from_secs(1);
        let mut registry = InputRegistry::default();
        let mut malformed = request("turn-1");
        malformed.provider_session_id.push('\n');
        assert!(registry
            .insert("owner".into(), malformed, deadline)
            .is_err());
        assert!(registry.entries.is_empty());
        let mut receivers = Vec::new();
        for i in 0..MAX_PENDING {
            receivers.push(
                registry
                    .insert("owner".into(), request(&format!("turn-{i}")), deadline)
                    .unwrap()
                    .1,
            );
        }
        assert!(registry
            .insert("owner".into(), request("overflow"), deadline)
            .is_err());
        assert_eq!(registry.entries.len(), MAX_PENDING);
    }

    #[test]
    fn disconnected_waiter_fails_once_without_recording_an_answer() {
        let now = Instant::now();
        let mut registry = InputRegistry::default();
        let (id, rx) = registry
            .insert(
                "owner".into(),
                request("turn-1"),
                now + Duration::from_secs(1),
            )
            .unwrap();
        drop(rx);
        assert!(registry
            .resolve("owner", &id, ManagedInputActionV1::Answered, answers(), now)
            .is_err());
        assert!(registry.entries[&id].tx.is_none());
        assert!(registry.list("owner", now).is_empty());
    }

    #[test]
    fn cancellation_invalidates_an_answer_already_queued_for_receipt() {
        let now = Instant::now();
        let mut registry = InputRegistry::default();
        let (id, rx) = registry
            .insert(
                "owner".into(),
                request("turn-1"),
                now + Duration::from_secs(1),
            )
            .unwrap();
        registry
            .resolve("owner", &id, ManagedInputActionV1::Answered, answers(), now)
            .unwrap();
        assert!(registry.contains_scope(&id));
        registry.cancel_matching(|_| true);
        assert_eq!(
            rx.try_recv().unwrap().action,
            ManagedInputActionV1::Answered
        );
        // Production receipt checks this even after the channel delivered an answer.
        assert!(!registry.contains_scope(&id));
    }

    #[test]
    fn scope_rechecks_cancel_late_answer_on_owner_exit_timeout_and_shutdown() {
        let now = Instant::now();
        let deadline = now + Duration::from_secs(1);
        assert!(scope_survives(
            "owner",
            Some("owner"),
            false,
            false,
            deadline,
            now
        ));
        assert!(!scope_survives(
            "owner",
            Some("other"),
            false,
            false,
            deadline,
            now
        ));
        assert!(!scope_survives("owner", None, false, false, deadline, now));
        assert!(!scope_survives(
            "owner",
            Some("owner"),
            true,
            false,
            deadline,
            now
        ));
        assert!(!scope_survives(
            "owner",
            Some("owner"),
            false,
            true,
            deadline,
            now
        ));
        assert!(!scope_survives(
            "owner",
            Some("owner"),
            false,
            false,
            deadline,
            deadline
        ));
    }
}
