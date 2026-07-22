//! Protected owner-identity inner manifest contract.

use crate::{canonicalize, BundleId, CanonicalError, CanonicalTimestamp, Hex64};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};
use std::fmt;
use zeroize::{Zeroize, Zeroizing};

/// Frozen owner identity format name.
pub const OWNER_IDENTITY_FORMAT: &str = "luca.owner.identity";
/// Frozen owner identity format version.
pub const OWNER_IDENTITY_VERSION: u8 = 1;
/// Frozen canonicalization declaration.
pub const OWNER_IDENTITY_CANONICALIZATION: &str = "RFC8785";

/// An nsec secret whose owned buffer is zeroized and never debug-printed.
pub struct SecretNsec(String);

impl SecretNsec {
    /// Construct an owned nsec value. Full key validity is checked by the
    /// desktop key authority before import or activation.
    pub fn new(value: impl Into<String>) -> Result<Self, OwnerIdentityError> {
        let value = value.into();
        if !value.starts_with("nsec1") || value.len() < 10 || !value.is_ascii() {
            return Err(OwnerIdentityError::SecretEncoding);
        }
        Ok(Self(value))
    }

    /// Use the secret within a lexical callback without cloning it.
    pub fn with_exposed<R>(&self, callback: impl FnOnce(&str) -> R) -> R {
        callback(&self.0)
    }
}

impl Drop for SecretNsec {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl fmt::Debug for SecretNsec {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretNsec([REDACTED])")
    }
}

impl Serialize for SecretNsec {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for SecretNsec {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::new(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// The RFC 8785 JSON encrypted inside a `.luca-owner.age` file.
#[derive(Serialize)]
pub struct OwnerIdentityBundleV1 {
    /// Frozen format discriminator.
    pub format: String,
    /// Frozen format version.
    pub version: u8,
    /// Frozen canonicalization declaration.
    pub canonicalization: String,
    /// Lowercase UUIDv4 export identifier.
    pub bundle_id: BundleId,
    /// Canonical whole-second UTC export timestamp.
    pub exported_at: CanonicalTimestamp,
    /// Exact Luca owner public key.
    pub owner_pubkey: Hex64,
    /// Exact owner secret, present only inside protected or zeroizing buffers.
    pub owner_secret_nsec: SecretNsec,
    /// SHA-256 over canonical bytes with this member omitted.
    pub manifest_sha256: Hex64,
}

impl fmt::Debug for OwnerIdentityBundleV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OwnerIdentityBundleV1")
            .field("format", &self.format)
            .field("version", &self.version)
            .field("canonicalization", &self.canonicalization)
            .field("bundle_id", &self.bundle_id)
            .field("exported_at", &self.exported_at)
            .field("owner_pubkey", &self.owner_pubkey)
            .field("owner_secret_nsec", &"[REDACTED]")
            .field("manifest_sha256", &self.manifest_sha256)
            .finish()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawOwnerIdentityBundleV1 {
    format: String,
    version: u8,
    canonicalization: String,
    bundle_id: BundleId,
    exported_at: CanonicalTimestamp,
    owner_pubkey: Hex64,
    owner_secret_nsec: SecretNsec,
    manifest_sha256: Hex64,
}

/// Validation failure for a protected owner identity manifest.
#[derive(Debug, thiserror::Error)]
pub enum OwnerIdentityError {
    /// The format/version/canonicalization discriminator was wrong.
    #[error("owner identity protocol discriminator is invalid")]
    Protocol,
    /// The owner secret was not encoded as an nsec string.
    #[error("owner secret must use nsec encoding")]
    SecretEncoding,
    /// RFC 8785 serialization failed.
    #[error(transparent)]
    Canonical(#[from] CanonicalError),
    /// The manifest hash did not match the canonical inner data.
    #[error("owner identity manifest hash mismatch")]
    ManifestHash,
}

#[derive(Serialize)]
struct OwnerIdentityHashInput<'a> {
    format: &'a str,
    version: u8,
    canonicalization: &'a str,
    bundle_id: &'a BundleId,
    exported_at: &'a CanonicalTimestamp,
    owner_pubkey: &'a Hex64,
    owner_secret_nsec: &'a SecretNsec,
}

impl OwnerIdentityBundleV1 {
    /// Calculate the frozen manifest hash without retaining plaintext bytes.
    pub fn calculate_manifest_sha256(&self) -> Result<Hex64, OwnerIdentityError> {
        let input = OwnerIdentityHashInput {
            format: &self.format,
            version: self.version,
            canonicalization: &self.canonicalization,
            bundle_id: &self.bundle_id,
            exported_at: &self.exported_at,
            owner_pubkey: &self.owner_pubkey,
            owner_secret_nsec: &self.owner_secret_nsec,
        };
        let canonical = Zeroizing::new(canonicalize(&input)?);
        Hex64::parse(hex::encode(Sha256::digest(canonical.as_slice())))
            .map_err(|_| OwnerIdentityError::ManifestHash)
    }

    /// Verify all discriminators and the field-omitting manifest hash.
    pub fn validate(&self) -> Result<(), OwnerIdentityError> {
        if self.format != OWNER_IDENTITY_FORMAT
            || self.version != OWNER_IDENTITY_VERSION
            || self.canonicalization != OWNER_IDENTITY_CANONICALIZATION
        {
            return Err(OwnerIdentityError::Protocol);
        }
        if self.calculate_manifest_sha256()? != self.manifest_sha256 {
            return Err(OwnerIdentityError::ManifestHash);
        }
        Ok(())
    }

    /// Serialize the complete inner manifest into a zeroizing buffer ready for
    /// immediate protected encryption by the desktop authority.
    pub fn to_canonical_secret_bytes(&self) -> Result<Zeroizing<Vec<u8>>, OwnerIdentityError> {
        self.validate()?;
        Ok(Zeroizing::new(canonicalize(self)?))
    }
}

impl<'de> Deserialize<'de> for OwnerIdentityBundleV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawOwnerIdentityBundleV1::deserialize(deserializer)?;
        let bundle = Self {
            format: raw.format,
            version: raw.version,
            canonicalization: raw.canonicalization,
            bundle_id: raw.bundle_id,
            exported_at: raw.exported_at,
            owner_pubkey: raw.owner_pubkey,
            owner_secret_nsec: raw.owner_secret_nsec,
            manifest_sha256: raw.manifest_sha256,
        };
        bundle.validate().map_err(serde::de::Error::custom)?;
        Ok(bundle)
    }
}
