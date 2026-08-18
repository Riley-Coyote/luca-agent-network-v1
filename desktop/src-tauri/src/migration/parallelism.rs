//! Boot-time right-sizing of the agent-process pool on existing records.
//!
//! `DEFAULT_AGENT_PARALLELISM` dropped from upstream Buzz's 24 (busy team
//! channel) to 1 (personal resident). Changing the constant alone only helps
//! agents created from now on: every record already in
//! `agents/managed-agents.json` carries a literal `"parallelism": 24` that was
//! stamped in at create time, so those residents would keep spawning 24 ACP
//! subprocesses forever.
//!
//! ## Why here and not in the load path
//!
//! `storage::load_managed_agents` deliberately never writes — it is a pure
//! read used from many places (summaries, spawn, event projection), and making
//! it rewrite the store as a side effect would turn every read into a disk
//! write and race the save path. Normalizing only in memory would also leave
//! the on-disk 24 to resurface in any writer that round-trips a record it did
//! not load through that function. So this follows the established pattern for
//! "fix what is already on disk": a one-pass, idempotent JSON patch in
//! `run_boot_migrations`, running before `restore_managed_agents_on_launch`
//! reads the store — exactly like `materialize_agent_runtimes` and
//! `reconcile_databricks_v1_to_v2` next to it. Spawn then reads a record that
//! is already correct, so the persisted value, the spawn-config hash, and the
//! `BUZZ_ACP_AGENTS` the harness receives cannot disagree.
//!
//! ## The rule
//!
//! Rewrite `parallelism` to `DEFAULT_AGENT_PARALLELISM` when, and only when:
//!   * it is exactly `LEGACY_TEAM_CHANNEL_PARALLELISM` (24) — the old
//!     unchosen default; any other value was a deliberate pick, and
//!   * `definition_parallelism` is absent or null — i.e. no linked agent
//!     definition advertises a pool size. A definition that does advertise one
//!     (even 24) chose it, and instances minted from it keep it.
//!
//! Like the sibling reconciles, this converges on every boot rather than
//! recording a one-shot marker. The residual cost is narrow: an owner who
//! hand-picks exactly 24 on an instance with no definition-level value gets
//! right-sized again on the next launch. Each rewrite logs the agent name so
//! that is visible rather than silent.

use std::path::Path;

use tauri::Manager as _;

use crate::managed_agents::{DEFAULT_AGENT_PARALLELISM, LEGACY_TEAM_CHANNEL_PARALLELISM};

use super::{canonical_dev_data_dir, patch_json_records};

/// Right-size the agent-process pool on records still carrying upstream
/// Buzz's team-channel default. See the module docs for the exact rule.
pub fn right_size_agent_parallelism(app: &tauri::AppHandle) {
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
        let path = dir.join("agents/managed-agents.json");
        if path.exists() {
            right_size_parallelism_in_file(&path);
        }
    }
}

fn right_size_parallelism_in_file(path: &Path) {
    patch_json_records(path, |obj| {
        if obj.get("parallelism").and_then(serde_json::Value::as_u64)
            != Some(u64::from(LEGACY_TEAM_CHANNEL_PARALLELISM))
        {
            return false;
        }
        // An explicit definition-level value is an author's choice, even when
        // it equals the legacy default. `null` counts as absent: that is how
        // `Option<u32>` round-trips through a hand-edited store.
        if obj
            .get("definition_parallelism")
            .is_some_and(|value| !value.is_null())
        {
            return false;
        }
        let name = obj
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("?");
        eprintln!(
            "buzz-desktop: right-size-parallelism: {name:?}: \
             {LEGACY_TEAM_CHANNEL_PARALLELISM} → {DEFAULT_AGENT_PARALLELISM} agent process(es)"
        );
        obj.insert(
            "parallelism".to_string(),
            serde_json::Value::from(DEFAULT_AGENT_PARALLELISM),
        );
        true
    });
}

#[cfg(test)]
mod tests {
    use super::right_size_parallelism_in_file;
    use crate::managed_agents::{DEFAULT_AGENT_PARALLELISM, LEGACY_TEAM_CHANNEL_PARALLELISM};
    use crate::migration::test_support::{read_agents_json, write_agents_json};

    #[test]
    fn legacy_default_is_right_sized_when_no_definition_value() {
        let dir = tempfile::tempdir().unwrap();
        write_agents_json(
            dir.path(),
            &serde_json::json!([{ "name": "Luca", "parallelism": LEGACY_TEAM_CHANNEL_PARALLELISM }]),
        );
        right_size_parallelism_in_file(&dir.path().join("agents/managed-agents.json"));
        let records = read_agents_json(dir.path());
        assert_eq!(records[0]["parallelism"], DEFAULT_AGENT_PARALLELISM);
    }

    #[test]
    fn explicit_definition_parallelism_is_preserved() {
        // Even when it happens to equal the legacy default: a definition that
        // advertises a pool size chose it, so instances minted from it keep it.
        let dir = tempfile::tempdir().unwrap();
        write_agents_json(
            dir.path(),
            &serde_json::json!([
                {
                    "name": "TeamBot",
                    "parallelism": LEGACY_TEAM_CHANNEL_PARALLELISM,
                    "definition_parallelism": LEGACY_TEAM_CHANNEL_PARALLELISM
                },
                {
                    "name": "Octo",
                    "parallelism": LEGACY_TEAM_CHANNEL_PARALLELISM,
                    "definition_parallelism": 8
                }
            ]),
        );
        let path = dir.path().join("agents/managed-agents.json");
        let before = std::fs::read_to_string(&path).unwrap();
        right_size_parallelism_in_file(&path);
        let after = std::fs::read_to_string(&path).unwrap();
        assert_eq!(before, after, "definition-chosen pools are untouched");
    }

    #[test]
    fn null_definition_parallelism_counts_as_absent() {
        let dir = tempfile::tempdir().unwrap();
        write_agents_json(
            dir.path(),
            &serde_json::json!([{
                "name": "Luca",
                "parallelism": LEGACY_TEAM_CHANNEL_PARALLELISM,
                "definition_parallelism": serde_json::Value::Null
            }]),
        );
        right_size_parallelism_in_file(&dir.path().join("agents/managed-agents.json"));
        let records = read_agents_json(dir.path());
        assert_eq!(records[0]["parallelism"], DEFAULT_AGENT_PARALLELISM);
    }

    #[test]
    fn other_values_and_absent_field_are_untouched() {
        // 4 is a deliberate owner pick; a missing field already deserializes
        // to the new default via serde, so neither needs rewriting.
        let dir = tempfile::tempdir().unwrap();
        write_agents_json(
            dir.path(),
            &serde_json::json!([
                { "name": "Quad", "parallelism": 4 },
                { "name": "Unset" },
                { "name": "Already", "parallelism": DEFAULT_AGENT_PARALLELISM }
            ]),
        );
        let path = dir.path().join("agents/managed-agents.json");
        let before = std::fs::read_to_string(&path).unwrap();
        right_size_parallelism_in_file(&path);
        let after = std::fs::read_to_string(&path).unwrap();
        assert_eq!(before, after, "no legacy default present → untouched file");
    }

    #[test]
    fn migration_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        write_agents_json(
            dir.path(),
            &serde_json::json!([{ "name": "Luca", "parallelism": LEGACY_TEAM_CHANNEL_PARALLELISM }]),
        );
        let path = dir.path().join("agents/managed-agents.json");
        right_size_parallelism_in_file(&path);
        let once = std::fs::read_to_string(&path).unwrap();
        right_size_parallelism_in_file(&path);
        let twice = std::fs::read_to_string(&path).unwrap();
        assert_eq!(once, twice, "second run must be a no-op");
    }
}
