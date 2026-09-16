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
    OpaqueId, PermissionRuleV1, ResidentAccessLevel, MAX_PERMISSION_RULES_PER_OWNER,
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
    /// Remembered answers to permission cards. Absent on every store file
    /// written before beta.11, which is why this is `#[serde(default)]` and the
    /// schema version is deliberately unchanged: an older file still loads.
    #[serde(default)]
    rules: Vec<PermissionRuleV1>,
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
            rules: Vec::new(),
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
    pub rules: Vec<PermissionRuleV1>,
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
        luca_log!(
            info,
            "buzz-desktop: capability authority storage location is unavailable"
        );
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
        luca_log!(
            warn,
            "buzz-desktop: capability authority persistence failed"
        );
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
        rules: owner
            .rules
            .iter()
            .filter(|rule| rule.revoked_at.is_none())
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

/// The onboarding flow mirrors each chapter it reaches, "brain" included.
fn is_valid_onboarding_chapter(chapter: &str) -> bool {
    matches!(
        chapter,
        "welcome" | "runtime" | "agents" | "brain" | "preparing" | "complete"
    )
}

fn store_has_completed_onboarding(store: &CapabilityAuthorityStoreV1) -> bool {
    store.owners.iter().any(|owner| {
        owner
            .onboarding
            .as_ref()
            .is_some_and(|status| status.completed)
    })
}

/// True when any owner on this install finished onboarding. A missing store
/// means nobody has: this is the app's first run.
pub(crate) fn any_owner_completed_onboarding(app: &AppHandle) -> Result<bool, String> {
    completed_onboarding_at(&store_path(app)?)
}

/// The same question, asked of an agents directory resolved without an
/// `AppHandle`.
///
/// The first-run init script has to answer it while the Tauri builder is still
/// being assembled — before any `App` exists, and so before `store_path` can be
/// called at all. Unlike [`managed_agents_base_dir`] this only ever reads: a
/// question asked this early must not create the directory it is asking about.
pub(crate) fn any_owner_completed_onboarding_in(agents_dir: &Path) -> Result<bool, String> {
    completed_onboarding_at(&agents_dir.join(STORE_FILE))
}

fn completed_onboarding_at(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    read_store(path, |store| Ok(store_has_completed_onboarding(store)))
}

pub(crate) fn set_onboarding_status(
    app: &AppHandle,
    owner_pubkey: &str,
    chapter: &str,
    completed: bool,
) -> Result<OnboardingCapabilityStatusV1, String> {
    if !is_valid_onboarding_chapter(chapter) {
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

/// True when two rules say the same thing about the same resident. The rule id,
/// its display sentence and its usage counters are deliberately not compared:
/// answering the same card twice must not grow the list.
fn rule_is_same_answer(existing: &PermissionRuleV1, candidate: &PermissionRuleV1) -> bool {
    existing.resident_pubkey == candidate.resident_pubkey
        && existing.scope == candidate.scope
        && existing.matcher == candidate.matcher
        && existing.effect == candidate.effect
}

/// Remember one owner-minted answer. An exact duplicate is un-revoked in place
/// rather than appended, mirroring [`grant`].
pub(crate) fn upsert_rule(
    app: &AppHandle,
    owner_pubkey: &str,
    rule: PermissionRuleV1,
) -> Result<PermissionRuleV1, String> {
    upsert_rule_at(&store_path(app)?, owner_pubkey, rule)
}

fn upsert_rule_at(
    path: &Path,
    owner_pubkey: &str,
    rule: PermissionRuleV1,
) -> Result<PermissionRuleV1, String> {
    rule.validate().map_err(|error| error.to_string())?;
    mutate_store(path, |store| {
        let owner = owner_mut(store, owner_pubkey);
        if let Some(existing) = owner
            .rules
            .iter_mut()
            .find(|existing| rule_is_same_answer(existing, &rule))
        {
            existing.revoked_at = None;
            return Ok(existing.clone());
        }
        if owner.rules.len() >= MAX_PERMISSION_RULES_PER_OWNER {
            let oldest_revoked = owner
                .rules
                .iter()
                .enumerate()
                .filter(|(_, existing)| existing.revoked_at.is_some())
                .min_by(|(_, left), (_, right)| left.created_at.cmp(&right.created_at))
                .map(|(index, _)| index);
            let Some(index) = oldest_revoked else {
                return Err("remembered permissions are full".into());
            };
            owner.rules.remove(index);
        }
        owner.rules.push(rule.clone());
        Ok(rule)
    })
}

/// Every live rule for one resident, newest answer last.
pub(crate) fn matching_rules(
    app: &AppHandle,
    owner_pubkey: &str,
    resident_pubkey: &str,
) -> Result<Vec<PermissionRuleV1>, String> {
    matching_rules_at(&store_path(app)?, owner_pubkey, resident_pubkey)
}

fn matching_rules_at(
    path: &Path,
    owner_pubkey: &str,
    resident_pubkey: &str,
) -> Result<Vec<PermissionRuleV1>, String> {
    let resident_pubkey = validate_pubkey(resident_pubkey)?;
    read_store(path, |store| {
        Ok(store
            .owners
            .iter()
            .find(|owner| owner.owner_pubkey == owner_pubkey)
            .map(|owner| {
                owner
                    .rules
                    .iter()
                    .filter(|rule| {
                        rule.revoked_at.is_none()
                            && rule.resident_pubkey.as_str() == resident_pubkey
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default())
    })
}

/// Record that a live rule answered a card. Usage is owner-local bookkeeping
/// for the permissions list; it never widens what the rule allows.
pub(crate) fn touch_rule(app: &AppHandle, owner_pubkey: &str, rule_id: &str) -> Result<(), String> {
    touch_rule_at(&store_path(app)?, owner_pubkey, rule_id)
}

fn touch_rule_at(path: &Path, owner_pubkey: &str, rule_id: &str) -> Result<(), String> {
    mutate_store(path, |store| {
        let owner = owner_mut(store, owner_pubkey);
        let rule = owner
            .rules
            .iter_mut()
            .find(|rule| rule.rule_id.as_str() == rule_id && rule.revoked_at.is_none())
            .ok_or_else(|| "remembered permission was not found".to_string())?;
        rule.last_used_at = Some(Utc::now().to_rfc3339());
        rule.use_count = rule.use_count.saturating_add(1);
        Ok(())
    })
}

/// Take one remembered answer back. Tombstoned like [`revoke`], never deleted,
/// so a later identical answer can be recognised as the same rule.
pub(crate) fn revoke_rule(
    app: &AppHandle,
    owner_pubkey: &str,
    rule_id: &str,
) -> Result<ResidentCapabilitySettingsV1, String> {
    revoke_rule_at(&store_path(app)?, owner_pubkey, rule_id)
}

fn revoke_rule_at(
    path: &Path,
    owner_pubkey: &str,
    rule_id: &str,
) -> Result<ResidentCapabilitySettingsV1, String> {
    mutate_store(path, |store| {
        let owner = owner_mut(store, owner_pubkey);
        let rule = owner
            .rules
            .iter_mut()
            .find(|rule| rule.rule_id.as_str() == rule_id && rule.revoked_at.is_none())
            .ok_or_else(|| "remembered permission was not found".to_string())?;
        rule.revoked_at = Some(Utc::now().to_rfc3339());
        Ok(settings_snapshot(owner))
    })
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
        let raw =
            "failed to create /Users/owner/Library/Application Support/Luca: permission denied";
        let error = redact_store_path_result::<std::path::PathBuf>(Err(raw.into()))
            .expect_err("synthetic base-directory failure");
        assert_eq!(error, STORE_UNAVAILABLE);
        assert!(!error.contains("/Users/owner"));
        assert!(!error.to_ascii_lowercase().contains("permission"));
    }

    #[test]
    fn onboarding_chapters_include_the_brain_step_and_nothing_invented() {
        for chapter in [
            "welcome",
            "runtime",
            "agents",
            "brain",
            "preparing",
            "complete",
        ] {
            assert!(is_valid_onboarding_chapter(chapter), "{chapter}");
        }
        for chapter in ["", "Brain", "brains", "connect", "finished"] {
            assert!(!is_valid_onboarding_chapter(chapter), "{chapter}");
        }
    }

    #[test]
    fn first_run_is_anyone_completing_onboarding_not_merely_starting_it() {
        let mut store = CapabilityAuthorityStoreV1::default();
        assert!(!store_has_completed_onboarding(&store));
        owner_mut(&mut store, &"aa".repeat(32)).onboarding = Some(OnboardingCapabilityStatusV1 {
            chapter: "brain".into(),
            completed: false,
            updated_at: Utc::now().to_rfc3339(),
        });
        assert!(!store_has_completed_onboarding(&store));
        owner_mut(&mut store, &"bb".repeat(32)).onboarding = Some(OnboardingCapabilityStatusV1 {
            chapter: "complete".into(),
            completed: true,
            updated_at: Utc::now().to_rfc3339(),
        });
        assert!(store_has_completed_onboarding(&store));
    }

    fn test_rule(rule_id: &str, matcher: luca_protocol::PermissionMatcherV1) -> PermissionRuleV1 {
        PermissionRuleV1 {
            protocol: luca_protocol::PERMISSION_RULE_PROTOCOL.into(),
            rule_id: OpaqueId::parse(rule_id).unwrap(),
            resident_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
            scope: luca_protocol::PermissionRuleScopeV1::Project {
                source_id: OpaqueId::parse("source-a").unwrap(),
            },
            matcher,
            effect: luca_protocol::PermissionEffectV1::Allow,
            display_name: "Run git status in Luca".into(),
            created_at: Utc::now().to_rfc3339(),
            revoked_at: None,
            last_used_at: None,
            use_count: 0,
        }
    }

    fn command_matcher() -> luca_protocol::PermissionMatcherV1 {
        luca_protocol::PermissionMatcherV1::Command {
            token: "git".into(),
            argv_prefix: vec!["status".into()],
        }
    }

    /// A store file written before beta.11 has no `rules` key at all. It must
    /// still load, and the owner it holds must come back with no rules rather
    /// than failing the whole authority.
    #[test]
    fn rules_default_empty_on_legacy_store_file() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join(STORE_FILE);
        let owner_pubkey = "aa".repeat(32);
        std::fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({
                "schemaVersion": SCHEMA_VERSION,
                "owners": [{
                    "ownerPubkey": owner_pubkey,
                    "householdDefault": "standard",
                    "residentAccess": {},
                    "grants": [],
                    "onboarding": null,
                    "receipts": [],
                }],
            }))
            .unwrap(),
        )
        .unwrap();

        let store = load_store(&path).expect("a pre-beta.11 file still loads");
        assert!(store.owners[0].rules.is_empty());
        assert!(settings_snapshot(&store.owners[0]).rules.is_empty());
        assert_eq!(
            matching_rules_at(&path, &owner_pubkey, &"11".repeat(32)),
            Ok(Vec::new())
        );
    }

    #[test]
    fn upsert_rule_unrevokes_exact_duplicate_instead_of_growing() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join(STORE_FILE);
        let owner_pubkey = "aa".repeat(32);

        let first = upsert_rule_at(&path, &owner_pubkey, test_rule("rule-1", command_matcher()))
            .expect("first answer is remembered");
        assert_eq!(first.rule_id.as_str(), "rule-1");
        revoke_rule_at(&path, &owner_pubkey, "rule-1").expect("owner takes it back");

        // The same answer, minted fresh by a later card: same resident, scope,
        // matcher and effect, but a new id and sentence.
        let mut again = test_rule("rule-2", command_matcher());
        again.display_name = "Run git status in Luca again".into();
        let restored =
            upsert_rule_at(&path, &owner_pubkey, again).expect("the duplicate is recognised");
        assert_eq!(
            restored.rule_id.as_str(),
            "rule-1",
            "the original rule is un-revoked, not replaced"
        );
        assert!(restored.revoked_at.is_none());

        read_store(&path, |store| {
            assert_eq!(store.owners[0].rules.len(), 1, "the list did not grow");
            Ok(())
        })
        .unwrap();

        // A different matcher is a different answer and does append.
        upsert_rule_at(
            &path,
            &owner_pubkey,
            test_rule(
                "rule-3",
                luca_protocol::PermissionMatcherV1::Path { write: true },
            ),
        )
        .expect("a different answer is its own rule");
        read_store(&path, |store| {
            assert_eq!(store.owners[0].rules.len(), 2);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn revoked_rule_is_not_in_snapshot_or_matching() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join(STORE_FILE);
        let owner_pubkey = "aa".repeat(32);
        let resident = "11".repeat(32);

        upsert_rule_at(&path, &owner_pubkey, test_rule("rule-1", command_matcher())).unwrap();
        upsert_rule_at(
            &path,
            &owner_pubkey,
            test_rule(
                "rule-2",
                luca_protocol::PermissionMatcherV1::Domain {
                    host: "docs.rs".into(),
                },
            ),
        )
        .unwrap();
        touch_rule_at(&path, &owner_pubkey, "rule-1").expect("a live rule can be touched");

        let settings = revoke_rule_at(&path, &owner_pubkey, "rule-1").expect("revocation");
        assert_eq!(settings.rules.len(), 1);
        assert_eq!(settings.rules[0].rule_id.as_str(), "rule-2");
        let live = matching_rules_at(&path, &owner_pubkey, &resident).unwrap();
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].rule_id.as_str(), "rule-2");
        assert_eq!(live[0].use_count, 0);

        assert!(
            touch_rule_at(&path, &owner_pubkey, "rule-1").is_err(),
            "a revoked rule can no longer be used"
        );
        assert!(
            revoke_rule_at(&path, &owner_pubkey, "rule-1").is_err(),
            "revoking twice is not a second revocation"
        );
        // A rule for another resident never answers this one's cards.
        assert!(matching_rules_at(&path, &owner_pubkey, &"22".repeat(32))
            .unwrap()
            .is_empty());
        read_store(&path, |store| {
            assert_eq!(store.owners[0].rules.len(), 2, "revocation tombstones");
            let touched = store.owners[0]
                .rules
                .iter()
                .find(|rule| rule.rule_id.as_str() == "rule-1")
                .unwrap();
            assert_eq!(touched.use_count, 1);
            assert!(touched.last_used_at.is_some());
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn concurrent_rule_upsert_and_grant_revoke_cannot_overwrite_each_other() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join(STORE_FILE);
        let owner_pubkey = "aa".repeat(32);
        initialize_owner(&path, &owner_pubkey);
        let barrier = Arc::new(Barrier::new(3));

        let rule_path = path.clone();
        let rule_owner = owner_pubkey.clone();
        let rule_barrier = Arc::clone(&barrier);
        let rule = std::thread::spawn(move || {
            rule_barrier.wait();
            upsert_rule_at(
                &rule_path,
                &rule_owner,
                test_rule("rule-1", command_matcher()),
            )
        });
        let revoke_path = path.clone();
        let revoke_owner = owner_pubkey.clone();
        let revoke_barrier = Arc::clone(&barrier);
        let revoke = std::thread::spawn(move || {
            revoke_barrier.wait();
            mutate_store(&revoke_path, |store| {
                owner_mut(store, &revoke_owner).grants[0].revoked_at =
                    Some(Utc::now().to_rfc3339());
                Ok(())
            })
        });
        barrier.wait();
        rule.join().unwrap().unwrap();
        revoke.join().unwrap().unwrap();

        read_store(&path, |store| {
            assert_eq!(store.owners[0].rules.len(), 1);
            assert!(
                store.owners[0].grants[0].revoked_at.is_some(),
                "a rule write must not resurrect a revoked grant"
            );
            Ok(())
        })
        .unwrap();
    }

    /// The pre-app probe backs the init script that decides whether a new
    /// owner's theme is reset, so each of its three answers matters on its own:
    /// a directory that was never created and one holding only an unfinished
    /// owner are both first runs, and a completed owner is not.
    #[test]
    fn the_pre_app_probe_reads_the_same_store_without_creating_it() {
        let temporary = tempfile::tempdir().unwrap();
        let agents_dir = temporary.path().join("agents");

        assert_eq!(any_owner_completed_onboarding_in(&agents_dir), Ok(false));
        assert!(
            !agents_dir.exists(),
            "asking the question must not create the directory"
        );

        std::fs::create_dir_all(&agents_dir).unwrap();
        let path = agents_dir.join(STORE_FILE);
        let owner_pubkey = "aa".repeat(32);

        mutate_store(&path, |store| {
            owner_mut(store, &owner_pubkey).onboarding = Some(OnboardingCapabilityStatusV1 {
                chapter: "brain".into(),
                completed: false,
                updated_at: Utc::now().to_rfc3339(),
            });
            Ok(())
        })
        .unwrap();
        assert_eq!(any_owner_completed_onboarding_in(&agents_dir), Ok(false));

        mutate_store(&path, |store| {
            owner_mut(store, &owner_pubkey).onboarding = Some(OnboardingCapabilityStatusV1 {
                chapter: "complete".into(),
                completed: true,
                updated_at: Utc::now().to_rfc3339(),
            });
            Ok(())
        })
        .unwrap();
        assert_eq!(any_owner_completed_onboarding_in(&agents_dir), Ok(true));
    }
}
