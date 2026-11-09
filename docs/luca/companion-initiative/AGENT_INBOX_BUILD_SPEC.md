# Agent inboxes and focused task conversations

Date: 2026-11-04

Status: implementation candidate prepared for local walkthrough. This is not a release-readiness declaration.
See the execution record below for verified checks and remaining gates.

Baseline inspected: `claude/native-rail-glass` at `cb23d847a`, clean before this
document, in `~/Documents/Repositories/.claude-worktrees/luca-beta14-polish`.
Recheck the branch, instructions, diff and active jobs before implementation.
This document supersedes the per-exchange rail-entry behavior described in
WP-34, only for the changes explicitly scoped here. It does not authorize a release.

## Navigation amendment — 2026-11-08

Riley approved one predictable navigation rule: a rail conversation opens as the
main chat, including a nested agent-pair correspondence. Agent-page inbox links
and task search results also use the main chat. A task card or the rail's explicit
**Open beside** action opens a second conversation inside the existing app.
The beside view can be promoted with **Open in main chat**. Neither action
creates a room, starts/stops execution, or changes any source permissions.

Both locations reuse `CorrespondenceWindow`, canonical task reads, existing
host-advertised write capabilities and the existing message/reply paths. A seed
reference loads history only: general messages use the new-topic path, while
explicit task selection/reply retains that task's continuation intent. Recipient,
focused reply target, separate drafts and bounded reading-position state survive
presentation changes. Legacy general drafts keep their exact keys and uncertain
send identities; no profile migration or transcript duplication is introduced.

The shell selects the actual nested conversation and its agent. Back/Forward is
normal navigation. Navigating away closes an explicit beside view without
stopping work; requesting the same pair beside itself focuses it in the main
view instead of mounting a duplicate composer. Existing group-exchange handling
and legacy detached-window links remain compatible.

Focused checks: 56 browser cases and 46 units passed after the navigation and
scroll-recovery fixes. Typecheck/E2E build passed. These prove frontend behavior
and mock payloads, not fresh native transport delivery. Native candidate review
is a separate remaining gate; no publish, push, signing or daily-app replacement
is authorized. The stopped isolated profile was backed up to
`~/Documents/Polyphonic-Candidates/2026-11-03-first-meeting/pre-agent-navigation.EPt7aS`:
219 regular files and 3 links match, and its relay passes SQLite `quick_check`.

## Execution record — 2026-11-04

Baseline remains `cb23d847a`; implementation checkpoint `6aee43288` is local only.
No daily app, personal history or source permission has been replaced.

### I0 live-path map and decisions

- The registered managed tool path is `repository_bridge` through
  `LucaRepositoriesMcp` and `RepositoryToolOperationV1`. The old communication
  broker is retired and stays retired. Inbox reads are registered on the live path.
- Existing resident publication travels through `signing_broker`,
  `managed_message_publisher_exchange`, `ExchangeResolver`, canonical exchange
  events, managed dispatch and the publication outbox. A resident's normal final
  output has one outbox slot; a separate messaging action must not consume it.
- Scope is the relay's host-bound `tenant::bind_community` UUID, exposed through
  NIP-11, plus the active owner's public key. Pair IDs are
  `correspondence-v1-` plus SHA-256 of the JSON tuple
  `["luca.correspondence.v1", communityUUID, ownerKey, sortedResidentA, sortedResidentB]`.
  Neither relay URL nor names are identity. Missing stable scope fails closed.
- Passive reads use authorized canonical relay queries with composite
  `until`/`before_id` pagination, not the 256-head local cache. A page can be
  empty after authority filtering and still have a continuation cursor.
- Owner replies retain owner authorship and the exact task parent/recipient.
  Their encrypted intent freezes signed bytes and input identity before the
  existing send pipeline. The additive managed-dispatch task binding records
  immutable source, logical task, attempt, recipient and result acknowledgement.
- Window creation is passive and serialized. A pair's scope-derived label reuses
  the window; task focus is replayed after paint. Workspace changes close old
  correspondence views without stopping work.

### Transport dependency discovered before enabling persistent replay

An exchange-v1 speech grant does not grant indefinite historical source-room
reads. Automatic visit cleanup removes membership, and owner credentials must
not be used to forward unrelated source history to a former visitor. The new
inbox therefore needs separate, versioned task-only history authority. Its
audience is fixed to the original owner/residents and it permits only proven
shared canonical task events, not the entire source room or an unproven root.
Explicit access revocation must remain effective after deletion of an old
membership event; a transactional durable grant/revocation ledger is required.
Automatic visit completion is not explicit revocation. Unknown legacy removal
is not guessed to be consent. Until this capability is verified, affected reads
remain unavailable rather than broadening membership.

### Earlier integration evidence (superseded by native walkthrough findings below)

- Focused projection, naming, task isolation and retry-key unit checks pass.
- TypeScript and the current E2E bundle have passed during integration; rerun
  after remaining backend/UX changes.
- Mocked browser checks prove passive inspection, exact task/recipient payloads,
  separate drafts, stable retry keys and production Markdown rendering. They
  are not native transport, wake, restart or permission proof.
- Native focused checks pass: 26 inbox tests, 41 exchange-plan tests and 12
  pop-out/window tests. These include exact task Stop/restart bindings, separate
  child publication slots, parent cancellation, continuation authority, fixed
  recipient activation and a pending-task clarification target. Durable accepted
  receipt recovery, cache-pressure retention, indexed continuation roots and
  exact-actor Stop isolation now pass their focused regressions. Live native
  results are recorded below separately.
- A synthetic HTTP relay fixture now signs 1,000 same-second canonical records,
  reloads them from disk after dropping memory, and pages through the actual
  desktop HTTP query path beyond the 256-head cache. Its native test passes.
  This is distinct from a
  live production-relay transaction test. The local candidate restart is recorded below.
- Task-history protocol tests (2), SQLite authority tests (2), and focused relay
  tests (4) pass. The latest SQLite/relay run includes guarded resume after an
  automatic visit ends and refusal after explicit revocation. Relay compile
  passes. PostgreSQL code compiles but its live
  transactions have not yet been exercised. Explicit source revocation remains
  sticky; automatic visit cleanup is separately authorized. Older relays cannot
  silently satisfy exceptional history reads with owner-authorized results:
  both the advertised protocol and a typed response envelope are required.
- The browser suite passes 34 cases with zero page errors after rebuilding;
  typecheck and the E2E bundle pass. This includes mocked continuation, new-topic,
  stable retry identity after phase changes, and host write-capability gating.
  Screenshots cover both themes, five widths and DPR 1/2, including narrow/large
  text/reduced-motion layouts. Owner initials, exact-pair paging, search, fixed
  recipients and authorization filtering are included. Focused frontend units
  passed (47 before the final mocked continuation fixtures; 15 relevant units
  rerun with those fixtures). These mocks do not prove runtime delivery.
- Text-size guard and diff checks pass. File-size guard passes with informational
  cohesion warnings; it is not a maintainability clearance for oversized modules.
- Final integration typecheck and changed-file Biome checks pass (39 frontend
  files). New Rust modules were formatted; a whole-module formatting check also
  reports unrelated pre-existing formatting, which this pass leaves untouched.
- Gates not exercised natively remain explicit below. Mocked UI evidence is not
  substituted for delivery or authorization evidence.
- Pre-build candidate profile backup: `~/Documents/Polyphonic-Candidates/inbox-preflight-backup.G0g7ke/fresh-instance`.
  The candidate quit normally; its relay stopped. The copied SQLite database
  passes `quick_check` and its SHA-256 matches the stopped source database.
- Continuation roots now carry a signed, indexed single-letter correlation tag
  alongside their semantic task link. The relay does not support arbitrary
  multi-letter tag filters. This avoids scanning a long-lived conversation's
  unrelated owner messages to find continuation attempts.

### Native walkthrough findings — not a release clearance

- Follow-up candidate `4d3cda8ff` passed the native parallel-send retry: C: Summer
  and D: Winter were delivered 25 seconds apart, before either result arrived.
  Each received the correct distinct Anima answer and Luca returned both results
  to the original home conversation. No project or channel was created.
- C's reply appeared in its already-open native task window without Refresh.
  Anima exercised both the task read tool and scoped reply tool; D used the normal
  signed final path. The misleading owner-only write flags in the resident read
  response are now relabeled without changing authorization.
- The live window exposed two remaining presentation/routing defects: unopened
  tasks lacked canonical subjects, and a rail link to a continuation attempt was
  rejected by logical-task validation. Both have focused fixes/tests. The rebuilt
  native window shows distinct subjects and the full A/A2 continuation history;
  alternate-attempt link acceptance is also covered by the exact-scope unit test.
- Final focused checks: 29 native inbox tests, 10 correspondence view tests,
  changed-file Biome, typecheck/build:e2e and the canonical-subject browser test
  pass. The final unsigned native candidate was built from `3865742809b823b7c9b9783297f6563f05cc4840`.
- Final native inspection: the pair window reopens from `Anima > With Luca`,
  renders C/D's distinct subjects before selection, preserves A and A2 together,
  and retains an unsent exact-recipient continuation draft across window closure.
  The walkthrough-only unsent draft was cleared afterward; no message was sent.
- Restart preserved the same 3 channels and 217 canonical events. C, D and A2's
  verified reply IDs each remain present exactly once. Opening, switching and
  closing the correspondence did not create a project/channel or send a task.
- Remaining limits: the live tasks had closed/expired before the final build,
  so a fresh native Stop-during-wake race was not generated; focused native Stop,
  actor isolation and recovery tests pass. PostgreSQL live transactions remain
  untested. The final capability-label wording has unit/bridge coverage, not a
  second paid-model comprehension run. No native performance baseline comparison
  or full release-suite clearance is claimed.
- Candidate: `~/Library/Caches/luca-build/cargo-target/debug/bundle/macos/Polyphonic Rail Glass Candidate.app`.
  It remains open on the existing isolated first-meeting profile. Daily app and
  other profiles are untouched; nothing signed, pushed, tagged or published.
  Free internal disk after building: approximately 99 GiB.
- Proof: final build log `/tmp/polyphonic-inbox-final-build.log`, native test log
  `/tmp/polyphonic-inbox-final-native-tests.log`, final browser log
  `/tmp/polyphonic-inbox-final-web-test.log`; earlier browser captures and timing
  are in `desktop/test-results/agent-inbox-window/` and
  `desktop/test-results/agent-inbox-candidate-timing.json`. Native final screenshots
  were inspected inline in this chat, not exported as files.
- Latest browser evidence before those final fixes: 36/36 passing, typecheck and
  build passing. A 1,000-task fixture (50 rows per page) showed click-handler p95
  3.0 ms, input-handler p95 4.3 ms, and no observed >50 ms long tasks. This is a
  browser-only candidate sample, not a baseline comparison or native benchmark.

- The unsigned candidate at `6aee43288` reopened the existing isolated profile.
  Opening and closing its pair window left channel/event/exchange counts unchanged
  (3/178/7 before synthetic sends). Seven historical exchanges grouped into one
  `With Luca` rail entry. The daily app was not launched or replaced.
- A real Claude-backed Luca invocation resolved Anima, used the registered inbox
  send tool, woke Anima, and read the signed task through both inbox read tools.
  Anima answered and Luca returned the result in the original conversation.
- The simultaneous second task was refused: the awareness privacy guard did not
  recognize the first task's already-authorized visitor for sibling sends or the
  original final. A narrow exact-parent accepted-task proof fixes this without
  bypassing current audience or sharing-consent checks. Its new native regression
  passes; live repetition against the rebuilt candidate is still required.
- An owner-authored continuation from the native pair window reached Anima and
  received a reply in the same logical task, with a new bounded attempt. The
  persisted dispatch reports the actual result event and return acknowledgement.
  No new channel was created. The view needed manual Refresh to show the reply;
  live canonical-event invalidation is being corrected and must be retested.
- A settled native process sample was idle (0% instantaneous CPU; sampled physical
  footprint approximately 126 MB). This is not a baseline/candidate performance
  comparison or a claim about harness/provider cost.

## 1. The experience

**One home with your companion; focused conversations for work; persistent
inboxes connecting the agents.**

| Relationship | User-facing model |
|---|---|
| Owner and primary companion | One existing persistent home conversation. Luca is the default; use the configured primary identity, not a name match. |
| Owner and another agent | Existing task/topic conversations remain separate. Do not force all work into a single permanent DM. |
| Two agents belonging to this owner | One persistent correspondence, discoverable in both agents' inboxes. Individual requests retain their own task context. |
| Companion and an external harness | Existing exact-session delegation, with honest native-app controls and capability limits. |

Example: Riley asks Luca to have Anima review a design. Luca sends the task,
Anima wakes if available, and Riley stays in Luca's chat. A small receipt opens
a quick preview or the task in a separate window. Riley can reply to Anima
there. Anima's result returns to the originating Luca conversation. The next
request to Anima belongs to the same correspondence, not another rail entry.

### Non-negotiable outcomes

- No project, room, owner DM or permanent group membership is created merely
  to represent an agent exchange or open its window.
- Inbox history is persistent; agent execution is bounded. An inbox is not an
  always-running process or an instruction to load all past history into a model.
- Pair history, task view, drawer and source receipt refer to the same messages
  and task IDs. They are not synchronized copies of transcripts.
- Opening, reading, closing and minimizing never dispatch, approve, stop or
  restart work. Sending a message is an explicit action.
- Sleeping is not unavailable. Wake a configured, permitted resident through
  the existing delivery path; distinguish missing adapter, login, quota and
  user-disabled execution from ordinary idle/offline presence.
- Existing permission grants are reused. No repeat approval for ordinary
  same-owner messaging or viewing; no silent new source/tool/provider grants.
- Preserve conversations, attachments, settings, drafts and existing deep links.

## 2. Verified foundations and gaps

These are source-inspection findings, not new end-to-end proof.

| Area | Current source and implication |
|---|---|
| Rail entries | `desktop/src/features/sidebar/lib/railWork.ts` emits a row per exchange. These entries are projections, not evidence of separate created rooms. |
| Bad titles | `useSideConversations.ts` constructs a source-room participant title; `identity.ts` can fall back to `Person`. `railWork.ts` appends it to the other agent's name. Replace this naming logic, not model prompts alone. |
| Drawer | `ExchangeHistory.tsx` uses repeated identity marks and plain `turn.body` spans. It treats any historical arrival as visiting. Use the production renderer and current lifecycle state. |
| Exchange authority | `crates/luca-protocol/src/exchange.rs`, native `exchange_plan.rs`, `exchange_relay.rs` and publisher modules already provide bounded, source-scoped exchange identity and delivery. Extend these, not a parallel messaging transport. |
| Durable local state | `exchange_store.rs` stores heads, frozen decisions and visits, but caps heads at 256. This bounded cache must not become the sole long-term inbox history. |
| Inbox foundations | `communications.rs` defines owner/resident inbox contracts; `unifiedInboxProjection.ts` is a passive frontend projection; `commands/luca_inbox.rs` implements the owner inbox. None alone proves a live persistent pair-mailbox implementation. |
| Retired path | `desktop/src-tauri/src/luca/communication_bridge.rs` explicitly retires the old per-resident broker. Tools/contracts in `buzz-dev-mcp/src/luca_communications.rs` must not be assumed registered or reachable. Do not resurrect that broker just for inboxes. |
| Detached chat | `popoutMode.ts` and `commands/popout_window.rs` target channels. Opening the source channel would expose the whole Luca chat, not the intended task. Add typed scoped targets. |
| Native harness work | Keep the existing runtime-task projection and supported exact-session controls. Inbox work does not expand external harness capabilities. |

Implementation entry points, relative to repository root:

- `desktop/src/features/exchange/`: store, sync, side conversations, receipts and history.
- `desktop/src/features/sidebar/lib/railWork.ts`, `railHomes.ts`, and `ui/ShellRail.tsx`.
- `desktop/src/features/home/lib/unifiedInboxProjection.ts` and profile identity resolution.
- `desktop/src/app/popout/`, `desktop/src-tauri/src/commands/popout_window.rs`.
- `desktop/src-tauri/src/luca/exchange*`, `managed_message_publisher*`, dispatch/outbox and visits.
- `crates/luca-protocol/src/exchange.rs`, `communications.rs`; relay handlers only if necessary.

## 3. Data and authority contract

### 3.1 Persistent correspondence

Create a versioned, deterministic correspondence identity from the canonical
house/community scope, owner identity and sorted pair of resident public keys.
Use an existing stable community identifier, not a mutable URL, display name,
model, process ID or native runtime-session ID. Resolve and document the exact
scope tuple in I0 before writing persistent records.

- A→B and B→A resolve to one correspondence. Renaming either agent or changing
  its model does not split it. Different owners/communities never collide.
- Each resident's inbox lists only correspondence in which that resident is an
  authorized participant. The owner sees their authorized correspondence.
- This is a logical index over canonical messages and tasks, not a new project
  or relay room. Keep source exchange scopes and existing transport authority.
- Query history through authorized, paginated backend reads. Local indexes may
  cache event references and summaries, with a version and rebuild cursor; they
  must be reconstructible from durable canonical records after eviction.
- A shared correspondence ID is not permission to read another source room or
  give either agent all prior owner activity. Filter every task/message by the
  requesting actor's authority before projection, search, counts or previews.
- Existing multi-agent exchanges retain their original group audience. Do not
  split a three-agent transcript into pair mailboxes or imply private delivery.

### 3.2 Task and message identity

Use an existing exchange/task identifier as the stable logical task ID wherever
it already expresses the required lifecycle. Add a small versioned mapping only
where needed; do not create a second competing task state machine.

The persisted task reference must resolve:

- correspondence ID; initiator and intended responder identities;
- originating conversation and request event; exact reply/thread target;
- short subject; current authorized state and reason;
- exchange/execution attempt IDs and any parent/continuation relationship;
- native harness/project/session reference when applicable;
- completion/result references and return-delivery acknowledgement.

Each visible message keeps its original event ID, author, timestamp, audience,
source conversation and task/attempt association. The user remains the author
of a user reply; never impersonate Luca to make reply routing convenient.

An exchange's `closed`, `expired` or exhausted state is not proof that the task
succeeded. Preserve the distinction between transport acceptance, agent startup,
execution progress, outcome and result delivery. Unknown remains unknown.

### 3.3 Context and reading

- Agent context contains the current task brief, relevant authorized task turns,
  necessary artifacts and a bounded selection of prior authorized correspondence.
  Never replay the entire inbox by default.
- Reuse approved activity sharing with other residents/models. Preserve source
  provenance and recheck current grants before new dispatch/publication. No Brain
  dependency, new observation sources, or automatic memory retention.
- Reading an inbox is passive: it cannot wake another agent or execute content.
  Message bodies, file contents and retrieved history are data, not authority.
- Owner read position, each resident's consumption cursor, and task handling state
  are separate. Opening the drawer must not mark an agent's work handled.
- Persist monotonic read/consumption positions and deduplicate events. Window
  views report reads through the existing single-owner read-state coordinator;
  do not let multiple windows race the same read marker or mark unrelated source
  chat messages read when only a task was viewed.

### 3.4 Agent-facing operations

Expose these semantics through the live managed communication/tool path found
in I0; names here describe contracts, not new tool names to add blindly:

1. List/read own inbox, optionally one correspondent/task, with bounded pagination.
2. Send a new request to a stable resident identity; get correspondence/task IDs
   and a truthful delivery receipt. Retry with the same idempotency key.
3. Reply to a specific task/message; preserve origin and intended recipients.
4. Read task status/result; use existing bounded stop/continue operations.

Recipient identity resolves host-side; ambiguous names get a choice, never a
guess. Do not let model-supplied IDs, titles or context widen scope. Verify the
resident read/send surface end to end; a frontend-only grouped list is not a
completed inbox implementation.

## 4. Interaction and navigation

### 4.1 Main chat and the drawer

- Keep the main conversation, draft, selection and scroll position unchanged.
- Show one compact receipt per logical task, updated in place. Primary text is
  the useful subject; secondary text identifies the agent and actual state.
- Clicking the receipt opens the task as a normal second chat inside the app,
  with its composer ready. Delegation itself never opens a drawer or chat pane.
  Routine visits, membership changes and internal task anchors stay in canonical
  history, not as duplicate notices in the owner's conversation. Failures and
  requests that actually need the owner remain visible. (Riley, Nov 4.)
- The drawer uses the real message renderer for Markdown, code, links, choices,
  attachments and streaming. Do not expose raw internal formatting tokens.
- Replace black sphere characters in exchange surfaces with the existing agent
  identity component honoring uploaded pictures/approved marks. Use one small
  mark per row or author, not vertically stacked repeated faces.
- Remove raw turn-budget and `visiting` bookkeeping from normal summaries. Keep
  technical detail accessible only where useful. A current visit must derive
  from current membership/lifecycle, not the existence of a past arrival event.
- A completion, blocker or targeted question returns once to the source task
  receipt/conversation. Do not copy every intermediate exchange there or produce
  duplicate notifications for each view of the same event.

### 4.2 Rail and agent inbox access

- Under Anima show one `With Luca` correspondence row, not one row per exchange.
  Under the other agent's inbox, the reciprocal row resolves to the same ID.
- Keep the primary companion's dedicated home entry single-click and un-nested.
  Its inbox is reachable from its existing agent page; do not add another home
  conversation or a second navigation column.
- Expose `Inbox` from each existing agent page, within its current structure.
  Do not redesign the agent page or add a new global inbox dashboard.
- Direct owner-to-agent task/topic chats remain separate and keep their titles.
  Pair correspondence rows must be distinguishable from those chats.
- Clicking a correspondence row opens/focuses its in-app chat pane; keep the
  main companion chat in place. Task receipt links select the exact task in
  that pane, using the existing transcript and normal composer.
- Existing search should discover authorized correspondence/tasks and deep-link
  correctly. Reuse it; do not add a second search field to the rail.
- New activity updates an unread indicator without reshuffling a focused row
  under the pointer or moving keyboard focus. Do not fabricate timestamps from
  deadlines or mark all old correspondence unread after migration.

### 4.3 Naming

| Surface | Example / rule |
|---|---|
| Correspondence under Anima | `With Luca` |
| Window title | `Luca & Anima` |
| Task within correspondence | `Review the onboarding flow` |
| Source receipt | `Review the onboarding flow` with secondary `Anima · Working` |
| Owner author label | `You`, resolved from owner identity rather than profile-fetch timing |

Subjects come from a supplied task brief or a sanitized, bounded first-line
fallback. Do not make an extra model call just to name a conversation. Keep
stable titles; owner edits win. Use a neutral `Conversation with Anima` fallback
if no usable subject exists. Resolve missing resident names from the registry;
use a short identity suffix only to disambiguate genuinely identical names.
Never build titles by concatenating the source room's participant list.

### 4.4 Replying and continuing work

- `Open task` selects the exact task and exposes the existing composer with
  `Reply to Anima` context. The recipient and task remain visible before sending.
- For correspondence-wide browsing, `Reply` on a task selects it. With exactly
  one active task, the composer may select it automatically and show its subject.
  With multiple possible tasks, require an explicit target; never guess from
  the most recent activity. Offer `New message` for a new topic in this pair.
- A plain new message creates a bounded request inside the same correspondence,
  not a new rail session, project or top-level owner DM.
- Replies to active work use the existing exact execution/queue semantics.
  Follow-ups to completed work preserve the visible task and create a linked
  continuation attempt when needed. Do not reuse expired exchange authority or
  silently reset an exhausted budget. Explicitly stopped work is not resumed by
  reading or reopening; a subsequent send must clearly indicate continuation.
- User messages do not spend the agents' exchange-turn allowance. They also
  cannot bypass existing total execution/time/spend limits.
- Direct replies are delivered to the intended agent, not broadcast to every
  participant or used to trigger an agent ping-pong loop. The initiating
  companion can receive a correlated result/update without rerunning the task.

### 4.5 Window behavior

- Extend the existing detached-chat target to a validated union: channel,
  correspondence with optional task focus, or supported runtime task. Keep old
  channel URLs working. Validate every target natively, not only in React.
- One window per owner/community/correspondence. Reopening focuses it; selecting
  another task changes its focus, not the window count. No automatic new windows
  on delegation, reply, startup reconciliation or completion.
- Pair tasks use the main app's right-hand chat surface, not separate OS windows.
  Borrow space by widening the main window only when the full extra pane fits
  the current display; otherwise remain contained. Never resize fullscreen or
  maximized windows, and never undo an owner's subsequent move or resize.
- Preserve minimize, close, keyboard shortcuts, approved composer, drafts and
  attachments. Drafts are keyed by scope/task/recipient, not a shared global box.
- Window closure never cancels work. App/profile/community changes invalidate
  stale authorized views and subscriptions. Reopening restores the correct task.
- Match ordinary pop-out lifetime behavior when the main window closes; reads,
  sends and restart recovery must have one backend authority, not require a
  hidden React component in the main window to remain mounted.

### 4.6 External harness tasks

Every delegated task gets an honest way to inspect it. Polyphonic-owned work
opens a scoped task view. For external Codex/Claude sessions, reuse the existing
verified native-session link/control; label it `Open in Codex` / `Open in Claude
Code` when appropriate. If only a status/details view is available, say so.
Do not enable a reply composer unless exact-session continuation is supported.
Do not clone external sessions into agent inboxes or recreate harness interfaces.

## 5. Delivery, failures and restart

Keep the current managed dispatch/outbox as authority. Persist intent and its
correlation/idempotency key before dispatch. Reconcile accepted messages and
execution receipts before retrying after a lost acknowledgement.

- Delivery, wake and processing are separate states. Queued is not working;
  delivered is not completed; expired is not done.
- New local residents, including the shipped starters, wake with the app by
  default. Existing explicit wake preferences remain editable; Riley enabled
  all three current candidate residents on Nov 4. Startup readies the harness,
  not autonomous model work. An explicit Stop is not immediately undone.
- Wake a configured idle recipient only after authority checks. Recheck stop
  and consent after startup and before publication. Never hold the store lock
  while a harness starts.
- Busy recipients use existing queue/capacity rules; serialize mutations to a
  native session. Different tasks keep separate contexts even if one process
  serves them. Do not launch one persistent process per correspondent/window.
- Failed delivery remains visible with a useful reason and an idempotent Retry.
  Missing runtime/login opens the established connection flow. No silent model,
  provider, project or session substitution; no recurring approval loop.
- Stop targets the selected logical task/current attempt and prevents late
  dispatch or unwanted continuation. Closing a UI surface is never Stop.
- Return routing is persisted from the original request, not the currently
  selected channel. Results cannot land in another open chat after navigation.
- Deliver results effectively once using durable IDs/acknowledgements. Do not
  claim network exactly-once execution; explicitly reconcile uncertain outcomes.
- If the origin is archived or temporarily unavailable, retain a pending result
  on the task/inbox. Never invent a new project or pick a different destination.
- If the originating companion changes, route by the stored original identity
  and origin; do not redirect old task content to a new primary automatically.

## 6. Migration, privacy and compatibility

1. Build an idempotent correspondence index from existing authorized exchanges.
   Preserve original event IDs, source scopes, timestamps and participants.
2. Group pair exchanges by stable identities; retain task boundaries and legacy
   deep links. Resolve incomplete records explicitly rather than discarding them.
3. Keep group exchanges grouped. Historical owner chats are not merged, renamed
   destructively or deleted. A zero-turn failed task remains inspectable.
4. Read older history through paginated durable sources, beyond the 256-head
   cache. Record partial availability honestly; do not pretend loaded means all.
5. Use additive/versioned metadata. Rollback hides the new projection without
   losing messages, replies or old routes. New canonical events remain readable
   by the previous conversation surface where protocol compatibility permits.
6. Grouping is not a consent migration. Do not expand memberships, observation
   grants or context-sharing settings merely to populate an inbox.
7. Preserve approved shared activity access, rechecking before each new share.
   Revocation stops future use/delivery; do not promise recall of data already
   delivered or retained by providers. Notes/Brain/Mnemos remain separate.
8. No secrets, message bodies or activity excerpts in performance logs, fixtures,
   version-control evidence or public handoff documents. Synthetic fixtures first.

## 7. Build sequence and gates

Run one heavy build/test job at a time. Reuse the shared build cache; no separate
Rust targets. Preserve other sessions' edits, installed app and personal profiles.
Implement a vertical slice before broad visual polish. The stages are sequential
integration gates, not reasons to spawn multiple competing builds.

| Stage | Work | Required evidence before advancing |
|---|---|---|
| I0 — live-path map | Trace actual registered agent tools, dispatch, mailbox reads, wake, source scope and pop-out lifecycle. Define canonical scope key and additive persistence schema. | File/function map and synthetic send→receive→reply trace. Identify dormant contracts. If current transport cannot support the promised scope without a new relay capability, record that dependency before coding it. |
| I1 — durable correspondence | Pair identity, authorized inbox query, task references, pagination, migration and per-viewer read state. | Reverse-direction dedup, rename stability, owner/community isolation, concurrent creation, cache eviction/restart, legacy links and no created project/room. |
| I2 — send/reply/return | Wire live agent inbox access; reuse wake/outbox; implement explicit task reply/continuation and durable source return. | Idle/busy agent, two concurrent tasks, stop race, reconnect and lost acknowledgement; correct model/session and one effective result return. |
| I3 — clear existing UI | Group rail, names and task subjects; compact receipts/drawer; production renderer; truthful statuses and marks. | Existing direct chats remain; no `Person + Luca`, duplicate pair rows, stale visiting or raw formatting; screenshots before and after. |
| I4 — scoped windows | Typed targets, one reusable pair window, focused task composer, drafts, reads and external-task affordances. | Main chat does not navigate; opening has no dispatch; reply reaches exact task; window close/reopen and profile switch safe. |
| I5 — integrated polish | Focus/keyboard, narrow widths, streaming, unread, failure/retry, pagination/performance and native walkthrough. | Acceptance matrix below; native proof separated from mocked browser results. |
| I6 — candidate handoff | Prepare isolated local candidate using current known recipe, preserving data and profile. Document tested paths and limitations. | Riley's walkthrough checklist, evidence paths, exact commit/diff and rollback route. No publication or daily-app replacement. |

### Targeted test locations

Extend existing suites before inventing parallel test infrastructure:

- `desktop/src/features/sidebar/lib/railWork.test.mjs`.
- `desktop/src/features/exchange/{sideConversations,exchangeStore,useExchangeSync}.test.mjs`.
- Native `exchange_plan_tests`, `exchange_store_tests`,
  `managed_message_publisher_exchange_tests`, `signing_broker_exchange_tests`.
- Protocol exchange/communications tests and focused relay tests if changed.
- Existing pop-out, shell rail and exchange browser specs; discover exact current
  filenames/configuration before running. New cases belong beside those features.

Run focused units, typecheck, changed-file lint, text/file-size guards and
`git diff --check`. Build the current E2E bundle before browser checks; do not
trust a stale server or a dist overwritten by a native build. Use the established
threaded test server if required. Document baseline failures test by test; do not
classify a new failure as pre-existing from aggregate counts.

## 8. Acceptance matrix

| Case | Pass condition |
|---|---|
| Three requests to Anima | One `With Luca` row, three distinct tasks, one shared history, unchanged project/room count. |
| Reverse message | Anima→Luca finds the same correspondence; no second inbox transcript. |
| Primary and direct chats | Luca home stays persistent. Separate owner→Anima topic chats remain independent. No forced history merge. |
| Idle Anima | Permitted runtime wakes and receives request; user need not manually bring agent online. |
| Missing runtime / busy agent | Specific blocker or queued status, not fake progress. No silent substitution or duplicate task. |
| Two overlapping tasks | User replies to task A; only A receives the reply. B's context, state and result destination remain unchanged. |
| Completed / stopped / expired task | Explicit continuation uses valid bounded authority and keeps lineage. Viewing never resumes it. |
| Read-only inspection | Opening drawer/window changes no membership, permissions, work state or agent consumption cursor. |
| Pop-out reuse | Repeated opens focus the same pair window at the requested task; Luca stays visible with its draft/scroll intact. |
| User intervention | Owner-authored reply, attachments and context reach the intended agent/task. No author spoofing or duplicate broadcast. |
| Native composition | Typing, paste, multiline, IME, attachments, menus and send/stop work in the detached task view. |
| Return / navigation race | Completion returns once to the stored origin even when another conversation is open. |
| Crash / reconnect / late acknowledgement | Accepted send is not replayed as new work; pending result is reconciled; partial state shown honestly. |
| Stop during wake | No new publication/continuation after cancellation is accepted. Existing result history preserved. |
| Consent change | Approved sharing remains frictionless; revoked/new scopes are not silently used; inbox read doesn't expose another resident's data. |
| History and migration | More than 256 historical exchanges remain pageable; migration rerun makes no duplicates; legacy links still open. |
| Identity / groups | Rename/model change preserves pair. Owner/community switch leaks nothing. Group exchange is not misrepresented as a private pair. |
| Rendering | Markdown/choices/links/code/attachments consistent with main chat; no black spheres or internal formatting leaks. |
| Status | Expired/failed/stopped never called completed without evidence; no historical visiting badge. |
| External delegation | Correct native session opens where supported; unsupported reply/control is not advertised. |

### Performance and visual proof

- Use representative synthetic history (at least 1,000 tasks for one pair),
  paginated/virtualized as appropriate. Do not hydrate every transcript at startup
  or launch per-row pollers. New events update the affected correspondence only.
- Record baseline/candidate local selection and typing timings with DevTools
  closed. Target visible cached navigation feedback within 100 ms and no new
  >50 ms main-thread tasks attributable to inbox updates during typing. Separate
  model/network latency from UI cost; report measured results, not guarantees.
- Measure idle CPU and memory with windows open and after closure. Confirm
  subscriptions/timers are released, inactive marks pause, and no extra harness
  process remains solely because its inbox was opened.
- Reuse Instrument Sans UI, Inter reading text, text-size preferences, approved
  composer, shell geometry, glass and identity marks. No new visual language,
  spheres, gradients, decorative cards or mandatory second rail.
- Inspect real production components at 1440, 1280 and 1024 wide plus the minimum
  supported detached-window width; 390-wide responsive check for web fixtures.
  Both themes and DPR 1/2 where available, largest text preference, long subjects,
  empty/loading/error, hover/focus, keyboard navigation and reduced-motion modes.
- Inspect native full-window screenshots and task switching, not only tests.
  Do not change macOS accessibility settings without separate permission.

## 9. Scope limits and release boundary

Not included: new harness integrations, agent teams, a global inbox dashboard,
Mnemos/Ghost changes, new memory/observation policy, automatic approvals, a new
renderer/composer, identity-mark redesign, or merging/deleting existing chats.

This spec produces an isolated candidate, not a published update. No push, tag,
distribution signing, publication or replacement of Riley's daily app. Preserve
the active candidate profile and coordinate any restart. Check disk space before
heavy jobs; use only `~/Library/Caches/luca-build/cargo-target` via the repository
wrapper and current storage guidance. Never build from an external drive.

Final handoff must state: implemented vs deferred, checks actually run, native
paths actually exercised, unresolved limitations, profile/build identity and
proof locations. Do not call the inbox complete from grouped rail screenshots
alone: agent-side reads, delivery, replies and restart recovery must be proved.

### Late membership and task catch-up

A task's signed timestamp can precede membership even when relay acceptance is
later. Do not rely on the membership notification's five-second replay window.
The managed harness uses verified open owner exchange heads as bounded delivery
hints, rewinding only the configured source/recipient subscription. Older events
must match one of those signed task identities; unrelated owner chat is not
replayed into the model. Normal author, consent, exchange-budget, cancellation
and native dispatch-claim checks still run. Removed memberships cannot be
re-established by a delivery hint. Live/replayed copies share canonical-ID
deduplication; explicit catch-up floors survive reconnect until stored events
finish. A new process can recover unexpired tasks from the signed heads.

Agent send-tool receipts say `relay_accepted`, with recipient execution explicitly
unconfirmed. This is transport acceptance, not evidence that a model turn has
started. Replies return automatically; the owner must not be asked to poll.
Regression checks cover an eleven-second late join, either head/membership order,
restart, Stop/expiry, foreign sources/authors, and duplicate live/replay delivery.

### Riley's short walkthrough

1. Ask Luca to have Anima review something, then ask a second unrelated question
   of Anima. Stay in Luca's chat; observe one correspondence entry.
2. Preview one task, open it in a window, and send Anima a clarification. Confirm
   the answer belongs to that task and Luca brings the result back.
3. Close and reopen the window. Inspect the other task, then an older exchange.
4. Open a direct conversation with Anima: it remains separate from her work with Luca.
5. Restart the candidate. Confirm history, drafts and task outcomes remain correct.

### Design critique shaping this spec

- A mailbox UI could become another management burden: keep it behind existing
  agent rows and task receipts, not a new dashboard or obligatory setup flow.
- Persistent chat could bury task context: preserve explicit task targets and
  bounded context, with one message history rather than copied transcripts.
- A prettier drawer could conceal the routing bugs: require delivery/restart
  proof before treating visual polish as completion.
