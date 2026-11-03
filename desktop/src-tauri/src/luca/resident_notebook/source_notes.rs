//! Source-derived semantic notes in the EXISTING encrypted resident notebook.
//! Reserved lineage identity + authenticated encrypted tag are both required.
//! Source promotion is separate from ordinary clean continuity/metabolism.
use super::*;
use crate::luca::continuity_revision_authority::RevisionAuthorityTokenV1;
use base64::Engine as _;
use luca_protocol::AwarenessObservationRefV1;
use serde::{Deserialize, Serialize};

pub(crate) const SOURCE_NOTE_PREFIX: &str = "companion-note-";
pub(crate) const SOURCE_NOTE_NODE_PREFIX: &str = "companion-note-derived:";
pub(crate) const SOURCE_NOTE_SEAL_TAG: &str = "companion-source-note-v1:";
const MAX_NOTES: usize = 3;
/// Fixed owner inspection page, not a provider/model-selected recall limit.
const MAX_OWNER_NOTES: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SourceNoteSealV1 {
    pub protocol: String,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub lineage_root_id: OpaqueId,
    pub node: OpaqueId,
    pub parents: Vec<OpaqueId>,
    pub observations: Vec<AwarenessObservationRefV1>,
}

impl SourceNoteSealV1 {
    pub(crate) fn validate(&self) -> Result<(), SourceNoteErrorV1> {
        let hash = self
            .lineage_root_id
            .as_str()
            .strip_prefix(SOURCE_NOTE_PREFIX)
            .ok_or(SourceNoteErrorV1::Invalid)?;
        if self.protocol != "polyphonic.source-note-seal.v1"
            || self.owner_pubkey == self.resident_pubkey
            || hash.len() != 64
            || !hash
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            || self.node.as_str() != format!("{SOURCE_NOTE_NODE_PREFIX}{hash}")
            || self.parents.is_empty()
            || self.parents.len() > 32
            || self.parents.windows(2).any(|pair| pair[0] >= pair[1])
            || self.observations.is_empty()
            || self.observations.len() > 4
        {
            return Err(SourceNoteErrorV1::Invalid);
        }
        for (index, reference) in self.observations.iter().enumerate() {
            if reference.validate().is_err()
                || reference.owner_pubkey != self.owner_pubkey
                || reference.resident_pubkey != self.resident_pubkey
                || self.observations[..index]
                    .iter()
                    .any(|prior| prior.observation_id == reference.observation_id)
            {
                return Err(SourceNoteErrorV1::Invalid);
            }
        }
        Ok(())
    }
    pub(crate) fn tag(&self) -> Result<String, SourceNoteErrorV1> {
        self.validate()?;
        let bytes = serde_json::to_vec(self).map_err(|_| SourceNoteErrorV1::Invalid)?;
        Ok(format!(
            "{SOURCE_NOTE_SEAL_TAG}{}",
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
        ))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SourceNoteErrorV1 {
    Invalid,
    Denied,
    Stale,
    Locked,
    Unavailable,
    Forgotten,
}

/// Body-bearing exact current snapshot, lent only inside a lifecycle callback.
/// No Debug/Serialize and no caller-supplied permission claims.
pub(crate) struct SourceNoteViewV1 {
    pub record_id: OpaqueId,
    pub lineage_root_id: OpaqueId,
    pub revision: SafeU53,
    pub canonical_revision_ref: Sha256Ref,
    pub pinned_owner_correction: bool,
    pub author_kind: OpaqueId,
    pub note: ResidentMemoryNoteV1,
    pub seal: SourceNoteSealV1,
}

/// Owner disclosure uses the same authenticated, current promotion boundary as
/// model recall. No source body may bypass it through the general notebook API.
pub(crate) fn owner_views(
    state: &crate::app_state::AppState,
    owner: &Hex64,
    resident: &Hex64,
) -> Vec<ResidentNotebookRevisionViewV1> {
    use crate::luca::companion_awareness::{
        source_runtime::preload_retained_source_facts, AwarenessHostFactsV1,
    };
    let Ok(now) = crate::luca::continuity_jobs::current_canonical_timestamp() else {
        return Vec::new();
    };
    let Ok(material) = preload_retained_source_facts(state, owner, resident, &now) else {
        return Vec::new();
    };
    let Ok(binding) = crate::luca::managed_cognition::active_binding_ref(resident) else {
        return Vec::new();
    };
    state
        .consume_resident_source_notes_for_owner(owner, resident, |lease, _, notes| {
            let facts = AwarenessHostFactsV1 {
                owner_pubkey: owner,
                resident_pubkey: resident,
                now: &now,
                source_fresh: false,
                material_state: luca_protocol::AwarenessMaterialStateV1::Unavailable,
            };
            notes
                .iter()
                .filter_map(|view| {
                    state
                        .companion_awareness
                        .with_semantic_note_promotion_lease(
                            lease,
                            &view.seal,
                            &binding,
                            &facts,
                            |reference, retained| material.resolve(reference, retained),
                            || ResidentNotebookRevisionViewV1 {
                                lineage_root_id: view.lineage_root_id.clone(),
                                record_id: view.record_id.clone(),
                                record_type: OpaqueId::parse("memory-note")
                                    .expect("static record type"),
                                revision: view.revision,
                                status: ResidentNotebookStatusV1::Active,
                                pinned_owner_correction: view.pinned_owner_correction,
                                author_kind: view.author_kind.clone(),
                                provenance_refs: view
                                    .note
                                    .source_event_ids
                                    .iter()
                                    .filter_map(source_ref)
                                    .collect(),
                                body: ResidentNotebookBodyV1::MemoryNote(view.note.clone()),
                            },
                        )
                        .ok()
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Native host request, never deserialized from a model's claimed provenance.
pub(crate) struct SourceNoteCommitRequestV1 {
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub request_id: OpaqueId,
    pub note: ResidentMemoryNoteV1,
    pub seal: SourceNoteSealV1,
}

/// Host-only note identity. Exact/whitespace-normalized repeats share one
/// lineage, so its archived/forgotten tombstone cannot be bypassed on retry.
pub(crate) fn note_id(
    owner: &Hex64,
    resident: &Hex64,
    category: ResidentMemoryNoteCategoryV1,
    body: &str,
) -> Result<OpaqueId, SourceNoteErrorV1> {
    let normalized = body.split_whitespace().collect::<Vec<_>>().join(" ");
    let digest = canonical_sha256(&serde_json::json!({
        "domain":"polyphonic.source-note-identity.v1","owner":owner,"resident":resident,
        "category":category,"body":normalized
    }))
    .map_err(|_| SourceNoteErrorV1::Invalid)?;
    OpaqueId::parse(format!("{SOURCE_NOTE_PREFIX}{digest}")).map_err(|_| SourceNoteErrorV1::Invalid)
}

pub(crate) fn is_source_note_id(id: &OpaqueId) -> bool {
    id.as_str().starts_with(SOURCE_NOTE_PREFIX)
}
pub(crate) fn seal_from_tags(
    tags: &[luca_continuity::RetrievalText],
) -> Result<SourceNoteSealV1, SourceNoteErrorV1> {
    let mut seals = tags
        .iter()
        .filter_map(|tag| tag.as_str().strip_prefix(SOURCE_NOTE_SEAL_TAG));
    let encoded = seals.next().ok_or(SourceNoteErrorV1::Invalid)?;
    if seals.next().is_some() || encoded.len() > 24 * 1024 {
        return Err(SourceNoteErrorV1::Invalid);
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| SourceNoteErrorV1::Invalid)?;
    let seal: SourceNoteSealV1 =
        serde_json::from_slice(&bytes).map_err(|_| SourceNoteErrorV1::Invalid)?;
    seal.validate()?;
    Ok(seal)
}

/// Caller takes identity/mode guards BEFORE entering. This function takes the
/// notebook lifecycle/store, prepares encrypted bytes, then lends only the final
/// CAS to the current awareness-promotion gate. Never reverse these locks.
pub(crate) fn commit_source_note(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    request: SourceNoteCommitRequestV1,
    gate: impl FnOnce(
        &mut dyn FnMut() -> Result<ResidentNotebookCommitReceiptV1, SourceNoteErrorV1>,
    ) -> Result<ResidentNotebookCommitReceiptV1, SourceNoteErrorV1>,
) -> Result<ResidentNotebookCommitReceiptV1, SourceNoteErrorV1> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| SourceNoteErrorV1::Unavailable)?;
    let root = existing_root()?;
    let mut state = runtime_state
        .lock()
        .map_err(|_| SourceNoteErrorV1::Unavailable)?;
    let runtime = ready_runtime(&mut state, &request.owner_pubkey)?;
    let version = runtime
        .store
        .active_owner_key_version(&request.owner_pubkey)
        .map_err(|_| SourceNoteErrorV1::Unavailable)?;
    let address =
        resident_notebook_address(&request.owner_pubkey, &request.resident_pubkey, version)
            .map_err(|_| SourceNoteErrorV1::Invalid)?;
    let key =
        derive_namespace_key(&root, address.namespace()).map_err(|_| SourceNoteErrorV1::Invalid)?;
    commit_in_store(&mut runtime.store, &address, key.as_bytes(), request, gate)
}

fn commit_in_store(
    store: &mut super::super::continuity_store::ContinuityStore,
    address: &luca_continuity::NamespaceScope,
    key: &[u8; 32],
    request: SourceNoteCommitRequestV1,
    gate: impl FnOnce(
        &mut dyn FnMut() -> Result<ResidentNotebookCommitReceiptV1, SourceNoteErrorV1>,
    ) -> Result<ResidentNotebookCommitReceiptV1, SourceNoteErrorV1>,
) -> Result<ResidentNotebookCommitReceiptV1, SourceNoteErrorV1> {
    request.seal.validate()?;
    if request.note.validate().is_err()
        || request.note.body.len() > 1024
        || request.owner_pubkey != request.seal.owner_pubkey
        || request.resident_pubkey != request.seal.resident_pubkey
        || request.note.note_id != request.seal.lineage_root_id
        || request.note.note_id
            != note_id(
                &request.owner_pubkey,
                &request.resident_pubkey,
                request.note.category,
                &request.note.body,
            )?
        || address.namespace().as_protocol().owner_pubkey != request.owner_pubkey
        || address.namespace().as_protocol().resident_pubkey.as_ref()
            != Some(&request.resident_pubkey)
    {
        return Err(SourceNoteErrorV1::Invalid);
    }
    let generation = store
        .load_revision_generation(&request.owner_pubkey)
        .map_err(|_| SourceNoteErrorV1::Unavailable)?;
    if let Some(lineage) = generation.as_ref().and_then(|g| {
        g.snapshot.lineages.iter().find(|lineage| {
            lineage.namespace == *address.namespace().as_protocol()
                && lineage.scope == *address.as_protocol()
                && lineage.lineage_root_id == request.note.note_id
        })
    }) {
        if lineage.lifecycle == RevisionLifecycle::Forgotten {
            return Err(SourceNoteErrorV1::Forgotten);
        }
        // Owner edits/archives always win. Retry never restores or overwrites.
        if lineage.lifecycle != RevisionLifecycle::Active {
            return Err(SourceNoteErrorV1::Stale);
        }
        let record_id = lineage
            .active_head_record_id
            .clone()
            .ok_or(SourceNoteErrorV1::Stale)?;
        return Ok(ResidentNotebookCommitReceiptV1 {
            resident_pubkey: request.resident_pubkey,
            lineage_root_id: request.note.note_id,
            record_id,
            revision: SafeU53::new(lineage.record_ids.len().saturating_sub(1) as u64)
                .map_err(|_| SourceNoteErrorV1::Invalid)?,
            replayed: true,
        });
    }
    let source = request
        .note
        .source_event_ids
        .first()
        .and_then(source_ref)
        .ok_or(SourceNoteErrorV1::Invalid)?;
    let prepared = write::prepare_revision(
        address,
        address.namespace().as_protocol().key_version,
        key,
        RevisionMaterial {
            record_type: "memory-note",
            lineage_root_id: request.note.note_id.clone(),
            record_id: request.note.note_id.clone(),
            expected_head_record_id: None,
            revision: SafeU53::new(0).map_err(|_| SourceNoteErrorV1::Invalid)?,
            operation: RevisionOperation::Create,
            actor: RevisionActor::Resident,
            created_at: request.note.created_at.clone(),
            body: serde_json::to_string(&request.note).map_err(|_| SourceNoteErrorV1::Invalid)?,
            tags: vec![
                "memory-note".into(),
                write::memory_note_category(request.note.category).into(),
                request.seal.tag()?,
            ],
            provenance_refs: vec![source],
            request_domain: "polyphonic.source-note.v1",
            request_id: &request.request_id,
        },
    )
    .map_err(|_| SourceNoteErrorV1::Invalid)?;
    let expectation = generation
        .as_ref()
        .map(|g| AuthorityExpectationV1::Existing(g.token.clone()))
        .unwrap_or_else(|| AuthorityExpectationV1::UninitializedOwner {
            owner_pubkey: request.owner_pubkey.clone(),
            active_root_key_version: address.namespace().as_protocol().key_version,
        });
    let mut pending = Some(prepared.request);
    gate(&mut || {
        let prepared = pending.take().ok_or(SourceNoteErrorV1::Invalid)?;
        let commit = store
            .apply_revision_transition_cas(&expectation, prepared)
            .map_err(|_| SourceNoteErrorV1::Stale)?;
        Ok(ResidentNotebookCommitReceiptV1 {
            resident_pubkey: request.resident_pubkey.clone(),
            lineage_root_id: request.note.note_id.clone(),
            record_id: request.note.note_id.clone(),
            revision: SafeU53::new(0).map_err(|_| SourceNoteErrorV1::Invalid)?,
            replayed: commit.replayed,
        })
    })
}

/// Lend at most three current encrypted note heads under the canonical lifecycle.
/// This is NOT access authority: the consumer MUST gate the authenticated seal
/// at its actual owner/model disclosure, keeping source text untrusted.
pub(crate) fn consume_source_notes<T>(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner: &Hex64,
    resident: &Hex64,
    consume: impl FnOnce(&RevisionAuthorityTokenV1, &[SourceNoteViewV1]) -> T,
) -> Result<T, SourceNoteErrorV1> {
    consume_source_notes_with_limit(
        lifecycle,
        runtime_state,
        owner,
        resident,
        MAX_NOTES,
        consume,
    )
}

pub(crate) fn consume_source_notes_for_owner<T>(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner: &Hex64,
    resident: &Hex64,
    consume: impl FnOnce(&RevisionAuthorityTokenV1, &[SourceNoteViewV1]) -> T,
) -> Result<T, SourceNoteErrorV1> {
    consume_source_notes_with_limit(
        lifecycle,
        runtime_state,
        owner,
        resident,
        MAX_OWNER_NOTES,
        consume,
    )
}

fn consume_source_notes_with_limit<T>(
    lifecycle: &ContinuityLifecycleLock,
    runtime_state: &Mutex<ContinuityRuntimeState>,
    owner: &Hex64,
    resident: &Hex64,
    limit: usize,
    consume: impl FnOnce(&RevisionAuthorityTokenV1, &[SourceNoteViewV1]) -> T,
) -> Result<T, SourceNoteErrorV1> {
    let _guard = lifecycle
        .lock()
        .map_err(|_| SourceNoteErrorV1::Unavailable)?;
    let root = existing_root()?;
    let mut state = runtime_state
        .lock()
        .map_err(|_| SourceNoteErrorV1::Unavailable)?;
    let runtime = ready_runtime(&mut state, owner)?;
    let version = runtime
        .store
        .active_owner_key_version(owner)
        .map_err(|_| SourceNoteErrorV1::Unavailable)?;
    let address = resident_notebook_address(owner, resident, version)
        .map_err(|_| SourceNoteErrorV1::Invalid)?;
    let key =
        derive_namespace_key(&root, address.namespace()).map_err(|_| SourceNoteErrorV1::Invalid)?;
    let generation = runtime
        .store
        .load_revision_generation(owner)
        .map_err(|_| SourceNoteErrorV1::Unavailable)?
        .ok_or(SourceNoteErrorV1::Unavailable)?;
    let notes = read_in_generation_limit(&generation, &address, key.as_bytes(), limit)?;
    Ok(consume(&generation.token, &notes))
}

fn read_in_generation(
    generation: &StoredRevisionGenerationV1,
    address: &luca_continuity::NamespaceScope,
    key: &[u8; 32],
) -> Result<Vec<SourceNoteViewV1>, SourceNoteErrorV1> {
    read_in_generation_limit(generation, address, key, MAX_NOTES)
}

fn read_in_generation_limit(
    generation: &StoredRevisionGenerationV1,
    address: &luca_continuity::NamespaceScope,
    key: &[u8; 32],
    limit: usize,
) -> Result<Vec<SourceNoteViewV1>, SourceNoteErrorV1> {
    let mut notes = Vec::new();
    let mut lineages = generation
        .snapshot
        .lineages
        .iter()
        .filter(|lineage| {
            lineage.namespace == *address.namespace().as_protocol()
                && lineage.scope == *address.as_protocol()
                && lineage.record_type.as_str() == "memory-note"
                && is_source_note_id(&lineage.lineage_root_id)
                && lineage.lifecycle == RevisionLifecycle::Active
        })
        .collect::<Vec<_>>();
    // Pick from authenticated body-free metadata first: pinned corrections,
    // then newest heads. Never decrypt the whole notebook to rank recall.
    lineages.sort_by(|a, b| {
        let stamp = |lineage: &luca_continuity::RevisionLineageSnapshotV1| {
            generation
                .snapshot
                .records
                .iter()
                .find(|record| Some(&record.record_id) == lineage.active_head_record_id.as_ref())
                .map(|record| record.created_at.as_str())
        };
        b.pinned_owner_correction
            .cmp(&a.pinned_owner_correction)
            .then_with(|| stamp(b).cmp(&stamp(a)))
            .then_with(|| a.lineage_root_id.cmp(&b.lineage_root_id))
    });
    for lineage in lineages.into_iter().take(limit) {
        let record = generation
            .snapshot
            .records
            .iter()
            .find(|record| Some(&record.record_id) == lineage.active_head_record_id.as_ref())
            .ok_or(SourceNoteErrorV1::Invalid)?;
        let material = decrypt_record(record, key)
            .and_then(luca_continuity::RetrievalMaterialV1::decode)
            .map_err(|_| SourceNoteErrorV1::Invalid)?;
        let seal = seal_from_tags(material.tags())?;
        if material.provenance_refs() != record.provenance_refs.as_slice()
            || seal.lineage_root_id != lineage.lineage_root_id
            || seal.owner_pubkey != address.namespace().as_protocol().owner_pubkey
            || seal.resident_pubkey
                != address
                    .namespace()
                    .as_protocol()
                    .resident_pubkey
                    .clone()
                    .ok_or(SourceNoteErrorV1::Invalid)?
        {
            return Err(SourceNoteErrorV1::Invalid);
        }
        let note: ResidentMemoryNoteV1 =
            serde_json::from_str(material.body()).map_err(|_| SourceNoteErrorV1::Invalid)?;
        note.validate().map_err(|_| SourceNoteErrorV1::Invalid)?;
        if note.note_id != record.record_id || note.body.len() > 1024 {
            return Err(SourceNoteErrorV1::Invalid);
        }
        notes.push(SourceNoteViewV1 {
            record_id: record.record_id.clone(),
            lineage_root_id: lineage.lineage_root_id.clone(),
            revision: record.revision,
            canonical_revision_ref: encrypted_record_reference(record)
                .map_err(|_| SourceNoteErrorV1::Invalid)?,
            pinned_owner_correction: lineage.pinned_owner_correction,
            author_kind: record.author_kind.clone(),
            note,
            seal,
        });
    }
    Ok(notes)
}

fn existing_root(
) -> Result<crate::luca::continuity_key_custody::ContinuityMasterKey, SourceNoteErrorV1> {
    match load_existing_desktop_master_key() {
        ContinuityMasterKeyState::Ready(root) => Ok(root),
        ContinuityMasterKeyState::Locked => Err(SourceNoteErrorV1::Locked),
        _ => Err(SourceNoteErrorV1::Unavailable),
    }
}
fn ready_runtime<'a>(
    state: &'a mut ContinuityRuntimeState,
    owner: &Hex64,
) -> Result<&'a mut super::super::continuity_runtime::ContinuityRuntime, SourceNoteErrorV1> {
    match state {
        ContinuityRuntimeState::Ready(runtime) if &runtime.owner_pubkey == owner => Ok(runtime),
        ContinuityRuntimeState::Ready(_) => Err(SourceNoteErrorV1::Denied),
        _ => Err(SourceNoteErrorV1::Unavailable),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::luca::continuity_store::{
        ContinuityStore, ContinuityStoreCustody, ContinuityStoreOpen,
    };
    const KEY: [u8; 32] = [7; 32];
    fn hex(c: char) -> Hex64 {
        Hex64::parse(c.to_string().repeat(64)).unwrap()
    }
    fn id(s: &str) -> OpaqueId {
        OpaqueId::parse(s).unwrap()
    }
    fn time() -> luca_protocol::CanonicalTimestamp {
        luca_protocol::CanonicalTimestamp::parse("2026-11-03T10:00:00Z").unwrap()
    }
    fn request() -> SourceNoteCommitRequestV1 {
        let body = "Use the existing app's shared build cache, not a separate cache.";
        let category = ResidentMemoryNoteCategoryV1::DurableContext;
        let note_id = note_id(&hex('a'), &hex('b'), category, body).unwrap();
        let hash = note_id.as_str().strip_prefix(SOURCE_NOTE_PREFIX).unwrap();
        let seal = SourceNoteSealV1 {
            protocol: "polyphonic.source-note-seal.v1".into(),
            owner_pubkey: hex('a'),
            resident_pubkey: hex('b'),
            lineage_root_id: note_id.clone(),
            node: id(&format!("{SOURCE_NOTE_NODE_PREFIX}{hash}")),
            parents: vec![id("accepted-source-context")],
            observations: vec![AwarenessObservationRefV1 {
                protocol: luca_protocol::AWARENESS_PROTOCOL.into(),
                observation_id: id("source-observation"),
                owner_pubkey: hex('a'),
                resident_pubkey: hex('b'),
                source_id: id("claude-profile"),
                device_id: id("fixture-device"),
                grant_id: id("fixture-grant"),
                grant_revision: SafeU53::new(1).unwrap(),
                deny_epoch: SafeU53::new(0).unwrap(),
                sequence: SafeU53::new(1).unwrap(),
                evidence_ref: Sha256Ref::parse(format!("sha256:{}", "c".repeat(64))).unwrap(),
                captured_at: time(),
                expires_at: luca_protocol::CanonicalTimestamp::parse("2026-11-03T10:10:00Z")
                    .unwrap(),
            }],
        };
        SourceNoteCommitRequestV1 {
            owner_pubkey: hex('a'),
            resident_pubkey: hex('b'),
            request_id: id("accepted-final-request"),
            note: ResidentMemoryNoteV1 {
                protocol: CONTINUITY_PROTOCOL.into(),
                note_id,
                category,
                body: body.into(),
                source_event_ids: vec![hex('c')],
                created_at: time(),
                updated_at: time(),
            },
            seal,
        }
    }
    fn open(temp: &tempfile::TempDir) -> ContinuityStore {
        match ContinuityStore::open(temp.path(), ContinuityStoreCustody::Ready).unwrap() {
            ContinuityStoreOpen::Ready(store) => store,
            _ => panic!("fixture store"),
        }
    }
    fn address() -> luca_continuity::NamespaceScope {
        resident_notebook_address(&hex('a'), &hex('b'), SafeU53::new(1).unwrap()).unwrap()
    }

    #[test]
    fn semantic_note_save_recall_owner_correction_forget_is_encrypted_and_tombstoned() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = open(&temp);
        let scope = address();
        let source = request();
        let root = source.note.note_id.clone();
        let seal = source.seal.clone();
        let receipt = commit_in_store(&mut store, &scope, &KEY, source, |commit| commit()).unwrap();
        assert!(!receipt.replayed);
        let generation = store.load_revision_generation(&hex('a')).unwrap().unwrap();
        let views = read_in_generation(&generation, &scope, &KEY).unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].note.body, request().note.body);
        assert_eq!(views[0].seal, seal);
        assert!(!serde_json::to_string(&generation.snapshot)
            .unwrap()
            .contains("Use the existing app"));
        let other =
            resident_notebook_address(&hex('a'), &hex('d'), SafeU53::new(1).unwrap()).unwrap();
        assert!(read_in_generation(&generation, &other, &KEY)
            .unwrap()
            .is_empty());
        // Owner correction uses the existing canonical operation and preserves
        // the authenticated encrypted source classification, not clean reauthorship.
        let mut note = request().note;
        note.note_id = id("owner-correction-1");
        note.body = "Keep one shared cache on the internal disk.".into();
        let prepared = write::prepare_revision(
            &scope,
            SafeU53::new(1).unwrap(),
            &KEY,
            RevisionMaterial {
                record_type: "memory-note",
                lineage_root_id: root.clone(),
                record_id: note.note_id.clone(),
                expected_head_record_id: Some(root.clone()),
                revision: SafeU53::new(1).unwrap(),
                operation: RevisionOperation::OwnerCorrection,
                actor: RevisionActor::Owner,
                created_at: time(),
                body: serde_json::to_string(&note).unwrap(),
                tags: vec!["memory-note".into(), seal.tag().unwrap()],
                provenance_refs: vec![source_ref(&hex('c')).unwrap()],
                request_domain: "fixture-owner-correction",
                request_id: &id("owner-fix"),
            },
        )
        .unwrap();
        let corrected = store
            .apply_revision_transition_cas(
                &AuthorityExpectationV1::Existing(generation.token),
                prepared.request,
            )
            .unwrap();
        let generation = store.load_revision_generation(&hex('a')).unwrap().unwrap();
        let views = read_in_generation(&generation, &scope, &KEY).unwrap();
        assert_eq!(views[0].note.body, note.body);
        assert_eq!(views[0].seal, seal);
        assert!(views[0].pinned_owner_correction);
        let lineage = generation
            .snapshot
            .lineages
            .iter()
            .find(|lineage| lineage.lineage_root_id == root)
            .unwrap();
        let request_ref = Sha256Ref::parse(format!("sha256:{}", "e".repeat(64))).unwrap();
        let mut forget = RevisionRequest {
            idempotency_key: request_ref.clone(),
            request_ref,
            operation: RevisionOperation::Forget,
            lineage_root_id: root.clone(),
            expected_head_record_id: Some(note.note_id),
            actor: RevisionActor::Owner,
            signed_source_event_refs: vec![],
            successor: None,
            successor_ciphertext_ref: None,
            rollback_source_record_id: None,
            derived_artifact_refs: lineage.derived_artifact_refs.clone(),
        };
        forget.idempotency_key = derive_revision_idempotency_key(
            &lineage.namespace,
            &lineage.scope,
            &lineage.record_type,
            lineage.lineage_envelope_key_version,
            &forget,
        )
        .unwrap();
        let forgotten = store
            .apply_revision_transition_cas(
                &AuthorityExpectationV1::Existing(corrected.token),
                forget,
            )
            .unwrap();
        let purging = store
            .advance_purge_transition_cas(
                &AuthorityExpectationV1::Existing(forgotten.token),
                &root,
                PurgeExecutionStatusV1::InProgress,
            )
            .unwrap();
        store
            .advance_purge_transition_cas(
                &AuthorityExpectationV1::Existing(purging),
                &root,
                PurgeExecutionStatusV1::Completed,
            )
            .unwrap();
        let generation = store.load_revision_generation(&hex('a')).unwrap().unwrap();
        assert!(read_in_generation(&generation, &scope, &KEY)
            .unwrap()
            .is_empty());
        assert_eq!(
            commit_in_store(&mut store, &scope, &KEY, request(), |commit| commit()).unwrap_err(),
            SourceNoteErrorV1::Forgotten
        );
    }

    #[test]
    fn semantic_note_denial_and_wrong_resident_never_commit() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = open(&temp);
        let scope = address();
        assert_eq!(
            commit_in_store(&mut store, &scope, &KEY, request(), |_| Err(
                SourceNoteErrorV1::Denied
            ))
            .unwrap_err(),
            SourceNoteErrorV1::Denied
        );
        assert!(store.load_revision_generation(&hex('a')).unwrap().is_none());
        let wrong =
            resident_notebook_address(&hex('a'), &hex('d'), SafeU53::new(1).unwrap()).unwrap();
        assert_eq!(
            commit_in_store(&mut store, &wrong, &KEY, request(), |commit| commit()).unwrap_err(),
            SourceNoteErrorV1::Invalid
        );
        assert!(store.load_revision_generation(&hex('a')).unwrap().is_none());
    }

    #[test]
    fn semantic_note_seal_is_authenticated_bounded_and_exact_repeat_identity_is_stable() {
        let request = request();
        assert!(request
            .seal
            .tag()
            .unwrap()
            .starts_with(SOURCE_NOTE_SEAL_TAG));
        // Decode is tested through real encrypted storage above; source scope
        // cannot be substituted or widened by a draft's claimed metadata.
        let mut forged = request.seal.clone();
        forged.resident_pubkey = hex('d');
        assert!(forged.validate().is_err());
        assert_eq!(
            note_id(
                &hex('a'),
                &hex('b'),
                request.note.category,
                "one  useful\n detail"
            )
            .unwrap(),
            note_id(
                &hex('a'),
                &hex('b'),
                request.note.category,
                "one useful detail"
            )
            .unwrap()
        );
    }
}
