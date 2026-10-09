//! Explicit owner machine-source controls. Saved policy is not permission;
//! these commands do not invoke a model, job, account feed or OS permission UI.
use super::{
    companion::{managed_resident, projection, CompanionAwarenessStatusV1},
    companion_sources::{operation_id, put_choices, validate_choices, CompanionSourceChoicesInputV1},
};
use crate::{app_state::AppState, luca::companion_awareness::{
    machine_activity::{MachineCaptureRequestV1, MachineObservationClassV1},
    machine_catalog::{MachinePolicyCountsV1, MachineSourceSelectionV1},
    AwarenessGrantKeyV1, AwarenessSourceKeyV1, AwarenessStoreError, AwarenessWithdrawalV1, LiveAwarenessOwner,
}};
use luca_protocol::{Hex64, OpaqueId, SafeU53};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Closed owner-selected operational policy, never helper output or a model
/// claim. Class-specific host validation always runs before saving or granting.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompanionMachinePolicyInputV1 {
    class: MachineObservationClassV1,
    allowed_bundle_ids: Vec<String>,
    excluded_bundle_ids: Vec<String>,
    excluded_title_terms: Vec<String>,
    max_text_bytes: usize,
}
impl CompanionMachinePolicyInputV1 {
    fn request(self) -> Result<MachineCaptureRequestV1, String> {
        MachineCaptureRequestV1::new(self.class, self.allowed_bundle_ids, self.excluded_bundle_ids,
            self.excluded_title_terms, self.max_text_bytes).map_err(error)
    }
}

/// Body-free configuration inventory. It does not claim a currently frontmost
/// app, normal/private page, window contents, OS trust or collector availability.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionMachineSourceViewV1 {
    source_id: String,
    class: MachineObservationClassV1,
    scope_summary: &'static str,
    sampling_mode: &'static str,
    policy: MachinePolicyCountsV1,
}
fn view(selection: &MachineSourceSelectionV1) -> Result<CompanionMachineSourceViewV1, String> {
    let (scope_summary, sampling_mode) = match selection.class() {
        MachineObservationClassV1::AppMetadata => ("Only the selected app names; no window or page text.", "metadata_events_after_explicit_resume"),
        MachineObservationClassV1::AccessibilityText => ("Allowed non-browser document windows; OS trust and secure-field checks required.", "explicit_one_shot"),
        MachineObservationClassV1::ScreenText => ("Text from one allowed non-browser window; no screenshot file is saved.", "explicit_one_shot"),
    };
    Ok(CompanionMachineSourceViewV1 { source_id: selection.key().source.source_id.as_str().to_owned(), class: selection.class(),
        scope_summary, sampling_mode, policy: selection.policy_counts().map_err(error)? })
}

/// Inspect only one managed resident's saved policies, including while the
/// keychain is locked. Retained public owner scope never permits collection.
#[tauri::command]
pub async fn list_companion_machine_sources(resident_pubkey: String, app: AppHandle)
    -> Result<Vec<CompanionMachineSourceViewV1>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner = state.companion_awareness.control_owner().ok_or("companion awareness unavailable")?;
        let resident = managed_resident(&app, &resident_pubkey, &owner)?;
        state.companion_sources.list_machines(&owner, &resident).map_err(error)?.iter().map(view).collect()
    }).await.map_err(|_| "machine source inventory unavailable".to_owned())?
}

/// Choose one exact class/policy for one companion. Independent choices are
/// explicit required input, never inferred from saving: observe=false stays
/// OFF. Observation needs a resumed resident and the actor's fresh Live fence.
/// AX/OCR are supported non-browser one-shots; metadata cannot upgrade to them.
#[tauri::command]
pub async fn select_companion_machine_source(resident_pubkey: String, policy: CompanionMachinePolicyInputV1,
    choices: CompanionSourceChoicesInputV1, request_id: String, app: AppHandle)
    -> Result<CompanionAwarenessStatusV1, String> {
    validate_choices(&choices)?;
    let request = policy.request()?; let register = operation_id(&request_id, "register")?; let grant = operation_id(&request_id, "grant")?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let live = LiveAwarenessOwner::authenticate(&state).map_err(error)?;
        let resident = managed_resident(&app, &resident_pubkey, live.owner())?;
        let _ = state.companion_coordinator.foreground_activity(&app);
        let key = AwarenessGrantKeyV1 { source: AwarenessSourceKeyV1 { owner_pubkey: live.owner().clone(),
            device_id: state.companion_awareness.device(live.owner()).map_err(error)?, source_id: request.source_id().map_err(error)? },
            resident_pubkey: resident.clone() };
        state.companion_sources.select_machine(&live, MachineSourceSelectionV1::new(key.clone(), request).map_err(error)?).map_err(error)?;
        match state.companion_awareness.source_snapshot(live.owner(), &key.source) {
            Ok(_) => {},
            Err(AwarenessStoreError::Missing) => { state.companion_awareness.register_source(&live, &key.source, &register).map_err(error)?; },
            Err(failure) => return Err(error(failure)),
        }
        let expected = state.companion_awareness.snapshot(live.owner(), &key).map(|value| Some(value.grant.grant_revision))
            .or_else(|failure| if failure == AwarenessStoreError::Missing { Ok(None) } else { Err(failure) }).map_err(error)?;
        put_choices(&state, &live, &key, expected, &choices, &grant)?;
        projection(&state, live.owner(), &resident)
    }).await.map_err(|_| "machine source selection unavailable".to_owned())?
}

/// Request a fresh sample for one previously selected/granted class. A metadata
/// source owns its exact event stream; a text source samples once. This never
/// unpauses the resident, grants another source, starts jobs or prompts for TCC.
#[tauri::command]
pub async fn resume_companion_machine_source(resident_pubkey: String, source_id: String, app: AppHandle)
    -> Result<CompanionAwarenessStatusV1, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>(); let live = LiveAwarenessOwner::authenticate(&state).map_err(error)?;
        let resident = managed_resident(&app, &resident_pubkey, live.owner())?;
        let source = OpaqueId::parse(source_id).map_err(|_| "invalid machine source")?;
        let key = machine_key(&state, live.owner(), &resident, &source)?;
        let _ = state.companion_coordinator.foreground_activity(&app);
        state.companion_sources.resume_machine(&live, &key).map_err(error)?;
        projection(&state, live.owner(), &resident)
    }).await.map_err(|_| "machine source resume unavailable".to_owned())?
}

/// Narrow only this selected resident's grant and policy while the keychain or
/// model is unavailable. Durable withdrawal precedes metadata removal; neither
/// another companion nor external app-owned work is disabled by this operation.
#[tauri::command]
pub async fn remove_companion_machine_source(resident_pubkey: String, source_id: String, expected_revision: u64,
    request_id: String, app: AppHandle) -> Result<CompanionAwarenessStatusV1, String> {
    let operation = operation_id(&request_id, "withdraw")?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner = state.companion_awareness.control_owner().ok_or("companion awareness unavailable")?;
        let resident = managed_resident(&app, &resident_pubkey, &owner)?;
        let source = OpaqueId::parse(source_id).map_err(|_| "invalid machine source")?;
        let key = machine_key(&state, &owner, &resident, &source)?;
        let _ = state.companion_coordinator.foreground_activity(&app);
        // Narrow the owned reader even if a later durable/config write fails.
        state.companion_sources.after_grant_withdrawal(&owner, &key).map_err(error)?;
        match state.companion_awareness.snapshot(&owner, &key) {
            Ok(_) => {
                let expected = SafeU53::new(expected_revision).map_err(|_| "invalid companion revision")?;
                state.companion_awareness.withdraw_grant(&owner, &key, expected, AwarenessWithdrawalV1::Withdraw, &operation).map_err(error)?;
            }
            Err(AwarenessStoreError::Missing) if expected_revision == 0 => {},
            Err(failure) => return Err(error(failure)),
        }
        state.companion_sources.remove_machine(&owner, &key).map_err(error)?;
        let _ = state.companion_execution.withdraw_grant(&key);
        projection(&state, &owner, &resident)
    }).await.map_err(|_| "machine source removal unavailable".to_owned())?
}

/// Resolve only exact saved host policy for this owner/resident/device. No
/// caller source ID, body or metadata class can fabricate a new source scope.
pub(super) fn machine_key(state: &AppState, owner: &Hex64, resident: &Hex64, source: &OpaqueId)
    -> Result<AwarenessGrantKeyV1, String> {
    state.companion_sources.list_machines(owner, resident).map_err(error)?.into_iter()
        .find(|selection| &selection.key().source.source_id == source).map(|selection| selection.key().clone())
        .ok_or_else(|| "Machine source is not selected for this companion.".to_owned())
}
fn error(error: AwarenessStoreError) -> String { error.to_string() }

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn input(class: &str) -> serde_json::Value {
        json!({"class":class,"allowedBundleIds":["com.apple.TextEdit"],"excludedBundleIds":["com.example.SyntheticExcluded"],
            "excludedTitleTerms":["PRIVATE_POLICY_SENTINEL"],"maxTextBytes":4096})
    }
    #[test]
    fn policy_is_closed_bounded_and_text_never_broadens_metadata_scope() {
        let metadata = serde_json::from_value::<CompanionMachinePolicyInputV1>(input("app_metadata")).unwrap().request().unwrap();
        let text = serde_json::from_value::<CompanionMachinePolicyInputV1>(input("accessibility_text")).unwrap().request().unwrap();
        assert_ne!(metadata.source_id().unwrap(), text.source_id().unwrap());
        for value in [json!("com.apple.Safari"), json!("com.example.UnverifiedEditor")] {
            let mut policy = input("screen_text"); policy["allowedBundleIds"] = json!([value]);
            assert!(serde_json::from_value::<CompanionMachinePolicyInputV1>(policy).unwrap().request().is_err());
        }
        let mut extra = input("app_metadata"); extra["allApps"] = json!(true);
        assert!(serde_json::from_value::<CompanionMachinePolicyInputV1>(extra).is_err());
        assert!(serde_json::from_value::<CompanionMachinePolicyInputV1>(input("future_capture")).is_err());
        for bytes in [0, 16 * 1024 + 1] {
            let mut policy = input("screen_text"); policy["maxTextBytes"] = json!(bytes);
            assert!(serde_json::from_value::<CompanionMachinePolicyInputV1>(policy).unwrap().request().is_err());
        }
    }
    #[test]
    fn list_projection_has_only_counts_and_never_claims_os_or_current_material_access() {
        let request = serde_json::from_value::<CompanionMachinePolicyInputV1>(input("app_metadata")).unwrap().request().unwrap();
        let selection = MachineSourceSelectionV1::new(AwarenessGrantKeyV1 { source: AwarenessSourceKeyV1 {
            owner_pubkey: Hex64::parse("aa".repeat(32)).unwrap(), device_id: OpaqueId::parse("synthetic-device").unwrap(), source_id: request.source_id().unwrap(),
        }, resident_pubkey: Hex64::parse("bb".repeat(32)).unwrap() }, request).unwrap();
        let value = serde_json::to_value(view(&selection).unwrap()).unwrap();
        assert_eq!(value["policy"]["allowedAppCount"], 1);
        assert_eq!(value["policy"]["titleExclusionCount"], 1);
        let encoded = value.to_string();
        for sentinel in ["com.apple.TextEdit", "com.example.SyntheticExcluded", "PRIVATE_POLICY_SENTINEL", "currentWindow", "osTrusted"] { assert!(!encoded.contains(sentinel)); }
        assert!(value.get("enabled").is_none()); assert!(value.get("text").is_none());
    }
}
