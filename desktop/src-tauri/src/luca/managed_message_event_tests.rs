use super::managed_message_event::*;
use luca_protocol::{
    derive_message_publish_idempotency_key, Hex64, ManagedFinalAttachmentV1,
    ManagedMessagePublishRequestV1, ManagedResponseSurfaceV1, OpaqueId, SafeU53,
    MESSAGE_PUBLISH_PROTOCOL,
};
use nostr::{EventBuilder, Keys, Kind, Tag};

fn hex(value: char) -> Hex64 {
    Hex64::parse(value.to_string().repeat(64)).expect("valid fixture hex")
}

fn request(keys: &Keys) -> ManagedMessagePublishRequestV1 {
    let resident_pubkey = Hex64::parse(keys.public_key().to_hex()).expect("valid resident pubkey");
    let dispatch_receipt_id = OpaqueId::parse("dispatch-1").expect("valid dispatch receipt ID");
    ManagedMessagePublishRequestV1 {
        protocol: MESSAGE_PUBLISH_PROTOCOL.to_owned(),
        turn_id: OpaqueId::parse("turn-1").expect("valid turn ID"),
        idempotency_key: derive_message_publish_idempotency_key(
            &dispatch_receipt_id,
            &resident_pubkey,
        )
        .expect("valid idempotency key"),
        owner_pubkey: hex('a'),
        resident_pubkey,
        conversation_id: OpaqueId::parse("conversation-1").expect("valid conversation ID"),
        thread_id: None,
        root_event_id: None,
        reply_event_id: None,
        response_surface: Some(ManagedResponseSurfaceV1::Timeline),
        resolved_p_tags: vec![hex('a')],
        final_draft: "here is the chart".to_owned(),
        dispatch_receipt_id,
        cancellation_epoch: SafeU53::new(3).expect("valid cancellation epoch"),
        exchange: None,
        bucket_hint: None,
        attachments: Vec::new(),
    }
}

fn attachment(index: u8) -> ManagedFinalAttachmentV1 {
    ManagedFinalAttachmentV1 {
        url: format!("https://relay.example/blob-{index}.png"),
        sha256: Hex64::parse(format!("{index:02x}").repeat(32)).expect("valid blob hash"),
        mime_type: "image/png".to_owned(),
        size: SafeU53::new(1_024 + u64::from(index)).expect("valid size"),
        dim: Some("800x600".to_owned()),
        blurhash: Some("LEHV6nWB2yk8".to_owned()),
        thumb: Some(format!("https://relay.example/blob-{index}-thumb.png")),
        filename: Some(format!("chart-{index}.png")),
    }
}

fn bare_attachment() -> ManagedFinalAttachmentV1 {
    ManagedFinalAttachmentV1 {
        dim: None,
        blurhash: None,
        thumb: None,
        filename: None,
        ..attachment(1)
    }
}

fn event_with(keys: &Keys, request: &ManagedMessagePublishRequestV1) -> nostr::Event {
    EventBuilder::new(Kind::Custom(9), request.final_draft.clone())
        .tags(managed_message_tags(request).expect("tags"))
        .sign_with_keys(keys)
        .expect("sign fixture event")
}

fn tag_values(request: &ManagedMessagePublishRequestV1) -> Vec<Vec<String>> {
    managed_message_tags(request)
        .expect("tags")
        .iter()
        .map(|tag| tag.as_slice().to_vec())
        .collect()
}

#[test]
fn a_final_without_images_has_exactly_the_tags_it_always_had() {
    let keys = Keys::parse(&"02".repeat(32)).expect("valid fixture key");
    let request = request(&keys);
    assert_eq!(
        tag_values(&request),
        vec![
            vec!["h".to_owned(), "conversation-1".to_owned()],
            vec!["p".to_owned(), "a".repeat(64)],
            vec!["luca-managed-dispatch".to_owned(), "dispatch-1".to_owned()],
            vec!["broadcast".to_owned(), "1".to_owned()],
        ]
    );
}

#[test]
fn one_image_closes_the_tag_sequence_in_the_owners_own_shape() {
    let keys = Keys::parse(&"02".repeat(32)).expect("valid fixture key");
    let mut request = request(&keys);
    request.attachments = vec![attachment(1)];
    let tags = tag_values(&request);
    assert_eq!(tags.len(), 5, "the imeta tag is appended, nothing removed");
    assert_eq!(
        tags[3],
        vec!["broadcast".to_owned(), "1".to_owned()],
        "imeta sits after every existing tag"
    );
    assert_eq!(
        tags[4],
        vec![
            "imeta".to_owned(),
            "url https://relay.example/blob-1.png".to_owned(),
            "m image/png".to_owned(),
            format!("x {}", "01".repeat(32)),
            "size 1025".to_owned(),
            "dim 800x600".to_owned(),
            "blurhash LEHV6nWB2yk8".to_owned(),
            "thumb https://relay.example/blob-1-thumb.png".to_owned(),
            "filename chart-1.png".to_owned(),
        ]
    );
}

#[test]
fn an_image_the_relay_described_sparsely_carries_only_what_it_has() {
    let keys = Keys::parse(&"02".repeat(32)).expect("valid fixture key");
    let mut request = request(&keys);
    request.attachments = vec![bare_attachment()];
    let tags = tag_values(&request);
    assert_eq!(
        tags[4],
        vec![
            "imeta".to_owned(),
            "url https://relay.example/blob-1.png".to_owned(),
            "m image/png".to_owned(),
            format!("x {}", "01".repeat(32)),
            "size 1025".to_owned(),
        ]
    );
}

#[test]
fn four_images_keep_the_order_the_resident_made_them_in() {
    let keys = Keys::parse(&"02".repeat(32)).expect("valid fixture key");
    let mut request = request(&keys);
    request.attachments = (1..=4).map(attachment).collect();
    let tags = tag_values(&request);
    assert_eq!(tags.len(), 8);
    let urls: Vec<&String> = tags[4..].iter().map(|tag| &tag[1]).collect();
    assert_eq!(
        urls,
        vec![
            "url https://relay.example/blob-1.png",
            "url https://relay.example/blob-2.png",
            "url https://relay.example/blob-3.png",
            "url https://relay.example/blob-4.png",
        ]
    );
}

#[test]
fn an_event_matches_its_own_request_at_zero_one_and_four_images() {
    let keys = Keys::parse(&"02".repeat(32)).expect("valid fixture key");
    for count in [0usize, 1, 4] {
        let mut request = request(&keys);
        request.attachments = (1..=count as u8).map(attachment).collect();
        let event = event_with(&keys, &request);
        assert!(
            event_tags_match_request(&event, &request),
            "{count} images should match exactly"
        );
        assert!(event_tags_match_persisted_request(&event, &request));
    }
}

#[test]
fn a_row_frozen_before_images_still_matches_a_request_that_now_has_them() {
    let keys = Keys::parse(&"02".repeat(32)).expect("valid fixture key");
    let plain = request(&keys);
    let persisted = event_with(&keys, &plain);

    let mut with_images = plain.clone();
    with_images.attachments = vec![attachment(1)];
    assert!(
        !event_tags_match_request(&persisted, &with_images),
        "the exact comparison still refuses a tag set that is missing imeta"
    );
    assert!(
        event_tags_match_persisted_request(&persisted, &with_images),
        "restart reconciliation keeps the pre-attachment row"
    );
}

#[test]
fn a_row_frozen_before_the_receipt_tag_still_matches_with_images() {
    let keys = Keys::parse(&"02".repeat(32)).expect("valid fixture key");
    let mut with_images = request(&keys);
    with_images.attachments = vec![attachment(1)];
    // Exactly what an older build would have signed: no receipt tag, no imeta.
    let legacy = EventBuilder::new(Kind::Custom(9), with_images.final_draft.clone())
        .tags(vec![
            Tag::parse(["h", "conversation-1"]).expect("tag"),
            Tag::parse(["p", &"a".repeat(64)]).expect("tag"),
            Tag::parse(["broadcast", "1"]).expect("tag"),
        ])
        .sign_with_keys(&keys)
        .expect("sign legacy event");
    assert!(event_tags_match_persisted_request(&legacy, &with_images));
}

#[test]
fn a_tampered_image_tag_does_not_match() {
    let keys = Keys::parse(&"02".repeat(32)).expect("valid fixture key");
    let mut request = request(&keys);
    request.attachments = vec![attachment(1), attachment(2)];
    let mut swapped = request.clone();
    swapped.attachments.reverse();
    let event = event_with(&keys, &swapped);
    assert!(!event_tags_match_request(&event, &request));
    assert!(!event_tags_match_persisted_request(&event, &request));
}

#[test]
fn the_body_line_is_the_owners_own_image_line() {
    assert_eq!(
        attachment_body_line(&attachment(1)),
        "\n![image](https://relay.example/blob-1.png)"
    );
}
