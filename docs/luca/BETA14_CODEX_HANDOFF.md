# Beta.14, handed to Codex to finish (2026-10-28)

Riley starts this session as Sol (`gpt-6.1-sol`) at **ultra**, in **Fast** mode (the `priority` tier). Riley: "i do want
to hand off to codex to complete beta 14." Read this file, then `BETA14_TAKEOVER_CHECKPOINT.md` (your own earlier
notes), then the "For every agent" section of `BETA14_RELEASE.md`.

## Where things stand

- **Checkout:** `~/Documents/Repositories/.claude-worktrees/luca-beta14-polish`, branch `claude/native-rail-glass` at
  **`4a1151280`**, local only. Every UI piece of beta.14 is in, and Riley froze the scope here. Anything new waits for
  beta.15. Mnemos WIP and the older Obsidian WIP stay out.
- **What's in, past your last checkpoint:**
  - **The projects fix** (`66ea5fe2d`): a project's rooms sit under it again, on no thread.
  - **WP-40** (`f05d15866`): every place's rail has mono-caps section labels and a face on each row. Notebook, Self
    and Settings have the lab's structure, and every Settings section is open.
  - **WP-39** (agent fingerprints, `shared/ui/fingerprint/`): each agent's living fingerprint, grown on the GPU from
    its key and cached in IndexedDB. Reduce Motion holds it still. With no WebGL 2, the app falls back to
    `AgentMark`.
  - **WP-41** (`3b7d510cd`, `15064bab6`): Luca and every agent wear their print in the Chats and Agents rails, and
    large in their page's head. The agent mark holds the place while a print grows.
  - **The solid composer** (`f19a2c248`): one composer everywhere, including the mini chat, and a calm new chat
    page. There is no glass in the composer, by Riley's call; the mini chat's own glass stays.
- **Light checks only on those merges**, by Riley's call; the full checks are yours. On the final tip: tsc 0, lint clean
  on the merged files, text guard 0, unit 4,425/4,425. Focused browser runs passed:
  - `shell-agents-pages`, `shell-fingerprint` and `shell-chats-rail`: 37/37;
  - rail, project rooms, frame and settings: 32/32.
- **Reported, not yet chased.** The composer session saw four failures it thought came from outside its branch: the
  Notebook's empty line (twice), the rail's chosen row, and a base server on `:4300` that wasn't running. Treat them
  as real until your full run says otherwise.

## Yours: finish beta.14

Your sequence 2 to 7 from the checkpoint:
1. Freeze one combined source.
2. Update `desktop/release/BETA14_NOTES.md` from what actually landed, in Riley's plain words. It should cover the
   fingerprints, the rail and agents pages, projects' rooms, the mini chat and the composer.
3. Run the final integrated checks:
   - types, lint, the text guard and the unit suite;
   - the complete shell suite, twice, to tell flakes from failures;
   - the required Rust and relay checks.
4. Package sequentially in the one shared cache.
5. Build the isolated **Rail Glass** test app from the frozen commit.
6. Verify the artifacts.
7. Hand Riley the walkthrough.

Fix what the suite finds in place, in small commits, and say what each fix was.

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
