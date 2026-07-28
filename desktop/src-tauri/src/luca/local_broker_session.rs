//! Desktop-local authorization state for one managed ACP broker channel.

use std::collections::{HashMap, VecDeque};

use luca_protocol::{
    canonical_sha256, BrokerOperationV1, Hex64, ManagedMessagePublishRequestV1,
    ManagedMessagePublishResultV1, NipOaOwnerAttestationV1, OpaqueId, RelayAuthPurposeV1,
    RelayAuthSignRequestV1, RelayAuthSignResultV1, SafeU53, SigningFrameV1, JSON_SAFE_INTEGER_MAX,
};

const MAX_CACHED_REQUESTS: usize = 64;

/// Immutable desktop-owned facts that bind one broker channel to one ACP host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LocalBrokerSessionBinding {
    /// Owner that authorized this resident and launch.
    pub owner_pubkey: Hex64,
    /// Only resident identity that this channel may use.
    pub resident_pubkey: Hex64,
    /// Exact child PID returned by the desktop spawn.
    pub acp_pid: u32,
    /// Fresh epoch assigned to this one socketpair.
    pub session_epoch: SafeU53,
    /// Digest of the immutable runtime/provider/tool configuration at launch.
    pub runtime_configuration_sha256: Hex64,
    /// Desktop-local installation/session identifier.
    pub installation_session_id: OpaqueId,
    /// Exact configured WebSocket relay URL.
    pub relay_url: String,
    /// Exact configured HTTP `/query` URL.
    pub relay_query_url: String,
    /// App-owned NIP-OA credential; model text can neither supply nor replace it.
    pub owner_attestation: Option<NipOaOwnerAttestationV1>,
}

/// Facts supplied by the desktop launch supervisor, never by broker JSON.
#[derive(Debug, Clone, Copy)]
pub(crate) struct LocalBrokerCaller<'a> {
    /// Observed ACP host PID.
    pub acp_pid: u32,
    /// Observed launch-configuration digest.
    pub runtime_configuration_sha256: &'a Hex64,
}

/// Successful authorization result for a typed relay-auth request.
#[derive(Debug, Clone)]
pub(crate) enum RelayAuthAuthorization {
    /// A new request that may be signed exactly once.
    Fresh {
        /// Canonical SHA-256 of the semantic request.
        request_sha256: Hex64,
    },
    /// An idempotent replay of an identical earlier request.
    Replay {
        /// Previously produced public-only result.
        result: RelayAuthSignResultV1,
    },
}

/// Successful authorization result for a typed managed-message request.
#[derive(Debug, Clone)]
pub(crate) enum MessagePublishAuthorization {
    /// A new request whose exact event may be constructed and staged once.
    Fresh {
        /// Canonical SHA-256 of the semantic request.
        request_sha256: Hex64,
    },
    /// An idempotent replay of an identical earlier request.
    Replay {
        /// Previously produced body-free result.
        result: ManagedMessagePublishResultV1,
    },
}

#[derive(Debug, Clone)]
enum CachedBrokerResult {
    RelayAuth {
        request_sha256: Hex64,
        result: RelayAuthSignResultV1,
    },
    MessagePublish {
        request_sha256: Hex64,
        result: ManagedMessagePublishResultV1,
    },
}

/// A closed session rejects all later frames; reopening requires a new socketpair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SessionCloseReason {
    /// Desktop explicitly invalidated the local installation/session.
    Invalidated,
    /// The socket was used by the wrong process or runtime configuration.
    CallerMismatch,
    /// Frame epoch or monotonic sequence was stale, duplicated, or skipped.
    OrderingMismatch,
    /// A request attempted to change resident, relay, owner attestation, or request ID.
    PolicyMismatch,
    /// The largest interoperable sequence number was consumed.
    SequenceExhausted,
}

/// Authorization failure at the desktop-owned session boundary.
#[derive(Debug)]
pub(crate) enum LocalBrokerSessionError {
    /// A prior fatal violation already closed this channel.
    Closed(SessionCloseReason),
    /// The desktop-observed ACP caller did not match the bound launch.
    CallerMismatch,
    /// The frame did not use this channel's exact epoch and next sequence.
    OrderingMismatch,
    /// The typed semantic request failed its own bounded validation.
    InvalidRequest,
    /// The request was outside this resident/session/relay policy.
    PolicyMismatch,
    /// Canonical request hashing failed.
    Canonicalization,
}

impl std::fmt::Display for LocalBrokerSessionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Closed(reason) => {
                write!(formatter, "managed broker session is closed: {reason:?}")
            }
            Self::CallerMismatch => {
                formatter.write_str("managed broker caller does not match the bound launch")
            }
            Self::OrderingMismatch => {
                formatter.write_str("managed broker frame epoch or sequence is invalid")
            }
            Self::InvalidRequest => formatter.write_str("managed broker request is invalid"),
            Self::PolicyMismatch => {
                formatter.write_str("managed broker request is outside the bound desktop policy")
            }
            Self::Canonicalization => {
                formatter.write_str("managed broker request could not be canonicalized")
            }
        }
    }
}

impl std::error::Error for LocalBrokerSessionError {}

/// Stateful, fail-closed desktop gate for one exclusive ACP socketpair.
pub(crate) struct LocalBrokerSession {
    binding: LocalBrokerSessionBinding,
    next_sequence: Option<u64>,
    cached_results: HashMap<String, CachedBrokerResult>,
    cache_order: VecDeque<String>,
    closed: Option<SessionCloseReason>,
}

impl LocalBrokerSession {
    /// Create a fresh channel state. Epoch zero and PID zero are rejected.
    pub(crate) fn new(binding: LocalBrokerSessionBinding) -> Result<Self, LocalBrokerSessionError> {
        if binding.acp_pid == 0
            || binding.session_epoch.get() == 0
            || binding.relay_url.is_empty()
            || binding.relay_query_url.is_empty()
        {
            return Err(LocalBrokerSessionError::PolicyMismatch);
        }
        Ok(Self {
            binding,
            next_sequence: Some(1),
            cached_results: HashMap::new(),
            cache_order: VecDeque::new(),
            closed: None,
        })
    }

    /// Borrow immutable launch policy without exposing any secret.
    pub(crate) fn binding(&self) -> &LocalBrokerSessionBinding {
        &self.binding
    }

    /// Close the channel immediately. It can never be reopened.
    pub(crate) fn invalidate(&mut self) {
        self.close(SessionCloseReason::Invalidated);
    }

    /// Validate caller, ordering, deadline and semantic relay-auth policy.
    pub(crate) fn authorize_relay_auth(
        &mut self,
        frame: &SigningFrameV1<RelayAuthSignRequestV1>,
        caller: LocalBrokerCaller<'_>,
        now_unix_ms: u64,
    ) -> Result<RelayAuthAuthorization, LocalBrokerSessionError> {
        self.authorize_common(frame, caller, now_unix_ms)?;

        let now_unix_secs = now_unix_ms / 1_000;
        if frame.payload.validate_at(now_unix_secs).is_err() {
            self.close(SessionCloseReason::PolicyMismatch);
            return Err(LocalBrokerSessionError::InvalidRequest);
        }
        if frame.payload.resident_pubkey != self.binding.resident_pubkey
            || !self.purpose_matches_policy(&frame.payload.purpose)
        {
            self.close(SessionCloseReason::PolicyMismatch);
            return Err(LocalBrokerSessionError::PolicyMismatch);
        }

        let request_sha256 = canonical_sha256(&frame.payload)
            .map_err(|_| LocalBrokerSessionError::Canonicalization)
            .and_then(|digest| {
                Hex64::parse(digest).map_err(|_| LocalBrokerSessionError::Canonicalization)
            })?;
        let request_id = frame.request_id.as_str();
        if let Some(cached) = self.cached_results.get(request_id) {
            return match cached {
                CachedBrokerResult::RelayAuth {
                    request_sha256: cached_sha256,
                    result,
                } if cached_sha256 == &request_sha256 => Ok(RelayAuthAuthorization::Replay {
                    result: result.clone(),
                }),
                _ => {
                    self.close(SessionCloseReason::PolicyMismatch);
                    Err(LocalBrokerSessionError::PolicyMismatch)
                }
            };
        }

        Ok(RelayAuthAuthorization::Fresh { request_sha256 })
    }

    /// Validate caller, ordering and semantic managed-publication policy.
    pub(crate) fn authorize_message_publish(
        &mut self,
        frame: &SigningFrameV1<ManagedMessagePublishRequestV1>,
        caller: LocalBrokerCaller<'_>,
        now_unix_ms: u64,
    ) -> Result<MessagePublishAuthorization, LocalBrokerSessionError> {
        self.authorize_common(frame, caller, now_unix_ms)?;
        if frame.payload.validate().is_err() {
            self.close(SessionCloseReason::PolicyMismatch);
            return Err(LocalBrokerSessionError::InvalidRequest);
        }
        if frame.payload.owner_pubkey != self.binding.owner_pubkey
            || frame.payload.resident_pubkey != self.binding.resident_pubkey
        {
            self.close(SessionCloseReason::PolicyMismatch);
            return Err(LocalBrokerSessionError::PolicyMismatch);
        }

        let request_sha256 = canonical_sha256(&frame.payload)
            .map_err(|_| LocalBrokerSessionError::Canonicalization)
            .and_then(|digest| {
                Hex64::parse(digest).map_err(|_| LocalBrokerSessionError::Canonicalization)
            })?;
        let request_id = frame.request_id.as_str();
        if let Some(cached) = self.cached_results.get(request_id) {
            return match cached {
                CachedBrokerResult::MessagePublish {
                    request_sha256: cached_sha256,
                    result,
                } if cached_sha256 == &request_sha256 => Ok(MessagePublishAuthorization::Replay {
                    result: result.clone(),
                }),
                _ => {
                    self.close(SessionCloseReason::PolicyMismatch);
                    Err(LocalBrokerSessionError::PolicyMismatch)
                }
            };
        }

        Ok(MessagePublishAuthorization::Fresh { request_sha256 })
    }

    /// Cache a public-only result for bounded idempotent replay.
    pub(crate) fn cache_relay_auth_result(
        &mut self,
        request_id: &OpaqueId,
        request_sha256: Hex64,
        result: RelayAuthSignResultV1,
    ) -> Result<(), LocalBrokerSessionError> {
        if let Some(reason) = self
            .closed
            .filter(|reason| !matches!(reason, SessionCloseReason::SequenceExhausted))
        {
            return Err(LocalBrokerSessionError::Closed(reason));
        }

        let id = request_id.as_str().to_owned();
        if let Some(cached) = self.cached_results.get(&id) {
            return match cached {
                CachedBrokerResult::RelayAuth {
                    request_sha256: cached_sha256,
                    result: cached_result,
                } if cached_sha256 == &request_sha256 && cached_result == &result => Ok(()),
                _ => {
                    self.close(SessionCloseReason::PolicyMismatch);
                    Err(LocalBrokerSessionError::PolicyMismatch)
                }
            };
        }
        self.insert_cached_result(
            id,
            CachedBrokerResult::RelayAuth {
                request_sha256,
                result,
            },
        );
        Ok(())
    }

    /// Cache a body-free publication result for bounded idempotent replay.
    pub(crate) fn cache_message_publish_result(
        &mut self,
        request_id: &OpaqueId,
        request_sha256: Hex64,
        result: ManagedMessagePublishResultV1,
    ) -> Result<(), LocalBrokerSessionError> {
        if let Some(reason) = self
            .closed
            .filter(|reason| !matches!(reason, SessionCloseReason::SequenceExhausted))
        {
            return Err(LocalBrokerSessionError::Closed(reason));
        }

        let id = request_id.as_str().to_owned();
        if let Some(cached) = self.cached_results.get(&id) {
            return match cached {
                CachedBrokerResult::MessagePublish {
                    request_sha256: cached_sha256,
                    result: cached_result,
                } if cached_sha256 == &request_sha256 && cached_result == &result => Ok(()),
                _ => {
                    self.close(SessionCloseReason::PolicyMismatch);
                    Err(LocalBrokerSessionError::PolicyMismatch)
                }
            };
        }
        self.insert_cached_result(
            id,
            CachedBrokerResult::MessagePublish {
                request_sha256,
                result,
            },
        );
        Ok(())
    }

    fn authorize_common<T: BrokerOperationV1>(
        &mut self,
        frame: &SigningFrameV1<T>,
        caller: LocalBrokerCaller<'_>,
        now_unix_ms: u64,
    ) -> Result<(), LocalBrokerSessionError> {
        if let Some(reason) = self.closed {
            return Err(LocalBrokerSessionError::Closed(reason));
        }
        if caller.acp_pid != self.binding.acp_pid
            || caller.runtime_configuration_sha256 != &self.binding.runtime_configuration_sha256
        {
            self.close(SessionCloseReason::CallerMismatch);
            return Err(LocalBrokerSessionError::CallerMismatch);
        }
        if frame.validate_at(now_unix_ms).is_err() {
            self.close(SessionCloseReason::OrderingMismatch);
            return Err(LocalBrokerSessionError::OrderingMismatch);
        }

        let expected_sequence = self.next_sequence.ok_or(LocalBrokerSessionError::Closed(
            SessionCloseReason::SequenceExhausted,
        ))?;
        if frame.session_epoch != self.binding.session_epoch
            || frame.sequence.get() != expected_sequence
        {
            self.close(SessionCloseReason::OrderingMismatch);
            return Err(LocalBrokerSessionError::OrderingMismatch);
        }
        self.next_sequence = if expected_sequence == JSON_SAFE_INTEGER_MAX {
            self.closed = Some(SessionCloseReason::SequenceExhausted);
            None
        } else {
            Some(expected_sequence + 1)
        };
        Ok(())
    }

    fn insert_cached_result(&mut self, id: String, result: CachedBrokerResult) {
        if self.cache_order.len() == MAX_CACHED_REQUESTS {
            if let Some(evicted) = self.cache_order.pop_front() {
                self.cached_results.remove(&evicted);
            }
        }
        self.cache_order.push_back(id.clone());
        self.cached_results.insert(id, result);
    }

    fn purpose_matches_policy(&self, purpose: &RelayAuthPurposeV1) -> bool {
        match purpose {
            RelayAuthPurposeV1::Nip42 {
                relay_url,
                owner_attestation,
                ..
            } => {
                relay_url == &self.binding.relay_url
                    && owner_attestation.as_ref().is_none_or(|candidate| {
                        self.binding.owner_attestation.as_ref() == Some(candidate)
                            && candidate.owner_pubkey == self.binding.owner_pubkey
                    })
            }
            RelayAuthPurposeV1::Nip98 { url, .. } => url == &self.binding.relay_query_url,
        }
    }

    fn close(&mut self, reason: SessionCloseReason) {
        self.closed = Some(reason);
        self.next_sequence = None;
        self.cached_results.clear();
        self.cache_order.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::{
        OperationV1, RelayAuthPurposeV1, RELAY_AUTH_SIGN_PROTOCOL, SIGNING_FRAME_PROTOCOL,
    };
    use nostr::Keys;

    fn hex(value: char) -> Hex64 {
        Hex64::parse(value.to_string().repeat(64)).expect("valid fixture hex")
    }

    fn session() -> LocalBrokerSession {
        LocalBrokerSession::new(LocalBrokerSessionBinding {
            owner_pubkey: hex('a'),
            resident_pubkey: hex('b'),
            acp_pid: 4242,
            session_epoch: SafeU53::new(9).expect("valid epoch"),
            runtime_configuration_sha256: hex('c'),
            installation_session_id: OpaqueId::parse("installation-1")
                .expect("valid installation ID"),
            relay_url: "wss://relay.example.test".to_owned(),
            relay_query_url: "https://relay.example.test/query".to_owned(),
            owner_attestation: None,
        })
        .expect("valid session")
    }

    fn frame(sequence: u64, request_id: &str) -> SigningFrameV1<RelayAuthSignRequestV1> {
        SigningFrameV1 {
            protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
            session_epoch: SafeU53::new(9).expect("valid epoch"),
            sequence: SafeU53::new(sequence).expect("valid sequence"),
            request_id: OpaqueId::parse(request_id).expect("valid request ID"),
            operation: OperationV1::RelayAuthSign,
            payload: RelayAuthSignRequestV1 {
                protocol: RELAY_AUTH_SIGN_PROTOCOL.to_owned(),
                resident_pubkey: hex('b'),
                purpose: RelayAuthPurposeV1::Nip42 {
                    relay_url: "wss://relay.example.test".to_owned(),
                    challenge: "challenge-1".to_owned(),
                    owner_attestation: None,
                },
            },
            deadline_unix_ms: SafeU53::new(10_020).expect("valid deadline"),
        }
    }

    #[test]
    fn luca_signing_session_rejects_sequence_gap_and_stays_closed() {
        let mut session = session();
        let caller = LocalBrokerCaller {
            acp_pid: 4242,
            runtime_configuration_sha256: &hex('c'),
        };
        let gap = frame(2, "request-2");
        assert!(matches!(
            session.authorize_relay_auth(&gap, caller, 10_000),
            Err(LocalBrokerSessionError::OrderingMismatch)
        ));
        let first = frame(1, "request-1");
        assert!(matches!(
            session.authorize_relay_auth(&first, caller, 10_000),
            Err(LocalBrokerSessionError::Closed(
                SessionCloseReason::OrderingMismatch
            ))
        ));
    }

    #[test]
    fn luca_signing_session_rejects_wrong_pid() {
        let mut session = session();
        let runtime = hex('c');
        let caller = LocalBrokerCaller {
            acp_pid: 4243,
            runtime_configuration_sha256: &runtime,
        };
        assert!(matches!(
            session.authorize_relay_auth(&frame(1, "request-1"), caller, 10_000),
            Err(LocalBrokerSessionError::CallerMismatch)
        ));
    }

    #[test]
    fn luca_signing_session_accepts_only_the_exact_app_owned_attestation() {
        let resident = Keys::parse(&"04".repeat(32)).expect("valid resident key");
        let owner_a = Keys::parse(&"05".repeat(32)).expect("valid owner key");
        let owner_b = Keys::parse(&"06".repeat(32)).expect("valid alternate owner key");
        let attestation = |owner: &Keys| {
            let tag = buzz_sdk_pkg::nip_oa::compute_auth_tag(owner, &resident.public_key(), "")
                .expect("valid owner attestation");
            let value: serde_json::Value = serde_json::from_str(&tag).expect("valid tag JSON");
            serde_json::from_value(serde_json::json!({
                "owner_pubkey": value[1],
                "conditions": value[2],
                "signature": value[3],
            }))
            .expect("valid typed owner attestation")
        };
        let stored_attestation = attestation(&owner_a);
        let substituted_attestation = attestation(&owner_b);
        let resident_pubkey =
            Hex64::parse(resident.public_key().to_hex()).expect("valid resident pubkey");
        let runtime = hex('c');
        let mut session = LocalBrokerSession::new(LocalBrokerSessionBinding {
            owner_pubkey: Hex64::parse(owner_a.public_key().to_hex()).expect("valid owner pubkey"),
            resident_pubkey: resident_pubkey.clone(),
            acp_pid: 4242,
            session_epoch: SafeU53::new(9).expect("valid epoch"),
            runtime_configuration_sha256: runtime.clone(),
            installation_session_id: OpaqueId::parse("installation-1")
                .expect("valid installation ID"),
            relay_url: "wss://relay.example.test".to_owned(),
            relay_query_url: "https://relay.example.test/query".to_owned(),
            owner_attestation: Some(stored_attestation),
        })
        .expect("valid session");
        let frame = SigningFrameV1 {
            protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
            session_epoch: SafeU53::new(9).expect("valid epoch"),
            sequence: SafeU53::new(1).expect("valid sequence"),
            request_id: OpaqueId::parse("request-1").expect("valid request ID"),
            operation: OperationV1::RelayAuthSign,
            payload: RelayAuthSignRequestV1 {
                protocol: RELAY_AUTH_SIGN_PROTOCOL.to_owned(),
                resident_pubkey,
                purpose: RelayAuthPurposeV1::Nip42 {
                    relay_url: "wss://relay.example.test".to_owned(),
                    challenge: "challenge-1".to_owned(),
                    owner_attestation: Some(substituted_attestation),
                },
            },
            deadline_unix_ms: SafeU53::new(10_020).expect("valid deadline"),
        };
        assert!(matches!(
            session.authorize_relay_auth(
                &frame,
                LocalBrokerCaller {
                    acp_pid: 4242,
                    runtime_configuration_sha256: &runtime,
                },
                10_000,
            ),
            Err(LocalBrokerSessionError::PolicyMismatch)
        ));
    }
}
