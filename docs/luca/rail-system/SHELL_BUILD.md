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

**Where you work.**
- Repo `/Users/rileycoyote/Documents/Repositories/luca-agent-network-v1` (a public repository). The integration branch
  is `claude/native-rail-glass`, local only.
- Your worktree and branch are named in your dispatch; they already exist, with `node_modules` linked. Work only there.
- Never `git stash`, never merge, never push, never rebase another branch, never touch another worktree. Commit on your
  branch with explicit paths (`git add <path>`; never `git add .`, `-A` or `-u`). Activate the toolchain first in every
  shell: `. ./bin/activate-hermit` from the worktree's root. The pre-commit hook formats; let it.

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
- `pnpm run check:px-text` must pass;
- no new `unwrap()` or `expect()` in Rust production paths;
- module-level caches must reset in `resetCommunityState()`;
- `React.memo` needs stable props.

**The flag.** Everything the shell changes is behind the preview feature `shell-frame` (WP-01 adds it), off by default
until WP-09. With the flag off, the app must look and behave exactly as it does on the integration branch. Prove it
with screenshots compared by hash against the base build Claude serves at `http://127.0.0.1:4300` (the integration
branch as your branch started; read-only, never stop it).

**How to prove it.**
- Build: `pnpm build:e2e` in `desktop/`.
- Serve: `python3 -m http.server <your port> -d dist`, and leave it running.
- Tests: `LUCA_PLAYWRIGHT_PORT=<your port> pnpm exec playwright test <spec> --project=smoke`.
- The app renders in a browser only with the mock bridge: `installMockBridge` from `desktop/tests/helpers/bridge.ts`.
  Seed the flag before installing it: `page.addInitScript` setting `localStorage["buzz-feature-overrides-v1"]` to
  `{"shell-frame": true}` (check `desktop/src/shared/features/store.ts` for the exact key).
- Wait for animations (`desktop/tests/helpers/animations.ts`) before every screenshot.
- Screenshots: `deviceScaleFactor: 2`, saved in your scratch folder, named for what they show. Every hash must be
  unique.
- Measure, don't reason: bounding boxes, colours, contrast. A check you could not run is reported as not run.
- Gates before your last commit, all from `desktop/`: `pnpm exec tsc --noEmit -p tsconfig.json`; `pnpm exec biome
  check` on your changed files; `pnpm run check:px-text`; the unit tests for what you touched (`pnpm test`, or
  targeted); your Playwright spec. Report each with its count.

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
