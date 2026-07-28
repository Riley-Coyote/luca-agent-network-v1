use luca_protocol::{
    canonicalize, decode_length_prefixed_frame, decode_length_prefixed_result_frame,
    encode_length_prefixed_frame, encode_length_prefixed_result_frame, parse_strict_json,
    OperationV1, RelayAuthSignRequestV1, RelayAuthSignResultV1, SigningFrameV1,
    SigningResultFrameV1, BROKER_FRAME_MAX_BYTES,
};
use nostr::{EventBuilder, JsonUtil, Keys, Kind, RelayUrl, SecretKey, Tag, Timestamp};
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
    nip98
        .validate_at(
            root["public_nip98_event_vector"]["created_at"]
                .as_u64()
                .unwrap(),
        )
        .expect("NIP-98 bounded expiry");
    assert!(nip98
        .validate_at(
            root["public_nip98_event_vector"]["created_at"]
                .as_u64()
                .unwrap()
                - 1,
        )
        .is_err());

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
    result_frame
        .result
        .validate_against(
            &nip42,
            root["public_event_vector"]["created_at"].as_u64().unwrap(),
        )
        .expect("NIP-42 response binding");
    let encoded = encode_length_prefixed_result_frame(&result_frame).expect("encode result frame");
    let decoded: SigningResultFrameV1<RelayAuthSignResultV1> =
        decode_length_prefixed_result_frame(&encoded).expect("decode result frame");
    assert_eq!(decoded, result_frame);

    let nip98_result: RelayAuthSignResultV1 =
        serde_json::from_value(root["signed_nip98_result"].clone()).expect("valid NIP-98 result");
    nip98_result
        .validate_against(
            &nip98,
            root["public_nip98_event_vector"]["created_at"]
                .as_u64()
                .unwrap(),
        )
        .expect("NIP-98 response binding");
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
fn relay_auth_broker_frames_reject_operation_type_mismatch() {
    let root = load_vector();
    let now = root["request_frame"]["now_unix_ms"].as_u64().unwrap();
    let mut request_frame: SigningFrameV1<RelayAuthSignRequestV1> =
        serde_json::from_value(root["request_frame"]["value"].clone()).unwrap();
    request_frame.operation = OperationV1::MessagePublish;
    assert!(encode_length_prefixed_frame(&request_frame, now).is_err());
    let payload = canonicalize(&request_frame).unwrap();
    let mut encoded = (payload.len() as u32).to_be_bytes().to_vec();
    encoded.extend_from_slice(&payload);
    assert!(decode_length_prefixed_frame::<RelayAuthSignRequestV1>(&encoded, now).is_err());

    let mut result_frame: SigningResultFrameV1<RelayAuthSignResultV1> =
        serde_json::from_value(root["signed_result_frame"].clone()).unwrap();
    result_frame.operation = OperationV1::MessagePublish;
    assert!(encode_length_prefixed_result_frame(&result_frame).is_err());
    let payload = canonicalize(&result_frame).unwrap();
    let mut encoded = (payload.len() as u32).to_be_bytes().to_vec();
    encoded.extend_from_slice(&payload);
    assert!(decode_length_prefixed_result_frame::<RelayAuthSignResultV1>(&encoded).is_err());
}

fn assert_public_event_vector(vector: &Value) {
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
fn relay_auth_public_event_vectors_are_canonical_and_verify() {
    let root = load_vector();
    assert_public_event_vector(&root["public_event_vector"]);
    assert_public_event_vector(&root["public_nip98_event_vector"]);
}

#[test]
fn relay_auth_result_rejects_unsigned_mismatched_and_stale_events() {
    let root = load_vector();
    let event_id = root["public_event_vector"]["event_id"].as_str().unwrap();
    let fake = serde_json::json!({
        "state": "signed",
        "event_id": event_id,
        "signed_event_json": format!("{{\"id\":\"{event_id}\"}}")
    });
    assert!(serde_json::from_value::<RelayAuthSignResultV1>(fake).is_err());
    let mut event_with_extra: Value = serde_json::from_str(
        root["public_event_vector"]["signed_event_json"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    event_with_extra["unsigned_extra"] = Value::Bool(true);
    let event_with_extra = canonicalize(&event_with_extra).unwrap();
    let event_with_extra = serde_json::json!({
        "state": "signed",
        "event_id": event_id,
        "signed_event_json": String::from_utf8(event_with_extra).unwrap()
    });
    assert!(serde_json::from_value::<RelayAuthSignResultV1>(event_with_extra).is_err());

    let request: RelayAuthSignRequestV1 =
        serde_json::from_value(root["nip42_request"].clone()).unwrap();
    let nip98_result: RelayAuthSignResultV1 =
        serde_json::from_value(root["signed_nip98_result"].clone()).unwrap();
    assert!(nip98_result
        .validate_against(
            &request,
            root["public_event_vector"]["created_at"].as_u64().unwrap()
        )
        .is_err());
    let mut wrong_resident = root["nip42_request"].clone();
    wrong_resident["resident_pubkey"] = Value::String("0".repeat(64));
    let wrong_resident: RelayAuthSignRequestV1 = serde_json::from_value(wrong_resident).unwrap();
    let nip42_result: RelayAuthSignResultV1 =
        serde_json::from_value(root["signed_result_frame"]["result"].clone()).unwrap();
    assert!(nip42_result
        .validate_against(
            &wrong_resident,
            root["public_event_vector"]["created_at"].as_u64().unwrap(),
        )
        .is_err());

    let nip98_request: RelayAuthSignRequestV1 =
        serde_json::from_value(root["nip98_request"].clone()).unwrap();
    assert!(nip98_result
        .validate_against(
            &nip98_request,
            root["public_nip98_event_vector"]["created_at"]
                .as_u64()
                .unwrap()
                + 61,
        )
        .is_err());
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

    let nip98 = &root["nip98_request"]["purpose"];
    let tags = vec![
        Tag::parse(["u", nip98["url"].as_str().unwrap()]).unwrap(),
        Tag::parse(["method", nip98["method"].as_str().unwrap()]).unwrap(),
        Tag::parse(["nonce", nip98["nonce"].as_str().unwrap()]).unwrap(),
        Tag::parse(["payload", nip98["payload_sha256"].as_str().unwrap()]).unwrap(),
    ];
    let nip98_event = EventBuilder::new(Kind::HttpAuth, "")
        .tags(tags)
        .custom_created_at(Timestamp::from(
            root["public_nip98_event_vector"]["created_at"]
                .as_u64()
                .unwrap(),
        ))
        .sign_with_keys(&keys)
        .expect("sign public-only NIP-98 event");
    let nip98_canonical = canonicalize(&nip98_event).expect("canonical NIP-98 event");
    eprintln!(
        "nip98_event_id={}\nnip98_signature={}\nnip98_signed_event_json={}",
        nip98_event.id.to_hex(),
        nip98_event.sig,
        String::from_utf8(nip98_canonical).expect("UTF-8")
    );
}
