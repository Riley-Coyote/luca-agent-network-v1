use super::*;

async fn script(code: &str) -> AcpClient {
    AcpClient::spawn("bash", &["-c".into(), code.into()], &[], false)
        .await
        .unwrap()
}

#[tokio::test]
async fn session_restore_negotiates_capabilities_and_preserves_session_id() {
    let mut client = script(r#"
        read -t 5 line
        echo '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"resume":{}}}}}'
        read -t 5 line
        echo '{"jsonrpc":"2.0","id":1,"result":{"_receivedRequest":'"$line"'}}'
        sleep 1
    "#).await;
    client.initialize().await.unwrap();
    assert!(client.supports_session_restore(false));
    assert!(client.supports_session_restore(true));
    let (restored, replayed) = client
        .session_restore_full_with_context(
            "existing-session",
            "/tmp/project",
            &["/tmp/extra".into()],
            vec![],
            Some("system"),
            Some(serde_json::json!({"strictMcpConfig":true})),
            false,
        )
        .await
        .unwrap();
    assert_eq!(restored.session_id, "existing-session");
    assert_eq!(replayed, 0);
    let request = &restored.raw["_receivedRequest"];
    assert_eq!(request["method"], "session/resume");
    assert_eq!(request["params"]["sessionId"], "existing-session");
    assert_eq!(request["params"]["cwd"], "/tmp/project");
    assert_eq!(
        request["params"]["additionalDirectories"],
        serde_json::json!(["/tmp/extra"])
    );
    assert_eq!(request["params"]["systemPrompt"], "system");
    assert_eq!(request["params"]["_meta"]["strictMcpConfig"], true);
    client.shutdown().await;
}

#[tokio::test]
async fn session_restore_load_replay_never_enters_observer_or_final_capture() {
    let mut client = script(r#"
        read -t 5 line
        echo '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true}}}'
        read -t 5 line
        echo '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"old-session","update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"OLD_PRIVATE_HISTORY"}}}}'
        echo '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"old-session","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"OLD_PRIVATE_HISTORY"}}}}'
        echo '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"old-session","update":{"sessionUpdate":"tool_call","toolCallId":"old-tool","title":"OLD_PRIVATE_HISTORY","status":"completed"}}}'
        echo '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"old-session","update":{"sessionUpdate":"available_commands_update","availableCommands":[{"name":"help","description":"Help"}]}}}'
        echo '{"jsonrpc":"2.0","id":1,"result":{}}'
        sleep 1
    "#).await;
    let observer = crate::observer::ObserverHandle::in_process();
    client.set_observer(Some(observer.clone()), 0);
    client.initialize().await.unwrap();
    client.begin_final_message_capture();
    let (restored, replayed) = client
        .session_restore_full_with_context("old-session", "/tmp", &[], vec![], None, None, true)
        .await
        .unwrap();
    assert_eq!(restored.session_id, "old-session");
    assert_eq!(replayed, 2);
    let observed = serde_json::to_string(&observer.snapshot()).unwrap();
    assert!(!observed.contains("OLD_PRIVATE_HISTORY"));
    assert!(client.is_advertised_command("/help"));
    client.shutdown().await;
}

#[tokio::test]
async fn session_restore_replay_permission_is_cancelled_without_user_prompt() {
    let mut client = script(r#"
        read -t 5 line
        echo '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true}}}'
        read -t 5 line
        echo '{"jsonrpc":"2.0","id":"replay-permission","method":"session/request_permission","params":{"sessionId":"old-session","options":[{"optionId":"allow","name":"Allow","kind":"allow_always"}]}}'
        read -t 5 answer
        echo '{"jsonrpc":"2.0","id":1,"result":{"permissionAnswer":'"$answer"'}}'
        sleep 1
    "#).await;
    client.initialize().await.unwrap();
    let (restored, _) = client
        .session_restore_full_with_context("old-session", "/tmp", &[], vec![], None, None, true)
        .await
        .unwrap();
    assert_eq!(
        restored.raw["permissionAnswer"]["result"]["outcome"]["outcome"],
        "cancelled"
    );
    client.shutdown().await;
}

#[tokio::test]
async fn session_restore_load_only_does_not_use_resume_on_silent_create_adapters() {
    let mut client = script(r#"
        read -t 5 line
        echo '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{"sessionCapabilities":{"resume":{}}}}}'
        sleep 1
    "#).await;
    client.initialize().await.unwrap();
    assert!(client.supports_session_restore(false));
    assert!(!client.supports_session_restore(true));
    assert!(matches!(client.session_restore_full_with_context(
        "old-session", "/tmp", &[], vec![], None, None, true,
    ).await, Err(AcpError::Protocol(_))));
    client.shutdown().await;
}

#[tokio::test]
async fn session_restore_rejects_substituted_session_id() {
    let mut client = script(r#"
        read -t 5 line
        echo '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true}}}'
        read -t 5 line
        echo '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"different-session"}}'
        sleep 1
    "#).await;
    client.initialize().await.unwrap();
    assert!(matches!(client.session_restore_full_with_context(
        "old-session", "/tmp", &[], vec![], None, None, true,
    ).await, Err(AcpError::Protocol(_))));
}

/// Opt-in native proof: two short model responses in a new disposable
/// conversation. No existing session ID is accepted from the environment.
#[tokio::test]
#[ignore = "uses an installed adapter and two short native model responses"]
async fn native_adapter_remembers_after_process_exit_and_workspace_change() {
    let adapter = std::env::var("LUCA_NATIVE_RESTORE_TEST_ADAPTER").expect("explicit adapter path");
    let node = std::env::var("LUCA_NATIVE_RESTORE_TEST_NODE").expect("explicit node path");
    let family = std::env::var("LUCA_NATIVE_RESTORE_TEST_FAMILY").expect("explicit runtime family");
    assert!(matches!(family.as_str(), "claude_code" | "codex"));
    assert!(std::path::Path::new(&adapter).is_file());
    assert!(std::path::Path::new(&node).is_file());
    let root = std::env::temp_dir().join(format!(
        "polyphonic-native-resume-proof-{}",
        uuid::Uuid::new_v4()
    ));
    let first_root = root.join("before");
    let next_root = root.join("after");
    std::fs::create_dir_all(&first_root).unwrap();
    std::fs::create_dir(&next_root).unwrap();
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let first_prompt = format!("This is a text-only session-persistence test. Do not use tools. Remember this verification code in our conversation: {nonce}. Reply only READY, without repeating the code.");
    let first =
        native_smoke_phase(&node, &adapter, &family, &first_root, None, &first_prompt).await;
    let outcome = match first {
        Ok((session, _)) => native_smoke_phase(&node, &adapter, &family, &next_root, Some(&session),
            "What verification code did I give you earlier in this same conversation? Reply only the code. Do not use tools. Do not guess if it is absent.").await
            .map(|(restored, answer)| (session, restored, answer)),
        Err(error) => Err(error),
    };
    let _ = std::fs::remove_dir_all(&root);
    let (original, restored, answer) = outcome.expect("native session restoration proof");
    assert_eq!(original, restored, "native session identity changed");
    assert!(
        answer.contains(&nonce),
        "restored native conversation did not recall the original code"
    );
    println!("NATIVE RESUME PROOF PASSED: {family}; same provider session; fresh process; changed workspace; original context recalled; all permission requests rejected.");
}

async fn native_smoke_phase(
    node: &str,
    adapter: &str,
    family: &str,
    cwd: &std::path::Path,
    previous_session: Option<&str>,
    prompt: &str,
) -> Result<(String, String), String> {
    let mut environment = vec![("RUST_LOG".to_owned(), "warn".to_owned())];
    if family == "claude_code" {
        if let Ok(cli) = std::env::var("LUCA_NATIVE_RESTORE_TEST_CLAUDE_CLI") {
            if !std::path::Path::new(&cli).is_file() {
                return Err("configured native Claude executable is absent".into());
            }
            environment.push(("CLAUDE_CODE_EXECUTABLE".into(), cli));
        }
    }
    if family == "codex" {
        // The adapter's native user-approval preset must be selected explicitly;
        // its default uses its own auto-reviewer. This is the Accept edits preset,
        // not a claim that the adapter enforces the startup read-only sandbox.
        environment.push(("INITIAL_AGENT_MODE".into(), "read-only".into()));
        environment.push((
            "CODEX_CONFIG".into(),
            serde_json::json!({
                "approval_policy":"on-request", "sandbox_mode":"read-only", "mcp_servers":{}
            })
            .to_string(),
        ));
    }
    let mut client = AcpClient::spawn(node, &[adapter.to_owned()], &environment, false)
        .await
        .map_err(|error| format!("start native adapter: {error}"))?;
    client.deny_unmanaged_permissions();
    let observer = crate::observer::ObserverHandle::in_process();
    client.set_observer(Some(observer.clone()), 0);
    let result = async {
        let initialized = client
            .initialize()
            .await
            .map_err(|error| format!("native initialize: {error}"))?;
        println!(
            "Native adapter connected: {}",
            initialized
                .pointer("/agentInfo/name")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
        );
        let metadata = if family == "claude_code" {
            Some(
                crate::continuity_runtime_policy::managed_claude_session_metadata(None, true)
                    .map_err(|error| error.to_string())?,
            )
        } else {
            None
        };
        let cwd = cwd.to_str().ok_or("test workspace is not UTF-8")?;
        let response = if let Some(session) = previous_session {
            client
                .session_restore_full_with_context(session, cwd, &[], vec![], None, metadata, false)
                .await
                .map_err(|error| format!("native resume: {error}"))?
                .0
        } else {
            client
                .session_new_full_with_context(cwd, &[], vec![], None, metadata)
                .await
                .map_err(|error| format!("native new session: {error}"))?
        };
        if family == "claude_code" {
            let acknowledged = client
                .session_set_config_option(&response.session_id, "mode", "default")
                .await
                .map_err(|error| format!("bind safe native permission mode: {error}"))?;
            if !acknowledged
                .get("configOptions")
                .and_then(|v| v.as_array())
                .is_some_and(|options| {
                    options
                        .iter()
                        .any(|option| option["id"] == "mode" && option["currentValue"] == "default")
                })
            {
                return Err(
                    "native adapter did not acknowledge the test's default permission mode".into(),
                );
            }
        }
        // Use an advertised Sonnet option rather than an expensive default for Claude.
        if family == "claude_code" {
            let options = extract_model_config_options(&response.raw);
            let sonnet = options
                .iter()
                .filter_map(|option| option.get("options").and_then(|v| v.as_array()))
                .flatten()
                .filter_map(|option| option.get("value").and_then(|v| v.as_str()))
                .find(|model| model.contains("sonnet"))
                .map(str::to_owned);
            if let Some(sonnet) = sonnet {
                if let Some(method) = resolve_model_switch_method(&response.raw, &sonnet) {
                    match method {
                        ModelSwitchMethod::ConfigOption {
                            config_id,
                            option_value,
                        } => {
                            client
                                .session_set_config_option(
                                    &response.session_id,
                                    &config_id,
                                    &option_value,
                                )
                                .await
                                .map_err(|e| e.to_string())?;
                        }
                        ModelSwitchMethod::SetModel { model_id } => {
                            client
                                .session_set_model(&response.session_id, &model_id)
                                .await
                                .map_err(|e| e.to_string())?;
                        }
                    }
                }
            }
        }
        if family == "codex" {
            bind_advertised_codex_test_model(&mut client, &response).await?;
        }
        client.begin_final_message_capture();
        let stopped = client
            .session_prompt_with_idle_timeout(
                &response.session_id,
                prompt,
                std::time::Duration::from_secs(90),
                std::time::Duration::from_secs(180),
            )
            .await
            .map_err(|error| format!("native prompt: {error}"))?;
        if !matches!(stopped, StopReason::EndTurn) {
            return Err("native prompt did not complete normally".to_owned());
        }
        let answer = client
            .take_final_message_draft(true)
            .ok_or("native answer missing")?
            .map_err(|error| format!("native answer capture: {error}"))?;
        Ok((response.session_id, answer))
    }
    .await;
    client.shutdown().await;
    if result.is_err() {
        for event in observer.snapshot() {
            if let Some(data) = event.payload.pointer("/error/data") {
                if let Some(message) = data
                    .as_str()
                    .filter(|message| message.contains("approval_policy"))
                {
                    // A setup-schema error, not an account or transcript response.
                    // Emit only the policy line; never dump configuration or credentials.
                    for line in message.lines().filter(|line| {
                        line.contains("approval_policy") || line.contains("expected one of")
                    }) {
                        if !line.contains("/")
                            && !line.to_ascii_lowercase().contains("token")
                            && line.len() < 500
                        {
                            println!("Native policy setup error: {line}");
                        }
                    }
                }
                let detail = data.to_string().to_ascii_lowercase();
                let classes = [
                    "enoent",
                    "not found",
                    "authentication",
                    "unauthorized",
                    "approval_policy",
                    "sandbox",
                    "config",
                    "spawn",
                    "model",
                    "mcp",
                    "permission",
                    "login",
                    "disabled",
                    "parse",
                    "invalid",
                    "trust",
                ]
                .into_iter()
                .filter(|class| detail.contains(class))
                .collect::<Vec<_>>();
                println!("Native setup diagnostic categories (no credentials or bodies): {classes:?}; object keys: {:?}",
                    data.as_object().map(|object| object.keys().collect::<Vec<_>>()));
            }
        }
    }
    result
}

/// The nonce appears only in a tool result, never in an owner prompt or final
/// answer. Removing the fixture before restore rules out re-reading it.
#[tokio::test]
#[ignore = "uses Codex in a new disposable conversation and cancels a short live turn"]
async fn native_codex_tool_history_survives_stop_and_process_restart() {
    let adapter = std::env::var("LUCA_NATIVE_RESTORE_TEST_ADAPTER").expect("explicit adapter");
    let node = std::env::var("LUCA_NATIVE_RESTORE_TEST_NODE").expect("explicit node");
    assert_eq!(
        std::env::var("LUCA_NATIVE_RESTORE_TEST_FAMILY").as_deref(),
        Ok("codex")
    );
    let root =
        std::env::temp_dir().join(format!("polyphonic-tool-resume-{}", uuid::Uuid::new_v4()));
    let before = root.join("before");
    let after = root.join("after");
    std::fs::create_dir_all(&before).unwrap();
    std::fs::create_dir(&after).unwrap();
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let fixture = before.join("verification.txt");
    std::fs::write(&fixture, &nonce).unwrap();
    let result = async {
        let (session, first) = native_smoke_phase(&node, &adapter, "codex", &before, None,
            "This is a session-persistence test. Read the local file verification.txt with a read-only tool. Retain its exact verification code in this conversation. Reply only READY. Do not quote the code, write files, or use the network.").await?;
        if first.contains(&nonce) || !first.contains("READY") {
            return Err(format!("tool-only proof was not established: {}", first.replace(&nonce,"[fixture-code]").chars().take(500).collect::<String>()));
        }
        std::fs::remove_file(&fixture).map_err(|_| "remove owned test fixture")?;
        native_codex_cancel_phase(&node, &adapter, &before, &session).await?;
        let (restored, answer) = native_smoke_phase(&node, &adapter, "codex", &after, Some(&session),
            "The counting request was cancelled. What exact verification code did you read from the file earlier in this conversation? The file has been removed. Answer from this session's history only, with the code alone; do not use tools or guess.").await?;
        if restored != session || !answer.contains(&nonce) {
            return Err("native tool-result history did not survive cancel and process replacement".to_owned());
        }
        Ok::<(),String>(())
    }.await;
    let _ = std::fs::remove_dir_all(&root);
    result.expect("tool-only context, Stop, and native restart acceptance");
    println!("CODEX TOOL/STOP/RESTART PASSED: tool-only nonce retained; original file removed; cancellation acknowledged; same provider ID; fresh process and workspace; no relay replay.");
}

async fn native_codex_cancel_phase(
    node: &str,
    adapter: &str,
    cwd: &std::path::Path,
    session: &str,
) -> Result<(), String> {
    let environment = vec![
        ("INITIAL_AGENT_MODE".into(), "read-only".into()),
        ("CODEX_CONFIG".into(), serde_json::json!({"approval_policy":"on-request","sandbox_mode":"read-only","mcp_servers":{}}).to_string()),
    ];
    let mut client = AcpClient::spawn(node, &[adapter.to_owned()], &environment, false)
        .await
        .map_err(|e| e.to_string())?;
    client.deny_unmanaged_permissions();
    let result = async {
        client.initialize().await.map_err(|e|e.to_string())?;
        let response = client.session_restore_full_with_context(session,cwd.to_str().ok_or("invalid fixture workspace")?,&[],vec![],None,None,false).await.map_err(|e|e.to_string())?.0;
        bind_advertised_codex_test_model(&mut client, &response).await?;
        let completed = tokio::select! {
            result = client.session_prompt_with_idle_timeout(session,
                "For a cancellation test, list integers 1 through 50000, one per line, as your answer. Do not use tools.",
                std::time::Duration::from_secs(30),std::time::Duration::from_secs(45)) => Some(result),
            _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => None,
        };
        if completed.is_some() || !client.has_in_flight_prompt() {
            return Err("test did not reach an in-flight cancellable turn".to_owned());
        }
        let stopped = client.cancel_with_cleanup_grace(session,std::time::Duration::from_secs(8)).await.map_err(|e|e.to_string())?;
        if !matches!(stopped, StopReason::Cancelled) { return Err("native cancellation was not acknowledged".to_owned()); }
        Ok(())
    }.await;
    client.shutdown().await;
    result
}

async fn bind_advertised_codex_test_model(
    client: &mut AcpClient,
    response: &SessionNewResponse,
) -> Result<(), String> {
    let options = extract_model_config_options(&response.raw);
    let choices = options
        .iter()
        .filter_map(|option| option.get("options").and_then(|value| value.as_array()))
        // The installed adapter prepends an unknown configured model with a
        // null description. That is not native-catalog evidence of support.
        .flatten()
        .filter(|option| {
            option
                .get("description")
                .is_some_and(|value| !value.is_null())
        })
        .filter_map(|option| option.get("value").and_then(|value| value.as_str()))
        .collect::<Vec<_>>();
    let selected = choices
        .iter()
        .copied()
        .find(|value| value.contains("mini"))
        .or_else(|| choices.first().copied())
        .ok_or("Codex advertised no test model")?;
    match resolve_model_switch_method(&response.raw, selected)
        .ok_or("test model cannot be bound")?
    {
        ModelSwitchMethod::ConfigOption {
            config_id,
            option_value,
        } => {
            client
                .session_set_config_option(&response.session_id, &config_id, &option_value)
                .await
                .map_err(|e| e.to_string())?;
        }
        ModelSwitchMethod::SetModel { model_id } => {
            client
                .session_set_model(&response.session_id, &model_id)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    println!("Native test uses an advertised Codex model: {selected}");
    Ok(())
}
