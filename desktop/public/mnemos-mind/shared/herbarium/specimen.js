/* From the Alive studies' herbarium (mnemos-engine-page, alive/herbarium/specimen.js at fd5a7b6), unchanged: the companion
 * draws a memory up close the way the herbarium engraves it (../specimens.js reads the memory into its shape). */

/* The specimen: one memory, drawn as a natural-history plate draws a one-celled animal.
 *
 * Every variable part is a measure; nothing is added for looks that a reader could mistake for one:
 *   the test        radius is strength. A lesson's is round (radial symmetry); an experience's is a drop that has a front.
 *   the spines      one per real link, evenly spaced, so its symmetry is its link count. Length is the link's weight.
 *                   Four kinds: plain (came back together), barred (supports), barbed (contradicts),
 *                   and the stalk (distilled into), which carries the experience the lesson was kept from.
 *   the nucleolus   as large as the memory is settled (stability).
 *   the granules    as many as it is strongly stored (strength).
 *   the rings       one for each doubling of the times it has come to mind.
 *   the corona      fine threads, as long as it is easy to reach (accessibility).
 *   a hollow test   a memory that has gone quiet: the shell, no body.
 * Not data, said on the plate: where a granule sits, the tremor of a line, the hatching that gives the test its volume.
 */

const TAU = Math.PI * 2;
const GOLD = Math.PI * (3 - Math.sqrt(5));
export const TIP = 0.66;                       // how far an experience's front reaches past its body (a drop, not a circle)

export const hash = (str) => { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const ease = (x) => { x = Math.max(0, Math.min(1, x)); return 1 - Math.pow(1 - x, 3); };
export const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

const PRI = { distilled_into: 0, contradicts: 1, supports: 2, co_activated: 3 };
const cache = new Map();

export function makeSpec(model, i) {
  let s = cache.get(i);
  if (s && s.model === model) return s;
  const c = model.cells[i];
  s = specFromCell(c, c.inc.map((l) => ({ li: l.li, rel: l.rel, w: l.w, bornT: l.bornT, other: l.s === i ? l.t : l.s, out: l.s === i })));
  s.model = model; s.i = i;
  cache.set(i, s);
  return s;
}

/* a specimen from a cell's own fields alone (the key draws its icons this way, from cells that are not in the mind) */
export function specFromCell(c, spines) {
  const seed = hash(String(c.id));
  const s = {
    model: null, i: -1, c, seed,
    round: c.lesson === true,
    strength: c.strength, stab: c.stability, reach: c.accessibility,
    rings: c.accessCount > 0 ? Math.min(9, Math.ceil(Math.log2(1 + c.accessCount))) : 0,
    dormant: c.state === 'dormant',
    spines,
  };
  // granules: their number is the memory's strength; where they sit is the engraver's, who lets them gather on the shaded side
  const r = rng(seed ^ 0x9e3779b9);
  const N = Math.round(280 * s.strength);
  s.dots = new Float32Array(N * 3);
  {
    const C = N * 4, lx = -0.62, ly = -0.78;
    let placed = 0;
    for (let k = 0; k < C && placed < N; k++) {
      const a = k * GOLD + (r() - 0.5) * 0.5, f = Math.sqrt((k + 0.5) / C), rr = 0.40 + 0.46 * f + (r() - 0.5) * 0.02;
      const facing = Math.cos(a) * lx + Math.sin(a) * ly;                 // -1 on the shaded limb, +1 toward the light
      const shade = 0.5 - 0.5 * facing * clamp01((rr - 0.3) / 0.56);
      if (r() > 0.2 + 0.8 * shade) continue;
      const w = s.round ? 1 : wallR(s, a);
      s.dots[placed * 3] = Math.cos(a) * rr * w; s.dots[placed * 3 + 1] = Math.sin(a) * rr * w; s.dots[placed * 3 + 2] = 0.7 + 0.6 * r();
      placed++;
    }
    for (let k = placed; k < N; k++) { const a = k * GOLD, rr = 0.5 + 0.3 * r(); s.dots[k * 3] = Math.cos(a) * rr; s.dots[k * 3 + 1] = Math.sin(a) * rr; s.dots[k * 3 + 2] = 1; }
  }
  const M = 46;
  s.core = new Float32Array(M * 3);
  for (let k = 0; k < M; k++) {
    const a = k * GOLD, rr = 0.30 * Math.sqrt((k + 0.5) / M);
    s.core[k * 3] = Math.cos(a) * rr; s.core[k * 3 + 1] = Math.sin(a) * rr; s.core[k * 3 + 2] = 0.7 + 0.6 * r();
  }
  // corona: a little hand in each thread's length and lean, fixed per memory
  s.thread = Array.from({ length: 72 }, () => ({ len: 0.84 + 0.32 * r(), bend: (r() - 0.5) * 0.22, ph: r() * TAU, sp: 0.35 + 0.5 * r() }));
  // the wall as a path in unit space
  const wall = new Path2D();
  if (s.round) wall.arc(0, 0, 1, 0, TAU);
  else { for (let k = 0; k <= 120; k++) { const a = (k / 120) * TAU, rr = wallR(s, a); k ? wall.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : wall.moveTo(rr, 0); } wall.closePath(); }
  s.wall = wall;
  return s;
}

/* the wall's radius at an angle, in units of the test's radius (axis = angle 0; the front of a drop) */
export function wallR(spec, ang) { return spec.round ? 1 : 1 + TIP * Math.pow(Math.max(0, Math.cos(ang)), 4); }

/* spines around a memory, evenly, in the plate's order: stalks nearest the axis, then barbed, barred, plain.
 * bearings: { linkIndex: angle } puts a stalk exactly toward the memory it joins. */
export function slotSpines(spec, bearings = {}) {
  const sp = spec.spines.slice().sort((a, b) => PRI[a.rel] - PRI[b.rel] || b.w - a.w || a.li - b.li);
  const n = sp.length;
  if (!n) return [];
  const d = TAU / n;
  const slots = Array.from({ length: n }, (_, j) => (j - (n - 1) / 2) * d);
  slots.sort((p, q) => Math.abs(p) - Math.abs(q) || q - p);
  return sp.map((s, k) => ({ ...s, ang: s.rel === 'distilled_into' && bearings[s.li] != null ? bearings[s.li] : slots[k] }));
}

/* where a spine leaves the test, and how far it reaches, in pixels (the composer's stalks start here too) */
export const spineLen = (s, R) => (0.32 + 0.95 * s.w) * R;
export function anchor(spec, slot, o) {
  const a = o.rot + slot.ang, r = wallR(spec, slot.ang) * o.R;
  return { x: o.x + Math.cos(a) * r, y: o.y + Math.sin(a) * r, a };
}

const detailOf = (R) => (R >= 64 ? 3 : R >= 26 ? 2 : R >= 12 ? 1 : 0);

/* ---------- the corona: fine threads, behind everything ---------- */
export function drawCorona(ctx, spec, o) {
  if (spec.dormant) return;
  const { x, y, R, rot, ink, alpha = 1, t = 0, grow = 1, lean = null } = o;
  const g = ease(grow);
  if (g <= 0) return;
  const M = Math.max(10, Math.min(56, Math.round(R * 0.95)));
  const L0 = spec.reach * 1.45 * R * g;
  ctx.beginPath();
  for (let k = 0; k < M; k++) {
    const th = spec.thread[k % 72];
    const a = rot + (k + 0.5) * TAU / M;
    const wr = wallR(spec, a - rot) * R;
    const L = L0 * th.len;
    const sway = Math.sin(t * th.sp * 0.8 + th.ph) * 0.2 + Math.sin(t * 0.17 + th.ph * 2.3) * 0.08;      // slow, out of step: weather
    const x0 = x + Math.cos(a) * wr * 0.99, y0 = y + Math.sin(a) * wr * 0.99;
    let ex = Math.cos(a) * L, ey = Math.sin(a) * L;
    // a thread leans toward what is near it (the pointer), a little
    if (lean) { const dx = lean.x - x0, dy = lean.y - y0, d = Math.hypot(dx, dy) || 1, k2 = lean.k * Math.max(0, 1 - d / (R * 6)); ex += (dx / d) * L * k2 * 0.9; ey += (dy / d) * L * k2 * 0.9; }
    const bend = (th.bend + sway) * L;
    const mx = x0 + ex * 0.5 - Math.sin(a) * bend, my = y0 + ey * 0.5 + Math.cos(a) * bend;
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx, my, x0 + ex, y0 + ey);
  }
  ctx.lineWidth = Math.max(0.4, Math.min(0.65, R * 0.0032));
  ctx.strokeStyle = rgba(ink, 0.27 * alpha);
  ctx.stroke();
}

/* ---------- the spines: one for each link that is not a stalk ---------- */
export function drawSpines(ctx, spec, slots, o) {
  const { x, y, R, rot, ink, alpha = 1, spineK = null, signalLi = null, signal = null } = o;
  const col = rgba(ink, 0.92 * alpha);
  ctx.fillStyle = col; ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(0.55, R * 0.0085);
  const baseHalf = Math.max(0.32, Math.min(1.5, R * 0.0072));
  const tiny = R < 11;
  for (const s of slots) {
    if (s.rel === 'distilled_into') continue;
    const k = spineK ? spineK(s) : 1;
    if (k <= 0) continue;
    const a = rot + s.ang, ca = Math.cos(a), sa = Math.sin(a);
    const r0 = wallR(spec, s.ang) * R * 0.97;
    const L = spineLen(s, R) * ease(k);
    const bx = x + ca * r0, by = y + sa * r0, tx = bx + ca * L, ty = by + sa * L;
    const hot = signalLi === s.li;
    if (hot) { ctx.fillStyle = signal; ctx.strokeStyle = signal; }
    if (tiny) { ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke(); }
    else {
      ctx.beginPath(); ctx.moveTo(bx - sa * baseHalf, by + ca * baseHalf); ctx.lineTo(tx, ty); ctx.lineTo(bx + sa * baseHalf, by - ca * baseHalf); ctx.closePath(); ctx.fill();
    }
    if (s.rel === 'supports' && L > 4) {                         // barred: a cross-piece near the tip
      const px = bx + ca * L * 0.74, py = by + sa * L * 0.74, h = Math.max(1.6, R * 0.17);
      ctx.beginPath(); ctx.moveTo(px - sa * h, py + ca * h); ctx.lineTo(px + sa * h, py - ca * h); ctx.stroke();
    } else if (s.rel === 'contradicts' && L > 4) {              // barbed: thorns along the shaft, leaning outward, a pair at each place
      const h = L * 0.21;
      ctx.beginPath();
      for (const f of [0.40, 0.58, 0.76]) {
        const px = bx + ca * L * f, py = by + sa * L * f;
        for (const sg of [-1, 1]) { const b = a + sg * 0.78; ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(b) * h, py + Math.sin(b) * h); }
      }
      ctx.stroke();
    }
    if (hot) { ctx.fillStyle = col; ctx.strokeStyle = col; }
  }
}

/* ---------- the body: test, rings, granules, capsule, nucleolus ---------- */
export function drawBody(ctx, spec, o) {
  const { x, y, R, rot, ink, paper, alpha = 1, grow = 1, signal = null, live = false, glow = false } = o;
  const g = ease(grow);
  if (g <= 0 || R * g < 0.8) return;
  const Rg = R * g, D = detailOf(Rg);
  const px = (v) => v / Rg;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot); ctx.scale(Rg, Rg);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = paper;
  ctx.fill(spec.wall);
  const wallW = Math.max(0.7, Math.min(1.5, Rg * 0.013));
  if (spec.dormant) {
    ctx.setLineDash([px(2.6), px(2.6)]);
    ctx.lineWidth = px(wallW); ctx.strokeStyle = rgba(ink, 0.7);
    ctx.stroke(spec.wall);
    ctx.setLineDash([]);
    if (D >= 2) { ctx.save(); ctx.scale(0.955, 0.955); ctx.lineWidth = px(wallW * 0.6); ctx.strokeStyle = rgba(ink, 0.3); ctx.stroke(spec.wall); ctx.restore(); }
    ctx.restore();
    return;
  }
  // the wall, doubled when there is room to engrave it
  ctx.lineWidth = px(wallW); ctx.strokeStyle = rgba(ink, 0.96);
  ctx.stroke(spec.wall);
  if (D >= 2) { ctx.save(); ctx.scale(0.955, 0.955); ctx.lineWidth = px(wallW * 0.55); ctx.strokeStyle = rgba(ink, 0.55); ctx.stroke(spec.wall); ctx.restore(); }
  // pores along the wall, and the hatching that rounds it (a style, not a measure)
  if (D >= 3) {
    ctx.beginPath();
    const P = 64;
    for (let k = 0; k < P; k++) {
      const a = (k + 0.5) * TAU / P, r = wallR(spec, a) * 0.925, cx = Math.cos(a) * r, cy = Math.sin(a) * r;
      ctx.moveTo(cx + 0.012, cy); ctx.arc(cx, cy, 0.012, 0, TAU);
    }
    ctx.lineWidth = px(0.5); ctx.strokeStyle = rgba(ink, 0.6); ctx.stroke();
    if (spec.round) {                                  // the shaded side, lit from the top left whatever the specimen's turn
      ctx.save(); ctx.rotate(-rot); ctx.beginPath();
      for (let k = 0; k < 9; k++) { const r = 0.935 - k * 0.019, a0 = 0.12 + k * 0.055, a1 = 1.62 - k * 0.13; ctx.moveTo(Math.cos(a0) * r, Math.sin(a0) * r); ctx.arc(0, 0, r, a0, a1); }
      ctx.lineWidth = px(0.45); ctx.strokeStyle = rgba(ink, 0.3); ctx.stroke(); ctx.restore();
    }
  }
  // rings: one for each doubling of the times it has come to mind
  if (spec.rings) {
    ctx.beginPath();
    const K = spec.rings;
    for (let k = 0; k < K; k++) {
      const r = 0.84 - (K === 1 ? 0.0 : (k / (K - 1)) * 0.36) * 1.0;
      if (spec.round) { ctx.moveTo(r, 0); ctx.arc(0, 0, r, 0, TAU); }
      else for (let q = 0; q <= 90; q++) { const a = (q / 90) * TAU, rr = r * wallR(spec, a); q ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    }
    ctx.lineWidth = px(Math.max(0.6, Rg * 0.006)); ctx.strokeStyle = rgba(ink, 0.62); ctx.stroke();
    if (K >= 3 && D >= 2) {                               // rayed beams between capsule and wall, once it has come to mind often
      ctx.beginPath();
      for (let k = 0; k < 12; k++) { const a = k * TAU / 12; ctx.moveTo(Math.cos(a) * 0.36, Math.sin(a) * 0.36); const r = 0.86 * wallR(spec, a); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.lineWidth = px(0.5); ctx.strokeStyle = rgba(ink, 0.26); ctx.stroke();
    }
  }
  // granules: as many as it is strongly stored
  {
    const N = spec.dots.length / 3;
    const nDraw = D >= 2 ? N : D === 1 ? Math.min(N, Math.round(N * 0.45)) : Math.min(N, 14);
    const step = N / nDraw;
    const base = Math.max(0.5, Rg * 0.0105);
    if (spec.round) { ctx.save(); ctx.rotate(-rot); }              // the light is the page's, whichever way the specimen turns
    ctx.beginPath();
    for (let q = 0; q < nDraw; q++) {
      const k = Math.floor(q * step) * 3, rr = px(base * spec.dots[k + 2]);
      ctx.moveTo(spec.dots[k] + rr, spec.dots[k + 1]); ctx.arc(spec.dots[k], spec.dots[k + 1], rr, 0, TAU);
    }
    ctx.fillStyle = rgba(ink, 0.78); ctx.fill();
    if (spec.round) ctx.restore();
  }
  // the capsule: a denser core, and in it the nucleolus, as large as the memory is settled
  if (D >= 1) {
    ctx.beginPath(); ctx.arc(0, 0, 0.345, 0, TAU); ctx.fillStyle = paper; ctx.fill();
    ctx.lineWidth = px(Math.max(0.6, wallW * 0.8)); ctx.strokeStyle = rgba(ink, 0.9); ctx.stroke();
    if (D >= 2) { ctx.beginPath(); ctx.arc(0, 0, 0.30, 0, TAU); ctx.lineWidth = px(0.5); ctx.strokeStyle = rgba(ink, 0.45); ctx.stroke(); }
    const n = D >= 2 ? spec.core.length / 3 : 16, base = Math.max(0.5, Rg * 0.0095);
    ctx.beginPath();
    for (let k = 0; k < n; k++) { const q = k * 3, rr = px(base * spec.core[q + 2]); ctx.moveTo(spec.core[q] + rr, spec.core[q + 1]); ctx.arc(spec.core[q], spec.core[q + 1], rr, 0, TAU); }
    ctx.fillStyle = rgba(ink, 0.7); ctx.fill();
  }
  const rn = 0.028 + 0.062 * spec.stab;
  if (D >= 2) { ctx.beginPath(); ctx.arc(0.02, -0.015, rn * 2.3, 0, TAU); ctx.fillStyle = paper; ctx.fill(); ctx.lineWidth = px(0.55); ctx.strokeStyle = rgba(ink, 0.5); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(0.02, -0.015, Math.max(rn, px(0.9)), 0, TAU);
  ctx.fillStyle = live && signal ? signal : rgba(ink, 1);
  if (glow) { ctx.shadowColor = rgba(ink, 0.9); ctx.shadowBlur = 10 / Rg; }
  ctx.fill();
  ctx.restore();
}

export function drawSpecimen(ctx, spec, slots, o) {
  drawCorona(ctx, spec, o);
  drawSpines(ctx, spec, slots, o);
  drawBody(ctx, spec, o);
}

/* the stalk: the line a lesson was kept along, from an experience's front to the lesson's wall.
 * Large, it is drawn as a tube that widens toward the lesson (two hairlines over a paper fill); small, a single line. */
export function drawStalk(ctx, from, to, o) {
  const { ink, paper = null, alpha = 1, draw = 1, width = 1, signal = null, hot = false, bow = 0.12, ctrl = null, tube = false } = o;
  const d = ease(draw);
  if (d <= 0) return;
  const dx = to.x - from.x, dy = to.y - from.y, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  const cl = ctrl != null ? ctrl : L * 0.38;
  const c1 = { x: from.x + Math.cos(from.a) * cl + nx * L * bow * 0.4, y: from.y + Math.sin(from.a) * cl + ny * L * bow * 0.4 };
  const c2 = { x: to.x + Math.cos(to.a) * cl - nx * L * bow * 0.2, y: to.y + Math.sin(to.a) * cl - ny * L * bow * 0.2 };
  const steps = Math.max(10, Math.round(L / 5));
  const pt = (tt) => {
    const u = 1 - tt;
    return {
      x: u * u * u * from.x + 3 * u * u * tt * c1.x + 3 * u * tt * tt * c2.x + tt * tt * tt * to.x,
      y: u * u * u * from.y + 3 * u * u * tt * c1.y + 3 * u * tt * tt * c2.y + tt * tt * tt * to.y,
      tx: 3 * u * u * (c1.x - from.x) + 6 * u * tt * (c2.x - c1.x) + 3 * tt * tt * (to.x - c2.x),
      ty: 3 * u * u * (c1.y - from.y) + 6 * u * tt * (c2.y - c1.y) + 3 * tt * tt * (to.y - c2.y),
    };
  };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const col = hot && signal ? signal : rgba(ink, 0.92 * alpha);
  if (!tube) {
    ctx.beginPath();
    for (let k = 0; k <= steps * d; k++) { const p = pt(Math.min(d, k / steps)); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
    ctx.lineWidth = width; ctx.strokeStyle = col; ctx.stroke();
  } else {
    const A = [], B = [];
    for (let k = 0; k <= steps * d; k++) {
      const tt = Math.min(d, k / steps), p = pt(tt), m = Math.hypot(p.tx, p.ty) || 1;
      const off = (0.8 + 1.0 * tt) * Math.max(1, width * 0.9);                // the neck is thin; the head end is full
      A.push([p.x - (p.ty / m) * off, p.y + (p.tx / m) * off]); B.push([p.x + (p.ty / m) * off, p.y - (p.tx / m) * off]);
    }
    if (paper) {
      ctx.beginPath(); A.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); for (let i = B.length - 1; i >= 0; i--) ctx.lineTo(B[i][0], B[i][1]); ctx.closePath(); ctx.fillStyle = paper; ctx.fill();
    }
    ctx.lineWidth = Math.max(0.7, width * 0.62); ctx.strokeStyle = col;
    ctx.beginPath(); A.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke();
    ctx.beginPath(); B.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke();
  }
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  return { c1, c2 };
}
