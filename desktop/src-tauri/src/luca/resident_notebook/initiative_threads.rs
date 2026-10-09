//! Canonical carried threads in the existing encrypted resident notebook.
//!
//! Uses the G2 `open-thread` kind: each inquiry has an independent immutable
//! lineage, not a replacement handoff or journal. The fixed authenticated
//! retrieval tag distinguishes typed initiative bodies from legacy open threads.
//! Successful persistence grants no observation, runtime or provider authority.

use super::*;
use crate::luca::{
    companion_initiative::own_inquiries::VerifiedOwnInquiryAuthorshipV1,
    continuity_revision_authority::RevisionAuthorityTokenV1, continuity_store::ContinuityStore,
};
use luca_protocol::{
    derive_initiative_thread_ref, InitiativeDispositionV1, InitiativeSemanticThreadV1,
    InitiativeThreadKindV1, InitiativeTransitionCauseV1,
};

/// Authenticated retrieval-material discriminator; malformed marked bodies fail closed.
pub(crate) const INITIATIVE_THREAD_TAG: &str = "initiative-thread-v1";
const SOURCE_CLEAN_HANDOFF_TAG: &str = "source-clean-handoff-v1";
const OWN_NATIVE_AUTHORED_TAG: &str = "own-native-authored-v1";

#[path = "initiative_thread_settlement.rs"]
mod settlement;
pub(crate) use settlement::*;

/// Host-bound current semantic head expected by an explicit edit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InitiativeThreadHeadV1 {
    pub(crate) record_id: OpaqueId,
    pub(crate) revision: SafeU53,
}

/// Trusted host request; not deserializable and deliberately not `Debug`.
/// The caller authenticates the actor and retention authority independently.
pub(crate) struct InitiativeThreadCommitRequestV1 {
    pub(crate) owner_pubkey: Hex64,
    pub(crate) resident_pubkey: Hex64,
    pub(crate) request_id: OpaqueId,
    pub(crate) actor: RevisionActor,
    /// Host proof from an untainted, already committed signed handoff. Neither
    /// a model's empty evidence list nor body/hash claims may set this flag.
    pub(crate) canonical_source_clean: bool,
    /// Sealed completed-native Own birth proof; never a caller/model bool.
    pub(crate) own_authorship_proof: Option<VerifiedOwnInquiryAuthorshipV1>,
    /// Host-verified completion evidence; never deserialized from semantic text.
    pub(crate) completion_cause: Option<InitiativeTransitionCauseV1>,
    pub(crate) expected_head: Option<InitiativeThreadHeadV1>,
    pub(crate) thread: InitiativeSemanticThreadV1,
}

/// Body-free receipt for the exact current canonical semantic revision.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InitiativeThreadCommitReceiptV1 {
    pub(crate) resident_pubkey: Hex64,
    pub(crate) thread_id: OpaqueId,
    pub(crate) record_id: OpaqueId,
    pub(crate) revision: SafeU53,
    pub(crate) canonical_thread_ref: Sha256Ref,
    pub(crate) canonical_revision_ref: Sha256Ref,
    pub(crate) replayed: bool,
}

/// Body-free persistence failure; never contains a private body or path.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InitiativeThreadStoreErrorV1 {
    Invalid,
    Denied,
    Stale,
    Locked,
    Unavailable,
    CapacityExceeded,
}

/// One private semantic revision with exact current-head metadata.
/// Historical views are explicit disclosure only, never implicit Wake input.
pub(crate) struct InitiativeThreadRevisionViewV1 {
    pub(crate) record_id: OpaqueId,
    pub(crate) current_head_record_id: Option<OpaqueId>,
    pub(crate) is_current: bool,
    pub(crate) pinned_owner_correction: bool,
    pub(crate) author_kind: OpaqueId,
    pub(crate) canonical_source_clean: bool,
    /// Authenticated native Own birthmark, separate from shared handoff proof.
    pub(crate) canonical_own_authorship: bool,
    pub(crate) canonical_revision_ref: Sha256Ref,
    pub(crate) thread: InitiativeSemanticThreadV1,
}

/// Private read result bound to the same immutable owner revision generation.
/// Revalidate this token before releasing bodies outside the guarded host read.
pub(crate) struct InitiativeThreadReadSnapshotV1 {
    pub(crate) authority: RevisionAuthorityTokenV1,
    pub(crate) threads: Vec<InitiativeThreadRevisionViewV1>,
}

/// Commit one explicit, exact-principal semantic create/edit through existing CAS.
pub(crate) fn commit_resident_initiative_thread(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    request: InitiativeThreadCommitRequestV1,
) -> Result<InitiativeThreadCommitReceiptV1, InitiativeThreadStoreErrorV1> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| InitiativeThreadStoreErrorV1::Unavailable)?;
    let root = existing_root()?;
    let mut state = runtime_state
        .lock()
        .map_err(|_| InitiativeThreadStoreErrorV1::Unavailable)?;
    let runtime = ready_runtime(&mut state, &request.owner_pubkey)?;
    let key_version = runtime
        .store
        .active_owner_key_version(&request.owner_pubkey)
        .map_err(store_error)?;
    let address =
        resident_notebook_address(&request.owner_pubkey, &request.resident_pubkey, key_version)
            .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    let key = derive_namespace_key(&root, address.namespace())
        .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    commit_in_store(&mut runtime.store, &address, key.as_bytes(), request)
}

/// Read independently carried lineages, not only the latest chat window.
/// Retired/declined/completed bodies remain inspectable, but are not carried Wake.
pub(crate) fn read_resident_initiative_threads(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
    resident_pubkey: &Hex64,
    include_history: bool,
) -> Result<Option<InitiativeThreadReadSnapshotV1>, InitiativeThreadStoreErrorV1> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| InitiativeThreadStoreErrorV1::Unavailable)?;
    let root = existing_root()?;
    let mut state = runtime_state
        .lock()
        .map_err(|_| InitiativeThreadStoreErrorV1::Unavailable)?;
    let runtime = ready_runtime(&mut state, owner_pubkey)?;
    let key_version = runtime
        .store
        .active_owner_key_version(owner_pubkey)
        .map_err(store_error)?;
    let address = resident_notebook_address(owner_pubkey, resident_pubkey, key_version)
        .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    let key = derive_namespace_key(&root, address.namespace())
        .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    read_in_store(&runtime.store, &address, key.as_bytes(), include_history)
}

fn existing_root(
) -> Result<crate::luca::continuity_key_custody::ContinuityMasterKey, InitiativeThreadStoreErrorV1>
{
    match load_existing_desktop_master_key() {
        ContinuityMasterKeyState::Ready(root) => Ok(root),
        ContinuityMasterKeyState::Locked => Err(InitiativeThreadStoreErrorV1::Locked),
        ContinuityMasterKeyState::Unavailable => Err(InitiativeThreadStoreErrorV1::Unavailable),
        ContinuityMasterKeyState::Corrupt => Err(InitiativeThreadStoreErrorV1::Invalid),
    }
}

/// Lend one exact current semantic head while the canonical lifecycle generation
/// remains held. The consumer may only frame or locally commit bounded data;
/// it must never wait for a model or acquire identity/lifecycle again.
pub(crate) fn consume_current_resident_initiative_thread<T>(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner: &Hex64,
    resident: &Hex64,
    thread_id: &OpaqueId,
    expected_record: &OpaqueId,
    expected_semantic_ref: &Sha256Ref,
    consume: impl FnOnce(&RevisionAuthorityTokenV1, &InitiativeThreadRevisionViewV1) -> T,
) -> Result<T, InitiativeThreadStoreErrorV1> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| InitiativeThreadStoreErrorV1::Unavailable)?;
    let root = existing_root()?;
    let mut state = runtime_state
        .lock()
        .map_err(|_| InitiativeThreadStoreErrorV1::Unavailable)?;
    let runtime = ready_runtime(&mut state, owner)?;
    let version = runtime
        .store
        .active_owner_key_version(owner)
        .map_err(store_error)?;
    let address = resident_notebook_address(owner, resident, version)
        .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    let key = derive_namespace_key(&root, address.namespace())
        .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    let current = read_in_store(&runtime.store, &address, key.as_bytes(), false)?
        .ok_or(InitiativeThreadStoreErrorV1::Stale)?;
    let view = current
        .threads
        .iter()
        .find(|view| &view.thread.thread_id == thread_id)
        .ok_or(InitiativeThreadStoreErrorV1::Stale)?;
    if !view.is_current
        || &view.record_id != expected_record
        || &view.canonical_revision_ref != expected_semantic_ref
        || matches!(
            view.thread.disposition,
            InitiativeDispositionV1::Declined
                | InitiativeDispositionV1::Retired
                | InitiativeDispositionV1::Completed
        )
    {
        return Err(InitiativeThreadStoreErrorV1::Stale);
    }
    if !runtime
        .store
        .revalidate_immutable_capture(&current.authority)
        .map_err(store_error)?
    {
        return Err(InitiativeThreadStoreErrorV1::Stale);
    }
    Ok(consume(&current.authority, view))
}

/// One-use writer restricted to a sealed native Own birth under this exact
/// parent's current canonical generation. No generic store/semantic mutation
/// authority is exposed. Caller holds Live identity then execution/policy gates.
pub(crate) struct OwnInquiryCanonicalCommitterV1<'a> {
    store: &'a mut ContinuityStore,
    address: &'a luca_continuity::NamespaceScope,
    key: &'a [u8; 32],
    authority: &'a RevisionAuthorityTokenV1,
    parent: &'a InitiativeThreadRevisionViewV1,
    used: bool,
}
impl OwnInquiryCanonicalCommitterV1<'_> {
    /// Commit at most one exact native-authored Own child. A failed admission
    /// consumes this writer too; it never replays native work or retries writes.
    pub(crate) fn commit(&mut self, request: InitiativeThreadCommitRequestV1) -> Result<InitiativeThreadCommitReceiptV1, InitiativeThreadStoreErrorV1> {
        if self.used { return Err(InitiativeThreadStoreErrorV1::Denied); }
        self.used = true;
        if request.own_authorship_proof.as_ref().is_none_or(|proof|
            !proof.matches_parent(self.authority, self.parent) || !proof.matches_thread(&request.thread))
        { return Err(InitiativeThreadStoreErrorV1::Denied); }
        commit_in_store(self.store, self.address, self.key, request)
    }
}

/// Native Own birth under the same encrypted parent lease. The callback must
/// hold the exact live owner, execution gate and current operational admission
/// while invoking the restricted committer. No model wait or reentrant identity
/// or continuity acquisition is permitted; ordinary chat never calls this path.
pub(crate) fn consume_current_resident_own_inquiry<T>(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner: &Hex64,
    resident: &Hex64,
    thread_id: &OpaqueId,
    expected_record: &OpaqueId,
    expected_semantic_ref: &Sha256Ref,
    consume: impl FnOnce(&RevisionAuthorityTokenV1, &InitiativeThreadRevisionViewV1, &mut OwnInquiryCanonicalCommitterV1<'_>) -> T,
) -> Result<T, InitiativeThreadStoreErrorV1> {
    let _guard = lifecycle.lock().map_err(|_| InitiativeThreadStoreErrorV1::Unavailable)?;
    let root = existing_root()?;
    let mut state = runtime_state.lock().map_err(|_| InitiativeThreadStoreErrorV1::Unavailable)?;
    let runtime = ready_runtime(&mut state, owner)?;
    let version = runtime.store.active_owner_key_version(owner).map_err(store_error)?;
    let address = resident_notebook_address(owner, resident, version).map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    let key = derive_namespace_key(&root, address.namespace()).map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    let current = read_in_store(&runtime.store, &address, key.as_bytes(), false)?.ok_or(InitiativeThreadStoreErrorV1::Stale)?;
    let view = current.threads.iter().find(|view| &view.thread.thread_id == thread_id).ok_or(InitiativeThreadStoreErrorV1::Stale)?;
    if !view.is_current || &view.record_id != expected_record || &view.canonical_revision_ref != expected_semantic_ref
        || view.pinned_owner_correction || matches!(view.thread.disposition,
            InitiativeDispositionV1::Declined | InitiativeDispositionV1::Retired | InitiativeDispositionV1::Completed)
        || !runtime.store.revalidate_immutable_capture(&current.authority).map_err(store_error)?
    { return Err(InitiativeThreadStoreErrorV1::Stale); }
    let mut commit = OwnInquiryCanonicalCommitterV1 { store:&mut runtime.store,address:&address,key:key.as_bytes(),authority:&current.authority,parent:view,used:false };
    Ok(consume(&current.authority, view, &mut commit))
}

fn ready_runtime<'a>(
    state: &'a mut ContinuityRuntimeState,
    owner: &Hex64,
) -> Result<&'a mut crate::luca::continuity_runtime::ContinuityRuntime, InitiativeThreadStoreErrorV1>
{
    match state {
        ContinuityRuntimeState::Ready(runtime) if &runtime.owner_pubkey == owner => Ok(runtime),
        ContinuityRuntimeState::Ready(_) => Err(InitiativeThreadStoreErrorV1::Denied),
        ContinuityRuntimeState::Degraded(ContinuityRuntimeDegradedReason::KeyLocked) => {
            Err(InitiativeThreadStoreErrorV1::Locked)
        }
        ContinuityRuntimeState::Degraded(ContinuityRuntimeDegradedReason::RestorePending) => {
            Err(InitiativeThreadStoreErrorV1::Stale)
        }
        _ => Err(InitiativeThreadStoreErrorV1::Unavailable),
    }
}

fn store_error(error: ContinuityStoreError) -> InitiativeThreadStoreErrorV1 {
    match error {
        ContinuityStoreError::CompareAndSwapConflict | ContinuityStoreError::LifecycleConflict => {
            InitiativeThreadStoreErrorV1::Stale
        }
        ContinuityStoreError::SnapshotBoundExceeded => {
            InitiativeThreadStoreErrorV1::CapacityExceeded
        }
        ContinuityStoreError::Unavailable => InitiativeThreadStoreErrorV1::Unavailable,
        _ => InitiativeThreadStoreErrorV1::Invalid,
    }
}

fn exact_scope(
    address: &luca_continuity::NamespaceScope,
    request: &InitiativeThreadCommitRequestV1,
) -> Result<(), InitiativeThreadStoreErrorV1> {
    let namespace = address.namespace().as_protocol();
    if namespace.kind != luca_protocol::ContinuityNamespaceKindV1::ResidentPrivate
        || namespace.owner_pubkey != request.owner_pubkey
        || namespace.resident_pubkey.as_ref() != Some(&request.resident_pubkey)
        || request.thread.owner_pubkey != request.owner_pubkey
        || request.thread.resident_pubkey != request.resident_pubkey
        || request.owner_pubkey == request.resident_pubkey
    {
        return Err(InitiativeThreadStoreErrorV1::Denied);
    }
    if !matches!(
        request.actor,
        RevisionActor::Owner | RevisionActor::Resident
    ) || (request.actor == RevisionActor::Owner
        && request.thread.kind != InitiativeThreadKindV1::Shared)
    {
        return Err(InitiativeThreadStoreErrorV1::Denied);
    }
    if request.canonical_source_clean
        && (request.actor != RevisionActor::Resident
            || request.thread.kind != InitiativeThreadKindV1::Shared
            || request.thread.source_event_ids.is_empty()
            || request.thread.source_refs.len() != request.thread.source_event_ids.len()
            || request.thread.source_refs.iter().zip(&request.thread.source_event_ids)
                .any(|(reference,event)| reference.as_str().strip_prefix("sha256:") != Some(event.as_str())))
    {
        return Err(InitiativeThreadStoreErrorV1::Denied);
    }
    if request.own_authorship_proof.as_ref().is_some_and(|proof|
        request.actor != RevisionActor::Resident || request.expected_head.is_some()
            || request.canonical_source_clean || !proof.matches_thread(&request.thread))
    {
        return Err(InitiativeThreadStoreErrorV1::Denied);
    }
    match (&request.completion_cause, request.thread.disposition) {
        (
            Some(InitiativeTransitionCauseV1::VerifiedCompletion { checkpoint_ref }),
            InitiativeDispositionV1::Completed,
        ) if request
            .thread
            .source_refs
            .binary_search(checkpoint_ref)
            .is_ok() => {}
        (None, disposition) if disposition != InitiativeDispositionV1::Completed => {}
        _ => return Err(InitiativeThreadStoreErrorV1::Denied),
    }
    request
        .thread
        .validate()
        .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)
}

fn record_id(
    request: &InitiativeThreadCommitRequestV1,
) -> Result<OpaqueId, InitiativeThreadStoreErrorV1> {
    if request.expected_head.is_none() {
        return Ok(request.thread.thread_id.clone());
    }
    let digest = canonical_sha256(&serde_json::json!({
        "domain": "polyphonic.initiative-thread.revision-id.v1",
        "owner_pubkey": request.owner_pubkey,
        "resident_pubkey": request.resident_pubkey,
        "thread_id": request.thread.thread_id,
        "request_id": request.request_id,
    }))
    .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    OpaqueId::parse(format!("initiative-revision-{digest}"))
        .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)
}

/// Decode a marked body using exact encrypted namespace, root and revision metadata.
/// Unmarked legacy records return None; marked malformed data never falls back.
pub(crate) fn decode_initiative_thread_material(
    record: &luca_protocol::ContinuityRecordV1,
    lineage_root_id: &OpaqueId,
    material: &RetrievalMaterialV1,
) -> Result<Option<InitiativeSemanticThreadV1>, InitiativeThreadStoreErrorV1> {
    if !material
        .tags()
        .iter()
        .any(|tag| tag.as_str() == INITIATIVE_THREAD_TAG)
    {
        return Ok(None);
    }
    let thread: InitiativeSemanticThreadV1 =
        serde_json::from_str(material.body()).map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    if record.record_type.as_str() != "open-thread"
        || record.namespace.kind != luca_protocol::ContinuityNamespaceKindV1::ResidentPrivate
        || record.namespace.owner_pubkey != thread.owner_pubkey
        || record.namespace.resident_pubkey.as_ref() != Some(&thread.resident_pubkey)
        || &thread.thread_id != lineage_root_id
        || record.revision != thread.revision
        || record.created_at != thread.updated_at
        || record.provenance_refs != thread.source_refs
        || material.provenance_refs() != thread.source_refs.as_slice()
        || !matches!(record.author_kind.as_str(), "owner" | "resident")
        || (material.tags().iter().any(|tag|tag.as_str() == OWN_NATIVE_AUTHORED_TAG)
            && (thread.kind != InitiativeThreadKindV1::Own || record.author_kind.as_str() != "resident"
                || !thread.source_event_ids.is_empty() || thread.source_refs.len() < 2))
    {
        return Err(InitiativeThreadStoreErrorV1::Invalid);
    }
    Ok(Some(thread))
}

fn decode_record(
    record: &luca_protocol::ContinuityRecordV1,
    root: &OpaqueId,
    key: &[u8; 32],
) -> Result<Option<InitiativeSemanticThreadV1>, InitiativeThreadStoreErrorV1> {
    let material = decrypt_record(record, key)
        .and_then(RetrievalMaterialV1::decode)
        .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    decode_initiative_thread_material(record, root, &material)
}

fn source_clean_mark(
    record: &luca_protocol::ContinuityRecordV1,
    key: &[u8; 32],
) -> Result<bool, InitiativeThreadStoreErrorV1> {
    let material = decrypt_record(record, key).and_then(RetrievalMaterialV1::decode)
        .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    Ok(material.tags().iter().any(|tag| tag.as_str() == SOURCE_CLEAN_HANDOFF_TAG))
}

fn own_authorship_mark(record: &luca_protocol::ContinuityRecordV1, key: &[u8; 32]) -> Result<bool, InitiativeThreadStoreErrorV1> {
    let material = decrypt_record(record, key).and_then(RetrievalMaterialV1::decode)
        .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    Ok(material.tags().iter().any(|tag|tag.as_str() == OWN_NATIVE_AUTHORED_TAG))
}

fn commit_in_store(
    store: &mut ContinuityStore,
    address: &luca_continuity::NamespaceScope,
    key: &[u8; 32],
    request: InitiativeThreadCommitRequestV1,
) -> Result<InitiativeThreadCommitReceiptV1, InitiativeThreadStoreErrorV1> {
    exact_scope(address, &request)?;
    let generation = store
        .load_revision_generation(&request.owner_pubkey)
        .map_err(store_error)?;
    if let Some(proof) = &request.own_authorship_proof {
        if !store.revalidate_immutable_capture(proof.authority()).map_err(store_error)? {
            return Err(InitiativeThreadStoreErrorV1::Stale);
        }
        let actual = read_in_store(store, address, key, false)?.ok_or(InitiativeThreadStoreErrorV1::Stale)?;
        if !actual.threads.iter().any(|parent|proof.matches_parent(&actual.authority, parent)) {
            return Err(InitiativeThreadStoreErrorV1::Stale);
        }
    }
    let id = record_id(&request)?;
    let lineage = generation.as_ref().and_then(|g| {
        g.snapshot
            .lineages
            .iter()
            .find(|l| l.lineage_root_id == request.thread.thread_id)
    });
    if lineage.is_some_and(|l| {
        l.namespace != *address.namespace().as_protocol()
            || l.scope != *address.as_protocol()
            || l.record_type.as_str() != "open-thread"
            || l.lifecycle != RevisionLifecycle::Active
    }) {
        return Err(InitiativeThreadStoreErrorV1::Denied);
    }
    if let Some(existing) = generation
        .as_ref()
        .and_then(|g| g.snapshot.records.iter().find(|r| r.record_id == id))
    {
        if lineage.and_then(|l| l.active_head_record_id.as_ref()) != Some(&id) {
            return Err(InitiativeThreadStoreErrorV1::Stale);
        }
        let old = decode_record(existing, &request.thread.thread_id, key)?
            .ok_or(InitiativeThreadStoreErrorV1::Invalid)?;
        let actor = if request.actor == RevisionActor::Owner {
            "owner"
        } else {
            "resident"
        };
        if old != request.thread
            || existing.author_kind.as_str() != actor
            || existing.predecessor_record_id.as_ref()
                != request.expected_head.as_ref().map(|h| &h.record_id)
        {
            return Err(InitiativeThreadStoreErrorV1::Invalid);
        }
        if request.own_authorship_proof.is_some() && !own_authorship_mark(existing, key)? {
            return Err(InitiativeThreadStoreErrorV1::Denied);
        }
        if let Some(expected) = &request.expected_head {
            if expected.revision.get().checked_add(1) != Some(old.revision.get()) {
                return Err(InitiativeThreadStoreErrorV1::Stale);
            }
        }
        return receipt(&request.thread, id, true);
    }
    let mut clean_mark = request.canonical_source_clean;
    let mut own_mark = request.own_authorship_proof.is_some();
    let (operation, root_id, head_id, revision) = match (&request.expected_head, lineage) {
        (None, None) if request.thread.revision.get() == 0 => {
            revision_coordinates(generation.as_ref(), None, id.clone())
                .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?
        }
        (Some(expected), Some(lineage)) => {
            if lineage.pinned_owner_correction && request.actor != RevisionActor::Owner {
                return Err(InitiativeThreadStoreErrorV1::Stale);
            }
            if lineage.active_head_record_id.as_ref() != Some(&expected.record_id) {
                return Err(InitiativeThreadStoreErrorV1::Stale);
            }
            let current_record = generation
                .as_ref()
                .and_then(|g| {
                    g.snapshot
                        .records
                        .iter()
                        .find(|r| r.record_id == expected.record_id)
                })
                .ok_or(InitiativeThreadStoreErrorV1::Invalid)?;
            if current_record.revision != expected.revision {
                return Err(InitiativeThreadStoreErrorV1::Stale);
            }
            let current = decode_record(current_record, &request.thread.thread_id, key)?
                .ok_or(InitiativeThreadStoreErrorV1::Invalid)?;
            // A disposition-only edit cannot erase the original independently
            // verified birthmark or make later conversations strand this root.
            clean_mark |= current.body == request.thread.body
                && current.source_refs == request.thread.source_refs
                && current.source_event_ids == request.thread.source_event_ids
                && source_clean_mark(current_record, key)?;
            own_mark |= request.actor == RevisionActor::Resident
                && current.kind == InitiativeThreadKindV1::Own
                && current.body == request.thread.body && current.source_refs == request.thread.source_refs
                && current.source_event_ids == request.thread.source_event_ids
                && own_authorship_mark(current_record, key)?;
            request
                .thread
                .validate_successor_of(&current)
                .map_err(|_| InitiativeThreadStoreErrorV1::Stale)?;
            disposition_authority(&current, &request)?;
            let (operation, root, head, revision) =
                revision_coordinates(generation.as_ref(), Some(lineage), id.clone())
                    .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
            (
                if request.actor == RevisionActor::Owner {
                    RevisionOperation::OwnerCorrection
                } else {
                    operation
                },
                root,
                head,
                revision,
            )
        }
        _ => return Err(InitiativeThreadStoreErrorV1::Stale),
    };
    if request.thread.revision != revision {
        return Err(InitiativeThreadStoreErrorV1::Stale);
    }
    let mut tags = vec![INITIATIVE_THREAD_TAG.into(), "open-thread".into()];
    if clean_mark { tags.push(SOURCE_CLEAN_HANDOFF_TAG.into()); }
    if own_mark { tags.push(OWN_NATIVE_AUTHORED_TAG.into()); }
    let mut prepared = prepare_revision(
        address,
        address.namespace().as_protocol().key_version,
        key,
        RevisionMaterial {
            record_type: "open-thread",
            lineage_root_id: root_id,
            record_id: id.clone(),
            expected_head_record_id: head_id,
            revision,
            operation,
            actor: request.actor,
            created_at: request.thread.updated_at.clone(),
            body: serde_json::to_string(&request.thread)
                .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?,
            tags,
            provenance_refs: request.thread.source_refs.clone(),
            request_domain: "polyphonic.initiative-thread.commit.v1",
            request_id: &request.request_id,
        },
    )
    .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    // General canonical refs are provenance, not signed source events. The
    // common helper assumes event-only notebook provenance, so narrow this
    // exact request and rederive its existing complete authority binding.
    prepared.request.signed_source_event_refs = request
        .thread
        .source_event_ids
        .iter()
        .map(|event| source_ref(event).ok_or(InitiativeThreadStoreErrorV1::Invalid))
        .collect::<Result<Vec<_>, _>>()?;
    let successor = prepared
        .request
        .successor
        .as_ref()
        .ok_or(InitiativeThreadStoreErrorV1::Invalid)?;
    prepared.request.idempotency_key = derive_revision_idempotency_key(
        &successor.namespace,
        &successor.scope,
        &successor.record_type,
        successor.key_version,
        &prepared.request,
    )
    .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    let expectation = generation
        .as_ref()
        .map(|g| AuthorityExpectationV1::Existing(g.token.clone()))
        .unwrap_or_else(|| AuthorityExpectationV1::UninitializedOwner {
            owner_pubkey: request.owner_pubkey.clone(),
            active_root_key_version: address.namespace().as_protocol().key_version,
        });
    let applied = store
        .apply_revision_transition_cas(&expectation, prepared.request)
        .map_err(store_error)?;
    receipt(&request.thread, id, applied.replayed)
}

fn disposition_authority(
    current: &InitiativeSemanticThreadV1,
    request: &InitiativeThreadCommitRequestV1,
) -> Result<(), InitiativeThreadStoreErrorV1> {
    if current.disposition == InitiativeDispositionV1::Completed {
        return Err(InitiativeThreadStoreErrorV1::Denied);
    }
    if matches!(
        current.disposition,
        InitiativeDispositionV1::Declined | InitiativeDispositionV1::Retired
    ) {
        let reopen_actor = match current.kind {
            InitiativeThreadKindV1::Shared => RevisionActor::Owner,
            InitiativeThreadKindV1::Own => RevisionActor::Resident,
        };
        if request.actor != reopen_actor
            || request.thread.disposition != InitiativeDispositionV1::Carried
            || !request
                .thread
                .source_refs
                .iter()
                .any(|source| !current.source_refs.contains(source))
        {
            return Err(InitiativeThreadStoreErrorV1::Denied);
        }
    }
    if request.thread.disposition == InitiativeDispositionV1::Retired
        && request.thread.kind == InitiativeThreadKindV1::Shared
        && request.actor != RevisionActor::Owner
    {
        return Err(InitiativeThreadStoreErrorV1::Denied);
    }
    Ok(())
}

fn receipt(
    thread: &InitiativeSemanticThreadV1,
    id: OpaqueId,
    replayed: bool,
) -> Result<InitiativeThreadCommitReceiptV1, InitiativeThreadStoreErrorV1> {
    Ok(InitiativeThreadCommitReceiptV1 {
        resident_pubkey: thread.resident_pubkey.clone(),
        thread_id: thread.thread_id.clone(),
        record_id: id,
        revision: thread.revision,
        canonical_thread_ref: derive_initiative_thread_ref(
            &thread.owner_pubkey,
            &thread.resident_pubkey,
            &thread.thread_id,
        )
        .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?,
        canonical_revision_ref: thread
            .revision_ref()
            .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?,
        replayed,
    })
}

fn read_in_store(
    store: &ContinuityStore,
    address: &luca_continuity::NamespaceScope,
    key: &[u8; 32],
    include_history: bool,
) -> Result<Option<InitiativeThreadReadSnapshotV1>, InitiativeThreadStoreErrorV1> {
    let Some(generation) = store
        .load_revision_generation(&address.namespace().as_protocol().owner_pubkey)
        .map_err(store_error)?
    else {
        return Ok(None);
    };
    let mut threads = Vec::new();
    for lineage in generation.snapshot.lineages.iter().filter(|l| {
        l.namespace == *address.namespace().as_protocol()
            && l.scope == *address.as_protocol()
            && l.record_type.as_str() == "open-thread"
            && l.lifecycle != RevisionLifecycle::Forgotten
    }) {
        let ids = if include_history {
            lineage.record_ids.clone()
        } else {
            lineage.active_head_record_id.iter().cloned().collect()
        };
        for id in ids {
            let record = generation
                .snapshot
                .records
                .iter()
                .find(|r| r.record_id == id)
                .ok_or(InitiativeThreadStoreErrorV1::Invalid)?;
            let Some(thread) = decode_record(record, &lineage.lineage_root_id, key)? else {
                continue;
            };
            threads.push(InitiativeThreadRevisionViewV1 {
                record_id: id.clone(),
                current_head_record_id: lineage.active_head_record_id.clone(),
                is_current: lineage.active_head_record_id.as_ref() == Some(&id),
                pinned_owner_correction: lineage.pinned_owner_correction,
                author_kind: record.author_kind.clone(),
                canonical_source_clean: source_clean_mark(record, key)?,
                canonical_own_authorship: own_authorship_mark(record, key)?,
                canonical_revision_ref: thread
                    .revision_ref()
                    .map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?,
                thread,
            });
        }
    }
    threads.sort_by(|a, b| {
        a.thread
            .thread_id
            .cmp(&b.thread.thread_id)
            .then_with(|| a.thread.revision.cmp(&b.thread.revision))
    });
    if threads.is_empty() {
        Ok(None)
    } else {
        Ok(Some(InitiativeThreadReadSnapshotV1 {
            authority: generation.token,
            threads,
        }))
    }
}

#[cfg(test)]
#[path = "initiative_threads_tests.rs"]
mod tests;
