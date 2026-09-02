/* subjects/flower.js — a worked page, and the reference for how to write one.
 *
 * This is the drawing in Flower Study.dc.html, rebuilt on the generalized
 * vocabulary. Read it as the answer to "what does an agent actually write?":
 * a pure function from config to an op array. No canvas, no DOM, no engine —
 * it returns data. That is what makes a page saveable.
 *
 * Every one of the five rules in the README is visible here. The comments mark
 * where.
 */

import {
  OP, DOT, PAUSE, PHASE, OCCLUDE, CLAMP,
  arc, jitter, seed, offsetPath,
  axisFrame, silhouette, contour, creases, washAcross, serrate,
  BRUSHES,
} from '../mark-engine.js';

export const FLOWER = {
  page: { w: 880, h: 660 },
  skill: 0.9,
  cx: 404, cy: 236, R: 178,
  stamens: 18,
  /* RULE 1 — the bloom is a disc seen at an angle, not a rosette. */
  squash: 0.6,
  /* RULE 5 — one key light, upper left. */
  light: -2.36,
  rings: [
    { phase: 'Back ring',   n: 6, a0: -2.05, inset: 22, L: 190, W: 74, curl: 0.14, twist: 0.34, rows: 34, creases: 2, tone: 0.5,  brush: 'brush', lw: 0.32, occ: 0.94 },
    { phase: 'Middle ring', n: 6, a0: -1.34, inset: 13, L: 148, W: 66, curl: 0.22, twist: -0.3, rows: 27, creases: 3, tone: 0.44, brush: 'brush', lw: 0.4,  occ: 0.96 },
    { phase: 'Front ring',  n: 5, a0: -0.62, inset: 34, L: 78,  W: 44, curl: 0.4,  twist: 0.4,  rows: 20, creases: 2, tone: 0.34, brush: 'liner', lw: 0.5,  occ: 0.97 },
  ],
};

function leaf(cx, cy, ang, L, W, curl, wob) {
  const ops = [];
  const f = axisFrame(cx, cy, ang, L, W, curl, 0, 1);
  ops.push(serrate(f, -1, wob, 'line', 'brush', 0.42));
  ops.push(serrate(f, 1, wob * 1.1, 'line', 'brush', 0.36));
  ops.push(OP('s', jitter([f.at(-0.02, 0), f.at(0.4, 0.02), f.at(0.99, 0)], wob * 0.8), 'line', 'brush', 0.34));
  for (let k = 0; k < 7; k++) {
    const u0 = 0.1 + 0.78 * (k / 6);
    for (const sg of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        pts.push(f.at(Math.min(0.97, u0 + 0.16 * t), sg * 0.92 * t));
      }
      ops.push(OP('s', jitter(pts, wob * 0.6), 'line', 'liner', 0.24));
    }
  }
  ops.push(...washAcross(f, wob * 0.4, 30, 'tone', 'wash', 0.34));
  for (let i = 0; i < 5; i++) {
    const pts = [];
    for (let j = 0; j <= 12; j++) pts.push(f.at(0.12 + 0.72 * (j / 12), 0.28 + i * 0.16));
    ops.push(OP('s', jitter(pts, wob * 0.6), 'accent', 'chalk', 0.3));
  }
  return ops;
}

export function buildFlower(cfg = FLOWER) {
  const ops = [];
  const { cx, cy, R, squash: sq, light } = cfg;
  const wob = (1 - cfg.skill) * 3.2 + 1.5;
  const CH = cfg.page.h;

  /* ---- construction, kept on purpose ---- */
  ops.push(PHASE('Construction'));
  ops.push(OP('g', jitter(arc(cx, cy, R * 1.02, R * 1.02 * sq, -0.5, Math.PI * 2 - 0.5, 40), wob * 1.8), 'under', 'brush'));
  ops.push(OP('g', jitter(arc(cx, cy, R * 0.3, R * 0.3 * sq, -0.5, Math.PI * 2 - 0.5, 26), wob * 1.6), 'under', 'brush'));
  ops.push(OP('g', jitter([[cx - R * 0.55, cy], [cx + R * 0.55, cy]], wob * 1.3), 'under', 'brush'));
  ops.push(OP('g', jitter([[cx, cy - R * 1.1 * sq], [cx + 26, cy + R * 2.6]], wob * 1.4), 'under', 'brush'));
  for (let k = 0; k < 8; k++) {
    const a = -1.9 + Math.PI * 2 * (k / 8);
    ops.push(OP('g', jitter([[cx, cy], [cx + Math.cos(a) * R * 1.05, cy + Math.sin(a) * R * 1.05 * sq]], wob * 1.2), 'under', 'brush'));
  }
  ops.push(PAUSE(320));

  /* ---- frames, with RULE 2 (nothing is regular) and RULE 5 (one light) ---- */
  const frames = [];
  cfg.rings.forEach((ring, ri) => {
    for (let k = 0; k < ring.n; k++) {
      const j1 = seed(ri * 3.1 + 1, k + 2);
      const j2 = seed(ri * 7.7 + 5, k * 1.7 + 3);
      const j3 = seed(ri * 2.3 + 9, k * 2.9 + 7);
      /* uneven angular spacing, uneven length: a flower is not a gear */
      const a = ring.a0 + Math.PI * 2 * ((k + (j1 - 0.5) * 0.5) / ring.n);
      /* a petal turned into the light takes more pigment; one turned away is
       * left nearer the bare paper. Without this every petal weighs the same
       * and the bloom stays flat however good the drawing is. */
      const lit = Math.max(0, Math.cos(a - light));
      frames.push({
        ri, ring, lit,
        tone: 0.42 + lit * 0.95,
        lw: 0.72 + lit * 0.6,
        f: axisFrame(
          cx + Math.cos(a) * ring.inset,
          cy + Math.sin(a) * ring.inset * 0.7,
          a,
          ring.L * (0.78 + j2 * 0.42),
          ring.W * (0.84 + j3 * 0.32),
          ring.curl * (0.5 + j1 * 1.1),
          ring.twist * (0.3 + j2 * 1.3) * (j3 > 0.5 ? 1 : -1),
          sq, cy,
        ),
      });
    }
  });

  /* ---- RULE 4 — what will be covered goes down first ---- */
  ops.push(PHASE('Stem'));
  const sx = cx + 6, sy = cy + R * 0.82 * sq;
  const stem = [];
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    stem.push([sx + 26 * Math.sin(t * 1.5) + t * t * 30, sy - 40 + t * (CH - sy + 30)]);
  }
  ops.push(OP('s', jitter(offsetPath(stem, -7), wob * 0.9), 'line', 'brush', 0.45));
  ops.push(OP('s', jitter(offsetPath(stem, 7), wob * 0.9), 'line', 'brush', 0.3));
  for (let i = 0; i < 4; i++) {
    ops.push(OP('s', jitter(offsetPath(stem, 1.5 + i * 1.8), wob * 0.5), 'tone', 'wash', 0.5));
  }
  for (const sg of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      pts.push([sx + sg * (36 * Math.sin(t * 2.1)) - 4 * t, sy + 10 * t + 34 * t * t]);
    }
    ops.push(OP('s', jitter(pts, wob), 'line', 'brush', 0.4));
  }
  ops.push(PAUSE(200));

  ops.push(PHASE('Leaves'));
  ops.push(...leaf(stem[13][0] - 6, stem[13][1], Math.PI * 0.9, 176, 26, 0.26, wob));
  ops.push(...leaf(stem[21][0] + 6, stem[21][1], Math.PI * 0.12, 142, 22, -0.3, wob));
  ops.push(PAUSE(240));

  /* ---- RULE 3 — petal by petal, back to front, each clearing what it covers.
   * Note this is NOT "all contours, then all wash". A layered form is painted
   * one element at a time or the occlusion has nothing to bite on. ---- */
  cfg.rings.forEach((ring, ri) => {
    ops.push(PHASE(ring.phase));
    frames.filter((fr) => fr.ri === ri).forEach((fr, i) => {
      ops.push(OCCLUDE(silhouette(fr.f), ring.occ));
      ops.push(...contour(fr.f, 'line', ring.brush, wob, { w: ring.lw * fr.lw }));
      ops.push(...washAcross(fr.f, wob * 0.45, ring.rows, 'tone', 'wash', ring.tone * fr.tone));
      ops.push(...creases(fr.f, wob, ring.creases, 'line', 'liner'));
      for (let d = 0; d < 3; d++) {
        const pts = [];
        for (let j = 0; j <= 10; j++) {
          const s = -0.85 + 1.7 * (j / 10);
          pts.push(fr.f.at(0.05 + d * 0.075, s * (0.9 - d * 0.12)));
        }
        ops.push(OP('s', jitter(pts, wob * 0.6), 'accent', d === 0 ? 'charcoal' : 'chalk',
          (0.46 - d * 0.11) * (1 + ri * 0.2) * (0.5 + fr.lit * 0.8)));
      }
      if (i % 2 === 1) ops.push(PAUSE(110));
    });
    ops.push(PAUSE(220));
  });
  ops.push(CLAMP('tone', BRUSHES.wash.ceiling));

  /* ---- throat: the wash has a ceiling, so every true dark is dry media ---- */
  ops.push(PHASE('Throat'));
  for (let i = 0; i < 7; i++) {
    const k = i / 6;
    ops.push(OP('s', jitter(arc(cx + 6, cy + 2, R * (0.28 - k * 0.1), R * (0.28 - k * 0.1) * sq,
      0.1 + k * 0.9, Math.PI * 2.1 - k * 0.5, 24), wob * 0.55), 'accent', 'charcoal', 0.26));
  }
  ops.push(PAUSE(260));

  ops.push(PHASE('Stamens'));
  for (let k = 0; k < cfg.stamens; k++) {
    const a = -1.4 + Math.PI * 2 * (k / cfg.stamens) + Math.sin(k * 3.1) * 0.08;
    const len = R * (0.2 + 0.12 * Math.abs(Math.sin(k * 1.7)));
    const pts = [];
    for (let i = 0; i <= 7; i++) {
      const t = i / 7;
      pts.push([
        cx + 6 + Math.cos(a) * len * t,
        cy + 2 + Math.sin(a) * len * t * sq - 16 * Math.sin(Math.PI * t) * (0.5 + 0.5 * Math.sin(k * 2.3)),
      ]);
    }
    ops.push(OP('s', jitter(pts, wob * 0.5), 'accent', 'liner', 0.32));
    const e = pts[pts.length - 1];
    ops.push(DOT(e[0], e[1], 1.3 + 0.7 * Math.abs(Math.sin(k * 2.9)), 'accent', 'brush'));
  }
  for (let k = 0; k < 54; k++) {
    const a = k * 2.39996;
    const rr = R * 0.26 * Math.sqrt(k / 54);
    const x = cx + 6 + Math.cos(a) * rr, y = cy + 2 + Math.sin(a) * rr * sq;
    ops.push(OP('s', [[x, y], [x + 1, y + 1]], 'accent', 'stipple', 0.5));
  }
  ops.push(PAUSE(260));

  /* ---- RULE 5, second half: ink IS light here, so the eraser draws SHADOW.
   * Rim light is chalk going on; the eraser cuts the gap a front petal throws
   * onto the one behind it. Getting this backwards is what a naive port does. */
  ops.push(PHASE('Rim light'));
  frames.forEach((fr) => {
    if (fr.lit < 0.25) return;
    const pts = [];
    for (let i = 0; i <= 18; i++) pts.push(fr.f.at(0.22 + 0.7 * (i / 18), -0.86));
    ops.push(OP('s', jitter(pts, wob * 0.4), 'accent', 'chalk', 0.34 + fr.lit * 0.5));
  });
  ops.push(PAUSE(180));

  ops.push(PHASE('Separation'));
  frames.filter((fr) => fr.ri > 0).forEach((fr) => {
    const pts = [];
    for (let i = 0; i <= 18; i++) pts.push(fr.f.at(0.1 + 0.82 * (i / 18), 1.14));
    ops.push(OP('s', jitter(pts, wob * 0.4), 'tone', 'eraser', 0.5 + fr.lit * 0.5));
  });
  ops.push(PAUSE(200));

  ops.push(PHASE('Ground'));
  for (let i = 0; i < 4; i++) {
    ops.push(OP('s', jitter(arc(cx + 60, CH - 26 - i * 5, 150 - i * 26, 9 - i * 1.4, 0.25, Math.PI - 0.25, 16), wob * 0.7), 'accent', 'stipple', 0.9));
  }
  return ops;
}

export const PHASES = [
  ['Construction', 'squashed bloom ellipse, throat, eight spokes'],
  ['Stem', "goes down first — the petals will cover it"],
  ['Leaves', 'serrated edge, midrib, seven vein pairs each'],
  ['Back ring', 'six petals, softest weight, furthest away'],
  ['Middle ring', 'each petal clears the ones behind it'],
  ['Front ring', 'five petals, crispest line, most curl'],
  ['Throat', 'charcoal — the wash cannot go this dark'],
  ['Stamens', 'filaments, anthers, phyllotactic pollen'],
  ['Rim light', 'chalk on the lit edge — ink IS light here'],
  ['Separation', 'eraser, cutting the shadow a petal throws'],
  ['Ground', 'stipple, so it is standing on something'],
];
