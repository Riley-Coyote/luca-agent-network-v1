//! Generated owners and disposable operational JSON only; no app observation.
use super::*;
use crate::luca::companion_awareness::selected_files::tests::{id, Fixture};

fn selection(fixture: &Fixture, class: MachineObservationClassV1) -> MachineSourceSelectionV1 {
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    let request = MachineCaptureRequestV1::new(class, vec!["com.apple.TextEdit".into()], vec!["com.example.Excluded".into()],
        vec!["synthetic private document".into()], 4096).unwrap();
    MachineSourceSelectionV1::new(AwarenessGrantKeyV1 { source: AwarenessSourceKeyV1 {
        owner_pubkey: live.owner().clone(), device_id: fixture.runtime.device(live.owner()).unwrap(), source_id: request.source_id().unwrap(),
    }, resident_pubkey: fixture.resident.clone() }, request).unwrap()
}

#[test]
fn restore_has_only_exact_private_policy_and_never_grants_or_widens_capture() {
    let fixture = Fixture::new(); let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    let directory = fixture.runtime.private_directory(live.owner()).unwrap();
    let device = fixture.runtime.device(live.owner()).unwrap();
    let metadata = selection(&fixture, MachineObservationClassV1::AppMetadata);
    let mut catalog = MachineSourceCatalogV1::open(&directory, live.owner(), &device).unwrap();
    catalog.select(&live, metadata.clone()).unwrap();
    assert!(fixture.runtime.list_grants(live.owner(), &fixture.resident, 64).unwrap().entries.is_empty());
    let restored = MachineSourceCatalogV1::open(&directory, live.owner(), &device).unwrap();
    let rows = restored.selections(&fixture.resident).unwrap();
    assert_eq!(rows.len(), 1); assert_eq!(rows[0].key(), metadata.key());
    assert_eq!(rows[0].class(), MachineObservationClassV1::AppMetadata);
    assert!(restored.selections(&Hex64::parse("cc".repeat(32)).unwrap()).unwrap().is_empty());
    let text = selection(&fixture, MachineObservationClassV1::AccessibilityText);
    assert_ne!(metadata.key(), text.key());
    assert!(MachineSourceSelectionV1::new(metadata.key().clone(), text.request.clone()).is_err());
    assert!(!format!("{metadata:?}").contains("synthetic private document"));
    catalog.remove(live.owner(), metadata.key()).unwrap();
    assert!(catalog.selections(&fixture.resident).unwrap().is_empty());
}

#[test]
fn stale_catalog_writer_and_injected_enabled_claim_are_rejected_without_repair() {
    let fixture = Fixture::new(); let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    let directory = fixture.runtime.private_directory(live.owner()).unwrap();
    let device = fixture.runtime.device(live.owner()).unwrap();
    let mut first = MachineSourceCatalogV1::open(&directory, live.owner(), &device).unwrap();
    let mut stale = MachineSourceCatalogV1::open(&directory, live.owner(), &device).unwrap();
    first.select(&live, selection(&fixture, MachineObservationClassV1::AppMetadata)).unwrap();
    assert_eq!(stale.select(&live, selection(&fixture, MachineObservationClassV1::ScreenText)), Err(AwarenessStoreError::Conflict));
    let path = directory.join(MACHINE_CATALOG_FILENAME);
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["selections"][0]["enabled"] = serde_json::json!(true);
    let synthetic = serde_json::to_vec(&value).unwrap(); fs::write(&path, &synthetic).unwrap();
    assert!(MachineSourceCatalogV1::open(&directory, live.owner(), &device).is_err());
    assert_eq!(fs::read(&path).unwrap(), synthetic);
}

#[test]
fn foreign_principal_alias_and_policy_source_substitution_are_not_adopted() {
    let fixture = Fixture::new(); let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    let directory = fixture.runtime.private_directory(live.owner()).unwrap();
    let device = fixture.runtime.device(live.owner()).unwrap();
    let mut catalog = MachineSourceCatalogV1::open(&directory, live.owner(), &device).unwrap();
    catalog.select(&live, selection(&fixture, MachineObservationClassV1::AppMetadata)).unwrap();
    assert!(MachineSourceCatalogV1::open(&directory, &Hex64::parse("dd".repeat(32)).unwrap(), &device).is_err());
    let alias = fixture.root.join("machine-alias"); std::os::unix::fs::symlink(&directory, &alias).unwrap();
    assert!(MachineSourceCatalogV1::open(&alias, live.owner(), &device).is_err());
    let path = directory.join(MACHINE_CATALOG_FILENAME);
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["selections"][0]["source"] = serde_json::json!(id("different-policy-source"));
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(MachineSourceCatalogV1::open(&directory, live.owner(), &device).is_err());
}
