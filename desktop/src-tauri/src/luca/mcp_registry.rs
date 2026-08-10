//! Luca-owned local stdio MCP registry.
//!
//! Connection metadata and per-resident grants are stored in a restricted,
//! atomically replaced local file. Secret environment values never enter that
//! file: only opaque Keychain references are persisted.

use std::{collections::HashSet, fs, path::PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;

use crate::{
    app_state::keyring_service,
    managed_agents::storage::{atomic_write_json_restricted, managed_agents_base_dir},
    secret_store::SecretStore,
};

const REGISTRY_SCHEMA_VERSION: u32 = 1;
const MAX_CONNECTIONS: usize = 32;
const MAX_ENVIRONMENT_BINDINGS: usize = 64;
const MAX_ARGUMENTS: usize = 128;
const MAX_TEXT_BYTES: usize = 4096;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpEnvironmentKindV1 {
    Plain,
    Secret,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpEnvironmentBindingV1 {
    pub name: String,
    pub kind: McpEnvironmentKindV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret_ref: Option<String>,
}

impl std::fmt::Debug for McpEnvironmentBindingV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("McpEnvironmentBindingV1")
            .field("name", &self.name)
            .field("kind", &self.kind)
            .field(
                "value",
                &self.value.as_ref().map(|_| "[REDACTED OR NONSECRET]"),
            )
            .field("secret_ref", &self.secret_ref)
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LucaMcpConnectionV1 {
    pub schema_version: u32,
    pub connection_id: String,
    pub name: String,
    pub transport: String,
    pub command: String,
    pub args: Vec<String>,
    pub enabled: bool,
    pub environment: Vec<McpEnvironmentBindingV1>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentMcpGrantV1 {
    pub schema_version: u32,
    pub connection_id: String,
    pub resident_pubkey: String,
    pub granted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpReadinessV1 {
    Ready,
    Disabled,
    Locked,
    Failed,
    Untested,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpConnectionHealthV1 {
    pub connection_id: String,
    pub readiness: McpReadinessV1,
    pub tool_count: Option<u32>,
    pub last_tested_at: Option<String>,
    pub error_code: Option<String>,
    pub diagnostic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LucaMcpRegistryV1 {
    #[serde(default = "schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub connections: Vec<LucaMcpConnectionV1>,
    #[serde(default)]
    pub grants: Vec<AgentMcpGrantV1>,
    #[serde(default)]
    pub health: Vec<McpConnectionHealthV1>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pending_secret_deletions: Vec<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveMcpEnvironmentInputV1 {
    pub name: String,
    pub kind: McpEnvironmentKindV1,
    #[serde(default)]
    pub value: Option<String>,
}

impl std::fmt::Debug for SaveMcpEnvironmentInputV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SaveMcpEnvironmentInputV1")
            .field("name", &self.name)
            .field("kind", &self.kind)
            .field("value", &self.value.as_ref().map(|_| "[REDACTED]"))
            .finish()
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveLucaMcpConnectionInputV1 {
    #[serde(default)]
    pub connection_id: Option<String>,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub enabled: bool,
    #[serde(default)]
    pub environment: Vec<SaveMcpEnvironmentInputV1>,
}

impl std::fmt::Debug for SaveLucaMcpConnectionInputV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SaveLucaMcpConnectionInputV1")
            .field("connection_id", &self.connection_id)
            .field("name", &self.name)
            .field("command", &self.command)
            .field("args", &self.args)
            .field("enabled", &self.enabled)
            .field("environment", &self.environment)
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolvedMcpServerV1 {
    pub connection_id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub environment: Vec<(String, String)>,
}

fn schema_version() -> u32 {
    REGISTRY_SCHEMA_VERSION
}

fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(managed_agents_base_dir(app)?.join("luca-mcp-registry-v1.json"))
}

fn secret_store() -> &'static SecretStore {
    SecretStore::shared(keyring_service())
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn validate_text(label: &str, value: &str, allow_empty: bool) -> Result<String, String> {
    let trimmed = value.trim();
    if !allow_empty && trimmed.is_empty() {
        return Err(format!("{label} is required"));
    }
    if trimmed.len() > MAX_TEXT_BYTES
        || trimmed
            .chars()
            .any(|character| matches!(character, '\0' | '\r' | '\n'))
    {
        return Err(format!("{label} is invalid"));
    }
    Ok(trimmed.to_owned())
}

fn validate_env_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    let mut chars = name.chars();
    let valid_start = chars
        .next()
        .is_some_and(|character| character == '_' || character.is_ascii_alphabetic());
    if !valid_start
        || !chars.all(|character| character == '_' || character.is_ascii_alphanumeric())
        || name.len() > 128
    {
        return Err("environment variable name is invalid".into());
    }
    Ok(name.to_owned())
}

pub fn load_registry(app: &AppHandle) -> Result<LucaMcpRegistryV1, String> {
    let path = registry_path(app)?;
    if !path.exists() {
        return Ok(LucaMcpRegistryV1 {
            schema_version: REGISTRY_SCHEMA_VERSION,
            ..Default::default()
        });
    }
    let bytes = fs::read(&path).map_err(|_| "MCP registry could not be read".to_string())?;
    let registry: LucaMcpRegistryV1 =
        serde_json::from_slice(&bytes).map_err(|_| "MCP registry is invalid".to_string())?;
    if registry.schema_version != REGISTRY_SCHEMA_VERSION {
        return Err("MCP registry schema is unsupported".into());
    }
    Ok(registry)
}

fn save_registry(app: &AppHandle, registry: &LucaMcpRegistryV1) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(registry)
        .map_err(|_| "MCP registry could not be encoded".to_string())?;
    atomic_write_json_restricted(&registry_path(app)?, &bytes)
}

fn delete_secret_refs_best_effort(secret_refs: &[String]) {
    for secret_ref in secret_refs {
        let _ = secret_store().delete(secret_ref);
    }
}

fn retry_pending_secret_deletions(
    app: &AppHandle,
    registry: &mut LucaMcpRegistryV1,
) -> Result<(), String> {
    if registry.pending_secret_deletions.is_empty() {
        return Ok(());
    }
    let mut remaining = Vec::new();
    for secret_ref in &registry.pending_secret_deletions {
        if secret_store().delete(secret_ref).is_err() {
            remaining.push(secret_ref.clone());
        }
    }
    if remaining != registry.pending_secret_deletions {
        registry.pending_secret_deletions = remaining;
        save_registry(app, registry)?;
    }
    Ok(())
}

pub fn save_connection(
    app: &AppHandle,
    input: SaveLucaMcpConnectionInputV1,
) -> Result<LucaMcpRegistryV1, String> {
    let mut registry = load_registry(app)?;
    if registry.connections.len() >= MAX_CONNECTIONS && input.connection_id.is_none() {
        return Err(format!(
            "Luca supports at most {MAX_CONNECTIONS} MCP connections"
        ));
    }
    if input.args.len() > MAX_ARGUMENTS || input.environment.len() > MAX_ENVIRONMENT_BINDINGS {
        return Err("MCP connection exceeds local limits".into());
    }

    let connection_id = input
        .connection_id
        .as_deref()
        .map(validate_connection_id)
        .transpose()?
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let name = validate_text("connection name", &input.name, false)?;
    let command = validate_text("command", &input.command, false)?;
    let args = input
        .args
        .iter()
        .map(|argument| validate_text("argument", argument, true))
        .collect::<Result<Vec<_>, _>>()?;
    let prior = registry
        .connections
        .iter()
        .find(|connection| connection.connection_id == connection_id)
        .cloned();
    if registry.connections.iter().any(|connection| {
        connection.connection_id != connection_id && connection.name.eq_ignore_ascii_case(&name)
    }) {
        return Err("an MCP connection with this name already exists".into());
    }

    let mut seen_environment = HashSet::new();
    let mut environment = Vec::with_capacity(input.environment.len());
    let mut secret_writes = Vec::new();
    for binding in input.environment {
        let env_name = validate_env_name(&binding.name)?;
        if !seen_environment.insert(env_name.clone()) {
            return Err(format!("duplicate environment variable: {env_name}"));
        }
        match binding.kind {
            McpEnvironmentKindV1::Plain => environment.push(McpEnvironmentBindingV1 {
                name: env_name,
                kind: McpEnvironmentKindV1::Plain,
                value: Some(validate_text(
                    "environment value",
                    binding.value.as_deref().unwrap_or_default(),
                    true,
                )?),
                secret_ref: None,
            }),
            McpEnvironmentKindV1::Secret => {
                let existing_ref = prior.as_ref().and_then(|connection| {
                    connection
                        .environment
                        .iter()
                        .find(|candidate| {
                            candidate.name == env_name
                                && candidate.kind == McpEnvironmentKindV1::Secret
                        })
                        .and_then(|candidate| candidate.secret_ref.clone())
                });
                let secret_ref = if binding.value.is_some() {
                    format!("luca-mcp-secret:{}", Uuid::new_v4())
                } else {
                    existing_ref
                        .ok_or_else(|| format!("secret value for {env_name} is required"))?
                };
                if let Some(value) = binding.value {
                    if value.is_empty() {
                        return Err(format!("secret value for {env_name} is empty"));
                    }
                    secret_writes.push((secret_ref.clone(), value));
                } else if input.enabled && secret_store().load(&secret_ref)?.is_none() {
                    return Err(format!("secret value for {env_name} is required"));
                }
                environment.push(McpEnvironmentBindingV1 {
                    name: env_name,
                    kind: McpEnvironmentKindV1::Secret,
                    value: None,
                    secret_ref: Some(secret_ref),
                });
            }
        }
    }

    let new_secret_refs = secret_writes
        .iter()
        .map(|(secret_ref, _)| secret_ref.clone())
        .collect::<Vec<_>>();
    for (secret_ref, secret_value) in &secret_writes {
        if let Err(error) = secret_store().store(secret_ref, secret_value) {
            delete_secret_refs_best_effort(&new_secret_refs);
            return Err(error);
        }
    }

    let timestamp = now();
    let connection = LucaMcpConnectionV1 {
        schema_version: REGISTRY_SCHEMA_VERSION,
        connection_id: connection_id.clone(),
        name,
        transport: "stdio".into(),
        command,
        args,
        enabled: input.enabled,
        environment,
        created_at: prior
            .as_ref()
            .map(|connection| connection.created_at.clone())
            .unwrap_or_else(|| timestamp.clone()),
        updated_at: timestamp,
    };
    if let Some(index) = registry
        .connections
        .iter()
        .position(|candidate| candidate.connection_id == connection_id)
    {
        registry.connections[index] = connection;
    } else {
        registry.connections.push(connection);
    }
    registry
        .health
        .retain(|health| health.connection_id != connection_id);
    registry.health.push(McpConnectionHealthV1 {
        connection_id: connection_id.clone(),
        readiness: if input.enabled {
            McpReadinessV1::Untested
        } else {
            McpReadinessV1::Disabled
        },
        tool_count: None,
        last_tested_at: None,
        error_code: None,
        diagnostic: None,
    });
    if let Some(prior) = prior {
        let active_refs = registry
            .connections
            .iter()
            .find(|candidate| candidate.connection_id == connection_id)
            .into_iter()
            .flat_map(|connection| connection.environment.iter())
            .filter_map(|binding| binding.secret_ref.as_ref())
            .collect::<HashSet<_>>();
        for secret_ref in prior
            .environment
            .iter()
            .filter_map(|binding| binding.secret_ref.as_ref())
        {
            if !active_refs.contains(secret_ref) {
                registry.pending_secret_deletions.push(secret_ref.clone());
            }
        }
    }
    registry.pending_secret_deletions.sort();
    registry.pending_secret_deletions.dedup();
    if let Err(error) = save_registry(app, &registry) {
        delete_secret_refs_best_effort(&new_secret_refs);
        return Err(error);
    }
    retry_pending_secret_deletions(app, &mut registry)?;
    Ok(registry)
}

pub fn delete_connection(
    app: &AppHandle,
    connection_id: &str,
) -> Result<LucaMcpRegistryV1, String> {
    let connection_id = validate_connection_id(connection_id)?;
    let mut registry = load_registry(app)?;
    let removed = registry
        .connections
        .iter()
        .find(|connection| connection.connection_id == connection_id)
        .cloned();
    registry
        .connections
        .retain(|connection| connection.connection_id != connection_id);
    registry
        .grants
        .retain(|grant| grant.connection_id != connection_id);
    registry
        .health
        .retain(|health| health.connection_id != connection_id);
    if let Some(connection) = removed {
        for secret_ref in connection
            .environment
            .iter()
            .filter_map(|binding| binding.secret_ref.as_deref())
        {
            registry
                .pending_secret_deletions
                .push(secret_ref.to_owned());
        }
    }
    registry.pending_secret_deletions.sort();
    registry.pending_secret_deletions.dedup();
    save_registry(app, &registry)?;
    retry_pending_secret_deletions(app, &mut registry)?;
    Ok(registry)
}

pub fn set_grant(
    app: &AppHandle,
    connection_id: &str,
    resident_pubkey: &str,
    granted: bool,
) -> Result<LucaMcpRegistryV1, String> {
    let connection_id = validate_connection_id(connection_id)?;
    let resident_pubkey = luca_protocol::Hex64::parse(resident_pubkey.trim().to_ascii_lowercase())
        .map_err(|error| format!("invalid resident public key: {error}"))?
        .as_str()
        .to_owned();
    let mut registry = load_registry(app)?;
    if !registry
        .connections
        .iter()
        .any(|connection| connection.connection_id == connection_id)
    {
        return Err("MCP connection does not exist".into());
    }
    registry.grants.retain(|grant| {
        !(grant.connection_id == connection_id && grant.resident_pubkey == resident_pubkey)
    });
    if granted {
        registry.grants.push(AgentMcpGrantV1 {
            schema_version: REGISTRY_SCHEMA_VERSION,
            connection_id,
            resident_pubkey,
            granted_at: now(),
        });
    }
    save_registry(app, &registry)?;
    Ok(registry)
}

pub fn set_health(
    app: &AppHandle,
    health: McpConnectionHealthV1,
) -> Result<McpConnectionHealthV1, String> {
    let mut registry = load_registry(app)?;
    registry
        .health
        .retain(|entry| entry.connection_id != health.connection_id);
    registry.health.push(health.clone());
    save_registry(app, &registry)?;
    Ok(health)
}

pub fn resolve_connection(
    app: &AppHandle,
    connection_id: &str,
) -> Result<ResolvedMcpServerV1, String> {
    let registry = load_registry(app)?;
    let connection = registry
        .connections
        .into_iter()
        .find(|connection| connection.connection_id == connection_id)
        .ok_or_else(|| "MCP connection does not exist".to_string())?;
    resolve_connection_record(connection)
}

pub fn resolve_for_resident(
    app: &AppHandle,
    resident_pubkey: &str,
) -> Result<Vec<ResolvedMcpServerV1>, String> {
    let resident_pubkey = luca_protocol::Hex64::parse(resident_pubkey.trim().to_ascii_lowercase())
        .map_err(|error| format!("invalid resident public key: {error}"))?
        .as_str()
        .to_owned();
    let registry = load_registry(app)?;
    let granted = registry
        .grants
        .iter()
        .filter(|grant| grant.resident_pubkey == resident_pubkey)
        .map(|grant| grant.connection_id.as_str())
        .collect::<HashSet<_>>();
    registry
        .connections
        .into_iter()
        .filter(|connection| {
            connection.enabled && granted.contains(connection.connection_id.as_str())
        })
        .map(resolve_connection_record)
        .collect()
}

fn resolve_connection_record(
    connection: LucaMcpConnectionV1,
) -> Result<ResolvedMcpServerV1, String> {
    if !connection.enabled {
        return Err("MCP connection is disabled".into());
    }
    let mut environment = Vec::with_capacity(connection.environment.len());
    for binding in connection.environment {
        let value = match binding.kind {
            McpEnvironmentKindV1::Plain => binding.value.unwrap_or_default(),
            McpEnvironmentKindV1::Secret => {
                let secret_ref = binding
                    .secret_ref
                    .ok_or_else(|| "MCP secret reference is invalid".to_string())?;
                secret_store()
                    .load(&secret_ref)?
                    .ok_or_else(|| "MCP connection is locked".to_string())?
            }
        };
        environment.push((binding.name, value));
    }
    let server_name = format!("luca_{}", connection.connection_id.replace('-', ""));
    Ok(ResolvedMcpServerV1 {
        connection_id: connection.connection_id,
        // ACP/MCP server names are identifiers, not display labels. Derive a
        // stable identifier from Luca's UUID so human labels may contain spaces
        // without weakening the wire contract.
        name: server_name,
        command: connection.command,
        args: connection.args,
        environment,
    })
}

fn validate_connection_id(connection_id: &str) -> Result<String, String> {
    Uuid::parse_str(connection_id.trim())
        .map(|id| id.to_string())
        .map_err(|_| "MCP connection ID is invalid".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialized_secret_binding_contains_reference_but_no_value() {
        let binding = McpEnvironmentBindingV1 {
            name: "TOKEN".into(),
            kind: McpEnvironmentKindV1::Secret,
            value: None,
            secret_ref: Some("luca-mcp-secret:opaque".into()),
        };
        let json = serde_json::to_string(&binding).unwrap();
        assert!(json.contains("luca-mcp-secret:opaque"));
        assert!(!json.contains("secret-value"));
        assert!(!json.contains("\"value\""));
    }

    #[test]
    fn environment_names_are_strict() {
        assert_eq!(validate_env_name("SERVICE_TOKEN").unwrap(), "SERVICE_TOKEN");
        assert!(validate_env_name("1TOKEN").is_err());
        assert!(validate_env_name("TOKEN-NAME").is_err());
        assert!(validate_env_name("TOKEN=value").is_err());
    }

    #[test]
    fn command_rejects_control_characters() {
        assert!(validate_text("command", "node\nother", false).is_err());
        assert!(validate_text("command", "", false).is_err());
        assert_eq!(validate_text("command", "node", false).unwrap(), "node");
    }
}
