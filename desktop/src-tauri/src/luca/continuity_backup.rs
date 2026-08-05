//! Passphrase-protected continuity backup and crash-recoverable restore.
//!
//! The archive contains the continuity root and ciphertext-only store snapshot
//! inside a strict canonical age/scrypt envelope. Preview has no store or
//! keychain capability. Restore stages only the already-encrypted archive and
//! uses a body-free keychain journal to recover the SQLite/keychain boundary.

use std::{
    fmt,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
};

use age::{secrecy::SecretString, Decryptor, Encryptor};
use luca_continuity::{decrypt_record, NamespaceKey};
use luca_protocol::{
    canonicalize, parse_and_canonicalize_strict, CanonicalTimestamp, ContinuityRecordV1, Hex64,
    LucaBackupManifestV1, OpaqueId, OwnerIdentityBundleV1, SafeU53, Sha256Ref, CONTINUITY_PROTOCOL,
};
use nostr::Keys;
use serde::{
    de::{self, DeserializeSeed, IgnoredAny, MapAccess, SeqAccess, Visitor},
    Deserialize, Deserializer as _, Serialize,
};
use sha2::{Digest, Sha256};
use tempfile::Builder as TempFileBuilder;
use zeroize::{Zeroize, Zeroizing};

use super::{
    continuity_key_custody::{
        finalize_candidate_master_key, install_candidate_master_key, rollback_candidate_master_key,
        ContinuityKeyStore, ContinuityKeyStoreError, ContinuityMasterKey, ABSENT_ROLLBACK_MARKER,
        CONTINUITY_MASTER_KEY_NAME, CONTINUITY_MASTER_KEY_ROLLBACK_NAME,
    },
    continuity_key_derivation::derive_namespace_key,
    continuity_store::{
        ContinuityEncryptedSnapshot, ContinuityRestoreDestination, ContinuitySourceMapping,
        ContinuityStore, ContinuityStoreError, MAX_CONTINUITY_SNAPSHOT_BYTES,
        MAX_CONTINUITY_SNAPSHOT_RECORDS,
    },
};
use crate::app_state::ContinuityLifecycleLock;

const BACKUP_EXTENSION: &str = "luca-backup.age";
const BACKUP_FORMAT_VERSION: u64 = 1;
const MIN_PASSPHRASE_BYTES: usize = 12;
const MAX_PASSPHRASE_BYTES: usize = 1024;
const MAX_CIPHERTEXT_BYTES: usize = 160 * 1024 * 1024;
const MAX_PLAINTEXT_BYTES: usize = 136 * 1024 * 1024;
const MAX_SOURCE_MAPPINGS: usize = 100_000;
const MAX_SCRYPT_WORK_FACTOR: u8 = 20;
const EXPORT_SCRYPT_WORK_FACTOR: u8 = 15;
const RESTORE_STATE_KEY: &str = "luca.continuity.restore-state.v1";
const IDENTITY_KEY_NAME: &str = "identity";
const IDENTITY_ROLLBACK_KEY: &str = "luca.continuity.owner-identity.rollback.v1";
const ABSENT_IDENTITY_MARKER: &str = "luca.continuity.owner-identity.absent.v1";
const ARCHIVE_INTEGRITY_DOMAIN: &[u8] = b"luca.continuity.backup.integrity.v1";
const MAPPING_REF_DOMAIN: &[u8] = b"luca.continuity.backup.mapping-ref.v1";
const SNAPSHOT_REF_DOMAIN: &[u8] = b"luca.continuity.backup.snapshot-ref.v1";
const PREFLIGHT_BOUND_ERROR: &str = "luca backup collection bound exceeded";
const ARCHIVE_FIELDS: &[&str] = &[
    "manifest",
    "owner_identity",
    "active_key_version",
    "continuity_master_key_b64",
    "records",
    "mappings",
];

/// Source/identity mapping intentionally excludes paths and runtime/provider
/// details. `source_ref` is a stable content-derived identifier.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct BackupSourceMappingV1 {
    pub(crate) mapping_ref: Sha256Ref,
    pub(crate) source_ref: Sha256Ref,
    pub(crate) resident_pubkey: Option<Hex64>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BackupArchiveV1 {
    manifest: LucaBackupManifestV1,
    owner_identity: OwnerIdentityBundleV1,
    active_key_version: SafeU53,
    continuity_master_key_b64: String,
    records: Vec<ContinuityRecordV1>,
    mappings: Vec<BackupSourceMappingV1>,
}

impl Drop for BackupArchiveV1 {
    fn drop(&mut self) {
        self.continuity_master_key_b64.zeroize();
    }
}

#[derive(Serialize)]
struct BackupIntegrityInput<'a> {
    domain: &'static str,
    protocol: &'a str,
    backup_id: &'a OpaqueId,
    created_at: &'a CanonicalTimestamp,
    owner_pubkey: &'a Hex64,
    format_version: SafeU53,
    active_key_version: SafeU53,
    master_key_sha256: Hex64,
    owner_identity_sha256: &'a Hex64,
    encrypted_content_refs: &'a [Sha256Ref],
    mapping_refs: &'a [Sha256Ref],
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RestorePhase {
    Prepared,
    IdentityCandidateInstalled,
    CandidateInstalled,
    StoreActivated,
    Verified,
}

/// Body-free cross-subsystem journal retained only in the OS keychain.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RestoreStateV1 {
    protocol: String,
    backup_id: OpaqueId,
    owner_pubkey: Hex64,
    old_snapshot_ref: Sha256Ref,
    new_snapshot_ref: Sha256Ref,
    old_master_key_sha256: Option<Hex64>,
    new_master_key_sha256: Hex64,
    old_identity_pubkey: Option<Hex64>,
    new_identity_pubkey: Hex64,
    phase: RestorePhase,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ContinuityBackupPreview {
    pub(crate) backup_id: OpaqueId,
    pub(crate) created_at: CanonicalTimestamp,
    pub(crate) owner_pubkey: Hex64,
    pub(crate) record_count: usize,
    pub(crate) mapping_count: usize,
    pub(crate) ciphertext_sha256: Hex64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ContinuityBackupReceipt {
    pub(crate) preview: ContinuityBackupPreview,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ContinuityRestoreConfirmation {
    pub(crate) backup_id: OpaqueId,
    pub(crate) owner_pubkey: Hex64,
    pub(crate) ciphertext_sha256: Hex64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ContinuityRestoreReceipt {
    pub(crate) backup_id: OpaqueId,
    pub(crate) owner_pubkey: Hex64,
    pub(crate) restored_records: usize,
    pub(crate) restored_mappings: usize,
    /// Validated, exact mappings for the import/source authority to persist in
    /// the same outer application transaction. They are never silently dropped.
    pub(crate) mappings: Vec<BackupSourceMappingV1>,
}

impl From<&BackupSourceMappingV1> for ContinuitySourceMapping {
    fn from(mapping: &BackupSourceMappingV1) -> Self {
        Self {
            mapping_ref: mapping.mapping_ref.clone(),
            source_ref: mapping.source_ref.clone(),
            resident_pubkey: mapping.resident_pubkey.clone(),
        }
    }
}

impl From<&ContinuitySourceMapping> for BackupSourceMappingV1 {
    fn from(mapping: &ContinuitySourceMapping) -> Self {
        Self {
            mapping_ref: mapping.mapping_ref.clone(),
            source_ref: mapping.source_ref.clone(),
            resident_pubkey: mapping.resident_pubkey.clone(),
        }
    }
}

/// Body-free backup/restore failure.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ContinuityBackupError {
    InvalidRequest,
    InvalidPassphrase,
    InvalidArchive,
    BoundExceeded,
    Authentication,
    Integrity,
    ConfirmationMismatch,
    DestinationExists,
    Io,
    Keychain(ContinuityKeyStoreError),
    Store(ContinuityStoreError),
    InjectedCrash(RestoreCrashPoint),
}

impl From<ContinuityStoreError> for ContinuityBackupError {
    fn from(error: ContinuityStoreError) -> Self {
        Self::Store(error)
    }
}

impl From<ContinuityKeyStoreError> for ContinuityBackupError {
    fn from(error: ContinuityKeyStoreError) -> Self {
        Self::Keychain(error)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RestoreCrashPoint {
    AfterStage,
    AfterJournal,
    AfterKeyInstall,
    AfterStoreActivation,
    AfterVerification,
}

pub(crate) trait RestoreCrashInjector {
    fn checkpoint(&mut self, point: RestoreCrashPoint) -> Result<(), ContinuityBackupError>;
}

pub(crate) struct NoRestoreCrash;

impl RestoreCrashInjector for NoRestoreCrash {
    fn checkpoint(&mut self, _point: RestoreCrashPoint) -> Result<(), ContinuityBackupError> {
        Ok(())
    }
}

fn validate_passphrase(passphrase: &str) -> Result<(), ContinuityBackupError> {
    if (MIN_PASSPHRASE_BYTES..=MAX_PASSPHRASE_BYTES).contains(&passphrase.as_bytes().len()) {
        Ok(())
    } else {
        Err(ContinuityBackupError::InvalidPassphrase)
    }
}

fn hash_ref(domain: &[u8], values: &[&[u8]]) -> Result<Sha256Ref, ContinuityBackupError> {
    let mut hash = Sha256::new();
    hash.update(domain);
    for value in values {
        let length =
            u64::try_from(value.len()).map_err(|_| ContinuityBackupError::BoundExceeded)?;
        hash.update(length.to_be_bytes());
        hash.update(value);
    }
    Sha256Ref::parse(format!("sha256:{}", hex::encode(hash.finalize())))
        .map_err(|_| ContinuityBackupError::InvalidArchive)
}

fn hash_hex(bytes: &[u8]) -> Result<Hex64, ContinuityBackupError> {
    Hex64::parse(hex::encode(Sha256::digest(bytes)))
        .map_err(|_| ContinuityBackupError::InvalidArchive)
}

fn record_refs(records: &[ContinuityRecordV1]) -> Result<Vec<Sha256Ref>, ContinuityBackupError> {
    if records.len() > MAX_CONTINUITY_SNAPSHOT_RECORDS {
        return Err(ContinuityBackupError::BoundExceeded);
    }
    let mut refs = records
        .iter()
        .map(|record| {
            let encoded =
                canonicalize(record).map_err(|_| ContinuityBackupError::InvalidArchive)?;
            hash_ref(b"luca.continuity.backup.record.v1", &[&encoded])
        })
        .collect::<Result<Vec<_>, _>>()?;
    refs.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    refs.dedup();
    if refs.len() != records.len() {
        return Err(ContinuityBackupError::Integrity);
    }
    Ok(refs)
}

fn validate_mappings(
    mappings: &[BackupSourceMappingV1],
) -> Result<Vec<Sha256Ref>, ContinuityBackupError> {
    if mappings.len() > MAX_SOURCE_MAPPINGS {
        return Err(ContinuityBackupError::BoundExceeded);
    }
    let mut refs = Vec::with_capacity(mappings.len());
    for mapping in mappings {
        let resident = mapping
            .resident_pubkey
            .as_ref()
            .map(|key| key.as_str().as_bytes())
            .unwrap_or_default();
        let expected = hash_ref(
            MAPPING_REF_DOMAIN,
            &[mapping.source_ref.as_str().as_bytes(), resident],
        )?;
        if expected != mapping.mapping_ref {
            return Err(ContinuityBackupError::Integrity);
        }
        refs.push(mapping.mapping_ref.clone());
    }
    refs.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    refs.dedup();
    if refs.len() != mappings.len() {
        return Err(ContinuityBackupError::Integrity);
    }
    Ok(refs)
}

fn snapshot_ref(
    owner_pubkey: &Hex64,
    active_key_version: SafeU53,
    records: &[ContinuityRecordV1],
    mappings: &[BackupSourceMappingV1],
) -> Result<Sha256Ref, ContinuityBackupError> {
    let refs = record_refs(records)?;
    let mapping_refs = validate_mappings(mappings)?;
    let encoded =
        canonicalize(&(refs, mapping_refs)).map_err(|_| ContinuityBackupError::InvalidArchive)?;
    hash_ref(
        SNAPSHOT_REF_DOMAIN,
        &[
            owner_pubkey.as_str().as_bytes(),
            &active_key_version.get().to_be_bytes(),
            &encoded,
        ],
    )
}

fn calculate_integrity(
    manifest: &LucaBackupManifestV1,
    owner_identity: &OwnerIdentityBundleV1,
    active_key_version: SafeU53,
    root: &ContinuityMasterKey,
) -> Result<Hex64, ContinuityBackupError> {
    let master_key_sha256 = hash_hex(root.as_bytes())?;
    let input = BackupIntegrityInput {
        domain: std::str::from_utf8(ARCHIVE_INTEGRITY_DOMAIN)
            .map_err(|_| ContinuityBackupError::InvalidArchive)?,
        protocol: &manifest.protocol,
        backup_id: &manifest.backup_id,
        created_at: &manifest.created_at,
        owner_pubkey: &manifest.owner_pubkey,
        format_version: manifest.format_version,
        active_key_version,
        master_key_sha256,
        owner_identity_sha256: &owner_identity.manifest_sha256,
        encrypted_content_refs: &manifest.encrypted_content_refs,
        mapping_refs: &manifest.mapping_refs,
    };
    hash_hex(&canonicalize(&input).map_err(|_| ContinuityBackupError::InvalidArchive)?)
}

fn authenticate_records(
    root: &ContinuityMasterKey,
    owner_pubkey: &Hex64,
    active_key_version: SafeU53,
    records: &[ContinuityRecordV1],
) -> Result<(), ContinuityBackupError> {
    if records.len() > MAX_CONTINUITY_SNAPSHOT_RECORDS {
        return Err(ContinuityBackupError::BoundExceeded);
    }
    let mut total = 0usize;
    for record in records {
        if record.namespace.owner_pubkey != *owner_pubkey
            || record.namespace.key_version != record.key_version
            || record.key_version != active_key_version
        {
            return Err(ContinuityBackupError::Integrity);
        }
        let encoded = canonicalize(record).map_err(|_| ContinuityBackupError::InvalidArchive)?;
        total = total
            .checked_add(encoded.len())
            .ok_or(ContinuityBackupError::BoundExceeded)?;
        if total > MAX_CONTINUITY_SNAPSHOT_BYTES {
            return Err(ContinuityBackupError::BoundExceeded);
        }
        let namespace = NamespaceKey::new(record.namespace.clone())
            .map_err(|_| ContinuityBackupError::Integrity)?;
        let key =
            derive_namespace_key(root, &namespace).map_err(|_| ContinuityBackupError::Integrity)?;
        decrypt_record(record, key.as_bytes())
            .map_err(|_| ContinuityBackupError::Authentication)?;
    }
    Ok(())
}

fn build_archive(
    snapshot: ContinuityEncryptedSnapshot,
    root: &ContinuityMasterKey,
    owner_identity: OwnerIdentityBundleV1,
    backup_id: OpaqueId,
    created_at: CanonicalTimestamp,
    mut mappings: Vec<BackupSourceMappingV1>,
) -> Result<BackupArchiveV1, ContinuityBackupError> {
    if snapshot.records.len() > MAX_CONTINUITY_SNAPSHOT_RECORDS
        || mappings.len() > MAX_SOURCE_MAPPINGS
    {
        return Err(ContinuityBackupError::BoundExceeded);
    }
    owner_identity
        .validate()
        .map_err(|_| ContinuityBackupError::InvalidArchive)?;
    if owner_identity.owner_pubkey != snapshot.owner_pubkey {
        return Err(ContinuityBackupError::Integrity);
    }
    let identity_keys = owner_identity
        .owner_secret_nsec
        .with_exposed(Keys::parse)
        .map_err(|_| ContinuityBackupError::InvalidArchive)?;
    if identity_keys.public_key().to_hex() != snapshot.owner_pubkey.as_str() {
        return Err(ContinuityBackupError::Integrity);
    }
    authenticate_records(
        root,
        &snapshot.owner_pubkey,
        snapshot.active_key_version,
        &snapshot
            .records
            .iter()
            .map(|r| r.record.clone())
            .collect::<Vec<_>>(),
    )?;
    mappings.sort_by(|a, b| a.mapping_ref.as_str().cmp(b.mapping_ref.as_str()));
    let records = snapshot
        .records
        .into_iter()
        .map(|stored| stored.record)
        .collect::<Vec<_>>();
    let encrypted_content_refs = record_refs(&records)?;
    let mapping_refs = validate_mappings(&mappings)?;
    let mut manifest = LucaBackupManifestV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        backup_id,
        created_at,
        owner_pubkey: snapshot.owner_pubkey,
        format_version: SafeU53::new(BACKUP_FORMAT_VERSION)
            .map_err(|_| ContinuityBackupError::InvalidArchive)?,
        encrypted_content_refs,
        mapping_refs,
        integrity_sha256: Hex64::parse("0".repeat(64))
            .map_err(|_| ContinuityBackupError::InvalidArchive)?,
    };
    manifest.integrity_sha256 = calculate_integrity(
        &manifest,
        &owner_identity,
        snapshot.active_key_version,
        root,
    )?;
    Ok(BackupArchiveV1 {
        manifest,
        owner_identity,
        active_key_version: snapshot.active_key_version,
        continuity_master_key_b64: root.to_base64().to_string(),
        records,
        mappings,
    })
}

fn validate_archive(
    mut archive: BackupArchiveV1,
) -> Result<BackupArchiveV1, ContinuityBackupError> {
    if archive.records.len() > MAX_CONTINUITY_SNAPSHOT_RECORDS
        || archive.mappings.len() > MAX_SOURCE_MAPPINGS
    {
        return Err(ContinuityBackupError::BoundExceeded);
    }
    archive
        .manifest
        .validate()
        .map_err(|_| ContinuityBackupError::InvalidArchive)?;
    archive
        .owner_identity
        .validate()
        .map_err(|_| ContinuityBackupError::InvalidArchive)?;
    let identity_keys = archive
        .owner_identity
        .owner_secret_nsec
        .with_exposed(Keys::parse)
        .map_err(|_| ContinuityBackupError::InvalidArchive)?;
    if archive.manifest.format_version.get() != BACKUP_FORMAT_VERSION
        || archive.active_key_version.get() == 0
        || archive.owner_identity.owner_pubkey != archive.manifest.owner_pubkey
        || identity_keys.public_key().to_hex() != archive.manifest.owner_pubkey.as_str()
        || record_refs(&archive.records)? != archive.manifest.encrypted_content_refs
        || validate_mappings(&archive.mappings)? != archive.manifest.mapping_refs
    {
        return Err(ContinuityBackupError::Integrity);
    }
    let root = ContinuityMasterKey::from_base64(&archive.continuity_master_key_b64)
        .ok_or(ContinuityBackupError::InvalidArchive)?;
    if calculate_integrity(
        &archive.manifest,
        &archive.owner_identity,
        archive.active_key_version,
        &root,
    )? != archive.manifest.integrity_sha256
    {
        return Err(ContinuityBackupError::Integrity);
    }
    authenticate_records(
        &root,
        &archive.manifest.owner_pubkey,
        archive.active_key_version,
        &archive.records,
    )?;
    // Normalize the secret string so malformed noncanonical base64 never survives.
    archive.continuity_master_key_b64.zeroize();
    archive.continuity_master_key_b64 = root.to_base64().to_string();
    Ok(archive)
}

fn encrypt_archive(plaintext: &[u8], passphrase: &str) -> Result<Vec<u8>, ContinuityBackupError> {
    validate_passphrase(passphrase)?;
    let mut recipient = age::scrypt::Recipient::new(SecretString::from(passphrase.to_owned()));
    recipient.set_work_factor(EXPORT_SCRYPT_WORK_FACTOR);
    let encryptor = Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))
        .map_err(|_| ContinuityBackupError::Authentication)?;
    let mut ciphertext = Vec::new();
    let mut writer = encryptor
        .wrap_output(&mut ciphertext)
        .map_err(|_| ContinuityBackupError::Authentication)?;
    writer
        .write_all(plaintext)
        .and_then(|_| writer.finish())
        .map_err(|_| ContinuityBackupError::Authentication)?;
    if ciphertext.len() > MAX_CIPHERTEXT_BYTES {
        return Err(ContinuityBackupError::BoundExceeded);
    }
    Ok(ciphertext)
}

fn decrypt_archive(
    ciphertext: &[u8],
    passphrase: &str,
) -> Result<BackupArchiveV1, ContinuityBackupError> {
    if ciphertext.len() > MAX_CIPHERTEXT_BYTES {
        return Err(ContinuityBackupError::BoundExceeded);
    }
    validate_passphrase(passphrase)?;
    let decryptor =
        Decryptor::new_buffered(ciphertext).map_err(|_| ContinuityBackupError::InvalidArchive)?;
    if !decryptor.is_scrypt() {
        return Err(ContinuityBackupError::InvalidArchive);
    }
    let mut identity = age::scrypt::Identity::new(SecretString::from(passphrase.to_owned()));
    identity.set_max_work_factor(MAX_SCRYPT_WORK_FACTOR);
    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|_| ContinuityBackupError::Authentication)?;
    let mut plaintext = Zeroizing::new(Vec::new());
    reader
        .by_ref()
        .take((MAX_PLAINTEXT_BYTES + 1) as u64)
        .read_to_end(&mut plaintext)
        .map_err(|_| ContinuityBackupError::Authentication)?;
    if plaintext.len() > MAX_PLAINTEXT_BYTES {
        return Err(ContinuityBackupError::BoundExceeded);
    }
    // Inspect the decrypted JSON stream without materializing its values. This
    // rejects collection overflow and malformed top-level shape before strict
    // canonicalization clones the complete archive or typed deserialization
    // allocates either collection.
    let preflight = preflight_archive_structure(&plaintext)?;
    let canonical = Zeroizing::new(
        parse_and_canonicalize_strict(&plaintext, MAX_PLAINTEXT_BYTES)
            .map_err(|_| ContinuityBackupError::InvalidArchive)?,
    );
    if canonical.as_slice() != plaintext.as_slice() {
        return Err(ContinuityBackupError::InvalidArchive);
    }
    let archive = serde_json::from_slice::<BackupArchiveV1>(&plaintext)
        .map_err(|_| ContinuityBackupError::InvalidArchive)?;
    if archive.records.len() != preflight.record_count
        || archive.mappings.len() != preflight.mapping_count
    {
        return Err(ContinuityBackupError::InvalidArchive);
    }
    validate_archive(archive)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ArchiveStructurePreflight {
    record_count: usize,
    mapping_count: usize,
}

struct BoundedSequenceSeed {
    maximum: usize,
}

struct BoundedSequenceVisitor {
    maximum: usize,
}

impl<'de> DeserializeSeed<'de> for BoundedSequenceSeed {
    type Value = usize;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_seq(BoundedSequenceVisitor {
            maximum: self.maximum,
        })
    }
}

impl<'de> Visitor<'de> for BoundedSequenceVisitor {
    type Value = usize;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "an array with at most {} entries", self.maximum)
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        if sequence
            .size_hint()
            .is_some_and(|length| length > self.maximum)
        {
            return Err(de::Error::custom(PREFLIGHT_BOUND_ERROR));
        }
        let mut count = 0usize;
        while sequence.next_element::<IgnoredAny>()?.is_some() {
            count = count
                .checked_add(1)
                .ok_or_else(|| de::Error::custom(PREFLIGHT_BOUND_ERROR))?;
            if count > self.maximum {
                return Err(de::Error::custom(PREFLIGHT_BOUND_ERROR));
            }
        }
        Ok(count)
    }
}

struct ArchiveStructureVisitor;

impl<'de> Visitor<'de> for ArchiveStructureVisitor {
    type Value = ArchiveStructurePreflight;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the exact Luca backup top-level object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut seen = 0u8;
        let mut record_count = None;
        let mut mapping_count = None;
        while let Some(field) = map.next_key::<&str>()? {
            let (bit, duplicate_name) = match field {
                "manifest" => (1 << 0, "manifest"),
                "owner_identity" => (1 << 1, "owner_identity"),
                "active_key_version" => (1 << 2, "active_key_version"),
                "continuity_master_key_b64" => (1 << 3, "continuity_master_key_b64"),
                "records" => (1 << 4, "records"),
                "mappings" => (1 << 5, "mappings"),
                _ => return Err(de::Error::unknown_field(field, ARCHIVE_FIELDS)),
            };
            if seen & bit != 0 {
                return Err(de::Error::duplicate_field(duplicate_name));
            }
            seen |= bit;
            match field {
                "records" => {
                    record_count = Some(map.next_value_seed(BoundedSequenceSeed {
                        maximum: MAX_CONTINUITY_SNAPSHOT_RECORDS,
                    })?);
                }
                "mappings" => {
                    mapping_count = Some(map.next_value_seed(BoundedSequenceSeed {
                        maximum: MAX_SOURCE_MAPPINGS,
                    })?);
                }
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        if seen != 0b11_1111 {
            return Err(de::Error::custom("incomplete Luca backup top-level object"));
        }
        Ok(ArchiveStructurePreflight {
            record_count: record_count.ok_or_else(|| de::Error::missing_field("records"))?,
            mapping_count: mapping_count.ok_or_else(|| de::Error::missing_field("mappings"))?,
        })
    }
}

fn preflight_archive_structure(
    bytes: &[u8],
) -> Result<ArchiveStructurePreflight, ContinuityBackupError> {
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let result = (&mut deserializer).deserialize_map(ArchiveStructureVisitor);
    let preflight = result.map_err(|error| {
        if error.to_string().contains(PREFLIGHT_BOUND_ERROR) {
            ContinuityBackupError::BoundExceeded
        } else {
            ContinuityBackupError::InvalidArchive
        }
    })?;
    deserializer
        .end()
        .map_err(|_| ContinuityBackupError::InvalidArchive)?;
    Ok(preflight)
}

fn validate_path(path: &Path) -> Result<(), ContinuityBackupError> {
    if path.file_name().and_then(|name| name.to_str()).is_some()
        && path
            .to_string_lossy()
            .to_ascii_lowercase()
            .ends_with(&format!(".{BACKUP_EXTENSION}"))
    {
        if fs::symlink_metadata(path)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            Err(ContinuityBackupError::InvalidRequest)
        } else {
            Ok(())
        }
    } else {
        Err(ContinuityBackupError::InvalidRequest)
    }
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, ContinuityBackupError> {
    validate_path(path)?;
    let file = File::open(path).map_err(|_| ContinuityBackupError::Io)?;
    let length = file
        .metadata()
        .map_err(|_| ContinuityBackupError::Io)?
        .len();
    if length > MAX_CIPHERTEXT_BYTES as u64 {
        return Err(ContinuityBackupError::BoundExceeded);
    }
    let mut bytes = Vec::with_capacity(length as usize);
    file.take((MAX_CIPHERTEXT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| ContinuityBackupError::Io)?;
    if bytes.len() > MAX_CIPHERTEXT_BYTES {
        return Err(ContinuityBackupError::BoundExceeded);
    }
    Ok(bytes)
}

fn write_private_noclobber(path: &Path, bytes: &[u8]) -> Result<(), ContinuityBackupError> {
    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .ok_or(ContinuityBackupError::InvalidRequest)?;
    if !parent.is_dir() {
        return Err(ContinuityBackupError::InvalidRequest);
    }
    let mut temporary = TempFileBuilder::new()
        .prefix(".luca-continuity-")
        .tempfile_in(parent)
        .map_err(|_| ContinuityBackupError::Io)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temporary
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| ContinuityBackupError::Io)?;
    }
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.flush())
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| ContinuityBackupError::Io)?;
    temporary.persist_noclobber(path).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            ContinuityBackupError::DestinationExists
        } else {
            ContinuityBackupError::Io
        }
    })?;
    sync_directory(parent)
}

fn sync_directory(path: &Path) -> Result<(), ContinuityBackupError> {
    OpenOptions::new()
        .read(true)
        .open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| ContinuityBackupError::Io)
}

fn preview_from(
    ciphertext: &[u8],
    archive: &BackupArchiveV1,
) -> Result<ContinuityBackupPreview, ContinuityBackupError> {
    Ok(ContinuityBackupPreview {
        backup_id: archive.manifest.backup_id.clone(),
        created_at: archive.manifest.created_at.clone(),
        owner_pubkey: archive.manifest.owner_pubkey.clone(),
        record_count: archive.records.len(),
        mapping_count: archive.mappings.len(),
        ciphertext_sha256: hash_hex(ciphertext)?,
    })
}

/// Export one immutable, protected owner snapshot. The caller supplies an
/// already-loaded root; this function never mints or fetches a key.
pub(crate) fn export_continuity_backup(
    lifecycle: &ContinuityLifecycleLock,
    store: &mut ContinuityStore,
    root: &ContinuityMasterKey,
    owner_identity: OwnerIdentityBundleV1,
    owner_pubkey: Hex64,
    backup_id: OpaqueId,
    created_at: CanonicalTimestamp,
    mappings: Vec<BackupSourceMappingV1>,
    destination: &Path,
    passphrase: Zeroizing<String>,
) -> Result<ContinuityBackupReceipt, ContinuityBackupError> {
    if mappings.len() > MAX_SOURCE_MAPPINGS {
        return Err(ContinuityBackupError::BoundExceeded);
    }
    validate_path(destination)?;
    let _guard = lifecycle.lock().map_err(|_| ContinuityBackupError::Io)?;
    let snapshot = store.snapshot_owner_encrypted(&owner_pubkey)?;
    let archive = build_archive(
        snapshot,
        root,
        owner_identity,
        backup_id,
        created_at,
        mappings,
    )?;
    let plaintext =
        Zeroizing::new(canonicalize(&archive).map_err(|_| ContinuityBackupError::InvalidArchive)?);
    if plaintext.len() > MAX_PLAINTEXT_BYTES {
        return Err(ContinuityBackupError::BoundExceeded);
    }
    let ciphertext = encrypt_archive(&plaintext, &passphrase)?;
    write_private_noclobber(destination, &ciphertext)?;
    let read_back = read_bounded(destination)?;
    let validated = decrypt_archive(&read_back, &passphrase)?;
    Ok(ContinuityBackupReceipt {
        preview: preview_from(&read_back, &validated)?,
    })
}

/// Zero-write preview: by construction it receives no store, keychain, or
/// lifecycle handle and performs only bounded read/decrypt/validation.
pub(crate) fn preview_continuity_backup(
    source: &Path,
    passphrase: Zeroizing<String>,
) -> Result<ContinuityBackupPreview, ContinuityBackupError> {
    let ciphertext = read_bounded(source)?;
    let archive = decrypt_archive(&ciphertext, &passphrase)?;
    preview_from(&ciphertext, &archive)
}

fn store_restore_state<S: ContinuityKeyStore>(
    key_store: &S,
    state: &RestoreStateV1,
) -> Result<(), ContinuityBackupError> {
    let encoded = Zeroizing::new(
        String::from_utf8(canonicalize(state).map_err(|_| ContinuityBackupError::InvalidArchive)?)
            .map_err(|_| ContinuityBackupError::InvalidArchive)?,
    );
    key_store.store_raw(RESTORE_STATE_KEY, &encoded)?;
    let read_back = key_store
        .load_raw(RESTORE_STATE_KEY)?
        .ok_or(ContinuityBackupError::Integrity)?;
    if read_back.as_bytes() != encoded.as_bytes() {
        return Err(ContinuityBackupError::Integrity);
    }
    Ok(())
}

fn load_restore_state<S: ContinuityKeyStore>(
    key_store: &S,
) -> Result<Option<RestoreStateV1>, ContinuityBackupError> {
    let Some(raw) = key_store.load_raw(RESTORE_STATE_KEY)? else {
        return Ok(None);
    };
    let canonical = Zeroizing::new(
        parse_and_canonicalize_strict(raw.as_bytes(), 16 * 1024)
            .map_err(|_| ContinuityBackupError::Integrity)?,
    );
    if canonical.as_slice() != raw.as_bytes() {
        return Err(ContinuityBackupError::Integrity);
    }
    let state: RestoreStateV1 =
        serde_json::from_slice(raw.as_bytes()).map_err(|_| ContinuityBackupError::Integrity)?;
    if state.protocol != CONTINUITY_PROTOCOL {
        return Err(ContinuityBackupError::Integrity);
    }
    Ok(Some(state))
}

fn master_verifier(encoded: &str) -> Result<Hex64, ContinuityBackupError> {
    let key = ContinuityMasterKey::from_base64(encoded).ok_or(ContinuityBackupError::Integrity)?;
    hash_hex(key.as_bytes())
}

fn identity_verifier(encoded: &str) -> Result<Hex64, ContinuityBackupError> {
    let keys = Keys::parse(encoded).map_err(|_| ContinuityBackupError::Integrity)?;
    Hex64::parse(keys.public_key().to_hex()).map_err(|_| ContinuityBackupError::Integrity)
}

fn active_master_verifier<S: ContinuityKeyStore>(
    key_store: &S,
) -> Result<Option<Hex64>, ContinuityBackupError> {
    key_store
        .load_raw(CONTINUITY_MASTER_KEY_NAME)?
        .map(|value| master_verifier(&value))
        .transpose()
}

fn active_identity_verifier<S: ContinuityKeyStore>(
    key_store: &S,
) -> Result<Option<Hex64>, ContinuityBackupError> {
    key_store
        .load_raw(IDENTITY_KEY_NAME)?
        .map(|value| identity_verifier(&value))
        .transpose()
}

fn verify_master_rollback<S: ContinuityKeyStore>(
    key_store: &S,
    expected: &Option<Hex64>,
) -> Result<bool, ContinuityBackupError> {
    let Some(rollback) = key_store.load_raw(CONTINUITY_MASTER_KEY_ROLLBACK_NAME)? else {
        return Ok(false);
    };
    match expected {
        Some(expected) if master_verifier(&rollback)? == *expected => Ok(true),
        None if rollback.as_str() == ABSENT_ROLLBACK_MARKER => Ok(true),
        _ => Err(ContinuityBackupError::Integrity),
    }
}

fn verify_identity_rollback<S: ContinuityKeyStore>(
    key_store: &S,
    expected: &Option<Hex64>,
) -> Result<bool, ContinuityBackupError> {
    let Some(rollback) = key_store.load_raw(IDENTITY_ROLLBACK_KEY)? else {
        return Ok(false);
    };
    match expected {
        Some(expected) if identity_verifier(&rollback)? == *expected => Ok(true),
        None if rollback.as_str() == ABSENT_IDENTITY_MARKER => Ok(true),
        _ => Err(ContinuityBackupError::Integrity),
    }
}

fn install_candidate_identity<S: ContinuityKeyStore>(
    key_store: &S,
    identity: &OwnerIdentityBundleV1,
) -> Result<(), ContinuityBackupError> {
    if key_store.load_raw(IDENTITY_ROLLBACK_KEY)?.is_some() {
        return Err(ContinuityBackupError::Integrity);
    }
    let prior = key_store.load_raw(IDENTITY_KEY_NAME)?;
    if let Some(prior) = prior.as_ref() {
        identity_verifier(prior)?;
    }
    let rollback = prior
        .as_ref()
        .map(|value| value.as_str())
        .unwrap_or(ABSENT_IDENTITY_MARKER);
    key_store.store_raw(IDENTITY_ROLLBACK_KEY, rollback)?;
    let read_back = key_store
        .load_raw(IDENTITY_ROLLBACK_KEY)?
        .ok_or(ContinuityBackupError::Integrity)?;
    if read_back.as_bytes() != rollback.as_bytes() {
        let _ = key_store.delete_raw(IDENTITY_ROLLBACK_KEY);
        return Err(ContinuityBackupError::Integrity);
    }
    let result = identity.owner_secret_nsec.with_exposed(|nsec| {
        key_store.store_raw(IDENTITY_KEY_NAME, nsec)?;
        let active = key_store
            .load_raw(IDENTITY_KEY_NAME)?
            .ok_or(ContinuityBackupError::Integrity)?;
        let keys = Keys::parse(active.as_str()).map_err(|_| ContinuityBackupError::Integrity)?;
        if active.as_bytes() != nsec.as_bytes()
            || keys.public_key().to_hex() != identity.owner_pubkey.as_str()
        {
            return Err(ContinuityBackupError::Integrity);
        }
        Ok(())
    });
    if let Err(error) = result {
        let _ = rollback_candidate_identity(key_store);
        return Err(error);
    }
    Ok(())
}

fn rollback_candidate_identity<S: ContinuityKeyStore>(
    key_store: &S,
) -> Result<(), ContinuityBackupError> {
    let rollback = key_store
        .load_raw(IDENTITY_ROLLBACK_KEY)?
        .ok_or(ContinuityBackupError::Integrity)?;
    if rollback.as_str() == ABSENT_IDENTITY_MARKER {
        key_store.delete_raw(IDENTITY_KEY_NAME)?;
    } else {
        Keys::parse(rollback.as_str()).map_err(|_| ContinuityBackupError::Integrity)?;
        key_store.store_raw(IDENTITY_KEY_NAME, &rollback)?;
        let actual = key_store
            .load_raw(IDENTITY_KEY_NAME)?
            .ok_or(ContinuityBackupError::Integrity)?;
        if actual.as_bytes() != rollback.as_bytes() {
            return Err(ContinuityBackupError::Integrity);
        }
    }
    key_store.delete_raw(IDENTITY_ROLLBACK_KEY)?;
    Ok(())
}

fn finalize_candidate_identity<S: ContinuityKeyStore>(
    key_store: &S,
) -> Result<(), ContinuityBackupError> {
    key_store.delete_raw(IDENTITY_ROLLBACK_KEY)?;
    Ok(())
}

fn reconcile_master_to_old<S: ContinuityKeyStore>(
    key_store: &S,
    state: &RestoreStateV1,
) -> Result<(), ContinuityBackupError> {
    let active = active_master_verifier(key_store)?;
    let rollback = verify_master_rollback(key_store, &state.old_master_key_sha256)?;
    if active != state.old_master_key_sha256 {
        if active.as_ref() != Some(&state.new_master_key_sha256) || !rollback {
            return Err(ContinuityBackupError::Integrity);
        }
    }
    if rollback {
        rollback_candidate_master_key(key_store)?;
    }
    if active_master_verifier(key_store)? != state.old_master_key_sha256
        || key_store
            .load_raw(CONTINUITY_MASTER_KEY_ROLLBACK_NAME)?
            .is_some()
    {
        return Err(ContinuityBackupError::Integrity);
    }
    Ok(())
}

fn reconcile_identity_to_old<S: ContinuityKeyStore>(
    key_store: &S,
    state: &RestoreStateV1,
) -> Result<(), ContinuityBackupError> {
    let active = active_identity_verifier(key_store)?;
    let rollback = verify_identity_rollback(key_store, &state.old_identity_pubkey)?;
    if active != state.old_identity_pubkey {
        if active.as_ref() != Some(&state.new_identity_pubkey) || !rollback {
            return Err(ContinuityBackupError::Integrity);
        }
    }
    if rollback {
        rollback_candidate_identity(key_store)?;
    }
    if active_identity_verifier(key_store)? != state.old_identity_pubkey
        || key_store.load_raw(IDENTITY_ROLLBACK_KEY)?.is_some()
    {
        return Err(ContinuityBackupError::Integrity);
    }
    Ok(())
}

fn reconcile_authority_to_new<S: ContinuityKeyStore>(
    key_store: &S,
    state: &RestoreStateV1,
) -> Result<(), ContinuityBackupError> {
    if active_master_verifier(key_store)?.as_ref() != Some(&state.new_master_key_sha256)
        || active_identity_verifier(key_store)?.as_ref() != Some(&state.new_identity_pubkey)
    {
        return Err(ContinuityBackupError::Integrity);
    }
    if verify_master_rollback(key_store, &state.old_master_key_sha256)? {
        finalize_candidate_master_key(key_store)?;
    }
    if verify_identity_rollback(key_store, &state.old_identity_pubkey)? {
        finalize_candidate_identity(key_store)?;
    }
    if active_master_verifier(key_store)?.as_ref() != Some(&state.new_master_key_sha256)
        || active_identity_verifier(key_store)?.as_ref() != Some(&state.new_identity_pubkey)
        || key_store
            .load_raw(CONTINUITY_MASTER_KEY_ROLLBACK_NAME)?
            .is_some()
        || key_store.load_raw(IDENTITY_ROLLBACK_KEY)?.is_some()
    {
        return Err(ContinuityBackupError::Integrity);
    }
    Ok(())
}

fn validate_restore_destination<S: ContinuityKeyStore>(
    store: &ContinuityStore,
    key_store: &S,
    owner_pubkey: &Hex64,
    candidate_master_sha256: &Hex64,
) -> Result<(), ContinuityBackupError> {
    let destination = store.restore_destination(owner_pubkey)?;
    let master = active_master_verifier(key_store)?;
    let identity = active_identity_verifier(key_store)?;
    match (destination, master.as_ref(), identity.as_ref()) {
        (ContinuityRestoreDestination::Empty, None, None) => Ok(()),
        (
            ContinuityRestoreDestination::Empty | ContinuityRestoreDestination::ExactOwner,
            Some(master),
            Some(identity),
        ) if master == candidate_master_sha256 && identity == owner_pubkey => Ok(()),
        _ => Err(ContinuityBackupError::Integrity),
    }
}

fn terminate_restore_journal<S: ContinuityKeyStore>(
    key_store: &S,
) -> Result<(), ContinuityBackupError> {
    key_store.delete_raw(RESTORE_STATE_KEY)?;
    if key_store.load_raw(RESTORE_STATE_KEY)?.is_some() {
        return Err(ContinuityBackupError::Integrity);
    }
    Ok(())
}

fn handle_restore_error<S: ContinuityKeyStore>(
    store: &mut ContinuityStore,
    key_store: &S,
    error: ContinuityBackupError,
) -> ContinuityBackupError {
    if matches!(error, ContinuityBackupError::InjectedCrash(_)) {
        return error;
    }
    match recover_pending_restore_locked(store, key_store) {
        Ok(_) => error,
        Err(recovery) => recovery,
    }
}

/// Recover an interrupted confirmed restore without a passphrase. The journal
/// contains only identity/hash metadata. SQLite atomicity makes the observed
/// snapshot either exactly old or exactly new.
pub(crate) fn recover_pending_restore<S: ContinuityKeyStore>(
    lifecycle: &ContinuityLifecycleLock,
    store: &mut ContinuityStore,
    key_store: &S,
) -> Result<bool, ContinuityBackupError> {
    let _guard = lifecycle.lock().map_err(|_| ContinuityBackupError::Io)?;
    recover_pending_restore_locked(store, key_store)
}

fn recover_pending_restore_locked<S: ContinuityKeyStore>(
    store: &mut ContinuityStore,
    key_store: &S,
) -> Result<bool, ContinuityBackupError> {
    let Some(state) = load_restore_state(key_store)? else {
        return Ok(false);
    };
    let snapshot = store.snapshot_owner_encrypted(&state.owner_pubkey)?;
    let records = snapshot
        .records
        .into_iter()
        .map(|row| row.record)
        .collect::<Vec<_>>();
    let mappings = snapshot
        .source_mappings
        .iter()
        .map(BackupSourceMappingV1::from)
        .collect::<Vec<_>>();
    let current = snapshot_ref(
        &state.owner_pubkey,
        snapshot.active_key_version,
        &records,
        &mappings,
    )?;
    if current == state.new_snapshot_ref {
        reconcile_authority_to_new(key_store, &state)?;
    } else if current == state.old_snapshot_ref {
        reconcile_master_to_old(key_store, &state)?;
        reconcile_identity_to_old(key_store, &state)?;
    } else {
        return Err(ContinuityBackupError::Integrity);
    }
    terminate_restore_journal(key_store)?;
    Ok(true)
}

/// Confirmed restore with exact preview binding. The source is re-read and
/// revalidated before any write. An inactive 0600 staging copy contains only
/// age ciphertext and is removed on every normal return path.
pub(crate) fn restore_continuity_backup<S: ContinuityKeyStore>(
    lifecycle: &ContinuityLifecycleLock,
    store: &mut ContinuityStore,
    key_store: &S,
    source: &Path,
    passphrase: Zeroizing<String>,
    confirmation: &ContinuityRestoreConfirmation,
    staging_directory: &Path,
    crash: &mut dyn RestoreCrashInjector,
) -> Result<ContinuityRestoreReceipt, ContinuityBackupError> {
    let ciphertext = read_bounded(source)?;
    let archive = decrypt_archive(&ciphertext, &passphrase)?;
    let preview = preview_from(&ciphertext, &archive)?;
    if preview.backup_id != confirmation.backup_id
        || preview.owner_pubkey != confirmation.owner_pubkey
        || preview.ciphertext_sha256 != confirmation.ciphertext_sha256
    {
        return Err(ContinuityBackupError::ConfirmationMismatch);
    }
    if !staging_directory.is_dir() {
        return Err(ContinuityBackupError::InvalidRequest);
    }
    let _guard = lifecycle.lock().map_err(|_| ContinuityBackupError::Io)?;
    if load_restore_state(key_store)?.is_some() {
        recover_pending_restore_locked(store, key_store)?;
    }
    let candidate = ContinuityMasterKey::from_base64(&archive.continuity_master_key_b64)
        .ok_or(ContinuityBackupError::InvalidArchive)?;
    let candidate_sha256 = hash_hex(candidate.as_bytes())?;
    validate_restore_destination(
        store,
        key_store,
        &archive.manifest.owner_pubkey,
        &candidate_sha256,
    )?;
    let mut stage = TempFileBuilder::new()
        .prefix(".luca-restore-inactive-")
        .tempfile_in(staging_directory)
        .map_err(|_| ContinuityBackupError::Io)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        stage
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| ContinuityBackupError::Io)?;
    }
    stage
        .write_all(&ciphertext)
        .and_then(|_| stage.flush())
        .and_then(|_| stage.as_file().sync_all())
        .map_err(|_| ContinuityBackupError::Io)?;
    crash.checkpoint(RestoreCrashPoint::AfterStage)?;

    let old = store.snapshot_owner_encrypted(&archive.manifest.owner_pubkey)?;
    let old_records = old
        .records
        .iter()
        .map(|row| row.record.clone())
        .collect::<Vec<_>>();
    let old_mappings = old
        .source_mappings
        .iter()
        .map(BackupSourceMappingV1::from)
        .collect::<Vec<_>>();
    let old_ref = snapshot_ref(
        &old.owner_pubkey,
        old.active_key_version,
        &old_records,
        &old_mappings,
    )?;
    let new_ref = snapshot_ref(
        &archive.manifest.owner_pubkey,
        archive.active_key_version,
        &archive.records,
        &archive.mappings,
    )?;
    // Existing active slots are validated before any state write. Their
    // body-free verifiers bind later recovery to exact old/new authority.
    let old_master_key_sha256 = active_master_verifier(key_store)?;
    let old_identity_pubkey = active_identity_verifier(key_store)?;
    let mut state = RestoreStateV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        backup_id: archive.manifest.backup_id.clone(),
        owner_pubkey: archive.manifest.owner_pubkey.clone(),
        old_snapshot_ref: old_ref,
        new_snapshot_ref: new_ref,
        old_master_key_sha256,
        new_master_key_sha256: candidate_sha256,
        old_identity_pubkey,
        new_identity_pubkey: archive.owner_identity.owner_pubkey.clone(),
        phase: RestorePhase::Prepared,
    };
    store_restore_state(key_store, &state)?;
    crash.checkpoint(RestoreCrashPoint::AfterJournal)?;

    if let Err(error) = install_candidate_identity(key_store, &archive.owner_identity) {
        return Err(handle_restore_error(store, key_store, error));
    }
    state.phase = RestorePhase::IdentityCandidateInstalled;
    if let Err(error) = store_restore_state(key_store, &state) {
        return Err(handle_restore_error(store, key_store, error));
    }
    if let Err(error) = install_candidate_master_key(key_store, &candidate) {
        return Err(handle_restore_error(store, key_store, error.into()));
    }
    state.phase = RestorePhase::CandidateInstalled;
    if let Err(error) = store_restore_state(key_store, &state) {
        return Err(handle_restore_error(store, key_store, error));
    }
    crash.checkpoint(RestoreCrashPoint::AfterKeyInstall)?;

    let mappings = archive
        .mappings
        .iter()
        .map(ContinuitySourceMapping::from)
        .collect::<Vec<_>>();
    let activation = store.replace_owner_snapshot_atomically(
        &archive.manifest.owner_pubkey,
        &archive.records,
        &mappings,
        archive.active_key_version,
    );
    if let Err(error) = activation {
        return Err(handle_restore_error(store, key_store, error.into()));
    }
    state.phase = RestorePhase::StoreActivated;
    if let Err(error) = store_restore_state(key_store, &state) {
        return Err(handle_restore_error(store, key_store, error));
    }
    crash.checkpoint(RestoreCrashPoint::AfterStoreActivation)?;
    let active = store.snapshot_owner_encrypted(&archive.manifest.owner_pubkey)?;
    let active_records = active
        .records
        .into_iter()
        .map(|row| row.record)
        .collect::<Vec<_>>();
    let active_mappings = active
        .source_mappings
        .iter()
        .map(BackupSourceMappingV1::from)
        .collect::<Vec<_>>();
    authenticate_records(
        &candidate,
        &archive.manifest.owner_pubkey,
        active.active_key_version,
        &active_records,
    )?;
    if snapshot_ref(
        &archive.manifest.owner_pubkey,
        active.active_key_version,
        &active_records,
        &active_mappings,
    )? != state.new_snapshot_ref
    {
        return Err(ContinuityBackupError::Integrity);
    }
    state.phase = RestorePhase::Verified;
    if let Err(error) = store_restore_state(key_store, &state) {
        return Err(handle_restore_error(store, key_store, error));
    }
    crash.checkpoint(RestoreCrashPoint::AfterVerification)?;
    if let Err(error) = reconcile_authority_to_new(key_store, &state) {
        return Err(handle_restore_error(store, key_store, error));
    }
    terminate_restore_journal(key_store)?;
    sync_directory(staging_directory)?;
    Ok(ContinuityRestoreReceipt {
        backup_id: archive.manifest.backup_id.clone(),
        owner_pubkey: archive.manifest.owner_pubkey.clone(),
        restored_records: archive.records.len(),
        restored_mappings: archive.mappings.len(),
        mappings: archive.mappings.clone(),
    })
}

impl fmt::Display for ContinuityBackupError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("continuity backup operation failed")
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, collections::BTreeMap};

    use luca_continuity::{encrypt_record, RecordMetadata};
    use luca_protocol::{
        BundleId, ContinuityNamespaceKindV1, ContinuityNamespaceV1, ContinuityScopeV1, SecretNsec,
        OWNER_IDENTITY_CANONICALIZATION, OWNER_IDENTITY_FORMAT, OWNER_IDENTITY_VERSION,
    };
    use nostr::ToBech32;
    use tempfile::TempDir;

    use super::*;
    use crate::luca::continuity_store::{ContinuityStoreCustody, ContinuityStoreOpen};

    #[derive(Default)]
    struct FakeKeychain(RefCell<BTreeMap<String, String>>);

    impl ContinuityKeyStore for FakeKeychain {
        fn load_raw(
            &self,
            name: &str,
        ) -> Result<Option<Zeroizing<String>>, ContinuityKeyStoreError> {
            Ok(self.0.borrow().get(name).cloned().map(Zeroizing::new))
        }

        fn store_raw(&self, name: &str, value: &str) -> Result<(), ContinuityKeyStoreError> {
            self.0
                .borrow_mut()
                .insert(name.to_owned(), value.to_owned());
            Ok(())
        }

        fn delete_raw(&self, name: &str) -> Result<(), ContinuityKeyStoreError> {
            self.0.borrow_mut().remove(name);
            Ok(())
        }
    }

    #[derive(Default)]
    struct CommitThenErrorKeychain {
        values: RefCell<BTreeMap<String, String>>,
        commit_then_error_name: RefCell<Option<String>>,
    }

    impl ContinuityKeyStore for CommitThenErrorKeychain {
        fn load_raw(
            &self,
            name: &str,
        ) -> Result<Option<Zeroizing<String>>, ContinuityKeyStoreError> {
            Ok(self.values.borrow().get(name).cloned().map(Zeroizing::new))
        }

        fn store_raw(&self, name: &str, value: &str) -> Result<(), ContinuityKeyStoreError> {
            self.values
                .borrow_mut()
                .insert(name.to_owned(), value.to_owned());
            if self
                .commit_then_error_name
                .borrow()
                .as_deref()
                .is_some_and(|target| target == name)
            {
                self.commit_then_error_name.borrow_mut().take();
                return Err(ContinuityKeyStoreError::Locked);
            }
            Ok(())
        }

        fn delete_raw(&self, name: &str) -> Result<(), ContinuityKeyStoreError> {
            self.values.borrow_mut().remove(name);
            Ok(())
        }
    }

    fn hex(byte: u8) -> Hex64 {
        Hex64::parse(hex::encode([byte; 32])).unwrap()
    }

    fn sha(byte: u8) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{}", hex::encode([byte; 32]))).unwrap()
    }

    fn open(path: &Path) -> ContinuityStore {
        match ContinuityStore::open(path, ContinuityStoreCustody::Ready).unwrap() {
            ContinuityStoreOpen::Ready(store) => store,
            _ => panic!("store must open"),
        }
    }

    fn seed(store: &mut ContinuityStore, root: &ContinuityMasterKey, owner: &Hex64) {
        let namespace = ContinuityNamespaceV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            owner_pubkey: owner.clone(),
            kind: ContinuityNamespaceKindV1::ResidentPrivate,
            resident_pubkey: Some(hex(2)),
            namespace_ref: sha(3),
            key_version: SafeU53::new(1).unwrap(),
        };
        let key =
            derive_namespace_key(root, &NamespaceKey::new(namespace.clone()).unwrap()).unwrap();
        let record = encrypt_record(
            RecordMetadata {
                protocol: CONTINUITY_PROTOCOL.to_owned(),
                record_id: OpaqueId::parse("backup-record").unwrap(),
                namespace: namespace.clone(),
                scope: ContinuityScopeV1 {
                    protocol: CONTINUITY_PROTOCOL.to_owned(),
                    namespace_ref: namespace.namespace_ref.clone(),
                    scope_ref: sha(4),
                    source_id: Some(OpaqueId::parse("seed-source").unwrap()),
                    project_id: None,
                    room_id: None,
                    conversation_id: None,
                },
                record_type: OpaqueId::parse("hypomnema").unwrap(),
                revision: SafeU53::new(0).unwrap(),
                predecessor_record_id: None,
                created_at: CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
                author_kind: OpaqueId::parse("resident").unwrap(),
                provenance_refs: vec![sha(5)],
                key_version: SafeU53::new(1).unwrap(),
            },
            key.as_bytes(),
            b"private continuity body",
        )
        .unwrap();
        store.put_encrypted(&record).unwrap();
    }

    fn mapping() -> BackupSourceMappingV1 {
        let source_ref = sha(7);
        let mapping_ref =
            hash_ref(MAPPING_REF_DOMAIN, &[source_ref.as_str().as_bytes(), &[]]).unwrap();
        BackupSourceMappingV1 {
            mapping_ref,
            source_ref,
            resident_pubkey: None,
        }
    }

    fn passphrase() -> Zeroizing<String> {
        Zeroizing::new("correct horse battery staple".to_owned())
    }

    fn owner_identity() -> (OwnerIdentityBundleV1, Hex64) {
        let keys = Keys::parse(&hex::encode([0x31; 32])).unwrap();
        let owner = Hex64::parse(keys.public_key().to_hex()).unwrap();
        let nsec = keys.secret_key().to_bech32().unwrap();
        let mut bundle = OwnerIdentityBundleV1 {
            format: OWNER_IDENTITY_FORMAT.to_owned(),
            version: OWNER_IDENTITY_VERSION,
            canonicalization: OWNER_IDENTITY_CANONICALIZATION.to_owned(),
            bundle_id: BundleId::parse("c617eda3-0f1a-42bb-9f97-2af93cb25a0b").unwrap(),
            exported_at: CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
            owner_pubkey: owner.clone(),
            owner_secret_nsec: SecretNsec::new(nsec).unwrap(),
            manifest_sha256: Hex64::parse("0".repeat(64)).unwrap(),
        };
        bundle.manifest_sha256 = bundle.calculate_manifest_sha256().unwrap();
        (bundle, owner)
    }

    struct FailAt(Option<RestoreCrashPoint>);

    impl RestoreCrashInjector for FailAt {
        fn checkpoint(&mut self, point: RestoreCrashPoint) -> Result<(), ContinuityBackupError> {
            if self.0 == Some(point) {
                self.0 = None;
                Err(ContinuityBackupError::InjectedCrash(point))
            } else {
                Ok(())
            }
        }
    }

    #[test]
    fn backup_preview_is_strict_and_restore_is_exact() {
        let source_dir = TempDir::new().unwrap();
        let destination_dir = TempDir::new().unwrap();
        let restore_dir = TempDir::new().unwrap();
        let (identity, owner) = owner_identity();
        let root = ContinuityMasterKey::new_for_test([0x51; 32]);
        let mut source_store = open(source_dir.path());
        seed(&mut source_store, &root, &owner);
        let lifecycle = ContinuityLifecycleLock::new_for_test();
        let path = destination_dir.path().join("test.luca-backup.age");
        let receipt = export_continuity_backup(
            &lifecycle,
            &mut source_store,
            &root,
            identity,
            owner.clone(),
            OpaqueId::parse("backup-test-1").unwrap(),
            CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
            vec![mapping()],
            &path,
            passphrase(),
        )
        .unwrap();
        let preview = preview_continuity_backup(&path, passphrase()).unwrap();
        assert_eq!(preview, receipt.preview);

        let mut restored = open(restore_dir.path());
        let keychain = FakeKeychain::default();
        let confirmation = ContinuityRestoreConfirmation {
            backup_id: preview.backup_id.clone(),
            owner_pubkey: preview.owner_pubkey.clone(),
            ciphertext_sha256: preview.ciphertext_sha256.clone(),
        };
        let result = restore_continuity_backup(
            &lifecycle,
            &mut restored,
            &keychain,
            &path,
            passphrase(),
            &confirmation,
            restore_dir.path(),
            &mut NoRestoreCrash,
        )
        .unwrap();
        assert_eq!(result.restored_records, 1);
        assert_eq!(result.mappings, vec![mapping()]);
        assert_eq!(
            restored.source_mappings_for_test(&owner).unwrap(),
            vec![ContinuitySourceMapping::from(&mapping())]
        );
        let restored_identity = keychain.load_raw(IDENTITY_KEY_NAME).unwrap().unwrap();
        assert_eq!(
            Keys::parse(restored_identity.as_str())
                .unwrap()
                .public_key()
                .to_hex(),
            owner.as_str()
        );
        assert!(keychain.load_raw(RESTORE_STATE_KEY).unwrap().is_none());
        assert!(keychain
            .load_raw(CONTINUITY_MASTER_KEY_ROLLBACK_NAME)
            .unwrap()
            .is_none());
        assert_eq!(
            restored
                .snapshot_owner_encrypted(&owner)
                .unwrap()
                .records
                .len(),
            1
        );
    }

    #[test]
    fn preview_wrong_passphrase_and_confirmation_fail_before_state_writes() {
        let source_dir = TempDir::new().unwrap();
        let destination_dir = TempDir::new().unwrap();
        let (identity, owner) = owner_identity();
        let root = ContinuityMasterKey::new_for_test([0x51; 32]);
        let mut source_store = open(source_dir.path());
        seed(&mut source_store, &root, &owner);
        let lifecycle = ContinuityLifecycleLock::new_for_test();
        let path = destination_dir.path().join("test.luca-backup.age");
        export_continuity_backup(
            &lifecycle,
            &mut source_store,
            &root,
            identity,
            owner,
            OpaqueId::parse("backup-test-2").unwrap(),
            CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
            vec![],
            &path,
            passphrase(),
        )
        .unwrap();
        assert_eq!(
            preview_continuity_backup(&path, Zeroizing::new("wrong-passphrase-123".to_owned())),
            Err(ContinuityBackupError::Authentication)
        );
    }

    #[test]
    fn mixed_physical_key_versions_are_rejected() {
        let source_dir = TempDir::new().unwrap();
        let destination_dir = TempDir::new().unwrap();
        let (identity, owner) = owner_identity();
        let root = ContinuityMasterKey::new_for_test([0x51; 32]);
        let mut source_store = open(source_dir.path());
        seed(&mut source_store, &root, &owner);
        let records = source_store
            .snapshot_owner_encrypted(&owner)
            .unwrap()
            .records
            .into_iter()
            .map(|row| row.record)
            .collect::<Vec<_>>();
        source_store
            .replace_owner_snapshot_atomically(&owner, &records, &[], SafeU53::new(2).unwrap())
            .unwrap();
        let path = destination_dir.path().join("mixed.luca-backup.age");
        assert_eq!(
            export_continuity_backup(
                &ContinuityLifecycleLock::new_for_test(),
                &mut source_store,
                &root,
                identity,
                owner,
                OpaqueId::parse("backup-mixed-version").unwrap(),
                CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
                vec![mapping()],
                &path,
                passphrase(),
            ),
            Err(ContinuityBackupError::Integrity)
        );
        assert!(!path.exists());
    }

    #[test]
    fn restore_recovers_both_sides_of_keychain_sqlite_crash_boundary() {
        for point in [
            RestoreCrashPoint::AfterKeyInstall,
            RestoreCrashPoint::AfterStoreActivation,
        ] {
            let source_dir = TempDir::new().unwrap();
            let destination_dir = TempDir::new().unwrap();
            let restore_dir = TempDir::new().unwrap();
            let (identity, owner) = owner_identity();
            let root = ContinuityMasterKey::new_for_test([0x51; 32]);
            let mut source_store = open(source_dir.path());
            seed(&mut source_store, &root, &owner);
            let lifecycle = ContinuityLifecycleLock::new_for_test();
            let path = destination_dir.path().join("crash.luca-backup.age");
            let exported = export_continuity_backup(
                &lifecycle,
                &mut source_store,
                &root,
                identity,
                owner.clone(),
                OpaqueId::parse("backup-crash-boundary").unwrap(),
                CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
                vec![mapping()],
                &path,
                passphrase(),
            )
            .unwrap();
            let mut restored = open(restore_dir.path());
            let keychain = FakeKeychain::default();
            keychain
                .store_raw(CONTINUITY_MASTER_KEY_NAME, &root.to_base64())
                .unwrap();
            owner_identity().0.owner_secret_nsec.with_exposed(|nsec| {
                keychain.store_raw(IDENTITY_KEY_NAME, nsec).unwrap();
            });
            let confirmation = ContinuityRestoreConfirmation {
                backup_id: exported.preview.backup_id,
                owner_pubkey: owner.clone(),
                ciphertext_sha256: exported.preview.ciphertext_sha256,
            };
            assert_eq!(
                restore_continuity_backup(
                    &lifecycle,
                    &mut restored,
                    &keychain,
                    &path,
                    passphrase(),
                    &confirmation,
                    restore_dir.path(),
                    &mut FailAt(Some(point)),
                ),
                Err(ContinuityBackupError::InjectedCrash(point))
            );
            if point == RestoreCrashPoint::AfterKeyInstall {
                let candidate = keychain
                    .load_raw(CONTINUITY_MASTER_KEY_NAME)
                    .unwrap()
                    .unwrap();
                keychain
                    .store_raw(CONTINUITY_MASTER_KEY_NAME, "corrupt-active-key")
                    .unwrap();
                assert_eq!(
                    recover_pending_restore(&lifecycle, &mut restored, &keychain),
                    Err(ContinuityBackupError::Integrity)
                );
                assert!(keychain.load_raw(RESTORE_STATE_KEY).unwrap().is_some());
                keychain
                    .store_raw(CONTINUITY_MASTER_KEY_NAME, &candidate)
                    .unwrap();
            }
            assert!(recover_pending_restore(&lifecycle, &mut restored, &keychain).unwrap());
            assert!(keychain.load_raw(RESTORE_STATE_KEY).unwrap().is_none());
            assert!(keychain
                .load_raw(CONTINUITY_MASTER_KEY_ROLLBACK_NAME)
                .unwrap()
                .is_none());
            assert!(keychain.load_raw(IDENTITY_ROLLBACK_KEY).unwrap().is_none());
            let count = restored
                .snapshot_owner_encrypted(&owner)
                .unwrap()
                .records
                .len();
            let mapping_count = restored.source_mappings_for_test(&owner).unwrap().len();
            if point == RestoreCrashPoint::AfterStoreActivation {
                assert_eq!(count, 1);
                assert_eq!(mapping_count, 1);
            } else {
                assert_eq!(count, 0);
                assert_eq!(mapping_count, 0);
            }
        }
    }

    #[test]
    fn committed_candidate_write_error_reconciles_old_and_absent_roots() {
        for old_root_present in [true, false] {
            let source_dir = TempDir::new().unwrap();
            let destination_dir = TempDir::new().unwrap();
            let restore_dir = TempDir::new().unwrap();
            let (identity, owner) = owner_identity();
            let root = ContinuityMasterKey::new_for_test([0x51; 32]);
            let mut source_store = open(source_dir.path());
            seed(&mut source_store, &root, &owner);
            let lifecycle = ContinuityLifecycleLock::new_for_test();
            let path = destination_dir.path().join(format!(
                "commit-ambiguous-{}.luca-backup.age",
                if old_root_present { "old" } else { "absent" }
            ));
            let exported = export_continuity_backup(
                &lifecycle,
                &mut source_store,
                &root,
                identity,
                owner.clone(),
                OpaqueId::parse(format!(
                    "backup-commit-ambiguous-{}",
                    if old_root_present { "old" } else { "absent" }
                ))
                .unwrap(),
                CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
                vec![mapping()],
                &path,
                passphrase(),
            )
            .unwrap();
            let confirmation = ContinuityRestoreConfirmation {
                backup_id: exported.preview.backup_id,
                owner_pubkey: owner.clone(),
                ciphertext_sha256: exported.preview.ciphertext_sha256,
            };
            let mut restored = open(restore_dir.path());
            let keychain = CommitThenErrorKeychain::default();
            if old_root_present {
                keychain
                    .store_raw(CONTINUITY_MASTER_KEY_NAME, &root.to_base64())
                    .unwrap();
                owner_identity().0.owner_secret_nsec.with_exposed(|nsec| {
                    keychain.store_raw(IDENTITY_KEY_NAME, nsec).unwrap();
                });
            }
            *keychain.commit_then_error_name.borrow_mut() =
                Some(CONTINUITY_MASTER_KEY_NAME.to_owned());

            assert_eq!(
                restore_continuity_backup(
                    &lifecycle,
                    &mut restored,
                    &keychain,
                    &path,
                    passphrase(),
                    &confirmation,
                    restore_dir.path(),
                    &mut NoRestoreCrash,
                ),
                Err(ContinuityBackupError::Keychain(
                    ContinuityKeyStoreError::Locked
                ))
            );

            assert!(keychain.load_raw(RESTORE_STATE_KEY).unwrap().is_none());
            assert!(keychain
                .load_raw(CONTINUITY_MASTER_KEY_ROLLBACK_NAME)
                .unwrap()
                .is_none());
            assert!(keychain.load_raw(IDENTITY_ROLLBACK_KEY).unwrap().is_none());
            assert_eq!(
                active_master_verifier(&keychain).unwrap(),
                old_root_present.then(|| hash_hex(root.as_bytes()).unwrap())
            );
            assert_eq!(
                active_identity_verifier(&keychain).unwrap(),
                old_root_present.then_some(owner)
            );
            assert!(restored
                .snapshot_owner_encrypted(&confirmation.owner_pubkey)
                .unwrap()
                .records
                .is_empty());
        }
    }

    #[test]
    fn corrupt_existing_identity_is_never_overwritten() {
        let source_dir = TempDir::new().unwrap();
        let destination_dir = TempDir::new().unwrap();
        let restore_dir = TempDir::new().unwrap();
        let (identity, owner) = owner_identity();
        let root = ContinuityMasterKey::new_for_test([0x51; 32]);
        let mut source_store = open(source_dir.path());
        seed(&mut source_store, &root, &owner);
        let lifecycle = ContinuityLifecycleLock::new_for_test();
        let path = destination_dir.path().join("identity.luca-backup.age");
        let exported = export_continuity_backup(
            &lifecycle,
            &mut source_store,
            &root,
            identity,
            owner.clone(),
            OpaqueId::parse("backup-corrupt-identity").unwrap(),
            CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
            vec![],
            &path,
            passphrase(),
        )
        .unwrap();
        let mut restored = open(restore_dir.path());
        let keychain = FakeKeychain::default();
        let prior = ContinuityMasterKey::new_for_test([0x22; 32]);
        keychain
            .store_raw(CONTINUITY_MASTER_KEY_NAME, &prior.to_base64())
            .unwrap();
        keychain
            .store_raw(IDENTITY_KEY_NAME, "corrupt-existing-identity")
            .unwrap();
        let confirmation = ContinuityRestoreConfirmation {
            backup_id: exported.preview.backup_id,
            owner_pubkey: owner,
            ciphertext_sha256: exported.preview.ciphertext_sha256,
        };
        assert_eq!(
            restore_continuity_backup(
                &lifecycle,
                &mut restored,
                &keychain,
                &path,
                passphrase(),
                &confirmation,
                restore_dir.path(),
                &mut NoRestoreCrash,
            ),
            Err(ContinuityBackupError::Integrity)
        );
        assert_eq!(
            keychain
                .load_raw(IDENTITY_KEY_NAME)
                .unwrap()
                .unwrap()
                .as_str(),
            "corrupt-existing-identity"
        );
        assert!(keychain.load_raw(RESTORE_STATE_KEY).unwrap().is_none());
    }

    #[test]
    fn ciphertext_flip_and_reencrypted_manifest_tamper_fail_closed() {
        let source_dir = TempDir::new().unwrap();
        let destination_dir = TempDir::new().unwrap();
        let (identity, owner) = owner_identity();
        let root = ContinuityMasterKey::new_for_test([0x51; 32]);
        let mut source_store = open(source_dir.path());
        seed(&mut source_store, &root, &owner);
        let snapshot = source_store.snapshot_owner_encrypted(&owner).unwrap();
        let mut archive = build_archive(
            snapshot,
            &root,
            identity,
            OpaqueId::parse("backup-tamper-ciphertext").unwrap(),
            CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
            vec![mapping()],
        )
        .unwrap();
        let replacement = if archive.records[0].ciphertext_b64.starts_with('A') {
            "B"
        } else {
            "A"
        };
        archive.records[0]
            .ciphertext_b64
            .replace_range(0..1, replacement);
        archive.manifest.encrypted_content_refs = record_refs(&archive.records).unwrap();
        archive.manifest.integrity_sha256 = calculate_integrity(
            &archive.manifest,
            &archive.owner_identity,
            archive.active_key_version,
            &root,
        )
        .unwrap();
        let tampered = canonicalize(&archive).unwrap();
        let path = destination_dir.path().join("ciphertext.luca-backup.age");
        fs::write(&path, encrypt_archive(&tampered, &passphrase()).unwrap()).unwrap();
        assert_eq!(
            preview_continuity_backup(&path, passphrase()),
            Err(ContinuityBackupError::Authentication)
        );

        let (identity, owner) = owner_identity();
        let snapshot = source_store.snapshot_owner_encrypted(&owner).unwrap();
        let mut archive = build_archive(
            snapshot,
            &root,
            identity,
            OpaqueId::parse("backup-tamper-manifest").unwrap(),
            CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
            vec![],
        )
        .unwrap();
        archive.manifest.created_at = CanonicalTimestamp::parse("2026-08-05T00:00:01Z").unwrap();
        let tampered = canonicalize(&archive).unwrap();
        let path = destination_dir.path().join("manifest.luca-backup.age");
        fs::write(&path, encrypt_archive(&tampered, &passphrase()).unwrap()).unwrap();
        assert_eq!(
            preview_continuity_backup(&path, passphrase()),
            Err(ContinuityBackupError::Integrity)
        );
    }

    #[test]
    fn restore_rejects_wrong_root_owner_and_existing_store_owner_before_journal() {
        let source_dir = TempDir::new().unwrap();
        let destination_dir = TempDir::new().unwrap();
        let (identity, owner) = owner_identity();
        let root = ContinuityMasterKey::new_for_test([0x51; 32]);
        let mut source_store = open(source_dir.path());
        seed(&mut source_store, &root, &owner);
        let path = destination_dir.path().join("authority.luca-backup.age");
        let exported = export_continuity_backup(
            &ContinuityLifecycleLock::new_for_test(),
            &mut source_store,
            &root,
            identity,
            owner.clone(),
            OpaqueId::parse("backup-authority-guard").unwrap(),
            CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
            vec![],
            &path,
            passphrase(),
        )
        .unwrap();
        let confirmation = ContinuityRestoreConfirmation {
            backup_id: exported.preview.backup_id,
            owner_pubkey: owner.clone(),
            ciphertext_sha256: exported.preview.ciphertext_sha256,
        };

        let wrong_root_dir = TempDir::new().unwrap();
        let mut wrong_root_store = open(wrong_root_dir.path());
        let wrong_root_keychain = FakeKeychain::default();
        wrong_root_keychain
            .store_raw(
                CONTINUITY_MASTER_KEY_NAME,
                &ContinuityMasterKey::new_for_test([0x22; 32]).to_base64(),
            )
            .unwrap();
        owner_identity().0.owner_secret_nsec.with_exposed(|nsec| {
            wrong_root_keychain
                .store_raw(IDENTITY_KEY_NAME, nsec)
                .unwrap();
        });
        assert_eq!(
            restore_continuity_backup(
                &ContinuityLifecycleLock::new_for_test(),
                &mut wrong_root_store,
                &wrong_root_keychain,
                &path,
                passphrase(),
                &confirmation,
                wrong_root_dir.path(),
                &mut NoRestoreCrash,
            ),
            Err(ContinuityBackupError::Integrity)
        );
        assert!(wrong_root_keychain
            .load_raw(RESTORE_STATE_KEY)
            .unwrap()
            .is_none());

        let wrong_owner_dir = TempDir::new().unwrap();
        let mut wrong_owner_store = open(wrong_owner_dir.path());
        seed(&mut wrong_owner_store, &root, &hex(0x77));
        let correct_keychain = FakeKeychain::default();
        correct_keychain
            .store_raw(CONTINUITY_MASTER_KEY_NAME, &root.to_base64())
            .unwrap();
        owner_identity().0.owner_secret_nsec.with_exposed(|nsec| {
            correct_keychain.store_raw(IDENTITY_KEY_NAME, nsec).unwrap();
        });
        assert_eq!(
            restore_continuity_backup(
                &ContinuityLifecycleLock::new_for_test(),
                &mut wrong_owner_store,
                &correct_keychain,
                &path,
                passphrase(),
                &confirmation,
                wrong_owner_dir.path(),
                &mut NoRestoreCrash,
            ),
            Err(ContinuityBackupError::Store(
                ContinuityStoreError::LifecycleConflict
            ))
        );
        assert!(correct_keychain
            .load_raw(RESTORE_STATE_KEY)
            .unwrap()
            .is_none());
    }

    #[test]
    fn partial_keychain_install_combinations_recover_to_verified_old_state() {
        for scenario in 0..3 {
            let source_dir = TempDir::new().unwrap();
            let destination_dir = TempDir::new().unwrap();
            let restore_dir = TempDir::new().unwrap();
            let (identity, owner) = owner_identity();
            let root = ContinuityMasterKey::new_for_test([0x51; 32]);
            let mut source_store = open(source_dir.path());
            seed(&mut source_store, &root, &owner);
            let path = destination_dir.path().join("partial.luca-backup.age");
            let exported = export_continuity_backup(
                &ContinuityLifecycleLock::new_for_test(),
                &mut source_store,
                &root,
                identity,
                owner.clone(),
                OpaqueId::parse(format!("backup-partial-{scenario}")).unwrap(),
                CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
                vec![],
                &path,
                passphrase(),
            )
            .unwrap();
            let confirmation = ContinuityRestoreConfirmation {
                backup_id: exported.preview.backup_id,
                owner_pubkey: owner,
                ciphertext_sha256: exported.preview.ciphertext_sha256,
            };
            let lifecycle = ContinuityLifecycleLock::new_for_test();
            let mut restored = open(restore_dir.path());
            let keychain = FakeKeychain::default();
            assert_eq!(
                restore_continuity_backup(
                    &lifecycle,
                    &mut restored,
                    &keychain,
                    &path,
                    passphrase(),
                    &confirmation,
                    restore_dir.path(),
                    &mut FailAt(Some(RestoreCrashPoint::AfterJournal)),
                ),
                Err(ContinuityBackupError::InjectedCrash(
                    RestoreCrashPoint::AfterJournal
                ))
            );
            match scenario {
                0 => keychain
                    .store_raw(IDENTITY_ROLLBACK_KEY, ABSENT_IDENTITY_MARKER)
                    .unwrap(),
                1 => keychain
                    .store_raw(CONTINUITY_MASTER_KEY_ROLLBACK_NAME, ABSENT_ROLLBACK_MARKER)
                    .unwrap(),
                _ => {
                    keychain
                        .store_raw(IDENTITY_ROLLBACK_KEY, ABSENT_IDENTITY_MARKER)
                        .unwrap();
                    owner_identity().0.owner_secret_nsec.with_exposed(|nsec| {
                        keychain.store_raw(IDENTITY_KEY_NAME, nsec).unwrap();
                    });
                    keychain
                        .store_raw(CONTINUITY_MASTER_KEY_ROLLBACK_NAME, ABSENT_ROLLBACK_MARKER)
                        .unwrap();
                }
            }
            assert!(recover_pending_restore(&lifecycle, &mut restored, &keychain).unwrap());
            assert!(keychain.0.borrow().is_empty());
        }
    }

    #[test]
    fn archive_structure_preflight_counts_exact_collections_and_shape() {
        let fixture = br#"{"manifest":{},"owner_identity":{},"active_key_version":1,"continuity_master_key_b64":"x","records":[{},{}],"mappings":[{}]}"#;
        assert_eq!(
            preflight_archive_structure(fixture),
            Ok(ArchiveStructurePreflight {
                record_count: 2,
                mapping_count: 1,
            })
        );
        assert_eq!(
            preflight_archive_structure(br#"{"records":[]}"#),
            Err(ContinuityBackupError::InvalidArchive)
        );
        assert_eq!(
            preflight_archive_structure(br#"{"records":[],"records":[]}"#),
            Err(ContinuityBackupError::InvalidArchive)
        );
    }

    #[test]
    fn archive_structure_preflight_rejects_each_over_cap_array_before_invalid_tail() {
        for (field, maximum) in [
            ("records", MAX_CONTINUITY_SNAPSHOT_RECORDS),
            ("mappings", MAX_SOURCE_MAPPINGS),
        ] {
            let mut fixture = format!("{{\"{field}\":[").into_bytes();
            for index in 0..=maximum {
                if index > 0 {
                    fixture.push(b',');
                }
                fixture.extend_from_slice(b"{}");
            }
            // The fixture intentionally has no closing array/object and is not
            // canonical JSON. BoundExceeded proves the streaming preflight
            // stopped on the collection cap before parsing/canonicalizing tail.
            fixture.extend_from_slice(b",definitely-not-json");
            assert_eq!(
                preflight_archive_structure(&fixture),
                Err(ContinuityBackupError::BoundExceeded),
                "{field} must fail on its collection bound"
            );
        }
    }
}
