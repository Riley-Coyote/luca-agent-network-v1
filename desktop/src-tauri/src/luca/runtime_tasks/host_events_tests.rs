use super::*;

const SESSION: &str = "9ab62e3b-f826-4f2f-8e04-b06975506abc";
const OTHER: &str = "8ed9b580-60ea-40d7-b1f0-67c2730bdff3";

fn line(kind: &str, fields: serde_json::Value) -> String {
    let mut value = fields;
    value["protocol"] = serde_json::json!(PROTOCOL);
    value["kind"] = serde_json::json!(kind);
    value.to_string()
}

fn session(id: &str) -> String {
    line("session", serde_json::json!({"providerSessionId": id}))
}

fn result(id: Option<&str>, text: &str, stop: &str) -> String {
    line(
        "result",
        serde_json::json!({"providerSessionId": id, "result": text, "stopReason": stop}),
    )
}

fn acknowledged() -> HostEvents {
    let mut events = HostEvents::new(Some(SESSION)).expect("valid expected session");
    assert_eq!(
        events.accept(&session(SESSION)),
        Ok(HostEvent::Session(SESSION.into()))
    );
    events
}

#[test]
fn continuation_retains_exact_native_identity_and_stages_result_until_finish() {
    let mut events = acknowledged();
    assert_eq!(events.provider_session_id(), Some(SESSION));
    assert_eq!(
        events.accept(&result(Some(SESSION), "NATIVE_FINAL\n", "end_turn")),
        Ok(HostEvent::Result)
    );
    assert_eq!(events.finish(true), Ok(Some("NATIVE_FINAL\n".into())));
}

#[test]
fn legacy_new_task_accepts_first_opaque_id_and_result_without_repeated_id() {
    let mut events = HostEvents::new(None).expect("legacy mode");
    assert_eq!(
        events.accept(&line(
            "step",
            serde_json::json!({"label": "Starting the runtime"})
        )),
        Ok(HostEvent::Step("Starting the runtime".into()))
    );
    assert!(events.provider_session_id().is_none());
    events
        .accept(&session("acp:opaque-saved-session"))
        .expect("legacy identity");
    events
        .accept(&result(None, "LEGACY_RESULT", "end_turn"))
        .expect("legacy completion");
    assert_eq!(events.finish(true), Ok(Some("LEGACY_RESULT".into())));
}

#[test]
fn legacy_exactly_512_byte_identity_is_allowed_but_longer_or_control_ids_fail() {
    let mut events = HostEvents::new(None).expect("legacy mode");
    assert!(events.accept(&session(&"x".repeat(512))).is_ok());
    for id in [
        "x".repeat(513),
        "PRIVATE_ID\n".into(),
        "".into(),
        "   ".into(),
    ] {
        let mut events = HostEvents::new(None).expect("legacy mode");
        assert!(events.accept(&session(&id)).is_err());
        assert!(events.finish(true).is_err());
    }
}

#[test]
fn continuation_requires_canonical_uuid_not_names_last_urn_uppercase_or_nil() {
    for invalid in [
        "--last",
        "named thread",
        "9ab62e3bf8264f2f8e04b06975506abc",
        "urn:uuid:9ab62e3b-f826-4f2f-8e04-b06975506abc",
        "9AB62E3B-F826-4F2F-8E04-B06975506ABC",
        "00000000-0000-0000-0000-000000000000",
        "PRIVATE_TARGET_BODY",
    ] {
        let error = HostEvents::new(Some(invalid))
            .err()
            .expect("invalid target");
        assert_eq!(error, INVALID_TARGET);
        assert!(!error.contains("PRIVATE"));
    }
}

#[test]
fn mismatched_session_step_or_result_identity_permanently_rejects_success() {
    for mismatched in [
        session(OTHER),
        line(
            "step",
            serde_json::json!({"providerSessionId": OTHER, "label": "Working"}),
        ),
        result(Some(OTHER), "PRIVATE_NOT_ACCEPTED", "end_turn"),
    ] {
        let mut events = acknowledged();
        assert_eq!(events.accept(&mismatched), Err(SESSION_MISMATCH.into()));
        assert_eq!(
            events.accept(&result(Some(SESSION), "LATER_RESULT", "end_turn")),
            Err(SESSION_MISMATCH.into())
        );
        assert_eq!(events.finish(true), Err(SESSION_MISMATCH.into()));
    }
}

#[test]
fn legacy_bound_session_cannot_silently_change() {
    let mut events = HostEvents::new(None).expect("legacy mode");
    events.accept(&session("legacy-1")).expect("first session");
    assert_eq!(
        events.accept(&session("legacy-2")),
        Err(SESSION_MISMATCH.into())
    );
    assert_eq!(events.finish(true), Err(SESSION_MISMATCH.into()));
}

#[test]
fn malformed_envelope_does_not_adopt_an_unacknowledged_provider_identity() {
    for invalid in [
        line(
            "session",
            serde_json::json!({"providerSessionId": "PRIVATE_UNVERIFIED_ID", "label": "wrong payload"}),
        ),
        line(
            "step",
            serde_json::json!({"providerSessionId": "PRIVATE_UNVERIFIED_ID"}),
        ),
        result(Some("PRIVATE_UNVERIFIED_ID"), "NOT_COMPLETED", "cancelled"),
    ] {
        let mut events = HostEvents::new(None).expect("legacy mode");
        assert!(events.accept(&invalid).is_err());
        assert!(events.provider_session_id().is_none());
        assert!(events.finish(true).is_err());
    }
}

#[test]
fn continuation_requires_session_ack_and_correlated_result_id() {
    let mut events = HostEvents::new(Some(SESSION)).expect("continuation mode");
    assert_eq!(
        events.accept(&result(Some(SESSION), "NOT_ACKNOWLEDGED", "end_turn")),
        Err(MISSING_CORRELATION.into())
    );
    let mut events = acknowledged();
    assert_eq!(
        events.accept(&result(None, "UNCORRELATED", "end_turn")),
        Err(MISSING_CORRELATION.into())
    );
    let mut events = HostEvents::new(None).expect("legacy mode");
    assert_eq!(
        events.accept(&result(None, "NO_PROVIDER_BINDING", "end_turn")),
        Err(MISSING_CORRELATION.into())
    );
}

#[test]
fn eof_or_exit_zero_without_explicit_end_turn_result_is_not_completion() {
    for events in [HostEvents::new(None).expect("legacy mode"), acknowledged()] {
        assert_eq!(events.finish(true), Err(MISSING_COMPLETION.into()));
    }
    for stop in [
        "cancelled",
        "max_tokens",
        "refusal",
        "",
        "PRIVATE_STOP_BODY",
    ] {
        let mut events = acknowledged();
        assert_eq!(
            events.accept(&result(Some(SESSION), "NOT_COMPLETED", stop)),
            Err(EARLY_STOP.into())
        );
        assert_eq!(events.finish(true), Err(EARLY_STOP.into()));
    }
}

#[test]
fn failed_host_event_discards_provider_body_and_cannot_recover_success() {
    let mut events = acknowledged();
    let failed = line(
        "failed",
        serde_json::json!({"error": "PRIVATE_PROMPT_PATH_TOKEN"}),
    );
    assert_eq!(
        events.accept(&failed),
        Ok(HostEvent::Failed(HOST_FAILED.into()))
    );
    assert_eq!(
        events.accept(&result(Some(SESSION), "LATER_RESULT", "end_turn")),
        Err(HOST_FAILED.into())
    );
    assert_eq!(events.finish(true), Err(HOST_FAILED.into()));
}

#[test]
fn trailing_failure_malformed_protocol_step_and_duplicate_result_poison_success() {
    for trailing in [
        line(
            "failed",
            serde_json::json!({"error": "PRIVATE_FAILURE_AFTER_RESULT"}),
        ),
        "PRIVATE_BAD_JSON".into(),
        r#"{"protocol":"PRIVATE_WRONG_PROTOCOL","kind":"result","result":"PRIVATE"}"#.into(),
        line("step", serde_json::json!({"label": "Trailing work"})),
        result(Some(SESSION), "DUPLICATE_RESULT", "end_turn"),
    ] {
        let mut events = acknowledged();
        events
            .accept(&result(Some(SESSION), "CANDIDATE_ONLY", "end_turn"))
            .expect("candidate result");
        let accepted = events.accept(&trailing);
        assert!(accepted.is_err() || accepted == Ok(HostEvent::Failed(HOST_FAILED.into())));
        let error = events.finish(true).expect_err("poisoned candidate");
        assert!(!error.contains("PRIVATE"));
    }
}

#[test]
fn successful_worker_exit_is_required_even_after_a_valid_result() {
    let mut events = acknowledged();
    events
        .accept(&result(Some(SESSION), "CANDIDATE", "end_turn"))
        .expect("candidate");
    assert_eq!(events.finish(false), Err(BAD_EXIT.into()));
}

#[test]
fn explicitly_completed_empty_legacy_output_is_optional_not_fabricated() {
    let mut events = HostEvents::new(None).expect("legacy mode");
    events
        .accept(&session("legacy-native-id"))
        .expect("session");
    events
        .accept(&result(None, " \n\t", "end_turn"))
        .expect("completed empty result");
    assert_eq!(events.finish(true), Ok(None));
}

#[test]
fn framing_or_persistence_rejection_after_candidate_completion_poisons_result() {
    let mut events = acknowledged();
    events
        .accept(&result(Some(SESSION), "STAGED_ONLY", "end_turn"))
        .expect("candidate");
    assert_eq!(events.reject_stream(), INVALID_STREAM);
    assert_eq!(events.finish(true), Err(INVALID_STREAM.into()));
}

#[test]
fn labels_strip_controls_trim_and_bound_multibyte_text_without_splitting_utf8() {
    let mut events = acknowledged();
    assert_eq!(
        events.accept(&line(
            "step",
            serde_json::json!({"label": "  \u{0007}Reading\n files\t  "})
        )),
        Ok(HostEvent::Step("Reading files".into()))
    );
    assert_eq!(
        events.accept(&line(
            "step",
            serde_json::json!({"label": "Reading\u{202e} files\u{2066}"})
        )),
        Ok(HostEvent::Step("Reading files".into()))
    );
    let label = "\u{2605}".repeat(100);
    let HostEvent::Step(bounded) = events
        .accept(&line("step", serde_json::json!({"label": label})))
        .expect("bounded Unicode label")
    else {
        panic!("expected step");
    };
    assert_eq!(bounded, "\u{2605}".repeat(42));
    assert!(bounded.len() <= MAX_LABEL_BYTES);
    let mut events = acknowledged();
    assert_eq!(
        events.accept(&line(
            "step",
            serde_json::json!({"label": "\u{0000}\u{0007}\n\t "})
        )),
        Err(INVALID_STREAM.into())
    );
}

#[test]
fn line_stream_event_and_result_bounds_fail_closed_including_after_completion() {
    let mut events = acknowledged();
    assert_eq!(
        events.accept(&"x".repeat(MAX_HOST_LINE_BYTES + 1)),
        Err(OUTPUT_BOUND.into())
    );
    let mut events = acknowledged();
    assert_eq!(
        events.accept(&result(
            Some(SESSION),
            &"x".repeat(MAX_RESULT_BYTES + 1),
            "end_turn"
        )),
        Err(OUTPUT_BOUND.into())
    );
    let mut events = acknowledged();
    events.bytes = MAX_STREAM_BYTES;
    assert_eq!(
        events.accept(&result(Some(SESSION), "FINAL", "end_turn")),
        Err(OUTPUT_BOUND.into())
    );
    let mut events = acknowledged();
    events.count = MAX_EVENTS;
    assert_eq!(
        events.accept(&result(Some(SESSION), "FINAL", "end_turn")),
        Err(OUTPUT_BOUND.into())
    );
    let mut events = acknowledged();
    events
        .accept(&result(Some(SESSION), "CANDIDATE", "end_turn"))
        .expect("candidate");
    assert_eq!(
        events.accept(&"x".repeat(MAX_HOST_LINE_BYTES + 1)),
        Err(OUTPUT_BOUND.into())
    );
    assert_eq!(events.finish(true), Err(OUTPUT_BOUND.into()));
}

#[test]
fn maximum_result_is_preserved_without_truncation() {
    let text = "x".repeat(MAX_RESULT_BYTES);
    let mut events = acknowledged();
    events
        .accept(&result(Some(SESSION), &text, "end_turn"))
        .expect("bounded result");
    assert_eq!(events.finish(true), Ok(Some(text)));
}

#[test]
fn unknown_fields_kinds_duplicate_coordinates_and_conflicting_payloads_are_rejected() {
    for invalid in [
        line(
            "result",
            serde_json::json!({"result": "PRIVATE", "stopReason": "end_turn", "extra": "PRIVATE_EXTRA"}),
        ),
        line("PRIVATE_UNKNOWN_KIND", serde_json::json!({})),
        format!(
            r#"{{"protocol":"{PROTOCOL}","kind":"session","providerSessionId":"wrong","providerSessionId":"{SESSION}"}}"#
        ),
        line(
            "result",
            serde_json::json!({"providerSessionId": SESSION, "result": "PRIVATE", "stopReason": "end_turn", "error": "PRIVATE_ERROR"}),
        ),
        line(
            "step",
            serde_json::json!({"label": "PRIVATE_LABEL", "result": "PRIVATE_RESULT"}),
        ),
        line("session", serde_json::json!({})),
    ] {
        let mut events = HostEvents::new(Some(SESSION)).expect("valid target");
        let error = events.accept(&invalid).expect_err("invalid envelope");
        assert!(!error.contains("PRIVATE"));
        assert!(events.finish(true).is_err());
    }
}
