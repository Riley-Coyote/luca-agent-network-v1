/* pages/hand.js — page 3. A hand at rest on the table, fingers curled, thumb out.
 *
 * Built as forms, not outlines: the fingers are tubes, the joints spheres, the
 * palm a flattened egg. One light shades all of them the same way the sphere
 * on page 2 was shaded, so the tone is right by construction. The question is
 * whether the drawing reads.
 */

import { OP, PAUSE, PHASE, OCCLUDE, CLAMP, jitter, seed, textOps, BRUSHES } from '../mark-engine.js';
import { norm, dot3, cross, shadeParam, tube, ellipsoid, sphere, hull, hatchPoly, passesFor, inside, castOnPlane } from './lib.js';

export default {
  title: 'a hand, resting',
  date: '2026-09-02',
  note: 'forms first: tubes, spheres, an egg for the palm, then the light. '
      + 'four passes. the fingers work: they shade each other, the nails and creases sit. '
      + 'it still reads as a glove, and the reason is the palm: an egg is a dome, and '
      + 'the back of a hand is nearly flat and wider at the knuckles. one form is not enough there.',
  build: buildHand,
};

const W = 880, H = 660;

export function buildHand(opts = {}) {
  const ops = [];
  const wob = 1.15;
  const S = 1.75;                          /* hand units → page px */
  const O = [430, 468, 0];                 /* the wrist, on the page */
  const beta = 0.66;                       /* tilt of the table: fingers go away and up */
  const f = [0, -Math.cos(beta), -Math.sin(beta)];   /* forward, along the fingers */
  const s = [1, 0, 0];                               /* sideways */
  const n = cross(f, s);                             /* up off the table, toward us */
  const L = norm([-0.5, -0.55, 0.68]);
  const lamp = [O[0] - 340, O[1] - 420, 430];
  const light = { lamp, lampFall: 900, ambient: 0.03, bounce: { dir: n.map((c) => -c), amt: 0.14 }, bucket: 0.08, gamma: 1.05 };
  const P = (a, b, c) => [0, 1, 2].map((k) => O[k] + (f[k] * a + s[k] * b + n[k] * c) * S);
  const tableO = P(0, 0, -2);

  /* -------------------------------------------------- the forms */
  const forms = []; /* { sample, uN, vN, kind, extra } */
  const add = (sample, uN, vN, kind, extra = {}) => forms.push({ sample, uN, vN, kind, ...extra });

  /* wrist and palm */
  add(tube(P(-58, 0, 9), P(0, 0, 12), 27 * S, 31 * S, 12 * S, n), 12, 42, 'wrist');
  if (opts.palm === 'plates') {
    /* the back of a hand is nearly flat and widest at the knuckles: a flat
     * plate for the metacarpals, a rounder heel, and the mound under the thumb */
    add(ellipsoid(P(62, 2, 14), f, n, s, 42 * S, 7.5 * S, 47 * S), 56, 40, 'palm');
    add(ellipsoid(P(16, 4, 12), f, n, s, 30 * S, 11 * S, 37 * S), 48, 34, 'heel');
    add(ellipsoid(P(30, -30, 8), f, n, s, 26 * S, 9 * S, 17 * S), 40, 26, 'mound');
  } else {
    add(ellipsoid(P(50, 1, 16), f, n, s, 66 * S, 11 * S, 44 * S), 56, 44, 'palm');
  }

  /* fingers: base b across the knuckles, lengths and radii per finger, curl
   * increasing toward the little finger. nothing regular: seed everything. */
  const fingers = [
    { b: -33, len: [44, 27, 21], r: [9.6, 8.6, 7.6], curl: [8, 16, 14], spread: -9 },
    { b: -11, len: [48, 30, 23], r: [10, 9, 8], curl: [7, 14, 13], spread: -2 },
    { b: 11, len: [44, 28, 21], r: [9.2, 8.2, 7.2], curl: [8, 17, 15], spread: 5 },
    { b: 32, len: [34, 22, 17], r: [8, 7, 6.2], curl: [11, 21, 18], spread: 13 },
  ];
  const rad = (d) => (d * Math.PI) / 180;
  fingers.forEach((fg, fi) => {
    const sp = rad(fg.spread + (seed(fi, 1) - 0.5) * 4);
    /* forward direction of this finger in the hand frame, spread around n */
    const fw = [Math.cos(sp), Math.sin(sp), 0];             /* (a, b, c) */
    let J = [92, fg.b, 26];
    let curl = 0;
    /* knuckle */
    add(sphere(P(...J), fg.r[0] * 1.04 * S, L), 22, 9, 'knuckle', { fi });
    for (let k = 0; k < 3; k++) {
      curl += rad(fg.curl[k] * (0.85 + seed(fi * 3 + k, 2) * 0.3));
      const d = [fw[0] * Math.cos(curl), fw[1] * Math.cos(curl), -Math.sin(curl)];
      const len = fg.len[k] * (0.94 + seed(fi, k + 5) * 0.12);
      const J2 = [J[0] + d[0] * len, J[1] + d[1] * len, J[2] + d[2] * len];
      const r0 = fg.r[k], r1 = k < 2 ? fg.r[k + 1] : fg.r[k] * 0.86;
      /* the back of the finger faces "up" rotated by the curl */
      const back = [fw[0] * Math.sin(curl), fw[1] * Math.sin(curl), Math.cos(curl)];
      const backW = norm([0, 1, 2].map((q) => f[q] * back[0] + s[q] * back[1] + n[q] * back[2]));
      add(tube(P(...J), P(...J2), r0 * S, r1 * S, null, backW), 14, Math.round((2 * Math.PI * r0 * S) / 3.2), 'phalanx', { fi, k, J, J2, back: backW, r0, r1, len });
      const dW = norm([0, 1, 2].map((q) => f[q] * d[0] + s[q] * d[1] + n[q] * d[2]));
      add(sphere(P(...J2), r1 * (k < 2 ? 0.98 : 0.94) * S, dW), 22, 8, k < 2 ? 'joint' : 'tip', { fi, k, dW });
      J = J2;
    }
  });

  /* thumb: out to the left and forward, three straight forms */
  {
    const segs = [
      { d: [0.5, -0.84, 0.16], len: 40, r0: 12.5, r1: 11.5 },
      { d: [0.68, -0.7, 0.2], len: 32, r0: 11, r1: 9.8 },
      { d: [0.86, -0.46, 0.2], len: 26, r0: 9.6, r1: 8.2 },
    ];
    let J = [28, -44, 8];
    segs.forEach((sg, k) => {
      const d = norm(sg.d);
      const J2 = [J[0] + d[0] * sg.len, J[1] + d[1] * sg.len, J[2] + d[2] * sg.len];
      const backW = norm([0, 1, 2].map((q) => f[q] * 0.1 + n[q] * 0.95 - s[q] * 0.3));
      add(tube(P(...J), P(...J2), sg.r0 * S, sg.r1 * S, null, backW), 14, Math.round((2 * Math.PI * sg.r0 * S) / 3.2), 'phalanx', { fi: 4, k, J, J2, back: backW, r0: sg.r0, r1: sg.r1, len: sg.len });
      const dW = norm([0, 1, 2].map((q) => f[q] * d[0] + s[q] * d[1] + n[q] * d[2]));
      add(sphere(P(...J2), sg.r1 * (k < 2 ? 0.98 : 0.94) * S, dW), 22, 8, k < 2 ? 'joint' : 'tip', { fi: 4, k, dW });
      J = J2;
    });
  }

  /* -------------------------------------------------- shade everything, then sort by depth */
  const shaded = forms.map((fm) => {
    const base = fm.fi !== undefined && fm.fi > 0 && fm.fi < 4
      ? (p, nn) => 1 - 0.45 * Math.max(0, -dot3(nn, s) - 0.1)
      : fm.kind === 'palm' || fm.kind === 'heel' || fm.kind === 'mound' ? () => 0.84 : () => 1;
    const skin = (p) => {
      const gx = p[0] / 14, gy = p[1] / 14, ix = Math.floor(gx), iy = Math.floor(gy);
      const fx = gx - ix, fy = gy - iy;
      const v = (a, b) => seed(a + 3, b + 7);
      const top = v(ix, iy) * (1 - fx) + v(ix + 1, iy) * fx;
      const bot = v(ix, iy + 1) * (1 - fx) + v(ix + 1, iy + 1) * fx;
      return 0.86 + 0.28 * (top * (1 - fy) + bot * fy);
    };
    const modulate = opts.skin ? (p, nn) => base(p, nn) * skin(p) : base;
    const r = shadeParam(fm.sample, fm.uN, fm.vN, L, wob, { ...light, modulate, proj: (p) => [p[0], p[1]] });
    /* cross-contour on the tubes, light, only where lit */
    if (fm.kind === 'phalanx' || fm.kind === 'palm' || fm.kind === 'heel') {
      const x = shadeParam((u, v) => fm.sample(v, u), fm.vN, Math.round(fm.uN * 0.5), L, wob * 1.1, {
        ...light, modulate, passes: (l) => (l > 0.5 ? [['brush', 0.1 + (l - 0.5) * 0.35, 'accent']] : []),
      });
      r.ops.push(...x.ops);
    }
    return { ...fm, ...r };
  });
  for (const fm of shaded) if (fm.kind === 'wrist') fm.z = -1e8; /* the wrist goes under the heel */
  shaded.sort((a, b) => a.z - b.z); /* far first */

  /* cast shadows on the table: every form's silhouette, thrown along the light */
  const shadows = shaded.map((fm) => {
    const pts = [];
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
      const q = castOnPlane(fm.sample(i / 10, j / 10).p, tableO, n, L);
      pts.push([q[0], q[1]]);
    }
    return hull(pts);
  });
  const inShadow = (p) => shadows.some((poly) => inside(p, poly));

  /* -------------------------------------------------- construction */
  ops.push(PHASE('Construction'));
  ops.push(OP('g', jitter([[P(-60, 0, 0)[0], P(-60, 0, 0)[1]], [P(150, 0, 0)[0], P(150, 0, 0)[1]]], wob * 1.4), 'under', 'brush'));
  ops.push(OP('g', jitter([P(92, -48, 26).slice(0, 2), P(92, 48, 26).slice(0, 2)], wob * 1.4), 'under', 'brush'));
  for (const fm of shaded) if (fm.kind === 'phalanx') ops.push(OP('g', jitter([P(...fm.J).slice(0, 2), P(...fm.J2).slice(0, 2)], wob), 'under', 'brush'));
  for (const fm of shaded) if (['palm', 'heel', 'mound'].includes(fm.kind)) ops.push(OP('g', jitter(hull(fm.pts2).concat([]), wob * 1.6), 'under', 'brush'));
  ops.push(PAUSE(320));

  /* -------------------------------------------------- table, first */
  ops.push(PHASE('Table'));
  const bands = 8, y0 = 150, y1 = H - 20;
  for (let b = 0; b < bands; b++) {
    const ya = y0 + ((y1 - y0) * b) / bands, yb = y0 + ((y1 - y0) * (b + 1)) / bands;
    const t = (b + 0.5) / bands;
    for (let c = 0; c < 3; c++) {
      const xa = 20 + ((W - 40) * c) / 3, xb = 20 + ((W - 40) * (c + 1)) / 3;
      const lum = (0.1 + 0.34 * t) * (1 - 0.45 * ((c + 0.5) / 3));
      ops.push(...hatchPoly([[xa, ya], [xb, ya], [xb, yb], [xa, yb]], 0.01 + (seed(b, c) - 0.5) * 0.04, 4.2 - t * 1.2, wob, [['wash', 0.25 + lum * 0.75, 'tone']], inShadow, b * 3 + c));
    }
  }
  /* the shadow is not black: bounce, and it is softest far from the contact */
  for (const poly of shadows) ops.push(...hatchPoly(poly, 0.03, 5, wob, [['wash', 0.11, 'tone']], null, 91));
  ops.push(PAUSE(260));

  /* -------------------------------------------------- the hand, far to near */
  let lastKind = null;
  for (const fm of shaded) {
    const label = fm.kind === 'palm' || fm.kind === 'heel' || fm.kind === 'mound' ? 'Palm' : fm.kind === 'wrist' ? 'Wrist' : fm.fi === 4 ? 'Thumb' : ['Index', 'Middle', 'Ring', 'Little'][fm.fi];
    if (label !== lastKind) { ops.push(PHASE(label)); lastKind = label; }
    ops.push(OCCLUDE(hull(fm.pts2), 0.96));
    ops.push(...fm.ops);
    /* edges: a broken liner along each tube's two sides, heavier on the dark side */
    if (fm.kind === 'phalanx') {
      for (const side of [0.25, 0.75]) {
        const pts = [];
        for (let i = 0; i <= 10; i++) pts.push(fm.sample(i / 10, side).p.slice(0, 2));
        const nrm = fm.sample(0.5, side).n;
        const lit = Math.max(0, dot3(nrm, L));
        ops.push(OP('s', jitter(pts, wob * 0.9), 'line', 'liner', 0.3 + (1 - lit) * 0.5));
      }
      /* crease at the base joint, on the back */
      if (fm.k > 0) {
        for (let c = 0; c < 2; c++) {
          const pts = [];
          for (let j = -4; j <= 4; j++) pts.push(fm.sample(0.04 + c * 0.05, (j / 4) * (0.12 + c * 0.04)).p.slice(0, 2));
          ops.push(OP('s', jitter(pts, wob * 0.7), 'accent', 'eraser', 0.28));
          ops.push(OP('s', jitter(pts, wob * 0.7), 'tone', 'eraser', 0.22));
        }
      }
      /* nail on the last phalanx: an outline and one lit stroke */
      if (fm.k === 2) {
        const pts = [];
        for (let i = 0; i <= 20; i++) {
          const t = (i / 20) * Math.PI * 2;
          pts.push(fm.sample(0.66 + 0.3 * Math.cos(t), 0.11 * Math.sin(t)).p.slice(0, 2));
        }
        ops.push(OP('s', jitter(pts, wob * 0.5), 'accent', 'eraser', 0.3));
        ops.push(OP('s', jitter(pts, wob * 0.5), 'line', 'liner', 0.7));
        const hl = [];
        for (let i = 0; i <= 6; i++) hl.push(fm.sample(0.48 + 0.4 * (i / 6), -0.04).p.slice(0, 2));
        ops.push(OP('s', jitter(hl, wob * 0.5), 'accent', 'chalk', 0.34));
      }
    }
    if (fm.kind === 'palm') {
      /* tendons fanning from the wrist to each knuckle, faint, on the top of the egg */
      const plates = opts.palm === 'plates';
      const [ca, cc, la, lb, lc] = plates ? [62, 14, 42, 47, 7.5] : [50, 16, 66, 44, 11];
      for (const fg of fingers) {
        const pts = [];
        for (let i = 0; i <= 12; i++) {
          const a = (plates ? 34 : 20) + (plates ? 54 : 66) * (i / 12), b = fg.b * (0.3 + 0.7 * (i / 12));
          const da = (a - ca) / la, db = (b - 1) / lb;
          const h = Math.sqrt(Math.max(0, 1 - da * da - db * db)) * lc;
          pts.push(P(a, b, cc + h - 0.5).slice(0, 2));
        }
        ops.push(OP('s', jitter(pts, wob * 0.8), 'accent', 'chalk', 0.16 + Math.max(0, -fg.b) * 0.004));
      }
      /* the arc of the knuckles, where the egg meets the fingers, is a real edge */
    }
  }
  ops.push(CLAMP('tone', BRUSHES.wash.ceiling));
  ops.push(PAUSE(300));

  /* -------------------------------------------------- margin */
  ops.push(PHASE('Margin'));
  ops.push(...textOps(opts.title || 'a hand, resting', 48, 44, 18, 'line', 'liner', 0.6, 0.45));
  ops.push(...textOps(opts.sub || 'tubes, spheres, an egg', 48, 70, 11, 'line', 'liner', 0.6, 0.32));
  ops.push(...textOps('02.09.26', 48, 92, 11, 'line', 'liner', 0.6, 0.3));
  ops.push(...textOps('one light, upper left', W - 250, H - 40, 11, 'line', 'liner', 0.6, 0.3));
  return ops;
}
