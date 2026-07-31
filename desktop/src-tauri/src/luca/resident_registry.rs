//! Luca's public-only view of the durable managed-agent store.
//!
//! Managed agents remain the operational source of truth. This module projects
//! those records into the smaller resident registry contract and deliberately
//! omits keys, auth tags, prompts, environment variables and provider config.

use std::collections::HashSet;

use luca_protocol::Hex64;
use serde::Serialize;
use tauri::{AppHandle, State};
use zeroize::Zeroize;

use crate::{
    app_state::AppState,
    commands::create_managed_agent,
    managed_agents::{
        load_managed_agents, CreateManagedAgentRequest, ManagedAgentRecord, ManagedAgentSummary,
    },
};

const REGISTRY_SCHEMA: &str = "luca.resident-registry.v1";
const MAX_RESIDENTS: usize = 256;
const MAX_DISPLAY_NAME_BYTES: usize = 256;
const MAX_BINDING_BYTES: usize = 512;

/// Public persona and runtime bindings for one durable resident identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResidentRegistryEntry {
    pub resident_pubkey: Hex64,
    pub display_name: String,
    pub persona_id: Option<String>,
    pub runtime: ResidentRuntimeBinding,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Runtime/model selection is replaceable and explicitly separate from identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResidentRuntimeBinding {
    pub runtime_id: Option<String>,
    pub runtime_command: String,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
}

/// Stable public registry snapshot derived from the existing durable store.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResidentRegistrySnapshot {
    pub schema: &'static str,
    pub residents: Vec<ResidentRegistryEntry>,
}

/// Key-safe IPC result for Luca-owned resident setup.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateLucaResidentResponse {
    pub resident: CreatedResidentSummary,
    pub profile_sync_error: Option<String>,
    pub spawn_error: Option<String>,
}

/// Only public setup facts cross into the renderer.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreatedResidentSummary {
    pub resident_pubkey: Hex64,
    pub display_name: String,
    pub persona_id: Option<String>,
    pub runtime_command: String,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub status: String,
}

/// Load the resident registry from Buzz's existing keychain-backed managed store.
///
/// This is intentionally a projection, not a second persistence layer. The
/// hydrated managed records are dropped immediately after their public fields
/// have been copied into the snapshot.
pub(crate) fn load_resident_registry(
    app: &AppHandle,
) -> Result<ResidentRegistrySnapshot, String> {
    registry_from_records(&load_managed_agents(app)?)
}

/// Return the key-safe resident registry to renderer consumers.
#[tauri::command]
pub(crate) fn list_luca_residents(app: AppHandle) -> Result<ResidentRegistrySnapshot, String> {
    load_resident_registry(&app)
}

fn registry_from_records(
    records: &[ManagedAgentRecord],
) -> Result<ResidentRegistrySnapshot, String> {
    if records.len() > MAX_RESIDENTS {
        return Err("resident registry exceeds its row limit".to_string());
    }

    let mut seen = HashSet::with_capacity(records.len());
    let mut residents = Vec::with_capacity(records.len());
    for record in records {
        let resident_pubkey = Hex64::parse(record.pubkey.clone())
            .map_err(|_| "resident registry contains an invalid public key".to_string())?;
        if !seen.insert(record.pubkey.as_str()) {
            return Err("resident registry contains a duplicate public key".to_string());
        }

        residents.push(ResidentRegistryEntry {
            resident_pubkey,
            display_name: required_text(
                &record.name,
                MAX_DISPLAY_NAME_BYTES,
                "resident display name",
            )?,
            persona_id: optional_binding(record.persona_id.as_deref(), "persona id")?,
            runtime: ResidentRuntimeBinding {
                runtime_id: optional_binding(record.runtime.as_deref(), "runtime id")?,
                runtime_command: required_text(
                    &record.agent_command,
                    MAX_BINDING_BYTES,
                    "runtime command",
                )?,
                provider_id: optional_binding(record.provider.as_deref(), "provider id")?,
                model_id: optional_binding(record.model.as_deref(), "model id")?,
            },
            active: record.is_active,
            created_at: record.created_at.clone(),
            updated_at: record.updated_at.clone(),
        });
    }

    residents.sort_by(|left, right| {
        left.display_name
            .to_lowercase()
            .cmp(&right.display_name.to_lowercase())
            .then_with(|| left.resident_pubkey.cmp(&right.resident_pubkey))
    });

    Ok(ResidentRegistrySnapshot {
        schema: REGISTRY_SCHEMA,
        residents,
    })
}

fn required_text(value: &str, max_bytes: usize, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > max_bytes || value.chars().any(char::is_control) {
        return Err(format!("resident registry contains an invalid {label}"));
    }
    Ok(value.to_string())
}

fn optional_binding(value: Option<&str>, label: &str) -> Result<Option<String>, String> {
    value
        .map(|value| required_text(value, MAX_BINDING_BYTES, label))
        .transpose()
}

fn created_summary(agent: &ManagedAgentSummary) -> Result<CreatedResidentSummary, String> {
    Ok(CreatedResidentSummary {
        resident_pubkey: Hex64::parse(agent.pubkey.clone())
            .map_err(|_| "created resident returned an invalid public key".to_string())?,
        display_name: required_text(
            &agent.name,
            MAX_DISPLAY_NAME_BYTES,
            "resident display name",
        )?,
        persona_id: optional_binding(agent.persona_id.as_deref(), "persona id")?,
        runtime_command: required_text(
            &agent.agent_command,
            MAX_BINDING_BYTES,
            "runtime command",
        )?,
        provider_id: optional_binding(agent.provider.as_deref(), "provider id")?,
        model_id: optional_binding(agent.model.as_deref(), "model id")?,
        status: required_text(&agent.status, 64, "resident status")?,
    })
}

/// Create a Luca resident through the existing validated/keychain-backed path
/// without ever serializing its temporary legacy nsec into the renderer.
#[tauri::command]
pub(crate) async fn create_luca_resident(
    input: CreateManagedAgentRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CreateLucaResidentResponse, String> {
    let mut created = create_managed_agent(input, app, state).await?;

    // The legacy response owns a temporary copy for Buzz's compatibility UI.
    // Luca never returns it; erase it before any fallible response mapping.
    created.private_key_nsec.zeroize();
    let resident = created_summary(&created.agent)?;

    Ok(CreateLucaResidentResponse {
        resident,
        profile_sync_error: created.profile_sync_error,
        spawn_error: created.spawn_error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn record(pubkey: &str, name: &str, persona_id: &str) -> ManagedAgentRecord {
        serde_json::from_value(json!({
            "pubkey": pubkey,
            "name": name,
            "persona_id": persona_id,
            "private_key_nsec": "nsec1synthetic-never-serialize",
            "relay_url": "ws://127.0.0.1:3000",
            "acp_command": "buzz-acp",
            "agent_command": "fixture-noop",
            "agent_command_override": "fixture-noop",
            "agent_args": [],
            "mcp_command": "",
            "turn_timeout_seconds": 0,
            "parallelism": 1,
            "system_prompt": "protected persona body",
            "model": "fixture-model",
            "provider": "fixture-provider",
            "env_vars": {"LUCATEST_PROVIDER_SECRET": "never-serialize"},
            "start_on_app_launch": true,
            "backend": {"type": "local"},
            "created_at": "2026-07-31T00:00:00Z",
            "updated_at": "2026-07-31T00:00:00Z",
            "last_started_at": null,
            "last_stopped_at": null,
            "last_exit_code": null,
            "last_error": null,
            "respond_to": "owner-only",
            "runtime": "fixture-noop",
            "is_active": true
        }))
        .expect("synthetic managed record must deserialize")
    }

    #[test]
    fn registry_projects_three_public_residents_without_protected_fields() {
        let records = vec![
            record(&"a".repeat(64), "Luca", "persona:luca"),
            record(&"b".repeat(64), "Mara", "persona:mara"),
            record(&"c".repeat(64), "Sol", "persona:sol"),
        ];
        let registry = registry_from_records(&records).expect("registry must project");
        assert_eq!(registry.schema, REGISTRY_SCHEMA);
        assert_eq!(registry.residents.len(), 3);
        assert!(registry.residents.iter().all(|resident| resident.active));
        assert!(registry
            .residents
            .iter()
            .all(|resident| resident.runtime.runtime_id.as_deref() == Some("fixture-noop")));

        let serialized = serde_json::to_string(&registry).expect("registry must serialize");
        for forbidden in [
            "private_key",
            "nsec",
            "system_prompt",
            "protected persona body",
            "LUCATEST_PROVIDER_SECRET",
            "never-serialize",
            "conductor",
        ] {
            assert!(!serialized.contains(forbidden), "leaked {forbidden}");
        }
    }

    #[test]
    fn registry_rejects_duplicate_or_noncanonical_resident_identities() {
        let key = "d".repeat(64);
        let duplicate = vec![
            record(&key, "First", "persona:first"),
            record(&key, "Second", "persona:second"),
        ];
        assert!(registry_from_records(&duplicate)
            .expect_err("duplicate must fail")
            .contains("duplicate"));

        let invalid = vec![record(&"A".repeat(64), "Invalid", "persona:invalid")];
        assert!(registry_from_records(&invalid)
            .expect_err("uppercase key must fail")
            .contains("invalid public key"));
    }
}
