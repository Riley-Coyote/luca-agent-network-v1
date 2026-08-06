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
    let key_version = match runtime.store.active_owner_key_version(&request.owner_pubkey) {
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
    let generation = match runtime.store.load_revision_generation(&request.owner_pubkey) {
        Ok(value) => value,
        Err(_) => return ResidentMetabolismCommitOutcomeV1::Unavailable,
    };
    let source_ref = match source_ref(&request.source_event_id) {
        Some(value) => value,
        None => return ResidentMetabolismCommitOutcomeV1::Invalid,
    };
    if metabolism_already_committed(generation.as_ref(), &address, &source_ref) {
        let ids = metabolism_source_record_ids(generation.as_ref(), &address, &source_ref);
        return ResidentMetabolismCommitOutcomeV1::Committed(
            ResidentMetabolismCommitReceiptV1 {
                resident_pubkey: request.resident_pubkey,
                source_event_id: request.source_event_id,
                record_ids: ids,
                replayed: true,
            },
        );
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
    if let Some(handoff) = request.handoff.as_ref().filter(|_| !preserve_pinned_handoff) {
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
    let key_version = match runtime.store.active_owner_key_version(&request.owner_pubkey) {
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
    let generation = match runtime.store.load_revision_generation(&request.owner_pubkey) {
        Ok(value) => value,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Unavailable,
    };
    let root_id = request.target_page_id.as_ref().unwrap_or(&request.page.page_id);
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
        Ok(result) => ResidentNotebookMutationOutcomeV1::Committed(
            ResidentNotebookCommitReceiptV1 {
                resident_pubkey: request.resident_pubkey,
                lineage_root_id,
                record_id: request.page.page_id,
                revision,
                replayed: result.replayed,
            },
        ),
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

struct OwnerNotebookRecordRequest {
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    target_lineage_id: Option<OpaqueId>,
    required_journal_lineage: Option<OpaqueId>,
    request_id: OpaqueId,
    record_id: OpaqueId,
    record_type: &'static str,
    created_at: luca_protocol::CanonicalTimestamp,
    body: Option<String>,
    tags: Vec<String>,
    provenance_refs: Option<Vec<Sha256Ref>>,
    operation: RevisionOperation,
}

fn commit_owner_notebook_record(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    request: OwnerNotebookRecordRequest,
) -> ResidentNotebookMutationOutcomeV1 {
    if request.owner_pubkey == request.resident_pubkey
        || request.body.is_none()
        || request.provenance_refs.is_none()
    {
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
    let key_version = match runtime.store.active_owner_key_version(&request.owner_pubkey) {
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
    let generation = match runtime.store.load_revision_generation(&request.owner_pubkey) {
        Ok(value) => value,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Unavailable,
    };
    if let Some(required_page) = &request.required_journal_lineage {
        match active_lineage(generation.as_ref(), &address, "journal", Some(required_page)) {
            Ok(Some(_)) => {}
            Ok(None) => return ResidentNotebookMutationOutcomeV1::Stale,
            Err(_) => return ResidentNotebookMutationOutcomeV1::Invalid,
        }
    }
    let lineage_lookup = request
        .target_lineage_id
        .as_ref()
        .unwrap_or(&request.record_id);
    let active = match active_lineage(
        generation.as_ref(),
        &address,
        request.record_type,
        Some(lineage_lookup),
    ) {
        Ok(value) => value,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Invalid,
    };
    if request.target_lineage_id.is_some() != active.is_some() {
        return if request.target_lineage_id.is_some() {
            ResidentNotebookMutationOutcomeV1::Stale
        } else {
            ResidentNotebookMutationOutcomeV1::Invalid
        };
    }
    if generation.as_ref().is_some_and(|generation| {
        generation
            .snapshot
            .records
            .iter()
            .any(|record| record.record_id == request.record_id)
    }) {
        return ResidentNotebookMutationOutcomeV1::Invalid;
    }
    let (default_operation, lineage_root_id, expected_head_record_id, revision) =
        match revision_coordinates(generation.as_ref(), active, request.record_id.clone()) {
            Ok(value) => value,
            Err(_) => return ResidentNotebookMutationOutcomeV1::Invalid,
        };
    let operation = if request.operation == RevisionOperation::OwnerCorrection {
        RevisionOperation::OwnerCorrection
    } else {
        default_operation
    };
    let namespace_key = match derive_namespace_key(&root, address.namespace()) {
        Ok(value) => value,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Invalid,
    };
    let prepared = match prepare_revision(
        &address,
        key_version,
        namespace_key.as_bytes(),
        RevisionMaterial {
            record_type: request.record_type,
            lineage_root_id: lineage_root_id.clone(),
            record_id: request.record_id.clone(),
            expected_head_record_id,
            revision,
            operation,
            actor: RevisionActor::Owner,
            created_at: request.created_at,
            body: request.body.unwrap_or_default(),
            tags: request.tags,
            provenance_refs: request.provenance_refs.unwrap_or_default(),
            request_domain: "luca.resident-notebook.owner-mutation.v1",
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
        Ok(result) => ResidentNotebookMutationOutcomeV1::Committed(
            ResidentNotebookCommitReceiptV1 {
                resident_pubkey: request.resident_pubkey,
                lineage_root_id,
                record_id: request.record_id,
                revision,
                replayed: result.replayed,
            },
        ),
        Err(ContinuityStoreError::CompareAndSwapConflict)
        | Err(ContinuityStoreError::LifecycleConflict) => ResidentNotebookMutationOutcomeV1::Stale,
        Err(_) => ResidentNotebookMutationOutcomeV1::Invalid,
    }
}

/// Archive or permanently forget one notebook lineage. Forget advances the
/// existing authenticated purge state before reporting success.
pub(crate) fn change_resident_notebook_lifecycle(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner_pubkey: &Hex64,
    resident_pubkey: &Hex64,
    lineage_root_id: &OpaqueId,
    request_id: &OpaqueId,
    forget: bool,
) -> ResidentNotebookMutationOutcomeV1 {
    if owner_pubkey == resident_pubkey {
        return ResidentNotebookMutationOutcomeV1::Invalid;
    }
    let _guard = match lifecycle.lock() {
        Ok(guard) => guard,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Unavailable,
    };
    match load_existing_desktop_master_key() {
        ContinuityMasterKeyState::Ready(_) => {}
        ContinuityMasterKeyState::Locked => return ResidentNotebookMutationOutcomeV1::Locked,
        ContinuityMasterKeyState::Unavailable => {
            return ResidentNotebookMutationOutcomeV1::Unavailable;
        }
        ContinuityMasterKeyState::Corrupt => return ResidentNotebookMutationOutcomeV1::Invalid,
    }
    let mut state = match runtime_state.lock() {
        Ok(state) => state,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Unavailable,
    };
    let runtime = match &mut *state {
        ContinuityRuntimeState::Ready(runtime) if &runtime.owner_pubkey == owner_pubkey => runtime,
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
    let generation = match runtime.store.load_revision_generation(owner_pubkey) {
        Ok(Some(value)) => value,
        Ok(None) => return ResidentNotebookMutationOutcomeV1::Empty,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Unavailable,
    };
    let key_version = match runtime.store.active_owner_key_version(owner_pubkey) {
        Ok(value) => value,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Unavailable,
    };
    let address = match resident_notebook_address(owner_pubkey, resident_pubkey, key_version) {
        Ok(value) => value,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Invalid,
    };
    let Some(lineage) = generation.snapshot.lineages.iter().find(|lineage| {
        lineage.lineage_root_id == *lineage_root_id
            && lineage.namespace == *address.namespace().as_protocol()
            && lineage.scope == *address.as_protocol()
            && matches!(
                lineage.record_type.as_str(),
                "memory-note" | "journal" | "journal-annotation"
            )
    }) else {
        return ResidentNotebookMutationOutcomeV1::Empty;
    };
    if lineage.lifecycle == RevisionLifecycle::Forgotten
        || (!forget && lineage.lifecycle != RevisionLifecycle::Active)
    {
        return ResidentNotebookMutationOutcomeV1::Empty;
    }
    let head_id = lineage.lineage_head_record_id.clone();
    let Some(head_revision) = generation
        .snapshot
        .records
        .iter()
        .find(|record| record.record_id == head_id)
        .map(|record| record.revision)
    else {
        return ResidentNotebookMutationOutcomeV1::Invalid;
    };
    let operation = if forget {
        RevisionOperation::Forget
    } else {
        RevisionOperation::Archive
    };
    let request_ref = match canonical_sha256(&serde_json::json!({
        "domain": "luca.resident-notebook.lifecycle.v1",
        "request_id": request_id,
        "owner_pubkey": owner_pubkey,
        "resident_pubkey": resident_pubkey,
        "lineage_root_id": lineage_root_id,
        "operation": revision_operation_label(operation),
        "head_record_id": head_id,
    }))
    .ok()
    .and_then(|digest| Sha256Ref::parse(format!("sha256:{digest}")).ok())
    {
        Some(value) => value,
        None => return ResidentNotebookMutationOutcomeV1::Invalid,
    };
    let mut revision_request = RevisionRequest {
        idempotency_key: request_ref.clone(),
        operation,
        lineage_root_id: lineage.lineage_root_id.clone(),
        expected_head_record_id: Some(head_id.clone()),
        actor: RevisionActor::Owner,
        signed_source_event_refs: Vec::new(),
        request_ref,
        successor: None,
        successor_ciphertext_ref: None,
        rollback_source_record_id: None,
        derived_artifact_refs: if forget {
            lineage.derived_artifact_refs.clone()
        } else {
            Vec::new()
        },
    };
    revision_request.idempotency_key = match derive_revision_idempotency_key(
        &lineage.namespace,
        &lineage.scope,
        &lineage.record_type,
        lineage.lineage_envelope_key_version,
        &revision_request,
    ) {
        Ok(value) => value,
        Err(_) => return ResidentNotebookMutationOutcomeV1::Invalid,
    };
    let transition = match runtime.store.apply_revision_transition_cas(
        &AuthorityExpectationV1::Existing(generation.token),
        revision_request,
    ) {
        Ok(value) => value,
        Err(ContinuityStoreError::CompareAndSwapConflict)
        | Err(ContinuityStoreError::LifecycleConflict) => {
            return ResidentNotebookMutationOutcomeV1::Stale;
        }
        Err(_) => return ResidentNotebookMutationOutcomeV1::Invalid,
    };
    if forget {
        let in_progress = match runtime.store.advance_purge_transition_cas(
            &AuthorityExpectationV1::Existing(transition.token),
            lineage_root_id,
            PurgeExecutionStatusV1::InProgress,
        ) {
            Ok(value) => value,
            Err(_) => return ResidentNotebookMutationOutcomeV1::Stale,
        };
        if runtime
            .store
            .advance_purge_transition_cas(
                &AuthorityExpectationV1::Existing(in_progress),
                lineage_root_id,
                PurgeExecutionStatusV1::Completed,
            )
            .is_err()
        {
            return ResidentNotebookMutationOutcomeV1::Stale;
        }
    }
    ResidentNotebookMutationOutcomeV1::Committed(ResidentNotebookCommitReceiptV1 {
        resident_pubkey: resident_pubkey.clone(),
        lineage_root_id: lineage_root_id.clone(),
        record_id: head_id,
        revision: head_revision,
        replayed: transition.replayed,
    })
}

fn valid_metabolism_request(request: &ResidentMetabolismCommitRequestV1) -> bool {
    if request.owner_pubkey == request.resident_pubkey
        || request.handoff.is_none() && request.memory_note_mutations.is_empty()
        || request.memory_note_mutations.len() > luca_protocol::MAX_MEMORY_NOTE_MUTATIONS
    {
        return false;
    }
    if request.handoff.as_ref().is_some_and(|handoff| {
        handoff.validate().is_err()
            || handoff
                .source_event_ids
                .binary_search(&request.source_event_id)
                .is_err()
    }) {
        return false;
    }
    request.memory_note_mutations.iter().all(|mutation| {
        if mutation.validate().is_err() {
            return false;
        }
        let note = mutation_note(mutation);
        note.source_event_ids
            .binary_search(&request.source_event_id)
            .is_ok()
    })
}

fn mutation_note(mutation: &ResidentMemoryNoteMutationV1) -> &ResidentMemoryNoteV1 {
    match mutation {
        ResidentMemoryNoteMutationV1::Create { note }
        | ResidentMemoryNoteMutationV1::Supersede { note, .. } => note,
    }
}

fn prepare_handoff_revision(
    generation: Option<&StoredRevisionGenerationV1>,
    address: &luca_continuity::NamespaceScope,
    request: &ResidentMetabolismCommitRequestV1,
    handoff: &ResidentHandoffV1,
    source_ref: Sha256Ref,
    key_version: SafeU53,
    namespace_key: &[u8; 32],
) -> Result<PreparedRevision, ResidentMetabolismCommitOutcomeV1> {
    let active = active_lineage(generation, address, "handoff", None)?;
    if active.is_some_and(|lineage| lineage.pinned_owner_correction) {
        return Err(ResidentMetabolismCommitOutcomeV1::Stale);
    }
    let record_id = handoff_record_id(&request.resident_pubkey, &request.source_event_id)?;
    let (operation, lineage_root_id, expected_head_record_id, revision) =
        revision_coordinates(generation, active, record_id.clone())?;
    let body = serde_json::to_string(handoff)
        .map_err(|_| ResidentMetabolismCommitOutcomeV1::Invalid)?;
    prepare_revision(
        address,
        key_version,
        namespace_key,
        RevisionMaterial {
            record_type: "handoff",
            lineage_root_id,
            record_id,
            expected_head_record_id,
            revision,
            operation,
            actor: RevisionActor::Resident,
            created_at: handoff.updated_at.clone(),
            body,
            tags: vec!["handoff".to_owned()],
            provenance_refs: vec![source_ref],
            request_domain: "luca.resident-metabolism.handoff.v1",
            request_id: &request.request_id,
        },
    )
}

fn prepare_memory_note_revision(
    generation: Option<&StoredRevisionGenerationV1>,
    address: &luca_continuity::NamespaceScope,
    request: &ResidentMetabolismCommitRequestV1,
    mutation: &ResidentMemoryNoteMutationV1,
    source_ref: Sha256Ref,
    key_version: SafeU53,
    namespace_key: &[u8; 32],
) -> Result<PreparedRevision, ResidentMetabolismCommitOutcomeV1> {
    let note = mutation_note(mutation);
    let target = match mutation {
        ResidentMemoryNoteMutationV1::Create { .. } => Some(&note.note_id),
        ResidentMemoryNoteMutationV1::Supersede { target_note_id, .. } => Some(target_note_id),
    };
    let active = active_lineage(generation, address, "memory-note", target)?;
    match mutation {
        ResidentMemoryNoteMutationV1::Create { .. } if active.is_some() => {
            return Err(ResidentMetabolismCommitOutcomeV1::Invalid);
        }
        ResidentMemoryNoteMutationV1::Supersede { .. } if active.is_none() => {
            return Err(ResidentMetabolismCommitOutcomeV1::Stale);
        }
        _ => {}
    }
    if active.is_some_and(|lineage| lineage.pinned_owner_correction) {
        return Err(ResidentMetabolismCommitOutcomeV1::Stale);
    }
    if generation.is_some_and(|generation| {
        generation
            .snapshot
            .records
            .iter()
            .any(|record| record.record_id == note.note_id)
    }) {
        return Err(ResidentMetabolismCommitOutcomeV1::Invalid);
    }
    let (operation, lineage_root_id, expected_head_record_id, revision) =
        revision_coordinates(generation, active, note.note_id.clone())?;
    let body = serde_json::to_string(note)
        .map_err(|_| ResidentMetabolismCommitOutcomeV1::Invalid)?;
    prepare_revision(
        address,
        key_version,
        namespace_key,
        RevisionMaterial {
            record_type: "memory-note",
            lineage_root_id,
            record_id: note.note_id.clone(),
            expected_head_record_id,
            revision,
            operation,
            actor: RevisionActor::Resident,
            created_at: note.updated_at.clone(),
            body,
            tags: vec![
                "memory-note".to_owned(),
                memory_note_category(note.category).to_owned(),
            ],
            provenance_refs: vec![source_ref],
            request_domain: "luca.resident-metabolism.memory-note.v1",
            request_id: &request.request_id,
        },
    )
}

fn prepare_revision(
    address: &luca_continuity::NamespaceScope,
    key_version: SafeU53,
    namespace_key: &[u8; 32],
    material: RevisionMaterial<'_>,
) -> Result<PreparedRevision, ResidentMetabolismCommitOutcomeV1> {
    let record_type = OpaqueId::parse(material.record_type)
        .map_err(|_| ResidentMetabolismCommitOutcomeV1::Invalid)?;
    let mut tags = material.tags;
    tags.sort();
    tags.dedup();
    let retrieval_material = serde_json::to_vec(&serde_json::json!({
        "protocol": "luca.continuity.retrieval-material.v1",
        "version": 1,
        "body": material.body,
        "tags": tags,
        "confidence_basis_points": 10_000,
        "provenance_refs": material
            .provenance_refs
            .iter()
            .map(Sha256Ref::as_str)
            .collect::<Vec<_>>(),
        "outgoing_edges": []
    }))
    .map_err(|_| ResidentMetabolismCommitOutcomeV1::Invalid)?;
    let author_kind = match material.actor {
        RevisionActor::Owner => "owner",
        RevisionActor::Resident => "resident",
        RevisionActor::System => "system",
        RevisionActor::Automatic => "automatic",
    };
    let successor = encrypt_record(
        luca_continuity::RecordMetadata {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            record_id: material.record_id.clone(),
            namespace: address.namespace().as_protocol().clone(),
            scope: address.as_protocol().clone(),
            record_type: record_type.clone(),
            revision: material.revision,
            predecessor_record_id: material.expected_head_record_id.clone(),
            created_at: material.created_at,
            author_kind: OpaqueId::parse(author_kind)
                .map_err(|_| ResidentMetabolismCommitOutcomeV1::Invalid)?,
            provenance_refs: material.provenance_refs.clone(),
            key_version,
        },
        namespace_key,
        &retrieval_material,
    )
    .map_err(|_| ResidentMetabolismCommitOutcomeV1::Invalid)?;
    let request_ref = canonical_sha256(&serde_json::json!({
        "domain": material.request_domain,
        "request_id": material.request_id,
        "record_id": material.record_id,
        "lineage_root_id": material.lineage_root_id,
        "operation": revision_operation_label(material.operation),
    }))
    .ok()
    .and_then(|digest| Sha256Ref::parse(format!("sha256:{digest}")).ok())
    .ok_or(ResidentMetabolismCommitOutcomeV1::Invalid)?;
    let successor_ref = encrypted_record_reference(&successor)
        .map_err(|_| ResidentMetabolismCommitOutcomeV1::Invalid)?;
    let mut request = RevisionRequest {
        idempotency_key: request_ref.clone(),
        operation: material.operation,
        lineage_root_id: material.lineage_root_id,
        expected_head_record_id: material.expected_head_record_id,
        actor: material.actor,
        signed_source_event_refs: material.provenance_refs,
        request_ref,
        successor: Some(successor),
        successor_ciphertext_ref: Some(successor_ref),
        rollback_source_record_id: None,
        derived_artifact_refs: Vec::new(),
    };
    let successor = request
        .successor
        .as_ref()
        .ok_or(ResidentMetabolismCommitOutcomeV1::Invalid)?;
    request.idempotency_key = derive_revision_idempotency_key(
        &successor.namespace,
        &successor.scope,
        &successor.record_type,
        successor.key_version,
        &request,
    )
    .map_err(|_| ResidentMetabolismCommitOutcomeV1::Invalid)?;
    Ok(PreparedRevision {
        request,
        record_id: material.record_id,
    })
}

fn revision_coordinates(
    generation: Option<&StoredRevisionGenerationV1>,
    active: Option<&luca_continuity::RevisionLineageSnapshotV1>,
    new_record_id: OpaqueId,
) -> Result<
    (RevisionOperation, OpaqueId, Option<OpaqueId>, SafeU53),
    ResidentMetabolismCommitOutcomeV1,
> {
    let Some(active) = active else {
        return Ok((
            RevisionOperation::Create,
            new_record_id,
            None,
            SafeU53::new(0).map_err(|_| ResidentMetabolismCommitOutcomeV1::Invalid)?,
        ));
    };
    let head_id = active
        .active_head_record_id
        .clone()
        .ok_or(ResidentMetabolismCommitOutcomeV1::Invalid)?;
    if head_id == new_record_id || active.lineage_root_id == new_record_id {
        return Err(ResidentMetabolismCommitOutcomeV1::Invalid);
    }
    let head = generation
        .and_then(|generation| {
            generation
                .snapshot
                .records
                .iter()
                .find(|record| record.record_id == head_id)
        })
        .ok_or(ResidentMetabolismCommitOutcomeV1::Invalid)?;
    Ok((
        RevisionOperation::Revise,
        active.lineage_root_id.clone(),
        Some(head_id),
        SafeU53::new(head.revision.get().saturating_add(1))
            .map_err(|_| ResidentMetabolismCommitOutcomeV1::Invalid)?,
    ))
}

fn active_lineage<'a>(
    generation: Option<&'a StoredRevisionGenerationV1>,
    address: &luca_continuity::NamespaceScope,
    record_type: &str,
    root: Option<&OpaqueId>,
) -> Result<
    Option<&'a luca_continuity::RevisionLineageSnapshotV1>,
    ResidentMetabolismCommitOutcomeV1,
> {
    let Some(generation) = generation else {
        return Ok(None);
    };
    let matching = generation
        .snapshot
        .lineages
        .iter()
        .filter(|lineage| {
            lineage.lifecycle == RevisionLifecycle::Active
                && lineage.record_type.as_str() == record_type
                && lineage.namespace == *address.namespace().as_protocol()
                && lineage.scope == *address.as_protocol()
                && root.is_none_or(|root| &lineage.lineage_root_id == root)
        })
        .collect::<Vec<_>>();
    match matching.as_slice() {
        [] => Ok(None),
        [lineage] => Ok(Some(*lineage)),
        _ => Err(ResidentMetabolismCommitOutcomeV1::Invalid),
    }
}

fn metabolism_already_committed(
    generation: Option<&StoredRevisionGenerationV1>,
    address: &luca_continuity::NamespaceScope,
    source_ref: &Sha256Ref,
) -> bool {
    !metabolism_source_record_ids(generation, address, source_ref).is_empty()
}

fn metabolism_source_record_ids(
    generation: Option<&StoredRevisionGenerationV1>,
    address: &luca_continuity::NamespaceScope,
    source_ref: &Sha256Ref,
) -> Vec<OpaqueId> {
    let mut ids = generation
        .into_iter()
        .flat_map(|generation| generation.snapshot.records.iter())
        .filter(|record| {
            matches!(record.record_type.as_str(), "handoff" | "memory-note")
                && record.namespace == *address.namespace().as_protocol()
                && record.scope == *address.as_protocol()
                && record.provenance_refs.binary_search(source_ref).is_ok()
        })
        .map(|record| record.record_id.clone())
        .collect::<Vec<_>>();
    ids.sort();
    ids
}

fn handoff_record_id(
    resident_pubkey: &Hex64,
    source_event_id: &Hex64,
) -> Result<OpaqueId, ResidentMetabolismCommitOutcomeV1> {
    OpaqueId::parse(format!(
        "handoff-{}-{}",
        &resident_pubkey.as_str()[..12],
        &source_event_id.as_str()[..16]
    ))
    .map_err(|_| ResidentMetabolismCommitOutcomeV1::Invalid)
}

fn source_ref(source_event_id: &Hex64) -> Option<Sha256Ref> {
    Sha256Ref::parse(format!("sha256:{}", source_event_id.as_str())).ok()
}

fn memory_note_category(category: ResidentMemoryNoteCategoryV1) -> &'static str {
    match category {
        ResidentMemoryNoteCategoryV1::Decision => "decision",
        ResidentMemoryNoteCategoryV1::DurableContext => "durable-context",
        ResidentMemoryNoteCategoryV1::Lesson => "lesson",
        ResidentMemoryNoteCategoryV1::ExplicitPreference => "explicit-preference",
        ResidentMemoryNoteCategoryV1::Commitment => "commitment",
        ResidentMemoryNoteCategoryV1::OpenQuestion => "open-question",
    }
}

fn revision_operation_label(operation: RevisionOperation) -> &'static str {
    match operation {
        RevisionOperation::Create => "create",
        RevisionOperation::Revise => "revise",
        RevisionOperation::OwnerCorrection => "owner-correction",
        RevisionOperation::Rollback => "rollback",
        RevisionOperation::Archive => "archive",
        RevisionOperation::Forget => "forget",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::{CanonicalTimestamp, ResidentMemoryNoteCategoryV1};

    fn hex(value: char) -> Hex64 {
        Hex64::parse(value.to_string().repeat(64)).expect("fixture key")
    }

    fn timestamp() -> CanonicalTimestamp {
        CanonicalTimestamp::parse("2026-08-06T12:00:00Z").expect("fixture timestamp")
    }

    #[test]
    fn metabolism_requires_every_note_to_cite_the_final() {
        let request = ResidentMetabolismCommitRequestV1 {
            owner_pubkey: hex('a'),
            resident_pubkey: hex('b'),
            source_event_id: hex('c'),
            request_id: OpaqueId::parse("request-1").expect("request"),
            handoff: None,
            memory_note_mutations: vec![ResidentMemoryNoteMutationV1::Create {
                note: ResidentMemoryNoteV1 {
                    protocol: CONTINUITY_PROTOCOL.to_owned(),
                    note_id: OpaqueId::parse("note-1").expect("note"),
                    category: ResidentMemoryNoteCategoryV1::Decision,
                    body: "Use a resident-owned notebook.".to_owned(),
                    source_event_ids: vec![hex('d')],
                    created_at: timestamp(),
                    updated_at: timestamp(),
                },
            }],
        };
        assert!(!valid_metabolism_request(&request));
    }
}
