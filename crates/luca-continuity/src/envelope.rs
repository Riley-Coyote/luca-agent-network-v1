//! Pure authenticated encrypted-record envelopes.
//!
//! Key custody and namespace-key derivation are intentionally outside this
//! module. Callers provide an already-derived 32-byte namespace key and this
//! module binds every non-ciphertext record field into canonical associated
//! data before using XChaCha20-Poly1305.

use crate::ContinuityError;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use luca_protocol::{
    canonicalize, CanonicalTimestamp, ContinuityNamespaceV1, ContinuityRecordV1, ContinuityScopeV1,
    Hex64, OpaqueId, SafeU53, Sha256Ref, MAX_CONTINUITY_CIPHERTEXT_BYTES,
};
use rand::Rng;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fmt;
use zeroize::Zeroizing;

/// Domain separator for the exact canonical authenticated-data representation.
pub const RECORD_AAD_DOMAIN_V1: &str = "luca.continuity.record.aad.v1";
const XCHACHA_NONCE_BYTES: usize = 24;
const POLY1305_TAG_BYTES: usize = 16;

/// Decrypted continuity content held in a zeroizing, non-printable buffer.
///
/// The caller can borrow bytes for in-memory indexing or packet assembly, but
/// neither `Debug` nor the public API exposes a convenience conversion to an
/// ordinary printable `Vec` or `String`.
pub struct DecryptedRecordBody(Zeroizing<Vec<u8>>);

impl DecryptedRecordBody {
    /// Borrow the decrypted body for immediate, in-memory-only processing.
    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_slice()
    }
}

impl AsRef<[u8]> for DecryptedRecordBody {
    fn as_ref(&self) -> &[u8] {
        self.as_bytes()
    }
}

impl fmt::Debug for DecryptedRecordBody {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DecryptedRecordBody([REDACTED])")
    }
}

/// All encrypted-record metadata, excluding the associated-data digest, nonce,
/// and ciphertext. This is the sole input accepted by [`encrypt_record`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordMetadata {
    /// Frozen continuity protocol discriminator.
    pub protocol: String,
    /// Stable logical record identifier.
    pub record_id: OpaqueId,
    /// Exact owner-brain or resident-private namespace.
    pub namespace: ContinuityNamespaceV1,
    /// Exact retrieval scope.
    pub scope: ContinuityScopeV1,
    /// Stable machine-readable record kind.
    pub record_type: OpaqueId,
    /// Zero-based revision number.
    pub revision: SafeU53,
    /// Immediate predecessor after revision zero.
    pub predecessor_record_id: Option<OpaqueId>,
    /// Canonical creation timestamp.
    pub created_at: CanonicalTimestamp,
    /// Stable, non-prose authorship category.
    pub author_kind: OpaqueId,
    /// Sorted, unique, body-free source references.
    pub provenance_refs: Vec<Sha256Ref>,
    /// Encryption-key version, bound to the namespace version.
    pub key_version: SafeU53,
}

#[derive(Serialize)]
struct RecordAssociatedData<'a> {
    domain: &'static str,
    protocol: &'a str,
    record_id: &'a OpaqueId,
    namespace: &'a ContinuityNamespaceV1,
    scope: &'a ContinuityScopeV1,
    record_type: &'a OpaqueId,
    revision: SafeU53,
    predecessor_record_id: Option<&'a OpaqueId>,
    created_at: &'a CanonicalTimestamp,
    author_kind: &'a OpaqueId,
    provenance_refs: &'a [Sha256Ref],
    key_version: SafeU53,
}

impl RecordMetadata {
    /// Validate metadata through the strict public protocol representation.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        let placeholder = ContinuityRecordV1 {
            protocol: self.protocol.clone(),
            record_id: self.record_id.clone(),
            namespace: self.namespace.clone(),
            scope: self.scope.clone(),
            record_type: self.record_type.clone(),
            revision: self.revision,
            predecessor_record_id: self.predecessor_record_id.clone(),
            created_at: self.created_at.clone(),
            author_kind: self.author_kind.clone(),
            provenance_refs: self.provenance_refs.clone(),
            key_version: self.key_version,
            aad_sha256: hex64_from_digest([0_u8; 32])?,
            nonce_b64: BASE64_STANDARD.encode([0_u8; XCHACHA_NONCE_BYTES]),
            ciphertext_b64: BASE64_STANDARD.encode([0_u8; POLY1305_TAG_BYTES]),
        };
        placeholder
            .validate()
            .map_err(|_| ContinuityError::InvalidRecord)
    }

    fn associated_data(&self) -> RecordAssociatedData<'_> {
        RecordAssociatedData {
            domain: RECORD_AAD_DOMAIN_V1,
            protocol: &self.protocol,
            record_id: &self.record_id,
            namespace: &self.namespace,
            scope: &self.scope,
            record_type: &self.record_type,
            revision: self.revision,
            predecessor_record_id: self.predecessor_record_id.as_ref(),
            created_at: &self.created_at,
            author_kind: &self.author_kind,
            provenance_refs: &self.provenance_refs,
            key_version: self.key_version,
        }
    }
}

/// Canonicalize every non-ciphertext binding field for an existing record.
///
/// This intentionally excludes only `aad_sha256`, `nonce_b64`, and
/// `ciphertext_b64`; it includes the complete namespace and scope structures,
/// not merely their one-way references.
pub fn canonical_record_aad(record: &ContinuityRecordV1) -> Result<Vec<u8>, ContinuityError> {
    let metadata = RecordMetadata {
        protocol: record.protocol.clone(),
        record_id: record.record_id.clone(),
        namespace: record.namespace.clone(),
        scope: record.scope.clone(),
        record_type: record.record_type.clone(),
        revision: record.revision,
        predecessor_record_id: record.predecessor_record_id.clone(),
        created_at: record.created_at.clone(),
        author_kind: record.author_kind.clone(),
        provenance_refs: record.provenance_refs.clone(),
        key_version: record.key_version,
    };
    metadata.validate()?;
    canonicalize(&metadata.associated_data()).map_err(|_| ContinuityError::CanonicalAssociatedData)
}

/// Encrypt one record body using an already-derived namespace key.
///
/// A fresh CSPRNG-generated 192-bit nonce is embedded in the returned record.
/// Repository-level nonce uniqueness enforcement remains separate because it
/// requires visibility across the namespace's prior records.
pub fn encrypt_record(
    metadata: RecordMetadata,
    key: &[u8; 32],
    plaintext: &[u8],
) -> Result<ContinuityRecordV1, ContinuityError> {
    metadata.validate()?;
    if plaintext.len() > MAX_CONTINUITY_CIPHERTEXT_BYTES - POLY1305_TAG_BYTES {
        return Err(ContinuityError::InvalidRecord);
    }
    let aad = canonicalize(&metadata.associated_data())
        .map_err(|_| ContinuityError::CanonicalAssociatedData)?;
    let aad_sha256 = hex64_from_digest(Sha256::digest(&aad))?;
    let mut nonce = [0_u8; XCHACHA_NONCE_BYTES];
    rand::rng().fill_bytes(&mut nonce);
    let cipher =
        XChaCha20Poly1305::new_from_slice(key).map_err(|_| ContinuityError::EncryptionFailed)?;
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| ContinuityError::EncryptionFailed)?;
    if ciphertext.len() < POLY1305_TAG_BYTES {
        return Err(ContinuityError::EncryptionFailed);
    }
    let record = ContinuityRecordV1 {
        protocol: metadata.protocol,
        record_id: metadata.record_id,
        namespace: metadata.namespace,
        scope: metadata.scope,
        record_type: metadata.record_type,
        revision: metadata.revision,
        predecessor_record_id: metadata.predecessor_record_id,
        created_at: metadata.created_at,
        author_kind: metadata.author_kind,
        provenance_refs: metadata.provenance_refs,
        key_version: metadata.key_version,
        aad_sha256,
        nonce_b64: BASE64_STANDARD.encode(nonce),
        ciphertext_b64: BASE64_STANDARD.encode(ciphertext),
    };
    validate_envelope(&record)?;
    Ok(record)
}

/// Authenticate and decrypt one structurally valid encrypted record.
pub fn decrypt_record(
    record: &ContinuityRecordV1,
    key: &[u8; 32],
) -> Result<DecryptedRecordBody, ContinuityError> {
    validate_envelope(record)?;
    let aad = canonical_record_aad(record)?;
    let nonce = BASE64_STANDARD
        .decode(&record.nonce_b64)
        .map_err(|_| ContinuityError::CorruptRecord)?;
    let ciphertext = BASE64_STANDARD
        .decode(&record.ciphertext_b64)
        .map_err(|_| ContinuityError::CorruptRecord)?;
    if nonce.len() != XCHACHA_NONCE_BYTES || ciphertext.len() < POLY1305_TAG_BYTES {
        return Err(ContinuityError::CorruptRecord);
    }
    let cipher =
        XChaCha20Poly1305::new_from_slice(key).map_err(|_| ContinuityError::DecryptionFailed)?;
    cipher
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: &aad,
            },
        )
        .map(Zeroizing::new)
        .map(DecryptedRecordBody)
        .map_err(|_| ContinuityError::DecryptionFailed)
}

/// Validate protocol structure, canonical AAD, and AEAD envelope bounds.
pub(crate) fn validate_envelope(record: &ContinuityRecordV1) -> Result<(), ContinuityError> {
    record
        .validate()
        .map_err(|_| ContinuityError::InvalidRecord)?;
    let ciphertext = BASE64_STANDARD
        .decode(&record.ciphertext_b64)
        .map_err(|_| ContinuityError::CorruptRecord)?;
    if ciphertext.len() < POLY1305_TAG_BYTES {
        return Err(ContinuityError::CorruptRecord);
    }
    let aad = canonical_record_aad(record)?;
    let expected = hex64_from_digest(Sha256::digest(aad))?;
    if expected != record.aad_sha256 {
        return Err(ContinuityError::AssociatedDataMismatch);
    }
    Ok(())
}

pub(crate) fn hex64_from_digest(digest: impl AsRef<[u8]>) -> Result<Hex64, ContinuityError> {
    Hex64::parse(hex::encode(digest)).map_err(|_| ContinuityError::CanonicalAssociatedData)
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::{
        ContinuityNamespaceKindV1, ContinuityNamespaceV1, ContinuityScopeV1, Sha256Ref,
        CONTINUITY_PROTOCOL,
    };

    fn hex(digit: char) -> Hex64 {
        Hex64::parse(digit.to_string().repeat(64)).unwrap()
    }

    fn sha(digit: char) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{}", digit.to_string().repeat(64))).unwrap()
    }

    fn id(value: &str) -> OpaqueId {
        OpaqueId::parse(value).unwrap()
    }

    fn metadata() -> RecordMetadata {
        let namespace = ContinuityNamespaceV1 {
            protocol: CONTINUITY_PROTOCOL.into(),
            owner_pubkey: hex('1'),
            kind: ContinuityNamespaceKindV1::ResidentPrivate,
            resident_pubkey: Some(hex('2')),
            namespace_ref: sha('3'),
            key_version: SafeU53::new(1).unwrap(),
        };
        RecordMetadata {
            protocol: CONTINUITY_PROTOCOL.into(),
            record_id: id("record-1"),
            scope: ContinuityScopeV1 {
                protocol: CONTINUITY_PROTOCOL.into(),
                namespace_ref: namespace.namespace_ref.clone(),
                scope_ref: sha('4'),
                source_id: Some(id("source-1")),
                project_id: Some(id("project-1")),
                room_id: Some(id("room-1")),
                conversation_id: Some(id("conversation-1")),
            },
            namespace,
            record_type: id("hypomnema"),
            revision: SafeU53::new(0).unwrap(),
            predecessor_record_id: None,
            created_at: CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
            author_kind: id("resident"),
            provenance_refs: vec![sha('5'), sha('6')],
            key_version: SafeU53::new(1).unwrap(),
        }
    }

    #[test]
    fn round_trip_binds_metadata_to_ciphertext() {
        let key = [7_u8; 32];
        let record = encrypt_record(metadata(), &key, b"private continuity body").unwrap();
        assert_eq!(
            decrypt_record(&record, &key).unwrap().as_bytes(),
            b"private continuity body"
        );
        assert_eq!(record.nonce_b64.len(), 32);
        let aad = canonical_record_aad(&record).unwrap();
        assert_eq!(aad, canonical_record_aad(&record).unwrap());
        let changed_kind = ContinuityRecordV1 {
            record_type: id("journal"),
            ..record.clone()
        };
        assert_ne!(aad, canonical_record_aad(&changed_kind).unwrap());
    }

    #[test]
    fn wrong_key_and_tampered_ciphertext_fail_closed() {
        let key = [7_u8; 32];
        let record = encrypt_record(metadata(), &key, b"private continuity body").unwrap();
        assert!(matches!(
            decrypt_record(&record, &[8_u8; 32]),
            Err(ContinuityError::DecryptionFailed)
        ));
        let body = decrypt_record(&record, &key).unwrap();
        assert_eq!(format!("{body:?}"), "DecryptedRecordBody([REDACTED])");
        assert!(
            !format!("{body:?}").contains("private continuity body"),
            "decrypted content must not appear in Debug output"
        );
        let mut tampered = record;
        let mut ciphertext = BASE64_STANDARD.decode(&tampered.ciphertext_b64).unwrap();
        ciphertext[0] ^= 1;
        tampered.ciphertext_b64 = BASE64_STANDARD.encode(ciphertext);
        assert!(matches!(
            decrypt_record(&tampered, &key),
            Err(ContinuityError::DecryptionFailed)
        ));
    }

    #[test]
    fn every_aad_binding_field_is_authenticated() {
        let key = [7_u8; 32];
        let record = encrypt_record(metadata(), &key, b"private continuity body").unwrap();
        let valid_candidates = vec![
            (
                "record id",
                ContinuityRecordV1 {
                    record_id: id("record-2"),
                    ..record.clone()
                },
            ),
            (
                "namespace owner",
                ContinuityRecordV1 {
                    namespace: ContinuityNamespaceV1 {
                        owner_pubkey: hex('7'),
                        ..record.namespace.clone()
                    },
                    ..record.clone()
                },
            ),
            (
                "namespace kind and resident shape",
                ContinuityRecordV1 {
                    namespace: ContinuityNamespaceV1 {
                        kind: ContinuityNamespaceKindV1::OwnerBrain,
                        resident_pubkey: None,
                        ..record.namespace.clone()
                    },
                    ..record.clone()
                },
            ),
            (
                "namespace resident",
                ContinuityRecordV1 {
                    namespace: ContinuityNamespaceV1 {
                        resident_pubkey: Some(hex('8')),
                        ..record.namespace.clone()
                    },
                    ..record.clone()
                },
            ),
            (
                "namespace reference and matching scope reference",
                ContinuityRecordV1 {
                    namespace: ContinuityNamespaceV1 {
                        namespace_ref: sha('8'),
                        ..record.namespace.clone()
                    },
                    scope: ContinuityScopeV1 {
                        namespace_ref: sha('8'),
                        ..record.scope.clone()
                    },
                    ..record.clone()
                },
            ),
            (
                "namespace and record key version",
                ContinuityRecordV1 {
                    namespace: ContinuityNamespaceV1 {
                        key_version: SafeU53::new(2).unwrap(),
                        ..record.namespace.clone()
                    },
                    key_version: SafeU53::new(2).unwrap(),
                    ..record.clone()
                },
            ),
            (
                "scope reference",
                ContinuityRecordV1 {
                    scope: ContinuityScopeV1 {
                        scope_ref: sha('8'),
                        ..record.scope.clone()
                    },
                    ..record.clone()
                },
            ),
            (
                "scope source",
                ContinuityRecordV1 {
                    scope: ContinuityScopeV1 {
                        source_id: Some(id("source-2")),
                        ..record.scope.clone()
                    },
                    ..record.clone()
                },
            ),
            (
                "scope project",
                ContinuityRecordV1 {
                    scope: ContinuityScopeV1 {
                        project_id: Some(id("project-2")),
                        ..record.scope.clone()
                    },
                    ..record.clone()
                },
            ),
            (
                "scope room",
                ContinuityRecordV1 {
                    scope: ContinuityScopeV1 {
                        room_id: Some(id("room-2")),
                        ..record.scope.clone()
                    },
                    ..record.clone()
                },
            ),
            (
                "scope conversation",
                ContinuityRecordV1 {
                    scope: ContinuityScopeV1 {
                        conversation_id: Some(id("conversation-2")),
                        ..record.scope.clone()
                    },
                    ..record.clone()
                },
            ),
            (
                "record type",
                ContinuityRecordV1 {
                    record_type: id("journal"),
                    ..record.clone()
                },
            ),
            (
                "revision and predecessor",
                ContinuityRecordV1 {
                    revision: SafeU53::new(1).unwrap(),
                    predecessor_record_id: Some(id("record-0")),
                    ..record.clone()
                },
            ),
            (
                "created at",
                ContinuityRecordV1 {
                    created_at: CanonicalTimestamp::parse("2026-08-05T00:00:01Z").unwrap(),
                    ..record.clone()
                },
            ),
            (
                "author",
                ContinuityRecordV1 {
                    author_kind: id("system-maintenance"),
                    ..record.clone()
                },
            ),
            (
                "provenance",
                ContinuityRecordV1 {
                    provenance_refs: vec![sha('5'), sha('7')],
                    ..record.clone()
                },
            ),
        ];
        for (field, mut candidate) in valid_candidates {
            candidate.aad_sha256 =
                hex64_from_digest(Sha256::digest(canonical_record_aad(&candidate).unwrap()))
                    .unwrap();
            assert!(
                matches!(
                    decrypt_record(&candidate, &key),
                    Err(ContinuityError::DecryptionFailed)
                ),
                "{field} must reach AEAD and fail authentication"
            );
        }

        // These changes violate frozen protocol invariants before an AAD can
        // be constructed. They are intentionally structural rejections.
        let candidates = vec![
            (
                "record protocol",
                ContinuityRecordV1 {
                    protocol: "luca.continuity.v0".into(),
                    ..record.clone()
                },
            ),
            (
                "namespace protocol",
                ContinuityRecordV1 {
                    namespace: ContinuityNamespaceV1 {
                        protocol: "luca.continuity.v0".into(),
                        ..record.namespace.clone()
                    },
                    ..record.clone()
                },
            ),
            (
                "namespace kind",
                ContinuityRecordV1 {
                    namespace: ContinuityNamespaceV1 {
                        kind: ContinuityNamespaceKindV1::OwnerBrain,
                        ..record.namespace.clone()
                    },
                    ..record.clone()
                },
            ),
            (
                "namespace reference",
                ContinuityRecordV1 {
                    namespace: ContinuityNamespaceV1 {
                        namespace_ref: sha('8'),
                        ..record.namespace.clone()
                    },
                    ..record.clone()
                },
            ),
            (
                "scope protocol",
                ContinuityRecordV1 {
                    scope: ContinuityScopeV1 {
                        protocol: "luca.continuity.v0".into(),
                        ..record.scope.clone()
                    },
                    ..record.clone()
                },
            ),
            (
                "scope namespace reference",
                ContinuityRecordV1 {
                    scope: ContinuityScopeV1 {
                        namespace_ref: sha('8'),
                        ..record.scope.clone()
                    },
                    ..record.clone()
                },
            ),
            (
                "predecessor",
                ContinuityRecordV1 {
                    predecessor_record_id: Some(id("record-0")),
                    ..record.clone()
                },
            ),
            (
                "record key version",
                ContinuityRecordV1 {
                    key_version: SafeU53::new(2).unwrap(),
                    ..record.clone()
                },
            ),
        ];
        for (field, candidate) in candidates {
            assert!(
                decrypt_record(&candidate, &key).is_err(),
                "{field} substitution must fail"
            );
        }
    }

    #[test]
    fn nonce_and_aad_digest_tampering_are_distinguished() {
        let key = [7_u8; 32];
        let record = encrypt_record(metadata(), &key, b"private continuity body").unwrap();
        let mut nonce_tampered = record.clone();
        let mut nonce = BASE64_STANDARD.decode(&nonce_tampered.nonce_b64).unwrap();
        nonce[0] ^= 1;
        nonce_tampered.nonce_b64 = BASE64_STANDARD.encode(nonce);
        assert!(matches!(
            decrypt_record(&nonce_tampered, &key),
            Err(ContinuityError::DecryptionFailed)
        ));

        let mut aad_tampered = record;
        aad_tampered.aad_sha256 = hex('9');
        assert!(matches!(
            decrypt_record(&aad_tampered, &key),
            Err(ContinuityError::AssociatedDataMismatch)
        ));
    }

    #[test]
    fn ciphertext_bounds_are_checked_before_and_after_encryption() {
        let key = [7_u8; 32];
        let max_plaintext = vec![b'x'; MAX_CONTINUITY_CIPHERTEXT_BYTES - POLY1305_TAG_BYTES];
        let record = encrypt_record(metadata(), &key, &max_plaintext).unwrap();
        assert_eq!(
            BASE64_STANDARD.decode(record.ciphertext_b64).unwrap().len(),
            MAX_CONTINUITY_CIPHERTEXT_BYTES
        );
        let too_large = vec![b'x'; MAX_CONTINUITY_CIPHERTEXT_BYTES - POLY1305_TAG_BYTES + 1];
        assert!(matches!(
            encrypt_record(metadata(), &key, &too_large),
            Err(ContinuityError::InvalidRecord)
        ));
        let mut oversized = encrypt_record(metadata(), &key, b"private continuity body").unwrap();
        oversized.ciphertext_b64 =
            BASE64_STANDARD.encode(vec![0_u8; MAX_CONTINUITY_CIPHERTEXT_BYTES + 1]);
        assert!(matches!(
            decrypt_record(&oversized, &key),
            Err(ContinuityError::InvalidRecord)
        ));
    }

    #[test]
    fn cross_namespace_and_truncated_ciphertext_are_rejected() {
        let key = [7_u8; 32];
        let record = encrypt_record(metadata(), &key, b"private continuity body").unwrap();
        let cross_namespace = ContinuityRecordV1 {
            namespace: ContinuityNamespaceV1 {
                namespace_ref: sha('8'),
                ..record.namespace.clone()
            },
            scope: ContinuityScopeV1 {
                namespace_ref: sha('8'),
                ..record.scope.clone()
            },
            ..record.clone()
        };
        assert!(matches!(
            decrypt_record(&cross_namespace, &key),
            Err(ContinuityError::AssociatedDataMismatch)
        ));
        let mut truncated = record;
        truncated.ciphertext_b64 = BASE64_STANDARD.encode([0_u8; POLY1305_TAG_BYTES - 1]);
        assert!(matches!(
            decrypt_record(&truncated, &key),
            Err(ContinuityError::CorruptRecord)
        ));
    }
}
