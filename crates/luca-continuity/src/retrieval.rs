//! Exact-scope, bounded, source-backed in-memory continuity retrieval.

use crate::{
    retrieval_fts::MemoryFts, retrieval_graph::activate_graph, ContinuityError,
    DecryptedRecordBody, NamespaceScope,
};
use luca_protocol::{OpaqueId, SafeU53, Sha256Ref};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

/// Maximum UTF-8 cue size accepted by retrieval.
pub const MAX_RETRIEVAL_CUE_BYTES: usize = 4 * 1024;
/// Maximum lexical seeds admitted from FTS5.
pub const MAX_LEXICAL_SEEDS: usize = 30;
/// Maximum graph traversal depth after lexical seeding.
pub const MAX_GRAPH_DEPTH: usize = 3;
/// Maximum sorted outgoing edges followed from one node.
pub const MAX_OUTGOING_EDGES: usize = 32;
/// Maximum scored candidates retained during activation.
pub const MAX_ACTIVATED_CANDIDATES: usize = 256;
/// Maximum immutable hits returned to packet assembly.
pub const MAX_RETRIEVAL_HITS: usize = 10;
/// Maximum records accepted by one hydration operation, including inactive revisions.
pub const MAX_HYDRATED_RECORDS: usize = 4_096;
/// Maximum aggregate plaintext body bytes accepted before hydration clones records.
pub const MAX_HYDRATED_BODY_BYTES: usize = 16 * 1024 * 1024;
/// Maximum aggregate tag bytes accepted before hydration clones records.
pub const MAX_HYDRATED_TAG_BYTES: usize = 1024 * 1024;
/// Maximum aggregate outgoing edges accepted before hydration clones records.
pub const MAX_HYDRATED_EDGES: usize = 16_384;
/// Maximum entries accepted by one process-memory-only vector index.
pub const MAX_VECTOR_ENTRIES: usize = 4_096;
/// Maximum aggregate fixed-point components accepted by one vector index.
pub const MAX_VECTOR_COMPONENTS: usize = 1_048_576;

pub(crate) const MAX_RECORD_BODY_BYTES: usize = 1_048_576;
pub(crate) const MAX_TAGS: usize = 256;
pub(crate) const MAX_AGGREGATE_TAG_BYTES: usize = 64 * 1024;
pub(crate) const MAX_PROVENANCE_REFS: usize = 256;
pub(crate) const MAX_INPUT_EDGES: usize = 256;
pub(crate) const MAX_CONFIDENCE_BASIS_POINTS: u16 = 10_000;

/// Process-memory plaintext that always zeroizes and never prints its value.
///
/// This is the only text ownership admitted for retrieval bodies, tags, cues,
/// stored records, and returned hits. Cloning preserves the zeroizing wrapper.
pub struct RetrievalText(Zeroizing<String>);

impl RetrievalText {
    /// Wrap caller-owned UTF-8 so its allocation is erased on drop.
    pub fn new(value: String) -> Self {
        Self(Zeroizing::new(value))
    }

    /// Consume authenticated decrypted bytes without creating a plaintext copy.
    pub fn from_decrypted_body(body: DecryptedRecordBody) -> Result<Self, ContinuityError> {
        body.into_zeroizing_utf8().map(Self)
    }

    /// Borrow plaintext only for immediate in-memory retrieval or assembly.
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }

    pub(crate) fn len(&self) -> usize {
        self.0.len()
    }
}

impl From<String> for RetrievalText {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

impl From<&str> for RetrievalText {
    fn from(value: &str) -> Self {
        Self::new(value.to_owned())
    }
}

impl Clone for RetrievalText {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl PartialEq for RetrievalText {
    fn eq(&self, other: &Self) -> bool {
        self.as_str() == other.as_str()
    }
}

impl Eq for RetrievalText {}

impl PartialOrd for RetrievalText {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for RetrievalText {
    fn cmp(&self, other: &Self) -> Ordering {
        self.as_str().cmp(other.as_str())
    }
}

impl Zeroize for RetrievalText {
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl ZeroizeOnDrop for RetrievalText {}

impl fmt::Debug for RetrievalText {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RetrievalText([REDACTED])")
    }
}

/// Retrieval eligibility of one already-authenticated decrypted record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetrievalRecordState {
    /// Current active revision, eligible for indexing and recall.
    Active,
    /// Owner-retained history, excluded from ordinary recall.
    Archived,
    /// Terminal record, excluded from ordinary recall.
    Forgotten,
}

/// Typed relation used by bounded spreading activation.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum RetrievalRelation {
    /// Strong evidence or source-backed support.
    Supports,
    /// One record expands or explains another.
    Elaborates,
    /// A weaker associative relation.
    Related,
    /// A source-backed tension or correction relation.
    Contradicts,
    /// Unrecognized relation; retained as input but never traversed.
    Unknown(OpaqueId),
}

impl RetrievalRelation {
    pub(crate) fn fixed_weight(&self) -> Option<i64> {
        match self {
            Self::Supports => Some(9_000),
            Self::Elaborates => Some(8_000),
            Self::Related => Some(6_000),
            Self::Contradicts => Some(5_000),
            Self::Unknown(_) => None,
        }
    }
}

/// One typed, bounded, body-free outgoing edge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetrievalEdge {
    /// Exact target record identifier.
    pub target_record_id: OpaqueId,
    /// Typed relation; unknown relations are not activated.
    pub relation: RetrievalRelation,
    /// Caller-supplied relation strength in basis points, `0..=10000`.
    pub weight_basis_points: u16,
}

/// Construction input for one already-authenticated decrypted record.
///
/// It intentionally has no `Debug` implementation so plaintext cannot enter
/// diagnostics accidentally.
pub struct RetrievalRecordInput {
    /// Exact namespace and complete source/project/room/conversation scope.
    pub address: NamespaceScope,
    /// Stable encrypted-record identifier.
    pub record_id: OpaqueId,
    /// Durable record type.
    pub record_type: OpaqueId,
    /// Immutable revision number.
    pub revision: SafeU53,
    /// Authenticated decrypted body, held only in process memory.
    pub body: RetrievalText,
    /// Sorted unique lexical tags.
    pub tags: Vec<RetrievalText>,
    /// Source-backed confidence in basis points, `0..=10000`.
    pub confidence_basis_points: u16,
    /// Sorted unique body-free provenance references.
    pub provenance_refs: Vec<Sha256Ref>,
    /// Typed outgoing connections; traversal sorts and bounds them.
    pub outgoing_edges: Vec<RetrievalEdge>,
    /// Current lifecycle eligibility.
    pub state: RetrievalRecordState,
}

/// Authenticated decrypted record admitted to the in-memory retrieval kernel.
#[derive(Clone, PartialEq, Eq)]
pub struct RetrievalRecord {
    pub(crate) address: NamespaceScope,
    pub(crate) record_id: OpaqueId,
    pub(crate) record_type: OpaqueId,
    pub(crate) revision: SafeU53,
    pub(crate) body: RetrievalText,
    pub(crate) tags: Vec<RetrievalText>,
    pub(crate) confidence_basis_points: u16,
    pub(crate) provenance_refs: Vec<Sha256Ref>,
    pub(crate) outgoing_edges: Vec<RetrievalEdge>,
    pub(crate) state: RetrievalRecordState,
}

impl RetrievalRecord {
    /// Validate and retain one decrypted record without mutating caller input.
    pub fn new(input: RetrievalRecordInput) -> Result<Self, ContinuityError> {
        let has_duplicate_edge = {
            let mut seen = BTreeSet::new();
            input
                .outgoing_edges
                .iter()
                .any(|edge| !seen.insert((edge.target_record_id.clone(), edge.relation.clone())))
        };
        if input.body.len() > MAX_RECORD_BODY_BYTES
            || input.confidence_basis_points > MAX_CONFIDENCE_BASIS_POINTS
            || input.tags.len() > MAX_TAGS
            || input
                .tags
                .iter()
                .try_fold(0_usize, |total, tag| total.checked_add(tag.len()))
                .is_none_or(|total| total > MAX_AGGREGATE_TAG_BYTES)
            || input.provenance_refs.len() > MAX_PROVENANCE_REFS
            || (input.state == RetrievalRecordState::Active && input.provenance_refs.is_empty())
            || input.outgoing_edges.len() > MAX_INPUT_EDGES
            || !sorted_unique(&input.tags)
            || !sorted_unique(&input.provenance_refs)
            || input
                .outgoing_edges
                .iter()
                .any(|edge| edge.weight_basis_points > 10_000)
            || has_duplicate_edge
        {
            return Err(ContinuityError::InvalidRetrievalRecord);
        }
        Ok(Self {
            address: input.address,
            record_id: input.record_id,
            record_type: input.record_type,
            revision: input.revision,
            body: input.body,
            tags: input.tags,
            confidence_basis_points: input.confidence_basis_points,
            provenance_refs: input.provenance_refs,
            outgoing_edges: input.outgoing_edges,
            state: input.state,
        })
    }

    /// Borrow the exact record identifier.
    pub fn record_id(&self) -> &OpaqueId {
        &self.record_id
    }

    /// Borrow the plaintext only for immediate packet assembly.
    pub fn body(&self) -> &str {
        self.body.as_str()
    }

    /// Borrow the zeroizing body owner without copying plaintext.
    pub fn body_text(&self) -> &RetrievalText {
        &self.body
    }

    /// Borrow the exact namespace and scope authority.
    pub fn address(&self) -> &NamespaceScope {
        &self.address
    }

    /// Borrow the durable record type.
    pub fn record_type(&self) -> &OpaqueId {
        &self.record_type
    }

    /// Return the immutable revision number.
    pub fn revision(&self) -> SafeU53 {
        self.revision
    }

    /// Borrow the sorted unique lexical tags.
    pub fn tags(&self) -> &[RetrievalText] {
        &self.tags
    }

    /// Return source-backed confidence in basis points.
    pub fn confidence_basis_points(&self) -> u16 {
        self.confidence_basis_points
    }

    /// Borrow the sorted body-free provenance references.
    pub fn provenance_refs(&self) -> &[Sha256Ref] {
        &self.provenance_refs
    }

    /// Borrow the authenticated outgoing graph edges.
    pub fn outgoing_edges(&self) -> &[RetrievalEdge] {
        &self.outgoing_edges
    }

    /// Return this revision's retrieval eligibility.
    pub fn state(&self) -> RetrievalRecordState {
        self.state
    }
}

impl fmt::Debug for RetrievalRecord {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RetrievalRecord")
            .field("record_id", &self.record_id)
            .field("record_type", &self.record_type)
            .field("revision", &self.revision)
            .field("body", &"[REDACTED]")
            .field("tag_count", &self.tags.len())
            .field("provenance_count", &self.provenance_refs.len())
            .field("edge_count", &self.outgoing_edges.len())
            .field("state", &self.state)
            .finish()
    }
}

/// Optional caller-supplied vector query. Absence keeps vector comparison off.
#[derive(Clone, PartialEq, Eq)]
pub struct RetrievalQuery {
    /// Exact retrieval authority and scope.
    pub address: NamespaceScope,
    /// Untrusted natural-language cue, bounded and sanitized before FTS5.
    pub cue: RetrievalText,
    /// Optional memory-only fixed-point query vector.
    pub query_vector: Option<Vec<i16>>,
}

impl fmt::Debug for RetrievalQuery {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RetrievalQuery")
            .field("cue", &"[REDACTED]")
            .field("has_query_vector", &self.query_vector.is_some())
            .finish()
    }
}

/// One caller-supplied memory-only vector index.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct InMemoryVectorIndex {
    vectors: BTreeMap<String, Vec<i16>>,
}

impl fmt::Debug for InMemoryVectorIndex {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("InMemoryVectorIndex")
            .field("vector_count", &self.vectors.len())
            .field("values", &"[REDACTED]")
            .finish()
    }
}

impl InMemoryVectorIndex {
    /// Build a deterministic record-vector map; duplicate IDs are rejected.
    pub fn new(entries: Vec<(OpaqueId, Vec<i16>)>) -> Result<Self, ContinuityError> {
        let component_count = entries.iter().try_fold(0_usize, |total, (_, vector)| {
            total.checked_add(vector.len())
        });
        if entries.len() > MAX_VECTOR_ENTRIES
            || component_count.is_none_or(|total| total > MAX_VECTOR_COMPONENTS)
        {
            return Err(ContinuityError::InvalidRetrievalVector);
        }
        let mut vectors = BTreeMap::new();
        for (record_id, vector) in entries {
            if vector.is_empty()
                || vector.len() > 4096
                || vectors
                    .insert(record_id.as_str().to_owned(), vector)
                    .is_some()
            {
                return Err(ContinuityError::InvalidRetrievalVector);
            }
        }
        Ok(Self { vectors })
    }

    pub(crate) fn score(&self, record_id: &OpaqueId, query: &[i16]) -> Option<i64> {
        let vector = self.vectors.get(record_id.as_str())?;
        if vector.len() != query.len() {
            return None;
        }
        Some(
            vector
                .iter()
                .zip(query)
                .map(|(left, right)| i64::from(*left) * i64::from(*right))
                .sum::<i64>()
                .clamp(-1_000_000, 1_000_000),
        )
    }
}

/// One body-free node in the selected seed/resonance path.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct RetrievalPathNode {
    /// Source-backed record in traversal order.
    pub record_id: OpaqueId,
    /// Relation used to reach this node; absent for a lexical seed.
    pub via_relation: Option<RetrievalRelation>,
    /// Original provenance references for this node.
    pub provenance_refs: Vec<Sha256Ref>,
}

/// One immutable source-backed retrieval hit.
#[derive(Clone, PartialEq, Eq)]
pub struct RetrievalHit {
    record: RetrievalRecord,
    score: i64,
    path: Vec<RetrievalPathNode>,
}

impl RetrievalHit {
    /// Borrow the exact source record.
    pub fn record(&self) -> &RetrievalRecord {
        &self.record
    }

    /// Return the deterministic fixed-point score.
    pub fn score(&self) -> i64 {
        self.score
    }

    /// Borrow the body-free source/resonance path.
    pub fn path(&self) -> &[RetrievalPathNode] {
        &self.path
    }
}

impl fmt::Debug for RetrievalHit {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RetrievalHit")
            .field("record_id", &self.record.record_id)
            .field("score", &self.score)
            .field("path", &self.path)
            .finish()
    }
}

/// Body-safe deterministic retrieval result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetrievalResult {
    /// Ordered immutable hits, capped at [`MAX_RETRIEVAL_HITS`].
    pub hits: Vec<RetrievalHit>,
    /// Number of lexical seeds admitted before graph activation.
    pub lexical_seed_count: usize,
    /// Total bounded candidates retained after activation.
    pub activated_candidate_count: usize,
    /// Whether caller-supplied memory vectors contributed.
    pub vectors_used: bool,
}

/// Process-local FTS5 and graph retrieval index.
pub struct InMemoryRetrievalIndex {
    records: BTreeMap<String, RetrievalRecord>,
    fts: MemoryFts,
}

impl InMemoryRetrievalIndex {
    /// Recreate a process-memory-only index from authenticated decrypted records.
    pub fn hydrate(records: &[RetrievalRecord]) -> Result<Self, ContinuityError> {
        validate_hydration_bounds(records)?;
        let active: Vec<_> = records
            .iter()
            .filter(|record| record.state == RetrievalRecordState::Active)
            .cloned()
            .collect();
        let mut by_id = BTreeMap::new();
        for record in &active {
            if by_id
                .insert(record.record_id.as_str().to_owned(), record.clone())
                .is_some()
            {
                return Err(ContinuityError::InvalidRetrievalRecord);
            }
        }
        let fts = MemoryFts::hydrate(&active)?;
        Ok(Self {
            records: by_id,
            fts,
        })
    }

    /// Retrieve exact-scope lexical and graph resonance without mutating sources.
    pub fn retrieve(
        &self,
        query: &RetrievalQuery,
        vectors: Option<&InMemoryVectorIndex>,
    ) -> Result<RetrievalResult, ContinuityError> {
        if query.cue.len() > MAX_RETRIEVAL_CUE_BYTES {
            return Err(ContinuityError::RetrievalCueTooLarge);
        }
        if query
            .query_vector
            .as_ref()
            .is_some_and(|vector| vector.is_empty() || vector.len() > 4096)
        {
            return Err(ContinuityError::InvalidRetrievalVector);
        }
        let seeds = self.fts.lexical_seeds(&query.address, query.cue.as_str())?;
        let scoped: BTreeMap<_, _> = self
            .records
            .iter()
            .filter(|(_, record)| record.address == query.address)
            .map(|(id, record)| (id.clone(), record.clone()))
            .collect();
        let activation = activate_graph(&scoped, &seeds);
        let vectors_used = match (vectors, query.query_vector.as_deref()) {
            (Some(index), Some(query_vector)) => activation.scores.keys().any(|record_id| {
                scoped
                    .get(record_id)
                    .and_then(|record| index.score(&record.record_id, query_vector))
                    .is_some()
            }),
            _ => false,
        };
        let mut scored: Vec<_> = activation
            .scores
            .into_iter()
            .filter_map(|(record_id, mut score)| {
                let record = scoped.get(&record_id)?.clone();
                score = score.saturating_add(i64::from(record.confidence_basis_points) * 10);
                if let (Some(index), Some(query_vector)) = (vectors, query.query_vector.as_deref())
                {
                    score = score
                        .saturating_add(index.score(&record.record_id, query_vector).unwrap_or(0));
                }
                let path = activation.paths.get(&record_id)?.clone();
                Some(RetrievalHit {
                    record,
                    score,
                    path,
                })
            })
            .collect();
        scored.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.record.record_id.cmp(&right.record.record_id))
        });
        scored.truncate(MAX_RETRIEVAL_HITS);
        Ok(RetrievalResult {
            hits: scored,
            lexical_seed_count: seeds.len(),
            activated_candidate_count: activation.candidate_count,
            vectors_used,
        })
    }

    /// Return the current in-memory FTS row count for mutation evidence.
    pub fn indexed_row_count(&self) -> Result<usize, ContinuityError> {
        self.fts.row_count()
    }

    /// Verify SQLite reports no main database file, memory journaling, and memory temp storage.
    pub fn storage_is_process_memory_only(&self) -> Result<bool, ContinuityError> {
        self.fts.is_process_memory_only()
    }
}

impl fmt::Debug for InMemoryRetrievalIndex {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("InMemoryRetrievalIndex")
            .field("active_record_count", &self.records.len())
            .field("storage", &"process-memory-only")
            .finish()
    }
}

fn sorted_unique<T: Ord>(values: &[T]) -> bool {
    !values.windows(2).any(|pair| pair[0] >= pair[1])
}

fn validate_hydration_bounds(records: &[RetrievalRecord]) -> Result<(), ContinuityError> {
    if records.len() > MAX_HYDRATED_RECORDS {
        return Err(ContinuityError::InvalidRetrievalRecord);
    }
    let body_bytes = checked_aggregate(records, |record| record.body.len())?;
    let tag_bytes = checked_aggregate(records, |record| {
        record.tags.iter().map(RetrievalText::len).sum()
    })?;
    let edge_count = checked_aggregate(records, |record| record.outgoing_edges.len())?;
    if body_bytes > MAX_HYDRATED_BODY_BYTES
        || tag_bytes > MAX_HYDRATED_TAG_BYTES
        || edge_count > MAX_HYDRATED_EDGES
    {
        return Err(ContinuityError::InvalidRetrievalRecord);
    }
    Ok(())
}

fn checked_aggregate(
    records: &[RetrievalRecord],
    measure: impl Fn(&RetrievalRecord) -> usize,
) -> Result<usize, ContinuityError> {
    records.iter().try_fold(0_usize, |total, record| {
        total
            .checked_add(measure(record))
            .ok_or(ContinuityError::InvalidRetrievalRecord)
    })
}
