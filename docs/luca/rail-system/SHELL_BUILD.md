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
| WP-01 the frame, Black, dark | 2026-10-24, merge `bfda2d8a0` | The lip, the places, the rail's card and the conversation's card, behind `shell-frame`. Flag off matches the base by hash. Review fixed the cards' edge light, the lip riding the card's slide, and the unread dot on Conversations; the small rest went to WP-01b. 4,204 unit tests pass. |
| WP-02 the rail, ironed out | 2026-10-24, merge `aa4b0d29c` | Luca first, then Projects, Agents and Fleets, each home's sessions on a thread, one home per chat; Runtimes on the Agents page; the Project rooms setting. Review fixed the homes' corners and gave a project's details a home on its row. At the merge the rail reads the frame's own switch, and the frame's spec opens #general by its route. Both specs pass together (the frame's motion trace needed one retry under load); 4,210 unit tests pass. A group named after one of its chats, and the small rest, went to WP-02b. |
| WP-05 Settings in the frame | 2026-10-24, merge `cfaa57d3d` | The frame stays in Settings: its section list in the rail card's place, its panels in the conversation card's; Back to app goes; ⌘K and ⌘N work there. Review fixed the panels card fading in, the unread dot, the version line at small sizes. At the merge, the specs open #general by its route, retried past the first redirect. |
| WP-02b the rail, finished | 2026-10-25, merge `54a98f0a1` | Groups named by their members; column mode without nested rooms; aria-expanded; first row at 6; slot order; Runtimes on the Agents page aligned and lit on hover; Conversations returns to the conversation you left; Search's first Escape. |
| WP-04 the header into the lip | 2026-10-25, merge `c43649156` | The card's header is gone: layout, open as window and details in the lip's right end; Join, presence and the ephemeral badge there; panes name the focused one in the lip and the others quietly; the description as the name's tooltip. |
| WP-07a glass plumbing | 2026-10-25, merge `9f19579f0` | The Frame setting and row; the reporter for Liquid Glass; the frosted fallback; the veil; glass word tones on the lip and places; daytime shadows under the cards on glass; `set_traffic_lights_inset`. The glass marks only `data-luca-frame-glass`. Rust not compiled yet (disk under 20 GB): WP-07b. |
| WP-01b the frame, finished | 2026-10-25, merge `e4996cc0d` | The avatar as the study's, its menu beside it, the DEV chip in it; the rail's foot and every card's edge grained; New conversation fills its card; Conversations opens a closed rail. At the merge it shares the lip's edge measure with WP-04 and the Conversations place with WP-02b. |
| WP-03 the solid marks | 2026-10-25, merge `26c6d14b3` | The study's marks engine ported (14 unit tests): a plate on the current place and on the open home, sliding and stretching on the house springs, closing to a point with the rail; the old pill and the native pour retired under the flag. At the merge the rail's top breath keeps WP-02b's form. |

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

## WP-01b · The frame, finished (2026-10-24, Claude's design, from WP-01's review)

**Why.** WP-01's reviewers measured a few small differences from the study that its fix round left for later, and its
builder asked two questions. This package closes them. Read WP-01's section above, and `SHELL_SPEC.md`, "The places
column" and "The frame, as decided".

**Base.** The integration branch with WP-01 landed. WP-04 (the header) and WP-05 (Settings) are built at the same
time; WP-02 (the rail) and WP-07a (glass plumbing) are still running from the base before WP-01. Your worktree and
branch: in your dispatch.

**Files in scope:**
- `desktop/src/shared/styles/globals/shell-frame.css` (only the rules these decisions name, and new rules for them);
- `desktop/src/features/sidebar/ui/SidebarProfileCard.tsx` (the avatar and the DEV chip under the frame);
- `desktop/src/features/profile/ui/ProfilePopover.tsx` (only optional placement props; their defaults keep today's
  placement exactly);
- `desktop/src/features/sidebar/ui/AppSidebar.tsx` (only the Conversations tile's handler, `onSelectConversations`);
- `desktop/tests/e2e/luca/shell-frame.spec.ts` and unit tests.

**Untouched:**
- the lip (`ShellLip.tsx`) and the conversation header (WP-04);
- Settings (WP-05);
- the rail's rows (WP-02);
- light mode beyond not breaking (WP-06).

**Decisions** (only under the `shell-frame` flag; with it off, nothing changes):
1. **The avatar** reads as the study's `.shell-avatar`:
   - the disc is painted once, at the ink at 14%, with the fallback inside it transparent (today two layers stack to
     about 36%);
   - the initial is `text-xs`, weight 550.
2. **The avatar's menu opens beside it,** to the right of the places column: side right, aligned to the avatar's
   bottom, 8 from the column. It no longer covers the avatar or Settings.
3. **The DEV build chip** (dev builds only) moves into the avatar's menu, beside the name at its top.
4. **The rail card's foot has no seam.** The footer's fade is drawn as the card itself (the card's grain over its
   surface, masked from opaque at the bottom to clear), the way `.luca-conversation-veil-*` is drawn, so the grain
   never stops at a line.
5. **The grain reaches every card's edge.** The conversation card and the route cards (Library, Agents, Activity,
   Brain, New conversation) lose their 1-point grainless ring, as the rail card already has, without anything inside
   them moving.
6. **New conversation fills the card:** its body (`[data-testid="new-message-body"]`) paints no surface of its own,
   as was done for Library, Agents and Activity.
7. **Conversations, pressed while the rail is closed** and you're already in a conversation, opens the rail with its
   motion (the same as the toggle and ⌘S). From any other place it still goes to the last conversation.

Still later, not here:
- communities moving into the avatar's menu (WP-08);
- the reconnecting overlay retiring (WP-08).

**Verification** (Playwright headless, 1440 × 900 and 800 × 500, deviceScaleFactor 2, flag on unless stated):
- `avatar` (the disc and its initial, measured against the study);
- `avatar-menu` (open beside the column, with nothing covered);
- `rail-foot` (the grain's brightness and spread, measured down the card's last 40 points);
- `card-edge` (the grain at the conversation card's outer point, against the rail card's);
- `new-conversation` (no flat panel);
- `conversations-reopens-rail` (before and after);
- the flag-off shots compared by hash to the base.

**Checks JSON keys:** `avatar_disc`, `avatar_initial`, `menu_placement`, `dev_chip`, `rail_foot_seam`,
`card_edge_grain`, `new_conversation_surface`, `conversations_opens_rail`, `flag_off_identical`, `gates`.

## WP-04 · The conversation header into the lip (2026-10-24, Riley and Claude's design; Riley: "Take your recommended pick for all 12 decisions")

**Why.** In the shell, the conversation's card has no header of its own. Its name is already in the lip (WP-01), and
its actions move up beside it. Read `SHELL_SPEC.md`: "The conversation's card" (the header bullets), "Decided" 3 and
4, and "Keyboard".

**Base.** The integration branch with WP-01 landed. With the flag on, the card still shows an empty 56-point band with
the actions at its right: that band is what you remove. WP-05 (Settings) and WP-01b (polish) are built at the same
time. Your worktree and branch: in your dispatch.

**Your styles** go in `desktop/src/app/shell/shell-header.css` (new), imported by `globals.css` right after
`shell-frame.css`. The two header rules at the end of `shell-frame.css` (the hidden `chat-title` and the stood-down
dodge) are yours: move them into your stylesheet.

**Files in scope:**
- `desktop/src/features/chat/ui/ChatHeader.tsx`, `desktop/src/features/channels/ui/ChannelScreenHeader.tsx`;
- `desktop/src/features/channels/ui/ChannelScreen.tsx` (only the measured top padding);
- `desktop/src/app/shell/ShellLip.tsx` (only a right-hand slot inside the lip's part over the card,
  `.luca-lip-card`);
- `desktop/src/shared/layout/chromeLayout.ts` (only the top padding's value under the flag);
- `shell-header.css`, `globals.css` (its one import line);
- tests.

**Untouched:**
- the right cards' own header (`AuxiliaryPanelHeader`) and the Canvas's header, which keep their own heights;
- the forum, project and new-conversation screens' headers;
- the project room column (WP-02 makes it an option);
- the update dot (WP-08);
- light mode beyond not breaking (WP-06).

**Decisions** (only under the `shell-frame` flag; with it off, the header is today's, exactly):
1. **The actions move to the lip's right end,** over the conversation's card, 8 from its right edge, as the lip's own
   buttons:
   - 24-point tiles, 15-point icons at stroke 1.7, corners 7, in the frame's second tone, like the lip's toggle;
   - hover plate, focus ring, tooltips with their keys;
   - the actions: layout, open as window (only while the pop-out feature is on), and conversation details.

   How they reach the lip (a portal into the slot, or lifting their state) is your choice; report which.
2. **In a conversation you haven't joined,** the Join button takes the actions' place there, as it does in the header
   today.
3. **Just before the actions:** a person's presence avatar in a direct conversation, and an ephemeral conversation's
   badge.
4. **The project room picker** shows only in the "In a column" mode (WP-02 brings that setting; until it lands, keep
   the picker where it is today and report it). In the rail mode the rail holds the rooms.
5. **The header's update indicator** is not drawn under the flag; WP-08 brings the dot on Settings.
6. **The header is gone from the card.** Under the flag:
   - the timeline's top padding is fixed at the study's reading area (`shellStudy.css` `.shell-reading`, 22 at the
     top);
   - the top veil becomes a short fade under the card's top edge, the height of that padding.
7. **The slot follows the card.** The lip's part over the card already moves with it; check the slot's buttons ride
   along when the rail opens and closes, and stay clickable (that part ignores the pointer except on its buttons).
8. **Tab order:** the lip's left cluster, then its right-hand actions, then the places (SHELL_SPEC "Keyboard").

**Verification** (Playwright headless, 1440 × 900 and 800 × 500, flag on unless stated). Screenshots:
- `channel` (#general, the actions in the lip);
- `dm` (a direct conversation with the presence avatar);
- `not-joined` (an open channel you aren't a member of: Join in the lip);
- `ephemeral` (the badge);
- `details-open` (the right card, opened from the lip);
- `rail-closed` (the slot followed the card);
- `scrolled` (messages fading under the card's top edge);
- the flag-off shots compared by hash to the base.

Make a capability map: every header control, and its new home.

**Checks JSON keys:** `actions_in_lip`, `join_in_lip`, `presence_and_badge`, `room_picker_modes`,
`update_indicator_hidden`, `top_padding`, `veil_fade`, `slot_follows_card`, `tab_order`, `flag_off_identical`,
`capability_map_lost` (0), `gates`.

## WP-05 · Settings in the frame (2026-10-24, Riley and Claude's design; Riley: "Take your recommended pick for all 12 decisions")

**Why.** Today Settings takes over the whole window, swapping the rail and the top strip for its own sidebar. In the
shell it keeps the frame. Read `SHELL_SPEC.md`, "Settings" under "What each surface of the app becomes".

**Base.** The integration branch with WP-01 landed. With the flag on, Settings is still today's full-window layout
(byte-identical to the flag off). WP-04 (the header) and WP-01b (polish) are built at the same time. Your worktree and
branch: in your dispatch.

**Your styles** go in `desktop/src/app/shell/shell-settings.css` (new), imported by `globals.css` right after
`shell-frame.css`.

**Files in scope:**
- `desktop/src/app/AppShell.tsx` (only the Settings branch);
- `desktop/src/features/settings/ui/SettingsView.tsx`, `SettingsScreen.tsx`, `SettingsLoadingFallback.tsx`;
- `desktop/src/app/shell/ShellPlaces.tsx` (only to mark Settings as the current place);
- `shell-settings.css`, `globals.css` (its one import line);
- tests.

**Untouched:**
- the panels' contents, `SettingsPanels.tsx` (WP-07a and WP-02 each add one row there);
- the mobile layout under 768, beyond keeping it working;
- light mode beyond not breaking (WP-06).

**Decisions** (only under the `shell-frame` flag; with it off, Settings is today's, exactly):
1. **On `/settings` the frame stays:** the lip (with back and forward) and the places column, with Settings as the
   current place.
2. **The section list** (today's settings sidebar, its four groups and twelve sections) takes the rail card's place:
   - the same card, 220 wide at x 44, top flush with the lip, 6 above the bottom;
   - rows in the rail's row style as the study draws them (`shellStudy.css`, "the conversations rail"); WP-02 is
     restyling the rail's own rows at the same time.
3. **The panels fill the conversation's card.**
4. **"Back to app" goes.** Back, or the Conversations place, leaves Settings. Escape still closes it.
5. **The section list opens and closes like the rail.** The effect that forces the rail open in Settings goes. In
   Settings the lip's toggle and ⌘S close and open the section list's card, with the rail's motion.
6. **The narrow and loading states are the frame.** The narrow-width header (today's "Back to app" and menu) and the
   loading skeleton (`SettingsLoadingFallback`) are redrawn as the frame: lip, places and the two cards.
7. ⌘, still toggles Settings; section switches still replace the history entry.

**Verification** (Playwright headless, 1440 × 900 and 800 × 500, flag on unless stated). Screenshots:
- `appearance` (Settings → Appearance);
- `agents` (the wide Agents section);
- `list-closed` (the section list closed with the toggle);
- `loading` (the skeleton);
- `escape` (Escape back to the conversation);
- `narrow` (under 768);
- the flag-off shots compared by hash to the base.

Make a capability map: every control of the old settings sidebar, and its new home.

**Checks JSON keys:** `frame_kept`, `section_list_card`, `panels_in_card`, `back_and_escape`, `toggle_closes_list`,
`shortcut_toggles`, `history_replace`, `loading_skeleton`, `narrow_layout`, `flag_off_identical`,
`capability_map_lost` (0), `gates`.

## WP-02b · The rail, finished (2026-10-24, Claude's design, from WP-02's review and its merge)

**Why.** WP-02 landed (merge `aa4b0d29c`). Its reviewers measured several small differences that the fix round left
for later, and the merge showed one real problem: the rail names a group of chats after one of them. Read WP-02's
section above and `SPEC.md`.

**Base.** The integration branch with WP-01 and WP-02 landed. WP-03 (the marks) is built at the same time; WP-04,
WP-05, WP-01b and WP-07a are still running from earlier bases. Your styles stay in `shell-rail.css`. Your worktree and
branch: in your dispatch.

**Files in scope:**
- `desktop/src/features/sidebar/ui/ShellRail.tsx`, `desktop/src/app/shell/shell-rail.css`;
- `desktop/src/features/sidebar/lib/railHomes.ts` and its test;
- `desktop/src/features/settings/ui/SettingsPanels.tsx` (only the Project rooms row);
- `desktop/src/features/runtime-sessions/RuntimeRailPinsSettings.tsx` (only its words under the flag);
- `desktop/src/features/agents/ui/AgentsView.tsx` (only the Runtimes rows' geometry);
- the onboarding anchor's publisher (`usePublishFieldAnchor`, wherever Luca's row now is);
- `docs/luca/rail-system/SPEC.md` (only the lines named below);
- `desktop/tests/e2e/luca/shell-rail.spec.ts` and unit tests.

**Untouched:**
- the marks and today's pill (WP-03);
- the frame (`shell-frame.css`, `ShellLip.tsx`, `ShellPlaces.tsx`);
- the conversation header (WP-04).

**Decisions** (only under the `shell-frame` flag; with it off, nothing changes):
1. **A group is named by its members, never by one of its chats.** Today the rail gathers every chat with the same
   members into one Fleets home named after the first chat, so #general holds #random and #engineering. Instead:
   - a group with one chat: the home is that chat, by its own name (no chevron);
   - a group with several chats: the home is named by its members ("Luca + Wren", Luca first, then by name), and each
     chat is a session under it by its own name; opening the home opens the most recent;
   - when fleets get their own record and name (later, not here), the record's name wins.

   The unit test still proves no chat appears twice, and adds these cases.
2. **"In a column" mode** draws project homes as today's rail does: no chevron and no nested rooms, so rooms never
   appear twice.
3. **Keyboard and screen readers:** a home with sessions carries `aria-expanded` and `aria-controls` on its focusable
   button. The chevron stays a mouse-only target (`aria-hidden`, out of the tab order); Right and Left already open
   and close.
4. **The first row sits 6 below the rail card's top,** as in the study. After the merge it sits at 12, because WP-01's
   scroll-anchor padding and the list's own 6 add up. Keep one of the two.
5. **The trailing slot's order is the study's:** status or "working…" first, then the unread dot; the `+` still wins
   on hover and focus.
6. **Only work in progress gets an ellipsis.** "working…" and "Waking…" keep theirs. "Needs attention" and other
   statuses get none: their own class, the same tone and size, no `::after`.
7. **Sessions use the `text-lip` token** (WP-01's 0.8125rem), not a literal.
8. **The Project rooms row** becomes the last row of the Conversation group in Settings → Appearance (a divided row
   like its neighbours, no gap or untitled card of its own).
9. **Runtimes on the Agents page** take the roster's geometry: the icon on the agents' marks' axis, the name on the
   roster's text edge.
10. **Runtime pins in Settings:** under the flag, the "Sidebar runtimes" group reads "Runtimes", with the line "Choose
    which installed harnesses appear on the Agents page."
11. **Onboarding's travelling anchor** (`usePublishFieldAnchor`, today on Luca's rail mark, which has no glyph now)
    is published on Luca's row name.
12. **`SPEC.md`:**
    - "A row": homes muted, sessions faint, the thread the ink at 16%, the open session's text and segment at full
      ink;
    - the corner line: rows have 8-point corners, never a pill (as `SHELL_SPEC.md`);
    - a project's details and sources live on its row's menu (right-click, the menu key, Shift+F10), and its rooms
      are found by Search.

**Verification** (Playwright headless, 1440 × 900, flag on unless stated), with the default mock and your seeded data:
- `groups` (the default mock: every named chat findable by its own name, with no group named after a chat);
- `column-mode` (no nested rooms);
- `first-row` (Luca's row measured 6 below the card's top);
- `slot-order` (unread and working on one home);
- `needs-attention`;
- `settings-row`;
- `agents-runtimes` (the axes measured);
- `cmd-k-room` (Search finds a project's room and opens it);
- the flag-off shots compared by hash to the base.

**Checks JSON keys:** `group_naming`, `no_chat_twice`, `column_mode`, `aria_expanded`, `first_row_offset`,
`slot_order`, `status_ellipsis`, `session_token`, `settings_row`, `runtimes_geometry`, `runtime_pins_words`,
`onboarding_anchor`, `spec_md`, `cmd_k_room`, `flag_off_identical`, `gates`.

## WP-03 · Where you are: the solid marks (2026-10-24, Riley and Claude's design; Riley: "Start the team on the narrowed scope")

**Why.** In the shell, where you are is shown by a solid mark that slides between places. It replaces today's glass
pill on the rail and WP-01's still plate on the places. Read `SHELL_SPEC.md`, "Where you are" and "The rail's selection
glass". The engine is the study's: `desktop/src/testing/shellStudy/marks.ts`, its materials in `shellStudy.css`
(`.shell-marks`, `.shell-mark*`), and how `ShellStudy.tsx` places them (`marks.places.show`, `marks.rail.show`). Watch
them move in the study on your own server (`/scripts/shell-lab.template.html?experience=shell&mode=dark&frame=solid`).

**Base.** The integration branch with WP-01 and WP-02 landed. WP-02b (the rail, finished) is built at the same time.
Your styles go in `desktop/src/app/shell/shell-marks.css` (new), imported by `globals.css` right after
`shell-frame.css`. Your worktree and branch: in your dispatch.

**Files in scope:**
- `desktop/src/app/shell/marks.ts` (new: the study's engine, ported, with unit tests of its springs and settling);
- `desktop/src/app/shell/ShellMarks.tsx` (new), `shell-marks.css` (new), `globals.css` (its one import line);
- `desktop/src/app/shell/ShellPlaces.tsx` (only to give the places' mark its layer and stop drawing the still plate);
- `desktop/src/shared/styles/globals/shell-frame.css` (only to remove the still plate's rule, "Where you are, until the
  moving marks come");
- where today's rail pill and native pour are mounted (`RailGlass.tsx`, `NativeRailGlass.tsx`, and the component that
  renders them): under the flag, neither is drawn or attached;
- tests.

**Untouched:**
- the rail's rows (WP-02b); they already carry what you need: the home row of what is open has `data-active="true"`
  (`[data-sidebar="menu-button"][data-home]`), the open session `data-current` and `aria-current="page"`;
- the lip's tabs (later);
- the glass frame's marks (WP-07b);
- light beyond not breaking (WP-06).

**Decisions** (only under the `shell-frame` flag; with it off, today's pill and pour are untouched):
1. **Two marks on the Black frame, both plates:** the page's ink at 7.5%, an 8% lit inset at the top, rising a little
   while moving (the study's `--wet`).
   - The places' mark: 9-point corners, on the current place's tile.
   - The rail's mark: 8-point corners, on the home row carrying `data-active`. It lives in the rail card's own
     coordinates, scrolls with the rows and is clipped by the card.
2. **The open session is lit, not marked** (WP-02 already lights it).
3. **The study's motion, unchanged:** springs stepped 240 times a second, the edge facing the move leading, the far
   edge following, settling on whole pixels.
   - A place with no mark, or the rail closing: the mark closes to a point at its middle, and swells back from one.
   - A resize, or a section opening above the mark: it follows at once.
   - Reduce Motion: every mark is simply where it belongs.
4. **The material is a data choice:** `plate` now; `card` on a glass frame, which WP-07b turns on. Write it so that
   switch is one attribute.
5. **Today's rail pill and native pour retire under the flag:** never drawn, never attached, and the native side gets
   no calls. Their code goes in WP-09.
6. **Accessibility:** the marks are decorative (`aria-hidden`). Current place and page are already said by
   `aria-current`.

**Verification** (Playwright headless, 1440 × 900 and 800 × 500, deviceScaleFactor 2, flag on unless stated):
- `places-mark` and `rail-mark` (measured against the study: box, corners, colour);
- a motion trace, sampled every frame, moving between two places and between two homes far apart (the stretch, and
  the settle on whole pixels);
- `rail-closing` (the mark closes to a point; reopening, it swells back);
- `reduce-motion` (instant);
- `scrolled` (the rail's mark scrolls with its row and is clipped by the card);
- `session-open` (the home row marked, the session lit, no second mark);
- no pill and no native pour calls under the flag (the mock bridge's command log);
- the flag-off shots compared by hash to the base.

**Checks JSON keys:** `places_mark`, `rail_mark`, `motion_trace`, `whole_pixels`, `rail_closing`, `reduce_motion`,
`scroll_clip`, `session_lit_not_marked`, `pill_retired`, `native_pour_calls` (0), `flag_off_identical`, `gates`.

## WP-06 · Light: Paper, shadows on the floor, no outlines (2026-10-25, Riley and Claude's design; Riley: "paper and glass both look amazing! keep them both")

**Why.** Step 4 of `SHELL_SPEC.md`. In light the frame is Paper (the Black frame's daytime name) or Glass. Daylight shows
things by shade and shadow, so there are no white edges anywhere. Read the spec's "Light and dark", "Black (Paper in
light)" and "Glass: Liquid Glass", and the study's light rules: the light section at the end of `shellStudy.css`
(`.shell[data-mode="light"]`), every value there. Pictures of the approved light study:
`scratchpad/light/lights/` (`l-paper.png` above all).

**Base.** The integration branch with WP-01, WP-02, WP-02b, WP-04, WP-05 and WP-07a landed. WP-04b, WP-05b and WP-08d
are built at the same time; WP-01b and WP-03 (the marks) are still running from earlier bases. Your styles go in
`desktop/src/app/shell/shell-light.css` (new), imported by `globals.css` after the other shell stylesheets. Your worktree
and branch: in your dispatch.

**Files in scope:**
- `shell-light.css` (new) and its one import line in `globals.css`;
- small, self-contained edits elsewhere only where a light rule can't be written from your own stylesheet (say which,
  and why);
- `desktop/src/app/shell/shellGlass.ts` (only to let its shadow layer, `[data-luca-frame-shadows]`, also show under the
  Paper frame by day);
- tests.

**Untouched:**
- the marks (WP-03 brings them, dark first; their light material comes after);
- the native glass and its look (WP-07b);
- dark mode, exactly.

**Decisions** (only under the `shell-frame` flag, only in light; with the flag off, or in dark, nothing changes):
1. **The Paper frame's floor is the palette's recess** (`hsl(var(--mn-recess))`, Paper's `#eceae6`). The cards are the
   surface (Paper's `#fcfbf9`).
2. **No outlines by day:** no card edge, no white lit top, no ring, on any card (the conversation's, the rail's, the
   Settings list, the place cards, the right cards).
3. **Every card casts the ink's shadow on the floor beneath it,** from one layer under all the cards, so no card shades
   its neighbour. The layer is WP-07a's (`[data-luca-frame-shadows]`), shown under Paper too, with Paper's values from
   the study: `0 1px 2px ink 6%` and `0 12px 32px -8px ink 14%`. Glass keeps its own (`8%`, `0 16px 40px -10px 22%`).
   The rail's shadow fades as its card closes.
4. **The frame's words in light** are the page's ink at 100, 84 and 66% (`--luca-frame-ink`, `-muted`, `-faint`):
   the lip's name and buttons, the places, the section labels.
5. **A chosen option stands up, never dips:** white paper on its track with the study's two ink shadows (`0 0.5px 1px
   ink 22%`, `0 1px 3px ink 10%`), as Send does. This applies to every segment the shell draws (the Frame row and the
   study-style segments) and to the places' and rows' current plate, which by day is the plate the study draws in light.
6. **The composer well, Send and search** in light, as the study draws them.
7. **Other palettes:** the frame reads each palette's own tokens (floor, recess, surface, ink), so every light palette
   in Appearance works under Paper. Check two besides Paper.

**Verification** (Playwright headless, 1440 × 900 and 800 × 500, deviceScaleFactor 2, flag on, Paper palette, unless
stated), each measured against the light study (`/scripts/shell-lab.template.html?experience=shell&mode=light&frame=solid`
on your own server):
- `conversation` (floor, cards, no outline, the shadow under each card measured in pixels);
- `rail-closed`;
- `library` (a place card);
- `settings-appearance` (the segments standing up);
- `right-card`;
- two other light palettes;
- dark unchanged (shots hashed against the base build with the flag on in dark);
- the flag-off shots compared by hash to the base.

**Checks JSON keys:** `floor_recess`, `no_outlines`, `card_shadows`, `rail_shadow_fade`, `frame_words`,
`chosen_stands_up`, `composer_send_search`, `other_palettes`, `dark_unchanged`, `flag_off_identical`, `gates`.

## WP-04b · The header, finished (2026-10-25, Claude's design, from the reviews of WP-04, WP-05 and WP-02b)

**Why.** WP-04 landed. Its reviewers left small items, and two other reviews found items that belong to the lip.

**Base.** The integration branch with WP-04 landed. Your styles stay in `shell-header.css`.

**Files in scope:**
- `desktop/src/app/shell/ShellLip.tsx`, `shell-header.css`, `lipActionsSlot.ts`;
- `desktop/src/features/chat/ui/ChatHeader.tsx` and the forum's header (only to move the forum's actions);
- `desktop/src/app/AppShell.tsx` (only to pass the toggle's words in Settings);
- `desktop/src/features/channels/useActiveChannelHeader.ts` or wherever the lip's name is made (only the name of an
  unnamed group chat);
- `docs/luca/rail-system/SHELL_SPEC.md` (only Decided 3 and the header bullet's icon size);
- tests.

**Decisions** (only under the `shell-frame` flag; with it off, nothing changes):
1. **The lip's action icons stay 15 points,** the lip's one button size, like the toggle, back and forward. Amend
   `SHELL_SPEC.md` Decided 3 and the header bullet from "13-point" to "the lip's own size, 15".
2. **The lip's buttons fade over 120 ms** (`color`, `background-color`), as the study's do, all of them: the toggle,
   back, forward and the actions.
3. **Details shows when it's open:** `aria-expanded`, the plate and ink while the details card is open, and the label
   "Close conversation details".
4. **Join's focus ring** is the lip's ring (1 px, ink 55%), outside its fill.
5. **The presence avatar's fallback** wears the frame's avatar material: a disc at ink 14%, initials `text-xs` at
   weight 550.
6. **Forums lose their band too:** the forum's actions move into the lip like every other conversation, and the post
   list gets the same fixed top padding and fade.
7. **An empty focused pane** (a layout with a pane that holds no conversation): the lip names nothing and holds no
   actions, and no other pane's quiet name is doubled.
8. **In Settings the toggle says what it toggles:** "Close the section list (⌘S)" / "Open the section list (⌘S)".
9. **An unnamed group chat is named by its members** ("Luca + Wren", Luca first), never the comma form: in the lip,
   its tooltip and the window title, the same name the rail uses (`railHomes.ts`).

**Verification** (Playwright headless, 1440 × 900 and 800 × 500, flag on): one screenshot per decision, the timing and
states measured; the flag-off shots compared by hash to the base.

**Checks JSON keys:** `icon_size_spec`, `button_fade`, `details_state`, `join_focus`, `presence_fallback`, `forum`,
`empty_pane`, `settings_toggle_words`, `group_name`, `flag_off_identical`, `gates`.

## WP-05b · Settings and the Frame row, finished (2026-10-25, Claude's design, from the reviews of WP-05 and WP-07a)

**Why.** WP-05 and WP-07a landed. Their reviewers left small items in Settings and its Frame row.

**Base.** The integration branch with WP-05 and WP-07a landed. Your styles stay in `shell-settings.css` (and
`shell-glass.css` for the Frame row).

**Files in scope:**
- `desktop/src/features/settings/ui/SettingsView.tsx`, `SettingsLoadingFallback.tsx`, `shell-settings.css`;
- `desktop/src/app/shell/ShellSettingsPlaces.tsx`, `ShellPlaces.tsx` (only focus on the place switch);
- `desktop/src/features/settings/ui/SettingsPanels.tsx` (only the Frame row);
- `desktop/src/app/shell/shellGlass.ts`, `shell-glass.css` (only the decisions below);
- `desktop/tests/e2e/luca/shell-settings.spec.ts`, `desktop/tests/e2e/shell-glass.spec.ts`.

**Decisions** (only under the `shell-frame` flag):
1. **Focus stays on the place you pressed** when Settings opens or closes through the places column (or moves to the
   matching place after the swap).
2. **The version line** is `text-2xs` in the faint tone.
3. **The loading skeleton's panel** sits in the loaded panel's column (`mx-auto w-full max-w-4xl`), so nothing jumps
   when the section arrives.
4. **The current row keeps its lit top under keyboard focus.**
5. **The Settings spec's screenshots** are taken in the Vitesse Black palette: its blur click lands on empty frame, not
   on a theme tile.
6. **The Frame row says what is drawn:**
   - under Reduce Transparency, Liquid Glass stays chosen and the sentence reads "Liquid Glass, drawn solid while
     Reduce Transparency is on.";
   - Glass is offered only where it can be drawn (Tauri on macOS) until Windows glass exists;
   - in a browser the row is a statement (the label and its sentence), not a one-option control;
   - the sentence is the fieldset's `aria-describedby`.
7. **In full screen the frosted glass has square corners:** `cornerRadius` 0, and entering or leaving full screen
   re-applies it.

**Verification** (Playwright headless, flag on; the frosted and Reduce Transparency cases with the faked Tauri the
WP-07a spec uses): one screenshot or measurement per decision; the flag-off shots compared by hash to the base.

**Checks JSON keys:** `focus_kept`, `version_size`, `skeleton_column`, `focus_lit_top`, `spec_palette`,
`reduce_transparency_words`, `glass_offered_where_drawn`, `browser_statement`, `described_by`,
`fullscreen_square_frost`, `flag_off_identical`, `gates`.

## WP-08d · The glass themes retire (2026-10-25, Riley and Claude's design; Riley: "Take your recommended pick for all 12 decisions", Decided 7)

**Why.** Obsidian and Crystalline were the only see-through windows, through the older frosted material behind the
page. The Glass frame is the see-through window now. Read `SHELL_SPEC.md`, "The glass themes" and Decided 7.

**Base.** The integration branch with WP-07a (the Frame setting) landed.

**Files in scope:**
- `desktop/src/shared/theme/ThemeProvider.tsx`, `theme-loader.ts`, `adaptive-theme.ts`, `useThemePreviewVars.ts`
  (only the two themes);
- the Appearance theme tiles in `SettingsPanels.tsx` (only hiding the two tiles);
- `desktop/src/shared/styles/globals/glass-floor.css` (only to stand its rules down under the flag);
- tests.

**Untouched:** `window_vibrancy.rs` (the pop-out and the onboarding card still use it); the pop-out.

**Decisions** (only under the `shell-frame` flag; with it off, both themes work exactly as today):
1. **Their tiles leave Appearance.**
2. **Someone on one moves once:** Obsidian → the dark default (Vitesse Black) with the Glass frame; Crystalline →
   Paper with the Glass frame. Stored, so it happens once; turning the flag off again returns them to what they had.
3. **`glass-floor.css` stands down** under the flag: the frame's glass (WP-07a) draws the see-through window.
4. **Nothing else changes:** other palettes, the accent and the mode stay as chosen.

**Verification** (Playwright headless, flag on, with the faked Tauri): a profile on Obsidian and one on Crystalline,
before and after (palette, mode, frame, stored values); Appearance without the two tiles; flag off, both themes
selectable and drawn as today (by hash against the base).

**Checks JSON keys:** `tiles_hidden`, `obsidian_moves`, `crystalline_moves`, `moves_once`, `flag_off_restores`,
`glass_floor_stands_down`, `flag_off_identical`, `gates`.

## WP-08a · The avatar: communities, its dot, its states (2026-10-25, Riley and Claude's design; Riley: "Take your recommended pick for all 12 decisions", Decided 1 and 4)

**Why.** The avatar at the foot of the places column is the person's own place: their presence, their status, their
communities, feedback. Read `SHELL_SPEC.md`: "The community strip", "The places column", "The footer's status cards",
Decided 1 and 4. WP-01b left the avatar's small remaining items here.

**Base.** The integration branch with WP-01b and WP-03 landed. WP-08b (the status cards and dots) is built at the same
time: it owns the dot's *source*; you own the avatar's drawing of it. Your styles go in
`desktop/src/app/shell/shell-avatar.css` (new), imported after the other shell stylesheets.

**Files in scope:**
- `desktop/src/features/sidebar/ui/CommunityRail.tsx` and where it is mounted (`AppShell.tsx`, only that mount);
- `desktop/src/features/sidebar/ui/SidebarProfileCard.tsx`, `desktop/src/features/profile/ui/ProfilePopover.tsx`;
- `desktop/src/app/shell/ShellPlaces.tsx` (only the avatar);
- `shell-avatar.css` and its import line;
- tests.

**Decisions** (only under the `shell-frame` flag; with it off, the strip and the profile card are today's):
1. **The community strip goes.** With more than one community, the avatar's menu lists them (the menu's existing
   switcher slot), with the current one marked, and switching works as the strip's did (the key-based remount, the
   reset singletons). The places column keeps the window's left edge in every case.
2. **The avatar carries no presence dot** under the frame: presence is in its menu. Its one dot is the connection
   problem (decision 3).
3. **A connection problem shows as a dot on the avatar** while the rail is closed (the same state the rail's
   connection card shows when open), drawn in the app's warning tone, 6 points, cut into the disc's lower right. Read
   the state from where WP-08b puts it; until it lands, read the connection card's own state.
4. **The avatar responds like a place:** a hover and an open state (the disc at ink 20%, on the places' 120 ms colour
   transition), and the places' tooltip with the person's name.
5. **The DEV chip's letters sit on its centre** (in the menu only): cancel the trailing letter spacing, paddings 2 top
   and 3 bottom.

**Verification** (Playwright headless, 1440 × 900 and 800 × 500, flag on unless stated; the mock seeded with two
communities for decision 1):
- `communities-in-menu` and a switch that lands in the other community;
- `no-strip` (the places at x 0 with two communities);
- `avatar-rest`, `avatar-hover`, `avatar-open`, `avatar-tooltip`;
- `connection-dot` (rail closed, relay down);
- `dev-chip` (measured centring);
- the flag-off shots (one community and two) compared by hash to the base.

**Checks JSON keys:** `communities_in_menu`, `switch_works`, `strip_gone`, `no_presence_dot`, `connection_dot`,
`avatar_states`, `avatar_tooltip`, `dev_chip_centred`, `flag_off_identical`, `gates`.

## WP-08b · The status cards and their dots; the reconnecting card retires (2026-10-25, Riley and Claude's design; Decided 4)

**Why.** The rail's footer cards (connection, relay, background task, update available) stay at the foot of the rail's
card. While the rail is closed, a connection problem is a dot on the avatar (WP-08a draws it) and an available update
a dot on Settings. The reconnecting card (`RelayConnectionOverlay`), which shows only while the rail is closed, would
sit over the places, so it retires. Read `SHELL_SPEC.md`: "The footer's status cards", "The reconnecting card",
Decided 4.

**Base.** The integration branch with WP-01b and WP-03 landed. WP-08a is built at the same time.

**Files in scope:**
- the rail's footer status cards (in `AppSidebar.tsx` and their own components: only their placement in the card and
  their state's export);
- `desktop/src/app/RelayConnectionOverlay.tsx` and its mount;
- `desktop/src/app/shell/ShellPlaces.tsx` (only the Settings tile's dot);
- a small shared state for "connection problem" and "update available" in `desktop/src/app/shell/` (new), which
  WP-08a's avatar dot reads;
- tests.

**Decisions** (only under the `shell-frame` flag):
1. **The four status cards** sit at the foot of the rail's card, inside it, in the card's material, as today's order.
   With the rail closed they're hidden with the card.
2. **An available update is a dot on Settings** while the rail is closed (the app's accent, 6 points, at the tile's
   top right, 4 in), and the tile's name becomes "Settings, update available". It goes when the rail opens (the card
   says it there).
3. **The reconnecting card never shows under the frame;** the avatar's dot (WP-08a) and the rail's connection card say
   it.
4. **One source for both dots:** export the connection problem and the update state once, so the avatar, Settings
   and the cards never disagree.

**Verification** (Playwright headless, flag on unless stated): `cards-in-rail` (each card, open rail); `update-dot`
(rail closed, an update staged); `reconnecting` (relay down, rail closed: no overlay, the state exported); the flag-off
shots, the overlay still shown with the flag off, compared by hash to the base.

**Checks JSON keys:** `cards_in_rail`, `update_dot`, `overlay_retired`, `one_source`, `flag_off_identical`, `gates`.

## WP-08c · The runtime sessions card (2026-10-25, Riley and Claude's design; Decided 12)

**Why.** The runtime sessions column (`RuntimeSessionsPanel`, 22 rem, opened beside the rail from New conversation)
becomes a card of its own between the rail's and the conversation's while it is open. Read `SHELL_SPEC.md`, "The rail"
(its runtime sessions bullet) and Decided 12.

**Base.** The integration branch with WP-01b and WP-03 landed. Your styles go in
`desktop/src/app/shell/shell-runtime.css` (new).

**Files in scope:** `desktop/src/features/runtime-sessions/` (only the panel's placement), the frame's layout in
`AppShell.tsx` (only the column's slot), `ShellLip.tsx`'s `besideRail` (it already reads the column), the new
stylesheet, tests.

**Decisions** (only under the `shell-frame` flag):
1. **While open it is a card:** 22 rem wide, the cards' material, edge and corners (10), top flush with the lip, 6
   above the bottom, 4 from the rail's card and 4 from the conversation's, which moves over to make room.
2. **It opens and closes on the rail's motion** (460 ms, the rail's curve), instantly under Reduce Motion; the lip's
   back, forward and name follow the conversation card.
3. **With the rail closed** it sits 4 from the places column.
4. **Narrow (under 768):** a sheet, as today.

**Verification** (Playwright headless, 1440 × 900 and 800 × 500, flag on): `column-open` (all four gaps measured),
`rail-closed`, a motion trace, `narrow`, the flag-off shots compared by hash to the base.

**Checks JSON keys:** `card_geometry`, `gaps`, `motion`, `rail_closed`, `narrow`, `lip_follows`, `flag_off_identical`,
`gates`.

## WP-08e · The huddle bar in the frame (2026-10-25, Riley and Claude's design; Decided 8)

**Why.** Today the whole app surface shortens from the bottom to reveal a full-width huddle bar beneath it. In the
shell the bar rises into the frame beneath the cards: the cards shorten, and the bar sits in the frame's band below
them, on the floor in Black (on the glass in Glass). Read `SHELL_SPEC.md`, "The huddle bar", Decided 8.

**Base.** The integration branch with WP-01b and WP-03 landed. Your styles go in `desktop/src/app/shell/shell-huddle.css`
(new).

**Files in scope:** `desktop/src/features/huddle/components/HuddleBar.tsx` and its mount, the frame's layout where the
cards' bottom inset is set (only the huddle's band), the new stylesheet, tests.

**Decisions** (only under the `shell-frame` flag):
1. **While a huddle is live,** every card (rail's, conversation's, right cards, runtime sessions) ends above the bar's
   band, and the bar sits in the frame below them, left of the places column's foot to the window's right edge less 6,
   with 6 below it. It wears no card of its own: its controls sit on the floor (the frame's words and buttons, as the
   lip's).
2. **It rises and falls on the rail's motion,** the cards shortening with it; instantly under Reduce Motion.
3. **The places column's foot** (Settings, avatar) stays where it is; the band runs beside it.
4. Everything the bar does today (join, leave, mute, participants, the timer) works the same.

**Verification** (Playwright headless, 1440 × 900 and 800 × 500, flag on): a huddle staged in the mock: `huddle-live`
(the band and the cards' new bottom measured), `huddle-rail-closed`, a motion trace, every control used once; the
flag-off shots (with and without a huddle) compared by hash to the base.

**Checks JSON keys:** `band_geometry`, `cards_shorten`, `controls_on_floor`, `motion`, `controls_work`,
`flag_off_identical`, `gates`.

## WP-08g · The window's corners and the frame's edges (2026-10-25, Riley and Claude's design)

**Why.** The last surfaces `SHELL_SPEC.md` lists that meet the frame: the companion control's halo, the Canvas in focus,
the content's drift between places, the loading gates and the window with no native lights. Read the spec's "Search,
dialogs, toasts, the quick chat panel", "The right cards" (the Canvas), "The places column" (`RAIL_ORDER`), "The
window" (boot backing, full screen, without native lights, loading gates). WP-03's reviewers left three small items in
the marks, which are here too.

**Base.** The integration branch with WP-01b and WP-03 landed. Your styles go in `desktop/src/app/shell/shell-edges.css`
(new).

**Files in scope:** `companionAppControl.css` and its component (only the halo and the badge under the frame); the
Canvas's focus layout (only its top under the frame); `app/navigationChoreography.ts` (`RAIL_ORDER`); the loading
gates (`AppLoadingGate`, `CommunitySwitchGate`, the boot splash) and `index.html`'s boot paint (only under the frame);
`ShellLip.tsx` (only the no-lights and full-screen positions of the toggle); `marks.ts`, `ShellMarks.tsx`,
`shell-marks.css` (only the three mark items); the new stylesheet; tests.

**Decisions** (only under the `shell-frame` flag):
1. **The companion's halo** takes the window's corner less 3 (13), so it stays concentric; its badge moves below the
   lip (its top 6 below the lip's 36).
2. **The Canvas in focus** is top flush with the lip, 6 from the right, bottom and left.
3. **The content's drift between places** follows the places' order (`RAIL_ORDER`), so moving down the column moves
   the page the same way.
4. **The loading gates** paint the frame's floor (the palette's, or Paper's recess in light), and stay clear when the
   Glass frame is on; they keep their own 44-point drag band.
5. **Without native lights** (another platform, a browser, the end-to-end tests) the toggle sits at the lip's left
   padding (16) and the tooltips name Ctrl instead of ⌘. In full screen (the lights gone) the toggle moves to where the
   first light was (16), and back, forward and the name keep their places on the card.
6. **The marks:**
   - the first mark after the page appears swells from a point, like every later one (a group counts as having
     appeared once its layer has shown its first page, with or without a mark);
   - under Increase Contrast a plate mark carries a 1-point inset outline at ink 50%;
   - in the narrow-window sheet, a row's focus background shows only for keyboard focus (`:focus-visible`), so it
     never reads as a second mark.

**Verification** (Playwright headless, flag on unless stated): one screenshot or measurement per decision (the halo's
radius and the badge's top measured; the Canvas's box; a drift direction trace between two places; a gate's floor in
dark, light and glass; the toggle's x with and without lights and in full screen, faked; the first mark's first frame;
Increase Contrast; the sheet's focus); the flag-off shots compared by hash to the base.

**Checks JSON keys:** `halo`, `badge`, `canvas_focus`, `drift_order`, `gates_floor`, `no_lights_toggle`,
`fullscreen_toggle`, `ctrl_tooltips`, `first_mark_swells`, `contrast_outline`, `sheet_focus`, `flag_off_identical`,
`gates`.
