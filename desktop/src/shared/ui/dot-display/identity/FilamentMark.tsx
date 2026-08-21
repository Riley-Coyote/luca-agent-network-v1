import * as React from "react";

import { useTheme } from "@/shared/theme/ThemeProvider";
import { glyphLit, type IdentityGlyph, identityGlyph } from "./glyph";
import { glyphMetrics } from "./render";

/**
 * The identity glyph as a filament: while a resident is thinking, light moves
 * along the joined stroke. Identity never leaves — the state lives inside it.
 * A joined glyph is a graph, so light can move on it in several ways; the
 * `motion` prop chooses which. When the reply starts the light arrives and the
 * glyph holds bright (or keeps a faint current, `speaking`).
 *
 * Chosen 2026-08-18 over state-replaces-identity, ellipsis, breath and embers;
 * `traverse` is the production current (most legible at row size). The other
 * currents are kept for the design lab (`?lab=thinking`).
 */

const INK_DARK = "236,238,240";
const INK_LIGHT = "22,23,26";
const OVERLAP = 0.5;

// ---- graph ------------------------------------------------------------------

type Graph = {
  n: number;
  cells: number[];
  neighbours: Map<number, number[]>;
  terminals: number[];
  distFrom: (start: number) => Map<number, number>;
};

function buildGraph(glyph: IdentityGlyph): Graph {
  const n = glyph.edge;
  const key = (x: number, y: number) => y * n + x;
  const cells: number[] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (glyphLit(glyph, x, y)) cells.push(key(x, y));
  const neighbours = new Map<number, number[]>();
  for (const k of cells) {
    const x = k % n;
    const y = Math.floor(k / n);
    const out: number[] = [];
    if (glyphLit(glyph, x, y - 1)) out.push(key(x, y - 1));
    if (glyphLit(glyph, x + 1, y)) out.push(key(x + 1, y));
    if (glyphLit(glyph, x, y + 1)) out.push(key(x, y + 1));
    if (glyphLit(glyph, x - 1, y)) out.push(key(x - 1, y));
    neighbours.set(k, out);
  }
  const terminals = cells.filter((k) => (neighbours.get(k) ?? []).length === 1);
  const cache = new Map<number, Map<number, number>>();
  const distFrom = (start: number) => {
    const hit = cache.get(start);
    if (hit) return hit;
    const distance = new Map<number, number>([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const k = queue.shift() as number;
      const d = distance.get(k) as number;
      for (const m of neighbours.get(k) ?? []) {
        if (distance.has(m)) continue;
        distance.set(m, d + 1);
        queue.push(m);
      }
    }
    cache.set(start, distance);
    return distance;
  };
  return { n, cells, neighbours, terminals, distFrom };
}

function maxOf(map: Map<number, number>) {
  let max = 0;
  for (const v of map.values()) max = Math.max(max, v);
  return max;
}

/** The far end of the stroke from `start`. */
function farthest(g: Graph, start: number) {
  const d = g.distFrom(start);
  let best = start;
  let bestD = -1;
  for (const [k, v] of d) {
    if (v > bestD) {
      bestD = v;
      best = k;
    }
  }
  return best;
}

/** The cell that minimises its greatest distance to any other — the heart. */
function heartOf(g: Graph) {
  let best = g.cells[0];
  let bestEcc = Number.POSITIVE_INFINITY;
  for (const k of g.cells) {
    const ecc = maxOf(g.distFrom(k));
    if (ecc < bestEcc) {
      bestEcc = ecc;
      best = k;
    }
  }
  return best;
}

// ---- paint --------------------------------------------------------------------

function cornerRatio(size: number): number {
  const t = Math.max(0, Math.min(1, (size - 20) / 44));
  return 0.44 + (0.3 - 0.44) * t;
}

function opticalAlpha(base: number, size: number): number {
  const lift = Math.max(0, Math.min(1, (28 - size) / 12));
  return Math.min(1, base * (1 + 0.14 * lift));
}

/**
 * How the glyph sits in its box.
 *
 * `quiet` is the lab's phosphor rendering: integer cells on a lattice with a
 * one-cell quiet zone, rounded, bloomed. `box` is the conversation mark: the
 * exact geometry of the resting SVG glyph — cells at box/edge, corner radius
 * 0.3 cell, no quiet zone — so the mark does not change size or edge when it
 * goes live; only the light inside it moves.
 */
export type FilamentFit = "quiet" | "box";

/** Matches `CORNER_LARGE` in glyphToSvgPath: the resting glyph's outer corner. */
const BOX_CORNER_RATIO = 0.3;

/**
 * Cells at exactly box/edge. Pick a size that is a multiple of the glyph edge
 * (7) so cells land on whole device pixels at every common density — 21 px is
 * 3 px cells at 1x and 6 px at 2x — and adjacent cells abut with no seam and
 * no need for overlap. A fractional size still renders, with anti-aliased
 * seams at the dim level.
 */
function boxMetrics(glyph: IdentityGlyph, size: number, dpr: number) {
  const extent = Math.round(size * dpr);
  return { cell: extent / glyph.edge, originX: 0, originY: 0, extent };
}

function paint(
  ctx: CanvasRenderingContext2D,
  glyph: IdentityGlyph,
  size: number,
  dpr: number,
  ink: string,
  alphaFor: (k: number) => number,
  bloom: boolean,
  fit: FilamentFit,
) {
  const { cell, originX, originY, extent } =
    fit === "box"
      ? boxMetrics(glyph, size, dpr)
      : glyphMetrics(glyph, { size, dpr });
  ctx.clearRect(0, 0, extent, extent);
  const radius = cell * (fit === "box" ? BOX_CORNER_RATIO : cornerRatio(size));
  // Box fit lays cells on whole pixels, so neighbours meet exactly; the quiet
  // lab fit keeps its half-pixel overlap to hide lattice seams.
  const overlap = fit === "box" ? 0 : OVERLAP;
  const n = glyph.edge;
  const draw = (x: number, y: number, alpha: number, blur: number) => {
    const north = glyphLit(glyph, x, y - 1);
    const s = glyphLit(glyph, x, y + 1);
    const w = glyphLit(glyph, x - 1, y);
    const e = glyphLit(glyph, x + 1, y);
    const left = originX + x * cell - (w ? overlap : 0);
    const top = originY + y * cell - (north ? overlap : 0);
    const right = originX + (x + 1) * cell + (e ? overlap : 0);
    const bottom = originY + (y + 1) * cell + (s ? overlap : 0);
    const tl = !north && !w ? radius : 0;
    const tr = !north && !e ? radius : 0;
    const br = !s && !e ? radius : 0;
    const bl = !s && !w ? radius : 0;
    ctx.fillStyle = `rgba(${ink},${opticalAlpha(alpha, size)})`;
    ctx.shadowBlur = blur;
    ctx.shadowColor = blur
      ? `rgba(${ink},${Math.min(1, alpha)})`
      : "transparent";
    ctx.beginPath();
    ctx.roundRect(left, top, right - left, bottom - top, [tl, tr, br, bl]);
    ctx.fill();
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!glyphLit(glyph, x, y)) continue;
      const a = alphaFor(y * n + x);
      // Phosphor bloom on the bright part only: a hair of glow that grows with
      // the light, so the head reads as lit rather than merely whiter.
      const blur = bloom && a > 0.55 ? ((a - 0.55) / 0.45) * cell * 0.9 : 0;
      draw(x, y, a, blur);
    }
  }
  ctx.shadowBlur = 0;
}

// ---- motions ------------------------------------------------------------------

export type FilamentMotion =
  | "traverse"
  | "shuttle"
  | "heart"
  | "converge"
  | "tide"
  | "wander"
  | "murmur";

export type FilamentMode = "current" | "lit" | "speaking" | "rest";

const BASE = 0.3;
const LEAD_SIGMA = 0.85;
const TAIL_SIGMA = 2.4;
const gauss = (delta: number, sigma: number) =>
  Math.exp(-(delta * delta) / (2 * sigma * sigma));
const easeInOut = (u: number) =>
  u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
/** A light at graph position `head` seen from a cell at distance `d`. */
const lightAt = (
  d: number,
  head: number,
  lead = LEAD_SIGMA,
  tail = TAIL_SIGMA,
) => {
  const delta = d - head;
  return gauss(delta, delta > 0 ? lead : tail);
};

type Wander = { at: number; next: number; from: number; f: number };

export function FilamentMark({
  seed,
  size = 20,
  mode = "current",
  motion = "traverse",
  bloom = true,
  fit = "quiet",
  className,
}: {
  seed: string;
  size?: number;
  mode?: FilamentMode;
  motion?: FilamentMotion;
  bloom?: boolean;
  fit?: FilamentFit;
  className?: string;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const { isDark } = useTheme();
  const ink = isDark ? INK_DARK : INK_LIGHT;
  const glyph = React.useMemo(() => identityGlyph(seed), [seed]);
  const graph = React.useMemo(() => buildGraph(glyph), [glyph]);
  const levelRef = React.useRef(mode === "current" ? BASE : 1);
  const wanderRef = React.useRef<Wander | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const { extent } =
      fit === "box"
        ? boxMetrics(glyph, size, dpr)
        : glyphMetrics(glyph, { size, dpr });
    canvas.width = extent;
    canvas.height = extent;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Precompute the distance fields each motion needs.
    const startEnd = graph.terminals[0] ?? graph.cells[0];
    const farEnd = farthest(graph, startEnd);
    const dEnd = graph.distFrom(startEnd);
    const dFar = graph.distFrom(farEnd);
    const length = maxOf(dEnd);
    const heart = heartOf(graph);
    const dHeart = graph.distFrom(heart);
    const reach = maxOf(dHeart);

    let raf = 0;
    const start = performance.now();
    let last = start;
    const targetLevel =
      mode === "current"
        ? BASE
        : mode === "lit"
          ? 1
          : mode === "speaking"
            ? 0.86
            : 0.92;
    const running = mode === "current" || mode === "speaking";
    // Speaking keeps a faint current under a mostly-lit glyph.
    const amplitude = mode === "speaking" ? 0.16 : 1;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      levelRef.current += (targetLevel - levelRef.current) * 0.08;
      const level = levelRef.current;
      const t = (now - start) / 1000;

      let alphaFor: (k: number) => number = () => level;
      if (running) {
        const mix = (light: number) =>
          level + (1 - level) * Math.min(1, light) * amplitude;
        switch (motion) {
          case "traverse": {
            const period = 2.6;
            const u = (t % period) / period;
            const head = -3 + easeInOut(u) * (length + 6);
            alphaFor = (k) => mix(lightAt(dEnd.get(k) ?? 0, head));
            break;
          }
          case "shuttle": {
            const period = 4.2;
            const u = (t % period) / period;
            // Out along the stroke, then back; ease each leg; pause at ends.
            const leg =
              u < 0.5 ? easeInOut(u * 2) : 1 - easeInOut((u - 0.5) * 2);
            const head = -1 + leg * (length + 2);
            const forward = u < 0.5;
            alphaFor = (k) => {
              const d = dEnd.get(k) ?? 0;
              const delta = d - head;
              const ahead = forward ? delta > 0 : delta < 0;
              return mix(gauss(delta, ahead ? LEAD_SIGMA : TAIL_SIGMA));
            };
            break;
          }
          case "heart": {
            const period = 4.0;
            const u = (t % period) / period;
            // Inhale: light spreads from the heart to every terminal; exhale:
            // it recedes. Symmetric, no direction, no ends.
            const radius =
              u < 0.5 ? easeInOut(u * 2) : 1 - easeInOut((u - 0.5) * 2);
            const front = -1.5 + radius * (reach + 3);
            alphaFor = (k) => {
              const d = dHeart.get(k) ?? 0;
              // Everything inside the front is lit, softly falling off beyond it.
              const inside = d <= front ? 1 : gauss(d - front, 0.9);
              const core = 0.55 + 0.45 * inside;
              return mix(inside * core);
            };
            break;
          }
          case "converge": {
            const period = 3.4;
            const u = (t % period) / period;
            // Two lights enter from both ends and meet at the middle, then the
            // meeting dissolves and the glyph rests before the next pass.
            const p = Math.min(1, u / 0.7);
            const head = -3 + easeInOut(p) * (length / 2 + 3);
            const fade = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
            alphaFor = (k) => {
              const a = lightAt(dEnd.get(k) ?? 0, head);
              const b = lightAt(dFar.get(k) ?? 0, head);
              return mix(Math.min(1, (a + b) * fade));
            };
            break;
          }
          case "tide": {
            const period = 5.2;
            const u = (t % period) / period;
            // No point of light: a long soft crest rolls along the wire so the
            // mark swells section by section.
            const head = -4 + u * (length + 8);
            alphaFor = (k) => mix(gauss((dEnd.get(k) ?? 0) - head, 2.6));
            break;
          }
          case "wander": {
            // A slow random walk on the stroke, choosing branches, never
            // repeating. Speed in cells per second.
            const speed = 2.2;
            let w = wanderRef.current;
            if (!w) {
              const at = heart;
              const opts = graph.neighbours.get(at) ?? [at];
              w = { at, next: opts[0] ?? at, from: -1, f: 0 };
            }
            w.f += dt * speed;
            while (w.f >= 1) {
              w.f -= 1;
              const from = w.at;
              w.at = w.next;
              const opts = (graph.neighbours.get(w.at) ?? []).filter(
                (m) => m !== from,
              );
              const pool = opts.length
                ? opts
                : (graph.neighbours.get(w.at) ?? [w.at]);
              w.next = pool[Math.floor(Math.random() * pool.length)] ?? w.at;
              w.from = from;
            }
            wanderRef.current = w;
            const dA = graph.distFrom(w.at);
            const dB = graph.distFrom(w.next);
            const f = w.f;
            alphaFor = (k) => {
              const d = Math.min(
                (dA.get(k) ?? 9) + f,
                (dB.get(k) ?? 9) + (1 - f),
              );
              return mix(gauss(d, 1.1));
            };
            break;
          }
          case "murmur": {
            // Three faint currents at different phases and speeds, passing
            // each other. Each is dimmer than a single light; together they
            // read as the wire quietly alive.
            const heads = [
              { period: 3.1, phase: 0.0, dir: 1 },
              { period: 4.3, phase: 0.37, dir: -1 },
              { period: 5.0, phase: 0.71, dir: 1 },
            ].map(({ period, phase, dir }) => {
              const u = (((t / period + phase) % 1) + 1) % 1;
              const pos = -2 + u * (length + 4);
              return dir > 0 ? pos : length - pos;
            });
            alphaFor = (k) => {
              const d = dEnd.get(k) ?? 0;
              let sum = 0;
              for (const h of heads) sum += gauss(d - h, 1.0) * 0.55;
              return mix(Math.min(1, sum));
            };
            break;
          }
        }
      }
      paint(ctx, glyph, size, dpr, ink, alphaFor, bloom, fit);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [bloom, fit, glyph, graph, ink, mode, motion, size]);

  return (
    <canvas
      aria-hidden
      className={className}
      data-seed={seed}
      ref={canvasRef}
      style={{ display: "block", width: size, height: size }}
    />
  );
}
