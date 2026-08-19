//! Luca wakes with the app — once, for installs that predate the default.
//!
//! Luca is the resident concierge: the one you talk to first when the app
//! opens. Every other resident wakes when addressed (~10 s, honest "waking"),
//! and that is the right default for a house of many. Luca is the exception:
//! the first message of a session should not wait on a cold start, so a new
//! Luca is created with `start_on_app_launch: true`, and this migration flips
//! Luca records that were created before that default existed.
//!
//! It runs **once**, guarded by a marker next to the store — not convergently
//! like `right_size_agent_parallelism` — because the owner may turn Luca's
//! switch off on purpose, and a boot must never turn it back on. The marker,
//! not the record, remembers that the default was offered.

use std::path::Path;

use tauri::Manager as _;

use crate::managed_agents::LUCA_PERSONA_ID;

use super::{canonical_dev_data_dir, patch_json_records};

/// Marker file, next to `agents/managed-agents.json`, that says the default
/// has been applied to this store. Its presence is the whole memory.
pub const LUCA_WARM_APPLIED_MARKER: &str = "agents/.luca-wakes-with-app.applied";

/// Flip existing canonical-Luca records to wake with the app, once per store.
pub fn warm_luca_on_launch(app: &tauri::AppHandle) {
    let Ok(current_dir) = app.path().app_data_dir() else {
        return;
    };
    let mut dirs = vec![current_dir.clone()];
    if let Some(canonical) = canonical_dev_data_dir(&current_dir) {
        if canonical.exists() && canonical != current_dir {
            dirs.push(canonical);
        }
    }
    for dir in dirs {
        warm_luca_in_dir(&dir);
    }
}

fn warm_luca_in_dir(dir: &Path) {
    let store = dir.join("agents/managed-agents.json");
    let marker = dir.join(LUCA_WARM_APPLIED_MARKER);
    if !store.exists() || marker.exists() {
        return;
    }
    patch_json_records(&store, |obj| {
        let is_luca = obj
            .get("persona_id")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|id| id == LUCA_PERSONA_ID);
        let keyed = obj
            .get("pubkey")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|pubkey| !pubkey.is_empty());
        let already = obj
            .get("start_on_app_launch")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        if !is_luca || !keyed || already {
            return false;
        }
        let name = obj
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("Luca");
        eprintln!("buzz-desktop: luca-wakes-with-app: {name:?} now starts when the app opens");
        obj.insert(
            "start_on_app_launch".to_string(),
            serde_json::Value::Bool(true),
        );
        true
    });
    // Written after the patch (and even when nothing needed patching) so a
    // store with no Luca yet is still marked: a Luca created later is created
    // warm by the create path, and a Luca the owner later turns off stays off.
    if let Err(error) = std::fs::write(&marker, "v1\n") {
        eprintln!("buzz-desktop: luca-wakes-with-app: could not write marker: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::{warm_luca_in_dir, LUCA_WARM_APPLIED_MARKER};
    use crate::managed_agents::LUCA_PERSONA_ID;
    use crate::migration::test_support::{read_agents_json, write_agents_json};

    fn luca(start: bool) -> serde_json::Value {
        serde_json::json!({ "name": "Luca", "pubkey": "97".repeat(32), "persona_id": LUCA_PERSONA_ID, "start_on_app_launch": start })
    }

    #[test]
    fn a_cold_luca_is_flipped_once_and_the_marker_is_written() {
        let dir = tempfile::tempdir().unwrap();
        write_agents_json(
            dir.path(),
            &serde_json::json!([luca(false), { "name": "Vektor", "pubkey": "11".repeat(32), "persona_id": "p-vektor", "start_on_app_launch": false }]),
        );
        warm_luca_in_dir(dir.path());
        let records = read_agents_json(dir.path());
        assert_eq!(records[0]["start_on_app_launch"], true);
        assert_eq!(
            records[1]["start_on_app_launch"], false,
            "only Luca is warmed"
        );
        assert!(dir.path().join(LUCA_WARM_APPLIED_MARKER).exists());
    }

    #[test]
    fn the_owner_turning_luca_off_survives_the_next_boot() {
        let dir = tempfile::tempdir().unwrap();
        write_agents_json(dir.path(), &serde_json::json!([luca(false)]));
        warm_luca_in_dir(dir.path());
        // The owner switches Luca off later.
        write_agents_json(dir.path(), &serde_json::json!([luca(false)]));
        warm_luca_in_dir(dir.path());
        let records = read_agents_json(dir.path());
        assert_eq!(
            records[0]["start_on_app_launch"], false,
            "the marker keeps the choice"
        );
    }

    #[test]
    fn a_definition_without_a_pubkey_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        write_agents_json(
            dir.path(),
            &serde_json::json!([{ "name": "Luca", "pubkey": "", "slug": "luca", "persona_id": LUCA_PERSONA_ID, "start_on_app_launch": false }]),
        );
        warm_luca_in_dir(dir.path());
        assert_eq!(
            read_agents_json(dir.path())[0]["start_on_app_launch"],
            false
        );
    }

    #[test]
    fn a_store_with_no_luca_is_still_marked() {
        let dir = tempfile::tempdir().unwrap();
        write_agents_json(dir.path(), &serde_json::json!([]));
        warm_luca_in_dir(dir.path());
        assert!(dir.path().join(LUCA_WARM_APPLIED_MARKER).exists());
    }
}
