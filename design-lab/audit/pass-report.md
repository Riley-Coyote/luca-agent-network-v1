# The big pass — what changed, and what I checked

*Integration report, 2026-08-24. Written to be read by someone who is not an
engineer. Every claim here was checked by running the app and measuring it, not
by reading the code. Where something is unverified, or was left alone on
purpose, it says so.*

This pass worked through the gap inventory — the audit's ranked list of what was
wrong with core chat. Thirty-six files changed. The short version: the app
stopped shouting, stopped losing things, and started saying what it is doing.

---

## The five things most worth your attention

1. **Keyboard focus was rebuilt for the entire app, not one screen.** The blue
   ring is gone everywhere. This is the largest-blast-radius change in the pass.
   I measured it (below) and it holds, but it is the first thing to look at.
2. **Your messages now sit in a plate on the right.** That is a taste decision,
   not a bug fix, and it changes how the whole conversation reads. It is on by
   default.
3. **Pressing Stop no longer cuts off the answer.** It was silently discarding
   text that had already arrived, then blaming the runtime for the gap.
4. **A source file was invisible to review** because of a stray byte. Details
   in its own section below — this one is about trust in the review process,
   not about pixels.
5. **In the Ash theme, your message plate is faint.** Measured: the plate sits
   only 9 shades above the conversation behind it, versus 19 in the default
   theme. The new design leans on that step. See Risks.

---

## What I ran, and what it said

**The build gates — all passed**, on the exact tree described here:

| Check | Result |
|---|---|
| Type checking (twice, before and after formatting) | clean |
| Formatter / linter | clean, nothing rewritten, 8 warnings (all pre-existing or harmless) |
| Unit tests | 3,730 tests, 47 suites, **0 failures** |
| Text-size guard | clean |
| Lab geometry checks, 3 themes | **all checks passed**, 0 console errors |

**What the gates do NOT cover, and you should know it:** the browser-driven
end-to-end tests were not run. Three of them had their expectations updated in
this pass (they were checking for the old placeholder text and the old failure
wording). Those edits look right to me and nothing else references them, but
nobody has actually executed that suite against this tree. **That is the single
biggest untested area.**

**Two geometry checks silently did not run.** The lab reports them as "null",
which means the thing they measure was not on screen in the captured state: the
width of the exchange strip, and the day-date pill's distance from the header.
A change in this pass was specifically aimed at that day pill. So the pill fix
is **unverified** — it is not failing, it simply was not checked.

**No test was weakened to get a pass.** I checked every deleted test line. Four
tests were renamed and rewritten to assert the *new* intended behaviour (for
example, "discards unseen text on cancellation" became "keeps every grapheme it
received"), and eight new tests were added alongside. The removals are
re-specifications, not deletions.

---

## 1. The composer — the box you type in

**The permanent bright outline is gone.** The composer takes focus the moment a
conversation opens, so its focus outline was on screen essentially always — and
it was brighter than the edge of the card it sat on. In an empty room that reads
as a form field waiting to be filled in, which is the one thing this card should
never look like. Measured now: at rest the card's border is fully transparent;
focused, it is a 6% whisper.

**The card catches light instead of drawing a line.** It carries one lit top
edge — the same highlight the system uses elsewhere to say "this is an object
sitting above the page". When you click away, that light goes out. Measured:
focused it is a 6% white inset highlight, blurred it fades to nothing. Losing
focus, not gaining it, is now the marked state — the honest way round for a
control that is focused nearly all the time.

**The send button arms and disarms at different speeds** — 140 milliseconds to
arm, 90 to disarm. Handing you an affordance can be gentle; taking one away has
to be quick, or backspacing fast past your last character makes it strobe.
Verified by typing into the real editor: empty, the button is disabled; with
text, it is enabled and filled.

**The placeholder stopped naming the room.** It used to read "Message ziggy,
Luca" — the member list read back at you, directly under a header already saying
where you are. One line now, for every conversation.

**The row of small buttons under the card got quieter.** Those glyphs were being
drawn at full-strength ink — about three and a half times the contrast of the
placeholder, which is the one thing in the composer you actually have to read.
Decoration was louder than content. The plate that appears under your pointer
now sits *below* the card rather than above it, which is what had inverted the
sense of depth there.

**Nothing announces a send any more.** The uppercase "SENDING" label and the
spinner are both gone. Your message appearing is the confirmation.

**The reply well.** Opening a reply now reads as the card sinking into a recess
rather than sitting on a lip — the two light lines that used to stack a pixel
apart are one. Captured and confirmed.

---

## 2. Keyboard focus, everywhere

Pressing Tab used to draw a two-pixel saturated blue ring held two pixels off
whatever you reached, with the page showing through the gap. Blue is not in this
system's vocabulary — there is one accent, slate, reserved for signals. And the
shape was wrong: the house rule is that a focused thing's *own edge* changes, in
place.

It was also unavoidable. That ring came from a single global rule that outranked
every component. Around a hundred components had already asked to draw their own
focus and were being silently overruled — which is why nobody could find the
source by looking at components.

**Measured, by tabbing through 23 real controls in each of three themes:**

- 22 of 23 draw **exactly one** focus line.
- **Zero** draw none — nothing became invisible to the keyboard.
- Every one: 1 pixel, drawn inside the element's own edge, in the palette's own
  quietest readable ink. No blue anywhere.
- The one exception is the currently-selected conversation in the sidebar, which
  carries its own faint "this is selected" edge as well as the focus line. Two
  lines, two different meanings — arguably correct, but worth your eye.

---

## 3. The conversation

**Your turns and your agent's turns now look different.** Yours is a compact
plate anchored right; your agent keeps the full reading width, its mark in the
margin, its name above. Your messages are short; an agent's are documents — code,
tables, long prose — which need the whole measure. Both are separated by position
and shade, so the distinction survives a black-and-white screenshot.

**Timestamps stopped standing on every row.** They fade in when you point at a
row or reach it with the keyboard, and keep their space the whole time so
revealing one never nudges a word. The exact moment stays available to a screen
reader whether or not a pointer ever crosses the row.

**Your own messages land differently.** Yours arrive with a short, unblurred
motion; your agent's keep the longer, softer one. Someone else speaking is news;
your own words are not.

**The visit thread.** When an agent steps into a conversation, a hairline
connects the marks of whoever spoke during the visit. See the correction section
below — this needed real work during integration.

---

## 4. Waiting

Before this pass the app had nine words for everything an agent might be doing,
and no sense of time at all.

A working agent now narrates: what it is doing, what it is doing it to (a
domain, a file path, a command), how many results it found, and — after a while —
how long it has been. Longer still and it says "still …", which is
acknowledgement rather than new information.

**Nothing is narrated for the first three seconds. That is deliberate and was
deliberately left alone.** An app that narrates ordinary latency teaches you to
watch it. It stays as it is.

**One surface owns the wait, and which one depends on the room.** In a
one-to-one it is the row where the answer will appear, so when text arrives it
fills in place and nothing jumps. In a room it is the shelf above the composer,
because a room can have several agents working at once and the shelf is built to
show several. Before this fix a room drew both indicators for the same wait.

**All of this was invisible where you actually use it.** In one-to-one
conversations the narration was being computed and then thrown away one step
short of the screen — which is where you mostly talk to your agent. Fixed.

**A privacy decision worth knowing:** the obvious way to show which site an
agent is reading is to fetch that site's icon. That would tell a third party
which pages your conversations touch. The app draws a neutral mark instead, in a
box sized so a local icon could drop in later without anything moving.

**The waiting clock stopped ticking pointlessly** — it now wakes only when the
sentence would read differently. Over a forty-second wait: 32 wakes instead of
40, and 2 instead of 10 in the first ten seconds, which is exactly when your
agent is streaming text into the row above.

---

## 5. When something goes wrong

**Failures used to erase themselves after four seconds** — and took the only
Retry button with them. Look away and a failed turn became unrecoverable, with
nothing afterwards saying it happened. A failure now waits for you, and you
dismiss it yourself.

**Stop no longer truncates the answer.** Text is revealed at a steady pace, so
when you press Stop some of what already arrived has not yet been painted. That
remainder was being discarded — measured at 28 of 68 characters, cut mid-word —
and the app then printed "Response may be incomplete", blaming the runtime for
its own loss. It is now painted.

**Failure sentences are no longer red.** A recoverable state is not an alarm,
and that sentence runs the full width of the reading column. The agent's mark
carries the colour; the sentence states the outcome in ordinary ink.

**Failure sentences stopped ending in the name of the button beside them.**
"Resident stopped unexpectedly · Retry" put the word Retry on a paragraph you
cannot press, a hundred pixels from a real Retry — three Retrys in one block,
one of them dead.

---

## 6. When the server is unreachable

The app used to show the server's own words, verbatim, in red: *"relay returned
404 Not Found: relay: no community is configured for this host"*. There is
nothing in that sentence you can act on. It now says what is wrong and what to
do, in a contained card, and the collapsed sidebar shows the same card instead
of its own worse version.

---

## 7. Search

Agent and person results in the command palette used to highlight, accept
Return, and do nothing. They now open the conversation — and if that fails, the
palette stays open and says so plainly, instead of vanishing.

---

## The invisible file

`managedPresentationActivityStore.ts` contained a single raw zero byte, sitting
inside a piece of text the code uses as a separator. It worked perfectly at
runtime. But that byte made the version-control system classify the file as a
picture rather than as text — so its diff showed as *"Bin 7668 → 11947 bytes"*
and nothing else.

**The consequence is a review problem, not a pixel problem: every change to that
file in this pass was unreviewable.** Not hard to review — literally not shown,
to a human or to any automated check that reads diffs. It had escaped every
review it had passed through.

I replaced the raw byte with its written-out escape form. The text the program
uses is byte-for-byte identical; the file is now plain text and diffs normally.
Worth a guard later if it recurs — the origin is simply that a byte you cannot
see got typed into a string literal.

---

## The correction I made during integration

The pass included a fix for the visit thread — the hairline connecting agents
who spoke during a visit — aimed at a case where the line broke across a row
that draws no mark (which is now every one of your own messages).

**That fix never ran.** It looked for the message box as a direct child of the
row, and the real structure has one more level in between, so the rule matched
nothing at all. The described repair was not in the build.

Fixing the match then exposed two more faults, both of which I measured and
corrected:

- On the last row of a visit the line drew an 8-pixel stub from the row's top
  edge into empty space, with a rounded cap, about 700 pixels to the left of the
  message it appeared to point at.
- Suppressing that revealed the opposite error: the newly-live rule outranked
  the one that ends the line at the passage's end, so the line ran *past* the
  bottom of the visit.

A row with no mark now draws no connector at all, and the line ends on the last
mark it actually had. Verified by measuring every row's line segments and by
looking at the result at three times magnification. I also corrected a comment
in the code that stated the wrong structure depth, so the next person is not
told the same wrong thing.

---

## Left alone on purpose

- **Silence under three seconds.** Deliberate, discussed, unchanged.
- **Group conversations are still named by their member list** ("ziggy, Luca").
  Known, listed in the audit, not part of this pass.
- **The "7 new messages" pill overlaps the message behind it** — visible at the
  top of the full-shell captures. Pre-existing, not touched here.

---

## Risks, in the order I would look at them

1. **The end-to-end test suite has not been run against this tree**, and three
   of its files had expectations changed. Highest-value next check.
2. **Focus is now governed by one rule that applies to every element in the
   app.** I measured 23 controls across 3 themes and found exactly one line on
   22 and none missing — but that is 23 controls, not all of them. Screens I did
   not reach (settings, agent pages, dialogs) are unmeasured.
3. **Ash theme, the new message plate.** Measured shade steps between your
   plate and the conversation behind it: default 19, inverse 16, **ash 9**. The
   plate is the whole mechanism by which your messages are told apart, and in
   Ash it is faint. The same shallow-ladder problem was flagged for the composer
   card in Graphite (a 5-step). This is a palette question, not a code one.
4. **The day-date pill fix is unverified** — its check did not run. See above.
5. **A 17 MB file called `shell-lab-final.html` is sitting in this folder.** It
   is a stale copy of the design lab from earlier this morning, not a
   deliverable, and it should not be committed. I left it rather than delete
   another session's file.

---

## The captures

In `design-lab/audit/pass-shots/`, all at twice normal resolution. I opened and
read each one before writing this.

| File | What it shows |
|---|---|
| `01-shell--default.png` | The whole app, default theme |
| `02-composer-resting.png` | The composer, empty |
| `03-composer-armed.png` | The composer with text — send armed |
| `04-composer-reply-recess.png` | A reply open, the card tucked into the well |
| `05-timeline-owner-and-agent.png` | Your turn and your agent's turn together |
| `06-shell--inverse.png` | The whole app, Inverse theme |
| `07-shell--ash.png` | The whole app, Ash theme |
| `08-focus-indicator.png` | The new focus hairline (added by another session) |

The three dark themes look alike at a glance but are genuinely different
ladders: default puts the sidebar darker than the conversation, **Inverse
reverses exactly that**, and Ash is a neutral grey with no blue cast.
