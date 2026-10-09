//! Explicit native-container consent; no native home discovery or transcript scan.
use std::path::Path;
use serde::Serialize;
use tauri::{AppHandle,Manager};
use tauri_plugin_dialog::DialogExt;
use crate::{app_state::AppState,luca::companion_awareness::{
    native_profile::{NativeProfileKindV1,NativeProfileObservationClassV1,NativeProfileSelectionV1},
    profile_catalog::NativeProfileRegistrationV1,
    AwarenessGrantKeyV1,AwarenessSourceKeyV1,AwarenessStoreError,LiveAwarenessOwner,
}};
use super::{companion::{managed_resident,projection,CompanionAwarenessStatusV1},
    companion_sources::{operation_id,put_choices,validate_choices,CompanionSourceChoicesInputV1}};

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct CompanionNativeProfileViewV1 {
    source_id:String,kind:NativeProfileKindV1,class:NativeProfileObservationClassV1,
}

#[tauri::command]
pub async fn list_companion_native_profiles(resident_pubkey:String,app:AppHandle)
    ->Result<Vec<CompanionNativeProfileViewV1>,String> {
    tauri::async_runtime::spawn_blocking(move|| {
        let state=app.state::<AppState>();
        let owner=state.companion_awareness.control_owner().ok_or("companion awareness unavailable")?;
        let resident=managed_resident(&app,&resident_pubkey,&owner)?;
        Ok(state.companion_sources.list_profiles(&owner,&resident).map_err(error)?
            .into_iter().map(|registration|CompanionNativeProfileViewV1 {
                source_id:registration.selection.grant_key().source.source_id.as_str().to_owned(),
                kind:registration.selection.kind(),class:registration.selection.class(),
            }).collect())
    }).await.map_err(|_|"native profile selections unavailable".to_owned())?
}

/// Native folder picker supplies one exact `sessions` or `projects` container.
/// Metadata and visible excerpts are independent permission scopes. Selecting a
/// container never reads old history or grants another/current-future resident.
#[tauri::command]
pub async fn pick_companion_native_profile(resident_pubkey:String,kind:NativeProfileKindV1,
    class:NativeProfileObservationClassV1,choices:CompanionSourceChoicesInputV1,
    request_id:String,app:AppHandle)->Result<Option<CompanionAwarenessStatusV1>,String> {
    validate_choices(&choices)?;
    let (sender,receiver)=tokio::sync::oneshot::channel();
    app.dialog().file().set_title(match kind {
        NativeProfileKindV1::CodexSessions=>"Choose this Codex profile's sessions folder",
        NativeProfileKindV1::ClaudeProjects=>"Choose this Claude Code profile's projects folder",
    }).pick_folder(move|selection|{let _=sender.send(selection);});
    let Some(selection)=receiver.await.map_err(|_|"native profile picker unavailable")? else{return Ok(None);};
    let selected=selection.as_path().map(Path::to_path_buf).ok_or("invalid native profile")?;
    tauri::async_runtime::spawn_blocking(move|| {
        let state=app.state::<AppState>();
        let live=LiveAwarenessOwner::authenticate(&state).map_err(error)?;
        let resident=managed_resident(&app,&resident_pubkey,live.owner())?;
        let device=state.companion_awareness.device(live.owner()).map_err(error)?;
        if !std::fs::symlink_metadata(&selected).is_ok_and(|value|value.is_dir()&&!value.file_type().is_symlink()) {
            return Err("Choose a regular native transcript container on this Mac.".into());
        }
        let root=selected.canonicalize().map_err(|_|"Selected native profile unavailable")?;
        let source=NativeProfileSelectionV1::source_id_for_selection(live.owner(),&resident,&device,&root,kind,class).map_err(error)?;
        let key=AwarenessGrantKeyV1 {source:AwarenessSourceKeyV1 {owner_pubkey:live.owner().clone(),source_id:source,device_id:device},resident_pubkey:resident.clone()};
        let selection=NativeProfileSelectionV1::new(key.clone(),root,kind,class).map_err(error)?;
        state.companion_sources.select_profile(&live,NativeProfileRegistrationV1 {selection,profile_config:None}).map_err(error)?;
        match state.companion_awareness.source_snapshot(live.owner(),&key.source) {
            Ok(_)=>{},Err(AwarenessStoreError::Missing)=>{
                state.companion_awareness.register_source(&live,&key.source,&operation_id(&request_id,"register")?).map_err(error)?;
            },Err(failure)=>return Err(error(failure)),
        }
        let expected=state.companion_awareness.snapshot(live.owner(),&key)
            .map(|value|Some(value.grant.grant_revision))
            .or_else(|failure|if failure==AwarenessStoreError::Missing {Ok(None)}else{Err(failure)}).map_err(error)?;
        put_choices(&state,&live,&key,expected,&choices,&operation_id(&request_id,"grant")?)?;
        projection(&state,live.owner(),&resident).map(Some)
    }).await.map_err(|_|"native profile selection unavailable".to_owned())?
}
fn error(error:AwarenessStoreError)->String {error.to_string()}
