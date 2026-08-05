//! Continuity master-key custody in the desktop OS keychain.
//!
//! This module intentionally has no filesystem or environment fallback. The
//! master key is process-local after acquisition and is never serialized.

use std::fmt;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rand::Rng;
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

use crate::{app_state::keyring_service, secret_store::SecretStore};

/// Internal entry in the existing single-blob desktop keychain store.
pub(crate) const CONTINUITY_MASTER_KEY_NAME: &str = "luca.continuity.master-key.v1";
pub(crate) const CONTINUITY_MASTER_KEY_ROLLBACK_NAME: &str =
    "luca.continuity.master-key.rollback.v1";
pub(super) const ABSENT_ROLLBACK_MARKER: &str = "luca.continuity.rollback.absent.v1";
const MASTER_KEY_BYTES: usize = 32;

/// The only keychain failures meaningful to the continuity lifecycle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ContinuityKeyStoreError {
    /// The keychain is reachable but is currently locked or access was denied.
    Locked,
    /// The keychain backend cannot be reached.
    Unavailable,
    /// Keychain data was invalid before it could be interpreted as a master key.
    Corrupt,
}

/// No-cache raw keychain operations needed for continuity custody.
///
/// Implementations must not migrate legacy entries or retain plaintext in a
/// process cache. The production implementation is deliberately limited to the
/// existing `SecretStore` raw zeroizing APIs.
pub(crate) trait ContinuityKeyStore {
    /// Read one raw value from the keychain blob.
    fn load_raw(&self, name: &str) -> Result<Option<Zeroizing<String>>, ContinuityKeyStoreError>;

    /// Store one raw value in the keychain blob without creating a plaintext cache.
    fn store_raw(&self, name: &str, value: &str) -> Result<(), ContinuityKeyStoreError>;

    /// Delete one raw value without creating a plaintext cache.
    fn delete_raw(&self, name: &str) -> Result<(), ContinuityKeyStoreError>;
}

fn classify_keychain_error(error: &str) -> ContinuityKeyStoreError {
    let error = error.to_ascii_lowercase();
    if error.contains("invalid") || error.contains("encoding") || error.contains("utf8") {
        ContinuityKeyStoreError::Corrupt
    } else if error.contains("unavailable")
        || error.contains("could not be opened")
        || error.contains("feature disabled")
    {
        ContinuityKeyStoreError::Unavailable
    } else if error.contains("locked")
        || error.contains("interaction not allowed")
        || error.contains("authorization")
        || error.contains("access denied")
        || error.contains("user canceled")
    {
        ContinuityKeyStoreError::Locked
    } else {
        // Raw SecretStore intentionally collapses backend read/write denials.
        // Those must never be treated as an absent, writable keychain entry.
        ContinuityKeyStoreError::Locked
    }
}

impl ContinuityKeyStore for SecretStore {
    fn load_raw(&self, name: &str) -> Result<Option<Zeroizing<String>>, ContinuityKeyStoreError> {
        self.load_raw_readonly(name)
            .map_err(|error| classify_keychain_error(&error))
    }

    fn store_raw(&self, name: &str, value: &str) -> Result<(), ContinuityKeyStoreError> {
        self.store_raw_zeroizing(name, value)
            .map_err(|error| classify_keychain_error(&error))
    }

    fn delete_raw(&self, name: &str) -> Result<(), ContinuityKeyStoreError> {
        self.delete_raw_zeroizing(name)
            .map_err(|error| classify_keychain_error(&error))
    }
}

/// Entropy source used only to create a first-run master key.
pub(crate) trait ContinuityEntropy {
    /// Fill exactly the caller-provided key buffer with cryptographic entropy.
    fn fill_master_key(&mut self, destination: &mut [u8; MASTER_KEY_BYTES]);
}

/// Operating-system CSPRNG used by desktop production code.
pub(crate) struct OsContinuityEntropy;

impl ContinuityEntropy for OsContinuityEntropy {
    fn fill_master_key(&mut self, destination: &mut [u8; MASTER_KEY_BYTES]) {
        rand::rng().fill_bytes(destination);
    }
}

/// Process-local master-key material. It cannot be formatted or serialized.
pub(crate) struct ContinuityMasterKey(Zeroizing<[u8; MASTER_KEY_BYTES]>);

impl ContinuityMasterKey {
    pub(super) fn from_base64(encoded: &str) -> Option<Self> {
        let decoded = Zeroizing::new(BASE64_STANDARD.decode(encoded).ok()?);
        let canonical = Zeroizing::new(BASE64_STANDARD.encode(&decoded));
        if !bool::from(canonical.as_bytes().ct_eq(encoded.as_bytes())) {
            return None;
        }
        if decoded.len() != MASTER_KEY_BYTES {
            return None;
        }
        let mut bytes = Zeroizing::new([0_u8; MASTER_KEY_BYTES]);
        bytes.copy_from_slice(&decoded);
        Some(Self(bytes))
    }

    pub(super) fn from_zeroizing(bytes: Zeroizing<[u8; MASTER_KEY_BYTES]>) -> Self {
        Self(bytes)
    }

    /// Borrow key material only inside trusted desktop custody/crypto code.
    pub(super) fn as_bytes(&self) -> &[u8; MASTER_KEY_BYTES] {
        &self.0
    }

    pub(super) fn to_base64(&self) -> Zeroizing<String> {
        Zeroizing::new(BASE64_STANDARD.encode(self.as_bytes()))
    }

    #[cfg(test)]
    pub(super) fn new_for_test(bytes: [u8; MASTER_KEY_BYTES]) -> Self {
        Self(Zeroizing::new(bytes))
    }
}

impl fmt::Debug for ContinuityMasterKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ContinuityMasterKey([REDACTED])")
    }
}

/// Body-free master-key lifecycle state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ContinuityKeyCustodyStatus {
    Ready,
    Locked,
    Unavailable,
    Corrupt,
}

/// Body-free, renderer-safe key-custody diagnostic.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ContinuityKeyCustodyDiagnostic {
    pub(crate) status: ContinuityKeyCustodyStatus,
}

/// Result of attempting to acquire the continuity master key.
pub(crate) enum ContinuityMasterKeyState {
    Ready(ContinuityMasterKey),
    Locked,
    Unavailable,
    /// Invalid extant key material or an unverifiable write. No replacement is made.
    Corrupt,
}

impl ContinuityMasterKeyState {
    /// Return a body-free diagnostic suitable for state reporting.
    pub(crate) fn diagnostic(&self) -> ContinuityKeyCustodyDiagnostic {
        let status = match self {
            Self::Ready(_) => ContinuityKeyCustodyStatus::Ready,
            Self::Locked => ContinuityKeyCustodyStatus::Locked,
            Self::Unavailable => ContinuityKeyCustodyStatus::Unavailable,
            Self::Corrupt => ContinuityKeyCustodyStatus::Corrupt,
        };
        ContinuityKeyCustodyDiagnostic { status }
    }
}

impl fmt::Debug for ContinuityMasterKeyState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Ready(_) => formatter.write_str("ContinuityMasterKeyState::Ready([REDACTED])"),
            Self::Locked => formatter.write_str("ContinuityMasterKeyState::Locked"),
            Self::Unavailable => formatter.write_str("ContinuityMasterKeyState::Unavailable"),
            Self::Corrupt => formatter.write_str("ContinuityMasterKeyState::Corrupt"),
        }
    }
}

fn failed_store(error: ContinuityKeyStoreError) -> ContinuityMasterKeyState {
    match error {
        ContinuityKeyStoreError::Locked => ContinuityMasterKeyState::Locked,
        ContinuityKeyStoreError::Unavailable => ContinuityMasterKeyState::Unavailable,
        ContinuityKeyStoreError::Corrupt => ContinuityMasterKeyState::Corrupt,
    }
}

/// Acquire the existing master key or atomically establish a verified new key.
///
/// Absence in a reachable keychain is the only condition that writes. Any
/// malformed existing value or failed raw read-back fails closed and never
/// overwrites the existing entry.
pub(crate) fn acquire_master_key<S: ContinuityKeyStore, E: ContinuityEntropy>(
    store: &S,
    entropy: &mut E,
) -> ContinuityMasterKeyState {
    match store.load_raw(CONTINUITY_MASTER_KEY_NAME) {
        Ok(Some(existing)) => ContinuityMasterKey::from_base64(&existing)
            .map(ContinuityMasterKeyState::Ready)
            .unwrap_or(ContinuityMasterKeyState::Corrupt),
        Err(error) => failed_store(error),
        Ok(None) => {
            let mut generated = Zeroizing::new([0_u8; MASTER_KEY_BYTES]);
            entropy.fill_master_key(&mut generated);
            let master_key = ContinuityMasterKey::from_zeroizing(generated);
            let encoded = Zeroizing::new(BASE64_STANDARD.encode(master_key.as_bytes()));
            if let Err(error) = store.store_raw(CONTINUITY_MASTER_KEY_NAME, &encoded) {
                return failed_store(error);
            }
            let read_back = match store.load_raw(CONTINUITY_MASTER_KEY_NAME) {
                Ok(Some(value)) => value,
                Ok(None) => return ContinuityMasterKeyState::Corrupt,
                Err(error) => return failed_store(error),
            };
            let Some(read_back_key) = ContinuityMasterKey::from_base64(&read_back) else {
                return ContinuityMasterKeyState::Corrupt;
            };
            if master_key.as_bytes().ct_eq(read_back_key.as_bytes()).into() {
                ContinuityMasterKeyState::Ready(master_key)
            } else {
                ContinuityMasterKeyState::Corrupt
            }
        }
    }
}

/// Load an existing key without ever minting a replacement.
pub(crate) fn load_existing_master_key<S: ContinuityKeyStore>(
    store: &S,
) -> ContinuityMasterKeyState {
    match store.load_raw(CONTINUITY_MASTER_KEY_NAME) {
        Ok(Some(existing)) => ContinuityMasterKey::from_base64(&existing)
            .map(ContinuityMasterKeyState::Ready)
            .unwrap_or(ContinuityMasterKeyState::Corrupt),
        Ok(None) => ContinuityMasterKeyState::Unavailable,
        Err(error) => failed_store(error),
    }
}

fn verify_exact_slot<S: ContinuityKeyStore>(
    store: &S,
    name: &str,
    expected: &str,
) -> Result<(), ContinuityKeyStoreError> {
    let actual = store
        .load_raw(name)?
        .ok_or(ContinuityKeyStoreError::Corrupt)?;
    if bool::from(actual.as_bytes().ct_eq(expected.as_bytes())) {
        Ok(())
    } else {
        Err(ContinuityKeyStoreError::Corrupt)
    }
}

/// Install a confirmed restore candidate while retaining the prior active key
/// only in a separately named keychain rollback slot.
pub(crate) fn install_candidate_master_key<S: ContinuityKeyStore>(
    store: &S,
    candidate: &ContinuityMasterKey,
) -> Result<(), ContinuityKeyStoreError> {
    if store
        .load_raw(CONTINUITY_MASTER_KEY_ROLLBACK_NAME)?
        .is_some()
    {
        return Err(ContinuityKeyStoreError::Corrupt);
    }
    let prior = store.load_raw(CONTINUITY_MASTER_KEY_NAME)?;
    if prior
        .as_ref()
        .is_some_and(|encoded| ContinuityMasterKey::from_base64(encoded).is_none())
    {
        return Err(ContinuityKeyStoreError::Corrupt);
    }
    let rollback = prior
        .as_ref()
        .map(|value| value.as_str())
        .unwrap_or(ABSENT_ROLLBACK_MARKER);
    store.store_raw(CONTINUITY_MASTER_KEY_ROLLBACK_NAME, rollback)?;
    if let Err(error) = verify_exact_slot(store, CONTINUITY_MASTER_KEY_ROLLBACK_NAME, rollback) {
        let _ = store.delete_raw(CONTINUITY_MASTER_KEY_ROLLBACK_NAME);
        return Err(error);
    }
    let encoded = candidate.to_base64();
    if let Err(error) = store.store_raw(CONTINUITY_MASTER_KEY_NAME, &encoded) {
        // A SecretStore write error is commit-ambiguous: the keychain blob may
        // already contain the candidate even though the backend reported an
        // error. Keep the verified rollback slot so the restore journal can
        // read back active authority and deterministically reconcile old/new.
        return Err(error);
    }
    if let Err(error) = verify_exact_slot(store, CONTINUITY_MASTER_KEY_NAME, &encoded) {
        // Read-back failure is likewise not authority to discard rollback.
        // The outer restore journal owns reconciliation once a candidate write
        // has been attempted.
        return Err(error);
    }
    Ok(())
}

/// Restore the prior keychain state after a failed restore activation.
pub(crate) fn rollback_candidate_master_key<S: ContinuityKeyStore>(
    store: &S,
) -> Result<(), ContinuityKeyStoreError> {
    let rollback = store
        .load_raw(CONTINUITY_MASTER_KEY_ROLLBACK_NAME)?
        .ok_or(ContinuityKeyStoreError::Corrupt)?;
    if rollback.as_str() == ABSENT_ROLLBACK_MARKER {
        store.delete_raw(CONTINUITY_MASTER_KEY_NAME)?;
        if store.load_raw(CONTINUITY_MASTER_KEY_NAME)?.is_some() {
            return Err(ContinuityKeyStoreError::Corrupt);
        }
    } else {
        if ContinuityMasterKey::from_base64(&rollback).is_none() {
            return Err(ContinuityKeyStoreError::Corrupt);
        }
        store.store_raw(CONTINUITY_MASTER_KEY_NAME, &rollback)?;
        verify_exact_slot(store, CONTINUITY_MASTER_KEY_NAME, &rollback)?;
    }
    store.delete_raw(CONTINUITY_MASTER_KEY_ROLLBACK_NAME)?;
    Ok(())
}

/// Remove the rollback slot only after active-store verification succeeds.
pub(crate) fn finalize_candidate_master_key<S: ContinuityKeyStore>(
    store: &S,
) -> Result<(), ContinuityKeyStoreError> {
    store.delete_raw(CONTINUITY_MASTER_KEY_ROLLBACK_NAME)
}

/// Acquire using the existing desktop service (`buzz-desktop` in release and
/// the scoped `buzz-desktop-dev.*` service in debug builds).
pub(crate) fn acquire_desktop_master_key() -> ContinuityMasterKeyState {
    let store = SecretStore::keyring(keyring_service());
    acquire_master_key(&store, &mut OsContinuityEntropy)
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, collections::BTreeMap};

    use super::*;

    #[derive(Default)]
    struct FakeStore {
        values: RefCell<BTreeMap<String, String>>,
        load_error: RefCell<Option<ContinuityKeyStoreError>>,
        store_error: RefCell<Option<ContinuityKeyStoreError>>,
        read_error_at: RefCell<Option<(usize, ContinuityKeyStoreError)>>,
        reads: RefCell<usize>,
        writes: RefCell<usize>,
        substitute_after_write: RefCell<Option<String>>,
        commit_then_error: RefCell<Option<(String, ContinuityKeyStoreError)>>,
    }

    impl ContinuityKeyStore for FakeStore {
        fn load_raw(
            &self,
            name: &str,
        ) -> Result<Option<Zeroizing<String>>, ContinuityKeyStoreError> {
            *self.reads.borrow_mut() += 1;
            if self
                .read_error_at
                .borrow()
                .is_some_and(|(read, _)| read == *self.reads.borrow())
            {
                return Err(self.read_error_at.borrow().unwrap().1);
            }
            if let Some(error) = *self.load_error.borrow() {
                return Err(error);
            }
            Ok(self.values.borrow().get(name).cloned().map(Zeroizing::new))
        }

        fn store_raw(&self, name: &str, value: &str) -> Result<(), ContinuityKeyStoreError> {
            *self.writes.borrow_mut() += 1;
            if let Some(error) = *self.store_error.borrow() {
                return Err(error);
            }
            let value = self
                .substitute_after_write
                .borrow()
                .clone()
                .unwrap_or_else(|| value.to_owned());
            self.values.borrow_mut().insert(name.to_owned(), value);
            let committed_error = self
                .commit_then_error
                .borrow()
                .as_ref()
                .filter(|(target, _)| target == name)
                .map(|(_, error)| *error);
            if let Some(error) = committed_error {
                self.commit_then_error.borrow_mut().take();
                return Err(error);
            }
            Ok(())
        }

        fn delete_raw(&self, name: &str) -> Result<(), ContinuityKeyStoreError> {
            self.values.borrow_mut().remove(name);
            Ok(())
        }
    }

    struct FixedEntropy([u8; MASTER_KEY_BYTES]);

    impl ContinuityEntropy for FixedEntropy {
        fn fill_master_key(&mut self, destination: &mut [u8; MASTER_KEY_BYTES]) {
            *destination = self.0;
        }
    }

    fn encoded_key(byte: u8) -> String {
        BASE64_STANDARD.encode([byte; MASTER_KEY_BYTES])
    }

    fn status_for(error: ContinuityKeyStoreError) -> ContinuityKeyCustodyStatus {
        match error {
            ContinuityKeyStoreError::Locked => ContinuityKeyCustodyStatus::Locked,
            ContinuityKeyStoreError::Unavailable => ContinuityKeyCustodyStatus::Unavailable,
            ContinuityKeyStoreError::Corrupt => ContinuityKeyCustodyStatus::Corrupt,
        }
    }

    #[test]
    fn existing_valid_key_is_ready_without_writing() {
        let store = FakeStore::default();
        store
            .values
            .borrow_mut()
            .insert(CONTINUITY_MASTER_KEY_NAME.to_owned(), encoded_key(7));
        let state = acquire_master_key(&store, &mut FixedEntropy([8; MASTER_KEY_BYTES]));
        assert!(matches!(state, ContinuityMasterKeyState::Ready(_)));
        assert_eq!(*store.writes.borrow(), 0);
    }

    #[test]
    fn absent_reachable_keychain_generates_stores_and_raw_reads_back() {
        let store = FakeStore::default();
        let state = acquire_master_key(&store, &mut FixedEntropy([9; MASTER_KEY_BYTES]));
        let ContinuityMasterKeyState::Ready(key) = state else {
            panic!("missing key must be established");
        };
        assert_eq!(key.as_bytes(), &[9; MASTER_KEY_BYTES]);
        assert_eq!(*store.writes.borrow(), 1);
        assert_eq!(*store.reads.borrow(), 2);
        assert_eq!(
            store.values.borrow().get(CONTINUITY_MASTER_KEY_NAME),
            Some(&encoded_key(9))
        );
    }

    #[test]
    fn corrupt_existing_key_fails_closed_without_overwrite() {
        let store = FakeStore::default();
        store.values.borrow_mut().insert(
            CONTINUITY_MASTER_KEY_NAME.to_owned(),
            "not-a-32-byte-base64-key".to_owned(),
        );
        assert!(matches!(
            acquire_master_key(&store, &mut FixedEntropy([1; MASTER_KEY_BYTES])),
            ContinuityMasterKeyState::Corrupt
        ));
        assert_eq!(*store.writes.borrow(), 0);
    }

    #[test]
    fn readback_mismatch_fails_closed() {
        let store = FakeStore::default();
        *store.substitute_after_write.borrow_mut() = Some(encoded_key(2));
        assert!(matches!(
            acquire_master_key(&store, &mut FixedEntropy([1; MASTER_KEY_BYTES])),
            ContinuityMasterKeyState::Corrupt
        ));
        assert_eq!(*store.writes.borrow(), 1);
    }

    #[test]
    fn locked_and_unavailable_never_write() {
        for error in [
            ContinuityKeyStoreError::Locked,
            ContinuityKeyStoreError::Unavailable,
        ] {
            let store = FakeStore::default();
            *store.load_error.borrow_mut() = Some(error);
            let state = acquire_master_key(&store, &mut FixedEntropy([1; MASTER_KEY_BYTES]));
            assert_eq!(
                state.diagnostic().status,
                match error {
                    ContinuityKeyStoreError::Locked => ContinuityKeyCustodyStatus::Locked,
                    ContinuityKeyStoreError::Unavailable => ContinuityKeyCustodyStatus::Unavailable,
                    ContinuityKeyStoreError::Corrupt => ContinuityKeyCustodyStatus::Corrupt,
                }
            );
            assert_eq!(*store.writes.borrow(), 0);
        }
    }

    #[test]
    fn write_or_raw_readback_errors_never_substitute_a_key() {
        for error in [
            ContinuityKeyStoreError::Locked,
            ContinuityKeyStoreError::Unavailable,
        ] {
            let store = FakeStore::default();
            *store.store_error.borrow_mut() = Some(error);
            let state = acquire_master_key(&store, &mut FixedEntropy([1; MASTER_KEY_BYTES]));
            assert_eq!(state.diagnostic().status, status_for(error));
            assert_eq!(*store.writes.borrow(), 1);
            assert_eq!(*store.reads.borrow(), 1);

            let store = FakeStore::default();
            *store.read_error_at.borrow_mut() = Some((2, error));
            let state = acquire_master_key(&store, &mut FixedEntropy([1; MASTER_KEY_BYTES]));
            assert_eq!(state.diagnostic().status, status_for(error));
            assert_eq!(*store.writes.borrow(), 1);
            assert_eq!(*store.reads.borrow(), 2);
        }
    }

    #[test]
    fn debug_never_exposes_key_material() {
        let secret = encoded_key(42);
        let key = ContinuityMasterKey::from_base64(&secret).unwrap();
        assert!(!format!("{key:?}").contains(&secret));
        assert!(!format!("{:?}", ContinuityMasterKeyState::Ready(key)).contains(&secret));
    }

    #[test]
    fn candidate_install_is_verified_and_can_rollback_or_finalize() {
        let store = FakeStore::default();
        store
            .values
            .borrow_mut()
            .insert(CONTINUITY_MASTER_KEY_NAME.to_owned(), encoded_key(1));
        let candidate = ContinuityMasterKey::new_for_test([2; MASTER_KEY_BYTES]);
        install_candidate_master_key(&store, &candidate).unwrap();
        assert_eq!(
            store.values.borrow().get(CONTINUITY_MASTER_KEY_NAME),
            Some(&encoded_key(2))
        );
        assert_eq!(
            store
                .values
                .borrow()
                .get(CONTINUITY_MASTER_KEY_ROLLBACK_NAME),
            Some(&encoded_key(1))
        );
        rollback_candidate_master_key(&store).unwrap();
        assert_eq!(
            store.values.borrow().get(CONTINUITY_MASTER_KEY_NAME),
            Some(&encoded_key(1))
        );
        assert!(!store
            .values
            .borrow()
            .contains_key(CONTINUITY_MASTER_KEY_ROLLBACK_NAME));

        install_candidate_master_key(&store, &candidate).unwrap();
        finalize_candidate_master_key(&store).unwrap();
        assert_eq!(
            store.values.borrow().get(CONTINUITY_MASTER_KEY_NAME),
            Some(&encoded_key(2))
        );
        assert!(!store
            .values
            .borrow()
            .contains_key(CONTINUITY_MASTER_KEY_ROLLBACK_NAME));
    }

    #[test]
    fn fresh_keychain_candidate_rollback_restores_absence() {
        let store = FakeStore::default();
        let candidate = ContinuityMasterKey::new_for_test([3; MASTER_KEY_BYTES]);
        install_candidate_master_key(&store, &candidate).unwrap();
        rollback_candidate_master_key(&store).unwrap();
        assert!(store.values.borrow().is_empty());
    }

    #[test]
    fn commit_ambiguous_candidate_write_retains_verified_rollback_authority() {
        for prior in [Some(encoded_key(1)), None] {
            let store = FakeStore::default();
            if let Some(prior) = prior.as_ref() {
                store
                    .values
                    .borrow_mut()
                    .insert(CONTINUITY_MASTER_KEY_NAME.to_owned(), prior.clone());
            }
            *store.commit_then_error.borrow_mut() = Some((
                CONTINUITY_MASTER_KEY_NAME.to_owned(),
                ContinuityKeyStoreError::Locked,
            ));
            let candidate = ContinuityMasterKey::new_for_test([2; MASTER_KEY_BYTES]);

            assert_eq!(
                install_candidate_master_key(&store, &candidate),
                Err(ContinuityKeyStoreError::Locked)
            );
            assert_eq!(
                store.values.borrow().get(CONTINUITY_MASTER_KEY_NAME),
                Some(&encoded_key(2))
            );
            assert_eq!(
                store
                    .values
                    .borrow()
                    .get(CONTINUITY_MASTER_KEY_ROLLBACK_NAME)
                    .map(String::as_str),
                prior.as_deref().or(Some(ABSENT_ROLLBACK_MARKER))
            );

            rollback_candidate_master_key(&store).unwrap();
            assert_eq!(
                store.values.borrow().get(CONTINUITY_MASTER_KEY_NAME),
                prior.as_ref()
            );
            assert!(!store
                .values
                .borrow()
                .contains_key(CONTINUITY_MASTER_KEY_ROLLBACK_NAME));
        }
    }

    #[test]
    fn custody_module_has_no_environment_fallback() {
        let source = include_str!("continuity_key_custody.rs");
        assert!(!source.contains(&["std", "::env"].concat()));
        assert!(!source.contains(&["var", "_os("].concat()));
        assert!(!source.contains(&["var", "("].concat()));
    }
}
