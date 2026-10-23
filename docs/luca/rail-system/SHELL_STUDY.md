# The shell study: places, conversations, the lip, and the glass

Study spec, 2026-10-23, for Riley's notes on the Codex/ChatGPT shell: an icon rail for places, the conversation rail
for who you talk to, the top lip for the title (and later tabs), and the glass. Lab:
`/scripts/shell-lab.template.html?experience=shell`, in the browser and in the glass lab with Apple's real glass. The
conversation rail itself follows `SPEC.md` in this folder.

## The structure (both directions)

```
┌──────────────────────────────────────────────────────────────────────┐
│ ● ● ●   ⫶  ‹ ›              Monday plan                       ▣  ⧉  │  the lip, 44 pt
├────┬──────────────┬──────────────────────────────────────────────────┤
│ ◎  │       ⌕  ✎   │                                                  │
│ ▤  │ Luca         │                     TODAY                        │
│ ⧉  │              │     Luca                                         │
│ ∿  │ PROJECTS   + │     I lined up the week…                         │
│ ◍  │ Tidepool  ⌄  │                                                  │
│    │ │ Landing…   │                                                  │
│    │ AGENTS     + │                                                  │
│    │ Wren  ⌄      │                                                  │
│    │ │ Monday plan│                                                  │
│ ⚙  │ FLEETS     + │          ( Message Luca…                    ↑ )  │
│ R  │ Design team  │                                                  │
└────┴──────────────┴──────────────────────────────────────────────────┘
 places  conversations                     the card
```

- **The lip** (the window's top strip): traffic lights, the conversation rail's toggle, back and forward, then the open
  conversation's name over the card's reading column, and its actions at the right. With tabs on, the name becomes
  the active tab among the open conversations. The card has no header of its own.
- **The places** (a column of icons, always there): Conversations, Library, Agents, Activity, Brain; Settings and your
  avatar at the bottom. A place opens in the card; the conversation rail stays as it is. Runtimes live in Agents.
- **The conversation rail** (collapsible, 220 pt): search and new at its top; Luca; Projects, Agents, Fleets with their
  sessions nested (`SPEC.md`).
- **Collapsed**, only the places, the lip and the card remain, and the card takes the room.

## Direction 1, "Black frame" (Claude's, as imagined before Riley's note)

*Quiet ink on black; glass marks where you are.*

- The floor is black: the lip, the places and the conversation rail are bare ink on it, with no separators.
- The card is the near-black grained surface (#060606, its even grain and top light).
- Apple's clear glass marks where you are, at every level, with one physics: a disc under the chosen place (it slides
  between icons), the capsule under the chosen home (it wells out from under the card's edge and pours to the row;
  the old one drains back under the card), and, with tabs on, a capsule under the open tab (it slides along the lip).

## Direction 2, "Glass frame" (Claude's, with Riley's note)

*The frame is glass; the card is the one solid thing in it.* Riley: "the outer rail/lip surface should be glass itself …
real beautiful liquid glass, more transparent with less frost."

- The lip, the places and the conversation rail are one sheet of Apple's clear glass, the window's own frame, showing
  the desktop through it. Nothing frosts it; a veil (none, soft, deep) darkens it only so its words read over a bright
  desktop.
- The card floats on the glass: the near-black grained surface, its top light, and the soft shadow the light from above
  leaves under it.
- Where you are is marked in the card's own black, the inverse of the black frame: Apple's glass can't sit on Apple's
  glass, so on glass the mark is a drop of the card. A black disc under the chosen place, a black capsule under the
  chosen home (poured out from under the card's edge and drained back under it), a black capsule under the open tab.
  The page draws these, on the same springs as the native glass.

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

At the card's bottom right: Frame (Black, Glass), Rail (Open, Closed), Tabs (Off, On), and for the glass frame, Glass
(Clear, Regular) and Veil (None, Soft, Deep). Clicking places, homes, sessions, tabs, + and search works as it would in
the app; nothing leaves the page. The look is remembered on this Mac.
