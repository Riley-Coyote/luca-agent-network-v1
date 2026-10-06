use super::*;

const TARGET: &str = "f8fc9abe-d9b6-4e0f-8650-87e6a3b260e0";
const SENDER: &str = "99ab90da-846a-4416-8a68-bf114c222777";
const ACK: &str = "a850a1fa-4471-4026-a27c-2aa20b74e5c0";
const BODY: &str = "PRIVATE_OWNER_PEER_MESSAGE_SENTINEL\nExact second line.";
const ADDRESS: &str = "fixture-receiver [071260]";

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("polyphonic-peer-test-{}", uuid::Uuid::new_v4()));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&path).unwrap();
        Self(path)
    }

    fn metadata(&self) -> Metadata {
        #[cfg(unix)]
        let uid = {
            use std::os::unix::fs::MetadataExt;
            fs::metadata(&self.0).unwrap().uid()
        };
        #[cfg(not(unix))]
        let uid = 0;
        Metadata {
            version: 1,
            generation: uuid::Uuid::new_v4().to_string(),
            owner_uid: uid,
            expires_at_ms: now_ms().unwrap() + 180_000,
            sender_session_id: Some(SENDER.into()),
            target_session_id: TARGET.into(),
            target_pid: 12345,
            target_name: "fixture-receiver".into(),
            canonical_cwd: self.0.to_string_lossy().into_owned(),
            native_cli: "/bin/sh".into(),
            native_permission_mode: "default".into(),
            body_sha256: sha256(BODY),
            list_call_id: None,
            qualified_address: None,
            send_call_id: None,
            acknowledgement_id: None,
            acknowledgement_ambiguous: false,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        for name in ["native-cli", "link", "hardlink"] {
            let _ = fs::remove_file(self.0.join(name));
        }
        let _ = fs::remove_dir(&self.0);
    }
}

fn native_snapshot(metadata: &Metadata) -> Value {
    json!([{"sessionId":TARGET,"pid":12345,"name":"fixture-receiver","cwd":metadata.canonical_cwd,
        "kind":"interactive","status":"idle"}])
}

fn event(metadata: &Metadata, hook: &str, tool: &str, id: &str) -> Value {
    json!({"hook_event_name":hook,"session_id":SENDER,"cwd":metadata.canonical_cwd,
        "permission_mode":metadata.native_permission_mode,"tool_name":tool,"tool_use_id":id,"tool_input":{}})
}

fn listed(metadata: &mut Metadata) {
    let pre = event(metadata, "PreToolUse", "ListAgents", "list-1");
    let output = apply_hook(metadata, &pre).unwrap();
    assert!(output["hookSpecificOutput"]
        .get("permissionDecision")
        .is_none());
    let mut post = event(metadata, "PostToolUse", "ListAgents", "list-1");
    post["tool_response"] = json!({"listing":format!("This session is fixture-courier [abcdef]\n  {ADDRESS}  ·  interactive  ·  idle  ·  started 2m ago\n")});
    apply_hook(metadata, &post).unwrap();
}

fn send_event(metadata: &Metadata, hook: &str) -> Value {
    let mut input = event(metadata, hook, "SendMessage", "send-1");
    input["tool_input"] = json!({"to":ADDRESS,"message":BODY});
    input
}

#[test]
fn one_exact_native_send_is_rewritten_without_grant_or_legacy_fields() {
    let fixture = Fixture::new();
    let mut metadata = fixture.metadata();
    metadata
        .validate(&metadata.generation, metadata.owner_uid)
        .unwrap();
    listed(&mut metadata);
    let mut pre = send_event(&metadata, "PreToolUse");
    for key in ["recipient", "content", "type", "notify_when_idle"] {
        pre["tool_input"][key] = json!("LEGACY_UNAPPROVED_VALUE");
    }
    let output = apply_hook(&mut metadata, &pre).unwrap();
    assert_eq!(
        output["hookSpecificOutput"]["updatedInput"],
        json!({"to":ADDRESS,"message":BODY})
    );
    assert!(output["hookSpecificOutput"]
        .get("permissionDecision")
        .is_none());
    let mut post = send_event(&metadata, "PostToolUse");
    post["tool_response"] =
        json!({"success":true,"msg_id":ACK,"message":BODY,"display":"held in native inbox"});
    apply_hook(&mut metadata, &post).unwrap();
    assert_eq!(metadata.acknowledgement_id.as_deref(), Some(ACK));
    let encoded = serde_json::to_string(&metadata).unwrap();
    assert!(!encoded.contains(BODY));
    assert!(!encoded.contains("held in native inbox"));
    assert!(!encoded.contains("LEGACY_UNAPPROVED_VALUE"));
    assert_eq!(metadata.body_sha256, sha256(BODY));
}

#[test]
fn public_catalogue_rejects_replacement_rename_waiting_ambiguity_and_unknown_rows() {
    let fixture = Fixture::new();
    let metadata = fixture.metadata();
    let snapshot = native_snapshot(&metadata);
    exact_live_target(&snapshot, &metadata).unwrap();
    for (key, value) in [
        ("sessionId", json!(SENDER)),
        ("pid", json!(12346)),
        ("name", json!("renamed")),
        ("cwd", json!("/different")),
        ("kind", json!("background")),
        ("status", json!("waiting")),
        ("status", json!("unknown")),
        ("pid", json!(0)),
        ("sessionId", json!("--last")),
    ] {
        let mut invalid = snapshot.clone();
        invalid[0][key] = value;
        assert!(
            exact_live_target(&invalid, &metadata).is_err(),
            "accepted changed {key}"
        );
    }
    for invalid in [json!([]), json!({}), json!([{}]), json!(["unknown"])] {
        assert!(exact_live_target(&invalid, &metadata).is_err());
    }
    let mut duplicate = snapshot.clone();
    duplicate.as_array_mut().unwrap().push(snapshot[0].clone());
    assert!(exact_live_target(&duplicate, &metadata).is_err());
    duplicate[1]["sessionId"] = json!(SENDER);
    assert!(
        exact_live_target(&duplicate, &metadata).is_err(),
        "duplicate native name cannot prove a UUID mapping"
    );
}

#[test]
fn unrelated_native_waiting_or_background_rows_do_not_disable_idle_receiver() {
    let fixture = Fixture::new();
    let metadata = fixture.metadata();
    for (kind, status) in [
        ("interactive", "waiting"),
        ("background", "working"),
        ("background", "blocked"),
    ] {
        let mut snapshot = native_snapshot(&metadata);
        let unrelated = json!({"sessionId":SENDER,"name":"unrelated-session",
            "cwd":metadata.canonical_cwd,"kind":kind,"status":status});
        snapshot.as_array_mut().unwrap().push(unrelated);
        exact_live_target(&snapshot, &metadata).unwrap();
        snapshot[1]["pid"] = Value::Null;
        exact_live_target(&snapshot, &metadata).unwrap();
        for invalid_pid in [json!(0), json!(-1), json!("123"), json!(u64::MAX)] {
            snapshot[1]["pid"] = invalid_pid;
            assert!(exact_live_target(&snapshot, &metadata).is_err());
        }
        let mut selected = native_snapshot(&metadata);
        selected[0]["status"] = json!(status);
        assert!(exact_live_target(&selected, &metadata).is_err());
        selected[0]["status"] = json!("idle");
        selected[0].as_object_mut().unwrap().remove("pid");
        assert!(exact_live_target(&selected, &metadata).is_err());
    }
}

#[test]
fn hook_manual_alias_matches_default_without_accepting_unknown_or_changed_policy() {
    let fixture = Fixture::new();
    let metadata = fixture.metadata();
    let mut hook = event(&metadata, "PreToolUse", "ListAgents", "list-1");
    hook["permission_mode"] = json!("manual");
    apply_hook(&mut metadata.clone(), &hook).unwrap();
    for mode in ["unknown", "auto", "bypassPermissions", "Manual", "default "] {
        hook["permission_mode"] = json!(mode);
        assert!(apply_hook(&mut metadata.clone(), &hook).is_err());
    }
}

#[test]
fn native_listing_requires_one_full_exact_provider_qualified_live_address() {
    let text = format!("  {ADDRESS}  ·  interactive  ·  idle  ·  started 2m ago");
    assert_eq!(
        qualified_address(&json!({"listing":text}), "fixture-receiver").unwrap(),
        ADDRESS
    );
    for text in [
        "fixture-receiver",
        "@071260",
        TARGET,
        "fixture-receiver [07126] · interactive · idle",
        "fixture-receiver [071260x] · interactive · idle",
        "fixture-receiver [071260] · interactive · waiting",
        "fixture-receiver [071260] · background · idle",
        "fixture-receiver-prefix [071260] · interactive · idle",
        "renamed [071260] · interactive · idle",
    ] {
        assert!(qualified_address(&json!({"listing":text}), "fixture-receiver").is_err());
    }
    let duplicate = format!("{ADDRESS} · interactive · idle\n{ADDRESS} · interactive · idle");
    assert!(qualified_address(&json!({"listing":duplicate}), "fixture-receiver").is_err());
    assert!(
        qualified_address(&json!({"listing":text,"unknown":true}), "fixture-receiver").is_err()
    );
}

#[test]
fn busy_receiver_preserves_exact_identity_address_mode_and_message_guards() {
    let fixture = Fixture::new();
    let mut metadata = fixture.metadata();
    let mut snapshot = native_snapshot(&metadata);
    snapshot[0]["status"] = json!("busy");
    exact_live_target(&snapshot, &metadata).unwrap();
    let listing = json!({"listing":format!("{ADDRESS} · interactive · busy · started 2m ago")});
    assert_eq!(
        qualified_address(&listing, &metadata.target_name).unwrap(),
        ADDRESS
    );
    let pre_list = event(&metadata, "PreToolUse", "ListAgents", "list-1");
    apply_hook(&mut metadata, &pre_list).unwrap();
    let mut post_list = event(&metadata, "PostToolUse", "ListAgents", "list-1");
    post_list["tool_response"] = listing;
    apply_hook(&mut metadata, &post_list).unwrap();
    let pre_send = send_event(&metadata, "PreToolUse");
    assert!(apply_hook(&mut metadata.clone(), &pre_send).is_ok());
    for (field, value) in [
        ("pid", json!(12346)),
        ("name", json!("renamed")),
        ("cwd", json!("/different")),
        ("kind", json!("background")),
        ("status", json!("waiting")),
        ("status", json!("unknown")),
    ] {
        let mut changed = snapshot.clone();
        changed[0][field] = value;
        assert!(exact_live_target(&changed, &metadata).is_err());
    }
    let mut changed_mode = pre_send.clone();
    changed_mode["permission_mode"] = json!("bypassPermissions");
    assert!(apply_hook(&mut metadata.clone(), &changed_mode).is_err());
    let mut changed_body = pre_send;
    changed_body["tool_input"]["message"] = json!("rewritten owner message");
    assert!(apply_hook(&mut metadata, &changed_body).is_err());
}

#[test]
fn message_hash_and_exact_recipient_prevent_native_fallback_or_model_rewrites() {
    let fixture = Fixture::new();
    let mut metadata = fixture.metadata();
    listed(&mut metadata);
    for recipient in [
        "fixture-receiver",
        "@071260",
        TARGET,
        "fixture-receiver [071261]",
        "other [071260]",
    ] {
        let mut input = send_event(&metadata, "PreToolUse");
        input["tool_input"]["to"] = json!(recipient);
        let mut current = metadata.clone();
        assert!(apply_hook(&mut current, &input).is_err());
        assert!(current.send_call_id.is_none());
    }
    for message in [
        BODY.replace('\n', " "),
        format!("{BODY}\n"),
        BODY.to_lowercase(),
        String::new(),
    ] {
        let mut input = send_event(&metadata, "PreToolUse");
        input["tool_input"]["message"] = json!(message);
        assert!(apply_hook(&mut metadata.clone(), &input).is_err());
    }
}

#[test]
fn sender_tool_generation_owner_expiry_and_policy_are_bound_without_substitution() {
    let fixture = Fixture::new();
    let metadata = fixture.metadata();
    let input = event(&metadata, "PreToolUse", "ListAgents", "list-1");
    for (field, value) in [
        ("session_id", json!(TARGET)),
        ("cwd", json!("/different")),
        ("permission_mode", json!("bypassPermissions")),
        ("tool_name", json!("Bash")),
        ("tool_use_id", json!("bad\ncontrol")),
        ("hook_event_name", json!("Stop")),
    ] {
        let mut changed = input.clone();
        changed[field] = value;
        assert!(apply_hook(&mut metadata.clone(), &changed).is_err());
    }
    assert!(metadata
        .validate(&uuid::Uuid::new_v4().to_string(), metadata.owner_uid)
        .is_err());
    assert!(metadata
        .validate(&metadata.generation, metadata.owner_uid.saturating_add(1))
        .is_err());
    let mut expired = metadata.clone();
    expired.expires_at_ms = now_ms().unwrap().saturating_sub(1);
    assert!(expired
        .validate(&expired.generation, expired.owner_uid)
        .is_err());
    let mut unknown = metadata.clone();
    unknown.native_permission_mode = "unknown".into();
    assert!(unknown
        .validate(&unknown.generation, unknown.owner_uid)
        .is_err());
    let mut self_target = metadata.clone();
    self_target.sender_session_id = Some(TARGET.into());
    assert!(self_target
        .validate(&self_target.generation, self_target.owner_uid)
        .is_err());
}

#[test]
fn list_and_send_are_one_shot_and_ack_must_match_exact_tool_call() {
    let fixture = Fixture::new();
    let mut metadata = fixture.metadata();
    assert!(apply_hook(
        &mut metadata,
        &send_event(&fixture.metadata(), "PreToolUse")
    )
    .is_err());
    listed(&mut metadata);
    let repeat = event(&metadata, "PreToolUse", "ListAgents", "list-2");
    assert!(apply_hook(&mut metadata, &repeat).is_err());
    let pre = send_event(&metadata, "PreToolUse");
    apply_hook(&mut metadata, &pre).unwrap();
    assert!(apply_hook(&mut metadata, &pre).is_err());
    let mut post = send_event(&metadata, "PostToolUse");
    post["tool_response"] = json!({"success":true,"msg_id":ACK});
    post["tool_use_id"] = json!("sibling-send");
    assert!(apply_hook(&mut metadata, &post).is_err());
    assert!(metadata.acknowledgement_id.is_none());
    post["tool_use_id"] = json!("send-1");
    apply_hook(&mut metadata, &post).unwrap();
    assert!(apply_hook(&mut metadata, &post).is_err());
    assert!(metadata.acknowledgement_ambiguous);
}

#[test]
fn native_ack_is_structured_success_uuid_not_assistant_prose_or_hold_inference() {
    for response in [
        json!({"success":true,"msg_id":ACK,"display":"held"}),
        json!([{"type":"text","text":format!("{{\"success\":true,\"msg_id\":\"{ACK}\"}}") }]),
    ] {
        assert_eq!(success_ack(&response).unwrap(), ACK);
    }
    for response in [
        json!("I delivered the message."),
        json!({"success":false,"msg_id":ACK}),
        json!({"success":true,"msg_id":"not-a-uuid"}),
        json!({"success":"true","msg_id":ACK}),
        json!({"success":true}),
        json!({"msg_id":ACK}),
        json!([{"type":"text","text":format!("{{\"success\":true,\"msg_id\":\"{ACK}\"}}\n{{\"success\":true,\"msg_id\":\"{SENDER}\"}}") }]),
    ] {
        assert!(success_ack(&response).is_err());
    }
}

#[cfg(unix)]
#[test]
fn private_metadata_is_mode_checked_symlink_hardlink_and_stale_generation_safe() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let state = PrivateState::create(fixture.metadata()).unwrap();
    let parent = state.path.parent().unwrap();
    assert_eq!(
        fs::metadata(parent).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(&state.path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert!(acquire(&state.path, &uuid::Uuid::new_v4().to_string(), state.uid).is_err());
    fs::set_permissions(&state.path, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(acquire(&state.path, &state.generation, state.uid).is_err());
    fs::set_permissions(&state.path, fs::Permissions::from_mode(0o600)).unwrap();
    fs::hard_link(&state.path, fixture.0.join("hardlink")).unwrap();
    assert!(acquire(&state.path, &state.generation, state.uid).is_err());
    fs::remove_file(fixture.0.join("hardlink")).unwrap();
    std::os::unix::fs::symlink(&state.path, fixture.0.join("link")).unwrap();
    assert!(secure_file(&fixture.0.join("link"), state.uid).is_err());
    let held = acquire(&state.path, &state.generation, state.uid).unwrap();
    assert!(acquire(&state.path, &state.generation, state.uid).is_err());
    drop(held);
    let parent = parent.to_owned();
    drop(state);
    assert!(!parent.exists());
}

#[cfg(unix)]
#[test]
fn ack_is_read_from_private_state_and_cleanup_never_retains_message_bodies() {
    let fixture = Fixture::new();
    let state = PrivateState::create(fixture.metadata()).unwrap();
    assert!(state.acknowledgement().is_err());
    {
        let (_guard, mut file, mut metadata) =
            acquire(&state.path, &state.generation, state.uid).unwrap();
        listed(&mut metadata);
        let pre = send_event(&metadata, "PreToolUse");
        apply_hook(&mut metadata, &pre).unwrap();
        let mut post = send_event(&metadata, "PostToolUse");
        post["tool_response"] = json!({"success":true,"msg_id":ACK});
        apply_hook(&mut metadata, &post).unwrap();
        save(&mut file, &metadata).unwrap();
    }
    assert_eq!(state.acknowledgement().unwrap(), ACK);
    let bytes = fs::read(&state.path).unwrap();
    assert!(!String::from_utf8(bytes)
        .unwrap()
        .contains("PRIVATE_OWNER_PEER_MESSAGE_SENTINEL"));
    let path = state.path.clone();
    drop(state);
    assert!(!path.exists());
}

#[cfg(unix)]
#[tokio::test]
async fn fake_native_hook_rechecks_original_receiver_and_closes_replaced_target() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let mut metadata = fixture.metadata();
    let executable = fixture.0.join("native-cli");
    let snapshot = native_snapshot(&metadata);
    fs::write(
        &executable,
        format!(
            "#!/bin/sh\nprintf '%s\\n' '{}'\n",
            serde_json::to_string(&snapshot).unwrap()
        ),
    )
    .unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
    metadata.native_cli = executable.to_string_lossy().into_owned();
    let state = PrivateState::create(metadata.clone()).unwrap();
    let args = RuntimeMessageHookArgs {
        metadata: state.path.clone(),
        generation: state.generation.clone(),
    };
    let pre_list = event(&metadata, "PreToolUse", "ListAgents", "list-1");
    hook_operation(&args, &pre_list).await.unwrap();
    let mut post_list = event(&metadata, "PostToolUse", "ListAgents", "list-1");
    post_list["tool_response"] = json!({"listing":format!("{ADDRESS} · interactive · idle")});
    hook_operation(&args, &post_list).await.unwrap();
    let mut changed = snapshot;
    changed[0]["pid"] = json!(12346);
    fs::write(
        &executable,
        format!(
            "#!/bin/sh\nprintf '%s\\n' '{}'\n",
            serde_json::to_string(&changed).unwrap()
        ),
    )
    .unwrap();
    let pre_send = send_event(&metadata, "PreToolUse");
    assert!(hook_operation(&args, &pre_send).await.is_err());
    let (_guard, _file, metadata) = acquire(&state.path, &state.generation, state.uid).unwrap();
    assert!(metadata.send_call_id.is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn fake_acp_wire_uses_only_ephemeral_native_options_no_identity_system_or_mcp_tools() {
    let fixture = Fixture::new();
    let state = PrivateState::create(fixture.metadata()).unwrap();
    let meta = session_metadata(&state, Path::new("/bin/sh"), "default").unwrap();
    let script = format!(
        r#"IFS= read -r INIT || exit 2
printf '%s\n' '{{"jsonrpc":"2.0","id":0,"result":{{}}}}'
IFS= read -r NEW || exit 3
printf '{{"jsonrpc":"2.0","id":1,"result":{{"sessionId":"{SENDER}","wireNew":%s}}}}\n' "$NEW"
"#
    );
    let mut client = AcpClient::spawn("/bin/sh", &["-c".into(), script], &[], false)
        .await
        .unwrap();
    client.deny_unmanaged_permissions();
    client.initialize().await.unwrap();
    let session = client
        .session_new_full_with_meta(&fixture.0.to_string_lossy(), Vec::new(), None, Some(meta))
        .await
        .unwrap();
    client.shutdown().await;
    let params = &session.raw["wireNew"]["params"];
    assert_eq!(params["mcpServers"], json!([]));
    assert!(params.get("systemPrompt").is_none());
    let options = &params["_meta"]["claudeCode"]["options"];
    assert_eq!(options["tools"], json!(["ListAgents", "SendMessage"]));
    assert_eq!(options["persistSession"], false);
    assert_eq!(options["permissionMode"], "default");
    assert!(options.get("allowedTools").is_none());
    assert!(options.get("canUseTool").is_none());
    assert!(
        options.get("hooks").is_none(),
        "native command hooks must not use SDK callback-hook shape"
    );
    assert!(options["extraArgs"].get("strict-mcp-config").is_some());
    assert!(!serde_json::to_string(options)
        .unwrap()
        .contains("PRIVATE_OWNER_PEER_MESSAGE_SENTINEL"));
}

#[cfg(unix)]
#[tokio::test]
async fn fake_acp_sender_mode_is_explicitly_acknowledged_before_any_prompt() {
    let expected = json!({"jsonrpc":"2.0","id":2,"method":"session/set_config_option",
        "params":{"sessionId":SENDER,"configId":"mode","value":"default"}});
    for variant in 0..4 {
        let config = match variant {
            0 => json!({"configOptions":[{"id":"mode","currentValue":"default"}]}),
            1 => json!({"configOptions":[{"id":"mode","currentValue":"auto"}]}),
            2 => json!({}),
            _ => {
                json!({"configOptions":[{"id":"mode","currentValue":"default"},{"configId":"mode","currentValue":"default"}]})
            }
        };
        let response = json!({"jsonrpc":"2.0","id":2,"result":config});
        let script = format!(
            r#"IFS= read -r INIT || exit 2
printf '%s\n' '{{"jsonrpc":"2.0","id":0,"result":{{}}}}'
IFS= read -r NEW || exit 3
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"sessionId":"{SENDER}","modes":{{"currentModeId":"auto"}}}}}}'
IFS= read -r MODE || exit 4
EXPECTED='{}'
if [ "$MODE" != "$EXPECTED" ]; then exit 5; fi
printf '%s\n' '{}'
{}"#,
            serde_json::to_string(&expected).unwrap(),
            serde_json::to_string(&response).unwrap(),
            if variant == 0 {
                "IFS= read -r PROMPT || exit 6\nprintf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"stopReason\":\"end_turn\"}}'\n"
            } else {
                "exit 0\n"
            }
        );
        let mut client = AcpClient::spawn("/bin/sh", &["-c".into(), script], &[], false)
            .await
            .unwrap();
        client.deny_unmanaged_permissions();
        client.initialize().await.unwrap();
        let session = client
            .session_new_full("/synthetic", Vec::new(), None)
            .await
            .unwrap();
        assert_eq!(session.raw["modes"]["currentModeId"], "auto");
        let mode = tokio::time::timeout(
            Duration::from_secs(5),
            set_sender_mode(&mut client, &session.session_id, "default"),
        )
        .await
        .unwrap();
        assert_eq!(mode.is_ok(), variant == 0);
        if variant == 0 {
            let stop = client
                .session_prompt_with_idle_timeout(
                    &session.session_id,
                    "SYNTHETIC_NO_MODEL",
                    Duration::from_secs(5),
                    Duration::from_secs(5),
                )
                .await
                .unwrap();
            assert_eq!(stop, crate::acp::StopReason::EndTurn);
        }
        tokio::time::timeout(Duration::from_secs(5), client.shutdown())
            .await
            .expect("fake sender shutdown is bounded");
        assert!(client.owned_process_id().is_none());
    }
}
