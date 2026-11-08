use super::*;

#[test]
fn saved_codex_permissions_are_latest_native_evidence_and_revalidated() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    let header = fixture.codex_header(SESSION_ID, &fixture.working_folder, "exec", "codex_exec");
    fixture.write(&header);
    let target = fixture.resolve().unwrap();
    target.require_saved_codex_cli().unwrap();
    fixture.write(header.trim_end());
    assert!(fixture
        .resolve()
        .unwrap()
        .require_saved_codex_cli()
        .is_err());
    fixture.write(&header);
    assert_eq!(
        serde_json::to_value(&target.codex_policy).unwrap(),
        serde_json::json!({"approval_policy":"never","approvals_reviewer":"user","sandbox_policy":{"type":"read-only"}})
    );
    let changed = serde_json::json!({"type":"turn_context","payload":{"cwd":fixture.working_folder,"approval_policy":"on-request","sandbox_policy":{"type":"workspace-write","writable_roots":[],"network_access":false}}});
    fixture.write(&format!("{header}{changed}\n"));
    fails(
        revalidate_connected_session_target(&fixture.source, &target, None, &HashSet::new()),
        "changed",
    );
    let unknown = serde_json::json!({"type":"turn_context","payload":{"cwd":fixture.working_folder,"approval_policy":{"granular":"unsupported"},"sandbox_policy":{"type":"read-only"}}});
    fixture.write(&format!("{header}{unknown}\n"));
    assert!(fixture
        .resolve()
        .unwrap()
        .require_saved_codex_cli()
        .is_err());
}

#[test]
fn saved_codex_profiles_and_reviewers_cannot_drop_native_restrictions() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    let header = fixture.codex_header(SESSION_ID, &fixture.working_folder, "exec", "codex_exec");
    let profile = serde_json::json!({"type":"managed","file_system":{"type":"restricted","entries":[{"path":{"type":"special","value":{"kind":"root"}},"access":"read"}]},"network":"restricted"});
    let mut row = serde_json::json!({"type":"turn_context","payload":{"cwd":fixture.working_folder,"approval_policy":"never","approvals_reviewer":"user","sandbox_policy":{"type":"read-only"},"permission_profile":profile}});
    fixture.write(&format!("{header}{row}\n"));
    fixture
        .resolve()
        .unwrap()
        .require_saved_codex_cli()
        .unwrap();
    row["payload"]["permission_profile"]["file_system"]["entries"][0]["access"] =
        serde_json::json!("none");
    fixture.write(&format!("{header}{row}\n"));
    assert!(fixture
        .resolve()
        .unwrap()
        .require_saved_codex_cli()
        .is_err());
    row["payload"]["permission_profile"] = profile;
    for policy in ["on-request", "untrusted", "on-failure"] {
        row["payload"]["approval_policy"] = serde_json::json!(policy);
        fixture.write(&format!("{header}{row}\n"));
        assert!(fixture
            .resolve()
            .unwrap()
            .require_saved_codex_cli()
            .is_err());
    }
    row["payload"]["approval_policy"] = serde_json::json!("never");
    row["payload"]["approvals_reviewer"] = serde_json::json!("auto_review");
    fixture.write(&format!("{header}{row}\n"));
    assert!(fixture
        .resolve()
        .unwrap()
        .require_saved_codex_cli()
        .is_err());
}

#[test]
fn standard_workspace_profile_keeps_temp_network_and_protected_paths_exact() {
    use serde_json::json;
    let cwd = Path::new("/synthetic/workspace");
    let policy = serde_json::from_value(json!({"approval_policy":"never","sandbox_policy":{"type":"workspace-write","writable_roots":[],"network_access":false,"exclude_tmpdir_env_var":false,"exclude_slash_tmp":false}})).unwrap();
    let mut entries = vec![
        json!({"path":{"type":"special","value":{"kind":"root"}},"access":"read"}),
        json!({"path":{"type":"path","path":cwd},"access":"write"}),
        json!({"path":{"type":"special","value":{"kind":"slash_tmp"}},"access":"write"}),
        json!({"path":{"type":"special","value":{"kind":"tmpdir"}},"access":"write"}),
    ];
    for name in [".git", ".agents", ".codex", ".aws"] {
        entries.push(json!({"path":{"type":"path","path":cwd.join(name)},"access":"read","missing_path_behavior":"skip"}));
    }
    let mut profile = json!({"type":"managed","file_system":{"type":"restricted","entries":entries},"network":"restricted"});
    assert!(native_policy::standard_codex_profile(
        Some(&profile),
        &policy,
        cwd
    ));
    profile["file_system"]["entries"]
        .as_array_mut()
        .unwrap()
        .reverse();
    assert!(native_policy::standard_codex_profile(
        Some(&profile),
        &policy,
        cwd
    ));
    profile["file_system"]["entries"]
        .as_array_mut()
        .unwrap()
        .pop();
    assert!(!native_policy::standard_codex_profile(
        Some(&profile),
        &policy,
        cwd
    ));
    profile["network"] = json!("enabled");
    assert!(!native_policy::standard_codex_profile(
        Some(&profile),
        &policy,
        cwd
    ));
}
