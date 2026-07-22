use luca_protocol::{
    canonicalize, decode_length_prefixed_frame, encode_length_prefixed_frame,
    parse_and_canonicalize_strict, parse_strict_json, BundleId, CanonicalTimestamp, Hex64,
    ManagedMessagePublishRequestV1, ManagedMessagePublishResultV1, OwnerIdentityBundleV1,
    SafeDiagnosticV1, SecretNsec, SigningFrameV1, BROKER_FRAME_MAX_BYTES,
    OWNER_IDENTITY_CANONICALIZATION, OWNER_IDENTITY_FORMAT, OWNER_IDENTITY_VERSION,
};
use nostr::{EventBuilder, JsonUtil, Keys, Kind, SecretKey, Timestamp, ToBech32};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

fn vector_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/luca-conformance/protocol")
        .join(name)
}

fn schema_path(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../schemas/luca")
        .join(relative)
}

fn load_json(name: &str) -> Value {
    let bytes = fs::read(vector_path(name)).expect("read checked-in protocol vector");
    parse_strict_json(&bytes, BROKER_FRAME_MAX_BYTES).expect("strict vector JSON")
}

#[derive(Deserialize)]
struct RfcVectorFile {
    cases: Vec<RfcCase>,
}

#[derive(Deserialize)]
struct RfcCase {
    name: String,
    input_json: String,
    canonical: String,
    sha256: String,
}

#[test]
fn rfc8785_vectors_match_canonical_bytes_and_hashes() {
    let vectors: RfcVectorFile =
        serde_json::from_value(load_json("rfc8785.json")).expect("RFC vector shape");
    for case in vectors.cases {
        let canonical =
            parse_and_canonicalize_strict(case.input_json.as_bytes(), BROKER_FRAME_MAX_BYTES)
                .unwrap_or_else(|error| panic!("{} failed: {error}", case.name));
        assert_eq!(canonical, case.canonical.as_bytes(), "{} bytes", case.name);
        assert_eq!(
            hex::encode(Sha256::digest(&canonical)),
            case.sha256,
            "{} hash",
            case.name
        );
    }
}

#[derive(Deserialize)]
struct InvalidVectorFile {
    cases: Vec<InvalidCase>,
}

#[derive(Deserialize)]
struct InvalidCase {
    name: String,
    input_json: String,
    error_contains: String,
}

#[derive(Deserialize)]
struct FrameEncodingVectorFile {
    canonical_json: String,
    noncanonical_cases: Vec<InvalidCase>,
}

fn length_prefix(json: &str) -> Vec<u8> {
    let length = u32::try_from(json.len()).expect("bounded fixture length");
    let mut encoded = Vec::with_capacity(4 + json.len());
    encoded.extend_from_slice(&length.to_be_bytes());
    encoded.extend_from_slice(json.as_bytes());
    encoded
}

#[test]
fn strict_json_rejects_all_negative_vectors() {
    let vectors: InvalidVectorFile =
        serde_json::from_value(load_json("invalid-json.json")).expect("invalid vector shape");
    for case in vectors.cases {
        let error = parse_strict_json(case.input_json.as_bytes(), BROKER_FRAME_MAX_BYTES)
            .expect_err(&case.name)
            .to_string();
        assert!(
            error.to_lowercase().contains(&case.error_contains),
            "{}: {error}",
            case.name
        );
    }
}

#[test]
fn strict_json_enforces_caller_byte_bound() {
    let error = parse_strict_json(br#"{"bounded":true}"#, 4).expect_err("oversize must fail");
    assert!(error.to_string().contains("exceeds 4 bytes"));
}

#[test]
fn frame_wire_encoding_requires_exact_rfc8785_bytes() {
    let vectors: FrameEncodingVectorFile =
        serde_json::from_value(load_json("noncanonical-frames.json"))
            .expect("frame encoding vector shape");
    let now = 1_700_000_000_000_u64;

    let canonical = length_prefix(&vectors.canonical_json);
    let frame: SigningFrameV1<Value> =
        decode_length_prefixed_frame(&canonical, now).expect("canonical frame accepted");
    assert_eq!(
        encode_length_prefixed_frame(&frame, now).expect("canonical frame re-encodes"),
        canonical
    );

    for case in vectors.noncanonical_cases {
        let error = decode_length_prefixed_frame::<Value>(&length_prefix(&case.input_json), now)
            .expect_err(&case.name)
            .to_string();
        assert!(
            error.to_lowercase().contains(&case.error_contains),
            "{}: {error}",
            case.name
        );
    }
}

#[test]
fn message_frame_and_body_free_result_share_checked_vector() {
    let root = load_json("m1-protocol.json");
    let request: ManagedMessagePublishRequestV1 =
        serde_json::from_value(root["message_publish"]["request"].clone())
            .expect("valid managed publish request");
    request.validate().expect("cross-field request validation");

    let result: ManagedMessagePublishResultV1 =
        serde_json::from_value(root["message_publish"]["accepted_result"].clone())
            .expect("valid body-free result");
    let result_json = serde_json::to_value(result).expect("serialize result");
    assert!(result_json.get("exact_event_json").is_none());
    assert!(result_json.get("final_draft").is_none());

    let now = root["frame"]["now_unix_ms"]
        .as_u64()
        .expect("fixed vector clock");
    let frame: SigningFrameV1<ManagedMessagePublishRequestV1> =
        serde_json::from_value(root["frame"]["value"].clone()).expect("valid frame");
    let encoded = encode_length_prefixed_frame(&frame, now).expect("encode bounded frame");
    let decoded: SigningFrameV1<ManagedMessagePublishRequestV1> =
        decode_length_prefixed_frame(&encoded, now).expect("decode bounded frame");
    assert_eq!(decoded, frame);
    assert_eq!(
        u32::from_be_bytes(encoded[..4].try_into().expect("prefix")) as usize,
        encoded.len() - 4
    );
}

#[test]
fn message_publish_rejects_unsorted_tags_wrong_hash_and_unsafe_integer() {
    let root = load_json("m1-protocol.json");
    let mut request = root["message_publish"]["request"].clone();
    request["resolved_p_tags"]
        .as_array_mut()
        .expect("tags array")
        .reverse();
    assert!(serde_json::from_value::<ManagedMessagePublishRequestV1>(request).is_err());

    let mut request = root["message_publish"]["request"].clone();
    request["idempotency_key"] = Value::String("a".repeat(64));
    assert!(serde_json::from_value::<ManagedMessagePublishRequestV1>(request).is_err());

    let mut request = root["message_publish"]["request"].clone();
    request["cancellation_epoch"] = Value::from(9_007_199_254_740_992_u64);
    assert!(serde_json::from_value::<ManagedMessagePublishRequestV1>(request).is_err());
}

#[test]
fn safe_diagnostic_is_fixed_field_and_body_free() {
    let root = load_json("m1-protocol.json");
    let diagnostic: SafeDiagnosticV1 =
        serde_json::from_value(root["safe_diagnostic"].clone()).expect("valid diagnostic");
    let canonical = canonicalize(&diagnostic).expect("canonical diagnostic");
    let value: Value = serde_json::from_slice(&canonical).expect("canonical diagnostic JSON");
    let object = value.as_object().expect("diagnostic object");
    for forbidden in ["message", "detail", "body", "path"] {
        assert!(
            !object.contains_key(forbidden),
            "forbidden field {forbidden}"
        );
    }

    let mut invalid = root["safe_diagnostic"].clone();
    invalid["detail"] = Value::String("must not be representable".to_owned());
    assert!(serde_json::from_value::<SafeDiagnosticV1>(invalid).is_err());
}

#[test]
fn checked_schemas_are_strict_and_preserve_the_m1_boundary() {
    let schema_names = [
        "common/v1.schema.json",
        "message_publish/v1.schema.json",
        "signing_broker/frame-v1.schema.json",
        "backup_restore/owner-identity-v1.schema.json",
        "diagnostics/safe-diagnostic-v1.schema.json",
    ];
    for name in schema_names {
        let bytes = fs::read(schema_path(name)).expect("read checked-in schema");
        let schema = parse_strict_json(&bytes, BROKER_FRAME_MAX_BYTES)
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(
            schema["$schema"], "https://json-schema.org/draft/2020-12/schema",
            "{name} dialect"
        );
        assert!(schema["$id"].as_str().is_some(), "{name} has stable id");
    }

    let diagnostic = fs::read(schema_path("diagnostics/safe-diagnostic-v1.schema.json"))
        .expect("read diagnostic schema");
    let diagnostic =
        parse_strict_json(&diagnostic, BROKER_FRAME_MAX_BYTES).expect("strict diagnostic schema");
    let properties = diagnostic["properties"]
        .as_object()
        .expect("diagnostic properties");
    for forbidden in ["message", "detail", "body", "path", "context"] {
        assert!(!properties.contains_key(forbidden));
    }
    assert_eq!(diagnostic["additionalProperties"], false);

    let publish =
        fs::read(schema_path("message_publish/v1.schema.json")).expect("read publish schema");
    let publish = String::from_utf8(publish).expect("schema UTF-8");
    assert!(!publish.contains("exact_event_json"));
}

#[test]
fn frame_deadline_and_size_limits_fail_closed() {
    let root = load_json("m1-protocol.json");
    let now = root["frame"]["now_unix_ms"].as_u64().expect("clock");
    let mut frame = root["frame"]["value"].clone();
    frame["deadline_unix_ms"] = Value::from(now + 30_001);
    let frame: SigningFrameV1<ManagedMessagePublishRequestV1> =
        serde_json::from_value(frame).expect("typed frame");
    assert!(encode_length_prefixed_frame(&frame, now).is_err());

    let mut request = root["message_publish"]["request"].clone();
    request["final_draft"] = Value::String("é".repeat(32_769));
    assert!(serde_json::from_value::<ManagedMessagePublishRequestV1>(request).is_err());
}

fn derived_keys(domain: &str) -> Keys {
    let digest = Sha256::digest(domain.as_bytes());
    let secret = SecretKey::from_slice(&digest).expect("domain hash is a valid synthetic key");
    Keys::new(secret)
}

#[test]
fn owner_identity_vector_derives_secret_only_in_memory() {
    let root = load_json("m1-protocol.json");
    let vector = &root["owner_identity_public_vector"];
    let domain = vector["derivation_domain"].as_str().expect("domain");
    let keys = derived_keys(domain);
    let nsec = keys
        .secret_key()
        .to_bech32()
        .expect("encode transient nsec");
    let mut bundle = OwnerIdentityBundleV1 {
        format: OWNER_IDENTITY_FORMAT.to_owned(),
        version: OWNER_IDENTITY_VERSION,
        canonicalization: OWNER_IDENTITY_CANONICALIZATION.to_owned(),
        bundle_id: BundleId::parse(vector["bundle_id"].as_str().expect("bundle ID"))
            .expect("valid bundle ID"),
        exported_at: CanonicalTimestamp::parse(
            vector["exported_at"].as_str().expect("exported_at"),
        )
        .expect("valid timestamp"),
        owner_pubkey: Hex64::parse(keys.public_key().to_hex()).expect("valid public key"),
        owner_secret_nsec: SecretNsec::new(nsec).expect("valid transient nsec"),
        manifest_sha256: Hex64::parse("0".repeat(64)).expect("placeholder hash"),
    };
    bundle.manifest_sha256 = bundle.calculate_manifest_sha256().expect("manifest hash");
    assert_eq!(
        bundle.owner_pubkey.as_str(),
        vector["owner_pubkey"]
            .as_str()
            .expect("expected public key")
    );
    assert_eq!(
        bundle.manifest_sha256.as_str(),
        vector["manifest_sha256"].as_str().expect("expected hash")
    );
    assert!(format!("{bundle:?}").contains("[REDACTED]"));
    assert!(!format!("{bundle:?}").contains("nsec1"));
    bundle.validate().expect("valid protected inner manifest");
}

#[test]
fn checked_signature_vector_is_public_only_and_verifies() {
    let root = load_json("m1-protocol.json");
    let vector = &root["signature_public_vector"];
    let keys = derived_keys(vector["derivation_domain"].as_str().expect("domain"));
    assert_eq!(
        keys.public_key().to_hex(),
        vector["pubkey"].as_str().expect("public key")
    );
    let event_json = serde_json::json!({
        "id": vector["event_id"],
        "pubkey": vector["pubkey"],
        "created_at": vector["created_at"],
        "kind": 1,
        "tags": [],
        "content": vector["content"],
        "sig": vector["signature"]
    });
    let event = nostr::Event::from_json(event_json.to_string()).expect("public event vector");
    assert!(event.verify_id());
    assert!(event.verify_signature());
}

#[test]
#[ignore = "prints public-only vector values for deliberate fixture refresh"]
fn emit_public_only_crypto_vectors() {
    let root = load_json("m1-protocol.json");
    let owner = &root["owner_identity_public_vector"];
    let owner_keys = derived_keys(owner["derivation_domain"].as_str().expect("domain"));
    let nsec = owner_keys
        .secret_key()
        .to_bech32()
        .expect("encode transient nsec");
    let mut bundle = OwnerIdentityBundleV1 {
        format: OWNER_IDENTITY_FORMAT.to_owned(),
        version: OWNER_IDENTITY_VERSION,
        canonicalization: OWNER_IDENTITY_CANONICALIZATION.to_owned(),
        bundle_id: BundleId::parse(owner["bundle_id"].as_str().expect("bundle ID"))
            .expect("valid bundle ID"),
        exported_at: CanonicalTimestamp::parse(owner["exported_at"].as_str().expect("time"))
            .expect("valid timestamp"),
        owner_pubkey: Hex64::parse(owner_keys.public_key().to_hex()).expect("public key"),
        owner_secret_nsec: SecretNsec::new(nsec).expect("transient nsec"),
        manifest_sha256: Hex64::parse("0".repeat(64)).expect("placeholder"),
    };
    bundle.manifest_sha256 = bundle.calculate_manifest_sha256().expect("manifest hash");

    let signature = &root["signature_public_vector"];
    let signing_keys = derived_keys(signature["derivation_domain"].as_str().expect("domain"));
    let event = EventBuilder::new(
        Kind::TextNote,
        signature["content"].as_str().expect("content"),
    )
    .tags([])
    .custom_created_at(Timestamp::from(
        signature["created_at"].as_u64().expect("created_at"),
    ))
    .sign_with_keys(&signing_keys)
    .expect("sign synthetic public vector");
    eprintln!(
        "owner_pubkey={}\nmanifest_sha256={}\nsignature_pubkey={}\nevent_id={}\nsignature={}",
        bundle.owner_pubkey.as_str(),
        bundle.manifest_sha256.as_str(),
        event.pubkey.to_hex(),
        event.id.to_hex(),
        event.sig
    );
}
