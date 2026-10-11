# Companion candidate readiness — 2026-10-10

Riley authorized completing the readiness work and preparing an isolated native
candidate for a walkthrough. Do not publish, tag a release, change the public
updater, or replace the installed app before that walkthrough and approval.
Request owner interaction for new macOS/browser permission grants. Use disposable
test sources, not personal browsing or screen contents. Keep active builds on the
internal SSD and preserve the separate design exploration.

## Starting checkpoint

- Feature: `codex/companion-initiative-2026-10-07`, `bddef66b3`.
- Published build: `v0.5.0-beta.13` in `Riley-Coyote/polyphonic-app`.
- Shipping source: `codex/first-meeting-finish`, `f96a3c7bc`.
- Source-only bundle of the feature delta verified before changes.
- Prior native proof: automatic Codex planning/pursuit completed with a valid
  no-change result; completed-job restart did not replay it. This is not evidence
  of a created Library artifact or observed browser/screen activity.

## Gates

- [x] Reconcile current non-design shipping fixes; leave experimental visuals out.
- [ ] Library artifact opens, closes visibly and by keyboard, and survives restart.
- [ ] Real authored creation/private inquiry follows the initiative persistence path.
- [ ] Native setup and effective background Pause/Resume/Stop behave as displayed.
- [ ] Browser/machine observation permission and withdrawal have native proof.
- [ ] Foreground priority, interruption/recovery, and bounded resource use checked.
- [ ] Relevant Rust/frontend checks, typecheck, build and diff checks pass.
- [ ] Fresh candidate plus disposable existing-profile upgrade walkthrough checked.
- [ ] Isolated signed bundle, source receipt, launch instructions and rollback ready.
- [ ] Riley walkthrough completed (owner gate).
- [ ] Release publication authorized (owner gate; do not perform now).

Update each gate only with evidence and record any limitation rather than treating
a mocked or lower-level check as native end-to-end proof. A declined/no-change
resident result remains valid; do not impose an output quota to pass acceptance.

## Candidate preparation evidence

- Integrated the download/documentation corrections and incremental connected
  Brain refresh from the shipping line. The unapproved Obsidian visual commit
  remains excluded. The shipping and website checkouts were not changed.
- Focused checks passed: 128 companion tests, 55 connected-Brain tests, 10
  private-Notebook tests, 18 candidate-script checks, 15 frontend unit tests,
  16 browser checks (including Library close controls at 800/1024/1440px),
  12 browser-connector tests, typecheck, frontend build and scoped formatting.
  These are not a claim of real browser/screen permission acceptance.
- Native upgrade retained the synthetic conversation and the exact completed
  background job, timestamp and result reference without replay. The native
  setup review correctly persisted background off/on; Not now made no change.
- Native observation exercised only a generated disposable text file. Pause
  stopped its reader; resuming observation did not resume background work.
  Background resume required its own review. Note retention, model egress and
  conversation use stayed off. No personal sources or OS capture grants were
  enabled. Real browser/OS permission grants remain an owner walkthrough gate.
- Native foreground Library creation exposed a producer/consumer mismatch:
  ACP projected a conversation token while the restricted tool process still
  required old per-turn coordinates. The process exited before initialization.
  The candidate fix introduces an explicit turn-gate bootstrap mode, retains
  exact-turn compatibility, reads bounded newline responses without waiting for
  EOF, and accepts only bound successes or explicit closed gate refusals.
  The trusted host still resolves and authorizes the exact active owner turn;
  the tool/model cannot choose or advance it. OpenClaw projection validation and
  environment scrubbing follow the same explicit mode. Regression coverage
  includes real process initialization, not merely in-memory client parsing.

Final native results, candidate path, source receipt and owner walkthrough
instructions are recorded alongside the signed local candidate under
`~/Documents/Polyphonic-Candidates/2026-10-10/`. Pending gates above are release
gates, not permission to publish after a successful build.

## Scope retained

Social connectors, iMessage, agent teams, new design directions and always-on work
while the Mac is asleep remain deferred. No full-suite repetition after each
small patch; prioritize privacy, data loss, duplicate actions, misleading controls
and the ordinary new-user experience.

## Walkthrough corrections — 2026-10-11

- `configure_companion` now supports chat-led Claude Code/Codex following:
  metadata-only discovery of the standard profile containers, one host-owned
  approval for visible activity and sharing with the current model, then saved
  choices and live reader startup. No normal folder picker, Brain connection,
  old-history import, raw archive, note retention, browser access, or automatic
  background-work enablement is bundled with this action. Missing/unusual
  profiles still use the advanced controls.
- Awareness Pause/Resume and background Enable/Pause/Resume/Disable use direct
  typed operations and truthful chat receipts. Widening requires approval;
  intervening owner settings changes invalidate a pending approval. Other
  settings are not claimed writable unless an existing tool supports them.
- Explicit chat-following profiles can resume after a normal app/resident
  restart, but only with the same active owner, current model binding, saved
  source/history consent, and unpaused state. A changed model binding or a
  withdrawn grant never silently acquires renewed approval.
- `read_conversation_image` validates the owner's signed attachment in the
  current conversation, fetches same-relay protected media inside the desktop,
  and returns actual MCP image content. It exposes no credential or arbitrary
  URL proxy and never searches personal screenshot folders.
- Focused checks: 132 companion, 19 first-meeting, 30 media, 1 exact-conversation
  image-authority, 112 MCP and 94 protocol tests passed. Frontend typecheck and
  the generated shell-lab build passed. Source diff checks exclude the generated
  lab's pre-existing/vendor inline-string whitespace; those strings were not
  rewritten for lint cosmetics.
- The initial app-control edge/badge was an isolated `experience=companion-control`
  study. Three presets, bounded controls, saved variations,
  Stop/settings-only states, reduced motion, keyboard operation and compact
  layout were exercised in the browser. Native control lifecycle/Stop integration
  initially awaited Riley's direction; the study does not operate the app or grant access.

The next signed candidate uses Riley's existing walkthrough profile without
resetting it. Real personal-source consent, follow/restart behavior and an image
in a live model conversation remain explicit walkthrough checks; lower-level
tests are not a claim of that native end-to-end proof. Publication remains gated.

## Manual companion management — 2026-10-11

- Agents → select a resident → Settings now has a visible Companion settings
  entry above Appearance. It opens the existing owner-reviewed setup controls
  for that resident, including when stopped and without an existing chat.
  Merely opening it does not start a resident or grant access.
- The same panel remains available from chat. Agent settings has a contextual
  Back to agent action, initial focus stays inside the panel, and dismissal
  restores focus to the entry button. The new section responds to its pane's
  width without changing the other settings layouts.
- Frontend typecheck/build, scoped lint and six browser checks passed: direct
  access, resident switching, stopped/no-chat access, keyboard/compact layout,
  unavailable-state reopening, and the existing setup permission regressions.
  These use fixture IPC; they do not enable personal observation or replace
  the native owner walkthrough.
- Three additional agent-library checks passed for workspace/Notebook
  navigation, stopped native startup, and start-on-open settings.
- No agent configuration rules changed: runtime/model configuration and grant
  authority still use their existing implementations. Nothing was published;
  the signed local candidate is refreshed separately with the same test profile.

## Approved Soft halo integration — 2026-10-11

- Riley selected Soft halo: a neutral 1px edge, 24px inset glow, slow opacity
  breathing, resident identity and an accessible Stop badge. Reduced motion is
  steady; the edge never intercepts input and the badge remains opaque/readable.
  This carries the existing approved lab treatment into production components,
  following the Emil design-engineering guidance without redesigning the shell.
- Supported native `polyphonic_open` navigation now has an exact owner/resident/
  conversation/session/turn-bound, 15-second request. Only the main owner
  webview can begin/complete/stop it. A brief automatic handoff offers Stop before
  opening the requested surface. Completion is acknowledged rather than assumed
  from emitting an event. Timeout, caller disconnect and terminal turns fail closed.
- Stop prevents pending navigation and further native navigation retries in the
  same turn. It does not undo an already-opened page or cancel unrelated model
  work. New owner turns can navigate normally. Settings mutations continue using
  typed tools and chat receipts; they do not trigger the halo.
- Scope is deliberately truthful: external computer-use MCPs do not currently
  provide a Polyphonic-owned start/stop lifecycle. Their cursor/control is not
  covered by this indicator. Legacy relay navigation also has no cancellation
  lease and therefore does not display a misleading Stop control.
- Verification: typecheck and build:e2e passed; 12 focused native tests and eight
  browser checks passed. Browser coverage includes normal completion, a late
  Begin after Stop, host disconnect, failed authorization, unauthorized requests,
  settings-panel regressions, keyboard and compact/reduced-motion behavior. The
  production component was visually inspected in browser screenshots. Browser
  IPC is synthetic, not proof of a live resident/native window round trip.
- First browser run hit intermittent blank-page asset loads with the Python test
  server; the unchanged settings specs also failed there. The verified run used
  a Vite preview server and one worker. Existing compiler/chunk warnings remain.
- The signed isolated candidate is prepared for Riley's existing walkthrough;
  installed apps, personal permissions and the public update feed are untouched.
  Live-model navigation and Stop remain owner walkthrough checks, not a release
  approval or a claim of universal computer-control coverage.
