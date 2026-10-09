//! Disposable metadata only. No native body, home, app or model is read.
use super::*;
use crate::luca::companion_awareness::selected_files::tests::Fixture;

fn registration(f:&Fixture,class:NativeProfileObservationClassV1)->NativeProfileRegistrationV1 {
    let live=LiveAwarenessOwner::authenticate(&f.state).unwrap();
    let root=f.root.join("sessions");fs::create_dir_all(&root).unwrap();
    let device=f.runtime.device(live.owner()).unwrap();
    let source=NativeProfileSelectionV1::source_id_for_selection(live.owner(),&f.resident,&device,&root,NativeProfileKindV1::CodexSessions,class).unwrap();
    NativeProfileRegistrationV1 {selection:NativeProfileSelectionV1::new(AwarenessGrantKeyV1 {
        source:AwarenessSourceKeyV1 {owner_pubkey:live.owner().clone(),source_id:source,device_id:device},resident_pubkey:f.resident.clone()},
        root,NativeProfileKindV1::CodexSessions,class).unwrap(),profile_config:None}
}
#[test]
fn explicit_profile_metadata_restores_off_without_grant_or_scope_widening() {
    let f=Fixture::new();let live=LiveAwarenessOwner::authenticate(&f.state).unwrap();
    let directory=f.runtime.private_directory(live.owner()).unwrap();let device=f.runtime.device(live.owner()).unwrap();
    let r=registration(&f,NativeProfileObservationClassV1::Metadata);
    let mut catalog=NativeProfileCatalogV1::open(&directory,live.owner(),&device).unwrap();
    catalog.select(&live,r.clone()).unwrap();
    assert!(f.runtime.list_grants(live.owner(),&f.resident,64).unwrap().entries.is_empty());
    let reopened=NativeProfileCatalogV1::open(&directory,live.owner(),&device).unwrap();
    assert_eq!(reopened.profiles(&f.resident).unwrap(),vec![r.clone()]);
    let excerpts=registration(&f,NativeProfileObservationClassV1::VisibleExcerpts);
    assert_ne!(r.selection.grant_key(),excerpts.selection.grant_key());
    assert!(!reopened.contains(&excerpts.selection).unwrap());
    let mut changed=r;changed.profile_config=Some(f.root.join("chosen-config.json"));
    fs::write(changed.profile_config.as_ref().unwrap(),b"UNREAD_CONFIG_SENTINEL").unwrap();
    assert_eq!(catalog.select(&live,changed),Err(AwarenessStoreError::Conflict));
}
#[test]
fn foreign_or_aliased_profile_catalogue_is_not_adopted() {
    let f=Fixture::new();let live=LiveAwarenessOwner::authenticate(&f.state).unwrap();
    let directory=f.runtime.private_directory(live.owner()).unwrap();let device=f.runtime.device(live.owner()).unwrap();
    let path=directory.join(PROFILE_CATALOG_FILENAME);fs::write(&path,b"FOREIGN_PROFILE_SENTINEL").unwrap();
    #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;fs::set_permissions(&path,fs::Permissions::from_mode(0o600)).unwrap();}
    assert!(NativeProfileCatalogV1::open(&directory,live.owner(),&device).is_err());
    assert_eq!(fs::read(&path).unwrap(),b"FOREIGN_PROFILE_SENTINEL");
    let alias=f.root.join("alias");
    #[cfg(unix)] {std::os::unix::fs::symlink(&directory,&alias).unwrap();assert!(NativeProfileCatalogV1::open(&alias,live.owner(),&device).is_err());}
}
