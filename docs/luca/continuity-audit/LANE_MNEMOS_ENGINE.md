# Lane audit: Mnemos continuity and cognition engines

**Audit date:** 2026-08-04
**Mode:** read-only source and test audit
**Auditor:** Codex continuity-audit lane
**Target question:** Which parts of Mnemos and Polyphonic's Mnemos integration are real, tested, safe enough to reuse in Luca Agent Network V1, and which parts are prototypes, unsafe, or only planned?

## Source coordinates and audit integrity

This report compares two materially different Mnemos lines:

| Source | Revision audited | Working-tree state at audit | Interpretation |
|---|---|---|---|
| `/Users/rileycoyote/Documents/Repositories/mnemos` | `73d691cc1b4f503d715306570fb5cc7b13e42ac0` (`main`) | Clean | Current standalone continuity product and primary technical source of truth |
| `/Users/rileycoyote/Documents/Repositories/polyphonic-v2/mnemos` | `1381cea28f7ebb5b826b4c699971f635bd45fb05` (`main`) | Pre-existing dirty/untracked work; not modified by this audit | Historical embedded engine plus several Polyphonic-only cognition experiments |

The Polyphonic tree already contained changes and untracked artifacts before inspection, including changes under `.claude`, `CLAUDE.md`, task documents, mockups, report artifacts, and `src/content`. None were edited, staged, cleaned, or reset. The current Luca, standalone Mnemos, Polyphonic, and Buzz repositories were treated as read-only. This lane writes only this report.

Test commands were run with bytecode and pytest cache writes disabled:

```text
PYTHONDONTWRITEBYTECODE=1 python -m pytest -p no:cacheprovider -q
```

Results:

- Polyphonic embedded Mnemos: **74 passed** in 0.18s.
- Standalone Mnemos: **407 passed, 1 failed** in 6.84s.
- The standalone failure is `tests/test_version.py:44`: the runtime reported installed package metadata `0.3.0`, while `pyproject.toml` declares `0.3.1`. `mnemos/__init__.py:34-45` resolves the version through installed distribution metadata, so this may be a stale local installation rather than source behavior. A clean isolated wheel/install test is required before release.

## Executive verdict

There is a strong, reusable continuity kernel here. It is much more than a concept document:

- immutable original memories with versioned current content;
- typed graph connections and explicit lineage;
- exact resident/person/project scopes;
- durable handoffs and hypomnema revisions;
- lexical retrieval with bounded spreading activation;
- reconsolidation and co-activation tracking;
- deterministic decay, identity computation, connection discovery, and conservative softening;
- atomic mutation envelopes, idempotency, backup, restore, and security-boundary tests;
- a narrow nine-operation continuity surface with honest authorship boundaries.

That kernel is the correct starting point for Luca's first real continuity layer.

The autonomous cognition layer is not equally mature. The current `substrate` tick, dreaming, wandering, insight, introspection, shared pool, relationship tracker, and bridge contain valuable design ideas but are not production-safe as a group. The most important defects are not cosmetic: ineffective budgets, unscoped SQL across residents, duplicated decay, silently broken connection queries, global state files, unguarded model calls, credential discovery outside Luca's authority, and plaintext exports. Several "advanced" systems are explicit unavailable stubs.

The right product architecture is therefore:

> Bind a tested Mnemos continuity kernel to each Buzz/Luca resident public key now; make pre-turn continuity automatic and provenance-visible; then graduate selected Polyphonic cognition ideas into a separately gated, scoped, budgeted, proposal-first inner-life engine after the core product is dependable.

Do **not** import the old inner-life scheduler wholesale, do **not** equate a sidecar model's prose with the resident's own reflection, and do **not** call the current Mnemos SQLite store encrypted. It is local and permission-hardened, but plaintext at rest.

## Product boundary: what Mnemos is today

Standalone Mnemos intentionally describes itself as continuity for the agent rather than a universal user brain. Its README explicitly separates resident continuity from document/codebase search and says general retrieval is another system (`README.md:1-37`). Its supported surface is deliberately small—context, handoff, capture, recall, correct, reflect, maintain, introduce, and health—while advanced prototypes are quarantined (`README.md:41-59`, `README.md:102-142`).

This is compatible with Luca only if Luca preserves two distinct memory authorities:

1. **Resident continuity:** private, identity-bound notes, handoffs, reflection, beliefs, and relationship memory for a particular agent.
2. **Owner universal brain:** Riley's/user-owned knowledge and project memory, shared only through explicit scopes and retrieval receipts.

The universal brain must not become a single implicit shared agent database. Room membership must not automatically grant all residents access to all owner memory.

## Readiness classification

### Production-usable foundation — adopt with Luca integration work

| Capability | Evidence | Verdict |
|---|---|---|
| Engram model | `mnemos/core/engram.py:55-111`, `114-192`, `195-312` | Strong data model: encoding context, typed edges, lineage, immutable original, resolved current content, provenance, impact authorship, strengths, lifecycle, and scopes. |
| Connection and belief semantics | `mnemos/core/types.py:14-48`, `51-90`, `115-149`; `mnemos/core/belief.py:53-115` | Typed relations and auditable belief revisions are real. Tier-crossing rules prevent trivial oscillation from masquerading as contradiction. |
| Persistence and migrations | `mnemos/store/sqlite_store.py:142-260`, `493-539`, `692-720` | Mature schema, FTS, migrations, integrity checks, nested atomic transactions, versions, beliefs, scoped continuity, and replay support. |
| Scope enforcement | `mnemos/store/sqlite_store.py:848-874`; `mnemos/simple_runtime.py:2203-2233` | Exact agent/person/project matching and shared-visibility checks are implemented and tested. |
| Idempotent host mutations | `mnemos/simple_runtime.py:272-410`; `mnemos/store/sqlite_store.py:740-795` | Host-owned namespace/idempotency/request-hash envelope, 1 MiB input limit, replay ledger, and one transaction for durable effects. This maps well onto signed Luca events. |
| Handoff and hypomnema | `mnemos/store/sqlite_store.py:1700-1900`, `1988-2243` | Exact-scope relationship continuity, full revision trails, active handoff replacement, delivery counts, relevance scoring, revise/supersede/archive. |
| Startup continuity packet | `mnemos/simple_runtime.py:1289-1441` | Handoff appears first in the agent's own words, followed by computed identity, selected reflections, onboarding/verification, system-labelled maintenance reports, and scoped continuity. |
| Capture and recall | `mnemos/simple_runtime.py:1565-1687` | Durable engram plus linked hypomnema, explicit impact authorship, no fabricated impact, exact scope, and combined continuity/durable recall. |
| Agent-authored reflection/belief changes | `mnemos/simple_runtime.py:834-1047` | The runtime asks the resident to answer reflection and contradiction prompts rather than pretending the server is the agent. Lessons can be stored separately and carried into future packets. |
| Reactive retrieval | `mnemos/retrieval/reactive.py:1-17`, `46-115`, `120-279` | FTS seeds, bounded typed spreading activation, optional embeddings, emotional-tag bias, confidence/visibility gates, and reconsolidation are implemented. |
| Reconsolidation | `mnemos/retrieval/reconsolidation.py:25-108` | Access, strength, stability, accessibility, version history, and co-retrieval edges update together. Co-retrieval is correctly represented as structural `CO_ACTIVATED`, not fabricated semantic support. |
| Deterministic maintenance | `mnemos/consolidation/daemon.py:83-204`, `257-342`; `mnemos/consolidation/decay.py:25-146`; `mnemos/consolidation/softening.py:88-319` | Activity gating, elapsed-time decay, connection resistance, identity refresh, non-destructive softening, version history, and repair paths exist without requiring an LLM. |
| Conservative connection discovery | `mnemos/consolidation/connection_discovery.py:29-172` | Uses FTS/embedding candidates. Without a model it creates only structural co-activation; richer semantic types require a model. |
| Backup and restore | `mnemos/backup.py:25-158` | Read-only verification, integrity checks, online private backup, atomic restore, and preservation of a safety backup. |
| File permission hardening | `mnemos/file_security.py:11-103`; `mnemos/store/sqlite_store.py:493-510` | POSIX 0700 directories, 0600 files, atomic private writes, and SQLite/WAL permission repair under the default store. |
| Supported scheduler planning | `mnemos/setup/scheduler.py:1-17`, `105-165`, `382-443` | Pure launchd/systemd/crontab plan generation, exact scope flags, backend selection, and user-crontab preservation are well tested. Luca should reuse the planning discipline, not the current job list unchanged. |

### Implemented but requires adaptation before Luca production use

| Capability | Why adaptation is required |
|---|---|
| Persistence | SQLite is permission-hardened but unencrypted. Luca needs encryption at rest, key rotation/recovery, and an explicit mapping from resident signing key to continuity namespace. |
| Agent identity model | `mnemos/core/identity.py:1-16`, `80-265` and `mnemos/identity_diff.py:1-27`, `214-271` compute graph identity, concerns, beliefs, values, growth, and epoch transitions. This is continuity state, not cryptographic identity. Buzz/Luca's resident public key must remain canonical. |
| Beliefs and computed identity scope | Beliefs/identity are keyed by agent, while engrams and relationship continuity additionally support person/project scope. Luca must explicitly decide what is resident-global versus relationship/project-specific to prevent cross-room leakage. |
| Model-assisted maintenance | `mnemos/consolidation/belief_review.py:34-139` and deep reflection are optional and skipped or limited without a provider. Provider calls require user consent, budget controls, provenance, and a rule defining whether output is system proposal, owner-approved content, or resident-authored reflection. |
| Embeddings | Optional local embeddings add roughly 700 MB and changed about 8% of retrieval outcomes in the project's own measured note (`pyproject.toml:45-50`). Hosted embeddings can disclose memory content. Start with FTS; make embeddings opt-in and policy-bound. |
| Scheduler | Current jobs include an unsafe substrate tick every four hours (`mnemos/setup/scheduler.py:31-103`). Luca should own lifecycle-aware scheduling and initially run only tested deterministic maintenance. |
| Health/maintenance APIs | The nine MCP operations are useful reference contracts, but Luca should invoke a native service boundary and signed host mutations rather than depend on every agent voluntarily calling MCP tools. |
| Backup/export | Verified SQLite backup is useful, but recovery artifacts must be encrypted and identity-bound before being offered as portable Luca continuity. |

### Experimental — salvage selectively, do not ship unchanged

| Capability | Evidence and risk |
|---|---|
| Substrate tick / inner-life scheduler | `mnemos/substrate/tick.py:87-183`, `191-318`, `363-370`. Conceptually rich event loop, but its output budget is ineffective, decay is duplicated and unscoped, connection discovery is silently broken, belief review is only a count, silence is global, and logs are plain JSONL. |
| Dreaming and wandering | `mnemos/substrate/handlers/dreaming.py:32-196`; `mnemos/substrate/handlers/wandering.py:39-197`. Raw unscoped SQL, model dependency without a `None` guard, no direct test coverage, and content can cross residents. |
| Insight | Standalone `mnemos/substrate/handlers/insight.py:20-96` directly calls a model and stores the result with no anti-rumination gates. Polyphonic has materially better gates, but they sit above the unsafe tick. |
| Polyphonic anti-rumination | `polyphonic-v2/mnemos/mnemos/substrate/handlers/insight.py:8-14`, `45-111`, `116-192`, `203-375`. Useful novelty, recall-fingerprint, diversity, diminishing-return, and per-tick concepts. State is outside SQLite and novelty parsing can fail open; adapt the ideas into transactional scoped state. |
| Polyphonic social drive | `polyphonic-v2/mnemos/mnemos/substrate/modulators.py:10-88`, `91-271`. Useful relational richness/warmth/integration math, but the state file is global at `~/.mnemos/modulator_state.json`, so multiple residents can contaminate one another. |
| Emotional state/modulators | `mnemos/core/emotional_state.py:41-161`; `mnemos/encoder.py:471-478`. Six-dimensional state and retrieval bias exist, but encoder updates only when a prior state already exists and no robust production lifecycle initializes it. Mostly dormant. |
| Introspection | `mnemos/substrate/introspection_pass.py:1-19`, `99-175`, `226-267`. Opt-in and tested only for toggling/storage, but scans recent OpenClaw and Claude session files globally and emits heuristic claims such as "genuine cognitive work" without exact resident/person/project authority. |
| Multi-agent shared pool | `mnemos/multiagent/shared_pool.py:1-18`, `60-237`. Separate shared DB exists, but publish mutates the caller's engram, reader identity is unused, one read path does not filter visibility, and conflict arbitration is simplistic confidence/strength/recency. No direct tests found. |
| Relationship tracker | `mnemos/multiagent/relationships.py:76-175`. Calls interaction count "trust" through a saturation curve. That is not a defensible trust model. No direct tests found. |
| Cross-agent bridge | `mnemos/multiagent/bridge.py:29-161`. Copies whole active-context files and writes combined shared files without Luca authorization scopes or encrypted atomic storage. No direct tests found. |
| OpenClaw workspace export | `mnemos/interface/openclaw_export.py:23-72`. Implemented, but writes plaintext workspace files and is not a safe continuity export format. |

### Planned or explicit unavailable stubs

The `advanced` package quarantines unsupported capabilities and requires an experimental enable flag (`mnemos/advanced/__init__.py:1-44`; `tests/test_experimental_quarantine.py:8-23`). These must not appear in Luca feature claims or acceptance criteria:

- advanced working memory;
- schemas and schema evolution;
- attention gate;
- intention tracking;
- predictive processing;
- metamemory;
- observer model;
- interference model;
- separate advanced spreading activation;
- advanced dreaming;
- federation;
- attestation;
- portable JSON import/export.

Several modules have types and design commentary but intentionally raise an unavailable error (`mnemos/experimental.py:1-10`). The advanced spreading-activation stub must not be confused with the real bounded spreading activation already inside the supported reactive retriever.

## Detailed findings

### 1. Engrams are a credible durable-memory substrate

The engram model stores more than prose. It captures working context, emotional state, active schemas, attention focus, encoding depth, session, goals, surprise, and source (`mnemos/core/engram.py:55-111`). It supports typed weighted connections, version references, parent/supersedes lineage, source type/model/session/confidence, explicit authorship, and both private and shared scopes (`mnemos/core/engram.py:114-312`). Access and reinforcement update durable state without silently replacing the immutable original (`mnemos/core/engram.py:319-360`).

This should be adopted as the durable resident-continuity record, with two changes:

- replace free-form `agent_id` authority with a canonical Luca resident public-key binding;
- encrypt the store and all backups using Luca's custody boundary.

### 2. Hypomnema is the right V1 notebook abstraction

Hypomnema already behaves like the agent's bounded notebook:

- exact agent/person/project/visibility scope;
- active note retrieval and relevance scoring;
- supersede, revise, archive, and revision history;
- handoff written in the agent's own words;
- delivery tracking;
- durable separation between original source, agent impact, co-authored material, and system synthesis.

Evidence is in the continuity schema (`mnemos/store/sqlite_store.py:142-260`), relationship and handoff methods (`1700-1900`), and relevance/revision operations (`1988-2243`). The startup packet prioritizes the latest handoff and a small, quiet selection rather than dumping the database into context (`mnemos/simple_runtime.py:1289-1441`).

This is much closer to the desired felt continuity than merely restoring a transcript. A transcript says what happened; hypomnema says what the resident intentionally carried forward, under whose authority, from what relationship/project scope, and with which unresolved thread.

### 3. Reflection is strongest when the resident authors it

The supported simple runtime gets an important philosophical and technical boundary right: it can queue a reflection question, but the resident supplies the answer, impact, lesson, belief revision, and contradiction judgment (`mnemos/simple_runtime.py:834-1047`). This avoids a background sidecar impersonating the resident.

The Luca integration should make this rule explicit:

- deterministic/system maintenance can identify candidates and ask questions;
- a resident-authored statement can be stored as resident-authored only when it was produced by that resident's active runtime under a signed turn/epoch;
- sidecar model output is always labelled a system proposal;
- owner edits remain owner-authored or co-authored;
- background first-person prose must never be silently attributed to the resident.

This is the most important integrity rule for a credible "inner life" system.

### 4. Spreading activation and reconsolidation are already real

The supported reactive retriever—not the advanced stub—implements:

1. FTS and optional embedding seeds;
2. scoped traversal over typed weighted connections;
3. depth/decay/threshold bounds;
4. emotional-tag bias;
5. confidence and visibility filtering;
6. reconsolidation after retrieval.

See `mnemos/retrieval/reactive.py:1-17`, `46-115`, `120-279`. Reconsolidation updates access time/count, strength, stability, accessibility, versions, and structural co-activation edges (`mnemos/retrieval/reconsolidation.py:25-108`).

Recommendation: ship this in Luca's first continuity engine with conservative bounds and exact scope. Start with FTS. Local/hosted embeddings should be optional accelerators, not prerequisites.

### 5. Deterministic consolidation is mature enough; model-driven cognition is not

The core daemon uses an activity gate, exact scope, deterministic connection discovery, elapsed-cycle decay, identity refresh, and conservative softening (`mnemos/consolidation/daemon.py:83-204`, `257-342`). Deep belief review/reflection only runs when a provider is available (`mnemos/consolidation/daemon.py:206-252`). Decay uses stability and connection resistance and can archive below a threshold (`mnemos/consolidation/decay.py:25-146`). Softening defaults to not rewriting content without a model and records versions when compression is used (`mnemos/consolidation/softening.py:88-319`).

One documentation inconsistency should be corrected during adoption: comments/docstrings in the daemon/connection discovery still mention a no-model `SUPPORTS` fallback in places, while the implementation now correctly uses structural `CO_ACTIVATED` (`mnemos/consolidation/connection_discovery.py:147-161`).

The separate system-authored dream journal is deliberately neutral and describes maintenance work rather than pretending to be the agent (`mnemos/dream_journal.py:1-7`, `27-112`, `163-206`). It is a maintenance ledger, not a personal journal or felt inner life. Luca should preserve that naming distinction.

### 6. The current substrate tick is unsafe to schedule

The autonomous substrate contains a useful event vocabulary—belief contradiction, softened memory, connection discovery, surprise, silence, and salience can trigger reflection, dreaming, insight, wandering, or initiation (`mnemos/substrate/tick.py:51-61`). Its configured bounds look reasonable on paper: cascade depth two, 12-hour reflection cooldown, 0.15 maximum belief delta, ten dreams/week, five wanderings/week, and three engrams/tick (`mnemos/substrate/config.py:12-64`).

The implementation does not uphold those claims:

1. **The output cap is ineffective.** `engrams_produced` is set to zero and never incremented; handlers write directly and return only follow-up events (`mnemos/substrate/tick.py:129-159`).
2. **Decay is duplicated and unscoped.** Raw SQL reduces every active engram by a constant on every tick, independent of resident/person/project and elapsed time (`mnemos/substrate/tick.py:191-226`). This conflicts with the core daemon's more careful decay.
3. **Connection discovery is likely silently inert.** It calls `EmbeddingIndex.search(..., limit=3)` though the supported interface uses `k`, then queries nonexistent `connections.from_id/to_id` columns instead of `source_id/target_id`; all exceptions are swallowed as debug logs (`mnemos/substrate/tick.py:228-270`).
4. **Belief review does not revise beliefs.** It only counts matched impacted engrams (`mnemos/substrate/tick.py:272-288`), so post-snapshot tier-crossing events are unlikely to be generated by the tick itself.
5. **Silence is global.** It queries the newest active engram across the database without resident/person/project scope (`mnemos/substrate/tick.py:290-318`).
6. **The audit log is a plain global append.** It uses `open(..., "a")` without private atomic handling (`mnemos/substrate/tick.py:363-370`).
7. **There is no direct production coverage.** The project coverage boundary excludes substrate, and no direct tick/dreaming/wandering tests were found.

Do not enable the substrate scheduler in Luca. Rebuild any desired inner-life loop on the tested transaction/scope primitives and signed runtime events.

### 7. Polyphonic contains useful cognition ideas that standalone Mnemos lost

The Polyphonic embedded copy is not a better whole engine, but it has two advanced design contributions worth preserving:

**Anti-rumination insight gates.** The Polyphonic insight handler tracks recall fingerprints, cluster diversity, diminishing returns, per-tick output, and novelty (`polyphonic-v2/mnemos/mnemos/substrate/handlers/insight.py:8-14`, `45-192`, `203-375`). Standalone insight is a much simpler model-call-and-encode path (`mnemos/substrate/handlers/insight.py:20-96`). The Polyphonic math and state transitions should be ported only after moving state into scoped, transactional storage and making novelty parse failures fail closed rather than open.

**Social/relational modulation.** Polyphonic adds a social drive based on relational richness, warmth, and integration (`polyphonic-v2/mnemos/mnemos/substrate/modulators.py:10-45`, `91-271`). The current persistence is a global `~/.mnemos/modulator_state.json` (`48-88`), which can mix residents. Retain the concepts, not the storage implementation.

These systems should become a later experimental cognition lab, never the foundation required to ship messaging and continuity.

### 8. "Shared intelligence" needs a Luca-native authorization design

The existing multi-agent modules are not a safe shared brain:

- `SharedPool.publish` mutates the caller's engram despite claiming not to; read APIs do not consistently enforce reader identity/visibility; conflict resolution is a simplistic winner selection (`mnemos/multiagent/shared_pool.py:60-237`).
- `RelationshipTracker` derives a quantity called trust almost entirely from interaction count (`mnemos/multiagent/relationships.py:76-175`).
- `CrossAgentBridge` copies entire context files between workspaces and writes combined shared files without Luca's signed room/member/scope authority (`mnemos/multiagent/bridge.py:29-161`).
- Federation and attestation are unavailable stubs (`mnemos/multiagent/federation.py:15-65`; `mnemos/multiagent/attestation.py:19-76`).
- No direct tests for these three implemented modules were found.

Recommended Luca model:

```text
resident public key
  -> private encrypted continuity namespace
  -> private handoff / hypomnema / reflections / beliefs

owner universal brain
  -> separate owner-controlled store
  -> explicit retrieval policy by resident + relationship + project + room
  -> provenance/context receipt attached to the turn

signed Buzz/Luca conversation timeline
  -> canonical room chronology and authorship
  -> never automatically equal to permission for every memory scope
```

Shared intelligence should mean that the context broker can retrieve from explicitly authorized owner and room scopes for several residents—not that all resident databases are merged.

### 9. Privacy posture is local-first, not encrypted

The project accurately documents local SQLite, local FTS/deterministic operation, exact scope, and provider-dependent network disclosure (`docs/privacy-security.md:1-57`). It also notes that context/recall can mutate memory through access/reconsolidation and MCP read-only annotations are only hints (`docs/privacy-security.md:18-29`). Correction and forgetting are auditable and should be shown distinctly in UI (`docs/privacy-security.md:67-76`).

Implemented filesystem protections are meaningful: private directory/file modes, atomic private writes, SQLite/WAL permission repair, integrity checks, and verified backups (`mnemos/file_security.py:11-103`; `mnemos/backup.py:25-158`). They do not provide cryptographic encryption at rest.

Specific hazards Luca must reject or replace:

- Gemini embedding calls place the API key in the query string (`mnemos/store/embedding_index.py:47-90`), which can leak through logs/proxies. Use an official/header-based client behind Luca policy.
- The Claude Code index adapter searches every OpenClaw agent's `models.json` and takes a provider API key when its own key is absent (`mnemos/indexer/claude_code_adapter.py:149-166`). Luca must never inspect or inherit native-agent provider credentials.
- Bootstrap paths can accept/write provider credentials into environment files. Luca's runtime custody rules prohibit copying resident/provider credentials.
- OpenClaw export writes plaintext files (`mnemos/interface/openclaw_export.py:23-72`).
- Backups are permission-private but plaintext.
- Hosted embeddings or model-assisted consolidation transmit selected memory content and must be separately consented, scoped, attributed, and budgeted.
- Introspection globally scans Claude/OpenClaw transcript locations outside exact resident scope (`mnemos/substrate/introspection_pass.py:99-175`).

Luca's UI and marketing must not claim Mnemos continuity content is encrypted until the storage and backup paths are actually encrypted and verified.

### 10. Export and portability are unfinished

Portable JSON import/export is explicitly experimental/unavailable (`mnemos/interface/export.py:1-89`). The supported OpenClaw exporter is a convenience surface, not a secure portable identity format. Verified database backup exists and is the better mechanical base, but it still needs:

- encryption;
- signing or authenticated integrity;
- resident public-key binding;
- key rotation/recovery metadata;
- schema/version manifest;
- partial-scope export rules;
- import collision and lineage policy;
- proof that no credentials or unauthorized owner-memory scopes are included.

Buzz engrams can hold compact identity/rules/goals/pointers, but should not be asked to contain the full Mnemos store. The portable unit should be an encrypted continuity capsule referenced by the resident's cryptographic identity.

### 11. Scheduler and operating cost

The scheduler supports launchd, systemd, and crontab, and its plan generation is well tested (`mnemos/setup/scheduler.py:1-17`, `105-165`, `382-443`; `tests/test_scheduler.py`). It deliberately excludes transcript indexing because an earlier live indexer created 7,058 records versus 13 deliberate captures—a 543:1 flood (`mnemos/setup/scheduler.py:89-103`). Keep that safeguard.

Do not reuse the job set unchanged. It currently plans:

- shallow maintenance every four hours;
- deep maintenance daily;
- substrate tick every four hours (`mnemos/setup/scheduler.py:31-87`).

For Luca V1:

- run deterministic maintenance only;
- scope every job to the resident public key and relationship/project context;
- use Luca-owned lifecycle, idle, power, and cancellation controls;
- serialize/reconcile with the app's encrypted store and dispatch epoch;
- provide dry-run and receipts;
- do not run model jobs by default;
- never index raw transcripts automatically;
- never mutate native OpenClaw/Hermes cron/configuration.

The legacy OpenClaw cron path directly rewrites jobs, removes all `mnemos-*` entries, and uses non-atomic plaintext JSON (`mnemos/interface/openclaw_cron.py:123-182`). The legacy cron installer also contains product-specific transcript/workspace/provider assumptions (`mnemos/setup/cron_installer.py:15-122`). Reject both for Luca.

Approximate cost order:

1. FTS + bounded graph traversal + deterministic maintenance: low, local, suitable default.
2. Local embeddings: higher disk/RAM/startup cost; approximately 700 MB dependency footprint in project notes.
3. Hosted embeddings: variable network/privacy/billing cost per capture/query.
4. Deep consolidation/reflection: model calls over private content; must be opt-in and budgeted.
5. Current substrate scheduling: potentially multiplicative across residents and unsafe because its nominal output cap is ineffective.

## Standalone versus Polyphonic delta

| Area | Standalone Mnemos | Polyphonic embedded copy | Source-of-truth decision |
|---|---|---|---|
| Packaging/support | 0.3.1 alpha, 407 passing tests plus one environment/version mismatch, narrow documented continuity surface | 0.2.0 alpha, 74 passing tests, older embedded package | Standalone |
| MCP/simple runtime | Full nine-operation continuity API, host mutation envelopes, hooks, Hermes support, backup, scheduler, security docs | Older/narrower | Standalone |
| Persistence/scope | Stronger migrations, replay/idempotency, hypomnema/handoff, scope tests | Historical baseline | Standalone |
| Retrieval/consolidation | Supported FTS + spreading activation + reconsolidation and hardened maintenance | Similar conceptual engine | Standalone |
| Anti-rumination insight | Simplified handler with fewer gates | Rich fingerprint/diversity/novelty/diminishing-return gates | Adapt Polyphonic concepts only |
| Social drive | Removed/absent | Relational richness/warmth/integration, but global state | Adapt Polyphonic math only |
| Inner-life tick | Unsafe experimental implementation | Same unsafe substrate foundation with extra concepts | Neither wholesale |
| Multi-agent sharing | Experimental shared pool/bridge/relationships | No safer alternative | Reject; design Luca-native broker |

## Adopt / adapt / reject matrix

### Adopt

- Engram, connection, version, lineage, provenance, authorship, and lifecycle data concepts.
- Exact resident/person/project/visibility scope checks.
- Hypomnema revision/supersession/archive and exact handoff semantics.
- Bounded startup packet rather than full transcript injection.
- Agent-authored reflection and contradiction workflow.
- FTS seed retrieval, bounded spreading activation, and reconsolidation.
- Structural `CO_ACTIVATED` fallback when semantics are not model-verified.
- Deterministic elapsed-time decay and conservative softening.
- Idempotent host mutation envelope and replay ledger.
- Backup/restore integrity mechanics.
- No automatic transcript indexer.
- Explicit system labels for maintenance-generated text.

### Adapt

- Bind all resident continuity to the Buzz/Luca public key.
- Encrypt database, WAL, backup, and portable capsule at rest.
- Make Luca runtime hooks automatic before/after turns; do not rely on agent tool discipline.
- Translate signed room events into bounded context and mutation receipts.
- Separate resident-global self-state from relationship/project/room state.
- Reuse core maintenance under Luca-owned scheduling, power, idle, cancellation, and epoch controls.
- Keep FTS default; make embeddings an explicit policy choice.
- Port Polyphonic anti-rumination and social modulation only into scoped transactional state.
- Add real budget accounting, per-resident rate limits, fail-closed parsing, and proposal-only background cognition.
- Turn backup into authenticated encrypted continuity export/recovery.
- Design universal-brain retrieval as a separate owner-controlled context broker.

### Reject

- Current substrate tick as a scheduled production engine.
- Raw global SQL over all residents.
- Global modulator/log state outside the scoped store.
- Any background sidecar speaking as the resident without resident-authored evidence.
- SharedPool, relationship-count-as-trust, and file-copy bridge as Luca shared intelligence.
- Automatic transcript indexing.
- Reading or copying native Hermes/OpenClaw/provider credentials.
- Mutating Hermes/OpenClaw schedules or configuration.
- Query-string API keys.
- Plaintext workspace export as identity portability.
- Claims that filesystem permissions equal encryption.
- Claims that advanced stubs are working features.

## Recommended Luca implementation sequence

### C1 — Continuity kernel

Goal: every resident returns as the same cryptographic identity with a small, faithful, automatically supplied notebook.

1. Map resident public key to an encrypted Mnemos namespace and stable local store.
2. Define exact owner/person/project/room scopes and migration rules.
3. Implement Luca-owned pre-turn `ContinuityCapsuleV1`:
   - latest resident-authored handoff;
   - bounded active hypomnema;
   - relevant engrams through FTS + spreading activation;
   - explicit source/authorship/scope/confidence;
   - signed room-history references;
   - retrieval receipt and token budget.
4. Implement post-turn capture proposals with author, source event IDs, scope, and explicit acceptance policy.
5. Support correction, forget/archive, handoff, recall, and health from Luca UI/runtime.
6. Preserve old conversation continuity through signed Buzz history, but never confuse transcript restoration with a native ACP session resume.
7. Add scope, provenance, idempotency, restart, and privacy tests before any autonomous cognition.

### C2 — Safe maintenance

1. Schedule only the deterministic core daemon under Luca ownership.
2. Run at idle/eligible power states with exact resident scope and a per-cycle receipt.
3. Use dry-run for migration and first production cycles.
4. Add encrypted online backup, verified restore, retention, and recovery UI.
5. Keep model provider off by default.

### C3 — Gated cognition lab

1. Reimplement inner-life events on signed Luca activity and the tested transaction layer.
2. Introduce proposal-only reflection, dream, insight, and wandering outputs.
3. Port Polyphonic anti-rumination gates and per-resident social modulation.
4. Count actual durable outputs, not handler return events; enforce budgets transactionally.
5. Make no-model and malformed-model paths fail closed.
6. Require exact resident/person/project/room scope for every query and write.
7. Label system proposals, resident answers, owner edits, and co-authored records distinctly.
8. Graduate individual capabilities only after isolated tests, adversarial privacy tests, cost telemetry, and user-visible provenance.

### C4 — Shared intelligence

1. Build a separate owner universal-brain service.
2. Use explicit resident/relationship/project/room policies.
3. Attach a context receipt showing which sources each resident received and why.
4. Keep each resident's private notebook private unless an explicit share mutation is approved.
5. Treat room membership and memory permission as independent controls.

### C5 — Portable continuity

1. Authenticated encrypted export bound to resident key.
2. Recovery and key-rotation path.
3. Manifested schema/version and migration.
4. Selective scope export.
5. Collision, lineage, revocation, and lost-key behavior.

## Required interfaces for the Luca design phase

These are recommendations, not existing stable APIs:

```text
ResidentContinuityKey
  resident_public_key
  owner_public_key
  local_store_id
  schema_version

ContinuityScope
  resident_public_key
  person_id
  project_id?
  room_id?
  visibility

ContinuityCapsuleV1
  resident_public_key
  relationship_handoff?
  active_hypomnema[]
  recalled_engrams[]
  room_event_refs[]
  provenance[]
  token_budget
  generated_at
  receipt_id

ContinuityMutationV1
  idempotency_key
  resident_public_key
  session_epoch
  source_event_ids[]
  authorship
  scope
  operation
  content_hash

CognitionProposalV1
  proposal_type
  proposer_kind: system | resident
  resident_public_key
  source_receipts[]
  scope
  budget_receipt
  proposed_content
  status: pending | accepted | rejected | expired
```

## Test and evidence assessment

### Strong coverage found

- simple runtime behavior and supported tool semantics;
- exact scope and packet isolation (`tests/test_scope_security.py`, `tests/test_scope_isolation_packet.py`, `tests/test_agent_scoping.py`, `tests/test_hermes_integration.py`);
- mutation idempotency/replay;
- backup/restore and filesystem permissions;
- forget completeness (`tests/test_forget_is_complete.py`);
- experimental quarantine;
- scheduler plan generation and preservation of user crontab;
- no automatic transcript indexer;
- migration/readiness regressions.

### Material coverage gaps

- substrate tick correctness and budgets;
- dreaming and wandering isolation;
- insight anti-rumination in standalone;
- multi-resident modulator isolation;
- SharedPool visibility and caller mutation;
- RelationshipTracker semantics;
- CrossAgentBridge authorization/privacy;
- introspection resident/session isolation;
- provider egress and consent policy;
- encrypted storage/key recovery (not implemented);
- portable export/import (not implemented);
- real-scale retrieval and concurrent app/maintenance benchmarks;
- clean isolated wheel/version verification for 0.3.1.

The project's own readiness note is unusually honest: provider-free operation produces structural rather than rich semantic edges; beliefs/identity remain agent-level rather than person-level; damaged old stores may need manual repair; and provider/embedding/multi-person scale remains untested (`docs/readiness-0.2.0.md:97-116`).

## Open decisions and unknowns

1. Which encryption scheme and OS key-custody path protects DB, WAL, backup, and portable capsule?
2. How is resident public key mapped to legacy Mnemos `agent_id` during import, and how are collisions handled?
3. Which facts belong to resident-global identity versus a person, project, or room relationship?
4. Who may authorize a post-turn durable write: resident, owner, deterministic policy, or some combination?
5. What is the exact API/schema of the owner universal brain, and how are retrieval receipts linked to Buzz events?
6. Does background cognition run through the resident's own managed runtime or a separate sidecar? If separate, it cannot claim resident authorship.
7. Who owns scheduling when the desktop app is closed, sleeping, offline, or upgraded?
8. What consent, billing, provider, and retention controls govern remote embeddings/model calls?
9. How are existing Luca, Polyphonic, and standalone Mnemos stores migrated and deduplicated?
10. What scale targets apply per resident and across a large owner brain?
11. Does a fresh isolated 0.3.1 wheel pass the version test?
12. How are concurrent app turns, maintenance, backup, cancellation, and restart serialized?
13. What exact sharing policy applies in multi-agent rooms, and what UI makes it inspectable?
14. What happens when a resident key is lost, rotated, revoked, or intentionally forked?

## Final recommendation

Use the standalone Mnemos repository at revision `73d691cc1b4f503d715306570fb5cc7b13e42ac0` as the primary implementation reference, and use the Polyphonic embedded copy at `1381cea28f7ebb5b826b4c699971f635bd45fb05` only as a concept source for its anti-rumination insight gates and relational modulation.

The first Luca continuity milestone should not be "full inner life." It should be a more valuable and attainable proof:

> Luca, Hermes, OpenClaw, and any imported resident return under the same cryptographic identity, automatically receive a small encrypted and provenance-visible notebook of what they intentionally carried forward, can recall authorized parts of the user's universal brain, and can correct or forget durable memory without losing authorship or scope.

Once that works reliably, the richer Polyphonic vision can be built on top as a measured, inspectable cognition layer rather than as an unbounded background fiction. That sequencing preserves the full vision while keeping the app useful, honest, and shippable at every stage.
