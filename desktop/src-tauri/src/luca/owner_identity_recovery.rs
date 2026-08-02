//! Passphrase-protected owner backup and recovery authority.
//!
//! Plaintext owner secrets exist only in zeroizing buffers. Preview performs
//! file reads, bounded age decryption, and validation, but has no state or
//! Keychain handle and therefore cannot write anywhere.

use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::Ordering,
};

use age::{secrecy::SecretString, Decryptor, Encryptor};
use luca_protocol::{
    BundleId, CanonicalTimestamp, Hex64, OwnerIdentityBundleV1, SecretNsec,
    OWNER_IDENTITY_CANONICALIZATION, OWNER_IDENTITY_FORMAT, OWNER_IDENTITY_VERSION,
};
use nostr::{Keys, ToBech32};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tempfile::Builder as TempFileBuilder;
use zeroize::Zeroizing;

use crate::{app_state::AppState, secret_store::SecretStore};

const IDENTITY_KEY_NAME: &str = "identity";
const BACKUP_EXTENSION: &str = "luca-owner.age";
const MIN_PASSPHRASE_BYTES: usize = 12;
const MAX_PASSPHRASE_BYTES: usize = 1024;
const MAX_CIPHERTEXT_BYTES: usize = 1024 * 1024;
const MAX_PLAINTEXT_BYTES: usize = 256 * 1024;
const MAX_SCRYPT_WORK_FACTOR: u8 = 20;
const EXPORT_SCRYPT_WORK_FACTOR: u8 = 15;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OwnerBackupResult {
    pub bundle_id: String,
    pub exported_at: String,
    pub owner_pubkey: String,
    pub ciphertext_sha256: String,
    pub file_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OwnerRecoveryPreview {
    pub bundle_id: String,
    pub exported_at: String,
    pub owner_pubkey: String,
    pub ciphertext_sha256: String,
    pub source_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OwnerRecoveryResult {
    pub owner_pubkey: String,
    pub recovered: bool,
}

struct ValidatedBackup {
    preview: OwnerRecoveryPreview,
    keys: Keys,
}

fn public_error(message: &'static str) -> String {
    message.to_string()
}

fn validate_passphrase(passphrase: &str) -> Result<(), String> {
    if !(MIN_PASSPHRASE_BYTES..=MAX_PASSPHRASE_BYTES).contains(&passphrase.as_bytes().len()) {
        return Err(public_error(
            "passphrase must be between 12 and 1024 UTF-8 bytes",
        ));
    }
    Ok(())
}

fn validate_backup_path(path: &Path) -> Result<(), String> {
    if path.file_name().and_then(|name| name.to_str()).is_none()
        || !path
            .to_string_lossy()
            .to_ascii_lowercase()
            .ends_with(&format!(".{BACKUP_EXTENSION}"))
    {
        return Err(public_error(
            "backup must use the .luca-owner.age extension",
        ));
    }
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn read_bounded_ciphertext(path: &Path) -> Result<Vec<u8>, String> {
    validate_backup_path(path)?;
    let file = File::open(path).map_err(|_| public_error("backup file could not be opened"))?;
    let metadata = file
        .metadata()
        .map_err(|_| public_error("backup file could not be inspected"))?;
    if metadata.len() > MAX_CIPHERTEXT_BYTES as u64 {
        return Err(public_error("backup file exceeds the 1 MiB limit"));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((MAX_CIPHERTEXT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| public_error("backup file could not be read"))?;
    if bytes.len() > MAX_CIPHERTEXT_BYTES {
        return Err(public_error("backup file exceeds the 1 MiB limit"));
    }
    Ok(bytes)
}

fn encrypt_manifest(
    plaintext: &[u8],
    passphrase: &str,
    work_factor: u8,
) -> Result<Vec<u8>, String> {
    let mut recipient = age::scrypt::Recipient::new(SecretString::from(passphrase.to_owned()));
    recipient.set_work_factor(work_factor);
    let encryptor = Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))
        .map_err(|_| public_error("protected backup encryption failed"))?;
    let mut ciphertext = Vec::new();
    let mut writer = encryptor
        .wrap_output(&mut ciphertext)
        .map_err(|_| public_error("protected backup encryption failed"))?;
    writer
        .write_all(plaintext)
        .map_err(|_| public_error("protected backup encryption failed"))?;
    writer
        .finish()
        .map_err(|_| public_error("protected backup encryption failed"))?;
    if ciphertext.len() > MAX_CIPHERTEXT_BYTES {
        return Err(public_error("protected backup exceeds the 1 MiB limit"));
    }
    Ok(ciphertext)
}

fn decrypt_and_validate(
    ciphertext: &[u8],
    passphrase: &str,
    source_path: &str,
) -> Result<ValidatedBackup, String> {
    if ciphertext.len() > MAX_CIPHERTEXT_BYTES {
        return Err(public_error("backup file exceeds the 1 MiB limit"));
    }
    validate_passphrase(passphrase)?;
    let decryptor = Decryptor::new_buffered(ciphertext)
        .map_err(|_| public_error("backup is not a valid age file"))?;
    if !decryptor.is_scrypt() {
        return Err(public_error("backup must use one age scrypt recipient"));
    }
    let mut identity = age::scrypt::Identity::new(SecretString::from(passphrase.to_owned()));
    identity.set_max_work_factor(MAX_SCRYPT_WORK_FACTOR);
    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|_| public_error("backup could not be decrypted"))?;
    let mut plaintext = Zeroizing::new(Vec::new());
    reader
        .by_ref()
        .take((MAX_PLAINTEXT_BYTES + 1) as u64)
        .read_to_end(&mut plaintext)
        .map_err(|_| public_error("backup could not be decrypted"))?;
    if plaintext.len() > MAX_PLAINTEXT_BYTES {
        return Err(public_error("backup plaintext exceeds the 256 KiB limit"));
    }

    let canonical = Zeroizing::new(
        luca_protocol::parse_and_canonicalize_strict(&plaintext, MAX_PLAINTEXT_BYTES)
            .map_err(|_| public_error("backup manifest is not strict canonical JSON"))?,
    );
    if canonical.as_slice() != plaintext.as_slice() {
        return Err(public_error("backup manifest is not strict canonical JSON"));
    }
    let bundle: OwnerIdentityBundleV1 = serde_json::from_slice(&plaintext)
        .map_err(|_| public_error("backup manifest is invalid"))?;
    let keys = bundle
        .owner_secret_nsec
        .with_exposed(Keys::parse)
        .map_err(|_| public_error("backup owner secret is invalid"))?;
    let owner_pubkey = keys.public_key().to_hex();
    if owner_pubkey != bundle.owner_pubkey.as_str() {
        return Err(public_error(
            "backup secret does not match its owner public key",
        ));
    }
    Ok(ValidatedBackup {
        preview: OwnerRecoveryPreview {
            bundle_id: bundle.bundle_id.as_str().to_owned(),
            exported_at: bundle.exported_at.as_str().to_owned(),
            owner_pubkey,
            ciphertext_sha256: sha256_hex(ciphertext),
            source_path: source_path.to_owned(),
        },
        keys,
    })
}

fn build_manifest(keys: &Keys) -> Result<OwnerIdentityBundleV1, String> {
    let encoded = Zeroizing::new(
        keys.secret_key()
            .to_bech32()
            .map_err(|_| public_error("owner identity could not be encoded"))?,
    );
    let mut bundle = OwnerIdentityBundleV1 {
        format: OWNER_IDENTITY_FORMAT.to_owned(),
        version: OWNER_IDENTITY_VERSION,
        canonicalization: OWNER_IDENTITY_CANONICALIZATION.to_owned(),
        bundle_id: BundleId::parse(uuid::Uuid::new_v4().to_string())
            .map_err(|_| public_error("backup manifest could not be created"))?,
        exported_at: CanonicalTimestamp::parse(
            chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        )
        .map_err(|_| public_error("backup manifest could not be created"))?,
        owner_pubkey: Hex64::parse(keys.public_key().to_hex())
            .map_err(|_| public_error("backup manifest could not be created"))?,
        owner_secret_nsec: SecretNsec::new(encoded.as_str().to_owned())
            .map_err(|_| public_error("backup manifest could not be created"))?,
        manifest_sha256: Hex64::parse("0".repeat(64))
            .map_err(|_| public_error("backup manifest could not be created"))?,
    };
    bundle.manifest_sha256 = bundle
        .calculate_manifest_sha256()
        .map_err(|_| public_error("backup manifest could not be created"))?;
    Ok(bundle)
}

fn atomic_write_backup(destination: &Path, ciphertext: &[u8]) -> Result<(), String> {
    let parent = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| public_error("backup destination is invalid"))?;
    if !parent.is_dir() {
        return Err(public_error("backup destination folder does not exist"));
    }
    let mut temporary = TempFileBuilder::new()
        .prefix(".luca-owner-")
        .tempfile_in(parent)
        .map_err(|_| public_error("backup temporary file could not be created"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temporary
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| public_error("backup permissions could not be secured"))?;
    }
    temporary
        .write_all(ciphertext)
        .and_then(|_| temporary.flush())
        .map_err(|_| public_error("backup file could not be written"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| public_error("backup file could not be synchronized"))?;
    temporary
        .persist_noclobber(destination)
        .map_err(|_| public_error("backup destination already exists or is unavailable"))?;
    OpenOptions::new()
        .read(true)
        .open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| public_error("backup destination could not be synchronized"))?;
    Ok(())
}

pub(crate) fn export_protected_owner_backup(
    state: &AppState,
    destination: PathBuf,
    passphrase: Zeroizing<String>,
    shared_identity: bool,
) -> Result<OwnerBackupResult, String> {
    if shared_identity {
        return Err(public_error("shared identities cannot be exported"));
    }
    validate_passphrase(&passphrase)?;
    validate_backup_path(&destination)?;
    let keys = state.signing_keys()?;
    let bundle = build_manifest(&keys)?;
    let plaintext = bundle
        .to_canonical_secret_bytes()
        .map_err(|_| public_error("backup manifest could not be created"))?;
    let ciphertext = encrypt_manifest(&plaintext, &passphrase, EXPORT_SCRYPT_WORK_FACTOR)?;
    atomic_write_backup(&destination, &ciphertext)?;

    // Treat export as successful only after reading the exact finalized file
    // back through the same bounded decrypt/validation path.
    let finalized = read_bounded_ciphertext(&destination)?;
    let validated = decrypt_and_validate(&finalized, &passphrase, "")?;
    if validated.preview.owner_pubkey != keys.public_key().to_hex() {
        return Err(public_error("backup read-back owner verification failed"));
    }
    Ok(OwnerBackupResult {
        bundle_id: validated.preview.bundle_id,
        exported_at: validated.preview.exported_at,
        owner_pubkey: validated.preview.owner_pubkey,
        ciphertext_sha256: validated.preview.ciphertext_sha256,
        file_name: destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("owner.luca-owner.age")
            .to_owned(),
    })
}

pub(crate) fn preview_protected_owner_backup(
    source: PathBuf,
    passphrase: Zeroizing<String>,
    shared_identity: bool,
) -> Result<OwnerRecoveryPreview, String> {
    if shared_identity {
        return Err(public_error("shared identities cannot be imported"));
    }
    let ciphertext = read_bounded_ciphertext(&source)?;
    let source_path = source.to_string_lossy();
    Ok(decrypt_and_validate(&ciphertext, &passphrase, &source_path)?.preview)
}

trait RecoveryKeyStore {
    fn load_raw(&self, key: &str) -> Result<Option<String>, String>;
    fn store(&self, key: &str, value: &str) -> Result<(), String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}

impl RecoveryKeyStore for SecretStore {
    fn load_raw(&self, key: &str) -> Result<Option<String>, String> {
        self.load_raw_readonly(key)
    }

    fn store(&self, key: &str, value: &str) -> Result<(), String> {
        self.store(key, value)
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        self.delete(key)
    }
}

fn rollback_keychain(store: &dyn RecoveryKeyStore, prior: Option<&str>) -> Result<(), String> {
    match prior {
        Some(value) => store.store(IDENTITY_KEY_NAME, value),
        None => store.delete(IDENTITY_KEY_NAME),
    }
}

fn persist_verified_keychain(store: &dyn RecoveryKeyStore, keys: &Keys) -> Result<(), String> {
    let prior = store
        .load_raw(IDENTITY_KEY_NAME)
        .map_err(|_| public_error("system keychain could not be read"))?
        .map(Zeroizing::new);
    let encoded = Zeroizing::new(
        keys.secret_key()
            .to_bech32()
            .map_err(|_| public_error("owner identity could not be encoded"))?,
    );
    store
        .store(IDENTITY_KEY_NAME, &encoded)
        .map_err(|_| public_error("owner identity could not be written to system keychain"))?;

    let verification = store
        .load_raw(IDENTITY_KEY_NAME)
        .map_err(|_| public_error("system keychain read-back failed"))?
        .map(Zeroizing::new)
        .ok_or_else(|| public_error("system keychain read-back failed"))
        .and_then(|readback| {
            let parsed = Keys::parse(readback.as_str())
                .map_err(|_| public_error("system keychain read-back is invalid"))?;
            if parsed.public_key() != keys.public_key() {
                return Err(public_error("system keychain read-back owner mismatch"));
            }
            Ok(())
        });
    if let Err(error) = verification {
        let prior_value = prior.as_deref().map(String::as_str);
        rollback_keychain(store, prior_value).map_err(|_| {
            public_error("system keychain verification failed and rollback could not be verified")
        })?;
        let restored = store
            .load_raw(IDENTITY_KEY_NAME)
            .map_err(|_| public_error("system keychain rollback could not be verified"))?
            .map(Zeroizing::new);
        if restored.as_deref().map(String::as_str) != prior_value {
            return Err(public_error(
                "system keychain rollback could not be verified",
            ));
        }
        return Err(error);
    }
    Ok(())
}

fn validate_recovery_confirmation(
    identity_lost: bool,
    keyring_locked: bool,
    expected_ciphertext_sha256: &str,
    confirmed_owner_pubkey: &str,
    actual_ciphertext_sha256: &str,
    actual_owner_pubkey: &str,
) -> Result<(), String> {
    if !identity_lost && !keyring_locked {
        return Err(public_error(
            "identity recovery is only available while identity is lost or locked",
        ));
    }
    if Hex64::parse(expected_ciphertext_sha256.to_owned()).is_err()
        || Hex64::parse(confirmed_owner_pubkey.to_owned()).is_err()
    {
        return Err(public_error("recovery confirmation is invalid"));
    }
    if actual_ciphertext_sha256 != expected_ciphertext_sha256 {
        return Err(public_error("backup changed after preview"));
    }
    if actual_owner_pubkey != confirmed_owner_pubkey {
        return Err(public_error(
            "confirmed owner public key does not match the backup",
        ));
    }
    Ok(())
}

pub(crate) fn confirm_protected_owner_recovery(
    state: &AppState,
    source: PathBuf,
    passphrase: Zeroizing<String>,
    expected_ciphertext_sha256: String,
    confirmed_owner_pubkey: String,
    shared_identity: bool,
) -> Result<OwnerRecoveryResult, String> {
    if shared_identity {
        return Err(public_error("shared identities cannot be imported"));
    }
    let _mutation_guard = state
        .identity_mutation
        .lock()
        .map_err(|_| public_error("identity recovery is unavailable"))?;
    let identity_lost = state.identity_lost.load(Ordering::Acquire);
    let keyring_locked = state.keyring_locked.load(Ordering::Acquire);
    if !identity_lost && !keyring_locked {
        return Err(public_error(
            "identity recovery is only available while identity is lost or locked",
        ));
    }

    // Confirmation deliberately re-reads and re-decrypts the exact file.
    let ciphertext = read_bounded_ciphertext(&source)?;
    let digest = sha256_hex(&ciphertext);
    let validated = decrypt_and_validate(&ciphertext, &passphrase, "")?;
    validate_recovery_confirmation(
        identity_lost,
        keyring_locked,
        &expected_ciphertext_sha256,
        &confirmed_owner_pubkey,
        &digest,
        &validated.preview.owner_pubkey,
    )?;

    // Acquire the activation guard before the Keychain write so a poisoned
    // AppState lock can never leave Keychain changed while memory stays stale.
    // The guard is not mutated until persistence and read-back both succeed.
    let mut active_keys = state
        .keys
        .lock()
        .map_err(|_| public_error("recovered identity could not be activated"))?;
    let store = SecretStore::shared(crate::app_state::keyring_service());
    persist_verified_keychain(store, &validated.keys)?;

    let owner_pubkey = validated.keys.public_key().to_hex();
    *active_keys = validated.keys;
    state.identity_lost.store(false, Ordering::Release);
    state.keyring_locked.store(false, Ordering::Release);
    Ok(OwnerRecoveryResult {
        owner_pubkey,
        recovered: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn test_passphrase() -> &'static str {
        "correct horse battery staple"
    }

    fn test_ciphertext(keys: &Keys) -> Vec<u8> {
        let bundle = build_manifest(keys).unwrap();
        let plaintext = bundle.to_canonical_secret_bytes().unwrap();
        encrypt_manifest(&plaintext, test_passphrase(), 2).unwrap()
    }

    fn encrypt_test_plaintext(plaintext: &[u8]) -> Vec<u8> {
        encrypt_manifest(plaintext, test_passphrase(), 2).unwrap()
    }

    #[test]
    fn owner_identity_recovery_round_trip_and_wrong_passphrase() {
        let keys = Keys::generate();
        let ciphertext = test_ciphertext(&keys);
        let decoded = decrypt_and_validate(&ciphertext, test_passphrase(), "").unwrap();
        assert_eq!(decoded.keys.public_key(), keys.public_key());
        assert!(decrypt_and_validate(&ciphertext, "this is wrong passphrase", "").is_err());
    }

    #[test]
    fn owner_identity_recovery_rejects_tamper_non_scrypt_and_oversize() {
        let keys = Keys::generate();
        let mut tampered = test_ciphertext(&keys);
        let last = tampered.len() - 1;
        tampered[last] ^= 1;
        assert!(decrypt_and_validate(&tampered, test_passphrase(), "").is_err());

        let recipient = age::x25519::Identity::generate().to_public();
        let encryptor =
            Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient)).unwrap();
        let mut non_scrypt = Vec::new();
        let mut writer = encryptor.wrap_output(&mut non_scrypt).unwrap();
        writer.write_all(b"{}").unwrap();
        writer.finish().unwrap();
        assert!(decrypt_and_validate(&non_scrypt, test_passphrase(), "").is_err());
        assert!(
            decrypt_and_validate(&vec![0; MAX_CIPHERTEXT_BYTES + 1], test_passphrase(), "")
                .is_err()
        );
    }

    #[test]
    fn owner_identity_recovery_rejects_excessive_scrypt_work_factor() {
        let mut ciphertext = test_ciphertext(&Keys::generate());
        let position = ciphertext
            .windows(3)
            .position(|window| window == b" 2\n")
            .expect("age scrypt work factor");
        ciphertext.insert(position + 2, b'1');
        assert!(decrypt_and_validate(&ciphertext, test_passphrase(), "").is_err());
    }

    #[test]
    fn owner_identity_recovery_rejects_duplicate_and_noncanonical_json() {
        let bundle = build_manifest(&Keys::generate()).unwrap();
        let canonical = bundle.to_canonical_secret_bytes().unwrap();
        let canonical_text = Zeroizing::new(String::from_utf8(canonical.to_vec()).unwrap());
        let duplicate = Zeroizing::new(format!(
            "{{\"format\":\"duplicate\",{}",
            &canonical_text[1..]
        ));
        assert!(decrypt_and_validate(
            &encrypt_test_plaintext(duplicate.as_bytes()),
            test_passphrase(),
            ""
        )
        .is_err());

        let value: serde_json::Value = serde_json::from_slice(&canonical).unwrap();
        let pretty = Zeroizing::new(serde_json::to_vec_pretty(&value).unwrap());
        assert!(
            decrypt_and_validate(&encrypt_test_plaintext(&pretty), test_passphrase(), "").is_err()
        );
    }

    #[test]
    fn owner_identity_recovery_rejects_manifest_and_owner_mismatch() {
        let keys = Keys::generate();
        let bundle = build_manifest(&keys).unwrap();
        let canonical = bundle.to_canonical_secret_bytes().unwrap();
        let mut value: serde_json::Value = serde_json::from_slice(&canonical).unwrap();
        value["manifest_sha256"] = serde_json::Value::String("0".repeat(64));
        let bad_manifest = Zeroizing::new(luca_protocol::canonicalize(&value).unwrap());
        assert!(decrypt_and_validate(
            &encrypt_test_plaintext(&bad_manifest),
            test_passphrase(),
            ""
        )
        .is_err());

        let encoded = Zeroizing::new(keys.secret_key().to_bech32().unwrap());
        let mut mismatch = OwnerIdentityBundleV1 {
            format: OWNER_IDENTITY_FORMAT.to_owned(),
            version: OWNER_IDENTITY_VERSION,
            canonicalization: OWNER_IDENTITY_CANONICALIZATION.to_owned(),
            bundle_id: BundleId::parse(uuid::Uuid::new_v4().to_string()).unwrap(),
            exported_at: CanonicalTimestamp::parse(
                chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            )
            .unwrap(),
            owner_pubkey: Hex64::parse(Keys::generate().public_key().to_hex()).unwrap(),
            owner_secret_nsec: SecretNsec::new(encoded.as_str().to_owned()).unwrap(),
            manifest_sha256: Hex64::parse("0".repeat(64)).unwrap(),
        };
        mismatch.manifest_sha256 = mismatch.calculate_manifest_sha256().unwrap();
        let mismatch_plaintext = mismatch.to_canonical_secret_bytes().unwrap();
        assert!(decrypt_and_validate(
            &encrypt_test_plaintext(&mismatch_plaintext),
            test_passphrase(),
            ""
        )
        .is_err());
    }

    #[test]
    fn owner_identity_recovery_rejects_oversize_plaintext_and_passphrases() {
        let plaintext = Zeroizing::new(vec![b'x'; MAX_PLAINTEXT_BYTES + 1]);
        assert!(
            decrypt_and_validate(&encrypt_test_plaintext(&plaintext), test_passphrase(), "")
                .is_err()
        );
        assert!(validate_passphrase("too short").is_err());
        assert!(validate_passphrase(&"x".repeat(MAX_PASSPHRASE_BYTES + 1)).is_err());
    }

    #[test]
    fn owner_identity_recovery_preview_is_zero_write() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("owner.luca-owner.age");
        let ciphertext = test_ciphertext(&Keys::generate());
        fs::write(&path, &ciphertext).unwrap();
        let before_entries = fs::read_dir(directory.path()).unwrap().count();
        let before = fs::read(&path).unwrap();
        let preview = preview_protected_owner_backup(
            path.clone(),
            Zeroizing::new(test_passphrase().to_owned()),
            false,
        )
        .unwrap();
        assert_eq!(preview.source_path, path.to_string_lossy());
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(
            fs::read_dir(directory.path()).unwrap().count(),
            before_entries
        );
        assert!(preview_protected_owner_backup(
            path.with_file_name("missing.luca-owner.age"),
            Zeroizing::new(test_passphrase().to_owned()),
            true,
        )
        .is_err());
    }

    #[test]
    fn owner_identity_recovery_confirmation_rejects_healthy_and_mismatch() {
        let digest = "a".repeat(64);
        let pubkey = "b".repeat(64);
        assert!(
            validate_recovery_confirmation(false, false, &digest, &pubkey, &digest, &pubkey)
                .is_err()
        );
        assert!(validate_recovery_confirmation(
            true,
            false,
            &digest,
            &pubkey,
            &"c".repeat(64),
            &pubkey
        )
        .is_err());
        assert!(validate_recovery_confirmation(
            false,
            true,
            &digest,
            &pubkey,
            &digest,
            &"d".repeat(64)
        )
        .is_err());
    }

    #[derive(Default)]
    struct FakeStore {
        value: Mutex<Option<String>>,
        corrupt_readback: Mutex<bool>,
        writes: Mutex<usize>,
    }

    impl RecoveryKeyStore for FakeStore {
        fn load_raw(&self, _key: &str) -> Result<Option<String>, String> {
            let value = self.value.lock().unwrap().clone();
            if *self.corrupt_readback.lock().unwrap()
                && *self.writes.lock().unwrap() > 0
                && value.is_some()
            {
                Ok(Some("not-an-nsec".to_string()))
            } else {
                Ok(value)
            }
        }

        fn store(&self, _key: &str, value: &str) -> Result<(), String> {
            *self.writes.lock().unwrap() += 1;
            *self.value.lock().unwrap() = Some(value.to_owned());
            Ok(())
        }

        fn delete(&self, _key: &str) -> Result<(), String> {
            *self.value.lock().unwrap() = None;
            Ok(())
        }
    }

    #[test]
    fn owner_identity_recovery_keychain_readback_and_rollback() {
        let keys = Keys::generate();
        let store = FakeStore::default();
        persist_verified_keychain(&store, &keys).unwrap();
        assert_eq!(
            Keys::parse(store.value.lock().unwrap().as_deref().unwrap())
                .unwrap()
                .public_key(),
            keys.public_key()
        );

        let prior = Keys::generate().secret_key().to_bech32().unwrap();
        *store.value.lock().unwrap() = Some(prior.clone());
        *store.writes.lock().unwrap() = 0;
        *store.corrupt_readback.lock().unwrap() = true;
        assert!(persist_verified_keychain(&store, &keys).is_err());
        // Disable corruption to inspect the actual restored value.
        *store.corrupt_readback.lock().unwrap() = false;
        assert_eq!(store.value.lock().unwrap().as_deref(), Some(prior.as_str()));
    }

    #[cfg(all(target_os = "macos", feature = "system-keyring"))]
    #[test]
    fn owner_identity_recovery_unique_macos_keychain_fixture_cleans_up() {
        let service = format!("com.luca.owner-recovery-test.{}", uuid::Uuid::new_v4());
        let store = SecretStore::shared(Box::leak(service.into_boxed_str()));
        let result = persist_verified_keychain(store, &Keys::generate());
        let cleanup = store.delete(IDENTITY_KEY_NAME);
        result.expect("unique Keychain recovery fixture");
        cleanup.expect("unique Keychain fixture cleanup");
        assert!(store
            .load_raw_readonly(IDENTITY_KEY_NAME)
            .unwrap()
            .is_none());
    }
}
