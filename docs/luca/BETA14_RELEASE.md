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

1. Merge WP-30 and WP-31 by hand.
2. Run every gate, the whole shell suite, and the desktop's Rust tests.
3. Build the release candidate (WP-32), checked from its files and never launched here:
   - with the beta overlay;
   - without the updater key, so no updater archive and no publication.
4. Build a rail-glass test app from the same commit, for behaviour.
5. Riley's walkthrough, in his own time: a fresh install and an upgrade from beta.13, in a disposable account, as the
   release README requires.
6. On his word: signing with the update key, notarization, the tag `v0.5.0-beta.14`, and the upload, in the order the
   README gives.

## Riley's further calls (2026-10-26)

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
