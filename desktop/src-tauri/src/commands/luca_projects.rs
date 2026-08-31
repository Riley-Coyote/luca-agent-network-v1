use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::{
    app_state::AppState,
    events,
    luca::projects::{
        canonical_working_folder, folder_state, list_projects, put_project, StoredLucaProject,
    },
    relay::{query_relay, submit_event_with_keys},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LucaProjectInfo {
    pub id: String,
    pub name: String,
    pub archived: bool,
    pub instructions: Option<String>,
    pub working_folder: Option<String>,
    pub working_folder_state: String,
    pub context_revision: u64,
}

impl From<StoredLucaProject> for LucaProjectInfo {
    fn from(project: StoredLucaProject) -> Self {
        let working_folder_state = folder_state(project.working_folder.as_deref()).to_string();
        Self {
            id: project.id,
            name: project.name,
            archived: project.archived,
            instructions: project.instructions,
            working_folder: project.working_folder,
            working_folder_state,
            context_revision: project.context_revision,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLucaProjectInput {
    pub name: String,
    #[serde(default)]
    pub instructions: Option<String>,
    #[serde(default)]
    pub working_folder: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLucaProjectInput {
    pub project_id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub archived: Option<bool>,
    #[serde(default, deserialize_with = "crate::util::double_option")]
    pub instructions: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::util::double_option")]
    pub working_folder: Option<Option<String>>,
}

fn normalized_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Project name is required".to_string());
    }
    if name.chars().count() > 120 {
        return Err("Project name must be at most 120 characters".to_string());
    }
    Ok(name.to_string())
}

fn normalized_instructions(value: Option<String>) -> Option<String> {
    value
        .map(|instructions| instructions.trim().to_string())
        .filter(|instructions| !instructions.is_empty())
}

fn parse_project_event(event: &nostr::Event) -> Option<(String, String, bool)> {
    let id = event.tags.iter().find_map(|tag| {
        let parts = tag.as_slice();
        (parts.len() >= 2 && parts[0] == "d").then(|| parts[1].clone())
    })?;
    let content: serde_json::Value = serde_json::from_str(&event.content).ok()?;
    let name = content.get("name")?.as_str()?.to_string();
    let archived = content.get("archived")?.as_bool()?;
    Some((id, name, archived))
}

async fn publish_project(
    state: &AppState,
    keys: &nostr::Keys,
    id: uuid::Uuid,
    name: &str,
    archived: bool,
) -> Result<(), String> {
    let builder = events::build_luca_project(id, name, archived)?;
    submit_event_with_keys(builder, state, keys, None).await?;
    Ok(())
}

#[tauri::command]
pub async fn list_luca_projects(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<LucaProjectInfo>, String> {
    let keys = state.signing_keys()?;
    let owner_pubkey = keys.public_key().to_hex();
    let _guard = state
        .luca_projects_store_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let mut projects: BTreeMap<String, StoredLucaProject> = list_projects(&app, &owner_pubkey)?
        .into_iter()
        .map(|project| (project.id.clone(), project))
        .collect();
    drop(_guard);

    let events = query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [buzz_core_pkg::kind::KIND_LUCA_PROJECT],
            "authors": [&owner_pubkey],
            "limit": 500,
        })],
    )
    .await?;
    for event in events {
        let Some((id, name, archived)) = parse_project_event(&event) else {
            continue;
        };
        projects
            .entry(id.clone())
            .and_modify(|project| {
                project.name = name.clone();
                project.archived = archived;
            })
            .or_insert(StoredLucaProject {
                id,
                name,
                archived,
                instructions: None,
                working_folder: None,
                context_revision: 0,
            });
    }

    Ok(projects.into_values().map(Into::into).collect())
}

#[tauri::command]
pub async fn create_luca_project(
    input: CreateLucaProjectInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LucaProjectInfo, String> {
    let keys = state.signing_keys()?;
    let owner_pubkey = keys.public_key().to_hex();
    let id = uuid::Uuid::new_v4();
    let project = StoredLucaProject {
        id: id.to_string(),
        name: normalized_name(&input.name)?,
        archived: false,
        instructions: normalized_instructions(input.instructions),
        working_folder: canonical_working_folder(input.working_folder.as_deref())?,
        context_revision: 1,
    };
    publish_project(&state, &keys, id, &project.name, false).await?;
    let _guard = state
        .luca_projects_store_lock
        .lock()
        .map_err(|error| error.to_string())?;
    put_project(&app, &owner_pubkey, project.clone())?;
    Ok(project.into())
}

#[tauri::command]
pub async fn update_luca_project(
    input: UpdateLucaProjectInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LucaProjectInfo, String> {
    let keys = state.signing_keys()?;
    let owner_pubkey = keys.public_key().to_hex();
    let id = uuid::Uuid::parse_str(&input.project_id)
        .map_err(|error| format!("invalid Project ID: {error}"))?;
    let _guard = state
        .luca_projects_store_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let mut project = crate::luca::projects::get_project(&app, &owner_pubkey, &input.project_id)?
        .ok_or_else(|| "Project not found".to_string())?;
    drop(_guard);

    if let Some(name) = input.name {
        project.name = normalized_name(&name)?;
    }
    if let Some(archived) = input.archived {
        project.archived = archived;
    }
    if let Some(instructions) = input.instructions {
        project.instructions = normalized_instructions(instructions);
        project.context_revision = project.context_revision.saturating_add(1);
    }
    if let Some(working_folder) = input.working_folder {
        project.working_folder = canonical_working_folder(working_folder.as_deref())?;
        project.context_revision = project.context_revision.saturating_add(1);
    }

    publish_project(&state, &keys, id, &project.name, project.archived).await?;
    let _guard = state
        .luca_projects_store_lock
        .lock()
        .map_err(|error| error.to_string())?;
    put_project(&app, &owner_pubkey, project.clone())?;
    Ok(project.into())
}
