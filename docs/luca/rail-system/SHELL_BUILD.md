# Building the shell

The build plan for `SHELL_SPEC.md`, run as a team (Riley, 2026-10-24: "Start the team on the narrowed scope in
SHELL_SPEC.md (no tabs), reusing the Rail Glass test app. Stop only at the key moments."). Claude (the session that
designed the shell with Riley) decides, briefs, reviews and merges; one build agent per work package builds; two
independent reviewers check every package before it lands. Each package lands as its own commit on the integration
branch, so any one can be dropped later.

The key moments, the only places the team stops for Riley: the glass look in the test app (WP-07), and the finished
test app (WP-09). After every other package Claude sends him a short note and a few pictures, without waiting.

## For every agent: read this first

**The contract.** `docs/luca/rail-system/SHELL_SPEC.md` is what the shell is; `docs/luca/rail-system/SPEC.md` is the
rail inside it. The shell study is the reference for every value: `desktop/src/testing/shellStudy/` (`ShellStudy.tsx`,
`shellStudy.css`, `marks.ts`, `nativeGlass.ts`). When the study and the spec disagree, the spec wins; say so in your
report. Tabs are out of scope everywhere (the spec's "Tabs (later)").

**Packages run side by side.** Several builders work at once, each on its own branch from the same base. Keep to your
files in scope; put your styles in the stylesheet your brief names, never in another package's; and where your brief
lets you touch a shared file (`AppShell.tsx`, `AppSidebar.tsx`, `SettingsPanels.tsx`, `conversation-shell.css`), keep
the edit small and self-contained, so Claude can merge the packages by hand without conflicts. If you need something
another package is building at the same time, say so in your report rather than building it too.

**Where you work.**
- Repo `/Users/rileycoyote/Documents/Repositories/luca-agent-network-v1` (a public repository). The integration branch
  is `claude/native-rail-glass`, local only.
- Your worktree and branch are named in your dispatch; they already exist, with `node_modules` linked. Work only there.
- Never `git stash`, never merge, never push, never rebase another branch, never touch another worktree. Commit on your
  branch with explicit paths (`git add <path>`; never `git add .`, `-A` or `-u`). Activate the toolchain first in every
  shell: `. ./bin/activate-hermit` from the worktree's root. No commit hook runs here: format your own changed files
  with `./node_modules/.bin/biome check --write <files>` from `desktop/` before committing.
- **Never run `pnpm install`, `pnpm run`, `pnpm build`, `pnpm exec`, `pnpm test` or any `just` recipe in your
  worktree.** Its `node_modules` folders are links to the main checkout's, and pnpm tries to reinstall them, which
  would wipe the main checkout's packages. Call the tools directly from `desktop/node_modules/.bin/`, as below. Never
  commit the `node_modules` links.

**Nothing on Riley's screen.**
- Never run `just dev`, `tauri dev`, `cargo tauri`, `open`, a headed browser, or any app bundle. Never build the Tauri
  app: Claude builds the test app at the key moments.
- Playwright runs headless only.
- If your package touches Rust, use `cargo check` or `cargo clippy` through `bash scripts/with-internal-build-cache.sh`,
  never another target folder (one shared build cache, always).

**Your own processes only.** Serve your build on your own port (your dispatch names it) and leave it running for the
reviewers; stop only your own processes, by PID. Never `pkill` or `killall` by pattern. Disk is tight (about 24 GB
free): no new caches, nothing written outside your worktree and your scratch folder.

**The rules of this codebase** are in the repo's `CLAUDE.md` / `AGENTS.md` and bind you. In particular:
- text sizes are rem tokens (`text-base`, `text-sm`, `text-xs`, `text-2xs`, `text-3xs`), never px or arbitrary rem;
- `node scripts/check-px-text.mjs` must pass;
- no new `unwrap()` or `expect()` in Rust production paths;
- module-level caches must reset in `resetCommunityState()`;
- `React.memo` needs stable props.

**The flag.** Everything the shell changes is behind the preview feature `shell-frame` (WP-01 adds it), off by default
until WP-09. With the flag off, the app must look and behave exactly as it does on the integration branch. Prove it
with screenshots compared by hash against the base build Claude serves at `http://127.0.0.1:4300` (the integration
branch as your branch started; read-only, never stop it).

**How to prove it** (every command from `desktop/`).
- Build: `./node_modules/.bin/tsc && ./node_modules/.bin/vite build --mode e2e` (about 12 seconds).
- Serve: `python3 -m http.server <your port> --bind 127.0.0.1 -d dist`, and leave it running.
- Tests: `LUCA_PLAYWRIGHT_PORT=<your port> ./node_modules/.bin/playwright test <spec> --project=smoke` (register a new
  spec in `playwright.config.ts`'s smoke `testMatch`).
- The app renders in a browser only with the mock bridge: `installMockBridge` from `desktop/tests/helpers/bridge.ts`.
  Seed the flag before installing it: `page.addInitScript` setting `localStorage["buzz-feature-overrides-v1"]` to
  `{"shell-frame": true}` (check `desktop/src/shared/features/store.ts` for the exact key).
- Wait for animations (`desktop/tests/helpers/animations.ts`) before every screenshot.
- Screenshots: `deviceScaleFactor: 2`, saved in your scratch folder, named for what they show. Every hash must be
  unique.
- Measure, don't reason: bounding boxes, colours, contrast. A check you could not run is reported as not run.
- Gates before your last commit, all from `desktop/`: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`;
  `./node_modules/.bin/biome check <your changed files>`; `node scripts/check-px-text.mjs`; the unit tests for what
  you touched (`node --import ./test-loader.mjs --experimental-strip-types --test <files>`); your Playwright spec.
  Report each with its count.

**When you move or remove UI**, add a capability map to your report: every control in the old place → its new home, or
LOST. LOST is a failure unless the spec retires it.

**Report format** (return exactly this):
1. Summary, 8 lines at most.
2. Files changed (absolute paths; new ones marked NEW).
3. Screenshots (absolute paths).
4. Checks: one JSON object with the keys your package names.
5. Console: verbatim, or "clean except …".
6. Deviations from the brief, with reasons.
7. Open questions.
8. The commit hash and your served URL.

## The log

| Package | Landed | What |
|---|---|---|

## WP-01 · The frame, Black, dark (2026-10-24, Riley and Claude's design; Riley: "Start the team on the narrowed scope")

**Why.** The first step of `SHELL_SPEC.md`: the shell's frame in the real app, Black frame, dark mode, behind a flag,
page only. A thin frame (the lip across the top, the places column down the left) holds two cards, the rail's and
the conversation's. Read the spec's "The frame, as decided", "Black (Paper in light)" and "What each surface of the app
becomes", and open the study in a browser (`/scripts/shell-lab.template.html?experience=shell&mode=dark&frame=solid`
on your own server) to see the target.

**Base.** Branch `claude/native-rail-glass`. Your worktree and branch: in your dispatch.

**Files in scope:**
- `preview-features.json`;
- `desktop/src/shared/features/` (only to read the flag);
- `desktop/src/app/AppShell.tsx`, `AppShell.helpers.ts`, `AppTopChrome.tsx`, `BuzzThemeSurfaces.tsx`,
  `useTauriWindowDrag.ts`;
- a new `desktop/src/app/shell/` folder for the frame's own components;
- `desktop/src/features/sidebar/ui/AppSidebar.tsx`, `AppSidebarPinnedHeader.tsx`, `SidebarProfileCard.tsx`;
- `desktop/src/shared/ui/sidebar.tsx` (only behind the flag);
- `desktop/src/features/chat/ui/ChatHeader.tsx` (only to hide its title under the flag);
- `desktop/src/shared/styles/globals/conversation-shell.css`, or a new `shell-frame.css` imported beside it;
- tests under `desktop/tests/e2e/` and unit tests beside what you change.

**Untouched:**
- the study (`desktop/src/testing/shellStudy/`);
- Settings (WP-05);
- the rail's rows, sections and grouping (WP-02);
- the selection glass and marks (WP-03, except the static current-place plate below);
- the conversation header's actions (WP-04);
- light mode beyond not breaking (WP-06);
- anything native or Rust, `tauri.conf.json`, the traffic lights' native position (WP-07);
- Settings → Appearance.

**Facts the build rests on** (checked by Claude):
- Preview features are listed in `preview-features.json` (repo root), validated by
  `desktop/src/shared/features/manifest.ts`, with per-machine overrides in localStorage
  (`desktop/src/shared/features/store.ts`) and read with `useFeatureEnabled`.
- Today the top of the window is `AppTopChrome`: a transparent 42-point strip at top 8 with the toggle, back and
  forward, not rendered in Settings (`AppShell.tsx` around 942).
- The rail is the shadcn `Sidebar` in `AppSidebar.tsx` (offcanvas, 220 default, resizable to 420), painted as floor,
  with a pinned header (the search field), the primary menu (Library, New conversation, Inbox behind its flag, Agents,
  Activity, Brain, Settings) and a footer of status cards and the profile card.
- The conversation's card is `BuzzTheme.ContentSurface` (margin 8 / 8 / 8 / 1) for most routes. A conversation's
  workspace grid instead pads by `--mn-card-lip` (8) with `--mn-card-gap` (4) between panes, and its outer surface
  goes transparent. Library, Agents and Activity paint their own card (`routeOwnsFloor`).
- The window drag band is the top 44 (`WINDOW_DRAG_HANDLE_HEIGHT`, `AppShell.helpers.ts`).
- The app's `--radius` is 0.625rem (10).

**Decisions:**
1. **The flag.** Add `shell-frame` to `preview-features.json` ("The shell's frame", desktop, default off). It is also on
   when the build sets `VITE_LUCA_SHELL_FRAME=1`, so a test app can ship with it on. With it on, `<html>` carries
   `data-luca-frame="solid"`, and every rule of this package keys on that attribute or the flag.
2. **Flag off is today, exactly:** pixel-identical by hash for a conversation, Library and Settings at 1440 × 900.
3. **The lip** replaces `AppTopChrome` under the flag:
   - the window's top 36, full width, on the floor (no card, no fill of its own);
   - drawn on every route except Settings for now (WP-05 brings Settings in);
   - holds the existing toggle at x 78, top 10 (24-point buttons, 15-point icons, the study's `shell-lip-button`), and
     back and forward at `max(card's left + 6, 112)`;
   - holds the open page's name, centred on the conversation card's axis, as the spec's "Tabs (later)" says, at 13 and
     weight 550 in the frame's ink;
   - the name's text is exactly what the conversation header shows as its title today (same source), and on other
     routes the route's own page name;
   - the conversation header's title is hidden under the flag (its actions stay where they are until WP-04).
4. **The places column:**
   - 44 wide under the lip, a `nav` labelled "Places". Top: New conversation (the existing handler, ⌘N) and Search (the
     existing search dialog, ⌘K). Then Conversations (to `/`, which opens the last conversation), Library, Inbox (only
     when its flag is on), Agents, Activity, Brain. At the bottom: Settings (⌘,) and the avatar, which opens the
     existing profile menu.
   - Icon tiles 28 with corners 9, 16-point lucide icons at stroke 1.6, the same icons the study uses. Tooltips name
     each place and its key.
   - The current place shows a static plate (the page's ink at 7.5%) until WP-03 brings the moving marks.
5. **The rail's card.**
   - Under the flag the rail is a card: x 44, top 36, 6 above the window's bottom, 220 wide and not resizable, the card
     surface with the app's dark card edge and grain, corners 10.
   - Its pinned header, primary menu and profile card are not rendered (they live in the places); its list and its
     status cards stay.
   - The toggle and ⌘S close the card: its width runs to 0 over 460 ms on `cubic-bezier(0.32, 0.72, 0, 1)`, instant
     under Reduce Motion.
   - Hover peek and the narrow-window sheet keep working.
6. **The conversation's card.**
   - Under the flag every route's content card sits top flush with the lip (36), 6 from the window's right and bottom,
     4 from the rail's card (from the places' edge, 44, when the rail is closed), corners 10. This covers both today's
     route surface and the conversation workspace grid (`--mn-card-lip` 6 under the flag, `--mn-card-gap` 4).
   - Library, Agents and Activity fill this card instead of painting their own.
   - The right cards slot keeps its cards 4 from the conversation's card and 6 from the window's right, top flush with
     the lip.
7. **The floor** is the palette's floor (black on the default), painted by the page; the places column and the lip
   sit on it.
8. **Drag:** under the flag the drag band is the lip's 36, not 44; the empty lip still drags and double-clicks as
   today.
9. **The conversation header's 140-point dodge** and `AppTopChrome`'s left clearances do not apply under the flag.
10. **Type:** the frame's words in rem tokens (the study's 13 is `text-[0.8125rem]` there; use the nearest named
    token, and if none matches, add a named rem token in `tailwind.config.js` as `AGENTS.md` says). The lip and places
    stay fixed points.
11. **Order and access:** Tab order is the lip, then the places, then the rail's card, then the conversation's card.
    A closed rail card is inert.

**Verification** (Playwright, headless, 1440 × 900, 1280 × 720 and 800 × 500, flag on unless stated). Screenshots:
- `conversation` (#general open);
- `rail-closed`;
- `library`;
- `brain`;
- `right-card` (conversation details open);
- `places-hover` (hover on Agents);
- `min-window` (800 × 500);
- `flag-off-conversation`, `flag-off-library`, `flag-off-settings`, with their hashes compared to the same shots of
  the base build Claude serves at `http://127.0.0.1:4300` (the integration branch as your branch started; read-only,
  never stop it).

Measure: the lip's height; the places' width and icon centres; the rail card's x, width, top and bottom; the
conversation card's insets; the gap between the cards; the corner radii; the name's centre against the card's centre.

**Checks JSON keys:**
- `flag_off_identical` (three hashes, each pair);
- `lip_height`, `places_width`, `rail_card`, `conversation_card`, `card_gap`, `corner_radius`, `name_centred`;
- `drag_band`;
- `capability_map_lost` (count, must be 0);
- `reduced_motion_instant`;
- `gates` (tsc, biome, px-text, unit, e2e with counts).

## WP-02 · The rail, ironed out (2026-10-24, Riley and Claude's design; Riley: "Start the team on the narrowed scope")

**Why.** The rail inside the shell's rail card is `docs/luca/rail-system/SPEC.md` ("The rail, ironed out"), written
from Riley's notes and shown in the shell study, which he approved. Its sentence: **Luca first; then every place you
talk, each with its sessions nested under its name.** Read all of `SPEC.md`, and see the study's rail
(`ShellStudy.tsx`'s conversations rail, `shellStudy.css` "the conversations rail") on your own server
(`/scripts/shell-lab.template.html?experience=shell&mode=dark&frame=solid`).

**Base.** The integration branch; WP-01 (the frame) is being built at the same time. It adds the `shell-frame` flag
to `preview-features.json`: add the identical entry yourself so you can test (it merges as one line), and read the flag
with `useFeatureEnabled("shell-frame")`. Until WP-01 lands your rail shows inside today's sidebar, which is expected;
judge the rows, not the frame. Your styles go in `desktop/src/app/shell/shell-rail.css` (new). Your worktree and
branch: in your dispatch.

**Files in scope:**
- `desktop/src/features/sidebar/ui/ChatList.tsx`, `AgentRail.tsx`, `AppSidebar.tsx` (the rail's list and its wiring
  only);
- `desktop/src/features/sidebar/lib/` (`chatListModel.ts`, `agentRailState.ts` and new helpers beside them);
- `desktop/src/features/runtime-sessions/` (only to move Runtimes out of the rail);
- `desktop/src/features/agents/ui/` (only to give Runtimes its place on the Agents page);
- `desktop/src/features/projects/ui/ProjectRoomWorkspace.tsx` and `desktop/src/app/routes/ChannelRouteScreen.tsx`
  (only for the project room column option);
- `desktop/src/features/settings/ui/SettingsPanels.tsx` (only the one new "Project rooms" row);
- `desktop/src/app/shell/shell-rail.css` (new) for the rail's rows;
- `preview-features.json` (only the identical `shell-frame` entry);
- tests.

**Untouched:**
- the marks and the selection glass (WP-03): the rows only carry the attributes below, and today's pill keeps
  following `data-active`;
- the frame's geometry (WP-01);
- the conversation header (WP-04);
- light mode beyond not breaking (WP-06);
- anything native.

**Decisions.** `SPEC.md` is the contract, all of it, with its three open choices taken as the study shows them
(Claude, recorded here): Runtimes leaves the rail for the Agents page; the section is named **Fleets**; the open
session is marked by lit text and a lit 1-point thread segment beside it (2 under Increase Contrast).

Only under the `shell-frame` flag: with the flag off, today's rail is untouched.

1. Order: Luca (opens the main Luca thread), then PROJECTS, AGENTS, FLEETS, each with its `+`.
2. One home per chat, by `SPEC.md`'s four rules, with a unit test proving no chat appears twice.
3. Rows:
   - no glyphs;
   - a parent's chevron right after its name;
   - one trailing slot (the unread dot, or "working…", or the `+` on hover and focus, the `+` winning);
   - child rows on the thread, quieter text, no timestamps.
4. The `+` on a home starts a new session in it (an agent: a new session with it; a project: a new room; a fleet: a
   new session with the group). The "New session" and "Chat with …" rows go. The FLEETS `+` uses the app's existing
   flow for a new conversation with several agents; if there is none, it opens New conversation. Report which.
5. Selection:
   - the parent of whatever is open carries `data-active="true"`;
   - the open child carries `data-current="true"` and `aria-current="page"`, never `data-active`;
   - opening a parent opens its main session and expands it; the chevron only expands and collapses;
   - expansion is remembered per home;
   - a collapsed parent whose session is open keeps `data-active`.
6. Keyboard: Up and Down between visible rows, Right opens a parent or steps into its first session, Left closes it
   or steps back. The `+` is reachable by Tab with its label ("New session with Wren", "New room in Tidepool").
7. Projects nest their rooms in the rail by default. Settings → Appearance gains one row, "Project rooms: In the rail
   · In a column"; "In a column" keeps today's room column.
8. Type and measures as the study: homes 14, sessions and labels per the study's CSS, section labels in Fragment Mono
   capitals at 11, in rem tokens.

**Verification** (Playwright headless, 1440 × 900, flag on unless stated). Screenshots, every one named and with a
distinct hash, from `SPEC.md`'s "Done means":
- nothing open;
- Luca open;
- an agent's session open (the agent row active, the session lit);
- a project room open;
- a fleet open;
- a collapsed parent with an open session;
- hover showing the `+`;
- keyboard focus on a `+`;
- flag off, compared by hash to the base.

Mock data needs projects, several agents with sessions, and a group chat: extend the mock's seed in your spec if it
lacks them, and report what you added.

**Checks JSON keys:**
- `no_chat_twice` (the unit test and its count);
- `order`, `rows_no_glyphs`, `trailing_slot_single`;
- `plus_actions` (each home kind, and what FLEETS `+` does);
- `selection_attributes`, `expansion_remembered`, `keyboard`;
- `runtimes_on_agents_page`, `project_rooms_setting`;
- `flag_off_identical`;
- `capability_map_lost` (0);
- `gates`.

## WP-07a · Glass plumbing (2026-10-24, Riley and Claude's design; Riley: "what if we made the normal glass automatically apply for older macOS machines")

**Why.** The machinery behind the Frame setting: the setting itself, what the Glass choice draws on each kind of
machine, and the window around it. Read `SHELL_SPEC.md`:
- "The frame setting" and both "Glass" sections;
- "The native glass";
- "The window".

The glass's look is ported here from the study's values. Claude tunes it by eye in the test app at WP-07b, the key
moment with Riley, so port the numbers exactly and cite where each came from.

**Base.** The integration branch; WP-01 (the frame) and WP-02 (the rail) are being built at the same time. Add the
identical `shell-frame` entry to `preview-features.json` yourself so you can test, and read the flag with
`useFeatureEnabled("shell-frame")`. Your worktree and branch: in your dispatch.

**Files in scope:**
- `desktop/src/shared/theme/ThemeProvider.tsx` (the frame on the theme context, the window's appearance, the frosted
  fallback);
- `desktop/src/features/settings/ui/SettingsPanels.tsx` (only the Frame row, under the flag);
- new `desktop/src/app/shell/shellGlass.ts` (the page's reporter to the native glass) and
  `desktop/src/app/shell/shell-glass.css` (the page under glass);
- `desktop/src/features/sidebar/ui/NativeRailGlass.tsx` (only so it stands aside under the flag);
- `desktop/src-tauri/src/commands/window_chrome.rs`, the command list in `desktop/src-tauri/src/lib.rs`, and
  `desktop/src-tauri/capabilities/default.json`, for the traffic lights command and the window's appearance;
- `preview-features.json` (only the identical `shell-frame` entry);
- tests.

**Untouched:**
- the frame's layout (WP-01) and the rail (WP-02);
- the marks (WP-03);
- `PolyphonicGlass.swift` (it already understands everything below; if you find a real bug there, report it, don't
  fix it);
- `build.rs`, the candidate script and `tauri.conf.json` (WP-09);
- the Obsidian and Crystalline themes (WP-08);
- light-mode styles beyond the glass's own.

**Facts the build rests on** (checked by Claude):
- `PolyphonicGlass.swift`'s header documents the page protocol over the `polyphonicGlass` handler:
  - `frame` with `sheet {x, y, w, h, r, style, tint, appearance}`, `floor` (`"none"` or a hex), `card`, `row`, `clip`;
  - `settings`;
  - `off`.

  It announces itself as `window.__POLYPHONIC_NATIVE_GLASS__` and a `polyphonic-native-glass` event. It attaches only
  in builds with `LUCA_BUILD_NATIVE_GLASS=1`, launched with `LUCA_NATIVE_RAIL_GLASS=1`, on macOS 26 and later.
- The study's reporter is `desktop/src/testing/shellStudy/nativeGlass.ts`: `reportFrame` dedupes by JSON, plus
  `startGlass`, `stopGlass`, and `useNativeGlass` with Reduce Transparency. `sync` in `ShellStudy.tsx` sends the sheet
  as the whole window with radius 16, floor `"none"`, and the conversation card's rect with radius 10.
- `NativeRailGlass.tsx` (the rail-glass test build's reporter) sends the card, floor, row, clip and settings.
- `set_window_vibrancy(enabled, material, state, corner_radius)` in `src-tauri/src/commands/window_vibrancy.rs`
  installs an `NSVisualEffectView` behind the page. `ThemeProvider`'s `applyGlassVibrancy` uses it for the glass
  themes (material `"sidebar"`, state `"active"`). `applyWindowAppearance` pins the window's theme only for those
  themes.
- `set_traffic_lights_hidden` in `window_chrome.rs` shows how the standard window buttons are reached through public
  AppKit.
- The main window's capability file lacks `core:window:allow-set-theme`.

**Decisions:**
1. **The setting.** Stored in localStorage `polyphonic-frame` (`solid` or `glass`, default `solid`) and exposed on the
   theme context as `frame` and `setFrame`. Only under the flag.
2. **Appearance.** Under the flag, directly under System / Light / Dark: a Frame row with two choices.
   - The first is "Black", named "Paper" when the palette is light.
   - The second is named "Liquid Glass" when the native glass has announced itself, "Glass" otherwise. It is not
     offered outside Tauri (a browser).
   - One plain sentence under the row, as the spec words it.
   - `NativeGlassSettings` is not rendered under the flag.
3. **What Glass draws:**
   a. Native glass announced and Reduce Transparency off: the page sends `frame` messages with
      - `sheet` = the whole window, radius 16 (0 in full screen), style `regular`, tint `#00000080` in dark and `null`
        in light, `appearance` from the palette;
      - `floor: "none"`;
      - `card` = the conversation card's rect and radius;
      - `row` and `clip` null.

      Plus `settings` with `cardGlass: false`. Dedupe as the study does. Report on every layout change (resize, route,
      every frame while the rail slides). `NativeRailGlass` stands aside under the flag.
   b. Tauri on macOS without the native glass (macOS 14 to 25, and every build without it): `set_window_vibrancy`
      with
      - state `active`, corner radius 16;
      - the heads-up display material in dark;
      - in light, the under-window background material for now (a provisional pick for Riley to judge).

      Use the names the command accepts.
   c. Outside Tauri: no glass; the frame is solid.
   d. Reduce Transparency: no glass anywhere; the frame is solid. Leaving Glass sends `off` and clears the vibrancy.
4. **The window's appearance** follows the palette (light or dark) for every palette under the flag, not only the
   glass themes. Add the capability.
5. **The page under glass:**
   - `<html data-luca-frame="glass">`;
   - every floor layer transparent (the list `railGlass.css` already clears for `data-luca-native-glass`, plus the
     shell's own floor);
   - a veil layer behind the lip and the cards, at Soft 22%: black at night, the palette's floor tone by day;
   - the frame's words: at night `rgb(250 248 243)` at 96 / 76 / 56%; by day the page's ink at 100 / 84 / 66%;
   - the cards on glass: at night a lit top (`0 -0.5px 0` white 12%) and shadows (`0 1px 2px` black 25%,
     `0 18px 44px` black 32%); by day no white edges.

   All of it in `shell-glass.css`, each value citing its line in `shellStudy.css`.
6. **The traffic lights.**
   - A new command, `set_traffic_lights_inset(x, centre)`, for the main window only. It places the standard buttons so
     the first one's left edge is at `x` and their centre sits `centre` from the window's top, in points.
   - Re-apply it after a resize and on leaving full screen.
   - Public AppKit only, no private API, no `unwrap` or `expect`.
   - The page calls it with (16, 22) when the flag is on, and restores the configured position when it is off.

**Verification.**
- Unit tests:
  - the setting: storage, default, naming by platform;
  - the reporter: the messages for given geometry, dedupe, `off` under Reduce Transparency;
  - the fallback: `set_window_vibrancy` called with the right arguments, with `invoke` mocked.
- A Playwright spec (mock bridge, headless) showing the Appearance row and its sentence in dark and light, with Tauri
  present and absent and the native glass announced and not.
- Rust: `cargo check` and `cargo clippy` for the desktop crate (`--manifest-path desktop/src-tauri/Cargo.toml`)
  through `bash scripts/with-internal-build-cache.sh`; format your Rust with `rustfmt` on the changed files.
- Nothing native can be seen here: Claude looks in the test app at WP-07b.

**Checks JSON keys:**
- `setting_storage`, `appearance_row`, `naming_by_platform`;
- `reporter_messages`, `frosted_fallback_args`, `reduce_transparency`;
- `window_appearance`, `traffic_lights_command`;
- `glass_css_values` (each with its source line);
- `flag_off_identical`;
- `gates` (including cargo check and clippy).
