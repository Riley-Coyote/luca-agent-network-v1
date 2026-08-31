//! Machine-local Luca Project records.
//!
//! Public Project identity is published separately as kind:30178. This store
//! is the only home for private instructions and working-folder paths.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StoredLucaProject {
    pub id: String,
    pub name: String,
    pub archived: bool,
    #[serde(default)]
    pub instructions: Option<String>,
    #[serde(default)]
    pub working_folder: Option<String>,
    #[serde(default)]
    pub context_revision: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct LucaProjectStore {
    #[serde(default)]
    owners: BTreeMap<String, BTreeMap<String, StoredLucaProject>>,
    #[serde(default)]
    chat_projects: BTreeMap<String, BTreeMap<String, String>>,
}

#[derive(Debug, Serialize)]
struct RuntimeProjectContext {
    version: u8,
    chats: BTreeMap<String, RuntimeChatProjectContext>,
}

#[derive(Debug, Serialize)]
struct RuntimeChatProjectContext {
    project_id: String,
    project_name: String,
    context_revision: u64,
    instructions: Option<String>,
    working_folder: Option<String>,
    folder_missing: bool,
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app data directory unavailable: {error}"))?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("create app data directory: {error}"))?;
    Ok(directory.join("luca-projects.json"))
}

fn read_store(path: &Path) -> Result<LucaProjectStore, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("read local Project settings: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(LucaProjectStore::default())
        }
        Err(error) => Err(format!("read local Project settings: {error}")),
    }
}

fn write_store(path: &Path, store: &LucaProjectStore) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("serialize local Project settings: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, bytes)
        .map_err(|error| format!("write local Project settings: {error}"))?;
    std::fs::rename(&temporary, path)
        .map_err(|error| format!("replace local Project settings: {error}"))
}

pub(crate) fn runtime_handoff_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app data directory unavailable: {error}"))?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("create app data directory: {error}"))?;
    Ok(directory.join("luca-project-context-handoff.json"))
}

fn write_runtime_handoff(
    app: &AppHandle,
    owner_pubkey: &str,
    store: &LucaProjectStore,
) -> Result<(), String> {
    let projects = store.owners.get(owner_pubkey);
    let bindings = store.chat_projects.get(owner_pubkey);
    let mut chats = BTreeMap::new();
    for (chat_id, project_id) in bindings.into_iter().flatten() {
        let Some(project) = projects.and_then(|items| items.get(project_id)) else {
            continue;
        };
        let folder_missing = project
            .working_folder
            .as_deref()
            .is_some_and(|folder| !Path::new(folder).is_dir());
        chats.insert(
            chat_id.clone(),
            RuntimeChatProjectContext {
                project_id: project.id.clone(),
                project_name: project.name.clone(),
                context_revision: project.context_revision,
                instructions: project
                    .instructions
                    .as_deref()
                    .map(|value| value.chars().take(12_000).collect()),
                working_folder: project
                    .working_folder
                    .as_ref()
                    .filter(|folder| Path::new(folder).is_dir())
                    .cloned(),
                folder_missing,
            },
        );
    }
    let bytes = serde_json::to_vec(&RuntimeProjectContext { version: 1, chats })
        .map_err(|error| format!("serialize Project runtime handoff: {error}"))?;
    let path = runtime_handoff_path(app)?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, bytes)
        .map_err(|error| format!("write Project runtime handoff: {error}"))?;
    std::fs::rename(&temporary, path)
        .map_err(|error| format!("replace Project runtime handoff: {error}"))
}

pub(crate) fn list_projects(
    app: &AppHandle,
    owner_pubkey: &str,
) -> Result<Vec<StoredLucaProject>, String> {
    let store = read_store(&store_path(app)?)?;
    Ok(store
        .owners
        .get(owner_pubkey)
        .map(|projects| projects.values().cloned().collect())
        .unwrap_or_default())
}

pub(crate) fn get_project(
    app: &AppHandle,
    owner_pubkey: &str,
    project_id: &str,
) -> Result<Option<StoredLucaProject>, String> {
    let store = read_store(&store_path(app)?)?;
    Ok(store
        .owners
        .get(owner_pubkey)
        .and_then(|projects| projects.get(project_id))
        .cloned())
}

pub(crate) fn put_project(
    app: &AppHandle,
    owner_pubkey: &str,
    project: StoredLucaProject,
) -> Result<(), String> {
    let path = store_path(app)?;
    let mut store = read_store(&path)?;
    store
        .owners
        .entry(owner_pubkey.to_string())
        .or_default()
        .insert(project.id.clone(), project);
    write_store(&path, &store)?;
    write_runtime_handoff(app, owner_pubkey, &store)
}

pub(crate) fn set_chat_project(
    app: &AppHandle,
    owner_pubkey: &str,
    chat_id: &str,
    project_id: Option<&str>,
) -> Result<(), String> {
    let path = store_path(app)?;
    let mut store = read_store(&path)?;
    if let Some(project_id) = project_id {
        let exists = store
            .owners
            .get(owner_pubkey)
            .is_some_and(|projects| projects.contains_key(project_id));
        if !exists {
            return Err("Project not found on this device".to_string());
        }
        let bindings = store
            .chat_projects
            .entry(owner_pubkey.to_string())
            .or_default();
        bindings.insert(chat_id.to_string(), project_id.to_string());
    } else {
        store
            .chat_projects
            .entry(owner_pubkey.to_string())
            .or_default()
            .remove(chat_id);
    }
    write_store(&path, &store)?;
    write_runtime_handoff(app, owner_pubkey, &store)
}

pub(crate) fn canonical_working_folder(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err("working folder must be an absolute path".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("working folder is not accessible: {error}"))?;
    if !canonical.is_dir() {
        return Err("working folder is not a directory".to_string());
    }
    Ok(Some(canonical.to_string_lossy().into_owned()))
}

pub(crate) fn folder_state(working_folder: Option<&str>) -> &'static str {
    match working_folder {
        None => "not_set",
        Some(path) if Path::new(path).is_dir() => "connected",
        Some(_) => "missing",
    }
}
