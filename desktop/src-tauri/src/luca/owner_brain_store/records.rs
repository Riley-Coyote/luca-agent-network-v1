use super::*;

pub(super) fn normalized_chunks(text: &str) -> Vec<String> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut remaining = normalized.trim();
    let mut chunks = Vec::new();
    while !remaining.is_empty() {
        let mut end = remaining.len().min(MAX_OWNER_BRAIN_CHUNK_BYTES);
        while !remaining.is_char_boundary(end) {
            end -= 1;
        }
        let body = remaining[..end].trim();
        if !body.is_empty() {
            chunks.push(body.to_owned());
        }
        remaining = remaining[end..].trim_start();
    }
    chunks
}

pub(super) fn build_chunk_pages(
    source_id: &OpaqueId,
    chunks: &[OwnerBrainChunkV1],
) -> Result<Vec<OwnerBrainChunkPageV1>, OwnerBrainStoreError> {
    chunks
        .chunks(OWNER_BRAIN_CHUNKS_PER_PAGE)
        .enumerate()
        .map(|(page_index, chunks)| {
            let page = OwnerBrainChunkPageV1 {
                protocol: CONTINUITY_PROTOCOL.to_owned(),
                source_id: source_id.clone(),
                page_index: SafeU53::new(page_index as u64)
                    .map_err(|_| OwnerBrainStoreError::Invalid)?,
                chunks: chunks
                    .iter()
                    .map(StoredOwnerBrainChunkV1::encode)
                    .collect::<Result<Vec<_>, _>>()?,
            };
            page.validate()?;
            Ok(page)
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
pub(super) fn prepare_revision<T: Serialize>(
    generation: Option<&StoredRevisionGenerationV1>,
    address: &NamespaceScope,
    key_version: SafeU53,
    namespace_key: &[u8; 32],
    record_type: &'static str,
    lineage_root_id: OpaqueId,
    root_hash: &Sha256Ref,
    import_transaction_id: &OpaqueId,
    created_at: CanonicalTimestamp,
    body: &T,
) -> Result<RevisionRequest, OwnerBrainStoreError> {
    let record_type = OpaqueId::parse(record_type).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let (operation, expected_head_record_id, revision) =
        revision_coordinates(generation, address, &record_type, &lineage_root_id)?;
    let record_id = if operation == RevisionOperation::Create {
        lineage_root_id.clone()
    } else {
        digest_id(
            "brain-revision",
            &[lineage_root_id.as_str(), root_hash.as_str()],
        )?
    };
    let plaintext = canonicalize(body).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let successor = encrypt_record(
        luca_continuity::RecordMetadata {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            record_id,
            namespace: address.namespace().as_protocol().clone(),
            scope: address.as_protocol().clone(),
            record_type: record_type.clone(),
            revision,
            predecessor_record_id: expected_head_record_id.clone(),
            created_at,
            author_kind: OpaqueId::parse("owner").map_err(|_| OwnerBrainStoreError::Invalid)?,
            provenance_refs: vec![root_hash.clone()],
            key_version,
        },
        namespace_key,
        &plaintext,
    )
    .map_err(|_| OwnerBrainStoreError::Invalid)?;
    let request_ref = sha_ref_for(&serde_json::json!({
        "domain": OWNER_BRAIN_REQUEST_DOMAIN,
        "import_transaction_id": import_transaction_id,
        "lineage_root_id": lineage_root_id,
        "root_hash": root_hash,
        "operation": match operation {
            RevisionOperation::Create => "create",
            RevisionOperation::Revise => "revise",
            _ => return Err(OwnerBrainStoreError::Invalid),
        },
    }))?;
    let successor_ref =
        encrypted_record_reference(&successor).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let mut request = RevisionRequest {
        idempotency_key: request_ref.clone(),
        operation,
        lineage_root_id,
        expected_head_record_id,
        actor: RevisionActor::Owner,
        signed_source_event_refs: Vec::new(),
        request_ref,
        successor: Some(successor),
        successor_ciphertext_ref: Some(successor_ref),
        rollback_source_record_id: None,
        derived_artifact_refs: Vec::new(),
    };
    let record = request
        .successor
        .as_ref()
        .ok_or(OwnerBrainStoreError::Invalid)?;
    request.idempotency_key = derive_revision_idempotency_key(
        &record.namespace,
        &record.scope,
        &record.record_type,
        record.key_version,
        &request,
    )
    .map_err(|_| OwnerBrainStoreError::Invalid)?;
    Ok(request)
}

pub(super) fn revision_coordinates(
    generation: Option<&StoredRevisionGenerationV1>,
    address: &NamespaceScope,
    record_type: &OpaqueId,
    lineage_root_id: &OpaqueId,
) -> Result<(RevisionOperation, Option<OpaqueId>, SafeU53), OwnerBrainStoreError> {
    let Some(generation) = generation else {
        return Ok((RevisionOperation::Create, None, SafeU53::new(0).unwrap()));
    };
    let lineage = generation
        .snapshot
        .lineages
        .iter()
        .find(|lineage| lineage.lineage_root_id == *lineage_root_id);
    let Some(lineage) = lineage else {
        return Ok((RevisionOperation::Create, None, SafeU53::new(0).unwrap()));
    };
    if lineage.namespace != *address.namespace().as_protocol()
        || lineage.scope != *address.as_protocol()
        || lineage.record_type != *record_type
        || lineage.lifecycle != RevisionLifecycle::Active
    {
        return Err(OwnerBrainStoreError::Invalid);
    }
    let head = lineage
        .active_head_record_id
        .clone()
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let head_record = generation
        .snapshot
        .records
        .iter()
        .find(|record| record.record_id == head)
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let revision = SafeU53::new(
        head_record
            .revision
            .get()
            .checked_add(1)
            .ok_or(OwnerBrainStoreError::Invalid)?,
    )
    .map_err(|_| OwnerBrainStoreError::Invalid)?;
    Ok((RevisionOperation::Revise, Some(head), revision))
}

pub(super) fn find_source_by_path(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
    namespace_key: &[u8; 32],
    canonical_path: &Path,
) -> Result<Option<ExistingOwnerBrainSourceV1>, OwnerBrainStoreError> {
    let canonical_path = canonical_path
        .to_str()
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let mut matched = None;
    for lineage in generation.snapshot.lineages.iter().filter(|lineage| {
        lineage.namespace == *namespace.as_protocol()
            && lineage.record_type.as_str() == OWNER_BRAIN_BINDING_RECORD
            && lineage.lifecycle == RevisionLifecycle::Active
    }) {
        let binding: OwnerBrainSourceBindingV1 = decrypt_active_body(
            generation,
            lineage
                .active_head_record_id
                .as_ref()
                .ok_or(OwnerBrainStoreError::Invalid)?,
            namespace_key,
        )?;
        binding
            .validate()
            .map_err(|_| OwnerBrainStoreError::Invalid)?;
        if binding.owner_pubkey != generation.token.owner_pubkey {
            return Err(OwnerBrainStoreError::Invalid);
        }
        let address = owner_brain_source_address(namespace.clone(), binding.source_id.clone())?;
        if lineage.scope != *address.as_protocol() {
            return Err(OwnerBrainStoreError::Invalid);
        }
        if binding.canonical_path != canonical_path {
            continue;
        }
        if matched.is_some() {
            return Err(OwnerBrainStoreError::Invalid);
        }
        let source_lineages = generation
            .snapshot
            .lineages
            .iter()
            .filter(|candidate| {
                candidate.namespace == *address.namespace().as_protocol()
                    && candidate.scope == *address.as_protocol()
                    && candidate.record_type.as_str() == OWNER_BRAIN_SOURCE_RECORD
                    && candidate.lifecycle == RevisionLifecycle::Active
            })
            .collect::<Vec<_>>();
        let [source_lineage] = source_lineages.as_slice() else {
            return Err(OwnerBrainStoreError::Invalid);
        };
        let manifest: OwnerBrainSourceManifestV1 = decrypt_active_body(
            generation,
            source_lineage
                .active_head_record_id
                .as_ref()
                .ok_or(OwnerBrainStoreError::Invalid)?,
            namespace_key,
        )?;
        manifest.validate()?;
        if manifest.source.source_id != binding.source_id
            || manifest.source.owner_pubkey != binding.owner_pubkey
            || manifest.source.root_hash != binding.last_snapshot_hash
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        matched = Some(ExistingOwnerBrainSourceV1 { manifest, binding });
    }
    if matched
        .as_ref()
        .is_some_and(|source| source.binding.canonical_path != canonical_path)
    {
        return Err(OwnerBrainStoreError::Invalid);
    }
    Ok(matched)
}

pub(super) fn find_source_by_id(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
    namespace_key: &[u8; 32],
    source_id: &OpaqueId,
) -> Result<Option<OwnerBrainSourceManifestV1>, OwnerBrainStoreError> {
    let address = owner_brain_source_address(namespace.clone(), source_id.clone())?;
    let matches = generation
        .snapshot
        .lineages
        .iter()
        .filter(|lineage| {
            lineage.namespace == *namespace.as_protocol()
                && lineage.scope == *address.as_protocol()
                && lineage.record_type.as_str() == OWNER_BRAIN_SOURCE_RECORD
                && lineage.lifecycle == RevisionLifecycle::Active
        })
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [] => Ok(None),
        [lineage] => {
            let manifest: OwnerBrainSourceManifestV1 = decrypt_active_body(
                generation,
                lineage
                    .active_head_record_id
                    .as_ref()
                    .ok_or(OwnerBrainStoreError::Invalid)?,
                namespace_key,
            )?;
            manifest.validate()?;
            if manifest.source.source_id != *source_id
                || manifest.source.owner_pubkey != generation.token.owner_pubkey
            {
                return Err(OwnerBrainStoreError::Invalid);
            }
            Ok(Some(manifest))
        }
        _ => Err(OwnerBrainStoreError::Invalid),
    }
}

pub(super) fn find_grant(
    generation: &StoredRevisionGenerationV1,
    address: &NamespaceScope,
    namespace_key: &[u8; 32],
    grant_id: &OpaqueId,
    resident_pubkey: &Hex64,
) -> Result<Option<BrainGrantV1>, OwnerBrainStoreError> {
    let Some(lineage) = generation
        .snapshot
        .lineages
        .iter()
        .find(|lineage| lineage.lineage_root_id == *grant_id)
    else {
        return Ok(None);
    };
    if lineage.namespace != *address.namespace().as_protocol()
        || lineage.scope != *address.as_protocol()
        || lineage.record_type.as_str() != OWNER_BRAIN_GRANT_RECORD
        || lineage.lifecycle != RevisionLifecycle::Active
    {
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
    if grant.grant_id != *grant_id
        || grant.owner_pubkey != generation.token.owner_pubkey
        || grant.resident_pubkey != *resident_pubkey
        || grant.source_scope_ref != address.as_protocol().scope_ref
    {
        return Err(OwnerBrainStoreError::Invalid);
    }
    Ok(Some(grant))
}

pub(super) fn decrypt_active_body<T: DeserializeOwned + Serialize>(
    generation: &StoredRevisionGenerationV1,
    record_id: &OpaqueId,
    namespace_key: &[u8; 32],
) -> Result<T, OwnerBrainStoreError> {
    let record = generation
        .snapshot
        .records
        .iter()
        .find(|record| record.record_id == *record_id)
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let body = decrypt_record(record, namespace_key).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let value =
        serde_json::from_slice::<T>(body.as_bytes()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    if canonicalize(&value).map_err(|_| OwnerBrainStoreError::Invalid)? != body.as_bytes() {
        return Err(OwnerBrainStoreError::Invalid);
    }
    Ok(value)
}

pub(super) fn owner_brain_namespace(
    owner_pubkey: &Hex64,
    key_version: SafeU53,
) -> Result<NamespaceKey, OwnerBrainStoreError> {
    let namespace_ref = sha_ref_for(&serde_json::json!({
        "domain": OWNER_BRAIN_NAMESPACE_DOMAIN,
        "owner_pubkey": owner_pubkey,
    }))?;
    ContinuityNamespaceV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        owner_pubkey: owner_pubkey.clone(),
        kind: ContinuityNamespaceKindV1::OwnerBrain,
        resident_pubkey: None,
        namespace_ref,
        key_version,
    }
    .try_into()
    .map_err(|_| OwnerBrainStoreError::Invalid)
}

pub(super) fn owner_brain_source_address(
    namespace: NamespaceKey,
    source_id: OpaqueId,
) -> Result<NamespaceScope, OwnerBrainStoreError> {
    let namespace_ref = namespace.as_protocol().namespace_ref.clone();
    let scope_ref = sha_ref_for(&serde_json::json!({
        "domain": OWNER_BRAIN_SCOPE_DOMAIN,
        "namespace_ref": namespace_ref,
        "source_id": source_id,
    }))?;
    NamespaceScope::new(
        namespace,
        ContinuityScopeV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            namespace_ref,
            scope_ref,
            source_id: Some(source_id),
            project_id: None,
            room_id: None,
            conversation_id: None,
        },
    )
    .map_err(|_| OwnerBrainStoreError::Invalid)
}

pub(super) fn source_row_path(
    root: &Path,
    relative_path: &str,
) -> Result<PathBuf, OwnerBrainStoreError> {
    let relative = Path::new(relative_path);
    if !valid_relative_locator(relative_path) {
        return Err(OwnerBrainStoreError::Invalid);
    }
    let candidate = if root.is_file() {
        let file_name = root
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(OwnerBrainStoreError::Invalid)?;
        if relative_path != file_name {
            return Err(OwnerBrainStoreError::Invalid);
        }
        root.to_owned()
    } else {
        root.join(relative)
    };
    let canonical = fs::canonicalize(&candidate).map_err(|_| OwnerBrainStoreError::Stale)?;
    if root.is_file() && canonical != root || root.is_dir() && !canonical.starts_with(root) {
        return Err(OwnerBrainStoreError::Stale);
    }
    Ok(canonical)
}

pub(super) fn valid_relative_locator(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= luca_protocol::MAX_OWNER_BRAIN_LOCATOR_BYTES
        && !Path::new(value).is_absolute()
        && !Path::new(value).components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
}

pub(super) fn page_lineage_id(
    source_id: &OpaqueId,
    page_index: SafeU53,
) -> Result<OpaqueId, OwnerBrainStoreError> {
    let page = page_index.get().to_string();
    digest_id("brain-page", &[source_id.as_str(), &page])
}

pub(super) fn binding_lineage_id(source_id: &OpaqueId) -> Result<OpaqueId, OwnerBrainStoreError> {
    digest_id("brain-binding", &[source_id.as_str()])
}

pub(super) fn grant_lineage_id(
    source_id: &OpaqueId,
    resident_pubkey: &Hex64,
) -> Result<OpaqueId, OwnerBrainStoreError> {
    digest_id(
        "brain-grant",
        &[source_id.as_str(), resident_pubkey.as_str()],
    )
}

pub(super) fn digest_id(prefix: &str, values: &[&str]) -> Result<OpaqueId, OwnerBrainStoreError> {
    let digest = canonical_sha256(&serde_json::json!({
        "domain": OWNER_BRAIN_RECORD_DOMAIN,
        "prefix": prefix,
        "values": values,
    }))
    .map_err(|_| OwnerBrainStoreError::Invalid)?;
    OpaqueId::parse(format!("{prefix}-{}", &digest[..40]))
        .map_err(|_| OwnerBrainStoreError::Invalid)
}

pub(super) fn sha_ref_for<T: Serialize>(value: &T) -> Result<Sha256Ref, OwnerBrainStoreError> {
    canonical_sha256(value)
        .ok()
        .and_then(|digest| Sha256Ref::parse(format!("sha256:{digest}")).ok())
        .ok_or(OwnerBrainStoreError::Invalid)
}

pub(super) fn eligible(status: OwnerBrainPreviewRowStatusV1) -> bool {
    matches!(
        status,
        OwnerBrainPreviewRowStatusV1::Accepted
            | OwnerBrainPreviewRowStatusV1::Duplicate
            | OwnerBrainPreviewRowStatusV1::Changed
    )
}

pub(super) fn preview_expired(pending: &PendingOwnerBrainPreviewV1) -> bool {
    chrono::DateTime::parse_from_rfc3339(pending.preview.expires_at.as_str())
        .map(|expires| expires.timestamp() <= Utc::now().timestamp())
        .unwrap_or(true)
}

pub(super) fn map_store_read_error(error: ContinuityStoreError) -> OwnerBrainStoreError {
    match error {
        ContinuityStoreError::LifecycleConflict | ContinuityStoreError::CompareAndSwapConflict => {
            OwnerBrainStoreError::Stale
        }
        ContinuityStoreError::Unavailable => OwnerBrainStoreError::Unavailable,
        _ => OwnerBrainStoreError::Invalid,
    }
}

pub(super) fn map_store_write_error(error: ContinuityStoreError) -> OwnerBrainStoreError {
    map_store_read_error(error)
}
