/**
 * Persistent-phosphor dot-matrix engine.
 *
 * Ported from the Luca/Mnemos design prototype. Two properties give it its
 * character and must not be "simplified" away:
 *
 * 1. The charge buffer is multiplied down between frames and never cleared, so
 *    marks decay like phosphor instead of blinking out. Scenes add charge; the
 *    fade is what produces the trails.
 * 2. Everything is computed in DEVICE pixels on an integer lattice. A dot drawn
 *    at a fractional device pixel is antialiased, and a grid of antialiased dots
 *    reads as crooked and soft no matter how good the pattern is. So the cell
 *    pitch is a whole number of device pixels, the grid origin is an integer,
 *    and every dot is an integer rect.
 *
 * Scenes are pure functions of (panel, elapsed-ms), addressed in dot cells
 * rather than pixels, so the same scene works at 28px in a rail and at 300px on
 * a board.
 */

import { dlaScene, MAGNITUDE_LUT_INKFLOOR, pileScene } from "./physics";

/** Identity is stable per seed: same public key, same mark, forever. */
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

export type DotScene =
  | "sigil"
  | "listen"
  | "think"
  | "recall"
  | "work"
  | "net"
  | "sleep"
  | "pulse"
  | "fault"
  | "fill";

export interface DotPanelOptions {
  /** Peak charge a scene may write. */
  glow: number;
  /** Neighbour bleed, 0 disables the (expensive) bloom pass. */
  bloom: number;
  /**
   * Backing colour painted under the lattice, or `"transparent"` to let
   * whatever is behind the canvas show through.
   *
   * Defaults to transparent, and that default matters. This used to be a
   * hardcoded near-black, on the reasoning that a mark should read the same on
   * every surface. That held only while every surface WAS near-black — under
   * the charcoal scale a near-black backing turns every resident avatar into a
   * dark disc punched into the card. Surface-tracking wins: the chip's own CSS
   * background owns the backing, so a mark composites onto whatever it sits on.
   */
  glass: string;
  /** Dot colour as a bare "r,g,b" triple; alpha comes from the charge. */
  dot: string;
  /** Dot pitch in CSS px before device scaling. */
  cell: number;
  /** 0..1 occupancy, for the `fill` scene only. */
  level: number;
  /** Lift the whole sigil on a slow sine instead of re-lighting cells. */
  breath: boolean;
  seed: string;
}

const DEFAULT_CELL = 4;

/** Below this, a cell is treated as carrying no event at all and is drawn in
 *  plain ink rather than sampled from the colour ramp. See `draw`. */
const MAGNITUDE_EPSILON = 0.02;

export interface SigilCache {
  grid: number[][];
  patternWidth: number;
  patternHeight: number;
  phase: number;
}

/**
 * Derive a resident's emblem from their public key. Pure and deterministic —
 * the same key yields the same mark forever, which is the whole point of an
 * identity mark. Split out from the panel so it is testable without a canvas.
 *
 * The pattern is half-width and mirrored, so a mark reads as an emblem rather
 * than as noise.
 */
export function sigilPattern(seed: string): SigilCache {
  const rnd = seeded(seed);
  const PW = 4;
  const PH = 7;
  let grid: number[][] = [];
  let lit = 0;
  let tries = 0;
  // Density is held between 40% and 60% so no key yields an empty or clogged
  // emblem, and every row carries at least one dot so a mark never breaks into
  // stripes.
  do {
    grid = [];
    lit = 0;
    for (let y = 0; y < PH; y++) {
      const row: number[] = [];
      let rowLit = 0;
      for (let x = 0; x < PW; x++) {
        const on = rnd() < 0.5 ? 1 : 0;
        row.push(on);
        if (on) rowLit++;
      }
      if (!rowLit) {
        row[Math.floor(rnd() * PW)] = 1;
        rowLit = 1;
      }
      for (let k = 0; k < PW; k++) if (row[k]) lit += k === PW - 1 ? 1 : 2;
      grid.push(row);
    }
    tries++;
  } while (
    (lit / (PH * (PW * 2 - 1)) < 0.4 || lit / (PH * (PW * 2 - 1)) > 0.6) &&
    tries < 24
  );
  return { grid, patternWidth: PW, patternHeight: PH, phase: rnd() * 6.28 };
}

export class DotPanel {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  scene: DotScene;
  visible = true;
  readonly opt: DotPanelOptions;
  private readonly startedAt: number;

  /** Lattice dimensions, in cells. */
  W = 0;
  H = 0;
  /** Charge buffer and the scratch buffer used by the bloom pass. */
  buf: Float32Array = new Float32Array(0);
  private bloomBuf: Float32Array = new Float32Array(0);

  private cellPx = DEFAULT_CELL;
  private originX = 0;
  private originY = 0;
  private canvasW = 0;
  private canvasH = 0;

  /** Memoised sigil pattern. The only per-scene cache the engine itself owns —
   *  physics-carrying scenes use the generic `sim` slot below. */
  private sigil: SigilCache | null = null;

  /**
   * Free-form per-panel simulation state, for scenes that carry a physics
   * (sandpiles, wave fields, aggregates). Keyed by scene so switching scenes
   * cannot read another scene's memory back as garbage.
   */
  sim: { key: string; state: unknown } | null = null;

  /**
   * Optional per-cell magnitude, 0..1, paired with a 256-entry RGB lookup
   * table. When both are present `draw` colours each dot by its magnitude
   * instead of the flat ink — "how much just moved" as a live dial. Left null,
   * the panel stays monochrome.
   */
  magnitude: Float32Array | null = null;
  lut: Uint8Array | null = null;

  /** Allocate the magnitude channel and attach a LUT. Idempotent. */
  enableMagnitude(lut: Uint8Array): void {
    this.lut = lut;
    if (!this.magnitude || this.magnitude.length !== this.buf.length) {
      this.magnitude = new Float32Array(this.buf.length);
    }
  }

  disableMagnitude(): void {
    this.lut = null;
    this.magnitude = null;
  }

  /** Scene-owned state, allocated once per (panel, scene) pair. */
  useSim<T>(key: string, create: () => T): T {
    if (!this.sim || this.sim.key !== key) {
      this.sim = { key, state: create() };
    }
    return this.sim.state as T;
  }

  constructor(
    canvas: HTMLCanvasElement,
    options: Partial<DotPanelOptions> = {},
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("dot-display: 2d context unavailable");
    }
    this.canvas = canvas;
    this.ctx = ctx;
    this.scene = (canvas.dataset.scene as DotScene) || "listen";
    this.startedAt = performance.now() - (Number(canvas.dataset.phase) || 0);
    this.opt = {
      glow: 0.88,
      bloom: 0,
      glass: "transparent",
      dot: "239,239,237",
      cell: DEFAULT_CELL,
      level: 0.5,
      breath: false,
      seed: "luca",
      ...options,
    };
    this.resize();
  }

  /** Recompute the lattice. Returns false while the canvas has no layout box. */
  resize(): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(rect.width * dpr);
    const ch = Math.round(rect.height * dpr);
    const cell = Math.max(2, Math.round(this.opt.cell * dpr));
    const W = Math.max(3, Math.floor(cw / cell));
    const H = Math.max(3, Math.floor(ch / cell));
    if (W === this.W && H === this.H && this.canvas.width === cw) return true;
    this.W = W;
    this.H = H;
    this.cellPx = cell;
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.canvasW = cw;
    this.canvasH = ch;
    // Integer origin: this both centres the lattice and yields the quiet zone.
    this.originX = Math.floor((cw - W * cell) / 2);
    this.originY = Math.floor((ch - H * cell) / 2);
    this.buf = new Float32Array(W * H);
    this.bloomBuf = new Float32Array(W * H);
    if (this.magnitude) this.magnitude = new Float32Array(W * H);
    // Every cached pattern and physics is sized to the old lattice.
    this.sigil = null;
    this.sim = null;
    return true;
  }

  elapsed(now: number): number {
    return now - this.startedAt;
  }

  // ---- lattice primitives ------------------------------------------------

  fade(k: number): void {
    const b = this.buf;
    for (let i = 0; i < b.length; i++) {
      b[i] *= k;
      if (b[i] < 0.005) b[i] = 0;
    }
  }

  set(x: number, y: number, v: number): void {
    const ix = x | 0;
    const iy = y | 0;
    if (ix < 0 || iy < 0 || ix >= this.W || iy >= this.H) return;
    const i = iy * this.W + ix;
    if (v > this.buf[i]) this.buf[i] = v;
  }

  add(x: number, y: number, v: number): void {
    const ix = x | 0;
    const iy = y | 0;
    if (ix < 0 || iy < 0 || ix >= this.W || iy >= this.H) return;
    const i = iy * this.W + ix;
    this.buf[i] = Math.min(1.5, this.buf[i] + v);
  }

  rect(x: number, y: number, w: number, h: number, v: number): void {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) this.set(x + i, y + j, v);
    }
  }

  disc(cx: number, cy: number, r: number, v: number, soft = false): void {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        if (d <= r) this.set(x, y, soft ? v * (1 - d / (r + 0.001)) : v);
      }
    }
  }

  ring(cx: number, cy: number, r: number, v: number): void {
    const n = Math.max(8, Math.round(2 * Math.PI * r));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.set(
        Math.round(cx + Math.cos(a) * r),
        Math.round(cy + Math.sin(a) * r),
        v,
      );
    }
  }

  /** Dashed connector — every other cell, so links read as links not bars. */
  link(x0: number, y0: number, x1: number, y1: number, v: number): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s <= n; s++) {
      if (s % 2) continue;
      this.set(
        Math.round(x0 + ((x1 - x0) * s) / n),
        Math.round(y0 + ((y1 - y0) * s) / n),
        v,
      );
    }
  }

  // ---- paint -------------------------------------------------------------

  draw(): void {
    if (!this.buf.length) return;
    const c = this.ctx;
    const { W, H } = this;
    const cell = this.cellPx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    // Clearing rather than filling is what makes a transparent backing work.
    // Safe for the phosphor: the charge buffer is a separate Float32Array, so
    // the canvas is repainted from it every frame and never accumulates here.
    c.clearRect(0, 0, this.canvasW, this.canvasH);
    if (this.opt.glass !== "transparent") {
      c.fillStyle = this.opt.glass;
      c.fillRect(0, 0, this.canvasW, this.canvasH);
    }

    // Integer dot with an integer gutter, so the lattice stays visible and every
    // edge lands on a device pixel.
    const gutter = cell >= 8 ? Math.round(cell * 0.25) : cell >= 4 ? 1 : 0;
    const d = Math.max(1, cell - gutter);
    const off = Math.floor((cell - d) / 2);

    if (this.opt.bloom > 0) {
      const b = this.buf;
      const o = this.bloomBuf;
      o.fill(0);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const v = b[y * W + x];
          if (v <= 0.03) continue;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              o[ny * W + nx] += v * (dx || dy ? 0.13 : 0.34);
            }
          }
        }
      }
      c.globalCompositeOperation = "lighter";
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const g = o[y * W + x];
          if (g <= 0.05) continue;
          c.fillStyle = `rgba(${this.opt.dot},${Math.min(0.3, g * this.opt.bloom * 0.3)})`;
          c.fillRect(
            this.originX + x * cell,
            this.originY + y * cell,
            cell,
            cell,
          );
        }
      }
      c.globalCompositeOperation = "source-over";
    }

    const mag = this.magnitude;
    const lut = this.lut;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const q = this.buf[i];
        if (q <= 0.03) continue;
        if (mag && lut && mag[i] > MAGNITUDE_EPSILON) {
          // Colour reads the magnitude of what happened here, not the charge.
          //
          // The epsilon matters: magnitude 0 means "no event here", NOT "a tiny
          // event". Without it, every structural cell — the sandpile's resting
          // slope, which covers most of the field — samples the cold end of the
          // ramp and paints in that colour. On the ink-floor ramp, whose cold end
          // is a light grey, that turns an idle mark into a solid grey block.
          // Structure stays plain ink; only real events take the ramp.
          const m = Math.max(0, Math.min(255, (mag[i] * 255) | 0)) * 3;
          c.fillStyle = `rgba(${lut[m]},${lut[m + 1]},${lut[m + 2]},${Math.min(1, q)})`;
        } else {
          c.fillStyle = `rgba(${this.opt.dot},${Math.min(1, q)})`;
        }
        c.fillRect(
          this.originX + x * cell + off,
          this.originY + y * cell + off,
          d,
          d,
        );
      }
    }
  }

  // ---- scene state accessors (used by the scene table) --------------------

  getSigil(): SigilCache {
    this.sigil ??= sigilPattern(this.opt.seed);
    return this.sigil;
  }

  /** Re-seat the lattice origin so a PATTERN (not the cell grid) is centred on
   *  the pixel box. Centring in whole cells leaves the odd cell on one side,
   *  which at 20px is a visible lean. */
  reseatOrigin(
    patternW: number,
    patternH: number,
    scale: number,
    x0: number,
    y0: number,
  ): void {
    const cell = this.cellPx;
    this.originX =
      Math.round((this.canvasW - patternW * scale * cell) / 2) - x0 * cell;
    this.originY =
      Math.round((this.canvasH - patternH * scale * cell) / 2) - y0 * cell;
  }
}

// ---- scenes --------------------------------------------------------------

export type SceneFn = (p: DotPanel, t: number) => void;

export const scenes: Record<DotScene, SceneFn> = {
  /**
   * Identity. Static by design: a mark that twinkles is a mark you cannot
   * recognise. `breath` lifts the whole mark uniformly rather than re-lighting
   * single cells, so an idle resident reads as present without the mark ever
   * becoming unrecognisable.
   */
  sigil(p, t) {
    const s = p.getSigil();
    const FW = s.patternWidth * 2 - 1;
    const scale = Math.max(
      1,
      Math.floor(Math.min(p.W / (FW + 2), p.H / (s.patternHeight + 2))),
    );
    const x0 = Math.floor((p.W - FW * scale) / 2);
    const y0 = Math.floor((p.H - s.patternHeight * scale) / 2);
    p.reseatOrigin(FW, s.patternHeight, scale, x0, y0);
    let v = p.opt.glow;
    if (p.opt.breath) {
      // Deliberately shallow. The phase is per-seed so a column of residents
      // never pulses in lockstep — but that means at any instant they sit at
      // different points in the cycle, and a deep swing would read as one
      // resident being MORE PRESENT than another when both are merely idle.
      // Breath should be perceptible over seconds, never as a difference
      // between two marks seen side by side.
      v *= 0.86 + 0.14 * (0.5 + 0.5 * Math.sin(t / 2100 + s.phase));
    }
    p.buf.fill(0);
    for (let y = 0; y < s.patternHeight; y++) {
      for (let x = 0; x < FW; x++) {
        const col = x < s.patternWidth ? x : FW - 1 - x;
        if (!s.grid[y][col]) continue;
        p.rect(x0 + x * scale, y0 + y * scale, scale, scale, v);
      }
    }
  },

  /**
   * Present, doing nothing. The field is fed barely above nothing, so it rests
   * just below the critical slope and the occasional micro-topple *is* the
   * twinkle — idle is the same physics as thinking, only starved.
   */
  listen: pileScene("listen", 4, (p) => [
    Math.floor(Math.random() * p.W),
    Math.floor(Math.random() * p.H),
  ]),

  /**
   * Generating. Grains pour at the centre and cascades bloom outward on a power
   * law, so it is mostly small activity punctuated by the occasional whole-field
   * avalanche. It never completes and never repeats — a token stream is not a
   * progress bar and should not pretend to be one.
   */
  think: pileScene("think", 34, (p) => [p.W >> 1, p.H >> 1]),

  /**
   * Reading memory. Not a sandpile: walkers stick to what is already remembered,
   * so the mark visibly accretes into a dendrite. The different physics is
   * deliberate — it is what keeps `recall` distinguishable from the pile states
   * at rail scale.
   */
  recall: dlaScene,

  /** Background work: a metered pour walking across the field. Determinate in
   *  position, but the ticks are topple events rather than a smooth fill. */
  work: pileScene("work", 26, (p, _st, t) => [
    Math.floor(((t / 5200) % 1) * p.W),
    p.H >> 1,
  ]),

  /** A room: two pour points, cascades colliding — so a glance at the rail
   *  tells you the room is alive without you. */
  net: pileScene("net", 22, (p, st, t) => {
    const which = Math.sin(t / 1700) > 0 ? 0.3 : 0.7;
    st.angle += 0.02;
    return [
      Math.floor(p.W * which),
      Math.floor(p.H * (0.4 + 0.2 * Math.sin(st.angle))),
    ];
  }),

  /** Asleep — the well nearly out, one dot every few seconds. */
  sleep(p) {
    p.fade(0.97);
    if (Math.random() < 0.09) {
      p.add(
        Math.floor(Math.random() * p.W),
        Math.floor(Math.random() * p.H),
        0.3,
      );
    }
  },

  /** Speaking — rings leaving the centre. */
  pulse(p, t) {
    p.fade(0.86);
    const maxr = Math.min(p.W, p.H) * 0.5;
    for (let k = 0; k < 3; k++) {
      const r = ((t / 900 + k / 3) % 1) * maxr;
      p.ring(p.W / 2, p.H / 2, r, 0.85 * (1 - r / maxr));
    }
    p.disc(p.W / 2, p.H / 2, 1.2, 0.9, true);
  },

  /**
   * Disconnected — the field losing charge.
   *
   * The earlier version lit one row of a fourteen-row lattice, so ~90% of the
   * panel was empty and it read as broken rather than as *disconnected*. Here
   * the whole field is de-energising from the edges inward and the stalled
   * trace is simply the last thing still lit. Monochrome by law: nothing is
   * happening, so there is no magnitude to colour.
   */
  fault(p, t) {
    p.fade(0.93);
    const cx = (p.W - 1) / 2;
    const cy = (p.H - 1) / 2;
    const maxR = Math.hypot(cx, cy);
    // A collapsing horizon — outside it the field has already gone dark.
    const horizon = maxR * (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t / 5400)));
    for (let y = 0; y < p.H; y++) {
      for (let x = 0; x < p.W; x++) {
        const r = Math.hypot(x - cx, y - cy);
        if (r > horizon) continue;
        // Dying static: sparse, dim, and biased toward the centre.
        if (Math.random() < 0.04) p.add(x, y, 0.04 + 0.13 * (1 - r / horizon));
      }
    }
    // The stalled trace, still the strongest thing on the panel.
    const y0 = Math.round(cy);
    const gap = Math.round(p.W * 0.5);
    const gapW = Math.max(2, p.W * 0.1);
    const jitter = Math.sin(t / 190) > 0.84 ? 1 : 0;
    for (let x = 0; x < p.W; x++) {
      if (Math.abs(x - gap) < gapW) continue;
      const falloff = 1 - Math.abs(x - cx) / (p.W * 0.75);
      p.set(x, y0 + (x > gap ? jitter : 0), 0.32 + 0.4 * Math.max(0, falloff));
    }
    // The one surviving contact, arcing across the gap.
    if (Math.sin(t / 640) > 0.93) p.add(gap, y0, 0.9);
  },

  /** Occupancy as a held level. A quantity is not a process: this never
   *  animates, and the lattice runs full width so it reads as a scale even when
   *  nearly empty. */
  fill(p) {
    p.buf.fill(0);
    const lvl = Math.max(0, Math.min(1, p.opt.level));
    const base = p.H - 2;
    const edge = Math.round(lvl * (p.W - 1));
    for (let x = 0; x < p.W; x++) {
      for (let y = 0; y < base; y++) {
        if ((x + y) % 2) continue;
        p.set(x, y, x < edge ? 0.42 : 0.075);
      }
    }
    for (let y = 0; y < base; y++) p.set(edge, y, 0.95);
    for (let x = 0; x < p.W; x += 4) p.set(x, base + 1, x < edge ? 0.62 : 0.14);
  },
};

// ---- host ----------------------------------------------------------------

const panels = new Set<DotPanel>();
let rafId = 0;
let intersectionObserver: IntersectionObserver | null = null;
let resizeObserver: ResizeObserver | null = null;

const panelByCanvas = new WeakMap<Element, DotPanel>();

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Extra scenes registered at runtime. The exploration lab injects its
 * experimental table here so nothing experimental has to be added to the
 * production `scenes` record (and so nothing experimental can ship by
 * accident).
 */
const extraScenes = new Map<string, SceneFn>();

export function registerScene(name: string, fn: SceneFn): void {
  extraScenes.set(name, fn);
}

/**
 * Scenes that actually write `panel.magnitude`. Colour is enabled ONLY for
 * these, because a scene whose magnitude is zero everywhere gets painted the
 * cold end of the ramp in every cell — flat indigo, and worse than monochrome.
 * Colour therefore reads as "how much just moved", never as decoration.
 *
 * Keep this in step with the scene table: a scene added here that does not
 * write magnitude will go flat, and one omitted from here will lose its colour.
 */
const MAGNITUDE_SCENES: ReadonlySet<DotScene> = new Set<DotScene>([
  "listen",
  "think",
  "recall",
  "work",
  "net",
]);

/**
 * Apply the colour law for a panel's current scene. Idempotent, so it is safe
 * to call on every scene change.
 */
export function applySceneColour(p: DotPanel): void {
  if (MAGNITUDE_SCENES.has(p.scene)) p.enableMagnitude(MAGNITUDE_LUT_INKFLOOR);
  else p.disableMagnitude();
}

function runScene(p: DotPanel, t: number): void {
  const fn = extraScenes.get(p.scene) ?? scenes[p.scene] ?? scenes.listen;
  fn(p, t);
}

/**
 * Advance a panel to a representative frame and paint it once. Used for the
 * first paint (so a panel never shows as blank glass) and as the entire render
 * under reduced motion.
 */
export function settle(p: DotPanel): void {
  if (!p.buf.length) return;
  for (let i = 0; i < 26; i++) runScene(p, i * 33);
  p.draw();
}

function frame(now: number): void {
  rafId = requestAnimationFrame(frame);
  for (const p of panels) {
    if (!p.visible || !p.buf.length) continue;
    if (!p.canvas.isConnected) {
      unregisterPanel(p.canvas);
      continue;
    }
    runScene(p, p.elapsed(now));
    p.draw();
  }
}

function startLoop(): void {
  // Reduced motion renders one settled frame and never starts the loop. The
  // mark stays legible; only the motion stops.
  if (rafId || prefersReducedMotion() || document.hidden) return;
  rafId = requestAnimationFrame(frame);
}

function stopLoop(): void {
  if (!rafId) return;
  cancelAnimationFrame(rafId);
  rafId = 0;
}

function handleVisibilityChange(): void {
  if (document.hidden) stopLoop();
  else if (panels.size) startLoop();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

export function registerPanel(
  canvas: HTMLCanvasElement,
  options: Partial<DotPanelOptions> = {},
): DotPanel {
  const existing = panelByCanvas.get(canvas);
  if (existing) return existing;

  const panel = new DotPanel(canvas, options);
  panelByCanvas.set(canvas, panel);
  panels.add(panel);

  if (!intersectionObserver && typeof IntersectionObserver !== "undefined") {
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const p = panelByCanvas.get(entry.target);
          if (p) p.visible = entry.isIntersecting;
        }
      },
      { rootMargin: "160px" },
    );
  }
  if (!resizeObserver && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const p = panelByCanvas.get(entry.target);
        if (p?.resize()) settle(p);
      }
    });
  }
  intersectionObserver?.observe(canvas);
  resizeObserver?.observe(canvas);

  applySceneColour(panel);
  settle(panel);
  startLoop();
  return panel;
}

export function unregisterPanel(canvas: HTMLCanvasElement): void {
  const panel = panelByCanvas.get(canvas);
  if (!panel) return;
  intersectionObserver?.unobserve(canvas);
  resizeObserver?.unobserve(canvas);
  panels.delete(panel);
  panelByCanvas.delete(canvas);
  if (!panels.size) stopLoop();
}

/** Test/debug hook: how many panels are mounted and whether one loop is running. */
export function __dotDisplayStats(): {
  panels: number;
  running: boolean;
  visible: number;
} {
  let visible = 0;
  for (const p of panels) if (p.visible) visible++;
  return { panels: panels.size, running: rafId !== 0, visible };
}
