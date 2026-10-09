//! Owner-only native-history choice. Chat can request this review, never commit
//! it. Nothing here starts observation, reads a transcript or changes a harness.

use super::companion::managed_resident;
use crate::{
    app_state::AppState,
    luca::{
        companion_awareness::{
            AwarenessGrantKeyV1, AwarenessSourceKeyV1, LiveAwarenessOwner, NativeHistoryChoiceV1,
            NATIVE_HISTORY_DISCLOSURE_REVISION,
        },
        continuity_jobs::current_canonical_timestamp,
        managed_cognition,
    },
};
use luca_protocol::{Hex64, OpaqueId, SafeU53};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const DISCLOSURE: &str = "Use this source in conversations with this companion. Selected activity may be sent to the connected model and remain in the harness's chat history and Polyphonic conversation. Pause or removal stops future use; it cannot erase copies already received by the harness or model provider. This does not connect Brain, archive raw activity locally, or give access to another companion.";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionNativeHistoryStatusV1 {
    choice: Option<NativeHistoryChoiceV1>,
    current_binding_confirmed: bool,
    consumers_ready: bool,
    disclosure_revision: u32,
    disclosure: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompanionNativeHistoryInputV1 {
    allowed: bool,
    expected_revision: u64,
    disclosure_revision: u32,
    request_id: String,
}

#[tauri::command]
pub fn get_companion_native_history_choice(
    resident_pubkey: String,
    source_id: String,
    app: AppHandle,
) -> Result<CompanionNativeHistoryStatusV1, String> {
    let state = app.state::<AppState>();
    let owner = state
        .companion_awareness
        .control_owner()
        .ok_or("companion awareness unavailable")?;
    let key = key(&app, &state, &owner, &resident_pubkey, &source_id)?;
    status(&state, &owner, &key)
}

#[tauri::command]
pub async fn set_companion_native_history_choice(
    resident_pubkey: String,
    source_id: String,
    input: CompanionNativeHistoryInputV1,
    app: AppHandle,
) -> Result<CompanionNativeHistoryStatusV1, String> {
    if input.disclosure_revision != NATIVE_HISTORY_DISCLOSURE_REVISION {
        return Err("Read the current activity-in-chat explanation before confirming.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner = state
            .companion_awareness
            .control_owner()
            .ok_or("companion awareness unavailable")?;
        let key = key(&app, &state, &owner, &resident_pubkey, &source_id)?;
        let live = input
            .allowed
            .then(|| LiveAwarenessOwner::authenticate(&state))
            .transpose()
            .map_err(|error| error.to_string())?;
        let binding = if input.allowed {
            Some(
                managed_cognition::active_binding_ref(&key.resident_pubkey).map_err(|_| {
                    "Start this companion before including selected activity in chat."
                })?,
            )
        } else {
            None
        };
        state
            .companion_awareness
            .set_native_history_choice(
                &owner,
                &key,
                live.as_ref(),
                SafeU53::new(input.expected_revision)
                    .map_err(|_| "invalid history choice revision")?,
                input.allowed,
                binding.as_ref(),
                &current_canonical_timestamp()?,
                &OpaqueId::parse(input.request_id).map_err(|_| "invalid history choice request")?,
            )
            .map_err(|error| error.to_string())?;
        let _ = state.companion_coordinator.foreground_activity(&app);
        status(&state, &owner, &key)
    })
    .await
    .map_err(|_| "activity-in-chat choice unavailable".to_owned())?
}

fn key(
    app: &AppHandle,
    state: &AppState,
    owner: &Hex64,
    resident: &str,
    source: &str,
) -> Result<AwarenessGrantKeyV1, String> {
    let key = AwarenessGrantKeyV1 {
        source: AwarenessSourceKeyV1 {
            owner_pubkey: owner.clone(),
            source_id: OpaqueId::parse(source.to_owned()).map_err(|_| "invalid selected source")?,
            device_id: state
                .companion_awareness
                .device(owner)
                .map_err(|error| error.to_string())?,
        },
        resident_pubkey: managed_resident(app, resident, owner)?,
    };
    // An arbitrary renderer ID cannot create a source or a grant here.
    state
        .companion_awareness
        .snapshot(owner, &key)
        .map_err(|error| error.to_string())?;
    Ok(key)
}
fn status(
    state: &AppState,
    owner: &Hex64,
    key: &AwarenessGrantKeyV1,
) -> Result<CompanionNativeHistoryStatusV1, String> {
    let choice = state
        .companion_awareness
        .native_history_choice(owner, key)
        .map_err(|error| error.to_string())?;
    let current_binding_confirmed = managed_cognition::active_binding_ref(&key.resident_pubkey)
        .ok()
        .is_some_and(|binding| {
            state
                .companion_awareness
                .recheck_native_history_choice(owner, key, &binding)
                .is_ok()
        });
    Ok(CompanionNativeHistoryStatusV1 {
        choice,
        current_binding_confirmed,
        consumers_ready:
            crate::luca::managed_dispatch_store::ordinary_turn_awareness_consumers_ready(),
        disclosure_revision: NATIVE_HISTORY_DISCLOSURE_REVISION,
        disclosure: DISCLOSURE,
    })
}
