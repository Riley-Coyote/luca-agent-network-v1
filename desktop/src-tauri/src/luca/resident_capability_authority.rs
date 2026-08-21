//! Local-only resident access levels and durable capability grants.
//!
//! This authority is keyed by the stable resident public key rather than a
//! mutable runtime binding, so grants survive model and harness changes. The
//! store is owner-only and never projected into relay events.

use std::collections::BTreeMap;

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
    Ok(managed_agents_base_dir(app)?.join(STORE_FILE))
}

fn load_store(app: &AppHandle) -> Result<CapabilityAuthorityStoreV1, String> {
    let path = store_path(app)?;
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

fn save_store(app: &AppHandle, store: &CapabilityAuthorityStoreV1) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|_| "capability settings could not be serialized")?;
    atomic_write_json_restricted(&store_path(app)?, &bytes)
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

pub(crate) fn settings(
    app: &AppHandle,
    owner_pubkey: &str,
) -> Result<ResidentCapabilitySettingsV1, String> {
    let mut store = load_store(app)?;
    let owner = owner_mut(&mut store, owner_pubkey);
    let result = ResidentCapabilitySettingsV1 {
        household_default: owner.household_default,
        resident_access: owner.resident_access.clone(),
        grants: owner
            .grants
            .iter()
            .filter(|grant| grant.revoked_at.is_none())
            .cloned()
            .collect(),
    };
    save_store(app, &store)?;
    Ok(result)
}

pub(crate) fn onboarding_status(
    app: &AppHandle,
    owner_pubkey: &str,
) -> Result<Option<OnboardingCapabilityStatusV1>, String> {
    let mut store = load_store(app)?;
    Ok(owner_mut(&mut store, owner_pubkey).onboarding.clone())
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
    let mut store = load_store(app)?;
    let status = OnboardingCapabilityStatusV1 {
        chapter: chapter.to_owned(),
        completed,
        updated_at: Utc::now().to_rfc3339(),
    };
    owner_mut(&mut store, owner_pubkey).onboarding = Some(status.clone());
    save_store(app, &store)?;
    Ok(status)
}

pub(crate) fn record_receipt(
    app: &AppHandle,
    owner_pubkey: &str,
    receipt: CapabilityReceiptV1,
) -> Result<(), String> {
    receipt.validate().map_err(|error| error.to_string())?;
    let mut store = load_store(app)?;
    let receipts = &mut owner_mut(&mut store, owner_pubkey).receipts;
    receipts.push(receipt);
    if receipts.len() > 1_000 {
        receipts.drain(..receipts.len() - 1_000);
    }
    save_store(app, &store)
}

pub(crate) fn receipt_count(app: &AppHandle, owner_pubkey: &str) -> Result<usize, String> {
    let mut store = load_store(app)?;
    Ok(owner_mut(&mut store, owner_pubkey).receipts.len())
}

pub(crate) fn set_household_default(
    app: &AppHandle,
    owner_pubkey: &str,
    level: ResidentAccessLevel,
) -> Result<ResidentCapabilitySettingsV1, String> {
    let mut store = load_store(app)?;
    owner_mut(&mut store, owner_pubkey).household_default = level;
    save_store(app, &store)?;
    settings(app, owner_pubkey)
}

pub(crate) fn set_resident_access(
    app: &AppHandle,
    owner_pubkey: &str,
    resident_pubkey: &str,
    level: Option<ResidentAccessLevel>,
) -> Result<ResidentCapabilitySettingsV1, String> {
    let resident_pubkey = validate_pubkey(resident_pubkey)?;
    let mut store = load_store(app)?;
    let owner = owner_mut(&mut store, owner_pubkey);
    match level {
        Some(level) => {
            owner.resident_access.insert(resident_pubkey, level);
        }
        None => {
            owner.resident_access.remove(&resident_pubkey);
        }
    }
    save_store(app, &store)?;
    settings(app, owner_pubkey)
}

pub(crate) fn effective_access(
    app: &AppHandle,
    owner_pubkey: &str,
    resident_pubkey: &str,
) -> Result<ResidentAccessLevel, String> {
    let resident_pubkey = validate_pubkey(resident_pubkey)?;
    let mut store = load_store(app)?;
    let owner = owner_mut(&mut store, owner_pubkey);
    Ok(owner
        .resident_access
        .get(&resident_pubkey)
        .copied()
        .unwrap_or(owner.household_default))
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
    let mut store = load_store(app)?;
    let owner = owner_mut(&mut store, owner_pubkey);
    if let Some(existing) = owner.grants.iter_mut().find(|grant| {
        grant.resident_pubkey == resident_pubkey
            && grant.capability == capability
            && grant.resource.kind == resource.kind
            && grant.resource.resource_ref == resource.resource_ref
    }) {
        existing.revoked_at = None;
        let existing = existing.clone();
        save_store(app, &store)?;
        return Ok(existing);
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
    save_store(app, &store)?;
    Ok(created)
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
    let mut store = load_store(app)?;
    let owner = owner_mut(&mut store, owner_pubkey);
    Ok(owner.grants.iter().any(|grant| {
        grant_matches(
            grant,
            &resident_pubkey,
            capability,
            resource_kind,
            resource_ref,
        )
    }))
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
    let mut store = load_store(app)?;
    let owner = owner_mut(&mut store, owner_pubkey);
    let grant = owner
        .grants
        .iter_mut()
        .find(|grant| grant.grant_id.as_str() == grant_id && grant.revoked_at.is_none())
        .ok_or_else(|| "capability grant was not found".to_string())?;
    grant.revoked_at = Some(Utc::now().to_rfc3339());
    save_store(app, &store)?;
    settings(app, owner_pubkey)
}

#[cfg(test)]
mod tests {
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
}
