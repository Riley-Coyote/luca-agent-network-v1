/**
 * The readouts — four different ways of turning one running sandpile into light.
 *
 * All four go through the engine's existing colour channel: a per-cell scalar in
 * `DotPanel.magnitude` sampled against a 256-entry ramp in `DotPanel.lut`. That
 * channel was built for one purpose ("how much just moved") and turns out to be
 * a fully general field renderer, which is why the lab needs no engine changes.
 *
 * The distinction that matters: `recency` and `flux` are STATES — they decay, so
 * they show what is happening. `odometer` is a RECORD — it only grows, so it
 * shows everything that has ever happened. The odometer is the phosphor doctrine
 * extended from milliseconds to minutes, and it is the field the classic
 * sandpile images live in.
 */

import type { DotPanel } from "../engine";
import { buildLut, MAGNITUDE_LUT_INKFLOOR, type Stop } from "../physics";
import type { PileSim } from "./pile-core";

export type ReadoutKind = "recency" | "odometer" | "flux" | "height";

export const READOUTS: ReadoutKind[] = [
  "recency",
  "odometer",
  "flux",
  "height",
];

/**
 * `../engine.ts` treats a magnitude at or below `MAGNITUDE_EPSILON` (0.02) as
 * "no event here" and paints the cell in plain ink instead of sampling the ramp.
 * That is correct for magnitude, but for an ANGLE zero is a real value — a flux
 * pointing due east would silently lose its colour. Every angular or banded
 * scalar is therefore lifted clear of the epsilon before it is written.
 */
const FLOOR = 0.06;
const lift = (v: number) => FLOOR + (1 - FLOOR) * Math.max(0, Math.min(1, v));

/**
 * A ramp that wraps: the value at 1 is the value at 0.
 *
 * Flux direction is periodic, so sampling it against an ordinary ramp puts a
 * hard seam across the field wherever the angle crosses 2π — a bright line that
 * looks like structure and is entirely an artefact of the colour table.
 */
export function buildCyclicLut(stops: Stop[]): Uint8Array {
  const wrapped: Stop[] = [...stops];
  const first = stops[0];
  if (first[0] !== 0) wrapped.unshift([0, first[1]]);
  wrapped.push([1, wrapped[0][1]]);
  return buildLut(wrapped);
}

/**
 * Cumulative topples. Deep ink at the quiet edges through violet and coral to
 * white where the field has been worked hardest — so the interior reads smooth
 * and the boundary reads fractal, which is the whole character of the thing.
 */
export const LUT_ODOMETER = buildLut([
  [0.0, [92, 104, 132]],
  [0.22, [78, 66, 168]],
  [0.45, [158, 60, 176]],
  [0.65, [226, 74, 122]],
  [0.82, [248, 162, 74]],
  [1.0, [255, 246, 232]],
]);

/**
 * Flow direction, around the wheel once. Held at a muted saturation on purpose:
 * a full-gamut hue wheel on a near-black floor reads as a novelty, and this has
 * to survive being an identity mark.
 */
export const LUT_FLUX = buildCyclicLut([
  [0.0, [104, 148, 208]],
  [0.25, [96, 196, 178]],
  [0.5, [226, 176, 92]],
  [0.75, [206, 106, 168]],
]);

/**
 * The raw 0..threshold-1 state, in flat bands. No interpolation inside a band —
 * this is the hard-edged mandala, and softening the steps destroys it.
 */
export const LUT_HEIGHT = buildLut([
  [0.0, [64, 72, 92]],
  [0.249, [64, 72, 92]],
  [0.25, [72, 96, 168]],
  [0.499, [72, 96, 168]],
  [0.5, [186, 92, 156]],
  [0.749, [186, 92, 156]],
  [0.75, [248, 214, 168]],
  [1.0, [248, 214, 168]],
]);

export function lutFor(kind: ReadoutKind): Uint8Array {
  switch (kind) {
    case "odometer":
      return LUT_ODOMETER;
    case "flux":
      return LUT_FLUX;
    case "height":
      return LUT_HEIGHT;
    default:
      return MAGNITUDE_LUT_INKFLOOR;
  }
}

export interface ReadoutOptions {
  /** Odometer ceiling for the log normalisation. 0 tracks the running max —
   *  think of it as auto-exposure, and of the manual value as locking it. */
  exposure: number;
  gamma: number;
  /** Overall brightness of the field. */
  glow: number;
  /** How strongly the resting slope shows through. This is the paper; the
   *  cascade is the writing. */
  slope: number;
}

export const DEFAULT_READOUT: ReadoutOptions = {
  exposure: 0,
  gamma: 1,
  glow: 1,
  slope: 0.35,
};

/**
 * Paint one field of `sim` into `panel`.
 *
 * Indexed by (x, y) rather than by flat offset on purpose: the panel and the sim
 * are separately sized, and on a fractional device-pixel ratio the engine's
 * `floor(canvasPx / cellPx)` can land a cell short. Sharing a flat index across
 * two different widths does not fail loudly — it shears the picture by one cell
 * per row, which looks like a diagonal artefact in the physics. Cells outside
 * the sim are left dark.
 */
export function applyReadout(
  sim: PileSim,
  panel: DotPanel,
  kind: ReadoutKind,
  opt: ReadoutOptions,
): void {
  const buf = panel.buf;
  const mag = panel.magnitude;
  const glow = opt.glow;
  const threshold = Math.max(2, sim.cfg.threshold);
  const pw = panel.W;
  const sw = sim.W;
  const cols = Math.min(pw, sw);
  const rows = Math.min(panel.H, sim.H);
  const height = sim.height;

  // Only clear when the panel is bigger than the sim — otherwise every cell is
  // written below anyway, and the fills are two wasted full-array walks.
  if (pw > sw || panel.H > sim.H) {
    buf.fill(0);
    mag?.fill(0);
  }

  // The resting slope saturates at h=3, so there are only four possible values.
  // A four-entry table removes a multiply and a Math.min from the inner loop.
  const g = 0.034 * opt.slope * 3;
  const b = 0.028 * opt.slope * 3;
  const REST = [0, b + g, b + g * 2, b + g * 3];

  // One specialised loop per field rather than a switch inside the inner loop:
  // this runs up to five times per frame over the whole lattice, and the branch
  // is constant for the entire call.
  if (kind === "height") {
    const inv = 1 / (threshold - 1);
    for (let y = 0; y < rows; y++) {
      const pr = y * pw;
      const sr = y * sw;
      for (let x = 0; x < cols; x++) {
        const h = height[sr + x];
        const p = pr + x;
        if (h <= 0) {
          buf[p] = 0;
          if (mag) mag[p] = 0;
          continue;
        }
        const v = h * inv < 1 ? h * inv : 1;
        buf[p] = Math.min(1, (0.3 + 0.7 * v) * glow);
        if (mag) mag[p] = lift(v);
      }
    }
    return;
  }

  if (kind === "flux") {
    const fxs = sim.fluxX;
    const fys = sim.fluxY;
    const TAU = Math.PI * 2;
    for (let y = 0; y < rows; y++) {
      const pr = y * pw;
      const sr = y * sw;
      for (let x = 0; x < cols; x++) {
        const s = sr + x;
        const p = pr + x;
        const h = height[s];
        const rest = h > 0 ? REST[h < 3 ? h : 3] : 0;
        const fx = fxs[s];
        const fy = fys[s];
        const m2 = fx * fx + fy * fy;
        if (m2 < 0.0004) {
          buf[p] = rest;
          if (mag) mag[p] = 0;
          continue;
        }
        // atan2 lands in (-PI, PI]; fold to [0,1) before the cyclic ramp.
        let a = Math.atan2(fy, fx) / TAU;
        if (a < 0) a += 1;
        const bright = Math.min(1, Math.sqrt(Math.sqrt(m2)) * 0.55) * glow;
        buf[p] = bright > rest ? bright : rest;
        if (mag) mag[p] = lift(a);
      }
    }
    return;
  }

  if (kind === "odometer") {
    const odo = sim.odometer;
    const ceiling = opt.exposure > 0 ? opt.exposure : Math.max(1, sim.odoMax);
    const inv = 1 / (Math.log(1 + ceiling) || 1);
    const gamma = opt.gamma;
    const plain = gamma === 1;
    for (let y = 0; y < rows; y++) {
      const pr = y * pw;
      const sr = y * sw;
      for (let x = 0; x < cols; x++) {
        const s = sr + x;
        const p = pr + x;
        const h = height[s];
        const rest = h > 0 ? REST[h < 3 ? h : 3] : 0;
        const o = odo[s];
        if (o <= 0) {
          buf[p] = rest;
          if (mag) mag[p] = 0;
          continue;
        }
        let v = Math.log(1 + o) * inv;
        if (v > 1) v = 1;
        if (!plain) v = v ** gamma;
        const lit = 0.12 + 0.88 * v;
        buf[p] = Math.min(1, (lit > rest ? lit : rest) * glow);
        if (mag) mag[p] = lift(v);
      }
    }
    return;
  }

  // recency — what production ships. The slope is the paper, the cascade is the
  // writing.
  const recency = sim.recency;
  for (let y = 0; y < rows; y++) {
    const pr = y * pw;
    const sr = y * sw;
    for (let x = 0; x < cols; x++) {
      const s = sr + x;
      const p = pr + x;
      const h = height[s];
      const rest = h > 0 ? REST[h < 3 ? h : 3] : 0;
      const r = recency[s] * 0.9;
      buf[p] = Math.min(1, (r > rest ? r : rest) * glow);
      if (mag) mag[p] = r > 0.004 ? lift(recency[s]) : 0;
    }
  }
}
