# Polyphonic beta.14: the release that carries the new shell (2026-10-26)

Riley, 2026-10-26: "Yes, go with the plan: call it beta.14, the shell on by default with the old layout as a switch for
one release, leave the Obsidian WIP out, cut the five Buzz ties and keep the license notice."

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

**Why.** Conversations and work are told apart. Luca, a project and a room are one ongoing chat each and never nest.
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
   - Projects never nest: their rooms stay in the project's own column, as `roomsInColumn` draws them today. That
     behaviour becomes the only one, and the setting retires (in the capability map).
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
