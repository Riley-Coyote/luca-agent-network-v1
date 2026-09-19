//! Native capture and owner-scoped read surface for public managed work history.

#[path = "activity_trace_store.rs"]
mod store;

use luca_protocol::ManagedPresentationFrameV1;
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, Manager, State};

use super::{
    conversation_context::active_scope,
    managed_dispatch_store::{global_dispatch_store, ManagedDispatchStore},
};
use crate::{app_state::AppState, data_dir::BuzzPathExt};
use store::TraceStore;
pub(crate) use store::{ActivityTrace, Scope};

pub(crate) const ACTIVITY_TRACE_EVENT: &str = "luca://activity-trace-changed";
static STORE: OnceLock<Mutex<TraceStore>> = OnceLock::new();

fn now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0) as u64
}

fn with_store<T>(
    app: &AppHandle,
    task: impl FnOnce(&mut TraceStore) -> Result<T, String>,
) -> Result<T, String> {
    if STORE.get().is_none() {
        let path = app
            .buzz_path()
            .app_data_dir()
            .map_err(|_| "activity trace directory unavailable")?
            .join("luca")
            .join("activity-traces.json");
        // Serialize first initialization: a second reader must never load and
        // terminalize work already observed by another native endpoint.
        static INIT: Mutex<()> = Mutex::new(());
        let _init = INIT
            .lock()
            .map_err(|_| "activity trace initialization unavailable")?;
        if STORE.get().is_none() {
            let _ = STORE.set(Mutex::new(TraceStore::load(path, now_ms())?));
        }
    }
    let mut store = STORE
        .get()
        .ok_or("activity traces unavailable")?
        .lock()
        .map_err(|_| "activity traces unavailable")?;
    task(&mut store)
}

/// Capture the native owner/community once when its resident host is created.
pub(crate) fn host_scope(app: &AppHandle) -> Result<Scope, String> {
    let (owner, relay) = active_scope(&app.state::<AppState>())?;
    Ok(Scope {
        owner: owner.as_str().into(),
        relay,
    })
}

fn reconcile(store: &mut TraceStore, scope: &Scope, dispatches: &ManagedDispatchStore) -> bool {
    let outcomes: HashMap<_, _> = store
        .list(scope)
        .into_iter()
        .filter_map(|trace| {
            dispatches
                .presentation_outcome(
                    &scope.owner,
                    &trace.resident_pubkey,
                    &trace.conversation_id,
                    &trace.dispatch_receipt_id,
                )
                .map(|outcome| {
                    (
                        (
                            trace.resident_pubkey,
                            trace.conversation_id,
                            trace.dispatch_receipt_id,
                        ),
                        outcome,
                    )
                })
        })
        .collect();
    store.reconcile(scope, &outcomes, now_ms())
}

/// Called only after the endpoint's session, sequence and dispatch gates pass.
/// Presentation failures never alter conversation publication or authority.
pub(crate) fn observe(
    app: &AppHandle,
    scope: &Scope,
    frame: &ManagedPresentationFrameV1,
    dispatches: &ManagedDispatchStore,
) {
    let Some((_, _, epoch)) = dispatches.presentation_outcome(
        &scope.owner,
        frame.resident_pubkey.as_str(),
        frame.conversation_id.as_str(),
        frame.dispatch_receipt_id.as_str(),
    ) else {
        return;
    };
    if epoch != Some(frame.session_epoch.get()) {
        return;
    }
    let result = with_store(app, |store| {
        let mut changed = store.observe(scope, frame, now_ms());
        if matches!(
            frame.kind,
            luca_protocol::ManagedPresentationKindV1::Completed
                | luca_protocol::ManagedPresentationKindV1::Cancelled
                | luca_protocol::ManagedPresentationKindV1::Failed
        ) {
            changed |= reconcile(store, scope, dispatches);
        }
        if let Some(placement) = dispatches.presentation_placement(
            &scope.owner,
            frame.resident_pubkey.as_str(),
            frame.conversation_id.as_str(),
            frame.dispatch_receipt_id.as_str(),
        ) {
            changed |= store.set_placement(scope, frame, placement);
        }
        if changed {
            store.save()?;
        }
        Ok(changed)
    });
    match result {
        Ok(true) => {
            let _ = app.emit(ACTIVITY_TRACE_EVENT, ());
        }
        Ok(false) => {}
        Err(_) => luca_log!(
            warn,
            "luca-activity-trace: public work history could not be saved"
        ),
    }
}

/// A socket close interrupts only its captured host epoch, never a replacement.
pub(crate) fn interrupt_host(app: &AppHandle, scope: &Scope, resident: &str, epoch: u64) {
    let result = global_dispatch_store(app).and_then(|dispatches| {
        let dispatches = dispatches
            .lock()
            .map_err(|_| "activity dispatch authority unavailable")?;
        with_store(app, |store| {
            let changed = store.interrupt_session(scope, resident, epoch, now_ms())
                | reconcile(store, scope, &dispatches);
            if changed {
                store.save()?;
            }
            Ok(changed)
        })
    });
    if matches!(result, Ok(true)) {
        let _ = app.emit(ACTIVITY_TRACE_EVENT, ());
    }
}

/// Publication bookkeeping after the dispatch mutex has been released. A
/// storage failure cannot fail, retry or otherwise change signed publication.
pub(crate) fn publication_accepted(
    app: &AppHandle,
    scope: &Scope,
    request: &luca_protocol::ManagedMessagePublishRequestV1,
    session_epoch: u64,
    event_id: &str,
) {
    let result = with_store(app, |store| {
        let changed = store.record_published(scope, request, session_epoch, event_id, now_ms());
        if changed {
            store.save()?;
        }
        Ok(changed)
    });
    match result {
        Ok(true) => {
            let _ = app.emit(ACTIVITY_TRACE_EVENT, ());
        }
        Ok(false) => {}
        Err(_) => luca_log!(
            warn,
            "luca-activity-trace: final work association could not be saved"
        ),
    }
}

/// Write one permission answer into the public work history, after the
/// decision has already been sent to the runtime. A storage failure can never
/// change or retry the answer the owner gave.
#[allow(clippy::too_many_arguments)]
pub(crate) fn record_permission(
    app: &AppHandle,
    scope: &Scope,
    resident_pubkey: &str,
    conversation_id: &str,
    dispatch_receipt_id: Option<&str>,
    turn_id: &str,
    text: &str,
    room_text: &str,
    allowed: bool,
) {
    let result = with_store(app, |store| {
        let changed = store.record_permission(
            scope,
            resident_pubkey,
            conversation_id,
            dispatch_receipt_id,
            turn_id,
            text,
            room_text,
            allowed,
        );
        if changed {
            store.save()?;
        }
        Ok(changed)
    });
    match result {
        Ok(true) => {
            let _ = app.emit(ACTIVITY_TRACE_EVENT, ());
        }
        Ok(false) => {}
        Err(_) => luca_log!(
            warn,
            "luca-activity-trace: permission answer could not be saved"
        ),
    }
}

/// Write one resident-lifecycle capability change into the public work
/// history — a change that happens outside any turn, such as a resident
/// being moved off an unsupported Manual rung at spawn. Idempotent per
/// resident, mirroring [`record_permission`]: a caller does not need to
/// track whether it already recorded one.
pub(crate) fn record_capability_migration(
    app: &AppHandle,
    scope: &Scope,
    resident_pubkey: &str,
    text: &str,
    room_text: &str,
) {
    let result = with_store(app, |store| {
        let changed =
            store.record_capability_migration(scope, resident_pubkey, text, room_text, now_ms());
        if changed {
            store.save()?;
        }
        Ok(changed)
    });
    match result {
        Ok(true) => {
            let _ = app.emit(ACTIVITY_TRACE_EVENT, ());
        }
        Ok(false) => {}
        Err(_) => luca_log!(
            warn,
            "luca-activity-trace: capability migration note could not be saved"
        ),
    }
}

/// Beta.13 P4: mark a Full access ("Don't ask me") toggle in the Activity
/// trail. Unlike [`record_capability_migration`], this is expected to fire
/// more than once for the same resident over its lifetime — each on/off
/// flip gets its own row, so the marker id mixes in the current time.
pub(crate) fn record_full_access_toggle(
    app: &AppHandle,
    scope: &Scope,
    resident_pubkey: &str,
    turned_on: bool,
) {
    let now = now_ms();
    let marker_id = format!("full-access-toggle:{resident_pubkey}:{now}");
    let sentence = if turned_on {
        "Don't ask me turned on. Every door — messaging, deleting, the shell tool — is now allowed without asking, and still recorded here."
    } else {
        "Don't ask me turned off. Doors ask again."
    };
    let room_text = if turned_on {
        "Don't ask me turned on"
    } else {
        "Don't ask me turned off"
    };
    let result = with_store(app, |store| {
        let changed = store.record_lifecycle_marker(
            scope,
            resident_pubkey,
            &marker_id,
            sentence,
            room_text,
            now,
        );
        if changed {
            store.save()?;
        }
        Ok(changed)
    });
    match result {
        Ok(true) => {
            let _ = app.emit(ACTIVITY_TRACE_EVENT, ());
        }
        Ok(false) => {}
        Err(_) => luca_log!(
            warn,
            "luca-activity-trace: full-access toggle note could not be saved"
        ),
    }
}

/// Read only the active native owner's community. Renderer input never chooses
/// an owner, community or claimed final; association comes from signed dispatch
/// publication authority. No model output is accepted from the renderer.
#[tauri::command]
pub(crate) async fn luca_list_activity_traces(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<ActivityTrace>, String> {
    let (owner, relay) = active_scope(&state)?;
    let scope = Scope {
        owner: owner.as_str().into(),
        relay,
    };
    let dispatches = global_dispatch_store(&app)?;
    let expected_scope = scope.clone();
    let result = tokio::task::spawn_blocking(move || {
        let dispatches = dispatches
            .lock()
            .map_err(|_| "activity dispatch authority unavailable")?;
        with_store(&app, |store| {
            if reconcile(store, &scope, &dispatches) {
                store.save()?;
            }
            Ok(store.list(&scope))
        })
    })
    .await
    .map_err(|_| "activity traces unavailable")??;
    let (owner, relay) = active_scope(&state)?;
    if owner.as_str() != expected_scope.owner || relay != expected_scope.relay {
        return Err("activity trace scope changed".into());
    }
    Ok(result)
}
