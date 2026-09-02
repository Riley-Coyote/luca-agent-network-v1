/* pages/study.js — page 2. A sphere and a cube on a table, one light.
 * The classic tonal study: highlight, halftone, core shadow, reflected light,
 * cast shadow. Drawn to find out how much control over tone the hand allows.
 */

import { OP, PAUSE, PHASE, OCCLUDE, CLAMP, jitter, seed, arc, textOps, textBlock, BRUSHES } from '../mark-engine.js';
import { sphereRings, sphereMeridians, hatchPoly, passesFor, ellipsePoly, inEllipse, inside, highlight, norm } from './lib.js';

export default {
  title: 'sphere and cube, one light',
  date: '2026-09-02',
  note: 'tonal study. rings around the light axis so each ring is one value. '
      + 'wanted a true core shadow and a real bounce off the table.',
  build: buildStudy,
};

const W = 880, H = 660;

export function buildStudy() {
  const ops = [];
  const wob = 1.3;
  const horizon = 250;
  const L = norm([-0.55, -0.62, 0.56]); /* upper left, in front */

  /* sphere */
  const sx = 560, sy = 350, sr = 150;
  /* cube */
  const o = [150, 500], s = 120;
  const dvec = [s * 0.52, -s * 0.3], hvec = [0, -s * 0.94];
  const P = (...vs) => vs.reduce((a, v) => [a[0] + v[0], a[1] + v[1]], o);
  const front = [P(), P([s, 0]), P([s, 0], hvec), P(hvec)];
  const top = [P(hvec), P([s, 0], hvec), P([s, 0], hvec, dvec), P(hvec, dvec)];
  const right = [P([s, 0]), P([s, 0], dvec), P([s, 0], dvec, hvec), P([s, 0], hvec)];

  /* cast shadows on the table: away from the light, so right and back */
  const shSphere = { cx: sx + sr * 0.95, cy: sy + sr * 0.74, rx: sr * 1.3, ry: sr * 0.42, rot: 0.12 };
  const shv = [s * 0.95, -s * 0.34];
  const shCube = [P([s, 0]), P([s, 0], shv), P([s, 0], shv, dvec), P([s, 0], dvec)];
  const inContact = (p) => inEllipse(p, sx, sy + sr - 2, sr * 0.72, sr * 0.11);
  const inShadow = (p) => inEllipse(p, shSphere.cx, shSphere.cy, shSphere.rx, shSphere.ry, shSphere.rot) || inside(p, shCube);

  /* ---- construction ---- */
  ops.push(PHASE('Construction'));
  ops.push(OP('g', jitter([[30, horizon], [W - 30, horizon]], wob * 1.5), 'under', 'brush'));
  ops.push(OP('g', jitter(arc(sx, sy, sr, sr, 0, Math.PI * 2, 40), wob * 1.8), 'under', 'brush'));
  ops.push(OP('g', jitter([[sx, sy - sr], [sx, sy + sr]], wob), 'under', 'brush'));
  ops.push(OP('g', jitter([[sx - sr, sy], [sx + sr, sy]], wob), 'under', 'brush'));
  for (const q of [front, top, right]) ops.push(OP('g', jitter(q.concat([q[0]]), wob * 1.3), 'under', 'brush'));
  /* the hidden back edges too — it is a study */
  ops.push(OP('g', jitter([P(dvec), P(dvec, hvec)], wob), 'under', 'brush'));
  ops.push(OP('g', jitter([P(dvec), P([s, 0], dvec)], wob), 'under', 'brush'));
  ops.push(OP('g', jitter([P(dvec), P()], wob), 'under', 'brush'));
  ops.push(OP('g', jitter(ellipsePoly(shSphere.cx, shSphere.cy, shSphere.rx, shSphere.ry, shSphere.rot, 30).concat([]), wob * 1.5), 'under', 'brush'));
  /* light arrow */
  ops.push(OP('g', jitter([[120, 60], [220, 170]], wob), 'under', 'brush'));
  ops.push(PAUSE(320));

  /* ---- table, first: everything sits on it ---- */
  ops.push(PHASE('Table'));
  const bands = 9;
  for (let b = 0; b < bands; b++) {
    const y0 = horizon + ((H - horizon) * b) / bands, y1 = horizon + ((H - horizon) * (b + 1)) / bands;
    const t = (b + 0.5) / bands; /* 0 at horizon, 1 at the front edge */
    /* the light is upper-left-front: the table is brightest near the front left */
    for (let c = 0; c < 3; c++) {
      const x0 = 20 + ((W - 40) * c) / 3, x1 = 20 + ((W - 40) * (c + 1)) / 3;
      const lum = (0.05 + 0.3 * t) * (1 - 0.35 * ((c + 0.5) / 3));
      const poly = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      ops.push(...hatchPoly(poly, 0.02 + (seed(b, c) - 0.5) * 0.05, 4.2 - t * 1.2, wob, passesFor(lum), (p) => inShadow(p) || inContact(p), b * 3 + c));
    }
  }
  /* the shadows are not pure black: a little bounce reaches into them */
  ops.push(...hatchPoly(ellipsePoly(shSphere.cx, shSphere.cy, shSphere.rx * 1.02, shSphere.ry * 1.04, shSphere.rot), 0.05, 4.5, wob, [['wash', 0.16, 'tone']], inContact, 77));
  ops.push(...hatchPoly(shCube, 0.05, 4.5, wob, [['wash', 0.15, 'tone']], null, 78));
  ops.push(PAUSE(260));

  /* ---- cube: three planes, three values ---- */
  ops.push(PHASE('Cube'));
  ops.push(OCCLUDE(front, 0.97));
  ops.push(OCCLUDE(top, 0.97));
  ops.push(OCCLUDE(right, 0.97));
  ops.push(...hatchPoly(top, Math.atan2(dvec[1], dvec[0]), 3.2, wob, passesFor(0.88), null, 5));
  ops.push(...hatchPoly(top, 0.03, 4.6, wob, [['brush', 0.16, 'accent']], null, 6));
  ops.push(...hatchPoly(front, 0.04, 3.4, wob, passesFor(0.5), null, 7));
  ops.push(...hatchPoly(right, Math.PI / 2 + 0.03, 3.6, wob, passesFor(0.16), null, 8));
  /* the front face is not flat: it falls off away from the light, so a second faint pass on its left */
  ops.push(...hatchPoly([front[0], [front[0][0] + s * 0.55, front[1][1]], [front[0][0] + s * 0.55, front[2][1]], front[3]], -1.2, 3.6, wob, [['wash', 0.22, 'tone']], null, 9));
  /* lit edges only: top-front and top-left, in liner. the shadow edges are lost. */
  ops.push(OP('s', jitter([front[3], front[2]], wob), 'line', 'liner', 0.5));
  ops.push(OP('s', jitter([front[0], front[3]], wob), 'line', 'liner', 0.4));
  ops.push(OP('s', jitter([front[2], top[2]], wob * 1.2), 'line', 'liner', 0.28));
  ops.push(OP('s', jitter([top[3], top[2]], wob * 1.2), 'line', 'liner', 0.3));
  ops.push(PAUSE(240));

  /* ---- sphere ---- */
  ops.push(PHASE('Sphere'));
  ops.push(OCCLUDE(arc(sx, sy, sr * 1.01, sr * 1.01, 0, Math.PI * 2, 48), 0.98));
  ops.push(...sphereRings(sx, sy, sr, L, wob, {
    step: 3.1,
    gain: 0.78, /* the sphere likes thinner strokes than the hand does */
    ambient: 0.02,
    bounce: { dir: [0.15, 1, 0.35], amt: 0.34 }, /* off the table, from below */
  }));
  ops.push(PAUSE(200));
  ops.push(PHASE('Cross-hatch'));
  ops.push(...sphereMeridians(sx, sy, sr, L, wob, 28, 0.5));
  ops.push(CLAMP('tone', BRUSHES.wash.ceiling));
  ops.push(PAUSE(200));

  ops.push(PHASE('Highlight'));
  ops.push(...highlight(sx + L[0] * sr * 0.86, sy + L[1] * sr * 0.86, 9, 11));
  ops.push(PAUSE(180));

  /* ---- margin ---- */
  ops.push(PHASE('Margin'));
  ops.push(...textOps('sphere and cube', 48, 44, 18, 'line', 'liner', 0.6, 0.45));
  ops.push(...textOps('one light, upper left, in front', 48, 70, 11, 'line', 'liner', 0.6, 0.32));
  ops.push(...textOps('02.09.26', 48, 92, 11, 'line', 'liner', 0.6, 0.3));
  ops.push(...textOps('light', 232, 182, 11, 'line', 'liner', 0.6, 0.3));
  const note = textBlock('highlight  halftone  core  bounce  cast', 48, H - 40, 11, 300, 17, 'line', 'liner', 0.6, 0.3);
  ops.push(...note.ops);
  return ops;
}
