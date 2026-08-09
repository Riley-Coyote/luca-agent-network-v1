//! Frozen V1.2 Brain Setup renderer fixtures and command vocabulary.
//!
//! The fixtures contain no source bodies or absolute paths and are suitable
//! only for deterministic frontend development and tests.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerBrainPreviewRowViewV1 {
    relative_path: &'static str,
    status: &'static str,
    byte_count: u64,
    reason_code: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerBrainPreviewViewV1 {
    preview_id: &'static str,
    source_kind: &'static str,
    display_name: &'static str,
    accepted_bytes: u64,
    write_count: u64,
    expires_at: &'static str,
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

#[tauri::command]
/// Returns deterministic body-free fixtures for V1.2 Brain Setup development.
pub fn get_owner_brain_fixtures() -> OwnerBrainFixturesV1 {
    let resident = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    OwnerBrainFixturesV1 {
        preview: OwnerBrainPreviewViewV1 {
            preview_id: "preview-fixture",
            source_kind: "text_folder",
            display_name: "Launch Notes",
            accepted_bytes: 2_048,
            write_count: 0,
            expires_at: "2026-08-08T20:15:00Z",
            can_commit: true,
            rows: vec![
                OwnerBrainPreviewRowViewV1 {
                    relative_path: "planning/launch.md",
                    status: "accepted",
                    byte_count: 2_048,
                    reason_code: None,
                },
                OwnerBrainPreviewRowViewV1 {
                    relative_path: "private/.env",
                    status: "credential_like",
                    byte_count: 92,
                    reason_code: Some("credential-pattern"),
                },
                OwnerBrainPreviewRowViewV1 {
                    relative_path: "archive/brief.pdf",
                    status: "unsupported",
                    byte_count: 41_200,
                    reason_code: Some("unsupported-extension"),
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
