//! Exact signed-event tags for managed final publication.

use luca_protocol::{ManagedMessagePublishRequestV1, ManagedResponseSurfaceV1};
use nostr::Tag;

fn managed_message_tags_inner(
    request: &ManagedMessagePublishRequestV1,
    include_receipt: bool,
) -> Result<Vec<Tag>, ()> {
    let mut tags = vec![Tag::parse(["h", request.conversation_id.as_str()]).map_err(|_| ())?];
    match (&request.root_event_id, &request.reply_event_id) {
        (None, None) => {}
        (Some(root), Some(reply)) if root == reply => {
            tags.push(Tag::parse(["e", root.as_str(), "", "reply"]).map_err(|_| ())?);
        }
        (Some(root), Some(reply)) => {
            tags.push(Tag::parse(["e", root.as_str(), "", "root"]).map_err(|_| ())?);
            tags.push(Tag::parse(["e", reply.as_str(), "", "reply"]).map_err(|_| ())?);
        }
        _ => return Err(()),
    }
    for pubkey in &request.resolved_p_tags {
        tags.push(Tag::parse(["p", pubkey.as_str()]).map_err(|_| ())?);
    }
    // The turn tag sits in one fixed place — after the recipients, before the
    // receipt — because `event_tags_match_request` compares tag sequences
    // exactly and both builders must agree on the order.
    if let Some(exchange) = &request.exchange {
        tags.push(Tag::parse(exchange.to_tag()).map_err(|_| ())?);
    }
    if include_receipt && request.response_surface.is_some() {
        tags.push(
            Tag::parse([
                luca_protocol::MANAGED_DISPATCH_RECEIPT_TAG,
                request.dispatch_receipt_id.as_str(),
            ])
            .map_err(|_| ())?,
        );
    }
    if request.response_surface == Some(ManagedResponseSurfaceV1::Timeline) {
        tags.push(Tag::parse(["broadcast", "1"]).map_err(|_| ())?);
    }
    Ok(tags)
}

pub(super) fn managed_message_tags(
    request: &ManagedMessagePublishRequestV1,
) -> Result<Vec<Tag>, ()> {
    managed_message_tags_inner(request, true)
}

fn event_tags_equal(event: &nostr::Event, expected: &[Tag]) -> bool {
    event
        .tags
        .iter()
        .map(|tag| tag.as_slice())
        .eq(expected.iter().map(|tag| tag.as_slice()))
}

pub(super) fn event_tags_match_request(
    event: &nostr::Event,
    request: &ManagedMessagePublishRequestV1,
) -> bool {
    let Ok(expected) = managed_message_tags(request) else {
        return false;
    };
    event_tags_equal(event, &expected)
}

pub(super) fn event_tags_match_persisted_request(
    event: &nostr::Event,
    request: &ManagedMessagePublishRequestV1,
) -> bool {
    if event_tags_match_request(event, request) {
        return true;
    }
    let Ok(pre_receipt) = managed_message_tags_inner(request, false) else {
        return false;
    };
    request.response_surface.is_some() && event_tags_equal(event, &pre_receipt)
}
