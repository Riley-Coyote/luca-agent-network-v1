//! Trusted desktop adapter for one bounded, read-only continuity context turn.
//!
//! All decrypted bodies remain inside the synchronous immutable-lease callback.
//! The adapter returns only body-free status and receipt metadata; canonical
//! packet wire is lent once to a consuming sink and can never be returned.

use std::{
    collections::BTreeMap,
    fmt,
    panic::{catch_unwind, AssertUnwindSafe},
    time::Instant,
};

use luca_continuity::{
    ContinuityContextResolver, ContinuityLayerMaterial, ContinuityReadSnapshot,
    ContinuityReferenceItem, ContinuityWakeCompileInput, ContinuityWakeCompiler,
    ContinuityWakeSourceItem, DurableContinuityRecordKind, NamespaceScope, RetrievalResult,
    RetrievalText,
};
use luca_protocol::{
    canonical_sha256, ContinuityContextRequestV1, ContinuityLayerStatusV1,
    ContinuityNamespaceKindV1, ContinuityNamespaceV1, ContinuityScopeV1,
    ContinuityWakeHandoffV1, ContinuityWakeItemV1, ContinuityWorkingReferenceV1, Hex64, OpaqueId,
    SafeU53, Sha256Ref, CONTINUITY_PROTOCOL, MAX_RECALLED_MEMORY_NOTES,
};
use sha2::{Digest, Sha256};

use crate::app_state::AppState;

use super::continuity_runtime::{
    ContinuityActiveLeaseRecordV1, ContinuityReadLeaseOutcomeV1, ContinuityReadLeaseReceiptV1,
    ContinuityReadLeaseRequestV1,
};

const FIXED_LAYER_COUNT: usize = 5;
const RESIDENT_NAMESPACE_DOMAIN: &str = "luca.continuity.resident-private.namespace.v1";
const RESIDENT_NOTEBOOK_SCOPE_DOMAIN: &str = "luca.continuity.resident-private.notebook.v1";
const RESIDENT_NOTEBOOK_SOURCE_ID: &str = "resident-notebook";

/// Body-bearing supplementary sources loaded under their existing independent
/// authorities before Wake compilation. Debug is intentionally unavailable.
pub(crate) struct DesktopWakeSupplementV1 {
    pub(crate) capsule_layer: ContinuityLayerMaterial,
    pub(crate) capsule_identity_orientation: Vec<ContinuityWakeItemV1>,
    pub(crate) capsule_relationship_orientation: Vec<ContinuityWakeItemV1>,
    pub(crate) owner_brain_layer: ContinuityLayerMaterial,
    pub(crate) owner_brain_references: Vec<ContinuityWorkingReferenceV1>,
}

/// Derive the one stable resident-private notebook address used by pre-turn
/// retrieval and post-turn metabolism. Key rotation changes only the explicit
/// key version; the namespace and scope references remain stable.
pub(crate) fn resident_notebook_address(
    owner_pubkey: &Hex64,
    resident_pubkey: &Hex64,
    key_version: SafeU53,
) -> Result<NamespaceScope, luca_continuity::ContinuityError> {
    let namespace_ref = canonical_sha256(&serde_json::json!({
        "domain": RESIDENT_NAMESPACE_DOMAIN,
        "owner_pubkey": owner_pubkey,
        "resident_pubkey": resident_pubkey,
    }))
    .ok()
    .and_then(|digest| Sha256Ref::parse(format!("sha256:{digest}")).ok())
    .ok_or(luca_continuity::ContinuityError::InvalidNamespace)?;
    let source_id = OpaqueId::parse(RESIDENT_NOTEBOOK_SOURCE_ID)
        .map_err(|_| luca_continuity::ContinuityError::InvalidScope)?;
    let scope_ref = canonical_sha256(&serde_json::json!({
        "domain": RESIDENT_NOTEBOOK_SCOPE_DOMAIN,
        "namespace_ref": namespace_ref,
        "source_id": source_id,
    }))
    .ok()
    .and_then(|digest| Sha256Ref::parse(format!("sha256:{digest}")).ok())
    .ok_or(luca_continuity::ContinuityError::InvalidScope)?;
    let namespace = ContinuityNamespaceV1 {
        protocol: CONTINUITY_PROTOCOL.into(),
        owner_pubkey: owner_pubkey.clone(),
        kind: ContinuityNamespaceKindV1::ResidentPrivate,
        resident_pubkey: Some(resident_pubkey.clone()),
        namespace_ref: namespace_ref.clone(),
        key_version,
    };
    NamespaceScope::new(
        namespace.try_into()?,
        ContinuityScopeV1 {
            protocol: CONTINUITY_PROTOCOL.into(),
            namespace_ref,
            scope_ref,
            source_id: Some(source_id),
            project_id: None,
            room_id: None,
            conversation_id: None,
        },
    )
}

/// Whether canonical context wire reached the caller-owned sink.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DesktopContinuityContextDispositionV1 {
    Delivered,
    Skipped,
}

/// Body-free proof of one desktop continuity context attempt.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct DesktopContinuityContextReceiptV1 {
    pub(crate) request_id: OpaqueId,
    pub(crate) resident_pubkey: Hex64,
    pub(crate) status: ContinuityLayerStatusV1,
    pub(crate) layer_statuses: [ContinuityLayerStatusV1; FIXED_LAYER_COUNT],
    pub(crate) continuity_receipt_ref: Option<Sha256Ref>,
    pub(crate) lease_snapshot_ref: Option<Sha256Ref>,
    pub(crate) disposition: DesktopContinuityContextDispositionV1,
}

impl fmt::Debug for DesktopContinuityContextReceiptV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DesktopContinuityContextReceiptV1")
            .field("request_id", &self.request_id)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("status", &self.status)
            .field("layer_statuses", &self.layer_statuses)
            .field("continuity_receipt_ref", &self.continuity_receipt_ref)
            .field("lease_snapshot_ref", &self.lease_snapshot_ref)
            .field("disposition", &self.disposition)
            .finish()
    }
}

/// Body-free terminal outcome. Neither variant can carry packet content.
pub(crate) enum DesktopContinuityContextOutcomeV1 {
    Delivered(DesktopContinuityContextReceiptV1),
    Skipped(DesktopContinuityContextReceiptV1),
}

impl DesktopContinuityContextOutcomeV1 {
    pub(crate) fn receipt(&self) -> &DesktopContinuityContextReceiptV1 {
        match self {
            Self::Delivered(receipt) | Self::Skipped(receipt) => receipt,
        }
    }
}

impl fmt::Debug for DesktopContinuityContextOutcomeV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Delivered(receipt) => formatter.debug_tuple("Delivered").field(receipt).finish(),
            Self::Skipped(receipt) => formatter.debug_tuple("Skipped").field(receipt).finish(),
        }
    }
}

/// Resolve and deliver at most one body-bearing context wire inside the lease.
#[allow(clippy::too_many_arguments)] // Frozen boundary mirrors the versioned request contract.
pub(crate) fn resolve_desktop_continuity_context<F>(
    state: &AppState,
    request: ContinuityContextRequestV1,
    address: NamespaceScope,
    cue: RetrievalText,
    supplement: DesktopWakeSupplementV1,
    resident_override_status: Option<ContinuityLayerStatusV1>,
    deadline: Instant,
    now_unix_ms: u64,
    sink: F,
) -> DesktopContinuityContextOutcomeV1
where
    F: FnOnce(&[u8]),
{
    resolve_with_lease_reader(
        state,
        request,
        address,
        cue,
        supplement,
        resident_override_status,
        deadline,
        now_unix_ms,
        sink,
    )
}

trait ContinuityLeaseReader {
    fn read<F>(
        &self,
        request: ContinuityReadLeaseRequestV1,
        consumer: F,
    ) -> ContinuityReadLeaseOutcomeV1
    where
        F: for<'lease> FnOnce(ContinuityLeaseMaterialV1<'lease>);
}

struct ContinuityLeaseMaterialV1<'lease> {
    retrieval: &'lease RetrievalResult,
    active_records: &'lease [ContinuityActiveLeaseRecordV1],
}

impl ContinuityLeaseReader for AppState {
    fn read<F>(
        &self,
        request: ContinuityReadLeaseRequestV1,
        consumer: F,
    ) -> ContinuityReadLeaseOutcomeV1
    where
        F: for<'lease> FnOnce(ContinuityLeaseMaterialV1<'lease>),
    {
        self.read_continuity_lease(request, |view| {
            consumer(ContinuityLeaseMaterialV1 {
                retrieval: view.retrieval,
                active_records: view.active_records,
            })
        })
    }
}

#[allow(clippy::too_many_arguments)] // Keeps test and desktop readers on one frozen boundary.
fn resolve_with_lease_reader<R, F>(
    reader: &R,
    request: ContinuityContextRequestV1,
    address: NamespaceScope,
    cue: RetrievalText,
    supplement: DesktopWakeSupplementV1,
    resident_override_status: Option<ContinuityLayerStatusV1>,
    deadline: Instant,
    now_unix_ms: u64,
    sink: F,
) -> DesktopContinuityContextOutcomeV1
where
    R: ContinuityLeaseReader,
    F: FnOnce(&[u8]),
{
    if request.validate().is_err() {
        return skipped_receipt(&request, ContinuityLayerStatusV1::Invalid, None);
    }
    if !exact_resident_authority(&request, &address) {
        return skipped_receipt(&request, ContinuityLayerStatusV1::Denied, None);
    }

    if let Some(status) = resident_override_status {
        let mut sink = Some(sink);
        let cue_ref = cue_ref(&cue);
        let resolved = resolve_snapshot_to_receipt(
            &request,
            degraded_notebook_snapshot(
                supplement.capsule_layer,
                supplement.owner_brain_layer,
                status,
            ),
            WakeHostMaterialV1 {
                relationship_scope_ref: address.as_protocol().scope_ref.clone(),
                cue_ref,
                current_handoff: None,
                resident_items: Vec::new(),
                capsule_identity_orientation: supplement.capsule_identity_orientation,
                capsule_relationship_orientation: supplement.capsule_relationship_orientation,
                owner_brain_references: supplement.owner_brain_references,
            },
            now_unix_ms,
            &mut sink,
            false,
            Some(status),
        );
        return match resolved.disposition {
            DesktopContinuityContextDispositionV1::Delivered => {
                DesktopContinuityContextOutcomeV1::Delivered(resolved)
            }
            DesktopContinuityContextDispositionV1::Skipped => {
                DesktopContinuityContextOutcomeV1::Skipped(resolved)
            }
        };
    }

    let cue_ref = cue_ref(&cue);
    let relationship_scope_ref = address.as_protocol().scope_ref.clone();
    let lease_request = ContinuityReadLeaseRequestV1 {
        owner_pubkey: request.owner_pubkey.clone(),
        address,
        cue,
        query_vector: None,
        deadline,
    };
    let mut callback_receipt = None;
    let mut sink = Some(sink);
    let mut supplement = Some(supplement);
    let lease_outcome = reader.read(lease_request, |lease| {
        let supplement = supplement
            .take()
            .ok_or(luca_continuity::ContinuityError::InvalidContextLayer)
            .map(|supplement| {
                let wake = assemble_wake_material(
                    lease.active_records,
                    lease.retrieval,
                    relationship_scope_ref.clone(),
                    cue_ref.clone(),
                    supplement.capsule_identity_orientation,
                    supplement.capsule_relationship_orientation,
                    supplement.owner_brain_references,
                );
                let snapshot = assemble_ready_snapshot(
                    lease.retrieval,
                    supplement.capsule_layer,
                    supplement.owner_brain_layer,
                );
                (snapshot, wake)
            });
        let (snapshot, wake) = match supplement {
            Ok((snapshot, Ok(wake))) => (snapshot, wake),
            Ok((Err(error), _)) | Err(error) => {
                callback_receipt = Some(resolve_snapshot_to_receipt(
                    &request,
                    Err(error),
                    empty_wake_material(
                        relationship_scope_ref.clone(),
                        cue_ref.clone(),
                    ),
                    now_unix_ms,
                    &mut sink,
                    false,
                    None,
                ));
                return;
            }
            Ok((_, Err(error))) => {
                callback_receipt = Some(resolve_snapshot_to_receipt(
                    &request,
                    Err(error),
                    empty_wake_material(
                        relationship_scope_ref.clone(),
                        cue_ref.clone(),
                    ),
                    now_unix_ms,
                    &mut sink,
                    false,
                    None,
                ));
                return;
            }
        };
        callback_receipt = Some(resolve_snapshot_to_receipt(
            &request,
            snapshot,
            wake,
            now_unix_ms,
            &mut sink,
            false,
            None,
        ));
    });

    match lease_outcome {
        ContinuityReadLeaseOutcomeV1::Ready(lease_receipt) => {
            if let Some(mut receipt) = callback_receipt {
                receipt.lease_snapshot_ref = lease_receipt.snapshot_fingerprint;
                match receipt.disposition {
                    DesktopContinuityContextDispositionV1::Delivered => {
                        DesktopContinuityContextOutcomeV1::Delivered(receipt)
                    }
                    DesktopContinuityContextDispositionV1::Skipped => {
                        DesktopContinuityContextOutcomeV1::Skipped(receipt)
                    }
                }
            } else {
                skipped_receipt(&request, ContinuityLayerStatusV1::Invalid, None)
            }
        }
        outcome => {
            let (lease_status, lease_receipt) = lease_status(outcome);
            let supplement = supplement
                .take()
                .ok_or(luca_continuity::ContinuityError::InvalidContextLayer)
                .map(|supplement| {
                    let wake = WakeHostMaterialV1 {
                        relationship_scope_ref: relationship_scope_ref.clone(),
                        cue_ref: cue_ref.clone(),
                        current_handoff: None,
                        resident_items: Vec::new(),
                        capsule_identity_orientation: supplement.capsule_identity_orientation,
                        capsule_relationship_orientation: supplement
                            .capsule_relationship_orientation,
                        owner_brain_references: supplement.owner_brain_references,
                    };
                    let snapshot = degraded_notebook_snapshot(
                        supplement.capsule_layer,
                        supplement.owner_brain_layer,
                        lease_status,
                    );
                    (snapshot, wake)
                });
            let (snapshot, wake) = match supplement {
                Ok((snapshot, wake)) => (snapshot, wake),
                Err(error) => (
                    Err(error),
                    empty_wake_material(relationship_scope_ref, cue_ref),
                ),
            };
            let mut resolved = resolve_snapshot_to_receipt(
                &request,
                snapshot,
                wake,
                now_unix_ms,
                &mut sink,
                true,
                Some(lease_status),
            );
            resolved.lease_snapshot_ref = lease_receipt.snapshot_fingerprint;
            match resolved.disposition {
                DesktopContinuityContextDispositionV1::Delivered => {
                    DesktopContinuityContextOutcomeV1::Delivered(resolved)
                }
                DesktopContinuityContextDispositionV1::Skipped => {
                    DesktopContinuityContextOutcomeV1::Skipped(resolved)
                }
            }
        }
    }
}

fn resolve_snapshot_to_receipt<F>(
    request: &ContinuityContextRequestV1,
    snapshot: Result<ContinuityReadSnapshot, luca_continuity::ContinuityError>,
    wake: WakeHostMaterialV1,
    now_unix_ms: u64,
    sink: &mut Option<F>,
    require_packet: bool,
    no_packet_status: Option<ContinuityLayerStatusV1>,
) -> DesktopContinuityContextReceiptV1
where
    F: FnOnce(&[u8]),
{
    let resolved = snapshot
        .and_then(|snapshot| ContinuityContextResolver::resolve(request, snapshot, now_unix_ms));
    let (output, forced_status) = match resolved {
        Ok(output) => (output, None),
        Err(_) => match invalid_status_snapshot()
            .and_then(|snapshot| ContinuityContextResolver::resolve(request, snapshot, now_unix_ms))
        {
            Ok(output) => (output, Some(ContinuityLayerStatusV1::Invalid)),
            Err(_) => {
                return receipt(
                    request,
                    ContinuityLayerStatusV1::Invalid,
                    skipped_layer_statuses(ContinuityLayerStatusV1::Invalid),
                    None,
                    None,
                    DesktopContinuityContextDispositionV1::Skipped,
                )
            }
        },
    };
    let output = if forced_status.is_none() {
        let compile = ContinuityWakeCompiler::compile(
            ContinuityWakeCompileInput {
                owner_pubkey: request.owner_pubkey.clone(),
                resident_pubkey: request.resident_pubkey.clone(),
                relationship_scope_ref: wake.relationship_scope_ref,
                request_id: request.request_id.clone(),
                cue_ref: wake.cue_ref,
                layer_statuses: output.layers().to_vec(),
                current_handoff: wake.current_handoff,
                resident_items: wake.resident_items,
                capsule_identity_orientation: wake.capsule_identity_orientation,
                capsule_relationship_orientation: wake.capsule_relationship_orientation,
                owner_brain_references: wake.owner_brain_references,
            },
            request.max_packet_bytes.get() as usize,
        )
        .and_then(|compiled| output.replace_packet(request, compiled.into_packet()));
        match compile {
            Ok(output) => output,
            Err(_) => match invalid_status_snapshot().and_then(|snapshot| {
                ContinuityContextResolver::resolve(request, snapshot, now_unix_ms)
            }) {
                Ok(output) => output,
                Err(_) => {
                    return receipt(
                        request,
                        ContinuityLayerStatusV1::Invalid,
                        skipped_layer_statuses(ContinuityLayerStatusV1::Invalid),
                        None,
                        None,
                        DesktopContinuityContextDispositionV1::Skipped,
                    )
                }
            },
        }
    } else {
        output
    };
    let layer_statuses = fixed_statuses(output.layers());
    let status = if let Some(status) = forced_status {
        status
    } else if output.has_packet() {
        ContinuityLayerStatusV1::Ready
    } else if output
        .layers()
        .iter()
        .all(|layer| layer.status == ContinuityLayerStatusV1::Timeout)
    {
        ContinuityLayerStatusV1::Timeout
    } else {
        no_packet_status.unwrap_or(ContinuityLayerStatusV1::Invalid)
    };
    let continuity_receipt_ref = Some(output.receipt_ref().clone());
    if require_packet && !output.has_packet() {
        return receipt(
            request,
            status,
            layer_statuses,
            continuity_receipt_ref,
            None,
            DesktopContinuityContextDispositionV1::Skipped,
        );
    }
    let Some(sink) = sink.take() else {
        return receipt(
            request,
            ContinuityLayerStatusV1::Invalid,
            skipped_layer_statuses(ContinuityLayerStatusV1::Invalid),
            None,
            None,
            DesktopContinuityContextDispositionV1::Skipped,
        );
    };
    if catch_unwind(AssertUnwindSafe(|| output.consume_wire(sink))).is_err() {
        return receipt(
            request,
            ContinuityLayerStatusV1::Invalid,
            layer_statuses,
            continuity_receipt_ref,
            None,
            DesktopContinuityContextDispositionV1::Skipped,
        );
    }
    receipt(
        request,
        status,
        layer_statuses,
        continuity_receipt_ref,
        None,
        DesktopContinuityContextDispositionV1::Delivered,
    )
}

fn exact_resident_authority(
    request: &ContinuityContextRequestV1,
    address: &NamespaceScope,
) -> bool {
    let namespace = address.namespace().as_protocol();
    namespace.owner_pubkey == request.owner_pubkey
        && namespace.kind == ContinuityNamespaceKindV1::ResidentPrivate
        && namespace.resident_pubkey.as_ref() == Some(&request.resident_pubkey)
}

struct WakeHostMaterialV1 {
    relationship_scope_ref: Sha256Ref,
    cue_ref: Sha256Ref,
    current_handoff: Option<ContinuityWakeHandoffV1>,
    resident_items: Vec<ContinuityWakeSourceItem>,
    capsule_identity_orientation: Vec<ContinuityWakeItemV1>,
    capsule_relationship_orientation: Vec<ContinuityWakeItemV1>,
    owner_brain_references: Vec<ContinuityWorkingReferenceV1>,
}

fn empty_wake_material(
    relationship_scope_ref: Sha256Ref,
    cue_ref: Sha256Ref,
) -> WakeHostMaterialV1 {
    WakeHostMaterialV1 {
        relationship_scope_ref,
        cue_ref,
        current_handoff: None,
        resident_items: Vec::new(),
        capsule_identity_orientation: Vec::new(),
        capsule_relationship_orientation: Vec::new(),
        owner_brain_references: Vec::new(),
    }
}

fn cue_ref(cue: &RetrievalText) -> Sha256Ref {
    let digest = Sha256::digest(cue.as_str().as_bytes());
    let hex = digest.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    Sha256Ref::parse(format!("sha256:{hex}"))
        .expect("sha-256 digest is always a valid reference")
}

fn assemble_wake_material(
    active_records: &[ContinuityActiveLeaseRecordV1],
    retrieval: &RetrievalResult,
    relationship_scope_ref: Sha256Ref,
    cue_ref: Sha256Ref,
    capsule_identity_orientation: Vec<ContinuityWakeItemV1>,
    capsule_relationship_orientation: Vec<ContinuityWakeItemV1>,
    owner_brain_references: Vec<ContinuityWorkingReferenceV1>,
) -> Result<WakeHostMaterialV1, luca_continuity::ContinuityError> {
    let retrieval_ranks = retrieval
        .hits
        .iter()
        .enumerate()
        .map(|(rank, hit)| (hit.record().record_id().clone(), rank))
        .collect::<BTreeMap<_, _>>();
    let mut current_handoff = None;
    let mut resident_items = Vec::with_capacity(active_records.len());
    for (ambient_rank, active) in active_records.iter().enumerate() {
        let record = &active.record;
        let kind = DurableContinuityRecordKind::parse(record.record_type())?;
        if matches!(
            kind,
            DurableContinuityRecordKind::Journal | DurableContinuityRecordKind::JournalAnnotation
        ) {
            continue;
        }
        if kind == DurableContinuityRecordKind::Handoff {
            if current_handoff.is_some() {
                return Err(luca_continuity::ContinuityError::InvalidContextLayer);
            }
            let handoff = serde_json::from_str(record.body())
                .map_err(|_| luca_continuity::ContinuityError::InvalidContextLayer)?;
            current_handoff = Some(ContinuityWakeHandoffV1 {
                active_record_id: record.record_id().clone(),
                revision: record.revision(),
                handoff,
                provenance_refs: record.provenance_refs().to_vec(),
            });
            continue;
        }
        let item = ContinuityWakeItemV1 {
            item_id: record.record_id().clone(),
            record_kind: record.record_type().clone(),
            author_kind: active.author_kind.clone(),
            body: record.body().to_owned(),
            source_event_ids: active.source_event_ids.clone(),
            provenance_refs: record.provenance_refs().to_vec(),
        };
        let selected_rank = retrieval_ranks.get(record.record_id()).copied();
        let rank = selected_rank.unwrap_or_else(|| retrieval.hits.len() + ambient_rank);
        let rank = SafeU53::new(rank as u64)
            .map_err(|_| luca_continuity::ContinuityError::InvalidContextLayer)?;
        resident_items.push(ContinuityWakeSourceItem::new(
            item,
            record.revision(),
            active.canonical_timestamp.clone(),
            rank,
            active.pinned_owner_correction,
            selected_rank.is_some(),
        )?);
    }
    Ok(WakeHostMaterialV1 {
        relationship_scope_ref,
        cue_ref,
        current_handoff,
        resident_items,
        capsule_identity_orientation,
        capsule_relationship_orientation,
        owner_brain_references,
    })
}

fn assemble_ready_snapshot(
    retrieval: &RetrievalResult,
    capsule: ContinuityLayerMaterial,
    owner_brain: ContinuityLayerMaterial,
) -> Result<ContinuityReadSnapshot, luca_continuity::ContinuityError> {
    let mut handoff = Vec::new();
    let mut hypomnema = Vec::new();
    let mut associative_recall = Vec::new();
    let mut memory_note_count = 0_usize;
    for hit in &retrieval.hits {
        let record = hit.record();
        let kind = DurableContinuityRecordKind::parse(record.record_type())?;
        if matches!(
            kind,
            DurableContinuityRecordKind::Journal | DurableContinuityRecordKind::JournalAnnotation
        ) {
            continue;
        }
        if matches!(
            kind,
            DurableContinuityRecordKind::OwnerBrainSource
                | DurableContinuityRecordKind::OwnerBrainBinding
                | DurableContinuityRecordKind::OwnerBrainChunkPage
                | DurableContinuityRecordKind::OwnerBrainGrant
                | DurableContinuityRecordKind::OwnerBrainReceipt
                | DurableContinuityRecordKind::ConnectedBrainSource
                | DurableContinuityRecordKind::ConnectedBrainBinding
                | DurableContinuityRecordKind::ConnectedBrainIndexPage
                | DurableContinuityRecordKind::RepositoryWorkGrant
        ) {
            return Err(luca_continuity::ContinuityError::InvalidRetrievalRecord);
        }
        let item = ContinuityReferenceItem::new(
            record.record_id().clone(),
            record.body().to_owned(),
            record.provenance_refs().to_vec(),
        )?;
        match kind {
            DurableContinuityRecordKind::Handoff | DurableContinuityRecordKind::OpenThread => {
                handoff.push(item);
            }
            DurableContinuityRecordKind::MemoryNote
                if memory_note_count < MAX_RECALLED_MEMORY_NOTES =>
            {
                memory_note_count += 1;
                hypomnema.push(item);
            }
            DurableContinuityRecordKind::MemoryNote => {}
            DurableContinuityRecordKind::Hypomnema | DurableContinuityRecordKind::Reflection => {
                hypomnema.push(item);
            }
            DurableContinuityRecordKind::Commitment
            | DurableContinuityRecordKind::Preference
            | DurableContinuityRecordKind::AssociativeEngram
            | DurableContinuityRecordKind::TypedConnection
            | DurableContinuityRecordKind::Identity
            | DurableContinuityRecordKind::Relationship
            | DurableContinuityRecordKind::Conviction => associative_recall.push(item),
            DurableContinuityRecordKind::Journal
            | DurableContinuityRecordKind::JournalAnnotation => {
                unreachable!("explicit-disclosure-only records are excluded before materialization")
            }
            DurableContinuityRecordKind::OwnerBrainSource
            | DurableContinuityRecordKind::OwnerBrainBinding
            | DurableContinuityRecordKind::OwnerBrainChunkPage
            | DurableContinuityRecordKind::OwnerBrainGrant
            | DurableContinuityRecordKind::OwnerBrainReceipt
            | DurableContinuityRecordKind::ConnectedBrainSource
            | DurableContinuityRecordKind::ConnectedBrainBinding
            | DurableContinuityRecordKind::ConnectedBrainIndexPage
            | DurableContinuityRecordKind::RepositoryWorkGrant => {
                return Err(luca_continuity::ContinuityError::InvalidRetrievalRecord)
            }
        }
    }
    Ok(ContinuityReadSnapshot {
        capsule,
        handoff: layer_from_items(handoff)?,
        hypomnema: layer_from_items(hypomnema)?,
        associative_recall: layer_from_items(associative_recall)?,
        owner_brain,
    })
}

fn layer_from_items(
    items: Vec<ContinuityReferenceItem>,
) -> Result<ContinuityLayerMaterial, luca_continuity::ContinuityError> {
    if items.is_empty() {
        empty_layer()
    } else {
        ContinuityLayerMaterial::ready(items)
    }
}

fn empty_layer() -> Result<ContinuityLayerMaterial, luca_continuity::ContinuityError> {
    ContinuityLayerMaterial::status(ContinuityLayerStatusV1::Empty, None)
}

#[cfg(test)]
fn denied_layer() -> Result<ContinuityLayerMaterial, luca_continuity::ContinuityError> {
    ContinuityLayerMaterial::status(ContinuityLayerStatusV1::Denied, None)
}

fn degraded_notebook_snapshot(
    capsule: ContinuityLayerMaterial,
    owner_brain: ContinuityLayerMaterial,
    status: ContinuityLayerStatusV1,
) -> Result<ContinuityReadSnapshot, luca_continuity::ContinuityError> {
    Ok(ContinuityReadSnapshot {
        capsule,
        handoff: ContinuityLayerMaterial::status(status, None)?,
        hypomnema: ContinuityLayerMaterial::status(status, None)?,
        associative_recall: ContinuityLayerMaterial::status(status, None)?,
        owner_brain,
    })
}

fn invalid_status_snapshot() -> Result<ContinuityReadSnapshot, luca_continuity::ContinuityError> {
    Ok(ContinuityReadSnapshot {
        capsule: ContinuityLayerMaterial::status(ContinuityLayerStatusV1::Empty, None)?,
        handoff: ContinuityLayerMaterial::status(ContinuityLayerStatusV1::Invalid, None)?,
        hypomnema: ContinuityLayerMaterial::status(ContinuityLayerStatusV1::Invalid, None)?,
        associative_recall: ContinuityLayerMaterial::status(
            ContinuityLayerStatusV1::Invalid,
            None,
        )?,
        owner_brain: ContinuityLayerMaterial::status(ContinuityLayerStatusV1::Denied, None)?,
    })
}

fn fixed_statuses(
    layers: &[luca_protocol::ContinuityLayerResultV1],
) -> [ContinuityLayerStatusV1; FIXED_LAYER_COUNT] {
    let mut statuses = [ContinuityLayerStatusV1::Invalid; FIXED_LAYER_COUNT];
    for (target, layer) in statuses.iter_mut().zip(layers.iter()) {
        *target = layer.status;
    }
    statuses
}

fn skipped_layer_statuses(
    status: ContinuityLayerStatusV1,
) -> [ContinuityLayerStatusV1; FIXED_LAYER_COUNT] {
    [
        ContinuityLayerStatusV1::Empty,
        status,
        status,
        status,
        ContinuityLayerStatusV1::Denied,
    ]
}

fn lease_status(
    outcome: ContinuityReadLeaseOutcomeV1,
) -> (ContinuityLayerStatusV1, ContinuityReadLeaseReceiptV1) {
    match outcome {
        ContinuityReadLeaseOutcomeV1::Empty(receipt) => (ContinuityLayerStatusV1::Empty, receipt),
        ContinuityReadLeaseOutcomeV1::Denied(receipt) => (ContinuityLayerStatusV1::Denied, receipt),
        ContinuityReadLeaseOutcomeV1::Stale(receipt) => (ContinuityLayerStatusV1::Stale, receipt),
        ContinuityReadLeaseOutcomeV1::Locked(receipt) => (ContinuityLayerStatusV1::Locked, receipt),
        ContinuityReadLeaseOutcomeV1::Unavailable(receipt) => {
            (ContinuityLayerStatusV1::Unavailable, receipt)
        }
        ContinuityReadLeaseOutcomeV1::Timeout(receipt) => {
            (ContinuityLayerStatusV1::Timeout, receipt)
        }
        ContinuityReadLeaseOutcomeV1::Invalid(receipt)
        | ContinuityReadLeaseOutcomeV1::Ready(receipt) => {
            (ContinuityLayerStatusV1::Invalid, receipt)
        }
    }
}

fn skipped_receipt(
    request: &ContinuityContextRequestV1,
    status: ContinuityLayerStatusV1,
    lease_snapshot_ref: Option<Sha256Ref>,
) -> DesktopContinuityContextOutcomeV1 {
    DesktopContinuityContextOutcomeV1::Skipped(receipt(
        request,
        status,
        skipped_layer_statuses(status),
        None,
        lease_snapshot_ref,
        DesktopContinuityContextDispositionV1::Skipped,
    ))
}

fn receipt(
    request: &ContinuityContextRequestV1,
    status: ContinuityLayerStatusV1,
    layer_statuses: [ContinuityLayerStatusV1; FIXED_LAYER_COUNT],
    continuity_receipt_ref: Option<Sha256Ref>,
    lease_snapshot_ref: Option<Sha256Ref>,
    disposition: DesktopContinuityContextDispositionV1,
) -> DesktopContinuityContextReceiptV1 {
    DesktopContinuityContextReceiptV1 {
        request_id: request.request_id.clone(),
        resident_pubkey: request.resident_pubkey.clone(),
        status,
        layer_statuses,
        continuity_receipt_ref,
        lease_snapshot_ref,
        disposition,
    }
}

#[cfg(test)]
#[path = "continuity_context_tests.rs"]
mod continuity_context_tests;
