use luca_protocol::{
    decode_length_prefixed_frame, derive_message_publish_idempotency_key,
    encode_length_prefixed_frame, ManagedMessagePublishRequestV1, SigningFrameV1,
};

#[test]
fn message_publish_vectors_match_the_frozen_m1_protocol_fixture() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../protocol/m1-protocol.json"
    ))
    .expect("M1 conformance fixture must be valid JSON");
    let request: ManagedMessagePublishRequestV1 =
        serde_json::from_value(fixture["message_publish"]["request"].clone())
            .expect("message publication request must match the strict schema");
    request
        .validate()
        .expect("message publication request must satisfy semantic validation");
    assert_eq!(
        request.idempotency_key,
        derive_message_publish_idempotency_key(
            &request.dispatch_receipt_id,
            &request.resident_pubkey
        )
        .expect("fixture idempotency inputs must be valid")
    );

    let now_unix_ms = fixture["frame"]["now_unix_ms"]
        .as_u64()
        .expect("fixture timestamp must be an integer");
    let frame: SigningFrameV1<ManagedMessagePublishRequestV1> =
        serde_json::from_value(fixture["frame"]["value"].clone())
            .expect("message publication frame must match the strict schema");
    let encoded =
        encode_length_prefixed_frame(&frame, now_unix_ms).expect("fixture frame must encode");
    let decoded =
        decode_length_prefixed_frame::<ManagedMessagePublishRequestV1>(&encoded, now_unix_ms)
            .expect("fixture frame must decode");
    assert_eq!(decoded, frame);
    assert_eq!(decoded.payload, request);
}
