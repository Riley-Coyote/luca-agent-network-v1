//! V1.2.1 Brain connection commands.
//!
//! Discovery returns metadata and opaque capabilities only. Canonical paths,
//! index postings, source bodies, and runtime authority never cross IPC.

use crate::{
    app_state::AppState,
    luca::{connected_brain, owner_brain_store, resident_registry},
};
use luca_protocol::{
    ConnectedBrainSourceKindV1, ConnectedBrainSourceStatusV1, Hex64, OpaqueId,
    RepositoryWorkGrantStateV1,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const CONNECTION_CONSENT: &str = "Luca keeps a private local index while your originals stay where they are. Your agents may send only relevant excerpts to their configured models. Repository edits and commands always ask first.";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedBrainInventoryV1 {
    consent_copy: &'static str,
    discoveries: Vec<connected_brain::ConnectedBrainDiscoveryViewV1>,
    sources: Vec<ConnectedBrainSourceViewV1>,
    repository_grants: Vec<RepositoryWorkGrantViewV1>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedBrainSourceViewV1 {
    source_id: String,
    source_kind: &'static str,
    display_name: String,
    status: &'static str,
    item_count: u64,
    entry_count: u64,
    last_refreshed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryWorkGrantViewV1 {
    grant_id: String,
    source_id: String,
    resident_pubkey: String,
    state: &'static str,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectConnectedBrainSourceInputV1 {
    discovery_ids: Vec<String>,
    consent_accepted: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectedBrainSourceInputV1 {
    source_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReconfirmConnectedBrainSourceInputV1 {
    source_id: String,
    resident_pubkey: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedBrainMutationResultV1 {
    sources: Vec<ConnectedBrainSourceViewV1>,
    replayed: bool,
}

fn owner_pubkey(state: &AppState) -> Result<Hex64, String> {
    Hex64::parse(state.signing_keys()?.public_key().to_hex())
        .map_err(|_| "active owner identity is invalid".to_owned())
}

fn kind_value(kind: ConnectedBrainSourceKindV1) -> &'static str {
    match kind {
        ConnectedBrainSourceKindV1::Repository => "repository",
        ConnectedBrainSourceKindV1::CodexHistory => "codex_history",
        ConnectedBrainSourceKindV1::ClaudeHistory => "claude_history",
    }
}

fn status_value(status: ConnectedBrainSourceStatusV1) -> &'static str {
    match status {
        ConnectedBrainSourceStatusV1::Connecting => "connecting",
        ConnectedBrainSourceStatusV1::Current => "current",
        ConnectedBrainSourceStatusV1::NeedsAttention => "needs_attention",
        ConnectedBrainSourceStatusV1::Unavailable => "unavailable",
        ConnectedBrainSourceStatusV1::Disconnected => "disconnected",
    }
}

fn grant_state_value(state: RepositoryWorkGrantStateV1) -> &'static str {
    match state {
        RepositoryWorkGrantStateV1::Active => "active",
        RepositoryWorkGrantStateV1::Revoked => "revoked",
        RepositoryWorkGrantStateV1::Stale => "stale",
    }
}

fn source_view(
    summary: owner_brain_store::ConnectedBrainSourceSummaryV1,
) -> ConnectedBrainSourceViewV1 {
    ConnectedBrainSourceViewV1 {
        source_id: summary.source.source_id.as_str().to_owned(),
        source_kind: kind_value(summary.source.source_kind),
        display_name: summary.source.display_name,
        status: status_value(summary.source.status),
        item_count: summary.item_count.get(),
        entry_count: summary.entry_count.get(),
        last_refreshed_at: summary
            .source
            .last_refreshed_at
            .map(|value| value.as_str().to_owned()),
    }
}

fn inventory(
    discoveries: Vec<connected_brain::ConnectedBrainDiscoveryViewV1>,
    catalog: owner_brain_store::ConnectedBrainCatalogV1,
) -> ConnectedBrainInventoryV1 {
    ConnectedBrainInventoryV1 {
        consent_copy: CONNECTION_CONSENT,
        discoveries,
        sources: catalog.sources.into_iter().map(source_view).collect(),
        repository_grants: catalog
            .repository_grants
            .into_iter()
            .map(|grant| RepositoryWorkGrantViewV1 {
                grant_id: grant.grant_id.as_str().to_owned(),
                source_id: grant.source_id.as_str().to_owned(),
                resident_pubkey: grant.resident_pubkey.as_str().to_owned(),
                state: grant_state_value(grant.state),
            })
            .collect(),
    }
}

fn resident_authorities(
    app: &AppHandle,
    state: &AppState,
) -> Result<Vec<owner_brain_store::ConnectedBrainResidentAuthorityV1>, String> {
    resident_registry::load_resident_registry(app, state)?
        .residents
        .into_iter()
        .map(|resident| {
            let (binding_ref, provider_egress) =
                crate::managed_agents::current_owner_brain_runtime_authority(
                    app,
                    &resident.resident_pubkey,
                )?;
            Ok(owner_brain_store::ConnectedBrainResidentAuthorityV1 {
                resident_pubkey: resident.resident_pubkey,
                binding_ref,
                provider_egress,
            })
        })
        .collect()
}

fn load_inventory(
    state: &AppState,
    owner: &Hex64,
    discoveries: Vec<connected_brain::ConnectedBrainDiscoveryViewV1>,
) -> Result<ConnectedBrainInventoryV1, String> {
    state
        .read_connected_brain_catalog(owner)
        .map(|catalog| inventory(discoveries, catalog))
        .map_err(|error| error.code().to_owned())
}

#[tauri::command]
pub async fn discover_connected_brain_sources(
    app: AppHandle,
) -> Result<ConnectedBrainInventoryV1, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner = owner_pubkey(&state)?;
        let candidates = connected_brain::discover()?;
        let discoveries =
            connected_brain::cache_candidates(&state.connected_brain_discovery, candidates)?;
        load_inventory(&state, &owner, discoveries)
    })
    .await
    .map_err(|_| "connected Brain discovery worker failed".to_owned())?
}

#[tauri::command]
pub async fn add_connected_brain_root(
    app: AppHandle,
) -> Result<Option<ConnectedBrainInventoryV1>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Add repository folder")
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "selected folder is unavailable".to_owned())?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner = owner_pubkey(&state)?;
        let candidates = connected_brain::discover_in_added_root(&path)?;
        let discoveries =
            connected_brain::cache_candidates(&state.connected_brain_discovery, candidates)?;
        load_inventory(&state, &owner, discoveries).map(Some)
    })
    .await
    .map_err(|_| "connected Brain discovery worker failed".to_owned())?
}

#[tauri::command]
pub async fn list_connected_brain_sources(
    app: AppHandle,
) -> Result<ConnectedBrainInventoryV1, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner = owner_pubkey(&state)?;
        load_inventory(&state, &owner, Vec::new())
    })
    .await
    .map_err(|_| "connected Brain inventory worker failed".to_owned())?
}

#[tauri::command]
pub async fn connect_connected_brain_source(
    input: ConnectConnectedBrainSourceInputV1,
    app: AppHandle,
) -> Result<ConnectedBrainMutationResultV1, String> {
    if !input.consent_accepted || input.discovery_ids.is_empty() || input.discovery_ids.len() > 512
    {
        return Err("connected Brain consent and bounded selection are required".to_owned());
    }
    let discovery_ids = input
        .discovery_ids
        .into_iter()
        .map(OpaqueId::parse)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "connected Brain discovery ID is invalid".to_owned())?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner = owner_pubkey(&state)?;
        let authorities = resident_authorities(&app, &state)?;
        let mut sources = Vec::with_capacity(discovery_ids.len());
        let mut replayed = true;
        for discovery_id in discovery_ids {
            let candidate =
                connected_brain::take_candidate(&state.connected_brain_discovery, &discovery_id)?;
            let source_id = connected_brain::source_id_for_candidate(&candidate)?;
            let watch_root = candidate.canonical_root.clone();
            let build = connected_brain::build_index(&source_id, &candidate)?;
            let result = state
                .connect_brain_source(owner.clone(), candidate, build, &authorities)
                .map_err(|error| error.code().to_owned())?;
            replayed &= result.replayed;
            if connected_brain::register_connected_source(&state, source_id.clone(), &watch_root)
                .is_err()
            {
                state
                    .set_connected_brain_status(
                        &owner,
                        &source_id,
                        ConnectedBrainSourceStatusV1::NeedsAttention,
                    )
                    .map_err(|error| error.code().to_owned())?;
            }
            sources.push(source_view(result.source));
        }
        Ok(ConnectedBrainMutationResultV1 { sources, replayed })
    })
    .await
    .map_err(|_| "connected Brain connection worker failed".to_owned())?
}

#[tauri::command]
pub async fn refresh_connected_brain_source(
    input: ConnectedBrainSourceInputV1,
    app: AppHandle,
) -> Result<ConnectedBrainMutationResultV1, String> {
    let source_id = OpaqueId::parse(input.source_id)
        .map_err(|_| "connected Brain source ID is invalid".to_owned())?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner = owner_pubkey(&state)?;
        let authorities = resident_authorities(&app, &state)?;
        let candidate = state
            .read_connected_brain_candidate(&owner, &source_id)
            .map_err(|error| error.code().to_owned())?;
        let build = connected_brain::build_index(&source_id, &candidate)?;
        let result = state
            .connect_brain_source(owner, candidate, build, &authorities)
            .map_err(|error| error.code().to_owned())?;
        Ok(ConnectedBrainMutationResultV1 {
            sources: vec![source_view(result.source)],
            replayed: result.replayed,
        })
    })
    .await
    .map_err(|_| "connected Brain refresh worker failed".to_owned())?
}

#[tauri::command]
pub async fn disconnect_connected_brain_source(
    input: ConnectedBrainSourceInputV1,
    app: AppHandle,
) -> Result<ConnectedBrainInventoryV1, String> {
    let source_id = OpaqueId::parse(input.source_id)
        .map_err(|_| "connected Brain source ID is invalid".to_owned())?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner = owner_pubkey(&state)?;
        state
            .disconnect_connected_brain_source(&owner, &source_id)
            .map_err(|error| error.code().to_owned())?;
        let _ = connected_brain::unregister_connected_source(&state, &source_id);
        load_inventory(&state, &owner, Vec::new())
    })
    .await
    .map_err(|_| "connected Brain disconnect worker failed".to_owned())?
}

#[tauri::command]
pub async fn reconfirm_connected_brain_source(
    input: ReconfirmConnectedBrainSourceInputV1,
    app: AppHandle,
) -> Result<ConnectedBrainInventoryV1, String> {
    let source_id = OpaqueId::parse(input.source_id)
        .map_err(|_| "connected Brain source ID is invalid".to_owned())?;
    let resident_pubkey = Hex64::parse(input.resident_pubkey)
        .map_err(|_| "connected Brain resident identity is invalid".to_owned())?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let owner = owner_pubkey(&state)?;
        let (binding_ref, provider_egress) =
            crate::managed_agents::current_owner_brain_runtime_authority(&app, &resident_pubkey)?;
        state
            .reconfirm_connected_brain_source(
                &owner,
                &source_id,
                owner_brain_store::ConnectedBrainResidentAuthorityV1 {
                    resident_pubkey,
                    binding_ref,
                    provider_egress,
                },
            )
            .map_err(|error| error.code().to_owned())?;
        load_inventory(&state, &owner, Vec::new())
    })
    .await
    .map_err(|_| "connected Brain reconfirm worker failed".to_owned())?
}
