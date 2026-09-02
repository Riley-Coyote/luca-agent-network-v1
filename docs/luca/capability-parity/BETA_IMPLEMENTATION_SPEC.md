# Polyphonic beta capability experience implementation specification

Date: 2026-09-01

Status: **approved for implementation**

Approved by Riley: 2026-09-01

Branch: `codex/unified-dev`

Audit baseline: `594202fe853ab4fc5610440f7dd4aedae8794d36`

Architecture authority:
[`../RUNTIME_FIRST_CAPABILITY_CONTRACT.md`](../RUNTIME_FIRST_CAPABILITY_CONTRACT.md)

Broader backlog:
[`../POLYPHONIC_RESIDENT_CAPABILITY_PARITY.md`](../POLYPHONIC_RESIDENT_CAPABILITY_PARITY.md)

This specification freezes the smallest beta-visible capability release. It
does not replace the broader parity backlog. When this document and the broader
`BUILD_SPEC.md` differ, this document governs the beta implementation only.

## 0. Approval sheet

Approval authorizes implementation of B0-B6 and nothing in the deferred list.

| Lane | Included outcome | Decision |
|---|---|---:|
| B0 — Safety and session hygiene | Safe permission defaults and explicit native-session purposes | Include |
| B1 — Live capability truth | Exact resident/session facts replace runtime-label assumptions | Include |
| B2 — Skills and commands | Visual selection and `/` activation through verified runtime commands | Include |
| B3 — MCP connections | Natural runtime use plus optional visual preference for available connections | Include |
| B4 — Work Tray | One premium current-work surface over existing activity authorities | Include |
| B5 — Runtime delegation | Truthful nested activity for runtime-native subagents, without fake child controls | Include |
| B6 — Explicit runtime tasks | User-approved Codex and Claude root tasks launched from conversation | Include |

Approval phrase:

```text
Approve the Polyphonic beta capability experience specification. Implement B0-B6 and keep all listed deferrals out of scope.
```

## 1. Problem statement

Polyphonic can already launch the user's real runtimes, stream resident
responses, discover installed Skills, expose MCP configuration, narrate tool
activity, stop managed turns, and retain artifacts. Those foundations are
currently fragmented and sometimes overstate what is proven: Skill handoff is
prompt text, capability manifests are declared rather than live-verified,
native work has no unified task projection, internal cognition creates visible
provider sessions, and managed tool permissions default to silent approval.

For an early beta, users need the capabilities they notice immediately:
natural Skills and MCP use, understandable multi-step work, runtime-native
delegation, and the ability to ask a resident to launch a bounded Codex or
Claude task while remaining in Polyphonic. The release must expose existing
runtime capability rather than rebuild it.

## 2. Goals

1. A user can find and activate a verified Skill visually or with `/` without
   leaving conversation.
2. A resident can naturally use an available MCP connection, while the user
   can inspect which provider actually ran and what authority it had.
3. Long or multi-step work is visible in one calm Work Tray with truthful
   progress, stop, retry, failure, and output states.
4. Runtime-native subagent work is legible without being presented as another
   Polyphonic resident or as more controllable than it is.
5. A user can ask a resident to launch one explicit Codex or Claude root task,
   approve it in Polyphonic, watch it run, stop it, and receive its result in
   the initiating conversation.
6. Internal cognition and ordinary resident work no longer masquerade as
   explicit user tasks in Brain or Polyphonic's runtime-session catalogue.
7. No tool action silently receives broader authority than the user selected.

## 3. Non-goals and deferrals

The beta does not include:

- bidirectional transcript synchronization or native-session continuation;
- a universal **Open in Codex/Claude** action or a promise that provider tasks
  appear in a vendor desktop application;
- per-subagent steering, messaging, retry, or cancellation;
- cross-resident task orchestration or resident teams;
- restart-safe background execution, automations, schedules, or recurring jobs;
- a Skill marketplace, installer, editor, or new plugin format;
- new hosted MCP, OAuth, connector, search, browser, image, or computer-use
  providers;
- copying provider-owned Skill or MCP configuration into a Polyphonic profile;
- a new relay event family, general backend task engine, or duplicate
  transcript store;
- raw chain-of-thought, hidden prompts, tool arguments, credentials, or private
  provider envelopes in conversation or the Work Tray.

These remain compatible future lanes but may not enter implementation without
an approved scope amendment.

## 4. Frozen product laws

1. The selected runtime remains the worker; Polyphonic owns discovery,
   permission mediation, visible activity, cancellation, recovery, receipts,
   and result presentation.
2. The user's existing runtime installation, profile, authentication, Skills,
   plugins, MCP configuration, approval policy, and sandbox remain
   authoritative. No second profile is created.
3. `declared` and `discovered` are not `live_verified`. Unknown or loading is
   not unsupported.
4. Context changes working material, never authority.
5. A Skill Library entry is not callable until the exact resident session
   advertises or proves a compatible invocation path.
6. Selecting an MCP connection expresses a provider preference; the completed
   receipt names only the connection or tool the runtime actually used.
7. Runtime-native subagents are temporary runtime workers, not residents,
   participants, or signed A2A identities.
8. Only an explicit task proposal approved by the user is an explicit runtime
   task. Ordinary resident turns and continuity work are never relabeled as one.
9. Native-app visibility is a tested provider property, not an architectural
   assumption.
10. Existing response streaming, messaging, Brain/context, continuity,
    identity, artifacts, and resident-room behavior remain intact unless this
    spec names an exact change.

## 5. User stories

- As a user chatting with a resident, I want `/` to show commands and Skills
  that this resident can actually use so I can activate one without memorizing
  syntax.
- As a user who prefers visual controls, I want the same Skills and available
  connections in a searchable picker so slash commands are optional.
- As a user, I want residents to choose appropriate MCP tools naturally so I
  do not have to micromanage every tool call.
- As a user, I want to see what long-running work is doing, how far it has
  progressed when the runtime knows, and how to stop it.
- As a user, I want to ask my resident to send a bounded task to Codex or Claude
  and approve the exact target and working folder before it begins.
- As a user, I want the result to return to the conversation where I requested
  it, without switching applications.
- As a user, I want failures to name the resident, capability, provider, and
  repair path without losing my message or implying work succeeded.
- As a user returning after a restart, I want unfinished work labeled
  **Interrupted**, not silently shown as active or complete.

## 6. Experience specification

### 6.1 Composer capability palette

One palette serves commands, Skills, and MCP connections.

- Typing `/` as the first non-whitespace composer character opens the palette.
- The existing composer `+` menu gains one **Skills and tools** entry that
  opens the same palette without inserting `/`.
- The palette is scoped to the selected resident. Before a resident is
  selected, it may show the catalog but activation remains disabled.
- Sections appear in this order: **Commands**, **Skills**, **Connections**.
- Search matches name and bounded description. Keyboard arrows move, `Return`
  selects, `Escape` closes, and focus returns to the composer.
- The palette shows one of: **Ready**, **Needs setup**, **Unavailable**, or
  **Checking**. It never converts Checking into Unavailable.
- No pinning, favorites, marketplace, installation, or editing is included.

#### Commands

- Commands come from the live ACP `available_commands_update` handshake.
- The composer uses `/` to open the palette, but invocation preserves the
  provider's canonical prefix. Claude commands commonly begin with `/`; Codex
  Skills currently advertise commands such as `$skill-name`.
- Selection sends the exact canonical provider command as the first prompt
  block. The managed host must replace its slash-only pass-through check with
  an exact advertised-command check that accepts `/` or `$` only when the live
  session advertised that full command name.
- Arbitrary dollar-prefixed prose is never promoted to a command.
- A command that disappeared since discovery fails before execution and keeps
  the user's draft.

#### Skills

- The existing Skill Library remains the durable browse/detail surface.
- A Library **Use** action carries the opaque `skillId` and target resident to
  the composer; it never carries name alone.
- At selection and again at send, Polyphonic resolves the exact catalog entry
  and the resident's live invocation facts.
- When a provider advertises a canonical command for that Skill, Polyphonic
  invokes that command exactly.
- Catalog-to-command mapping requires runtime family, normalized Skill name,
  and unambiguous live command identity. Duplicate installed names remain
  browsable but cannot be activated until the user selects a unique source or
  the provider exposes a unique identifier.
- When the built-in Polyphonic agent exposes its typed `load_skill` operation,
  it receives the exact validated Skill identifier.
- When neither structured path is proven, the Skill may remain browsable but
  **Use** is disabled with a specific explanation. A prose request is never
  reported as verified Skill execution.
- Skill contents never enter the public message, receipt, or Work Tray.

#### MCP connections

- Residents continue choosing available MCP tools naturally from their
  runtime session.
- The visual picker shows only connections that are already configured for the
  exact runtime or granted to the exact resident.
- Selecting a connection attaches a visible draft chip such as **Use Linear**.
  It is a preference, not a promise that a tool will be called.
- The Work Tray and result receipt identify the actual connection/tool only
  after the runtime emits a corresponding tool call.
- Setup, secret entry, grant changes, and revocation remain in Settings.
- When a grant change requires a fresh runtime session, Settings says so and
  offers **Restart resident session**; the composer never restarts it silently.

### 6.2 Work Tray

The Work Tray is a projection over existing work authorities, not a fifth
execution or persistence system.

#### Placement

- A compact Work Tray sits immediately above the composer inside the message
  column.
- It is absent when no current item needs attention.
- Clicking it expands upward in place to a maximum of 40% of the message-pane
  height. It does not occupy or replace the conversation's right drawer.
- **Open activity history** may navigate to the existing resident Activity
  surface; the Tray does not copy transcript history.
- On narrow panes it becomes an overlay anchored above the composer and must
  not remove composer side gutters or create horizontal scrolling.

#### Compact state

The compact row shows:

- acting resident;
- current safe activity label;
- task/provider badge only for explicit runtime tasks;
- elapsed time only after the existing one-minute threshold;
- completed step count when known; and
- the exact available action: Stop, Retry, Review, or Dismiss.

No fake percentage is shown. `3 of 5` appears only when the provider supplied a
stable total. Otherwise the UI shows completed steps without a denominator.

#### Expanded state

The expanded Tray shows:

- task summary and provider;
- ordered public-safe steps with `queued`, `active`, `done`, or `failed` state;
- nested runtime delegation when truthfully detected;
- permission requests in sequence;
- outputs linked through existing artifact receipts;
- failure or attention reason; and
- exact source-routed controls.

Raw thought bodies, prompts, commands with secrets, tool arguments, tool
results, and private transcript envelopes never enter this view.

#### Settlement

- When a normal resident turn publishes its signed final, its live Tray item
  retires and the existing answer row retains duration/output receipts.
- A successful explicit task remains for four seconds, collapses to its
  receipt, then leaves the active Tray.
- Failed, interrupted, denied, or needs-attention items remain until Retry,
  Review, or Dismiss.
- Dismiss hides presentation only. It never cancels running work.
- Stopping keeps partial streamed text and produces no false final answer.

### 6.3 Runtime-native delegation

- Native delegation remains provider-owned.
- If the adapter exposes no stable child identity, the Tray shows one grouped
  step such as **Delegating work** and an observed count when available.
- If stable child identity and ancestry are live-verified, the Tray may show
  nested child rows with bounded labels and status.
- The beta exposes root Stop only. Child controls remain hidden even if a
  provider happens to expose them.
- Child activity never creates a resident avatar, DM, A2A transcript, Brain
  source, or participant entry.

### 6.4 Explicit Codex and Claude tasks

Explicit runtime tasks have two entry paths:

1. A user selects **Run task** or `/task` and chooses Codex or Claude.
2. A resident calls the Polyphonic-owned `propose_runtime_task` tool after a
   natural request such as “send this to Codex.”

Both paths produce the same confirmation card before execution. The card shows:

- target runtime;
- concise task summary;
- working folder or project;
- permission mode;
- initiating resident; and
- **Run** and **Cancel**.

No task starts from model intent alone.

#### Target and working folder

- Beta targets are `codex` and `claude_code` only.
- The target must already be installed, authenticated, and live-ready.
- The working folder defaults to the conversation's explicit project context.
- Without project context, the user must choose a previously approved project
  or working folder. Home, workspace root, and inferred folders are forbidden.
- The user may edit target or folder before Run.

#### Execution

- Run starts one new provider root session through the existing managed runtime
  host and existing user profile.
- The session purpose is `explicit_runtime_task`, distinct from resident chat
  and continuity work.
- The task cannot itself invoke `propose_runtime_task`; recursive dispatch is
  rejected.
- Provider activity flows into the Work Tray through existing managed and
  observer events.
- Stop interrupts the root provider turn.
- The completed provider result returns as the tool result to the initiating
  resident, allowing that resident to synthesize the final conversational
  response.
- The task receipt links the initiating message, provider session reference,
  result status, duration, and artifact receipts without duplicating prompt or
  result bodies.
- If the initiating resident turn cannot resume, Polyphonic renders a durable
  task result card in that conversation and marks resident synthesis
  unavailable; it does not discard the provider result.

#### Provider claims

- Codex uses the existing Codex ACP/App Server-backed runtime. Appearance in
  Codex desktop is reported only after installed acceptance proves it for the
  exact adapter version. The beta has no deep link or native Open action.
- Claude uses the existing Claude Code ACP/Agent SDK-backed runtime. The task is
  described as **Runs with Claude Code** and remains managed from Polyphonic;
  no Claude desktop-history claim is made.

## 7. Internal contracts

Names may follow existing repository conventions, but the following semantics
are frozen.

### 7.1 `ResidentSessionCapabilityV1`

```text
residentPubkey
runtimeFamily
runtimeVersion?
adapterVersion?
sessionId?
observedAt
capabilities[]:
  capabilityId
  provider: runtime | skill | mcp | polyphonic
  support: declared | discovered | live_verified | unavailable | unknown
  configuration: configured | needs_attention | absent | not_applicable
  authority: granted | approval_required | denied | runtime_managed
  execution: available | active | failed | cancelled | unavailable | unknown
  evidenceKind
  reasonCode?
commands[]:
  canonicalName
  description
  inputHint?
nativeTaskFacts:
  rootDispatch
  childEvents
  stableChildIds
  rootCancel
  nativeVisibility
  nonpersistentInternalSessions
```

- One native source feeds renderer projections.
- Static manifests seed `declared` only.
- Facts are scoped to owner, resident, runtime binding, session epoch, and
  adapter version.
- A session recreation, adapter change, grant change, or runtime reconnect
  invalidates session facts.

### 7.2 `CapabilitySelectionV1`

```text
kind: command | skill | mcp_preference | runtime_task
residentPubkey
runtimeFamily
catalogId
canonicalName
catalogGeneration
selectedAt
```

- Selection is renderer/native draft state, never an authority grant.
- Send revalidates the opaque catalog ID, generation, resident, runtime, and
  live capability fact.
- Missing or changed selections remain in the draft with a repair message.

### 7.3 `WorkItemProjectionV1`

```text
workId
authority: managed_turn | observer_turn | background_task | runtime_task
parentWorkId?
scope: owner + optional conversation/project/resident
residentPubkey?
provider?
conversationId?
turnId?
dispatchReceiptId?
sessionEpoch?
providerSessionId?
state:
  queued | waking | active | waiting_permission | waiting_input |
  writing | finalizing | stopping | succeeded | stopped | failed |
  interrupted | needs_attention
sourcePhase?
summary
safeSteps[]
startedAt
updatedAt
completedAt?
capabilities:
  canStop | canRetry | canReview | canDismiss | canOpenConversation
outputs[]
attentionReason?
persistence: ephemeral | archived_observer | durable_receipt
```

- This is a renderer projection assembled from existing managed presentation,
  observer, background-task, and artifact stores.
- Artifact receipts are output relations, not competing work items.
- Source authority owns commands; projection booleans never invent control.
- Precedence is local control-in-flight, exact managed presentation, observer
  activity, then compatibility fallback.

### 7.4 `RuntimeSessionPurposeV1`

Every managed provider session records one purpose before prompting:

```text
resident_conversation
continuity_internal
explicit_runtime_task
```

The local record contains an app-owned ID, resident, runtime binding, creation
time, provider session ID when known, and terminal/cleanup status. It never
contains credentials or transcript bodies.

- `resident_conversation`: reusable per conversation; excluded from the
  Polyphonic runtime-session context catalogue. Archive when the host retires
  the session if the provider supports archive.
- `continuity_internal`: never visible in Brain or runtime-session catalogues.
  Use provider non-persistence when live-verified; otherwise archive on
  terminal when supported and retain only the exclusion record.
- `explicit_runtime_task`: retained as user work and eligible for normal
  provider-history discovery. It is never auto-deleted.

Provider cleanup is recoverable and idempotent. Failure to archive never
deletes provider data; it records `cleanup_needs_attention` and remains
excluded from Polyphonic catalogues where required.

## 8. Permission and authority contract

1. Change the managed runtime default from `bypassPermissions` to the
   runtime's normal permission mode.
2. Remove the build-velocity branch that silently chooses `allow_once`.
3. An explicitly selected Full Access mode remains allowed only when the user
   chose it in resident/runtime settings. The active mode is visible in the
   task confirmation and Work Tray.
4. Runtime-owned tool requests remain governed by the runtime's native policy.
5. Polyphonic-managed MCP availability requires an exact resident grant, but a
   connection grant does not authorize destructive or external side effects.
6. High-impact, destructive, external-communication, and credential actions
   require confirmation every time and cannot receive a durable allow grant.
7. Denial, timeout, app close, resident restart, or stale request identity
   produces no side effect and a distinct visible outcome.
8. Permission cards contain display-safe metadata only.

## 9. Failure, retry, cancellation, and restart rules

- Capability unknown: keep Checking until handshake completes; offer Retry
  only after a bounded timeout or explicit probe failure.
- Skill moved/changed: retain draft, mark unavailable, offer Refresh Skills.
- MCP bootstrap missing/rejected: name the connection/runtime and offer
  Restart resident session or Open Connections as applicable.
- Permission denied/expired: stop before the side effect and preserve the task
  or draft.
- Runtime unavailable: do not switch provider automatically.
- Task failure: retain safe steps and outputs already committed; Retry creates
  a new root task linked to the failed receipt and never reuses an uncertain
  side effect.
- Stop: interrupt the exact root turn, preserve partial visible output, and
  mark Stopped.
- App restart: in-memory active items rehydrate as Interrupted from existing
  durable operational receipts. The beta does not resume execution.
- Archive/history unavailable: show an explicit unavailable state; never show
  an empty history as proof that no work occurred.
- Resident synthesis failure after task completion: retain the task result
  card and offer Retry synthesis without rerunning the provider task.

## 10. Existing implementation disposition

### Adopt unchanged

- runtime discovery, binding, existing-profile authentication, and spawn;
- response streaming and signed-final reconciliation;
- managed presentation frame validation and public-safe activity vocabulary;
- observer live/archive stores;
- exact root turn cancellation;
- artifact receipts and existing file/image/preview presentation;
- Skill catalog containment and bounded reads;
- MCP Keychain custody, exact resident grants, and anonymous inherited
  bootstrap transport.

### Adapt

- Skill Library **Use** must carry opaque identity and live compatibility;
- ACP `available_commands_update` must feed the composer palette;
- Activity Shelf becomes the compact Work Tray;
- existing Activity transcript provides history/review, not a duplicate store;
- background-task cards project through the Work Tray visual grammar while
  their original owner retains execution authority;
- runtime manifests become declared fallback beneath live capability facts;
- managed runtime sessions gain explicit purpose and exclusion/cleanup state.

### Leave inactive or defer

- generic background-task persistence as a universal task service;
- raw ACP rail/thought/tool payloads in conversation UI;
- legacy `PendingReplyRow` elapsed/control behavior;
- provider-native child controls;
- native transcript resume/open paths;
- all hosted provider expansion lanes.

## 11. Ordered implementation and commit boundaries

Each phase is independently reviewable. Later phases do not begin if an
earlier safety or truth gate fails.

1. **Control and fixtures**
   - Record approval, exact baseline, dirty-file exclusions, installed runtime
     and adapter versions, and test fixtures.
   - Commit: `docs/test(capabilities): freeze beta execution contract`
2. **Permission safety**
   - Restore normal runtime permission defaults and remove silent auto-allow.
   - Add denial, timeout, explicit Full Access, and high-impact tests.
   - Commit: `fix(runtime): require explicit managed tool authority`
3. **Session purpose and hygiene**
   - Add purpose records, catalogue exclusions, idempotent provider cleanup,
     and interrupted cleanup recovery.
   - Commit: `fix(runtime): isolate internal managed sessions`
4. **Live capability truth**
   - Add one native capability projection and invalidate it on relevant
     runtime/session changes.
   - Commit: `feat(capabilities): add live resident capability facts`
5. **Composer palette and Skills**
   - Wire advertised commands, exact Skill identity, visual selection, slash
     activation, `/` and verified `$skill` first-block pass-through,
     stale-selection failure, duplicate-name handling, and accessibility.
   - Commit: `feat(chat): add verified skills and command palette`
6. **MCP conversation exposure**
   - Add available-connection preferences, visible bootstrap/rejection state,
     actual-provider receipts, and fresh-session repair action.
   - Commit: `feat(chat): expose resident MCP connections`
7. **Work Tray projection**
   - Add normalized selectors, compact/expanded UI, exact source controls,
     outputs, settlement behavior, responsive/reduced-motion states, and
     privacy tests.
   - Commit: `feat(chat): unify resident work in Work Tray`
8. **Native delegation projection**
   - Add grouped/nested provider-owned delegation under live capability facts,
     with root-only control.
   - Commit: `feat(activity): surface runtime-native delegation`
9. **Explicit runtime tasks**
   - Add proposal tool and `/task`, user confirmation, bounded Codex/Claude root
     launch, Work Tray correlation, result return, root stop, and durable
     receipt/interrupted state.
   - Commit: `feat(tasks): dispatch explicit runtime work`
10. **Installed acceptance and cleanup**
    - Run source gates, rebuild/relaunch the existing signed Dev app, execute
      the installed matrix, perform visual review, and publish exact verdicts.
    - Commit only deterministic test/evidence corrections required by the
      candidate; do not commit generated user data.

No implementation phase may silently absorb a deferred feature. A requested
scope addition requires removing another lane or amending and reapproving this
specification.

## 12. Workstreams and file ownership

At most three delegated lanes may run beside the integration owner. Recursive
delegation is not allowed.

| Owner | Primary scope | Must not independently change |
|---|---|---|
| Integration owner | Shared contracts, phase order, shared files, commits, installed app, final verdict | Nothing delegated without exact boundaries |
| Native/runtime lane | Permission defaults, session purpose, capability facts, provider launch/cleanup, focused Rust tests | Chat visuals, identity, relay protocol, Brain content |
| Conversation UI lane | Palette, draft selections, Work Tray, accessibility, frontend tests | Native capability truth, provider config, execution authority |
| Verification lane | Fixtures, E2E, provider matrix, privacy/failure assertions | Product behavior except approved test seams |

Shared files—including command registration, common API types, primary
composer/message surfaces, and Work Tray projection types—remain integration
owner files unless an explicit short ownership window is recorded.

## 13. Verification and acceptance

### 13.1 Source gates

- focused Rust tests for permission, capability truth, session purpose,
  exclusion, cleanup, dispatch, cancellation, and retry;
- frontend tests for palette search/keyboard behavior, stale selections, Work
  Tray projection precedence, deduplication, exact control routing, outputs,
  settlement, and archive unavailable state;
- privacy tests proving no thought body, prompt, tool arguments/results,
  credential, Skill body, or MCP secret enters Work Tray or receipts;
- existing messaging reliability, streaming, activity shelf, operational
  failure, Brain session catalogue, MCP settings, Skill Library, artifact, and
  continuity regression suites;
- formatting, typecheck, production/E2E build, and `git diff --check`.

### 13.2 Installed runtime matrix

Use the existing signed Dev app and existing profiles only.

#### Codex

- discover exact CLI and adapter versions;
- verify command/Skill/MCP facts against the live session;
- run one selected Skill where available;
- run one granted MCP tool where available;
- approve and deny representative tool requests;
- launch, observe, stop, retry, and complete one explicit task;
- record whether the task appears in Codex desktop without making it a beta
  requirement;
- verify resident and continuity sessions do not appear in Polyphonic's
  runtime-session catalogue;
- verify explicit tasks remain discoverable as user work.

#### Claude Code

- repeat applicable Skill/MCP/permission/task checks;
- verify task completion inside Polyphonic without a Claude desktop-history
  claim;
- verify continuity sessions remain excluded from Polyphonic catalogues.

#### Hermes and OpenClaw

- ensure existing residents still launch and chat normally;
- capability rows may remain Unknown or Unavailable when no live adapter proof
  exists;
- they do not block B6, which targets Codex and Claude only.

### 13.3 Visual and accessibility acceptance

- inspect dark and light themes at ordinary and narrow desktop widths;
- verify 200% text zoom without clipped controls or horizontal scrolling;
- verify keyboard-only palette, confirmation, Tray, permission, and Stop flows;
- verify reduced motion and increased contrast/transparency behavior;
- confirm one visible current-work surface rather than duplicate thinking,
  shelf, and task cards;
- confirm streaming text remains stable while steps and permissions update;
- confirm composer geometry and side gutters never shift when the Tray opens.

## 14. Success thresholds

The beta lane is successful when:

- 100% of installed acceptance attempts report a truthful terminal result;
- zero tool calls receive silent default approval;
- zero continuity/internal sessions appear in Polyphonic Brain or runtime
  session catalogues;
- zero capability selections silently change resident, runtime, Skill, MCP
  connection, project, or permission mode;
- every started explicit task has a visible active state and effective root
  Stop;
- every terminal task produces exactly one success, failure, stopped, denied,
  or interrupted receipt;
- existing response streaming and signed-final publication regressions remain
  at zero in focused suites;
- privacy tests find zero forbidden bodies or secrets in public presentation;
- no second runtime profile, duplicate task engine, or hosted provider is
  introduced.

Usage/adoption metrics are deferred until beta telemetry has its own approved
privacy contract. Source or UI analytics may not be added under this spec.

## 15. Definition of beta capability experience complete

The work is complete only when B0-B6 are implemented on one exact source
commit, all source gates pass, the existing signed Dev app has been rebuilt and
retested, Codex and Claude complete their applicable installed matrices, and
the final report records:

- exact app commit and bundle;
- runtime and adapter versions;
- row-level verified, unavailable, or not-applicable outcomes;
- permission and session-hygiene evidence;
- Skill, MCP, Work Tray, delegation, and explicit-task results;
- visual/accessibility evidence;
- native Codex visibility observation as informational only; and
- every remaining deferral.

Passing source tests alone is not completion. A runtime capability that cannot
be installed-tested remains honestly unavailable or unverified; it is never
converted into a pass.

## 16. Blocking questions

None. All product and architecture decisions required to begin B0 are frozen
above. Unexpected provider limitations are handled by the stated truth and
failure rules rather than by inventing a substitute during implementation.
