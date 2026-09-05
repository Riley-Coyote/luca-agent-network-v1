use super::*;

fn scope() -> ResidentProposalScope {
    ResidentProposalScope {
        owner: Hex64::parse("a".repeat(64)).expect("owner"),
        resident: Hex64::parse("b".repeat(64)).expect("resident"),
        session_epoch: SafeU53::new(11).expect("epoch"),
        binding: Sha256Ref::parse(format!("sha256:{}", "c".repeat(64))).expect("binding"),
        conversation: OpaqueId::parse("conversation-test").expect("conversation"),
        active: Arc::new(AtomicBool::new(true)),
    }
}

#[test]
fn proposal_arguments_cannot_choose_origin_credentials_provider_or_budget() {
    for field in [
        "owner",
        "resident_pubkey",
        "conversation_id",
        "provider",
        "model",
        "budget",
        "api_key",
    ] {
        let mut value =
            json!({"display_name":"Researcher","system_prompt":"Read the assigned project."});
        value[field] = json!("untrusted");
        assert!(
            serde_json::from_value::<ProposalArguments>(value).is_err(),
            "{field}"
        );
    }
}

#[test]
fn proposals_accept_each_runtime_and_only_bounded_instructions() {
    for runtime in ["codex", "claude_code", "hermes", "openclaw"] {
        let args: ProposalArguments = serde_json::from_value(json!({
            "display_name":"Researcher", "system_prompt":"Read this project.\nReport evidence.",
            "runtime_family":runtime, "provisioning_intent":"fresh"
        }))
        .expect("proposal");
        assert!(args.validate().is_ok());
    }
    for (field, value) in [
        ("display_name", " ".to_owned()),
        ("display_name", "x".repeat(121)),
        ("display_name", "two\nlines".to_owned()),
        ("system_prompt", "x".repeat(20_001)),
        ("system_prompt", "\0".to_owned()),
        ("runtime_family", "custom-command".to_owned()),
        ("provisioning_intent", "overwrite".to_owned()),
    ] {
        let mut proposal = json!({"display_name":"Helper","system_prompt":"Use evidence."});
        proposal[field] = json!(value);
        let proposal: ProposalArguments = serde_json::from_value(proposal).expect("shape");
        assert!(proposal.validate().is_err(), "{field}");
    }
}

#[test]
fn current_owner_owned_identity_binding_and_both_members_are_required() {
    let scope = scope();
    let owned = BTreeSet::from([scope.resident.clone()]);
    let members = BTreeSet::from([scope.owner.clone(), scope.resident.clone()]);
    assert!(
        validate_origin_snapshot(&scope, &scope.owner, &owned, &scope.binding, &members).is_ok()
    );
    let other = Hex64::parse("d".repeat(64)).expect("other");
    assert!(validate_origin_snapshot(&scope, &other, &owned, &scope.binding, &members).is_err());
    assert!(validate_origin_snapshot(
        &scope,
        &scope.owner,
        &BTreeSet::new(),
        &scope.binding,
        &members
    )
    .is_err());
    let changed_binding = Sha256Ref::parse(format!("sha256:{}", "e".repeat(64))).expect("binding");
    assert!(
        validate_origin_snapshot(&scope, &scope.owner, &owned, &changed_binding, &members).is_err()
    );
    for departed in [&scope.owner, &scope.resident] {
        let mut current_members = members.clone();
        current_members.remove(departed);
        assert!(validate_origin_snapshot(
            &scope,
            &scope.owner,
            &owned,
            &scope.binding,
            &current_members
        )
        .is_err());
    }
}

#[test]
fn stopped_lease_is_revoked_even_with_an_unchanged_identity_and_binding() {
    let scope = scope();
    scope.active.store(false, Ordering::SeqCst);
    assert!(validate_origin_snapshot(
        &scope,
        &scope.owner,
        &BTreeSet::from([scope.resident.clone()]),
        &scope.binding,
        &BTreeSet::from([scope.owner.clone(), scope.resident.clone()])
    )
    .is_err());
}

#[test]
fn cancelled_or_expired_waits_preserve_the_possible_native_side_effect() {
    for reason in [
        "review_expired",
        "caller_disconnected",
        "resident_session_ended",
        "review_closed",
    ] {
        let result = incomplete_result("request-1", Some("transaction-1"), reason);
        assert_eq!(result["status"], "incomplete");
        assert_eq!(result["transactionId"], "transaction-1");
        assert_eq!(result["authenticatedReady"], false);
        assert!(result["message"]
            .as_str()
            .expect("message")
            .contains("Creation may have begun"));
    }
}

#[test]
fn completion_inputs_cannot_supply_success_text_or_claim_authentication() {
    assert!(
        serde_json::from_value::<ResidentProposalCompletionV1>(json!({
            "status":"native_created", "transactionId":"transaction-1"
        }))
        .is_ok()
    );
    for field in [
        "authenticatedReady",
        "ownerPubkey",
        "message",
        "runtime",
        "statusOverride",
    ] {
        let mut value = json!({"status":"native_created", "transactionId":"transaction-1"});
        value[field] = json!("fabricated");
        assert!(
            serde_json::from_value::<ResidentProposalCompletionV1>(value).is_err(),
            "{field}"
        );
    }
}

#[cfg(unix)]
#[test]
fn disconnected_tool_caller_is_observed_without_waiting_for_review_expiry() {
    let (mut host, caller) = std::os::unix::net::UnixStream::pair().expect("socket pair");
    host.set_read_timeout(Some(Duration::from_millis(10)))
        .expect("bounded probe");
    assert!(!caller_disconnected(&mut host));
    drop(caller);
    let started = Instant::now();
    assert!(caller_disconnected(&mut host));
    assert!(started.elapsed() < Duration::from_millis(100));
}

#[cfg(unix)]
#[test]
fn a_second_frame_cannot_keep_a_creation_wait_alive() {
    use std::io::Write;
    let (mut host, mut caller) = std::os::unix::net::UnixStream::pair().expect("socket pair");
    host.set_read_timeout(Some(Duration::from_millis(10)))
        .expect("bounded probe");
    caller.write_all(b"extra").expect("caller frame");
    assert!(caller_disconnected(&mut host));
}

fn pending_store(scope: &ResidentProposalScope) -> Mutex<HashMap<String, PendingProposal>> {
    Mutex::new(HashMap::from([(
        "request-1".into(),
        PendingProposal {
            scope: scope.clone(),
            projection: ResidentProposalV1 {
                request_id: "request-1".into(),
                owner_pubkey: scope.owner.as_str().to_owned(),
                resident_pubkey: scope.resident.as_str().to_owned(),
                conversation_id: scope.conversation.as_str().to_owned(),
                display_name: "Scout".into(),
                system_prompt: "Inspect the assigned project.".into(),
                runtime_family: Some("hermes".into()),
                provisioning_intent: None,
                native_profile_name: None,
                created_at: Utc::now().to_rfc3339(),
            },
            deadline: Instant::now() + Duration::from_secs(3),
            native_transaction_id: Some("native-transaction-1".into()),
            native_import: None,
            result: None,
            completion: None,
        },
    )]))
}

#[test]
fn a_waiting_caller_gets_one_actual_result_and_ack_retries_do_not_replace_it() {
    let scope = scope();
    let store = Arc::new(pending_store(&scope));
    let waiter_store = store.clone();
    let waiter =
        thread::spawn(move || wait_for_result(&waiter_store, "request-1", &scope, || false));
    let result = json!({"status":"resident_created","transactionId":"native-transaction-1"});
    assert!(complete_pending(&store, "request-1", result.clone()).expect("complete"));
    assert!(
        !complete_pending(&store, "request-1", json!({"status":"replacement"})).expect("retry")
    );
    assert_eq!(waiter.join().expect("waiter").expect("result"), result);
    store.lock().expect("store").remove("request-1");
    assert!(!complete_pending(&store, "request-1", result).expect("consumed ack retry"));
}

#[test]
fn actual_wait_path_reports_expiry_disconnect_and_stopped_lease_with_transaction() {
    for reason in [
        "review_expired",
        "caller_disconnected",
        "resident_session_ended",
    ] {
        let scope = scope();
        let store = pending_store(&scope);
        if reason == "review_expired" {
            store
                .lock()
                .expect("store")
                .get_mut("request-1")
                .expect("pending")
                .deadline = Instant::now();
        }
        if reason == "resident_session_ended" {
            scope.active.store(false, Ordering::SeqCst);
        }
        let result = wait_for_result(&store, "request-1", &scope, || {
            reason == "caller_disconnected"
        })
        .expect("incomplete");
        assert_eq!(result["status"], "incomplete");
        assert_eq!(result["reason"], reason);
        assert_eq!(result["transactionId"], "native-transaction-1");
        assert!(
            !complete_pending(&store, "request-1", json!({"status":"late_success"}))
                .expect("terminal retry")
        );
    }
}

#[test]
fn closed_review_returns_incomplete_and_never_turns_into_late_success() {
    let scope = scope();
    let store = pending_store(&scope);
    let result = incomplete_result("request-1", Some("native-transaction-1"), "review_closed");
    assert!(complete_pending(&store, "request-1", result.clone()).expect("close"));
    assert_eq!(
        wait_for_result(&store, "request-1", &scope, || false).expect("closed result"),
        result
    );
    assert!(
        !complete_pending(&store, "request-1", json!({"status":"resident_created"}))
            .expect("late success")
    );
}

#[test]
fn successful_terminal_delivery_rechecks_authority_but_incomplete_keeps_owned_receipt() {
    let scope = scope();
    let incomplete = incomplete_result("request-1", Some("native-transaction-1"), "review_closed");
    assert!(
        validate_terminal_scope(&scope, &incomplete, &scope.owner, || panic!(
            "closed review grants nothing"
        ))
        .is_ok()
    );
    let other_owner = Hex64::parse("d".repeat(64)).expect("owner");
    assert!(validate_terminal_scope(&scope, &incomplete, &other_owner, || Ok(())).is_err());
    assert!(validate_terminal_scope(
        &scope,
        &json!({"status":"resident_created"}),
        &scope.owner,
        || Err("membership revoked during delivery".into())
    )
    .is_err());
}

#[test]
fn actual_attachment_requires_owner_requester_and_new_resident_in_current_members() {
    let scope = scope();
    let created = Hex64::parse("d".repeat(64)).expect("created");
    let other = Hex64::parse("e".repeat(64)).expect("participant");
    let origin = BTreeSet::from([scope.owner.clone(), scope.resident.clone(), other.clone()]);
    let mut target = origin.clone();
    assert!(!verified_attachment(&scope, &created, &origin, &target));
    target.insert(created.clone());
    assert!(verified_attachment(&scope, &created, &origin, &target));
    for missing in [&scope.owner, &scope.resident, &created] {
        let mut missing_target = target.clone();
        missing_target.remove(missing);
        assert!(!verified_attachment(
            &scope,
            &created,
            &origin,
            &missing_target
        ));
    }
    let mut without_visitor = target.clone();
    without_visitor.remove(&other);
    assert!(verified_attachment(
        &scope,
        &created,
        &origin,
        &without_visitor
    ));
}

#[test]
fn dm_expansion_preserves_immutable_audience_without_adopting_temporary_visitors() {
    let scope = scope();
    let created = Hex64::parse("d".repeat(64)).expect("created");
    let visitor = Hex64::parse("e".repeat(64)).expect("visitor");
    let origin = BTreeSet::from([scope.owner.clone(), scope.resident.clone()]);
    let mut target = origin.clone();
    target.insert(created.clone());
    assert!(verified_dm_expansion(&scope, &created, &origin, &target));
    target.insert(visitor);
    assert!(!verified_dm_expansion(&scope, &created, &origin, &target));
    target.remove(&scope.resident);
    assert!(!verified_dm_expansion(&scope, &created, &origin, &target));
}

#[test]
fn missing_cancelled_or_mismatched_completions_cannot_be_acknowledged_as_success() {
    let scope = scope();
    let pending = pending_store(&scope);
    let completed = Mutex::new(HashMap::new());
    let completion = ResidentProposalCompletionV1::NativeCreated {
        transaction_id: "native-transaction-1".into(),
        attached_conversation_id: Some("expanded-dm".into()),
    };
    assert!(
        !completion_scope_from(&pending, &completed, "request-1", &completion)
            .expect("pending")
            .expect("scope")
            .1
    );
    wait_for_result(&pending, "request-1", &scope, || true).expect("cancelled");
    assert!(completion_scope_from(&pending, &completed, "request-1", &completion).is_err());
    assert!(complete_pending_with_receipt(
        &pending,
        "request-1",
        json!({"status":"resident_created"}),
        Some(completion.clone())
    )
    .is_err());
    pending.lock().expect("pending").clear();
    assert!(completion_scope_from(&pending, &completed, "request-1", &completion).is_err());
    completed.lock().expect("completed").insert(
        "request-1".into(),
        CompletedProposal {
            native_import: None,
            scope,
            completion: completion.clone(),
            deadline: Instant::now() + Duration::from_secs(3),
        },
    );
    assert!(
        completion_scope_from(&pending, &completed, "request-1", &completion)
            .expect("acknowledged")
            .expect("scope")
            .1
    );
    let wrong = ResidentProposalCompletionV1::NativeCreated {
        transaction_id: "another-transaction".into(),
        attached_conversation_id: Some("expanded-dm".into()),
    };
    assert!(completion_scope_from(&pending, &completed, "request-1", &wrong).is_err());
    completed
        .lock()
        .expect("completed")
        .get_mut("request-1")
        .expect("receipt")
        .deadline = Instant::now();
    assert!(completion_scope_from(&pending, &completed, "request-1", &completion).is_err());
}

#[test]
fn successful_completion_acknowledgment_can_repeat_only_with_the_same_receipt() {
    let scope = scope();
    let pending = pending_store(&scope);
    let completed = Mutex::new(HashMap::new());
    let completion = ResidentProposalCompletionV1::DefinitionSaved {
        persona_id: "definition-1".into(),
    };
    let result = json!({"status":"definition_available","personaId":"definition-1"});
    assert!(complete_pending_with_receipt(
        &pending,
        "request-1",
        result.clone(),
        Some(completion.clone())
    )
    .expect("first completion"));
    assert!(!complete_pending_with_receipt(
        &pending,
        "request-1",
        result,
        Some(completion.clone())
    )
    .expect("same receipt retry"));
    assert!(
        completion_scope_from(&pending, &completed, "request-1", &completion)
            .expect("same pending receipt")
            .expect("scope")
            .1
    );
    let wrong = ResidentProposalCompletionV1::DefinitionSaved {
        persona_id: "definition-2".into(),
    };
    assert!(completion_scope_from(&pending, &completed, "request-1", &wrong).is_err());
}

#[test]
fn cancellation_removal_between_scope_snapshot_and_completion_cannot_acknowledge_success() {
    let scope = scope();
    let pending = pending_store(&scope);
    let completed = Mutex::new(HashMap::new());
    let completion = ResidentProposalCompletionV1::DefinitionSaved {
        persona_id: "definition-1".into(),
    };
    assert!(
        !completion_scope_from(&pending, &completed, "request-1", &completion)
            .expect("open snapshot")
            .expect("scope")
            .1
    );
    wait_for_result(&pending, "request-1", &scope, || true).expect("caller disconnected");
    pending
        .lock()
        .expect("pending guard removal")
        .remove("request-1");
    assert!(complete_pending_with_receipt(
        &pending,
        "request-1",
        json!({"status":"definition_available"}),
        Some(completion)
    )
    .is_err());
}

fn import_selection() -> NativeImportSelectionV1 {
    NativeImportSelectionV1 {
        semantic_id: "hermes:/fixture/hermes:research".into(),
        binding_fingerprint: "reviewed-binding".into(),
        start_now: true,
        start_on_app_launch: false,
        continuity_enabled: false,
    }
}

fn import_proposal() -> PendingProposal {
    let store = pending_store(&scope());
    let mut proposal = store
        .into_inner()
        .expect("store")
        .remove("request-1")
        .expect("proposal");
    proposal.projection.provisioning_intent = Some("import".into());
    proposal.projection.native_profile_name = Some("research".into());
    proposal.native_transaction_id = None;
    proposal
}

fn import_candidate() -> crate::managed_agents::DiscoveredResidentCandidate {
    serde_json::from_value(json!({
        "nativeType":"hermes", "nativeId":"research", "semanticId":"hermes:/fixture/hermes:research", "bindingFingerprint":"reviewed-binding", "displayName":"Research",
        "canonicalLocation":"/fixture/hermes", "readiness":{"status":"discovered", "message":"Not probed"}, "warnings":[],
        "bindingPreview":{"kind":"hermes", "schemaVersion":1, "profileName":"research", "hermesHome":"/fixture/hermes", "executablePath":"/fixture/hermes-cli", "runtimeVersion":"fixture-1", "defaultWorkspace":null}
    })).expect("synthetic discovery")
}

#[test]
fn import_arguments_and_completion_cannot_supply_replacement_instructions_or_a_resident() {
    let input = json!({"runtime_family":"hermes", "provisioning_intent":"import", "native_profile_name":"research"});
    assert!(serde_json::from_value::<ProposalArguments>(input.clone())
        .expect("shape")
        .validate()
        .is_ok());
    for (field, value) in [
        ("runtime_family", "openclaw"),
        ("system_prompt", "Replacement"),
        ("display_name", "Replacement"),
        ("native_profile_name", " "),
    ] {
        let mut changed = input.clone();
        changed[field] = json!(value);
        assert!(serde_json::from_value::<ProposalArguments>(changed)
            .expect("shape")
            .validate()
            .is_err());
    }
    assert!(serde_json::from_value::<ResidentProposalCompletionV1>(
        json!({"status":"native_imported"})
    )
    .is_ok());
    for field in ["residentPubkey", "binding", "authenticatedReady", "message"] {
        let mut completion = json!({"status":"native_imported"});
        completion[field] = json!("untrusted");
        assert!(serde_json::from_value::<ResidentProposalCompletionV1>(completion).is_err());
    }
}

#[test]
fn import_selection_requires_exact_current_name_semantic_identity_fingerprint_and_availability() {
    let selection = import_selection();
    let candidate = import_candidate();
    assert!(select_import_candidate("research", &selection, vec![candidate.clone()]).is_ok());
    assert!(select_import_candidate("Research", &selection, vec![candidate.clone()]).is_ok());
    assert!(select_import_candidate("other", &selection, vec![candidate.clone()]).is_err());
    assert!(select_import_candidate("research", &selection, vec![]).is_err());
    assert!(select_import_candidate(
        "research",
        &selection,
        vec![candidate.clone(), candidate.clone()]
    )
    .is_err());
    let mut stale = candidate.clone();
    stale.binding_fingerprint = "changed".into();
    assert!(select_import_candidate("research", &selection, vec![stale]).is_err());
    let mut unavailable = candidate.clone();
    unavailable.readiness = crate::managed_agents::ResidentReadiness::Unavailable {
        code: "missing".into(),
        message: "Missing executable".into(),
    };
    assert!(select_import_candidate("research", &selection, vec![unavailable]).is_err());
    let mut collision = candidate.clone();
    collision.semantic_id = "hermes:/fixture/other:research".into();
    assert_eq!(
        select_import_candidate("research", &selection, vec![collision, candidate])
            .expect("exact selection")
            .semantic_id,
        selection.semantic_id
    );
}

#[test]
fn an_import_is_admitted_once_and_retry_keeps_identity_and_owner_choices() {
    let mut proposal = import_proposal();
    let (mut attempt, first) =
        admit_import(&mut proposal, Some(import_selection()), false).expect("admitted");
    assert!(first);
    assert!(
        admit_import(&mut proposal, None, false).is_err(),
        "busy duplicate"
    );
    attempt.busy = false;
    attempt.resident_pubkey = Some("d".repeat(64));
    attempt.startup_error = Some("Unavailable".into());
    proposal.native_import = Some(attempt.clone());
    let (retried, first) = admit_import(&mut proposal, None, true).expect("retry exact start");
    assert!(!first);
    assert_eq!(retried.resident_pubkey, attempt.resident_pubkey);
    assert_eq!(
        retried.selection.continuity_enabled,
        attempt.selection.continuity_enabled
    );
    proposal.native_import = Some(attempt.clone());
    let mut other = import_selection();
    other.semantic_id = "other".into();
    assert!(admit_import(&mut proposal, Some(other), false).is_err());
    attempt.selection.start_now = false;
    proposal.native_import = Some(attempt);
    assert!(
        admit_import(&mut proposal, None, true).is_err(),
        "startup requires owner consent"
    );
    let (_, first) = admit_import(&mut proposal, None, false).expect("result-only inspection");
    assert!(!first);
}

#[test]
fn import_completion_resolves_only_one_exact_saved_identity() {
    let (mut attempt, _) =
        admit_import(&mut import_proposal(), Some(import_selection()), false).expect("admit");
    let key = "d".repeat(64);
    let other = "e".repeat(64);
    let identity = attempt.selection.semantic_id.clone();
    assert_eq!(
        select_imported_pubkey(
            [
                (key.clone(), identity.clone()),
                (other.clone(), "other-binding".into())
            ],
            &attempt
        )
        .expect("exact"),
        key
    );
    assert!(select_imported_pubkey([(other.clone(), "other-binding".into())], &attempt).is_err());
    assert!(select_imported_pubkey(
        [
            (key.clone(), identity.clone()),
            (other.clone(), identity.clone())
        ],
        &attempt
    )
    .is_err());
    attempt.resident_pubkey = Some(key);
    assert!(
        select_imported_pubkey([(other, identity)], &attempt).is_err(),
        "replaced identity"
    );
}

#[test]
fn terminal_import_keeps_saved_key_but_never_accepts_late_success_or_new_mutation() {
    for expired in [false, true] {
        let mut proposal = import_proposal();
        let (mut attempt, _) =
            admit_import(&mut proposal, Some(import_selection()), false).expect("admit");
        attempt.resident_pubkey = Some("d".repeat(64));
        attempt.busy = false;
        proposal.native_import = Some(attempt.clone());
        if expired {
            proposal.deadline = Instant::now() - Duration::from_secs(1);
        } else {
            proposal.result = Some(incomplete_result("request-1", None, "review_closed"));
        }
        assert!(admit_import(&mut proposal, None, false).is_err());
        let mut result = incomplete_result("request-1", None, "review_closed");
        add_import_incomplete(&mut result, Some(&attempt));
        assert_eq!(result["residentPubkey"], "d".repeat(64));
        assert_eq!(result["status"], "incomplete");
        let pending = Mutex::new(HashMap::from([("request-1".into(), proposal)]));
        assert!(completion_scope_from(
            &pending,
            &Mutex::new(HashMap::new()),
            "request-1",
            &ResidentProposalCompletionV1::NativeImported {}
        )
        .is_err());
    }
}

#[test]
fn active_but_unspawned_import_is_stopped_and_keeps_startup_failure() {
    let (mut attempt, _) =
        admit_import(&mut import_proposal(), Some(import_selection()), false).expect("admit");
    attempt.startup_error = Some("Hermes could not start".into());
    attempt.preferences_applied = true;
    let mut resident = super::super::resident_registry::ResidentRegistryEntry {
        resident_pubkey: Hex64::parse("d".repeat(64)).expect("key"),
        display_name: "Research".into(),
        persona_id: None,
        runtime: super::super::resident_registry::ResidentRuntimeBinding {
            runtime_id: None,
            runtime_command: "/fixture/hermes".into(),
            provider_id: None,
            model_id: None,
        },
        status: "stopped".into(),
        active: true,
        created_at: "fixture".into(),
        updated_at: "fixture".into(),
    };
    let saved = project_import_result(&resident, &attempt);
    assert!(!saved.process_running);
    assert!(
        should_start_import(true, false, &attempt, &saved),
        "an active unspawned definition must reach the requested-start branch"
    );
    assert!(
        !should_start_import(false, false, &attempt, &saved),
        "result-only retry cannot start"
    );
    assert!(
        should_start_import(false, true, &attempt, &saved),
        "explicit retry starts the same saved resident"
    );
    assert!(!saved.authenticated_ready);
    assert_eq!(
        saved.startup_error.as_deref(),
        Some("Hermes could not start")
    );
    resident.status = "running".into();
    let running = project_import_result(&resident, &attempt);
    assert!(running.process_running);
    assert!(!should_start_import(true, false, &attempt, &running));
    assert!(!running.authenticated_ready);
    assert!(running.startup_error.is_none());
}

#[test]
fn failed_import_opt_out_persistence_blocks_launch_and_requested_start_on_every_retry() {
    let (mut attempt, _) =
        admit_import(&mut import_proposal(), Some(import_selection()), false).expect("admit");
    attempt.resident_pubkey = Some("d".repeat(64));
    attempt.reused = Some(false);
    attempt.selection.continuity_enabled = false;
    attempt.selection.start_on_app_launch = true;
    for _ in 0..2 {
        let result = persist_import_preferences(
            &mut attempt,
            |enabled| {
                assert!(!enabled);
                Err("Consent store unavailable".into())
            },
            |_| panic!("autostart must remain disabled before continuity consent persists"),
        );
        assert!(result.is_err());
        assert!(!attempt.preferences_applied);
        let saved = NativeImportResultV1 {
            resident_pubkey: "d".repeat(64),
            display_name: "Research".into(),
            native_profile_name: "research".into(),
            reused: false,
            process_running: false,
            authenticated_ready: false,
            startup_error: None,
            warning: None,
            preferences_error: attempt.preferences_error.clone(),
        };
        assert!(!should_start_import(true, false, &attempt, &saved));
        assert!(!should_start_import(false, true, &attempt, &saved));
        assert_eq!(
            attempt.resident_pubkey.as_deref(),
            Some("d".repeat(64).as_str())
        );
    }
    let calls = std::cell::RefCell::new(Vec::new());
    persist_import_preferences(
        &mut attempt,
        |enabled| {
            calls.borrow_mut().push(("continuity", enabled));
            Ok(())
        },
        |enabled| {
            calls.borrow_mut().push(("launch", enabled));
            Ok(())
        },
    )
    .expect("explicit reviewed-settings retry");
    assert_eq!(*calls.borrow(), [("continuity", false), ("launch", true)]);
    assert!(attempt.preferences_applied);
    assert!(attempt.preferences_error.is_none());
}

#[test]
fn reused_import_never_rewrites_existing_continuity_or_launch_preferences() {
    let (mut attempt, _) =
        admit_import(&mut import_proposal(), Some(import_selection()), false).expect("admit");
    attempt.reused = Some(true);
    persist_import_preferences(
        &mut attempt,
        |_| panic!("reuse preserves handoff choice"),
        |_| panic!("reuse preserves autostart"),
    )
    .expect("reuse");
    assert!(attempt.preferences_applied);
}
