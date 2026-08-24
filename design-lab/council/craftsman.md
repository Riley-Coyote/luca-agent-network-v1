## 1. Optical centering of a single line in a 48px card

The bug is not the flex alignment alone — `items-end` is *correct* for a growing composer. What's missing is that the editor's own line box must carry the centering, and the button must carry an equal gutter.

**Alignment model:** the row is `display:flex; align-items:stretch`. The editor is `flex:1` and centers itself with padding. The button is `align-self:flex-end` with a fixed bottom margin. Nothing uses `items-center`, ever — `items-center` breaks the moment the card grows.

```
card:      min-height 48px; radius 12; padding 0
row:       flex; align-items: stretch; gap: 0
editor:    flex:1; font-size 16px; line-height 24px;
           padding: 11px 50px 13px 16px;      /* 11+24+13 = 48 */
           max-height 168px (7 lines) then overflow-y auto
button:    28px; align-self: flex-end; margin: 0 10px 10px 0
```

**Why 11/13 and not 12/12.** Geometric center puts the 24px line box at 12/12. But the perceived mass of a line of Latin — cap-and-x-height above the baseline, descenders on only ~8% of glyphs in typical English — sits *below* the line-box center. Raising the block 1px puts the optical center on the card's center. At 2× it's a 2-device-pixel correction, which is exactly the magnitude this class of error lives at. Do not round it to zero because it "looks fine at 1×."

**Right padding 50px** = 28 (button) + 10 (gutter) + 12 (caret clearance). The caret must never approach the button; 12px is the minimum that reads as "two objects," not "text hitting a wall."

**Growth.** The card is bottom-anchored: it grows *upward*, top edge moving, bottom edge and the button frozen. Padding stays 11/13 (the correction is applied to the block, not the first line). Radius stays 12 at all heights — never scale radius with height.

**Where the send button goes.** Nowhere. `margin-bottom: 10px` on a 28px button in a 48px card is `(48−28)/2 = 10` — so at single line it reads perfectly centered, and at seven lines it reads anchored to the bottom-right corner with an identical gutter. This is the whole trick: **the button's bottom gutter and its single-line centering offset are the same number.** You get "centered" and "pinned" from one value, and the button never moves relative to the card's bottom edge — which is the only edge the eye is tracking.

Hit area: keep the 28px visual, extend to 44×40 with `::after { content:''; position:absolute; inset:-6px -8px }`.

## 2. The sheet: shade cannot carry it, and the sheet should not exist

**The arithmetic, since this is a measurable question.** In CIE L\*, your ladder (`conversation-shell.css`, the composite ladder block) is:

| | sRGB | L\* |
|---|---|---|
| floor `#0E0E0E` | 14 | 4.0 |
| ground `#171717` | 23 | 7.8 |
| card `#202020` | 32 | 12.3 |
| hover `#282828` | 40 | 16.1 |

Ground→card is **4.5 L\***. Your 55% mix (`#1C1C1C`, L\* 10.3) sat 2.0 L\* under the card. Your 25% mix (`#191919`, L\* ~8.6) sat 0.8 L\* over the ground. The perceptibility floor for two abutting *large* flat fields is ~2 L\*; for a **28px strip**, bounded on one side by an occluding edge and viewed against a dimmable OLED, it is ~3 L\*, and ~5 L\* to be unmistakable at any screen brightness. **Both experiments were killed by arithmetic, not by taste.** There is no third value in that gap. Stop looking for it.

**Minimum span if you insist on a mid-shade sheet:** ground→card ≥ **10 L\*** — `#171717` → `#2B2B2B` — so each of the two steps clears 5. That is more than double your current span.

**What I'd actually do to the ladder** (this is also the answer to "too flat, muddled"): your three conversation surfaces live inside 8.3 L\* total. Three greys within 8 L\* of each other *is* mud — the eye reads them as one surface with dirt on it. Retune to equal 6 L\* steps:

```
floor      #0E0E0E   L* 4.0
ground     #1C1C1C   L* 10.3   (was #171717)
card       #282828   L* 16.1   (was #202020)
hover      #353535   L* 22.1   (was #282828)
```

Every step becomes ~6 L\* — separation you can see across the room, still nowhere near "a stack of grey cards." Re-audit the ink ladder on `#282828`: ink lands ~12.5:1, muted ~7.4, faint ~4.5 (right at AA — you may need to lift `--mn-ink-faint` to `45 3% 62%`). Note that **even at 6 L\* steps the sheet still fails** — a value between ground and card would be 3 L\* from each. Which tells you the real thing:

**The sheet is a category error.** Your own doctrine (`design-lab/composer-notes.md`): *"The card grows for content, never for chrome. Attachments stack inside the card, above the text row."* A reply target is not chrome — it is **payload**. It is the same class of object as an attachment: something that will be transmitted with the message. So it goes inside the card, as a first row, and the card grows. One box. No third layer, no new shade, no border, no rise animation.

```
reply row (inside card, above the editor):
  height 20px; margin: 10px 10px 0 16px; display:flex; align-items:center; gap:6px
  ↩ glyph          12px, --mn-ink-faint
  "Replying to"    12px/16px, --mn-ink-faint, letter-spacing +0.006em
  "Coyote"         12px/16px, --mn-ink-muted        (no body quote — see below)
  ×                20px hit 28px, --mn-ink-faint → --mn-ink on hover, margin-left:auto
card min-height:   48 → 78px   (20 row + 10 top + 48 editor row)
transition:        height 180ms cubic-bezier(0.32, 0.72, 0, 1)
```

Drop the truncated body quote entirely. The message being replied to is visible in the transcript one inch above; repeating it is noise that doubles the card's height for zero information.

**If the sheet must survive anyway** (product reasons I don't know), the craftsman's solution is: *same shade, depth from occlusion.*

- Sheet fill = `#202020`, **identical to the card**. Not a mix. Identity.
- Sheet is **inset 10px per side** — narrower than the card. Things behind are smaller. This is the strongest depth cue available and it costs zero shade.
- Sheet gets **no lit edge**. A receding plane loses the highlight; only the front object catches light.
- The card's existing lit edge goes `5% → 8%` white while a sheet is present (`#2B2B2B` hairline, +5 L\*). **This is not a border** — it is the bevel already in your system doing more work where the composition needs it. That hairline *is* the seam.
- The card casts a real contact shadow up onto the sheet: `box-shadow: 0 -2px 5px -3px rgb(0 0 0 / 0.6), inset 0 1px 0 rgb(255 255 255 / 0.08)`. Ambient occlusion is omnidirectional; stacked paper does exactly this. The gradient at the tuck line is what makes a flat strip read as a plane behind rather than a stripe.
- Exposed strip 16px (tuck stays 14px), radius 10 top (one step under the card's 12 — inner radii step down, never match).

## 3. Type micro-details

- **Typed text:** 16px / 24px, weight **400**, `--mn-ink` (14.5:1 on `#202020`). This is the app's base size; nothing else in the card is a second size.
- **Placeholder:** identical size (16px), identical weight (400), identical tracking. **Only the ink role changes** — `--mn-ink-faint` (5.2:1). This is the canon's whole thesis and the most commonly broken rule in composers: a placeholder set at 15px/300 next to typed 16px/400 makes the field flinch when you start typing. Same glyphs, different opacity, zero geometric change. Never `--mn-ink-ghost` (3.1:1) — that role is for disabled and decoration; a placeholder is an instruction the user must read.
- **Placeholder does not hide on focus.** The composer autofocuses; hide-on-focus means it is never seen. It clears on first keystroke only.
- **Letter-spacing at 16px:** `0.005em` (+0.08px) on dark, `0` in Paper. Light-on-dark irradiation makes strokes bloom and counters close; the correction on a dark ground is a *touch of positive* tracking, not negative. Negative tracking at 16px on `#202020` is the single most common dark-mode typography error. If per-theme tracking isn't available, use `0` — never go negative here.
- **Small-text reciprocal:** 16px → +0.005em; 13px → 0; 11px (`text-2xs`, the naked chrome row) → +0.012em.
- **Caret:** `caret-color: hsl(var(--mn-ink))`, 1px logical, system blink. **Not the accent.** A blue caret in a pure-neutral system is the loudest object on screen and it blinks — it would violate signal-only accent usage sixty times a minute. No custom caret animation.
- **Selection:** `::selection { background: hsl(var(--mn-ink) / 0.16); color: inherit }`. Ink at alpha, not accent.
- **Send button, armed:** fill `--mn-ink` `#F4F3F0`, glyph in **`#202020` (the card's own shade)**, not black. The button then reads as a hole punched through to light rather than a white pill with a dark sticker on it. Disabled: `--mn-plate` fill, glyph `--mn-ink-ghost`.

**One structural note.** You wrote that the card has "no border at rest" but focus-within paints a 12% border, and the composer autofocuses — so the practical resting state *is* a bordered card. Those two sentences describe different products. Pick one, and I'd pick: **the card has no border in any state; it has a blur state instead.** Focused (the default) = `#202020` + lit edge 5%. Blurred (a modal or the transcript took focus) = drop to `#1C1C1C`, lit edge to 3%, placeholder to ink-ghost. Invert the state model to match the reality that this control is almost always focused.

## 4. Top three changes, ranked

**1 — Centering + the shared gutter.** `align-items: stretch`; editor `padding: 11px 50px 13px 16px` with `line-height: 24px`; button `align-self: flex-end; margin: 0 10px 10px 0`. Fixes the low placeholder *and* makes multi-line growth correct in the same stroke. Highest ratio of visible improvement to lines changed.

**2 — Delete the sheet; reply becomes an in-card row.** Card 48 → 78px, 180ms `cubic-bezier(0.32, 0.72, 0, 1)`, reply row 20px at `margin: 10px 10px 0 16px`, "Replying to" ink-faint / name ink-muted at 12px, no body quote, × at 20px ink-faint. Removes the third layer, the 220ms rise, the width-matching problem, and the entire shade dilemma. It is also the only version consistent with the doctrine already written down.

**3 — Widen the ladder to 6 L\* steps.** `#0E0E0E / #1C1C1C / #282828 / #353535`. This is the fix for "flat and muddled" — the current ladder's 3.8–4.5 L\* steps are below the threshold at which surfaces read as *decisions*. Re-audit `--mn-ink-faint` on the new `#282828` card; expect to lift it to `45 3% 62%`.

## 5. What the field gets wrong

**Everyone designs the composer's empty state and lets every other state fall out of it. The correct design object is the caret — specifically, the fact that it must never move.**

The composer is the one element in the app the user operates *while not looking at it*: their eyes are on the transcript or on the words they just typed, and their hands assume the field is where it was a second ago. So the invariant that matters is not "does the empty card look elegant" — it's **the caret's baseline holds a fixed distance from the window's bottom edge, and every state change grows the card upward instead.** Reply attaches: caret doesn't move, the card's top edge rises. Image pastes: caret doesn't move. Second line: the first line rises, the caret stays. Error appears: it appears *above*, pushing the top edge up.

ChatGPT breaks this (the whole composer translates when a state attaches, and the text jumps). Slack breaks it worse (the formatting bar shoves the text down). Claude Code gets it right, which is exactly why Riley keeps pointing at it and describing the feeling as *thin* — what he's actually perceiving is stillness, not slimness.

The corollary: **the send button is not a target, it's a readout.** Enter sends; nobody who types 60wpm reaches for a 28px circle. So the button should be designed as a state indicator — disarmed/armed — and weighted accordingly. Every composer that makes the send button visually dominant has mistaken an instrument panel for a control panel.

---

Files: the ladder lives at `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-canonical/desktop/src/shared/styles/globals/conversation-shell.css` (composite-ladder block, ~lines 33–50; ink ladder ~53–84; `--mn-lit-edge` ~87). The reply banner's committed ancestor is `desktop/src/features/messages/ui/ComposerReplyEditBanner.tsx`, still carrying `border border-b-0 border-border bg-muted` — a bordered banner, i.e. the canon violation the sheet was invented to escape; deleting it and folding the row into `MessageComposer.tsx` retires both. Doctrine that agrees with recommendation 2 is at `/Volumes/LaCie/Luca-Development/worktrees/luca-design-lab/design-lab/composer-notes.md`. Note that the measured 48px/radius-12/sheet composer is not on `agent/typography` or `agent/identity-glyphs` — the values above are prescriptions against the state as reported, not against a file I read.