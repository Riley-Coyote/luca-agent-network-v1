//! Typed, semantic relay-auth signing contract.

use crate::frame::{sealed, BrokerOperationV1, OperationV1};
use crate::{
    parse_and_canonicalize_strict, Hex64, OpaqueId, ProtocolValueError, SafeU53,
    BROKER_FRAME_MAX_BYTES, JSON_SAFE_INTEGER_MAX,
};
use nostr::{JsonUtil, Kind};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// Relay-auth signing protocol identifier.
pub const RELAY_AUTH_SIGN_PROTOCOL: &str = "luca.relay-auth.sign.v1";
/// Maximum configured relay/auth URL size.
pub const MAX_RELAY_AUTH_URL_BYTES: usize = 2_048;
/// Maximum NIP-42 challenge size.
pub const MAX_RELAY_AUTH_CHALLENGE_BYTES: usize = 1_024;
/// Maximum exact signed public auth-event JSON size.
pub const MAX_RELAY_AUTH_EVENT_BYTES: usize = 16_384;
/// Maximum accepted clock skew and NIP-98 request lifetime.
pub const MAX_RELAY_AUTH_FRESHNESS_SECS: u64 = 60;

/// Validation failure for a typed relay-auth request or result.
#[derive(Debug, thiserror::Error)]
pub enum RelayAuthError {
    /// A validated scalar was invalid.
    #[error(transparent)]
    Value(#[from] ProtocolValueError),
    /// The request named the wrong protocol.
    #[error("protocol must be luca.relay-auth.sign.v1")]
    Protocol,
    /// A relay or HTTP URL was invalid or outside the G1 allowlist.
    #[error("relay-auth URL is invalid or outside the G1 allowlist")]
    Url,
    /// The NIP-42 challenge was empty, oversized, or contained controls.
    #[error("NIP-42 challenge must contain 1..1024 UTF-8 bytes without control characters")]
    Challenge,
    /// The HTTP method was not allowed.
    #[error("G1 relay HTTP authentication permits POST only")]
    Method,
    /// A NIP-98 POST did not bind its exact request body hash.
    #[error("NIP-98 POST requires payload_sha256")]
    PayloadHash,
    /// A NIP-98 nonce was absent or its expiry was stale/unbounded.
    #[error("NIP-98 nonce/expiry is invalid or outside the 60-second window")]
    Expiry,
    /// The returned signed event was absent, oversized, noncanonical, or mismatched.
    #[error("signed relay-auth event is invalid")]
    SignedEvent,
    /// A valid public auth event did not match the originating typed request.
    #[error("signed relay-auth event does not match the typed request")]
    EventMismatch,
}

/// G1 HTTP methods available to the ACP relay-auth client.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum RelayHttpMethodV1 {
    /// POST is required by Buzz's `/query` bridge.
    Post,
}

/// Semantic relay-auth operation. Callers cannot provide arbitrary event bytes,
/// tags, timestamps, nonces, kinds, or content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RelayAuthPurposeV1 {
    /// Sign one NIP-42 challenge for the configured relay.
    Nip42 {
        /// Exact configured WebSocket relay URL.
        relay_url: String,
        /// Relay-provided bounded challenge.
        challenge: String,
    },
    /// Sign one NIP-98 request for the exact Buzz query bridge.
    Nip98 {
        /// G1 permits POST only.
        method: RelayHttpMethodV1,
        /// Exact HTTP query-bridge URL.
        url: String,
        /// SHA-256 of the exact request body.
        payload_sha256: Option<Hex64>,
        /// Per-attempt replay nonce, committed into the signed event.
        nonce: OpaqueId,
        /// Absolute Unix expiry, no more than 60 seconds from validation.
        expires_at_unix_secs: SafeU53,
    },
}

/// A policy-bound request for one relay authentication signature.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RelayAuthSignRequestV1 {
    /// Frozen request protocol.
    pub protocol: String,
    /// Desktop-bound resident public identity.
    pub resident_pubkey: Hex64,
    /// Exact semantic auth purpose.
    pub purpose: RelayAuthPurposeV1,
}

impl sealed::Sealed for RelayAuthSignRequestV1 {}

impl BrokerOperationV1 for RelayAuthSignRequestV1 {
    const OPERATION: OperationV1 = OperationV1::RelayAuthSign;
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRelayAuthSignRequestV1 {
    protocol: String,
    resident_pubkey: Hex64,
    purpose: RelayAuthPurposeV1,
}

impl RelayAuthSignRequestV1 {
    /// Validate the strict G1 relay-auth request boundary.
    pub fn validate(&self) -> Result<(), RelayAuthError> {
        if self.protocol != RELAY_AUTH_SIGN_PROTOCOL {
            return Err(RelayAuthError::Protocol);
        }
        match &self.purpose {
            RelayAuthPurposeV1::Nip42 {
                relay_url,
                challenge,
            } => {
                validate_url(relay_url, UrlKind::Relay)?;
                if challenge.is_empty()
                    || challenge.len() > MAX_RELAY_AUTH_CHALLENGE_BYTES
                    || challenge.chars().any(char::is_control)
                {
                    return Err(RelayAuthError::Challenge);
                }
            }
            RelayAuthPurposeV1::Nip98 {
                method,
                url,
                payload_sha256,
                ..
            } => {
                if *method != RelayHttpMethodV1::Post {
                    return Err(RelayAuthError::Method);
                }
                validate_url(url, UrlKind::QueryBridge)?;
                if payload_sha256.is_none() {
                    return Err(RelayAuthError::PayloadHash);
                }
            }
        }
        Ok(())
    }

    /// Validate the request's bounded wall-clock semantics.
    pub fn validate_at(&self, now_unix_secs: u64) -> Result<(), RelayAuthError> {
        self.validate()?;
        let RelayAuthPurposeV1::Nip98 {
            expires_at_unix_secs,
            ..
        } = &self.purpose
        else {
            return Ok(());
        };
        let expiry = expires_at_unix_secs.get();
        if expiry < now_unix_secs
            || expiry > now_unix_secs.saturating_add(MAX_RELAY_AUTH_FRESHNESS_SECS)
        {
            return Err(RelayAuthError::Expiry);
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for RelayAuthSignRequestV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawRelayAuthSignRequestV1::deserialize(deserializer)?;
        let request = Self {
            protocol: raw.protocol,
            resident_pubkey: raw.resident_pubkey,
            purpose: raw.purpose,
        };
        request.validate().map_err(serde::de::Error::custom)?;
        Ok(request)
    }
}

/// Typed response to one relay-auth signing request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum RelayAuthSignResultV1 {
    /// Desktop authority returned one exact signed public auth event.
    Signed {
        /// Signed Nostr event ID.
        event_id: Hex64,
        /// RFC 8785 canonical event JSON. This is public auth material, not a key.
        signed_event_json: String,
    },
    /// Desktop policy denied signing.
    Denied { code: OpaqueId },
    /// The request was invalid.
    Invalid { code: OpaqueId },
    /// The desktop broker was unavailable.
    Unavailable { code: OpaqueId },
}

impl sealed::Sealed for RelayAuthSignResultV1 {}

impl BrokerOperationV1 for RelayAuthSignResultV1 {
    const OPERATION: OperationV1 = OperationV1::RelayAuthSign;
}

#[derive(Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum RawRelayAuthSignResultV1 {
    Signed {
        event_id: Hex64,
        signed_event_json: String,
    },
    Denied {
        code: OpaqueId,
    },
    Invalid {
        code: OpaqueId,
    },
    Unavailable {
        code: OpaqueId,
    },
}

impl RelayAuthSignResultV1 {
    /// Validate that a signed result is an exact canonical, cryptographically
    /// valid NIP-42 or NIP-98 public auth event.
    pub fn validate(&self) -> Result<(), RelayAuthError> {
        if !matches!(self, Self::Signed { .. }) {
            return Ok(());
        }
        let (event, value) = self.parse_signed_event()?;
        let tags = value["tags"]
            .as_array()
            .ok_or(RelayAuthError::SignedEvent)?;
        let valid_tag_shape = match event.kind {
            Kind::Authentication => {
                tags.len() == 2 && tag_is(&tags[0], "challenge") && tag_is(&tags[1], "relay")
            }
            Kind::HttpAuth => {
                tags.len() == 4
                    && tag_is(&tags[0], "u")
                    && tag_is(&tags[1], "method")
                    && tag_is(&tags[2], "nonce")
                    && tag_is(&tags[3], "payload")
            }
            _ => false,
        };
        if !valid_tag_shape
            || value["content"].as_str() != Some("")
            || value["created_at"]
                .as_u64()
                .is_none_or(|timestamp| timestamp > JSON_SAFE_INTEGER_MAX)
        {
            return Err(RelayAuthError::SignedEvent);
        }
        Ok(())
    }

    /// Bind one cryptographically valid signed result to the exact request and
    /// caller-supplied validation instant.
    pub fn validate_against(
        &self,
        request: &RelayAuthSignRequestV1,
        now_unix_secs: u64,
    ) -> Result<(), RelayAuthError> {
        request.validate_at(now_unix_secs)?;
        let Self::Signed { .. } = self else {
            return Ok(());
        };
        self.validate()?;
        let (event, value) = self.parse_signed_event()?;
        if event.pubkey.to_hex() != request.resident_pubkey.as_str() {
            return Err(RelayAuthError::EventMismatch);
        }
        let created_at = value["created_at"]
            .as_u64()
            .ok_or(RelayAuthError::EventMismatch)?;
        if created_at.abs_diff(now_unix_secs) > MAX_RELAY_AUTH_FRESHNESS_SECS {
            return Err(RelayAuthError::EventMismatch);
        }
        let expected_tags = match &request.purpose {
            RelayAuthPurposeV1::Nip42 {
                relay_url,
                challenge,
            } => {
                if event.kind != Kind::Authentication {
                    return Err(RelayAuthError::EventMismatch);
                }
                serde_json::json!([["challenge", challenge], ["relay", relay_url]])
            }
            RelayAuthPurposeV1::Nip98 {
                method,
                url,
                payload_sha256,
                nonce,
                expires_at_unix_secs,
            } => {
                if event.kind != Kind::HttpAuth
                    || created_at > expires_at_unix_secs.get()
                    || *method != RelayHttpMethodV1::Post
                {
                    return Err(RelayAuthError::EventMismatch);
                }
                let payload = payload_sha256
                    .as_ref()
                    .ok_or(RelayAuthError::EventMismatch)?;
                serde_json::json!([
                    ["u", url],
                    ["method", "POST"],
                    ["nonce", nonce.as_str()],
                    ["payload", payload.as_str()]
                ])
            }
        };
        if value["tags"] != expected_tags {
            return Err(RelayAuthError::EventMismatch);
        }
        Ok(())
    }

    fn parse_signed_event(&self) -> Result<(nostr::Event, Value), RelayAuthError> {
        let Self::Signed {
            event_id,
            signed_event_json,
        } = self
        else {
            return Err(RelayAuthError::SignedEvent);
        };
        if signed_event_json.is_empty() || signed_event_json.len() > MAX_RELAY_AUTH_EVENT_BYTES {
            return Err(RelayAuthError::SignedEvent);
        }
        let canonical = parse_and_canonicalize_strict(
            signed_event_json.as_bytes(),
            MAX_RELAY_AUTH_EVENT_BYTES.min(BROKER_FRAME_MAX_BYTES),
        )
        .map_err(|_| RelayAuthError::SignedEvent)?;
        if canonical != signed_event_json.as_bytes() {
            return Err(RelayAuthError::SignedEvent);
        }
        let value: Value =
            serde_json::from_slice(&canonical).map_err(|_| RelayAuthError::SignedEvent)?;
        let object = value.as_object().ok_or(RelayAuthError::SignedEvent)?;
        const EVENT_FIELDS: [&str; 7] = [
            "content",
            "created_at",
            "id",
            "kind",
            "pubkey",
            "sig",
            "tags",
        ];
        if object.len() != EVENT_FIELDS.len()
            || EVENT_FIELDS
                .iter()
                .any(|field| !object.contains_key(*field))
        {
            return Err(RelayAuthError::SignedEvent);
        }
        if value.get("id").and_then(Value::as_str) != Some(event_id.as_str()) {
            return Err(RelayAuthError::SignedEvent);
        }
        let event =
            nostr::Event::from_json(signed_event_json).map_err(|_| RelayAuthError::SignedEvent)?;
        if event.id.to_hex() != event_id.as_str() || !event.verify_id() || !event.verify_signature()
        {
            return Err(RelayAuthError::SignedEvent);
        }
        Ok((event, value))
    }
}

impl<'de> Deserialize<'de> for RelayAuthSignResultV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawRelayAuthSignResultV1::deserialize(deserializer)?;
        let result = match raw {
            RawRelayAuthSignResultV1::Signed {
                event_id,
                signed_event_json,
            } => Self::Signed {
                event_id,
                signed_event_json,
            },
            RawRelayAuthSignResultV1::Denied { code } => Self::Denied { code },
            RawRelayAuthSignResultV1::Invalid { code } => Self::Invalid { code },
            RawRelayAuthSignResultV1::Unavailable { code } => Self::Unavailable { code },
        };
        result.validate().map_err(serde::de::Error::custom)?;
        Ok(result)
    }
}

enum UrlKind {
    Relay,
    QueryBridge,
}

fn tag_is(value: &Value, expected_name: &str) -> bool {
    let Some(parts) = value.as_array() else {
        return false;
    };
    parts.len() == 2 && parts[0].as_str() == Some(expected_name) && parts[1].as_str().is_some()
}

fn validate_url(value: &str, kind: UrlKind) -> Result<(), RelayAuthError> {
    if value.is_empty() || value.len() > MAX_RELAY_AUTH_URL_BYTES || !value.is_ascii() {
        return Err(RelayAuthError::Url);
    }
    let parsed = url::Url::parse(value).map_err(|_| RelayAuthError::Url)?;
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() {
        return Err(RelayAuthError::Url);
    }
    match kind {
        UrlKind::Relay => {
            if !matches!(parsed.scheme(), "ws" | "wss")
                || parsed.host_str().is_none()
                || parsed.query().is_some()
                || parsed.path() != "/"
            {
                return Err(RelayAuthError::Url);
            }
        }
        UrlKind::QueryBridge => {
            if !matches!(parsed.scheme(), "http" | "https")
                || parsed.host_str().is_none()
                || parsed.query().is_some()
                || parsed.path() != "/query"
            {
                return Err(RelayAuthError::Url);
            }
        }
    }
    Ok(())
}
