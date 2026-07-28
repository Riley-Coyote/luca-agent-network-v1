//! Typed, semantic relay-auth signing contract.

use crate::{
    parse_and_canonicalize_strict, Hex64, OpaqueId, ProtocolValueError, BROKER_FRAME_MAX_BYTES,
};
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
    /// The returned signed event was absent, oversized, noncanonical, or mismatched.
    #[error("signed relay-auth event is invalid")]
    SignedEvent,
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
    /// Validate result/event consistency without interpreting event policy.
    pub fn validate(&self) -> Result<(), RelayAuthError> {
        let Self::Signed {
            event_id,
            signed_event_json,
        } = self
        else {
            return Ok(());
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
        let event: Value =
            serde_json::from_slice(&canonical).map_err(|_| RelayAuthError::SignedEvent)?;
        if event.get("id").and_then(Value::as_str) != Some(event_id.as_str()) {
            return Err(RelayAuthError::SignedEvent);
        }
        Ok(())
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
