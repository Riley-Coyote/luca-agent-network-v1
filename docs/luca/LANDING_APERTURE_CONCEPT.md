# The Aperture — landing page hero concept

**Status:** Concept from the council of 2026-09-02 (polychat room "Polyphonic
landing — the unforgettable page"), **prototyped the same day** as one self-contained
file: `design-artifacts/landing/aperture.html` (open it in a browser; `?debug` shows
coupling, order parameter, lock, fps; `window.__tune` dials the field live).
Supersedes the hero guidance in `Polyphonic_Landing_Page_Blueprint.md` §8 Section 01
where the two disagree; every other blueprint section (copy, claim boundary, §6
narrative principles, sections 02–14) still governs.

## What the prototype taught (deviations from the room)

- **Runtimes, not just identities** (Riley, after the council): the five sources are
  five residents on five different runtimes — Wren · Claude Code, Sol · Codex, Iris ·
  Hermes, Ferro · OpenClaw, Kit · Grok — with the runtime set in type under each glyph
  and a runtime strip in the hero. No third-party marks are drawn; names only.
- **The wavelength is constrained by the emitter.** A 42px glyph radiating at a 64px
  wavelength cancels itself in-plane (≈236° of phase across the aperture). λ must be
  ≳2× the glyph; the prototype uses 110px at ratio 1. Finer lace needs a smaller
  emitter or a larger screen, not a shorter λ.
- **Phase lag slows the locked tempo.** With α = 0.3 the five lock to ≈0.8× the base
  tempo (Kuramoto frustration), so the locked field is broader and calmer than the
  unlocked one. This is physics, and it reads right.
- **The light model needs a ground.** Pure rim lighting gave isolated bright clouds on
  black. A faint ambient lattice everywhere (the "solid"), rims above it, troughs
  below it to black, is what reads as a machined surface.
- **The Canvas 2D engine was not used** for the field; the field is two WebGL2 passes
  (lattice-resolution field + persistence, then one dot per cell with the cutout).
  The identity glyph generator was ported verbatim.
- **Two plumbing bugs worth remembering.** (1) Priming the loop by calling the frame
  function directly stacked sixty animation loops — sixty renders per frame and a
  meaningless fps readout; the frame and the scheduler are now separate functions.
  (2) `requestAnimationFrame` stamps the frame's *start*, which can precede a
  wall-clock `lastT` set during a long script; the resulting negative Δt walked the
  phases backwards and flipped the sign of the frequency smoothing, so a fixed-point
  system appeared to wobble. Δt is clamped to (0, 50 ms]. The tell was a recorded
  phase step larger than the equation can produce — simulate the equation alone to
  separate physics from plumbing.

## Verified (2026-09-02, Playwright, real Chromium, software GL)

Desktop 1440×900 at every beat; 390×844 mobile (no horizontal overflow, sources
re-laid as a row, traces hidden); `prefers-reduced-motion` (locked field from first
paint, re-rendered on scroll only); chord button toggles; type flush on the cutout's
straight edge (aperture, headline and cutout left all at 175.33px); lock reaches
r ≈ 0.985 with zero frequency spread; zero page errors. The in-app Browser pane is
**not** a valid check for this page — a hidden pane pauses animation frames and
reports a zero-height document.

## Thesis

**Order through relationship, not fusion.** Five distinct clocks keeping one time
without showing the same hour. This is Polyphonic's product thesis (coordination
without erasing individuality) stated in the substrate of the page.

The law that governs every frame: **the voices never merge.** No beat may collapse
the five sources into one waveform, glyph, voice, or centre.

## What died in the room

- Particles swirling into a logo (the 2026 AI-landing cliché).
- "The nodal lines form the headline" — dust that spells is the same cliché in a
  lab coat.
- Chladni dust as the medium. Physics: dust gathers where a plate is *still*, so a
  dustless still rectangle is impossible; and superposing incommensurate sources
  gets muddier, never cleaner. "Adding voices produces order" is a lie.
- The 600 ms black hold on load. A landing page cannot demand museum etiquette;
  the promise exists at first paint and the opening motion is interruptible.
- Cursor-as-weight. It taught none of the four things (plurality, authority,
  continuity, coordination). Under the pointer, nothing happens.

## The field

A phase-lagged Kuramoto wavefield. Five sources at their own natural frequencies:

```
θ̇ᵢ = ωᵢ + (K/N) · Σⱼ Aᵢⱼ · sin(θⱼ − θᵢ − αᵢⱼ)
```

- Five phases updated on the CPU. The summed wave amplitude shaded per pixel in a
  fragment shader. One feedback texture carries phosphor persistence (house law 1).
  **No particle simulation.** Trivial next to a 200k-point field.
- **Luca is K** — the coupling strength/topology — not a sixth voice. Scroll raises K.
- Below the lock threshold the interference slips and washes (fragmentation). As K
  crosses threshold the sources frequency-lock while keeping stable phase offsets;
  the field stops crawling and grows persistent, slowly breathing corridors.
- **Lighting (Sculptor):** one hard cold key at ~8° off upper-left, applied to the
  field's *slope*. Crests catch a thin bright rim; troughs fall to true black
  (`#060608` floor, never `#000`). Locked corridors read as troughs cut into a
  solid — a machined surface a few millimetres deep, breathing. One shading term.
- The existing `chladni` lab scene is an analytic drawing, not plate mechanics.
  This is a **new WebGL scene**. The Canvas 2D engine stays for product-scale sigils.

## The sources

Each resident's 7×7 identity glyph (`desktop/src/shared/ui/dot-display/identity/`)
**is the emitter's spatial aperture** — a tiny coherent radiator. Every occupied
stroke emits at that resident's phase; by Huygens' principle each glyph shape
produces its own anisotropic diffraction fingerprint in the field.

- Identity stays **joined and solid** at the source. Activity is the **dotted** field
  it radiates. The house rule ("identity is joined, activity is dotted") is honoured
  by physics, not styling.
- At lock the glyph does **not** brighten, morph, or connect to anything. Its
  near-field halo changes from phase-slipping (beats hesitating, reversing) to a
  steady outward cadence at the common tempo, at its own offset. **The visible event
  is the cessation of drift.**

## The cutout

No field is rendered where the type sits. It is an aperture, not a clearing.

- Twelve-column grid. The aperture spans columns 2–7.
- Headline flush-left on column 2. Inter Tight ~300, one decisive display size,
  measure ≤ 30 characters. Mono index line above it at ~0.18em tracking on the same
  alignment axis. Margin: one unit above the type, four below and to the right —
  silence accumulates down-right.
- **Left edge machine-straight on the column.** The other three edges are an
  **iso-contour of field amplitude, quantized to the dot pitch** — never a spline,
  never Perlin. Each frame the boundary gives up or takes back one lattice cell at
  threshold. Uncoupled, the edges churn cell by cell. Locked, they settle into
  scallops breathing on the beat frequency. Raggedness is a function of K.
- **The type is present at first paint and never moves.** Not a reveal, not a
  re-form, not a breath. Unchanged at second 60. The field is alive so the words
  can be certain.

## The beats (Motion Director)

| # | Beat | K | Sources | Aperture | Field | The eye sees |
|---|---|---|---|---|---|---|
| 1 | First paint | 0 | five on | six columns | 100% | Five glyphs beat independently around immovable type |
| 2 | Fragmentation | below lock | five on | fixed | 100% | Corridors crawl — plurality without coordination |
| 3 | Alignment | crosses threshold | five on | +1 column | 90% | Stable corridors emerge; phases remain distinct |
| 4 | Match-cut | locks | five on | expands to the real window | 55% | Five traces cross the glass and land on five resident identities |
| 5 | Silence | held | — | full | frozen | 900 ms. Nothing performs. The real interface holds |
| 6 | Workflow | holds | activate in speaking order | full-frame | 12% | Signed contributions accumulate in one room |
| 7 | Architecture & trust | relational | only granted sources | full-frame | 0–8% | Brain and Notebooks; authority and continuity |
| 8 | Final CTA | locked | five on | six columns, column 2 | 70% | Same words. Five emitters on the type's baseline, extended right, unequally spaced by phase lag. **The three edges have stopped moving. Only the five lights still beat, out of phase.** |

The match-cut (beat 4): the aperture widens; at its exact boundary the frame cuts
to a real Polyphonic window. Field stays outside the glass. The cutout makes this
exact rather than decorative — there was never anything rendered there. Then the
900 ms of silence is when the visitor realises the spectacle was a diagram.

The Director's test, applied to every beat: if it does not teach plurality,
authority, continuity, or coordination, it is cut.

## Sound

Off on load, always. One button: *hear the chord.* With locked oscillators the five
natural frequencies are literally a chord; the button plays the real ratios on
screen or it does not exist.

## Budget and fallbacks

- Desktop: 60 fps target on an M1 Air. Device-pixel ratio capped ~1.5. Adaptive
  density. Modest bloom at most.
- Phone: 30 fps, no bloom, no cursor physics.
- Reduced motion / thermal pressure: settled-frame fallback (beat 8's frame).

## Open

- Where the page lives and how product screenshots are sourced — untouched by the
  council; the blueprint's proof pipeline (`desktop/tests/e2e/marketing-*.spec.ts`,
  `northstar.v1` fixtures) is the starting point.
- The five residents shown: which glyphs, which names, which runtimes. The blueprint
  scenario (Hermes strategist, native researcher, OpenClaw builder, plus Luca and the
  owner) suggests the cast.
- Exact headline copy. The blueprint's "Your entire agent network. One secure place
  to work." is the placeholder.

## Who said what

The Sculptor (Opus): the still place inside the noise; dust that clears not spells;
grazing light. The Motion Director (GPT Sol): recurring instrument not wallpaper;
the match-cut; 900 ms silence; the beat sheet; frame budget. The Complexity
Scientist (GPT Sol, after the Grok seat crashed): Kuramoto; the physical cutout;
glyph as emitter; cessation of drift. The Swiss Critic (Opus): inversion — the
clearing is the figure; the grid; straight-left/ragged-three; iso-contour edges;
the type never moves; the final frame. Host (Fable): the five opening concepts,
the law, the adjudications.
