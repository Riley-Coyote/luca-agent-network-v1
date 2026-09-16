//! Typed managed-final-publication request and body-free result.

use crate::frame::{sealed, BrokerOperationV1, OperationV1};
use crate::{
    ExchangeTurnTag, Hex64, OpaqueId, ProtocolValueError, SafeU53, EXCHANGE_BUCKET_CEILING,
};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};

/// Managed final-publication protocol identifier.
pub const MESSAGE_PUBLISH_PROTOCOL: &str = "luca.message.publish.v1";
/// Exact signed-event tag carrying the body-free managed dispatch receipt.
///
/// The tag is emitted only for requests with a versioned response surface.
/// Legacy V1 outbox events without a response surface remain valid without it.
pub const MANAGED_DISPATCH_RECEIPT_TAG: &str = "luca-managed-dispatch";
/// Maximum UTF-8 byte length of an accepted final draft.
pub const MAX_FINAL_DRAFT_BYTES: usize = 65_536;
/// Maximum number of exact resolved `p` tags.
pub const MAX_RESOLVED_P_TAGS: usize = 64;
/// Maximum number of resolved image attachments carried by one final.
pub const MAX_FINAL_ATTACHMENTS: usize = 4;
/// Maximum UTF-8 byte length of an attachment URL (`url` and `thumb`).
pub const MAX_ATTACHMENT_URL_BYTES: usize = 2_048;
/// Maximum UTF-8 byte length of an attachment media type.
pub const MAX_ATTACHMENT_MIME_BYTES: usize = 128;
/// Maximum UTF-8 byte length of an attachment `dim` value (`"1024x768"`).
pub const MAX_ATTACHMENT_DIM_BYTES: usize = 32;
/// Maximum UTF-8 byte length of an attachment blurhash.
pub const MAX_ATTACHMENT_BLURHASH_BYTES: usize = 256;
/// Maximum UTF-8 byte length of an attachment filename.
pub const MAX_ATTACHMENT_FILENAME_BYTES: usize = 256;

/// One resolved image already uploaded to the managed relay, ready to ride the
/// resident's final as a NIP-92 `imeta` tag plus a markdown body line.
///
/// The desktop resolves these itself from the turn's artifact receipts; the
/// field exists on the request so the outbox pins the exact set it froze.
/// Nothing here is bytes — only the content-addressed URL the relay returned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagedFinalAttachmentV1 {
    /// Relay blob URL returned by the media upload.
    pub url: String,
    /// SHA-256 of the exact uploaded bytes.
    pub sha256: Hex64,
    /// Concrete `image/*` media type.
    #[serde(rename = "type")]
    pub mime_type: String,
    /// Exact uploaded byte length.
    pub size: SafeU53,
    /// Relay-computed `"<width>x<height>"`, when the relay returned one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dim: Option<String>,
    /// Relay-computed blurhash, when the relay returned one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blurhash: Option<String>,
    /// Relay-computed thumbnail URL, when the relay returned one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumb: Option<String>,
    /// Display filename, carried for download integrity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
}

/// A tag field may not carry whitespace that would split or wrap the tag.
fn tag_safe(value: &str, max_bytes: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_bytes
        && !value
            .chars()
            .any(|c| c.is_control() || c == '\n' || c == '\r')
}

/// The relay that runs inside the app answers over plain http on the loopback
/// interface; that is the one place an attachment URL may be http.
fn is_loopback_http_url(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("http://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = if let Some(v6) = authority.strip_prefix('[') {
        v6.split(']').next().unwrap_or("")
    } else {
        authority
            .rsplit_once(':')
            .map_or(authority, |(host, _)| host)
    };
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

fn tag_safe_url(value: &str) -> bool {
    tag_safe(value, MAX_ATTACHMENT_URL_BYTES)
        && (value.starts_with("https://") || is_loopback_http_url(value))
        && !value.chars().any(char::is_whitespace)
}

impl ManagedFinalAttachmentV1 {
    /// Validate one attachment against the frozen tag-safety bounds.
    pub fn validate(&self) -> Result<(), MessagePublishError> {
        if !tag_safe_url(&self.url) {
            return Err(MessagePublishError::Attachments);
        }
        if !self.mime_type.starts_with("image/")
            || !tag_safe(&self.mime_type, MAX_ATTACHMENT_MIME_BYTES)
            || self.mime_type.chars().any(char::is_whitespace)
        {
            return Err(MessagePublishError::Attachments);
        }
        if self.size.get() == 0 {
            return Err(MessagePublishError::Attachments);
        }
        if self
            .dim
            .as_ref()
            .is_some_and(|value| !tag_safe(value, MAX_ATTACHMENT_DIM_BYTES))
            || self
                .blurhash
                .as_ref()
                .is_some_and(|value| !tag_safe(value, MAX_ATTACHMENT_BLURHASH_BYTES))
            || self
                .thumb
                .as_ref()
                .is_some_and(|value| !tag_safe_url(value))
            || self
                .filename
                .as_ref()
                .is_some_and(|value| !tag_safe(value, MAX_ATTACHMENT_FILENAME_BYTES))
        {
            return Err(MessagePublishError::Attachments);
        }
        Ok(())
    }
}

/// App-authorized presentation surface for one managed final response.
///
/// This is intentionally independent from the causal NIP-10 references. A
/// timeline response still names the exact owner trigger, but carries the
/// existing `broadcast=1` marker so renderers do not treat it as a thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedResponseSurfaceV1 {
    /// Render the signed final as an ordinary chronological conversation turn.
    Timeline,
    /// Keep the signed final on the explicit Buzz thread surface.
    Thread,
}

/// Validation failure for a managed final-publication request.
#[derive(Debug, thiserror::Error)]
pub enum MessagePublishError {
    /// A validated scalar was invalid.
    #[error(transparent)]
    Value(#[from] ProtocolValueError),
    /// The request named the wrong protocol.
    #[error("protocol must be luca.message.publish.v1")]
    Protocol,
    /// The final draft was empty or exceeded its frozen byte limit.
    #[error("final_draft must contain 1..65536 UTF-8 bytes")]
    FinalDraftSize,
    /// The resolved p-tag set was too large, unsorted, or duplicated.
    #[error("resolved_p_tags must contain at most 64 unique, sorted pubkeys")]
    ResolvedTags,
    /// The provided idempotency key did not match the frozen derivation.
    #[error("idempotency_key does not match dispatch receipt and resident")]
    IdempotencyKey,
    /// `bucket_hint` was outside 1..=10.
    #[error("bucket_hint must be 1..=10")]
    BucketHint,
    /// The resolved attachment set was too large or carried an unusable value.
    #[error("attachments must contain at most 4 bounded https image blobs")]
    Attachments,
}

/// A policy-checked request to publish one accepted final agent message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ManagedMessagePublishRequestV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Accepted ACP turn identifier.
    pub turn_id: OpaqueId,
    /// Stable request idempotency key.
    pub idempotency_key: Hex64,
    /// Luca owner public key.
    pub owner_pubkey: Hex64,
    /// Resident author public key.
    pub resident_pubkey: Hex64,
    /// App-resolved conversation identifier.
    pub conversation_id: OpaqueId,
    /// Optional app-resolved thread identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<OpaqueId>,
    /// Optional Nostr root event ID.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_event_id: Option<Hex64>,
    /// Optional direct reply event ID.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_event_id: Option<Hex64>,
    /// Versioned app-authorized response presentation. Missing on legacy V1
    /// outbox entries and therefore interpreted as the historical thread
    /// behavior during reconciliation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_surface: Option<ManagedResponseSurfaceV1>,
    /// Exact same-owner mention pubkeys, sorted and unique.
    pub resolved_p_tags: Vec<Hex64>,
    /// One bounded final draft produced after successful ACP termination.
    pub final_draft: String,
    /// App-issued dispatch receipt identifier.
    pub dispatch_receipt_id: OpaqueId,
    /// App-owned cancellation epoch.
    pub cancellation_epoch: SafeU53,
    /// The exchange turn this final continues, when the trigger was a sibling's
    /// message inside a speakable exchange: the harness proposes `(id, turn+1)`
    /// and the desktop rechecks against the relay head before tagging.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exchange: Option<ExchangeTurnTag>,
    /// Optional bucket the owner asked for ("spend 5 turns"), honored only when
    /// this final *mints* an exchange; clamped to the ceiling by the desktop.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bucket_hint: Option<u8>,
    /// Images this final carries, already uploaded and resolved by the desktop.
    ///
    /// Empty for every request the ACP harness sends and for every final
    /// published before images could ride a reply, so the field never changes
    /// the canonical bytes of a request that has none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<ManagedFinalAttachmentV1>,
}

impl sealed::Sealed for ManagedMessagePublishRequestV1 {}

impl BrokerOperationV1 for ManagedMessagePublishRequestV1 {
    const OPERATION: OperationV1 = OperationV1::MessagePublish;
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawManagedMessagePublishRequestV1 {
    protocol: String,
    turn_id: OpaqueId,
    idempotency_key: Hex64,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    conversation_id: OpaqueId,
    thread_id: Option<OpaqueId>,
    root_event_id: Option<Hex64>,
    reply_event_id: Option<Hex64>,
    response_surface: Option<ManagedResponseSurfaceV1>,
    resolved_p_tags: Vec<Hex64>,
    final_draft: String,
    dispatch_receipt_id: OpaqueId,
    cancellation_epoch: SafeU53,
    #[serde(default)]
    exchange: Option<ExchangeTurnTag>,
    #[serde(default)]
    bucket_hint: Option<u8>,
    #[serde(default)]
    attachments: Vec<ManagedFinalAttachmentV1>,
}

impl ManagedMessagePublishRequestV1 {
    /// Validate all cross-field M1 invariants.
    pub fn validate(&self) -> Result<(), MessagePublishError> {
        if self.protocol != MESSAGE_PUBLISH_PROTOCOL {
            return Err(MessagePublishError::Protocol);
        }
        let draft_bytes = self.final_draft.len();
        if draft_bytes == 0 || draft_bytes > MAX_FINAL_DRAFT_BYTES {
            return Err(MessagePublishError::FinalDraftSize);
        }
        if self.resolved_p_tags.len() > MAX_RESOLVED_P_TAGS
            || self
                .resolved_p_tags
                .windows(2)
                .any(|pair| pair[0] >= pair[1])
        {
            return Err(MessagePublishError::ResolvedTags);
        }
        let expected = derive_message_publish_idempotency_key(
            &self.dispatch_receipt_id,
            &self.resident_pubkey,
        )?;
        if self.idempotency_key != expected {
            return Err(MessagePublishError::IdempotencyKey);
        }
        if let Some(hint) = self.bucket_hint {
            if hint == 0 || hint > EXCHANGE_BUCKET_CEILING {
                return Err(MessagePublishError::BucketHint);
            }
        }
        if self.attachments.len() > MAX_FINAL_ATTACHMENTS {
            return Err(MessagePublishError::Attachments);
        }
        for attachment in &self.attachments {
            attachment.validate()?;
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for ManagedMessagePublishRequestV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawManagedMessagePublishRequestV1::deserialize(deserializer)?;
        let request = Self {
            protocol: raw.protocol,
            turn_id: raw.turn_id,
            idempotency_key: raw.idempotency_key,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            conversation_id: raw.conversation_id,
            thread_id: raw.thread_id,
            root_event_id: raw.root_event_id,
            reply_event_id: raw.reply_event_id,
            response_surface: raw.response_surface,
            resolved_p_tags: raw.resolved_p_tags,
            final_draft: raw.final_draft,
            dispatch_receipt_id: raw.dispatch_receipt_id,
            cancellation_epoch: raw.cancellation_epoch,
            exchange: raw.exchange,
            bucket_hint: raw.bucket_hint,
            attachments: raw.attachments,
        };
        request.validate().map_err(serde::de::Error::custom)?;
        Ok(request)
    }
}

/// Derive the frozen managed-message idempotency key.
pub fn derive_message_publish_idempotency_key(
    dispatch_receipt_id: &OpaqueId,
    resident_pubkey: &Hex64,
) -> Result<Hex64, ProtocolValueError> {
    let dispatch = dispatch_receipt_id.as_str().as_bytes();
    let dispatch_len = u32::try_from(dispatch.len()).map_err(|_| {
        ProtocolValueError::new_for_internal_use("dispatch receipt ID", "length does not fit u32")
    })?;
    let resident = resident_pubkey.decode()?;
    let mut hasher = Sha256::new();
    hasher.update(b"luca.message.publish.v1\0");
    hasher.update(dispatch_len.to_be_bytes());
    hasher.update(dispatch);
    hasher.update(resident);
    Hex64::parse(hex::encode(hasher.finalize()))
}

/// Body-free response to a managed publication request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum ManagedMessagePublishResultV1 {
    /// The exact event was accepted by the managed relay.
    Published {
        /// Accepted Nostr event ID.
        event_id: Hex64,
        /// SHA-256 of the exact event JSON retained only in the desktop outbox.
        event_sha256: Hex64,
        /// Body-free publication receipt identifier.
        publication_receipt_id: OpaqueId,
    },
    /// A terminal replay returned the previously accepted receipt.
    Replayed {
        /// Previously accepted Nostr event ID.
        event_id: Hex64,
        /// SHA-256 of the exact retained event JSON.
        event_sha256: Hex64,
        /// Original body-free publication receipt identifier.
        publication_receipt_id: OpaqueId,
    },
    /// Cancellation won before relay acceptance.
    Cancelled { code: OpaqueId },
    /// Application policy denied publication.
    Denied { code: OpaqueId },
    /// The typed request was invalid.
    Invalid { code: OpaqueId },
    /// Managed publication was unavailable.
    Unavailable { code: OpaqueId },
}

impl sealed::Sealed for ManagedMessagePublishResultV1 {}

impl BrokerOperationV1 for ManagedMessagePublishResultV1 {
    const OPERATION: OperationV1 = OperationV1::MessagePublish;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attachment() -> ManagedFinalAttachmentV1 {
        ManagedFinalAttachmentV1 {
            url: "https://relay.example/abc.png".into(),
            sha256: Hex64::parse("ab".repeat(32)).unwrap(),
            mime_type: "image/png".into(),
            size: SafeU53::new(1024).unwrap(),
            dim: Some("1024x768".into()),
            blurhash: Some("LEHV6nWB2yk8".into()),
            thumb: Some("https://relay.example/abc-thumb.png".into()),
            filename: Some("chart.png".into()),
        }
    }

    fn request(attachments: Vec<ManagedFinalAttachmentV1>) -> ManagedMessagePublishRequestV1 {
        let dispatch_receipt_id = OpaqueId::parse("dispatch-1").unwrap();
        let resident_pubkey = Hex64::parse("22".repeat(32)).unwrap();
        let idempotency_key =
            derive_message_publish_idempotency_key(&dispatch_receipt_id, &resident_pubkey).unwrap();
        ManagedMessagePublishRequestV1 {
            protocol: MESSAGE_PUBLISH_PROTOCOL.into(),
            turn_id: OpaqueId::parse("turn-1").unwrap(),
            idempotency_key,
            owner_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
            resident_pubkey,
            conversation_id: OpaqueId::parse("conversation-1").unwrap(),
            thread_id: None,
            root_event_id: None,
            reply_event_id: None,
            response_surface: Some(ManagedResponseSurfaceV1::Timeline),
            resolved_p_tags: Vec::new(),
            final_draft: "here it is".into(),
            dispatch_receipt_id,
            cancellation_epoch: SafeU53::new(3).unwrap(),
            exchange: None,
            bucket_hint: None,
            attachments,
        }
    }

    #[test]
    fn a_final_without_attachments_serializes_exactly_as_before() {
        let value = serde_json::to_value(request(Vec::new())).expect("serialize");
        assert!(value.get("attachments").is_none());
    }

    #[test]
    fn four_bounded_image_attachments_are_accepted() {
        let attachments = vec![attachment(), attachment(), attachment(), attachment()];
        request(attachments)
            .validate()
            .expect("four is the ceiling");
    }

    #[test]
    fn a_fifth_attachment_is_refused() {
        let attachments = vec![
            attachment(),
            attachment(),
            attachment(),
            attachment(),
            attachment(),
        ];
        assert!(matches!(
            request(attachments).validate(),
            Err(MessagePublishError::Attachments)
        ));
    }

    #[test]
    fn attachments_must_be_https_images_with_bytes() {
        for mutate in [
            (|a: &mut ManagedFinalAttachmentV1| a.url = "http://relay.example/a.png".into())
                as fn(&mut ManagedFinalAttachmentV1),
            |a| a.url = "buzz-media://a.png".into(),
            |a| a.url = String::new(),
            |a| a.mime_type = "text/plain".into(),
            |a| a.mime_type = "image/svg+xml\nx".into(),
            |a| a.size = SafeU53::new(0).unwrap(),
            |a| a.thumb = Some("http://relay.example/t.png".into()),
            |a| a.dim = Some("1024x768\nurl evil".into()),
            |a| a.filename = Some("a\rb.png".into()),
        ] {
            let mut bad = attachment();
            mutate(&mut bad);
            assert!(
                matches!(
                    request(vec![bad.clone()]).validate(),
                    Err(MessagePublishError::Attachments)
                ),
                "expected refusal for {bad:?}"
            );
        }
    }

    #[test]
    fn attachments_accept_the_local_relay_over_loopback_http() {
        for url in [
            "http://127.0.0.1:57550/media/abc.png",
            "http://localhost:57550/media/abc.png",
            "http://[::1]:57550/media/abc.png",
        ] {
            let mut local = attachment();
            local.url = url.into();
            local.thumb = Some(format!("{url}?thumb=1"));
            assert!(
                request(vec![local.clone()]).validate().is_ok(),
                "expected the local relay to be accepted for {local:?}"
            );
        }
        for url in [
            "http://127.0.0.1.evil.example/media/abc.png",
            "http://localhost.example/media/abc.png",
            "http://10.0.0.7:57550/media/abc.png",
        ] {
            let mut bad = attachment();
            bad.url = url.into();
            assert!(
                matches!(
                    request(vec![bad.clone()]).validate(),
                    Err(MessagePublishError::Attachments)
                ),
                "expected refusal for {bad:?}"
            );
        }
    }

    #[test]
    fn the_raw_struct_round_trips_attachments() {
        let original = request(vec![attachment()]);
        let json = serde_json::to_string(&original).expect("serialize");
        let parsed: ManagedMessagePublishRequestV1 =
            serde_json::from_str(&json).expect("round trip");
        assert_eq!(parsed, original);
        assert_eq!(parsed.attachments.len(), 1);
    }

    #[test]
    fn an_unknown_attachment_field_is_refused() {
        let mut value = serde_json::to_value(request(vec![attachment()])).expect("serialize");
        value["attachments"][0]["luca_handle"] = serde_json::json!("nope");
        assert!(serde_json::from_value::<ManagedMessagePublishRequestV1>(value).is_err());
    }
}
