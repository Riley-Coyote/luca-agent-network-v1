//! Disposable configuration only, never a real browser/user account/profile.
use super::*;
pub(crate) fn root()->tempfile::TempDir {
    use std::os::unix::fs::PermissionsExt;
    tempfile::Builder::new().permissions(fs::Permissions::from_mode(0o700)).tempdir_in("/private/tmp").unwrap()
}
pub(crate) fn owner()->Hex64 {Hex64::parse("11".repeat(32)).unwrap()}
pub(crate) fn device()->OpaqueId {OpaqueId::parse("internal-device").unwrap()}
pub(crate) fn pair()->BrowserPairingV1 {BrowserPairingV1 {profile:OpaqueId::parse("profile-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").unwrap(),
    pairing_id:OpaqueId::parse("host-pair-one").unwrap(),resident:Hex64::parse("22".repeat(32)).unwrap(),token_ref:secret_ref(&"b".repeat(64)).unwrap(),
    policy:BrowserSitePolicyV1::new(vec!["https://example.test".into()],vec![]).unwrap(),enabled:true,last_sequence:SafeU53::new(0).unwrap(),last_event_ref:None}}
#[test]
fn exact_principal_class_policy_pairing_bindings_never_inherit_another_grant() {
    let pair=pair();let visit=pair.key(&owner(),&device(),BrowserEventKindV1::Visit).unwrap();
    assert_ne!(visit,pair.key(&owner(),&device(),BrowserEventKindV1::Excerpt).unwrap());
    assert_ne!(visit,pair.key(&Hex64::parse("33".repeat(32)).unwrap(),&device(),BrowserEventKindV1::Visit).unwrap());
    let mut repaired=pair.clone();repaired.pairing_id=OpaqueId::parse("host-pair-two").unwrap();assert_ne!(visit,repaired.key(&owner(),&device(),BrowserEventKindV1::Visit).unwrap());
    assert!(pair.policy.permits("https://example.test/article"));assert!(!pair.policy.permits("https://other.test/article"));
    assert!(BrowserSitePolicyV1::new(vec!["https://example.test/*".into()],vec![]).is_err());
}
#[test]
fn durable_replay_watermark_and_hash_only_token_survive_restart_without_body() {
    let temp=root();let directory=temp.path().canonicalize().unwrap();let mut catalog=BrowserCatalogV1::open(&directory,&owner(),&device()).unwrap();let pair=pair();
    catalog.put(pair.clone()).unwrap();let hash=secret_ref("PRIVATE_PAGE_BODY_SENTINEL").unwrap();catalog.reserve(&pair,SafeU53::new(1).unwrap(),&hash).unwrap();
    let reopened=BrowserCatalogV1::open(&directory,&owner(),&device()).unwrap();let current=reopened.pair(&pair.profile).unwrap();assert_eq!(current.last_sequence.get(),1);
    assert!(catalog.reserve(&pair,SafeU53::new(1).unwrap(),&hash).is_err());
    let bytes=fs::read(directory.join(CATALOG_FILENAME)).unwrap();let text=String::from_utf8(bytes).unwrap();
    assert!(!text.contains("PRIVATE_PAGE_BODY_SENTINEL"));assert!(!text.contains(&"b".repeat(64)));
    assert!(BrowserCatalogV1::open(&directory,&Hex64::parse("44".repeat(32)).unwrap(),&device()).is_err());
}
#[test]
fn foreign_bootstrap_and_configuration_are_not_adopted_or_repaired() {
    let temp=root();let directory=temp.path().canonicalize().unwrap();let path=directory.join(CATALOG_FILENAME);
    fs::write(&path,b"FOREIGN_NATIVE_CONFIG_SENTINEL").unwrap();use std::os::unix::fs::PermissionsExt;fs::set_permissions(&path,fs::Permissions::from_mode(0o600)).unwrap();
    assert!(BrowserCatalogV1::open(&directory,&owner(),&device()).is_err());assert_eq!(fs::read(path).unwrap(),b"FOREIGN_NATIVE_CONFIG_SENTINEL");
    assert!(BrowserNativeBootstrapV1::read(&directory.join("other.json")).is_err());
}
