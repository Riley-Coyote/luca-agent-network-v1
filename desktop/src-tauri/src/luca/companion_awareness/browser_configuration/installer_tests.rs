//! Pure installer generation/confirmation checks only; no registration is run.
use super::*;
#[test]
fn generated_manifest_and_wrapper_have_fixed_origin_and_no_app_launch_fallback() {
    let wrapper=Path::new("/synthetic/private/browser-native-host-v1.sh");
    let manifest:serde_json::Value=serde_json::from_slice(&manifest_bytes(wrapper).unwrap()).unwrap();
    assert_eq!(manifest["name"],BROWSER_NATIVE_HOST);assert_eq!(manifest["allowed_origins"],serde_json::json!([BROWSER_ORIGIN]));assert_eq!(manifest["type"],"stdio");
    let bytes=wrapper_bytes(Path::new("/synthetic/candidate's path/Buzz"),Path::new("/synthetic/private/browser-native-host-v1.json")).unwrap();
    let script=String::from_utf8(bytes).unwrap();assert!(script.contains(NATIVE_ENTRY_FLAG));assert!(script.contains("'\"'\"'"));assert!(script.contains("\"$@\""));assert!(!script.contains("open -"));assert!(!script.contains("sudo"));
}
