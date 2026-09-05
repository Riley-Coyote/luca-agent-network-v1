use super::*;
use luca_protocol::{
    CanonicalTimestamp, ConnectedBrainSourceV1, Hex64, SafeU53, Sha256Ref, CONNECTED_BRAIN_PROTOCOL,
};
use std::sync::{atomic::AtomicBool, Arc};

fn scope() -> ResidentProposalScope {
    ResidentProposalScope {
        owner: Hex64::parse("a".repeat(64)).expect("owner"),
        resident: Hex64::parse("b".repeat(64)).expect("resident"),
        session_epoch: SafeU53::new(1).expect("epoch"),
        binding: Sha256Ref::parse(format!("sha256:{}", "c".repeat(64))).expect("binding"),
        conversation: OpaqueId::parse("original-conversation").expect("conversation"),
        active: Arc::new(AtomicBool::new(true)),
    }
}

fn pending() -> Pending {
    let scope = scope();
    Pending {
        projection: RepositoryConnectionProposalV1 {
            request_id: "request-one".into(),
            owner_pubkey: scope.owner.as_str().into(),
            resident_pubkey: scope.resident.as_str().into(),
            conversation_id: scope.conversation.as_str().into(),
            purpose: "Read my chosen project.".into(),
            created_at: "2026-09-05T13:00:00Z".into(),
        },
        scope,
        deadline: Instant::now() + LIFETIME,
        attempt: None,
        result: None,
    }
}

fn fixture_store() -> Store {
    Store {
        pending: HashMap::from([("request-one".into(), pending())]),
        ..Store::default()
    }
}

fn attempt() -> Attempt {
    Attempt {
        running: false,
        source_id: Some(OpaqueId::parse("host-selected-source").expect("source")),
        write_started: true,
        confirmed: true,
        replayed: Some(false),
    }
}

fn source() -> ConnectedBrainSourceSummaryV1 {
    let time = CanonicalTimestamp::parse("2026-09-05T13:00:00Z").expect("time");
    ConnectedBrainSourceSummaryV1 {
        source: ConnectedBrainSourceV1 {
            protocol: CONNECTED_BRAIN_PROTOCOL.into(),
            source_id: attempt().source_id.expect("source"),
            owner_pubkey: scope().owner,
            source_kind: ConnectedBrainSourceKindV1::Repository,
            display_name: "private-project-name".into(),
            status: ConnectedBrainSourceStatusV1::Current,
            capabilities: vec![],
            index_revision: Sha256Ref::parse(format!("sha256:{}", "d".repeat(64)))
                .expect("revision"),
            created_at: time.clone(),
            updated_at: time.clone(),
            last_refreshed_at: Some(time),
        },
        item_count: SafeU53::new(2).expect("items"),
        entry_count: SafeU53::new(4).expect("entries"),
    }
}

#[test]
fn proposal_arguments_cannot_choose_any_authority_or_discovery() {
    for field in [
        "owner",
        "resident",
        "conversation_id",
        "source_id",
        "discovery_id",
        "path",
        "root",
        "grant",
        "model",
        "budget",
        "api_key",
    ] {
        let mut value = json!({"purpose":"Read the project I choose."});
        value[field] = json!("injected");
        assert!(
            serde_json::from_value::<Arguments>(value).is_err(),
            "{field}"
        );
    }
    for purpose in [
        String::new(),
        " ".into(),
        "x".repeat(501),
        "two\nlines".into(),
        "hidden\0control".into(),
    ] {
        assert!(Arguments { purpose }.validate().is_err());
    }
    assert!(Arguments {
        purpose: "Connect my repository for our work.".into()
    }
    .validate()
    .is_ok());
}

#[test]
fn exactly_one_mutation_attempt_survives_failure_and_replay() {
    let mut state = fixture_store();
    begin_attempt(&mut state, "request-one").expect("first attempt");
    assert!(begin_attempt(&mut state, "request-one").is_err());
    state
        .pending
        .get_mut("request-one")
        .expect("request")
        .attempt
        .as_mut()
        .expect("attempt")
        .running = false;
    assert!(
        begin_attempt(&mut state, "request-one").is_err(),
        "failed attempts cannot reconnect"
    );
    assert!(completion_snapshot(&state, "unknown").is_err());
}

#[test]
fn close_after_persistence_start_cannot_be_revived_by_completion() {
    let mut state = fixture_store();
    let mut started = attempt();
    started.running = true;
    started.confirmed = false;
    state
        .pending
        .get_mut("request-one")
        .expect("request")
        .attempt = Some(started);
    let closed = close_pending(&mut state, "request-one", "caller_disconnected").expect("closed");
    assert_eq!(closed["connectionMayHaveStarted"], true);
    assert_eq!(closed["sourceId"], "host-selected-source");
    assert!(complete_success(
        &mut state,
        "request-one",
        json!({"status":"repository_available"})
    )
    .is_err());
    assert!(completion_snapshot(&state, "request-one").is_err());
    assert!(begin_attempt(&mut state, "request-one").is_err());
    assert_eq!(
        close_pending(&mut state, "request-one", "review_closed").expect("repeat"),
        closed
    );
}

#[test]
fn expiry_and_runtime_end_reject_mutation_and_completion() {
    for expired in [true, false] {
        let mut state = fixture_store();
        let pending = state.pending.get_mut("request-one").expect("request");
        if expired {
            pending.deadline = Instant::now() - Duration::from_secs(1);
        } else {
            pending.scope.active.store(false, Ordering::SeqCst);
        }
        assert!(begin_attempt(&mut state, "request-one").is_err());
        assert!(complete_success(
            &mut state,
            "request-one",
            json!({"status":"repository_available"})
        )
        .is_err());
        assert!(completion_snapshot(&state, "request-one").is_err());
    }
}

#[test]
fn unknown_or_closed_requests_never_acknowledge_connected() {
    let mut state = fixture_store();
    assert!(
        completion_snapshot(&state, "request-one").is_err(),
        "no mutation receipt"
    );
    assert!(complete_success(&mut state, "missing", json!({})).is_err());
    close_pending(&mut state, "request-one", "review_closed").expect("close");
    let item = state.pending.remove("request-one").expect("request");
    retain_completion(&mut state, "request-one".into(), item);
    assert!(state.completed.is_empty());
    assert!(completion_snapshot(&state, "request-one").is_err());
}

#[test]
fn grant_rejection_precedes_catalog_read_even_for_a_confirmed_operation() {
    let result = verified_source_result(
        &scope(),
        &attempt(),
        |_| Err("grant-revoked".into()),
        |_| panic!("catalog must not be read without current exact-binding grant"),
    );
    assert_eq!(result.expect_err("rejected"), "grant-revoked");
}

#[test]
fn actual_current_repository_identity_owner_and_status_are_required() {
    for mutation in 0..5 {
        let mut source = source();
        match mutation {
            0 => source.source.source_id = OpaqueId::parse("another-source").expect("source"),
            1 => source.source.owner_pubkey = Hex64::parse("e".repeat(64)).expect("owner"),
            2 => source.source.source_kind = ConnectedBrainSourceKindV1::CodexHistory,
            3 => source.source.status = ConnectedBrainSourceStatusV1::Disconnected,
            _ => source.source.status = ConnectedBrainSourceStatusV1::NeedsAttention,
        }
        assert!(verified_source_result(&scope(), &attempt(), |_| Ok(()), |_| Ok(source)).is_err());
    }
}

#[test]
fn current_host_index_metadata_is_returned_without_private_names_or_paths() {
    let expected = source();
    let result = verified_source_result(
        &scope(),
        &attempt(),
        |id| {
            assert_eq!(id.as_str(), "host-selected-source");
            Ok(())
        },
        |_| Ok(expected.clone()),
    )
    .expect("verified");
    assert_eq!(
        result["indexRevision"],
        json!(expected.source.index_revision)
    );
    assert_eq!(result["conversationId"], "original-conversation");
    assert_eq!(result["requestingResidentAccess"], "verified");
    assert_eq!(result["connectionOperationConfirmed"], true);
    assert_eq!(result["itemCount"], 2);
    assert!(!result.to_string().contains("private-project-name"));
    assert!(result.get("path").is_none());
    assert!(result.get("displayName").is_none());
}

#[test]
fn a_partial_write_can_prove_current_access_without_claiming_the_operation_completed() {
    let mut partial = attempt();
    partial.confirmed = false;
    partial.replayed = None;
    let result = verified_source_result(&scope(), &partial, |_| Ok(()), |_| Ok(source()))
        .expect("current available source");
    assert_eq!(result["status"], "repository_available");
    assert_eq!(result["connectionOperationConfirmed"], false);
    assert!(result["replayed"].is_null());
    assert!(result["message"]
        .as_str()
        .expect("message")
        .contains("Other resident grants may need attention"));
    for pending in [true, false] {
        let mut incomplete = partial.clone();
        if pending {
            incomplete.running = true;
        } else {
            incomplete.write_started = false;
        }
        assert!(verified_source_result(
            &scope(),
            &incomplete,
            |_| panic!("not ready"),
            |_| panic!("not ready")
        )
        .is_err());
    }
}

#[test]
fn lost_acknowledgement_replays_only_a_reference_and_rechecks_current_access() {
    let mut state = fixture_store();
    state
        .pending
        .get_mut("request-one")
        .expect("request")
        .attempt = Some(attempt());
    complete_success(
        &mut state,
        "request-one",
        json!({"status":"repository_available"}),
    )
    .expect("complete");
    let item = state.pending.remove("request-one").expect("request");
    retain_completion(&mut state, "request-one".into(), item);
    let (scope, receipt, acknowledged) =
        completion_snapshot(&state, "request-one").expect("ack reference");
    assert!(acknowledged);
    assert!(verified_source_result(
        &scope,
        &receipt,
        |_| Err("binding changed".into()),
        |_| panic!("revoked")
    )
    .is_err());
    state
        .completed
        .get_mut("request-one")
        .expect("receipt")
        .deadline = Instant::now() - Duration::from_secs(1);
    assert!(completion_snapshot(&state, "request-one").is_err());
}

#[test]
fn completed_reference_cache_is_bounded_and_does_not_retain_review_bodies() {
    let mut state = Store::default();
    for index in 0..70 {
        let mut item = pending();
        item.attempt = Some(attempt());
        item.result = Some(json!({"status":"repository_available"}));
        retain_completion(&mut state, format!("request-{index}"), item);
    }
    assert_eq!(state.completed.len(), 64);
    assert!(state.pending.is_empty());
}

#[test]
fn terminal_slot_does_not_change_after_success() {
    let mut state = fixture_store();
    state
        .pending
        .get_mut("request-one")
        .expect("request")
        .attempt = Some(attempt());
    let result = json!({"status":"repository_available", "sourceId":"host-selected-source"});
    assert!(complete_success(&mut state, "request-one", result.clone()).expect("complete"));
    assert_eq!(
        close_pending(&mut state, "request-one", "caller_disconnected").expect("already complete"),
        result
    );
    assert!(!complete_success(
        &mut state,
        "request-one",
        json!({"status":"repository_available"})
    )
    .expect("ack"));
}

#[test]
fn a_close_during_result_validation_prevents_late_success() {
    let state = Arc::new(Mutex::new(fixture_store()));
    state
        .lock()
        .expect("state")
        .pending
        .get_mut("request-one")
        .expect("request")
        .attempt = Some(attempt());
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let (resume_tx, resume_rx) = std::sync::mpsc::channel();
    let completing = Arc::clone(&state);
    let worker = std::thread::spawn(move || {
        let (scope, attempt, _) =
            completion_snapshot(&completing.lock().expect("state"), "request-one")
                .expect("started validation");
        let result = verified_source_result(
            &scope,
            &attempt,
            |_| {
                ready_tx.send(()).expect("validation waiting");
                resume_rx.recv().expect("continue after owner close");
                Ok(())
            },
            |_| Ok(source()),
        )
        .expect("source proof alone is not terminal permission");
        complete_success(
            &mut completing.lock().expect("state"),
            "request-one",
            result,
        )
    });
    ready_rx.recv().expect("result validation reached");
    close_pending(
        &mut state.lock().expect("state"),
        "request-one",
        "review_closed",
    )
    .expect("owner close");
    resume_tx.send(()).expect("resume validation");
    assert!(worker.join().expect("worker").is_err());
    assert_eq!(
        state.lock().expect("state").pending["request-one"]
            .result
            .as_ref()
            .expect("terminal")["status"],
        "incomplete"
    );
}
