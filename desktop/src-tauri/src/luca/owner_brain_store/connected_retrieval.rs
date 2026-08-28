use super::*;
use crate::luca::connected_brain::read_verified_excerpt;
use luca_protocol::{ConnectedBrainIndexEntryV1, ConnectedBrainSourceStatusV1};

const MAX_CONNECTED_RANKED_PER_SOURCE: usize = 64;

pub(super) fn connected_candidates(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
    namespace_key: &[u8; 32],
    request: &OwnerBrainRetrievalRequestV1,
) -> Result<
    (
        Vec<RankedOwnerBrainChunkV1>,
        Vec<OwnerBrainSourceDecisionV1>,
    ),
    OwnerBrainStoreError,
> {
    let query_hashes = query_token_hashes(request.cue.as_str())?;
    let mut candidates = Vec::new();
    let mut decisions = Vec::new();
    for source_id in active_connected_source_ids(generation, namespace)? {
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
        let provider_egress = effective_provider_egress(request.provider_egress);
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
        // Index and binding decryption occurs only after exact authorization.
        let manifest = find_connected_manifest(generation, namespace, namespace_key, &source_id)?
            .ok_or(OwnerBrainStoreError::Invalid)?;
        if manifest.source.status != ConnectedBrainSourceStatusV1::Current {
            decisions.push(OwnerBrainSourceDecisionV1 {
                source_id,
                grant_id,
                status: ContinuityLayerStatusV1::Stale,
                candidate_count: 0,
            });
            continue;
        }
        let binding = find_connected_binding(generation, namespace, namespace_key, &source_id)?;
        let entries = load_connected_entries(
            generation,
            &address,
            namespace_key,
            &manifest,
            request.deadline,
        )?;
        let mut ranked = entries
            .into_iter()
            .filter_map(|entry| {
                let score = entry
                    .token_hashes
                    .iter()
                    .filter(|token| query_hashes.contains(*token))
                    .count();
                (score > 0).then_some((score, entry))
            })
            .collect::<Vec<_>>();
        ranked.sort_by(|left, right| {
            right
                .0
                .cmp(&left.0)
                .then_with(|| left.1.entry_id.cmp(&right.1.entry_id))
        });
        ranked.truncate(MAX_CONNECTED_RANKED_PER_SOURCE);
        let candidate_count = ranked.len();
        let mut stale = false;
        for (score, entry) in ranked {
            require_before_deadline(request.deadline)?;
            let Ok(body) = read_verified_excerpt(
                Path::new(&binding.canonical_root),
                manifest.source.source_kind,
                &entry,
            ) else {
                stale = true;
                continue;
            };
            if effective_grant_state(&grant, Some(&request.binding_ref), Some(provider_egress))
                != BrainGrantStateV1::Active
            {
                return Err(OwnerBrainStoreError::Stale);
            }
            candidates.push(RankedOwnerBrainChunkV1 {
                source_id: source_id.clone(),
                grant_id: grant_id.clone(),
                chunk_id: entry.entry_id,
                body: RetrievalText::from(body),
                content_hash: entry.content_hash,
                score: i64::try_from(score)
                    .ok()
                    .and_then(|value| value.checked_mul(1_000))
                    .ok_or(OwnerBrainStoreError::Invalid)?,
                selected_context: request.selected_source_ids.contains(&source_id),
            });
        }
        decisions.push(OwnerBrainSourceDecisionV1 {
            source_id,
            grant_id,
            status: if stale {
                ContinuityLayerStatusV1::Stale
            } else {
                ContinuityLayerStatusV1::Empty
            },
            candidate_count,
        });
    }
    Ok((candidates, decisions))
}

fn active_connected_source_ids(
    generation: &StoredRevisionGenerationV1,
    namespace: &NamespaceKey,
) -> Result<Vec<OpaqueId>, OwnerBrainStoreError> {
    let mut ids = generation
        .snapshot
        .lineages
        .iter()
        .filter(|lineage| {
            lineage.namespace == *namespace.as_protocol()
                && lineage.record_type.as_str() == CONNECTED_SOURCE_RECORD
                && lineage.lifecycle == RevisionLifecycle::Active
        })
        .map(|lineage| {
            lineage
                .scope
                .source_id
                .clone()
                .ok_or(OwnerBrainStoreError::Invalid)
        })
        .collect::<Result<Vec<_>, _>>()?;
    ids.sort();
    if ids.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(OwnerBrainStoreError::Invalid);
    }
    Ok(ids)
}

pub(super) fn load_connected_entries(
    generation: &StoredRevisionGenerationV1,
    address: &NamespaceScope,
    namespace_key: &[u8; 32],
    manifest: &ConnectedBrainManifestV1,
    deadline: Instant,
) -> Result<Vec<ConnectedBrainIndexEntryV1>, OwnerBrainStoreError> {
    let mut entries = Vec::with_capacity(manifest.entry_count.get() as usize);
    for (page_index, lineage_id) in manifest.index_page_lineage_ids.iter().enumerate() {
        require_before_deadline(deadline)?;
        let lineage = generation
            .snapshot
            .lineages
            .iter()
            .find(|lineage| {
                lineage.lineage_root_id == *lineage_id
                    && lineage.namespace == *address.namespace().as_protocol()
                    && lineage.scope == *address.as_protocol()
                    && lineage.record_type.as_str() == CONNECTED_INDEX_PAGE_RECORD
                    && lineage.lifecycle == RevisionLifecycle::Active
            })
            .ok_or(OwnerBrainStoreError::Invalid)?;
        let page: ConnectedBrainIndexPageV1 = decrypt_active_body(
            generation,
            lineage
                .active_head_record_id
                .as_ref()
                .ok_or(OwnerBrainStoreError::Invalid)?,
            namespace_key,
        )?;
        page.validate()?;
        if page.source_id != manifest.source.source_id || page.page_index.get() != page_index as u64
        {
            return Err(OwnerBrainStoreError::Invalid);
        }
        entries.extend(page.entries);
    }
    if entries.len() != manifest.entry_count.get() as usize {
        return Err(OwnerBrainStoreError::Invalid);
    }
    Ok(entries)
}

fn query_token_hashes(cue: &str) -> Result<BTreeSet<Sha256Ref>, OwnerBrainStoreError> {
    cue.split(|character: char| {
        !character.is_alphanumeric() && character != '_' && character != '-'
    })
    .map(str::trim)
    .filter(|token| token.len() >= 2)
    .map(str::to_lowercase)
    .collect::<BTreeSet<_>>()
    .into_iter()
    .map(|token| {
        use sha2::{Digest, Sha256};
        Sha256Ref::parse(format!(
            "sha256:{}",
            hex::encode(Sha256::digest(token.as_bytes()))
        ))
        .map_err(|_| OwnerBrainStoreError::Invalid)
    })
    .collect()
}
