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
- Two that still fail alone while the Mac is loaded, on app code that passed them earlier the
  same day: `image-attachment-gallery` "hidden spoiler images…" (passed on this very build at
  7:28) and `luca/quickchat-lens` "a reader stays put…". Both race the page: one opens the
  picture the instant a spoiler is revealed, one expects the mini chat to follow new content
  at once. Run them once more on a quiet Mac before calling the gate closed.

With those named, the rerun below keeps 1495 of 2051 tests, and each either passed in the
sweep or passed alone, apart from those two.

## The cleanup after the release (Nov 27, branch `claude/browser-tests-cleanup`)

Tests only; no app code changed. The suite now lists 1869 tests (2051, less 183 removed, plus one
new test that pins a fault).

- **Removed 183 old tests** (182 test definitions; one made two) of screens the app no longer has: the thread panel, the old sidebar's
  sections (mute, star, sort), the Inbox (off by default), Doctor, workflows, project review, the
  channel intro cards, the old onboarding preview, the hidden shared-compute provider. 19 files
  went whole and left the `smoke` list. Each was checked first: none was the only test of
  something a person can still do.
- **Kept 272 old tests** (below): they are the only tests of things the app still does, reached a
  new way, or it could not be told.
- **Rewrote 50 of the 55 left with a cause**, each checked three times in a row and its whole file
  run (commits on the branch, one per cluster). What each now checks, by cluster:
  - The Claude Code and Codex page is its workspace (8e4693bfe): 17 tests measure the workspace
    where they measured the card. Dropped, with the card: Brain's "Open Brain" link from an
    unreadable session list, and the flat session rows' recorded measures.
  - Exchange rows come from the agent inbox (6aee43288): 13 tests give the mock inbox its say-so
    (`tests/helpers/inbox-rail.ts`). The rail now shows one row per pair of agents ("With Luca"),
    opening the pair's page; one test checks a row stays away when the inbox does not list it. A
    task handed to the app's own session leaves the rail (158129a01).
  - The chats column is gone (6dbb49a64): the grid folds and unfolds an agent's sessions in the
    rail; the sphere is turned on in Settings (67a93cba3); the pixel style is gone (5ce8ac4f8).
  - Measured values changed on purpose (ce7ffa30f, eaee02830, 2a5be8a75): the message box is
    glass at 70% with its 20px blur; the main card's edges must read unlit; the day label has no
    shadow.
  - Settings lists the picture button's shadow (67a93cba3); an exchange's history is read in the
    task window it opens (740409ae7, 6aee43288); the room's ask says "Deny / Allow once" with its
    answers on the right, Needs you keeps "Once" (02226ec1c).
- **The two that raced the page are sound now:**
  - `image-attachment-gallery` "hidden spoiler images…": a revealed picture fades in over 0.2 s,
    and the gallery leaves out a picture it cannot see yet. Opened in the same instant as the
    reveal, the gallery missed it (3 of 3); 50 ms later it was there (3 of 3). The test now waits
    for the picture to show, and its pictures load for real through the app's media proxy
    (port 54321; they never went to localhost:3000). 20 of 20 under load.
  - `luca/quickchat-lens` "a reader stays put…": it grew the reply before the Newest jump had
    landed, which is a real fault (below). It now grows the reply after the jump's own scroll
    event; 10 of 10. A new test pins the fault.

## The old ones (455 at the count; 183 removed, 272 kept)

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

**Left with a cause (47; the final sweep added one, and seven that never run).** Since rewritten,
all but five (see the cleanup above and "Left, with a question"). As counted:
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

## Needs a second build (39)

Each compares this build with an older one on another port: build that commit (`pnpm build:e2e`
in a worktree there), serve it with `python3 desktop/scripts/serve-dist.py <port> <dist>`, set the variable.

Each variable is `WP<n>_BASE_URL` unless named; ? means the base commit was not recorded.

| Port | Spec (variable, base commit) |
|---|---|
| 4300 | `luca/shell-runtime` flag off (`SHELL_BASE_URL`); `shell-glass` ×3 (WP07A, c43649156); `shell-glass-themes` ×4 (WP08D, ?); `shell-place-rails` (WP10, 2e3c04dd1); `shell-mind-space` (WP13, ?); `shell-activity` (WP14, ?); `shell-one-state` (WP18, af41a1604); `shell-motion-keys` ×10 (WP20 and `WP20_FILM_BASE_URL`, ea78fb0a3); `shell-pages` (WP33, ?); `shell-rail-wp34` (WP34) and `shell-project-rooms` (`PROJECT_ROOMS_BASE_URL`), 2cb995202; `shell-app-task` (WP35, d2d1d9d5c); `shell-brain` (WP38, f72b1cbee); `shell-agents-pages` (WP40, ea3576004) |
| 4320 | `shell-first-screen-asks` (WP16, 32b61d4e7) |
| 4330 | `shell-room-asks` (WP23, 605ccf500); `shell-settings-agents` (WP24, ac8084c61) |
| 4334 | `shell-room-flows` (WP27, cfb442813); `shell-top-edge` (WP29, 91f962074) |
| 4419 | `luca/living-ink-field` ×6: this build, plus the shell lab (`scripts/build-shell-lab.mjs`) at `/_shell-lab` |

Also outside a browser run: `luca/f11` "real Tauri recovers…" and "native debug failpoint…"
launch the built native app.

## Loose (pass alone)

Base: `image-attachment-gallery` copy image; `blackout-messaging-controls`; `f15` safe creation;
`quickchat-lens` reader; `runtime-task-card` ×4 (follow-up, failed, interrupted, quiet notice);
`shell-top-edge` stuck day. End, under load: `agent-rail` Quick Chat; `chat-agent-mark` visible
sphere; `exchange-strip` jump to latest; `operator-forge` retained group; `runtime-task-card`
Run waits for a folder; `shell-settings` review's fixes; `task-motion` light; `popout-shell`
opening choices; `video-attachment` right-click menus; `continuous-motion` video glow (below).

## Known in the app (3)

**The glow behind a looping video, under Reduce Motion.**
- What a person sees: with Reduce Motion on, the soft light around a looping video changes a
  little each time the video starts over, instead of resting.
- Cause: the glow repaints on a seek or "ready to play" even under Reduce Motion, and a
  looping video sends both at every wrap.
- Commit: 150bebb86 (`videoGlowScheduler.ts`). Small; ships as is.
- By hand: Reduce Motion on in macOS, open a conversation with a short looping video, and
  watch its glow at the moment it loops. Test: `luca/continuous-motion`, left as it is.

**The mini chat stops following a reply that grows fast.**
- What a person sees: in the mini chat, a reply that streams quickly (a new line every 50 ms or
  faster) can leave the view behind: the reply carries on below and the Newest arrow comes back,
  though the reader never scrolled. Pressing Newest while a reply streams can do the same at
  once. At a line every 100 ms or slower it follows.
- Cause: the mini chat decides whether the reader has left the end from each scroll event, but
  its own jump to the end is reported a frame later. Content that grows in that gap reads as the
  reader scrolling away, so it stops following (`useQuickChatTranscript.ts`, `update`).
- Commit: e52aaba46. Not patched.
- Measured in the browser build: Newest pressed as a piece lands, 3 of 3 stop following; a line
  every 16 or 50 ms, 8 of 8; every 100 or 250 ms, 0 of 8. Not checked in the real app (WebKit).
- Test: `luca/quickchat-lens` "a reply that grows as Newest is pressed is still followed".

**An agent's status line breaks with its dot left hanging.**
- What a person sees: on Luca's own page at 1440 wide, the status reads "Resting ·" with the dot
  at the end of the line, and "Keeping up with Codex and Claude Code" drops to a second line.
- Cause: the Inbox button (6aee43288, `AgentInboxMenu` in the page head) crowds the name column;
  the dot is only dropped at 640px or narrower, and this column is wider. The stylesheet itself
  says the line should wrap "with no dot left hanging".
- Test: `shell-agent-place` "their page: one header, one status, three sections built alike".

## Waiting on Riley's call

An agent you agree to in chat, or tick in onboarding, does not appear in the rail.
- Cause: since 468075227 the rail shows only agents the owner chose; creating one does not choose it.
- What a person sees: you say yes and nothing new shows under Agents until you message it.
  If its bring-up fails, there is no row to say so.
- Tests, left exactly as they are: `luca/luca-creates-resident` "a resident the owner agreed
  to…" and "a bring-up that fails…"; `luca/polyphonic-production-onboarding-v3` "one agent
  is ticked…" and "an import that fails…". With them, "an ordinary running resident's row…"
  shares their setup, which waits for Luca in the rail.

## Left, with a question

- `shell-activity` "landing on an exchange: its message in view, named for you". The rail's pair
  row now opens the pair's page, not the room at the exchange's first message, and no other
  screen lands there in general. **Question:** move the test to Needs you's paused exchange (a
  different waiting stack), or retire it?
- `shell-first-screen-asks` "full-card film follows agent switches" (dark, light). They pass
  unchanged on the Mac's GPU (`LUCA_PLAYWRIGHT_GPU=1`, 2 of 2) and starve the page on the software
  renderer. **Question:** run these two on the GPU as part of the gate?
- Not a test, seen while rewriting: on Claude Code's page the head's button says "New task" and
  starts a task in the workspace, while the rail's + says "New conversation with Claude Code".
  **Question:** should they be the same action again? The tests check each as it is.
- `luca/shell-runtime` "flag off: the column draws exactly the base build" ran for the first time
  and reads `SHELL_BASE_URL`; it joined the second-build list.

## Old, kept (272)

Each is the only test of something the app still does, reached a new way (205), or it could not
be told without a run (67, "unsure" in the file). They fail as at beta.13 and stay on the list.
Most fail at a shared first step, so a few fixes revive many:
- `openNewMessagePage` in `tests/helpers/bridge.ts` clicks the old sidebar's DMs button; the new
  message page is still there (about 20 tests: the DM picker, mentions in a DM).
- Members and room settings are under conversation details now ("Manage participants",
  "Room settings…"): `channel-controls`, most `channels` management tests.
- Old words: "Fizz" is Luca, "Buzz" is Luca, "Attach image" is "Attach files", the author shows a
  name, not "npub1mock...".
- The clipboard tests grant permission for port 4173 only; they fail on any other port.
- `getByLabel('Runtime')` now also matches two message spans: `operator-forge`, `resident-proposals`.
- The profile panel's test id is on the page twice in a split pane.
- Create and edit agent: the Agents page's Add agent, and Settings › defaults.
- `luca/conversation-context` "a folder that moves during send…": not a fault. The message is
  not lost; it moves into the chat as "Not sent · Retry" while the box empties.

**Question:** rewrite these to the new ways in (a few shared fixes, then the rest by file), or
retire the ones whose feature is covered enough elsewhere? Unsure ones to settle by a run:
`conversation-activity-shelf` (the working mark), `overscroll-boundary`, `thread-unread` (the
focus drawer may carry it), the old onboarding pages (reached only through "Start new identity").

## Rerun

Every test outside the lists above, by name (`desktop/tests/e2e/beta14-rerun-exclude.txt`): a
second build, the real app, known in the app, waiting on Riley's call, left with a question, and
the old ones kept. A clean run is no failures; one that fails under load and passes alone belongs
on the loose list. Each name in the file matches exactly one test.

```sh
cd desktop && export pnpm_config_verify_deps_before_run=false && pnpm exec playwright test \
  --project=smoke --grep-invert "$(grep -v '^#' tests/e2e/beta14-rerun-exclude.txt | paste -sd'|' -)"
```
