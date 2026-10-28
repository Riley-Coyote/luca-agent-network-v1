import {
  defaultFingerprintStore,
  dequantizeUV,
  type FingerprintStore,
  fingerprintCacheKey,
  quantizeUV,
} from "./cache";
import {
  CpuGrowth,
  type FingerprintKind,
  fingerprintCore,
  GROWTH,
  KIND_ISO,
  mulberry32,
  N,
  startGrowth,
  toTextureAngle,
  toTextureUV,
} from "./growth";
import type { GrowReply, GrowRequest } from "./growth.worker";
import { GROW, PRINT, VERT } from "./shaders";

/**
 * One renderer for every agent's fingerprint (WP-39, Decided 3–5). It owns a
 * single WebGL 2 context: there it grows each print once, one agent at a time
 * and off the frame's critical path (or in a worker on the CPU, where float
 * targets aren't offered), and there it draws every mark into one atlas,
 * copying each changed mark out to its own canvas once a frame, as the study
 * does (design-lab/agent-marks/fingerprint/template.html).
 *
 * The motion is drawn, never grown: the light drifting, the ridges breathing
 * and the wave running out are uniforms over a print that never changes, so a
 * print always returns to exactly itself.
 */

const TAU = Math.PI * 2;

export type FingerprintVariant = "rail" | "large";

export type FingerprintMarkOptions = {
  seed: number;
  kind: FingerprintKind;
  size: number;
  variant: FingerprintVariant;
  working: boolean;
  current: boolean;
  onReady: () => void;
};

export type FingerprintMarkHandle = {
  update(next: { working: boolean; current: boolean }): void;
  dispose(): void;
};

type Rhythm = { T: number; ph: number; Tb: number; phb: number };

/** At rest each print keeps its own time, from its seed (the study's). */
function rhythmOf(seed: number): Rhythm {
  const r = mulberry32(seed ^ 0x6a09);
  return { T: 11 + r() * 6, ph: r() * TAU, Tb: 5 + r() * 3, phb: r() * TAU };
}

/** The light drifts ±0.95 rad around the top, every 11–17 s. */
function restLight(rhythm: Rhythm, t: number): [number, number] {
  const az =
    0.95 * Math.sin((TAU * t) / rhythm.T + rhythm.ph) +
    0.18 * Math.sin((TAU * t) / (rhythm.T * 0.37) + rhythm.ph * 1.7);
  return [Math.sin(az), Math.cos(az)];
}

type Print = {
  key: string;
  seed: number;
  kind: FingerprintKind;
  core: [number, number];
  rhythm: Rhythm;
  /** The quantized-then-restored U, V the drawing reads (kept to restore a
   *  lost context). */
  uv: Float32Array | null;
  tex: WebGLTexture | null;
  state: "queued" | "growing" | "ready";
  work: number;
  waveA: number;
  wavePhase: number;
  ring: { t0: number; strength: number } | null;
  marks: Set<Mark>;
};

type Mark = {
  id: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  style: CSSStyleDeclaration;
  print: Print;
  variant: FingerprintVariant;
  W: number;
  sx: number;
  sy: number;
  working: boolean;
  current: boolean;
  light: [number, number];
  target: [number, number];
  hover: boolean;
  visible: boolean;
  dirty: boolean;
  inkCss: string;
  ink: [number, number, number];
  inkAlpha: number;
  renders: number;
  onReady: () => void;
  detach: () => void;
};

type GrowthRecord = {
  key: string;
  kind: FingerprintKind;
  path: "gpu" | "cpu" | "cache";
  /** When it began, on the page's clock. */
  startedAt: number;
  /** Wall time from start to a drawable print. */
  ms: number;
  /** Time the work itself took (the GPU's slices, or the worker's run). */
  workMs: number;
};

type Program = {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
};

const FALLBACK_INK: [number, number, number] = [0.93, 0.93, 0.95];

/** A computed CSS colour as sRGB in [0, 1], with its alpha. */
export function parseCssColor(
  value: string,
): { rgb: [number, number, number]; alpha: number } | null {
  const rgb = /^rgba?\(([^)]+)\)$/.exec(value.trim());
  if (rgb) {
    const parts = rgb[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return {
      rgb: [parts[0] / 255, parts[1] / 255, parts[2] / 255],
      alpha: parts[3] ?? 1,
    };
  }
  const srgb = /^color\(srgb ([^)]+)\)$/.exec(value.trim());
  if (srgb) {
    const parts = srgb[1]
      .split(/[\s/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return { rgb: [parts[0], parts[1], parts[2]], alpha: parts[3] ?? 1 };
  }
  return null;
}

const nextTask = () =>
  new Promise<void>((resolve) => window.setTimeout(resolve, 0));

/** Waits, without blocking, until the GPU has done all it was given; says
 *  how many timer turns that took. */
async function gpuDone(gl: WebGL2RenderingContext): Promise<number> {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) throw new Error("fingerprint: no fence");
  gl.flush();
  try {
    for (let turns = 0; ; turns++) {
      if (gl.isContextLost()) throw new Error("fingerprint: context lost");
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
        return turns;
      }
      if (status === gl.WAIT_FAILED) throw new Error("fingerprint: fence");
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1));
    }
  } finally {
    gl.deleteSync(sync);
  }
}

class FingerprintRenderer {
  private readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private draw!: Program;
  private grow!: Program;
  private floatTargets = false;
  private readonly store: FingerprintStore = defaultFingerprintStore();
  private readonly prints = new Map<string, Print>();
  private readonly marks = new Set<Mark>();
  private readonly queue: Print[] = [];
  private growing = false;
  private worker: Worker | null | undefined;
  private readonly workerWaits = new Map<number, (reply: GrowReply) => void>();
  private workerId = 0;
  private markId = 0;
  private layoutDirty = true;
  private raf = 0;
  private last = 0;
  private tick = 0;
  private awakeUntil = 0;
  private lost = false;
  private readonly reduce: MediaQueryList;
  private still: boolean;
  private readonly io: IntersectionObserver | null;
  readonly stats = {
    frames: 0,
    growth: [] as GrowthRecord[],
  };

  constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.setUp();
    this.reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.still = this.reduce.matches;
    this.reduce.addEventListener("change", () => {
      this.still = this.reduce.matches;
      this.touchAll();
    });
    this.io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            for (const entry of entries) {
              for (const mark of this.marks) {
                if (mark.canvas !== entry.target) continue;
                mark.visible = entry.isIntersecting;
                mark.dirty = true;
              }
            }
            this.wake();
          });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.wake();
    });
    // A theme change recolours the rail's ink: look again for a moment.
    new MutationObserver(() => this.wake(400)).observe(
      document.documentElement,
      { attributes: true },
    );
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      this.setUp();
      for (const print of this.prints.values()) {
        print.tex = print.uv ? this.printTexture(print.uv) : null;
      }
      this.touchAll();
    });
  }

  // ---- GL ------------------------------------------------------------------

  private setUp() {
    const gl = this.gl;
    this.draw = this.program(PRINT);
    this.grow = this.program(GROW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.floatTargets = this.probeFloatTargets();
  }

  private program(frag: string): Program {
    const gl = this.gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) throw new Error("fingerprint: no shader");
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s) ?? "fingerprint: shader");
      }
      return s;
    };
    const p = gl.createProgram();
    if (!p) throw new Error("fingerprint: no program");
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, "aPos");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) ?? "fingerprint: link");
    }
    const u: Program["u"] = {};
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      if (info) u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  private texture(
    internal: number,
    format: number,
    data: Float32Array | null,
  ): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture();
    if (!t) throw new Error("fingerprint: no texture");
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, N, N, 0, format, gl.FLOAT, data);
    return t;
  }

  private printTexture(uv: Float32Array) {
    return this.texture(this.gl.RG32F, this.gl.RG, uv);
  }

  private probeFloatTargets(): boolean {
    const gl = this.gl;
    if (!gl.getExtension("EXT_color_buffer_float")) return false;
    const t = this.texture(gl.RGBA32F, gl.RGBA, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      t,
      0,
    );
    const ok =
      gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(t);
    return ok;
  }

  // ---- marks ---------------------------------------------------------------

  register(
    canvas: HTMLCanvasElement,
    options: FingerprintMarkOptions,
  ): FingerprintMarkHandle {
    const print = this.printFor(options.seed, options.kind);
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const W = Math.max(8, Math.round(options.size * dpr));
    canvas.width = W;
    canvas.height = W;
    const mark: Mark = {
      id: ++this.markId,
      canvas,
      ctx: canvas.getContext("2d"),
      style: window.getComputedStyle(canvas),
      print,
      variant: options.variant,
      W,
      sx: 0,
      sy: 0,
      working: options.working,
      current: options.current,
      light: [0, 1],
      target: [0, 1],
      hover: false,
      visible: true,
      dirty: true,
      inkCss: "",
      ink: FALLBACK_INK,
      inkAlpha: 1,
      renders: 0,
      onReady: options.onReady,
      detach: () => {},
    };
    canvas.dataset.fingerprintMark = String(mark.id);
    mark.detach = this.attachPointer(mark);
    print.marks.add(mark);
    this.marks.add(mark);
    this.io?.observe(canvas);
    this.layoutDirty = true;
    if (print.state === "ready") options.onReady();
    this.wake();
    return {
      update: ({ working, current }) => {
        if (mark.working === working && mark.current === current) return;
        mark.working = working;
        mark.current = current;
        mark.dirty = true;
        this.wake(400);
      },
      dispose: () => {
        mark.detach();
        this.io?.unobserve(canvas);
        this.marks.delete(mark);
        print.marks.delete(mark);
        this.layoutDirty = true;
        this.wake();
      },
    };
  }

  /** The pointer moves the light; its row is the one that answers it. */
  private attachPointer(mark: Mark): () => void {
    const el =
      mark.canvas.closest("[data-fingerprint-light]") ??
      mark.canvas.closest(".luca-rail-row") ??
      mark.canvas.parentElement ??
      mark.canvas;
    const move = (event: Event) => {
      const e = event as PointerEvent;
      const r = mark.canvas.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = -(e.clientY - (r.top + r.height / 2));
      const l = Math.hypot(x, y);
      if (l < 0.5) return;
      mark.hover = true;
      mark.target = [x / l, y / l];
      this.wake(400);
    };
    const leave = () => {
      mark.hover = false;
      this.wake(400);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerenter", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerenter", move);
      el.removeEventListener("pointerleave", leave);
    };
  }

  /** A voice in the room: a ring of light runs out across a print. */
  ring(seed: number, strength = 1, delayMs = 0) {
    if (this.still) return;
    const t0 = (performance.now() + delayMs) / 1000;
    for (const print of this.prints.values()) {
      if (print.seed === seed >>> 0) print.ring = { t0, strength };
    }
    this.wake();
  }

  private touchAll() {
    for (const mark of this.marks) mark.dirty = true;
    this.wake(400);
  }

  // ---- growth --------------------------------------------------------------

  private printFor(seed: number, kind: FingerprintKind): Print {
    const key = fingerprintCacheKey(seed, kind);
    const known = this.prints.get(key);
    if (known) return known;
    const print: Print = {
      key,
      seed: seed >>> 0,
      kind,
      core: fingerprintCore(kind, seed),
      rhythm: rhythmOf(seed),
      uv: null,
      tex: null,
      state: "queued",
      work: 0,
      waveA: 0.55,
      wavePhase: 0,
      ring: null,
      marks: new Set(),
    };
    this.prints.set(key, print);
    this.queue.push(print);
    queueMicrotask(() => this.pump());
    return print;
  }

  /** One agent at a time. */
  private pump() {
    if (this.growing) return;
    let next = this.queue.shift();
    // Nobody wears it any more: forget it rather than grow it.
    while (next && next.marks.size === 0) {
      this.prints.delete(next.key);
      next = this.queue.shift();
    }
    if (!next) return;
    const print = next;
    this.growing = true;
    print.state = "growing";
    this.produce(print)
      .catch(() => {
        // A lost context or a failed worker: try again later.
        print.state = "queued";
        window.setTimeout(() => {
          this.queue.push(print);
          this.pump();
        }, 1000);
      })
      .finally(() => {
        this.growing = false;
        this.pump();
      });
  }

  private async produce(print: Print) {
    const t0 = performance.now();
    const cached = await this.store.get(print.key);
    if (cached) {
      this.install(print, dequantizeUV(cached));
      this.stats.growth.push({
        key: print.key,
        kind: print.kind,
        path: "cache",
        startedAt: t0,
        ms: performance.now() - t0,
        workMs: 0,
      });
      return;
    }
    const gpu = this.floatTargets && !this.lost;
    const grown = gpu
      ? await this.growOnGpu(print)
      : await this.growOnCpu(print);
    const q = quantizeUV(grown.uv);
    this.install(print, dequantizeUV(q));
    this.stats.growth.push({
      key: print.key,
      kind: print.kind,
      path: gpu ? "gpu" : "cpu",
      startedAt: t0,
      ms: performance.now() - t0,
      workMs: grown.workMs,
    });
    void this.store.put(print.key, q);
  }

  private install(print: Print, uv: Float32Array) {
    if (this.lost) throw new Error("fingerprint: context lost");
    print.uv = uv;
    print.tex = this.printTexture(uv);
    print.state = "ready";
    for (const mark of print.marks) {
      mark.dirty = true;
      mark.onReady();
    }
    this.wake();
  }

  /** 4000 steps in short slices between frames, each held to ~4 ms. */
  private async growOnGpu(
    print: Print,
  ): Promise<{ uv: Float32Array; workMs: number }> {
    const gl = this.gl;
    const start = startGrowth(print.kind, print.seed);
    const rg = toTextureUV(start.U, start.V);
    const rgba = new Float32Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      rgba[4 * i] = rg[2 * i];
      rgba[4 * i + 1] = rg[2 * i + 1];
      rgba[4 * i + 3] = 1;
    }
    const tex = [
      this.texture(gl.RGBA32F, gl.RGBA, rgba),
      this.texture(gl.RGBA32F, gl.RGBA, rgba),
    ];
    const angle = this.texture(gl.R32F, gl.RED, toTextureAngle(start));
    const fb = tex.map((t) => {
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        t,
        0,
      );
      return f;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let cur = 0;
    let done = 0;
    let perSlice = 25;
    let workMs = 0;
    try {
      while (done < GROWTH.steps) {
        await nextTask();
        if (this.lost || gl.isContextLost()) {
          throw new Error("fingerprint: context lost");
        }
        const s0 = performance.now();
        const count = Math.min(perSlice, GROWTH.steps - done);
        const { u } = this.grow;
        // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook.
        gl.useProgram(this.grow.p);
        gl.disable(gl.SCISSOR_TEST);
        gl.viewport(0, 0, N, N);
        gl.uniform1i(u.uS, 0);
        gl.uniform1i(u.uT, 1);
        gl.uniform1i(u.uN, N);
        gl.uniform1f(u.uF, GROWTH.F);
        gl.uniform1f(u.uK, GROWTH.k);
        gl.uniform1f(u.uA, GROWTH.along);
        gl.uniform1f(u.uB, GROWTH.across);
        gl.uniform1f(u.uIso, KIND_ISO[print.kind]);
        gl.uniform1f(u.uDt, GROWTH.dt);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, angle);
        gl.activeTexture(gl.TEXTURE0);
        for (let k = 0; k < count; k++) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb[1 - cur]);
          gl.bindTexture(gl.TEXTURE_2D, tex[cur]);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          cur = 1 - cur;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        // Handing the steps over can itself block when the GPU is behind
        // (a software GL does): that time is the main thread's.
        const submitMs = performance.now() - s0;
        // A slice is done when the GPU says so, never by stalling for it.
        const turns = await gpuDone(gl);
        workMs += performance.now() - s0;
        done += count;
        // Slices stay a few ms on either side: more when the hand-over was
        // quick and the GPU done by the first timer turn, less otherwise.
        if (submitMs > 4 || turns > 3) {
          perSlice = Math.max(4, Math.round(perSlice / 2));
        } else if (submitMs < 2 && turns <= 1) {
          perSlice = Math.min(500, perSlice * 2);
        }
      }
      // Read back through a pixel buffer, so the read waits on a fence too.
      const out = new Float32Array(N * N * 4);
      const pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, out.byteLength, gl.STREAM_READ);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb[cur]);
      gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      try {
        await gpuDone(gl);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      } finally {
        gl.deleteBuffer(pbo);
      }
      const uv = new Float32Array(N * N * 2);
      for (let i = 0; i < N * N; i++) {
        uv[2 * i] = out[4 * i];
        uv[2 * i + 1] = out[4 * i + 1];
      }
      return { uv, workMs };
    } finally {
      for (const f of fb) gl.deleteFramebuffer(f);
      for (const t of tex) gl.deleteTexture(t);
      gl.deleteTexture(angle);
    }
  }

  /** In a worker; on the main thread in slices if a worker can't start. */
  private async growOnCpu(
    print: Print,
  ): Promise<{ uv: Float32Array; workMs: number }> {
    const worker = this.cpuWorker();
    if (worker) {
      const id = ++this.workerId;
      const reply = await new Promise<GrowReply>((resolve) => {
        this.workerWaits.set(id, resolve);
        const request: GrowRequest = { id, kind: print.kind, seed: print.seed };
        worker.postMessage(request);
      });
      return { uv: reply.uv, workMs: reply.ms };
    }
    const growth = new CpuGrowth(startGrowth(print.kind, print.seed));
    let workMs = 0;
    for (;;) {
      await nextTask();
      const s0 = performance.now();
      const finished = growth.step(40);
      workMs += performance.now() - s0;
      if (finished) break;
    }
    return { uv: toTextureUV(growth.start.U, growth.start.V), workMs };
  }

  private cpuWorker(): Worker | null {
    if (this.worker !== undefined) return this.worker;
    try {
      const worker = new Worker(
        new URL("./growth.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.addEventListener("message", (event: MessageEvent<GrowReply>) => {
        const resolve = this.workerWaits.get(event.data.id);
        this.workerWaits.delete(event.data.id);
        resolve?.(event.data);
      });
      this.worker = worker;
    } catch {
      this.worker = null;
    }
    return this.worker;
  }

  // ---- the frame -----------------------------------------------------------

  private wake(holdMs = 0) {
    this.awakeUntil = Math.max(this.awakeUntil, performance.now() + holdMs);
    if (this.raf || document.hidden || this.lost) return;
    this.last = performance.now() / 1000;
    this.raf = window.requestAnimationFrame(this.frame);
  }

  /** The study's atlas: biggest first, in shelves. */
  private pack() {
    const order = [...this.marks].sort((a, b) => b.W - a.W);
    const AW = Math.max(512, 4 * (order[0]?.W ?? 0));
    let x = 0;
    let y = 0;
    let rowH = 0;
    for (const m of order) {
      if (x + m.W > AW) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      m.sx = x;
      m.sy = y;
      x += m.W;
      rowH = Math.max(rowH, m.W);
      m.dirty = true;
    }
    const AH = Math.max(1, y + rowH);
    if (this.canvas.width !== AW) this.canvas.width = AW;
    if (this.canvas.height !== AH) this.canvas.height = AH;
    this.layoutDirty = false;
  }

  private impulse(print: Print, t: number) {
    const ring = print.ring;
    if (!ring || this.still) return { e: 0, age: -1 };
    const age = t - ring.t0;
    if (age > 4) print.ring = null;
    if (age < 0 || age > 4) return { e: 0, age: -1 };
    return { e: ring.strength * Math.exp(-age / 0.85), age };
  }

  private readInk(mark: Mark) {
    const css = mark.style.color;
    if (css === mark.inkCss) return;
    mark.inkCss = css;
    const parsed = parseCssColor(css);
    mark.ink = parsed?.rgb ?? FALLBACK_INK;
    mark.inkAlpha = parsed?.alpha ?? 1;
    mark.dirty = true;
  }

  private level(mark: Mark) {
    const still = this.still;
    const w = still ? (mark.working ? 1 : 0) : mark.print.work;
    if (mark.variant === "rail") {
      return Math.min(1, (mark.current ? 0.86 : 0.68) + 0.26 * w);
    }
    return Math.min(1, (mark.current ? 0.86 : 0.84) + 0.14 * w);
  }

  private render(mark: Mark, t: number, imp: { e: number; age: number }) {
    const gl = this.gl;
    const print = mark.print;
    const W = mark.W;
    const R = W / 2 - 1;
    const gy = this.canvas.height - mark.sy - W;
    const still = this.still;
    const { u } = this.draw;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(mark.sx, gy, W, W);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(mark.sx, gy, W, W);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook.
    gl.useProgram(this.draw.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, print.tex);
    gl.uniform1i(u.uS, 0);
    gl.uniform1i(u.uN, N);
    gl.uniform1f(u.uSpan, W / 2 / R);
    gl.uniform1f(u.uPx, R);
    gl.uniform1f(u.uOval, 0.84);
    gl.uniform1f(u.uPaper, mark.variant === "rail" ? 1 : 0);
    gl.uniform2f(u.uCore, print.core[0], print.core[1]);
    gl.uniform3f(u.uWave, still ? 0 : print.waveA, TAU / 30, print.wavePhase);
    gl.uniform1f(u.uLevel, this.level(mark) * mark.inkAlpha);
    gl.uniform1f(
      u.uBreath,
      still ? 0 : Math.sin((TAU * t) / print.rhythm.Tb + print.rhythm.phb),
    );
    gl.uniform1f(u.uRipR, imp.e ? imp.age * 1.3 : -1);
    gl.uniform1f(u.uRipA, imp.e);
    gl.uniform2f(u.uLight, mark.light[0], mark.light[1]);
    gl.uniform3f(u.uHi, 0.93, 0.93, 0.95);
    gl.uniform3f(u.uBody, 0.03, 0.03, 0.035);
    gl.uniform3f(u.uInk, mark.ink[0], mark.ink[1], mark.ink[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    mark.dirty = false;
    mark.renders++;
  }

  private readonly frame = (ms: number) => {
    this.raf = 0;
    if (document.hidden || this.lost) return;
    this.stats.frames++;
    const t = ms / 1000;
    const dt = Math.min(0.05, Math.max(0, t - this.last));
    this.last = t;
    const still = this.still;
    if (this.layoutDirty) this.pack();

    for (const print of this.prints.values()) {
      if (print.state !== "ready") continue;
      let working = false;
      for (const mark of print.marks) working ||= mark.working;
      const target = !still && working ? 1 : 0;
      if (still) {
        print.work = target;
      } else {
        const tau = target > print.work ? 0.5 : 1.1;
        print.work += (target - print.work) * (1 - Math.exp(-dt / tau));
        if (Math.abs(target - print.work) < 0.001) print.work = target;
        // Working, the wave quickens to ~2.2 s and 1.5 texels.
        print.waveA = 0.55 + 0.95 * print.work;
        print.wavePhase =
          (print.wavePhase + dt * (TAU / (6.5 - 4.3 * print.work))) % TAU;
      }
    }

    this.tick++;
    const resting = !still && (this.tick & 1) === 0;
    const drawn: Mark[] = [];
    let anyLive = false;
    for (const mark of this.marks) {
      if (!mark.visible || mark.print.state !== "ready") continue;
      anyLive = true;
      if (mark.variant === "rail") this.readInk(mark);
      if (still) {
        if (mark.light[0] !== 0 || mark.light[1] !== 1) {
          mark.light = [0, 1];
          mark.dirty = true;
        }
      } else {
        const base = restLight(mark.print.rhythm, t);
        const tgt: [number, number] = mark.hover
          ? [mark.target[0] * 0.85, 0.15 + mark.target[1] * 0.85]
          : base;
        const k = 1 - Math.exp(-dt / 0.12);
        let lx = mark.light[0] + (tgt[0] - mark.light[0]) * k;
        let ly = mark.light[1] + (tgt[1] - mark.light[1]) * k;
        const l = Math.hypot(lx, ly) || 1;
        lx /= l;
        ly /= l;
        mark.light = [lx, ly];
      }
      const imp = this.impulse(mark.print, t);
      const busy =
        !still && (mark.print.work > 0.0005 || imp.e > 0.002 || mark.hover);
      if (mark.dirty || busy || resting) {
        this.render(mark, t, imp);
        drawn.push(mark);
      }
    }
    for (const mark of drawn) {
      if (!mark.ctx) continue;
      mark.ctx.clearRect(0, 0, mark.W, mark.W);
      mark.ctx.drawImage(
        this.canvas,
        mark.sx,
        mark.sy,
        mark.W,
        mark.W,
        0,
        0,
        mark.W,
        mark.W,
      );
    }

    // Still, the loop sleeps until something changes; moving, it runs while
    // any print is on screen.
    let dirty = false;
    for (const mark of this.marks) dirty ||= mark.dirty && mark.visible;
    if ((!still && anyLive) || dirty || performance.now() < this.awakeUntil) {
      this.raf = window.requestAnimationFrame(this.frame);
    }
  };

  /** For the proof harness: what the renderer has done. */
  snapshot() {
    return {
      floatTargets: this.floatTargets,
      still: this.still,
      frames: this.stats.frames,
      growth: [...this.stats.growth],
      prints: [...this.prints.values()].map((p) => ({
        key: p.key,
        kind: p.kind,
        state: p.state,
      })),
      marks: [...this.marks].map((m) => ({
        id: m.id,
        key: m.print.key,
        variant: m.variant,
        visible: m.visible,
        ready: m.print.state === "ready",
        renders: m.renders,
      })),
    };
  }
}

let renderer: FingerprintRenderer | null | undefined;

/** The one renderer, or null where WebGL 2 isn't offered at all. */
export function fingerprintRenderer(): FingerprintRenderer | null {
  if (renderer !== undefined) return renderer;
  renderer = null;
  if (typeof document === "undefined") return renderer;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
      depth: false,
      stencil: false,
    });
    if (gl) renderer = new FingerprintRenderer(canvas, gl);
  } catch {
    renderer = null;
  }
  if (
    renderer &&
    (import.meta.env?.DEV || import.meta.env?.MODE === "e2e") &&
    typeof window !== "undefined"
  ) {
    const live = renderer;
    (
      window as Window & { __LUCA_FINGERPRINTS__?: unknown }
    ).__LUCA_FINGERPRINTS__ = { snapshot: () => live.snapshot() };
  }
  return renderer;
}
