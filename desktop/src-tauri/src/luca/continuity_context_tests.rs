use super::*;
use std::{cell::Cell, cell::RefCell, sync::Mutex, time::Duration};

use luca_continuity::{
    InMemoryRetrievalIndex, RetrievalQuery, RetrievalRecord, RetrievalRecordInput,
    RetrievalRecordState,
};
use luca_protocol::{
    CanonicalTimestamp, ContinuityContextResultV1, ContinuityNamespaceV1, ContinuityScopeV1,
    ProviderEgressV1, ResidentHandoffV1, SafeU53, CONTINUITY_PROTOCOL,
    MAX_CONTINUITY_PACKET_BYTES,
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

fn retrieval(address: &NamespaceScope) -> (RetrievalResult, Vec<ContinuityActiveLeaseRecordV1>) {
    let handoff = serde_json::to_string(&ResidentHandoffV1 {
        summary: "handoff-private-body".into(),
        unresolved_threads: Vec::new(),
        commitments: Vec::new(),
        explicit_preferences: Vec::new(),
        source_event_ids: vec![hex('d')],
        updated_at: CanonicalTimestamp::parse("2026-08-29T00:00:00Z").unwrap(),
    })
    .unwrap();
    let specs = vec![
        ("01-handoff", "handoff", handoff),
        ("04-journal", "journal", "journal-private-body".into()),
        ("06-commitment", "commitment", "associative-private-body".into()),
        ("07-note", "memory-note", "memory-note-private-1".into()),
        ("08-note", "memory-note", "memory-note-private-2".into()),
        ("09-note", "memory-note", "memory-note-private-3".into()),
        ("10-note", "memory-note", "memory-note-private-4".into()),
        ("11-note", "memory-note", "memory-note-private-5".into()),
        ("12-note", "memory-note", "memory-note-private-6".into()),
    ]
    .into_iter()
    .map(|(id, kind, body)| (id, kind, body.to_owned()))
    .collect::<Vec<_>>();
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
    let retrieval = InMemoryRetrievalIndex::hydrate(&records)
        .unwrap()
        .retrieve(
            &RetrievalQuery {
                address: address.clone(),
                cue: RetrievalText::from("continuity"),
                query_vector: None,
            },
            None,
        )
        .unwrap();
    let active_records = records
        .into_iter()
        .map(|record| ContinuityActiveLeaseRecordV1 {
            source_event_ids: if record.record_type().as_str() == "handoff" {
                vec![hex('d')]
            } else {
                Vec::new()
            },
            record,
            author_kind: OpaqueId::parse("resident").unwrap(),
            canonical_timestamp: CanonicalTimestamp::parse("2026-08-29T00:00:00Z").unwrap(),
            pinned_owner_correction: false,
        })
        .collect();
    (retrieval, active_records)
}

struct FakeLeaseReader {
    status: ContinuityLayerStatusV1,
    retrieval: Option<RetrievalResult>,
    active_records: Vec<ContinuityActiveLeaseRecordV1>,
    calls: Cell<usize>,
    lifecycle: Mutex<()>,
}

impl FakeLeaseReader {
    fn ready((retrieval, active_records): (RetrievalResult, Vec<ContinuityActiveLeaseRecordV1>)) -> Self {
        Self {
            status: ContinuityLayerStatusV1::Ready,
            retrieval: Some(retrieval),
            active_records,
            calls: Cell::new(0),
            lifecycle: Mutex::new(()),
        }
    }

    fn status(status: ContinuityLayerStatusV1) -> Self {
        Self {
            status,
            retrieval: None,
            active_records: Vec::new(),
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
        F: for<'lease> FnOnce(ContinuityLeaseMaterialV1<'lease>),
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
                consumer(ContinuityLeaseMaterialV1 {
                    retrieval: self.retrieval.as_ref().unwrap(),
                    active_records: &self.active_records,
                });
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
        supplement(empty_layer().unwrap(), denied_layer().unwrap()),
        None,
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
        DesktopWakeSupplementV1 {
            capsule_layer: capsule,
            capsule_identity_orientation: vec![ContinuityWakeItemV1 {
                item_id: OpaqueId::parse("portable-capsule-identity").unwrap(),
                record_kind: OpaqueId::parse("identity").unwrap(),
                author_kind: OpaqueId::parse("resident").unwrap(),
                body: "portable-capsule-private-body".into(),
                source_event_ids: vec![hex('e')],
                provenance_refs: vec![sha('9')],
            }],
            capsule_relationship_orientation: Vec::new(),
            owner_brain_layer: denied_layer().unwrap(),
            owner_brain_references: Vec::new(),
        },
        None,
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

fn supplement(
    capsule_layer: ContinuityLayerMaterial,
    owner_brain_layer: ContinuityLayerMaterial,
) -> DesktopWakeSupplementV1 {
    DesktopWakeSupplementV1 {
        capsule_layer,
        capsule_identity_orientation: Vec::new(),
        capsule_relationship_orientation: Vec::new(),
        owner_brain_layer,
        owner_brain_references: Vec::new(),
    }
}

#[test]
fn granted_owner_brain_remains_independent_when_resident_notebook_is_disabled() {
    let reader = FakeLeaseReader::status(ContinuityLayerStatusV1::Unavailable);
    let owner_brain = ContinuityLayerMaterial::ready(vec![ContinuityReferenceItem::new(
        OpaqueId::parse("brain-chunk-1").unwrap(),
        "authorized-owner-brain-body corpus-only-fact".to_owned(),
        vec![sha('a')],
    )
    .unwrap()])
    .unwrap();
    let sink_count = Cell::new(0);
    let outcome = resolve_with_lease_reader(
        &reader,
        request(MAX_CONTINUITY_PACKET_BYTES),
        resident_address(),
        RetrievalText::from("continuity"),
        DesktopWakeSupplementV1 {
            capsule_layer: empty_layer().unwrap(),
            capsule_identity_orientation: Vec::new(),
            capsule_relationship_orientation: Vec::new(),
            owner_brain_layer: owner_brain,
            owner_brain_references: vec![ContinuityWorkingReferenceV1 {
                item_id: OpaqueId::parse("brain-chunk-1").unwrap(),
                body: "authorized-owner-brain-body corpus-only-fact".into(),
                source_event_ids: Vec::new(),
                provenance_refs: vec![sha('a')],
            }],
        },
        Some(ContinuityLayerStatusV1::Empty),
        Instant::now() + Duration::from_secs(1),
        1,
        |wire| {
            sink_count.set(sink_count.get() + 1);
            let wire_text = String::from_utf8(wire.to_vec()).unwrap();
            let result: ContinuityContextResultV1 = serde_json::from_slice(wire).unwrap();
            let packet = result.packet.unwrap();
            assert!(packet.content.contains("authorized-owner-brain-body"));
            assert!(packet.content.contains("corpus-only-fact"));
            for forbidden in [
                "/Users/owner/private-corpus.md",
                "owner-brain-source-id",
                "owner-brain-grant-id",
                "denied-owner-brain-body",
                "revoked-owner-brain-body",
                "stale-owner-brain-body",
                "resident-private-notebook-body",
            ] {
                assert!(!wire_text.contains(forbidden));
            }
            assert_eq!(result.layers[1].status, ContinuityLayerStatusV1::Empty);
            assert_eq!(result.layers[4].status, ContinuityLayerStatusV1::Ready);
        },
    );
    assert_eq!(reader.calls.get(), 0);
    assert_eq!(sink_count.get(), 1);
    assert_eq!(outcome.receipt().status, ContinuityLayerStatusV1::Ready);
}

#[test]
fn non_ready_owner_brain_never_reaches_the_provider_sink() {
    for status in [
        ContinuityLayerStatusV1::Denied,
        ContinuityLayerStatusV1::Stale,
        ContinuityLayerStatusV1::Locked,
        ContinuityLayerStatusV1::Unavailable,
        ContinuityLayerStatusV1::Invalid,
    ] {
        let reader = FakeLeaseReader::status(ContinuityLayerStatusV1::Unavailable);
        let owner_brain = ContinuityLayerMaterial::status(status, None).unwrap();
        let sink_count = Cell::new(0);
        let outcome = resolve_with_lease_reader(
            &reader,
            request(MAX_CONTINUITY_PACKET_BYTES),
            resident_address(),
            RetrievalText::from("corpus-only-fact"),
            supplement(empty_layer().unwrap(), owner_brain),
            None,
            Instant::now() + Duration::from_secs(1),
            1,
            |_| sink_count.set(sink_count.get() + 1),
        );
        assert_eq!(
            sink_count.get(),
            0,
            "unexpected provider wire for {status:?}"
        );
        assert_eq!(
            outcome.receipt().disposition,
            DesktopContinuityContextDispositionV1::Skipped
        );
        assert_eq!(outcome.receipt().layer_statuses[4], status);
    }
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
                assert!(packet.content.contains("memory-note-private-6"));
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
