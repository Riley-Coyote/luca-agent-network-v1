//! Local-only resident access levels and durable capability grants.
//!
//! This authority is keyed by the stable resident public key rather than a
//! mutable runtime binding, so grants survive model and harness changes. The
//! store is owner-only and never projected into relay events.

use std::{
    collections::BTreeMap,
    path::Path,
    sync::{Mutex, OnceLock},
};

use chrono::Utc;
use luca_protocol::{
    CapabilityKind, CapabilityReceiptV1, CapabilityResourceV1, DurableCapabilityGrantV1, Hex64,
    OpaqueId, ResidentAccessLevel,
};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::managed_agents::storage::{atomic_write_json_restricted, managed_agents_base_dir};

const SCHEMA_VERSION: u32 = 1;
const STORE_FILE: &str = "resident-capability-authority-v1.json";
const STORE_UNAVAILABLE: &str = "capability settings are unavailable";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OwnerCapabilityAuthorityV1 {
    owner_pubkey: String,
    #[serde(default)]
    household_default: ResidentAccessLevel,
    #[serde(default)]
    resident_access: BTreeMap<String, ResidentAccessLevel>,
    #[serde(default)]
    grants: Vec<DurableCapabilityGrantV1>,
    #[serde(default)]
    onboarding: Option<OnboardingCapabilityStatusV1>,
    #[serde(default)]
    receipts: Vec<CapabilityReceiptV1>,
}

impl OwnerCapabilityAuthorityV1 {
    fn new(owner_pubkey: String) -> Self {
        Self {
            owner_pubkey,
            household_default: ResidentAccessLevel::Standard,
            resident_access: BTreeMap::new(),
            grants: Vec::new(),
            onboarding: None,
            receipts: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CapabilityAuthorityStoreV1 {
    #[serde(default = "schema_version")]
    schema_version: u32,
    #[serde(default)]
    owners: Vec<OwnerCapabilityAuthorityV1>,
}

impl Default for CapabilityAuthorityStoreV1 {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            owners: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResidentCapabilitySettingsV1 {
    pub household_default: ResidentAccessLevel,
    pub resident_access: BTreeMap<String, ResidentAccessLevel>,
    pub grants: Vec<DurableCapabilityGrantV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OnboardingCapabilityStatusV1 {
    pub chapter: String,
    pub completed: bool,
    pub updated_at: String,
}

fn schema_version() -> u32 {
    SCHEMA_VERSION
}

fn store_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    redact_store_path_result(managed_agents_base_dir(app).map(|base| base.join(STORE_FILE)))
}

fn redact_store_path_result<T>(result: Result<T, String>) -> Result<T, String> {
    result.map_err(|_| {
        eprintln!("buzz-desktop: capability authority storage location is unavailable");
        STORE_UNAVAILABLE.to_owned()
    })
}

fn store_transaction() -> &'static Mutex<()> {
    static TRANSACTION: OnceLock<Mutex<()>> = OnceLock::new();
    TRANSACTION.get_or_init(|| Mutex::new(()))
}

fn load_store(path: &Path) -> Result<CapabilityAuthorityStoreV1, String> {
    if !path.exists() {
        return Ok(CapabilityAuthorityStoreV1::default());
    }
    let bytes = std::fs::read(path).map_err(|_| "capability settings could not be read")?;
    let store: CapabilityAuthorityStoreV1 =
        serde_json::from_slice(&bytes).map_err(|_| "capability settings are invalid")?;
    if store.schema_version != SCHEMA_VERSION {
        return Err("capability settings use an unsupported schema version".into());
    }
    Ok(store)
}

fn save_store(path: &Path, store: &CapabilityAuthorityStoreV1) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|_| "capability settings could not be serialized")?;
    atomic_write_json_restricted(path, &bytes).map_err(|_| {
        eprintln!("buzz-desktop: capability authority persistence failed");
        "capability settings could not be persisted".to_owned()
    })
}

fn mutate_store<T>(
    path: &Path,
    mutate: impl FnOnce(&mut CapabilityAuthorityStoreV1) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = store_transaction()
        .lock()
        .map_err(|_| "capability settings are temporarily unavailable".to_owned())?;
    let mut store = load_store(path)?;
    let result = mutate(&mut store)?;
    save_store(path, &store)?;
    Ok(result)
}

fn read_store<T>(
    path: &Path,
    read: impl FnOnce(&CapabilityAuthorityStoreV1) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = store_transaction()
        .lock()
        .map_err(|_| "capability settings are temporarily unavailable".to_owned())?;
    let store = load_store(path)?;
    read(&store)
}

fn owner_mut<'a>(
    store: &'a mut CapabilityAuthorityStoreV1,
    owner_pubkey: &str,
) -> &'a mut OwnerCapabilityAuthorityV1 {
    let index = store
        .owners
        .iter()
        .position(|owner| owner.owner_pubkey == owner_pubkey)
        .unwrap_or_else(|| {
            store
                .owners
                .push(OwnerCapabilityAuthorityV1::new(owner_pubkey.to_owned()));
            store.owners.len() - 1
        });
    &mut store.owners[index]
}

fn validate_pubkey(value: &str) -> Result<String, String> {
    Hex64::parse(value.to_ascii_lowercase())
        .map(|value| value.as_str().to_owned())
        .map_err(|_| "resident public key is invalid".into())
}

fn settings_snapshot(owner: &OwnerCapabilityAuthorityV1) -> ResidentCapabilitySettingsV1 {
    ResidentCapabilitySettingsV1 {
        household_default: owner.household_default,
        resident_access: owner.resident_access.clone(),
        grants: owner
            .grants
            .iter()
            .filter(|grant| grant.revoked_at.is_none())
            .cloned()
            .collect(),
    }
}

pub(crate) fn settings(
    app: &AppHandle,
    owner_pubkey: &str,
) -> Result<ResidentCapabilitySettingsV1, String> {
    let path = store_path(app)?;
    mutate_store(&path, |store| {
        Ok(settings_snapshot(owner_mut(store, owner_pubkey)))
    })
}

pub(crate) fn onboarding_status(
    app: &AppHandle,
    owner_pubkey: &str,
) -> Result<Option<OnboardingCapabilityStatusV1>, String> {
    let path = store_path(app)?;
    read_store(&path, |store| {
        Ok(store
            .owners
            .iter()
            .find(|owner| owner.owner_pubkey == owner_pubkey)
            .and_then(|owner| owner.onboarding.clone()))
    })
}

pub(crate) fn set_onboarding_status(
    app: &AppHandle,
    owner_pubkey: &str,
    chapter: &str,
    completed: bool,
) -> Result<OnboardingCapabilityStatusV1, String> {
    if !matches!(
        chapter,
        "welcome" | "runtime" | "agents" | "preparing" | "complete"
    ) {
        return Err("onboarding chapter is invalid".into());
    }
    let path = store_path(app)?;
    mutate_store(&path, |store| {
        let status = OnboardingCapabilityStatusV1 {
            chapter: chapter.to_owned(),
            completed,
            updated_at: Utc::now().to_rfc3339(),
        };
        owner_mut(store, owner_pubkey).onboarding = Some(status.clone());
        Ok(status)
    })
}

pub(crate) fn record_receipt(
    app: &AppHandle,
    owner_pubkey: &str,
    receipt: CapabilityReceiptV1,
) -> Result<(), String> {
    receipt.validate().map_err(|error| error.to_string())?;
    let path = store_path(app)?;
    mutate_store(&path, |store| {
        let receipts = &mut owner_mut(store, owner_pubkey).receipts;
        receipts.push(receipt);
        if receipts.len() > 1_000 {
            receipts.drain(..receipts.len() - 1_000);
        }
        Ok(())
    })
}

pub(crate) fn receipt_count(app: &AppHandle, owner_pubkey: &str) -> Result<usize, String> {
    let path = store_path(app)?;
    read_store(&path, |store| {
        Ok(store
            .owners
            .iter()
            .find(|owner| owner.owner_pubkey == owner_pubkey)
            .map_or(0, |owner| owner.receipts.len()))
    })
}

pub(crate) fn set_household_default(
    app: &AppHandle,
    owner_pubkey: &str,
    level: ResidentAccessLevel,
) -> Result<ResidentCapabilitySettingsV1, String> {
    let path = store_path(app)?;
    mutate_store(&path, |store| {
        let owner = owner_mut(store, owner_pubkey);
        owner.household_default = level;
        Ok(settings_snapshot(owner))
    })
}

pub(crate) fn set_resident_access(
    app: &AppHandle,
    owner_pubkey: &str,
    resident_pubkey: &str,
    level: Option<ResidentAccessLevel>,
) -> Result<ResidentCapabilitySettingsV1, String> {
    let resident_pubkey = validate_pubkey(resident_pubkey)?;
    let path = store_path(app)?;
    mutate_store(&path, |store| {
        let owner = owner_mut(store, owner_pubkey);
        match level {
            Some(level) => {
                owner.resident_access.insert(resident_pubkey, level);
            }
            None => {
                owner.resident_access.remove(&resident_pubkey);
            }
        }
        Ok(settings_snapshot(owner))
    })
}

pub(crate) fn effective_access(
    app: &AppHandle,
    owner_pubkey: &str,
    resident_pubkey: &str,
) -> Result<ResidentAccessLevel, String> {
    let resident_pubkey = validate_pubkey(resident_pubkey)?;
    let path = store_path(app)?;
    read_store(&path, |store| {
        let owner = store
            .owners
            .iter()
            .find(|owner| owner.owner_pubkey == owner_pubkey);
        Ok(owner
            .and_then(|owner| owner.resident_access.get(&resident_pubkey).copied())
            .or_else(|| owner.map(|owner| owner.household_default))
            .unwrap_or_default())
    })
}

pub(crate) fn grant(
    app: &AppHandle,
    owner_pubkey: &str,
    resident_pubkey: &str,
    capability: CapabilityKind,
    resource: CapabilityResourceV1,
) -> Result<DurableCapabilityGrantV1, String> {
    resource.validate().map_err(|error| error.to_string())?;
    let resident_pubkey = Hex64::parse(validate_pubkey(resident_pubkey)?)
        .map_err(|_| "resident public key is invalid")?;
    let path = store_path(app)?;
    mutate_store(&path, |store| {
        let owner = owner_mut(store, owner_pubkey);
        if let Some(existing) = owner.grants.iter_mut().find(|grant| {
            grant.resident_pubkey == resident_pubkey
                && grant.capability == capability
                && grant.resource.kind == resource.kind
                && grant.resource.resource_ref == resource.resource_ref
        }) {
            existing.revoked_at = None;
            return Ok(existing.clone());
        }
        let created = DurableCapabilityGrantV1 {
            grant_id: OpaqueId::parse(uuid::Uuid::new_v4().to_string())
                .map_err(|_| "capability grant id is invalid")?,
            resident_pubkey,
            capability,
            resource,
            created_at: Utc::now().to_rfc3339(),
            revoked_at: None,
        };
        owner.grants.push(created.clone());
        Ok(created)
    })
}

pub(crate) fn is_granted(
    app: &AppHandle,
    owner_pubkey: &str,
    resident_pubkey: &str,
    capability: CapabilityKind,
    resource_kind: &str,
    resource_ref: &str,
) -> Result<bool, String> {
    let resident_pubkey = validate_pubkey(resident_pubkey)?;
    let path = store_path(app)?;
    read_store(&path, |store| {
        Ok(store
            .owners
            .iter()
            .find(|owner| owner.owner_pubkey == owner_pubkey)
            .is_some_and(|owner| {
                owner.grants.iter().any(|grant| {
                    grant_matches(
                        grant,
                        &resident_pubkey,
                        capability,
                        resource_kind,
                        resource_ref,
                    )
                })
            }))
    })
}

fn grant_matches(
    grant: &DurableCapabilityGrantV1,
    resident_pubkey: &str,
    capability: CapabilityKind,
    resource_kind: &str,
    resource_ref: &str,
) -> bool {
    grant.revoked_at.is_none()
        && grant.resident_pubkey.as_str() == resident_pubkey
        && grant.capability == capability
        && grant.resource.kind == resource_kind
        && grant.resource.resource_ref == resource_ref
}

pub(crate) fn revoke(
    app: &AppHandle,
    owner_pubkey: &str,
    grant_id: &str,
) -> Result<ResidentCapabilitySettingsV1, String> {
    let path = store_path(app)?;
    mutate_store(&path, |store| {
        let owner = owner_mut(store, owner_pubkey);
        let grant = owner
            .grants
            .iter_mut()
            .find(|grant| grant.grant_id.as_str() == grant_id && grant.revoked_at.is_none())
            .ok_or_else(|| "capability grant was not found".to_string())?;
        grant.revoked_at = Some(Utc::now().to_rfc3339());
        Ok(settings_snapshot(owner))
    })
}

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Barrier,
    };

    use super::*;

    #[test]
    fn new_owner_defaults_to_standard() {
        let mut store = CapabilityAuthorityStoreV1::default();
        let owner = owner_mut(&mut store, &"aa".repeat(32));
        assert_eq!(owner.household_default, ResidentAccessLevel::Standard);
        assert!(owner.grants.is_empty());
    }

    fn test_grant() -> DurableCapabilityGrantV1 {
        DurableCapabilityGrantV1 {
            grant_id: OpaqueId::parse("grant-1").unwrap(),
            resident_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
            capability: CapabilityKind::FilesystemWrite,
            resource: CapabilityResourceV1 {
                kind: "repository".into(),
                resource_ref: "repo-1".into(),
                display_name: "Repository".into(),
            },
            created_at: Utc::now().to_rfc3339(),
            revoked_at: None,
        }
    }

    fn test_receipt(id: &str) -> CapabilityReceiptV1 {
        CapabilityReceiptV1 {
            protocol: luca_protocol::CAPABILITY_RECEIPT_PROTOCOL.into(),
            receipt_id: OpaqueId::parse(id).unwrap(),
            resident_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
            conversation_id: OpaqueId::parse("conversation-1").unwrap(),
            capability: CapabilityKind::FilesystemWrite,
            operation_fingerprint: luca_protocol::Sha256Ref::parse(format!(
                "sha256:{}",
                "22".repeat(32)
            ))
            .unwrap(),
            status: luca_protocol::CapabilityReceiptStatus::Committed,
            summary: "Synthetic redacted receipt".into(),
        }
    }

    fn initialize_owner(path: &Path, owner_pubkey: &str) {
        mutate_store(path, |store| {
            owner_mut(store, owner_pubkey).grants.push(test_grant());
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn grants_match_exact_resident_capability_and_resource() {
        let grant = test_grant();
        assert!(grant_matches(
            &grant,
            grant.resident_pubkey.as_str(),
            CapabilityKind::FilesystemWrite,
            "repository",
            "repo-1"
        ));
        assert!(!grant_matches(
            &grant,
            &"22".repeat(32),
            CapabilityKind::FilesystemWrite,
            "repository",
            "repo-1"
        ));
        assert!(!grant_matches(
            &grant,
            grant.resident_pubkey.as_str(),
            CapabilityKind::ProcessExecute,
            "repository",
            "repo-1"
        ));
        assert!(!grant_matches(
            &grant,
            grant.resident_pubkey.as_str(),
            CapabilityKind::FilesystemWrite,
            "repository",
            "repo-2"
        ));
    }

    #[test]
    fn revocation_denies_and_grants_do_not_depend_on_runtime_binding() {
        let mut grant = test_grant();
        // Runtime/model is deliberately absent from the match inputs, so the
        // stable resident grant survives a harness swap.
        grant.revoked_at = Some(Utc::now().to_rfc3339());
        assert!(!grant_matches(
            &grant,
            grant.resident_pubkey.as_str(),
            CapabilityKind::FilesystemWrite,
            "repository",
            "repo-1"
        ));
    }

    #[test]
    fn interleaved_receipt_append_cannot_resurrect_a_revoked_grant() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join(STORE_FILE);
        let owner_pubkey = "aa".repeat(32);
        initialize_owner(&path, &owner_pubkey);

        let receipt_inside = Arc::new(AtomicBool::new(false));
        let revoke_attempting = Arc::new(AtomicBool::new(false));
        let receipt_path = path.clone();
        let receipt_owner = owner_pubkey.clone();
        let receipt_inside_thread = Arc::clone(&receipt_inside);
        let revoke_attempting_thread = Arc::clone(&revoke_attempting);
        let receipt_thread = std::thread::spawn(move || {
            mutate_store(&receipt_path, |store| {
                receipt_inside_thread.store(true, Ordering::SeqCst);
                while !revoke_attempting_thread.load(Ordering::SeqCst) {
                    std::thread::yield_now();
                }
                owner_mut(store, &receipt_owner)
                    .receipts
                    .push(test_receipt("receipt-interleaved"));
                Ok(())
            })
        });
        while !receipt_inside.load(Ordering::SeqCst) {
            std::thread::yield_now();
        }
        let revoke_path = path.clone();
        let revoke_owner = owner_pubkey.clone();
        let revoke_attempting_thread = Arc::clone(&revoke_attempting);
        let revoke_thread = std::thread::spawn(move || {
            revoke_attempting_thread.store(true, Ordering::SeqCst);
            mutate_store(&revoke_path, |store| {
                owner_mut(store, &revoke_owner).grants[0].revoked_at =
                    Some(Utc::now().to_rfc3339());
                Ok(())
            })
        });
        receipt_thread.join().unwrap().unwrap();
        revoke_thread.join().unwrap().unwrap();

        read_store(&path, |store| {
            let owner = store
                .owners
                .iter()
                .find(|owner| owner.owner_pubkey == owner_pubkey)
                .unwrap();
            assert_eq!(owner.receipts.len(), 1);
            assert!(owner.grants[0].revoked_at.is_some());
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn concurrent_receipt_appends_both_survive() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join(STORE_FILE);
        let owner_pubkey = "aa".repeat(32);
        let barrier = Arc::new(Barrier::new(3));
        let mut threads = Vec::new();
        for id in ["receipt-one", "receipt-two"] {
            let path = path.clone();
            let owner_pubkey = owner_pubkey.clone();
            let barrier = Arc::clone(&barrier);
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                mutate_store(&path, |store| {
                    owner_mut(store, &owner_pubkey)
                        .receipts
                        .push(test_receipt(id));
                    Ok(())
                })
            }));
        }
        barrier.wait();
        for thread in threads {
            thread.join().unwrap().unwrap();
        }
        read_store(&path, |store| {
            assert_eq!(store.owners[0].receipts.len(), 2);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn concurrent_access_and_grant_updates_cannot_overwrite_each_other() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join(STORE_FILE);
        let owner_pubkey = "aa".repeat(32);
        let barrier = Arc::new(Barrier::new(3));

        let access_path = path.clone();
        let access_owner = owner_pubkey.clone();
        let access_barrier = Arc::clone(&barrier);
        let access = std::thread::spawn(move || {
            access_barrier.wait();
            mutate_store(&access_path, |store| {
                owner_mut(store, &access_owner).household_default = ResidentAccessLevel::Full;
                Ok(())
            })
        });
        let grant_path = path.clone();
        let grant_owner = owner_pubkey.clone();
        let grant_barrier = Arc::clone(&barrier);
        let grant = std::thread::spawn(move || {
            grant_barrier.wait();
            mutate_store(&grant_path, |store| {
                owner_mut(store, &grant_owner).grants.push(test_grant());
                Ok(())
            })
        });
        barrier.wait();
        access.join().unwrap().unwrap();
        grant.join().unwrap().unwrap();
        read_store(&path, |store| {
            assert_eq!(store.owners[0].household_default, ResidentAccessLevel::Full);
            assert_eq!(store.owners[0].grants.len(), 1);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn persistence_failure_is_redacted_at_the_authority_boundary() {
        let temporary = tempfile::tempdir().unwrap();
        let sensitive_path = temporary.path().join("private-owner-path");
        std::fs::create_dir(&sensitive_path).unwrap();
        let error = save_store(&sensitive_path, &CapabilityAuthorityStoreV1::default())
            .expect_err("directory target must fail");
        assert_eq!(error, "capability settings could not be persisted");
        assert!(!error.contains(&sensitive_path.to_string_lossy().to_string()));
        assert!(!error.to_ascii_lowercase().contains("directory"));
    }

    #[test]
    fn storage_location_failure_cannot_expose_path_or_os_error() {
        let raw = "failed to create /Users/owner/Library/Application Support/Luca: permission denied";
        let error = redact_store_path_result::<std::path::PathBuf>(Err(raw.into()))
            .expect_err("synthetic base-directory failure");
        assert_eq!(error, STORE_UNAVAILABLE);
        assert!(!error.contains("/Users/owner"));
        assert!(!error.to_ascii_lowercase().contains("permission"));
    }
}
