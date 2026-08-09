use super::*;

struct RankedOwnerBrainChunkV1 {
    source_id: OpaqueId,
    grant_id: OpaqueId,
    chunk_id: OpaqueId,
    body: RetrievalText,
    content_hash: Sha256Ref,
    score: i64,
}

struct OwnerBrainSourceDecisionV1 {
    source_id: OpaqueId,
    grant_id: OpaqueId,
    status: ContinuityLayerStatusV1,
    candidate_count: usize,
}

pub(super) fn retrieve_from_generation(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
    namespace_key: &[u8; 32],
    request: OwnerBrainRetrievalRequestV1,
) -> Result<OwnerBrainRetrievalResultV1, OwnerBrainStoreError> {
    let started = Instant::now();
    require_before_deadline(request.deadline)?;
    let source_ids = active_source_ids(generation, namespace)?;
    if source_ids.is_empty() {
        return Ok(OwnerBrainRetrievalResultV1 {
            status: ContinuityLayerStatusV1::Empty,
            selected: Vec::new(),
            receipts: Vec::new(),
        });
    }

    let provider_egress = effective_provider_egress(request.provider_egress);
    let mut decisions = Vec::with_capacity(source_ids.len());
    let mut candidates = Vec::new();
    for source_id in source_ids {
        require_before_deadline(request.deadline)?;
        let address = owner_brain_source_address(namespace.clone(), source_id.clone())?;
        let grant_id = grant_lineage_id(&source_id, &request.resident_pubkey)?;
        let Some(grant) = find_grant(
            generation,
            &address,
            namespace_key,
            &grant_id,
            &request.resident_pubkey,
        )?
        else {
            decisions.push(OwnerBrainSourceDecisionV1 {
                source_id,
                grant_id,
                status: ContinuityLayerStatusV1::Denied,
                candidate_count: 0,
            });
            continue;
        };
        match effective_grant_state(&grant, Some(&request.binding_ref), Some(provider_egress)) {
            BrainGrantStateV1::Revoked => {
                decisions.push(OwnerBrainSourceDecisionV1 {
                    source_id,
                    grant_id,
                    status: ContinuityLayerStatusV1::Denied,
                    candidate_count: 0,
                });
                continue;
            }
            BrainGrantStateV1::Stale => {
                decisions.push(OwnerBrainSourceDecisionV1 {
                    source_id,
                    grant_id,
                    status: ContinuityLayerStatusV1::Stale,
                    candidate_count: 0,
                });
                continue;
            }
            BrainGrantStateV1::Active => {}
        }

        // Source manifests and chunk pages are decrypted only after the exact
        // resident grant has passed binding and egress validation above.
        let manifest = find_source_by_id(generation, namespace, namespace_key, &source_id)?
            .ok_or(OwnerBrainStoreError::Invalid)?;
        let chunks = load_active_source_chunks(
            generation,
            &address,
            namespace_key,
            &manifest,
            request.deadline,
        )?;
        let mut source_candidate_count = 0_usize;
        let records = chunks
            .into_iter()
            .map(|chunk| {
                RetrievalRecord::new(RetrievalRecordInput {
                    address: address.clone(),
                    record_id: chunk.chunk_id,
                    record_type: OpaqueId::parse("owner-brain-chunk")
                        .map_err(|_| OwnerBrainStoreError::Invalid)?,
                    revision: SafeU53::new(0).map_err(|_| OwnerBrainStoreError::Invalid)?,
                    body: RetrievalText::from(chunk.body),
                    tags: Vec::new(),
                    confidence_basis_points: 10_000,
                    provenance_refs: vec![chunk.content_hash],
                    outgoing_edges: Vec::new(),
                    state: RetrievalRecordState::Active,
                })
                .map_err(|_| OwnerBrainStoreError::Invalid)
            })
            .collect::<Result<Vec<_>, _>>()?;
        for batch in records.chunks(MAX_HYDRATED_RECORDS) {
            require_before_deadline(request.deadline)?;
            let index = InMemoryRetrievalIndex::hydrate(batch)
                .map_err(|_| OwnerBrainStoreError::Invalid)?;
            let retrieval = index
                .retrieve(
                    &RetrievalQuery {
                        address: address.clone(),
                        cue: request.cue.clone(),
                        query_vector: None,
                    },
                    None,
                )
                .map_err(|_| OwnerBrainStoreError::Invalid)?;
            source_candidate_count = source_candidate_count
                .checked_add(retrieval.hits.len())
                .ok_or(OwnerBrainStoreError::Invalid)?;
            for hit in retrieval.hits {
                let record = hit.record();
                let [content_hash] = record.provenance_refs() else {
                    return Err(OwnerBrainStoreError::Invalid);
                };
                candidates.push(RankedOwnerBrainChunkV1 {
                    source_id: source_id.clone(),
                    grant_id: grant_id.clone(),
                    chunk_id: record.record_id().clone(),
                    body: RetrievalText::from(record.body()),
                    content_hash: content_hash.clone(),
                    score: hit.score(),
                });
            }
        }
        decisions.push(OwnerBrainSourceDecisionV1 {
            source_id,
            grant_id,
            status: ContinuityLayerStatusV1::Empty,
            candidate_count: source_candidate_count,
        });
    }
    require_before_deadline(request.deadline)?;
    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.chunk_id.cmp(&right.chunk_id))
            .then_with(|| left.source_id.cmp(&right.source_id))
    });

    let mut selected = Vec::new();
    let mut selected_hashes = BTreeSet::new();
    let mut selected_bytes = 0_usize;
    for candidate in candidates {
        if selected.len() >= MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS {
            break;
        }
        let body_bytes = candidate.body.as_str().len();
        if selected_hashes.contains(&candidate.content_hash)
            || selected_bytes.saturating_add(body_bytes) > MAX_OWNER_BRAIN_RETRIEVAL_BYTES
        {
            continue;
        }
        selected_bytes += body_bytes;
        selected_hashes.insert(candidate.content_hash.clone());
        selected.push(OwnerBrainSelectedChunkV1 {
            source_id: candidate.source_id,
            grant_id: candidate.grant_id,
            chunk_id: candidate.chunk_id,
            body: candidate.body,
            content_hash: candidate.content_hash,
        });
    }

    let elapsed_ms = u64::try_from(started.elapsed().as_millis())
        .ok()
        .and_then(|value| SafeU53::new(value).ok())
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let created_at = canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let mut receipts = Vec::with_capacity(decisions.len());
    for decision in &decisions {
        let mut hashes = selected
            .iter()
            .filter(|chunk| chunk.source_id == decision.source_id)
            .map(|chunk| chunk.content_hash.clone())
            .collect::<Vec<_>>();
        hashes.sort();
        hashes.dedup();
        let byte_count = selected
            .iter()
            .filter(|chunk| chunk.source_id == decision.source_id)
            .try_fold(0_usize, |total, chunk| {
                total.checked_add(chunk.body.as_str().len())
            })
            .ok_or(OwnerBrainStoreError::Invalid)?;
        let status = if hashes.is_empty() {
            decision.status
        } else {
            ContinuityLayerStatusV1::Ready
        };
        let receipt = OwnerBrainContextReceiptV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            receipt_id: opaque_id("brain-receipt").map_err(|_| OwnerBrainStoreError::Invalid)?,
            request_id: request.request_id.clone(),
            owner_pubkey: request.owner_pubkey.clone(),
            resident_pubkey: request.resident_pubkey.clone(),
            source_id: decision.source_id.clone(),
            grant_id: decision.grant_id.clone(),
            status,
            selected_chunk_hashes: hashes,
            selected_byte_count: SafeU53::new(byte_count as u64)
                .map_err(|_| OwnerBrainStoreError::Invalid)?,
            truncated: decision.candidate_count
                > selected
                    .iter()
                    .filter(|chunk| chunk.source_id == decision.source_id)
                    .count(),
            duration_ms: elapsed_ms,
            created_at: created_at.clone(),
        };
        receipt
            .validate()
            .map_err(|_| OwnerBrainStoreError::Invalid)?;
        receipts.push(receipt);
    }
    let status = if !selected.is_empty() {
        ContinuityLayerStatusV1::Ready
    } else if decisions
        .iter()
        .any(|decision| decision.status == ContinuityLayerStatusV1::Empty)
    {
        ContinuityLayerStatusV1::Empty
    } else if decisions
        .iter()
        .any(|decision| decision.status == ContinuityLayerStatusV1::Stale)
    {
        ContinuityLayerStatusV1::Stale
    } else {
        ContinuityLayerStatusV1::Denied
    };
    Ok(OwnerBrainRetrievalResultV1 {
        status,
        selected,
        receipts,
    })
}

fn active_source_ids(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
) -> Result<Vec<OpaqueId>, OwnerBrainStoreError> {
    let mut source_ids = Vec::new();
    for lineage in generation.snapshot.lineages.iter().filter(|lineage| {
        lineage.namespace == *namespace.as_protocol()
            && lineage.record_type.as_str() == OWNER_BRAIN_SOURCE_RECORD
            && lineage.lifecycle == RevisionLifecycle::Active
    }) {
        let source_id = lineage
            .scope
            .source_id
            .clone()
            .ok_or(OwnerBrainStoreError::Invalid)?;
        let address = owner_brain_source_address(namespace.clone(), source_id.clone())?;
        if lineage.scope != *address.as_protocol() {
            return Err(OwnerBrainStoreError::Invalid);
        }
        source_ids.push(source_id);
    }
    source_ids.sort();
    if source_ids.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(OwnerBrainStoreError::Invalid);
    }
    Ok(source_ids)
}

fn load_active_source_chunks(
    generation: &StoredRevisionGenerationV1,
    address: &NamespaceScope,
    namespace_key: &[u8; 32],
    manifest: &OwnerBrainSourceManifestV1,
    deadline: Instant,
) -> Result<Vec<OwnerBrainChunkV1>, OwnerBrainStoreError> {
    let mut chunks = Vec::with_capacity(manifest.chunk_count.get() as usize);
    for (expected_index, lineage_id) in manifest.chunk_page_lineage_ids.iter().enumerate() {
        require_before_deadline(deadline)?;
        let matches = generation
            .snapshot
            .lineages
            .iter()
            .filter(|lineage| lineage.lineage_root_id == *lineage_id)
            .collect::<Vec<_>>();
        let [lineage] = matches.as_slice() else {
            return Err(OwnerBrainStoreError::Invalid);
        };
        if lineage.namespace != *address.namespace().as_protocol()
            || lineage.scope != *address.as_protocol()
            || lineage.record_type.as_str() != OWNER_BRAIN_CHUNK_PAGE_RECORD
            || lineage.lifecycle != RevisionLifecycle::Active
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        let page: OwnerBrainChunkPageV1 = decrypt_active_body(
            generation,
            lineage
                .active_head_record_id
                .as_ref()
                .ok_or(OwnerBrainStoreError::Invalid)?,
            namespace_key,
        )?;
        page.validate()?;
        if page.source_id != manifest.source.source_id
            || page.page_index.get() != expected_index as u64
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        for stored in page.chunks {
            chunks.push(stored.decode()?);
        }
    }
    chunks.sort_by_key(|chunk| chunk.ordinal);
    if chunks.len() != manifest.chunk_count.get() as usize
        || chunks
            .iter()
            .enumerate()
            .any(|(index, chunk)| chunk.ordinal.get() != index as u64)
        || chunks
            .iter()
            .map(|chunk| chunk.chunk_id.clone())
            .collect::<BTreeSet<_>>()
            .len()
            != chunks.len()
    {
        return Err(OwnerBrainStoreError::Invalid);
    }
    Ok(chunks)
}

pub(super) fn require_before_deadline(deadline: Instant) -> Result<(), OwnerBrainStoreError> {
    if Instant::now() >= deadline {
        Err(OwnerBrainStoreError::Timeout)
    } else {
        Ok(())
    }
}
