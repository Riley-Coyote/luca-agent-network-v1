# Architecture contracts

Status: proposed freeze for implementation task C01

These contracts narrow the accepted G2 protocol and encrypted kernel to the
three product releases in this package. Changes after C01 require a decision-
ledger entry, migration analysis, updated vectors, and security review.

## Authority map

| Concern | Canonical authority |
|---|---|
| Conversation chronology and authorship | Signed Luca relay events |
| Resident identity | Resident public key and desktop key custody |
| Native profile, workspace, tools, credentials, and native memory | Imported native runtime |
| Current Luca working state | Effective `ResidentHandoffV1` revision |
| Selective resident notebook | Encrypted resident-bound notebook records |
| Shared owner sources | Separate encrypted owner-brain records and explicit grants |
| Portable current state | Existing encrypted Capsule projection |
| Resident-authored cognition | Exact configured resident runtime/model |
| Mutation and signing authority | Trusted Luca desktop process |

No authority implies another. A room membership is not a memory grant. A model
response is not durable until validated and committed. A notebook is not native
memory. A Capsule is not the full notebook. A system maintenance task cannot
claim resident authorship.

## Namespace and storage rules

- Resident records use the existing owner-key plus resident-key namespace and
  derived encryption key.
- Owner sources use the separate owner-brain namespace and derived key.
- Sensitive bodies use the accepted XChaCha20-Poly1305 record envelope, unique
  nonces, canonical AAD, revision lifecycle, keychain master key, and fail-soft
  store behavior.
- Public metadata is body-free. Notebook kind, title-like summaries, source file
  names, reflection text, tags, and corpus paths are sensitive bodies.
- SQLite, WAL, SHM, backups, diagnostics, logs, evidence, crash reports, relay
  events, and child environments must not contain plaintext bodies or keys.
- Decrypted indexing remains process-memory-only. Lock, logout, community reset,
  and application exit clear relevant plaintext and indexes.
- Single-installation/single-writer authority remains the product claim.

## V1.1 protocol contracts

### `ResidentNotebookEntryV1`

```text
protocol
entry_id
owner_pubkey
resident_pubkey
scope
kind
body
source_event_ids[]
source_conversation_id
confidence
status
authorship
revision
predecessor_record_id?
supersedes_entry_id?
created_at
updated_at
```

Fixed enums:

- `kind`: `decision`, `durable_context`, `lesson`, `explicit_preference`,
  `commitment`, `open_question`
- `status`: `active`, `superseded`, `archived`, `forgotten`
- `authorship`: `resident`, `owner_correction`

Rules:

- An entry belongs to exactly one resident namespace.
- Every resident-authored entry cites at least one exact signed source event.
- Owner corrections are pinned and may cite the corrected entry instead of
  fabricating an agent source event.
- A revision never destroys the preceding ciphertext/revision record.
- `forgotten` removes the entry from effective retrieval and UI body access;
  only minimum encrypted lifecycle metadata remains.
- Room/project scope is explicit. Missing scope defaults to resident-global, not
  to current room membership.
- Contract bounds are constants in `luca-protocol`, covered by golden vectors.

### `ResidentMetabolismRequestV1`

Extends the current private cognition request with:

- exact job, owner, resident, binding, runtime/model, conversation, session
  epoch, and source-final identifiers;
- bounded signed source turns;
- effective prior handoff;
- bounded active notebook context;
- explicit allowed output and mutation limits.

### `ResidentMetabolismResultV1`

```text
protocol
job_id
source_final_event_id
binding_fingerprint
result:
  no_change
  or changes:
    handoff?
    notebook_mutations[0..3]
```

The result is one atomic proposal. The desktop validates all changes before one
transaction; one invalid mutation rejects the entire proposal. Handoff-only,
notebook-only, and combined updates are allowed. Runtime/model substitution,
tools, permissions, publication, signing, and network routing are prohibited.

### Retrieval

- Select active entries only.
- Enforce exact resident namespace before ranking.
- Use local in-memory lexical/FTS seeds and deterministic tie-breaking.
- Return at most five entries and remain within the existing packet maximum.
- Record IDs, hashes, statuses, timings, and counts may enter body-free receipts;
  entry bodies may not.
- Read paths perform no persistent mutation, access-count update,
  reconsolidation, embedding, or connection write.

## V1.2 protocol contracts

### `OwnerBrainSourceV1`

```text
protocol
source_id
owner_pubkey
source_kind
display_name
root_hash
import_transaction_id
created_at
updated_at
status
```

`display_name` is encrypted with the source body. `source_kind` is initially
`markdown_file`, `text_file`, or `text_folder`.

### `OwnerBrainSourceBindingV1`

Luca keeps a local encrypted binding from `source_id` to the selected file or
folder root so the owner can explicitly re-preview or reimport it. The binding
stores the canonical local path and last observed snapshot hash inside the
encrypted owner namespace. It is never portable by default, sent to a provider,
published, logged, or exposed in a body-free receipt. A missing or moved source
becomes visibly unavailable; Luca does not search the filesystem for a silent
replacement.

### `OwnerBrainChunkV1`

```text
protocol
chunk_id
source_id
ordinal
body
content_hash
source_locator
created_at
```

The locator is source-relative and encrypted. Absolute local paths are not
persisted in portable records or exposed to providers.

### `OwnerBrainImportPreviewV1`

Preview is zero-write and includes safe counts plus an in-memory encrypted-body
preview for the renderer. It distinguishes accepted, skipped, unsupported,
oversized, binary, credential-like, duplicate, changed, and unsafe-path rows.
The preview token expires and is bound to the selected root snapshot.

### `OwnerBrainImportCommitV1`

Commit revalidates the source snapshot, stages all encrypted rows, and makes the
transaction visible atomically. Cancellation, stale preview, parse failure,
encryption failure, or app crash exposes no partial source.

### `BrainGrantV1`

Reuse the existing G2 name with the following V1.2 requirements:

- exact owner, source, resident, scope, provider/runtime egress fingerprint,
  status, and timestamps;
- status: `active`, `revoked`, or `stale`;
- grants default absent and never derive from room membership;
- changing provider, runtime binding, or unknown egress makes a grant stale;
- a stale or revoked grant returns `denied`/`stale` before source retrieval;
- each resident is authorized independently even in a group turn.

### Retrieval and receipts

- Grant validation precedes decryption and ranking.
- Local lexical/FTS retrieval returns only bounded selected chunks.
- The context layer uses the existing `ready`, `empty`, `denied`, `stale`,
  `locked`, `unavailable`, `timeout`, and `invalid` vocabulary.
- A body-free receipt identifies request, source, resident, grant, selected
  chunk hashes/counts, status, timing, and truncation.
- Remote embeddings and model-assisted ingestion are absent in V1.2.

## V1.3 protocol contracts

### `ResidentReflectionRequestV1`

```text
protocol
job_id
owner_pubkey
resident_pubkey
binding_fingerprint
session_epoch
trigger
effective_handoff?
active_notebook_entries[]
bounded_source_events[]
pinned_owner_corrections[]
mutation_limits
```

`trigger` is `owner_requested` in the initial release. A future
`owner_enabled_suggestion` may expose a UI suggestion but does not itself start
cognition.

### `ResidentReflectionV1`

```text
reflection_id
resident_pubkey
body
source_event_ids[]
source_entry_ids[]
created_at
authorship = resident
```

### `ResidentReflectionResultV1`

```text
result:
  no_change
  or reflection:
    reflection
    notebook_mutations[0..N]
```

The bound `N` is frozen in C01 and remains small. Reflection and mutations are
validated and committed atomically. A reflection has no authority outside its
resident namespace.

Prohibited mutations include:

- resident key or identity;
- native memory/configuration;
- runtime, model, provider, tools, or permissions;
- owner-brain records or grants;
- owner-pinned corrections;
- relationship, conviction, personality, or psychometric state;
- chat messages, routing, event signing, or proactive candidates.

## Job and concurrency rules

- Extend the existing encrypted `ContinuityJobV1` store; do not create a second
  job database.
- Every operation uses an idempotency key bound to owner, resident, operation,
  exact source/revision, and session epoch.
- A new user turn preempts resident metabolism/reflection jobs for that resident.
- V1.1 allows one transient retry. V1.3 manual reflection requires explicit
  retry after a terminal failure.
- Cancellation wins over commit. A cancelled or stale-epoch result is discarded.
- App restart resolves each committed, running, interrupted, or frozen result
  exactly once through existing recovery patterns.
- No resident has more than one model-assisted private cognition job running.
- Private cognition never publishes, signs, calls tools, or asks permissions.

## Frontend command boundary

Tauri commands return typed view models, not raw database rows or key material.
The required surface is:

### V1.1

- list effective notebook entries with pagination/filter status;
- read one entry, provenance, and revision history;
- correct/pin, archive, forget, and restore where policy allows;
- retry one failed metabolism job;
- read body-free resident/conversation activity.

### V1.2

- select and preview a local source;
- commit/cancel/retry an import transaction;
- list/remove/reimport owner sources;
- grant, revoke, and reconfirm resident access;
- list source-backed context-use receipts.

### V1.3

- request/cancel/retry notebook review;
- read body-free job state;
- disclose a reflection and its sources intentionally;
- read before/after notebook changes and rollback eligible revisions.

Command names and renderer view-model fields are frozen by the relevant contract
task before Claude binds production UI. Fixtures use the same serialized view
models.

## Permanent regression boundary

Each release retains and extends the functional-beta regressions:

- continuity disabled/unavailable/locked/corrupt never blocks conversation;
- native runtime credentials/configuration remain unchanged;
- no cross-resident private data;
- no private body/key in logs, evidence, relay, child environment, WAL/SHM, or
  crash report;
- cancelled/failed/duplicate/stale operations produce no late mutation;
- provider capture contains only explicitly authorized selected context;
- current messaging, permission, cancellation, search, attachment, restart, and
  exactly-once final behavior remains correct.
