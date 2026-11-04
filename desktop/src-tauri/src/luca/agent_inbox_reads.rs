//! Owner-only task read positions. These never advance resident consumption or
//! source-room read markers. One native mutex coordinates every window.

use std::{collections::BTreeMap, path::PathBuf, sync::Mutex};

use crate::data_dir::BuzzPathExt;
use luca_protocol::Hex64;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::agent_inbox::{active_scope, read_task_for_actor, InboxScope};

static READ_COORDINATOR: Mutex<()> = Mutex::new(());
const SCHEMA: &str = "luca.agent-inbox.owner-reads.v1";
const MAX_BYTES: usize = 16 * 1024 * 1024;

/// A signed canonical event position; timestamps are never supplied by the UI.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReadPosition {
    pub created_at: u64,
    pub event_id: Hex64,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadStore {
    schema: String,
    scope: InboxScope,
    tasks: BTreeMap<String, ReadPosition>,
}

fn path(app: &AppHandle, scope: &InboxScope) -> Result<PathBuf, String> {
    let root = app
        .buzz_path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(root
        .join("luca")
        .join("inbox-owner-reads-v1")
        .join(&scope.community_id)
        .join(format!("{}.json", scope.owner_pubkey.as_str())))
}

fn load(path: &PathBuf, scope: &InboxScope) -> Result<ReadStore, String> {
    if !path.exists() {
        return Ok(ReadStore {
            schema: SCHEMA.into(),
            scope: scope.clone(),
            tasks: BTreeMap::new(),
        });
    }
    if std::fs::metadata(path)
        .map_err(|_| "inbox read state is unavailable")?
        .len()
        > MAX_BYTES as u64
    {
        return Err("inbox read state exceeds its size limit".into());
    }
    let bytes = std::fs::read(path).map_err(|_| "inbox read state is unavailable")?;
    let store: ReadStore =
        serde_json::from_slice(&bytes).map_err(|_| "inbox read state is invalid")?;
    if store.schema != SCHEMA
        || &store.scope != scope
        || store.tasks.keys().any(|id| Hex64::parse(id).is_err())
    {
        return Err("inbox read state scope or schema is invalid".into());
    }
    Ok(store)
}

fn advance(
    tasks: &mut BTreeMap<String, ReadPosition>,
    task: &Hex64,
    candidate: ReadPosition,
) -> ReadPosition {
    let position = tasks
        .entry(task.as_str().to_owned())
        .or_insert_with(|| candidate.clone());
    if candidate > *position {
        *position = candidate;
    }
    position.clone()
}

/// Record a viewed signed task event, serialized across native windows. Reading
/// old history cannot move the marker backwards or mark another source read.
#[tauri::command]
pub(crate) async fn mark_agent_inbox_task_read(
    app: AppHandle,
    exchange_id: String,
    event_id: String,
) -> Result<ReadPosition, String> {
    let scope = active_scope(&app).await?;
    let task = Hex64::parse(exchange_id).map_err(|error| error.to_string())?;
    let event = Hex64::parse(event_id).map_err(|error| error.to_string())?;
    let transcript = read_task_for_actor(&app, scope.owner_pubkey.clone(), task.clone()).await?;
    let signed = transcript
        .get("events")
        .and_then(serde_json::Value::as_array)
        .and_then(|events| {
            events.iter().find(|value| {
                value.get("id").and_then(serde_json::Value::as_str) == Some(event.as_str())
            })
        })
        .ok_or("read position does not refer to an authorized task event")?;
    let created_at = signed
        .get("created_at")
        .and_then(serde_json::Value::as_u64)
        .ok_or("read position event timestamp is invalid")?;
    if active_scope(&app).await? != scope {
        return Err("inbox workspace changed during read".into());
    }
    // No network, harness start, or await while the coordinator lock is held.
    let _guard = READ_COORDINATOR
        .lock()
        .map_err(|_| "inbox read coordinator is unavailable")?;
    let path = path(&app, &scope)?;
    let mut store = load(&path, &scope)?;
    let position = advance(
        &mut store.tasks,
        &task,
        ReadPosition {
            created_at,
            event_id: event,
        },
    );
    let bytes = serde_json::to_vec(&store).map_err(|_| "inbox read state could not be encoded")?;
    if bytes.len() > MAX_BYTES {
        return Err("inbox read state exceeds its size limit".into());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| "inbox read state directory is unavailable")?;
    }
    super::managed_dispatch_store::atomic_write_restricted(&path, &bytes)?;
    Ok(position)
}

/// Read owner view positions only. A missing marker means uninitialized, not
/// that all migrated historical events are unread.
#[tauri::command]
pub(crate) async fn get_agent_inbox_read_positions(
    app: AppHandle,
    exchange_ids: Vec<String>,
) -> Result<BTreeMap<String, ReadPosition>, String> {
    if exchange_ids.len() > 100 {
        return Err("read at most 100 task positions per page".into());
    }
    for id in &exchange_ids {
        Hex64::parse(id).map_err(|error| error.to_string())?;
    }
    let scope = active_scope(&app).await?;
    let _guard = READ_COORDINATOR
        .lock()
        .map_err(|_| "inbox read coordinator is unavailable")?;
    let store = load(&path(&app, &scope)?, &scope)?;
    Ok(exchange_ids
        .into_iter()
        .filter_map(|id| store.tasks.get(&id).cloned().map(|position| (id, position)))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(byte: char) -> Hex64 {
        Hex64::parse(byte.to_string().repeat(64)).unwrap()
    }

    #[test]
    fn concurrent_window_replay_is_monotonic_and_task_scoped() {
        let mut tasks = BTreeMap::new();
        let newer = ReadPosition {
            created_at: 200,
            event_id: key('b'),
        };
        advance(&mut tasks, &key('a'), newer.clone());
        assert_eq!(
            advance(
                &mut tasks,
                &key('a'),
                ReadPosition {
                    created_at: 100,
                    event_id: key('c')
                }
            ),
            newer
        );
        let tie = ReadPosition {
            created_at: 200,
            event_id: key('c'),
        };
        assert_eq!(advance(&mut tasks, &key('a'), tie.clone()), tie);
        advance(
            &mut tasks,
            &key('d'),
            ReadPosition {
                created_at: 50,
                event_id: key('e'),
            },
        );
        assert_eq!(tasks[&key('a').as_str().to_owned()], tie);
        assert_eq!(tasks.len(), 2);
    }
}
