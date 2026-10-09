//! Explicit owner controls, not project/session or source permission.
use super::companion::managed_resident;
use crate::{
    app_state::AppState,
    luca::{
        companion_awareness::LiveAwarenessOwner,
        companion_initiative::{host_scope::home_scope, InitiativePolicyV1},
        continuity_jobs::current_canonical_timestamp,
        resident_notebook::{InitiativeThreadCommitRequestV1, InitiativeThreadHeadV1},
    },
};
use luca_continuity::RevisionActor;
use luca_protocol::{Hex64, InitiativeDispositionV1, InitiativeThreadKindV1, OpaqueId, SafeU53};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionInitiativeStatusV1 {
    availability: &'static str,
    policy: InitiativePolicyV1,
    /// Availability is not proof of a successful autonomous pursuit.
    native_channel_available: bool,
    actual_model_execution_verified: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompanionInitiativePolicyInputV1 {
    enabled: bool,
    paused: bool,
    allow_outreach: bool,
    allow_local_creations: bool,
    expected_revision: u64,
    request_id: String,
}

#[tauri::command]
pub fn get_companion_initiative(
    resident_pubkey: String,
    app: AppHandle,
) -> Result<CompanionInitiativeStatusV1, String> {
    let state = app.state::<AppState>();
    let owner = state
        .companion_awareness
        .control_owner()
        .ok_or("companion initiative unavailable")?;
    let resident = managed_resident(&app, &resident_pubkey, &owner)?;
    status(&state, &owner, &resident)
}

#[tauri::command]
pub fn set_companion_initiative_policy(
    resident_pubkey: String,
    input: CompanionInitiativePolicyInputV1,
    app: AppHandle,
) -> Result<CompanionInitiativeStatusV1, String> {
    if input.allow_outreach {
        return Err("Proactive publication is not enabled in this candidate.".into());
    }
    let state = app.state::<AppState>();
    let owner = state
        .companion_awareness
        .control_owner()
        .ok_or("companion initiative unavailable")?;
    let resident = managed_resident(&app, &resident_pubkey, &owner)?;
    let scope = home_scope(&state, &owner, &resident).map_err(error)?;
    let expected =
        SafeU53::new(input.expected_revision).map_err(|_| "invalid companion policy revision")?;
    let request =
        OpaqueId::parse(input.request_id).map_err(|_| "invalid companion policy request")?;
    let current = state
        .companion_initiative
        .with_control(&scope, |store| store.policy(&scope))
        .map_err(error)?;
    let mut next = current.clone();
    next.revision = SafeU53::new(
        expected
            .get()
            .checked_add(1)
            .ok_or("companion policy exhausted")?,
    )
    .map_err(|_| "invalid companion policy revision")?;
    next.enabled = input.enabled;
    next.paused = input.paused || !input.enabled;
    next.allow_local_creations = input.allow_local_creations;
    let widening = (next.enabled && !current.enabled) || (!next.paused && current.paused)
        || (next.allow_local_creations && !current.allow_local_creations);
    if !next.enabled || next.paused {
        state.companion_execution.pause(&scope).map_err(error)?;
    }
    let (policy,_cancelled)=if widening {
        let live=LiveAwarenessOwner::authenticate(&state).map_err(|error|error.to_string())?;
        if !crate::luca::managed_cognition::initiative_adapter_supported(&resident) {
            return Err("This companion's current native adapter has no supported tool-free background path.".into());
        }
        state.companion_initiative.with_live(&live,&scope,|store|store.set_policy(&scope,&request,expected,next))
    } else {
        state.companion_initiative.with_control(&scope,|store|store.set_policy(&scope,&request,expected,next))
    }.map_err(error)?;
    if policy.enabled && !policy.paused {
        state.companion_execution.resume(&scope).map_err(error)?;
        // Explicit policy is only eligibility. This records actual interaction
        // and wakes the default-off coordinator; idle/cadence/current-head/native
        // admission still decide whether any later model is permitted.
        let _ = state.companion_coordinator.foreground_activity(&app);
        let _ = state.companion_coordinator.wake(&resident);
    } else {
        let _ = state.companion_coordinator.resident_stop(&resident);
    }
    // Coordinator consumes exact owned cancellations after this durable barrier;
    // the receipt does not claim an already admitted native request stopped.
    Ok(CompanionInitiativeStatusV1 {
        availability: "ready",
        policy,
        native_channel_available: crate::luca::managed_cognition::active_binding_ref(&resident)
            .is_ok(),
        actual_model_execution_verified: false,
    })
}

/// Shared work can be let go without a model. Own inquiry remains resident
/// authorship; owner Pause/disable always controls use of their machine.
#[tauri::command]
pub async fn retire_companion_shared_thread(
    resident_pubkey: String,
    thread_id: String,
    expected_record_id: String,
    expected_revision: u64,
    request_id: String,
    app: AppHandle,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let live = LiveAwarenessOwner::authenticate(&state).map_err(|error| error.to_string())?;
        let resident = managed_resident(&app, &resident_pubkey, live.owner())?;
        let _lease = live.lease().map_err(|error| error.to_string())?;
        let id = OpaqueId::parse(thread_id).map_err(|_| "invalid carried thread")?;
        let record = OpaqueId::parse(expected_record_id).map_err(|_| "invalid carried revision")?;
        let revision = SafeU53::new(expected_revision).map_err(|_| "invalid carried revision")?;
        let snapshot = state
            .read_resident_initiative_threads(live.owner(), &resident, false)
            .map_err(|_| "carried threads unavailable")?
            .ok_or("carried thread missing")?;
        let view = snapshot
            .threads
            .into_iter()
            .find(|view| view.thread.thread_id == id)
            .ok_or("carried thread missing")?;
        if view.record_id != record
            || view.thread.revision != revision
            || view.thread.kind != InitiativeThreadKindV1::Shared
        {
            return Err("The shared thread changed; refresh before letting it go.".into());
        }
        let mut thread = view.thread;
        thread.disposition = InitiativeDispositionV1::Retired;
        thread.eligible_after = None;
        thread.revision = SafeU53::new(
            revision
                .get()
                .checked_add(1)
                .ok_or("carried revision exhausted")?,
        )
        .map_err(|_| "invalid carried revision")?;
        thread.updated_at = current_canonical_timestamp()?;
        state
            .commit_resident_initiative_thread(InitiativeThreadCommitRequestV1 {
                owner_pubkey: live.owner().clone(),
                resident_pubkey: resident.clone(),
                request_id: OpaqueId::parse(request_id).map_err(|_| "invalid carried request")?,
                actor: RevisionActor::Owner,
                canonical_source_clean: false,
                own_authorship_proof: None,
                completion_cause: None,
                expected_head: Some(InitiativeThreadHeadV1 {
                    record_id: record,
                    revision,
                }),
                thread,
            })
            .map_err(|_| "Could not retire the changed shared thread.".to_owned())?;
        let scope = home_scope(&state, live.owner(), &resident).map_err(error)?;
        drop(_lease);
        // The validated canonical retirement is durable first. Cancel only the
        // exact tracked thread; Native cancellation is a request, not stoppage.
        state.companion_execution.retire_thread(&scope, &id).map_err(error)?;
        if let Some((running_resident, job, running_thread)) = state.companion_coordinator.active_job() {
            if running_resident == resident && running_thread == id {
                let _ = state.companion_initiative.with_control(&scope, |store| store.interrupt_private_cycle(&scope, &job));
            }
        }
        Ok(())
    })
    .await
    .map_err(|_| "carried thread control unavailable".to_owned())?
}

fn status(
    state: &AppState,
    owner: &Hex64,
    resident: &Hex64,
) -> Result<CompanionInitiativeStatusV1, String> {
    let scope = home_scope(state, owner, resident).map_err(error)?;
    let policy = state
        .companion_initiative
        .with_control(&scope, |store| store.policy(&scope))
        .map_err(error)?;
    Ok(CompanionInitiativeStatusV1 {
        availability: "ready",
        policy,
        native_channel_available: crate::luca::managed_cognition::active_binding_ref(resident)
            .is_ok(),
        actual_model_execution_verified: false,
    })
}
fn error(error: crate::luca::companion_initiative::InitiativeStoreErrorV1) -> String {
    format!("companion initiative: {error:?}")
}
