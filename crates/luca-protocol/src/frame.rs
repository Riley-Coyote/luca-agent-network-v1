//! Length-prefixed, canonical M1 signing-broker frames.

use crate::{canonicalize, parse_strict_json, CanonicalError, OpaqueId, SafeU53};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// Frozen maximum canonical JSON frame size.
pub const BROKER_FRAME_MAX_BYTES: usize = 131_072;
/// Frozen signing frame protocol discriminator.
pub const SIGNING_FRAME_PROTOCOL: &str = "luca.signing.frame.v1";
const MAX_DEADLINE_DELTA_MS: u64 = 30_000;

/// Allowlisted M1 broker operations represented by this shared surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OperationV1 {
    /// Publish one successfully terminated, app-bound final message.
    #[serde(rename = "message.publish.v1")]
    MessagePublish,
    /// Sign one policy-bound relay NIP-42 or NIP-98 authentication event.
    #[serde(rename = "relay_auth.sign.v1")]
    RelayAuthSign,
}

/// One typed request frame on an inherited broker channel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningFrameV1<T> {
    /// Frozen frame protocol.
    pub protocol: String,
    /// Desktop-issued ACP session epoch.
    pub session_epoch: SafeU53,
    /// Per-session sequence, beginning at one.
    pub sequence: SafeU53,
    /// Bounded idempotent request identifier.
    pub request_id: OpaqueId,
    /// Allowlisted typed operation.
    pub operation: OperationV1,
    /// Operation-specific semantic payload.
    pub payload: T,
    /// Absolute Unix deadline in milliseconds.
    pub deadline_unix_ms: SafeU53,
}

/// One typed response frame on an inherited broker channel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningResultFrameV1<T> {
    /// Frozen frame protocol.
    pub protocol: String,
    /// Desktop-issued ACP session epoch echoed from the request.
    pub session_epoch: SafeU53,
    /// Per-session sequence echoed from the request.
    pub sequence: SafeU53,
    /// Request identifier echoed from the request.
    pub request_id: OpaqueId,
    /// Operation echoed from the request.
    pub operation: OperationV1,
    /// Operation-specific typed result.
    pub result: T,
}

/// Frame validation or encoding failure.
#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    /// Canonical JSON processing failed.
    #[error(transparent)]
    Canonical(#[from] CanonicalError),
    /// Typed JSON decoding failed.
    #[error("typed frame decoding failed: {0}")]
    Decode(#[from] serde_json::Error),
    /// The frame protocol was incorrect.
    #[error("protocol must be luca.signing.frame.v1")]
    Protocol,
    /// Sequence zero is forbidden.
    #[error("sequence must start at 1")]
    SequenceZero,
    /// Deadline was expired or more than 30000 ms in the future.
    #[error("deadline must be current and at most now plus 30000 ms")]
    Deadline,
    /// The canonical JSON frame exceeded the frozen bound.
    #[error("canonical frame exceeds 131072 UTF-8 bytes")]
    FrameTooLarge,
    /// The wire payload was valid JSON but was not its RFC 8785 representation.
    #[error("frame payload is not RFC8785 canonical JSON")]
    NonCanonical,
    /// The length prefix and payload did not agree.
    #[error("invalid length-prefixed frame")]
    LengthPrefix,
}

impl<T> SigningFrameV1<T> {
    /// Validate stateless frame invariants at a caller-supplied clock instant.
    pub fn validate_at(&self, now_unix_ms: u64) -> Result<(), FrameError> {
        if self.protocol != SIGNING_FRAME_PROTOCOL {
            return Err(FrameError::Protocol);
        }
        if self.sequence.get() == 0 {
            return Err(FrameError::SequenceZero);
        }
        let deadline = self.deadline_unix_ms.get();
        let latest = now_unix_ms.saturating_add(MAX_DEADLINE_DELTA_MS);
        if deadline < now_unix_ms || deadline > latest {
            return Err(FrameError::Deadline);
        }
        Ok(())
    }
}

impl<T> SigningResultFrameV1<T> {
    /// Validate stateless response-frame invariants.
    pub fn validate(&self) -> Result<(), FrameError> {
        if self.protocol != SIGNING_FRAME_PROTOCOL {
            return Err(FrameError::Protocol);
        }
        if self.sequence.get() == 0 {
            return Err(FrameError::SequenceZero);
        }
        Ok(())
    }
}

/// Encode one validated frame as u32-be length plus RFC 8785 JSON.
pub fn encode_length_prefixed_frame<T: Serialize>(
    frame: &SigningFrameV1<T>,
    now_unix_ms: u64,
) -> Result<Vec<u8>, FrameError> {
    frame.validate_at(now_unix_ms)?;
    let canonical = canonicalize(frame)?;
    if canonical.len() > BROKER_FRAME_MAX_BYTES {
        return Err(FrameError::FrameTooLarge);
    }
    let length = u32::try_from(canonical.len()).map_err(|_| FrameError::FrameTooLarge)?;
    let mut encoded = Vec::with_capacity(4 + canonical.len());
    encoded.extend_from_slice(&length.to_be_bytes());
    encoded.extend_from_slice(&canonical);
    Ok(encoded)
}

/// Decode one exact length-prefixed strict JSON frame and validate its deadline.
pub fn decode_length_prefixed_frame<T: DeserializeOwned>(
    bytes: &[u8],
    now_unix_ms: u64,
) -> Result<SigningFrameV1<T>, FrameError> {
    let prefix: [u8; 4] = bytes
        .get(..4)
        .ok_or(FrameError::LengthPrefix)?
        .try_into()
        .map_err(|_| FrameError::LengthPrefix)?;
    let declared = u32::from_be_bytes(prefix) as usize;
    if declared > BROKER_FRAME_MAX_BYTES || bytes.len() != declared.saturating_add(4) {
        return Err(FrameError::LengthPrefix);
    }
    let payload = &bytes[4..];
    let value = parse_strict_json(payload, BROKER_FRAME_MAX_BYTES)?;
    if canonicalize(&value)?.as_slice() != payload {
        return Err(FrameError::NonCanonical);
    }
    let frame: SigningFrameV1<T> = serde_json::from_value(value)?;
    frame.validate_at(now_unix_ms)?;
    Ok(frame)
}

/// Encode one validated response frame as u32-be length plus RFC 8785 JSON.
pub fn encode_length_prefixed_result_frame<T: Serialize>(
    frame: &SigningResultFrameV1<T>,
) -> Result<Vec<u8>, FrameError> {
    frame.validate()?;
    let canonical = canonicalize(frame)?;
    if canonical.len() > BROKER_FRAME_MAX_BYTES {
        return Err(FrameError::FrameTooLarge);
    }
    let length = u32::try_from(canonical.len()).map_err(|_| FrameError::FrameTooLarge)?;
    let mut encoded = Vec::with_capacity(4 + canonical.len());
    encoded.extend_from_slice(&length.to_be_bytes());
    encoded.extend_from_slice(&canonical);
    Ok(encoded)
}

/// Decode one exact length-prefixed canonical response frame.
pub fn decode_length_prefixed_result_frame<T: DeserializeOwned>(
    bytes: &[u8],
) -> Result<SigningResultFrameV1<T>, FrameError> {
    let prefix: [u8; 4] = bytes
        .get(..4)
        .ok_or(FrameError::LengthPrefix)?
        .try_into()
        .map_err(|_| FrameError::LengthPrefix)?;
    let declared = u32::from_be_bytes(prefix) as usize;
    if declared > BROKER_FRAME_MAX_BYTES || bytes.len() != declared.saturating_add(4) {
        return Err(FrameError::LengthPrefix);
    }
    let payload = &bytes[4..];
    let value = parse_strict_json(payload, BROKER_FRAME_MAX_BYTES)?;
    if canonicalize(&value)?.as_slice() != payload {
        return Err(FrameError::NonCanonical);
    }
    let frame: SigningResultFrameV1<T> = serde_json::from_value(value)?;
    frame.validate()?;
    Ok(frame)
}
