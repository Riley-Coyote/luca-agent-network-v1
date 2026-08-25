use std::cmp::Ordering;

use super::*;

pub(super) struct RankedOwnerBrainChunkV1 {
    pub(super) source_id: OpaqueId,
    pub(super) grant_id: OpaqueId,
    pub(super) chunk_id: OpaqueId,
    pub(super) body: RetrievalText,
    pub(super) content_hash: Sha256Ref,
    pub(super) score: i64,
    pub(super) selected_context: bool,
}

pub(super) struct OwnerBrainSourceDecisionV1 {
    pub(super) source_id: OpaqueId,
    pub(super) grant_id: OpaqueId,
    pub(super) status: ContinuityLayerStatusV1,
    pub(super) candidate_count: usize,
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
                    selected_context: request.selected_source_ids.contains(&source_id),
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
    let (connected_candidates, connected_decisions) =
        connected_candidates(generation, namespace, namespace_key, &request)?;
    candidates.extend(connected_candidates);
    decisions.extend(connected_decisions);
    require_before_deadline(request.deadline)?;
    let selected = select_bounded_candidates(candidates)
        .into_iter()
        .map(|candidate| OwnerBrainSelectedChunkV1 {
            source_id: candidate.source_id,
            grant_id: candidate.grant_id,
            chunk_id: candidate.chunk_id,
            body: candidate.body,
            content_hash: candidate.content_hash,
        })
        .collect::<Vec<_>>();

    let elapsed_ms = u64::try_from(started.elapsed().as_millis())
        .ok()
        .and_then(|value| SafeU53::new(value).ok())
        .ok_or(OwnerBrainStoreError::Invalid)?;
    let created_at = canonical_timestamp(Utc::now()).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let selected_source_count = selected
        .iter()
        .filter(|chunk| request.selected_source_ids.contains(&chunk.source_id))
        .map(|chunk| &chunk.source_id)
        .collect::<BTreeSet<_>>()
        .len();
    let background_source_count = selected
        .iter()
        .filter(|chunk| !request.selected_source_ids.contains(&chunk.source_id))
        .map(|chunk| &chunk.source_id)
        .collect::<BTreeSet<_>>()
        .len();
    let selected_source_count =
        SafeU53::new(selected_source_count as u64).map_err(|_| OwnerBrainStoreError::Invalid)?;
    let background_source_count =
        SafeU53::new(background_source_count as u64).map_err(|_| OwnerBrainStoreError::Invalid)?;
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
            selected_context: request.selected_source_ids.contains(&decision.source_id),
            selected_source_count,
            background_source_count,
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

fn compare_ranked_candidates(
    left: &RankedOwnerBrainChunkV1,
    right: &RankedOwnerBrainChunkV1,
) -> Ordering {
    right
        .selected_context
        .cmp(&left.selected_context)
        .then_with(|| right.score.cmp(&left.score))
        .then_with(|| left.chunk_id.cmp(&right.chunk_id))
        .then_with(|| left.source_id.cmp(&right.source_id))
}

fn select_bounded_candidates(
    mut candidates: Vec<RankedOwnerBrainChunkV1>,
) -> Vec<RankedOwnerBrainChunkV1> {
    candidates.sort_by(compare_ranked_candidates);
    let has_selected = candidates
        .iter()
        .any(|candidate| candidate.selected_context);
    let has_background = candidates
        .iter()
        .any(|candidate| !candidate.selected_context);

    let mut selected = Vec::new();
    let mut selected_hashes = BTreeSet::new();
    let mut selected_bytes = 0_usize;
    if !has_selected || !has_background {
        for candidate in candidates {
            let _ = try_select_candidate(
                &mut selected,
                &mut selected_hashes,
                &mut selected_bytes,
                candidate,
                MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS,
                MAX_OWNER_BRAIN_RETRIEVAL_BYTES,
            );
        }
        return selected;
    }

    let (selected_candidates, background_candidates): (Vec<_>, Vec<_>) = candidates
        .into_iter()
        .partition(|candidate| candidate.selected_context);
    let mut deferred_selected = Vec::new();
    for candidate in selected_candidates {
        if let Some(candidate) = try_select_candidate(
            &mut selected,
            &mut selected_hashes,
            &mut selected_bytes,
            candidate,
            MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS.saturating_sub(1),
            MAX_OWNER_BRAIN_RETRIEVAL_BYTES.saturating_sub(MAX_OWNER_BRAIN_CHUNK_BYTES),
        ) {
            deferred_selected.push(candidate);
        }
    }

    let mut background_selected = false;
    let mut deferred_background = Vec::new();
    for candidate in background_candidates {
        if !background_selected {
            match try_select_candidate(
                &mut selected,
                &mut selected_hashes,
                &mut selected_bytes,
                candidate,
                MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS,
                MAX_OWNER_BRAIN_RETRIEVAL_BYTES,
            ) {
                None => {
                    background_selected = true;
                    continue;
                }
                Some(candidate) => deferred_background.push(candidate),
            }
        } else {
            deferred_background.push(candidate);
        }
    }

    for candidate in deferred_selected.into_iter().chain(deferred_background) {
        let _ = try_select_candidate(
            &mut selected,
            &mut selected_hashes,
            &mut selected_bytes,
            candidate,
            MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS,
            MAX_OWNER_BRAIN_RETRIEVAL_BYTES,
        );
    }
    selected.sort_by(compare_ranked_candidates);
    selected
}

fn try_select_candidate(
    selected: &mut Vec<RankedOwnerBrainChunkV1>,
    selected_hashes: &mut BTreeSet<Sha256Ref>,
    selected_bytes: &mut usize,
    candidate: RankedOwnerBrainChunkV1,
    chunk_limit: usize,
    byte_limit: usize,
) -> Option<RankedOwnerBrainChunkV1> {
    let body_bytes = candidate.body.as_str().len();
    if selected.len() >= chunk_limit
        || selected_hashes.contains(&candidate.content_hash)
        || selected_bytes.saturating_add(body_bytes) > byte_limit
    {
        return Some(candidate);
    }
    *selected_bytes += body_bytes;
    selected_hashes.insert(candidate.content_hash.clone());
    selected.push(candidate);
    None
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

#[cfg(test)]
mod selected_context_tests {
    use super::*;

    fn candidate(source: &str, chunk: &str, score: i64, selected: bool) -> RankedOwnerBrainChunkV1 {
        candidate_with_body(source, chunk, format!("context {chunk}"), score, selected)
    }

    fn candidate_with_body(
        source: &str,
        chunk: &str,
        body: String,
        score: i64,
        selected: bool,
    ) -> RankedOwnerBrainChunkV1 {
        RankedOwnerBrainChunkV1 {
            source_id: OpaqueId::parse(source.to_owned()).expect("source"),
            grant_id: OpaqueId::parse(format!("grant-{source}")).expect("grant"),
            chunk_id: OpaqueId::parse(chunk.to_owned()).expect("chunk"),
            content_hash: sha256_ref(body.as_bytes()).expect("hash"),
            body: RetrievalText::from(body),
            score,
            selected_context: selected,
        }
    }

    #[test]
    fn selected_context_outranks_a_higher_scoring_background_source() {
        let mut candidates = [
            candidate("background", "chunk-background", 10_000, false),
            candidate("selected", "chunk-selected", 10, true),
        ];
        candidates.sort_by(compare_ranked_candidates);
        assert_eq!(candidates[0].source_id.as_str(), "selected");
    }

    #[test]
    fn selected_context_reserves_one_bounded_background_fallback() {
        let mut candidates = (0..MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS + 2)
            .map(|index| candidate("selected", &format!("chunk-selected-{index}"), 10, true))
            .collect::<Vec<_>>();
        candidates.push(candidate("background", "chunk-background", 10_000, false));

        let selected = select_bounded_candidates(candidates);

        assert_eq!(selected.len(), MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS);
        assert_eq!(
            selected
                .iter()
                .filter(|candidate| candidate.selected_context)
                .count(),
            MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS - 1
        );
        assert_eq!(
            selected
                .iter()
                .filter(|candidate| !candidate.selected_context)
                .count(),
            1
        );
        assert!(selected[..MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS - 1]
            .iter()
            .all(|candidate| candidate.selected_context));
        assert_eq!(selected.last().unwrap().source_id.as_str(), "background");
    }

    #[test]
    fn selected_only_retrieval_uses_the_full_chunk_bound() {
        let candidates = (0..MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS + 2)
            .map(|index| candidate("selected", &format!("chunk-selected-{index}"), 10, true))
            .collect::<Vec<_>>();

        let selected = select_bounded_candidates(candidates);

        assert_eq!(selected.len(), MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS);
        assert!(selected.iter().all(|candidate| candidate.selected_context));
    }

    #[test]
    fn selected_context_reserves_background_bytes_at_the_global_bound() {
        let mut candidates = (0..MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS)
            .map(|index| {
                let prefix = format!("selected-{index:02}");
                let body = format!(
                    "{prefix}{}",
                    "s".repeat(MAX_OWNER_BRAIN_CHUNK_BYTES - prefix.len())
                );
                candidate_with_body(
                    "selected",
                    &format!("chunk-selected-{index}"),
                    body,
                    10,
                    true,
                )
            })
            .collect::<Vec<_>>();
        let prefix = "background";
        candidates.push(candidate_with_body(
            "background",
            "chunk-background",
            format!(
                "{prefix}{}",
                "b".repeat(MAX_OWNER_BRAIN_CHUNK_BYTES - prefix.len())
            ),
            10_000,
            false,
        ));

        let selected = select_bounded_candidates(candidates);

        assert_eq!(
            selected
                .iter()
                .map(|candidate| candidate.body.as_str().len())
                .sum::<usize>(),
            MAX_OWNER_BRAIN_RETRIEVAL_BYTES
        );
        assert_eq!(
            selected
                .iter()
                .filter(|candidate| candidate.selected_context)
                .count(),
            (MAX_OWNER_BRAIN_RETRIEVAL_BYTES - MAX_OWNER_BRAIN_CHUNK_BYTES)
                / MAX_OWNER_BRAIN_CHUNK_BYTES
        );
        assert!(selected.iter().any(|candidate| !candidate.selected_context));
    }

    #[test]
    fn duplicate_background_content_backfills_selected_capacity() {
        let mut candidates = (0..MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS + 1)
            .map(|index| candidate("selected", &format!("chunk-selected-{index}"), 10, true))
            .collect::<Vec<_>>();
        let duplicate_body = candidates[0].body.as_str().to_owned();
        candidates.push(candidate_with_body(
            "background",
            "chunk-background",
            duplicate_body,
            10_000,
            false,
        ));

        let selected = select_bounded_candidates(candidates);

        assert_eq!(selected.len(), MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS);
        assert!(selected.iter().all(|candidate| candidate.selected_context));
    }
}
