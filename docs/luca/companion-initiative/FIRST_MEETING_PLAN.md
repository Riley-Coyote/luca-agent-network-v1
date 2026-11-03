# Luca's first meeting and companion setup

Implementation map · 2026-11-02 · implementation and local verification in progress.

Inspected baseline: `claude/native-rail-glass` at `f692daedb`, in
`/Users/rileycoyote/Documents/Repositories/.claude-worktrees/luca-beta14-polish`.
The checkout was clean. This plan does not enable access, change a profile, or
authorize publication. The source findings below are code inspection, not a new
end-to-end runtime pass.

## Outcome

The user connects a harness, meets Luca in their one persistent conversation,
makes a small number of understandable approvals, and accomplishes something
useful. Luca explains and sets up the rest through that conversation. The first
meeting should feel like the beginning of a collaboration, not a questionnaire,
a settings tour, or a demonstration of how much personal information was found.

## Decisions to preserve

- Luca speaks naturally from objectives and actual context, not prescribed lines.
- Remove the habitual disclaimer opening and default four-answer interview.
  Honesty remains required; apologizing for not knowing the user is not a ritual.
- Learn what the user hopes to get from Polyphonic, then visibly adapt the next
  action. One useful question at a time; optional reply choices only when helpful.
- Show a concrete, source-grounded connection or useful next step from authorized
  recent work. Do not manufacture intimacy, infer sensitive traits, or pretend an
  indexed source was read. Offer interpretations as revisable, not diagnoses.
- Teach by doing: a small completed result first, capabilities introduced when
  relevant. The user can interrupt, skip setup, or bring a real task immediately.
- Conversational initiative is the default. Reading external activity, retaining
  notes, model sharing, background execution, and unsolicited returns require
  explicit approval of their respective scopes.
- The recommended companion configuration is easy to accept together and easy
  to customize. It is not an automatic permission grant or an upgrade migration.
- Existing disabled, paused, denied, or customized choices remain authoritative.
- Brain is optional knowledge, never a prerequisite for harness following or
  direct authorized work. Mnemos integration remains deferred for this release.
- Preserve the approved composer, shell, typography, marks, and mini chat. Reuse
  the existing temporary surfaces; this is not another design exploration.

## What is already present, and what is missing

Paths are relative to the repository root.

| Area | Verified existing implementation | Required change |
| --- | --- | --- |
| First meeting | Canonical Luca DM; persisted meeting record; bounded opening context; objective-based prompt | Replace five-reply expiry with resumable, bounded guidance; remove repetitive opener; join setup and useful first work |
| Recent-work context | Opening references are discovered through the connected Brain catalog in `first_meeting/record.rs` | Also accept explicitly approved harness samples without Brain; distinguish available sources from successfully read evidence |
| Harness following | `commands/companion_configuration.rs` discovers standard Claude/Codex roots and requests host-owned approval | Compose a recommended setup review; retain unusual-profile fallback and independent source results |
| Chat permissions | Typed follow, awareness pause/resume, and background actions; revision and binding checks | Add explicit note-retention and setup scopes without bypassing existing authority |
| Memory | Resident-scoped continuity and companion note/promotion paths | Connect meaningful approved observations to these paths; verify saved notes and later recall, not merely enabled settings |
| Background work | Bounded private initiative, local creations, foreground preemption, recovery | Complete the narrow result-return path into Luca's existing DM |
| Proactive messages | `set_companion_initiative_policy` explicitly rejects `allow_outreach`; chat configuration always sets it false | Implement approved, rate-limited, quiet-hours-aware delivery; never claim background enabled means proactive messages work |
| User control | Companion controls exist in agent settings and a review dialog | Keep them discoverable; let Luca make supported changes directly and report actual receipts |

Primary source seams:

- `desktop/src-tauri/src/luca/first_meeting.rs`, its `first_meeting/` modules,
  `first_meeting_prompt.md`, and `commands/first_meeting.rs`.
- `desktop/src-tauri/src/commands/companion_configuration.rs`, `companion_follow.rs`,
  `companion_history.rs`, `companion.rs`, and `companion_initiative.rs`.
- `desktop/src-tauri/src/luca/companion_awareness/`, `companion_initiative/`,
  `resident_notebook/`, and the existing runtime-task delivery/outbox path.
- `desktop/src/features/luca/CompanionSetupDialog.tsx` and
  `desktop/src/features/agents/space/MindKeepsUpWith.tsx`.
- `crates/buzz-dev-mcp/src/luca_repositories.rs`,
  `crates/buzz-acp/src/luca_managed_prompt.md`, and the operator status exposed by
  `desktop/src-tauri/src/luca/repository_bridge.rs`.

## The experience, in order

1. **Arrive in a conversation.** Keep the necessary harness connection. Luca
   offers a concise, natural welcome and the central promise: the user can stay
   here while Luca coordinates work across their available tools. If usable
   context was already explicitly approved, ground the opening in that evidence.
   Otherwise offer to take a brief look; do not delay chatting or imply access.
2. **One clear companion review.** Luca explains the benefit in ordinary language.
   The existing host-owned ask surface presents the recommended scopes, with
   Approve, Customize, and Not now. Standard installed profiles are discovered
   automatically. No routine folder or project selection.
3. **An earned first insight.** After approval, read a bounded recent sample and
   bring back one useful observation, connection, or unfinished decision with its
   source. Ask whether that is the right place to begin. Avoid a dossier or a
   long recap. A slow or unavailable source never blocks the conversation.
4. **A first useful result.** Help with that task or the user's own priority. Use
   a real supported action: clarify a decision, draft something, or delegate to
   a selected existing/new harness session. Explain the capability through the
   result rather than reciting the feature list.
5. **Keep helping the user discover the app.** Across natural exchanges, offer
   companion management, other agents and group chats, agent-to-agent work,
   harness delegation, and optional Brain/knowledge. Introduce one relevant
   capability at a time. Defer the rest without forgetting or nagging.
6. **Continue, rather than graduate.** Briefly report the effective setup and how
   to pause or change it. Later visits build on the actual conversation, retained
   preferences, and approved useful findings. No restart of the welcome or a
   completion ceremony.

These are objectives, not six mandatory screens or a fixed sequence of messages.
If the user starts working immediately, setup and education wait for a useful
moment. A user declining all observation still gets a capable, welcoming Luca.

## Consent and defaults

The recommended review must show what is selected, where information goes,
what is retained, and that background use consumes the connected subscription.
Independent scopes can be approved in one review without becoming inseparable.

| Scope | Recommended behavior after approval | Boundary |
| --- | --- | --- |
| Initial context | One bounded sample of recent visible Claude/Codex messages | Separate from ongoing following; no full-history import |
| Ongoing following | Follow new/changed sessions in detected supported profiles; resume on app launch while authorized | No content read before consent; changed identity/model binding invalidates stale authority |
| Use in chat | Share selected excerpts with Luca's current connected model | Explain that provider/harness conversation history may retain copies |
| Useful notes | Retain selective, source-linked facts and explicit preferences for this resident | No raw activity archive; correction, removal, and source revocation semantics must be clear |
| Background work | Existing bounded private work and local creations while the app and harness are available | No automatic project edits, messages to others, broad tool grants, or unlimited token-budget promise |
| Proactive returns | Meaningful results in the same Luca DM, not every observation | Explicit approval, deduplication, quiet hours, existing outreach ceiling; no new push-notification permission bundled |

Browser/screen access stays optional and separately explained, with any required
macOS approval. Social accounts and iMessage remain deferred. Brain setup and
agent imports remain separate choices, offered conversationally when useful.

The first sample should retain the existing upper bound of three transcript tails
at 64 KiB each, also constrained by a recency window and a cancellable wall-time
budget. This is an input ceiling, not a promise to read the whole allowance.
Choose the freshest authorized evidence; no credentials, hidden reasoning, or
unrelated files. A later grant can supply first-use context even after the first
message; the implementation must not require permission before the welcome.

## Implementation sequence and finish lines

### F1 — One reliable setup operation

Extend the current typed companion configuration flow rather than introduce a
second permission system. Discovery returns metadata and proposed scopes; the
host owns the review, approval identity, target resident/model binding, revisions,
and request ID. Apply only approved scopes and return per-source/per-capability
receipts. A missing harness must not undo a successful setup of the other.

Wire note retention and the recommended preset through existing setters. Preserve
advanced controls, cancellation, idempotency, and concurrent-pause protection.
An approval arriving after Pause, revocation, or an owner/model change must not
resurrect access. A short chat reply reports actual changes without opening pages.

**Done when:** one review enables the selected supported sources and capabilities;
Not now changes nothing; customization and partial failure are truthful; repeating
the same request does not duplicate registrations or widen the grant.

### F2 — Authorized context and meaningful memory

Bridge the initial sample and existing awareness evidence into first-meeting
context independently of Brain. Record provenance and successful read receipts;
replace the misleading `You have read` wording currently derived from source
counts. Distinguish discovered, permitted, read, retained, and unavailable states.

Use existing resident-scoped notes/continuity. Avoid a new memory store, broad
personality inference, or a silent transcript archive. Memory writes need actual
save receipts; later recall must respect current source/retention authorization.

**Done when:** an approved standard profile supplies real recent context without
folder selection or Brain; refusal/timeout produces a good fallback; one useful
note can be saved, recalled, corrected, and removed without duplicate saves.

### F3 — Adaptive first-meeting guidance

Rewrite the special brief around the experience above, keeping Luca's normal
identity and voice. Synchronize the managed prompt, tool schema/descriptions,
and `docs/luca/identity/FIRST-MEETING.md` so they no longer give conflicting advice.

Extend the existing versioned meeting record, with backward-compatible reads,
for introduced/deferred/declined topics and first useful outcome. This state is
guidance, never permission authority. Effective grants and setup success always
come from the host. Keep context bounded; do not carry an ever-growing onboarding
prompt. Replace the hard five-owner-reply cutoff with resumable guidance that
stops naturally and leaves existing conversations alone.

**Done when:** rich-context, no-context, declined-access, and task-first openings
all work; no forced questionnaire or repeated disclaimer; restart continues the
meeting without re-greeting, duplicate setup, or losing the user's task.

### F4 — Close the proactive return loop

Do not merely remove the current `allow_outreach` rejection. Connect a retained,
source-authorized useful result to the existing delivery/outbox machinery and
canonical Luca conversation. Validate exact resident/owner, current grants,
privacy, novelty, delivery ID, foreground activity, and policy again at send time.
Review existing delivery reuse before adding any new queue.

Implement a real host quiet-hours check: the protocol has a quiet-hours receipt
field, but that alone is not an implemented scheduler. Proposed initial default:
22:00–08:00 local time, customizable, with at most one unsolicited return in a
rolling 24 hours (the current initiative ceiling). Defer rather than burst after
sleep/restart. A declined topic stays declined. An empty/no-change result is valid.

Keep existing bounded private-work limits initially. They bound host stages and
time, not every underlying provider call or exact money spent. Pause blocks new
work and pending delivery, requests cancellation of owned active work, and reports
the actual state rather than claiming the native process stopped immediately.

**Done when:** a real authorized observation can lead to a useful note/private
result and one unsolicited return in Luca's DM; restarting cannot duplicate it;
quiet hours, Pause, revoked access, and foreground conversation prevent an
inappropriate interruption. Unsupported runtime paths say unavailable honestly.

### F5 — Integrate, prove, package locally

Reuse the approved ask sheet rising from the actual composer, compact receipts,
and genuine activity states. One active approval at a time; details secondary;
no synthetic progress, focus stealing, forced scrolling, or new visual effects.
Companion configuration remains reachable from the agent's settings without Luca.

Run the focused matrix below, review the actual render, then make one candidate
using the shared native build cache. Preserve the current walkthrough and daily
profiles; test fresh setup and a backed-up existing profile separately. Nothing
published, tagged, signed, pushed, or installed over the daily app in this work.

## Verification matrix

- **Permission contract:** no source bodies before approval; independent scopes;
  cancellation; duplicate request; partial availability; paused/revoked/stale
  approval; owner/resident/model isolation; no automatic upgrade enablement.
- **First value:** real source-backed detail, late approval after greeting,
  missing/empty/slow history, ordinary typed interruption, task-first path,
  optional choices, context remains bounded, no repeated setup on restart.
- **Memory:** enable is not a save; retained note has evidence; correction/forget
  changes later behavior; disabling retention does not falsely promise removal of
  copies already in provider/harness history.
- **Initiative:** approved observation → private work → useful return; no-change
  path; exact-once delivery across recovery; quiet hours/rate limit; paused pending
  return; foreground preemption; unsupported provider and unavailable Mac states.
- **UI:** current shell in both themes; compact and wide layouts; keyboard/focus;
  reduced motion; no overflow/jumps; chat remains usable during discovery/read;
  agent-settings access and a truthful changed-settings receipt.
- **Native reality:** at least one fresh live Claude path and one live Codex path
  if available, plus existing-profile upgrade and restart. If a provider is
  unavailable, label that check unverified; fixtures are not live proof. Ask Riley
  only for genuine permission clicks or inaccessible native-window foregrounding.

Start with relevant first-meeting, companion configuration/follow/history,
awareness, initiative, and delivery unit tests. Update the existing
`polyphonic-first-conversation`, production-onboarding, companion-settings, and
companion setup browser coverage, adding only cases these changes require.
Then run typecheck, scoped lint, diff checks, and a fresh frontend build before
browser checks. A native build overwrites `dist`; rebuild browser fixtures before
using them again. Baseline unrelated failures separately, never hide regressions
behind an old full-suite failure count.

## Execution discipline

- Build order: **F1 → F2 → F3 → F4 → F5**. Write focused tests alongside each
  boundary, not after a monolithic build. Review each step's finish line before
  moving on. No redundant full-suite or native rebuild after every prompt edit.
- One heavy build/test run at a time. Check free space first and use only
  `~/Library/Caches/luca-build/cargo-target` via the existing wrapper. No active
  workspace/cache on external drives; no cleanup of other sessions' recent files.
- Freeze scope: no new harness integrations, agent teams, Ghost changes, Mnemos,
  social connectors, marks/composer redesign, general settings rebuild, or new
  onboarding dashboard. Do not fold Claude's unrelated design work into this task.
- Success evidence is local test receipts and observed walkthrough behavior, not
  new silent analytics. The final report separates implemented, tested, unavailable,
  and still awaiting Riley's walkthrough. A green build is not release approval.

No further product decision is required to start F1. The quiet-hours default is
an explicit conservative proposal, not a claim about current behavior; its time
zone, pause semantics, and delivery behavior must be tested before enabling it.

## Integration decisions discovered during implementation

- **Initial context arrives on the next ordinary chat turn after approval.**
  A raw mid-turn tool reply would bypass the existing native source-framing lease
  and automatic-memory provenance checks. Instead, the explicit bounded sample
  enters the existing ephemeral profile-observation buffer, with real child refs.
  Setup returns body-free receipts; the next normal turn consumes only still-
  authorized context. No synthetic owner message or hidden extra model turn is
  created. This is a deliberate timing difference from the original same-turn
  concept, not a claim that setup receipts themselves contain an insight.
- The 64-KiB limit is the visible-message tail bound. Existing bounded safety
  prefixes for native eligibility/private-session exclusion are also inspected;
  those bytes never enter the model context. Do not describe this as 64 KiB of
  total filesystem I/O.
- Aware replies cannot automatically seed retained work. The normal taint rule
  remains intact. A separate narrow first-meeting action can carry only the exact
  signed **current owner message** when it states a genuine goal, under existing
  continuity and bounded-background permission. The model supplies an event ref,
  never a body or summary; closed or declined goal identities are not reopened.
- Meaningful-note permission is not proof of a save. Existing disabled resident
  continuity remains disabled and is reported as not ready, rather than silently
  reenabling it. A saved goal is not proof of background execution or completion.
- Proactive return approval is separate from note promotion and model egress:
  ordinary Polyphonic return messages are readable by that chat's relay. The
  review discloses this explicitly, alongside subscription use, a one/day limit,
  and actual local quiet times. Quiet times can be customized through a new
  reviewed setup request; no clock or unrelated app settings are changed.

These decisions are implementation contracts. Native execution, live-provider
behavior, and candidate readiness must still be verified and recorded separately.

## Local verification checkpoint — 2026-11-03

F1–F4 code and focused regression coverage are implemented; F5 native packaging
and live-provider walkthrough remain pending. This is not release approval.

- Native focused checks pass for first-meeting persistence/guidance (26),
  companion awareness/initiative (175), managed permissions (28), initiative
  cognition (3), runtime-task delivery (40), continuity (7), and initial sampling
  (2). Filters overlap; these are not a summed unique test count.
- MCP tests: 113 pass. Protocol tests: 94 pass. Scoped Codex initiative:
  5 pass, one opt-in native-provider smoke remains ignored, not live proof.
- Typecheck, fresh shell-enabled frontend build, scoped Biome, text-size checks,
  candidate-script tests (24), and diff checks pass. File-size checks exit zero
  with informational warnings; no limits were raised.
- The setup review's twelve browser cases pass, including both themes at 1440,
  1280, 1024, and 390 pixels, keyboard order, and independent decisions. Visual
  inspection caught long disclosure text overlapping controls; the setup-only
  text now flows normally, without changing the approved card/composer design.
- All 31 focused browser cases now pass after reconciling older fixtures with
  the shipping agent-page navigation. No production navigation was changed to
  satisfy retired selectors. Recovery uses a real failed-discovery/retry path.
- A final control review found and repaired a late-Pause race between following
  and enabling background work. A reviewed denial generation fences the entire
  policy commit/resume, and Pause is persisted across restart. The final native
  rerun passes initiative (47), setup (6), and delivery (40) cases.

No real personal-source consent was granted during these checks. A real saved
note and later recall, live Claude/Codex setup, a real proactive return, native
rendering, and existing-profile upgrade/restart are still distinct walkthrough
checks. Browser fixtures and enabled-settings receipts do not prove those paths.
