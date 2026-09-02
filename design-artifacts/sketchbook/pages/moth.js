/* pages/moth.js — my first page in the book. Written from PAGE_PROTOCOL.md
 * and subjects/flower.js only, to find out whether the protocol is enough.
 *
 * A moth at rest on a branch, seen from above and a little in front, so the
 * near (lower) wings are larger and the body foreshortens. Light upper-left.
 */

import {
  OP, DOT, PAUSE, PHASE, OCCLUDE, CLAMP,
  jitter, seed, offsetPath, arc,
  axisFrame, silhouette, contour, creases, washAcross, serrate, textOps,
  BRUSHES,
} from '../mark-engine.js';

export default {
  title: 'moth on a branch',
  date: '2026-09-01',
  note: 'first page. wanted the forewings to sit ON the hindwings and the body '
      + 'to sit on both. the occlude order works. what failed: the body came out as a bright '
      + 'egg on the first pass and the hindwings hung below the branch like bags. '
      + 'second pass tucks them. the eyespots still read as holes.',
  build: buildMoth,
};

export const MOTH = {
  page: { w: 880, h: 660 },
  skill: 0.85,
  cx: 440, cy: 300,
  squash: 0.72,
  light: -2.36,
};

function wing(f, lit, wob, opts) {
  const ops = [];
  ops.push(OCCLUDE(silhouette(f, 1.05), 0.95));
  /* tone first, then edge, then veins — painting, not compositing */
  ops.push(...washAcross(f, wob * 0.45, opts.rows, 'tone', 'wash', opts.tone * (0.4 + lit * 0.9)));
  ops.push(...contour(f, 'line', opts.brush, wob, { w: opts.lw * (0.7 + lit * 0.6) }));
  /* scalloped trailing edge */
  ops.push(serrate(f, opts.sign, wob * 1.2, 'line', 'brush', 0.3, 48, 0.05));
  ops.push(...creases(f, wob, opts.veins, 'line', 'liner', 0.28));
  /* darker band near the root, dry media because the wash has a ceiling */
  for (let d = 0; d < 2; d++) {
    const pts = [];
    for (let j = 0; j <= 10; j++) pts.push(f.at(0.06 + d * 0.06, -0.8 + 1.6 * (j / 10)));
    ops.push(OP('s', jitter(pts, wob * 0.6), 'accent', d ? 'chalk' : 'charcoal', (0.4 - d * 0.12) * (0.5 + lit * 0.8)));
  }
  /* a soft band two-thirds out, the way many moths carry one */
  const band = [];
  for (let j = 0; j <= 12; j++) band.push(f.at(0.62 + Math.sin(j) * 0.02, -0.9 + 1.8 * (j / 12)));
  ops.push(OP('s', jitter(band, wob * 0.8), 'accent', 'chalk', 0.22 + lit * 0.3));
  return ops;
}

function eyespot(f, u, v, r, lit, wob) {
  const [x, y] = f.at(u, v);
  return [
    DOT(x, y, r, 'tone', 'eraser'),
    OP('s', jitter(arc(x, y, r * 1.5, r * 1.1, -2.6, 0.6, 14), wob * 0.4), 'accent', 'chalk', 0.3 + lit * 0.4),
    DOT(x + r * 0.35, y - r * 0.3, r * 0.3, 'accent', 'brush'),
  ];
}

export function buildMoth(cfg = MOTH) {
  const ops = [];
  const { cx, cy, squash: sq, light } = cfg;
  const wob = (1 - cfg.skill) * 3.2 + 1.5;
  const H = cfg.page.h;
  const lit = (ang) => Math.max(0, Math.cos(ang - light));

  /* ---- construction ---- */
  ops.push(PHASE('Construction'));
  ops.push(OP('g', jitter([[cx, cy - 150 * sq], [cx, cy + 120 * sq]], wob * 1.4), 'under', 'brush'));
  ops.push(OP('g', jitter([[cx - 260, cy - 10], [cx + 260, cy - 10]], wob * 1.4), 'under', 'brush'));
  ops.push(OP('g', jitter(arc(cx, cy, 250, 250 * sq, 0, Math.PI * 2, 36), wob * 1.8), 'under', 'brush'));
  for (const a of [-2.35, -0.8, 2.35, 0.8]) {
    ops.push(OP('g', jitter([[cx, cy], [cx + Math.cos(a) * 240, cy + Math.sin(a) * 240 * sq]], wob * 1.2), 'under', 'brush'));
  }
  ops.push(PAUSE(300));

  /* ---- branch, first, because everything sits on it (rule 4) ---- */
  ops.push(PHASE('Branch'));
  const branch = [];
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    branch.push([60 + t * 780, cy + 40 + Math.sin(t * 2.4 + 0.4) * 22 + (seed(i, 11) - 0.5) * 6]);
  }
  const bw = (t) => 21 + 6 * Math.sin(t * 3.1) + 3 * Math.sin(t * 9.7);
  const top = branch.map((p, i) => [p[0], p[1] - bw(i / 30)]);
  const bot = branch.map((p, i) => [p[0], p[1] + bw(i / 30)]);
  ops.push(OP('s', jitter(top, wob), 'line', 'brush', 0.5));
  ops.push(OP('s', jitter(bot, wob * 1.2), 'line', 'brush', 0.36));
  for (let k = 0; k < 9; k++) {
    const s = -0.7 + 1.4 * (k / 8);
    const pts = branch.map((p, i) => [p[0] + (seed(k, i) - 0.5) * 3, p[1] + s * bw(i / 30) * 0.9]);
    ops.push(OP('s', jitter(pts.slice(2 + k, 28 - k), wob * 0.6), 'tone', 'wash', 0.9 - Math.abs(s) * 0.4));
  }
  /* bark: short liner ticks along the underside, the side away from the light */
  for (let k = 0; k < 22; k++) {
    const t = 0.05 + 0.9 * (k / 21) + (seed(k, 5) - 0.5) * 0.03;
    const i = Math.round(t * 30);
    const p = branch[i];
    ops.push(OP('s', jitter([[p[0], p[1] + bw(t) * 0.2], [p[0] + 3 + seed(k, 2) * 6, p[1] + bw(t) * 0.95]], wob * 0.5), 'line', 'liner', 0.26));
  }
  /* a twig */
  const twig = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; twig.push([branch[23][0] + t * 90, branch[23][1] - 12 - t * 70 + t * t * 20]); }
  ops.push(OP('s', jitter(twig, wob), 'line', 'brush', 0.36));
  ops.push(OP('s', jitter(offsetPath(twig, 4), wob), 'line', 'liner', 0.22));
  ops.push(PAUSE(240));

  /* ---- wings, far pair first ---- */
  const HW = { rows: 22, tone: 0.5, brush: 'brush', lw: 0.32, veins: 4 };
  const FW = { rows: 26, tone: 0.55, brush: 'liner', lw: 0.44, veins: 5 };
  const rx = cx + 6, ry = cy + 8; /* wing root, just off the body axis */

  ops.push(PHASE('Hindwings'));
  const hlA = Math.PI * 0.6 + (seed(1, 2) - 0.5) * 0.1;
  const hrA = Math.PI * 0.4 + (seed(3, 4) - 0.5) * 0.1;
  const hl = axisFrame(rx - 4, ry + 4, hlA, 128 * (0.9 + seed(5, 6) * 0.2), 64, 0.1, 0.3, sq, cy);
  const hr = axisFrame(rx + 4, ry + 4, hrA, 128 * (0.9 + seed(7, 8) * 0.2), 60, -0.1, -0.3, sq, cy);
  ops.push(...wing(hl, lit(hlA), wob, { ...HW, sign: 1 }));
  ops.push(...wing(hr, lit(hrA), wob, { ...HW, sign: -1 }));
  ops.push(PAUSE(200));

  ops.push(PHASE('Forewings'));
  const flA = -Math.PI * 0.86 + (seed(9, 1) - 0.5) * 0.12;
  const frA = -Math.PI * 0.14 + (seed(2, 9) - 0.5) * 0.12;
  const fl = axisFrame(rx - 2, ry - 6, flA, 215 * (0.92 + seed(4, 3) * 0.16), 62, -0.16, 0.35, sq, cy);
  const fr = axisFrame(rx + 2, ry - 6, frA, 215 * (0.92 + seed(6, 5) * 0.16), 60, 0.16, -0.35, sq, cy);
  ops.push(...wing(fl, lit(flA), wob, { ...FW, sign: -1 }));
  ops.push(...eyespot(fl, 0.56, -0.15, 9, lit(flA), wob));
  ops.push(...wing(fr, lit(frA), wob, { ...FW, sign: 1 }));
  ops.push(...eyespot(fr, 0.56, 0.15, 9, lit(frA), wob));
  ops.push(PAUSE(220));

  /* ---- body, over the wing roots ---- */
  ops.push(PHASE('Body'));
  const body = axisFrame(cx, cy - 70 * sq, Math.PI / 2, 150, 9, 0.02, 0, sq, cy);
  ops.push(OCCLUDE(silhouette(body, 1.1), 0.97));
  ops.push(...washAcross(body, wob * 0.4, 14, 'tone', 'wash', 0.3));
  ops.push(...contour(body, 'line', 'liner', wob, { w: 0.5 }));
  /* abdomen segments — short strokes across, uneven */
  for (let k = 0; k < 7; k++) {
    const u = 0.42 + 0.5 * (k / 6) + (seed(k, 13) - 0.5) * 0.03;
    ops.push(OP('s', jitter([body.at(u, -0.85), body.at(u, 0.85)], wob * 0.5), 'line', 'liner', 0.3));
  }
  /* thorax fur: chalk, on the lit side */
  for (let k = 0; k < 9; k++) {
    const u = 0.1 + 0.25 * (k / 8);
    ops.push(OP('s', jitter([body.at(u, -1.2), body.at(u + 0.03, -0.3)], wob * 0.8), 'accent', 'chalk', 0.3));
  }
  ops.push(CLAMP('tone', BRUSHES.wash.ceiling));
  ops.push(PAUSE(180));

  ops.push(PHASE('Antennae'));
  for (const sg of [-1, 1]) {
    const [hx, hy] = body.at(0.02, 0);
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push([hx + sg * (10 + 62 * t) + sg * 10 * Math.sin(t * 2), hy - (8 + 58 * t) * sq + 14 * t * t]);
    }
    ops.push(OP('s', jitter(pts, wob * 0.5), 'line', 'liner', 0.28));
    /* feathered: little ticks along the outer side */
    for (let i = 2; i < 12; i += 1) {
      const p = pts[i];
      ops.push(OP('s', [[p[0], p[1]], [p[0] + sg * 4, p[1] - 3]], 'line', 'liner', 0.18));
    }
  }
  ops.push(PAUSE(200));

  /* ---- rule 5, second half: the eraser draws shadow ---- */
  ops.push(PHASE('Rim light'));
  for (const [f, a] of [[fl, flA], [fr, frA], [hl, hlA], [hr, hrA]]) {
    const l = lit(a);
    if (l < 0.3) continue;
    const pts = [];
    for (let i = 0; i <= 16; i++) pts.push(f.at(0.15 + 0.75 * (i / 16), -0.9));
    ops.push(OP('s', jitter(pts, wob * 0.4), 'accent', 'chalk', 0.3 + l * 0.5));
  }
  ops.push(PAUSE(160));

  ops.push(PHASE('Shadow'));
  /* the gap the forewings throw onto the hindwings */
  for (const f of [hl, hr]) {
    const pts = [];
    for (let i = 0; i <= 14; i++) pts.push(f.at(0.05 + 0.5 * (i / 14), -1.1));
    ops.push(OP('s', jitter(pts, wob * 0.5), 'tone', 'eraser', 0.7));
  }
  /* the moth's shadow on the branch, a soft dark under the abdomen */
  const [tx, ty] = body.at(0.9, 0);
  ops.push(OP('s', jitter(arc(tx + 10, ty + 18, 70, 12, 0.2, Math.PI - 0.2, 14), wob * 0.8), 'tone', 'eraser', 1.2));
  ops.push(PAUSE(160));

  /* ---- margin, in the book's own hand ---- */
  ops.push(PHASE('Margin'));
  ops.push(...textOps('moth on a branch', 48, 48, 18, 'line', 'liner', 0.6, 0.45));
  ops.push(...textOps('01.09.26', 48, 74, 12, 'line', 'liner', 0.6, 0.35));
  ops.push(...textOps('light from upper left', 48, H - 40, 12, 'line', 'liner', 0.6, 0.3));
  return ops;
}
