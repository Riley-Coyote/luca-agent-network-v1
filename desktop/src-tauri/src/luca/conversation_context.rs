//! Device-local conversation context authority for runtime-backed residents.
//!
//! The persisted contract contains opaque connected-source identifiers only.
//! Canonical filesystem paths stay inside the encrypted connected Brain
//! binding store and are resolved only for one exact managed dispatch.

use crate::data_dir::BuzzPathExt;
use std::{
    collections::{BTreeSet, HashMap},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use luca_protocol::{
    canonical_sha256, ConnectedBrainSourceKindV1, ConnectedBrainSourceStatusV1, Hex64, OpaqueId,
    Sha256Ref,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::{app_state::AppState, relay};

use super::{
    managed_dispatch_store::{atomic_write_restricted, global_dispatch_store},
    owner_brain_store::{ConnectedBrainCatalogV1, ConnectedBrainSourceSummaryV1},
};

const STORE_SCHEMA: &str = "luca.conversation-context-store.v1";
const SNAPSHOT_PROTOCOL: &str = "luca.conversation-context-snapshot.v1";
const SNAPSHOT_BINDING_PROTOCOL: &str = "luca.conversation-context-binding.v1";
const MAX_CONTEXT_RECORDS: usize = 2_048;
const MAX_CONTEXT_SOURCES: usize = 32;
const MAX_CONTEXT_SNAPSHOTS: usize = 1_024;
const CONTEXT_SNAPSHOT_TTL_SECONDS: u64 = 30 * 60;

static GLOBAL_STORE: OnceLock<Arc<Mutex<ConversationContextStore>>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum PrimaryModeV1 {
    Inherit,
    None,
    Source,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ProjectContextV1 {
    owner_pubkey: String,
    relay_scope: String,
    project_id: String,
    primary_source_id: Option<String>,
    additional_source_ids: Vec<String>,
    revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct RoomContextV1 {
    owner_pubkey: String,
    relay_scope: String,
    conversation_id: String,
    project_id: Option<String>,
    primary_mode: PrimaryModeV1,
    primary_source_id: Option<String>,
    additional_source_ids: Vec<String>,
    revision: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedConversationContextStoreV1 {
    schema: String,
    next_revision: u64,
    projects: Vec<ProjectContextV1>,
    rooms: Vec<RoomContextV1>,
    #[serde(default)]
    snapshots: Vec<ConversationContextSnapshotV1>,
}

pub(crate) struct ConversationContextStore {
    path: PathBuf,
    next_revision: u64,
    projects: HashMap<(String, String, String), ProjectContextV1>,
    rooms: HashMap<(String, String, String), RoomContextV1>,
    snapshots: HashMap<(String, String, String), ConversationContextSnapshotV1>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SyncConversationContextInputV1 {
    conversation_id: String,
    project_id: Option<String>,
    #[serde(default)]
    project_source_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateConversationContextInputV1 {
    conversation_id: String,
    project_id: Option<String>,
    expected_revision: u64,
    primary_mode: String,
    primary_source_id: Option<String>,
    #[serde(default)]
    additional_source_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConversationContextInputV1 {
    conversation_id: String,
    project_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MutateConversationContextInputV1 {
    conversation_id: String,
    project_id: Option<String>,
    expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationContextSourceViewV1 {
    source_id: String,
    label: String,
    role: &'static str,
    origin: &'static str,
    source_kind: &'static str,
    availability: &'static str,
    native_directory: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationContextCapabilityViewV1 {
    label: &'static str,
    state: &'static str,
    detail: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationContextViewV1 {
    conversation_id: String,
    project_id: Option<String>,
    primary: Option<ConversationContextSourceViewV1>,
    additional_sources: Vec<ConversationContextSourceViewV1>,
    status: &'static str,
    revision: u64,
    capabilities: Vec<ConversationContextCapabilityViewV1>,
}

/// Minimal path-free context binding persisted on one exact managed dispatch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DispatchContextBindingV1 {
    pub(crate) protocol: String,
    pub(crate) snapshot_ref: Sha256Ref,
    pub(crate) revision: u64,
}

impl DispatchContextBindingV1 {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.protocol != SNAPSHOT_BINDING_PROTOCOL || self.revision == 0 {
            return Err("conversation context binding is invalid".into());
        }
        Ok(())
    }
}

/// Device-local immutable source coordinates resolved only after exact dispatch
/// authorization. This record remains path-free; canonical roots stay in the
/// connected-source binding store.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConversationContextSnapshotV1 {
    protocol: String,
    snapshot_ref: Sha256Ref,
    owner_pubkey: String,
    relay_scope: String,
    conversation_id: String,
    revision: u64,
    pub(crate) primary_source_id: Option<OpaqueId>,
    pub(crate) additional_source_ids: Vec<OpaqueId>,
    pub(crate) selected_source_ids: Vec<OpaqueId>,
    created_at: u64,
    expires_at: u64,
}

impl ConversationContextSnapshotV1 {
    fn validate(&self) -> Result<(), String> {
        let mut selected = self.selected_source_ids.clone();
        selected.sort();
        selected.dedup();
        let mut additional = self.additional_source_ids.clone();
        additional.sort();
        additional.dedup();
        if self.protocol != SNAPSHOT_PROTOCOL
            || validate_identity_scope(&self.owner_pubkey, &self.relay_scope).is_err()
            || validate_conversation_id(&self.conversation_id).is_err()
            || self.revision == 0
            || self.created_at == 0
            || self.expires_at <= self.created_at
            || self.selected_source_ids.len() > MAX_CONTEXT_SOURCES
            || self.additional_source_ids.len() > MAX_CONTEXT_SOURCES
            || selected != self.selected_source_ids
            || additional != self.additional_source_ids
            || self
                .primary_source_id
                .as_ref()
                .is_some_and(|primary| !self.selected_source_ids.contains(primary))
            || self
                .additional_source_ids
                .iter()
                .any(|source| !self.selected_source_ids.contains(source))
        {
            return Err("conversation context snapshot is invalid".into());
        }
        let digest = snapshot_digest(
            &self.owner_pubkey,
            &self.relay_scope,
            &self.conversation_id,
            self.revision,
            self.primary_source_id.as_ref(),
            &self.additional_source_ids,
            &self.selected_source_ids,
        )?;
        if self.snapshot_ref.as_str() != format!("sha256:{digest}") {
            return Err("conversation context snapshot digest is invalid".into());
        }
        Ok(())
    }
}

/// Process-local roots resolved for the authorized dispatch. Paths in this
/// value are never serialized into renderer state, relay events, or receipts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedDispatchContextV1 {
    pub(crate) snapshot_ref: Sha256Ref,
    pub(crate) revision: u64,
    pub(crate) cwd: Option<PathBuf>,
    pub(crate) additional_directories: Vec<PathBuf>,
    pub(crate) selected_source_ids: Vec<OpaqueId>,
    pub(crate) native_roots_ref: Sha256Ref,
    pub(crate) degraded: bool,
}

#[derive(Clone, Copy)]
struct Scope<'a> {
    owner: &'a str,
    relay: &'a str,
}

#[derive(Clone)]
struct EffectiveContextV1 {
    project_id: Option<String>,
    primary_source_id: Option<String>,
    primary_origin: &'static str,
    additional: Vec<(String, &'static str)>,
    revision: u64,
}

impl ConversationContextStore {
    fn load(path: PathBuf) -> Result<Self, String> {
        if !path.exists() {
            return Ok(Self {
                path,
                next_revision: 1,
                projects: HashMap::new(),
                rooms: HashMap::new(),
                snapshots: HashMap::new(),
            });
        }
        let bytes = std::fs::read(&path)
            .map_err(|error| format!("read conversation context store: {error}"))?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("conversation context store exceeds size limit".into());
        }
        let persisted: PersistedConversationContextStoreV1 = serde_json::from_slice(&bytes)
            .map_err(|error| format!("parse conversation context store: {error}"))?;
        if persisted.schema != STORE_SCHEMA
            || persisted
                .projects
                .len()
                .saturating_add(persisted.rooms.len())
                > MAX_CONTEXT_RECORDS
            || persisted.next_revision == 0
        {
            return Err("conversation context store schema or size is invalid".into());
        }
        let mut projects = HashMap::new();
        for project in persisted.projects {
            validate_project(&project)?;
            let key = (
                project.owner_pubkey.clone(),
                project.relay_scope.clone(),
                project.project_id.clone(),
            );
            if projects.insert(key, project).is_some() {
                return Err("conversation context store contains duplicate projects".into());
            }
        }
        let mut rooms = HashMap::new();
        for room in persisted.rooms {
            validate_room(&room)?;
            let key = (
                room.owner_pubkey.clone(),
                room.relay_scope.clone(),
                room.conversation_id.clone(),
            );
            if rooms.insert(key, room).is_some() {
                return Err("conversation context store contains duplicate rooms".into());
            }
        }
        let mut snapshots = HashMap::new();
        for snapshot in persisted.snapshots {
            snapshot.validate()?;
            let key = (
                snapshot.owner_pubkey.clone(),
                snapshot.relay_scope.clone(),
                snapshot.snapshot_ref.as_str().to_owned(),
            );
            if snapshots.insert(key, snapshot).is_some() {
                return Err("conversation context store contains duplicate snapshots".into());
            }
        }
        if snapshots.len() > MAX_CONTEXT_SNAPSHOTS {
            return Err("conversation context store contains too many snapshots".into());
        }
        Ok(Self {
            path,
            next_revision: persisted.next_revision,
            projects,
            rooms,
            snapshots,
        })
    }

    fn room_key(scope: Scope<'_>, conversation_id: &str) -> (String, String, String) {
        (
            scope.owner.to_owned(),
            scope.relay.to_owned(),
            conversation_id.to_owned(),
        )
    }

    fn project_key(scope: Scope<'_>, project_id: &str) -> (String, String, String) {
        (
            scope.owner.to_owned(),
            scope.relay.to_owned(),
            project_id.to_owned(),
        )
    }

    fn next_revision(&mut self) -> Result<u64, String> {
        let revision = self.next_revision;
        self.next_revision = self
            .next_revision
            .checked_add(1)
            .ok_or_else(|| "conversation context revision exhausted".to_owned())?;
        Ok(revision)
    }

    fn sync(
        &mut self,
        scope: Scope<'_>,
        input: &SyncConversationContextInputV1,
        catalog: &ConnectedBrainCatalogV1,
    ) -> Result<(), String> {
        validate_conversation_id(&input.conversation_id)?;
        let project_id = normalize_project_id(input.project_id.as_deref())?;
        let valid_project_sources = valid_source_ids(catalog, &input.project_source_ids)?;
        let mut changed = false;
        if let Some(project_id) = project_id.as_deref() {
            let key = Self::project_key(scope, project_id);
            if !self.projects.contains_key(&key) {
                let primary_source_id = valid_project_sources
                    .iter()
                    .find(|source_id| source_is_repository(catalog, source_id))
                    .cloned();
                let additional_source_ids = valid_project_sources
                    .iter()
                    .filter(|source_id| Some(*source_id) != primary_source_id.as_ref())
                    .cloned()
                    .collect();
                let revision = self.next_revision()?;
                self.projects.insert(
                    key,
                    ProjectContextV1 {
                        owner_pubkey: scope.owner.to_owned(),
                        relay_scope: scope.relay.to_owned(),
                        project_id: project_id.to_owned(),
                        primary_source_id,
                        additional_source_ids,
                        revision,
                    },
                );
                changed = true;
            }
        }
        let room_key = Self::room_key(scope, &input.conversation_id);
        if self
            .rooms
            .get(&room_key)
            .is_some_and(|room| room.project_id != project_id)
        {
            let revision = self.next_revision()?;
            let room = self
                .rooms
                .get_mut(&room_key)
                .ok_or_else(|| "conversation context room disappeared".to_owned())?;
            room.project_id = project_id;
            room.revision = revision;
            changed = true;
        } else if self.rooms.contains_key(&room_key) {
            // The existing room is already bound to the requested project.
        } else {
            let revision = self.next_revision()?;
            self.rooms.insert(
                room_key,
                RoomContextV1 {
                    owner_pubkey: scope.owner.to_owned(),
                    relay_scope: scope.relay.to_owned(),
                    conversation_id: input.conversation_id.clone(),
                    project_id,
                    primary_mode: PrimaryModeV1::Inherit,
                    primary_source_id: None,
                    additional_source_ids: Vec::new(),
                    revision,
                },
            );
            changed = true;
        }
        if changed {
            self.persist()?;
        }
        Ok(())
    }

    fn update_room(
        &mut self,
        scope: Scope<'_>,
        input: &UpdateConversationContextInputV1,
        catalog: &ConnectedBrainCatalogV1,
    ) -> Result<(), String> {
        validate_conversation_id(&input.conversation_id)?;
        let project_id = normalize_project_id(input.project_id.as_deref())?;
        let primary_mode = parse_primary_mode(&input.primary_mode)?;
        let primary_source_id = match primary_mode {
            PrimaryModeV1::Source => {
                let source = input
                    .primary_source_id
                    .as_deref()
                    .ok_or_else(|| "working folder source is required".to_owned())?;
                validate_source_id(catalog, source)?;
                if !source_is_repository(catalog, source) {
                    return Err("working folder must be a connected repository".into());
                }
                Some(source.to_owned())
            }
            PrimaryModeV1::Inherit | PrimaryModeV1::None => None,
        };
        let mut additional_source_ids = valid_source_ids(catalog, &input.additional_source_ids)?;
        additional_source_ids.retain(|source| Some(source) != primary_source_id.as_ref());
        let key = Self::room_key(scope, &input.conversation_id);
        let existing = self
            .rooms
            .get(&key)
            .ok_or_else(|| "conversation context has not been initialized".to_owned())?;
        if existing.project_id != project_id {
            return Err("conversation context changed; refresh and try again".into());
        }
        let project_revision = existing
            .project_id
            .as_deref()
            .and_then(|project_id| self.projects.get(&Self::project_key(scope, project_id)))
            .map_or(0, |project| project.revision);
        if existing.revision.max(project_revision) != input.expected_revision {
            return Err("conversation context changed; refresh and try again".into());
        }
        let revision = self.next_revision()?;
        self.rooms.insert(
            key,
            RoomContextV1 {
                owner_pubkey: scope.owner.to_owned(),
                relay_scope: scope.relay.to_owned(),
                conversation_id: input.conversation_id.clone(),
                project_id,
                primary_mode,
                primary_source_id,
                additional_source_ids,
                revision,
            },
        );
        self.persist()
    }

    fn promote_room(
        &mut self,
        scope: Scope<'_>,
        conversation_id: &str,
        project_id: &str,
        expected_revision: u64,
    ) -> Result<(), String> {
        let room_key = Self::room_key(scope, conversation_id);
        let effective = self.effective(scope, conversation_id)?;
        if effective.revision != expected_revision {
            return Err("conversation context changed; refresh and try again".into());
        }
        let primary_source_id = effective.primary_source_id;
        let mut additional_source_ids = effective
            .additional
            .into_iter()
            .map(|(source, _)| source)
            .collect::<Vec<_>>();
        additional_source_ids.sort();
        additional_source_ids.dedup();
        let revision = self.next_revision()?;
        self.projects.insert(
            Self::project_key(scope, project_id),
            ProjectContextV1 {
                owner_pubkey: scope.owner.to_owned(),
                relay_scope: scope.relay.to_owned(),
                project_id: project_id.to_owned(),
                primary_source_id,
                additional_source_ids,
                revision,
            },
        );
        let revision = self.next_revision()?;
        let room = self
            .rooms
            .get_mut(&room_key)
            .ok_or_else(|| "conversation context has not been initialized".to_owned())?;
        room.project_id = Some(project_id.to_owned());
        room.primary_mode = PrimaryModeV1::Inherit;
        room.primary_source_id = None;
        room.additional_source_ids.clear();
        room.revision = revision;
        self.persist()
    }

    fn clear_override(
        &mut self,
        scope: Scope<'_>,
        conversation_id: &str,
        expected_revision: u64,
    ) -> Result<(), String> {
        let key = Self::room_key(scope, conversation_id);
        let effective = self.effective(scope, conversation_id)?;
        if effective.revision != expected_revision {
            return Err("conversation context changed; refresh and try again".into());
        }
        let revision = self.next_revision()?;
        let room = self
            .rooms
            .get_mut(&key)
            .ok_or_else(|| "conversation context has not been initialized".to_owned())?;
        room.primary_mode = PrimaryModeV1::Inherit;
        room.primary_source_id = None;
        room.additional_source_ids.clear();
        room.revision = revision;
        self.persist()
    }

    fn effective(
        &self,
        scope: Scope<'_>,
        conversation_id: &str,
    ) -> Result<EffectiveContextV1, String> {
        let room = self
            .rooms
            .get(&Self::room_key(scope, conversation_id))
            .ok_or_else(|| "conversation context has not been initialized".to_owned())?;
        let project = room
            .project_id
            .as_deref()
            .and_then(|project_id| self.projects.get(&Self::project_key(scope, project_id)));
        let (primary_source_id, primary_origin) = match room.primary_mode {
            PrimaryModeV1::Source => (room.primary_source_id.clone(), "room"),
            PrimaryModeV1::None => (None, "room"),
            PrimaryModeV1::Inherit => (
                project.and_then(|value| value.primary_source_id.clone()),
                "project",
            ),
        };
        let mut additional = Vec::new();
        let mut seen = BTreeSet::new();
        if let Some(project) = project {
            for source in &project.additional_source_ids {
                if Some(source) != primary_source_id.as_ref() && seen.insert(source.clone()) {
                    additional.push((source.clone(), "project"));
                }
            }
        }
        for source in &room.additional_source_ids {
            if Some(source) != primary_source_id.as_ref() && seen.insert(source.clone()) {
                additional.push((source.clone(), "room"));
            }
        }
        Ok(EffectiveContextV1 {
            project_id: room.project_id.clone(),
            primary_source_id,
            primary_origin,
            additional,
            revision: room
                .revision
                .max(project.map_or(0, |project| project.revision)),
        })
    }

    fn store_snapshot(
        &mut self,
        snapshot: ConversationContextSnapshotV1,
        now_unix_secs: u64,
    ) -> Result<(), String> {
        snapshot.validate()?;
        self.snapshots
            .retain(|_, candidate| candidate.expires_at >= now_unix_secs);
        let key = (
            snapshot.owner_pubkey.clone(),
            snapshot.relay_scope.clone(),
            snapshot.snapshot_ref.as_str().to_owned(),
        );
        if let Some(existing) = self.snapshots.get_mut(&key) {
            if existing.protocol != snapshot.protocol
                || existing.snapshot_ref != snapshot.snapshot_ref
                || existing.owner_pubkey != snapshot.owner_pubkey
                || existing.relay_scope != snapshot.relay_scope
                || existing.conversation_id != snapshot.conversation_id
                || existing.revision != snapshot.revision
                || existing.primary_source_id != snapshot.primary_source_id
                || existing.additional_source_ids != snapshot.additional_source_ids
                || existing.selected_source_ids != snapshot.selected_source_ids
            {
                return Err("conversation context snapshot collision".into());
            }
            existing.expires_at = existing.expires_at.max(snapshot.expires_at);
        } else {
            if self.snapshots.len() >= MAX_CONTEXT_SNAPSHOTS {
                return Err("conversation context snapshot store is full".into());
            }
            self.snapshots.insert(key, snapshot);
        }
        self.persist()
    }

    fn snapshot(
        &self,
        scope: Scope<'_>,
        conversation_id: &str,
        binding: &DispatchContextBindingV1,
        now_unix_secs: u64,
    ) -> Result<ConversationContextSnapshotV1, String> {
        binding.validate()?;
        let snapshot = self
            .snapshots
            .get(&(
                scope.owner.to_owned(),
                scope.relay.to_owned(),
                binding.snapshot_ref.as_str().to_owned(),
            ))
            .ok_or_else(|| "conversation context snapshot is unavailable".to_owned())?;
        if snapshot.conversation_id != conversation_id
            || snapshot.revision != binding.revision
            || snapshot.expires_at < now_unix_secs
        {
            return Err("conversation context snapshot binding is invalid".into());
        }
        Ok(snapshot.clone())
    }

    fn persist(&self) -> Result<(), String> {
        if self.projects.len().saturating_add(self.rooms.len()) > MAX_CONTEXT_RECORDS {
            return Err("conversation context store exceeds record limit".into());
        }
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "conversation context store has no parent".to_owned())?;
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create conversation context directory: {error}"))?;
        let mut projects = self.projects.values().cloned().collect::<Vec<_>>();
        projects.sort_by(|left, right| {
            (&left.owner_pubkey, &left.relay_scope, &left.project_id).cmp(&(
                &right.owner_pubkey,
                &right.relay_scope,
                &right.project_id,
            ))
        });
        let mut rooms = self.rooms.values().cloned().collect::<Vec<_>>();
        rooms.sort_by(|left, right| {
            (&left.owner_pubkey, &left.relay_scope, &left.conversation_id).cmp(&(
                &right.owner_pubkey,
                &right.relay_scope,
                &right.conversation_id,
            ))
        });
        let mut snapshots = self.snapshots.values().cloned().collect::<Vec<_>>();
        snapshots.sort_by(|left, right| {
            (&left.owner_pubkey, &left.relay_scope, &left.snapshot_ref).cmp(&(
                &right.owner_pubkey,
                &right.relay_scope,
                &right.snapshot_ref,
            ))
        });
        let bytes = serde_json::to_vec(&PersistedConversationContextStoreV1 {
            schema: STORE_SCHEMA.to_owned(),
            next_revision: self.next_revision,
            projects,
            rooms,
            snapshots,
        })
        .map_err(|error| format!("serialize conversation context store: {error}"))?;
        atomic_write_restricted(&self.path, &bytes)
    }
}

fn validate_project(project: &ProjectContextV1) -> Result<(), String> {
    validate_identity_scope(&project.owner_pubkey, &project.relay_scope)?;
    normalize_project_id(Some(&project.project_id))?;
    validate_persisted_sources(
        project.primary_source_id.as_deref(),
        &project.additional_source_ids,
    )?;
    if project.revision == 0 {
        return Err("conversation context project revision is invalid".into());
    }
    Ok(())
}

fn validate_room(room: &RoomContextV1) -> Result<(), String> {
    validate_identity_scope(&room.owner_pubkey, &room.relay_scope)?;
    validate_conversation_id(&room.conversation_id)?;
    normalize_project_id(room.project_id.as_deref())?;
    validate_persisted_sources(
        room.primary_source_id.as_deref(),
        &room.additional_source_ids,
    )?;
    if room.revision == 0
        || (room.primary_mode == PrimaryModeV1::Source) != room.primary_source_id.is_some()
    {
        return Err("conversation context room revision or primary is invalid".into());
    }
    Ok(())
}

fn validate_identity_scope(owner: &str, relay_scope: &str) -> Result<(), String> {
    Hex64::parse(owner.to_owned()).map_err(|_| "conversation context owner is invalid")?;
    Sha256Ref::parse(relay_scope.to_owned())
        .map_err(|_| "conversation context relay scope is invalid")?;
    Ok(())
}

fn validate_conversation_id(value: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| "conversation context room ID is invalid".into())
}

fn normalize_project_id(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    OpaqueId::parse(value.to_owned())
        .map(|value| Some(value.as_str().to_owned()))
        .map_err(|_| "conversation context project ID is invalid".into())
}

fn parse_primary_mode(value: &str) -> Result<PrimaryModeV1, String> {
    match value {
        "inherit" => Ok(PrimaryModeV1::Inherit),
        "none" => Ok(PrimaryModeV1::None),
        "source" => Ok(PrimaryModeV1::Source),
        _ => Err("conversation context primary mode is invalid".into()),
    }
}

fn validate_persisted_sources(primary: Option<&str>, additional: &[String]) -> Result<(), String> {
    if additional.len() > MAX_CONTEXT_SOURCES
        || primary.is_some_and(|source| OpaqueId::parse(source.to_owned()).is_err())
        || additional
            .iter()
            .any(|source| OpaqueId::parse(source.clone()).is_err())
    {
        return Err("conversation context sources are invalid".into());
    }
    let unique = additional.iter().collect::<BTreeSet<_>>();
    if unique.len() != additional.len()
        || primary.is_some_and(|source| additional.iter().any(|id| id == source))
    {
        return Err("conversation context sources are duplicated".into());
    }
    Ok(())
}

fn source_map(catalog: &ConnectedBrainCatalogV1) -> HashMap<&str, &ConnectedBrainSourceSummaryV1> {
    catalog
        .sources
        .iter()
        .map(|summary| (summary.source.source_id.as_str(), summary))
        .collect()
}

fn validate_source_id(catalog: &ConnectedBrainCatalogV1, source_id: &str) -> Result<(), String> {
    OpaqueId::parse(source_id.to_owned())
        .map_err(|_| "conversation context source ID is invalid".to_owned())?;
    if !source_map(catalog).contains_key(source_id) {
        return Err("conversation context source is no longer connected".into());
    }
    Ok(())
}

fn valid_source_ids(
    catalog: &ConnectedBrainCatalogV1,
    source_ids: &[String],
) -> Result<Vec<String>, String> {
    if source_ids.len() > MAX_CONTEXT_SOURCES {
        return Err("conversation context has too many sources".into());
    }
    let available = source_map(catalog);
    let mut valid = source_ids
        .iter()
        .map(|source| source.trim())
        .filter(|source| !source.is_empty() && available.contains_key(*source))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    valid.sort();
    valid.dedup();
    Ok(valid)
}

fn source_is_repository(catalog: &ConnectedBrainCatalogV1, source_id: &str) -> bool {
    source_map(catalog)
        .get(source_id)
        .is_some_and(|summary| summary.source.source_kind == ConnectedBrainSourceKindV1::Repository)
}

fn kind_label(kind: ConnectedBrainSourceKindV1) -> &'static str {
    match kind {
        ConnectedBrainSourceKindV1::Repository => "repository",
        ConnectedBrainSourceKindV1::CodexHistory => "codex_history",
        ConnectedBrainSourceKindV1::ClaudeHistory => "claude_history",
    }
}

fn source_availability(
    state: &AppState,
    owner: &Hex64,
    summary: &ConnectedBrainSourceSummaryV1,
) -> (&'static str, bool) {
    if summary.source.source_kind != ConnectedBrainSourceKindV1::Repository {
        return (
            if summary.source.status == ConnectedBrainSourceStatusV1::Current {
                "available"
            } else {
                "needs_attention"
            },
            false,
        );
    }
    if summary.source.status != ConnectedBrainSourceStatusV1::Current {
        return ("needs_attention", true);
    }
    match state.read_connected_brain_candidate(owner, &summary.source.source_id) {
        Ok(candidate) if candidate.canonical_root.is_dir() => ("available", true),
        _ => ("missing", true),
    }
}

fn source_view(
    state: &AppState,
    owner: &Hex64,
    catalog: &ConnectedBrainCatalogV1,
    source_id: &str,
    role: &'static str,
    origin: &'static str,
) -> Option<ConversationContextSourceViewV1> {
    let summary = source_map(catalog).get(source_id).copied()?;
    let (availability, native_directory) = source_availability(state, owner, summary);
    Some(ConversationContextSourceViewV1 {
        source_id: source_id.to_owned(),
        label: summary.source.display_name.clone(),
        role,
        origin,
        source_kind: kind_label(summary.source.source_kind),
        availability,
        native_directory,
    })
}

fn build_view(
    state: &AppState,
    owner: &Hex64,
    catalog: &ConnectedBrainCatalogV1,
    conversation_id: &str,
    effective: EffectiveContextV1,
) -> ConversationContextViewV1 {
    let primary = effective.primary_source_id.as_deref().map(|source| {
        source_view(
            state,
            owner,
            catalog,
            source,
            "working_folder",
            effective.primary_origin,
        )
        .unwrap_or_else(|| ConversationContextSourceViewV1 {
            source_id: source.to_owned(),
            label: "Unavailable folder".to_owned(),
            role: "working_folder",
            origin: effective.primary_origin,
            source_kind: "repository",
            availability: "missing",
            native_directory: true,
        })
    });
    let additional_sources = effective
        .additional
        .iter()
        .filter_map(|(source, origin)| {
            source_view(state, owner, catalog, source, "additional_source", origin)
        })
        .collect::<Vec<_>>();
    let status = if primary
        .as_ref()
        .is_some_and(|source| source.availability != "available")
    {
        "missing_primary"
    } else if primary
        .iter()
        .chain(additional_sources.iter())
        .any(|source| source.availability != "available")
    {
        "degraded"
    } else if primary.is_some() || !additional_sources.is_empty() {
        "ready"
    } else {
        "empty"
    };
    let working_folder_capability = match primary.as_ref() {
        Some(source) if source.availability == "available" => ConversationContextCapabilityViewV1 {
            label: "Working folder access",
            state: "available",
            detail: "Used as the native working directory on the next turn",
        },
        Some(_) => ConversationContextCapabilityViewV1 {
            label: "Working folder access",
            state: "needs_attention",
            detail: "Relink this folder before native tools can use it",
        },
        None => ConversationContextCapabilityViewV1 {
            label: "Working folder access",
            state: "runtime_managed",
            detail: "No primary folder is selected for this room",
        },
    };
    ConversationContextViewV1 {
        conversation_id: conversation_id.to_owned(),
        project_id: effective.project_id,
        primary,
        additional_sources,
        status,
        revision: effective.revision,
        capabilities: vec![
            working_folder_capability,
            ConversationContextCapabilityViewV1 {
                label: "Additional folder access",
                state: "runtime_managed",
                detail: "Negotiated with the resident's selected runtime; Brain access remains available",
            },
            ConversationContextCapabilityViewV1 {
                label: "MCPs, skills, and plugins",
                state: "runtime_managed",
                detail: "Uses the runtime's existing configuration",
            },
        ],
    }
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.buzz_path()
        .app_data_dir()
        .map(|root| root.join("luca").join("conversation-context-v1.json"))
        .map_err(|error| format!("resolve conversation context directory: {error}"))
}

fn global_store(app: &AppHandle) -> Result<Arc<Mutex<ConversationContextStore>>, String> {
    if let Some(store) = GLOBAL_STORE.get() {
        return Ok(Arc::clone(store));
    }
    let candidate = Arc::new(Mutex::new(ConversationContextStore::load(store_path(
        app,
    )?)?));
    let _ = GLOBAL_STORE.set(Arc::clone(&candidate));
    GLOBAL_STORE
        .get()
        .map(Arc::clone)
        .ok_or_else(|| "initialize conversation context store".to_owned())
}

pub(crate) fn active_scope(state: &AppState) -> Result<(Hex64, String), String> {
    let owner = Hex64::parse(state.signing_keys()?.public_key().to_hex())
        .map_err(|_| "active owner identity is invalid".to_owned())?;
    let relay_url = relay::relay_ws_url_with_override(state);
    let relay_scope = Sha256Ref::parse(format!(
        "sha256:{}",
        hex::encode(Sha256::digest(relay_url.as_bytes()))
    ))
    .map_err(|_| "active relay scope is invalid".to_owned())?;
    Ok((owner, relay_scope.as_str().to_owned()))
}

fn catalog(state: &AppState, owner: &Hex64) -> Result<ConnectedBrainCatalogV1, String> {
    state
        .read_connected_brain_catalog(owner)
        .map_err(|error| error.code().to_owned())
}

fn ensure_context_mutable(app: &AppHandle, conversation_id: &str) -> Result<(), String> {
    if global_dispatch_store(app)?
        .lock()
        .map_err(|_| "managed dispatch store is locked".to_owned())?
        .conversation_has_active_turn(conversation_id)
    {
        return Err("Context can be changed after the resident finishes responding.".into());
    }
    Ok(())
}

fn current_view(
    app: &AppHandle,
    conversation_id: &str,
) -> Result<ConversationContextViewV1, String> {
    let state = app.state::<AppState>();
    let (owner, relay_scope) = active_scope(&state)?;
    let catalog = catalog(&state, &owner)?;
    let store = global_store(app)?;
    let effective = store
        .lock()
        .map_err(|_| "conversation context store is locked".to_owned())?
        .effective(
            Scope {
                owner: owner.as_str(),
                relay: &relay_scope,
            },
            conversation_id,
        )?;
    Ok(build_view(
        &state,
        &owner,
        &catalog,
        conversation_id,
        effective,
    ))
}

#[tauri::command]
pub(crate) async fn sync_conversation_context(
    app: AppHandle,
    input: SyncConversationContextInputV1,
) -> Result<ConversationContextViewV1, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let (owner, relay_scope) = active_scope(&state)?;
        let catalog = catalog(&state, &owner)?;
        let store = global_store(&app)?;
        let effective = {
            let mut store = store
                .lock()
                .map_err(|_| "conversation context store is locked".to_owned())?;
            let scope = Scope {
                owner: owner.as_str(),
                relay: &relay_scope,
            };
            store.sync(scope, &input, &catalog)?;
            store.effective(scope, &input.conversation_id)?
        };
        Ok(build_view(
            &state,
            &owner,
            &catalog,
            &input.conversation_id,
            effective,
        ))
    })
    .await
    .map_err(|_| "conversation context sync worker failed".to_owned())?
}

#[tauri::command]
pub(crate) async fn get_conversation_context(
    app: AppHandle,
    input: ConversationContextInputV1,
) -> Result<ConversationContextViewV1, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _ = input.project_id;
        current_view(&app, &input.conversation_id)
    })
    .await
    .map_err(|_| "conversation context read worker failed".to_owned())?
}

#[tauri::command]
pub(crate) fn update_conversation_context(
    app: AppHandle,
    input: UpdateConversationContextInputV1,
) -> Result<ConversationContextViewV1, String> {
    ensure_context_mutable(&app, &input.conversation_id)?;
    let state = app.state::<AppState>();
    let (owner, relay_scope) = active_scope(&state)?;
    let catalog = catalog(&state, &owner)?;
    global_store(&app)?
        .lock()
        .map_err(|_| "conversation context store is locked".to_owned())?
        .update_room(
            Scope {
                owner: owner.as_str(),
                relay: &relay_scope,
            },
            &input,
            &catalog,
        )?;
    current_view(&app, &input.conversation_id)
}

#[tauri::command]
pub(crate) fn promote_conversation_context_to_project(
    app: AppHandle,
    input: MutateConversationContextInputV1,
) -> Result<ConversationContextViewV1, String> {
    ensure_context_mutable(&app, &input.conversation_id)?;
    let project_id = normalize_project_id(input.project_id.as_deref())?
        .ok_or_else(|| "Save to project requires a project".to_owned())?;
    let state = app.state::<AppState>();
    let (owner, relay_scope) = active_scope(&state)?;
    global_store(&app)?
        .lock()
        .map_err(|_| "conversation context store is locked".to_owned())?
        .promote_room(
            Scope {
                owner: owner.as_str(),
                relay: &relay_scope,
            },
            &input.conversation_id,
            &project_id,
            input.expected_revision,
        )?;
    current_view(&app, &input.conversation_id)
}

#[tauri::command]
pub(crate) fn remove_conversation_context_override(
    app: AppHandle,
    input: MutateConversationContextInputV1,
) -> Result<ConversationContextViewV1, String> {
    ensure_context_mutable(&app, &input.conversation_id)?;
    let state = app.state::<AppState>();
    let (owner, relay_scope) = active_scope(&state)?;
    global_store(&app)?
        .lock()
        .map_err(|_| "conversation context store is locked".to_owned())?
        .clear_override(
            Scope {
                owner: owner.as_str(),
                relay: &relay_scope,
            },
            &input.conversation_id,
            input.expected_revision,
        )?;
    current_view(&app, &input.conversation_id)
}

#[tauri::command]
pub(crate) fn pick_conversation_context_folder(
    app: AppHandle,
    input: MutateConversationContextInputV1,
) -> Result<Option<ConversationContextViewV1>, String> {
    ensure_context_mutable(&app, &input.conversation_id)?;
    let selected = app
        .dialog()
        .file()
        .set_title("Choose working folder")
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let selected = selected
        .into_path()
        .map_err(|_| "selected folder is unavailable".to_owned())?
        .canonicalize()
        .map_err(|_| "selected folder is unavailable".to_owned())?;
    let state = app.state::<AppState>();
    let (owner, relay_scope) = active_scope(&state)?;
    let catalog = catalog(&state, &owner)?;
    let before = current_view(&app, &input.conversation_id)?;
    let matched_source_id = catalog
        .sources
        .iter()
        .filter(|summary| summary.source.source_kind == ConnectedBrainSourceKindV1::Repository)
        .find_map(|summary| {
            state
                .read_connected_brain_candidate(&owner, &summary.source.source_id)
                .ok()
                .filter(|candidate| same_directory(&candidate.canonical_root, &selected))
                .map(|_| summary.source.source_id.as_str().to_owned())
        });
    let source_id = if let Some(source_id) = matched_source_id {
        source_id
    } else if before.status == "missing_primary" {
        let existing_source_id = before
            .primary
            .as_ref()
            .map(|source| source.source_id.clone())
            .ok_or_else(|| {
                "The missing working folder no longer has a source binding.".to_owned()
            })?;
        let parsed_source_id = OpaqueId::parse(existing_source_id.clone())
            .map_err(|_| "working folder source is invalid".to_owned())?;
        let candidate = super::connected_brain::discover_in_added_root(&selected)?
            .into_iter()
            .find(|candidate| same_directory(&candidate.canonical_root, &selected))
            .ok_or_else(|| "Choose the root of a Git repository.".to_owned())?;
        let build = super::connected_brain::build_index(&parsed_source_id, &candidate)?;
        let watch_root = candidate.canonical_root.clone();
        state
            .rebind_connected_brain_source(
                owner.clone(),
                parsed_source_id.clone(),
                candidate,
                build,
            )
            .map_err(|error| error.code().to_owned())?;
        if super::connected_brain::register_connected_source(
            &state,
            parsed_source_id.clone(),
            &watch_root,
        )
        .is_err()
        {
            state
                .set_connected_brain_status(
                    &owner,
                    &parsed_source_id,
                    ConnectedBrainSourceStatusV1::NeedsAttention,
                )
                .map_err(|error| error.code().to_owned())?;
        }
        existing_source_id
    } else {
        return Err("Connect this folder in Brain first, then choose it here.".into());
    };
    let update = UpdateConversationContextInputV1 {
        conversation_id: input.conversation_id.clone(),
        project_id: input.project_id,
        expected_revision: input.expected_revision,
        primary_mode: "source".into(),
        primary_source_id: Some(source_id),
        additional_source_ids: current_view(&app, &input.conversation_id)?
            .additional_sources
            .into_iter()
            .map(|source| source.source_id)
            .collect(),
    };
    global_store(&app)?
        .lock()
        .map_err(|_| "conversation context store is locked".to_owned())?
        .update_room(
            Scope {
                owner: owner.as_str(),
                relay: &relay_scope,
            },
            &update,
            &catalog,
        )?;
    current_view(&app, &input.conversation_id).map(Some)
}

fn same_directory(left: &Path, right: &Path) -> bool {
    left == right
}

fn unix_time_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

fn snapshot_digest(
    owner_pubkey: &str,
    relay_scope: &str,
    conversation_id: &str,
    revision: u64,
    primary_source_id: Option<&OpaqueId>,
    additional_source_ids: &[OpaqueId],
    selected_source_ids: &[OpaqueId],
) -> Result<String, String> {
    canonical_sha256(&serde_json::json!({
        "domain": SNAPSHOT_PROTOCOL,
        "owner_pubkey": owner_pubkey,
        "relay_scope": relay_scope,
        "conversation_id": conversation_id,
        "revision": revision,
        "primary_source_id": primary_source_id,
        "additional_source_ids": additional_source_ids,
        "selected_source_ids": selected_source_ids,
    }))
    .map_err(|_| "conversation context snapshot could not be frozen".to_owned())
}

/// Freeze the exact opaque source set before the owner event is staged.
pub(crate) fn freeze_for_dispatch(
    app: &AppHandle,
    conversation_id: &str,
) -> Result<Option<DispatchContextBindingV1>, String> {
    let state = app.state::<AppState>();
    let (owner, relay_scope) = active_scope(&state)?;
    let store = global_store(app)?;
    let effective = match store
        .lock()
        .map_err(|_| "conversation context store is locked".to_owned())?
        .effective(
            Scope {
                owner: owner.as_str(),
                relay: &relay_scope,
            },
            conversation_id,
        ) {
        Ok(effective) => effective,
        Err(_) => return Ok(None),
    };
    if effective.primary_source_id.is_none() && effective.additional.is_empty() {
        return Ok(None);
    }
    let catalog = catalog(&state, &owner)?;
    if let Some(primary) = effective.primary_source_id.as_deref() {
        validate_source_id(&catalog, primary)?;
        let summary = source_map(&catalog)
            .get(primary)
            .copied()
            .ok_or_else(|| "working folder is no longer connected".to_owned())?;
        if source_availability(&state, &owner, summary).0 != "available" {
            return Err("conversation_context:missing_primary".into());
        }
    }
    let primary_source_id = effective
        .primary_source_id
        .map(OpaqueId::parse)
        .transpose()
        .map_err(|_| "working folder source is invalid".to_owned())?;
    let mut additional_source_ids = effective
        .additional
        .into_iter()
        .map(|(source, _)| OpaqueId::parse(source))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "additional context source is invalid".to_owned())?;
    additional_source_ids.sort();
    additional_source_ids.dedup();
    let mut selected_source_ids = additional_source_ids.clone();
    if let Some(primary) = primary_source_id.as_ref() {
        selected_source_ids.push(primary.clone());
    }
    selected_source_ids.sort();
    selected_source_ids.dedup();
    let digest = snapshot_digest(
        owner.as_str(),
        &relay_scope,
        conversation_id,
        effective.revision,
        primary_source_id.as_ref(),
        &additional_source_ids,
        &selected_source_ids,
    )?;
    let snapshot_ref = Sha256Ref::parse(format!("sha256:{digest}"))
        .map_err(|_| "conversation context snapshot reference is invalid".to_owned())?;
    let now_unix_secs = unix_time_seconds();
    let snapshot = ConversationContextSnapshotV1 {
        protocol: SNAPSHOT_PROTOCOL.to_owned(),
        snapshot_ref: snapshot_ref.clone(),
        owner_pubkey: owner.as_str().to_owned(),
        relay_scope: relay_scope.clone(),
        conversation_id: conversation_id.to_owned(),
        revision: effective.revision,
        primary_source_id,
        additional_source_ids,
        selected_source_ids,
        created_at: now_unix_secs,
        expires_at: now_unix_secs.saturating_add(CONTEXT_SNAPSHOT_TTL_SECONDS),
    };
    snapshot.validate()?;
    store
        .lock()
        .map_err(|_| "conversation context store is locked".to_owned())?
        .store_snapshot(snapshot, now_unix_secs)?;
    Ok(Some(DispatchContextBindingV1 {
        protocol: SNAPSHOT_BINDING_PROTOCOL.to_owned(),
        snapshot_ref,
        revision: effective.revision,
    }))
}

fn snapshot_for_dispatch(
    app: &AppHandle,
    owner: &Hex64,
    conversation_id: &OpaqueId,
    binding: &DispatchContextBindingV1,
) -> Result<ConversationContextSnapshotV1, String> {
    let state = app.state::<AppState>();
    let (active_owner, relay_scope) = active_scope(&state)?;
    if &active_owner != owner {
        return Err("conversation context owner is no longer active".into());
    }
    global_store(app)?
        .lock()
        .map_err(|_| "conversation context store is locked".to_owned())?
        .snapshot(
            Scope {
                owner: owner.as_str(),
                relay: &relay_scope,
            },
            conversation_id.as_str(),
            binding,
            unix_time_seconds(),
        )
}

/// Resolve the selected Brain source set without exposing native roots.
pub(crate) fn selected_sources_for_dispatch(
    app: &AppHandle,
    owner: &Hex64,
    conversation_id: &OpaqueId,
    binding: &DispatchContextBindingV1,
) -> Result<BTreeSet<OpaqueId>, String> {
    snapshot_for_dispatch(app, owner, conversation_id, binding)
        .map(|snapshot| snapshot.selected_source_ids.into_iter().collect())
}

/// Resolve paths from a path-free dispatch binding. Missing additional roots
/// degrade to Brain-only context; a missing primary is a hard error.
pub(crate) fn resolve_dispatch_context(
    app: &AppHandle,
    state: &AppState,
    owner: &Hex64,
    conversation_id: &OpaqueId,
    binding: &DispatchContextBindingV1,
) -> Result<ResolvedDispatchContextV1, String> {
    let snapshot = snapshot_for_dispatch(app, owner, conversation_id, binding)?;
    let mut degraded = false;
    let cwd = snapshot
        .primary_source_id
        .as_ref()
        .map(|source_id| {
            state
                .read_connected_brain_candidate(owner, source_id)
                .map(|candidate| candidate.canonical_root)
                .map_err(|_| "conversation_context:missing_primary".to_owned())
        })
        .transpose()?;
    if cwd.as_ref().is_some_and(|path| !path.is_dir()) {
        return Err("conversation_context:missing_primary".into());
    }
    let mut additional_directories = Vec::new();
    for source_id in &snapshot.additional_source_ids {
        let Ok(candidate) = state.read_connected_brain_candidate(owner, source_id) else {
            degraded = true;
            continue;
        };
        if candidate.source_kind != ConnectedBrainSourceKindV1::Repository {
            continue;
        }
        if !candidate.canonical_root.is_dir() {
            degraded = true;
            continue;
        }
        if cwd.as_ref() != Some(&candidate.canonical_root)
            && !additional_directories.contains(&candidate.canonical_root)
        {
            additional_directories.push(candidate.canonical_root);
        }
    }
    let mut roots_material = Vec::new();
    roots_material.extend_from_slice(b"luca.native-roots.v1\0");
    if let Some(cwd) = &cwd {
        roots_material.extend_from_slice(cwd.as_os_str().as_encoded_bytes());
    }
    for directory in &additional_directories {
        roots_material.push(0);
        roots_material.extend_from_slice(directory.as_os_str().as_encoded_bytes());
    }
    let native_roots_ref = Sha256Ref::parse(format!(
        "sha256:{}",
        hex::encode(Sha256::digest(&roots_material))
    ))
    .map_err(|_| "native context reference is invalid".to_owned())?;
    Ok(ResolvedDispatchContextV1 {
        snapshot_ref: binding.snapshot_ref.clone(),
        revision: snapshot.revision,
        cwd,
        additional_directories,
        selected_source_ids: snapshot.selected_source_ids.clone(),
        native_roots_ref,
        degraded,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog() -> ConnectedBrainCatalogV1 {
        fn summary(id: &str, kind: ConnectedBrainSourceKindV1) -> ConnectedBrainSourceSummaryV1 {
            let now = luca_protocol::CanonicalTimestamp::parse("2026-08-22T00:00:00Z")
                .expect("timestamp");
            ConnectedBrainSourceSummaryV1 {
                source: luca_protocol::ConnectedBrainSourceV1 {
                    protocol: luca_protocol::CONNECTED_BRAIN_PROTOCOL.into(),
                    source_id: OpaqueId::parse(id.to_owned()).expect("source id"),
                    owner_pubkey: Hex64::parse("11".repeat(32)).expect("owner"),
                    source_kind: kind,
                    display_name: id.to_owned(),
                    status: ConnectedBrainSourceStatusV1::Current,
                    capabilities: vec![luca_protocol::ConnectedBrainCapabilityV1::Recall],
                    index_revision: Sha256Ref::parse(format!(
                        "sha256:{}",
                        if id.ends_with('a') {
                            "aa".repeat(32)
                        } else {
                            "bb".repeat(32)
                        }
                    ))
                    .expect("revision"),
                    created_at: now.clone(),
                    updated_at: now.clone(),
                    last_refreshed_at: Some(now),
                },
                item_count: luca_protocol::SafeU53::new(1).expect("count"),
                entry_count: luca_protocol::SafeU53::new(1).expect("count"),
            }
        }
        ConnectedBrainCatalogV1 {
            sources: vec![
                summary("repository-a", ConnectedBrainSourceKindV1::Repository),
                summary("repository-b", ConnectedBrainSourceKindV1::Repository),
                summary("codex-history", ConnectedBrainSourceKindV1::CodexHistory),
            ],
            ..Default::default()
        }
    }

    fn scope() -> Scope<'static> {
        Scope {
            owner: "1111111111111111111111111111111111111111111111111111111111111111",
            relay: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        }
    }

    fn store() -> (tempfile::TempDir, ConversationContextStore) {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = ConversationContextStore::load(temp.path().join("context.json"))
            .expect("context store");
        (temp, store)
    }

    fn source(value: &str) -> OpaqueId {
        OpaqueId::parse(value).unwrap()
    }

    #[test]
    fn dispatch_snapshot_rejects_duplicate_or_unselected_sources() {
        let selected = source("source-a");
        let extra = source("source-b");
        let mut snapshot = ConversationContextSnapshotV1 {
            protocol: SNAPSHOT_PROTOCOL.into(),
            snapshot_ref: Sha256Ref::parse(format!("sha256:{}", "11".repeat(32))).unwrap(),
            owner_pubkey: scope().owner.to_owned(),
            relay_scope: scope().relay.to_owned(),
            conversation_id: "99999999-9999-4999-8999-999999999999".into(),
            revision: 1,
            primary_source_id: Some(selected.clone()),
            additional_source_ids: vec![extra.clone()],
            selected_source_ids: vec![selected],
            created_at: 1,
            expires_at: 2,
        };
        assert!(snapshot.validate().is_err());
        snapshot.selected_source_ids.push(extra.clone());
        snapshot.selected_source_ids.sort();
        let digest = snapshot_digest(
            &snapshot.owner_pubkey,
            &snapshot.relay_scope,
            &snapshot.conversation_id,
            snapshot.revision,
            snapshot.primary_source_id.as_ref(),
            &snapshot.additional_source_ids,
            &snapshot.selected_source_ids,
        )
        .unwrap();
        snapshot.snapshot_ref = Sha256Ref::parse(format!("sha256:{digest}")).unwrap();
        assert!(snapshot.validate().is_ok());
        snapshot.additional_source_ids.push(extra);
        assert!(snapshot.validate().is_err());
    }

    #[test]
    fn persisted_contract_contains_no_filesystem_path_field() {
        let persisted = PersistedConversationContextStoreV1 {
            schema: STORE_SCHEMA.into(),
            next_revision: 2,
            projects: vec![ProjectContextV1 {
                owner_pubkey: "11".repeat(32),
                relay_scope: format!("sha256:{}", "22".repeat(32)),
                project_id: "project-1".into(),
                primary_source_id: Some("source-a".into()),
                additional_source_ids: vec!["source-b".into()],
                revision: 1,
            }],
            rooms: Vec::new(),
            snapshots: Vec::new(),
        };
        let wire = serde_json::to_string(&persisted).unwrap();
        assert!(!wire.contains("path"));
        assert!(!wire.contains("cwd"));
        assert!(!wire.contains("directory"));
    }

    #[test]
    fn persisted_store_accepts_unsorted_unique_sources_and_rejects_duplicates() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("context.json");
        let mut persisted = PersistedConversationContextStoreV1 {
            schema: STORE_SCHEMA.into(),
            next_revision: 2,
            projects: vec![ProjectContextV1 {
                owner_pubkey: scope().owner.into(),
                relay_scope: scope().relay.into(),
                project_id: "project-1".into(),
                primary_source_id: Some("source-a".into()),
                additional_source_ids: vec!["source-c".into(), "source-b".into()],
                revision: 1,
            }],
            rooms: Vec::new(),
            snapshots: Vec::new(),
        };
        std::fs::write(&path, serde_json::to_vec(&persisted).unwrap()).unwrap();

        ConversationContextStore::load(path.clone())
            .expect("source order must not make an otherwise valid store unreadable");

        persisted.projects[0]
            .additional_source_ids
            .push("source-b".into());
        std::fs::write(&path, serde_json::to_vec(&persisted).unwrap()).unwrap();
        let error = ConversationContextStore::load(path)
            .err()
            .expect("duplicate source must be rejected");
        assert_eq!(error, "conversation context sources are duplicated");
    }

    #[test]
    fn project_migration_filters_stale_sources_and_room_override_is_isolated() {
        let (_temp, mut store) = store();
        let first_room = "11111111-1111-4111-8111-111111111111";
        let sibling_room = "22222222-2222-4222-8222-222222222222";
        for conversation_id in [first_room, sibling_room] {
            store
                .sync(
                    scope(),
                    &SyncConversationContextInputV1 {
                        conversation_id: conversation_id.into(),
                        project_id: Some("polyphonic".into()),
                        project_source_ids: vec![
                            "stale-source".into(),
                            "codex-history".into(),
                            "repository-a".into(),
                        ],
                    },
                    &catalog(),
                )
                .expect("sync project room");
        }

        let inherited = store.effective(scope(), first_room).expect("effective");
        assert_eq!(inherited.primary_source_id.as_deref(), Some("repository-a"));
        assert_eq!(
            inherited.additional,
            vec![("codex-history".into(), "project")]
        );

        let revision = inherited.revision;
        store
            .update_room(
                scope(),
                &UpdateConversationContextInputV1 {
                    conversation_id: first_room.into(),
                    project_id: Some("polyphonic".into()),
                    expected_revision: revision,
                    primary_mode: "source".into(),
                    primary_source_id: Some("repository-b".into()),
                    additional_source_ids: vec![],
                },
                &catalog(),
            )
            .expect("room override");

        assert_eq!(
            store
                .effective(scope(), first_room)
                .expect("overridden")
                .primary_source_id
                .as_deref(),
            Some("repository-b")
        );
        assert_eq!(
            store
                .effective(scope(), sibling_room)
                .expect("sibling")
                .primary_source_id
                .as_deref(),
            Some("repository-a")
        );

        let promotion_revision = store.effective(scope(), first_room).unwrap().revision;
        store
            .promote_room(scope(), first_room, "polyphonic", promotion_revision)
            .expect("promote room context to project");
        let sibling_revision = store.effective(scope(), sibling_room).unwrap().revision;
        store
            .update_room(
                scope(),
                &UpdateConversationContextInputV1 {
                    conversation_id: sibling_room.into(),
                    project_id: Some("polyphonic".into()),
                    expected_revision: sibling_revision,
                    primary_mode: "source".into(),
                    primary_source_id: Some("repository-a".into()),
                    additional_source_ids: vec![],
                },
                &catalog(),
            )
            .expect("sibling accepts the latest inherited project revision");
    }

    #[test]
    fn optimistic_revision_and_project_promotion_are_explicit() {
        let (_temp, mut store) = store();
        let room = "33333333-3333-4333-8333-333333333333";
        store
            .sync(
                scope(),
                &SyncConversationContextInputV1 {
                    conversation_id: room.into(),
                    project_id: None,
                    project_source_ids: vec![],
                },
                &catalog(),
            )
            .expect("sync room");
        let initial = store.effective(scope(), room).expect("initial");
        let input = UpdateConversationContextInputV1 {
            conversation_id: room.into(),
            project_id: None,
            expected_revision: initial.revision,
            primary_mode: "source".into(),
            primary_source_id: Some("repository-a".into()),
            additional_source_ids: vec!["codex-history".into()],
        };
        store
            .update_room(scope(), &input, &catalog())
            .expect("first update");
        assert!(store.update_room(scope(), &input, &catalog()).is_err());

        let promotion_revision = store.effective(scope(), room).unwrap().revision;
        store
            .promote_room(scope(), room, "saved-project", promotion_revision)
            .expect("promote room");
        let promoted = store.effective(scope(), room).expect("promoted");
        assert_eq!(promoted.project_id.as_deref(), Some("saved-project"));
        assert_eq!(promoted.primary_origin, "project");
        assert_eq!(promoted.primary_source_id.as_deref(), Some("repository-a"));
        assert_eq!(
            promoted.additional,
            vec![("codex-history".into(), "project")]
        );
    }

    #[test]
    fn dispatch_snapshot_remains_immutable_after_room_context_changes() {
        let (_temp, mut store) = store();
        let room = "44444444-4444-4444-8444-444444444444";
        store
            .sync(
                scope(),
                &SyncConversationContextInputV1 {
                    conversation_id: room.into(),
                    project_id: None,
                    project_source_ids: vec![],
                },
                &catalog(),
            )
            .unwrap();
        let initial_revision = store.effective(scope(), room).unwrap().revision;
        store
            .update_room(
                scope(),
                &UpdateConversationContextInputV1 {
                    conversation_id: room.into(),
                    project_id: None,
                    expected_revision: initial_revision,
                    primary_mode: "source".into(),
                    primary_source_id: Some("repository-a".into()),
                    additional_source_ids: vec!["codex-history".into()],
                },
                &catalog(),
            )
            .unwrap();
        let frozen_revision = store.effective(scope(), room).unwrap().revision;
        let primary = source("repository-a");
        let additional = vec![source("codex-history")];
        let mut selected = vec![primary.clone(), additional[0].clone()];
        selected.sort();
        let digest = snapshot_digest(
            scope().owner,
            scope().relay,
            room,
            frozen_revision,
            Some(&primary),
            &additional,
            &selected,
        )
        .unwrap();
        let snapshot_ref = Sha256Ref::parse(format!("sha256:{digest}")).unwrap();
        store
            .store_snapshot(
                ConversationContextSnapshotV1 {
                    protocol: SNAPSHOT_PROTOCOL.into(),
                    snapshot_ref: snapshot_ref.clone(),
                    owner_pubkey: scope().owner.into(),
                    relay_scope: scope().relay.into(),
                    conversation_id: room.into(),
                    revision: frozen_revision,
                    primary_source_id: Some(primary),
                    additional_source_ids: additional,
                    selected_source_ids: selected,
                    created_at: 10,
                    expires_at: 100,
                },
                10,
            )
            .unwrap();

        store
            .update_room(
                scope(),
                &UpdateConversationContextInputV1 {
                    conversation_id: room.into(),
                    project_id: None,
                    expected_revision: frozen_revision,
                    primary_mode: "source".into(),
                    primary_source_id: Some("repository-b".into()),
                    additional_source_ids: vec![],
                },
                &catalog(),
            )
            .unwrap();
        let frozen = store
            .snapshot(
                scope(),
                room,
                &DispatchContextBindingV1 {
                    protocol: SNAPSHOT_BINDING_PROTOCOL.into(),
                    snapshot_ref,
                    revision: frozen_revision,
                },
                11,
            )
            .unwrap();
        assert_eq!(
            frozen.primary_source_id.as_ref().map(OpaqueId::as_str),
            Some("repository-a")
        );
        assert_eq!(
            store
                .effective(scope(), room)
                .unwrap()
                .primary_source_id
                .as_deref(),
            Some("repository-b")
        );
    }
}
