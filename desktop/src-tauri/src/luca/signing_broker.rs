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
        Ok(Self {
            resident_keys,
            session: LocalBrokerSession::new(binding)?,
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
        Ok(Self {
            resident_keys,
            session: LocalBrokerSession::new(binding)?,
            message_outbox,
            publication_authority,
        })
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
            let frame = match frame_reader.read_next_frame(stream) {
                Ok(Some(frame)) => frame,
                Ok(None) => return Ok(()),
                Err(SigningTransportError::IdleTimeout) => {
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
mod tests {
    use super::*;
    use luca_protocol::{
        decode_length_prefixed_result_frame, derive_message_publish_idempotency_key,
        encode_length_prefixed_frame, ManagedMessagePublishRequestV1,
        ManagedMessagePublishResultV1, OpaqueId, OperationV1, RelayAuthPurposeV1,
        RelayHttpMethodV1, SafeU53, SigningFrameV1, MESSAGE_PUBLISH_PROTOCOL,
        RELAY_AUTH_SIGN_PROTOCOL,
    };
    use nostr::JsonUtil;
    use std::sync::{Arc, Mutex};

    fn hex(value: char) -> Hex64 {
        Hex64::parse(value.to_string().repeat(64)).expect("valid fixture hex")
    }

    fn fixture() -> (ResidentSigningBroker, Hex64) {
        let keys = Keys::parse(&"01".repeat(32)).expect("valid fixture key");
        let runtime = hex('c');
        let broker = ResidentSigningBroker::new(
            keys.clone(),
            LocalBrokerSessionBinding {
                owner_pubkey: hex('a'),
                resident_pubkey: Hex64::parse(keys.public_key().to_hex())
                    .expect("valid resident pubkey"),
                acp_pid: 8123,
                session_epoch: SafeU53::new(4).expect("valid epoch"),
                runtime_configuration_sha256: runtime.clone(),
                installation_session_id: OpaqueId::parse("installation-1")
                    .expect("valid installation ID"),
                relay_url: "wss://relay.example.test".to_owned(),
                relay_query_url: "https://relay.example.test/query".to_owned(),
                owner_attestation: None,
            },
        )
        .expect("matching broker");
        (broker, runtime)
    }

    fn publish_request(broker: &ResidentSigningBroker) -> ManagedMessagePublishRequestV1 {
        let resident_pubkey = broker.session.binding().resident_pubkey.clone();
        let dispatch_receipt_id = OpaqueId::parse("dispatch-1").expect("valid dispatch receipt ID");
        ManagedMessagePublishRequestV1 {
            protocol: MESSAGE_PUBLISH_PROTOCOL.to_owned(),
            turn_id: OpaqueId::parse("turn-1").expect("valid turn ID"),
            idempotency_key: derive_message_publish_idempotency_key(
                &dispatch_receipt_id,
                &resident_pubkey,
            )
            .expect("valid idempotency key"),
            owner_pubkey: broker.session.binding().owner_pubkey.clone(),
            resident_pubkey,
            conversation_id: OpaqueId::parse("conversation-1").expect("valid conversation ID"),
            thread_id: Some(OpaqueId::parse("thread-1").expect("valid thread ID")),
            root_event_id: Some(hex('d')),
            reply_event_id: Some(hex('e')),
            resolved_p_tags: vec![hex('a'), hex('f')],
            final_draft: "A managed final answer.".to_owned(),
            dispatch_receipt_id,
            cancellation_epoch: SafeU53::new(3).expect("valid cancellation epoch"),
        }
    }

    fn encoded_publish_frame(
        broker: &ResidentSigningBroker,
        request: &ManagedMessagePublishRequestV1,
        sequence: u64,
        request_id: &str,
    ) -> Vec<u8> {
        encode_length_prefixed_frame(
            &SigningFrameV1 {
                protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
                session_epoch: broker.session.binding().session_epoch,
                sequence: SafeU53::new(sequence).expect("valid sequence"),
                request_id: OpaqueId::parse(request_id).expect("valid request ID"),
                operation: OperationV1::MessagePublish,
                payload: request.clone(),
                deadline_unix_ms: SafeU53::new(1_700_000_000_020).expect("valid deadline"),
            },
            1_700_000_000_000,
        )
        .expect("valid publish frame")
    }

    #[test]
    fn luca_signing_broker_returns_exact_public_nip42_event() {
        let (mut broker, runtime) = fixture();
        let request = RelayAuthSignRequestV1 {
            protocol: RELAY_AUTH_SIGN_PROTOCOL.to_owned(),
            resident_pubkey: broker.session.binding().resident_pubkey.clone(),
            purpose: RelayAuthPurposeV1::Nip42 {
                relay_url: "wss://relay.example.test".to_owned(),
                challenge: "relay-challenge".to_owned(),
                owner_attestation: None,
            },
        };
        let frame = SigningFrameV1 {
            protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
            session_epoch: SafeU53::new(4).expect("valid epoch"),
            sequence: SafeU53::new(1).expect("valid sequence"),
            request_id: OpaqueId::parse("request-1").expect("valid request ID"),
            operation: OperationV1::RelayAuthSign,
            payload: request.clone(),
            deadline_unix_ms: SafeU53::new(1_700_000_000_020).expect("valid deadline"),
        };
        let encoded =
            encode_length_prefixed_frame(&frame, 1_700_000_000_000).expect("valid request frame");
        let result = broker
            .handle_relay_auth_frame(
                &encoded,
                LocalBrokerCaller {
                    acp_pid: 8123,
                    runtime_configuration_sha256: &runtime,
                },
                1_700_000_000_000,
            )
            .expect("authorized signing");
        let decoded = decode_length_prefixed_result_frame::<RelayAuthSignResultV1>(&result)
            .expect("valid result frame");
        decoded
            .result
            .validate_against(&request, 1_700_000_000)
            .expect("result is bound to exact request");
        let RelayAuthSignResultV1::Signed {
            signed_event_json, ..
        } = decoded.result
        else {
            panic!("expected signed result");
        };
        let event = nostr::Event::from_json(signed_event_json).expect("valid public event");
        assert!(event.verify_signature());
        assert_eq!(event.kind, Kind::Authentication);
    }

    #[test]
    fn luca_signing_broker_invalidates_session_on_transport_error_exit() {
        let (mut broker, runtime) = fixture();
        let caller = LocalBrokerCaller {
            acp_pid: 8123,
            runtime_configuration_sha256: &runtime,
        };
        let mut partial = std::io::Cursor::new(vec![0_u8]);
        assert!(matches!(
            broker.serve_relay_auth_session(&mut partial, caller),
            Err(SigningBrokerError::Transport(SigningTransportError::Io(_)))
        ));

        let request = RelayAuthSignRequestV1 {
            protocol: RELAY_AUTH_SIGN_PROTOCOL.to_owned(),
            resident_pubkey: broker.session.binding().resident_pubkey.clone(),
            purpose: RelayAuthPurposeV1::Nip42 {
                relay_url: "wss://relay.example.test".to_owned(),
                challenge: "relay-challenge".to_owned(),
                owner_attestation: None,
            },
        };
        let frame = SigningFrameV1 {
            protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
            session_epoch: SafeU53::new(4).expect("epoch"),
            sequence: SafeU53::new(1).expect("sequence"),
            request_id: OpaqueId::parse("after-error").expect("request"),
            operation: OperationV1::RelayAuthSign,
            payload: request,
            deadline_unix_ms: SafeU53::new(1_700_000_000_020).expect("deadline"),
        };
        let encoded = encode_length_prefixed_frame(&frame, 1_700_000_000_000).expect("valid frame");
        assert!(matches!(
            broker.handle_relay_auth_frame(
                &encoded,
                LocalBrokerCaller {
                    acp_pid: 8123,
                    runtime_configuration_sha256: &runtime,
                },
                1_700_000_000_000,
            ),
            Err(SigningBrokerError::Session(
                LocalBrokerSessionError::Closed(
                    super::super::local_broker_session::SessionCloseReason::Invalidated
                )
            ))
        ));
    }

    #[test]
    fn luca_signing_broker_never_accepts_a_different_resident() {
        let (mut broker, runtime) = fixture();
        let request = RelayAuthSignRequestV1 {
            protocol: RELAY_AUTH_SIGN_PROTOCOL.to_owned(),
            resident_pubkey: hex('d'),
            purpose: RelayAuthPurposeV1::Nip42 {
                relay_url: "wss://relay.example.test".to_owned(),
                challenge: "relay-challenge".to_owned(),
                owner_attestation: None,
            },
        };
        let frame = SigningFrameV1 {
            protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
            session_epoch: SafeU53::new(4).expect("valid epoch"),
            sequence: SafeU53::new(1).expect("valid sequence"),
            request_id: OpaqueId::parse("request-1").expect("valid request ID"),
            operation: OperationV1::RelayAuthSign,
            payload: request,
            deadline_unix_ms: SafeU53::new(1_700_000_000_020).expect("valid deadline"),
        };
        let encoded =
            encode_length_prefixed_frame(&frame, 1_700_000_000_000).expect("valid request frame");
        assert!(matches!(
            broker.handle_relay_auth_frame(
                &encoded,
                LocalBrokerCaller {
                    acp_pid: 8123,
                    runtime_configuration_sha256: &runtime,
                },
                1_700_000_000_000,
            ),
            Err(SigningBrokerError::Session(
                LocalBrokerSessionError::PolicyMismatch
            ))
        ));
    }

    #[test]
    fn luca_signing_broker_nip98_is_bound_to_exact_query_body_nonce_and_expiry() {
        let (mut broker, runtime) = fixture();
        let request = RelayAuthSignRequestV1 {
            protocol: RELAY_AUTH_SIGN_PROTOCOL.to_owned(),
            resident_pubkey: broker.session.binding().resident_pubkey.clone(),
            purpose: RelayAuthPurposeV1::Nip98 {
                method: RelayHttpMethodV1::Post,
                url: "https://relay.example.test/query".to_owned(),
                payload_sha256: Some(hex('e')),
                nonce: OpaqueId::parse("nonce-1").expect("valid nonce"),
                expires_at_unix_secs: SafeU53::new(1_700_000_030).expect("valid expiry"),
            },
        };
        let frame = SigningFrameV1 {
            protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
            session_epoch: SafeU53::new(4).expect("valid epoch"),
            sequence: SafeU53::new(1).expect("valid sequence"),
            request_id: OpaqueId::parse("request-nip98").expect("valid request ID"),
            operation: OperationV1::RelayAuthSign,
            payload: request.clone(),
            deadline_unix_ms: SafeU53::new(1_700_000_000_020).expect("valid deadline"),
        };
        let encoded =
            encode_length_prefixed_frame(&frame, 1_700_000_000_000).expect("valid request frame");
        let result = broker
            .handle_relay_auth_frame(
                &encoded,
                LocalBrokerCaller {
                    acp_pid: 8123,
                    runtime_configuration_sha256: &runtime,
                },
                1_700_000_000_000,
            )
            .expect("authorized signing");
        let decoded = decode_length_prefixed_result_frame::<RelayAuthSignResultV1>(&result)
            .expect("valid result frame");
        decoded
            .result
            .validate_against(&request, 1_700_000_000)
            .expect("result is bound to exact NIP-98 request");
    }

    #[test]
    fn luca_signing_broker_replays_the_same_public_signature_for_same_request_id() {
        let (mut broker, runtime) = fixture();
        let request = RelayAuthSignRequestV1 {
            protocol: RELAY_AUTH_SIGN_PROTOCOL.to_owned(),
            resident_pubkey: broker.session.binding().resident_pubkey.clone(),
            purpose: RelayAuthPurposeV1::Nip42 {
                relay_url: "wss://relay.example.test".to_owned(),
                challenge: "relay-challenge".to_owned(),
                owner_attestation: None,
            },
        };
        let encode = |sequence| {
            encode_length_prefixed_frame(
                &SigningFrameV1 {
                    protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
                    session_epoch: SafeU53::new(4).expect("valid epoch"),
                    sequence: SafeU53::new(sequence).expect("valid sequence"),
                    request_id: OpaqueId::parse("stable-request").expect("valid request ID"),
                    operation: OperationV1::RelayAuthSign,
                    payload: request.clone(),
                    deadline_unix_ms: SafeU53::new(1_700_000_000_020).expect("valid deadline"),
                },
                1_700_000_000_000,
            )
            .expect("valid request frame")
        };
        let caller = LocalBrokerCaller {
            acp_pid: 8123,
            runtime_configuration_sha256: &runtime,
        };
        let first = broker
            .handle_relay_auth_frame(&encode(1), caller, 1_700_000_000_000)
            .expect("first signing");
        let replay = broker
            .handle_relay_auth_frame(&encode(2), caller, 1_700_000_000_000)
            .expect("idempotent replay");
        let first = decode_length_prefixed_result_frame::<RelayAuthSignResultV1>(&first)
            .expect("first result");
        let replay = decode_length_prefixed_result_frame::<RelayAuthSignResultV1>(&replay)
            .expect("replay result");
        assert_eq!(first.result, replay.result);
    }

    #[test]
    fn luca_signing_broker_message_unavailable_is_typed_and_session_remains_usable() {
        let (mut broker, runtime) = fixture();
        let request = publish_request(&broker);
        let publish = encoded_publish_frame(&broker, &request, 1, "publish-1");
        let caller = LocalBrokerCaller {
            acp_pid: 8123,
            runtime_configuration_sha256: &runtime,
        };
        let response = broker
            .handle_frame(&publish, caller, 1_700_000_000_000)
            .expect("typed unavailable response");
        let response =
            decode_length_prefixed_result_frame::<ManagedMessagePublishResultV1>(&response)
                .expect("valid publish result frame");
        assert!(matches!(
            response.result,
            ManagedMessagePublishResultV1::Unavailable { .. }
        ));

        let relay_request = RelayAuthSignRequestV1 {
            protocol: RELAY_AUTH_SIGN_PROTOCOL.to_owned(),
            resident_pubkey: broker.session.binding().resident_pubkey.clone(),
            purpose: RelayAuthPurposeV1::Nip42 {
                relay_url: "wss://relay.example.test".to_owned(),
                challenge: "challenge-after-publication".to_owned(),
                owner_attestation: None,
            },
        };
        let relay_frame = encode_length_prefixed_frame(
            &SigningFrameV1 {
                protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
                session_epoch: SafeU53::new(4).expect("valid epoch"),
                sequence: SafeU53::new(2).expect("valid sequence"),
                request_id: OpaqueId::parse("relay-after-publish").expect("valid request ID"),
                operation: OperationV1::RelayAuthSign,
                payload: relay_request.clone(),
                deadline_unix_ms: SafeU53::new(1_700_000_000_020).expect("valid deadline"),
            },
            1_700_000_000_000,
        )
        .expect("valid relay frame");
        let response = broker
            .handle_frame(&relay_frame, caller, 1_700_000_000_000)
            .expect("shared session remains usable");
        let response = decode_length_prefixed_result_frame::<RelayAuthSignResultV1>(&response)
            .expect("valid relay result frame");
        response
            .result
            .validate_against(&relay_request, 1_700_000_000)
            .expect("relay auth remains exact");
    }

    struct AcceptingPublicationAuthority {
        captured_event: Arc<Mutex<Option<String>>>,
    }

    impl ManagedMessagePublicationAuthority for AcceptingPublicationAuthority {
        fn authorize_request(
            &mut self,
            _request: &ManagedMessagePublishRequestV1,
            _now_unix_secs: u64,
        ) -> Result<(), ManagedPublicationAuthorityError> {
            Ok(())
        }

        fn publish_prepared(
            &mut self,
            request: &ManagedMessagePublishRequestV1,
            outbox: &mut ManagedMessageOutbox,
            installation_session_id: &OpaqueId,
        ) -> Result<(), ManagedPublicationAuthorityError> {
            let event = outbox
                .event_for_submission(&request.idempotency_key)
                .map_err(|_| ManagedPublicationAuthorityError::Invalid)?
                .to_owned();
            *self.captured_event.lock().expect("capture lock") = Some(event);
            outbox
                .mark_submitted(&request.idempotency_key, installation_session_id, false)
                .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
            outbox
                .mark_accepted(
                    &request.idempotency_key,
                    OpaqueId::parse("publication-1").expect("valid publication receipt"),
                )
                .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
            Ok(())
        }
    }

    #[test]
    fn luca_signing_broker_constructs_exact_buzz_kind9_before_publication_adapter() {
        let keys = Keys::parse(&"01".repeat(32)).expect("valid fixture key");
        let runtime = hex('c');
        let binding = LocalBrokerSessionBinding {
            owner_pubkey: hex('a'),
            resident_pubkey: Hex64::parse(keys.public_key().to_hex())
                .expect("valid resident pubkey"),
            acp_pid: 8123,
            session_epoch: SafeU53::new(4).expect("valid epoch"),
            runtime_configuration_sha256: runtime.clone(),
            installation_session_id: OpaqueId::parse("installation-1")
                .expect("valid installation ID"),
            relay_url: "wss://relay.example.test".to_owned(),
            relay_query_url: "https://relay.example.test/query".to_owned(),
            owner_attestation: None,
        };
        let captured_event = Arc::new(Mutex::new(None));
        let authority = AcceptingPublicationAuthority {
            captured_event: Arc::clone(&captured_event),
        };
        let mut broker = ResidentSigningBroker::new_with_publication_authority(
            keys,
            binding,
            Box::new(authority),
        )
        .expect("matching broker");
        let request = publish_request(&broker);
        let frame = encoded_publish_frame(&broker, &request, 1, "publish-1");
        let response = broker
            .handle_frame(
                &frame,
                LocalBrokerCaller {
                    acp_pid: 8123,
                    runtime_configuration_sha256: &runtime,
                },
                1_700_000_000_000,
            )
            .expect("published response");
        let response =
            decode_length_prefixed_result_frame::<ManagedMessagePublishResultV1>(&response)
                .expect("valid response");
        assert!(matches!(
            response.result,
            ManagedMessagePublishResultV1::Published { .. }
        ));

        let event_json = captured_event
            .lock()
            .expect("capture lock")
            .clone()
            .expect("captured exact event");
        let event = nostr::Event::from_json(event_json).expect("valid event");
        assert_eq!(event.kind, Kind::Custom(9));
        assert_eq!(event.content, request.final_draft);
        assert_eq!(event.pubkey.to_hex(), request.resident_pubkey.as_str());
        let tags: Vec<Vec<String>> = event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect();
        assert_eq!(
            tags,
            vec![
                vec!["h".to_owned(), "conversation-1".to_owned()],
                vec![
                    "e".to_owned(),
                    hex('d').as_str().to_owned(),
                    String::new(),
                    "root".to_owned(),
                ],
                vec![
                    "e".to_owned(),
                    hex('e').as_str().to_owned(),
                    String::new(),
                    "reply".to_owned(),
                ],
                vec!["p".to_owned(), hex('a').as_str().to_owned()],
                vec!["p".to_owned(), hex('f').as_str().to_owned()],
            ]
        );
    }

    struct DenyingCountingAuthority {
        authorize_calls: Arc<Mutex<usize>>,
    }

    impl ManagedMessagePublicationAuthority for DenyingCountingAuthority {
        fn authorize_request(
            &mut self,
            _request: &ManagedMessagePublishRequestV1,
            _now_unix_secs: u64,
        ) -> Result<(), ManagedPublicationAuthorityError> {
            *self.authorize_calls.lock().expect("counter") += 1;
            Err(ManagedPublicationAuthorityError::Denied)
        }

        fn publish_prepared(
            &mut self,
            _request: &ManagedMessagePublishRequestV1,
            _outbox: &mut ManagedMessageOutbox,
            _installation_session_id: &OpaqueId,
        ) -> Result<(), ManagedPublicationAuthorityError> {
            Err(ManagedPublicationAuthorityError::Denied)
        }
    }

    struct StartupPassAuthority {
        calls: Arc<Mutex<usize>>,
        defer_call: Option<usize>,
    }

    impl ManagedMessagePublicationAuthority for StartupPassAuthority {
        fn authorize_request(
            &mut self,
            _request: &ManagedMessagePublishRequestV1,
            _now_unix_secs: u64,
        ) -> Result<(), ManagedPublicationAuthorityError> {
            Ok(())
        }

        fn publish_prepared(
            &mut self,
            _request: &ManagedMessagePublishRequestV1,
            _outbox: &mut ManagedMessageOutbox,
            _installation_session_id: &OpaqueId,
        ) -> Result<(), ManagedPublicationAuthorityError> {
            Err(ManagedPublicationAuthorityError::Unavailable)
        }

        fn reconcile_on_start(
            &mut self,
            outbox: &mut ManagedMessageOutbox,
            installation_session_id: &OpaqueId,
        ) -> Result<(), ManagedPublicationAuthorityError> {
            let call = {
                let mut calls = self.calls.lock().expect("calls");
                *calls += 1;
                *calls
            };
            if self.defer_call == Some(call) {
                return Err(ManagedPublicationAuthorityError::Unavailable);
            }
            let entry = outbox
                .reconciliation_entries()
                .into_iter()
                .next()
                .ok_or(ManagedPublicationAuthorityError::Invalid)?;
            outbox
                .mark_submitted(&entry.idempotency_key, installation_session_id, false)
                .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
            outbox
                .mark_accepted(
                    &entry.idempotency_key,
                    OpaqueId::parse(format!("startup-publication-{call}"))
                        .expect("publication receipt"),
                )
                .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
            outbox
                .mark_authority_finalized(&entry.idempotency_key)
                .map_err(|_| ManagedPublicationAuthorityError::Invalid)
        }
    }

    fn startup_pass_broker(
        defer_call: Option<usize>,
        calls: Arc<Mutex<usize>>,
    ) -> ResidentSigningBroker {
        let keys = Keys::parse(&"0c".repeat(32)).expect("valid fixture key");
        let runtime = hex('c');
        let binding = LocalBrokerSessionBinding {
            owner_pubkey: hex('a'),
            resident_pubkey: Hex64::parse(keys.public_key().to_hex())
                .expect("valid resident pubkey"),
            acp_pid: 8123,
            session_epoch: SafeU53::new(4).expect("valid epoch"),
            runtime_configuration_sha256: runtime,
            installation_session_id: OpaqueId::parse("installation-startup-pass")
                .expect("installation ID"),
            relay_url: "wss://relay.example.test".to_owned(),
            relay_query_url: "https://relay.example.test/query".to_owned(),
            owner_attestation: None,
        };
        let mut broker = ResidentSigningBroker::new_with_publication_authority(
            keys,
            binding,
            Box::new(StartupPassAuthority { calls, defer_call }),
        )
        .expect("matching broker");
        let installation_session_id = broker.session.binding().installation_session_id.clone();
        for index in 0..2 {
            let mut request = publish_request(&broker);
            request.dispatch_receipt_id =
                OpaqueId::parse(format!("startup-dispatch-{index}")).expect("dispatch receipt");
            request.turn_id = OpaqueId::parse(format!("startup-turn-{index}")).expect("turn ID");
            request.idempotency_key = derive_message_publish_idempotency_key(
                &request.dispatch_receipt_id,
                &request.resident_pubkey,
            )
            .expect("idempotency key");
            request.final_draft = format!("Frozen startup final {index}");
            let event_json = broker
                .build_managed_message_event(&request, 1_700_000_000 + index)
                .expect("event");
            let event = FrozenManagedMessageEvent::parse(event_json, &request).expect("frozen");
            broker
                .message_outbox
                .prepare(
                    &request,
                    event,
                    &installation_session_id,
                    request.cancellation_epoch.get(),
                    false,
                )
                .expect("prepare startup entry");
        }
        broker
    }

    #[test]
    fn startup_pass_reports_fully_terminal_after_attempting_two_frozen_entries_once() {
        let calls = Arc::new(Mutex::new(0));
        let mut broker = startup_pass_broker(None, Arc::clone(&calls));

        assert_eq!(
            broker.reconcile_publication_outbox_startup_pass(),
            StartupOutboxReconciliation::FullyTerminal
        );
        assert_eq!(*calls.lock().expect("calls"), 2);
        assert!(broker.message_outbox.reconciliation_entries().is_empty());
    }

    #[test]
    fn startup_pass_reports_deferred_and_preserves_one_of_two_frozen_entries() {
        let calls = Arc::new(Mutex::new(0));
        let mut broker = startup_pass_broker(Some(2), Arc::clone(&calls));

        assert_eq!(
            broker.reconcile_publication_outbox_startup_pass(),
            StartupOutboxReconciliation::Deferred
        );
        assert_eq!(*calls.lock().expect("calls"), 2);
        assert_eq!(broker.message_outbox.reconciliation_entries().len(), 1);
    }

    #[test]
    fn luca_signing_broker_desktop_restart_replays_exact_accepted_request_before_fresh_authority() {
        let keys = Keys::parse(&"0b".repeat(32)).expect("valid fixture key");
        let runtime = hex('c');
        let binding = LocalBrokerSessionBinding {
            owner_pubkey: hex('a'),
            resident_pubkey: Hex64::parse(keys.public_key().to_hex())
                .expect("valid resident pubkey"),
            acp_pid: 8123,
            session_epoch: SafeU53::new(4).expect("valid epoch"),
            runtime_configuration_sha256: runtime,
            installation_session_id: OpaqueId::parse("installation-restart")
                .expect("valid installation ID"),
            relay_url: "wss://relay.example.test".to_owned(),
            relay_query_url: "https://relay.example.test/query".to_owned(),
            owner_attestation: None,
        };
        let outbox_path = tempfile::tempdir()
            .expect("temp")
            .keep()
            .join("managed-outbox.age");
        let captured_event = Arc::new(Mutex::new(None));
        let mut first = ResidentSigningBroker::new_persistent_with_publication_authority(
            keys.clone(),
            binding.clone(),
            outbox_path.clone(),
            Box::new(AcceptingPublicationAuthority {
                captured_event: Arc::clone(&captured_event),
            }),
        )
        .expect("first broker");
        let request = publish_request(&first);
        assert!(matches!(
            first.prepare_and_publish_message(&request, 1_700_000_000),
            ManagedMessagePublishResultV1::Published { .. }
        ));
        drop(first);

        let authorize_calls = Arc::new(Mutex::new(0));
        let mut restarted = ResidentSigningBroker::new_persistent_with_publication_authority(
            keys,
            binding,
            outbox_path,
            Box::new(DenyingCountingAuthority {
                authorize_calls: Arc::clone(&authorize_calls),
            }),
        )
        .expect("restarted broker");
        assert!(matches!(
            restarted.prepare_and_publish_message(&request, 1_700_000_001),
            ManagedMessagePublishResultV1::Replayed { .. }
        ));
        assert_eq!(*authorize_calls.lock().expect("counter"), 0);
    }
}
