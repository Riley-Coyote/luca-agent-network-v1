use super::*;
use serde_json::json;

const SESSION: &str = "00000000-0000-4000-8000-000000000001";
const MODEL: &str = "claude-synthetic-model-20261112";

fn init() -> Value {
    json!({"type":"system","subtype":"init","session_id":SESSION,"model":MODEL,"tools":[],"mcp_servers":[],"apiKeySource":"ANTHROPIC_API_KEY"})
}
fn result(cost: f64) -> Value {
    json!({"type":"result","subtype":"success","session_id":SESSION,"is_error":false,"result":"First line\n\n雪 — last line\n","total_cost_usd":cost,"usage":{"input_tokens":10,"output_tokens":12},"modelUsage":{(MODEL):{"inputTokens":10,"outputTokens":12}}})
}

#[test]
fn exact_no_tool_init_and_completed_usage_are_required() {
    let mut events = Events::new(SESSION, MODEL);
    assert!(events.accept(&init().to_string()).unwrap());
    assert!(!events.accept(&result(0.12).to_string()).unwrap());
    let outcome = events.finish(true).unwrap();
    assert_eq!(outcome.text, "First line\n\n雪 — last line\n");
    assert_eq!(outcome.cost, 0.12);
    assert!(Events::new(SESSION, MODEL)
        .accept(&result(0.12).to_string())
        .is_err());
}

#[test]
fn tool_model_account_or_session_substitution_never_completes() {
    for (field, value) in [
        ("tools", json!(["Bash"])),
        ("mcp_servers", json!([{"name":"foreign"}])),
        ("model", json!("substitute")),
        ("apiKeySource", json!("oauth")),
        ("session_id", json!("wrong")),
    ] {
        let mut frame = init();
        frame[field] = value;
        assert!(Events::new(SESSION, MODEL)
            .accept(&frame.to_string())
            .is_err());
    }
    let mut events = Events::new(SESSION, MODEL);
    events.accept(&init().to_string()).unwrap();
    assert!(events.accept(&json!({"type":"assistant","session_id":SESSION,"message":{"model":MODEL,"content":[{"type":"tool_use","name":"Bash"}]}}).to_string()).is_err());
}

#[test]
fn missing_usage_failed_exit_duplicate_terminal_and_truncation_fail_closed() {
    for field in ["usage", "modelUsage", "total_cost_usd"] {
        let mut events = Events::new(SESSION, MODEL);
        events.accept(&init().to_string()).unwrap();
        let mut terminal = result(0.1);
        terminal.as_object_mut().unwrap().remove(field);
        assert!(events.accept(&terminal.to_string()).is_err());
    }
    let mut events = Events::new(SESSION, MODEL);
    events.accept(&init().to_string()).unwrap();
    assert!(events.finish(true).is_err());
    let mut events = Events::new(SESSION, MODEL);
    events.accept(&init().to_string()).unwrap();
    events.accept(&result(0.1).to_string()).unwrap();
    assert!(events.accept(&result(0.1).to_string()).is_err());
    assert!(events.finish(false).is_err());
}

#[test]
fn already_completed_writing_and_actual_overage_are_not_hidden_or_retried() {
    let mut events = Events::new(SESSION, MODEL);
    events.accept(&init().to_string()).unwrap();
    events.accept(&result(0.31).to_string()).unwrap();
    let outcome = events.finish(true).unwrap();
    assert_eq!(outcome.cost, 0.31);
    assert_eq!(outcome.text, "First line\n\n雪 — last line\n");
}

#[test]
fn ordinary_native_and_resident_environments_cannot_reach_the_paid_command() {
    let command = base_command("/synthetic/claude", "/synthetic/private");
    let env: std::collections::BTreeMap<_, _> = command.as_std().get_envs().collect();
    for key in [
        BOOTSTRAP_KEY,
        "ANTHROPIC_API_KEY",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "NODE_OPTIONS",
        "CLAUDE_CONFIG_DIR",
        "LUCA_MANAGED_RESIDENT_PUBKEY",
        "BUZZ_PRIVATE_KEY",
    ] {
        assert!(!env.contains_key(std::ffi::OsStr::new(key)));
    }
    let input:RuntimeTaskInputV1=serde_json::from_value(json!({"taskId":"t","conversationId":"c","prompt":"雪\nexact","workingFolder":"/synthetic/private","permissionMode":"normal","options":{"purpose":"ask","model":MODEL},"claudeApiAsk":{"executable":"/synthetic/claude","maxBudgetUsd":"0.25"}})).unwrap();
    let command = ask_command(
        input.claude_api_ask.as_ref().unwrap(),
        &input,
        MODEL,
        SESSION,
        "SYNTHETIC_SECRET",
    );
    let args: Vec<_> = command.as_std().get_args().collect();
    assert!(args.windows(2).any(|pair| pair == ["--tools", ""]));
    assert!(!args
        .iter()
        .any(|arg| arg.to_string_lossy().contains("SYNTHETIC_SECRET")));
    assert!(!args.iter().any(|arg| arg.to_string_lossy().contains("雪")));
    assert!(args.iter().any(|arg| *arg == "--bare"));
    assert!(args.iter().any(|arg| *arg == "--disable-slash-commands"));
    assert!(!args.iter().any(|arg| *arg == "--fallback-model"));
    let env: std::collections::BTreeMap<_, _> = command.as_std().get_envs().collect();
    for key in [
        BOOTSTRAP_KEY,
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "CLAUDE_CONFIG_DIR",
        "OPENAI_API_KEY",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "NODE_OPTIONS",
    ] {
        assert!(!env.contains_key(std::ffi::OsStr::new(key)), "{key}");
    }
    for key in [
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
    ] {
        assert_eq!(
            env[std::ffi::OsStr::new(key)],
            Some(std::ffi::OsStr::new("0"))
        );
    }
    assert_eq!(
        env[std::ffi::OsStr::new("ANTHROPIC_BASE_URL")],
        Some(std::ffi::OsStr::new("https://api.anthropic.com"))
    );
}

#[test]
fn degraded_cli_capabilities_do_not_admit_a_paid_prompt() {
    let help = format!(
        "{}\nUse \"\" to disable all tools\n--effort",
        FLAGS.join("\n")
    );
    assert!(capabilities(&help, true));
    for flag in FLAGS {
        assert!(
            !capabilities(&help.replace(flag, "unsupported"), true),
            "{flag}"
        );
    }
    assert!(!capabilities(&help.replace("--effort", ""), true));
}

#[test]
fn duplicate_security_coordinates_and_unbounded_frames_are_rejected() {
    let duplicate =
        init()
            .to_string()
            .replacen("\"tools\":[]", "\"tools\":[\"Bash\"],\"tools\":[]", 1);
    assert!(Events::new(SESSION, MODEL).accept(&duplicate).is_err());
    let mut events = Events::new(SESSION, MODEL);
    events.bytes = MAX_TOTAL;
    assert!(events.accept(&init().to_string()).is_err());
}

#[test]
fn rejected_model_provider_error_and_changed_billing_model_never_complete() {
    for subtype in [
        "error_during_execution",
        "error_max_budget_usd",
        "error_max_turns",
    ] {
        let mut events = Events::new(SESSION, MODEL);
        events.accept(&init().to_string()).unwrap();
        let mut terminal = result(0.01);
        terminal["subtype"] = json!(subtype);
        terminal["is_error"] = json!(true);
        assert!(events.accept(&terminal.to_string()).is_err());
        assert!(events.finish(true).is_err());
    }
    let mut events = Events::new(SESSION, MODEL);
    events.accept(&init().to_string()).unwrap();
    let mut terminal = result(0.01);
    terminal["modelUsage"] = json!({"substitute-model":{"inputTokens":10,"outputTokens":12}});
    assert!(events.accept(&terminal.to_string()).is_err());
    assert!(events.finish(true).is_err());
}

#[tokio::test]
async fn owned_stream_transport_preserves_exact_prompt_and_result_line_breaks() {
    let input: RuntimeTaskInputV1 = serde_json::from_value(json!({
        "taskId":"t","conversationId":"c","prompt":"雪\n\nline three\n",
        "workingFolder":"/synthetic/private","permissionMode":"normal",
        "options":{"purpose":"ask","model":MODEL}
    }))
    .unwrap();
    let script = format!(
        r#"
IFS= read -r FIRST || exit 2
test "$FIRST" = '雪' || exit 3
IFS= read -r SECOND || exit 4
test -z "$SECOND" || exit 5
IFS= read -r THIRD || exit 6
test "$THIRD" = 'line three' || exit 7
if IFS= read -r EXTRA; then exit 8; fi
test -z "${{LUCA_RUNTIME_TASK_CLAUDE_API_KEY+x}}" || exit 9
test -z "${{BUZZ_PRIVATE_KEY+x}}" || exit 10
printf '%s\n' '{init}' '{result}'
"#,
        init = init(),
        result = result(0.1)
    );
    let mut command = base_command("/bin/sh", "/");
    command.args(["-c", &script]);
    let mut worker = OwnedWorker::spawn(command).unwrap();
    let outcome = consume(
        &mut worker.child,
        &input,
        SESSION,
        MODEL,
        Duration::from_secs(2),
    )
    .await
    .unwrap();
    assert_eq!(outcome.text, "First line\n\n雪 — last line\n");
    assert_eq!(outcome.cost, 0.1);
}
