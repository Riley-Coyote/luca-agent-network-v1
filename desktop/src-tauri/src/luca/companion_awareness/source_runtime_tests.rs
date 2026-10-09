//! Disposable sentinel roots/generated owners only; no personal profile,
//! native process, account, app observation, or model invocation is used.
use super::material::unavailable;
use super::*;
use crate::luca::companion_awareness::selected_files::tests::{id, now, number, Fixture};
use crate::luca::companion_awareness::AwarenessMaterialFactsV1;
use luca_protocol::{AwarenessObservationRefV1, Sha256Ref, AWARENESS_PROTOCOL};
use std::{collections::HashSet, fs, sync::atomic::AtomicUsize};

const UUID: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
pub(super) fn engine(fixture: &Fixture, bindings: SourceRuntimeBindingsV1) -> SourceEngine {
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    fixture
        .state
        .companion_awareness
        .initialize(&fixture.root, Some(live.owner()));
    let runtime = &fixture.state.companion_awareness;
    let owner = live.owner().clone();
    let device = runtime.device(&owner).unwrap();
    let (wake, _events) = mpsc::sync_channel(1);
    let machine_stops = Arc::new(MachineSourceStopsV1::default());
    let shared = Arc::new(Shared {
        facts: Arc::new(Mutex::new(MaterialBook {
            owner: Some(owner.clone()),
            ..Default::default()
        })),
        priority: Mutex::new(VecDeque::new()),
        closing: AtomicBool::new(false),
        wake,
        machine_stops: Arc::clone(&machine_stops),
    });
    SourceEngine {
        owner: owner.clone(),
        device: device.clone(),
        catalog: SelectedSourceCatalogV1::open(
            &runtime.private_directory(&owner).unwrap(),
            &owner,
            &device,
        ),
        profile_catalog: NativeProfileCatalogV1::open(&runtime.private_directory(&owner).unwrap(), &owner, &device),
        exact: BTreeMap::new(),
        profiles: Vec::new(),
        machines: MachineSourcesV1::open(&runtime.private_directory(&owner).unwrap(), &owner, &device, machine_stops),
        bindings,
        shared,
        commands: mpsc::sync_channel(COMMAND_CAPACITY).0,
    }
}
fn selected(
    fixture: &Fixture,
    engine: &mut SourceEngine,
    class: SelectedSourceClassV1,
    relative: &str,
) -> SelectedSourceSelectionV1 {
    let source = class.source_id(&fixture.root, relative).unwrap();
    let key = fixture.grant(source, true);
    let selection =
        SelectedSourceSelectionV1::new(key, class, fixture.root.clone(), relative.into()).unwrap();
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    engine
        .catalog
        .as_mut()
        .unwrap()
        .select(&live, selection.clone())
        .unwrap();
    selection
}
fn reference(key: &AwarenessGrantKeyV1, name: &str) -> AwarenessObservationRefV1 {
    AwarenessObservationRefV1 {
        protocol: AWARENESS_PROTOCOL.into(),
        observation_id: id(name),
        owner_pubkey: key.source.owner_pubkey.clone(),
        resident_pubkey: key.resident_pubkey.clone(),
        source_id: key.source.source_id.clone(),
        device_id: key.source.device_id.clone(),
        grant_id: id("synthetic-grant"),
        grant_revision: number(1),
        deny_epoch: number(0),
        sequence: number(1),
        evidence_ref: Sha256Ref::parse(format!("sha256:{}", "11".repeat(32))).unwrap(),
        captured_at: now(),
        expires_at: CanonicalTimestamp::parse("2026-10-08T10:05:02Z").unwrap(),
    }
}
fn snapshot(engine: &SourceEngine) -> SourceMaterialSnapshotV1 {
    let facts = engine.shared.facts.lock().unwrap();
    SourceMaterialSnapshotV1 {
        now: now(),
        known_exact: facts.known_exact.clone(),
        records: facts.records.iter().cloned().collect(),
        collecting: facts.active.clone(),
    }
}

#[test]
fn restore_is_off_and_default_native_bindings_are_not_a_capture_permission() {
    let fixture = Fixture::new();
    let mut engine = engine(&fixture, SourceRuntimeBindingsV1::default());
    let file = selected(
        &fixture,
        &mut engine,
        SelectedSourceClassV1::SelectedFile,
        "never-read.txt",
    );
    let native = selected(
        &fixture,
        &mut engine,
        SelectedSourceClassV1::CodexSessionMetadata,
        &format!("{UUID}.jsonl"),
    );
    assert!(!fixture.root.join("never-read.txt").exists());
    engine.inspect(&fixture.resident).unwrap();
    assert!(engine.exact.is_empty());
    assert!(engine.delay().is_none());
    engine.sample(&fixture.state, &now());
    assert!(snapshot(&engine).references().is_empty());
    assert_eq!(
        engine.resume(&fixture.state, native.key(), HashSet::new()),
        Err(AwarenessStoreError::Unavailable)
    );
    assert!(engine.exact.is_empty());
    let raw = reference(file.key(), "historical-observation");
    assert!(snapshot(&engine).binding(&raw).is_some());
    assert_eq!(
        snapshot(&engine)
            .resolve(&raw, false, |_, _| None)
            .material_state,
        AwarenessMaterialStateV1::Unavailable
    );
    let runtime = CompanionSourceRuntimeV1::default();
    runtime.shutdown();
    assert!(runtime.inner.lock().unwrap().is_none());
}

#[test]
fn exact_selected_file_activation_is_changed_only_and_stop_is_scoped() {
    let fixture = Fixture::new();
    let mut engine = engine(&fixture, SourceRuntimeBindingsV1::default());
    fs::write(fixture.root.join("selected.txt"), "SOURCE_RUNTIME_SENTINEL").unwrap();
    let selected = selected(
        &fixture,
        &mut engine,
        SelectedSourceClassV1::SelectedFile,
        "selected.txt",
    );
    engine
        .resume(&fixture.state, selected.key(), HashSet::new())
        .unwrap();
    engine.sample(&fixture.state, &now());
    let first = snapshot(&engine).references();
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].sequence, number(1));
    engine.sample(&fixture.state, &now());
    assert_eq!(snapshot(&engine).references(), first);
    assert!(engine.delay().is_none());
    let unrelated = StopScope::Resident(Hex64::parse("cc".repeat(32)).unwrap());
    engine
        .apply_stop(&fixture.state.companion_awareness, &unrelated)
        .unwrap();
    assert_eq!(snapshot(&engine).references(), first);
    engine
        .apply_stop(
            &fixture.state.companion_awareness,
            &StopScope::Grant(selected.key().clone()),
        )
        .unwrap();
    assert!(snapshot(&engine).references().is_empty());
    assert!(engine.delay().is_none());
    let owner = engine.owner.clone();
    let buffer = fixture
        .state
        .companion_awareness
        .with_controller(&owner, |controller| Ok(format!("{:?}", controller.buffer)))
        .unwrap();
    assert!(buffer.contains("entries: 0"));
    engine.close(&fixture.state.companion_awareness);
}

#[test]
fn per_child_facts_do_not_turn_one_profile_current_bit_into_all_children() {
    let fixture = Fixture::new();
    let mut engine = engine(&fixture, SourceRuntimeBindingsV1::default());
    let key = fixture.grant(id("synthetic-profile-source"), true);
    let one = reference(&key, "child-one-observation");
    let mut two = reference(&key, "child-two-observation");
    two.sequence = number(2);
    {
        let mut facts = engine.shared.facts.lock().unwrap();
        facts.active.push(key.clone());
        facts.remember(
            one.clone(),
            SourceMaterialScopeV1::ProfileChild(id("child-one")),
        );
        facts.remember(
            two.clone(),
            SourceMaterialScopeV1::ProfileChild(id("child-two")),
        );
        facts.child_state(&key, &id("child-one"), AwarenessMaterialStateV1::Excluded);
    }
    let current = snapshot(&engine);
    assert_eq!(
        current
            .resolve(&one, false, |_, _| Some(unavailable()))
            .material_state,
        AwarenessMaterialStateV1::Excluded
    );
    assert_eq!(
        current
            .resolve(&two, false, |binding, _| {
                assert_eq!(
                    binding.scope,
                    SourceMaterialScopeV1::ProfileChild(id("child-two"))
                );
                Some(AwarenessMaterialFactsV1 {
                    source_fresh: true,
                    material_state: AwarenessMaterialStateV1::Available,
                })
            })
            .material_state,
        AwarenessMaterialStateV1::Available
    );
    assert_eq!(
        current.resolve(&two, false, |_, _| None).material_state,
        AwarenessMaterialStateV1::Unavailable
    );
    let restarted = SourceMaterialSnapshotV1 {
        now: now(),
        known_exact: Vec::new(),
        records: Vec::new(),
        collecting: Vec::new(),
    };
    assert_eq!(
        restarted
            .resolve(&two, true, |_, _| Some(AwarenessMaterialFactsV1 {
                source_fresh: true,
                material_state: AwarenessMaterialStateV1::Available
            }))
            .material_state,
        AwarenessMaterialStateV1::Unavailable
    );
    let mut forged = two;
    forged.evidence_ref = Sha256Ref::parse(format!("sha256:{}", "22".repeat(32))).unwrap();
    assert!(current.binding(&forged).is_none());
    engine.close(&fixture.state.companion_awareness);
}

#[test]
fn priority_stop_survives_full_command_queue_and_shutdown_joins_owned_loop() {
    let fixture = Fixture::new();
    let engine = engine(&fixture, SourceRuntimeBindingsV1::default());
    let key = fixture.grant(id("owned-stop-source"), true);
    let record = reference(&key, "pre-deny-capture");
    {
        let mut facts = engine.shared.facts.lock().unwrap();
        facts.active.push(key.clone());
        facts.remember(
            record.clone(),
            SourceMaterialScopeV1::Exact(SelectedSourceClassV1::SelectedFile),
        );
    }
    let runtime = CompanionSourceRuntimeV1 {
        inner: Mutex::new(None),
        facts: Arc::clone(&engine.shared.facts),
        machine_stops: Arc::clone(&engine.shared.machine_stops),
    };
    let (commands, _queued) = mpsc::sync_channel(1);
    let (reply, _response) = mpsc::channel();
    commands
        .try_send(Envelope {
            deadline: Instant::now() + COMMAND_DEADLINE,
            cancelled: Arc::new(AtomicBool::new(false)),
            command: Command::Inspect(fixture.resident.clone(), reply),
        })
        .unwrap_or_else(|_| panic!("synthetic queue"));
    let (wake, events) = mpsc::sync_channel(1);
    let shared = Arc::new(Shared {
        facts: Arc::clone(&engine.shared.facts),
        priority: Mutex::new(VecDeque::new()),
        closing: AtomicBool::new(false),
        wake,
        machine_stops: Arc::clone(&engine.shared.machine_stops),
    });
    let worker_shared = Arc::clone(&shared);
    let worker = thread::spawn(move || {
        while !worker_shared.closing.load(Ordering::Acquire) {
            let _ = events.recv_timeout(Duration::from_secs(1));
        }
    });
    *runtime.inner.lock().unwrap() = Some(RuntimeHandle {
        owner: engine.owner.clone(),
        device: engine.device.clone(),
        commands,
        shared: Arc::clone(&shared),
        worker,
    });
    runtime
        .after_pause(&engine.owner, &fixture.resident)
        .unwrap();
    assert_eq!(shared.priority.lock().unwrap().len(), 1);
    assert!(runtime
        .snapshot(&engine.owner, &fixture.resident, &now())
        .unwrap()
        .references()
        .is_empty());
    // A capture already admitted before deny cannot re-current its metadata.
    shared.facts.lock().unwrap().remember(
        record,
        SourceMaterialScopeV1::Exact(SelectedSourceClassV1::SelectedFile),
    );
    assert!(runtime
        .snapshot(&engine.owner, &fixture.resident, &now())
        .unwrap()
        .references()
        .is_empty());
    runtime.shutdown();
    assert!(shared.closing.load(Ordering::Acquire));
    assert!(runtime.inner.lock().unwrap().is_none());
}

#[test]
fn native_exclusions_refresh_on_dirty_capture_not_on_quiet_ticks() {
    let fixture = Fixture::new();
    let excluded = Arc::new(AtomicBool::new(false));
    let calls = Arc::new(AtomicUsize::new(0));
    let current = Arc::clone(&excluded);
    let counter = Arc::clone(&calls);
    let bindings = SourceRuntimeBindingsV1 {
        exact_exclusions: Arc::new(move |_, _, _, _| {
            counter.fetch_add(1, Ordering::Relaxed);
            Some(if current.load(Ordering::Acquire) {
                HashSet::from([UUID.to_owned()])
            } else {
                HashSet::new()
            })
        }),
        ..Default::default()
    };
    let mut engine = engine(&fixture, bindings);
    let relative = format!("{UUID}.jsonl");
    let body = serde_json::json!({"type":"event_msg","payload":{"type":"user_message","message":"EXACT_NATIVE_SENTINEL"}}).to_string();
    fs::write(fixture.root.join(&relative), &body).unwrap();
    let selected = selected(
        &fixture,
        &mut engine,
        SelectedSourceClassV1::CodexSessionMetadata,
        &relative,
    );
    engine
        .resume(&fixture.state, selected.key(), HashSet::new())
        .unwrap();
    engine.sample(&fixture.state, &now());
    let first = snapshot(&engine).references();
    assert_eq!(first.len(), 1);
    let before = calls.load(Ordering::Relaxed);
    engine.sample(&fixture.state, &now());
    assert_eq!(calls.load(Ordering::Relaxed), before);
    excluded.store(true, Ordering::Release);
    fs::write(fixture.root.join(&relative), &body).unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    while engine.delay().is_none_or(|delay| delay != Duration::ZERO) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    assert!(engine.delay().is_some_and(|delay| delay == Duration::ZERO));
    engine.sample(&fixture.state, &now());
    assert!(calls.load(Ordering::Relaxed) > before);
    assert!(snapshot(&engine).references().is_empty());
    assert_eq!(
        snapshot(&engine)
            .resolve(&first[0], false, |_, _| None)
            .material_state,
        AwarenessMaterialStateV1::Excluded
    );
    assert!(engine.delay().is_none());
    engine.close(&fixture.state.companion_awareness);
}

#[test]
fn retained_exact_exclusions_are_pure_bound_and_do_not_read_a_transcript() {
    let fixture = Fixture::new();
    let mut engine = engine(&fixture, SourceRuntimeBindingsV1::default());
    let relative = format!("{UUID}.jsonl");
    let selected = selected(
        &fixture,
        &mut engine,
        SelectedSourceClassV1::CodexSessionMetadata,
        &relative,
    );
    assert!(!fixture.root.join(&relative).exists());
    let record = reference(selected.key(), "retained-native-source");
    let allowed = selected
        .with_safe_exclusion_facts(&record, &HashSet::new())
        .unwrap();
    assert_eq!(
        allowed.material.material_state,
        AwarenessMaterialStateV1::Available
    );
    assert!(!allowed.material.source_fresh);
    assert!(!allowed.session_ref.unwrap().as_str().contains(UUID));
    let blocked = selected
        .with_safe_exclusion_facts(&record, &HashSet::from([UUID.to_owned()]))
        .unwrap();
    assert_eq!(
        blocked.material.material_state,
        AwarenessMaterialStateV1::Excluded
    );
    let mut wrong = record;
    wrong.resident_pubkey = Hex64::parse("cc".repeat(32)).unwrap();
    assert!(selected
        .with_safe_exclusion_facts(&wrong, &HashSet::new())
        .is_err());
    assert!(!fixture.root.join(relative).exists());
    let private = self::selected(
        &fixture,
        &mut engine,
        SelectedSourceClassV1::CodexSessionMetadata,
        &format!("subagents/{UUID}.jsonl"),
    );
    assert!(private
        .with_safe_exclusion_facts(
            &reference(private.key(), "private-path-observation"),
            &HashSet::new()
        )
        .is_err());
}
