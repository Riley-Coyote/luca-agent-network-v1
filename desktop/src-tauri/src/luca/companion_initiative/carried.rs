//! Independent carried lineages from the resident's already committed handoff.
//! No new model turn, Brain requirement, inferred owner preferences or task quota.

use super::{host_scope::home_scope, InitiativeStoreErrorV1};
use crate::{
    app_state::AppState,
    luca::{
        companion_awareness::LiveAwarenessOwner,
        resident_notebook::InitiativeThreadCommitRequestV1,
    },
};
use luca_protocol::{
    canonical_sha256, Hex64, InitiativeDispositionV1, InitiativeSemanticThreadV1,
    InitiativeThreadKindV1, OpaqueId, ResidentHandoffV1, SafeU53, Sha256Ref,
    INITIATIVE_SEMANTIC_THREAD_PROTOCOL,
};
use luca_continuity::RevisionActor;
use std::collections::HashSet;

const MAX_HANDOFF_SEEDS: usize = 3;

/// Call only after the existing native handoff is validated and canonically
/// committed. The choice to carry is independent of awareness. Existing roots,
/// including explicitly closed ones, are never reopened by another handoff.
pub(crate) fn carry_committed_handoff(
    state: &AppState,
    owner: &Hex64,
    resident: &Hex64,
    source_event: &Hex64,
    handoff: &ResidentHandoffV1,
) -> Result<usize, InitiativeStoreErrorV1> {
    handoff
        .validate()
        .map_err(|_| InitiativeStoreErrorV1::Invalid)?;
    if handoff
        .source_event_ids
        .binary_search(source_event)
        .is_err()
    {
        return Err(InitiativeStoreErrorV1::Scope);
    }
    let app = state.app_handle.lock().map_err(|_| InitiativeStoreErrorV1::Unavailable)?
        .clone().ok_or(InitiativeStoreErrorV1::Unavailable)?;
    let dispatches = crate::luca::managed_dispatch_store::global_dispatch_store(&app)
        .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
    if !dispatches.lock().map_err(|_| InitiativeStoreErrorV1::Unavailable)?
        .automatic_derivatives_allowed_for_final(owner, resident, source_event)
    {
        return Ok(0);
    }
    let live =
        LiveAwarenessOwner::authenticate(state).map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
    if live.owner() != owner {
        return Err(InitiativeStoreErrorV1::Scope);
    }
    let scope = home_scope(state, owner, resident)?;
    let policy = state
        .companion_initiative
        .with_live(&live, &scope, |store| store.policy(&scope))?;
    if !policy.enabled {
        return Ok(0);
    }
    let snapshot = state
        .read_resident_initiative_threads(owner, resident, true)
        .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
    let known: HashSet<OpaqueId> = snapshot
        .map(|value| {
            value
                .threads
                .into_iter()
                .map(|view| view.thread.thread_id)
                .collect()
        })
        .unwrap_or_default();
    let mut created = 0;
    for thread in seed_candidates(owner, resident, handoff)? {
        if known.contains(&thread.thread_id) {
            continue;
        }
        // Re-check current identity before the canonical write, without storing
        // a key or treating the previous snapshot as a reusable permission.
        let _lease = live
            .lease()
            .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
        let request_id = OpaqueId::parse(format!("carry-{}", thread.thread_id.as_str()))
            .map_err(|_| InitiativeStoreErrorV1::Invalid)?;
        match state.commit_resident_initiative_thread(InitiativeThreadCommitRequestV1 {
            owner_pubkey: owner.clone(),
            resident_pubkey: resident.clone(),
            request_id,
            actor: RevisionActor::Resident,
            canonical_source_clean: true,
            own_authorship_proof: None,
            completion_cause: None,
            expected_head: None,
            thread,
        }) {
            Ok(_) => created += 1,
            Err(crate::luca::resident_notebook::InitiativeThreadStoreErrorV1::Stale) => {}
            Err(_) => return Err(InitiativeStoreErrorV1::Unavailable),
        }
    }
    Ok(created)
}

fn seed_candidates(
    owner: &Hex64,
    resident: &Hex64,
    handoff: &ResidentHandoffV1,
) -> Result<Vec<InitiativeSemanticThreadV1>, InitiativeStoreErrorV1> {
    if owner == resident {
        return Err(InitiativeStoreErrorV1::Scope);
    }
    let source_refs = handoff
        .source_event_ids
        .iter()
        .map(|id| {
            Sha256Ref::parse(format!("sha256:{}", id.as_str()))
                .map_err(|_| InitiativeStoreErrorV1::Invalid)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for body in handoff
        .commitments
        .iter()
        .chain(&handoff.unresolved_threads)
    {
        let normalized = body.split_whitespace().collect::<Vec<_>>().join(" ");
        if normalized.is_empty() || !seen.insert(normalized.clone()) {
            continue;
        }
        let digest = canonical_sha256(&serde_json::json!({
            "domain":"polyphonic.carried-handoff-thread.v1", "owner":owner, "resident":resident, "body":normalized,
        })).map_err(|_| InitiativeStoreErrorV1::Invalid)?;
        let thread = InitiativeSemanticThreadV1 {
            protocol: INITIATIVE_SEMANTIC_THREAD_PROTOCOL.into(),
            thread_id: OpaqueId::parse(format!("carried-{digest}"))
                .map_err(|_| InitiativeStoreErrorV1::Invalid)?,
            owner_pubkey: owner.clone(),
            resident_pubkey: resident.clone(),
            kind: InitiativeThreadKindV1::Shared,
            disposition: InitiativeDispositionV1::Carried,
            revision: SafeU53::new(0).map_err(|_| InitiativeStoreErrorV1::Invalid)?,
            body: body.clone(),
            source_event_ids: handoff.source_event_ids.clone(),
            source_refs: source_refs.clone(),
            eligible_after: None,
            created_at: handoff.updated_at.clone(),
            updated_at: handoff.updated_at.clone(),
        };
        thread
            .validate()
            .map_err(|_| InitiativeStoreErrorV1::Invalid)?;
        result.push(thread);
        if result.len() == MAX_HANDOFF_SEEDS {
            break;
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Hex64, Hex64, ResidentHandoffV1) {
        (
            Hex64::parse("a".repeat(64)).unwrap(),
            Hex64::parse("b".repeat(64)).unwrap(),
            ResidentHandoffV1 {
                summary: "A real exchange".into(),
                commitments: vec!["Finish the first working slice".into()],
                unresolved_threads: vec![
                    "Finish   the first working slice".into(),
                    "Consider a quieter return".into(),
                ],
                explicit_preferences: vec!["No needless interruptions".into()],
                source_event_ids: vec![Hex64::parse("c".repeat(64)).unwrap()],
                updated_at: luca_protocol::CanonicalTimestamp::parse("2026-10-08T09:00:00Z")
                    .unwrap(),
            },
        )
    }
    #[test]
    fn shared_threads_are_independent_stable_and_do_not_turn_preferences_into_work() {
        let (owner, resident, mut handoff) = fixture();
        let first = seed_candidates(&owner, &resident, &handoff).unwrap();
        assert_eq!(first.len(), 2);
        assert!(first
            .iter()
            .all(|thread| thread.kind == InitiativeThreadKindV1::Shared
                && thread.revision.get() == 0));
        handoff.summary = "A later exchange without the earlier unfinished work".into();
        handoff.source_event_ids = vec![Hex64::parse("d".repeat(64)).unwrap()];
        let later = seed_candidates(&owner, &resident, &handoff).unwrap();
        assert_eq!(first[0].thread_id, later[0].thread_id);
        assert_ne!(first[0].source_refs, later[0].source_refs);
    }
    #[test]
    fn no_unfinished_work_creates_no_seeds_and_no_minimum_task_quota() {
        let (owner, resident, mut handoff) = fixture();
        handoff.commitments.clear();
        handoff.unresolved_threads.clear();
        assert!(seed_candidates(&owner, &resident, &handoff)
            .unwrap()
            .is_empty());
    }
}
