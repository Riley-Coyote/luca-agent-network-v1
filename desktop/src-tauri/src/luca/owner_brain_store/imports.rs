use super::*;

pub(super) fn read_prior_snapshot_with_runtime(
    root: &ContinuityMasterKey,
    runtime: &ContinuityRuntime,
    canonical_path: &Path,
) -> Result<Option<PriorOwnerBrainSnapshotV1>, OwnerBrainStoreError> {
    let key_version = runtime
        .store
        .active_owner_key_version(&runtime.owner_pubkey)
        .map_err(map_store_read_error)?;
    let namespace = owner_brain_namespace(&runtime.owner_pubkey, key_version)?;
    let namespace_key =
        derive_namespace_key(root, &namespace).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let generation = runtime
        .store
        .load_revision_generation(&runtime.owner_pubkey)
        .map_err(map_store_read_error)?;
    let Some(generation) = generation else {
        return Ok(None);
    };
    let existing = find_source_by_path(
        &generation,
        &namespace,
        namespace_key.as_bytes(),
        canonical_path,
    )?;
    Ok(existing.map(|source| PriorOwnerBrainSnapshotV1::from_hashes(source.manifest.file_hashes)))
}

pub(super) fn commit_preview_with_runtime(
    root: &ContinuityMasterKey,
    runtime: &mut ContinuityRuntime,
    pending: PendingOwnerBrainPreviewV1,
) -> Result<(OwnerBrainImportCommitV1, bool), OwnerBrainStoreError> {
    require_not_cancelled(&pending)?;
    let owner = pending.preview.owner_pubkey.clone();
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
        .map_err(map_store_read_error)?;
    let existing = generation
        .as_ref()
        .map(|generation| {
            find_source_by_path(
                generation,
                &namespace,
                namespace_key.as_bytes(),
                &pending.canonical_path,
            )
        })
        .transpose()?
        .flatten();
    let source_id = existing
        .as_ref()
        .map(|source| source.manifest.source.source_id.clone())
        .unwrap_or(opaque_id("source").map_err(|_| OwnerBrainStoreError::Invalid)?);
    let address = owner_brain_source_address(namespace.clone(), source_id.clone())?;
    let staged = stage_source(&pending, &source_id)?;

    if let Some(existing) = &existing {
        if existing.manifest.source.root_hash == pending.preview.root_snapshot_hash {
            claim_commit(&pending)?;
            let commit = committed_receipt(
                &pending,
                existing.manifest.source.import_transaction_id.clone(),
                source_id,
                existing.manifest.file_count,
                existing.manifest.chunk_count,
            )?;
            return Ok((commit, true));
        }
    }

    let import_transaction_id = opaque_id("import").map_err(|_| OwnerBrainStoreError::Invalid)?;
    let now = canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let created_at = existing
        .as_ref()
        .map(|value| value.manifest.source.created_at.clone())
        .unwrap_or_else(|| now.clone());
    let pages = build_chunk_pages(&source_id, &staged.chunks)?;
    if pages.len() > MAX_OWNER_BRAIN_CHUNK_PAGES {
        return Err(OwnerBrainStoreError::Invalid);
    }
    let page_lineages = pages
        .iter()
        .map(|page| page_lineage_id(&source_id, page.page_index))
        .collect::<Result<Vec<_>, _>>()?;
    let source = OwnerBrainSourceV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        source_id: source_id.clone(),
        owner_pubkey: owner.clone(),
        source_kind: pending.preview.source_kind,
        display_name: pending.preview.display_name.clone(),
        root_hash: pending.preview.root_snapshot_hash.clone(),
        import_transaction_id: import_transaction_id.clone(),
        created_at,
        updated_at: now.clone(),
        status: OwnerBrainSourceStatusV1::Ready,
    };
    source
        .validate()
        .map_err(|_| OwnerBrainStoreError::Invalid)?;
    let manifest = OwnerBrainSourceManifestV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        source,
        file_hashes: staged.file_hashes,
        chunk_page_lineage_ids: page_lineages.clone(),
        file_count: SafeU53::new(
            pending
                .preview
                .rows
                .iter()
                .filter(|row| eligible(row.status))
                .count() as u64,
        )
        .map_err(|_| OwnerBrainStoreError::Invalid)?,
        chunk_count: SafeU53::new(staged.chunks.len() as u64)
            .map_err(|_| OwnerBrainStoreError::Invalid)?,
    };
    manifest.validate()?;
    let canonical_path = pending
        .canonical_path
        .to_str()
        .ok_or(OwnerBrainStoreError::Invalid)?
        .to_owned();
    let binding = OwnerBrainSourceBindingV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        source_id: source_id.clone(),
        owner_pubkey: owner.clone(),
        canonical_path,
        last_snapshot_hash: pending.preview.root_snapshot_hash.clone(),
    };
    binding
        .validate()
        .map_err(|_| OwnerBrainStoreError::Invalid)?;

    let mut requests = Vec::with_capacity(pages.len() + 2);
    for (page, lineage_root) in pages.iter().zip(page_lineages) {
        require_not_cancelled(&pending)?;
        requests.push(prepare_revision(
            generation.as_ref(),
            &address,
            key_version,
            namespace_key.as_bytes(),
            OWNER_BRAIN_CHUNK_PAGE_RECORD,
            lineage_root,
            &pending.preview.root_snapshot_hash,
            &import_transaction_id,
            now.clone(),
            page,
        )?);
    }
    requests.push(prepare_revision(
        generation.as_ref(),
        &address,
        key_version,
        namespace_key.as_bytes(),
        OWNER_BRAIN_BINDING_RECORD,
        binding_lineage_id(&source_id)?,
        &pending.preview.root_snapshot_hash,
        &import_transaction_id,
        now.clone(),
        &binding,
    )?);
    requests.push(prepare_revision(
        generation.as_ref(),
        &address,
        key_version,
        namespace_key.as_bytes(),
        OWNER_BRAIN_SOURCE_RECORD,
        source_id.clone(),
        &pending.preview.root_snapshot_hash,
        &import_transaction_id,
        now,
        &manifest,
    )?);
    let expectation = generation
        .as_ref()
        .map(|value| AuthorityExpectationV1::Existing(value.token.clone()))
        .unwrap_or_else(|| AuthorityExpectationV1::UninitializedOwner {
            owner_pubkey: owner,
            active_root_key_version: key_version,
        });
    claim_commit(&pending)?;
    let result = runtime
        .store
        .apply_owner_brain_import_cas(&expectation, requests)
        .map_err(map_store_write_error);
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            pending.commit_claimed.store(false, Ordering::Release);
            return Err(error);
        }
    };
    let _authority_token = result.token;
    let commit = committed_receipt(
        &pending,
        import_transaction_id,
        source_id,
        manifest.file_count,
        manifest.chunk_count,
    )?;
    Ok((commit, result.replayed))
}

fn committed_receipt(
    pending: &PendingOwnerBrainPreviewV1,
    import_transaction_id: OpaqueId,
    source_id: OpaqueId,
    imported_file_count: SafeU53,
    imported_chunk_count: SafeU53,
) -> Result<OwnerBrainImportCommitV1, OwnerBrainStoreError> {
    let commit = OwnerBrainImportCommitV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        import_transaction_id,
        preview_id: pending.preview.preview_id.clone(),
        source_id: Some(source_id),
        root_snapshot_hash: pending.preview.root_snapshot_hash.clone(),
        state: OwnerBrainImportStateV1::Committed,
        imported_file_count,
        imported_chunk_count,
        completed_at: canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?,
        error_code: None,
    };
    commit
        .validate()
        .map_err(|_| OwnerBrainStoreError::Invalid)?;
    Ok(commit)
}

fn stage_source(
    pending: &PendingOwnerBrainPreviewV1,
    source_id: &OpaqueId,
) -> Result<StagedOwnerBrainSourceV1, OwnerBrainStoreError> {
    require_not_cancelled(pending)?;
    let token_hash = pending.preview.preview_token_hash.clone();
    let before = preview_source_at_path(
        &pending.canonical_path,
        pending.preview.owner_pubkey.clone(),
        token_hash.clone(),
        None,
    )
    .map_err(|_| OwnerBrainStoreError::Invalid)?;
    if before.root_snapshot_hash != pending.preview.root_snapshot_hash {
        return Err(OwnerBrainStoreError::Stale);
    }
    let created_at = canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let mut chunks = Vec::new();
    let mut file_hashes = BTreeMap::new();
    for row in pending
        .preview
        .rows
        .iter()
        .filter(|row| eligible(row.status))
    {
        require_not_cancelled(pending)?;
        let expected_hash = row
            .content_hash
            .as_ref()
            .ok_or(OwnerBrainStoreError::Invalid)?;
        let path = source_row_path(&pending.canonical_path, &row.relative_path)?;
        let metadata = fs::symlink_metadata(&path).map_err(|_| OwnerBrainStoreError::Stale)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(OwnerBrainStoreError::Stale);
        }
        let bytes = fs::read(&path).map_err(|_| OwnerBrainStoreError::Stale)?;
        if bytes.len() as u64 != row.byte_count.get()
            || sha256_ref(&bytes).map_err(|_| OwnerBrainStoreError::Invalid)? != *expected_hash
        {
            return Err(OwnerBrainStoreError::Stale);
        }
        let text = std::str::from_utf8(&bytes).map_err(|_| OwnerBrainStoreError::Stale)?;
        let normalized = normalized_chunks(text);
        if normalized.is_empty() {
            return Err(OwnerBrainStoreError::Stale);
        }
        file_hashes.insert(row.relative_path.clone(), expected_hash.clone());
        for body in normalized {
            require_not_cancelled(pending)?;
            let ordinal =
                SafeU53::new(chunks.len() as u64).map_err(|_| OwnerBrainStoreError::Invalid)?;
            let content_hash =
                sha256_ref(body.as_bytes()).map_err(|_| OwnerBrainStoreError::Invalid)?;
            let ordinal_label = ordinal.get().to_string();
            let chunk_id = digest_id(
                "chunk",
                &[
                    source_id.as_str(),
                    ordinal_label.as_str(),
                    content_hash.as_str(),
                ],
            )?;
            let chunk = OwnerBrainChunkV1 {
                protocol: CONTINUITY_PROTOCOL.to_owned(),
                chunk_id,
                source_id: source_id.clone(),
                ordinal,
                body,
                content_hash,
                source_locator: row.relative_path.clone(),
                created_at: created_at.clone(),
            };
            chunk
                .validate()
                .map_err(|_| OwnerBrainStoreError::Invalid)?;
            chunks.push(chunk);
        }
    }
    if file_hashes.is_empty()
        || chunks.is_empty()
        || chunks.len() > MAX_OWNER_BRAIN_CHUNK_PAGES * OWNER_BRAIN_CHUNKS_PER_PAGE
    {
        return Err(OwnerBrainStoreError::Invalid);
    }
    let after = preview_source_at_path(
        &pending.canonical_path,
        pending.preview.owner_pubkey.clone(),
        token_hash,
        None,
    )
    .map_err(|_| OwnerBrainStoreError::Stale)?;
    if after.root_snapshot_hash != pending.preview.root_snapshot_hash {
        return Err(OwnerBrainStoreError::Stale);
    }
    Ok(StagedOwnerBrainSourceV1 {
        file_hashes,
        chunks,
    })
}

fn require_not_cancelled(pending: &PendingOwnerBrainPreviewV1) -> Result<(), OwnerBrainStoreError> {
    if pending.cancelled.load(Ordering::Acquire) {
        Err(OwnerBrainStoreError::Cancelled)
    } else {
        Ok(())
    }
}

fn claim_commit(pending: &PendingOwnerBrainPreviewV1) -> Result<(), OwnerBrainStoreError> {
    require_not_cancelled(pending)?;
    pending
        .commit_claimed
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map(|_| ())
        .map_err(|_| OwnerBrainStoreError::Stale)
}
