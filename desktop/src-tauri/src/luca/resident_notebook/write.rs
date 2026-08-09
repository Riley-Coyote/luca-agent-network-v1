use super::*;

pub(super) struct OwnerNotebookRecordRequest {
    pub(super) owner_pubkey: Hex64,
    pub(super) resident_pubkey: Hex64,
    pub(super) target_lineage_id: Option<OpaqueId>,
    pub(super) required_journal_lineage: Option<OpaqueId>,
    pub(super) request_id: OpaqueId,
    pub(super) record_id: OpaqueId,
    pub(super) record_type: &'static str,
    pub(super) created_at: luca_protocol::CanonicalTimestamp,
    pub(super) body: Option<String>,
    pub(super) tags: Vec<String>,
    pub(super) provenance_refs: Option<Vec<Sha256Ref>>,
    pub(super) operation: RevisionOperation,
}

pub(super) fn commit_owner_notebook_record(
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
    if let Some(required_page) = &request.required_journal_lineage {
        match active_lineage(
            generation.as_ref(),
            &address,
            "journal",
            Some(required_page),
        ) {
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
        Ok(result) => {
            ResidentNotebookMutationOutcomeV1::Committed(ResidentNotebookCommitReceiptV1 {
                resident_pubkey: request.resident_pubkey,
                lineage_root_id,
                record_id: request.record_id,
                revision,
                replayed: result.replayed,
            })
        }
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

pub(super) fn valid_metabolism_request(request: &ResidentMetabolismCommitRequestV1) -> bool {
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

pub(super) fn mutation_note(mutation: &ResidentMemoryNoteMutationV1) -> &ResidentMemoryNoteV1 {
    match mutation {
        ResidentMemoryNoteMutationV1::Create { note }
        | ResidentMemoryNoteMutationV1::Supersede { note, .. } => note,
    }
}

pub(super) fn prepare_handoff_revision(
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
    let body =
        serde_json::to_string(handoff).map_err(|_| ResidentMetabolismCommitOutcomeV1::Invalid)?;
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

pub(super) fn prepare_memory_note_revision(
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
    let body =
        serde_json::to_string(note).map_err(|_| ResidentMetabolismCommitOutcomeV1::Invalid)?;
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

pub(super) fn prepare_revision(
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

pub(super) fn revision_coordinates(
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

pub(super) fn active_lineage<'a>(
    generation: Option<&'a StoredRevisionGenerationV1>,
    address: &luca_continuity::NamespaceScope,
    record_type: &str,
    root: Option<&OpaqueId>,
) -> Result<Option<&'a luca_continuity::RevisionLineageSnapshotV1>, ResidentMetabolismCommitOutcomeV1>
{
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

pub(super) fn metabolism_already_committed(
    generation: Option<&StoredRevisionGenerationV1>,
    address: &luca_continuity::NamespaceScope,
    source_ref: &Sha256Ref,
) -> bool {
    !metabolism_source_record_ids(generation, address, source_ref).is_empty()
}

pub(super) fn metabolism_source_record_ids(
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

pub(super) fn handoff_record_id(
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

pub(super) fn source_ref(source_event_id: &Hex64) -> Option<Sha256Ref> {
    Sha256Ref::parse(format!("sha256:{}", source_event_id.as_str())).ok()
}

pub(super) fn memory_note_category(category: ResidentMemoryNoteCategoryV1) -> &'static str {
    match category {
        ResidentMemoryNoteCategoryV1::Decision => "decision",
        ResidentMemoryNoteCategoryV1::DurableContext => "durable-context",
        ResidentMemoryNoteCategoryV1::Lesson => "lesson",
        ResidentMemoryNoteCategoryV1::ExplicitPreference => "explicit-preference",
        ResidentMemoryNoteCategoryV1::Commitment => "commitment",
        ResidentMemoryNoteCategoryV1::OpenQuestion => "open-question",
    }
}

pub(super) fn revision_operation_label(operation: RevisionOperation) -> &'static str {
    match operation {
        RevisionOperation::Create => "create",
        RevisionOperation::Revise => "revise",
        RevisionOperation::OwnerCorrection => "owner-correction",
        RevisionOperation::Rollback => "rollback",
        RevisionOperation::Archive => "archive",
        RevisionOperation::Forget => "forget",
    }
}
