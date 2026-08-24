# Composer Choreography — Polyphonic message composer

Measured against the live source in the design-lab worktree (`/Volumes/LaCie/Luca-Development/worktrees/luca-design-lab/`): sheet + card CSS at `desktop/src/shared/styles/globals/conversation-shell.css:781–851`, send control at `desktop/src/features/messages/ui/MessageComposer.tsx:1139–1153`, pending row at `desktop/src/features/messages/ui/MessageRow.tsx:520–524`, motion tokens at `desktop/src/shared/styles/globals/motion.css`.

**Three measurements that change the recommendations:**

1. The sheet's `color-mix(in srgb, hsl(--mn-raised) 25%, hsl(--mn-surface))` resolves to **#191919** — ground is #171717 (23), card is #202020 (32). The sheet sits **2 RGB above the ground**. Not "hard to see." Invisible. The earlier 55% mix put it 5 RGB from the card — also invisible. There is no mix ratio that works: you cannot fit three legible planes in a 9-RGB span. Weber at these luminances needs ~6 RGB per step.
2. **No `transition` is declared on the composer's `border-color`** (`:851`). Focus snaps discretely. Every focus/blur is a 1-frame flicker of a 12%-ink hairline.
3. Own sent messages get **no arrival motion at all** — `motion-enter-conversation` is wired only to `useWelcomeKickoffEntrance`. The optimistic row pops in at full opacity. Meanwhile the send button becomes a spinner and the row grows an accent-colored uppercase `SENDING` label. The choreography is inverted: nothing happens where the event *is* (the timeline), and two things happen where it *isn't* (the button).

---

## 1. The state map

Motion vocabulary (extends `motion.css` — add the two missing tokens):

```
--motion-duration-tap:      90ms    /* removal of affordance, press feedback */
--motion-duration-instant: 120ms    /* existing */
--motion-duration-fast:    180ms    /* existing */
--motion-duration-standard:240ms    /* existing */
--motion-ease-standard: cubic-bezier(0.25, 1, 0.5, 1)   /* existing */
--motion-ease-arrival:  cubic-bezier(0.16, 1, 0.3, 1)   /* existing */
--motion-ease-exit:     cubic-bezier(0.4, 0, 1, 1)      /* ADD — accelerate away */
```

**Invariants — true in every state below, no exceptions:**
- The card's **width, radius (12px), and x-position** never change.
- The **send button's center point** never moves. It is the single point a hand aims at hundreds of times a day; it does not scale, translate, or change size in any state.
- The **card's height never transitions.** It jumps by exactly one line-height (24px) when text wraps. A height transition turns every wrap into a 200ms slide and is the single largest cause of "typing feels soggy."
- The **baseline icon row never reacts to focus or content.** It responds only to its own pointer.
- **No state uses `opacity` on the card or the row as a container.** Container opacity kills the lit top edge and reads as a rendering fault.

| State | Visual (exact) | Motion | Never moves |
|---|---|---|---|
| **resting (empty, unfocused)** | card `hsl(--mn-raised)` #202020, `border-color: transparent`, `box-shadow: var(--mn-lit-edge), 0 1px 2px rgb(0 0 0/.08), 0 5px 14px rgb(0 0 0/.09)`, min-height **46px** (note: brief says 48 — code says 46; pick one, 46 is right at 24px leading + 11px padding), radius 12. Placeholder `hsl(--mn-ink-faint)`. Send button 28px, `--mn-plate` (ink/0.035 → ≈#272726), glyph `--mn-ink-ghost`. Baseline glyphs `hsl(--mn-ink-muted / 0.72)`. | none | everything |
| **focused (empty)** | `border-color: transparent → hsl(--mn-ink / 0.12)`. Caret appears. Placeholder **stays** — hiding it on focus is a jump that says "you lost something." | `transition: border-color 120ms var(--motion-ease-standard)` — **border-color ONLY**. Currently missing; add it. | shadow, background, height, send button, baseline row |
| **typing (first glyph)** | Placeholder disappears. `opacity: 0`, **no transition, no duration.** A cross-faded placeholder is the classic latency lie — 150ms of ghost text under the character you just typed. | none | card height (line 1 does not grow anything) |
| **armed (empty → non-empty)** | Send button `background: --mn-plate → hsl(--mn-ink)` (#F4F2EE), glyph `--mn-ink-ghost → hsl(--background)`. | `transition: background-color 140ms var(--motion-ease-standard), color 140ms` on arm; **90ms on disarm.** Asymmetric on purpose — granting an affordance can be gentle, removing one must be quick or fast backspacing strobes. Base `transition-colors` (150ms, symmetric, `button.tsx:8`) must be overridden. **Gate the transition on the boolean crossing `isEmpty`, not on value** — a per-keystroke style recalculation on the hot path is the thing you cannot afford. | No scale. No pop. The arrow does not rotate or fade in. Position fixed. |
| **sending** | Same frame as keydown: text clears, card returns to 46px, sheet dismisses, optimistic row is in the timeline, scroll pinned. Button runs the **90ms disarm** — because the field is now empty. That is the entire button choreography. **Delete the spinner** (`MessageComposer.tsx:1146–1151`). | disarm 90ms only | The field is **not disabled**. The caret does not leave. You can start the next message at t=0. |
| **sent / in flight** | Nothing marks success. The message is on screen; that is the feedback. **Delete the accent `SENDING` label** (`MessageRow.tsx:521–524`) — it fires on every message, is `text-primary/80` (accent as decoration, canon violation), and reads as a warning. | Own row lands: `opacity 0→1, translateY 4px→0, 160ms var(--motion-ease-standard)`. **No blur.** The 500ms blur arrival belongs to a *resident's* turn — someone spoke, that is news. Your own message is not news; it lands, it does not arrive. That asymmetry is the whole grammar. | no scroll animation on own send |
| **pending > 1200ms** | A 3px `--mn-ink-ghost` dot occupies the timestamp slot. Fades in 200ms. On ack: cross-fades to the timestamp, 160ms. | 200ms fade | row text stays full ink — they are still your words |
| **failed > 6000ms** | 1px full-height accent hairline on the row's left edge; `Retry` at `--mn-ink-muted` in the meta row. **This is the composer's only licensed use of the accent.** No toast — the message is visible, put its state on it. | hairline 200ms fade | — |
| **reply-sheet-up** | See §2. | See §2. | card position, send button, baseline row |
| **sheet-dismissed** | See §2. | See §2. | — |
| **disabled (offline / no runtime)** | Card surface **unchanged** — the box stays exactly where it is. Placeholder swaps to the reason ("reconnecting…") at `--mn-ink-ghost`. `caret-color: transparent`. Send stays `--mn-plate` with ink-ghost glyph (2.6:1 — legal only because ink-ghost is decorative-and-disabled-only per the ladder). Baseline glyphs → ink-ghost, no hover plate. | placeholder text swap only, no fade | Never `opacity: .5` on the card. That is the laziest disabled state in the field and it destroys the lit edge. |

---

## 2. The sheet: entrance, exit, swap

**The deck metaphor is right and the shade implementation is what breaks it.** Sheets in a deck are the same paper. They read as separate because of the *seam* where one occludes the next, not because the paper under is a different grey. Stop spending shade on it:

```css
:root[data-luca-shell] .luca-reply-sheet {
  background: hsl(var(--mn-raised));            /* IDENTICAL to the card */
  border-radius: 12px 12px 0 0;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05);  /* match --mn-lit-edge, was .03 */
}
/* The card occludes the sheet — that seam is the depth. */
:root[data-luca-shell] .luca-reply-sheet + [data-testid="message-composer"] {
  box-shadow:
    var(--mn-lit-edge),
    0 -1px 0 rgb(0 0 0 / 0.45),      /* the seam */
    0 1px 2px rgb(0 0 0 / 0),        /* alpha 0, same list length → interpolable */
    0 5px 14px rgb(0 0 0 / 0);
}
```

Two shades, three planes: sheet lit edge on top, dark seam under the sheet's bottom edge, card floating clear. This survives any palette retune; the 25% mix does not.

Note the existing sheet-up rule **drops two shadow layers outright** — the card visibly flattens the instant the sheet appears. Keeping the list at four entries with alpha 0 makes `box-shadow` interpolable; add `transition: box-shadow 240ms var(--motion-ease-standard)`.

### Entrance — the deck demands a clip, and this is what 220ms + translateY(10px) is missing

A thing that fades in 10px above the card is *a thing appearing above the card*. A thing pulled from behind the card is **revealed**, not translated. The motion has to be a clip.

```css
.luca-sheet-deck {                    /* wrapper around the sheet */
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 240ms var(--motion-ease-arrival);
}
.luca-sheet-deck[data-open="true"] { grid-template-rows: 1fr; }
.luca-sheet-deck > * { min-height: 0; overflow: hidden; }
```

- Plane reveal: `0fr → 1fr`, **240ms `cubic-bezier(0.16, 1, 0.3, 1)`**.
- Content: `opacity 0 → 1, 120ms linear, delay 60ms`. The plane exists first, then the words. Words that slide are words you can't read; a plane that opens then fills is a drawer.
- **No transform on the sheet itself.** The clip is the motion. Remove `translateY(10px)`.
- Reduced motion: `transition: none`, `grid-template-rows: 1fr` — currently handled correctly, keep it.

### Exit — it slides back down behind the card, never fades in place

Fading in place says the thing was never real. Sliding behind says it went back into the deck.

- Plane: `1fr → 0fr`, **180ms `cubic-bezier(0.4, 0, 1, 1)`** (accelerate away; exits are 0.75× the entrance and use the opposite curve).
- Content: `opacity → 0, 90ms, delay 0`. **Words leave first, then the plane closes** — the exact inverse of entrance ordering. This is what makes the two motions read as one reversible gesture rather than two animations.
- Card shadow returns over the same 180ms via the interpolable list above.
- The clip makes the down-slide automatic. No separate transform.

### Swap (replying to A, then clicking reply on B while up)

**The plane must not close and reopen.** This is the field's most common composer bug: a state change re-runs the entrance, the composer jumps twice, and the user's eye is thrown to a box that didn't need to move.

- Both rows are one line → **height does not change.** Only the text swaps:
  - outgoing name: `opacity 1→0, 70ms var(--motion-ease-exit)`
  - swap content
  - incoming name: `opacity 0→1, 110ms var(--motion-ease-standard), delay 40ms` + `translateY(3px→0)` on the incoming node only.
  - Total 220ms, zero layout change, the × button does not move by a pixel.
- If heights differ (reply → edit, or reply → a 2-line attached-context sheet): animate the deck between the two measured heights over **200ms `--motion-ease-standard`** while cross-fading. Never close-then-open.
- **Rapid swap must be interruptible.** Clicking reply on five messages in two seconds: cancel the outgoing fade, take the node at whatever opacity it currently holds, continue up. Never queue. Use Web Animations `.cancel()` or a spring; a CSS transition restarting from a mid-value does this for free if you only ever set the target.

### The future deck (editing / attached context / audience note)

- **Cap at two visible sheets.** A third collapses the oldest to a 4px lip — its lit edge visible, contents clipped. Past two sheets the composer stops being thin, which is the entire brief.
- Sheet 2 takes the **same shade** as sheet 1, separated by a 1px seam at `rgb(0 0 0 / 0.35)`. Depth-by-seam scales to N planes; depth-by-shade ran out at three.
- The audience note ("ziggy will be brought in") does **not** belong in the deck. It is not a modal context you cancel — it is a consequence of what you typed. It belongs on the naked baseline row, right side, where Claude Code puts model/effort. Your own composer-notes.md already reached this conclusion; the deck should not swallow it.

---

## 3. The send moment

The single most-repeated interaction in the app gets the least motion in the app. Budget in frames (16.7ms at 60Hz; halve at 120Hz).

| Phase | t | What happens | Budget |
|---|---|---|---|
| 0 — keydown | 0ms | **Synchronously, in one React commit:** read content, clear editor, reset height, close sheet, insert optimistic row, pin scroll. | — |
| 1 — first paint | ≤16ms | Field empty, caret still in field, disarm running. Optimistic row painted at final position. No scroll animation. | **≤1 frame, hard** |
| 2 — land | 16–176ms | Own row: `opacity 0→1 + translateY 4px→0, 160ms --motion-ease-standard`. Sheet exit (180ms) runs **concurrently**. | 180ms |
| 3 — ack | 0–400ms typical | **Nothing visible changes.** Successful sends have no success animation. | — |
| 4 — slow | >1200ms | Pending dot fades in over 200ms at the timestamp slot. | — |
| 5 — failed | >6000ms | Accent hairline + Retry. | — |

**The hard rule: no `await` before the field clears.** Signing is ~1ms but if it sits in a promise chain ahead of the clear, you have built lag into the gesture people perform 300 times a day. Sign after the paint.

**Phases 2 and the sheet exit must not be staggered.** They are at opposite ends of the screen and both must finish by ~180ms. That simultaneity is what makes send read as *one event* rather than a sequence of consequences.

**Does the message fly to the timeline? No.** Three reasons, in order of weight:
1. It would travel ~60px vertically and 0px horizontally, at the same font size, same left alignment, same measure — animating a thing to nearly where it already is reads as a stutter, not a flight.
2. FLIP requires a synchronous layout read of both nodes on the hot path. That is exactly the frame you cannot spend.
3. It dramatizes an action performed hundreds of times daily. iMessage earns the fly because the bubble genuinely changes shape, color, and *side*. Ours changes nothing. The field clears and the row is already there.

**Enter on empty input: nothing.** No shake, no flash, no border pulse, no error. The caret does not move. The one permitted response: if the field is empty *and* a sheet is up, Enter dismisses the sheet (sharing Esc's job). Shake-on-empty is the field's favorite mistake — it punishes a keystroke that cost nothing and had no intent behind it.

---

## 4. Micro-feel

**Keystroke latency**
- Budget: keydown → glyph ≤ **1 frame**. Non-negotiable; everything else in this document is subordinate to it.
- Nothing in the composer may run a transition triggered per keystroke. The armed fill is gated on the `isEmpty` boolean crossing, not the value.
- Draft persistence: **400ms trailing debounce**, plus a write on blur and unmount. Never a synchronous storage write on keydown.
- Measure with DevTools **closed** and no per-keystroke logging — an open inspector inflates ProseMirror transaction cost several-fold and has sent more than one team chasing a phantom (repo `CLAUDE.md` gotcha #7 applies directly here).
- The `max-h-40` (160px) overflow scroller is the right growth mechanism — growth is free until the ceiling. Keep it. Never put a transition on the card's height.

**The caret**
- 2px, `hsl(var(--mn-ink))`. **Never the accent** — a colored caret is decorative color, and it blinks, which makes it decorative *motion* too.
- Use the OS blink (~1.06s on macOS). Do not custom-animate it: it costs a rAF loop that runs forever and it desyncs from every other caret on the machine.
- `caret-color: transparent` when disabled.
- On focus: caret goes to the **end of the draft**, always. Never select-all.

**Naked baseline icons** (the hardest surface in the composer — no box, so no hit-target legibility)

| State | Value | Motion |
|---|---|---|
| rest | glyph 16px, `hsl(--mn-ink-muted / 0.72)` | — |
| hover | glyph → `hsl(--mn-ink-muted)` + a **26px round plate** at `hsl(--mn-ink / 0.05)`, radius 999px | `90ms linear` on both. The plate is the point: hover is the only moment you may draw a hit target, and without it a naked glyph row has no discoverable affordance. |
| press | plate → `hsl(--mn-ink / 0.09)` | 0ms (instant on pointerdown, 90ms release). **No scale** — scale on a 16px glyph is illegible and reads as jitter. |
| focus (kbd) | plate at 0.05 + `border: 1px solid hsl(--mn-ink / 0.5)` on the plate | 120ms. **Remove the inherited `focus-visible:ring-1 ring-ring`** from `button.tsx:8` here — a ring is a second, offset outline; canon focus is the element's own border brightening in place. |
| disabled | ink-ghost, no plate on hover, `cursor: default` | none |

Layout: row height 28px, 26px targets at 4px gap (30px pitch), `margin-top: 6px` from the card. Align the first glyph's **optical** left edge to the placeholder's first letter — a 16px lucide glyph centered in a 26px plate needs about −5px negative inline-start margin to land there. Align the box and it will look 5px wrong forever.

**Scroll when the input grows**
- **At bottom:** timeline stays pinned; content shifts up by exactly the growth (24px), **instantly**. Smooth scroll here is nauseating because it fires once per wrapped line while you are still typing.
- **Not at bottom:** composer growth must move the timeline **zero pixels**. Anchor scroll to the viewport top.
- The `useComposerHeightPadding` ResizeObserver is the correct mechanism (fires after layout, before paint). Keep the `Math.abs(padding - lastPadding) <= 1` guard — without it the last message shudders per keystroke.
- Past 160px: internal scroll, thumb at `--mn-border-strong` (already global). **No edge mask** — a fade on composer text is a lie about where your own words end.
- Shift+Enter at the ceiling: scroll the internal scroller to the caret, 0ms.
- Smooth scroll (240ms `--motion-ease-standard`) is licensed for exactly one event: a message *arriving* while you are near bottom.

---

## 5. Top 3 changes, ranked

**1. Rebuild the sheet's depth on a seam instead of a shade.** `background: hsl(var(--mn-raised))` — identical to the card. Lit edge `.03 → .05`. Card gains `0 -1px 0 rgb(0 0 0 / 0.45)` while a sheet is present, with its two downward layers kept in the list at alpha 0 so `box-shadow` interpolates over 240ms. Three planes from two shades. Ship-blocking, and it is the only version of this that survives a palette retune.

**2. Replace the 220ms translate+fade with a clipped reveal.** Wrapper `grid-template-rows: 0fr → 1fr` over **240ms `cubic-bezier(0.16,1,0.3,1)`**, child `min-height:0; overflow:hidden`; content in at **120ms, 60ms delay**. Exit `1fr → 0fr` over **180ms `cubic-bezier(0.4,0,1,1)`**, content out at **90ms, 0 delay**. Swap = cross-fade only, out 70ms / in 110ms @40ms, height animated only when it actually differs, never close-and-reopen.

**3. Strip the send moment down to latency.** Delete the spinner (`MessageComposer.tsx:1146–1151`) and the accent `SENDING` label (`MessageRow.tsx:521–524`). Button only fills and unfills: 140ms arm / 90ms disarm, position fixed forever. Own message lands `opacity + 4px / 160ms`, no blur. Success gets no animation. Pending discloses at 1200ms, failure at 6000ms. Field clears before any promise resolves.

*(Bonus, one line: add `transition: border-color 120ms var(--motion-ease-standard)` to the composer — focus currently snaps.)*

**What the composer needs from the palette, if you retune it:** for shade alone to carry a plane at these luminances you need ≥6 RGB per step. Today: floor #0E0E0E (14) → ground #171717 (23) → card #202020 (32) — that is 9 and 9, which is enough for *two* boundaries and no more. If you want the sheet to be its own shade rather than seam-separated, the ground must drop to ~#141414 (20) and the card rise to ~#232323 (35): 20 / 27 / 35, gaps of 7 and 8. Until then, do not spend shade on the sheet — the deck can grow to four planes on seams and cannot grow past three on shades. The "flat/muddled" feeling is the same fact from the other side: the whole product is living inside an 18-RGB span, and every new plane makes it flatter.

---

## The thing the whole field gets wrong

Composers are designed as forms, and treated as the thing you are using. They are not. **The composer is where your attention isn't** — you are looking at what you are writing and at what came back. Every animation in a composer is therefore an animation in **peripheral vision**, which is the part of the visual system most sensitive to motion and least able to resolve it. That is precisely why the industry's composer flourishes — spinners on send, springy send buttons, shake-on-empty, morphing placeholders, the message flying into the timeline — all feel cheap after a week. They are motion in the periphery, announcing events you already know happened because you caused them.

The correct budget: **motion for state you did not initiate, none for state you did.** A sheet rising because you clicked reply is initiated — but its plane is genuinely new information, so it earns 240ms. A send is not information; you pressed the key. It earns zero.

The measure of a great composer is that after 300 sends you cannot describe what it did. Emil's rule states it as duration; the composer version is stricter: at the keystroke level, **latency is the only feel there is**, and every 200ms of decoration is 200ms you did not spend getting the first paint down to one frame.