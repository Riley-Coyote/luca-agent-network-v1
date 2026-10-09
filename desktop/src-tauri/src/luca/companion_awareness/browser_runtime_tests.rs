//! Pure protected token/material + disposable UDS tests, no apps/browsers/models.
use super::*;
use super::super::browser_configuration::tests::{root,owner,device,pair};
use super::super::browser_bridge::{BrowserBridgeFrameV1,BrowserReplyFrameV1,BROWSER_BRIDGE_PROTOCOL,BROWSER_PROTOCOL};
use luca_protocol::AwarenessMaterialStateV1;
#[test]
fn default_runtime_has_no_socket_or_automatic_resume_and_token_is_profile_exact() {
    let runtime=CompanionBrowserRuntimeV1::default();assert!(runtime.inner.lock().unwrap().is_none());assert!(runtime.bridge.lock().unwrap().is_none());
    let temp=root();let directory=temp.path().canonicalize().unwrap();let mut catalog=BrowserCatalogV1::open(&directory,&owner(),&device()).unwrap();let pairing=pair();catalog.put(pairing.clone()).unwrap();
    assert!(ingress::authenticate_configuration(&catalog,&pairing.profile,&"b".repeat(64)).is_ok());
    assert!(ingress::authenticate_configuration(&catalog,&pairing.profile,&"c".repeat(64)).is_err());
    assert!(ingress::authenticate_configuration(&catalog,&id("profile-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb").unwrap(),&"b".repeat(64)).is_err());
    catalog.disable(&pairing.profile,&pairing.resident).unwrap();assert!(ingress::authenticate_configuration(&catalog,&pairing.profile,&"b".repeat(64)).is_err());
}
#[test]
fn native_entry_is_recognized_before_app_start_even_for_invalid_arguments() {
    let args=|items:&[&str]|items.iter().map(std::ffi::OsString::from).collect::<Vec<_>>();
    assert!(parse_native_entry(&args(&["ordinary-app-argument"])).is_none());
    assert!(matches!(parse_native_entry(&args(&[config::NATIVE_ENTRY_FLAG])),Some(Err(_))));
    assert!(matches!(parse_native_entry(&args(&[config::NATIVE_ENTRY_FLAG,"/synthetic/private/browser-native-host-v1.json","https://webpage.test/"])),Some(Err(_))));
    assert!(matches!(parse_native_entry(&args(&[config::NATIVE_ENTRY_FLAG,"/synthetic/private/browser-native-host-v1.json",BROWSER_ORIGIN])),Some(Ok(_))));
}
#[test]
fn private_uds_callback_authenticates_exact_profile_token_not_wire_owner_selectors() {
    use std::os::unix::net::UnixStream;
    let temp=root();let directory=temp.path().canonicalize().unwrap();let mut catalog=BrowserCatalogV1::open(&directory,&owner(),&device()).unwrap();let pairing=pair();catalog.put(pairing.clone()).unwrap();
    let protected=Arc::new(Mutex::new(catalog));let callback_catalog=Arc::clone(&protected);
    let callback:BrowserHostCallback=Arc::new(move |client|match client.request {
        BrowserRequestV1::Status {profile_instance_id,token}=>match ingress::authenticate_configuration(&callback_catalog.lock().unwrap(),&profile_instance_id,&token) {
            Ok(_)=>BrowserResponseV1::Status {profile_instance_id,collection_enabled:false,allowed_kinds:Vec::new()},Err(code)=>rejected(code)},_=>rejected(BrowserRejectionV1::Invalid)});
    let capability="a".repeat(64);let bridge=browser_bridge::start_browser_bridge(BrowserBridgeConfig {directory,allowed_origin:BROWSER_ORIGIN.into(),bridge_capability:capability.clone()},callback).unwrap();
    let frame=BrowserBridgeFrameV1 {protocol:BROWSER_BRIDGE_PROTOCOL.into(),bridge_capability:capability,caller_origin:BROWSER_ORIGIN.into(),client:BrowserClientFrameV1 {protocol:BROWSER_PROTOCOL.into(),request_id:id("request").unwrap(),request:BrowserRequestV1::Status {profile_instance_id:pairing.profile,token:"c".repeat(64)}}};
    let mut stream=UnixStream::connect(bridge.endpoint()).unwrap();browser_bridge::write_frame(&mut stream,&serde_json::to_vec(&frame).unwrap()).unwrap();
    let reply:BrowserReplyFrameV1=serde_json::from_slice(&browser_bridge::read_frame(&mut stream).unwrap().unwrap()).unwrap();assert!(matches!(reply.response,BrowserResponseV1::Rejected {code:BrowserRejectionV1::Unpaired}));
}
#[test]
fn cold_or_stopped_raw_browser_context_is_unavailable_while_retained_root_stays_bound() {
    let pairing=pair();let key=pairing.key(&owner(),&device(),BrowserEventKindV1::Visit).unwrap();let now=CanonicalTimestamp::parse("2026-10-08T10:00:02Z").unwrap();
    let reference=AwarenessObservationRefV1 {protocol:luca_protocol::AWARENESS_PROTOCOL.into(),observation_id:id("observation").unwrap(),owner_pubkey:owner(),resident_pubkey:pairing.resident,source_id:key.source.source_id.clone(),device_id:device(),grant_id:id("grant").unwrap(),grant_revision:SafeU53::new(1).unwrap(),deny_epoch:SafeU53::new(0).unwrap(),sequence:SafeU53::new(1).unwrap(),evidence_ref:config::secret_ref("SYNTHETIC_BROWSER_BODY").unwrap(),captured_at:now.clone(),expires_at:CanonicalTimestamp::parse("2026-10-08T10:05:02Z").unwrap()};
    let mut snapshot=BrowserMaterialSnapshotV1 {active:false,keys:vec![(key.clone(),BrowserEventKindV1::Visit)],collecting:Vec::new(),records:vec![reference.clone()],now};
    assert!(snapshot.collecting_keys().is_empty());
    assert!(snapshot.references().is_empty());assert_eq!(snapshot.resolve(&reference,false).material_state,AwarenessMaterialStateV1::Unavailable);
    assert_eq!(snapshot.resolve(&reference,true).material_state,AwarenessMaterialStateV1::Available);
    snapshot.active=true;snapshot.collecting.push(key.clone());assert!(snapshot.resolve(&reference,false).source_fresh);
    assert_eq!(snapshot.collecting_keys(), vec![key.clone()]);
    let mut unrelated = key;
    unrelated.resident_pubkey = Hex64::parse("cc".repeat(32)).unwrap();
    snapshot.collecting.push(unrelated);
    assert_eq!(snapshot.collecting_keys().len(), 1);
    let mut wrong=reference;wrong.evidence_ref=config::secret_ref("other").unwrap();assert_eq!(snapshot.resolve(&wrong,false).material_state,AwarenessMaterialStateV1::Unavailable);
}
