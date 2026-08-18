/**
 * The physical substrates the status scenes are built on, plus the two colour
 * ramps that read them.
 *
 * This module exists because the sandpile is not one scene — it is one field
 * with many forcings. Thinking, working, remembering, resting and a room full
 * of residents are the SAME critical system pouring grains in different places.
 * Keeping the physics here (rather than inside any one scene) is what makes the
 * set read as a system instead of a sticker sheet.
 *
 * Imports from `engine` are type-only, so there is no runtime import cycle.
 */

import type { DotPanel, SceneFn } from "./engine";

// ---- colour --------------------------------------------------------------

export type Stop = [number, [number, number, number]];

/** Exported so the lab's readout ramps are built by the same code as the
 *  production ones — two ramp builders would drift. */
export function buildLut(stops: Stop[]): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) {
        a = stops[s];
        b = stops[s + 1];
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

/**
 * indigo whisper -> violet -> magenta -> coral -> amber -> white-hot.
 * Faithful to magnitude, but the cold end is a dark indigo that disappears on a
 * near-black floor. Correct for a large data display, wrong for a small mark.
 */
export const MAGNITUDE_LUT = buildLut([
  [0.0, [38, 48, 116]],
  [0.2, [104, 54, 182]],
  [0.42, [196, 58, 150]],
  [0.62, [240, 96, 86]],
  [0.8, [250, 168, 66]],
  [1.0, [255, 242, 220]],
]);

/**
 * The ramp the app actually uses. Quiet events stay in near-ink greyscale so a
 * resting mark is still legible on the #060608 floor; colour only enters once
 * something of real magnitude has happened. This is what lets one ramp serve
 * both as an identity mark and as a live dial.
 */
export const MAGNITUDE_LUT_INKFLOOR = buildLut([
  [0.0, [188, 192, 196]],
  [0.3, [150, 150, 175]],
  [0.5, [196, 58, 150]],
  [0.72, [240, 120, 86]],
  [0.88, [250, 178, 76]],
  [1.0, [255, 244, 226]],
]);

// ---- the sandpile --------------------------------------------------------

/** Exported because `pileScene`'s `pour` callback receives it, so it appears in
 *  the public signature. */
export interface PileState {
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

function hasUnstable(st: PileState): boolean {
  for (let i = 0; i < st.grid.length; i++) if (st.grid[i] >= 4) return true;
  return false;
}

/** Calibrates when an avalanche reads as "big". Avalanche sizes follow a power
 *  law, so a log scale is what keeps the common small ones from all mapping to
 *  the same cold value. */
const SCALE_DEN = Math.log2(220);
const scaleOf = (size: number) =>
  Math.min(1, Math.max(0, Math.log2(size + 1) / SCALE_DEN) ** 0.82);

/**
 * One critical field, many forcings. `pour` decides where grains land, which is
 * the only difference between thinking, working, remembering and resting.
 *
 * `key` namespaces the per-panel simulation state, so switching a panel between
 * two pile scenes cannot read the other one's grid back as garbage.
 */
export function pileScene(
  key: string,
  rate: number,
  pour: (p: DotPanel, st: PileState, t: number) => [number, number],
): SceneFn {
  return (p, t) => {
    const st = usePile(p, key, 90);
    p.fade(0.86);

    if (st.inAvalanche || hasUnstable(st)) {
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

    // Resting tension: the stored slope, always faintly visible. This is what
    // fills the field (law 3) between avalanches, and it is why the mark never
    // reads as empty even when nothing is happening.
    //
    // Kept deliberately low. At 28px the lattice is only ~14 cells across, so
    // each cell is large and a bright slope reads as chunky static rather than
    // as texture — and it drowns the avalanche, which is the thing worth
    // looking at. The slope is the paper; the cascade is the writing.
    for (let i = 0; i < st.grid.length; i++) {
      const g = st.grid[i];
      if (g > 0) {
        const v = 0.028 + 0.034 * Math.min(3, g);
        if (v > p.buf[i]) p.buf[i] = v;
      }
      const s = st.scorch[i];
      if (s > 0.004) {
        const v = s * 0.9;
        if (v > p.buf[i]) p.buf[i] = v;
        // Magnitude fades WITH the scorch. Holding the last value would leave
        // an old avalanche site permanently hot once the resting slope is all
        // that remains there.
        if (p.magnitude) p.magnitude[i] = st.smag[i] * s;
        st.scorch[i] = s * 0.9;
      } else if (s) {
        st.scorch[i] = 0;
        if (p.magnitude) p.magnitude[i] = 0;
      }
    }
  };
}

// ---- diffusion-limited aggregation ---------------------------------------

interface DlaState {
  stuck: Uint8Array;
  walkers: Array<{ x: number; y: number }>;
  age: Float32Array;
  /** Current aggregate extent, used to release walkers just outside it. */
  radius: number;
  count: number;
}

function makeDla(p: DotPanel): DlaState {
  const stuck = new Uint8Array(p.W * p.H);
  const age = new Float32Array(p.W * p.H);
  stuck[(p.H >> 1) * p.W + (p.W >> 1)] = 1;
  age[(p.H >> 1) * p.W + (p.W >> 1)] = 1;
  const walkers = [];
  const n = Math.max(6, Math.round(Math.min(p.W, p.H) * 0.7));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    walkers.push({
      x: (p.W - 1) / 2 + Math.cos(a) * 3,
      y: (p.H - 1) / 2 + Math.sin(a) * 3,
    });
  }
  return { stuck, walkers, age, radius: 1, count: 1 };
}

/**
 * Walkers stick to what is already remembered, so memory visibly accretes into
 * a dendrite. Slow and hypnotic, and — unusually for a fine-structured scene —
 * it survives 28px, because the branches are one cell wide either way.
 */
export const dlaScene: SceneFn = (p) => {
  const st = p.useSim<DlaState>("dla", () => makeDla(p));
  p.fade(0.9);

  const cx = (p.W - 1) / 2;
  const cy = (p.H - 1) / 2;
  const bound = Math.min(p.W, p.H) * 0.46;

  const neighbourStuck = (x: number, y: number) => {
    // 4-neighbourhood: 8 lets walkers slip diagonally past a branch and fills
    // the interior, which destroys the dendrite.
    if (x > 0 && st.stuck[y * p.W + x - 1]) return true;
    if (x < p.W - 1 && st.stuck[y * p.W + x + 1]) return true;
    if (y > 0 && st.stuck[(y - 1) * p.W + x]) return true;
    if (y < p.H - 1 && st.stuck[(y + 1) * p.W + x]) return true;
    return false;
  };

  /** Release on a ring just outside the aggregate — the standard trick, and
   *  what makes growth read as radial rather than as scattered clumps. */
  const release = (w: { x: number; y: number }) => {
    const a = Math.random() * Math.PI * 2;
    const r = Math.min(bound, st.radius + 2.5);
    w.x = cx + Math.cos(a) * r;
    w.y = cy + Math.sin(a) * r;
  };

  // Several steps per frame: one step per frame grows far too slowly to watch.
  for (let step = 0; step < 5; step++) {
    for (const w of st.walkers) {
      // Proper 4-direction walk. Moving both axes every step biases the whole
      // aggregate along the diagonals.
      const d = (Math.random() * 4) | 0;
      if (d === 0) w.x += 1;
      else if (d === 1) w.x -= 1;
      else if (d === 2) w.y += 1;
      else w.y -= 1;

      const rr = Math.hypot(w.x - cx, w.y - cy);
      if (rr > bound + 4) {
        release(w);
        continue;
      }
      const ix = Math.round(w.x);
      const iy = Math.round(w.y);
      if (ix < 0 || iy < 0 || ix >= p.W || iy >= p.H) {
        release(w);
        continue;
      }
      if (step === 4) p.add(ix, iy, 0.22);
      if (neighbourStuck(ix, iy)) {
        const i = iy * p.W + ix;
        st.stuck[i] = 1;
        st.age[i] = 1;
        st.radius = Math.max(st.radius, rr);
        st.count++;
        release(w);
      }
    }
  }

  // Regrow once it reaches the edge, so the mark keeps evolving.
  if (st.radius >= bound - 1 || st.count > p.W * p.H * 0.3) {
    Object.assign(st, makeDla(p));
  }

  // Fresh tips burn bright and cool into the structure, so the growing edge is
  // always the brightest thing and the trunk reads as older.
  for (let i = 0; i < st.stuck.length; i++) {
    if (!st.stuck[i]) continue;
    const a = st.age[i];
    const v = 0.3 + 0.68 * a;
    if (v > p.buf[i]) p.buf[i] = v;
    if (p.magnitude) p.magnitude[i] = 0.2 + 0.7 * a;
    if (a > 0.001) st.age[i] = a * 0.985;
  }
};
