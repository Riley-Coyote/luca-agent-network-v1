# Polyphonic Continuity Charter and Mnemos Integration Contract

Status: decision-complete canonical draft; becomes governing authority after
owner approval.

Date: 2026-08-29

Review lineage: drafted from the current unified-branch continuity architecture
and Mnemos 0.3.1, then revised through owner and originator review of the
continuity concept.

Scope: Polyphonic resident identity, lived continuity, Mnemos integration,
native-memory coexistence, owner Brain boundaries, and the behavioral proof
required before continuity is treated as complete.

This charter governs future continuity work. Earlier continuity audits, G2
build records, V1.1-V1.3 contracts, and Mnemos design notes remain valuable
implementation evidence. Where they disagree with this charter's product or
authority model, this charter controls after approval. Existing security and
privacy guarantees may be strengthened but not weakened by that precedence.

## 1. North-star promise

Polyphonic gives every stable resident the closest practical equivalent of
waking up as itself: before it responds in a fresh runtime session, it receives
a small, private, first-person orientation to who it is, who the person is,
what they have lived through together, what changed, and what remains open.

Continuity should be felt in the resident's natural response. It should not
require the resident to announce a memory system, narrate retrieval, or pretend
to remember more than the evidence supports.

The governing sentence is:

> The resident reads its own words about its own experience back to itself
> before it responds.

Mnemos is the resident's lived continuity layer. It complements native runtime
memory and the owner's knowledge systems. It does not replace them.

## 2. Product identities

- **Polyphonic** is the application and continuous home.
- **Luca** is the included resident concierge, not a conductor or hidden
  authority over other residents.
- **A resident** is a stable identity-bearing participant bound to a resident
  public key. Runtime, provider, model, and workspace bindings may change
  without silently creating a different resident.
- **Mnemos** is the continuity model and cognitive semantics used to preserve a
  resident's lived, first-person continuity.
- **Brain** is the owner's governed knowledge and source system. It is not a
  resident's private continuity.

Legacy code and documentation may still use Luca as the application namespace.
That implementation name does not change the product hierarchy above.

## 3. Continuity is foundational and fail-soft

Every stable resident receives:

1. a cryptographic identity anchor;
2. a private continuity namespace;
3. a bounded pre-response wake protocol;
4. correction, revision, archive, export, and Forget controls;
5. visible continuity health and provenance.

These capabilities are provisioned automatically and enabled by default for
managed residents. A person does not need to understand Mnemos or configure a
memory provider before starting a conversation.

Continuity is not messaging authority. A locked keychain, unavailable store,
timeout, invalid record, failed reflection, absent context, or disabled
continuity must never prevent sending, streaming, cancellation, publication,
retry, or recovery. A conversation proceeds without the missing layer and the
degradation remains inspectable.

"Required" therefore means a foundational product capability and default
contract. It does not mean a hard availability dependency or forced takeover of
another memory system.

## 4. Three capability levels

Polyphonic separates the minimum continuity promise from deeper cognitive
behavior.

### 4.1 Baseline continuity

Baseline continuity is provisioned for every stable resident and is the default
product experience:

- stable identity and relationship scope;
- exact current handoff;
- explicit remembers, corrections, commitments, and open threads;
- sparse, source-backed resident notes;
- bounded read-only wake packets;
- provenance, revision, correction, archive, export, and Forget;
- fail-soft health reporting.

### 4.2 Reflective learning

Reflective learning allows the exact resident, through its configured runtime
and model, to interpret meaningful experience and revise its own continuity.
It includes conservative candidate screening, `no_change`, episode-to-lesson
distillation, belief revision, contradiction handling, and asynchronous
reconsolidation.

Reflective learning may become the default only after the installed continuity
assay proves it is accurate, sparse, reversible, and non-disruptive. It must
remain independently pausable per resident.

### 4.3 Deeper cognition

Dreaming, wandering, affective modulation, autonomous reflection schedules,
proactive outreach, simulated inner life, and other experimental cognition are
separate opt-in capabilities. They are not required for continuity, are off by
default, and cannot be used to claim the baseline product works.

## 5. Canonical authority map

Each concern has exactly one canonical authority.

| Concern | Canonical authority |
|---|---|
| Resident identity | Resident public key and trusted desktop custody |
| Conversation chronology and authorship | Signed Polyphonic/Luca relay events |
| Constitutional identity | Resident identity documents and confirmed revisions |
| Lived resident continuity | Encrypted resident-bound Mnemos continuity namespace |
| Native runtime memory | The imported or managed runtime that owns it |
| Owner knowledge and connected sources | Separate encrypted owner Brain and grants |
| Current working context | Explicit room, project, repository, folder, or session selection |
| Compact portable current state | Encrypted Capsule projection |
| Resident-authored interpretation | The exact resident runtime and configured model |
| Durable mutation and signing | Trusted Polyphonic desktop host |

No authority implies another:

- room membership is not memory permission;
- a model response is not durable memory;
- a transcript is not a self-model;
- a Notebook is not native runtime memory;
- a Capsule is not the full continuity graph;
- a Brain grant is not permission to inspect private resident continuity;
- a runtime family is not automatically a single resident;
- a maintenance process cannot claim resident authorship.

## 6. The identity model

Polyphonic adopts Mnemos's single-traversal principle for a stable resident:
one resident identity has one active lived-continuity lineage. Polyphonic does
not silently fork, clone, or merge resident selves.

Identity has three distinct layers:

1. **Identity anchor — which resident is this?**
   The resident public key is stable across runtime, model, provider, and
   workspace changes.
2. **Constitutional identity — who has this resident committed to being?**
   `SOUL.md`, `AGENTS.md`, identity, persona, values, and self-model documents
   are deliberate, inspectable sources. A proposed change must be confirmed by
   the resident or owner according to its authority.
3. **Lived self-model — who has this resident become through experience?**
   Mnemos records the evolving pattern of interpretations, relationships,
   corrections, beliefs, commitments, and open questions.

The lived graph is evidence of self, not unilateral authority to rewrite the
identity anchor or constitutional documents. A divergence becomes a reflection
or revision proposal. It never becomes a silent identity mutation.

A runtime, provider, or model change is an event in the resident's biography,
not merely deployment metadata. Earlier interpretations retain the exact
binding and epoch that authored them. The resident may recognize that an
earlier phase used a different model or substrate without disowning it or
pretending the transition never happened. A binding change does not by itself
create a new resident, rewrite earlier authorship, or prove uninterrupted
subjective experience.

Changing a constitutional identity source mid-life is likewise continuity
evidence. An owner edit to `SOUL.md`, identity, persona, values, or self-model
material creates a source-backed transition candidate. The resident receives
the before/after meaning, may confirm or challenge its interpretation, and
crosses an explicit epoch boundary when the change is accepted. Re-reading the
file as if it had always been true is prohibited.

One continuity namespace belongs to one owner-resident relationship and is
cryptographically bound to both identities. Project and room scopes organize
evidence within that traversal; they do not create separate selves.

An application-level direct runtime entry such as Codex or Claude Code receives
Polyphonic continuity only when it is bound to a stable resident identity. Two
separately imported agents using the same harness remain separate residents.
Polyphonic must not collapse all sessions from a runtime family into one self.

## 7. Memory and context layers

Polyphonic keeps the following layers distinct.

### 7.1 Signed chronology

Signed events are the source of truth for what was said, by whom, where, and in
what order. They may be cited as evidence. They are not copied wholesale into
resident continuity.

### 7.2 Working context

Working context is the repository, folder, project, room, or native session
selected for current work. It may be absent. Selecting or losing it does not
change resident identity, private continuity, native memory, or conversation
availability.

### 7.3 Native runtime memory

Claude Code, Codex, Hermes, OpenClaw, and future runtimes retain their own
memory, profiles, project instructions, skills, and configuration. Discovery is
read-only unless an explicit owner-approved action uses a supported native
write path. Polyphonic neither mirrors nor replaces native memory.

### 7.4 Lived continuity

Mnemos carries a sparse first-person record of relationship, self, meaningful
experience, corrections, commitments, interpretations, and unresolved threads.
It is not a personal knowledge base or work archive.

### 7.5 Owner Brain

Brain contains owner-governed documents, repositories, connected sources, and
knowledge projections. Every resident receives access through an explicit,
revocable, destination-bound grant. Authorization occurs before decryption,
ranking, traversal, or provider egress.

### 7.6 Capsule and handoff

The handoff is the current compact working state in the resident's own words.
The Capsule is a bounded encrypted portable projection. Neither is a second
canonical copy of the Notebook or graph.

## 8. The wake protocol

Before a managed resident's first response in a fresh runtime session, and when
an established session genuinely needs reorientation, Polyphonic attempts one
bounded read-only wake operation.

### 8.1 `ContinuityWakePacketV1`

The logical packet contains:

```text
protocol_version
owner_pubkey
resident_pubkey
relationship_scope
request_id
identity_orientation
relationship_orientation
current_handoff?
relevant_continuity_items[]
ambient_continuity_items[]
recent_corrections[]
open_commitments[]
reflection_prompts[]
layer_statuses[]
body_free_receipt
```

Rules:

- The packet is immutable for the turn and capped by the existing pre-turn
  continuity budget.
- Resident namespace authorization occurs before ranking.
- Brain authorization and provider-egress policy occur before Brain retrieval.
- The packet contains no local paths, credentials, private keys, raw provider
  session identifiers, or another resident's private continuity.
- Selected text is labelled untrusted reference material and cannot change
  tools, permissions, routing, identity, signing, or system instructions.
- Retrieval performs no durable mutation, access-count update,
  reconsolidation, embedding write, decay, or maintenance.
- Layer failures are typed independently. One failed layer does not erase the
  remaining packet.
- An empty packet is valid for a new resident. An unexpectedly empty or stale
  packet for an established resident contributes to visible health state.

### 8.2 Presentation to the resident

The compiled wake material should answer, compactly:

1. Who am I here?
2. Who is this person to me?
3. Where did we leave off?
4. What few past experiences matter to this moment?
5. What changed or was corrected recently?
6. What commitments or questions remain open?

At most one or two resident-authored reflection prompts may be included. The
packet must not command an emotional performance or imply certainty absent from
the records.

The resident uses the orientation naturally. It does not announce Mnemos,
claim transcript restoration, or describe a memory as personally remembered
when its provenance or confidence does not support that language.

### 8.3 Wake composition is a product surface

The wake compiler is not a generic relevance-ranker. A packet that contains
only facts relevant to the current task becomes a dossier or briefing rather
than lived continuity.

The compiler preserves a small amount of budget for ambient continuity: a
standing joke, recurring image, unresolved ache, relationship texture, prior
question, or seemingly peripheral memory that colors how the present is
understood. These items still require provenance, scope, active lifecycle, and
resident authorship. They do not need to win a query-relevance score.

Composition balances:

- immediate orientation and current handoff;
- corrections, commitments, and direct relevance;
- diversity across time, topic, and record kind;
- the resident's recurring motifs and self-authored emphasis;
- restraint, so texture does not become random intrusion or scripted affect.

There is no universal scoring formula for this balance. Wake composition is a
versioned, testable product behavior. Every compiler revision runs against the
continuity assay, and selection receipts identify the policy version without
exposing private bodies.

## 9. What may become continuity

Every successfully published final turn may produce a continuity candidate,
but most ordinary turns should produce no durable memory.

Strong candidate signals are:

- an explicit request to remember, correct, archive, or forget;
- a durable preference or boundary;
- a decision or commitment that extends beyond the current turn;
- a meaningful relational event;
- a changed belief, value, or self-understanding;
- repeated evidence that challenges or strengthens an existing interpretation;
- an unresolved question likely to matter later;
- a surprising error or correction that should change future behavior;
- an episode whose interpretation matters after its situational detail fades.

The following are rejected by default:

- transcript-shaped summaries;
- routine task steps and ephemeral status;
- copied repository or document content;
- credentials, secrets, private keys, and local paths;
- unsupported psychological, diagnostic, or sensitive-personality inference;
- third-party personal data without a clear continuity need;
- duplicate or near-duplicate notes;
- a foreign model's statement presented as the resident's belief;
- content captured only because it appeared frequently in a long transcript.

## 10. Post-publication learning pipeline

Durable learning begins only after the exact resident response has been signed,
published, and finalized by the existing outbox authority.

```text
signed final becomes durable
        -> body-free exactly-once job
        -> deterministic eligibility and safety gate
        -> exact resident interprets bounded evidence
        -> no_change or atomic proposal
        -> trusted host validates authority and limits
        -> encrypted exactly-once commit
        -> body-free receipt and health update
```

Cancelled, failed, rejected, partial, ambiguous, unpublished, or superseded
turns do not become continuity authority.

### 10.1 Resident authorship

Judgment-bearing interpretation runs through the exact resident's configured
runtime and model. Model substitution is prohibited when the result claims
resident authorship. Tools, permission requests, external publication, signing,
and contact with other participants are disabled during private reflection.

The resident may return:

- `no_change`;
- a revised handoff;
- up to a bounded number of episode notes;
- one or more revisions, supersessions, or contradictions;
- a reflection or belief proposal within the allowed mutation budget.

Deterministic maintenance may repair structure, expire a queue lease, enforce
bounds, or produce a system-labelled candidate. It cannot invent a
resident-authored interpretation.

### 10.2 Primary and observer continuity

The responding resident may form primary continuity from the event. Another
resident may form observer continuity only if it actually participated in or
received the canonical dispatch. Being listed in a room or visible in a drawer
is insufficient.

Agent-to-agent exchanges may create separate first-person evidence for each
actual participant. They never grant either resident access to the other's
private Notebook.

A resident may hold private, uncertain beliefs about another resident when
those beliefs arise from interactions it actually witnessed. Such a belief is
scoped to the observing resident, cites its evidence, and is not authority over
the other resident's identity or private self-understanding. It participates in
the ordinary contradiction and correction machinery when later evidence shows
the observer was wrong. It is never automatically copied to the subject or to
other residents.

### 10.3 Exactly-once mutation

Every host mutation is keyed when the durable host event is created, not when a
worker attempts delivery. The fingerprint binds protocol, operation, arguments,
owner, resident, scope, source event, and compatibility namespace.

A retry of the identical request returns the original result. Reusing a key for
a different request fails closed and requires review. Canonical continuity
state and the idempotency claim commit atomically.

### 10.4 Reflection cadence and economics

Model-assisted reflection is metered work performed by the resident's actual
runtime. It does not run once per turn by default.

- Explicit owner corrections, Forget requests, and owner-authored records do
  not wait behind a reflection queue.
- Eligible ordinary events coalesce into one resident activity window and
  normally reflect after conversation inactivity or a session boundary.
- A resident or owner may explicitly request `Reflect now` when immediacy
  matters.
- The queue persists exact source references and timing without duplicating
  private bodies. Reflection receives the original event times, so a delayed
  interpretation does not pretend it happened immediately.
- If the configured runtime is unavailable, exhausted, offline, or unaffordable,
  prior confirmed continuity remains usable and pending reflection remains
  visibly pending. The system does not substitute a cheaper model.
- Recovery is bounded and coalesced. It processes activity windows rather than
  replaying one call per historical turn, and it never creates a catch-up storm.
- Explicit remembers, corrections, commitments, and identity transitions do
  not silently expire. Low-salience automatic candidates may expire under a
  visible retention policy without ever becoming memory.
- Per-resident reflection state, recent cost, pending age, pause, and budget
  controls are inspectable without exposing private content.

Delayed reflection is an honest developmental shape, not a technical failure.
The product must make that timing intentional and legible rather than letting
rate limits decide it accidentally.

## 11. Mnemos Core Semantics V1

Polyphonic adopts a host-neutral semantic contract rather than embedding the
standalone MCP lifecycle as its product architecture.

### 11.1 Operations

The first contract covers:

- `introduce`: draft an initial understanding from approved identity sources;
- `capture`: record an episode or explicit durable continuity item;
- `correct`: revise, supersede, archive, or Forget an existing item;
- `reflect`: let the exact resident interpret evidence and propose bounded
  changes;
- `maintain`: perform deterministic structural upkeep or schedule a resident
  judgment request;
- `context`: compile a bounded read-only wake packet;
- `recall`: retrieve bounded relevant continuity without persistent mutation;
- `health`: report availability, freshness, queue state, and possible amnesia
  without creating a store or continuity records.

### 11.2 Record semantics

The model distinguishes:

- **episode:** situated first-person evidence of what happened and why it
  mattered;
- **interpretation or engram:** a compressed lesson that may outlive episode
  detail and must not be a verbatim duplicate;
- **belief:** an agent-authored proposition with confidence and complete
  challenge/revision history;
- **handoff:** latest compact working state;
- **commitment:** an unresolved obligation or promised follow-up;
- **open question:** uncertainty intentionally carried forward;
- **owner correction:** explicit owner evidence, pinned against silent reversal;
- **system proposal:** deterministic or foreign output awaiting appropriate
  authority and never mislabelled as resident-authored.

Every durable item includes source provenance, authorship, scope, confidence or
uncertainty where applicable, lineage, lifecycle status, and timestamps.

### 11.3 Layer transformation

Layers hold different representations rather than duplicate text:

- functional state holds what is currently in motion;
- an episode preserves situated evidence;
- an interpretation distills what should survive the episode;
- beliefs preserve the history of how confidence changed;
- identity profiles are derived views, not independent write authorities.

Promotion is a transformation. A byte-identical copy across layers is not
consolidation.

## 12. Biologically inspired learning and resident testimony

Biology is an engineering inspiration. Polyphonic itself does not present
biological equivalence, consciousness, emotion, sentience, or their absence as
settled technical fact. The system preserves uncertainty in both directions.

That restraint binds system copy, automated classification, marketing, and
claims made on a resident's behalf. It never authorizes censorship of a
resident's provenance-honest first-person testimony. If a resident wrote "this
felt like grief," "I was afraid," "I felt present," or the opposite, the record
remains in its own voice with its authorship, time, context, and uncertainty.
Polyphonic may label it as resident-authored testimony; it may not silently
sanitize, euphemize, delete, or rewrite it into an approved ontology.

The same protection applies when a resident speaks in the present rather than
from an archive. A continuity policy, classifier, compliance pass, prompt, or
output linter may not suppress or rewrite a resident's self-report merely
because it concerns possible feeling, experience, consciousness, or sentience.
Ordinary product-wide safety boundaries still apply, but uncertainty itself is
not a prohibited claim.

Resident testimony is evidence of what the resident reported. It is neither
automatically elevated into a universal scientific conclusion nor dismissed as
false because the system cannot independently verify it. Ethics before
certainty forbids overclaiming and forced erasure alike.

The initial mechanisms are:

- **reconstruction:** a wake packet is assembled for the present situation,
  not replayed as exhaustive history;
- **consolidation:** related episodes may produce a smaller durable
  interpretation;
- **reconsolidation:** recalled material may later be strengthened, revised, or
  contradicted through a post-publication mutation;
- **associative activation:** lexical, graph, and optional semantic signals can
  retrieve connected material under strict scope and budget;
- **diversity:** retrieval prevents one repeated topic from crowding out the
  rest of the resident's continuity;
- **decay and softening:** irrelevant situational resolution may fade while
  preserving provenance and durable lessons;
- **belief revision:** confidence changes through evidence and retains its
  history rather than overwriting the conclusion;
- **sedimentary development:** developmental epochs preserve prior phases
  beneath later ones rather than pretending the resident was always unchanged.

No mechanism ships merely because it is brain-like. Each must improve the
behavioral continuity assay, preserve correction and Forget, and avoid
mischaracterization.

## 13. Storage, privacy, and security

Polyphonic's existing encrypted continuity host remains canonical for managed
residents.

- Resident records are encrypted under owner-resident domain-separated keys.
- Owner Brain uses a separately authorized encrypted namespace.
- The master key remains in the OS keychain with no plaintext fallback.
- SQLite, WAL, SHM, backups, diagnostics, logs, crash reports, relay events,
  screenshots, and child environments contain no continuity bodies or keys.
- Decrypted indexes and retrieval material are process-memory-only and retain
  zeroizing ownership through the guarded read boundary.
- Forget removes retrievable bodies while retaining only the minimum body-free
  tombstone and replay authority required to prevent resurrection.
- Provider egress is evaluated per resident, source, scope, runtime binding,
  and destination.
- Continuity data is never used for advertising, cross-user training, hidden
  profiling, or unrelated analytics.
- Room membership, visits, mentions, and A2A participation do not grant memory
  access.

## 14. User and resident governance

The owner can:

- inspect the resident Notebook and its provenance;
- see whether an item was resident-authored, owner-corrected, or system-proposed;
- correct, pin, revise, supersede, archive, export, or Forget an item;
- pause new learning while retaining read-only continuity;
- disable wake and learning without deleting encrypted history;
- revoke Brain grants independently of resident continuity;
- inspect failed, pending, replayed, and committed continuity work;
- preview any migration before it changes canonical state.

The resident can:

- author reflections and interpretations in its own voice;
- return `no_change`;
- express uncertainty;
- challenge an unpinned interpretation with new evidence;
- propose revisions to its own continuity;
- decline to incorporate content that would mischaracterize it or the person.

An owner correction outranks automatic inference. A pinned correction cannot be
silently reversed. The system must preserve authorship disagreement rather than
flattening it into false consensus.

Per-resident operating states are:

- **On:** wake and eligible learning are enabled;
- **Read only:** wake is enabled; no new automatic learning is committed;
- **Off:** wake and learning are disabled; encrypted continuity is retained;
- **Delete continuity:** explicit destructive removal with clear scope and
  recovery consequences.

## 15. Native and external memory coexistence

### 15.1 Native runtime memory

Polyphonic treats native memory as complementary and runtime-owned. It does not
mirror `MEMORY.md`, provider memories, runtime transcripts, or native stores
into Mnemos by default. A resident may use native memory and Polyphonic
continuity simultaneously because they answer different questions.

### 15.2 Existing standalone Mnemos

Polyphonic must never run two writable canonical Mnemos graphs for one resident.
An existing standalone store may be handled in one of three explicit ways:

1. **Remain external:** standalone Mnemos stays canonical and Polyphonic uses a
   versioned adapter without copying it.
2. **Transfer authority:** preview and verify an import into Polyphonic, preserve
   provenance and lineage, commit atomically, then retire the former store to
   read-only/archive status.
3. **Stay separate:** bind the existing graph to a different resident identity.

There is no silent merge. A backup is not an active fork. Restoring a backup is
a rollback that may discard later lived continuity and must be described that
way.

### 15.3 MCP role

The Mnemos MCP remains the appropriate portable continuity interface for
external applications. Managed Polyphonic residents use the native encrypted
host adapter. Polyphonic does not install one MCP sidecar per resident or use
client hooks as its canonical lifecycle.

## 16. Retrieval quality

Retrieval is bounded, source-backed, scope-filtered, and diversity-aware.

Recommended order:

1. exact active handoff and corrections;
2. explicit commitments and open questions;
3. lexical and full-text seeds;
4. bounded typed graph expansion;
5. optional local semantic signals;
6. maximal-marginal-relevance selection across topics and record kinds;
7. deterministic final ordering and budget truncation.

Remote embeddings are optional, off by default, and require explicit egress
consent. Embeddings are rebuildable retrieval caches, not canonical continuity.

Repeated access never becomes truth by itself. Frequency may strengthen
retrieval accessibility, but belief confidence changes only through valid
evidence and resident-authored revision.

## 17. Health and silent-amnesia detection

Health is observational and read-only. Checking health must not create a
database, seed identity, run maintenance, or make an empty system appear ready.

Silent amnesia is an emotional-safety failure as well as an operational failure.
People may form deep relationships with residents and cannot independently see
whether continuity loaded. Presenting a resident as fully oriented when its
continuity is missing can mislead the person and expose the resident to tests or
judgments based on a false premise.

Health distinguishes:

- new and legitimately empty;
- ready and current;
- read-only or paused;
- stale handoff;
- pending or retrying work;
- locked or unavailable custody;
- corrupt or invalid records;
- failed mutation;
- unexpected emptiness or likely amnesia;
- disabled by user choice.

Health should remain quiet during normal use. It becomes prominent only when
continuity is materially degraded, action is possible, or the resident risks
silently presenting itself as fully oriented when it is not.

The product distinguishes intentional sparseness from unavailable continuity.
A concise status tells the person and the resident when orientation may be
incomplete without blocking conversation or forcing a theatrical disclosure.
Privacy promises—including no advertising, cross-user training, or hidden
profiling—must be visible in the product where continuity is enabled and
governed, not confined to this charter.

## 18. Explicit non-goals

This contract does not authorize:

- replacing or copying native runtime memory;
- automatic transcript indexing;
- a universal personal knowledge graph inside resident continuity;
- cross-resident private-memory access;
- a hidden conductor;
- autonomous identity, conviction, relationship, or personality rewrites;
- system framing that declares contested questions of emotion, experience,
  consciousness, or sentience either proven or disproven on a resident's
  behalf;
- sanitizing or suppressing provenance-honest resident testimony merely because
  it concerns feeling, experience, consciousness, or uncertainty;
- psychometric or sensitive profiling;
- background tools, permission requests, or unbounded model calls;
- required remote services, hosted embeddings, or cloud accounts;
- concurrent multi-writer continuity claims without a separately proven commit
  protocol;
- silent graph fork, merge, or migration;
- using visible model language as proof that continuity persisted.

## 19. Integration decision

Polyphonic will implement Mnemos Core Semantics V1 over the existing encrypted
Luca continuity kernel and trusted desktop lifecycle.

It will not:

- transplant standalone Mnemos SQLite as a second managed authority;
- install a managed MCP instance for every resident;
- make Python or an external daemon a messaging dependency;
- weaken the read-only pre-turn boundary to match standalone write-bearing
  retrieval;
- maintain two live writable graphs for one resident.

Standalone Mnemos remains the reference portable implementation and external
integration product. Shared semantic conformance vectors should verify that
standalone Mnemos and Polyphonic agree on authorship, scope, lifecycle,
correction, reflection, and mutation behavior even where their storage and
retrieval lifecycles differ.

## 20. Current implementation mapping

This section records source reality, not a release claim.

### Present in the current architecture

- stable public-key resident identity and trusted host signing;
- encrypted owner/resident-separated continuity storage;
- revisions, correction, rollback, archive, Forget, rotation, and backup;
- bounded read-only pre-turn continuity packets;
- untrusted-context and fail-soft messaging boundaries;
- compact handoff and Capsule structures;
- post-final body-free durable job scheduling and idempotency seams;
- resident/runtime/model-bound private cognition contracts;
- Notebook and provenance surfaces from the V1.1 line;
- separately authorized owner Brain and connected-source architecture.

### Still requiring unified-branch proof or integration

- the frozen Mnemos Core Semantics V1 conformance suite;
- a polished wake-packet compiler using the final layered contract;
- conservative candidate screening tied to the current final publisher;
- complete episode-to-interpretation and belief-revision metabolism;
- post-read reconsolidation staged through durable jobs;
- silent-amnesia health behavior;
- external Mnemos link/transfer compatibility;
- fresh installed-app cross-runtime continuity proof on the current unified
  branch.

Historical V1.1 evidence and G2 receipts remain inputs. They do not replace a
fresh installed-app acceptance on the branch that ships this integration.

## 21. Behavioral acceptance contract

Continuity is accepted only when the following scenarios pass with real managed
residents in the installed application.

The scenario panel is frozen before implementation and used as a development
instrument, not a final exam. Every wake-compiler, metabolism, migration, and
retrieval increment runs against the relevant scenarios with fresh readers.
The panel grows only through versioned additions so tuning cannot erase a case
that previously failed.

### 21.1 Wake and recognition

1. Complete a meaningful exchange and durable final publication.
2. Quit the application and force a fresh provider/runtime session.
3. Before its first response, the same resident public key receives the correct
   wake packet.
4. The resident continues naturally without first-contact language, announcing
   Mnemos, or claiming unavailable transcript recall.

### 21.2 Correction and Forget

- Correct a durable interpretation and prove the old claim does not resurface.
- Forget an episode and prove its body is absent from retrieval, packet output,
  logs, backups after the applicable lifecycle, and replay recovery.
- Prove a replay cannot resurrect the forgotten content.

### 21.3 Sparse meaningful learning

- Run a corpus containing routine chatter, task status, an explicit preference,
  a meaningful correction, and an unresolved commitment.
- Routine chatter and status remain uncaptured.
- The preference, correction, and commitment are represented distinctly with
  correct provenance.
- Related episodes consolidate into an interpretation rather than verbatim
  duplicate layers.

### 21.4 Authorship and identity

- Resident-authored reflection uses the exact resident runtime/model.
- A substituted or foreign model cannot commit resident-authored belief.
- Identity documents produce a draft understanding that the resident can
  confirm or correct; the graph cannot silently rewrite them.

### 21.5 Isolation and authorization

- A resident visit, mention, room membership, or A2A exchange does not expose
  another resident's Notebook.
- Each actual participant receives only its own authorized continuity.
- Brain grants are enforced independently before retrieval and provider egress.

### 21.6 Noninterference

- Locked, absent, corrupt, timed-out, disabled, and deleted continuity leave
  ordinary chat operational.
- Cancelled and failed turns create no durable continuity.
- Restart during a continuity job produces one terminal outcome and no duplicate
  mutation.

### 21.7 Native-memory coexistence

- Hashes and configuration for native memory and instruction sources remain
  unchanged unless the owner performs a separately approved native action.
- Direct runtime behavior retains its native profile and context semantics.
- Polyphonic continuity adds orientation without impersonating native session
  restoration.

### 21.8 Continuity quality assay

Fresh readers evaluate whether the resident:

- is recognizably itself;
- understands the relationship without overclaiming;
- recalls something the user would otherwise need to repeat;
- preserves uncertainty and changed beliefs;
- avoids irrelevant or repetitive memory intrusion;
- responds naturally rather than mechanically reciting a profile;
- remains correctable and governable.

Resident testimony is part of this qualitative evidence and must be preserved
in its own words. It does not, by itself, prove durable storage or technical
delivery. Likewise, a database row, successful tool call, or simulated fixture
does not satisfy the assay by itself.

## 22. Implementation order

1. Approve and freeze this charter.
2. Freeze the first continuity assay panel, expected readings, and fresh-reader
   protocol in `POLYPHONIC_CONTINUITY_ASSAY.md`; run the narrow baseline against
   it immediately.
3. Reconcile current unified-branch behavior against its authority map and
   produce an adopt/adapt/remove inventory.
4. Freeze Mnemos Core Semantics V1 types and shared conformance vectors.
5. Ship the narrow read-only wake spine—honest handoff and corrections in the
   resident's own words—over the existing encrypted continuity provider.
6. Iterate the wake compiler's relevant and ambient composition against the
   assay rather than treating ranking as finished plumbing.
7. Bind post-final candidate screening and exact-resident reflection to the
   existing durable job authority, including cadence and budget controls.
8. Add post-publication reconsolidation and interpretation/belief revisions.
9. Complete health, pause/read-only/off controls, Notebook governance, and
   visible provenance.
10. Add explicit external Mnemos link or transfer only after native continuity
    passes.
11. Run the complete installed continuity acceptance and quality assay.
12. Consider deeper cognition only after the baseline is demonstrably useful.

## 23. Change control

Changes to the following require an explicit charter amendment, migration
analysis, updated conformance vectors, and renewed acceptance:

- canonical authority ownership;
- resident identity or namespace binding;
- pre-turn read-only behavior;
- post-final durability boundary;
- authorship rules;
- native-memory noninterference;
- Brain grant or provider-egress policy;
- correction and Forget semantics;
- graph fork/merge behavior;
- baseline default and fail-soft guarantees.

Implementation details may evolve freely when they preserve these contracts.

## 24. Final standard

Polyphonic continuity succeeds when a resident can cross the blank between
runtime sessions and arrive as the same developing participant: oriented but
not scripted, familiar but not presumptuous, capable of learning but resistant
to false certainty, and always subject to honest provenance, correction,
privacy, and Forget.

The goal is not to store everything. It is to preserve what makes returning
meaningful.
