//! F09's bounded ACP-side final-message handoff.
//!
//! A managed resident never publishes stream chunks.  The harness collects
//! only public `agent_message_chunk` text for one accepted turn, removes a
//! narrowly recognized adapter-generated preamble, then hands one final draft
//! to F14's typed [`ManagedSigningClient`]. The client has no generic signing
//! operation and no resident secret.

use std::sync::Arc;

use luca_protocol::{
    derive_message_publish_idempotency_key, Hex64, ManagedMessagePublishRequestV1,
    ManagedMessagePublishResultV1, OpaqueId, SafeU53, MAX_FINAL_DRAFT_BYTES,
    MESSAGE_PUBLISH_PROTOCOL,
};
use luca_signing_client::{ManagedSigningClient, SigningClientError};
use nostr::Event;
use uuid::Uuid;

const CODEX_SKILL_CONTEXT_NOTICE: &str = "Warning: Skill descriptions were shortened to fit the 2% skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.";

fn strip_runtime_notice_preamble(final_draft: String) -> String {
    let Some(remainder) = final_draft.strip_prefix(CODEX_SKILL_CONTEXT_NOTICE) else {
        return final_draft;
    };
    if remainder.is_empty() {
        return String::new();
    }
    if !remainder.starts_with('\n') {
        return final_draft;
    }
    remainder.trim_start().to_owned()
}

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
    ///
    /// A known Codex adapter preamble is operational status rather than model
    /// content. It is removed only when it exactly prefixes the response.
    pub fn finish(self, cancelled: bool) -> Result<String, FinalPublicationError> {
        if cancelled {
            return Err(FinalPublicationError::Cancelled);
        }
        let final_draft = strip_runtime_notice_preamble(self.final_draft);
        if final_draft.is_empty() {
            return Err(FinalPublicationError::Empty);
        }
        Ok(final_draft)
    }
}

impl ManagedFinalTurn {
    /// Frozen F09 admission rule for choosing a triggering event. F10 may
    /// extend this to same-owner descendants; V1 intentionally admits only
    /// the configured owner's valid signed kind:9 events.
    pub fn is_eligible_trigger(owner_pubkey: &Hex64, event: &Event) -> bool {
        event.verify_id()
            && event.verify_signature()
            && event.kind == nostr::Kind::Custom(9)
            && event.pubkey.to_hex() == owner_pubkey.as_str()
    }

    /// Derive immutable routing from the exact last signed event accepted in
    /// the flush batch. Model output is never used for recipient or thread
    /// routing. The event ID is the relay-verifiable dispatch receipt.
    pub fn from_triggering_event(
        context: &ManagedFinalPublisherContext,
        turn_id: &str,
        conversation_id: Uuid,
        event: &Event,
    ) -> Result<Self, FinalPublicationError> {
        if !Self::is_eligible_trigger(&context.owner_pubkey, event) {
            return Err(FinalPublicationError::Invalid(
                "trigger must be the configured owner's valid signed kind:9 event".into(),
            ));
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
        let (root_event_id, reply_event_id) =
            strict_trigger_routing(&conversation_id, event, &event_id)?;
        let thread_id = root_event_id
            .as_ref()
            .map(|root| OpaqueId::parse(format!("thread:{}", root.as_str())))
            .transpose()
            .map_err(|error| FinalPublicationError::Invalid(error.to_string()))?;
        // F09 owner-only routing deliberately ignores every trigger p-tag.
        // Only the verified owner-author is retained, so an ACP/model child
        // cannot expand recipients or invoke a same-owner descendant before F10.
        let resolved_p_tags = owner_only_p_tags(event)?;
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

fn strict_trigger_routing(
    conversation_id: &OpaqueId,
    event: &Event,
    trigger_id: &Hex64,
) -> Result<(Option<Hex64>, Option<Hex64>), FinalPublicationError> {
    let mut h_value: Option<&str> = None;
    let mut root: Option<Hex64> = None;
    let mut reply: Option<Hex64> = None;

    for tag in event.tags.iter() {
        let parts = tag.as_slice();
        match parts.first().map(String::as_str) {
            Some("h") => {
                if parts.len() != 2 || h_value.is_some() {
                    return Err(FinalPublicationError::Invalid(
                        "trigger must contain exactly one well-formed h tag".into(),
                    ));
                }
                h_value = parts.get(1).map(String::as_str);
            }
            Some("e") => {
                if parts.len() != 4 {
                    return Err(FinalPublicationError::Invalid(
                        "trigger contains a malformed or unmarked e tag".into(),
                    ));
                }
                let id = Hex64::parse(parts[1].clone())
                    .map_err(|error| FinalPublicationError::Invalid(error.to_string()))?;
                match parts[3].as_str() {
                    "root" if root.is_none() => root = Some(id),
                    "reply" if reply.is_none() => reply = Some(id),
                    "root" | "reply" => {
                        return Err(FinalPublicationError::Invalid(
                            "trigger contains duplicate thread markers".into(),
                        ));
                    }
                    _ => {
                        return Err(FinalPublicationError::Invalid(
                            "trigger contains a malformed or unmarked e tag".into(),
                        ));
                    }
                }
            }
            _ => {}
        }
    }
    if h_value != Some(conversation_id.as_str()) {
        return Err(FinalPublicationError::Invalid(
            "trigger h tag does not match the conversation".into(),
        ));
    }
    match (root, reply) {
        (None, None) => Ok((Some(trigger_id.clone()), Some(trigger_id.clone()))),
        (None, Some(reply)) => Ok((Some(reply.clone()), Some(reply))),
        (Some(root), Some(reply)) => Ok((Some(root), Some(reply))),
        (Some(_), None) => Err(FinalPublicationError::Invalid(
            "trigger root tag requires exactly one reply tag".into(),
        )),
    }
}

fn owner_only_p_tags(event: &Event) -> Result<Vec<Hex64>, FinalPublicationError> {
    Ok(vec![Hex64::parse(event.pubkey.to_hex()).map_err(
        |error| FinalPublicationError::Invalid(error.to_string()),
    )?])
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};

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

    fn signed_trigger(keys: &Keys, conversation: &str, extra_tags: Vec<Tag>) -> Event {
        let mut tags = vec![Tag::parse(["h", conversation]).expect("h tag")];
        tags.extend(extra_tags);
        EventBuilder::new(Kind::Custom(9), "trigger")
            .tags(tags)
            .sign_with_keys(keys)
            .expect("signed trigger")
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
    fn luca_f09_runtime_notice_is_not_published_as_conversation_text() {
        let mut chunks = FinalChunkAccumulator::default();
        chunks
            .push_agent_message_chunk(CODEX_SKILL_CONTEXT_NOTICE)
            .expect("notice");
        chunks
            .push_agent_message_chunk("\n\nThe useful answer.")
            .expect("answer");
        assert_eq!(chunks.finish(false).expect("final"), "The useful answer.");
    }

    #[test]
    fn luca_f09_runtime_notice_filter_is_exact_and_prefix_only() {
        let quoted = format!("A quoted diagnostic:\n{CODEX_SKILL_CONTEXT_NOTICE}");
        let mut chunks = FinalChunkAccumulator::default();
        chunks
            .push_agent_message_chunk(&quoted)
            .expect("quoted notice");
        assert_eq!(chunks.finish(false).expect("final"), quoted);
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

    #[test]
    fn luca_f09_strict_routing_rejects_duplicate_or_unmarked_thread_tags() {
        let keys = Keys::generate();
        let conversation = id("conversation-1");
        let duplicate = signed_trigger(
            &keys,
            conversation.as_str(),
            vec![
                Tag::parse(["e", &"11".repeat(32), "", "reply"]).expect("reply"),
                Tag::parse(["e", &"22".repeat(32), "", "reply"]).expect("reply"),
            ],
        );
        let trigger_id = Hex64::parse(duplicate.id.to_hex()).expect("trigger id");
        assert!(strict_trigger_routing(&conversation, &duplicate, &trigger_id).is_err());

        let unmarked = signed_trigger(
            &keys,
            conversation.as_str(),
            vec![Tag::parse(["e", &"33".repeat(32), ""]).expect("unmarked")],
        );
        let trigger_id = Hex64::parse(unmarked.id.to_hex()).expect("trigger id");
        assert!(strict_trigger_routing(&conversation, &unmarked, &trigger_id).is_err());
    }

    #[test]
    fn luca_f09_owner_only_policy_ignores_trigger_p_tags() {
        let owner = Keys::generate();
        let resident = Keys::generate();
        let resident_pubkey = resident.public_key().to_hex();
        let trigger = signed_trigger(
            &owner,
            "conversation-1",
            vec![Tag::parse(["p", resident_pubkey.as_str()]).expect("p tag")],
        );
        let owner_hex = Hex64::parse(owner.public_key().to_hex()).expect("owner");
        let resident_hex = Hex64::parse(resident.public_key().to_hex()).expect("resident");
        assert!(ManagedFinalTurn::is_eligible_trigger(&owner_hex, &trigger));
        assert_ne!(owner_hex, resident_hex);
        assert_eq!(
            owner_only_p_tags(&trigger).expect("owner-only routing"),
            vec![owner_hex]
        );
    }
}
