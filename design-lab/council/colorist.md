## 1. Diagnosis

**It is a span problem masquerading as a count problem. It is not a curve problem.**

Measured, current ladder (CIE L\*, D65, sRGB):

| role | hex | L\* | Δ from below |
|---|---|---|---|
| floor/sidebar | `#0e0e0e` | 3.97 | — |
| ground | `#171717` | 7.74 | **3.77** |
| raised | `#202020` | 12.25 | **4.51** |
| hover | `#282828` | 16.11 | **3.86** |
| overlay | `#313131` | 20.33 | **4.21** |

The steps are already near-perceptually-uniform (3.77–4.51 L\*, σ ≈ 0.30). sRGB's ≈2.2 gamma does the linearization for you at this altitude — 9 RGB points buys ~4 L\* whether you spend it at value 14 or value 49. **So the curve is fine. Stop looking there.**

The failure is allocation. Total span floor→overlay is 16.4 L\* spread over 5 rungs, average 4.1 L\* — but the reference apps spend *more span across fewer rungs where layers actually co-occur*:

- ChatGPT: `#171717`(7.74) → `#212121`(12.74) → `#303030`(19.87). Steps **5.00 / 7.13**. Span 12.1 L\* over three co-visible planes.
- Claude: 11.34 → 15.09 → 19.80. Steps **3.76 / 4.71**.
- Linear: 4.63 → 6.71 → 10.74. Steps **2.08 / 4.03** — and Linear is not a counterexample, it's a *proof*: at 2.08 L\* the plane is not doing the work, the 1px hairline is. Forbid hairlines and you inherit Linear's spans without Linear's separation mechanism. That is the single most consequential thing in this whole review.

The acute symptom is the arithmetic of three-in-a-row. Ground→card is 4.51 L\*. Any sheet between them gets ~2.25 L\* on each side. **2.25 L\* against a large adjacent field with a soft/rounded edge is at or below the segmentation threshold** — the eye can *detect* the edge (edge-detection thresholds are ~1 L\*) but cannot *assign it to a plane*. You get a smudge, not a layer. That is literally "muddled."

**What a borderless dark system needs per adjacent step (my numbers, use them as law):**

- **≥ 4.5 L\*** for any two structural planes that share an edge. (Bordered systems can run 2.0–2.5; the hairline carries segmentation. You pay ~1.8× for no borders.)
- **≥ 6.0 L\*** for the largest edge on screen — sidebar↔ground, a full-height boundary where the eye has hundreds of pixels of edge and nothing else to look at. Yours is the *weakest* step (3.77) at the *strongest* location. That is the macro-scale "flat."
- **≥ 9.0 L\*** total between any pair that must host a third plane between them.
- **~3.0–3.5 L\*** is sufficient for *transient state* (hover/press) — the cursor and the timing carry it. States can be cheaper than structure.
- Small objects need more: an object below ~10% of viewport area against a full-bleed ground wants +1–2 L\* over the structural minimum. Area is part of the contrast equation and the field routinely forgets it.

Secondary finding: the bottom of the ladder is where span buys the least. At 160 nits white, `#0e0e0e`→`#171717` is 0.70→1.28 cd/m². In a normally-lit room, panel veiling glare (~1–2 cd/m²) adds a constant to both and crushes the ratio. Steps at the floor need to be *bigger in L\**, not smaller, to survive ambient. Yours are the smallest.

## 2. The corrected ladder

**Decision: the sheet sits BETWEEN ground and card — and the card must rise to `#2f2f2f` to make room.** Not because the sheet needs a nicer number, but because a plane that rises from behind the card is by definition at lower elevation than the card and higher than the ground; putting it "beyond" the card inverts the physics and you'd be lighting the back plane brighter than the front one. Widen the span instead.

| role | hex | L\* | Δ | notes |
|---|---|---|---|---|
| **floor** / sidebar / titlebar | `#0e0e0e` | 3.97 | — | unchanged; the anchor stays |
| **ground** / conversation | `#1c1c1c` | 10.27 | **+6.30** | was `#171717`; buys the biggest edge on screen |
| **sheet** / reply riser | `#252525` | 14.68 | **+4.41** | new tier |
| **raised** / composer card, tiles | `#2f2f2f` | 19.40 | **+4.72** | was `#202020`; lands within 0.5 L\* of ChatGPT's `#303030` composer |
| **hover on raised** | `#383838` | 23.52 | +4.12 | |
| **hover on ground** (rows) | `#232323` | 13.71 | +3.45 | transient, so sub-4.5 is legal |
| **overlay** / menus, popovers | `#3a3a3a` | 24.42 | — | over scrim `rgba(0,0,0,0.5)` |

Ground→raised span: **9.13 L\***. Three planes, all ≥4.4 apart, all legible simultaneously. Every value R=G=B.

Overlay math: the scrim takes `#1c1c1c` down to `#0e0e0e`, so the overlay reads at **20.45 L\*** above its scrimmed backdrop — enormous, correct, and it means the overlay never needs to out-run the composer card in absolute terms. `#383838` (hover-on-raised) and `#3a3a3a` (overlay) are 0.90 L\* apart and never abut; that's fine, not a collision.

Contrast check with cream ink `#F4F3F0`: 15.36:1 on ground, 13.81 on sheet, 12.07 on raised. All far above AA. Raising the ladder costs you nothing legible.

**Option B, if the card is immovable** (one new value, no other changes): make the sheet a *recess* rather than a riser — `#0f0f0f` (L\* 4.32) under a ground of `#171717`, i.e. the reply opens a well below the conversation instead of a shelf above it. Δ 3.42 downward. This works — apertures read as depth as reliably as risers — but it is the weaker idea, because a recess reads as "the app opened a hole" rather than "your reply came forward." I'd take it only under schedule pressure.

## 3. The lit edge

The current spec is `inset 0 1px 0 rgba(255,255,255,0.05)` at a fixed alpha, and fixed alpha is the bug. A constant alpha over a variable base produces a *variable* perceptual lift: 5.45 L\* on `#0f0f0f`, 4.57 L\* on `#2f2f2f`. Worse, on very dark bases a +12 RGB line has no plausible physical referent — it doesn't look like a lit chamfer, it looks like a dirty pixel row. That's your grime.

**Calibrate the edge by its ΔL\* over its own surface, not by alpha:**

| ΔL\* over base | reads as |
|---|---|
| < 3.5 | invisible / mistaken for banding |
| **5.0 – 7.0** | **intentional light on a chamfer — the target** |
| 8 – 10 | a drawn rule, borderline |
| > 10 | grime / a border you claimed not to have |

Alphas that hold ΔL\* ≈ 6.5 constant across the ladder:

- on `#1c1c1c` (ground-level objects): **α 0.058**
- on `#252525` (sheet): **α 0.063**
- on `#2f2f2f` (card): **α 0.068**

Ship it as **α 0.06 at ground/sheet altitude, 0.07 at raised/overlay altitude.** Do not use a single global 0.05 — it under-lights the card and over-lights anything near the floor.

**Who carries it:** the edge means *this plane's top has risen into the light*. So:

- **Yes:** composer card, the sheet (critically — its top edge is the only part of it you see, it is the entire cue that a second plane exists), tiles, overlays/menus.
- **No:** the ground and the floor (they aren't objects, they're the world). No hover states — a lit edge appearing on hover reads as a flicker, and hover is already carried by 3.45 L\*. No pressed states — on press the edge should *go out* (drop to α 0.02), which is the cheapest, most physical press affordance in the system.

## 4. Is the cream ink guilty?

**Mostly innocent as hue. Guilty as an alpha cascade.**

`#F4F3F0` in OKLCH is L 0.964, **C 0.0041**, h 91°. That chroma is roughly an order of magnitude below the just-noticeable tint threshold for text at reading size. It will not gray your surfaces. The theoretical simultaneous-contrast worry — large warm ink field inducing a complementary cool cast in the surrounding neutral — is real physics but at C 0.0041 the induced shift is well under 0.001 chroma. Not your problem. Keep the cream.

What *is* muddling things is that the ink cascade is presumably alpha over surface, so one semantic role resolves to a different color and a different contrast on every tier:

| role | on `#1c1c1c` | on `#252525` | on `#2f2f2f` |
|---|---|---|---|
| primary (100%) | 15.36:1 | 13.81:1 | 12.07:1 |
| secondary (72%) | 8.50:1 | 7.82:1 | 7.06:1 |
| muted (55%) | 5.49:1 | 5.19:1 | **4.81:1** |
| faint (40%) | 3.54:1 | 3.43:1 | **3.26:1** |

A 21% contrast swing on "primary" across tiers, and the faint role sits **below 4.5:1 everywhere** — under AA for body text. Low-contrast type over a low-contrast surface stack is precisely the sensation "muddled"; the ink is dragging the surfaces down with it. And note the widened ladder makes this *worse*, not better, which is why it must be fixed in the same pass.

**Fix:** resolve ink to opaque hexes per tier (or, at minimum, define alpha per tier so the resolved contrast is constant). Target 15.0:1 / 8.5:1 / 5.5:1 / 4.5:1 on every surface. On `#2f2f2f` that means muted becomes ~59% and faint ~52%, not 55/40.

## 5. Top three changes, ranked

1. **Widen ground→raised from 4.51 to 9.13 L\*.** `ground #171717 → #1c1c1c`, `raised #202020 → #2f2f2f`, and insert `sheet #252525`. This is the whole fix for the composer, and it's simultaneously the fix for "flat" — it puts the system's registration where ChatGPT's is (card within 0.5 L\* of `#303030`) while keeping the deeper `#0e0e0e` floor the owner earned.
2. **Give the sidebar↔ground edge 6.30 L\* instead of 3.77.** Falls out of change 1 for free. It's the longest edge in the app and it currently has the weakest step in the ladder — that inversion is most of the macro "flatness."
3. **Re-spec the lit edge by ΔL\*, not alpha: α 0.06 at ground/sheet, 0.07 at raised** (targeting ~6.5 L\* over base), applied only to planes with a visible risen top edge, extinguished to 0.02 on press. Pair it with resolving the ink cascade per tier so "muted" is 5.5:1 on all three surfaces instead of drifting 5.49 → 4.81.

## What the field gets wrong

**Ladders are validated in a swatch strip and shipped into a layout.** In a strip, two 50%-area rectangles meet along a hard, straight, full-length edge — the single most favorable condition human vision has for lightness comparison. Every step looks obvious. Then the same values ship as a 40px rounded chip floating in a full-bleed ground, and the step that was unmistakable at 50/50 with a hard edge is invisible at 2/98 with an 8px radius. Discriminability scales with shared edge length and with the smaller field's area; a step is not a property of two colors, it's a property of two colors *plus the geometry between them*. Validate every rung at its real size, on its real neighbor, at 40% display brightness in a lit room — never in a palette strip.

The corollary the field also gets wrong: Material's translucent-white elevation overlays. They compound when layers nest (a card in a sheet in a dialog silently lands three overlays deep and drifts off-ladder), and they make every surface's true value a function of what happens to be behind it. **Opaque planes at fixed values.** Elevation is a set of named altitudes, not a stack of veils.

*Verification note: all values above are computed colorimetrically (CIE L\*, WCAG ratios, sRGB compositing) — I have not viewed the running app. This checkout (`luca-agent-network-v1`, branch `agent/identity-glyphs`) still carries the old Catppuccin/Buzz tokens in `desktop/src/shared/styles/globals/theme.css`; the shipping neutral ladder is not in this working tree, so the hexes I diagnosed are the ones supplied in the brief, not ones I read from source. Before committing, confirm the token names in the canonical worktree and re-check the sheet against a real reply-open at 40% brightness.*