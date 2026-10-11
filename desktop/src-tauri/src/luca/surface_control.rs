//! Owner-visible, cancellable navigation through Polyphonic's fixed surfaces.
//! This does not grant or claim control of other apps or external computer tools.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

const LIFETIME: Duration = Duration::from_secs(15);
const UNAVAILABLE: &str = "App control is no longer available.";

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) struct ControlScope {
    pub owner: String,
    pub resident: String,
    pub conversation: String,
    pub epoch: u64,
    pub dispatch: String,
}

impl ControlScope {
    fn validate(&self, app: &AppHandle, active: &AtomicBool) -> Result<(), String> {
        let state = app.state::<crate::app_state::AppState>();
        if !active.load(Ordering::SeqCst)
            || state.signing_keys()?.public_key().to_hex() != self.owner
        {
            return Err(UNAVAILABLE.into());
        }
        let store = super::managed_dispatch_store::global_dispatch_store(app)?;
        let store = store.lock().map_err(|_| UNAVAILABLE)?;
        store
            .recheck_communication_turn(
                &self.dispatch,
                &self.resident,
                &self.conversation,
                self.epoch,
                chrono::Utc::now().timestamp().max(0) as u64,
            )
            .map_err(|_| UNAVAILABLE)?;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ControlAction {
    Begin,
    Complete,
    Stop,
    Failed,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ControlStatus {
    Pending,
    Running,
    Completed,
    Stopped,
    Failed,
}

struct Pending {
    id: String,
    scope: ControlScope,
    active: Arc<AtomicBool>,
    deadline: Instant,
    status: ControlStatus,
}

#[derive(Default)]
struct Controls {
    pending: Option<Pending>,
    // Stop prevents a model retry in the same exact turn, not unrelated work.
    stopped: HashSet<ControlScope>,
}

impl Controls {
    fn insert(&mut self, pending: Pending) -> Result<(), String> {
        if self.stopped.contains(&pending.scope) {
            return Err(
                "The owner stopped app navigation for this turn. Continue in chat; do not retry."
                    .into(),
            );
        }
        if self.pending.is_some() {
            return Err("Another app navigation is pending. Continue in chat.".into());
        }
        // A newer owner turn supersedes an older stopped turn in this conversation.
        self.stopped.retain(|scope| {
            scope.owner != pending.scope.owner
                || scope.resident != pending.scope.resident
                || scope.conversation != pending.scope.conversation
        });
        if self.stopped.len() >= 256 {
            return Err("App navigation is unavailable. Continue in chat.".into());
        }
        self.pending = Some(pending);
        Ok(())
    }

    fn apply(
        &mut self,
        id: &str,
        owner: &str,
        action: ControlAction,
        now: Instant,
    ) -> Result<ControlStatus, String> {
        let pending = self
            .pending
            .as_mut()
            .filter(|p| p.id == id && p.scope.owner == owner)
            .ok_or(UNAVAILABLE)?;
        if now >= pending.deadline || !pending.active.load(Ordering::SeqCst) {
            pending.status = ControlStatus::Failed;
            return Err(UNAVAILABLE.into());
        }
        pending.status = match (pending.status, action) {
            (ControlStatus::Pending, ControlAction::Begin) => ControlStatus::Running,
            (ControlStatus::Running, ControlAction::Complete) => ControlStatus::Completed,
            (ControlStatus::Pending | ControlStatus::Running, ControlAction::Stop) => {
                self.stopped.insert(pending.scope.clone());
                ControlStatus::Stopped
            }
            (ControlStatus::Pending | ControlStatus::Running, ControlAction::Failed) => {
                ControlStatus::Failed
            }
            _ => return Err(UNAVAILABLE.into()),
        };
        Ok(pending.status)
    }
}

fn controls() -> &'static Mutex<Controls> {
    static CONTROLS: OnceLock<Mutex<Controls>> = OnceLock::new();
    CONTROLS.get_or_init(|| Mutex::new(Controls::default()))
}

/// Only the main, owner-controlled webview can acknowledge or stop navigation.
#[tauri::command]
pub(crate) fn resolve_polyphonic_app_control(
    app: AppHandle,
    window: tauri::WebviewWindow,
    request_id: String,
    action: ControlAction,
) -> Result<ControlStatus, String> {
    if window.label() != "main" {
        return Err(UNAVAILABLE.into());
    }
    let state = app.state::<crate::app_state::AppState>();
    let owner = state.signing_keys()?.public_key().to_hex();
    let mut controls = controls().lock().map_err(|_| UNAVAILABLE)?;
    let pending = controls
        .pending
        .as_ref()
        .filter(|p| p.id == request_id && p.scope.owner == owner)
        .ok_or(UNAVAILABLE)?;
    // Stopping remains possible after a turn ends; beginning/completing never does.
    if matches!(action, ControlAction::Begin | ControlAction::Complete) {
        pending.scope.validate(&app, &pending.active)?;
    }
    controls.apply(&request_id, &owner, action, Instant::now())
}

/// Hold the existing tool call until the main webview reports what actually happened.
pub(crate) fn request(
    app: &AppHandle,
    scope: ControlScope,
    active: Arc<AtomicBool>,
    request_id: &str,
    payload: serde_json::Value,
    mut disconnected: impl FnMut() -> bool,
) -> Result<ControlStatus, String> {
    scope.validate(app, &active)?;
    let deadline = Instant::now() + LIFETIME;
    controls()
        .lock()
        .map_err(|_| UNAVAILABLE)?
        .insert(Pending {
            id: request_id.to_owned(),
            scope: scope.clone(),
            active: Arc::clone(&active),
            deadline,
            status: ControlStatus::Pending,
        })?;
    let result = (|| {
        app.emit_to("main", "polyphonic-native-surface-request", payload)
            .map_err(|_| UNAVAILABLE)?;
        loop {
            if Instant::now() >= deadline || disconnected() || scope.validate(app, &active).is_err()
            {
                return Err("App navigation ended before it could be confirmed.".into());
            }
            let status = controls()
                .lock()
                .map_err(|_| UNAVAILABLE)?
                .pending
                .as_ref()
                .filter(|p| p.id == request_id)
                .map(|p| p.status)
                .ok_or(UNAVAILABLE)?;
            if !matches!(status, ControlStatus::Pending | ControlStatus::Running) {
                return Ok(status);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    })();
    if let Ok(mut controls) = controls().lock() {
        if controls
            .pending
            .as_ref()
            .is_some_and(|p| p.id == request_id)
        {
            controls.pending = None;
        }
    }
    let _ = app.emit_to(
        "main",
        "polyphonic-app-control-ended",
        serde_json::json!({"requestId": request_id}),
    );
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pending(id: &str, dispatch: &str) -> Pending {
        Pending {
            id: id.into(),
            scope: ControlScope {
                owner: "owner".into(),
                resident: "resident".into(),
                conversation: "conversation".into(),
                epoch: 1,
                dispatch: dispatch.into(),
            },
            active: Arc::new(AtomicBool::new(true)),
            deadline: Instant::now() + LIFETIME,
            status: ControlStatus::Pending,
        }
    }
    #[test]
    fn stop_blocks_retry_but_not_a_new_owner_turn() {
        let mut controls = Controls::default();
        controls.insert(pending("a", "turn1")).unwrap();
        assert_eq!(
            controls
                .apply("a", "owner", ControlAction::Stop, Instant::now())
                .unwrap(),
            ControlStatus::Stopped
        );
        assert!(controls
            .apply("a", "owner", ControlAction::Begin, Instant::now())
            .is_err());
        controls.pending = None;
        assert!(controls.insert(pending("b", "turn1")).is_err());
        assert!(controls.insert(pending("c", "turn2")).is_ok());
    }
    #[test]
    fn acknowledgements_are_exact_ordered_and_terminal() {
        let mut controls = Controls::default();
        controls.insert(pending("a", "turn1")).unwrap();
        assert!(controls.insert(pending("b", "turn1")).is_err());
        for (id, owner, action) in [
            ("wrong", "owner", ControlAction::Begin),
            ("a", "wrong", ControlAction::Stop),
            ("a", "owner", ControlAction::Complete),
        ] {
            assert!(controls.apply(id, owner, action, Instant::now()).is_err());
        }
        assert_eq!(
            controls
                .apply("a", "owner", ControlAction::Begin, Instant::now())
                .unwrap(),
            ControlStatus::Running
        );
        assert_eq!(
            controls
                .apply("a", "owner", ControlAction::Complete, Instant::now())
                .unwrap(),
            ControlStatus::Completed
        );
        assert!(controls
            .apply("a", "owner", ControlAction::Stop, Instant::now())
            .is_err());
    }
    #[test]
    fn expired_disconnected_and_failed_requests_cannot_navigate() {
        for reason in ["expired", "disconnected", "failed"] {
            let mut controls = Controls::default();
            let mut request = pending("a", "turn1");
            if reason == "expired" {
                request.deadline = Instant::now();
            }
            if reason == "disconnected" {
                request.active.store(false, Ordering::SeqCst);
            }
            controls.insert(request).unwrap();
            if reason == "failed" {
                controls
                    .apply("a", "owner", ControlAction::Failed, Instant::now())
                    .unwrap();
            }
            assert!(controls
                .apply("a", "owner", ControlAction::Begin, Instant::now())
                .is_err());
        }
    }
}
