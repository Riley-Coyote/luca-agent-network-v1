//! Disposable grants only; no model, native history, capture or live keychain.
use super::*;

fn id(s: &str) -> OpaqueId {
    OpaqueId::parse(s).unwrap()
}
fn number(n: u64) -> SafeU53 {
    SafeU53::new(n).unwrap()
}
fn hex(c: char) -> Hex64 {
    Hex64::parse(c.to_string().repeat(64)).unwrap()
}
fn hash(c: char) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", c.to_string().repeat(64))).unwrap()
}
fn now() -> CanonicalTimestamp {
    CanonicalTimestamp::parse("2026-10-08T12:00:00Z").unwrap()
}
struct Fixture {
    _dir: tempfile::TempDir,
    path: std::path::PathBuf,
    store: AwarenessStore,
    key: AwarenessGrantKeyV1,
    grant: AwarenessGrantV1,
}
fn fixture() -> Fixture {
    #[cfg(unix)]
    let dir = {
        use std::os::unix::fs::PermissionsExt;
        tempfile::Builder::new()
            .permissions(std::fs::Permissions::from_mode(0o700))
            .tempdir_in("/private/tmp")
            .unwrap()
    };
    #[cfg(not(unix))]
    let dir = tempfile::tempdir().unwrap();
    let path = dir
        .path()
        .canonicalize()
        .unwrap()
        .join(AWARENESS_STORE_FILENAME);
    let mut store = AwarenessStore::open(&path).unwrap();
    let key = AwarenessGrantKeyV1 {
        source: AwarenessSourceKeyV1 {
            owner_pubkey: hex('a'),
            source_id: id("source-one"),
            device_id: id("internal-one"),
        },
        resident_pubkey: hex('b'),
    };
    store.register_source(&key.source, &id("register")).unwrap();
    let grant = AwarenessGrantV1 {
        protocol: AWARENESS_PROTOCOL.into(),
        grant_id: id("grant-one"),
        owner_pubkey: hex('a'),
        resident_pubkey: hex('b'),
        source_id: key.source.source_id.clone(),
        device_id: key.source.device_id.clone(),
        grant_revision: number(1),
        deny_epoch: number(0),
        state: AwarenessGrantStateV1::Active,
        choices: AwarenessChoicesV1 {
            observe: true,
            retain: false,
            promote: true,
            provider_egress_binding: Some(hash('c')),
        },
    };
    store.put_grant(&grant, None, &id("grant")).unwrap();
    Fixture {
        _dir: dir,
        path,
        store,
        key,
        grant,
    }
}
#[test]
fn observation_memory_and_egress_never_imply_native_history_and_raw_archives_stay_off() {
    let mut f = fixture();
    assert!(f.store.native_history_choice(&f.key).unwrap().is_none());
    assert!(f
        .store
        .recheck_native_history_choice(&f.key, &hash('c'))
        .is_err());
    let (choice, replayed) = f
        .store
        .set_native_history_choice(
            &f.key,
            number(0),
            true,
            Some(&hash('c')),
            &now(),
            &id("allow"),
        )
        .unwrap();
    assert!(choice.allowed && !replayed);
    f.store
        .recheck_native_history_choice(&f.key, &hash('c'))
        .unwrap();
    assert!(!f.store.snapshot(&f.key).unwrap().grant.choices.retain);
    assert!(f
        .store
        .recheck_native_history_choice(&f.key, &hash('d'))
        .is_err());
}
#[test]
fn changed_grant_runtime_or_principal_requires_new_consent() {
    let mut f = fixture();
    f.store
        .set_native_history_choice(
            &f.key,
            number(0),
            true,
            Some(&hash('c')),
            &now(),
            &id("allow"),
        )
        .unwrap();
    let mut other = f.key.clone();
    other.resident_pubkey = hex('d');
    assert!(f
        .store
        .recheck_native_history_choice(&other, &hash('c'))
        .is_err());
    f.grant.grant_revision = number(2);
    f.grant.choices.provider_egress_binding = Some(hash('d'));
    f.store
        .put_grant(&f.grant, Some(number(1)), &id("changed-model"))
        .unwrap();
    assert!(f
        .store
        .recheck_native_history_choice(&f.key, &hash('c'))
        .is_err());
    assert!(f
        .store
        .recheck_native_history_choice(&f.key, &hash('d'))
        .is_err());
    f.store
        .set_native_history_choice(
            &f.key,
            number(1),
            true,
            Some(&hash('d')),
            &now(),
            &id("confirm-model"),
        )
        .unwrap();
    f.store
        .recheck_native_history_choice(&f.key, &hash('d'))
        .unwrap();
}
#[test]
fn replay_and_restart_cannot_restore_an_old_allowed_choice() {
    let mut f = fixture();
    f.store
        .set_native_history_choice(
            &f.key,
            number(0),
            true,
            Some(&hash('c')),
            &now(),
            &id("allow"),
        )
        .unwrap();
    f.store
        .set_native_history_choice(&f.key, number(1), false, None, &now(), &id("off"))
        .unwrap();
    let (current, replayed) = f
        .store
        .set_native_history_choice(
            &f.key,
            number(0),
            true,
            Some(&hash('c')),
            &now(),
            &id("allow"),
        )
        .unwrap();
    assert!(!current.allowed && replayed && current.revision.get() == 2);
    drop(f.store);
    f.store = AwarenessStore::open(&f.path).unwrap();
    assert!(
        !f.store
            .native_history_choice(&f.key)
            .unwrap()
            .unwrap()
            .allowed
    );
    assert!(f
        .store
        .recheck_native_history_choice(&f.key, &hash('c'))
        .is_err());
}
#[test]
fn recognized_v2_database_gets_empty_off_only_native_history_authority() {
    let mut f = fixture();
    f.store
        .connection
        .execute_batch("DROP TABLE awareness_native_history; PRAGMA user_version=2;")
        .unwrap();
    drop(f.store);
    f.store = AwarenessStore::open(&f.path).unwrap();
    assert!(f.store.native_history_choice(&f.key).unwrap().is_none());
    assert_eq!(
        f.store
            .connection
            .pragma_query_value(None, "user_version", |r| r.get::<_, u64>(0))
            .unwrap(),
        3
    );
    assert_eq!(f.store.snapshot(&f.key).unwrap().grant, f.grant);
}
#[test]
fn revoked_grant_blocks_native_history_without_changing_the_saved_preference() {
    let mut f = fixture();
    f.store
        .set_native_history_choice(
            &f.key,
            number(0),
            true,
            Some(&hash('c')),
            &now(),
            &id("allow"),
        )
        .unwrap();
    f.store
        .withdraw_grant(
            &f.key,
            number(1),
            AwarenessWithdrawalV1::Withdraw,
            &id("revoke"),
        )
        .unwrap();
    assert!(f
        .store
        .recheck_native_history_choice(&f.key, &hash('c'))
        .is_err());
    f.store
        .set_native_history_choice(
            &f.key,
            number(1),
            false,
            None,
            &now(),
            &id("off-after-revoke"),
        )
        .unwrap();
    assert!(
        !f.store
            .native_history_choice(&f.key)
            .unwrap()
            .unwrap()
            .allowed
    );
}
