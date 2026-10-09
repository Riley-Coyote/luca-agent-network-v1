//! Exact body-free synchronization after a canonical disposition CAS.
//! Closed heads are allowed only here, never through native/context admission.
use super::*;

/// Current canonical coordinates only: no semantic body or source payload can
/// escape this settlement read or be reused as native framing material.
pub(crate) struct InitiativeThreadSettlementV1 {
    pub(crate) thread_id: OpaqueId,
    pub(crate) kind: InitiativeThreadKindV1,
    pub(crate) disposition: InitiativeDispositionV1,
    pub(crate) eligible_after: Option<luca_protocol::CanonicalTimestamp>,
    pub(crate) canonical_thread_ref: Sha256Ref,
    pub(crate) canonical_revision_ref: Sha256Ref,
}

/// Lend exact current coordinates under the canonical lifecycle generation for
/// local ledger sync only. Normal consume_current_resident_initiative_thread
/// still rejects closed heads; this API exposes no body for models or Wake.
pub(crate) fn consume_current_resident_initiative_settlement<T>(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner: &Hex64,
    resident: &Hex64,
    thread_id: &OpaqueId,
    expected_record: &OpaqueId,
    expected_semantic_ref: &Sha256Ref,
    consume: impl FnOnce(&RevisionAuthorityTokenV1, &InitiativeThreadSettlementV1) -> T,
) -> Result<T, InitiativeThreadStoreErrorV1> {
    let _guard = lifecycle.lock().map_err(|_| InitiativeThreadStoreErrorV1::Unavailable)?;
    let root = existing_root()?;
    let mut state = runtime_state.lock().map_err(|_| InitiativeThreadStoreErrorV1::Unavailable)?;
    let runtime = ready_runtime(&mut state, owner)?;
    let version = runtime.store.active_owner_key_version(owner).map_err(store_error)?;
    let address = resident_notebook_address(owner, resident, version).map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    let key = derive_namespace_key(&root, address.namespace()).map_err(|_| InitiativeThreadStoreErrorV1::Invalid)?;
    let (authority, coordinates) = settlement_in_store(&runtime.store, &address, key.as_bytes(), thread_id, expected_record, expected_semantic_ref)?;
    Ok(consume(&authority, &coordinates))
}

fn settlement_in_store(
    store: &ContinuityStore, address: &luca_continuity::NamespaceScope, key: &[u8;32],
    thread_id: &OpaqueId, expected_record: &OpaqueId, expected_semantic_ref: &Sha256Ref,
) -> Result<(RevisionAuthorityTokenV1, InitiativeThreadSettlementV1), InitiativeThreadStoreErrorV1> {
    let current = read_in_store(store, address, key, false)?.ok_or(InitiativeThreadStoreErrorV1::Stale)?;
    let view = current.threads.iter().find(|view| &view.thread.thread_id == thread_id).ok_or(InitiativeThreadStoreErrorV1::Stale)?;
    if !view.is_current || &view.record_id != expected_record || &view.canonical_revision_ref != expected_semantic_ref
        || !store.revalidate_immutable_capture(&current.authority).map_err(store_error)?
    { return Err(InitiativeThreadStoreErrorV1::Stale); }
    let coordinates = InitiativeThreadSettlementV1 {
        thread_id: view.thread.thread_id.clone(),kind:view.thread.kind,disposition:view.thread.disposition,eligible_after:view.thread.eligible_after.clone(),
        canonical_thread_ref:derive_initiative_thread_ref(&view.thread.owner_pubkey,&view.thread.resident_pubkey,&view.thread.thread_id).map_err(|_|InitiativeThreadStoreErrorV1::Invalid)?,
        canonical_revision_ref:view.canonical_revision_ref.clone(),
    };
    Ok((current.authority,coordinates))
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::tests::{address, open, request, successor, thread, KEY};
    #[test]
    fn exact_closed_settlement_exposes_only_current_coordinates_not_an_old_head() {
        let temp=tempfile::tempdir().unwrap();let mut store=open(&temp);let address=address();
        let original=thread("shared:let-it-go-settlement");
        let first=commit_in_store(&mut store,&address,&KEY,request(original.clone(),"birth",RevisionActor::Resident,None)).unwrap();
        let retired=successor(original.clone(),InitiativeDispositionV1::Retired);
        let last=commit_in_store(&mut store,&address,&KEY,request(retired,"let-it-go",RevisionActor::Owner,Some(&first))).unwrap();
        let (_,coordinates)=settlement_in_store(&store,&address,&KEY,&original.thread_id,&last.record_id,&last.canonical_revision_ref).unwrap();
        assert_eq!(coordinates.disposition,InitiativeDispositionV1::Retired);
        assert_eq!(coordinates.canonical_revision_ref,last.canonical_revision_ref);
        assert!(settlement_in_store(&store,&address,&KEY,&original.thread_id,&first.record_id,&first.canonical_revision_ref).is_err());
    }
}
