/**
 * Parametric abelian sandpile — the lab's simulation core.
 *
 * The production `pileScene` (`../physics.ts`) is this same object frozen behind
 * three constants: a fixed threshold of 4, a fixed square lattice, and a preseed
 * of 90 grains regardless of area. This module unfreezes all of it so the
 * substrate can actually be explored.
 *
 * Three properties are load-bearing and must not be "simplified" away:
 *
 * 1. **Sweeps are parallel.** Every unstable cell topples in the same sweep. The
 *    abelian property (Dhar 1990) says the final configuration does not depend
 *    on the order, so this is exact — and the simultaneity is the only reason an
 *    avalanche reads as a *wavefront* rather than as a spreading stain.
 * 2. **Grains are conserved except where they leave.** A topple removes exactly
 *    `threshold` grains and delivers exactly `threshold` to neighbours. Grains
 *    vanish only off an open boundary or into a sink. Break this and it stops
 *    being a sandpile — the conservation test in `pile-core.test.mjs` is the
 *    guard.
 * 3. **Drive and relax are separated in time.** Grains are poured only while the
 *    field is stable. That separation of timescales is what drives the system to
 *    criticality on its own; pouring during an avalanche destroys it.
 */

export type LatticeKind = "square" | "square8" | "triangular" | "honeycomb";
export type BoundaryKind = "open" | "torus";
export type DriveMode = "centre" | "orbit" | "walk" | "two" | "pointer" | "off";

export interface PileConfig {
  /** Grains a cell holds before it topples. Below the lattice degree the field
   *  can never fully stabilise (living terrain); above it, a frozen crust. */
  threshold: number;
  lattice: LatticeKind;
  /** `open` dissipates at the edges, which is what maintains criticality.
   *  `torus` wraps, so nothing ever leaves and the field eventually chokes. */
  boundary: BoundaryKind;
  /** Anisotropy: direction the pile drifts, and how hard. */
  biasAngle: number;
  biasStrength: number;
  /** Grains per second, while stable. */
  rate: number;
  drive: DriveMode;
  /** Toppling sweeps per frame, fractional. Below 1 a single avalanche is
   *  stretched over many frames — the only way to actually watch one. */
  sweepsPerFrame: number;
  recencyDecay: number;
  fluxDecay: number;
  /** Grains per CELL used to drive the field to criticality before first paint.
   *  Production hardcodes a flat 90 regardless of area, which is 0.46/cell on
   *  the 14x14 rail it was tuned for and 0.056/cell at 40x40 — the reason every
   *  pile scene opens as a blob at any size above the rail. */
  preseedPerCell: number;
}

export const DEFAULT_CONFIG: PileConfig = {
  threshold: 4,
  lattice: "square",
  boundary: "open",
  biasAngle: 0,
  biasStrength: 0,
  rate: 34,
  drive: "centre",
  sweepsPerFrame: 1,
  recencyDecay: 0.9,
  fluxDecay: 0.86,
  preseedPerCell: 0.46,
};

// ---- lattices ------------------------------------------------------------
//
// Every table is ordered by increasing angle. Anisotropy weights are indexed by
// direction slot, so consistent angular ordering is what lets one weight array
// serve the parity-dependent lattices too (their vectors differ slightly between
// even and odd rows, but slot `d` stays in the same angular sector).

type Vec = readonly [number, number];

const SQUARE4: readonly Vec[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

const SQUARE8: readonly Vec[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** Triangular adjacency on offset rows: six neighbours, row-parity dependent. */
const TRI_EVEN: readonly Vec[] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
];
const TRI_ODD: readonly Vec[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];

/** Honeycomb: three neighbours — left, right, and one vertical whose direction
 *  alternates on a brick-wall parity. */
const HEX_UP: readonly Vec[] = [
  [1, 0],
  [-1, 0],
  [0, -1],
];
const HEX_DOWN: readonly Vec[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
];

export function degreeOf(lattice: LatticeKind): number {
  if (lattice === "square8") return 8;
  if (lattice === "triangular") return 6;
  if (lattice === "honeycomb") return 3;
  return 4;
}

/** True for lattices whose rendering needs a half-cell row offset — and which
 *  therefore require an EVEN cell pitch, or the offset lands on a half device
 *  pixel and the whole lattice reads crooked. See the header of `../engine.ts`. */
export function needsEvenPitch(lattice: LatticeKind): boolean {
  return lattice === "triangular" || lattice === "honeycomb";
}

function dirsFor(lattice: LatticeKind, x: number, y: number): readonly Vec[] {
  switch (lattice) {
    case "square8":
      return SQUARE8;
    case "triangular":
      return y & 1 ? TRI_ODD : TRI_EVEN;
    case "honeycomb":
      return (x + y) & 1 ? HEX_UP : HEX_DOWN;
    default:
      return SQUARE4;
  }
}

/**
 * Integer delivery weights summing to exactly `threshold`.
 *
 * Float weights from the bias cosine, then largest-remainder apportionment —
 * because conservation is integer-exact or the model is broken. With zero bias
 * this returns the even split (plus the remainder spread over the first slots),
 * which is the classic rule.
 */
export function biasWeights(
  slots: number,
  threshold: number,
  angle: number,
  strength: number,
): Int32Array {
  const raw = new Float64Array(slots);
  let sum = 0;
  for (let d = 0; d < slots; d++) {
    const a = (d / slots) * Math.PI * 2;
    const w = 1 + strength * Math.cos(a - angle);
    raw[d] = Math.max(0, w);
    sum += raw[d];
  }
  const out = new Int32Array(slots);
  const rem: Array<[number, number]> = [];
  let assigned = 0;
  for (let d = 0; d < slots; d++) {
    const exact = (raw[d] / (sum || 1)) * threshold;
    const floor = Math.floor(exact);
    out[d] = floor;
    assigned += floor;
    rem.push([exact - floor, d]);
  }
  rem.sort((a, b) => b[0] - a[0]);
  for (let k = 0; assigned < threshold; k++, assigned++) {
    out[rem[k % slots][1]]++;
  }
  return out;
}

/** Deterministic per-seed PRNG. Same construction as `../engine.ts`, so a mark
 *  derived here matches one derived there. */
export function seeded(input: string): () => number {
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

export interface PileStats {
  avalanche: number;
  lastAvalanche: number;
  maxAvalanche: number;
  totalTopples: number;
  grains: number;
  odoMax: number;
}

/** Hard stop for the relaxation loops in `stabilize`. A configuration that has
 *  not settled in this many sweeps is a bug (or a sub-degree threshold, which
 *  genuinely never settles), not something to spin on. */
const MAX_RELAX_SWEEPS = 200_000;

export class PileSim {
  readonly W: number;
  readonly H: number;
  cfg: PileConfig;

  height: Int16Array;
  /** Cumulative topples per cell, for the life of the sim. A record, not a
   *  state — this is the field the classic sandpile images live in. */
  odometer: Float64Array;
  /** "Toppled just now", decaying. Production calls this `scorch`. */
  recency: Float32Array;
  /** Net direction of grain inflow, decaying. Zero under a symmetric topple, so
   *  it only lights up at the one-sided avalanche front. */
  fluxX: Float32Array;
  fluxY: Float32Array;
  /** Absorbing cells. Grains delivered here vanish. */
  sinks: Uint8Array;

  private delta: Int32Array;
  private weights: Int32Array;
  private sweepAcc = 0;
  private pourAcc = 0;
  private orbit = 0;
  /** While false, sweeps do not write the observable fields. Used for the
   *  preseed and for group algebra, neither of which is something the viewer
   *  watched happen. */
  private recording = true;

  inAvalanche = false;
  avalanche = 0;
  lastAvalanche = 0;
  maxAvalanche = 0;
  totalTopples = 0;
  odoMax = 1;

  /** Cells at or above the threshold, tracked incrementally.
   *
   *  Was a full O(n) scan every frame (twice, in the dilation loop). At a
   *  220-cell lattice that is 48k comparisons per frame for a question the
   *  sweep already answers as a side effect of applying its own delta. */
  unstable = 0;
  /** False once every decaying field has reached zero, which lets the whole
   *  per-cell decay pass be skipped while the field is at rest — the common
   *  case at low pour rates. */
  private decaying = false;

  /** Set by the UI while the pointer is held over a stage. */
  pointer: { x: number; y: number } | null = null;

  constructor(W: number, H: number, cfg: Partial<PileConfig> = {}) {
    this.W = W;
    this.H = H;
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    const n = W * H;
    this.height = new Int16Array(n);
    this.odometer = new Float64Array(n);
    this.recency = new Float32Array(n);
    this.fluxX = new Float32Array(n);
    this.fluxY = new Float32Array(n);
    this.sinks = new Uint8Array(n);
    this.delta = new Int32Array(n);
    this.weights = new Int32Array(8);
    this.recomputeWeights();
    this.preseed();
  }

  configure(patch: Partial<PileConfig>): void {
    const before = this.cfg;
    this.cfg = { ...before, ...patch };
    if (
      this.cfg.threshold !== before.threshold ||
      this.cfg.lattice !== before.lattice ||
      this.cfg.biasAngle !== before.biasAngle ||
      this.cfg.biasStrength !== before.biasStrength
    ) {
      this.recomputeWeights();
    }
    // The threshold is the definition of "unstable", so moving it invalidates
    // the running count. Everything else leaves the field untouched.
    if (this.cfg.threshold !== before.threshold) this.recount();
  }

  private recomputeWeights(): void {
    const { lattice, threshold, biasAngle, biasStrength } = this.cfg;
    this.weights = biasWeights(
      degreeOf(lattice),
      threshold,
      biasAngle,
      biasStrength,
    );
  }

  /** Drive to criticality before first paint, so the field is already alive.
   *  Scales with area — the production constant does not, which is the whole
   *  reason the pile scenes open as a dot at any size above the rail. */
  preseed(): void {
    const grains = Math.round(this.cfg.preseedPerCell * this.W * this.H);
    if (grains <= 0) return;
    // All at once, then relax once. The abelian property says the result is
    // identical to dropping them one at a time, and dropping-then-relaxing in a
    // loop is accidentally quadratic — at a 220-cell lattice that is minutes of
    // blocked main thread for a picture that takes ~100ms to compute correctly.
    this.height[(this.H >> 1) * this.W + (this.W >> 1)] += grains;
    // The preseed is scaffolding, not history — it must not appear in the
    // odometer, which is meant to be a record of what the viewer has watched.
    this.recording = false;
    this.relax();
    this.recording = true;
  }

  reset(): void {
    this.height.fill(0);
    this.odometer.fill(0);
    this.recency.fill(0);
    this.fluxX.fill(0);
    this.fluxY.fill(0);
    this.delta.fill(0);
    this.inAvalanche = false;
    this.avalanche = 0;
    this.lastAvalanche = 0;
    this.maxAvalanche = 0;
    this.totalTopples = 0;
    this.odoMax = 1;
    this.sweepAcc = 0;
    this.pourAcc = 0;
    this.unstable = 0;
    this.decaying = false;
    this.preseed();
  }

  clearHistory(): void {
    this.odometer.fill(0);
    this.recency.fill(0);
    this.fluxX.fill(0);
    this.fluxY.fill(0);
    this.totalTopples = 0;
    this.odoMax = 1;
  }

  // ---- the rule ----------------------------------------------------------

  /** Resolve a neighbour to a flat index, or -1 if the grain leaves the field. */
  private neighbour(x: number, y: number, v: Vec): number {
    let nx = x + v[0];
    let ny = y + v[1];
    if (this.cfg.boundary === "torus") {
      if (nx < 0) nx += this.W;
      else if (nx >= this.W) nx -= this.W;
      if (ny < 0) ny += this.H;
      else if (ny >= this.H) ny -= this.H;
    } else if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) {
      return -1;
    }
    return ny * this.W + nx;
  }

  /**
   * One simultaneous toppling sweep. Returns how many cells fired.
   *
   * Abelian: firing every unstable cell at once gives the same final
   * configuration as any sequential order, so this is exact rather than an
   * approximation of a "proper" sequential relaxation.
   */
  sweep(): number {
    const { W, H, height, delta, weights } = this;
    const { threshold, lattice } = this.cfg;
    const rec = this.recording;
    delta.fill(0);
    let fired = 0;

    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i++) {
        if (height[i] < threshold) continue;
        delta[i] -= threshold;
        const dirs = dirsFor(lattice, x, y);
        for (let d = 0; d < dirs.length; d++) {
          const w = weights[d];
          if (!w) continue;
          const j = this.neighbour(x, y, dirs[d]);
          if (j < 0) continue; // off an open boundary: dissipated
          if (this.sinks[j]) continue; // absorbed
          delta[j] += w;
          if (rec) {
            // Flux is recorded at the RECEIVER, in the direction of travel. A
            // fully surrounded cell receives from every side and nets to zero,
            // which is why only the one-sided avalanche front lights up.
            this.fluxX[j] += dirs[d][0] * w;
            this.fluxY[j] += dirs[d][1] * w;
          }
        }
        if (rec) {
          this.odometer[i]++;
          if (this.odometer[i] > this.odoMax) this.odoMax = this.odometer[i];
          this.recency[i] = 1;
        }
        fired++;
      }
    }

    if (fired) {
      // Apply the delta and recount instability in the SAME pass. The delta has
      // to be walked anyway, so knowing whether another sweep is needed costs
      // one comparison rather than a second full scan.
      let unstable = 0;
      for (let k = 0; k < height.length; k++) {
        const v = height[k] + delta[k];
        height[k] = v;
        if (v >= threshold) unstable++;
      }
      this.unstable = unstable;
      if (rec) {
        this.totalTopples += fired;
        this.decaying = true;
      }
    } else {
      this.unstable = 0;
    }
    return fired;
  }

  hasUnstable(): boolean {
    return this.unstable > 0;
  }

  /** Recount from scratch. Needed only when something outside the sweep changes
   *  the field or the threshold under it. */
  private recount(): void {
    const t = this.cfg.threshold;
    let n = 0;
    for (let i = 0; i < this.height.length; i++) if (this.height[i] >= t) n++;
    this.unstable = n;
  }

  /** Sweep until stable. Returns the total number of topples. */
  relax(maxSweeps = MAX_RELAX_SWEEPS): number {
    let total = 0;
    for (let s = 0; s < maxSweeps; s++) {
      const fired = this.sweep();
      if (!fired) return total;
      total += fired;
    }
    return total;
  }

  // ---- drive -------------------------------------------------------------

  private pourPoint(t: number): [number, number] {
    const { W, H } = this;
    switch (this.cfg.drive) {
      case "orbit": {
        this.orbit += 0.06;
        const r = Math.min(W, H) * 0.3;
        return [
          (W >> 1) + Math.cos(this.orbit) * r,
          (H >> 1) + Math.sin(this.orbit) * r,
        ];
      }
      case "walk":
        return [((t / 5200) % 1) * W, H >> 1];
      case "two": {
        this.orbit += 0.02;
        return [
          W * (Math.sin(t / 1700) > 0 ? 0.3 : 0.7),
          H * (0.4 + 0.2 * Math.sin(this.orbit)),
        ];
      }
      case "pointer":
        return this.pointer ? [this.pointer.x, this.pointer.y] : [-1, -1];
      default:
        return [W >> 1, H >> 1];
    }
  }

  /** Drop one grain. Public so the UI can pour on click independently of the
   *  configured drive mode. */
  drop(x: number, y: number, n = 1): void {
    const ix = x | 0;
    const iy = y | 0;
    if (ix < 0 || iy < 0 || ix >= this.W || iy >= this.H) return;
    const i = iy * this.W + ix;
    const before = this.height[i];
    const after = before + n;
    this.height[i] = after;
    const t = this.cfg.threshold;
    if (before < t && after >= t) this.unstable++;
  }

  // ---- the frame ---------------------------------------------------------

  /**
   * Advance one animation frame.
   *
   * `sweepsPerFrame` is a budget, not a count: below 1 the budget accumulates
   * across frames so a single avalanche is stretched over many of them. That is
   * the whole point — at 1 sweep/frame (what production does) a large cascade is
   * over in a handful of frames and has never actually been seen.
   */
  step(t: number): void {
    const { recencyDecay, fluxDecay, sweepsPerFrame, rate } = this.cfg;

    this.sweepAcc += sweepsPerFrame;
    let swept = false;
    while (this.sweepAcc >= 1) {
      this.sweepAcc -= 1;
      if (!this.inAvalanche && !this.hasUnstable()) break;
      this.inAvalanche = true;
      const fired = this.sweep();
      swept = true;
      if (fired) {
        this.avalanche += fired;
      } else {
        this.inAvalanche = false;
        this.lastAvalanche = this.avalanche;
        if (this.avalanche > this.maxAvalanche) {
          this.maxAvalanche = this.avalanche;
        }
        this.avalanche = 0;
        break;
      }
    }

    // Separation of timescales: pour only while the field is at rest. Driving
    // during a cascade is what destroys self-organised criticality.
    if (!this.inAvalanche && !swept) {
      this.pourAcc += rate / 60;
      while (this.pourAcc >= 1) {
        this.pourAcc -= 1;
        const [px, py] = this.pourPoint(t);
        if (px >= 0) this.drop(px, py);
      }
    }

    // Skip the whole pass once every decaying field has bottomed out. At a low
    // pour rate the field is at rest most frames, and this is otherwise three
    // full-array walks per frame to multiply zeros by a constant.
    if (!this.decaying) return;
    const rec = this.recency;
    const fx = this.fluxX;
    const fy = this.fluxY;
    const n = rec.length;
    let alive = false;
    for (let i = 0; i < n; i++) {
      const r = rec[i];
      if (r) {
        if (r > 0.004) {
          rec[i] = r * recencyDecay;
          alive = true;
        } else rec[i] = 0;
      }
      const x = fx[i];
      const y = fy[i];
      if (x || y) {
        if (x > 0.004 || x < -0.004) {
          fx[i] = x * fluxDecay;
          alive = true;
        } else fx[i] = 0;
        if (y > 0.004 || y < -0.004) {
          fy[i] = y * fluxDecay;
          alive = true;
        } else fy[i] = 0;
      }
    }
    this.decaying = alive;
  }

  stats(): PileStats {
    let grains = 0;
    for (let i = 0; i < this.height.length; i++) grains += this.height[i];
    return {
      avalanche: this.avalanche,
      lastAvalanche: this.lastAvalanche,
      maxAvalanche: this.maxAvalanche,
      totalTopples: this.totalTopples,
      grains,
      odoMax: this.odoMax,
    };
  }

  // ---- the sandpile group ------------------------------------------------
  //
  // Because toppling is abelian, the recurrent stable configurations form a
  // finite abelian group under "add pointwise, then relax". Everything below is
  // an operation in that group, and it is the reason this substrate can carry an
  // identity system rather than merely decorate one.

  /** Load a configuration, relax it, and hand back the stable result. Does not
   *  disturb the running simulation's history fields. */
  stabilize(config: Int16Array): Int16Array {
    const saved = this.height;
    const wasRecording = this.recording;
    this.height = Int16Array.from(config);
    // Group algebra is arithmetic, not something the viewer watched happen — it
    // must not land in the odometer.
    this.recording = false;
    this.relax();
    this.recording = wasRecording;
    const out = this.height;
    this.height = saved;
    return out;
  }

  /**
   * The identity element of the sandpile group.
   *
   * Standard recipe: stabilise the everywhere-`2(d-1)` configuration to get `s`,
   * then stabilise `2(d-1) - s`. The result is the fractal mandala — the one
   * mark that is the same for every member of the group because it is its
   * origin.
   */
  identity(): Int16Array {
    const d = degreeOf(this.cfg.lattice);
    const full = 2 * (d - 1);
    const base = new Int16Array(this.W * this.H).fill(full);
    const s = this.stabilize(base);
    const inv = new Int16Array(s.length);
    for (let i = 0; i < s.length; i++) inv[i] = full - s[i];
    return this.stabilize(inv);
  }

  /** `a + b` in the group: add pointwise, then relax. Commutative and
   *  associative, so a room's mark can be the sum of its residents' and the
   *  order they arrived in cannot matter. */
  add(a: Int16Array, b: Int16Array): Int16Array {
    const sum = new Int16Array(a.length);
    for (let i = 0; i < a.length; i++) sum[i] = a[i] + b[i];
    return this.stabilize(sum);
  }

  /**
   * A deterministic group element for a seed (a resident's public key).
   *
   * Adding the identity projects an arbitrary configuration into the recurrent
   * class, so every result is a genuine group element and every one carries the
   * same family texture: same species, different individual.
   */
  elementFromSeed(seed: string, identity?: Int16Array): Int16Array {
    const rnd = seeded(seed);
    const t = this.cfg.threshold;
    const c = new Int16Array(this.W * this.H);
    for (let i = 0; i < c.length; i++) c[i] = Math.floor(rnd() * t);
    return this.add(c, identity ?? this.identity());
  }

  /** Drop `n` grains on one cell of an empty field and relax. As `n` grows the
   *  picture converges on a fractal that refines self-similarly at every power
   *  of ten. */
  growth(n: number): Int16Array {
    const c = new Int16Array(this.W * this.H);
    c[(this.H >> 1) * this.W + (this.W >> 1)] = n;
    return this.stabilize(c);
  }

  /** Install a configuration as the live field. Used to drop a group element
   *  into the running sim so it can then be driven. */
  load(config: Int16Array): void {
    this.height.set(config);
    this.clearHistory();
    this.inAvalanche = false;
    this.avalanche = 0;
    this.recount();
  }
}
