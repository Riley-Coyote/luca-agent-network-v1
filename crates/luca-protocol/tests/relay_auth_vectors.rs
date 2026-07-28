use luca_protocol::{
    canonicalize, decode_length_prefixed_frame, decode_length_prefixed_result_frame,
    encode_length_prefixed_frame, encode_length_prefixed_result_frame, parse_strict_json,
    RelayAuthSignRequestV1, RelayAuthSignResultV1, SigningFrameV1, SigningResultFrameV1,
    BROKER_FRAME_MAX_BYTES,
};
use nostr::{EventBuilder, JsonUtil, Keys, RelayUrl, SecretKey, Timestamp};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

fn vector_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/luca-conformance/protocol/relay-auth.json")
}

fn load_vector() -> Value {
    let bytes = fs::read(vector_path()).expect("read checked-in relay-auth vector");
    parse_strict_json(&bytes, BROKER_FRAME_MAX_BYTES).expect("strict relay-auth vector JSON")
}

fn derived_keys(domain: &str) -> Keys {
    let digest = Sha256::digest(domain.as_bytes());
    let secret = SecretKey::from_slice(&digest).expect("domain hash is a valid synthetic key");
    Keys::new(secret)
}

#[derive(Deserialize)]
struct InvalidRequest {
    name: String,
    value: Value,
}

#[test]
fn relay_auth_requests_and_frames_match_checked_vectors() {
    let root = load_vector();
    let nip42: RelayAuthSignRequestV1 =
        serde_json::from_value(root["nip42_request"].clone()).expect("valid NIP-42 request");
    let nip98: RelayAuthSignRequestV1 =
        serde_json::from_value(root["nip98_request"].clone()).expect("valid NIP-98 request");
    nip42.validate().expect("NIP-42 semantics");
    nip98.validate().expect("NIP-98 semantics");

    let now = root["request_frame"]["now_unix_ms"]
        .as_u64()
        .expect("fixed vector clock");
    let frame: SigningFrameV1<RelayAuthSignRequestV1> =
        serde_json::from_value(root["request_frame"]["value"].clone()).expect("valid auth frame");
    let encoded = encode_length_prefixed_frame(&frame, now).expect("encode request frame");
    let decoded: SigningFrameV1<RelayAuthSignRequestV1> =
        decode_length_prefixed_frame(&encoded, now).expect("decode request frame");
    assert_eq!(decoded, frame);

    let result_frame: SigningResultFrameV1<RelayAuthSignResultV1> =
        serde_json::from_value(root["signed_result_frame"].clone()).expect("valid result frame");
    let encoded = encode_length_prefixed_result_frame(&result_frame).expect("encode result frame");
    let decoded: SigningResultFrameV1<RelayAuthSignResultV1> =
        decode_length_prefixed_result_frame(&encoded).expect("decode result frame");
    assert_eq!(decoded, result_frame);
}

#[test]
fn relay_auth_rejects_semantically_unbounded_requests() {
    let root = load_vector();
    let cases: Vec<InvalidRequest> =
        serde_json::from_value(root["invalid_requests"].clone()).expect("invalid cases");
    for case in cases {
        assert!(
            serde_json::from_value::<RelayAuthSignRequestV1>(case.value).is_err(),
            "{} must fail closed",
            case.name
        );
    }
}

#[test]
fn relay_auth_public_event_vector_is_canonical_and_verifies() {
    let root = load_vector();
    let vector = &root["public_event_vector"];
    let keys = derived_keys(vector["derivation_domain"].as_str().expect("domain"));
    assert_eq!(
        keys.public_key().to_hex(),
        vector["pubkey"].as_str().expect("public key")
    );
    let event = nostr::Event::from_json(
        vector["signed_event_json"]
            .as_str()
            .expect("signed event JSON"),
    )
    .expect("public NIP-42 event");
    assert_eq!(event.id.to_hex(), vector["event_id"].as_str().unwrap());
    assert_eq!(event.sig.to_string(), vector["signature"].as_str().unwrap());
    assert!(event.verify_id());
    assert!(event.verify_signature());
    assert_eq!(
        canonicalize(&event).expect("canonical public event"),
        vector["signed_event_json"].as_str().unwrap().as_bytes()
    );
}

#[test]
#[ignore = "prints public-only vector values for deliberate fixture refresh"]
fn emit_public_only_relay_auth_vector() {
    let root = load_vector();
    let vector = &root["public_event_vector"];
    let keys = derived_keys(vector["derivation_domain"].as_str().expect("domain"));
    let request = &root["nip42_request"]["purpose"];
    let relay_url =
        RelayUrl::parse(request["relay_url"].as_str().expect("relay URL")).expect("valid URL");
    let event = EventBuilder::auth(request["challenge"].as_str().expect("challenge"), relay_url)
        .custom_created_at(Timestamp::from(
            vector["created_at"].as_u64().expect("created_at"),
        ))
        .sign_with_keys(&keys)
        .expect("sign public-only event");
    let canonical = canonicalize(&event).expect("canonical public event");
    eprintln!(
        "pubkey={}\nevent_id={}\nsignature={}\nsigned_event_json={}",
        event.pubkey.to_hex(),
        event.id.to_hex(),
        event.sig,
        String::from_utf8(canonical).expect("UTF-8")
    );
}
