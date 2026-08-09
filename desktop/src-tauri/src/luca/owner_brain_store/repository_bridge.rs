use super::*;
use luca_protocol::{
    ConnectedBrainSourceKindV1, ConnectedBrainSourceStatusV1, RepositoryWorkGrantStateV1,
    RepositoryWorkGrantV1,
};

use super::connected::{
    connected_generation, find_connected_binding, find_connected_manifest,
    REPOSITORY_WORK_GRANT_RECORD,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AuthorizedRepositoryV1 {
    pub source_id: OpaqueId,
    pub display_name: String,
}

pub(crate) fn read_authorized_repositories(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
    resident_pubkey: &Hex64,
    binding_ref: &Sha256Ref,
) -> Result<Vec<AuthorizedRepositoryV1>, OwnerBrainStoreError> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let root = load_root_key()?;
    let state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime(&state, owner_pubkey)?;
    let Some((generation, namespace, namespace_key)) = connected_generation(&root, runtime)? else {
        return Ok(Vec::new());
    };
    authorized_repositories_from_generation(
        &generation,
        &namespace,
        namespace_key.as_bytes(),
        resident_pubkey,
        binding_ref,
    )
}

pub(crate) fn resolve_authorized_repository_root(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
    resident_pubkey: &Hex64,
    binding_ref: &Sha256Ref,
    source_id: &OpaqueId,
) -> Result<PathBuf, OwnerBrainStoreError> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let root = load_root_key()?;
    let state = runtime_state
        .lock()
        .map_err(|_| OwnerBrainStoreError::Unavailable)?;
    let runtime = ready_runtime(&state, owner_pubkey)?;
    let Some((generation, namespace, namespace_key)) = connected_generation(&root, runtime)? else {
        return Err(OwnerBrainStoreError::Invalid);
    };
    let address = owner_brain_source_address(namespace.clone(), source_id.clone())?;

    // The repository grant is decrypted and checked before the source
    // manifest, device binding, or original filesystem is touched.
    let grant = active_repository_grant(
        &generation,
        &address,
        namespace_key.as_bytes(),
        resident_pubkey,
    )?
    .ok_or(OwnerBrainStoreError::Invalid)?;
    if grant.state == RepositoryWorkGrantStateV1::Revoked {
        return Err(OwnerBrainStoreError::Invalid);
    }
    if grant.state != RepositoryWorkGrantStateV1::Active || grant.binding_ref != *binding_ref {
        return Err(OwnerBrainStoreError::Stale);
    }
    let manifest =
        find_connected_manifest(&generation, &namespace, namespace_key.as_bytes(), source_id)?
            .ok_or(OwnerBrainStoreError::Invalid)?;
    if manifest.source.source_kind != ConnectedBrainSourceKindV1::Repository
        || manifest.source.status != ConnectedBrainSourceStatusV1::Current
    {
        return Err(OwnerBrainStoreError::Stale);
    }
    let binding =
        find_connected_binding(&generation, &namespace, namespace_key.as_bytes(), source_id)?;
    let path = PathBuf::from(binding.canonical_root)
        .canonicalize()
        .map_err(|_| OwnerBrainStoreError::Stale)?;
    if !path.is_dir() {
        return Err(OwnerBrainStoreError::Stale);
    }
    Ok(path)
}

fn authorized_repositories_from_generation(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
    namespace_key: &[u8; 32],
    resident_pubkey: &Hex64,
    binding_ref: &Sha256Ref,
) -> Result<Vec<AuthorizedRepositoryV1>, OwnerBrainStoreError> {
    let mut source_ids = Vec::new();
    for lineage in generation.snapshot.lineages.iter().filter(|lineage| {
        lineage.namespace == *namespace.as_protocol()
            && lineage.record_type.as_str() == REPOSITORY_WORK_GRANT_RECORD
            && lineage.lifecycle == RevisionLifecycle::Active
    }) {
        let grant: RepositoryWorkGrantV1 = decrypt_active_body(
            generation,
            lineage
                .active_head_record_id
                .as_ref()
                .ok_or(OwnerBrainStoreError::Invalid)?,
            namespace_key,
        )?;
        grant
            .validate()
            .map_err(|_| OwnerBrainStoreError::Invalid)?;
        if grant.resident_pubkey == *resident_pubkey
            && grant.binding_ref == *binding_ref
            && grant.state == RepositoryWorkGrantStateV1::Active
        {
            source_ids.push(grant.source_id);
        }
    }
    source_ids.sort();
    source_ids.dedup();
    let mut repositories = Vec::new();
    for source_id in source_ids {
        let Some(manifest) =
            find_connected_manifest(generation, namespace, namespace_key, &source_id)?
        else {
            continue;
        };
        if manifest.source.source_kind == ConnectedBrainSourceKindV1::Repository
            && manifest.source.status == ConnectedBrainSourceStatusV1::Current
        {
            repositories.push(AuthorizedRepositoryV1 {
                source_id,
                display_name: manifest.source.display_name,
            });
        }
    }
    repositories.sort_by(|left, right| left.source_id.cmp(&right.source_id));
    Ok(repositories)
}

fn active_repository_grant(
    generation: &StoredRevisionGenerationV1,
    address: &NamespaceScope,
    namespace_key: &[u8; 32],
    resident_pubkey: &Hex64,
) -> Result<Option<RepositoryWorkGrantV1>, OwnerBrainStoreError> {
    let mut found = None;
    for lineage in generation.snapshot.lineages.iter().filter(|lineage| {
        lineage.namespace == *address.namespace().as_protocol()
            && lineage.scope == *address.as_protocol()
            && lineage.record_type.as_str() == REPOSITORY_WORK_GRANT_RECORD
            && lineage.lifecycle == RevisionLifecycle::Active
    }) {
        let grant: RepositoryWorkGrantV1 = decrypt_active_body(
            generation,
            lineage
                .active_head_record_id
                .as_ref()
                .ok_or(OwnerBrainStoreError::Invalid)?,
            namespace_key,
        )?;
        grant
            .validate()
            .map_err(|_| OwnerBrainStoreError::Invalid)?;
        if grant.resident_pubkey == *resident_pubkey {
            if found.is_some() || address.as_protocol().source_id.as_ref() != Some(&grant.source_id)
            {
                return Err(OwnerBrainStoreError::Invalid);
            }
            found = Some(grant);
        }
    }
    Ok(found)
}
