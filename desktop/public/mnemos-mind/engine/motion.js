/* Time and space for the shots: curves through keyframes, rotations, and the
 * camera grammar the film shares. Every shot's lens holds its subject at one
 * point of the frame, drifts in, then dives to something small enough to
 * read. The shots rhyme because they move the same way. */

import { add, sub, scale, dot, cross, length, normalize, mixv, clamp, ramp } from './gl.js';

export const TAU = Math.PI * 2;

/* a monotone cubic through [t, v] keys: smooth, and never overshoots */
export function curve(list) {
  const n = list.length, xs = list.map((k) => k[0]), ys = list.map((k) => k[1]);
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
/* the same, in log space: for distances, so a dolly reads as even speed */
export const logCurve = (list) => { const c = curve(list.map(([t, v]) => [t, Math.log(v)])); return (t) => Math.exp(c(t)); };

/* rotation about a unit axis, as a 3×3 row-major matrix; rotT applies its inverse */
export function rotation(a, th) {
  const c = Math.cos(th), s = Math.sin(th), k = 1 - c, [x, y, z] = a;
  return [c + x * x * k, x * y * k - z * s, x * z * k + y * s,
    y * x * k + z * s, c + y * y * k, y * z * k - x * s,
    z * x * k - y * s, z * y * k + x * s, c + z * z * k];
}
export const rot = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
export const rotT = (M, v) => [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]];

/* two unit vectors perpendicular to axis */
export function basis(axis) {
  const helper = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = normalize(cross(helper, axis));
  return [e1, cross(axis, e1)];
}

/* organic: each thing breathes on its own period, so nothing visibly loops */
export const twinkle = (t, period, phase) => 0.8 + 0.2 * Math.sin((TAU * t) / period + phase);

/* the direction from what the camera looks at back to the lens */
export const backVec = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];

/* The film's camera. It stands distance(t) back along yaw(t)/pitch(t), turned roll(t) about its own axis,
 * holding `subject` at `place` in the frame (x, y in -1..1, up and right positive), until the dive hands
 * it to target(t) across `dive`. Pass `up` to lookAt so the roll reaches the picture. */
export function framing({ fov, aspect, distance, yaw, pitch, roll = () => 0, subject, place, target, dive }) {
  return (t) => {
    const back = backVec(yaw(t), pitch(t));
    const level = normalize(cross([0, 1, 0], back)), upright = cross(back, level), r = roll(t);
    const right = add(scale(level, Math.cos(r)), scale(upright, Math.sin(r)));
    const up = sub(scale(upright, Math.cos(r)), scale(level, Math.sin(r)));
    const d = distance(t), halfH = d * Math.tan(fov / 2), halfW = halfH * aspect;
    const held = sub(subject, add(scale(right, place[0] * halfW), scale(up, place[1] * halfH)));
    const at = mixv(held, target(t), ramp(t, dive[0], dive[1]));
    return { eye: add(at, scale(back, d)), at, fwd: scale(back, -1), right, up };
  };
}

/* a point at depth d, at (x, y) in -1..1 of the frame, seen from camera c */
export function inView(c, d, x, y, fov, aspect) {
  const hh = d * Math.tan(fov / 2), hw = hh * aspect;
  return add(c.eye, add(scale(c.fwd, d), add(scale(c.right, x * hw), scale(c.up, y * hh))));
}

/* A smooth curve through points (Catmull-Rom), measured by arc length, with a frame that travels along it
 * without twisting (parallel transport). at(s), along(s) and frame(s) take s in [0, length]; frame gives
 * the direction of travel t and two perpendiculars n and b, for wrapping things round the curve. */
export function path(points, perSpan = 40) {
  const p = [points[0], ...points, points[points.length - 1]];
  const dense = [];
  const cr = (a, b, c, d, t) => {
    const t2 = t * t, t3 = t2 * t;
    return [0, 1, 2].map((i) => 0.5 * (2 * b[i] + (c[i] - a[i]) * t + (2 * a[i] - 5 * b[i] + 4 * c[i] - d[i]) * t2 + (3 * b[i] - a[i] - 3 * c[i] + d[i]) * t3));
  };
  for (let i = 1; i < p.length - 2; i++) for (let k = 0; k < perSpan; k++) dense.push(cr(p[i - 1], p[i], p[i + 1], p[i + 2], k / perSpan));
  dense.push(points[points.length - 1]);
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + length(sub(dense[i], dense[i - 1])));
  const total = cum[cum.length - 1];
  // the frame, carried along without twisting
  const T = dense.map((_, i) => normalize(sub(dense[Math.min(i + 1, dense.length - 1)], dense[Math.max(i - 1, 0)])));
  const Nn = [];
  let n = normalize(cross(Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], T[0]));
  for (let i = 0; i < dense.length; i++) {
    n = normalize(sub(n, scale(T[i], dot(n, T[i]))));
    Nn.push(n);
  }
  const locate = (s) => {
    s = clamp(s, 0, total);
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    return [lo, hi, (s - cum[lo]) / (cum[hi] - cum[lo] || 1)];
  };
  return {
    length: total,
    at(s) { const [a, b, f] = locate(s); return mixv(dense[a], dense[b], f); },
    along(s) { const [a, b, f] = locate(s); return normalize(mixv(T[a], T[b], f)); },
    frame(s) {
      const [a, b, f] = locate(s), t = normalize(mixv(T[a], T[b], f));
      const nn = normalize(sub(mixv(Nn[a], Nn[b], f), scale(t, dot(mixv(Nn[a], Nn[b], f), t))));
      return { t, n: nn, b: cross(t, nn) };
    },
  };
}
