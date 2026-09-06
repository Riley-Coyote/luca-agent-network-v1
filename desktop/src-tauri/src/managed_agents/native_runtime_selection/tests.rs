use super::*;

fn fixture() -> (tempfile::TempDir, SelectionStore, SelectedExecutable) {
    let dir = tempfile::tempdir().expect("fixture");
    let store = SelectionStore::open(dir.path()).expect("store");
    let path = dir.path().join("hermes");
    fs::write(&path, "#!/bin/sh\nprintf 'Hermes Agent v0.17.0\\n'\n").expect("write");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).expect("executable");
    }
    let selected = validate_picked(&path, |_| Ok("Hermes Agent v0.17.0".into())).expect("selected");
    (dir, store, selected)
}

#[test]
fn native_runtime_selection_round_trip_survives_restart_and_unrelated_store_saves() {
    let (dir, mut store, selected) = fixture();
    store
        .save(store.observed.clone(), Some(selected.clone()))
        .expect("save");
    let original = fs::read(store.path()).expect("record");
    // These independent writer destinations cannot replace the selection.
    for name in ["global-agent-config.json", "operator-forge-v1.json"] {
        super::super::storage::atomic_write_json_restricted(&store.parent.join(name), b"{}")
            .expect("unrelated save");
    }
    assert_eq!(original, fs::read(store.path()).expect("record unchanged"));
    let reopened = SelectionStore::open(dir.path()).expect("reopen");
    assert_eq!(
        reopened.selected().expect("valid").expect("selected").path,
        selected.path
    );
    assert_eq!(view(reopened.selected()).status, "selected");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(store.path())
                .expect("metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[test]
fn native_runtime_selection_first_use_and_interrupted_initialization_are_explicitly_automatic() {
    let (dir, store, _selected) = fixture();
    assert_eq!(store.status().status, "automatic");
    assert!(store.path().is_file());
    assert_eq!(
        fs::read(store.parent.join(INTENT_NAME)).expect("intent"),
        INTENT_BYTES
    );
    let automatic = fs::read(store.path()).expect("automatic record");
    // A crash after initial automatic JSON but before the marker does not
    // overwrite that record or reinterpret an existing selected record.
    fs::remove_file(store.parent.join(INTENT_NAME)).expect("simulate interrupted init");
    let reopened = SelectionStore::open(dir.path()).expect("recover init");
    assert_eq!(reopened.status().status, "automatic");
    assert_eq!(fs::read(store.path()).expect("record retained"), automatic);
}

#[test]
fn native_runtime_selection_cold_missing_record_requires_explicit_recovery() {
    let (dir, mut store, selected) = fixture();
    store
        .save(store.observed.clone(), Some(selected.clone()))
        .expect("save");
    fs::remove_file(store.path()).expect("remove record while stopped");
    let mut reopened = SelectionStore::open(dir.path()).expect("reopen");
    assert_eq!(reopened.status().status, "invalid");
    assert!(reopened.selected().is_err());
    reopened
        .save(None, Some(selected))
        .expect("explicit Choose recovers");
    assert_eq!(reopened.status().status, "selected");
    fs::remove_file(reopened.path()).expect("remove again");
    let mut reopened = SelectionStore::open(dir.path()).expect("reopen");
    reopened
        .save(None, None)
        .expect("explicit automatic clear recovers");
    assert_eq!(reopened.status().status, "automatic");
    assert_eq!(
        SelectionStore::open(dir.path())
            .expect("restart")
            .status()
            .status,
        "automatic"
    );
}

#[cfg(unix)]
#[test]
fn native_runtime_selection_intent_corruption_or_link_never_resets_the_choice() {
    use std::os::unix::fs::symlink;
    let (dir, mut store, selected) = fixture();
    store
        .save(store.observed.clone(), Some(selected))
        .expect("save");
    let marker = store.parent.join(INTENT_NAME);
    let before = fs::read(store.path()).expect("record");
    fs::write(&marker, "corrupt").expect("corrupt intent");
    assert!(store.selected().is_err());
    assert!(SelectionStore::open(dir.path()).is_err());
    fs::remove_file(&marker).expect("remove marker");
    let elsewhere = dir.path().join("marker-target");
    fs::write(&elsewhere, INTENT_BYTES).expect("target");
    symlink(&elsewhere, &marker).expect("linked intent");
    assert!(SelectionStore::open(dir.path()).is_err());
    assert_eq!(fs::read(store.path()).expect("record unchanged"), before);
    let message = view(Err(STORAGE_UNSAFE.into())).message.expect("guidance");
    assert!(message.contains("restart Luca"));
    assert!(!message.contains("automatic discovery"));
}

#[test]
fn native_runtime_selection_explicit_clear_invalidates_an_older_picker() {
    let (_dir, mut store, selected) = fixture();
    let picker_revision = store
        .snapshot()
        .expect("before picker")
        .map(|(_, witness)| witness);
    store
        .save(store.observed.clone(), None)
        .expect("clear automatic creates a revision");
    let cleared = fs::read(store.path()).expect("clear record");
    assert!(store
        .save(picker_revision, Some(selected))
        .unwrap_err()
        .contains("picker"));
    assert_eq!(cleared, fs::read(store.path()).expect("unchanged"));
    assert_eq!(view(store.selected()).mode, "automatic");
}

#[test]
fn native_runtime_selection_failed_probe_or_changed_candidate_preserves_previous_choice() {
    let (_dir, mut store, selected) = fixture();
    store
        .save(store.observed.clone(), Some(selected.clone()))
        .expect("save");
    let before = fs::read(store.path()).expect("before");
    assert!(validate_picked(&selected.path, |_| Err("probe failure".into())).is_err());
    assert_eq!(before, fs::read(store.path()).expect("after failed probe"));
    assert!(validate_picked(&selected.path, |path| {
        fs::write(path, "#!/bin/sh\nexit 1\n").expect("replace during probe");
        Ok("Hermes Agent v0.17.0".into())
    })
    .is_err());
    assert_eq!(
        before,
        fs::read(store.path()).expect("after changed candidate")
    );
    let invalid = view(store.selected());
    assert_eq!(invalid.status, "invalid");
    assert!(invalid.message.expect("recovery").contains("Settings"));
}

#[test]
fn native_runtime_selection_missing_executable_fails_and_explicit_clear_recovers() {
    let (_dir, mut store, selected) = fixture();
    store
        .save(store.observed.clone(), Some(selected.clone()))
        .expect("save");
    fs::remove_file(&selected.path).expect("remove fixture executable");
    assert!(store.selected().is_err());
    let status = store.status();
    assert_eq!(status.executable_path.as_deref(), selected.path.to_str());
    assert_eq!(
        status.runtime_version.as_deref(),
        Some("Hermes Agent v0.17.0")
    );
    let expected = store
        .snapshot()
        .expect("snapshot")
        .map(|(_, witness)| witness);
    store.save(expected, None).expect("explicit clear");
    assert!(store.selected().expect("automatic").is_none());
}

#[test]
fn native_runtime_selection_corrupt_replaced_or_removed_record_never_becomes_automatic() {
    for replacement in [
        Some(b"invalid json".as_slice()),
        Some(b"{}".as_slice()),
        None,
    ] {
        let (_dir, mut store, selected) = fixture();
        store
            .save(store.observed.clone(), Some(selected))
            .expect("save");
        fs::remove_file(store.path()).expect("remove record");
        if let Some(bytes) = replacement {
            fs::write(store.path(), bytes).expect("replace record");
        }
        assert_eq!(view(store.selected()).status, "invalid");
        let reopened =
            SelectionStore::open(&store.root).expect("reopen invalid bytes or missing record");
        assert_eq!(view(reopened.selected()).status, "invalid");
    }
}

#[cfg(unix)]
#[test]
fn native_runtime_selection_linked_record_parent_and_replaced_parent_are_rejected() {
    use std::os::unix::fs::symlink;
    let (dir, mut store, selected) = fixture();
    store
        .save(store.observed.clone(), Some(selected.clone()))
        .expect("save");
    let original = fs::read(store.path()).expect("record");
    let elsewhere = dir.path().join("elsewhere.json");
    fs::write(&elsewhere, &original).expect("elsewhere");
    fs::remove_file(store.path()).expect("remove");
    symlink(&elsewhere, store.path()).expect("link record");
    assert!(store.selected().is_err());
    assert!(store.save(store.observed.clone(), None).is_err());
    assert_eq!(
        original,
        fs::read(&elsewhere).expect("link target preserved")
    );
    fs::remove_file(store.path()).expect("unlink record");
    let old_parent = dir.path().join("old-agents");
    fs::rename(&store.parent, &old_parent).expect("move parent");
    symlink(&old_parent, &store.parent).expect("link parent");
    assert!(store
        .save(store.observed.clone(), Some(selected.clone()))
        .is_err());
    fs::remove_file(&store.parent).expect("unlink parent");
    fs::create_dir(&store.parent).expect("replace directory");
    assert!(store.save(store.observed.clone(), Some(selected)).is_err());
    assert!(!store.path().exists());
}

#[cfg(unix)]
#[test]
fn native_runtime_selection_candidate_replacement_symlink_nonregular_and_nonexecutable_fail() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let (dir, _store, selected) = fixture();
    let replacement = dir.path().join("replacement");
    fs::rename(&selected.path, &replacement).expect("move");
    symlink(&replacement, &selected.path).expect("link");
    assert!(selected.validate().is_err());
    fs::remove_file(&selected.path).expect("unlink");
    fs::create_dir(&selected.path).expect("directory");
    assert!(validate_picked(&selected.path, |_| panic!("must not execute directory")).is_err());
    fs::remove_dir(&selected.path).expect("remove directory");
    fs::rename(&replacement, &selected.path).expect("restore");
    fs::set_permissions(&selected.path, fs::Permissions::from_mode(0o600)).expect("permissions");
    assert!(validate_picked(&selected.path, |_| panic!("must not execute nonexecutable")).is_err());
}

#[test]
fn native_runtime_selection_oversized_record_is_rejected_without_reading_it() {
    let (_dir, store, _selected) = fixture();
    let file = fs::File::create(store.path()).expect("file");
    file.set_len(MAX_RECORD_BYTES + 1).expect("length");
    assert!(store.snapshot().is_err());
}

#[cfg(unix)]
#[test]
fn native_runtime_selection_atomic_replace_never_writes_through_a_raced_symlink() {
    use std::os::unix::fs::symlink;
    let dir = tempfile::tempdir().expect("fixture");
    let target = dir.path().join("outside-target");
    fs::write(&target, "preserve-exactly").expect("target");
    let destination = dir.path().join(STORE_NAME);
    // Model replacement after the final CAS: the primitive must atomically
    // replace this link, never canonicalize it and overwrite its target.
    symlink(&target, &destination).expect("raced link");
    replace_restricted(&destination, b"new-record").expect("atomic replace");
    assert_eq!(fs::read(&target).expect("target"), b"preserve-exactly");
    assert_eq!(fs::read(&destination).expect("record"), b"new-record");
    assert!(!fs::symlink_metadata(destination)
        .expect("metadata")
        .file_type()
        .is_symlink());
}

#[test]
fn native_runtime_selection_does_not_change_existing_absolute_binding() {
    let (dir, mut store, selected) = fixture();
    let home = dir.path().canonicalize().expect("home");
    let binding = super::super::RuntimeBinding::Hermes {
        schema_version: 1,
        profile_name: "unchanged".into(),
        hermes_home: home,
        executable_path: selected.path.clone(),
        runtime_version: "original".into(),
        default_workspace: None,
    };
    let before = serde_json::to_vec(&binding).expect("binding");
    store
        .save(store.observed.clone(), Some(selected.clone()))
        .expect("selection");
    let expected = store
        .snapshot()
        .expect("snapshot")
        .map(|(_, witness)| witness);
    store.save(expected, None).expect("clear selection");
    assert_eq!(
        before,
        serde_json::to_vec(&binding).expect("unchanged binding")
    );
    let resolved =
        super::super::resolve_native_runtime_binding(&binding).expect("absolute restart");
    assert_eq!(resolved.command, selected.path);
    assert_eq!(resolved.args, vec!["acp"]);
}
