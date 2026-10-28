/**
 * How a fingerprint grows: the lab study's `prints.py`
 * (design-lab/agent-marks/grow/, branch claude/shell-lab-rail-faces), ported
 * line for line. Gray–Scott on a 96 × 96 grid, its diffusion faster along a
 * ridge flow than across it, the flow and the first stripes drawn from each
 * kind's phase, edges held. Only the random numbers are our own (numpy's
 * generator can't be matched), so the ridges differ from the study's while the
 * kinds and the rules stay the same (docs/luca/BETA14_RELEASE.md, WP-39).
 *
 * The grid here is read as the study reads it, row 0 at the top. What leaves
 * this module for a texture is flipped, row 0 at the bottom and y up, exactly
 * as `prints.py` exports it.
 */

/** The grid's side, in texels. */
export const N = 96;
/** The ridge period of a kind's phase, in texels. */
export const LAM = 8;

export const GROWTH = {
  F: 0.0545,
  k: 0.062,
  Du: 0.2,
  Dv: 0.1,
  dt: 1,
  /** Diffusion along the ridge flow and across it. */
  along: 2.1,
  across: 0.17,
  steps: 4000,
} as const;

/** Bumped whenever the growth changes, so a cached print is grown again. */
export const GROWTH_VERSION = 1;

export const FINGERPRINT_KINDS = [
  "whorl",
  "loop",
  "arch",
  "sideloop",
  "double",
] as const;

export type FingerprintKind = (typeof FINGERPRINT_KINDS)[number];

/** A little 9-point evenness, so the round kinds stay round. */
export const KIND_ISO: Record<FingerprintKind, number> = {
  whorl: 0.12,
  double: 0.12,
  loop: 0.06,
  arch: 0,
  sideloop: 0.06,
};

/** Mulberry32: the seeded generator the study's motion already uses. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function segDist(
  X: number,
  Y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.min(
    1,
    Math.max(0, ((X - ax) * vx + (Y - ay) * vy) / (vx * vx + vy * vy)),
  );
  return Math.hypot(X - ax - t * vx, Y - ay - t * vy);
}

/** A kind's phase at a point of its rotated frame (`prints.py`, `phase`). */
function phaseAt(kind: FingerprintKind, Xr: number, Yr: number): number {
  switch (kind) {
    case "whorl":
      return Math.hypot(Xr, Yr) + (LAM * Math.atan2(Yr, Xr)) / (2 * Math.PI);
    case "loop":
      return Yr > 0 ? Math.hypot(Xr, Yr) : Math.abs(Xr) + 0.002 * Yr * Yr;
    case "arch":
      return Yr - 14 * Math.exp(-(Xr * Xr) / (2 * 16 * 16));
    case "sideloop": {
      const c = Math.cos(1.25);
      const s = Math.sin(1.25);
      const Xs = Xr * c - Yr * s;
      const Ys = Xr * s + Yr * c;
      return Ys > 0 ? Math.hypot(Xs, Ys) : Math.abs(Xs) + 0.002 * Ys * Ys;
    }
    case "double":
      return (
        segDist(Xr, Yr, -9, 5, 9, -5) +
        (LAM * Math.atan2(Yr, Xr)) / (2 * Math.PI)
      );
  }
}

/** One axis of numpy's `gradient`: central inside, one-sided at the edges. */
function gradientAt(
  phi: Float64Array,
  x: number,
  y: number,
  axis: "x" | "y",
): number {
  const at = (cx: number, cy: number) => phi[cy * N + cx];
  if (axis === "x") {
    if (x === 0) return at(1, y) - at(0, y);
    if (x === N - 1) return at(N - 1, y) - at(N - 2, y);
    return (at(x + 1, y) - at(x - 1, y)) / 2;
  }
  if (y === 0) return at(x, 1) - at(x, 0);
  if (y === N - 1) return at(x, N - 1) - at(x, N - 2);
  return (at(x, y + 1) - at(x, y - 1)) / 2;
}

/** Everything a growth starts from, on the study's grid (row 0 at the top). */
export type GrowthStart = {
  kind: FingerprintKind;
  iso: number;
  /** The print's core in texture texels (y up), where the wave runs from. */
  core: [number, number];
  /** The ridge flow's unit tangent, per cell. */
  tx: Float64Array;
  ty: Float64Array;
  U: Float64Array;
  V: Float64Array;
};

/** The phase, its flow and the first stripes (`prints.py`, `grow`'s head). */
export function startGrowth(kind: FingerprintKind, seed: number): GrowthStart {
  const rnd = mulberry32(seed);
  let cx = (rnd() - 0.5) * 10;
  let cy = (rnd() - 0.5) * 10;
  const rot = (rnd() - 0.5) * 0.7;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const phi = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const X0 = x - N / 2 + 0.5;
      const Y0 = N / 2 - 0.5 - y;
      const Xr = (X0 - cx) * cr - (Y0 - cy) * sr;
      const Yr = (X0 - cx) * sr + (Y0 - cy) * cr;
      phi[y * N + x] = phaseAt(kind, Xr, Yr);
    }
  }
  // An arch has no core: its wave runs from the middle.
  if (kind === "arch") cx = cy = 0;
  const tx = new Float64Array(N * N);
  const ty = new Float64Array(N * N);
  const U = new Float64Array(N * N);
  const V = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const gx = gradientAt(phi, x, y, "x");
      const gy = gradientAt(phi, x, y, "y");
      const g = Math.hypot(gx, gy) + 1e-6;
      tx[i] = -gy / g;
      ty[i] = gx / g;
    }
  }
  // numpy draws the whole grid's noise at once, on or off; so do we.
  for (let i = 0; i < N * N; i++) {
    const noise = rnd();
    const on = Math.sin((2 * Math.PI * phi[i]) / LAM) > 0.2 ? 1 : 0;
    V[i] = on * (0.25 + noise * 0.05);
    U[i] = 1 - 2 * V[i];
  }
  return {
    kind,
    iso: KIND_ISO[kind],
    core: [cx + N / 2, cy + N / 2],
    tx,
    ty,
    U,
    V,
  };
}

/** Bilinear taps at ±1 along the flow and across it, edges held. */
type Taps = { index: Int32Array; weight: Float64Array };

function buildTaps(start: GrowthStart): Taps {
  // Four taps per cell (+t, −t, +n, −n), four corners per tap.
  const index = new Int32Array(N * N * 16);
  const weight = new Float64Array(N * N * 16);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = y * N + x;
      const t0 = start.tx[c];
      const t1 = start.ty[c];
      const offsets: [number, number][] = [
        [t0, t1],
        [-t0, -t1],
        [-t1, t0],
        [t1, -t0],
      ];
      offsets.forEach(([dx, dy], k) => {
        const xs = Math.min(N - 1, Math.max(0, x + dx));
        const ys = Math.min(N - 1, Math.max(0, y + dy));
        const x0 = Math.floor(xs);
        const y0 = Math.floor(ys);
        const fx = xs - x0;
        const fy = ys - y0;
        const x1 = Math.min(x0 + 1, N - 1);
        const y1 = Math.min(y0 + 1, N - 1);
        const o = c * 16 + k * 4;
        index[o] = y0 * N + x0;
        index[o + 1] = y0 * N + x1;
        index[o + 2] = y1 * N + x0;
        index[o + 3] = y1 * N + x1;
        weight[o] = (1 - fx) * (1 - fy);
        weight[o + 1] = fx * (1 - fy);
        weight[o + 2] = (1 - fx) * fy;
        weight[o + 3] = fx * fy;
      });
    }
  }
  return { index, weight };
}

/** The eight neighbours of every cell, edges padded (`prints.py`, `lap9`). */
function buildNeighbours(): Int32Array {
  const out = new Int32Array(N * N * 8);
  const clamp = (v: number) => Math.min(N - 1, Math.max(0, v));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 8;
      const at = (dx: number, dy: number) => clamp(y + dy) * N + clamp(x + dx);
      out[o] = at(0, -1);
      out[o + 1] = at(0, 1);
      out[o + 2] = at(-1, 0);
      out[o + 3] = at(1, 0);
      out[o + 4] = at(-1, -1);
      out[o + 5] = at(1, -1);
      out[o + 6] = at(-1, 1);
      out[o + 7] = at(1, 1);
    }
  }
  return out;
}

/** A growth on the CPU, run in slices so a caller can yield between them. */
export class CpuGrowth {
  readonly start: GrowthStart;
  done = 0;
  private readonly taps: Taps;
  private readonly near: Int32Array;
  private readonly lu = new Float64Array(N * N);
  private readonly lv = new Float64Array(N * N);

  constructor(start: GrowthStart) {
    this.start = start;
    this.taps = buildTaps(start);
    this.near = buildNeighbours();
  }

  private laplace(A: Float64Array, out: Float64Array) {
    const { index, weight } = this.taps;
    const near = this.near;
    const a = GROWTH.along;
    const b = GROWTH.across;
    const iso = this.start.iso;
    for (let c = 0; c < N * N; c++) {
      const o = c * 16;
      let tap0 = 0;
      let tap1 = 0;
      let tap2 = 0;
      let tap3 = 0;
      for (let j = 0; j < 4; j++) {
        tap0 += A[index[o + j]] * weight[o + j];
        tap1 += A[index[o + 4 + j]] * weight[o + 4 + j];
        tap2 += A[index[o + 8 + j]] * weight[o + 8 + j];
        tap3 += A[index[o + 12 + j]] * weight[o + 12 + j];
      }
      const s = A[c];
      const n = c * 8;
      const adj = A[near[n]] + A[near[n + 1]] + A[near[n + 2]] + A[near[n + 3]];
      const dia =
        A[near[n + 4]] + A[near[n + 5]] + A[near[n + 6]] + A[near[n + 7]];
      out[c] =
        a * (tap0 + tap1 - 2 * s) +
        b * (tap2 + tap3 - 2 * s) +
        iso * (-s + 0.2 * adj + 0.05 * dia) * 4;
    }
  }

  /** Runs up to `count` more steps; true once all of them have run. */
  step(count: number): boolean {
    const { U, V } = this.start;
    const { F, k, Du, Dv, dt, steps } = GROWTH;
    const end = Math.min(steps, this.done + count);
    for (; this.done < end; this.done++) {
      this.laplace(U, this.lu);
      this.laplace(V, this.lv);
      for (let c = 0; c < N * N; c++) {
        const u = U[c];
        const v = V[c];
        const uvv = u * v * v;
        // Held to [0, 1], as the GPU's growth is: in range it changes nothing.
        U[c] = Math.min(
          1,
          Math.max(0, u + dt * (Du * this.lu[c] - uvv + F * (1 - u))),
        );
        V[c] = Math.min(
          1,
          Math.max(0, v + dt * (Dv * this.lv[c] + uvv - (F + k) * v)),
        );
      }
    }
    return this.done >= steps;
  }
}

/** A grid (row 0 at the top) as texture rows (row 0 at the bottom), U and V
 *  interleaved. */
export function toTextureUV(U: Float64Array, V: Float64Array): Float32Array {
  const out = new Float32Array(N * N * 2);
  for (let y = 0; y < N; y++) {
    const row = N - 1 - y;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const o = (row * N + x) * 2;
      out[o] = U[i];
      out[o + 1] = V[i];
    }
  }
  return out;
}

/** The flow as texture angles (y up), as `prints.py` exports `A`. */
export function toTextureAngle(start: GrowthStart): Float32Array {
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const row = N - 1 - y;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      out[row * N + x] = Math.atan2(-start.ty[i], start.tx[i]);
    }
  }
  return out;
}

/** A whole growth on the CPU, at once (the worker's job). */
export function growOnCpu(kind: FingerprintKind, seed: number): Float32Array {
  const growth = new CpuGrowth(startGrowth(kind, seed));
  growth.step(GROWTH.steps);
  return toTextureUV(growth.start.U, growth.start.V);
}

/** Where a kind's wave runs from, without growing anything. */
export function fingerprintCore(
  kind: FingerprintKind,
  seed: number,
): [number, number] {
  const rnd = mulberry32(seed);
  const cx = (rnd() - 0.5) * 10;
  const cy = (rnd() - 0.5) * 10;
  return kind === "arch" ? [N / 2, N / 2] : [cx + N / 2, cy + N / 2];
}
