//! Luca's public-only view of the durable managed-agent store.
//!
//! Managed agents remain the operational source of truth. This module projects
//! those records into the smaller resident registry contract and deliberately
//! omits keys, auth tags, prompts, environment variables and provider config.
//!
//! Known P2 assumption: Buzz's compatibility storage may retain a resident nsec
//! in its owner-only `0o600` JSON fallback when the OS keyring is unreachable.
//! F15 neither widens that access nor redesigns the existing storage contract.

use std::{
    collections::{BTreeSet, HashMap, HashSet},
    sync::OnceLock,
};

use luca_protocol::Hex64;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroize;

use crate::{
    app_state::AppState,
    commands::create_managed_agent,
    managed_agents::{
        build_managed_agent_summary, load_managed_agents, load_personas,
        native_runtime_semantic_key, revalidate_native_runtime_binding, save_managed_agents,
        CreateManagedAgentRequest, ManagedAgentRecord, ManagedAgentSummary, RuntimeBinding,
    },
};

const REGISTRY_SCHEMA: &str = "luca.resident-registry.v1";
const MAX_RESIDENTS: usize = 256;
const MAX_DISPLAY_NAME_BYTES: usize = 256;
const MAX_BINDING_BYTES: usize = 512;
const MAX_MENTION_ALIASES: usize = MAX_RESIDENTS * 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ResidentNameResolutionError {
    Invalid,
    Unavailable,
    NotFound,
    Ambiguous,
}

/// Public persona and runtime bindings for one durable resident identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResidentRegistryEntry {
    pub resident_pubkey: Hex64,
    pub display_name: String,
    pub persona_id: Option<String>,
    pub runtime: ResidentRuntimeBinding,
    pub status: String,
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
    pub reused: bool,
    pub recovery_notice: Option<String>,
    pub brain_access_error: Option<String>,
}

/// Structured failure lets the renderer compensate only when native storage
/// positively confirmed that no resident was persisted.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateLucaResidentError {
    pub message: String,
    pub persistence: ResidentPersistence,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ResidentPersistence {
    NotPersisted,
    Unknown,
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
    state: &AppState,
) -> Result<ResidentRegistrySnapshot, String> {
    let _store_guard = state
        .managed_agents_store_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let records = load_managed_agents(app)?;
    let runtimes = state
        .managed_agent_processes
        .lock()
        .map_err(|error| error.to_string())?;
    let personas = load_personas(app).unwrap_or_default();
    let statuses = records
        .iter()
        .map(|record| {
            build_managed_agent_summary(app, record, &runtimes, &personas)
                .map(|summary| (record.pubkey.clone(), summary.status))
        })
        .collect::<Result<HashMap<_, _>, _>>()?;
    registry_from_records(&records, &statuses)
}

/// Resolve one durable same-owner resident from its local display name or
/// alias. The public key remains inside the trusted desktop process.
pub(crate) fn resolve_owned_resident_name(
    app: &AppHandle,
    owned_resident_pubkeys: &std::collections::BTreeSet<Hex64>,
    requested_name: &str,
) -> Result<Hex64, ResidentNameResolutionError> {
    if requested_name.is_empty()
        || requested_name.trim() != requested_name
        || requested_name.len() > MAX_DISPLAY_NAME_BYTES
        || requested_name.contains('\0')
    {
        return Err(ResidentNameResolutionError::Invalid);
    }
    let state = app.state::<AppState>();
    let _store_guard = state
        .managed_agents_store_lock
        .lock()
        .map_err(|_| ResidentNameResolutionError::Unavailable)?;
    let records = load_managed_agents(app).map_err(|_| ResidentNameResolutionError::Unavailable)?;
    resolve_owned_resident_name_from_records(&records, owned_resident_pubkeys, requested_name)
}

pub(crate) fn resolve_owned_resident_name_from_records(
    records: &[ManagedAgentRecord],
    owned_resident_pubkeys: &std::collections::BTreeSet<Hex64>,
    requested_name: &str,
) -> Result<Hex64, ResidentNameResolutionError> {
    let requested = requested_name.to_lowercase();
    let mut matches = records
        .iter()
        .filter_map(|record| {
            let pubkey = Hex64::parse(record.pubkey.to_ascii_lowercase()).ok()?;
            if !owned_resident_pubkeys.contains(&pubkey) {
                return None;
            }
            let aliases = [
                Some(record.name.as_str()),
                record.display_name.as_deref(),
                record.slug.as_deref(),
                record.backend_agent_id.as_deref(),
            ];
            aliases
                .into_iter()
                .flatten()
                .any(|alias| alias.trim().to_lowercase() == requested)
                .then_some(pubkey)
        })
        .collect::<Vec<_>>();
    matches.sort();
    matches.dedup();
    match matches.as_slice() {
        [] => Err(ResidentNameResolutionError::NotFound),
        [resident] => Ok(resident.clone()),
        _ => Err(ResidentNameResolutionError::Ambiguous),
    }
}

/// Prove that the desktop-held key derives the recorded resident identity.
pub(crate) fn resident_custody_pubkey(record: &ManagedAgentRecord) -> Option<Hex64> {
    let pubkey = Hex64::parse(record.pubkey.to_ascii_lowercase()).ok()?;
    let keys = nostr::Keys::parse(record.private_key_nsec.trim()).ok()?;
    (keys.public_key().to_hex() == pubkey.as_str()).then_some(pubkey)
}

/// Verify the owner signature separately from custody; callers require both.
pub(crate) fn resident_attested_to_owner(
    record: &ManagedAgentRecord,
    pubkey: &Hex64,
    owner: &Hex64,
) -> bool {
    let Some(auth_tag) = record.auth_tag.as_deref() else {
        return false;
    };
    let Ok(public_key) = nostr::PublicKey::from_hex(pubkey.as_str()) else {
        return false;
    };
    buzz_sdk_pkg::nip_oa::verify_auth_tag(auth_tag, &public_key)
        .is_ok_and(|attested| attested.to_hex() == owner.as_str())
}

/// A bounded public label, never a native backend locator or generated alias.
pub(crate) fn public_resident_name(value: &str) -> Option<&str> {
    let name = value.trim();
    (!name.is_empty()
        && name.len() <= MAX_DISPLAY_NAME_BYTES
        && !name.chars().any(char::is_control))
    .then_some(name)
}

/// Existing public aliases eligible for newly recognized complete-name mentions.
pub(crate) fn owned_resident_mention_aliases_from_records<'a>(
    records: &'a [ManagedAgentRecord],
    custody: &BTreeSet<Hex64>,
    owner: &Hex64,
) -> Result<Vec<&'a str>, ResidentNameResolutionError> {
    let mut seen = BTreeSet::new();
    let mut aliases = Vec::new();
    for record in records {
        let Some(pubkey) = resident_custody_pubkey(record) else {
            continue;
        };
        if !custody.contains(&pubkey) || !resident_attested_to_owner(record, &pubkey, owner) {
            continue;
        }
        for alias in [
            Some(record.name.as_str()),
            record.display_name.as_deref(),
            record.slug.as_deref(),
        ]
        .into_iter()
        .flatten()
        .filter_map(public_resident_name)
        {
            if seen.insert(alias.to_lowercase()) {
                aliases.push(alias);
                if aliases.len() > MAX_MENTION_ALIASES {
                    return Err(ResidentNameResolutionError::Unavailable);
                }
            }
        }
    }
    Ok(aliases)
}

/// Recognize and resolve targets against the same immutable verified snapshot.
pub(crate) fn owned_resident_mentions_from_records(
    records: &[ManagedAgentRecord],
    custody: &BTreeSet<Hex64>,
    owner: &Hex64,
    draft: &str,
) -> Result<Vec<(String, Hex64)>, ResidentNameResolutionError> {
    let aliases = owned_resident_mention_aliases_from_records(records, custody, owner)?;
    let mut resolved = Vec::new();
    for name in super::exchange_plan::mentioned_names_with_aliases(draft, &aliases) {
        match resolve_owned_resident_name_from_records(records, custody, &name) {
            Ok(pubkey) => resolved.push((name, pubkey)),
            Err(ResidentNameResolutionError::Unavailable) => {
                return Err(ResidentNameResolutionError::Unavailable);
            }
            Err(_) => {}
        }
    }
    Ok(resolved)
}

/// Read one owner-checked mention snapshot; hydrated keys never leave the desktop.
pub(crate) fn read_owned_resident_mentions(
    app: &AppHandle,
    custody: &BTreeSet<Hex64>,
    owner: &Hex64,
    draft: &str,
) -> Result<Vec<(String, Hex64)>, ResidentNameResolutionError> {
    let state = app.state::<AppState>();
    let current_owner = || {
        state
            .signing_keys()
            .map(|keys| keys.public_key().to_hex())
            .map_err(|_| ResidentNameResolutionError::Unavailable)
    };
    if current_owner()? != owner.as_str() {
        return Err(ResidentNameResolutionError::Unavailable);
    }
    let _guard = state
        .managed_agents_store_lock
        .lock()
        .map_err(|_| ResidentNameResolutionError::Unavailable)?;
    let mut records =
        load_managed_agents(app).map_err(|_| ResidentNameResolutionError::Unavailable)?;
    let resolved = owned_resident_mentions_from_records(&records, custody, owner, draft);
    for record in &mut records {
        record.private_key_nsec.zeroize();
    }
    drop(_guard);
    if current_owner()? != owner.as_str() {
        return Err(ResidentNameResolutionError::Unavailable);
    }
    resolved
}

/// Return the key-safe resident registry to renderer consumers.
#[tauri::command]
pub(crate) async fn list_luca_residents(
    app: AppHandle,
) -> Result<ResidentRegistrySnapshot, String> {
    use tauri::Manager;
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        load_resident_registry(&app, &state)
    })
    .await
    .map_err(|error| format!("resident registry worker failed: {error}"))?
}

fn registry_from_records(
    records: &[ManagedAgentRecord],
    statuses: &HashMap<String, String>,
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
            status: required_text(
                statuses
                    .get(&record.pubkey)
                    .ok_or_else(|| "resident registry is missing runtime status".to_string())?,
                64,
                "resident status",
            )?,
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

fn resident_creation_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn existing_resident_for_persona(
    app: &AppHandle,
    state: &AppState,
    persona_id: &str,
) -> Result<Option<CreatedResidentSummary>, String> {
    let _store_guard = state
        .managed_agents_store_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let records = load_managed_agents(app)?;
    let Some(record) = unique_record_for_persona(&records, persona_id)? else {
        return Ok(None);
    };

    let runtimes = state
        .managed_agent_processes
        .lock()
        .map_err(|error| error.to_string())?;
    let personas = load_personas(app).unwrap_or_default();
    let summary = build_managed_agent_summary(app, record, &runtimes, &personas)?;
    created_summary(&summary).map(Some)
}

fn existing_resident_for_runtime_binding(
    app: &AppHandle,
    state: &AppState,
    binding: &RuntimeBinding,
) -> Result<Option<CreatedResidentSummary>, String> {
    let _store_guard = state
        .managed_agents_store_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let mut records = load_managed_agents(app)?;
    let Some(index) = records.iter().position(|record| {
        record
            .native_runtime_binding
            .as_ref()
            .is_some_and(|existing| {
                native_runtime_semantic_key(existing) == native_runtime_semantic_key(binding)
            })
    }) else {
        return Ok(None);
    };
    if records
        .iter()
        .filter(|record| {
            record
                .native_runtime_binding
                .as_ref()
                .is_some_and(|existing| {
                    native_runtime_semantic_key(existing) == native_runtime_semantic_key(binding)
                })
        })
        .count()
        > 1
    {
        return Err(
            "this native runtime identity is linked to multiple residents; repair is required"
                .into(),
        );
    }
    if records[index].native_runtime_binding.as_ref() != Some(binding) {
        records[index].native_runtime_binding = Some(binding.clone());
        save_managed_agents(app, &records)?;
    }
    let record = &records[index];

    let runtimes = state
        .managed_agent_processes
        .lock()
        .map_err(|error| error.to_string())?;
    let personas = load_personas(app).unwrap_or_default();
    let summary = build_managed_agent_summary(app, record, &runtimes, &personas)?;
    created_summary(&summary).map(Some)
}

fn unique_record_for_persona<'a>(
    records: &'a [ManagedAgentRecord],
    persona_id: &str,
) -> Result<Option<&'a ManagedAgentRecord>, String> {
    let mut matches = records
        .iter()
        .filter(|record| record.persona_id.as_deref() == Some(persona_id));
    let first = matches.next();
    if matches.next().is_some() {
        return Err(format!(
            "persona {persona_id} is linked to multiple residents; repair is required"
        ));
    }
    Ok(first)
}

#[cfg(test)]
fn unique_record_for_runtime_binding<'a>(
    records: &'a [ManagedAgentRecord],
    binding: &RuntimeBinding,
) -> Result<Option<&'a ManagedAgentRecord>, String> {
    let mut matches = records.iter().filter(|record| {
        record
            .native_runtime_binding
            .as_ref()
            .is_some_and(|existing| {
                native_runtime_semantic_key(existing) == native_runtime_semantic_key(binding)
            })
    });
    let first = matches.next();
    if matches.next().is_some() {
        return Err(
            "this native runtime identity is linked to multiple residents; repair is required"
                .to_string(),
        );
    }
    Ok(first)
}

fn recovered_response(
    resident: CreatedResidentSummary,
    recovery_notice: Option<String>,
) -> CreateLucaResidentResponse {
    CreateLucaResidentResponse {
        resident,
        profile_sync_error: None,
        spawn_error: None,
        reused: true,
        recovery_notice,
        brain_access_error: None,
    }
}

fn bounded_recovery_notice(message: &str) -> String {
    message
        .chars()
        .filter(|character| !character.is_control())
        .take(512)
        .collect()
}

fn creation_error(
    message: impl Into<String>,
    persistence: ResidentPersistence,
) -> CreateLucaResidentError {
    CreateLucaResidentError {
        message: message.into(),
        persistence,
    }
}

fn recover_or_classify_creation_error(
    app: &AppHandle,
    state: &AppState,
    persona_id: Option<&str>,
    runtime_binding: Option<&RuntimeBinding>,
    error: String,
) -> Result<CreateLucaResidentResponse, CreateLucaResidentError> {
    let recovered = match persona_id {
        Some(persona_id) => existing_resident_for_persona(app, state, persona_id),
        None => match runtime_binding {
            Some(binding) => existing_resident_for_runtime_binding(app, state, binding),
            None => Ok(None),
        },
    };
    match recovered {
        Ok(Some(existing)) => Ok(recovered_response(
            existing,
            Some(bounded_recovery_notice(&error)),
        )),
        Ok(None) => Err(creation_error(error, ResidentPersistence::NotPersisted)),
        Err(recovery_error) => Err(creation_error(
            format!(
                "resident setup failed and persistence could not be verified: {recovery_error}"
            ),
            ResidentPersistence::Unknown,
        )),
    }
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
        display_name: required_text(&agent.name, MAX_DISPLAY_NAME_BYTES, "resident display name")?,
        persona_id: optional_binding(agent.persona_id.as_deref(), "persona id")?,
        runtime_command: required_text(&agent.agent_command, MAX_BINDING_BYTES, "runtime command")?,
        provider_id: optional_binding(agent.provider.as_deref(), "provider id")?,
        model_id: optional_binding(agent.model.as_deref(), "model id")?,
        status: required_text(&agent.status, 64, "resident status")?,
    })
}

/// Create a Luca resident through the existing validated/keychain-backed path
/// without ever serializing its temporary legacy nsec into the renderer.
#[tauri::command]
pub(crate) async fn create_luca_resident(
    mut input: CreateManagedAgentRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CreateLucaResidentResponse, CreateLucaResidentError> {
    // Serialize Luca-owned creation across its full async lifecycle. The
    // existing store mutex cannot be held across the legacy command's awaits.
    let _creation_guard = resident_creation_lock().lock().await;
    if let Some(binding) = input.native_runtime_binding.as_ref() {
        input.native_runtime_binding = Some(
            revalidate_native_runtime_binding(binding)
                .map_err(|error| creation_error(error, ResidentPersistence::NotPersisted))?,
        );
    }
    let persona_id = input
        .persona_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let runtime_binding = input.native_runtime_binding.clone();
    if let Some(persona_id) = persona_id.as_deref() {
        match existing_resident_for_persona(&app, &state, persona_id) {
            Ok(Some(existing)) => return Ok(recovered_response(existing, None)),
            Ok(None) => {}
            Err(error) => {
                return Err(creation_error(error, ResidentPersistence::Unknown));
            }
        }
    }
    if let Some(binding) = runtime_binding.as_ref() {
        match existing_resident_for_runtime_binding(&app, &state, binding) {
            Ok(Some(existing)) => return Ok(recovered_response(existing, None)),
            Ok(None) => {}
            Err(error) => {
                return Err(creation_error(error, ResidentPersistence::Unknown));
            }
        }
    }

    let mut created = match create_managed_agent(input, app.clone(), state.clone()).await {
        Ok(created) => created,
        Err(error) => {
            return recover_or_classify_creation_error(
                &app,
                &state,
                persona_id.as_deref(),
                runtime_binding.as_ref(),
                error,
            );
        }
    };

    // The legacy response owns a temporary copy for Buzz's compatibility UI.
    // Luca never returns it; erase it before any fallible response mapping.
    created.private_key_nsec.zeroize();
    let resident = match created_summary(&created.agent) {
        Ok(resident) => resident,
        Err(error) => {
            return recover_or_classify_creation_error(
                &app,
                &state,
                persona_id.as_deref(),
                runtime_binding.as_ref(),
                error,
            );
        }
    };

    Ok(CreateLucaResidentResponse {
        resident,
        profile_sync_error: created.profile_sync_error,
        spawn_error: created.spawn_error,
        reused: false,
        recovery_notice: None,
        brain_access_error: provision_new_resident_brain_access(
            &app,
            &state,
            &created.agent.pubkey,
        )
        .err()
        .map(|error| bounded_recovery_notice(&error)),
    })
}

fn provision_new_resident_brain_access(
    app: &AppHandle,
    state: &AppState,
    resident_pubkey: &str,
) -> Result<(), String> {
    let owner_pubkey = Hex64::parse(state.signing_keys()?.public_key().to_hex())
        .map_err(|_| "active owner identity is invalid".to_owned())?;
    let resident_pubkey = Hex64::parse(resident_pubkey.to_owned())
        .map_err(|_| "created resident identity is invalid".to_owned())?;
    let (binding_ref, provider_egress) =
        crate::managed_agents::current_owner_brain_runtime_authority(app, &resident_pubkey)?;
    state
        .provision_connected_brain_resident(
            owner_pubkey,
            crate::luca::owner_brain_store::ConnectedBrainResidentAuthorityV1 {
                resident_pubkey,
                binding_ref,
                provider_egress,
            },
        )
        .map_err(|error| error.code().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

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
        let statuses = records
            .iter()
            .map(|record| (record.pubkey.clone(), "running".to_string()))
            .collect();
        let registry = registry_from_records(&records, &statuses).expect("registry must project");
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
        let statuses = HashMap::from([(key.clone(), "stopped".to_string())]);
        assert!(registry_from_records(&duplicate, &statuses)
            .expect_err("duplicate must fail")
            .contains("duplicate"));

        let invalid = vec![record(&"A".repeat(64), "Invalid", "persona:invalid")];
        let invalid_statuses = HashMap::from([("A".repeat(64), "stopped".to_string())]);
        assert!(registry_from_records(&invalid, &invalid_statuses)
            .expect_err("uppercase key must fail")
            .contains("invalid public key"));
    }

    #[test]
    fn resident_name_resolution_is_case_insensitive_unique_and_owned() {
        let mut main = record(&"a".repeat(64), "Main", "persona:main");
        main.display_name = Some("OpenClaw Main".into());
        main.slug = Some("main-agent".into());
        main.backend_agent_id = Some("native-main".into());
        let other = record(&"b".repeat(64), "Other", "persona:other");
        let records = vec![main, other];
        let owned = [Hex64::parse("a".repeat(64)).expect("owned")]
            .into_iter()
            .collect();

        for alias in ["main", "OPENCLAW MAIN", "Main-Agent", "NATIVE-MAIN"] {
            assert_eq!(
                resolve_owned_resident_name_from_records(&records, &owned, alias)
                    .expect("unique alias"),
                Hex64::parse("a".repeat(64)).expect("main")
            );
        }
        assert_eq!(
            resolve_owned_resident_name_from_records(&records, &owned, "Other"),
            Err(ResidentNameResolutionError::NotFound)
        );
    }

    #[test]
    fn resident_name_resolution_rejects_missing_and_ambiguous_aliases() {
        let mut first = record(&"c".repeat(64), "Main", "persona:first");
        first.display_name = Some("Shared".into());
        let mut second = record(&"d".repeat(64), "Other", "persona:second");
        second.slug = Some("shared".into());
        let records = vec![first, second];
        let owned = [
            Hex64::parse("c".repeat(64)).expect("first"),
            Hex64::parse("d".repeat(64)).expect("second"),
        ]
        .into_iter()
        .collect();

        assert_eq!(
            resolve_owned_resident_name_from_records(&records, &owned, "Shared"),
            Err(ResidentNameResolutionError::Ambiguous)
        );
        assert_eq!(
            resolve_owned_resident_name_from_records(&records, &owned, "Missing"),
            Err(ResidentNameResolutionError::NotFound)
        );
    }

    #[test]
    fn resident_creation_reuses_one_persona_link_and_rejects_ambiguous_links() {
        let records = vec![record(&"e".repeat(64), "Luca", "persona:luca")];
        let existing = unique_record_for_persona(&records, "persona:luca")
            .expect("one link is unambiguous")
            .expect("resident must exist");
        assert_eq!(existing.pubkey, "e".repeat(64));

        let duplicates = vec![
            record(&"f".repeat(64), "Luca A", "persona:luca"),
            record(&"1".repeat(64), "Luca B", "persona:luca"),
        ];
        assert!(unique_record_for_persona(&duplicates, "persona:luca")
            .expect_err("two links must fail closed")
            .contains("multiple residents"));
    }

    #[test]
    fn resident_creation_reuses_native_runtime_identity_and_rejects_duplicates() {
        let binding = RuntimeBinding::Hermes {
            schema_version: 1,
            profile_name: "default".to_string(),
            hermes_home: PathBuf::from("/tmp/hermes"),
            executable_path: PathBuf::from("/usr/local/bin/hermes"),
            runtime_version: "1.0.0".to_string(),
            default_workspace: None,
        };
        let mut first = record(&"2".repeat(64), "Default", "persona:unused");
        first.persona_id = None;
        first.native_runtime_binding = Some(binding.clone());
        let records = vec![first.clone()];
        let existing = unique_record_for_runtime_binding(&records, &binding)
            .expect("one native binding is unambiguous")
            .expect("resident must exist");
        assert_eq!(existing.pubkey, "2".repeat(64));

        let mut second = first;
        second.pubkey = "3".repeat(64);
        assert!(
            unique_record_for_runtime_binding(&[records[0].clone(), second], &binding)
                .expect_err("duplicate native identity must fail closed")
                .contains("multiple residents")
        );
    }
}
