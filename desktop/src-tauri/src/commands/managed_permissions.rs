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
    tense: Option<crate::luca::permission_ledger::ManagedPermissionTense>,
    app: AppHandle,
) -> Result<(), String> {
    crate::luca::managed_permission::resolve_with_app(&app, &pending_id, option_id, tense)
}

/// Take one remembered permission answer back. Returns the settings the
/// permissions list re-renders from, so the surface never has to re-read.
#[tauri::command]
pub fn revoke_permission_rule(
    rule_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::luca::resident_capability_authority::ResidentCapabilitySettingsV1, String> {
    crate::luca::resident_capability_authority::revoke_rule(&app, &owner_pubkey(&state)?, &rule_id)
}

/// What the owner's access rung actually means for this resident's runtime.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentRuntimeTierV1 {
    family: &'static str,
    control: crate::luca::permission_tier::RuntimeTierControl,
    level: ResidentAccessLevel,
}

#[tauri::command]
pub fn get_resident_runtime_tier(
    resident_pubkey: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentRuntimeTierV1, String> {
    let owner = owner_pubkey(&state)?;
    let level = crate::luca::resident_capability_authority::effective_access(
        &app,
        &owner,
        &resident_pubkey,
    )?;
    let family = crate::luca::permission_tier::resident_runtime_family(&app, &resident_pubkey);
    Ok(ResidentRuntimeTierV1 {
        family,
        control: crate::luca::permission_tier::for_family(family, level).control,
        level,
    })
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
