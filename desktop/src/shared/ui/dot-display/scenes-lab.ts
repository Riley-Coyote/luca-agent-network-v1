/**
 * EXPERIMENTAL scene table — exploration only, not wired into the app.
 *
 * Winners get promoted into the production table in `engine.ts`; what is left
 * here is either unpromoted or deliberately large-format only. The physics
 * itself lives in `physics.ts` and is SHARED with production — the lab must run
 * the same sandpile the app runs, or it stops being a valid preview.
 *
 * Everything here obeys the house laws that separate the good scenes from the
 * weak ones:
 *
 *   1. Never clear the charge buffer — persistence is the medium.
 *   2. No flat values — every write carries a gradient, falloff or noise.
 *   3. Fill the field — a scene using one row reads as underdeveloped.
 *   4. Two timescales — a fast front over a slow afterglow gives depth.
 *   5. Never loop — aperiodic drivers, so nothing visibly repeats.
 *   6. Prefer continuous maths sampled onto the lattice over bookkeeping.
 */

import type { DotPanel, SceneFn } from "./engine";
import { dlaScene, pileScene } from "./physics";

export { MAGNITUDE_LUT, MAGNITUDE_LUT_INKFLOOR } from "./physics";

/** Deterministic per-panel noise, so a mark's character is stable per key. */
function seeded(input: string): () => number {
  const str = String(input);
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Law 4: a slow afterglow under the fast front. Scenes own their own scorch
 *  buffer and composite it into the charge buffer each frame. */
interface Afterglow {
  scorch: Float32Array;
  mag: Float32Array;
}
function useAfterglow(p: DotPanel, key: string): Afterglow {
  return p.useSim<Afterglow>(key, () => ({
    scorch: new Float32Array(p.W * p.H),
    mag: new Float32Array(p.W * p.H),
  }));
}

function compositeAfterglow(p: DotPanel, a: Afterglow, decay: number): void {
  const n = p.W * p.H;
  for (let i = 0; i < n; i++) {
    const s = a.scorch[i];
    if (s <= 0.004) {
      a.scorch[i] = 0;
      continue;
    }
    // The afterglow never outshines the front; it is a stain, not a light.
    const v = s * 0.55;
    if (v > p.buf[i]) p.buf[i] = v;
    if (p.magnitude) p.magnitude[i] = a.mag[i];
    a.scorch[i] = s * decay;
  }
}

// ---- Track 1: repairs ----------------------------------------------------

/**
 * work — determinate background task.
 * The production version calls buf.fill(0) every frame, deleting the phosphor,
 * then paints a flat checkerboard: a progress bar in a dot costume. Here the
 * front is a soft advancing wave with a gradient wake, the completed region
 * keeps a textured stain, and ticks are events rather than a smooth fill.
 */
export const workV2: SceneFn = (p, t) => {
  const a = useAfterglow(p, "workV2");
  p.fade(0.88);
  const prog = (t % 5200) / 5200;
  const edge = prog * p.W;
  // Soft leading front, brightest at the edge and trailing off behind it.
  for (let y = 0; y < p.H; y++) {
    for (let x = 0; x < p.W; x++) {
      const d = edge - x;
      if (d < 0 || d > p.W * 0.35) continue;
      const falloff = 1 - d / (p.W * 0.35);
      const grain = 0.55 + 0.45 * Math.sin(x * 1.7 + y * 2.3);
      const v = falloff * falloff * 0.85 * grain;
      if (v > 0.02) {
        p.add(x, y, v * 0.5);
        const i = y * p.W + x;
        if (falloff > 0.72) {
          a.scorch[i] = Math.max(a.scorch[i], falloff);
          a.mag[i] = 0.45 + 0.4 * falloff;
        }
      }
    }
  }
  // Quantised ticks along the base: steps, not a smooth fill.
  const steps = 8;
  for (let s = 0; s < steps; s++) {
    const x = Math.round(((s + 0.5) / steps) * (p.W - 1));
    const done = x < edge;
    p.set(x, p.H - 1, done ? 0.8 : 0.14);
  }
  compositeAfterglow(p, a, 0.972);
};

/**
 * fault — disconnected.
 * The production version lights one row of a fourteen-row lattice, so ~90% of
 * the panel is empty. Here the whole field is losing charge: it de-energises
 * from the edges inward and the broken trace is the last thing still lit,
 * twitching, over the resident's own cooling ghost.
 */
export const faultV2: SceneFn = (p, t) => {
  const a = useAfterglow(p, "faultV2");
  const rnd = p.useSim<() => number>("faultV2rnd", () =>
    seeded(`${p.opt.seed}f`),
  );
  p.fade(0.93);
  const cx = (p.W - 1) / 2;
  const cy = (p.H - 1) / 2;
  const maxR = Math.hypot(cx, cy);
  // A collapsing horizon: everything outside it has already gone dark.
  const horizon = maxR * (0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t / 5400)));
  for (let y = 0; y < p.H; y++) {
    for (let x = 0; x < p.W; x++) {
      const r = Math.hypot(x - cx, y - cy);
      if (r > horizon) continue;
      // Dying static: sparse, dim, biased to the centre.
      if (rnd() < 0.03) {
        p.add(x, y, 0.05 + 0.14 * (1 - r / horizon));
      }
    }
  }
  // The broken trace: still the strongest thing, with a gap and a jitter.
  const y0 = Math.round(cy);
  const gap = Math.round(p.W * 0.5);
  const gapW = Math.max(2, p.W * 0.11);
  const jitter = Math.sin(t / 190) > 0.82 ? 1 : 0;
  for (let x = 0; x < p.W; x++) {
    if (Math.abs(x - gap) < gapW) continue;
    const yy = y0 + (x > gap ? jitter : 0);
    const falloff = 1 - Math.abs(x - cx) / (p.W * 0.75);
    p.set(x, yy, 0.35 + 0.4 * Math.max(0, falloff));
    const i = yy * p.W + x;
    a.scorch[i] = Math.max(a.scorch[i], 0.5);
    a.mag[i] = 0.05;
  }
  // The one surviving contact, arcing across the gap.
  if (Math.sin(t / 640) > 0.93) {
    p.add(gap, y0, 0.9);
    if (p.magnitude) p.magnitude[y0 * p.W + gap] = 0.95;
  }
  compositeAfterglow(p, a, 0.985);
};

/**
 * recall — reading memory.
 * The production version toggles nine points between 1.0 and 0.2 so nothing
 * reads as *found*. Here the sweep is a continuous gradient (as in `pulse`) and
 * every memory carries its own decay envelope: it flares when the beam crosses
 * it, then cools. The count you see is literally how many were pulled.
 */
interface RecallState {
  pts: Array<{ x: number; y: number; charge: number }>;
}
export const recallV2: SceneFn = (p, t) => {
  const st = p.useSim<RecallState>("recallV2", () => {
    const rnd = seeded(`${p.opt.seed}r2`);
    const pts = [];
    const n = Math.max(7, Math.round(p.W * p.H * 0.035));
    for (let i = 0; i < n; i++) {
      pts.push({ x: rnd(), y: rnd(), charge: 0 });
    }
    return { pts };
  });
  const a = useAfterglow(p, "recallV2glow");
  p.fade(0.9);
  const cx = (p.W - 1) / 2;
  const cy = (p.H - 1) / 2;
  const ang = (t / 1900) % (Math.PI * 2);
  const maxR = Math.min(p.W, p.H) * 0.48;

  // Continuous beam with an angular falloff — a wedge of light, not a line.
  for (let y = 0; y < p.H; y++) {
    for (let x = 0; x < p.W; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      if (r > maxR || r < 0.5) continue;
      let pa = Math.atan2(dy, dx);
      if (pa < 0) pa += Math.PI * 2;
      let d = Math.abs(pa - ang);
      if (d > Math.PI) d = Math.PI * 2 - d;
      const wedge = Math.max(0, 1 - d / 0.42);
      if (wedge <= 0) continue;
      const radial = 0.25 + 0.6 * (r / maxR);
      p.add(x, y, wedge * wedge * radial * 0.5);
    }
  }

  // Memories flare as the beam crosses them, then cool on their own envelope.
  for (const pt of st.pts) {
    const x = 1 + pt.x * (p.W - 2);
    const y = 1 + pt.y * (p.H - 2);
    let pa = Math.atan2(y - cy, x - cx);
    if (pa < 0) pa += Math.PI * 2;
    let d = Math.abs(pa - ang);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d < 0.2) pt.charge = 1;
    pt.charge *= 0.955;
    if (pt.charge > 0.01) {
      p.disc(x, y, 0.6 + 1.7 * pt.charge, 0.35 + 0.65 * pt.charge, true);
      const i = Math.round(y) * p.W + Math.round(x);
      if (i >= 0 && i < a.scorch.length) {
        a.scorch[i] = Math.max(a.scorch[i], pt.charge * 0.8);
        a.mag[i] = 0.35 + 0.5 * pt.charge;
      }
    }
  }
  compositeAfterglow(p, a, 0.976);
};

/** net — charge travelling along the links rather than nodes blinking. */
interface NetState {
  nodes: Array<[number, number]>;
  pulses: Array<{ from: number; to: number; at: number; speed: number }>;
}
export const netV2: SceneFn = (p, t) => {
  const st = p.useSim<NetState>("netV2", () => {
    const rnd = seeded(`${p.opt.seed}n2`);
    const nodes: Array<[number, number]> = [];
    for (let i = 0; i < 6; i++) {
      nodes.push([0.16 + rnd() * 0.68, 0.18 + rnd() * 0.64]);
    }
    const pulses = [];
    for (let i = 0; i < 4; i++) {
      pulses.push({
        from: Math.floor(rnd() * 6),
        to: Math.floor(rnd() * 6),
        at: rnd(),
        speed: 0.004 + rnd() * 0.006,
      });
    }
    return { nodes, pulses };
  });
  p.fade(0.9);
  const px = (n: [number, number]) => 1 + n[0] * (p.W - 2);
  const py = (n: [number, number]) => 1 + n[1] * (p.H - 2);

  for (let i = 0; i < st.nodes.length; i++) {
    const a = st.nodes[i];
    const b = st.nodes[(i + 2) % st.nodes.length];
    p.link(px(a), py(a), px(b), py(b), 0.14);
  }
  for (const pulse of st.pulses) {
    const a = st.nodes[pulse.from];
    const b = st.nodes[pulse.to];
    if (a === b) continue;
    pulse.at += pulse.speed;
    if (pulse.at > 1) {
      pulse.at = 0;
      pulse.from = pulse.to;
      pulse.to =
        (pulse.to + 1 + Math.floor(Math.random() * 4)) % st.nodes.length;
    }
    const x = px(a) + (px(b) - px(a)) * pulse.at;
    const y = py(a) + (py(b) - py(a)) * pulse.at;
    p.disc(x, y, 1.4, 0.95, true);
  }
  for (const n of st.nodes) {
    p.disc(px(n), py(n), 1.1, 0.4 + 0.2 * Math.sin(t / 1300 + n[0] * 9), true);
  }
};

/** sleep — the well nearly out, but settling rather than dead. */
export const sleepV2: SceneFn = (p, t) => {
  p.fade(0.975);
  // ONE broad maximum drifting across the whole panel — not a repeating grid.
  // Spatial frequency has to stay below a single cycle per field, or the
  // "swell" reads as a texture of blobs instead of a well going out.
  const phase = t / 11000;
  const cx = p.W * (0.5 + 0.32 * Math.sin(phase));
  const cy = p.H * (0.5 + 0.32 * Math.cos(phase * 0.61));
  const reach = Math.max(p.W, p.H) * 0.6;
  for (let y = 0; y < p.H; y++) {
    for (let x = 0; x < p.W; x++) {
      const d = Math.hypot(x - cx, y - cy) / reach;
      if (d >= 1) continue;
      const v = 0.009 * (1 - d) * (1 - d);
      if (v > 0.003) p.add(x, y, v);
    }
  }
  if (Math.random() < 0.07) {
    p.add(
      Math.floor(Math.random() * p.W),
      Math.floor(Math.random() * p.H),
      0.34,
    );
  }
};

// ---- Track 2: the sandpile substrate -------------------------------------
//
// PROMOTED. These same five forcings are now the production `listen`, `think`,
// `work` and `net` scenes (see `engine.ts`). They are kept here under their lab
// names, with their own simulation keys, so the lab can still show all five side
// by side at every size.

/** thinking — pour at the centre; cascades bloom outward. */
export const pileThink = pileScene("pileThink", 34, (p) => [
  p.W >> 1,
  p.H >> 1,
]);

/** working — a metered pour that walks across the field. */
export const pileWork = pileScene("pileWork", 26, (p, _st, t) => [
  Math.floor(((t / 5200) % 1) * p.W),
  p.H >> 1,
]);

/** remembering — the pour orbits, so cascades light what it passes. */
export const pileRecall = pileScene("pileRecall", 24, (p, st) => {
  st.angle += 0.06;
  const r = Math.min(p.W, p.H) * 0.3;
  return [
    (p.W >> 1) + Math.cos(st.angle) * r,
    (p.H >> 1) + Math.sin(st.angle) * r,
  ];
});

/** listening — barely fed, so the field sits just below critical and the
 *  occasional micro-topple *is* the twinkle. */
export const pileListen = pileScene("pileListen", 4, (p) => [
  Math.floor(Math.random() * p.W),
  Math.floor(Math.random() * p.H),
]);

/** a room — two pour points, cascades colliding. */
export const pileNet = pileScene("pileNet", 22, (p, st, t) => {
  const which = Math.sin(t / 1700) > 0 ? 0.3 : 0.7;
  st.angle += 0.02;
  return [
    Math.floor(p.W * which),
    Math.floor(p.H * (0.4 + 0.2 * Math.sin(st.angle))),
  ];
});

// ---- Track 3: new physical substrates -------------------------------------

/** PROMOTED as the production `recall`. Re-exported under its lab name so the
 *  lab still shows it in the Track 3 row. */
export const dla = dlaScene;

/**
 * think (Chladni) — sand settling onto the nodal lines of a vibrating plate.
 * The spec already describes thinking as "noise resolving into order, then
 * loosening"; that is literally what a Chladni plate does. Drifting the drive
 * frequency means it never repeats.
 */
export const chladni: SceneFn = (p, t) => {
  p.fade(0.87);
  // Irrational-ratio drift: the mode never returns to where it started.
  const m = 2.4 + 1.6 * (0.5 + 0.5 * Math.sin(t / 7300));
  const n = 2.1 + 1.9 * (0.5 + 0.5 * Math.sin(t / 5100 + 1.7));
  const order = 0.5 + 0.5 * Math.sin(t / 4300);
  for (let y = 0; y < p.H; y++) {
    for (let x = 0; x < p.W; x++) {
      const u = (x + 0.5) / p.W;
      const v = (y + 0.5) / p.H;
      // Standing-wave amplitude; sand collects where it is ~zero.
      const amp =
        Math.sin(m * Math.PI * u) * Math.sin(n * Math.PI * v) +
        Math.sin(n * Math.PI * u) * Math.sin(m * Math.PI * v);
      const nodal = 1 - Math.min(1, Math.abs(amp) * 2.6);
      if (nodal <= 0.02) continue;
      // Order parameter loosens the lines back into noise and re-forms them.
      const jitter = (1 - order) * (Math.random() - 0.5) * 1.6;
      p.add(x + jitter, y + jitter, nodal * nodal * (0.16 + 0.5 * order));
    }
  }
};

/**
 * net (wave interference) — each participant is a source; when residents talk
 * the waves genuinely interfere. The metaphor is the physics.
 */
export const interference: SceneFn = (p, t) => {
  const src = p.useSim<Array<[number, number, number]>>("interference", () => {
    const rnd = seeded(`${p.opt.seed}w`);
    return [
      [0.26, 0.32, 1],
      [0.74, 0.38, 1.13],
      [0.5, 0.78, 0.87],
    ].map(
      (s) =>
        [s[0] + (rnd() - 0.5) * 0.1, s[1] + (rnd() - 0.5) * 0.1, s[2]] as [
          number,
          number,
          number,
        ],
    );
  });
  p.fade(0.8);
  for (let y = 0; y < p.H; y++) {
    for (let x = 0; x < p.W; x++) {
      let sum = 0;
      for (const s of src) {
        const sx = s[0] * p.W;
        const sy = s[1] * p.H;
        const r = Math.hypot(x - sx, y - sy);
        // Radiating wave with 1/r falloff so sources stay legible.
        sum += Math.sin(r * 1.15 - (t / 420) * s[2]) / (1 + r * 0.28);
      }
      const v = sum * 0.5;
      if (v > 0.06) p.add(x, y, v * 0.55);
    }
  }
};

/**
 * listen (curl-noise flow) — dots advected by a divergence-free field, leaving
 * phosphor trails. Reads as current; ambient and alive.
 */
interface FlowState {
  parts: Array<{ x: number; y: number }>;
}
export const flow: SceneFn = (p, t) => {
  const st = p.useSim<FlowState>("flow", () => {
    const parts = [];
    const n = Math.max(10, Math.round(p.W * p.H * 0.09));
    for (let i = 0; i < n; i++) {
      parts.push({ x: Math.random() * p.W, y: Math.random() * p.H });
    }
    return { parts };
  });
  p.fade(0.9);
  const time = t / 3400;
  for (const q of st.parts) {
    // Streamfunction psi = sin(xs + t) · cos(ys − 0.7t); velocity is its curl,
    // u = ∂psi/∂y and v = −∂psi/∂x, which is divergence-free by construction.
    // (Getting these two swapped makes the field a gradient instead, and every
    // particle drains into a sink — which is why this scene rendered empty.)
    const s = 0.42;
    const u = -s * Math.sin(q.x * s + time) * Math.sin(q.y * s - time * 0.7);
    const v = -s * Math.cos(q.x * s + time) * Math.cos(q.y * s - time * 0.7);
    q.x += u * 3.4;
    q.y += v * 3.4;
    if (q.x < 0) q.x += p.W;
    if (q.x >= p.W) q.x -= p.W;
    if (q.y < 0) q.y += p.H;
    if (q.y >= p.H) q.y -= p.H;
    p.add(q.x, q.y, 0.26);
  }
};

export const labScenes: Record<string, SceneFn> = {
  workV2,
  faultV2,
  recallV2,
  netV2,
  sleepV2,
  pileThink,
  pileWork,
  pileRecall,
  pileListen,
  pileNet,
  chladni,
  dla,
  interference,
  flow,
};
