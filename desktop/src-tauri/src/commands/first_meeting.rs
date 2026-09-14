/// Start or recover the owner's one fixed first-meeting action with canonical Luca.
#[tauri::command]
pub async fn begin_luca_first_meeting(
    app: tauri::AppHandle,
    channel_id: String,
) -> Result<crate::luca::first_meeting::StartResult, String> {
    crate::luca::first_meeting::begin(&app, &channel_id).await
}
