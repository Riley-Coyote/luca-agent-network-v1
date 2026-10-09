use luca_protocol::{
    CanonicalTimestamp, Hex64, InitiativeContextV1, InitiativeContractError,
    InitiativeDispositionV1, InitiativePlanningDecisionV1, InitiativePlanningOutcomeV1,
    InitiativeThreadKindV1, InitiativeThreadV1, InitiativeTransitionCauseV1, OpaqueId, SafeU53,
    Sha256Ref, INITIATIVE_PROTOCOL, JSON_SAFE_INTEGER_MAX, MAX_INITIATIVE_SOURCE_REFS,
};
use serde_json::{json, Value};

fn reference(character: char) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", character.to_string().repeat(64)))
        .expect("fixture reference")
}

fn timestamp(value: &str) -> CanonicalTimestamp {
    CanonicalTimestamp::parse(value).expect("fixture timestamp")
}

fn thread() -> InitiativeThreadV1 {
    serde_json::from_value(json!({
        "protocol": INITIATIVE_PROTOCOL,
        "thread_id": "initiative:thread-1",
        "owner_pubkey": "a".repeat(64),
        "resident_pubkey": "b".repeat(64),
        "kind": "shared",
        "disposition": "carried",
        "revision": 1,
        "canonical_thread_ref": reference('c'),
        "canonical_revision_ref": reference('d'),
        "source_refs": [reference('e')],
        "checkpoint_ref": reference('f'),
        "updated_at": "2026-10-07T10:00:00Z"
    }))
    .expect("valid body-free fixture thread")
}

fn context(thread: &InitiativeThreadV1, now: &str) -> InitiativeContextV1 {
    InitiativeContextV1 {
        owner_pubkey: thread.owner_pubkey.clone(),
        resident_pubkey: thread.resident_pubkey.clone(),
        expected_revision: thread.revision,
        now: timestamp(now),
    }
}

fn request_id() -> OpaqueId {
    OpaqueId::parse("initiative:request-1").expect("fixture request")
}

fn decision(
    thread: &InitiativeThreadV1,
    result: InitiativePlanningOutcomeV1,
) -> InitiativePlanningDecisionV1 {
    InitiativePlanningDecisionV1 {
        protocol: INITIATIVE_PROTOCOL.into(),
        request_id: request_id(),
        owner_pubkey: thread.owner_pubkey.clone(),
        resident_pubkey: thread.resident_pubkey.clone(),
        thread_id: thread.thread_id.clone(),
        expected_revision: thread.revision,
        canonical_revision_ref: thread.canonical_revision_ref.clone(),
        result,
    }
}

#[test]
fn shared_decline_and_retire_stay_suppressed_across_ticks_and_observations() {
    for disposition in [
        InitiativeDispositionV1::Declined,
        InitiativeDispositionV1::Retired,
    ] {
        let mut thread = thread();
        thread.disposition = disposition;
        let original = thread.clone();
        for now in ["2026-10-07T11:00:00Z", "2027-10-07T11:00:00Z"] {
            let context = context(&thread, now);
            assert!(!thread.eligible_at(&context).expect("exact context"));
            for cause in [
                InitiativeTransitionCauseV1::Cadence,
                InitiativeTransitionCauseV1::NewObservation,
                InitiativeTransitionCauseV1::ResidentRequest {
                    source_ref: reference('0'),
                },
            ] {
                assert_eq!(
                    thread.transition(&context, InitiativeDispositionV1::Carried, None, &cause),
                    Err(InitiativeContractError::Ineligible)
                );
            }
            assert_eq!(
                thread.apply_planning_decision(
                    &decision(&thread, InitiativePlanningOutcomeV1::Pursue),
                    &request_id(),
                    &context,
                ),
                Err(InitiativeContractError::Ineligible)
            );
        }
        assert_eq!(thread, original);
        let reopened = thread
            .transition(
                &context(&thread, "2026-10-07T11:00:00Z"),
                InitiativeDispositionV1::Carried,
                None,
                &InitiativeTransitionCauseV1::OwnerRequest {
                    source_ref: reference('0'),
                },
            )
            .expect("externally authenticated explicit owner reopen");
        assert_eq!(reopened.revision.get(), 2);
        assert_eq!(reopened.canonical_thread_ref, original.canonical_thread_ref);
        assert_eq!(
            reopened.canonical_revision_ref,
            original.canonical_revision_ref
        );
        assert_eq!(reopened.checkpoint_ref, original.checkpoint_ref);
    }
}

#[test]
fn own_pursuit_requires_an_explicit_request_from_the_exact_resident_to_reopen() {
    let mut thread = thread();
    thread.kind = InitiativeThreadKindV1::Own;
    thread.disposition = InitiativeDispositionV1::Retired;
    let context = context(&thread, "2026-10-07T11:00:00Z");
    for cause in [
        InitiativeTransitionCauseV1::Cadence,
        InitiativeTransitionCauseV1::NewObservation,
        InitiativeTransitionCauseV1::OwnerRequest {
            source_ref: reference('0'),
        },
    ] {
        assert_eq!(
            thread.transition(&context, InitiativeDispositionV1::Carried, None, &cause),
            Err(InitiativeContractError::Ineligible)
        );
    }
    let resident_request = InitiativeTransitionCauseV1::ResidentRequest {
        source_ref: reference('0'),
    };
    let reopened = thread
        .transition(
            &context,
            InitiativeDispositionV1::Carried,
            None,
            &resident_request,
        )
        .expect("exact resident's externally authenticated request");
    assert_eq!(reopened.kind, InitiativeThreadKindV1::Own);
    assert_eq!(reopened.source_refs, vec![reference('0')]);
    let mut wrong_resident = context.clone();
    wrong_resident.resident_pubkey = Hex64::parse("1".repeat(64)).expect("other resident");
    assert_eq!(
        thread.transition(
            &wrong_resident,
            InitiativeDispositionV1::Carried,
            None,
            &resident_request,
        ),
        Err(InitiativeContractError::Binding)
    );
}

#[test]
fn deferral_is_real_eligibility_and_no_change_does_not_consume_it() {
    let original = thread();
    let deferred = original
        .apply_planning_decision(
            &decision(
                &original,
                InitiativePlanningOutcomeV1::Defer {
                    eligible_after: timestamp("2026-10-07T12:00:00Z"),
                },
            ),
            &request_id(),
            &context(&original, "2026-10-07T11:00:00Z"),
        )
        .expect("bounded deliberate deferral");
    let before = context(&deferred, "2026-10-07T11:59:59Z");
    assert!(!deferred.eligible_at(&before).expect("exact context"));
    assert_eq!(
        deferred.apply_planning_decision(
            &decision(&deferred, InitiativePlanningOutcomeV1::Pursue),
            &request_id(),
            &before,
        ),
        Err(InitiativeContractError::Ineligible)
    );
    assert_eq!(
        deferred
            .apply_planning_decision(
                &decision(&deferred, InitiativePlanningOutcomeV1::NoChange),
                &request_id(),
                &before,
            )
            .expect("no operational change"),
        deferred
    );
    let due = context(&deferred, "2026-10-07T12:00:00Z");
    assert!(deferred.eligible_at(&due).expect("exact context"));
    for cause in [
        InitiativeTransitionCauseV1::Cadence,
        InitiativeTransitionCauseV1::NewObservation,
    ] {
        assert_eq!(
            original
                .transition(
                    &context(&original, "2026-10-07T11:00:00Z"),
                    InitiativeDispositionV1::Carried,
                    None,
                    &cause,
                )
                .expect("passive checks create no artificial progress"),
            original
        );
        let resumed = deferred
            .transition(&due, InitiativeDispositionV1::Carried, None, &cause)
            .expect("elapsed deferral changes real disposition");
        assert_eq!(resumed.disposition, InitiativeDispositionV1::Carried);
        assert_eq!(resumed.eligible_after, None);
        assert_eq!(resumed.revision.get(), 3);
    }
    let pursued = deferred
        .apply_planning_decision(
            &decision(&deferred, InitiativePlanningOutcomeV1::Pursue),
            &request_id(),
            &due,
        )
        .expect("eligible proposal, not a runtime grant");
    assert_eq!(pursued.disposition, InitiativeDispositionV1::Carried);
    assert_eq!(pursued.eligible_after, None);
    assert_eq!(pursued.revision.get(), 3);
    assert_eq!(
        original.apply_planning_decision(
            &decision(
                &original,
                InitiativePlanningOutcomeV1::Defer {
                    eligible_after: timestamp("2026-10-07T11:00:00Z"),
                },
            ),
            &request_id(),
            &context(&original, "2026-10-07T11:00:00Z"),
        ),
        Err(InitiativeContractError::Timestamp)
    );
}

#[test]
fn no_change_rejects_wrong_principals_requests_and_stale_revisions() {
    let thread = thread();
    let context = context(&thread, "2026-10-07T11:00:00Z");
    let valid = decision(&thread, InitiativePlanningOutcomeV1::NoChange);
    let mut wrong_owner = valid.clone();
    wrong_owner.owner_pubkey = Hex64::parse("0".repeat(64)).expect("other owner");
    let mut wrong_resident = valid.clone();
    wrong_resident.resident_pubkey = Hex64::parse("1".repeat(64)).expect("other resident");
    let mut wrong_request = valid.clone();
    wrong_request.request_id = OpaqueId::parse("initiative:other-request").expect("other request");
    let mut wrong_thread = valid.clone();
    wrong_thread.thread_id = OpaqueId::parse("initiative:other-thread").expect("other thread");
    let mut wrong_canonical_revision = valid.clone();
    wrong_canonical_revision.canonical_revision_ref = reference('0');
    for mismatched in [
        wrong_owner,
        wrong_resident,
        wrong_request,
        wrong_thread,
        wrong_canonical_revision,
    ] {
        assert_eq!(
            thread.apply_planning_decision(&mismatched, &request_id(), &context),
            Err(InitiativeContractError::Binding)
        );
    }
    let mut stale = valid.clone();
    stale.expected_revision = SafeU53::new(2).expect("other revision");
    assert_eq!(
        thread.apply_planning_decision(&stale, &request_id(), &context),
        Err(InitiativeContractError::Revision)
    );
    let mut stale_context = context.clone();
    stale_context.expected_revision = stale.expected_revision;
    assert_eq!(
        thread.apply_planning_decision(&valid, &request_id(), &stale_context),
        Err(InitiativeContractError::Revision)
    );
    let mut wrong_context = context.clone();
    wrong_context.owner_pubkey = Hex64::parse("0".repeat(64)).expect("other owner");
    assert_eq!(
        thread.eligible_at(&wrong_context),
        Err(InitiativeContractError::Binding)
    );
}

#[test]
fn completed_threads_and_revision_exhaustion_never_admit_another_pursuit() {
    let original = thread();
    let completed = original
        .transition(
            &context(&original, "2026-10-07T11:00:00Z"),
            InitiativeDispositionV1::Completed,
            None,
            &InitiativeTransitionCauseV1::VerifiedCompletion {
                checkpoint_ref: reference('0'),
            },
        )
        .expect("externally verified completion");
    assert!(!completed
        .eligible_at(&context(&completed, "2026-10-08T11:00:00Z"))
        .expect("exact context"));
    assert_eq!(
        completed.transition(
            &context(&completed, "2026-10-08T11:00:00Z"),
            InitiativeDispositionV1::Carried,
            None,
            &InitiativeTransitionCauseV1::OwnerRequest {
                source_ref: reference('1'),
            },
        ),
        Err(InitiativeContractError::Ineligible)
    );
    let mut exhausted = original;
    exhausted.revision = SafeU53::new(JSON_SAFE_INTEGER_MAX).expect("maximum revision");
    assert_eq!(
        exhausted.apply_planning_decision(
            &decision(&exhausted, InitiativePlanningOutcomeV1::Pursue),
            &request_id(),
            &context(&exhausted, "2026-10-07T11:00:00Z"),
        ),
        Err(InitiativeContractError::Revision)
    );
}

#[test]
fn saturated_snapshot_provenance_cannot_disable_explicit_let_it_go() {
    let mut thread = thread();
    thread.source_refs = "0123456789abcdef".chars().map(reference).collect();
    assert_eq!(thread.source_refs.len(), MAX_INITIATIVE_SOURCE_REFS);
    thread.validate().expect("full sorted provenance snapshot");
    let fresh_source = Sha256Ref::parse(format!("sha256:{}", "01".repeat(32)))
        .expect("fresh explicit owner request");
    let retired = thread
        .transition(
            &context(&thread, "2026-10-07T11:00:00Z"),
            InitiativeDispositionV1::Retired,
            None,
            &InitiativeTransitionCauseV1::OwnerRequest {
                source_ref: fresh_source.clone(),
            },
        )
        .expect("let-it-go remains available at the provenance cap");
    assert_eq!(retired.disposition, InitiativeDispositionV1::Retired);
    assert_eq!(retired.source_refs, vec![fresh_source]);
    assert_eq!(retired.canonical_thread_ref, thread.canonical_thread_ref);
    assert_eq!(
        retired.canonical_revision_ref,
        thread.canonical_revision_ref
    );
    assert!(!retired
        .eligible_at(&context(&retired, "2026-10-08T11:00:00Z"))
        .expect("exact context"));
}

#[test]
fn strict_thread_deserialization_rejects_malformed_or_unbounded_metadata() {
    let valid = serde_json::to_value(thread()).expect("fixture JSON");
    for (field, value) in [
        ("protocol", json!("polyphonic.initiative.v2")),
        ("resident_pubkey", json!("a".repeat(64))),
        ("revision", json!(0)),
        ("source_refs", json!([])),
        ("source_refs", json!([reference('e'), reference('e')])),
        ("source_refs", json!([reference('f'), reference('e')])),
        (
            "source_refs",
            json!(vec![reference('e'); MAX_INITIATIVE_SOURCE_REFS + 1]),
        ),
        ("disposition", json!("deferred")),
        ("eligible_after", json!("2026-10-07T12:00:00Z")),
        ("updated_at", json!("2026-10-07T10:00:00.000Z")),
        ("canonical_thread_ref", json!("/private/semantic-thread.md")),
    ] {
        let mut invalid = valid.clone();
        invalid[field] = value;
        assert!(
            serde_json::from_value::<InitiativeThreadV1>(invalid).is_err(),
            "{field}"
        );
    }
    let mut completed = valid.clone();
    completed["disposition"] = json!("completed");
    completed
        .as_object_mut()
        .expect("fixture object")
        .remove("checkpoint_ref");
    assert!(serde_json::from_value::<InitiativeThreadV1>(completed).is_err());
    let roundtrip: InitiativeThreadV1 = serde_json::from_value(valid).expect("strict roundtrip");
    assert_eq!(roundtrip, thread());
}

#[test]
fn strict_planning_deserialization_rejects_authority_and_unknown_outcome_fields() {
    let valid = serde_json::to_value(decision(&thread(), InitiativePlanningOutcomeV1::Pursue))
        .expect("fixture decision JSON");
    for field in [
        "model",
        "tools",
        "grants",
        "working_folder",
        "budget",
        "cause",
        "body",
    ] {
        let mut injected = valid.clone();
        injected[field] = json!("untrusted authority or body");
        assert!(
            serde_json::from_value::<InitiativePlanningDecisionV1>(injected).is_err(),
            "{field}"
        );
        let mut nested = valid.clone();
        nested["result"][field] = json!("untrusted authority or body");
        assert!(
            serde_json::from_value::<InitiativePlanningDecisionV1>(nested).is_err(),
            "nested {field}"
        );
    }
    for result in [
        json!({"outcome": "reopen"}),
        json!({"outcome": "defer"}),
        json!({"outcome": "defer", "eligible_after": "tomorrow"}),
        json!({"outcome": "defer", "eligible_after": null}),
        json!({"outcome": "pursue", "eligible_after": "2026-10-07T12:00:00Z"}),
        json!({"outcome": "decline", "eligible_after": null}),
        json!({"outcome": "no_change", "owner_reauthorized": true}),
    ] {
        let mut malformed = valid.clone();
        malformed["result"] = result;
        assert!(serde_json::from_value::<InitiativePlanningDecisionV1>(malformed).is_err());
    }
    let mut wrong_version = valid.clone();
    wrong_version["protocol"] = json!("polyphonic.initiative.v2");
    assert!(serde_json::from_value::<InitiativePlanningDecisionV1>(wrong_version).is_err());
    let encoded = serde_json::to_string(&valid).expect("fixture encoded decision");
    let duplicated = encoded.replacen(
        "\"expected_revision\":1",
        "\"expected_revision\":1,\"expected_revision\":1",
        1,
    );
    assert!(serde_json::from_str::<InitiativePlanningDecisionV1>(&duplicated).is_err());
    let _: Value = serde_json::from_str(&encoded).expect("ordinary fixture JSON");
}
