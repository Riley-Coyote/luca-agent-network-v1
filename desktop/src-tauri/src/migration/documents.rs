//! Boot-time materialization of the resident agent folder.
//!
//! Before the folder existed, a resident's whole prompt was one opaque string
//! on its record: `system_prompt`. Every agent already on disk carries that
//! string and nothing else. Shipping the folder without this migration would
//! give existing residents an empty folder next to a populated pin — the
//! inspector would show six missing documents for an agent that clearly has a
//! soul, and the first owner edit would have to start from a blank page.
//!
//! So this is the folder's *birth*: for every keyed record without a
//! `documents_dir`, create `<data_dir>/residents/<pubkey>/` and, when the
//! record has a non-empty `system_prompt`, write it to `soul.md` **verbatim** —
//! byte for byte, untrimmed. The pin and the seeded soul must be identical, or
//! the persona re-pin rule (`persona_events::repin_soul`, which treats "soul
//! equals the previous pin" as "nobody has edited this") would mistake the
//! difference for an owner edit and stop following persona updates.
//!
//! ## Why here and not in the load path
//!
//! Same reasoning as the sibling reconciles: `load_managed_agents` is a pure
//! read used from many places, and making it create directories as a side
//! effect would turn every read into disk work. This is a one-pass,
//! idempotent JSON patch in `run_boot_migrations`, running before
//! `restore_managed_agents_on_launch` reads the store, so the first spawn of
//! the launch already sees a record whose `documents_dir`/`documents_hash`
//! match what is on disk.
//!
//! ## The rule
//!
//! For each record in `agents/managed-agents.json`:
//!   * skip it unless `pubkey` is a real resident identity (64 lowercase hex).
//!     Key-less definitions have no folder — they are templates, not
//!     residents.
//!   * skip it when `documents_dir` is already set. The folder is born once;
//!     later drift is the writers' business, not the migration's.
//!   * otherwise create the folder, seed `soul.md` from `system_prompt` when
//!     that is non-empty **and** no `soul.md` exists (an existing soul always
//!     wins — this migration never overwrites), then stamp `documents_dir` and
//!     `documents_hash` onto the record.
//!
//! No `writes.jsonl` line is appended: nobody wrote anything from the desktop,
//! and the journal is a record of desktop writes.

use std::path::Path;

use tauri::Manager as _;

use crate::luca::resident_documents::{
    documents_hash, ensure_dir_at, ensure_root_at, is_valid_pubkey, load, relative_dir,
    seed_document_verbatim, DocumentKind,
};

use super::{canonical_dev_data_dir, patch_json_records};

/// Give every keyed managed-agent record an agent folder. See the module docs
/// for the exact rule.
pub fn materialize_resident_documents(app: &tauri::AppHandle) {
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
        if dir.join("agents/managed-agents.json").exists() {
            materialize_documents_in_dir(&dir);
        }
    }
}

/// The data-dir-scoped half, so the folder rule is testable without an app.
///
/// The JSON patch and the folder must agree on *which* data dir they belong
/// to: `documents_dir` is stored relative precisely so a worktree and the
/// canonical dev dir can share one `managed-agents.json` while each resolving
/// it against its own root.
fn materialize_documents_in_dir(data_dir: &Path) {
    let store = data_dir.join("agents/managed-agents.json");
    patch_json_records(&store, |obj| {
        let pubkey = obj
            .get("pubkey")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if !is_valid_pubkey(&pubkey) {
            return false;
        }
        if obj
            .get("documents_dir")
            .is_some_and(|value| !value.is_null())
        {
            return false;
        }
        let relative = relative_dir(&pubkey);
        let dir = data_dir.join(&relative);
        if let Err(error) = ensure_root_at(&data_dir.join("residents"))
            .and_then(|()| ensure_dir_at(&dir).map(|_| ()))
        {
            eprintln!("buzz-desktop: materialize-resident-documents: {pubkey}: {error}");
            return false;
        }
        let name = obj
            .get("name")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("?");
        let soul = dir.join(DocumentKind::Soul.file_name());
        let prompt = obj
            .get("system_prompt")
            .and_then(serde_json::Value::as_str)
            .filter(|prompt| !prompt.is_empty());
        if let Some(prompt) = prompt {
            if !soul.exists() {
                if let Err(error) = seed_document_verbatim(&dir, DocumentKind::Soul, prompt) {
                    eprintln!("buzz-desktop: materialize-resident-documents: {name:?}: {error}");
                    return false;
                }
            }
        }
        let Ok(loaded) = load(&dir) else {
            return false;
        };
        eprintln!(
            "buzz-desktop: materialize-resident-documents: {name:?}: agent folder at {relative}"
        );
        obj.insert(
            "documents_dir".to_string(),
            serde_json::Value::from(relative),
        );
        obj.insert(
            "documents_hash".to_string(),
            serde_json::Value::from(documents_hash(&loaded)),
        );
        true
    });
}

#[cfg(test)]
mod tests {
    use super::materialize_documents_in_dir;
    use crate::migration::test_support::{read_agents_json, write_agents_json};

    const PUBKEY: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const OTHER: &str = "2222222222222222222222222222222222222222222222222222222222222222";

    #[test]
    fn keyed_record_gets_a_folder_seeded_from_its_pin() {
        let dir = tempfile::tempdir().unwrap();
        write_agents_json(
            dir.path(),
            &serde_json::json!([{ "name": "Luca", "pubkey": PUBKEY, "system_prompt": "  I am Luca.\n" }]),
        );
        materialize_documents_in_dir(dir.path());

        let soul = dir.path().join("residents").join(PUBKEY).join("soul.md");
        assert_eq!(
            std::fs::read_to_string(&soul).unwrap(),
            "  I am Luca.\n",
            "the pin is seeded verbatim — untrimmed"
        );
        assert!(
            !dir.path()
                .join("residents")
                .join(PUBKEY)
                .join("writes.jsonl")
                .exists(),
            "the folder's birth is not a desktop write"
        );

        let records = read_agents_json(dir.path());
        assert_eq!(records[0]["documents_dir"], format!("residents/{PUBKEY}"));
        assert!(records[0]["documents_hash"]
            .as_str()
            .is_some_and(|hash| hash.len() == 64));
    }

    #[test]
    fn an_existing_soul_is_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("residents").join(PUBKEY);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("soul.md"), "the owner already wrote this").unwrap();
        write_agents_json(
            dir.path(),
            &serde_json::json!([{ "name": "Luca", "pubkey": PUBKEY, "system_prompt": "the pin" }]),
        );
        materialize_documents_in_dir(dir.path());
        assert_eq!(
            std::fs::read_to_string(folder.join("soul.md")).unwrap(),
            "the owner already wrote this"
        );
        assert_eq!(
            read_agents_json(dir.path())[0]["documents_dir"],
            format!("residents/{PUBKEY}")
        );
    }

    #[test]
    fn an_empty_prompt_gets_a_folder_but_no_document() {
        let dir = tempfile::tempdir().unwrap();
        write_agents_json(
            dir.path(),
            &serde_json::json!([
                { "name": "Blank", "pubkey": PUBKEY, "system_prompt": "" },
                { "name": "Unset", "pubkey": OTHER }
            ]),
        );
        materialize_documents_in_dir(dir.path());
        for pubkey in [PUBKEY, OTHER] {
            let folder = dir.path().join("residents").join(pubkey);
            assert!(folder.is_dir(), "{pubkey} has a folder");
            assert!(!folder.join("soul.md").exists(), "{pubkey} has no soul yet");
        }
        let records = read_agents_json(dir.path());
        assert_eq!(records[0]["documents_dir"], format!("residents/{PUBKEY}"));
        assert_eq!(records[1]["documents_dir"], format!("residents/{OTHER}"));
    }

    #[test]
    fn key_less_definitions_are_untouched() {
        let dir = tempfile::tempdir().unwrap();
        write_agents_json(
            dir.path(),
            &serde_json::json!([
                { "name": "Definition", "pubkey": "", "slug": "helper", "system_prompt": "a template" },
                { "name": "Junk", "pubkey": "NOT-HEX", "system_prompt": "nope" }
            ]),
        );
        let path = dir.path().join("agents/managed-agents.json");
        let before = std::fs::read_to_string(&path).unwrap();
        materialize_documents_in_dir(dir.path());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
        assert!(!dir.path().join("residents").exists());
    }

    #[test]
    fn migration_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        write_agents_json(
            dir.path(),
            &serde_json::json!([{ "name": "Luca", "pubkey": PUBKEY, "system_prompt": "I am Luca." }]),
        );
        let path = dir.path().join("agents/managed-agents.json");
        materialize_documents_in_dir(dir.path());
        let once = std::fs::read_to_string(&path).unwrap();
        materialize_documents_in_dir(dir.path());
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            once,
            "second run must be a no-op"
        );
    }

    #[test]
    fn a_later_pin_edit_does_not_re_seed_a_born_folder() {
        // Once `documents_dir` is set the folder owns the documents; the pin
        // is no longer the source the migration copies from.
        let dir = tempfile::tempdir().unwrap();
        write_agents_json(
            dir.path(),
            &serde_json::json!([{ "name": "Luca", "pubkey": PUBKEY, "system_prompt": "first" }]),
        );
        materialize_documents_in_dir(dir.path());
        let mut records = read_agents_json(dir.path());
        records[0]["system_prompt"] = serde_json::Value::from("second");
        write_agents_json(dir.path(), &serde_json::Value::from(records));
        materialize_documents_in_dir(dir.path());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("residents").join(PUBKEY).join("soul.md"))
                .unwrap(),
            "first"
        );
    }
}
