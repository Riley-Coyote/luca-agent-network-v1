/* The mind: an agent's live memory, drawn by What Lights Up's anatomy (../engine/anatomy.js) and renderer
 * (../engine/tissue.js, ../engine/post.js), at rest: dark, and lit only where its quiet hours went. First made as
 * "Still warm", the log's second view; any Mnemos agent's, for whichever mind `mnemos log` shows (?agent=).
 *
 * An hour's path is read from its own record: the memories its waking named, the questions waiting for it, and the
 * memories it reached for with its own tools. Each burns white and cools like phosphor, at the real rate since that
 * hour ended (a half-life of six hours), so the mind you come back to says, without words, how long ago it was last
 * thinking on its own. Nothing is simulated: every cell is a memory, every fibre a real link, every light a real touch.
 *
 * When you arrive, the last hour's path is walked again, in the order it was walked, and settles to its temperature.
 * Memories formed since you were last here (this browser's own note of your last visit) arrive white-hot.
 *
 * The reading room (../shared/room.js, the one the log uses) holds everything in the memory, readable and searchable;
 * touching an entry lights it where it lives. Below the mind, on paper, is what each hour left.
 *
 * Kept light enough for any machine: the drawing is made in a worker (./build.js) to a budget of points this screen
 * draws smoothly, spent on the lines first so every fibre stays whole; if frames still come slowly the budget halves.
 * It draws only while something moves: the slow turn stops a while after you last touched it, and a still mind costs
 * nothing until a touch, a new memory or an hour wakes it. Where each memory sits is remembered in this browser. */

import { context, prepare, lookAt, perspective, add, sub, scale, dot, length, normalize, cross, mix, mixv, clamp } from '../engine/gl.js';
import { glyphAtlas, DOT, STROKE, LINE } from '../engine/glyphs.js';
import { Post } from '../engine/post.js';
import { Tissue } from '../engine/tissue.js';
import { Room, parseRoute } from '../shared/room.js';
import { nameRegions } from '../shared/regions.js';
import { esc, at, clock, longDay, shortDay, ago, plural, words, firstLine, titleOf, temperature, tempWord, KIND, KIND_LONG, trailSentence,
  forPerson, sameModel, modelName, AGENT, withAgent, visit, sinceThen, waiting } from '../shared/words.js';
import { tell, telling } from '../shared/tell.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
/* Behind the notebook. The log's page holds this one, whole and running, as what's under its cards (?behind): covered,
 * it shows no controls and turns no more than something happening asks of it, so a memory arriving still lights it;
 * when the cards part it's simply there, and "the log" brings them back. Opened by itself it's the same page. */
const behind = params.has('behind');
let covered = behind;
const toNotebook = (what, more = {}) => { if (behind) parent.postMessage({ mnemos: what, ...more }, location.origin); };
if (behind) {
  document.documentElement.classList.add('behind', 'covered');
  addEventListener('message', (e) => {
    if (e.source !== parent || e.origin !== location.origin) return;
    if (e.data?.mnemos === 'reveal') {
      covered = false; document.documentElement.classList.remove('covered');
      try { if (e.data.hash) { history.replaceState(null, '', location.pathname + location.search + e.data.hash); fromHash(); } stir(); } catch { /* still arriving: it shows itself when it's ready */ }
    } else if (e.data?.mnemos === 'cover') {
      covered = true; document.documentElement.classList.add('covered');
      try { if (sheetOpen) closeRoom(); letGo(); wake(); } catch { /* still arriving */ }
    } else if (e.data?.mnemos === 'ask') $('ask-q')?.focus();
  });
  document.addEventListener('click', (e) => {          // every way back to the log is the cards returning
    if (e.target.closest?.('#to-paper')) { e.stopPropagation(); toNotebook('cover', { tab: 'hours' }); return; }   // what it left is read in the log
    const a = e.target.closest?.('a[href]');
    if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && new URL(a.href).pathname.endsWith('/log/')) { e.preventDefault(); toNotebook('cover'); }
  }, true);
  toNotebook('here');
}
const FOV = (26 * Math.PI) / 180;
const LIVE_EVERY = 20_000;                     // life.json is small; memories.json is read again only when it changes
const DIM = 0.3;                               // the mind at rest: present, not lit (the damask's sheen)
const LOOK = { rest: [0.4, 0.55, 0.22, 0.8], light: [0.85, 1.3, 0.55, 0.8], back: 0.45 };
// the lens and the print, tunable from the address while they're being chosen (?pixels=&blur=&bloom=&ca=&grain=&skin=)
const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
/* Chosen Oct 31 against the first studies' settings (2.4M pixels, the lens at full strength, bloom, fringe and grain
 * as for a film), which with two thousand memories read as fog: the screen's own pixels (a Retina desk window whole),
 * a lens that only whispers at a distance and still softens what's behind an opened memory, a little glow, no colour
 * fringing, a finer grain, and the links at rest quieter, so they read when lit. */
const LENS = { pixels: num('pixels', 5.2e6), blur: num('blur', 0.25), blurClose: num('blurclose', 0.5), bloom: num('bloom', 0.4), ca: num('ca', 0),
  grain: num('grain', 0.5), skin: num('skin', 1), threads: num('threads', 0.45), pad: num('pad', 0.75) };
LOOK.rest[0] *= LENS.skin; LOOK.rest[3] *= LENS.threads;
const SHEET = 560;
const TURN_FOR = 30_000;                       // how long it keeps turning after you last touched it
const TABS = ['memories', 'beliefs', 'questions', 'journal', 'notes', 'hours'];
const json = async (path) => { const r = await fetch(withAgent(path), { cache: 'no-store' }); if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full, or private: the page works without it */ } },
};

/* how many points this screen draws smoothly: a phone or a small machine far fewer than a desk; once a screen has
 * shown what it can do, the page remembers (a convenience: without it the guess is used again). A page opened hidden
 * has no width yet, so the screen's own is asked instead (else it'd be drawn for a phone, and miss the kept drawing) */
const small = (innerWidth || screen.width) < 760 || (navigator.deviceMemory || 8) <= 4;
const BUDGET_KEY = 'mnemos.mind.budget.v3';      // v3: the budget is counted truly (a fibre by its length)
const PIXELS_KEY = 'mnemos.mind.pixels.v1';
let budget = Number(params.get('budget')) || store.get(BUDGET_KEY) || (small ? 1_200_000 : 2_400_000);
if (!params.has('pixels')) LENS.pixels = store.get(PIXELS_KEY) || LENS.pixels;

/* ---------- the renderer ---------- */

/* where the mind can't be drawn, it says so in one line where it would be, with the way to the log (which reads the
 * same memory without a GPU), and takes away its own controls, which would do nothing */
function cannotDraw(why) {
  $('loading').innerHTML = `<span>${why} Everything in it is in <a class="textlink" href="${esc(withAgent('../log/'))}">the log</a>.</span>`;
  $('ask').remove(); $('open-room').remove(); $('to-log').href = withAgent('../log/');
  toNotebook('cannot');
}

document.fonts.add(await new FontFace('Mono', 'url(../fonts/jetbrains-mono-nl.woff)', { weight: '400' }).load());
const canvas = $('mind');
const gl = (() => {
  try { return context(canvas); } catch (e) { cannotDraw('This browser can’t draw the mind.'); throw e; }
})();
// software graphics (no GPU: the processor works out every pixel) can't move even the lightest mind, under a frame a
// second when it was tried, so it isn't
const renderer = String(gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) || '');
if (/swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i.test(renderer)) {
  cannotDraw('This browser draws without a graphics card, too slowly to move the mind.');
  throw new Error(`software graphics: ${renderer}`);
}
// the mind is drawn in three shapes of light and no letters, so only those three are set (each at every blur level):
// the whole alphabet took most of the page's start, about eight seconds of it on a busy machine
const ATLAS = { sets: [{ name: 'mono', glyphs: DOT + STROKE + LINE, font: (px) => `400 ${px}px Mono` }] };
let atlas = await glyphAtlas(gl, ATLAS, { cell: 112 });
const GLYPHS = Object.fromEntries([DOT, STROKE, LINE].map((ch) => [ch, atlas.index[`mono:${ch}`]]));

/* ---------- the memory, read, and drawn (again when it grows) ---------- */

let L = { identity: { name: '', person: null }, hours: [], journal: [], notes: [], studio: [], questions: { open: 0, byKind: {}, asked: [], answered: [] },
  beliefs: [], handoffs: [], memory: { states: {}, count: 0 } };
let mems = [], memAt = new Map(), memVersion = null;
let D, N = 0, NL = 0, tissue = null, R, P, centre, extent, HOME, MID = null, cellOf = new Map();
let born, acc, nbrs, glow, flash, aim, read, LF, LA, LT, LR, fireAt, fireLevel, linkAt, linkLevel, heat, linkHeat;
let fc, fAim, lc, lAim, shownG, shownF;          // the light of what you're pointing at (see "pointing")
const LAYOUT_KEY = () => `mnemos.mind.layout.v3.${L.identity.agentId || AGENT || 'agent'}`;   // v3: its regions set apart

/* the export's memories as the anatomy reads them: a cell per memory, a link per tie (counted once, from its sender) */
function shape(list) {
  const index = new Map(list.map((m, i) => [m.id, i]));
  const cells = list.map((m) => ({ id: m.id, fullId: m.id, born: m.born, accessibility: m.acc, state: m.state, lesson: m.lesson,
    recalls: m.recalls, strength: m.strength ?? 0.5, stability: m.stability ?? 0.5 }));
  const links = [];
  list.forEach((m, s) => {
    for (const [target, rel, w, , , out] of m.ties) {
      const t = index.get(target);
      if (t === undefined || (out === undefined ? s > t : !out)) continue;
      links.push({ s, t, w, rel });
    }
  });
  return { cells, links };
}

/* one job in a worker of its own, let go when it answers; a worker that couldn't even start (its script not fetched,
 * a dropped connection) is tried once more before the job gives up */
async function inWorker(job, tries = 2) {
  for (let k = 1; ; k++) {
    try { return await oneWorker(job); } catch (e) { if (k >= tries || !/could not be made|start/.test(e.message)) throw e; }
    await new Promise((r) => setTimeout(r, 400));
  }
}
function oneWorker(job) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./build.js', import.meta.url), { type: 'module' });
    w.onmessage = ({ data: out }) => { w.terminate(); if (out.error) reject(new Error(out.error)); else resolve(out); };
    w.onerror = (e) => { e.preventDefault(); w.terminate(); reject(new Error(`${e.message || 'the drawing could not be made'} (${e.filename}:${e.lineno})`)); };
    w.onmessageerror = () => { w.terminate(); reject(new Error('the drawing could not be handed back')); };
    w.postMessage(job);
  });
}
function drawIn(data) {
  {
    const tune = Object.fromEntries(['gap', 'together'].filter((k) => params.has(k)).map((k) => [k, Number(params.get(k))]));
    return inWorker({ tune, cells: data.cells.map((c) => ({ id: c.id, lesson: c.lesson, strength: c.strength, stability: c.stability, recalls: c.recalls, acc: c.accessibility })),
      links: data.links, known: params.has('relayout') ? {} : store.get(LAYOUT_KEY()) || {}, budget,
      glyphs: GLYPHS, metrics: atlas.metrics, mid: MID, drawW: DRAW_W });
  }
}

/* ---------- up close: a few memories drawn finely, over the whole ----------
 * The whole mind is drawn lightly, which is right from across the room and wrong up close, where a membrane should be
 * a fine grain and not a few dots. So a memory opened, with those it's most tied to, is drawn again at full detail
 * where it sits, the same shape it has in the whole (its streams of chance are its own), and its light version is
 * dimmed to nothing, which costs nothing to draw. A few dozen memories finely, not thousands. */
const NEAR_MOST = 48;
// at rest a link is strung across the mind once it's come back more than once (./build.js says why); `strung` marks them
const DRAW_W = 0.4;
let strung = new Uint8Array(0);
let SH = null, near = null, nearAsked = -1, nearPending = false, nearFailed = -1e9;
// the fine version fades in over the light one, and out again when let go, so the change of detail is never a jump
const NEAR_FADE = 450;
let leaving = null;
function dropNear(fade = false) {
  if (!near) return;
  if (leaving) leaving.tissue.dispose();
  leaving = fade && !reduce ? { ...near, at: performance.now() } : null;
  if (!leaving) near.tissue.dispose();
  near = null; wake();
}
async function focusNear(i) {
  nearAsked = i;
  if (i < 0 || !SH) { dropNear(true); return; }
  const ties = nbrs[i].slice().sort((a, b) => b[1] - a[1]).map(([j]) => j);
  const list = [...new Set([i, ...ties])].slice(0, NEAR_MOST);
  const at = new Map(list.map((g, k) => [g, k]));
  const links = [], linkIds = [];
  D.links.forEach((l, li) => {
    const a = at.get(l.s), b = at.get(l.t);
    if (a !== undefined && b !== undefined) { links.push({ s: a, t: b, w: l.w, rel: l.rel, key: li }); linkIds.push(li); }
  });
  const v3 = (A, g) => [A[g * 3], A[g * 3 + 1], A[g * 3 + 2]];
  const cells = list.map((g) => ({ key: g, p: P[g], kind: D.cells[g].lesson ? 'procedural' : 'episodic', strength: D.cells[g].strength,
    stability: D.cells[g].stability, apex0: v3(SH.apex, g), hillock0: v3(SH.hillock, g), incoming: SH.incoming[g], degree: SH.degree[g] }));
  let out;
  const mine = era;
  nearPending = true;
  try { out = await inWorker({ kind: 'local', cells, links, glyphs: GLYPHS, metrics: atlas.metrics }); }
  catch { nearFailed = performance.now(); return; }              // asked again in a few seconds, never every frame
  finally { nearPending = false; }
  if (nearAsked !== i || !tissue || gone(mine)) return;
  dropNear(true);
  near = { of: i, tissue: new Tissue(gl, atlas, out.data, out.count, { cells: list.length, links: links.length }), cells: list, links: linkIds, at: reduce ? -1e9 : performance.now() };
  wake();
}

let building = null, built = null;
async function build(data, { atOnce = false } = {}) {
  const t0 = performance.now(), mine = era;
  const out = await drawIn(data);
  if (gone(mine)) return;                        // the GPU let go of the context meanwhile (its return draws afresh)
  const worker = Math.round(performance.now() - t0), t1 = performance.now();
  // a drawing replacing one on screen arrives a slice at a time, while the old one goes on; the first is sent at once,
  // and so is one made lighter for a machine that can't keep up (a slice a frame, its slow frames took half a minute)
  const ready = tissue && !atOnce ? await Tissue.load(gl, atlas, out.data, out.count, { cells: data.cells.length, links: data.links.length, blocks: out.blocks }) : null;
  if (gone(mine)) return;
  apply(data, out, { worker, ...(ready ? { sent: Math.round(performance.now() - t1) } : {}) }, ready);
  keepDrawing(data, out);
}

/* a drawing, made now or kept from before, put on the screen */
function apply(data, out, took = {}, ready = null) {
  const tA = performance.now(), T = (k) => { took[k] = Math.round(performance.now() - tA); };
  const keep = D ? new Map(D.cells.map((c, i) => [c.fullId, i])) : null;
  const open = selected >= 0 && D ? D.cells[selected]?.fullId : null;      // the memory being read, kept through a redraw
  const oldFlash = flash;
  D = data; N = D.cells.length; NL = D.links.length;
  MID = out.mid;
  store.set(LAYOUT_KEY(), Object.fromEntries(D.cells.map((c, i) => [c.id, out.places[i].map((x) => Math.round(x * 1000) / 1000)])));
  T('aStore');
  const t2 = performance.now();
  const next = ready || new Tissue(gl, atlas, out.data, out.count, { cells: N, links: NL, blocks: out.blocks });
  // the drawing it replaces is let go a moment later, not in the frame that swaps them: freeing a few hundred
  // megabytes of GPU memory there held that frame up
  if (tissue) { const old = tissue; setTimeout(() => old.dispose(), 1200); }
  tissue = next;
  took.upload = Math.round(performance.now() - t2);
  T('aTissue');
  R = out.R; P = Array.from({ length: N }, (_, i) => [out.P[i * 3], out.P[i * 3 + 1], out.P[i * 3 + 2]]);
  SH = { apex: out.apex, hillock: out.hillock, incoming: out.incoming, degree: out.degree };
  dropNear(); if (leaving) { leaving.tissue.dispose(); leaving = null; } nearAsked = -1;
  centre = scale(P.reduce(add, [0, 0, 0]), 1 / (N || 1));
  extent = Math.max(0.5, ...P.map((p) => length(sub(p, centre))));
  HOME = homeOf();
  cellOf = new Map(D.cells.map((c, i) => [c.fullId, i]));
  born = D.cells.map((c) => Date.parse(c.born));
  acc = D.cells.map((c) => c.accessibility);
  nbrs = Array.from({ length: N }, () => []);
  strung = Uint8Array.from(D.links, (l) => (l.rel === 'co_activated' && l.w < DRAW_W ? 0 : 1));
  D.links.forEach((l, li) => { nbrs[l.s].push([l.t, l.w, li]); nbrs[l.t].push([l.s, l.w, li]); });
  glow = new Float32Array(N); flash = new Float32Array(N); aim = new Float32Array(N); read = new Float32Array(N);
  LF = new Float32Array(NL); LA = new Float32Array(NL); LT = new Float32Array(NL); LR = new Float32Array(NL);
  fireAt = new Float64Array(N).fill(-1); fireLevel = new Float32Array(N);
  linkAt = new Float64Array(NL).fill(-1); linkLevel = new Float32Array(NL);
  heat = new Float32Array(N); linkHeat = new Float32Array(NL);
  fc = new Float32Array(N); fAim = new Float32Array(N); lc = new Float32Array(NL); lAim = new Float32Array(NL);
  shownG = new Float32Array(N); shownF = new Float32Array(N);
  if (keep && oldFlash) D.cells.forEach((c, i) => { const j = keep.get(c.fullId); if (j !== undefined && j < oldFlash.length) flash[i] = oldFlash[j]; });
  built = { points: out.count, parts: out.detail, budget, ms: out.ms, laidOut: out.laidOut, fresh: out.fresh, at: performance.now(), took };
  window.__built = built;
  // a redraw starts the light over; the memory being read stays read, and lit, wherever its place is now
  if (open) { selected = cellOf.get(open) ?? -1; if (selected >= 0) spread(selected, performance.now()); }
  if (hoverCell >= N) hoverCell = -1;
  T('aBefore'); mapRegions(out.places); T('aRegions');
  pointed = -2;                                    // drawn again: what's lit is worked out afresh
}

/* ---------- the drawing, kept ----------
 * Making the drawing is the slow part: a few seconds on a quiet machine, many more on a busy one. So the last one is
 * kept in this browser (IndexedDB, one per mind, a few hundred megabytes at most, written and read in a fraction of a
 * second), and the page opens on it at once. When the memory has changed since, the kept one still opens the page,
 * and a fresh one is made behind it and takes its place. Kept with the code's own version and this screen's budget: a
 * drawing made by other code, or for another screen, is made again. A convenience only; without it, the page draws. */
const DRAWING_V = '2026-11-01.6';   // once-only links unstrung at rest; lines and bodies by blocks of space; regions apart
const kept = (() => {
  let opening = null;
  const db = () => opening || (opening = new Promise((res, rej) => {
    const r = indexedDB.open('mnemos-mind', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('drawings');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const call = async (mode, act) => {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction('drawings', mode), q = act(tx.objectStore('drawings'));
      tx.oncomplete = () => res(q?.result); tx.onerror = tx.onabort = () => rej(tx.error);
    });
  };
  return { get: (k) => call('readonly', (st) => st.get(k)), put: (k, v) => call('readwrite', (st) => st.put(v, k)) };
})();
const drawingKey = () => `${L.identity.agentId || AGENT || 'agent'}`;
const KEEP_EVERY = 10 * 60_000;
let keptAt = -Infinity;
function keepDrawing(data, out) {
  // when the page is idle and no one's moving the mind, and never on the page's thread: copying the points here took
  // a frame or more (150 ms as an array, 90 to 130 as a Blob)
  // Kept at most every KEEP_EVERY: a drawing a few minutes old still opens the page at once, and is made fresh behind
  // it; writing a few hundred megabytes at every redraw was work for nothing.
  if (performance.now() - keptAt < KEEP_EVERY) return;
  const version = memVersion, at = Date.now();
  const keep = () => {
    if (performance.now() - lastNav < 2000 || dragging || fling) return void setTimeout(keep, 1500);
    keptAt = performance.now();
    // handed to a worker of its own, the points moved rather than copied (the GPU has them by now): ./keep.js
    try {
      const w = new Worker(new URL('./keep.js', import.meta.url));
      w.onmessage = w.onerror = () => w.terminate();
      w.postMessage({ key: drawingKey(), record: { v: DRAWING_V, budget, version, at, cells: data.cells, links: data.links, out } }, [out.data.buffer]);
    } catch { /* full, or private: next time it draws again */ }
  };
  setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(keep, { timeout: 8000 }) : keep()), 1500);
}
async function keptDrawing() {
  try {
    const k = await kept.get(drawingKey());
    if (!(k && k.v === DRAWING_V && k.budget === budget && k.out?.count)) return null;
    if (k.out.data instanceof Blob) k.out.data = new Float32Array(await k.out.data.arrayBuffer());
    return k;
  } catch { return null; }
}
/* a kept drawing's memories, as they are now: the same ones in the same places (their order is the drawing's), each
 * with what has changed since (how easy to reach, whether gone quiet); one let go since stays until the next drawing */
function fromKept(k) {
  const now = new Map(mems.map((m) => [m.id, m]));
  const cells = k.cells.map((c) => { const m = now.get(c.id); return m ? { ...c, accessibility: m.acc, state: m.state, recalls: m.recalls } : c; });
  return { cells, links: k.links };
}
/* the drawing put on the screen, when the page opens and when the GPU gives back a lost context: the kept one at once if
 * there is one (and a fresh one made behind it when the memory has changed since), else one made now */
async function drawMind(took = {}) {
  const mine = era, tRead = performance.now(), k = params.has('fresh') ? null : await keptDrawing();
  if (gone(mine)) return;
  if (!k) return build(shape(mems));
  apply(fromKept(k), k.out, { kept: true, read: Math.round(performance.now() - tRead), start: Math.round(tRead), ...took });
  if (k.version !== memVersion) { grown = true; lastRedraw = -Infinity; setTimeout(() => look(true), 2500); }
}

async function readMemories() {
  if (L.memory?.version === memVersion && mems.length) return false;
  try { const m = await json('../data/memories.json'); mems = m.memories; memVersion = m.version; recallLog = m.recalled || []; memAt = new Map(mems.map((x, i) => [x.id, i])); return true; }
  catch { return false; }                      // the next look will try again
}

/* ---------- warmth: each hour's path, cooling since that hour ended ---------- */

let warmth = 0, lastHour = null;
const pathOf = (h) => {
  const t = h.trail || { woke: [], waiting: [], reached: [] };
  const idx = (ids) => (ids || []).map((id) => cellOf.get(id)).filter((i) => i !== undefined);
  return { woke: idx(t.woke), waiting: idx(t.waiting), reached: idx(t.reached) };
};
function warm() {
  if (!heat) return;
  heat.fill(0); linkHeat.fill(0);
  // light adds the way light does: two hours on the same memory make it warmer, never more than white
  for (const h of L.hours) {
    const k = temperature(h);
    if (k < 0.01) continue;
    const p = pathOf(h);
    const touch = (i, level) => { heat[i] = 1 - (1 - heat[i]) * (1 - level * k); };
    for (const i of p.woke) touch(i, 0.42);
    for (const i of p.waiting) touch(i, 0.55);
    for (const i of p.reached) touch(i, 1);
  }
  for (let li = 0; li < NL; li++) {
    const l = D.links[li];
    if (heat[l.s] > 0.02 && heat[l.t] > 0.02) linkHeat[li] = Math.min(heat[l.s], heat[l.t]);
  }
  lastHour = L.hours[0] || null;
  warmth = temperature(lastHour);
  wake();
}

/* ---------- light ---------- */

let selected = -1, hoverCell = -1, holdUntil = 0;
const arrived = new Map();                     // memories new since the last visit, or made while the page is open
const cellRest = (i) => DIM * (D.cells[i].state === 'dormant' ? 0.035 : 0.06 + 0.5 * acc[i] ** 1.8);
const linkRest = (li) => DIM * 0.6 * (0.026 + 0.05 * D.links[li].w);

function spread(i, now, gain = 1) {
  fireAt[i] = now; fireLevel[i] = Math.max(fireLevel[i], gain);
  for (const [j, w, li] of nbrs[i]) {
    const t = now + 200 + 320 * (1 - w);
    if (fireAt[j] < 0 || t < fireAt[j]) { fireAt[j] = t; fireLevel[j] = (0.5 + 0.4 * w) * gain; }
    linkAt[li] = now + 30; linkLevel[li] = gain;
  }
  wake();
}
let animating = true;                          // whether anything is moving fast enough to need every frame
function paint(now) {
  let moving = false;
  for (let i = 0; i < N; i++) {
    glow[i] = cellRest(i);
    let a = heat[i] * 0.92;
    const t = arrived.get(D.cells[i].fullId);
    if (t !== undefined) { a = Math.max(a, reduce ? 0.55 : 0.95 * Math.exp(-(now - t) / 12000) + 0.2); if (now - t < 40000) moving = true; }
    if (fireAt[i] >= 0) {
      moving = true;
      if (now >= fireAt[i]) {
        const hold = now < holdUntil ? 1e9 : 1700, age = now - fireAt[i];
        const k = i === selected ? 1 : age < hold ? 1 : Math.max(0, 1 - Math.max(age - hold, now - holdUntil) / 1800);
        a = Math.max(a, fireLevel[i] * k);
        if (k <= 0) { fireAt[i] = -1; fireLevel[i] = 0; }
      }
    }
    if (Math.abs(flash[i] - a) > 2e-3) moving = true;      // still easing toward its light
    aim[i] = a;
  }
  for (let li = 0; li < NL; li++) {
    LR[li] = linkRest(li);
    let front = 0, amount = 0, trail = 0;
    if (linkHeat[li] > 0) { front = 1; amount = 0.7 * linkHeat[li]; trail = 0.4; }
    if (linkAt[li] >= 0) {
      moving = true;
      if (now >= linkAt[li]) {
        const age = now - linkAt[li], k = age < 1900 || now < holdUntil ? 1 : Math.max(0, 1 - (age - 1900) / 1500);
        front = Math.max(front, clamp(age / 820, 0, 1)); amount = Math.max(amount, linkLevel[li] * k); trail = 0.4;
        if (k <= 0) { linkAt[li] = -1; linkLevel[li] = 0; }
      }
    }
    LF[li] = front; LA[li] = amount; LT[li] = trail;
  }
  for (let i = 0; i < N; i++) if (Math.abs((i === selected ? 1 : 0) - read[i]) > 2e-3 || Math.abs(fAim[i] - fc[i]) > 2e-3) { moving = true; break; }
  if (Math.abs((lit() !== -1 ? 1 : 0) - dimNow) > 2e-3) moving = true;
  animating = moving;
}

/* the arrival: the last hour's path walked again, in the order it was walked, then left at its temperature */
function walk(h, delay = 900) {
  if (!h || reduce) return;
  const p = pathOf(h), now = performance.now();
  const steps = [...p.woke.map((i) => [i, 0.6]), ...p.waiting.map((i) => [i, 0.75]), ...p.reached.map((i) => [i, 1])];
  if (!steps.length) return;
  steps.forEach(([i, level], k) => {
    const t = now + delay + k * 260;
    fireAt[i] = t; fireLevel[i] = Math.max(level, heat[i]);
    for (const [, , li] of nbrs[i]) if (heat[D.links[li].s] > 0 && heat[D.links[li].t] > 0) { linkAt[li] = t + 120; linkLevel[li] = 0.9; }
  });
  holdUntil = now + delay + steps.length * 260 + 1400;
  // the mind turns a little toward where it went, then lets go
  const c = scale(steps.map(([i]) => P[i]).reduce(add, [0, 0, 0]), 1 / steps.length);
  meet = { target: mixv(centre, c, 0.35), dist: HOME * 0.86, until: holdUntil + 2600 };
  stir();
}

/* ---------- the camera: it orbits what it looks at ---------- */

let cam, dragging = null, lastInput = -1e9, lastStir = performance.now(), view = null, meet = null;
const stir = () => { lastStir = performance.now(); wake(); };    // something happened: turn again for a while
const backOf = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
const eyeOf = (c) => add(c.target, scale(backOf(c.yaw, c.pitch), c.dist));
function project(p) {
  const W = innerWidth, H = innerHeight, t = Math.tan(FOV / 2), v = sub(p, view.eye), z = dot(v, view.fwd);
  if (z <= 0.02) return null;
  return { x: ((dot(v, view.right) / (z * t * (W / H)) + 1) / 2) * W, y: ((1 - dot(v, view.up) / (z * t)) / 2) * H, z };
}
function pick(x, y, keep = -1) {
  if (!view) return -1;
  let best = -1, bd = Infinity;
  for (let i = 0; i < N; i++) {
    const s = project(P[i]); if (!s) continue;
    const r = Math.max(9, ((R[i] * 1.2) / (s.z * Math.tan(FOV / 2))) * (innerHeight / 2));
    const d = Math.hypot(s.x - x, s.y - y) / r;
    if (i === keep && d < 1.35) return i;          // what you're already on holds a little past its edge: no flicker
    if (d < 1 && d < bd) { bd = d; best = i; }
  }
  return best;
}
// a memory opened is come up close to (never farther than a few memories' widths); with the reading room open, what
// you're reading sits in the middle of what's left of the screen
function aimAt(i) {
  const sheet = sheetOpen && innerWidth > 860 ? Math.min(SHEET, innerWidth) : 0;
  const dist = clamp(cam.goal.dist, 0.9, Math.min(extent * 1.2, 5.2));
  const right = view ? view.right : [1, 0, 0];
  const perPx = (2 * dist * Math.tan(FOV / 2)) / innerHeight;
  cam.goal.target = add(P[i], scale(right, (sheet / 2) * perPx));
  cam.goal.dist = dist;
  lastNav = -1e9; moved(false);
  stir();
}

/* ---------- pointing: what you point at lights, with all it's tied to, and the rest goes quiet ----------
 * Each memory carries how much it's being pointed at (fc, easing toward fAim), and each link the same (lc). The memory
 * under the hand aims for all of it, those it's tied to for more the stronger the tie, and the links between them for
 * as much as the memory at their far end. Everything else is dimmed by how much the hand is on anything at all
 * (dimNow), so moving from one memory to the next never flashes the whole mind back up between them. */
const QUIET = 0.74, QUIET_OPEN = 0.88, LIT_G = 0.5, LIT_F = 0.95, LIT_L = 0.8;
// what's lit: the memory open, and with none open, the one under the hand
// (a region's name under the hand lights the region: its key is -10 - k; a moment of recall chosen under the hour, its
// memories: MOMENT - k)
const MOMENT = -100000;
const lit = () => (selected >= 0 ? selected : hoverCell >= 0 ? hoverCell : regionLit >= 0 ? -10 - regionLit : tracePicked >= 0 ? MOMENT - tracePicked : -1);
let pointed = -1;
let dimNow = 0, aimed = [], aimedLinks = [];
function pointAt(i) {
  for (const j of aimed) fAim[j] = 0;
  for (const li of aimedLinks) lAim[li] = 0;
  aimed = []; aimedLinks = [];
  if (i <= MOMENT) {
    // a moment of recall seen again: what came back together, and the links among them, and nothing else
    const m = moments[MOMENT - i];
    if (!m) return;
    const among = new Set(m.ids.map((id) => cellOf.get(id)).filter((c) => c !== undefined));
    for (const c of among) {
      fAim[c] = 1; aimed.push(c);
      for (const [j, w, li] of nbrs[c]) if (among.has(j)) { lAim[li] = 0.6 + 0.4 * w; aimedLinks.push(li); }
    }
    return;
  }
  if (i <= -10) {
    // a region: its memories, the links among them, and brighter, the links that leave it: where it reaches
    const k = -10 - i, g = regions.find((r) => r.k === k);
    if (!g) return;
    for (const c of g.cells) {
      fAim[c] = 0.62; aimed.push(c);
      for (const [j, , li] of nbrs[c]) { lAim[li] = Math.max(lAim[li], regionOf[j] === k ? 0.22 : 0.16); aimedLinks.push(li); }
    }
    return;
  }
  if (i < 0 || i >= N) return;
  fAim[i] = 1; aimed.push(i);
  // only ties that can be seen as lines: under the hand, those strung at rest; a memory open, those its fine version
  // draws (its strongest, NEAR_MOST in all). A tie lit without a line to it reads as a stray light, not a connection
  const ties = i === selected ? nbrs[i].slice().sort((a, b) => b[1] - a[1]).slice(0, NEAR_MOST - 1) : nbrs[i].filter(([, , li]) => strung[li]);
  for (const [j, w, li] of ties) { fAim[j] = Math.max(fAim[j], 0.45 + 0.4 * w); aimed.push(j); lAim[li] = 0.55 + 0.45 * w; aimedLinks.push(li); }
}
function hover(i) {
  if (selected >= 0) i = -1;                       // with a memory open, moving around stays calm: pointing lights nothing
  if (i === hoverCell) return;
  hoverCell = i; wake();
}

/* ---------- the camera in your hands ----------
 * Turning (drag), sliding (shift-drag, a right or middle drag, two fingers), and coming closer (the wheel, a pinch,
 * + and -). Coming closer is a scaling of the whole camera about the point under the hand: the eye moves along the
 * line through that point, so the point stays exactly where it is on the screen, whatever its depth. Going back out
 * drifts the camera home to the middle, so you're never lost; Recenter (or 0) goes straight there. Every input only
 * moves where the camera is going; one loop eases it there (fast while your hand is on it, slow when it moves itself),
 * and a turn or slide let go carries on a little and settles. Close enough to a memory, it's drawn finely. */
const ZMIN = 0.42, ZOUT = 1.7;
let lastNav = -1e9, fling = null, wheelPage = -1e9, wandered = false;
const tanH = Math.tan(FOV / 2);
function basis(c) {
  const eye = eyeOf(c), fwd = normalize(sub(c.target, eye)), right = normalize(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
  return { eye, fwd, right, up };
}
// where the hand points, in the mind: the memory under it if there is one, else the point at the target's depth
function under(x, y) {
  if (hoverCell >= 0) return P[hoverCell];
  const b = basis(cam.goal), nx = (x / innerWidth) * 2 - 1, ny = 1 - (y / innerHeight) * 2;
  const dir = add(b.fwd, add(scale(b.right, nx * tanH * (innerWidth / innerHeight)), scale(b.up, ny * tanH)));
  return add(b.eye, scale(dir, cam.goal.dist));            // dir's forward part is 1, so this lands on that plane
}
function moved(on = true) {
  wandered = on; $('recenter').classList.toggle('on', on);
  $('recenter').tabIndex = on ? 0 : -1;
}
function nav() { lastNav = performance.now(); lastInput = lastNav; meet = null; if (!wandered) moved(true); stir(); }
function zoomAt(x, y, k) {
  const g = cam.goal, d = clamp(g.dist * k, ZMIN, HOME * ZOUT), s = d / g.dist;
  if (Math.abs(s - 1) < 1e-5) return;
  const Q = under(x, y);
  g.target = add(Q, scale(sub(g.target, Q), s)); g.dist = d;
  // going out past a close look, the camera drifts home as it goes: all the way out, it's back in the middle
  if (s > 1) g.target = mixv(g.target, centre, clamp((d - HOME * 0.55) / (HOME * 0.5)) * (1 - 1 / s) * 1.6);
  nav();
}
function slide(dx, dy) {
  const b = basis(cam.goal), perPx = (2 * cam.goal.dist * tanH) / innerHeight;
  cam.goal.target = add(cam.goal.target, add(scale(b.right, -dx * perPx), scale(b.up, dy * perPx)));
}
function turn(dx, dy) {
  cam.goal.yaw -= dx * 0.005;
  cam.goal.pitch = clamp(cam.goal.pitch + dy * 0.004, -1.2, 1.2);
}
function recenter() {
  cam.goal.target = centre.slice(); cam.goal.dist = HOME; fling = null; lastNav = -1e9; moved(false); stir();
  letGo();                                       // the moment you went to see is let go with the view
}
// a moment of recall shown is let go (with the view, Escape, or a click in the dark): its light, and its mark
function letGo() { if (tracePicked >= 0) { tracePicked = -1; showTrace(-1); wake(); } }
// how close you've come, read beside the way back: the whole mind from home is ×1
let magShown = '';
function readMag() {
  if (!wandered) return;
  const k = HOME / cam.dist, s = k >= 9.95 ? String(Math.round(k)) : k.toFixed(1);
  if (s !== magShown) { magShown = s; $('mag').textContent = `×${s}`; }
}

function bindPointer() {
  const touches = new Map();
  let pinch = null, mouse = null;
  const twoOf = () => { const [a, b] = [...touches.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    fling = null;
    if (touches.size === 2) { pinch = twoOf(); dragging = null; return; }
    const sliding = e.shiftKey || e.button === 1 || e.button === 2;
    dragging = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), sliding, vx: 0, vy: 0, at: performance.now() };
    canvas.classList.add('dragging'); lastInput = performance.now(); stir();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      const now = twoOf();
      if (now.d > 0 && pinch.d > 0) zoomAt(now.x, now.y, pinch.d / now.d);
      slide(now.x - pinch.x, now.y - pinch.y);
      pinch = now; return;
    }
    if (!dragging) {
      if (e.pointerType === 'mouse') { mouse = { x: e.clientX, y: e.clientY }; const h = pick(e.clientX, e.clientY, hoverCell); hover(h); canvas.style.cursor = h >= 0 ? 'pointer' : ''; }
      return;
    }
    const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y, t = performance.now(), dt = Math.max(1, t - dragging.at);
    if (dragging.sliding) slide(dx, dy);
    else { cam.goal.yaw -= dx * 0.005; if (e.pointerType === 'mouse') cam.goal.pitch = clamp(cam.goal.pitch + dy * 0.004, -1.2, 1.2); }
    // how fast the hand is going, smoothed over the last few moves, for the carry when it lets go
    dragging.vx = dragging.vx * 0.6 + (dx / dt) * 0.4; dragging.vy = dragging.vy * 0.6 + (dy / dt) * 0.4;
    dragging.x = e.clientX; dragging.y = e.clientY; dragging.at = t;
    if (Math.hypot(e.clientX - dragging.x0, e.clientY - dragging.y0) >= 6) { if (hoverCell >= 0) hover(-1); nav(); }
  });
  const drop = (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (dragging && e?.type === 'pointerup' && Math.hypot(e.clientX - dragging.x0, e.clientY - dragging.y0) < 6 && performance.now() - dragging.t0 < 450) {
      const c = pick(e.clientX, e.clientY);
      if (c >= 0 && memAt.has(D.cells[c].fullId)) openRoom({ tab: 'memories', memory: D.cells[c].fullId });
      else if (c < 0) letGo();
    } else if (dragging && performance.now() - dragging.at < 80 && !reduce) {
      // let go while moving: it carries on, slowing as if through something thick
      fling = { vx: dragging.vx * 1000, vy: (e.pointerType === 'mouse' || dragging.sliding ? dragging.vy : 0) * 1000, sliding: dragging.sliding };
    }
    dragging = null; canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', drop); canvas.addEventListener('pointercancel', drop);
  canvas.addEventListener('pointerleave', () => { mouse = null; if (!dragging) hover(-1); });
  // the wheel and a pinch come closer, toward the hand. While the page is scrolled down to what the hour left, the
  // wheel scrolls it, and a scroll that carries on up to the top doesn't turn into a zoom until the hand lifts
  canvas.addEventListener('wheel', (e) => {
    const t = performance.now();
    if (!e.ctrlKey && (scrollY > 2 || t - wheelPage < 260)) { wheelPage = t; return; }
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1, dy = e.deltaY * unit, dx = e.deltaX * unit;
    if (!e.ctrlKey && Math.abs(dx) > Math.abs(dy) * 1.2) { cam.goal.yaw -= dx * 0.004; nav(); return; }
    zoomAt(e.clientX, e.clientY, Math.exp(clamp(dy, -240, 240) * (e.ctrlKey ? 0.011 : 0.0022)));
  }, { passive: false });
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.activeElement?.closest?.('#room, dialog') || scrollY > innerHeight * 0.5) return;
    const x = mouse?.x ?? innerWidth / 2, y = mouse?.y ?? innerHeight / 2;
    if (e.key === '+' || e.key === '=') zoomAt(x, y, 0.8);
    else if (e.key === '-' || e.key === '_') zoomAt(x, y, 1.25);
    else if (e.key === '0') recenter();
    else if (e.key.startsWith('Arrow')) {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (e.shiftKey) slide(-d[0] * 60, -d[1] * 60); else turn(d[0] * 40, d[1] * 30);
      nav();
    } else return;
    e.preventDefault();
  });
  $('recenter').addEventListener('click', recenter);
  // the hand still over the mind while it turns: what's under it changes, so look again
  pointing = () => { if (mouse && !dragging) hover(pick(mouse.x, mouse.y, hoverCell)); };
}
let pointing = () => {};

/* close enough to a memory, with none open, the one in the middle of the view is drawn finely, with its ties */
let closeTo = -1, closeSince = 0;
function nearWanted(now) {
  if (selected >= 0) return selected;
  if (cam.goal.dist > Math.min(2.4, HOME * 0.45)) return closeTo = -1;
  if (now - closeSince < 350) return closeTo;
  closeSince = now;
  let best = -1, bd = Infinity;
  for (let i = 0; i < N; i++) { const d = length(sub(P[i], cam.goal.target)); if (d < bd) { bd = d; best = i; } }
  return closeTo = bd < cam.goal.dist * 0.6 ? best : -1;
}

/* ---------- its regions, named ----------
 * The layout gives each concern a place of its own (./build.js); here each is named in its own words
 * (../shared/regions.js) and the names are set over the mind like a chart's names for its constellations: the
 * biggest from across the room, more of them as you come closer, none where one would cover another or the frame's own
 * words, none with a memory open or a moment of recall shown. A name under the hand lights its region and where it
 * reaches; a name clicked goes there. */
let regions = [], regionOf = new Int32Array(0), regionLit = -1, regionsNamed = '';
function mapRegions(places) {
  regionOf = Int32Array.from(places, (p) => (p[3] ?? -1));
  const K = Math.max(-1, ...regionOf) + 1, cells = Array.from({ length: K }, () => []);
  regionOf.forEach((k, i) => { if (k >= 0) cells[k].push(i); });
  const old = new Map(regions.map((g) => [g.k, g]));
  regions = cells.map((list, k) => {
    if (list.length < 6) return null;
    const c = scale(list.reduce((s, i) => add(s, P[i]), [0, 0, 0]), 1 / list.length);
    const d = list.map((i) => length(sub(P[i], c))).sort((x, y) => x - y);
    const g = old.get(k) || { k, el: null, on: false, name: '', words: [] };
    return Object.assign(g, { cells: list, n: list.length, c, r: d[Math.floor(d.length * 0.85)] || 0.5 });
  }).filter(Boolean).sort((a, b) => b.n - a.n);
  for (const g of old.values()) if (!regions.includes(g)) g.el?.remove();
  if (regionLit >= 0 && !regions.some((g) => g.k === regionLit)) regionLit = -1;
  // naming reads every memory's words: a few dozen milliseconds, done when the page is idle, and again only when
  // the memories or their regions change
  const key = `${memVersion}:${K}:${N}`;
  if (key === regionsNamed) return;
  regionsNamed = key;
  const name = () => {
    const words = D.cells.map((c) => mems[memAt.get(c.fullId)] || { content: '' });
    const named = nameRegions(words, Array.from(regionOf), [L.identity.name, L.identity.person?.name, L.identity.person, 'Claude']);
    for (const g of regions) { const r = named[g.k]; if (r) { g.name = r.name; g.words = r.words; } labelOf(g); }
    wake();
  };
  window.requestIdleCallback ? requestIdleCallback(name, { timeout: 3000 }) : setTimeout(name, 200);
}
function labelOf(g) {
  if (!g.name) return;
  if (!g.el) {
    g.el = document.createElement('button');
    g.el.className = 'region'; g.el.type = 'button'; g.el.tabIndex = -1;
    g.el.addEventListener('pointerenter', () => { regionLit = g.k; wake(); });
    g.el.addEventListener('pointerleave', () => { if (regionLit === g.k) { regionLit = -1; wake(); } });
    g.el.addEventListener('focus', () => { regionLit = g.k; wake(); });
    g.el.addEventListener('blur', () => { if (regionLit === g.k) { regionLit = -1; wake(); } });
    g.el.addEventListener('click', () => flyTo(g));
    $('regions').appendChild(g.el);
  }
  g.el.innerHTML = `<span class="nm">${esc(g.name)}</span><span class="ct">${g.n.toLocaleString('en-US')}</span>${g.words.length ? `<span class="wd">${g.words.map(esc).join(' · ')}</span>` : ''}`;
  g.el.setAttribute('aria-label', `${g.name}: ${plural(g.n, 'memory', 'memories')}${g.words.length ? `, about ${g.words.join(', ')}` : ''}. Go there`);
  g.w = 0;
}
function flyTo(g) {
  hover(-1); fling = null; meet = null;
  cam.goal.target = g.c.slice(); cam.goal.dist = clamp((g.r / tanH) * 1.5, ZMIN, HOME * ZOUT);
  lastNav = -1e9; moved(true); stir();
}
// the frame's own words over the mind, where they sit on the page with a little room around them: no name is set over
// them. They're measured when they change size and when the window does, not every frame
let clear = [];
function measureClear() {
  const y = scrollY;
  clear = [...document.querySelectorAll('.hero > .ui')].map((el) => el.getBoundingClientRect())
    .filter((r) => r.width && r.height).map((r) => [r.left - 16, r.top + y - 12, r.right + 16, r.bottom + y + 12]);
  wake();
}
function keepClear() {
  const watch = new ResizeObserver(measureClear);
  document.querySelectorAll('.hero > .ui').forEach((el) => watch.observe(el));
  addEventListener('resize', measureClear);
}
function placeRegions() {
  if (!regions.length) return;
  const W = innerWidth, H = innerHeight, y0 = scrollY, covered = sheetOpen && W > 860 ? Math.min(SHEET, W) + 20 : 0, placed = [];
  // from across the room only the big regions are named; coming closer, smaller ones are
  const fewest = Math.max(6, Math.round(44 * (cam.dist / HOME) ** 2));
  for (const g of regions) {
    let on = false;
    if (g.el && selected < 0 && tracePicked < 0 && g.n >= fewest) {
      const s = project(g.c);
      if (s) {
        if (!g.w) g.w = g.el.offsetWidth || g.name.length * 8 + 40;
        const rs = (g.r / (s.z * tanH)) * (H / 2), x = s.x, y = s.y, w = g.w;
        on = rs > 34 && rs < H * 0.8 && x - w / 2 > 12 && x + w / 2 < W - covered - 12 && y > 110 && y < H - 90
          && !clear.some(([l, t, r, b]) => x + w / 2 > l && x - w / 2 < r && y + 13 > t - y0 && y - 13 < b - y0);
        for (let b = 0; on && b < placed.length; b++) if (Math.abs(placed[b][0] - x) < (placed[b][2] + w) / 2 + 12 && Math.abs(placed[b][1] - y) < 34) on = false;
        if (on) {
          placed.push([x, y, w]);
          const t = `${Math.round(x - w / 2)}px ${Math.round(y - 13)}px`;
          if (g.el.style.translate !== t) g.el.style.translate = t;
        }
      }
    }
    if (on !== g.on || (!on && regionLit === g.k)) {
      g.on = on; g.el?.classList.toggle('on', on);
      if (g.el) g.el.tabIndex = on ? 0 : -1;
      if (!on && regionLit === g.k) regionLit = -1;
    }
  }
}

/* ---------- resolution and the loop ---------- */

let post = null, heroSeen = true;
/* how far back the whole mind is seen: further for a tall window, so it fits across (a window with no size yet is
 * framed for its screen until it has one) */
function homeOf() {
  const aspect = innerWidth && innerHeight ? innerWidth / innerHeight : screen.width / screen.height;
  return extent * 3.35 * Math.min(1.8, Math.max(1, 0.85 / aspect));
}
function resize() {
  // a page opened where it can't be seen (a hidden pane) has no size yet; it starts on the resize that gives it one
  if (!innerWidth || !innerHeight) return;
  if (lost || aside) return;                     // nothing is made on a lost context (its return sizes everything), or set aside
  // seen whole, it's seen whole again when the window changes shape; a view you chose stays yours
  const was = HOME; HOME = homeOf();
  if (cam && !wandered && selected < 0 && cam.goal.dist === was) cam.goal.dist = HOME;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const renderScale = clamp(Math.sqrt(LENS.pixels / (innerWidth * innerHeight * dpr ** 2)), 0.25, 1);
  const w = Math.round(innerWidth * dpr * renderScale), h = Math.round(innerHeight * dpr * renderScale);
  if (canvas.width === w && canvas.height === h && post) return;
  canvas.width = w; canvas.height = h;
  if (post) post.dispose();
  post = new Post(gl, w, h, 7, { accum: params.get('accum') === '16' ? 'RGBA16F' : gl.accum });
  wake();
}
new IntersectionObserver(([e]) => { heroSeen = e.isIntersecting; if (heroSeen) wake(); }, { threshold: 0.02 }).observe($('hero'));

/* The loop runs only while something moves: light travelling, a memory arriving, a hand on it, the camera settling.
 * The slow turn goes on for 30 seconds after you last touched it, at 15 frames a second, then eases to a stop, and
 * the loop sleeps until something wakes it. Under the paper the mind isn't seen, so it doesn't draw. While it runs
 * it watches its own frames, and a machine that can't keep up is asked for less (see lighten). */
let last = performance.now(), frames = 0, looping = false, slow = [], slowFor = 0, shownAt = 0, spin = 1;
let offered = 0, pacing = null;
// the frame after a hidden page isn't slow, and a question asked before it was hidden is asked again
document.addEventListener('visibilitychange', () => { shownAt = performance.now(); pacing = null; });
function wake() { if (!looping && !aside && tissue && cam && post) { looping = true; last = performance.now(); requestAnimationFrame(frame); } }

/* A machine that can't keep up is asked for less, a step at a time, each step kept for this screen: first fewer points
 * (a single step: asked for fewer than LIGHTEST, the drawing hardly shrinks, as its lines are always drawn whole), then
 * a quarter of the pixels. When even that is well behind, the mind stands aside rather than freeze its page; the next
 * visit tries again, from the lightest. */
const LIGHTEST = 1_200_000, FEWEST_PIXELS = 1.3e6;
let aside = false;
const gone = (mine) => mine !== era || lost || aside;   // work begun for a drawing that's no longer wanted
async function lighten(late) {
  if (building || aside) return;
  if (budget > LIGHTEST) {
    budget = LIGHTEST; store.set(BUDGET_KEY, budget);
    try { building = build(D, { atOnce: true }); await building; } catch { /* the drawing on screen stays */ } finally { building = null; }
    warm(); wake();
  } else if (LENS.pixels > FEWEST_PIXELS) {
    LENS.pixels = FEWEST_PIXELS; store.set(PIXELS_KEY, LENS.pixels); resize();
  } else if (late > 2.5) standAside();
}
/* the mind set aside: its drawing given back to the GPU, and said so where it was; the rest of the page (the reading
 * room, the search, the hours below) goes on without it */
function standAside() {
  aside = true; looping = false;
  dropNear(); if (leaving) { leaving.tissue.dispose(); leaving = null; }
  tissue?.dispose(); tissue = null; post?.dispose(); post = null;
  document.body.classList.add('set-aside');      // and what belongs to it: its region names, the way back to centre
  toNotebook('cannot');
  const note = document.createElement('div');
  note.className = 'aside'; note.setAttribute('role', 'status');
  note.innerHTML = `<span>This computer’s graphics can’t move the mind smoothly. Everything in it is in <a class="textlink" href="${esc(withAgent('../log/'))}">the log</a>.</span>`;
  $('hero').append(note);
}

/* Late frames aren't always the drawing's fault: a browser saving a battery offers 30 frames a second however light the
 * mind is, and would have it made sparse and soft for good. So before it's made lighter, the browser is asked its own
 * pace, a few frames drawn with nothing, and the frames count as late only against what it could have given. */
const lateness = (samples) => { const r = samples.map(([took, gap]) => took / Math.max(gap, offered)).sort((a, b) => a - b); return r[r.length >> 1]; };
function askPace(now) {
  pacing.at.push(now);
  if (pacing.at.length < 10) { requestAnimationFrame(frame); return true; }
  // the first few may still hold the last drawing's work
  const gaps = pacing.at.slice(4).map((t, i) => t - pacing.at[i + 3]).sort((a, b) => a - b);
  offered = gaps[gaps.length >> 1];
  const late = lateness(pacing.samples);
  pacing = null; last = now - 1000 / 60;
  if (late > 1.45) lighten(late);
  return aside;
}

/* ---------- when the GPU takes the drawing back ----------
 * A sleep, a driver's reset or too many pages drawing at once can lose the context, and everything made on it goes
 * with it. The page asks for it back, and when it comes, makes it all again: the kept drawing reopens it in a moment
 * (else a fresh one is made), and the view carries on where it was, an opened memory still open. Should the browser
 * never give it back, the page says so. `era` counts losses and returns, so work begun on a context that's gone is let
 * go rather than drawn. */
let lost = false, era = 0, lostNote = 0;
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();                            // without this, the context is never given back
  lost = true; era++; looping = false;
  lostNote = setTimeout(() => {
    // said where the page says how it is, under its name: never under the drawer
    const note = document.createElement('small');
    note.id = 'lost'; note.setAttribute('role', 'status');
    note.textContent = 'The graphics card let the mind go. Reload the page to bring it back.';
    document.querySelector('.who').append(note);
  }, 6000);
});
canvas.addEventListener('webglcontextrestored', async () => {
  clearTimeout(lostNote); $('lost')?.remove();
  const mine = ++era;
  if (aside) { lost = false; return; }           // set aside, it stays aside
  prepare(gl); lost = false;
  tissue = null; near = null; leaving = null; post = null; nearAsked = -1;   // theirs went with the context
  meterOk = undefined; meterBuf = null; meterSync = null; meterOf = null;
  atlas = await glyphAtlas(gl, ATLAS, { cell: 112 });
  if (mine !== era) return;                      // lost again meanwhile: its next return starts over
  resize();
  try { building = drawMind({ regained: true }); await building; } catch { /* the next look draws it */ } finally { building = null; }
  warm(); wake();
});

function frame(now) {
  if (!heroSeen || lost || aside) { looping = false; pacing = null; return; }
  if (pacing && askPace(now)) return;
  // covered, it goes on turning, slower and at a few frames a second, so something is moving behind the glass
  const turning = !reduce && selected < 0 && hoverCell < 0 && regionLit < 0 && !dragging && !fling && (covered || now - lastStir < TURN_FOR);
  spin += ((turning ? 1 : 0) - spin) * 0.02;                       // the turn eases in and out rather than stopping dead
  const settled = !dragging && Math.abs(cam.goal.yaw - cam.yaw) < 1e-4 && Math.abs(cam.goal.pitch - cam.pitch) < 1e-4
    && Math.abs(Math.log(cam.goal.dist / cam.dist)) < 1e-4 && length(sub(cam.goal.target, cam.target)) < 1e-4;
  if (!animating && settled && spin < 0.01 && !meet && !fling && frames > 2) { looping = false; return; }
  // never more than 60 frames a second, whatever the screen offers: a 120 or 240 Hz screen asks for two to four times
  // that, which for a mind moving this softly is heat and nothing you'd see. The slow turn alone, 15: it moves less
  // than a pixel a frame, and from across the room every frame is the whole mind, the costliest frame there is
  const gap = covered ? 250 : !animating && !dragging && now - lastInput > 1500 ? 66 : 1000 / 60;
  if (now - last < gap - 1.5) {
    // covered, it rests between frames rather than ask the screen hundreds of times a second whether it's time yet
    if (covered) setTimeout(() => requestAnimationFrame(frame), gap - (now - last)); else requestAnimationFrame(frame);
    return;
  }
  const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
  // each frame against the pace it asked for, slow ones too (counted only below a quarter second, a machine far too
  // slow never saw itself as slow): a second and a half of them on a quick machine, three seconds on a slow one, tell
  // whether it keeps up. Not while a drawing arrives, nor just after one, nor as the page comes back into view
  if (!building && now - built.at > 1500 && now - shownAt > 1000) {
    slow.push([now - last, gap]); slowFor += now - last;
    if (slow.length >= 90 || (slowFor > 3000 && slow.length >= 2)) {
      if (lateness(slow) > 1.45) pacing = { samples: slow, at: [] };   // whose fault is asked next (see askPace)
      slow = []; slowFor = 0;
    }
  }
  last = now;
  if (meet) {
    // the mind turns toward what it's doing only while you've left it where it was; a view you chose stays yours
    if (now < meet.until) { if (selected < 0 && !wandered && now - lastInput > 1500) { cam.goal.target = meet.target; cam.goal.dist = meet.dist; } }
    else { if (selected < 0 && !wandered) { cam.goal.target = centre.slice(); cam.goal.dist = HOME; } meet = null; }
  }
  if (spin > 0.001) cam.goal.yaw += 0.012 * dt * spin;
  if (fling) {
    if (fling.sliding) slide(fling.vx * dt, fling.vy * dt); else turn(fling.vx * dt, fling.vy * dt);
    const k = Math.exp(-4.5 * dt); fling.vx *= k; fling.vy *= k;
    if (Math.hypot(fling.vx, fling.vy) < 4) fling = null;
  }
  // fast while your hand is on it (and for a moment after), slow when the camera moves itself
  const hand = Math.exp(-(now - lastNav) / 500);
  const ke = 1 - Math.exp(-(dragging ? 21 : 2.2 + 9.8 * Math.max(hand, fling ? 1 : 0)) * dt);
  cam.yaw += (cam.goal.yaw - cam.yaw) * ke; cam.pitch += (cam.goal.pitch - cam.pitch) * ke;
  cam.dist = Math.exp(Math.log(cam.dist) + (Math.log(cam.goal.dist) - Math.log(cam.dist)) * ke);
  cam.target = mixv(cam.target, cam.goal.target, ke);
  const eye = eyeOf(cam), fwd = normalize(sub(cam.target, eye)), right = normalize(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
  view = { eye, fwd, right, up };
  if ((frames & 3) === 0) pointing();
  placeRegions(); readMag();
  const close = clamp((HOME * 0.8 - cam.dist) / (HOME * 0.8 - 0.6));
  paint(now);
  // a memory open is always drawn finely: whatever dropped its fine version (a redraw, a lighter budget, a page that
  // opened straight onto it), it's asked for again
  const want = nearWanted(now);
  if (want >= 0 && !nearPending && !building && (!near || near.of !== want) && now - nearFailed > 4000) focusNear(want);
  else if (want < 0 && near && !nearPending) focusNear(-1);
  const kUp = 1 - Math.exp(-9 * dt), kDown = 1 - Math.exp(-2.2 * dt), kRead = 1 - Math.exp(-3.7 * dt);
  const kIn = 1 - Math.exp(-11 * dt), kOut = 1 - Math.exp(-6 * dt);
  // the memory open (or, with none open, the one under the hand) lights with its ties; the rest of the mind goes
  // quiet, further with a memory open, so where it reaches can be seen
  const on = lit();
  if (on !== pointed) { pointed = on; pointAt(on); }
  dimNow += ((on !== -1 ? 1 : 0) - dimNow) * (on !== -1 ? 1 - Math.exp(-8 * dt) : 1 - Math.exp(-4.5 * dt));
  const quiet = (selected >= 0 ? QUIET_OPEN : QUIET) * dimNow;
  // what else is lit (the last hour's trail, a recall's light travelling) goes out entirely with a memory open, so
  // nothing lit can be mistaken for its own; under the hand it only goes down with the rest
  const hush = (selected >= 0 ? 1 : QUIET) * dimNow;
  for (let i = 0; i < N; i++) {
    flash[i] += (aim[i] - flash[i]) * (aim[i] > flash[i] ? kUp : kDown);
    read[i] += ((i === selected ? 1 : 0) - read[i]) * kRead;
    fc[i] += (fAim[i] - fc[i]) * (fAim[i] > fc[i] ? kIn : kOut);
    const keep = 1 - quiet * (1 - fc[i]);
    shownG[i] = glow[i] * keep + LIT_G * fc[i] * fc[i];
    shownF[i] = flash[i] * (1 - hush * (1 - fc[i])) + LIT_F * fc[i] * (fAim[i] === 1 ? 1 : 0.35);
    tissue.cell(i, shownG[i], shownF[i], 0, read[i]);
  }
  for (let li = 0; li < NL; li++) {
    lc[li] += (lAim[li] - lc[li]) * (lAim[li] > lc[li] ? kIn : kOut);
    const keep = 1 - quiet * (1 - lc[li]), lit = 1 - hush * (1 - lc[li]);
    tissue.link(li, Math.max(LF[li], lc[li] > 1e-3 ? 1 : 0), Math.max(LA[li] * lit, LIT_L * lc[li]), Math.max(LT[li] * lit, 0.4 * lc[li]), LR[li] * keep);
  }
  // the fine versions take their memories' light from the whole, by as much as they've faded in: what arrives,
  // fully; what's being let go, less each frame, until it's gone
  const share = (f, k) => {
    f.cells.forEach((g, c) => { f.tissue.cell(c, shownG[g] * k, shownF[g] * k, 0, read[g]); tissue.cell(g, shownG[g] * (1 - k), shownF[g] * (1 - k), 0, read[g]); });
    f.links.forEach((li, c) => {
      const keep = 1 - quiet * (1 - lc[li]), lit = 1 - hush * (1 - lc[li]);
      const a = Math.max(LF[li], lc[li] > 1e-3 ? 1 : 0), b = Math.max(LA[li] * lit, LIT_L * lc[li]), t = Math.max(LT[li] * lit, 0.4 * lc[li]), r = LR[li] * keep;
      f.tissue.link(c, a, b * k, t * k, r * k); tissue.link(li, a, b * (1 - k), t * (1 - k), r * (1 - k));
    });
  };
  if (leaving) {
    const k = 1 - Math.min(1, (now - leaving.at) / NEAR_FADE);
    if (k <= 0) { leaving.tissue.dispose(); leaving = null; } else { share(leaving, k * k); animating = true; }
  }
  if (near) {
    const k = Math.min(1, (now - near.at) / NEAR_FADE);
    share(near, 1 - (1 - k) * (1 - k));
    if (k < 1) animating = true;
  }
  const viewM = lookAt(eye, cam.target, [0, 1, 0]), proj = perspective(FOV, canvas.width / canvas.height, 0.01, 400);
  const blurK = mix(14 * LENS.blur, 52 * LENS.blurClose, close * close) * (canvas.height / 804);
  post.clear();
  const optics = { view: viewM, proj, focalPx: canvas.height / 2 / Math.tan(FOV / 2), focus: length(sub(cam.target, eye)), blurK, near: 0.02,
    fade: [0.1, 0.34], cocMax: canvas.height * 0.05, cull: mix(0.0002, 0.0016, close), pad: LENS.pad, ...LOOK };
  const q1 = gpuBegin();
  tissue.draw(post.accum, optics);
  if (leaving) leaving.tissue.draw(post.accum, optics);
  if (near) near.tissue.draw(post.accum, optics);
  gpuEnd(q1, 'points'); gpuPoll();
  const q2 = gpuBegin(), exposure = mix(1.0, 0.66, close);
  post.finish({ exposure: exposure * iris, bloom: mix(0.15, 0.08, close) * LENS.bloom, grain: 0.025 * LENS.grain, vignette: 0.34, ca: 0.0015 * LENS.ca }, (frames++ & 0xffff) + 1);
  gpuEnd(q2, 'finish');
  if (!covered) meter(exposure, dt);   // the iris guards words over the mind; covered, there are none, and reading its light back isn't free
  requestAnimationFrame(frame);
}

/* ---------- the iris: the mind's light, metered ----------
 * Like an eye's, or a camera's: the picture's light is metered (its average, from the smallest level of the bloom,
 * read back a frame or two late so the GPU is never waited on), and when the mind fills the view so brightly that the
 * words over it would drown (come right up into a hot mind), the iris closes until it's back under IRIS_AT, over half
 * a second; it opens again as the light goes, over a second, as an eye does. A mind seen whole, a moment of recall
 * shown, a memory opened leave it open; the most-linked memories, lighting all their ties at once, close it a little
 * while they burn. */
const IRIS_AT = 0.07;
let iris = 1, metered = 0, meterOk, meterBuf = null, meterSync = null, meterOf = null, meterPx = null;
function meter(exposure, dt) {
  meterOk ??= !!gl.getExtension('EXT_color_buffer_float');   // a GPU that can't read its light back stays wide open
  if (!meterOk) return;
  const t = post.down[post.down.length - 1];
  if (meterSync) {
    const s = gl.clientWaitSync(meterSync, 0, 0);
    if (s !== gl.TIMEOUT_EXPIRED) {
      gl.deleteSync(meterSync); meterSync = null;
      if (s !== gl.WAIT_FAILED && meterOf === t) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, meterBuf);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, meterPx);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        let sum = 0;
        for (let k = 0; k < meterPx.length; k += 4) sum += 0.2126 * meterPx[k] + 0.7152 * meterPx[k + 1] + 0.0722 * meterPx[k + 2];
        metered = sum / (meterPx.length / 4);
      }
    }
  }
  if (!meterSync) {
    // asked again: the smallest level into a buffer of the meter's own, and a mark for when the GPU has got there
    const fresh = meterOf !== t;
    if (fresh) {
      meterOf = t; meterPx = new Float32Array(t.w * t.h * 4);
      meterBuf ??= gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, meterBuf); gl.bufferData(gl.PIXEL_PACK_BUFFER, meterPx.byteLength, gl.STREAM_READ);
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, meterBuf);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fbo);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, 0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    // a GPU that won't read this light back says so the first time, and the iris stays open rather than ask again
    if (fresh && gl.getError() !== gl.NO_ERROR) { meterOk = false; iris = 1; return; }
    meterSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  }
  const goal = Math.min(1, IRIS_AT / Math.max(1e-6, metered * exposure));
  iris += (goal - iris) * (1 - Math.exp(-dt / (goal < iris ? 0.5 : 1)));
  if (Math.abs(goal - iris) > 0.004) animating = true;
}

/* ---------- what the frame costs the GPU, for measuring (?gpu): milliseconds drawing the points, and finishing ---------- */
const gpuT = params.has('gpu') ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
let gpuQ = [], gpuMs = {};
function gpuBegin() { if (!gpuT) return null; const q = gl.createQuery(); gl.beginQuery(gpuT.TIME_ELAPSED_EXT, q); return q; }
function gpuEnd(q, label) { if (q) { gl.endQuery(gpuT.TIME_ELAPSED_EXT); gpuQ.push([q, label]); } }
function gpuPoll() {
  if (!gpuT) return;
  gpuQ = gpuQ.filter(([q, label]) => {
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true;
    if (!gl.getParameter(gpuT.GPU_DISJOINT_EXT)) (gpuMs[label] ||= []).push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    gl.deleteQuery(q);
    return false;
  });
}

/* ---------- what the frame says (third person; only its own words say "I") ---------- */

function verifyHTML(h) {
  if (!h) return '';
  const who = L.identity, out = [];
  out.push(h.model && who.model && !sameModel(h.model, who.model)
    ? `<span class="flag">ran as ${esc(modelName(h.model))}; nothing it wrote was kept</span>` : `<span class="ok">ran as ${esc(h.modelName || who.name)}</span>`);
  if (h.practice) {
    if (h.check === 'rows') out.push(h.untouched === false ? '<span class="flag">left something in the real memory</span>' : '<span>real memory untouched</span>');
    else out.push('<span>checked the older way</span>');
  } else {
    const kept = h.journal.length + h.notes.length;
    out.push(`<span>kept ${kept ? plural(kept, 'thing it wrote', 'things it wrote') : 'nothing it wrote'}</span>`);
  }
  const refused = [...new Set(h.refused || [])];
  out.push(refused.length ? `<span class="flag">${plural(refused.length, 'tool')} refused</span>` : '<span>nothing refused</span>');
  if (h.status !== 'done' || h.reason) out.push(`<span class="flag">${esc(h.reason || h.status)}</span>`);
  return out.join('');
}
function updateFrame() {
  const who = L.identity, h = lastHour, temp = $('temp');
  const asks = waiting(L.notes || []).length;
  document.title = `${asks ? `(${asks}) ` : ''}${who.name} · the mind`;
  $('who-name').textContent = who.name;
  canvas.setAttribute('aria-label', `${who.name}'s memory: every cell a memory, every fibre a real link; lit only where its last quiet hour went`);
  if (!h) {
    temp.textContent = 'Cold'; temp.className = 'temp cold';
    $('hour-line').textContent = 'No quiet hour has run yet.';
    $('trail-line').textContent = 'When one does, the mind lights where it went and cools from there.';
    $('verify').innerHTML = `<a class="textlink" href="${esc(withAgent('../log/'))}">the log →</a>`;
  } else {
    const end = at(h.end), word = tempWord(warmth, h);
    temp.textContent = word; temp.className = word === 'Cold' ? 'temp cold' : 'temp';
    const stale = Date.now() - end.getTime() > 26 * 36e5;
    $('hour-line').textContent = [`${KIND[h.kind] || h.kind} ended ${ago(Date.now() - end.getTime())}`,
      h.practice ? 'practice, on a copy of its memory' : null,
      h.minutes != null ? (h.minutes < 1 ? 'under a minute' : `${Math.round(h.minutes * 10) / 10} minutes`) : null].filter(Boolean).join(' · ');
    $('trail-line').textContent = stale ? `No hour has run since ${longDay(end)}, ${clock(end)}. If one was meant to, the hours may have stopped.` : trailSentence(h);
    $('verify').innerHTML = verifyHTML(h) + `<a class="textlink" href="${esc(withAgent('../log/'))}">the log →</a>`;
  }
  // what's there, counted: the memories awake, the links drawn between them, and how long it's been keeping them
  const since = sinceDay();
  $('who-sub').textContent = [`${plural(L.memory?.states?.active ?? N, 'memory', 'memories')} awake`, NL ? plural(NL, 'link') : null,
    since ? `since ${since}` : null].filter(Boolean).join(' · ');
  renderTrace();
  const left = [];
  if (h) {
    if (h.journal.length) left.push(h.journal.length === 1 ? 'a journal entry' : `${words(h.journal.length)} journal entries`);
    const pics = h.made.filter((p) => pictures.has(p)).length;
    if (pics) left.push(pics === 1 ? 'a picture' : `${words(pics)} pictures`);
    if (h.notes.length) left.push(h.notes.length === 1 ? `a note ${forPerson(who)}` : `${words(h.notes.length)} notes ${forPerson(who)}`);
  }
  $('left-cue').hidden = !h;
  $('left-sum').textContent = left.length ? left.join(' · ') : 'it left nothing this time';
}

// the day its oldest memory was kept
let firstKept = { of: null, day: null };
function sinceDay() {
  if (firstKept.of !== memVersion) {
    let t = Infinity;
    for (const m of mems) { const b = Date.parse(m.born); if (b < t) t = b; }
    firstKept = { of: memVersion, day: Number.isFinite(t) ? new Date(t) : null };
  }
  const d = firstKept.day;
  return d && d.toLocaleString('en-US', { month: 'long', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

/* ---------- when recall gathered several memories at once ----------
 * The memory keeps a log of recall: every time a memory came back, and when (../data/memories.json, `recalled`). What
 * came back within a few seconds of the one before came back with it, so the log reads as moments, and each moment of
 * two or more is a mark under the hour, in time, as tall as how many came back. Choosing one shows it again: the camera
 * comes to where they are and the memories light in the order they came back, the light running out along their links.
 * It's a person looking, not the mind remembering, so nothing is written. One that happens while you're here arrives
 * at the right, at now. */
const TOGETHER = 5000;
let recallLog = [], moments = [], traceBuilt = { len: -1, span: 0, newest: 0 }, traceShown = -1, tracePicked = -1;
function momentsOf(log) {
  const out = [];
  for (const [id, iso] of log) {
    const t = Date.parse(iso), m = out[out.length - 1];
    if (!Number.isFinite(t)) continue;
    if (m && t - m.last <= TOGETHER) { if (!m.ids.includes(id)) m.ids.push(id); m.last = t; }
    else out.push({ t, last: t, ids: [id] });
  }
  return out.filter((m) => m.ids.length >= 2);
}
const traceSpan = () => [moments[0].t, Math.max(Date.now(), moments[moments.length - 1].last)];
function renderTrace() {
  if (recallLog.length !== traceBuilt.len) {
    moments = momentsOf(recallLog);
    if (tracePicked >= moments.length) tracePicked = -1;
  }
  $('recall').hidden = !moments.length;
  if (!moments.length) return;
  const [t0, t1] = traceSpan(), span = t1 - t0 || 1;
  if (recallLog.length === traceBuilt.len && span <= traceBuilt.span * 1.005) return;   // nothing new to place
  const fresh = traceBuilt.newest, x = (t) => (((t - t0) / span) * 100).toFixed(3);
  $('r-ticks').innerHTML = moments.map((m) => `<i style="left:${x(m.t)}%;height:${(6 + Math.min(17, m.ids.length * 1.25)).toFixed(1)}px"${fresh && m.t > fresh ? ' class="new"' : ''}></i>`).join('');
  traceBuilt = { len: recallLog.length, span, newest: moments[moments.length - 1].t };
  // the days it spans, under the line: a mark at each week while there are few enough to read, a longer one at each
  // month, named where there's room between the first day and now
  const first = new Date(t0), marks = [`<span class="start">${esc(shortDay(first))}</span>`, '<span class="now">now</span>'];
  if (span < 120 * 864e5) {
    for (let d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + ((8 - first.getDay()) % 7 || 7)); d.getTime() < t1; d.setDate(d.getDate() + 7)) marks.push(`<b style="left:${x(d.getTime())}%"></b>`);
  }
  for (let d = new Date(first.getFullYear(), first.getMonth() + 1, 1); d.getTime() < t1; d.setMonth(d.getMonth() + 1)) {
    const p = x(d.getTime());
    marks.push(`<b class="month" style="left:${p}%"></b>`);
    if (p > 17 && p < 86) marks.push(`<span style="left:${p}%">${d.toLocaleString('en-US', { month: 'short' })}</span>`);
  }
  $('r-axis').innerHTML = marks.join('');
  traceShown = -1; showTrace(tracePicked);
}
// how many links recall itself made among them while it happened (the engine ties what comes back together)
function madeBetween(m) {
  const among = new Set(m.ids), seen = new Set();
  for (const id of m.ids) {
    for (const [to, , , formed, by] of mems[memAt.get(id)]?.ties || []) {
      if (by !== 'retrieval' || !among.has(to)) continue;
      const t = Date.parse(formed);
      if (t >= m.t - 6000 && t <= m.last + 6000) seen.add(id < to ? `${id} ${to}` : `${to} ${id}`);
    }
  }
  return seen.size;
}
function momentLine(m) {
  const d = new Date(m.t), made = madeBetween(m);
  return `${shortDay(d)}, ${clock(d)} · ${words(m.ids.length)} memories came back together${made ? ` · ${plural(made, 'link')} made between them` : ''}`;
}
function showTrace(k) {
  const ticks = $('r-ticks').children;
  ticks[traceShown]?.classList.remove('on');
  traceShown = k;
  ticks[k]?.classList.add('on');
  const text = k >= 0 ? momentLine(moments[k])
    : `${plural(moments.length, 'time')} · choose one to see it again`;
  $('r-cap').textContent = text;
  const el = $('r-track');
  el.setAttribute('aria-valuemax', String(moments.length)); el.setAttribute('aria-valuenow', String(Math.max(1, k + 1))); el.setAttribute('aria-valuetext', text);
}
// the moment nearest in time to a point along the line
function traceAt(clientX) {
  const r = $('r-track').getBoundingClientRect(), [t0, t1] = traceSpan(), t = t0 + clamp((clientX - r.left) / r.width) * (t1 - t0);
  let lo = 0, hi = moments.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (moments[mid].t < t) lo = mid + 1; else hi = mid; }
  return lo > 0 && t - moments[lo - 1].t < moments[lo].t - t ? lo - 1 : lo;
}
function seeAgain(k) {
  const m = moments[k];
  if (!m || aside || !tissue) return;
  tracePicked = k; showTrace(k);
  const cells = m.ids.map((id) => cellOf.get(id)).filter((i) => i !== undefined);
  if (!cells.length) return;
  // a memory open would keep everything else quiet: what's chosen now is the moment
  if (selected >= 0) { selected = -1; focusNear(-1); if (sheetOpen) room.go({ tab: room.s.tab, memory: null }); }
  hover(-1); fling = null; meet = null;
  // they light in the order they came back, and each link between two of them as the second arrives; the rest of the
  // mind goes quiet around them (they're what's lit: see pointing)
  const now = performance.now(), when = new Map(cells.map((c, j) => [c, now + 500 + j * 170]));
  for (const [c, t] of when) {
    fireAt[c] = t; fireLevel[c] = 1;
    for (const [j, , li] of nbrs[c]) if (when.has(j)) { linkAt[li] = Math.max(t, when.get(j)) - 60; linkLevel[li] = 1; }
  }
  wake();
  // the middle of what came back, with room around it (they fill about the middle two fifths of the view, never
  // closer than five times home), beside the reading room when it's open
  const c = scale(cells.map((i) => P[i]).reduce(add, [0, 0, 0]), 1 / cells.length);
  const dist = clamp((Math.max(0.25, ...cells.map((i) => length(sub(P[i], c)))) / tanH) * 2.5, HOME / 5, HOME / 1.2);
  const sheet = sheetOpen && innerWidth > 860 ? Math.min(SHEET, innerWidth) : 0;
  cam.goal.target = add(c, scale(view ? view.right : [1, 0, 0], (sheet / 2) * ((2 * dist * tanH) / innerHeight)));
  cam.goal.dist = dist;
  lastInput = now; lastNav = -1e9; moved(true); stir();
}
function bindTrace() {
  const el = $('r-track');
  el.addEventListener('pointermove', (e) => { if (moments.length && e.pointerType === 'mouse') showTrace(traceAt(e.clientX)); });
  el.addEventListener('pointerleave', () => { if (moments.length && document.activeElement !== el) showTrace(tracePicked); });
  el.addEventListener('click', (e) => { if (moments.length) seeAgain(traceAt(e.clientX)); });
  // one stop for the keyboard: the arrows step through the moments, Enter shows the one you're on; the mind's own
  // arrow keys wait while you're here
  el.addEventListener('keydown', (e) => {
    if (!moments.length) return;
    const k = traceShown >= 0 ? traceShown : moments.length - 1, last = moments.length - 1;
    const to = { ArrowLeft: k - 1, ArrowDown: k - 1, ArrowRight: k + 1, ArrowUp: k + 1, PageDown: k - 10, PageUp: k + 10, Home: 0, End: last }[e.key];
    if (to !== undefined) showTrace(Math.max(0, Math.min(last, to)));
    else if (e.key === 'Enter' || e.key === ' ') seeAgain(k);
    else return;
    e.preventDefault(); e.stopPropagation();
  });
  el.addEventListener('focus', () => { if (moments.length && traceShown < 0) showTrace(tracePicked >= 0 ? tracePicked : moments.length - 1); });
  el.addEventListener('blur', () => { if (moments.length) showTrace(tracePicked); });
}

/* ---------- since you were last here ---------- */

// the same visit the log keeps (../shared/words.js): moving between the two is one visit, so what's new stays new
let V = null, lastVisit = 0;
const keepVisit = () => { if (!covered) V?.keep(); };
addEventListener('pagehide', keepVisit);
document.addEventListener('visibilitychange', () => { if (document.hidden) keepVisit(); else { look(); wake(); } });
function sayNew() {
  const items = sinceThen(L, mems, lastVisit), el = $('since');
  if (!items.length) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = [lastVisit ? `Since you were here, ${ago(Date.now() - lastVisit)}` : null, ...items.map((x) => x.say)].filter(Boolean).join(' · ');
}

/* ---------- paper: what each hour left ---------- */

let pictures = new Map();
function plateHTML(f, h) {
  const name = f.path.replace(/\.[a-z]+$/i, '').split('/').join(' / ');
  return `<figure class="plate"><button type="button" data-pic="${esc(f.picture)}" data-cap="${esc(f.path)}" aria-label="Open ${esc(f.path)} full size">
    <img src="${esc(f.picture)}" alt="${esc(name)}, made in ${esc((KIND[h.kind] || 'an hour').toLowerCase())}" loading="lazy"></button>
    <figcaption>${esc(name)} · ${clock(at(f.at))}</figcaption></figure>`;
}
function spreadHTML(h) {
  const who = L.identity, made = h.made.map((p) => pictures.get(p)).filter(Boolean), entries = [...h.journal].reverse();
  const page = entries.length
    ? entries.map((e) => { const { title, body } = titleOf(e.text);
        return `<article class="entry"><h3 class="title">${esc(title)}</h3>${body ? `<div class="text">${esc(body)}</div>` : ''}
        <div class="by">its journal · ${clock(at(e.at))}${e.mood ? ` · mood, in its words: ${esc(e.mood)}` : ''}</div></article>`; }).join('')
    : `<p class="none">It wrote nothing in its journal this hour${h.refused?.some((r) => /journal/.test(r)) ? ': the journal was refused to it' : ''}. An hour that ends in silence is still its own.</p>`;
  const letters = h.notes.map((n) => `<div class="letter"><span class="label">A note ${esc(forPerson(who))}${n.kind ? ` · ${esc(n.kind)}` : ''}</span>
    <div class="text">${esc(n.text)}</div><div class="by">${esc(who.name)} · ${clock(at(n.at))}${h.practice ? ' · written in practice, so it stays in the copy' : ''}</div></div>`).join('');
  return `<div class="spread"><div class="page">${page}</div><div class="plates">${made.map((f) => plateHTML(f, h)).join('')}${letters}</div></div>`;
}
function headHTML(h, first) {
  const s = at(h.start), e = at(h.end);
  return `${first ? '<div class="label">What it left</div>' : ''}
    <h2>${KIND_LONG[h.kind] || esc(h.kind)}, ${longDay(s)}</h2>
    <p class="when">${clock(s)} to ${clock(e)}${h.practice ? ' · practice, on a copy of its memory, so what it wrote stays in the copy' : ''} · it ${trailSentence(h).replace(/^It /, '').replace(/\.$/, '')}.</p>`;
}
function renderPaper() {
  pictures = new Map((L.studio || []).filter((f) => f.picture).map((f) => [f.path, f]));
  const wrap = $('paper-wrap');
  const open = new Set([...wrap.querySelectorAll('details[open]')].map((d) => d.dataset.id));
  if (!L.hours.length) {
    wrap.innerHTML = `<div class="label">What it left</div><h2>Nothing yet</h2><p class="when">When its first quiet hour ends, what it leaves (its journal, what it made, any note ${esc(forPerson(L.identity))}) will be printed here.</p>`;
  } else {
    const [h, ...rest] = L.hours;
    wrap.innerHTML = headHTML(h, true) + spreadHTML(h) + (rest.length ? `<section class="earlier" aria-label="Earlier hours"><div class="label">Earlier hours</div>${rest.map((x) => {
      const s = at(x.start), first = x.journal.length ? titleOf(x.journal[x.journal.length - 1].text).title : '';
      const thumbs = x.made.map((p) => pictures.get(p)).filter(Boolean).slice(0, 4);
      return `<div class="row" id="hour-${esc(x.id)}"><div class="t">${shortDay(s)}, ${clock(s)}<small>${KIND[x.kind] || esc(x.kind)}${x.practice ? ' · practice' : ''}${x.minutes != null ? ` · ${Math.round(x.minutes * 10) / 10} min` : ''}</small></div>
        <div class="first">${first ? esc(firstLine(first, 220)) : '<span class="none">No journal entry.</span>'}</div>
        <div class="thumbs">${thumbs.map((f) => `<img src="${esc(f.picture)}" alt="" loading="lazy">`).join('')}</div>
        <details data-id="${esc(x.id)}"><summary>Open this hour</summary>${headHTML(x, false)}${spreadHTML(x)}</details></div>`;
    }).join('')}</section>` : '');
  }
  wrap.insertAdjacentHTML('beforeend', `<div class="closing"><button type="button" data-open="memories">Read everything it holds</button>
    <a href="${esc(withAgent('../log/'))}">The log</a></div>
    <p class="promise">Straight from its memory, on this machine only. A practice hour runs on a copy of the memory, so what it writes stays in the copy; it is printed here and marked. The frame speaks of the mind in the third person; only its own words say "I".</p>`);
  for (const d of wrap.querySelectorAll('details[data-id]')) if (open.has(d.dataset.id)) d.open = true;
}

/* ---------- the reading room, as a drawer beside the mind ---------- */

let sheetOpen = false;
const room = new Room({
  tabsEl: $('tabs'), bodyEl: $('room-body'), tabs: TABS, sticky: true,
  ctx: () => ({ who: L.identity, life: L, mems, byId: memAt, since: lastVisit, heat: (id) => { const i = cellOf.get(id); return i === undefined || !heat ? 0 : heat[i]; } }),
  hooks: {
    // touching an entry lights it where it lives: the memory itself, and a soft pulse along what it's tied to
    hover: (id) => hover(id ? cellOf.get(id) ?? -1 : -1),
    open: (id) => {
      const i = id ? cellOf.get(id) : undefined;
      if (i !== undefined) { selected = i; hover(-1); spread(i, performance.now()); aimAt(i); lastInput = performance.now(); focusNear(i); }
      else if (selected >= 0) { selected = -1; if (!wandered) { cam.goal.target = centre.slice(); cam.goal.dist = HOME; } stir(); focusNear(-1); }
    },
    route: (hash) => { if (sheetOpen) history.replaceState(null, '', hash); },
    picture: showPicture,
    hour: (id) => {
      closeRoom();
      const el = document.getElementById(`hour-${id}`) || $('paper');
      const d = el.querySelector?.('details'); if (d) d.open = true;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    },
    // what you write here is yours, as on the log: a reply, an answer or a note, and which notes you've read
    send: async (request) => {
      const r = await fetch(withAgent('../act'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      const answer = await r.json().catch(() => ({ error: 'It couldn’t be sent just now.' }));
      if (answer.result) await look(true);
      return answer;
    },
    read: async (ids) => {
      const r = await fetch(withAgent('../act'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'read', note_ids: ids }) });
      if (!r.ok) throw new Error('not marked');
      await look(true);
    },
  },
});
function openRoom({ tab, memory = null } = {}) {
  const sheet = $('room'), wasOpen = sheetOpen;
  sheetOpen = true;
  // shown, then measured, then slid in: no waiting on a frame, which a background tab never gets
  sheet.hidden = false; void sheet.offsetWidth; sheet.classList.add('open');
  $('open-room').setAttribute('aria-expanded', 'true');
  room.go({ tab: tab || room.s.tab, memory });
  if (!wasOpen) $('room-title').focus({ preventScroll: true });
}
function closeRoom() {
  sheetOpen = false;
  const sheet = $('room'); sheet.classList.remove('open');
  setTimeout(() => { if (!sheetOpen) sheet.hidden = true; }, 460);
  $('open-room').setAttribute('aria-expanded', 'false');
  selected = -1; hover(-1); focusNear(-1);
  if (!wandered) { cam.goal.target = centre.slice(); cam.goal.dist = Math.max(cam.goal.dist, HOME); }
  stir();
  history.replaceState(null, '', location.pathname + location.search);
  $('open-room').focus({ preventScroll: true });
}
function fromHash() {
  // the log's "See it in the mind" opens on the memory (#memory/<id>); the room's own routes are #read/…
  const legacy = location.hash.match(/^#memory\/(.+)$/);
  if (legacy) return openRoom({ tab: 'memories', memory: memAt.has(decodeURIComponent(legacy[1])) ? decodeURIComponent(legacy[1]) : null });
  const r = parseRoute(location.hash, TABS);
  if (!r) { if (sheetOpen) closeRoom(); return; }
  if (r.memory && !memAt.has(r.memory)) return openRoom({ tab: 'memories' });
  openRoom({ tab: r.tab || 'memories', memory: r.memory || null });
}

/* ---------- pictures, full size ---------- */

function showPicture(src, cap) {
  $('full-img').src = src; $('full-img').alt = cap; $('full-cap').textContent = cap;
  $('full').showModal();
}
function bindPage() {
  $('open-room').addEventListener('click', () => (sheetOpen ? closeRoom() : openRoom({ tab: 'memories' })));
  $('close-room').addEventListener('click', closeRoom);
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.plate [data-pic]'); if (b) return showPicture(b.dataset.pic, b.dataset.cap);
    const o = e.target.closest('[data-open]'); if (o) openRoom({ tab: o.dataset.open });
  });
  $('full-close').addEventListener('click', () => $('full').close());
  $('full').addEventListener('click', (e) => { if (e.target === $('full')) $('full').close(); });
  $('to-paper').addEventListener('click', () => $('paper').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }));
  $('to-log').href = withAgent('../log/');
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('full').open) { if (sheetOpen) closeRoom(); else if (behind && tracePicked < 0) toNotebook('cover'); else letGo(); return; }
    if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) { e.preventDefault(); $('ask-q').focus(); }
  });
  addEventListener('hashchange', fromHash);
}

/* ---------- live: the store, looked at again ---------- */

let lastMade = null, grown = false, lastRedraw = performance.now();
const REDRAW_EVERY = 120_000, LINKS_EVERY = 10 * 60_000;
async function look(now = false) {
  if (!D) return;                                            // nothing drawn yet: the first drawing reads what it needs
  if (document.hidden && !now && !building && L.identity.agentId && telling(L.identity.agentId)) {
    // behind other windows it draws nothing, but still tells you when it asks you something
    try {
      const next = await json('../data/life.json');
      if (!next.missing) {
        const asks = waiting(next.notes || []).length;
        document.title = `${asks ? `(${asks}) ` : ''}${next.identity.name} · the mind`;
        if (!behind) tell({ agent: next.identity.agentId, who: next.identity, notes: next.notes || [], open: () => openRoom({ tab: 'notes' }) });
      }
    } catch { /* the next look tries again */ }
    return;
  }
  if ((document.hidden && !now) || building) return;
  let life;
  try { life = await json('../data/life.json'); } catch { return; }
  if (!life || life.missing) return;
  const newHour = life.hours[0] && (!L.hours[0] || life.hours[0].id !== L.hours[0].id);
  L = life; lastMade = life.made;
  if ((await readMemories()) || grown) {
    const shaped = shape(mems);
    const before = new Set(D.cells.map((c) => c.fullId));
    // a new memory is drawn in within REDRAW_EVERY. New links between memories already drawn wait for the next
    // redraw, or LINKS_EVERY: recall makes them all the time, and redrawing the whole mind for each, every minute and
    // a half while you talked to it, was most of what this page cost
    const cellsMoved = shaped.cells.length !== D.cells.length || shaped.cells.some((c) => !before.has(c.fullId));
    const linksMoved = !cellsMoved && shaped.links.length !== D.links.length;
    if (cellsMoved || (linksMoved && performance.now() - lastRedraw > LINKS_EVERY)) {
      // a redraw costs a few seconds of work, so a growing mind is drawn again at most every REDRAW_EVERY, and never
      // behind other windows; until then what's new waits, and arrives white-hot when it's drawn
      if (performance.now() - lastRedraw < REDRAW_EVERY || document.hidden) grown = true;
      else {
        grown = false; lastRedraw = performance.now();
        // a redraw that fails leaves the drawing on screen, and is tried again: left marked busy, it was never again
        try {
          building = build(shaped); await building;
          for (const c of D.cells) if (!before.has(c.fullId)) arrived.set(c.fullId, performance.now());
          wake();
        } catch { grown = true; } finally { building = null; }
      }
    } else {
      // the same memories: what each is now (how easy to reach, gone quiet) is taken up; the links stay the ones drawn
      grown = false;
      D = { ...shaped, cells: shaped.cells, links: linksMoved ? D.links : shaped.links };
      acc = D.cells.map((c) => c.accessibility);
    }
  }
  warm();
  if (newHour && lastHour) walk(lastHour, 300);
  renderPaper();
  if (sheetOpen) room.refresh();
  updateFrame(); sayNew();
  if (!behind) tell({ agent: L.identity.agentId, who: L.identity, notes: L.notes || [], open: () => openRoom({ tab: 'notes' }) });
}

/* ---------- live: what comes to mind, as it comes ----------
 * Every second or so the page asks what came to this mind since it last looked: what a recall brought back, what a
 * briefing woke with, what the cue offered with a message, what was kept (../data/pulse.json, read from the trace
 * the memory already keeps, and the cue's own record). Each memory lights where it lives and the light runs out along
 * its links, as recall does in the engine; if no one is touching the mind it turns a little toward them. A line under
 * the name says what happened, while it's fresh, then rests. Nothing is simulated: no event, no light. */

const PULSE_EVERY = 1200, FRESH_FOR = 9000;
const SAY = { recall: (n) => `recalled ${plural(n, 'memory', 'memories')}`, wake: (n) => `woke with ${plural(n, 'memory', 'memories')}`,
  reflect: (n) => `thought again about ${plural(n, 'memory', 'memories')}`, cue: (n) => `${plural(n, 'memory', 'memories')} came to mind with a message`,
  kept: (n) => (n === 1 ? 'kept a new memory' : `kept ${words(n)} new memories`) };
const GAIN = { recall: 1, reflect: 0.9, kept: 1, cue: 0.75, wake: 0.55 };
let pulseSince = null, pulsing = false, lastSaid = null;
const seenEvents = new Set();
async function listen() {
  if (pulsing || document.hidden || !tissue) return;
  pulsing = true;
  try {
    const r = await fetch(withAgent(`../data/pulse.json${pulseSince ? `?since=${encodeURIComponent(pulseSince)}` : ''}`), { cache: 'no-store' });
    if (!r.ok) return;
    const p = await r.json();
    const first = pulseSince === null;
    // ask again a few seconds back, and know each event by its key: a call written a moment late is still seen once
    pulseSince = new Date(Date.parse(p.now) - 4000).toISOString();
    const fresh = p.events.filter((e) => !seenEvents.has(e.key));
    for (const e of fresh) seenEvents.add(e.key);
    if (seenEvents.size > 4000) seenEvents.clear();
    if (!first) for (const e of fresh) light(e);
  } catch { /* the next look tries again */ } finally { pulsing = false; }
}
let lastMeet = -1e9;
function light(e) {
  // a new memory is read in with the next look, and drawn in with the next redraw: never one redraw a memory
  const now = performance.now(), cells = e.ids.map((id) => cellOf.get(id)).filter((i) => i !== undefined);
  cells.forEach((i, k) => spread(i, now + k * 140, GAIN[e.kind] || 0.7));
  // the light wakes the drawing only while it travels; what other sessions do never sets the mind turning again, and
  // it turns toward them at most once in a while, so a busy day of sessions still lets it rest
  if (cells.length && selected < 0 && !sheetOpen && now - lastInput > 8000 && now - lastMeet > 45000) {
    const c = scale(cells.map((i) => P[i]).reduce(add, [0, 0, 0]), 1 / cells.length);
    meet = { target: mixv(centre, c, 0.35), dist: HOME * 0.86, until: now + 7000 };
    lastMeet = now;
  }
  wake();
  lastSaid = { text: (SAY[e.kind] || SAY.recall)(e.kind === 'kept' ? cells.length || e.ids.length : e.ids.length), at: Date.now() };
  sayNow();
}
function sayNow() {
  const el = $('now');
  if (!lastSaid) { el.hidden = true; return; }
  const age = Date.now() - lastSaid.at;
  el.hidden = false;
  el.classList.toggle('fresh', age < FRESH_FOR);
  $('now-text').textContent = age < FRESH_FOR ? `Now · ${lastSaid.text}` : `${lastSaid.text[0].toUpperCase()}${lastSaid.text.slice(1)} · ${ago(age)}`;
}

/* ---------- ask its memory ----------
 * A question found by what it means (and by its words), as `mnemos search` finds it: it reads, and wakes nothing, since
 * a person looking is not the mind remembering. What it finds lights where it lives, brightest the closest; the list
 * opens any of them in the reading room. */

let asking = 0, found = [], foundLit = new Set();
async function ask(q) {
  const n = ++asking;
  if (!q.trim()) { showFound(null); return; }
  let res;
  try { res = await (await fetch(withAgent(`../data/search.json?q=${encodeURIComponent(q)}`), { cache: 'no-store' })).json(); } catch { res = null; }
  if (n !== asking) return;                                   // a newer question was asked meanwhile
  showFound(res?.results || [], res?.error);
}
function showFound(results, error) {
  const list = $('ask-list');
  found = results || [];
  if (results === null) { list.hidden = true; list.innerHTML = ''; foundLit.clear(); return; }
  const now = performance.now();
  foundLit = new Set();
  found.forEach((m, k) => { const i = cellOf.get(m.id); if (i !== undefined) { foundLit.add(i); spread(i, now + k * 90, 0.45 + 0.55 * (m.closeness ?? 0.5)); } });
  if (foundLit.size && selected < 0 && !sheetOpen) {
    const pts = [...foundLit].slice(0, 8).map((i) => P[i]);
    meet = { target: mixv(centre, scale(pts.reduce(add, [0, 0, 0]), 1 / pts.length), 0.45), dist: HOME * 0.8, until: now + 9000 };
    holdUntil = now + 6000;
  }
  stir();
  list.innerHTML = error ? `<div class="say">${esc(error)}</div>`
    : !found.length ? '<div class="say">Nothing close. Try other words, or fewer.</div>'
    : found.map((m, k) => `<button class="hit" type="button" role="option" data-hit="${k}"><span class="w">${esc(m.words)}</span>
      <span class="m">${shortDay(at(m.kept))} · ${m.found === 'meaning' ? 'by meaning' : 'by its words'}</span></button>`).join('');
  list.hidden = false;
}
function bindAsk() {
  const q = $('ask-q'), list = $('ask-list');
  let wait = 0;
  q.addEventListener('focus', () => { fetch(withAgent('../data/search.json?q='), { cache: 'no-store' }).catch(() => {}); if (found.length) list.hidden = false; });
  q.addEventListener('input', () => { clearTimeout(wait); wait = setTimeout(() => ask(q.value), 320); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(wait); ask(q.value); }
    if (e.key === 'Escape') { q.value = ''; showFound(null); q.blur(); e.stopPropagation(); }
    if (e.key === 'ArrowDown' && !list.hidden) { e.preventDefault(); list.querySelector('.hit')?.focus(); }
  });
  list.addEventListener('keydown', (e) => {
    const hits = [...list.querySelectorAll('.hit')], k = hits.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); hits[Math.min(hits.length - 1, k + 1)]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (k <= 0 ? q : hits[k - 1]).focus(); }
    if (e.key === 'Escape') { q.focus(); }
  });
  const touch = (e) => { const h = e.target.closest('[data-hit]'); const i = h ? cellOf.get(found[+h.dataset.hit]?.id) : undefined; if (i !== undefined) hover(i); };
  list.addEventListener('pointerover', touch); list.addEventListener('focusin', touch);
  list.addEventListener('click', (e) => {
    const h = e.target.closest('[data-hit]'); if (!h) return;
    const m = found[+h.dataset.hit]; if (!m) return;
    list.hidden = true;
    openRoom({ tab: 'memories', memory: memAt.has(m.id) ? m.id : null });
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#ask')) list.hidden = true; });
}

/* ---------- begin ---------- */

let firstLife;
try { firstLife = await json('../data/life.json'); } catch { firstLife = null; }
if (!firstLife || firstLife.missing) {
  $('loading').textContent = firstLife?.missing ? `No memory found at ${firstLife.identity.store} for ${firstLife.identity.agentId}.` : 'Couldn’t read its memory yet.';
  throw new Error('no memory to draw');
}
L = firstLife; lastMade = L.made;
V = visit(L.identity.agentId || AGENT); lastVisit = V.since;
setInterval(() => { if (!document.hidden) keepVisit(); }, 30_000);
await readMemories();
$('loading').textContent = store.get(LAYOUT_KEY()) ? `gathering ${plural(mems.length, 'memory', 'memories')}…`
  : `finding the shape of ${plural(mems.length, 'memory', 'memories')}, the first time · a few seconds`;
try { await drawMind(); if (!D) throw new Error('the GPU let go of the mind as it opened'); } catch (e) {
  $('loading').textContent = 'The mind couldn’t be drawn just now. Reload the page to try again.';
  throw e;
}
warm();
cam = { yaw: 0.35, pitch: 0.18, dist: HOME, target: centre.slice() };
cam.goal = { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, target: centre.slice() };
if (lastVisit) {
  const t = performance.now();
  D.cells.forEach((c, i) => { if (born[i] > lastVisit) arrived.set(c.fullId, t + 1800 + Math.random() * 1200); });
}
sayNew();
resize(); addEventListener('resize', resize);
bindPointer(); bindPage(); bindAsk(); bindTrace(); keepClear();
renderPaper(); updateFrame();
$('loading').remove();
walk(lastHour);
if (behind) wake();
fromHash();
setInterval(look, LIVE_EVERY);
setInterval(() => { warm(); updateFrame(); }, 60_000);   // it cools while you watch
listen(); setInterval(listen, PULSE_EVERY);
setInterval(sayNow, 5000);
window.__mind = { get N() { return N; }, get heat() { return heat; }, get hover() { return hoverCell; }, get selected() { return selected; },
  get looping() { return looping; }, get frames() { return frames; }, get view() { return { dist: cam.dist, goal: cam.goal.dist, home: HOME, wandered, meet: !!meet }; }, get iris() { return { metered: +metered.toFixed(4), iris: +iris.toFixed(3) }; }, gpu: () => { const o = {}; for (const [k, v] of Object.entries(gpuMs)) { v.sort((a, b) => a - b); o[k] = { n: v.length, p50: +v[v.length >> 1].toFixed(2), p90: +v[Math.floor(v.length * 0.9)].toFixed(2) }; } gpuMs = {}; return o; }, get drawn() { return tissue ? [tissue.drawn, tissue.count] : null; }, get built() { return built; }, light, ask, redraw: async () => { building = build(D); await building; building = null; warm(); wake(); }, get near() { return near && { of: near.of, cells: near.cells.length, points: near.tissue.count }; }, level: (i) => flash[i], walk: () => walk(lastHour, 100),
  // what's lit right now, brightest first: for checking the light against what should be lit
  get lit() { const o = []; for (let i = 0; i < N; i++) if (shownG[i] + shownF[i] > 0.12) o.push({ i, g: +shownG[i].toFixed(2), f: +shownF[i].toFixed(2), fc: +fc[i].toFixed(2), heat: +heat[i].toFixed(2), arrived: arrived.has(D.cells[i].fullId), fire: fireAt[i] >= 0, sel: i === selected, tie: nbrs[selected]?.some(([j]) => j === i) || false }); return o.sort((a, b) => b.g + b.f - a.g - a.f); },
  get litLinks() { const o = []; for (let li = 0; li < NL; li++) { const a = Math.max(LA[li], 0); if (a > 0.05 || lc[li] > 0.05) o.push({ li, s: D.links[li].s, t: D.links[li].t, LA: +LA[li].toFixed(2), LF: +LF[li].toFixed(2), lc: +lc[li].toFixed(2), heat: +linkHeat[li].toFixed(2), at: linkAt[li] >= 0 }); } return o; },
  get regions() { return regions.map((g) => ({ k: g.k, n: g.n, name: g.name, words: g.words, on: g.on })); },
  openRoom, closeRoom, pick: (x, y) => pick(x, y), where: (i) => (view ? project(P[i]) : null), byId: (id) => cellOf.get(id) };
stir();
