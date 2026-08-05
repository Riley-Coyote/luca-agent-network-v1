# Polyphonic application-continuity audit

Status: complete read-only lane audit
Captured: 2026-08-04
Integration target: `luca-agent-network-v1`
Purpose: identify the application-level continuity mechanisms worth adapting
into Luca without treating Polyphonic's hosted Supabase implementation as the
target architecture.

## Executive verdict

Polyphonic contains a real, integrated continuity stack—not merely design
documents. The highest-value reusable architecture is:

1. one fail-soft pre-turn continuity packet;
2. one agent-scoped, first-person hypomnema that is always available before a
   turn;
3. one associative Mnemos substrate with typed connections, spreading
   activation, reconsolidation, decay, and consolidation;
4. one post-turn coordinator that can write primary and observer continuity;
5. one readable private notebook assembled from journals, reflections, dreams,
   beliefs, and activity;
6. one review queue between cognitive inference and durable user memory; and
7. explicit row-level provenance for import, rollback, and account recovery.

Those mechanisms are implemented, but they are not one portable module. They
are distributed across React stores, Supabase Edge Functions, Postgres tables,
RLS policies, storage buckets, `pg_cron`, OpenRouter calls, and environment
flags. Luca should port the contracts and state transitions, not the hosted
orchestration.

The current Polyphonic app does **not** implement a universal brain that all
resident agents can freely read. The dominant scope is `(user_id, agent_id)`.
Cross-agent continuity exists through observer hypomnema and explicit
multi-agent memory lanes. Classic Chat has a user-wide shared namespace plus a
model-family namespace, but those are separate from resident memory. Any Luca
"universal brain" must therefore be a new governed shared layer, not a claim
that Polyphonic already solved.

## Immutable source coordinates

### Repository topology

The directory named `polyphonic-v2` is not one authoritative checkout.

| Checkout | Captured revision and state | Authority for this lane |
|---|---|---|
| `/Users/rileycoyote/Documents/Repositories/polyphonic-v2` | branch `main`, `2fe3c7e282863cfb96a4747503e2358b4057f5f3`; heavily restructured and dirty, with the formerly tracked Python Mnemos tree deleted and replacement nested repositories untracked | Container/history only; **not** current executable authority |
| `/Users/rileycoyote/Documents/Repositories/polyphonic-v2/polyphonic-chat-2` | branch `main`, clean, `7054188d5a4c78de2cbae83da51afafe6ad0eb65`; local ref is 22 commits behind `origin/main` (`1c6b1b3a5bb5d56d90f67410009841a483b1d411`) | **Current local application authority** |
| `/Users/rileycoyote/Documents/Repositories/polyphonic-v2/polyphonic-chat` | branch `main`, `d06d4e7349b419a8d090e39e5fa0364946e292ab`; ahead 30/behind 1320 and locally styled | Historical Wave-5-era application snapshot |
| `/Users/rileycoyote/Documents/Repositories/polyphonic-v2/mnemos` | branch `main`, `1381cea28f7ebb5b826b4c699971f635bd45fb05`; ahead 56 with docs/design dirt | Separate canonical Python/MCP engine candidate; audited by the Mnemos lane, not this application lane |

`polyphonic-chat-2` also records three prunable worktrees under `/private/tmp`
whose gitdirs no longer exist. They are historical metadata, not active source.

The 22 commits visible at the local `origin/main` ref affect only the Mnemos
consolidation bridge, its types/UI, and two migrations. They add a hardened
engram-to-`memory_candidates` review bridge with durable-tag allowlists,
transcript/explicit-content/profile-analysis exclusions, and duplicate
suppression. That code is newer than the clean local application checkout and
must be reviewed as **remote-ref-only implemented work**, not silently assumed
to be present at `7054188`.

Evidence convention: unless a section explicitly says `origin/main`, every
`polyphonic-chat-2/<path>:<lines>` citation refers to immutable local revision
`7054188d5a4c78de2cbae83da51afafe6ad0eb65`. Origin-only findings refer to the
captured local remote-tracking object
`1c6b1b3a5bb5d56d90f67410009841a483b1d411`; no fetch, checkout, or source
mutation was performed. The origin-only diff is limited to
`src/components/memory/MnemosOverview.tsx`, generated Supabase types,
`supabase/functions/_shared/mnemos/{consolidation,engine,types}.ts`,
`supabase/functions/mnemos-consolidate/index.ts`, and migrations
`20260803212655_3640a004-ec55-4e4a-bd01-1df9dd2ece7d.sql` and
`20260804002851_a6cb05f4-acb3-4939-be83-6e3a783c35c1.sql`.

## Authority classification

- **Implemented** means an executable call path is wired into the current local
  app or a current migration, with inspectable tests or active routes.
- **Experimental** means executable code exists but is gated, cloud-dependent,
  incomplete, duplicated by another path, or absent from the main user flow.
- **Planned** means documentation or a mock exists without the corresponding
  production path.
- **Historical** means useful prior code exists in `polyphonic-chat`, the dirty
  container root, or an obsolete function with no current caller.

## 1. Pre-turn continuity packet

**Classification: Implemented.**

The central application contract is `ContinuityPacket`. It carries history,
identity, pending revisions, hypomnema, functional memory, Mnemos results,
skills, emotional state, beliefs, a thread continuity note, formatted prompt
blocks, and per-layer diagnostics
(`polyphonic-chat-2/supabase/functions/_shared/continuity/kernel.ts:40-119`).
Its options explicitly control each layer and permit dependency injection for
tests (`kernel.ts:156-187`).

`loadContinuityPacket` normalizes one or more memory agent IDs and loads the
layers independently and fail-soft rather than making memory availability a
chat prerequisite (`kernel.ts:222-363`). It then builds sanitized prompt parts
and a compact continuity bridge (`kernel.ts:374-423`). The bridge intentionally
frames context as a state the agent is entering from rather than a briefing to
recite. Agent mode includes up to two hypomnema entries, three reliable
memories, three Mnemos activations, and explicit degraded-layer warnings;
Classic mode is quieter and omits the first-person hypomnema language
(`kernel.ts:478-518`).

The active multi-runtime chat path passes this packet into both system Luca and
custom-agent prompts. Custom agents receive their own identity documents,
project context, continuity bridge, hypomnema, functional memory, Mnemos
context, and autonomous memory artifacts
(`polyphonic-chat-2/supabase/functions/chat-multi/index.ts:695-721`).

There is an older direct `chat` function that loads the same packet but passes
only identity, hypomnema, and the thread continuity note into the custom-agent
prompt (`polyphonic-chat-2/supabase/functions/chat/index.ts:219-283`). Because
the shared custom prompt supports all layers
(`polyphonic-chat-2/supabase/functions/_shared/agents/custom-agent-prompt.ts:3-15,31-62`),
this is integration drift, not a model limitation. Luca should have exactly one
prompt-assembly path.

### Reuse recommendation

Port the packet and diagnostic model nearly verbatim as a local application
interface, but make loaders local service traits/adapters. Preserve:

- independent layer timeouts and fail-soft diagnostics;
- explicit scope and provenance on every returned item;
- prompt-boundary sanitization;
- compact rather than exhaustive injection; and
- a single shared prompt assembler for DM and group turns.

Do not port Supabase client types into the contract.

## 2. Hypomnema: felt session-to-session continuity

### Read path

**Classification: Implemented.**

The hypomnema is explicitly designed as an always-loaded first-person interior
state rather than a query result. It is capped at roughly 600 tokens and ranked
by recency, confidence, foundational status, and active attention
(`polyphonic-chat-2/supabase/functions/_shared/hypomnema/read.ts:1-52`). The
normal query is strictly scoped by `user_id`, `agent_id`, and `active`, and is
fail-soft (`read.ts:87-126`). Rendering uses relative-time phrasing and sanitizes
the content before it crosses into the prompt (`read.ts:170-197`).

When a restored account has no currently active hypomnema, the loader follows
`account_portability_row_map` for the same target agent and uses those rows as
explicitly labeled imported prior continuity (`read.ts:128-167`). This is a
useful recovery behavior, but Luca should not require an import-generated fake
reflection to recognize continuity.

The current schema stores source thread/message, primary versus observer
density, confidence, revisions, lifecycle, foundational/attention flags,
graduation target, and extensible metadata. RLS is user-scoped and the table is
published to realtime
(`polyphonic-chat-2/supabase/migrations/20260504223339_ea2d2042-9c89-4d19-a228-b8e20b2fd70e.sql:4-70`).

### Write and revision path

**Classification: Implemented, with reliability caveat.**

Writes use a two-stage design: a cheap salience gate followed by a richer
reflection writer. The gate first recognizes deterministic continuity-carry
signals and otherwise uses a low-cost model; incoherent gate output biases to
skip (`polyphonic-chat-2/supabase/functions/_shared/hypomnema/write.ts:360-405`).
The writer loads the agent's own soul/identity/emotional state and recent
hypomnema, then uses primary or observer-specific prompts
(`write.ts:523-589`).

Primary reflections may revise an existing entry. The code preserves the
previous content, confidence, source thread/message, reason, timestamp, and a
revision count before moving current provenance to the latest turn
(`write.ts:621-679`). Otherwise it inserts a new primary or observer entry and
best-effort embeds it (`write.ts:684-714`). Repeated model failure creates a
low-confidence recovery entry rather than silently losing a continuity-worthy
turn (`write.ts:309-353`).

The service-role gate can fan one source turn out to a primary agent and
multiple observer agents and waits for their individual writer outcomes inside
the background finalization task (`polyphonic-chat-2/supabase/functions/hypomnema-gate/index.ts:51-176`).

The reliability caveat is above that service: the common turn coordinator marks
an operation `queued` immediately and only logs asynchronous rejection. It is
not a durable outbox (`polyphonic-chat-2/supabase/functions/_shared/continuity/write.ts:66-101`).
Luca should reuse the operation vocabulary but persist every proposed write and
terminal result so restart and retry semantics are inspectable.

### Decay, challenge, and graduation

**Classification: Implemented but cloud-scheduled.**

Current migrations schedule hypomnema decay every six hours, challenge daily,
and graduation into Mnemos daily after challenge
(`polyphonic-chat-2/supabase/migrations/20260504223339_ea2d2042-9c89-4d19-a228-b8e20b2fd70e.sql:165-177`).
The schema's `graduated_to_engram_id` makes promotion explicit rather than
copying without lineage (`...sql:26,67-70`).

### UI

**Classification: Implemented.**

`HypomnemaList` loads and realtime-subscribes, groups entries per agent, and
explains the concept in user-readable language
(`polyphonic-chat-2/src/components/identity/HypomnemaList.tsx:23-58,82-140`).
`HypomnemaEntry` exposes density, domain, confidence, foundational/graduated
state, revision history, and an explicit forget action
(`polyphonic-chat-2/src/components/identity/HypomnemaEntry.tsx:63-105,118-258`).

One UI defect matters for porting: `hypomnemaStore.load` initially selects all
active entries for a user rather than requiring an active agent, leaving the
component to group them (`polyphonic-chat-2/src/stores/hypomnemaStore.ts:50-65`).
Luca should make agent scope mandatory in the store API.

## 3. Mnemos associative substrate

**Classification: Implemented locally; newer durable-review bridge exists only
on the captured `origin/main` ref.**

### Core contract

The local engine is explicitly scoped by Supabase client, user, and agent and
exposes `encode`, `retrieve`, `decay`, `consolidate`, and belief operations
(`polyphonic-chat-2/supabase/functions/_shared/mnemos/engine.ts:46-124`). The
model includes episodic/semantic/procedural/belief engrams, active lifecycle
states, seven typed connection kinds, confidence-tiered beliefs with revision
history, dual-trace strength/stability/accessibility, emotion, surprise,
access counts, and source context
(`polyphonic-chat-2/supabase/functions/_shared/mnemos/types.ts:13-119`).

### Encoding

Encoding computes surprise and affect, applies a salience gate with a bootstrap
window, and suppresses low-signal chat rather than storing a transcript of every
turn. Manual, extraction, and import sources can force encoding
(`polyphonic-chat-2/supabase/functions/_shared/mnemos/encoding.ts:346-398`). It
then writes a dual-trace engram, best-effort embeds it, and discovers typed
connections (`encoding.ts:400-519`).

The common post-turn path currently encodes each chat exchange as an episodic
engram containing `User:` and `Assistant:` text with `conversation` tags
(`polyphonic-chat-2/supabase/functions/_shared/continuity/write.ts:194-211`).
The salience gate limits volume, but Luca should store signed event references
and a distilled representation rather than make transcript-shaped content its
primary associative unit.

### Retrieval and reconsolidation

Retrieval seeds with trigram or optional vector similarity, computes activation,
spreads over typed connections, ranks results, and reconsolidates what was
actually recalled (`polyphonic-chat-2/supabase/functions/_shared/mnemos/retrieval.ts:75-159`).
The breadth-first spread is bidirectional but remains strictly scoped to
`user_id` and `agent_id` (`retrieval.ts:166-298`). Successful recall increments
access count and strengthens accessibility, stability, and the long-lived
strength trace (`retrieval.ts:300-349`).

The continuity loader can query multiple explicit memory agent IDs, deduplicate
engram IDs, retain the highest activation, and return the top eight
(`polyphonic-chat-2/supabase/functions/_shared/continuity/kernel.ts:1088-1151`).
This mechanism is suitable for a governed shared-brain overlay if the request
contract names scopes and authorization; it must not default to every resident.

### Consolidation

The local consolidation cycle is per-agent. It selects recently accessed
engrams, maintains a wider 14-day belief pool, discovers and strengthens typed
connections, strengthens structurally important engrams, promotes repeatedly
retrieved episodic engrams to semantic, and conditionally synthesizes beliefs
behind key, feature, cohort, and crisis gates
(`polyphonic-chat-2/supabase/functions/_shared/mnemos/consolidation.ts:53-169,182-405,417-460`).

The captured `origin/main` adds the better durable-memory boundary: only stable
or newly promoted, distilled engrams with meaningful durable tags may become
pending `memory_candidates`; it rejects derived psychometric analysis,
unconfirmed sensitive profile inference, raw transcript shapes, explicit
content, and duplicates. This is **implemented on the remote ref, absent from
the local HEAD**. Port this reviewed-candidate boundary rather than allowing
consolidation to write the user's durable shared brain directly.

## 4. Post-turn coordination and multi-agent continuity

**Classification: Implemented, but the coordinator is not restart durable.**

`queueContinuityTurnWrites` is the single post-turn fan-out. It reports pending
revision finalization, Mnemos encoding, Observer watch, dialectic work, skill
distillation, the hypomnema gate, and thread-agent metadata
(`polyphonic-chat-2/supabase/functions/_shared/continuity/write.ts:12-54`). It
encodes the exchange for each explicit memory scope, creates primary and
observer hypomnema targets, and updates participating/primary agent metadata
(`write.ts:120-187,253-289,334-353`). The active `chat` path calls it only after
the final assistant message has been persisted and skips duplicate responses
(`polyphonic-chat-2/supabase/functions/chat/index.ts:418-475`). `chat-multi`
invokes the same coordinator at its actual response completion paths.

Observer continuity is the genuinely valuable cross-agent mechanism. Council
or consultation participants can receive shorter observer-density hypomnema
based on their own contribution, even when another resident was primary. This
creates asymmetric knowledge without pretending every agent saw everything.

### Shared and universal memory reality

**Classification: Partially implemented; universal brain is not implemented.**

- Resident memory is normally isolated by `(user_id, agent_id)`.
- Observer hypomnema gives participating residents their own local trace.
- Classic Chat uses `classic:shared` plus
  `classic:family:<provider>` synthetic scopes
  (`polyphonic-chat-2/supabase/functions/_shared/classic-chat.ts:1-22`). The
  same two lanes are used for both read and post-turn encode
  (`polyphonic-chat-2/supabase/functions/chat-multi/index.ts:451-463` and
  `continuity/write.ts:120-134`).
- `memoryAgentIds` can explicitly merge multiple lanes at retrieval, but there
  is no user-governed global pool, per-memory ACL, consent receipt, or resident
  access policy in the application code.

Luca should model at least three distinct scopes: private resident, shared owner
brain, and explicit room/project. Shared recall should return provenance and an
authorization decision, not merely a list of agent IDs.

## 5. Journal and bounded inner life

### User-facing notebook

**Classification: Implemented.**

The active router exposes Memory, Mind, Journal/Notebook, and Group Session
surfaces (`polyphonic-chat-2/src/App.tsx:48-90,432-470`). The Journal is a
single chronological notebook composed from journals, thoughts, dreams,
insights, reflections, beliefs, and selected activity
(`polyphonic-chat-2/src/pages/JournalView.tsx:1-23,58-121`). It follows the
active agent scope and loads/realtime-subscribes when the selected resident
changes (`JournalView.tsx:82-110`).

The cognitive store loads thought stream, emotional/cognitive state, activity,
dream/insight/reflection engrams, wanderings, journal entries, beliefs, and
memory statistics with explicit `user_id` + `agent_id` filters and fail-soft
`allSettled` behavior
(`polyphonic-chat-2/src/stores/cognitiveStore.ts:194-230,232-350`).

### Journal writer

**Classification: Implemented but hosted/BYOK-dependent.**

`journal-write` verifies the requested agent and conversation scope, loads the
resident's own model, identity documents, durable memories, recent messages,
and previous journal entries, then writes a private first-person entry with
source provenance (`polyphonic-chat-2/supabase/functions/journal-write/index.ts:91-176,178-249,251-292,344-387`).
It requires an OpenRouter key and the hosted role-model resolver. A cron
coordinator schedules journal activity every four hours
(`polyphonic-chat-2/supabase/migrations/20260414100000_autonomous_cron_jobs.sql:63-69`).

### Reflection and consolidation

**Classification: Implemented but broad/experimental for Luca V1.**

`anima-reflect` reads the agent's recent journal, thoughts, emotional state, and
beliefs, writes reflections to `thought_stream`, encodes them as semantic
Mnemos engrams, and logs visible activity
(`polyphonic-chat-2/supabase/functions/anima-reflect/index.ts:113-158,164-261`).

`anima-consolidate` reads the agent's prior 24 hours of journals, high-salience
thoughts, and emotion history. It sends the result to `memory_candidates` for
human review rather than writing durable `memories` directly and mirrors the
work into thoughts/activity/logs
(`polyphonic-chat-2/supabase/functions/anima-consolidate/index.ts:94-141,143-263`).
That review boundary is the part to port first. The full autonomous suite also
schedules thinking, observation, emotional drift, questions, initiation,
connection, and dreaming at multiple cadences
(`polyphonic-chat-2/supabase/migrations/20260508120000_cron_consolidate_anima_dispatch.sql:48-90`).
This is too broad to adopt as a first Luca continuity slice.

### Recommended constrained Luca inner-life loop

For the first working version, port only:

1. post-turn salience gate;
2. primary and observer hypomnema reflection;
3. bounded scheduled journal entry when new evidence exists;
4. periodic Mnemos decay/reconsolidation/consolidation; and
5. candidate generation into a user-review queue.

Defer proactive outreach, autonomous questions, emotional drift, dream
narratives, dialectic identity revisions, and broad cross-agent background
activity until the user can inspect budgets, schedules, inputs, and outputs.

## 6. Account portability and provenance

**Classification: Implemented, broad, and tightly Supabase-specific.**

### Archive contract

The export format is versioned and supports full or chunked encrypted archives.
Payloads include source user/export IDs, table counts, assets, exclusions, and
warnings. Encryption is AES-GCM with a PBKDF2-SHA256 passphrase-derived key
(`polyphonic-chat-2/supabase/functions/_shared/account-portability/archive.ts:43-122,274-355`).
Operational secrets and credentials are explicitly excluded, including API
keys, agent secrets, OpenClaw device/pairing/session/job tables, token gates,
and idempotency records (`archive.ts:130-158`).

The allowlist covers conversations, messages, artifacts, agent configs,
functional memories, Mnemos engrams/connections/beliefs, hypomnema, journals,
thoughts, candidates, identity documents, skills, projects, and supporting
state. Each table declares ID, user, agent, relationship-remap, deferred-remap,
JSON, and safe-import behavior (`archive.ts:160-207`).

### Agent and relationship remapping

The preview builds deterministic agent mappings. Built-in resident IDs are
merged; an unused custom ID is kept; a collision becomes
`restored-<slug>-<export-prefix>`
(`archive.ts:377-401,619-629`; `server.ts:382-430`). References, arrays, agent
IDs, storage paths, and deferred cyclic links are remapped during import, while
`provenance`, `source_context`, and `meta` receive import lineage
(`archive.ts:404-467,635-645`).

Every inserted row gets a durable map from `(job, table, source_id)` to
`target_id` plus source/target agent IDs. The schema enforces uniqueness and
user-readable RLS
(`polyphonic-chat-2/supabase/migrations/20260616000000_account_portability.sql:7-74`).
The importer writes row maps before inserting target batches and restores
deferred links afterward (`polyphonic-chat-2/supabase/functions/_shared/account-portability/server.ts:480-544,1239-1316`).
Rollback deletes only mapped targets, in reverse dependency order, rather than
using a time-window heuristic (`server.ts:717-754`). Failed import jobs attempt
automatic rollback and preserve diagnostic status (`server.ts:642-681`).

If imported hypomnema exists but no row remains active, the importer creates a
foundational continuity bridge and records that generated row in the same
provenance map (`server.ts:1319-1418`). This is useful recovery evidence, but
the generated prose is product-specific and should not be copied into Luca.

### Reuse recommendation

Port the concepts as a local `ContinuityArchiveV1`:

- manifest with schema version and per-section hashes;
- encrypted, chunkable payload;
- explicit secret exclusions;
- stable resident identity mapping separated from runtime binding;
- row/object provenance map;
- preview before apply;
- import job state and deterministic retry/rollback; and
- signed-event references for conversation history instead of copied relay
  authority.

Do not port a 40-table Supabase dump as Luca's public archive format. Export
semantic domain objects, not database rows.

## 7. Active versus legacy/prototype inventory

| Component | Status | Evidence and decision |
|---|---|---|
| Continuity kernel and bridge | **Implemented** | Active chat paths and tests; port contract |
| Hypomnema read/write/revision | **Implemented** | Active post-turn path, schema, UI, tests; port with durable jobs |
| Mnemos encode/retrieve/decay/consolidate | **Implemented** | Active shared engine and scheduled functions; adapt storage/runtime |
| Durable engram-to-memory-candidate bridge | **Implemented on captured `origin/main` only** | 22 commits ahead of local HEAD; review and port hardened gates |
| Journal/Notebook UI | **Implemented** | Active route and scoped store |
| Journal/reflection/consolidation background jobs | **Implemented but hosted/experimental for Luca V1** | Edge functions + cron + BYOK; narrow before port |
| Universal shared brain | **Planned/new work** | No general shared memory/ACL contract in active app |
| Account archive/preview/apply/rollback | **Implemented** | Broad hosted implementation; port semantic contract only |
| `polyphonic-chat/src/lib/mnemos/*` and Wave-5 task chain | **Historical** | Older snapshot far behind current origin |
| Root `polyphonic-v2/mnemos/*` tracked Python tree | **Historical/ambiguous in container** | Deleted in dirty root and replaced by separate nested repo |
| `memory-extract` / `memory-reflect` | **Historical or isolated compatibility path** | Functions remain, but no current app or migration caller was found; active post-turn path uses the continuity coordinator and Mnemos directly |
| `/group` `GroupSession` | **Visual prototype** | Active route imports `useMockGroupSession`; not evidence of real group continuity (`polyphonic-chat-2/src/pages/GroupSession.tsx:5-9`) |
| `docs/memory/migrations/*` | **Historical design copies** | Use applied migrations in `supabase/migrations/*` as behavior authority |

## 8. Contracts to port into Luca

### `ContinuityContextRequest`

Required fields:

- owner ID;
- resident cryptographic public key / resident ID;
- conversation and current signed-event IDs;
- current user turn;
- permitted memory scopes;
- layer flags and per-layer budgets; and
- request/session epoch.

Result: one packet with history references, identity, hypomnema, reliable owner
memory, associative activations, optional state, a compact prompt block, and
per-layer diagnostics/provenance.

### `HypomnemaEntry`

Keep Polyphonic's useful fields: resident, source conversation/event, primary or
observer density, content, domain/tags, confidence, revision chain,
foundational/attention flags, active/superseded state, graduation target, and
creation/update times. Add custody/visibility policy and a local encrypted-at-
rest guarantee.

### `ContinuityWriteJob`

Replace fire-and-forget calls with a durable job keyed by owner, resident,
conversation, source event, session epoch, and operation type. States should be
`proposed`, `running`, `succeeded`, `skipped`, `failed`, and `superseded`, with
idempotency and retry policy.

### `Engram` / `Connection` / `ActivationResult`

Port dual traces, typed connections, source provenance, state, access count,
activation score/path, and agent scope. Retain retrieval-time
reconsolidation. Keep embeddings optional and replace Postgres RPCs with a
local hybrid index.

### `MemoryCandidate`

All background inference that could affect the user's shared durable brain
should land in a review queue carrying source engram/event IDs, resident,
candidate type, rationale, confidence, sensitivity flags, and accept/reject
receipt.

### `ContinuityArchiveV1`

Port encryption, versioning, preview, provenance, identity mapping, retries,
and rollback, while expressing domain objects rather than Supabase rows.

## 9. Hosted assumptions not to copy into local Luca

1. **Supabase Edge Functions as the internal bus.** Replace service-role HTTP
   calls with in-process typed jobs or a local worker boundary.
2. **Postgres/RLS as the only scope enforcement.** Preserve scope in every
   domain query and encrypt local private layers; do not rely on a cloud admin
   key that can bypass policy.
3. **`pg_cron` as the cognitive scheduler.** Use a local persisted scheduler
   aware of sleep, offline time, battery, budget, and catch-up limits.
4. **OpenRouter-only models and a decrypted user key in background jobs.** Route
   through Luca's resident runtime abstraction and explicit owner policy.
5. **Remote object storage for archives.** A local export should be created and
   encrypted on-device; cloud sync can be optional.
6. **Database-row archive format.** It couples recovery to migrations and
   internal table topology.
7. **Fire-and-forget writes.** Luca already treats restart/cancellation as real
   state; continuity must use the same durable discipline.
8. **Realtime UI as evidence of successful cognition.** Only terminal job
   receipts should claim a reflection or consolidation was persisted.
9. **All autonomous loops enabled at fixed global cadences.** Start with a small
   bounded loop and user-visible budgets.
10. **Generated continuity bridge prose on import.** Preserve lineage and
    imported prior state directly; do not synthesize relationship claims merely
    to make the UI feel continuous.

## 10. Important risks and defects found

1. The application checkout is behind its captured origin by 22 memory-specific
   commits. Any port must compare local and origin implementations explicitly.
2. Post-turn operation reports describe work as queued even if it later fails;
   there is no durable retry/outbox for continuity.
3. The old direct-chat custom-agent path omits full functional/Mnemos prompt
   parts even though the current multi path provides them.
4. Raw `User:/Assistant:` exchanges can become episodic engrams; the local
   consolidation code predates the newer transcript-shape filter.
5. The user-facing hypomnema store is user-wide rather than agent-scoped at its
   API boundary.
6. Multiple overlapping memory systems remain: functional `memories`, Mnemos
   engrams, hypomnema, journals/thoughts, and legacy extractor/reflection code.
   Luca needs one authority map before implementation.
7. GroupSession is mock-driven and must not be used as proof of Polyphonic's
   real multi-agent messaging or continuity.
8. The account archive is sophisticated but exports internal database shape and
   is therefore fragile as a cross-product contract.

## 11. Open product/architecture questions

1. Is an agent's hypomnema owner-readable by default, hidden but exportable, or
   exposed only through a notebook/inspector? Polyphonic exposes it directly.
2. Which resident runtimes may write first-person hypomnema: only imported
   agents that opt in, or every resident by default?
3. Should owner-approved universal brain memories be copied into resident
   scopes or resolved dynamically through permissions at recall time?
4. What exact room-participation event makes an observer eligible to retain a
   private trace?
5. What is the first-version model/budget policy for scheduled journal and
   consolidation work?
6. Does rejecting a durable memory candidate also suppress its source engram
   from being proposed again, and for how long?
7. How much of an agent's journal/hypomnema belongs in the portable encrypted
   continuity capsule versus the owner's full local archive?
8. Are emotional state and belief formation in the first continuity milestone,
   or explicitly deferred behind the narrower hypomnema + associative memory
   demo?

## 12. Recommended first Luca continuity slice

The smallest faithful adaptation is:

1. local encrypted per-resident hypomnema;
2. deterministic pre-turn load into a fail-soft continuity packet;
3. signed-event-backed episodic encoding plus scoped associative recall;
4. primary and observer post-turn proposals executed through durable jobs;
5. periodic local consolidation that only creates reviewable candidates;
6. a simple resident notebook showing hypomnema, journal/reflection receipts,
   and accepted durable memory; and
7. one explicit owner-shared brain scope with provenance and per-resident
   authorization.

This delivers the felt continuity Riley asked for without making the complete
Polyphonic autonomous-cognition suite a prerequisite for a reliable Luca app.

## Verification performed

- Captured all four repository revisions and worktree states without modifying
  any Polyphonic source.
- Traced the active direct and multi-runtime read/write call paths.
- Traced hypomnema query, revision, observer, import fallback, and schedule
  behavior.
- Traced Mnemos encoding, hybrid retrieval, spreading activation,
  reconsolidation, decay/consolidation, and the newer origin-only candidate
  bridge.
- Traced Journal/Notebook UI, writer, reflection, consolidation, and scheduled
  orchestration.
- Traced export, encryption, preview, mapping, provenance, apply, rollback, and
  hypomnema restore behavior.
- Searched active source and migrations for callers of legacy
  `memory-extract`/`memory-reflect`; none were found outside the legacy functions
  themselves.
- Identified current test coverage files, but did not run tests because this was
  a read-only source audit rather than behavior verification.
