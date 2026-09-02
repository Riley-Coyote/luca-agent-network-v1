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
