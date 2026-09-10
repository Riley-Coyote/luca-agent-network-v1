//! Remembered Quick Chat thinking ladders.
//!
//! The panel only ever offers levels that *this conversation's* runtime
//! advertised for itself. Those arrive inside a turn, so before the first turn
//! after an app start the in-memory cache is empty and the panel has nothing to
//! offer. This store keeps the last runtime-reported ladder per
//! `(owner, relay, resident, conversation)` on disk so the invariant survives a
//! restart. It holds option names only — never prompt text, never a session id.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const SCHEMA: &str = "luca.quickchat-effort-store.v1";
const MAX_ENTRIES: usize = 256;

/// `(owner_pubkey, relay, resident_pubkey, conversation_id)`.
pub(crate) type StoreKey = (String, String, String, String);

#[derive(Serialize, Deserialize)]
struct StoreFile {
    schema: String,
    entries: Vec<StoredEntry>,
}

#[derive(Clone, Serialize, Deserialize)]
struct StoredEntry {
    owner: String,
    relay: String,
    resident: String,
    conversation: String,
    saved_at: u64,
    options: serde_json::Value,
}

#[derive(Clone)]
pub(crate) struct Remembered {
    pub(crate) saved_at: u64,
    pub(crate) options: serde_json::Value,
}

pub(crate) fn path_in(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("luca").join("quickchat-effort.json")
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

/// A remembered ladder is only usable if it still describes an advertised set
/// of runtime options. Anything else is dropped rather than shown as a choice.
fn usable(options: &serde_json::Value) -> bool {
    options["supported"] == serde_json::Value::Bool(true)
        && options["configId"]
            .as_str()
            .is_some_and(|id| id.len() <= 128)
        && options["values"]
            .as_array()
            .is_some_and(|values| (2..=32).contains(&values.len()))
        && options["values"].as_array().is_some_and(|values| {
            values.iter().all(|value| {
                value["value"].as_str().is_some_and(|v| v.len() <= 128)
                    && value["label"].as_str().is_some_and(|l| l.len() <= 128)
            })
        })
}

/// Strip everything that does not survive the process that reported it: the
/// session id is dead after a restart, and `pending` describes a live turn.
pub(crate) fn sanitize(options: &serde_json::Value) -> Option<serde_json::Value> {
    if !usable(options) {
        return None;
    }
    let mut value = options.clone();
    let object = value.as_object_mut()?;
    object.remove("sessionId");
    object.insert("pending".into(), serde_json::Value::Bool(false));
    object.insert("source".into(), "remembered".into());
    object.insert("reason".into(), "Selected for next message".into());
    Some(value)
}

pub(crate) fn decode(bytes: &[u8]) -> HashMap<StoreKey, Remembered> {
    let Ok(file) = serde_json::from_slice::<StoreFile>(bytes) else {
        return HashMap::new();
    };
    if file.schema != SCHEMA {
        return HashMap::new();
    }
    file.entries
        .into_iter()
        .filter(|entry| usable(&entry.options))
        .map(|entry| {
            (
                (entry.owner, entry.relay, entry.resident, entry.conversation),
                Remembered {
                    saved_at: entry.saved_at,
                    options: entry.options,
                },
            )
        })
        .collect()
}

pub(crate) fn encode(entries: &HashMap<StoreKey, Remembered>) -> Vec<u8> {
    let mut rows: Vec<StoredEntry> = entries
        .iter()
        .map(
            |((owner, relay, resident, conversation), value)| StoredEntry {
                owner: owner.clone(),
                relay: relay.clone(),
                resident: resident.clone(),
                conversation: conversation.clone(),
                saved_at: value.saved_at,
                options: value.options.clone(),
            },
        )
        .collect();
    // Newest first, then truncate: a full store forgets the oldest conversation.
    rows.sort_by(|a, b| {
        b.saved_at
            .cmp(&a.saved_at)
            .then_with(|| a.conversation.cmp(&b.conversation))
    });
    rows.truncate(MAX_ENTRIES);
    serde_json::to_vec(&StoreFile {
        schema: SCHEMA.into(),
        entries: rows,
    })
    .unwrap_or_default()
}

pub(crate) fn load(path: &Path) -> HashMap<StoreKey, Remembered> {
    std::fs::read(path)
        .map(|bytes| decode(&bytes))
        .unwrap_or_default()
}

pub(crate) fn save(path: &Path, entries: &HashMap<StoreKey, Remembered>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create Quick Chat effort store directory: {error}"))?;
    }
    super::managed_dispatch_store::atomic_write_restricted(path, &encode(entries))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ladder() -> serde_json::Value {
        serde_json::json!({
            "supported": true,
            "configId": "thought_level",
            "sessionId": "session-1",
            "values": [
                {"value":"low","label":"Low"},
                {"value":"high","label":"High"}
            ],
            "value": "high",
            "pending": true
        })
    }

    fn key() -> StoreKey {
        (
            "owner".into(),
            "wss://relay".into(),
            "resident".into(),
            "conversation".into(),
        )
    }

    #[test]
    fn sanitize_drops_the_dead_session_and_marks_the_source() {
        let value = sanitize(&ladder()).expect("usable ladder");
        assert!(value.get("sessionId").is_none());
        assert_eq!(value["pending"], serde_json::Value::Bool(false));
        assert_eq!(value["source"], "remembered");
        assert_eq!(value["reason"], "Selected for next message");
        assert_eq!(value["values"].as_array().expect("values").len(), 2);
    }

    #[test]
    fn sanitize_refuses_anything_that_is_not_a_runtime_ladder() {
        assert!(sanitize(&serde_json::json!({"supported":false,"values":[]})).is_none());
        assert!(sanitize(
            &serde_json::json!({"supported":true,"configId":"thought_level","values":[{"value":"low","label":"Low"}]})
        )
        .is_none());
        assert!(sanitize(
            &serde_json::json!({"supported":true,"values":[{"value":"low","label":"Low"},{"value":"high","label":"High"}]})
        )
        .is_none());
    }

    #[test]
    fn a_remembered_ladder_survives_an_encode_decode_round_trip() {
        let mut entries = HashMap::new();
        entries.insert(
            key(),
            Remembered {
                saved_at: 42,
                options: sanitize(&ladder()).expect("usable"),
            },
        );
        let decoded = decode(&encode(&entries));
        let value = decoded.get(&key()).expect("remembered entry");
        assert_eq!(value.saved_at, 42);
        assert_eq!(value.options["configId"], "thought_level");
        assert_eq!(value.options["source"], "remembered");
    }

    #[test]
    fn a_foreign_or_corrupt_file_is_ignored_rather_than_trusted() {
        assert!(decode(b"not json").is_empty());
        assert!(decode(
            &serde_json::to_vec(&serde_json::json!({"schema":"other","entries":[]})).expect("json")
        )
        .is_empty());
    }

    #[test]
    fn the_store_forgets_the_oldest_conversation_when_it_is_full() {
        let mut entries = HashMap::new();
        for index in 0..(MAX_ENTRIES + 10) {
            entries.insert(
                (
                    "owner".into(),
                    "wss://relay".into(),
                    "resident".into(),
                    format!("conversation-{index}"),
                ),
                Remembered {
                    saved_at: index as u64,
                    options: sanitize(&ladder()).expect("usable"),
                },
            );
        }
        let decoded = decode(&encode(&entries));
        assert_eq!(decoded.len(), MAX_ENTRIES);
        assert!(decoded.contains_key(&(
            "owner".into(),
            "wss://relay".into(),
            "resident".into(),
            format!("conversation-{}", MAX_ENTRIES + 9)
        )));
        assert!(!decoded.contains_key(&(
            "owner".into(),
            "wss://relay".into(),
            "resident".into(),
            "conversation-0".into()
        )));
    }

    #[test]
    fn saving_and_loading_uses_an_owner_only_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = path_in(dir.path());
        let mut entries = HashMap::new();
        entries.insert(
            key(),
            Remembered {
                saved_at: now_ms(),
                options: sanitize(&ladder()).expect("usable"),
            },
        );
        save(&path, &entries).expect("save");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path)
                .expect("metadata")
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let loaded = load(&path);
        assert_eq!(loaded.len(), 1);
        assert!(loaded.contains_key(&key()));
        assert!(load(&dir.path().join("missing.json")).is_empty());
    }
}
