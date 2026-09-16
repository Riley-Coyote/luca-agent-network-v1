//! Exact signed-event tags for managed final publication.

use luca_protocol::{
    ManagedFinalAttachmentV1, ManagedMessagePublishRequestV1, ManagedResponseSurfaceV1,
};
use nostr::Tag;

/// One NIP-92 `imeta` tag, in exactly the shape the owner's own attachments
/// use (`desktop/src/features/messages/lib/imetaMediaMarkdown.ts`,
/// `buildImetaTags`): `url` and `m` always, then the optional fields in the
/// same fixed order. `luca_handle` is deliberately absent — it is an owner-side
/// upload handle and means nothing on a resident's final.
fn imeta_tag(attachment: &ManagedFinalAttachmentV1) -> Result<Tag, ()> {
    let mut values = vec![
        "imeta".to_owned(),
        format!("url {}", attachment.url),
        format!("m {}", attachment.mime_type),
        format!("x {}", attachment.sha256.as_str()),
        format!("size {}", attachment.size.get()),
    ];
    if let Some(dim) = &attachment.dim {
        values.push(format!("dim {dim}"));
    }
    if let Some(blurhash) = &attachment.blurhash {
        values.push(format!("blurhash {blurhash}"));
    }
    if let Some(thumb) = &attachment.thumb {
        values.push(format!("thumb {thumb}"));
    }
    if let Some(filename) = &attachment.filename {
        values.push(format!("filename {filename}"));
    }
    Tag::parse(values).map_err(|_| ())
}

fn managed_message_tags_inner(
    request: &ManagedMessagePublishRequestV1,
    include_receipt: bool,
    include_attachments: bool,
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
    // Attachments close the sequence, in request order, for the same reason the
    // turn tag has a fixed place: one position, agreed by both builders.
    if include_attachments {
        for attachment in &request.attachments {
            tags.push(imeta_tag(attachment)?);
        }
    }
    Ok(tags)
}

/// The body line that makes an attached image render, identical to the owner's
/// own `formatImetaMediaLine` for an `image/*` blob: one leading newline and a
/// bare `![image](url)` on its own line.
pub(super) fn attachment_body_line(attachment: &ManagedFinalAttachmentV1) -> String {
    format!("\n![image]({})", attachment.url)
}

pub(super) fn managed_message_tags(
    request: &ManagedMessagePublishRequestV1,
) -> Result<Vec<Tag>, ()> {
    managed_message_tags_inner(request, true, true)
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
    // Rows persisted by an older build carry neither the dispatch receipt tag
    // nor any imeta tag. Each absence gets its own comparison arm, guarded by
    // the field whose presence would otherwise have produced it, so a current
    // event still has exactly one legal tag sequence.
    let has_surface = request.response_surface.is_some();
    let has_attachments = !request.attachments.is_empty();
    for (include_receipt, include_attachments) in
        [(true, true), (false, true), (true, false), (false, false)]
    {
        if !include_receipt && !has_surface {
            continue;
        }
        if !include_attachments && !has_attachments {
            continue;
        }
        let Ok(expected) =
            managed_message_tags_inner(request, include_receipt, include_attachments)
        else {
            return false;
        };
        if event_tags_equal(event, &expected) {
            return true;
        }
    }
    false
}
