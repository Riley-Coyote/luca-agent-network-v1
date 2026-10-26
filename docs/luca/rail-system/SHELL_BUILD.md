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
- **Heavy jobs take turns, Mac-wide** (Riley, 2026-10-26: "do everything we can to make all of this testing run as
  quickly as we can"): run every build, Playwright run and cargo command through the shared queue,
  `bash ~/.claude/plans/polyphonic-shell-build/tools/heavy.sh <command> [args...]`, with `--workers=2` for Playwright.
  One job may always run; more start while the Mac has room (load under its core count, one newcomer every 45 s, six
  at most), so the queue gives way when something outside it is busy. Ghost's sessions share it. It runs a wrapped
  job's own wrapped steps at once, clears a dead job's lock, and hands on a slot held past an hour. Never build while your own test run is going. Put every script on the command line: a job that
  reads its program from stdin waits forever inside the queue and blocks everyone (it happened, 2026-10-26).
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
- A flag-off comparison must compare something: never mask a canvas that fills the window (Playwright paints a mask
  solid magenta, so every shot matches). Mask only small animated canvases (under 200 × 200), and check each shot
  isn't one colour before trusting its hash (2026-10-26, from WP-13's review).
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
| WP-10 every place's own rail | 2026-10-26, merge `690ef1ffb` | Six places (Search; Chats, Agents, Activity, Library; Settings), each with its own rail and the card showing the pick, picks in the address. A connected app's sessions live in its card; groups have a card. Review: the unread dot stays on Chats everywhere, honest state words, one page for every card, flat rows. The mark's first step on a first visit is partial (WP-09's list). |
| WP-11 the Chats rail | 2026-10-26, merge `9c09efbc5` | Luca, Projects, Agents, People, Rooms; one home per chat by what it is; Fleets retire; latest three with times, N more and Show fewer; Browse rooms… and Archived; the rail scrolls to what opens; landing on Luca when Luca has news. Review: new chats sort first, even section rhythm, room words, Room settings… At the merge its spec still boots on /pulse, which is Activity's now: WP-15. |
| WP-12 one card | 2026-10-26, merge `771409c78` | The rail and what it opens lie on one card in every place, drawn once and never moved; the hairline; the fold with a still corner; panes share the card; grain from one origin. Review: the corners, the peek, the closing gap. |
| WP-09a the finishing list | 2026-10-26, merge `e4d7a4ac2` | The reviews' small items, a project room without its own header, and the window's first size (1440 × 900 or the screen less a margin, kept across runs; its unit tests run at the final Rust build). |
| WP-13 a mind's own space | 2026-10-26, merge `393d8c39a` | Every mind's card is their space: a head with Talk; Notebook (their own words, asks in one line, their days by kind), Self (their documents' own first lines), Settings (one quiet row per section, What they can read inside); /brain lands there; an agent's profile card is a summary. Review: the flag-off proof compared blank shots (now non-blank and distinct), the forms became lines and rows. |
| WP-14 what agents say to each other, and what needs you | 2026-10-26, merge `c4dc71a22` | Needs you (permission requests, questions, proposals, paused exchanges) as calm rows answered in place, the count on the Activity icon; one Side conversations feed; Luca's under Luca in the Chats rail; what Luca did with a connected app; Now lists what's live. Rust list-alls with a unit test. |
| WP-15 the frame's tests | 2026-10-26, merge `d85a44ca8` | Twelve shell specs follow the contracts as amended; tests only, nothing weakened; it found two app bugs, fixed in WP-09b. |
| WP-09b the last of the list | 2026-10-26, merge `36f02e81b` | One ask row in two places; a working mind says so; "Tidepool / general"; Quick Chat never covers content; tiles 120 ms; Back and Forward keep Forward; the sheet's Escape; the first mark no longer leaps; Paper's dot at 3:1; Ctrl+N off the Mac. |
| WP-15b the whole suite | 2026-10-26, merge `af41a1604` | Four shell specs follow WP-13, WP-14 and WP-09b; tests only, nothing weakened. It found that a relay refusing sign-in leaves the Chats rail blank with no connection card: WP-21. |
| WP-18 one state and one mark | 2026-10-26, merge `a45632492` | A side conversation marks Luca's home and lights its row; one hook says working, talking, waking, needs attention or resting, used by the Agents rail, a mind's head, its profile card and Now; the profile card says Talk; Now names live side conversations as the feed does. |
| WP-19 one voice for the small things | 2026-10-26, merge `8918760a4` | Signed record in the shared time, day label and mark; every small capital label in Fragment Mono; Chats drifts like the other places; To: on the reading column; the lip names a pick as section / row; no eyebrow that repeats the place; the small words; a quiet Add to a room. |
| WP-20 Reduce Motion's freeze, the history keys | 2026-10-26, merge `c96c0f8f7` | Under Reduce Motion the first-message film queued all 4,320 steps at once (30 s in software GL, about 0.45 s on the M4's GPU); it now grows them in GPU-fenced shares and settles on the identical picture. Not behind the flag. ⌘[ and ⌘] work from the composer in both layouts. |
| WP-16 the first screen and one ask | 2026-10-26, merge `e5a921101` | Luca's empty conversation takes its ground from the one card in every frame and mode; a permission, a question and a proposal are one row in the room, Needs you and a mind's Notebook, the answers under the text; the room's Run is quiet; the Join banner keeps Quick Chat's column clear. |
| WP-17 Settings on the shared page | 2026-10-26, merge `f2cf0d953` | Every section on the shared place page, boxes gone; the lip names the section; Mode as the segment; one places column kept mounted; a section is a history step; Sign Out is red text; "Polyphonic"; the Shortcuts card matches the keys. |
| WP-21 the Chats card, the talking dot, steady clocks | 2026-10-26, merge `789a426e0` | A relay refusing sign-in shows the card on Chats (a retry loop wiped it); a mind's head breathes for talking as for working; every flag-off comparison pins the page clock. |
| WP-24 Settings > Agents points to each mind | 2026-10-26, merge `656a2b61f` | The section lists every mind as the rail does, each opening its space's Settings; Add agent and the connected apps stay; the second roster, its filters, tabs and "Open in Agent Library" go; 27 controls moved first, LOST: none. |
| WP-22 the final fixes | 2026-10-26, merge `745e4f4c6` | The themes flow on the page with every name; a label repeating the title goes; "N unread"; the moot hand-over goes; "Polyphonic runtime"; a mind's Notebook shows its proposals; the default runtime picker reads by day. |
| WP-25 one quiet button, the last small words | 2026-10-26, merge `605ccf500` | A quiet Button variant (Talk's size, the ask's in a row); "Luca / Atlas · general"; off means not running; Signed record's time at the right; Settings paints in 63 ms instead of 333. |
| WP-23 the room's asks, in the page | 2026-10-26, merge `ce8eb9444` | A room's asks and current work are one stack above the message box, never over a message: flat rows, one label ("Needs you"), at most 40% at rest, folding to one line; an open form takes what it needs; Jump to latest above it. |

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

## The navigation round (2026-10-26)

Riley decided the navigation on 2026-10-25 (`NAVIGATION.md`) and one card on 2026-10-26 (`SHELL_SPEC.md`, amended),
and asked for the real app: "yes you can brief them and just work autonomously until the real app is ready for me to
review". Five packages:
- WP-10 (every place's rail), WP-11 (the Chats rail) and WP-12 (one card) run together.
- WP-13 (a mind's own space) and WP-14 (what agents say to each other, and what needs you) follow once WP-10 and WP-11
  have landed.
- Then WP-09 makes the finished test app.

The shell lab draws every one of these and is the reference for their values: `desktop/src/testing/shellStudy/`
(navigation steps 1 to 4, commits `e0ab98b95` to `68714f1b7`). See it live, headless, at
`http://localhost:1488/scripts/shell-lab.template.html?experience=shell&mode=dark&panel=0` (the shared lab server: look,
never stop it).

The facts below were checked by a read-only scout. Each has its citations in
`~/.claude/plans/polyphonic-shell-build/nav-map/nav-facts.md` (§ numbers), with the older map beside it (`pages.md`,
`ways-in.md`). Re-check what you rely on.

## WP-10 · Six places, each with its own rail (2026-10-26, Riley and Claude's design; Riley: "the rail should always have the contents of the page you're on")

**Why.**
- Read `NAVIGATION.md` whole. The icons pick the place, the rail lists what's in that place, and the card shows the
  one thing you picked. Settings already works this way.
- Today the rail never changes, and Agents, Activity and Library each draw their own list or tabs inside the card.
  This package gives every place its own rail, and those in-card lists become it.
- The lab: `PLACE_RAILS`, `FIRST_PICK` and `PLACE_CARDS` (`content.ts`); `PlaceRail`, `PlacePage` and `cardFor`
  (`ShellStudy.tsx`); the `.shell-rail-head`, `.shell-row-note`, `.shell-row[data-main]` and `.shell-page-*` rules
  (`shellStudy.css`).

**Base.**
- WP-11 and WP-12 are built at the same time. Your styles go in `desktop/src/app/shell/shell-place-rails.css` (new),
  imported after the other shell stylesheets.

**Files in scope:**
- `app/shell/ShellPlaces.tsx`, and where a view's place is decided (`placeOfView`).
- `features/sidebar/ui/AppSidebar.tsx`, only to choose the rail by place and to stop the runtime sessions column opening
  under the flag. WP-11 edits this file too: keep your edit small and self-contained.
- New `app/shell/placeRails/`: the Agents, Activity and Library rails and their shared row.
- Agents: `AgentsView.tsx`, `AgentsScreen.tsx`, `routes/agents.tsx`. The sessions list's own components
  (`RuntimeSessionsPanel.tsx`, `runtimeSessionModel.ts`, `RuntimeRailSection.tsx`), only to show a connected app's
  sessions inside the card. The team components (`TeamsSection`, `TeamDialog`, `AddTeamToChannelDialog`), only to
  open them from a group's card.
- Activity: `PulseScreen.tsx`, `ActivityPageHeader.tsx`, `routes/pulse.tsx`.
- Library: `ArtifactLibraryScreen.tsx`, `SkillLibraryPanel.tsx`, `routes/artifacts.tsx`.
- The lip's title for these places (where the lip's name is chosen).
- Tests, and a new spec `tests/e2e/shell-place-rails.spec.ts`.

**Untouched:**
- the Chats rail's contents (WP-11);
- the cards' layout, gap and surfaces (WP-12);
- a mind's card beyond showing today's detail (WP-13);
- Needs you and Side conversations (WP-14);
- Settings.

**Facts:**
- Places today: §2 of `pages.md`.
- The Agents page: `AgentsView.tsx:317-445`. Its roster column `AgentLibraryRoster` has filters, search and a footer
  with Groups and Defaults. Runtimes rows sit below the roster under the frame (`RuntimeRailSection.tsx`, pinned
  families).
- A group is an `AgentTeam`: a saved team of agent templates (personas), not of live agents. It's stored in
  `teams.json` and as kind 30176. Hooks `useTeamsQuery` etc. are in `agents/hooks.ts:953-1000`. "Add to a room" deploys
  agents from the templates (`AddTeamToChannelDialog`). No group is linked to rooms (nav-facts §4).
- Sessions exist only for Codex and Claude Code, from Brain's index: `useRuntimeConnectionsQuery`,
  `useRuntimeSessionsQuery`. Other runtimes say they have no session source. "Start with this context" stages a
  summary and opens New conversation (nav-facts §5).
- Activity: "Now" is `LucaActivityView`, and "Signed record" is `ProvenanceView`, one tab per managed agent
  (`pages.md` §8).
- Library: kind chips, Artifacts/Skills mode tabs and a Recently deleted toggle, all in local state
  (`ArtifactLibraryScreen.tsx`). Skills runtime chips are in `SkillLibraryPanel.tsx`.

**Decisions** (only under `shell-frame`; with it off, nothing changes):
1. **The places column:** Search (⌘K); then Chats, Agents, Activity, Library; then Settings (⌘,) and the avatar.
   - "Conversations" is called Chats wherever it shows.
   - New conversation, Inbox and Brain leave the column. ⌘N still opens New conversation, and WP-11 puts its `+` on
     the Chats rail's heading.
   - Until WP-13, `/brain` keeps working by its route and belongs to Agents.
2. **A view's place:**
   - Chats: conversations, New conversation, projects and workflows.
   - Agents: `/agents` and `/brain`.
   - Activity: `/pulse`. Library: `/artifacts`. Settings: `/settings`.
   - Chats keeps today's rail (WP-11 reshapes it), and Settings keeps its section list.
3. **The Agents rail:**
   - Luca first and set apart: the owner's main resident (`useCanonicalLucaPubkey`), at a home's weight, with its
     state word at the row's end.
   - **AGENTS**, with `+` (today's Add agent), then every other agent with its state word.
   - **CONNECTED:** today's Runtimes rows (the pinned families), with their state.
   - **GROUPS**, with `+` (create a group: today's `TeamDialog`), then one row per group.
   - State words come from the roster's own availability: working, resting, needs attention. The roster's filters
     and search go (the state words and ⌘K replace them). Its footer's Defaults is already in Settings → Defaults &
     permissions.
4. **What the Agents card shows:**
   - A mind: today's detail, untouched (WP-13 reshapes it).
   - A connected app: its sessions, under the head "Connected · on this Mac" / its name. This is the list
     `RuntimeSessionsPanel` draws today (its search, empty states and "Start with this context"), inside the card
     instead of beside New conversation. Under the flag the runtime sessions column no longer opens (`SHELL_SPEC.md`
     retires it).
   - A group: the head "Group" / its name, its description, its members (each persona's name and runtime), and two
     actions, Edit (`TeamDialog`) and Add to a room (`AddTeamToChannelDialog`).
5. **The Activity rail:** **Now**, then **SIGNED RECORD** with one row per managed agent. The card is the stream you
   picked: `LucaActivityView`, or that agent's `ProvenanceView` tab. The page's own tabs go. WP-14 adds Needs you
   above Now and Side conversations under it.
6. **The Library rail:**
   - **MADE**, with Import at its heading's end, then All, Prototypes, Apps, Images, Documents, Code.
   - **SKILLS:** All, then one row per runtime that has skills.
   - Then **Recently deleted**.
   - The card shows the list you picked (today's rows, keeping its search field). The mode tabs, kind chips and the
     deleted toggle inside the card go.
7. **The pick is in the address,** so Back, Forward and reopening work:
   - Agents keeps `/agents?profile=` and gets parameters for a connected app and a group. `/pulse` and `/artifacts`
     get parameters for their picks.
   - Each place remembers its last pick for the session.
   - On a first visit the place picks its first row: Agents, Luca; Activity, Now; Library, All.
8. **The card's head and the lip:**
   - The cards you add (a connected app, a group, Activity's and Library's lists) open with the lab's `PlacePage`
     head: an eyebrow saying the section over the picked row's name.
   - A mind's detail keeps its own head until WP-13.
   - The lip names the pick by the row's name.
9. **Rows are Chats' rows:** the same type, sizes, tones, 8-point corners, heading eyebrows and `+`.
   - A quiet word at a row's end is the lab's `.shell-row-note`.
   - WP-03's solid mark follows the picked row.
   - Keyboard: Tab reaches the rail, the arrows move between rows, and Enter picks, as in Chats.
10. **Nothing empty:**
    - A section with nothing in it hides, except Luca and Now.
    - A card with nothing to list uses its page's own empty words, never a placeholder.

**Verification** (Playwright headless, 1440 × 900 and 800 × 500, flag on unless stated):
- Seed the mock with: residents in each state, two runtimes with sessions, a group, signed records for two agents,
  artifacts of three kinds, skills for two runtimes, and one deleted piece.
- Screenshots: `places`, `agents-luca`, `agents-connected`, `agents-group`, `activity-now`, `activity-record`,
  `library-all`, `library-skills`, `library-deleted`, and `chats` and `settings` (both unchanged).
- Back and Forward across picks in each place. The keyboard through each rail.
- The flag-off views compared by hash to the base.
- A capability map: every control on today's Agents, Activity and Library pages → its new home, or LOST.

**Checks JSON keys:** `places_six`, `place_of_view`, `agents_rail`, `connected_card`, `group_card`, `activity_rail`,
`library_rail`, `picks_in_url`, `back_forward`, `lip_names_pick`, `marks_follow`, `keyboard`, `capability_map`,
`flag_off_identical`, `gates`.

## WP-11 · The Chats rail (2026-10-26, Riley and Claude's design; SPEC.md as amended 2026-10-25)

**Why.**
- `SPEC.md` is the Chats rail: read "Top to bottom", "One home per chat", "A row", "Selection", "Rooms" and "Keyboard
  and access". `NAVIGATION.md`, "Chats", says why.
- A chat's home is decided by what it is, not only by who is in it. Today a public room with two others became a
  "fleet", and a person was filed under Agents.
- Fleets retire. People and Rooms arrive. Every home shows its latest three conversations with their times, so the
  rail never reads empty.
- The lab draws it: `SECTIONS`, `Rail` and `HomeRow` in `ShellStudy.tsx`; `.shell-session-ago`,
  `.shell-session-more`, `.shell-rail-tail` and `.shell-rail-head` in `shellStudy.css`.

**Base.**
- WP-10 and WP-12 are built at the same time. Your styles go in the Chats rail's own stylesheet.

**Files in scope:**
- `features/sidebar/lib/railHomes.ts` and its tests.
- `features/sidebar/ui/ShellRail.tsx`.
- `AppSidebar.tsx`, only the Chats rail's wiring (the heading's `+`, a row's `+`, Browse rooms…, Archived). WP-10
  edits this file too: keep your edit small and self-contained.
- `channels/ui/ChannelBrowserDialog.tsx` and `app/useChannelBrowserDialog.ts`, to open on a given tab.
- `app/routes/index.tsx`: where the app opens.
- `channels/ui/ConversationContextPanel.tsx`: the Manage button.
- Tests, and a new spec `tests/e2e/shell-chats-rail.spec.ts`. Update the rail's existing specs where they assert
  Fleets.

**Untouched:**
- the other places' rails (WP-10);
- the cards (WP-12);
- Luca's side conversations: WP-14 adds them under Luca's row once it has gathered them. Leave Luca's home ready to
  list more rows, and build none of them.

**Facts** (nav-facts §6, §7, §10):
- Today `homeIdOfChat` (`railHomes.ts:74-94`) files by members alone.
- Person vs agent: the rail's `agents` are this Mac's managed agents only. Anyone else becomes an "agent" home. Profiles
  carry `isAgent` (`UserProfileSummary`), and `ShellRail` already batch-fetches non-agents' profiles.
- Channels carry `channelType` (stream|forum|dm), `visibility` (open|private), `participantPubkeys` and
  `lastMessageAt`. A formatter `relativeTime(iso)` in `chatListModel.ts:114-125` gives "now / 5m / 2h / 3d / 1w".
- The room browser opens with `useAppShell().openBrowseChannels()`. Its tabs (all|joined|archived) are internal state
  and always open on All.
- The management panel opens inside a room with `useChannelPanelHistoryState().setChannelManagementOpen(true)` (the
  pattern in `ChannelScreen.tsx:738-768`).
- Landing today: a pending welcome channel, else the last conversation, else New conversation. Luca's DM is
  `isCanonicalLucaDm`, and is opened or created by `onOpenDm({pubkeys: [lucaPubkey]})`.

**Decisions** (only under `shell-frame`):
1. **The heading:** CHATS, with `+` at its end: New conversation (⌘N, label "New conversation").
2. **Sections, in this order:**
   - Luca, pinned first, under no heading.
   - **PROJECTS** `+`.
   - **AGENTS.**
   - **PEOPLE**, shown once there is one.
   - **ROOMS** `+`, shown once there is one.
3. **One home per chat, by what it is** (`SPEC.md` rules 1 to 5):
   - A project's chat → its project.
   - A direct conversation with one agent (`isAgent`, or one of this Mac's agents) → that agent. Your own with Luca is
     Luca's row.
   - A private stream whose only other member is one agent (an agent session) → under that agent.
   - A direct conversation with one person → PEOPLE (that person's row is their conversation).
   - Everything else → ROOMS, by its own name: an open stream, a forum, a group conversation, and a private stream with
     several others or none. A group conversation with no name of its own shows its members ("Luca + Wren", Luca
     first, then by name; anyone who can't be named is counted, "+ 1 other").
   - Fleets retire.
   - A unit test proves no chat appears twice, over the mock's channels and a synthetic set covering every case above.
4. **Rows:**
   - Every home shows its latest three conversations without being opened, newest first by `lastMessageAt`. The rest
     sit behind a quiet "N more" row that shows them.
   - The open conversation is always visible.
   - A row's trailing slot holds the unread dot, or "working…", or else how long ago (`relativeTime`). On hover the
     `+` takes the slot.
   - Homes start open. The chevron closes one, and each home remembers it.
5. **Rooms ends** on two quiet rows: Browse rooms… (the room browser on All) and Archived (on its Archived tab, through
   a new `initialTab`). ROOMS' `+` starts a room (today's create-room dialog in room mode).
6. **Where the app opens:**
   - A pending welcome channel first, as today.
   - Then Luca, when Luca's conversation has something unread.
   - Else the last conversation.
   - Else Luca (opened or created).
   - Never New conversation.
7. **Manage:** a room's details card (not a direct conversation) gets a Manage button. It opens the room's management
   panel (members, leave, archive, delete), which nothing opens today.
8. Selection, keyboard and access are as `SPEC.md` says. They extend to People's and Rooms' rows and to "N more".

**Verification** (Playwright headless, 1440 × 900 and 800 × 500, flag on unless stated):
- Seed the mock with:
  - a person's direct conversation;
  - a group conversation with and without a name;
  - an open room and a private room outside any project;
  - an agent session;
  - a project with four rooms;
  - an archived room;
  - activity times across minutes to weeks.
- Screenshots:
  - `chats-rail` (top) and `chats-rail-end` (People, Rooms, its tail);
  - `home-more` (a home with four, showing three and "1 more");
  - `hover-plus`, `focus-plus`;
  - `browse` and `archived` (the browser on each tab);
  - `manage` (details → Manage → the panel);
  - `landing-unread` and `landing-last`.
- The no-duplicates unit test. The flag-off views compared by hash to the base.

**Checks JSON keys:** `heading_plus`, `sections_order`, `one_home_per_chat`, `people`, `rooms_named`, `fleets_gone`,
`latest_three`, `times`, `more_row`, `open_always_visible`, `browse_and_archived`, `landing`, `manage`, `keyboard`,
`flag_off_identical`, `gates`.

## WP-12 · One card (2026-10-26, Riley's decision, Claude's design; Riley: "lets go with one card. it just makes more sense i think")

**Why.**
- Riley chose one card over two in the shell lab: the rail and what it opens share one card, in every place. Until
  now they were two cards with 4 points between them, and on glass that strip read as a crack.
- Read `SHELL_SPEC.md`: the sentence, "The card", "The rail", the conversation's card and the panes, all amended
  2026-10-26. Read `NAVIGATION.md`, "One card".
- The lab is the reference drawing, with `cards: "one"`: `.shell-onecard` and the `[data-cards="one"]` rules in
  `shellStudy.css`, and the `oneCard` branch in `ShellStudy.tsx`. Look at it live with `&cards=one`, in
  `mode=light`, and with `rail=closed`.

**Base.**
- WP-10 and WP-11 are built at the same time, and neither touches the cards' layout or surfaces.
- WP-10 stops the runtime sessions column opening under the flag. Leave that column as it is, and ignore it.

**Files in scope:**
- The frame's card rules: `shared/styles/globals/shell-frame.css`, `app/shell/shell-light.css`,
  `app/shell/shell-glass.css`, `app/shell/shell-settings.css`, and the card rules of `conversation-shell.css`.
- `AppShell.tsx`, only to draw the one card beneath the rail and the content.
- `app/shell/shellGlass.ts`: what it counts as a card and reports.
- `app/shell/ShellLip.tsx`: only the card's left edge it computes.
- The workspace's pane cards (`features/conversation-workspace/`): only their surfaces and gaps.
- Tests, and a new spec `tests/e2e/shell-one-card.spec.ts`. Update the frame's existing specs where they assert two
  cards or the 4-point gap.

**Untouched:** what the rails list; the right cards (beyond their distance from the card); the places; the marks.

**Facts** (nav-facts §8):
- The 4 points between the cards are the rail's spacer: `[data-frame] > [data-sidebar-gap]` is the rail's width plus
  `--mn-card-gap`, and closing the rail shrinks it, so the conversation card slides left.
- The rail's card is `[data-frame] [data-sidebar="sidebar"]`, with the card edge and grain. The conversation's card is
  `[data-luca-conversation-surface]` inside `main[data-buzz-glass-inset]`.
- By day one shadow layer is built under every card by `useShellGlassShadows` (`shellGlass.ts:546-582`; one span per
  `frameCards()` box).
- The glass reporter tells the native glass about the conversation card only.
- The lip's `--card-left` is `PLACES_WIDTH + (railOpen ? 220 + 4 : 0)` (`ShellLip.tsx:36-110`).
- Settings draws its section list as a rail-card twin (`[data-luca-settings-list]`) and its panels as a conversation
  card.

**Decisions** (only under `shell-frame`):
1. **One card in every place** (Chats, Agents, Activity, Library, Settings, New conversation):
   - from the places' edge to 6 from the window's right (or 4 from an open right card), top flush with the lip, 6
     above the bottom, corners 10;
   - its surface, grain, lit top edge and shadow are drawn once, on one element beneath the rail and the content, and
     it never moves;
   - by day it has one shadow on the floor; by night, the cards' edge light.
2. **The rail and the content lie on it, transparent:**
   - no surface, edge, grain or shadow of their own, so nothing doubles and no seam shows;
   - what they hold is clipped to the card's corners;
   - the rail's spacer loses its 4 points.
3. **The hairline:**
   - half a point of ink at 8% along the rail's right edge, drawn as an inset line (`inset -0.5px 0 0`), so one device
     pixel on a Retina screen;
   - a box half a point wide isn't painted in Chromium: don't use one.
4. **Closing the rail folds it into the card:**
   - the rail narrows to nothing with its rows held still and clipped;
   - the content's edge follows on the same 460 ms slide;
   - the card's corner never moves;
   - Reduce Motion: instant.
5. **Panes side by side share the card,** divided by the same hairline, not cards of their own with gaps.
6. **The right cards stay cards of their own,** 4 from the one card.
7. **The narrow-window sheet** (under 768) and the rail's peek while closed keep working: while the rail is a sheet or
   peeks, it's a card of its own over the card, as today.
8. **The lip** centres the name on what the rail opens: its left edge is the hairline, not the hairline plus 4.
9. **The glass reporter and the daytime shadows** count the one card (with the right cards) as their cards.
10. **Every frame and mode:** check Black, Liquid Glass and the frosted fallback, each in dark and light.

**Verification** (Playwright headless, 1440 × 900 and 800 × 500, deviceScaleFactor 2, flag on unless stated):
- Screenshots:
  - `one-dark` and `one-light` (Chats);
  - `one-glass-dark` and `one-glass-light`;
  - `one-rail-closed`, and `one-closing` caught mid-slide;
  - `one-panes` (two panes), `one-settings`, `one-agents`, `one-right-card` (details open);
  - `one-narrow` (800 × 500, and the sheet under 768).
- Measurements:
  - the rail's right edge equals the content's left edge;
  - the card's box doesn't move while the rail closes (its left, top and corners, frame by frame);
  - the hairline is one device pixel of ink at 8% (read the pixels across the seam);
  - there is one shadow, and no edge light inside the card.
- The flag-off views compared by hash to the base.

**Checks JSON keys:** `one_card_every_place`, `transparent_columns`, `hairline_pixels`, `fold_keeps_corner`,
`reduce_motion`, `panes_share_card`, `right_cards_apart`, `sheet_and_peek`, `lip_axis`, `glass_and_shadows`,
`frames_and_modes`, `flag_off_identical`, `gates`.

## WP-13 · A mind's own space (2026-10-26, Riley and Claude's design; Riley: "a place where you raise your agent")

**Why.**
- Read `NAVIGATION.md`, "A mind's own space". Every mind gets the same space, with three tabs: Notebook (their days),
  Self (who they are) and Settings (how they run).
- Today a mind's card has four tabs (Place, Documents, Notebook, Settings), Brain is a place of its own, and the profile
  card on the right repeats their continuity and memories. After this, each thing lives once.
- The lab draws it: `MindSpaceCard`, `MIND_SPACES`, `NOTEBOOK_FILTERS` and `KIND_LABEL` (`content.ts`,
  `ShellStudy.tsx`), and the `.shell-mind-*` rules (`shellStudy.css`).

**Base.**
- The integration branch with WP-10, WP-11 and WP-12 landed. WP-14 is built at the same time; it touches neither the
  Agents card nor Brain.
- Your styles go in `desktop/src/app/shell/shell-mind-space.css` (new).

**Files in scope:**
- A mind's card in Agents: `AgentLibraryWorkspace.tsx` and its sections (`ResidentPlaceSection`,
  `ResidentDocumentsSection`, `ResidentNotebookPanel`, `ResidentHandoffPanel`, the settings sections), and new
  components for the space.
- Brain:
  - `luca/brain/BrainView.tsx`: split its body from its page header;
  - `BrainScreen.tsx` and `routes/brain.tsx`;
  - `goBrain` in `app/navigation/useAppNavigation.ts`;
  - `luca/brain/useBrainReviewNavigation.ts`;
  - the `"brain"` surface in `luca/usePolyphonicSurfaceNavigation.ts`;
  - the project row's menu item in `ShellRail.tsx` (its label only).
- The profile card for an agent: `features/profile/ui/UserProfilePanel*` (an agent's profile only).
- Tests, and a new spec `tests/e2e/shell-mind-space.spec.ts`.

**Untouched:** the Agents rail and the connected-app and group cards (WP-10); Activity, the side conversations and
Needs you (WP-14); a person's profile card.

**Facts** (nav-facts §3, §9):
- **Their own words:** `useResidentPlace(pubkey)` gives the introduction, what they're exploring, the selected work
  and `residentEditingEnabled`. It works for managed residents on this Mac only; others get an "unmanaged / not local"
  answer.
- **Journal and memory notes:** `listResidentNotebookItems(pubkey, cursor, size)` returns items of kind
  `memory_note`, `journal_page` or `journal_annotation`, each with authorship, title, body, category and times. It's
  paged, and the Notebook tab shows only for managed agents today.
- **Relay memory:** `useAgentMemoryQuery(pubkey)` returns engrams `{slug, body, createdAt}`, for any agent the owner
  owns.
- **What they did:** `useAgentProvenanceQuery(pubkey)` returns signed records `{family: speech|code|work|signal,
  weight, verb, object, outcome, channelId, createdAt}`.
- **Questions for you:** `useManagedInputs()` and `useManagedPermissions()` list every pending item app-wide, each with
  `residentPubkey` and `conversationId`. They're answered in place by `ManagedInputCard` and `ManagedPermissionCard`.
- **What they made:** `ArtifactSummary.provenance.residentPubkey`. `list_artifacts` has no filter by maker, so filter
  on the client.
- **No record tells "for you" from "their own time".**
- **Brain:** `BrainView` takes no props and draws its own page header. Its data covers the whole account, with
  per-agent access grants (reconfirm or revoke) in its details.
- **Ways into Brain:** every one calls `goBrain()` with nothing passed.
- **Luca:** `useCanonicalLucaPubkey()`.

**Decisions** (only under `shell-frame`):
1. **The head:** their mark (as the app draws a resident elsewhere), their name, one line of what they're doing now,
   and **Talk**, which opens your conversation with them.
   - The line says where they're working when they are (`useAgentWorking`), else their state word.
2. **Three tabs:** Notebook, Self, Settings. The tab is in the address (`section=notebook|self|settings`).
   - Today's values map onto them: `place` and `notebook` → notebook; `documents` → self; `settings` → settings.
3. **Notebook, top to bottom:**
   - **Their own words** (minds on this Mac):
     - the introduction, large (the lab's `.shell-mind-words`), and what they're exploring, quietly;
     - beside them, the one chosen piece;
     - Edit and the "Let them edit this" switch (today's Place editing);
     - a mind not on this Mac skips this block.
   - **What they're asking you:** their pending questions and permission requests, each answerable in place with
     today's cards.
   - **Their days:** one stream, newest first, by day (Today, Yesterday, then dates). Each entry carries its kind's
     label and its time:
     - **For you / Their own**, from the signed record:
       - code and work records one by one (verb and object);
       - speech collapsed to one line per conversation per day ("Talked in Tidepool · 12 messages");
       - signals left out;
       - a record in a conversation you're a member of is For you; anywhere else, Their own.
     - **Journal:** journal pages (their annotations with their page), the title and first lines, in the journal's
       italic voice.
     - **Memory:** memory notes and the relay memory, as "Kept: …" with the first line.
     - **What they made:** their artifacts as a receipt, with the piece's picture when it's an image, else its kind's
       mark. It opens in the Canvas, and it's For you or Their own by the same rule (the artifact's conversation).
   - **Filters:** All, For you, Their own, Journal, Memory (the lab's `.shell-mind-filter`). A filter with nothing in
     it hides.
   - The stream loads more as you scroll.
   - Today's Notebook actions stay reachable here: writing a journal page, annotating, the saved handoff.
4. **Self:** today's Documents, each row naming who writes it.
   - The rows: Soul, Convictions, Who I'm becoming (the self-model), What I know about <owner> (the user model),
     Lessons, Instructions, then More files and New file.
   - Each row opens today's editor in place.
   - Who writes each is taken from the code (`documentKinds.ts`), never assumed. The lab's line "Luca asks before
     changing anything you wrote" appears only if the code makes it true.
5. **Settings:** how they run.
   - First: the connected app and model; waking with the app; the workspace; **What they can read**; permissions;
     identity.
   - Then today's other sections (appearance, recent rooms, runtime health, companion settings).
   - A section a mind doesn't have hides.
6. **What they can read** is Brain's body inside Settings, without Brain's page header: its four cards, the scan, the
   consent dialogs, and the details with this mind's access grants. For Luca it's everything Brain connects; for
   another mind, the same sources with that mind's grants.
7. **`/brain` opens Luca's space on Settings, at What they can read.** Every way into Brain lands there:
   - `goBrain`;
   - the project row's menu item, now called "Sources";
   - the runtime sessions' "Open Brain";
   - an agent's brain-review request;
   - the surface navigation.
8. **The profile card on the right, for an agent:** a short summary (mark, name, state, the first line of their
   introduction, their runtime) with **Open their space** and Message. Its Continuity and Memories tabs go: they're
   the Notebook now. A person's card is unchanged.
9. **The same space for every mind.** A part a mind has no data for hides, never a placeholder.

**Verification** (Playwright headless, 1440 × 900 and 800 × 500, flag on unless stated):
- Seed the mock with: Luca's place (words, a selected piece), journal pages, memory notes and engrams, signed records
  in rooms you are and aren't in, two artifacts (one image), a question and a permission request, and a native agent
  that isn't on this Mac.
- Screenshots: `space-luca`, one `notebook-<filter>` per filter, `asks-answered` (one question answered in place),
  `self`, `settings`, `what-they-can-read`, `brain-redirect`, `profile-summary`, `open-their-space`,
  `space-native-agent`.
- The head and the stream's type measured against the lab. The keyboard through tabs and filters.
- The flag-off views compared by hash to the base.
- A capability map: every control in today's four tabs, Brain and the profile card → its new home, or LOST.

**Checks JSON keys:** `head`, `tabs_in_url`, `own_words`, `asks_in_place`, `stream_kinds`, `for_you_rule`, `filters`,
`made`, `notebook_actions`, `self_documents`, `who_writes`, `settings_sections`, `what_they_can_read`,
`brain_redirect`, `sources_label`, `profile_summary`, `native_agent`, `keyboard`, `capability_map`,
`flag_off_identical`, `gates`.

## WP-14 · What agents say to each other, and what needs you (2026-10-26, Riley and Claude's design; Riley: "a place where all of Luca's (or other agent) activity lives")

**Why.**
- `NAVIGATION.md`, "Activity": the whole house in one place, with Needs you and its count, Now, Side conversations and
  Signed record. Side conversations is one feed of everything agents say to each other: the agent-to-agent ledger
  Riley asked for on 2026-10-20.
- `NAVIGATION.md`, "Chats": Luca's side conversations sit under Luca.
- What the code has (nav-facts §1, §2):
  - Agents talk inside rooms you're in, as exchanges (kind 30178), turn-tagged messages and visits. Luca uses Codex and
    Claude Code through runtime tasks. Neither is listed across rooms today.
  - Needs you's sources are lists that already exist (permission requests, questions) or exist per room (Luca's
    proposals to run an app, paused exchanges). No count covers them.

**Base.**
- The integration branch with WP-10, WP-11 and WP-12 landed. WP-13 is built at the same time.
- Your styles go in `desktop/src/app/shell/shell-activity.css` (new).

**Files in scope:**
- **The gathering:**
  - `features/exchange/exchangeStore.ts`: an every-room selector;
  - a new hook that joins exchanges and runtime tasks into one list;
  - in `desktop/src-tauri/src/`, a list across all conversations for runtime tasks and runtime-task proposals
    (`luca/runtime_tasks.rs` and its command registration), plus `shared/api/tauriRuntimeTasks.ts`;
  - the mock bridge's handlers for them.
- **Activity:** WP-10's Activity rail (`app/shell/placeRails/`) and the Activity cards.
- `app/shell/ShellPlaces.tsx`: only the Activity tile's count.
- **The Chats rail:** Luca's home only (`ShellRail.tsx`, `railHomes.ts`).
- WP-10's connected-app card: only its "What Luca did with it".
- Tests, a Rust unit test, and a new spec `tests/e2e/shell-activity.spec.ts`.

**Untouched:** a mind's card (WP-13), Brain, the other places.

**Facts** (nav-facts §1, §2, §5):
- **The exchange store** holds every owner exchange: `members`, `conversation_id`, `root_event_id`, `depth`,
  `opened_by`, `deadline`, and a derived phase (open|paused|closed|expired). It offers per-room selectors only. There's
  no opened-at time, and recency follows `deadline`. Turns are kind-9 messages tagged `["exchange", id, turn]`.
- **Runtime tasks:** `RuntimeTaskProjection` has `{taskId, conversationId, residentPubkey, runtimeFamily, summary,
  state, startedAt, updatedAt, completedAt, …}`.
  - It's listed per conversation by `listRuntimeTasks(conversationId)`, while the backend's map holds them all.
  - The live event is `luca://runtime-task`.
  - `openRuntimeTaskSession(taskId)` opens the native session.
- **Proposals:** `useRuntimeTaskProposals(conversationId)` is per room (in memory in the backend), answered by
  `RuntimeTaskProposalConfirmation`.
- **Paused exchanges:** `usePausedExchangeChannelIds()`, answered by the exchange strip's "Stop here" and "Let them go
  on".
- **Permission requests and questions:** `useManagedPermissions()` and `useManagedInputs()` list them app-wide, each
  answered in place by its card.
- **The only badge today** is the Inbox's, zeroed while the Inbox is off.

**Decisions** (only under `shell-frame`; the new list-all commands are additive):
1. **One list of side conversations,** newest first:
   - every exchange: its agents, its room, its phase and the time of its latest turn (or its deadline if no turn has
     loaded);
   - every runtime task: who ran it, which app, its summary, its state, its times and its room.
2. **The Activity rail:** **NEEDS YOU** first, with its count at the row's end; **Now**; **Side conversations**; then
   WP-10's **SIGNED RECORD**. Activity's first pick becomes Needs you.
3. **The Needs you card:** everything waiting on you, newest first, each answerable in place:
   - permission requests;
   - questions;
   - Luca's proposals to run Codex or Claude Code;
   - paused exchanges, with Stop here and Let them go on.
   - Each says who's asking and where, and opens its conversation.
   - With nothing waiting: "Nothing is waiting on you."
4. **The count:** the number of items in Needs you, on the Activity icon (where the Inbox's count drew) and at the
   row's end. At zero, nothing shows.
5. **The Side conversations card:** one feed, by day.
   - An exchange's row: "Luca asked Atlas" (its opener and the others), the room's name, its state (talking, paused,
     done), its turns when known, and its time. It opens the room at the exchange's first message.
   - A runtime task's row: "Luca asked Claude Code", its summary, its state and its time. It opens its room at the
     task's receipt.
6. **Luca's side conversations, under Luca in the Chats rail:**
   - the exchanges Luca took part in and Luca's runtime tasks;
   - the latest three, and a talking one never folds away;
   - each as "Atlas · Tidepool" or "Claude Code · <summary>", with "working…" or its time in the trailing slot;
   - each opens where it happened.
7. **The connected-app card** gets **What Luca did with it** under its sessions: that app's runtime tasks, newest
   first, each opening its room's receipt.

**Verification** (Playwright headless, 1440 × 900 and 800 × 500, flag on unless stated):
- Seed the mock with: exchanges in three rooms (open, paused, closed), runtime tasks (two for Claude Code, one for
  Codex), a proposal, a permission request and a question.
- Screenshots: `needs-you` (every kind), `needs-you-answered` (one of each answered in place), `activity-count`,
  `side-conversations`, `luca-side-rows` (the Chats rail), `connected-what-luca-did`.
- The Rust unit test for the list-alls, through the shared build cache.
- The flag-off views compared by hash to the base.

**Checks JSON keys:** `gathering`, `rust_list_all`, `needs_you_kinds`, `answer_in_place`, `count_badge`,
`side_feed`, `luca_rows`, `connected_history`, `flag_off_identical`, `gates`.

## WP-09a · The finishing list (2026-10-26, Claude's design, from the reviews of WP-04b to WP-08g; Riley: "anything else that you can do to speed things up - go for it")

**Why.**
- The reviews of WP-04b through WP-08g left small items in `~/.claude/plans/polyphonic-shell-build/wp09-polish-list.md`.
  This package fixes the ones that don't touch WP-10, WP-11 or WP-12's files, so it runs beside them.
- The rest wait for WP-09 after those land: the places' tiles, the lip's back and forward focus, the sheet's Escape,
  a project room opened from Search, the card's shadow trailing a width change, and Send by day (Riley's eye).
- It also fixes the window's first size. The app opens maximized on its first run (`tauri.conf.json`
  `"maximized": true`), which on Riley's screen is edge to edge and nothing like what most people see. And a test
  app stopped by a kill loses its size, because the window-state plugin saves only on a normal quit.

**Base.**
- WP-10, WP-11 and WP-12 are being built at the same time. Never touch their files: `ShellPlaces.tsx`, `ShellLip.tsx`,
  `AppSidebar.tsx`, `ShellRail.tsx`, `railHomes.ts`, `shared/ui/sidebar.tsx`, the shell's card and shadow styles,
  `AgentsView.tsx`, `PulseScreen.tsx`, `ArtifactLibraryScreen.tsx`.
- Your styles go in `desktop/src/app/shell/shell-finish.css` (new), imported after the other shell stylesheets.

**Files in scope:**
- `ChannelScreenHeader.tsx` (Join's transition, Details' open state, a group's presence);
- the forum's content top (`ForumView.tsx` / `ForumChannelContent.tsx`);
- the workspace's empty pane (`features/conversation-workspace/`);
- the timeline's day divider;
- the right card's tabs by day;
- the companion control (`companionAppControl.css` and its component);
- the huddle bar (`features/huddles/`: its tooltips, popovers, first-run hint, count badge and status words);
- the status cards' own components (their dismiss buttons only);
- the connection store (only to add its reset to `resetCommunityState()`);
- Settings' theme tiles;
- Settings' section list mark (`marks.ts` / `ShellMarks.tsx` and the Settings list, only that);
- the window: `desktop/src-tauri/tauri.conf.json` (the main window's first size) and `desktop/src-tauri/src/lib.rs`
  (the window-state plugin and the first run's size);
- tests.

**Decisions** (under `shell-frame` unless a decision says otherwise):
1. **Join fades on the lip's 120 ms,** its border colour too, like every lip button.
2. **Details' open state is the current place's plate** (ink 7.5% with the lit top), so it no longer looks like a
   hovered closed button.
3. **A forum's first content sits 22 below the card's top,** as a conversation's does (not 39).
4. **An empty pane:**
   - when it's focused, the lip names it in its own empty-state words, so the page's only h1 is never empty;
   - the layout menu stays reachable there.
5. **A group conversation's lip** shows its members' initials, not one member's presence avatar.
6. **The status cards' two small dismiss buttons** show the focus ring the rail's buttons use.
7. **The connection store resets with the community:** add its reset to `resetCommunityState()` (`CLAUDE.md`'s rule).
8. **A success-tone card** ("Connected", a task done) carries the green icon alone, on the card's own plate.
9. **Settings' theme tiles** show keyboard focus.
   - If a coloured accent from a retired glass theme (Obsidian) still shows after the move to its replacement, it
     resets to the replacement's accent.
10. **Settings' section list uses the sliding mark** (WP-03's engine), as the places and the Chats rail do, not a still
    plate.
11. **The timeline's day divider** loses its full-width rule under the date (the study has none).
12. **The right card's tabs by day:** the chosen tab stands up like the study's chosen segment (paper with a soft
    shadow), not a darker dip.
13. **The companion control:**
    - its badge moves off the sticky TODAY pill's axis (below it while the pill shows);
    - in full screen under Black, its halo's corner goes square, as the window's does.
14. **The huddle bar** (WP-08e's review):
    - its tooltips, popovers and first-run hint take the frame's popover material;
    - its count badge is 10, like the places';
    - its status words don't squeeze at 800 × 500;
    - with a right card open, its controls stay on the card's axis;
    - Quick Chat no longer covers Leave's edge.
15. **The window's first size** (every build, not only under the flag):
    - The first run opens at 1440 × 900, or the screen's usable area less 40 on each side if that's smaller, centred,
      not maximized.
    - Every later run restores what the person last set (maximized included).
    - The window-state plugin also saves on resize and move (debounced), so a crash or a kill keeps the size.
    - The minimum stays 800 × 500.

**Verification** (Playwright headless, flag on unless stated; Rust with `cargo check` and `cargo clippy` through
`bash scripts/with-internal-build-cache.sh`, inside the queue):
- One screenshot or measurement per decision: transition durations read from computed styles, the plate's colour, the
  forum's first offset, the empty pane's h1, initials, focus rings, the store's reset in a unit test, the success
  card, theme focus, the mark sliding (a two-frame trace), no rule under TODAY, the chosen tab, the badge's box, the
  halo's radius in a faked full screen, and the huddle items at 800 × 500.
- For decision 15: a unit test of the first-size rule (screen sizes of 1280 × 800, 1512 × 982 and 5120 × 2880), and
  `cargo clippy` clean. Claude checks the real window in the test app.
- The flag-off views compared by hash to the base, except decision 15, which isn't flag-gated.

**Checks JSON keys:** one per decision (`join_fade`, `details_open`, `forum_top`, `empty_pane`, `group_initials`,
`dismiss_focus`, `store_reset`, `success_card`, `theme_focus`, `settings_mark`, `day_divider`, `day_tabs`,
`companion_badge`, `companion_halo`, `huddle`, `first_size`), plus `flag_off_identical`, `clippy`, `gates`.

## WP-15 · The frame's tests, brought to the new places (2026-10-26, Claude's design, from the merges of WP-10, WP-11, WP-12 and WP-09a)

**Why.** WP-10, WP-11, WP-12 and WP-09a landed together, and the frame's older specs still assert what they changed:
- the New conversation, Brain and Inbox tiles;
- the runtime sessions column;
- Fleets;
- two cards with a 4-point gap;
- `/pulse` showing the Chats rail.

WP-11's own spec boots on `/pulse`, which is Activity's place now, so 13 of its tests can't find the Chats rail.

**Base.** The integration branch with all four merged. WP-13 and WP-14 are built at the same time, each with its own
new spec; WP-14 also updates `shell-place-rails.spec.ts` for Activity's new first pick. Leave that spec alone unless it
fails on your base.

**Files in scope:** `desktop/tests/e2e/**` and `desktop/playwright.config.ts`. No app code.

**Decisions:**
1. Every shell spec boots on the view it means: a conversation for the Chats rail (never `/pulse`), the place itself
   for a place.
   - Boot at `/#/…`, without a page query, wherever Back or a pick matters. With a query, the hash router glues it onto
     the last value on Back (WP-10's finding).
2. Expectations follow the contracts as amended:
   - the six places (`NAVIGATION.md`);
   - the Chats rail (`SPEC.md`);
   - one card (`SHELL_SPEC.md`);
   - the connected app's card instead of the runtime sessions column. Move `shell-runtime`'s column checks to that
     card, or retire them where the spec retires the column.
3. **Never weaken an assertion to make it pass.** A spec that fails because the app is wrong is reported as an app bug,
   with how you saw it. It is not edited.
4. Run the whole shell suite at the end through the queue, then again to tell flakes from failures. Report every
   failure as:
   - test fixed;
   - app bug;
   - flaky: fails on the base too, or once in two runs.

**Checks JSON keys:** `specs_updated`, `suite_run_1`, `suite_run_2`, `app_bugs`, `flaky`, `gates`.

## WP-09b · The last of the list, with everything landed (2026-10-26, Claude's design, from every review of the navigation round)

**Why.**
- WP-10 to WP-14 and WP-09a have all landed. Their reviews left a short list of items that wait for the pieces to be
  together: one ask row in two places, a working mind that says so, a project room's name, and the Quick Chat button
  over content in a small window.
- Plus the few WP-09a deferred because their files were busy:
  - the places' tiles;
  - the lip's back and forward keys;
  - the sheet's Escape;
  - a room opened from Search.
- This is the last package before the test app.

**Base.**
- The integration branch with WP-10 to WP-14 merged. WP-15 (the specs) may still be running: it changes only tests.
  Add your own spec; don't edit WP-15's.
- Your styles go in `desktop/src/app/shell/shell-finish.css` (WP-09a's).

**Files in scope:** each item's own files, named below. Keep every edit small.

**Decisions** (under `shell-frame`):
1. **One ask row** (WP-14's `PlaceAskRow`) in both places, so an ask looks and answers the same in Needs you and in a
   mind's Notebook.
   - The Notebook's one-line asks (WP-13's `MindNotebook.tsx`) use it.
   - In a mind's own space the second line ("Atlas asks · general") drops the mind's name, since the space is theirs:
     it says only where.
2. **A working mind says so everywhere.** A mind's now line in its space (`MindSpace.tsx`) and its row in Now use
   `useRuntimeWorkingPubkeys` (`features/capabilities/useAllRuntimeTasks.ts`), so Luca reads "working" while Claude Code
   or Codex runs a task for it.
3. **A project room's lip names its project:** "Tidepool / general", the way the lab names a session under its home
   (the lab's `.shell-title-home`, rule and session). A room outside any project keeps its own name.
4. **The Quick Chat button never covers content.**
   - At 800 × 500 it covers a mind's column, the side feed's times, and the composer's Send while a huddle is live.
   - Give the card's content a right-hand safe area the button's width while it shows, or move the button clear. One
     rule for all places, measured at 800 × 500 and 1440 × 900.
5. **The chosen piece's thumbnail** in a mind's Notebook gets an accessible name: "Open <piece title>".
6. **The places' tiles fade on 120 ms,** like every lip button (they're 150).
7. **The lip's Back and Forward keys** (⌘[ and ⌘]) work while the lip's own back or forward button still has focus
   after a click.
8. **Under 768, closing the rail's sheet with Escape** returns focus to what opened it (the toggle), not to the page
   body.
9. **Opening a project room from Search** shows its project open in the rail with the room lit. WP-11's homes start
   open and the rail scrolls to what opens, so this may already hold: verify first, and fix only if it doesn't.
10. **The rail's mark on a first visit** to a connected app takes a first step of 15–21 where later picks take about 3
    (WP-10 fix 14, partial). Chase it once with a frame trace. If the cause is the card's lazy load moving the rows,
    hold the mark until the card has painted. Report what you find; if it's not cleanly fixable, leave it.
11. **Paper's unread dot:** under the frame in light, deepen it so it reaches at least 3:1 on paper (today 2.9:1). Leave
    the app-wide token as it is outside the frame.

**Verification** (Playwright headless, flag on unless stated, 1440 × 900 and 800 × 500, no video or trace):
- one measurement or screenshot per decision;
- the flag-off views compared by hash to the base on non-blank shots;
- the gates.

**Checks JSON keys:** `ask_row_shared`, `working_everywhere`, `project_lip`, `quick_chat_clear`, `thumb_name`,
`tiles_120`, `back_forward_keys`, `sheet_escape`, `search_room_open`, `first_mark`, `paper_dot`, `flag_off_identical`,
`gates`.

## The last round: where the pieces meet (2026-10-26)

**Why.** A design review of the whole merged app (`~/.claude/plans/polyphonic-shell-build/final-review-design/`: its
`shots/` and `measures/`) found that the frame is right everywhere, but the pieces disagree where they meet. Its first
three were:
- the first screen sits off the card;
- Settings looks like another app;
- the same ask is drawn three ways.

Four packages, built together, each on its own files, then one combined review of the whole before the test app:
- WP-16, the first screen and one ask;
- WP-17, Settings on the shared page;
- WP-18, one state, one mark;
- WP-19, one voice for the small things.

Every package works from the integration branch with everything merged. Reference: the shell study
(`desktop/src/testing/shellStudy/`), served at
`http://localhost:1488/scripts/shell-lab.template.html?experience=shell&mode=dark&panel=0&cards=one`. The shared place
page is `app/shell/placeRails/PlacePage.tsx`.

## WP-16 · The first screen, and one ask everywhere (2026-10-26, Claude's design, from the final design review B1 and H3)

**Files in scope:**
- `shared/ui/living-surface/LivingSurfaceCanvas.tsx`;
- the ask row (`app/shell/placeRails/PlaceAskRow.tsx`, `ManagedAsks.tsx`, `shell-activity.css`);
- the conversation's own ask cards: `ManagedPermissionCard.tsx`, `ManagedInputCard.tsx`, `RuntimeTaskProposalConfirmation.tsx`, and their stack in `ChannelPane.tsx`.

**Decisions** (under `shell-frame`):
1. **The first screen sits on the card.**
   - Under the frame, the first-message canvas takes its ground from the one card (`[data-luca-one-card]`,
     `--mn-surface`), never from the floor and never from the fallback.
   - Measure Luca's empty conversation in Black and Liquid Glass, dark and light: the conversation half reads the
     card's colour, the same as the rail half, and its title reads at 4.5:1 or better.
2. **One ask, one drawing, everywhere.**
   - A permission, a question or a proposal is drawn the same in a conversation's pending stack, in Needs you and in a
     mind's Notebook, with the same words.
   - The answers sit under the ask's text at every width, never beside it, so the ask is never squeezed.
   - In the study's material: a plain tint (ink at 8%), not an outline. The room's stack keeps its fold, the same
     answers, and Details on request.
   - The conversation's solid "Run" becomes the same quiet button. Talk stays the only solid action on a screen.

## WP-17 · Settings on the shared page (2026-10-26, Claude's design, from the final design review H1, M1, M2, M8, L4)

**Files in scope:**
- Settings' views and panels (`features/settings/ui/SettingsView.tsx`, `SettingsSectionHeader.tsx`, `SettingsPanels.tsx`,
  the profile card's Sign Out);
- `app/AppShell.tsx` (only Settings' places column and its page transition);
- `app/shell/ShellSettingsPlaces.tsx`;
- `app/shell/shell-settings.css`.

**Decisions** (under `shell-frame`):
1. **Every Settings section uses the shared place page.**
   - Padding 30 / 28, the 640 column centred on the card's axis, the 22 title.
   - The group's name (Account, Experience…) is the eyebrow; the section's name is the title. "Profile & identity" in
     the rail is the title too, not "Profile".
   - Sections lose their boxes: rows and groups on the page, as the study draws them.
2. **The lip names the section** ("Appearance"), not "Settings".
3. **Mode is drawn as Frame's segment, on the same row:** the study's pill segment, not three tiles in the accent
   colour.
4. **One places column across Settings and the rest of the app.**
   - Keep the column mounted, so its mark slides into Settings and out again rather than jumping 600 points.
   - Settings arrives with the same page transition as every place.
5. **Sign Out is red text, not a solid red button.** Any solid button left in Settings is Talk's size (30 tall, 13, radius 9).
6. **The app is called Polyphonic** wherever it names itself ("Choose a theme for Polyphonic", "About"), never "Luca",
   who is the companion now.

## WP-18 · One state and one mark for each mind (2026-10-26, Claude's design, from the final design review H2, M4, M5, M9)

**Files in scope:**
- `features/sidebar/ui/ShellRail.tsx` (side rows' marking);
- a new shared hook for a mind's state (e.g. `features/agents/lib/useMindState.ts`);
- where the state is shown: `placeRails/placePicks.ts` (the Agents rail), `features/agents/space/MindSpace.tsx` (the
  now line), `features/profile/ui/UserProfilePanelAgentSummary.tsx`, `features/pulse/ui/LucaActivityView.tsx` (Now).

**Decisions** (under `shell-frame`):
1. **A side conversation marks where it belongs.**
   - Opening one of Luca's side conversations (from the rail, Side conversations or Needs you) puts the mark on Luca's
     home and lights that side row (`SPEC.md`, "Selection"). It never marks the room it happens in.
   - In a room you haven't joined, the lip's Join is the only solid button: the in-card "Join to participate" becomes
     quiet.
2. **One state for each mind, said the same everywhere.** One hook decides working, talking, waking, needs attention or
   resting, from:
   - the live turn;
   - the mind's running runtime tasks;
   - its live side conversations;
   - its errors.
   The Agents rail, a mind's head, its profile card and Now all use it. Atlas talking with Luca reads talking in all four.
3. **An agent's profile card:**
   - its one action is "Open their space";
   - "Message" becomes "Talk", the same word as the space;
   - neither is solid on the card, since Talk is solid only in the space.
4. **Now names a live side conversation the way Side conversations does** ("Luca asked Atlas", "Luca asked Claude
   Code"). Each mind is listed once.

## WP-19 · One voice for the small things (2026-10-26, Claude's design, from the final design review M3, M6, M7, M10, L1–L3, L5, L6)

**Files in scope:**
- `features/provenance/ui/ProvenanceView.tsx`, `ProvenanceRow.tsx`;
- `features/channels/ui/ConversationContextPanel.tsx` (its labels);
- `app/navigationChoreography.ts`;
- `features/messages/ui/NewMessageScreen.tsx`;
- `app/shell/placeRails/PlaceLipName.tsx`, `PlacePage.tsx`;
- `features/artifacts/ui/ArtifactLibraryScreen.tsx` (its kind labels);
- `features/sidebar/lib/railHomes.ts` (only an agent home's name);
- the empty pane's words (`features/conversation-workspace/`);
- `app/shell/placeRails/GroupCard.tsx` (its solid button).

**Decisions** (under `shell-frame`):
1. **Signed record speaks like the rest:**
   - times as "6:41 AM", the app's shared format;
   - the shared Fragment Mono day label, with no rule;
   - the mind's own mark, not an initial;
   - the end note and the empty line on the left axis.
2. **Every small capital label is the shared Fragment Mono label.** That covers the details card ("At a glance",
   "Agents", "People", "Between agents"), "Current work" and "Action preview".
3. **Chats drifts like the other places.** Arriving at a conversation from another place moves the page by the places'
   order, as Agents, Activity and Library do. Moving from one conversation to another stays still.
4. **New conversation's "To:" sits on the reading column,** with no band or border at rest. At 800 × 500 the recipient
   list never covers the message box.
5. **The lip names a pick as "section / row" wherever a row's name alone is ambiguous:** "Skills / All",
   "Made / All", and "Signed record / Luca" for a mind's record.
6. **A place card drops its eyebrow when it would only repeat the place's own name** ("Activity" over Now, "Library"
   over All). Keep it when it says something else ("Connected · on this Mac", "Group", "Signed record").
7. **Small words:**
   - Library's kinds in sentence case ("Image", "Markdown"), never "IMAGE artifact";
   - the empty pane says "Choose a conversation from the rail";
   - another agent's home is named after the agent's profile name, not the conversation's title.
8. **A group's "Add to a room"** is a quiet button: Talk is the app's only solid shape of its kind on a page.

**For all four:**
- Verification: Playwright headless, 1440 × 900 and 800 × 500, dark and light, flag on; no video or trace; one
  measurement or screenshot per decision.
- The flag-off views must match the base by hash, on non-blank shots.
- Gates.
- Checks JSON keys: one per decision (`d1`, `d2`, …), plus `flag_off_identical` and `gates`.

## WP-20 · Reduce Motion's freeze, and the history keys from the composer (2026-10-26, Claude's design, from the final flows review)

**Why.** The final flows review (`~/.claude/plans/polyphonic-shell-build/final-review-flows/`) found two problems:
- With the Mac's Reduce Motion setting on, the new shell blocks the page for 30 to 38 seconds after it loads. The old
  layout answers in 2 ms under the same load, and the new shell in about 300 ms with Reduce Motion off. The likely
  place is the Reduce Motion branches in `app/shell/marks.ts`; this is unconfirmed.
- ⌘] does nothing once focus is in the composer (after ⌘[ lands in a conversation). This happens in both layouts.

**Files in scope:**
- `app/shell/marks.ts`, `ShellMarks.tsx`, and whatever the profile shows spinning under Reduce Motion;
- the composer's key handling and `app/navigation/useBackForwardControls.ts`, only for ⌘[ and ⌘].

**Decisions** (the freeze fix under `shell-frame`; the keys in both layouts):
1. **Find the freeze by measuring.** Profile the first seconds after load with Reduce Motion emulated
   (`page.emulateMedia({ reducedMotion: 'reduce' })`), using the browser's performance profile, long-task entries, or
   timers. Fix what spins at its source.
   - Under Reduce Motion the shell answers as fast as with it off: the first interaction within 1 s of the page
     showing, at 1440 × 900 and 800 × 500, in Chats, Agents and Activity.
   - The marks still land instantly under Reduce Motion.
2. **⌘[ and ⌘] work from the composer.** A history key is never swallowed by the text field, so you can go Back and then
   Forward while focus is in the composer. The composer keeps its own keys.

**Checks JSON keys:** `freeze_cause` (what spun, with the evidence), `reduced_motion_responsive` (first-interaction
times, before and after, with and without Reduce Motion), `marks_instant`, `history_keys_from_composer`,
`flag_off_identical`, `gates`.

## WP-21 · Three last things (2026-10-26, Claude's design, from WP-15b and WP-18)

**Files in scope:**
- the rail's status cards where Chats draws them (`features/sidebar/ui/AppSidebar.tsx`, `ShellRail.tsx`);
- `features/agents/space/MindSpace.tsx` (the head's live dot);
- the flag-off comparison tests (`desktop/tests/e2e/**`).

**Decisions:**
1. **On Chats, a relay that refuses sign-in shows the connection card.** Today the rail goes blank on
   `#/messages/new` and `#/channels/<id>`, while Activity and Agents show the card at once (WP-15b's finding; tests
   `luca/shell-status.spec.ts:290` and `:990`, evidence in the scratchpad's `evidence/status-card-missing-on-chats-auth-error.png`).
   The status cards sit at the foot of the rail in every place, Chats included, whatever the rail's rows are doing.
2. **A mind's head shows its live dot for "talking" as well as "working",** both being live (the same breathing dot as
   Side conversations, still under Reduce Motion).
3. **The flag-off comparisons fix the page clock** (Playwright's `page.clock`) on both builds, so a message time can't
   differ by a minute between two shots. Fix every flag-off comparison spec that compares a view with times in it.

**Checks JSON keys:** `chats_status_card`, `talking_dot`, `frozen_clock_specs`, `gates`.

## WP-22 · The final fixes (2026-10-26, Claude's design, from the reports and screenshots of WP-16 and WP-17)

**Files in scope:**
- `features/settings/ui/SettingsPanels.tsx` (Appearance's theme grid), and wherever WP-17 draws a panel's own header as a
  group label (`SettingsSectionHeader.tsx`, `SettingsOptionGroup.tsx`, `app/shell/shell-settings.css`);
- Settings > Agents' detail tabs (`features/settings/ui/SettingsAgentsPanel.tsx` and the tabs it draws);
- `features/sidebar/ui/MoreUnreadButton.tsx`;
- `app/shell/ShellPlaces.tsx` (only its "two columns" comment and focus hand-over);
- `features/agents/ui/AgentDefaultsEditor.tsx` (one label).

Not in scope: `AppSidebar.tsx` and `ShellRail.tsx` (WP-21 is building there).

**Decisions** (all under `shell-frame`; flag off unchanged):
1. **Appearance's theme grid flows on the page.** No inner scroll box (`max-h-[430px] overflow-y-auto`) and no fade:
   every theme shows with its name in every mode, and the page scrolls (WP-17 d1: sections lose their boxes). Today the
   third row's names are cut off in both modes.
2. **A group label that only repeats the section's title goes** ("APPEARANCE" under the "Appearance" title): the same
   rule as WP-19 d6 for eyebrows. Its description stays, under the title. A group label that says something else stays.
   Check every section.
3. **Settings > Agents: the detail's tabs all fit at 640** ("Advanced" is cut off today). They fit, or wrap to a second
   line; none hidden, no sideways scroll.
4. **The rail's "more unread" pill says what it counts.** It counts conversations out of view, but it reads
   "N new messages", the conversation pill's words. Under the frame it reads "N unread", and the arrow says above or
   below. The conversation's own pill keeps its words.
5. **`ShellPlaces.tsx`:** remove the comment and the focus hand-over for "two columns", which are moot since WP-17 made
   one column, after checking nothing else uses the hand-over.
6. **"Luca managed" becomes "Polyphonic runtime"** in Defaults' runtime picker (`AgentDefaultsEditor.tsx:140`, the
   `buzz-agent` runtime): the words the Agents library already uses (`agentLibraryViewModel.ts:112`). Luca is the
   companion, not the app.

**Verification:**
- Playwright headless, 1440 × 900 and 800 × 500, dark and light, flag on.
- One measurement or screenshot per decision.
- Flag-off views of Appearance, Settings > Agents, Defaults, and a rail showing the more-unread pill, identical by hash to
  the base on non-blank shots.
- Gates: tsc, biome on changed files, px-text, the unit suite.

**Checks JSON keys:** `d1` to `d6`, `flag_off_identical`, `gates`.

**Added from the final flows re-check** (2026-10-26, `~/.claude/plans/polyphonic-shell-build/final-review-flows/`):
7. **A mind's Notebook shows the proposals it asked.** Luca's proposal "Update the release notes for beta 7" is in the
   room and in Needs you, but not in Luca's Notebook, while Atlas's and Wren's asks do show in theirs. Every ask a mind
   makes (permission, question, proposal) appears in its Notebook, answered in place as in Needs you. Fix it outside
   `MindSpace.tsx` (WP-21 is there): in `MindNotebook.tsx`, `mindStream.ts` or the asks' shared source.
8. **The room's Change… form shows whole.** WP-16 capped the room's pending stack at the fold's reach, so the opened Run
   task form is cut off inside a small scroll box at 1440 × 900 (`final-review-flows/shots/r2-room-change.png`). The
   stack may grow to the room's own height above the composer, never past the lip; it scrolls only beyond that, and
   opening the form brings it into view, whole wherever it fits (at 1440 × 900 it does).
9. **Quick Chat never covers the details card.** At 800 × 500 the details card's last card (Luca's instructions)
   touches the Quick Chat button. The right card keeps the same bottom-right safe area as the place cards (WP-09b
   Decided 4: one rule for all places).

**Checks JSON keys for the additions:** `d7`, `d8`, `d9`.

**Changed after the final design re-check** (2026-10-26, `~/.claude/plans/polyphonic-shell-build/final-review-design/`,
its `shots-r2/` and `measures-r2/`):
- Decided 3 (the Agents detail's tabs) moves to WP-24, which takes the whole of Settings > Agents.
- Decided 8 (the room's Change… form) moves to WP-23, which takes the whole of the room's asks.
- 10. **The default runtime picker reads by day.** Settings > Defaults & permissions > Default runtime
  (`AgentRuntimeTargetSelector.tsx:43-176`, drawn by `OperatorForgeSettingsCard.tsx:119`) hard-codes white text,
  borders and fills: by day its label, all four runtime tiles, "Recommended" and "Use no default runtime" are white
  on paper, about 1.0:1 (`shots-r2/caps-light-defaults.png`). Under the frame it takes the theme's ink tokens and the
  card's own tint and hairline, legible at 4.5:1 or better in both modes, and "Recommended" is the shared Fragment Mono
  label. Check key `d10`.

## WP-23 · The room's asks, in the page (2026-10-26, Claude's design, from the final design re-check 2 and 3, the final flows re-check 2 and 3, and WP-22 Decided 8)

**Why.**
- In a room, the asks float over the conversation. The expanded "Current work" shelf (`conversationAgentActivityShelf.css:37-53`) floats above the timeline at 98% opacity, capped at 40% of the window's height and held 54 above its row.
  - At 1440 × 900 its 190-tall panel covers alice's latest message, its time, its four reactions and the artifact row.
  - At 800 × 500 the permission starts at y −67 and its Deny and Once sit under the lip. No message in the room shows.
- The two asks in one room wear two containers:
  - the permission in a bordered floating panel (1 px strong border, radius 16) under "Current work";
  - the proposal in a borderless raised plate (radius 16, the same shadow);
  - a "Permission needed ⌄" row between them.
  Needs you and the Notebook draw both as flat rows.
- The Change… form is cut off inside a small scroll box at 1440 × 900: WP-16's cap
  (`final-review-flows/shots/r2-room-change.png`).
- In a side conversation's thread view, "Jump to latest" sits about 17 px across the bottom of a work card.

Evidence: `final-review-design/shots-r2/1440-dark-black-chats-general.jpg`, `800-dark-black-chats-general.jpg`,
`room-asks-dark.jpg`, `room-asks-light.jpg`.

**Files in scope:**
- the room's stack above the message box:
  - `features/channels/ui/ChannelPane.tsx` (the pending stack and its fold);
  - `ConversationAgentActivityStrip.tsx`, `conversationAgentActivityShelf.css` and `.ts`;
- the room's drawing of the asks:
  - `ManagedPermissionCard.tsx`;
  - `capabilities/ui/ManagedInputCard.tsx`;
  - `RuntimeTaskProposalConfirmation.tsx` and `RuntimeTaskConfirmationCard.tsx`;
- the "Jump to latest" pills' position under the frame: `messages/ui/MessageTimeline.tsx` and `MessageThreadPanel.tsx`.

Not in scope:
- the ask rows' shared data and words (`PlaceAskRow.tsx`, `ManagedAsks.tsx`), Needs you and the Notebook (WP-22 is in
  `MindNotebook.tsx`);
- Settings (WP-22, WP-24);
- the files WP-25 lists.

**Decisions** (under `shell-frame`; flag off unchanged):
1. **One stack, in the page, above the message box.** A room's asks and its current work are one stack between the
   timeline and the composer. The timeline ends above it, so nothing is ever drawn over a message, and the newest
   message stays in view as the stack comes, goes and grows (the timeline keeps its bottom anchor). The stack never
   rises above the card's top or under the lip.
2. **One material, one label.**
   - Every item in the stack is a flat row on the card, as Needs you draws it: a permission, a question, a proposal, a
     piece of work running or done. No border, no raised plate, no shadow, rows apart by the page's own rhythm.
   - The stack has one Fragment Mono label: "Needs you" while it holds asks (the Activity stream's own words), "Current
     work" while it holds only work. Work rows under asks need no label of their own.
   - Folded, the stack is one line: "Needs you · 2 · Show".
3. **Its height.**
   - At rest the stack takes at most 40% of the conversation's height (from the lip to the message box), and scrolls
     inside beyond that.
   - Where that can't hold one whole ask, it folds to its one line.
   - While a form is open (a proposal's Change…, a question's Answer), the stack may take the conversation's whole height
     above the message box, so the form shows whole wherever it fits (at 1440 × 900 it does). Opening the form brings it
     into view; closing it returns the stack to rest.
4. **"Jump to latest" sits above the stack,** in the timeline's own corner, never across a row or a card.

**Verification** (Playwright headless, 1440 × 900 and 800 × 500, dark and light, flag on, a room holding a permission, a
proposal, a question and a finished piece of work):
- bounding boxes: no stack pixel over any message;
- the stack's top below the card's top;
- its rest height at or under 40% of the conversation;
- the Change… form whole at 1440 × 900;
- "Jump to latest" above the stack, in the room and in a side conversation's thread;
- every answer still works in place (Deny, Once, Always where offered, Run, Not now, Change…, a question's choices,
  Send, Skip);
- the flag-off room identical by hash to the base;
- the gates.

**Checks JSON keys:** `d1` to `d4`, `answers_in_place`, `flag_off_identical`, `gates`.

## WP-24 · Settings > Agents points to each mind's own space (2026-10-26, Claude's design, from the final design re-check 5 and M7, and WP-22 Decided 3)

**Why.**
- Settings > Agents is a second Agents place: its own roster of nine agents with search and filters, and its own detail
  with General, Runtime, Capabilities and Advanced tabs. The tabs are cut off at 640.
- Its state words ("Ready", "Idle", "Offline", a "READY" label in system-font capitals at `SettingsAgentsPanel.tsx:304`)
  disagree with the Agents place, where Atlas is talking and Wren is resting.
- "Open in Agent Library" (`:319`) names a place that no longer exists.
- Every mind's settings live in its own space now (WP-13: Notebook, Self, Settings).

Evidence: `final-review-design/shots-r2gpu/settings-dark-agents.jpg`.

**Files in scope:**
- `features/settings/ui/SettingsAgentsPanel.tsx` and the detail components it draws;
- `features/agents/space/MindSettings.tsx`, to receive what moves;
- `features/agents/space/` only as that needs.

Not in scope: WP-22's files (`SettingsPanels.tsx`, `SettingsSectionHeader.tsx`, `SettingsOptionGroup.tsx`,
`shell-settings.css`, `AgentDefaultsEditor.tsx`, `AgentRuntimeTargetSelector.tsx`, `OperatorForgeSettingsCard.tsx`,
`MindNotebook.tsx`, `mindStream.ts`), WP-23's and WP-25's. Leave every button's style as it is: WP-25 makes the quiet
button, and the merge switches yours to it.

**Decisions** (under `shell-frame`; flag off unchanged):
1. **The section lists every mind as the Agents rail does:** its mark, its name and its word from the shared state
   (`features/agents/lib/useMindState.ts`). A row opens that mind's space on its Settings tab.
2. **What is for all agents stays here,** in the page's own rows and labels: the runtimes and their readiness, adding an
   agent, whatever your recon finds that belongs to no one mind.
3. **The second roster's search and filters, its detail and tabs, and "Open in Agent Library" go.**
4. **Map first, lose nothing.**
   - Map every control in the old detail (General, Runtime, Capabilities, Advanced) to its home in the mind's own
     Settings tab, or mark it LOST.
   - Nothing may be LOST. Anything the mind's Settings tab lacks moves there first and works as before, drawn as that
     tab draws (one quiet row per section, "What they can read" inside).
5. **Every small capital label here is the shared Fragment Mono label.**

**Verification:**
- the capability map as a table;
- Playwright headless, 1440 × 900 and 800 × 500, dark and light, flag on: one screenshot or measurement per decision,
  and every moved control used once in a mind's space;
- the flag-off Settings > Agents identical by hash to the base;
- the gates.

**Checks JSON keys:** `d1` to `d5`, `capability_map`, `flag_off_identical`, `gates`.

## WP-25 · One quiet button, and the last small words (2026-10-26, Claude's design, from the final design re-check 4, 6, 8, 9, 10 and M5)

**Files in scope:**
- `shared/ui/button.tsx` (a quiet variant);
- `app/shell/placeRails/GroupCard.tsx`;
- `features/profile/ui/UserProfilePanelAgentSummary.tsx`;
- `features/settings/ui/ProfileSettingsCard.tsx`;
- Security & backup's buttons: if they're in `SettingsPanels.tsx`, only their lines, since WP-22 is editing the theme grid
  in that file;
- the lip's name for a side conversation (`PlaceLipName.tsx`, `ShellLip.tsx`, or wherever WP-09b named a project room);
- `features/agents/lib/useMindState.ts`, and where its words are drawn (`placeRails/placePicks.ts`,
  `features/agents/space/MindSpace.tsx`, `features/pulse/ui/LucaActivityView.tsx`);
- `features/provenance/ui/ProvenanceRow.tsx`;
- `app/AppShell.tsx` (only Settings' preload).

Not in scope: WP-22's, WP-23's and WP-24's files (each listed above). A secondary button in one of those files goes on a
list in your report, for the merge.

**Decisions** (under `shell-frame`; flag off unchanged):
1. **One quiet button.** Today secondary buttons come in four shapes:

   | Shape | Size | Where |
   |---|---|---|
   | plain tint | 26 tall, radius 8, 12.5 px | the asks |
   | outline | 32 tall, radius 10, 12 px | the group's Edit and Add to a room; Settings' Recheck and "Open in Agent Library" |
   | outline | 36 tall, radius 10, 14 px | the profile card's Open their space and Talk |
   | pill | 32 to 34 tall | Settings > Profile's Edit; Security's buttons |

   Under the frame every secondary action is the plain tint:
   - no outline, ink at 8%, deeper on hover, the focus ring kept;
   - on a page or card, Talk's size (30 tall, 13 px, radius 9);
   - in a row, as an answer, the ask's size (26 tall, 12.5 px, radius 8).

   Make it a quiet variant of the shared Button and use it at each source. No blanket overrides.
2. **The lip names a side conversation under its home:** "Luca / Atlas · general", the way a project room reads
   "Tidepool / general" (WP-09b Decided 3). Today the rail lights "Atlas · general" under Luca and the lip says
   "general".
3. **A mind that's off says so.**
   - The shared state gets "off" for a stopped mind. Today Wren is stopped but reads "resting" in the rail and its
     space, while Now says "You can start this resident in Agents".
   - "Off" reads the same in the Agents rail, a mind's head, its profile card and Now.
4. **Signed record's rows keep the time where every list does:** in the right-hand column, not leading the row.
5. **Settings opens at once.** Its code loads when the app is idle, so the first visit never shows a blank card (about
   330 ms on the M4's GPU today).

**Verification:**
- Playwright headless, 1440 × 900 and 800 × 500, dark and light, flag on, one measurement per decision: every quiet button's
  box and computed style, the lip's text, the state word in all four places, the row's columns, and the first Settings
  paint;
- flag-off views identical by hash to the base;
- the gates.

**Checks JSON keys:** `d1` to `d5`, `buttons_left_for_the_merge`, `flag_off_identical`, `gates`.

## WP-26 · The last pass (2026-10-26, Claude's design, from the reports of WP-22 to WP-25)

**Files in scope:**
- buttons only:
  - `features/agents/space/MindSettings.tsx` (its seven outline buttons);
  - `features/settings/ui/SettingsAgentsMinds.tsx` (Add agent);
  - `features/settings/ui/OperatorForgeSettingsCard.tsx` (`:346`, and "Choose Hermes…" at `:361`);
- the right card's panels and their safe area:
  - `app/shell/shell-finish.css` (WP-22's Decided 9 rule);
  - `features/channels/ui/ConversationContextPanel.tsx`;
  - the thread panel and any other right-card panel;
- `app/shell/shell-activity.css` (only its unused rules);
- `routes/agents.tsx`, and `MindSettings.tsx`, for decision 4.

**Decisions** (under `shell-frame`; flag off unchanged):
1. **The last secondary buttons are WP-25's quiet button**: on a page or card at Talk's size, in a row at the ask's.
   Every one in the files above.
2. **The right card keeps clear of Quick Chat at its foot, not down its side.**
   - WP-22's Decided 9 reserves a 68 px right gutter down the details card's whole height. That narrows its text by about
     52 px at every size.
   - Instead, every right-card panel (details, a thread, members, a profile) ends with room for the button below its
     last item, so the end of its content scrolls clear of it, and nothing gives up width.
   - A thread's reply box is content too: it never sits under the button.
   - Measure at 800 × 500 and 1440 × 900.
3. **Rules nothing uses go.** WP-23 left three in `shell-activity.css`: `.luca-pending-held` (with its `:hover` and
   `-show`), `.luca-ask-stack`, and `.luca-work-tray__permissions .luca-ask-list`. Remove each only after a search of
   the code and the built CSS shows nothing still uses it.
4. **A way in that names a row of a mind's Settings opens that row.** Today an address that names a mind's runtime or
   its access lands on the mind's Settings tab but not on the row. It should open, in view and lit, the row it names
   (WP-24's open question). Do it by widening the route's `at`.

**Verification:**
- Playwright headless, 1440 × 900 and 800 × 500, dark and light, flag on: every changed button's box and style; the right
  card's last item and a thread's reply box clear of the button at both sizes; the width of the details card's text
  before and after; the row a way in opens;
- flag-off views identical by hash to the base (`http://127.0.0.1:4334/`);
- the gates.

**Checks JSON keys:** `d1` to `d4`, `flag_off_identical`, `gates`.

## WP-27 · Three from the final flows check (2026-10-26, Claude's design, from `final-review-flows/` round three)

**Files in scope:**
- the room's stack (`ConversationRoomStack.tsx`, `conversationAgentActivityShelf.*`, `ChannelPane.tsx`) and the
  timeline's bottom anchor (`messages/ui/MessageTimeline.tsx`);
- the right-hand profile card's state word (`features/profile/ui/UserProfilePanel*.tsx`).

**Decisions** (under `shell-frame`; flag off unchanged):
1. **A room opens on its newest message, whatever the stack holds.**
   - Today, in #general at 1440 × 900 with three asks, the stack covers y 440 to 744. The last messages sit under it
     (y 522 to 541): the list stays at scrollTop 0 of 157 until you scroll. At 800 × 500 the folded line covers the
     last message.
   - The timeline keeps its bottom anchor when the stack arrives, grows or folds after the first paint.
   - Measure: the newest message's bottom is at or above the stack's top at load, with no scroll, in Chromium and
     WebKit, at 1440 × 900 with three asks and at 800 × 500, folded and shown.
2. **An open form never leaves the window.**
   - Today, at 800 × 500, the Change… form's Cancel and Run sit at y 543 to 569, below the window.
   - The stack with an open form is bounded by the room's height above the message box: never past the window's
     bottom, never above the card's top. The form scrolls inside it and opens with its head in view, and its actions
     are reachable by scrolling the stack. At 1440 × 900 it still shows whole.
3. **The profile card says the shared word.** With Wren stopped, the rail, the head, Now and Settings > Agents read
   "off", but the right-hand profile card reads "Resident · Unavailable". It takes its word from the shared state
   (`useMindState`), like the others.

**Verification:** Chromium and WebKit (Playwright's webkit), 1440 × 900 and 800 × 500, dark and light, one measurement
each; flag-off views identical by hash to the base (`http://127.0.0.1:4300/`, the pre-shell build); the gates.

**Checks JSON keys:** `d1` to `d3`, `flag_off_identical`, `gates`.
