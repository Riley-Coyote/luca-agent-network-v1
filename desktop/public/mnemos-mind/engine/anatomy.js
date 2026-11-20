/* The anatomy of a mind that keeps itself, drawn in light. Every engram is a cell; every link is a fibre.
 *
 * Real parts, doing their real jobs:
 *   the body      a membrane of light: soft points spread evenly over it, so it glows like a translucent cell,
 *                 brightest at its edge, where more of it lies along the line of sight. Size is strength (how
 *                 well it is stored). A lesson is small and round, like a granule cell; an experience is a
 *                 gentle teardrop leaning toward what feeds it, like the pyramidal cells real engrams live in.
 *   the nucleus   a dense bright core: what the memory meant, the part made to outlive the rest. Inside it a
 *                 nucleolus, brighter still, as big as the memory is settled (stability): a lesson's is large.
 *   the cytoplasm fine granules inside the body, as many as the memory is strongly stored (strength): the
 *                 Nissl substance that makes a real neuron's body look grainy under the microscope.
 *   the dendrites the arbour that receives: a few boughs that fork and thin, reaching toward the memories
 *                 that link in, and fading into the tissue as real arbours do. Their finer branches carry
 *                 spines, the small heads where synapses sit: the more links a memory has, the more spines.
 *   the fibres    one per link: an axon leaving the sender at its hillock, arcing over, and arriving along
 *                 the receiver's surface in a bouton on its body. Beads along it (the varicosities real axons
 *                 have, where they release) come closer together the stronger the link. Recall's light
 *                 travels along it.
 * Words appear only where they mean something, and the page sets those itself: a memory being read, what
 * was said becoming a memory, a lesson's meaning. `wrap` gives the page the line a sentence takes round a
 * body, pole to pole, so words can land on the memory they become.
 *
 * This returns plain geometry; renderers decide how bright each point is at each moment. */

import { random, add, sub, scale, dot, cross, length, normalize, mixv } from './gl.js';
import { basis, path } from './motion.js';
import { DOT, STROKE, LINE } from './glyphs.js';

export const PART = { SKIN: 0, NUCLEUS: 1, DENDRITE: 2, FIBRE: 3, BOUTON: 4 };

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const BAR = 0.07;                                   // a line's thickness, in its own length (LINE in engine/glyphs.js)

/* Detail can be spent part by part (each defaults to `detail`): `strand` for the lines (boughs and fibres, laid as
 * overlapping strokes, so below about 0.8 a line breaks into beads), `spine` for the spines along the boughs, `skin`
 * for a body's membrane and granules, `core` for its nucleus. A body's points grow as they thin, so a sparser
 * membrane keeps its glow; a line keeps its strokes, so it stays a line. */
export function anatomy(data, { seed = 11, detail = 1, reach = 1, fibre = 0.0024, strand: strandK = detail, spine = detail, skin = detail, core = detail } = {}) {
  /* every body and every fibre draws from its own stream of chance, keyed by the memory or the link (`key`, else
   * its place) and by the pass: so a memory has the same shape whatever detail it's drawn at, and whatever else is
   * drawn beside it. That is what lets a page redraw a few memories finely, in place, over a coarser whole. */
  const own = (key, pass) => random((Math.imul(seed + 1, 2654435761) ^ Math.imul(key + 1, 2246822519) ^ Math.imul(pass + 1, 3266489917)) >>> 0);
  let rnd = random(seed), srnd = rnd;
  const cells = data.cells.map((c, i) => ({ ...c, i, P: c.p }));
  const keyOf = (c) => c.key ?? c.i, linkKey = (l, li) => l.key ?? li;
  const points = [];
  const emit = (l) => points.push(l);
  /* a strand along a path, thickness t0 at its start tapering to t1 at its end: strokes laid end to end,
   * each overlapping the last, so it reads as one smooth line of light */
  const strand = (P, t0, t1, part, owner, along0 = 0, along1 = 1) => {
    for (let s = 0; s < P.length;) {
      const f = s / P.length, t = t0 + (t1 - t0) * f, size = t / BAR;
      emit({ p: P.at(Math.min(P.length, s + size * 0.5)), size, ch: LINE, part, ...owner, u: P.along(Math.min(P.length, s + size * 0.5)),
        along: along0 + (along1 - along0) * f });
      s += size * 0.62 / strandK;
    }
  };

  // who links into whom: the arbour reaches toward its senders; every link, either way, is a synapse to hold
  const incoming = cells.map(() => []), degree = cells.map(() => 0);
  data.links.forEach((l, li) => { incoming[l.t].push(li); degree[l.t]++; degree[l.s]++; });

  cells.forEach((c) => {
    const lesson = c.kind === 'procedural';
    c.R = (lesson ? 0.1 : 0.13) * (0.7 + 0.5 * c.strength);
    if (c.apex0) { c.apex = c.apex0; c.hillock = c.hillock0; return; }   // its shape given whole, from a drawing of all of it
    rnd = own(keyOf(c), 0);
    // the apex: pyramidal cells point their apical dendrite toward the mean of what feeds them
    let pull = [0, 0, 0];
    for (const li of incoming[c.i]) pull = add(pull, normalize(sub(cells[data.links[li].s].P, c.P)));
    c.apex = length(pull) > 1e-6 ? normalize(add(normalize(pull), scale(rnd.dir(), 0.35))) : rnd.dir();
    c.hillock = normalize(add(scale(c.apex, -1), scale(rnd.dir(), 0.3)));
  });

  /* ---------- the body: a membrane of light ---------- */
  const shape = (c, d) => c.R * (c.kind === 'procedural' ? 1 : 1 + 0.42 * Math.max(0, dot(d, c.apex)) ** 3);
  for (const c of cells) {
    // fine points, a little apart: soft as a glow from afar, a crisp grain up close (fewer, bigger points blurred
    // into each other and read as out of focus however sharp the lens)
    const spacing = c.R * 0.07, size = spacing * 1.25;
    const n = Math.min(2600, Math.floor((4 * Math.PI * c.R * c.R) / (spacing * spacing) * skin));
    const grow = Math.min(2.4, 1 / Math.sqrt(Math.min(1, skin * Math.max(1, (4 * Math.PI * c.R * c.R) / (spacing * spacing) / 2600))));
    const [e1, e2] = basis(c.apex);
    rnd = own(keyOf(c), 1);
    for (let j = 0; j < n; j++) {
      // evenly over the sphere (a Fibonacci lattice), then shaped: round, or a gentle teardrop
      // (each point nudged off the lattice a little: a perfect lattice reads as a mesh up close, not as a membrane)
      const y = 1 - (2 * (j + 0.5)) / n, s = Math.sqrt(1 - y * y), a = j * GOLDEN;
      const lattice = normalize(add(add(scale(e1, s * Math.cos(a)), scale(e2, s * Math.sin(a))), scale(c.apex, y)));
      const d = normalize(add(lattice, scale(rnd.dir(), 0.45 * spacing / c.R)));
      emit({ p: add(c.P, scale(d, shape(c, d))), size: size * grow * (0.8 + 0.4 * rnd()), ch: DOT, part: PART.SKIN, cell: c.i, face: d, along: j / n });
    }
  }

  /* ---------- the nucleus: a dense bright core ---------- */
  for (const c of cells) {
    rnd = own(keyOf(c), 2);
    const rn = c.R * 0.38, size = c.R * 0.08 / Math.cbrt(Math.min(1, core)), n = Math.floor(300 * core);
    for (let j = 0; j < n; j++) {
      const y = 1 - (2 * (j + 0.5)) / n, s = Math.sqrt(1 - y * y), a = j * GOLDEN;
      const d = [s * Math.cos(a), y, s * Math.sin(a)], r = rn * Math.cbrt(rnd());
      emit({ p: add(c.P, scale(d, r)), size: size * (0.7 + 0.6 * rnd()), ch: DOT, part: PART.NUCLEUS, cell: c.i, along: j / n });
    }
  }

  /* ---------- the nucleolus: brighter still, as large as the memory is settled ---------- */
  for (const c of cells) {
    rnd = own(keyOf(c), 3);
    const rn = c.R * (0.07 + 0.09 * (c.stability ?? 0.4)), off = scale(rnd.dir(), c.R * 0.07), n = Math.max(6, Math.floor(46 * core));
    for (let j = 0; j < n; j++) {
      const d = rnd.dir(), r = rn * Math.cbrt(rnd());
      emit({ p: add(add(c.P, off), scale(d, r)), size: c.R * 0.042 * (0.7 + 0.6 * rnd()), ch: DOT, part: PART.NUCLEUS, cell: c.i, along: 1 });
    }
  }

  /* ---------- the cytoplasm: fine granules between the nucleus and the membrane, as many as it's strong ---------- */
  for (const c of cells) {
    rnd = own(keyOf(c), 4);
    const n = Math.floor(170 * (c.strength ?? 0.6) * skin), g = 1 / Math.cbrt(Math.min(1, skin));
    for (let j = 0; j < n; j++) {
      const d = rnd.dir(), r = shape(c, d) * (0.45 + 0.45 * Math.cbrt(rnd()));
      emit({ p: add(c.P, scale(d, r)), size: c.R * 0.036 * g * (0.6 + 0.8 * rnd()), ch: DOT, part: PART.SKIN, cell: c.i, along: 0.5 });
    }
  }

  /* ---------- the dendrites: a few boughs that fork and thin, reaching toward what feeds the cell ----------
   * `along` runs 0 at the body to 1 at the finest tips, so a renderer can let them fade into the tissue. */
  // spines: the gap between them shrinks as the memory's links grow (a memory with no links has a few)
  const spines = (Pth, c, along0, along1, thick) => {
    const gap = 0.07 / (1 + (c.degree ?? degree[c.i]) / 5) / spine, len0 = c.R * 0.1;
    for (let s = gap * srnd(); s < Pth.length; s += gap * (0.6 + 0.8 * srnd())) {
      const at = Pth.at(s), t = Pth.along(s), r = srnd.dir(), n = normalize(sub(r, scale(t, dot(r, t))));
      const len = len0 * (0.6 + 0.8 * srnd()), along = along0 + (along1 - along0) * (s / Pth.length);
      emit({ p: add(at, scale(n, len * 0.5 + thick * 0.5)), size: len, ch: STROKE, part: PART.DENDRITE, cell: c.i, u: n, along });
      emit({ p: add(at, scale(n, len + thick * 0.5)), size: len * 0.55, ch: DOT, part: PART.DENDRITE, cell: c.i, along });
    }
  };
  for (const c of cells) {
    rnd = own(keyOf(c), 5); srnd = own(keyOf(c), 6);    // the spines draw their own chance, so their number never bends a bough
    const lesson = c.kind === 'procedural';
    const boughs = lesson ? 4 : 5 + Math.min(2, Math.floor((c.incoming ?? incoming[c.i].length) / 14));
    const grow = (start, dir, len, depth, apical, thick) => {
      const pts = [start];
      let p = start, d = dir;
      for (let q = 0; q < 4; q++) { d = normalize(add(d, scale(rnd.dir(), 0.3))); p = add(p, scale(d, len / 4)); pts.push(p); }
      const last = lesson ? 2 : apical ? 3 : 2, thin = thick * 0.62, Pth = path(pts, 10);
      strand(Pth, thick, thin, PART.DENDRITE, { cell: c.i }, depth / (last + 1), (depth + 1) / (last + 1));
      if (depth >= 1) spines(Pth, c, depth / (last + 1), (depth + 1) / (last + 1), thin);
      if (depth < last) {
        const [a, b] = basis(d);
        for (const sgn of [-1, 1]) {
          const nd = normalize(add(d, add(scale(a, sgn * rnd.range(0.4, 0.8)), scale(b, rnd.range(-0.3, 0.3)))));
          grow(p, nd, len * rnd.range(0.55, 0.72), depth + 1, apical, thin * 0.9);
        }
      }
    };
    for (let b = 0; b < boughs; b++) {
      // the apical one leads, reaching toward the senders; the basal ones spread from the base
      const apical = b === 0 && !lesson;
      const dir = apical ? c.apex : normalize(add(rnd.dir(), scale(c.apex, lesson ? 0 : -0.4)));
      const start = add(c.P, scale(dir, shape(c, dir) * 0.92));
      grow(start, dir, (apical ? 0.8 : 0.34) * (0.8 + 0.4 * c.strength) * reach, 0, apical, c.R * (apical ? 0.075 : 0.055));
    }
  }

  /* ---------- the fibres: one per link, the sender's axon to a bouton on the receiver ----------
   * A link marked `bare` keeps its place (and its index) but is drawn without a fibre: the page decides which. */
  const fibres = data.links.map((l, li) => {
    if (l.bare) return null;
    rnd = own(linkKey(l, li), 7);
    const a = cells[l.s], b = cells[l.t];
    // the axon leaves the sender's body at its hillock; the bouton lands on the receiver's body, on the side
    // facing the sender: every link visibly runs from one memory to the other
    const from = add(a.P, scale(a.hillock, shape(a, a.hillock) * 1.0));
    const toward = normalize(add(normalize(sub(a.P, b.P)), scale(rnd.dir(), 0.35)));
    const land = add(b.P, scale(toward, shape(b, toward) * 1.04));
    const span = length(sub(land, from)), lead = Math.min(0.12, span * 0.2);
    const bow = scale(normalize(cross(sub(land, from), rnd.dir())), span * rnd.range(0.05, 0.12));
    // out along the hillock, across in a gentle arc, and in along the receiver's surface
    const P = path([from, add(from, scale(a.hillock, lead)), add(add(mixv(from, land, 0.5), bow), scale(rnd.dir(), span * 0.025)),
      add(land, scale(toward, lead)), land], 12);
    return { li, P, len: P.length, land };
  }).filter(Boolean);
  for (const f of fibres) {
    strand(f.P, fibre * 1.25, fibre, PART.FIBRE, { link: f.li, cell: data.links[f.li].s });
    // varicosities: beads along the axon, closer together the stronger the link
    rnd = own(linkKey(data.links[f.li], f.li), 8);
    const w = data.links[f.li].w ?? 0.5, gap = 0.1 / (0.35 + w) / strandK;
    for (let s = gap * (0.5 + rnd()); s < f.len - 0.03; s += gap * (0.8 + 0.4 * rnd())) {
      emit({ p: f.P.at(s), size: fibre * (2.6 + 1.4 * rnd()), ch: DOT, part: PART.FIBRE, link: f.li, cell: data.links[f.li].s, along: s / f.len });
    }
    // the bouton: a small bright knot where the axon meets the receiver
    for (let q = 0; q < 7; q++) {
      const y = 1 - (2 * (q + 0.5)) / 7, s = Math.sqrt(1 - y * y), ang = q * GOLDEN;
      emit({ p: add(f.land, scale([s * Math.cos(ang), y, s * Math.sin(ang)], fibre * 2.2)), size: fibre * 4, ch: DOT, part: PART.BOUTON,
        link: f.li, cell: data.links[f.li].t, along: 1 });
    }
  }

  /* the line a sentence of n letters takes round a body, pole to pole from its apex: where each letter
   * lands, which way the line runs there, and how big a letter is on this body */
  const wrap = (i, n) => {
    const c = cells[i], size = c.R * 0.12, step = size * 0.92;
    const all = Math.max(n, Math.floor((4 * Math.PI * c.R * c.R) / (size * 1.55 * step)));
    const turns = (Math.PI * c.R) / (size * 1.55), [e1, e2] = basis(c.apex), out = [];
    for (let j = 0; j < n; j++) {
      const f = (j + 0.5) / all, lat = Math.acos(1 - 2 * f), lon = 2 * Math.PI * turns * f;
      const d = normalize(add(add(scale(e1, Math.sin(lat) * Math.cos(lon)), scale(e2, Math.sin(lat) * Math.sin(lon))), scale(c.apex, Math.cos(lat))));
      out.push({ p: add(c.P, scale(d, shape(c, d) * 1.03)), u: normalize(add(scale(e1, -Math.sin(lon)), scale(e2, Math.cos(lon)))), size });
    }
    return out;
  };

  return { cells, fibres, points, wrap };
}
