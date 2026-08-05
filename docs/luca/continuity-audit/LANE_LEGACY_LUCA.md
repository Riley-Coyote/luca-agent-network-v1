# Legacy Luca Source Audit

## Verdict

Legacy Luca contains several useful product and integration seams, but it is not
the canonical continuity engine and should not be transplanted wholesale. Its
best reusable assets are the import experience, fail-soft prompt assembly,
memory-scope UX, source ingestion orchestration, and explicit runtime-health
distinctions. Its JavaScript memory daemon and retriever are compatibility
implementations whose authority, egress, provenance, and mutation behavior are
not strong enough for the new application without redesign.

## Source coordinates

- Repository: `Riley-Coyote/luca-terminal-v2` (private)
- Audited commit: `561909550a62705e28c7eeb33c309023bd16d1eb`
- Default branch: `main`
- Audit method: clean, shallow, read-only clone in a temporary directory
- Product stack: Electron 34, Express 5, Node, vanilla web UI,
  `better-sqlite3`, Playwright

The nearby `luca-terminal` folder contains design artifacts, and
`luca-terminal-v3` contains planning/session documents. Neither is the complete
legacy application source. The private GitHub repository above is the source of
truth for this lane.

## What actually exists

### 1. Fail-soft turn-context assembly

`server/luca.js:1096-1185` loads, in parallel:

- the Luca system prompt and documentation;
- current app/UI context;
- scoped persistent recall;
- the imported user model;
- agent-owned `SOUL.md`, `IDENTITY.md`, `USER.md`, and optionally `MEMORY.md`.

Recall failure is caught and does not block the answer. The active-agent block
also says the selected agent must not impersonate another agent. This is a good
interaction and resilience pattern, but the present implementation is hardcoded
around the `luca` agent and untyped prompt strings.

### 2. Thread-level memory scope

`server/memory-knowledge.js:768-834` normalizes four useful modes:

- no memory;
- primary memory;
- a selected knowledge garden;
- primary plus selected garden.

The no-memory mode renders an explicit instruction not to imply that persistent
recall was searched. This is a strong UX principle to preserve. The search path,
however, performs read-only FTS/LIKE directly against garden databases and does
not implement the new owner's complete visibility and provider-egress policy.

### 3. Dual-backend Luca memory wrapper

`server/luca-memory.js:1-369` provides a small facade with:

- canonical Mnemos bridge when reachable;
- JSON-file fallback when unavailable;
- one-time fallback-to-Mnemos migration;
- runtime status that distinguishes canonical, degraded, and disabled modes.

The status distinction is worth keeping. The persistence contract is not:

- identity is hardcoded to `agent_id='luca'`;
- fallback search is substring matching;
- file memories do not carry complete provenance or V1 policy;
- `forgetAll()` cannot clear Mnemos-backed memories (`server/luca-memory.js:346-355`);
- migration is item-by-item, not a transactionally staged import.

### 4. Universal-brain orchestration surface

`server/brain-orchestrator.js:33-308` exposes health, ingest, search, inbox,
embedding, and Claude Code session-import operations. The server treats the
Memory Engine as the owner of storage, provenance, extraction, graph, and
distillation. It supports bounded directory ingestion and reports per-file
failures (`server/brain-orchestrator.js:347-423`). Search emits safe operational
events and distinguishes vectors from FTS (`server/brain-orchestrator.js:441-475`).

This separation is directionally correct. The old service boundary uses a
loopback HTTP daemon and general string/JSON calls, while the reviewed new V1
contract uses an exclusive, framed desktop-to-sidecar pipe with typed operations
and epoch binding. Adopt the product operations and observability, not the old
transport or authority model.

### 5. Real import pipeline

`server/import-pipeline.js:371-534` parses ChatGPT, Claude, Luca Terminal, and
Luca Terminal ZIP exports; writes imported conversations; optionally extracts
engram candidates; and synthesizes a user-model document. The pipeline exposes
stage and section progress without blocking the UI. Claude Code local-path
session import also exists in `server/brain-orchestrator.js:609-735`.

The import experience and parser inventory are valuable. Material limitations:

- cancellation aborts model calls but deliberately does not roll back already
  written threads (`server/import-export.js:907-925`);
- imported thread provenance is recorded, but extracted memories receive only
  coarse `imported`/format tags and do not retain the specific source thread
  (`server/import-pipeline.js:452-469`);
- the extraction/user-model provider key is read directly from
  `luca-config.json` (`server/import-pipeline.js:538-547`), not through the new
  desktop credential boundary;
- imported content is fed to an extraction model, so an explicit egress choice
  and import-prompt-injection boundary are required;
- no staged commit makes the import atomic.

### 6. JavaScript Mnemos compatibility retriever

`lib/mnemos/retriever.mjs:151-268` implements FTS seeds, three-hop spreading
activation, relation weights, emotional bias, and result filtering. It proves
that the older product had a concrete associative-retrieval implementation, not
only a design idea.

It is unsuitable as a turn-time drop-in for the new privacy boundary:

- reconsolidation defaults on;
- filtering occurs after graph propagation;
- every returned memory is strengthened and versioned;
- co-retrieved memories acquire or strengthen `supports` relationships;
- the mutated engrams are saved during ordinary recall
  (`lib/mnemos/retriever.mjs:62-113,151-268`).

Turn preparation must filter for owner, resident, visibility, and provider
egress before ranking or mutation. The audited new continuity service contract
already forbids turn-time reconsolidation and specifies an immutable snapshot.

### 7. Optional inner-life surfaces

Legacy Luca can inspect `inner_life` files, substrate status, modulators, event
logs, and Polyphonic-related feature flags. These are primarily discovery,
status, and UI integrations; they are not a single supervised, portable inner-
life engine embedded in the app. Their presence proves integration intent, not
that legacy Luca itself owns the canonical implementation.

## Adopt / adapt / reject

### Adopt as product behavior

- fail-soft memory/context preparation;
- explicit `none` memory mode with honest UI language;
- primary versus selected-corpus scope controls;
- discovery-first import with progress and per-source reporting;
- runtime status that distinguishes canonical, degraded, disabled, and missing;
- local-path ingestion rather than needless uploads;
- source and recall activity receipts visible to the owner.

### Adapt behind new contracts

- ChatGPT, Claude, Luca, and Claude Code parsers;
- imported-thread reconstruction;
- corpus/folder ingestion;
- user-model synthesis as an owner-reviewed proposal;
- scoped recall rendering;
- spreading activation with authorization-first filtering and no implicit
  mutation;
- optional inner-life data import as migration input, never live authority.

### Reject as new architecture

- the Electron/Express shell and old conversation transport;
- hardcoded `luca` ownership for all memories;
- raw loopback Memory Engine service as the privileged production boundary;
- API credentials stored/read as ordinary config JSON;
- implicit remote extraction of imported personal history;
- partial import that reports cancellation while leaving untracked writes;
- turn-time recall that silently rewrites memory and graph state;
- direct database reading without a versioned policy snapshot;
- any claim that feature flags or readable `inner_life` files prove an active
  cognition engine.

## Continuity V1 implications

1. Conversation chronology remains the signed Buzz/Luca event log.
2. A resident-specific Continuity Capsule supplies bounded self, relationship,
   current digest, and unresolved-thread context before each new runtime session.
3. Universal-brain recall remains separate and must be owner/resident/egress
   authorized before retrieval.
4. Post-turn writes are proposals with source event IDs and explicit commit
   state, not ambient mutations during read.
5. Historical Luca imports should retain source-thread IDs all the way from
   imported conversation to memory proposal and user review.
6. Polyphonic inner-life material should be migratable into a resident's private
   hypomnema/journal, not presumed safe or current simply because a file exists.

## Confidence and gaps

Confidence is high for source inventory and implementation behavior because this
lane audited the actual repository at an immutable commit. No dependencies were
installed and no test suite was executed: this was a read-only architecture
audit. Before reusing parsers or retrieval code, copy them into isolated tests
with adversarial imports, provenance assertions, cancellation/rollback cases,
and zero-write recall proofs.
