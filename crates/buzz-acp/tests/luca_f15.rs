//! Cross-layer contract checks for the F15 resident registry and setup path.

use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Debug, Deserialize)]
struct ResidentFixture {
    identity: FixtureIdentity,
    persona: FixturePersona,
    runtime: FixtureRuntime,
    provider_stub: FixtureProvider,
}

#[derive(Debug, Deserialize)]
struct FixtureIdentity {
    display_name: String,
    public_key: String,
}

#[derive(Debug, Deserialize)]
struct FixturePersona {
    conductor: bool,
}

#[derive(Debug, Deserialize)]
struct FixtureRuntime {
    kind: String,
}

#[derive(Debug, Deserialize)]
struct FixtureProvider {
    kind: String,
    credential_source: String,
}

#[test]
fn luca_f15_three_resident_setup_contract_is_public_and_peer_based() {
    let fixtures = [
        include_str!("../../../fixtures/luca/residents/luca.json"),
        include_str!("../../../fixtures/luca/residents/mara.json"),
        include_str!("../../../fixtures/luca/residents/sol.json"),
    ]
    .map(|raw| serde_json::from_str::<ResidentFixture>(raw).expect("resident fixture must parse"));

    let mut identities = BTreeSet::new();
    for fixture in fixtures {
        assert!(identities.insert(fixture.identity.public_key));
        assert!(!fixture.identity.display_name.trim().is_empty());
        assert!(!fixture.persona.conductor, "F15 has no conductor role");
        assert_eq!(fixture.runtime.kind, "fixture-noop");
        assert_eq!(fixture.provider_stub.kind, "fixture-provider");
        assert_eq!(fixture.provider_stub.credential_source, "none");
    }
    assert_eq!(identities.len(), 3);
}

#[test]
fn luca_f15_renderer_adapter_has_no_private_key_response_field() {
    let native = include_str!("../../../desktop/src-tauri/src/luca/resident_registry.rs");
    let client = include_str!("../../../desktop/src/features/luca/residents/api.ts");
    let setup = include_str!("../../../desktop/src/features/luca/residents/ResidentSetup.tsx");

    assert!(native.contains("create_luca_resident"));
    assert!(native.contains("created.private_key_nsec.zeroize();"));
    assert!(native.contains("CreateLucaResidentResponse"));
    assert!(!client.contains("privateKeyNsec"));
    assert!(!client.contains("create_managed_agent"));
    assert!(client.contains("create_luca_resident"));
    assert!(!setup.to_ascii_lowercase().contains("conductor"));
}

#[test]
fn luca_f15_registry_source_omits_protected_managed_record_fields() {
    let source = include_str!("../../../desktop/src-tauri/src/luca/resident_registry.rs");
    let response_start = source
        .find("pub(crate) struct CreateLucaResidentResponse")
        .expect("key-safe response must exist");
    let response_end = source[response_start..]
        .find("/// Only public setup facts")
        .map(|offset| response_start + offset)
        .expect("response boundary must exist");
    let response = &source[response_start..response_end];
    for forbidden in [
        "private_key",
        "nsec",
        "system_prompt",
        "env_vars",
        "auth_tag",
    ] {
        assert!(!response.contains(forbidden), "response leaked {forbidden}");
    }

    let values: Vec<Value> = [
        include_str!("../../../fixtures/luca/residents/luca.json"),
        include_str!("../../../fixtures/luca/residents/mara.json"),
        include_str!("../../../fixtures/luca/residents/sol.json"),
    ]
    .iter()
    .map(|raw| serde_json::from_str(raw).expect("fixture must parse"))
    .collect();
    let serialized = serde_json::to_string(&values).expect("fixtures must serialize");
    for forbidden in ["private_key", "nsec", "secret", "credential_value"] {
        assert!(!serialized.to_ascii_lowercase().contains(forbidden));
    }
}
