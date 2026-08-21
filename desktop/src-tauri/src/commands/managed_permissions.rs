use luca_protocol::ResidentAccessLevel;
use tauri::{AppHandle, Manager, State};

use crate::app_state::AppState;
use crate::managed_agents::{
    load_managed_agents, save_managed_agents, start_managed_agent_process,
    stop_managed_agent_process, BackendKind,
};

fn owner_pubkey(state: &AppState) -> Result<String, String> {
    Ok(state.signing_keys()?.public_key().to_hex())
}

#[tauri::command]
pub fn list_pending_managed_permissions(
) -> Result<Vec<crate::luca::managed_permission::PendingManagedPermission>, String> {
    crate::luca::managed_permission::list_pending()
}

#[tauri::command]
pub fn resolve_managed_permission(
    pending_id: String,
    option_id: Option<String>,
    app: AppHandle,
) -> Result<(), String> {
    crate::luca::managed_permission::resolve_with_app(&app, &pending_id, option_id)
}

#[tauri::command]
pub fn get_resident_capability_settings(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::luca::resident_capability_authority::ResidentCapabilitySettingsV1, String> {
    crate::luca::resident_capability_authority::settings(&app, &owner_pubkey(&state)?)
}

#[tauri::command]
pub fn set_polyphonic_onboarding_status(
    chapter: String,
    completed: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::luca::resident_capability_authority::OnboardingCapabilityStatusV1, String> {
    crate::luca::resident_capability_authority::set_onboarding_status(
        &app,
        &owner_pubkey(&state)?,
        &chapter,
        completed,
    )
}

async fn restart_for_access_change(
    app: AppHandle,
    owner_pubkey: String,
    resident_pubkey: Option<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _store_guard = state
            .managed_agents_store_lock
            .lock()
            .map_err(|error| error.to_string())?;
        let mut records = load_managed_agents(&app)?;
        let mut runtimes = state
            .managed_agent_processes
            .lock()
            .map_err(|error| error.to_string())?;
        let targets = records
            .iter()
            .filter(|record| {
                record.backend == BackendKind::Local
                    && runtimes.contains_key(&record.pubkey)
                    && resident_pubkey
                        .as_ref()
                        .is_none_or(|pubkey| record.pubkey.eq_ignore_ascii_case(pubkey))
            })
            .map(|record| record.pubkey.clone())
            .collect::<Vec<_>>();
        for pubkey in targets {
            let record = records
                .iter_mut()
                .find(|record| record.pubkey == pubkey)
                .ok_or_else(|| "managed resident disappeared during access update".to_string())?;
            stop_managed_agent_process(&app, record, &mut runtimes)?;
            start_managed_agent_process(&app, record, &mut runtimes, Some(&owner_pubkey))?;
        }
        save_managed_agents(&app, &records)
    })
    .await
    .map_err(|error| format!("resident access restart worker failed: {error}"))?
}

#[tauri::command]
pub async fn set_household_access_level(
    level: ResidentAccessLevel,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::luca::resident_capability_authority::ResidentCapabilitySettingsV1, String> {
    let owner = owner_pubkey(&state)?;
    let settings =
        crate::luca::resident_capability_authority::set_household_default(&app, &owner, level)?;
    restart_for_access_change(app, owner, None).await?;
    Ok(settings)
}

#[tauri::command]
pub async fn set_resident_access_level(
    resident_pubkey: String,
    level: Option<ResidentAccessLevel>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::luca::resident_capability_authority::ResidentCapabilitySettingsV1, String> {
    let owner = owner_pubkey(&state)?;
    let settings = crate::luca::resident_capability_authority::set_resident_access(
        &app,
        &owner,
        &resident_pubkey,
        level,
    )?;
    restart_for_access_change(app, owner, Some(resident_pubkey)).await?;
    Ok(settings)
}

#[tauri::command]
pub fn revoke_resident_capability_grant(
    grant_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::luca::resident_capability_authority::ResidentCapabilitySettingsV1, String> {
    crate::luca::resident_capability_authority::revoke(&app, &owner_pubkey(&state)?, &grant_id)
}
