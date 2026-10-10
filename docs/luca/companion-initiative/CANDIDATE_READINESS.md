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

- [ ] Reconcile current non-design shipping fixes; leave experimental visuals out.
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

## Scope retained

Social connectors, iMessage, agent teams, new design directions and always-on work
while the Mac is asleep remain deferred. No full-suite repetition after each
small patch; prioritize privacy, data loss, duplicate actions, misleading controls
and the ordinary new-user experience.
