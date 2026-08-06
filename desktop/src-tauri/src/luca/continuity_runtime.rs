//! Process-owned continuity runtime and immutable retrieval leases.
//!
//! This module is the only desktop path that combines lifecycle authority,
//! existing key custody, the encrypted SQLite store, authenticated decryption,
//! and the process-memory retrieval kernel. It never formats a provider prompt
//! and never returns an arbitrary plaintext container.

use std::{fmt, path::Path, sync::Mutex, time::Instant};

use luca_continuity::{
    decrypt_record, InMemoryRetrievalIndex, NamespaceScope, RetrievalMaterialV1, RetrievalQuery,
    RetrievalRecord, RetrievalRecordState, RetrievalResult, RetrievalText,
};
use luca_protocol::{Hex64, SafeU53, Sha256Ref};

use crate::app_state::ContinuityLifecycleLock;

use super::{
    continuity_backup::{
        read_desktop_restore_status_existing_only, ContinuityBackupError, RestoreReadStatusV1,
    },
    continuity_key_custody::{
        acquire_desktop_master_key, load_existing_desktop_master_key, ContinuityKeyStoreError,
        ContinuityMasterKey, ContinuityMasterKeyState,
    },
    continuity_key_derivation::derive_namespace_key,
    continuity_revision_authority::RevisionAuthorityTokenV1,
    continuity_store::{
        ContinuityStore, ContinuityStoreDegradedReason, ContinuityStoreError, ContinuityStoreOpen,
    },
};

const MAX_LEASE_ATTEMPTS: u8 = 2;

/// Body-free reason the process-owned continuity runtime is unavailable.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ContinuityRuntimeDegradedReason {
    IdentityRecovery,
    RestorePending,
    RestoreInvalid,
    KeyLocked,
    KeyUnavailable,
    KeyCorrupt,
    StoreUnavailable,
    SchemaIncompatible,
    AuthorityMigrationRequired,
}

/// The one encrypted store opened for the resolved owner this process epoch.
pub(crate) struct ContinuityRuntime {
    owner_pubkey: Hex64,
    store: ContinuityStore,
}

impl fmt::Debug for ContinuityRuntime {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ContinuityRuntime")
            .field("owner_pubkey", &self.owner_pubkey)
            .field("store", &"[ENCRYPTED SQLITE]")
            .finish()
    }
}

/// Body-free process state. Chat never depends on this being ready.
pub(crate) enum ContinuityRuntimeState {
    Uninitialized,
    Ready(ContinuityRuntime),
    Degraded(ContinuityRuntimeDegradedReason),
}

impl fmt::Debug for ContinuityRuntimeState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Uninitialized => formatter.write_str("ContinuityRuntimeState::Uninitialized"),
            Self::Ready(runtime) => formatter.debug_tuple("Ready").field(runtime).finish(),
            Self::Degraded(reason) => formatter.debug_tuple("Degraded").field(reason).finish(),
        }
    }
}

/// One exact, bounded immutable retrieval request.
pub(crate) struct ContinuityReadLeaseRequestV1 {
    pub(crate) owner_pubkey: Hex64,
    pub(crate) address: NamespaceScope,
    pub(crate) cue: RetrievalText,
    pub(crate) query_vector: Option<Vec<i16>>,
    pub(crate) deadline: Instant,
}

impl fmt::Debug for ContinuityReadLeaseRequestV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ContinuityReadLeaseRequestV1")
            .field("owner_pubkey", &self.owner_pubkey)
            .field("address", &self.address)
            .field("cue", &"[REDACTED]")
            .field("has_query_vector", &self.query_vector.is_some())
            .field("deadline", &"[MONOTONIC]")
            .finish()
    }
}

/// Body-free proof of the immutable lease result.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ContinuityReadLeaseReceiptV1 {
    pub(crate) owner_pubkey: Hex64,
    pub(crate) namespace_ref: Sha256Ref,
    pub(crate) scope_ref: Sha256Ref,
    pub(crate) authority_generation: Option<SafeU53>,
    pub(crate) snapshot_fingerprint: Option<Sha256Ref>,
    pub(crate) attempt_count: u8,
    pub(crate) hit_count: usize,
}

/// Narrow borrowed plaintext view available only to the synchronous lease
/// consumer while the second lifecycle guard remains held.
pub(crate) struct ContinuityReadLeaseViewV1<'lease> {
    pub(crate) authority: &'lease RevisionAuthorityTokenV1,
    pub(crate) retrieval: &'lease RetrievalResult,
}

/// Fixed fail-soft, body-free lease outcomes. Plaintext is exposed only to the
/// synchronous consumer closure and never returned from the lease or AppState.
#[derive(Debug)]
pub(crate) enum ContinuityReadLeaseOutcomeV1 {
    Ready(ContinuityReadLeaseReceiptV1),
    Empty(ContinuityReadLeaseReceiptV1),
    Denied(ContinuityReadLeaseReceiptV1),
    Stale(ContinuityReadLeaseReceiptV1),
    Locked(ContinuityReadLeaseReceiptV1),
    Unavailable(ContinuityReadLeaseReceiptV1),
    Timeout(ContinuityReadLeaseReceiptV1),
    Invalid(ContinuityReadLeaseReceiptV1),
}

/// Initialize the one runtime after owner identity and recovery state resolve.
///
/// The lifecycle lock is acquired before restore/keychain inspection and the
/// runtime mutex. An absent master key may be established here, but never from
/// an immutable read lease.
pub(crate) fn initialize_desktop_runtime(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    app_data_dir: &Path,
    owner_pubkey: Hex64,
    identity_recovery_active: bool,
) {
    initialize_desktop_runtime_with(
        lifecycle,
        runtime_state,
        app_data_dir,
        owner_pubkey,
        identity_recovery_active,
        &DesktopContinuityBootCustody,
    );
}

/// Read the current body-free owner key version without opening, creating, or
/// rotating custody. `None` is deliberately fail-soft for an unavailable or
/// mismatched runtime; callers still run the normal read lease so its typed
/// locked/unavailable status remains authoritative.
pub(crate) fn current_owner_key_version(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
) -> Option<SafeU53> {
    let _lifecycle_guard = lifecycle.lock().ok()?;
    let state = runtime_state.lock().ok()?;
    match &*state {
        ContinuityRuntimeState::Ready(runtime) if &runtime.owner_pubkey == owner_pubkey => {
            runtime.store.active_owner_key_version(owner_pubkey).ok()
        }
        ContinuityRuntimeState::Uninitialized
        | ContinuityRuntimeState::Degraded(_)
        | ContinuityRuntimeState::Ready(_) => None,
    }
}

trait ContinuityBootCustody {
    fn restore_status(&self) -> Result<RestoreReadStatusV1, ContinuityBackupError>;
    fn encrypted_database_exists(&self, app_data_dir: &Path) -> Result<bool, ContinuityStoreError>;
    fn load_existing_root(&self) -> ContinuityMasterKeyState;
    fn acquire_root(&self) -> ContinuityMasterKeyState;
}

struct DesktopContinuityBootCustody;

impl ContinuityBootCustody for DesktopContinuityBootCustody {
    fn restore_status(&self) -> Result<RestoreReadStatusV1, ContinuityBackupError> {
        read_desktop_restore_status_existing_only()
    }

    fn encrypted_database_exists(&self, app_data_dir: &Path) -> Result<bool, ContinuityStoreError> {
        ContinuityStore::encrypted_database_exists(app_data_dir)
    }

    fn load_existing_root(&self) -> ContinuityMasterKeyState {
        load_existing_desktop_master_key()
    }

    fn acquire_root(&self) -> ContinuityMasterKeyState {
        acquire_desktop_master_key()
    }
}

fn initialize_desktop_runtime_with(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    app_data_dir: &Path,
    owner_pubkey: Hex64,
    identity_recovery_active: bool,
    custody: &impl ContinuityBootCustody,
) {
    let Ok(_lifecycle_guard) = lifecycle.lock() else {
        set_degraded(
            runtime_state,
            ContinuityRuntimeDegradedReason::StoreUnavailable,
        );
        return;
    };
    if identity_recovery_active {
        set_degraded(
            runtime_state,
            ContinuityRuntimeDegradedReason::IdentityRecovery,
        );
        return;
    }
    match custody.restore_status() {
        Ok(RestoreReadStatusV1::Clear) => {}
        Ok(RestoreReadStatusV1::Pending) => {
            set_degraded(
                runtime_state,
                ContinuityRuntimeDegradedReason::RestorePending,
            );
            return;
        }
        Err(error) => {
            set_degraded(runtime_state, degraded_restore_error(error));
            return;
        }
    }

    let database_exists = match custody.encrypted_database_exists(app_data_dir) {
        Ok(exists) => exists,
        Err(error) => {
            set_degraded(runtime_state, degraded_store_error(error));
            return;
        }
    };
    let key_state = if database_exists {
        custody.load_existing_root()
    } else {
        custody.acquire_root()
    };
    let custody = key_state.diagnostic().status.into();
    let mut state = match runtime_state.lock() {
        Ok(state) => state,
        Err(_) => return,
    };
    if !matches!(*state, ContinuityRuntimeState::Uninitialized) {
        return;
    }
    let opened = ContinuityStore::open(app_data_dir, custody);
    *state = match opened {
        Ok(ContinuityStoreOpen::Ready(store)) => ContinuityRuntimeState::Ready(ContinuityRuntime {
            owner_pubkey,
            store,
        }),
        Ok(ContinuityStoreOpen::Degraded(reason)) => {
            ContinuityRuntimeState::Degraded(degraded_store_reason(reason))
        }
        Err(error) => ContinuityRuntimeState::Degraded(degraded_store_error(error)),
    };
    drop(key_state);
}

fn set_degraded(
    runtime_state: &Mutex<ContinuityRuntimeState>,
    reason: ContinuityRuntimeDegradedReason,
) {
    if let Ok(mut state) = runtime_state.lock() {
        if matches!(*state, ContinuityRuntimeState::Uninitialized) {
            *state = ContinuityRuntimeState::Degraded(reason);
        }
    }
}

fn degraded_store_reason(reason: ContinuityStoreDegradedReason) -> ContinuityRuntimeDegradedReason {
    match reason {
        ContinuityStoreDegradedReason::KeyLocked => ContinuityRuntimeDegradedReason::KeyLocked,
        ContinuityStoreDegradedReason::KeyUnavailable => {
            ContinuityRuntimeDegradedReason::KeyUnavailable
        }
        ContinuityStoreDegradedReason::KeyCorrupt => ContinuityRuntimeDegradedReason::KeyCorrupt,
        ContinuityStoreDegradedReason::AuthorityMigrationRequired => {
            ContinuityRuntimeDegradedReason::AuthorityMigrationRequired
        }
    }
}

fn degraded_store_error(error: ContinuityStoreError) -> ContinuityRuntimeDegradedReason {
    match error {
        ContinuityStoreError::SchemaIncompatible => {
            ContinuityRuntimeDegradedReason::SchemaIncompatible
        }
        ContinuityStoreError::AuthorityMigrationRequired => {
            ContinuityRuntimeDegradedReason::AuthorityMigrationRequired
        }
        _ => ContinuityRuntimeDegradedReason::StoreUnavailable,
    }
}

fn degraded_restore_error(error: ContinuityBackupError) -> ContinuityRuntimeDegradedReason {
    match error {
        ContinuityBackupError::Keychain(ContinuityKeyStoreError::Locked) => {
            ContinuityRuntimeDegradedReason::KeyLocked
        }
        ContinuityBackupError::Keychain(ContinuityKeyStoreError::Unavailable) => {
            ContinuityRuntimeDegradedReason::KeyUnavailable
        }
        ContinuityBackupError::Keychain(ContinuityKeyStoreError::Corrupt) => {
            ContinuityRuntimeDegradedReason::KeyCorrupt
        }
        _ => ContinuityRuntimeDegradedReason::RestoreInvalid,
    }
}

fn receipt(
    request: &ContinuityReadLeaseRequestV1,
    attempt_count: u8,
    authority: Option<&RevisionAuthorityTokenV1>,
    hit_count: usize,
) -> ContinuityReadLeaseReceiptV1 {
    ContinuityReadLeaseReceiptV1 {
        owner_pubkey: request.owner_pubkey.clone(),
        namespace_ref: request
            .address
            .namespace()
            .as_protocol()
            .namespace_ref
            .clone(),
        scope_ref: request.address.as_protocol().scope_ref.clone(),
        authority_generation: authority.map(|token| token.generation),
        snapshot_fingerprint: authority.map(|token| token.snapshot_fingerprint.clone()),
        attempt_count,
        hit_count,
    }
}

fn key_outcome(
    request: &ContinuityReadLeaseRequestV1,
    attempt_count: u8,
    state: ContinuityMasterKeyState,
) -> Result<ContinuityMasterKey, ContinuityReadLeaseOutcomeV1> {
    match state {
        ContinuityMasterKeyState::Ready(key) => Ok(key),
        ContinuityMasterKeyState::Locked => Err(ContinuityReadLeaseOutcomeV1::Locked(receipt(
            request,
            attempt_count,
            None,
            0,
        ))),
        ContinuityMasterKeyState::Unavailable => Err(ContinuityReadLeaseOutcomeV1::Unavailable(
            receipt(request, attempt_count, None, 0),
        )),
        ContinuityMasterKeyState::Corrupt => Err(ContinuityReadLeaseOutcomeV1::Invalid(receipt(
            request,
            attempt_count,
            None,
            0,
        ))),
    }
}

enum AttemptResult {
    Final(ContinuityReadLeaseOutcomeV1),
    Retry,
}

trait ContinuityLeaseCustody {
    fn restore_status(&self) -> Result<RestoreReadStatusV1, ContinuityBackupError>;
    fn load_existing_root(&self) -> ContinuityMasterKeyState;
}

struct DesktopContinuityLeaseCustody;

impl ContinuityLeaseCustody for DesktopContinuityLeaseCustody {
    fn restore_status(&self) -> Result<RestoreReadStatusV1, ContinuityBackupError> {
        read_desktop_restore_status_existing_only()
    }

    fn load_existing_root(&self) -> ContinuityMasterKeyState {
        load_existing_desktop_master_key()
    }
}

/// Production immutable lease. It makes at most two captures and never mints a
/// missing key. All continuity failures return a typed body-free outcome.
pub(crate) fn read_desktop_continuity_lease<F>(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    request: ContinuityReadLeaseRequestV1,
    consumer: F,
) -> ContinuityReadLeaseOutcomeV1
where
    F: for<'lease> FnOnce(ContinuityReadLeaseViewV1<'lease>),
{
    read_continuity_lease_with(
        lifecycle,
        runtime_state,
        request,
        &DesktopContinuityLeaseCustody,
        consumer,
    )
}

fn read_continuity_lease_with<F>(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    request: ContinuityReadLeaseRequestV1,
    custody: &impl ContinuityLeaseCustody,
    consumer: F,
) -> ContinuityReadLeaseOutcomeV1
where
    F: for<'lease> FnOnce(ContinuityReadLeaseViewV1<'lease>),
{
    if request.owner_pubkey != request.address.namespace().as_protocol().owner_pubkey {
        return ContinuityReadLeaseOutcomeV1::Denied(receipt(&request, 0, None, 0));
    }
    let mut consumer = Some(consumer);
    for attempt_count in 1..=MAX_LEASE_ATTEMPTS {
        match read_attempt(
            lifecycle,
            runtime_state,
            &request,
            attempt_count,
            custody,
            &mut consumer,
        ) {
            AttemptResult::Final(outcome) => return outcome,
            AttemptResult::Retry if attempt_count < MAX_LEASE_ATTEMPTS => continue,
            AttemptResult::Retry => {
                return ContinuityReadLeaseOutcomeV1::Stale(receipt(
                    &request,
                    attempt_count,
                    None,
                    0,
                ));
            }
        }
    }
    ContinuityReadLeaseOutcomeV1::Unavailable(receipt(&request, 0, None, 0))
}

fn read_attempt<F>(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    request: &ContinuityReadLeaseRequestV1,
    attempt_count: u8,
    custody: &impl ContinuityLeaseCustody,
    consumer: &mut Option<F>,
) -> AttemptResult
where
    F: for<'lease> FnOnce(ContinuityReadLeaseViewV1<'lease>),
{
    if Instant::now() >= request.deadline {
        return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Timeout(receipt(
            request,
            attempt_count,
            None,
            0,
        )));
    }

    let lifecycle_guard = match lifecycle.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Unavailable(receipt(
                request,
                attempt_count,
                None,
                0,
            )));
        }
    };
    match custody.restore_status() {
        Ok(RestoreReadStatusV1::Clear) => {}
        Ok(RestoreReadStatusV1::Pending) => {
            return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Stale(receipt(
                request,
                attempt_count,
                None,
                0,
            )));
        }
        Err(error) => {
            return AttemptResult::Final(restore_error_outcome(request, attempt_count, error));
        }
    }
    let root = match key_outcome(request, attempt_count, custody.load_existing_root()) {
        Ok(root) => root,
        Err(outcome) => return AttemptResult::Final(outcome),
    };
    let capture =
        {
            let state = match runtime_state.lock() {
                Ok(state) => state,
                Err(_) => {
                    return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Unavailable(
                        receipt(request, attempt_count, None, 0),
                    ));
                }
            };
            let runtime = match &*state {
                ContinuityRuntimeState::Ready(runtime)
                    if runtime.owner_pubkey == request.owner_pubkey =>
                {
                    runtime
                }
                ContinuityRuntimeState::Ready(_) => {
                    return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Denied(receipt(
                        request,
                        attempt_count,
                        None,
                        0,
                    )));
                }
                ContinuityRuntimeState::Degraded(reason) => {
                    return AttemptResult::Final(degraded_outcome(request, attempt_count, *reason));
                }
                ContinuityRuntimeState::Uninitialized => {
                    return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Unavailable(
                        receipt(request, attempt_count, None, 0),
                    ));
                }
            };
            match runtime
                .store
                .capture_immutable_active_scope(&request.owner_pubkey, &request.address)
            {
                Ok(capture) => capture,
                Err(ContinuityStoreError::LifecycleConflict)
                | Err(ContinuityStoreError::CompareAndSwapConflict) => return AttemptResult::Retry,
                Err(error) => {
                    return AttemptResult::Final(store_error_outcome(
                        request,
                        attempt_count,
                        None,
                        error,
                    ));
                }
            }
        };
    drop(lifecycle_guard);

    let Some(capture) = capture else {
        return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Empty(receipt(
            request,
            attempt_count,
            None,
            0,
        )));
    };
    if Instant::now() >= request.deadline {
        return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Timeout(receipt(
            request,
            attempt_count,
            Some(&capture.token),
            0,
        )));
    }

    let namespace_key = match derive_namespace_key(&root, request.address.namespace()) {
        Ok(key) => key,
        Err(_) => {
            return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Invalid(receipt(
                request,
                attempt_count,
                Some(&capture.token),
                0,
            )));
        }
    };
    let mut records = Vec::with_capacity(capture.active_heads.len());
    for encrypted in &capture.active_heads {
        if Instant::now() >= request.deadline {
            return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Timeout(receipt(
                request,
                attempt_count,
                Some(&capture.token),
                0,
            )));
        }
        let material = match decrypt_record(encrypted, namespace_key.as_bytes())
            .and_then(RetrievalMaterialV1::decode)
        {
            Ok(material) => material,
            Err(_) => {
                return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Invalid(receipt(
                    request,
                    attempt_count,
                    Some(&capture.token),
                    0,
                )));
            }
        };
        if material.provenance_refs() != encrypted.provenance_refs.as_slice() {
            return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Invalid(receipt(
                request,
                attempt_count,
                Some(&capture.token),
                0,
            )));
        }
        let input = match material.into_record_input(
            request.address.clone(),
            encrypted.record_id.clone(),
            encrypted.record_type.clone(),
            encrypted.revision,
            RetrievalRecordState::Active,
        ) {
            Ok(input) => input,
            Err(_) => {
                return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Invalid(receipt(
                    request,
                    attempt_count,
                    Some(&capture.token),
                    0,
                )));
            }
        };
        match RetrievalRecord::new(input) {
            Ok(record) => records.push(record),
            Err(_) => {
                return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Invalid(receipt(
                    request,
                    attempt_count,
                    Some(&capture.token),
                    0,
                )));
            }
        }
    }
    let index = match InMemoryRetrievalIndex::hydrate(&records) {
        Ok(index) => index,
        Err(_) => {
            return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Invalid(receipt(
                request,
                attempt_count,
                Some(&capture.token),
                0,
            )));
        }
    };
    let retrieval = match index.retrieve(
        &RetrievalQuery {
            address: request.address.clone(),
            cue: request.cue.clone(),
            query_vector: request.query_vector.clone(),
        },
        None,
    ) {
        Ok(retrieval) => retrieval,
        Err(_) => {
            return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Invalid(receipt(
                request,
                attempt_count,
                Some(&capture.token),
                0,
            )));
        }
    };
    if Instant::now() >= request.deadline {
        return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Timeout(receipt(
            request,
            attempt_count,
            Some(&capture.token),
            0,
        )));
    }

    let _lifecycle_guard = match lifecycle.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Unavailable(receipt(
                request,
                attempt_count,
                Some(&capture.token),
                0,
            )));
        }
    };
    match custody.restore_status() {
        Ok(RestoreReadStatusV1::Clear) => {}
        Ok(RestoreReadStatusV1::Pending) => return AttemptResult::Retry,
        Err(error) => {
            return AttemptResult::Final(restore_error_outcome(request, attempt_count, error));
        }
    }
    let current_root = match key_outcome(request, attempt_count, custody.load_existing_root()) {
        Ok(root) => root,
        Err(outcome) => return AttemptResult::Final(outcome),
    };
    if !root.matches(&current_root) {
        return AttemptResult::Retry;
    }
    let current =
        {
            let state = match runtime_state.lock() {
                Ok(state) => state,
                Err(_) => {
                    return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Unavailable(
                        receipt(request, attempt_count, Some(&capture.token), 0),
                    ));
                }
            };
            match &*state {
                ContinuityRuntimeState::Ready(runtime)
                    if runtime.owner_pubkey == request.owner_pubkey =>
                {
                    match runtime.store.revalidate_immutable_capture(&capture.token) {
                        Ok(current) => current,
                        Err(ContinuityStoreError::LifecycleConflict)
                        | Err(ContinuityStoreError::CompareAndSwapConflict) => {
                            return AttemptResult::Retry;
                        }
                        Err(error) => {
                            return AttemptResult::Final(store_error_outcome(
                                request,
                                attempt_count,
                                Some(&capture.token),
                                error,
                            ));
                        }
                    }
                }
                ContinuityRuntimeState::Ready(_) => {
                    return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Denied(receipt(
                        request,
                        attempt_count,
                        Some(&capture.token),
                        0,
                    )));
                }
                ContinuityRuntimeState::Degraded(reason) => {
                    return AttemptResult::Final(degraded_outcome(request, attempt_count, *reason));
                }
                ContinuityRuntimeState::Uninitialized => {
                    return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Unavailable(
                        receipt(request, attempt_count, Some(&capture.token), 0),
                    ));
                }
            }
        };
    if !current {
        return AttemptResult::Retry;
    }
    if Instant::now() >= request.deadline {
        return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Timeout(receipt(
            request,
            attempt_count,
            Some(&capture.token),
            0,
        )));
    }
    if retrieval.hits.is_empty() {
        return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Empty(receipt(
            request,
            attempt_count,
            Some(&capture.token),
            0,
        )));
    }
    let ready_receipt = receipt(
        request,
        attempt_count,
        Some(&capture.token),
        retrieval.hits.len(),
    );
    let Some(consumer) = consumer.take() else {
        return AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Invalid(receipt(
            request,
            attempt_count,
            Some(&capture.token),
            0,
        )));
    };
    consumer(ContinuityReadLeaseViewV1 {
        authority: &capture.token,
        retrieval: &retrieval,
    });
    AttemptResult::Final(ContinuityReadLeaseOutcomeV1::Ready(ready_receipt))
}

fn restore_error_outcome(
    request: &ContinuityReadLeaseRequestV1,
    attempt_count: u8,
    error: ContinuityBackupError,
) -> ContinuityReadLeaseOutcomeV1 {
    match degraded_restore_error(error) {
        ContinuityRuntimeDegradedReason::KeyLocked => {
            ContinuityReadLeaseOutcomeV1::Locked(receipt(request, attempt_count, None, 0))
        }
        ContinuityRuntimeDegradedReason::KeyUnavailable => {
            ContinuityReadLeaseOutcomeV1::Unavailable(receipt(request, attempt_count, None, 0))
        }
        _ => ContinuityReadLeaseOutcomeV1::Invalid(receipt(request, attempt_count, None, 0)),
    }
}

fn degraded_outcome(
    request: &ContinuityReadLeaseRequestV1,
    attempt_count: u8,
    reason: ContinuityRuntimeDegradedReason,
) -> ContinuityReadLeaseOutcomeV1 {
    match reason {
        ContinuityRuntimeDegradedReason::KeyLocked => {
            ContinuityReadLeaseOutcomeV1::Locked(receipt(request, attempt_count, None, 0))
        }
        ContinuityRuntimeDegradedReason::RestorePending => {
            ContinuityReadLeaseOutcomeV1::Stale(receipt(request, attempt_count, None, 0))
        }
        ContinuityRuntimeDegradedReason::IdentityRecovery => {
            ContinuityReadLeaseOutcomeV1::Denied(receipt(request, attempt_count, None, 0))
        }
        ContinuityRuntimeDegradedReason::RestoreInvalid
        | ContinuityRuntimeDegradedReason::KeyCorrupt
        | ContinuityRuntimeDegradedReason::SchemaIncompatible
        | ContinuityRuntimeDegradedReason::AuthorityMigrationRequired => {
            ContinuityReadLeaseOutcomeV1::Invalid(receipt(request, attempt_count, None, 0))
        }
        ContinuityRuntimeDegradedReason::KeyUnavailable
        | ContinuityRuntimeDegradedReason::StoreUnavailable => {
            ContinuityReadLeaseOutcomeV1::Unavailable(receipt(request, attempt_count, None, 0))
        }
    }
}

fn store_error_outcome(
    request: &ContinuityReadLeaseRequestV1,
    attempt_count: u8,
    authority: Option<&RevisionAuthorityTokenV1>,
    error: ContinuityStoreError,
) -> ContinuityReadLeaseOutcomeV1 {
    match error {
        ContinuityStoreError::Unavailable => {
            ContinuityReadLeaseOutcomeV1::Unavailable(receipt(request, attempt_count, authority, 0))
        }
        _ => ContinuityReadLeaseOutcomeV1::Invalid(receipt(request, attempt_count, authority, 0)),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        cell::Cell,
        fs,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
        time::Duration,
    };

    use luca_continuity::{
        derive_revision_idempotency_key, encrypt_record, encrypted_record_reference,
        RecordMetadata, RevisionActor, RevisionOperation, RevisionRequest,
    };
    use luca_protocol::{
        CanonicalTimestamp, ContinuityNamespaceKindV1, ContinuityNamespaceV1, ContinuityScopeV1,
        OpaqueId,
    };
    use tempfile::TempDir;

    use super::*;
    use crate::luca::{
        continuity_revision_authority::AuthorityExpectationV1,
        continuity_store::{ContinuityStoreCustody, ContinuityStoreOpen},
    };

    const ROOT_BYTES: [u8; 32] = [0x11; 32];

    #[derive(Clone, Copy)]
    enum FakeRootState {
        Ready,
        Locked,
        Unavailable,
    }

    struct FakeCustody {
        restore: Cell<Result<RestoreReadStatusV1, ContinuityBackupError>>,
        root: Cell<FakeRootState>,
        restore_reads: Cell<usize>,
        root_reads: Cell<usize>,
        on_root_read: Option<Box<dyn Fn(usize)>>,
    }

    impl FakeCustody {
        fn ready() -> Self {
            Self {
                restore: Cell::new(Ok(RestoreReadStatusV1::Clear)),
                root: Cell::new(FakeRootState::Ready),
                restore_reads: Cell::new(0),
                root_reads: Cell::new(0),
                on_root_read: None,
            }
        }
    }

    impl ContinuityLeaseCustody for FakeCustody {
        fn restore_status(&self) -> Result<RestoreReadStatusV1, ContinuityBackupError> {
            self.restore_reads.set(self.restore_reads.get() + 1);
            self.restore.get()
        }

        fn load_existing_root(&self) -> ContinuityMasterKeyState {
            let read = self.root_reads.get() + 1;
            self.root_reads.set(read);
            if let Some(callback) = &self.on_root_read {
                callback(read);
            }
            match self.root.get() {
                FakeRootState::Ready => {
                    ContinuityMasterKeyState::Ready(ContinuityMasterKey::new_for_test(ROOT_BYTES))
                }
                FakeRootState::Locked => ContinuityMasterKeyState::Locked,
                FakeRootState::Unavailable => ContinuityMasterKeyState::Unavailable,
            }
        }
    }

    struct FakeBootCustody {
        restore: Cell<Result<RestoreReadStatusV1, ContinuityBackupError>>,
        database_exists: Cell<Result<bool, ContinuityStoreError>>,
        existing_root: Cell<FakeRootState>,
        acquired_root: Cell<FakeRootState>,
        existing_reads: Cell<usize>,
        acquire_reads: Cell<usize>,
    }

    impl FakeBootCustody {
        fn new(database_exists: bool) -> Self {
            Self {
                restore: Cell::new(Ok(RestoreReadStatusV1::Clear)),
                database_exists: Cell::new(Ok(database_exists)),
                existing_root: Cell::new(FakeRootState::Unavailable),
                acquired_root: Cell::new(FakeRootState::Ready),
                existing_reads: Cell::new(0),
                acquire_reads: Cell::new(0),
            }
        }

        fn root_state(state: FakeRootState) -> ContinuityMasterKeyState {
            match state {
                FakeRootState::Ready => {
                    ContinuityMasterKeyState::Ready(ContinuityMasterKey::new_for_test(ROOT_BYTES))
                }
                FakeRootState::Locked => ContinuityMasterKeyState::Locked,
                FakeRootState::Unavailable => ContinuityMasterKeyState::Unavailable,
            }
        }
    }

    impl ContinuityBootCustody for FakeBootCustody {
        fn restore_status(&self) -> Result<RestoreReadStatusV1, ContinuityBackupError> {
            self.restore.get()
        }

        fn encrypted_database_exists(
            &self,
            _app_data_dir: &Path,
        ) -> Result<bool, ContinuityStoreError> {
            self.database_exists.get()
        }

        fn load_existing_root(&self) -> ContinuityMasterKeyState {
            self.existing_reads.set(self.existing_reads.get() + 1);
            Self::root_state(self.existing_root.get())
        }

        fn acquire_root(&self) -> ContinuityMasterKeyState {
            self.acquire_reads.set(self.acquire_reads.get() + 1);
            Self::root_state(self.acquired_root.get())
        }
    }

    fn hex(digit: char) -> Hex64 {
        Hex64::parse(digit.to_string().repeat(64)).unwrap()
    }

    fn sha(digit: char) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{}", digit.to_string().repeat(64))).unwrap()
    }

    fn id(value: &str) -> OpaqueId {
        OpaqueId::parse(value).unwrap()
    }

    fn namespace() -> ContinuityNamespaceV1 {
        ContinuityNamespaceV1 {
            protocol: "luca.continuity.v1".into(),
            owner_pubkey: hex('1'),
            kind: ContinuityNamespaceKindV1::ResidentPrivate,
            resident_pubkey: Some(hex('2')),
            namespace_ref: sha('3'),
            key_version: SafeU53::new(1).unwrap(),
        }
    }

    fn scope(namespace: &ContinuityNamespaceV1) -> ContinuityScopeV1 {
        ContinuityScopeV1 {
            protocol: "luca.continuity.v1".into(),
            namespace_ref: namespace.namespace_ref.clone(),
            scope_ref: sha('4'),
            source_id: Some(id("source")),
            project_id: None,
            room_id: None,
            conversation_id: Some(id("conversation")),
        }
    }

    fn encrypted_material_record(
        record_id: &str,
        revision: u64,
        predecessor: Option<&str>,
        body: &str,
    ) -> luca_protocol::ContinuityRecordV1 {
        let namespace = namespace();
        let provenance = sha('5');
        let material = serde_json::to_vec(&serde_json::json!({
            "protocol": "luca.continuity.retrieval-material.v1",
            "version": 1,
            "body": body,
            "tags": ["alpha", "notebook"],
            "confidence_basis_points": 9000,
            "provenance_refs": [provenance.as_str()],
            "outgoing_edges": []
        }))
        .unwrap();
        let root = ContinuityMasterKey::new_for_test(ROOT_BYTES);
        let namespace_key = derive_namespace_key(
            &root,
            &namespace.clone().try_into().expect("valid namespace"),
        )
        .unwrap();
        encrypt_record(
            RecordMetadata {
                protocol: "luca.continuity.v1".into(),
                record_id: id(record_id),
                namespace: namespace.clone(),
                scope: scope(&namespace),
                record_type: id("hypomnema"),
                revision: SafeU53::new(revision).unwrap(),
                predecessor_record_id: predecessor.map(id),
                created_at: CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
                author_kind: id(if revision == 0 { "owner" } else { "resident" }),
                provenance_refs: vec![provenance],
                key_version: SafeU53::new(1).unwrap(),
            },
            namespace_key.as_bytes(),
            &material,
        )
        .unwrap()
    }

    fn request_for_record(
        operation: RevisionOperation,
        lineage_root_id: &str,
        successor: luca_protocol::ContinuityRecordV1,
        expected: Option<&str>,
        seed: char,
    ) -> RevisionRequest {
        let actor = if operation == RevisionOperation::Create {
            RevisionActor::Owner
        } else {
            RevisionActor::Resident
        };
        let mut request = RevisionRequest {
            idempotency_key: sha('0'),
            operation,
            lineage_root_id: id(lineage_root_id),
            expected_head_record_id: expected.map(id),
            actor,
            signed_source_event_refs: vec![sha(seed)],
            request_ref: sha(seed),
            successor_ciphertext_ref: Some(encrypted_record_reference(&successor).unwrap()),
            successor: Some(successor),
            rollback_source_record_id: None,
            derived_artifact_refs: Vec::new(),
        };
        let record = request.successor.as_ref().unwrap();
        request.idempotency_key = derive_revision_idempotency_key(
            &record.namespace,
            &record.scope,
            &record.record_type,
            record.key_version,
            &request,
        )
        .unwrap();
        request
    }

    fn ready_runtime(temp: &TempDir) -> (Arc<Mutex<ContinuityRuntimeState>>, NamespaceScope) {
        let mut store =
            match ContinuityStore::open(temp.path(), ContinuityStoreCustody::Ready).unwrap() {
                ContinuityStoreOpen::Ready(store) => store,
                ContinuityStoreOpen::Degraded(_) => panic!("expected ready store"),
            };
        let first = encrypted_material_record("record-0", 0, None, "alpha notebook first");
        let address = NamespaceScope::new(
            first.namespace.clone().try_into().unwrap(),
            first.scope.clone(),
        )
        .unwrap();
        store
            .apply_revision_transition_cas(
                &AuthorityExpectationV1::UninitializedOwner {
                    owner_pubkey: hex('1'),
                    active_root_key_version: SafeU53::new(1).unwrap(),
                },
                request_for_record(RevisionOperation::Create, "record-0", first, None, '6'),
            )
            .unwrap();
        (
            Arc::new(Mutex::new(ContinuityRuntimeState::Ready(
                ContinuityRuntime {
                    owner_pubkey: hex('1'),
                    store,
                },
            ))),
            address,
        )
    }

    fn lease_request(address: NamespaceScope) -> ContinuityReadLeaseRequestV1 {
        ContinuityReadLeaseRequestV1 {
            owner_pubkey: hex('1'),
            address,
            cue: RetrievalText::from("alpha"),
            query_vector: None,
            deadline: Instant::now() + Duration::from_secs(5),
        }
    }

    fn durable_database_bytes(temp: &TempDir) -> Vec<(String, Vec<u8>)> {
        let directory = temp.path().join("continuity");
        let mut files = fs::read_dir(directory)
            .unwrap()
            // SQLite legitimately updates process-coordination bytes in `-shm`
            // during a read. The database and WAL are the durable state whose
            // byte identity proves this lease performed no persistent write.
            .filter(|entry| {
                entry
                    .as_ref()
                    .is_ok_and(|entry| !entry.file_name().to_string_lossy().ends_with("-shm"))
            })
            .map(|entry| {
                let entry = entry.unwrap();
                (
                    entry.file_name().to_string_lossy().into_owned(),
                    fs::read(entry.path()).unwrap(),
                )
            })
            .collect::<Vec<_>>();
        files.sort_by(|left, right| left.0.cmp(&right.0));
        files
    }

    fn append_revision(runtime: &Mutex<ContinuityRuntimeState>, revision: u64) {
        let mut state = runtime.lock().unwrap();
        let ContinuityRuntimeState::Ready(runtime) = &mut *state else {
            panic!("expected ready runtime");
        };
        let previous = format!("record-{}", revision - 1);
        let next = format!("record-{revision}");
        let generation = runtime
            .store
            .load_revision_generation(&hex('1'))
            .unwrap()
            .unwrap();
        let successor = encrypted_material_record(
            &next,
            revision,
            Some(&previous),
            &format!("alpha notebook revision {revision}"),
        );
        runtime
            .store
            .apply_revision_transition_cas(
                &AuthorityExpectationV1::Existing(generation.token),
                request_for_record(
                    RevisionOperation::Revise,
                    "record-0",
                    successor,
                    Some(&previous),
                    char::from_digit(6 + revision as u32, 16).unwrap(),
                ),
            )
            .unwrap();
    }

    #[test]
    fn runtime_debug_never_formats_store_internals() {
        assert_eq!(
            format!(
                "{:?}",
                ContinuityRuntimeState::Degraded(ContinuityRuntimeDegradedReason::KeyLocked)
            ),
            "Degraded(KeyLocked)"
        );
    }

    #[test]
    fn source_has_no_async_wait_or_plaintext_string_payload() {
        let source = include_str!("continuity_runtime.rs");
        assert!(!source.contains(&[".aw", "ait"].concat()));
        assert!(!source.contains(&["content: ", "String"].concat()));
        assert!(!source.contains(&["pub(crate) ", "store:"].concat()));
        assert!(!source.contains(&["ContinuityReadLease", "PayloadV1"].concat()));
    }

    #[test]
    fn boot_existing_database_never_acquires_while_new_path_may_initialize() {
        let existing_temp = TempDir::new().unwrap();
        let store = match ContinuityStore::open(existing_temp.path(), ContinuityStoreCustody::Ready)
            .unwrap()
        {
            ContinuityStoreOpen::Ready(store) => store,
            ContinuityStoreOpen::Degraded(_) => panic!("expected ready store"),
        };
        drop(store);
        let before = durable_database_bytes(&existing_temp);
        let existing_runtime = Mutex::new(ContinuityRuntimeState::Uninitialized);
        let existing_custody = FakeBootCustody::new(true);
        initialize_desktop_runtime_with(
            &ContinuityLifecycleLock::new_for_test(),
            &existing_runtime,
            existing_temp.path(),
            hex('1'),
            false,
            &existing_custody,
        );
        assert_eq!(existing_custody.existing_reads.get(), 1);
        assert_eq!(existing_custody.acquire_reads.get(), 0);
        assert!(matches!(
            *existing_runtime.lock().unwrap(),
            ContinuityRuntimeState::Degraded(ContinuityRuntimeDegradedReason::KeyUnavailable)
        ));
        assert_eq!(durable_database_bytes(&existing_temp), before);

        let new_temp = TempDir::new().unwrap();
        let new_runtime = Mutex::new(ContinuityRuntimeState::Uninitialized);
        let new_custody = FakeBootCustody::new(false);
        initialize_desktop_runtime_with(
            &ContinuityLifecycleLock::new_for_test(),
            &new_runtime,
            new_temp.path(),
            hex('1'),
            false,
            &new_custody,
        );
        assert_eq!(new_custody.existing_reads.get(), 0);
        assert_eq!(new_custody.acquire_reads.get(), 1);
        assert!(matches!(
            *new_runtime.lock().unwrap(),
            ContinuityRuntimeState::Ready(_)
        ));
    }

    #[test]
    fn immutable_lease_reads_without_persistent_mutation_and_redacts_debug() {
        let temp = TempDir::new().unwrap();
        let (runtime, address) = ready_runtime(&temp);
        let before = durable_database_bytes(&temp);
        let custody = FakeCustody::ready();
        let lifecycle = ContinuityLifecycleLock::new_for_test();
        let invocation_count = Cell::new(0);
        let outcome = read_continuity_lease_with(
            &lifecycle,
            &runtime,
            lease_request(address),
            &custody,
            |view| {
                assert!(lifecycle.is_locked_for_test());
                assert_eq!(view.retrieval.hits.len(), 1);
                assert_eq!(
                    view.retrieval.hits[0].record().body(),
                    "alpha notebook first"
                );
                assert_eq!(view.authority.generation.get(), 1);
                invocation_count.set(invocation_count.get() + 1);
            },
        );
        let debug = format!("{outcome:?}");
        let ContinuityReadLeaseOutcomeV1::Ready(receipt) = outcome else {
            panic!("expected ready lease: {debug}");
        };
        assert_eq!(invocation_count.get(), 1);
        assert_eq!(receipt.attempt_count, 1);
        assert_eq!(receipt.hit_count, 1);
        assert!(!debug.contains("alpha notebook"));
        assert_eq!(durable_database_bytes(&temp), before);
    }

    #[test]
    fn timeout_pending_restore_and_locked_key_fail_before_plaintext() {
        let lifecycle = ContinuityLifecycleLock::new_for_test();
        let runtime = Mutex::new(ContinuityRuntimeState::Uninitialized);
        let address =
            NamespaceScope::new(namespace().try_into().unwrap(), scope(&namespace())).unwrap();
        let expired = ContinuityReadLeaseRequestV1 {
            deadline: Instant::now(),
            ..lease_request(address.clone())
        };
        let custody = FakeCustody::ready();
        assert!(matches!(
            read_continuity_lease_with(&lifecycle, &runtime, expired, &custody, |_| {
                panic!("expired lease must not invoke consumer")
            }),
            ContinuityReadLeaseOutcomeV1::Timeout(_)
        ));
        assert_eq!(custody.restore_reads.get(), 0);
        assert_eq!(custody.root_reads.get(), 0);

        custody.restore.set(Ok(RestoreReadStatusV1::Pending));
        assert!(matches!(
            read_continuity_lease_with(
                &lifecycle,
                &runtime,
                lease_request(address.clone()),
                &custody,
                |_| panic!("pending restore must not invoke consumer"),
            ),
            ContinuityReadLeaseOutcomeV1::Stale(_)
        ));
        assert_eq!(custody.root_reads.get(), 0);

        custody.restore.set(Ok(RestoreReadStatusV1::Clear));
        custody.root.set(FakeRootState::Locked);
        assert!(matches!(
            read_continuity_lease_with(
                &lifecycle,
                &runtime,
                lease_request(address),
                &custody,
                |_| panic!("locked root must not invoke consumer"),
            ),
            ContinuityReadLeaseOutcomeV1::Locked(_)
        ));
    }

    #[test]
    fn authority_change_retries_once_and_second_change_returns_stale() {
        let temp = TempDir::new().unwrap();
        let (runtime, address) = ready_runtime(&temp);
        let mutation_count = Arc::new(AtomicUsize::new(0));
        let callback_runtime = Arc::clone(&runtime);
        let callback_count = Arc::clone(&mutation_count);
        let mut custody = FakeCustody::ready();
        custody.on_root_read = Some(Box::new(move |read| {
            if read == 2 {
                append_revision(&callback_runtime, 1);
                callback_count.fetch_add(1, Ordering::SeqCst);
            }
        }));
        let lifecycle = ContinuityLifecycleLock::new_for_test();
        let consumer_count = Cell::new(0);
        let outcome = read_continuity_lease_with(
            &lifecycle,
            &runtime,
            lease_request(address.clone()),
            &custody,
            |view| {
                assert!(lifecycle.is_locked_for_test());
                assert_eq!(view.authority.generation.get(), 2);
                assert_eq!(view.retrieval.hits.len(), 1);
                consumer_count.set(consumer_count.get() + 1);
            },
        );
        let ContinuityReadLeaseOutcomeV1::Ready(receipt) = outcome else {
            panic!("expected retry success");
        };
        assert_eq!(receipt.attempt_count, 2);
        assert_eq!(mutation_count.load(Ordering::SeqCst), 1);
        assert_eq!(consumer_count.get(), 1);

        let second_temp = TempDir::new().unwrap();
        let (second_runtime, second_address) = ready_runtime(&second_temp);
        let callback_runtime = Arc::clone(&second_runtime);
        let mut stale_custody = FakeCustody::ready();
        stale_custody.on_root_read = Some(Box::new(move |read| match read {
            2 => append_revision(&callback_runtime, 1),
            4 => append_revision(&callback_runtime, 2),
            _ => {}
        }));
        let stale_consumer_count = Cell::new(0);
        assert!(matches!(
            read_continuity_lease_with(
                &ContinuityLifecycleLock::new_for_test(),
                &second_runtime,
                lease_request(second_address),
                &stale_custody,
                |_| stale_consumer_count.set(stale_consumer_count.get() + 1),
            ),
            ContinuityReadLeaseOutcomeV1::Stale(_)
        ));
        assert_eq!(stale_consumer_count.get(), 0);
    }

    #[test]
    fn second_phase_revalidation_preserves_invalid_and_unavailable_without_consumer() {
        let invalid_temp = TempDir::new().unwrap();
        let (invalid_runtime, invalid_address) = ready_runtime(&invalid_temp);
        let invalid_callback_runtime = Arc::clone(&invalid_runtime);
        let mut invalid_custody = FakeCustody::ready();
        invalid_custody.on_root_read = Some(Box::new(move |read| {
            if read == 2 {
                let state = invalid_callback_runtime.lock().unwrap();
                let ContinuityRuntimeState::Ready(runtime) = &*state else {
                    panic!("expected ready runtime");
                };
                runtime
                    .store
                    .connection
                    .execute(
                        "UPDATE continuity_records SET envelope_json=?2 WHERE record_id=?1",
                        rusqlite::params!["record-0", b"{}".as_slice()],
                    )
                    .unwrap();
            }
        }));
        let invalid_consumer_count = Cell::new(0);
        assert!(matches!(
            read_continuity_lease_with(
                &ContinuityLifecycleLock::new_for_test(),
                &invalid_runtime,
                lease_request(invalid_address),
                &invalid_custody,
                |_| invalid_consumer_count.set(invalid_consumer_count.get() + 1),
            ),
            ContinuityReadLeaseOutcomeV1::Invalid(_)
        ));
        assert_eq!(invalid_custody.root_reads.get(), 2);
        assert_eq!(invalid_consumer_count.get(), 0);

        let unavailable_temp = TempDir::new().unwrap();
        let (unavailable_runtime, unavailable_address) = ready_runtime(&unavailable_temp);
        let unavailable_callback_runtime = Arc::clone(&unavailable_runtime);
        let mut unavailable_custody = FakeCustody::ready();
        unavailable_custody.on_root_read = Some(Box::new(move |read| {
            if read == 2 {
                let state = unavailable_callback_runtime.lock().unwrap();
                let ContinuityRuntimeState::Ready(runtime) = &*state else {
                    panic!("expected ready runtime");
                };
                runtime
                    .store
                    .connection
                    .execute_batch("DROP TABLE continuity_rotation_journals")
                    .unwrap();
            }
        }));
        let unavailable_consumer_count = Cell::new(0);
        assert!(matches!(
            read_continuity_lease_with(
                &ContinuityLifecycleLock::new_for_test(),
                &unavailable_runtime,
                lease_request(unavailable_address),
                &unavailable_custody,
                |_| unavailable_consumer_count.set(unavailable_consumer_count.get() + 1),
            ),
            ContinuityReadLeaseOutcomeV1::Unavailable(_)
        ));
        assert_eq!(unavailable_custody.root_reads.get(), 2);
        assert_eq!(unavailable_consumer_count.get(), 0);
    }
}
