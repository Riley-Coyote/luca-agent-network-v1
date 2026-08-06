# Luca V1.1-V1.3 delivery roadmap

## Baseline

The roadmap starts from the accepted functional-beta foundation:

- native Hermes and OpenClaw import and runtime parity;
- DMs and mixed rooms;
- stable resident public keys;
- cancellation, permissions, restart recovery, search, and attachments;
- signed final-event publication and exactly-once outbox authority;
- encrypted resident namespaces and keychain custody;
- revision, correction, forget, backup, and fail-soft storage behavior;
- read-only pre-turn `ContinuityPacketV1` integration;
- private same-resident cognition through `PromptSource::Continuity`;
- one encrypted `ResidentHandoffV1` and portable Capsule projection.

The releases extend this foundation; they do not replace it.

## Release ladder

| Release | User value | New durable data | Retrieval | Cognition |
|---|---|---|---|---|
| V1.1 | Resident remembers selected durable lessons beyond the latest handoff | Resident-private notebook entries and revisions | Local lexical/FTS selection from own notebook | Same-resident post-publication note selection |
| V1.2 | Resident may use explicitly granted owner sources | Owner-brain source documents, chunks, grants, receipts | Local lexical/FTS selection from granted corpus | None required for ingestion or recall |
| V1.3 | Resident can intentionally review what it carries forward | Private reflection plus notebook revision proposals/results | Handoff, active notebook, bounded signed history | Manual same-resident reflection/consolidation |

## V1.1 — Resident Notebook

### Outcome

Upgrade the compact handoff loop into a two-layer continuity system:

```text
handoff = current working state
notebook = selective durable history
```

The handoff remains fast-changing and singular. The notebook is appendable,
revisioned, and selectively recalled.

### Record boundary

Add `ResidentNotebookEntryV1` with:

- stable entry ID and schema version;
- owner key and resident key namespace binding;
- kind: `decision`, `durable_context`, `lesson`, `explicit_preference`,
  `commitment`, or `open_question`;
- first-person body written by the resident;
- exact source event IDs and conversation ID;
- created/updated timestamps;
- confidence and status: `active`, `superseded`, `archived`, or `forgotten`;
- predecessor/supersessor revision links;
- authorship: `resident` or pinned `owner_correction`;
- optional project/room scope only when explicitly selected.

Bounds are frozen before implementation. Initial target: at most three notebook
candidates per metabolism job, bounded body and source counts, and no sensitive
profiling or inferred psychometrics.

### Metabolism behavior

After the same exact durable point already used by the handoff job:

1. wait for the conversation-idle boundary;
2. skip cancelled, failed, owner-authored, ambiguous, duplicated, or unfinalized
   events;
3. run the same resident's exact configured runtime/model in the existing
   private tool-free cognition path;
4. return one atomic result containing `no_change` or a handoff update plus zero
   to three notebook mutations;
5. validate provenance, scope, bounds, authorship, and mutation authority;
6. commit the handoff and notebook changes atomically or commit nothing;
7. record body-free job status and exact idempotency key.

The model may create, revise, or supersede its own active notes. It may not
silently overwrite pinned owner corrections or create owner-brain records.

### Recall behavior

Before a responding resident turn, the read-only context provider selects:

- the effective handoff;
- at most five active resident notebook entries relevant to the current user
  turn and bounded signed history;
- the existing Capsule projection.

Selection uses the encrypted store's in-memory lexical/FTS index with
deterministic ranking. No remote embeddings, persisted plaintext index, graph
expansion, or reconsolidation side effect is needed in V1.1.

Notebook text is rendered as a separately delimited, untrusted reference layer.
The full continuity packet remains within the existing 48 KiB maximum.

### Product surface

- Add a **Notebook** section to the resident continuity inspector.
- Show active notes first, with kind, concise body, source conversation, author,
  and last revision time.
- Provide source jump, correction, pin, archive, forget, and revision-history
  actions.
- Keep handoff and notebook visually distinct.
- Chat shows only compact `Notebook used` or `Notebook updated` evidence.
- Activity shows body-free queued/running/completed/failed status.

### Gate

V1.1 passes only when a real Hermes resident and a real OpenClaw resident each:

- create a selective source-backed note after meaningful work;
- skip or return `no_change` for trivial traffic;
- recall their own note in a fresh runtime session;
- never receive the other resident's note;
- survive correction, pin, archive, forget, restart, locked-store, and corrupt-
  record drills without blocking chat.

## V1.2 — Scoped Brain Sources

### Outcome

Prove owner-governed shared intelligence on the smallest useful source boundary:
one explicitly selected local Markdown/text corpus or folder, granted to
specific residents.

### Source boundary

V1.2 supports:

- `.md`, `.markdown`, and UTF-8 `.txt` files;
- one selected file or one selected folder tree per import transaction;
- deterministic exclusions for hidden files, symlinks escaping the selected
  root, credentials, binary files, oversized files, and unsupported encodings;
- zero-write preview with file counts, sizes, hashes, unsupported rows, and
  destination scope;
- local parsing, normalized chunking, hashing, and deduplication;
- atomic staged commit or complete rollback;
- idempotent reimport and explicit changed-source diff.

Broader formats, automatic discovery, imported chat history, folder watching,
and model-assisted organization remain deferred.

### Authorization boundary

- Owner sources live in a separate encrypted owner-brain namespace.
- Importing a source grants no resident access.
- `BrainGrantV1` binds owner, source, scope, resident, provider/runtime egress,
  creation time, and status.
- A runtime/provider binding change marks affected grants `stale`; retrieval is
  denied until reconfirmed.
- Unknown egress is treated as remote.
- Revocation affects the next context request.
- Room membership never grants source access.

### Recall behavior

The context provider performs local lexical/FTS retrieval only after grant and
egress validation. It returns a small number of bounded chunks with:

- source ID and source-relative display name;
- content hash and chunk locator;
- effective scope and resident grant;
- context-use receipt with statuses and counts but no body.

Source bodies and local absolute paths never enter logs, relay events, activity
rows, evidence, or body-free metadata. Provider requests receive only the
authorized selected chunks, not the whole corpus.

### Product surface

- Add a narrow **Brain Setup** source flow: select, preview, commit, and review.
- Show sources, import status, changed-source diffs, and last indexed time.
- Grant or revoke each resident explicitly.
- Show each resident's effective sources in its inspector.
- Attach source provenance to answers without turning chat into a memory
  dashboard.
- Use deterministic fixtures for frontend work; only real local import and
  provider-request capture count at the gate.

### Gate

V1.2 passes when:

- an owner imports a selected local corpus atomically without changing the
  source files;
- one granted Hermes resident and one granted OpenClaw resident answer a fact
  available only in that corpus with distinct receipts;
- a denied resident cannot surface the fact;
- revocation and stale-egress changes remove the source from the next provider
  request;
- cancellation, duplicate import, changed-source diff, locked store, corrupt
  row, and app restart preserve consistency and never block chat.

## V1.3 — Resident Reflection

### Outcome

Give a resident an intentional way to review and consolidate its own continuity
without introducing autonomous background life.

### Trigger policy

- Primary trigger: explicit owner action, **Review notebook**.
- Optional trigger: one low-frequency threshold prompt only when the owner has
  explicitly enabled it for that resident; it creates a review suggestion, not
  an automatic model call.
- Starting a user turn cancels or preempts pending reflection work.
- No timer, quiet-hours scheduler, catch-up cycle, or proactive DM is added.

### Reflection behavior

The private tool-free cognition request includes:

- the effective handoff;
- a bounded set of active notebook notes;
- bounded signed source conversation history;
- owner-pinned corrections and explicit mutation prohibitions.

The exact resident runtime/model returns:

- `no_change`;
- one private `ResidentReflectionV1`; and/or
- a bounded list of notebook create/revise/supersede/archive proposals.

The trusted desktop validates and applies accepted resident-private mutations in
one transaction. Reflection cannot alter identity, relationship status,
convictions, personality, owner-brain sources, grants, runtime bindings, tools,
permissions, routing, or messages. It cannot reverse owner-pinned corrections.

### Product surface

- Add **Review notebook** and body-free progress state to the resident inspector.
- Keep reflection behind an explicit disclosure control; it does not appear in
  ordinary chat.
- Show what changed, why, source evidence, and before/after revisions.
- Allow rollback, archive, forget, and owner correction.
- Label resident-authored reflection separately from deterministic system
  maintenance.

### Gate

V1.3 passes when a real Hermes and real OpenClaw resident can each review their
own notebook, produce either `no_change` or a source-backed reflection and
bounded revision, and preserve authorship/isolation across restart. Cancellation,
runtime unavailability, invalid output, stale epoch, locked store, and owner-
pinned conflicts must fail soft and leave chat and prior continuity unchanged.

## Deferred after V1.3

The next decision is made only after usage of the three releases is observed.
Candidate future slices, in recommended order, are:

1. local embeddings and bounded associative graph expansion;
2. broader source discovery and import formats;
3. project/room-specific shared scopes;
4. scheduled reflection with transparent budgets;
5. conservative proactive outreach;
6. richer Polyphonic inner-life behaviors.

None of these are pre-authorized by this roadmap.
