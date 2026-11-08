use tauri::AppHandle;

/// Owner-only metadata catalogue; never grants a resident access or starts work.
#[tauri::command]
pub async fn list_harness_sessions(
    app: AppHandle,
    runtime_family: String,
    conversation_id: String,
    resident_pubkey: String,
) -> Result<crate::luca::runtime_tasks::HarnessSessionListV1, String> {
    crate::luca::runtime_tasks::list_harness_sessions(
        app,
        runtime_family,
        conversation_id,
        resident_pubkey,
    )
    .await
}

/// A selected, bounded transcript read in the owner's local dashboard only.
#[tauri::command]
pub async fn get_harness_session(
    app: AppHandle,
    input: crate::luca::runtime_tasks::GetHarnessSessionInputV1,
) -> Result<crate::luca::runtime_tasks::HarnessSessionDetailV1, String> {
    crate::luca::runtime_tasks::get_harness_session(app, input).await
}

#[tauri::command]
pub fn retry_runtime_task_delivery(
    app: AppHandle,
    task_id: String,
) -> Result<crate::luca::runtime_tasks::RuntimeTaskProjectionV1, String> {
    crate::luca::runtime_tasks::retry_runtime_task_delivery(app, task_id)
}

#[tauri::command]
pub fn open_runtime_task_native_session(app: AppHandle, task_id: String) -> Result<(), String> {
    crate::luca::runtime_tasks::open_runtime_task_native_session(app, task_id)
}

#[tauri::command]
pub async fn pick_runtime_task_folder(app: AppHandle) -> Result<Option<String>, String> {
    crate::luca::runtime_tasks::pick_runtime_task_folder(app).await
}

#[tauri::command]
pub fn resolve_runtime_task_project_folder(
    app: AppHandle,
    source_ids: Vec<String>,
) -> Result<Option<String>, String> {
    crate::luca::runtime_tasks::resolve_runtime_task_project_folder(app, source_ids)
}

#[tauri::command]
pub async fn start_runtime_task(
    app: AppHandle,
    input: crate::luca::runtime_tasks::StartRuntimeTaskInputV1,
) -> Result<crate::luca::runtime_tasks::RuntimeTaskProjectionV1, String> {
    crate::luca::runtime_tasks::start_runtime_task(app, input).await
}

#[tauri::command]
pub async fn cancel_runtime_task(
    app: AppHandle,
    task_id: String,
) -> Result<crate::luca::runtime_tasks::RuntimeTaskProjectionV1, String> {
    crate::luca::runtime_tasks::cancel_runtime_task(app, task_id).await
}

#[tauri::command]
pub async fn retry_runtime_task(
    app: AppHandle,
    task_id: String,
) -> Result<crate::luca::runtime_tasks::RuntimeTaskProjectionV1, String> {
    crate::luca::runtime_tasks::retry_runtime_task(app, task_id).await
}

#[tauri::command]
pub fn list_runtime_tasks(
    app: AppHandle,
    conversation_id: String,
) -> Result<Vec<crate::luca::runtime_tasks::RuntimeTaskProjectionV1>, String> {
    crate::luca::runtime_tasks::list_runtime_tasks(app, conversation_id)
}

/// Every conversation's runtime tasks, newest first (WP-14).
#[tauri::command]
pub fn list_all_runtime_tasks(
    app: AppHandle,
) -> Result<Vec<crate::luca::runtime_tasks::RuntimeTaskProjectionV1>, String> {
    crate::luca::runtime_tasks::list_all_runtime_tasks(app)
}

#[tauri::command]
pub fn get_runtime_task_result(
    app: AppHandle,
    task_id: String,
) -> Result<crate::luca::runtime_tasks::RuntimeTaskResultV1, String> {
    crate::luca::runtime_tasks::get_runtime_task_result(app, task_id)
}

#[tauri::command]
pub fn list_runtime_task_proposals(
    app: AppHandle,
    conversation_id: String,
) -> Result<Vec<crate::luca::runtime_tasks::RuntimeTaskProposalV1>, String> {
    crate::luca::runtime_tasks::list_runtime_task_proposals(app, conversation_id)
}

/// Every conversation's open runtime-task proposals (WP-14).
#[tauri::command]
pub fn list_all_runtime_task_proposals(
    app: AppHandle,
) -> Result<Vec<crate::luca::runtime_tasks::RuntimeTaskProposalV1>, String> {
    crate::luca::runtime_tasks::list_all_runtime_task_proposals(app)
}

#[tauri::command]
pub fn respond_runtime_task_proposal(
    app: AppHandle,
    input: crate::luca::runtime_tasks::RespondRuntimeTaskProposalInputV1,
) -> Result<(), String> {
    crate::luca::runtime_tasks::respond_runtime_task_proposal(app, input)
}
