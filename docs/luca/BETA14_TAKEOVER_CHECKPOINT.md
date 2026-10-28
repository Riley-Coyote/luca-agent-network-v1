# Beta.14 release preparation checkpoint — October 27, 2026

Riley asked Codex to take over beta preparation after the Mac/Claude recovery.
Nothing was published, and no native app was installed, stopped or launched.
The installed app, candidate profiles, Ghost and provider state remain unchanged.

## Integration source

- Checkout: `/Users/rileycoyote/Documents/Repositories/.claude-worktrees/luca-beta14-polish`
- Branch: `claude/native-rail-glass`
- Product checkpoint: `baf91472f`.
- The complete committed October 22 consolidation (`a01d5b525`) is already an
  ancestor. Do not merge its remaining dirty Mnemos work.
- The running Rail Glass Candidate still reports `8ba79cf6f`; it has **not**
  been rebuilt from this checkpoint.

## Completed in the takeover

- `13180d5ed`: repaired three test assumptions without changing product behavior.
  The frame/Settings checks now count the restored Brain place (WP-38), Settings
  heads match the approved sentence-case treatment (WP-37), and the rail reload
  test recreates its in-memory mock conversations before checking the persisted
  collapsed state. The real relay does not lose those conversations on reload.
- `baf91472f`: merged the finished `claude/quickchat-glass` commit `d0ef1ffc1`.
  Includes glass mini-chat motion/material and whole-pixel saved sizing, not the
  separate composer redesign.

## Verification

- Prior complete shell run at `8ba79cf6f`: 398 passed, 13 skipped, 4 failed.
- All four former failures pass together after the test repairs (4/4). The
  timeline timeout did not reproduce. This is a focused rerun, not a claim of
  another complete-suite pass.
- At the integrated product checkpoint: TypeScript, frontend e2e build,
  text-size guard, and diff checks pass; mini-chat unit tests 16/16;
  `luca/quickchat.spec.ts` browser tests 10/10.
- The first mini-chat browser run used Python's default HTTP server and dropped
  module requests (`ERR_CONNECTION_RESET`), leaving blank pages. The unchanged
  tests passed on the project's threaded, deep-queue `tools/serve.py`. Use that
  server for future static proofs, not `python -m http.server`.
- Evidence for this session: `/private/tmp/polyphonic-beta14-takeover-hDMZQW`.
  Browser proofs simulate the host; native glass still needs the actual app
  walkthrough. No new native build, notarization or updater signing was done.
- Internal free space was approximately 33 GiB at the first checkpoint, then
  approximately 22 GiB during the independent preparation pass while other work
  continued. No Rust cache was created or cleared. Recheck immediately before
  final compilation; keep the default 20 GiB preflight reserve and the shared
  heavy-job queue, rather than lowering the reserve to force a build.

## Independent preparation completed

- The candidate entrypoint's fixture tests pass **20/20**. They cover separate
  profile identity, no automatic updater, source/helper receipts, stale-PID
  refusal, preserving unowned data, and refusing a second compilation cache.
- Storage/helper-staging fixture tests pass **9/9**. The generic internal-build
  helper now also rejects every target other than
  `~/Library/Caches/luca-build/cargo-target`; previously it allowed additional
  folders below `luca-build`. No cache or user data was removed.
- `scripts/test-release-ref-contract.sh` passes: three accepted tag forms and
  six refusal cases. It no longer requires the upstream Buzz workflows removed
  by WP-30. Added checks cover annotated beta tags, missing refs/tags, invalid
  versions and the wrong version's tag. All fixture tags stay in a temporary
  repository; no release tag was created.
- Located and read Claude's successful native test log:
  `/private/tmp/claude-501/-Users-rileycoyote-Documents-Repositories-luca-agent-network-v1/67cbca2e-7f2b-4c1d-aaab-d9c9e4819a3c/scratchpad/lab/cargo.log`.
  It reports **2,929 passed, 0 failed, 18 ignored**, exit 0. Native source,
  crates and Cargo manifests/lock are unchanged between `d0ef1ffc1` and the
  integration checkpoint. This is verified baseline evidence, not a fresh
  native test run. The older `rust-lib-tests*.log` files have a prior failure;
  do not use them as the latest result.
- Read-only checks of the existing Rail Glass Candidate at `8ba79cf6f`:
  nested code signatures verify; bundle identity is
  `chat.polyphonic.desktop.rail-glass.dev`, version `0.5.0-beta.14`; its receipt
  and environment identify the isolated Rail Glass instance. The binary carries
  the glass attachment, declares minimum macOS 14.0, and imports both newer
  AppKit glass classes weakly. This is a debug, non-notarized test app, not the
  final release artifact or a runtime test on older macOS.
- Shell syntax and diff checks pass. No product/UI code changed in this pass.

## Pending before source freeze

- `claude/rail-project-rooms`, checkout `.claude-worktrees/rail-project-rooms`:
  Claude is still running the full suite. At 22:24 CDT its report said types,
  lint, text guard, 4,404 unit tests and 60 focused browser checks passed, with
  the classic layout matching the base twice. Work remains uncommitted; do not
  edit or snapshot it while that session is active. Its changed rail test also
  overlaps our small reload-fixture repair; preserve both during integration.
- `claude/new-chat-composer`, checkout `.claude-worktrees/new-chat-composer`:
  uncommitted refinements are still presented for Riley's review. Types/lint/
  text guard were reported passing; unit/browser acceptance was not finished.
  Its QuickChatPanel/CSS changes overlap the merged glass work; reconcile by
  intent, never replace those files wholesale.
- Riley has now explicitly approved including the finished composer, rail and
  mini-chat updates in this beta. No further scope question is needed for them.
  Other approved UI refinements need a completed source checkpoint and checks
  before inclusion; fingerprint identities were still a design preview at the
  last inspection, not implemented candidate code. Mnemos remains explicitly
  deferred to a later update.

## Final integration and acceptance sequence

1. **Take completed handoffs.** For each UI branch: exact commit, changed files,
   approval state, checks and remaining issues. Leave active dirty worktrees
   alone. Review/integrate by intent on `claude/native-rail-glass`, preserving
   mini-chat glass and the rail reload-fixture repair where files overlap.
2. **Freeze one combined source.** Record a clean commit. Update release notes
   from what actually landed, not prototype promises. Keep Mnemos WIP and the
   unapproved older Obsidian WIP out. No separate candidate for each UI branch.
3. **Run final integrated checks.** Types, scoped lint, text-size guard, unit
   suite, complete shell suite and required Rust/relay checks. Use the shared
   queue; no simultaneous build and browser test from this session. Serve
   browser proofs through the threaded `tools/serve.py`. Reuse verified native
   baseline evidence during preparation, but satisfy the final release plan's
   native gates at the frozen checkpoint. Do not hide genuine failures behind
   the earlier four-test baseline.
4. **Review the important interactions.** Composer typing/paste/attachments,
   multiline growth, send/stop, narrow widths and keyboard focus; rail chat and
   project switching, expand/collapse, persistence and one Luca conversation;
   mini-chat opening/closing/resizing, picker and full-conversation handoff.
   Include light/dark, solid/glass, Classic layout, reduced motion/transparency,
   drag areas, traffic lights and detached-window controls. Check basic Luca
   setup, consent/pause, screenshot access, an existing delegated session and
   a new delegated task, without enabling additional observation permissions.
5. **Package sequentially in the one shared cache.** Recheck disk and active
   jobs first. Build the production-overlay release-mode artifact for static
   inspection, with updater artifacts explicitly disabled for the walkthrough
   stage. Do not launch it on Riley's account. Build the isolated Rail Glass
   behavioral candidate from the same commit. Stop its exact owned process
   deliberately before replacing that bundle; preserve its instance/profile.
6. **Verify the final artifacts, not just the config.** Exact source/version,
   shell-on frontend, release/debug distinction, architecture, all six helper
   hashes, nested signatures, entitlements, minimum OS and weak glass symbols.
   Production release needs hardened runtime. The current debug app's passing
   signature is not a substitute. Keep update endpoints/keys unchanged and
   never log private-key material.
7. **Walkthrough and rollback.** Refresh/verify the matching app-and-data backup
   before any owner-approved daily-app switch. No profile replacement or data
   merge is needed during this preparation. Riley tests the combined isolated
   candidate; fresh install and beta.13 upgrade acceptance use the actual
   release-mode app in a disposable macOS account, per the release README.
8. **Only after Riley says ship:** updater signing, notarization/stapling and
   final DMG/updater assembly from the same app; compare extracted contents and
   smoke-test the distributed artifact. Then the approved tag and uploads,
   immutable assets before the manifest. No publication in the preparation pass.

## Integrated by Claude after this checkpoint (2026-10-27, ~23:40 CDT, at Riley's word)

Riley to Claude: "Yes, merge them" (the glass mini chat and the projects fix). The mini chat was already in
(`baf91472f`), so only the projects fix landed:
- The merge is `merge(beta14): a project's rooms sit under it again` (the projects-rooms commit `103e3b6d7`), made in a
  scratch worktree and fast-forwarded here.
- Your reload-fixture repair in `shell-chats-rail.spec.ts` (`13180d5ed`) and the projects change to that same file are
  both kept, checked line by line.
- On the merged source: `tsc` 0, biome clean on all 10 merged desktop files, text guard 0, and unit tests 4,411/4,411.
  On a fresh `build:e2e` served by `tools/serve.py`, the browser specs `shell-chats-rail`, `shell-project-rooms`,
  `shell-frame` and `shell-settings` passed 32/32.

Also in flight, on branches of their own (not merged; integrate by intent when they report):
- **WP-39 · Agent fingerprints:** builder `wp39`, worktree `.claude-worktrees/wp39-fingerprints`, branch
  `claude/wp39-fingerprints`. New files only, in `shared/ui/fingerprint/`. Riley approved the design and "Yes, bring
  them in".
- **WP-40 · The rail and the agents pages:** dispatched next, from this tip.
- **WP-41:** each agent wears its fingerprint, after both land. Briefs are in `BETA14_RELEASE.md`.
