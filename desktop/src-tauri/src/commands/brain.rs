//! V1.2 Brain Setup renderer commands and frozen development fixtures.
//!
//! Renderer responses contain no source bodies or absolute paths. The raw
//! preview token is a short-lived commit capability and is never logged.

use crate::{
    app_state::AppState,
    luca::{owner_brain, owner_brain_store},
};
use luca_protocol::{
    BrainGrantStateV1, Hex64, OpaqueId, OwnerBrainImportCommitV1, OwnerBrainPreviewRowStatusV1,
    OwnerBrainSourceKindV1, OwnerBrainSourceStatusV1, ProviderEgressV1,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewOwnerBrainSourceInputV1 {
    selected_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PickOwnerBrainSourceInputV1 {
    selection_kind: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitOwnerBrainImportInputV1 {
    preview_id: String,
    preview_token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OwnerBrainGrantInputV1 {
    source_id: String,
    resident_pubkey: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerBrainPreviewRowViewV1 {
    relative_path: String,
    status: String,
    byte_count: u64,
    reason_code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerBrainPreviewViewV1 {
    preview_id: String,
    preview_token: String,
    source_kind: String,
    display_name: String,
    accepted_bytes: u64,
    write_count: u64,
    expires_at: String,
    can_commit: bool,
    rows: Vec<OwnerBrainPreviewRowViewV1>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerBrainImportViewV1 {
    import_transaction_id: &'static str,
    state: &'static str,
    completed_items: u64,
    total_items: u64,
    error_code: Option<&'static str>,
    can_cancel: bool,
    can_retry: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerBrainImportCommitViewV1 {
    import_transaction_id: String,
    preview_id: String,
    source_id: String,
    root_snapshot_hash: String,
    state: &'static str,
    imported_file_count: u64,
    imported_chunk_count: u64,
    completed_at: String,
    replayed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerBrainSourceViewV1 {
    source_id: String,
    source_kind: String,
    display_name: String,
    status: String,
    file_count: u64,
    chunk_count: u64,
    changed_file_count: u64,
    indexed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerBrainGrantViewV1 {
    grant_id: String,
    source_id: String,
    resident_pubkey: String,
    resident_name: String,
    state: String,
    provider_egress: String,
    can_reconfirm: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerBrainGrantMutationViewV1 {
    grant: OwnerBrainGrantViewV1,
    replayed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerBrainReceiptViewV1 {
    receipt_id: String,
    source_id: String,
    resident_pubkey: String,
    status: String,
    selected_chunk_count: u64,
    truncated: bool,
    created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerBrainFixtureStateV1 {
    availability: &'static str,
    sources: Vec<OwnerBrainSourceViewV1>,
    grants: Vec<OwnerBrainGrantViewV1>,
    receipts: Vec<OwnerBrainReceiptViewV1>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerBrainFixturesV1 {
    preview: OwnerBrainPreviewViewV1,
    imports: Vec<OwnerBrainImportViewV1>,
    ready: OwnerBrainFixtureStateV1,
    empty: OwnerBrainFixtureStateV1,
    locked: OwnerBrainFixtureStateV1,
    unavailable: OwnerBrainFixtureStateV1,
}

fn state(availability: &'static str) -> OwnerBrainFixtureStateV1 {
    OwnerBrainFixtureStateV1 {
        availability,
        sources: Vec::new(),
        grants: Vec::new(),
        receipts: Vec::new(),
    }
}

fn source_kind_value(source_kind: OwnerBrainSourceKindV1) -> &'static str {
    match source_kind {
        OwnerBrainSourceKindV1::MarkdownFile => "markdown_file",
        OwnerBrainSourceKindV1::TextFile => "text_file",
        OwnerBrainSourceKindV1::TextFolder => "text_folder",
    }
}

fn row_status_value(status: OwnerBrainPreviewRowStatusV1) -> &'static str {
    match status {
        OwnerBrainPreviewRowStatusV1::Accepted => "accepted",
        OwnerBrainPreviewRowStatusV1::Skipped => "skipped",
        OwnerBrainPreviewRowStatusV1::Unsupported => "unsupported",
        OwnerBrainPreviewRowStatusV1::Oversized => "oversized",
        OwnerBrainPreviewRowStatusV1::Binary => "binary",
        OwnerBrainPreviewRowStatusV1::CredentialLike => "credential_like",
        OwnerBrainPreviewRowStatusV1::Duplicate => "duplicate",
        OwnerBrainPreviewRowStatusV1::Changed => "changed",
        OwnerBrainPreviewRowStatusV1::UnsafePath => "unsafe_path",
    }
}

fn preview_view(handle: owner_brain::OwnerBrainPreviewHandleV1) -> OwnerBrainPreviewViewV1 {
    let can_commit = handle.preview.rows.iter().any(|row| {
        matches!(
            row.status,
            OwnerBrainPreviewRowStatusV1::Accepted | OwnerBrainPreviewRowStatusV1::Changed
        )
    });
    OwnerBrainPreviewViewV1 {
        preview_id: handle.preview.preview_id.as_str().to_owned(),
        preview_token: handle.token,
        source_kind: source_kind_value(handle.preview.source_kind).to_owned(),
        display_name: handle.preview.display_name,
        accepted_bytes: handle.preview.accepted_bytes.get(),
        write_count: handle.preview.write_count.get(),
        expires_at: handle.preview.expires_at.as_str().to_owned(),
        can_commit,
        rows: handle
            .preview
            .rows
            .into_iter()
            .map(|row| OwnerBrainPreviewRowViewV1 {
                relative_path: row.relative_path,
                status: row_status_value(row.status).to_owned(),
                byte_count: row.byte_count.get(),
                reason_code: row.reason_code.map(|reason| reason.as_str().to_owned()),
            })
            .collect(),
    }
}

async fn preview_selected_path(
    app: AppHandle,
    selected_path: PathBuf,
) -> Result<OwnerBrainPreviewViewV1, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner_pubkey = Hex64::parse(state.signing_keys()?.public_key().to_hex())
            .map_err(|_| "active owner identity is invalid".to_owned())?;
        state
            .preview_owner_brain_source(owner_pubkey, &selected_path)
            .map(preview_view)
            .map_err(|error| error.code().to_owned())
    })
    .await
    .map_err(|_| "owner-brain-unavailable".to_owned())?
}

#[tauri::command]
/// Opens one trusted native picker and returns a zero-write source preview.
pub async fn pick_and_preview_owner_brain_source(
    input: PickOwnerBrainSourceInputV1,
    app: AppHandle,
) -> Result<Option<OwnerBrainPreviewViewV1>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (sender, receiver) = tokio::sync::oneshot::channel();
    match input.selection_kind.as_str() {
        "file" => app
            .dialog()
            .file()
            .add_filter("Markdown and text", &["md", "markdown", "txt"])
            .pick_file(move |selection| {
                let _ = sender.send(selection);
            }),
        "folder" => app.dialog().file().pick_folder(move |selection| {
            let _ = sender.send(selection);
        }),
        _ => return Err("owner-brain-invalid".to_owned()),
    }

    let Some(selection) = receiver
        .await
        .map_err(|_| "owner-brain-dialog-unavailable".to_owned())?
    else {
        return Ok(None);
    };
    let selected_path = selection
        .as_path()
        .map(Path::to_path_buf)
        .ok_or_else(|| "owner-brain-invalid".to_owned())?;
    preview_selected_path(app, selected_path).await.map(Some)
}

#[tauri::command]
/// Performs a bounded, read-only preview of one owner-selected local source.
pub async fn preview_owner_brain_source(
    input: PreviewOwnerBrainSourceInputV1,
    app: AppHandle,
) -> Result<OwnerBrainPreviewViewV1, String> {
    preview_selected_path(app, Path::new(&input.selected_path).to_path_buf()).await
}

fn import_commit_view(
    commit: OwnerBrainImportCommitV1,
    replayed: bool,
) -> Result<OwnerBrainImportCommitViewV1, String> {
    let source_id = commit
        .source_id
        .ok_or_else(|| "committed Brain import has no source".to_owned())?;
    Ok(OwnerBrainImportCommitViewV1 {
        import_transaction_id: commit.import_transaction_id.as_str().to_owned(),
        preview_id: commit.preview_id.as_str().to_owned(),
        source_id: source_id.as_str().to_owned(),
        root_snapshot_hash: commit.root_snapshot_hash.as_str().to_owned(),
        state: "committed",
        imported_file_count: commit.imported_file_count.get(),
        imported_chunk_count: commit.imported_chunk_count.get(),
        completed_at: commit.completed_at.as_str().to_owned(),
        replayed,
    })
}

#[tauri::command]
/// Atomically consumes one exact unexpired preview and persists encrypted rows.
pub async fn commit_owner_brain_import(
    input: CommitOwnerBrainImportInputV1,
    app: AppHandle,
) -> Result<OwnerBrainImportCommitViewV1, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner_pubkey = Hex64::parse(state.signing_keys()?.public_key().to_hex())
            .map_err(|_| "active owner identity is invalid".to_owned())?;
        let preview_id =
            OpaqueId::parse(input.preview_id).map_err(|_| "owner-brain-invalid".to_owned())?;
        state
            .commit_owner_brain_import(owner_pubkey, &preview_id, &input.preview_token)
            .map_err(|error| error.code().to_owned())
            .and_then(|(commit, replayed)| import_commit_view(commit, replayed))
    })
    .await
    .map_err(|_| "owner-brain-unavailable".to_owned())?
}

#[tauri::command]
/// Cancels source staging unless the atomic persistence claim has begun.
pub fn cancel_owner_brain_import(
    input: CommitOwnerBrainImportInputV1,
    app: AppHandle,
) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let owner_pubkey = Hex64::parse(state.signing_keys()?.public_key().to_hex())
        .map_err(|_| "active owner identity is invalid".to_owned())?;
    let preview_id =
        OpaqueId::parse(input.preview_id).map_err(|_| "owner-brain-invalid".to_owned())?;
    state
        .cancel_owner_brain_import(&owner_pubkey, &preview_id, &input.preview_token)
        .map_err(|error| error.code().to_owned())
}

fn grant_state_value(state: BrainGrantStateV1) -> &'static str {
    match state {
        BrainGrantStateV1::Active => "active",
        BrainGrantStateV1::Revoked => "revoked",
        BrainGrantStateV1::Stale => "stale",
    }
}

fn provider_egress_value(provider_egress: ProviderEgressV1) -> &'static str {
    match provider_egress {
        ProviderEgressV1::Local => "local",
        ProviderEgressV1::Remote => "remote",
        ProviderEgressV1::Unknown => "unknown",
    }
}

fn source_status_value(status: OwnerBrainSourceStatusV1) -> &'static str {
    match status {
        OwnerBrainSourceStatusV1::Ready => "ready",
        OwnerBrainSourceStatusV1::Unavailable => "unavailable",
        OwnerBrainSourceStatusV1::Removed => "removed",
    }
}

fn layer_status_value(status: luca_protocol::ContinuityLayerStatusV1) -> &'static str {
    match status {
        luca_protocol::ContinuityLayerStatusV1::Ready => "ready",
        luca_protocol::ContinuityLayerStatusV1::Empty => "empty",
        luca_protocol::ContinuityLayerStatusV1::Denied => "denied",
        luca_protocol::ContinuityLayerStatusV1::Stale => "stale",
        luca_protocol::ContinuityLayerStatusV1::Locked => "locked",
        luca_protocol::ContinuityLayerStatusV1::Unavailable => "unavailable",
        luca_protocol::ContinuityLayerStatusV1::Timeout => "timeout",
        luca_protocol::ContinuityLayerStatusV1::Invalid => "invalid",
    }
}

fn grant_view(
    source_id: &OpaqueId,
    grant: &luca_protocol::BrainGrantV1,
    effective_state: BrainGrantStateV1,
    resident_name: String,
) -> OwnerBrainGrantViewV1 {
    OwnerBrainGrantViewV1 {
        grant_id: grant.grant_id.as_str().to_owned(),
        source_id: source_id.as_str().to_owned(),
        resident_pubkey: grant.resident_pubkey.as_str().to_owned(),
        resident_name,
        state: grant_state_value(effective_state).to_owned(),
        provider_egress: provider_egress_value(grant.provider_egress).to_owned(),
        can_reconfirm: effective_state == BrainGrantStateV1::Stale,
    }
}

fn resident_names(app: &AppHandle) -> std::collections::HashMap<String, String> {
    crate::managed_agents::load_managed_agents(app)
        .unwrap_or_default()
        .into_iter()
        .map(|record| (record.pubkey.to_ascii_lowercase(), record.name))
        .collect()
}

fn catalog_view(
    app: &AppHandle,
    catalog: owner_brain_store::OwnerBrainCatalogV1,
    receipts: Vec<luca_protocol::OwnerBrainContextReceiptV1>,
) -> OwnerBrainFixtureStateV1 {
    let names = resident_names(app);
    let sources = catalog
        .sources
        .into_iter()
        .map(|summary| OwnerBrainSourceViewV1 {
            source_id: summary.source.source_id.as_str().to_owned(),
            source_kind: source_kind_value(summary.source.source_kind).to_owned(),
            display_name: summary.source.display_name,
            status: source_status_value(summary.source.status).to_owned(),
            file_count: summary.file_count.get(),
            chunk_count: summary.chunk_count.get(),
            changed_file_count: 0,
            indexed_at: summary.source.updated_at.as_str().to_owned(),
        })
        .collect::<Vec<_>>();
    let grants = catalog
        .grants
        .into_iter()
        .map(|stored| {
            let authority = crate::managed_agents::current_owner_brain_runtime_authority(
                app,
                &stored.grant.resident_pubkey,
            )
            .ok();
            let effective_state = owner_brain_store::effective_grant_state(
                &stored.grant,
                authority.as_ref().map(|(binding, _)| binding),
                authority.as_ref().map(|(_, egress)| *egress),
            );
            let resident_name = names
                .get(stored.grant.resident_pubkey.as_str())
                .cloned()
                .unwrap_or_else(|| stored.grant.resident_pubkey.as_str().to_owned());
            grant_view(
                &stored.source_id,
                &stored.grant,
                effective_state,
                resident_name,
            )
        })
        .collect();
    let receipts = receipts
        .into_iter()
        .map(|receipt| OwnerBrainReceiptViewV1 {
            receipt_id: receipt.receipt_id.as_str().to_owned(),
            source_id: receipt.source_id.as_str().to_owned(),
            resident_pubkey: receipt.resident_pubkey.as_str().to_owned(),
            status: layer_status_value(receipt.status).to_owned(),
            selected_chunk_count: receipt.selected_chunk_hashes.len() as u64,
            truncated: receipt.truncated,
            created_at: receipt.created_at.as_str().to_owned(),
        })
        .collect();
    OwnerBrainFixtureStateV1 {
        availability: if sources.is_empty() { "empty" } else { "ready" },
        sources,
        grants,
        receipts,
    }
}

#[tauri::command]
/// Lists body-free owner source and effective grant state for Brain Setup.
pub async fn get_owner_brain_state(app: AppHandle) -> Result<OwnerBrainFixtureStateV1, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app_state = app.state::<AppState>();
        let owner_pubkey = Hex64::parse(app_state.signing_keys()?.public_key().to_hex())
            .map_err(|_| "active owner identity is invalid".to_owned())?;
        match app_state.read_owner_brain_catalog(&owner_pubkey) {
            Ok(catalog) => Ok(catalog_view(
                &app,
                catalog,
                app_state.owner_brain_receipts(&owner_pubkey),
            )),
            Err(owner_brain_store::OwnerBrainStoreError::Locked) => Ok(state("locked")),
            Err(_) => Ok(state("unavailable")),
        }
    })
    .await
    .map_err(|_| "owner-brain-unavailable".to_owned())?
}

async fn mutate_owner_brain_grant_command(
    input: OwnerBrainGrantInputV1,
    app: AppHandle,
    action: owner_brain_store::OwnerBrainGrantActionV1,
) -> Result<OwnerBrainGrantMutationViewV1, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner_pubkey = Hex64::parse(state.signing_keys()?.public_key().to_hex())
            .map_err(|_| "active owner identity is invalid".to_owned())?;
        let resident_pubkey =
            Hex64::parse(input.resident_pubkey).map_err(|_| "owner-brain-invalid".to_owned())?;
        let source_id =
            OpaqueId::parse(input.source_id).map_err(|_| "owner-brain-invalid".to_owned())?;
        let (binding_ref, provider_egress) =
            crate::managed_agents::current_owner_brain_runtime_authority(&app, &resident_pubkey)
                .map_err(|_| "owner-brain-runtime-unavailable".to_owned())?;
        let result = state
            .mutate_owner_brain_grant(
                owner_pubkey,
                resident_pubkey.clone(),
                source_id,
                binding_ref,
                provider_egress,
                action,
            )
            .map_err(|error| error.code().to_owned())?;
        let resident_name = resident_names(&app)
            .remove(resident_pubkey.as_str())
            .unwrap_or_else(|| resident_pubkey.as_str().to_owned());
        Ok(OwnerBrainGrantMutationViewV1 {
            grant: grant_view(
                &result.source_id,
                &result.grant,
                result.grant.state,
                resident_name,
            ),
            replayed: result.replayed,
        })
    })
    .await
    .map_err(|_| "owner-brain-unavailable".to_owned())?
}

#[tauri::command]
/// Creates or restores one explicit resident/source grant.
pub async fn grant_owner_brain_source(
    input: OwnerBrainGrantInputV1,
    app: AppHandle,
) -> Result<OwnerBrainGrantMutationViewV1, String> {
    mutate_owner_brain_grant_command(
        input,
        app,
        owner_brain_store::OwnerBrainGrantActionV1::Grant,
    )
    .await
}

#[tauri::command]
/// Revokes one exact resident/source grant without affecting any other grant.
pub async fn revoke_owner_brain_source(
    input: OwnerBrainGrantInputV1,
    app: AppHandle,
) -> Result<OwnerBrainGrantMutationViewV1, String> {
    mutate_owner_brain_grant_command(
        input,
        app,
        owner_brain_store::OwnerBrainGrantActionV1::Revoke,
    )
    .await
}

#[tauri::command]
/// Reconfirms a stale grant against the current trusted runtime binding.
pub async fn reconfirm_owner_brain_source(
    input: OwnerBrainGrantInputV1,
    app: AppHandle,
) -> Result<OwnerBrainGrantMutationViewV1, String> {
    mutate_owner_brain_grant_command(
        input,
        app,
        owner_brain_store::OwnerBrainGrantActionV1::Reconfirm,
    )
    .await
}

#[tauri::command]
/// Returns deterministic body-free fixtures for V1.2 Brain Setup development.
pub fn get_owner_brain_fixtures() -> OwnerBrainFixturesV1 {
    let resident = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    OwnerBrainFixturesV1 {
        preview: OwnerBrainPreviewViewV1 {
            preview_id: "preview-fixture".to_owned(),
            preview_token: "preview-token-fixture".to_owned(),
            source_kind: "text_folder".to_owned(),
            display_name: "Launch Notes".to_owned(),
            accepted_bytes: 2_048,
            write_count: 0,
            expires_at: "2026-08-08T20:15:00Z".to_owned(),
            can_commit: true,
            rows: vec![
                OwnerBrainPreviewRowViewV1 {
                    relative_path: "planning/launch.md".to_owned(),
                    status: "changed".to_owned(),
                    byte_count: 2_048,
                    reason_code: None,
                },
                OwnerBrainPreviewRowViewV1 {
                    relative_path: "planning/identity.md".to_owned(),
                    status: "duplicate".to_owned(),
                    byte_count: 1_024,
                    reason_code: Some("content-unchanged".to_owned()),
                },
                OwnerBrainPreviewRowViewV1 {
                    relative_path: ".archive".to_owned(),
                    status: "skipped".to_owned(),
                    byte_count: 0,
                    reason_code: Some("hidden-directory".to_owned()),
                },
                OwnerBrainPreviewRowViewV1 {
                    relative_path: "private/.env".to_owned(),
                    status: "credential_like".to_owned(),
                    byte_count: 92,
                    reason_code: Some("credential-pattern".to_owned()),
                },
                OwnerBrainPreviewRowViewV1 {
                    relative_path: "archive/brief.pdf".to_owned(),
                    status: "unsupported".to_owned(),
                    byte_count: 41_200,
                    reason_code: Some("unsupported-extension".to_owned()),
                },
            ],
        },
        imports: vec![
            OwnerBrainImportViewV1 {
                import_transaction_id: "import-running",
                state: "running",
                completed_items: 1,
                total_items: 3,
                error_code: None,
                can_cancel: true,
                can_retry: false,
            },
            OwnerBrainImportViewV1 {
                import_transaction_id: "import-cancelled",
                state: "cancelled",
                completed_items: 0,
                total_items: 3,
                error_code: Some("owner-cancelled"),
                can_cancel: false,
                can_retry: true,
            },
            OwnerBrainImportViewV1 {
                import_transaction_id: "import-failed",
                state: "failed",
                completed_items: 0,
                total_items: 3,
                error_code: Some("snapshot-changed"),
                can_cancel: false,
                can_retry: true,
            },
        ],
        ready: OwnerBrainFixtureStateV1 {
            availability: "ready",
            sources: vec![OwnerBrainSourceViewV1 {
                source_id: "source-fixture".to_owned(),
                source_kind: "text_folder".to_owned(),
                display_name: "Launch Notes".to_owned(),
                status: "ready".to_owned(),
                file_count: 1,
                chunk_count: 3,
                changed_file_count: 1,
                indexed_at: "2026-08-08T20:02:00Z".to_owned(),
            }],
            grants: vec![
                OwnerBrainGrantViewV1 {
                    grant_id: "grant-active".to_owned(),
                    source_id: "source-fixture".to_owned(),
                    resident_pubkey: resident.to_owned(),
                    resident_name: "Mara".to_owned(),
                    state: "active".to_owned(),
                    provider_egress: "local".to_owned(),
                    can_reconfirm: false,
                },
                OwnerBrainGrantViewV1 {
                    grant_id: "grant-stale".to_owned(),
                    source_id: "source-fixture".to_owned(),
                    resident_pubkey: resident.to_owned(),
                    resident_name: "Mara".to_owned(),
                    state: "stale".to_owned(),
                    provider_egress: "remote".to_owned(),
                    can_reconfirm: true,
                },
                OwnerBrainGrantViewV1 {
                    grant_id: "grant-revoked".to_owned(),
                    source_id: "source-fixture".to_owned(),
                    resident_pubkey: resident.to_owned(),
                    resident_name: "Mara".to_owned(),
                    state: "revoked".to_owned(),
                    provider_egress: "local".to_owned(),
                    can_reconfirm: false,
                },
            ],
            receipts: vec![OwnerBrainReceiptViewV1 {
                receipt_id: "receipt-fixture".to_owned(),
                source_id: "source-fixture".to_owned(),
                resident_pubkey: resident.to_owned(),
                status: "ready".to_owned(),
                selected_chunk_count: 2,
                truncated: false,
                created_at: "2026-08-08T20:03:00Z".to_owned(),
            }],
        },
        empty: state("empty"),
        locked: state("locked"),
        unavailable: state("unavailable"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brain_contract_fixtures_are_body_and_absolute_path_free() {
        let serialized = serde_json::to_string(&get_owner_brain_fixtures()).unwrap();
        for forbidden in ["canonicalPath", "sourceBody", "/Users/", "private_key"] {
            assert!(
                !serialized.contains(forbidden),
                "fixture leaked {forbidden}"
            );
        }
        assert!(serialized.contains("credential_like"));
        assert!(serialized.contains("duplicate"));
        assert!(serialized.contains("changed"));
        assert!(serialized.contains("skipped"));
        assert!(serialized.contains("snapshot-changed"));
        assert!(serialized.contains("stale"));
        assert!(serialized.contains("revoked"));
    }
}
