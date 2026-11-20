/* From the Alive studies' herbarium (mnemos-engine-page, alive/herbarium/figure.js at fd5a7b6), unchanged: the companion
 * draws a memory up close the way the herbarium engraves it (../specimens.js reads the memory into its shape). */

/* One life, on one page: Merian put every stage of a creature on a single sheet. Here the stages are the memories of one
 * family of distillations, left to right in the order they were kept: the experience as a drop, the stalk, the lesson as a
 * round specimen with its spines, and where a lesson was itself distilled again, a third generation beyond it. */

import { makeSpec, slotSpines, drawCorona, drawSpines, drawBody, drawStalk, anchor, wallR, spineLen, TIP, ease, rgba } from './specimen.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/* how far a specimen reaches from its centre, in units of its radius: wall, longest spine, corona */
function reachOf(spec) {
  const spine = Math.max(0, ...spec.spines.filter((s) => s.rel !== 'distilled_into').map((s) => 0.32 + 0.95 * s.w));
  const corona = spec.dormant ? 0 : 1.45 * spec.reach * 1.16 * 0.84;      // a faint halo: counted nearly in full, so the frame does not cut it
  return (spec.round ? 1 : 1 + TIP) + Math.max(spine * 0.9, corona);
}

export function composeFamily(model, family, box, { kMax = 230, pad = 18, dir = 'h' } = {}) {
  const vertical = dir === 'v';
  const G = family.depth;
  const cols = Array.from({ length: G }, () => []);
  for (const n of family.nodes) cols[family.gen.get(n)].push(n);
  for (const col of cols) col.sort((a, b) => model.cells[a].bornT - model.cells[b].bornT || a - b);
  const specs = new Map(family.nodes.map((n) => [n, makeSpec(model, n)]));
  // time runs along the major axis (left to right, or down a phone's page); memories of one generation stack across it
  const gapK = family.nodes.length === 2 ? (vertical ? 1.5 : 2.1) : (vertical ? 0.9 : 1.05);   // the stalk, in units of K (strength x K is a radius)
  const majSize = cols.map((col) => 2 * Math.max(...col.map((n) => specs.get(n).strength * reachOf(specs.get(n)))));
  const minTot = cols.map((col) => col.reduce((s, n) => s + 2 * specs.get(n).strength * reachOf(specs.get(n)), 0) + (col.length - 1) * 0.2);
  const MAJ = majSize.reduce((a, b) => a + b, 0) + (G - 1) * gapK, MIN = Math.max(...minTot);
  const boxMaj = vertical ? box.h : box.w, boxMin = vertical ? box.w : box.h;
  const K = Math.min(kMax, (boxMaj - 2 * pad) / MAJ, (boxMin - 2 * pad) / MIN);
  const nodes = new Map();
  let maj = (vertical ? 0 : (box.x0 || 0)) + (boxMaj - MAJ * K) / 2;
  cols.forEach((col, g) => {
    const cmaj = maj + (majSize[g] * K) / 2;
    let min = (boxMin - minTot[g] * K) / 2;
    for (const n of col) {
      const sp = specs.get(n), R = sp.strength * K, h = 2 * sp.strength * reachOf(sp) * K, cmin = min + h / 2;
      nodes.set(n, { n, spec: sp, g, x: vertical ? cmin : cmaj, y: vertical ? cmaj : cmin, R, rot: 0 });
      min += h + 0.2 * K;
    }
    maj += (majSize[g] + gapK) * K;
  });
  // a stalk that skips a generation must clear the memory between: arch over it (or under, if that memory sits above the line)
  const nodeList = [...nodes.values()];
  const skipInfo = new Map();
  for (const p of family.pairs) {
    const A = nodes.get(p.a), B = nodes.get(p.b);
    if (B.g - A.g <= 1) continue;
    let side = -1, blocked = false;
    for (const M of nodeList) {
      if (M === A || M === B || M.g <= A.g || M.g >= B.g) continue;
      const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      const t = ((M.x - A.x) * (B.x - A.x) + (M.y - A.y) * (B.y - A.y)) / (L * L);
      const dist = Math.abs((M.x - A.x) * (B.y - A.y) - (M.y - A.y) * (B.x - A.x)) / L;
      if (t > 0 && t < 1 && dist < M.R * 1.9) { blocked = true; const above = ((M.x - A.x) * (B.y - A.y) - (M.y - A.y) * (B.x - A.x)) / L; side = above > 0 ? -1 : 1; }
    }
    if (blocked) skipInfo.set(p.pi, side);
  }
  // orientation: toward the memory it was kept from (a lesson), or toward the lesson it became (an experience)
  const bearing = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  for (const node of nodeList) {
    const n = node.n;
    const inc = family.pairs.filter((p) => p.b === n), out = family.pairs.filter((p) => p.a === n);
    const plain = [...inc, ...out].filter((p) => !skipInfo.has(p.pi));
    const lead = plain.find((p) => p.b === n) || plain[0];
    const first = lead ? nodes.get(lead.b === n ? lead.a : lead.b) : null;
    node.rot = first ? bearing(node, first) : 0;
    const bearings = {};
    for (const p of [...inc, ...out]) {
      const other = nodes.get(p.a === n ? p.b : p.a);
      let b = bearing(node, other) - node.rot;
      if (skipInfo.has(p.pi)) b += (p.a === n ? 1 : -1) * skipInfo.get(p.pi) * 0.95;
      bearings[p.link.li] = b;
    }
    node.slots = slotSpines(node.spec, bearings);
  }
  // stalks between anchors
  const stalks = family.pairs.map((p) => {
    const A = nodes.get(p.a), B = nodes.get(p.b);
    const sa = A.slots.find((s) => s.li === p.link.li), sb = B.slots.find((s) => s.li === p.link.li);
    const st = { p, A, B, from: anchor(A.spec, sa, A), to: anchor(B.spec, sb, B), skip: skipInfo.has(p.pi), ctrl: null };
    if (st.skip) {
      // an arch can only rise as far as the frame lets it: keep its apex inside, whichever way it bows
      const side = skipInfo.get(p.pi), L = Math.hypot(B.x - A.x, B.y - A.y);
      const avail = vertical ? (side > 0 ? Math.min(st.from.x, st.to.x) - pad : box.w - pad - Math.max(st.from.x, st.to.x)) : (side > 0 ? box.h - pad - Math.max(st.from.y, st.to.y) : Math.min(st.from.y, st.to.y) - pad);
      st.ctrl = clamp01((avail / 0.66) / (L * 0.38)) * L * 0.38;
      st.ctrl = Math.max(st.ctrl, L * 0.1);
    }
    return st;
  });
  return { family, nodes, stalks, K, box, G, cols, vertical };
}

/* draw the life, at progress 0..1 (the plate engraving itself, experience first) */
export function drawFamily(ctx, fig, o) {
  const { ink, paper, signal, t = 0, progress = 1, lean = null, hover = null, hoverSpine = null } = o;
  const G = fig.G;
  const stage = (g) => ({ s: g * 0.30, e: g * 0.30 + 0.34 });
  const grow = (g) => clamp01((progress - stage(g).s) / (stage(g).e - stage(g).s));
  const nodes = [...fig.nodes.values()];
  const dim = (n) => (hover != null && hover !== n.n ? 0.38 : 1);
  // corona, then stalks, then spines, then bodies: the same order as the disc, so the one drawing reads as the other
  for (const nd of nodes) drawCorona(ctx, nd.spec, { x: nd.x, y: nd.y, R: nd.R, rot: nd.rot, ink, alpha: dim(nd), t: t + nd.n, grow: clamp01((grow(nd.g) - 0.55) / 0.45), lean });
  for (const st of fig.stalks) {
    const d = clamp01((progress - (st.A.g * 0.30 + 0.20)) / 0.28);
    const hot = hover === st.A.n || hover === st.B.n;
    drawStalk(ctx, st.from, st.to, { ink, paper, alpha: dim({ n: hover === st.A.n || hover === st.B.n ? hover : -1 }), draw: d, width: Math.max(0.9, fig.K * 0.012), signal, hot: false, bow: 0, ctrl: st.ctrl, tube: fig.K >= 60 });
    // a knot where the stalk leaves each wall
    if (d > 0.02) for (const P of [st.from, st.to]) { ctx.beginPath(); ctx.arc(P.x, P.y, Math.max(1.6, fig.K * 0.014), 0, Math.PI * 2); ctx.fillStyle = rgba(ink, 0.95); ctx.fill(); }
  }
  for (const nd of nodes) {
    const g = grow(nd.g);
    drawSpines(ctx, nd.spec, nd.slots, { x: nd.x, y: nd.y, R: nd.R, rot: nd.rot, ink, alpha: dim(nd), spineK: () => clamp01((g - 0.5) / 0.5), signal, signalLi: hoverSpine && hoverSpine.n === nd.n ? hoverSpine.li : null });
    drawBody(ctx, nd.spec, { x: nd.x, y: nd.y, R: nd.R, rot: nd.rot, ink, paper, alpha: dim(nd), grow: g, signal, live: false });
  }
}

/* what the pointer is over: a body, or a spine's tip */
export function pickFamily(fig, px, py) {
  let spine = null;
  for (const nd of fig.nodes.values()) {
    for (const s of nd.slots) {
      if (s.rel === 'distilled_into') continue;
      const a = nd.rot + s.ang, r0 = wallR(nd.spec, s.ang) * nd.R, L = spineLen(s, nd.R);
      const tx = nd.x + Math.cos(a) * (r0 + L), ty = nd.y + Math.sin(a) * (r0 + L);
      if (Math.hypot(tx - px, ty - py) < 9) spine = { n: nd.n, li: s.li, s, x: tx, y: ty };
    }
  }
  let body = null, bd = 1e9;
  for (const nd of fig.nodes.values()) {
    const d = Math.hypot(nd.x - px, nd.y - py);
    if (d < nd.R * (nd.spec.round ? 1.05 : 1.5) && d < bd) { bd = d; body = nd.n; }
  }
  return { spine, body };
}
