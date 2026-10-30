import { MAGNITUDE_LUT } from "@/shared/ui/dot-display/physics";

import { type Dendrite, growDendrite, seededRandom } from "./tree";

/**
 * Agents' marks (WP-42): each agent's own dendrite, grown once from its seed
 * and kept, drawn in the dot engine's light on a lattice of whole-pixel dots.
 * Light runs from the seed out to the tips on an uneven clock, often while it
 * works; loose grains drift round it and never stick, so the tree never
 * changes. The design lab's `Seed` study, sharpened (shell-lab-rail,
 * design-lab/agent-marks/family): each screen draws at its own resolution, the
 * page's marks use a finer lattice, and the glow stays on the lattice.
 */

const TREES = new Map<number, Dendrite>();

function treeFor(seed: number): Dendrite {
  let tree = TREES.get(seed);
  if (!tree) {
    tree = growDendrite(seed);
    TREES.set(seed, tree);
  }
  return tree;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The dot engine's own ramp, how much just moved: indigo to white-hot. */
function ramp(t: number, out: Float32Array): Float32Array {
  const i = Math.max(0, Math.min(255, Math.floor(t * 255))) * 3;
  out[0] = MAGNITUDE_LUT[i] / 255;
  out[1] = MAGNITUDE_LUT[i + 1] / 255;
  out[2] = MAGNITUDE_LUT[i + 2] / 255;
  return out;
}

export type DendriteMarkOptions = {
  seed: number;
  /** CSS pixels: 18 in a row, 72 at a page's head. */
  size: number;
  working: boolean;
};

export type DendriteMarkHandle = {
  update(next: { working: boolean }): void;
  dispose(): void;
};

type Walker = { cell: number; wait: number };
type Pulse = { t0: number; speed: number };

const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

class DendriteMark {
  visible = true;
  working: boolean;
  readonly ctx: CanvasRenderingContext2D | null;
  readonly image: ImageData | null;
  readonly W: number;
  readonly N: number;
  readonly P: number;
  readonly ox: number;
  readonly dot: number;
  readonly inset: number;
  private readonly small: boolean;
  private readonly inside: Uint8Array;
  private readonly radius: Float32Array;
  private readonly fade: Float32Array;
  private readonly struct: Uint8Array;
  private readonly age: Float32Array;
  private readonly dist: Float32Array;
  private readonly tip: Uint8Array;
  private readonly root: number;
  private readonly heat: Float32Array;
  private readonly hue: Float32Array;
  private readonly haze: Float32Array;
  private readonly light: Float32Array;
  private readonly glow: Float32Array;
  private readonly cellsInside: number;
  private readonly rand: () => number;
  private readonly seed: number;
  private readonly walkers: Walker[] = [];
  private pulses: Pulse[] = [];
  private t = 0;
  private next: number;
  private energy: number;
  private readonly c0 = new Float32Array(3);
  private readonly c1 = new Float32Array(3);

  constructor(
    canvas: HTMLCanvasElement,
    { seed, size, working }: DendriteMarkOptions,
    dpr: number,
  ) {
    this.seed = seed;
    this.working = working;
    this.energy = working ? 1 : 0;
    this.small = size <= 24;
    // Whole device pixels: a dot every point in a row, every point and a half
    // at a page's head, so each sits crisp on the screen's own grid.
    const W = Math.round(size * dpr);
    const P = Math.max(2, Math.round((this.small ? 1 : 1.5) * dpr));
    const N = Math.floor(W / P);
    this.W = W;
    this.P = P;
    this.N = N;
    this.ox = Math.floor((W - N * P) / 2);
    this.dot = P >= 3 ? P - 1 : P;
    this.inset = Math.floor((P - this.dot) / 2);
    canvas.width = W;
    canvas.height = W;
    this.ctx = canvas.getContext("2d");
    this.image = this.ctx ? this.ctx.createImageData(W, W) : null;

    const n = N * N;
    this.inside = new Uint8Array(n);
    this.radius = new Float32Array(n);
    this.fade = new Float32Array(n);
    let inside = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const c = j * N + i;
        const r = Math.hypot(((i + 0.5) / N) * 2 - 1, ((j + 0.5) / N) * 2 - 1);
        this.radius[c] = r;
        this.inside[c] = r < 0.97 ? 1 : 0;
        this.fade[c] = this.inside[c] ? smooth(0.99, 0.84, r) : 0;
        inside += this.inside[c];
      }
    }
    this.cellsInside = inside;

    // At a glance the trunk, up close the twigs: a branch shows once it
    // carries enough of the tree for this many dots.
    const tree = treeFor(seed);
    const minSub = N <= 20 ? 6 : N <= 28 ? 3 : 1;
    this.struct = new Uint8Array(n);
    this.age = new Float32Array(n);
    this.dist = new Float32Array(n).fill(1e9);
    this.tip = new Uint8Array(n);
    const cell = (x: number, y: number) => {
      const i = Math.floor(((x + 1) / 2) * N);
      const j = Math.floor(((y + 1) / 2) * N);
      return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
    };
    const mark = (c: number, q: number) => {
      if (c < 0 || !this.inside[c]) return;
      const depth = tree.depth[q] / tree.maxDepth;
      this.struct[c] = 1;
      this.age[c] = Math.max(this.age[c], depth);
      this.dist[c] = Math.min(this.dist[c], depth);
    };
    const shownChild = new Uint8Array(tree.count);
    for (let q = 1; q < tree.count; q++) {
      if (tree.sub[q] >= minSub) shownChild[tree.parent[q]] = 1;
    }
    mark(cell(0, 0), 0);
    for (let q = 1; q < tree.count; q++) {
      if (tree.sub[q] < minSub) continue;
      const p = tree.parent[q];
      const x0 = tree.px[p];
      const y0 = tree.py[p];
      const x1 = tree.px[q];
      const y1 = tree.py[q];
      const steps = Math.max(
        2,
        Math.ceil((Math.hypot(x1 - x0, y1 - y0) * N) / 0.7),
      );
      for (let s = 0; s <= steps; s++) {
        mark(
          cell(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps),
          q,
        );
      }
      if (!shownChild[q]) {
        const c = cell(x1, y1);
        if (c >= 0 && this.inside[c]) this.tip[c] = 1;
      }
    }
    this.root = cell(0, 0);

    this.heat = new Float32Array(n);
    this.hue = new Float32Array(n);
    this.haze = new Float32Array(n);
    this.light = new Float32Array(n * 3);
    this.glow = new Float32Array(n * 3);
    this.rand = seededRandom((seed ^ 0x3c3c) >>> 0);
    this.next = 0.3 + this.rand() * 2;
    // Begin already alive: grains about, light under way.
    for (let i = 0; i < 120; i++) this.step(1 / 60);
  }

  /** Under Reduce Motion: no drift, just the state it should be in. */
  settle() {
    this.energy = this.working ? 1 : 0;
  }

  private spawnWalker(): Walker | null {
    const { N } = this;
    for (let k = 0; k < 40; k++) {
      const c = Math.floor(this.rand() * N * N);
      if (this.inside[c] && !this.struct[c] && this.radius[c] > 0.35) {
        return { cell: c, wait: this.rand() * 0.2 };
      }
    }
    return null;
  }

  step(dt: number) {
    const target = this.working ? 1 : 0;
    this.energy += (target - this.energy) * Math.min(1, dt * 1.5);
    this.t += dt;
    const e = this.energy;
    const N = this.N;
    const n = N * N;

    // Loose grains drift round the tree and never stick, so it never changes.
    const want = Math.round(
      this.cellsInside *
        (this.small ? 0.025 + 0.035 * e : (0.05 + 0.07 * e) * 0.6),
    );
    while (this.walkers.length < want) {
      const walker = this.spawnWalker();
      if (!walker) break;
      this.walkers.push(walker);
    }
    if (this.walkers.length > want) this.walkers.length = want;
    const hop = 0.16 - 0.09 * e;
    for (const walker of this.walkers) {
      walker.wait -= dt;
      if (walker.wait > 0) continue;
      walker.wait = hop * (0.6 + 0.8 * this.rand());
      const [di, dj] = STEPS[Math.floor(this.rand() * 4)];
      const i = (walker.cell % N) + di;
      const j = Math.floor(walker.cell / N) + dj;
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const c = j * N + i;
      if (!this.inside[c]) {
        const fresh = this.spawnWalker();
        if (fresh) walker.cell = fresh.cell;
        continue;
      }
      if (this.struct[c]) continue;
      walker.cell = c;
      this.haze[c] = Math.min(0.4, this.haze[c] + 0.24);
    }

    // Light runs from the seed out to the tips, on an uneven clock: now and
    // then at rest, often while it works.
    if (this.t > this.next) {
      this.pulses.push({ t0: this.t, speed: 1 / (0.95 - 0.4 * e) });
      const u = this.rand();
      this.next = this.t + (e > 0.5 ? 0.35 + 1.1 * u * u : 2.4 + 5.5 * u * u);
    }
    const band = 0.085;
    for (const pulse of this.pulses) {
      const front = (this.t - pulse.t0) * pulse.speed;
      for (let c = 0; c < n; c++) {
        if (!this.struct[c]) continue;
        const off = Math.abs(this.dist[c] - front);
        if (off > band) continue;
        const k = 1 - off / band;
        this.heat[c] = Math.max(this.heat[c], 0.55 * k);
        this.hue[c] = Math.max(this.hue[c], 0.55 + 0.25 * k);
        // The tips flare white-hot as it reaches them.
        if (this.tip[c] && this.dist[c] - front < band * 0.4) {
          this.heat[c] = 1.05;
          this.hue[c] = 0.97;
        }
      }
    }
    this.pulses = this.pulses.filter(
      (pulse) => (this.t - pulse.t0) * pulse.speed < 1.15,
    );
    const frames = dt * 60;
    const fh = 0.9 ** frames;
    const fz = 0.86 ** frames;
    const fm = 0.97 ** frames;
    for (let c = 0; c < n; c++) {
      this.heat[c] *= fh;
      this.haze[c] *= fz;
      this.hue[c] *= fm;
    }
  }

  draw() {
    const { ctx, image, N, P, ox, dot, inset, W } = this;
    if (!ctx || !image) return;
    const n = N * N;
    const e = this.energy;
    const t = this.t;
    const breath =
      0.93 + 0.05 * Math.sin(t * 0.71 + this.seed) + 0.02 * Math.sin(t * 1.73);
    const light = this.light;
    const c0 = this.c0;
    const c1 = this.c1;
    for (let c = 0; c < n; c++) {
      let r = 0;
      let g = 0;
      let b = 0;
      if (this.inside[c]) {
        if (this.struct[c]) {
          const a = this.age[c];
          const v = ((this.small ? 0.46 : 0.3) + 0.34 * a) * breath;
          ramp(0.16 + 0.5 * a * a, c0);
          r = c0[0] * v;
          g = c0[1] * v;
          b = c0[2] * v;
          if (this.tip[c]) {
            const tv = (this.small ? 0.6 : 0.42) * breath;
            ramp(0.78, c1);
            r = r * 0.4 + c1[0] * tv;
            g = g * 0.4 + c1[1] * tv;
            b = b * 0.4 + c1[2] * tv;
          }
          if (c === this.root) {
            r += 0.22;
            g += 0.22;
            b += 0.24;
          }
          // As the light fades it walks back down the ramp: it leaves violet,
          // never brown.
          const h = this.heat[c];
          ramp(Math.min(this.hue[c], 0.2 + 0.8 * h), c1);
          r += c1[0] * h;
          g += c1[1] * h;
          b += c1[2] * h;
        }
        const z = this.haze[c] * (0.55 + 0.45 * (1 - e * 0.3));
        const f = this.fade[c];
        r = (r + z * 0.62) * f;
        g = (g + z * 0.63) * f;
        b = (b + z * 0.68) * f;
      }
      light[c * 3] = r;
      light[c * 3 + 1] = g;
      light[c * 3 + 2] = b;
    }

    // A glow that stays on the lattice: each lit dot lends a little of its
    // light to its neighbours, drawn as whole cells under the dots, so
    // nothing is ever smeared.
    const glow = this.glow;
    glow.fill(0);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const c = j * N + i;
        const r = light[c * 3];
        const g = light[c * 3 + 1];
        const b = light[c * 3 + 2];
        if (r + g + b < 0.02) continue;
        for (let v = -1; v <= 1; v++) {
          for (let u = -1; u <= 1; u++) {
            const i2 = i + u;
            const j2 = j + v;
            if (i2 < 0 || j2 < 0 || i2 >= N || j2 >= N) continue;
            const w =
              u === 0 && v === 0 ? 0.3 : u === 0 || v === 0 ? 0.12 : 0.06;
            const o = (j2 * N + i2) * 3;
            glow[o] += r * w;
            glow[o + 1] += g * w;
            glow[o + 2] += b * w;
          }
        }
      }
    }

    const data = image.data;
    data.fill(0);
    const put = (
      r: number,
      g: number,
      b: number,
      x0: number,
      y0: number,
      side: number,
    ) => {
      const m = Math.max(r, g, b);
      if (m < 0.004) return;
      const k = 255 / m;
      const cr = Math.min(255, r * k);
      const cg = Math.min(255, g * k);
      const cb = Math.min(255, b * k);
      const ca = Math.min(1, m) * 255;
      for (let yy = 0; yy < side; yy++) {
        let o = ((y0 + yy) * W + x0) * 4;
        for (let xx = 0; xx < side; xx++, o += 4) {
          data[o] = cr;
          data[o + 1] = cg;
          data[o + 2] = cb;
          data[o + 3] = ca;
        }
      }
    };
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const c = j * N + i;
        if (!this.inside[c]) continue;
        const o = c * 3;
        const f = this.fade[c] * 0.55;
        put(
          glow[o] * f,
          glow[o + 1] * f,
          glow[o + 2] * f,
          ox + i * P,
          ox + j * P,
          P,
        );
        const r = light[o];
        const g = light[o + 1];
        const b = light[o + 2];
        if (r + g + b >= 0.004) {
          put(
            r + glow[o] * 0.25,
            g + glow[o + 1] * 0.25,
            b + glow[o + 2] * 0.25,
            ox + i * P + inset,
            ox + j * P + inset,
            dot,
          );
        }
      }
    }
    ctx.putImageData(image, 0, 0);
  }
}

class DendriteRenderer {
  private readonly marks = new Set<DendriteMark>();
  private readonly byCanvas = new WeakMap<Element, DendriteMark>();
  private readonly io: IntersectionObserver | null;
  private readonly reduce: MediaQueryList;
  private frame = 0;
  private last = 0;

  constructor() {
    this.reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            for (const entry of entries) {
              const mark = this.byCanvas.get(entry.target);
              if (mark) mark.visible = entry.isIntersecting;
            }
            this.wake();
          });
    document.addEventListener("visibilitychange", () => this.wake());
    this.reduce.addEventListener("change", () => {
      for (const mark of this.marks) {
        mark.settle();
        mark.draw();
      }
      this.wake();
    });
  }

  register(
    canvas: HTMLCanvasElement,
    options: DendriteMarkOptions,
  ): DendriteMarkHandle {
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const mark = new DendriteMark(canvas, options, dpr);
    if (this.reduce.matches) mark.settle();
    mark.draw();
    this.marks.add(mark);
    this.byCanvas.set(canvas, mark);
    this.io?.observe(canvas);
    this.wake();
    return {
      update: ({ working }) => {
        mark.working = working;
        if (this.reduce.matches) {
          mark.settle();
          mark.draw();
        }
      },
      dispose: () => {
        this.marks.delete(mark);
        this.byCanvas.delete(canvas);
        this.io?.unobserve(canvas);
      },
    };
  }

  private wake() {
    if (
      this.frame ||
      this.reduce.matches ||
      document.hidden ||
      this.marks.size === 0
    ) {
      return;
    }
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    this.frame = 0;
    if (this.reduce.matches || document.hidden || this.marks.size === 0) return;
    // Never backwards: a frame can carry a timestamp from before it was asked for.
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    for (const mark of this.marks) {
      if (!mark.visible) continue;
      mark.step(dt);
      mark.draw();
    }
    this.frame = requestAnimationFrame(this.tick);
  };
}

let instance: DendriteRenderer | null = null;

/** The one renderer every agent mark shares; none where there's no window. */
export function dendriteRenderer(): DendriteRenderer | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  instance ??= new DendriteRenderer();
  return instance;
}
