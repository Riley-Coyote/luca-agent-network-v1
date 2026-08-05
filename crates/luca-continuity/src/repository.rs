//! Pure encrypted-record repository contract and deterministic in-memory implementation.

use crate::{
    decrypt_record, envelope::validate_envelope, ContinuityError, DecryptedRecordBody,
    NamespaceKey, NamespaceScope,
};
use luca_protocol::{canonicalize, ContinuityRecordV1, MAX_CONTINUITY_CIPHERTEXT_BYTES};
use std::collections::BTreeMap;
use std::fmt;

const MAX_ENCODED_CIPHERTEXT_BYTES: usize = MAX_CONTINUITY_CIPHERTEXT_BYTES.div_ceil(3) * 4;
/// Conservative bounded JSON metadata allowance, derived from protocol scalar
/// maxima: 256 provenance refs plus complete namespace/scope identifiers and
/// fixed field names. It intentionally exceeds the current worst case so an
/// ingress limit cannot reject a valid protocol record due to JSON punctuation.
const MAX_SERIALIZED_RECORD_METADATA_BYTES: usize = 64 * 1024;
/// Maximum accepted serialized encrypted-record envelope size.
///
/// This is the protocol's maximum decoded ciphertext after canonical base64
/// expansion plus a bounded, body-free metadata allowance. The bound is
/// checked before JSON parsing so malformed external input cannot force an
/// unbounded serde allocation.
pub const MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES: usize =
    MAX_ENCODED_CIPHERTEXT_BYTES + MAX_SERIALIZED_RECORD_METADATA_BYTES;

/// A body-free result of attempting to persist an encrypted record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordWriteOutcome {
    /// A new validated record was retained.
    Inserted,
    /// The exact same canonical record had already been retained.
    Replayed,
}

/// Body-free reason a malformed encrypted record was isolated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CorruptRecordDiagnostic {
    /// Strict serialization or protocol validation failed before storage.
    MalformedEnvelope,
    /// Metadata did not reproduce the stored associated-data digest.
    AssociatedDataMismatch,
    /// Ciphertext or nonce bounds were invalid.
    InvalidCiphertext,
    /// The serialized envelope exceeded the bounded body-free ingress limit.
    OversizedEnvelope,
    /// A structurally valid envelope failed authenticated decryption.
    AuthenticationFailed,
}

/// One authenticated encrypted record with its zeroizing decrypted body.
pub struct AuthenticatedRecord {
    record: ContinuityRecordV1,
    body: DecryptedRecordBody,
}

impl AuthenticatedRecord {
    /// Borrow the exact encrypted protocol record after authentication.
    pub fn record(&self) -> &ContinuityRecordV1 {
        &self.record
    }

    /// Borrow the zeroizing plaintext only for immediate in-memory processing.
    pub fn body(&self) -> &DecryptedRecordBody {
        &self.body
    }
}

impl fmt::Debug for AuthenticatedRecord {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AuthenticatedRecord")
            .field("record_id", &self.record.record_id)
            .field("body", &"[REDACTED]")
            .finish()
    }
}

/// Pure contract for encrypted continuity records.
///
/// The contract deliberately accepts and returns encrypted envelopes only. It
/// never accepts decrypted bodies, performs key derivation, or writes to disk.
pub trait EncryptedRecordRepository {
    /// Retain a validated encrypted record with exact replay and nonce rules.
    fn put_encrypted(
        &mut self,
        record: ContinuityRecordV1,
    ) -> Result<RecordWriteOutcome, ContinuityError>;

    /// Return structural encrypted envelopes only for an exact namespace/scope.
    ///
    /// This keyless method does not authenticate ciphertext and must never be
    /// used as evidence that a record body is valid or available for recall.
    fn read_exact_structural(&self, requested: &NamespaceScope) -> Vec<ContinuityRecordV1>;

    /// Authenticate matching envelopes with one exact namespace key, skipping
    /// and recording any record that fails AEAD authentication.
    fn read_exact_authenticated(
        &mut self,
        requested: &NamespaceScope,
        key: &[u8; 32],
    ) -> Vec<AuthenticatedRecord>;

    /// Return body-free diagnostics for isolated malformed records.
    fn corrupt_diagnostics(&self) -> &[CorruptRecordDiagnostic];
}

/// Deterministic, process-local encrypted-record implementation for pure tests.
#[derive(Debug, Default)]
pub struct InMemoryEncryptedRecordRepository {
    records: BTreeMap<String, ContinuityRecordV1>,
    corrupt_diagnostics: Vec<CorruptRecordDiagnostic>,
}

impl InMemoryEncryptedRecordRepository {
    /// Parse and stage a serialized encrypted envelope without retaining raw input on failure.
    pub fn ingest_serialized(
        &mut self,
        bytes: &[u8],
    ) -> Result<RecordWriteOutcome, ContinuityError> {
        if bytes.len() > MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES {
            self.corrupt_diagnostics
                .push(CorruptRecordDiagnostic::OversizedEnvelope);
            return Err(ContinuityError::CorruptRecord);
        }
        let record = match serde_json::from_slice::<ContinuityRecordV1>(bytes) {
            Ok(record) => record,
            Err(_) => {
                self.corrupt_diagnostics
                    .push(CorruptRecordDiagnostic::MalformedEnvelope);
                return Err(ContinuityError::CorruptRecord);
            }
        };
        self.put_encrypted(record)
    }

    fn isolate(&mut self, error: ContinuityError) -> ContinuityError {
        let diagnostic = match error {
            ContinuityError::AssociatedDataMismatch => {
                CorruptRecordDiagnostic::AssociatedDataMismatch
            }
            ContinuityError::CorruptRecord => CorruptRecordDiagnostic::InvalidCiphertext,
            _ => CorruptRecordDiagnostic::MalformedEnvelope,
        };
        self.corrupt_diagnostics.push(diagnostic);
        ContinuityError::CorruptRecord
    }

    fn exact_address(record: &ContinuityRecordV1) -> Result<NamespaceScope, ContinuityError> {
        let namespace = NamespaceKey::new(record.namespace.clone())?;
        NamespaceScope::new(namespace, record.scope.clone())
    }

    fn same_nonce_domain(left: &ContinuityRecordV1, right: &ContinuityRecordV1) -> bool {
        left.namespace.namespace_ref == right.namespace.namespace_ref
            && left.key_version == right.key_version
            && left.nonce_b64 == right.nonce_b64
    }

    fn same_canonical(left: &ContinuityRecordV1, right: &ContinuityRecordV1) -> bool {
        canonicalize(left).ok() == canonicalize(right).ok()
    }
}

impl EncryptedRecordRepository for InMemoryEncryptedRecordRepository {
    fn put_encrypted(
        &mut self,
        record: ContinuityRecordV1,
    ) -> Result<RecordWriteOutcome, ContinuityError> {
        if let Err(error) = validate_envelope(&record) {
            return Err(self.isolate(error));
        }
        if Self::exact_address(&record).is_err() {
            return Err(self.isolate(ContinuityError::InvalidRecord));
        }
        let record_id = record.record_id.as_str().to_owned();
        if let Some(existing) = self.records.get(&record_id) {
            return if Self::same_canonical(existing, &record) {
                Ok(RecordWriteOutcome::Replayed)
            } else {
                Err(ContinuityError::ReplayConflict)
            };
        }
        if self
            .records
            .values()
            .any(|existing| Self::same_nonce_domain(existing, &record))
        {
            return Err(ContinuityError::NonceCollision);
        }
        self.records.insert(record_id, record);
        Ok(RecordWriteOutcome::Inserted)
    }

    fn read_exact_structural(&self, requested: &NamespaceScope) -> Vec<ContinuityRecordV1> {
        self.records
            .values()
            .filter_map(|record| {
                let address = Self::exact_address(record).ok()?;
                address.permits(requested).then(|| record.clone())
            })
            .collect()
    }

    fn read_exact_authenticated(
        &mut self,
        requested: &NamespaceScope,
        key: &[u8; 32],
    ) -> Vec<AuthenticatedRecord> {
        let candidates = self.read_exact_structural(requested);
        let mut authenticated = Vec::with_capacity(candidates.len());
        for record in candidates {
            match decrypt_record(&record, key) {
                Ok(body) => authenticated.push(AuthenticatedRecord { record, body }),
                Err(_) => self
                    .corrupt_diagnostics
                    .push(CorruptRecordDiagnostic::AuthenticationFailed),
            }
        }
        authenticated
    }

    fn corrupt_diagnostics(&self) -> &[CorruptRecordDiagnostic] {
        &self.corrupt_diagnostics
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{encrypt_record, RecordMetadata};
    use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
    use luca_protocol::{
        CanonicalTimestamp, ContinuityNamespaceKindV1, ContinuityNamespaceV1, ContinuityScopeV1,
        Hex64, OpaqueId, SafeU53, Sha256Ref, CONTINUITY_PROTOCOL,
    };
    use sha2::Digest as _;

    fn hex(digit: char) -> Hex64 {
        Hex64::parse(digit.to_string().repeat(64)).unwrap()
    }

    fn sha(digit: char) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{}", digit.to_string().repeat(64))).unwrap()
    }

    fn id(value: &str) -> OpaqueId {
        OpaqueId::parse(value).unwrap()
    }

    fn metadata(record_id: &str) -> RecordMetadata {
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
            record_id: id(record_id),
            namespace: namespace.clone(),
            scope: ContinuityScopeV1 {
                protocol: CONTINUITY_PROTOCOL.into(),
                namespace_ref: namespace.namespace_ref.clone(),
                scope_ref: sha('4'),
                source_id: Some(id("source-1")),
                project_id: None,
                room_id: None,
                conversation_id: Some(id("conversation-1")),
            },
            record_type: id("hypomnema"),
            revision: SafeU53::new(0).unwrap(),
            predecessor_record_id: None,
            created_at: CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
            author_kind: id("resident"),
            provenance_refs: vec![sha('5')],
            key_version: SafeU53::new(1).unwrap(),
        }
    }

    fn address(metadata: &RecordMetadata) -> NamespaceScope {
        NamespaceScope::new(
            NamespaceKey::new(metadata.namespace.clone()).unwrap(),
            metadata.scope.clone(),
        )
        .unwrap()
    }

    #[test]
    fn exact_replay_is_idempotent_but_same_id_different_record_is_conflict() {
        let key = [9_u8; 32];
        let metadata = metadata("record-1");
        let record = encrypt_record(metadata.clone(), &key, b"one").unwrap();
        let mut repository = InMemoryEncryptedRecordRepository::default();
        assert_eq!(
            repository.put_encrypted(record.clone()),
            Ok(RecordWriteOutcome::Inserted)
        );
        assert_eq!(
            repository.put_encrypted(record),
            Ok(RecordWriteOutcome::Replayed)
        );
        let changed = encrypt_record(metadata, &key, b"two").unwrap();
        assert_eq!(
            repository.put_encrypted(changed),
            Err(ContinuityError::ReplayConflict)
        );
    }

    #[test]
    fn nonce_collision_is_rejected_inside_one_namespace_key_version() {
        let key = [9_u8; 32];
        let first = encrypt_record(metadata("record-1"), &key, b"one").unwrap();
        let mut second = encrypt_record(metadata("record-2"), &key, b"two").unwrap();
        second.nonce_b64 = first.nonce_b64.clone();
        second.aad_sha256 = crate::envelope::hex64_from_digest(sha2::Sha256::digest(
            crate::canonical_record_aad(&second).unwrap(),
        ))
        .unwrap();
        let mut repository = InMemoryEncryptedRecordRepository::default();
        assert_eq!(
            repository.put_encrypted(first),
            Ok(RecordWriteOutcome::Inserted)
        );
        assert_eq!(
            repository.put_encrypted(second),
            Err(ContinuityError::NonceCollision)
        );
    }

    #[test]
    fn corrupt_records_are_isolated_without_losing_valid_records() {
        let key = [9_u8; 32];
        let first_metadata = metadata("record-1");
        let address = address(&first_metadata);
        let valid = encrypt_record(first_metadata, &key, b"one").unwrap();
        let mut repository = InMemoryEncryptedRecordRepository::default();
        assert_eq!(
            repository.put_encrypted(valid),
            Ok(RecordWriteOutcome::Inserted)
        );
        let mut malformed = encrypt_record(metadata("record-2"), &key, b"two").unwrap();
        malformed.ciphertext_b64 = BASE64_STANDARD.encode([0_u8; 15]);
        assert_eq!(
            repository.put_encrypted(malformed),
            Err(ContinuityError::CorruptRecord)
        );
        assert_eq!(repository.read_exact_structural(&address).len(), 1);
        assert_eq!(
            repository.corrupt_diagnostics(),
            &[CorruptRecordDiagnostic::InvalidCiphertext]
        );
    }

    #[test]
    fn reads_require_the_complete_exact_namespace_and_scope() {
        let key = [9_u8; 32];
        let first_metadata = metadata("record-1");
        let requested = address(&first_metadata);
        let first = encrypt_record(first_metadata, &key, b"one").unwrap();
        let mut other_metadata = metadata("record-2");
        other_metadata.scope.conversation_id = Some(id("conversation-2"));
        let other = encrypt_record(other_metadata, &key, b"two").unwrap();
        let mut repository = InMemoryEncryptedRecordRepository::default();
        assert_eq!(
            repository.put_encrypted(first),
            Ok(RecordWriteOutcome::Inserted)
        );
        assert_eq!(
            repository.put_encrypted(other),
            Ok(RecordWriteOutcome::Inserted)
        );
        let records = repository.read_exact_structural(&requested);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].record_id.as_str(), "record-1");
    }

    #[test]
    fn malformed_serialized_input_is_discarded_without_retaining_raw_text() {
        let mut repository = InMemoryEncryptedRecordRepository::default();
        assert_eq!(
            repository.ingest_serialized(b"not a continuity record"),
            Err(ContinuityError::CorruptRecord)
        );
        assert_eq!(
            repository.corrupt_diagnostics(),
            &[CorruptRecordDiagnostic::MalformedEnvelope]
        );
    }

    #[test]
    fn oversized_serialized_input_is_rejected_before_json_parsing() {
        let mut repository = InMemoryEncryptedRecordRepository::default();
        let oversized = vec![b'x'; MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES + 1];
        assert_eq!(
            repository.ingest_serialized(&oversized),
            Err(ContinuityError::CorruptRecord)
        );
        assert_eq!(
            repository.corrupt_diagnostics(),
            &[CorruptRecordDiagnostic::OversizedEnvelope]
        );
    }

    #[test]
    fn authenticated_read_skips_valid_length_ciphertext_corruption() {
        let key = [9_u8; 32];
        let metadata = metadata("record-1");
        let address = address(&metadata);
        let mut corrupt = encrypt_record(metadata, &key, b"one").unwrap();
        let mut ciphertext = BASE64_STANDARD.decode(&corrupt.ciphertext_b64).unwrap();
        ciphertext[0] ^= 1;
        corrupt.ciphertext_b64 = BASE64_STANDARD.encode(ciphertext);
        let mut repository = InMemoryEncryptedRecordRepository::default();
        assert_eq!(
            repository.put_encrypted(corrupt),
            Ok(RecordWriteOutcome::Inserted)
        );
        assert_eq!(repository.read_exact_structural(&address).len(), 1);
        assert!(repository
            .read_exact_authenticated(&address, &key)
            .is_empty());
        assert_eq!(
            repository.corrupt_diagnostics(),
            &[CorruptRecordDiagnostic::AuthenticationFailed]
        );
    }
}
