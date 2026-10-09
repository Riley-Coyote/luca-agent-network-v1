//! Disposable synthetic fixtures only. No app, keychain, model, or collector.
use super::{buffer::*, store::*};
use luca_protocol::{
    AwarenessAuthoritySnapshotV1, AwarenessChoicesV1, AwarenessError, AwarenessGrantStateV1,
    AwarenessGrantV1, AwarenessMaterialStateV1, AwarenessObservationRefV1, AwarenessSourceStateV1,
    AwarenessUseV1, CanonicalTimestamp, Hex64, OpaqueId, SafeU53, Sha256Ref, AWARENESS_PROTOCOL,
};
use sha2::{Digest, Sha256};

const SENTINEL: &[u8] = b"PRIVATE_AWARENESS_SENTINEL_NOT_FOR_THE_DATABASE";
fn private_fixture_directory() -> tempfile::TempDir {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tempfile::Builder::new()
            .permissions(std::fs::Permissions::from_mode(0o700))
            .tempdir_in("/tmp")
            .unwrap()
    }
    #[cfg(not(unix))]
    tempfile::tempdir().unwrap()
}
fn id(value: &str) -> OpaqueId {
    OpaqueId::parse(value).unwrap()
}
fn hex(value: char) -> Hex64 {
    Hex64::parse(value.to_string().repeat(64)).unwrap()
}
fn number(value: u64) -> SafeU53 {
    SafeU53::new(value).unwrap()
}
fn at(value: &str) -> CanonicalTimestamp {
    CanonicalTimestamp::parse(format!("2026-10-08T{value}Z")).unwrap()
}
fn digest(bytes: &[u8]) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", hex::encode(Sha256::digest(bytes)))).unwrap()
}
fn material(_: &AwarenessObservationRefV1, _: bool) -> AwarenessMaterialFactsV1 {
    AwarenessMaterialFactsV1 {
        source_fresh: true,
        material_state: AwarenessMaterialStateV1::Available,
    }
}
fn facts<'a>(grant: &'a AwarenessGrantV1, now: &'a CanonicalTimestamp) -> AwarenessHostFactsV1<'a> {
    AwarenessHostFactsV1 {
        owner_pubkey: &grant.owner_pubkey,
        resident_pubkey: &grant.resident_pubkey,
        now,
        source_fresh: true,
        material_state: AwarenessMaterialStateV1::Available,
    }
}
fn key(grant: &AwarenessGrantV1) -> AwarenessGrantKeyV1 {
    AwarenessGrantKeyV1 {
        source: AwarenessSourceKeyV1 {
            owner_pubkey: grant.owner_pubkey.clone(),
            source_id: grant.source_id.clone(),
            device_id: grant.device_id.clone(),
        },
        resident_pubkey: grant.resident_pubkey.clone(),
    }
}
struct Fixture {
    _directory: tempfile::TempDir,
    path: std::path::PathBuf,
    store: AwarenessStore,
    grant: AwarenessGrantV1,
    observation: AwarenessObservationRefV1,
}
fn fixture() -> Fixture {
    let directory = private_fixture_directory();
    let path = directory
        .path()
        .canonicalize()
        .unwrap()
        .join(AWARENESS_STORE_FILENAME);
    let mut store = AwarenessStore::open(&path).unwrap();
    let grant = AwarenessGrantV1 {
        protocol: AWARENESS_PROTOCOL.into(),
        grant_id: id("grant-1"),
        owner_pubkey: hex('1'),
        resident_pubkey: hex('2'),
        source_id: id("source-1"),
        device_id: id("internal-device"),
        grant_revision: number(1),
        deny_epoch: number(0),
        state: AwarenessGrantStateV1::Active,
        choices: AwarenessChoicesV1 {
            observe: true,
            retain: false,
            promote: true,
            provider_egress_binding: Some(digest(b"provider-binding")),
        },
    };
    let source = key(&grant).source;
    store.register_source(&source, &id("register-1")).unwrap();
    store
        .set_source_health(
            &source,
            number(1),
            AwarenessSourceStateV1::Current,
            &id("health-1"),
        )
        .unwrap();
    store.put_grant(&grant, None, &id("grant-1-op")).unwrap();
    store
        .set_resident_paused(
            &grant.owner_pubkey,
            &grant.resident_pubkey,
            None,
            false,
            &at("11:59:59"),
            &id("resume-1"),
        )
        .unwrap();
    let observation = AwarenessObservationRefV1 {
        protocol: AWARENESS_PROTOCOL.into(),
        observation_id: id("observation-1"),
        owner_pubkey: grant.owner_pubkey.clone(),
        resident_pubkey: grant.resident_pubkey.clone(),
        source_id: grant.source_id.clone(),
        device_id: grant.device_id.clone(),
        grant_id: grant.grant_id.clone(),
        grant_revision: grant.grant_revision,
        deny_epoch: grant.deny_epoch,
        sequence: number(1),
        evidence_ref: digest(SENTINEL),
        captured_at: at("12:00:00"),
        expires_at: at("12:15:00"),
    };
    store
        .admit_observation(&observation, &facts(&grant, &at("12:01:00")))
        .unwrap();
    Fixture {
        _directory: directory,
        path,
        store,
        grant,
        observation,
    }
}
fn add_companion(f: &mut Fixture) -> (AwarenessGrantV1, AwarenessObservationRefV1) {
    let mut grant = f.grant.clone();
    grant.resident_pubkey = hex('3');
    grant.grant_id = id("grant-2");
    f.store.put_grant(&grant, None, &id("grant-2-op")).unwrap();
    f.store
        .set_resident_paused(
            &grant.owner_pubkey,
            &grant.resident_pubkey,
            None,
            false,
            &at("11:59:59"),
            &id("resume-2"),
        )
        .unwrap();
    let mut observation = f.observation.clone();
    observation.resident_pubkey = grant.resident_pubkey.clone();
    observation.grant_id = grant.grant_id.clone();
    observation.observation_id = id("observation-2");
    f.store
        .admit_observation(&observation, &facts(&grant, &at("12:01:00")))
        .unwrap();
    (grant, observation)
}

#[test]
fn keyless_revoke_is_durable_cas_replay_and_does_not_touch_another_companion() {
    let mut f = fixture();
    let (other, other_observation) = add_companion(&mut f);
    let now = at("12:01:00");
    let scope = facts(&f.grant, &now);
    let context = id("queued-context");
    let job = id("queued-job");
    let note = id("canonical-note-ref");
    f.store
        .register_dependent(
            &context,
            AwarenessDependentKindV1::Context,
            &[f.observation.observation_id.clone()],
            &scope,
            material,
        )
        .unwrap();
    f.store
        .register_dependent(
            &job,
            AwarenessDependentKindV1::Job,
            &[context.clone()],
            &scope,
            material,
        )
        .unwrap();
    f.store
        .register_dependent(
            &note,
            AwarenessDependentKindV1::Promoted,
            &[f.observation.observation_id.clone()],
            &scope,
            material,
        )
        .unwrap();
    let receipt = f
        .store
        .withdraw_grant(
            &key(&f.grant),
            number(1),
            AwarenessWithdrawalV1::Withdraw,
            &id("revoke-1"),
        )
        .unwrap();
    assert_eq!(receipt.grant_revision, Some(number(2)));
    assert_eq!(receipt.deny_epoch, Some(number(0)));
    assert_eq!(receipt.quarantined_nodes, 4);
    assert_eq!(
        f.store
            .recheck_dependency(&job, &scope, AwarenessUseV1::default(), material),
        Err(AwarenessStoreError::Quarantined)
    );
    assert_eq!(
        f.store
            .recheck_dependency(&note, &scope, AwarenessUseV1::default(), material),
        Err(AwarenessStoreError::Quarantined)
    );
    assert!(f
        .store
        .recheck_raw_observation(
            &other_observation,
            &facts(&other, &now),
            AwarenessUseV1::default()
        )
        .is_ok());
    assert!(
        f.store
            .withdraw_grant(
                &key(&f.grant),
                number(1),
                AwarenessWithdrawalV1::Withdraw,
                &id("revoke-1")
            )
            .unwrap()
            .replayed
    );
    assert_eq!(
        f.store.withdraw_grant(
            &key(&f.grant),
            number(1),
            AwarenessWithdrawalV1::Forget,
            &id("revoke-1")
        ),
        Err(AwarenessStoreError::ReplayConflict)
    );
    assert_eq!(
        f.store.withdraw_grant(
            &key(&f.grant),
            number(1),
            AwarenessWithdrawalV1::Withdraw,
            &id("stale-revoke")
        ),
        Err(AwarenessStoreError::Conflict)
    );
    f.store = AwarenessStore::open(&f.path).unwrap();
    assert_eq!(
        f.store.snapshot(&key(&f.grant)).unwrap().grant.state,
        AwarenessGrantStateV1::Revoked
    );
    assert_eq!(
        f.store
            .recheck_dependency(&job, &scope, AwarenessUseV1::default(), material),
        Err(AwarenessStoreError::Quarantined)
    );
    assert!(!std::fs::read(&f.path)
        .unwrap()
        .windows(SENTINEL.len())
        .any(|bytes| bytes == SENTINEL));
}

#[test]
fn source_forget_advances_epoch_for_all_source_grants_without_a_model_or_keychain() {
    let mut f = fixture();
    let (other, _) = add_companion(&mut f);
    let source = key(&f.grant).source;
    let receipt = f
        .store
        .withdraw_source(
            &source,
            number(2),
            AwarenessWithdrawalV1::Forget,
            &id("source-forget"),
        )
        .unwrap();
    assert_eq!(receipt.deny_epoch, Some(number(1)));
    for grant in [&f.grant, &other] {
        let state = f.store.snapshot(&key(grant)).unwrap();
        assert_eq!(state.source.state, AwarenessSourceStateV1::Disabled);
        assert_eq!(state.grant.state, AwarenessGrantStateV1::Revoked);
        assert_eq!(state.grant.deny_epoch, number(1));
    }
    assert!(
        f.store
            .withdraw_source(
                &source,
                number(2),
                AwarenessWithdrawalV1::Forget,
                &id("source-forget")
            )
            .unwrap()
            .replayed
    );
    assert_eq!(
        f.store.set_source_health(
            &source,
            number(2),
            AwarenessSourceStateV1::Current,
            &id("stale-health")
        ),
        Err(AwarenessStoreError::Conflict)
    );
}

#[test]
fn a_closed_browser_blocks_raw_material_not_canonical_promotion_until_withdrawal() {
    let mut f = fixture();
    let now = at("12:01:00");
    let note = id("remembered-canonical-note");
    f.store
        .register_dependent(
            &note,
            AwarenessDependentKindV1::Promoted,
            &[f.observation.observation_id.clone()],
            &facts(&f.grant, &now),
            material,
        )
        .unwrap();
    let source = key(&f.grant).source;
    f.store
        .set_source_health(
            &source,
            number(2),
            AwarenessSourceStateV1::Unavailable,
            &id("browser-closed"),
        )
        .unwrap();
    assert_eq!(
        f.store.recheck_raw_observation(
            &f.observation,
            &facts(&f.grant, &now),
            AwarenessUseV1::default()
        ),
        Err(AwarenessStoreError::Denied(
            AwarenessError::SourceNotCurrent
        ))
    );
    assert!(f
        .store
        .recheck_dependency(
            &note,
            &facts(&f.grant, &now),
            AwarenessUseV1::default(),
            |_, retained| AwarenessMaterialFactsV1 {
                source_fresh: false,
                material_state: if retained {
                    AwarenessMaterialStateV1::Available
                } else {
                    AwarenessMaterialStateV1::Unavailable
                }
            }
        )
        .is_ok());
    f.store
        .withdraw_grant(
            &key(&f.grant),
            number(1),
            AwarenessWithdrawalV1::Withdraw,
            &id("withdraw-closed-browser"),
        )
        .unwrap();
    assert_eq!(
        f.store.recheck_dependency(
            &note,
            &facts(&f.grant, &now),
            AwarenessUseV1::default(),
            material
        ),
        Err(AwarenessStoreError::Quarantined)
    );
    let inventory = f
        .store
        .list_grants(&f.grant.owner_pubkey, &f.grant.resident_pubkey, 1)
        .unwrap();
    assert_eq!(inventory.entries.len(), 1);
    assert_eq!(
        inventory.entries[0].grant.state,
        AwarenessGrantStateV1::Revoked
    );
    assert!(!inventory.truncated);
    assert!(f
        .store
        .list_grants(&f.grant.owner_pubkey, &hex('9'), 1)
        .unwrap()
        .entries
        .is_empty());
}

#[test]
fn widening_or_resuming_cannot_reauthorize_old_material_and_pause_survives_restart() {
    let mut f = fixture();
    let now = at("12:01:00");
    let context = id("old-context");
    let note = id("preserved-canonical-note");
    f.store
        .register_dependent(
            &context,
            AwarenessDependentKindV1::Context,
            &[f.observation.observation_id.clone()],
            &facts(&f.grant, &now),
            material,
        )
        .unwrap();
    f.store
        .register_dependent(
            &note,
            AwarenessDependentKindV1::Promoted,
            &[context.clone()],
            &facts(&f.grant, &now),
            material,
        )
        .unwrap();
    let pause = f
        .store
        .set_resident_paused(
            &f.grant.owner_pubkey,
            &f.grant.resident_pubkey,
            Some(number(1)),
            true,
            &now,
            &id("pause"),
        )
        .unwrap();
    assert_eq!(pause.resident_revision, Some(number(2)));
    f.store = AwarenessStore::open(&f.path).unwrap();
    assert!(
        f.store
            .resident_state(&f.grant.owner_pubkey, &f.grant.resident_pubkey)
            .unwrap()
            .paused
    );
    assert_eq!(
        f.store
            .admit_observation(&f.observation, &facts(&f.grant, &now)),
        Err(AwarenessStoreError::Paused)
    );
    f.store
        .set_resident_paused(
            &f.grant.owner_pubkey,
            &f.grant.resident_pubkey,
            Some(number(2)),
            false,
            &now,
            &id("resume-again"),
        )
        .unwrap();
    assert_eq!(
        f.store.recheck_dependency(
            &context,
            &facts(&f.grant, &now),
            AwarenessUseV1::default(),
            material
        ),
        Err(AwarenessStoreError::Suspended)
    );
    assert!(f
        .store
        .recheck_dependency(
            &note,
            &facts(&f.grant, &now),
            AwarenessUseV1::default(),
            material
        )
        .is_ok());
    let mut pre_pause = f.observation.clone();
    pre_pause.observation_id = id("same-second-before-pause");
    pre_pause.sequence = number(2);
    pre_pause.captured_at = now.clone();
    assert_eq!(
        f.store
            .admit_observation(&pre_pause, &facts(&f.grant, &now)),
        Err(AwarenessStoreError::Denied(AwarenessError::Stale))
    );
    let mut changed = f.grant.clone();
    changed.grant_revision = number(2);
    changed.choices.retain = true;
    f.store
        .put_grant(&changed, Some(number(1)), &id("widen"))
        .unwrap();
    assert_eq!(
        f.store.recheck_raw_observation(
            &f.observation,
            &facts(&changed, &now),
            AwarenessUseV1::default()
        ),
        Err(AwarenessStoreError::Quarantined)
    );
    assert!(f.store.resident_state(&hex('1'), &hex('9')).unwrap().paused);
}

#[test]
fn expired_queued_context_rejects_egress_but_a_promoted_canonical_reference_survives() {
    let mut f = fixture();
    let now = at("12:01:00");
    let context = id("ephemeral-context");
    let note = id("promoted-note");
    let from_note = id("context-from-note");
    let mixed = id("mixed-context");
    let scope = facts(&f.grant, &now);
    f.store
        .register_dependent(
            &context,
            AwarenessDependentKindV1::Context,
            &[f.observation.observation_id.clone()],
            &scope,
            material,
        )
        .unwrap();
    f.store
        .register_dependent(
            &note,
            AwarenessDependentKindV1::Promoted,
            &[f.observation.observation_id.clone()],
            &scope,
            material,
        )
        .unwrap();
    f.store
        .register_dependent(
            &from_note,
            AwarenessDependentKindV1::Context,
            &[note.clone()],
            &scope,
            material,
        )
        .unwrap();
    f.store
        .register_dependent(
            &mixed,
            AwarenessDependentKindV1::Context,
            &[context.clone(), note.clone()],
            &scope,
            material,
        )
        .unwrap();
    let expired = at("12:15:00");
    let scope = facts(&f.grant, &expired);
    let egress = AwarenessUseV1 {
        provider_egress_binding: f.grant.choices.provider_egress_binding.as_ref(),
        ..Default::default()
    };
    assert_eq!(
        f.store
            .recheck_raw_observation(&f.observation, &scope, egress),
        Err(AwarenessStoreError::Denied(AwarenessError::Expired))
    );
    assert_eq!(
        f.store
            .recheck_dependency(&context, &scope, egress, material),
        Err(AwarenessStoreError::Denied(AwarenessError::Expired))
    );
    assert_eq!(
        f.store.recheck_dependency(&mixed, &scope, egress, material),
        Err(AwarenessStoreError::Denied(AwarenessError::Expired))
    );
    assert!(f
        .store
        .recheck_dependency(&note, &scope, egress, material)
        .is_ok());
    assert!(f
        .store
        .recheck_dependency(&from_note, &scope, egress, material)
        .is_ok());
}

#[test]
fn dependency_facts_are_checked_per_root_and_wrong_principals_or_metadata_reject() {
    let mut f = fixture();
    let now = at("12:01:00");
    let mut other = f.grant.clone();
    other.source_id = id("source-other");
    other.grant_id = id("grant-other");
    let source = key(&other).source;
    f.store
        .register_source(&source, &id("register-other"))
        .unwrap();
    f.store
        .set_source_health(
            &source,
            number(1),
            AwarenessSourceStateV1::Current,
            &id("health-other"),
        )
        .unwrap();
    f.store
        .put_grant(&other, None, &id("grant-other-op"))
        .unwrap();
    let mut observation = f.observation.clone();
    observation.source_id = other.source_id.clone();
    observation.grant_id = other.grant_id.clone();
    observation.observation_id = id("observation-other");
    f.store
        .admit_observation(&observation, &facts(&other, &now))
        .unwrap();
    let mixed = id("two-source-context");
    f.store
        .register_dependent(
            &mixed,
            AwarenessDependentKindV1::Context,
            &[
                f.observation.observation_id.clone(),
                observation.observation_id.clone(),
            ],
            &facts(&f.grant, &now),
            material,
        )
        .unwrap();
    for excluded in [false, true] {
        let result = f.store.recheck_dependency(
            &mixed,
            &facts(&f.grant, &now),
            AwarenessUseV1::default(),
            |root, _| {
                if root.source_id == other.source_id {
                    AwarenessMaterialFactsV1 {
                        source_fresh: excluded,
                        material_state: if excluded {
                            AwarenessMaterialStateV1::Excluded
                        } else {
                            AwarenessMaterialStateV1::Available
                        },
                    }
                } else {
                    material(root, false)
                }
            },
        );
        assert_eq!(
            result,
            Err(AwarenessStoreError::Denied(if excluded {
                AwarenessError::Excluded
            } else {
                AwarenessError::SourceNotCurrent
            }))
        );
    }
    let mut altered = f.observation.clone();
    altered.evidence_ref = digest(b"forged");
    assert_eq!(
        f.store.recheck_raw_observation(
            &altered,
            &facts(&f.grant, &now),
            AwarenessUseV1::default()
        ),
        Err(AwarenessStoreError::Denied(AwarenessError::Binding))
    );
    let mut wrong = f.grant.clone();
    wrong.resident_pubkey = hex('9');
    assert_eq!(
        f.store.recheck_raw_observation(
            &f.observation,
            &facts(&wrong, &now),
            AwarenessUseV1::default()
        ),
        Err(AwarenessStoreError::Missing)
    );
}

#[test]
fn ephemeral_payload_is_bounded_redacted_excluded_expiring_and_scope_invalidated() {
    let mut f = fixture();
    let (other, other_observation) = add_companion(&mut f);
    let now = at("12:01:00");
    let state = f.store.snapshot(&key(&f.grant)).unwrap();
    let authority = AwarenessAuthoritySnapshotV1 {
        owner_pubkey: &f.grant.owner_pubkey,
        resident_pubkey: &f.grant.resident_pubkey,
        source: &state.source,
        grant: &state.grant,
        source_fresh: true,
        material_state: AwarenessMaterialStateV1::Available,
        now: &now,
    };
    let mut buffer = EphemeralAwarenessBuffer::default();
    assert!(!buffer
        .insert(&authority, f.observation.clone(), SENTINEL.to_vec())
        .unwrap());
    assert!(buffer
        .with_payload(
            &authority,
            &f.observation,
            AwarenessUseV1::default(),
            |bytes| bytes == SENTINEL
        )
        .unwrap());
    assert!(!format!("{buffer:?}").contains("PRIVATE_AWARENESS"));
    let other_state = f.store.snapshot(&key(&other)).unwrap();
    let other_authority = AwarenessAuthoritySnapshotV1 {
        owner_pubkey: &other.owner_pubkey,
        resident_pubkey: &other.resident_pubkey,
        source: &other_state.source,
        grant: &other_state.grant,
        source_fresh: true,
        material_state: AwarenessMaterialStateV1::Available,
        now: &now,
    };
    buffer
        .insert(
            &other_authority,
            other_observation.clone(),
            SENTINEL.to_vec(),
        )
        .unwrap();
    assert_eq!(
        buffer.insert(
            &authority,
            f.observation.clone(),
            vec![0; MAX_AWARENESS_PAYLOAD_BYTES + 1]
        ),
        Err(AwarenessBufferError::Capacity)
    );
    assert_eq!(
        buffer.insert(&authority, f.observation.clone(), b"different".to_vec()),
        Err(AwarenessBufferError::Evidence)
    );
    let excluded = AwarenessAuthoritySnapshotV1 {
        material_state: AwarenessMaterialStateV1::Excluded,
        ..authority
    };
    assert_eq!(
        buffer.with_payload(&excluded, &f.observation, AwarenessUseV1::default(), |_| ()),
        Err(AwarenessBufferError::Denied(AwarenessError::Excluded))
    );
    buffer.invalidate_grant(
        &f.grant.owner_pubkey,
        &f.grant.resident_pubkey,
        &f.grant.grant_id,
    );
    assert!(buffer
        .with_payload(
            &other_authority,
            &other_observation,
            AwarenessUseV1::default(),
            |bytes| bytes == SENTINEL
        )
        .unwrap());
    assert_eq!(
        buffer.with_payload(&excluded, &f.observation, AwarenessUseV1::default(), |_| ()),
        Err(AwarenessBufferError::Denied(AwarenessError::Excluded))
    );
    let available = AwarenessAuthoritySnapshotV1 {
        material_state: AwarenessMaterialStateV1::Available,
        ..excluded
    };
    let mut fresh = f.observation.clone();
    fresh.observation_id = id("fresh-observation");
    fresh.sequence = number(2);
    buffer
        .insert(&available, fresh.clone(), SENTINEL.to_vec())
        .unwrap();
    buffer.prune(&f.observation.expires_at);
    assert_eq!(
        buffer.with_payload(&available, &fresh, AwarenessUseV1::default(), |_| ()),
        Err(AwarenessBufferError::Missing)
    );
    assert_eq!(
        buffer.insert(&available, fresh, SENTINEL.to_vec()),
        Err(AwarenessBufferError::Binding)
    );
}

#[test]
fn wrong_database_identity_or_symlink_is_not_adopted_or_repaired() {
    let directory = private_fixture_directory();
    let root = directory.path().canonicalize().unwrap();
    let path = root.join(AWARENESS_STORE_FILENAME);
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute_batch("PRAGMA application_id=7; PRAGMA user_version=99; CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('keep');").unwrap();
    drop(connection);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let original = std::fs::read(&path).unwrap();
    assert!(matches!(
        AwarenessStore::open(&path),
        Err(AwarenessStoreError::Schema)
    ));
    assert_eq!(std::fs::read(&path).unwrap(), original);
    #[cfg(unix)]
    {
        let other = private_fixture_directory();
        let link = other
            .path()
            .canonicalize()
            .unwrap()
            .join(AWARENESS_STORE_FILENAME);
        std::os::unix::fs::symlink(&path, &link).unwrap();
        assert!(matches!(
            AwarenessStore::open(&link),
            Err(AwarenessStoreError::UnsafePath)
        ));
        assert_eq!(std::fs::read(&path).unwrap(), original);
    }
}
