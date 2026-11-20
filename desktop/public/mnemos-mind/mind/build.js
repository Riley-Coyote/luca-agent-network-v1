/* The mind, built off the page: where each memory sits, and the light that draws it, made in a worker so the page
 * never stops to wait. One worker makes one build and is then let go, and the millions of small objects the anatomy
 * makes go with it; only the packed buffer comes back, handed over rather than copied.
 *
 * Where each memory sits is the shape of what the mind has connected (What Lights Up's layout, first made in Python
 * with numpy for the log's first study): its concerns found as communities of the link graph, placed as lobes by how
 * much they share, then every memory inside its lobe, links pulling, memories pushing apart, the ones it keeps
 * coming back to drawn to the heart of their lobe. Mnemos ships no numpy, so it's made here: the same forces, with
 * memories pushing only within their own lobe (from another lobe the push is too faint to move anything), which is
 * what lets it run on a mind of thousands in a second or two. A mind keeps its shape while it grows: the places the
 * page remembers stay, and a new memory settles beside the ones it's tied to.
 *
 * How much light draws it is a budget, not a constant: a body's membrane, its nucleus, its arbour and each fibre are
 * made of points, and at full detail a mind of two thousand memories is eleven million of them, far more than any
 * screen shows. The page asks for a number of points it can draw smoothly, and `spend` decides where they go. */

import { anatomy } from '../engine/anatomy.js';
import { pack } from '../engine/tissue.js';
import { random } from '../engine/gl.js';

const INK = { skin: [0.42, 0.5, 1.0], nucleus: [0.7, 0.78, 1.0], dendrite: [0.36, 0.44, 1.0], fibre: [0.34, 0.4, 0.95], bouton: [0.5, 0.56, 1.0] };
const inkOf = (l) => [INK.skin, INK.nucleus, INK.dendrite, INK.fibre, INK.bouton][l.part];
const PACK = 0.34;                                   // drawn closer than laid out, so arbours and fibres meet as in tissue
// what each part costs, in points at full detail, measured on a real mind (2,097 memories, 10,825 links): a body's
// membrane and granules, its nucleus, the spines on its boughs, the boughs themselves; and a link's fibre, and its bouton
// points per memory for each part at full detail; a fibre's are per unit of its length (its strokes and its beads), and
// its bouton's are its own
const COST = { skin: 2680, core: 347, spine: 517, bough: 343, fibre: 49, bouton: 7 };

/* how to spend a budget of points on this mind. The lines come first: a bough or a fibre laid with fewer strokes
 * breaks into beads, so they keep full detail down to a floor. What gives is what the eye can't count at this size:
 * a membrane's points (each grows as they thin, so it keeps its glow), then its spines and nucleus, and the lines
 * last, never below the floor. A small mind gets everything back, in the opposite order. */
function spend(budget, n, nl, reach) {
  // (reach: how far the drawn fibres run, all together: a fibre's points are its length, and a mind set out in
  // regions has long ones; counted per fibre instead, the budget came out a third over)
  const cost = (o) => n * (COST.skin * o.skin + COST.core * o.core + COST.spine * o.spine + COST.bough * o.strand)
    + reach * COST.fibre * o.strand + nl * COST.bouton;
  const o = { strand: 1, spine: 0.4, core: 0.4, skin: 0.12 };
  const fit = (key, lo, hi) => {                     // move one part to land on the budget, within its bounds
    const without = cost({ ...o, [key]: 0 }), per = cost({ ...o, [key]: 1 }) - without;
    o[key] = Math.max(lo, Math.min(hi, (budget - without) / (per || 1)));
  };
  if (cost(o) > budget) { fit('skin', 0.04, o.skin); if (cost(o) > budget) { fit('spine', 0.15, o.spine); } if (cost(o) > budget) { fit('core', 0.15, o.core); } if (cost(o) > budget) fit('strand', 0.8, 1); }
  else { fit('skin', o.skin, 0.3); if (cost(o) < budget) fit('core', o.core, 1); if (cost(o) < budget) fit('spine', o.spine, 1); if (cost(o) < budget) fit('skin', o.skin, 1); }
  return { ...o, points: Math.round(cost(o)) };
}

/* ---------- its concerns: Louvain communities, a fading memory's tie to its lesson counting triple ---------- */

function communities(n, links, seed = 3) {
  const rnd = random(seed);
  // the graph as weighted adjacency; each pass works on the graph of the communities the last pass found
  let adj = Array.from({ length: n }, () => new Map());
  for (const l of links) {
    const w = l.w * (l.rel === 'distilled_into' ? 3 : 1);
    if (l.s === l.t) continue;
    adj[l.s].set(l.t, (adj[l.s].get(l.t) || 0) + w);
    adj[l.t].set(l.s, (adj[l.t].get(l.s) || 0) + w);
  }
  let member = Array.from({ length: n }, (_, i) => i);          // each original node's community
  for (let level = 0; level < 8; level++) {
    const m = adj.length, deg = adj.map((a) => { let d = 0; for (const w of a.values()) d += w; return d; });
    const self = adj.map((a, i) => a.get(i) || 0);
    const total = deg.reduce((a, b) => a + b, 0) || 1;
    const of = Array.from({ length: m }, (_, i) => i), tot = deg.slice();
    const order = Array.from({ length: m }, (_, i) => i);
    for (let i = m - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    let moved = true, rounds = 0, any = false;
    while (moved && rounds++ < 20) {
      moved = false;
      for (const i of order) {
        const home = of[i], ki = deg[i];
        const to = new Map();
        for (const [j, w] of adj[i]) if (j !== i) to.set(of[j], (to.get(of[j]) || 0) + w);
        tot[home] -= ki;
        let best = home, gain = (to.get(home) || 0) - (tot[home] * ki) / total;
        for (const [c, w] of to) {
          const g = w - (tot[c] * ki) / total;
          if (g > gain + 1e-12) { gain = g; best = c; }
        }
        tot[best] += ki;
        if (best !== home) { of[i] = best; moved = true; any = true; }
      }
    }
    if (!any) break;
    // renumber, fold the graph into its communities, and carry the original nodes along
    const ids = new Map(); for (const c of of) if (!ids.has(c)) ids.set(c, ids.size);
    const next = Array.from({ length: ids.size }, () => new Map());
    for (let i = 0; i < m; i++) {
      const a = ids.get(of[i]);
      if (self[i]) next[a].set(a, (next[a].get(a) || 0) + self[i]);
      for (const [j, w] of adj[i]) if (j !== i) { const b = ids.get(of[j]); next[a].set(b, (next[a].get(b) || 0) + w); }
    }
    member = member.map((c) => ids.get(of[c]));
    adj = next;
    if (ids.size === m) break;
  }
  // largest concern first, as the first layout numbered them
  const size = new Map(); for (const c of member) size.set(c, (size.get(c) || 0) + 1);
  const rank = new Map([...size.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([c], k) => [c, k]));
  return member.map((c) => rank.get(c));
}

/* ---------- forces: everything pushes everything apart, links pull, the cooling step shrinks ----------
 * Every memory pushes every other (k²/d², as the first layout did with numpy): that is what opens the space a memory
 * stands in, so one opened in the mind is seen alone, its arbour reaching out, not inside a crowd. Done pair by pair it
 * is millions of pairs a pass, so a distant cluster pushes as one mass at its centre (Barnes and Hut's octree): exact
 * nearby, close enough far off, and a few thousand memories settle in a second or two. */

function repel(P, n, k, F, theta = 0.8) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) { const v = P[i * 3 + d]; if (v < lo[d]) lo[d] = v; if (v > hi[d]) hi[d] = v; }
  const half = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 + 1e-6;
  const nodes = [];                                  // { m, x, y, z, s, kids|null, i (a leaf's one memory) }
  const make = (idx, cx, cy, cz, h) => {
    const node = { m: idx.length, x: 0, y: 0, z: 0, s: 2 * h, kids: null, i: -1 };
    for (const i of idx) { node.x += P[i * 3]; node.y += P[i * 3 + 1]; node.z += P[i * 3 + 2]; }
    node.x /= idx.length; node.y /= idx.length; node.z /= idx.length;
    if (idx.length === 1 || h < 1e-5) { node.i = idx[0]; return node; }
    const parts = [[], [], [], [], [], [], [], []];
    for (const i of idx) parts[(P[i * 3] > cx ? 1 : 0) | (P[i * 3 + 1] > cy ? 2 : 0) | (P[i * 3 + 2] > cz ? 4 : 0)].push(i);
    node.kids = [];
    const q = h / 2;
    parts.forEach((part, o) => { if (part.length) node.kids.push(make(part, cx + (o & 1 ? q : -q), cy + (o & 2 ? q : -q), cz + (o & 4 ? q : -q), q)); });
    return node;
  };
  const all = Array.from({ length: n }, (_, i) => i);
  const root = make(all, (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2, half);
  const kk = k * k, t2 = theta * theta, stack = [];
  for (let i = 0; i < n; i++) {
    const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
    let fx = 0, fy = 0, fz = 0;
    stack.length = 0; stack.push(root);
    while (stack.length) {
      const node = stack.pop();
      if (node.i === i && !node.kids) continue;
      const dx = px - node.x, dy = py - node.y, dz = pz - node.z, d2 = dx * dx + dy * dy + dz * dz + 1e-9;
      if (!node.kids || (node.s * node.s) / d2 < t2) {
        const d = Math.sqrt(d2), f = (node.m * kk) / d2 / d;
        fx += dx * f; fy += dy * f; fz += dz * f;
      } else for (const c of node.kids) stack.push(c);
    }
    F[i * 3] += fx; F[i * 3 + 1] += fy; F[i * 3 + 2] += fz;
  }
}

function forces(P, groups, links, iters, { k = 1, home = null, pullHome = null, gravity = 0.02, rnd, everyone = false }) {
  const n = P.length / 3, F = new Float64Array(n * 3);
  for (let it = 0; it < iters; it++) {
    F.fill(0);
    if (everyone) repel(P, n, k, F);
    else for (const g of groups) {
      for (let a = 0; a < g.length; a++) {
        const i = g[a] * 3;
        for (let b = a + 1; b < g.length; b++) {
          const j = g[b] * 3;
          let dx = P[i] - P[j], dy = P[i + 1] - P[j + 1], dz = P[i + 2] - P[j + 2];
          let d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 1e-9) { dx = rnd() - 0.5; dy = rnd() - 0.5; dz = rnd() - 0.5; d2 = 1e-3; }
          const d = Math.sqrt(d2), f = (k * k) / d2 / d;
          F[i] += dx * f; F[i + 1] += dy * f; F[i + 2] += dz * f;
          F[j] -= dx * f; F[j + 1] -= dy * f; F[j + 2] -= dz * f;
        }
      }
    }
    for (const [s, t, w] of links) {
      const i = s * 3, j = t * 3, dx = P[i] - P[j], dy = P[i + 1] - P[j + 1], dz = P[i + 2] - P[j + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-9, f = (0.6 * w * d) / k / d;
      F[i] -= dx * f; F[i + 1] -= dy * f; F[i + 2] -= dz * f;
      F[j] += dx * f; F[j + 1] += dy * f; F[j + 2] += dz * f;
    }
    const cool = 0.12 * (1 - it / iters) + 0.004;
    for (let i = 0; i < n; i++) {
      const q = i * 3;
      const g = typeof gravity === 'number' ? gravity : gravity[i];
      let fx = F[q] - g * P[q], fy = F[q + 1] - g * P[q + 1], fz = F[q + 2] - g * P[q + 2];
      if (home) { const h = pullHome[i]; fx += h * (home[q] - P[q]); fy += h * (home[q + 1] - P[q + 1]); fz += h * (home[q + 2] - P[q + 2]); }
      const step = Math.sqrt(fx * fx + fy * fy + fz * fz) + 1e-9, s = Math.min(step, cool) / step;
      P[q] += fx * s; P[q + 1] += fy * s; P[q + 2] += fz * s;
    }
  }
  return P;
}

function layout(cells, links, comm, { seed = 7, together = 0.15, gap = 1.2 } = {}) {
  const rnd = random(seed), normal = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const n = cells.length, K = Math.max(0, ...comm) + 1;
  // the lobes, placed by how much their memories share
  const C = Array.from({ length: K }, () => new Float64Array(K));
  let cMax = 0;
  for (const l of links) {
    const a = comm[l.s], b = comm[l.t];
    if (a !== b) { C[a][b] += l.w; C[b][a] += l.w; cMax = Math.max(cMax, C[a][b]); }
  }
  const lobeLinks = [];
  for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) {
    // a concern that shares nothing with the others still belongs to the same mind, or it drifts off and the whole
    // mind has to shrink to keep it in frame
    const w = (C[a][b] / (cMax || 1) + together) * 0.35;
    if (w > 0) lobeLinks.push([a, b, w]);
  }
  const Q = new Float64Array(K * 3).map(() => normal() * 2);
  forces(Q, [Array.from({ length: K }, (_, i) => i)], lobeLinks, 600, { k: 2.6, gravity: 0.01, rnd });
  // the memories, each concern laid out on its own first, so it keeps a shape of its own: its links pulling, its
  // memories pushing one another apart, a light pull holding it round
  let wMax = 0;
  const memLinks = links.map((l) => {
    const w = l.w * (l.rel === 'distilled_into' ? 3 : 1);
    wMax = Math.max(wMax, w);
    return [l.s, l.t, w];
  });
  for (const l of memLinks) l[2] /= wMax || 1;
  const groups = Array.from({ length: K }, () => []);
  cells.forEach((c, i) => groups[comm[i]].push(i));
  const inside = Array.from({ length: K }, () => []), where = new Int32Array(n);
  groups.forEach((g) => g.forEach((i, a) => { where[i] = a; }));
  for (const [s, t, w] of memLinks) if (comm[s] === comm[t]) inside[comm[s]].push([where[s], where[t], w]);
  const local = groups.map((g, a) => {
    const m = g.length, L = new Float64Array(m * 3).map(() => normal() * 0.6 * Math.cbrt(m));
    if (m > 1) forces(L, [], inside[a], m > 400 ? 260 : 360, { k: 0.55, gravity: 0.05, rnd, everyone: true });
    const c = [0, 1, 2].map((d) => { let v = 0; for (let x = 0; x < m; x++) v += L[x * 3 + d]; return v / m; });
    const r = [];
    for (let x = 0; x < m; x++) { for (let d = 0; d < 3; d++) L[x * 3 + d] -= c[d]; r.push(Math.hypot(L[x * 3], L[x * 3 + 1], L[x * 3 + 2])); }
    r.sort((p, q) => p - q);
    return { L, r: Math.max(0.6, r[Math.floor(r.length * 0.9)] || 0) };
  });
  // then the concerns set apart by their size, each where what it shares put it, with clear space between them
  // (a place of its own, so a concern reads as one), drawn in together as far as that space allows
  const R = local.map((o) => o.r), rMean = R.reduce((a, b) => a + b, 0) / (K || 1);
  let qd = 0;
  for (let a = 0; a < K; a++) qd = Math.max(qd, Math.hypot(Q[a * 3], Q[a * 3 + 1], Q[a * 3 + 2]));
  for (let a = 0; a < K * 3; a++) Q[a] *= (rMean * Math.cbrt(K) * 2.2) / (qd || 1);
  const GAP = 0.32 * gap;
  for (let it = 0; it < 360; it++) {
    for (let a = 0; a < K; a++) { Q[a * 3] *= 0.994; Q[a * 3 + 1] *= 0.985; Q[a * 3 + 2] *= 0.992; }     // wider than tall, like its frame
    for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) {
      const dx = Q[b * 3] - Q[a * 3], dy = Q[b * 3 + 1] - Q[a * 3 + 1], dz = Q[b * 3 + 2] - Q[a * 3 + 2];
      const d = Math.hypot(dx, dy, dz) + 1e-9, need = (R[a] + R[b]) * (1 + GAP);
      if (d >= need) continue;
      const push = (need - d) / d, wa = R[b] / (R[a] + R[b]), wb = 1 - wa;     // the smaller one gives way
      Q[a * 3] -= dx * push * wa; Q[a * 3 + 1] -= dy * push * wa; Q[a * 3 + 2] -= dz * push * wa;
      Q[b * 3] += dx * push * wb; Q[b * 3 + 1] += dy * push * wb; Q[b * 3 + 2] += dz * push * wb;
    }
  }
  const P = new Float64Array(n * 3);
  groups.forEach((g, a) => g.forEach((i, x) => { for (let d = 0; d < 3; d++) P[i * 3 + d] = Q[a * 3 + d] + local[a].L[x * 3 + d]; }));
  // centred, and scaled so nearest neighbours sit about 0.9 apart: room for an arbour
  const mid = [0, 1, 2].map((d) => { let s = 0; for (let i = 0; i < n; i++) s += P[i * 3 + d]; return s / n; });
  for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) P[i * 3 + d] -= mid[d];
  const nearest = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dx = P[i * 3] - P[j * 3], dy = P[i * 3 + 1] - P[j * 3 + 1], dz = P[i * 3 + 2] - P[j * 3 + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < nearest[i]) nearest[i] = d;
    if (d < nearest[j]) nearest[j] = d;
  }
  const sorted = Array.from(nearest).filter(Number.isFinite).sort((a, b) => a - b);
  const median = sorted.length ? sorted[sorted.length >> 1] : 1, s = 0.9 / (median || 1);
  return Array.from({ length: n }, (_, i) => [P[i * 3] * s, P[i * 3 + 1] * s, P[i * 3 + 2] * s]);
}

/* where each memory sits: from the places the page remembers when they cover the mind, else laid out afresh */
function place(cells, links, known, seed, tune = {}) {
  const rnd = random(seed);
  const placed = cells.map((c) => known[c.id] || null);
  const have = placed.filter(Boolean).length;
  if (cells.length && have >= 0.9 * cells.length) {
    const nb = cells.map(() => []);
    for (const l of links) { nb[l.s].push(l.t); nb[l.t].push(l.s); }
    const newest = placed.map((p, i) => (p ? i : -1)).filter((i) => i >= 0).slice(-12);
    let fresh = 0;
    cells.forEach((c, i) => {
      if (placed[i]) return;
      fresh++;
      let near = nb[i].filter((j) => placed[j]);
      if (!near.length) near = newest;
      const mid = [0, 1, 2].map((d) => near.reduce((a, j) => a + placed[j][d], 0) / (near.length || 1));
      const votes = new Map(); for (const j of near) votes.set(placed[j][3], (votes.get(placed[j][3]) || 0) + 1);
      const k = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
      placed[i] = [mid[0] + (rnd() - 0.5) * 0.9, mid[1] + (rnd() - 0.5) * 0.9, mid[2] + (rnd() - 0.5) * 0.9, k];
    });
    return { places: placed, fresh, laidOut: false };
  }
  const comm = communities(cells.length, links);
  const P = layout(cells, links, comm, tune);
  return { places: P.map((p, i) => [...p, comm[i]]), fresh: cells.length, laidOut: true };
}

onmessage = ({ data: job }) => {
  try { work(job); } catch (e) { postMessage({ error: `${e.message}\n${e.stack || ''}` }); }
};

/* a few memories redrawn finely, in place: the one being read and those tied to it, at full detail, over the coarser
 * whole. Each comes with its shape from the drawing of the whole (where it sits, which way it leans, how many feed it),
 * and draws from the same streams of chance, so its arbour is the same arbour, only finer. */
function local(job) {
  const A = anatomy({ cells: job.cells, links: job.links }, { reach: 0.75 });
  const packed = pack(A.points, (ch) => job.glyphs[ch], job.metrics, inkOf);
  postMessage({ data: packed.data, count: packed.count }, [packed.data.buffer]);
}

function work(job) {
  if (job.kind === 'local') return local(job);
  const t0 = performance.now();
  const { cells, links, known, budget, glyphs, metrics } = job;
  const { places, fresh, laidOut } = place(cells, links, known, job.seed || 7, job.tune || {});
  const tLayout = performance.now() - t0;
  // drawn closer than laid out (the same shape, smaller), around a centre that holds still while the mind grows
  const MID = job.mid || [0, 1, 2].map((d) => places.reduce((a, p) => a + p[d], 0) / (places.length || 1));
  const drawn = cells.map((c, i) => ({ kind: c.lesson ? 'procedural' : 'episodic', strength: c.strength, stability: c.stability,
    p: [0, 1, 2].map((d) => MID[d] + (places[i][d] - MID[d]) * PACK) }));
  // At rest a link is drawn once it has come back more than once: recalled together once, it's the faintest tie there
  // is, two of every three links, and as fibres it was half of all the points (and most of the tangle). It's still a
  // link (it lights, and an opened memory draws all of its ties finely); it just isn't strung across the mind at rest.
  const shown = links.map((l) => (l.rel === 'co_activated' && l.w < (job.drawW ?? 0.4) ? { ...l, bare: true } : l));
  const strung = shown.filter((l) => !l.bare);
  const reach = strung.reduce((a, l) => a + Math.hypot(drawn[l.s].p[0] - drawn[l.t].p[0], drawn[l.s].p[1] - drawn[l.t].p[1], drawn[l.s].p[2] - drawn[l.t].p[2]), 0);
  const parts = spend(budget, Math.max(1, cells.length), strung.length, reach);
  const A = anatomy({ cells: drawn, links: shown }, { strand: parts.strand, spine: parts.spine, skin: parts.skin, core: parts.core, reach: 0.75 });
  const glyph = (ch) => glyphs[ch];
  // laid in by blocks of space, so the page can leave out what the camera can't see
  const packed = pack(A.points, glyph, metrics, inkOf, { blocks: 160 });
  const n = A.cells.length, R = new Float32Array(n), P = new Float32Array(n * 3), apex = new Float32Array(n * 3), hillock = new Float32Array(n * 3);
  const incoming = new Uint16Array(n), degree = new Uint16Array(n);
  for (const l of links) { incoming[l.t]++; degree[l.t]++; degree[l.s]++; }
  A.cells.forEach((c, i) => { R[i] = c.R; P.set(c.P, i * 3); apex.set(c.apex, i * 3); hillock.set(c.hillock, i * 3); });
  postMessage({ data: packed.data, count: packed.count, blocks: packed.blocks, R, P, apex, hillock, incoming, degree, places, mid: MID, fresh, laidOut, detail: parts,
    ms: { layout: Math.round(tLayout), total: Math.round(performance.now() - t0) } }, [packed.data.buffer, packed.blocks.buffer, R.buffer, P.buffer, apex.buffer, hillock.buffer]);
}
