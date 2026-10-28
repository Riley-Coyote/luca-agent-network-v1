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
- Internal free space remained approximately 33 GiB. No Rust cache was created
  or cleared; the one-cache rule remains in force.

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
- Riley has been asked whether these two refinements belong in this beta once
  approved/verified. Fingerprint identities remain a design preview, not part
  of the candidate. Mnemos remains explicitly deferred to a later update.

## Next

Resolve those two inclusions and wait for the active rail session's checkpoint;
review/integrate only the accepted completed changes. Run focused regressions
and the final release gates, then build from a clean recorded commit using the
existing shared cache and isolated Rail Glass instance. Its existing process
must be stopped deliberately before replacing its cache bundle; preserve its
profile. Follow `BETA14_RELEASE.md` and `desktop/release/README.md` for the
production candidate and walkthrough. No tag, notarization, updater signing,
upload or publication before Riley's release approval.
