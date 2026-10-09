//! Only disposable files and an isolated generated owner; no identity env,
//! keychain, native profile, network, or model is used by these fixtures.
use super::*;
use crate::app_state::build_isolated_test_app_state;
use luca_protocol::{AwarenessChoicesV1, AwarenessGrantStateV1, AwarenessGrantV1, Hex64};

pub(crate) fn id(value: &str) -> OpaqueId {
    OpaqueId::parse(value).unwrap()
}
pub(crate) fn number(value: u64) -> SafeU53 {
    SafeU53::new(value).unwrap()
}
pub(crate) fn now() -> CanonicalTimestamp {
    CanonicalTimestamp::parse("2026-10-08T10:00:02Z").unwrap()
}
pub(crate) struct Fixture {
    pub(crate) _directory: tempfile::TempDir,
    pub(crate) root: PathBuf,
    pub(crate) state: AppState,
    pub(crate) runtime: CompanionAwarenessRuntime,
    pub(crate) resident: Hex64,
}
impl Fixture {
    pub(crate) fn new() -> Self {
        #[cfg(unix)]
        let directory = tempfile::tempdir_in("/tmp").unwrap();
        #[cfg(not(unix))]
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let state = build_isolated_test_app_state();
        let live = LiveAwarenessOwner::authenticate(&state).unwrap();
        let resident = Hex64::parse("bb".repeat(32)).unwrap();
        let runtime = CompanionAwarenessRuntime::default();
        runtime.initialize(&root, Some(live.owner()));
        runtime
            .set_paused(
                live.owner(),
                &resident,
                Some(&live),
                None,
                false,
                &CanonicalTimestamp::parse("2026-10-08T10:00:00Z").unwrap(),
                &id("resume"),
            )
            .unwrap();
        Self {
            _directory: directory,
            root,
            state,
            runtime,
            resident,
        }
    }
    pub(crate) fn grant(&self, source_id: OpaqueId, observe: bool) -> AwarenessGrantKeyV1 {
        let live = LiveAwarenessOwner::authenticate(&self.state).unwrap();
        let key = AwarenessGrantKeyV1 {
            source: super::super::AwarenessSourceKeyV1 {
                owner_pubkey: live.owner().clone(),
                source_id,
                device_id: self.runtime.device(live.owner()).unwrap(),
            },
            resident_pubkey: self.resident.clone(),
        };
        self.runtime
            .register_source(&live, &key.source, &new_id("register").unwrap())
            .unwrap();
        let grant = AwarenessGrantV1 {
            protocol: AWARENESS_PROTOCOL.into(),
            grant_id: new_id("grant").unwrap(),
            owner_pubkey: live.owner().clone(),
            resident_pubkey: self.resident.clone(),
            source_id: key.source.source_id.clone(),
            device_id: key.source.device_id.clone(),
            grant_revision: number(1),
            deny_epoch: number(0),
            state: AwarenessGrantStateV1::Active,
            choices: AwarenessChoicesV1 {
                observe,
                retain: false,
                promote: false,
                provider_egress_binding: None,
            },
        };
        self.runtime
            .put_grant(&live, &grant, None, &new_id("choose").unwrap())
            .unwrap();
        key
    }
    pub(crate) fn payload(&self, reference: &AwarenessObservationRefV1) -> serde_json::Value {
        let live = LiveAwarenessOwner::authenticate(&self.state).unwrap();
        let time = now();
        let facts = AwarenessHostFactsV1 {
            owner_pubkey: live.owner(),
            resident_pubkey: &self.resident,
            now: &time,
            source_fresh: true,
            material_state: AwarenessMaterialStateV1::Available,
        };
        self.runtime
            .with_payload(&live, &facts, reference, Default::default(), |bytes| {
                serde_json::from_slice(bytes).unwrap()
            })
            .unwrap()
    }
}
pub(crate) fn admitted(outcome: SamplingOutcomeV1) -> AwarenessObservationRefV1 {
    match outcome {
        SamplingOutcomeV1::Admitted(value) => value,
        _ => panic!("expected synthetic admission"),
    }
}

#[test]
fn unchanged_content_is_freshly_admitted_after_pause_resume_evicted_context() {
    let fixture = Fixture::new();
    fs::write(
        fixture.root.join("selected.txt"),
        "UNCHANGED_RESUME_SENTINEL",
    )
    .unwrap();
    let source =
        SelectedFileHandleV1::source_id_for_selection(&fixture.root, "selected.txt").unwrap();
    let key = fixture.grant(source, true);
    let handle =
        SelectedFileHandleV1::new(key.clone(), fixture.root.clone(), "selected.txt".into())
            .unwrap();
    let mut adapter = SelectedFilesAdapter::new(handle);
    adapter.set_enabled(true);
    let first = admitted(
        adapter
            .sample(&fixture.state, &fixture.runtime, &now(), number(1))
            .unwrap(),
    );
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    let state = fixture
        .runtime
        .resident_state(live.owner(), &fixture.resident)
        .unwrap();
    let paused_at = CanonicalTimestamp::parse("2026-10-08T10:00:03Z").unwrap();
    fixture
        .runtime
        .set_paused(
            live.owner(),
            &fixture.resident,
            None,
            Some(state.revision),
            true,
            &paused_at,
            &id("pause-before-same-content"),
        )
        .unwrap();
    let state = fixture
        .runtime
        .resident_state(live.owner(), &fixture.resident)
        .unwrap();
    let resumed_at = CanonicalTimestamp::parse("2026-10-08T10:00:04Z").unwrap();
    fixture
        .runtime
        .set_paused(
            live.owner(),
            &fixture.resident,
            Some(&live),
            Some(state.revision),
            false,
            &resumed_at,
            &id("resume-same-content"),
        )
        .unwrap();
    adapter.mark_changed();
    let fresh_at = CanonicalTimestamp::parse("2026-10-08T10:00:05Z").unwrap();
    let fresh = admitted(
        adapter
            .sample(&fixture.state, &fixture.runtime, &fresh_at, number(2))
            .unwrap(),
    );
    assert_ne!(first.observation_id, fresh.observation_id);
    assert_eq!(first.evidence_ref, fresh.evidence_ref);
    let facts = AwarenessHostFactsV1 {
        owner_pubkey: live.owner(),
        resident_pubkey: &fixture.resident,
        now: &fresh_at,
        source_fresh: true,
        material_state: AwarenessMaterialStateV1::Available,
    };
    assert!(fixture
        .runtime
        .with_payload(&live, &facts, &first, Default::default(), |_| ())
        .is_err());
    assert!(fixture
        .runtime
        .with_payload(&live, &facts, &fresh, Default::default(), |_| ())
        .is_ok());
}

#[test]
fn rejected_resume_second_does_not_poison_later_changed_file_capture() {
    let fixture = Fixture::new();
    fs::write(fixture.root.join("selected.txt"), "RESUME_BOUNDARY_SENTINEL").unwrap();
    let source =
        SelectedFileHandleV1::source_id_for_selection(&fixture.root, "selected.txt").unwrap();
    let key = fixture.grant(source, true);
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    let control = fixture.runtime.resident_state(live.owner(), &fixture.resident).unwrap();
    fixture.runtime.set_paused(
        live.owner(), &fixture.resident, Some(&live), Some(control.revision), false,
        &now(), &id("resume-at-capture-second"),
    ).unwrap();
    let handle =
        SelectedFileHandleV1::new(key.clone(), fixture.root.clone(), "selected.txt".into()).unwrap();
    let mut adapter = SelectedFilesAdapter::new(handle);
    adapter.set_enabled(true);
    let sequence = fixture.runtime.next_sequence(&live, &key).unwrap();
    assert_eq!(sequence, number(1));
    assert_eq!(
        adapter.sample(&fixture.state, &fixture.runtime, &now(), sequence),
        Err(AwarenessStoreError::Denied(luca_protocol::AwarenessError::Stale)),
    );
    // Rejected payloads remain absent, but their in-process replay watermark
    // must be respected when allocating the next real change's sequence.
    assert_eq!(fixture.runtime.next_sequence(&live, &key).unwrap(), number(2));
    fs::write(fixture.root.join("selected.txt"), "NEW_CHANGE_AFTER_RESUME").unwrap();
    adapter.mark_changed();
    let fresh_at = CanonicalTimestamp::parse("2026-10-08T10:00:03Z").unwrap();
    let fresh = admitted(adapter.sample(
        &fixture.state, &fixture.runtime, &fresh_at,
        fixture.runtime.next_sequence(&live, &key).unwrap(),
    ).unwrap());
    assert_eq!(fresh.sequence, number(2));
    let facts = AwarenessHostFactsV1 {
        owner_pubkey: live.owner(), resident_pubkey: &fixture.resident, now: &fresh_at,
        source_fresh: true, material_state: AwarenessMaterialStateV1::Available,
    };
    let body = fixture.runtime.with_payload(&live, &facts, &fresh, Default::default(),
        |bytes| String::from_utf8(bytes.to_vec()).unwrap()).unwrap();
    assert!(body.contains("NEW_CHANGE_AFTER_RESUME"));
}

#[test]
fn default_off_and_ungranted_unknown_source_do_not_read_or_admit() {
    let fixture = Fixture::new();
    fs::write(
        fixture.root.join("selected.txt"),
        "SENTINEL private selected text",
    )
    .unwrap();
    let source =
        SelectedFileHandleV1::source_id_for_selection(&fixture.root, "selected.txt").unwrap();
    let key = fixture.grant(source, false);
    let handle =
        SelectedFileHandleV1::new(key.clone(), fixture.root.clone(), "selected.txt".into())
            .unwrap();
    let mut adapter = SelectedFilesAdapter::new(handle);
    assert_eq!(
        adapter
            .sample(&fixture.state, &fixture.runtime, &now(), number(1))
            .unwrap(),
        SamplingOutcomeV1::Disabled
    );
    adapter.set_enabled(true);
    assert_eq!(
        adapter.sample(&fixture.state, &fixture.runtime, &now(), number(1)),
        Err(AwarenessStoreError::Invalid)
    );
    let owner = key.source.owner_pubkey.clone();
    assert_eq!(
        fixture.runtime.snapshot(&owner, &key).unwrap().source.state,
        AwarenessSourceStateV1::Unknown
    );
    assert_eq!(
        adapter
            .sample(&fixture.state, &fixture.runtime, &now(), number(1))
            .unwrap(),
        SamplingOutcomeV1::Quiet
    );
}

#[test]
fn granted_changed_file_admits_coalesces_and_probes_unavailable_without_brain() {
    let fixture = Fixture::new();
    let path = fixture.root.join("selected.txt");
    fs::write(&path, "SELECTED_FILE_SENTINEL_ALPHA").unwrap();
    let source =
        SelectedFileHandleV1::source_id_for_selection(&fixture.root, "selected.txt").unwrap();
    let key = fixture.grant(source, true);
    let handle =
        SelectedFileHandleV1::new(key.clone(), fixture.root.clone(), "selected.txt".into())
            .unwrap();
    assert!(!format!("{handle:?}").contains(fixture.root.to_str().unwrap()));
    let mut adapter = SelectedFilesAdapter::new(handle);
    adapter.set_enabled(true);
    let first = admitted(
        adapter
            .sample(&fixture.state, &fixture.runtime, &now(), number(1))
            .unwrap(),
    );
    let payload = fixture.payload(&first);
    assert_eq!(payload["text"], "SELECTED_FILE_SENTINEL_ALPHA");
    assert!(!payload.to_string().contains(fixture.root.to_str().unwrap()));
    let owner = key.source.owner_pubkey.clone();
    assert_eq!(
        fixture
            .runtime
            .snapshot(&owner, &key)
            .unwrap()
            .source_revision,
        number(2)
    );
    for _ in 0..20 {
        adapter.mark_changed();
    }
    assert_eq!(
        adapter
            .sample(&fixture.state, &fixture.runtime, &now(), number(2))
            .unwrap(),
        SamplingOutcomeV1::Unchanged
    );
    assert_eq!(
        fixture
            .runtime
            .snapshot(&owner, &key)
            .unwrap()
            .source_revision,
        number(2)
    );
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    fixture
        .runtime
        .set_source_health(
            &live,
            &key.source,
            number(2),
            AwarenessSourceStateV1::Unavailable,
            &id("temporarily-unavailable"),
        )
        .unwrap();
    adapter.mark_changed();
    assert_eq!(
        adapter
            .sample(&fixture.state, &fixture.runtime, &now(), number(2))
            .unwrap(),
        SamplingOutcomeV1::Unchanged
    );
    assert_eq!(
        fixture.runtime.snapshot(&owner, &key).unwrap().source.state,
        AwarenessSourceStateV1::Current
    );
    fs::write(&path, "SELECTED_FILE_SENTINEL_BETA").unwrap();
    adapter.mark_changed();
    let changed = admitted(
        adapter
            .sample(&fixture.state, &fixture.runtime, &now(), number(2))
            .unwrap(),
    );
    assert_eq!(
        fixture.payload(&changed)["text"],
        "SELECTED_FILE_SENTINEL_BETA"
    );
    assert_eq!(changed.sequence, number(2));
    let current = fixture.runtime.snapshot(&owner, &key).unwrap();
    fixture
        .runtime
        .withdraw_grant(
            &owner,
            &key,
            current.grant.grant_revision,
            super::super::AwarenessWithdrawalV1::Withdraw,
            &id("withdraw"),
        )
        .unwrap();
    adapter.mark_changed();
    assert!(adapter
        .sample(&fixture.state, &fixture.runtime, &now(), number(3))
        .is_err());
}

#[test]
fn selection_size_exclusion_and_json_escaping_have_real_bounds() {
    let fixture = Fixture::new();
    let source = SelectedFileHandleV1::source_id_for_selection(&fixture.root, "large.txt").unwrap();
    let key = fixture.grant(source, true);
    fs::write(
        fixture.root.join("large.txt"),
        vec![b'x'; MAX_SELECTED_FILE_BYTES + 1],
    )
    .unwrap();
    let handle =
        SelectedFileHandleV1::new(key.clone(), fixture.root.clone(), "large.txt".into()).unwrap();
    let mut adapter = SelectedFilesAdapter::new(handle);
    adapter.set_enabled(true);
    assert!(adapter
        .sample(&fixture.state, &fixture.runtime, &now(), number(1))
        .is_err());
    assert_eq!(
        fixture
            .runtime
            .snapshot(&key.source.owner_pubkey, &key)
            .unwrap()
            .source
            .state,
        AwarenessSourceStateV1::Unavailable
    );
    assert!(SelectedFileHandleV1::source_id_for_selection(&fixture.root, ".env").is_err());
    assert!(
        SelectedFileHandleV1::new(key, fixture.root.clone(), "ungranted-other.txt".into()).is_err()
    );
    assert_eq!(
        encode_bounded(&serde_json::json!({"text":"\u{1}".repeat(MAX_SELECTED_FILE_BYTES)})),
        Err(AwarenessStoreError::Capacity)
    );
}
