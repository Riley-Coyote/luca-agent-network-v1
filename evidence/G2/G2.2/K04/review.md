# K04 independent retrieval review

Final verdict: PASS. No remaining P0/P1/P2 findings.

Initial findings:

1. A shared FTS5 corpus allowed out-of-scope documents to influence BM25
   statistics and used floating-point ranking.
2. Aggregate hydrated records/plaintext and vector components were not bounded
   before cloning and indexing.
3. Active records could enter retrieval without source provenance.
4. Duplicate target/relation edges could amplify graph activation.

Bounded repair and re-review:

- each exact canonical `NamespaceScope` now has an isolated process-memory
  FTS5 table;
- lexical scoring uses deterministic saturating integer token counts with a
  record-ID tie-break, with no BM25 or floating point;
- aggregate record, body, tag, edge, vector-entry, and vector-component limits
  are enforced before index construction;
- active records require nonempty body-free provenance;
- duplicate `(target_record_id, relation)` edges are rejected before traversal;
- the cross-scope reproducer uses 37 in-scope matches plus 100 unrelated
  high-frequency records and preserves the complete result;
- all original scope, graph, lifecycle, malformed-query, zero-mutation,
  deterministic recreation, optional-vector, and privacy tests remain green.
