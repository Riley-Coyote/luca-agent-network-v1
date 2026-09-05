//! Body-free provenance links kept separate from the existing native ledger.
//! Older application versions can still read all native transactions and preferences.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::AppHandle;

use crate::luca::operator_forge::{NativeProvisioningStatusV1, NativeProvisioningTransactionV1};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct NativeProposalLink {
    schema_version: u32,
    owner_pubkey: String,
    transaction_id: String,
    request_id: String,
    request_hash: String,
}

fn link_path(app: &AppHandle, owner: &str, transaction: &str) -> Result<PathBuf, String> {
    let name = hex::encode(Sha256::digest(format!("{owner}\0{transaction}")));
    Ok(crate::managed_agents::managed_agents_base_dir(app)?
        .join("resident-proposal-links-v1")
        .join(format!("{name}.json")))
}

fn matches(
    link: &NativeProposalLink,
    transaction: &NativeProvisioningTransactionV1,
    request: &str,
) -> bool {
    link.schema_version == 1
        && link.owner_pubkey == transaction.owner_pubkey
        && link.transaction_id == transaction.transaction_id
        && link.request_id == request
        && link.request_hash == transaction.request_hash
}

fn read(
    app: &AppHandle,
    transaction: &NativeProvisioningTransactionV1,
) -> Result<Option<NativeProposalLink>, String> {
    let path = link_path(app, &transaction.owner_pubkey, &transaction.transaction_id)?;
    read_path(&path)
}

fn read_path(path: &Path) -> Result<Option<NativeProposalLink>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Native proposal provenance is unavailable.".into()),
    };
    if !metadata.is_file() || metadata.len() > 4096 {
        return Err("Native proposal provenance is invalid.".into());
    }
    let bytes = fs::read(path).map_err(|_| "Native proposal provenance is unavailable.")?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| "Native proposal provenance is invalid.".into())
}

pub(super) fn validate_execution(
    app: &AppHandle,
    transaction: &NativeProvisioningTransactionV1,
    request: Option<&str>,
) -> Result<(), String> {
    let Some(link) = read(app, transaction)? else {
        return Ok(());
    };
    if !request.is_some_and(|request| matches(&link, transaction, request)) {
        return Err(
            "This native transaction requires its originating conversation request.".into(),
        );
    }
    Ok(())
}

pub(super) fn require_completed_link(
    app: &AppHandle,
    transaction: &NativeProvisioningTransactionV1,
    request: &str,
) -> Result<(), String> {
    if !read(app, transaction)?
        .as_ref()
        .is_some_and(|link| matches(link, transaction, request))
    {
        return Err("Native setup receipt does not belong to this conversation request.".into());
    }
    Ok(())
}

fn validate_first_binding(
    transaction: &NativeProvisioningTransactionV1,
    proposal_created_at: &str,
) -> Result<(), String> {
    let transaction_time = chrono::DateTime::parse_from_rfc3339(&transaction.created_at)
        .map_err(|_| "Native preview time is unavailable.")?;
    let proposal_time = chrono::DateTime::parse_from_rfc3339(proposal_created_at)
        .map_err(|_| "Resident proposal time is unavailable.")?;
    if transaction.status != NativeProvisioningStatusV1::Planned || transaction_time < proposal_time
    {
        return Err("Choose a fresh native preview for this creation request.".into());
    }
    Ok(())
}

pub(super) fn bind(
    app: &AppHandle,
    transaction: &NativeProvisioningTransactionV1,
    request: &str,
    proposal_created_at: &str,
) -> Result<(), String> {
    if let Some(link) = read(app, transaction)? {
        return if matches(&link, transaction, request) {
            Ok(())
        } else {
            Err("Native setup belongs to another request or preview.".into())
        };
    }
    validate_first_binding(transaction, proposal_created_at)?;
    let path = link_path(app, &transaction.owner_pubkey, &transaction.transaction_id)?;
    let directory = path
        .parent()
        .ok_or("Native proposal directory is unavailable.")?;
    match fs::symlink_metadata(directory) {
        Ok(metadata) if !metadata.is_dir() => {
            return Err("Native proposal directory is invalid.".into())
        }
        Ok(_) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(directory).map_err(|_| "Native proposal directory is unavailable.")?;
        }
        Err(_) => return Err("Native proposal directory is unavailable.".into()),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Native proposal directory could not be secured.")?;
    }
    let payload = serde_json::to_vec(&NativeProposalLink {
        schema_version: 1,
        owner_pubkey: transaction.owner_pubkey.clone(),
        transaction_id: transaction.transaction_id.clone(),
        request_id: request.to_owned(),
        request_hash: transaction.request_hash.clone(),
    })
    .map_err(|_| "Native proposal provenance could not be encoded.")?;
    crate::managed_agents::storage::atomic_write_json_restricted(&path, &payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::luca::operator_forge::{AgentProvisioningModeV1, NativeRuntimeFamilyV1};
    fn transaction() -> NativeProvisioningTransactionV1 {
        NativeProvisioningTransactionV1 {
            schema_version: 1,
            transaction_id: "transaction-1".into(),
            owner_pubkey: "a".repeat(64),
            runtime: NativeRuntimeFamilyV1::Hermes,
            mode: AgentProvisioningModeV1::Fresh,
            intended_slug: "test-helper".into(),
            request_hash: "b".repeat(64),
            source_hash: None,
            persona_id: None,
            reserved_resident_pubkey: None,
            native_semantic_hash: None,
            status: NativeProvisioningStatusV1::Planned,
            error_code: None,
            recovery_action: None,
            created_at: "2026-09-05T10:00:01Z".into(),
            updated_at: "2026-09-05T10:00:01Z".into(),
        }
    }
    #[test]
    fn an_old_or_completed_transaction_cannot_be_adopted_by_a_new_proposal() {
        let mut transaction = transaction();
        assert!(validate_first_binding(&transaction, "2026-09-05T10:00:00Z").is_ok());
        assert!(validate_first_binding(&transaction, "2026-09-05T10:00:02Z").is_err());
        for status in [
            NativeProvisioningStatusV1::Complete,
            NativeProvisioningStatusV1::Provisioning,
            NativeProvisioningStatusV1::RolledBack,
        ] {
            transaction.status = status;
            assert!(validate_first_binding(&transaction, "2026-09-05T10:00:00Z").is_err());
        }
    }
    #[test]
    fn every_provenance_coordinate_must_match() {
        let transaction = transaction();
        let mut link = NativeProposalLink {
            schema_version: 1,
            owner_pubkey: transaction.owner_pubkey.clone(),
            transaction_id: transaction.transaction_id.clone(),
            request_id: "request-1".into(),
            request_hash: transaction.request_hash.clone(),
        };
        assert!(matches(&link, &transaction, "request-1"));
        assert!(!matches(&link, &transaction, "request-2"));
        for field in [
            "ownerPubkey",
            "transactionId",
            "requestHash",
            "schemaVersion",
        ] {
            let mut value = serde_json::to_value(&link).expect("link");
            value[field] = if field == "schemaVersion" {
                serde_json::json!(2)
            } else {
                serde_json::json!("wrong")
            };
            let changed = serde_json::from_value(value).expect("shape");
            assert!(!matches(&changed, &transaction, "request-1"), "{field}");
        }
        link.request_id = "request-2".into();
        assert!(!matches(&link, &transaction, "request-1"));
    }
    #[test]
    fn native_ledger_encoding_remains_unchanged_and_contains_no_proposal_field() {
        let value = serde_json::to_value(transaction()).expect("transaction");
        assert!(value.get("residentProposalId").is_none());
        assert!(serde_json::from_value::<NativeProvisioningTransactionV1>(value).is_ok());
    }

    #[test]
    fn provenance_files_fail_closed_on_malformed_oversized_or_non_file_content() {
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("link.json");
        assert!(read_path(&path).expect("absent").is_none());
        for bytes in [
            b"not json".to_vec(),
            vec![b'x'; 4097],
            b"{\"unexpected\":true}".to_vec(),
        ] {
            fs::write(&path, bytes).expect("fixture data");
            assert!(read_path(&path).is_err());
        }
        fs::remove_file(&path).expect("fixture removal");
        fs::create_dir(&path).expect("fixture directory");
        assert!(read_path(&path).is_err());
        #[cfg(unix)]
        {
            fs::remove_dir(&path).expect("fixture removal");
            let target = directory.path().join("target.json");
            fs::write(&target, b"{}").expect("target");
            std::os::unix::fs::symlink(target, &path).expect("fixture symlink");
            assert!(read_path(&path).is_err());
        }
    }
}
