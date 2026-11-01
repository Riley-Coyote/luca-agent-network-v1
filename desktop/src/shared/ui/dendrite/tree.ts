import { residentGlyphSeed } from "@/features/luca/canonicalLucaResident";

/** 32-bit FNV-1a over a string's characters. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Stable resident identity; growth itself stays random, as in the approved study. */
export function dendriteSeed(
  publicKey: string,
  lucaPubkey?: string | null,
): number {
  return fnv1a(
    lucaPubkey === undefined
      ? residentGlyphSeed(publicKey)
      : residentGlyphSeed(publicKey, lucaPubkey),
  );
}

/** A small, fast generator: the same seed gives the same numbers forever. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Random = () => number;
export type RGB = [number, number, number];
export type MarkMode = "auto" | "off" | "grid" | "pixel";
export type Steps = { chunk: number; total: number };
export type GrowthTree = {
  xs: Float32Array;
  ys: Float32Array;
  ps?: Int32Array;
  n: number;
};
export type RenderTree = GrowthTree & {
  born: Float32Array;
  reveal: Float32Array;
  ember: Uint8Array;
  shown: number;
  fadeT0: number;
};
export type MarkOptions = {
  size: number;
  mode?: MarkMode;
  working?: boolean;
  colour?: RGB | null;
  phase?: "rest" | "seed";
  rand?: Random;
  group?: string;
  /** Identity only; the approved engine grows fresh random trees. */
  seed?: number;
};
export type Mote = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
};

/**
 * Agent marks at the screen's true pixel: fine-marks.js
 *
 * The Sept 9 dendrite (the website's agent band: the dot-display engine's
 * grid DLA on the INKFLOOR ramp, in a round glass well), redrawn at the
 * screen's own resolution so it is sharp at 72 px and still clear at 18-24 px,
 * and grown as a smooth flow rather than dot by dot. Two candidates share
 * everything but the growth:
 *
 *   A "off"  Off-lattice DLA in device pixels. Particles with continuous
 *            positions random-walk (step 0.7 s, a gentle inward pull of PULL s,
 *            and one long jump when far from the tree) and stick on touching
 *            the tree, one spacing s from the particle they touch, so branches
 *            run at any angle. s is 1 device px at 24 px and under and 1.9 at
 *            72 (spacingFor), so a big mark stays an open dendrite with dark
 *            space between its branches. Each particle is drawn as a short line
 *            back to the one it stuck to, laid down as 1-device-pixel bilinear
 *            splats every 0.6 px: a fine, smooth, continuous line.
 *   B "grid" Sept 9's own lattice DLA (4-neighbourhood, unit steps, release on
 *            a ring at radius + 2.5) at one device pixel per dot: 4x the dots
 *            of the original on a Retina screen, each an exact pixel.
 *
 * Both are bounded like the original, at 0.46 of the mark's width, and a new
 * random tree grows every time (Math.random; a seeded generator only in tests).
 *
 * Grow, then reveal. A tree is grown first, out of sight (time-sliced over
 * the frames before it is needed: STEP_BUDGET walker steps a frame), and then
 * revealed in the order it grew: particle k of N appears when the growth
 * progress u passes (k / N)^(1 / 1.71). DLA's mass grows as radius^1.71, so
 * the front moves out at an even speed, with many particles a second each
 * fading in. Timing is in seconds, never frames: u runs 0 -> 1 over GROW
 * seconds (12 at 72 px, 9 at 24 px and under), 1.5x faster while working.
 *
 * Light, per particle, as the original's per cell:
 *   age a = exp(-(seconds since it appeared) / AGE_TAU);
 *   brightness v = min(1, REST_V (0.5; 1.0 at 24 px and under, for 3:1 on the
 *   glass) + 0.6 a) x smoothstep(0, FADE_IN, seconds) — it
 *   fades in over 0.25 s, never pops;
 *   magnitude m = 0.2 + 0.8 a through the INKFLOOR ramp — white-hot as it
 *   arrives, cooling along the ramp to the settled tree's silver; the
 *   outermost tips (nothing grew from them, outer third of the reach) never
 *   cool below EMBER (0.4), a faint warm ember at rest.
 * Light adds up in a buffer the size of the canvas's backing store (size x
 * the real devicePixelRatio, up to 3) and each pixel is written once as its
 * colour at alpha = min(1, light). No blur, filter or glow: an anti-aliased
 * edge, never a halo.
 *
 * The cycle. Grow (GROW s) -> rest, lit (REST_HEAD s at a page's head; at
 * least 20-40 s in the rail, and then the rail's Choir lets only one mark
 * regrow at a time) -> the hand-over: the next tree begins from the seed
 * while the old one holds round it, dimmed by 40% as the new one first rises
 * (u 0 -> 0.35) and faded out only as the new one reaches its outline
 * (u 0.7 -> 1). A mark is never an empty circle.
 *
 * Dust: a few faint motes (DUST_MOTES by size) with continuous positions that
 * drift (momentum 0.5 s, a soft pull inward), each laid down every frame as a
 * bilinear splat into a light buffer that fades with tau DUST_TAU: a short,
 * soft trail. They fade in and out over their lives; nothing blinks.
 *
 * Reduce Motion: one full tree, settled silver, no dust, drawn once.
 *
 * API (as the shipped renderer's):
 *   const off = fineMarks().register(canvas, { size, mode: "off" | "grid",
 *     working, colour: [r, g, b] | null, group, phase: "rest" | "seed" });
 *   off.update({ working }); off.setColour(rgb | null); off();
 * One requestAnimationFrame for every mark; marks off screen
 * (IntersectionObserver) and a hidden document pause; dt clamped to 50 ms.
 */

export const FINE = {
  SPACING_SMALL: 1.0, // A: device px between stuck particles at 24 px and under
  SPACING_HEAD: 1.9, // ... at 72 px (open, about B's count), scaled between
  PULL: 0.04, // A: inward pull per step, in spacings (a whisper: more packs the tree)
  GROW_HEAD: 12, // seconds seed to full at 72 px
  GROW_SMALL: 9, // ... at 24 px and under
  REST_HEAD: 3,
  FADE_IN: 0.25,
  AGE_TAU: 1.2, // seconds fresh growth keeps its colour (growth is about twice Sept 9's pace, so half its 3.3 s... and a little less: colour stays on the front)
  BREAK: 40, // CSS px: under it the fine design, from it up the pixel one
  REST_V_PIXEL: 0.3, // the pixel design's settled brightness: Sept 9's own
  EMBER: 0.4, // the ramp value the outermost tips keep at rest
  LINE_UNIT: 1.0, // device px of line that carries one particle's light
  REST_V_SMALL: 1.0, // ... at 24 px and under, so a fine tree reads on the glass at 3:1 or better
  REST_V: 0.5, // settled brightness (the original's 0.3, raised: a one-device-pixel line has a quarter of a 2 px dot's area)
  WORKING: 1.5,
  STEP_BUDGET: 2500, // walker steps a frame spent growing the next tree (about 0.4 ms)
  FIRST_BUDGET: 40000, // ... while a page's head waits for its first tree (a quarter second at most)
  DUST_TAU: 0.22,
  MOTE_AREA: 600, // device px of mark per dust mote
  MOTE_PEAK: 0.7, // a mote's light, shared by the pixels round it
};

// ── colour ─────────────────────────────────────────────────────────────────

export function buildLut(stops: [number, RGB][]) {
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
    for (let c = 0; c < 3; c++)
      lut[i * 3 + c] = (a[1][c] + (b[1][c] - a[1][c]) * f) | 0;
  }
  return lut;
}
/** The app's INKFLOOR ramp: silver at rest, colour only where something just happened. */
export const INKFLOOR = buildLut([
  [0, [188, 192, 196]],
  [0.3, [150, 150, 175]],
  [0.5, [196, 58, 150]],
  [0.72, [240, 120, 86]],
  [0.88, [250, 178, 76]],
  [1, [255, 244, 226]],
]);
/** One agent's ramp: its colour on the tree, warming to white where it grows. */
export function agentLut([r, g, b]: RGB) {
  const k = (s: number): RGB => [
    Math.round(r * s),
    Math.round(g * s),
    Math.round(b * s),
  ];
  const w = (m: number): RGB => [
    Math.round(r + (255 - r) * m),
    Math.round(g + (250 - g) * m),
    Math.round(b + (240 - b) * m),
  ];
  return buildLut([
    [0, k(0.8)],
    [0.3, k(0.88)],
    [0.55, k(1)],
    [0.8, w(0.5)],
    [1, w(0.92)],
  ]);
}
export const DOT: RGB = [239, 239, 237];
/** How far the old tree dims while the new one first rises inside it. */
export const HANDOVER_DIM = 0.4;

// ── growing a tree, out of sight ───────────────────────────────────────────

/** A: off-lattice DLA in device pixels. A generator: it yields every few thousand steps. */
export function* growOff(
  W: number,
  rand: Random,
  steps: Steps,
  spacing = FINE.SPACING_SMALL,
): Generator<void, GrowthTree, unknown> {
  const c = W / 2;
  const bound = 0.46 * W;
  const s = spacing;
  const xs = [c];
  const ys = [c];
  const ps = [-1];
  const hash = new Map<number, number[]>();
  const key = (x: number, y: number) =>
    Math.floor(x / s) * 8192 + Math.floor(y / s);
  const add = (x: number, y: number) => {
    const k = key(x, y);
    const l = hash.get(k);
    if (l) l.push(xs.length - 1);
    else hash.set(k, [xs.length - 1]);
  };
  add(c, c);
  const near = (x: number, y: number) => {
    const gx = Math.floor(x / s);
    const gy = Math.floor(y / s);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const l = hash.get((gx + a) * 8192 + gy + b);
        if (!l) continue;
        for (const q of l)
          if ((xs[q] - x) ** 2 + (ys[q] - y) ** 2 < s * s) return q;
      }
    }
    return -1;
  };
  let rmax = 0;
  let n = 0;
  while (rmax < bound - s) {
    let a = rand() * Math.PI * 2;
    let R = rmax + 3 * s;
    let x = c + R * Math.cos(a);
    let y = c + R * Math.sin(a);
    for (;;) {
      if (++n % steps.chunk === 0) {
        steps.total = n;
        yield;
      }
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy) || 1;
      if (r > bound + 12 * s) {
        a = rand() * Math.PI * 2;
        R = rmax + 3 * s;
        x = c + R * Math.cos(a);
        y = c + R * Math.sin(a);
        continue;
      }
      if (r > rmax + 6 * s) {
        // Far from the tree a walk can jump: where it first meets a circle
        // round it is uniform, so it lands there in one step.
        const j = r - rmax - 3 * s;
        const b = rand() * Math.PI * 2;
        x += j * Math.cos(b);
        y += j * Math.sin(b);
        continue;
      }
      const b = rand() * Math.PI * 2;
      x += 0.7 * s * Math.cos(b) - (dx / r) * FINE.PULL * s;
      y += 0.7 * s * Math.sin(b) - (dy / r) * FINE.PULL * s;
      const hit = near(x, y);
      if (hit >= 0) {
        const hx = x - xs[hit];
        const hy = y - ys[hit];
        const hl = Math.hypot(hx, hy) || 1;
        const qx = xs[hit] + (hx / hl) * s;
        const qy = ys[hit] + (hy / hl) * s;
        xs.push(qx);
        ys.push(qy);
        ps.push(hit);
        add(qx, qy);
        rmax = Math.max(rmax, Math.hypot(qx - c, qy - c));
        break;
      }
    }
  }
  steps.total = n;
  return {
    xs: Float32Array.from(xs),
    ys: Float32Array.from(ys),
    ps: Int32Array.from(ps),
    n: xs.length,
  };
}

/** B: Sept 9's lattice DLA, one device pixel a cell. A generator, as above. */
export function* growGrid(
  W: number,
  rand: Random,
  steps: Steps,
): Generator<void, GrowthTree, unknown> {
  const stuck = new Uint8Array(W * W);
  const c = (W - 1) / 2;
  const bound = 0.46 * W;
  const seed = (W >> 1) * W + (W >> 1);
  stuck[seed] = 1;
  const index = new Int32Array(W * W).fill(-1);
  index[seed] = 0;
  const xs = [W >> 1];
  const ys = [W >> 1];
  const ps = [-1];
  let radius = 1;
  let n = 0;
  const ring = () => {
    const a = rand() * Math.PI * 2;
    const r = Math.min(bound, radius + 2.5);
    return [c + Math.cos(a) * r, c + Math.sin(a) * r];
  };
  let [x, y] = ring();
  while (radius < bound - 1 && xs.length < W * W * 0.3) {
    if (++n % steps.chunk === 0) {
      steps.total = n;
      yield;
    }
    const d = (rand() * 4) | 0;
    if (d === 0) x += 1;
    else if (d === 1) x -= 1;
    else if (d === 2) y += 1;
    else y -= 1;
    const rr = Math.hypot(x - c, y - c);
    if (rr > bound + 4 || rr > radius + 8) {
      [x, y] = ring();
      continue;
    }
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 1 || iy < 1 || ix >= W - 1 || iy >= W - 1) {
      [x, y] = ring();
      continue;
    }
    const i = iy * W + ix;
    if (stuck[i - 1] || stuck[i + 1] || stuck[i - W] || stuck[i + W]) {
      if (!stuck[i]) {
        stuck[i] = 1;
        index[i] = xs.length;
        ps.push(
          index[
            stuck[i - 1]
              ? i - 1
              : stuck[i + 1]
                ? i + 1
                : stuck[i - W]
                  ? i - W
                  : i + W
          ],
        );
        xs.push(ix);
        ys.push(iy);
        radius = Math.max(radius, rr);
      }
      [x, y] = ring();
    }
  }
  steps.total = n;
  return {
    xs: Float32Array.from(xs),
    ys: Float32Array.from(ys),
    ps: Int32Array.from(ps),
    n: xs.length,
  };
}

/** Grow a tree to completion now (a mark's first tree, and Reduce Motion's). */
/** A's spacing for a mark of this many CSS px: 1 device px at 24 and under, 1.9 at 72. */
export function spacingFor(size: number) {
  return (
    FINE.SPACING_SMALL +
    (FINE.SPACING_HEAD - FINE.SPACING_SMALL) *
      Math.max(0, Math.min(1, (size - 24) / 48))
  );
}

export function growNow(
  mode: MarkMode,
  W: number,
  rand: Random,
  spacing: number,
) {
  const steps = { chunk: 1 << 30, total: 0 };
  const g =
    mode === "off"
      ? growOff(W, rand, steps, spacing)
      : growGrid(W, rand, steps);
  let r = g.next();
  while (!r.done) r = g.next();
  return { ...r.value, steps: steps.total };
}
