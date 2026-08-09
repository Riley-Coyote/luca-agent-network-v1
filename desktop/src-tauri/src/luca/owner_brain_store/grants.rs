use super::*;

pub(super) fn read_catalog_from_generation(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
    namespace_key: &[u8; 32],
) -> Result<OwnerBrainCatalogV1, OwnerBrainStoreError> {
    let mut sources = Vec::new();
    for lineage in generation.snapshot.lineages.iter().filter(|lineage| {
        lineage.namespace == *namespace.as_protocol()
            && lineage.record_type.as_str() == OWNER_BRAIN_SOURCE_RECORD
            && lineage.lifecycle == RevisionLifecycle::Active
    }) {
        let manifest: OwnerBrainSourceManifestV1 = decrypt_active_body(
            generation,
            lineage
                .active_head_record_id
                .as_ref()
                .ok_or(OwnerBrainStoreError::Invalid)?,
            namespace_key,
        )?;
        manifest.validate()?;
        let address =
            owner_brain_source_address(namespace.clone(), manifest.source.source_id.clone())?;
        if manifest.source.owner_pubkey != generation.token.owner_pubkey
            || lineage.scope != *address.as_protocol()
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        sources.push(OwnerBrainSourceSummaryV1 {
            source: manifest.source,
            file_count: manifest.file_count,
            chunk_count: manifest.chunk_count,
        });
    }
    sources.sort_by(|left, right| left.source.source_id.cmp(&right.source.source_id));
    let source_ids = sources
        .iter()
        .map(|source| source.source.source_id.clone())
        .collect::<BTreeSet<_>>();
    let connected_source_ids = super::connected::connected_source_ids_from_generation(
        generation,
        namespace,
        namespace_key,
    )?;

    let mut grants = Vec::new();
    for lineage in generation.snapshot.lineages.iter().filter(|lineage| {
        lineage.namespace == *namespace.as_protocol()
            && lineage.record_type.as_str() == OWNER_BRAIN_GRANT_RECORD
            && lineage.lifecycle == RevisionLifecycle::Active
    }) {
        let source_id = lineage
            .scope
            .source_id
            .clone()
            .ok_or(OwnerBrainStoreError::Invalid)?;
        if connected_source_ids.contains(&source_id) {
            continue;
        }
        let address = owner_brain_source_address(namespace.clone(), source_id.clone())?;
        if lineage.scope != *address.as_protocol() || !source_ids.contains(&source_id) {
            return Err(OwnerBrainStoreError::Invalid);
        }
        let grant: BrainGrantV1 = decrypt_active_body(
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
        if grant.owner_pubkey != generation.token.owner_pubkey
            || grant.source_scope_ref != address.as_protocol().scope_ref
            || grant.grant_id != lineage.lineage_root_id
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        grants.push(OwnerBrainStoredGrantV1 { source_id, grant });
    }
    grants.sort_by(|left, right| {
        left.source_id
            .cmp(&right.source_id)
            .then_with(|| left.grant.resident_pubkey.cmp(&right.grant.resident_pubkey))
    });
    Ok(OwnerBrainCatalogV1 { sources, grants })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn mutate_grant_with_runtime(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    source_id: OpaqueId,
    binding_ref: Sha256Ref,
    provider_egress: ProviderEgressV1,
    action: OwnerBrainGrantActionV1,
) -> Result<OwnerBrainGrantMutationResultV1, OwnerBrainStoreError> {
    if owner_pubkey == resident_pubkey {
        return Err(OwnerBrainStoreError::Invalid);
    }
    let provider_egress = effective_provider_egress(provider_egress);
    let key_version = runtime
        .store
        .active_owner_key_version(&owner_pubkey)
        .map_err(map_store_read_error)?;
    let namespace = owner_brain_namespace(&owner_pubkey, key_version)?;
    let namespace_key =
        derive_namespace_key(root, &namespace).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let generation = runtime
        .store
        .load_revision_generation(&owner_pubkey)
        .map_err(map_store_read_error)?
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let _manifest = find_source_by_id(
        &generation,
        &namespace,
        namespace_key.as_bytes(),
        &source_id,
    )?
    .ok_or(OwnerBrainStoreError::Invalid)?;
    let address = owner_brain_source_address(namespace, source_id.clone())?;
    let grant_id = grant_lineage_id(&source_id, &resident_pubkey)?;
    let existing = find_grant(
        &generation,
        &address,
        namespace_key.as_bytes(),
        &grant_id,
        &resident_pubkey,
    )?;
    let existing_effective = existing
        .as_ref()
        .map(|grant| effective_grant_state(grant, Some(&binding_ref), Some(provider_egress)));

    let replay = matches!(
        (action, existing_effective),
        (
            OwnerBrainGrantActionV1::Grant,
            Some(BrainGrantStateV1::Active)
        ) | (
            OwnerBrainGrantActionV1::Reconfirm,
            Some(BrainGrantStateV1::Active)
        ) | (
            OwnerBrainGrantActionV1::Revoke,
            Some(BrainGrantStateV1::Revoked)
        )
    );
    if replay {
        return Ok(OwnerBrainGrantMutationResultV1 {
            source_id,
            grant: existing.ok_or(OwnerBrainStoreError::Invalid)?,
            replayed: true,
        });
    }
    match (action, existing_effective) {
        (OwnerBrainGrantActionV1::Grant, None | Some(BrainGrantStateV1::Revoked))
        | (OwnerBrainGrantActionV1::Reconfirm, Some(BrainGrantStateV1::Stale))
        | (
            OwnerBrainGrantActionV1::Revoke,
            Some(BrainGrantStateV1::Active | BrainGrantStateV1::Stale),
        ) => {}
        (OwnerBrainGrantActionV1::Grant, Some(BrainGrantStateV1::Stale)) => {
            return Err(OwnerBrainStoreError::Stale);
        }
        _ => return Err(OwnerBrainStoreError::Invalid),
    }

    let now = canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let version = existing
        .as_ref()
        .map(|grant| grant.grant_version.get())
        .unwrap_or(0)
        .checked_add(1)
        .and_then(|value| SafeU53::new(value).ok())
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let state = if action == OwnerBrainGrantActionV1::Revoke {
        BrainGrantStateV1::Revoked
    } else {
        BrainGrantStateV1::Active
    };
    let grant = BrainGrantV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        grant_id: grant_id.clone(),
        owner_pubkey: owner_pubkey.clone(),
        resident_pubkey,
        source_scope_ref: address.as_protocol().scope_ref.clone(),
        provider_egress,
        binding_ref,
        grant_version: version,
        state,
        created_at: existing
            .as_ref()
            .map(|grant| grant.created_at.clone())
            .unwrap_or_else(|| now.clone()),
        revoked_at: (state == BrainGrantStateV1::Revoked).then_some(now.clone()),
    };
    grant
        .validate()
        .map_err(|_| OwnerBrainStoreError::Invalid)?;
    let content_ref = sha_ref_for(&grant)?;
    let grant_version = grant.grant_version.get().to_string();
    let operation_id = digest_id(
        "brain-grant-operation",
        &[grant_id.as_str(), &grant_version, content_ref.as_str()],
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
    let expectation = AuthorityExpectationV1::Existing(generation.token);
    let result = runtime
        .store
        .apply_owner_brain_grant_cas(&expectation, request)
        .map_err(map_store_write_error)?;
    let _authority_token = result.token;
    let _receipt = result.receipt;
    Ok(OwnerBrainGrantMutationResultV1 {
        source_id,
        grant,
        replayed: result.replayed,
    })
}
