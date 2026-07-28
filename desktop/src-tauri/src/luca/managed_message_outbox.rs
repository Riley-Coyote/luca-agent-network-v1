//! Deterministic desktop outbox lifecycle for future F09 managed publication.
//!
//! This module freezes and validates state transitions. It intentionally makes
//! no at-rest encryption claim: the C15/M2 sealed archive layer owns encrypted
//! persistence, while F09 owns aggregation and relay publication.

#![allow(dead_code)] // F09 and C15 consume this reviewed foundation after F14.

use std::collections::HashMap;

use luca_protocol::{
    canonical_sha256, canonicalize, Hex64, ManagedMessagePublishRequestV1,
    ManagedMessagePublishResultV1, OpaqueId,
};
use nostr::{JsonUtil, Kind};
use sha2::{Digest, Sha256};

/// Validation or lifecycle failure for one managed final-message record.
#[derive(Debug)]
pub(crate) enum ManagedMessageOutboxError {
    /// The typed publication request failed its frozen protocol rules.
    InvalidRequest,
    /// The supplied event was noncanonical, invalid, unsigned, or authored by another resident.
    InvalidEvent,
    /// A different request or event reused an existing idempotency key.
    IdempotencyCollision,
    /// The request did not belong to the active local installation session.
    InactiveSession,
    /// Cancellation won before the event was frozen or submitted.
    Cancelled,
    /// The requested transition is not legal from the current state.
    InvalidTransition,
    /// The requested idempotency key was not present.
    NotFound,
    /// Canonical hashing failed.
    Canonicalization,
}

impl std::fmt::Display for ManagedMessageOutboxError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidRequest => "managed publication request is invalid",
            Self::InvalidEvent => "managed publication event is invalid",
            Self::IdempotencyCollision => "managed publication idempotency collision",
            Self::InactiveSession => "managed publication session is inactive",
            Self::Cancelled => "managed publication turn is cancelled",
            Self::InvalidTransition => "managed publication outbox transition is invalid",
            Self::NotFound => "managed publication outbox entry was not found",
            Self::Canonicalization => "managed publication canonical hashing failed",
        })
    }
}

impl std::error::Error for ManagedMessageOutboxError {}

/// Frozen, exact signed event retained only inside desktop authority.
#[derive(Clone)]
pub(crate) struct FrozenManagedMessageEvent {
    event_id: Hex64,
    event_sha256: Hex64,
    content_sha256: Hex64,
    signed_event_json: String,
}

impl std::fmt::Debug for FrozenManagedMessageEvent {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FrozenManagedMessageEvent")
            .field("event_id", &self.event_id)
            .field("event_sha256", &self.event_sha256)
            .field("signed_event_json", &"<desktop-only>")
            .finish()
    }
}

impl FrozenManagedMessageEvent {
    /// Parse and freeze one canonical event that exactly represents the typed request.
    pub(crate) fn parse(
        signed_event_json: String,
        request: &ManagedMessagePublishRequestV1,
    ) -> Result<Self, ManagedMessageOutboxError> {
        let event = nostr::Event::from_json(&signed_event_json)
            .map_err(|_| ManagedMessageOutboxError::InvalidEvent)?;
        if !event.verify_id()
            || !event.verify_signature()
            || event.pubkey.to_hex() != request.resident_pubkey.as_str()
            || event.kind != Kind::Custom(9)
            || event.content != request.final_draft
            || !event_tags_match_request(&event, request)
        {
            return Err(ManagedMessageOutboxError::InvalidEvent);
        }
        let canonical =
            canonicalize(&event).map_err(|_| ManagedMessageOutboxError::Canonicalization)?;
        if canonical.as_slice() != signed_event_json.as_bytes() {
            return Err(ManagedMessageOutboxError::InvalidEvent);
        }
        let event_id =
            Hex64::parse(event.id.to_hex()).map_err(|_| ManagedMessageOutboxError::InvalidEvent)?;
        let event_sha256 = Hex64::parse(hex::encode(Sha256::digest(&canonical)))
            .map_err(|_| ManagedMessageOutboxError::Canonicalization)?;
        let content_sha256 = Hex64::parse(hex::encode(Sha256::digest(event.content.as_bytes())))
            .map_err(|_| ManagedMessageOutboxError::Canonicalization)?;
        Ok(Self {
            event_id,
            event_sha256,
            content_sha256,
            signed_event_json,
        })
    }

    /// Exact canonical signed event retained inside desktop authority.
    pub(crate) fn signed_event_json(&self) -> &str {
        &self.signed_event_json
    }
}

fn event_tags_match_request(
    event: &nostr::Event,
    request: &ManagedMessagePublishRequestV1,
) -> bool {
    let mut expected = vec![vec![
        "h".to_owned(),
        request.conversation_id.as_str().to_owned(),
    ]];
    match (&request.root_event_id, &request.reply_event_id) {
        (None, None) => {}
        (Some(root), Some(reply)) if root == reply => expected.push(vec![
            "e".to_owned(),
            root.as_str().to_owned(),
            String::new(),
            "reply".to_owned(),
        ]),
        (Some(root), Some(reply)) => {
            expected.push(vec![
                "e".to_owned(),
                root.as_str().to_owned(),
                String::new(),
                "root".to_owned(),
            ]);
            expected.push(vec![
                "e".to_owned(),
                reply.as_str().to_owned(),
                String::new(),
                "reply".to_owned(),
            ]);
        }
        _ => return false,
    }
    expected.extend(
        request
            .resolved_p_tags
            .iter()
            .map(|pubkey| vec!["p".to_owned(), pubkey.as_str().to_owned()]),
    );
    event.tags.iter().map(|tag| tag.as_slice()).eq(expected)
}

/// Body-free state observable by the ACP-side typed client.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ManagedOutboxState {
    /// Exact request and event are frozen.
    Prepared,
    /// The exact event has been submitted to the relay.
    Submitted,
    /// Relay acceptance was durably observed.
    Accepted,
    /// Cancellation won before submission.
    Cancelled,
}

/// Body-free receipt for prepare/reconcile status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ManagedOutboxReceipt {
    /// Stable request key.
    pub idempotency_key: Hex64,
    /// Exact frozen Nostr event ID.
    pub event_id: Hex64,
    /// SHA-256 of the exact retained event JSON.
    pub event_sha256: Hex64,
    /// Current deterministic lifecycle state.
    pub state: ManagedOutboxState,
}

#[derive(Clone)]
struct ManagedOutboxEntry {
    request_sha256: Hex64,
    event: FrozenManagedMessageEvent,
    state: ManagedOutboxState,
    publication_receipt_id: Option<OpaqueId>,
    initial_result_delivered: bool,
}

/// Desktop-local state machine. A later sealed-storage adapter persists these
/// transitions; this type never writes plaintext state to disk.
pub(crate) struct ManagedMessageOutbox {
    installation_session_id: OpaqueId,
    entries: HashMap<String, ManagedOutboxEntry>,
}

/// Typed failure returned by a desktop-owned publication authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ManagedPublicationAuthorityError {
    /// No authenticated relay publication authority is attached yet.
    Unavailable,
    /// The desktop policy denied this otherwise valid request.
    Denied,
    /// Cancellation won before relay acceptance.
    Cancelled,
    /// The authority could not reconcile the exact prepared event.
    Invalid,
}

impl ManagedPublicationAuthorityError {
    pub(crate) fn into_protocol_result(self) -> ManagedMessagePublishResultV1 {
        let code = match self {
            Self::Unavailable => "publication-authority-unavailable",
            Self::Denied => "publication-policy-denied",
            Self::Cancelled => "publication-cancelled",
            Self::Invalid => "publication-reconciliation-invalid",
        };
        let code = OpaqueId::parse(code).expect("fixed publication status code is valid");
        match self {
            Self::Unavailable => ManagedMessagePublishResultV1::Unavailable { code },
            Self::Denied => ManagedMessagePublishResultV1::Denied { code },
            Self::Cancelled => ManagedMessagePublishResultV1::Cancelled { code },
            Self::Invalid => ManagedMessagePublishResultV1::Invalid { code },
        }
    }
}

/// Desktop-owned seam for F09 relay submission and reconciliation.
///
/// The broker has already validated and frozen the exact signed event before
/// invoking this authority. An implementation must read that event through
/// [`ManagedMessageOutbox::event_for_submission`], mark it submitted before
/// network I/O, and mark it accepted only after honest relay acceptance. On
/// success this method must leave the entry accepted; the broker derives the
/// body-free protocol result from the outbox rather than trusting the adapter.
pub(crate) trait ManagedMessagePublicationAuthority: Send {
    fn publish_prepared(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        outbox: &mut ManagedMessageOutbox,
        installation_session_id: &OpaqueId,
    ) -> Result<(), ManagedPublicationAuthorityError>;
}

/// F14 default: validate and stage exactly, then report unavailable without
/// closing the signing session or pretending network publication occurred.
pub(crate) struct UnavailableManagedMessagePublicationAuthority;

impl ManagedMessagePublicationAuthority for UnavailableManagedMessagePublicationAuthority {
    fn publish_prepared(
        &mut self,
        _request: &ManagedMessagePublishRequestV1,
        _outbox: &mut ManagedMessageOutbox,
        _installation_session_id: &OpaqueId,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        Err(ManagedPublicationAuthorityError::Unavailable)
    }
}

impl ManagedMessageOutbox {
    /// Create an empty outbox bound to the active desktop installation session.
    pub(crate) fn new(installation_session_id: OpaqueId) -> Self {
        Self {
            installation_session_id,
            entries: HashMap::new(),
        }
    }

    /// Freeze exactly one signed final event before any network I/O.
    pub(crate) fn prepare(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        event: FrozenManagedMessageEvent,
        observed_installation_session_id: &OpaqueId,
        active_cancellation_epoch: u64,
        turn_is_cancelled: bool,
    ) -> Result<ManagedOutboxReceipt, ManagedMessageOutboxError> {
        request
            .validate()
            .map_err(|_| ManagedMessageOutboxError::InvalidRequest)?;
        if observed_installation_session_id != &self.installation_session_id {
            return Err(ManagedMessageOutboxError::InactiveSession);
        }
        if turn_is_cancelled || active_cancellation_epoch != request.cancellation_epoch.get() {
            return Err(ManagedMessageOutboxError::Cancelled);
        }
        let expected_content_sha256 =
            Hex64::parse(hex::encode(Sha256::digest(request.final_draft.as_bytes())))
                .map_err(|_| ManagedMessageOutboxError::Canonicalization)?;
        if event.content_sha256 != expected_content_sha256 {
            return Err(ManagedMessageOutboxError::InvalidEvent);
        }
        let request_sha256 = canonical_sha256(request)
            .map_err(|_| ManagedMessageOutboxError::Canonicalization)
            .and_then(|digest| {
                Hex64::parse(digest).map_err(|_| ManagedMessageOutboxError::Canonicalization)
            })?;
        let key = request.idempotency_key.as_str().to_owned();

        if let Some(existing) = self.entries.get(&key) {
            if existing.request_sha256 != request_sha256
                || existing.event.event_id != event.event_id
                || existing.event.event_sha256 != event.event_sha256
            {
                return Err(ManagedMessageOutboxError::IdempotencyCollision);
            }
            return Ok(receipt_for(&request.idempotency_key, existing));
        }

        let entry = ManagedOutboxEntry {
            request_sha256,
            event,
            state: ManagedOutboxState::Prepared,
            publication_receipt_id: None,
            initial_result_delivered: false,
        };
        let receipt = receipt_for(&request.idempotency_key, &entry);
        self.entries.insert(key, entry);
        Ok(receipt)
    }

    /// Return the exact frozen event for the desktop-authorized F09 publisher.
    pub(crate) fn event_for_submission(
        &self,
        idempotency_key: &Hex64,
    ) -> Result<&str, ManagedMessageOutboxError> {
        let entry = self
            .entries
            .get(idempotency_key.as_str())
            .ok_or(ManagedMessageOutboxError::NotFound)?;
        if !matches!(
            entry.state,
            ManagedOutboxState::Prepared | ManagedOutboxState::Submitted
        ) {
            return Err(ManagedMessageOutboxError::InvalidTransition);
        }
        Ok(&entry.event.signed_event_json)
    }

    /// Record that the exact retained event was submitted, without re-signing it.
    pub(crate) fn mark_submitted(
        &mut self,
        idempotency_key: &Hex64,
        observed_installation_session_id: &OpaqueId,
        turn_is_cancelled: bool,
    ) -> Result<ManagedOutboxReceipt, ManagedMessageOutboxError> {
        if observed_installation_session_id != &self.installation_session_id {
            return Err(ManagedMessageOutboxError::InactiveSession);
        }
        if turn_is_cancelled {
            return self.cancel_before_submission(idempotency_key);
        }
        let entry = self
            .entries
            .get_mut(idempotency_key.as_str())
            .ok_or(ManagedMessageOutboxError::NotFound)?;
        if entry.state == ManagedOutboxState::Submitted {
            return Ok(receipt_for(idempotency_key, entry));
        }
        if entry.state != ManagedOutboxState::Prepared {
            return Err(ManagedMessageOutboxError::InvalidTransition);
        }
        entry.state = ManagedOutboxState::Submitted;
        Ok(receipt_for(idempotency_key, entry))
    }

    /// Record honest relay acceptance of the exact submitted event.
    pub(crate) fn mark_accepted(
        &mut self,
        idempotency_key: &Hex64,
        publication_receipt_id: OpaqueId,
    ) -> Result<ManagedOutboxReceipt, ManagedMessageOutboxError> {
        let entry = self
            .entries
            .get_mut(idempotency_key.as_str())
            .ok_or(ManagedMessageOutboxError::NotFound)?;
        if entry.state == ManagedOutboxState::Accepted {
            if entry.publication_receipt_id.as_ref() != Some(&publication_receipt_id) {
                return Err(ManagedMessageOutboxError::IdempotencyCollision);
            }
            return Ok(receipt_for(idempotency_key, entry));
        }
        if entry.state != ManagedOutboxState::Submitted {
            return Err(ManagedMessageOutboxError::InvalidTransition);
        }
        entry.state = ManagedOutboxState::Accepted;
        entry.publication_receipt_id = Some(publication_receipt_id);
        Ok(receipt_for(idempotency_key, entry))
    }

    /// Cancel only while the exact event is prepared and unsent.
    pub(crate) fn cancel_before_submission(
        &mut self,
        idempotency_key: &Hex64,
    ) -> Result<ManagedOutboxReceipt, ManagedMessageOutboxError> {
        let entry = self
            .entries
            .get_mut(idempotency_key.as_str())
            .ok_or(ManagedMessageOutboxError::NotFound)?;
        if entry.state != ManagedOutboxState::Prepared {
            return Err(ManagedMessageOutboxError::InvalidTransition);
        }
        entry.state = ManagedOutboxState::Cancelled;
        Ok(receipt_for(idempotency_key, entry))
    }

    /// Return `published` once and `replayed` thereafter for an accepted entry.
    pub(crate) fn accepted_result(
        &mut self,
        idempotency_key: &Hex64,
    ) -> Result<ManagedMessagePublishResultV1, ManagedMessageOutboxError> {
        let entry = self
            .entries
            .get_mut(idempotency_key.as_str())
            .ok_or(ManagedMessageOutboxError::NotFound)?;
        if entry.state != ManagedOutboxState::Accepted {
            return Err(ManagedMessageOutboxError::InvalidTransition);
        }
        let publication_receipt_id = entry
            .publication_receipt_id
            .clone()
            .ok_or(ManagedMessageOutboxError::InvalidTransition)?;
        let result = if entry.initial_result_delivered {
            ManagedMessagePublishResultV1::Replayed {
                event_id: entry.event.event_id.clone(),
                event_sha256: entry.event.event_sha256.clone(),
                publication_receipt_id,
            }
        } else {
            entry.initial_result_delivered = true;
            ManagedMessagePublishResultV1::Published {
                event_id: entry.event.event_id.clone(),
                event_sha256: entry.event.event_sha256.clone(),
                publication_receipt_id,
            }
        };
        Ok(result)
    }
}

fn receipt_for(idempotency_key: &Hex64, entry: &ManagedOutboxEntry) -> ManagedOutboxReceipt {
    ManagedOutboxReceipt {
        idempotency_key: idempotency_key.clone(),
        event_id: entry.event.event_id.clone(),
        event_sha256: entry.event.event_sha256.clone(),
        state: entry.state,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::{
        derive_message_publish_idempotency_key, SafeU53, MESSAGE_PUBLISH_PROTOCOL,
    };
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn hex(value: char) -> Hex64 {
        Hex64::parse(value.to_string().repeat(64)).expect("valid fixture hex")
    }

    fn request(keys: &Keys) -> ManagedMessagePublishRequestV1 {
        let resident_pubkey =
            Hex64::parse(keys.public_key().to_hex()).expect("valid resident pubkey");
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
            resolved_p_tags: Vec::new(),
            final_draft: "A bounded final answer.".to_owned(),
            dispatch_receipt_id,
            cancellation_epoch: SafeU53::new(3).expect("valid cancellation epoch"),
        }
    }

    fn frozen_event(
        keys: &Keys,
        request: &ManagedMessagePublishRequestV1,
    ) -> FrozenManagedMessageEvent {
        let tags =
            vec![Tag::parse(["h", request.conversation_id.as_str()])
                .expect("valid conversation tag")];
        let event = EventBuilder::new(Kind::Custom(9), request.final_draft.clone())
            .tags(tags)
            .sign_with_keys(keys)
            .expect("sign fixture event");
        let canonical =
            String::from_utf8(canonicalize(&event).expect("canonical event")).expect("UTF-8 event");
        FrozenManagedMessageEvent::parse(canonical, request).expect("valid frozen event")
    }

    #[test]
    fn luca_signing_outbox_has_one_way_exact_event_lifecycle() {
        let keys = Keys::parse(&"02".repeat(32)).expect("valid fixture key");
        let request = request(&keys);
        let event = frozen_event(&keys, &request);
        let session = OpaqueId::parse("installation-1").expect("valid installation ID");
        let mut outbox = ManagedMessageOutbox::new(session.clone());

        let prepared = outbox
            .prepare(&request, event, &session, 3, false)
            .expect("prepare");
        assert_eq!(prepared.state, ManagedOutboxState::Prepared);
        let exact_event = outbox
            .event_for_submission(&request.idempotency_key)
            .expect("exact event")
            .to_owned();
        let submitted = outbox
            .mark_submitted(&request.idempotency_key, &session, false)
            .expect("submit");
        assert_eq!(submitted.state, ManagedOutboxState::Submitted);
        assert_eq!(
            exact_event,
            outbox
                .entries
                .get(request.idempotency_key.as_str())
                .expect("retained entry")
                .event
                .signed_event_json,
            "submission must retain the same exact signed event"
        );

        let accepted = outbox
            .mark_accepted(
                &request.idempotency_key,
                OpaqueId::parse("publication-1").expect("valid receipt"),
            )
            .expect("accept");
        assert_eq!(accepted.state, ManagedOutboxState::Accepted);
        assert!(matches!(
            outbox
                .accepted_result(&request.idempotency_key)
                .expect("first result"),
            ManagedMessagePublishResultV1::Published { .. }
        ));
        assert!(matches!(
            outbox
                .accepted_result(&request.idempotency_key)
                .expect("replay result"),
            ManagedMessagePublishResultV1::Replayed { .. }
        ));
    }

    #[test]
    fn luca_signing_outbox_cancellation_wins_before_submit_only() {
        let keys = Keys::parse(&"03".repeat(32)).expect("valid fixture key");
        let request = request(&keys);
        let event = frozen_event(&keys, &request);
        let session = OpaqueId::parse("installation-1").expect("valid installation ID");
        let mut outbox = ManagedMessageOutbox::new(session.clone());
        outbox
            .prepare(&request, event, &session, 3, false)
            .expect("prepare");
        let cancelled = outbox
            .cancel_before_submission(&request.idempotency_key)
            .expect("cancel");
        assert_eq!(cancelled.state, ManagedOutboxState::Cancelled);
        assert!(matches!(
            outbox.mark_submitted(&request.idempotency_key, &session, false),
            Err(ManagedMessageOutboxError::InvalidTransition)
        ));
    }

    #[test]
    fn luca_signing_outbox_rejects_any_tag_not_derived_from_typed_request() {
        let keys = Keys::parse(&"03".repeat(32)).expect("valid fixture key");
        let request = request(&keys);
        let event = EventBuilder::new(Kind::Custom(9), request.final_draft.clone())
            .tags([
                Tag::parse(["h", request.conversation_id.as_str()])
                    .expect("valid conversation tag"),
                Tag::parse(["p", hex('f').as_str()]).expect("valid unauthorized mention"),
            ])
            .sign_with_keys(&keys)
            .expect("sign fixture event");
        let canonical =
            String::from_utf8(canonicalize(&event).expect("canonical event")).expect("UTF-8 event");
        assert!(matches!(
            FrozenManagedMessageEvent::parse(canonical, &request),
            Err(ManagedMessageOutboxError::InvalidEvent)
        ));
    }
}
