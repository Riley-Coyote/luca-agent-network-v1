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

- **The frame** is thin: the lip (the window's top 48: traffic lights, the rail's toggle, back and forward over the
  conversation, its name on the conversation's axis, tabs when on) and the places (a column of 52: new and search, then
  Conversations, Library, Agents, Activity, Brain; Settings and the avatar at the bottom; icons on the first traffic
  light's axis). It is Apple's clear glass over the desktop, or black.
- **The rail's card**, 220 wide, beside the places: the conversation card's material (surface, grain, lit top edge) at
  its level, never the frame's glass. Its rows follow `SPEC.md`. It sits 4 from the conversation's card, as the app's
  cards sit apart (or joined into one card with a hairline, a lab choice).
- **The conversation's card** takes the rest, 8 from the window's right and bottom edges, with no header of its own.
- **Closing the rail** narrows its card to nothing (its rows held still and clipped) and the conversation's card
  follows its edge. The places and the lip stay.

## Where you are

Solid, never clear glass, and squircle-cornered, never a pill: a capsule at this size reads cheap (Riley). The mark is
whichever of two materials reads on the surface beneath it:

- the plate (light ink, as the app's hover and sent bubble): on a black frame, and on a rail of the card's own black;
- the card's black (its surface, grain and lit top): on a glass frame, and on a lighter rail.

The open session under a home is lit, not marked (`SPEC.md`). The marks slide on the house springs; with the cards
joined, the rail's mark pours out of the conversation's edge. Riley set the marks' finer behaviour aside for now.

## In the browser

A browser can't draw Apple's glass. The browser view shows our own web stand-in (the web pill; for the glass frame, a
dusk sky under our web glass), and says so in the lab panel. Judge the glass in the glass lab.

## The glass lab

`scripts/native-glass-lab.sh open "http://localhost:1488/scripts/shell-lab.template.html?experience=shell"` opens the
study in a real window with working traffic lights, behind every other window (with Stage Manager on, it waits in the
strip). Clicking it brings it forward; only then is its glass at its best, since macOS relaxes the glass of a window
not in use (flatter, frosted). `run` instead of `open` is the film window, for checks and captures. The study also opens
directly in a look: `&direction=glass&tabs=1&rail=closed&glass=regular&veil=none&panel=0`.

## Lab controls

At the conversation card's bottom right: Frame (Black, Glass), Rail (Open, Closed), Cards (Apart, Joined), Rail tone
(Same, Lighter), Tabs (Off, On), and for the glass frame, Glass (Clear, Regular) and Veil (None, Soft, Deep). Clicking
places, homes, sessions, tabs, + and search works as it would in the app; nothing leaves the page. The look is
remembered on this Mac.
