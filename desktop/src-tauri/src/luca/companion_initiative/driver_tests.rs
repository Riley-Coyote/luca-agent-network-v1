use super::super::{policy::InitiativePolicyV1, schema::INITIATIVE_STORE_FILENAME};
use super::*;
use luca_protocol::{
    Hex64, InitiativePlanningDecisionV1, InitiativePlanningOutcomeV1, InitiativeThreadKindV1,
    INITIATIVE_SEMANTIC_THREAD_PROTOCOL,
};
use std::cell::{Cell, RefCell};

fn id(value: &str) -> OpaqueId {
    OpaqueId::parse(value).expect("fixture ID")
}
fn number(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("fixture integer")
}
fn reference(character: char) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", character.to_string().repeat(64)))
        .expect("fixture reference")
}
fn time(value: &str) -> CanonicalTimestamp {
    CanonicalTimestamp::parse(value).expect("fixture time")
}
fn scope() -> InitiativeRuntimeScopeV1 {
    InitiativeRuntimeScopeV1 {
        control: InitiativeControlScopeV1 {
            owner_pubkey: Hex64::parse("a".repeat(64)).expect("owner"),
            resident_pubkey: Hex64::parse("b".repeat(64)).expect("resident"),
            window_id: id("window:fixture"),
            origin_scope_ref: reference('c'),
            now_unix_ms: u64::try_from(
                chrono::DateTime::parse_from_rfc3339("2026-10-08T12:00:00Z")
                    .expect("time")
                    .timestamp_millis(),
            )
            .expect("positive time"),
        },
        binding_ref: reference('d'),
        session_epoch: number(1),
        foreground_active: false,
        outreach_authorized: false,
    }
}
fn semantic() -> InitiativeSemanticThreadV1 {
    let scope = scope();
    InitiativeSemanticThreadV1 {
        protocol: INITIATIVE_SEMANTIC_THREAD_PROTOCOL.into(),
        thread_id: id("thread:older"),
        owner_pubkey: scope.control.owner_pubkey,
        resident_pubkey: scope.control.resident_pubkey,
        kind: InitiativeThreadKindV1::Shared,
        disposition: InitiativeDispositionV1::Carried,
        revision: number(0),
        body: "PRIVATE_OLDER_CARRIED_SENTINEL: unfinished work predating the recent chat window."
            .into(),
        source_event_ids: Vec::new(),
        source_refs: vec![reference('e')],
        eligible_after: None,
        created_at: time("2025-01-01T12:00:00Z"),
        updated_at: time("2025-01-01T12:00:00Z"),
    }
}
struct SentinelHost {
    body: RefCell<InitiativeSemanticThreadV1>,
    generation: Cell<u64>,
    allowed: Cell<bool>,
    calls: Cell<usize>,
}
impl SentinelHost {
    fn new() -> Self {
        Self {
            body: RefCell::new(semantic()),
            generation: Cell::new(1),
            allowed: Cell::new(true),
            calls: Cell::new(0),
        }
    }
}
impl InitiativeAdmissionHostV1 for SentinelHost {
    fn current(
        &self,
        scope: &InitiativeRuntimeScopeV1,
        _thread: &OpaqueId,
        _evidence: &[InitiativePlanningEvidenceV1],
        _node: Option<&OpaqueId>,
    ) -> Result<CurrentInitiativeAdmissionV1, InitiativeDriverErrorV1> {
        self.calls.set(self.calls.get() + 1);
        if !self.allowed.get() {
            return Err(InitiativeDriverErrorV1::Evidence);
        }
        Ok(CurrentInitiativeAdmissionV1 {
            owner: scope.control.owner_pubkey.clone(),
            window_id: scope.control.window_id.clone(),
            origin_scope_ref: scope.control.origin_scope_ref.clone(),
            captured_unix_ms: scope.control.now_unix_ms,
            binding_ref: scope.binding_ref.clone(),
            session_epoch: scope.session_epoch,
            authority: RevisionAuthorityTokenV1 {
                owner_pubkey: scope.control.owner_pubkey.clone(),
                store_epoch: "sentinel-store".into(),
                generation: number(self.generation.get()),
                authority_schema: 1,
                active_root_key_version: number(1),
                snapshot_fingerprint: reference('f'),
            },
            head_record_id: id("thread:older"),
            semantic: self.body.borrow().clone(),
            dependency_ref: reference('0'),
        })
    }
}
fn database(temp: &tempfile::TempDir) -> std::path::PathBuf {
    let parent = std::fs::canonicalize(temp.path()).expect("canonical internal fixture");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&parent, std::fs::Permissions::from_mode(0o700))
            .expect("private fixture parent");
    }
    parent.join(INITIATIVE_STORE_FILENAME)
}
fn enable(store: &mut InitiativeStore, scope: &InitiativeRuntimeScopeV1) {
    let mut policy = InitiativePolicyV1::disabled().expect("off policy");
    policy.enabled = true;
    policy.paused = false;
    policy.revision = number(1);
    store
        .set_policy(
            &scope.control,
            &id("policy:explicit-opt-in"),
            number(0),
            policy,
        )
        .expect("owner opt-in");
}
fn input(
    scope: &InitiativeRuntimeScopeV1,
    host: &SentinelHost,
    name: &str,
) -> InitiativeTickInputV1 {
    let body = host.body.borrow();
    InitiativeTickInputV1 {
        cycle: InitiativeCycleInputV1 {
            job_id: id(&format!("job:{name}")),
            request_id: id(&format!("request:{name}")),
            thread_id: body.thread_id.clone(),
            expected_thread_revision: number(1),
            canonical_revision_ref: body.revision_ref().expect("semantic ref"),
            dependency_ref: reference('0'),
            origin_conversation_id: None,
            budget: InitiativeTimeBudgetV1 {
                decision_ms: 1000,
                work_ms: 0,
                return_ms: 0,
            },
            deadline_unix_ms: scope.control.now_unix_ms + 1000,
            continued_from: None,
        },
        idle_for_ms: INITIATIVE_MIN_IDLE_MS,
        evidence: Vec::new(),
        dependency_node: None,
    }
}
fn prepared(
    store: &mut InitiativeStore,
    scope: &InitiativeRuntimeScopeV1,
    host: &SentinelHost,
) -> PreparedInitiativePlanningV1 {
    let input = input(scope, host, "sentinel");
    let current = capture_admission(
        host,
        scope,
        &input.cycle.thread_id,
        &input.evidence,
        input.dependency_node.as_ref(),
    )
    .expect("short sentinel capture");
    match prepare_planning(store, scope, input, current).expect("prepared without a model") {
        InitiativePreparationV1::Prepared(prepared) => prepared,
        _ => panic!("expected private prepared data"),
    }
}

#[test]
fn maximum_planning_deadline_is_valid_with_fractional_admission_time() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = InitiativeStore::open(&database(&temp)).unwrap();
    let mut scope = scope();
    scope.control.now_unix_ms += 999;
    enable(&mut store, &scope);
    let host = SentinelHost::new();
    let mut tick = input(&scope, &host, "fractional-maximum");
    tick.cycle.budget.decision_ms = MAX_INITIATIVE_PLANNING_DURATION_MS;
    tick.cycle.deadline_unix_ms = scope.control.now_unix_ms + MAX_INITIATIVE_PLANNING_DURATION_MS;
    let current = capture_admission(&host, &scope, &tick.cycle.thread_id, &[], None).unwrap();
    let InitiativePreparationV1::Prepared(prepared) = prepare_planning(&mut store, &scope, tick, current).unwrap()
        else { panic!("expected admitted maximum-duration plan"); };
    prepared.request().validate().unwrap();
    assert_eq!(prepared.request().deadline_unix_ms.get(),
        scope.control.now_unix_ms / 1000 * 1000 + MAX_INITIATIVE_PLANNING_DURATION_MS);
}
fn result(
    prepared: &PreparedInitiativePlanningV1,
    choice: InitiativePlanningOutcomeV1,
) -> InitiativePlanningResultV1 {
    let request = prepared.request();
    InitiativePlanningResultV1 {
        protocol: INITIATIVE_PLANNING_PROTOCOL.into(),
        job_id: request.job_id.clone(),
        binding_ref: request.binding_ref.clone(),
        session_epoch: request.session_epoch,
        context_ref: request.context_ref().expect("exact context"),
        decision: InitiativePlanningDecisionV1 {
            protocol: INITIATIVE_PROTOCOL.into(),
            request_id: request.job_id.clone(),
            owner_pubkey: request.owner_pubkey.clone(),
            resident_pubkey: request.resident_pubkey.clone(),
            thread_id: request.thread.thread_id.clone(),
            expected_revision: request.thread.revision,
            canonical_revision_ref: request.thread.canonical_revision_ref.clone(),
            result: choice,
        },
    }
}

#[test]
fn disabled_and_recent_activity_checks_do_not_read_heads_or_invoke_any_executor() {
    let temp = tempfile::tempdir().expect("fixture");
    let mut store = InitiativeStore::open(&database(&temp)).expect("store");
    let scope = scope();
    let host = SentinelHost::new();
    assert_eq!(
        inspect_tick(&mut store, &scope, INITIATIVE_MIN_IDLE_MS).expect("off inspection"),
        Some(InitiativeQuietReasonV1::Disabled)
    );
    assert_eq!(host.calls.get(), 0);
    enable(&mut store, &scope);
    assert_eq!(
        inspect_tick(&mut store, &scope, 0).expect("foreground-recent inspection"),
        Some(InitiativeQuietReasonV1::RecentActivity)
    );
    assert_eq!(host.calls.get(), 0);
}

#[test]
fn older_canonical_state_and_no_change_flow_without_models_or_false_progress() {
    let temp = tempfile::tempdir().expect("fixture");
    let mut store = InitiativeStore::open(&database(&temp)).expect("store");
    let mut scope = scope();
    let host = SentinelHost::new();
    enable(&mut store, &scope);
    let prepared = prepared(&mut store, &scope, &host);
    assert!(prepared
        .request()
        .semantic_thread
        .body
        .contains("PRIVATE_OLDER_CARRIED_SENTINEL"));
    assert_eq!(prepared.request().semantic_thread.revision.get(), 0);
    assert_eq!(prepared.request().thread.revision.get(), 1);
    scope.control.now_unix_ms += 1;
    let current = capture_admission(&host, &scope, &prepared.request.thread.thread_id, &[], None)
        .expect("fresh short capture");
    admit_prepared(&mut store, &scope, &prepared, &current)
        .expect("ledger claim only, no transport");
    let executor_calls = Cell::new(0);
    let sentinel_executor = |prepared: &PreparedInitiativePlanningV1| {
        executor_calls.set(executor_calls.get() + 1);
        result(prepared, InitiativePlanningOutcomeV1::NoChange)
    };
    let output = sentinel_executor(&prepared);
    let current = capture_admission(&host, &scope, &prepared.request.thread.thread_id, &[], None)
        .expect("fresh commit capture");
    let job = commit_planning(&mut store, &scope, &prepared, &output, &current)
        .expect("verified sentinel no-change");
    assert_eq!(executor_calls.get(), 1);
    assert_eq!(job.state, InitiativeJobStateV1::NoChange);
    assert_eq!(
        store
            .thread(&scope.control, &prepared.request.thread.thread_id)
            .expect("projection")
            .expect("thread")
            .revision,
        number(1)
    );
    assert_eq!(
        inspect_tick(&mut store, &scope, INITIATIVE_MIN_IDLE_MS).expect("unchanged cadence"),
        Some(InitiativeQuietReasonV1::Cadence)
    );
}

#[test]
fn withdrawal_or_changed_current_head_during_wait_rejects_the_old_choice() {
    let temp = tempfile::tempdir().expect("fixture");
    let mut store = InitiativeStore::open(&database(&temp)).expect("store");
    let scope = scope();
    let host = SentinelHost::new();
    enable(&mut store, &scope);
    let prepared = prepared(&mut store, &scope, &host);
    let current = capture_admission(&host, &scope, &prepared.request.thread.thread_id, &[], None)
        .expect("capture");
    admit_prepared(&mut store, &scope, &prepared, &current).expect("admit metadata");
    host.allowed.set(false);
    assert!(matches!(
        capture_admission(&host, &scope, &prepared.request.thread.thread_id, &[], None),
        Err(InitiativeDriverErrorV1::Evidence)
    ));
    host.allowed.set(true);
    host.generation.set(2);
    let current = capture_admission(&host, &scope, &prepared.request.thread.thread_id, &[], None)
        .expect("changed capture");
    assert!(matches!(
        commit_planning(
            &mut store,
            &scope,
            &prepared,
            &result(&prepared, InitiativePlanningOutcomeV1::Pursue),
            &current
        ),
        Err(InitiativeDriverErrorV1::Stale)
    ));
    let refs =
        preempt_owned(&mut store, &scope.control).expect("actual owned cancellation intents");
    assert_eq!(refs.len(), 1);
    assert_eq!(&refs[0].job_id, prepared.job_id());
    assert_eq!(refs[0].native_task_id, None);
}

#[test]
fn a_valid_decline_is_not_reopened_by_a_later_passive_tick() {
    let temp = tempfile::tempdir().expect("fixture");
    let mut store = InitiativeStore::open(&database(&temp)).expect("store");
    let mut scope = scope();
    let host = SentinelHost::new();
    enable(&mut store, &scope);
    let prepared = prepared(&mut store, &scope, &host);
    let current = capture_admission(&host, &scope, &prepared.request.thread.thread_id, &[], None)
        .expect("capture");
    admit_prepared(&mut store, &scope, &prepared, &current).expect("admit metadata");
    commit_planning(
        &mut store,
        &scope,
        &prepared,
        &result(&prepared, InitiativePlanningOutcomeV1::Decline),
        &current,
    )
    .expect("authentic decline");
    scope.control.now_unix_ms += INITIATIVE_CADENCE_MS + 1;
    let input = input(&scope, &host, "passive-later");
    let current = capture_admission(&host, &scope, &input.cycle.thread_id, &[], None)
        .expect("unchanged canonical capture");
    assert!(matches!(
        prepare_planning(&mut store, &scope, input, current).expect("quiet later tick"),
        InitiativePreparationV1::Quiet(InitiativeQuietReasonV1::Closed)
    ));
    assert_eq!(
        store
            .thread(&scope.control, &prepared.request.thread.thread_id)
            .expect("projection")
            .expect("thread")
            .disposition,
        InitiativeDispositionV1::Declined
    );
}
