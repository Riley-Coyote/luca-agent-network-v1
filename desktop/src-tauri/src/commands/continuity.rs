//! Explicit owner controls for the compact encrypted resident handoff.

use luca_protocol::{
    CreateResidentJournalPageRequestV1, Hex64, OpaqueId,
    ResidentContinuityModeV1, ResidentHandoffV1, ResidentJournalAnnotationV1,
    ResidentJournalPageContextV1, ResidentMemoryNoteCategoryV1, ResidentMemoryNoteV1, SafeU53,
    CONTINUITY_PROTOCOL, MAX_CONTINUITY_PACKET_BYTES,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::{app_state::AppState, managed_agents::load_managed_agents};

use crate::luca::{
    continuity_jobs, journal_jobs, managed_cognition,
    continuity_runtime::{
        ResidentHandoffCommitKindV1, ResidentHandoffCommitOutcomeV1,
        ResidentHandoffCommitRequestV1, ResidentHandoffForgetOutcomeV1,
        ResidentHandoffReadOutcomeV1, ResidentHandoffViewV1,
    },
    resident_notebook::{
        ResidentNotebookBodyV1, ResidentNotebookMutationOutcomeV1,
        ResidentNotebookReadOutcomeV1, ResidentNotebookRevisionViewV1,
    },
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
/// Explicit owner-facing projection of one resident's encrypted handoff.
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
/// Owner-authored correction submitted for the effective resident handoff.
pub struct ResidentHandoffCorrectionInputV1 {
    resident_pubkey: String,
    summary: String,
    unresolved_threads: Vec<String>,
    commitments: Vec<String>,
    explicit_preferences: Vec<String>,
}

#[tauri::command]
/// Reads one resident's handoff only after explicit owner disclosure.
pub fn get_resident_continuity(
    resident_pubkey: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentHandoffInspectorV1, String> {
    let (owner, resident) = resident_authority(&app, &state, &resident_pubkey)?;
    inspector_projection(&app, &state, &owner, &resident)
}

#[tauri::command]
/// Returns body-free continuity status suitable for Activity surfaces.
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
/// Enables or disables future handoff generation and injection for a resident.
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
/// Commits a pinned owner-authored successor to the effective handoff.
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
/// Forgets the effective handoff after cancelling active resident work.
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
/// Retries the latest eligible failed handoff cognition job.
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
/// Paginated owner-disclosed notebook list projection.
pub struct ResidentNotebookListV1 {
    availability: &'static str,
    items: Vec<ResidentNotebookItemViewV1>,
    next_cursor: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
/// One notebook item with its complete revision and annotation projections.
pub struct ResidentNotebookDetailV1 {
    availability: &'static str,
    item: Option<ResidentNotebookItemViewV1>,
    revisions: Vec<ResidentNotebookItemViewV1>,
    annotations: Vec<ResidentNotebookItemViewV1>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
/// Decrypted owner-disclosed view of one notebook revision.
pub struct ResidentNotebookItemViewV1 {
    item_id: String,
    lineage_root_id: String,
    kind: &'static str,
    status: &'static str,
    authorship: &'static str,
    revision: u64,
    pinned_owner_correction: bool,
    title: Option<String>,
    body: String,
    category: Option<&'static str>,
    source_event_ids: Vec<String>,
    source_page_ids: Vec<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
/// Body-free status for one manual resident journal cognition job.
pub struct ResidentJournalJobViewV1 {
    job_id: String,
    state: String,
    last_error_code: Option<String>,
    updated_at: String,
    can_cancel: bool,
    can_retry: bool,
}

/// Deterministic backend-owned states for frontend notebook development.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentNotebookFixturesV1 {
    ready: ResidentNotebookListV1,
    empty: ResidentNotebookListV1,
    locked: ResidentNotebookListV1,
    unavailable: ResidentNotebookListV1,
    detail: ResidentNotebookDetailV1,
    jobs: Vec<ResidentJournalJobViewV1>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Owner input for a manual, same-resident journal cognition request.
pub struct CreateResidentJournalPageInputV1 {
    resident_pubkey: String,
    conversation_id: Option<String>,
    owner_prompt: Option<String>,
    #[serde(default)]
    selected_event_ids: Vec<String>,
    #[serde(default)]
    selected_page_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Owner-authored correction for a recall-eligible memory note.
pub struct CorrectResidentMemoryNoteInputV1 {
    resident_pubkey: String,
    target_note_id: String,
    category: String,
    body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Owner annotation submitted for a resident-authored journal lineage.
pub struct AnnotateResidentJournalPageInputV1 {
    resident_pubkey: String,
    page_id: String,
    body: String,
}

#[tauri::command]
/// Lists active notebook items without exposing annotation rows separately.
pub fn list_resident_notebook_items(
    resident_pubkey: String,
    cursor: Option<usize>,
    page_size: Option<usize>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentNotebookListV1, String> {
    let (owner, resident) = resident_authority(&app, &state, &resident_pubkey)?;
    let outcome = state.read_resident_notebook(&owner, &resident, false);
    let (availability, mut items) = notebook_views(outcome)?;
    items.retain(|item| item.kind != "journal_annotation");
    items.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    let start = cursor.unwrap_or(0).min(items.len());
    let count = page_size.unwrap_or(25).clamp(1, 50);
    let end = start.saturating_add(count).min(items.len());
    let next_cursor = (end < items.len()).then_some(end);
    Ok(ResidentNotebookListV1 {
        availability,
        items: items.drain(start..end).collect(),
        next_cursor,
    })
}

#[tauri::command]
/// Reads one notebook item, its revisions, and owner annotations.
pub fn get_resident_notebook_item(
    resident_pubkey: String,
    item_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentNotebookDetailV1, String> {
    notebook_detail(&app, &state, &resident_pubkey, &item_id)
}

#[tauri::command]
/// Reads the complete immutable revision history for one notebook lineage.
pub fn get_resident_notebook_revision_history(
    resident_pubkey: String,
    item_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentNotebookDetailV1, String> {
    notebook_detail(&app, &state, &resident_pubkey, &item_id)
}

#[tauri::command]
/// Starts one manually requested private journal cognition job.
pub fn create_resident_journal_page(
    input: CreateResidentJournalPageInputV1,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentJournalJobViewV1, String> {
    create_journal_job(&app, &state, input, None)
}

#[tauri::command]
/// Asks the same resident to author a successor to an existing journal page.
pub fn request_resident_journal_page_revision(
    input: CreateResidentJournalPageInputV1,
    target_page_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentJournalJobViewV1, String> {
    let detail = notebook_detail(&app, &state, &input.resident_pubkey, &target_page_id)?;
    let target = detail
        .item
        .filter(|item| item.kind == "journal_page")
        .map(|item| item.lineage_root_id)
        .ok_or_else(|| "resident journal page is unavailable".to_owned())?;
    let target = OpaqueId::parse(target)
        .map_err(|_| "invalid resident journal page lineage".to_owned())?;
    create_journal_job(&app, &state, input, Some(target))
}

#[tauri::command]
/// Cancels a journal job unless its encrypted commit has already been claimed.
pub fn cancel_resident_journal_page(
    job_id: String,
    app: AppHandle,
) -> Result<bool, String> {
    let job_id = OpaqueId::parse(job_id).map_err(|_| "invalid journal job identifier".to_owned())?;
    journal_jobs::cancel(&app, &job_id)
}

#[tauri::command]
/// Retries one eligible failed journal job with its original private input.
pub fn retry_resident_journal_page(
    job_id: String,
    app: AppHandle,
) -> Result<bool, String> {
    let job_id = OpaqueId::parse(job_id).map_err(|_| "invalid journal job identifier".to_owned())?;
    journal_jobs::retry(&app, &job_id)
}

#[tauri::command]
/// Returns the resident's latest body-free journal job state.
pub fn get_resident_journal_activity(
    resident_pubkey: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<ResidentJournalJobViewV1>, String> {
    let (owner, resident) = resident_authority(&app, &state, &resident_pubkey)?;
    journal_jobs::latest_status(&app, &owner, &resident).map(|value| value.map(journal_job_view))
}

#[tauri::command]
/// Creates a pinned owner-authored successor for a memory-note lineage.
pub fn correct_resident_memory_note(
    input: CorrectResidentMemoryNoteInputV1,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentNotebookDetailV1, String> {
    let (owner, resident) = resident_authority(&app, &state, &input.resident_pubkey)?;
    let current = notebook_detail(
        &app,
        &state,
        &input.resident_pubkey,
        &input.target_note_id,
    )?
        .item
        .filter(|item| item.kind == "memory_note")
        .ok_or_else(|| "resident memory note is unavailable".to_owned())?;
    let target = OpaqueId::parse(current.lineage_root_id)
        .map_err(|_| "invalid resident memory-note lineage".to_owned())?;
    let category = parse_note_category(&input.category)?;
    let mut source_event_ids = current
        .source_event_ids
        .into_iter()
        .map(|value| Hex64::parse(value.to_ascii_lowercase()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "invalid resident memory-note provenance".to_owned())?;
    source_event_ids.sort();
    source_event_ids.dedup();
    let now = continuity_jobs::current_canonical_timestamp()?;
    let note = ResidentMemoryNoteV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        note_id: OpaqueId::parse(format!("note-correction-{}", uuid::Uuid::new_v4().simple()))
            .map_err(|_| "create memory-note correction identifier".to_owned())?,
        category,
        body: input.body,
        source_event_ids,
        created_at: now.clone(),
        updated_at: now,
    };
    note.validate()
        .map_err(|_| "invalid resident memory-note correction".to_owned())?;
    let request_id = OpaqueId::parse(format!("note-correction-{}", uuid::Uuid::new_v4().simple()))
        .map_err(|_| "create correction request".to_owned())?;
    require_notebook_commit(state.correct_resident_memory_note(
        owner,
        resident,
        target.clone(),
        request_id,
        note,
    ))?;
    notebook_detail(&app, &state, &input.resident_pubkey, target.as_str())
}

#[tauri::command]
/// Pins the current effective memory-note body as an owner correction.
pub fn pin_resident_memory_note(
    resident_pubkey: String,
    note_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentNotebookDetailV1, String> {
    let detail = notebook_detail(&app, &state, &resident_pubkey, &note_id)?;
    let current = detail
        .item
        .as_ref()
        .filter(|item| item.kind == "memory_note")
        .ok_or_else(|| "resident memory note is unavailable".to_owned())?;
    correct_resident_memory_note(
        CorrectResidentMemoryNoteInputV1 {
            resident_pubkey,
            target_note_id: note_id,
            category: current.category.unwrap_or("durable_context").to_owned(),
            body: current.body.clone(),
        },
        app,
        state,
    )
}

#[tauri::command]
/// Adds a separately stored, visibly owner-authored journal annotation.
pub fn annotate_resident_journal_page(
    input: AnnotateResidentJournalPageInputV1,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentNotebookDetailV1, String> {
    let (owner, resident) = resident_authority(&app, &state, &input.resident_pubkey)?;
    let detail = notebook_detail(&app, &state, &input.resident_pubkey, &input.page_id)?;
    let page_id = detail
        .item
        .filter(|item| item.kind == "journal_page")
        .map(|item| item.lineage_root_id)
        .ok_or_else(|| "resident journal page is unavailable".to_owned())?;
    let page_id = OpaqueId::parse(page_id)
        .map_err(|_| "invalid resident journal page lineage".to_owned())?;
    let annotation = ResidentJournalAnnotationV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        annotation_id: OpaqueId::parse(format!("annotation-{}", uuid::Uuid::new_v4().simple()))
            .map_err(|_| "create journal annotation identifier".to_owned())?,
        page_id: page_id.clone(),
        owner_pubkey: owner,
        resident_pubkey: resident,
        body: input.body,
        created_at: continuity_jobs::current_canonical_timestamp()?,
    };
    let request_id = OpaqueId::parse(format!("annotation-{}", uuid::Uuid::new_v4().simple()))
        .map_err(|_| "create journal annotation request".to_owned())?;
    require_notebook_commit(state.annotate_resident_journal_page(request_id, annotation))?;
    notebook_detail(&app, &state, &input.resident_pubkey, page_id.as_str())
}

#[tauri::command]
/// Archives one effective notebook lineage while retaining its revisions.
pub fn archive_resident_notebook_item(
    resident_pubkey: String,
    item_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentNotebookListV1, String> {
    change_notebook_lifecycle(&app, &state, &resident_pubkey, &item_id, false)?;
    list_resident_notebook_items(resident_pubkey, None, None, app, state)
}

#[tauri::command]
/// Forgets one effective notebook lineage under the encrypted lifecycle rules.
pub fn forget_resident_notebook_item(
    resident_pubkey: String,
    item_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentNotebookListV1, String> {
    change_notebook_lifecycle(&app, &state, &resident_pubkey, &item_id, true)?;
    list_resident_notebook_items(resident_pubkey, None, None, app, state)
}

#[tauri::command]
/// Returns deterministic backend-owned fixtures for deferred frontend work.
pub fn get_resident_notebook_fixtures() -> ResidentNotebookFixturesV1 {
    let note = fixture_note();
    let journal = fixture_journal(1, "fixture-journal-v1");
    let journal_revision = fixture_journal(2, "fixture-journal-v2");
    let annotation = fixture_annotation();
    ResidentNotebookFixturesV1 {
        ready: ResidentNotebookListV1 {
            availability: "ready",
            items: vec![
                clone_notebook_item_view(&journal_revision),
                clone_notebook_item_view(&note),
            ],
            next_cursor: None,
        },
        empty: ResidentNotebookListV1 {
            availability: "empty",
            items: Vec::new(),
            next_cursor: None,
        },
        locked: ResidentNotebookListV1 {
            availability: "locked",
            items: Vec::new(),
            next_cursor: None,
        },
        unavailable: ResidentNotebookListV1 {
            availability: "unavailable",
            items: Vec::new(),
            next_cursor: None,
        },
        detail: ResidentNotebookDetailV1 {
            availability: "ready",
            item: Some(clone_notebook_item_view(&journal_revision)),
            revisions: vec![journal, journal_revision],
            annotations: vec![annotation],
        },
        jobs: ["pending", "running", "completed", "cancelled", "failed"]
            .into_iter()
            .map(|state| ResidentJournalJobViewV1 {
                job_id: format!("fixture-journal-{state}"),
                state: state.to_owned(),
                last_error_code: (state == "failed").then(|| "runtime_unavailable".to_owned()),
                updated_at: "2026-08-06T12:10:00Z".into(),
                can_cancel: matches!(state, "pending" | "running"),
                can_retry: state == "failed",
            })
            .collect(),
    }
}

fn fixture_note() -> ResidentNotebookItemViewV1 {
    ResidentNotebookItemViewV1 {
        item_id: "fixture-note".into(),
        lineage_root_id: "fixture-note".into(),
        kind: "memory_note",
        status: "active",
        authorship: "resident",
        revision: 1,
        pinned_owner_correction: false,
        title: None,
        body: "Keep the identity key stable while the runtime changes.".into(),
        category: Some("decision"),
        source_event_ids: vec!["a".repeat(64)],
        source_page_ids: Vec::new(),
        created_at: "2026-08-06T12:00:00Z".into(),
        updated_at: "2026-08-06T12:00:00Z".into(),
    }
}

fn fixture_journal(revision: u64, item_id: &str) -> ResidentNotebookItemViewV1 {
    ResidentNotebookItemViewV1 {
        item_id: item_id.into(),
        lineage_root_id: "fixture-journal".into(),
        kind: "journal_page",
        status: "active",
        authorship: "resident",
        revision,
        pinned_owner_correction: false,
        title: Some("What I want to carry".into()),
        body: format!(
            "# What I want to carry\n\nResident-authored notebook revision {revision}."
        ),
        category: None,
        source_event_ids: vec!["b".repeat(64)],
        source_page_ids: Vec::new(),
        created_at: "2026-08-06T12:05:00Z".into(),
        updated_at: format!("2026-08-06T12:0{}:00Z", 4 + revision),
    }
}

fn fixture_annotation() -> ResidentNotebookItemViewV1 {
    ResidentNotebookItemViewV1 {
        item_id: "fixture-annotation".into(),
        lineage_root_id: "fixture-annotation".into(),
        kind: "journal_annotation",
        status: "active",
        authorship: "owner",
        revision: 1,
        pinned_owner_correction: false,
        title: None,
        body: "Owner annotation: preserve the unresolved question.".into(),
        category: None,
        source_event_ids: Vec::new(),
        source_page_ids: vec!["fixture-journal".into()],
        created_at: "2026-08-06T12:09:00Z".into(),
        updated_at: "2026-08-06T12:09:00Z".into(),
    }
}

fn create_journal_job(
    app: &AppHandle,
    state: &AppState,
    input: CreateResidentJournalPageInputV1,
    target_page_id: Option<OpaqueId>,
) -> Result<ResidentJournalJobViewV1, String> {
    let (owner, resident) = resident_authority(app, state, &input.resident_pubkey)?;
    let binding_ref = managed_cognition::active_binding_ref(&resident)
        .map_err(|_| "resident runtime is not available for journal authorship".to_owned())?;
    let disclosed = match state.read_resident_notebook(&owner, &resident, false) {
        ResidentNotebookReadOutcomeV1::Ready(values) => values,
        ResidentNotebookReadOutcomeV1::Empty => Vec::new(),
        ResidentNotebookReadOutcomeV1::Locked => {
            return Err("resident notebook is locked".to_owned());
        }
        ResidentNotebookReadOutcomeV1::Unavailable => {
            return Err("resident notebook is unavailable".to_owned());
        }
        ResidentNotebookReadOutcomeV1::Invalid => {
            return Err("resident notebook is invalid".to_owned());
        }
    };
    let requested_page_ids = input
        .selected_page_ids
        .into_iter()
        .map(OpaqueId::parse)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "invalid selected journal page".to_owned())?;
    let mut selected_page_ids = requested_page_ids
        .into_iter()
        .map(|requested| {
            disclosed
                .iter()
                .find(|view| {
                    matches!(&view.body, ResidentNotebookBodyV1::JournalPage(_))
                        && (view.record_id == requested || view.lineage_root_id == requested)
                })
                .map(|view| view.lineage_root_id.clone())
                .ok_or_else(|| "one or more selected journal pages are unavailable".to_owned())
        })
        .collect::<Result<Vec<_>, _>>()?;
    if let Some(target) = &target_page_id {
        selected_page_ids.push(target.clone());
    }
    selected_page_ids.sort();
    selected_page_ids.dedup();
    let mut selected_pages = disclosed
        .iter()
        .filter_map(|view| match &view.body {
            ResidentNotebookBodyV1::JournalPage(page)
                if selected_page_ids.binary_search(&view.lineage_root_id).is_ok() =>
            {
                Some(ResidentJournalPageContextV1 {
                    page_id: view.lineage_root_id.clone(),
                    revision: view.revision,
                    title: page.title.clone(),
                    markdown_body: page.markdown_body.clone(),
                })
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    selected_pages.sort_by(|left, right| left.page_id.cmp(&right.page_id));
    if selected_pages.len() != selected_page_ids.len() {
        return Err("one or more selected journal pages are unavailable".to_owned());
    }
    let mut selected_event_ids = input
        .selected_event_ids
        .into_iter()
        .map(|value| Hex64::parse(value.to_ascii_lowercase()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "invalid selected signed event".to_owned())?;
    selected_event_ids.sort();
    selected_event_ids.dedup();
    let conversation_id = input
        .conversation_id
        .map(OpaqueId::parse)
        .transpose()
        .map_err(|_| "invalid journal conversation identifier".to_owned())?;
    let deadline = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        // Match automatic notebook cognition: real native runtimes can require
        // a provider cold start before returning a private, tool-free result.
        .saturating_add(180_000)
        .try_into()
        .ok()
        .and_then(|value| SafeU53::new(value).ok())
        .ok_or_else(|| "create resident journal deadline".to_owned())?;
    let request = CreateResidentJournalPageRequestV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        job_id: OpaqueId::parse(format!("journal-{}", uuid::Uuid::new_v4().simple()))
            .map_err(|_| "create resident journal job identifier".to_owned())?,
        owner_pubkey: owner,
        resident_pubkey: resident,
        binding_ref,
        conversation_id,
        deadline_unix_ms: deadline,
        max_result_bytes: SafeU53::new(MAX_CONTINUITY_PACKET_BYTES as u64)
            .map_err(|_| "create journal result budget".to_owned())?,
        owner_prompt: input.owner_prompt,
        selected_event_ids,
        selected_pages,
    };
    journal_jobs::enqueue(app, request, target_page_id).map(journal_job_view)
}

fn notebook_detail(
    app: &AppHandle,
    state: &AppState,
    resident_pubkey: &str,
    item_id: &str,
) -> Result<ResidentNotebookDetailV1, String> {
    let (owner, resident) = resident_authority(app, state, resident_pubkey)?;
    let target = OpaqueId::parse(item_id.to_owned())
        .map_err(|_| "invalid resident notebook item identifier".to_owned())?;
    let outcome = state.read_resident_notebook(&owner, &resident, true);
    let (availability, views) = notebook_views(outcome)?;
    let target_root = notebook_target_root(&views, target.as_str());
    let mut revisions = views
        .iter()
        .filter(|view| {
            target_root.as_ref() == Some(&view.lineage_root_id)
                && view.kind != "journal_annotation"
        })
        .map(clone_notebook_item_view)
        .collect::<Vec<_>>();
    revisions.sort_by_key(|view| view.revision);
    let item = revisions.last().map(clone_notebook_item_view);
    let annotations = views
        .into_iter()
        .filter(|view| {
            view.kind == "journal_annotation"
                && target_root
                    .as_ref()
                    .is_some_and(|root| view.source_page_ids.contains(root))
        })
        .collect();
    Ok(ResidentNotebookDetailV1 {
        availability,
        item,
        revisions,
        annotations,
    })
}

fn notebook_target_root(
    views: &[ResidentNotebookItemViewV1],
    target: &str,
) -> Option<String> {
    views
        .iter()
        .find(|view| {
            view.kind != "journal_annotation"
                && (view.lineage_root_id == target || view.item_id == target)
        })
        .map(|view| view.lineage_root_id.clone())
}

fn notebook_views(
    outcome: ResidentNotebookReadOutcomeV1,
) -> Result<(&'static str, Vec<ResidentNotebookItemViewV1>), String> {
    match outcome {
        ResidentNotebookReadOutcomeV1::Ready(values) => Ok((
            "ready",
            values.into_iter().map(notebook_item_view).collect(),
        )),
        ResidentNotebookReadOutcomeV1::Empty => Ok(("empty", Vec::new())),
        ResidentNotebookReadOutcomeV1::Locked => Ok(("locked", Vec::new())),
        ResidentNotebookReadOutcomeV1::Unavailable => Ok(("unavailable", Vec::new())),
        ResidentNotebookReadOutcomeV1::Invalid => Err("resident notebook is invalid".to_owned()),
    }
}

fn notebook_item_view(value: ResidentNotebookRevisionViewV1) -> ResidentNotebookItemViewV1 {
    let status = match value.status {
        luca_protocol::ResidentNotebookStatusV1::Active => "active",
        luca_protocol::ResidentNotebookStatusV1::Superseded => "superseded",
        luca_protocol::ResidentNotebookStatusV1::Archived => "archived",
        luca_protocol::ResidentNotebookStatusV1::Forgotten => "forgotten",
    };
    let authorship = if value.author_kind.as_str() == "owner" {
        "owner"
    } else {
        "resident"
    };
    let provenance = value
        .provenance_refs
        .iter()
        .filter_map(|reference| reference.as_str().strip_prefix("sha256:"))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    match value.body {
        ResidentNotebookBodyV1::MemoryNote(note) => ResidentNotebookItemViewV1 {
            item_id: value.record_id.as_str().to_owned(),
            lineage_root_id: value.lineage_root_id.as_str().to_owned(),
            kind: "memory_note",
            status,
            authorship,
            revision: value.revision.get(),
            pinned_owner_correction: value.pinned_owner_correction,
            title: None,
            body: note.body,
            category: Some(note_category_name(note.category)),
            source_event_ids: note
                .source_event_ids
                .into_iter()
                .map(|value| value.as_str().to_owned())
                .collect(),
            source_page_ids: Vec::new(),
            created_at: note.created_at.as_str().to_owned(),
            updated_at: note.updated_at.as_str().to_owned(),
        },
        ResidentNotebookBodyV1::JournalPage(page) => ResidentNotebookItemViewV1 {
            item_id: value.record_id.as_str().to_owned(),
            lineage_root_id: value.lineage_root_id.as_str().to_owned(),
            kind: "journal_page",
            status,
            authorship,
            revision: value.revision.get(),
            pinned_owner_correction: false,
            title: Some(page.title),
            body: page.markdown_body,
            category: None,
            source_event_ids: page
                .source_event_ids
                .into_iter()
                .map(|value| value.as_str().to_owned())
                .collect(),
            source_page_ids: page
                .source_page_ids
                .into_iter()
                .map(|value| value.as_str().to_owned())
                .collect(),
            created_at: page.created_at.as_str().to_owned(),
            updated_at: page.updated_at.as_str().to_owned(),
        },
        ResidentNotebookBodyV1::JournalAnnotation(annotation) => {
            ResidentNotebookItemViewV1 {
                item_id: value.record_id.as_str().to_owned(),
                lineage_root_id: value.lineage_root_id.as_str().to_owned(),
                kind: "journal_annotation",
                status,
                authorship: "owner",
                revision: value.revision.get(),
                pinned_owner_correction: false,
                title: None,
                body: annotation.body,
                category: None,
                source_event_ids: provenance,
                source_page_ids: vec![annotation.page_id.as_str().to_owned()],
                created_at: annotation.created_at.as_str().to_owned(),
                updated_at: annotation.created_at.as_str().to_owned(),
            }
        }
    }
}

fn clone_notebook_item_view(value: &ResidentNotebookItemViewV1) -> ResidentNotebookItemViewV1 {
    ResidentNotebookItemViewV1 {
        item_id: value.item_id.clone(),
        lineage_root_id: value.lineage_root_id.clone(),
        kind: value.kind,
        status: value.status,
        authorship: value.authorship,
        revision: value.revision,
        pinned_owner_correction: value.pinned_owner_correction,
        title: value.title.clone(),
        body: value.body.clone(),
        category: value.category,
        source_event_ids: value.source_event_ids.clone(),
        source_page_ids: value.source_page_ids.clone(),
        created_at: value.created_at.clone(),
        updated_at: value.updated_at.clone(),
    }
}

fn change_notebook_lifecycle(
    app: &AppHandle,
    state: &AppState,
    resident_pubkey: &str,
    item_id: &str,
    forget: bool,
) -> Result<(), String> {
    let (owner, resident) = resident_authority(app, state, resident_pubkey)?;
    let item_id = notebook_detail(app, state, resident_pubkey, item_id)?
        .item
        .map(|item| item.lineage_root_id)
        .ok_or_else(|| "resident notebook item is unavailable".to_owned())?;
    let item_id = OpaqueId::parse(item_id)
        .map_err(|_| "invalid resident notebook item lineage".to_owned())?;
    let request_id = OpaqueId::parse(format!("notebook-lifecycle-{}", uuid::Uuid::new_v4().simple()))
        .map_err(|_| "create notebook lifecycle request".to_owned())?;
    require_notebook_commit(state.change_resident_notebook_lifecycle(
        &owner,
        &resident,
        &item_id,
        &request_id,
        forget,
    ))
}

fn require_notebook_commit(outcome: ResidentNotebookMutationOutcomeV1) -> Result<(), String> {
    match outcome {
        ResidentNotebookMutationOutcomeV1::Committed(receipt) => {
            let _ = (
                receipt.resident_pubkey,
                receipt.lineage_root_id,
                receipt.record_id,
                receipt.revision,
                receipt.replayed,
            );
            Ok(())
        }
        ResidentNotebookMutationOutcomeV1::Empty => Err("resident notebook item is empty".into()),
        ResidentNotebookMutationOutcomeV1::Locked => Err("resident notebook is locked".into()),
        ResidentNotebookMutationOutcomeV1::Unavailable => {
            Err("resident notebook is unavailable".into())
        }
        ResidentNotebookMutationOutcomeV1::Stale => {
            Err("resident notebook changed; reload and try again".into())
        }
        ResidentNotebookMutationOutcomeV1::Invalid => {
            Err("resident notebook mutation was rejected".into())
        }
    }
}

fn journal_job_view(value: journal_jobs::ResidentJournalJobStatusV1) -> ResidentJournalJobViewV1 {
    ResidentJournalJobViewV1 {
        job_id: value.job_id.as_str().to_owned(),
        state: value.state,
        last_error_code: value.last_error_code,
        updated_at: value.updated_at,
        can_cancel: value.can_cancel,
        can_retry: value.can_retry,
    }
}

fn parse_note_category(value: &str) -> Result<ResidentMemoryNoteCategoryV1, String> {
    match value {
        "decision" => Ok(ResidentMemoryNoteCategoryV1::Decision),
        "durable_context" => Ok(ResidentMemoryNoteCategoryV1::DurableContext),
        "lesson" => Ok(ResidentMemoryNoteCategoryV1::Lesson),
        "explicit_preference" => Ok(ResidentMemoryNoteCategoryV1::ExplicitPreference),
        "commitment" => Ok(ResidentMemoryNoteCategoryV1::Commitment),
        "open_question" => Ok(ResidentMemoryNoteCategoryV1::OpenQuestion),
        _ => Err("invalid resident memory-note category".to_owned()),
    }
}

fn note_category_name(value: ResidentMemoryNoteCategoryV1) -> &'static str {
    match value {
        ResidentMemoryNoteCategoryV1::Decision => "decision",
        ResidentMemoryNoteCategoryV1::DurableContext => "durable_context",
        ResidentMemoryNoteCategoryV1::Lesson => "lesson",
        ResidentMemoryNoteCategoryV1::ExplicitPreference => "explicit_preference",
        ResidentMemoryNoteCategoryV1::Commitment => "commitment",
        ResidentMemoryNoteCategoryV1::OpenQuestion => "open_question",
    }
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

#[cfg(test)]
mod notebook_contract_tests {
    use super::*;

    #[test]
    fn fixture_bundle_covers_owner_facing_terminal_states() {
        let fixtures = get_resident_notebook_fixtures();
        assert_eq!(fixtures.ready.availability, "ready");
        assert_eq!(fixtures.empty.availability, "empty");
        assert_eq!(fixtures.locked.availability, "locked");
        assert_eq!(fixtures.unavailable.availability, "unavailable");
        assert_eq!(fixtures.jobs.len(), 5);
        assert!(fixtures.jobs.iter().any(|job| job.state == "failed"));
        assert_eq!(fixtures.detail.revisions.len(), 2);
        assert_eq!(fixtures.detail.annotations.len(), 1);
    }

    #[test]
    fn detail_target_accepts_head_record_or_stable_lineage_id() {
        let views = vec![fixture_journal(1, "page-v1"), fixture_journal(2, "page-v2")];
        assert_eq!(
            notebook_target_root(&views, "page-v2").as_deref(),
            Some("fixture-journal")
        );
        assert_eq!(
            notebook_target_root(&views, "fixture-journal").as_deref(),
            Some("fixture-journal")
        );
    }
}
