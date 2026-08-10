//! Owner-approved native resident provisioning.

use std::{
    collections::BTreeMap,
    io::{Read, Seek, SeekFrom},
    path::{Component, Path},
    process::{Command, ExitStatus, Stdio},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};

use crate::{
    app_state::AppState,
    commands::delete_managed_agent,
    luca::{
        operator_forge::{
            create_native_transaction, load_native_transaction, set_native_transaction_persona,
            update_native_transaction, AgentProvisioningModeV1, NativeProvisioningStatusV1,
            NativeRuntimeFamilyV1,
        },
        resident_registry::create_luca_resident,
    },
    managed_agents::{
        native_runtime_semantic_key, CreateManagedAgentRequest, DiscoveredResidentCandidate,
        NativeRuntimeKind, RuntimeBinding,
    },
};

mod hermes;

const MAX_NAME_CHARS: usize = 120;
const MAX_PROMPT_CHARS: usize = 20_000;
const MAX_SELECTIONS: usize = 64;
const PROCESS_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_CAPTURE_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeProvisioningRequestV1 {
    pub display_name: String,
    pub system_prompt: String,
    pub runtime: NativeRuntimeFamilyV1,
    pub mode: AgentProvisioningModeV1,
    #[serde(default)]
    pub source_semantic_id: Option<String>,
    #[serde(default)]
    pub selected_skills: Vec<String>,
    #[serde(default)]
    pub include_memory: bool,
    #[serde(default)]
    pub workspace_documents: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecuteNativeProvisioningInputV1 {
    pub transaction_id: String,
    pub persona_id: String,
    pub request: NativeProvisioningRequestV1,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeProvisioningTransactionInputV1 {
    pub transaction_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProvisioningChangeV1 {
    pub subject: String,
    pub action: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProvisioningPreviewV1 {
    pub schema_version: u32,
    pub transaction_id: String,
    pub display_name: String,
    pub runtime: NativeRuntimeFamilyV1,
    pub mode: AgentProvisioningModeV1,
    pub intended_slug: String,
    pub source_label: Option<String>,
    pub changes: Vec<NativeProvisioningChangeV1>,
    pub permission_defaults: String,
    pub recovery_action: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProvisioningReceiptV1 {
    pub schema_version: u32,
    pub transaction_id: String,
    pub runtime: NativeRuntimeFamilyV1,
    pub resident_pubkey: Option<String>,
    pub native_semantic_hash: Option<String>,
    pub status: NativeProvisioningStatusV1,
    pub reused: bool,
    pub needs_attention: bool,
    pub recovery_action: Option<String>,
}

#[derive(Debug)]
struct CapturedOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn read_capture(file: &mut std::fs::File) -> Result<Vec<u8>, String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| "could not read native command output")?;
    let mut output = Vec::new();
    file.take(MAX_CAPTURE_BYTES as u64)
        .read_to_end(&mut output)
        .map_err(|_| "could not read native command output")?;
    Ok(output)
}

fn run_native_command(
    binary: &Path,
    args: &[String],
    environment: &BTreeMap<String, String>,
) -> Result<CapturedOutput, String> {
    let mut stdout_file = tempfile::tempfile().map_err(|_| "could not capture native output")?;
    let mut stderr_file = tempfile::tempfile().map_err(|_| "could not capture native errors")?;
    let mut child = Command::new(binary)
        .args(args)
        .envs(environment)
        .stdin(Stdio::null())
        .stdout(Stdio::from(
            stdout_file
                .try_clone()
                .map_err(|_| "could not capture native output")?,
        ))
        .stderr(Stdio::from(
            stderr_file
                .try_clone()
                .map_err(|_| "could not capture native errors")?,
        ))
        .spawn()
        .map_err(|_| "native runtime could not be started")?;
    let deadline = Instant::now() + PROCESS_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("native runtime command timed out".into());
            }
            Err(_) => return Err("native runtime command status was unavailable".into()),
        }
    };
    Ok(CapturedOutput {
        status,
        stdout: read_capture(&mut stdout_file)?,
        stderr: read_capture(&mut stderr_file)?,
    })
}

fn required_text(value: &str, label: &str, max_chars: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max_chars || value.chars().any(char::is_control)
    {
        return Err(format!("{label} is invalid"));
    }
    Ok(value.to_string())
}

fn safe_relative(value: &str, label: &str) -> Result<String, String> {
    let value = required_text(value, label, 240)?;
    let path = Path::new(&value);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!("{label} must be a safe relative name"));
    }
    Ok(value)
}

fn slug_for_name(name: &str) -> Result<String, String> {
    let mut slug = String::new();
    let mut separator = false;
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            separator = false;
        } else if !separator && !slug.is_empty() {
            slug.push('-');
            separator = true;
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() || slug == "default" || slug == "main" || slug.len() > 64 {
        return Err("agent name cannot produce a safe native identity".into());
    }
    Ok(slug.to_string())
}

fn normalize_request(
    mut request: NativeProvisioningRequestV1,
) -> Result<NativeProvisioningRequestV1, String> {
    request.display_name = required_text(&request.display_name, "display name", MAX_NAME_CHARS)?;
    request.system_prompt =
        required_text(&request.system_prompt, "system prompt", MAX_PROMPT_CHARS)?;
    if request.selected_skills.len() > MAX_SELECTIONS
        || request.workspace_documents.len() > MAX_SELECTIONS
    {
        return Err("too many clone selections".into());
    }
    request.selected_skills = request
        .selected_skills
        .iter()
        .map(|value| safe_relative(value, "skill"))
        .collect::<Result<Vec<_>, _>>()?;
    request.workspace_documents = request
        .workspace_documents
        .iter()
        .map(|value| safe_relative(value, "workspace document"))
        .collect::<Result<Vec<_>, _>>()?;
    request.selected_skills.sort();
    request.selected_skills.dedup();
    request.workspace_documents.sort();
    request.workspace_documents.dedup();
    if request.mode == AgentProvisioningModeV1::Fresh {
        if request.source_semantic_id.is_some()
            || !request.selected_skills.is_empty()
            || request.include_memory
            || !request.workspace_documents.is_empty()
        {
            return Err("fresh provisioning cannot include clone selections".into());
        }
    } else if request.source_semantic_id.is_none() {
        return Err("template and advanced provisioning require a selected source".into());
    }
    if request.mode != AgentProvisioningModeV1::Advanced
        && (request.include_memory || !request.workspace_documents.is_empty())
    {
        return Err("memory and workspace documents require advanced provisioning".into());
    }
    Ok(request)
}

fn request_hash(request: &NativeProvisioningRequestV1) -> Result<String, String> {
    let bytes = serde_json::to_vec(request).map_err(|_| "request could not be encoded")?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn source_hash(source: Option<&str>) -> Option<String> {
    source.map(|source| hex::encode(Sha256::digest(source.as_bytes())))
}

fn native_candidate(
    runtime: &NativeRuntimeFamilyV1,
    semantic_id: Option<&str>,
) -> Result<DiscoveredResidentCandidate, String> {
    let kind = match runtime {
        NativeRuntimeFamilyV1::Hermes => NativeRuntimeKind::Hermes,
        NativeRuntimeFamilyV1::Openclaw => NativeRuntimeKind::Openclaw,
    };
    let outcome = crate::managed_agents::discover_native_resident_outcome();
    let candidates = outcome
        .runtimes
        .into_iter()
        .find(|entry| entry.native_type == kind)
        .map(|entry| entry.candidates)
        .unwrap_or_default();
    match semantic_id {
        Some(id) => candidates
            .into_iter()
            .find(|candidate| candidate.semantic_id == id)
            .ok_or_else(|| "selected native source is stale or unavailable".into()),
        None => candidates
            .into_iter()
            .next()
            .ok_or_else(|| "native runtime is unavailable or needs setup".into()),
    }
}

fn owner_pubkey(state: &AppState) -> Result<String, String> {
    Ok(state.signing_keys()?.public_key().to_hex())
}

fn managed_create_input(
    request: &NativeProvisioningRequestV1,
    persona_id: &str,
    binding: &RuntimeBinding,
) -> Result<CreateManagedAgentRequest, String> {
    let (command, args) = binding.launch_preview();
    serde_json::from_value(serde_json::json!({
        "name": request.display_name,
        "personaId": required_text(persona_id, "persona id", 256)?,
        "agentCommand": command,
        "agentArgs": args,
        "harnessOverride": true,
        "parallelism": 1,
        "spawnAfterCreate": false,
        "startOnAppLaunch": true,
        "nativeRuntimeBinding": binding
    }))
    .map_err(|_| "resident creation request could not be prepared".into())
}

#[tauri::command]
pub async fn preview_native_agent_provisioning(
    app: AppHandle,
    state: State<'_, AppState>,
    request: NativeProvisioningRequestV1,
) -> Result<NativeProvisioningPreviewV1, String> {
    let request = normalize_request(request)?;
    let owner = owner_pubkey(&state)?;
    let slug = slug_for_name(&request.display_name)?;
    let candidate = native_candidate(&request.runtime, request.source_semantic_id.as_deref())?;
    if request.runtime != NativeRuntimeFamilyV1::Hermes {
        return Err("OpenClaw provisioning is not available in this build".into());
    }
    hermes::ensure_name_available(&slug)?;
    let transaction = create_native_transaction(
        &app,
        owner,
        request.runtime.clone(),
        request.mode.clone(),
        slug.clone(),
        request_hash(&request)?,
        source_hash(request.source_semantic_id.as_deref()),
    )?;
    Ok(hermes::preview(
        &request,
        &candidate,
        transaction.transaction_id,
        slug,
    ))
}

#[tauri::command]
pub async fn execute_native_agent_provisioning(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ExecuteNativeProvisioningInputV1,
) -> Result<NativeProvisioningReceiptV1, String> {
    let owner = owner_pubkey(&state)?;
    let request = normalize_request(input.request)?;
    let transaction = load_native_transaction(&app, &owner, &input.transaction_id)?;
    if transaction.status == NativeProvisioningStatusV1::Complete {
        return Ok(NativeProvisioningReceiptV1 {
            schema_version: 1,
            transaction_id: transaction.transaction_id,
            runtime: transaction.runtime,
            resident_pubkey: transaction.reserved_resident_pubkey,
            native_semantic_hash: transaction.native_semantic_hash,
            status: NativeProvisioningStatusV1::Complete,
            reused: true,
            needs_attention: false,
            recovery_action: None,
        });
    }
    if transaction.status != NativeProvisioningStatusV1::Planned
        || transaction.request_hash != request_hash(&request)?
        || transaction.source_hash != source_hash(request.source_semantic_id.as_deref())
        || transaction.runtime != request.runtime
        || transaction.mode != request.mode
    {
        return Err("native provisioning approval is stale or does not match the preview".into());
    }
    let persona_id = required_text(&input.persona_id, "persona id", 256)?;
    set_native_transaction_persona(&app, &owner, &input.transaction_id, persona_id.clone())?;
    update_native_transaction(
        &app,
        &owner,
        &input.transaction_id,
        NativeProvisioningStatusV1::Provisioning,
        None,
        None,
        None,
    )?;
    let candidate = native_candidate(&request.runtime, request.source_semantic_id.as_deref())?;
    let provisioned = match hermes::execute(&request, &candidate, &transaction.intended_slug) {
        Ok(provisioned) => provisioned,
        Err(error) => {
            update_native_transaction(
                &app,
                &owner,
                &input.transaction_id,
                NativeProvisioningStatusV1::NeedsAttention,
                None,
                None,
                Some((
                    "HERMES_PROVISIONING_FAILED",
                    "Review Hermes setup, then retry.",
                )),
            )?;
            return Err(error);
        }
    };
    let semantic_hash = hex::encode(Sha256::digest(
        native_runtime_semantic_key(&provisioned.binding).as_bytes(),
    ));
    update_native_transaction(
        &app,
        &owner,
        &input.transaction_id,
        NativeProvisioningStatusV1::NativeCreated,
        None,
        Some(semantic_hash.clone()),
        None,
    )?;
    let create_input = managed_create_input(&request, &persona_id, &provisioned.binding)?;
    let resident = match create_luca_resident(create_input, app.clone(), state.clone()).await {
        Ok(resident) => resident,
        Err(_) => {
            update_native_transaction(
                &app,
                &owner,
                &input.transaction_id,
                NativeProvisioningStatusV1::NeedsAttention,
                None,
                Some(semantic_hash.clone()),
                Some((
                    "RESIDENT_LINK_FAILED",
                    "Relaunch Polyphonic to finish linking the existing Hermes profile.",
                )),
            )?;
            return Err("Hermes was created, but its Polyphonic resident needs attention".into());
        }
    };
    let resident_pubkey = resident.resident.resident_pubkey.as_str().to_string();
    update_native_transaction(
        &app,
        &owner,
        &input.transaction_id,
        NativeProvisioningStatusV1::Complete,
        Some(resident_pubkey.clone()),
        Some(semantic_hash.clone()),
        None,
    )?;
    Ok(NativeProvisioningReceiptV1 {
        schema_version: 1,
        transaction_id: input.transaction_id,
        runtime: request.runtime,
        resident_pubkey: Some(resident_pubkey),
        native_semantic_hash: Some(semantic_hash),
        status: NativeProvisioningStatusV1::Complete,
        reused: resident.reused,
        needs_attention: false,
        recovery_action: None,
    })
}

fn receipt_from_transaction(
    transaction: crate::luca::operator_forge::NativeProvisioningTransactionV1,
    reused: bool,
) -> NativeProvisioningReceiptV1 {
    NativeProvisioningReceiptV1 {
        schema_version: 1,
        transaction_id: transaction.transaction_id,
        runtime: transaction.runtime,
        resident_pubkey: transaction.reserved_resident_pubkey,
        native_semantic_hash: transaction.native_semantic_hash,
        needs_attention: transaction.status == NativeProvisioningStatusV1::NeedsAttention,
        recovery_action: transaction.recovery_action,
        status: transaction.status,
        reused,
    }
}

#[tauri::command]
pub async fn reconcile_native_agent_provisioning(
    app: AppHandle,
    state: State<'_, AppState>,
    input: NativeProvisioningTransactionInputV1,
) -> Result<NativeProvisioningReceiptV1, String> {
    let owner = owner_pubkey(&state)?;
    let transaction = load_native_transaction(&app, &owner, &input.transaction_id)?;
    if matches!(
        transaction.status,
        NativeProvisioningStatusV1::Complete | NativeProvisioningStatusV1::RolledBack
    ) {
        return Ok(receipt_from_transaction(transaction, true));
    }
    if transaction.runtime != NativeRuntimeFamilyV1::Hermes {
        return Err("OpenClaw reconciliation is not available in this build".into());
    }
    let persona_id = transaction
        .persona_id
        .as_deref()
        .ok_or_else(|| "provisioning has not reached resident linking".to_string())?;
    let candidate = native_candidate_by_id(&transaction.runtime, &transaction.intended_slug)?;
    let request = NativeProvisioningRequestV1 {
        display_name: candidate.display_name.clone(),
        system_prompt: "Native resident recovery".into(),
        runtime: transaction.runtime.clone(),
        mode: transaction.mode.clone(),
        source_semantic_id: None,
        selected_skills: Vec::new(),
        include_memory: false,
        workspace_documents: Vec::new(),
    };
    let create_input = managed_create_input(&request, persona_id, &candidate.binding_preview)?;
    let resident = create_luca_resident(create_input, app.clone(), state.clone())
        .await
        .map_err(|_| "existing native agent could not be linked to its reserved resident")?;
    let updated = update_native_transaction(
        &app,
        &owner,
        &input.transaction_id,
        NativeProvisioningStatusV1::Complete,
        Some(resident.resident.resident_pubkey.as_str().to_string()),
        transaction.native_semantic_hash,
        None,
    )?;
    Ok(receipt_from_transaction(updated, resident.reused))
}

fn native_candidate_by_id(
    runtime: &NativeRuntimeFamilyV1,
    native_id: &str,
) -> Result<DiscoveredResidentCandidate, String> {
    let kind = match runtime {
        NativeRuntimeFamilyV1::Hermes => NativeRuntimeKind::Hermes,
        NativeRuntimeFamilyV1::Openclaw => NativeRuntimeKind::Openclaw,
    };
    crate::managed_agents::discover_native_resident_outcome()
        .runtimes
        .into_iter()
        .find(|entry| entry.native_type == kind)
        .and_then(|entry| {
            entry
                .candidates
                .into_iter()
                .find(|candidate| candidate.native_id == native_id)
        })
        .ok_or_else(|| "created native identity is unavailable; no duplicate was created".into())
}

#[tauri::command]
pub async fn rollback_native_agent_provisioning(
    app: AppHandle,
    state: State<'_, AppState>,
    input: NativeProvisioningTransactionInputV1,
) -> Result<NativeProvisioningReceiptV1, String> {
    let owner = owner_pubkey(&state)?;
    let transaction = load_native_transaction(&app, &owner, &input.transaction_id)?;
    if transaction.status == NativeProvisioningStatusV1::RolledBack {
        return Ok(receipt_from_transaction(transaction, true));
    }
    if transaction.runtime != NativeRuntimeFamilyV1::Hermes {
        return Err("OpenClaw rollback is not available in this build".into());
    }
    if native_candidate_by_id(&transaction.runtime, &transaction.intended_slug).is_ok() {
        hermes::rollback(&transaction.intended_slug)?;
    }
    if let Some(pubkey) = transaction.reserved_resident_pubkey.as_ref() {
        delete_managed_agent(pubkey.clone(), Some(false), app.clone()).await?;
    }
    let updated = update_native_transaction(
        &app,
        &owner,
        &input.transaction_id,
        NativeProvisioningStatusV1::RolledBack,
        transaction.reserved_resident_pubkey,
        transaction.native_semantic_hash,
        None,
    )?;
    Ok(receipt_from_transaction(updated, false))
}

struct ProvisionedNative {
    binding: RuntimeBinding,
}

#[cfg(test)]
mod tests;
