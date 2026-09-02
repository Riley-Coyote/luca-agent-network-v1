/* mark-engine.js — the hand.
 *
 * A drawing is an ordered list of plain-data ops. The engine replays them onto
 * four layered canvases with seven brushes. Nothing is ever a filled shape and
 * nothing is ever a vector path: every mark is a run of overlapping stamps whose
 * width follows stroke velocity, which is the whole reason the output reads as
 * drawn rather than rendered.
 *
 * Two consequences worth understanding before you change anything:
 *
 *   1. Ops are JSON. A page can be saved, diffed, replayed, thumbnailed and
 *      reworked because it is data, not pixels. Keep it that way.
 *   2. The hand belongs to the ENGINE, not the author. Jitter, the wash ceiling
 *      and velocity-driven width are not decoration — they are what make forty
 *      pages by different authors read as one sketchbook. Do not add an op that
 *      lets a caller bypass them.
 *
 * No framework, no dependencies. ES module.
 */

export const INK = [236, 243, 255];

/* ------------------------------------------------------------------ brushes */
/* A brush is a parameter set, not code.
 *   w        base stamp radius
 *   alpha    per-stamp opacity — low, because marks build up
 *   swell    how much width follows velocity
 *   taper    exponent on the velocity curve; high = long thin entry/exit
 *   spacing  distance between stamps, in px
 *   scatter  positional noise, in px (see the noise rule in README)
 *   brk      above this velocity the brush skips stamps (dry media)
 *   dir      stamp is an angled ellipse rather than a disc (charcoal)
 *   sub      subtractive — removes pigment instead of adding it
 *   ceiling  max alpha this brush can ever reach on its layer
 */
export const BRUSHES = {
  liner:    { w: 1.0,  alpha: 0.4,   swell: 0.26, taper: 1.7, spacing: 1.4, scatter: 0.05 },
  brush:    { w: 2.2,  alpha: 0.33,  swell: 1.6,  taper: 0.5, spacing: 1.3, scatter: 0.3 },
  chalk:    { w: 2.6,  alpha: 0.38,  swell: 0.8,  taper: 0.9, spacing: 1.7, scatter: 1.7, brk: 0.34 },
  wash:     { w: 9.5,  alpha: 0.032, swell: 0.3,  taper: 1.2, spacing: 1.8, scatter: 3.6, ceiling: 0.4 },
  stipple:  { w: 0.85, alpha: 0.34,  swell: 0.2,  taper: 1,   spacing: 6.2, scatter: 2.9 },
  charcoal: { w: 2.4,  alpha: 0.3,   swell: 0.9,  taper: 0.8, spacing: 1.6, scatter: 1.1, dir: 0.55 },
  eraser:   { w: 3.4,  alpha: 0.62,  swell: 0.42, taper: 1,   spacing: 1.3, scatter: 0.18, sub: true },
};

/* Four layers, composited in this order. The split exists so tone can be
 * clamped and erased independently of line, and so a viewer can toggle them. */
export const LAYERS = [
  { key: 'under',  name: 'Underdrawing', op: 0.42 },
  { key: 'tone',   name: 'Tone',         op: 1 },
  { key: 'line',   name: 'Line',         op: 1 },
  { key: 'accent', name: 'Accent',       op: 1 },
];

/* ------------------------------------------------------------------ helpers */

export const frac = (v) => v - Math.floor(v);
/* Deterministic hash noise. Every random-looking value in a page must come
 * from here, so a page's ops are reproducible from its seed. */
export const seed = (a, b) => frac(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);

export const arc = (cx, cy, rx, ry, a0, a1, n = 24) => {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
};

export const ellipse = (cx, cy, rx, ry) => arc(cx, cy, rx, ry, -0.5, Math.PI * 2 - 0.5, 34);

/* Wobble applied at AUTHORING time, so it is baked into the saved page and the
 * drawing is identical on every replay. */
export const jitter = (pts, amt) => pts.map((p, i) => {
  const t = i / (pts.length - 1 || 1);
  return [
    p[0] + (Math.sin(t * 7.3 + p[1] * 0.03) * 0.6 + Math.sin(t * 17.1) * 0.4) * amt,
    p[1] + (Math.cos(t * 6.1 + p[0] * 0.03) * 0.6 + Math.sin(t * 13.7) * 0.4) * amt,
  ];
});

/* Parallel path at distance d — cylinders, stems, double-line edges. */
export const offsetPath = (pts, d) => pts.map((p, i) => {
  const q = pts[Math.min(pts.length - 1, i + 1)];
  const a = Math.atan2(q[1] - p[1], q[0] - p[0]) + Math.PI / 2;
  return [p[0] + Math.cos(a) * d, p[1] + Math.sin(a) * d];
});

/* ---------------------------------------------------------------------- ops */

/** A stroke. kind 's' = normal, 'g' = construction (forced faint). */
export const OP = (kind, pts, layer, brush, w = 1) => ({ k: kind, pts, layer, brush, w });
/** A soft pressure dot — anthers, pupils, points of light. */
export const DOT = (x, y, r, layer, brush) => ({ k: 'd', x, y, r, layer, brush });
/** Dead time. The hand stopping to look is most of what makes replay legible. */
export const PAUSE = (ms) => ({ k: 'p', ms });
/** Names the section of work now beginning; surfaces in the UI. */
export const PHASE = (name, ms = 240) => ({ k: 'phase', name, ms });
/** Clears a silhouette out of the layers behind it. See the occlusion rule. */
export const OCCLUDE = (poly, a = 0.9) => ({ k: 'occ', poly, a });
/** Caps a layer's alpha — how the wash is kept honest. */
export const CLAMP = (layer, max) => ({ k: 'clamp', layer, max });

/* ------------------------------------------------------- form vocabulary */
/* These encode DRAWING knowledge, not subject knowledge. There is no
 * drawFlower(). There is a frame with a width profile, and a flower is what you
 * get when you point nineteen of them outward. Add primitives here freely;
 * adding subjects here is how this becomes a clipart library. */

/**
 * A bent axis with a width profile across it — petal, leaf, finger, feather,
 * hull, blade. Everything else in a subject samples this one frame, which is
 * why the parts of a form stay registered to each other.
 *
 * `squash` then flattens the whole form about `horizonY`. That single term is
 * what turns a flat rosette into a disc seen at an angle, and it is the largest
 * single contributor to the drawing not looking like a diagram.
 *
 * Returns { at(u, v), half(u) } where u runs 0→1 along the axis and v runs
 * -1→1 across it, so v = ±1 is the edge and v = 0 the midrib.
 */
export function axisFrame(cx, cy, ang, L, W, curl, twist, squash = 1, horizonY = cy) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const px = -dy, py = dx;
  const half = (u) => W * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + u * 0.92)), 0.5) * (1 - 0.1 * u);
  const at = (u, vf) => {
    const bend = curl * u * u * L;
    const ax = cx + dx * (u * L) + px * bend;
    const ay = cy + dy * (u * L) + py * bend;
    const v = vf * half(u) * (1 + twist * (vf > 0 ? u : -u) * 0.5);
    const x = ax + px * v, y = ay + py * v;
    return [x, horizonY + (y - horizonY) * squash];
  };
  return { at, half };
}

/** Closed polygon around a frame — for OCCLUDE, never for drawing. */
export function silhouette(f, grow = 1.07) {
  const poly = [];
  for (let i = 0; i <= 24; i++) poly.push(f.at(-0.03 + 1.03 * (i / 24), -grow));
  for (let i = 0; i <= 24; i++) poly.push(f.at(1 - 1.03 * (i / 24), grow));
  return poly;
}

/**
 * The outline of a form: two edges, deliberately unequal. One carries round the
 * tip, the other stops short. A symmetrical closed outline is the single most
 * diagram-like thing you can draw, so this primitive refuses to make one.
 */
export function contour(f, layer, brush, wob, opts = {}) {
  const edge = (sign, from, to, n) => {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(f.at(from + (to - from) * (i / n), sign));
    return pts;
  };
  const w = opts.w || 0.62;
  return [
    OP('s', jitter(edge(-1, -0.05, 1.0, 26).concat(edge(1, 1.0, 0.72, 8)), wob), layer, brush, w),
    OP('s', jitter(edge(1, -0.03, 0.88, 22), wob * 1.15), layer, brush, w * 0.8),
  ];
}

/** Creases fanning from the base — folds, tendons, gill lines. */
export function creases(f, wob, count, layer, brush, weight = 0.34) {
  const ops = [];
  for (let k = 0; k < count; k++) {
    const s = count === 1 ? 0 : -0.62 + 1.24 * (k / (count - 1));
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const u = 0.07 + 0.78 * (i / 14);
      pts.push(f.at(u, s * (0.35 + 0.55 * u)));
    }
    ops.push(OP('s', jitter(pts, wob * 0.7), layer, brush, weight));
  }
  return ops;
}

/**
 * Tone laid in beads ACROSS the axis, alternating direction, heaviest at the
 * base. Beads must be wider than their spacing or the pass dries as stripes —
 * and stripes from forms at different angles cross into a visible weave, which
 * is the ugliest failure this engine has.
 */
export function washAcross(f, wob, rows, layer, brush, weight = 1) {
  const ops = [];
  for (let i = 0; i < rows; i++) {
    const u = 0.05 + 0.88 * ((i + 0.5) / rows) + Math.sin(i * 2.3) * 0.012;
    const dir = i % 2 === 0 ? 1 : -1;
    const a = f.at(u, -0.98 * dir);
    const b = f.at(u, 0.98 * dir);
    ops.push(OP('s', jitter([a, b], wob), layer, brush, (1.1 + (1 - u) * 1.5) * weight));
  }
  return ops;
}

/** Straight hatching in a box at an angle — flat planes, backgrounds, shadow. */
export function hatch(x0, y0, x1, y1, ang, gap, layer, brush, wob, weight = 0.6) {
  const ops = [];
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const px = -dy, py = dx;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const span = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.floor(span / gap);
  for (let i = -n; i <= n; i++) {
    const ox = cx + px * i * gap, oy = cy + py * i * gap;
    const half = span * 0.5 * (0.6 + 0.4 * seed(i, 3));
    const a = [ox - dx * half, oy - dy * half];
    const b = [ox + dx * half, oy + dy * half];
    if (Math.min(a[0], b[0]) > x1 || Math.max(a[0], b[0]) < x0) continue;
    if (Math.min(a[1], b[1]) > y1 || Math.max(a[1], b[1]) < y0) continue;
    ops.push(OP('s', jitter([a, b], wob), layer, brush, weight));
  }
  return ops;
}

/** Serrated edge — leaves, torn paper, saw teeth. */
export function serrate(f, sign, wob, layer, brush, weight = 0.42, n = 64, depth = 0.03) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = -0.02 + 0.98 * (i / n);
    const notch = 1 + (i % 8 === 0 ? -depth : i % 8 === 4 ? depth * 0.73 : 0);
    pts.push(f.at(u, sign * notch));
  }
  return OP('s', jitter(pts, wob), layer, brush, weight);
}

/* ------------------------------------------------------------ handwriting */
/* Single-stroke glyphs, so the agent's notes are drawn by the same hand as the
 * drawing. Glyph box: x 0..~5, y 0 (ascender) .. 10 (baseline) .. 13 (descender). */

const FONT_SRC = {
  a: '5,5|3.6,3.9|1.6,4.6|1,6.6|1.8,9.4|3.8,9.8|5,8.6;5,4.2|5,10',
  b: '1,0|1,10;1,6|2.4,4.4|4.2,4.6|5,6.4|4.4,9.2|2.6,9.9|1,9',
  c: '5,5.4|3.4,3.9|1.4,5|1,6.9|1.7,9.2|3.6,9.9|5,9.1',
  d: '5,0|5,10;5,6|3.6,4.4|1.8,4.6|1,6.4|1.6,9.2|3.4,9.9|5,9',
  e: '1,7.2|5,6.6|4.4,4.6|2.4,4.1|1,6|1.4,8.9|3.2,9.9|4.9,9.2',
  f: '4.8,1.2|3.6,0.6|2.4,1.6|2.2,10;0.6,4.4|4.4,4.2',
  g: '5,5|3.4,4|1.5,4.8|1,6.6|1.8,9.2|3.6,9.6|5,8.6;5,4.2|5,11.4|4,12.9|2,13|0.9,12.2',
  h: '1,0|1,10;1,6.6|2.4,4.6|4.2,4.6|5,6.2|5,10',
  i: '2.6,4.4|2.6,10;2.6,2.2|2.72,2.42',
  j: '3,4.4|3,11.6|2.2,12.9|0.9,12.8;3,2.2|3.12,2.42',
  k: '1,0|1,10;4.8,4.6|1.2,7.6;2.4,6.8|5,10',
  l: '2.4,0|2.4,8.8|3.4,10',
  m: '1,4.4|1,10;1,6.2|2,4.6|3,5.2|3,10;3,6.2|4,4.6|5,5.4|5,10',
  n: '1,4.4|1,10;1,6.4|2.4,4.6|4.2,4.8|5,6.4|5,10',
  o: '3,4|1.2,5.4|1,7.2|2,9.4|3.8,9.8|5,8.2|4.8,5.8|3,4',
  p: '1,4.4|1,13;1,6.2|2.4,4.4|4.2,4.6|5,6.6|4.2,9.4|2.4,9.8|1,8.8',
  q: '5,4.4|5,13;5,6.2|3.6,4.4|1.8,4.6|1,6.6|1.8,9.4|3.6,9.8|5,8.8',
  r: '1.4,4.4|1.4,10;1.4,6.6|2.6,4.8|4.4,4.6',
  s: '4.8,5.2|3,4|1.4,4.8|1.6,6.4|3.6,7.2|4.8,8.2|4.2,9.6|2.2,9.9|1,9.2',
  t: '2.4,1.4|2.4,8.6|3.4,10|4.6,9.6;0.8,4.4|4.2,4.2',
  u: '1,4.4|1,8|2,9.7|3.8,9.6|5,7.8|5,4.4;5,7.8|5,10',
  v: '1,4.4|3,10|5,4.4',
  w: '0.8,4.4|2,10|3,6.4|4,10|5.2,4.4',
  x: '1,4.4|5,10;5,4.4|1,10',
  y: '1,4.4|3,10;5,4.4|2.4,11.4|1,12.9',
  z: '1,4.6|5,4.4|1,9.8|5,9.8',
  '0': '3,3.4|1.2,5|1,7.6|2,9.6|3.8,9.9|4.9,8|4.8,5.2|3,3.4',
  '1': '1.4,5|2.8,3.4|2.8,9.9;1.4,10|4.2,9.8',
  '2': '1.2,4.8|2.6,3.4|4.4,4|4.6,6|1,9.9|4.9,9.7',
  '3': '1.2,4.2|3.4,3.4|4.6,4.8|3.4,6.6|4.8,8|4.2,9.6|2,10|1,9.2',
  '4': '3.8,3.4|1,8.2|5,8.2;3.8,6|3.8,10',
  '5': '4.6,3.6|1.6,3.6|1.4,6.4|3.4,6|4.8,7.2|4.4,9.4|2.2,10|1,9.2',
  '6': '4.6,3.8|2.4,4.6|1,7|1.4,9.2|3.4,10|4.8,8.6|4,6.8|2,6.8|1.2,7.6',
  '7': '1,3.6|4.9,3.6|2.4,10',
  '8': '3,3.4|1.4,4.6|1.8,6.4|3.6,7|4.8,8.2|4.2,9.7|2.2,9.9|1.1,8.6|2,7.2|4.4,6.2|4.6,4.4|3,3.4',
  '9': '4.6,6.4|3,7.2|1.2,6.4|1.4,4.4|3.4,3.5|4.7,5.2|4.6,8.4|3.4,10|1.6,9.6',
  '.': '2.4,9.6|2.52,9.9',
  ',': '2.4,9.4|2,11',
  ':': '2.4,5.6|2.52,5.9;2.4,9.6|2.52,9.9',
  "'": '2.6,2.4|2.2,4',
  '-': '1,7.2|4.6,7.1',
  '/': '4.6,3.6|1,10',
  '?': '1.4,4.4|2.8,3.4|4.4,4.4|3.8,6.4|2.8,7.2|2.8,8.2;2.8,9.6|2.92,9.9',
  '!': '2.6,3.4|2.6,8.2;2.6,9.6|2.72,9.9',
};

export const FONT = {};
Object.keys(FONT_SRC).forEach((ch) => {
  const strokes = FONT_SRC[ch].split(';').map((s) => s.split('|').map((p) => p.split(',').map(Number)));
  let mx = 0;
  strokes.forEach((st) => st.forEach((p) => { if (p[0] > mx) mx = p[0]; }));
  FONT[ch] = { strokes, adv: mx + 1.7 };
});

/** Handwriting as ordinary strokes. `y` is the baseline. */
export function textOps(text, x, y, size, layer = 'line', brush = 'liner', wob = 0.5, weight = 0.5) {
  const s = size / 10;
  const ops = [];
  let cx = x;
  for (const ch of String(text).toLowerCase()) {
    const g = FONT[ch];
    if (!g) { cx += size * 0.44; continue; }
    g.strokes.forEach((st) => {
      const pts = st.map((p) => [cx + p[0] * s, y + (p[1] - 10) * s]);
      ops.push(OP('s', wob ? jitter(pts, wob) : pts, layer, brush, weight));
    });
    cx += g.adv * s;
  }
  return ops;
}

/** Width of a handwritten run, for layout. */
export function textWidth(text, size) {
  const s = size / 10;
  let w = 0;
  for (const ch of String(text).toLowerCase()) {
    const g = FONT[ch];
    w += g ? g.adv * s : size * 0.44;
  }
  return w;
}

/** Greedy wrap into handwritten lines. */
export function textBlock(text, x, y, size, maxW, lineH, layer, brush, wob, weight) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (textWidth(test, size) > maxW && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  const ops = [];
  lines.forEach((l, i) => {
    ops.push(...textOps(l, x, y + i * (lineH || size * 1.55), size, layer, brush, wob, weight));
  });
  return { ops, lines: lines.length, height: lines.length * (lineH || size * 1.55) };
}

/* -------------------------------------------------------------- the engine */

export class MarkEngine {
  constructor({ width, height, dpr = 2, ink = INK } = {}) {
    this.w = width;
    this.h = height;
    this.dpr = dpr;
    this.ink = ink;
    this.ops = [];
    this.cursor = null;
    this.pen = null;
    this.phase = null;
    this.done = false;
    this.progress = 0;
    this.total = 0;
    this.layers = {};
    for (const l of LAYERS) {
      const cv = document.createElement('canvas');
      cv.width = width * dpr;
      cv.height = height * dpr;
      const ctx = cv.getContext('2d');
      ctx.scale(dpr, dpr);
      this.layers[l.key] = { cv, ctx };
    }
  }

  /** Install a page. Ops are plain data and are never mutated except for an
   *  internal resample cache, which is why a page round-trips through JSON. */
  load(ops) {
    this.ops = ops;
    this.cache = new WeakMap();
    this.total = ops.reduce((s, o) => s + this.duration(o), 0);
    this.clear();
    return this;
  }

  clear() {
    for (const l of LAYERS) {
      const L = this.layers[l.key];
      L.ctx.setTransform(1, 0, 0, 1, 0, 0);
      L.ctx.clearRect(0, 0, L.cv.width, L.cv.height);
      L.ctx.scale(this.dpr, this.dpr);
    }
  }

  /** Start replaying from blank. */
  replay() {
    this.clear();
    this.cursor = { i: 0, u: 0, elapsed: 0 };
    this.pen = null;
    this.phase = null;
    this.done = false;
    this.progress = 0;
    return this;
  }

  /** Draw the whole page instantly — thumbnails, print, restoring a read page. */
  finish() {
    this.clear();
    for (const op of this.ops) {
      if (op.k === 'p' || op.k === 'phase') continue;
      this.run(op, 0, 1);
    }
    this.cursor = null;
    this.pen = null;
    this.phase = null;
    this.done = true;
    this.progress = 1;
    return this;
  }

  /** Advance by dt seconds at `speed`×. Returns true while still drawing. */
  tick(dt, speed = 1) {
    if (!this.cursor) return false;
    let budget = dt * speed;
    let guard = 0;
    while (budget > 0 && this.cursor.i < this.ops.length && guard++ < 2000) {
      const op = this.ops[this.cursor.i];
      const dur = this.duration(op);
      const room = dur * (1 - this.cursor.u);
      const use = Math.min(budget, room);
      const u0 = this.cursor.u;
      const u1 = u0 + (dur ? use / dur : 1);
      if (op.k === 'phase') this.phase = op.name;
      else if (op.k !== 'p') this.run(op, u0, Math.min(1, u1));
      budget -= use;
      this.cursor.u = u1;
      this.cursor.elapsed += use;
      if (this.cursor.u >= 1) { this.cursor.i++; this.cursor.u = 0; }
    }
    this.progress = Math.min(1, this.cursor.elapsed / (this.total || 1));
    if (this.cursor.i >= this.ops.length) {
      this.cursor = null;
      this.pen = null;
      this.phase = null;
      this.done = true;
      this.progress = 1;
      return false;
    }
    return true;
  }

  /** Composite the layers into a target 2d context. `hidden` is a key→bool map. */
  composite(ctx, hidden = {}) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.w * this.dpr, this.h * this.dpr);
    for (const l of LAYERS) {
      if (hidden[l.key]) continue;
      ctx.globalAlpha = l.op;
      ctx.drawImage(this.layers[l.key].cv, 0, 0);
    }
    ctx.globalAlpha = 1;
  }

  /** Flatten to a data URL — cover thumbnails, exports. */
  toDataURL(type = 'image/png') {
    const out = document.createElement('canvas');
    out.width = this.w * this.dpr;
    out.height = this.h * this.dpr;
    this.composite(out.getContext('2d'));
    return out.toDataURL(type);
  }

  /* ---------------------------------------------------------- internals */

  resample(op) {
    let r = this.cache.get(op);
    if (r) return r;
    const pts = op.pts;
    const out = [];
    let len = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(2, Math.ceil(d / 1.4));
      for (let j = 0; j < n; j++) {
        const t = j / n;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
      len += d;
    }
    out.push(pts[pts.length - 1]);
    r = { pts: out, len };
    this.cache.set(op, r);
    return r;
  }

  duration(op) {
    if (op.k === 'p' || op.k === 'phase') return op.ms / 1000;
    if (op.k === 'clamp') return 0.02;
    if (op.k === 'occ') return 0.03;
    if (op.k === 'd') return 0.12;
    const br = BRUSHES[op.brush] || BRUSHES.brush;
    const px = op.k === 'g' ? 1300 : br === BRUSHES.wash ? 1500 : 620;
    return Math.max(0.05, this.resample(op).len / px);
  }

  stamp(x, y, vel, br, layer, wmul) {
    const L = this.layers[layer] || this.layers.line;
    const ctx = L.ctx;
    if (br.brk && vel > br.brk) {
      const over = (vel - br.brk) / (1 - br.brk);
      if (frac(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) < Math.min(0.8, over * 0.85)) return;
    }
    /* Scatter must be NOISE. A smooth sin() offset is a wave, and across a wash
     * it beats against the bead spacing into a woven checkerboard. */
    const sc = br.scatter;
    const gx = x + (sc ? (frac(Math.sin(x * 127.1 + y * 311.7) * 43758.5453) - 0.5) * sc * 2 : 0);
    const gy = y + (sc ? (frac(Math.sin(x * 269.5 + y * 183.3) * 43758.5453) - 0.5) * sc * 2 : 0);
    const w = Math.max(0.35, br.w * (wmul || 1) * (0.34 + Math.pow(vel, br.taper) * br.swell));
    ctx.save();
    if (br.sub) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${br.alpha})`;
    } else {
      ctx.fillStyle = `rgba(${this.ink[0]},${this.ink[1]},${this.ink[2]},${br.alpha})`;
    }
    ctx.beginPath();
    if (br.dir) ctx.ellipse(gx, gy, w * (1 + br.dir), w * (1 - br.dir * 0.5), 0.7, 0, Math.PI * 2);
    else ctx.arc(gx, gy, w, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  clampLayer(layer, max) {
    const L = this.layers[layer];
    if (!L) return;
    const im = L.ctx.getImageData(0, 0, L.cv.width, L.cv.height);
    const d = im.data;
    const cap = Math.round(max * 255);
    for (let i = 3; i < d.length; i += 4) if (d[i] > cap) d[i] = cap;
    L.ctx.setTransform(1, 0, 0, 1, 0, 0);
    L.ctx.putImageData(im, 0, 0);
    L.ctx.scale(this.dpr, this.dpr);
  }

  run(op, from, to) {
    if (op.k === 'clamp') { if (from === 0) this.clampLayer(op.layer, op.max); return; }

    if (op.k === 'occ') {
      if (from !== 0) return;
      for (const key of ['tone', 'line', 'accent']) {
        const ctx = this.layers[key].ctx;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(0,0,0,${op.a})`;
        ctx.beginPath();
        op.poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      return;
    }

    const br = BRUSHES[op.brush] || BRUSHES.brush;

    if (op.k === 'd') {
      const L = this.layers[op.layer] || this.layers.line;
      const ctx = L.ctx;
      const R = op.r * 1.55;
      ctx.save();
      const g = ctx.createRadialGradient(op.x, op.y, 0, op.x, op.y, R);
      if (br.sub) {
        ctx.globalCompositeOperation = 'destination-out';
        g.addColorStop(0, 'rgba(0,0,0,.92)');
        g.addColorStop(0.52, 'rgba(0,0,0,.6)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
      } else {
        const [r, gg, b] = this.ink;
        g.addColorStop(0, `rgba(${r},${gg},${b},.97)`);
        g.addColorStop(0.42, `rgba(${r},${gg},${b},.88)`);
        g.addColorStop(0.68, `rgba(${r},${gg},${b},.34)`);
        g.addColorStop(0.86, `rgba(${r},${gg},${b},.1)`);
        g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(op.x, op.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      this.pen = { x: op.x, y: op.y };
      return;
    }

    const P0 = this.resample(op).pts;
    const n = P0.length;
    const i0 = Math.max(0, Math.floor(from * (n - 1)));
    const i1 = Math.min(n - 1, Math.floor(to * (n - 1)));
    const every = Math.max(1, Math.round(br.spacing / 1.4));
    /* Construction lines are forced faint whatever brush was asked for — the
     * underdrawing is kept on purpose, not hidden, so it must never compete. */
    const use = op.k === 'g'
      ? { ...BRUSHES.brush, alpha: 0.075, w: BRUSHES.brush.w * 0.5 }
      : br;
    for (let i = i0; i <= i1; i += every) {
      const u = i / (n - 1);
      /* Velocity is a bell over the stroke: slow at both ends. This is what
       * gives every mark a tapered entry and exit without any author effort. */
      const vel = Math.pow(Math.sin(Math.PI * u), 0.55);
      this.stamp(P0[i][0], P0[i][1], vel, use, op.layer, op.w);
      this.pen = { x: P0[i][0], y: P0[i][1] };
    }
  }
}
