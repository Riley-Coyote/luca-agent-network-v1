# The shell

Spec, 2026-10-24, from the shell study (`SHELL_STUDY.md`, the lab at `desktop/src/testing/shellStudy/`) and a reading
of the app's code on `claude/native-rail-glass`. Not built yet. Everything here is measured against this file; change
the file first when a decision changes. The rail's own rules (its rows, sessions and grouping) are `SPEC.md`; this file
is everything around the rail: the frame, the cards, the setting, and what each real surface of the app becomes.

## The sentence

**A thin frame, black or Apple's glass, holding two cards: the rail and the conversation.**

The frame is the window's own edge: a lip across the top and a column of places down the left. Everything you read sits
on cards. Only the frame is ever glass; the cards never are.

## Scope (Riley, 2026-10-24)

Everything here except the tabs ships first: "hold off on tabs and get the rest done and shipped first." Until the
tabs come, the lip carries the open conversation's name (see Tabs). Glass is offered on every Mac: Liquid Glass on
macOS 26 and later, Apple's older frosted glass before that (see Glass).

## The frame, as decided

Measures in points, from the study's code (`ShellStudy.tsx`, `shellStudy.css`), which is the reference for every value
below.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ● ● ●  ▯          ‹ ›  ╭ Luca ╮  Monday plan   Landing page copy     │  the lip, 36
├────┬──────────────┬─┬──╯      ╰──────────────────────────────────────┤
│ ✎  │ Luca         │ │                    TODAY                       │
│ ⌕  │              │ │   Luca                                         │
│    │ PROJECTS   + │ │   Morning. Three things came in overnight…     │
│ ◎  │ Tidepool  ⌄  │ │                                                │
│ ▤  │ │ Landing…   │ │                                                │
│ ⧉  │ AGENTS     + │ │                                                │
│ ∿  │ Wren  ⌄      │ │                                                │
│ ◍  │ │ Monday plan│ │                                                │
│    │ FLEETS     + │ │         ( Message Luca…                   ↑ )  │
│ ⚙  │ Design team  │ │                                                │
│ S  │              │ │                                                │
└────┴──────────────┴─┴────────────────────────────────────────────────┘
 44    the rail's      4  the conversation's card, 6 from the window's right and bottom
       card, 220
```

- **The lip:** the window's top 36. The traffic lights, the rail's toggle, back and forward, and the tabs share one line
  at 22. The lights are inset 16 from the window's corner both ways (their top at 16). The toggle sits at 78. Back and
  forward ride with the conversation card: at `max(card's left + 6, 112)`. Until the tabs come, the open
  conversation's name sits on the card's axis (see Tabs); the tabs, when they come, follow back and forward, 58 further
  on.
- **The places:** a column 44 wide under the lip, its icons centred on the lights' axis (22): New conversation and
  Search; then Conversations, Library, Agents, Activity, Brain; Settings and the avatar at the bottom. Icon tiles 28,
  corners 9, icons 16 at stroke 1.6.
- **The rail's card:** 220 wide, from the places' edge (44), top flush with the lip (36), 6 above the window's bottom.
  Its contents are `SPEC.md`.
- **The conversation's card:** 4 from the rail's card (from the places' edge when the rail is closed), 6 from the
  window's right and bottom, top flush with the lip. It has no header of its own.
- **Corners:** the window 16; the cards 10 (the app's `--radius`, 0.625rem), concentric with the window's corner across
  the 6 between them; the open tab 9 at its top, with soft inward corners of 8 where it meets the card.
- **Smallest window:** the app's minimum stays 800 × 500, which leaves the conversation's card 526 wide with the rail
  open.
- **Type:** two voices, the system face for everything you read and Fragment Mono capitals for the rail's structure.
  Four sizes in the frame: 11 (labels), 13 (the lip, sessions, tabs), 14 (homes), 16 (the conversation). Text is rem
  and follows the app's ⌘+ and ⌘− (75% to 150%); the lip, tabs, places column and rail card stay fixed points, as the
  top chrome is today. Check the tabs, the rail's labels and the places at 75% and 150%.
- **Motion:** the rail opens and closes over 460 ms on `cubic-bezier(0.32, 0.72, 0, 1)` and the conversation's card
  follows its edge; the marks travel on the house springs (`marks.ts`). With Reduce Motion the marks, the rail's card
  and the conversation's card are all instant. (The study misses two of these: the rail card's own width transition
  and the delay before the rail's mark returns are not yet switched off under Reduce Motion.)

### Tabs (later)

**Held until the rest has shipped.** Until then the lip carries the open conversation's name, as the study's "Tabs
off": centred on the conversation card's axis (the axis its messages and composer are centred on), 28 tall at 8 from
the lip's top, no wider than the card less 200, in 13 at weight 550. A session reads as its home (the frame's second
tone, 450), a faint "/", then the session; a home's own conversation reads as the home's name; a place's page reads as
the place's name. The conversation card's top meets the lip with no tab rising from it.

When the tabs come, they are the open conversations, standing on the conversation card's edge:

- Each tab is as wide as its name (64 to 200), 28 tall, 8 from the lip's top. Unselected tabs are words on the frame
  (13, the frame's second tone); hover shows the frame's plate.
- **The open tab is the card's surface rising into the lip:** the same fill and grain, its top corners 9, soft inward
  corners where it meets the card. It slides to the tab you open, and sinks into the card when no conversation is open
  (on a place's page).
- Opening a conversation adds its tab at the end. At most six are kept; the oldest goes first. Closing the open tab
  opens its neighbour. (The app's tab model today replaces the open tab when another conversation opens and has no
  cap; adding a tab and the cap of six are changes to that model, not only a strip to draw.) A tab's close button (18, 6 from its end) shows on hover and keyboard focus, and the name fades
  beneath it.
- Places (Library, Agents, Activity, Brain, Settings) don't make tabs.
- Access: the strip is a `tablist`, each name a `tab` with `aria-selected`, each close button labelled "Close ‹name›";
  the strip is one stop for Tab, with the arrow keys moving between tabs.

### Where you are

- **Solid, never clear glass, and squircle-cornered, never a pill:** a capsule at this size reads cheap (Riley). The
  mark is whichever of two materials reads on the surface beneath it: a **plate** (the page's ink at 7.5%, the app's
  hover and sent-bubble material) or **a piece of the card** (its surface, grain and lit top in dark; paper with its
  shadow in light).
- On a glass frame the places' mark is a piece of the card; on the Black frame, a plate. On the rail's card,
  a plate on the card's own tone, a piece of card on the lighter (dark) or darker (light) rail.
- The open session under a home is lit, not marked (`SPEC.md`).
- The marks slide on the house springs, stretching on the way, and settle on whole pixels.

## The frame setting

**Settings → Appearance**, directly under the existing System / Light / Dark row:

> **Frame** · Black (Paper in light) · Liquid Glass (named Glass on older Macs and on Windows)
> One plain sentence under it: "Solid black, nothing showing through it." / "Solid paper, nothing showing through
> it." / "Liquid Glass, your desktop showing through it." / on older Macs "Glass, your desktop softly blurred behind
> it."

Stored as its own key beside follow-system (`buzz-follow-system`) and exposed on the theme context, because the frame
and the mode are independent. The app's System / Light / Dark row is already the Auto the study pointed to.

### Black (Paper in light)

- The page paints the frame: the palette's floor in dark (black on the default, Vitesse Black), the palette's recess in
  light (Paper's `#eceae6`, a step of shade below its cards at `#fcfbf9`).
- Dark: the cards keep the app's own dark card edge and grain. Light: no outline at all; the cards are told by their
  shade and a soft ink-cast shadow (`0 1px 2px` ink 6%, `0 12px 32px -8px` ink 14%), cast on the floor beneath all the
  cards at once so no card shades its neighbour.

### Glass: Liquid Glass (macOS 26 and later)

- Natively: one sheet of Apple's `NSGlassEffectView` the size of the window, behind the transparent page, with the
  window's corner radius; style Regular; Apple's dark tint (`#00000080`) at night and none by day; its appearance
  follows the palette (dark or light). No native floor (`floor: "none"`): the window is clear, so the glass sees the
  desktop.
- On the page: the root is transparent. A **veil** of our own, drawn by the page in front of the glass, at Soft (22%):
  black at night; by day a wash of the paper's own tone. The frame's words: at night a warm white
  `rgb(250 248 243)` at 96 / 76 / 56%; by day the page's ink at 100 / 84 / 66% (measured on Riley's desktop: the tab
  names read about 7:1).
- The cards: dark, a lit top edge (`0 -0.5px 0` white 12%) and a shadow on the glass (`0 1px 2px` black 25%,
  `0 18px 44px` black 32%); light, no white edges, the ink-cast shadow on the glass beneath all the cards
  (`0 1px 2px` ink 8%, `0 16px 40px -10px` ink 22%).
- The study's other glass choices (Clear, no tint, the None and Deep veils) stay in the lab, not in Settings.
- **Before macOS 26** the same choice draws Apple's older frosted glass instead, automatically (below).
- **Reduce Transparency:** the Liquid Glass frame is drawn as the Black frame, by the page, and returns when the
  setting is turned off. This is new: the study only stands the native glass down and falls to its browser stand-in.
- **The page's floor layers:** in Liquid Glass every layer that paints the floor today clears (the shell layer, the
  huddle shell and its surface, the rail's inset, the floor host), using the list `railGlass.css` already clears for
  `data-luca-native-glass`; the veil is one new layer behind the lip and the cards, above the glass. In the Black
  frame the same layers paint the one floor colour.
- **Full screen** has square window corners: the sheet's radius is sent as 0, and the cards' 6 from the edges stays.
- **When the window isn't the one in use** macOS relaxes the glass (flatter, softer, tint dropped). Nothing public holds
  it, and Riley likes that resting look; the page does nothing about it.

### Glass where Liquid Glass can't be (Riley, 2026-10-24)

Riley: "what if we made the normal glass automatically apply for older macOS machines, so that we only need liquid
glass to work on new macs? and we could use normal glass when we make it windows/browser friendly too".

- **macOS 14 to 25:** the Glass frame is Apple's older frosted material, through the vibrancy path the app already
  ships (`commands/window_vibrancy.rs`, `set_window_vibrancy`: an `NSVisualEffectView` behind the transparent page, the
  same path the glass themes, the pop-out and the onboarding card use today), so older Macs need no new native code.
  It is held in its in-use look (`state: active`), so it never turns flat grey when the window rests. At night it is
  the Heads-up display, Riley's favourite of the frosted materials; by day the material is not chosen yet, to be
  judged in the lab on Riley's Mac (it draws the same there as on an older Mac). The veil, the frame's words and the
  cards are as on Liquid Glass; measure the words on the frosted glass too.
- **Windows** (when the app comes to Windows): the same choice draws Windows' own glass, Mica or Acrylic, through the
  same window-vibrancy library.
- **In a browser** a page can't see the desktop, so there is no glass to show: the frame is Black (Paper in light) and
  the Glass choice isn't offered.
- The choice is named for what it draws: "Liquid Glass" on macOS 26 and later, "Glass" everywhere else.
- Reduce Transparency draws the Black frame everywhere.

## Light and dark

- Light and dark are the app's palettes, as today: the dark default is Vitesse Black, the light one Paper. Daylight
  shows light by shade and shadow, so in light there are no white edges anywhere: the cards, the tab, the sent message
  and the marks are told by their tone and an ink-cast shadow, and a control's chosen option stands up like Send, white
  paper on its track, rather than a darker dip.
- The frame reads the palette's own tokens (floor, recess, surface, ink), so every other palette in Appearance works
  under either frame; all of them stay (Decided, 6).

## What each surface of the app becomes

Today the app has no frame: a full-height rail on the floor at the left and a floating card to its right, with a
transparent 42-point strip of controls floating at the top-left. Each surface below, today and in the shell.

**The window** (`src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`)
- Stays as it is: transparent, Overlay title bar, hidden title, maximised on open, minimum 800 × 500.
- **Traffic lights:** `trafficLightPosition` moves from (16, 23) to (16, 16), so the lights centre on the lip's line,
  in the same change as the lip. Measure them in the real window before calling it done. The first-run hiding and its
  `set_main_window_traffic_lights_hidden` stay.
- **Boot backing:** the opaque native backing (17, 21, 24) shown for the first frames, and `index.html`'s boot paint,
  follow the frame: the floor's colour for Black, none for Liquid Glass. Otherwise Paper and the glass flash dark.
- **Full screen:** the lights go away; the lip's toggle moves to where the first light was, and back, forward and the
  conversation's name keep their places on the card.
- **Without native lights** (another platform, a browser, the end-to-end tests) the toggle sits at the lip's left
  padding, as the strip's no-lights branch does today, and tooltips name Ctrl instead of ⌘.
- **The lights move for the whole window,** so check them on every frameless screen too (setup, loading, errors,
  membership) in the same change.
- **The loading gates** (`AppLoadingGate`, `CommunitySwitchGate`, the boot splash) paint the frame's floor, or stay
  clear under Liquid Glass, and keep their own 44-point drag band.

**The strip at the top** (`src/app/AppTopChrome.tsx`)
- Becomes the lip: drawn at the window's top, full width, 36 tall, shown everywhere including Settings. Its toggle, back
  and forward keep their handlers (`useBackForwardControls`, the sidebar's toggle).
- Goes: the 8-point inset, the 42-point row, the left clearances (80 and 32), `--buzz-top-chrome-height`, and the
  140-point left padding the conversation header takes to dodge the strip.

**Dragging the window** (`src/app/useTauriWindowDrag.ts`, `AppShell.helpers.ts`)
- The empty lip moves the window and its double-click follows the Mac's title-bar setting, as today. The drag band
  shrinks from the top 44 to the lip's 36, so a press on the cards' top edge never moves the window. The per-header
  drag marks become unnecessary.

**The rail** (`features/sidebar/ui/AppSidebar.tsx`, `shared/ui/sidebar.tsx`)
- Becomes the rail's card: a card of its own, beside the conversation's, not a column on the floor. Collapsing closes
  the card and the conversation's card follows its edge. The pinned header (the search field) and the primary menu
  (Library, New conversation, Agents, Activity, Brain, Settings) move to the places column, leaving the card to the
  rail of `SPEC.md`.
- Its width is fixed at 220 (Decided, 2): the drag-resize handle and the stored width
  (`luca-conversation-sidebar-width`) go. Its peek on hover and the narrow-window sheet (under 768) keep working.
- **The runtime sessions column** (`RuntimeSessionsPanel`, 22 rem, opened beside the rail from New conversation)
  becomes a card of its own between the rail's and the conversation's while it is open, 4 from each, and a sheet when
  narrow as today (Decided, 12).
- **The footer's status cards** (connection, relay, background task, update available) stay at the bottom of the rail's
  card. While the rail is closed, a connection problem shows as a dot on the avatar and an available update as a dot on
  Settings (Decided, 4). The profile card goes: its menu is the avatar's.

**The places column** (new)
- New conversation (⌘N), Search (⌘K, opening today's search dialog), Conversations, Library, Agents, Activity, Brain,
  then Settings (⌘,) and the avatar (today's profile menu: presence, status, communities, feedback). Their tooltips
  quote those keys. When the rail is closed, an unread conversation shows as a dot on Conversations.
- Inbox, behind its flag (off by default), takes a place between Library and Agents with its count as a badge when the
  flag is on.
- The content's drift between places (`RAIL_ORDER` in `app/navigationChoreography.ts`) follows the places' order, so
  moving down the column moves the page the same way.
- The column is a `nav`.

**The community strip** (`features/sidebar/ui/CommunityRail.tsx`, shown with more than one community)
- Goes (Decided, 1): communities move into the avatar's menu, which already switches them. The places column keeps the
  window's left edge, and the strip's 32-point clearance in the top chrome goes with it.

**The conversation's card** (`app/BuzzThemeSurfaces.tsx` ContentSurface, `conversation-shell.css`)
- Its spacing comes from two places today: the route surface's margin (8 / 8 / 8 / 1, 8 on the left when the rail is
  closed) for Brain, New conversation and the like, and, for a conversation, the workspace grid's padding of
  `--mn-card-lip` (8) all round with `--mn-card-gap` (4) between panes. Both become: top flush with the lip, 6 right
  and bottom, 4 from the rail's card. `--mn-card-lip` becomes 6 and `--mn-card-gap` stays 4; the grid's left padding
  becomes the gap (4) beside the rail's card.
- **One card for every place:** Library, Agents and Activity stop painting a card of their own (`routeOwnsFloor`) and
  fill the conversation's card like Brain, New conversation and the conversations do.
- **The conversation header** (`features/chat/ui/ChatHeader.tsx`, `features/channels/ui/ChannelScreenHeader.tsx`)
  loses its title, which moves up into the lip (the conversation's name, and later its tab). Its actions (layout; open as window, shown while the pop-out feature is
  on; conversation details) move to the lip's right end, over the card, as quiet icons at the lip's own size, 15 (Decided, 3). Its other
  occupants: the Join button takes the actions' place there in a conversation you haven't joined, as it does today; a
  person's presence avatar in a direct conversation and an ephemeral conversation's badge sit just before the actions;
  the project room picker gives way to the rail's rooms (`SPEC.md`); the header's update indicator becomes the dot on
  Settings (Decided, 4).
- The timeline's top padding is measured from the header today (`--buzz-channel-content-top-padding`): it gets a
  fixed value. The right cards' header row and the Canvas's header keep their own height and no longer line up with a
  conversation title.
- The top veil stays as a short fade under the card's top edge; the composer, the bottom veil and the reading measure
  are unchanged.

**Several conversations side by side** (`features/conversation-workspace/`)
- The workspace's panes (up to four, each its own card) and their tab model (`slot.conversations`, `activeTab`, with
  select and close actions but no strip drawn today) stay as they are while the tabs wait. The lip names the focused
  pane's conversation; each other pane shows its conversation's name quietly at its own top. When the tabs come, the
  lip's tabs are the focused pane's (Decided, 5).

**Projects** (`features/projects/ui/ProjectRoomWorkspace.tsx`)
- As `SPEC.md`: rooms in the rail by default, the 304-point room column an option.

**The right cards** (`shared/layout/RightCardsSlot.tsx`: profile, conversation details, agent session, channel
management, the artifact Canvas)
- Stay cards to the right of the conversation's: 4 from it, 6 from the window's right edge, top flush with the lip,
  the same material, edge and shadow as the other cards (in light, their shadow on the shared floor beneath).
- The replies thread panel shares the slot and keeps its drag handle on its left edge, in the 4 between the cards, and
  its 300 to 720 range. The focus-mode thread drawer stays inside the conversation's card, under the lip.
- Opening the Canvas still grows the window to the right; the 6 at the window's edge holds. The Canvas has three
  widths by window size (focus under 1024, contained to 1600, expanded above); in focus it fills the content area,
  6 from the right, bottom and left and top flush with the lip (today it is inset at the top too). While it is open the
  other right cards are hidden, as today.
- The off-by-default pane deck (`features/panes/`: its 9-point seam is also called a lip, `PaneLip`) is unrelated and
  keeps its name; a lifted pane floats above the frame.

**Settings** (the `/settings` route, `features/settings/ui/SettingsView.tsx`)
- Keeps the frame: the lip (with back and forward) and the places column stay, Settings' place is marked; its section
  list takes the rail card's place and its panels the conversation card's. "Back to app" goes (back, or the
  Conversations place). Escape still closes Settings. The effect that forces the rail open in Settings goes; there the
  lip's toggle closes the section list. The narrow-width header and the loading skeleton are redrawn for the frame.
- **Appearance** (`SettingsPanels.tsx`): System / Light / Dark (as today), then the new Frame row in the place the test
  build's glass controls take today, then the palettes, accent, the Conversation group and the rail's runtime pins (as
  today). `NativeGlassSettings` (the test build's Card, Material, Motion and
  Floor) is retired: the frame setting replaces it.

**The glass themes** (Obsidian, Crystalline: `glass-floor.css`, `window_vibrancy.rs`)
- Today they are the only see-through window, through the older frosted material behind the page. They retire
  (Decided, 7): the Glass frame is the see-through window now. Someone on Obsidian moves to the dark default with the
  Glass frame, someone on Crystalline to Paper with it. Their tiles and their rules in `glass-floor.css` go;
  `window_vibrancy.rs` stays for the pop-out and the onboarding card, which still use it.

**The rail's selection glass** (`RailGlass.tsx` the web pill, `NativeRailGlass.tsx` the native pour)
- Replaced by the solid marks above. The web pill and the native pour retire with the shell; the marks' engine is the
  study's `marks.ts`.

**The native glass** (`src-tauri/native/glass/PolyphonicGlass.swift`, `src-tauri/src/native_glass.rs`, `build.rs`)
- Already understands the frame: one `sheet` (style, tint, appearance), `floor: "none"` and the floor's colour, over the
  message handler `polyphonicGlass`. The real page sends the floor's colour, the card and the chosen row today, but no
  sheet and never `floor: "none"`: a reporter like the study's (`nativeGlass.ts`, `sync` in `ShellStudy.tsx`) sends
  the sheet, the floor and the cards, and stands it all down (`off`) under Reduce Transparency, as the rail's reporter
  already does.
- Today it is compiled only with `LUCA_BUILD_NATIVE_GLASS=1` and attached only with `LUCA_NATIVE_RAIL_GLASS=1` (the
  rail-glass candidate). For the shell it is compiled into the app and attached whenever the frame is Glass on macOS 26
  or later; the candidate script's plist checks and their test change with it. Older Macs take the frosted path above
  and never attach it.
- What the frame doesn't use goes when it lands: the frosted `FrameFrost`, the rail's selection pieces (the stage), and
  the `settings` message's material, motion and grain.
- The window's appearance follows the palette for every palette (today `ThemeProvider` pins it only for the glass
  themes), so the lights and the glass match the page. Check that the main window may call `setTheme` (its capability
  file doesn't list it; the pop-out's does).

**The huddle bar** (`features/huddle/components/HuddleBar.tsx`)
- Today the whole app surface shortens from the bottom by the bar's height, rounding its lower corners, to reveal a
  full-width bar beneath. In the shell the bar rises into the frame beneath the cards (Decided, 8): the cards shorten
  and the bar sits in the frame's band below them, on the glass in Liquid Glass and on the floor in Black.

**Search, dialogs, toasts, the quick chat panel**
- Page layers above the frame, unchanged. The quick chat panel keeps its bottom-right corner (20 from the window's
  right and bottom) above the cards.
- The companion control's halo (`companionAppControl.css`, 3 in from the window's edge with corners of 11) takes the
  window's corner less 3 (13), so it stays concentric; its badge (fixed 14 from the top, centred) moves below the lip,
  clear of the tabs.

**The reconnecting card** (`app/RelayConnectionOverlay.tsx`)
- Shows today only while the rail is closed, 12 from the window's bottom-left, which would sit over the places. It
  retires: with the rail closed a connection problem is the dot on the avatar, and opening the rail shows its card
  (Decided, 4).

**Onboarding** (everything before `AppShell` mounts)
- Stays frameless. The one moment to check in both frames and modes: the floating onboarding card becoming the full
  window with its frame.

**The pop-out window** (`app/popout/PopoutShell.tsx`)
- Not part of the frame: it keeps its own 36-point bar (the same height as the lip by coincidence, not a shared piece)
  and its own frosted glass, and doesn't follow the Frame setting for now (Decided, 9).

**Keyboard**
- As today: ⌘[ and ⌘] back and forward, ⌘K search, ⌘N new conversation, ⌘, Settings, and ⌘S the rail, which stays
  (Decided, 11).
- When the tabs come: ⌃Tab and ⌃⇧Tab move to the next and previous tab, and ⌘W closes the open tab once it's confirmed
  that ⌘W doesn't close the window today (Decided, 10).
- Tab order is the picture's order: the lip (toggle, back, forward, the conversation's actions; later the tabs), the
  places, the rail's card, the conversation's card, the right cards. A closed rail card is inert.

## Decided (Riley, 2026-10-24)

Riley: "Take your recommended pick for all 12 decisions and record them in the spec." The body above follows them;
each is marked there as "Decided, n".

1. **More than one community:** communities move into the avatar's menu, which already switches them; the community
   strip goes (not: a strip left of the places).
2. **The rail card's width:** fixed at 220, the proportion the frame was judged at (not: resizable 220 to 420).
3. **The conversation's actions** (layout, open as window, details): at the lip's right end, over the card, as quiet
   icons at the lip's own size, 15, like its toggle, back and forward (not: a row inside the card's top).
4. **Status cards** (connection, relay, background task, update): at the bottom of the rail's card; while the rail is
   closed, a dot on the avatar for a connection problem and on Settings for an update (not: in the places column).
5. **Panes side by side:** the lip's tabs belong to the focused pane; each other pane shows its conversation's name
   quietly at its own top (not: a strip for every pane). Until the tabs come, the lip names the focused pane's
   conversation.
6. **Other palettes:** all stay, and the frame reads their tokens (not: narrowing to the first-party ones).
7. **Obsidian and Crystalline:** retired; someone on one moves to its base palette (the dark default or Paper) with
   the Glass frame (not: keeping them as themes beside the frame).
8. **The huddle bar:** rises into the frame beneath the cards, on the glass in the Glass frame (not: today's drawer under
   the window).
9. **The pop-out:** keeps its own bar and frosted glass for now (not: following the Frame setting).
10. **Tab keys:** ⌃Tab and ⌃⇧Tab for the next and previous tab, ⌘W to close the open tab once it's confirmed ⌘W doesn't
    close the window (not: none yet). They wait with the tabs.
11. **⌘S for the rail:** stays (not: moving off Save's key).
12. **The runtime sessions column:** a card of its own between the rail's and the conversation's while it is open
    (not: leaving with Runtimes).

## Retired with the shell

`AppTopChrome` and its clearances; `--buzz-top-chrome-height`; the conversation header's dodge; the rail's pinned
header and primary menu (to the places); `RailGlass` and `NativeRailGlass` (to the marks); `NativeGlassSettings`; the
44-point drag band (to the lip's 36); routes painting their own card; the unused `AgentChatsColumn` and its styles; on
the native side, `FrameFrost`, the selection stage and the `settings` knobs; the two glass themes; the community strip;
the rail's resize handle and stored width; the profile card (to the avatar); and the reconnecting overlay (to the
avatar's dot).

## Stale notes to correct with it

- Comments that place the lights at 28 or 10, or the strip at 32 or 52 (`AppTopChrome.tsx`, `chromeLayout.ts`): the
  config's (16, 23) is what runs today.
- `docs/luca/native-rail-glass/PLAN.md` names files that were built under other names (`commands/native_glass.rs`,
  `RailGlass.swift`, `pg_attach`, an Experiments card): the code is `src/native_glass.rs`, `PolyphonicGlass.swift`,
  `polyphonic_glass_attach` and `NativeGlassSettings.tsx`.
- Comments in `PopoutShell.tsx` and `popout.css` name `hide_popout_traffic_lights`; the code calls
  `set_traffic_lights_hidden` (`commands/window_chrome.rs`, used from `popout_window.rs`).

## Steps

One at a time, each shown to Riley in the real app and kept only on his word. Every build is a test candidate on its
own profile in the one shared build cache; the installed Polyphonic.app, his profile, releases and the update feed are
never touched, and nothing is pushed.

1. **The frame, Black, in dark:** the lip (with the conversation's name), the places column, the two cards and the
   marks, page only, behind a flag.
2. **The conversation header dissolving** into the lip: its actions, the Join button, presence and badges.
3. **Settings in the frame.**
4. **Light:** Paper, the shadows on the floor, no outlines.
5. **The Frame setting and Glass:** the setting, the page's reporter, the veil; Liquid Glass compiled in and attached
   on macOS 26 and later; the frosted fallback on older Macs (with the light material chosen by Riley); Reduce
   Transparency.
6. **The rest:** communities in the avatar's menu, the status cards and their dots, the runtime sessions card, the
   glass themes' retirement, the huddle bar in the frame, onboarding's hand-off, full screen.

**Later, after the rest has shipped:** the tabs, with the workspace's tab model (opening adds a tab, at most six), the
other panes' names and the tab keys.

## Done means

- Each rule above holds in the real app, checked with photographs of both frames in both modes: a conversation open; the rail closed; a place's page; Settings → Appearance; a right card open; a huddle; full screen;
  Reduce Transparency; the smallest window.
- The lights sit on the lip's line, measured in the real window.
- `tsc`, biome, the desktop unit tests and the desktop gates pass; `cargo clippy` for the desktop crate when Rust or
  Swift changes.

## Where it lives

- The study, the reference for every value: `desktop/src/testing/shellStudy/` (`ShellStudy.tsx`, `shellStudy.css`,
  `marks.ts`, `nativeGlass.ts`), opened with `scripts/native-glass-lab.sh` (`SHELL_STUDY.md`, "The glass lab").
- The window: `desktop/src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/window_chrome.rs`.
- The chrome and layout: `desktop/src/app/AppShell.tsx`, `AppTopChrome.tsx`, `BuzzThemeSurfaces.tsx`,
  `useTauriWindowDrag.ts`; `desktop/src/shared/styles/globals/conversation-shell.css`.
- The rail: `desktop/src/features/sidebar/ui/` (`AppSidebar.tsx`, `AppSidebarPinnedHeader.tsx`, `ChatList.tsx`,
  `AgentRail.tsx`, `CommunityRail.tsx`, `SidebarProfileCard.tsx`, `RailGlass.tsx`, `NativeRailGlass.tsx`).
- The card's insides: `desktop/src/features/chat/ui/ChatHeader.tsx`, `features/conversation-workspace/`,
  `shared/layout/RightCardsSlot.tsx`.
- Appearance and themes: `desktop/src/features/settings/ui/SettingsPanels.tsx`, `SettingsView.tsx`;
  `desktop/src/shared/theme/` (`ThemeProvider.tsx`, `theme-loader.ts`, `adaptive-theme.ts`); `glass-floor.css`.
- The native glass: `desktop/src-tauri/native/glass/`, `src-tauri/src/native_glass.rs`, `src-tauri/build.rs`, and
  the candidate script `scripts/build-companion-delegation-candidate.sh`.
