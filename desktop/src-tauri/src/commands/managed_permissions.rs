use luca_protocol::ResidentAccessLevel;
use tauri::{AppHandle, State};

use crate::app_state::AppState;

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

#[tauri::command]
pub fn set_household_access_level(
    level: ResidentAccessLevel,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::luca::resident_capability_authority::ResidentCapabilitySettingsV1, String> {
    crate::luca::resident_capability_authority::set_household_default(
        &app,
        &owner_pubkey(&state)?,
        level,
    )
}

#[tauri::command]
pub fn set_resident_access_level(
    resident_pubkey: String,
    level: Option<ResidentAccessLevel>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::luca::resident_capability_authority::ResidentCapabilitySettingsV1, String> {
    crate::luca::resident_capability_authority::set_resident_access(
        &app,
        &owner_pubkey(&state)?,
        &resident_pubkey,
        level,
    )
}

#[tauri::command]
pub fn revoke_resident_capability_grant(
    grant_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::luca::resident_capability_authority::ResidentCapabilitySettingsV1, String> {
    crate::luca::resident_capability_authority::revoke(&app, &owner_pubkey(&state)?, &grant_id)
}
