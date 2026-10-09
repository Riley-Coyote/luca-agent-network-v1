use super::schema::INITIATIVE_STORE_FILENAME;
use super::{policy::*, store::InitiativeStore, types::*};
use luca_protocol::{
    CanonicalTimestamp, Hex64, InitiativeContextV1, InitiativeDispositionV1,
    InitiativePlanningDecisionV1, InitiativePlanningOutcomeV1, InitiativeThreadKindV1,
    InitiativeThreadV1, InitiativeTransitionCauseV1, OpaqueId, SafeU53, Sha256Ref,
    INITIATIVE_PROTOCOL,
};

fn id(value: &str) -> OpaqueId {
    OpaqueId::parse(value).expect("fixture ID")
}
fn reference(character: char) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", character.to_string().repeat(64)))
        .expect("fixture reference")
}
fn number(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("fixture safe integer")
}
fn time() -> CanonicalTimestamp {
    CanonicalTimestamp::parse("2026-10-08T12:00:00Z").expect("fixture time")
}
fn now() -> u64 {
    u64::try_from(
        chrono::DateTime::parse_from_rfc3339(time().as_str())
            .expect("fixture time")
            .timestamp_millis(),
    )
    .expect("positive time")
}
fn database_path(temp: &tempfile::TempDir) -> std::path::PathBuf {
    let parent = std::fs::canonicalize(temp.path()).expect("canonical internal fixture parent");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&parent, std::fs::Permissions::from_mode(0o700))
            .expect("explicit owner-only fixture parent");
    }
    parent.join(INITIATIVE_STORE_FILENAME)
}
fn scope() -> InitiativeRuntimeScopeV1 {
    InitiativeRuntimeScopeV1 {
        control: InitiativeControlScopeV1 {
            owner_pubkey: Hex64::parse("a".repeat(64)).expect("owner"),
            resident_pubkey: Hex64::parse("b".repeat(64)).expect("resident"),
            window_id: id("window:fixture"),
            origin_scope_ref: reference('c'),
            now_unix_ms: now(),
        },
        binding_ref: reference('d'),
        session_epoch: number(1),
        foreground_active: false,
        outreach_authorized: true,
    }
}
fn thread() -> InitiativeThreadV1 {
    let scope = scope();
    InitiativeThreadV1 {
        protocol: INITIATIVE_PROTOCOL.into(),
        thread_id: id("thread:older-shared"),
        owner_pubkey: scope.control.owner_pubkey,
        resident_pubkey: scope.control.resident_pubkey,
        kind: InitiativeThreadKindV1::Shared,
        disposition: InitiativeDispositionV1::Carried,
        revision: number(1),
        canonical_thread_ref: reference('e'),
        canonical_revision_ref: reference('f'),
        source_refs: vec![reference('0')],
        checkpoint_ref: None,
        eligible_after: None,
        updated_at: time(),
    }
}
fn facts(thread: &InitiativeThreadV1) -> InitiativeCanonicalFactsV1 {
    InitiativeCanonicalFactsV1 {
        owner_pubkey: thread.owner_pubkey.clone(),
        resident_pubkey: thread.resident_pubkey.clone(),
        thread_id: thread.thread_id.clone(),
        kind: thread.kind,
        canonical_thread_ref: thread.canonical_thread_ref.clone(),
        canonical_revision_ref: thread.canonical_revision_ref.clone(),
    }
}
fn setup(store: &mut InitiativeStore, scope: &InitiativeRuntimeScopeV1) {
    let mut policy = store.policy(&scope.control).expect("default policy");
    assert!(!policy.enabled && policy.paused);
    policy.revision = number(1);
    policy.enabled = true;
    policy.paused = false;
    policy.max_outreach_per_24h = 1;
    store
        .set_policy(&scope.control, &id("policy:enable"), number(0), policy)
        .expect("explicit owner opt-in");
    let thread = thread();
    store
        .cas_thread(
            &scope.control,
            &id("thread:create"),
            None,
            thread.clone(),
            &facts(&thread),
            &InitiativeTransitionCauseV1::NewObservation,
        )
        .expect("verified canonical projection");
}
fn cycle(
    scope: &InitiativeRuntimeScopeV1,
    thread: &InitiativeThreadV1,
    name: &str,
) -> InitiativeCycleInputV1 {
    InitiativeCycleInputV1 {
        job_id: id(&format!("job:{name}")),
        request_id: id(&format!("request:{name}")),
        thread_id: thread.thread_id.clone(),
        expected_thread_revision: thread.revision,
        canonical_revision_ref: thread.canonical_revision_ref.clone(),
        dependency_ref: reference('2'),
        origin_conversation_id: Some(id("conversation:origin")),
        budget: InitiativeTimeBudgetV1 {
            decision_ms: 1000,
            work_ms: 1000,
            return_ms: 1000,
        },
        deadline_unix_ms: scope.control.now_unix_ms + 3000,
        continued_from: None,
    }
}
fn decision(
    job: &InitiativeJobV1,
    thread: &InitiativeThreadV1,
    result: InitiativePlanningOutcomeV1,
) -> InitiativePlanningDecisionV1 {
    InitiativePlanningDecisionV1 {
        protocol: INITIATIVE_PROTOCOL.into(),
        request_id: job.input.job_id.clone(),
        owner_pubkey: job.owner_pubkey.clone(),
        resident_pubkey: job.resident_pubkey.clone(),
        thread_id: thread.thread_id.clone(),
        expected_revision: thread.revision,
        canonical_revision_ref: thread.canonical_revision_ref.clone(),
        result,
    }
}
fn working(store: &mut InitiativeStore, scope: &InitiativeRuntimeScopeV1) -> InitiativeJobV1 {
    let thread = store
        .thread(&scope.control, &thread().thread_id)
        .expect("read thread")
        .expect("current thread");
    let job = store
        .reserve_cycle(scope, cycle(scope, &thread, "working"), None)
        .expect("whole-cycle reservation");
    store
        .claim_planning(scope, &job.input.job_id)
        .expect("private planning admission");
    store
        .apply_decision(
            scope,
            &job.input.job_id,
            &decision(&job, &thread, InitiativePlanningOutcomeV1::Pursue),
        )
        .expect("authentic choice");
    let job = store
        .reserve_dispatch(scope, &job.input.job_id, id("native:initiative-owned"))
        .expect("durable pre-dispatch reservation");
    store
        .record_working(scope, &native(&job, false, None, None))
        .expect("verified native receipt")
}
fn native(
    job: &InitiativeJobV1,
    stopped: bool,
    checkpoint_ref: Option<Sha256Ref>,
    result_ref: Option<Sha256Ref>,
) -> InitiativeNativeFactsV1 {
    InitiativeNativeFactsV1 {
        job_id: job.input.job_id.clone(),
        owner_pubkey: job.owner_pubkey.clone(),
        resident_pubkey: job.resident_pubkey.clone(),
        binding_ref: job.binding_ref.clone(),
        session_epoch: job.session_epoch,
        native_task_id: job.native_task_id.clone(),
        receipt_ref: reference('3'),
        checkpoint_ref,
        result_ref,
        stopped,
    }
}

#[test]
fn default_off_and_sticky_older_shared_decline_survive_restart_without_private_bodies() {
    let temp = tempfile::tempdir().expect("internal disposable fixture");
    let path = database_path(&temp);
    let mut store = InitiativeStore::open(&path).expect("body-free store");
    let scope = scope();
    assert!(!store.policy(&scope.control).expect("policy").enabled);
    assert_eq!(
        store.reserve_cycle(&scope, cycle(&scope, &thread(), "disabled"), None),
        Err(InitiativeStoreErrorV1::Disabled)
    );
    setup(&mut store, &scope);
    let original = thread();
    let ctx = InitiativeContextV1 {
        owner_pubkey: original.owner_pubkey.clone(),
        resident_pubkey: original.resident_pubkey.clone(),
        expected_revision: original.revision,
        now: time(),
    };
    let declined = original
        .transition(
            &ctx,
            InitiativeDispositionV1::Declined,
            None,
            &InitiativeTransitionCauseV1::ResidentRequest {
                source_ref: reference('4'),
            },
        )
        .expect("resident decline");
    store
        .cas_thread(
            &scope.control,
            &id("thread:decline"),
            Some(original.revision),
            declined.clone(),
            &facts(&declined),
            &InitiativeTransitionCauseV1::ResidentRequest {
                source_ref: reference('4'),
            },
        )
        .expect("persist explicit decline");
    drop(store);
    let mut store = InitiativeStore::open(&path).expect("restart");
    assert_eq!(
        store
            .thread(&scope.control, &original.thread_id)
            .expect("current projection"),
        Some(declined.clone())
    );
    let mut fabricated = declined.clone();
    fabricated.disposition = InitiativeDispositionV1::Carried;
    fabricated.revision = number(3);
    assert_eq!(
        store.cas_thread(
            &scope.control,
            &id("passive:reopen"),
            Some(declined.revision),
            fabricated.clone(),
            &facts(&fabricated),
            &InitiativeTransitionCauseV1::NewObservation
        ),
        Err(InitiativeStoreErrorV1::Scope)
    );
    assert_eq!(
        store.reserve_cycle(&scope, cycle(&scope, &declined, "declined"), None),
        Err(InitiativeStoreErrorV1::Stale)
    );
    drop(store);
    let bytes = std::fs::read(&path).expect("fixture database bytes");
    assert!(!String::from_utf8_lossy(&bytes).contains("CANONICAL_PRIVATE_BODY_SENTINEL"));
}

#[test]
fn reservations_and_dispatch_claims_are_exact_once_and_foreground_work_wins() {
    let temp = tempfile::tempdir().expect("fixture");
    let mut store = InitiativeStore::open(&database_path(&temp)).expect("store");
    let mut scope = scope();
    setup(&mut store, &scope);
    let input = cycle(&scope, &thread(), "reserved");
    let job = store
        .reserve_cycle(&scope, input.clone(), None)
        .expect("reserve");
    assert_eq!(
        job.model_stages_reserved, 3,
        "decision/work/return are separate potential model stages"
    );
    scope.control.now_unix_ms += 1;
    assert_eq!(
        store
            .reserve_cycle(&scope, input, None)
            .expect("idempotent reservation"),
        job
    );
    store
        .claim_planning(&scope, &job.input.job_id)
        .expect("claim once");
    assert_eq!(
        store.claim_planning(&scope, &job.input.job_id),
        Err(InitiativeStoreErrorV1::Conflict)
    );
    let mut wrong = scope.clone();
    wrong.session_epoch = number(2);
    assert_eq!(
        store.apply_decision(
            &wrong,
            &job.input.job_id,
            &decision(&job, &thread(), InitiativePlanningOutcomeV1::Pursue)
        ),
        Err(InitiativeStoreErrorV1::Stale)
    );
    scope.foreground_active = true;
    assert_eq!(
        store.apply_decision(
            &scope,
            &job.input.job_id,
            &decision(&job, &thread(), InitiativePlanningOutcomeV1::Pursue)
        ),
        Err(InitiativeStoreErrorV1::ForegroundBusy)
    );
    scope.foreground_active = false;
    store
        .apply_decision(
            &scope,
            &job.input.job_id,
            &decision(&job, &thread(), InitiativePlanningOutcomeV1::Pursue),
        )
        .expect("choice");
    store
        .reserve_dispatch(&scope, &job.input.job_id, id("native:only-one"))
        .expect("reserve native identity before dispatch");
    assert_eq!(
        store.reserve_dispatch(&scope, &job.input.job_id, id("native:replacement")),
        Err(InitiativeStoreErrorV1::Conflict)
    );
}

#[test]
fn policy_pause_and_preemption_are_keyless_and_return_only_owned_initiative_refs() {
    let temp = tempfile::tempdir().expect("fixture");
    let mut store = InitiativeStore::open(&database_path(&temp)).expect("store");
    let scope = scope();
    setup(&mut store, &scope);
    let job = working(&mut store, &scope);
    let refs = store
        .cancel_owned(&scope.control)
        .expect("foreground preemption, no model/key needed");
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].job_id, job.input.job_id);
    assert_eq!(refs[0].native_task_id, Some(id("native:initiative-owned")));
    assert_ne!(refs[0].native_task_id, Some(id("native:D0-owner-task")));
    assert_eq!(
        store
            .job(&scope.control, &job.input.job_id)
            .expect("job")
            .expect("retained job")
            .state,
        InitiativeJobStateV1::Interrupted
    );
    let mut policy = store.policy(&scope.control).expect("policy");
    policy.paused = true;
    policy.revision = number(2);
    let (_, refs) = store
        .set_policy(&scope.control, &id("policy:pause"), number(1), policy)
        .expect("durable denial before cancel refs");
    assert_eq!(refs.len(), 1);
    let thread = store
        .thread(&scope.control, &thread().thread_id)
        .expect("thread")
        .expect("thread");
    assert_eq!(
        store.reserve_cycle(&scope, cycle(&scope, &thread, "while-paused"), None),
        Err(InitiativeStoreErrorV1::Disabled)
    );
}

#[test]
fn interrupted_native_work_requires_exact_reconciliation_and_explicit_continuation() {
    let temp = tempfile::tempdir().expect("fixture");
    let path = database_path(&temp);
    let mut store = InitiativeStore::open(&path).expect("store");
    let mut scope = scope();
    setup(&mut store, &scope);
    let original = working(&mut store, &scope);
    drop(store);
    let mut store = InitiativeStore::open(&path).expect("restart");
    scope.control.now_unix_ms += 1000;
    let recovered = store
        .recover(&scope.control)
        .expect("recover without dispatch");
    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].state, InitiativeJobStateV1::Interrupted);
    assert_eq!(
        recovered[0].input.deadline_unix_ms,
        original.input.deadline_unix_ms
    );
    let thread = store
        .thread(&scope.control, &thread().thread_id)
        .expect("thread")
        .expect("thread");
    assert_eq!(
        store.reserve_cycle(&scope, cycle(&scope, &thread, "blind-replay"), None),
        Err(InitiativeStoreErrorV1::ReconciliationRequired)
    );
    let mut wrong = native(&original, true, Some(reference('5')), None);
    wrong.native_task_id = Some(id("native:another-task"));
    assert_eq!(
        store.reconcile(&scope.control, &wrong),
        Err(InitiativeStoreErrorV1::Scope)
    );
    store
        .reconcile(
            &scope.control,
            &native(&original, true, Some(reference('5')), None),
        )
        .expect("verified stopped/checkpoint receipt");
    scope.session_epoch = number(2);
    let mut continuation = cycle(&scope, &thread, "authorized-continuation");
    continuation.continued_from = Some(original.input.job_id.clone());
    continuation.budget = InitiativeTimeBudgetV1 {
        decision_ms: 0,
        work_ms: 1000,
        return_ms: 0,
    };
    continuation.deadline_unix_ms = scope.control.now_unix_ms + 1000;
    assert_eq!(
        store.reserve_cycle(&scope, continuation.clone(), None),
        Err(InitiativeStoreErrorV1::ReconciliationRequired)
    );
    let resumed = store
        .reserve_cycle(
            &scope,
            continuation,
            Some(&InitiativeTransitionCauseV1::OwnerRequest {
                source_ref: reference('6'),
            }),
        )
        .expect("fresh explicit continuation reservation");
    assert_eq!(resumed.state, InitiativeJobStateV1::Ready);
    assert_eq!(resumed.session_epoch, number(2));
    assert_eq!(
        resumed.model_stages_reserved, 1,
        "already validated current pursuit needs no duplicate decision or gift model call"
    );
    assert_eq!(original.input.deadline_unix_ms, now() + 3000);
}

#[test]
fn retained_return_key_survives_restart_and_never_admits_another_return() {
    let temp = tempfile::tempdir().expect("fixture");
    let path = database_path(&temp);
    let mut store = InitiativeStore::open(&path).expect("store");
    let scope = scope();
    setup(&mut store, &scope);
    let job = working(&mut store, &scope);
    store
        .record_result(
            &scope,
            &native(&job, false, Some(reference('5')), Some(reference('7'))),
        )
        .expect("verified result");
    let key = id("return:one-exact-result");
    store
        .reserve_return(&scope, &job.input.job_id, key.clone())
        .expect("one return reservation");
    drop(store);
    let mut store = InitiativeStore::open(&path).expect("restart");
    assert!(store.recover(&scope.control).expect("recover").is_empty());
    let retained = store
        .job(&scope.control, &job.input.job_id)
        .expect("job")
        .expect("retained return");
    assert_eq!(retained.state, InitiativeJobStateV1::ReturnReserved);
    assert_eq!(retained.return_key, Some(key.clone()));
    assert_eq!(
        store.reserve_return(&scope, &job.input.job_id, id("return:duplicate")),
        Err(InitiativeStoreErrorV1::Conflict)
    );
    store
        .mark_returned(&scope.control, &job.input.job_id, &key, reference('8'))
        .expect("verified publication receipt");
    store
        .mark_returned(&scope.control, &job.input.job_id, &key, reference('8'))
        .expect("same retained receipt replay");
    assert_eq!(
        store.reserve_return(&scope, &job.input.job_id, id("return:again")),
        Err(InitiativeStoreErrorV1::Conflict)
    );
}

#[test]
fn rolling_ceiling_counts_reserved_cycles_without_creating_a_work_quota() {
    let temp = tempfile::tempdir().expect("fixture");
    let mut store = InitiativeStore::open(&database_path(&temp)).expect("store");
    let scope = scope();
    setup(&mut store, &scope);
    for name in ["one", "two", "three"] {
        let mut input = cycle(&scope, &thread(), name);
        input.budget = InitiativeTimeBudgetV1 {
            decision_ms: 1000,
            work_ms: 0,
            return_ms: 0,
        };
        input.deadline_unix_ms = scope.control.now_unix_ms + 1000;
        let job = store
            .reserve_cycle(&scope, input, None)
            .expect("bounded decision-only reservation");
        store
            .claim_planning(&scope, &job.input.job_id)
            .expect("private admission");
        store
            .apply_decision(
                &scope,
                &job.input.job_id,
                &decision(&job, &thread(), InitiativePlanningOutcomeV1::NoChange),
            )
            .expect("capacity may remain unused");
    }
    assert_eq!(
        store.reserve_cycle(&scope, cycle(&scope, &thread(), "four"), None),
        Err(InitiativeStoreErrorV1::Capacity)
    );
    assert_eq!(
        store
            .thread(&scope.control, &thread().thread_id)
            .expect("thread")
            .expect("thread")
            .revision,
        number(1)
    );
}

#[test]
fn existing_private_foreign_empty_database_is_rejected_without_byte_or_mode_repair() {
    let temp = tempfile::tempdir().expect("private internal fixture");
    let path = database_path(&temp);
    let foreign = rusqlite::Connection::open(&path).expect("owned foreign fixture");
    foreign
        .execute_batch("PRAGMA application_id=12345; PRAGMA user_version=17;")
        .expect("foreign identity");
    drop(foreign);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .expect("private foreign fixture");
    }
    let before = std::fs::read(&path).expect("foreign fixture bytes");
    let permissions = std::fs::metadata(&path)
        .expect("foreign fixture metadata")
        .permissions();
    assert!(matches!(
        InitiativeStore::open(&path),
        Err(InitiativeStoreErrorV1::Invalid)
    ));
    assert_eq!(std::fs::read(&path).expect("unchanged bytes"), before);
    assert_eq!(
        std::fs::metadata(&path)
            .expect("unchanged mode")
            .permissions(),
        permissions
    );
}

#[cfg(unix)]
#[test]
fn aliases_and_hardlinks_are_not_adopted_or_changed() {
    let temp = tempfile::tempdir().expect("private internal fixture");
    let path = database_path(&temp);
    drop(InitiativeStore::open(&path).expect("owned fixture store"));
    let alias_parent = temp.path().join("alias-parent");
    std::os::unix::fs::symlink(path.parent().expect("fixture parent"), &alias_parent)
        .expect("owned alias fixture");
    assert!(matches!(
        InitiativeStore::open(&alias_parent.join(INITIATIVE_STORE_FILENAME)),
        Err(InitiativeStoreErrorV1::Invalid)
    ));
    let before = std::fs::read(&path).expect("fixture bytes");
    std::fs::hard_link(&path, temp.path().join("second-link")).expect("owned hardlink fixture");
    assert!(matches!(
        InitiativeStore::open(&path),
        Err(InitiativeStoreErrorV1::Invalid)
    ));
    assert_eq!(std::fs::read(&path).expect("unchanged bytes"), before);
}
