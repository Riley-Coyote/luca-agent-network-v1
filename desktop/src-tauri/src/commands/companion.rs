//! Explicit owner controls; no command implicitly starts capture or model work.

use luca_protocol::{Hex64, OpaqueId, SafeU53};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::luca::{
    companion_awareness::{
        AwarenessGrantKeyV1, AwarenessSourceKeyV1, AwarenessStoreError, AwarenessStoredAuthorityV1,
        AwarenessWithdrawalV1, LiveAwarenessOwner,
    },
    continuity_jobs::current_canonical_timestamp,
};
use crate::{app_state::AppState, managed_agents::load_managed_agent_public_keys};

/// Body-free inspection. Retained public scope permits only status and narrowing
/// controls during keychain recovery, not observation/provider egress.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionAwarenessStatusV1 {
    availability: &'static str,
    paused: bool,
    /// Body-free process status, not permission or evidence of a fresh sample.
    collection_running: bool,
    revision: u64,
    changed_at: Option<String>,
    grants: Vec<AwarenessStoredAuthorityV1>,
    truncated: bool,
}

/// Current metadata, never raw observations or private continuity bodies.
#[tauri::command]
pub fn get_companion_awareness(
    resident_pubkey: String,
    app: AppHandle,
) -> Result<CompanionAwarenessStatusV1, String> {
    let state = app.state::<AppState>();
    let Some(owner) = state.companion_awareness.control_owner() else {
        return Ok(CompanionAwarenessStatusV1 {
            availability: "unavailable",
            paused: true,
            collection_running: false,
            revision: 0,
            changed_at: None,
            grants: Vec::new(),
            truncated: false,
        });
    };
    let resident = managed_resident(&app, &resident_pubkey, &owner)?;
    projection(&state, &owner, &resident)
}

/// Explicit Pause/Resume; only Resume requires current signable owner authority.
#[tauri::command]
pub async fn set_companion_awareness_paused(
    resident_pubkey: String,
    paused: bool,
    expected_revision: u64,
    request_id: String,
    app: AppHandle,
) -> Result<CompanionAwarenessStatusV1, String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_awareness_paused(
            &app,
            &resident_pubkey,
            paused,
            expected_revision,
            &request_id,
        )
    })
    .await
    .map_err(|_| "companion awareness controls unavailable".to_owned())?
}

fn set_awareness_paused(
    app: &AppHandle,
    resident_pubkey: &str,
    paused: bool,
    expected_revision: u64,
    request_id: &str,
) -> Result<CompanionAwarenessStatusV1, String> {
    let state = app.state::<AppState>();
    let owner = state
        .companion_awareness
        .control_owner()
        .ok_or("companion awareness unavailable")?;
    let resident = managed_resident(app, resident_pubkey, &owner)?;
    let _ = state.companion_coordinator.foreground_activity(app);
    if paused {
        if let Ok(scope) =
            crate::luca::companion_initiative::host_scope::home_scope(&state, &owner, &resident)
        {
            let _ = state.companion_execution.pause(&scope);
        }
        // Stop owned readers even if the following durable write fails.
        state
            .companion_sources
            .after_pause(&owner, &resident)
            .map_err(error)?;
        #[cfg(unix)]
        let _ = state.companion_browser.after_pause(&owner, &resident);
    }
    let live = if paused {
        None
    } else {
        Some(LiveAwarenessOwner::authenticate(&state).map_err(error)?)
    };
    let expected = (expected_revision > 0)
        .then(|| safe(expected_revision))
        .transpose()?;
    state
        .companion_awareness
        .set_paused(
            &owner,
            &resident,
            live.as_ref(),
            expected,
            paused,
            &current_canonical_timestamp()?,
            &identifier(request_id)?,
        )
        .map_err(error)?;
    if paused {
        state
            .companion_sources
            .after_pause(&owner, &resident)
            .map_err(error)?;
        #[cfg(unix)]
        let _ = state.companion_browser.after_pause(&owner, &resident);
    } else if let Some(live) = live.as_ref() {
        for selection in state
            .companion_sources
            .selected(&owner, &resident)
            .map_err(error)?
        {
            let authority = state
                .companion_awareness
                .snapshot(&owner, selection.key())
                .map_err(error)?;
            if authority.grant.state == luca_protocol::AwarenessGrantStateV1::Active
                && authority.grant.choices.observe
            {
                state
                    .companion_sources
                    .resume(live, selection.key(), Default::default())
                    .map_err(error)?;
            }
        }
        for registration in state.companion_sources.list_profiles(&owner, &resident).map_err(error)? {
            let authority = match state.companion_awareness.snapshot(&owner, registration.selection.grant_key()) {
                Ok(value) => value,
                Err(AwarenessStoreError::Missing) => continue,
                Err(failure) => return Err(error(failure)),
            };
            if authority.grant.state == luca_protocol::AwarenessGrantStateV1::Active
                && authority.grant.choices.observe
            {
                state.companion_sources.resume_profile(live, registration.selection).map_err(error)?;
            }
        }
        // This explicit global Resume rechecks only saved machine selections
        // for this resident. Class dispatch remains closed: text gets one shot,
        // only metadata starts notifications, and browsers stay separately off.
        for selection in state.companion_sources.list_machines(&owner, &resident).map_err(error)? {
            let authority = match state.companion_awareness.snapshot(&owner, selection.key()) {
                Ok(value) => value,
                Err(AwarenessStoreError::Missing) => continue,
                Err(failure) => return Err(error(failure)),
            };
            if authority.grant.state != luca_protocol::AwarenessGrantStateV1::Active || !authority.grant.choices.observe { continue; }
            use crate::luca::companion_awareness::machine_activity::MachineObservationClassV1;
            match selection.class() {
                MachineObservationClassV1::AppMetadata | MachineObservationClassV1::AccessibilityText | MachineObservationClassV1::ScreenText => {
                    state.companion_sources.resume_machine(live, selection.key()).map_err(error)?;
                }
            }
        }
    }
    projection(&state, &owner, &resident)
}

/// Withdraw one exact companion grant without a model or available signing key.
/// Denial is durable; canonical Forget/purge is deliberately a separate operation.
#[tauri::command]
pub async fn withdraw_companion_awareness_grant(
    resident_pubkey: String,
    source_id: String,
    expected_revision: u64,
    request_id: String,
    app: AppHandle,
) -> Result<CompanionAwarenessStatusV1, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner = state
            .companion_awareness
            .control_owner()
            .ok_or("companion awareness unavailable")?;
        let resident = managed_resident(&app, &resident_pubkey, &owner)?;
        let _ = state.companion_coordinator.foreground_activity(&app);
        let key = AwarenessGrantKeyV1 {
            source: AwarenessSourceKeyV1 {
                owner_pubkey: owner.clone(),
                source_id: identifier(&source_id)?,
                device_id: state.companion_awareness.device(&owner).map_err(error)?,
            },
            resident_pubkey: resident.clone(),
        };
        #[cfg(unix)]
        let _ = state.companion_browser.after_grant_withdrawal(&owner, &key);
        state
            .companion_awareness
            .withdraw_grant(
                &owner,
                &key,
                safe(expected_revision)?,
                AwarenessWithdrawalV1::Withdraw,
                &identifier(&request_id)?,
            )
            .map_err(error)?;
        #[cfg(unix)]
        let _ = state.companion_browser.after_grant_withdrawal(&owner, &key);
        state
            .companion_sources
            .after_grant_withdrawal(&owner, &key)
            .map_err(error)?;
        let _ = state.companion_execution.withdraw_grant(&key);
        projection(&state, &owner, &resident)
    }).await.map_err(|_| "companion withdrawal unavailable".to_owned())?
}

pub(super) fn projection(
    state: &AppState,
    owner: &Hex64,
    resident: &Hex64,
) -> Result<CompanionAwarenessStatusV1, String> {
    let current = state
        .companion_awareness
        .resident_state(owner, resident)
        .map_err(error)?;
    let grants = state
        .companion_awareness
        .list_grants(owner, resident, 64)
        .map_err(error)?;
    // Saved consent is not watcher startup. After restart, offer explicit Resume
    // even when the durable control was unpaused in the previous process.
    let now = current_canonical_timestamp()?;
    let mut collecting = state
        .companion_sources
        .snapshot(owner, resident, &now)
        .map(|snapshot| snapshot.collecting)
        .unwrap_or_default();
    #[cfg(unix)]
    if let Ok(snapshot) = state.companion_browser.snapshot(owner, resident, &now) {
        collecting.extend(snapshot.collecting_keys());
    }
    let collection_running = !current.paused
        && grants.entries.iter().any(|authority| {
            authority.grant.state == luca_protocol::AwarenessGrantStateV1::Active
                && authority.grant.choices.observe
                && collecting.contains(&AwarenessGrantKeyV1 {
                    source: AwarenessSourceKeyV1 {
                        owner_pubkey: owner.clone(),
                        source_id: authority.source.source_id.clone(),
                        device_id: authority.source.device_id.clone(),
                    },
                    resident_pubkey: resident.clone(),
                })
        });
    Ok(CompanionAwarenessStatusV1 {
        availability: "ready",
        paused: current.paused,
        collection_running,
        revision: current.revision.get(),
        changed_at: current.changed_at.map(|value| value.as_str().to_owned()),
        grants: grants.entries,
        truncated: grants.truncated,
    })
}

pub(super) fn managed_resident(
    app: &AppHandle,
    value: &str,
    owner: &Hex64,
) -> Result<Hex64, String> {
    let resident = Hex64::parse(value.trim().to_ascii_lowercase())
        .map_err(|_| "invalid resident identity".to_owned())?;
    if &resident == owner || !load_managed_agent_public_keys(app)?.contains(&resident) {
        return Err("resident is not managed by this Polyphonic workspace".into());
    }
    Ok(resident)
}
fn identifier(value: &str) -> Result<OpaqueId, String> {
    OpaqueId::parse(value.to_owned()).map_err(|_| "invalid companion identifier".to_owned())
}
fn safe(value: u64) -> Result<SafeU53, String> {
    SafeU53::new(value).map_err(|_| "invalid companion revision".to_owned())
}
fn error(error: AwarenessStoreError) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::luca::companion_awareness::selected_files::tests::{
        id, Fixture,
    };

    #[test]
    fn companion_status_does_not_treat_saved_resume_as_running_collection() {
        let fixture = Fixture::new();
        let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
        let runtime = &fixture.state.companion_awareness;
        runtime.initialize(&fixture.root, Some(live.owner()));
        fixture.grant(id("saved-test-source"), true);
        let status = projection(&fixture.state, live.owner(), &fixture.resident).unwrap();
        assert!(!status.paused);
        assert!(!status.collection_running);
        assert!(status.grants[0].grant.choices.observe);
        assert_eq!(serde_json::to_value(status).unwrap()["collectionRunning"], false);
    }
}
