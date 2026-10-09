//! Native-authored private curiosities in the one encrypted canonical notebook.
//! No extra model call, hidden reasoning, owner commitment, journal or gift.
//! This first lane admits only authenticated source-clean canonical parents;
//! observed/richer parents remain unavailable until exact promotion is supported.
//! Authorship proves attribution and native completion, not a claim's truth,
//! external research, subjective valence or an obligation to produce a gift.

use super::{executor::{InitiativeExecutorErrorV1, VerifiedInitiativePursuitV1}, InitiativeRuntimeScopeV1};
use crate::luca::{
    continuity_revision_authority::RevisionAuthorityTokenV1,
    resident_notebook::{InitiativeThreadCommitRequestV1, InitiativeThreadRevisionViewV1},
};
use luca_continuity::RevisionActor;
use luca_protocol::{canonical_sha256, CanonicalTimestamp, Hex64, InitiativeDispositionV1, InitiativePursuitOutcomeV1,
    InitiativeSemanticThreadV1, InitiativeThreadKindV1, OpaqueId, SafeU53, Sha256Ref,
    INITIATIVE_SEMANTIC_THREAD_PROTOCOL};

/// Owned host proof of actual completed private-native authorship. No serde,
/// Debug, Clone or public constructor; model/IPC/body data cannot issue it.
/// It binds the immutable current parent generation, not a reusable capability.
pub(crate) struct VerifiedOwnInquiryAuthorshipV1 {
    authority: RevisionAuthorityTokenV1,
    parent_record: OpaqueId,
    parent_semantic_ref: Sha256Ref,
    owner: Hex64,
    resident: Hex64,
    thread_id: OpaqueId,
    body_ref: Sha256Ref,
    source_refs: Vec<Sha256Ref>,
    result_ref: Sha256Ref,
    admitted_at: CanonicalTimestamp,
}
impl VerifiedOwnInquiryAuthorshipV1 {
    /// Exact capture needed by the canonical CAS; not execution authority.
    pub(crate) fn authority(&self) -> &RevisionAuthorityTokenV1 { &self.authority }
    /// Verify this proof belongs to the same held parent, never a later handoff.
    pub(crate) fn matches_parent(&self, token: &RevisionAuthorityTokenV1, parent: &InitiativeThreadRevisionViewV1) -> bool {
        token == &self.authority && parent.record_id == self.parent_record
            && parent.canonical_revision_ref == self.parent_semantic_ref
            && parent.thread.owner_pubkey == self.owner && parent.thread.resident_pubkey == self.resident
            && authenticated_native_parent(parent).unwrap_or(false)
    }
    /// Verify only the immutable revision-zero Own body sealed from native work.
    pub(crate) fn matches_thread(&self, thread: &InitiativeSemanticThreadV1) -> bool {
        thread.owner_pubkey == self.owner && thread.resident_pubkey == self.resident
            && thread.thread_id == self.thread_id && thread.kind == InitiativeThreadKindV1::Own
            && thread.revision.get() == 0 && thread.disposition == InitiativeDispositionV1::Carried
            && thread.source_event_ids.is_empty() && thread.source_refs == self.source_refs
            && thread.source_refs.contains(&self.parent_semantic_ref)
            && thread.source_refs.contains(&self.result_ref)
            && thread.created_at == self.admitted_at && thread.updated_at == self.admitted_at
            && body_ref(&thread.body).is_ok_and(|hash| hash == self.body_ref)
    }
}

/// Current authenticated source-clean seed. Own is not disguised as a signed
/// owner commitment. Protected birthmarks survive disposition-only successors,
/// so old roots do not depend on the latest shared handoff or recent chat window.
pub(crate) fn authenticated_native_parent(view: &InitiativeThreadRevisionViewV1) -> Result<bool, InitiativeExecutorErrorV1> {
    let thread = &view.thread;
    if !view.is_current || view.current_head_record_id.as_ref() != Some(&view.record_id)
        || view.pinned_owner_correction || view.author_kind.as_str() != "resident"
        || matches!(thread.disposition, InitiativeDispositionV1::Declined | InitiativeDispositionV1::Retired | InitiativeDispositionV1::Completed)
        || thread.revision_ref().map_err(|_| InitiativeExecutorErrorV1::Invalid)? != view.canonical_revision_ref
    { return Ok(false); }
    thread.validate().map_err(|_| InitiativeExecutorErrorV1::Invalid)?;
    match thread.kind {
        InitiativeThreadKindV1::Shared => {
            if !view.canonical_source_clean || thread.source_event_ids.is_empty()
                || thread.source_refs.len() != thread.source_event_ids.len()
                || thread.source_refs.iter().zip(&thread.source_event_ids).any(|(r,e)|r.as_str().strip_prefix("sha256:") != Some(e.as_str()))
            { return Ok(false); }
            let body = thread.body.split_whitespace().collect::<Vec<_>>().join(" ");
            let hash = canonical_sha256(&serde_json::json!({"domain":"polyphonic.carried-handoff-thread.v1","owner":thread.owner_pubkey,"resident":thread.resident_pubkey,"body":body}))
                .map_err(|_| InitiativeExecutorErrorV1::Invalid)?;
            Ok(thread.thread_id.as_str() == format!("carried-{hash}"))
        }
        InitiativeThreadKindV1::Own => Ok(view.canonical_own_authorship && !view.canonical_source_clean
            && thread.source_event_ids.is_empty() && thread.source_refs.len() >= 2
            && thread.thread_id.as_str().strip_prefix("own-inquiry-").is_some_and(|id|Hex64::parse(id).is_ok())),
    }
}

/// Issue a sealed revision-zero Own request only from a matched completed native
/// result, current clean parent and current exact runtime/deadline. No empty
/// observation list or model-written source-clean flag establishes this proof.
pub(crate) fn native_own_request(
    scope: &InitiativeRuntimeScopeV1,
    token: &RevisionAuthorityTokenV1,
    parent: &InitiativeThreadRevisionViewV1,
    work: &VerifiedInitiativePursuitV1,
) -> Result<InitiativeThreadCommitRequestV1, InitiativeExecutorErrorV1> {
    let request = work.request();
    work.result().validate_against_at(request, scope.control.now_unix_ms).map_err(|_| InitiativeExecutorErrorV1::Invalid)?;
    if scope.foreground_active || scope.control.owner_pubkey != request.owner_pubkey
        || scope.control.resident_pubkey != request.resident_pubkey || scope.binding_ref != request.binding_ref
        || scope.session_epoch != request.session_epoch || token.owner_pubkey != request.owner_pubkey
        || parent.thread != request.semantic_thread || parent.canonical_revision_ref != request.thread.canonical_revision_ref
        || !request.evidence.is_empty() || !authenticated_native_parent(parent)?
    { return Err(InitiativeExecutorErrorV1::Unavailable); }
    let thread = own_thread_from_result(request, work.result())?;
    let result_ref = work.result_ref()?;
    let proof = VerifiedOwnInquiryAuthorshipV1 {
        authority: token.clone(), parent_record: parent.record_id.clone(),
        parent_semantic_ref: parent.canonical_revision_ref.clone(), owner: request.owner_pubkey.clone(),
        resident: request.resident_pubkey.clone(), thread_id: thread.thread_id.clone(), body_ref: body_ref(&thread.body)?,
        source_refs: thread.source_refs.clone(), result_ref, admitted_at: request.admitted_at.clone(),
    };
    Ok(InitiativeThreadCommitRequestV1 {
        owner_pubkey: request.owner_pubkey.clone(), resident_pubkey: request.resident_pubkey.clone(),
        request_id: request.job_id.clone(), actor: RevisionActor::Resident,
        canonical_source_clean: false, own_authorship_proof: Some(proof), completion_cause: None,
        expected_head: None, thread,
    })
}

/// Pure correlated semantic projection, NOT authorship/retention authority.
/// Used to compare a canonical receipt to the exact result before ledger sync;
/// persistence still requires the sealed native proof and held current parent.
pub(crate) fn own_thread_from_result(
    request: &luca_protocol::InitiativePursuitRequestV1,
    result: &luca_protocol::InitiativePursuitResultV1,
) -> Result<InitiativeSemanticThreadV1, InitiativeExecutorErrorV1> {
    result.validate_against(request).map_err(|_| InitiativeExecutorErrorV1::Invalid)?;
    let InitiativePursuitOutcomeV1::OwnInquiry {body, source_refs} = &result.result else { return Err(InitiativeExecutorErrorV1::Invalid); };
    let result_hash = canonical_sha256(result).map_err(|_| InitiativeExecutorErrorV1::Invalid)?;
    let result_ref = Sha256Ref::parse(format!("sha256:{result_hash}")).map_err(|_| InitiativeExecutorErrorV1::Invalid)?;
    let mut sources = source_refs.clone();sources.push(result_ref);sources.sort();sources.dedup();
    let thread = InitiativeSemanticThreadV1 {
        protocol: INITIATIVE_SEMANTIC_THREAD_PROTOCOL.into(), thread_id: own_root_id(request)?,
        owner_pubkey: request.owner_pubkey.clone(), resident_pubkey: request.resident_pubkey.clone(),
        kind: InitiativeThreadKindV1::Own, disposition: InitiativeDispositionV1::Carried,
        revision: SafeU53::new(0).map_err(|_| InitiativeExecutorErrorV1::Invalid)?, body: body.clone(),
        source_event_ids: Vec::new(), source_refs: sources.clone(), eligible_after: None,
        // Stable native-admission time, not a fabricated capture/activity time.
        // Actual completion time is recorded in the separate body-free job.
        created_at: request.admitted_at.clone(), updated_at: request.admitted_at.clone(),
    };
    thread.validate().map_err(|_| InitiativeExecutorErrorV1::Invalid)?;
    Ok(thread)
}
/// Stable exact-owner/resident/job native lineage, independent of recent chat.
pub(crate) fn own_root_id(request: &luca_protocol::InitiativePursuitRequestV1) -> Result<OpaqueId, InitiativeExecutorErrorV1> {
    let hash = canonical_sha256(&serde_json::json!({"domain":"polyphonic.own-inquiry.native-root.v1",
        "owner":request.owner_pubkey,"resident":request.resident_pubkey,"job":request.job_id}))
        .map_err(|_| InitiativeExecutorErrorV1::Invalid)?;
    OpaqueId::parse(format!("own-inquiry-{hash}")).map_err(|_| InitiativeExecutorErrorV1::Invalid)
}
fn body_ref(body: &str) -> Result<Sha256Ref, InitiativeExecutorErrorV1> {
    let hash = canonical_sha256(&serde_json::json!({"domain":"polyphonic.own-inquiry.body.v1","body":body}))
        .map_err(|_| InitiativeExecutorErrorV1::Invalid)?;
    Sha256Ref::parse(format!("sha256:{hash}")).map_err(|_| InitiativeExecutorErrorV1::Invalid)
}

#[cfg(test)]
#[path = "own_inquiries_tests.rs"]
pub(crate) mod tests;
