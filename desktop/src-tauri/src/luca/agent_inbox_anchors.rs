//! Durable body-free anchor authority, independent of bounded dispatch caches.
//! Never infer this authority from arbitrary resident text or guessed roots.
use super::agent_inbox::InboxScope;
use crate::data_dir::BuzzPathExt;
use luca_protocol::{Hex64, OpaqueId};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf, sync::Mutex};
use tauri::AppHandle;

const SCHEMA: &str = "luca.task-anchor-index.v1";
const MAX_BYTES: u64 = 32 * 1024 * 1024;
static COORDINATOR: Mutex<()> = Mutex::new(());

/// All coordinates derive from the trusted action ledger and accepted outbox.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TaskAnchor {
    pub scope: InboxScope,
    pub anchor_event_id: Hex64,
    pub owner_trigger_event_id: Hex64,
    pub source: OpaqueId,
    pub initiator: Hex64,
    pub recipient: Hex64,
    pub action_key: Hex64,
    pub input_fingerprint: Hex64,
    pub parent_dispatch_id: Hex64,
    pub anchor_dispatch_id: Hex64,
    pub exchange_id: Option<Hex64>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AnchorIndex {
    schema: String,
    scope: InboxScope,
    anchors: BTreeMap<String, TaskAnchor>,
}

fn path(app: &AppHandle, scope: &InboxScope) -> Result<PathBuf, String> {
    Ok(app
        .buzz_path()
        .app_data_dir()
        .map_err(|_| "task anchor storage unavailable")?
        .join("luca")
        .join("task-anchors-v1")
        .join(&scope.community_id)
        .join(format!("{}.json", scope.owner_pubkey.as_str())))
}

fn load(path: &PathBuf, scope: &InboxScope) -> Result<AnchorIndex, String> {
    if !path.exists() {
        return Ok(AnchorIndex {
            schema: SCHEMA.into(),
            scope: scope.clone(),
            anchors: BTreeMap::new(),
        });
    }
    if std::fs::metadata(path)
        .map_err(|_| "task anchor storage unavailable")?
        .len()
        > MAX_BYTES
    {
        return Err("task anchor index exceeds its safety limit".into());
    }
    let index: AnchorIndex = serde_json::from_slice(
        &std::fs::read(path).map_err(|_| "task anchor storage unavailable")?,
    )
    .map_err(|_| "task anchor index is malformed")?;
    if index.schema != SCHEMA
        || &index.scope != scope
        || index
            .anchors
            .iter()
            .any(|(key, anchor)| key != anchor.anchor_event_id.as_str() || &anchor.scope != scope)
    {
        return Err("task anchor index owner or community is invalid".into());
    }
    Ok(index)
}

/// Commit provenance after exact anchor acceptance, before publishing its task.
pub(crate) fn record(app: &AppHandle, anchor: TaskAnchor) -> Result<(), String> {
    let _guard = COORDINATOR
        .lock()
        .map_err(|_| "task anchor coordinator unavailable")?;
    let path = path(app, &anchor.scope)?;
    let mut index = load(&path, &anchor.scope)?;
    let key = anchor.anchor_event_id.as_str().to_owned();
    if let Some(existing) = index.anchors.get(&key) {
        return if existing == &anchor {
            Ok(())
        } else {
            Err("task anchor provenance cannot be rewritten".into())
        };
    }
    index.anchors.insert(key, anchor);
    let bytes = serde_json::to_vec(&index).map_err(|_| "task anchor index cannot be encoded")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("task anchor index exceeds its safety limit".into());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| "task anchor directory unavailable")?;
    }
    super::managed_dispatch_store::atomic_write_restricted(&path, &bytes)
}

/// Callers must also verify the canonical signed anchor and owner request.
pub(crate) fn resolve(
    app: &AppHandle,
    scope: &InboxScope,
    anchor: &Hex64,
    initiator: &Hex64,
    source: &OpaqueId,
) -> Result<Option<TaskAnchor>, String> {
    let _guard = COORDINATOR
        .lock()
        .map_err(|_| "task anchor coordinator unavailable")?;
    Ok(load(&path(app, scope)?, scope)?
        .anchors
        .get(anchor.as_str())
        .filter(|row| &row.initiator == initiator && &row.source == source)
        .cloned())
}

/// Native retry metadata only, not a source-room preview.
pub(crate) fn action_records(
    app: &AppHandle,
    scope: &InboxScope,
    key: &Hex64,
    fingerprint: &Hex64,
    actor: &Hex64,
    source: &OpaqueId,
) -> Result<Vec<TaskAnchor>, String> {
    let _guard = COORDINATOR
        .lock()
        .map_err(|_| "task anchor coordinator unavailable")?;
    let index = load(&path(app, scope)?, scope)?;
    let mut rows = Vec::new();
    for row in index.anchors.values().filter(|row| &row.action_key == key) {
        if &row.input_fingerprint != fingerprint || &row.initiator != actor || &row.source != source
        {
            return Err("inbox retry key belongs to a different original action".into());
        }
        rows.push(row.clone());
    }
    Ok(rows)
}

/// The semantic allowance survives ordinary dispatch-row pruning.
pub(crate) fn parent_action_count(
    app: &AppHandle,
    scope: &InboxScope,
    parent: &Hex64,
    actor: &Hex64,
) -> Result<usize, String> {
    let _guard = COORDINATOR
        .lock()
        .map_err(|_| "task anchor coordinator unavailable")?;
    let index = load(&path(app, scope)?, scope)?;
    Ok(index
        .anchors
        .values()
        .filter(|row| &row.parent_dispatch_id == parent && &row.initiator == actor)
        .map(|row| row.action_key.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .len())
}
