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

Riley's picks are in "The frames as a setting", below.

## Tried on the night of 2026-10-24, and rolled back

**Status: rolled back at Riley's word ("roll the glass lab back to the version from before tonight ... and rebuild
forward one change at a time, showing me each").** The lab is again the version he called awesome (`87491a55c`: the
glass frame with the material menu), plus one invisible testing command. What follows records what was tried that
night (commits `c35355171`, `afb7b6e21`, `e53a04f6d`), so the rebuild can take any piece back one at a time, shown to
him before the next.

After reading all of Apple's guidance for the Mac (creative-mind `studies/apple-macos-2026-10-23/`, distilled in the
liquid-glass skill's `references/mac-apps.md`), these were the changes tried on his floor:

- **The cards sit on the glass.** The glass is one piece, the window's own shape, beneath both cards, and each card's
  edge catches the light all the way round, following its corners, brightest along the top and quiet down the sides
  (a hairline, like the glass's rim at the window's edge). The cards keep their soft shadow on the glass. Tried and
  dropped: cutting the cards out of the glass so its edge ran around them (Riley, 2026-10-24: it made the cards look
  "nested inside the liquid glass ... as if its pressed into it"; "the card and rail should look like they have that
  rounded subtle edge just like the outside edge of the lip all the way around").
- **Nothing of ours over the glass.** No veil. Darkness, when wanted, goes beneath it, the way Apple dims clear glass:
  black under the glass, so the glass bends a darker desktop and keeps its light. Measured so soft and deep darken the
  glass about as much as the old soft and deep veils over it did (soft 0.38 black beneath, to 0.81 of none; deep 0.72,
  to 0.53; the old veils were 0.78 and 0.58). While search is open the darkness rises from beneath too; the page's own
  scrim covers only the cards.
- **The frame's icons and words are inside the glass.** The lip's buttons, every tab's name and the other tabs' close
  buttons, the conversation's name (in its three tones), the places and the avatar are drawn natively in the glass (SF
  Symbols, the widest drawn a little smaller so none crowds its chip; the system font at the Mac's 13), at the frame's
  muted tier (0.78) and full ink when the pointer is over them or presses them, with a faint plate easing in beneath.
  The page keeps its buttons in place without their ink, so clicks, keys, focus rings and tooltips stay the page's; it
  tells the glass what the pointer is over and pressing.
- **Where you are carries the light.** In the places it's a chip of the card's own black (its surface lifted by its
  grain) set into the glass; the symbols are lit only through the chip, so a place lights as the chip arrives and dims
  as it leaves, never ahead of it. The open tab is the card's surface rising into the lip; its name is lit on it the
  same way (a lit copy of the names, seen only through the tab as it's drawn), so the name never runs ahead of its
  surface.
- **The look.** Apple's materials look different when the window isn't the one in use. Apple's frosted materials can
  hold either look (In use, Resting) or follow the window. Liquid Glass has no setting for it, but it can hold its
  resting look: then the floor lives in a borderless window of its own, exactly over the app's and one step behind
  it, which is never the one in use (the app's window takes every click and leaves the shadow to it). Riley's
  favourite is that resting look (below).
- **The window's state:** the page's accents and the frame's ink quiet when the window isn't in use.

Under Reduce Transparency the lab keeps Apple's materials, which grow frostier on their own; the page never paints a
stand-in desktop over the real one.

What went wrong, so it isn't repeated:
- Glass pieces floating above the conversation, the way Apple builds its toolbars (Riley: "that looks ridiculous. we
  were supposed to be making sure the glass floor was done right"). Apple's guidance is a way to perfect the floor he
  chose, not a reason to replace it.
- Cutting the cards out of the glass made them look pressed into it.
- Holding Liquid Glass's resting look in a window of its own behind the app's left the app window's edge see-through,
  and macOS drew its thin dark window border over the glass (black hairlines on every Liquid Glass look).
- "Resting" as the default look turned every frosted material flat grey: an inactive frosted material is opaque grey,
  not glass. Riley: "all of the non-liquid glass options just look grey. theyre not actual glass transparent."
- Too many changes shown at once, so he couldn't tell which one made it worse.

## The frames as a setting (Riley, 2026-10-24)

Three frames, each in light and dark mode, chosen in settings:

- **Black.** "it looks too good to throw away." In light it is **Paper**: the paper's recess for a floor, the cards
  told by shade and shadow alone. Kept (2026-10-24: "paper and glass both look amazing! keep them both").
- **Glass:** Apple's frosted material ("the diffused normal glass look almost feels better"). Heads-up display looks
  best so far; it changed colour when he clicked away only because its look was set to follow the window.
- **Liquid Glass.** Dark: Regular with Apple's dark tint and the Soft veil. Light: Regular with the Soft veil (a wash of
  the paper's own tone) and black ink, kept with Paper the same morning. ("i think were going to go with regular,, apples dark tint with soft tint, and Regular
  with soft tint for white/light mode", on the rolled-back lab. Earlier the same night he had leaned to Clear with the
  dark tint and no veil, for its look when the window rests.)

## Rebuilding, one change at a time (from 2026-10-24)

From the rolled-back lab, each change is shown alone and kept only on Riley's word.

1. **The card edge: tried and dropped.** On the glass, each card's edge caught the light all the way round its corners,
   brightest along the top and quiet down the sides, and the open tab carried the same line round the curves at its
   foot onto the card's top. Riley compared it on and off in the lab: "Drop the card edge, I like it better without."
   The cards keep only their lit top edge and their soft shadow on the glass. The code is in commit 4276105be.
2. **Light mode** (Riley: "build light mode in the glass lab so I can see Regular with Soft in light"). A Mode switch
   in the lab, Dark or Light. Light is the app's own light palette, Paper, applied the way Settings applies it, and
   Apple's glass and the lab's window take the light appearance with it. Each mode keeps its own look: dark opens on
   Regular with Apple's dark tint and the Soft veil, light on plain Regular with the Soft veil, and each remembers what
   was last chosen in it. In daylight the light from above is told by what it leaves beneath, so:
   - no white edges anywhere (white on white says nothing): the cards, the tab, the sent message and the "where you
     are" marks are told by their tone and a soft shadow, cast in the page's ink rather than black;
   - the Soft veil is a wash of the paper's own tone, not black, so it lifts the glass toward the cards and the
     frame's ink reads over a dark or busy desktop (a black wash would turn light glass grey);
   - the frame's words are the page's ink at 100, 84 and 66 percent, solved for daylight rather than copied from dark;
   - the cards' shadows lie on the glass beneath all of them at once, so no card shades its neighbour (in dark the
     same overlap was invisible, black on black);
   - the composer is a shallow well with its lower lip catching the light, and send a piece of paper standing out of
     it;
   - the solid frame (Black in dark) is the paper's floor in light, named Paper there, and the darker rail tone is
     named Darker.
   Dark is unchanged: ten distinct dark looks rendered before and after were identical but for a font-loading quirk of
   the comparison. Measured in the film window, where the glass shows nothing behind it (as over a black desktop),
   the tab names reach 4.1:1; on his real desktop they read about 7:1. Kept.
3. **White frame ink in light: tried and dropped.** Riley asked what the icon rail and the unselected tabs would look
   like in white. White only reads if the glass behind it is darkened (white on his bright blue glass measured 1.3 to
   1.9:1, black 6.5 to 8:1), so the switch turned the veil black beneath white words, and the frame became smoked
   glass around the paper. He liked bright glass with white words best, which can't be read, and chose black: "lets
   just go with black ink. it looks great". The code is in commit 62cb1705a.
4. **The Paper frame without an outline** (Riley: "take the outline off the cards in the Paper frame in light, so
   they're told by shade and shadow like on the glass"). The app's light card edge drew a hairline ring round each card
   (one device pixel at about 210 between floor and paper). Now the floor is Paper's recess (#eceae6), a step of shade
   below the cards (paper at 251 over floor at 236), and the cards keep only a soft ink-cast shadow, lying on the floor
   beneath all of them as on the glass, softer than on glass since the floor is calm. Paper's own floor (#f6f4f2) was
   tried and too close: without the ring the cards dissolved into it. Natively the floor draws the same shade. Kept.
5. **The frames as a setting** (Riley: "make the three frames (Black/Paper, frosted Glass, Liquid Glass) a setting, in
   light and dark"). One Frame setting with three values: Black (Paper in light), Glass (Apple's frosted material) and
   Liquid Glass. It lives where a person would find it, in the study's own Settings page, under Appearance with Mode
   (Dark, Light), each choice a working control with one plain sentence under Frame ("Solid black, nothing showing
   through it." / "Solid paper, ..." / "Frosted glass, your desktop softly blurred behind it." / "Liquid Glass, your
   desktop showing through it."). The lab panel switches the same three. Each glass frame keeps its own look in each
   mode, and returns to it: Liquid Glass is Regular with Apple's dark tint and Soft at night, Regular with Soft by day;
   Glass is the heads-up display, held in use, at night. Glass by day is not chosen yet: it starts on Sidebar, Apple's
   light frame material, held in use, no veil. The setting changes nothing about how any look is drawn (twelve dark and
   light looks render as before), and a look saved before it carries over. In light, a control's chosen option now
   stands up like Send, white paper on its track. When this leaves the study, Mode gains Auto first, following the Mac.

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

Riley's eye on Glass by day (Sidebar to start, against the other light frosted materials), then `SPEC.md` and the
app.

## In the browser

A browser can't draw Apple's glass. The browser view shows our own web stand-in (the web pill; for the glass frame, a
dusk sky under our web glass), and says so in the lab panel. Judge the glass in the glass lab.

## The glass lab

`scripts/native-glass-lab.sh open "http://localhost:1488/scripts/shell-lab.template.html?experience=shell&direction=glass&material=glass-regular-tint&veil=soft"`
opens the glass frame on Riley's dark pick (drop the look's parameters for the last look you chose) in a real window
with working traffic lights, behind every other window (with Stage Manager on, it waits in the
strip). Clicking it brings it forward; only then is its glass at its best, since macOS relaxes the glass of a window
not in use (flatter, frosted). `run` instead of `open` is the film window, for checks and captures. The study also opens
directly in a look: `&frame=frosted&tabs=1&rail=closed&material=frost-hudWindow&held=1&veil=none&panel=0` (frame is
solid, frosted or liquid; the older `direction=black|glass` still works), and in a mode with `&mode=light`. A mode or a
frame asked for brings its own look, which the rest of the address can then change. Captures in a browser need every setting in the address
and a fresh browser for each, or the last look carries over.

## Lab controls

At the conversation card's bottom right: Mode (Dark, Light), Frame (Black, Glass, Liquid Glass; Paper for Black in
light), Rail (Open, Closed), Rail tone (Same, Lighter; Darker in light), Tabs (Off, On); for a glass frame, Material
(that frame's own materials from Apple), Look for frosted Glass (In use, Follows) and Veil (None, Soft, Deep). Mode and
Frame are also the Settings page's Appearance. Clicking
places, homes, sessions, tabs, + and search works as it would in the app; nothing leaves the page. The look is
remembered on this Mac.
