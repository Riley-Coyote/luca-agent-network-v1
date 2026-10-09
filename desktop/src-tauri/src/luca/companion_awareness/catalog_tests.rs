//! Disposable sentinel roots and generated isolated owners only. No personal
//! session/profile discovery, native runtime, app observation or model calls.
use super::super::selected_files::tests::{admitted, id, now, number, Fixture};
use super::*;
use luca_protocol::{AwarenessMaterialStateV1, AwarenessUseV1};
use notify::event::{AccessKind, CreateKind, ModifyKind, RenameMode};
use std::os::unix::fs::{symlink, PermissionsExt};
use std::sync::mpsc;

fn private_directory(fixture: &Fixture) -> PathBuf {
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    fixture.runtime.private_directory(live.owner()).unwrap()
}
fn catalog(fixture: &Fixture) -> SelectedSourceCatalogV1 {
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    SelectedSourceCatalogV1::open(
        &private_directory(fixture),
        live.owner(),
        &fixture.runtime.device(live.owner()).unwrap(),
    )
    .unwrap()
}
fn selection(fixture: &Fixture, relative: &str, observe: bool) -> SelectedSourceSelectionV1 {
    fs::write(
        fixture.root.join(relative),
        "CATALOG_SELECTED_SENTINEL_BODY",
    )
    .unwrap();
    let source = SelectedSourceClassV1::SelectedFile
        .source_id(&fixture.root, relative)
        .unwrap();
    let key = fixture.grant(source, observe);
    SelectedSourceSelectionV1::new(
        key,
        SelectedSourceClassV1::SelectedFile,
        fixture.root.clone(),
        relative.into(),
    )
    .unwrap()
}
fn collectors(fixture: &Fixture) -> SelectedSourceCollectorsV1 {
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    SelectedSourceCollectorsV1::new(
        live.owner().clone(),
        fixture.resident.clone(),
        fixture.runtime.device(live.owner()).unwrap(),
    )
}
fn buffered(fixture: &Fixture) -> String {
    let owner = fixture.runtime.control_owner().unwrap();
    fixture
        .runtime
        .with_controller(&owner, |controller| Ok(format!("{:?}", controller.buffer)))
        .unwrap()
}

#[test]
fn private_catalog_restores_known_handles_off_without_bodies_or_class_widening() {
    let fixture = Fixture::new();
    let mut catalog = catalog(&fixture);
    let path = private_directory(&fixture).join(SELECTED_SOURCE_CATALOG_FILENAME);
    assert!(!path.exists());
    assert!(catalog.selections(&fixture.resident).unwrap().is_empty());
    assert!(collectors(&fixture).owned.is_empty());
    let selected = selection(&fixture, "selected.txt", true);
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    catalog.select(&live, selected.clone()).unwrap();
    let first = fs::read(&path).unwrap();
    catalog.select(&live, selected.clone()).unwrap();
    assert_eq!(first, fs::read(&path).unwrap());
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert!(!String::from_utf8(first)
        .unwrap()
        .contains("CATALOG_SELECTED_SENTINEL_BODY"));
    assert!(!format!("{catalog:?} {selected:?}").contains("selected.txt"));
    let restored = SelectedSourceCatalogV1::open(
        &private_directory(&fixture),
        live.owner(),
        &fixture.runtime.device(live.owner()).unwrap(),
    )
    .unwrap();
    assert_eq!(
        restored.selections(&fixture.resident).unwrap(),
        vec![selected.clone()]
    );
    assert!(restored
        .selections(&Hex64::parse("cc".repeat(32)).unwrap())
        .unwrap()
        .is_empty());
    assert!(collectors(&fixture).next_sample_delay().is_none());
    assert!(SelectedSourceSelectionV1::new(
        selected.key.clone(),
        SelectedSourceClassV1::CodexSessionVisibleExcerpts,
        fixture.root.clone(),
        "selected.txt".into()
    )
    .is_err());
    let metadata = SelectedSourceClassV1::CodexSessionMetadata
        .source_id(&fixture.root, "session.jsonl")
        .unwrap();
    let excerpts = SelectedSourceClassV1::CodexSessionVisibleExcerpts
        .source_id(&fixture.root, "session.jsonl")
        .unwrap();
    assert_ne!(metadata, excerpts);
    assert!(SelectedSourceSelectionV1::new(
        selected.key.clone(),
        selected.class,
        fixture.root.clone(),
        "../selected.txt".into()
    )
    .is_err());
    catalog.remove(live.owner(), selected.key()).unwrap();
    assert!(catalog.selections(&fixture.resident).unwrap().is_empty());
    assert_eq!(
        restored.selections(&fixture.resident),
        Err(AwarenessStoreError::Conflict)
    );
}

#[test]
fn foreign_malformed_and_nonprivate_catalogs_are_not_adopted_or_repaired() {
    let fixture = Fixture::new();
    let directory = private_directory(&fixture);
    let path = directory.join(SELECTED_SOURCE_CATALOG_FILENAME);
    fs::write(
        &path,
        br#"{"protocol":"foreign","credentials":"PRIVATE_SENTINEL"}"#,
    )
    .unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    let before = fs::read(&path).unwrap();
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    let device = fixture.runtime.device(live.owner()).unwrap();
    assert!(matches!(
        SelectedSourceCatalogV1::open(&directory, live.owner(), &device),
        Err(AwarenessStoreError::Invalid)
    ));
    assert_eq!(before, fs::read(&path).unwrap());
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(matches!(
        SelectedSourceCatalogV1::open(&directory, live.owner(), &device),
        Err(AwarenessStoreError::UnsafePath)
    ));
    assert_eq!(before, fs::read(&path).unwrap());
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o644
    );
}

#[test]
fn saved_owner_device_unknown_fields_aliases_and_hardlinks_fail_closed() {
    let fixture = Fixture::new();
    let mut catalog = catalog(&fixture);
    let selected = selection(&fixture, "selected.txt", true);
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    catalog.select(&live, selected).unwrap();
    let directory = private_directory(&fixture);
    let path = directory.join(SELECTED_SOURCE_CATALOG_FILENAME);
    let device = fixture.runtime.device(live.owner()).unwrap();
    assert!(matches!(
        SelectedSourceCatalogV1::open(&directory, &Hex64::parse("cc".repeat(32)).unwrap(), &device),
        Err(AwarenessStoreError::Invalid)
    ));
    assert!(matches!(
        SelectedSourceCatalogV1::open(&directory, live.owner(), &id("foreign-device")),
        Err(AwarenessStoreError::Invalid)
    ));
    let alias = fixture.root.join("catalog-alias");
    symlink(&directory, &alias).unwrap();
    assert!(matches!(
        SelectedSourceCatalogV1::open(&alias, live.owner(), &device),
        Err(AwarenessStoreError::UnsafePath)
    ));
    let mut saved: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    saved["selections"][0]["tools"] = serde_json::json!(["shell"]);
    fs::write(&path, serde_json::to_vec(&saved).unwrap()).unwrap();
    assert!(matches!(
        SelectedSourceCatalogV1::open(&directory, live.owner(), &device),
        Err(AwarenessStoreError::Invalid)
    ));
    fs::hard_link(&path, fixture.root.join("catalog-hardlink")).unwrap();
    assert!(matches!(
        SelectedSourceCatalogV1::open(&directory, live.owner(), &device),
        Err(AwarenessStoreError::UnsafePath)
    ));
}

#[test]
fn exact_changed_events_coalesce_and_never_follow_sibling_or_access_events() {
    let target = PathBuf::from("/internal/sentinel/selected.jsonl");
    assert!(!relevant_event(
        &Event::new(EventKind::Create(CreateKind::File))
            .add_path(PathBuf::from("/internal/sentinel/new-session.jsonl")),
        &target
    ));
    assert!(!relevant_event(
        &Event::new(EventKind::Access(AccessKind::Read)).add_path(target.clone()),
        &target
    ));
    assert!(relevant_event(
        &Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(PathBuf::from("/internal/sentinel/swap.tmp"))
            .add_path(target.clone()),
        &target
    ));
    let start = Instant::now();
    let mut pending = PendingChange::default();
    assert!(pending.delay(start).is_none());
    pending.mark(start);
    pending.mark(start + Duration::from_millis(500));
    assert_eq!(
        pending.delay(start + Duration::from_millis(750)),
        Some(Duration::from_millis(500))
    );
    assert!(pending
        .take_ready(start + Duration::from_millis(750))
        .is_none());
    assert_eq!(
        pending.take_ready(start + Duration::from_millis(1250)),
        Some(false)
    );
    assert!(pending.take_ready(start + Duration::from_secs(2)).is_none());
}

#[test]
fn denied_resume_starts_no_collector_and_saved_selections_do_not_supply_grants() {
    let fixture = Fixture::new();
    let mut catalog = catalog(&fixture);
    let selected = selection(&fixture, "ungranted.txt", false);
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    catalog.select(&live, selected.clone()).unwrap();
    let mut collectors = collectors(&fixture);
    let (wake, _) = mpsc::sync_channel(1);
    assert_eq!(
        collectors.resume(
            &catalog,
            &live,
            &fixture.runtime,
            selected.key(),
            HashSet::new(),
            wake
        ),
        Err(AwarenessStoreError::Invalid)
    );
    assert!(collectors.owned.is_empty());
    assert!(collectors
        .sample_pending(&fixture.state, &fixture.runtime, &now(), |_| None)
        .unwrap()
        .is_empty());
    assert_eq!(
        fixture
            .runtime
            .snapshot(live.owner(), selected.key())
            .unwrap()
            .source
            .state,
        AwarenessSourceStateV1::Unknown
    );
}

#[test]
fn scoped_stop_and_resume_are_fresh_serialized_and_quiet_between_changes() {
    // The only actual notify registrations in this fixture are these two
    // disposable sentinel files. No runtime profile or personal path is used.
    let fixture = Fixture::new();
    let mut catalog = catalog(&fixture);
    let first = selection(&fixture, "first.txt", true);
    let second = selection(&fixture, "second.txt", true);
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    catalog.select(&live, first.clone()).unwrap();
    catalog.select(&live, second.clone()).unwrap();
    let mut collectors = collectors(&fixture);
    let (wake, _events) = mpsc::sync_channel(1);
    collectors
        .resume(
            &catalog,
            &live,
            &fixture.runtime,
            first.key(),
            HashSet::new(),
            wake.clone(),
        )
        .unwrap();
    collectors
        .resume(
            &catalog,
            &live,
            &fixture.runtime,
            second.key(),
            HashSet::new(),
            wake.clone(),
        )
        .unwrap();
    assert_eq!(
        fixture
            .runtime
            .snapshot(live.owner(), first.key())
            .unwrap()
            .source
            .state,
        AwarenessSourceStateV1::Unknown
    );
    let probes = collectors
        .sample_pending(&fixture.state, &fixture.runtime, &now(), |_| None)
        .unwrap();
    assert_eq!(probes.len(), 2);
    let old = admitted(
        probes
            .into_iter()
            .find(|probe| probe.key == first.key)
            .unwrap()
            .outcome
            .unwrap(),
    );
    assert_eq!(old.sequence, number(1));
    assert!(collectors
        .sample_pending(&fixture.state, &fixture.runtime, &now(), |_| None)
        .unwrap()
        .is_empty());
    collectors
        .stop_grant(&fixture.runtime, first.key())
        .unwrap();
    assert_eq!(collectors.owned.len(), 1);
    assert_eq!(collectors.owned[0].key, second.key);
    let facts = super::super::AwarenessHostFactsV1 {
        owner_pubkey: live.owner(),
        resident_pubkey: &fixture.resident,
        now: &now(),
        source_fresh: true,
        material_state: AwarenessMaterialStateV1::Available,
    };
    assert!(fixture
        .runtime
        .with_payload(&live, &facts, &old, AwarenessUseV1::default(), |_| ())
        .is_err());
    collectors
        .resume(
            &catalog,
            &live,
            &fixture.runtime,
            first.key(),
            HashSet::new(),
            wake,
        )
        .unwrap();
    let fresh = admitted(
        collectors
            .sample_pending(&fixture.state, &fixture.runtime, &now(), |_| None)
            .unwrap()
            .into_iter()
            .find(|probe| probe.key == first.key)
            .unwrap()
            .outcome
            .unwrap(),
    );
    assert_eq!(fresh.sequence, number(2));
    assert_ne!(old.observation_id, fresh.observation_id);
    assert_eq!(old.evidence_ref, fresh.evidence_ref);
    let grant = fixture.runtime.snapshot(live.owner(), first.key()).unwrap();
    fixture
        .runtime
        .withdraw_grant(
            live.owner(),
            first.key(),
            grant.grant.grant_revision,
            super::super::AwarenessWithdrawalV1::Withdraw,
            &id("catalog-revoke"),
        )
        .unwrap();
    collectors
        .stop_grant(&fixture.runtime, first.key())
        .unwrap();
    assert_eq!(collectors.owned.len(), 1);
    assert_eq!(collectors.owned[0].key, second.key);
    collectors
        .stop_resident(&fixture.runtime, live.owner(), &fixture.resident)
        .unwrap();
    assert!(collectors.owned.is_empty());
    assert!(collectors.next_sample_delay().is_none());
    assert!(buffered(&fixture).contains("entries: 0"));
}

#[test]
fn restored_health_is_unknown_and_expiry_housekeeping_drops_unaccessed_bytes() {
    let fixture = Fixture::new();
    let mut catalog = catalog(&fixture);
    let selected = selection(&fixture, "expiry.txt", true);
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    catalog.select(&live, selected.clone()).unwrap();
    let mut adapter = selected.adapter(HashSet::new()).unwrap();
    adapter.set_enabled(true);
    let sequence = fixture
        .runtime
        .next_sequence(&live, selected.key())
        .unwrap();
    admitted(
        adapter
            .sample(&fixture.state, &fixture.runtime, &now(), sequence, None)
            .unwrap(),
    );
    assert!(buffered(&fixture).contains("entries: 1"));
    assert_eq!(
        fixture
            .runtime
            .snapshot(live.owner(), selected.key())
            .unwrap()
            .source
            .state,
        AwarenessSourceStateV1::Current
    );
    catalog
        .reset_restored_health(&live, &fixture.runtime, &fixture.resident)
        .unwrap();
    assert_eq!(
        fixture
            .runtime
            .snapshot(live.owner(), selected.key())
            .unwrap()
            .source
            .state,
        AwarenessSourceStateV1::Unknown
    );
    let retained = live.owner().clone();
    drop(live);
    // No payload access, live proof, source probe or grant update happens here.
    prune_expired_payloads(
        &fixture.runtime,
        &retained,
        &CanonicalTimestamp::parse("2026-10-08T10:06:00Z").unwrap(),
    )
    .unwrap();
    assert!(buffered(&fixture).contains("entries: 0"));
    assert!(buffered(&fixture).contains("bytes: 0"));
}
