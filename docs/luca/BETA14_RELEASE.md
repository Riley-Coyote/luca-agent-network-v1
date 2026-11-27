# Polyphonic beta.14: the release that carries the new shell (2026-10-26)

Riley, 2026-10-26: "Yes, go with the plan: call it beta.14, the shell on by default with the old layout as a switch for
one release, leave the Obsidian WIP out, cut the five Buzz ties and keep the license notice."

## Current finish gates — November 27, 2026

This section is the active closeout. It replaces the November 5 section below, which is kept
as a record. Mnemos is in scope: Riley, November 20, "i want to just get it all integrated".

- **Frozen source.** The app's code is `6e2779c33` on `claude/native-rail-glass`. Every commit
  after it changes tests and docs only.
- **Checks at the frozen source.** Types: no errors. `pnpm run check`: clean. Frontend units:
  4,730 of 4,730. Rust: desktop library 3,185 passed, 0 failed, 18 ignored; `buzz-dev-mcp`
  118 and 1; `luca-protocol` 3, 11 and 5. Mnemos browser specs: 140 of 140 in Chromium. The
  list-of-minds tests: 6 of 6 in Playwright's WebKit as well.
- **The browser suite.** `BETA14_BROWSER_TESTS.md` has the count. Of 2,051 tests, 556 are left
  out by name, each with its cause: 455 old (they fail the same way at beta.13), 38 need a
  second build to compare against, 2 need the real app, 1 is known in the app, 5 wait on
  Riley, 55 need a rewrite. Of the other 1,495, every one passed in the final sweep or alone,
  except two timing tests that should be run once more on a quiet Mac.
- **Release-mode practice compile.** `tauri build --no-bundle` with the beta overlay finished
  at `6e2779c33` in its own worktree: version 0.5.0-beta.14, the new layout on, arm64,
  minimum macOS 14.0, Apple's glass classes weak-linked, the six helpers staged. It carries
  only the linker's ad-hoc signature. Nothing was bundled, signed, notarized or launched.
- **The test app.** Rebuilt once from the release line plus the candidate's own two files
  (`claude/mnemos-link-candidate`, 65a8b72b8) and launched on November 27 at 5:45 am. It is
  waiting at the macOS keychain prompt, which is Riley's to answer. **The hands-on pass on
  the final build has not been done.** Seen in passing: stopping the earlier build's main
  process took its relay and its three agent programs with it within seconds.
- **Known in the app; ships as it is.**
  - With Reduce Motion on, the glow behind a short looping video shifts a little at every
    loop (150bebb86).
  - In a conversation with no messages, an open question form gets about half the window and
    scrolls inside its own area. Nothing is out of reach; checked at three window sizes in
    both layouts, in the browser build.
- **Riley's calls.**
  - An agent created on his yes, or ticked during setup, does not show in the Chats rail until
    he messages it (468075227), and a failed bring-up has no row to say so. Five tests wait on
    this. Changing it needs one more test build.
  - "Mnemos isn't on this Mac." offers no way to get it.
  - The release notes say nothing about Living Ink, and are still headed Draft.
- **Open since November 5, and not something these checks can force.** Remembered approvals
  on the Claude API route need an Anthropic API key. Proactive return has never produced an
  unsolicited return in the real app; quiet hours and budgets must not be reset to get one.
  A Codex-run agent, for delegation or a linked memory, has not been run in the app. The
  profile preserved on November 3 (`2026-11-03-first-meeting`) is no longer in
  `~/Documents/Polyphonic-Candidates/`, so its recheck cannot be done as written.
- **Owner and release gates, unchanged.** Riley's walkthrough. Fresh install and the beta.13
  upgrade in a disposable macOS account, with the real release-mode app. Developer ID
  signing, updater signing, notarization, the tag and the uploads. None of these is done or
  authorized by the checks above.

## Finish gates — November 5, 2026 (superseded by the section above)

Kept as the record of that day; dated implementation records below are
historical evidence, not fresh release clearance. The new public/shared-agent
idea is deferred. On November 5 Mnemos was still out of scope.

- **Verified in the isolated native candidate:** approved shell/conversation/mini
  chat work; chat-led reviewed setup; authorized recent-work sample; encrypted
  note save, correction, recall and Forget; same-profile restart and Pause;
  persistent pair inboxes, exact-task continuation, recipient wake, delegated
  approvals and automatic returned results; starter specialists; persistent rail
  reveal on owner contact, delegation or real work. See the first-meeting,
  inbox and starter walkthrough records for each checkpoint and its limits.
- **Task status cleanup implemented:** distinguish a durably accepted recipient
  reply from the exchange's Open/Closed transport state. Never label a reply as
  a successful task without evidence. Preserve original records and transcripts.
  Replied tasks no longer appear as active conversation/attention solely because
  their transport is open or turn-limited. Active continuation overrides an old
  reply; absent/evicted receipts remain unknown. No signed exchange is rewritten.
- **Current checks:** all 4,514 frontend units pass; focused native inbox (34),
  dispatch (59), exchange (95), reply (25) and protocol exchange (12) checks pass.
  Both managed harness-instruction checks pass as well.
  Earlier initiative (47), delivery (40), source-note (5) and first-meeting (26)
  checks also passed (filters overlap). All 44 existing inbox browser cases passed;
  both new status cases passed after correcting their test-only recipient/input
  selectors. Typecheck/build, scoped Biome, text-size/file-size and diff checks
  pass. The first-meeting prompt exceeded its existing 10 KiB test budget;
  repeated wording was shortened without raising the limit or dropping consent.
  Browser screenshots were inspected in both themes. Final native rebuild and
  same-profile inspection are the next gate, not claimed by these unit checks.
- **Scope boundary:** new delegation during a sibling-triggered return turn
  is still refused. Removing that guard alone is not a safe workflow feature;
  shared budgets, cancellation and origin authority must be specified together.
  Riley clarified that long-form work should happen inside the chosen harness;
  unattended cross-agent workflow chains are not added in this pass.
- **Long-form work clarification (November 5):** Riley means a specialist doing
  its requested stages through its existing harness, not an unbounded chain of
  new agents. Work-tool calls are not exchange turns. New inbox tasks and fresh
  owner-requested attempts now receive the default managed work window (two
  hours) plus five minutes for return delivery, instead of the ordinary chat's
  30-minute expiry. Both lanes share the work-duration constant. Existing signed
  attempts, Stop, tool permissions, message budgets and ordinary chat TTL remain
  unchanged. New dispatch receipts and exact admitted-reply leases use that same
  bounded window; legacy receipts keep their original 30-minute expiry. Reply
  leases still authorize no new read/prompt, preserve raw capture expiry, remain
  revocable, and are never restored after restart. Adding message turns cannot
  shorten an already granted work window. Non-default longer harness caps do not
  extend this inbox window.
  Focused deadline/Stop/restart tests and a native multi-step task are the proof
  gates for this adjustment, not an assertion of unlimited work or tool parity.
- **Native proactive-return gate remains open:** the existing profile has two
  real background `no_change` outcomes, not a successful unsolicited return.
  Quiet hours and rolling stage budgets must not be reset or bypassed to force
  a result. No-change remains a valid agent decision, not a failure to fix.
- **Upgrade/final regressions:** recheck the preserved candidate profile at the
  final frozen source and reconcile remaining historical test failures by path.
  A production-identity beta.13 upgrade on the daily profile is not claimed by
  the isolated-profile checks.
- **Owner/release gates:** Riley's final walkthrough, release packaging and
  artifact validation are still required. No push, tag, signing, notarization,
  publication or replacement of the daily app is authorized by these checks.

## Where the release comes from

- **The release line is `claude/native-rail-glass`.** It already holds the whole of the October 22 beta.14 consolidation
  (`codex/beta14-consolidation-2026-10-22`, a01d5b525), plus the new shell (WP-10 to WP-29). The users' current app is
  beta.13; the October 22 candidate never shipped.
- **The shipped line `codex/first-meeting-finish`** has four commits this line lacks. Three come in (WP-31). The fourth,
  f96a3c7bc ("WIP: preserve Obsidian material polish pending visual approval"), stays out until Riley approves it.
- **The release flow** is `desktop/release/README.md`, and it is unchanged by this plan.
  - Nothing is published, tagged, notarized, or signed with the updater key until Riley has walked through the candidate
    and said ship.
  - The upstream Buzz publishing workflow is never used.
- **The production identity:** a build with the beta overlay is the production app (`chat.polyphonic.desktop`). It is
  never launched on Riley's account; behaviour is tested on the isolated rail-glass test app.

## For every agent

The rules in `docs/luca/rail-system/SHELL_BUILD.md`, "For every agent: read this first", apply:
- the heavy-jobs queue, with the script on the command line;
- never stash, merge, push or rebase;
- stop only your own processes, by PID;
- headless only;
- a flag-off comparison must compare something.

Two more rules:
- If your port is taken, stop and say so. Never take another port.
- Never launch a build made with the beta overlay, never touch an installed app or a real profile, and never search for
  keys or passwords.

## WP-30 · Cut the ties to Block's Buzz

**Why.** The audit of 2026-10-26 found five live ties to Block's Buzz in what ships. None of them can ship an update to
users (updates come only from `Riley-Coyote/polyphonic-app`), but each one either reaches Block or points at it:
1. **Hosted communities.**
   - Community setup offers "Claim a Buzz address so your team can join from anywhere. Opens Builderlab."
     (`features/communities/ui/CommunityCreationChoice.tsx`, used by `WelcomeSetup.tsx`).
   - The app can sign in to Block's Builderlab and list its communities (`desktop/src-tauri/src/builderlab.rs`, at
     `https://app.builderlab.xyz/api/goose`, registered in `lib.rs`).
   - `HostedCommunitiesSettingsCard.tsx` is unused.
2. **The built-in runtime's face and words.**
   - Its avatar is fetched from Block's GitHub every time it shows
     (`raw.githubusercontent.com/block/buzz/.../buzz-agent.png`, in `managed_agents/discovery.rs:25` and
     `shared/ui/characters/characterAppearance.ts:34`).
   - Its install link is `https://github.com/block/buzz` (`discovery.rs:289`).
   - Its hint says "Built into Luca."
3. **Phone notifications.** The bundled relay delivers push notifications to Block's gateway by default:
   `DEFAULT_PUSH_GATEWAY_DELIVERY_URL = "https://push.buzz.xyz/v1/deliveries/apns"` in
   `crates/buzz-relay/src/config.rs:365`. The desktop never overrides it.
4. **GitHub automations.**
   - Block's workflows are still in `.github/workflows/`. `release.yml` wakes on every beta tag and skips itself (it is
     guarded to `block/buzz`).
   - `docker`, `helm-chart`, `push-gateway-helm-chart`, `sprig`, `benchmark-harbor` and `auto-tag` run only on a `main`
     this repo doesn't have.
   - `ci` fails on pull requests.
   - `.github/CODEOWNERS` and `.github/ISSUE_TEMPLATE/` are Block's.
5. **A developer shortcut** in the `Justfile` (`:521`) exports Block's test relay
   (`wss://sprout-oss.stage.blox.sqprod.co`).

**Files in scope:** the files named above, and their tests and callers.

**Decisions:**
1. **Nothing in Polyphonic signs in to Builderlab.**
   - The Builderlab choice leaves community setup. If one choice is left, the setup goes straight to it.
   - The Builderlab commands and module leave the app.
   - The unused hosted-communities card goes.
   - "Unpair this Buzz identity?" goes with that card.
2. **The built-in runtime is Polyphonic's.**
   - Its avatar is a bundled image, Polyphonic's own app icon, and is never fetched.
   - It has no install link, since it is built in.
   - Its hint reads "Built into Polyphonic."
   - The other runtimes' avatars (from their makers' sites) aren't Buzz ties; leave them.
3. **The bundled relay sends nothing to Block.** The push delivery address has no default: phone notifications are off
   unless an address is set. The relay's tests follow.
4. **Block's GitHub automations go**, all eight workflows, along with Block's `CODEOWNERS` and issue templates. A
   Polyphonic CI can come later.
5. **The developer shortcut points at the local relay**, or goes.
6. **Keep:**
   - the Apache 2.0 `LICENSE` and `NOTICE`, and the About line crediting the upstream Buzz project (the license requires
     them);
   - the internal names (`buzz-relay`, `BUZZ_*`, crate names);
   - upstream documentation kept as history (`docs/BUZZ_UPSTREAM_README.md` arrives in WP-31).

**Verification:**
- A search of what ships shows no Block or Buzz host, apart from the license notice and the upstream docs. What ships
  means the desktop's code outside tests, the bundled crates' non-test code, `desktop/release/`, `.github/` and the
  `Justfile`.
- An e2e run's network log shows no request to any Block host.
- The tests:
  - the desktop's Rust lib tests and the relay crate's tests for what changed;
  - tsc, px-text and the unit suite;
  - the flag-off views unchanged apart from community setup's removed choice (declare it).

**Checks JSON keys:** `builderlab`, `runtime_face`, `push_default`, `github`, `dev_shortcut`, `kept`, `no_block_hosts`,
`network_log`, `gates`.

## WP-31 · The beta.14 line

**Files in scope:**
- the three cherry-picks;
- `desktop/release/` and how the release build sets its environment;
- Settings > Appearance (`features/settings/ui/SettingsPanels.tsx` and its option rows), in both layouts;
- the feature flag `shell-frame` (`shared/features/`);
- `desktop/src-tauri/resident-packs/luca/`;
- release notes.

Not in scope: WP-30's files.

**Decisions:**
1. **Three commits from the shipped line come in, by cherry-pick, in this order:**
   - 8d6ce9905, the new download home and the Polyphonic README;
   - 17e802a68, incremental Brain refresh;
   - 2a56e4837, its notes.
   Resolve conflicts keeping beta.14's behaviour and each commit's intent. f96a3c7bc stays out.
2. **The shell is on by default in the beta build.**
   - The release build turns `shell-frame` on, the way the test app's build does (`VITE_LUCA_SHELL_FRAME=1`).
   - The dev and e2e builds keep today's defaults, so every suite stays meaningful.
   - Document it in `desktop/release/README.md`.
3. **The classic layout is a switch, for this one release.**
   - Settings > Appearance gets one quiet row: "Classic layout" (off), "The layout from before beta.14. It goes away in
     the next release."
   - Turning it on switches the shell off at once and remembers it; turning it off brings the shell back.
   - The row is in both layouts' Appearance, so you can always return.
   - It shows only where the shell is on by default.
4. **The version reads 0.5.0-beta.14 everywhere the beta reads it.** The overlay already does; find any other place the
   beta.13 bump touched, and say what you found.
5. **Luca's built-in reference copy agrees with its instructions.**
   - `resident-packs/luca/AGENTS.md` ends with `instructions.md` again: they drifted in 6d4e68f6f (Oct 8).
   - Use the pack's own generator if there is one, so the desktop's Rust test
     `stock_luca_pack_keeps_brain_optional_and_export_matches_live_instructions` passes.
6. **Release notes for Riley to approve:** `desktop/release/BETA14_NOTES.md`, in plain words. What's new for someone
   using Polyphonic:
   - the new layout;
   - each mind's own space;
   - Activity and Needs you;
   - asks drawn and answered the same everywhere;
   - the Reduce Motion freeze fixed;
   - the window's first size;
   - the classic switch;
   - Brain refresh.
   Nothing about how it was built.

**Verification:**
- The gates.
- The desktop's Rust lib tests all pass, including the pack test and the Brain tests.
- The classic switch, in an e2e build made with the beta's default (shell on): both directions, remembered across a
  reload, in both layouts, at 1440 × 900 and 800 × 500, dark and light.
- Flag-off views identical to the base, apart from Appearance's new row (declare it).

**Checks JSON keys:** `cherry_picks`, `shell_default`, `classic_switch`, `version`, `luca_pack`, `notes`, `gates`.

## Then

1. Merge WP-30 to WP-35 by hand.
2. WP-37, what the walkthrough of the test app found, and WP-38, Brain's own place; merge each by hand.
3. Run every gate, the whole shell suite, and the desktop's Rust tests.
4. Build the release candidate (WP-36), checked from its files and never launched here:
   - with the beta overlay;
   - without the updater key, so no updater archive and no publication.
5. Build a rail-glass test app from the same commit, for behaviour.
6. Riley's walkthrough, in his own time: a fresh install and an upgrade from beta.13, in a disposable account, as the
   release README requires.
7. On his word: signing with the update key, notarization, the tag `v0.5.0-beta.14`, and the upload, in the order the
   README gives.

## Riley's further calls (2026-10-26)

- **Finish release preparation while Claude finishes the UI (2026-10-27).**
  Riley explicitly wants the composer, rail, mini-chat and other finished,
  approved UI updates included in this beta. Prepare independent release checks
  now; integrate completed commits, not active dirty worktrees. Do not rebuild
  the native candidate until the combined UI is ready. The integration and
  acceptance sequence is recorded in `BETA14_TAKEOVER_CHECKPOINT.md`.
- **Mnemos waits for its own release:** "hold off on mnemos and do it as its own release. especially because we also
  have the mnemo connector and could potentially bring it in that way so someone could keep their existing memory".
  Codex's uncommitted Mnemos work is backed up at
  `/Volumes/LaCie/luca-unsaved-work/polyphonic-beta14-consolidation-mnemos-2026-10-26.*`.
- **The glass ships in beta.14:** "i wanted to get our new shell and glass finished so we could ship it in beta.14 ...
  get that all finished and tested so we know the whole update for 14 is rock solid, and then we ship."

## WP-32 · Apple's glass ships in beta.14

**Why.** Today the glass exists only in test builds.
- `desktop/src-tauri/build.rs` compiles the Swift glass (`native/glass/`) only when `LUCA_BUILD_NATIVE_GLASS=1`.
- `src/native_glass.rs` attaches it only when the app's own environment carries `LUCA_NATIVE_RAIL_GLASS=1` (the
  rail-glass candidate's `LSEnvironment`), on macOS 26 and later.
- So a beta.14 built as things stand would offer only the frosted fallback for Glass.
- The page side is ready. `app/shell/shellGlass.ts`:
  - the frame starts solid;
  - Glass draws Liquid Glass where the native glass announces itself;
  - otherwise it draws the frosted fallback on a Mac, and solid under Reduce Transparency.
- The plan the glass was built to is `docs/luca/native-rail-glass/PLAN.md`.

**Files in scope:**
- `desktop/src-tauri/build.rs`, `src/native_glass.rs` and `native/glass/`;
- `desktop/release/README.md`;
- the rail-glass test app's pins: `scripts/build-companion-delegation-candidate.sh` and
  `desktop/src-tauri/tauri.rail-glass-candidate.conf.json`, which still require 0.5.0-beta.13;
- `crates/buzz-acp/src/scoped_codex_initiative.rs:313`, which tells Codex it is 0.5.0-beta.13.

**Decisions:**
1. **Every macOS build carries the glass:** build.rs compiles it whenever it builds for macOS, so the release, the test
   app and dev builds draw the same thing and nothing can be forgotten at release time.
   - If the Swift toolchain is missing, the build says so plainly rather than silently leaving the glass out.
2. **It attaches on its own on macOS 26 and later,** without the test variable. `LUCA_NATIVE_RAIL_GLASS=0` still turns
   it off, for testing. On macOS 14 to 25 nothing native attaches, and Glass draws the frosted fallback, as designed.
3. **The frame still starts solid,** as designed: Glass is the Frame row's choice in Appearance.
4. **The release binary opens on macOS 14 and 15.** The minimum system version is 14.0.
   - Everything newer than 14 that the glass uses (`NSGlassEffectView` and the rest) is weak-linked and guarded by
     availability checks.
   - Prove it from the built binary (`otool -l`, `nm -m`, the Swift `@available` guards), because this Mac runs 27 and
     can't launch 14.
5. **The versions agree.** Codex is told 0.5.0-beta.14, and the rail-glass test app reads beta.14 too.

**Verification:**
- The desktop's Rust tests.
- A rail-glass test-app build from your branch:
  - `nm` shows `_polyphonic_glass_attach`;
  - its `Info.plist` carries no `LUCA_NATIVE_RAIL_GLASS`, since it is no longer needed.
- A static proof that the binary loads on macOS 14: its minimum OS, and every 26-only symbol imported weakly.
- The real-app check (glass attached, the Frame row, Reduce Transparency) is the orchestrator's, after the merge.
- Never launch anything.

**Checks JSON keys:** `compiled_always`, `attaches_by_itself`, `frame_default`, `loads_on_14`, `versions`, `gates`.

## The pages and the rail, for beta.14 (2026-10-27)

Riley, 2026-10-27: "yes, build the new rail and the page system into the app for beta.14". He shaped both in the shell
lab over the night of 2026-10-26, in his own words:
- the pages read as "blank screens with text … like we threw words on a blank page";
- the rail "darker, not lighter", "the most minimal difference" by night, and day "was fine before";
- the line under a home "should be used for agents and their task sessions specifically. so like not below projects …
  and not below luca. luca is one persistent chat";
- "bring the harneses back into the main rail, not in the agents tab", each task under its app while it works;
- "our own icon that represents agents used for all of them";
- "we have never included People as a thing in this app … so it would be Luca, Projects, Agents, Runtimes";
- and, keeping a way to talk to any of them yourself: "dont remove the plus button".

**The reference for every value is the lab**, read-only: worktree
`~/Documents/Repositories/.claude-worktrees/shell-lab-rail` (branch `claude/shell-lab-rail-faces`, commit 8bf285c18),
`desktop/src/testing/shellStudy/` (`ShellStudy.tsx`, `shellStudy.css`, `content.ts`, `agentMark.tsx`). It is served at
`http://localhost:1489/scripts/shell-lab.template.html?experience=shell&mode=dark&panel=0&cards=one&tone=darker`. Read
it; never edit it or stop its server. Where the lab and a brief disagree, the brief wins; say so in your report.

**What every package keeps.**
- Only real data. The lab's sample content is never copied in. A fact the app doesn't hold is left out, never
  invented, and named in your report.
- Nothing is lost. A package that moves or removes UI returns a capability map: every old control or view, and where
  it lives now, or LOST with Riley's decision as the reason.
- Classic layout (the flag off) looks and behaves exactly as now: hash-compare against the base build at
  `http://127.0.0.1:4300`.
- The tests move with the decisions. Update the shell specs that asserted the old design, never delete a check
  without replacing it, and add a spec for your package's decisions.

The three run one after another, each from the last one's merge.

## WP-33 · The page system: faces lead, plates hold, threads join

**Why.** A page names what it is, rows sit on a surface, and what happened in order hangs from a thread. Research into
Apple's Mac apps, Linear, Notion, Things and the AI apps found the same moves everywhere: two rows inside something read
as "the contents of something", and on open black as "debris" (Linear). Riley then tuned the tones by eye.

**Decided.**
1. **The head** (`PlacePageHead`):
   - a face tile (40, radius 11, ink 4%, the plate's lit top edge by night, none by day) holding the rail row's own
     face at 22 (a line drawing at 19, the agent mark at 21);
   - the eyebrow (12, faint), only where WP-19's rule keeps it;
   - the name (22, weight 600, −0.012 em);
   - one state line (13, muted), from real data only (Needs you: "2 waiting, from Luca and Atlas");
   - the page's one action at the end, where it has one.
2. **A section** (`PlaceList`): a sentence-case label (12.5, weight 600, muted) and its count (12, faint, tabular),
   8 above one plate; 28 between sections. Pages stop using the mono capital eyebrow for section labels.
3. **The plate** (the lab's dials on `.shell`, as CSS variables on the shell's root):
   - by night: fill ink 1.3%, lit top edge `inset 0 0.5px 0` ink 4%, row hover ink 2%, rule ink 4.5%;
   - by day: fill ink 1.4%, no edge, hover ink 2%, rule ink 6%;
   - radius 12, padding 4; rows inside have padding 11/10 and radius 8.
   Measured on the lab's render, a plate sits about 0.56 of perceived lightness above the card by night, and 1.4 by
   day. Measure yours the same way and report both.
4. **A row** (`PlaceListRow`):
   - the face at 20, the words (title 14 at ink 90%, detail 13 muted), the note (12, faint, tabular, never wrapping)
     in the end column, a gap of 12;
   - the hairline between two rows, half a point at the rule's ink, runs from the words (42 in: 10, 20 and 12) to 10
     short of the plate's end, and goes while either row is under the pointer. A row with no face starts its words
     at 10.
5. **A thread** (a list in time order: a mind's days here; All activity in WP-34; a task's steps in WP-35):
   - no hairlines;
   - a 1 px line at ink 14% under the faces' centres, from 4 below one face to 4 above the next.
6. **Asks** (`PlaceAskRow`) keep their anatomy: their own words, who and where, the answers always in view, the long
   form under them. They sit on a plate, led by the asker's face, with the words at 15/21.
7. **The agent mark** is a new shared component, `desktop/src/shared/ui/AgentMark.tsx`. Take the lab's
   `agentMark.tsx` path and its comment.
   - Every mind that is a row's face in the shell's pages wears it: Needs you, Settings' agent rows, a mind's Works
     with. WP-34 adds the rails.
   - A conversation's author marks are out of scope.
8. **A mind's space** (WP-13's component):
   - Notebook's days are threads with a glyph for each kind: for you `UserRound`, their own `Sparkles`, journal
     `NotebookPen`, memory `Bookmark`. The filters wear the same glyphs.
   - Self's documents and Settings' rows each sit on a plate.
   - Beside all three tabs, once the page is at least 940 wide (a container query), comes a column of 232, 36 from the
     body; the axis then widens to 908. Below 940 the column stacks under the body.
   - The column holds "At a glance": the mind's real facts (runtime and model, when it wakes, its folder, what it can
     read, its permissions), only those the app has.
   - It also holds "Works with", only if the app can derive it from real data (shared rooms or exchanges); otherwise
     leave it out and say why.
9. **Out:**
   - "Answered today" (the app keeps only what waits);
   - the Chats rail and which pages each place has (WP-34);
   - an app's task (WP-35);
   - conversations and the composer.

**Files in scope:**
- `desktop/src/app/shell/placeRails/` (`PlacePage.tsx`, `PlacePageHead.tsx`, `PlaceAskRow.tsx`, and the cards' look,
  not their structure);
- the mind's space files (find them from WP-13);
- `shell-place-rails.css` and `shell-activity.css`;
- `desktop/src/shared/ui/AgentMark.tsx` (new);
- the shell specs that assert the page look, and a new `desktop/tests/e2e/shell-pages.spec.ts`.

**Proof** (screenshots at 2×, by night and by day):
- Needs you; a mind's Notebook at 1440 × 900 and at 1100 × 760; its Self and Settings;
- Settings → Appearance; a Brain page; a Library page.
- Measure:
  - the plate's step by night and by day;
  - hairline start minus words start, which must be 0;
  - the thread x minus the face centre, which must be 0.

**Checks JSON keys:** `head`, `section_labels`, `plate_steps`, `hairline_at_words`, `thread_under_faces`,
`agent_mark_on_pages`, `mind_column_wide`, `mind_column_narrow`, `at_a_glance_fields`, `works_with`,
`classic_identical`, `capability_map`, `unit_tests`, `playwright`, `gates`.

## WP-34 · The rail: what needs you, Luca, and the work under whoever does it

**Why.** Conversations and work are told apart. Luca and a room are one ongoing chat each and never nest (a project's
rooms sit under it on no thread: Decided 3, amended 2026-10-27).
What Luca hands an agent or an app hangs on the thread under whoever is doing it, while they work. Live work shows once,
in the rail, and Activity becomes the record of what happened. What needs you, the one thing only you can do, comes to
the top.

**Decided: the Chats rail** (`desktop/src/features/sidebar/ui/ShellRail.tsx`):
1. **The order:** Needs you (only while something waits), Luca, then three sections.
   - **Projects** `+`. Loose rooms (in no project) follow the projects as rows of their own; Browse rooms… and Archived
     close the section, as they close Rooms today.
   - **Agents.**
   - **Apps** `+` ("Connect an app"): the connected apps, the ones the Agents place lists under Connected today,
     starting with Claude Code and Codex.
   - People and Rooms go as sections. A person's chat stays findable in Search, LOST from the rail by Riley's decision.
2. **Needs you** is a row above Luca: the hand face, the name, the count at the words' ink and weight 600. It opens the
   Needs you page in the card, as Activity does today. That page isn't a conversation, so it takes no tab. The count on
   the places column moves from Activity to Chats.
3. **Only work nests.** Luca never has rows under it: its side conversations move under whoever does the work.
   - ~~Projects never nest~~ (amended 2026-10-27, `claude/rail-project-rooms`). This bullet read Riley's note on the
     line ("not below projects for each chat within a prject") as "a project lists no rooms". He meant the line. On
     the test app: "they should show each room/chat within the project below the project … it was never supposed to
     change from how we had it built before". A project's rooms sit under it again, as before WP-34, on no thread.
     The thread stays for an agent's and an app's work. Settings → Appearance → Project rooms is back: In the rail
     (the default) or In a column.
   - An agent shows its sessions.
   - An app shows its tasks, from `useAllRuntimeTasks` by `runtimeFamily`: live ones, and finished ones for as long as
     the rail shows a session's age today.
   - A task row opens where the task is shown today (`openSide` or the task's own conversation) until WP-35.
4. **The thread** under an agent or an app:
   - a 1 px line at ink 16%, under the face's centre;
   - it starts 3 below the face, runs straight past the middle rows, and turns into the last on a 7 radius, ending 6
     short of its words;
   - the open row brightens its words and nothing else;
   - "N more" sits under the hook, unlined.
5. **Every agent and app keeps its `+`:** "New conversation with Atlas", "New conversation with Claude Code", which
   starts a session of your own with it. A project's `+` stays "New room in …". The `+` at the top of Chats opens
   Luca's one chat.
6. **Faces:** agents wear the agent mark (WP-33) at 17; apps their maker's mark; projects a folder; loose rooms `#`.
7. **The rail's tone** in one card, always now:
   - by night, `rgb(0 0 0 / 0.2)` over the card (7 of 255 against the page's 9);
   - by day, the paper's recess (`--mn-recess`) at 15%.
   - The hairline is unchanged. Any setting for the rail's tone retires.
8. **Section names in sentence case** (11.5, weight 600) in every place's rail, for the rails' heads only: the app's
   `.type-eyebrow` stays as it is.

**Decided: the places.**
9. **Agents** loses Connected, which moves to Chats as Apps. Luca, Agents and Groups stay.
10. **Activity is the record:**
    - **All activity**, its first pick: one thread of what every mind and app did, newest first, from the signed
      record and the runtime tasks, with real data only;
    - then **Signed record**: each mind, as today.
    - Needs you moves to Chats. Now and Side conversations retire: live work is in the rail, and what passed between
      two minds is in the work itself (WP-35 for an app's task).

**Files in scope:**
- `ShellRail.tsx` and the sidebar's shell stylesheet;
- `desktop/src/app/shell/placeRails/` for the rails' sections and Activity's cards (`usePlaceRails.ts`,
  `placePicks.ts`, `PlaceRail.tsx`, `SideConversationsCard.tsx`, `NeedsYouCard.tsx`'s route);
- the places column's count;
- the shell's settings where the tone or `roomsInColumn` lives;
- the specs.

**Proof:**
- the Chats rail with something waiting and with nothing, by night and by day;
- Needs you opened from Chats;
- an agent's thread, and an app's thread with a live task;
- Activity's All activity and one Signed record;
- Agents without Connected;
- the capability map;
- measured hook geometry (thread x minus face centre, the turn's y minus the last row's middle, the end minus the
  words);
- the rail tone's step by night and by day.

**Checks JSON keys:** `order`, `needs_you`, `only_work_nests`, `apps_tasks`, `thread_geometry`, `plus_buttons`,
`rail_tone`, `section_names`, `agents_place`, `activity_record`, `capability_map`, `classic_identical`, `unit_tests`,
`playwright`, `gates`.

## WP-35 · An app's task, as the work

**Why.** Riley: "maybe it doesnt appear like a traditional chat transcript but has slightly different ui with live
actiivty and live feed of what theyre working on, what projects the work is happeniong in if any, and a link to open the
session in that harness". The app holds all of it in a `RuntimeTaskProjection` (`desktop/src/shared/api/tauriRuntimeTasks.ts`):
`summary`, `runtimeFamily`, `residentPubkey`, `workingFolder`, `state`, `currentStep`, `steps` (each with its state),
`startedAt` and `completedAt`, `error`, `canRetry`, and the session references.

**Decided.** A task row in the Chats rail opens this page in the card, made only of WP-33's pieces (the lab's
`TaskView` is the reference):
1. **The head:**
   - the app's mark in the tile;
   - the app's name as the eyebrow;
   - the task's summary as the name;
   - the state line: who it's for, the project its folder belongs to (or the folder itself when it belongs to none),
     and "working since …" or "finished …", or the failure in a word;
   - its one action, "Open in Claude Code" (or Codex), through the app's existing handoff to the native session,
     shown only when the task carries a session to open.
2. **Now:** while it works, the current step on a plate, its dot breathing; under Reduce Motion it holds still.
3. **What it has done:** the steps as a thread, each with a glyph for its state (done, active, queued, failed) and its
   time if the app keeps one.
4. **What came back:** the result when it finished, or the error and, when `canRetry`, Try again through the app's
   existing retry.
5. **Between Luca and the app:** the brief (the summary, from whoever sent it) and the result, faces leading. A real
   exchange, if the app holds one, goes here instead.
6. The page follows the task live, as the rail does, and moves on to the finished state without a reload.

**Files in scope:** a new card in `desktop/src/app/shell/placeRails/`, its route from the rail's task rows, and the
specs.

**Proof:**
- a live task, a finished one and a failed one, by night and by day;
- the handoff called (spy on the bridge);
- Reduce Motion holding the dot still.

**Checks JSON keys:** `head`, `now`, `steps_thread`, `came_back`, `between`, `open_in_app`, `live`, `reduce_motion`,
`classic_identical`, `unit_tests`, `playwright`, `gates`.

## WP-37 · What the walkthrough found (2026-10-27, from the test app)

**Why.** I walked the rail-glass test app built from bfcfc58c7 by hand, on its real instance. The rail and the pages hold
up. Six things don't. All are small, and one is a bug in both layouts that no spec could see, because the mock never
sends what the relay sends.

**Decided.**
1. **A new conversation opens on its first-message view, in both layouts.**
   - The relay writes one system note into every direct conversation it makes: kind 40099,
     `{"type":"dm_created","actor":…,"participants":[…]}`. The timeline has no words for it (`describeSystemEvent`
     returns null), so its row draws nothing.
   - The note still counts in `projectedRoomMessages`, so `useFirstMessageView` sees one message and never opens. It
     also makes a day of its own, so the page shows one lone date over nothing. Every agent's conversation in the test
     app opens that way, and so would every conversation started from an agent's `+`.
   - One shared rule, for the count, the day groups and the rows alike: a system note the timeline has no words for is
     not a message. It isn't counted, makes no day and draws nothing. Say it once, in one function, and make every
     place that decides whether there is anything here ask that function.
   - The view is beta.14's own (046b67733, 8b8c9a291) and is in both layouts, so this fix is too. Flag off, a
     conversation with the note now opens on the view. That is the intended change. Nothing else in the classic layout
     may change: the existing flag-off checks still pass by hash.
   - The proof runs on what the relay really sends. This package's spec puts the note into its own fixture
     conversations. Don't add it to the shared mock, so the existing flag-off comparisons keep comparing like with like.
2. **An empty Notebook says what it holds.**
   - When a mind has nothing in its days yet and every source the Notebook reads has settled, the Notebook shows one
     quiet line on a plate under its toolbar: "{Name}'s days will gather here: what they do for you, their own work,
     their journal."
   - Never while its sources load (no flash), and gone the moment a day arrives.
3. **An app's page head reads like an agent's.**
   - "Connected · on this Mac" moves from the quiet line above the name to the state line under it, where "Off" and
     "Resting" sit for a mind. The quiet line goes.
   - The state line says it only when it's true. An app that's no longer connected says "Not connected on this Mac",
     never "Connected". Today the head says Connected over a body that says the app isn't.
   - The head gets its one action at its end: "New conversation". It does exactly what the app's `+` does in the rail,
     through the same handler (never a copy), and shows only while the app is connected.
4. **One way of naming a day on the pages.**
   - The Notebook and All activity, and any other page that groups by day, name a day with one shared function:
     "Today", "Yesterday", then the weekday and the date ("Friday, Oct 23"), with the year when it isn't this year.
   - Today the Notebook says "Oct 23" and All activity says "Friday, Oct 23".
   - The conversation's own date pill keeps its form.
5. **Settings' list speaks like the other rails.**
   - Under the shell, the section names in Settings' list ("Account", "Experience", "Agent system", "Application") are
     in sentence case, at the rails' heads' size and weight (WP-34, Decided 8), not in mono capitals.
   - Flag off, Settings is unchanged by hash.
6. **The desktop's Rust tests run on a Mac.**
   - `cargo test` in `desktop/src-tauri` builds its test programs for the compiler's default, macOS 11. There, Swift's
     concurrency library isn't part of the system, so the program built from `main.rs` links the toolchain's
     back-deployment copy by `@rpath` with no rpath, and can't start: `Library not loaded:
     @rpath/libswift_Concurrency.dylib`.
   - The app is built for 14.0 (`minimumSystemVersion`) and links the system's copy, so it is unaffected.
   - Decided: `build.rs`, where the glass's Swift is linked, adds `/usr/lib/swift` as an rpath on macOS. That is
     Apple's own answer for back-deployed concurrency. Any program that links the glass then finds the system's Swift,
     whatever it was built for. The app's own links don't change: the same libraries by the same paths, plus one rpath.
   - Measured on bfcfc58c7:
     - the library's tests: 2,926 passed, 0 failed, 18 ignored;
     - `tests/rodio_mixer_diagnostic.rs`: 3 of 3;
     - the `main.rs` program can't start. It holds 0 tests, but its failure stops `cargo test` before the integration
       test.
   - Hermit's `CARGO_HOME` (`.hermit/rust`) lacks the mesh-llm checkout the lockfile names. For offline runs, use
     `CARGO_HOME=$HOME/.cargo` and the 1.95.0 toolchain directly, as `scripts/build-companion-delegation-candidate.sh`
     does.

**Not in this package:** the word "resident" still shows in about twenty places: "Resident settings", "No residents
yet", and the Library's "When a resident creates something durable". That's a wording pass of its own, after beta.14.

**Setup.**
- The worktree's `node_modules` and `desktop/node_modules` link to the release folder's, as the other builders' do.
- Never run `pnpm install` there. Call the tools in `node_modules/.bin` directly, or set
  `pnpm_config_verify_deps_before_run=false` for a pnpm script: the shared folder's record names the lab, and pnpm 11's
  check would try to wipe and reinstall it.

**Files in scope:**
- the timeline's handling of system notes (`desktop/src/features/messages/`, `ChannelPane.tsx`) and
  `FirstMessageView.tsx`;
- `MindNotebook.tsx`;
- `ConnectedAppCard.tsx`, and the rail's app `+` handler, reused;
- the day-label functions (`mindStream.ts`, `AllActivityCard.tsx`, `PlacePage.tsx`);
- Settings' section list under the shell;
- `desktop/src-tauri/build.rs`;
- the tests: unit tests, and `tests/e2e/shell-walkthrough.spec.ts`, registered in the smoke project.

**Proof:**
- **A new conversation with an agent,** carrying the note and no message: the first-message view opens and no date
  shows, in both layouts. After the first real message, the view steps aside and the message shows under its day, as
  before.
- **An empty Notebook:** the line appears once its sources settle and never during. Sample it at several moments while
  they load.
- **Claude Code's page:**
  - the state line under the name;
  - "New conversation" doing what the `+` does, with the same navigation observed;
  - a disconnected app saying so and offering no action.
- **Day labels:** the same dates under the same labels on the Notebook and on All activity.
- **Settings:** the list's heads under the shell computed like the Chats rail's heads. Flag off, Settings matches the
  base by hash.
- **Rust:** `cargo test` in `desktop/src-tauri` passes on every target, and the app's links are compared before and
  after (`otool -L`, `otool -l`).
- Every view by night and by day.

**Checks JSON keys:** `first_message_with_note`, `first_message_steps_aside`, `note_rule_unit`, `empty_notebook`,
`no_flash`, `app_head`, `app_head_disconnected`, `new_conversation_same_as_plus`, `day_labels`, `settings_rail_heads`,
`classic_identical`, `rust_tests`, `app_links`, `unit_tests`, `playwright`, `gates`.

## WP-38 · Brain, its own place again (2026-10-27, Riley's call)

**Why.** Riley, on the test app: "theres no brain tab in the test app im looking at". Then: "yeah i think it should go
back in the icon rail like we originally had it. i dont recall ever deciding to move it into each agent's settings. its
the universal brain tab for your whole account in the app, so it deserves its own place. within each agent settings
there can be a place that shows what the agent can read, but i think the brain still needs its own place".
- The move was made in WP-13's brief (SHELL_BUILD.md, WP-13, Decided 6 and 7), and Riley never decided it. Today
  `BrainScreen` under the shell redirects `/brain` to Luca's space, Settings, What Luca can read. Each mind's
  `What {name} can read` row embeds Brain's whole body (`<BrainView embedded residentPubkey=… />`). Nothing on the way
  says "Brain", while "Open Brain" buttons and the release notes still do.
- WP-01's column had Brain as the last place before Settings, with lucide's `Brain` icon, `preloadBrainSurface` and
  the test id `open-brain-setup` (`git show 5e783e172:desktop/src/app/shell/ShellPlaces.tsx`).

**Decided** (under `shell-frame` only; with it off, nothing changes):
1. **Brain is a place again, for the whole account.**
   - The places column becomes: Search; Chats, Agents, Activity, Library, Brain; then Settings and the avatar.
   - It keeps the icon it had there (lucide `Brain`), at the column's size and stroke. Its tooltip is "Brain".
   - `/brain` opens it. `BrainToLucaSpace` retires.
2. **Brain's page,** in the one card, made of WP-33's pieces:
   - **The head:** Brain's icon on the face tile, then "Brain", then a state line saying what the account's minds can
     read, in a breath. These are the words `useWhatTheyCanRead` makes, e.g. "232 repositories · Codex history", or
     "Nothing connected yet".
   - **Under the head:** Brain's body as it is today: the four source cards, connecting and adding folders, the scan,
     the consent dialogs and the activity. It shows the whole account's view, not one mind's grants.
   - **Its rail** holds the body's two views, Connections and Activity, as rows in sentence case, like every other
     place's rail. The body's own tab strip goes under the shell.
   - The lip names the page "Brain".
3. **Each mind's Settings keeps "What {name} can read"** as that mind's own access, not Brain's whole body.
   - The row's line stays as it is.
   - Opened, it shows what this mind may read, source by source, with the controls for this mind's access that exist
     today. Under those comes "Open Brain", to the place.
   - Connecting sources, adding folders, the scan and the consent dialogs live in Brain alone.
   - For Luca, the row says Luca reads everything Brain connects, as the code makes true today.
4. **Every way into Brain opens the Brain place:**
   - `goBrain`;
   - the runtime sessions' "Open Brain";
   - the project row's "Sources";
   - the surface navigation;
   - an agent's brain-review request, which opens Brain with that review in front, as the classic Brain page does.
5. **A capability map:** every control in Brain's body and in today's What they can read, mapped to its home after
   (the Brain place or the mind's row), or marked LOST. Nothing may be lost.
6. The existing checks that assert the redirect (WP-13's `brain_redirect`, `what-they-can-read`) change to this
   decision, citing WP-38.

**Built beside WP-37.** WP-37 is in `claude/wp37-walkthrough` at the same time. Leave its files alone:
- the timeline's system notes and `FirstMessageView.tsx`;
- `MindNotebook.tsx`;
- `ConnectedAppCard.tsx`'s head;
- the day-label functions;
- Settings' section list;
- `desktop/src-tauri/build.rs`.

Where both must touch one file (`playwright.config.ts`'s list, `ShellPlaces.tsx`), keep your change to your own lines.
The two are merged by hand.

**Files in scope:**
- `desktop/src/app/shell/ShellPlaces.tsx`;
- a Brain rail and card in `desktop/src/app/shell/placeRails/`;
- `features/luca/brain/` (`BrainScreen.tsx` and `BrainView.tsx`, under the shell);
- `features/agents/space/MindSettings.tsx`'s read row;
- the ways in: `useAppNavigation.ts`, `useBrainReviewNavigation.ts`, `usePolyphonicSurfaceNavigation.ts`;
- the specs: `tests/e2e/shell-brain.spec.ts`, registered in the smoke project, and the redirect checks above.

**Proof:**
- The column, in order, with Brain's tooltip.
- Brain's page at 1440 × 900 and 800 × 500, by night and by day: the head with real counts, the body, and the rail's
  two views.
- Every way in landing on Brain, observed. The brain-review request opens with its review in front.
- A mind's read row: its own access, and "Open Brain" arriving at the place.
- The capability map.
- Flag off, by hash against the base at `:4300`: the classic Brain page, a conversation and Settings.

**Checks JSON keys:** `places_column`, `brain_page_head`, `brain_body`, `brain_rail`, `ways_in`, `brain_review`,
`agent_reads_row`, `capability_map`, `lip_name`, `classic_identical`, `unit_tests`, `playwright`, `gates`.

## WP-39 · Agent fingerprints (2026-10-27, Riley's call)

**Why.** Riley turned down the pixel creatures for agent marks: "i would love for the marks for each agent to look super
premium in some way". From three live studies he picked the fingerprint. Then: "can we make it so that it moves no
matter what in some way? my hope is that even just looking at the rail looks elevated and super beautiful with little
things like these fingerpirint marks moving and making the app feel alive". And for this package: "Yes, bring them in".
- The approved study is live at https://claude.ai/artifact/WZgXgFkZrKCXch6UodkbHs. Its source is in the lab worktree
  `~/Documents/Repositories/.claude-worktrees/shell-lab-rail`, branch `claude/shell-lab-rail-faces` at `7f163fabb`,
  in `design-lab/agent-marks/fingerprint/`: `template.html` holds the shaders and the motion; `index.html` is the built
  page. `design-lab/agent-marks/grow/prints.py` is the exact growth the study used, in numpy. Read both before you build.
- Today every agent wears one shared drawing, `shared/ui/AgentMark.tsx`. This package builds the fingerprint itself.
  Putting it into the rail and the pages is a later package, so leave every `AgentMark` call site alone.

**Decided** (under `shell-frame`; the classic layout doesn't change):
1. **Whose print.** The seed is FNV-1a (the `0x811c9dc5` / `0x01000193` form) of `residentGlyphSeed(publicKey,
   lucaPubkey)`. So Luca's print comes from Luca's fixed seed and is the same for every owner, and every other agent's
   comes from its key. It never changes when an agent's model or runtime changes.
2. **Its kind,** one of five: whorl, loop, arch, sideways loop, double loop.
   - The kind comes from the seed (`seed % 5`). Among the owner's agents, taken in order (Luca first, then by when each
     arrived), a later agent steps past a kind an earlier one holds, so the first five differ. Past five, kinds repeat,
     but a print never does.
   - Give a small helper the owner's resident list to make that assignment. Without the list, use `seed % 5`.
3. **How it grows:** exactly as `prints.py` does it.
   - Gray–Scott on a 96 × 96 grid: F .0545, k .062, Du .2, Dv .1, dt 1.
   - Diffusion 2.1 along a ridge flow and 0.17 across it, by bilinear taps at ±1 along the flow and across it. Add a
     little 9-point evenness for the round kinds: whorl .12, double loop .12, loop and sideways loop .06, arch 0.
   - Held (clamped) edges. 4000 steps.
   - The flow and the seed stripes come from each kind's phase, the formulas in `prints.py`: `sin(2π·φ/8) > 0.2` gives
     V = .25 plus a little noise, and U = 1 − 2V.
   - Use a seeded PRNG of your own; numpy's can't be matched. The kinds and the rules stay the same, and the ridges
     will differ from the study's. That's expected.
   - Grow on the GPU (WebGL 2 with float render targets) in one shared context. If float targets aren't available,
     grow in a worker on the CPU.
   - Grow one agent at a time, off the frame's critical path. Cache by seed and version (U and V quantized), so each
     print is grown once per Mac.
4. **How it's drawn:** port the study's print shader faithfully. Two variants:
   - **`rail`** (small): the print pressed in ink. It's an oval 0.84 as wide as it is tall, whose ridges fade over its
     outer 22%, with a little wet sheen. Take the ink from the face element's CSS color, so it follows the theme and
     the row's hover and selected ink.
   - **`large`** (an agent's page head and the like): black lacquer, lit from above, with a soft ring light so ridges
     read in every direction, and a hairline rim brightest on top.
   - One renderer draws every mark into one atlas and copies each changed mark out once a frame, as the study does.
5. **How it moves.** The motion is drawn, never grown: a print always returns to exactly itself. Don't run the growth
   while an agent works; the study's earlier regrowth wore a print into a scribble.
   - **At rest,** each print keeps its own time, from its seed:
     - light drifting across it, ±0.95 rad around the top, every 11–17 s;
     - ridges that breathe, every 5–8 s;
     - a wave running out from its core: 0.55 texel, about 6.5 s, wavenumber 2π/30.
   - **Working:** the wave quickens to about 2.2 s and 1.5 texels, and the print brightens.
   - **A voice in the room:** expose a way to send a ring of light across a print.
   - **The pointer** moves the light.
   - **Reduce Motion** holds every print exactly still.
   - **Cost:** resting marks redraw at half rate, marks off screen do no work, and everything pauses while the
     document is hidden.
6. **The component:** `<AgentFingerprint residentKey size variant working current />`, aria-hidden, since the row's
   name labels it. It works at 14–18 px and at 64–128 px. With no WebGL 2 at all, it falls back to today's `AgentMark`.
7. **Not in this package:** any `AgentMark` call site, the dotted marks beside messages, and Settings.

**Built beside:**
- **WP-40,** the rail and the agents pages, may be running at the same time in `ShellRail.tsx`, `features/agents/space/`
  and the shell CSS. Don't touch those files.
- **Two side branches,** the glass mini chat and projects' rooms, wait to be merged. Don't touch quick-chat or the rail.

**Files in scope:**
- New, under `desktop/src/shared/ui/fingerprint/`: growth, shaders, renderer, cache, the kinds helper and the
  component, with unit tests beside them (FNV seed, kind assignment with step-past, the cache's round trip).
- A proof harness: a lab entry under `desktop/src/testing/`, or an e2e page with `installMockBridge` showing a rail of
  real-looking rows and a large head.
- A spec, `tests/e2e/shell-fingerprint.spec.ts`, registered in the smoke project.

**Proof:**
- Real size (18 px) in a dark and a light rail, cropped and shown 3×. A 64 px head and five 128 px prints, one of each
  kind.
- A frame strip showing rest motion.
- Working beside resting.
- Reduce Motion still, measured as zero changed pixels.
- Identity: a print after 60 s of motion equals its rest frame.
- The growth time per agent, on the GPU and on the CPU fallback. A cache hit on reload.
- The study page next to your render, by eye.

**Checks JSON keys:** `seed_rule`, `kinds_distinct`, `growth_gpu_ms`, `growth_cpu_ms`, `cache_hit`, `rail_dark`,
`rail_light`, `large`, `rest_motion`, `working_motion`, `still_reduce_motion`, `identity_stable`, `offscreen_idle`,
`hidden_pause`, `fallback_no_webgl`, `unit_tests`, `playwright`, `gates`.

## WP-40 · The rail and the agents pages, as the lab has them (2026-10-27, Riley's call)

**Why.** Riley, comparing the test app with beta.13:
- "i feel like you changed things on all of the pages in terms of design, and its made everything feel really empty."
- "the biggest things are the rail not having icons and the headers or titles for sections in the rail being small and
  looking the same as each item in the rail."
- On the agents pages: "the text is basically teh same size everywhere, theres hardly any visual organization so
  everything feels like it just blends together, and idk, it just feels like text on a blank page instead of having
  clear structure and professional level organizational design."
- "in agent settings, everything is hidden behind drop downs, but theres no indication that those drop downs exist."
- "the new settings layout is fine overall, i think we just need to work on the text hierarchy and adding back in some
  of the hairline borders and visual elements that make everything feel more clear and distinct."

He approved the lab's answer ("this is looking much better", then "Yes, bring them in"). The lab is
`~/Documents/Repositories/.claude-worktrees/shell-lab-rail`, branch `claude/shell-lab-rail-faces`. Build from commit
`6049f9246` ("structure for the agents pages and real labels in the rail"): `desktop/src/testing/shellStudy/`
(`ShellStudy.tsx`, `content.ts`, `shellStudy.css`). The later commits there (creatures, the mark studies) are not
part of this. Today beside proposed, as Riley saw them: `design-lab/agents-pages-proposed/*.jpg` in that worktree.

**Decided** (under `shell-frame`; the classic layout doesn't change):
1. **The rail's section heads are labels again,** in every place's rail. They use the app's own micro-label, the
   `.type-eyebrow` style under `data-luca-shell`: Fragment Mono, 11 px, caps, 0.09em tracking, faint. Each head is 28 px
   tall with 6 px above it. Rows stay 14 px.
2. **Every place's rail row leads with a face,** in one 18 px column, 10 px from the words: faint ink, muted on hover or
   when picked.
   - Things get line drawings: the lab's mapping, lucide icons.
   - Apps keep their maker's mark.
   - Minds keep `AgentMark` at its call sites. WP-41 turns those into fingerprints, so don't change `AgentMark` itself.
3. **The agents pages** (`features/agents/space/`: Notebook, Self, Settings) get the lab's structure.
   - **Type steps:** the name 26/600, section titles 17/600, rows 14, help 13, details 12, labels 11 in mono capitals.
   - **Lines:** a hairline between sections (ink at 0.09), softer rules inside them (0.065), and edges at 0.11 (0.18 on
     hover).
   - **Notebook,** in this order:
     - its intro line;
     - **Place** as a titled section: "Written by {who} · {date} · revision n", Edit place, then Introduction, Exploring
       and Selected work under their labels with hairlines between, the piece card with Open, and the "Let {name} edit
       this place" switch with its explanation;
     - **Asks you,** with its count, the asks in a bordered box;
     - **Saved handoff** as an opener: a row with "Show ›" whose chevron turns, opening to Summary, Unresolved and
       Commitments;
     - then tabs: **Continuity notes n · Journal pages n · Their days.** Each entry shows its kind as a label, its words,
       a line of who wrote it, its revision and its sources, and a date.
     - An empty part says what it will hold.
   - **Self:** each document is a row that clearly opens: its title, its file name in mono, one line of what it says
     (or "Not written yet"), who writes it, when it changed, and a chevron. Then "More files", with New file.
   - **Settings:** every section open, in two columns, with a hairline between sections. No hidden dropdowns.
     - **Left:** the label and the question it answers as a 17 px title ("What runs Luca", "When Luca runs").
     - **Right:** a line of help and the controls, each looking like what it is: a select with its chevron, a switch,
       a button, a link with an arrow.
4. **Real data only.** Wire the structure to what `MindSpace` already reads: notebook entries, continuity notes, journal
   pages, documents and settings. The lab's sample content never ships.
5. **A capability map:** every control and every piece of information on today's agent space, and on the classic agent
   pages it replaced, mapped to its home after, or marked LOST. Nothing may be lost.

**Built beside:**
- **WP-39,** agent fingerprints, is running in new files under `shared/ui/fingerprint/`. Don't touch those or
  `shared/ui/AgentMark.tsx`.
- **The base** for this package is the release line after the glass mini chat and the projects-rooms fix are merged.
  Start from the tip you're given.

**Files in scope:**
- `features/sidebar/ui/ShellRail.tsx`, the place rails in `app/shell/placeRails/`, and the rail CSS;
- `features/agents/space/` (`MindSpace.tsx`, `MindNotebook.tsx`, `MindSettings.tsx` and their siblings) and
  `app/shell/shell-mind-space.css`;
- the specs:
  - update the existing shell specs that assert the old heads or the old place count, citing WP-40 (e.g. `shell-frame`
    places_width now counts Brain);
  - add `tests/e2e/shell-agents-pages.spec.ts`, registered in the smoke project.

**Proof:**
- The rail in Chats, Agents, Activity, Library, Brain and Settings, by night and by day: heads and faces.
- Luca's Notebook (Place, Asks you, the handoff closed and open, notes, journal, days), Self and Settings, at 1440 × 900
  and 800 × 500.
- One agent with little in it, to show the empty parts.
- Each beside the matching lab picture.
- The capability map.
- Flag off, by hash against the base, `:4300`.

**Checks JSON keys:** `rail_heads`, `rail_faces`, `type_steps`, `hairlines`, `notebook_place`, `asks_box`,
`handoff_opener`, `notes_tabs`, `empty_states`, `self_rows`, `settings_open`, `capability_map`, `classic_identical`,
`unit_tests`, `playwright`, `gates`.

## WP-41 · Each agent wears its fingerprint (after WP-39 and WP-40)

Every `AgentMark` call site that knows which agent it shows becomes `<AgentFingerprint residentKey …>`. That includes
the rail's Luca and agent rows (`rail`, with `working` from the agent's state) and the agent's page head (`large`,
64 px). Sites that mean "agents" in general keep `AgentMark`. A small package, briefed when both have landed.

## WP-42 · Each agent grows its own dendrite (2026-10-30, Riley's call)

Riley, seeing the fingerprints in the app: "i hate them … i want something that feels more like it lives in the
family with the sandpile, the dendrite, our voice mode visualizers". After three rounds of live studies
(shell-lab-rail, `design-lab/agent-marks/family`), his pick: "i actually like the original grown best. i think it just
need to be higher resolution. it looks kinda fuzzy right now".

**Decided.**
1. Each agent's mark is its own dendrite: particles that wander in and stick (diffusion-limited aggregation), grown
   once from the same seed the fingerprint used (FNV-1a of `residentGlyphSeed`, Luca's fixed) and kept. The app grows
   the lab's trees number for number (`tree.test.mjs`).
2. Drawn on whole-pixel dots in the dot engine's own ramp: a violet trunk, hot tips. Light runs from the seed to the
   tips on an uneven clock, often while the agent works, and loose grains drift round it without sticking, so the
   tree never changes. Exactly still under Reduce Motion.
3. Sharpened from the study, his "higher resolution": each screen draws at its own resolution (to 3x); 18 in a row,
   72 at a page's head with a finer lattice there; the glow stays on the lattice, never a blur.
4. By day the mark sits in a small black well (shell-rail.css); at a page's head the 72 box is centred on the 52
   column so the well clears the name (shell-mind-space.css).
5. The fingerprint is gone: `shared/ui/fingerprint/`, its kinds provider, its lab and `shell-fingerprint.spec.ts`.
   The props stay as they were (`residentKey`, `size`, `working`), so WP-41's wiring is unchanged.

**Proof.** `shared/ui/dendrite/tree.test.mjs` (6); `shell-mind-space.spec.ts` "each agent wears its own living
dendrite" and "under Reduce Motion each dendrite holds still"; the head and rail face checks in
`shell-mind-space.spec.ts` and `shell-rail-wp34.spec.ts`. Serve the e2e build with a threaded server: the config's
single-threaded one drops connections under load (`ERR_CONNECTION_RESET`) and the app never boots.

## Temporary surfaces · Ink integration (2026-10-30, local review)

Riley selected Claude's `claude/temp-surfaces` study at `ca2a0e25e`: Ink with edge depth,
blue light off. This integration changes temporary surfaces, **not the composer**.

- Conversation asks now have a flat Ink sheet with crisp hairline edges. Its empty foot
  reaches behind the existing composer, including when presence marks or reply context
  occupy the space above the input. Text and controls are never tucked out of reach.
- Permission choices are Deny, Always here **only when offered**, and Allow once as the
  primary choice. Actual scope and exact action details remain available; no safety
  summary is inferred from command text. The authority, wire values, and grant rules are
  unchanged. Activity and agent-page ask rows keep their current layout and labels.
- Hide or Escape folds the sheet to the actual question and Waiting count. Hidden controls
  are inaccessible; reopening restores focus to Hide, and answering the last ask returns
  focus to the composer. Existing expiry/resolution announcements are retained.
- The native-agent discovery notice and standing-access confirmation use the same neutral
  material. The notice stays in its original transcript location, requires Luca's canonical
  signer, and keeps its review action. Broad access still requires a separate confirmation
  with Cancel initially focused. No access is changed by closing or cancelling it.
- Classic layout remains untouched. Reduced Motion removes the sheet-edge entrance;
  reduced transparency keeps the solid surface without grain. No native glass masks or
  Ghost code changed. This is an honest web surface, not simulated desktop transparency.

**Proof:** 46 focused unit checks; six `luca/temporary-surfaces.spec.ts` browser checks;
eight `shell-room-asks.spec.ts` checks covering both themes, short windows, long forms,
running work and every decision's wire call. Typecheck, frontend E2E build, served lab
build, scoped Biome, px-text and diff checks pass. One existing browser assertion was
updated deliberately: the folded lip now names the question rather than “Needs you · Show”.

**Not yet release proof:** no new native candidate, native activation walkthrough, installer,
notarization or publication in this pass. Disk remained below the native-build reserve.
Claude's redesigned agent pages (WP-43) remain a separate handoff. The broader browser
suite's previously recorded baseline failures are not claimed fixed by these focused checks.

## WP-43 · Each agent's page is their place; Settings is yours (2026-10-30, Claude's design; Riley's call)

Its first two commits say WP-42; the number went to the dendrite the same night.

**Why.** Riley, after walking through the rail-glass candidate (his recording, 2026-10-29 23:59): "the entire
experience of navigating the agents page, agent settings, basically everything related to each individual agent is
just kind of a mess. its spread out in a very odd way, it isnt intuitive, reaching the compaion settings is buried deep
within one of the tabs/pages, and theres a good amount of formatting issues." Astra proposed five tabs. Claude proposed
two places and built them as a study. Riley chose it: "1000x better than it was ... lets keep going with your two
places." Then, refining it with him:
- "we originally intended for each agent to have a place of their own ... the place where their autonomous activity
  lives, things they make or do on their own, where their work and creations might live";
- "not feel overwhelming ... super clean in terms of what is what and where each section starts and ends";
- of Settings: "i liked how it felt familiar like chatgpt".

One sentence holds it: **their page is theirs (what they write, make and do); Settings is yours (everything you
decide).** This replaces WP-40's three tabs and its all-open Settings. WP-40's type steps and lines stay.

**The study** (approved for its paths and its look):
- `~/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-canonical/design-lab/agent-pages-study.html`. Open
  it over http; the `shell-lab` launch config serves that folder on :4790.
- Its source is beside it in `agent-pages-study-src/`; its pictures are in `agent-pages-study-shots/` (01–14).
- Its "lived-in" content (the made things, the journal, Luca's introduction) is invented for the study and never
  ships.
- Its Luca documents, settings rows and log lines are real, read from a local test profile, and never enter the repo.
- Where its numbers differ from the app's tokens, the app's tokens win.

**Base.**
- Repo `~/Documents/Repositories/luca-agent-network-v1`.
- Worktree `~/Documents/Repositories/.claude-worktrees/wp42-agent-place`, branch `claude/wp42-agent-place`, off
  `claude/native-rail-glass` @ 3147123aa. This brief is its first commit, and you are its only writer.
- Never build in `luca-beta14-polish`: it holds Astra's uncommitted agent-space study. Don't touch
  `desktop/src/testing/agentSpaceStudy/`.
- Port **4352**.
- Symlink `desktop/node_modules` from `luca-beta14-polish`, and never commit the link.

**Files in scope:**
- `desktop/src/features/agents/space/` (`MindSpace`, `MindNotebook`, `MindSettings`, `mindSection`, `mindStream`) and
  new siblings there;
- `desktop/src/app/shell/shell-mind-space.css`;
- the agents route's search (`desktop/src/app/routes/agents.tsx`) and what reads it;
- the Agents place rail rows (`desktop/src/app/shell/placeRails/`);
- the app Settings pane that takes the agents' appearance choice;
- the specs: update `desktop/tests/e2e/shell-agents-pages.spec.ts` (cite WP-42) and add `shell-agent-place.spec.ts`
  to the smoke project.

**Untouched:** the classic layout (flag off), `shared/ui/fingerprint/`, `shared/ui/AgentMark.tsx`, the relay,
Mnemos, and the release files.

**Facts the build rests on** (checked 2026-10-30 against 3147123aa):
- **The page today.** `MindSpace.tsx` draws the head and three tabs (`MIND_TABS`: notebook, self, settings) beside the
  "At a glance" aside (`MindAside`).
- **Settings today.**
  - It is `SettingsSection` (in `features/agents/ui/AgentLibraryWorkspace.tsx`), laid out by `MindSettings.tsx` as
    ten open sections: runtime, wakes, workspace, read, permissions, identity, character, rooms, health, companion.
  - Its "Instructions" row shows `managedAgent.systemPrompt`. For Luca that is the soul text, so the same words appear
    twice.
  - "Runtime configuration" is `AgentConfigPanel advancedMode="flat"`. For Claude Code agents it lists the whole of
    `~/.claude/settings.json`, which every Claude Code agent shares: about 30–40 rows.
  - The companion is `CompanionSettingsSection`, reached by a button at the very end of Settings.
  - The character picker (`CharacterAppearancePicker`, Sphere or Glyph) says it applies "across your agents".
- **The data.**
  - `mindStream.ts` already gives every entry a kind: journal and memory entries, things made (artifacts, drawn by
    `MadeThumb`), and own or for-you (`forYouOrOwn`).
  - The Place (introduction, exploring, selected work, "Let {name} edit this place") is `features/agents/place/`
    (`useResidentPlace`).
  - Nothing yet records when you last looked at an agent's page.
- **Ways in name a Settings row:** `?at=read|runtime|permissions` (`parseMindSettingsAt`), plus the old `section` and
  `tab` values (`mindSectionOf`, `mindSettingsAtOfTab`).
- **Tokens:** `shared/styles/globals/conversation-shell.css` (`--mn-*`), `app/shell/shell-mind-space.css` (a mind's
  hairlines, edges and type steps), and the label style `.type-eyebrow`.

**Decided.**

*Navigation*
1. **Two places per agent.** Picking an agent in the rail always opens **their page**. **Settings** is one button in
   their header. There are no tabs.
2. **Everything else is a page that slides in, in the same frame.**
   - These pages are: a document, a thing they made, everything they made, and each Settings pane.
   - Each has a back link at the top left that names where you came from ("‹ Luca", "‹ Settings", "‹ Made").
   - The title bar's back and forward arrows walk the same history. Esc and ⌘[ go back; ⌘] goes forward.
   - On arrival, focus moves to the page's title.
   - The push is a 22 px slide with a fade (340 ms, `cubic-bezier(.2,.85,.25,1)`). With reduced motion it's a 120 ms
     fade.
3. **The URL says where you are**, in the agents route's search. A page survives a reload, and every old way in still
   lands on its new home:
   - `at=read` lands on Can read, `at=runtime` on Harness, `at=permissions` on Permissions;
   - the old `section` and `tab` values land on their new homes.

*Their page (their place): one header, then three sections built alike*
4. **The header.**
   - Their fingerprint (72) and their name (26/600).
   - **One status line** (13, muted) saying what they're doing: Resting, Off, Talking with …, Working in …, or
     "On their own · {what} · {time}". The breathing dot shows whenever they're live. If the data can't tell their own
     work from yours, say so; don't guess.
   - A companion that's resting adds "· Keeping up with Codex and Claude Code". That part is a quiet link to
     Settings › Keeps up with.
   - The harness line under it (12, faint).
   - On the right: **Talk** (the solid ink button) and **Settings** (the thin-border button, with the gear).
5. **What sits under the header.** When they ask you something, the asks box (today's `PlaceAskRow`s in one thin
   border) sits right under it. When something's wrong (`lastError` or `needsRestart`), one bordered notice with
   Restart or Retry sits there instead. Nothing else is boxed above the sections.
6. **Their words come next.**
   - The Place introduction at 16 px in ink, to 60ch.
   - Then "Exploring" as a `.type-eyebrow` label, with their line.
   - With no introduction: "{name} hasn't written an introduction yet. Write one or let {name} write it."
7. **Three sections, each built the same way:** a hairline (ink 0.09), the title (17/600) on the left, its one
   control on the right, then its content. They sit 36 px apart.
   - **Made by {name}.**
     - Four even tiles, each with its picture, title and one line:
       - the picture on the plate (ink 0.04, an inset 1 px ring at 0.1, radius 8, 16:10);
       - the title (13/500, two lines at most);
       - one line under it, such as "Pinned · Yesterday", "On their own · Oct 27" or "For you · Oct 26".
     - Their Selected work comes first, as "Pinned".
     - "See all N ›" opens Made: every piece, three across, filtered All · On their own · For you.
     - A piece opens to its own page:
       - the large picture;
       - "{name} made this on their own (or for you) · when · kind";
       - their note on it, and where it came from;
       - Open, and Show in Library.
   - **Notebook,** with chips (`.luca-mind-filter`) on the right: Journal n · Pages n · Notes n.
     - Journal entries are rows: the title (14/500), two lines of the entry, and the date on the right.
     - Pages are the documents they write: Who I'm becoming, What I know about {you}, and Lessons. Each row opens a
       reading page.
     - Notes are the continuity notes.
     - It opens on Journal if there are entries, otherwise on Pages.
   - **Days,** with chips: All · On their own · With you.
     - "Where {name} left off" (the saved handoff's opener) comes first.
     - Then the three latest days, each under a `.type-eyebrow` day label. An entry shows its glyph, its words,
       "On their own" or "With you", and the time.
     - An entry about something made opens that piece. A conversation opens its room.
     - "Earlier days ›" shows the rest.
8. **New since your last visit.**
   - Keep one "last looked" time per agent, community-scoped. Reset any module-level store in `resetCommunityState`.
   - Anything newer than it gets a 6 px ink dot: a piece, a journal entry, or a day entry.
   - The agent's row in the Agents rail gets the same dot, before its state note.
   - Opening their page records the visit. The dots stay for that visit and are gone the next time.
9. **A new agent with nothing yet** has no words and nothing made, written or done. It gets one bordered box in place
   of the three sections:
   - "{name}'s place is empty for now", with one line on what will live there;
   - **Give {name} time of their own**, which turns on their "While you're away";
   - "or start a conversation".

*Settings (yours): the look Riley chose, filled panels and plain titles*
10. **The page.**
    - At the top: "‹ {name}", their small fingerprint and "Settings" (24/600).
    - Under it, one line: "Everything you decide about {name}. Their page is theirs: what they make, write and do
      lives there."
    - **Groups are filled panels:** `--mn-plate` with a hairline edge, radius 10.
    - Each group has a plain title above it (13/600, sentence case).
    - **Rows** are at least 44 px: the label (13), a help line (11.5, faint), the value on the right (13, muted), and a
      chevron. A row with a switch or a select carries it inline.
    - A group may have a footnote line under it.
    - Use the app's own switch and select, unchanged. No colour but the inks.
11. **The groups, in order.** A row marked (pane) opens a pane.
    - **Who {name} is.**
      - Soul, Convictions and Instructions, each opening its editor. The value is when it was last edited.
      - A Hermes or OpenClaw agent shows "Instructions · Managed by {runtime}", with no editor.
      - Footnote: "You write these. {name} reads them each time they start."
    - **Their page.**
      - "Let {name} arrange it": a switch. On, they may write their introduction, say what they're exploring, and pin
        something they made.
      - Their words (pane): the Place editor, with introduction, exploring and selected work.
    - **Companion,** for agents with companion settings.
      - Keeps up with (pane).
      - Noticing: a switch that pauses their awareness.
      - While you're away: a switch.
      - Footnote: "Only new and changed sessions are followed; old history isn't brought in."
      - An agent without the companion's awareness gets **On their own** instead, holding only "While you're away".
    - **How {name} runs.**
      - Model: the inline select (`ResidentModelMenu`), with "Changing it restarts {name}".
      - Harness (pane).
      - Permissions (pane); the value is their access level.
      - Works in (pane); the value is the folder, or "No folder set".
      - Can read (pane); the value is what Brain shares.
      - Wakes with the app, and Restarts on their own after a change: both switches.
      - Answers; the value is "Only you".
    - **Advanced.**
      - {Harness} settings (pane); the value is "N values".
      - Files (pane): the other files in their folder, with New file.
      - Network identity (pane): the public key with Copy, custody, definition, kind and authority.
      - Logs: today's `LogsSheet`.
    - Last, **Restart {name}** and **Stop {name}** (or Start) as two quiet buttons.
12. **The panes** are pages. Each has "‹ Settings", a title, and a line saying what it decides.
    - **The document editors** (Soul, Convictions, Instructions): today's editor at reading width, with Discard and
      Save.
      - If you leave with unsaved changes, the page stays and says "Save or discard your changes first."
      - The note under it: "{name} reads this each time they start. After you save, they restart with it once they're
        idle."
    - **Keeps up with:** today's companion settings, laid out as two groups.
      - "Following": Codex work and Claude Code work, each with its status, a switch and Review access.
      - "Also available": A file, Browser activity and App activity, each with Add.
      - Then "Use a different profile folder" as a disclosure, and the footnote on what isn't connected.
    - **Permissions:** today's `MindPermissions`.
      - The two choices as cards, and "Use the household default".
      - Remembered permissions, each with Forget.
      - Canvas tools, and Manage MCP access.
    - **Harness:** the runtime, the program, the version or profile, and Thinking (from {harness}'s own settings), with
      Recheck and Advanced… (the edit dialog).
    - **Works in:** the folder they start in and their documents folder, with today's actions.
    - **Can read:** `BrainMindAccess`, with Open Brain.
    - **{Harness} settings:** `AgentConfigPanel`.
      - Read-only and searchable.
      - Grouped: model and thinking, plugins, plugin sources, look and feel, everything else.
      - It opens with "These belong to {Harness}, not to {name}: every agent that runs on {Harness} shares them."
13. **Shown once.** No text appears twice. If the runtime's system prompt is built from the documents, Settings
    doesn't show it. If it's an agent's only instructions (one with no folder), it is the Instructions row.
14. **Sphere or Glyph** applies to every agent, so it moves to the app's Settings, in the pane that holds the app's
    look.

*The look of their page (the app's own, not the study's)*
15. **Their page speaks `shell-mind-space.css`'s language exactly:** ink and its alphas, hairlines and thin edges, the
    type steps, `.type-eyebrow`, the solid Talk button and the breathing dot. No other colour and no gradients
    anywhere; measure it.

**Capability map (required).** Map every control and every piece of information on today's agent space to its home
after, or mark it LOST. That covers the head, the three tabs, the aside, and every Settings section and button.
Nothing may be lost. The seeds:
- At a glance → the header's lines and Settings' row values.
- Rooms ("Where {name} talks") → Talk and the Days entries.
- Health → the header notice.
- Stop, Restart, Start → the Settings footer.
- Open logs → Advanced › Logs.
- Recheck and Advanced… → Harness.
- Character → the app's Settings.
- The companion settings dialog → Settings › Companion and Keeps up with.
- Place and Edit place → their words, and Settings › Their page.
- Self's documents → Settings › Who {name} is (the ones you write) and Notebook › Pages (the ones they write).
- More files → Advanced › Files.

**Rules.**
- No invented content. Every word comes from the data `MindSpace` reads today, and an empty part says what it will
  hold.
- Text is rem. Use tokens, not raw values.
- Five states on every control. Honour reduced motion.
- The classic layout stays identical, by hash against the base.
- Do your own exact-edit recon first, and write your plan to the scratchpad.
- Touch only the files in scope. Commit on `claude/wp42-agent-place` with explicit paths.
- Never stash, merge, push or rebase. Stop only your own processes, by PID.
- The rules in "For every agent", at the top of this file, apply.

**Proof** (Playwright, the mock bridge, the real component tree; 1440 × 900 and 800 × 500, by night and by day):
- Their page for Luca with a full stream: the top, then Notebook and Days.
- The asking state, and the working-on-their-own state.
- A made piece's page, and Made.
- One new agent's empty place.
- Settings in full, then Keeps up with, Permissions, the Soul editor (with the unsaved-change stop), and Claude Code
  settings searched for "plugin".
- The rail's dot appearing for new work and clearing after a visit.
- Back, forward, Esc, ⌘[ and ⌘] through three levels.
- Each `at=` way in landing on its pane.
- Each picture beside the matching study picture (01–14).
- The capability map.
- Flag off, by hash against the base.

**Checks JSON keys:**
- structure: `two_places`, `no_tabs`, `header_one_status`, `sections_same_pattern`;
- their page: `made_tiles`, `made_all_filters`, `notebook_chips`, `days_filters`, `left_off_first`, `new_marks_items`,
  `new_mark_rail`, `empty_place`;
- Settings: `settings_groups_order`, `settings_panels_measured` (fill, edge, title size), `panes_open`,
  `unsaved_guard`, `shown_once`, `appearance_moved`;
- navigation: `history_three_levels`, `keyboard`, `deep_links`, `reload_keeps_place`;
- look and safety: `no_stray_colour`, `capability_map`, `classic_identical`, `unit_tests`, `playwright`, `gates`.

**Since the build (2026-10-30, as built).**
- *Merged with WP-42:* the dendrite is the mark at the page head (72, square in a 72 column, 16 px clear of the name)
  and beside the Settings title (28).
- *Riley's calls:* no standing "Works with" list; a Days talk entry names the other minds in its room ("With you ·
  with Fifty"; "A, B and C"; "A, B and 2 others"). The title bar says "{name}" on their page and "{name} · {page}" on
  every page pushed from it.
- *Round 3 (an independent walk of Riley's paths):*
  - **Leaving with unsaved changes** keeps the exact destination for every way out. The row under the editor asks
    "Save changes to {Doc} before leaving?" with Keep editing · Discard · Save; Save holds focus. Save saves then
    goes (a failed save stays, keeps the text and says why); Discard drops then goes; Keep editing or Esc stays, the
    caret where it was. After the move, focus lands on the destination's heading (a conversation keeps its own
    composer focus). History steps (the title bar's arrows, ⌘[ ⌘], the back link) are held before they happen
    (`app/navigation/leaveGuard.ts`): the router's blocker hears them only after the browser has stepped, and steps
    a held forward the wrong way.
  - **The chat drawer's links** open their homes directly with `page=`: Open {name} their page, Instructions where
    they live (the Instructions row's page, or Settings for a native runtime's), Notebook their Notebook, Settings
    Settings. Old `section=self` and `section=documents` go to Settings, `section=overview` to their page,
    `section=notebook` to their Notebook.
  - **The empty place's main action** says the real reason in the header's words, with the fix beside it: off,
    "Start {name}"; not set up, "Set up {name}"; a running harness without the companion's private channel (that is
    what `nativeChannelAvailable` is), "{Harness} can't take time of their own yet". When it can't be used, "Start a
    conversation" leads. Settings › Companion's While you're away says the same.
  - **One harness value** for the header, the Settings row, the Harness pane and "{Harness} settings".
  - **Restart** reads "Restarting {name}…", disabled, and the status line says so, until it settles.
  - **No cut sentences:** the status line wraps under the name.
  - **Instructions not set** say "Not set" and open where they're written.
- *Round 4 (the re-walk of round 3):*
  - **The browser's own step forward** with unsaved changes is held the same way as the app's steps: heard before
    the router hears it (a capture listener added before the router is made) and stepped straight back, so while the
    row asks, and after Keep editing or Esc, the address, the title bar and a reload all stay on the page. The
    browser's step back stays with the router's blocker, which restores it rightly.
  - **Fresh moves start at the top.** A page opened by a link, a drawer row, a rail row or a button starts scrolled
    to the top; only a step back or forward comes back to where that page was, kept per history entry
    (`features/agents/space/mindScroll.ts`). The router keeps one scroll for every agent page (its key is the path),
    so the page places itself after the router has.
  - **The breathing dot** is held to its sentence's first word and never sits alone on a line.
  - **Small ones:** after a drawer jump focus lands on the page's heading; the drawer's runtime line names the
    harness as the page does ("Claude Code"); mid-restart the footer keeps "Stop {name}", held, never "Start"; an
    old address word with no new home (`profileTab=channels`) is dropped too, so no old parameter lingers.
  - **Empty-place lines,** said once and the same in Settings › Companion › While you're away: "{Harness} can't take
    time of their own yet."; "{name} is off, so they can't take time of their own." [Start {name}]; "{name} is off and
    isn't set up on this Mac yet." [Set up {name}].

### Integration verification (2026-10-31)

- Checkpointed the local Ink surfaces and design studies at `02226ec1c`, then
  merged the exact WP-43 handoff `57021c50a` into `claude/native-rail-glass`
  as `bae1fc7d6`. The only conflict was this document; both sections were kept.
  WP-43 production code is unchanged from the handoff.
- All **4,440 desktop unit tests** pass. `pnpm build:e2e` (including TypeScript),
  the served shell-lab build, px-text and diff checks pass.
- All **117 focused browser tests** pass: the requested `shell-agent-place`,
  `shell-mind-space`, `shell-agents-pages`, `shell-settings-agents` and
  `shell-pages` specs, plus the six production temporary-surface checks.
- The four classic-layout comparisons used an actual threaded baseline server,
  not a missing default port. Its retained browser bundle was built before the
  WP-43 merge and corresponds to `02226ec1c` (WP-42 plus the Ink integration).
  All four comparisons are pixel-identical. This is not a new full-suite
  comparison against `3147123aa`; the previously reported broad-suite failures
  remain outside this focused gate.
- Reviewed the real merged pages in the browser and the captured dark/light,
  compact Settings, companion access, and unsaved-edit states. The review used
  sample data; no installed profile, runtime settings or permissions changed.
- No native candidate, installer, signing, notarization or publication was
  performed in this integration pass. The next release gate is the combined
  native candidate and Riley's walkthrough.

### First-look composer correction (2026-10-31, on `175a01d4d`)

- Frame chat and new-chat composers now use the approved preview's 46 px
  capsule: 23 px radius, `5px 5px 5px 6px` padding, `--mn-raised` fill in both
  modes, no shadow or visible border. The solid-frame day override agrees.
- Mini chat uses the same geometry, replacing its bright rail plate with a
  2.5% ink step over the existing panel. Its glass and the agent marks are
  unchanged; Claude's separate studies remain pending.
- Long drafts retain the full-width text area and anchored bottom controls.
  The + button's one-pixel movement on expansion is also corrected.
- TypeScript, frontend build, scoped Biome, px-text and diff checks pass.
  **12/12 focused browser checks pass**: six composer cases (chat/new/mini,
  Obsidian/Paper, idle/focused/expanded/cleared), plus six existing temporary
  surface checks. Screenshots are under `desktop/test-results/luca-composer-refinement-*`.
- Native proof completed with temporary inspector CSS in the existing
  candidate, not a rebuilt bundle. At 1372 x 835, chat/new-chat/mini each
  measure 46 px high, 23 px radius, the exact padding above, and no shadow
  in both Vitesse Black and Paper. Chat/new-chat fills are `rgb(12,12,12)`
  at night and `rgb(243,241,238)` by day (`--mn-raised`). Mini chat uses
  2.5% ink over its unchanged glass (WebKit reports alpha `0.024`), with an
  8% ink idle Send disc and no shadow. Captured pixels confirm the mini
  well is only a small step from its panel, not the former light slab.
- Native long drafts open the full-width text area above the buttons in
  new chat and mini chat; clearing returns the 46 px capsule. All six idle
  native captures, expanded views, and the approved preview are saved in
  `/tmp/polyphonic-composer-proof`. Screenshot cursor highlights are from
  the control tool, not composer shadows.
- Restored the original Luca conversation, Vitesse Black theme and window
  size; closed mini chat and the inspector and cleared all test drafts.
  No messages were sent or permissions changed. The running candidate
  retains the temporary CSS preview until restart; permanent source changes
  still need inclusion in the next combined candidate build.
- Nothing committed, signed, tagged, pushed or published in this correction.

### Mini chat: approved Lens material and compact controls (2026-10-31)

Supersedes the mini-chat geometry/material in the composer correction above;
main chat and new chat keep that correction's 46 px capsule.

- Ported Riley's approved `claude/minichat-glass @ 2caaab9e2` study. The veil
  paints once, with three unmasked rounded lens layers and a frosted core.
  The parent does not create a backdrop root. The morph hook keeps each
  layer's radius concentric with the existing launcher-to-panel animation.
- Header: 32 px, 13 px title, 14 px icons in 24 px targets. Mini composer:
  36 px, 13/18 text, 30 px controls, 18/8 px concentric corners, eight-pixel
  insets, quiet 3% white / 4% black fill. Main/new-chat geometry is unchanged.
- Full-width multiline typing grows above anchored controls in 160 ms;
  six-line internal scrolling, blue caret, keyboard-only focus rings,
  restrained hover/press feedback, armed Send and new-message arrival motion.
- Messages scroll below the header with proportional edge masks. New content
  follows only while at the end; a reader scrolled away gets a newest arrow.
  Close/minimize/Escape return focus to the launcher. Menus dismiss on outside
  click and before the panel on Escape. IME guards include keyCode 229.
- Opaque panel fallback retained; reduced motion removes the added animations.
- Focused browser verification: all 20 unique cases pass across composer
  refinement, existing Quick Chat behavior, and the new Lens coverage. The
  effort tests now reopen the picker after Send, matching outside dismissal.
  Synthetic IME events are not a substitute for a real Japanese input check.
- Unsigned native candidate rebuilt successfully in the shared Cargo cache.
  Native night/day captures cover rest, header hover, one/two lines, menus
  and scroll fades. WKWebView renders the nested frost; the parent reports
  no backdrop filter and the first lens reports blur(1.5px) brightness(1.15).
  Header is 32 px and composer 36 px, with no composer shadow. The user's
  Small text preference is retained (13/18 design tokens scale to 11.7/16.2).
- Native pixel samples: night panel/rail both RGB 10; idle composer RGB 18.
  Day panel RGB 247/247/245 versus rail 248/247/245; idle composer 237/237/235,
  focused composer 231/231/229. Faint text contrast against the sampled
  composer is 6.58:1 at night and 4.56:1 by day. This is sampled evidence,
  not a contrast guarantee over arbitrary future content behind the glass.
- Native menu Escape and close-to-launcher focus verified. The actual solid
  frame fallback renders RGB 14/14/15 with 16 px corners and no glass layer.
  Reduced-motion behavior is covered by the focused browser check; an OS
  accessibility-toggle walkthrough is not claimed. Japanese input was
  temporarily enabled with Riley's approval, but automation emitted literal
  Romaji instead of composition events. Real IME confirmation/cancellation
  remains a manual check. U.S. input, the hidden input menu, English-only
  dictation, Vitesse Black and Liquid Glass were restored; drafts cleared.
- Evidence and the side-by-side review page are in
  `~/Documents/Polyphonic-Candidates/2026-10-23-rail-glass/proof-lens-20261031/`.
  Previous candidate and profile are preserved in `rollback-before-lens-20261031/`.
  No messages sent; production profile/app untouched. No release, push, tag
  or signing is part of this change.

### Mini composer corner correction (2026-10-31)

- Riley rejected the Lens study's 18/8 px split corners after seeing them in
  use. The mini composer now has equal 18 px corners: a true 36 px pill at
  one line, retaining the same rounding when expanded. Glass, fill, insets,
  controls and the main/new-chat composers are unchanged.

### Mini chat: edge-to-edge conversation and native controls (2026-10-31, WIP)

- Riley approved a native control layer: the conversation now reaches both
  panel edges, with the existing soft masks/blur at the edges instead of
  solid bands. The title is gone; options, minimize and close remain separate
  24 px floating controls. App context and attachments live under +.
- On supported Macs in Glass mode, `NSGlassEffectView` renders the composer
  and header controls above WKWebView. The input and buttons are inside its
  content view, so their text stays sharp. Solid/Reduce Transparency and
  older-system/browser fallbacks retain the web controls. Main/new-chat UI
  is unchanged. No private glass API is used.
- Native input feeds the existing draft, attachment and send callbacks. Session
  IDs and acknowledged revisions reject stale echoes; active marked text is
  not replaced. Native controls yield to modal dialogs and page reloads.
- Verification: frontend build/typecheck, targeted Biome, diff checks and
  26 focused browser cases pass in one run. Four windowless AppKit checks
  pass for marked-text confirmation/cancellation and ordinary Return/Escape.
  These are not a real Japanese keyboard-conversion walkthrough.
- The first native rebuild was exercised through accessibility: plain text,
  Shift-Return, undo, +/agent menus, Escape and minimize/reopen worked. Test
  drafts were cleared; no chat was sent. Full-size native visual review is
  still pending: macOS capture returned only a thumbnail. Do not call the
  native material visually approved from browser screenshots.
- The previous candidate and its profile are cloned in
  `~/Documents/Polyphonic-Candidates/2026-10-23-rail-glass/rollback-native-controls-20261031/`.
  Builds use the one shared cache. Nothing published, pushed, tagged or
  release-signed. This WIP is not yet release-approved.
- Final unsigned debug rebuild succeeded and the same candidate/profile was
  reopened. The native + chooser opens, but automated file selection could
  not complete (Open remained disabled); end-to-end native attachment picking
  and real IME conversion remain explicit walkthrough items alongside the
  visual check. The chooser was canceled, menus dismissed and draft left
  empty. Only the rebuilt candidate is running. About 102 GiB remained free;
  the temporary browser-test server was stopped, not the design preview.

### Mini chat: approved bare-controls refinement (2026-11-01)

- Supersedes the native-control experiment above. Riley chose the web Lens
  treatment after comparing it with the native controls. The existing native
  floor glass remains unchanged; mini chat no longer mounts a second native
  input or button layer above the page.
- More, Minimize and Close sit directly on the surface: 12 px marks with the
  existing 24 px targets, no notch, discs, plate or framed header. Both minus
  and X remain. No title or context row is added back.
- Conversation flows edge-to-edge under the existing soft blur. Its sampling
  layers now explicitly share the panel's corner radius. The floating 36 px
  pill keeps its 18 px corners; attachments and app context remain under +.
- The rejected native experiment is preserved outside the source tree in the
  candidate's `superseded-native-controls-20261101` folder, not compiled or
  shipped. The previous app and profile have a clone-backed rollback copy.
- Focused browser checks cover bare controls, edge clipping, input/IME guards,
  context and attachment menus, retained drafts, scrolling, opaque fallback
  and unchanged main/new-chat composer geometry. No publication is authorized.
- Final verification: all 24 focused browser cases pass in one run; frontend
  typecheck/build, scoped Biome, px-text and diff checks pass. Unsigned native
  debug build succeeded in the shared cache. Actual native window screenshots
  confirm the bare controls and soft edges. Multiline paste, retained draft on
  minimize/reopen, + context menu and close were exercised in the candidate;
  the test draft was cleared, no message sent and no permission changed.
  The same candidate/profile is open for Riley. Approximately 85 GiB free.

### Mini chat: compact add-to-message menu (2026-11-01)

- The + popover contains only Attach image, Attach current view, and Include
  app context. Removed the snapshot explanation, extracted page text, and
  visible-controls dump; no change to what context is sent or its opt-out.
- Kept the approved Lens material, composer, and bare header unchanged.
  The small menu focuses its first action, closes on repeated + or Escape,
  and retains the draft. All 24 focused browser cases, typecheck/build,
  scoped Biome, px-text, and diff checks pass. No publication authorized.
- Native candidate rebuilt in the shared cache and reopened on the same
  profile. Verified the compact menu visually and the native image chooser's
  open/cancel path. No message sent or context preference changed.

### Claude adapter recovery (2026-11-01)

- The candidate reported "Claude Code adapter is missing". Claude Code itself
  was present, but the shared app-managed `Buzz/node-tools` directory was absent.
  The cause of that directory's removal is not established; this is required
  runtime software, not a disposable build cache.
- Restored `@agentclientprotocol/claude-agent-acp@0.61.0` into the app's private
  npm prefix without replacing profiles, credentials, settings, or history.
  The unversioned installer selected 0.99.1 first, which rejected this beta's
  initialize request. Discovery now pins the compatible 0.61.0 version, matching
  the existing model bridge, with a regression assertion for that install command.
- Actual candidate verification: adapter initialized, relay connected, and Luca
  answered a bounded no-tools connection check in the existing conversation.
  Five model-bridge tests pass and the real adapter accepts the bridge hooks.
  The Rust regression test was added but its run was stopped when Cargo began
  rebuilding test dependencies; it is not claimed passed. The installer source
  pin is included in the growing-marks candidate build below; the runtime
  dependency is restored. Nothing published.

### Approved growing agent marks (2026-11-01)

- Ported Claude's `fine-marks.js` at `588e972a3`, with the handoff correction
  `42ac41247`: working growth is 1.5x, rest is 2x, working bypasses choir, and
  the 120-second overdue cap remains. No visual tuning. Only engine behavior
  change: every size below 40 uses the small-mark behavior, as requested.
- The 18px rail/place marks share `rail`; 28px settings marks use `settings`;
  the 72px page head stays independent. Exact opaque wells add 1px per side
  while preserving existing face centres, column widths, and name spacing.
- One shared loop; hidden/offscreen marks pause; resolution-media changes
  rebuild backing stores at actual DPR (capped at 3). Reduced motion draws
  the study's still tree. All product marks use the shared INKFLOOR ramp.
- Verified exact pixel parity with the study over 10,800 frames: 18/28/72px,
  DPR 2/3, working/resting, plus reduced motion. Eight targeted engine tests,
  all 4,442 desktop units, eight focused rail/page browser cases, typecheck,
  frontend build, scoped Biome, px-text, and diff checks pass.
- Native debug build passed in the shared cache with incremental compilation
  disabled. Reopened Polyphonic Rail Glass Candidate on its existing isolated
  profile, with source receipt for `21e18c4c3`; approximately 85 GiB remains free.
- Native Retina proof now captured: 18px rail, 28px individual Settings head,
  and 72px page head in night/day; 125-second rail/head recording; 12 growth
  frames at 1/30-second intervals; 3x nearest-neighbour crops. Claude reviewed
  the rail/head/growth captures over the verified two-way inbox and confirmed
  fidelity to the study. Original dark appearance restored.
- Evidence is in `~/Documents/Polyphonic-Candidates/2026-11-01-agent-marks/`
  (`NATIVE-PROOF.md`). Native Reduce Motion screenshots and native frame-cost
  timing remain open; automated tests are not claimed as those native checks.
  Additional report-only Odyssey 1x captures await foregrounding after Stage
  Manager tucked the moved window into a thumbnail. Approximately 90 GiB free.
  No publishing, tagging, release signing, or pushing is authorized.

### Original 72px agent mark (2026-11-01, supersedes the large mark above)

- Riley selected the Aug 10 original at 23:24 CST; source is Claude's
  `original-72/CODEX-HANDOFF.md` at `73af60481`. The earlier growing-head
  treatment and the unlanded v2 proposal are not the approved large mark.
- Sizes >=40 use a separate TypeScript port of the original `DotPanel`/DLA
  drawing. Its 72px border-box circle, unchanged INKFLOOR ramp, grey dust,
  random trees and cooling/reset behavior match the supplied engine. Working
  does not alter this mark. The only adaptations are the approved 60-step/sec
  shared clock (four-step cap, 20-step mount, seven-step resize settle) and
  live pixel-ratio observation. Native system Reduce Motion is not changed.
- The 18/28px renderer, tree, grouping and well remain as at `21e18c4c3`;
  their design is still open with Riley. Head centering/16px name gap restored
  to the pre-`21e18c4c3` geometry.
- The unchanged engine fixture and the port produce identical image bytes
  after 620 steps at DPR 1 and 2. Fake 60/120/240Hz clocks each produce exactly
  600 steps in ten seconds plus 20 on mount. Reduce Motion paints the mount
  frame once with no loop. Nine focused browser checks pass, plus three
  Retina-scale head/rail checks; typecheck/frontend build and scoped Biome pass.
- Native debug build passed at `bf453bcdb` in the shared cache with signing
  skipped. The candidate reopened with its existing isolated profile. Claude
  approved the source port; the native 1x night capture has been sent for review.
  Retina night/day captures and the ten-second recording await foregrounding
  on the built-in display; native visual approval is not claimed yet. Evidence:
  `~/Documents/Polyphonic-Candidates/2026-11-01-original-72/NATIVE-PROOF.md`.
  No release, signing, publication, tag or push is authorized.

### Starter delegation blockers (2026-11-05)

- Consume authenticated, in-sequence activity frames even when final publication
  has already ended their durable dispatch. Such activity remains hidden and
  unauthorized, but its following completion can now revoke the exact turn lease;
  a later owner request no longer collides with completed turns.
- Permission snapshots are latest-request-wins. Overlapping initial/event reads
  cannot hide a newly pending approval or resurrect one already answered.
- No contributor rules changed: resident/epoch/conversation/turn binding,
  fail-closed ambiguity, advertised approval options, and the owner-bounded
  sibling-delegation restriction remain intact. No automatic grant or wider
  source access was added. Existing approval cards and chat layout are unchanged.
- Checks: seven presentation lifecycle, three turn-authority, 28 native
  permission, 20 inbox, and 13 frontend permission tests passed; the browser's
  in-place approval/answer flow, typecheck, scoped Biome, frontend build, and
  diff checks passed. Native walkthrough evidence is recorded separately in
  the isolated instance's `STARTER_SPECIALISTS_CHECK.md` after rebuilding.
- A concurrent native run exposed a second delivery race: the inbound
  ownership-profile lookup timed out and cached a negative result for a
  configured specialist. Replies were present in their tasks but Luca dropped
  them until restart. Managed pair-task returns now use the already verified,
  current owner-signed task head to classify that exact signed recipient reply;
  the normal exchange and dispatch gates still run. This is cached-head-only,
  turn 2 only, with exact pair membership, channel, audience and signature.
  It does not grant source/tool access, admit arbitrary agent messages, override
  Nobody, change legacy admission, or enable sibling-triggered new delegation.
- All 37 exchange-cache checks pass, including a cached-negative ownership
  lookup, closed/expired/stale/wrong-owner heads, wrong sender/audience/channel,
  invalid signatures, exact turn limits, Nobody, and legacy isolation.

### Claude API connection (local candidate, 2026-11-05)

- Settings → Connections & MCP has one masked Anthropic key field and Connect.
  Verification lists models without generating a reply. API usage is charged to
  that key's Console account, including already-enabled background work; the app
  cannot determine promotional-credit eligibility or the account's remaining
  balance. No additional observation, notes or background-work grants are enabled.
- The Claude runtime owns a dedicated OS credential item, scoped to the owner
  and app-data instance. Disk stores only an opaque generation. IPC status never
  returns the key, a suffix or a native credential. Native Claude settings/login
  files, imported profiles, other harnesses and external Claude sessions stay
  untouched. Builds without a secure credential backend reject the connection.
- Managed local Claude residents pick up changes through dispatch-aware idle
  reconnects. Active work finishes first; a changed PID, owner or connection
  cancels the queued reconnect. App restart uses the saved choice naturally.
- API sessions require the SDK's direct first-party API-key confirmation before
  accepting a prompt. Conflicting native provider/auth settings fail closed;
  no automatic subscription fallback. Use Claude login explicitly disconnects
  this app's API route and reconnects through the existing native login.
- No publication, release tag, signing, push or daily-app replacement authorized.

### Quiet delegation and real plans (local candidate, 2026-11-10)

- Answer-only native requests use `purpose: ask`, a short title, and a private,
  owner/resident-scoped scratch directory rather than a project picker. Project
  tasks and existing-session operations retain their previous execution policy.
- Explicit model/effort choices must be advertised and acknowledged by the
  native session before its prompt is sent. Short asks prefer low effort only
  when that model advertises it; saved harness preferences remain unchanged.
- A complete short answer returns with harness attribution through the existing
  scoped delivery lease and outbox, without a second model synthesis. Excerpts
  and project-task results retain the existing reviewed summary path.
- Native public plans/Todo snapshots appear in Luca's chat and the task page.
  Pending, active, and completed steps remain distinct, including after restart;
  a terminal turn never fabricates completion of an unfinished plan. Room views
  redact step text, and reasoning text is never used as a plan.
- The app-owned `buzz.todo` tool also supplies its actual successful list state.
  Its older open/done format stays pending/completed; "next" is not invented
  active work. Only bounded, redacted plan metadata crosses the tool-body guard,
  never arbitrary tool results, failed writes, commands, or private reasoning.
- Routine work stays in one compact row, with Open task and Stop. No automatic
  drawer/window or completion notice is added. Results use the shared formatted
  message renderer and appear only once on the task page.
- Verification and native timing are recorded with the isolated candidate.
  No wider source/tool grant, new harness, Ghost/Mnemos change, publication,
  signing, tag, push, or daily-app replacement is part of this pass.
