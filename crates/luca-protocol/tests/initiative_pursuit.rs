use luca_protocol::*;
use serde_json::json;

fn reference(c: char) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", c.to_string().repeat(64))).expect("fixture reference")
}
fn timestamp(value: &str) -> CanonicalTimestamp {
    CanonicalTimestamp::parse(value).expect("fixture time")
}
fn millis(value: &str) -> u64 {
    u64::try_from(
        chrono::DateTime::parse_from_rfc3339(value)
            .expect("fixture time")
            .timestamp_millis(),
    )
    .expect("positive time")
}
fn request() -> InitiativePursuitRequestV1 {
    let semantic: InitiativeSemanticThreadV1 = serde_json::from_value(json!({
        "protocol": INITIATIVE_SEMANTIC_THREAD_PROTOCOL, "thread_id": "thread:own-inquiry",
        "owner_pubkey": "a".repeat(64), "resident_pubkey": "b".repeat(64),
        "kind": "own", "disposition": "carried", "revision": 0,
        "body": "PRIVATE_CARRIED_SENTINEL: a persistent curiosity, not a delivery quota.",
        "source_event_ids": [], "source_refs": [reference('e')],
        "created_at": "2025-01-01T12:00:00Z", "updated_at": "2025-01-01T12:00:00Z"
    }))
    .expect("canonical fixture");
    let thread = InitiativeThreadV1 {
        protocol: INITIATIVE_PROTOCOL.into(),
        thread_id: semantic.thread_id.clone(),
        owner_pubkey: semantic.owner_pubkey.clone(),
        resident_pubkey: semantic.resident_pubkey.clone(),
        kind: semantic.kind,
        disposition: InitiativeDispositionV1::Carried,
        revision: SafeU53::new(7).expect("revision"),
        canonical_thread_ref: derive_initiative_thread_ref(
            &semantic.owner_pubkey,
            &semantic.resident_pubkey,
            &semantic.thread_id,
        )
        .expect("identity"),
        canonical_revision_ref: semantic.revision_ref().expect("canonical ref"),
        source_refs: semantic.source_refs.clone(),
        checkpoint_ref: None,
        eligible_after: None,
        updated_at: timestamp("2026-10-08T12:00:00Z"),
    };
    InitiativePursuitRequestV1 {
        protocol: INITIATIVE_PURSUIT_PROTOCOL.into(),
        job_id: OpaqueId::parse("pursuit:fixture").expect("job"),
        owner_pubkey: semantic.owner_pubkey.clone(),
        resident_pubkey: semantic.resident_pubkey.clone(),
        binding_ref: reference('c'),
        session_epoch: SafeU53::new(3).expect("epoch"),
        thread,
        semantic_thread: semantic,
        evidence: Vec::new(),
        admitted_at: timestamp("2026-10-08T12:00:00Z"),
        deadline_unix_ms: SafeU53::new(millis("2026-10-08T12:03:00Z")).expect("deadline"),
        max_result_bytes: SafeU53::new(24 * 1024).expect("bound"),
    }
}
fn result(
    request: &InitiativePursuitRequestV1,
    outcome: InitiativePursuitOutcomeV1,
) -> InitiativePursuitResultV1 {
    InitiativePursuitResultV1 {
        protocol: INITIATIVE_PURSUIT_PROTOCOL.into(),
        job_id: request.job_id.clone(),
        owner_pubkey: request.owner_pubkey.clone(),
        resident_pubkey: request.resident_pubkey.clone(),
        thread_id: request.thread.thread_id.clone(),
        expected_revision: request.thread.revision,
        canonical_revision_ref: request.thread.canonical_revision_ref.clone(),
        binding_ref: request.binding_ref.clone(),
        session_epoch: request.session_epoch,
        context_ref: request.context_ref().expect("context"),
        result: outcome,
    }
}
fn creation(request: &InitiativePursuitRequestV1) -> InitiativePursuitOutcomeV1 {
    InitiativePursuitOutcomeV1::Created {
        title: "A small inquiry".into(),
        markdown: "# PRIVATE_CREATION_SENTINEL\nAn authored thought, not a claim of web research."
            .into(),
        source_refs: vec![request.thread.canonical_revision_ref.clone()],
    }
}

#[test]
fn private_own_inquiry_is_bounded_correlated_and_not_a_deliverable() {
    let request = request();
    let own = InitiativePursuitOutcomeV1::OwnInquiry {
        body: "PRIVATE_OWN_SENTINEL: I want to revisit how this pattern generalizes.".into(),
        source_refs: vec![request.thread.canonical_revision_ref.clone()],
    };
    let valid = result(&request, own.clone());
    valid.validate_against_at(&request, millis("2026-10-08T12:00:01Z")).unwrap();
    let wire = serde_json::to_value(&valid).unwrap();
    assert!(serde_json::from_value::<InitiativePursuitResultV1>(wire.clone()).is_ok());
    assert_eq!(wire["result"]["outcome"], "own_inquiry");
    assert!(wire["result"].get("title").is_none());
    assert!(wire["result"].get("markdown").is_none());
    assert!(!format!("{valid:?}").contains("PRIVATE_OWN_SENTINEL"));
    let mut authority = wire.clone();
    authority["result"]["canonical_source_clean"] = json!(true);
    assert!(serde_json::from_value::<InitiativePursuitResultV1>(authority).is_err());
    let mut foreign = own.clone();
    if let InitiativePursuitOutcomeV1::OwnInquiry { source_refs, .. } = &mut foreign {
        source_refs.push(reference('0'));
        source_refs.sort();
    }
    assert_eq!(result(&request, foreign).validate_against(&request), Err(InitiativePursuitError::Binding));
    let mut oversized = own;
    if let InitiativePursuitOutcomeV1::OwnInquiry { body, .. } = &mut oversized {
        *body = "x".repeat(MAX_INITIATIVE_THREAD_BODY_BYTES + 1);
    }
    assert_eq!(result(&request, oversized).validate(), Err(InitiativePursuitError::Bounds));
    assert_eq!(valid.validate_against_at(&request, request.deadline_unix_ms.get()), Err(InitiativePursuitError::Deadline));
}

#[test]
fn retire_is_resident_owned_only_and_has_no_extra_body_or_authority() {
    let own = request();
    result(&own, InitiativePursuitOutcomeV1::Retire).validate_against(&own).unwrap();
    let mut shared = own;
    shared.semantic_thread.kind = InitiativeThreadKindV1::Shared;
    shared.thread.kind = InitiativeThreadKindV1::Shared;
    shared.thread.canonical_revision_ref = shared.semantic_thread.revision_ref().unwrap();
    assert_eq!(result(&shared, InitiativePursuitOutcomeV1::Retire).validate_against(&shared), Err(InitiativePursuitError::Ineligible));
    for outcome in [
        json!({"outcome":"retire","body":"hidden data"}),
        json!({"outcome":"own_inquiry","body":"Inquiry","source_refs":[reference('e')],"grants":[]}),
        json!({"outcome":"own_inquiry","body":null,"source_refs":[reference('e')]}),
        json!({"outcome":"own_inquiry","body":"Inquiry","source_refs":[reference('e')],"eligible_after":"2026-10-09T12:00:00Z"}),
    ] {
        assert!(serde_json::from_value::<InitiativePursuitOutcomeV1>(outcome).is_err());
    }
}

#[test]
fn creation_and_genuine_no_deliverable_choices_share_exact_private_correlation() {
    let request = request();
    request
        .validate()
        .expect("carried state without collection");
    for outcome in [
        creation(&request),
        InitiativePursuitOutcomeV1::NoChange,
        InitiativePursuitOutcomeV1::Decline,
        InitiativePursuitOutcomeV1::Defer {
            eligible_after: timestamp("2026-10-09T12:00:00Z"),
        },
    ] {
        let result = result(&request, outcome);
        result
            .validate_against_at(&request, millis("2026-10-08T12:00:01Z"))
            .expect("authentic authored choice");
        ResidentPrivateCognitionResultV1::InitiativePursuit { result }
            .validate_against(&ResidentPrivateCognitionRequestV1::InitiativePursuit {
                request: request.clone(),
            })
            .expect("typed private envelope");
    }
}

#[test]
fn no_change_does_not_bypass_principal_runtime_revision_or_context() {
    let request = request();
    let valid = result(&request, InitiativePursuitOutcomeV1::NoChange);
    let mut cases = Vec::new();
    let mut value = valid.clone();
    value.job_id = OpaqueId::parse("pursuit:other").expect("ID");
    cases.push(value);
    let mut value = valid.clone();
    value.owner_pubkey = Hex64::parse("d".repeat(64)).expect("owner");
    cases.push(value);
    let mut value = valid.clone();
    value.resident_pubkey = Hex64::parse("d".repeat(64)).expect("resident");
    cases.push(value);
    let mut value = valid.clone();
    value.binding_ref = reference('d');
    cases.push(value);
    let mut value = valid.clone();
    value.session_epoch = SafeU53::new(4).expect("epoch");
    cases.push(value);
    let mut value = valid.clone();
    value.expected_revision = SafeU53::new(6).expect("revision");
    cases.push(value);
    let mut value = valid.clone();
    value.canonical_revision_ref = reference('d');
    cases.push(value);
    let mut value = valid;
    value.context_ref = reference('d');
    cases.push(value);
    for value in cases {
        assert_eq!(
            value.validate_against(&request),
            Err(InitiativePursuitError::Binding)
        );
    }
}

#[test]
fn strict_outcomes_reject_extra_authority_null_bodies_and_unknown_provenance() {
    let request = request();
    let value = serde_json::to_value(&request).expect("wire request");
    for field in [
        "model", "provider", "tools", "paths", "grants", "budget", "publish",
    ] {
        let mut injected = value.clone();
        injected[field] = json!("model-selected authority");
        assert!(serde_json::from_value::<InitiativePursuitRequestV1>(injected).is_err());
        let mut outcome = json!({"outcome":"no_change"});
        outcome[field] = json!(null);
        assert!(serde_json::from_value::<InitiativePursuitOutcomeV1>(outcome).is_err());
    }
    for field in ["title", "markdown", "source_refs", "eligible_after"] {
        let mut outcome = json!({"outcome":"no_change"});
        outcome[field] = json!(null);
        assert!(serde_json::from_value::<InitiativePursuitOutcomeV1>(outcome).is_err());
    }
    let foreign = InitiativePursuitOutcomeV1::Created {
        title: "A title".into(),
        markdown: "Authored text".into(),
        source_refs: vec![
            reference('0'),
            request.thread.canonical_revision_ref.clone(),
        ],
    };
    // Sort before validation so this proves provenance, not merely ordering.
    let mut foreign = foreign;
    if let InitiativePursuitOutcomeV1::Created { source_refs, .. } = &mut foreign {
        source_refs.sort();
    }
    assert_eq!(
        result(&request, foreign).validate_against(&request),
        Err(InitiativePursuitError::Binding)
    );
}

#[test]
fn exclusive_original_deadline_bounds_and_redacted_debug_apply_to_created_data() {
    let request = request();
    let valid = result(&request, creation(&request));
    assert_eq!(
        valid.validate_against_at(&request, request.deadline_unix_ms.get()),
        Err(InitiativePursuitError::Deadline)
    );
    let debug = format!("{request:?} {valid:?}");
    assert!(!debug.contains("PRIVATE_CARRIED_SENTINEL"));
    assert!(!debug.contains("PRIVATE_CREATION_SENTINEL"));
    let oversized = InitiativePursuitOutcomeV1::Created {
        title: "Title".into(),
        markdown: "x".repeat(MAX_INITIATIVE_CREATION_MARKDOWN_BYTES + 1),
        source_refs: vec![request.thread.canonical_revision_ref.clone()],
    };
    assert_eq!(
        result(&request, oversized).validate(),
        Err(InitiativePursuitError::Bounds)
    );
    let mut expired = request.clone();
    expired.deadline_unix_ms = SafeU53::new(request.deadline_unix_ms.get() + 1).expect("deadline");
    assert_eq!(expired.validate(), Err(InitiativePursuitError::Deadline));
    let invalid_defer = result(
        &request,
        InitiativePursuitOutcomeV1::Defer {
            eligible_after: request.admitted_at.clone(),
        },
    );
    assert_eq!(
        invalid_defer.validate_against(&request),
        Err(InitiativePursuitError::Deadline)
    );
}

#[test]
fn cancellation_matches_only_the_exact_current_initiative_never_legacy_cognition() {
    let request = request();
    let control = ResidentPrivateCognitionControlV1::CancelInitiative {
        job_id: request.job_id.clone(),
        resident_pubkey: request.resident_pubkey.clone(),
        binding_ref: request.binding_ref.clone(),
        session_epoch: request.session_epoch,
    };
    let envelope = ResidentPrivateCognitionRequestV1::InitiativePursuit {
        request: request.clone(),
    };
    assert!(control.matches_initiative(&envelope));
    let mut wrong = request.clone();
    wrong.session_epoch = SafeU53::new(4).expect("epoch");
    assert!(
        !control.matches_initiative(&ResidentPrivateCognitionRequestV1::InitiativePursuit {
            request: wrong
        })
    );
    let legacy: ResidentPrivateCognitionRequestV1 = serde_json::from_value(json!({"kind":"metabolism","request":{
        "protocol":CONTINUITY_PROTOCOL,"job_id":request.job_id,"owner_pubkey":request.owner_pubkey,
        "resident_pubkey":request.resident_pubkey,"conversation_id":"conversation:fixture","source_event_id":"c".repeat(64),
        "binding_ref":request.binding_ref,"deadline_unix_ms":request.deadline_unix_ms,"max_result_bytes":4096
    }})).expect("unchanged legacy shape");
    assert!(!control.matches_initiative(&legacy));
    let mut injected = serde_json::to_value(control).expect("control wire");
    injected["conversation_id"] = json!("public:chat");
    assert!(serde_json::from_value::<ResidentPrivateCognitionControlV1>(injected).is_err());
}
