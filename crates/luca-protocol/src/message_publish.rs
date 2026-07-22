//! Typed managed-final-publication request and body-free result.

use crate::{Hex64, OpaqueId, ProtocolValueError, SafeU53};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};

/// Managed final-publication protocol identifier.
pub const MESSAGE_PUBLISH_PROTOCOL: &str = "luca.message.publish.v1";
/// Maximum UTF-8 byte length of an accepted final draft.
pub const MAX_FINAL_DRAFT_BYTES: usize = 65_536;
/// Maximum number of exact resolved `p` tags.
pub const MAX_RESOLVED_P_TAGS: usize = 64;

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
    /// Exact same-owner mention pubkeys, sorted and unique.
    pub resolved_p_tags: Vec<Hex64>,
    /// One bounded final draft produced after successful ACP termination.
    pub final_draft: String,
    /// App-issued dispatch receipt identifier.
    pub dispatch_receipt_id: OpaqueId,
    /// App-owned cancellation epoch.
    pub cancellation_epoch: SafeU53,
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
    resolved_p_tags: Vec<Hex64>,
    final_draft: String,
    dispatch_receipt_id: OpaqueId,
    cancellation_epoch: SafeU53,
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
            resolved_p_tags: raw.resolved_p_tags,
            final_draft: raw.final_draft,
            dispatch_receipt_id: raw.dispatch_receipt_id,
            cancellation_epoch: raw.cancellation_epoch,
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
