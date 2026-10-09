//! Current source evidence for the already-admitted resident's private work.
//! No capture/discovery, account connection, model call or raw archive. A
//! missing or stale source falls back to canonical carried work, not failed chat.

use super::InitiativeRuntimeScopeV1;
use crate::{
    app_state::AppState,
    luca::companion_awareness::{
        source_runtime::{preload_source_facts_before, SourceMaterialSnapshotV1},
        turn_context::project_initiative_evidence,
        AwarenessGrantKeyV1, AwarenessHostFactsV1, AwarenessSourceKeyV1, AwarenessStoreError,
        LiveAwarenessOwner,
    },
};
use luca_protocol::{
    AwarenessGrantStateV1, AwarenessMaterialStateV1, AwarenessObservationRefV1, AwarenessUseV1,
    CanonicalTimestamp, InitiativePlanningEvidenceV1, OpaqueId,
};
use std::time::{Duration, Instant};

/// Bounded source selection, never a reusable admission token. Useful findings
/// may become Library creations, so every selected source must permit promotion
/// as well as exact-runtime egress. Native-history consent is irrelevant here:
/// the separately scoped private worker does not enter ordinary chat history.
pub(crate) fn prepare(
    state: &AppState,
    scope: &InitiativeRuntimeScopeV1,
    job: &OpaqueId,
) -> Result<(Vec<InitiativePlanningEvidenceV1>, Option<OpaqueId>), AwarenessStoreError> {
    let now = chrono::DateTime::from_timestamp_millis(
        i64::try_from(scope.control.now_unix_ms).map_err(|_| AwarenessStoreError::Invalid)?,
    )
    .ok_or(AwarenessStoreError::Invalid)?;
    let now = CanonicalTimestamp::parse(now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .map_err(|_| AwarenessStoreError::Invalid)?;
    let material = preload_source_facts_before(
        state,
        &scope.control.owner_pubkey,
        &scope.control.resident_pubkey,
        &now,
        Instant::now() + Duration::from_millis(500),
    )?;
    let snapshot = material.snapshot();
    let mut references = snapshot.references();
    references.sort_by(|a, b| {
        b.captured_at
            .cmp(&a.captured_at)
            .then_with(|| a.observation_id.cmp(&b.observation_id))
    });
    references.retain(|reference| {
        if reference.owner_pubkey != scope.control.owner_pubkey
            || reference.resident_pubkey != scope.control.resident_pubkey
        {
            return false;
        }
        let facts = material.resolve(reference, false);
        if !facts.source_fresh || facts.material_state != AwarenessMaterialStateV1::Available {
            return false;
        }
        let key = AwarenessGrantKeyV1 {
            source: AwarenessSourceKeyV1 {
                owner_pubkey: reference.owner_pubkey.clone(),
                source_id: reference.source_id.clone(),
                device_id: reference.device_id.clone(),
            },
            resident_pubkey: reference.resident_pubkey.clone(),
        };
        state
            .companion_awareness
            .snapshot(&scope.control.owner_pubkey, &key)
            .is_ok_and(|current| {
                current.grant.state == AwarenessGrantStateV1::Active
                    && current.grant.choices.observe
                    && current.grant.choices.promote
                    && current.grant.choices.provider_egress_binding.as_ref()
                        == Some(&scope.binding_ref)
            })
    });
    references.truncate(luca_protocol::MAX_INITIATIVE_PLANNING_EVIDENCE);
    references.sort_by(|a, b| a.observation_id.cmp(&b.observation_id));
    if references.is_empty() {
        return Ok((Vec::new(), None));
    }
    let node = OpaqueId::parse(format!("initiative-evidence-{}", job.as_str()))
        .map_err(|_| AwarenessStoreError::Invalid)?;
    let live = LiveAwarenessOwner::authenticate(state)?;
    if live.owner() != &scope.control.owner_pubkey {
        return Err(AwarenessStoreError::Invalid);
    }
    let lease = live.lease()?;
    let facts = AwarenessHostFactsV1 {
        owner_pubkey: &scope.control.owner_pubkey,
        resident_pubkey: &scope.control.resident_pubkey,
        now: &now,
        source_fresh: false,
        material_state: AwarenessMaterialStateV1::Unavailable,
    };
    let evidence = state.companion_awareness.with_payloads_lease(
        &lease,
        &facts,
        &references,
        AwarenessUseV1 {
            promote: true,
            provider_egress_binding: Some(&scope.binding_ref),
            ..Default::default()
        },
        |reference, retained| material.resolve(reference, retained),
        Some(&node),
        |payloads| {
            references
                .iter()
                .zip(payloads)
                .map(|(reference, payload)| {
                    let binding = snapshot
                        .binding(reference)
                        .ok_or(AwarenessStoreError::Invalid)?;
                    project_initiative_evidence(reference, &binding.scope, payload)
                })
                .collect::<Result<Vec<_>, AwarenessStoreError>>()
        },
    )??;
    Ok((evidence, Some(node)))
}

/// Final-frame equality, not substring matching against a model-supplied claim.
pub(crate) fn matches(
    snapshot: &SourceMaterialSnapshotV1,
    reference: &AwarenessObservationRefV1,
    payload: &[u8],
    excerpt: &str,
) -> bool {
    snapshot
        .binding(reference)
        .and_then(|binding| project_initiative_evidence(reference, &binding.scope, payload).ok())
        .is_some_and(|actual| actual.excerpt == excerpt)
}
