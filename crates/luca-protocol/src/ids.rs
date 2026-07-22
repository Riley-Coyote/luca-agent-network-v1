//! Validated protocol scalar types.

use chrono::DateTime;
use serde::{Deserialize, Deserializer, Serialize};
use std::fmt;

/// Largest integer that is exactly interoperable in Luca JSON fields.
pub const JSON_SAFE_INTEGER_MAX: u64 = (1_u64 << 53) - 1;

/// Validation failure for a protocol scalar.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid {kind}: {reason}")]
pub struct ProtocolValueError {
    kind: &'static str,
    reason: &'static str,
}

impl ProtocolValueError {
    fn new(kind: &'static str, reason: &'static str) -> Self {
        Self { kind, reason }
    }

    pub(crate) fn new_for_internal_use(kind: &'static str, reason: &'static str) -> Self {
        Self::new(kind, reason)
    }
}

/// A lowercase 32-byte hexadecimal value.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct Hex64(String);

impl Hex64 {
    /// Validate and construct a lowercase 64-hex value.
    pub fn parse(value: impl Into<String>) -> Result<Self, ProtocolValueError> {
        let value = value.into();
        if value.len() != 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(ProtocolValueError::new(
                "hex64",
                "expected 64 lowercase hexadecimal characters",
            ));
        }
        Ok(Self(value))
    }

    /// Borrow the validated representation.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Decode the validated value into exactly 32 bytes.
    pub fn decode(&self) -> Result<[u8; 32], ProtocolValueError> {
        let bytes = hex::decode(&self.0)
            .map_err(|_| ProtocolValueError::new("hex64", "hex decode failed"))?;
        bytes
            .try_into()
            .map_err(|_| ProtocolValueError::new("hex64", "decoded length was not 32"))
    }
}

impl fmt::Debug for Hex64 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for Hex64 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::parse(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// A bounded ASCII Luca request, turn, dispatch, conversation, or receipt ID.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct OpaqueId(String);

impl OpaqueId {
    /// Validate and construct an opaque ID.
    pub fn parse(value: impl Into<String>) -> Result<Self, ProtocolValueError> {
        let value = value.into();
        if value.is_empty() || value.len() > 128 {
            return Err(ProtocolValueError::new(
                "opaque ID",
                "length must be 1..128 ASCII bytes",
            ));
        }
        if !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
        {
            return Err(ProtocolValueError::new(
                "opaque ID",
                "contains a character outside [A-Za-z0-9._:-]",
            ));
        }
        Ok(Self(value))
    }

    /// Borrow the validated representation.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for OpaqueId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for OpaqueId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::parse(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// A non-negative JSON integer no larger than 2^53-1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct SafeU53(u64);

impl SafeU53 {
    /// Validate and construct a safe JSON integer.
    pub fn new(value: u64) -> Result<Self, ProtocolValueError> {
        if value > JSON_SAFE_INTEGER_MAX {
            return Err(ProtocolValueError::new("integer", "value exceeds 2^53-1"));
        }
        Ok(Self(value))
    }

    /// Return the integer value.
    pub fn get(self) -> u64 {
        self.0
    }
}

impl<'de> Deserialize<'de> for SafeU53 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::new(u64::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// A canonical UTC RFC3339 timestamp with whole-second precision.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct CanonicalTimestamp(String);

impl CanonicalTimestamp {
    /// Validate and construct a canonical UTC timestamp.
    pub fn parse(value: impl Into<String>) -> Result<Self, ProtocolValueError> {
        let value = value.into();
        let shape_ok = value.len() == 20
            && value.as_bytes().get(4) == Some(&b'-')
            && value.as_bytes().get(7) == Some(&b'-')
            && value.as_bytes().get(10) == Some(&b'T')
            && value.as_bytes().get(13) == Some(&b':')
            && value.as_bytes().get(16) == Some(&b':')
            && value.ends_with('Z');
        if !shape_ok || DateTime::parse_from_rfc3339(&value).is_err() {
            return Err(ProtocolValueError::new(
                "timestamp",
                "expected valid YYYY-MM-DDTHH:MM:SSZ",
            ));
        }
        Ok(Self(value))
    }

    /// Borrow the timestamp.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for CanonicalTimestamp {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for CanonicalTimestamp {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::parse(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// A lowercase UUIDv4 bundle identifier.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct BundleId(String);

impl BundleId {
    /// Validate and construct a lowercase UUIDv4.
    pub fn parse(value: impl Into<String>) -> Result<Self, ProtocolValueError> {
        let value = value.into();
        let parsed = uuid::Uuid::parse_str(&value)
            .map_err(|_| ProtocolValueError::new("bundle ID", "expected lowercase UUIDv4"))?;
        if parsed.get_version_num() != 4 || parsed.to_string() != value {
            return Err(ProtocolValueError::new(
                "bundle ID",
                "expected lowercase UUIDv4",
            ));
        }
        Ok(Self(value))
    }

    /// Borrow the identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for BundleId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for BundleId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::parse(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// A body-free diagnostic reference of the form `sha256:<64 lowercase hex>`.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct Sha256Ref(String);

impl Sha256Ref {
    /// Validate and construct a diagnostic reference.
    pub fn parse(value: impl Into<String>) -> Result<Self, ProtocolValueError> {
        let value = value.into();
        let Some(hex) = value.strip_prefix("sha256:") else {
            return Err(ProtocolValueError::new(
                "diagnostic reference",
                "expected sha256:<64 lowercase hex>",
            ));
        };
        Hex64::parse(hex.to_owned())?;
        Ok(Self(value))
    }

    /// Borrow the reference.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Sha256Ref {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for Sha256Ref {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::parse(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}
