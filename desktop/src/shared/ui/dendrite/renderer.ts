// Ported from approved fine-marks.js (588e972a3). Keep visual math/order in sync.
import {
  FINE,
  INKFLOOR,
  DOT,
  HANDOVER_DIM,
  agentLut,
  growNow,
  growOff,
  growGrid,
  spacingFor,
  type Random,
  type RGB,
  type MarkMode,
  type Steps,
  type GrowthTree,
  type RenderTree,
  type MarkOptions,
  type Mote,
} from "./tree";

// ── the rail's choir: about one mark regrows at a time ─────────────────────

export class Choir {
  declare members: Set<FineMark>;
  declare busy: number;
  declare next: FineMark | null;
  constructor() {
    this.members = new Set();
    this.busy = 0;
    this.next = null;
  }
  update(active: Iterable<FineMark>) {
    let busy = 0;
    let next: FineMark | null = null;
    let longest = -1;
    for (const m of active) {
      if (m.phase === "grow") busy++;
      else if (m.rested >= m.restFor && m.rested - m.restFor > longest) {
        longest = m.rested - m.restFor;
        next = m;
      }
    }
    this.busy = busy;
    this.next = next;
  }
  allows(m: FineMark) {
    if (this.busy >= 1 || m !== this.next) return false;
    this.busy++;
    this.next = null;
    return true;
  }
}

// ── one mark ───────────────────────────────────────────────────────────────

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class FineMark {
  declare canvas: HTMLCanvasElement;
  declare size: number;
  declare mode: Exclude<MarkMode, "auto">;
  declare working: boolean;
  declare rand: Random;
  declare small: boolean;
  declare visible: boolean;
  declare W: number;
  declare spacing: number;
  declare cellPx: number;
  declare N: number;
  declare ox: number;
  declare ctx: CanvasRenderingContext2D;
  declare image: ImageData;
  declare L: Float32Array;
  declare R: Float32Array;
  declare G: Float32Array;
  declare B: Float32Array;
  declare dust: Float32Array;
  declare inDisc: Uint8Array;
  declare lut: Uint8Array;
  declare dot: RGB;
  declare t: number;
  declare grow: number;
  declare restFor: number;
  declare rested: number;
  declare gate: ((mark: FineMark) => boolean) | null;
  declare cur: RenderTree;
  declare waiting: boolean;
  declare old: RenderTree | null;
  declare nextGen: Generator<void, GrowthTree, unknown> | null;
  declare nextSteps: Steps;
  declare next: RenderTree | null;
  declare u: number;
  declare phase: "grow" | "rest";
  declare motes: Mote[];
  declare choir?: Choir;
  declare keepTree?: boolean;
  declare treeL?: Float32Array;
  declare still?: RenderTree;
  constructor(
    canvas: HTMLCanvasElement,
    {
      size,
      mode = "auto",
      working = false,
      colour = null,
      phase,
      rand = Math.random,
    }: MarkOptions,
    dpr: number,
  ) {
    this.canvas = canvas;
    this.size = size;
    // One mark, two designs: under the breakpoint the fine filaments ("off"),
    // from it up Sept 9's own pixel dendrite ("pixel").
    if (mode === "auto") mode = size < FINE.BREAK ? "off" : "pixel";
    this.mode = mode;
    this.working = working;
    this.rand = rand;
    this.small = size < FINE.BREAK;
    this.visible = true;
    const W = Math.round(size * dpr);
    this.W = W;
    this.spacing = spacingFor(size);
    // The lattice a tree grows on: device pixels for "off" and "grid"; for
    // "pixel", Sept 9's one cell per CSS px, each cell a square of whole
    // device pixels, the squares touching, centred in the canvas.
    this.cellPx = mode === "pixel" ? Math.max(1, Math.round(dpr)) : 1;
    this.N = mode === "pixel" ? Math.floor(W / this.cellPx) : W;
    this.ox = Math.floor((W - this.N * this.cellPx) / 2);
    canvas.width = W;
    canvas.height = W;
    // biome-ignore lint/style/noNonNullAssertion: The canvas renderer requires a 2D context, as the approved study does.
    this.ctx = canvas.getContext("2d")!;
    this.image = this.ctx.createImageData(W, W);
    const n = W * W;
    this.L = new Float32Array(n);
    this.R = new Float32Array(n);
    this.G = new Float32Array(n);
    this.B = new Float32Array(n);
    this.dust = new Float32Array(n);
    this.inDisc = new Uint8Array(n);
    const c = W / 2;
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++)
        this.inDisc[y * W + x] =
          Math.hypot(x + 0.5 - c, y + 0.5 - c) <= c - 0.5 ? 1 : 0;
    this.setColour(colour);
    this.t = 0;
    this.grow = FINE.GROW_SMALL;
    if (!this.small)
      this.grow =
        FINE.GROW_SMALL +
        (FINE.GROW_HEAD - FINE.GROW_SMALL) * Math.min(1, (size - 24) / 48);
    this.restFor = this.small ? 20 + 20 * rand() : FINE.REST_HEAD;
    this.rested = 0;
    this.gate = null;
    // Trees: the one showing, the one fading, and the next one growing out of sight.
    // A rail mark opens on a full tree (small, so grown at once); a page's head
    // opens on its seed alone and begins growing within a few frames, never
    // stalling the page while a big tree is worked out.
    const p = phase ?? (this.small ? "rest" : "seed");
    const N = this.N;
    this.cur =
      p === "rest"
        ? this.makeTree(growNow(mode, N, rand, this.spacing))
        : this.makeTree({
            xs: Float32Array.of(N >> 1),
            ys: Float32Array.of(N >> 1),
            n: 1,
          });
    this.waiting = p !== "rest";
    this.old = null;
    this.nextGen = null;
    this.next = null;
    this.u = 0;
    this.phase = "grow";
    this.motes = [];
    // Motes by area: about one per 600 device pixels, never fewer than four.
    const motes = Math.max(4, Math.round((W * W) / FINE.MOTE_AREA));
    for (let i = 0; i < motes; i++) this.motes.push(this.newMote(rand() * 3));
    if (p === "rest") {
      this.u = 1;
      this.phase = "rest";
      this.rested = rand() * this.restFor;
      this.cur.born.fill(-100);
      this.cur.shown = this.cur.n;
    }
    this.startNext();
  }

  setColour(rgb: RGB | null) {
    this.lut = rgb ? agentLut(rgb) : INKFLOOR;
    this.dot = rgb || DOT;
  }

  makeTree(t: GrowthTree): RenderTree {
    const born = new Float32Array(t.n).fill(Infinity);
    const reveal = new Float32Array(t.n);
    // biome-ignore lint/style/useExponentiationOperator: Preserve the approved engine's operations verbatim.
    for (let k = 0; k < t.n; k++) reveal[k] = Math.pow(k / t.n, 1 / 1.71);
    // The outermost tips keep an ember at rest: particles nothing grew from,
    // in the outer third of the tree's reach.
    const ember = new Uint8Array(t.n);
    if (t.ps) {
      const kids = new Uint16Array(t.n);
      for (let k = 1; k < t.n; k++) kids[t.ps[k]]++;
      const c = this.N / 2;
      let rmax = 1;
      for (let k = 0; k < t.n; k++)
        rmax = Math.max(rmax, Math.hypot(t.xs[k] - c, t.ys[k] - c));
      for (let k = 1; k < t.n; k++)
        if (!kids[k] && Math.hypot(t.xs[k] - c, t.ys[k] - c) > 0.66 * rmax)
          ember[k] = 1;
    }
    return { ...t, born, reveal, ember, shown: 0, fadeT0: 0 };
  }

  startNext() {
    this.nextSteps = { chunk: 500, total: 0 };
    this.nextGen =
      this.mode === "off"
        ? growOff(this.N, this.rand, this.nextSteps, this.spacing)
        : growGrid(this.N, this.rand, this.nextSteps);
    this.next = null;
  }

  /** Spend a frame's budget growing the next tree out of sight. */
  work(budget: number) {
    if (!this.nextGen) return;
    let spent = 0;
    while (spent < budget) {
      const before = this.nextSteps.total;
      const r = this.nextGen.next();
      if (r.done) {
        this.next = this.makeTree(r.value);
        this.nextGen = null;
        return;
      }
      spent += Math.max(1, this.nextSteps.total - before);
    }
  }

  newMote(delay = 0) {
    const W = this.W;
    const c = W / 2;
    const a = this.rand() * Math.PI * 2;
    const r = (0.25 + 0.65 * Math.sqrt(this.rand())) * 0.46 * W;
    return {
      x: c + r * Math.cos(a),
      y: c + r * Math.sin(a),
      vx: 0,
      vy: 0,
      age: -delay,
      life: 3 + 4 * this.rand(),
    };
  }

  step(dt: number) {
    this.t += dt;
    const t = this.t;
    // A page's head starts growing the moment its first tree is worked out.
    if (this.waiting && this.next) this.begin();
    // The cycle.
    if (this.phase === "grow") {
      this.u += (dt * (this.working ? FINE.WORKING : 1)) / this.grow;
      if (this.u >= 1) {
        this.u = 1;
        this.phase = "rest";
        this.rested = 0;
      }
    } else {
      this.rested += dt * (this.working ? 2 : 1);
      const due = this.rested >= this.restFor;
      if (
        due &&
        (!this.gate ||
          this.working ||
          this.rested > this.restFor + 120 ||
          this.gate(this))
      )
        this.begin();
    }
    const cur = this.cur;
    while (cur.shown < cur.n && cur.reveal[cur.shown] <= this.u)
      cur.born[cur.shown++] = t;
    // The old tree holds while the new one grows inside it, and is gone once the new one is full.
    if (this.old && this.u >= 1) this.old = null;
    this.work(this.waiting ? FINE.FIRST_BUDGET : FINE.STEP_BUDGET);
    // Dust: a few motes drifting, every frame.
    const W = this.W;
    const c = W / 2;
    const D = this.dust;
    const fd = Math.exp(-dt / FINE.DUST_TAU);
    for (let i = 0; i < D.length; i++)
      if (D[i] !== 0) D[i] = D[i] * fd < 0.002 ? 0 : D[i] * fd;
    const damp = Math.exp(-dt / 0.5);
    const speed = W * (this.small ? 0.05 : 0.04); // device px / s
    const kick = speed * Math.sqrt(dt / 0.25);
    const inH = dt / FINE.DUST_TAU;
    const peak = FINE.MOTE_PEAK;
    for (let m = 0; m < this.motes.length; m++) {
      let o = this.motes[m];
      o.age += dt;
      if (o.age < 0) continue;
      if (o.age > o.life) {
        o = this.motes[m] = this.newMote(0.5 + this.rand());
        continue;
      }
      const dx = o.x - c;
      const dy = o.y - c;
      const r = Math.hypot(dx, dy) || 1;
      o.vx =
        o.vx * damp +
        (this.rand() - 0.5) * 2 * kick -
        (dx / r) * speed * 0.15 * dt;
      o.vy =
        o.vy * damp +
        (this.rand() - 0.5) * 2 * kick -
        (dy / r) * speed * 0.15 * dt;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (r > 0.46 * W) {
        o.x = c + (dx / r) * 0.46 * W;
        o.y = c + (dy / r) * 0.46 * W;
        o.vx *= -0.5;
        o.vy *= -0.5;
      }
      const w =
        peak *
        smoothstep(0, 0.8, o.age) *
        smoothstep(o.life, o.life - 0.8, o.age) *
        inH;
      splat(D, W, o.x, o.y, w);
    }
  }

  begin() {
    if (!this.next) {
      // Not grown yet: finish it now (rare; only if frames were starved).
      while (this.nextGen) this.work(1e9);
    }
    if (this.waiting) {
      this.waiting = false;
    } else {
      this.old = this.cur;
      this.old.fadeT0 = this.t;
    }
    // biome-ignore lint/style/noNonNullAssertion: The generator has completed above; preserve the study's hand-over order.
    this.cur = this.next!;
    this.u = 0;
    this.phase = "grow";
    this.startNext();
  }

  draw(still = false) {
    const { W, L, R, G, B, lut } = this;
    L.fill(0);
    R.fill(0);
    G.fill(0);
    B.fill(0);
    const t = this.t;
    const grid = this.mode !== "off";
    const pixel = this.mode === "pixel";
    const restV = pixel
      ? FINE.REST_V_PIXEL
      : this.small
        ? FINE.REST_V_SMALL
        : FINE.REST_V;
    const { cellPx, ox } = this;
    const tree = (tr: RenderTree, fade: number) => {
      for (let k = 0; k < tr.shown; k++) {
        const age = still ? 1e6 : t - tr.born[k];
        const a = Math.exp(-age / FINE.AGE_TAU);
        // Sept 9's own weight for the pixel design (0.3 + 0.68 a); the fine one is brighter, its lines being thinner.
        const v =
          (pixel ? restV + 0.68 * a : Math.min(1, restV + 0.6 * a)) *
          smoothstep(0, FINE.FADE_IN, age) *
          fade;
        if (v <= 0) continue;
        let mt = 0.2 + 0.8 * a;
        if (tr.ember[k] && mt < FINE.EMBER) mt = FINE.EMBER;
        const m = Math.max(0, Math.min(255, (mt * 255) | 0)) * 3;
        const cr = lut[m];
        const cg = lut[m + 1];
        const cb = lut[m + 2];
        if (grid) {
          // One cell, a whole square of device pixels.
          const x0 = ox + tr.xs[k] * cellPx;
          const y0 = ox + tr.ys[k] * cellPx;
          for (let yy = 0; yy < cellPx; yy++) {
            for (let xx = 0; xx < cellPx; xx++) {
              const p = (y0 + yy) * W + x0 + xx;
              L[p] += v;
              R[p] += v * cr;
              G[p] += v * cg;
              B[p] += v * cb;
            }
          }
        } else if (k === 0 || !tr.ps) {
          splatC(L, R, G, B, W, tr.xs[k], tr.ys[k], v, cr, cg, cb);
        } else {
          // A short line back to the particle it stuck to, laid down as light
          // every 0.6 px, so a branch stays continuous at any spacing.
          const q = tr.ps[k];
          const x0 = tr.xs[q];
          const y0 = tr.ys[q];
          const dx = tr.xs[k] - x0;
          const dy = tr.ys[k] - y0;
          const len = Math.hypot(dx, dy);
          const n = Math.max(1, Math.ceil(len / 0.6));
          const w = (v * len) / n / FINE.LINE_UNIT;
          for (let j = 1; j <= n; j++)
            splatC(
              L,
              R,
              G,
              B,
              W,
              x0 + (dx * j) / n,
              y0 + (dy * j) / n,
              w,
              cr,
              cg,
              cb,
            );
        }
      }
    };
    if (still) {
      const tr = this.stillTree();
      tr.shown = tr.n;
      tree(tr, 1);
    } else {
      // Dimmed gently as the new tree rises, faded out only as it reaches its outline.
      if (this.old)
        tree(
          this.old,
          (1 - HANDOVER_DIM * smoothstep(0, 0.35, this.u)) *
            (1 - smoothstep(0.7, 1, this.u)),
        );
      tree(this.cur, 1);
      // biome-ignore lint/suspicious/noAssignInExpressions: Preserve the approved engine's proof buffer operation verbatim.
      if (this.keepTree) (this.treeL ??= new Float32Array(L.length)).set(L);
      const D = this.dust;
      const [dr, dg, db] = this.dot;
      for (let p = 0; p < D.length; p++) {
        const v = D[p];
        if (v === 0) continue;
        L[p] += v;
        R[p] += v * dr;
        G[p] += v * dg;
        B[p] += v * db;
      }
    }
    const data = this.image.data;
    // biome-ignore lint/style/useConst: Preserve the approved engine's return accumulator verbatim.
    let dustSum = 0;
    for (let p = 0; p < L.length; p++) {
      const l = L[p];
      const o = p * 4;
      if (l < 0.004 || !this.inDisc[p]) {
        data[o + 3] = 0;
        continue;
      }
      data[o] = R[p] / l;
      data[o + 1] = G[p] / l;
      data[o + 2] = B[p] / l;
      data[o + 3] = Math.min(1, l) * 255;
    }
    this.ctx.putImageData(this.image, 0, 0);
    return dustSum;
  }

  stillTree() {
    if (!this.still) {
      this.still = this.makeTree(
        growNow(this.mode, this.N, this.rand, this.spacing),
      );
      this.still.born.fill(-1e6);
    }
    return this.still;
  }
}

/** A light of value w at (x, y), split across the four nearest pixels by where it is. */
function splat(D: Float32Array, W: number, x: number, y: number, w: number) {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  if (ix < 0 || iy < 0 || ix >= W - 1 || iy >= W - 1) return;
  const ax = fx - ix;
  const ay = fy - iy;
  const p = iy * W + ix;
  D[p] += w * (1 - ax) * (1 - ay);
  D[p + 1] += w * ax * (1 - ay);
  D[p + W] += w * (1 - ax) * ay;
  D[p + W + 1] += w * ax * ay;
}
function splatC(
  L: Float32Array,
  R: Float32Array,
  G: Float32Array,
  B: Float32Array,
  W: number,
  x: number,
  y: number,
  v: number,
  cr: number,
  cg: number,
  cb: number,
) {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  if (ix < 0 || iy < 0 || ix >= W - 1 || iy >= W - 1) return;
  const ax = fx - ix;
  const ay = fy - iy;
  const p = iy * W + ix;
  const ws = [(1 - ax) * (1 - ay), ax * (1 - ay), (1 - ax) * ay, ax * ay];
  const ps = [p, p + 1, p + W, p + W + 1];
  for (let q = 0; q < 4; q++) {
    const w = v * ws[q];
    L[ps[q]] += w;
    R[ps[q]] += w * cr;
    G[ps[q]] += w * cg;
    B[ps[q]] += w * cb;
  }
}

// ── the one loop ───────────────────────────────────────────────────────────

export class FineRenderer {
  declare marks: Set<FineMark>;
  declare byCanvas: WeakMap<Element, FineMark>;
  declare choirs: Map<string, Choir>;
  declare frame: number;
  declare last: number;
  declare speed: number;
  declare forcedStill: boolean | null;
  declare spent: number;
  declare frames: number;
  declare reduce: MediaQueryList;
  declare io: IntersectionObserver | null;
  private options = new WeakMap<FineMark, MarkOptions>();
  private resolution: MediaQueryList | null = null;
  constructor() {
    this.marks = new Set();
    this.byCanvas = new WeakMap();
    this.choirs = new Map();
    this.frame = 0;
    this.last = 0;
    this.speed = 1;
    this.forcedStill = null;
    this.spent = 0;
    this.frames = 0;
    this.reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((es) => {
            for (const e of es) {
              const m = this.byCanvas.get(e.target);
              if (m) m.visible = e.isIntersecting;
            }
            this.wake();
          });
    document.addEventListener("visibilitychange", () => this.wake());
    this.reduce.addEventListener("change", () => this.restill());
    this.watchResolution();
  }
  // Display changes rebuild at whole device pixels, never CSS-scale an old canvas.
  private watchResolution = () => {
    this.resolution?.removeEventListener("change", this.rebuildResolution);
    this.resolution = window.matchMedia(
      `(resolution: ${window.devicePixelRatio || 1}dppx)`,
    );
    this.resolution.addEventListener("change", this.rebuildResolution);
  };
  private rebuildResolution = () => {
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    for (const mark of this.marks) {
      const { choir, gate, visible, working } = mark;
      const rebuilt = new FineMark(
        mark.canvas,
        { ...this.options.get(mark), size: mark.size, working },
        dpr,
      );
      // Keep the registered object/handle and its choir membership stable.
      Object.assign(mark, rebuilt, { choir, gate, visible });
      mark.still = undefined;
      mark.treeL = undefined;
      mark.draw(this.still);
    }
    this.watchResolution();
    this.wake();
  };
  get still() {
    return this.forcedStill ?? this.reduce.matches;
  }
  register(canvas: HTMLCanvasElement, options: MarkOptions) {
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const mark = new FineMark(canvas, options, dpr);
    if (mark.small && options.group) {
      if (!this.choirs.has(options.group))
        this.choirs.set(options.group, new Choir());
      mark.choir = this.choirs.get(options.group);
      // biome-ignore lint/style/noNonNullAssertion: The choir is created immediately above, as in the study.
      mark.gate = (m) => mark.choir!.allows(m);
    }
    mark.draw(this.still);
    this.marks.add(mark);
    this.options.set(mark, options);
    this.byCanvas.set(canvas, mark);
    this.io?.observe(canvas);
    this.wake();
    const off = () => {
      this.marks.delete(mark);
      this.byCanvas.delete(canvas);
      this.io?.unobserve(canvas);
    };
    off.dispose = off;
    off.update = ({ working }: { working: boolean }) => {
      mark.working = working;
    };
    off.setColour = (rgb: RGB | null) => {
      mark.setColour(rgb);
      if (this.still) mark.draw(true);
    };
    off.mark = mark;
    return off;
  }
  setSpeed(s: number) {
    this.speed = s;
  }
  setReducedMotion(v: boolean | null) {
    this.forcedStill = v;
    this.restill();
  }
  restill() {
    for (const m of this.marks) m.draw(this.still);
    this.wake();
  }
  stats() {
    return {
      msPerFrame: this.frames ? this.spent / this.frames : 0,
      frames: this.frames,
      marks: this.marks.size,
    };
  }
  resetStats() {
    this.spent = 0;
    this.frames = 0;
  }
  wake() {
    if (this.frame || this.still || document.hidden || !this.marks.size) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }
  tick = (now: number) => {
    this.frame = 0;
    if (this.still || document.hidden || !this.marks.size) return;
    const dt =
      Math.max(0, Math.min(0.05, (now - this.last) / 1000)) * this.speed;
    this.last = now;
    const t0 = performance.now();
    for (const choir of this.choirs.values()) {
      const active = [];
      for (const m of this.marks)
        if (m.choir === choir && m.visible) active.push(m);
      choir.update(active);
    }
    for (const m of this.marks) {
      if (!m.visible) continue;
      m.step(dt);
      m.draw(false);
    }
    this.spent += performance.now() - t0;
    this.frames++;
    this.frame = requestAnimationFrame(this.tick);
  };
}

let instance: FineRenderer | null = null;
export function dendriteRenderer() {
  if (typeof window === "undefined") return null;
  instance ??= new FineRenderer();
  return instance;
}

export type DendriteMarkHandle = ReturnType<FineRenderer["register"]>;
