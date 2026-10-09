//! Trusted native selection and explicit companion-only awareness choices.
//! No path, profile discovery selector, provider binding or source ID can be
//! supplied by a model. Selection never opts into initiative or Brain recall.

use std::path::{Path, PathBuf};

use luca_protocol::{
    AwarenessChoicesV1, AwarenessGrantStateV1, AwarenessGrantV1, OpaqueId, SafeU53,
    AWARENESS_PROTOCOL,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use super::companion::{managed_resident, projection, CompanionAwarenessStatusV1};
use crate::{
    app_state::AppState,
    luca::{
        companion_awareness::{
            catalog::{SelectedSourceClassV1, SelectedSourceSelectionV1},
            AwarenessGrantKeyV1, AwarenessSourceKeyV1, AwarenessStoreError, LiveAwarenessOwner,
        },
        managed_cognition,
    },
};

/// Retention and egress are not inferred from access. Raw archival retention is
/// not implemented by this adapter and therefore cannot be offered as enabled.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompanionSourceChoicesInputV1 {
    pub observe: bool,
    pub promote: bool,
    pub provider_egress: bool,
    pub retain_raw: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionSelectedSourceViewV1 {
    source_id: String,
    class: SelectedSourceClassV1,
}

/// Private locators remain in host configuration. This inventory is metadata,
/// not consent or a claim that the source/harness is currently active.
#[tauri::command]
pub async fn list_companion_selected_sources(
    resident_pubkey: String,
    app: AppHandle,
) -> Result<Vec<CompanionSelectedSourceViewV1>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner = state
            .companion_awareness
            .control_owner()
            .ok_or("companion awareness unavailable")?;
        let resident = managed_resident(&app, &resident_pubkey, &owner)?;
        Ok(state
            .companion_sources
            .selected(&owner, &resident)
            .map_err(error)?
            .into_iter()
            .map(|selection| CompanionSelectedSourceViewV1 {
                source_id: selection.key().source.source_id.as_str().to_owned(),
                class: selection.class(),
            })
            .collect())
    })
    .await
    .map_err(|_| "companion source inventory unavailable".to_owned())?
}

/// Native picker is the source of the exact handle; never trust a renderer path.
/// Reads begin only if Observe is explicitly chosen and this companion is resumed.
#[tauri::command]
pub async fn pick_companion_awareness_source(
    resident_pubkey: String,
    class: SelectedSourceClassV1,
    choices: CompanionSourceChoicesInputV1,
    request_id: String,
    app: AppHandle,
) -> Result<Option<CompanionAwarenessStatusV1>, String> {
    validate_choices(&choices)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let picker = app.dialog().file();
    let picker = if class == SelectedSourceClassV1::SelectedFile {
        picker.add_filter(
            "Text and project files",
            &["md", "txt", "rs", "ts", "tsx", "js", "py"],
        )
    } else {
        picker.add_filter("Native session transcript", &["jsonl"])
    };
    picker.pick_file(move |selection| {
        let _ = sender.send(selection);
    });
    let Some(selection) = receiver
        .await
        .map_err(|_| "companion source picker unavailable")?
    else {
        return Ok(None);
    };
    let path = selection
        .as_path()
        .map(Path::to_path_buf)
        .ok_or("invalid selected source")?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let live = LiveAwarenessOwner::authenticate(&state).map_err(error)?;
        let resident = managed_resident(&app, &resident_pubkey, live.owner())?;
        let device = state
            .companion_awareness
            .device(live.owner())
            .map_err(error)?;
        let (root, relative) = selected_locator(&path)?;
        let key = AwarenessGrantKeyV1 {
            source: AwarenessSourceKeyV1 {
                owner_pubkey: live.owner().clone(),
                source_id: class.source_id(&root, &relative).map_err(error)?,
                device_id: device,
            },
            resident_pubkey: resident.clone(),
        };
        let selection =
            SelectedSourceSelectionV1::new(key.clone(), class, root, relative).map_err(error)?;
        state
            .companion_sources
            .select(&live, selection)
            .map_err(error)?;
        let operation = operation_id(&request_id, "register")?;
        match state
            .companion_awareness
            .source_snapshot(live.owner(), &key.source)
        {
            Ok(_) => {}
            Err(AwarenessStoreError::Missing) => {
                state
                    .companion_awareness
                    .register_source(&live, &key.source, &operation)
                    .map_err(error)?;
            }
            Err(failure) => return Err(error(failure)),
        }
        let expected = state
            .companion_awareness
            .snapshot(live.owner(), &key)
            .map(|value| Some(value.grant.grant_revision))
            .or_else(|failure| {
                if failure == AwarenessStoreError::Missing {
                    Ok(None)
                } else {
                    Err(failure)
                }
            })
            .map_err(error)?;
        put_choices(
            &state,
            &live,
            &key,
            expected,
            &choices,
            &operation_id(&request_id, "grant")?,
        )?;
        projection(&state, live.owner(), &resident).map(Some)
    })
    .await
    .map_err(|_| "companion source selection unavailable".to_owned())?
}

/// Amend one previously host-selected exact source. No wildcard/future-agent grant.
#[tauri::command]
pub async fn set_companion_source_choices(
    resident_pubkey: String,
    source_id: String,
    expected_revision: u64,
    choices: CompanionSourceChoicesInputV1,
    request_id: String,
    app: AppHandle,
) -> Result<CompanionAwarenessStatusV1, String> {
    validate_choices(&choices)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let live = LiveAwarenessOwner::authenticate(&state).map_err(error)?;
        let resident = managed_resident(&app, &resident_pubkey, live.owner())?;
        let source = OpaqueId::parse(source_id).map_err(|_| "invalid companion source")?;
        let key = selected_key(&state, live.owner(), &resident, &source)?;
        let _ = state.companion_coordinator.foreground_activity(&app);
        let expected = SafeU53::new(expected_revision).map_err(|_| "invalid companion revision")?;
        put_choices(
            &state,
            &live,
            &key,
            Some(expected),
            &choices,
            &operation_id(&request_id, "grant")?,
        )?;
        projection(&state, live.owner(), &resident)
    })
    .await
    .map_err(|_| "companion source controls unavailable".to_owned())?
}

pub(super) fn put_choices(
    state: &AppState,
    live: &LiveAwarenessOwner<'_>,
    key: &AwarenessGrantKeyV1,
    expected: Option<SafeU53>,
    choices: &CompanionSourceChoicesInputV1,
    operation: &OpaqueId,
) -> Result<(), String> {
    let (source, _) = state
        .companion_awareness
        .source_snapshot(live.owner(), &key.source)
        .map_err(error)?;
    let old = match state.companion_awareness.snapshot(live.owner(), key) {
        Ok(value) => Some(value),
        Err(AwarenessStoreError::Missing) => None,
        Err(failure) => return Err(error(failure)),
    };
    let provider = if choices.provider_egress {
        Some(
            managed_cognition::active_binding_ref(&key.resident_pubkey).map_err(|_| {
                "Start this companion before allowing its current runtime to receive context."
            })?,
        )
    } else {
        None
    };
    let grant = AwarenessGrantV1 {
        protocol: AWARENESS_PROTOCOL.into(),
        grant_id: old
            .as_ref()
            .map(|value| value.grant.grant_id.clone())
            .unwrap_or_else(|| {
                OpaqueId::parse(format!("grant-{}", uuid::Uuid::new_v4()))
                    .expect("host UUID is valid")
            }),
        owner_pubkey: live.owner().clone(),
        resident_pubkey: key.resident_pubkey.clone(),
        source_id: key.source.source_id.clone(),
        device_id: key.source.device_id.clone(),
        grant_revision: SafeU53::new(expected.map_or(1, |value| value.get().saturating_add(1)))
            .map_err(|_| "invalid companion revision")?,
        deny_epoch: source.deny_epoch,
        state: AwarenessGrantStateV1::Active,
        choices: AwarenessChoicesV1 {
            observe: choices.observe,
            retain: false,
            promote: choices.promote,
            provider_egress_binding: provider,
        },
    };
    state
        .companion_awareness
        .put_grant(live, &grant, expected, operation)
        .map_err(error)?;
    // Always stop old compiled captures before activating amended access.
    state
        .companion_sources
        .after_grant_withdrawal(live.owner(), key)
        .map_err(error)?;
    #[cfg(unix)]
    let _ = state.companion_browser.after_grant_withdrawal(live.owner(), key);
    if choices.observe
        && !state
            .companion_awareness
            .resident_state(live.owner(), &key.resident_pubkey)
            .map_err(error)?
            .paused
    {
        resume_selected_key(state, live, key)?;
    }
    Ok(())
}

pub(super) fn validate_choices(choices: &CompanionSourceChoicesInputV1) -> Result<(), String> {
    if choices.retain_raw {
        return Err(
            "Raw archival retention is not available; observations expire automatically.".into(),
        );
    }
    if !choices.observe && (choices.promote || choices.provider_egress) {
        return Err("Observation must be allowed before memory or runtime context.".into());
    }
    Ok(())
}
fn selected_locator(path: &Path) -> Result<(PathBuf, String), String> {
    let canonical = path
        .canonicalize()
        .map_err(|_| "Selected source unavailable")?;
    if canonical.starts_with("/Volumes")
        || !std::fs::symlink_metadata(path)
            .is_ok_and(|value| value.is_file() && !value.file_type().is_symlink())
    {
        return Err("Choose a regular source file on this Mac's internal disk.".into());
    }
    let root = canonical
        .parent()
        .ok_or("invalid selected source")?
        .to_path_buf();
    let relative = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("invalid selected source")?
        .to_owned();
    Ok((root, relative))
}
pub(super) fn operation_id(request: &str, phase: &str) -> Result<OpaqueId, String> {
    OpaqueId::parse(request.to_owned()).map_err(|_| "invalid companion request")?;
    OpaqueId::parse(format!(
        "source-{phase}-{}",
        hex::encode(Sha256::digest(request.as_bytes()))
    ))
    .map_err(|_| "invalid companion operation".to_owned())
}
fn error(error: AwarenessStoreError) -> String {
    error.to_string()
}

pub(super) fn resume_selected_key(state: &AppState, live: &LiveAwarenessOwner<'_>, key: &AwarenessGrantKeyV1)
    -> Result<(), String> {
    #[cfg(unix)]
    if key.source.source_id.as_str().starts_with("browser-source:") {
        return state.companion_browser.resume_source(live,key).map_err(|error|error.to_string());
    }
    if state.companion_sources.selected(live.owner(), &key.resident_pubkey).ok().into_iter().flatten()
        .any(|selection| selection.key() == key)
    {
        return state.companion_sources.resume(live, key, Default::default()).map_err(error);
    }
    if state.companion_sources.list_machines(live.owner(), &key.resident_pubkey).ok().into_iter().flatten()
        .any(|selection| selection.key() == key)
    {
        return state.companion_sources.resume_machine(live, key).map_err(error);
    }
    let selected = state.companion_sources.list_profiles(live.owner(), &key.resident_pubkey).map_err(error)?
        .into_iter().find(|registration| registration.selection.grant_key() == key)
        .ok_or("Source is not selected for this companion.")?;
    state.companion_sources.resume_profile(live, selected.selection).map_err(error)
}

fn selected_key(state: &AppState, owner: &luca_protocol::Hex64, resident: &luca_protocol::Hex64, source: &OpaqueId)
    -> Result<AwarenessGrantKeyV1, String> {
    #[cfg(unix)]
    if source.as_str().starts_with("browser-source:") {
        return super::companion_browser::browser_key(state,owner,resident,source);
    }
    if let Some(selection) = state.companion_sources.selected(owner, resident).ok().into_iter().flatten()
        .find(|selection| &selection.key().source.source_id == source)
    { return Ok(selection.key().clone()); }
    if let Some(selection) = state.companion_sources.list_machines(owner, resident).ok().into_iter().flatten()
        .find(|selection| &selection.key().source.source_id == source)
    { return Ok(selection.key().clone()); }
    state.companion_sources.list_profiles(owner, resident).map_err(error)?
        .into_iter().find(|registration| &registration.selection.grant_key().source.source_id == source)
        .map(|registration| registration.selection.grant_key().clone())
        .ok_or_else(|| "Source is not selected for this companion.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn choices_are_independent_and_unsupported_archival_retention_is_rejected() {
        let mut input = CompanionSourceChoicesInputV1 {
            observe: true,
            promote: false,
            provider_egress: false,
            retain_raw: false,
        };
        assert!(validate_choices(&input).is_ok());
        input.retain_raw = true;
        assert!(validate_choices(&input).is_err());
        input.retain_raw = false;
        input.observe = false;
        input.promote = true;
        assert!(validate_choices(&input).is_err());
    }
    #[test]
    fn operation_identity_is_stable_and_phase_separated() {
        assert_eq!(
            operation_id("request-1", "grant").unwrap(),
            operation_id("request-1", "grant").unwrap()
        );
        assert_ne!(
            operation_id("request-1", "grant").unwrap(),
            operation_id("request-1", "register").unwrap()
        );
    }
}
