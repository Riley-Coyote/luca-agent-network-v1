//! Trusted desktop adapter for one bounded, read-only continuity context turn.
//!
//! All decrypted bodies remain inside the synchronous immutable-lease callback.
//! The adapter returns only body-free status and receipt metadata; canonical
//! packet wire is lent once to a consuming sink and can never be returned.

use std::{
    fmt,
    panic::{catch_unwind, AssertUnwindSafe},
    time::Instant,
};

use luca_continuity::{
    ContinuityContextResolver, ContinuityLayerMaterial, ContinuityReadSnapshot,
    ContinuityReferenceItem, DurableContinuityRecordKind, NamespaceScope, RetrievalResult,
    RetrievalText,
};
use luca_protocol::{
    canonical_sha256, ContinuityContextRequestV1, ContinuityLayerStatusV1,
    ContinuityNamespaceKindV1, ContinuityNamespaceV1, ContinuityScopeV1, Hex64, OpaqueId, SafeU53,
    Sha256Ref, CONTINUITY_PROTOCOL, MAX_RECALLED_MEMORY_NOTES,
};

use crate::app_state::AppState;

use super::continuity_runtime::{
    ContinuityReadLeaseOutcomeV1, ContinuityReadLeaseReceiptV1, ContinuityReadLeaseRequestV1,
};

const FIXED_LAYER_COUNT: usize = 5;
const RESIDENT_NAMESPACE_DOMAIN: &str = "luca.continuity.resident-private.namespace.v1";
const RESIDENT_NOTEBOOK_SCOPE_DOMAIN: &str = "luca.continuity.resident-private.notebook.v1";
const RESIDENT_NOTEBOOK_SOURCE_ID: &str = "resident-notebook";

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
    capsule: ContinuityLayerMaterial,
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
        capsule,
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
        F: for<'lease> FnOnce(&'lease RetrievalResult);
}

impl ContinuityLeaseReader for AppState {
    fn read<F>(
        &self,
        request: ContinuityReadLeaseRequestV1,
        consumer: F,
    ) -> ContinuityReadLeaseOutcomeV1
    where
        F: for<'lease> FnOnce(&'lease RetrievalResult),
    {
        self.read_continuity_lease(request, |view| consumer(view.retrieval))
    }
}

#[allow(clippy::too_many_arguments)] // Keeps test and desktop readers on one frozen boundary.
fn resolve_with_lease_reader<R, F>(
    reader: &R,
    request: ContinuityContextRequestV1,
    address: NamespaceScope,
    cue: RetrievalText,
    capsule: ContinuityLayerMaterial,
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

    let lease_request = ContinuityReadLeaseRequestV1 {
        owner_pubkey: request.owner_pubkey.clone(),
        address,
        cue,
        query_vector: None,
        deadline,
    };
    let mut callback_receipt = None;
    let mut sink = Some(sink);
    let mut capsule = Some(capsule);
    let lease_outcome = reader.read(lease_request, |retrieval| {
        let snapshot = capsule
            .take()
            .ok_or(luca_continuity::ContinuityError::InvalidContextLayer)
            .and_then(|capsule| assemble_ready_snapshot(retrieval, capsule));
        callback_receipt = Some(resolve_snapshot_to_receipt(
            &request,
            snapshot,
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
            let snapshot = capsule
                .take()
                .ok_or(luca_continuity::ContinuityError::InvalidContextLayer)
                .and_then(|capsule| degraded_notebook_snapshot(capsule, lease_status));
            let mut resolved = resolve_snapshot_to_receipt(
                &request,
                snapshot,
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

fn assemble_ready_snapshot(
    retrieval: &RetrievalResult,
    capsule: ContinuityLayerMaterial,
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
            DurableContinuityRecordKind::Journal
                | DurableContinuityRecordKind::JournalAnnotation
        ) {
            continue;
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
            | DurableContinuityRecordKind::JournalAnnotation => unreachable!(
                "explicit-disclosure-only records are excluded before materialization"
            ),
        }
    }
    Ok(ContinuityReadSnapshot {
        capsule,
        handoff: layer_from_items(handoff)?,
        hypomnema: layer_from_items(hypomnema)?,
        associative_recall: layer_from_items(associative_recall)?,
        owner_brain: denied_layer()?,
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

fn denied_layer() -> Result<ContinuityLayerMaterial, luca_continuity::ContinuityError> {
    ContinuityLayerMaterial::status(ContinuityLayerStatusV1::Denied, None)
}

fn degraded_notebook_snapshot(
    capsule: ContinuityLayerMaterial,
    status: ContinuityLayerStatusV1,
) -> Result<ContinuityReadSnapshot, luca_continuity::ContinuityError> {
    Ok(ContinuityReadSnapshot {
        capsule,
        handoff: ContinuityLayerMaterial::status(status, None)?,
        hypomnema: ContinuityLayerMaterial::status(status, None)?,
        associative_recall: ContinuityLayerMaterial::status(status, None)?,
        owner_brain: ContinuityLayerMaterial::status(ContinuityLayerStatusV1::Denied, None)?,
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
mod tests {
    use super::*;
    use std::{cell::Cell, cell::RefCell, sync::Mutex, time::Duration};

    use luca_continuity::{
        InMemoryRetrievalIndex, RetrievalQuery, RetrievalRecord, RetrievalRecordInput,
        RetrievalRecordState,
    };
    use luca_protocol::{
        ContinuityContextResultV1, ContinuityNamespaceV1, ContinuityScopeV1, ProviderEgressV1,
        SafeU53, CONTINUITY_PROTOCOL, MAX_CONTINUITY_PACKET_BYTES,
    };
    use sha2::{Digest, Sha256};

    fn hex(digit: char) -> Hex64 {
        Hex64::parse(digit.to_string().repeat(64)).unwrap()
    }

    fn sha(digit: char) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{}", digit.to_string().repeat(64))).unwrap()
    }

    fn address(kind: ContinuityNamespaceKindV1, resident: Option<Hex64>) -> NamespaceScope {
        let namespace = ContinuityNamespaceV1 {
            protocol: CONTINUITY_PROTOCOL.into(),
            owner_pubkey: hex('1'),
            kind,
            resident_pubkey: resident,
            namespace_ref: sha('3'),
            key_version: SafeU53::new(1).unwrap(),
        };
        NamespaceScope::new(
            namespace.clone().try_into().unwrap(),
            ContinuityScopeV1 {
                protocol: CONTINUITY_PROTOCOL.into(),
                namespace_ref: namespace.namespace_ref,
                scope_ref: sha('4'),
                source_id: None,
                project_id: None,
                room_id: None,
                conversation_id: Some(OpaqueId::parse("conversation-1").unwrap()),
            },
        )
        .unwrap()
    }

    fn resident_address() -> NamespaceScope {
        address(ContinuityNamespaceKindV1::ResidentPrivate, Some(hex('2')))
    }

    #[test]
    fn resident_notebook_address_is_stable_across_rotation_and_isolated_by_identity() {
        let first = resident_notebook_address(&hex('1'), &hex('2'), SafeU53::new(1).unwrap())
            .expect("first address");
        let rotated = resident_notebook_address(&hex('1'), &hex('2'), SafeU53::new(2).unwrap())
            .expect("rotated address");
        let other = resident_notebook_address(&hex('1'), &hex('3'), SafeU53::new(1).unwrap())
            .expect("other resident");

        assert_eq!(
            first.namespace().as_protocol().namespace_ref,
            rotated.namespace().as_protocol().namespace_ref
        );
        assert_eq!(
            first.as_protocol().scope_ref,
            rotated.as_protocol().scope_ref
        );
        assert_ne!(
            first.namespace().as_protocol().namespace_ref,
            other.namespace().as_protocol().namespace_ref
        );
        assert_ne!(first.as_protocol().scope_ref, other.as_protocol().scope_ref);
        assert_eq!(
            first.as_protocol().source_id.as_ref().map(OpaqueId::as_str),
            Some(RESIDENT_NOTEBOOK_SOURCE_ID)
        );
    }

    fn request(max_packet_bytes: usize) -> ContinuityContextRequestV1 {
        ContinuityContextRequestV1 {
            protocol: CONTINUITY_PROTOCOL.into(),
            request_id: OpaqueId::parse("desktop-context-1").unwrap(),
            owner_pubkey: hex('1'),
            resident_pubkey: hex('2'),
            conversation_id: OpaqueId::parse("conversation-1").unwrap(),
            binding_ref: sha('5'),
            canonical_dispatch_ref: sha('6'),
            provider_egress: ProviderEgressV1::Local,
            deadline_unix_ms: SafeU53::new(10_000).unwrap(),
            max_packet_bytes: SafeU53::new(max_packet_bytes as u64).unwrap(),
            history_event_ids: vec![hex('7')],
        }
    }

    fn retrieval(address: &NamespaceScope) -> RetrievalResult {
        let specs = [
            ("01-handoff", "handoff", "handoff-private-body"),
            ("04-journal", "journal", "journal-private-body"),
            ("06-commitment", "commitment", "associative-private-body"),
            ("07-note", "memory-note", "memory-note-private-1"),
            ("08-note", "memory-note", "memory-note-private-2"),
            ("09-note", "memory-note", "memory-note-private-3"),
            ("10-note", "memory-note", "memory-note-private-4"),
            ("11-note", "memory-note", "memory-note-private-5"),
            ("12-note", "memory-note", "memory-note-private-6"),
        ];
        let records = specs
            .into_iter()
            .enumerate()
            .map(|(index, (record_id, record_type, body))| {
                RetrievalRecord::new(RetrievalRecordInput {
                    address: address.clone(),
                    record_id: OpaqueId::parse(record_id).unwrap(),
                    record_type: OpaqueId::parse(record_type).unwrap(),
                    revision: SafeU53::new(0).unwrap(),
                    body: RetrievalText::from(body),
                    tags: vec![RetrievalText::from("continuity")],
                    confidence_basis_points: 8_000,
                    provenance_refs: vec![
                        Sha256Ref::parse(format!("sha256:{:064x}", index + 10)).unwrap()
                    ],
                    outgoing_edges: Vec::new(),
                    state: RetrievalRecordState::Active,
                })
                .unwrap()
            })
            .collect::<Vec<_>>();
        InMemoryRetrievalIndex::hydrate(&records)
            .unwrap()
            .retrieve(
                &RetrievalQuery {
                    address: address.clone(),
                    cue: RetrievalText::from("continuity"),
                    query_vector: None,
                },
                None,
            )
            .unwrap()
    }

    struct FakeLeaseReader {
        status: ContinuityLayerStatusV1,
        retrieval: Option<RetrievalResult>,
        calls: Cell<usize>,
        lifecycle: Mutex<()>,
    }

    impl FakeLeaseReader {
        fn ready(retrieval: RetrievalResult) -> Self {
            Self {
                status: ContinuityLayerStatusV1::Ready,
                retrieval: Some(retrieval),
                calls: Cell::new(0),
                lifecycle: Mutex::new(()),
            }
        }

        fn status(status: ContinuityLayerStatusV1) -> Self {
            Self {
                status,
                retrieval: None,
                calls: Cell::new(0),
                lifecycle: Mutex::new(()),
            }
        }
    }

    impl ContinuityLeaseReader for FakeLeaseReader {
        fn read<F>(
            &self,
            request: ContinuityReadLeaseRequestV1,
            consumer: F,
        ) -> ContinuityReadLeaseOutcomeV1
        where
            F: for<'lease> FnOnce(&'lease RetrievalResult),
        {
            let _lifecycle_guard = self.lifecycle.lock().unwrap();
            self.calls.set(self.calls.get() + 1);
            let receipt = ContinuityReadLeaseReceiptV1 {
                owner_pubkey: request.owner_pubkey,
                namespace_ref: request
                    .address
                    .namespace()
                    .as_protocol()
                    .namespace_ref
                    .clone(),
                scope_ref: request.address.as_protocol().scope_ref.clone(),
                authority_generation: Some(SafeU53::new(1).unwrap()),
                snapshot_fingerprint: Some(sha('8')),
                attempt_count: 1,
                hit_count: self
                    .retrieval
                    .as_ref()
                    .map_or(0, |retrieval| retrieval.hits.len()),
            };
            match self.status {
                ContinuityLayerStatusV1::Ready => {
                    consumer(self.retrieval.as_ref().unwrap());
                    ContinuityReadLeaseOutcomeV1::Ready(receipt)
                }
                ContinuityLayerStatusV1::Empty => ContinuityReadLeaseOutcomeV1::Empty(receipt),
                ContinuityLayerStatusV1::Denied => ContinuityReadLeaseOutcomeV1::Denied(receipt),
                ContinuityLayerStatusV1::Stale => ContinuityReadLeaseOutcomeV1::Stale(receipt),
                ContinuityLayerStatusV1::Locked => ContinuityReadLeaseOutcomeV1::Locked(receipt),
                ContinuityLayerStatusV1::Unavailable => {
                    ContinuityReadLeaseOutcomeV1::Unavailable(receipt)
                }
                ContinuityLayerStatusV1::Timeout => ContinuityReadLeaseOutcomeV1::Timeout(receipt),
                ContinuityLayerStatusV1::Invalid => ContinuityReadLeaseOutcomeV1::Invalid(receipt),
            }
        }
    }

    fn run<R, F>(
        reader: &R,
        request: ContinuityContextRequestV1,
        address: NamespaceScope,
        sink: F,
    ) -> DesktopContinuityContextOutcomeV1
    where
        R: ContinuityLeaseReader,
        F: FnOnce(&[u8]),
    {
        resolve_with_lease_reader(
            reader,
            request,
            address,
            RetrievalText::from("continuity"),
            empty_layer().unwrap(),
            Instant::now() + Duration::from_secs(1),
            1,
            sink,
        )
    }

    fn run_with_capsule<R, F>(
        reader: &R,
        request: ContinuityContextRequestV1,
        address: NamespaceScope,
        capsule: ContinuityLayerMaterial,
        sink: F,
    ) -> DesktopContinuityContextOutcomeV1
    where
        R: ContinuityLeaseReader,
        F: FnOnce(&[u8]),
    {
        resolve_with_lease_reader(
            reader,
            request,
            address,
            RetrievalText::from("continuity"),
            capsule,
            Instant::now() + Duration::from_secs(1),
            1,
            sink,
        )
    }

    fn ready_capsule() -> ContinuityLayerMaterial {
        ContinuityLayerMaterial::ready(vec![ContinuityReferenceItem::new(
            OpaqueId::parse("portable-capsule").unwrap(),
            "portable-capsule-private-body".to_owned(),
            vec![sha('9')],
        )
        .unwrap()])
        .unwrap()
    }

    #[test]
    fn exact_owner_and_resident_private_identity_deny_before_lease() {
        let mut wrong_owner = request(MAX_CONTINUITY_PACKET_BYTES);
        wrong_owner.owner_pubkey = hex('9');
        let mut wrong_resident = request(MAX_CONTINUITY_PACKET_BYTES);
        wrong_resident.resident_pubkey = hex('a');
        let owner_brain = address(ContinuityNamespaceKindV1::OwnerBrain, None);
        for (request, address) in [
            (wrong_owner, resident_address()),
            (wrong_resident, resident_address()),
            (request(MAX_CONTINUITY_PACKET_BYTES), owner_brain),
        ] {
            let reader = FakeLeaseReader::status(ContinuityLayerStatusV1::Unavailable);
            let sink_count = Cell::new(0);
            let outcome = run(&reader, request, address, |_| {
                sink_count.set(sink_count.get() + 1)
            });
            assert_eq!(reader.calls.get(), 0);
            assert_eq!(sink_count.get(), 0);
            assert_eq!(outcome.receipt().status, ContinuityLayerStatusV1::Denied);
            assert_eq!(
                outcome.receipt().disposition,
                DesktopContinuityContextDispositionV1::Skipped
            );
        }
    }

    #[test]
    fn invalid_request_is_not_misreported_as_authorization_denial() {
        let mut invalid = request(MAX_CONTINUITY_PACKET_BYTES);
        invalid.protocol = "not-luca-continuity".into();
        let reader = FakeLeaseReader::status(ContinuityLayerStatusV1::Unavailable);
        let sink_count = Cell::new(0);
        let outcome = run(&reader, invalid, resident_address(), |_| {
            sink_count.set(sink_count.get() + 1)
        });
        assert_eq!(reader.calls.get(), 0);
        assert_eq!(sink_count.get(), 0);
        assert_eq!(outcome.receipt().status, ContinuityLayerStatusV1::Invalid);
        assert_eq!(
            outcome.receipt().disposition,
            DesktopContinuityContextDispositionV1::Skipped
        );
    }

    #[test]
    fn ready_records_are_categorized_and_delivered_once_deterministically() {
        fn once() -> ([u8; 32], DesktopContinuityContextOutcomeV1, usize, usize) {
            let address = resident_address();
            let reader = FakeLeaseReader::ready(retrieval(&address));
            let sink_count = Cell::new(0);
            let wire_digest = RefCell::new([0_u8; 32]);
            let outcome = run(
                &reader,
                request(MAX_CONTINUITY_PACKET_BYTES),
                address,
                |wire| {
                    sink_count.set(sink_count.get() + 1);
                    wire_digest
                        .borrow_mut()
                        .copy_from_slice(&Sha256::digest(wire));
                    let result: ContinuityContextResultV1 = serde_json::from_slice(wire).unwrap();
                    let packet = result.packet.unwrap();
                    assert!(packet.content.contains("handoff-private-body"));
                    assert!(!packet.content.contains("journal-private-body"));
                    assert!(packet.content.contains("associative-private-body"));
                    assert!(packet.content.contains("memory-note-private-1"));
                    assert!(packet.content.contains("memory-note-private-5"));
                    assert!(!packet.content.contains("memory-note-private-6"));
                },
            );
            let digest = *wire_digest.borrow();
            (digest, outcome, reader.calls.get(), sink_count.get())
        }

        let (left_digest, left, lease_calls, sink_calls) = once();
        let (right_digest, right, _, _) = once();
        assert_eq!(left_digest, right_digest);
        assert_eq!(lease_calls, 1);
        assert_eq!(sink_calls, 1);
        assert_eq!(left.receipt(), right.receipt());
        assert_eq!(left.receipt().status, ContinuityLayerStatusV1::Ready);
        assert_eq!(
            left.receipt().layer_statuses,
            [
                ContinuityLayerStatusV1::Empty,
                ContinuityLayerStatusV1::Ready,
                ContinuityLayerStatusV1::Ready,
                ContinuityLayerStatusV1::Ready,
                ContinuityLayerStatusV1::Denied,
            ]
        );
        assert_eq!(
            left.receipt().disposition,
            DesktopContinuityContextDispositionV1::Delivered
        );
    }

    #[test]
    fn verified_capsule_is_independent_of_every_notebook_lease_failure() {
        let address = resident_address();
        let reader = FakeLeaseReader::ready(retrieval(&address));
        let ready = run_with_capsule(
            &reader,
            request(MAX_CONTINUITY_PACKET_BYTES),
            address.clone(),
            ready_capsule(),
            |wire| {
                let result: ContinuityContextResultV1 = serde_json::from_slice(wire).unwrap();
                assert!(result
                    .packet
                    .unwrap()
                    .content
                    .contains("portable-capsule-private-body"));
            },
        );
        assert_eq!(
            ready.receipt().layer_statuses[0],
            ContinuityLayerStatusV1::Ready
        );

        for status in [
            ContinuityLayerStatusV1::Empty,
            ContinuityLayerStatusV1::Denied,
            ContinuityLayerStatusV1::Stale,
            ContinuityLayerStatusV1::Locked,
            ContinuityLayerStatusV1::Unavailable,
            ContinuityLayerStatusV1::Timeout,
            ContinuityLayerStatusV1::Invalid,
        ] {
            let reader = FakeLeaseReader::status(status);
            let outcome = run_with_capsule(
                &reader,
                request(MAX_CONTINUITY_PACKET_BYTES),
                address.clone(),
                ready_capsule(),
                |wire| {
                    let result: ContinuityContextResultV1 = serde_json::from_slice(wire).unwrap();
                    assert!(result
                        .packet
                        .unwrap()
                        .content
                        .contains("portable-capsule-private-body"));
                },
            );
            assert_eq!(outcome.receipt().status, ContinuityLayerStatusV1::Ready);
            assert_eq!(
                outcome.receipt().layer_statuses[0],
                ContinuityLayerStatusV1::Ready
            );
            assert_eq!(outcome.receipt().layer_statuses[1], status);
            assert_eq!(
                outcome.receipt().disposition,
                DesktopContinuityContextDispositionV1::Delivered
            );
        }
    }

    #[test]
    fn every_nonready_lease_status_skips_without_sink() {
        for status in [
            ContinuityLayerStatusV1::Empty,
            ContinuityLayerStatusV1::Denied,
            ContinuityLayerStatusV1::Stale,
            ContinuityLayerStatusV1::Locked,
            ContinuityLayerStatusV1::Unavailable,
            ContinuityLayerStatusV1::Timeout,
            ContinuityLayerStatusV1::Invalid,
        ] {
            let reader = FakeLeaseReader::status(status);
            let sink_count = Cell::new(0);
            let outcome = run(
                &reader,
                request(MAX_CONTINUITY_PACKET_BYTES),
                resident_address(),
                |_| sink_count.set(sink_count.get() + 1),
            );
            assert_eq!(reader.calls.get(), 1);
            assert_eq!(sink_count.get(), 0);
            assert_eq!(outcome.receipt().status, status);
            assert_eq!(
                outcome.receipt().layer_statuses,
                skipped_layer_statuses(status)
            );
            assert_eq!(
                outcome.receipt().disposition,
                DesktopContinuityContextDispositionV1::Skipped
            );
        }
    }

    #[test]
    fn pure_budget_failure_delivers_one_honest_status_only_invalid_result() {
        let address = resident_address();
        let reader = FakeLeaseReader::ready(retrieval(&address));
        let sink_count = Cell::new(0);
        let outcome = run(&reader, request(1), address, |wire| {
            sink_count.set(sink_count.get() + 1);
            let result: ContinuityContextResultV1 = serde_json::from_slice(wire).unwrap();
            assert!(result.packet.is_none());
            assert_eq!(
                result
                    .layers
                    .iter()
                    .map(|layer| layer.status)
                    .collect::<Vec<_>>(),
                skipped_layer_statuses(ContinuityLayerStatusV1::Invalid)
            );
        });
        assert_eq!(reader.calls.get(), 1);
        assert_eq!(sink_count.get(), 1);
        assert_eq!(outcome.receipt().status, ContinuityLayerStatusV1::Invalid);
        assert_eq!(
            outcome.receipt().disposition,
            DesktopContinuityContextDispositionV1::Delivered
        );
    }

    #[test]
    fn sink_panic_fails_soft_without_poisoning_the_lifecycle_or_retrying() {
        let address = resident_address();
        let reader = FakeLeaseReader::ready(retrieval(&address));
        let first_sink_count = Cell::new(0);
        let first = run(
            &reader,
            request(MAX_CONTINUITY_PACKET_BYTES),
            address.clone(),
            |_| {
                first_sink_count.set(first_sink_count.get() + 1);
                panic!("synthetic sink failure");
            },
        );
        assert_eq!(first_sink_count.get(), 1);
        assert_eq!(reader.calls.get(), 1);
        assert_eq!(first.receipt().status, ContinuityLayerStatusV1::Invalid);
        assert_eq!(
            first.receipt().disposition,
            DesktopContinuityContextDispositionV1::Skipped
        );
        assert!(reader.lifecycle.lock().is_ok());

        let second_sink_count = Cell::new(0);
        let second = run(
            &reader,
            request(MAX_CONTINUITY_PACKET_BYTES),
            address,
            |_| second_sink_count.set(second_sink_count.get() + 1),
        );
        assert_eq!(second_sink_count.get(), 1);
        assert_eq!(reader.calls.get(), 2);
        assert_eq!(second.receipt().status, ContinuityLayerStatusV1::Ready);
        assert_eq!(
            second.receipt().disposition,
            DesktopContinuityContextDispositionV1::Delivered
        );
    }

    #[test]
    fn adapter_source_is_read_only_and_debug_is_body_free() {
        let source = include_str!("continuity_context.rs");
        for forbidden in [
            ["apply", "_revision"].concat(),
            ["write", "_record"].concat(),
            ["rotate", "_key"].concat(),
            ["persist", "_receipt"].concat(),
            ["std::", "fs"].concat(),
        ] {
            assert!(
                !source.contains(&forbidden),
                "forbidden source API: {forbidden}"
            );
        }

        let address = resident_address();
        let reader = FakeLeaseReader::ready(retrieval(&address));
        let outcome = run(
            &reader,
            request(MAX_CONTINUITY_PACKET_BYTES),
            address,
            |_| {},
        );
        let debug = format!("{outcome:?}");
        for private in [
            "handoff-private-body",
            "hypomnema-private-body",
            "associative-private-body",
        ] {
            assert!(!debug.contains(private));
        }
        assert!(!debug.contains("packet"));
    }
}
