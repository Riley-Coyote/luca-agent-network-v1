//! F09's bounded ACP-side final-message handoff.
//!
//! A managed resident never publishes stream chunks.  The harness collects
//! only public `agent_message_chunk` text for one accepted turn, then hands one
//! exact final draft to F14's typed [`ManagedSigningClient`].  The client has no
//! generic signing operation and no resident secret.

use std::sync::Arc;

use luca_protocol::{
    derive_message_publish_idempotency_key, Hex64, ManagedMessagePublishRequestV1,
    ManagedMessagePublishResultV1, OpaqueId, SafeU53, MAX_FINAL_DRAFT_BYTES,
    MESSAGE_PUBLISH_PROTOCOL,
};
use luca_signing_client::{ManagedSigningClient, SigningClientError};
use nostr::Event;
use uuid::Uuid;

/// Managed-only broker capability retained by the ACP host, never an ACP
/// model child. The desktop still independently authorizes every request.
#[derive(Clone)]
pub struct ManagedFinalPublisherContext {
    pub broker: Arc<ManagedSigningClient>,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    /// Desktop-minted runtime epoch bound to the inherited broker channel.
    pub session_epoch: SafeU53,
}

/// One accepted turn's immutable app-resolved publication destination.
#[derive(Debug, Clone)]
pub struct ManagedFinalTurn {
    /// Accepted ACP turn identity.
    pub turn_id: OpaqueId,
    /// App-issued dispatch receipt for this exact accepted turn.
    pub dispatch_receipt_id: OpaqueId,
    /// Desktop-owned cancellation epoch captured at dispatch.
    pub cancellation_epoch: SafeU53,
    /// Owner identity used by the desktop broker policy.
    pub owner_pubkey: Hex64,
    /// Resident public identity bound to the F14 broker.
    pub resident_pubkey: Hex64,
    /// App-resolved channel or direct-conversation ID.
    pub conversation_id: OpaqueId,
    /// App-resolved thread ID, if any.
    pub thread_id: Option<OpaqueId>,
    /// Exact Nostr thread root, if any.
    pub root_event_id: Option<Hex64>,
    /// Exact Nostr reply parent, if any.
    pub reply_event_id: Option<Hex64>,
    /// App-resolved recipient/mention identities.
    pub resolved_p_tags: Vec<Hex64>,
}

/// Failure before the F14 typed broker receives a publication request.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum FinalPublicationError {
    /// A chunk sequence exceeded the protocol's final-draft limit.
    #[error("managed final draft exceeds the protocol byte limit")]
    TooLarge,
    /// A cancelled turn cannot hand off a final message.
    #[error("managed turn was cancelled before final publication")]
    Cancelled,
    /// A successful turn with no visible final message must not publish blank content.
    #[error("managed turn produced no final message chunks")]
    Empty,
    /// App-resolved publication context was not protocol-valid.
    #[error("managed final publication context is invalid: {0}")]
    Invalid(String),
    /// The session-bound F14 broker rejected or could not complete the handoff.
    #[error("managed signing broker failed: {0}")]
    Broker(String),
}

/// Bounded accumulator for one ACP `agent_message_chunk` stream.
///
/// Call [`reset`](Self::reset) before each prompt. Thought, tool, and user
/// chunks are deliberately never accepted here, so they cannot leak into a
/// public final reply.
#[derive(Debug, Default, Clone)]
pub struct FinalChunkAccumulator {
    final_draft: String,
}

impl FinalChunkAccumulator {
    /// Start a new accepted-turn accumulation.
    pub fn reset(&mut self) {
        self.final_draft.clear();
    }

    /// Record one `agent_message_chunk` exactly in observed order.
    pub fn push_agent_message_chunk(&mut self, chunk: &str) -> Result<(), FinalPublicationError> {
        let new_len = self
            .final_draft
            .len()
            .checked_add(chunk.len())
            .ok_or(FinalPublicationError::TooLarge)?;
        if new_len > MAX_FINAL_DRAFT_BYTES {
            return Err(FinalPublicationError::TooLarge);
        }
        self.final_draft.push_str(chunk);
        Ok(())
    }

    /// Consume the one final draft after ACP reports normal completion.
    pub fn finish(self, cancelled: bool) -> Result<String, FinalPublicationError> {
        if cancelled {
            return Err(FinalPublicationError::Cancelled);
        }
        if self.final_draft.is_empty() {
            return Err(FinalPublicationError::Empty);
        }
        Ok(self.final_draft)
    }
}

impl ManagedFinalTurn {
    /// Derive immutable routing from the exact last signed event accepted in
    /// the flush batch. Model output is never used for recipient or thread
    /// routing. The event ID is the relay-verifiable dispatch receipt.
    pub fn from_triggering_event(
        context: &ManagedFinalPublisherContext,
        turn_id: &str,
        conversation_id: Uuid,
        event: &Event,
    ) -> Result<Self, FinalPublicationError> {
        if !event.verify_id()
            || !event.verify_signature()
            || event.kind != nostr::Kind::Custom(9)
            || event.pubkey.to_hex() != context.owner_pubkey.as_str()
        {
            return Err(FinalPublicationError::Invalid(
                "trigger must be the configured owner's valid signed kind:9 event".into(),
            ));
        }
        for marker in ["root", "reply"] {
            let mut tagged_ids = event.tags.iter().filter_map(|tag| {
                let parts = tag.as_slice();
                (parts.first().map(String::as_str) == Some("e")
                    && parts.get(3).map(String::as_str) == Some(marker))
                .then(|| parts.get(1).cloned())
                .flatten()
            });
            if let Some(first) = tagged_ids.next() {
                if tagged_ids.any(|candidate| candidate != first) {
                    return Err(FinalPublicationError::Invalid(format!(
                        "trigger has ambiguous {marker} thread tags"
                    )));
                }
            }
        }
        let turn_id = OpaqueId::parse(turn_id)
            .map_err(|error| FinalPublicationError::Invalid(error.to_string()))?;
        let conversation_id = OpaqueId::parse(conversation_id.to_string())
            .map_err(|error| FinalPublicationError::Invalid(error.to_string()))?;
        let event_id = Hex64::parse(event.id.to_hex())
            .map_err(|error| FinalPublicationError::Invalid(error.to_string()))?;
        let dispatch_receipt_id = OpaqueId::parse(event_id.as_str())
            .map_err(|error| FinalPublicationError::Invalid(error.to_string()))?;
        let cancellation_epoch = context.session_epoch;
        let thread = crate::queue::parse_thread_tags(event);
        let root_event_id = thread
            .root_event_id
            .as_deref()
            .map(Hex64::parse)
            .transpose()
            .map_err(|error| FinalPublicationError::Invalid(error.to_string()))?
            .or_else(|| Some(event_id.clone()));
        let reply_event_id = thread
            .parent_event_id
            .as_deref()
            .map(Hex64::parse)
            .transpose()
            .map_err(|error| FinalPublicationError::Invalid(error.to_string()))?
            .or_else(|| Some(event_id.clone()));
        let thread_id = root_event_id
            .as_ref()
            .map(|root| OpaqueId::parse(format!("thread:{}", root.as_str())))
            .transpose()
            .map_err(|error| FinalPublicationError::Invalid(error.to_string()))?;
        let mut resolved_p_tags = vec![Hex64::parse(event.pubkey.to_hex())
            .map_err(|error| FinalPublicationError::Invalid(error.to_string()))?];
        resolved_p_tags.sort();
        resolved_p_tags.dedup();
        Ok(Self {
            turn_id,
            dispatch_receipt_id,
            cancellation_epoch,
            owner_pubkey: context.owner_pubkey.clone(),
            resident_pubkey: context.resident_pubkey.clone(),
            conversation_id,
            thread_id,
            root_event_id,
            reply_event_id,
            resolved_p_tags,
        })
    }

    /// Build the only managed final-message request accepted by the desktop.
    pub fn request(
        &self,
        final_draft: String,
    ) -> Result<ManagedMessagePublishRequestV1, FinalPublicationError> {
        let idempotency_key = derive_message_publish_idempotency_key(
            &self.dispatch_receipt_id,
            &self.resident_pubkey,
        )
        .map_err(|error| FinalPublicationError::Invalid(error.to_string()))?;
        let request = ManagedMessagePublishRequestV1 {
            protocol: MESSAGE_PUBLISH_PROTOCOL.to_owned(),
            turn_id: self.turn_id.clone(),
            idempotency_key,
            owner_pubkey: self.owner_pubkey.clone(),
            resident_pubkey: self.resident_pubkey.clone(),
            conversation_id: self.conversation_id.clone(),
            thread_id: self.thread_id.clone(),
            root_event_id: self.root_event_id.clone(),
            reply_event_id: self.reply_event_id.clone(),
            resolved_p_tags: self.resolved_p_tags.clone(),
            final_draft,
            dispatch_receipt_id: self.dispatch_receipt_id.clone(),
            cancellation_epoch: self.cancellation_epoch,
        };
        request
            .validate()
            .map_err(|error| FinalPublicationError::Invalid(error.to_string()))?;
        Ok(request)
    }

    /// Hand one finalized ACP response to F14's session-bound signing client.
    ///
    /// The returned receipt is body-free.  `Published` means relay acceptance
    /// was observed by desktop authority; `Replayed` means the same accepted
    /// exact event was reconciled after reconnect/restart. Other states are
    /// intentionally left explicit for the caller to handle honestly.
    pub async fn handoff(
        &self,
        broker: Arc<ManagedSigningClient>,
        final_draft: String,
        now_unix_ms: u64,
    ) -> Result<ManagedMessagePublishResultV1, FinalPublicationError> {
        let request = self.request(final_draft)?;
        broker
            .message_publish(request, now_unix_ms)
            .await
            .map_err(|error: SigningClientError| FinalPublicationError::Broker(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(value: char) -> Hex64 {
        Hex64::parse(value.to_string().repeat(64)).expect("fixture hex")
    }

    fn id(value: &str) -> OpaqueId {
        OpaqueId::parse(value).expect("fixture opaque ID")
    }

    fn turn(root: Option<Hex64>, reply: Option<Hex64>, p_tags: Vec<Hex64>) -> ManagedFinalTurn {
        ManagedFinalTurn {
            turn_id: id("turn-1"),
            dispatch_receipt_id: id("dispatch-1"),
            cancellation_epoch: SafeU53::new(7).expect("fixture epoch"),
            owner_pubkey: hex('a'),
            resident_pubkey: hex('b'),
            conversation_id: id("conversation-1"),
            thread_id: Some(id("thread-1")),
            root_event_id: root,
            reply_event_id: reply,
            resolved_p_tags: p_tags,
        }
    }

    #[test]
    fn luca_f09_stream_chunks_become_one_final_draft_in_order() {
        let mut chunks = FinalChunkAccumulator::default();
        chunks
            .push_agent_message_chunk("hello ")
            .expect("chunk one");
        chunks.push_agent_message_chunk("world").expect("chunk two");
        assert_eq!(chunks.finish(false).expect("final"), "hello world");
    }

    #[test]
    fn luca_f09_cancelled_stream_never_hands_off_a_final_message() {
        let mut chunks = FinalChunkAccumulator::default();
        chunks.push_agent_message_chunk("partial").expect("chunk");
        assert_eq!(chunks.finish(true), Err(FinalPublicationError::Cancelled));
    }

    #[test]
    fn luca_f09_reconnect_replay_and_restart_keep_the_same_typed_request() {
        let turn = turn(Some(hex('c')), Some(hex('d')), vec![hex('a'), hex('e')]);
        let first = turn.request("final reply".into()).expect("first request");
        let restarted = turn
            .request("final reply".into())
            .expect("restarted request");
        assert_eq!(first, restarted, "replay/restart must reuse exact request");
    }

    #[test]
    fn luca_f09_direct_chat_preserves_single_reply_anchor() {
        let anchor = hex('c');
        let request = turn(Some(anchor.clone()), Some(anchor.clone()), vec![hex('a')])
            .request("direct reply".into())
            .expect("direct request");
        assert_eq!(request.root_event_id, Some(anchor.clone()));
        assert_eq!(request.reply_event_id, Some(anchor));
    }

    #[test]
    fn luca_f09_room_reply_preserves_root_parent_and_sorted_recipient_tags() {
        let request = turn(
            Some(hex('c')),
            Some(hex('d')),
            vec![hex('a'), hex('e'), hex('f')],
        )
        .request("room reply".into())
        .expect("room request");
        assert_eq!(request.root_event_id, Some(hex('c')));
        assert_eq!(request.reply_event_id, Some(hex('d')));
        assert_eq!(request.resolved_p_tags, vec![hex('a'), hex('e'), hex('f')]);
    }
}
