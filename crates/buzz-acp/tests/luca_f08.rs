//! Deterministic, public-only resident fixtures for Luca V1 ACP tests.
//!
//! The fixed derivation domain is intentionally test-only. Secret key material is
//! derived transiently in this process and is never serialized, logged, or
//! returned by a fixture helper.

use nostr::{Keys, SecretKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};

const TEST_KEY_DOMAIN: &str = "luca-agent-network-v1/f08/resident-fixture/v1";

#[derive(Debug, Deserialize)]
struct ResidentFixture {
    fixture_schema: String,
    fixture_id: String,
    identity: Identity,
    persona: Persona,
    runtime: Runtime,
    provider_stub: ProviderStub,
}

#[derive(Debug, Deserialize)]
struct Identity {
    resident_id: String,
    display_name: String,
    public_key: String,
    test_key_derivation_hash: String,
}

#[derive(Debug, Deserialize)]
struct Persona {
    role: String,
    summary: String,
    conductor: bool,
    privileges: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct Runtime {
    kind: String,
    version: String,
    deterministic: bool,
}

#[derive(Debug, Deserialize)]
struct ProviderStub {
    kind: String,
    test_only: bool,
    credential_source: String,
    capabilities: Vec<String>,
    can_confer_real_credentials: bool,
}

fn fixture(path: &str) -> ResidentFixture {
    serde_json::from_str(path).expect("F08 resident fixture must be valid JSON")
}

fn derivation_hash(resident_id: &str) -> String {
    hex::encode(Sha256::digest(format!("{TEST_KEY_DOMAIN}:{resident_id}")))
}

fn derived_public_key(resident_id: &str) -> String {
    let material = Sha256::digest(format!("{TEST_KEY_DOMAIN}:{resident_id}"));
    let secret = SecretKey::from_slice(&material).expect("fixed F08 derivation must be valid");
    Keys::new(secret).public_key().to_hex()
}

#[test]
fn luca_f08_resident_fixtures_are_public_only_deterministic_and_isolated() {
    let fixtures = [
        fixture(include_str!("../../../fixtures/luca/residents/luca.json")),
        fixture(include_str!("../../../fixtures/luca/residents/mara.json")),
        fixture(include_str!("../../../fixtures/luca/residents/sol.json")),
    ];

    assert_eq!(fixtures.len(), 3, "F08 defines exactly three residents");

    let expected = [
        ("luca", "Luca", "resident"),
        ("mara", "Mara", "peer"),
        ("sol", "Sol", "peer"),
    ];
    let mut public_keys = std::collections::BTreeSet::new();
    let mut fixture_ids = std::collections::BTreeSet::new();

    for (fixture, (resident_id, display_name, role)) in fixtures.iter().zip(expected) {
        assert_eq!(fixture.fixture_schema, "luca-resident-fixture/v1");
        assert_eq!(fixture.fixture_id, format!("{resident_id}-resident"));
        assert_eq!(fixture.identity.resident_id, resident_id);
        assert_eq!(fixture.identity.display_name, display_name);
        assert_eq!(fixture.persona.role, role);
        assert!(!fixture.persona.summary.is_empty());
        assert!(!fixture.persona.conductor, "F08 has no conductor");
        assert!(
            fixture.persona.privileges.is_empty(),
            "fixture must not grant privileges"
        );
        assert_eq!(fixture.runtime.kind, "fixture-noop");
        assert_eq!(fixture.runtime.version, "v1");
        assert!(fixture.runtime.deterministic);
        assert_eq!(fixture.provider_stub.kind, "fixture-provider");
        assert!(fixture.provider_stub.test_only);
        assert_eq!(fixture.provider_stub.credential_source, "none");
        assert!(fixture.provider_stub.capabilities.is_empty());
        assert!(!fixture.provider_stub.can_confer_real_credentials);

        assert_eq!(
            fixture.identity.test_key_derivation_hash,
            derivation_hash(resident_id)
        );
        assert_eq!(fixture.identity.public_key, derived_public_key(resident_id));
        assert!(
            public_keys.insert(&fixture.identity.public_key),
            "identities must be isolated"
        );
        assert!(
            fixture_ids.insert(&fixture.fixture_id),
            "fixture IDs must be unique"
        );
    }

    assert_eq!(
        fixtures
            .iter()
            .filter(|fixture| fixture.persona.role == "peer")
            .count(),
        2
    );
}

#[test]
fn luca_f08_derivation_is_repeatable_without_serializing_secret_material() {
    for resident_id in ["luca", "mara", "sol"] {
        assert_eq!(
            derived_public_key(resident_id),
            derived_public_key(resident_id)
        );
        assert_eq!(derivation_hash(resident_id), derivation_hash(resident_id));
    }
}
