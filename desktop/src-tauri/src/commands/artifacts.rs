//! Owner-facing artifact Library commands.
//!
//! Every command derives owner scope from the active signable identity. IPC
//! responses contain no absolute paths, source-root handles, blob paths, or
//! artifact bytes except for an explicitly selected bounded preview.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use luca_protocol::{
    ArtifactCreateArgsV1, ArtifactKindV1, ArtifactReadModeV1, ArtifactSourceV1, Hex64, OpaqueId,
    SafeU53, MAX_ARTIFACT_LIST_ITEMS, MAX_ARTIFACT_TITLE_CHARS,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::{
    app_state::AppState,
    luca::artifacts::{
        ArtifactCommit, ArtifactPreviewRecord, ArtifactReceiptRecord, ArtifactRecord,
        ArtifactStore, ArtifactVersionRecord, ArtifactWriteContext,
    },
};

const ARTIFACTS_CHANGED_EVENT: &str = "luca://artifacts-changed";
const MAX_RENDERER_BINARY_PREVIEW_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListArtifactsInputV1 {
    #[serde(default)]
    include_deleted: bool,
    #[serde(default = "default_limit")]
    limit: u16,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactIdInputV1 {
    artifact_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactPreviewInputV1 {
    artifact_id: String,
    version: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportArtifactInputV1 {
    kind: Option<ArtifactKindV1>,
    title: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PinArtifactInputV1 {
    artifact_id: String,
    pinned: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevertArtifactInputV1 {
    artifact_id: String,
    source_version: u64,
    expected_current_version: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListArtifactReceiptsInputV1 {
    conversation_id: Option<String>,
    #[serde(default = "default_limit")]
    limit: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactCommitViewV1 {
    artifact: ArtifactRecord,
    version: ArtifactVersionRecord,
    receipt: ArtifactReceiptRecord,
    duplicate: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "previewType", rename_all = "snake_case")]
pub enum ArtifactPreviewViewV1 {
    Text {
        artifact: ArtifactRecord,
        version: ArtifactVersionRecord,
        content_utf8: String,
        truncated: bool,
    },
    Binary {
        artifact: ArtifactRecord,
        version: ArtifactVersionRecord,
        content_base64: String,
    },
    App {
        artifact: ArtifactRecord,
        version: ArtifactVersionRecord,
    },
    Unsupported {
        artifact: ArtifactRecord,
        version: ArtifactVersionRecord,
        reason: &'static str,
    },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactsChangedEventV1<'a> {
    artifact_id: &'a str,
    reason: &'a str,
}

fn default_limit() -> u16 {
    MAX_ARTIFACT_LIST_ITEMS
}

fn owner_pubkey(state: &AppState) -> Result<Hex64, String> {
    Hex64::parse(state.signing_keys()?.public_key().to_hex())
        .map_err(|_| "artifact-owner-invalid".to_owned())
}

fn artifact_id(value: String) -> Result<OpaqueId, String> {
    OpaqueId::parse(value).map_err(|_| "artifact-invalid".to_owned())
}

fn safe_version(value: u64) -> Result<SafeU53, String> {
    let version = SafeU53::new(value).map_err(|_| "artifact-invalid".to_owned())?;
    if version.get() == 0 {
        return Err("artifact-invalid".into());
    }
    Ok(version)
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|_| "artifact-unavailable".to_owned())
}

fn open_store(app: &AppHandle) -> Result<ArtifactStore, String> {
    ArtifactStore::open(&app_data_dir(app)?).map_err(|error| error.code().to_owned())
}

fn emit_changed(app: &AppHandle, artifact_id: &str, reason: &str) {
    let _ = app.emit(
        ARTIFACTS_CHANGED_EVENT,
        ArtifactsChangedEventV1 {
            artifact_id,
            reason,
        },
    );
}

async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| "artifact-unavailable".to_owned())?
}

#[tauri::command]
pub async fn list_artifacts(
    input: ListArtifactsInputV1,
    app: AppHandle,
) -> Result<Vec<ArtifactRecord>, String> {
    blocking(move || {
        let owner = owner_pubkey(&app.state::<AppState>())?;
        open_store(&app)?
            .list(&owner, input.include_deleted, input.limit)
            .map_err(|error| error.code().to_owned())
    })
    .await
}

#[tauri::command]
pub async fn get_artifact(
    input: ArtifactIdInputV1,
    app: AppHandle,
) -> Result<ArtifactRecord, String> {
    blocking(move || {
        let owner = owner_pubkey(&app.state::<AppState>())?;
        open_store(&app)?
            .get(&owner, &artifact_id(input.artifact_id)?)
            .map_err(|error| error.code().to_owned())
    })
    .await
}

#[tauri::command]
pub async fn list_artifact_versions(
    input: ArtifactIdInputV1,
    app: AppHandle,
) -> Result<Vec<ArtifactVersionRecord>, String> {
    blocking(move || {
        let owner = owner_pubkey(&app.state::<AppState>())?;
        open_store(&app)?
            .versions(&owner, &artifact_id(input.artifact_id)?)
            .map_err(|error| error.code().to_owned())
    })
    .await
}

#[tauri::command]
pub async fn read_artifact_preview(
    input: ArtifactPreviewInputV1,
    app: AppHandle,
) -> Result<ArtifactPreviewViewV1, String> {
    blocking(move || {
        let owner = owner_pubkey(&app.state::<AppState>())?;
        let id = artifact_id(input.artifact_id)?;
        let version = input.version.map(safe_version).transpose()?;
        let store = open_store(&app)?;
        let metadata = store
            .read(&owner, &id, version, ArtifactReadModeV1::Metadata)
            .map_err(|error| error.code().to_owned())?;
        if metadata.artifact.kind == ArtifactKindV1::App {
            return Ok(ArtifactPreviewViewV1::App {
                artifact: metadata.artifact,
                version: metadata.version,
            });
        }
        if metadata.version.media_type.starts_with("text/")
            || metadata.version.media_type == "image/svg+xml"
        {
            let preview = store
                .read(&owner, &id, version, ArtifactReadModeV1::BoundedText)
                .map_err(|error| error.code().to_owned())?;
            return text_preview(preview);
        }
        if metadata.version.size_bytes > MAX_RENDERER_BINARY_PREVIEW_BYTES {
            return Ok(ArtifactPreviewViewV1::Unsupported {
                artifact: metadata.artifact,
                version: metadata.version,
                reason: "preview_too_large",
            });
        }
        let preview = store
            .read_binary(&owner, &id, version)
            .map_err(|error| error.code().to_owned())?;
        let content = preview
            .content
            .ok_or_else(|| "artifact-blob-corrupt".to_owned())?;
        Ok(ArtifactPreviewViewV1::Binary {
            artifact: preview.artifact,
            version: preview.version,
            content_base64: base64::engine::general_purpose::STANDARD.encode(content),
        })
    })
    .await
}

fn text_preview(preview: ArtifactPreviewRecord) -> Result<ArtifactPreviewViewV1, String> {
    let content = preview
        .content
        .ok_or_else(|| "artifact-blob-corrupt".to_owned())?;
    let content_utf8 =
        String::from_utf8(content).map_err(|_| "artifact-blob-corrupt".to_owned())?;
    Ok(ArtifactPreviewViewV1::Text {
        artifact: preview.artifact,
        version: preview.version,
        content_utf8,
        truncated: preview.truncated,
    })
}

#[tauri::command]
pub async fn import_artifact_from_picker(
    input: ImportArtifactInputV1,
    app: AppHandle,
) -> Result<Option<ArtifactCommitViewV1>, String> {
    if input.title.as_ref().is_some_and(|title| {
        title.trim().is_empty() || title.chars().count() > MAX_ARTIFACT_TITLE_CHARS
    }) {
        return Err("artifact-invalid".into());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    if input.kind == Some(ArtifactKindV1::App) {
        app.dialog().file().pick_folder(move |selection| {
            let _ = sender.send(selection);
        });
    } else {
        app.dialog().file().pick_file(move |selection| {
            let _ = sender.send(selection);
        });
    }
    let Some(selection) = receiver
        .await
        .map_err(|_| "artifact-dialog-unavailable".to_owned())?
    else {
        return Ok(None);
    };
    let selected = selection
        .as_path()
        .map(Path::to_path_buf)
        .ok_or_else(|| "artifact-invalid".to_owned())?;
    let app_for_event = app.clone();
    let commit = blocking(move || import_selected_path(&app, input, selected)).await?;
    emit_changed(&app_for_event, &commit.artifact.artifact_id, "imported");
    Ok(Some(commit_view(commit)))
}

fn import_selected_path(
    app: &AppHandle,
    input: ImportArtifactInputV1,
    selected: PathBuf,
) -> Result<ArtifactCommit, String> {
    let state = app.state::<AppState>();
    let owner = owner_pubkey(&state)?;
    let kind = input.kind.unwrap_or_else(|| infer_artifact_kind(&selected));
    let parent = selected
        .parent()
        .ok_or_else(|| "artifact-source-invalid".to_owned())?;
    let filename = selected
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "artifact-source-invalid".to_owned())?;
    let title = input.title.unwrap_or_else(|| filename.to_owned());
    let mut context = ArtifactWriteContext::owner_import(owner);
    context.working_root_id = Some(
        OpaqueId::parse(format!("owner-picker-{}", uuid::Uuid::new_v4().simple()))
            .map_err(|_| "artifact-invalid".to_owned())?,
    );
    let source = if kind == ArtifactKindV1::App {
        ArtifactSourceV1::WorkspaceDirectory {
            relative_path: filename.to_owned(),
        }
    } else {
        ArtifactSourceV1::WorkspaceFile {
            relative_path: filename.to_owned(),
            declared_media_type: None,
        }
    };
    let args = ArtifactCreateArgsV1 {
        title,
        kind,
        source,
        idempotency_key: OpaqueId::parse(format!("owner-import-{}", uuid::Uuid::new_v4()))
            .map_err(|_| "artifact-invalid".to_owned())?,
    };
    open_store(app)?
        .create(&context, &args, Some(parent))
        .map_err(|error| error.code().to_owned())
}

fn infer_artifact_kind(path: &Path) -> ArtifactKindV1 {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => ArtifactKindV1::Html,
        "md" | "markdown" => ArtifactKindV1::Markdown,
        "txt" | "rtf" => ArtifactKindV1::Text,
        "js" | "jsx" | "ts" | "tsx" | "css" | "json" | "rs" | "py" | "sh" => ArtifactKindV1::Code,
        "svg" => ArtifactKindV1::Svg,
        "png" | "jpg" | "jpeg" | "gif" | "webp" => ArtifactKindV1::Image,
        "pdf" => ArtifactKindV1::Pdf,
        _ => ArtifactKindV1::File,
    }
}

#[tauri::command]
pub async fn pin_artifact(
    input: PinArtifactInputV1,
    app: AppHandle,
) -> Result<ArtifactRecord, String> {
    mutate_metadata(app, input.artifact_id, "pinned", move |store, owner, id| {
        store.pin(owner, id, input.pinned)
    })
    .await
}

#[tauri::command]
pub async fn soft_delete_artifact(
    input: ArtifactIdInputV1,
    app: AppHandle,
) -> Result<ArtifactRecord, String> {
    mutate_metadata(app, input.artifact_id, "deleted", |store, owner, id| {
        store.soft_delete(owner, id)
    })
    .await
}

#[tauri::command]
pub async fn restore_artifact(
    input: ArtifactIdInputV1,
    app: AppHandle,
) -> Result<ArtifactRecord, String> {
    mutate_metadata(app, input.artifact_id, "restored", |store, owner, id| {
        store.restore(owner, id)
    })
    .await
}

async fn mutate_metadata(
    app: AppHandle,
    id: String,
    reason: &'static str,
    operation: impl FnOnce(
            &mut ArtifactStore,
            &Hex64,
            &OpaqueId,
        ) -> Result<ArtifactRecord, crate::luca::artifacts::ArtifactStoreError>
        + Send
        + 'static,
) -> Result<ArtifactRecord, String> {
    let app_for_event = app.clone();
    let record = blocking(move || {
        let owner = owner_pubkey(&app.state::<AppState>())?;
        let id = artifact_id(id)?;
        operation(&mut open_store(&app)?, &owner, &id).map_err(|error| error.code().to_owned())
    })
    .await?;
    emit_changed(&app_for_event, &record.artifact_id, reason);
    Ok(record)
}

#[tauri::command]
pub async fn revert_artifact(
    input: RevertArtifactInputV1,
    app: AppHandle,
) -> Result<ArtifactCommitViewV1, String> {
    let app_for_event = app.clone();
    let commit = blocking(move || {
        let owner = owner_pubkey(&app.state::<AppState>())?;
        open_store(&app)?
            .revert(
                &owner,
                &artifact_id(input.artifact_id)?,
                safe_version(input.source_version)?,
                safe_version(input.expected_current_version)?,
            )
            .map_err(|error| error.code().to_owned())
    })
    .await?;
    emit_changed(&app_for_event, &commit.artifact.artifact_id, "reverted");
    Ok(commit_view(commit))
}

#[tauri::command]
pub async fn export_artifact(
    input: ArtifactPreviewInputV1,
    app: AppHandle,
) -> Result<bool, String> {
    let app_for_read = app.clone();
    let preview = blocking(move || {
        let owner = owner_pubkey(&app_for_read.state::<AppState>())?;
        open_store(&app_for_read)?
            .read_binary(
                &owner,
                &artifact_id(input.artifact_id)?,
                input.version.map(safe_version).transpose()?,
            )
            .map_err(|error| error.code().to_owned())
    })
    .await?;
    let bytes = preview
        .content
        .ok_or_else(|| "artifact-unsupported".to_owned())?;
    let filename = safe_filename(&preview.artifact.title);
    super::export_util::save_bytes_with_dialog(
        &app,
        &filename,
        "Artifact",
        &[extension_for_kind(preview.artifact.kind)],
        &bytes,
    )
    .await
}

#[tauri::command]
pub async fn list_artifact_receipts(
    input: ListArtifactReceiptsInputV1,
    app: AppHandle,
) -> Result<Vec<ArtifactReceiptRecord>, String> {
    blocking(move || {
        let owner = owner_pubkey(&app.state::<AppState>())?;
        let conversation = input.conversation_id.map(artifact_id).transpose()?;
        open_store(&app)?
            .receipts(&owner, conversation.as_ref(), input.limit)
            .map_err(|error| error.code().to_owned())
    })
    .await
}

fn commit_view(commit: ArtifactCommit) -> ArtifactCommitViewV1 {
    ArtifactCommitViewV1 {
        artifact: commit.artifact,
        version: commit.version,
        receipt: commit.receipt,
        duplicate: commit.duplicate,
    }
}

fn safe_filename(title: &str) -> String {
    let value = title
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '\0' => '_',
            other => other,
        })
        .collect::<String>();
    if value.trim().is_empty() {
        "artifact".into()
    } else {
        value
    }
}

fn extension_for_kind(kind: ArtifactKindV1) -> &'static str {
    match kind {
        ArtifactKindV1::Html => "html",
        ArtifactKindV1::Markdown => "md",
        ArtifactKindV1::Text => "txt",
        ArtifactKindV1::Code => "txt",
        ArtifactKindV1::Image => "png",
        ArtifactKindV1::Svg => "svg",
        ArtifactKindV1::Pdf => "pdf",
        ArtifactKindV1::File | ArtifactKindV1::App => "bin",
    }
}
