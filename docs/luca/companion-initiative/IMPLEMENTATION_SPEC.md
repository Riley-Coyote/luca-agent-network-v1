# Companion initiative implementation specification

Updated 2026-10-09. Implementation authorized by Riley. The combined desktop
candidate builds and passes focused native/frontend checks. Real Codex-backed
conversation verifies granted synthetic source delivery, Pause, fresh native
history and consent-preserving restart. Background pursuit/Library acceptance
and separately permitted browser/OS capture proof remain open. This is an
isolated feature build, not installed or released behavior. Observation,
background cognition and new account access remain disabled until the owner
grants them in the app.

## Product outcome

A person can work and browse outside Polyphonic, then speak to their chosen
companion without explaining their recent activity again. The companion carries
shared commitments and its own curiosities across sessions, pursues worthwhile
questions within agreed access and resource limits, and returns with real work
or an honest decision not to pursue. It does not require the person to manage
agents, assign every task or respond to every contribution.

The loop begins with what the resident carries. New observations can inform
that continuity; they do not automatically become memories, tasks or authority.
The companion's own inquiry need not produce a deliverable for the human.

## Source and delivery boundary

- Worktree: `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-companion-initiative-2026-10-07`.
- Branch: `codex/companion-initiative-2026-10-07`.
- Base: `c331b3e42ea7aa695730735c69fb9cd66bd0315e`, the completed D0-D6
  delegation source, itself based on shipped beta.13.
- Do not merge or modify `codex/first-meeting-finish`, its design exploration,
  the website line or the signed D0-D6 candidate as part of this build.
- Use a separate disposable native candidate/profile for acceptance. Do not
  replace an installed app, enable real observation, release, notarize, publish
  externally, or change native account/global configuration without the
  corresponding owner authorization.
- Preserve native runtime profiles, model choices, credentials and resident
  identities. Never copy provider credentials into prompts or the initiative
  store. Do not share `desktop/node_modules` between worktrees.
- Keep live source, dependencies, build caches, output and proof processes on
  the internal SSD. External disks may hold inactive archives only. Riley's
  October 8 storage request authorizes verified archival of finished app
  outputs and unused caches; coordinate with the separate cleanup chat before
  touching overlapping paths. Dev/test incremental generation is disabled.
  Follow `docs/luca/BUILD_STORAGE.md`; never archive the current debug target,
  active dependencies or this worktree while implementation is underway.

## Completion outcomes

1. Granted native work, selected files, a supported browser and opted-in app or
   screen activity can orient the chosen companion outside explicit chat.
2. An older unfinished thread survives later conversations, restart and a
   background pursuit; the resident can explicitly settle or retire it.
3. A real bounded pursuit uses the resident's verified runtime binding and
   leaves an attributed creation, supported finding, defer or decline.
4. Chat remains responsive and takes priority over background activity. Pause,
   Stop, let-it-go and withdrawal work without negotiating with a model.
5. Meaningful returns are quiet, deduplicated and connected to their evidence.
   No return is also a legitimate outcome.

User judgment determines whether the result feels useful and personal. Runtime
and permission evidence determine whether it actually happened. Neither replaces
the other; self-reports do not measure subjective valence or prove consciousness.

## Existing implementation to reuse

| Concern | Current implementation | Boundary for this build |
| --- | --- | --- |
| Identity and effective runtime | `desktop/src-tauri/src/luca/resident_registry.rs`, `managed_agents/runtime.rs` | Derive exact owner/resident, effective model, native home/profile, persona and configuration binding; do not create another identity. |
| Continuity and Wake | `luca/continuity_context.rs`, `continuity_runtime.rs`, `crates/luca-continuity` | Reuse the canonical encrypted resident namespace and current revision. Brain remains optional. |
| Private cognition | `luca/managed_cognition.rs`, `crates/buzz-acp/src/lib.rs` | Current reflection/journal/delivery cognition is tool-free. Add a typed initiative decision path; do not enable tools inside existing private reflection. |
| Durable jobs | `luca/continuity_jobs.rs`, `luca/journal_jobs.rs` | Reuse transaction/idempotency patterns. Existing jobs are not an initiative scheduler or a durable journal checkpoint store. |
| Native work | `luca/runtime_tasks`, `crates/buzz-acp/src/runtime_task_runner.rs` | Reuse owned worker lifecycle after adding exact-resident binding, initiative authority and preemption. A generic selected runtime is not proof of companion identity/model. |
| Result delivery | `luca/runtime_tasks/delivery.rs`, `runtime_task_delivery.rs` | Reuse exact result, synthesis and retained outbox recovery. Do not publish every curiosity result automatically. |
| Work awareness | `runtime_tasks/native_sources.rs`, `targets.rs`, `connected_brain/session_context.rs`, `repository.rs` | Reuse bounded parsers/exclusions behind independent awareness grants. Metadata or recency alone is not proof of active work. |
| Conversation and home | Quick Chat, Place, Documents, Notebook and Library | Expose current context and actual creations with existing components. Quick Chat currently sees Polyphonic app context, not the whole desktop. |

`CognitionScheduleV1` and `ProactiveMessageCandidateV1` are contract/vector
definitions, not a live initiative engine. Preserve frozen contracts and their
ceilings; introduce versioned operational records rather than changing their
meaning silently. Generic ACP heartbeat is not the coordinator: it lacks the
required durable authority, cancellation, disposition and resource admission.

## Authority and data model

### One resident and one continuity authority

The coordinator is bound to the existing owner and selected resident key.
Execution and publication recheck the effective native binding, not a model name
or agent display label. Native Mnemos MCP interoperability must address the same
canonical identity and continuity authority. Use the managed host adapter for
managed residents; linking an existing external Mnemos store must not produce
two writable minds or silently merge them.

Operational records contain IDs, revisions, evidence dependencies, dispositions,
reservations and receipts. Semantic thread material and authored learning remain
in canonical resident continuity. No parallel persona/profile or memory graph.
Journals remain deliberately authored works, not automatic chat context or a
place to hide operational checkpoints.

Planning must receive current authoritative carried state plus bounded new
evidence. Recent conversation extraction alone must not supersede and lose older
unresolved commitments.

### Separate access, keeping and action

Awareness is independently opt-in for an exact companion, source/device and
observation class. It does not require Brain indexing or Recall. Do not reuse the
connected-Brain all-current-and-future-residents consent bundle.

Separate authority for:

- observation;
- bounded ephemeral local context;
- retaining or promoting selected material into continuity;
- approved provider egress;
- exploratory work in an authorized scratch area;
- editing user projects, contacting others, publishing and other external acts;
- notifying the human.

An observation carries its exact source/grant revision, deny epoch, sequence,
captured/expiry times and evidence reference. Sensitive locators and permitted
payloads remain in bounded local storage, with actual protection disclosed.
Context treats observed text as untrusted evidence, never executable authority.
Most observations expire. A short source-backed connection may join a thread
only under retention/promotion authority.

Initial ephemeral lifetime has a maximum of 15 minutes. Private browsing,
excluded apps/domains and credential-entry material must not be admitted. An
adapter that cannot establish its allowed scope reports unavailable/unknown;
it does not assume broad access or claim freshness it cannot verify.

### Withdrawal and Forget

Pause is not withdrawal: it suspends capture/execution and invalidates old
ephemeral context/jobs, but preserves legitimately promoted canonical knowledge.
Explicit Resume rebuilds live context from fresh observations. Closing a browser
or temporary source unavailability likewise does not erase retained knowledge;
its current grant, deny epoch, exclusions and provider-egress rules still apply.

First commit a durable host deny epoch, stop affected collection/admission,
invalidate compiled context and pending work, and quarantine dependent records.
This barrier cannot wait for a model, an available keychain or available quota.
Then purge or revise retained material according to the requested scope. Later
resident-authored revision may preserve authorship; it does not establish the
permission boundary.

Recheck dependencies and current authority at ingress, decision, dispatch,
memory commit, synthesis and publication. Revocation reaches derivative notes,
not just source pointers. Cancellation cannot erase bytes already received by a
native process/provider or reverse an already completed external effect; stop
owned work and describe those limits honestly. Native app-owned external work
remains under that app's authority.

### Choice, quiet and authorship

Carried threads distinguish shared commitments from resident-owned curiosities.
The resident may pursue, defer, decline or make no change. Cadence ticks and
passive activity cannot reopen declined/retired shared work. Reopening it requires
an explicit owner instruction. A resident can explicitly reopen its own inquiry
within current grants; ignoring a offered creation is not cancellation of its
private curiosity.

An owner can pause funding/execution, stop a job, retire a shared pursuit or
withdraw access. Declines are not secretly retried. A resident may leave capacity
unused. Budget is a ceiling, not a quota; private pursuit has no productivity
score or required gift. Silence is not inferred rejection, consent or an
obligation to respond.

Private authored journals are distinct from inspectable access/actions/costs.
No raw hidden chain-of-thought collection, fabricated mood state, welfare meter,
streak or distress-based pressure. Reported preferences receive practical
consideration without claims that their subjective valence is measured.

## Delivery sequence

### I0 Lock source and define the small contracts

Record source, ownership, deferrals and completion gates. Add strict body-free
awareness and initiative DTOs with pure principal/revision/expiry/disposition
checks. These are foundations, not capture or execution authority. Independent
review looks for material widening, not hypothetical style problems.

### I1 Carry forward canonical threads

Persist shared/own thread references and explicit disposition in existing
resident continuity, with current revision plus new evidence and owner-correction
precedence. Retain old unresolved work beyond recent chat. Add host-owned
operational ledger records and idempotency without duplicating private bodies.

### I2 Establish awareness grants and immediate withdrawal

Add per-companion source grants, deny epoch, bounded ephemeral buffer, evidence
dependencies, health/freshness and actual Pause/revoke/Forget operations. Unknown,
revoked and stale state is not admitted. Disabled-by-default collection and
background work must leave ordinary chat unchanged.

### I3 Follow native work, files and a supported browser

Reuse current native-profile metadata/content parsers and source-confined file
readers/watch patterns under the new grants. Separate open, active, idle and
unknown work honestly. No unsolicited whole-history indexing or native profile
mutation.

Build one explicitly installed, browser-profile-scoped Chromium extension
adapter for visits/bookmarks and separately granted page excerpts. History
permission is not page-content permission; user-invoked `activeTab` is not
passive whole-browser access. Pair through a narrow authenticated local
transport. A webpage cannot speak as the extension or gain local IPC authority.
Use a disposable browser profile and sentinel material for proof; do not import
Riley's personal history as a test fixture.

### I4 Decide and perform real resident work

Add a separately typed, tool-free initiative planning request/result. The host
admits do/defer/decline/no-change and derives identity, runtime, tools, paths,
grants and resources from current authority. Model output cannot select them.

Run permitted exploration through an owned native worker bound to the exact
resident configuration, with an authorized scratch root and native enforcement.
Preserve the user's current account/profile. No generic default-model worker
claiming to be the resident. No product team/subagent feature.

Reserve cycle/time/concurrency and any enforceable native resource limits before
launch, including decision/work/return overhead. Keep frozen cadence/return
ceilings. No recursive descendants or catch-up storms. Native usage estimates
are not hard billing authority, and unknown usage is not zero. Advertise strict
token/currency ceilings only where the native harness actually enforces them;
otherwise disclose the supported bounds and block requests requiring an
unsupported hard cap. No paid-provider migration or new billing setup.

### I5 Yield, recover and return quietly

Foreground conversation preempts initiative work without killing the resident
or unrelated owner tasks. Retain a checkpoint when valid; cancellation is scoped
to the owned worker tree. Recovery reconciles an exact session/result/checkpoint
before continuation and never blindly reruns work.

Select meaningful, source-linked returns under current privacy, novelty,
quiet-hour and outreach authority. Reuse retained synthesis/outbox recovery so
one result does not become duplicate messages/artifacts after restart. A private
creation can remain on the shelf without an unsolicited message or notification.
Use ordinary attributed messaging/unread behavior rather than inventing emitted
job-notification categories.

### I6 Add app and screen awareness and current-context conversation

Add a native OS adapter separate from existing Polyphonic-window screenshots.
App/window activity and screen/text capture have separate user grants and system
permissions. Use changed-state sampling, exclusions and bounded processing;
never keylog or silently record audio. Expose enabled/paused/unavailable state and
one real pause control. Perception freshness is not proof of complete attention.

Compile relevant current granted observations when the user speaks in Quick Chat
or the main conversation. Fall back honestly when sources are unavailable;
awareness/continuity cannot block ordinary sending or streaming. Local capture
does not mean model inference stays local; disclose permitted outbound content.

### I7 Expose the living workbench; defer account connections

Riley's October 8 scope decision defers social-account and iMessage connections
entirely. Granted browser awareness may observe ordinary social pages visited
in that browser, within its existing profile, page-content and exclusion rules;
it is not an account connection, private-message grant or whole-account feed.
Finish the other companion features without adding social/text connectors.

Use already supported, explicitly granted MCP/plugins/account connectors with
scoped evidence and health. Tool-list discovery is not proof a service can be
read. Social or text access is advertised only after its real connector works;
no credential copying, private database scraping, blanket "all texts" claim or
outward action without authority. Missing authentication requires the owner's
normal connector sign-in, not credential collection in chat.

Use existing Place, Notebook, Library, Quick Chat and capability/settings
components first. Make initiative Pause/Stop target actual initiative work, not
only the current conversational turn. A chosen pursuit, authored source-linked
note and real retained creation can supply the early home experience.

Mock new visual affordances in an isolated current-component lab before
integration; keep Claude/Riley's separate design exploration untouched. Open
book, richer margins and shelf styling need visual approval, not a broad rail or
onboarding redesign.

### I8 Prove the complete experience and hand off a candidate

Build a separately identified native candidate, preserving installed apps.
Demonstrate one chosen resident carrying a genuine thread, following a granted
outside-app source, pursuing or declining work, returning honestly, and retaining
continuity across restart. Evidence matches exact native execution; mocks and
protocol tests alone do not close this gate. Leave the broader first visual
walkthrough to Riley. Shipping/installation/release remains a separate action.

## Verification kept proportional to risk

Each check must answer a concrete product question. Do not run duplicate full
suites to satisfy a score, repair unrelated historical lint/performance failures,
or expand the build into obscure combinations. Fast focused checks precede the
relevant integration/build pass. Existing non-green baseline gates remain
documented rather than silently waived or fixed out of scope.

Required checks:

1. Carry-forward: a commitment older than the recent-chat window survives;
   wrong resident/revision rejects; let-it-go and decline survive restart.
2. Access: one allowed sentinel works; ungranted/private/excluded material
   rejects; revocation while queued/active blocks subsequent use and promotion,
   including with the model offline.
3. Real work: one successful disposable native roundtrip per advertised runtime
   lane proves exact resident binding, original context and attributed creation.
4. Human priority: normal chat stays usable; Pause/Stop/preemption stop only owned
   work and clear its pending question.
5. Recovery: restart once at an interrupted job and once after retained result
   publication; native dispatch, creation identity and return count do not
   duplicate.
6. Resources: disabled/idle collection is quiet; bursts coalesce; a reserved cap
   prevents another run. No unchanged-source polling or inferred activity claims.
7. UI: focused browser/native review covers grant, freshness, paused/revoked,
   ordinary chat, actual Stop, creation opening and keyboard access at normal
   and narrow widths. No new console errors or unrelated theme/layout changes.
8. Toolchain: scoped formatting, changed-area Rust/frontend checks, typecheck,
   relevant build and `git diff --check`. Broader regression once where impacted,
   not after every small patch. Do not symlink dependencies across worktrees.

No native or browser proof uses personal browsing/text/session contents. Use
explicitly disposable sentinels/accounts/projects; never obtain broader access
merely to make a test pass. Normal owner/system permission prompts remain real.

## Parallel ownership and decision boundaries

Three implementation lanes plus the integrator fit the available concurrency:
continuity/execution, awareness/authority/connectors, and experience/verification.
Each lane owns explicit files; the integrator owns shared exports, composition,
spec and candidate gates. Keep simultaneous native proof workers bounded and
favor independent coding/review over overlapping heavy builds.

Continue autonomously within these boundaries. Ask Riley only for a material
product-scope change, connector sign-in, native observation permission, spending
or billing change, visual direction approval, installed-app replacement or
release. A worker finishing is not evidence that the combined build works.

## Explicit deferrals

- Social-account and iMessage connections, including automatic account feeds.
- Agent teams and subagent team products; later teams are actual persistent
  residents, not renamed temporary workers.
- Remote/always-on execution while the Mac sleeps, other-device observation and
  a new cloud hosting product.
- Recreating native harness interfaces, unsupported external-session controls,
  universal browser/app/text access and a native approval bypass.
- Always-listening microphones, keylogging, covert capture, secret collection,
  bulk machine/history ingestion and automatic public posting.
- A new personality engine, a second Mnemos graph, emotion/welfare measurement,
  attachment/retention mechanics, streaks or productivity scoring.
- Broad navigation, theme, onboarding or spatial-home redesign; separately
  owned design work and unrelated stale repository cleanup.

## Discussion and source references

- Saved Codex/Opus 5.5 discussion:
  `http://127.0.0.1:4317/?room=ab42f950-2e72-4286-a876-f46a1aca6bf2`.
- `docs/luca/RUNTIME_FIRST_CAPABILITY_CONTRACT.md`.
- `docs/luca/POLYPHONIC_CONTINUITY_CHARTER.md`.
- `docs/luca/capability-parity/COMPANION_DELEGATION_CANDIDATE_HANDOFF.md`.
- Three source-only kickoff audits of runtime, awareness and experience at the
  recorded base; conclusions distinguish live code from contracts and plans.

The live-engine, browser/OS/account integration and native acceptance gates
remain open. I0 DTOs alone do not implement the companion described here.

## Kickoff evidence

Source changes are limited to new `awareness.rs` and `initiative.rs` modules,
their focused tests, shared exports and this specification. Three independent
source audits preceded implementation; review corrected provenance saturation
blocking let-it-go, passive tick revision churn, and nested outcome fields not
being rejected by derived deserialization.

- Fourteen new focused checks pass; the complete `luca-protocol` crate has
  145 passing tests and two existing deliberate vector-emission tests ignored.
- Crate-library Clippy passes with warnings denied; scoped Rust formatting and
  `git diff --check` pass.
- Checks use pinned existing Rust 1.95.0 and the existing Cargo cache, offline
  with the lockfile retained. No new packages, shared frontend dependencies or
  native proof/model turns were introduced.
- No observation, scheduler, provider worker, app installation, release or
  design integration has been enabled. The D0-D6 and shipping/design worktrees
  remain separate.

## Integration progress (2026-10-08)

- Canonical carried threads use independent, existing encrypted `open-thread`
  lineages, not a second memory store. Same-capture current heads filter closed
  dispositions before ordinary retrieval. Own curiosity is not an owner task.
- Three semantic-thread DTO checks, the focused Own-versus-Shared Wake check,
  and all six encrypted persistence checks pass, including restart/idempotency,
  retirement, owner-correction precedence and independently verified completion.
- Body-free awareness authority, bounded memory-only buffers, durable keyless
  denial and native control commands are wired. Live access uses a non-serde
  AppState proof that rechecks current signing/recovery identity; retained public
  identity can only inspect status or narrow access. All ten synthetic native
  awareness/controller checks pass. Fixtures require a canonical, owner-only
  temporary directory; production safety checks were not relaxed to fix them.
- Five typed private-planning contract checks pass, including legacy wire
  preservation and valid no-change/defer/decline. ACP/native-channel checks and
  actual planning admission are pending. No source DTO grants tools or access.
- The combined native `companion_` filter now has 117 passing checks, covering
  source adapters, grant/expiry barriers, private inquiries, reservations,
  cancellation and restart/reconciliation. Ten canonical thread checks pass,
  including body-free closed-head settlement. These use disposable sentinels,
  not personal data or model runs.
- The one-shot native machine helper compiles with the installed Swift 6.2.1
  compiler and warnings denied. It has not been run or granted OS permissions.
- Twelve Chromium extension source/synthetic checks pass. No extension has
  been registered or installed, and no browser history has been collected.
- Native work/files adapters, the explicitly paired Chromium extension,
  default-off coordinator and operational reservations/recovery ledger are
  connected in source. The missing Own-inquiry module export and body-free
  canonical settlement forwarder are fixed. The combined desktop library check
  passes using pinned Rust 1.95.0, locked/offline dependencies and the internal
  reusable target. Remaining unused-code warnings reflect unfinished consumer
  wiring; this is not a clean full-suite or release verdict.
- Ten focused ACP initiative checks pass. An explicitly ignored native assay
  uses the installed Claude ACP 0.61.0 launcher in one private disposable
  session, pins its existing `opus[1m]` selection through the stable advertised
  model control, confirms Manual mode, and receives a bounded, strictly
  correlated real private outcome. Native options request no tools, no native
  settings/MCP inheritance and `persistSession: false`. The first assay rejected
  absent legacy model metadata before a prompt; the repaired assay uses the
  current stable `configOptions` contract and passes. No model retry forces a
  creation, and no result body is printed or published.
- That assay is adapter evidence with synthetic identity/persona/thread, not
  proof of the selected live resident, canonical commit, Library return,
  browser/screen capture, native-history erasure or the complete app loop.
  No real observation, account connection, app installation or release occurred.
- The current-component companion lab rebuilds and its seven state checks pass.
  It remains a clearly labeled simulation, not live settings or work. Social
  accounts and iMessage are deferred by Riley's current scope decision.

The live scheduler, real worker/artifact/return flow, browser/OS/account proof,
current-context conversation and UI/candidate gates remain open. Passing these
foundations alone does not close I1-I8 or implement the promised full companion.

### Native support boundary discovered during integration

The installed Claude ACP source explicitly supports tool-disabled sessions.
Initiative planning/authorship uses a disposable exact-model/persona worker and
`persistSession: false`; public chat and legacy cognition are unchanged. One
synthetic native adapter authorship roundtrip passes; full desktop execution
and exact live-resident proof remain pending.

The current Codex ACP path does not provide a verified all-tools-off contract.
Its separately owned app-server permission-profile path now supports scoped
private initiative planning/authorship, with a synthetic native sandbox and
structured-result assay passing against the installed version. It is not the
tool-free Claude path or a full selected-resident desktop acceptance proof.
Existing Codex chat, delegation, reflection and journal behavior are unchanged.
Riley approved implementing this separately scoped path; it must not be enabled
by silently changing native permissions or advertised as an isolated computer.

MCP connection grants and tools-list health do not prove background account-read
authority. See `ACCOUNT_CONNECTOR_BOUNDARY.md`; no automatic social/text feed
or second MCP framework has been created.

### Approved continuation (2026-10-08)

Checkpoint: the destination-specific native-history authority and owner commands
compile, with five focused consent/restart/revocation checks and all 122 native
companion checks passing. The new Codex private lane uses a named native
permission profile, default-denied reads, its own temporary writable folder,
no command network, ephemeral threads and separately disabled inherited tool
surfaces. A no-model native assay proves inside reads/writes and outside denial;
one synthetic real Codex authorship roundtrip passes with exact private-result
correlation. It uses native structured output after an initial unstructured
response failed closed. These are native adapter assays, not full desktop
selected-resident/source/Library/restart acceptance. The existing Claude
tool-free path and legacy public/delegated work are unchanged.

The chat review seam now has a fixed `companion` surface. A single optional
dialog reuses existing controls, keeps source selection separate from permission,
and offers independent observation, meaningful-note, model-sharing, native-history
and background-work choices. Its isolated sample is at `experience=companion-setup`
in the generated shell lab; it makes no native calls. First-meeting and Luca
working guidance describe this conversational setup without a new required
chapter or a default-harness change. Live observation injection remains OFF:
the final consumer/privacy connections and complete native candidate are still
open. Passing the new consent UI or adapter roundtrip does not close I6/I8.

The real-clock native assay exposed maximum deadlines exceeding the frozen
interval by the milliseconds omitted from canonical timestamps. Planning/work
deadlines now clamp against the whole-second admission ceiling; budgets are
not extended and no frozen contract was changed.

Riley approved restricted owned Codex background work and a separately explained,
default-off native-history choice. This approves implementing those controls,
not enabling collection against Riley's personal data. Codex planning/work in
this lane may use native tools inside an enforced scratch scope; it must not be
advertised as the existing tool-free Claude private-cognition path. Preserve
the exact resident/account/model binding, deny ungranted reads and outward
effects, disable inherited MCP/plugin/descendant capabilities, and prove the
native boundary before advertising support. A folder or a prompt alone is not
an isolated computer. Per-agent virtual computers remain a later direction.

Companion setup should happen mainly in the real conversation with Luca after
the existing default-harness/subscription connection is ready. Do not add a
mandatory multistep onboarding sequence. Luca explains the choices in their own
words, asks one useful question at a time, and uses the existing scoped desktop
review/navigation seam. A chat answer or suggested-answer button may request a
review but never grants machine access, retention, provider egress or background
execution by itself. Keep owner-native pickers and concise explicit confirmations
for widening access; offer a fuller opt-in setup without making it a prerequisite
for useful conversation. The same settings remain reachable later.

Ordinary-chat observation injection stays disabled behind the host readiness
gate until its consent and downstream consumers are actually connected. Raw
local archival retention remains unsupported; native-history consent is a
separate sink-specific authority, not a silent reinterpretation of the frozen
awareness grants. Preserve unknown/revoked/expired dependency denial and keep
normal conversation usable when awareness is paused or unavailable.

### Continuation after restart (2026-10-08)

- The ordinary-turn compiler now uses the separate native-history choice,
  rechecked under the same source-admission/frame lock. It no longer requires
  unsupported raw-local archival retention. A disposable controller test proves
  Observe/model-sharing alone is insufficient, explicit history consent admits
  the current source, OFF blocks the next sink, and expired bytes stay denied.
- The live initiative coordinator no longer always passes empty evidence. It
  selects up to four already-captured, current, exact-resident observations whose
  grants permit promotion and the current model binding. It does not capture a
  source or widen access to fill this list. No available evidence means useful
  canonical carried work remains eligible, rather than a failed conversation.
- Private planning/pursuit consumes ephemeral source evidence without requiring
  raw archival retention. The final native-frame barrier reproduces the exact
  bounded class/ref/hash/capture-time projection, rather than accepting substring
  matching. A retained creation still needs the existing separate promotion
  barrier; a private evidence read does not itself create a memory or artifact.
- Setup source reviews and pending saves are generation-scoped, so late replies
  cannot apply another source/resident's review or continue an old save in a new
  dialog. The approved layout is unchanged. The generated lab remains a labeled
  in-memory simulation and was refreshed in this feature tree after restart.
- The 124 focused desktop companion checks and frontend typecheck pass. The
  maximum-planning-deadline regression now explicitly covers fractional wall
  clocks; no frozen deadline or budget was extended. These are source/sentinel
  checks, not full native candidate acceptance or permission to collect data.

Still open: coherent warm-native-history reset/replay and final publication
privacy handling, ordinary-chat readiness, complete selected-resident native
source/work/Library/restart acceptance, and the separately identified native
candidate. The host readiness ceiling remains false. No installed app, personal
source, account connection, global runtime configuration or shipping/design
worktree was changed.

### Integration checkpoint (2026-10-09)

- Ordinary observed conversation now requires the exact signed private owner /
  companion audience, current runtime binding, separate native-history choice,
  and a fresh final source-authority check. Temporary relay/source unavailability
  remains retryable rather than losing a legitimate queued reply.
- Source-exposed conversations do not resume an old native history pointer.
  A durable body-free isolation marker forces fresh native sessions, including
  after restart; replay includes owner-authored messages only. This prevents
  reintroducing revoked context through previous assistant answers. It cannot
  erase copies already held by a harness, model provider or conversation.
- The ordinary-chat readiness gate is connected in this feature build. All
  source permissions remain default-off. This is not authority to collect
  Riley's personal browsing, sessions or screen content.
- The approved optional conversation review now exposes browser-profile pairing
  and app-source selection. Pairing and selection alone leave access off;
  observation, meaningful notes, model sharing, native history and background
  work remain separately reviewed. Browser classes are visits, explicitly
  shared bookmarks and selected excerpts. Current text capture is one bounded
  TextEdit/Preview sample, not universal or continuous screen recording.
- The current generated shell lab uses production components and a labeled
  in-memory adapter. Two browser checks pass for source selection, independent
  destinations, browser disconnect and narrow layout; seven preview-state
  checks and frontend typecheck pass. The 125 focused desktop companion checks
  and 18 isolated-candidate script checks pass. Existing unused-code warnings
  are not presented as a clean full-suite verdict. Source diff checks pass;
  generated bundled vendor template-literal whitespace is excluded rather than
  hand-editing the generated HTML or changing its semantics.
- `scripts/build-companion-initiative-candidate.sh` wraps the existing guarded
  candidate workflow with its own app name, bundle identity, URL scheme, state
  root and source receipt. It can reuse the internal warm compile cache without
  sharing candidate app data. Build does not install, launch, replace an app,
  notarize or release. Run and stop address only its recorded owned process.

Native selected-resident/source/work/Library/restart acceptance is still open.
The initiative worker currently requires an eligible canonical carried or Own
thread; no eligible thread is a quiet outcome, not invented progress. The
candidate must not be described as a separate agent computer, an all-browser
observer, or a completed free-curiosity loop without that acceptance evidence.

### Native acceptance: Resume recovery (2026-10-09)

The separately identified, locally signed candidate completed real first-run
setup with Codex and opened the optional companion controls through a normal
Luca conversation. Only a disposable synthetic file was selected. Selection
left observation off, and observation, model sharing and activity-in-chat were
confirmed independently. No personal browser, session or screen permission was
enabled; the installed application and shipping/design checkout remain intact.

This caught a native timing defect not represented by the preview: a capture in
the exact whole second of Resume was correctly rejected by the freshness floor,
but its in-process replay watermark then blocked later sequence allocation.
Allocation now respects both durable accepted sequences and that watermark.
The owned pending collector also defers its first read past the same-second
floor with a one-shot clock delay, without polling unchanged content or relaxing
withdrawal. Regression cases cover rejection recovery and this initial delay.

Full native source delivery, background result and restart acceptance still
remain to be verified on the refreshed candidate. A successful source/build
check is not presented as that end-to-end result.

### Native acceptance: source delivery and withdrawal (2026-10-09)

The refreshed isolated candidate admitted the selected synthetic file after an
explicit Resume and then admitted its changed contents. A normal Luca turn,
without file tools, correctly named the changed fictional mascot. The signed
reply was visible in the conversation; its durable dispatch was Observed with
one observation and fresh native history. After Pause, another file change was
not captured. The next signed reply truthfully lacked the note's contents; its
dispatch was Clean with no observations and fresh native history. Earlier
assistant answers were not replayed into that native turn.

Bounded background work was explicitly enabled only for this disposable
resident. A harmless unfinished idea from the clean chat completed a native
handoff and created an encrypted canonical open-thread record. This is a
carried-work seed, not evidence that a background pursuit has run or produced a
Library result. The real worker still requires 15 minutes of genuine Mac and
Polyphonic inactivity; no idle clock, budget or privacy rule was bypassed.

The native review also exposed a restart-status mismatch: saved unpaused
consent survived, but readers correctly restarted off. The body-free status now
separates current reader activity from saved consent, so the review offers
Resume immediately when collection is stopped. It neither activates readers
on startup nor changes the saved grant. Browser status is exact-resident and
requires active ingress, not merely a retained pairing. The 128 focused native
checks and frontend typecheck pass; the revised candidate's native restart and
background/Library acceptance remain pending.

### Native acceptance: consent-preserving restart (2026-10-09)

The signed candidate built from `d6b09ff6a5c7a6f7f85bdf4ecd1187692492af4f`
was quit with observation consent saved unpaused, then reopened into the same
disposable profile. Accepted observation metadata stayed unchanged while the
reader was stopped. The real native review offered Resume immediately. One
click started the reader and admitted a fresh sequence; Pause stopped it again.
Consent was neither silently enabled on startup nor removed by the restart.

Strict/deep signature verification and the two focused browser checks pass;
the browser build was regenerated after native packaging before those checks.
Native proof uses the separately identified bundle and its signed isolated
environment. No installed application or personal source was changed.

Only this disposable resident has background work enabled. Its clean canonical
unfinished thread survived restart. A real pursuit still needs the frozen
15-minute Mac/in-app idle floor; no simulated clock or direct ledger mutation
is used to close the background/Library gate.

### Native acceptance: independent execution Pause (2026-10-09)

The owner authorized the genuine idle test while Claude continued working. The
disposable resident's background policy was enabled, but the preceding awareness
Pause had also closed its process-local execution gate. The native controls
were explicitly re-armed through off, review and Allow background work;
observation remained paused, with no personal source or permission enabled.

The status projection now reports that execution gate independently of saved
policy. An enabled but stopped resident offers Resume background work and the
existing explicit permission review. Observation Resume does not clear the work
gate; declining the review does not clear it either. Every work enable/Resume
rechecks live owner authentication, even when saved policy is already enabled.

The exact-resident native gate check, frontend typecheck, E2E build and all three
focused setup-lab checks pass. The updated lab is an in-memory simulation using
the production controls; its paused-state screenshot was visually reviewed.
The timed native test continues on the previous signed candidate; these status
changes require a separately refreshed candidate before native verification.
