//! Desktop authority for the allowlisted managed signing-broker operations.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use luca_protocol::{
    canonicalize, decode_length_prefixed_frame, encode_length_prefixed_result_frame,
    parse_strict_json, FrameError, Hex64, ManagedMessagePublishRequestV1,
    ManagedMessagePublishResultV1, OperationV1, RelayAuthPurposeV1, RelayAuthSignRequestV1,
    RelayAuthSignResultV1, SigningResultFrameV1, BROKER_FRAME_MAX_BYTES, SIGNING_FRAME_PROTOCOL,
};
use nostr::{EventBuilder, Keys, Kind, RelayUrl, Tag, Timestamp};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use super::continuity_capsule::{
    capsule_broker_channel, service_capsule_broker_slice, CapsuleBrokerHandle,
    CapsuleBrokerReceiver,
};
use super::local_broker_session::{
    LocalBrokerCaller, LocalBrokerSession, LocalBrokerSessionBinding, LocalBrokerSessionError,
    MessagePublishAuthorization, RelayAuthAuthorization,
};
#[cfg(test)]
use super::managed_message_outbox::UnavailableManagedMessagePublicationAuthority;
use super::managed_message_outbox::{
    FrozenManagedMessageEvent, ManagedMessageOutbox, ManagedMessageOutboxError,
    ManagedMessagePublicationAuthority, ManagedOutboxState, ManagedPublicationAuthorityError,
    StartupOutboxReconciliation,
};
use super::signing_transport::{write_frame, SigningFrameReader, SigningTransportError};

/// Fatal broker error. Fatal errors close the exclusive channel.
#[derive(Debug)]
pub(crate) enum SigningBrokerError {
    /// The resident secret did not match the desktop-bound public identity.
    ResidentKeyMismatch,
    /// The request frame was malformed, noncanonical, stale, oversized, or mis-typed.
    InvalidFrame(luca_protocol::FrameError),
    /// Desktop session authorization rejected and closed the channel.
    Session(LocalBrokerSessionError),
    /// A validated semantic request could not be represented as a fixed auth event.
    EventConstruction,
    /// Resident signing failed inside desktop authority.
    Signing,
    /// The produced public auth event failed exact protocol self-validation.
    ResultValidation,
    /// Exact managed-message event or outbox preparation failed.
    MessagePublication(ManagedMessageOutboxError),
    /// The result frame could not be encoded.
    ResultFrame(luca_protocol::FrameError),
    /// The exclusive socketpair failed.
    Transport(SigningTransportError),
    /// The system clock cannot provide a protocol timestamp.
    Clock,
}

impl std::fmt::Display for SigningBrokerError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ResidentKeyMismatch => formatter
                .write_str("desktop resident key does not match the bound resident identity"),
            Self::InvalidFrame(_) => {
                formatter.write_str("managed signing request frame is invalid")
            }
            Self::Session(error) => std::fmt::Display::fmt(error, formatter),
            Self::EventConstruction => {
                formatter.write_str("managed relay-auth event construction failed")
            }
            Self::Signing => formatter.write_str("managed relay-auth signing failed"),
            Self::ResultValidation => {
                formatter.write_str("managed signing result failed exact validation")
            }
            Self::MessagePublication(error) => std::fmt::Display::fmt(error, formatter),
            Self::ResultFrame(_) => {
                formatter.write_str("managed signing result frame could not be encoded")
            }
            Self::Transport(error) => std::fmt::Display::fmt(error, formatter),
            Self::Clock => formatter.write_str("system clock is before the Unix epoch"),
        }
    }
}

impl std::error::Error for SigningBrokerError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::InvalidFrame(error) | Self::ResultFrame(error) => Some(error),
            Self::Session(error) => Some(error),
            Self::MessagePublication(error) => Some(error),
            Self::Transport(error) => Some(error),
            Self::ResidentKeyMismatch
            | Self::EventConstruction
            | Self::Signing
            | Self::ResultValidation
            | Self::Clock => None,
        }
    }
}

impl From<LocalBrokerSessionError> for SigningBrokerError {
    fn from(error: LocalBrokerSessionError) -> Self {
        Self::Session(error)
    }
}

impl From<SigningTransportError> for SigningBrokerError {
    fn from(error: SigningTransportError) -> Self {
        Self::Transport(error)
    }
}

impl From<ManagedMessageOutboxError> for SigningBrokerError {
    fn from(error: ManagedMessageOutboxError) -> Self {
        Self::MessagePublication(error)
    }
}

/// Desktop-owned resident signer plus one tightly bound local ACP session.
///
/// This type deliberately exposes no generic signing method. The wire
/// discriminator selects one of the two frozen semantic request types.
pub(crate) struct ResidentSigningBroker {
    resident_keys: Keys,
    session: LocalBrokerSession,
    capsule_handle: CapsuleBrokerHandle,
    capsule_receiver: CapsuleBrokerReceiver,
    message_outbox: ManagedMessageOutbox,
    publication_authority: Box<dyn ManagedMessagePublicationAuthority>,
}

impl ResidentSigningBroker {
    /// Bind desktop-held resident keys to one already-spawned ACP session.
    #[cfg(test)]
    pub(crate) fn new(
        resident_keys: Keys,
        binding: LocalBrokerSessionBinding,
    ) -> Result<Self, SigningBrokerError> {
        Self::new_with_publication_authority(
            resident_keys,
            binding,
            Box::new(UnavailableManagedMessagePublicationAuthority),
        )
    }

    /// Bind a desktop publication adapter without broadening the broker wire API.
    ///
    /// F09/runtime may supply this adapter at construction time; the signing
    /// broker remains the sole owner of event construction, signing and outbox
    /// result derivation.
    #[cfg(test)]
    pub(crate) fn new_with_publication_authority(
        resident_keys: Keys,
        binding: LocalBrokerSessionBinding,
        publication_authority: Box<dyn ManagedMessagePublicationAuthority>,
    ) -> Result<Self, SigningBrokerError> {
        if resident_keys.public_key().to_hex() != binding.resident_pubkey.as_str() {
            return Err(SigningBrokerError::ResidentKeyMismatch);
        }
        let message_outbox = ManagedMessageOutbox::new(binding.installation_session_id.clone());
        let (capsule_handle, capsule_receiver) =
            capsule_broker_channel(&binding).map_err(|_| SigningBrokerError::EventConstruction)?;
        Ok(Self {
            resident_keys,
            session: LocalBrokerSession::new(binding)?,
            capsule_handle,
            capsule_receiver,
            message_outbox,
            publication_authority,
        })
    }

    /// Bind the production publisher and encrypted exact-event outbox.
    pub(crate) fn new_persistent_with_publication_authority(
        resident_keys: Keys,
        binding: LocalBrokerSessionBinding,
        outbox_path: PathBuf,
        publication_authority: Box<dyn ManagedMessagePublicationAuthority>,
    ) -> Result<Self, SigningBrokerError> {
        if resident_keys.public_key().to_hex() != binding.resident_pubkey.as_str() {
            return Err(SigningBrokerError::ResidentKeyMismatch);
        }
        let passphrase = derive_outbox_passphrase(&resident_keys)?;
        let message_outbox = ManagedMessageOutbox::load_encrypted(
            binding.installation_session_id.clone(),
            outbox_path,
            passphrase,
        )?;
        let (capsule_handle, capsule_receiver) =
            capsule_broker_channel(&binding).map_err(|_| SigningBrokerError::EventConstruction)?;
        Ok(Self {
            resident_keys,
            session: LocalBrokerSession::new(binding)?,
            capsule_handle,
            capsule_receiver,
            message_outbox,
            publication_authority,
        })
    }

    /// Clone the non-signing, bounded internal Capsule request handle.
    pub(crate) fn capsule_handle(&self) -> CapsuleBrokerHandle {
        self.capsule_handle.clone()
    }

    fn service_capsule_requests(&self) {
        service_capsule_broker_slice(
            &self.capsule_receiver,
            &self.resident_keys,
            self.session.binding(),
        );
    }

    /// Reconcile one hard-bounded slice on the sole broker/outbox owner thread.
    pub(crate) fn reconcile_publication_outbox_slice(&mut self) -> Result<(), SigningBrokerError> {
        let installation_session_id = self.session.binding().installation_session_id.clone();
        self.publication_authority
            .reconcile_on_start(&mut self.message_outbox, &installation_session_id)
            .map_err(|_| {
                SigningBrokerError::MessagePublication(ManagedMessageOutboxError::Persistence)
            })
    }

    /// Attempt exactly the reconciliation rows visible at startup, once each.
    ///
    /// The snapshot count is a hard bound. A deferred row cannot turn this
    /// into an unbounded retry loop, and dispatch restart terminalization is
    /// safe only after this returns [`StartupOutboxReconciliation::FullyTerminal`].
    pub(crate) fn reconcile_publication_outbox_startup_pass(
        &mut self,
    ) -> StartupOutboxReconciliation {
        let installation_session_id = self.session.binding().installation_session_id.clone();
        let startup_entry_count = self.message_outbox.reconciliation_entries().len();
        let mut deferred = false;
        for _ in 0..startup_entry_count {
            if self
                .publication_authority
                .reconcile_on_start(&mut self.message_outbox, &installation_session_id)
                .is_err()
            {
                deferred = true;
            }
        }
        if !deferred && self.message_outbox.reconciliation_entries().is_empty() {
            StartupOutboxReconciliation::FullyTerminal
        } else {
            StartupOutboxReconciliation::Deferred
        }
    }

    /// Process either frozen operation while sharing one sequence/session gate.
    pub(crate) fn handle_frame(
        &mut self,
        frame_bytes: &[u8],
        caller: LocalBrokerCaller<'_>,
        now_unix_ms: u64,
    ) -> Result<Vec<u8>, SigningBrokerError> {
        let operation = match decode_operation(frame_bytes) {
            Ok(operation) => operation,
            Err(error) => {
                self.session.invalidate();
                return Err(SigningBrokerError::InvalidFrame(error));
            }
        };
        match operation {
            OperationV1::RelayAuthSign => {
                self.handle_relay_auth_frame(frame_bytes, caller, now_unix_ms)
            }
            OperationV1::MessagePublish => {
                self.handle_message_publish_frame(frame_bytes, caller, now_unix_ms)
            }
        }
    }

    /// Process one complete canonical request frame into one public-only result frame.
    pub(crate) fn handle_relay_auth_frame(
        &mut self,
        frame_bytes: &[u8],
        caller: LocalBrokerCaller<'_>,
        now_unix_ms: u64,
    ) -> Result<Vec<u8>, SigningBrokerError> {
        let frame = match decode_length_prefixed_frame::<RelayAuthSignRequestV1>(
            frame_bytes,
            now_unix_ms,
        ) {
            Ok(frame) => frame,
            Err(error) => {
                self.session.invalidate();
                return Err(SigningBrokerError::InvalidFrame(error));
            }
        };
        let authorization = self
            .session
            .authorize_relay_auth(&frame, caller, now_unix_ms)?;

        let result = match authorization {
            RelayAuthAuthorization::Replay { result } => result,
            RelayAuthAuthorization::Fresh { request_sha256 } => {
                let result = match self.sign_relay_auth(&frame.payload, now_unix_ms / 1_000) {
                    Ok(result) => result,
                    Err(error) => {
                        self.session.invalidate();
                        return Err(error);
                    }
                };
                self.session.cache_relay_auth_result(
                    &frame.request_id,
                    request_sha256,
                    result.clone(),
                )?;
                result
            }
        };
        let result_frame = SigningResultFrameV1 {
            protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
            session_epoch: frame.session_epoch,
            sequence: frame.sequence,
            request_id: frame.request_id,
            operation: frame.operation,
            result,
        };
        match encode_length_prefixed_result_frame(&result_frame) {
            Ok(encoded) => Ok(encoded),
            Err(error) => {
                self.session.invalidate();
                Err(SigningBrokerError::ResultFrame(error))
            }
        }
    }

    /// Process one managed-message request into a body-free typed result.
    ///
    /// Publication unavailability and exact-event rejection are operation
    /// results, not channel failures, so a later relay-auth frame can continue
    /// on the same monotonically sequenced session.
    pub(crate) fn handle_message_publish_frame(
        &mut self,
        frame_bytes: &[u8],
        caller: LocalBrokerCaller<'_>,
        now_unix_ms: u64,
    ) -> Result<Vec<u8>, SigningBrokerError> {
        let frame = match decode_length_prefixed_frame::<ManagedMessagePublishRequestV1>(
            frame_bytes,
            now_unix_ms,
        ) {
            Ok(frame) => frame,
            Err(error) => {
                self.session.invalidate();
                return Err(SigningBrokerError::InvalidFrame(error));
            }
        };
        let authorization = self
            .session
            .authorize_message_publish(&frame, caller, now_unix_ms)?;

        let result = match authorization {
            MessagePublishAuthorization::Replay { result } => result,
            MessagePublishAuthorization::Fresh { request_sha256 } => {
                let result = self.prepare_and_publish_message(&frame.payload, now_unix_ms / 1_000);
                self.session.cache_message_publish_result(
                    &frame.request_id,
                    request_sha256,
                    result.clone(),
                )?;
                result
            }
        };
        let result_frame = SigningResultFrameV1 {
            protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
            session_epoch: frame.session_epoch,
            sequence: frame.sequence,
            request_id: frame.request_id,
            operation: frame.operation,
            result,
        };
        encode_length_prefixed_result_frame(&result_frame).map_err(SigningBrokerError::ResultFrame)
    }

    /// Serve until clean EOF. Any malformed or unauthorized frame is fatal.
    pub(crate) fn serve_relay_auth_session<S: Read + Write>(
        &mut self,
        stream: &mut S,
        caller: LocalBrokerCaller<'_>,
    ) -> Result<(), SigningBrokerError> {
        let result = self.serve_relay_auth_session_inner(stream, caller);
        self.session.invalidate();
        result
    }

    fn serve_relay_auth_session_inner<S: Read + Write>(
        &mut self,
        stream: &mut S,
        caller: LocalBrokerCaller<'_>,
    ) -> Result<(), SigningBrokerError> {
        let mut frame_reader = SigningFrameReader::new();
        loop {
            self.service_capsule_requests();
            let frame = match frame_reader.read_next_frame(stream) {
                Ok(Some(frame)) => frame,
                Ok(None) => return Ok(()),
                Err(SigningTransportError::IdleTimeout) => {
                    self.service_capsule_requests();
                    if let Err(error) = self.reconcile_publication_outbox_slice() {
                        eprintln!(
                            "luca-signing: managed publication reconciliation deferred: {error}"
                        );
                    }
                    continue;
                }
                Err(error) => return Err(error.into()),
            };
            let now_unix_ms = system_now_unix_ms()?;
            let result = self.handle_frame(&frame, caller, now_unix_ms)?;
            write_frame(stream, &result)?;
            self.service_capsule_requests();
            if let Err(error) = self.reconcile_publication_outbox_slice() {
                eprintln!("luca-signing: managed publication reconciliation deferred: {error}");
            }
        }
    }

    fn sign_relay_auth(
        &self,
        request: &RelayAuthSignRequestV1,
        now_unix_secs: u64,
    ) -> Result<RelayAuthSignResultV1, SigningBrokerError> {
        request
            .validate_at(now_unix_secs)
            .map_err(|_| SigningBrokerError::ResultValidation)?;
        let builder = match &request.purpose {
            RelayAuthPurposeV1::Nip42 {
                relay_url,
                challenge,
                owner_attestation,
            } => {
                if let Some(attestation) = owner_attestation {
                    let relay_tag = Tag::parse(["relay", relay_url.as_str()])
                        .map_err(|_| SigningBrokerError::EventConstruction)?;
                    let challenge_tag = Tag::parse(["challenge", challenge.as_str()])
                        .map_err(|_| SigningBrokerError::EventConstruction)?;
                    let auth_tag_json = serde_json::to_string(&attestation.tag_value())
                        .map_err(|_| SigningBrokerError::EventConstruction)?;
                    let auth_tag = buzz_sdk_pkg::nip_oa::parse_auth_tag(&auth_tag_json)
                        .map_err(|_| SigningBrokerError::EventConstruction)?;
                    EventBuilder::new(Kind::Authentication, "").tags([
                        relay_tag,
                        challenge_tag,
                        auth_tag,
                    ])
                } else {
                    let relay = RelayUrl::parse(relay_url)
                        .map_err(|_| SigningBrokerError::EventConstruction)?;
                    EventBuilder::auth(challenge, relay)
                }
            }
            RelayAuthPurposeV1::Nip98 {
                method: _,
                url,
                payload_sha256,
                nonce,
                ..
            } => {
                let payload = payload_sha256
                    .as_ref()
                    .ok_or(SigningBrokerError::EventConstruction)?;
                let tags = [
                    Tag::parse(["u", url.as_str()])
                        .map_err(|_| SigningBrokerError::EventConstruction)?,
                    Tag::parse(["method", "POST"])
                        .map_err(|_| SigningBrokerError::EventConstruction)?,
                    Tag::parse(["nonce", nonce.as_str()])
                        .map_err(|_| SigningBrokerError::EventConstruction)?,
                    Tag::parse(["payload", payload.as_str()])
                        .map_err(|_| SigningBrokerError::EventConstruction)?,
                ];
                EventBuilder::new(Kind::HttpAuth, "").tags(tags)
            }
        };

        let event = builder
            .custom_created_at(Timestamp::from(now_unix_secs))
            .sign_with_keys(&self.resident_keys)
            .map_err(|_| SigningBrokerError::Signing)?;
        let signed_event_json = String::from_utf8(
            canonicalize(&event).map_err(|_| SigningBrokerError::EventConstruction)?,
        )
        .map_err(|_| SigningBrokerError::EventConstruction)?;
        let result = RelayAuthSignResultV1::Signed {
            event_id: Hex64::parse(event.id.to_hex())
                .map_err(|_| SigningBrokerError::EventConstruction)?,
            signed_event_json,
        };
        result
            .validate_against(request, now_unix_secs)
            .map_err(|_| SigningBrokerError::ResultValidation)?;
        Ok(result)
    }

    fn prepare_and_publish_message(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        now_unix_secs: u64,
    ) -> ManagedMessagePublishResultV1 {
        let prepared = match self.message_outbox.preflight_existing(request) {
            Ok(Some(existing)) => existing,
            Ok(None) => {
                if let Err(error) = self
                    .publication_authority
                    .authorize_request(request, now_unix_secs)
                {
                    return error.into_protocol_result();
                }
                let prepared = self
                    .build_managed_message_event(request, now_unix_secs)
                    .and_then(|event| {
                        let frozen = FrozenManagedMessageEvent::parse(event, request)?;
                        self.message_outbox.prepare(
                            request,
                            frozen,
                            &self.session.binding().installation_session_id,
                            request.cancellation_epoch.get(),
                            false,
                        )
                    });
                match prepared {
                    Ok(prepared) => prepared,
                    Err(_) => {
                        return ManagedPublicationAuthorityError::Invalid.into_protocol_result()
                    }
                }
            }
            Err(_) => return ManagedPublicationAuthorityError::Invalid.into_protocol_result(),
        };
        match prepared.state {
            ManagedOutboxState::Accepted => {
                return self
                    .message_outbox
                    .accepted_result(&request.idempotency_key)
                    .unwrap_or_else(|_| {
                        ManagedPublicationAuthorityError::Invalid.into_protocol_result()
                    });
            }
            ManagedOutboxState::Cancelled => {
                return ManagedPublicationAuthorityError::Cancelled.into_protocol_result();
            }
            ManagedOutboxState::Rejected => {
                return ManagedPublicationAuthorityError::Denied.into_protocol_result();
            }
            ManagedOutboxState::Prepared | ManagedOutboxState::Submitted => {}
        }

        let installation_session_id = self.session.binding().installation_session_id.clone();
        match self.publication_authority.publish_prepared(
            request,
            &mut self.message_outbox,
            &installation_session_id,
        ) {
            Ok(()) => self
                .message_outbox
                .accepted_result(&request.idempotency_key)
                .unwrap_or_else(|_| {
                    ManagedPublicationAuthorityError::Invalid.into_protocol_result()
                }),
            Err(error) => error.into_protocol_result(),
        }
    }

    fn build_managed_message_event(
        &self,
        request: &ManagedMessagePublishRequestV1,
        now_unix_secs: u64,
    ) -> Result<String, ManagedMessageOutboxError> {
        let mut tags = vec![Tag::parse(["h", request.conversation_id.as_str()])
            .map_err(|_| ManagedMessageOutboxError::InvalidRequest)?];
        match (&request.root_event_id, &request.reply_event_id) {
            (None, None) => {}
            (Some(root), Some(reply)) if root == reply => tags.push(
                Tag::parse(["e", root.as_str(), "", "reply"])
                    .map_err(|_| ManagedMessageOutboxError::InvalidRequest)?,
            ),
            (Some(root), Some(reply)) => {
                tags.push(
                    Tag::parse(["e", root.as_str(), "", "root"])
                        .map_err(|_| ManagedMessageOutboxError::InvalidRequest)?,
                );
                tags.push(
                    Tag::parse(["e", reply.as_str(), "", "reply"])
                        .map_err(|_| ManagedMessageOutboxError::InvalidRequest)?,
                );
            }
            _ => return Err(ManagedMessageOutboxError::InvalidRequest),
        }
        for pubkey in &request.resolved_p_tags {
            tags.push(
                Tag::parse(["p", pubkey.as_str()])
                    .map_err(|_| ManagedMessageOutboxError::InvalidRequest)?,
            );
        }

        let event = EventBuilder::new(Kind::Custom(9), request.final_draft.clone())
            .tags(tags)
            .custom_created_at(Timestamp::from(now_unix_secs))
            .sign_with_keys(&self.resident_keys)
            .map_err(|_| ManagedMessageOutboxError::InvalidEvent)?;
        String::from_utf8(
            canonicalize(&event).map_err(|_| ManagedMessageOutboxError::Canonicalization)?,
        )
        .map_err(|_| ManagedMessageOutboxError::Canonicalization)
    }
}

fn derive_outbox_passphrase(
    resident_keys: &Keys,
) -> Result<age::secrecy::SecretString, SigningBrokerError> {
    let mut secret_hex = resident_keys.secret_key().to_secret_hex();
    let mut hasher = Sha256::new();
    hasher.update(b"luca-managed-message-outbox-passphrase-v1\0");
    hasher.update(secret_hex.as_bytes());
    secret_hex.zeroize();
    Ok(age::secrecy::SecretString::from(hex::encode(
        hasher.finalize(),
    )))
}

#[derive(Deserialize)]
struct FrameOperationDiscriminant {
    operation: OperationV1,
}

fn decode_operation(frame_bytes: &[u8]) -> Result<OperationV1, FrameError> {
    let prefix: [u8; 4] = frame_bytes
        .get(..4)
        .ok_or(FrameError::LengthPrefix)?
        .try_into()
        .map_err(|_| FrameError::LengthPrefix)?;
    let declared = u32::from_be_bytes(prefix) as usize;
    if declared > BROKER_FRAME_MAX_BYTES || frame_bytes.len() != declared.saturating_add(4) {
        return Err(FrameError::LengthPrefix);
    }
    let payload = &frame_bytes[4..];
    let value = parse_strict_json(payload, BROKER_FRAME_MAX_BYTES)?;
    if canonicalize(&value)?.as_slice() != payload {
        return Err(FrameError::NonCanonical);
    }
    serde_json::from_value::<FrameOperationDiscriminant>(value)
        .map(|frame| frame.operation)
        .map_err(FrameError::Decode)
}

fn system_now_unix_ms() -> Result<u64, SigningBrokerError> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| SigningBrokerError::Clock)?
        .as_millis();
    u64::try_from(millis).map_err(|_| SigningBrokerError::Clock)
}

#[cfg(test)]
#[path = "signing_broker_tests.rs"]
mod signing_broker_tests;
