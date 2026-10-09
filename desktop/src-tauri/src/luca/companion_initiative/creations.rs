//! Quiet resident-authored local Library preservation. No message, Canvas,
//! preview, memory store, owner-import impersonation or automatic notification.
use super::{executor::VerifiedInitiativePursuitV1, types::InitiativeRuntimeScopeV1};
use crate::luca::artifacts::{ArtifactStore, ArtifactWriteContext};
use luca_protocol::{
    canonical_sha256, ArtifactCreateArgsV1, ArtifactKindV1, ArtifactReceiptStateV1,
    ArtifactSourceV1, Hex64, InitiativePursuitOutcomeV1, OpaqueId, SafeU53, Sha256Ref,
};

/// Registered Promoted source-derived creation. Shared with artifact access guards.
pub(crate) const DERIVED_CREATION_PREFIX: &str = "initiative-creation-derived:";
/// Proven canonical-only creation, not an empty-parent observation/DAG node.
pub(crate) const CANONICAL_CREATION_PREFIX: &str = "initiative-creation-canonical:";

/// Trusted current promotion mode, never selected by the model or empty evidence alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InitiativeCreationModeV1 {
    Derived,
    CanonicalOnly,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InitiativeCreationErrorV1 {
    Invalid,
    Unavailable,
}

/// Body-free local receipt. Linked means Library preservation, not publication.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct InitiativeCreationReceiptV1 {
    pub artifact_id: OpaqueId,
    pub version: SafeU53,
    pub artifact_ref: Sha256Ref,
    pub dependency_node: OpaqueId,
    pub result_ref: Sha256Ref,
    pub duplicate: bool,
}

/// Stable prospective dependency/turn coordinate before any artifact bytes exist.
pub(crate) fn creation_node(
    owner: &Hex64,
    resident: &Hex64,
    job: &OpaqueId,
    mode: InitiativeCreationModeV1,
) -> Result<OpaqueId, InitiativeCreationErrorV1> {
    let digest = creation_digest(owner, resident, job)?;
    let prefix = match mode {
        InitiativeCreationModeV1::Derived => DERIVED_CREATION_PREFIX,
        InitiativeCreationModeV1::CanonicalOnly => CANONICAL_CREATION_PREFIX,
    };
    OpaqueId::parse(format!("{prefix}{digest}")).map_err(|_| InitiativeCreationErrorV1::Invalid)
}
fn creation_digest(
    owner: &Hex64,
    resident: &Hex64,
    job: &OpaqueId,
) -> Result<String, InitiativeCreationErrorV1> {
    if owner == resident {
        return Err(InitiativeCreationErrorV1::Invalid);
    }
    canonical_sha256(
        &serde_json::json!({"domain":"polyphonic.initiative.creation.v1",
        "owner":owner,"resident":resident,"job":job}),
    )
    .map_err(|_| InitiativeCreationErrorV1::Invalid)
}

/// Called only in the parent's current-head/promotion/policy barrier. Derived
/// mode's node must already be registered by with_promotion_lease; CanonicalOnly
/// requires explicit current authorship authority and no existing source deps.
/// The sealed work comes only from the native private endpoint, never renderer input.
pub(crate) fn persist_creation(
    artifacts: &mut ArtifactStore,
    scope: &InitiativeRuntimeScopeV1,
    work: &VerifiedInitiativePursuitV1,
    mode: InitiativeCreationModeV1,
) -> Result<InitiativeCreationReceiptV1, InitiativeCreationErrorV1> {
    let request = work.request();
    let result = work.result();
    result
        .validate_against_at(request, scope.control.now_unix_ms)
        .map_err(|_| InitiativeCreationErrorV1::Invalid)?;
    if request.owner_pubkey != scope.control.owner_pubkey
        || request.resident_pubkey != scope.control.resident_pubkey
        || request.binding_ref != scope.binding_ref
        || request.session_epoch != scope.session_epoch
    {
        return Err(InitiativeCreationErrorV1::Invalid);
    }
    let InitiativePursuitOutcomeV1::Created {
        title,
        markdown,
        source_refs,
    } = &result.result
    else {
        return Err(InitiativeCreationErrorV1::Invalid);
    };
    if title.chars().count() > luca_protocol::MAX_ARTIFACT_TITLE_CHARS {
        return Err(InitiativeCreationErrorV1::Invalid);
    }
    let node = creation_node(
        &request.owner_pubkey,
        &request.resident_pubkey,
        &request.job_id,
        mode,
    )?;
    let digest = creation_digest(
        &request.owner_pubkey,
        &request.resident_pubkey,
        &request.job_id,
    )?;
    let idempotency_key = OpaqueId::parse(format!("initiative-creation:{digest}"))
        .map_err(|_| InitiativeCreationErrorV1::Invalid)?;
    let result_ref = work
        .result_ref()
        .map_err(|_| InitiativeCreationErrorV1::Invalid)?;
    // Host provenance is deliberately labelled, separate from the authored prose.
    // Only admitted hashes/opaque coordinates are appended; no source path/title.
    let mut content = markdown.clone();
    content.push_str("\n\n---\n\nSources (host provenance):\n");
    for reference in source_refs {
        content.push_str(&format!("\n- `{}`", reference.as_str()));
    }
    content.push_str(&format!("\n\nAuthored result: `{}`\n", result_ref.as_str()));
    let context = ArtifactWriteContext {
        owner_pubkey: request.owner_pubkey.clone(),
        author_pubkey: request.resident_pubkey.clone(),
        resident_pubkey: request.resident_pubkey.clone(),
        conversation_id: None,
        turn_id: Some(node.clone()),
        dispatch_receipt_id: None,
        working_root_id: None,
        receipt_state: ArtifactReceiptStateV1::Linked,
    };
    let args = ArtifactCreateArgsV1 {
        title: title.clone(),
        kind: ArtifactKindV1::Markdown,
        source: ArtifactSourceV1::InlineText {
            content_utf8: content,
            declared_media_type: Some("text/markdown".into()),
        },
        idempotency_key,
        attach_to_reply: false,
    };
    let commit = artifacts
        .create(&context, &args, None)
        .map_err(|_| InitiativeCreationErrorV1::Unavailable)?;
    if commit.artifact.created_by_pubkey != request.resident_pubkey.as_str()
        || commit.receipt.resident_pubkey != request.resident_pubkey.as_str()
        || commit.artifact.conversation_id.is_some()
        || commit.receipt.message_id.is_some()
        || commit.artifact.source_turn_id.as_deref() != Some(node.as_str())
    {
        return Err(InitiativeCreationErrorV1::Invalid);
    }
    Ok(InitiativeCreationReceiptV1 {
        artifact_id: OpaqueId::parse(commit.artifact.artifact_id)
            .map_err(|_| InitiativeCreationErrorV1::Invalid)?,
        version: SafeU53::new(commit.version.version)
            .map_err(|_| InitiativeCreationErrorV1::Invalid)?,
        artifact_ref: Sha256Ref::parse(format!("sha256:{}", commit.version.aggregate_hash))
            .map_err(|_| InitiativeCreationErrorV1::Invalid)?,
        dependency_node: node,
        result_ref,
        duplicate: commit.duplicate,
    })
}
