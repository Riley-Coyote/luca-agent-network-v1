/**
 * EXPERIMENTAL scene table — exploration only, not wired into the app.
 *
 * The production table in `engine.ts` stays untouched until Riley picks winners
 * from the lab. Everything here obeys the house laws that separate the good
 * scenes from the weak ones:
 *
 *   1. Never clear the charge buffer — persistence is the medium.
 *   2. No flat values — every write carries a gradient, falloff or noise.
 *   3. Fill the field — a scene using one row reads as underdeveloped.
 *   4. Two timescales — a fast front over a slow afterglow gives depth.
 *   5. Never loop — aperiodic drivers, so nothing visibly repeats.
 *   6. Prefer continuous maths sampled onto the lattice over bookkeeping.
 */

import type { DotPanel, SceneFn } from "./engine";

/** indigo whisper -> violet -> magenta -> coral -> amber -> white-hot */
const MAGNITUDE_STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [38, 48, 116]],
  [0.2, [104, 54, 182]],
  [0.42, [196, 58, 150]],
  [0.62, [240, 96, 86]],
  [0.8, [250, 168, 66]],
  [1.0, [255, 242, 220]],
];

export function buildMagnitudeLut(): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = MAGNITUDE_STOPS[0];
    let b = MAGNITUDE_STOPS[MAGNITUDE_STOPS.length - 1];
    for (let s = 0; s < MAGNITUDE_STOPS.length - 1; s++) {
      if (t >= MAGNITUDE_STOPS[s][0] && t <= MAGNITUDE_STOPS[s + 1][0]) {
        a = MAGNITUDE_STOPS[s];
        b = MAGNITUDE_STOPS[s + 1];
        break;
      }
    }
    const f = (t - a[0]) / (b[0] - a[0] || 1);
    lut[i * 3] = (a[1][0] + (b[1][0] - a[1][0]) * f) | 0;
    lut[i * 3 + 1] = (a[1][1] + (b[1][1] - a[1][1]) * f) | 0;
    lut[i * 3 + 2] = (a[1][2] + (b[1][2] - a[1][2]) * f) | 0;
  }
  return lut;
}

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
  // A very slow, very dim swell so large panels are not simply empty.
  const phase = t / 9000;
  for (let y = 0; y < p.H; y++) {
    for (let x = 0; x < p.W; x++) {
      const v =
        0.012 *
        (0.5 + 0.5 * Math.sin(x * 0.29 + phase)) *
        (0.5 + 0.5 * Math.cos(y * 0.31 - phase * 0.7));
      if (v > 0.004) p.add(x, y, v);
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

interface PileState {
  grid: Int16Array;
  delta: Int16Array;
  scorch: Float32Array;
  smag: Float32Array;
  size: number;
  scale: number;
  inAvalanche: boolean;
  acc: number;
  angle: number;
}

function usePile(p: DotPanel, key: string, preseed: number): PileState {
  return p.useSim<PileState>(key, () => {
    const n = p.W * p.H;
    const st: PileState = {
      grid: new Int16Array(n),
      delta: new Int16Array(n),
      scorch: new Float32Array(n),
      smag: new Float32Array(n),
      size: 0,
      scale: 0,
      inAvalanche: false,
      acc: 0,
      angle: 0,
    };
    // Drive it to criticality before first paint, so it is already alive.
    const cx = p.W >> 1;
    const cy = p.H >> 1;
    for (let k = 0; k < preseed; k++) {
      st.grid[cy * p.W + cx]++;
      let guard = 0;
      while (sweepPile(p, st) > 0 && guard++ < 400) {
        /* relax */
      }
    }
    st.scorch.fill(0);
    return st;
  });
}

/** One simultaneous toppling sweep. Abelian: order does not matter. */
function sweepPile(p: DotPanel, st: PileState): number {
  const { W, H } = p;
  st.delta.fill(0);
  let fired = 0;
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      if (st.grid[i] < 4) continue;
      st.delta[i] -= 4;
      if (x > 0) st.delta[i - 1]++;
      if (x < W - 1) st.delta[i + 1]++;
      if (y > 0) st.delta[i - W]++;
      if (y < H - 1) st.delta[i + W]++;
      st.scorch[i] = 1;
      st.smag[i] = st.scale;
      fired++;
    }
  }
  if (fired) {
    for (let i = 0; i < st.grid.length; i++) st.grid[i] += st.delta[i];
  }
  return fired;
}

const SCALE_DEN = Math.log2(220);
const scaleOf = (size: number) =>
  Math.min(1, Math.max(0, Math.log2(size + 1) / SCALE_DEN) ** 0.82);

/**
 * The systemic idea: one critical field, many forcings. `pour` decides where
 * grains land, which is the only difference between thinking, working,
 * remembering and resting.
 */
function pileScene(
  key: string,
  rate: number,
  pour: (p: DotPanel, st: PileState, t: number) => [number, number],
): SceneFn {
  return (p, t) => {
    const st = usePile(p, key, 90);
    p.fade(0.86);

    if (st.inAvalanche || sweepPileHasUnstable(st)) {
      st.inAvalanche = true;
      const fired = sweepPile(p, st);
      st.size += fired;
      st.scale = scaleOf(st.size);
      if (!fired) {
        st.inAvalanche = false;
        st.size = 0;
      }
    } else {
      st.acc += rate / 60;
      while (st.acc >= 1) {
        const [x, y] = pour(p, st, t);
        const i = (y | 0) * p.W + (x | 0);
        if (i >= 0 && i < st.grid.length) st.grid[i]++;
        st.acc -= 1;
        st.scale = 0;
      }
    }

    // Resting tension: the stored slope, always faintly visible.
    for (let i = 0; i < st.grid.length; i++) {
      const g = st.grid[i];
      if (g > 0) {
        const v = 0.05 + 0.055 * Math.min(3, g);
        if (v > p.buf[i]) p.buf[i] = v;
      }
      const s = st.scorch[i];
      if (s > 0.004) {
        const v = s * 0.9;
        if (v > p.buf[i]) p.buf[i] = v;
        if (p.magnitude) p.magnitude[i] = st.smag[i];
        st.scorch[i] = s * 0.9;
      } else if (s) {
        st.scorch[i] = 0;
      }
    }
  };
}

function sweepPileHasUnstable(st: PileState): boolean {
  for (let i = 0; i < st.grid.length; i++) if (st.grid[i] >= 4) return true;
  return false;
}

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
 * recall (DLA) — walkers wander until they stick to what is already
 * remembered, so memory visibly accretes. Slow and hypnotic.
 */
interface DlaState {
  stuck: Uint8Array;
  walkers: Array<{ x: number; y: number }>;
  age: Float32Array;
}
export const dla: SceneFn = (p) => {
  const st = p.useSim<DlaState>("dla", () => {
    const stuck = new Uint8Array(p.W * p.H);
    const age = new Float32Array(p.W * p.H);
    stuck[(p.H >> 1) * p.W + (p.W >> 1)] = 1;
    const walkers = [];
    for (let i = 0; i < 14; i++) {
      walkers.push({
        x: Math.floor(Math.random() * p.W),
        y: Math.floor(Math.random() * p.H),
      });
    }
    return { stuck, walkers, age };
  });
  p.fade(0.9);

  const neighbourStuck = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= p.W || ny >= p.H) continue;
        if (st.stuck[ny * p.W + nx]) return true;
      }
    }
    return false;
  };

  for (const w of st.walkers) {
    w.x = Math.max(0, Math.min(p.W - 1, w.x + (Math.random() < 0.5 ? -1 : 1)));
    w.y = Math.max(0, Math.min(p.H - 1, w.y + (Math.random() < 0.5 ? -1 : 1)));
    p.add(w.x, w.y, 0.3);
    if (neighbourStuck(w.x, w.y)) {
      const i = w.y * p.W + w.x;
      st.stuck[i] = 1;
      st.age[i] = 1;
      w.x = Math.floor(Math.random() * p.W);
      w.y = Math.floor(Math.random() * p.H);
    }
  }
  // The aggregate: freshly-stuck cells are bright and cool into the structure.
  for (let i = 0; i < st.stuck.length; i++) {
    if (!st.stuck[i]) continue;
    const a = st.age[i];
    const v = 0.34 + 0.62 * a;
    if (v > p.buf[i]) p.buf[i] = v;
    if (p.magnitude) p.magnitude[i] = 0.25 + 0.65 * a;
    if (a > 0) st.age[i] = a * 0.96;
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
    // Streamfunction psi; velocity is its curl, so the flow never diverges.
    const s = 0.42;
    const dpsiDy =
      Math.cos(q.x * s + time) * Math.cos(q.y * s - time * 0.7) * 0.55;
    const dpsiDx =
      -Math.sin(q.x * s + time) * Math.sin(q.y * s - time * 0.7) * 0.55;
    q.x += dpsiDy;
    q.y += -dpsiDx;
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
