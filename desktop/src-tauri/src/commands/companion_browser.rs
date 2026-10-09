//! Explicit human browser setup/control. No renderer owner/device/path/native
//! binding selector exists; all filesystem/actor work runs off the UI thread.
use std::path::{Path,PathBuf};
use luca_protocol::{OpaqueId,Sha256Ref,SafeU53};
use serde::Serialize;
use tauri::{AppHandle,Manager};
use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
use super::{companion::{managed_resident,projection,CompanionAwarenessStatusV1},companion_sources::{CompanionSourceChoicesInputV1,validate_choices,put_choices,operation_id}};
use crate::{app_state::AppState,luca::companion_awareness::{
    browser_bridge::{BrowserEventKindV1,BrowserBridgeError},
    browser_configuration::{BrowserInstallActorV1,BrowserInstallReceiptV1,BrowserSitePolicyV1,BrowserSupportedKindV1},
    browser_runtime::BrowserPairControlV1,LiveAwarenessOwner,AwarenessGrantKeyV1,AwarenessStoreError,
}};

/// Body-free native-picker result, not a reusable filesystem or capture grant.
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct CompanionBrowserInstallSelectionV1 {selection_id:String,browser:BrowserSupportedKindV1,profile_name:String,existing_manifest_ref:Option<String>}
/// UI-only one-time pairing code; deliberately no Debug/log/context encoding.
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct CompanionBrowserPairApprovalV1 {code:String,expires_in_seconds:u64}

#[tauri::command]
pub async fn list_companion_browser_profiles(resident_pubkey:String,app:AppHandle)->Result<Vec<BrowserPairControlV1>,String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<AppState>();let owner=state.companion_awareness.control_owner().ok_or("browser awareness unavailable")?;
        let resident=managed_resident(&app,&resident_pubkey,&owner)?;state.companion_browser.list(&owner,&resident).map_err(error)
    }).await.map_err(|_|"browser inventory unavailable".to_owned())?
}

/// No path args. The actual human-selected Default/Profile N directory is the
/// sole authority for a short-lived host actor; no profile/body enumeration.
#[tauri::command]
pub async fn pick_companion_browser_native_host(resident_pubkey:String,browser:BrowserSupportedKindV1,app:AppHandle)
    -> Result<Option<CompanionBrowserInstallSelectionV1>,String> {
    let validate_app=app.clone();let validate_resident=resident_pubkey.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state=validate_app.state::<AppState>();let live=LiveAwarenessOwner::authenticate(&state).map_err(awareness_error)?;
        managed_resident(&validate_app,&validate_resident,live.owner()).map(|_|())
    }).await.map_err(|_|"browser selection unavailable".to_owned())??;
    let (sender,receiver)=tokio::sync::oneshot::channel();
    app.dialog().file().set_title("Choose the private browser profile folder: Default or Profile N")
        .pick_folder(move |selection|{let _=sender.send(selection);});
    let Some(selection)=receiver.await.map_err(|_|"browser picker unavailable")? else {return Ok(None);};
    let path=selection.as_path().map(Path::to_path_buf).ok_or("invalid browser selection")?;
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<AppState>();let live=LiveAwarenessOwner::authenticate(&state).map_err(awareness_error)?;
        let resident=managed_resident(&app,&resident_pubkey,live.owner())?;
        let (user_data,profile_name)=picked_profile(&path)?;
        let selected=BrowserInstallActorV1::select(&live,&state.companion_awareness,browser,user_data,profile_name.clone()).map_err(error)?;
        let existing=selected.existing_manifest_ref().map_err(error)?;
        let selection=state.companion_browser.remember_install_selection(&live,&resident,selected).map_err(error)?;
        Ok(Some(CompanionBrowserInstallSelectionV1 {selection_id:selection.as_str().into(),browser,profile_name,existing_manifest_ref:existing.map(|r|r.as_str().into())}))
    }).await.map_err(|_|"browser selection unavailable".to_owned())?
}

/// Explicit UI install only. An existing fixed host registration requires both
/// exact SHA confirmation and a native human Yes/No confirmation callback.
#[tauri::command]
pub async fn install_companion_browser_native_host(resident_pubkey:String,selection_id:String,confirmed_existing_ref:Option<String>,app:AppHandle)
    -> Result<Option<BrowserInstallReceiptV1>,String> {
    let confirmed=confirmed_existing_ref.map(Sha256Ref::parse).transpose().map_err(|_|"invalid manifest confirmation")?;
    let validate_app=app.clone();let validate_resident=resident_pubkey.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state=validate_app.state::<AppState>();let live=LiveAwarenessOwner::authenticate(&state).map_err(awareness_error)?;
        managed_resident(&validate_app,&validate_resident,live.owner()).map(|_|())
    }).await.map_err(|_|"browser install authority unavailable".to_owned())??;
    if let Some(ref fingerprint)=confirmed {
        let (sender,receiver)=tokio::sync::oneshot::channel();
        app.dialog().message(format!("Replace only the existing Polyphonic browser native-host registration with fingerprint {}? Other native-host registrations will stay unchanged.",fingerprint.as_str()))
            .title("Confirm browser native-host replacement").buttons(MessageDialogButtons::YesNo).show(move |yes|{let _=sender.send(yes);});
        if !receiver.await.map_err(|_|"browser confirmation unavailable")? {return Ok(None);}
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<AppState>();let live=LiveAwarenessOwner::authenticate(&state).map_err(awareness_error)?;
        let resident=managed_resident(&app,&resident_pubkey,live.owner())?;
        state.companion_browser.install_selected(&live,&resident,&identifier(&selection_id)?,confirmed).map(Some).map_err(error)
    }).await.map_err(|_|"browser installation unavailable".to_owned())?
}

/// Explicit code approval starts metadata transport, not observation/capture.
#[tauri::command]
pub async fn approve_companion_browser_pairing(resident_pubkey:String,allowed_origins:Vec<String>,excluded_origins:Vec<String>,app:AppHandle)
    -> Result<CompanionBrowserPairApprovalV1,String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<AppState>();let live=LiveAwarenessOwner::authenticate(&state).map_err(awareness_error)?;
        let resident=managed_resident(&app,&resident_pubkey,live.owner())?;
        let policy=BrowserSitePolicyV1::new(allowed_origins,excluded_origins).map_err(error)?;
        let approval=state.companion_browser.approve_pair(&live,&resident,policy).map_err(error)?;
        Ok(CompanionBrowserPairApprovalV1 {code:approval.code,expires_in_seconds:approval.expires_in_seconds})
    }).await.map_err(|_|"browser pairing unavailable".to_owned())?
}

/// Grant exactly one host-resolved paired class; Chrome permission/pairing alone
/// grants no observe/retention/promotion/egress. Native history consent is pending.
#[tauri::command]
pub async fn set_companion_browser_source_choices(resident_pubkey:String,profile_instance_id:String,kind:BrowserEventKindV1,
    expected_revision:Option<u64>,choices:CompanionSourceChoicesInputV1,request_id:String,app:AppHandle)->Result<CompanionAwarenessStatusV1,String> {
    validate_choices(&choices)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<AppState>();let live=LiveAwarenessOwner::authenticate(&state).map_err(awareness_error)?;
        let resident=managed_resident(&app,&resident_pubkey,live.owner())?;
        let profile=identifier(&profile_instance_id)?;
        let pairing=state.companion_browser.list(live.owner(),&resident).map_err(error)?.into_iter()
            .find(|p|p.profile_instance_id==profile&&p.enabled).ok_or("browser profile is not paired to this companion")?;
        let index=match kind {BrowserEventKindV1::Visit=>0,BrowserEventKindV1::Bookmark=>1,BrowserEventKindV1::Excerpt=>2};
        let key=pairing.source_keys.get(index).ok_or("browser source unavailable")?;
        let expected=expected_revision.map(SafeU53::new).transpose().map_err(|_|"invalid companion revision")?;
        put_choices(&state,&live,key,expected,&choices,&operation_id(&request_id,"browser-grant")?)?;
        projection(&state,live.owner(),&resident)
    }).await.map_err(|_|"browser source controls unavailable".to_owned())?
}

/// Explicit Resume of one current paired class after Observe is already granted.
#[tauri::command]
pub async fn resume_companion_browser_source(resident_pubkey:String,source_id:String,app:AppHandle)->Result<CompanionAwarenessStatusV1,String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<AppState>();let live=LiveAwarenessOwner::authenticate(&state).map_err(awareness_error)?;
        let resident=managed_resident(&app,&resident_pubkey,live.owner())?;
        let key=browser_key(&state,live.owner(),&resident,&identifier(&source_id)?)?;
        state.companion_browser.resume_source(&live,&key).map_err(error)?;projection(&state,live.owner(),&resident)
    }).await.map_err(|_|"browser Resume unavailable".to_owned())?
}
#[tauri::command]
pub async fn disconnect_companion_browser_profile(resident_pubkey:String,profile_instance_id:String,app:AppHandle)->Result<CompanionAwarenessStatusV1,String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<AppState>();let owner=state.companion_awareness.control_owner().ok_or("browser controls unavailable")?;
        let resident=managed_resident(&app,&resident_pubkey,&owner)?;
        state.companion_browser.disconnect(&state,&owner,&resident,&identifier(&profile_instance_id)?).map_err(error)?;
        projection(&state,&owner,&resident)
    }).await.map_err(|_|"browser disconnect unavailable".to_owned())?
}
pub(super) fn browser_key(state:&AppState,owner:&luca_protocol::Hex64,resident:&luca_protocol::Hex64,source:&OpaqueId)->Result<AwarenessGrantKeyV1,String> {
    state.companion_browser.list(owner,resident).map_err(error)?.into_iter().filter(|p|p.enabled).flat_map(|p|p.source_keys)
        .find(|key|&key.source.source_id==source).ok_or_else(||"browser source is not paired to this companion".into())
}
fn picked_profile(path:&Path)->Result<(PathBuf,String),String> {
    let canonical=path.canonicalize().map_err(|_|"browser profile unavailable")?;
    if canonical!=path || canonical.starts_with("/Volumes") || !std::fs::symlink_metadata(path).is_ok_and(|m|m.is_dir()&&!m.file_type().is_symlink()) {return Err("Choose a private canonical browser profile on the internal disk.".into());}
    let profile=canonical.file_name().and_then(|v|v.to_str()).ok_or("invalid browser profile")?;
    if !(profile=="Default" || profile.strip_prefix("Profile ").is_some_and(|n|!n.is_empty()&&n.bytes().all(|b|b.is_ascii_digit()))) {return Err("Choose the actual Default or Profile N folder; no arbitrary root directory is accepted.".into());}
    Ok((canonical.parent().ok_or("invalid browser profile")?.to_owned(),profile.into()))
}
fn identifier(s:&str)->Result<OpaqueId,String> {OpaqueId::parse(s).map_err(|_|"invalid browser identifier".into())}
fn error(error:BrowserBridgeError)->String {error.to_string()}
fn awareness_error(error:AwarenessStoreError)->String {error.to_string()}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn raw_retention_and_origin_wildcards_never_become_browser_grants() {
        assert!(BrowserSitePolicyV1::new(vec!["https://*.example.test".into()],vec![]).is_err());
        assert!(validate_choices(&CompanionSourceChoicesInputV1 {observe:true,promote:false,provider_egress:false,retain_raw:true}).is_err());
    }
}
