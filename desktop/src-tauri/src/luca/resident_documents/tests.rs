//! Unit tests for the resident agent folder.
//!
//! Everything here is path-based on purpose: the store's core takes a
//! `&Path`, so the folder rules are testable without a Tauri `AppHandle`.

use std::path::Path;

use super::*;

fn folder() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    ensure_dir_at(dir.path()).unwrap();
    dir
}

fn put(dir: &Path, kind: DocumentKind, body: &str) {
    std::fs::write(dir.join(kind.file_name()), body).unwrap();
}

fn kind_target(kind: DocumentKind) -> DocumentTarget {
    DocumentTarget::Kind { kind }
}

// ── Kinds ───────────────────────────────────────────────────────────────────

#[test]
fn kinds_map_to_files_writers_and_labels() {
    assert_eq!(DocumentKind::ALL.len(), 6);
    assert_eq!(DocumentKind::Soul.file_name(), "soul.md");
    assert_eq!(DocumentKind::SelfModel.file_name(), "self-model.md");
    assert_eq!(DocumentKind::UserModel.label(), "User model");
    assert_eq!(DocumentKind::Soul.writer(), DocumentWriter::Owner);
    assert_eq!(DocumentKind::Lessons.writer(), DocumentWriter::Agent);
    for kind in DocumentKind::ALL {
        assert_eq!(DocumentKind::from_file_name(kind.file_name()), Some(kind));
    }
    assert_eq!(DocumentKind::from_file_name("notes.md"), None);
}

#[test]
fn assembly_slots_exclude_lessons() {
    assert_eq!(DocumentKind::ASSEMBLY_SLOTS.len(), 5);
    assert!(!DocumentKind::ASSEMBLY_SLOTS.contains(&DocumentKind::Lessons));
    assert_eq!(DocumentKind::ASSEMBLY_SLOTS[0], DocumentKind::Soul);
    assert_eq!(DocumentKind::ASSEMBLY_SLOTS[4], DocumentKind::Instructions);
}

#[test]
fn wire_shapes_match_the_typescript_contract() {
    let kind = serde_json::to_value(kind_target(DocumentKind::SelfModel)).unwrap();
    assert_eq!(kind, serde_json::json!({ "kind": "selfModel" }));
    let rel = serde_json::to_value(DocumentTarget::RelPath {
        rel_path: "notes/x.md".to_owned(),
    })
    .unwrap();
    assert_eq!(rel, serde_json::json!({ "relPath": "notes/x.md" }));

    let parsed: DocumentTarget = serde_json::from_value(serde_json::json!({ "kind": "userModel" }))
        .expect("kind target parses");
    assert_eq!(parsed, kind_target(DocumentKind::UserModel));
    let parsed: DocumentTarget =
        serde_json::from_value(serde_json::json!({ "relPath": "a.md" })).expect("path parses");
    assert_eq!(
        parsed,
        DocumentTarget::RelPath {
            rel_path: "a.md".to_owned()
        }
    );
}

// ── Assembly ────────────────────────────────────────────────────────────────

#[test]
fn assembly_follows_slot_order_and_skips_blanks_and_lessons() {
    let dir = folder();
    put(dir.path(), DocumentKind::Instructions, "Answer briefly.");
    put(dir.path(), DocumentKind::Soul, "  I am Luca.  ");
    put(dir.path(), DocumentKind::Convictions, "   ");
    put(dir.path(), DocumentKind::UserModel, "Riley builds late.");
    put(dir.path(), DocumentKind::Lessons, "Never guess.");
    let assembled = assemble_system_prompt(&load(dir.path()).unwrap()).unwrap();
    assert_eq!(
        assembled,
        "[Soul]\nI am Luca.\n\n[User]\nRiley builds late.\n\n[Instructions]\nAnswer briefly."
    );
    assert!(!assembled.contains("Never guess."), "lessons is not a slot");
}

#[test]
fn assembly_returns_none_when_nothing_to_say() {
    let dir = folder();
    assert_eq!(assemble_system_prompt(&load(dir.path()).unwrap()), None);
    put(dir.path(), DocumentKind::Soul, "\n  \n");
    put(dir.path(), DocumentKind::Lessons, "only lessons");
    assert_eq!(assemble_system_prompt(&load(dir.path()).unwrap()), None);
}

#[test]
fn assembly_never_emits_the_harness_section_literals() {
    let dir = folder();
    for kind in DocumentKind::ASSEMBLY_SLOTS {
        put(dir.path(), kind, "body");
    }
    let assembled = assemble_system_prompt(&load(dir.path()).unwrap()).unwrap();
    for reserved in [
        "[System]",
        "[Agent Memory — core]",
        "[Channel Canvas]",
        "# Team Instructions",
    ] {
        assert!(
            !assembled.contains(reserved),
            "assembly must not collide with {reserved}"
        );
    }
}

#[test]
fn assembly_caps_a_single_section_at_20_kib() {
    let dir = folder();
    put(dir.path(), DocumentKind::Soul, &"s".repeat(30 * 1024));
    let assembled = assemble_system_prompt(&load(dir.path()).unwrap()).unwrap();
    assert!(assembled.ends_with(SECTION_TRUNCATED_MARKER));
    assert_eq!(
        assembled.len(),
        "[Soul]\n".len() + ASSEMBLY_SECTION_CAP + SECTION_TRUNCATED_MARKER.len()
    );
}

#[test]
fn section_cap_cuts_on_a_char_boundary() {
    // A 3-byte char straddling the cap must not be split mid-sequence.
    let body = "é".repeat(ASSEMBLY_SECTION_CAP);
    let capped = cap_section(&body);
    assert!(capped.ends_with(SECTION_TRUNCATED_MARKER));
    assert!(capped.len() <= ASSEMBLY_SECTION_CAP + SECTION_TRUNCATED_MARKER.len());
}

#[test]
fn assembly_stops_at_the_60_kib_total_and_says_so() {
    let dir = folder();
    for kind in DocumentKind::ASSEMBLY_SLOTS {
        put(dir.path(), kind, &"x".repeat(20 * 1024));
    }
    let assembled = assemble_system_prompt(&load(dir.path()).unwrap()).unwrap();
    assert!(assembled.ends_with(ASSEMBLY_OMITTED_MARKER));
    assert!(assembled.contains("[Soul]"));
    assert!(
        !assembled.contains("[Instructions]"),
        "the fifth slot is past the total cap"
    );
}

// ── Hashing ─────────────────────────────────────────────────────────────────

#[test]
fn empty_folder_has_a_stable_hash_distinct_from_any_content() {
    let empty = folder();
    let missing = tempfile::tempdir().unwrap();
    let empty_hash = documents_hash(&load(empty.path()).unwrap());
    let missing_hash = documents_hash(&load(missing.path().join("nope").as_path()).unwrap());
    assert_eq!(empty_hash, missing_hash);
    put(empty.path(), DocumentKind::Soul, "");
    assert_ne!(documents_hash(&load(empty.path()).unwrap()), empty_hash);
}

#[test]
fn hash_moves_on_document_and_extra_file_edits() {
    let dir = folder();
    put(dir.path(), DocumentKind::Soul, "one");
    let first = documents_hash(&load(dir.path()).unwrap());
    put(dir.path(), DocumentKind::Soul, "two");
    let second = documents_hash(&load(dir.path()).unwrap());
    assert_ne!(first, second);

    std::fs::write(dir.path().join("notes.md"), "a").unwrap();
    let with_extra = documents_hash(&load(dir.path()).unwrap());
    assert_ne!(second, with_extra);
    // Same name, different bytes: the hash must still move.
    std::fs::write(dir.path().join("notes.md"), "b").unwrap();
    assert_ne!(with_extra, documents_hash(&load(dir.path()).unwrap()));
}

// ── Loading + inspecting ────────────────────────────────────────────────────

#[test]
fn extra_files_skip_the_journal_dotfiles_and_unknown_types() {
    let dir = folder();
    put(dir.path(), DocumentKind::Soul, "soul");
    std::fs::write(dir.path().join(WRITES_JOURNAL), "{}\n").unwrap();
    std::fs::write(dir.path().join(".secret.md"), "x").unwrap();
    std::fs::write(dir.path().join("photo.png"), "x").unwrap();
    std::fs::write(dir.path().join("notes.md"), "x").unwrap();
    std::fs::create_dir_all(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub/deep.txt"), "x").unwrap();
    std::fs::create_dir_all(dir.path().join(".hidden")).unwrap();
    std::fs::write(dir.path().join(".hidden/y.md"), "x").unwrap();

    let loaded = load(dir.path()).unwrap();
    let names: Vec<_> = loaded.extra.iter().map(|e| e.rel_path.as_str()).collect();
    assert_eq!(names, vec!["notes.md", "sub/deep.txt"]);
    assert_eq!(loaded.by_kind.get(&DocumentKind::Soul).unwrap(), "soul");
}

#[test]
fn inspector_reports_every_kind_and_the_relative_dir() {
    let pubkey = "a".repeat(64);
    let dir = folder();
    put(dir.path(), DocumentKind::Soul, "soul");
    let inspector = inspect(dir.path(), &pubkey).unwrap();
    let value = serde_json::to_value(&inspector).unwrap();
    assert_eq!(value["dir"], format!("residents/{pubkey}"));
    assert_eq!(value["source"], "folder");
    assert_eq!(value["documents"].as_array().unwrap().len(), 6);
    assert_eq!(value["documents"][0]["kind"], "soul");
    assert_eq!(value["documents"][0]["writer"], "owner");
    assert_eq!(value["documents"][0]["exists"], true);
    assert_eq!(value["documents"][1]["exists"], false);
    assert!(value["hash"].as_str().is_some_and(|h| h.len() == 64));
}

#[test]
fn inspect_refuses_a_pubkey_that_is_not_lowercase_hex64() {
    let dir = folder();
    assert!(inspect(dir.path(), &"A".repeat(64)).is_err());
    assert!(inspect(dir.path(), "short").is_err());
    assert!(inspect(dir.path(), "../escape").is_err());
    assert!(inspect(dir.path(), &"f".repeat(64)).is_ok());
}

// ── Reading + writing ───────────────────────────────────────────────────────

#[test]
fn read_of_a_missing_document_is_empty_with_no_hash() {
    let dir = folder();
    let content = read(dir.path(), kind_target(DocumentKind::Soul)).unwrap();
    let value = serde_json::to_value(&content).unwrap();
    assert_eq!(value["exists"], false);
    assert_eq!(value["content"], "");
    assert!(value["hash"].is_null());
}

#[test]
fn write_creates_journals_and_round_trips() {
    let dir = folder();
    let receipt = write(
        dir.path(),
        kind_target(DocumentKind::Soul),
        "I am Luca.",
        None,
        DocumentWriter::Owner,
    )
    .unwrap();
    let value = serde_json::to_value(&receipt).unwrap();
    assert_eq!(value["target"], serde_json::json!({ "kind": "soul" }));
    assert_eq!(value["bytes"], 10);
    assert_eq!(value["hash"], file_hash("I am Luca."));

    let content = read(dir.path(), kind_target(DocumentKind::Soul)).unwrap();
    assert_eq!(
        serde_json::to_value(&content).unwrap()["content"],
        "I am Luca."
    );

    let journal = std::fs::read_to_string(dir.path().join(WRITES_JOURNAL)).unwrap();
    let line: serde_json::Value = serde_json::from_str(journal.trim()).unwrap();
    assert_eq!(line["target"], serde_json::json!({ "kind": "soul" }));
    assert_eq!(line["writer"], "owner");
    assert_eq!(line["bytes"], 10);
    assert_eq!(line["hash"], file_hash("I am Luca."));
    assert!(line["at"].as_i64().is_some_and(|at| at > 0));
}

#[test]
fn write_journal_appends_one_line_per_write() {
    let dir = folder();
    let first = write(
        dir.path(),
        kind_target(DocumentKind::Soul),
        "a",
        None,
        DocumentWriter::Owner,
    )
    .unwrap();
    let hash = serde_json::to_value(&first).unwrap()["hash"]
        .as_str()
        .unwrap()
        .to_owned();
    write(
        dir.path(),
        kind_target(DocumentKind::Soul),
        "b",
        Some(&hash),
        DocumentWriter::Agent,
    )
    .unwrap();
    let journal = std::fs::read_to_string(dir.path().join(WRITES_JOURNAL)).unwrap();
    assert_eq!(journal.lines().count(), 2);
    assert!(journal.lines().last().unwrap().contains("\"agent\""));
}

#[test]
fn expected_hash_mismatch_is_a_conflict_carrying_the_current_hash() {
    let dir = folder();
    put(dir.path(), DocumentKind::Soul, "on disk");
    let error = write(
        dir.path(),
        kind_target(DocumentKind::Soul),
        "mine",
        Some(&file_hash("stale")),
        DocumentWriter::Owner,
    )
    .unwrap_err();
    assert_eq!(
        error,
        WriteError::Conflict {
            current_hash: Some(file_hash("on disk"))
        }
    );
    assert_eq!(
        String::from(error),
        format!("{DOCUMENT_CONFLICT_PREFIX}{}", file_hash("on disk"))
    );
    // The refused write must not have landed.
    assert_eq!(
        std::fs::read_to_string(dir.path().join("soul.md")).unwrap(),
        "on disk"
    );
}

#[test]
fn expecting_no_file_conflicts_when_one_appeared() {
    let dir = folder();
    put(dir.path(), DocumentKind::Soul, "someone got here first");
    let error = write(
        dir.path(),
        kind_target(DocumentKind::Soul),
        "mine",
        None,
        DocumentWriter::Owner,
    )
    .unwrap_err();
    assert!(matches!(error, WriteError::Conflict { .. }));
}

#[test]
fn expecting_a_file_conflicts_when_it_vanished() {
    let dir = folder();
    let error = write(
        dir.path(),
        kind_target(DocumentKind::Soul),
        "mine",
        Some(&file_hash("gone")),
        DocumentWriter::Owner,
    )
    .unwrap_err();
    assert_eq!(error, WriteError::Conflict { current_hash: None });
    assert_eq!(String::from(error), DOCUMENT_CONFLICT_PREFIX);
}

#[test]
fn empty_content_writes_an_empty_file_while_clear_removes_it() {
    let dir = folder();
    write(
        dir.path(),
        kind_target(DocumentKind::Soul),
        "",
        None,
        DocumentWriter::Owner,
    )
    .unwrap();
    assert!(dir.path().join("soul.md").is_file());
    clear(dir.path(), DocumentKind::Soul).unwrap();
    assert!(!dir.path().join("soul.md").exists());
    // Clearing an absent document is not an error.
    clear(dir.path(), DocumentKind::Soul).unwrap();
}

#[test]
fn write_refuses_traversal_absolute_paths_and_unknown_types() {
    let dir = folder();
    for rel in [
        "../escape.md",
        "notes/../../escape.md",
        ".hidden.md",
        "photo.png",
        "",
        WRITES_JOURNAL,
    ] {
        let error = write(
            dir.path(),
            DocumentTarget::RelPath {
                rel_path: rel.to_owned(),
            },
            "x",
            None,
            DocumentWriter::Owner,
        )
        .unwrap_err();
        assert!(
            matches!(error, WriteError::Rejected(_)),
            "{rel} must be rejected"
        );
    }
    let absolute = if cfg!(windows) {
        "C:\\tmp\\escape.md"
    } else {
        "/tmp/escape.md"
    };
    assert!(matches!(
        write(
            dir.path(),
            DocumentTarget::RelPath {
                rel_path: absolute.to_owned()
            },
            "x",
            None,
            DocumentWriter::Owner,
        )
        .unwrap_err(),
        WriteError::Rejected(_)
    ));
}

#[test]
fn write_enforces_the_size_ceilings() {
    let dir = folder();
    assert!(matches!(
        write(
            dir.path(),
            kind_target(DocumentKind::Soul),
            &"x".repeat(MAX_DOCUMENT_BYTES + 1),
            None,
            DocumentWriter::Owner,
        )
        .unwrap_err(),
        WriteError::Rejected(_)
    ));
    assert!(matches!(
        write(
            dir.path(),
            DocumentTarget::RelPath {
                rel_path: "notes.md".to_owned()
            },
            &"x".repeat(MAX_EXTRA_FILE_BYTES + 1),
            None,
            DocumentWriter::Owner,
        )
        .unwrap_err(),
        WriteError::Rejected(_)
    ));
}

#[test]
fn write_creates_missing_subdirectories_for_extra_files() {
    let dir = folder();
    write(
        dir.path(),
        DocumentTarget::RelPath {
            rel_path: "notes/today.md".to_owned(),
        },
        "hello",
        None,
        DocumentWriter::Owner,
    )
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("notes/today.md")).unwrap(),
        "hello"
    );
    let loaded = load(dir.path()).unwrap();
    assert_eq!(loaded.extra[0].rel_path, "notes/today.md");
}

#[cfg(unix)]
#[test]
fn documents_are_written_owner_only() {
    use std::os::unix::fs::PermissionsExt as _;
    let dir = folder();
    write(
        dir.path(),
        kind_target(DocumentKind::Soul),
        "private",
        None,
        DocumentWriter::Owner,
    )
    .unwrap();
    let mode = std::fs::metadata(dir.path().join("soul.md"))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    let dir_mode = std::fs::metadata(dir.path()).unwrap().permissions().mode();
    assert_eq!(dir_mode & 0o777, 0o700);
}

#[cfg(unix)]
#[test]
fn a_symlinked_document_is_refused_rather_than_followed() {
    let dir = folder();
    let outside = tempfile::tempdir().unwrap();
    let victim = outside.path().join("victim.md");
    std::fs::write(&victim, "do not touch").unwrap();
    std::os::unix::fs::symlink(&victim, dir.path().join("soul.md")).unwrap();
    assert!(matches!(
        write(
            dir.path(),
            kind_target(DocumentKind::Soul),
            "overwritten",
            None,
            DocumentWriter::Owner,
        )
        .unwrap_err(),
        WriteError::Rejected(_)
    ));
    assert_eq!(std::fs::read_to_string(&victim).unwrap(), "do not touch");
}

// ── Re-pin rule ─────────────────────────────────────────────────────────────

#[test]
fn repin_writes_soul_when_the_folder_has_none() {
    let dir = folder();
    repin_soul_in_dir(dir.path(), Some("new pin"), Some("old pin")).unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("soul.md")).unwrap(),
        "new pin"
    );
}

#[test]
fn repin_follows_the_pin_while_soul_still_mirrors_it() {
    let dir = folder();
    put(dir.path(), DocumentKind::Soul, "old pin");
    repin_soul_in_dir(dir.path(), Some("new pin"), Some("old pin")).unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("soul.md")).unwrap(),
        "new pin"
    );
}

#[test]
fn repin_leaves_an_owner_edited_soul_alone() {
    let dir = folder();
    put(dir.path(), DocumentKind::Soul, "the owner rewrote this");
    repin_soul_in_dir(dir.path(), Some("new pin"), Some("old pin")).unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("soul.md")).unwrap(),
        "the owner rewrote this"
    );
}

#[test]
fn repin_with_a_blank_new_pin_does_nothing() {
    let dir = folder();
    put(dir.path(), DocumentKind::Soul, "old pin");
    repin_soul_in_dir(dir.path(), Some("   "), Some("old pin")).unwrap();
    repin_soul_in_dir(dir.path(), None, Some("old pin")).unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("soul.md")).unwrap(),
        "old pin"
    );
}

#[test]
fn relative_dir_is_the_persisted_shape() {
    let pubkey = "b".repeat(64);
    assert_eq!(relative_dir(&pubkey), format!("residents/{pubkey}"));
}
