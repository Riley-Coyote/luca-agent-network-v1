/* pages/lib.js — my own drawing helpers, built on the engine's vocabulary.
 * Drawing knowledge only (shading, form-following hatching), no subjects. */

import { OP, DOT, jitter, seed } from '../mark-engine.js';

export const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Orthonormal basis (u, v) perpendicular to axis a. */
export function basis(a) {
  const t = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(a, t));
  const v = norm(cross(a, u));
  return [u, v];
}

/**
 * Tone map: brightness (0..1) → the marks that build it on a light-on-black
 * page. Wash lays the floor (it has a ceiling), brush the middle, chalk the
 * top. Returns a list of [brush, weight, layer] passes for one stroke.
 */
export function passesFor(lum, opts = {}) {
  const k = opts.gain || 1;
  const l = Math.min(1, lum);
  const out = [];
  /* wash: width IS the gradient. thin strokes barely overlap (near-black),
   * wide ones stack to the ceiling. the tone layer is clamped, so it can
   * never carry anything brighter than the ceiling. */
  if (l > 0.02) out.push(['wash', (0.12 + l * 0.5) * k, 'tone']);
  /* brush on ACCENT — above the clamp. this is the halftone-to-light ramp. */
  if (l > 0.45) out.push(['brush', (0.1 + (l - 0.45) * 0.75) * k, 'accent']);
  /* chalk last, sparse: it is grainy by nature (dry media breaks on speed) */
  if (l > 0.85) out.push(['chalk', (0.2 + (l - 0.85) * 2) * k, 'accent']);
  return out;
}

/**
 * Shade a sphere with rings around the light axis. Every ring is one
 * brightness, so the rings ARE the tonal scale. Returns ops.
 *   L      light direction (toward the light), 3D, z toward viewer
 *   bounce secondary light, e.g. off the ground, {dir, amt}
 */
export function sphereRings(cx, cy, r, L, wob, opts = {}) {
  const ops = [];
  const A = norm(L);
  const [U, V] = basis(A);
  const step = opts.step || 3.2;
  const nRings = Math.round((Math.PI * r) / step);
  const bounce = opts.bounce || null;
  const amb = opts.ambient ?? 0.03;
  for (let i = 1; i < nRings; i++) {
    const phi = Math.PI * (i / nRings) + (seed(i, 7) - 0.5) * (Math.PI / nRings) * 0.5;
    const cphi = Math.cos(phi), sphi = Math.sin(phi);
    const key = Math.max(0, cphi);
    /* walk the ring, keep the front-facing run */
    const n = Math.max(12, Math.round(sphi * r * 0.9));
    const pts3 = [];
    for (let j = 0; j <= n; j++) {
      const th = (j / n) * Math.PI * 2;
      const p = [0, 1, 2].map((c) => cphi * A[c] + sphi * (Math.cos(th) * U[c] + Math.sin(th) * V[c]));
      pts3.push(p);
    }
    /* rotate so we start at the most back-facing point, then take z>0 */
    let minI = 0;
    pts3.forEach((p, j) => { if (p[2] < pts3[minI][2]) minI = j; });
    const rot = pts3.slice(minI).concat(pts3.slice(0, minI));
    let vis = rot.filter((p) => p[2] > 0.02);
    if (vis.length < 3) continue;
    /* a fully visible ring is a closed loop: close it, and start each one at a
     * different point, or every loop's seam lines up into a bare ray. */
    if (vis.length === rot.length) {
      const k = Math.floor(seed(i, 31) * vis.length);
      vis = vis.slice(k).concat(vis.slice(0, k));
      vis.push(vis[0]);
    }
    const pts = vis.map((p) => [cx + p[0] * r, cy + p[1] * r]);
    /* brightness: key light on this ring, plus bounce which varies along it */
    const passes = passesFor(key + amb, opts);
    for (const [brush, w, layer] of passes) {
      ops.push(OP('s', jitter(pts, wob), layer, brush, w));
    }
    if (bounce) {
      /* bounce is not constant on the ring: split the ring into runs by it */
      const B = norm(bounce.dir);
      let run = [];
      const flush = () => {
        if (run.length > 3) {
          const lum = run.reduce((s, p) => s + Math.max(0, dot3(p, B)), 0) / run.length * bounce.amt;
          if (lum > 0.02) ops.push(OP('s', jitter(run.map((p) => [cx + p[0] * r, cy + p[1] * r]), wob), 'tone', 'wash', 0.12 + lum * 1.6));
        }
        run = [];
      };
      for (const p of vis) { if (dot3(p, B) > 0.15 && key < 0.25) run.push(p); else flush(); }
      flush();
    }
  }
  return ops;
}

/** Meridians through the light pole, only where it is lit — cross-hatch for the light side. */
export function sphereMeridians(cx, cy, r, L, wob, count = 14, minLum = 0.45) {
  const ops = [];
  const A = norm(L);
  const [U, V] = basis(A);
  for (let k = 0; k < count; k++) {
    const th = (k / count) * Math.PI * 2 + (seed(k, 3) - 0.5) * 0.3;
    const pts = [];
    for (let j = 0; j <= 30; j++) {
      const phi = (j / 30) * Math.PI * 0.5;
      const p = [0, 1, 2].map((c) => Math.cos(phi) * A[c] + Math.sin(phi) * (Math.cos(th) * U[c] + Math.sin(th) * V[c]));
      if (p[2] <= 0.02 || Math.cos(phi) < minLum) break;
      pts.push([cx + p[0] * r, cy + p[1] * r]);
    }
    if (pts.length > 4) ops.push(OP('s', jitter(pts, wob * 0.8), 'accent', 'brush', 0.14));
  }
  return ops;
}

/** Point-in-polygon. */
export function inside(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/**
 * Hatch a polygon: parallel lines at `ang`, `gap` apart, clipped to it.
 * `skip(pt)` can veto points (cast shadows). Returns ops with the given passes.
 */
export function hatchPoly(poly, ang, gap, wob, passes, skip = null, salt = 0) {
  const ops = [];
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const px = -dy, py = dx;
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const n = Math.ceil(span / gap);
  for (let i = -n; i <= n; i++) {
    const g = gap * (0.85 + seed(i, salt + 1) * 0.3);
    const ox = cx + px * i * g, oy = cy + py * i * g;
    let run = [];
    const flush = () => {
      if (run.length > 2) for (const [brush, w, layer] of passes) ops.push(OP('s', jitter(run, wob), layer, brush, w));
      run = [];
    };
    for (let t = -span; t <= span; t += 2.5) {
      const p = [ox + dx * t, oy + dy * t];
      if (inside(p, poly) && !(skip && skip(p))) run.push(p); else flush();
    }
    flush();
  }
  return ops;
}

/** Ellipse-as-polygon, rotated. */
export function ellipsePoly(cx, cy, rx, ry, rot = 0, n = 40) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * rx, y = Math.sin(t) * ry;
    out.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return out;
}

export function inEllipse(p, cx, cy, rx, ry, rot = 0) {
  const x = p[0] - cx, y = p[1] - cy;
  const xr = x * Math.cos(-rot) - y * Math.sin(-rot), yr = x * Math.sin(-rot) + y * Math.cos(-rot);
  return (xr * xr) / (rx * rx) + (yr * yr) / (ry * ry) < 1;
}

/** Specular: a cluster of chalk dots at a point, falling off. */
export function highlight(x, y, r, count = 9) {
  const ops = [];
  for (let k = 0; k < count; k++) {
    const a = seed(k, 21) * Math.PI * 2, d = Math.sqrt(seed(k, 22)) * r;
    ops.push(DOT(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.2 + (1 - d / r) * 2.2, 'accent', 'chalk'));
  }
  return ops;
}
