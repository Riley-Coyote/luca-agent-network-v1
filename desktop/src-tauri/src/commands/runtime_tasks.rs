use tauri::AppHandle;

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

#[tauri::command]
pub fn get_runtime_task_result(
    app: AppHandle,
    task_id: String,
) -> Result<crate::luca::runtime_tasks::RuntimeTaskResultV1, String> {
    crate::luca::runtime_tasks::get_runtime_task_result(app, task_id)
}

#[tauri::command]
pub fn list_runtime_task_proposals(
    conversation_id: String,
) -> Result<Vec<crate::luca::runtime_tasks::RuntimeTaskProposalV1>, String> {
    crate::luca::runtime_tasks::list_runtime_task_proposals(conversation_id)
}

#[tauri::command]
pub fn respond_runtime_task_proposal(
    app: AppHandle,
    input: crate::luca::runtime_tasks::RespondRuntimeTaskProposalInputV1,
) -> Result<(), String> {
    crate::luca::runtime_tasks::respond_runtime_task_proposal(app, input)
}
