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
  /* every stroke thins to ~half width at its ends (the hand slows there), so
   * these widths are set for the ends to still touch their neighbours. */
  if (l > 0.02) out.push(['wash', (0.25 + l * 0.75) * k, 'tone']);
  if (l > 0.45) out.push(['brush', (0.2 + (l - 0.45) * 0.9) * k, 'accent']);
  if (l > 0.86) out.push(['chalk', (0.2 + (l - 0.86) * 2) * k, 'accent']);
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
    for (let t = -span; t <= span; t += 4) {  /* the engine resamples at 1.4 px; 4 px keeps the wobble and a third of the points */
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

/* ------------------------------------------------ parametric surfaces */

/** Convex hull (monotone chain) of 2D points — silhouettes of straight forms. */
export function hull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) { while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/** Brightness of a surface point under key light L (+ambient, +bounce). */
export function shade(n, L, opts = {}, p = null) {
  let dir = L, k = 1;
  if (opts.lamp && p) {
    /* a lamp at a place, not a direction: light falls off across the subject */
    const v = [opts.lamp[0] - p[0], opts.lamp[1] - p[1], opts.lamp[2] - p[2]];
    const d = Math.hypot(...v);
    dir = v.map((c) => c / d);
    const D = opts.lampFall || 700;
    k = 1 / (0.55 + 0.45 * (d / D) * (d / D));
  }
  let lum = Math.max(0, dot3(n, dir)) * k + (opts.ambient ?? 0.03);
  if (opts.bounce) lum += Math.max(0, dot3(n, norm(opts.bounce.dir))) * opts.bounce.amt;
  if (opts.modulate && p) lum *= opts.modulate(p, n);
  if (opts.gamma) lum = Math.pow(Math.min(1, lum), opts.gamma);
  return lum;
}

/**
 * Shade any parametric surface with strokes along u at fixed v.
 *   sample(u, v) → { p: [x, y, z], n: [nx, ny, nz] }   z toward the viewer
 * Each stroke is split into front-facing runs, and each run into segments of
 * roughly one brightness, so the passes can change along a stroke. Returns
 * { ops, pts2 } — pts2 is every projected sample, for the silhouette.
 */
export function shadeParam(sample, uN, vN, L, wob, opts = {}) {
  const ops = [];
  const pts2 = [];
  let zSum = 0, zN = 0;
  const bucket = opts.bucket || 0.09;
  const proj = opts.proj || ((p) => [p[0], p[1]]);
  for (let j = 0; j <= vN; j++) {
    const v = j / vN;
    let run = []; /* [ [x,y], lum ] */
    const flush = () => {
      if (run.length > 2) {
        /* split by brightness bucket, with one point of overlap */
        let seg = [run[0]];
        let b0 = Math.floor(run[0][1] / bucket);
        for (let k = 1; k < run.length; k++) {
          const b = Math.floor(run[k][1] / bucket);
          seg.push(run[k]);
          if (b !== b0 || k === run.length - 1) {
            if (seg.length > 1) {
              const lum = seg.reduce((s, q) => s + q[1], 0) / seg.length;
              const pts = seg.map((q) => q[0]);
              const passes = opts.passes ? opts.passes(lum) : passesFor(lum, opts);
              const noise = 0.8 + seed(j, k) * 0.4; /* no two strokes weigh the same */
              for (const [brush, w, layer] of passes) ops.push(OP('s', jitter(pts, wob), layer, brush, w * noise));
            }
            seg = [run[k]];
            b0 = b;
          }
        }
      }
      run = [];
    };
    for (let i = 0; i <= uN; i++) {
      const u = i / uN;
      const { p, n } = sample(u, v);
      const q = proj(p);
      if (n[2] > (opts.facing ?? 0.04)) { pts2.push(q); run.push([q, shade(n, L, opts, p)]); zSum += p[2]; zN++; } else flush();
    }
    flush();
  }
  return { ops, pts2, z: zN ? zSum / zN : -1e9 };
}

/** A straight tube from A to B, radius r0→r1, elliptical if ry given. */
export function tube(A, B, r0, r1 = r0, ry = null, hint = null) {
  const axis = norm([B[0] - A[0], B[1] - A[1], B[2] - A[2]]);
  let [e1, e2] = basis(axis);
  if (hint) {
    const d = dot3(hint, axis);
    e1 = norm([hint[0] - axis[0] * d, hint[1] - axis[1] * d, hint[2] - axis[2] * d]);
    e2 = cross(axis, e1);
  }
  const L = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
  return (u, v) => {
    const th = v * Math.PI * 2;
    const r = r0 + (r1 - r0) * u;
    const rr = ry ? ry * (r / r0) : r;
    const c = Math.cos(th), s = Math.sin(th);
    const p = [0, 1, 2].map((k) => A[k] + axis[k] * u * L + e1[k] * c * r + e2[k] * s * rr);
    /* normal of an ellipse cross-section */
    const n = norm([0, 1, 2].map((k) => e1[k] * c / r + e2[k] * s / rr));
    return { p, n };
  };
}

/** An ellipsoid: centre C, orthonormal axes with semi-lengths. */
export function ellipsoid(C, ax, ay, az, la, lb, lc) {
  return (u, v) => {
    const th = u * Math.PI * 2, ph = v * Math.PI;
    const q = [Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph)];
    const p = [0, 1, 2].map((k) => C[k] + ax[k] * q[0] * la + ay[k] * q[1] * lb + az[k] * q[2] * lc);
    const n = norm([0, 1, 2].map((k) => ax[k] * q[0] / la + ay[k] * q[1] / lb + az[k] * q[2] / lc));
    return { p, n };
  };
}

/** Rings on a sphere around an axis (for joints: cheap, few ops). */
export function sphere(C, r, axis = [0, 0, 1]) {
  const az = norm(axis);
  const [ax, ay] = basis(az);
  return ellipsoid(C, ax, ay, az, r, r, r);
}

/** Where a point's shadow lands on the plane through O with normal n, lit from L. */
export function castOnPlane(p, O, n, L) {
  const d = dot3(n, [p[0] - O[0], p[1] - O[1], p[2] - O[2]]);
  const t = -d / dot3(n, L);
  return [p[0] + L[0] * t, p[1] + L[1] * t, p[2] + L[2] * t];
}
