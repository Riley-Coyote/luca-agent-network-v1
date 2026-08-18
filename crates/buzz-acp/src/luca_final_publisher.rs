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
    ManagedMessagePublishResultV1, ManagedResponseSurfaceV1, OpaqueId, SafeU53,
    MAX_FINAL_DRAFT_BYTES, MESSAGE_PUBLISH_PROTOCOL,
};
use luca_signing_client::{ManagedSigningClient, SigningClientError};
use nostr::Event;
use uuid::Uuid;

pub(crate) const CODEX_SKILL_CONTEXT_NOTICE: &str = "Warning: Skill descriptions were shortened to fit the 2% skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.";
pub(crate) const CODEX_SKILL_BUDGET_NOTICE_PREFIX: &str =
    "Warning: Exceeded skills context budget of 2%.";
pub(crate) const CODEX_SKILL_BUDGET_NOTICE_SUFFIX: &str = "model-visible skills list.";

/// Exact acknowledgement for a successful, action-only Buzz tool turn. The
/// managed presentation and final publisher consume it locally; it is never
/// rendered or submitted to the relay.
pub(crate) const SILENT_ACTION_SENTINEL: &str = "LUCA_ACTION_COMPLETE";

fn strip_runtime_notice_preamble(final_draft: String) -> String {
    if let Some(remainder) = final_draft.strip_prefix(CODEX_SKILL_CONTEXT_NOTICE) {
        if remainder.is_empty() {
            return String::new();
        }
        if remainder.starts_with('\n') || remainder == SILENT_ACTION_SENTINEL {
            return remainder.trim_start().to_owned();
        }
    }
    if final_draft.starts_with(CODEX_SKILL_BUDGET_NOTICE_PREFIX) {
        if let Some(suffix_start) = final_draft.find(CODEX_SKILL_BUDGET_NOTICE_SUFFIX) {
            let remainder = &final_draft[suffix_start + CODEX_SKILL_BUDGET_NOTICE_SUFFIX.len()..];
            if remainder.is_empty() {
                return String::new();
            }
            if remainder.starts_with('\n') || remainder == SILENT_ACTION_SENTINEL {
                return remainder.trim_start().to_owned();
            }
        }
    }
    final_draft
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
    /// App-derived response surface. Model output cannot select this value.
    pub response_surface: ManagedResponseSurfaceV1,
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

/// Paragraph break inserted when public text resumes after a tool call or plan.
pub(crate) const PUBLIC_TEXT_PARAGRAPH_SEPARATOR: &str = "\n\n";

/// The one shared rule for joining public `agent_message_chunk` text.
///
/// ACP adapters emit a resumed message as just another `agent_message_chunk`,
/// with no boundary of its own, so text written before a tool call glues onto
/// text written after it ("I'm checking.It's 3:55 AM."). A tool/plan update
/// between two public chunks marks a boundary; the next non-empty public chunk
/// consumes it and resumes as a new paragraph.
///
/// Both the signed final draft ([`FinalChunkAccumulator`]) and the streamed
/// managed presentation drive this same type over the same raw update
/// sequence, so the desktop's stream-versus-signed reconciliation still sees
/// two identical texts.
#[derive(Debug, Default, Clone)]
pub(crate) struct PublicTextJoiner {
    /// Last character of the joined text so far. `None` before the first chunk.
    tail: Option<char>,
    /// A tool/plan update has been seen since the last public chunk.
    boundary_pending: bool,
}

impl PublicTextJoiner {
    /// Start a new turn.
    pub(crate) fn reset(&mut self) {
        *self = Self::default();
    }

    /// Record a `tool_call`, `tool_call_update`, or `plan` update.
    ///
    /// Idempotent: repeated markers before the next public chunk are one
    /// boundary. A marker before any public text is not a boundary at all —
    /// nothing precedes it to separate from.
    pub(crate) fn mark_boundary(&mut self) {
        if self.tail.is_some() {
            self.boundary_pending = true;
        }
    }

    /// Separator to insert before `chunk`, consuming any pending boundary.
    ///
    /// Empty unless public text is resuming after a tool/plan boundary, and
    /// even then empty when either side already supplies the break — so a
    /// single blank line is the most this ever produces.
    pub(crate) fn separator_for(&mut self, chunk: &str) -> &'static str {
        if chunk.is_empty() {
            return "";
        }
        let resumed = std::mem::take(&mut self.boundary_pending);
        let tail = self.tail.replace(
            chunk
                .chars()
                .next_back()
                .expect("non-empty chunk has a last character"),
        );
        match tail {
            Some(previous)
                if resumed
                    && !previous.is_whitespace()
                    && !chunk.starts_with(char::is_whitespace) =>
            {
                PUBLIC_TEXT_PARAGRAPH_SEPARATOR
            }
            _ => "",
        }
    }
}

/// Bounded accumulator for one ACP `agent_message_chunk` stream.
///
/// Call [`reset`](Self::reset) before each prompt. Thought, tool, and user
/// chunks are deliberately never accepted here, so they cannot leak into a
/// public final reply.
#[derive(Debug, Default, Clone)]
pub struct FinalChunkAccumulator {
    final_draft: String,
    joiner: PublicTextJoiner,
}

impl FinalChunkAccumulator {
    /// Start a new accepted-turn accumulation.
    pub fn reset(&mut self) {
        self.final_draft.clear();
        self.joiner.reset();
    }

    /// Record a tool/plan update observed between public chunks.
    ///
    /// The boundary is only consumed when public text actually resumes, so
    /// silent turns and repeated status updates change nothing.
    pub fn mark_public_text_boundary(&mut self) {
        self.joiner.mark_boundary();
    }

    /// Record one `agent_message_chunk` exactly in observed order.
    pub fn push_agent_message_chunk(&mut self, chunk: &str) -> Result<(), FinalPublicationError> {
        let separator = self.joiner.separator_for(chunk);
        let new_len = self
            .final_draft
            .len()
            .checked_add(separator.len())
            .and_then(|length| length.checked_add(chunk.len()))
            .ok_or(FinalPublicationError::TooLarge)?;
        if new_len > MAX_FINAL_DRAFT_BYTES {
            return Err(FinalPublicationError::TooLarge);
        }
        self.final_draft.push_str(separator);
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
        let (root_event_id, reply_event_id, response_surface) =
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
            response_surface,
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
            response_surface: Some(self.response_surface),
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
) -> Result<(Option<Hex64>, Option<Hex64>, ManagedResponseSurfaceV1), FinalPublicationError> {
    let mut h_value: Option<&str> = None;
    let mut root: Option<Hex64> = None;
    let mut reply: Option<Hex64> = None;
    let mut broadcast = false;

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
            Some("broadcast") => {
                if parts.len() != 2 || parts[1] != "1" || broadcast {
                    return Err(FinalPublicationError::Invalid(
                        "trigger contains an invalid broadcast marker".into(),
                    ));
                }
                broadcast = true;
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
        (None, None) => Ok((
            Some(trigger_id.clone()),
            Some(trigger_id.clone()),
            ManagedResponseSurfaceV1::Timeline,
        )),
        (None, Some(reply)) => Ok((
            Some(reply.clone()),
            Some(reply),
            if broadcast {
                ManagedResponseSurfaceV1::Timeline
            } else {
                ManagedResponseSurfaceV1::Thread
            },
        )),
        (Some(root), Some(reply)) => Ok((
            Some(root),
            Some(reply),
            if broadcast {
                ManagedResponseSurfaceV1::Timeline
            } else {
                ManagedResponseSurfaceV1::Thread
            },
        )),
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
            response_surface: ManagedResponseSurfaceV1::Thread,
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
    fn public_text_joiner_never_separates_consecutive_chunks_of_one_message() {
        let mut joiner = PublicTextJoiner::default();
        assert_eq!(joiner.separator_for("hello "), "");
        assert_eq!(joiner.separator_for("world"), "");
    }

    #[test]
    fn public_text_joiner_separates_text_resumed_after_a_tool_call() {
        let mut joiner = PublicTextJoiner::default();
        assert_eq!(
            joiner.separator_for("I'm checking the live local time."),
            ""
        );
        joiner.mark_boundary();
        assert_eq!(
            joiner.separator_for("It's 3:55 AM CDT for me."),
            PUBLIC_TEXT_PARAGRAPH_SEPARATOR
        );
    }

    #[test]
    fn public_text_joiner_never_produces_more_than_one_blank_line() {
        let mut trailing = PublicTextJoiner::default();
        assert_eq!(trailing.separator_for("Checking.\n"), "");
        trailing.mark_boundary();
        assert_eq!(trailing.separator_for("Done."), "");

        let mut leading = PublicTextJoiner::default();
        assert_eq!(leading.separator_for("Checking."), "");
        leading.mark_boundary();
        assert_eq!(leading.separator_for("\n\nDone."), "");

        let mut spaced = PublicTextJoiner::default();
        assert_eq!(spaced.separator_for("Checking."), "");
        spaced.mark_boundary();
        assert_eq!(spaced.separator_for(" Done."), "");
    }

    #[test]
    fn public_text_joiner_ignores_a_boundary_before_any_public_text() {
        let mut joiner = PublicTextJoiner::default();
        joiner.mark_boundary();
        assert_eq!(joiner.separator_for("First words."), "");
    }

    #[test]
    fn public_text_joiner_treats_repeated_markers_as_one_boundary() {
        let mut joiner = PublicTextJoiner::default();
        assert_eq!(joiner.separator_for("Working."), "");
        joiner.mark_boundary();
        joiner.mark_boundary();
        joiner.mark_boundary();
        assert_eq!(
            joiner.separator_for("Done."),
            PUBLIC_TEXT_PARAGRAPH_SEPARATOR
        );
        joiner.mark_boundary();
        assert_eq!(joiner.separator_for(""), "");
        assert_eq!(
            joiner.separator_for("Still pending."),
            PUBLIC_TEXT_PARAGRAPH_SEPARATOR
        );
    }

    #[test]
    fn luca_f09_text_resumed_after_a_tool_call_is_not_glued_to_the_previous_sentence() {
        let mut chunks = FinalChunkAccumulator::default();
        chunks
            .push_agent_message_chunk("I'm checking the live local time.")
            .expect("first sentence");
        chunks.mark_public_text_boundary();
        chunks
            .push_agent_message_chunk("It's 3:55 AM CDT for me.")
            .expect("resumed sentence");
        assert_eq!(
            chunks.finish(false).expect("final"),
            "I'm checking the live local time.\n\nIt's 3:55 AM CDT for me."
        );
    }

    #[test]
    fn luca_f09_runtime_notice_is_still_stripped_when_a_tool_call_follows_it() {
        let mut chunks = FinalChunkAccumulator::default();
        chunks
            .push_agent_message_chunk(CODEX_SKILL_CONTEXT_NOTICE)
            .expect("notice");
        chunks.mark_public_text_boundary();
        chunks
            .push_agent_message_chunk("The useful answer.")
            .expect("answer");
        assert_eq!(chunks.finish(false).expect("final"), "The useful answer.");
    }

    #[test]
    fn luca_f09_reset_clears_the_pending_public_text_boundary() {
        let mut chunks = FinalChunkAccumulator::default();
        chunks.push_agent_message_chunk("Old turn.").expect("chunk");
        chunks.mark_public_text_boundary();
        chunks.reset();
        chunks.push_agent_message_chunk("New turn.").expect("chunk");
        assert_eq!(chunks.finish(false).expect("final"), "New turn.");
    }

    #[test]
    fn luca_f09_boundary_separator_counts_against_the_final_draft_byte_limit() {
        let filler = "a".repeat(MAX_FINAL_DRAFT_BYTES - 1);

        let mut exact = FinalChunkAccumulator::default();
        exact.push_agent_message_chunk(&filler).expect("filler");
        exact.push_agent_message_chunk("b").expect("fits exactly");

        let mut separated = FinalChunkAccumulator::default();
        separated.push_agent_message_chunk(&filler).expect("filler");
        separated.mark_public_text_boundary();
        assert_eq!(
            separated.push_agent_message_chunk("b"),
            Err(FinalPublicationError::TooLarge)
        );
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
    fn luca_f09_silent_action_marker_survives_capture_for_local_consumption() {
        let mut chunks = FinalChunkAccumulator::default();
        chunks
            .push_agent_message_chunk(SILENT_ACTION_SENTINEL)
            .expect("silent marker");
        assert_eq!(
            chunks.finish(false).expect("captured marker"),
            SILENT_ACTION_SENTINEL
        );
    }

    #[test]
    fn luca_f09_variable_skill_budget_notice_is_removed_before_silent_completion() {
        let draft = format!(
            "Warning: Exceeded skills context budget of 2%. All skill descriptions were removed and 1 additional skill was not included in the model-visible skills list.{SILENT_ACTION_SENTINEL}"
        );
        assert_eq!(strip_runtime_notice_preamble(draft), SILENT_ACTION_SENTINEL);
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
    fn luca_f09_top_level_and_broadcast_replies_use_the_timeline_surface() {
        let keys = Keys::generate();
        let conversation = id("conversation-1");
        let top_level = signed_trigger(&keys, conversation.as_str(), Vec::new());
        let top_id = Hex64::parse(top_level.id.to_hex()).expect("top-level id");
        let (root, reply, surface) =
            strict_trigger_routing(&conversation, &top_level, &top_id).expect("top-level route");
        assert_eq!(root, Some(top_id.clone()));
        assert_eq!(reply, Some(top_id));
        assert_eq!(surface, ManagedResponseSurfaceV1::Timeline);

        let reply_id = "44".repeat(32);
        let broadcast = signed_trigger(
            &keys,
            conversation.as_str(),
            vec![
                Tag::parse(["e", reply_id.as_str(), "", "reply"]).expect("reply"),
                Tag::parse(["broadcast", "1"]).expect("broadcast"),
            ],
        );
        let broadcast_id = Hex64::parse(broadcast.id.to_hex()).expect("broadcast id");
        let (_, _, surface) = strict_trigger_routing(&conversation, &broadcast, &broadcast_id)
            .expect("broadcast route");
        assert_eq!(surface, ManagedResponseSurfaceV1::Timeline);
    }

    #[test]
    fn luca_f09_explicit_thread_reply_uses_the_thread_surface() {
        let keys = Keys::generate();
        let conversation = id("conversation-1");
        let root_id = "55".repeat(32);
        let reply_id = "66".repeat(32);
        let thread = signed_trigger(
            &keys,
            conversation.as_str(),
            vec![
                Tag::parse(["e", root_id.as_str(), "", "root"]).expect("root"),
                Tag::parse(["e", reply_id.as_str(), "", "reply"]).expect("reply"),
            ],
        );
        let thread_id = Hex64::parse(thread.id.to_hex()).expect("thread id");
        let (root, reply, surface) =
            strict_trigger_routing(&conversation, &thread, &thread_id).expect("thread route");
        assert_eq!(root, Some(Hex64::parse(root_id).expect("root hex")));
        assert_eq!(reply, Some(Hex64::parse(reply_id).expect("reply hex")));
        assert_eq!(surface, ManagedResponseSurfaceV1::Thread);
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
