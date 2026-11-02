/** Aug 10 presence-dendrite, ported from the approved original-72 study.
 * Drawing/physics are unchanged; only the 60 Hz clock and DPR observation differ.
 * Source: claude/dendrite-growth, original-72/assets/luca-sigil-engine.js.
 */
type Stop = [number, [number, number, number]];

function buildLut(stops: Stop[]) {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++)
      if (t >= stops[s][0] && t <= stops[s + 1][0]) {
        a = stops[s];
        b = stops[s + 1];
        break;
      }
    const f = (t - a[0]) / (b[0] - a[0] || 1);
    lut[i * 3] = (a[1][0] + (b[1][0] - a[1][0]) * f) | 0;
    lut[i * 3 + 1] = (a[1][1] + (b[1][1] - a[1][1]) * f) | 0;
    lut[i * 3 + 2] = (a[1][2] + (b[1][2] - a[1][2]) * f) | 0;
  }
  return lut;
}

export const MAGNITUDE_LUT_INKFLOOR = buildLut([
  [0, [188, 192, 196]],
  [0.3, [150, 150, 175]],
  [0.5, [196, 58, 150]],
  [0.72, [240, 120, 86]],
  [0.88, [250, 178, 76]],
  [1, [255, 244, 226]],
]);
const MAGNITUDE_EPSILON = 0.02;

function makeDla(p: DotPanel) {
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
type DlaState = ReturnType<typeof makeDla>;

export function dlaScene(p: DotPanel) {
  // biome-ignore lint/correctness/useHookAtTopLevel: Original simulation cache method, not a React hook.
  const st = p.useSim("dla", () => makeDla(p));
  p.fade(0.9);
  const cx = (p.W - 1) / 2;
  const cy = (p.H - 1) / 2;
  const bound = Math.min(p.W, p.H) * 0.46;
  const neighbourStuck = (x: number, y: number) => {
    if (x > 0 && st.stuck[y * p.W + x - 1]) return true;
    if (x < p.W - 1 && st.stuck[y * p.W + x + 1]) return true;
    if (y > 0 && st.stuck[(y - 1) * p.W + x]) return true;
    if (y < p.H - 1 && st.stuck[(y + 1) * p.W + x]) return true;
    return false;
  };
  const release = (w: { x: number; y: number }) => {
    const a = Math.random() * Math.PI * 2;
    const r = Math.min(bound, st.radius + 2.5);
    w.x = cx + Math.cos(a) * r;
    w.y = cy + Math.sin(a) * r;
  };
  for (let step = 0; step < 5; step++)
    for (const w of st.walkers) {
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
  if (st.radius >= bound - 1 || st.count > p.W * p.H * 0.3)
    Object.assign(st, makeDla(p));
  for (let i = 0; i < st.stuck.length; i++) {
    if (!st.stuck[i]) continue;
    const a = st.age[i];
    const v = 0.3 + 0.68 * a;
    if (v > p.buf[i]) p.buf[i] = v;
    if (p.magnitude) p.magnitude[i] = 0.2 + 0.7 * a;
    if (a > 0.001) st.age[i] = a * 0.985;
  }
}

/** Only the original panel fields/methods used by DLA and its default draw. */
export class DotPanel {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  visible = true;
  W = 0;
  H = 0;
  buf: Float32Array = new Float32Array(0);
  cellPx = 4;
  originX = 0;
  originY = 0;
  canvasW = 0;
  canvasH = 0;
  sim: { key: string; state: DlaState } | null = null;
  magnitude: Float32Array | null = null;
  lut: Uint8Array | null = null;
  readonly opt = { glass: "transparent", dot: "239,239,237", cell: 1 };

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("dot-display: 2d context unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.resize();
  }
  enableMagnitude(lut: Uint8Array) {
    this.lut = lut;
    if (!this.magnitude || this.magnitude.length !== this.buf.length)
      this.magnitude = new Float32Array(this.buf.length);
  }
  useSim(key: string, create: () => DlaState) {
    if (!this.sim || this.sim.key !== key) this.sim = { key, state: create() };
    return this.sim.state;
  }
  resize() {
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
    this.originX = Math.floor((cw - W * cell) / 2);
    this.originY = Math.floor((ch - H * cell) / 2);
    this.buf = new Float32Array(W * H);
    if (this.magnitude) this.magnitude = new Float32Array(W * H);
    this.sim = null;
    return true;
  }
  fade(k: number) {
    const b = this.buf;
    for (let i = 0; i < b.length; i++) {
      b[i] *= k;
      if (b[i] < 0.005) b[i] = 0;
    }
  }
  add(x: number, y: number, v: number) {
    const ix = x | 0;
    const iy = y | 0;
    if (ix < 0 || iy < 0 || ix >= this.W || iy >= this.H) return;
    const i = iy * this.W + ix;
    this.buf[i] = Math.min(1.5, this.buf[i] + v);
  }
  draw() {
    if (!this.buf.length) return;
    const c = this.ctx;
    const { W, H } = this;
    const cell = this.cellPx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvasW, this.canvasH);
    if (this.opt.glass !== "transparent") {
      c.fillStyle = this.opt.glass;
      c.fillRect(0, 0, this.canvasW, this.canvasH);
    }
    const gutter = cell >= 8 ? Math.round(cell * 0.25) : cell >= 4 ? 1 : 0;
    const d = Math.max(1, cell - gutter);
    const off = Math.floor((cell - d) / 2);
    // The original defaults to bloom: 0, so its bloom branch never runs.
    const mag = this.magnitude;
    const lut = this.lut;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const q = this.buf[i];
        if (q <= 0.03) continue;
        if (mag && lut && mag[i] > MAGNITUDE_EPSILON) {
          const m = Math.max(0, Math.min(255, (mag[i] * 255) | 0)) * 3;
          c.fillStyle = `rgba(${lut[m]},${lut[m + 1]},${lut[m + 2]},${Math.min(1, q)})`;
        } else c.fillStyle = `rgba(${this.opt.dot},${Math.min(1, q)})`;
        c.fillRect(
          this.originX + x * cell + off,
          this.originY + y * cell + off,
          d,
          d,
        );
      }
  }
}

function settle(panel: DotPanel, steps: number) {
  if (!panel.buf.length) return;
  for (let i = 0; i < steps; i++) dlaScene(panel);
  panel.draw();
}

/** One fixed-step clock shared by the original panels, independent of refresh rate. */
export class OriginalRenderer {
  private panels = new Set<DotPanel>();
  private byCanvas = new WeakMap<Element, DotPanel>();
  private initialResize = new WeakSet<DotPanel>();
  private mounted = new WeakSet<DotPanel>();
  private rafId = 0;
  private last = 0;
  private carry = 0;
  private reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  private resolution: MediaQueryList | null = null;
  private io: IntersectionObserver | null;
  private ro: ResizeObserver | null;

  constructor() {
    this.io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                const panel = this.byCanvas.get(entry.target);
                if (panel) panel.visible = entry.isIntersecting;
              }
              this.wake();
            },
            { rootMargin: "160px" },
          );
    this.ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            for (const entry of entries) {
              const panel = this.byCanvas.get(entry.target);
              if (!panel) continue;
              const rect = panel.canvas.getBoundingClientRect();
              const dpr = Math.min(2, window.devicePixelRatio || 1);
              const same =
                panel.canvasW === Math.round(rect.width * dpr) &&
                panel.canvasH === Math.round(rect.height * dpr);
              // The approved 20-step mount already includes the first RO settle.
              if (
                this.initialResize.delete(panel) &&
                same &&
                this.mounted.has(panel)
              )
                continue;
              if (panel.resize()) this.settlePanel(panel);
            }
          });
    document.addEventListener("visibilitychange", this.wake);
    this.reduce.addEventListener("change", this.wake);
    this.watchResolution();
  }
  private settlePanel(panel: DotPanel) {
    settle(panel, this.mounted.has(panel) ? 7 : 20);
    if (panel.buf.length) this.mounted.add(panel);
  }
  private watchResolution = () => {
    this.resolution?.removeEventListener("change", this.resizeResolution);
    this.resolution = window.matchMedia(
      `(resolution: ${window.devicePixelRatio || 1}dppx)`,
    );
    this.resolution.addEventListener("change", this.resizeResolution);
  };
  private resizeResolution = () => {
    for (const panel of this.panels)
      if (panel.resize()) this.settlePanel(panel);
    this.watchResolution();
  };
  private stop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.carry = 0;
    this.last = 0;
  }
  private wake = () => {
    if (this.reduce.matches || document.hidden || !this.panels.size) {
      this.stop();
      return;
    }
    if (this.rafId) return;
    this.last = performance.now();
    this.carry = 0;
    this.rafId = requestAnimationFrame(this.frame);
  };
  private frame = (now: number) => {
    this.rafId = 0;
    if (this.reduce.matches || document.hidden || !this.panels.size) {
      this.stop();
      return;
    }
    const step = 1000 / 60;
    this.carry = Math.min(step * 4, this.carry + Math.max(0, now - this.last));
    this.last = now;
    // Tolerate floating-point subtraction at exact 60/120/240 Hz boundaries.
    const steps = Math.min(4, Math.floor((this.carry + 1e-7) / step));
    this.carry = Math.max(0, this.carry - steps * step);
    for (const panel of this.panels) {
      if (!panel.visible || !panel.buf.length) continue;
      if (!panel.canvas.isConnected) {
        this.unregister(panel);
        continue;
      }
      for (let i = 0; i < steps; i++) dlaScene(panel);
      if (steps) panel.draw();
    }
    if (this.panels.size) this.rafId = requestAnimationFrame(this.frame);
  };
  register(canvas: HTMLCanvasElement) {
    const panel = new DotPanel(canvas);
    panel.enableMagnitude(MAGNITUDE_LUT_INKFLOOR);
    this.panels.add(panel);
    this.byCanvas.set(canvas, panel);
    this.initialResize.add(panel);
    this.settlePanel(panel);
    this.io?.observe(canvas);
    this.ro?.observe(canvas);
    this.wake();
    return { panel, dispose: () => this.unregister(panel) };
  }
  private unregister(panel: DotPanel) {
    this.io?.unobserve(panel.canvas);
    this.ro?.unobserve(panel.canvas);
    this.panels.delete(panel);
    this.byCanvas.delete(panel.canvas);
    if (!this.panels.size) this.stop();
  }
}

let instance: OriginalRenderer | null = null;
export function originalRenderer() {
  if (typeof window === "undefined") return null;
  instance ??= new OriginalRenderer();
  return instance;
}
