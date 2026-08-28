use std::{fs, process::Command};

use serde_json::json;

use super::*;

#[test]
fn deceptive_custom_commands_do_not_claim_a_supported_runtime() {
    assert_eq!(
        current_managed_runtime_family(Some("codex"), Some("my-codex-wrapper"), None,),
        "custom"
    );
    assert_eq!(
        current_managed_runtime_family(Some("claude"), Some("claude-helper-proxy"), None,),
        "custom"
    );
}

#[test]
fn current_runtime_identity_replaces_the_create_time_snapshot() {
    assert_eq!(
        current_managed_runtime_family(Some("codex"), None, None),
        "codex"
    );
    assert_eq!(
        current_managed_runtime_family(Some("claude"), None, None),
        "claude_code"
    );
    assert_eq!(
        current_managed_runtime_family(Some("custom"), None, None),
        "custom"
    );
}

#[test]
fn receipt_store_failure_cannot_reclassify_a_committed_operation() {
    let response = RepositoryBrokerResponseV1 {
        protocol: BROKER_PROTOCOL,
        ok: true,
        content: "operation committed".into(),
        receipt: None,
    };
    let preserved = preserve_terminal_operation_truth(
        response,
        Err("synthetic receipt store failure".into()),
        "committed",
    );
    assert!(preserved.ok);
    assert_eq!(preserved.content, "operation committed");
}

#[test]
fn repo_run_is_high_impact_and_each_command_has_a_distinct_confirmation() {
    assert_eq!(
        repository_risk(RepositoryToolOperationV1::Run),
        CapabilityRisk::HighImpact
    );
    let source = OpaqueId::parse("source-1").expect("synthetic source");
    let first = operation_fingerprint(
        RepositoryToolOperationV1::Run,
        &source,
        &json!({"source_id": "source-1", "executable": "node", "args": ["first.js"]}),
    )
    .expect("first fingerprint");
    let second = operation_fingerprint(
        RepositoryToolOperationV1::Run,
        &source,
        &json!({"source_id": "source-1", "executable": "node", "args": ["second.js"]}),
    )
    .expect("second fingerprint");
    assert_ne!(first, second);
}

#[test]
fn conversation_capabilities_are_scoped_and_deterministic() {
    let master = format!("sha256:{}", "1".repeat(64));
    let first = derive_conversation_capability(&master, "conversation-a");
    assert_eq!(
        first,
        derive_conversation_capability(&master, "conversation-a")
    );
    assert_ne!(
        first,
        derive_conversation_capability(&master, "conversation-b")
    );
    assert_ne!(first, master);
}

#[cfg(unix)]
#[test]
fn repository_broker_socket_path_fits_darwin_limit() {
    use std::os::unix::ffi::OsStrExt;

    let directory = repository_broker_directory();
    let path = repository_broker_socket_path(&directory, u64::MAX);
    assert!(path.as_os_str().as_bytes().len() <= 103);
}

#[test]
fn unsafe_paths_and_credential_arguments_are_rejected() {
    let source_id = "source-1";
    assert!(operations::prepare(
        RepositoryToolOperationV1::Read,
        &json!({"source_id": source_id, "path": "../outside.txt"}),
    )
    .is_err());
    assert!(operations::prepare(
        RepositoryToolOperationV1::Run,
        &json!({
            "source_id": source_id,
            "executable": "git",
            "args": ["push", "origin", "main"]
        }),
    )
    .is_err());
    assert!(operations::prepare(
        RepositoryToolOperationV1::Run,
        &json!({
            "source_id": source_id,
            "executable": "sh",
            "args": ["-c", "echo unsafe"]
        }),
    )
    .is_err());
}

#[test]
fn repository_reads_and_patches_stay_inside_the_root() {
    let temporary = tempfile::tempdir().expect("temporary repository");
    let root = temporary.path();
    fs::write(root.join("notes.txt"), "first\nsecond\n").expect("fixture file");
    let init = Command::new("git")
        .args(["init", "--quiet"])
        .current_dir(root)
        .status()
        .expect("git available");
    assert!(init.success());

    let tree = operations::execute(
        root,
        RepositoryToolOperationV1::Tree,
        &json!({"source_id": "source-1", "depth": 4}),
    )
    .expect("bounded tree inventory");
    assert_eq!(tree.content, "notes.txt");

    let search = operations::execute(
        root,
        RepositoryToolOperationV1::Search,
        &json!({"source_id": "source-1", "query": "second", "limit": 20}),
    )
    .expect("streaming repository search");
    assert_eq!(search.content, "notes.txt:2:second");

    let read = operations::execute(
        root,
        RepositoryToolOperationV1::Read,
        &json!({"source_id": "source-1", "path": "notes.txt", "limit": 20}),
    )
    .expect("safe read");
    assert_eq!(read.content, "1:first\n2:second");

    let patch = "--- a/notes.txt\n+++ b/notes.txt\n@@ -1,2 +1,2 @@\n first\n-second\n+changed\n";
    let applied = operations::execute(
        root,
        RepositoryToolOperationV1::ApplyPatch,
        &json!({"source_id": "source-1", "patch": patch}),
    )
    .expect("safe patch");
    assert_eq!(applied.changed_path_count, 1);
    assert_eq!(
        fs::read_to_string(root.join("notes.txt")).expect("patched file"),
        "first\nchanged\n"
    );

    for args in [
        ["config", "user.email", "repository-bridge@example.invalid"],
        ["config", "user.name", "Repository Bridge Test"],
        ["add", "notes.txt", ""],
    ] {
        let args = args.into_iter().filter(|value| !value.is_empty());
        assert!(Command::new("git")
            .args(args)
            .current_dir(root)
            .status()
            .expect("git fixture command")
            .success());
    }
    assert!(Command::new("git")
        .args(["commit", "--quiet", "-m", "fixture"])
        .current_dir(root)
        .status()
        .expect("fixture commit")
        .success());
    fs::rename(root.join("notes.txt"), root.join("renamed.txt")).expect("rename fixture");
    fs::write(root.join(".env"), "TOKEN=excluded\n").expect("excluded fixture");
    assert!(operations::execute(
        root,
        RepositoryToolOperationV1::Commit,
        &json!({"source_id": "source-1", "message": "must fail closed"}),
    )
    .is_err());
    fs::remove_file(root.join(".env")).expect("remove excluded fixture");
    let committed = operations::execute(
        root,
        RepositoryToolOperationV1::Commit,
        &json!({"source_id": "source-1", "message": "Rename notes"}),
    )
    .expect("local rename commit");
    assert_eq!(committed.changed_path_count, 2);
    assert!(!committed
        .content
        .contains(&root.to_string_lossy().to_string()));
}
