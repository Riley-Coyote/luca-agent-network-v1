# Acceptance matrix

Status: active; IDs are referenced by `TASK_GRAPH.yaml`

## Control and integration checkpoint

- **A001** — The implementation branch is created from the accepted functional-
  beta checkpoint; frontend integration is explicitly deferred and recoverable.
- **A002** — The functional-beta, G2, design, and roadmap branches remain
  recoverable and unmodified.
- **A003** — Protocol names, field bounds, command/view models, migrations,
  threat model, fixtures, and file ownership are frozen before parallel writing.
- **A004** — Baseline focused regressions pass and the existing functional-beta
  installed evidence remains traceable before frontend integration.

## V1.1 — Resident Notebook

- **A101** — Golden vectors accept valid notebook/metabolism contracts and reject
  unknown fields, wrong versions, wrong residents, bad source IDs, oversized
  bodies, excessive mutations, and invalid revision links.
- **A102** — Notebook records are encrypted in the exact resident namespace with
  revision, provenance, supersession, archive, forget, and pinned owner-
  correction behavior.
- **A103** — A resident-private cognition result may atomically update a handoff
  and zero to three notebook entries or return `no_change`; one invalid change
  commits nothing.
- **A104** — The job begins only after the exact resident final is accepted and
  locally finalized, remains idempotent across replay/restart, and never runs for
  owner, cancelled, failed, ambiguous, or unfinalized events.
- **A105** — The exact resident runtime/model authors notebook changes without
  tools, permissions, signing, publication, or substitution; a new user turn
  preempts the job.
- **A106** — Read-only retrieval selects only that resident's active notes,
  returns at most the frozen bound, stays within the packet budget, and performs
  no persistent mutation.
- **A107** — Cross-resident, disabled, locked, corrupt, missing, timeout, and
  unavailable cases return safe layer status and leave chat operational.
- **A108** — Owner correction/pin, archive, forget, source jump, and revision
  history are complete and cannot be silently reversed by resident metabolism.
- **A109** — UI fixtures cover loading, empty, active, superseded, archived,
  failed, locked, disabled, and reduced-motion/focus states without private
  bodies in Activity.
- **A110** — Real Hermes and OpenClaw residents each create and later recall a
  source-backed note in a fresh runtime session without native-resume claims.
- **A111** — A mixed room proves each responder authors only its own notebook and
  non-responding residents receive no mutation.
- **A112** — Installed-app security scans find no notebook plaintext or keys in
  logs, evidence, relay events, child environments, SQLite metadata, WAL/SHM, or
  crash output.
- **A113** — Manual journal creation uses the exact resident runtime/model,
  accepts `no_change` or one bounded Markdown page, and cannot use tools,
  permissions, signing, or message publication.
- **A114** — Journal pages and owner annotations are encrypted in the exact
  resident namespace and are excluded from ordinary conversational retrieval.
- **A115** — The owner can annotate, archive, forget, or request a revision but
  cannot directly replace resident-authored journal text.
- **A116** — A resident revision preserves prior page bodies and owner
  annotations with complete authorship and lineage.
- **A117** — Selected prior pages belong to the same resident and are available
  only to the explicit journal cognition request.
- **A118** — Journal cancellation, user-turn preemption, retry, restart, stale
  epoch, invalid output, or unavailable runtime produces no late or duplicate
  page commit.
- **A119** — Renderer fixtures cover notes, pages, annotations, revision history,
  pagination, body-free jobs, and all empty/degraded states.
- **A120** — Real Hermes and OpenClaw residents each author one private page with
  stable identity and no ordinary-chat publication.

## V1.2 — Scoped Brain Sources

- **A201** — Valid source/import/grant/receipt vectors pass and malformed,
  oversized, stale-preview, unsafe-path, wrong-owner, and wrong-resident vectors
  fail closed.
- **A202** — Source preview writes nothing and explicitly reports accepted,
  duplicate, changed, skipped, unsupported, binary, oversized, credential-like,
  and unsafe-path rows.
- **A203** — Import supports selected UTF-8 Markdown/text files and folders,
  normalizes and hashes locally, commits atomically, rolls back completely, and
  leaves source files byte-for-byte unchanged.
- **A204** — Reimport of identical content is idempotent; changed content produces
  a visible source-backed diff before commit.
- **A205** — Owner sources and paths are encrypted in a separate owner-brain
  namespace and never appear in resident-private records or body-free metadata.
- **A206** — Importing grants no access. Active, revoked, stale, absent, and
  reconfirmed grants behave independently per resident and source.
- **A207** — A provider/runtime binding or egress change marks the relevant grant
  stale before the next retrieval; unknown egress is remote.
- **A208** — Retrieval validates grant before decryption/ranking, selects only
  bounded chunks, performs no persistent mutation, and emits a body-free receipt.
- **A209** — Provider capture proves only authorized selected chunks are sent;
  denied, revoked, stale, private, and local-path material is absent.
- **A210** — Brain Setup fixtures cover preview, import progress, duplicate,
  changed, unsupported, cancelled, failed, source list, grants, revocation,
  staleness, reconfirmation, and provenance.
- **A211** — A granted Hermes and granted OpenClaw resident answer a corpus-only
  fact with separate receipts while a denied resident cannot surface it.
- **A212** — Locked, corrupt, missing, cancelled, interrupted, or failed owner-
  brain operations do not expose partial data or block messaging.

## V1.2.1 — Connect Your Work

- **A221** — Strict connected-source, encrypted-binding, body-free index,
  default-policy, repository-grant, tool-request, decision, and receipt vectors
  accept canonical values and reject unknown fields, unsafe paths, wrong
  protocols, unbounded values, and mismatched authority.
- **A222** — V1.2 imported snapshots remain compatible and V1.3 reflection
  remains closed; connected sources add no migration, model call, autonomous
  memory write, or native-session restoration claim.
- **A223** — Discovery reads metadata only, searches only configured and common
  bounded roots plus owner-selected parents, never follows an escaping symlink,
  never scans the whole home directory, and never connects or indexes silently.
- **A224** — Repository indexing respects Git tracking and ignore rules while
  excluding binaries, dependencies, build outputs, oversized or credential-like
  files, unsafe paths, and direct Git metadata.
- **A225** — Codex and Claude history adapters index only user-visible user and
  assistant text and exclude system/developer instructions, hidden reasoning,
  thinking, tools, results, environment payloads, subagent transcripts, and
  credentials. Repository association is local metadata only.
- **A226** — Originals remain authoritative. The encrypted owner-brain namespace
  stores only hashes, cursors, token postings, safe metadata, and relative
  locators. Retrieval rereads a bounded excerpt and rejects a changed or
  unverifiable hash before provider egress.
- **A227** — Launch reconciliation and one debounced event-driven worker refresh
  connected sources without polling or model use. Watch failure marks a source
  `Needs attention` while conversation remains usable.
- **A228** — Connecting materializes exact current-resident grants and the same
  default applies to future residents. Grant, provider egress, runtime binding,
  and source state are checked before index decryption or original reads;
  revocation, staleness, reconfirmation, and disconnect take effect next turn.
- **A229** — The `luca-repositories` bridge exposes only the frozen nine tools,
  accepts source IDs and relative paths, rejects traversal, symlink escape,
  direct `.git` mutation, disconnected sources, and stale grants, and exposes no
  push, remote mutation, PR, or credentialed Git operation.
- **A230** — Reads are automatic. Patch, command, and local commit authority use
  desktop-owned session capabilities and exact permission scopes. Decisions,
  capabilities, and payloads never enter relay events, source indexes, provider
  context, descendants, or logs, and native resident configuration is unchanged.
- **A231** — The Brain surface presents Repositories, Codex, Claude Code, and
  Files as a quiet connection inventory with one-action primary flows, one
  plain-language consent, and complete loading, empty, error, keyboard, focus,
  reduced-motion, and screen-reader states. Detailed grants, imports, refresh,
  exclusions, and provenance remain available without dominating the page.
- **A232** — The exact signed checkpoint discovers and connects disposable
  repository and synthetic session fixtures, refreshes incrementally, proves
  recall and scoped repository work with real Hermes and OpenClaw residents,
  disconnects immediately, persists across relaunch, and leaves protected
  native files unchanged.

## V1.3 — Resident Reflection

- **A301** — Valid reflection request/result vectors pass and wrong-resident,
  substituted binding, stale epoch, oversized body, excessive mutation,
  prohibited target, and owner-pin conflict vectors fail closed.
- **A302** — Only an explicit owner action starts model-assisted reflection in
  V1.3; a suggestion never starts a model call.
- **A303** — Reflection uses the exact resident runtime/model with no tools,
  permissions, signing, publication, or proactive message path.
- **A304** — The request contains only the resident's bounded handoff, active
  notebook, signed evidence, and pinned corrections.
- **A305** — The result returns `no_change` or one resident-authored reflection
  plus bounded resident-notebook mutations committed atomically.
- **A306** — Reflection cannot alter identity, relationship, conviction,
  personality, runtime, model, native memory, owner brain, grants, tools,
  permissions, routing, messages, or owner-pinned corrections.
- **A307** — User turn, owner cancellation, runtime exit, invalid output, stale
  epoch, locked store, and restart leave prior continuity intact and chat usable.
- **A308** — Reflection disclosure is intentional; Activity and ordinary chat
  expose body-free state only. Before/after revisions, evidence, rollback, and
  authorship remain inspectable.
- **A309** — Real Hermes and OpenClaw residents each complete a notebook review,
  preserve source authorship and isolation after relaunch, and support
  `no_change` as an honest outcome.
- **A310** — No timer scheduler, proactive DM, tool-enabled research, cross-agent
  reflection, or hidden background cognition is reachable.

## Release and permanent regressions

- **A401** — Focused Rust, Tauri, frontend, and Playwright checks pass for the
  changed release surface.
- **A402** — The rebuilt signed macOS app passes its release demo with real
  Hermes and OpenClaw residents.
- **A403** — Messaging, mixed rooms, permissions, cancellation, attachments,
  search, unread state, restart recovery, and exactly-once finals remain correct.
- **A404** — Native Hermes/OpenClaw configurations, credentials, memory files,
  workspaces, and schedules are not modified.
- **A405** — The full repository gate is run once after visual approval and
  focused/native checks, with a signed release verdict and updated handoff.

## Visual review targets

At the relevant frontend task, inspect at 1440x900, 1280x800, 1024x768, and
390x844 where the existing shell supports the responsive surface. Verify:

- no overflow, clipping, or layout shift;
- complete keyboard/focus and reduced-motion behavior;
- readable loading/empty/error/disabled states;
- source and revision controls are understandable without color;
- private reflection requires deliberate disclosure;
- the main conversation remains the dominant focal plane.
