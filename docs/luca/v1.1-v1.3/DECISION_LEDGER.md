# Decision ledger

## Fixed planning decisions

### D001 — Three incremental releases replace one broad G2 push

Decision: deliver resident notebook, narrow owner sources, and manual resident
reflection as V1.1, V1.2, and V1.3. Keep the original G2 documents as a
long-range roadmap.

Reason: each release produces standalone user value, preserves a usable agent
workspace, and can be proven in the installed app without committing to the
entire Mnemos/Polyphonic system.

### D002 — Planning branch is not a product branch

Decision: implementation begins only after accepted frontend work is integrated
with the functional-beta checkpoint and the exact new base is recorded.

Reason: Riley and Claude are working on the frontend in parallel. Building from
the planning branch would create avoidable merge divergence.

### D003 — Handoff and notebook are separate layers

Decision: keep one fast-changing `ResidentHandoffV1` and add a selective,
revisioned resident notebook.

Reason: the handoff answers “where were we?” while the notebook answers “what
was important enough to carry forward?” Combining them would make one record
either too volatile or too bloated.

### D004 — One atomic metabolism result

Decision: the existing same-resident cognition job returns `no_change` or one
atomic proposal containing an optional handoff and bounded notebook mutations.

Reason: this avoids duplicate model calls and inconsistent half-commits while
preserving exact resident authorship.

### D005 — Lexical retrieval first

Decision: V1.1 and V1.2 use the accepted in-memory lexical/FTS path with
deterministic ranking. Embeddings and graph activation are deferred.

Reason: a small notebook and narrow corpus do not need a second retrieval
architecture. This is cheaper, local, inspectable, and sufficient to test the
product value.

### D006 — Narrow owner brain

Decision: V1.2 supports explicitly selected local Markdown/text sources only.
Importing creates no implicit resident grant.

Reason: the authorization, encryption, provenance, and revocation loop is the
important product proof. Broad format/discovery work can be added after that
loop is trusted.

### D007 — Reflection is manual, resident-authored, and private

Decision: V1.3 starts with explicit **Review notebook**. It uses the exact
resident runtime/model, no tools, and no message publication.

Reason: this captures the most valuable Polyphonic behavior without introducing
a scheduler, proactive outreach, autonomy theater, or new authority.

### D008 — Codex/backend and Claude/frontend use frozen view models

Decision: Codex freezes protocol, commands, serialized view models, and fixtures
before Claude implements each product surface. Shared files have one writer.

Reason: this allows parallel work without duplicate stores, invented behavior,
or broad conflict resolution.

### D009 — Installed proof per release

Decision: each release ends in the rebuilt signed macOS app with real Hermes and
OpenClaw residents. Browser fixtures are necessary design evidence but not
release evidence.

Reason: runtime, keychain, Tauri, process, and restart behavior cannot be proven
by browser or source tests alone.

### D010 — No pre-authorization of richer inner life

Decision: scheduled thought, proactive messages, associative graph expansion,
personality/conviction evolution, and background cross-agent behavior are not
part of V1.1-V1.3.

Reason: usage of the notebook, shared-source, and reflection loops should inform
which richer behavior is genuinely valuable.

### D011 — V1.1 includes a living text journal

Decision: V1.1 contains two encrypted resident-owned item types: automatic
source-backed memory notes and manually requested resident-authored Markdown
journal pages.

Reason: this makes the notebook an authored personal space without delaying the
functional product for multimedia tools or autonomous scheduling.

### D012 — Journal authorship is preserved

Decision: the owner may annotate, archive, forget, or request a resident
revision, but cannot directly rewrite a resident-authored page body.

Reason: owner custody and control should not erase honest authorship. Memory
notes remain owner-correctable because they affect automatic recall.

### D013 — Journal pages are not automatic memory

Decision: journal pages are excluded from ordinary pre-turn retrieval. They may
enter cognition only when explicitly selected for another journal request or a
later V1.3 review.

Reason: expressive writing must not silently become behavioral context.

### D014 — Backend proceeds before frontend integration

Decision: V1.1 starts from functional-beta commit `36472636` on
`agent/v1.1-resident-notebook`. Codex freezes renderer view models and fixtures;
Claude's accepted frontend is integrated after the backend gate.

Reason: frontend design is still in progress and should neither block nor be
overwritten by continuity implementation.

### D015 — Journal scheduler metadata is body-free

Decision: the durable journal-job database stores only identity, binding,
conversation, target-lineage, state, attempt, error-code, and timestamp fields.
The owner prompt and selected page bodies remain in process memory.

Reason: persisting a manually requested private page prompt in a second SQLite
store would violate the encrypted notebook boundary. After restart an unfinished
job fails honestly and must be resubmitted.

### D016 — Cancellation and commit use one durable claim

Decision: a journal job atomically sets `commit_claimed` before writing a page.
Owner cancellation can win only before that claim; after it wins, no late page
can commit.

Reason: a UI-only cancellation flag leaves a race between the resident result
and encrypted revision commit. The body-free claim makes the winner observable
without storing page text.

### D017 — Journal and annotations never hydrate the recall index

Decision: `journal` and `journal-annotation` record types are excluded both
while hydrating in-memory retrieval material and while assembling an ordinary
turn packet.

Reason: defense in depth keeps expressive pages out of normal conversation even
if ranking or record ordering changes later.

### D018 — Stable lineage identifiers are accepted at the UI boundary

Decision: item detail and mutation commands accept either the current encrypted
record ID or its stable lineage root, then resolve to the same resident-isolated
lineage before acting.

Reason: the frontend can retain one durable link while revisions change record
IDs, without weakening namespace isolation.

### D019 — One private cognition transport carries typed work

Decision: the inherited local cognition channel now carries a versioned union
of metabolism and journal requests/results. It remains bound to the exact
resident and runtime fingerprint.

Reason: using the existing tool-free channel preserves preemption, runtime
authorship, and credential isolation without adding a parallel agent runtime.

### D020 — Pinned owner handoffs do not suppress independent memory notes

Decision: when metabolism proposes both a handoff update and memory notes while
the active handoff is an owner-pinned correction, Luca preserves the pinned
handoff and still atomically commits the valid resident-authored notes. A
handoff-only proposal remains stale.

Reason: owner authority over the effective handoff must not accidentally block
the resident's separate, source-backed notebook layer.

### D021 — Private native cognition has a 180-second hard deadline

Decision: automatic notebook metabolism and manually requested journal
cognition each have a 180-second absolute deadline. Their existing bounded
retry, preemption, cancellation, and no-late-commit rules remain unchanged.

Reason: the installed OpenClaw runtime demonstrated a legitimate provider cold
start that exceeded 90 seconds. The longer bound permits the real native path
without making jobs unbounded or weakening fail-soft chat behavior.

### D022 — V1.2 source bounds and renderer contract

Decision: one V1.2 preview contains at most 512 rows, accepts at most 1 MiB per
file and 16 MiB per transaction, produces chunks of at most 4 KiB, and expires
after 15 minutes. One retrieval returns at most eight chunks and 24 KiB of
owner-brain text. Source display names are at most 240 bytes; encrypted relative
locators are at most 1024 bytes; encrypted canonical paths are at most 4096
bytes.

The frozen renderer vocabulary lives in
`desktop/src/shared/api/tauriBrain.ts`; deterministic fixture payloads come from
`get_owner_brain_fixtures`. The fixture path contains no source bodies or
absolute paths and is not evidence of a real import.

Reason: these bounds fit the existing 48 KiB continuity packet, make preview
and retrieval deterministic, and prevent one selected folder from becoming an
unbounded filesystem scan. They can be widened only through a recorded contract
and security review.

### D023 — Owner-brain storage reuses continuity revision authority

Decision: V1.2 introduces no new database schema. Source manifests, encrypted
device bindings, and chunks use the existing owner-brain namespace, continuity
envelopes, key rotation/backup path, and owner-global revision authority. Up to
128 individually validated 4 KiB chunks are packed into one encrypted chunk
page. One import stages at most 38 chunk pages plus its source manifest and
binding, then applies all records through one bounded 40-operation SQLite CAS
transaction. The source manifest is the only authority that names the active
chunk pages; superseded or surplus page lineages are not recalled.

Reason: a 16 MiB import stays below the existing 1 MiB encrypted-record and
64 MiB revision-snapshot bounds without creating thousands of active lineages.
Reusing the accepted encrypted store preserves crash rollback, identity-bound
key custody, rotation, backup, nonce uniqueness, and restart validation while
avoiding a second persistence or migration system.

### D024 — Brain grants bind to trusted effective runtime authority

Decision: one encrypted `owner-brain-grant` lineage is stable per exact source
and resident. Grant, revoke, and reconfirm are owner-only revision operations;
an import never creates a grant. The renderer supplies only source and resident
identifiers. Desktop native code derives the current runtime/model binding from
the same effective spawn configuration used at launch and classifies any
unproven or unknown egress as remote.

The effective state of a persisted active grant is `stale` whenever its stored
binding or egress differs from current trusted authority, including when that
authority is unavailable. This check is deterministic and read-only, so drift
is denied before source retrieval without making a context request mutate
persistent state. Reconfirmation writes a new active grant revision bound to
the new authority; a normal grant action cannot silently reconfirm stale
access.

Reason: source access must not follow room membership, renderer claims, or a
resident's former provider configuration. Persisting the authorized
fingerprint and deriving staleness at the boundary preserves explicit consent,
restart behavior, revision history, and the no-mutation retrieval contract.

### D025 — Brain retrieval is grant-first and process-memory-only

Decision: one owner-brain context attempt enumerates only encrypted source
scope metadata, derives the expected resident/source grant lineage, and
decrypts that grant before any source manifest or chunk page. Absent and
revoked grants return `denied`; binding or egress drift returns `stale`. Only an
exact active grant permits source decryption and the accepted process-memory
lexical/FTS path.

Candidates from all authorized sources share one global limit of eight chunks
and 24 KiB. Duplicate content hashes are admitted once. The managed continuity
adapter maps only selected chunk body, opaque chunk ID, and content hash into
the owner-brain layer; source locators, canonical paths, denied material,
resident-private material, and grant bodies are never added. Resident notebook
disablement affects only resident-private layers and cannot suppress a
separately authorized owner-brain layer.

Each evaluated source emits a validated body-free
`OwnerBrainContextReceiptV1`. The most recent 128 receipts are retained only in
process memory for Brain Setup activity; retrieval never advances the durable
revision authority or writes a receipt record.

Reason: the authorization check must remain observable ahead of source access,
provider capture must have a mechanically narrow input, and activity should be
inspectable without turning ordinary context reads into continuity writes.

### D026 — V1.2.1 precedes resident reflection

Decision: insert **Connect Your Work** as V1.2.1 between completed V1.2 and
V1.3. Repository, Codex, and Claude Code connections ship now; databases are
the immediately following adapter slice. Embeddings, graphs, Mnemos,
model-assisted ingestion, proactive behavior, and source-derived durable memory
remain deferred.

Reason: familiar connected knowledge and practical repository access produce
the next concrete user value without expanding into an invisible memory system.

### D027 — Connected sources stay live-linked and body-free at rest

Decision: originals remain authoritative. Luca stores encrypted device-local
bindings, relative locators, hashes, refresh cursors, safe metadata, and hashed
lexical postings, but no repository or session body. Retrieval rereads only a
selected bounded excerpt and verifies its hash before use.

Reason: the app should feel current without copying whole repositories or
histories into a second knowledge store.

### D028 — Discovery is automatic but connection is explicit

Decision: Luca checks the configured repository directory, common bounded
development folders, and standard Codex/Claude history locations using metadata
only. The owner may add bounded parent folders with the native picker. Luca
never recursively scans the whole home directory, follows escaping symlinks,
connects, or indexes without the owner action and first-use consent.

Reason: discovery should remove setup work without silently ingesting a
person's machine.

### D029 — One consent defaults access to all residents

Decision: the first connection grants relevant-excerpt egress, repository read,
and permission-gated repository work to all current residents and materializes
the same policy for future residents. Runtime or provider drift still fails
closed as `Review needed`; exclusions and revocation remain available in
Details.

Reason: the default product promise is that connected knowledge simply works
for the owner's agents while preserving visible fail-closed boundaries.

### D030 — Refresh is event-driven and single-worker

Decision: connected adapters reconcile at launch and use a debounced filesystem
watcher feeding one incremental worker. There is no busy polling, model call,
token-consuming background process, or hidden autonomous memory write. Watch
failure leaves the connection present and marks it `Needs attention`.

Reason: sources should stay current with predictable local resource use and
honest degraded state.

### D031 — Repository work is a desktop-owned capability

Decision: managed residents receive a session-scoped `luca-repositories` MCP
surface without modifying Hermes/OpenClaw configuration, credentials, memory,
workspace, schedule, or model. Reads are automatic. Patch, executable-plus-args
commands, and local commits require exact Luca permissions; commits require a
separate approval and hooks. V1.2.1 exposes no push, remote mutation, PR, or
credentialed Git operation.

Reason: every resident should have one uniform, auditable repository interface
whose authority stays with the desktop rather than the model process or native
resident configuration.

### D032 — The product destination is named Brain

Decision: rename `Brain Setup` to `Brain`. Its default page is a quiet inventory
for Repositories, Codex, Claude Code, and Files. Existing import preview, grant,
refresh, exclusion, and provenance controls move under Details or Activity.

Reason: setup is an action; Brain is the lasting place users return to manage
connected work.

## Decisions to freeze in C01

These are implementation parameters, not unresolved product direction:

- maximum notebook body length and source-event count;
- maximum notebook mutations per metabolism job (initial target: three);
- maximum recalled notebook entries (initial target: five);
- notebook ranking weights and deterministic tie-break;
- reflection mutation bound;
- exact renderer view-model and command names;
- source file/folder size and count limits;
- credential-like and unsafe-path exclusion rules;
- migration version and rollback path;
- exact frontend fixture location and ownership paths;
- implementation branch name and accepted frontend base commit.

Each choice must be recorded here before its dependent task begins.

## Explicitly deferred decisions

- embeddings provider or local embedding model;
- graph edge types and spreading-activation weights;
- database and broad source adapter matrix after repositories and sessions;
- scheduled reflection cadence and budgets;
- proactive outreach policy;
- concurrent multi-device writer coordination;
- mobile continuity behavior;
- rich inner-life, emotional, social, or dialectic systems.
