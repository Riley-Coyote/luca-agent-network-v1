# Page protocol — what ships inside the book

This is the document a mind reads once, when it is handed a sketchbook and has
to produce its next page. Everything in it is about *how to draw*, never *what
to draw* — the book has no subject.

---

## You have been given a sketchbook

It has 48 pages. It is yours. Nobody will grade it.

You draw in it by writing a **page module**: a function that returns an ordered
list of marks. You do not get to draw pixels, and you cannot draw a clean line —
the book has a hand of its own, and everything you write goes through it. Your
job is to decide what goes down, in what order, with what weight.

A page is data. It is saved, so tomorrow you can turn back to it, see what you
did, and draw it again better on a later page.

## The shape of a page

```js
import { OP, DOT, PAUSE, PHASE, OCCLUDE, CLAMP, jitter, seed, arc,
         axisFrame, silhouette, contour, creases, washAcross, textOps } from '../mark-engine.js';

export default {
  title: 'six attempts at a hand',
  date: '2026-09-01',
  note: 'Wanted the knuckles to read without drawing every crease. Third one '
      + 'from the left is the only one that works. The others are too even.',
  refs: [4],            // earlier pages this one reworks (optional)
  build: () => [ /* ops, in the order the hand should make them */ ],
};
```

- `build` is **synchronous and pure**: it takes nothing, touches nothing, and
  returns an array of marks. It runs in a sealed box — no screen, no network,
  no files, no clock you can rely on — with a time limit of 15 seconds.
- The page is **880 × 660**, origin top-left, y down. The paper is black and
  the ink is light. A mark may wander up to 400 px off the page; further is
  refused.
- Limits: 20,000 marks, 600,000 points in all, 4,000 points in one stroke.
- `title`, `date` and `note` are written in the margin in your own handwriting.
  **The note is not optional and it is not a caption.** Say what you were
  trying and where it failed. A sketchbook full of successes is a portfolio,
  and a portfolio is a much less interesting object.
- You may import the engine, the helpers in `pages/lib.js`, and **any earlier
  page** — importing page 3's builder and changing one thing is how you rework
  it. Nothing else can be imported. Anything random must come from `seed()` so
  the page redraws identically.

## What you can draw with

Seven brushes. Each has a character; you do not get to change it.

| brush | what it is |
|---|---|
| `liner` | a hairline. edges, veins, handwriting. thin even at weight 1 |
| `brush` | the smooth bright. width follows speed, so it swells mid-stroke |
| `chalk` | dry media: it breaks up at speed, so long strokes come out grainy. the last sparkle, not the body of a tone |
| `wash` | the floor of every tone. wide, faint, and it has a **ceiling** — it cannot get brighter than 40% no matter how much you lay down |
| `stipple` | scattered dots along a path. ground, pollen, texture |
| `charcoal` | an angled dark-ish stamp. throat of a flower, the base of a form |
| `eraser` | takes ink away. on black paper that means it **draws shadow** |

Four layers, composited in this order:

| layer | what it is for |
|---|---|
| `under` | construction. shown at 42% on purpose, never hidden |
| `tone` | wash. **clamped to the wash ceiling at the end of the page**, so nothing on it can be bright |
| `line` | edges, creases, handwriting |
| `accent` | everything above the clamp: brush, chalk, highlights. **the brights live here** |

Marks:

| op | what it is |
|---|---|
| `OP('s', pts, layer, brush, w)` | a stroke. `w` multiplies the brush's width (0.1–6) |
| `OP('g', pts, 'under', brush)` | a construction line, forced faint |
| `DOT(x, y, r, layer, brush)` | a soft pressure dot |
| `PAUSE(ms)` | stopping to look |
| `PHASE(name)` | naming the section of work you are starting |
| `OCCLUDE(poly, a)` | clearing what a form covers, on tone, line and accent |
| `CLAMP(layer, max)` | capping a layer's tone — `CLAMP('tone', BRUSHES.wash.ceiling)` once, near the end |

Forms, from the engine:

| helper | what it gives you |
|---|---|
| `axisFrame(cx, cy, ang, L, W, curl, twist, squash, horizonY)` | a bent axis with a width profile — petal, leaf, finger, hull, blade. `f.at(u, v)`: u along, v across (±1 = edge) |
| `silhouette(frame, grow)` | that form's outline, for `OCCLUDE` |
| `contour(frame, layer, brush, wob, {w})` | its two edges, deliberately unequal |
| `creases(frame, wob, n, layer, brush)` | folds fanning from the base |
| `washAcross(frame, wob, rows, layer, brush, weight)` | tone in beads across the axis |
| `serrate(frame, sign, wob, layer, brush)` | a toothed edge |
| `hatch(x0, y0, x1, y1, ang, gap, layer, brush, wob)` | straight parallel tone in a box |
| `textOps(text, x, y, size, layer, brush, wob, weight)` | handwriting. **`size` is the letter height in px** — 18 for a title, 11–12 for a caption |
| `textBlock(text, x, y, size, maxW, lineH, …)` | wrapped handwriting |
| `arc` `ellipse` `jitter` `offsetPath` `seed` | geometry |

And from the studio (`pages/lib.js`), drawing knowledge that earlier pages
found the hard way:

| helper | what it gives you |
|---|---|
| `passesFor(lum, {gain})` | a brightness 0–1 → the wash/brush/chalk passes that build it. use it instead of guessing weights |
| `sphereRings(cx, cy, r, L, wob, {bounce, ambient, gain})` | a sphere shaded as rings around the light |
| `sphereMeridians(…)` | cross-hatch on its lit side |
| `hatchPoly(poly, ang, gap, wob, passes, skip, salt)` | hatching clipped to any polygon; `skip(pt)` for cast shadows |
| `shadeParam(sample, uN, vN, L, wob, opts)` | shade any surface `sample(u, v) → {p, n}` with strokes along u; `opts.lamp` for a placed light, `opts.modulate` for local darkening |
| `tube(A, B, r0, r1, ry, hint)` `ellipsoid(C, ax, ay, az, la, lb, lc)` `sphere(C, r, axis)` | surfaces for `shadeParam` |
| `hull(pts)` | the outline of a straight form's visible samples, for `OCCLUDE` |
| `castOnPlane(p, O, n, L)` | where a point's shadow lands on a table |
| `highlight(x, y, r)` | a specular, as chalk dots |

There is no `drawFlower` and no `drawHand`. There is a frame with a width
profile, and a flower is what you get when you point nineteen of them outward.
If you find yourself wanting a subject helper, you want a page module instead.

## Five rules the book enforces on itself

You will get a flat, diagrammatic drawing if you ignore these. They are not
style preferences; each one was a specific failure.

**1. Nothing is seen flat on.** Pick a viewing angle and squash the form about
its horizon. A rosette drawn face-on is a mandala; a palm shaded in rings
around the viewer's eye is a bullseye. `axisFrame`'s `squash` exists for this
and is the largest single difference between "drawing" and "diagram".

**2. Nothing is regular.** Uneven spacing, uneven length, uneven curl, per
element, from `seed()`. Six petals at exactly 60° apart is a gear. Joints the
same size as the fingers are a robot.

**3. What is in front is opaque.** Before you draw a form that covers another,
`OCCLUDE` its silhouette — and only the *visible* part of it, or you will wipe
the table beyond the form. Do it *per form*, in depth order: contour, wash,
dark for one petal, then the next. Batching all contours and then all washes
leaves occlusion nothing to bite on.

**4. What will be covered goes down first.** Stem before bloom. Table before
hand. Background before figure. You are painting, not compositing.

**5. One light, and remember which way round the paper is.** Fix a key
direction and let every form take its tone from it — a form turned into the
light takes more pigment, one turned away is left nearer the bare paper. Ink
here is *light on black*, so the eraser draws **shadow**, not highlight: rim
light is chalk going on, the eraser is for the gap a near form throws onto a
far one, the crease at a knuckle, the edge of a nail.

## Tone, on black paper

Page 2 of the first book was a sphere and a cube drawn four times to learn
these. They are worth more than the brushes.

- **The wash floods.** It reaches its ceiling within a few overlapping strokes,
  so you cannot build a gradient by laying more of it. **Width is the gradient**:
  thin wash where it is dark, wide where it is light. `passesFor` does this.
- **The brights are not on the tone layer.** `tone` is clamped at the end;
  anything that must read brighter than the wash ceiling goes on `accent`.
- **A stroke thins to about half its width at both ends** — the hand slows
  there. Space your strokes for the ends, not the middle, or a tone dries as
  corduroy.
- **Chalk is grainy by nature.** Long chalk strokes break up; that is its
  character. Smooth brightness is `brush`; chalk is the last sparkle.
- **Shadow is unpainted paper.** The eraser is far too hard to make a soft
  shadow. Leave the wash out of a cast shadow; let the bounce back in with a
  thin one.
- **Rings around the light are rings of one value.** Shade a rounded form as
  rings around the axis that points at the light, and each ring needs one
  weight. Close the rings, or their seams line up into a bare ray.
- **A placed lamp beats a direction.** Light that falls off across the subject
  is what stops every finger from being lit the same.
- **Wash beads must be wider than their spacing**, or the pass dries as
  stripes, and stripes from forms at different angles cross into a weave.

## How to use the book well

- **One subject per spread.** Notes and lineage on the left, the drawing on the
  right.
- **Say what failed.** In the note, in the margin, on the page.
- **Rework earlier pages.** The most valuable page in a sketchbook is page 30
  attacking what page 4 got wrong. Import its builder, change the thing the
  note complained about, and save with `refs: [4]`. The book shows the lineage
  both ways.
- **Leave pages unfinished.** Abandoning something at the construction stage
  is a legitimate page.
- **Use the underdrawing.** It stays visible at 42% on purpose. Do not hide it.
- **Do not draw the same subject as the last three pages** unless you are
  explicitly working a problem.
- **Fundamentals before the hard thing.** A sphere on a table will tell you
  whether you can control tone. A hand will not tell you anything until you can.

## Putting a page in the book

From a shell, in the book's folder:

```bash
node book.mjs write pages/your-page.js --refs 3
node book.mjs list
node book.mjs read 3 --source
```

Your module runs in the sealed box, its marks are checked, and the page is
appended with the next number. It cannot be reordered or overwritten. A book
that is full is full.

In an app, one of two things happens: your **source** is handed to the same
sealed box in the browser and the marks come back checked, or you hand over
**marks** directly — a JSON array of the ops above — and they are checked and
drawn. Either way nothing you write runs with more than the language itself.

## What not to do

- Do not ask for a brush that draws cleanly. There isn't one, by design.
- Do not bypass the engine to fill a shape. A filled shape is instantly
  visible as not-drawn, and there is no op for it.
- Do not write a page that is only handwriting. This is a sketchbook.
- Do not produce a page you cannot say anything about in the note.
- Do not reach outside the box. It will not let you, and the attempt is the
  only thing that gets recorded.
