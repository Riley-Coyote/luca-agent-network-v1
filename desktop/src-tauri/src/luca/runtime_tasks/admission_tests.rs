use super::super::provider_scope::ProviderScopeWitnessV1;
use super::*;
use luca_protocol::{OpaqueId, SafeU53};
use std::sync::{atomic::AtomicBool, Arc, Barrier};

fn hex(byte: &str) -> Hex64 {
    Hex64::parse(byte.repeat(32)).unwrap()
}

fn relay(byte: &str) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", byte.repeat(32))).unwrap()
}

fn access(owner: &str, resident: &str) -> RuntimeTaskAccessScopeV1 {
    RuntimeTaskAccessScopeV1 {
        owner_pubkey: hex(owner),
        resident_pubkey: hex(resident),
        conversation_id: OpaqueId::parse("original-home").unwrap(),
        binding_ref: relay("ab"),
        session_epoch: SafeU53::new(7).unwrap(),
        active: Arc::new(AtomicBool::new(true)),
    }
}

fn pin() -> ProviderScopeWitnessV1 {
    ProviderScopeWitnessV1 {
        mode: "claude_api".into(),
        account_revision: Uuid::from_u128(4).to_string(),
        provider_target: relay("44").as_str().into(),
    }
}

fn review(folder: &Path, id: &str, text: &str) -> Root {
    match begin_at(folder, id.to_owned(), digest(&text).unwrap()).unwrap() {
        Begin::Review(root) => root,
        Begin::Existing(_) => panic!("unexpected duplicate"),
    }
}

fn replay(folder: &Path, id: &str, text: &str) -> serde_json::Value {
    match begin_at(folder, id.to_owned(), digest(&text).unwrap()).unwrap() {
        Begin::Review(_) => panic!("replayed owner event was readmitted"),
        Begin::Existing(ack) => serde_json::from_str(&ack).unwrap(),
    }
}

fn remembered(folder: &Path, id: &str, scope: &str, reuse: bool) -> Permit {
    let root = review(folder, id, "write a poem");
    assert_eq!(root.reusable(scope).unwrap(), reuse);
    let provider = pin();
    root.reserve(Some(scope), !reuse, reuse, Some(&provider))
        .unwrap();
    Permit {
        root,
        grant: Some(scope.to_owned()),
        provider: Some(provider),
    }
}

fn can_return(permit: &Permit) -> bool {
    let root = &permit.root;
    locked(&root.folder, || return_record(&root.folder, &root.task_id)).is_ok()
}

fn assert_denied_without_effect(permit: &Permit) {
    let mut calls = 0;
    assert!(permit
        .with_effect(|| {
            calls += 1;
            Ok(())
        })
        .is_err());
    assert_eq!(calls, 0);
}

#[test]
fn concurrent_same_event_has_one_reviewer_and_never_stores_prompt() {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().join("admission");
    let id = Uuid::new_v4().to_string();
    let text = "PRIVATE_PROMPT_SENTINEL";
    let gate = Barrier::new(8);
    let wins = std::thread::scope(|scope| {
        let tasks: Vec<_> = (0..8)
            .map(|_| {
                scope.spawn(|| {
                    gate.wait();
                    match begin_at(&folder, id.clone(), digest(&text).unwrap()).unwrap() {
                        Begin::Review(root) => {
                            assert_eq!(root.task_id, id);
                            1
                        }
                        Begin::Existing(ack) => {
                            let value: serde_json::Value = serde_json::from_str(&ack).unwrap();
                            assert_eq!(value["task_id"], id.as_str());
                            assert_eq!(value["status"], "review_not_dispatched");
                            0
                        }
                    }
                })
            })
            .collect();
        tasks
            .into_iter()
            .map(|task| task.join().unwrap())
            .sum::<usize>()
    });
    assert_eq!(wins, 1);
    for file in std::fs::read_dir(folder).unwrap() {
        let bytes = std::fs::read(file.unwrap().path()).unwrap();
        assert!(!bytes
            .windows(text.len())
            .any(|part| part == text.as_bytes()));
    }
}

#[test]
fn replay_never_reopens_declined_reserved_or_stopped_root_and_rejects_changed_body() {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path();
    let id = Uuid::new_v4().to_string();
    let root = review(folder, &id, "work one");
    root.decline().unwrap();
    assert_eq!(replay(folder, &id, "work one")["status"], "declined");
    assert!(root.reserve(None, false, false, None).is_err());
    assert!(begin_at(folder, id, digest(&"changed work").unwrap()).is_err());

    let id = Uuid::new_v4().to_string();
    let root = review(folder, &id, "work two");
    root.reserve(None, false, false, None).unwrap();
    assert!(root.reserve(None, false, false, None).is_err());
    assert_eq!(
        replay(folder, &id, "work two")["status"],
        "reserved_or_already_dispatched"
    );
    assert!(stop_at(folder, &id).unwrap());
    assert!(stop_at(folder, &id).unwrap());
    assert_eq!(replay(folder, &id, "work two")["status"], "stopped");
    let stopped = Permit {
        root,
        grant: None,
        provider: None,
    };
    assert_denied_without_effect(&stopped);
    assert!(!can_return(&stopped));
}

#[test]
fn independent_owner_events_with_identical_text_do_not_dedupe() {
    let temp = tempfile::tempdir().unwrap();
    let scope = access("11", "22");
    let origin = relay("33");
    let first = operation_id(&scope, &origin, &hex("44")).unwrap();
    let second = operation_id(&scope, &origin, &hex("55")).unwrap();
    assert_ne!(first, second);
    assert_eq!(first, operation_id(&scope, &origin, &hex("44")).unwrap());
    let one = review(temp.path(), &first, "same text");
    let two = review(temp.path(), &second, "same text");
    one.decline().unwrap();
    two.reserve(None, false, false, None).unwrap();
    assert_eq!(
        replay(temp.path(), &first, "same text")["status"],
        "declined"
    );
    assert_eq!(
        replay(temp.path(), &second, "same text")["status"],
        "reserved_or_already_dispatched"
    );
}

#[test]
fn missing_or_corrupt_grants_never_authorize_remembered_effect_or_return() {
    for missing in [true, false] {
        let temp = tempfile::tempdir().unwrap();
        let permit = remembered(temp.path(), &Uuid::new_v4().to_string(), "exact", false);
        let path = temp.path().join("approvals.json");
        if missing {
            std::fs::remove_file(&path).unwrap();
        } else {
            std::fs::write(&path, b"truncated approval").unwrap();
        }
        assert_denied_without_effect(&permit);
        assert!(!can_return(&permit));
        assert!(!permit.root.reusable("exact").unwrap_or(false));
        if !missing {
            assert!(begin_at(
                temp.path(),
                Uuid::new_v4().to_string(),
                digest(&"new").unwrap()
            )
            .is_err());
            assert_eq!(std::fs::read(&path).unwrap(), b"truncated approval");
        }
    }
}

#[test]
fn forget_serializes_with_effect_and_denies_reuse_even_after_scope_is_regranted() {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path();
    let first = remembered(folder, &Uuid::new_v4().to_string(), "exact", false);
    let second = remembered(folder, &Uuid::new_v4().to_string(), "exact", true);
    let pending = review(
        folder,
        &Uuid::new_v4().to_string(),
        "separate pending request",
    );
    let one_shot = review(folder, &Uuid::new_v4().to_string(), "explicit one-shot");
    one_shot.reserve(None, false, false, None).unwrap();
    let one_shot = Permit {
        root: one_shot,
        grant: None,
        provider: None,
    };
    assert!(can_return(&second));
    assert_eq!(
        second
            .with_effect(|| {
                // Forget/Stop take an exclusive lock on this same file. A second
                // open description cannot acquire it while the callback is running.
                let lock = OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(folder.join("admission.lock"))
                    .unwrap();
                assert!(matches!(
                    File::try_lock(&lock),
                    Err(std::fs::TryLockError::WouldBlock)
                ));
                Ok(23)
            })
            .unwrap(),
        23
    );
    assert_eq!(manage_at(folder, true).unwrap(), 0);
    assert!(pending
        .reserve(Some("exact"), false, true, Some(&pin()))
        .is_err());
    for old in [&first, &second] {
        assert_denied_without_effect(old);
        assert!(!can_return(old));
    }
    let fresh = remembered(folder, &Uuid::new_v4().to_string(), "exact", false);
    assert!(fresh.with_effect(|| Ok(())).is_ok() && can_return(&fresh));
    assert_denied_without_effect(&second);
    assert!(!can_return(&second));
    assert!(one_shot.with_effect(|| Ok(())).is_ok() && can_return(&one_shot));
}

#[test]
fn owner_relay_folders_and_resident_keys_do_not_share_authority() {
    let temp = tempfile::tempdir().unwrap();
    let owner = hex("11");
    let origin = relay("33");
    let home = scope_folder(temp.path(), &owner, &origin).unwrap();
    let other_owner = scope_folder(temp.path(), &hex("66"), &origin).unwrap();
    let other_relay = scope_folder(temp.path(), &owner, &relay("77")).unwrap();
    let scope = access("11", "22");
    let sibling = access("11", "55");
    let event = hex("44");
    let id = operation_id(&scope, &origin, &event).unwrap();
    let sibling_id = operation_id(&sibling, &origin, &event).unwrap();
    assert_ne!(id, sibling_id);
    let key = |s: &RuntimeTaskAccessScopeV1| {
        scope_key(s, &origin, "private-workspace", &Default::default(), &pin()).unwrap()
    };
    let original_key = key(&scope);
    assert_ne!(original_key, key(&sibling));
    let original = remembered(&home, &id, &original_key, false);
    let sibling_root = review(&home, &sibling_id, "same text");
    assert!(!sibling_root.reusable(&key(&sibling)).unwrap());
    for other in [&other_owner, &other_relay] {
        assert!(!stop_at(other, &id).unwrap());
        assert!(locked(other, || return_record(other, &id)).is_err());
        let separate = review(other, &id, "write a poem");
        assert!(!separate.reusable(&original_key).unwrap());
        manage_at(other, true).unwrap();
    }
    assert!(original.with_effect(|| Ok(())).is_ok() && can_return(&original));
}
