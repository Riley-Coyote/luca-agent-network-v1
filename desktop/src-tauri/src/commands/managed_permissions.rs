use tauri::AppHandle;

#[tauri::command]
pub fn list_pending_managed_permissions(
) -> Result<Vec<crate::luca::managed_permission::PendingManagedPermission>, String> {
    crate::luca::managed_permission::list_pending()
}

#[tauri::command]
pub fn resolve_managed_permission(
    pending_id: String,
    option_id: Option<String>,
    _app: AppHandle,
) -> Result<(), String> {
    crate::luca::managed_permission::resolve(&pending_id, option_id)
}
