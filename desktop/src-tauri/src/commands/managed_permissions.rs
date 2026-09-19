use luca_protocol::ResidentAccessLevel;
use nostr::PublicKey;
use tauri::{AppHandle, State};

use crate::app_state::AppState;

fn owner_pubkey(state: &AppState) -> Result<String, String> {
    Ok(state.signing_keys()?.public_key().to_hex())
}

/// Best-effort live application of a resident's new access level to its
/// already-running session (beta.13 P1). Never surfaces a failure to the
/// caller: the level is already durably written by the time this runs, so a
/// publish failure here only means the level takes effect at this
/// resident's next start instead of immediately — exactly the fallback the
/// owner-facing picker already describes for a runtime that cannot take a
/// live switch at all.
///
/// Only `RuntimeTierControl::NativeMode` (Claude, today) gets a control
/// frame: Codex binds its tier through `BUZZ_ACP_CODEX_POLICY` at spawn, not
/// through this ACP config option, and an Advisory family does not take a
/// level from Polyphonic in the first place. Sending the frame regardless of
/// whether this resident is currently running is deliberate and harmless —
/// with no live subscriber the event simply goes undelivered, and a fresh
/// spawn already reads the level this call just persisted.
async fn apply_access_level_live(app: &AppHandle, state: &AppState, resident_pubkey: &str) {
    let family = crate::luca::permission_tier::resident_runtime_family(app, resident_pubkey);
    let level = match crate::luca::resident_capability_authority::effective_access(
        app,
        &match owner_pubkey(state) {
            Ok(owner) => owner,
            Err(_) => return,
        },
        resident_pubkey,
    ) {
        Ok(level) => level,
        Err(_) => return,
    };
    let tier = crate::luca::permission_tier::for_family(family, level);
    if tier.control != crate::luca::permission_tier::RuntimeTierControl::NativeMode {
        return;
    }
    let Ok(resident_key) = PublicKey::from_hex(resident_pubkey.trim()) else {
        return;
    };
    let Ok(keys) = state.signing_keys() else {
        return;
    };
    let payload = serde_json::json!({
        "type": "set_permission_mode",
        "mode": tier.buzz_acp_mode,
    });
    let Ok(encrypted) =
        buzz_core_pkg::observer::encrypt_observer_payload(&keys, &resident_key, &payload)
    else {
        luca_log!(
            warn,
            "luca-permission: could not encrypt the live access-level switch; it will apply next start instead"
        );
        return;
    };
    let resident_hex = resident_key.to_hex();
    let builder = match buzz_sdk_pkg::build_agent_observer_frame(
        &resident_hex,
        &resident_hex,
        buzz_core_pkg::observer::OBSERVER_FRAME_CONTROL,
        &encrypted,
    ) {
        Ok(builder) => builder,
        Err(error) => {
            luca_log!(
                warn,
                "luca-permission: could not build the live access-level switch: {error}; it will apply next start instead"
            );
            return;
        }
    };
    let event = match builder.sign_with_keys(&keys) {
        Ok(event) => event,
        Err(error) => {
            luca_log!(
                warn,
                "luca-permission: could not sign the live access-level switch: {error}; it will apply next start instead"
            );
            return;
        }
    };
    if let Err(error) = crate::relay::submit_signed_event(&event, state).await {
        luca_log!(
            warn,
            "luca-permission: could not publish the live access-level switch: {error}; it will apply next start instead"
        );
    }
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
pub async fn set_resident_access_level(
    resident_pubkey: String,
    level: Option<ResidentAccessLevel>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::luca::resident_capability_authority::ResidentCapabilitySettingsV1, String> {
    let owner = owner_pubkey(&state)?;
    // Read the level this resident is actually leaving, so a Full-access
    // toggle (either direction) can be marked in the Activity trail below —
    // beta.13 P4. `level: None` (reset to household default) can cross this
    // boundary too, so this is read before the write regardless of which
    // form the request takes.
    let previous_level = crate::luca::resident_capability_authority::effective_access(
        &app,
        &owner,
        &resident_pubkey,
    )
    .ok();
    let settings = crate::luca::resident_capability_authority::set_resident_access(
        &app,
        &owner,
        &resident_pubkey,
        level,
    )?;
    let next_level = crate::luca::resident_capability_authority::effective_access(
        &app,
        &owner,
        &resident_pubkey,
    )
    .ok();
    if previous_level != next_level {
        let turned_on = next_level == Some(ResidentAccessLevel::Full);
        let turned_off = previous_level == Some(ResidentAccessLevel::Full) && !turned_on;
        if turned_on || turned_off {
            if let Ok(scope) = crate::luca::activity_trace::host_scope(&app) {
                crate::luca::activity_trace::record_full_access_toggle(
                    &app,
                    &scope,
                    &resident_pubkey,
                    turned_on,
                );
            }
        }
    }
    // Beta.13 P1: reach the resident's live session, not just the durable
    // store, so the composer and Settings pickers both apply without a
    // restart wherever the runtime can take it. `level: None` (reset to the
    // household default) resolves its own effective level here too, so the
    // reset also reaches a live Claude session rather than only the store.
    apply_access_level_live(&app, &state, &resident_pubkey).await;
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
