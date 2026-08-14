//! Owner-scoped operator preferences and native provisioning contracts.
//!
//! This store deliberately contains no runtime paths, credentials, prompts, or
//! discovery payloads. Native execution is implemented by sibling adapters;
//! this module owns the versioned cross-runtime target and transaction ledger.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::{
    app_state::AppState,
    managed_agents::{
        load_global_agent_config, AcpAvailabilityStatus, AuthStatus, NativeDiscoveryStatus,
        NativeRuntimeKind,
    },
};

use crate::managed_agents::storage::{atomic_write_json_restricted, managed_agents_base_dir};

const SCHEMA_VERSION: u32 = 1;
const STORE_FILE: &str = "operator-forge-v1.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NativeRuntimeFamilyV1 {
    Hermes,
    Openclaw,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AgentRuntimeTargetV1 {
    Managed { runtime_id: String },
    Native { runtime: NativeRuntimeFamilyV1 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentProvisioningModeV1 {
    Fresh,
    Template,
    Advanced,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NativeProvisioningStatusV1 {
    Planned,
    Provisioning,
    NativeCreated,
    ResidentLinked,
    Complete,
    NeedsAttention,
    RolledBack,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeProvisioningTransactionV1 {
    pub schema_version: u32,
    pub transaction_id: String,
    pub owner_pubkey: String,
    pub runtime: NativeRuntimeFamilyV1,
    pub mode: AgentProvisioningModeV1,
    pub intended_slug: String,
    pub request_hash: String,
    pub source_hash: Option<String>,
    pub persona_id: Option<String>,
    pub reserved_resident_pubkey: Option<String>,
    pub native_semantic_hash: Option<String>,
    pub status: NativeProvisioningStatusV1,
    pub error_code: Option<String>,
    pub recovery_action: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperatorPreferencesV1 {
    pub schema_version: u32,
    pub owner_pubkey: String,
    pub default_runtime_target: Option<AgentRuntimeTargetV1>,
    pub runtime_confirmed: bool,
    pub luca_enabled: bool,
    pub updated_at: String,
}

impl OperatorPreferencesV1 {
    fn new(owner_pubkey: String) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            owner_pubkey,
            default_runtime_target: None,
            runtime_confirmed: false,
            luca_enabled: true,
            updated_at: Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OperatorForgeStoreV1 {
    #[serde(default = "schema_version")]
    schema_version: u32,
    #[serde(default)]
    owners: Vec<OperatorPreferencesV1>,
    #[serde(default)]
    transactions: Vec<NativeProvisioningTransactionV1>,
}

impl Default for OperatorForgeStoreV1 {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            owners: Vec::new(),
            transactions: Vec::new(),
        }
    }
}

pub(crate) fn create_native_transaction(
    app: &AppHandle,
    owner_pubkey: String,
    runtime: NativeRuntimeFamilyV1,
    mode: AgentProvisioningModeV1,
    intended_slug: String,
    request_hash: String,
    source_hash: Option<String>,
) -> Result<NativeProvisioningTransactionV1, String> {
    let now = Utc::now().to_rfc3339();
    let transaction = NativeProvisioningTransactionV1 {
        schema_version: SCHEMA_VERSION,
        transaction_id: uuid::Uuid::new_v4().to_string(),
        owner_pubkey,
        runtime,
        mode,
        intended_slug,
        request_hash,
        source_hash,
        persona_id: None,
        reserved_resident_pubkey: None,
        native_semantic_hash: None,
        status: NativeProvisioningStatusV1::Planned,
        error_code: None,
        recovery_action: None,
        created_at: now.clone(),
        updated_at: now,
    };
    let mut store = load_store(app)?;
    store.transactions.push(transaction.clone());
    save_store(app, &store)?;
    Ok(transaction)
}

pub(crate) fn set_native_transaction_persona(
    app: &AppHandle,
    owner_pubkey: &str,
    transaction_id: &str,
    persona_id: String,
) -> Result<NativeProvisioningTransactionV1, String> {
    let mut store = load_store(app)?;
    let transaction = store
        .transactions
        .iter_mut()
        .find(|transaction| {
            transaction.owner_pubkey == owner_pubkey && transaction.transaction_id == transaction_id
        })
        .ok_or_else(|| "native provisioning transaction was not found".to_string())?;
    transaction.persona_id = Some(persona_id);
    transaction.updated_at = Utc::now().to_rfc3339();
    let updated = transaction.clone();
    save_store(app, &store)?;
    Ok(updated)
}

pub(crate) fn load_native_transaction(
    app: &AppHandle,
    owner_pubkey: &str,
    transaction_id: &str,
) -> Result<NativeProvisioningTransactionV1, String> {
    load_store(app)?
        .transactions
        .into_iter()
        .find(|transaction| {
            transaction.owner_pubkey == owner_pubkey && transaction.transaction_id == transaction_id
        })
        .ok_or_else(|| "native provisioning transaction was not found".into())
}

pub(crate) fn update_native_transaction(
    app: &AppHandle,
    owner_pubkey: &str,
    transaction_id: &str,
    status: NativeProvisioningStatusV1,
    resident_pubkey: Option<String>,
    native_semantic_hash: Option<String>,
    failure: Option<(&str, &str)>,
) -> Result<NativeProvisioningTransactionV1, String> {
    let mut store = load_store(app)?;
    let transaction = store
        .transactions
        .iter_mut()
        .find(|transaction| {
            transaction.owner_pubkey == owner_pubkey && transaction.transaction_id == transaction_id
        })
        .ok_or_else(|| "native provisioning transaction was not found".to_string())?;
    transaction.status = status;
    if resident_pubkey.is_some() {
        transaction.reserved_resident_pubkey = resident_pubkey;
    }
    if native_semantic_hash.is_some() {
        transaction.native_semantic_hash = native_semantic_hash;
    }
    transaction.error_code = failure.map(|(code, _)| code.to_string());
    transaction.recovery_action = failure.map(|(_, action)| action.to_string());
    transaction.updated_at = Utc::now().to_rfc3339();
    let updated = transaction.clone();
    save_store(app, &store)?;
    Ok(updated)
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeReadinessV1 {
    Ready,
    SetupRequired,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTargetOptionV1 {
    pub target: AgentRuntimeTargetV1,
    pub label: String,
    pub readiness: RuntimeReadinessV1,
    pub reason: Option<String>,
    pub recommended: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperatorForgeSettingsV1 {
    pub preferences: OperatorPreferencesV1,
    pub runtime_options: Vec<RuntimeTargetOptionV1>,
    pub recommendation: Option<AgentRuntimeTargetV1>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveOperatorPreferencesInputV1 {
    pub default_runtime_target: Option<AgentRuntimeTargetV1>,
    pub runtime_confirmed: bool,
    pub luca_enabled: bool,
}

fn schema_version() -> u32 {
    SCHEMA_VERSION
}

fn store_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(managed_agents_base_dir(app)?.join(STORE_FILE))
}

fn load_store(app: &AppHandle) -> Result<OperatorForgeStoreV1, String> {
    let path = store_path(app)?;
    if !path.exists() {
        return Ok(OperatorForgeStoreV1::default());
    }
    let bytes = std::fs::read(&path).map_err(|_| "operator settings could not be read")?;
    let store: OperatorForgeStoreV1 =
        serde_json::from_slice(&bytes).map_err(|_| "operator settings are invalid")?;
    migrate_store(store)
}

fn migrate_store(mut store: OperatorForgeStoreV1) -> Result<OperatorForgeStoreV1, String> {
    match store.schema_version {
        SCHEMA_VERSION => Ok(store),
        0 => {
            store.schema_version = SCHEMA_VERSION;
            for preferences in &mut store.owners {
                if preferences.schema_version == 0 {
                    preferences.schema_version = SCHEMA_VERSION;
                }
            }
            for transaction in &mut store.transactions {
                if transaction.schema_version == 0 {
                    transaction.schema_version = SCHEMA_VERSION;
                }
            }
            Ok(store)
        }
        _ => Err("operator settings use an unsupported schema version".into()),
    }
}

fn save_store(app: &AppHandle, store: &OperatorForgeStoreV1) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|_| "operator settings could not be serialized")?;
    atomic_write_json_restricted(&store_path(app)?, &bytes)
}

fn validate_target(target: &AgentRuntimeTargetV1) -> Result<(), String> {
    match target {
        AgentRuntimeTargetV1::Managed { runtime_id }
            if matches!(runtime_id.as_str(), "codex" | "claude") =>
        {
            Ok(())
        }
        AgentRuntimeTargetV1::Native { .. } => Ok(()),
        AgentRuntimeTargetV1::Managed { .. } => {
            Err("default runtime must be Codex, Claude Code, Hermes, or OpenClaw".into())
        }
    }
}

fn owner_pubkey(state: &AppState) -> Result<String, String> {
    Ok(state.signing_keys()?.public_key().to_hex())
}

fn legacy_runtime_target(app: &AppHandle) -> Option<AgentRuntimeTargetV1> {
    let legacy = load_global_agent_config(app).ok()?.preferred_runtime?;
    match legacy.trim() {
        "codex" | "codex-acp" => Some(AgentRuntimeTargetV1::Managed {
            runtime_id: "codex".into(),
        }),
        "claude" | "claude-code" | "claude-agent-acp" | "claude-code-acp" => {
            Some(AgentRuntimeTargetV1::Managed {
                runtime_id: "claude".into(),
            })
        }
        _ => None,
    }
}

fn preferences_for_owner(
    app: &AppHandle,
    store: &mut OperatorForgeStoreV1,
    owner: &str,
) -> OperatorPreferencesV1 {
    if let Some(found) = store
        .owners
        .iter()
        .find(|candidate| candidate.owner_pubkey == owner)
    {
        return found.clone();
    }
    let mut preferences = OperatorPreferencesV1::new(owner.to_string());
    if let Some(target) = legacy_runtime_target(app) {
        preferences.default_runtime_target = Some(target);
        preferences.runtime_confirmed = true;
    }
    store.owners.push(preferences.clone());
    preferences
}

fn managed_option(
    id: &str,
    label: &str,
    discovered: &[crate::managed_agents::AcpRuntimeCatalogEntry],
) -> RuntimeTargetOptionV1 {
    let target = AgentRuntimeTargetV1::Managed {
        runtime_id: id.to_string(),
    };
    let entry = discovered.iter().find(|entry| entry.id == id);
    let (readiness, reason) = match entry {
        Some(entry)
            if entry.availability == AcpAvailabilityStatus::Available
                && matches!(
                    entry.auth_status,
                    AuthStatus::LoggedIn | AuthStatus::NotApplicable
                ) =>
        {
            (RuntimeReadinessV1::Ready, None)
        }
        Some(entry) if entry.availability == AcpAvailabilityStatus::Available => (
            RuntimeReadinessV1::SetupRequired,
            entry
                .login_hint
                .clone()
                .or(Some("Sign in to continue.".into())),
        ),
        Some(entry) => (
            RuntimeReadinessV1::Unavailable,
            Some(entry.install_hint.clone()),
        ),
        None => (RuntimeReadinessV1::Unavailable, Some("Not found.".into())),
    };
    RuntimeTargetOptionV1 {
        target,
        label: label.into(),
        readiness,
        reason,
        recommended: false,
    }
}

fn runtime_options() -> Vec<RuntimeTargetOptionV1> {
    let managed = crate::managed_agents::discover_acp_runtimes();
    let native = crate::managed_agents::discover_native_resident_outcome();
    let mut options = vec![
        managed_option("codex", "Codex", &managed),
        managed_option("claude", "Claude Code", &managed),
    ];
    for (family, kind, label) in [
        (
            NativeRuntimeFamilyV1::Hermes,
            NativeRuntimeKind::Hermes,
            "Hermes",
        ),
        (
            NativeRuntimeFamilyV1::Openclaw,
            NativeRuntimeKind::Openclaw,
            "OpenClaw",
        ),
    ] {
        let outcome = native
            .runtimes
            .iter()
            .find(|outcome| outcome.native_type == kind);
        let (readiness, reason) = match outcome {
            Some(outcome) if outcome.status == NativeDiscoveryStatus::Available => {
                (RuntimeReadinessV1::Ready, None)
            }
            Some(outcome) if outcome.status == NativeDiscoveryStatus::Degraded => (
                RuntimeReadinessV1::SetupRequired,
                outcome.message.clone().or(Some("Needs attention.".into())),
            ),
            Some(outcome) => (
                RuntimeReadinessV1::Unavailable,
                outcome.message.clone().or(Some("Not found.".into())),
            ),
            None => (RuntimeReadinessV1::Unavailable, Some("Not found.".into())),
        };
        options.push(RuntimeTargetOptionV1 {
            target: AgentRuntimeTargetV1::Native { runtime: family },
            label: label.into(),
            readiness,
            reason,
            recommended: false,
        });
    }
    options
}

fn choose_recommendation(
    current: Option<&AgentRuntimeTargetV1>,
    options: &[RuntimeTargetOptionV1],
) -> Option<AgentRuntimeTargetV1> {
    current
        .and_then(|current| {
            options
                .iter()
                .find(|option| {
                    option.target == *current && option.readiness == RuntimeReadinessV1::Ready
                })
                .map(|option| option.target.clone())
        })
        .or_else(|| {
            options
                .iter()
                .find(|option| {
                    option.target
                        == (AgentRuntimeTargetV1::Native {
                            runtime: NativeRuntimeFamilyV1::Hermes,
                        })
                        && option.readiness == RuntimeReadinessV1::Ready
                })
                .map(|option| option.target.clone())
        })
        .or_else(|| {
            options
                .iter()
                .find(|option| option.readiness == RuntimeReadinessV1::Ready)
                .map(|option| option.target.clone())
        })
}

fn build_settings(
    preferences: OperatorPreferencesV1,
    mut options: Vec<RuntimeTargetOptionV1>,
) -> OperatorForgeSettingsV1 {
    let confirmed_target = preferences
        .runtime_confirmed
        .then_some(preferences.default_runtime_target.as_ref())
        .flatten();
    let recommendation = choose_recommendation(confirmed_target, &options);
    for option in &mut options {
        option.recommended = recommendation.as_ref() == Some(&option.target);
    }
    OperatorForgeSettingsV1 {
        preferences,
        runtime_options: options,
        recommendation,
    }
}

#[tauri::command]
pub async fn get_operator_forge_settings(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<OperatorForgeSettingsV1, String> {
    let owner = owner_pubkey(&state)?;
    tokio::task::spawn_blocking(move || {
        let mut store = load_store(&app)?;
        let preferences = preferences_for_owner(&app, &mut store, &owner);
        save_store(&app, &store)?;
        Ok(build_settings(preferences, runtime_options()))
    })
    .await
    .map_err(|_| "operator settings task failed".to_string())?
}

#[tauri::command]
pub async fn save_operator_forge_preferences(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SaveOperatorPreferencesInputV1,
) -> Result<OperatorForgeSettingsV1, String> {
    if let Some(target) = input.default_runtime_target.as_ref() {
        validate_target(target)?;
    }
    if input.runtime_confirmed && input.default_runtime_target.is_none() {
        return Err("a runtime cannot be confirmed without a selection".into());
    }
    let owner = owner_pubkey(&state)?;
    tokio::task::spawn_blocking(move || {
        let mut store = load_store(&app)?;
        let mut preferences = preferences_for_owner(&app, &mut store, &owner);
        preferences.default_runtime_target = input.default_runtime_target;
        preferences.runtime_confirmed = input.runtime_confirmed;
        preferences.luca_enabled = input.luca_enabled;
        preferences.updated_at = Utc::now().to_rfc3339();
        if let Some(existing) = store
            .owners
            .iter_mut()
            .find(|candidate| candidate.owner_pubkey == owner)
        {
            *existing = preferences.clone();
        }
        save_store(&app, &store)?;
        Ok(build_settings(preferences, runtime_options()))
    })
    .await
    .map_err(|_| "operator settings task failed".to_string())?
}

#[tauri::command]
pub async fn list_native_provisioning_transactions(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<NativeProvisioningTransactionV1>, String> {
    let owner = owner_pubkey(&state)?;
    tokio::task::spawn_blocking(move || {
        let mut transactions = load_store(&app)?
            .transactions
            .into_iter()
            .filter(|transaction| transaction.owner_pubkey == owner)
            .collect::<Vec<_>>();
        transactions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(transactions)
    })
    .await
    .map_err(|_| "provisioning activity task failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_store_uses_the_current_schema_version() {
        let store = OperatorForgeStoreV1::default();
        assert_eq!(store.schema_version, SCHEMA_VERSION);
        assert_eq!(
            serde_json::to_value(store).unwrap()["schemaVersion"],
            SCHEMA_VERSION
        );
    }

    #[test]
    fn legacy_schema_zero_is_upgraded_without_losing_preferences() {
        let mut store = OperatorForgeStoreV1::default();
        store.schema_version = 0;
        let mut preferences = OperatorPreferencesV1::new("owner".into());
        preferences.schema_version = 0;
        preferences.default_runtime_target = Some(AgentRuntimeTargetV1::Managed {
            runtime_id: "codex".into(),
        });
        preferences.runtime_confirmed = true;
        store.owners.push(preferences);

        let migrated = migrate_store(store).expect("legacy store should migrate");

        assert_eq!(migrated.schema_version, SCHEMA_VERSION);
        assert_eq!(migrated.owners[0].schema_version, SCHEMA_VERSION);
        assert_eq!(
            migrated.owners[0].default_runtime_target,
            Some(AgentRuntimeTargetV1::Managed {
                runtime_id: "codex".into()
            })
        );
        assert!(migrated.owners[0].runtime_confirmed);
    }

    #[test]
    fn future_operator_store_schema_still_fails_closed() {
        let mut store = OperatorForgeStoreV1::default();
        store.schema_version = SCHEMA_VERSION + 1;

        assert_eq!(
            migrate_store(store).unwrap_err(),
            "operator settings use an unsupported schema version"
        );
    }

    #[test]
    fn runtime_target_uses_camel_case_fields_and_rejects_unknown_fields() {
        let encoded = serde_json::to_value(AgentRuntimeTargetV1::Managed {
            runtime_id: "codex".into(),
        })
        .unwrap();
        assert_eq!(
            encoded,
            serde_json::json!({"kind": "managed", "runtimeId": "codex"})
        );
        assert!(
            serde_json::from_value::<AgentRuntimeTargetV1>(serde_json::json!({
                "kind": "managed",
                "runtimeId": "codex",
                "command": "sh"
            }))
            .is_err()
        );
    }

    fn option(target: AgentRuntimeTargetV1, ready: bool) -> RuntimeTargetOptionV1 {
        RuntimeTargetOptionV1 {
            target,
            label: "test".into(),
            readiness: if ready {
                RuntimeReadinessV1::Ready
            } else {
                RuntimeReadinessV1::Unavailable
            },
            reason: None,
            recommended: false,
        }
    }

    #[test]
    fn recommendation_preserves_a_ready_existing_preference() {
        let codex = AgentRuntimeTargetV1::Managed {
            runtime_id: "codex".into(),
        };
        let hermes = AgentRuntimeTargetV1::Native {
            runtime: NativeRuntimeFamilyV1::Hermes,
        };
        let options = vec![option(codex, true), option(hermes.clone(), true)];
        assert_eq!(choose_recommendation(Some(&hermes), &options), Some(hermes));
    }

    #[test]
    fn recommendation_prefers_ready_hermes_for_an_unconfirmed_profile() {
        let codex = AgentRuntimeTargetV1::Managed {
            runtime_id: "codex".into(),
        };
        let hermes = AgentRuntimeTargetV1::Native {
            runtime: NativeRuntimeFamilyV1::Hermes,
        };
        let options = vec![option(codex, true), option(hermes.clone(), true)];
        assert_eq!(choose_recommendation(None, &options), Some(hermes));
    }

    #[test]
    fn recommendation_falls_back_to_another_ready_runtime_when_hermes_is_not_ready() {
        let codex = AgentRuntimeTargetV1::Managed {
            runtime_id: "codex".into(),
        };
        let hermes = AgentRuntimeTargetV1::Native {
            runtime: NativeRuntimeFamilyV1::Hermes,
        };
        let options = vec![option(codex.clone(), true), option(hermes, false)];
        assert_eq!(choose_recommendation(None, &options), Some(codex));
    }

    #[test]
    fn unconfirmed_saved_target_does_not_override_the_intended_default() {
        let codex = AgentRuntimeTargetV1::Managed {
            runtime_id: "codex".into(),
        };
        let hermes = AgentRuntimeTargetV1::Native {
            runtime: NativeRuntimeFamilyV1::Hermes,
        };
        let mut preferences = OperatorPreferencesV1::new("owner".into());
        preferences.default_runtime_target = Some(codex);
        preferences.runtime_confirmed = false;
        let settings = build_settings(
            preferences,
            vec![
                option(
                    AgentRuntimeTargetV1::Managed {
                        runtime_id: "codex".into(),
                    },
                    true,
                ),
                option(hermes.clone(), true),
            ],
        );
        assert_eq!(settings.recommendation, Some(hermes));
    }

    #[test]
    fn strict_input_rejects_commands_and_unknown_fields() {
        let unsafe_payload = serde_json::json!({
            "defaultRuntimeTarget": {"kind": "managed", "runtimeId": "codex", "command": "sh"},
            "runtimeConfirmed": true,
            "lucaEnabled": true
        });
        assert!(serde_json::from_value::<SaveOperatorPreferencesInputV1>(unsafe_payload).is_err());
    }

    #[test]
    fn transaction_shape_contains_no_native_paths_or_bodies() {
        let value = serde_json::to_value(NativeProvisioningTransactionV1 {
            schema_version: SCHEMA_VERSION,
            transaction_id: "transaction".into(),
            owner_pubkey: "a".repeat(64),
            runtime: NativeRuntimeFamilyV1::Hermes,
            mode: AgentProvisioningModeV1::Fresh,
            intended_slug: "helper".into(),
            request_hash: "b".repeat(64),
            source_hash: None,
            persona_id: None,
            reserved_resident_pubkey: None,
            native_semantic_hash: None,
            status: NativeProvisioningStatusV1::Planned,
            error_code: None,
            recovery_action: None,
            created_at: "now".into(),
            updated_at: "now".into(),
        })
        .unwrap();
        let encoded = value.to_string();
        for forbidden in [
            "path",
            "prompt",
            "credential",
            "token",
            "command",
            "environment",
        ] {
            assert!(!encoded.to_ascii_lowercase().contains(forbidden));
        }
    }
}
