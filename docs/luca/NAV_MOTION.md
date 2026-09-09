# The rail — how it moves

The navigation is one instrument: the rail (Projects · Agents · Runtimes),
the agent column beside it, the project navigator inside the card, the
edge peek, and the phone sheet. This page is the contract for how those
parts move. Every change to them is judged against it.

## The five rules

1. **The conversation never moves under the pointer.** Panels slide over or
   beside the reading plane; the plane shifts once, at the end, never
   frame by frame. Nothing the owner is reading may reflow while a panel
   is in motion.
2. **One thing moves at a time.** A transition has one subject. When the
   rail collapses with a column open, the rail leaves and the column takes
   its place — that is one motion, not two racing each other.
3. **Motion is a property of the compositor, not the layout.** Panels move
   with `transform` and `opacity`. `width`, `left`, `padding` and `height`
   are not animated in the nav. (Resizing by drag is the one exception, and
   it disables transitions entirely while the pointer is down.)
4. **Durations and curves come from `motion.css`, never inline numbers.**
   instant 120 · fast 180 · standard 240 · drawer 260 (iOS sheet curve) ·
   arrival 500. Standard ease for state changes, drawer ease for surfaces
   that arrive with weight, arrival ease for things being born.
5. **Nothing moves for decoration.** If removing a motion loses no meaning,
   it goes. Hover and pressed states are colour changes at `instant`;
   they are feedback, not choreography.

## The choreography

| Transition | Subject | Property | Duration · ease | What stays still |
|---|---|---|---|---|
| Rail collapse | rail container | `translate` off-screen; the content inset (the gap, the card's lip, the header's clearance) changes once, at the start — the rail still covers that edge, and reveals the settled content as it leaves | standard · standard | the conversation, laid out once |
| Rail expand | rail container | `translate` back in; the inset changes once, at the start, and the rail slides into the space | standard · standard | the conversation, laid out once |
| Edge peek in / out | rail container as overlay | `translateX` + shadow | fast · standard (leave after a 220ms intent delay) | everything — peek is an overlay, never layout |
| Agent column open | column | `opacity` 0→1 and `translateX(−8px)`→0; rail widens with it | fast · arrival | rail rows; the conversation shifts once |
| Agent column close | column | reverse of open | instant · standard | rail rows |
| Collapse with column open | rail then column | rail `translateX` out while the column slides from `left: rail` to `left: 0` — same duration, same curve, so they read as one plane | standard · standard | the column's rows (they move as a block, never relayout) |
| Expand with column open | the reverse | | standard · standard | |
| Project row → navigator | navigator | `opacity` + `translateX(−8px)` in; conversation shifts once | fast · arrival | rail |
| Agent switch (Atlas → Bex) | column contents | crossfade at `instant` | instant · standard | the column frame |
| Chat select | row active state | colour, no motion | 0 (active is instant) | everything |
| Hover / pressed | row | `background-color`, `color` | instant · standard | |
| Unread dot appears / clears | dot | `opacity` | instant · standard | the row |
| Phone sheet open / close | sheet | `translateX` | drawer · drawer | |
| Rail resize by drag | rail | none — transitions off while dragging | — | |

## Reduced motion

`prefers-reduced-motion: reduce` collapses every duration above to 0.
State changes still happen; they happen at once. Breath animations on the
marks stop. Nothing is removed from the UI.

## Interruption

A transition interrupted by its opposite reverses from where it is, at the
same curve, with no snap. Toggling the rail six times in a second must end
in the state of the last toggle, with the DOM attributes agreeing with the
visible state, and no console errors. The peek must not flicker when the
pointer clips the edge on its way somewhere else.

## Focus and keyboard

Opening the agent column moves focus to its first row only when it was
opened from the keyboard; a pointer open leaves focus where it was. Closing
it returns focus to the rail row that opened it. Escape closes an open
column. Every row is reachable by Tab, and its focus state is the
element's own border brightening in place, never a second ring.

## The bar

Measured on the owner's display: zero dropped frames at 120 Hz for every
transition in the table; no single layout pass over 8 ms during a
transition; no long task (over 50 ms) started by a nav interaction; no
forced synchronous layout (reading geometry mid-animation) in nav code.

## Measured baseline — 2026-09-09, branch claude/rail-fold @ 22a1bd620

Instrument: `desktop/scripts/_nav-trace.mjs` (headless Chromium, 60 Hz, the
design-lab mock with the 600-message deep-history room open as the reading
plane; a 700 ms window per transition; rAF gaps for frame pacing, CDP
metrics for layout / style work). Chromium is a faithful proxy for *what
work* each transition causes; native WKWebView frame pacing at 120 Hz is a
separate measurement on the owner's display.

| Transition | Dropped frames | Worst gap | Layout passes | Style recalcs | Note |
|---|---|---|---|---|---|
| Idle | 0 | 17 ms | 0 | 0 | clean baseline |
| Rail collapse | 0 | 9 ms | 30 | 63 | one layout **per frame** (width animates) |
| Rail expand | 0 | 16 ms | 29 | 58 | same |
| Column open | **1** | **58 ms** | 29 | 90 | a main-thread hitch at open; 128 ms of script in the window |
| Agent switch | 0 | 9 ms | 1 | 91 | fine |
| Column close | **1** | **50 ms** | 28 | 40 | hitch at close |
| Collapse with column | **1** | **50 ms** | 60 | 99 | two layout-animated properties at once |
| Expand with column | 0 | 9 ms | 30 | 89 | |
| Peek in | 0 | 9 ms | 60 | 91 | |
| Peek out | 0 | 9 ms | 33 | 88 | |
| Project row → navigator | **1** | **42 ms** | 37 | 53 | route change; 39 ms of style recalc |
| Chat select, room (warm) | 0–1 | 25–33 ms | 7–14 | ~100 | a single long frame |
| Chat select, resident's DM (cold) | **2** | **640 ms** | 43 | 150+ | long tasks **591 + 445 ms** |
| Chat select, resident's DM (warm) | **1** | **960 ms** | 14 | 109 | long tasks **554 + 402 ms** — warm, so not chunk loading |

Interruption pass (six rapid toggles of the rail, of the column, of the
rail with a column open, and six peek in/out flicks): every sequence ended
in the state of its last input, DOM attributes agreeing with the visible
state, zero console errors.

### What it says

1. **The rail animates layout.** ~30 layout passes per slide, one per
   frame. Cheap on the mock (≤0.6 ms each); on the native app with a real
   conversation, blur and textured cards each pass is dearer, and at 120 Hz
   the whole frame budget is 8.3 ms. Rule 3 exists for this. Fix: slide the
   rail with `transform`, change the content inset once. (Shared sidebar
   code — coordinate with Codex.)
2. **Opening a resident's direct thread stalls the main thread for about a
   second, warm.** Named by a CPU profile (`scripts/_dm-profile.mjs`): it is
   the companion's three.js scene. On every DM mount a `WebGLRenderer` is
   created and sized (`setSize`, 398 ms self time) and its shaders compiled
   (`getProgramInfoLog`); the rest of the DM view is ~10 ms. Headless
   Chromium renders WebGL in software, so the absolute number is inflated
   there — but the shape is the same on a real GPU: context creation and
   shader compilation, synchronously, on the main thread, on the click the
   column exists for. Fix: one renderer for the app's lifetime (reuse it
   across DMs; three's program cache lives on the renderer), created after
   the first frame of the route transition, not during it; and the mote
   should mount idle, then fade in.
3. **Column open/close drops a frame** (50–58 ms). The click, the sidebar
   re-render (every row wrapped in a context menu) and the width change
   all land in one frame. Fix: render the column's rows in a deferred
   update so the frame that starts the motion has nothing else to do;
   mount row context menus lazily.
4. **The navigator entrance drops a frame** (42 ms) on the route change;
   most of it is style recalculation. Worth a look after 1–3.
5. **Nothing is glitchy.** Interruption is sound. What is missing is
   choreography: the column and the navigator have no entrance or exit,
   the phone sheet uses the stock 500/300 ms ease-in-out rather than the
   house drawer curve, and hover states run at 100 ms rather than the
   instant token.

### Order of work

DM mount stall (2) · rail transform slide (1, with Codex) · column open
deferral and lazy menus (3) · column and navigator entrances, sheet curve,
hover token (5) · navigator recalc (4) · then the state grid and the native
120 Hz pass.

## After A — the companion's renderers persist (2026-09-09, claude/rail-fold)

`mote3d.js` now keeps a document-wide pool of up to four stages (renderer,
canvas, PMREM environment). An element borrows a stage on connect and hands
it back on disconnect; geometries and textures live once
(`mote3dScene.js`); per-instance materials are never disposed, so three's
program cache stays warm; the rail warms one stage at idle, sized to the
companion's box, whenever residents exist; the companion mounts after the
thread is idle and fades in at fast · arrival; reduced motion parks the loop
live; a lost context is re-borrowed; the pointer listener exists only while
a companion is live.

| Transition | Before | After A |
|---|---|---|
| Chat select, resident's DM (warm) | 1 dropped · 960 ms · long tasks 554 + 402 | 1 dropped · 33 ms · none — the same frame as a room |
| Chat select, resident's DM (cold, from deep-history) | 2 dropped · 640 ms · 591 + 445 | 3 dropped · 525 ms · one task, the route out of the 600-message room; three.js 18 ms in the profile |
| Warm DM open, long-task total (gate: `tests/e2e/dm-open.perf.ts`) | — | 0 ms, three runs of three opens |
| DM open, three.js self time (`scripts/_dm-profile.mjs`) | ~1 s (`setSize` 398 ms, shader compile) | warm 19 ms · cold after warm-up 11 ms |

What remains on the cold row is not the companion: leaving a 600-message
room is one native task (unmount, layout, GC). Noted for the timeline;
outside the nav. `tests/e2e/luca/resident-mote.spec.ts` pins the pool's
behaviour: the fade, the same stage across opens, a DOM move, reduced
motion.

## After C — the column's frame (2026-09-09, claude/rail-fold)

Two more instruments, because window totals could not say which frame
dropped or why: `scripts/_nav-profile.mjs <scenario>` (a CPU profile plus
the engine's layout / style / script totals for one transition) and
`scripts/_nav-frames.mjs <scenario>` (the longest main-thread tasks from a
Chrome trace, broken down into script, style recalc, layout, paint).

What they said, before any change: **in a plain room, opening or closing
the column has no main-thread task over 8 ms.** The 50–58 ms frame in the
baseline table belongs to the room the trace measures in — the 600-message
`deep-history` room inside the Luca project. There, opening the column also
makes the project navigator step aside, the reading plane changes width, and
the timeline re-renders: a 28 ms click task (React 19 ms) and, 60 ms later,
a 42 ms task (React 20 ms, style recalc 19 ms) as the virtualised list
mounts ~3,000 more nodes for the wider pane. Likewise the "navigator
entrance" (finding 4) is the remembered room's 13,000-node timeline
mounting on the route change (React 24 ms, style 20 ms), not the navigator.

What changed:

- `ChannelRouteScreen` watches the column only when the room has a
  navigator to lose (`useAgentColumnOpen(enabled)`): a plain room never
  re-renders for a toggle. The flag it hands the conversation now means "a
  navigator is shown" — plain rooms used to pass `true` and reserve a
  navigator's width in the layout thresholds they never had.
- `ChatRow`, `ProjectRow`, `AgentRail`, `AgentChatsColumn` are memoised, and
  the handlers the shell recreates every render reach them through
  `useStableCallback`; `rootStyle` and the column's items are memoised.
- One context menu per list (`ChatRowContextMenu`), not one Radix root per
  row: the container is the trigger and names the row under the pointer.
- The column paints its frame first and its rows in a deferred render
  (`useDeferredValue(items, [])`).
- The rail's per-resident activity is one pass over the chats
  (`agentActivity`), unit-tested, instead of a filter and a sort per resident.

| Transition (task on the click) | Before C | After C |
|---|---|---|
| Column open, plain room | 7.2 ms (React 3.7 · style 2.7) | 5.0 ms (React 2.2 · style 2.3) |
| Column close, plain room | 6.2 ms (React 3.3 · style 2.4) | 4.9 ms (React 1.7 · style 2.7) |
| Column open, project room (`deep-history`) | 28 ms then 42 ms | 31 ms then 43 ms — the conversation's, unchanged |

Small in the mock's ten-row rail; the structure is what matters with a real
one. The project-room frame is B's: with the inset changing once, the
navigator leaving (+304 px) and the column arriving (−232 px) land as one
+72 px reflow instead of a 304 px jump chased by a 240 ms slide, and the
timeline stops re-rendering per frame. What is left after that is the
timeline's own mount and re-measure cost, outside the nav.

## After D — choreography, focus, keyboard (2026-09-09, claude/rail-fold)

The column now lives under `PanelPresence`, the app's own panel pattern:
it stays mounted through its exit, Escape closes it, and focus returns to
the rail row that opened it. On the desktop it is three layers inside the
sidebar's container. A **stage** clipped to the container, so the pane's
edge is what reveals and swallows the column and nothing of it ever paints
over the conversation (the container itself does not clip, and a closing
column would otherwise overhang the returning plane). A **mover** that
slides by `transform` when the rail is put away or peeked, on the rail's
own duration and curve so the two read as one plane; this replaces the
`left` transition that existed in only one branch and snapped. And the
**column**, which arrives by opacity and an 8 px drift at fast · arrival
and leaves at instant · standard. A keyboard open — the resident's row
activated while it showed its focus state — puts focus on the column's
first control once the rows have landed (and not before the column is
open: while it arrives it is inert); a pointer open leaves focus alone.

The hover finding was misattributed: rows never ran at their own
`duration-100` — the Luca shell's global rule for every button
(`theme.css`, `:is(button, a, [role="button"], [role="tab"])`) set a raw
150 ms and outranked it. That rule now uses the instant token and the
standard ease, and the active row's press is instant where the shell
defines the active state. Focus was already right: the shell's blanket
`:focus-visible` is a 1 px inset outline — the element's own edge
brightening in place — so rows, project rows and the rail's controls now
share one class (`RAIL_ROW_CLASS`, `RAIL_CONTROL_CLASS`) that defers to it
and carries the same edge as a utility for anywhere the shell is not.
Unread dots arrive by opacity at instant (`motion-enter-signal`). The
companion's frame follows the same tokens. Reduced motion: no transitions
and no animations, verified with `getAnimations()`.

Not added: a navigator entrance. The content plane's route transition
(`luca-nav-in`, standard · arrival, with the stamped drift) already carries
the navigator in; a second motion on it would be the two things moving that
rule 2 forbids. The choreography row is corrected above.

Keyboard menus: the browser turns its menu key into a `contextmenu` event
on the focused row — Shift+F10 is not that key on macOS — and the delegated
menu handles the event exactly as the per-row triggers did.

| Transition (task on the click) | After C | After D |
|---|---|---|
| Column open, plain room | 5.0 ms | 6.2 ms (PanelPresence's retained render) |
| Column close, plain room | 4.9 ms | 6.6 ms |

Rail spec: 17 cases, the new four being Escape with focus return, a
pointer open leaving focus alone, compositor-only transitions with
reduced-motion stillness, and the keyboard's menu on a column row.

## After B — the rail slides on the compositor (2026-09-09, claude/rail-fold-b, pending Codex's nod)

Three edits in shared code, proposed in the room as an exact diff first.
`shared/ui/sidebar.tsx`: the gap div has no transition — the content
inset changes once, at the start, in both directions, the instant
`data-collapsible` already flips the card margin and header padding; the
container transitions `width, translate` (Tailwind v4's translate
utilities animate the `translate` property, not `transform`) and leaves
offcanvas by `translate`, never `left`; `motion-reduce:transition-none`
is the rail's first reduced-motion hatch; `width` stays in the list on
purpose, for the column's arrival and the companion peek — overlays whose
relayout is three boxes and never the plane. `features/chat/ui/ChatHeader.tsx`:
the header no longer transitions `margin, padding` — that was the
traffic-light clearance animating, the last per-frame relayout of the
plane; it now switches with the inset, under the rail's cover.
`shared/ui/sheet.tsx`: the phone sheet on the drawer curve (260 ms,
`--motion-ease-drawer`) instead of the stock 500/300 ms ease-in-out.
`MainInsetContext.tsx` needed nothing: its observer runs after layout, and
its per-frame commits disappear with the gap's transition.

| Transition | After D | After B |
|---|---|---|
| Rail collapse | 0 dropped · 9 ms · **30 layouts** | 0 dropped · 9 ms · **1 layout** — one 10 ms task on the click (style 5 · React 3 · layout 1) |
| Rail expand | 0 dropped · 17 ms · **29 layouts** | 0 dropped · 9 ms · **2 layouts** |
| Column close, project room | 1 dropped · 50 ms | 1 dropped · 34 ms |
| Expand with column open | 0 dropped · 9 ms | 0 dropped · 9 ms |
| Column open, project room | 28 ms then 42 ms | 32 ms then 42 ms — unchanged, see below |

Gates in `tests/e2e/nav-motion.perf.ts`: the column opens and closes
without a long task in a plain room and in the 600-message project room;
layout passes per rail slide are reported (1 / 2). The rail spec's new
case pins the container's transition property (no `left`), the gap's
absence of one, the collapsed `translate`, and the sheet's duration and
curve.

What B did not change, honestly: the project-room column open is still
two tasks — the click's commit (React 21 ms) and, 50 ms later, the
conversation's one response to its new width (React 18 ms, style 18 ms:
the timeline re-renders and the virtualised list mounts ~3,000 more nodes
for the wider pane). That response used to be spread across a 240 ms
slide; now it happens once, which is the shape the rules ask for, and what
remains is the timeline's own cost — Codex's virtualiser, outside the nav.
Also learned: a Radix layer that is still leaving (the compose view's
recipient popover, 150 ms) claims the first Escape, as nested controls are
meant to; the Escape case starts from a room.
