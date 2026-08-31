//! V1.2.1 Brain connection commands.
//!
//! Discovery returns metadata and opaque capabilities only. Canonical paths,
//! index postings, source bodies, and runtime authority never cross IPC.

use crate::{
    app_state::AppState,
    luca::{connected_brain, owner_brain_store, resident_registry},
};
use luca_protocol::{
    BrainGrantStateV1, ConnectedBrainSourceKindV1, ConnectedBrainSourceStatusV1, Hex64, OpaqueId,
    RepositoryToolOperationV1, RepositoryToolReceiptStatusV1, RepositoryWorkGrantStateV1,
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
    recall_grants: Vec<ConnectedBrainGrantViewV1>,
    repository_grants: Vec<RepositoryWorkGrantViewV1>,
    repository_receipts: Vec<RepositoryToolReceiptViewV1>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedBrainGrantViewV1 {
    grant_id: String,
    source_id: String,
    resident_pubkey: String,
    state: &'static str,
    can_reconfirm: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryToolReceiptViewV1 {
    receipt_id: String,
    source_id: String,
    resident_pubkey: String,
    operation: &'static str,
    status: &'static str,
    changed_path_count: u64,
    created_at: String,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedRuntimeSessionViewV1 {
    session_id: String,
    title: String,
    preview: String,
    visible_message_count: usize,
    updated_at: Option<String>,
    available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedRuntimeSessionListV1 {
    runtime_id: String,
    source_status: &'static str,
    sessions: Vec<ConnectedRuntimeSessionViewV1>,
    total_session_count: usize,
    truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectedRuntimeSessionContextInputV1 {
    runtime_id: String,
    session_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedRuntimeSessionContextViewV1 {
    runtime_id: String,
    runtime_label: String,
    session_id: String,
    title: String,
    summary: String,
    visible_message_count: usize,
    updated_at: Option<String>,
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

fn runtime_session_kind(runtime_id: &str) -> Option<ConnectedBrainSourceKindV1> {
    match runtime_id {
        "codex" => Some(ConnectedBrainSourceKindV1::CodexHistory),
        "claude_code" => Some(ConnectedBrainSourceKindV1::ClaudeHistory),
        _ => None,
    }
}

fn source_status_rank(status: ConnectedBrainSourceStatusV1) -> u8 {
    match status {
        ConnectedBrainSourceStatusV1::Current => 0,
        ConnectedBrainSourceStatusV1::Connecting => 1,
        ConnectedBrainSourceStatusV1::NeedsAttention => 2,
        ConnectedBrainSourceStatusV1::Unavailable => 3,
        ConnectedBrainSourceStatusV1::Disconnected => 4,
    }
}

fn isolate_expected_session_source_failure(
    error: owner_brain_store::OwnerBrainStoreError,
    verify_authority: impl FnOnce() -> Result<(), owner_brain_store::OwnerBrainStoreError>,
) -> Result<bool, owner_brain_store::OwnerBrainStoreError> {
    if !matches!(
        error,
        owner_brain_store::OwnerBrainStoreError::Stale
            | owner_brain_store::OwnerBrainStoreError::Invalid
    ) {
        return Ok(false);
    }

    // Stale/invalid is also used by owner-key and runtime-authority paths.
    // Re-read the encrypted catalog before treating it as source-local so an
    // owner switch, locked/corrupt key, or crypto failure still fails closed.
    verify_authority()?;
    Ok(true)
}

fn grant_state_value(state: RepositoryWorkGrantStateV1) -> &'static str {
    match state {
        RepositoryWorkGrantStateV1::Active => "active",
        RepositoryWorkGrantStateV1::Revoked => "revoked",
        RepositoryWorkGrantStateV1::Stale => "stale",
    }
}

fn recall_state_value(state: BrainGrantStateV1) -> &'static str {
    match state {
        BrainGrantStateV1::Active => "active",
        BrainGrantStateV1::Revoked => "revoked",
        BrainGrantStateV1::Stale => "stale",
    }
}

fn operation_value(operation: RepositoryToolOperationV1) -> &'static str {
    match operation {
        RepositoryToolOperationV1::OperatorStatus => "polyphonic_status",
        RepositoryToolOperationV1::List => "repositories",
        RepositoryToolOperationV1::Tree => "repo_tree",
        RepositoryToolOperationV1::Search => "repo_search",
        RepositoryToolOperationV1::Read => "repo_read",
        RepositoryToolOperationV1::ApplyPatch => "repo_apply_patch",
        RepositoryToolOperationV1::Run => "repo_run",
        RepositoryToolOperationV1::Status => "repo_status",
        RepositoryToolOperationV1::Diff => "repo_diff",
        RepositoryToolOperationV1::Commit => "repo_commit",
    }
}

fn receipt_status_value(status: RepositoryToolReceiptStatusV1) -> &'static str {
    match status {
        RepositoryToolReceiptStatusV1::Completed => "completed",
        RepositoryToolReceiptStatusV1::Denied => "denied",
        RepositoryToolReceiptStatusV1::Failed => "failed",
        RepositoryToolReceiptStatusV1::Cancelled => "cancelled",
        RepositoryToolReceiptStatusV1::Stale => "stale",
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
    app: &AppHandle,
    state: &AppState,
    discoveries: Vec<connected_brain::ConnectedBrainDiscoveryViewV1>,
    catalog: owner_brain_store::ConnectedBrainCatalogV1,
) -> ConnectedBrainInventoryV1 {
    let source_ids = catalog
        .sources
        .iter()
        .map(|summary| summary.source.source_id.clone())
        .collect();
    ConnectedBrainInventoryV1 {
        consent_copy: CONNECTION_CONSENT,
        discoveries,
        sources: catalog.sources.into_iter().map(source_view).collect(),
        recall_grants: catalog
            .recall_grants
            .into_iter()
            .map(|stored| {
                let authority = crate::managed_agents::current_owner_brain_runtime_authority(
                    app,
                    &stored.grant.resident_pubkey,
                )
                .ok();
                let effective = owner_brain_store::effective_grant_state(
                    &stored.grant,
                    authority.as_ref().map(|(binding, _)| binding),
                    authority.as_ref().map(|(_, egress)| *egress),
                );
                ConnectedBrainGrantViewV1 {
                    grant_id: stored.grant.grant_id.as_str().to_owned(),
                    source_id: stored.source_id.as_str().to_owned(),
                    resident_pubkey: stored.grant.resident_pubkey.as_str().to_owned(),
                    state: recall_state_value(effective),
                    can_reconfirm: effective == BrainGrantStateV1::Stale,
                }
            })
            .collect(),
        repository_grants: catalog
            .repository_grants
            .into_iter()
            .map(|grant| RepositoryWorkGrantViewV1 {
                grant_id: grant.grant_id.as_str().to_owned(),
                source_id: grant.source_id.as_str().to_owned(),
                resident_pubkey: grant.resident_pubkey.as_str().to_owned(),
                state: grant_state_value(
                    if grant.state == RepositoryWorkGrantStateV1::Active
                        && crate::managed_agents::current_owner_brain_runtime_authority(
                            app,
                            &grant.resident_pubkey,
                        )
                        .is_ok_and(|(binding, _)| binding == grant.binding_ref)
                    {
                        RepositoryWorkGrantStateV1::Active
                    } else if grant.state == RepositoryWorkGrantStateV1::Revoked {
                        RepositoryWorkGrantStateV1::Revoked
                    } else {
                        RepositoryWorkGrantStateV1::Stale
                    },
                ),
            })
            .collect(),
        repository_receipts: state
            .repository_tool_receipts(&source_ids)
            .into_iter()
            .map(|receipt| RepositoryToolReceiptViewV1 {
                receipt_id: receipt.receipt_id.as_str().to_owned(),
                source_id: receipt.source_id.as_str().to_owned(),
                resident_pubkey: receipt.resident_pubkey.as_str().to_owned(),
                operation: operation_value(receipt.operation),
                status: receipt_status_value(receipt.status),
                changed_path_count: receipt.changed_path_count.get(),
                created_at: receipt.created_at.as_str().to_owned(),
            })
            .collect(),
    }
}

fn resident_authorities(
    app: &AppHandle,
    state: &AppState,
) -> Result<Vec<owner_brain_store::ConnectedBrainResidentAuthorityV1>, String> {
    Ok(resident_registry::load_resident_registry(app, state)?
        .residents
        .into_iter()
        .filter_map(|resident| {
            crate::managed_agents::current_owner_brain_runtime_authority(
                app,
                &resident.resident_pubkey,
            )
            .ok()
            .map(|(binding_ref, provider_egress)| {
                owner_brain_store::ConnectedBrainResidentAuthorityV1 {
                    resident_pubkey: resident.resident_pubkey,
                    binding_ref,
                    provider_egress,
                }
            })
        })
        .collect())
}

fn load_inventory(
    app: &AppHandle,
    state: &AppState,
    owner: &Hex64,
    discoveries: Vec<connected_brain::ConnectedBrainDiscoveryViewV1>,
) -> Result<ConnectedBrainInventoryV1, String> {
    state
        .read_connected_brain_catalog(owner)
        .map(|catalog| inventory(app, state, discoveries, catalog))
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
        load_inventory(&app, &state, &owner, discoveries)
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
        load_inventory(&app, &state, &owner, discoveries).map(Some)
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
        load_inventory(&app, &state, &owner, Vec::new())
    })
    .await
    .map_err(|_| "connected Brain inventory worker failed".to_owned())?
}

/// List only sessions already represented by a connected Codex or Claude
/// Brain index. Session locators and native provider IDs never cross IPC.
#[tauri::command]
pub async fn list_connected_runtime_sessions(
    runtime_id: String,
    app: AppHandle,
) -> Result<ConnectedRuntimeSessionListV1, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(kind) = runtime_session_kind(&runtime_id) else {
            return Ok(ConnectedRuntimeSessionListV1 {
                runtime_id,
                source_status: "unsupported",
                sessions: Vec::new(),
                total_session_count: 0,
                truncated: false,
            });
        };
        let state = app.state::<AppState>();
        let owner = owner_pubkey(&state)?;
        let catalog = state
            .read_connected_brain_catalog(&owner)
            .map_err(|error| error.code().to_owned())?;
        let mut sources = catalog
            .sources
            .into_iter()
            .filter(|source| {
                source.source.source_kind == kind
                    && source.source.status != ConnectedBrainSourceStatusV1::Disconnected
            })
            .collect::<Vec<_>>();
        sources.sort_by(|left, right| left.source.source_id.cmp(&right.source.source_id));
        if sources.is_empty() {
            return Ok(ConnectedRuntimeSessionListV1 {
                runtime_id,
                source_status: "not_connected",
                sessions: Vec::new(),
                total_session_count: 0,
                truncated: false,
            });
        }

        let catalog_source_status = sources
            .iter()
            .map(|source| source.source.status)
            .max_by_key(|status| source_status_rank(*status))
            .map(status_value)
            .unwrap_or("not_connected");
        let mut total_session_count = 0_usize;
        let mut sessions = Vec::new();
        let mut had_source_failure = false;
        let mut read_budget = connected_brain::SessionReadBudget::for_rail_list();
        for source in sources {
            let listed = match state.read_connected_brain_sessions(
                &owner,
                &source.source.source_id,
                &mut read_budget,
            ) {
                Ok(listed) => listed,
                Err(error) => {
                    match isolate_expected_session_source_failure(error, || {
                        state.read_connected_brain_catalog(&owner).map(|_| ())
                    }) {
                        Ok(true) => {
                            had_source_failure = true;
                            continue;
                        }
                        Ok(false) => return Err(error.code().to_owned()),
                        Err(authority_error) => {
                            return Err(authority_error.code().to_owned());
                        }
                    }
                }
            };
            total_session_count = total_session_count.saturating_add(listed.total_sessions);
            sessions.extend(listed.sessions.into_iter().map(|session| {
                ConnectedRuntimeSessionViewV1 {
                    session_id: session.session_id.as_str().to_owned(),
                    title: session.title,
                    preview: session.preview,
                    visible_message_count: session.visible_message_count,
                    updated_at: session.updated_at,
                    available: session.available,
                }
            }));
        }
        sessions.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.session_id.cmp(&right.session_id))
        });
        sessions.dedup_by(|left, right| left.session_id == right.session_id);
        sessions.truncate(200);
        let truncated = total_session_count > sessions.len();
        Ok(ConnectedRuntimeSessionListV1 {
            runtime_id,
            source_status: if had_source_failure {
                "needs_attention"
            } else {
                catalog_source_status
            },
            sessions,
            total_session_count,
            truncated,
        })
    })
    .await
    .map_err(|_| "connected runtime session worker failed".to_owned())?
}

/// Resolve one opaque indexed session into bounded visible excerpts for a new
/// Polyphonic composer. This does not resume or mutate the provider session.
#[tauri::command]
pub async fn get_connected_runtime_session_context(
    input: ConnectedRuntimeSessionContextInputV1,
    app: AppHandle,
) -> Result<ConnectedRuntimeSessionContextViewV1, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let kind = runtime_session_kind(&input.runtime_id)
            .ok_or_else(|| "connected-runtime-session-unsupported".to_owned())?;
        let session_id = OpaqueId::parse(input.session_id)
            .map_err(|_| "connected-runtime-session-invalid".to_owned())?;
        let state = app.state::<AppState>();
        let owner = owner_pubkey(&state)?;
        let catalog = state
            .read_connected_brain_catalog(&owner)
            .map_err(|error| error.code().to_owned())?;
        for source in catalog.sources.into_iter().filter(|source| {
            source.source.source_kind == kind
                && source.source.status != ConnectedBrainSourceStatusV1::Disconnected
        }) {
            let context = match state.read_connected_brain_session_context(
                &owner,
                &source.source.source_id,
                &session_id,
            ) {
                Ok(context) => context,
                Err(error) => {
                    match isolate_expected_session_source_failure(error, || {
                        state.read_connected_brain_catalog(&owner).map(|_| ())
                    }) {
                        Ok(true) => continue,
                        Ok(false) => return Err(error.code().to_owned()),
                        Err(authority_error) => {
                            return Err(authority_error.code().to_owned());
                        }
                    }
                }
            };
            if let Some(context) = context {
                return Ok(ConnectedRuntimeSessionContextViewV1 {
                    runtime_id: input.runtime_id,
                    runtime_label: source.source.display_name,
                    session_id: context.session_id.as_str().to_owned(),
                    title: context.title,
                    summary: context.summary,
                    visible_message_count: context.visible_message_count,
                    updated_at: context.updated_at,
                });
            }
        }
        Err("connected-runtime-session-not-found".to_owned())
    })
    .await
    .map_err(|_| "connected runtime context worker failed".to_owned())?
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
            let build = match connected_brain::build_index(&source_id, &candidate) {
                Ok(build) => build,
                Err(error) if error == "connected source contains no indexable text" => continue,
                Err(error) => return Err(error),
            };
            let result = state
                .connect_brain_source(owner.clone(), candidate, build, &authorities)
                .map_err(|error| error.code().to_owned())?;
            replayed &= result.replayed;
            if connected_brain::register_connected_source(&state, source_id.clone(), &watch_root)
                .is_err()
            {
                eprintln!(
                    "buzz-desktop: connected Brain source is current but background watch is unavailable"
                );
            }
            sources.push(source_view(result.source));
        }
        if sources.is_empty() {
            return Err("connected sources contain no indexable text".to_owned());
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
        let watch_root = candidate.canonical_root.clone();
        let build = connected_brain::build_index(&source_id, &candidate)?;
        let result = state
            .connect_brain_source(owner.clone(), candidate, build, &authorities)
            .map_err(|error| error.code().to_owned())?;
        if connected_brain::register_connected_source(&state, source_id.clone(), &watch_root)
            .is_err()
        {
            eprintln!(
                "buzz-desktop: refreshed Brain source is current but background watch is unavailable"
            );
        }
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
        load_inventory(&app, &state, &owner, Vec::new())
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
        load_inventory(&app, &state, &owner, Vec::new())
    })
    .await
    .map_err(|_| "connected Brain reconfirm worker failed".to_owned())?
}

#[tauri::command]
pub async fn revoke_connected_brain_resident(
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
        state
            .revoke_connected_brain_resident(&owner, &source_id, resident_pubkey)
            .map_err(|error| error.code().to_owned())?;
        load_inventory(&app, &state, &owner, Vec::new())
    })
    .await
    .map_err(|_| "connected Brain revoke worker failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_source_failures_are_isolated_without_masking_authority_failures() {
        assert_eq!(
            isolate_expected_session_source_failure(
                owner_brain_store::OwnerBrainStoreError::Stale,
                || Ok(())
            ),
            Ok(true)
        );
        assert_eq!(
            isolate_expected_session_source_failure(
                owner_brain_store::OwnerBrainStoreError::Invalid,
                || Err(owner_brain_store::OwnerBrainStoreError::Locked)
            ),
            Err(owner_brain_store::OwnerBrainStoreError::Locked)
        );
        for error in [
            owner_brain_store::OwnerBrainStoreError::Cancelled,
            owner_brain_store::OwnerBrainStoreError::Locked,
            owner_brain_store::OwnerBrainStoreError::Timeout,
            owner_brain_store::OwnerBrainStoreError::Unavailable,
        ] {
            assert_eq!(
                isolate_expected_session_source_failure(error, || {
                    panic!("non-source failure must not be reclassified")
                }),
                Ok(false)
            );
        }
    }
}
