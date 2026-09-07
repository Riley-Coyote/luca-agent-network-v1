use super::*;
use crate::luca::continuity_revision_authority::{
    ConnectedIndexPurgeTargetV1, MAX_CONNECTED_INDEX_PURGE_TRANSITIONS,
};
use luca_continuity::PurgeExecutionStatusV1;
use luca_protocol::{
    ConnectedBrainSourceStatusV1, ConnectedBrainSourceV1, RepositoryWorkGrantStateV1,
    RepositoryWorkGrantV1,
};

use super::connected::{
    catalog_from_generation, connected_generation, connected_source_by_id, ensure_connected_grants,
    find_connected_manifest, find_repository_grant, repository_grant_lineage_id,
    restore_connected_grants, ConnectedBrainResidentAuthorityV1, CONNECTED_INDEX_PAGE_RECORD,
    CONNECTED_SOURCE_RECORD, REPOSITORY_WORK_GRANT_RECORD,
};

pub(crate) fn set_connected_source_status(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
    source_id: &OpaqueId,
    status: ConnectedBrainSourceStatusV1,
) -> Result<(), OwnerBrainStoreError> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let root = load_root_key()?;
    let mut state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime_mut(&mut state, owner_pubkey)?;
    set_connected_status_with_runtime(&root, runtime, source_id, status)
}

pub(crate) fn disconnect_source(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
    source_id: &OpaqueId,
) -> Result<(), OwnerBrainStoreError> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let root = load_root_key()?;
    let mut state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime_mut(&mut state, owner_pubkey)?;
    disconnect_source_with_runtime(&root, runtime, owner_pubkey, source_id)
}

pub(super) fn disconnect_source_with_runtime(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    owner_pubkey: &Hex64,
    source_id: &OpaqueId,
) -> Result<(), OwnerBrainStoreError> {
    let manifest =
        connected_source_by_id(root, runtime, source_id)?.ok_or(OwnerBrainStoreError::Invalid)?;
    if manifest.source.status == ConnectedBrainSourceStatusV1::Disconnected {
        return purge_orphaned_index_pages(runtime, owner_pubkey, source_id, &[]);
    }

    // Status is the first fail-closed transition: retrieval and broker access
    // stop before any grant or index cleanup can fail.
    set_connected_status_with_runtime(
        root,
        runtime,
        source_id,
        ConnectedBrainSourceStatusV1::Disconnected,
    )?;
    revoke_connected_grants(root, runtime, &manifest.source)?;
    purge_orphaned_index_pages(runtime, owner_pubkey, source_id, &[])
}

pub(crate) fn reconfirm_connected_source(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
    source_id: &OpaqueId,
    authority: ConnectedBrainResidentAuthorityV1,
) -> Result<(), OwnerBrainStoreError> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let root = load_root_key()?;
    let mut state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime_mut(&mut state, owner_pubkey)?;
    let manifest =
        connected_source_by_id(&root, runtime, source_id)?.ok_or(OwnerBrainStoreError::Invalid)?;
    if manifest.source.status == ConnectedBrainSourceStatusV1::Disconnected {
        return Err(OwnerBrainStoreError::Invalid);
    }
    restore_connected_grants(&root, runtime, &manifest.source, &authority)
}

pub(crate) fn revoke_connected_resident(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
    source_id: &OpaqueId,
    resident_pubkey: Hex64,
) -> Result<(), OwnerBrainStoreError> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let root = load_root_key()?;
    let mut state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime_mut(&mut state, owner_pubkey)?;
    revoke_connected_resident_with_runtime(&root, runtime, source_id, resident_pubkey)
}

pub(super) fn revoke_connected_resident_with_runtime(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    source_id: &OpaqueId,
    resident_pubkey: Hex64,
) -> Result<(), OwnerBrainStoreError> {
    let manifest =
        connected_source_by_id(root, runtime, source_id)?.ok_or(OwnerBrainStoreError::Invalid)?;
    if manifest.source.status == ConnectedBrainSourceStatusV1::Disconnected {
        return Err(OwnerBrainStoreError::Invalid);
    }
    revoke_recall_grant(root, runtime, &manifest.source, resident_pubkey.clone())?;
    if manifest.source.source_kind == luca_protocol::ConnectedBrainSourceKindV1::Repository {
        revoke_repository_grant(root, runtime, &manifest.source, resident_pubkey)?;
    }
    Ok(())
}

pub(crate) fn provision_connected_resident(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: Hex64,
    authority: ConnectedBrainResidentAuthorityV1,
) -> Result<(), OwnerBrainStoreError> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let root = load_root_key()?;
    let mut state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime_mut(&mut state, &owner_pubkey)?;
    let Some((generation, namespace, namespace_key)) = connected_generation(&root, runtime)? else {
        return Ok(());
    };
    let catalog = catalog_from_generation(&generation, &namespace, namespace_key.as_bytes())?;
    for source in catalog
        .sources
        .iter()
        .filter(|source| source.source.status == ConnectedBrainSourceStatusV1::Current)
    {
        ensure_connected_grants(&root, runtime, &source.source, &authority)?;
    }
    Ok(())
}

pub(super) fn purge_orphaned_index_pages(
    runtime: &mut ContinuityRuntime,
    owner: &Hex64,
    source_id: &OpaqueId,
    retained_lineages: &[OpaqueId],
) -> Result<(), OwnerBrainStoreError> {
    if runtime.owner_pubkey != *owner {
        return Err(OwnerBrainStoreError::Invalid);
    }
    let generation = runtime
        .store
        .load_revision_generation(owner)
        .map_err(map_store_read_error)?
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let retained = retained_lineages.iter().collect::<BTreeSet<_>>();
    let mut purge = generation
        .snapshot
        .lineages
        .iter()
        .filter(|lineage| {
            lineage.record_type.as_str() == CONNECTED_INDEX_PAGE_RECORD
                && lineage.scope.source_id.as_ref() == Some(source_id)
                && !retained.contains(&lineage.lineage_root_id)
                && lineage
                    .purge_execution
                    .as_ref()
                    .is_none_or(|state| state.status != PurgeExecutionStatusV1::Completed)
        })
        .collect::<Vec<_>>();
    purge.sort_by(|left, right| left.lineage_root_id.cmp(&right.lineage_root_id));
    let mut authorize = Vec::new();
    let mut start = Vec::new();
    let mut complete = Vec::new();
    for lineage in purge {
        let target = ConnectedIndexPurgeTargetV1 {
            lineage_root_id: lineage.lineage_root_id.clone(),
            expected_head_record_id: lineage.lineage_head_record_id.clone(),
        };
        let status = if lineage.lifecycle == RevisionLifecycle::Forgotten {
            lineage
                .purge_execution
                .as_ref()
                .ok_or(OwnerBrainStoreError::Invalid)?
                .status
        } else {
            authorize.push(target.clone());
            PurgeExecutionStatusV1::Authorized
        };
        if matches!(
            status,
            PurgeExecutionStatusV1::Authorized | PurgeExecutionStatusV1::Failed
        ) {
            start.push(target.clone());
        }
        complete.push(target);
    }
    let mut token = generation.token;
    drop(generation.snapshot);
    // Each phase is independently durable. A failed chunk leaves its complete
    // predecessor phase recoverable; a restart replans from the stored states.
    // Carry only admitted IDs/heads across chunks, never a cached ledger.
    for (next, targets) in [
        (PurgeExecutionStatusV1::Authorized, authorize),
        (PurgeExecutionStatusV1::InProgress, start),
        (PurgeExecutionStatusV1::Completed, complete),
    ] {
        for batch in targets.chunks(MAX_CONNECTED_INDEX_PURGE_TRANSITIONS) {
            token = runtime
                .store
                .purge_connected_index_batch_cas(
                    &AuthorityExpectationV1::Existing(token),
                    source_id,
                    batch,
                    next,
                )
                .map_err(map_store_write_error)?;
        }
    }
    Ok(())
}

fn set_connected_status_with_runtime(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    source_id: &OpaqueId,
    status: ConnectedBrainSourceStatusV1,
) -> Result<(), OwnerBrainStoreError> {
    let owner = runtime.owner_pubkey.clone();
    let key_version = runtime
        .store
        .active_owner_key_version(&owner)
        .map_err(map_store_read_error)?;
    let namespace = owner_brain_namespace(&owner, key_version)?;
    let namespace_key =
        derive_namespace_key(root, &namespace).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let generation = runtime
        .store
        .load_revision_generation(&owner)
        .map_err(map_store_read_error)?
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let mut manifest =
        find_connected_manifest(&generation, &namespace, namespace_key.as_bytes(), source_id)?
            .ok_or(OwnerBrainStoreError::Invalid)?;
    if manifest.source.status == status {
        return Ok(());
    }
    manifest.source.status = status;
    manifest.source.updated_at =
        canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    manifest.validate()?;
    let address = owner_brain_source_address(namespace, source_id.clone())?;
    let content_ref = sha_ref_for(&manifest)?;
    let operation_id = digest_id(
        "connected-status-operation",
        &[
            source_id.as_str(),
            status_value(status),
            content_ref.as_str(),
        ],
    )?;
    let request = prepare_revision(
        Some(&generation),
        &address,
        key_version,
        namespace_key.as_bytes(),
        CONNECTED_SOURCE_RECORD,
        source_id.clone(),
        &content_ref,
        &operation_id,
        manifest.source.updated_at.clone(),
        &manifest,
    )?;
    runtime
        .store
        .apply_connected_brain_cas(
            &AuthorityExpectationV1::Existing(generation.token),
            vec![request],
        )
        .map_err(map_store_write_error)?;
    Ok(())
}

fn revoke_connected_grants(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    source: &ConnectedBrainSourceV1,
) -> Result<(), OwnerBrainStoreError> {
    let key_version = runtime
        .store
        .active_owner_key_version(&source.owner_pubkey)
        .map_err(map_store_read_error)?;
    let namespace = owner_brain_namespace(&source.owner_pubkey, key_version)?;
    let namespace_key =
        derive_namespace_key(root, &namespace).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let generation = runtime
        .store
        .load_revision_generation(&source.owner_pubkey)
        .map_err(map_store_read_error)?
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let address = owner_brain_source_address(namespace, source.source_id.clone())?;
    let recall_residents = generation
        .snapshot
        .lineages
        .iter()
        .filter(|lineage| {
            lineage.scope == *address.as_protocol()
                && lineage.record_type.as_str() == OWNER_BRAIN_GRANT_RECORD
                && lineage.lifecycle == RevisionLifecycle::Active
        })
        .map(|lineage| {
            let grant: BrainGrantV1 = decrypt_active_body(
                &generation,
                lineage
                    .active_head_record_id
                    .as_ref()
                    .ok_or(OwnerBrainStoreError::Invalid)?,
                namespace_key.as_bytes(),
            )?;
            Ok(grant.resident_pubkey)
        })
        .collect::<Result<Vec<_>, OwnerBrainStoreError>>()?;
    for resident in recall_residents {
        revoke_recall_grant(root, runtime, source, resident)?;
    }

    let generation = runtime
        .store
        .load_revision_generation(&source.owner_pubkey)
        .map_err(map_store_read_error)?
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let repository_residents = generation
        .snapshot
        .lineages
        .iter()
        .filter(|lineage| {
            lineage.scope == *address.as_protocol()
                && lineage.record_type.as_str() == REPOSITORY_WORK_GRANT_RECORD
                && lineage.lifecycle == RevisionLifecycle::Active
        })
        .map(|lineage| {
            let grant: RepositoryWorkGrantV1 = decrypt_active_body(
                &generation,
                lineage
                    .active_head_record_id
                    .as_ref()
                    .ok_or(OwnerBrainStoreError::Invalid)?,
                namespace_key.as_bytes(),
            )?;
            Ok(grant.resident_pubkey)
        })
        .collect::<Result<Vec<_>, OwnerBrainStoreError>>()?;
    for resident in repository_residents {
        revoke_repository_grant(root, runtime, source, resident)?;
    }
    Ok(())
}

fn revoke_recall_grant(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    source: &ConnectedBrainSourceV1,
    resident: Hex64,
) -> Result<(), OwnerBrainStoreError> {
    let key_version = runtime
        .store
        .active_owner_key_version(&source.owner_pubkey)
        .map_err(map_store_read_error)?;
    let namespace = owner_brain_namespace(&source.owner_pubkey, key_version)?;
    let namespace_key =
        derive_namespace_key(root, &namespace).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let generation = runtime
        .store
        .load_revision_generation(&source.owner_pubkey)
        .map_err(map_store_read_error)?
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let address = owner_brain_source_address(namespace, source.source_id.clone())?;
    let grant_id = grant_lineage_id(&source.source_id, &resident)?;
    let mut grant = find_grant(
        &generation,
        &address,
        namespace_key.as_bytes(),
        &grant_id,
        &resident,
    )?
    .ok_or(OwnerBrainStoreError::Invalid)?;
    if grant.state == BrainGrantStateV1::Revoked {
        return Ok(());
    }
    let now = canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    grant.state = BrainGrantStateV1::Revoked;
    grant.grant_version = SafeU53::new(
        grant
            .grant_version
            .get()
            .checked_add(1)
            .ok_or(OwnerBrainStoreError::Invalid)?,
    )
    .map_err(|_| OwnerBrainStoreError::Invalid)?;
    grant.revoked_at = Some(now.clone());
    grant
        .validate()
        .map_err(|_| OwnerBrainStoreError::Invalid)?;
    let content_ref = sha_ref_for(&grant)?;
    let operation_id = digest_id(
        "connected-recall-revoke",
        &[grant_id.as_str(), content_ref.as_str()],
    )?;
    let request = prepare_revision(
        Some(&generation),
        &address,
        key_version,
        namespace_key.as_bytes(),
        OWNER_BRAIN_GRANT_RECORD,
        grant_id,
        &content_ref,
        &operation_id,
        now,
        &grant,
    )?;
    runtime
        .store
        .apply_owner_brain_grant_cas(&AuthorityExpectationV1::Existing(generation.token), request)
        .map_err(map_store_write_error)?;
    Ok(())
}

fn revoke_repository_grant(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    source: &ConnectedBrainSourceV1,
    resident: Hex64,
) -> Result<(), OwnerBrainStoreError> {
    let key_version = runtime
        .store
        .active_owner_key_version(&source.owner_pubkey)
        .map_err(map_store_read_error)?;
    let namespace = owner_brain_namespace(&source.owner_pubkey, key_version)?;
    let namespace_key =
        derive_namespace_key(root, &namespace).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let generation = runtime
        .store
        .load_revision_generation(&source.owner_pubkey)
        .map_err(map_store_read_error)?
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let address = owner_brain_source_address(namespace, source.source_id.clone())?;
    let grant_id = repository_grant_lineage_id(&source.source_id, &resident)?;
    let mut grant =
        find_repository_grant(&generation, &address, namespace_key.as_bytes(), &grant_id)?
            .ok_or(OwnerBrainStoreError::Invalid)?;
    if grant.state == RepositoryWorkGrantStateV1::Revoked {
        return Ok(());
    }
    let now = canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    grant.state = RepositoryWorkGrantStateV1::Revoked;
    grant.updated_at = now.clone();
    grant
        .validate()
        .map_err(|_| OwnerBrainStoreError::Invalid)?;
    let content_ref = sha_ref_for(&grant)?;
    let operation_id = digest_id(
        "repository-work-revoke",
        &[grant_id.as_str(), content_ref.as_str()],
    )?;
    let request = prepare_revision(
        Some(&generation),
        &address,
        key_version,
        namespace_key.as_bytes(),
        REPOSITORY_WORK_GRANT_RECORD,
        grant_id,
        &content_ref,
        &operation_id,
        now,
        &grant,
    )?;
    runtime
        .store
        .apply_connected_brain_cas(
            &AuthorityExpectationV1::Existing(generation.token),
            vec![request],
        )
        .map_err(map_store_write_error)?;
    Ok(())
}

fn status_value(status: ConnectedBrainSourceStatusV1) -> &'static str {
    match status {
        ConnectedBrainSourceStatusV1::Connecting => "connecting",
        ConnectedBrainSourceStatusV1::Current => "current",
        ConnectedBrainSourceStatusV1::NeedsAttention => "needs-attention",
        ConnectedBrainSourceStatusV1::Unavailable => "unavailable",
        ConnectedBrainSourceStatusV1::Disconnected => "disconnected",
    }
}
