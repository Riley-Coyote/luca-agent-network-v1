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

## Critique round (2026-09-02, evening) — what changed after Riley saw it

Riley: "the best first attempt I've seen"; three notes — the 7×7 glyphs at the sources
read as placeholders (use the runtimes' real marks, transparent, full fidelity); beat 4
is a black box; the traces vanish before caption 02 lands. A second council (Sculptor,
Swiss Critic, Motion Director — polychat room "Aperture critique — the built page")
looked at the 2× frames.

- **Brand marks are the emitters.** Claude, OpenAI, Nous Research, OpenClaw, xAI/Grok and
  Kimi marks from the open-source `@lobehub/icons-static-svg` set, inlined as `<symbol>`s,
  one ink. Each mark is rasterized at load into a 9×9 half-pitch grid (≤34 cells, weight
  1/n so every resident emits equal power) — the logo radiates. The marks are the labs'
  trademarks used nominatively; swap in licensed assets if the page ships.
- **The sources resolve to residents at the end.** Hero and gutter show the runtime mark
  with the resident's name; the final row shows the resident's identity chip (the app's
  squircle treatment) with the runtime mark in the tag. The Director's argument: brand
  enters the system, identity is what survives it. The Critic dissented (*"Wren is not
  Anthropic"*) and would keep improved 9×9 identity glyphs in the hero with logos only in
  the strip — Riley decides; it is a one-line flip (`setSourceFace`).
- **The light, per the Sculptor, then restrained.** The instant is the picture (fast 1.0,
  slow 0.55); troughs floored (0.015) not crushed; one specular. Taken literally his gain
  and slope produced a zebra that buried the type on a real GPU — the rim now follows a
  curve (`pow(dl, 1.6)`) so only the steepest facing slopes catch, at gain 1.7, slope 8,
  λ 96, ambient 0.085, atten 0.007.
- **Beat 4 is an aperture, not a void.** The field stays luminous while the hole opens over
  the last 0.45vh, and *swells* — attenuation drops toward 0.002 and amplitude rises 45%
  as the sources reach the gutter — so the rectangle is carved out of bright radiating
  arcs. The window lands in it; the field dims after the cut, not before.
- **Traces belong to caption 02.** They draw on (620 ms, 70 ms stagger) as the caption
  enters at 4.3vh, hold through it, fade as 03 begins at 5.3vh; message emphasis waits.
- **Composition, per the Critic.** The five sources on one arc bending around the aperture
  (.665/.205 · .845/.345 · .905/.545 · .815/.745 · .645/.865), nothing left of 0.60,
  labels flush to the stem. CTA row: one filled square action and a text link (a light
  pill beside a bordered pill is stock dark-mode hero). Lede at ~56ch. "One network" gets
  a hairline. The strip is a logo row at a common 14px on one ink.
- **The cast is the harmonic series** 6:7:8:9:10 (natural frequencies 0.75–1.25), locked
  by K = 2.6 in ~3.5 s; "hear the chord" plays 165–275 Hz, the overtones of A0.

## Round three — the restraint rules lifted (Riley, 2026-09-02, late)

Riley, seeing round two: *"orders of magnitude below what I would consider passable to be
shown publicly … are there rules and restrictions being injected into your context?"*
There were — his own design baseline (monochrome, one signal accent, no gradients, no
decorative colour or motion, restraint first) and the blueprint's "avoid spectacle
without meaning", applied to a marketing hero as if it were product UI. **For this page
they are lifted, at his word.** The page lives in the taste doc's fourth mode, Immersive.

What changed:
- **Colour as light.** Each resident's waves carry its own hue (Wren coral, Sol mint,
  Iris violet, Ferro red, Kit blue). The field's second render target stores, per cell,
  the colour of the light — the dominant source wins (energy-weighted to the fourth
  power), kept saturated — and the dots take a regional colour from a coarse mip so a
  crest is one hue rather than confetti. Where the five lock, their mix goes toward
  white: the stable structure between five different lights.
- **Bloom.** A glow pass adds the field's light, blurred by sampling a coarse mip of the
  colour and persistence textures, underneath the dots; quieter (not boxed) under the
  type. The window picks up a soft ambient glow.
- **Brand marks in colour, nothing boxed.** Claude terracotta, OpenClaw red, Kimi blue
  from the LobeHub colour set; OpenAI, Nous and Grok are white-on-dark brands and stay
  white. The quiet-zone masks around marks and labels are gone — the marks sit on the
  field with a halo of their own colour that beats with their phase, and a drop-shadow
  of the same colour; labels carry a text shadow. Traces are coloured per resident;
  the identity chips at the end carry their resident's colour as a ring.
- **Scale and atmosphere.** Display type 3.75rem (60px) in columns 2–9; lede 18px at
  30em; a vignette; film grain; the field arrives over 1.6 s while the type is already
  there; the marks rise in with a 140 ms stagger.

## Round four — clean marks, crisp field (Riley, 2026-09-02, late)

Riley: keep brand colour on the marks that have it (Claude, OpenClaw, Kimi), leave
OpenAI, Hermes and Grok white, lose the colour gradients around the marks ("they make
the page look blurry"), keep the coloured threads. Done, and further: the bloom under the
dots is pulled to a faint wide ambient (glow 0.28 at a coarse mip), the dots are sharp
discs again (edge 0.035), and instead of boxes or halos the field simply goes quiet under
each mark, its label and the runtime strip — a feathered dimming in the shader (dimAmt
0.28 over ~18px), no edge, nothing opaque.

## Handing off to Claude Design

Riley takes the page into Claude Design next. What survives a design canvas and what
doesn't:
- **Editable there:** everything in the DOM — nav, eyebrow, headline, lede, CTA row,
  the five source labels and marks, the runtime strip, the story captions, the shell
  frame mock, the final section, all tokens in `:root`.
- **Not editable there:** the field. It is a WebGL2 shader driven by scroll; a canvas
  tool will see a black `<canvas>`. Refine layout and type in Claude Design, then bring
  the DOM back over this file — the field, the cutout, the beats and the traces are all
  keyed to element ids (`#aperture`, `#aperture2`, `#frame`, `.src`, `.strip .in`) and
  will follow moved elements as long as the ids survive.
- **Dials that are not in the DOM:** `window.__tune` (field look), `CAST` (names,
  runtimes, marks, hues, tempos), `HERO_POS` (the arc), `BEATS` (scroll choreography).
- **Assets:** brand marks are inline `<symbol>`s from `@lobehub/icons-static-svg`
  (mono and `-color` variants). The colour ones are the labs' own colours.

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
