/* validate.js — marks are data another mind produced. Check them before the
 * engine draws them, whether they came from the book, a chat message, or the
 * sandbox. Runs in node and in the browser. No dependencies beyond the engine's
 * name tables.
 */

import { BRUSHES, LAYERS } from './mark-engine.js';

export const LIMITS = {
  maxOps: 20000,
  maxPoints: 600000,
  maxStrokePoints: 4000,
  maxPolyPoints: 512,
  maxPauseMs: 5000,
  maxWeight: 6,
  maxDotRadius: 60,
  page: { w: 880, h: 660 },
  margin: 400, /* how far off the page a point may go */
};

const KINDS = new Set(['s', 'g', 'd', 'p', 'phase', 'occ', 'clamp']);
const LAYER_KEYS = new Set(LAYERS.map((l) => l.key));
const BRUSH_KEYS = new Set(Object.keys(BRUSHES));

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Returns { ops, errors, stats }. `ops` is a clean copy holding only the
 * fields the engine reads, or null if anything was rejected. Errors are
 * capped at 20 so a hostile payload cannot flood the caller.
 */
export function sanitizeOps(input, limits = LIMITS) {
  const errors = [];
  const err = (i, msg) => { if (errors.length < 20) errors.push(`op ${i}: ${msg}`); };
  if (!Array.isArray(input)) return { ops: null, errors: ['ops is not an array'], stats: null };
  if (input.length > limits.maxOps) return { ops: null, errors: [`${input.length} ops, limit ${limits.maxOps}`], stats: null };
  const lo = -limits.margin, hiX = limits.page.w + limits.margin, hiY = limits.page.h + limits.margin;
  const inRange = (p) => num(p[0]) && num(p[1]) && p[0] >= lo && p[0] <= hiX && p[1] >= lo && p[1] <= hiY;
  const cleanPts = (i, pts, max, min = 2) => {
    if (!Array.isArray(pts) || pts.length < min) { err(i, `needs at least ${min} points`); return null; }
    if (pts.length > max) { err(i, `${pts.length} points, limit ${max}`); return null; }
    const out = new Array(pts.length);
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      if (!Array.isArray(p) || !inRange(p)) { err(i, `point ${k} is not a finite on-page [x, y]`); return null; }
      out[k] = [p[0], p[1]];
    }
    return out;
  };
  const out = [];
  let points = 0;
  for (let i = 0; i < input.length; i++) {
    const o = input[i];
    if (!o || typeof o !== 'object') { err(i, 'not an object'); continue; }
    if (!KINDS.has(o.k)) { err(i, `unknown kind ${JSON.stringify(o.k)}`); continue; }
    if (o.k === 's' || o.k === 'g') {
      const pts = cleanPts(i, o.pts, limits.maxStrokePoints);
      if (!pts) continue;
      if (!LAYER_KEYS.has(o.layer)) { err(i, `unknown layer ${JSON.stringify(o.layer)}`); continue; }
      if (!BRUSH_KEYS.has(o.brush)) { err(i, `unknown brush ${JSON.stringify(o.brush)}`); continue; }
      const w = o.w === undefined ? 1 : o.w;
      if (!num(w) || w <= 0 || w > limits.maxWeight) { err(i, `weight ${o.w} out of range`); continue; }
      points += pts.length;
      out.push({ k: o.k, pts, layer: o.layer, brush: o.brush, w });
    } else if (o.k === 'd') {
      if (!inRange([o.x, o.y]) || !num(o.r) || o.r <= 0 || o.r > limits.maxDotRadius) { err(i, 'dot out of range'); continue; }
      if (!LAYER_KEYS.has(o.layer)) { err(i, `unknown layer ${JSON.stringify(o.layer)}`); continue; }
      if (!BRUSH_KEYS.has(o.brush)) { err(i, `unknown brush ${JSON.stringify(o.brush)}`); continue; }
      out.push({ k: 'd', x: o.x, y: o.y, r: o.r, layer: o.layer, brush: o.brush });
    } else if (o.k === 'p') {
      if (!num(o.ms) || o.ms < 0 || o.ms > limits.maxPauseMs) { err(i, 'pause out of range'); continue; }
      out.push({ k: 'p', ms: o.ms });
    } else if (o.k === 'phase') {
      if (typeof o.name !== 'string' || o.name.length > 64) { err(i, 'phase name is not a short string'); continue; }
      const ms = o.ms === undefined ? 240 : o.ms;
      if (!num(ms) || ms < 0 || ms > limits.maxPauseMs) { err(i, 'phase pause out of range'); continue; }
      out.push({ k: 'phase', name: o.name, ms });
    } else if (o.k === 'occ') {
      const poly = cleanPts(i, o.poly, limits.maxPolyPoints, 3);
      if (!poly) continue;
      const a = o.a === undefined ? 0.9 : o.a;
      if (!num(a) || a < 0 || a > 1) { err(i, 'occlusion alpha out of range'); continue; }
      points += poly.length;
      out.push({ k: 'occ', poly, a });
    } else if (o.k === 'clamp') {
      if (!LAYER_KEYS.has(o.layer)) { err(i, `unknown layer ${JSON.stringify(o.layer)}`); continue; }
      if (!num(o.max) || o.max < 0 || o.max > 1) { err(i, 'clamp out of range'); continue; }
      out.push({ k: 'clamp', layer: o.layer, max: o.max });
    }
    if (points > limits.maxPoints) { errors.push(`${points}+ points, limit ${limits.maxPoints}`); break; }
  }
  const stats = { ops: out.length, points };
  return errors.length ? { ops: null, errors, stats } : { ops: out, errors, stats };
}

/** Meta fields a page carries besides its marks — checked the same way. */
export function sanitizePageMeta(meta) {
  const errors = [];
  const str = (k, max) => {
    const v = meta[k];
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') { errors.push(`${k} is not a string`); return ''; }
    return v.length > max ? v.slice(0, max) : v;
  };
  const out = {
    title: str('title', 120) || 'untitled',
    date: /^\d{4}-\d{2}-\d{2}$/.test(meta.date || '') ? meta.date : '',
    note: str('note', 4000),
    refs: Array.isArray(meta.refs) ? meta.refs.filter((r) => Number.isInteger(r) && r > 0 && r < 1000).slice(0, 16) : [],
  };
  return { meta: out, errors };
}
