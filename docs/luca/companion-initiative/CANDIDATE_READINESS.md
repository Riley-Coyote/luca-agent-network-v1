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
