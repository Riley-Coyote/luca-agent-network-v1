//! Strict synthetic frames and generated owners only. No helper, NSWorkspace,
//! native app, TCC prompt, screen, model, account or browser is executed/read.
use super::*;
use crate::luca::companion_awareness::{
    machine_activity::MachineCaptureRequestV1,
    selected_files::tests::{id, now, Fixture},
    AwarenessWithdrawalV1,
};

fn selected(fixture: &Fixture, engine: &mut SourceEngine, observe: bool) -> MachineSourceSelectionV1 {
    let request = MachineCaptureRequestV1::new(MachineObservationClassV1::AppMetadata,
        vec!["com.apple.TextEdit".into()], vec![], vec![], 4096).unwrap();
    let key = fixture.grant(request.source_id().unwrap(), observe);
    let selection = MachineSourceSelectionV1::new(key, request).unwrap();
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    engine.machines.catalog.as_mut().unwrap().select(&live, selection.clone()).unwrap(); selection
}
fn due(collector: &MachineCollector) { collector.pending.set(Some(Instant::now() - DEBOUNCE)); }
fn frame() -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({"protocol":"polyphonic.awareness.machine-reply.v1", "observation_class":"app_metadata",
        "status":"available", "bundle_id":"com.apple.TextEdit", "display_name":"SYNTHETIC_EDITOR", "window_scope":"unavailable", "truncated":false})).unwrap()
}

#[test]
fn restoration_is_off_and_an_ungranted_source_cannot_prepare_any_helper_scope() {
    let fixture = Fixture::new();
    let mut engine = super::super::tests::engine(&fixture, SourceRuntimeBindingsV1::default());
    let denied = selected(&fixture, &mut engine, false);
    assert!(engine.machines.catalog.as_ref().unwrap().selections(&fixture.resident).unwrap().len() == 1);
    assert!(engine.machines.collectors.is_empty()); assert!(engine.machines.delay().is_none());
    engine.sample_machines_with(&fixture.state, &now(), |_, _| panic!("restore is not a capture request"));
    assert!(engine.machines.prepare(&fixture.state, &fixture.state.companion_awareness, denied.key()).is_err());
    assert!(engine.machines.stops.scopes.lock().unwrap().is_empty());
    assert!(engine.shared.facts.lock().unwrap().records.is_empty());
}

#[test]
fn synthetic_changed_metadata_uses_real_grant_sequence_admission_and_revocation_barrier() {
    let fixture = Fixture::new();
    let mut engine = super::super::tests::engine(&fixture, SourceRuntimeBindingsV1::default());
    let selection = selected(&fixture, &mut engine, true);
    // Pure preparation/fixture insertion only. Never start the real observer.
    let collector = engine.machines.prepare(&fixture.state, &fixture.state.companion_awareness, selection.key()).unwrap();
    due(&collector); engine.active(selection.key(), true).unwrap(); engine.machines.collectors.push(collector);
    let mut captures = 0;
    engine.sample_machines_with(&fixture.state, &now(), |adapter, key| {
        captures += 1;
        let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
        let sequence = fixture.state.companion_awareness.next_sequence(&live, key).unwrap();
        adapter.sample(&fixture.state, &fixture.state.companion_awareness, &now(), sequence, |_| Ok(frame()))
    });
    assert_eq!(captures, 1);
    let first = engine.shared.facts.lock().unwrap().records[0].binding.reference.clone();
    assert_eq!(first.sequence.get(), 1);
    assert!(engine.machines.delay().is_none());
    // A fresh allowed notification may be coalesced, but never bypass admission.
    due(&engine.machines.collectors[0]);
    engine.sample_machines_with(&fixture.state, &now(), |adapter, key| {
        let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
        let sequence = fixture.state.companion_awareness.next_sequence(&live, key).unwrap();
        adapter.sample(&fixture.state, &fixture.state.companion_awareness, &now(), sequence, |_| Ok(frame()))
    });
    assert_eq!(engine.shared.facts.lock().unwrap().records.len(), 1);
    let current = fixture.state.companion_awareness.snapshot(&engine.owner, selection.key()).unwrap();
    fixture.state.companion_awareness.withdraw_grant(&engine.owner, selection.key(), current.grant.grant_revision,
        AwarenessWithdrawalV1::Withdraw, &id("machine-revoke")).unwrap();
    due(&engine.machines.collectors[0]);
    engine.sample_machines_with(&fixture.state, &now(), |adapter, key| {
        let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
        let sequence = fixture.state.companion_awareness.next_sequence(&live, key)?;
        adapter.sample(&fixture.state, &fixture.state.companion_awareness, &now(), sequence,
            |_| panic!("durable revoke must deny before synthetic helper read"))
    });
    assert!(engine.machines.collectors.is_empty());
    assert!(engine.shared.facts.lock().unwrap().active.is_empty());
    assert!(!engine.shared.facts.lock().unwrap().records[0].raw_current);
}

#[test]
fn priority_stop_is_exact_and_an_unproved_failed_start_never_becomes_retry_permission() {
    let fixture = Fixture::new();
    let mut engine = super::super::tests::engine(&fixture, SourceRuntimeBindingsV1::default());
    let selection = selected(&fixture, &mut engine, true);
    let one = engine.machines.stops.reserve(selection.key()).unwrap();
    let mut other_key = selection.key().clone(); other_key.resident_pubkey = Hex64::parse("cc".repeat(32)).unwrap();
    let other = engine.machines.stops.reserve(&other_key).unwrap();
    engine.machines.stops.cancel(Some(&StopScope::Grant(selection.key().clone()))).unwrap();
    assert!(one.stopped.load(Ordering::Acquire)); assert!(!other.stopped.load(Ordering::Acquire));
    let attempted = engine.machines.stops.reserve(selection.key()).unwrap();
    attempted.watcher_attempted.store(true, Ordering::Release); // fake failed-start disposition, no spawn
    engine.machines.stops.cancel(Some(&StopScope::Grant(selection.key().clone()))).unwrap();
    assert!(!attempted.terminal(&engine.machines.stops.runner));
    assert!(engine.machines.stops.reserve(selection.key()).is_err());
    engine.machines.stops.cancel(Some(&StopScope::Source(selection.key().source.clone()))).unwrap();
    assert!(other.stopped.load(Ordering::Acquire));
    // Source pump teardown does not drop this runtime-owned unknown slot.
    engine.machines.stop(None).unwrap();
    assert!(engine.machines.stops.reserve(selection.key()).is_err());
}
