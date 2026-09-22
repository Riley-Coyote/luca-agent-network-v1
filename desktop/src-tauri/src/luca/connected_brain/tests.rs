use super::*;
use serde_json::json;
use std::{collections::HashSet, fs, process::Command};

#[test]
fn discovery_is_bounded_and_does_not_follow_symlinks() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join("nested/repo/.git")).unwrap();
    fs::create_dir_all(outside.path().join("escaped/.git")).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(outside.path(), root.path().join("outside-link")).unwrap();

    let found = discover_in_added_root(root.path()).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].display_name, "repo");
}

#[test]
fn repository_inventory_respects_ignore_binary_credentials_and_escape() {
    let root = tempfile::tempdir().unwrap();
    Command::new("git")
        .args(["init", "--quiet"])
        .arg(root.path())
        .status()
        .unwrap();
    fs::write(root.path().join(".gitignore"), "ignored.txt\n").unwrap();
    fs::write(root.path().join("tracked.txt"), "alpha visible fact").unwrap();
    fs::write(root.path().join("working.md"), "beta working fact").unwrap();
    fs::write(root.path().join("ignored.txt"), "ignored fact").unwrap();
    fs::write(root.path().join("secret-token.txt"), "not indexable").unwrap();
    fs::write(root.path().join("binary.dat"), b"abc\0def").unwrap();
    Command::new("git")
        .args(["-C"])
        .arg(root.path())
        .args(["add", "tracked.txt", ".gitignore"])
        .status()
        .unwrap();

    let mut paths = Vec::new();
    assert!(
        repository::visit_documents(root.path(), |relative_path, _body| {
            paths.push(relative_path.to_owned());
            Ok(true)
        })
        .unwrap()
    );
    assert!(paths.iter().any(|path| path == "tracked.txt"));
    assert!(paths.iter().any(|path| path == "working.md"));
    assert!(!paths.iter().any(|path| path == "ignored.txt"));
    assert!(!paths.iter().any(|path| path == "secret-token.txt"));
    assert!(!paths.iter().any(|path| path == "binary.dat"));
    assert!(!repository::path_is_indexable("../outside"));
    assert!(!repository::path_is_indexable(".git/config"));
}

#[test]
fn repository_visitor_stops_before_reading_the_unneeded_tail() {
    let root = tempfile::tempdir().unwrap();
    Command::new("git")
        .args(["init", "--quiet"])
        .arg(root.path())
        .status()
        .unwrap();
    fs::write(root.path().join("a-first.md"), "first visible fact").unwrap();
    fs::write(root.path().join("z-tail.md"), "tail visible fact").unwrap();

    let mut visited = Vec::new();
    let completed = repository::visit_documents(root.path(), |relative_path, _body| {
        visited.push(relative_path.to_owned());
        Ok(false)
    })
    .unwrap();

    assert!(!completed);
    assert_eq!(visited, vec!["a-first.md"]);
}

#[test]
fn codex_parser_keeps_visible_messages_only() {
    let visible = json!({
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "assistant",
            "phase": "final_answer",
            "content": [{"type": "output_text", "text": "Visible answer"}]
        }
    });
    let developer = json!({
        "type": "response_item",
        "payload": {"type": "message", "role": "developer", "content": [{"type": "input_text", "text": "hidden"}]}
    });
    let reasoning =
        json!({"type": "response_item", "payload": {"type": "reasoning", "summary": "hidden"}});
    assert_eq!(
        sessions::parse_codex_fixture(&visible).as_deref(),
        Some("Visible answer")
    );
    assert_eq!(sessions::parse_codex_fixture(&developer), None);
    assert_eq!(sessions::parse_codex_fixture(&reasoning), None);
}

#[test]
fn claude_parser_excludes_thinking_tools_and_credentials() {
    let visible = json!({
        "type": "assistant",
        "message": {"role": "assistant", "content": [
            {"type": "thinking", "thinking": "hidden"},
            {"type": "text", "text": "Visible answer"},
            {"type": "tool_use", "name": "Read", "input": {"file_path": "/secret"}}
        ]}
    });
    let tool_result = json!({
        "type": "user",
        "message": {"role": "user", "content": [{"type": "tool_result", "content": "hidden"}]}
    });
    let credential = json!({
        "type": "user",
        "message": {"role": "user", "content": "OPENAI_API_KEY=secret"}
    });
    let internal_command = json!({
        "type": "user",
        "message": {"role": "user", "content": "<command-message>hidden</command-message>"}
    });
    let role_mismatch = json!({
        "type": "user",
        "message": {"role": "assistant", "content": [{"type": "text", "text": "hidden"}]}
    });
    let message_meta = json!({
        "type": "user",
        "isMeta": false,
        "message": {"role": "user", "isMeta": true, "content": "hidden injected context"}
    });
    let compact_summary = json!({
        "type": "user",
        "isCompactSummary": true,
        "message": {"role": "user", "content": "hidden compacted system summary"}
    });
    let native_user = json!({
        "type": "user",
        "isSidechain": false,
        "message": {
            "role": "user",
            "content": "Keep this ordinary native Claude request visible."
        }
    });
    let sdk_ts_prompt_envelope = json!({
        "type": "user",
        "isSidechain": false,
        "promptSource": "sdk",
        "entrypoint": "sdk-ts",
        "message": {
            "role": "user",
            "content": "[Base]\ninternal base prompt\n\n[System]\ninternal instructions\n\n[Context]\ninternal context\n\n[Conversation Context]\ninternal conversation\n\n[Buzz event: @mention]\nEvent ID: fixture-event\nChannel: fixture-channel\npubkeys: fixture-pubkey"
        }
    });
    let sdk_cli_plain_prompt = json!({
        "type": "user",
        "isSidechain": false,
        "entrypoint": "sdk-cli",
        "message": {
            "role": "user",
            "content": "A plain-looking SDK prompt must still remain hidden."
        }
    });
    let unlabelled_prompt_envelope = json!({
        "type": "user",
        "isSidechain": false,
        "message": {
            "role": "user",
            "content": "[Conversation Context (1 of 1 messages)]\ninternal conversation state"
        }
    });
    assert_eq!(
        sessions::parse_claude_fixture(&visible).as_deref(),
        Some("Visible answer")
    );
    assert_eq!(sessions::parse_claude_fixture(&tool_result), None);
    assert_eq!(sessions::parse_claude_fixture(&credential), None);
    assert_eq!(sessions::parse_claude_fixture(&internal_command), None);
    assert_eq!(sessions::parse_claude_fixture(&role_mismatch), None);
    assert_eq!(sessions::parse_claude_fixture(&message_meta), None);
    assert_eq!(sessions::parse_claude_fixture(&compact_summary), None);
    assert_eq!(
        sessions::parse_claude_fixture(&native_user).as_deref(),
        Some("Keep this ordinary native Claude request visible.")
    );
    assert_eq!(
        sessions::parse_claude_fixture(&sdk_ts_prompt_envelope),
        None
    );
    assert_eq!(sessions::parse_claude_fixture(&sdk_cli_plain_prompt), None);
    assert_eq!(
        sessions::parse_claude_fixture(&unlabelled_prompt_envelope),
        None
    );
}

#[test]
fn index_rereads_original_and_rejects_changed_hash() {
    let root = tempfile::tempdir().unwrap();
    Command::new("git")
        .args(["init", "--quiet"])
        .arg(root.path())
        .status()
        .unwrap();
    fs::write(
        root.path().join("fact.md"),
        "The corpus-only fact is cobalt.",
    )
    .unwrap();
    let candidate = ConnectedBrainDiscoveryCandidateV1 {
        discovery_id: OpaqueId::parse("discovery-fixture").unwrap(),
        source_kind: ConnectedBrainSourceKindV1::Repository,
        display_name: "fixture".into(),
        canonical_root: root.path().canonicalize().unwrap(),
        item_count: 1,
        earliest_at: None,
        latest_at: None,
        discovered_at: Instant::now(),
    };
    let source_id = OpaqueId::parse("source-fixture").unwrap();
    let build = build_index(&source_id, &candidate).unwrap();
    let entry = build.entries.first().unwrap();
    assert_eq!(
        read_verified_excerpt(root.path(), ConnectedBrainSourceKindV1::Repository, entry).unwrap(),
        "The corpus-only fact is cobalt."
    );
    fs::write(root.path().join("fact.md"), "The fact changed.").unwrap();
    assert!(
        read_verified_excerpt(root.path(), ConnectedBrainSourceKindV1::Repository, entry).is_err()
    );
}

fn write_codex_session(path: &std::path::Path, prefix: &str, messages: usize) {
    let body = (0..messages)
        .map(|index| {
            json!({
                "type": "event_msg",
                "payload": {
                    "type": "user_message",
                    "message": format!("{prefix} message {index}")
                }
            })
            .to_string()
        })
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(path, format!("{body}\n")).unwrap();
}

#[test]
fn native_session_catalog_is_not_limited_to_search_index_entries() {
    let root = tempfile::tempdir().unwrap();
    write_codex_session(&root.path().join("a-older.jsonl"), "Older topic", 2);
    write_codex_session(&root.path().join("z-newer.jsonl"), "Newer topic", 2);
    let source_id = OpaqueId::parse("source-session-catalog").unwrap();
    let mut budget = SessionReadBudget::for_rail_list();

    let listed = list_native_sessions(
        root.path(),
        ConnectedBrainSourceKindV1::CodexHistory,
        &source_id,
        &mut budget,
        &HashSet::new(),
    )
    .unwrap();

    assert_eq!(listed.total_sessions, 2);
    assert_eq!(listed.sessions.len(), 2);
    assert_eq!(listed.sessions[0].title, "Newer topic message 0");
    assert_eq!(listed.sessions[1].title, "Older topic message 0");
}

#[test]
fn session_index_spreads_its_budget_across_recent_sessions() {
    let root = tempfile::tempdir().unwrap();
    write_codex_session(&root.path().join("a-older.jsonl"), "Older topic", 40);
    write_codex_session(&root.path().join("z-newer.jsonl"), "Newer topic", 40);
    let candidate = ConnectedBrainDiscoveryCandidateV1 {
        discovery_id: OpaqueId::parse("discovery-session-budget").unwrap(),
        source_kind: ConnectedBrainSourceKindV1::CodexHistory,
        display_name: "Codex".into(),
        canonical_root: root.path().canonicalize().unwrap(),
        item_count: 2,
        earliest_at: None,
        latest_at: None,
        discovered_at: Instant::now(),
    };
    let source_id = OpaqueId::parse("source-session-budget").unwrap();

    let build = build_index(&source_id, &candidate).unwrap();
    let locators = build
        .entries
        .iter()
        .map(|entry| entry.relative_locator.as_str())
        .collect::<std::collections::BTreeSet<_>>();

    assert_eq!(build.entries.len(), 32);
    assert_eq!(locators.len(), 2);
    assert!(locators.contains("a-older.jsonl"));
    assert!(locators.contains("z-newer.jsonl"));
}

fn incremental_candidate(
    root: &std::path::Path,
    kind: ConnectedBrainSourceKindV1,
) -> ConnectedBrainDiscoveryCandidateV1 {
    ConnectedBrainDiscoveryCandidateV1 {
        discovery_id: OpaqueId::parse("discovery-incremental").unwrap(),
        source_kind: kind,
        display_name: "fixture".into(),
        canonical_root: root.canonicalize().unwrap(),
        item_count: 0,
        earliest_at: None,
        latest_at: None,
        discovered_at: Instant::now(),
    }
}

fn prior(build: ConnectedBrainIndexBuildV1) -> PriorIndex {
    // Serialize markers to exercise the restart boundary (no in-memory body cache).
    let files = serde_json::from_slice(&serde_json::to_vec(&build.files).unwrap()).unwrap();
    PriorIndex {
        established: true,
        expected_generation: None,
        files,
        entries: build.entries,
    }
}

#[test]
fn incremental_repository_reuses_unchanged_and_handles_edits_additions_deletions() {
    let root = tempfile::tempdir().unwrap();
    Command::new("git")
        .args(["init", "--quiet"])
        .arg(root.path())
        .status()
        .unwrap();
    fs::write(root.path().join("a.md"), "alpha original").unwrap();
    fs::write(root.path().join("b.md"), "bravo original").unwrap();
    let candidate = incremental_candidate(root.path(), ConnectedBrainSourceKindV1::Repository);
    let id = OpaqueId::parse("incremental-repository").unwrap();
    let cold = build_index(&id, &candidate).unwrap();
    assert_eq!(cold.extracted_files, 2);
    let revision = cold.index_revision.clone();
    let warm = build_index_incremental(&id, &candidate, &prior(cold)).unwrap();
    assert_eq!((warm.reused_files, warm.extracted_files), (2, 0));
    assert_eq!(warm.index_revision, revision);
    let baseline = prior(warm);
    // Same length and restored mtime: ctime must still invalidate the marker.
    let original_time = fs::metadata(root.path().join("a.md"))
        .unwrap()
        .modified()
        .unwrap();
    fs::write(root.path().join("a.md"), "alpha modified").unwrap();
    fs::File::options()
        .write(true)
        .open(root.path().join("a.md"))
        .unwrap()
        .set_modified(original_time)
        .unwrap();
    fs::write(root.path().join("c.md"), "charlie added").unwrap();
    let changed = build_index_incremental(&id, &candidate, &baseline).unwrap();
    assert_eq!((changed.reused_files, changed.extracted_files), (1, 2));
    assert_eq!(
        changed.index_revision,
        build_index(&id, &candidate).unwrap().index_revision
    );
    let baseline = prior(changed);
    fs::remove_file(root.path().join("b.md")).unwrap();
    let deleted = build_index_incremental(&id, &candidate, &baseline).unwrap();
    assert_eq!((deleted.reused_files, deleted.extracted_files), (2, 0));
    assert!(!deleted.files.contains_key("b.md"));
    assert_eq!(
        deleted.index_revision,
        build_index(&id, &candidate).unwrap().index_revision
    );
    let baseline = prior(deleted);
    fs::remove_file(root.path().join("a.md")).unwrap();
    fs::remove_file(root.path().join("c.md")).unwrap();
    let empty = build_index_incremental(&id, &candidate, &baseline).unwrap();
    assert!(empty.entries.is_empty());
    assert!(empty.files.is_empty());
}

#[test]
fn incremental_sessions_reparse_only_changed_file_and_match_cold_index() {
    let root = tempfile::tempdir().unwrap();
    for kind in [
        ConnectedBrainSourceKindV1::CodexHistory,
        ConnectedBrainSourceKindV1::ClaudeHistory,
    ] {
        let write = |name: &str, count: usize| {
            let lines = (0..count).map(|n| {
                if kind == ConnectedBrainSourceKindV1::CodexHistory {
                    json!({"type":"event_msg", "payload":{"type":"user_message", "message":format!("visible fact {n}")}})
                } else {
                    json!({"type":"user", "message":{"role":"user", "content":format!("visible fact {n}")}})
                }.to_string()
            }).collect::<Vec<_>>().join("\n");
            fs::write(root.path().join(name), format!("{lines}\n")).unwrap();
        };
        write("a.jsonl", 2);
        write("b.jsonl", 2);
        let candidate = incremental_candidate(root.path(), kind);
        let id = OpaqueId::parse("incremental-sessions").unwrap();
        let baseline = prior(build_index(&id, &candidate).unwrap());
        let scans_before = sessions::purpose_reads();
        let unchanged = build_index_incremental(&id, &candidate, &baseline).unwrap();
        assert_eq!(sessions::purpose_reads(), scans_before);
        assert_eq!((unchanged.reused_files, unchanged.extracted_files), (2, 0));
        write("a.jsonl", 4);
        let appended = build_index_incremental(&id, &candidate, &baseline).unwrap();
        assert_eq!((appended.reused_files, appended.extracted_files), (1, 1));
        assert_eq!(
            appended.index_revision,
            build_index(&id, &candidate).unwrap().index_revision
        );
        let baseline = prior(appended);
        write("a.jsonl", 1);
        let truncated = build_index_incremental(&id, &candidate, &baseline).unwrap();
        assert_eq!((truncated.reused_files, truncated.extracted_files), (1, 1));
        assert_eq!(
            truncated.index_revision,
            build_index(&id, &candidate).unwrap().index_revision
        );
        let baseline = prior(truncated);
        fs::write(
            root.path().join("a.jsonl"),
            "you are performing one private luca continuity handoff",
        )
        .unwrap();
        let hidden = build_index_incremental(&id, &candidate, &baseline).unwrap();
        assert_eq!(hidden.item_count, 1);
        assert!(hidden
            .entries
            .iter()
            .all(|entry| entry.relative_locator == "b.jsonl"));
    }
}

#[test]
fn incremental_index_does_not_reuse_another_source_or_partial_file() {
    let root = tempfile::tempdir().unwrap();
    write_codex_session(&root.path().join("a.jsonl"), "visible", 3);
    let candidate = incremental_candidate(root.path(), ConnectedBrainSourceKindV1::CodexHistory);
    let id = OpaqueId::parse("incremental-source").unwrap();
    let mut baseline = prior(build_index(&id, &candidate).unwrap());
    baseline.entries.pop();
    let repaired = build_index_incremental(&id, &candidate, &baseline).unwrap();
    assert_eq!(repaired.reused_files, 0);
    assert_eq!(repaired.entries.len(), 3);
    let other = OpaqueId::parse("another-source").unwrap();
    let isolated = build_index_incremental(&other, &candidate, &prior(repaired)).unwrap();
    assert_eq!(isolated.reused_files, 0);
    assert!(isolated
        .entries
        .iter()
        .all(|entry| entry.source_id == other));
}

#[test]
fn incremental_large_catalogue_extracts_one_changed_session_not_the_corpus() {
    let root = tempfile::tempdir().unwrap();
    for n in 0..200 {
        write_codex_session(
            &root.path().join(format!("session-{n:03}.jsonl")),
            "visible",
            4,
        );
    }
    let candidate = incremental_candidate(root.path(), ConnectedBrainSourceKindV1::CodexHistory);
    let id = OpaqueId::parse("incremental-large-corpus").unwrap();
    let cold = build_index(&id, &candidate).unwrap();
    assert_eq!(cold.extracted_files, 200);
    let baseline = prior(cold);
    write_codex_session(&root.path().join("session-050.jsonl"), "changed", 5);
    let scans_before = sessions::purpose_reads();
    let refreshed = build_index_incremental(&id, &candidate, &baseline).unwrap();
    assert_eq!(
        (refreshed.reused_files, refreshed.extracted_files),
        (199, 1)
    );
    // One inventory eligibility check plus one verified reader check, not 200.
    assert_eq!(sessions::purpose_reads() - scans_before, 2);
    assert_eq!(
        refreshed.index_revision,
        build_index(&id, &candidate).unwrap().index_revision
    );
}
