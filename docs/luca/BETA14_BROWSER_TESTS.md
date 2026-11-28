# Beta.14 browser tests: the true count (WP-57, 2026-11-27)

The desktop browser suite (`desktop/playwright.config.ts`, project `smoke`), run headless on
the release line at `90cba11d8`, every failure run again alone, each sorted by evidence.

## Counts

| | Listed | Passed | Failed | Skipped or not run |
|---|---|---|---|---|
| Base `90cba11d8` | 2046 | 1362 | 644 (634 steady, 9 loose, 1 fixed before its rerun) | 40 |
| End, without the lists below | 1547 | 1452 | 59: 47 named here, 10 loose, 2 now on the lists | 36 |
| Final sweep, joined line `842100973` | 1504 | 1454 | 21: 17 pass alone, 2 now on the lists, 2 loose | 29 |

The 634 steady ones split in two. **446 are old**: they fail the same way at beta.13. **188
are since beta.13**, and 9 of those turned out old too, so the old list holds 455. The beta.13
copy was run with the same server as this line. No test was skipped, given retries or more time.

**The final sweep (Nov 27, 7:27 to 8:01 am)** ran every test outside the lists once, on the
joined line (app code `6e2779c33`), while the Mac was busy with another job (load about 15 on 14
cores). Each file with a failure was then run again alone: 89 passed. What was left:
- Two more for the lists. `luca/f11` "native debug failpoint…" needs the real app built.
  `luca/shell-runtime` "connected 800" fails as its 1440 twin does (the connected-app card is
  gone, 8e4693bfe); the seven tests after it in the same one-after-another group never run.
- Two that still failed alone. Both were settled later the same morning (11:41 to 11:46 am):
  - `luca/quickchat-lens` "a reader stays put…" was **a fault in the app**, not in the test.
    It failed 3 of 3 again at a load of 9. Fixed that night in 7331fe57a: see "Fixed in the
    app since the final sweep" below.
  - `image-attachment-gallery` "hidden spoiler images…" is an old timing edge: it opens a
    picture in the same instant a spoiler is revealed, and the open picture never learns it
    has a neighbour. The reveal and gallery code is unchanged since beta.13. It passed in the
    sweep at 7:28 and 2 of 3 at a load of 9. It belongs on the loose list.

With those named, the rerun below kept 1495 of 2051 tests, and each either passed in the
sweep or passed alone, apart from those two. The two fixes of that night added 14 tests (7 in
`luca/quickchat-lens`, 7 in the new `luca/ink-plain-text`), so at `a4b5a8608` the suite lists
2065 and the rerun keeps 1509. The suite has not been swept again on that commit yet.

## The old ones (455, untouched)

| What changed in the app | Tests | Commit |
|---|---|---|
| "/" opens Home, not the inbox | 33 | f858fa596 |
| The profile panel's test id is on the page twice | 19 | 1e72ef328 |
| The sidebar's sections were replaced by the rail | 16 | 3682db66a |
| The agents library is no longer mounted | 9 | fb3c581fd, b3778c8d1 |
| The members bar left the conversation header | 1 | db684d2e8 |
| Each waits for a control that is gone (identity, project, workflow and channel controls…) | 377 | at beta.13 too |

## Since beta.13 (188): where each one ended

| State | Tests | What |
|---|---|---|
| Fixed | 87 | below |
| Needs a second build | 38 | table below; no change made |
| Known in the app | 1 | heading below |
| Waiting on Riley's call | 5 | heading below |
| Removed | 1 | `luca/a2a-drawer-projection.spec.ts`: the drawer no longer opens itself for an exchange (740409ae7) |
| Old after all | 9 | `config-bridge-screenshots` ×5, `channel-sort` 03, `identity-archive-hide` members, `thread-unread` 04 and 13 |
| Left with a cause | 47 | below |

**Fixed (87), commits on `claude/wp57-old-tests`:**
- The rail shows only agents the owner chose (468075227): a helper chooses the specs' agents
  (`tests/helpers/railAgents.ts`); the rail heading is Agents. f162fae2d.
- Design changes since beta.13 (9b51cc6e2): Instrument Sans again (c0fb16ae4); ten places with
  Home (8e4693bfe) and Mnemos (77f4258c3); Settings opens on Appearance and the composer
  sphere is opt-in (67a93cba3); an agent's sessions unfold in the rail (6dbb49a64); new frames
  are Glass (fd8b9b8a6); starters Luca, Honey, Bumble (f692daedb), all three awake (740409ae7).
- What the app does on purpose (b3c9a456f): Living Ink paints settled lines slowly and boundedly
  (50c6cfaa6), never when hidden or still; the owner's own visit notes stay out of the timeline
  (740409ae7); the effort menu closes before typing; the shelf folds only under 34rem.
- Reduce Motion is set through the context, so specs in an empty chat are not starved by the
  film on a software GPU (44e26e22e). Two earlier fixes: 23809b108, 510b48e7d.

**Left with a cause (47; the final sweep added one, and seven that never run).** Each needs a
real rewrite or a decision, not a small fix:
- 12 · The Claude and Codex app page is now the harness workspace (8e4693bfe), so the
  connected-app card is gone: `shell-activity`, `shell-brain`, `shell-huddle`, `shell-rail`,
  `shell-runtime`, `shell-place-rails` ×3, `shell-rail-wp34`, `shell-settings-agents`,
  `shell-walkthrough` ×2.
- 12 · Exchange and task rows in the rail need the native inbox's say-so (6aee43288), which the
  mock never gives: `shell-activity` ×4, `shell-one-state` ×5, `shell-rail-wp34` ×2,
  `shell-app-task`.
- 6 · An agent's chats column is gone (6dbb49a64): `nav-state-grid` ×5; `chat-agent-mark`
  "sphere stays on the composer" (also needs the sphere opt-in).
- 7 · Study measurements that changed on purpose in early November (traced on the joined line):
  the message box is glass at 70% of its approved fill, where the tests expect it solid
  (ce7ffa30f, eaee02830): `composer-refinement` ×4. The main card's lit top rim was removed
  (2a5be8a75): `shell-frame` "Black, dark", `shell-glass` "page under glass". The day label is
  plain glass with no cast shadow (ce7ffa30f): `shell-light` "Paper by day".
- 3 · `shell-agent-place`: Settings now also lists Appearance's colour button (67a93cba3) ×2; the
  Inbox button (6aee43288) wraps the status line.
- 2 · `exchange-strip` "counted owner return": the receipt opens the task window, so its
  history panel is out of reach (740409ae7, 6aee43288).
- 3 · `shell-first-screen-asks` d2: the room's ask became the temporary surface (02226ec1c), on
  purpose with fuller words ("Allow once") and its answers on the right; Needs you keeps "Once".
- 2 · `shell-first-screen-asks` "full-card film follows agent switches": the film is the
  subject and needs a real GPU; on this software GPU it starves the page.

**Not checked on a real GPU:** the question card over the empty-chat film (`managed-input-card`,
run with Reduce Motion) and the moving film itself. The coordinator will look in the real app.

## Needs a second build (38)

Each compares this build with an older one on another port: build that commit (`pnpm build:e2e`
in a worktree there), serve it with `python3 desktop/scripts/serve-dist.py <port> <dist>`, set the variable.

Each variable is `WP<n>_BASE_URL` unless named; ? means the base commit was not recorded.

| Port | Spec (variable, base commit) |
|---|---|
| 4300 | `shell-glass` ×3 (WP07A, c43649156); `shell-glass-themes` ×4 (WP08D, ?); `shell-place-rails` (WP10, 2e3c04dd1); `shell-mind-space` (WP13, ?); `shell-activity` (WP14, ?); `shell-one-state` (WP18, af41a1604); `shell-motion-keys` ×10 (WP20 and `WP20_FILM_BASE_URL`, ea78fb0a3); `shell-pages` (WP33, ?); `shell-rail-wp34` (WP34) and `shell-project-rooms` (`PROJECT_ROOMS_BASE_URL`), 2cb995202; `shell-app-task` (WP35, d2d1d9d5c); `shell-brain` (WP38, f72b1cbee); `shell-agents-pages` (WP40, ea3576004) |
| 4320 | `shell-first-screen-asks` (WP16, 32b61d4e7) |
| 4330 | `shell-room-asks` (WP23, 605ccf500); `shell-settings-agents` (WP24, ac8084c61) |
| 4334 | `shell-room-flows` (WP27, cfb442813); `shell-top-edge` (WP29, 91f962074) |
| 4419 | `luca/living-ink-field` ×6: this build, plus the shell lab (`scripts/build-shell-lab.mjs`) at `/_shell-lab` |

Also outside a browser run: `luca/f11` "real Tauri recovers…" and "native debug failpoint…"
launch the built native app.

## Loose (pass alone)

Base: `image-attachment-gallery` copy image; `blackout-messaging-controls`; `f15` safe creation;
`quickchat-lens` reader (not loose after all: the mini chat fault, fixed in 7331fe57a);
`runtime-task-card` ×4 (follow-up, failed, interrupted, quiet notice);
`shell-top-edge` stuck day. End, under load: `agent-rail` Quick Chat; `chat-agent-mark` visible
sphere; `exchange-strip` jump to latest; `operator-forge` retained group; `runtime-task-card`
Run waits for a folder; `shell-settings` review's fixes; `task-motion` light; `popout-shell`
opening choices; `video-attachment` right-click menus; `continuous-motion` video glow (below).
Final sweep: `image-attachment-gallery` hidden spoiler images.

## Known in the app

**The glow behind a looping video, under Reduce Motion.**
- What a person sees: with Reduce Motion on, the soft light around a looping video changes a
  little each time the video starts over, instead of resting.
- Cause: the glow repaints on a seek or "ready to play" even under Reduce Motion, and a
  looping video sends both at every wrap.
- Commit: 150bebb86 (`videoGlowScheduler.ts`). Small; ships as is.
- By hand: Reduce Motion on in macOS, open a conversation with a short looping video, and
  watch its glow at the moment it loops. Test: `luca/continuous-motion`, left as it is.

## Fixed in the app since the final sweep

**The mini chat stopped following a reply that grew fast (found November 27, fixed that
night in 7331fe57a; Riley: "fix both").**
- What a person saw: the mini chat is at the newest message and a reply is streaming in.
  Part way through, it stops scrolling along, the "Newest message" arrow comes back, and the
  rest of the reply arrives out of sight. Worse the busier the Mac was.
- Cause: when the mini chat scrolled itself to the end, the browser reported that scroll one
  frame later. If the reply had grown again by then, the report read as "the reader moved
  away" (`useQuickChatTranscript.ts` set `following` from the distance to the end on every
  scroll event, its own included). New in beta.14 (e52aaba46, October 31).
- The fix: following turns on whenever the view is at the end, and off only when the view
  moves toward older messages. No timers, no skipped events.
- Proof before, in the browser build at `842100973` (a throwaway spec): "Newest" and growth
  in the same moment, 216 px short with the arrow back; growth in two frames running, 56 px
  short; a line every 16 ms fell behind at line 4, every 50 ms at line 17. (Load 16.)
- Proof after, at `a4b5a8608`: the same throwaway spec reads 0 px and no arrow in every case
  (load 35). Seven new tests in `luca/quickchat-lens`, three of which fail on `cb7c0fd0b`:
  the same-moment case, two frames running, a line every 16 ms with the arrow never
  appearing, the reader getting away mid-reply by real wheel and by keys and staying put,
  part-way down not resuming, reopening at a saved place, and content removed under a
  following reader. The old test "a reader stays put while content grows, then newest
  resumes following" is unchanged and passes: the whole file 20 times over, 220 of 220, at
  a load of 7 to 12.
- Not run: WebKit, the app's own engine (the matching Playwright build, 2287, is not on this
  Mac). Left: content that shrinks and grows again inside one frame can still read as the
  reader moving up; found by reading, never seen, and there before the fix.

**Coloured phrases showed as raw code in plain-text places (found November 27, fixed that
night in a4b5a8608).** The new `luca/ink-plain-text` has 7 tests; 6 fail on `cb7c0fd0b`
(Activity, search, the quoted line, notifications, copy, reminders). `BETA14_RELEASE.md`,
"Found in the hands-on pass", has the places and what is left.

## Waiting on Riley's call

An agent you agree to in chat, or tick in onboarding, does not appear in the rail.
- Cause: since 468075227 the rail shows only agents the owner chose; creating one does not choose it.
- What a person sees: you say yes and nothing new shows under Agents until you message it.
  If its bring-up fails, there is no row to say so.
- Tests, left exactly as they are: `luca/luca-creates-resident` "a resident the owner agreed
  to…" and "a bring-up that fails…"; `luca/polyphonic-production-onboarding-v3` "one agent
  is ticked…" and "an import that fails…". With them, "an ordinary running resident's row…"
  shares their setup, which waits for Luca in the rail.

## Rerun

Every test outside the lists above, by name (`desktop/tests/e2e/beta14-rerun-exclude.txt`). The
file also names the tests left with a cause, so a clean run is no failures; one that fails under
load and passes alone belongs on the loose list. Each name in the file matches exactly one
test.

```sh
cd desktop && export pnpm_config_verify_deps_before_run=false && pnpm exec playwright test \
  --project=smoke --grep-invert "$(grep -v '^#' tests/e2e/beta14-rerun-exclude.txt | paste -sd'|' -)"
```
