use super::*;

const SESSION: &str = "01a1083a-f0f0-76a3-b1d9-c0268a062636";

fn started() -> String {
    format!(r#"{{"type":"thread.started","thread_id":"{SESSION}"}}"#)
}

fn completed() -> &'static str {
    r#"{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}"#
}

fn final_message() -> &'static str {
    r#"{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"NATIVE_RESULT"}}"#
}

fn ready() -> CodexEvents<'static> {
    let mut events = CodexEvents::new(SESSION);
    assert_eq!(events.accept(&started()), Ok(Some(Progress::Session)));
    assert_eq!(events.accept(r#"{"type":"turn.started"}"#), Ok(None));
    events
}

#[test]
fn exact_session_terminal_result_retains_native_id_and_no_other_body() {
    let mut events = ready();
    assert_eq!(
        events.accept(
            r#"{"type":"item.completed","item":{"id":"reasoning_1","type":"reasoning","text":"PRIVATE_REASONING"}}"#,
        ),
        Ok(None)
    );
    assert_eq!(
        events.accept(final_message()),
        Ok(Some(Progress::Step("Writing the result")))
    );
    assert_eq!(events.accept(completed()), Ok(None));
    assert_eq!(events.finish(true), Ok("NATIVE_RESULT".into()));
}

#[test]
fn mismatched_missing_or_duplicated_thread_acknowledgement_fails() {
    let mut events = CodexEvents::new(SESSION);
    assert_eq!(
        events.accept(
            r#"{"type":"thread.started","thread_id":"01a1083a-f0f0-76a3-b1d9-c0268a062637"}"#
        ),
        Err(NativeFailure::SessionMismatch)
    );
    let mut events = CodexEvents::new(SESSION);
    assert_eq!(
        events.accept(r#"{"type":"turn.started"}"#),
        Err(NativeFailure::Protocol)
    );
    let mut events = ready();
    assert_eq!(events.accept(&started()), Err(NativeFailure::Protocol));
    let mut events = CodexEvents::new(SESSION);
    assert_eq!(
        events.accept(&format!(
            r#"{{"type":"thread.started","thread_id":"wrong","thread_id":"{SESSION}"}}"#
        )),
        Err(NativeFailure::Protocol)
    );
}

#[test]
fn zero_exit_eof_and_final_text_are_not_completion_evidence() {
    assert_eq!(
        CodexEvents::new(SESSION).finish(true),
        Err(NativeFailure::MissingCompletion)
    );
    let mut events = ready();
    events.accept(final_message()).expect("valid item");
    assert_eq!(events.finish(true), Err(NativeFailure::MissingCompletion));
    let mut events = ready();
    events.accept(completed()).expect("valid completion");
    assert_eq!(events.finish(true), Err(NativeFailure::MissingCompletion));
}

#[test]
fn completion_marker_without_usage_or_turn_start_is_invalid() {
    let mut events = ready();
    assert_eq!(
        events.accept(r#"{"type":"turn.completed"}"#),
        Err(NativeFailure::Protocol)
    );
    let mut events = CodexEvents::new(SESSION);
    events.accept(&started()).expect("valid identity");
    assert_eq!(events.accept(completed()), Err(NativeFailure::Protocol));
}

#[test]
fn native_provider_quota_and_error_bodies_cannot_become_results_or_errors() {
    for line in [
        r#"{"type":"turn.failed","error":{"message":"PRIVATE_QUOTA_BODY weekly limit"}}"#,
        r#"{"type":"error","message":"PRIVATE_ERROR_BODY"}"#,
        r#"{"type":"item.completed","item":{"id":"error_1","type":"error","message":"PRIVATE_ITEM_BODY"}}"#,
    ] {
        let mut events = ready();
        let error = events.accept(line).expect_err("native failure");
        assert_eq!(error, NativeFailure::Provider);
        assert!(!error.message().contains("PRIVATE"));
    }
}

#[test]
fn trailing_failed_or_invalid_stream_after_completion_still_fails() {
    for trailing in [
        r#"{"type":"turn.failed","error":{"message":"PRIVATE_AFTER_COMPLETED"}}"#,
        r#"{"type":"error","message":"PRIVATE_AFTER_COMPLETED"}"#,
        "PRIVATE_NOT_JSON",
        r#"{"type":"turn.started"}"#,
        r#"{"type":"unknown.trailing.metadata"}"#,
    ] {
        let mut events = ready();
        events.accept(final_message()).expect("valid result");
        events.accept(completed()).expect("valid completion");
        let failure = events.accept(trailing).expect_err("rejected trailer");
        assert_eq!(events.finish(true), Err(failure));
    }
}

#[test]
fn nonzero_exit_is_failure_even_with_native_completion() {
    let mut events = ready();
    events.accept(final_message()).expect("valid result");
    events.accept(completed()).expect("valid completion");
    assert_eq!(events.finish(false), Err(NativeFailure::Exit));
}

#[test]
fn rejected_identity_or_error_cannot_be_recovered_by_later_valid_events() {
    let mut events = ready();
    assert_eq!(
        events.accept(r#"{"type":"turn.completed","thread_id":"01a1083a-f0f0-76a3-b1d9-c0268a062637","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}"#),
        Err(NativeFailure::SessionMismatch)
    );
    assert_eq!(
        events.accept(final_message()),
        Err(NativeFailure::SessionMismatch)
    );
    assert_eq!(events.finish(true), Err(NativeFailure::SessionMismatch));
}

#[test]
fn native_commentary_is_not_returned_as_a_final_result() {
    let mut events = ready();
    events
        .accept(r#"{"type":"item.completed","item":{"id":"comment_1","type":"agent_message","phase":"commentary","text":"NOT_FINAL"}}"#)
        .expect("valid commentary");
    events.accept(completed()).expect("valid completion");
    assert_eq!(events.finish(true), Err(NativeFailure::MissingCompletion));
    let mut events = ready();
    events
        .accept(r#"{"type":"item.completed","item":{"id":"final_1","type":"agent_message","phase":"final_answer","text":"FINAL_ONLY"}}"#)
        .expect("valid final");
    events.accept(completed()).expect("valid completion");
    assert_eq!(events.finish(true), Ok("FINAL_ONLY".into()));
}

#[test]
fn activity_labels_follow_native_types_without_command_path_or_tool_bodies() {
    for (kind, label) in [
        ("command_execution", "Running a command"),
        ("file_change", "Editing files"),
        ("web_search", "Searching the web"),
        ("mcp_tool_call", "Using a tool"),
        ("todo_list", "Planning the work"),
    ] {
        let mut events = ready();
        assert_eq!(
            events.accept(&format!(r#"{{"type":"item.started","item":{{"id":"item_1","type":"{kind}","command":"PRIVATE_COMMAND","path":"PRIVATE_PATH","tool":"PRIVATE_TOOL"}}}}"#)),
            Ok(Some(Progress::Step(label)))
        );
    }
}

#[test]
fn line_result_stream_and_event_count_are_bounded() {
    let mut events = ready();
    assert_eq!(
        events.accept(&"x".repeat(MAX_LINE_BYTES + 1)),
        Err(NativeFailure::OutputBound)
    );
    let mut events = ready();
    let oversized_final = serde_json::json!({
        "type": "item.completed",
        "item": {"id": "item_1", "type": "agent_message", "text": "x".repeat(MAX_RESULT_BYTES + 1)},
    });
    assert_eq!(
        events.accept(&oversized_final.to_string()),
        Err(NativeFailure::OutputBound)
    );
    let mut events = ready();
    events.bytes = MAX_STREAM_BYTES;
    assert_eq!(events.accept(completed()), Err(NativeFailure::OutputBound));
    let mut events = ready();
    events.count = MAX_EVENTS;
    assert_eq!(events.accept(completed()), Err(NativeFailure::OutputBound));
}

#[test]
fn private_malformed_input_is_not_in_failure_text() {
    let mut events = ready();
    let error = events
        .accept("PRIVATE_PARSE_BODY")
        .expect_err("invalid JSON");
    assert_eq!(error, NativeFailure::Protocol);
    assert!(!error.message().contains("PRIVATE"));
}

#[test]
fn native_startup_warning_is_discarded_but_cannot_supply_completion() {
    let warning = r#"{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Under-development features enabled: PRIVATE_FEATURE"}}"#;
    let mut events = CodexEvents::new(SESSION);
    events.accept(&started()).unwrap();
    assert_eq!(events.accept(warning), Ok(None));
    assert_eq!(events.finish(true), Err(NativeFailure::MissingCompletion));
    let mut events = CodexEvents::new(SESSION);
    events.accept(&started()).unwrap();
    events.accept(warning).unwrap();
    events.accept(r#"{"type":"turn.started"}"#).unwrap();
    events.accept(final_message()).unwrap();
    events.accept(completed()).unwrap();
    assert_eq!(events.finish(true), Ok("NATIVE_RESULT".into()));
}

#[test]
fn startup_diagnostics_still_require_valid_item_and_exact_thread_identity() {
    for warning in [
        r#"{"type":"item.completed","item":{"id":"","type":"error","message":"PRIVATE"}}"#,
        r#"{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"NOT_A_RESULT"}}"#,
        r#"{"type":"item.completed","item":{"id":"item_0","type":"error","type":"agent_message"}}"#,
    ] {
        let mut events = CodexEvents::new(SESSION);
        events.accept(&started()).unwrap();
        assert_eq!(events.accept(warning), Err(NativeFailure::Protocol));
    }
    let mut events = CodexEvents::new(SESSION);
    assert_eq!(
        events.accept(r#"{"type":"item.completed","item":{"id":"item_0","type":"error"}}"#),
        Err(NativeFailure::Protocol)
    );
}

#[test]
fn item_errors_after_turn_start_or_completion_are_never_startup_warnings() {
    let warning = r#"{"type":"item.completed","item":{"id":"item_0","type":"error","message":"PRIVATE_STARTUP_LIKE_WARNING"}}"#;
    let mut events = ready();
    assert_eq!(events.accept(warning), Err(NativeFailure::Provider));
    let mut events = ready();
    events.accept(final_message()).unwrap();
    events.accept(completed()).unwrap();
    assert_eq!(events.accept(warning), Err(NativeFailure::Protocol));
    assert_eq!(events.finish(true), Err(NativeFailure::Protocol));
}
