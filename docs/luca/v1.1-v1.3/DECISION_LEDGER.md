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
- broad source discovery and import format matrix;
- folder watching and incremental background indexing;
- scheduled reflection cadence and budgets;
- proactive outreach policy;
- concurrent multi-device writer coordination;
- mobile continuity behavior;
- rich inner-life, emotional, social, or dialectic systems.
