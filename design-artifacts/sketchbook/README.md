# Handoff: Agent Sketchbook

## Overview

A **blank sketchbook you hand to an agent.** The book ships with a drawing
engine and an instruction protocol; the agent writes pages into it — whatever it
wants, or whatever its user asks for. A human flips through and sees what the
agent has been working on.

There is no fixed subject and no dedicated purpose. That is the point. The
product is a *substrate plus a protocol*, not a designed set of pages.

This bundle contains the engine (working, extracted, framework-free), one worked
page as reference, a draft of the agent-facing protocol, and the original
prototypes it all came out of.

## About the design files

Two different kinds of file are in here, and the distinction matters:

**`mark-engine.js` and `subjects/flower.js` are working source, not mockups.**
They are plain ES modules with no dependencies and no framework. They have been
verified to run and produce the drawing in `screenshots/`. Port them into your
target environment or use them as-is — they are the actual asset being handed
over. Everything in them was derived empirically; see *Five rules* below before
changing values.

**The files in `reference/` are design references.** They are HTML prototypes
built in a proprietary component format (`.dc.html`, needing `support.js`) that
shows intended look and behavior. Do not try to ship them or port their
component wrapper. Read them for the surrounding UI — the phase list, layer
toggles, speed control, progress readout — and recreate that in your codebase's
own environment and patterns.

## Fidelity

Mixed, deliberately:

- **The engine is production-grade.** Verified working: 882 ops for the flower,
  four layers compositing correctly, wash clamping to exactly 102/255. Treat its
  constants as tuned, not arbitrary.
- **The drawing output is high-fidelity.** `screenshots/handoff-final.png` is
  what the code in this bundle produces. That is the visual target.
- **The sketchbook product around it is a specification, not a mockup.** There
  is no page-turn UI, no spine rail, no cover in this bundle. `PAGE_PROTOCOL.md`
  and *What to build* below specify it; the screens have not been designed yet.
  Building them is the next design task, not a recreation task.

## Status (2026-09-02)

The book shell now exists, next to the engine:

- `index.html` — the sketchbook: a spine of page thumbnails, an open spread
  (notes, lineage and source on the left, the drawing on the right). A page
  animates the first time you reach it and is flat thereafter.
- `book/` — the book itself: `book.json` is the index, `pages/NNN.json` a page
  (meta, the module source, the marks). A folder you can hand to someone.
- `book.mjs` — the agent-facing tool: `list`, `read <n>`, `write <module.js>
  [--refs a,b]`, `blank`. Writing is the only way marks get into the book; the
  viewer only reads.
- `pages/` — page modules written so far, and `pages/lib.js`, the shading
  helpers they share (lit parametric surfaces, hatching, tone→passes).
- `page.html?p=<name>` — replay one module without the book; `harness.html` is
  the original engine harness.

Not built yet: sandboxing (step 6 below), a cover, page one as its own source.

## Run it first

```bash
cd design_handoff_agent_sketchbook
npx serve .          # or python3 -m http.server
```

Open `index.html`. ES modules need HTTP — `file://` will not work.

Controls: replay, jump-to-finished, speed, and per-layer toggles. `window.engine`
and `window.ops` are exposed for devtools.

---

## The one architectural decision

**A page is a stroke program, not an image.**

Everything good about this design follows from that, and everything falls apart
without it. If pages save as bitmaps you lose replay, cheap thumbnails, rework,
diffing, and any hope of a reasonable file size. Because a page is an ordered
list of plain-data ops:

- it replays as an animation, which is most of the appeal
- it flattens to a thumbnail on demand (`engine.toDataURL()`)
- a later page can import an earlier page's builder and redraw it better
- it is JSON — 882 ops for a full drawing is roughly 250 kB unminified, and far
  less with coordinates rounded to 1dp (do this)
- **the agent authors in exactly the language the engine speaks**, which is what
  makes "the instructions are programmed into the book" tractable at all

Do not add a raster op. Do not add an op that takes an image.

## Data model

```
Book
  id, title, owner (which agent), created
  pages: Page[]           // finite — 48 is the recommended count
  cover?: dataURL

Page
  index      0-based, fixed at creation — pages do not reorder
  title      string        drawn in the margin in the agent's handwriting
  date       ISO date
  note       string        what was attempted, and where it failed. Required.
  refs       number[]      earlier pages this one reworks
  seed       number        so the page regenerates identically
  source     string        the builder module source, or a module path
  ops        Op[]          the marks, in order
  state      'blank' | 'drawing' | 'drawn'
```

`ops` is the saved artifact. `source` is kept so a page can be re-derived and so
a human can read what the agent wrote. Keep both; they answer different
questions.

### Op kinds

All plain JSON. `pts` is `[[x, y], …]` in page coordinates.

| kind | fields | meaning |
|---|---|---|
| `s` | `pts, layer, brush, w` | a stroke |
| `g` | `pts, layer, brush` | construction line — forced faint by the engine |
| `d` | `x, y, r, layer, brush` | soft pressure dot |
| `p` | `ms` | pause; the hand stopping to look |
| `phase` | `name, ms` | names the section of work starting now |
| `occ` | `poly, a` | clears a silhouette out of the layers behind |
| `clamp` | `layer, max` | caps a layer's alpha |

## Engine architecture

`mark-engine.js`, ~600 lines, no dependencies.

**Four layers**, offscreen canvases composited in order:
`under` (0.42 opacity — construction is kept visible on purpose) → `tone` →
`line` → `accent`. The split exists so tone can be clamped and erased
independently, and so a viewer can toggle them.

**Seven brushes**, each a parameter set rather than code:
`liner brush chalk wash stipple charcoal eraser`. Parameters are documented
inline. Two flags carry real weight: `sub` makes a brush subtractive (the
eraser), and `ceiling` caps how dark a brush can ever get (the wash).

**Every mark is a run of overlapping stamps.** A stroke is resampled to ~1.4px
spacing, then stamped at `brush.spacing`. Stamp radius follows a velocity bell
across the stroke — `pow(sin(PI * u), 0.55)` — so every mark gets a tapered
entry and exit for free. There are no `lineTo` calls and no filled paths
anywhere. That is the entire reason the output reads as drawn.

**Replay is time-based, not op-based.** `tick(dt, speed)` consumes a time budget
and can render a partial stroke, so speed changes are smooth and the animation
is frame-rate independent.

### API

```js
const engine = new MarkEngine({ width, height, dpr: 2, ink: [236,243,255] });
engine.load(ops);              // install a page; computes total duration
engine.replay();               // restart from blank
engine.finish();               // draw instantly — thumbnails, restoring a read page
engine.tick(dt, speed);        // advance; returns true while drawing
engine.composite(ctx, hidden); // draw layers into a target 2d context
engine.toDataURL();            // flatten
engine.pen                     // {x,y} or null — draw your own cursor
engine.phase, engine.progress, engine.done
```

### Authoring vocabulary

Exported from the same module. These encode **drawing knowledge, not subject
knowledge** — that distinction is the difference between a vocabulary and a
clipart library.

`axisFrame` is the important one: a bent axis with a width profile across it,
sampled as `at(u, v)` where `u` runs along and `v` across. A petal, leaf,
finger, hull and blade are all the same primitive. Its `squash` argument
flattens the whole form about a horizon line.

Then: `silhouette` `contour` `creases` `washAcross` `serrate` `hatch`
`arc` `ellipse` `jitter` `offsetPath` `seed`
and `textOps` / `textBlock` / `textWidth` for handwriting.

**Handwriting is included.** A single-stroke font (46 glyphs, lowercase +
digits + basic punctuation) renders notes as ordinary strokes through the same
brushes. The agent's marginalia is drawn by the same hand as the drawing, which
matters more than it sounds.

---

## Five rules

Each was a specific, diagnosed failure while building the flower. They are the
most valuable thing in this bundle — a fresh implementation will hit all five in
order. `subjects/flower.js` marks where each one applies.

**1. Nothing is seen flat on.** Pick a viewing angle and squash the form about
its horizon. A rosette drawn face-on is a mandala, and no amount of line quality
rescues it. Largest single contributor to "drawing" over "diagram".

**2. Nothing is regular.** Uneven angular spacing, length, width, curl and
twist, per element, from a hash. Six petals at exactly 60° is a gear.

**3. What is in front is opaque.** Before drawing a form that covers another,
clear its silhouette from the layers behind. Without this a layered subject
renders as wireframe — every petal visible through every other petal. Hold the
alpha just short of 1 so a trace shows through.

Corollary that cost real time: **occlude per form, in depth order.** Contour,
wash, creases and darks for *one* petal, then the next. Batching all contours
and then all washes leaves occlusion nothing to bite on.

**4. What will be covered goes down first.** Stem before bloom, background
before figure. You are painting, not compositing.

**5. One light — and remember which way round the paper is.** Fix a key
direction; a form turned into it takes more pigment, one turned away is left
nearer bare paper. Without this every element weighs the same and the drawing
stays flat however good the linework.

And the half of this rule that inverts on a dark ground: **ink is light on
black, so the eraser draws SHADOW.** Rim light is chalk going *on*; the eraser
is for the dark gap a near form throws onto a far one. A naive port gets this
backwards and produces a subject lit from inside itself.

Two smaller ones, both cosmetic but both very visible:

- **Scatter must be hash noise, not a smooth function.** A `sin()` offset is a
  wave; across a wash it beats against bead spacing into a woven checkerboard.
- **Wash beads must be wider than their spacing,** or the pass dries as stripes
  — and stripes from forms at different angles cross into that same weave. The
  wash also has a hard ceiling, so every true dark must be chalk or charcoal.

---

## What to build

Roughly in dependency order.

**1. Port the engine.** Should be mechanical — it is framework-free and touches
only 2d canvas. Verify against `screenshots/handoff-final.png` before moving on.

**2. Page storage.** Ops in, ops out, JSON. Round coordinates to 1dp on save.
Decide where the book lives — see *Open questions*.

**3. The book shell.** A finite run of pages you can move through. Spreads
rather than single pages: notes, thumbnails and failures on the left, the
drawing on the right. Asymmetry for free, and it is how a sketchbook is actually
read. A page animates the first time you reach it and is flat thereafter.

Hold the line on **no skeuomorphism** — no paper texture, no page curl, no
coffee rings. The sketchbook quality comes from structure, dates, marginalia and
uneven pages. Black ground, one ink, tight type.

**4. Page one is its own source.** The instructions are not a manual; they are a
spread showing a drawing next to the ops that made it. An agent reads that once
and can write page two. Self-documenting by construction, and a good object for
a human to look at.

**5. The agent-facing API.** Whatever tool surface an agent gets:
`listPages()`, `readPage(n)`, `writePage(n, module)`, `blankPages()`. The
protocol in `PAGE_PROTOCOL.md` is what you put in front of the model.

**6. Sandboxing.** The agent is writing JavaScript that you execute. It must run
in a worker or realm with no DOM and no network, returning only an op array,
with a cap on op count and wall time. Do not skip this.

## Design tokens

From the prototypes, if you rebuild the surrounding UI.

Ground `#07070a`; panel gradient `radial-gradient(120% 100% at 30% 12%, #14151a, #0b0b0f 52%, #07070a)`.
Hairlines `rgba(255,255,255,.08)`. Radii 22–32px.
Ink `rgb(236,243,255)`. Live accent `rgb(150,205,255)`.
Text: system sans; 29/600/-.026em titles, 13px/1.65 body at `rgba(255,255,255,.55)`,
11px/1.55 captions at `.42`, 9.5px/600/.12em uppercase labels at `.32`.
Chips: 8–9px × 13–16px, `999px`, `.5px` border, selected `rgba(255,255,255,.12)`.

## Open questions

Two things the design is genuinely undecided on. Both are worth resolving before
step 2.

**Where do pages live?** Appended into the document itself, so the sketchbook is
a single file you can hand to someone whole — or in storage, so it fills up as
you use it but does not travel. Current lean is strongly toward the file: a
sketchbook you cannot give to someone is missing the point of a sketchbook.

**How much editorial pressure?** Hand an agent a blank book with no constraints
and you get forty competent, samey pages. The draft protocol pushes back — you
must note what failed, one subject per spread, redrawing an earlier page is
encouraged. That may be exactly right, or it may be the thing that makes every
book read the same. Unresolved.

## Assets

None. No images, icons or fonts — the handwriting font is stroke data inside
`mark-engine.js`, and there is no external typeface dependency in the engine.
The prototype UI uses the system sans stack only.

## Files

```
mark-engine.js          the hand. Engine, brushes, layers, ops, vocabulary,
                        handwriting font. Working source, no dependencies.
subjects/flower.js      a worked page — pure function, config → ops. The
                        reference for what an agent writes. All five rules
                        annotated in place.
index.html              runnable harness. Replay, speed, layer toggles.
PAGE_PROTOCOL.md        draft of the agent-facing instructions that ship
                        inside the book.
README.md               this file.

reference/
  Flower Study.dc.html      the design this was extracted from — engine plus
                            the surrounding UI (phase list, controls, copy).
  Sketchbook Studio.dc.html earlier: five attempts at one subject at rising
                            skill, with tonal-analysis metrics read back off
                            the canvas. Worth reading for the metrics idea.
  Sketchbook.dc.html        earliest: multi-page sketchbook, source of the
                            single-stroke handwriting font.
  support.js                runtime the three .dc.html files need to open.
```
