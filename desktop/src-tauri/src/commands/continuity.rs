//! Explicit owner controls for the compact encrypted resident handoff.

use luca_protocol::{Hex64, OpaqueId, ResidentContinuityModeV1, ResidentHandoffV1};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::{app_state::AppState, managed_agents::load_managed_agents};

use crate::luca::{
    continuity_jobs,
    continuity_runtime::{
        ResidentHandoffCommitKindV1, ResidentHandoffCommitOutcomeV1,
        ResidentHandoffCommitRequestV1, ResidentHandoffForgetOutcomeV1,
        ResidentHandoffReadOutcomeV1, ResidentHandoffViewV1,
    },
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentHandoffInspectorV1 {
    enabled: bool,
    availability: &'static str,
    handoff: Option<ResidentHandoffBodyV1>,
    job: Option<ResidentHandoffJobV1>,
}

/// Body-free status used by chat and Activity. Handoff plaintext is available
/// only through the explicit inspector command above.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentContinuityActivityV1 {
    enabled: bool,
    availability: &'static str,
    job: Option<ResidentHandoffJobV1>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResidentHandoffBodyV1 {
    summary: String,
    unresolved_threads: Vec<String>,
    commitments: Vec<String>,
    explicit_preferences: Vec<String>,
    source_event_ids: Vec<String>,
    updated_at: String,
    record_id: String,
    lineage_root_id: String,
    revision: u64,
    pinned_owner_correction: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResidentHandoffJobV1 {
    job_id: String,
    state: String,
    last_error_code: Option<String>,
    updated_at: String,
    can_retry: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResidentHandoffCorrectionInputV1 {
    resident_pubkey: String,
    summary: String,
    unresolved_threads: Vec<String>,
    commitments: Vec<String>,
    explicit_preferences: Vec<String>,
}

#[tauri::command]
pub fn get_resident_continuity(
    resident_pubkey: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentHandoffInspectorV1, String> {
    let (owner, resident) = resident_authority(&app, &state, &resident_pubkey)?;
    inspector_projection(&app, &state, &owner, &resident)
}

#[tauri::command]
pub fn get_resident_continuity_activity(
    resident_pubkey: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentContinuityActivityV1, String> {
    let (owner, resident) = resident_authority(&app, &state, &resident_pubkey)?;
    let inspector = inspector_projection(&app, &state, &owner, &resident)?;
    Ok(ResidentContinuityActivityV1 {
        enabled: inspector.enabled,
        availability: inspector.availability,
        job: inspector.job,
    })
}

#[tauri::command]
pub fn set_resident_continuity_enabled(
    resident_pubkey: String,
    enabled: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentHandoffInspectorV1, String> {
    let (owner, resident) = resident_authority(&app, &state, &resident_pubkey)?;
    let mode = if enabled {
        ResidentContinuityModeV1::Enabled
    } else {
        ResidentContinuityModeV1::Disabled
    };
    continuity_jobs::set_continuity_mode(&app, &owner, &resident, mode)?;
    inspector_projection(&app, &state, &owner, &resident)
}

#[tauri::command]
pub fn correct_resident_handoff(
    input: ResidentHandoffCorrectionInputV1,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentHandoffInspectorV1, String> {
    let (owner, resident) = resident_authority(&app, &state, &input.resident_pubkey)?;
    let current = match state.read_resident_handoff(&owner, &resident) {
        ResidentHandoffReadOutcomeV1::Ready(value) => value,
        ResidentHandoffReadOutcomeV1::Empty => return Err("no resident handoff to correct".into()),
        ResidentHandoffReadOutcomeV1::Locked => return Err("continuity is locked".into()),
        ResidentHandoffReadOutcomeV1::Unavailable => {
            return Err("continuity is unavailable".into());
        }
        ResidentHandoffReadOutcomeV1::Invalid => return Err("resident handoff is invalid".into()),
    };
    let Some(source_event_id) = current.handoff.source_event_ids.last().cloned() else {
        return Err("resident handoff has no source event".into());
    };
    let updated_at = continuity_jobs::current_canonical_timestamp()?;
    let handoff = ResidentHandoffV1 {
        summary: input.summary,
        unresolved_threads: input.unresolved_threads,
        commitments: input.commitments,
        explicit_preferences: input.explicit_preferences,
        source_event_ids: current.handoff.source_event_ids,
        updated_at,
    };
    handoff
        .validate()
        .map_err(|_| "invalid resident handoff correction".to_owned())?;
    let request_id = OpaqueId::parse(format!(
        "owner-correction-{}",
        uuid::Uuid::new_v4().simple()
    ))
    .map_err(|_| "create correction identifier".to_owned())?;
    match state.commit_resident_handoff(ResidentHandoffCommitRequestV1 {
        owner_pubkey: owner.clone(),
        resident_pubkey: resident.clone(),
        source_event_id,
        request_id,
        kind: ResidentHandoffCommitKindV1::OwnerCorrection,
        handoff,
    }) {
        ResidentHandoffCommitOutcomeV1::Committed(_) => {}
        ResidentHandoffCommitOutcomeV1::Locked => return Err("continuity is locked".into()),
        ResidentHandoffCommitOutcomeV1::Unavailable => {
            return Err("continuity is unavailable".into());
        }
        ResidentHandoffCommitOutcomeV1::Stale => {
            return Err("handoff changed; reload before correcting it".into());
        }
        ResidentHandoffCommitOutcomeV1::Invalid => {
            return Err("resident handoff correction was rejected".into());
        }
    }
    inspector_projection(&app, &state, &owner, &resident)
}

#[tauri::command]
pub fn forget_resident_handoff(
    resident_pubkey: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentHandoffInspectorV1, String> {
    let (owner, resident) = resident_authority(&app, &state, &resident_pubkey)?;
    continuity_jobs::cancel_active_for_forget(&app, &owner, &resident)?;
    let request_id = OpaqueId::parse(format!("owner-forget-{}", uuid::Uuid::new_v4().simple()))
        .map_err(|_| "create forget identifier".to_owned())?;
    match state.forget_resident_handoff(&owner, &resident, &request_id) {
        ResidentHandoffForgetOutcomeV1::Forgotten(receipt) => {
            let _ = (
                receipt.resident_pubkey,
                receipt.lineage_root_id,
                receipt.purged_revision_count,
                receipt.replayed,
            );
        }
        ResidentHandoffForgetOutcomeV1::Empty => {}
        ResidentHandoffForgetOutcomeV1::Locked => return Err("continuity is locked".into()),
        ResidentHandoffForgetOutcomeV1::Unavailable => {
            return Err("continuity is unavailable".into());
        }
        ResidentHandoffForgetOutcomeV1::Stale => {
            return Err("handoff changed; reload before forgetting it".into());
        }
        ResidentHandoffForgetOutcomeV1::Invalid => {
            return Err("resident handoff forget was rejected".into());
        }
    }
    inspector_projection(&app, &state, &owner, &resident)
}

#[tauri::command]
pub fn retry_resident_handoff(
    resident_pubkey: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentHandoffInspectorV1, String> {
    let (owner, resident) = resident_authority(&app, &state, &resident_pubkey)?;
    if continuity_jobs::retry_latest_failed(&app, &owner, &resident)?.is_none() {
        return Err("no failed resident handoff job is eligible for retry".into());
    }
    inspector_projection(&app, &state, &owner, &resident)
}

fn resident_authority(
    app: &AppHandle,
    state: &AppState,
    resident_pubkey: &str,
) -> Result<(Hex64, Hex64), String> {
    let resident = Hex64::parse(resident_pubkey.trim().to_ascii_lowercase())
        .map_err(|_| "invalid resident identity".to_owned())?;
    let owner = Hex64::parse(state.signing_keys()?.public_key().to_hex())
        .map_err(|_| "invalid owner identity".to_owned())?;
    if resident == owner {
        return Err("owner identity is not a resident handoff namespace".into());
    }
    let exists = load_managed_agents(app)?
        .iter()
        .any(|record| record.pubkey.eq_ignore_ascii_case(resident.as_str()));
    if !exists {
        return Err("resident is not managed by this Luca workspace".into());
    }
    Ok((owner, resident))
}

fn inspector_projection(
    app: &AppHandle,
    state: &AppState,
    owner: &Hex64,
    resident: &Hex64,
) -> Result<ResidentHandoffInspectorV1, String> {
    let mode = continuity_jobs::continuity_mode(app, owner, resident)?;
    let (availability, handoff) = match state.read_resident_handoff(owner, resident) {
        ResidentHandoffReadOutcomeV1::Ready(value) => ("ready", Some(handoff_projection(value))),
        ResidentHandoffReadOutcomeV1::Empty => ("empty", None),
        ResidentHandoffReadOutcomeV1::Locked => ("locked", None),
        ResidentHandoffReadOutcomeV1::Unavailable => ("unavailable", None),
        ResidentHandoffReadOutcomeV1::Invalid => ("invalid", None),
    };
    let job =
        continuity_jobs::latest_job_status(app, owner, resident)?.map(|job| ResidentHandoffJobV1 {
            job_id: job.job_id.as_str().to_owned(),
            state: job.state,
            last_error_code: job.last_error_code,
            updated_at: job.updated_at,
            can_retry: job.can_retry,
        });
    Ok(ResidentHandoffInspectorV1 {
        enabled: mode == ResidentContinuityModeV1::Enabled,
        availability,
        handoff,
        job,
    })
}

fn handoff_projection(value: ResidentHandoffViewV1) -> ResidentHandoffBodyV1 {
    ResidentHandoffBodyV1 {
        summary: value.handoff.summary,
        unresolved_threads: value.handoff.unresolved_threads,
        commitments: value.handoff.commitments,
        explicit_preferences: value.handoff.explicit_preferences,
        source_event_ids: value
            .handoff
            .source_event_ids
            .into_iter()
            .map(|event| event.as_str().to_owned())
            .collect(),
        updated_at: value.handoff.updated_at.as_str().to_owned(),
        record_id: value.record_id.as_str().to_owned(),
        lineage_root_id: value.lineage_root_id.as_str().to_owned(),
        revision: value.revision.get(),
        pinned_owner_correction: value.pinned_owner_correction,
    }
}
