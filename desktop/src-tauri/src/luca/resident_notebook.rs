//! Encrypted resident notebook lifecycle and atomic metabolism commits.

use std::sync::Mutex;

use luca_continuity::{
    decrypt_record, derive_revision_idempotency_key, encrypt_record, encrypted_record_reference,
    PurgeExecutionStatusV1, RetrievalMaterialV1, RevisionActor, RevisionLifecycle,
    RevisionOperation, RevisionRequest,
};
use luca_protocol::{
    canonical_sha256, Hex64, OpaqueId, ResidentHandoffV1, ResidentJournalAnnotationV1,
    ResidentJournalPageV1, ResidentMemoryNoteCategoryV1, ResidentMemoryNoteMutationV1,
    ResidentMemoryNoteV1, ResidentNotebookStatusV1, SafeU53, Sha256Ref, CONTINUITY_PROTOCOL,
};

use crate::app_state::ContinuityLifecycleLock;

use super::{
    continuity_context::resident_notebook_address,
    continuity_key_custody::{load_existing_desktop_master_key, ContinuityMasterKeyState},
    continuity_key_derivation::derive_namespace_key,
    continuity_revision_authority::{AuthorityExpectationV1, StoredRevisionGenerationV1},
    continuity_runtime::{ContinuityRuntimeDegradedReason, ContinuityRuntimeState},
    continuity_store::ContinuityStoreError,
};

/// One exact resident-authored metabolism proposal. Body-bearing by design;
/// this type never implements `Debug`.
pub(crate) struct ResidentMetabolismCommitRequestV1 {
    pub(crate) owner_pubkey: Hex64,
    pub(crate) resident_pubkey: Hex64,
    pub(crate) source_event_id: Hex64,
    pub(crate) request_id: OpaqueId,
    pub(crate) handoff: Option<ResidentHandoffV1>,
    pub(crate) memory_note_mutations: Vec<ResidentMemoryNoteMutationV1>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ResidentMetabolismCommitReceiptV1 {
    pub(crate) resident_pubkey: Hex64,
    pub(crate) source_event_id: Hex64,
    pub(crate) record_ids: Vec<OpaqueId>,
    pub(crate) replayed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ResidentMetabolismCommitOutcomeV1 {
    Committed(ResidentMetabolismCommitReceiptV1),
    Locked,
    Unavailable,
    Stale,
    Invalid,
}

/// Resident-authored journal page create or revision request. Body-bearing by
/// design and therefore deliberately not `Debug`.
pub(crate) struct ResidentJournalCommitRequestV1 {
    pub(crate) owner_pubkey: Hex64,
    pub(crate) resident_pubkey: Hex64,
    pub(crate) request_id: OpaqueId,
    pub(crate) target_page_id: Option<OpaqueId>,
    pub(crate) page: ResidentJournalPageV1,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ResidentNotebookCommitReceiptV1 {
    pub(crate) resident_pubkey: Hex64,
    pub(crate) lineage_root_id: OpaqueId,
    pub(crate) record_id: OpaqueId,
    pub(crate) revision: SafeU53,
    pub(crate) replayed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ResidentNotebookMutationOutcomeV1 {
    Committed(ResidentNotebookCommitReceiptV1),
    Empty,
    Locked,
    Unavailable,
    Stale,
    Invalid,
}

/// Explicitly disclosed notebook body. This type intentionally has no `Debug`
/// implementation so UI-bound plaintext cannot leak through diagnostics.
pub(crate) enum ResidentNotebookBodyV1 {
    MemoryNote(ResidentMemoryNoteV1),
    JournalPage(ResidentJournalPageV1),
    JournalAnnotation(ResidentJournalAnnotationV1),
}

/// One effective or historical encrypted notebook revision disclosed only by
/// an owner-facing notebook command.
pub(crate) struct ResidentNotebookRevisionViewV1 {
    pub(crate) lineage_root_id: OpaqueId,
    pub(crate) record_id: OpaqueId,
    pub(crate) record_type: OpaqueId,
    pub(crate) revision: SafeU53,
    pub(crate) status: ResidentNotebookStatusV1,
    pub(crate) pinned_owner_correction: bool,
    pub(crate) author_kind: OpaqueId,
    pub(crate) provenance_refs: Vec<Sha256Ref>,
    pub(crate) body: ResidentNotebookBodyV1,
}

pub(crate) enum ResidentNotebookReadOutcomeV1 {
    Ready(Vec<ResidentNotebookRevisionViewV1>),
    Empty,
    Locked,
    Unavailable,
    Invalid,
}

struct PreparedRevision {
    request: RevisionRequest,
    record_id: OpaqueId,
}

struct RevisionMaterial<'a> {
    record_type: &'static str,
    lineage_root_id: OpaqueId,
    record_id: OpaqueId,
    expected_head_record_id: Option<OpaqueId>,
    revision: SafeU53,
    operation: RevisionOperation,
    actor: RevisionActor,
    created_at: luca_protocol::CanonicalTimestamp,
    body: String,
    tags: Vec<String>,
    provenance_refs: Vec<Sha256Ref>,
    request_domain: &'static str,
    request_id: &'a OpaqueId,
}

/// Atomically commit an optional handoff plus at most three source-backed
/// memory-note mutations. Chat remains independent of every terminal outcome.
pub(crate) fn commit_resident_metabolism(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    request: ResidentMetabolismCommitRequestV1,
) -> ResidentMetabolismCommitOutcomeV1 {
    if !valid_metabolism_request(&request) {
        return ResidentMetabolismCommitOutcomeV1::Invalid;
    }
    let _guard = match lifecycle.lock() {
        Ok(guard) => guard,
        Err(_) => return ResidentMetabolismCommitOutcomeV1::Unavailable,
    };
    let root = match load_existing_desktop_master_key() {
        ContinuityMasterKeyState::Ready(root) => root,
        ContinuityMasterKeyState::Locked => return ResidentMetabolismCommitOutcomeV1::Locked,
        ContinuityMasterKeyState::Unavailable => {
            return ResidentMetabolismCommitOutcomeV1::Unavailable;
        }
        ContinuityMasterKeyState::Corrupt => return ResidentMetabolismCommitOutcomeV1::Invalid,
    };
    let mut state = match runtime_state.lock() {
        Ok(state) => state,
        Err(_) => return ResidentMetabolismCommitOutcomeV1::Unavailable,
    };
    let runtime = match &mut *state {
        ContinuityRuntimeState::Ready(runtime) if runtime.owner_pubkey == request.owner_pubkey => {
            runtime
        }
        ContinuityRuntimeState::Ready(_) => return ResidentMetabolismCommitOutcomeV1::Invalid,
        ContinuityRuntimeState::Degraded(ContinuityRuntimeDegradedReason::KeyLocked) => {
            return ResidentMetabolismCommitOutcomeV1::Locked;
        }
        ContinuityRuntimeState::Degraded(ContinuityRuntimeDegradedReason::RestorePending) => {
            return ResidentMetabolismCommitOutcomeV1::Stale;
        }
        ContinuityRuntimeState::Degraded(_) | ContinuityRuntimeState::Uninitialized => {
            return ResidentMetabolismCommitOutcomeV1::Unavailable;
        }
    };
    let key_version = match runtime
        .store
        .active_owner_key_version(&request.owner_pubkey)
    {
        Ok(value) => value,
        Err(_) => return ResidentMetabolismCommitOutcomeV1::Unavailable,
    };
    let address = match resident_notebook_address(
        &request.owner_pubkey,
        &request.resident_pubkey,
        key_version,
    ) {
        Ok(value) => value,
        Err(_) => return ResidentMetabolismCommitOutcomeV1::Invalid,
    };
    let generation = match runtime
        .store
        .load_revision_generation(&request.owner_pubkey)
    {
        Ok(value) => value,
        Err(_) => return ResidentMetabolismCommitOutcomeV1::Unavailable,
    };
    let source_ref = match source_ref(&request.source_event_id) {
        Some(value) => value,
        None => return ResidentMetabolismCommitOutcomeV1::Invalid,
    };
    if metabolism_already_committed(generation.as_ref(), &address, &source_ref) {
        let ids = metabolism_source_record_ids(generation.as_ref(), &address, &source_ref);
        return ResidentMetabolismCommitOutcomeV1::Committed(ResidentMetabolismCommitReceiptV1 {
            resident_pubkey: request.resident_pubkey,
            source_event_id: request.source_event_id,
            record_ids: ids,
            replayed: true,
        });
    }

    let namespace_key = match derive_namespace_key(&root, address.namespace()) {
        Ok(value) => value,
        Err(_) => return ResidentMetabolismCommitOutcomeV1::Invalid,
    };
    let mut prepared = Vec::new();
    let preserve_pinned_handoff = if request.handoff.is_some() {
        match active_lineage(generation.as_ref(), &address, "handoff", None) {
            Ok(Some(lineage)) => lineage.pinned_owner_correction,
            Ok(None) => false,
            Err(outcome) => return outcome,
        }
    } else {
        false
    };
    if preserve_pinned_handoff && request.memory_note_mutations.is_empty() {
        return ResidentMetabolismCommitOutcomeV1::Stale;
    }
    if let Some(handoff) = request
        .handoff
        .as_ref()
        .filter(|_| !preserve_pinned_handoff)
    {
        let revision = match prepare_handoff_revision(
            generation.as_ref(),
            &address,
            &request,
            handoff,
            source_ref.clone(),
            key_version,
            namespace_key.as_bytes(),
        ) {
            Ok(value) => value,
            Err(outcome) => return outcome,
        };
        prepared.push(revision);
    }
    for mutation in &request.memory_note_mutations {
        let revision = match prepare_memory_note_revision(
            generation.as_ref(),
            &address,
            &request,
            mutation,
            source_ref.clone(),
            key_version,
            namespace_key.as_bytes(),
        ) {
            Ok(value) => value,
            Err(outcome) => return outcome,
        };
        prepared.push(revision);
    }
    let expectation = generation
        .as_ref()
        .map(|value| AuthorityExpectationV1::Existing(value.token.clone()))
        .unwrap_or_else(|| AuthorityExpectationV1::UninitializedOwner {
            owner_pubkey: request.owner_pubkey.clone(),
            active_root_key_version: key_version,
        });
    let record_ids = prepared
        .iter()
        .map(|value| value.record_id.clone())
        .collect::<Vec<_>>();
    match runtime.store.apply_revision_batch_cas(
        &expectation,
        prepared.into_iter().map(|value| value.request).collect(),
    ) {
        Ok(result) => {
            debug_assert_eq!(result.receipts.len(), record_ids.len());
            let _authority_token = result.token;
            ResidentMetabolismCommitOutcomeV1::Committed(ResidentMetabolismCommitReceiptV1 {
                resident_pubkey: request.resident_pubkey,
                source_event_id: request.source_event_id,
                record_ids,
                replayed: result.replayed,
            })
        }
        Err(ContinuityStoreError::CompareAndSwapConflict)
        | Err(ContinuityStoreError::LifecycleConflict) => ResidentMetabolismCommitOutcomeV1::Stale,
        Err(_) => ResidentMetabolismCommitOutcomeV1::Invalid,
    }
}

/// Commit one manually requested resident-authored journal page. The exact
/// resident binding is established by the private cognition channel before
/// this storage boundary is reached.
pub(crate) fn commit_resident_journal_page(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    request: ResidentJournalCommitRequestV1,
) -> ResidentNotebookMutationOutcomeV1 {
    if request.owner_pubkey == request.resident_pubkey || request.page.validate().is_err() {
        return ResidentNotebookMutationOutcomeV1::Invalid;
    }
    let _guard = match lifecycle.lock() {
        Ok(guard) => guard,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Unavailable,
    };
    let root = match load_existing_desktop_master_key() {
        ContinuityMasterKeyState::Ready(root) => root,
        ContinuityMasterKeyState::Locked => return ResidentNotebookMutationOutcomeV1::Locked,
        ContinuityMasterKeyState::Unavailable => {
            return ResidentNotebookMutationOutcomeV1::Unavailable;
        }
        ContinuityMasterKeyState::Corrupt => return ResidentNotebookMutationOutcomeV1::Invalid,
    };
    let mut state = match runtime_state.lock() {
        Ok(state) => state,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Unavailable,
    };
    let runtime = match &mut *state {
        ContinuityRuntimeState::Ready(runtime) if runtime.owner_pubkey == request.owner_pubkey => {
            runtime
        }
        ContinuityRuntimeState::Ready(_) => return ResidentNotebookMutationOutcomeV1::Invalid,
        ContinuityRuntimeState::Degraded(ContinuityRuntimeDegradedReason::KeyLocked) => {
            return ResidentNotebookMutationOutcomeV1::Locked;
        }
        ContinuityRuntimeState::Degraded(ContinuityRuntimeDegradedReason::RestorePending) => {
            return ResidentNotebookMutationOutcomeV1::Stale;
        }
        ContinuityRuntimeState::Degraded(_) | ContinuityRuntimeState::Uninitialized => {
            return ResidentNotebookMutationOutcomeV1::Unavailable;
        }
    };
    let key_version = match runtime
        .store
        .active_owner_key_version(&request.owner_pubkey)
    {
        Ok(value) => value,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Unavailable,
    };
    let address = match resident_notebook_address(
        &request.owner_pubkey,
        &request.resident_pubkey,
        key_version,
    ) {
        Ok(value) => value,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Invalid,
    };
    let generation = match runtime
        .store
        .load_revision_generation(&request.owner_pubkey)
    {
        Ok(value) => value,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Unavailable,
    };
    let root_id = request
        .target_page_id
        .as_ref()
        .unwrap_or(&request.page.page_id);
    let active = match active_lineage(generation.as_ref(), &address, "journal", Some(root_id)) {
        Ok(value) => value,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Invalid,
    };
    match (&request.target_page_id, active) {
        (None, Some(_)) => return ResidentNotebookMutationOutcomeV1::Invalid,
        (Some(_), None) => return ResidentNotebookMutationOutcomeV1::Stale,
        _ => {}
    }
    if generation.as_ref().is_some_and(|generation| {
        generation
            .snapshot
            .records
            .iter()
            .any(|record| record.record_id == request.page.page_id)
    }) {
        return ResidentNotebookMutationOutcomeV1::Invalid;
    }
    let (operation, lineage_root_id, expected_head_record_id, revision) =
        match revision_coordinates(generation.as_ref(), active, request.page.page_id.clone()) {
            Ok(value) => value,
            Err(_) => return ResidentNotebookMutationOutcomeV1::Invalid,
        };
    let namespace_key = match derive_namespace_key(&root, address.namespace()) {
        Ok(value) => value,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Invalid,
    };
    let body = match serde_json::to_string(&request.page) {
        Ok(value) => value,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Invalid,
    };
    let provenance_refs = match request
        .page
        .source_event_ids
        .iter()
        .map(source_ref)
        .collect::<Option<Vec<_>>>()
    {
        Some(value) => value,
        None => return ResidentNotebookMutationOutcomeV1::Invalid,
    };
    let prepared = match prepare_revision(
        &address,
        key_version,
        namespace_key.as_bytes(),
        RevisionMaterial {
            record_type: "journal",
            lineage_root_id: lineage_root_id.clone(),
            record_id: request.page.page_id.clone(),
            expected_head_record_id,
            revision,
            operation,
            actor: RevisionActor::Resident,
            created_at: request.page.updated_at.clone(),
            body,
            tags: vec!["journal".to_owned()],
            provenance_refs,
            request_domain: "luca.resident-journal.page.v1",
            request_id: &request.request_id,
        },
    ) {
        Ok(value) => value,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Invalid,
    };
    let expectation = generation
        .as_ref()
        .map(|value| AuthorityExpectationV1::Existing(value.token.clone()))
        .unwrap_or_else(|| AuthorityExpectationV1::UninitializedOwner {
            owner_pubkey: request.owner_pubkey.clone(),
            active_root_key_version: key_version,
        });
    match runtime
        .store
        .apply_revision_transition_cas(&expectation, prepared.request)
    {
        Ok(result) => {
            ResidentNotebookMutationOutcomeV1::Committed(ResidentNotebookCommitReceiptV1 {
                resident_pubkey: request.resident_pubkey,
                lineage_root_id,
                record_id: request.page.page_id,
                revision,
                replayed: result.replayed,
            })
        }
        Err(ContinuityStoreError::CompareAndSwapConflict)
        | Err(ContinuityStoreError::LifecycleConflict) => ResidentNotebookMutationOutcomeV1::Stale,
        Err(_) => ResidentNotebookMutationOutcomeV1::Invalid,
    }
}

/// Read notebook revisions only after an explicit owner disclosure action.
/// Journal and annotation bodies never pass through ordinary retrieval.
pub(crate) fn read_resident_notebook(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
    resident_pubkey: &Hex64,
    include_history: bool,
) -> ResidentNotebookReadOutcomeV1 {
    if owner_pubkey == resident_pubkey {
        return ResidentNotebookReadOutcomeV1::Invalid;
    }
    let _guard = match lifecycle.lock() {
        Ok(guard) => guard,
        Err(_) => return ResidentNotebookReadOutcomeV1::Unavailable,
    };
    let root = match load_existing_desktop_master_key() {
        ContinuityMasterKeyState::Ready(root) => root,
        ContinuityMasterKeyState::Locked => return ResidentNotebookReadOutcomeV1::Locked,
        ContinuityMasterKeyState::Unavailable => {
            return ResidentNotebookReadOutcomeV1::Unavailable;
        }
        ContinuityMasterKeyState::Corrupt => return ResidentNotebookReadOutcomeV1::Invalid,
    };
    let state = match runtime_state.lock() {
        Ok(state) => state,
        Err(_) => return ResidentNotebookReadOutcomeV1::Unavailable,
    };
    let runtime = match &*state {
        ContinuityRuntimeState::Ready(runtime) if &runtime.owner_pubkey == owner_pubkey => runtime,
        ContinuityRuntimeState::Ready(_) => return ResidentNotebookReadOutcomeV1::Invalid,
        ContinuityRuntimeState::Degraded(ContinuityRuntimeDegradedReason::KeyLocked) => {
            return ResidentNotebookReadOutcomeV1::Locked;
        }
        ContinuityRuntimeState::Degraded(_) | ContinuityRuntimeState::Uninitialized => {
            return ResidentNotebookReadOutcomeV1::Unavailable;
        }
    };
    let key_version = match runtime.store.active_owner_key_version(owner_pubkey) {
        Ok(value) => value,
        Err(_) => return ResidentNotebookReadOutcomeV1::Unavailable,
    };
    let address = match resident_notebook_address(owner_pubkey, resident_pubkey, key_version) {
        Ok(value) => value,
        Err(_) => return ResidentNotebookReadOutcomeV1::Invalid,
    };
    let generation = match runtime.store.load_revision_generation(owner_pubkey) {
        Ok(Some(value)) => value,
        Ok(None) => return ResidentNotebookReadOutcomeV1::Empty,
        Err(_) => return ResidentNotebookReadOutcomeV1::Unavailable,
    };
    let namespace_key = match derive_namespace_key(&root, address.namespace()) {
        Ok(value) => value,
        Err(_) => return ResidentNotebookReadOutcomeV1::Invalid,
    };
    let mut views = Vec::new();
    let mut matched = 0_usize;
    for lineage in generation.snapshot.lineages.iter().filter(|lineage| {
        lineage.namespace == *address.namespace().as_protocol()
            && lineage.scope == *address.as_protocol()
            && matches!(
                lineage.record_type.as_str(),
                "memory-note" | "journal" | "journal-annotation"
            )
            && lineage.lifecycle != RevisionLifecycle::Forgotten
    }) {
        let record_ids = if include_history {
            lineage.record_ids.clone()
        } else {
            lineage.active_head_record_id.iter().cloned().collect()
        };
        for record_id in record_ids {
            matched += 1;
            let Some(record) = generation
                .snapshot
                .records
                .iter()
                .find(|record| record.record_id == record_id)
            else {
                return ResidentNotebookReadOutcomeV1::Invalid;
            };
            let material = match decrypt_record(record, namespace_key.as_bytes())
                .and_then(RetrievalMaterialV1::decode)
            {
                Ok(value) => value,
                Err(_) => continue,
            };
            if material.provenance_refs() != record.provenance_refs.as_slice() {
                continue;
            }
            let body = match record.record_type.as_str() {
                "memory-note" => serde_json::from_str::<ResidentMemoryNoteV1>(material.body())
                    .ok()
                    .filter(|value| value.validate().is_ok())
                    .map(ResidentNotebookBodyV1::MemoryNote),
                "journal" => serde_json::from_str::<ResidentJournalPageV1>(material.body())
                    .ok()
                    .filter(|value| value.validate().is_ok())
                    .map(ResidentNotebookBodyV1::JournalPage),
                "journal-annotation" => {
                    serde_json::from_str::<ResidentJournalAnnotationV1>(material.body())
                        .ok()
                        .filter(|value| value.validate().is_ok())
                        .map(ResidentNotebookBodyV1::JournalAnnotation)
                }
                _ => None,
            };
            let Some(body) = body else { continue };
            views.push(ResidentNotebookRevisionViewV1 {
                lineage_root_id: lineage.lineage_root_id.clone(),
                record_id: record.record_id.clone(),
                record_type: record.record_type.clone(),
                revision: record.revision,
                status: match lineage.lifecycle {
                    RevisionLifecycle::Active
                        if lineage.active_head_record_id.as_ref() == Some(&record.record_id) =>
                    {
                        ResidentNotebookStatusV1::Active
                    }
                    RevisionLifecycle::Active => ResidentNotebookStatusV1::Superseded,
                    RevisionLifecycle::Archived => ResidentNotebookStatusV1::Archived,
                    RevisionLifecycle::Forgotten => ResidentNotebookStatusV1::Forgotten,
                },
                pinned_owner_correction: lineage.pinned_owner_correction,
                author_kind: record.author_kind.clone(),
                provenance_refs: record.provenance_refs.clone(),
                body,
            });
        }
    }
    views.sort_by(|left, right| {
        left.record_type
            .cmp(&right.record_type)
            .then_with(|| left.lineage_root_id.cmp(&right.lineage_root_id))
            .then_with(|| left.revision.cmp(&right.revision))
    });
    if views.is_empty() {
        if matched == 0 {
            ResidentNotebookReadOutcomeV1::Empty
        } else {
            ResidentNotebookReadOutcomeV1::Invalid
        }
    } else {
        ResidentNotebookReadOutcomeV1::Ready(views)
    }
}

/// Commit a visibly owner-authored correction to one recall-affecting memory
/// note. Journal page bodies cannot use this path.
pub(crate) fn correct_resident_memory_note(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    target_note_id: OpaqueId,
    request_id: OpaqueId,
    note: ResidentMemoryNoteV1,
) -> ResidentNotebookMutationOutcomeV1 {
    commit_owner_notebook_record(
        lifecycle,
        runtime_state,
        OwnerNotebookRecordRequest {
            owner_pubkey,
            resident_pubkey,
            target_lineage_id: Some(target_note_id),
            required_journal_lineage: None,
            request_id,
            record_id: note.note_id.clone(),
            record_type: "memory-note",
            created_at: note.updated_at.clone(),
            body: serde_json::to_string(&note).ok(),
            tags: vec![
                "memory-note".to_owned(),
                memory_note_category(note.category).to_owned(),
            ],
            provenance_refs: note.source_event_ids.iter().map(source_ref).collect(),
            operation: RevisionOperation::OwnerCorrection,
        },
    )
}

/// Add a separate owner-authored annotation without rewriting the resident's
/// page body or changing its authorship.
pub(crate) fn annotate_resident_journal_page(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    request_id: OpaqueId,
    annotation: ResidentJournalAnnotationV1,
) -> ResidentNotebookMutationOutcomeV1 {
    if annotation.validate().is_err() {
        return ResidentNotebookMutationOutcomeV1::Invalid;
    }
    commit_owner_notebook_record(
        lifecycle,
        runtime_state,
        OwnerNotebookRecordRequest {
            owner_pubkey: annotation.owner_pubkey.clone(),
            resident_pubkey: annotation.resident_pubkey.clone(),
            target_lineage_id: None,
            required_journal_lineage: Some(annotation.page_id.clone()),
            request_id,
            record_id: annotation.annotation_id.clone(),
            record_type: "journal-annotation",
            created_at: annotation.created_at.clone(),
            body: serde_json::to_string(&annotation).ok(),
            tags: vec!["journal-annotation".to_owned()],
            provenance_refs: Some(Vec::new()),
            operation: RevisionOperation::Create,
        },
    )
}

mod write;

pub(crate) use write::change_resident_notebook_lifecycle;
use write::*;

#[cfg(test)]
#[path = "resident_notebook_tests.rs"]
mod tests;
