//! Owner-facing artifact Library commands.
//!
//! Every command derives owner scope from the active signable identity. IPC
//! responses contain no absolute paths, source-root handles, blob paths, or
//! artifact bytes except for an explicitly selected bounded preview.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use luca_protocol::{
    ArtifactCreateArgsV1, ArtifactKindV1, ArtifactReadModeV1, ArtifactReceiptStateV1,
    ArtifactSourceV1, Hex64, OpaqueId, SafeU53, MAX_ARTIFACT_LIST_ITEMS, MAX_ARTIFACT_TITLE_CHARS,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::{
    app_state::AppState,
    commands::artifact_preview::{
        active_preview_for_artifact, stop_preview_sessions_for_artifact, ArtifactPreviewSession,
    },
    luca::artifacts::{
        presentation::{self, PreparedArtifactPreviewV1},
        ArtifactCommit, ArtifactDeletedFilter, ArtifactLastPreviewRecord, ArtifactListQuery,
        ArtifactPreviewRecord, ArtifactReceiptRecord, ArtifactRecord, ArtifactStore,
        ArtifactVersionRecord, ArtifactWriteContext,
    },
};

const ARTIFACTS_CHANGED_EVENT: &str = "luca://artifacts-changed";
const MAX_RENDERER_BINARY_PREVIEW_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Bounded metadata-only Artifact Library query.
pub struct ListArtifactsInputV1 {
    query: Option<String>,
    #[serde(default)]
    kinds: Vec<ArtifactKindV1>,
    #[serde(default)]
    deleted: ArtifactDeletedStateV1,
    cursor: Option<String>,
    #[serde(default = "default_limit")]
    limit: u16,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
/// Native soft-deletion filter for artifact pagination.
pub enum ArtifactDeletedStateV1 {
    #[default]
    Active,
    Deleted,
    All,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Owner-scoped artifact identity input.
pub struct ArtifactIdInputV1 {
    artifact_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Artifact and optional immutable version requested for preview.
pub struct ArtifactPreviewInputV1 {
    artifact_id: String,
    version: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Opaque static-presentation identity to revoke.
pub struct RevokeArtifactPreviewInputV1 {
    presentation_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Owner-selected file or directory import metadata.
pub struct ImportArtifactInputV1 {
    kind: Option<ArtifactKindV1>,
    title: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Owner-scoped artifact pin mutation.
pub struct PinArtifactInputV1 {
    artifact_id: String,
    pinned: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Optimistic immutable-version revert request.
pub struct RevertArtifactInputV1 {
    artifact_id: String,
    source_version: u64,
    expected_current_version: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Bounded owner or conversation receipt query.
pub struct ListArtifactReceiptsInputV1 {
    conversation_id: Option<String>,
    #[serde(default = "default_limit")]
    limit: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
/// Composed result of an atomic artifact commit.
pub struct ArtifactCommitViewV1 {
    artifact: ArtifactViewV1,
    version: ArtifactVersionViewV1,
    receipt: ArtifactReceiptRecord,
    duplicate: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
/// One page of metadata-only composed artifacts.
pub struct ArtifactListViewV1 {
    artifacts: Vec<ArtifactViewV1>,
    next_cursor: Option<String>,
    total: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
/// Current renderer availability for an artifact.
pub enum ArtifactAvailabilityV1 {
    Ready,
    PreviewUnavailable,
    SourceMissing,
    Corrupt,
    TooLarge,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
/// Whether a source binding can currently be resolved.
#[allow(dead_code)] // Reserved wire states for future active-root resolution.
pub enum ArtifactSourceAvailabilityV1 {
    Available,
    Missing,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
/// Relative source binding shape.
pub enum ArtifactSourceBindingKindV1 {
    File,
    Directory,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
/// Path-safe source binding metadata with no absolute root.
pub struct ArtifactSourceBindingViewV1 {
    kind: ArtifactSourceBindingKindV1,
    relative_path: String,
    availability: ArtifactSourceAvailabilityV1,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
/// Stable ID-only provenance; display labels are resolved by the UI.
pub struct ArtifactProvenanceViewV1 {
    resident_pubkey: String,
    conversation_id: Option<String>,
    project_id: Option<String>,
    turn_id: Option<String>,
    dispatch_receipt_id: Option<String>,
    final_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
/// Composed durable artifact metadata returned to Library and Canvas.
pub struct ArtifactViewV1 {
    id: String,
    title: String,
    kind: ArtifactKindV1,
    media_type: String,
    language: Option<String>,
    current_version: u64,
    current_version_id: String,
    size_bytes: u64,
    created_at: String,
    updated_at: String,
    pinned: bool,
    deleted_at: Option<String>,
    availability: ArtifactAvailabilityV1,
    receipt_state: ArtifactReceiptStateV1,
    summary: Option<String>,
    provenance: ArtifactProvenanceViewV1,
    source_binding: Option<ArtifactSourceBindingViewV1>,
    active_preview_session_id: Option<String>,
    last_preview: Option<ArtifactLastPreviewRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
/// Immutable artifact-version metadata with a globally unique view ID.
pub struct ArtifactVersionViewV1 {
    id: String,
    artifact_id: String,
    number: u64,
    parent_version: Option<u64>,
    content_hash: String,
    media_type: String,
    size_bytes: u64,
    source: String,
    created_by_pubkey: String,
    conversation_id: Option<String>,
    turn_id: Option<String>,
    created_at: String,
    note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
/// Artifact-scoped active and durable last-preview metadata.
pub struct ArtifactPreviewStateViewV1 {
    artifact_id: String,
    active_session: Option<ArtifactPreviewSession>,
    last_preview: Option<ArtifactLastPreviewRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "previewType", rename_all = "snake_case")]
/// Bounded renderer payload for non-HTML static previews.
pub enum ArtifactPreviewViewV1 {
    Text {
        artifact: ArtifactViewV1,
        version: ArtifactVersionViewV1,
        content_utf8: String,
        truncated: bool,
    },
    Binary {
        artifact: ArtifactViewV1,
        version: ArtifactVersionViewV1,
        content_base64: String,
    },
    App {
        artifact: ArtifactViewV1,
        version: ArtifactVersionViewV1,
    },
    Unsupported {
        artifact: ArtifactViewV1,
        version: ArtifactVersionViewV1,
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

fn version_view(record: ArtifactVersionRecord) -> ArtifactVersionViewV1 {
    let source = if record.parent_version.is_some()
        && record.conversation_id.is_none()
        && record.source_turn_id.is_none()
    {
        "revert".to_owned()
    } else {
        record.source_type.clone()
    };
    ArtifactVersionViewV1 {
        id: format!("{}:v{}", record.artifact_id, record.version),
        artifact_id: record.artifact_id,
        number: record.version,
        parent_version: record.parent_version,
        content_hash: record.aggregate_hash,
        media_type: record.media_type,
        size_bytes: record.size_bytes,
        source,
        created_by_pubkey: record.created_by_pubkey,
        conversation_id: record.conversation_id,
        turn_id: record.source_turn_id,
        created_at: record.created_at,
        note: None,
    }
}

fn language_for(record: &ArtifactVersionRecord, kind: ArtifactKindV1) -> Option<String> {
    if kind != ArtifactKindV1::Code {
        return None;
    }
    let extension = Path::new(record.source_relative_path.as_deref()?)
        .extension()?
        .to_str()?
        .to_ascii_lowercase();
    Some(
        match extension.as_str() {
            "rs" => "rust",
            "ts" | "tsx" => "typescript",
            "js" | "jsx" | "mjs" | "cjs" => "javascript",
            "py" => "python",
            "swift" => "swift",
            "go" => "go",
            "rb" => "ruby",
            "java" => "java",
            "kt" | "kts" => "kotlin",
            "css" => "css",
            "json" => "json",
            "yaml" | "yml" => "yaml",
            "toml" => "toml",
            "sh" | "zsh" | "bash" => "shell",
            other => other,
        }
        .to_owned(),
    )
}

fn availability_for(record: &ArtifactRecord) -> ArtifactAvailabilityV1 {
    match record.lifecycle_state.as_str() {
        "ready" => ArtifactAvailabilityV1::Ready,
        "preview_unavailable" => ArtifactAvailabilityV1::PreviewUnavailable,
        "source_unavailable" | "source_missing" => ArtifactAvailabilityV1::SourceMissing,
        "corrupt" => ArtifactAvailabilityV1::Corrupt,
        "too_large" => ArtifactAvailabilityV1::TooLarge,
        _ => ArtifactAvailabilityV1::Unavailable,
    }
}

fn source_binding_for(version: &ArtifactVersionRecord) -> Option<ArtifactSourceBindingViewV1> {
    let relative_path = version.source_relative_path.clone()?;
    let kind = match version.source_type.as_str() {
        "workspace_directory" => ArtifactSourceBindingKindV1::Directory,
        "workspace_file" => ArtifactSourceBindingKindV1::File,
        _ => return None,
    };
    Some(ArtifactSourceBindingViewV1 {
        kind,
        relative_path,
        // Working-root handles are session-scoped and deliberately cannot be
        // resolved by the owner UI after a managed dispatch has ended.
        availability: ArtifactSourceAvailabilityV1::Unavailable,
    })
}

fn compose_artifact_view(
    store: &ArtifactStore,
    owner: &Hex64,
    artifact: ArtifactRecord,
) -> Result<ArtifactViewV1, String> {
    let id = OpaqueId::parse(artifact.artifact_id.clone())
        .map_err(|_| "artifact-schema-incompatible".to_owned())?;
    let preview = store
        .read(owner, &id, None, ArtifactReadModeV1::Metadata)
        .map_err(|error| error.code().to_owned())?;
    let receipt = store
        .latest_receipt(owner, &id, artifact.current_version)
        .ok();
    let active_preview = active_preview_for_artifact(owner.as_str(), artifact.artifact_id.as_str());
    let last_preview = store
        .last_preview(owner, &id)
        .map_err(|error| error.code().to_owned())?;
    let source_binding = source_binding_for(&preview.version);
    let language = language_for(&preview.version, artifact.kind);
    let media_type = preview.version.media_type.clone();
    let size_bytes = preview.version.size_bytes;
    let final_message_id = receipt.as_ref().and_then(|value| value.message_id.clone());
    let dispatch_receipt_id = receipt
        .as_ref()
        .and_then(|value| value.dispatch_receipt_id.clone());
    let availability = if artifact.kind == ArtifactKindV1::App && active_preview.is_none() {
        ArtifactAvailabilityV1::PreviewUnavailable
    } else {
        availability_for(&artifact)
    };
    Ok(ArtifactViewV1 {
        id: artifact.artifact_id.clone(),
        title: artifact.title,
        kind: artifact.kind,
        media_type,
        language,
        current_version: artifact.current_version,
        current_version_id: format!("{}:v{}", artifact.artifact_id, artifact.current_version),
        size_bytes,
        created_at: artifact.created_at,
        updated_at: artifact.updated_at,
        pinned: artifact.pinned,
        deleted_at: artifact.deleted_at,
        availability,
        receipt_state: artifact.receipt_state,
        summary: None,
        provenance: ArtifactProvenanceViewV1 {
            resident_pubkey: artifact.created_by_pubkey,
            conversation_id: artifact.conversation_id,
            project_id: None,
            turn_id: artifact.source_turn_id,
            dispatch_receipt_id,
            final_message_id,
        },
        source_binding,
        active_preview_session_id: active_preview.map(|session| session.id),
        last_preview,
    })
}

pub(crate) fn mark_cancelled_dispatch_receipts(
    app: &AppHandle,
    owner_pubkey: &str,
    conversation_id: &str,
    resident_pubkey: &str,
    dispatch_receipt_id: &str,
) -> Result<usize, String> {
    let owner = Hex64::parse(owner_pubkey.to_owned()).map_err(|_| "artifact-owner-invalid")?;
    let conversation =
        OpaqueId::parse(conversation_id.to_owned()).map_err(|_| "artifact-invalid")?;
    let resident =
        Hex64::parse(resident_pubkey.to_owned()).map_err(|_| "artifact-resident-invalid")?;
    let dispatch =
        OpaqueId::parse(dispatch_receipt_id.to_owned()).map_err(|_| "artifact-invalid")?;
    let changed = open_store(app)?
        .mark_dispatch_receipts(
            &owner,
            &conversation,
            &resident,
            &dispatch,
            ArtifactReceiptStateV1::Interrupted,
        )
        .map_err(|error| error.code().to_owned())?;
    if changed > 0 {
        emit_changed(app, "", "receipt-interrupted");
    }
    Ok(changed)
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
) -> Result<ArtifactListViewV1, String> {
    blocking(move || {
        let owner = owner_pubkey(&app.state::<AppState>())?;
        let store = open_store(&app)?;
        if input.limit == 0 || input.limit > MAX_ARTIFACT_LIST_ITEMS {
            return Err("artifact-invalid".to_owned());
        }
        if input.kinds.len() > 9
            || input
                .query
                .as_deref()
                .is_some_and(|value| value.trim().chars().count() > 256)
        {
            return Err("artifact-query-invalid".to_owned());
        }
        let has_cursor = input.cursor.is_some();
        let page = store
            .list_page(
                &owner,
                &ArtifactListQuery {
                    query: input.query,
                    kinds: input.kinds,
                    deleted: match input.deleted {
                        ArtifactDeletedStateV1::Active => ArtifactDeletedFilter::Active,
                        ArtifactDeletedStateV1::Deleted => ArtifactDeletedFilter::Deleted,
                        ArtifactDeletedStateV1::All => ArtifactDeletedFilter::All,
                    },
                    cursor: input.cursor,
                    limit: input.limit,
                },
            )
            .map_err(|error| {
                if has_cursor && error == crate::luca::artifacts::ArtifactStoreError::InvalidRequest
                {
                    "artifact-cursor-invalid".to_owned()
                } else {
                    error.code().to_owned()
                }
            })?;
        let artifacts = page
            .artifacts
            .into_iter()
            .map(|artifact| compose_artifact_view(&store, &owner, artifact))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ArtifactListViewV1 {
            artifacts,
            next_cursor: page.next_cursor,
            total: page.total,
        })
    })
    .await
}

#[tauri::command]
pub async fn get_artifact(
    input: ArtifactIdInputV1,
    app: AppHandle,
) -> Result<ArtifactViewV1, String> {
    blocking(move || {
        let owner = owner_pubkey(&app.state::<AppState>())?;
        let store = open_store(&app)?;
        let artifact = store
            .get(&owner, &artifact_id(input.artifact_id)?)
            .map_err(|error| error.code().to_owned())?;
        compose_artifact_view(&store, &owner, artifact)
    })
    .await
}

#[tauri::command]
pub async fn list_artifact_versions(
    input: ArtifactIdInputV1,
    app: AppHandle,
) -> Result<Vec<ArtifactVersionViewV1>, String> {
    blocking(move || {
        let owner = owner_pubkey(&app.state::<AppState>())?;
        open_store(&app)?
            .versions(&owner, &artifact_id(input.artifact_id)?)
            .map(|versions| versions.into_iter().map(version_view).collect())
            .map_err(|error| error.code().to_owned())
    })
    .await
}

#[tauri::command]
pub async fn get_artifact_preview_state(
    input: ArtifactIdInputV1,
    app: AppHandle,
) -> Result<ArtifactPreviewStateViewV1, String> {
    blocking(move || {
        let owner = owner_pubkey(&app.state::<AppState>())?;
        let artifact_id = artifact_id(input.artifact_id)?;
        let store = open_store(&app)?;
        store
            .get(&owner, &artifact_id)
            .map_err(|error| error.code().to_owned())?;
        let active_session = active_preview_for_artifact(owner.as_str(), artifact_id.as_str());
        let last_preview = store
            .last_preview(&owner, &artifact_id)
            .map_err(|error| error.code().to_owned())?;
        Ok(ArtifactPreviewStateViewV1 {
            artifact_id: artifact_id.as_str().to_owned(),
            active_session,
            last_preview,
        })
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
        let artifact_view = compose_artifact_view(&store, &owner, metadata.artifact.clone())?;
        let metadata_version_view = version_view(metadata.version.clone());
        if metadata.artifact.kind == ArtifactKindV1::App {
            return Ok(ArtifactPreviewViewV1::App {
                artifact: artifact_view,
                version: metadata_version_view,
            });
        }
        if metadata.version.media_type.starts_with("text/")
            || metadata.version.media_type == "image/svg+xml"
        {
            let preview = store
                .read(&owner, &id, version, ArtifactReadModeV1::BoundedText)
                .map_err(|error| error.code().to_owned())?;
            return text_preview(preview, artifact_view);
        }
        if metadata.version.size_bytes > MAX_RENDERER_BINARY_PREVIEW_BYTES {
            return Ok(ArtifactPreviewViewV1::Unsupported {
                artifact: artifact_view,
                version: metadata_version_view,
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
            artifact: artifact_view,
            version: version_view(preview.version),
            content_base64: base64::engine::general_purpose::STANDARD.encode(content),
        })
    })
    .await
}

#[tauri::command]
pub async fn prepare_artifact_preview(
    input: ArtifactPreviewInputV1,
    app: AppHandle,
) -> Result<PreparedArtifactPreviewV1, String> {
    blocking(move || {
        let owner = owner_pubkey(&app.state::<AppState>())?;
        let store = open_store(&app)?;
        presentation::prepare(
            &store,
            &owner,
            &artifact_id(input.artifact_id)?,
            input.version.map(safe_version).transpose()?,
        )
        .map_err(|error| error.code().to_owned())
    })
    .await
}

#[tauri::command]
pub fn revoke_artifact_preview(
    input: RevokeArtifactPreviewInputV1,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let owner = owner_pubkey(&state)?;
    presentation::revoke(owner.as_str(), &input.presentation_id)
}

fn text_preview(
    preview: ArtifactPreviewRecord,
    artifact: ArtifactViewV1,
) -> Result<ArtifactPreviewViewV1, String> {
    let content = preview
        .content
        .ok_or_else(|| "artifact-blob-corrupt".to_owned())?;
    let content_utf8 =
        String::from_utf8(content).map_err(|_| "artifact-blob-corrupt".to_owned())?;
    Ok(ArtifactPreviewViewV1::Text {
        artifact,
        version: version_view(preview.version),
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
    emit_changed(&app_for_event, &commit.artifact.id, "imported");
    Ok(Some(commit))
}

fn import_selected_path(
    app: &AppHandle,
    input: ImportArtifactInputV1,
    selected: PathBuf,
) -> Result<ArtifactCommitViewV1, String> {
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
    let mut context = ArtifactWriteContext::owner_import(owner.clone());
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
    let mut store = open_store(app)?;
    let commit = store
        .create(&context, &args, Some(parent))
        .map_err(|error| error.code().to_owned())?;
    commit_view(&store, &owner, commit)
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
) -> Result<ArtifactViewV1, String> {
    mutate_metadata(app, input.artifact_id, "pinned", move |store, owner, id| {
        store.pin(owner, id, input.pinned)
    })
    .await
}

#[tauri::command]
pub async fn soft_delete_artifact(
    input: ArtifactIdInputV1,
    app: AppHandle,
) -> Result<ArtifactViewV1, String> {
    mutate_metadata(app, input.artifact_id, "deleted", |store, owner, id| {
        store.soft_delete(owner, id)
    })
    .await
}

#[tauri::command]
pub async fn restore_artifact(
    input: ArtifactIdInputV1,
    app: AppHandle,
) -> Result<ArtifactViewV1, String> {
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
) -> Result<ArtifactViewV1, String> {
    let app_for_event = app.clone();
    let record = blocking(move || {
        let owner = owner_pubkey(&app.state::<AppState>())?;
        let id = artifact_id(id)?;
        let mut store = open_store(&app)?;
        let record = operation(&mut store, &owner, &id).map_err(|error| error.code().to_owned())?;
        if reason == "deleted" {
            let _ = presentation::revoke_for_artifact(owner.as_str(), id.as_str());
            let _ = stop_preview_sessions_for_artifact(owner.as_str(), id.as_str());
        }
        compose_artifact_view(&store, &owner, record)
    })
    .await?;
    emit_changed(&app_for_event, &record.id, reason);
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
        let mut store = open_store(&app)?;
        let commit = store
            .revert(
                &owner,
                &artifact_id(input.artifact_id)?,
                safe_version(input.source_version)?,
                safe_version(input.expected_current_version)?,
            )
            .map_err(|error| error.code().to_owned())?;
        commit_view(&store, &owner, commit)
    })
    .await?;
    emit_changed(&app_for_event, &commit.artifact.id, "reverted");
    Ok(commit)
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

fn commit_view(
    store: &ArtifactStore,
    owner: &Hex64,
    commit: ArtifactCommit,
) -> Result<ArtifactCommitViewV1, String> {
    Ok(ArtifactCommitViewV1 {
        artifact: compose_artifact_view(store, owner, commit.artifact)?,
        version: version_view(commit.version),
        receipt: commit.receipt,
        duplicate: commit.duplicate,
    })
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
