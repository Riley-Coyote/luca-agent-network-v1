use super::*;

#[test]
fn busy_admission_polls_one_request_until_success_without_extending_deadline() {
    let remaining = std::cell::Cell::new(2_000);
    let mut responses = [
        Err(managed_cognition::ManagedCognitionError::Busy),
        Err(managed_cognition::ManagedCognitionError::Busy),
        Ok(7_u8),
    ]
    .into_iter();
    let calls = std::cell::Cell::new(0);
    let outcome = await_admission(
        || Ok(Some(remaining.get())),
        || {
            calls.set(calls.get() + 1);
            responses.next().expect("no extra dispatch")
        },
        |duration| {
            assert_eq!(duration.as_millis(), u128::from(ADMISSION_RETRY_MS));
            remaining.set(remaining.get() - duration.as_millis() as u64);
        },
    )
    .unwrap();
    assert_eq!(outcome, Some(Ok(7)));
    assert_eq!(calls.get(), 3);
    assert_eq!(remaining.get(), 1_000);
}

#[test]
fn admission_polling_stops_at_every_ambiguous_or_post_start_boundary() {
    for error in [
        managed_cognition::ManagedCognitionError::Unavailable,
        managed_cognition::ManagedCognitionError::Timeout,
        managed_cognition::ManagedCognitionError::Invalid,
    ] {
        let calls = std::cell::Cell::new(0);
        let mut pauses = 0;
        let outcome = await_admission::<()>(
            || Ok(Some(2_000)),
            || {
                calls.set(calls.get() + 1);
                Err(if calls.get() == 1 {
                    managed_cognition::ManagedCognitionError::Busy
                } else {
                    error
                })
            },
            |_| pauses += 1,
        )
        .unwrap();
        assert_eq!(outcome, Some(Err(error)));
        assert_eq!(calls.get(), 2);
        assert_eq!(pauses, 1);
    }
}

#[test]
fn busy_until_original_deadline_returns_unstarted_without_another_attempt() {
    let remaining = std::cell::Cell::new(650_u64);
    let mut calls = 0;
    let mut pauses = Vec::new();
    let outcome = await_admission::<()>(
        || Ok(Some(remaining.get())),
        || {
            calls += 1;
            Err(managed_cognition::ManagedCognitionError::Busy)
        },
        |duration| {
            pauses.push(duration.as_millis());
            remaining.set(remaining.get() - duration.as_millis() as u64);
        },
    )
    .unwrap();
    assert_eq!(outcome, None);
    assert_eq!(calls, 2);
    assert_eq!(pauses, [500, 150]);
}

#[test]
fn shutdown_or_changed_claim_scope_stops_before_another_admission_dispatch() {
    let mut preflights = [Some(2_000), None].into_iter();
    let mut calls = 0;
    let outcome = await_admission::<()>(
        || Ok(preflights.next().expect("no additional preflight")),
        || {
            calls += 1;
            Err(managed_cognition::ManagedCognitionError::Busy)
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(outcome, None);
    assert_eq!(calls, 1);
}

#[test]
fn unavailable_preflight_never_dispatches_or_implicitly_reclaims() {
    let outcome = await_admission::<()>(
        || Ok(None),
        || panic!("no dispatch without exact live authority"),
        |_| panic!("no wait without a busy reply"),
    )
    .unwrap();
    assert_eq!(outcome, None);
    assert!(await_admission::<()>(
        || Err("authority unavailable".into()),
        || panic!("no dispatch after failed preflight"),
        |_| panic!("no wait after failed preflight"),
    )
    .is_err());
}

fn pending() -> RuntimeTaskDeliveryReceiptV1 {
    RuntimeTaskDeliveryReceiptV1 {
        delivery_id: Some(OpaqueId::parse(format!("task-result:{}", "ab".repeat(32))).unwrap()),
        task_id: task_id("task-1").unwrap(),
        owner_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
        resident_pubkey: Hex64::parse("22".repeat(32)).unwrap(),
        conversation_id: task_id("conversation-1").unwrap(),
        origin_relay_ref: Sha256Ref::parse(format!("sha256:{}", "33".repeat(32))).unwrap(),
        origin_community_id: task_id("community-1").unwrap(),
        input_sha256: digest(b"private owner prompt").unwrap(),
        result_sha256: Some(digest(b"verified result").unwrap()),
        binding_ref: Sha256Ref::parse(format!("sha256:{}", "44".repeat(32))).unwrap(),
        state: RuntimeTaskDeliveryStateV1::PendingSynthesis,
        updated_at: luca_protocol::CanonicalTimestamp::parse("2026-10-04T00:00:00Z").unwrap(),
        synthesis_attempts: 0,
        synthesis_lease_deadline_unix_ms: None,
    }
}

#[test]
fn an_automatic_retry_never_resets_the_durable_attempt_budget() {
    let mut row = pending();
    assert!(claimable(&row, false, 100));
    row.synthesis_attempts = MAX_AUTOMATIC_ATTEMPTS;
    assert!(!claimable(&row, false, 100));
    assert!(claimable(&row, true, 100));
}

#[test]
fn preparing_submitted_and_terminal_returns_never_regenerate() {
    let mut row = pending();
    for state in [
        RuntimeTaskDeliveryStateV1::AwaitingResult,
        RuntimeTaskDeliveryStateV1::Prepared,
        RuntimeTaskDeliveryStateV1::Submitted,
        RuntimeTaskDeliveryStateV1::Published,
        RuntimeTaskDeliveryStateV1::Blocked,
        RuntimeTaskDeliveryStateV1::Cancelled,
        RuntimeTaskDeliveryStateV1::Rejected,
    ] {
        row.state = state;
        assert!(!claimable(&row, false, 100));
        assert!(!claimable(&row, true, 100));
    }
}

#[test]
fn a_live_lease_cannot_be_reclaimed_even_by_manual_retry() {
    let mut row = pending();
    row.state = RuntimeTaskDeliveryStateV1::Synthesizing;
    row.synthesis_lease_deadline_unix_ms = Some(200);
    assert!(!claimable(&row, true, 199));
    assert!(claimable(&row, false, 200));
    row.synthesis_lease_deadline_unix_ms = None;
    assert!(!claimable(&row, true, 500));
}

#[test]
fn excerpts_are_exact_utf8_prefixes_and_digest_remains_full_result() {
    let body = format!("{}érest", "x".repeat(EXCERPT_BYTES - 1));
    let reference = excerpt(&body);
    assert_eq!(reference.len(), EXCERPT_BYTES - 1);
    assert!(body.starts_with(&reference));
    assert_ne!(
        digest(body.as_bytes()).unwrap(),
        digest(reference.as_bytes()).unwrap()
    );
    assert_eq!(excerpt("small result"), "small result");
}

#[test]
fn lifecycle_recovery_wakeups_coalesce_without_losing_a_later_companion_start() {
    let mut wake = RecoveryWake::default();
    assert!(wake.request());
    assert!(!wake.request());
    assert!(!wake.request());
    assert!(wake.finish_pass(false));
    assert!(!wake.request());
    assert!(wake.finish_pass(false));
    assert!(!wake.finish_pass(false));
    assert!(wake.request());
    assert!(!wake.finish_pass(false));
}

#[test]
fn recovery_shutdown_drops_pending_wakes_without_starting_another_pass() {
    let mut wake = RecoveryWake::default();
    assert!(wake.request());
    assert!(!wake.request());
    assert!(!wake.finish_pass(true));
    assert!(!wake.running);
    assert!(!wake.requested);
}

#[test]
fn one_unverifiable_return_never_starves_later_recovery_rows() {
    let rows = (0..4)
        .map(|index| {
            let mut row = pending();
            row.task_id = task_id(&format!("task-{index}")).unwrap();
            row
        })
        .collect();
    let mut seen = Vec::new();
    let counts = recover_rows(rows, |row| {
        seen.push(row.task_id.as_str().to_owned());
        match row.task_id.as_str() {
            "task-0" => Err("invalid retained evidence".into()),
            "task-2" => Ok(false),
            _ => Ok(true),
        }
    });
    assert_eq!(counts, (2, 1));
    assert_eq!(seen, ["task-0", "task-1", "task-2", "task-3"]);
}

fn succeeded_projection() -> RuntimeTaskProjectionV1 {
    serde_json::from_value(serde_json::json!({
        "taskId": "task-1",
        "ownerPubkey": "11".repeat(32),
        "residentPubkey": "22".repeat(32),
        "conversationId": "conversation-1",
        "originRelayRef": format!("sha256:{}", "33".repeat(32)),
        "runtimeFamily": "codex",
        "summary": "Disposable fixture",
        "workingFolder": "/private/tmp/disposable-fixture",
        "permissionMode": "native",
        "operation": "continue_session",
        "targetSessionRef": "session-target-1",
        "state": "succeeded",
        "completedSteps": 1,
        "startedAt": "2026-10-04T00:00:00Z",
        "updatedAt": "2026-10-04T00:01:00Z"
    }))
    .unwrap()
}

#[test]
fn completion_scope_is_derived_only_from_the_retained_projection() {
    let projection = succeeded_projection();
    let scope = completion_scope(&projection).unwrap();
    assert_eq!(scope.task_id.as_str(), projection.task_id);
    assert_eq!(scope.owner_pubkey.as_str(), projection.owner_pubkey);
    assert_eq!(scope.resident_pubkey.as_str(), projection.resident_pubkey);
    assert_eq!(scope.conversation_id.as_str(), projection.conversation_id);
    assert_eq!(scope.origin_relay_ref, projection.origin_relay_ref.unwrap());
    assert_eq!(
        scope.origin_community_id,
        community_id_for_relay_ref(&scope.origin_relay_ref).unwrap()
    );
    assert_eq!(scope.runtime_family, "codex");
    assert_eq!(
        scope.operation,
        RuntimeTaskDeliveryOperationV1::ContinueSession
    );
    assert_eq!(scope.target_ref.unwrap().as_str(), "session-target-1");
    assert_eq!(scope.permission_mode, "native");
}

#[test]
fn legacy_originless_and_native_queue_receipts_cannot_bind_completed_results() {
    let mut projection = succeeded_projection();
    projection.operation = RuntimeTaskOperationV1::SendMessage;
    assert!(completion_scope(&projection).is_err());
    projection.operation = RuntimeTaskOperationV1::NewTask;
    projection.target_session_ref = None;
    assert_eq!(
        completion_scope(&projection).unwrap().operation,
        RuntimeTaskDeliveryOperationV1::NewTask
    );
    projection.origin_relay_ref = None;
    assert!(completion_scope(&projection).is_err());
}
