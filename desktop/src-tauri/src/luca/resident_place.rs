//! Private, resident-authored presentation records for the Agent Library.
//!
//! This is intentionally a small device-local store.  It is neither a prompt
//! source nor a runtime configuration surface: it keeps only the presentation
//! text the owner or a resident deliberately authored and one immutable
//! Artifact Library version reference.

use std::{
    fs,
    io::Write as _,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use atomic_write_file::AtomicWriteFile;
use luca_protocol::{Hex64, OpaqueId, SafeU53};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter as _, Manager};

use crate::{
    app_state::AppState,
    data_dir::BuzzPathExt,
    luca::{
        artifacts::{ArtifactDeletedFilter, ArtifactListQuery, ArtifactStore},
        conversation_context::active_scope,
    },
    managed_agents::{load_managed_agents, BackendKind, ManagedAgentRecord},
    relay,
};

const STORE_SCHEMA: &str = "luca.resident-place.v1";
const STORE_DIRECTORY: &str = "resident-places";
const MAX_INTRODUCTION_CHARS: usize = 1_200;
const MAX_EXPLORATION_CHARS: usize = 1_600;
const MAX_WORK_ITEMS: u16 = 100;
const PLACE_CHANGED_EVENT: &str = "luca://resident-place-changed";

#[cfg(test)]
#[path = "resident_place/tests.rs"]
mod tests;

/// Mirrors the frontend conflict prefix.  The value after the prefix is the
/// current revision and never includes authored content.
pub(crate) const RESIDENT_PLACE_CONFLICT_PREFIX: &str = "resident_place_conflict:";

/// A pinned immutable Artifact Library version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ResidentPlaceWork {
    artifact_id: String,
    version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ResidentPlaceContent {
    introduction: String,
    exploration: String,
    selected_work: Option<ResidentPlaceWork>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ResidentPlaceUpdateInput {
    expected_revision: u64,
    content: ResidentPlaceContent,
}

/// Broker-only flat tool payload.  It deliberately has no target identity,
/// policy, author, or nested owner-IPC shape to smuggle across the runtime
/// boundary.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
struct AgentResidentPlaceUpdateInput {
    expected_revision: u64,
    introduction: String,
    exploration: String,
    selected_work: Option<AgentResidentPlaceWork>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentResidentPlaceWork {
    artifact_id: String,
    version: u64,
}

impl From<AgentResidentPlaceUpdateInput> for ResidentPlaceUpdateInput {
    fn from(value: AgentResidentPlaceUpdateInput) -> Self {
        Self {
            expected_revision: value.expected_revision,
            content: ResidentPlaceContent {
                introduction: value.introduction,
                exploration: value.exploration,
                selected_work: value.selected_work.map(|work| ResidentPlaceWork {
                    artifact_id: work.artifact_id,
                    version: work.version,
                }),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResidentPlaceWorkView {
    artifact_id: String,
    version: u64,
    title: String,
    kind: String,
    conversation_id: Option<String>,
    availability: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResidentPlaceAuthor {
    kind: &'static str,
    pubkey: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResidentPlaceView {
    resident_pubkey: String,
    revision: u64,
    resident_editing_enabled: bool,
    visibility: &'static str,
    content: ResidentPlaceContent,
    author: Option<ResidentPlaceAuthor>,
    updated_at: Option<u64>,
    selected_work: Option<ResidentPlaceWorkView>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum AuthorKind {
    Owner,
    Resident,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredAuthor {
    kind: AuthorKind,
    pubkey: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredPlace {
    schema: String,
    owner_pubkey: String,
    relay_scope: String,
    resident_pubkey: String,
    revision: u64,
    resident_editing_enabled: bool,
    visibility: String,
    content: ResidentPlaceContent,
    author: Option<StoredAuthor>,
    updated_at: Option<u64>,
}

#[derive(Debug, Clone)]
struct PlaceScope {
    owner: Hex64,
    relay_scope: String,
    resident: ManagedAgentRecord,
}

static PLACE_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn write_lock() -> &'static Mutex<()> {
    PLACE_WRITE_LOCK.get_or_init(|| Mutex::new(()))
}

fn invalid() -> String {
    "resident-place-invalid".to_owned()
}

fn unavailable() -> String {
    "resident-place-unavailable".to_owned()
}

fn corrupt() -> String {
    "resident-place-corrupt".to_owned()
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

fn validate_content(content: &ResidentPlaceContent) -> Result<(), String> {
    if content.introduction.chars().count() > MAX_INTRODUCTION_CHARS
        || content.exploration.chars().count() > MAX_EXPLORATION_CHARS
    {
        return Err(invalid());
    }
    if content
        .selected_work
        .as_ref()
        .is_some_and(|work| work.artifact_id.trim().is_empty() || work.version == 0)
    {
        return Err(invalid());
    }
    Ok(())
}

fn scope_for_resident(app: &AppHandle, resident_pubkey: &str) -> Result<PlaceScope, String> {
    let resident_key =
        Hex64::parse(resident_pubkey.trim().to_ascii_lowercase()).map_err(|_| invalid())?;
    let state = app.state::<AppState>();
    let (owner, relay_scope) = active_scope(&state).map_err(|_| unavailable())?;
    if resident_key == owner {
        return Err("resident-place-resident-invalid".into());
    }
    let workspace_relay = relay::relay_ws_url_with_override(&state);
    let resident = load_managed_agents(app)
        .map_err(|_| unavailable())?
        .into_iter()
        .find(|record| record.pubkey.eq_ignore_ascii_case(resident_key.as_str()))
        .ok_or_else(|| "resident-place-resident-unmanaged".to_owned())?;
    if !matches!(resident.backend, BackendKind::Local) {
        return Err("resident-place-resident-not-local".into());
    }
    if relay::effective_agent_relay_url(&resident.relay_url, &workspace_relay) != workspace_relay {
        return Err("resident-place-resident-relay-mismatch".into());
    }
    Ok(PlaceScope {
        owner,
        relay_scope,
        resident,
    })
}

fn ensure_scope_unchanged(app: &AppHandle, scope: &PlaceScope) -> Result<(), String> {
    let refreshed = scope_for_resident(app, &scope.resident.pubkey)?;
    if refreshed.owner != scope.owner || refreshed.relay_scope != scope.relay_scope {
        return Err("resident-place-scope-changed".into());
    }
    Ok(())
}

fn places_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .buzz_path()
        .app_data_dir()
        .map_err(|_| unavailable())?
        .join("luca")
        .join(STORE_DIRECTORY);
    if let Ok(metadata) = fs::symlink_metadata(&root) {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(corrupt());
        }
    } else {
        fs::create_dir_all(&root).map_err(|_| unavailable())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
                .map_err(|_| unavailable())?;
        }
    }
    Ok(root)
}

fn record_path(app: &AppHandle, scope: &PlaceScope) -> Result<PathBuf, String> {
    let mut hasher = Sha256::new();
    hasher.update(b"luca.resident-place.path.v1\0");
    hasher.update(scope.owner.as_str().as_bytes());
    hasher.update(b"\0");
    hasher.update(scope.relay_scope.as_bytes());
    hasher.update(b"\0");
    hasher.update(scope.resident.pubkey.to_ascii_lowercase().as_bytes());
    Ok(places_dir(app)?.join(format!("{}.json", hex::encode(hasher.finalize()))))
}

fn default_record(scope: &PlaceScope) -> StoredPlace {
    StoredPlace {
        schema: STORE_SCHEMA.to_owned(),
        owner_pubkey: scope.owner.as_str().to_owned(),
        relay_scope: scope.relay_scope.clone(),
        resident_pubkey: scope.resident.pubkey.to_ascii_lowercase(),
        revision: 0,
        resident_editing_enabled: false,
        visibility: "private".to_owned(),
        content: ResidentPlaceContent {
            introduction: String::new(),
            exploration: String::new(),
            selected_work: None,
        },
        author: None,
        updated_at: None,
    }
}

fn validate_record(record: &StoredPlace, scope: &PlaceScope) -> Result<(), String> {
    if !record_matches_scope(
        record,
        scope.owner.as_str(),
        &scope.relay_scope,
        &scope.resident.pubkey,
    ) {
        return Err(corrupt());
    }
    validate_content(&record.content).map_err(|_| corrupt())?;
    if record.revision == 0 && (record.author.is_some() || record.updated_at.is_some()) {
        return Err(corrupt());
    }
    // Enabling resident authoring is a policy revision, not authored content;
    // a freshly enabled empty place therefore has neither author nor date.
    // Once content is authored, the two fields are always present together.
    if record.author.is_some() != record.updated_at.is_some() {
        return Err(corrupt());
    }
    if let Some(author) = &record.author {
        let expected = match author.kind {
            AuthorKind::Owner => scope.owner.as_str(),
            AuthorKind::Resident => scope.resident.pubkey.as_str(),
        };
        if !author.pubkey.eq_ignore_ascii_case(expected) {
            return Err(corrupt());
        }
    }
    Ok(())
}

fn record_matches_scope(
    record: &StoredPlace,
    owner: &str,
    relay_scope: &str,
    resident: &str,
) -> bool {
    record.schema == STORE_SCHEMA
        && record.owner_pubkey == owner
        && record.relay_scope == relay_scope
        && record.resident_pubkey.eq_ignore_ascii_case(resident)
        && record.visibility == "private"
}

fn require_resident_authoring_enabled(record: &StoredPlace) -> Result<(), String> {
    if record.resident_editing_enabled {
        Ok(())
    } else {
        Err("resident-place-authoring-disabled".into())
    }
}

fn read_record(app: &AppHandle, scope: &PlaceScope) -> Result<StoredPlace, String> {
    let path = record_path(app, scope)?;
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(default_record(scope))
        }
        Err(_) => return Err(unavailable()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(corrupt());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err(corrupt());
        }
    }
    let bytes = fs::read(&path).map_err(|_| unavailable())?;
    let record: StoredPlace = serde_json::from_slice(&bytes).map_err(|_| corrupt())?;
    validate_record(&record, scope)?;
    Ok(record)
}

fn write_record(app: &AppHandle, scope: &PlaceScope, record: &StoredPlace) -> Result<(), String> {
    validate_record(record, scope)?;
    let path = record_path(app, scope)?;
    if let Ok(metadata) = fs::symlink_metadata(&path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(corrupt());
        }
    }
    let bytes = serde_json::to_vec(record).map_err(|_| unavailable())?;
    let mut file = AtomicWriteFile::open(&path).map_err(|_| unavailable())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| unavailable())?;
    }
    file.write_all(&bytes).map_err(|_| unavailable())?;
    file.commit().map_err(|_| unavailable())
}

fn conflict(revision: u64) -> String {
    format!("{RESIDENT_PLACE_CONFLICT_PREFIX}{revision}")
}

fn update_record(
    app: &AppHandle,
    scope: &PlaceScope,
    expected_revision: u64,
    content: ResidentPlaceContent,
    author: StoredAuthor,
    require_enabled: bool,
) -> Result<StoredPlace, String> {
    let _guard = write_lock().lock().map_err(|_| unavailable())?;
    let mut current = read_record(app, scope)?;
    apply_content_update(
        &mut current,
        expected_revision,
        content,
        author,
        require_enabled,
    )?;
    write_record(app, scope, &current)?;
    Ok(current)
}

fn apply_content_update(
    current: &mut StoredPlace,
    expected_revision: u64,
    content: ResidentPlaceContent,
    author: StoredAuthor,
    require_enabled: bool,
) -> Result<(), String> {
    validate_content(&content)?;
    if require_enabled {
        require_resident_authoring_enabled(current)?;
    }
    if current.revision != expected_revision {
        if current.content == content {
            return Ok(());
        }
        return Err(conflict(current.revision));
    }
    if current.content == content {
        return Ok(());
    }
    current.revision = current.revision.checked_add(1).ok_or_else(unavailable)?;
    current.content = content;
    current.author = Some(author);
    current.updated_at = Some(now_seconds());
    Ok(())
}

fn set_editing_record(
    app: &AppHandle,
    scope: &PlaceScope,
    expected_revision: u64,
    enabled: bool,
) -> Result<StoredPlace, String> {
    let _guard = write_lock().lock().map_err(|_| unavailable())?;
    let mut current = read_record(app, scope)?;
    apply_editing_update(&mut current, expected_revision, enabled)?;
    write_record(app, scope, &current)?;
    Ok(current)
}

fn apply_editing_update(
    current: &mut StoredPlace,
    expected_revision: u64,
    enabled: bool,
) -> Result<(), String> {
    if current.revision != expected_revision {
        if current.resident_editing_enabled == enabled {
            return Ok(());
        }
        return Err(conflict(current.revision));
    }
    if current.resident_editing_enabled == enabled {
        return Ok(());
    }
    current.revision = current.revision.checked_add(1).ok_or_else(unavailable)?;
    current.resident_editing_enabled = enabled;
    // A policy edit must not claim the authoring timestamp or voice.
    Ok(())
}

fn artifact_store(app: &AppHandle) -> Result<ArtifactStore, String> {
    let root = app.buzz_path().app_data_dir().map_err(|_| unavailable())?;
    ArtifactStore::open(&root).map_err(|_| unavailable())
}

fn exact_work_view(
    app: &AppHandle,
    scope: &PlaceScope,
    work: &ResidentPlaceWork,
) -> Result<ResidentPlaceWorkView, String> {
    let store = artifact_store(app)?;
    exact_work_view_from_store(&store, scope, work)
}

fn exact_work_view_from_store(
    store: &ArtifactStore,
    scope: &PlaceScope,
    work: &ResidentPlaceWork,
) -> Result<ResidentPlaceWorkView, String> {
    let artifact_id = OpaqueId::parse(work.artifact_id.clone()).map_err(|_| invalid())?;
    let _version = SafeU53::new(work.version).map_err(|_| invalid())?;
    if work.version == 0 {
        return Err(invalid());
    }
    let artifact = store
        .get(&scope.owner, &artifact_id)
        .map_err(|_| "resident-place-work-unavailable".to_owned())?;
    if artifact.deleted_at.is_some()
        || !artifact
            .created_by_pubkey
            .eq_ignore_ascii_case(scope.resident.pubkey.as_str())
    {
        return Err("resident-place-work-unavailable".into());
    }
    let version = store
        .versions(&scope.owner, &artifact_id)
        .map_err(|_| "resident-place-work-unavailable".to_owned())?
        .into_iter()
        .find(|version| version.version == work.version)
        .ok_or_else(|| "resident-place-work-unavailable".to_owned())?;
    if !version
        .created_by_pubkey
        .eq_ignore_ascii_case(scope.resident.pubkey.as_str())
        || version
            .conversation_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .is_none()
    {
        return Err("resident-place-work-unavailable".into());
    }
    Ok(ResidentPlaceWorkView {
        artifact_id: work.artifact_id.clone(),
        version: work.version,
        title: artifact.title,
        kind: format!("{:?}", artifact.kind).to_ascii_lowercase(),
        conversation_id: version.conversation_id,
        availability: "available",
    })
}

async fn verify_private_conversation(
    app: &AppHandle,
    scope: &PlaceScope,
    conversation_id: &str,
) -> Result<(), String> {
    let (details, members) = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::try_join!(
            crate::commands::get_channel_details(
                conversation_id.to_owned(),
                app.state::<AppState>()
            ),
            crate::commands::get_channel_members(
                conversation_id.to_owned(),
                app.state::<AppState>()
            ),
        )
    })
    .await
    .map_err(|_| "resident-place-conversation-unavailable".to_owned())?
    .map_err(|_| "resident-place-conversation-unavailable".to_owned())?;
    if !is_private_channel_visibility(&details.visibility) || members.members.is_empty() {
        return Err("resident-place-conversation-unavailable".into());
    }
    let workspace_relay = relay::relay_ws_url_with_override(&app.state::<AppState>());
    let managed = load_managed_agents(app)
        .map_err(|_| unavailable())?
        .into_iter()
        .filter(|record| matches!(record.backend, BackendKind::Local))
        .filter(|record| {
            relay::effective_agent_relay_url(&record.relay_url, &workspace_relay) == workspace_relay
        })
        .map(|record| record.pubkey.to_ascii_lowercase())
        .collect::<std::collections::BTreeSet<_>>();
    let owner = scope.owner.as_str().to_ascii_lowercase();
    let resident = scope.resident.pubkey.to_ascii_lowercase();
    let member_keys = members
        .members
        .into_iter()
        .map(|member| member.pubkey.to_ascii_lowercase())
        .collect::<std::collections::BTreeSet<_>>();
    if !member_keys.contains(&owner)
        || !member_keys.contains(&resident)
        || member_keys
            .iter()
            .any(|member| member != &owner && !managed.contains(member))
    {
        return Err("resident-place-conversation-private-required".into());
    }
    Ok(())
}

fn is_private_channel_visibility(visibility: &str) -> bool {
    visibility.eq_ignore_ascii_case("private")
}

async fn verify_work_for_scope(
    app: &AppHandle,
    scope: &PlaceScope,
    work: &ResidentPlaceWork,
    required_conversation: Option<&str>,
) -> Result<ResidentPlaceWorkView, String> {
    let view = exact_work_view(app, scope, work)?;
    let conversation_id = view
        .conversation_id
        .as_deref()
        .ok_or_else(|| "resident-place-work-unavailable".to_owned())?;
    if required_conversation.is_some_and(|required| required != conversation_id) {
        return Err("resident-place-work-conversation-mismatch".into());
    }
    verify_private_conversation(app, scope, conversation_id).await?;
    // The relay lookup crossed an async boundary.  Re-read the active scope
    // before the caller mutates any private record.
    ensure_scope_unchanged(app, scope)?;
    exact_work_view(app, scope, work)
}

async fn work_view_or_unavailable(
    app: &AppHandle,
    scope: &PlaceScope,
    work: &ResidentPlaceWork,
) -> ResidentPlaceWorkView {
    match verify_work_for_scope(app, scope, work, None).await {
        Ok(view) => view,
        Err(_) => ResidentPlaceWorkView {
            artifact_id: work.artifact_id.clone(),
            version: work.version,
            title: String::new(),
            kind: String::new(),
            conversation_id: None,
            availability: "unavailable",
        },
    }
}

async fn view_for_record(
    app: &AppHandle,
    scope: &PlaceScope,
    record: StoredPlace,
) -> ResidentPlaceView {
    let selected_work = match &record.content.selected_work {
        Some(work) => Some(work_view_or_unavailable(app, scope, work).await),
        None => None,
    };
    ResidentPlaceView {
        resident_pubkey: scope.resident.pubkey.clone(),
        revision: record.revision,
        resident_editing_enabled: record.resident_editing_enabled,
        visibility: "private",
        content: record.content,
        author: record.author.map(|author| ResidentPlaceAuthor {
            kind: match author.kind {
                AuthorKind::Owner => "owner",
                AuthorKind::Resident => "resident",
            },
            pubkey: author.pubkey,
        }),
        updated_at: record.updated_at,
        selected_work,
    }
}

fn emit_changed(app: &AppHandle, resident_pubkey: &str) {
    let _ = app.emit(
        PLACE_CHANGED_EVENT,
        serde_json::json!({ "residentPubkey": resident_pubkey }),
    );
}

#[tauri::command]
pub(crate) async fn get_resident_place(
    resident_pubkey: String,
    app: AppHandle,
) -> Result<ResidentPlaceView, String> {
    let scope = scope_for_resident(&app, &resident_pubkey)?;
    let record = read_record(&app, &scope)?;
    let view = view_for_record(&app, &scope, record).await;
    ensure_scope_unchanged(&app, &scope)?;
    Ok(view)
}

#[tauri::command]
pub(crate) async fn update_resident_place(
    resident_pubkey: String,
    input: ResidentPlaceUpdateInput,
    app: AppHandle,
) -> Result<ResidentPlaceView, String> {
    let scope = scope_for_resident(&app, &resident_pubkey)?;
    if let Some(work) = &input.content.selected_work {
        verify_work_for_scope(&app, &scope, work, None).await?;
    }
    ensure_scope_unchanged(&app, &scope)?;
    let record = update_record(
        &app,
        &scope,
        input.expected_revision,
        input.content,
        StoredAuthor {
            kind: AuthorKind::Owner,
            pubkey: scope.owner.as_str().to_owned(),
        },
        false,
    )?;
    emit_changed(&app, &scope.resident.pubkey);
    let view = view_for_record(&app, &scope, record).await;
    ensure_scope_unchanged(&app, &scope)?;
    Ok(view)
}

#[tauri::command]
pub(crate) async fn set_resident_place_editing(
    resident_pubkey: String,
    expected_revision: u64,
    enabled: bool,
    app: AppHandle,
) -> Result<ResidentPlaceView, String> {
    let scope = scope_for_resident(&app, &resident_pubkey)?;
    let record = set_editing_record(&app, &scope, expected_revision, enabled)?;
    emit_changed(&app, &scope.resident.pubkey);
    let view = view_for_record(&app, &scope, record).await;
    ensure_scope_unchanged(&app, &scope)?;
    Ok(view)
}

#[tauri::command]
pub(crate) async fn list_resident_place_work(
    resident_pubkey: String,
    app: AppHandle,
) -> Result<Vec<ResidentPlaceWorkView>, String> {
    let scope = scope_for_resident(&app, &resident_pubkey)?;
    let store = artifact_store(&app)?;
    let records = store
        .list_page(
            &scope.owner,
            &ArtifactListQuery {
                query: None,
                kinds: Vec::new(),
                deleted: ArtifactDeletedFilter::Active,
                cursor: None,
                limit: MAX_WORK_ITEMS,
            },
        )
        .map_err(|_| unavailable())?
        .artifacts;
    let mut result = Vec::new();
    let mut conversation_access = std::collections::BTreeMap::new();
    for artifact in records {
        ensure_scope_unchanged(&app, &scope)?;
        if !artifact
            .created_by_pubkey
            .eq_ignore_ascii_case(scope.resident.pubkey.as_str())
        {
            continue;
        }
        let artifact_id =
            OpaqueId::parse(artifact.artifact_id.clone()).map_err(|_| unavailable())?;
        let versions = store
            .versions(&scope.owner, &artifact_id)
            .map_err(|_| unavailable())?;
        for version in versions {
            ensure_scope_unchanged(&app, &scope)?;
            if result.len() >= usize::from(MAX_WORK_ITEMS) {
                ensure_scope_unchanged(&app, &scope)?;
                return Ok(result);
            }
            let work = ResidentPlaceWork {
                artifact_id: artifact.artifact_id.clone(),
                version: version.version,
            };
            let view = match exact_work_view_from_store(&store, &scope, &work) {
                Ok(view) => view,
                Err(_) => continue,
            };
            let Some(conversation_id) = view.conversation_id.as_deref() else {
                continue;
            };
            if !conversation_access.contains_key(conversation_id) {
                let accessible = verify_private_conversation(&app, &scope, conversation_id)
                    .await
                    .is_ok();
                ensure_scope_unchanged(&app, &scope)?;
                conversation_access.insert(conversation_id.to_owned(), accessible);
            }
            if conversation_access.get(conversation_id) != Some(&true) {
                continue;
            }
            result.push(view);
        }
    }
    ensure_scope_unchanged(&app, &scope)?;
    Ok(result)
}

/// The narrow resident capability entrypoint.  The parent broker supplies the
/// exact-turn capability validator and frozen owner/relay scope; this module
/// owns only the Place data checks and never accepts authority fields from the
/// agent payload.
pub(crate) struct AgentOperationScope<'a> {
    pub(crate) owner: &'a str,
    pub(crate) relay: &'a str,
    pub(crate) resident: &'a str,
    pub(crate) conversation: &'a str,
}

pub(crate) async fn agent_operation(
    app: &AppHandle,
    expected: AgentOperationScope<'_>,
    operation: &str,
    arguments: serde_json::Value,
    authorize: &dyn Fn() -> Result<(), String>,
) -> Result<serde_json::Value, String> {
    let AgentOperationScope {
        owner: expected_owner,
        relay: expected_relay_scope,
        resident: resident_pubkey,
        conversation: conversation_id,
    } = expected;
    let scope = scope_for_resident(app, resident_pubkey)?;
    if scope.owner.as_str() != expected_owner || scope.relay_scope != expected_relay_scope {
        return Err("resident-place-scope-changed".into());
    }
    match operation {
        "resident_place_get" => {
            if arguments != serde_json::json!({}) {
                return Err(invalid());
            }
            verify_private_conversation(app, &scope, conversation_id).await?;
            ensure_scope_unchanged(app, &scope)?;
            authorize().map_err(|_| "resident-place-not-authorized".to_owned())?;
            let record = read_record(app, &scope)?;
            require_resident_authoring_enabled(&record)?;
            let view = view_for_record(app, &scope, record).await;
            ensure_scope_unchanged(app, &scope)?;
            authorize().map_err(|_| "resident-place-not-authorized".to_owned())?;
            require_resident_authoring_enabled(&read_record(app, &scope)?)?;
            serde_json::to_value(view).map_err(|_| unavailable())
        }
        "resident_place_update" => {
            let input: ResidentPlaceUpdateInput =
                serde_json::from_value::<AgentResidentPlaceUpdateInput>(arguments)
                    .map(Into::into)
                    .map_err(|_| invalid())?;
            // Resident authoring is confined to an actual private current
            // conversation even when the update clears its selected work.
            verify_private_conversation(app, &scope, conversation_id).await?;
            if let Some(work) = &input.content.selected_work {
                verify_work_for_scope(app, &scope, work, Some(conversation_id)).await?;
            }
            ensure_scope_unchanged(app, &scope)?;
            authorize().map_err(|_| "resident-place-not-authorized".to_owned())?;
            let record = update_record(
                app,
                &scope,
                input.expected_revision,
                input.content,
                StoredAuthor {
                    kind: AuthorKind::Resident,
                    pubkey: scope.resident.pubkey.clone(),
                },
                true,
            )?;
            emit_changed(app, &scope.resident.pubkey);
            let view = view_for_record(app, &scope, record).await;
            ensure_scope_unchanged(app, &scope)?;
            authorize().map_err(|_| "resident-place-not-authorized".to_owned())?;
            require_resident_authoring_enabled(&read_record(app, &scope)?)?;
            serde_json::to_value(view).map_err(|_| unavailable())
        }
        _ => Err(invalid()),
    }
}
