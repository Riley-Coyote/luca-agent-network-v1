//! V1.2 Brain Setup renderer commands and frozen development fixtures.
//!
//! Renderer responses contain no source bodies or absolute paths. The raw
//! preview token is a short-lived commit capability and is never logged.

use crate::{app_state::AppState, luca::owner_brain};
use luca_protocol::{
    Hex64, OpaqueId, OwnerBrainImportCommitV1, OwnerBrainPreviewRowStatusV1, OwnerBrainSourceKindV1,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewOwnerBrainSourceInputV1 {
    selected_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitOwnerBrainImportInputV1 {
    preview_id: String,
    preview_token: String,
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
    source_id: &'static str,
    source_kind: &'static str,
    display_name: &'static str,
    status: &'static str,
    file_count: u64,
    chunk_count: u64,
    changed_file_count: u64,
    indexed_at: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerBrainGrantViewV1 {
    grant_id: &'static str,
    source_id: &'static str,
    resident_pubkey: &'static str,
    resident_name: &'static str,
    state: &'static str,
    provider_egress: &'static str,
    can_reconfirm: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerBrainReceiptViewV1 {
    receipt_id: &'static str,
    source_id: &'static str,
    resident_pubkey: &'static str,
    status: &'static str,
    selected_chunk_count: u64,
    truncated: bool,
    created_at: &'static str,
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

#[tauri::command]
/// Performs a bounded, read-only preview of one owner-selected local source.
pub async fn preview_owner_brain_source(
    input: PreviewOwnerBrainSourceInputV1,
    app: AppHandle,
) -> Result<OwnerBrainPreviewViewV1, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner_pubkey = Hex64::parse(state.signing_keys()?.public_key().to_hex())
            .map_err(|_| "active owner identity is invalid".to_owned())?;
        state
            .preview_owner_brain_source(owner_pubkey, Path::new(&input.selected_path))
            .map(preview_view)
            .map_err(|error| error.code().to_owned())
    })
    .await
    .map_err(|_| "owner-brain-unavailable".to_owned())?
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
                    status: "accepted".to_owned(),
                    byte_count: 2_048,
                    reason_code: None,
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
                source_id: "source-fixture",
                source_kind: "text_folder",
                display_name: "Launch Notes",
                status: "ready",
                file_count: 1,
                chunk_count: 3,
                changed_file_count: 1,
                indexed_at: "2026-08-08T20:02:00Z",
            }],
            grants: vec![
                OwnerBrainGrantViewV1 {
                    grant_id: "grant-active",
                    source_id: "source-fixture",
                    resident_pubkey: resident,
                    resident_name: "Mara",
                    state: "active",
                    provider_egress: "local",
                    can_reconfirm: false,
                },
                OwnerBrainGrantViewV1 {
                    grant_id: "grant-stale",
                    source_id: "source-fixture",
                    resident_pubkey: resident,
                    resident_name: "Mara",
                    state: "stale",
                    provider_egress: "remote",
                    can_reconfirm: true,
                },
                OwnerBrainGrantViewV1 {
                    grant_id: "grant-revoked",
                    source_id: "source-fixture",
                    resident_pubkey: resident,
                    resident_name: "Mara",
                    state: "revoked",
                    provider_egress: "local",
                    can_reconfirm: false,
                },
            ],
            receipts: vec![OwnerBrainReceiptViewV1 {
                receipt_id: "receipt-fixture",
                source_id: "source-fixture",
                resident_pubkey: resident,
                status: "ready",
                selected_chunk_count: 2,
                truncated: false,
                created_at: "2026-08-08T20:03:00Z",
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
        assert!(serialized.contains("snapshot-changed"));
        assert!(serialized.contains("stale"));
        assert!(serialized.contains("revoked"));
    }
}
