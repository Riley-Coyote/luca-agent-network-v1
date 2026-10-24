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
("In use") or follow the window. Our own darkness stays a separate choice, named as ours ("Darkness"), and since
2026-10-24 it goes beneath the glass, never in front of it. Every project uses these names from now on (Ghost and the
rail-glass build had named mixes of them).

Riley's favourite so far: Regular with the deep veil (now deep darkness beneath, set to darken the glass about as much);
Clear, which looks striking but is harder to read over some desktops, as an option.

## The glass floor, done right (2026-10-24)

*The frame is one piece of Apple's glass in its own shape: the cards are cut out of it, so its edge runs around each
of them, and everything the frame holds is inside the glass.*

Riley chose the glass frame. After reading all of Apple's guidance for the Mac (creative-mind
`studies/apple-macos-2026-10-23/`, distilled in the liquid-glass skill's `references/mac-apps.md`), the reasons it read
less refined than Apple's own glass were structural, and each one can be fixed without leaving the floor:

- **The glass had no edge where you look.** It was one window-sized sheet hidden under the cards, so its bend and lit
  rim showed only at the window's outer edge. Now the glass takes the frame's own shape (SwiftUI's glass in a shape:
  the window's rounded rectangle with the rail's card and the conversation's card cut out, the open tab cut out with
  the conversation's card), so its edge runs around every card and the tab, where the eye reads the frame. The cuts
  follow the cards frame by frame as the rail opens and closes and as the open tab slides.
- **The veil sat on top of the glass,** dulling the rim and highlights macOS 27 strengthened. Nothing is drawn over the
  glass now. Darkness, when wanted, goes beneath it, the way Apple dims clear glass: the same shape filled with black
  under the glass, so the glass bends a darker desktop and keeps its light. Measured so soft and deep darken the glass
  about as much as the old soft and deep veils over it did (soft 0.38 black beneath, to 0.81 of none; deep 0.72, to
  0.53; the old veils were 0.78 and 0.58). While search is open the darkness rises from beneath too; the page's own
  scrim covers only the cards.
- **The frame's icons and words sat outside the glass,** so the glass couldn't keep them legible. Now the lip's
  buttons, every tab's name and the other tabs' close buttons, the conversation's name (in its three tones), the
  places and the avatar are drawn inside the glass, natively (SF Symbols, the widest drawn a little smaller so none
  crowds its chip; the system font at the Mac's 13), at the frame's muted tier (0.78) and full ink when the pointer is
  over them or presses them, with a faint plate easing in beneath. The page keeps its buttons in place without their
  ink, so clicks, keys, focus rings and tooltips stay the page's; it tells the glass what the pointer is over and
  pressing.
- **Where you are carries the light.** In the places it's a chip of the card's own black (its surface lifted by its
  grain) set into the glass; the symbols are lit only through the chip, so a place lights as the chip arrives and dims
  as it leaves, never ahead of it. The open tab is still the card's surface rising into the lip, cut out with its
  card; its name is lit on the card the same way (a lit copy of the names, seen only through the tab card as it's
  drawn), so the name never runs ahead of its surface.
- **The cuts follow the cards** frame by frame. The glass and the page are drawn by two processes and either can be a
  frame ahead (filmed: usually the glass), so wherever a card's edge moves, its cut draws in by three frames of that
  edge's travel and eases back when it stops; still edges keep the exact cut, so the glass's edge never blinks. Filmed
  over a bright stand-in desktop through five tab switches and the rail closing and opening: no light between card and
  glass.
- **The window's state:** the glass recedes on its own when the window isn't in use; the page's accents and the frame's
  ink quiet with it.

The cards and their lit tops are the page's, above the glass, as before; the shadow they leave on it is kept close (a
soft contact, not the wide spread that darkened the narrow glass around them). That contact shadow is the one thing of
ours over the glass, and it's the cards' own. Apple's older frosted materials stay in the menu as they were (a plain
sheet, no cut-outs), and take no darkness of ours. Under Reduce Transparency the lab keeps Apple's materials, which
grow frostier on their own; the page never paints a stand-in desktop over the real one.

Tried and dropped the same night: glass pieces floating above the conversation, the way Apple builds its toolbars
(Riley, 2026-10-24: "that looks ridiculous. we were supposed to be making sure the glass floor was done right"). Apple's
guidance is a way to perfect the floor he chose, not a reason to replace it.

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

`scripts/native-glass-lab.sh open "http://localhost:1488/scripts/shell-lab.template.html?experience=shell&direction=glass&material=glass-regular&veil=deep"`
opens the glass floor (drop the look's parameters for the last look you chose) in a real window with working
traffic lights, behind every other window (with Stage Manager on, it waits in the
strip). Clicking it brings it forward; only then is its glass at its best, since macOS relaxes the glass of a window
not in use (flatter, frosted). `run` instead of `open` is the film window, for checks and captures. The study also opens
directly in a look: `&direction=glass&tabs=1&rail=closed&material=glass-clear&veil=none&panel=0`.

## Lab controls

At the conversation card's bottom right: Frame (Black, Glass), Rail (Open, Closed), Rail tone (Same, Lighter), Tabs
(Off, On); for the glass frame, Material (every Liquid Glass and frosted material Apple has) and, for Liquid Glass,
Darkness beneath it (None, Soft, Deep). Clicking
places, homes, sessions, tabs, + and search works as it would in the app; nothing leaves the page. The look is
remembered on this Mac.
