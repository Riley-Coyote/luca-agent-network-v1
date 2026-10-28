# Beta.14, handed to Codex (2026-10-28)

Riley starts this session as Sol (`gpt-6.1-sol`) at **ultra**, in **Fast** mode (the `priority` tier). Riley, tonight:
"yes run it the faster way from now on." Read this, then `BETA14_TAKEOVER_CHECKPOINT.md` (yours), then
`BETA14_RELEASE.md`'s "For every agent". Re-read the checkpoint before every step: it's how Claude talks to you.

## Where things stand

- **Checkout:** `~/Documents/Repositories/.claude-worktrees/luca-beta14-polish`, branch `claude/native-rail-glass`, local
  only.
- **Already in:**
  - the glass mini chat (your `baf91472f`);
  - your test repairs (`13180d5ed`) and safeguards (`f7dffb1b5`);
  - the projects fix, a project's rooms under it again (Claude's merge, `66ea5fe2d`; tsc, lint, text guard and unit
    4,411/4,411 pass, and the rail, project-rooms, frame and settings browser specs pass 32/32).
- **Frozen scope** (Riley, see the checkpoint): beta.14 is what's finished or nearly finished. Anything new waits for
  beta.15. Mnemos WIP and the older Obsidian WIP stay out.

## What Claude still lands, and you don't

Claude merges these by hand, with checks, and records each in your checkpoint:
1. **WP-39, agent fingerprints:** `claude/wp39-fingerprints` (`d83471ecb`, plus one test fix in progress). Each
   agent's own living print, in `shared/ui/fingerprint/`.
2. **WP-40, the rail's labels and icons and the agents pages:** `claude/wp40-rail-pages`, building.
3. **WP-41:** each agent wears its fingerprint in the rail and on its page head. Small, after 1 and 2.
4. **The composer, solid:** from the new-chat-composer session. Riley: "i dont like the glass composer at all … we
   should go back to a non-glass composer and just make it look excellent." No glass composer ships.

Don't merge those branches, and don't edit files under `.claude-worktrees/wp39-*`, `wp40-*` or `new-chat-composer`.
When all four are in, Claude writes **"FROZEN at <commit>"** in your checkpoint.

## Your part

**Now, while Claude lands the rest:** the release preparation that needs no frozen source.
- Draft `desktop/release/BETA14_NOTES.md` from what has actually landed, in Riley's plain words, and leave room for the
  four above.
- Dry-run your packaging and verification steps on the current tip, without a native build.
- Have the exact commands ready.

**After "FROZEN at <commit>":** your sequence 3 to 7 from the checkpoint.
- Final integrated checks: types, lint, the text guard, the unit suite, the complete shell suite (twice, to tell
  flakes from failures) and the required Rust and relay checks.
- Package sequentially in the one shared cache.
- Build the isolated **Rail Glass** test app from the frozen commit.
- Verify the artifacts.
- Hand Riley the walkthrough.

## Rules (all standing)

- **Nothing outward.** Nothing is published, tagged, notarized or signed with the updater key until Riley walks the
  candidate and says ship. Never push: the repo is public and has live users.
- **Leave his apps alone.**
  - Never launch a build with the production identity (`chat.polyphonic.desktop`) on Riley's account.
  - Never touch his installed apps or real profiles.
  - Stop the running Rail Glass candidate only by its exact PID, and keep its profile.
- **Heavy work, one at a time.** Every build, browser run and cargo command goes through
  `bash ~/.claude/plans/polyphonic-shell-build/tools/heavy.sh`. Check free disk first and keep your 20 GiB reserve.
  Serve static proofs with `~/.claude/plans/polyphonic-shell-build/tools/serve.py`.
- **Process hygiene.** Never use `pnpm install`; use `pnpm_config_verify_deps_before_run=false`. Stop only your own
  processes, by PID. Never stash, rebase or force.
- **Talking to Riley:** brief, in plain everyday words, with no jargon.
