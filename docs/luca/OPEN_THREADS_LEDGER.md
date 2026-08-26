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
remove sender titles/logos entirely; user = subtle right-anchored bubble;
identity by position/anatomy, not repeated names+logos; visits get a subtle
frame instead of the current chrome; runtime icon per sender is too noisy
(the existing hide-marks toggle stays). Design work — Riley+Fable lane.

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

## E. Separate tracks (live, but their own lanes)

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
