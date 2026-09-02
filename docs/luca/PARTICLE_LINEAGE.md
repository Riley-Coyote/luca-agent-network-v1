# The Polyphonic particle lineage — what exists, where, and what each is good at

Mapped 2026-09-02 for the landing-page exploration. One engine family, many bodies.
Read this before building any new particle surface for the brand.

## The canonical engine

**"Sovereign Mind — Expressive Field"**, ported from `voice-mode-expressive-v3.html`.
Every surface below shares its DNA, and the Mnemos port says it outright: *"ported
verbatim … so that particles look and behave identically across every surface."*

- CPU JavaScript. Each particle plots **one device pixel** into an `ImageData`
  buffer (additive where pixels overlap), then `putImageData`. No circles, no
  sprites — that is why it reads as grain, not confetti.
- Warm ivory base `rgb(172,168,162)` warming toward gold on excitation
  (`+60,+28,−15` per unit of warmth). A **depth layer** per particle sets base
  brightness; a per-particle **twinkle** (0.75–1.2 Hz) and a global **breath**
  (0.0004 rad/ms) modulate it.
- A **focus point** wanders (or follows the cursor) and lifts brightness nearby.
- **Ripples** — circular fronts that excite particles as they pass; excitation
  spreads by **contagion**; excited particles bloom over a 3×3 kernel.
- Positions are **dt-smoothed toward a home** (per-particle rate variance so the body
  flocks rather than arriving in unison); a **two-octave curl-noise flow** (divergence-
  free, so it moves like fluid, not like a spray) plus per-particle micro-jitter.
- Counts: 30–48k desktop, scaled by viewport area (mobile floor 35–45%); DPR capped
  at 1.25–2. Verified at 60 fps on modern laptops by its authors.

## The bodies

| Where | File | Count | What it does |
|---|---|---|---|
| **Live site** polyphonic.chat, landing | `polyphonic-v2/polyphonic-chat-2/src/components/LandingParticleField.tsx` | 40k | One persistent entity, five states. *idle*: chaotic curl-flow cloud across the viewport, cursor repels. *composer* (input focused): particles organise into a cloud behind the card **with the card's exact rectangle carved out**, so density piles at its edge and reads as a halo conformed to the card — image 5's dust stream along the input. *auth*, *handoff* (first send: outward burst), *dissipate*. |
| Live site, empty thread / voice | `…/src/lib/expressiveField.js` (+ `ExpressiveField.tsx`, `EchoField.tsx`) | 30k / 12k | The full engine: 15 3D shapes (sphere, cube, octahedron, hex prism, torus, blob, Klein, double helix, Lorenz, manifold, echo shells, Möbius, tetra, icosa, hex bipyramid), auto-morph every ~8 s, five spherical-harmonic "cymatic" bands, states idle/listening/speaking/thinking with simulated audio, a dissolve system. This is the LUCA sphere. |
| Live site, agent creation | `…/src/components/agents/AgentCreationShimmer.tsx` | 8–22k | The ceremony: wash (particles emerge across the viewport) → swirl (spiral inward) → coalesce into the agent's identity solid (hashed from its name) → hold, rotating. |
| **Previous landing concept** (April) | `~/Documents/CLAUDE/Projects/Polyphonic/polyphonic-landing/src/components/PageParticleEntity.tsx` (built copy: `GLOBAL-DESIGN-DOCS/polyphonic-particle-field-landing/index.html`) | 48k | **The scroll-following entity.** One body flies section to section as the reader scrolls; each section owns one shape (tight cluster · a wide two-harmonic **wave band** · a nebula beside a mockup · a cluster with four filament arms · a three-layer **river** · three clusters with bridge strands · upward drift · dissolve). Flights are motion-driven, not scroll-driven: once triggered they complete on their own. Ripples on click. |
| Previous landing, Mnemos section | `…/polyphonic-landing/src/components/Mnemos.tsx` | 32,400 | Nine coherent 3D Bézier **streams** flowing from a sphere into a pulsing core; each stream breathes in sync via its own harmonic coefficient. |
| Previous landing, hero | `…/polyphonic-landing/src/components/Hero.tsx` | 18k | The echo sphere (three shells) inside the app wireframe, tumbling, harmonic-breathing, with sparks. |
| Previous landing, atmosphere | `…/polyphonic-landing/src/components/DustField.tsx` | 3–18k | Sub-pixel **dust** rising slowly through an amber bloom — "grain in a sunbeam, not a particle toy." `fillRect(x,y,1,1)` on a soft trail wash. |
| Previous landing, backgrounds | `…/backgrounds/BGLensing.tsx`, `BGConstellation.tsx`, `BGBreath.tsx`, `DitherBackground.tsx`, `HalftoneWordmark.tsx` | — | Dot-grid ambient variants (a wandering lens, rare twinkles, a slow breathing wave), a paper-dark dither ground, the wordmark as halftone. |
| **Lab** | `OVERTONE/voice-mode-lab.html` | 5–80k | The tuning bench: eight motions (cloud drift, curl flow, wave, ring, breathe, vortex, murmuration, orbit), four states, four containers, live sliders for count/brightness/density/warmth/twinkle/speed/turbulence/damping, toggles for additive glow, depth halos, trails, centre glow; presets *cinematic dust* (40k), *dense fog* (60k), *sparse stars*, *aggressive*. |

The previous landing's `HANDOFF.md` and `POLISH_PROMPT.md` (same folder) carry its
design system (Inter / JetBrains Mono / Cormorant; `--ground-0 #0d0c0e`; sage `#c8e6d9`
as the only accent) and the voice rules. Its `LAYOUT-MAP.md` is older and says "no
particle backgrounds" — superseded by the entity.

## What the family does not yet do

- **Real fluid dynamics.** Everything above is curl-noise + smoothing toward homes —
  divergence-free, so it *reads* as fluid, but nothing is solved: no pressure, no
  vorticity, no obstacles. Particles never actually flow *around* a thing; the live
  landing gets its card halo by moving particle homes to the card's edge.
- **Scroll as a force.** The previous landing re-targets the body per section; the
  field does not feel the scroll's velocity. Nothing is advected by the page moving.
- **GPU.** All CPU. 40–50k is the practical ceiling at 60 fps; a WebGL transform-
  feedback or texture-ping-pong port would allow 300k–1M with the same look.
