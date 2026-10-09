//! Pure notifications and disposable app-owned purpose metadata only.
use super::*;
use crate::luca::companion_awareness::native_profile::NativeProfileObservationClassV1;
const UUID:&str="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
fn selection(root:&Path,resident:char)->NativeProfileSelectionV1 {
    let owner=Hex64::parse("11".repeat(32)).unwrap();let resident=Hex64::parse(resident.to_string().repeat(64)).unwrap();let device=OpaqueId::parse("internal-device").unwrap();
    let source=NativeProfileSelectionV1::source_id_for_selection(&owner,&resident,&device,root,NativeProfileKindV1::CodexSessions,NativeProfileObservationClassV1::Metadata).unwrap();
    NativeProfileSelectionV1::new(AwarenessGrantKeyV1 {source:AwarenessSourceKeyV1 {owner_pubkey:owner,source_id:source,device_id:device},resident_pubkey:resident},
        root.to_owned(),NativeProfileKindV1::CodexSessions,NativeProfileObservationClassV1::Metadata).unwrap()
}
#[test]
fn notifications_are_known_child_only_and_exclusion_tokens_are_profile_scoped() {
    let profile=selection(Path::new("/synthetic/chosen/sessions"),'2');
    let child=format!("2026/10/08/rollout-2026-10-08T10-00-00-{UUID}.jsonl");
    let event=Event::new(EventKind::Any).add_path(profile.transcript_root().join(&child))
        .add_path(profile.transcript_root().join("credentials.json"))
        .add_path(Path::new("/synthetic/other/sessions").join(&child));
    assert_eq!(relevant_children(&event,&profile),vec![child]);
    let other=selection(Path::new("/synthetic/other/sessions"),'2');
    assert_ne!(profile.exclusion_token(UUID).unwrap(),other.exclusion_token(UUID).unwrap());
    assert_ne!(profile.exclusion_token(UUID).unwrap(),selection(profile.transcript_root(),'3').exclusion_token(UUID).unwrap());
    assert!(relevant_children(&Event::new(EventKind::Access(notify::event::AccessKind::Any)).add_path(event.paths[0].clone()),&profile).is_empty());
    assert!(scope_gap(&Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan),&profile));
    assert!(scope_gap(&Event::new(EventKind::Remove(notify::event::RemoveKind::Folder)).add_path(profile.transcript_root().to_owned()),&profile));
}
#[test]
fn complete_purpose_reader_rejects_partial_unknown_and_late_records() {
    let temp=tempfile::tempdir_in("/tmp").unwrap();let root=temp.path().canonicalize().unwrap();
    let directory=root.join("luca/runtime-session-purposes");fs::create_dir_all(&directory).unwrap();
    let path=directory.join(format!("{}.jsonl","11".repeat(32)));
    let good=format!("{{\"protocol\":\"polyphonic.runtime-session-purpose.v1\",\"providerSessionId\":\"{UUID}\",\"runtimeFamily\":\"codex\",\"purpose\":\"continuity_internal\"}}\n");
    fs::write(&path,&good).unwrap();
    #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;fs::set_permissions(&directory,fs::Permissions::from_mode(0o700)).unwrap();fs::set_permissions(&path,fs::Permissions::from_mode(0o600)).unwrap();}
    let deadline=||Instant::now()+Duration::from_secs(1);
    assert!(read_complete_exclusions(&root.join("missing-app"),"codex",deadline()).is_err());
    assert_eq!(read_complete_exclusions(&root,"codex",deadline()).unwrap(),HashSet::from([UUID.to_owned()]));
    fs::write(&path,format!("{good}{{unfinished")).unwrap();assert!(read_complete_exclusions(&root,"codex",deadline()).is_err());
    fs::write(&path,good.replace("continuity_internal","unknown_purpose")).unwrap();assert!(read_complete_exclusions(&root,"codex",deadline()).is_err());
    fs::write(&path,good).unwrap();assert!(read_complete_exclusions(&root,"codex",Instant::now()).is_err());
}
