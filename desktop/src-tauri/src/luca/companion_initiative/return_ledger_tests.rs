use super::*;
use crate::luca::companion_initiative::{
    return_setup::InitiativeReturnConsentV1, returns::InitiativeReturnContextV1,
};
use luca_protocol::Hex64;

fn id(value: &str) -> OpaqueId {
    OpaqueId::parse(value).unwrap()
}
fn n(value: u64) -> SafeU53 {
    SafeU53::new(value).unwrap()
}
fn hash(c: char) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", c.to_string().repeat(64))).unwrap()
}
fn scope() -> InitiativeRuntimeScopeV1 {
    InitiativeRuntimeScopeV1 {
        control: InitiativeControlScopeV1 {
            owner_pubkey: Hex64::parse("a".repeat(64)).unwrap(),
            resident_pubkey: Hex64::parse("b".repeat(64)).unwrap(),
            window_id: id("fixture-home"),
            origin_scope_ref: hash('c'),
            now_unix_ms: 2 * INITIATIVE_WINDOW_MS,
        },
        binding_ref: hash('d'),
        session_epoch: n(2),
        foreground_active: false,
        outreach_authorized: true,
    }
}
fn context() -> InitiativeReturnContextV1 {
    InitiativeReturnContextV1 {
        artifact_id: id("fixture-artifact"),
        version: n(1),
        artifact_ref: hash('e'),
        result_ref: hash('f'),
        dependency_node: id("fixture-node"),
        record_id: id("fixture-record"),
        canonical_revision_ref: hash('1'),
        observations: vec![],
        novelty_ref: hash('2'),
        content_ref: hash('3'),
    }
}
fn job(name: &str, created: u64) -> InitiativeJobV1 {
    let scope = scope();
    InitiativeJobV1 {
        input: InitiativeCycleInputV1 {
            job_id: id(name),
            request_id: id(&format!("request:{name}")),
            thread_id: id("fixture-thread"),
            expected_thread_revision: n(1),
            canonical_revision_ref: hash('1'),
            dependency_ref: hash('2'),
            origin_conversation_id: Some(id("c71e4a35-8b02-4d69-9f18-3a6c0e5b2d47")),
            budget: InitiativeTimeBudgetV1 {
                decision_ms: 1000,
                work_ms: 1000,
                return_ms: 1000,
            },
            deadline_unix_ms: created + 3000,
            continued_from: None,
        },
        owner_pubkey: scope.control.owner_pubkey,
        resident_pubkey: scope.control.resident_pubkey,
        window_id: scope.control.window_id,
        origin_scope_ref: scope.control.origin_scope_ref,
        binding_ref: scope.binding_ref,
        session_epoch: n(1),
        policy_revision: n(1),
        current_thread_revision: n(1),
        model_stages_reserved: 3,
        decision: None,
        state: InitiativeJobStateV1::Succeeded,
        created_unix_ms: created,
        updated_unix_ms: created,
        native_task_id: None,
        native_receipt_ref: None,
        checkpoint_ref: None,
        result_ref: Some(hash('f')),
        private_pursuit: None,
        reconciliation_ref: None,
        return_key: None,
        return_reserved_unix_ms: None,
        return_effect_unix_ms: None,
        return_receipt_ref: None,
        return_context: Some(context()),
    }
}
fn store() -> (tempfile::TempDir, InitiativeStore) {
    let directory = tempfile::tempdir().unwrap();
    let path = std::fs::canonicalize(directory.path()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let mut store = InitiativeStore::open(&path.join(schema::INITIATIVE_STORE_FILENAME)).unwrap();
    let scope = scope();
    let mut policy = InitiativePolicyV1::disabled().unwrap();
    policy.revision = n(1);
    policy.enabled = true;
    policy.paused = false;
    policy.max_outreach_per_24h = 1;
    policy.return_consent = Some(InitiativeReturnConsentV1 {
        owner_pubkey: scope.control.owner_pubkey.clone(),
        resident_pubkey: scope.control.resident_pubkey.clone(),
        conversation_id: id("c71e4a35-8b02-4d69-9f18-3a6c0e5b2d47"),
        binding_ref: scope.binding_ref.clone(),
        origin_relay_ref: hash('4'),
        approved_at: CanonicalTimestamp::parse("2026-11-02T12:00:00Z").unwrap(),
        disclosure_revision: 1,
        sources: vec![],
        quiet_start_minute: 1320,
        quiet_end_minute: 480,
    });
    store
        .set_policy(&scope.control, &id("fixture-policy"), n(0), policy)
        .unwrap();
    (directory, store)
}

#[test]
fn deferred_return_is_charged_in_its_new_reservation_window_without_double_charge() {
    let (_dir, mut store) = store();
    let scope = scope();
    let old = job(
        "old-private-job",
        scope.control.now_unix_ms - INITIATIVE_WINDOW_MS - 1000,
    );
    save_job(&store.connection, &old).unwrap();
    let reserved = store
        .reserve_completed_return(&scope, &old.input.job_id, id("return:old"))
        .unwrap();
    assert_eq!(
        window_charge(&reserved, scope.control.now_unix_ms - INITIATIVE_WINDOW_MS).unwrap(),
        (1, 1000)
    );
    assert_eq!(window_charge(&reserved, 0).unwrap(), (3, 3000));
}

#[test]
fn deferred_return_cannot_bypass_current_stage_budget() {
    let (_dir, mut store) = store();
    let scope = scope();
    let old = job("old", 1);
    let mut recent = job("recent", scope.control.now_unix_ms - 1000);
    recent.state = InitiativeJobStateV1::NoChange;
    recent.return_context = None;
    save_job(&store.connection, &old).unwrap();
    save_job(&store.connection, &recent).unwrap();
    assert_eq!(
        store.reserve_completed_return(&scope, &old.input.job_id, id("return:old")),
        Err(InitiativeStoreErrorV1::Capacity)
    );
}

#[test]
fn rolling_outreach_counts_actual_late_effect_not_only_old_reservation() {
    let (_dir, mut store) = store();
    let scope = scope();
    let mut prior = job("prior", 1);
    prior.state = InitiativeJobStateV1::Returned;
    prior.return_key = Some(id("return:prior"));
    prior.return_reserved_unix_ms = Some(100);
    prior.return_effect_unix_ms = Some(scope.control.now_unix_ms - 1);
    prior.return_context = None;
    let next = job("next", scope.control.now_unix_ms - 1000);
    save_job(&store.connection, &prior).unwrap();
    save_job(&store.connection, &next).unwrap();
    assert_eq!(
        store.reserve_completed_return(&scope, &next.input.job_id, id("return:next")),
        Err(InitiativeStoreErrorV1::Capacity)
    );
}

#[test]
fn queued_duplicate_context_is_rechecked_atomically_at_reservation() {
    let (_dir, mut store) = store();
    let scope = scope();
    let mut prior = job("prior", 1);
    let next = job("next", scope.control.now_unix_ms - 1000);
    prior.state = InitiativeJobStateV1::Returned;
    prior.return_key = Some(id("return:prior"));
    prior.return_reserved_unix_ms = Some(100);
    save_job(&store.connection, &prior).unwrap();
    save_job(&store.connection, &next).unwrap();
    assert_eq!(
        store.reserve_completed_return(&scope, &next.input.job_id, id("return:duplicate")),
        Err(InitiativeStoreErrorV1::Conflict)
    );
}

#[test]
fn late_published_receipt_settles_cancelled_return_without_reopening_sending() {
    let (_dir, mut store) = store();
    let scope = scope();
    let mut row = job("cancelled", scope.control.now_unix_ms - 1000);
    row.state = InitiativeJobStateV1::Cancelled;
    row.return_key = Some(id("return:cancelled"));
    row.return_reserved_unix_ms = Some(scope.control.now_unix_ms - 500);
    save_job(&store.connection, &row).unwrap();
    let receipt = store
        .mark_returned(
            &scope.control,
            &row.input.job_id,
            &id("return:cancelled"),
            hash('5'),
        )
        .unwrap();
    assert_eq!(receipt.state, InitiativeJobStateV1::Returned);
    assert_eq!(
        receipt.return_effect_unix_ms,
        Some(scope.control.now_unix_ms)
    );
    assert!(store
        .mark_returned(
            &scope.control,
            &row.input.job_id,
            &id("return:wrong"),
            hash('5')
        )
        .is_err());
}

#[test]
fn stale_old_results_do_not_hide_fresh_candidates_and_reserved_receipts_come_first() {
    let (_dir, mut store) = store();
    let scope = scope();
    for index in 0..12 {
        let row = job(&format!("old-{index}"), 1000 + index);
        save_job(&store.connection, &row).unwrap();
    }
    let fresh = job("fresh", scope.control.now_unix_ms - 100);
    save_job(&store.connection, &fresh).unwrap();
    let rows = store.pending_returns(&scope.control).unwrap();
    assert_eq!(rows.len(), 8);
    assert_eq!(rows[0].input.job_id, fresh.input.job_id);
}
