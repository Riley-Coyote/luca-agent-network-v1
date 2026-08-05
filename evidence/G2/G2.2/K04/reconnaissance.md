# K04 in-memory retrieval reconnaissance

Status: read-only map complete; implementation waits for K03D.

## Pure in-memory boundary

K04 belongs entirely in `luca-continuity` and consumes only already decrypted,
typed records admitted through K03/K03D authentication. It receives no keys,
ciphertext store handles, filesystem paths, provider credentials, or grant
policy.

Proposed files:

- `src/retrieval.rs`
- `src/retrieval_fts.rs`
- `src/retrieval_graph.rs`
- exports/errors in the existing pure crate
- `tests/retrieval_vectors.rs`
- a checked synthetic retrieval vector

The FTS database must use `rusqlite::Connection::open_in_memory()` only. No
temp files, shared-cache URI, WAL, file-backed DB, persisted vectors, model
loading, embedding generation, network access, environment/cwd lookup, or
provider credential discovery is permitted.

## Hydration and authority

- trusted desktop authenticates/decrypts first and passes a typed retrieval
  object with exact `NamespaceScope`, record identity/type/revision, body,
  provenance, state, confidence/tags, and typed outgoing edges;
- only active records in the explicitly admitted exact scope are indexed;
- every FTS query and graph target lookup requires full namespace and every
  scope field to match, never merely `scope_ref` or room membership;
- owner-brain grant enforcement remains outside K04 and is represented by the
  caller's admitted record set;
- rebuilding after unlock or restart from the same records must produce the
  same ordered result.

## Frozen bounded retrieval shape

Initial constants:

- cue: 4 KiB maximum;
- lexical seeds: 30 maximum;
- graph depth: 3;
- outgoing edges per node: 32 maximum;
- activated candidates: 256 maximum;
- returned hits: 10 maximum.

Sanitize query terms into quoted FTS5 OR terms. Seed order is lexical rank then
record ID. Convert ranking and typed relation weights to fixed-point integers.
Traverse sorted frontiers, accumulate repeated paths deterministically, and use
record ID as the final tie-breaker. A returned hit is immutable and includes a
body-free seed/resonance path plus source provenance. Retrieval performs zero
persistent or in-memory source mutation.

Optional vector comparison is off by default and may only use an injected
memory-only interface over caller-supplied vectors. The 48 KiB packet ceiling
belongs to T01 packet assembly; K04 must not silently slice recall bodies.

## Required evidence

- exact-scope hit and cross-owner/resident/source/project/room/conversation
  denial vectors;
- no cross-scope activation through graph targets or matching references;
- bounded cycles, repeated paths, unknown relations, excessive fanout,
  malformed FTS input, empty index, and disabled vectors;
- stable ordered IDs, scores, and paths across repeated calls and full index
  recreation;
- before/after snapshots prove no access count, revision, edge, index-row, or
  source-record mutation;
- disk/artifact scans prove no database, WAL/SHM, query marker, fixture body,
  or log leakage;
- source/dependency scans reject filesystem, platform, keychain, Tauri, ACP,
  provider, remote embedding, and model-loading paths.

## Port and omission map

Port the lexical-seed/activation shape and exact-scope FTS concepts from the
audited Mnemos source. Deliberately omit its shared/cross-agent retrieval path,
visibility shortcuts, in-retrieval reconsolidation writes, exception
swallowing, default/config/cwd/environment scope resolution, persistent
embedding SQLite, remote Gemini calls, and local model loading. Fixed-point
scoring and a record-ID tie-break replace float-only unstable ordering.
