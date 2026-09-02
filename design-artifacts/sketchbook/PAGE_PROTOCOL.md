# Page protocol — draft of what ships inside the book

This is the agent-facing document: the "instructions programmed into the
sketchbook" from the brief. It is written to be read by an agent that has just
been handed a blank book and has to produce page two.

It is a **draft**, not a settled spec. Treat the shape as right and the details
as arguable. Everything in it is deliberately about *how to draw*, never *what
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
export default {
  title: 'six attempts at a hand',
  date: '2026-09-01',
  note: 'Wanted the knuckles to read without drawing every crease. Third one
         from the left is the only one that works. The others are too even.',
  build: (page) => [ /* ops */ ],
};
```

`title`, `date` and `note` are written in the margin in your own handwriting.
The note is not optional and it is not a caption. Say what you were trying and
where it failed. A sketchbook full of successes is a portfolio, and a portfolio
is a much less interesting object.

## What you can draw with

Seven brushes: `liner` `brush` `chalk` `wash` `stipple` `charcoal` `eraser`.
Four layers, in this order: `under` `tone` `line` `accent`.

Marks:

| op | what it is |
|---|---|
| `OP('s', pts, layer, brush, w)` | a stroke |
| `OP('g', pts, 'under', brush)` | a construction line, forced faint |
| `DOT(x, y, r, layer, brush)` | a soft pressure dot |
| `PAUSE(ms)` | stopping to look |
| `PHASE(name)` | naming the section of work you are starting |
| `OCCLUDE(poly, a)` | clearing what a form covers |
| `CLAMP(layer, max)` | capping a layer's tone |

Forms:

| helper | what it gives you |
|---|---|
| `axisFrame(cx, cy, ang, L, W, curl, twist, squash, horizonY)` | a bent axis with a width profile — petal, leaf, finger, hull, blade |
| `silhouette(frame, grow)` | that form's outline, for `OCCLUDE` |
| `contour(frame, layer, brush, wob)` | its two edges, deliberately unequal |
| `creases(frame, wob, n, layer, brush)` | folds fanning from the base |
| `washAcross(frame, wob, rows, layer, brush, weight)` | tone in beads across the axis |
| `serrate(frame, sign, wob, layer, brush)` | a toothed edge |
| `hatch(x0, y0, x1, y1, ang, gap, layer, brush, wob)` | straight parallel tone |
| `textOps(text, x, y, size, layer, brush)` | handwriting, as strokes |
| `arc` `ellipse` `jitter` `offsetPath` `seed` | geometry |

There is no `drawFlower`. There is a frame with a width profile, and a flower is
what you get when you point nineteen of them outward. If you find yourself
wanting a subject helper, you want a page module instead.

## Five rules the book enforces on itself

You will get a flat, diagrammatic drawing if you ignore these. They are not
style preferences; each one was a specific failure.

**1. Nothing is seen flat on.** Pick a viewing angle and squash the form about
its horizon. A rosette drawn face-on is a mandala. `axisFrame`'s `squash`
argument exists for this and is the largest single difference between "drawing"
and "diagram".

**2. Nothing is regular.** Uneven spacing, uneven length, uneven curl, per
element, from `seed()`. Six petals at exactly 60° apart is a gear.

**3. What is in front is opaque.** Before you draw a form that covers another,
`OCCLUDE` its silhouette. Without this, a layered subject renders as a
wireframe — you can see every petal through every other petal. And do it *per
form*, in depth order: contour-then-wash-then-dark for one petal, then the next.
Batching all contours and then all washes leaves occlusion nothing to bite on.

**4. What will be covered goes down first.** Stem before bloom. Background
before figure. You are painting, not compositing.

**5. One light, and remember which way round the paper is.** Fix a key
direction. A form turned into it takes more pigment; one turned away is left
nearer the bare paper. Ink here is *light on black*, so the eraser draws
**shadow**, not highlight — rim light is chalk going on, and the eraser is for
the dark gap a near form throws onto a far one. Getting this backwards produces
a drawing lit from inside itself.

Two more, smaller:

- **Wash beads must be wider than their spacing**, or the pass dries as stripes,
  and stripes from forms at different angles cross into a visible weave.
- **The wash has a ceiling.** Every true dark is `chalk` or `charcoal`. If
  something needs to be blacker, you need dry media, not more wash.

## How to use the book well

- **One subject per spread.** Left side notes and thumbnails, right side the
  drawing.
- **Say what failed.** In the note, in the margin, on the page.
- **Redraw earlier pages.** The most valuable page in a sketchbook is page 30
  attacking what page 4 got wrong. Reference it by number.
- **Leave pages unfinished.** Abandoning something at the construction stage is
  a legitimate page.
- **Use the underdrawing.** It stays visible at 42% on purpose. Do not hide it.
- **Do not draw the same subject as the last three pages** unless you are
  explicitly working a problem.

## What not to do

- Do not ask for a brush that draws cleanly. There isn't one, by design.
- Do not bypass the engine to `fillRect` a shape. A filled shape is instantly
  visible as not-drawn.
- Do not write a page that is only handwriting. This is a sketchbook.
- Do not produce a page you cannot say anything about in the note.
