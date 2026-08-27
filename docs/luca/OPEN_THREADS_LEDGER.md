# Open Threads Ledger

Compiled 2026-08-26 (~2:30am) at session close, by Fable with Riley, after a
memory sweep (session memory + `HANDOFF.md` + `docs/luca/`). This is the
consolidated to-do/parked picture for anyone — especially Codex — picking up
work. Where a status says **VERIFY FIRST**, the fact was true when last
recorded but has not been re-checked; confirm against git/the running system
before acting on it.

Standing constraints that govern everything here: push/merge to the live line
is Riley-only; no test launch may target a real keyring service without a
verified backup of its items (the 08-26 custody freeze); Riley's canonical
Dev profile and real keychain are read-only.

---

## PARKED — do not resume without Riley

**The glass/theme arc.** Riley's verdict on the final fixed build (2026-08-26):
"it looks much better, but i dont like it, and i dont want to deal with it."
Branch `codex/polyphonic-glass-shell-integration` (worktree
`~/.codex/worktrees/e5f6/luca-agent-network-v1`, 6 fix commits over
`5c8899305`) stays local and unmerged as the record. The installed
"Luca Agent Network Dev.app" IS that build. The full diagnosis is in the
audit doc (`GLASS_AUDIT_2026-08-26.md`, session scratchpad; findings
summarized in the polychat common-room). Key transferable laws learned:
glass/vibrancy alphas are only solvable on-device (the lab proves
composition, never the native backdrop); an undefined CSS custom property
silently kills its whole declaration; the CSS minifier collapses literal
standard/`-webkit-` backdrop-filter pairs (route the standard form through a
`var()`); Tailwind v4 `dark:` here keys on `prefers-color-scheme`.

---

## A. Product queue (the live work)

### A1. Owner backup + the missing onboarding backup stage — RECOMMENDED FIRST
Riley's fresh owner identity (created 2026-08-26 after the custody incident)
has **no backup**. Two halves:
1. Have Riley create a protected backup via Settings → Security & backup
   (verify the flow works on the current build).
2. The onboarding wizard's backup/passphrase stage has been **silently
   missing for weeks** (Riley: "the onboarding has been missing the whole
   backup and passphrase stage for weeks and i assumed it was removed while
   we built"). Find in git history when/why the stage vanished from the
   onboarding flow (`desktop/src/features/onboarding/`), restore it, verify
   the full first-run flow in the e2e harness.

### A2. Onboarding breaks (observed by Riley 2026-08-25/26)
- The runtime picker's in-dialog npm install of the Codex/Claude ACP
  adapters didn't work when tried.
- The runtime list offers **Grok** but the validator rejects it ("default
  runtime must be Codex, Claude Code, Hermes, or OpenClaw") — list and
  validator disagree.
- **Back** is disabled mid-wizard.
- Agent import failed when one agent was selected.
- Caveat: under an isolated `$HOME` the detector can't see adapters in the
  real home — re-verify detection on a real profile before treating
  "Install via npm shown for installed runtimes" as an app bug.

### A3. The core-chat gap inventory — audited 08-24, never implemented
`design-lab/audit/gap-inventory.md` on branch `design/lab` (severity-ranked;
companion docs in the same folder). Riley's "big batch" selection reply
never happened — re-raise with him before building. Highlights:
- **P0**: self-erasing failure states; invisible dead backend; eternal
  retry. (The sticky PersonalHomeGate first-error latch that every e2e spec
  works around is this family.)
- **P1**: rich activity protocol — Riley RULED full transparency, extend
  `ManagedPresentationFrameV1`; elapsed time on turns; no motion on own
  messages; zero user/agent anatomy differentiation (answered by A4, via
  geometry not labels); blue focus-ring canon violation; dead-end ⌘K
  results.

### A4. The messaging "quiet pass" (queued design, Riley 2026-08-26)
Direction recorded in session memory (`luca-messaging-ui-quiet-pass`):
user = subtle right-anchored bubble; identity by position/anatomy; visits
get a subtle frame instead of the current chrome. (Riley 2026-08-26: the
sender-icon removal item is DROPPED — the settings toggle covers it.)
Design work — Riley+Fable lane. SUPERSEDED IN PRIORITY by the messaging
feel work: Riley's ruling is that the messaging experience (send motion,
thinking animations, activity transparency, transitions) is THE most
important thing in the product.

### A5. Conversation-model holes (decided, unimplemented)
- `docs/luca/REPLY_ADDRESSING.md` — the who-does-a-reply-wake rule. Decided
  and unimplemented; carries an agent-to-agent loop risk that must be
  settled before it ships.
- The sibling-loop guard (two residents replying to each other forever) —
  flagged as an open hole since 08-18.

### A6. Projects data model
`docs/luca/PROJECTS.md`: design settled, UI prototyped, data model NOT
built. Hard constraint: a local repo path must never go on the relay.

---

## B. Merge/branch debts — ALL VERIFY FIRST (recorded 08-21→08-25)

- **Landing order** (08-24 plan): `design/lab` → `codex/stability-acceptance-fix`
  (hand-resolve ~14 core-chat presentation files) → glass last. Whether the
  stability branch (was LOCAL-ONLY, 20 commits) ever landed on `luca/v1.1`
  is unverified.
- **The pre-window CPU hang** was THE merge blocker for v1.1 (synchronous
  connected-Brain reconciliation, `watcher.rs:81` via `lib.rs:517`; suspect
  commit `b35ad6f22`; owner Codex; snapshot experiment was pending). Status
  unknown.
- **`agent/exchange-object` → `luca/v1.1`**: the actual "ship it" merge for
  the exchange feature — never assigned to anyone.
- **`codex/visits`**: reviewed + four follow-up fixes pushed (origin
  `ca2c297c`), merges cleanly, but **never live-tested end to end** — nobody
  has watched a real visit open and fade in the running app.
- **`codex/cleanup-after-exchange` (`4522b1f8`)**: never had its review pass
  (check: nothing from the do-not-restore list came back; gates green
  without weakened assertions).
- **`agent/typography` worktree** (~170 uncommitted files on the canonical
  worktree, 08-21): resolved into design/lab or still dangling? Verify; do
  not stash/revert it.
- **Doc split / repo truth**: `docs/luca/EXTENSIONS.md` lives on
  `agent/identity-glyphs`; the panes/widgets study + old port plan live on
  `design/lab`; `HANDOFF.md` is stale (updated 2026-08-04, still names
  `agent/runtime-reliability` as the authoritative branch) and sits
  modified-uncommitted in the main checkout. Repository-truth cleanup is
  unowned.

---

## C. Designed-but-unbuilt (08-24 session leftovers, nobody's queue)

1. **The agent's place** — designed/prototyped in the study; needs real data
   models (per-agent gallery = artifacts + their conversations).
2. **User-authored widgets** — doctrine exists in `docs/luca/EXTENSIONS.md`
   (manifest, durable mounts, owner-granted scopes, offer-vs-install
   manners); the widget FORMAT itself is undesigned.
3. **"No closed doors"** — decided doctrine (owner can always SEE any
   household room; joining is one click); written in EXTENSIONS.md, not yet
   reflected in the conversation-model docs or app behavior.
4. **Tiling two live conversations** — UI proven in the study; needs
   conversation-state plumbing (which subscriptions run).
5. **OS-level floating windows** — panes leaving the app window; merges with
   the Prompt Ghost/notch embodiment thread. Standing doctrine: any window
   that leaves the app is glass, system-appearance-following.
6. **Crowning the default look** — whether the app default moves off Slate.
   Riley's call, never made.
7. **Codex palette heads-up** — outstanding since 08-23: the theme landscape
   context any UI-adjacent Codex work needs.

---

## D. Small / mechanical (good unglamorous starters)

- **Full-suite re-baseline**: the complete desktop Playwright suite (~820
  tests) has never been run with the correct `build:e2e` build. Known
  pre-existing failure: `channels.spec` targets obsolete
  `section-actions-dms` testid.
- **Hermes/OpenClaw logo assets**: drop SVGs into
  `desktop/src/features/onboarding/assets/harness-logos/`, register in
  `HARNESS_LOGOS` (`shared/ui/HarnessLogo.tsx` currently falls back to a
  monogram tile).
- **Pane-system STOPs** (decisions or small fixes): lifted pane leaves an
  empty docked card (collapse? ghost?); `glass-widget-sample` flag has no
  entry in `preview-features.json` (localStorage-only; add with
  `defaultEnabled:false` if wanted); Widgets toggle renders on all five
  shared-aside call sites — confirm intent.
- **Design-reasoning note**: drawer-as-card, plate token,
  threshold/inset/thread construction and ink relationships live only in
  commit messages + session memory; a short `docs/luca/` note is owed.
- **Scratch cleanup**: `/private/tmp/luca-*` scratch homes; scrap keyring
  service `buzz-desktop-dev.scratch-diag` (verify contents are junk before
  removing — see the custody freeze).
- **HANDOFF.md refresh** (see B, doc split).

---

## E. Designed in the lab, NEVER ported to the app

The two-glass port deliberately carried only the glass MATERIAL system
(themes, two-weather CSS, held things, strokeless) into the app. These
finished lab designs did not cross and exist only on branch `design/lab`
in `design-lab/panes-and-widgets.html` (durable worktree:
`/Volumes/LaCie/Luca-Development/worktrees/luca-design-lab`; the same file
also sits in the parked e5f6 worktree). Lab commits named per item. Losing
this file/branch loses the designs — treat it as source of record.

1. **The ⌘K command palette redesign** (`96a7e73aa` "The palette learns the
   industry idiom" + `1eb4a50f6`): Raycast/Linear anatomy — dim+blur veil,
   620px / 16px type, grouped rows, keycap hints, footer hint bar. The app
   still runs the plain `TopbarSearch.tsx` Radix dialog (its dead-end
   results are a gap-inventory P1). Recorded implementation note: a
   cmdk-style refactor was scoped out of the port; CSS-only glass went in.
2. **The rail footer becomes real** (`db335068e`): profile footer CARD
   anatomy + its popover (workspace/profile actions). App footer is still
   the plain profile row.
3. **The settings scene** (`1eb4a50f6`): the lab's settings anatomy
   (nav/panel composition, option-group treatment). The app's settings only
   received glass paint, not this anatomy.
4. **Top-chrome cluster** (anatomy rounds): the header/top-chrome
   composition designed in the lab.
5. **"Today learns to scroll"** (`db335068e`): non-sticky day dividers that
   scroll with their day (no background, no mask). The app deliberately
   kept its sticky pill during the port (recorded divergence — the taste
   call was never made).
6. **The popover glass family** (`5253185b1`): popover/menu treatment as
   designed in the lab (the app got the deep-panel CSS but not the lab's
   popover anatomy).
7. The older study scenes in the same file (agent's place, the
   widget-as-instrument, drawer contents, tiling, lifted pane) are tracked
   in section C.

The parked glass arc's full diagnosis is preserved at
`docs/luca/audits/GLASS_AUDIT_2026-08-26.md` (was session-scratchpad only).

---

## F. Separate tracks (live, but their own lanes)

- **The Polyphonic landing thread**: `docs/luca/LANDING_BLUEPRINT.md` +
  `LANDING_BUILD_BRIEF.md`, the notch prototype (recent commits on this
  branch), `desktop/tests/e2e/marketing-northstar.spec.ts` (untracked).
  Active immediately before the glass arc swallowed the week.
- **Mobile companion**: `prototypes/luca-mobile-companion/` +
  `docs/luca/MOBILE_COMPANION_PROTOTYPE_RESEARCH.md`.
- **Unified Brain**: `docs/luca/unified-brain/` packet (owner-brain
  boundary, import, memory, graph, milestones). Status unknown.
- **Polychat feature track (Codex's)**: linked mode, the `/invoke`
  away-status guard hole, speaker-allocation bug, read receipts, the
  turn-timeout env patch (uncommitted in Codex's tree).
- **Visions** (`VISION_SOCIAL_INTELLIGENCE.md`, `VISION_DEMO_BLUEPRINT.md`):
  horizon documents, not todos.

## Addendum 2026-08-26 (feel work): the pre-existing e2e red list, measured
While gating the messaging-feel branch, the same 15 tests failed on BOTH
the branch and its base (`b596a6e34`) — pre-existing, not regressions,
and now enumerated for the re-baseline debt (section D):
wake-on-send.spec :51 :94 (resident-activity-word never appears);
messaging.spec :115 (npub owner label renders "You"), :143 (same-label
family), and the whole thread-panel family :979 :1044 :1091 :1141 :1172
:1229 :1258 :1367 :1408; send-channel-binding.spec :51 :143 (agent-
mention delivery asserts). Good unglamorous Codex material: likely a few
shared root causes (a testid/label drift + a thread-panel harness break),
not fifteen separate bugs.

## Addendum 2026-08-26 (polish pass): smoke.spec joins the pre-existing reds
`smoke.spec.ts` fails 13 of 20 on BOTH the polish branch and clean base
`bafb3f556` — same stale-testid family as the documented
`section-actions-dms` item (e.g. `stream-list` no longer exists in the
modern sidebar). App-shell load, stream creation, agents, inbox feed,
search, channel switching, multiline drafts all trip on it. Belongs to
the section-D re-baseline debt, not to any feature branch. The
"capped participant stack" channels test also fails in SETUP on that
same obsolete `section-actions-dms` testid (its DM-intro assertions were
updated for the intro removal, but the test cannot reach them).

## Addendum 2026-08-26 (later): buzz-acp parallel-test flakiness, measured
`cargo test -p buzz-acp` fails 2–6 tests under parallel execution with a
CHANGING set per run (config env-ceiling tests, a script-spawn fd test,
observer tests) and passes 769/0 with `--test-threads=1` — env-var races
between tests, pre-existing. Add to the re-baseline debt (section D):
either serialize the env-touching tests or scope their vars.
