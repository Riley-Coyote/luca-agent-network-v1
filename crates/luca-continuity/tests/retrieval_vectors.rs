use luca_continuity::{
    ContinuityError, InMemoryRetrievalIndex, InMemoryVectorIndex, NamespaceKey, NamespaceScope,
    RetrievalEdge, RetrievalQuery, RetrievalRecord, RetrievalRecordInput, RetrievalRecordState,
    RetrievalRelation, MAX_ACTIVATED_CANDIDATES, MAX_GRAPH_DEPTH, MAX_HYDRATED_BODY_BYTES,
    MAX_HYDRATED_EDGES, MAX_HYDRATED_RECORDS, MAX_HYDRATED_TAG_BYTES, MAX_LEXICAL_SEEDS,
    MAX_OUTGOING_EDGES, MAX_RETRIEVAL_CUE_BYTES, MAX_RETRIEVAL_HITS, MAX_VECTOR_COMPONENTS,
    MAX_VECTOR_ENTRIES,
};
use luca_protocol::{
    ContinuityNamespaceKindV1, ContinuityNamespaceV1, ContinuityScopeV1, Hex64, OpaqueId, SafeU53,
    Sha256Ref, CONTINUITY_PROTOCOL,
};

fn hex(digit: char) -> Hex64 {
    Hex64::parse(digit.to_string().repeat(64)).unwrap()
}

fn sha(digit: char) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", digit.to_string().repeat(64))).unwrap()
}

fn id(value: impl Into<String>) -> OpaqueId {
    OpaqueId::parse(value.into()).unwrap()
}

fn resident_namespace(owner: char, resident: char, namespace: char) -> NamespaceKey {
    NamespaceKey::new(ContinuityNamespaceV1 {
        protocol: CONTINUITY_PROTOCOL.into(),
        owner_pubkey: hex(owner),
        kind: ContinuityNamespaceKindV1::ResidentPrivate,
        resident_pubkey: Some(hex(resident)),
        namespace_ref: sha(namespace),
        key_version: SafeU53::new(1).unwrap(),
    })
    .unwrap()
}

fn scope(
    namespace: NamespaceKey,
    scope_ref: char,
    source: &str,
    project: &str,
    room: &str,
    conversation: &str,
) -> NamespaceScope {
    NamespaceScope::new(
        namespace.clone(),
        ContinuityScopeV1 {
            protocol: CONTINUITY_PROTOCOL.into(),
            namespace_ref: namespace.as_protocol().namespace_ref.clone(),
            scope_ref: sha(scope_ref),
            source_id: Some(id(source)),
            project_id: Some(id(project)),
            room_id: Some(id(room)),
            conversation_id: Some(id(conversation)),
        },
    )
    .unwrap()
}

fn base_scope() -> NamespaceScope {
    scope(
        resident_namespace('1', '2', 'a'),
        'b',
        "source-a",
        "project-a",
        "room-a",
        "conversation-a",
    )
}

fn edge(target: &str, relation: RetrievalRelation, weight_basis_points: u16) -> RetrievalEdge {
    RetrievalEdge {
        target_record_id: id(target),
        relation,
        weight_basis_points,
    }
}

fn record(
    address: NamespaceScope,
    record_id: impl Into<String>,
    body: impl Into<String>,
    outgoing_edges: Vec<RetrievalEdge>,
) -> RetrievalRecord {
    let record_id = record_id.into();
    RetrievalRecord::new(RetrievalRecordInput {
        address,
        record_id: id(record_id.clone()),
        record_type: id("engram"),
        revision: SafeU53::new(3).unwrap(),
        body: body.into(),
        tags: vec!["continuity".to_owned(), "unresolved".to_owned()],
        confidence_basis_points: 8_000,
        provenance_refs: vec![sha('c')],
        outgoing_edges,
        state: RetrievalRecordState::Active,
    })
    .unwrap()
}

fn query(address: NamespaceScope, cue: impl Into<String>) -> RetrievalQuery {
    RetrievalQuery {
        address,
        cue: cue.into(),
        query_vector: None,
    }
}

fn hit_ids(result: &luca_continuity::RetrievalResult) -> Vec<String> {
    result
        .hits
        .iter()
        .map(|hit| hit.record().record_id().as_str().to_owned())
        .collect()
}

#[test]
fn exact_full_scope_is_required_across_every_authority_field() {
    let base = base_scope();
    let same_reference_other_owner = scope(
        resident_namespace('3', '2', 'a'),
        'b',
        "source-a",
        "project-a",
        "room-a",
        "conversation-a",
    );
    let same_reference_other_resident = scope(
        resident_namespace('1', '4', 'a'),
        'b',
        "source-a",
        "project-a",
        "room-a",
        "conversation-a",
    );
    let variants = vec![
        same_reference_other_owner,
        same_reference_other_resident,
        scope(
            base.namespace().clone(),
            'b',
            "source-b",
            "project-a",
            "room-a",
            "conversation-a",
        ),
        scope(
            base.namespace().clone(),
            'b',
            "source-a",
            "project-b",
            "room-a",
            "conversation-a",
        ),
        scope(
            base.namespace().clone(),
            'b',
            "source-a",
            "project-a",
            "room-b",
            "conversation-a",
        ),
        scope(
            base.namespace().clone(),
            'b',
            "source-a",
            "project-a",
            "room-a",
            "conversation-b",
        ),
    ];
    let mut records = vec![record(
        base.clone(),
        "base-record",
        "orchid authority marker",
        vec![],
    )];
    for (index, address) in variants.iter().cloned().enumerate() {
        records.push(record(
            address,
            format!("variant-{index}"),
            "orchid authority marker",
            vec![],
        ));
    }
    let index = InMemoryRetrievalIndex::hydrate(&records).unwrap();
    assert_eq!(
        hit_ids(&index.retrieve(&query(base, "orchid"), None).unwrap()),
        vec!["base-record"]
    );
    for (position, address) in variants.into_iter().enumerate() {
        assert_eq!(
            hit_ids(&index.retrieve(&query(address, "orchid"), None).unwrap()),
            vec![format!("variant-{position}")]
        );
    }
}

#[test]
fn graph_activation_cannot_cross_scope_or_traverse_unknown_relations() {
    let base = base_scope();
    let other = scope(
        base.namespace().clone(),
        'b',
        "source-a",
        "project-a",
        "room-other",
        "conversation-a",
    );
    let records = vec![
        record(
            base.clone(),
            "seed",
            "lighthouse lexical seed",
            vec![
                edge("same-scope", RetrievalRelation::Supports, 10_000),
                edge("cross-scope", RetrievalRelation::Supports, 10_000),
                edge(
                    "unknown-target",
                    RetrievalRelation::Unknown(id("future")),
                    10_000,
                ),
            ],
        ),
        record(base.clone(), "same-scope", "no lexical cue here", vec![]),
        record(other, "cross-scope", "no lexical cue here", vec![]),
        record(
            base.clone(),
            "unknown-target",
            "no lexical cue here",
            vec![],
        ),
    ];
    let result = InMemoryRetrievalIndex::hydrate(&records)
        .unwrap()
        .retrieve(&query(base, "lighthouse"), None)
        .unwrap();
    let ids = hit_ids(&result);
    assert!(ids.contains(&"seed".to_owned()));
    assert!(ids.contains(&"same-scope".to_owned()));
    assert!(!ids.contains(&"cross-scope".to_owned()));
    assert!(!ids.contains(&"unknown-target".to_owned()));
}

#[test]
fn cycles_repeated_paths_and_fanout_remain_bounded_and_repeatable() {
    let address = base_scope();
    let mut records = Vec::new();
    let first_layer: Vec<_> = (0..MAX_OUTGOING_EDGES)
        .map(|index| format!("layer1-{index:02}"))
        .collect();
    records.push(record(
        address.clone(),
        "seed",
        "constellation lexical seed",
        first_layer
            .iter()
            .map(|target| edge(target, RetrievalRelation::Supports, 10_000))
            .collect(),
    ));
    for (parent_index, parent) in first_layer.iter().enumerate() {
        let children: Vec<_> = (0..9)
            .map(|child_index| format!("leaf-{parent_index:02}-{child_index:02}"))
            .collect();
        records.push(record(
            address.clone(),
            parent,
            "graph node without seed term",
            children
                .iter()
                .map(|target| edge(target, RetrievalRelation::Related, 9_000))
                .chain(std::iter::once(edge(
                    "seed",
                    RetrievalRelation::Related,
                    1_000,
                )))
                .collect(),
        ));
        for child in children {
            records.push(record(
                address.clone(),
                child,
                "graph leaf without seed term",
                vec![edge(parent, RetrievalRelation::Elaborates, 2_000)],
            ));
        }
    }

    let source_snapshot = records.clone();
    let first_index = InMemoryRetrievalIndex::hydrate(&records).unwrap();
    let before_rows = first_index.indexed_row_count().unwrap();
    let first = first_index
        .retrieve(&query(address.clone(), "constellation"), None)
        .unwrap();
    let second = first_index
        .retrieve(&query(address.clone(), "constellation"), None)
        .unwrap();
    let recreated = InMemoryRetrievalIndex::hydrate(&records)
        .unwrap()
        .retrieve(&query(address, "constellation"), None)
        .unwrap();

    assert_eq!(first, second);
    assert_eq!(first, recreated);
    assert_eq!(records, source_snapshot);
    assert_eq!(first_index.indexed_row_count().unwrap(), before_rows);
    assert!(first.hits.len() <= MAX_RETRIEVAL_HITS);
    assert!(first.activated_candidate_count <= MAX_ACTIVATED_CANDIDATES);
    assert!(first
        .hits
        .iter()
        .all(|hit| hit.path().len() <= MAX_GRAPH_DEPTH + 1));
}

#[test]
fn repeated_paths_accumulate_with_a_stable_body_free_path() {
    let address = base_scope();
    let records = vec![
        record(
            address.clone(),
            "seed",
            "harbor lexical seed",
            vec![
                edge("left", RetrievalRelation::Supports, 8_000),
                edge("right", RetrievalRelation::Supports, 8_000),
            ],
        ),
        record(
            address.clone(),
            "left",
            "left path",
            vec![edge("shared", RetrievalRelation::Related, 8_000)],
        ),
        record(
            address.clone(),
            "right",
            "right path",
            vec![edge("shared", RetrievalRelation::Related, 8_000)],
        ),
        record(address.clone(), "shared", "shared target", vec![]),
    ];
    let index = InMemoryRetrievalIndex::hydrate(&records).unwrap();
    let first = index.retrieve(&query(address, "harbor"), None).unwrap();
    let shared = first
        .hits
        .iter()
        .find(|hit| hit.record().record_id().as_str() == "shared")
        .unwrap();
    assert_eq!(shared.path()[0].record_id.as_str(), "seed");
    assert_eq!(shared.path()[1].record_id.as_str(), "left");
    assert_eq!(shared.path()[2].record_id.as_str(), "shared");
    assert!(shared
        .path()
        .iter()
        .all(|node| !node.provenance_refs.is_empty()));
}

#[test]
fn lexical_seeds_and_per_node_fanout_enforce_their_exact_bounds() {
    let address = base_scope();
    let lexical_records: Vec<_> = (0..(MAX_LEXICAL_SEEDS + 5))
        .map(|position| {
            record(
                address.clone(),
                format!("lexical-{position:02}"),
                "bounded lexical marker",
                vec![],
            )
        })
        .collect();
    let lexical_result = InMemoryRetrievalIndex::hydrate(&lexical_records)
        .unwrap()
        .retrieve(&query(address.clone(), "bounded"), None)
        .unwrap();
    assert_eq!(lexical_result.lexical_seed_count, MAX_LEXICAL_SEEDS);

    let targets: Vec<_> = (0..(MAX_OUTGOING_EDGES + 8))
        .map(|position| format!("fan-{position:02}"))
        .collect();
    let mut fanout_records = vec![record(
        address.clone(),
        "fan-seed",
        "fanout lexical marker",
        targets
            .iter()
            .map(|target| edge(target, RetrievalRelation::Supports, 10_000))
            .collect(),
    )];
    fanout_records.extend(
        targets
            .iter()
            .map(|target| record(address.clone(), target, "plain target", vec![])),
    );
    let fanout_result = InMemoryRetrievalIndex::hydrate(&fanout_records)
        .unwrap()
        .retrieve(&query(address, "fanout"), None)
        .unwrap();
    assert_eq!(
        fanout_result.activated_candidate_count,
        MAX_OUTGOING_EDGES + 1
    );
    assert!(fanout_result
        .hits
        .iter()
        .flat_map(|hit| hit.path())
        .all(|node| node.record_id.as_str() != "fan-32"));
}

#[test]
fn malformed_empty_and_oversized_queries_fail_safely_without_body_diagnostics() {
    let address = base_scope();
    let body_marker = "sensitive-body-never-debugged";
    let record = record(address.clone(), "seed", body_marker, vec![]);
    let index = InMemoryRetrievalIndex::hydrate(std::slice::from_ref(&record)).unwrap();
    for cue in ["", ":() *", "\" OR * : NEAR( )", "' UNION SELECT body"] {
        assert!(index.retrieve(&query(address.clone(), cue), None).is_ok());
    }
    let oversized = "x".repeat(MAX_RETRIEVAL_CUE_BYTES + 1);
    assert_eq!(
        index.retrieve(&query(address.clone(), oversized), None),
        Err(ContinuityError::RetrievalCueTooLarge)
    );
    let cue_marker = "sensitive-cue-never-debugged";
    let query = query(address, cue_marker);
    assert!(!format!("{record:?}").contains(body_marker));
    assert!(!format!("{query:?}").contains(cue_marker));
    assert!(!format!("{index:?}").contains(body_marker));
}

#[test]
fn an_empty_index_returns_an_empty_repeatable_result() {
    let address = base_scope();
    let index = InMemoryRetrievalIndex::hydrate(&[]).unwrap();
    let first = index
        .retrieve(&query(address.clone(), "anything"), None)
        .unwrap();
    let second = index.retrieve(&query(address, "anything"), None).unwrap();
    assert_eq!(first, second);
    assert!(first.hits.is_empty());
    assert_eq!(first.lexical_seed_count, 0);
    assert_eq!(first.activated_candidate_count, 0);
    assert_eq!(index.indexed_row_count().unwrap(), 0);
    assert!(index.storage_is_process_memory_only().unwrap());
}

#[test]
fn optional_vectors_are_memory_only_and_off_unless_explicitly_queried() {
    let address = base_scope();
    let records = vec![
        record(address.clone(), "alpha", "vector shared", vec![]),
        record(address.clone(), "beta", "vector shared", vec![]),
    ];
    let index = InMemoryRetrievalIndex::hydrate(&records).unwrap();
    let vectors = InMemoryVectorIndex::new(vec![
        (id("alpha"), vec![1, 0]),
        (id("beta"), vec![1_000, 1_000]),
    ])
    .unwrap();
    let vector_debug = format!("{vectors:?}");
    assert!(!vector_debug.contains("1000"));
    let without_index = index
        .retrieve(&query(address.clone(), "vector"), None)
        .unwrap();
    let disabled = index
        .retrieve(&query(address.clone(), "vector"), Some(&vectors))
        .unwrap();
    assert_eq!(without_index, disabled);
    assert!(!disabled.vectors_used);

    let enabled = index
        .retrieve(
            &RetrievalQuery {
                address: address.clone(),
                cue: "vector".to_owned(),
                query_vector: Some(vec![1_000, 1_000]),
            },
            Some(&vectors),
        )
        .unwrap();
    assert!(enabled.vectors_used);
    assert_eq!(hit_ids(&enabled)[0], "beta");
    assert_eq!(
        index.retrieve(
            &RetrievalQuery {
                address,
                cue: "vector".to_owned(),
                query_vector: Some(Vec::new()),
            },
            Some(&vectors),
        ),
        Err(ContinuityError::InvalidRetrievalVector)
    );
    let no_matching_dimension = index
        .retrieve(
            &RetrievalQuery {
                address: base_scope(),
                cue: "vector".to_owned(),
                query_vector: Some(vec![1, 1, 1]),
            },
            Some(&vectors),
        )
        .unwrap();
    assert!(!no_matching_dimension.vectors_used);
}

#[test]
fn oversized_aggregate_tags_are_rejected_before_fts_hydration() {
    let result = RetrievalRecord::new(RetrievalRecordInput {
        address: base_scope(),
        record_id: id("oversized-tags"),
        record_type: id("engram"),
        revision: SafeU53::new(1).unwrap(),
        body: "safe body".to_owned(),
        tags: vec!["a".repeat(65 * 1024)],
        confidence_basis_points: 1,
        provenance_refs: vec![sha('d')],
        outgoing_edges: vec![],
        state: RetrievalRecordState::Active,
    });
    assert_eq!(result, Err(ContinuityError::InvalidRetrievalRecord));
}

#[test]
fn only_active_records_are_indexed_and_sqlite_has_no_disk_backing() {
    let address = base_scope();
    let active = record(address.clone(), "active", "active marker", vec![]);
    let mut archived = record(address.clone(), "archived", "archived marker", vec![]);
    archived = RetrievalRecord::new(RetrievalRecordInput {
        address,
        record_id: archived.record_id().clone(),
        record_type: archived.record_type().clone(),
        revision: archived.revision(),
        body: archived.body().to_owned(),
        tags: archived.tags().to_vec(),
        confidence_basis_points: archived.confidence_basis_points(),
        provenance_refs: archived.provenance_refs().to_vec(),
        outgoing_edges: archived.outgoing_edges().to_vec(),
        state: RetrievalRecordState::Archived,
    })
    .unwrap();
    let index = InMemoryRetrievalIndex::hydrate(&[active, archived]).unwrap();
    assert_eq!(index.indexed_row_count().unwrap(), 1);
    assert!(index.storage_is_process_memory_only().unwrap());
    assert!(index
        .retrieve(&query(base_scope(), "archived"), None)
        .unwrap()
        .hits
        .is_empty());
}

#[test]
fn exact_scope_lexical_rank_is_invariant_to_other_scope_corpora() {
    let address = base_scope();
    let other = scope(
        address.namespace().clone(),
        'b',
        "source-a",
        "project-a",
        "room-other",
        "conversation-a",
    );
    let local: Vec<_> = (0..(MAX_LEXICAL_SEEDS + 7))
        .map(|position| {
            record(
                address.clone(),
                format!("local-{position:02}"),
                format!("orchid {}", "orchid ".repeat(position % 5)),
                vec![],
            )
        })
        .collect();
    let local_result = InMemoryRetrievalIndex::hydrate(&local)
        .unwrap()
        .retrieve(&query(address.clone(), "orchid"), None)
        .unwrap();

    let mut combined = local;
    combined.extend((0..100).map(|position| {
        record(
            other.clone(),
            format!("foreign-{position:03}"),
            format!("orchid {}", "orchid ".repeat(40)),
            vec![],
        )
    }));
    let combined_result = InMemoryRetrievalIndex::hydrate(&combined)
        .unwrap()
        .retrieve(&query(address, "orchid"), None)
        .unwrap();

    assert_eq!(local_result.lexical_seed_count, MAX_LEXICAL_SEEDS);
    assert_eq!(combined_result, local_result);
}

#[test]
fn active_records_require_source_provenance() {
    let make = |state| {
        RetrievalRecord::new(RetrievalRecordInput {
            address: base_scope(),
            record_id: id("provenance-required"),
            record_type: id("engram"),
            revision: SafeU53::new(1).unwrap(),
            body: "body".to_owned(),
            tags: vec![],
            confidence_basis_points: 1,
            provenance_refs: vec![],
            outgoing_edges: vec![],
            state,
        })
    };
    assert_eq!(
        make(RetrievalRecordState::Active),
        Err(ContinuityError::InvalidRetrievalRecord)
    );
    assert!(make(RetrievalRecordState::Archived).is_ok());
}

#[test]
fn duplicate_target_relation_edges_are_rejected_before_traversal() {
    let result = RetrievalRecord::new(RetrievalRecordInput {
        address: base_scope(),
        record_id: id("duplicate-edge-source"),
        record_type: id("engram"),
        revision: SafeU53::new(1).unwrap(),
        body: "body".to_owned(),
        tags: vec![],
        confidence_basis_points: 1,
        provenance_refs: vec![sha('d')],
        outgoing_edges: vec![
            edge("same-target", RetrievalRelation::Related, 2_000),
            edge("same-target", RetrievalRelation::Related, 9_000),
        ],
        state: RetrievalRecordState::Active,
    });
    assert_eq!(result, Err(ContinuityError::InvalidRetrievalRecord));
}

#[test]
fn aggregate_record_count_is_rejected_before_hydration() {
    let address = base_scope();
    let records: Vec<_> = (0..=MAX_HYDRATED_RECORDS)
        .map(|position| {
            record(
                address.clone(),
                format!("record-cap-{position}"),
                "body",
                vec![],
            )
        })
        .collect();
    assert!(matches!(
        InMemoryRetrievalIndex::hydrate(&records),
        Err(ContinuityError::InvalidRetrievalRecord)
    ));
}

#[test]
fn aggregate_body_tag_and_edge_bounds_are_rejected_before_hydration() {
    let address = base_scope();
    let body_count = (MAX_HYDRATED_BODY_BYTES / (1024 * 1024)) + 1;
    let body_records: Vec<_> = (0..body_count)
        .map(|position| {
            record(
                address.clone(),
                format!("body-cap-{position}"),
                "b".repeat(1024 * 1024),
                vec![],
            )
        })
        .collect();
    assert!(matches!(
        InMemoryRetrievalIndex::hydrate(&body_records),
        Err(ContinuityError::InvalidRetrievalRecord)
    ));

    let per_record_tag_bytes = 64 * 1024;
    let tag_count = (MAX_HYDRATED_TAG_BYTES / per_record_tag_bytes) + 1;
    let tag_records: Vec<_> = (0..tag_count)
        .map(|position| {
            RetrievalRecord::new(RetrievalRecordInput {
                address: address.clone(),
                record_id: id(format!("tag-cap-{position}")),
                record_type: id("engram"),
                revision: SafeU53::new(1).unwrap(),
                body: "body".to_owned(),
                tags: vec!["t".repeat(per_record_tag_bytes)],
                confidence_basis_points: 1,
                provenance_refs: vec![sha('d')],
                outgoing_edges: vec![],
                state: RetrievalRecordState::Active,
            })
            .unwrap()
        })
        .collect();
    assert!(matches!(
        InMemoryRetrievalIndex::hydrate(&tag_records),
        Err(ContinuityError::InvalidRetrievalRecord)
    ));

    let per_record_edges = 256;
    let edge_record_count = (MAX_HYDRATED_EDGES / per_record_edges) + 1;
    let edge_records: Vec<_> = (0..edge_record_count)
        .map(|record_position| {
            record(
                address.clone(),
                format!("edge-cap-{record_position}"),
                "body",
                (0..per_record_edges)
                    .map(|edge_position| {
                        edge(
                            &format!("target-{record_position}-{edge_position}"),
                            RetrievalRelation::Related,
                            1,
                        )
                    })
                    .collect(),
            )
        })
        .collect();
    assert!(matches!(
        InMemoryRetrievalIndex::hydrate(&edge_records),
        Err(ContinuityError::InvalidRetrievalRecord)
    ));
}

#[test]
fn aggregate_vector_entry_and_component_bounds_are_rejected_before_indexing() {
    let too_many_entries: Vec<_> = (0..=MAX_VECTOR_ENTRIES)
        .map(|position| (id(format!("vector-entry-{position}")), vec![1]))
        .collect();
    assert_eq!(
        InMemoryVectorIndex::new(too_many_entries),
        Err(ContinuityError::InvalidRetrievalVector)
    );

    let vector_len = 4_096;
    let vector_count = (MAX_VECTOR_COMPONENTS / vector_len) + 1;
    let too_many_components: Vec<_> = (0..vector_count)
        .map(|position| {
            (
                id(format!("vector-components-{position}")),
                vec![1; vector_len],
            )
        })
        .collect();
    assert_eq!(
        InMemoryVectorIndex::new(too_many_components),
        Err(ContinuityError::InvalidRetrievalVector)
    );
}

#[test]
fn retrieval_creates_no_filesystem_artifacts() {
    use std::collections::BTreeSet;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    let current = std::env::current_dir().unwrap();
    let root_entries = |directory: &std::path::Path| -> BTreeSet<_> {
        fs::read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect()
    };
    let before_root = root_entries(&current);
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let sentinel = std::env::temp_dir().join(format!(
        "luca-retrieval-artifacts-{}-{unique}",
        std::process::id()
    ));
    fs::create_dir(&sentinel).unwrap();
    let before_sentinel = root_entries(&sentinel);

    let address = base_scope();
    let records = vec![record(
        address.clone(),
        "artifact-record",
        "artifact lexical marker",
        vec![],
    )];
    let index = InMemoryRetrievalIndex::hydrate(&records).unwrap();
    let result = index.retrieve(&query(address, "artifact"), None).unwrap();

    assert_eq!(hit_ids(&result), vec!["artifact-record"]);
    assert!(index.storage_is_process_memory_only().unwrap());
    assert_eq!(root_entries(&sentinel), before_sentinel);
    assert_eq!(root_entries(&current), before_root);
    fs::remove_dir(&sentinel).unwrap();
}
