# The shell study: places, conversations, the lip, and the glass

Study spec, 2026-10-23, for Riley's notes on the Codex/ChatGPT shell: an icon rail for places, the conversation rail
for who you talk to, the top lip for the title (and later tabs), and the glass. Lab:
`/scripts/shell-lab.template.html?experience=shell`, in the browser and in the glass lab with Apple's real glass. The
conversation rail itself follows `SPEC.md` in this folder.

## The structure (both frames)

*A thin frame holds two cards: the rail, and the conversation.*

```
┌──────────────────────────────────────────────────────────────────────┐
│ ● ● ●  ▯                 ‹ ›         Wren / Monday plan              │  the lip, 48 pt       ─┐
├────┬──────────────┬─┬────────────────────────────────────────────────┤                        │ the frame:
│ ✎  │ Luca         │ │                    TODAY                       │                        │ glass or black
│ ⌕  │              │ │   Wren                                         │                        │
│    │ PROJECTS   + │ │   Here's Monday, in the order it wants…        │                        │
│ ◎  │ Tidepool  ⌄  │ │                                                │                        │
│ ▤  │ │ Landing…   │ │                                                │                        │
│ ⧉  │ AGENTS     + │ │                                                │                        │
│ ∿  │ ▢ Wren  ⌄  ▢ │ │                                                │                        │
│ ◍  │ │ Monday plan│ │                                                │                        │
│ ⚙  │ FLEETS     + │ │         ( Message Wren…                   ↑ )  │                        │
│ S  │ Design team  │ │                                                │                        │
└────┴──────────────┴─┴────────────────────────────────────────────────┘                       ─┘
 places  the rail's    4   the conversation's card
 52      card, 220
```

Riley, 2026-10-23, on the first version (the whole frame as glass, the rail on it): the rail can't be the same glass as
the floor; it has to be a surface of its own, at the conversation card's level, whether the frame is glass or black.
Only the thin parts, the lip and the icon rail, may be clear glass.

- **The frame** is thin (Riley chose the glass frame and asked for it sleeker, 2026-10-23): the lip, the window's top
  36, with the traffic lights, the rail's toggle, back and forward and the tabs on one line at 22, the lights inset 16
  from the window's corner both ways; and the places, a column of 44 (new and search, then Conversations, Library,
  Agents, Activity, Brain; Settings and the avatar at the bottom), its icons on the first light's axis. It is Apple's
  clear glass over the desktop, or black.
- **The rail's card**, 220 wide, beside the places: the conversation card's material (surface, grain, lit top edge) at
  its level, never the frame's glass. Its rows follow `SPEC.md`. It sits 4 from the conversation's card, as the app's
  cards sit apart. Riley chose the two cards apart over one card holding both (2026-10-23).
- **The conversation's card** takes the rest, 6 from the window's right and bottom edges (concentric with the window's
  corner), with no header of its own.
- **The open tab is the card's surface rising into the lip** (Riley: tabs "like cards ... a little tab extending from
  that main card's surface"): its grain, its lit top edge, soft inward corners where it meets the card. It slides to
  the tab you open and sinks into the card when no conversation is open. The other tabs are names on the frame.
- **Closing the rail** narrows its card to nothing (its rows held still and clipped) and the conversation's card
  follows its edge. The places and the lip stay.

## The frame's material

Apple offers exactly these, and the lab shows every one (Riley: see all the options, and none that falls below the
quality of Apple's own surfaces, light and physics):

- **Liquid Glass**, two types: Regular (frosted, a little darker) and Clear (nearly see-through), each plain or with
  Apple's own tint (the lab shows a dark one). Apple also lets glass react to a press. That is the whole list: no
  brightness, shade or frost settings.
- **Apple's older frosted material**, fourteen kinds (Sidebar, Window, Under the window, Content, Under a page, Header,
  Title bar, Sheet, Popover, Menu, Heads-up display, Full screen, Tooltip, Selection).

When a window isn't the one in use, macOS relaxes its Liquid Glass on purpose (flatter, more blurred, tint dropped), as
it greys the traffic lights; nothing turns that off. The frosted material can hold the look of a window in use instead
("In use") or follow the window. Our own darkness in front of the glass, the veil, stays a separate choice, named as
ours. Every project uses these names from now on (Ghost and the rail-glass build had named mixes of them).

Riley's favourite so far: Regular with the deep veil; Clear, which looks striking but is harder to read over some
desktops, as an option.

## Glass above (the third frame, 2026-10-23)

*The conversation is the window; Apple's glass floats above it in a few small pieces, and where you are is the card's
own black, set into the glass.*

Built after reading all of Apple's guidance for the Mac (creative-mind `studies/apple-macos-2026-10-23/`, distilled in
the liquid-glass skill's `references/mac-apps.md`). Apple's Liquid Glass has only a type, a tint, a press response and a
shape; its polish comes from where it sits: small pieces whose whole edge shows, floating above rich content, with
their symbols inside the glass. The glass frame was the opposite (one big sheet behind opaque cards, a veil in front),
so this frame turns it the right way up. Riley said yes to building it beside the other two (2026-10-23).

```
┌──────────────────────────────────────────────────────────────────────┐
│ ● ● ●  (▯  ‹ ›)              ( Luca │▓Monday plan▓│ Landing page )  │  band 40: content scrolls under it
│ ╭──╮ ┌──────────────┐                                                │
│ │✎ │ │ Luca         │                   TODAY                        │
│ │⌕ │ │ PROJECTS   + │     Wren                                       │
│ │  │ │ Tidepool  ⌄  │     Here's Monday, in the order it wants…      │
│ │▓◎│ │ │ Landing…   │                                                │
│ │▤ │ │ AGENTS     + │                                                │
│ │⧉ │ │ Wren  ⌄      │                                                │
│ │  │ │ FLEETS     + │                                                │
│ │⚙ │ │ Design team  │       ( Message Wren…                    ↑ )   │
│ ╰──╯ └──────────────┘                                                │
└──────────────────────────────────────────────────────────────────────┘
  pane  the rail's card                    the conversation: the ground
```

- **The ground is the conversation,** edge to edge: the card's surface and grain fill the window, its corners the
  window's (radius read from AppKit, 16 on macOS 27.0.1). The reading column sits right of the rail and scrolls up under
  the band, where a hard scroll edge (blur and the ground's own tone, invisible at rest) keeps the glass's words clear,
  as macOS 27 does under its toolbars.
- **Three pieces of Apple's glass float above it,** native, in one container, regular by default (clear as an option):
  the lead group (the rail's toggle, then back and forward), the tabs, and the places pane. The two top pieces answer a
  press as glass; the tall pane doesn't (Apple's sidebars don't), its places answer one by one. Their symbols and words
  are inside the glass (SF Symbols at one size, one grey at rest and full ink when lit; the system font at the Mac's
  13), so the glass keeps them legible itself. Tooltips are the Mac's own; each piece is a named group for VoiceOver.
  No veil: nothing is drawn over the glass.
- **Apple's frame metrics, not ours:** the band is Apple's compact toolbar (40, the lights centred at 20, their left
  edge at 12) or, as an option, Apple's plain title bar (32, 16, 9, where the system puts them anyway). The top pieces
  are 28 tall (24 under the plain title bar), centred on the lights' line: 6 from the window's top (4 under the plain
  title bar). The places pane and the rail's card start 6 below them.
- **Concentric from the window:** everything 6 from an edge has radius 10 (16 − 6): the places pane, the rail's card,
  the pieces. Inside a piece, items and their marks are 2 in, radius 8. Rounded rectangles, never capsules, at this
  size (Riley; Apple agrees for small controls).
- **The places pane** is 40 wide, 6 from the window's left, from 6 under the top pieces to 6 from the bottom: new and
  search, the five places, then Settings and the avatar at its foot.
- **The rail's card** keeps its material (Riley: never glass): 220 wide, 6 right of the pane, from 6 under the top
  pieces to 6 from the bottom, its top lit and its shadow soft on the ground. Here the ground is the card's own tone, so
  the rail on the same tone all but vanishes into it; the lighter tone keeps it a surface of its own, and the lab opens
  this frame on it.
- **Tabs** start on the reading column's left edge (or just after the lead group when the rail is closed) and are as
  wide as their names, each with room for its name in medium so choosing one never nudges the rest; the open one is a
  chip of the card's own black, lit along its top, set into the glass. With every tab closed there's no tabs piece: the
  conversation's name sits on the band instead, centred on the reading column, off the glass.
- **Where you are,** in the places and the tabs, is that same chip, sliding on the house spring (response 0.38, damping
  0.8; at once under Reduce Motion). The rail's own mark is the page's, as before.
- **States.** Hover lifts an icon to full ink and shows a faint plate; a press gives Apple's glass response and a small
  give; disabled is faint. When the window isn't the one in use, the glass recedes (Apple's) and the pieces' ink and the
  chips' light quiet with it, and so do the page's accents. Search, a modal: the pieces take no presses and their ink
  goes faint; the glass itself is never faded (the page's scrim, beneath it, darkens what it shows). Reduce Motion stops
  every slide; Reduce Transparency and Increase Contrast make the band's edge solid; Increase Contrast gives the chips an
  edge.
- **Motion.** Pieces appear by the material (materialize), never a fade. The tabs follow the reading column's edge
  frame by frame as the rail opens and closes.

Checked before showing (2026-10-24): three independent reviews (code, Apple's guidance, design), each finding checked
by a skeptic; the confirmed ones are fixed, among them the pieces drawing below the title bar's safe area in a real
window (now `safeAreaRegions = []`), the chip's colour read before the theme landed, the pane's corners, the faded
glass during search, empty tabs, and VoiceOver names. Clicks were tested in the real titled window through the lab's
own event dispatch, without moving anyone's pointer.

Open, to judge in the window: whether the places pane wants clear glass over a plain ground (there's little for it to
bend; a full-height pane is thick glass whatever its type, so two content-sized pieces would be the lever); the tabs'
overflow past six; keyboard focus into the native pieces (Full Keyboard Access reaches them, the page's Tab key
doesn't); the chip without the card's grain (it reads a little blacker than the ground).

## Light and surface, not lines

Riley (2026-10-23, with references of natural light on glass and soft surfaces): stick to the fundamental materials of
reality, light and surface, rather than lines and drawn shapes. So a card is told by its lit top edge and the shadow it
leaves on the glass, with no outline; the day is a quiet label with no rule; a list's rows are told apart by space; the
composer is a well pressed into the card, its lower lip catching the light, and send stands up out of it.

## Where you are

Solid, never clear glass, and squircle-cornered, never a pill: a capsule at this size reads cheap (Riley). The mark is
whichever of two materials reads on the surface beneath it:

- the plate (light ink, as the app's hover and sent bubble): on a black frame, and on a rail of the card's own black;
- the card's black (its surface, grain and lit top): on a glass frame, and on a lighter rail.

The open session under a home is lit, not marked (`SPEC.md`). The marks slide on the house springs, stretching on the
way. Riley set their finer behaviour aside for now.

## Next

Light mode, once the dark shell is settled (Riley).

## In the browser

A browser can't draw Apple's glass. The browser view shows our own web stand-in (the web pill; for the glass frame, a
dusk sky under our web glass), and says so in the lab panel. Judge the glass in the glass lab.

## The glass lab

`scripts/native-glass-lab.sh open "http://localhost:1488/scripts/shell-lab.template.html?experience=shell&direction=above&tone=lighter"`
opens the third frame (drop `direction` and `tone` for the last look you chose) in a real window with working
traffic lights, behind every other window (with Stage Manager on, it waits in the
strip). Clicking it brings it forward; only then is its glass at its best, since macOS relaxes the glass of a window
not in use (flatter, frosted). `run` instead of `open` is the film window, for checks and captures. The study also opens
directly in a look: `&direction=glass&tabs=1&rail=closed&glass=regular&veil=none&panel=0`.

## Lab controls

At the conversation card's bottom right: Frame (Black, Glass, Above), Rail (Open, Closed), Rail tone (Same, Lighter), Tabs
(Off, On); for the glass frame, Material (every Liquid Glass and frosted material Apple has) and Veil (None, Soft,
Deep); for the third frame, Above, Bar (Compact, Title bar) and Glass (Regular, Clear). Clicking
places, homes, sessions, tabs, + and search works as it would in the app; nothing leaves the page. The look is
remembered on this Mac.
