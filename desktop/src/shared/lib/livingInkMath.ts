import { fromLab, toLab, type RGB } from "./expressionColorMath";

/** Ghost mobile 691adc32: Living.swift / Living.metal, Oct 27 "Keep drifting".
 * The browser samples the same field into native text fills, not rasterized
 * letters. Its text remains selectable, shaped and zoomed by the browser. */
export const LIVING_INK = Object.freeze({
  alive: 60,
  ease: 8,
  pace: 0.6,
  resting: 0.16,
  rests: 100,
  variance: 1,
  strength: 0.9,
  frameRate: 12,
  restRate: 3,
  turn: 10_000,
});
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mod289 = (x: number) => x - Math.floor(x / 289) * 289;
const permute = (x: number) => mod289((x * 34 + 1) * x);
const fract = (x: number) => x - Math.floor(x);

/** The native shader's 2D simplex noise, including its normalization. */
export function inkNoise(x: number, y: number): number {
  const c = 0.211324865405187,
    d = 0.366025403784439;
  const i = Math.floor(x + (x + y) * d),
    j = Math.floor(y + (x + y) * d);
  const x0 = x - i + (i + j) * c,
    y0 = y - j + (i + j) * c;
  const ix = x0 > y0 ? 1 : 0,
    iy = 1 - ix;
  const xs = [x0, x0 + c - ix, x0 - 0.577350269189626];
  const ys = [y0, y0 + c - iy, y0 - 0.577350269189626];
  let sum = 0;
  for (let k = 0; k < 3; k++) {
    const p = permute(
      permute(mod289(j) + [0, iy, 1][k]) + mod289(i) + [0, ix, 1][k],
    );
    const a = 2 * fract(p * 0.024390243902439) - 1;
    const h = Math.abs(a) - 0.5,
      a0 = a - Math.floor(a + 0.5);
    const m = Math.max(0.5 - xs[k] ** 2 - ys[k] ** 2, 0) ** 4;
    sum +=
      m *
      (1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h)) *
      (a0 * xs[k] + h * ys[k]);
  }
  return 130 * sum;
}
function fbm(x: number, y: number): number {
  let sum = 0,
    a = 0.5;
  for (let i = 0; i < 4; i++) {
    sum += a * inkNoise(x, y);
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 9.3;
    a *= 0.5;
  }
  return sum;
}

/** Native first-96-Unicode-scalar FNV-1a; independent of process and theme. */
export function livingInkSeed(text: string): number {
  let hash = 0xcbf29ce484222325n;
  for (const scalar of Array.from(text).slice(0, 96)) {
    hash ^= BigInt(scalar.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return Number(hash % 10_000n) / 10_000;
}

/** Analytic clock: scrolling away never restarts it or requires catch-up frames. */
export function livingInkPhase(age: number, still = false): number {
  if (still || !Number.isFinite(age)) return 0;
  const t = Math.max(0, age),
    after = Math.max(0, t - LIVING_INK.alive);
  const drifted =
    LIVING_INK.pace *
    (Math.min(t, LIVING_INK.alive) +
      LIVING_INK.resting * after +
      (1 - LIVING_INK.resting) *
        LIVING_INK.ease *
        (1 - Math.exp(-after / LIVING_INK.ease)));
  return (
    LIVING_INK.turn -
    Math.abs(LIVING_INK.turn - (drifted % (2 * LIVING_INK.turn)))
  );
}
export function livingInkRate(age: number): number {
  return age < LIVING_INK.rests ? LIVING_INK.frameRate : LIVING_INK.restRate;
}

/** Native damped press: displacement in em, not a change to text layout. */
export function livingInkPress(t: number): number {
  if (t <= 0 || t >= 0.9) return 0;
  const w = 2 * Math.PI * 2.6;
  return (
    0.11 * Math.exp(-0.38 * w * t) * Math.sin(w * Math.sqrt(1 - 0.38 ** 2) * t)
  );
}
export function livingInkGive(t: number): number {
  if (t <= 0 || t >= 0.9) return 0;
  const w = 2 * Math.PI * 2.6;
  return (
    0.07 * Math.exp(-0.45 * w * t) * Math.sin(w * Math.sqrt(1 - 0.45 ** 2) * t)
  );
}
export function livingInkTake(t: number): number {
  if (t <= 0 || t >= 0.9) return 0;
  return 0.4 * (1 - Math.exp(-t / 0.025)) * Math.exp(-t / 0.2);
}

const linear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

/** The native wet film's pale interference colour (its light band is CSS). */
export function livingInkSheen(
  x: number,
  y: number,
  phase: number,
  seed: number,
): RGB {
  const lit = phase + seed * 40;
  const th = 0.5 + 0.5 * fbm(x * 0.3 + lit * 0.04, y * 0.3 - lit * 0.03);
  return [0, 0.33, 0.67].map((offset) =>
    mix(1, 0.5 + 0.5 * Math.cos(6.28318 * (th * 0.8 + offset)), 0.5),
  ) as unknown as RGB;
}
export const inkLuminance = (rgb: RGB) =>
  rgb.map(linear).reduce((v, c, i) => v + c * [0.2126, 0.7152, 0.0722][i], 0);
export function inkContrast(rgb: RGB, ground: RGB, opacity = 1): number {
  const a = inkLuminance(
    rgb.map((c, i) => mix(ground[i], c, opacity)) as unknown as RGB,
  );
  const b = inkLuminance(ground);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Native gamut mapping: sacrifice chroma, never hue or lightness. */
function toScreen(lab: RGB): RGB {
  const linearLab = ([L, a, b]: RGB): RGB => {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  };
  const inGamut = (rgb: RGB) => rgb.every((c) => c >= -0.0005 && c <= 1.0005);
  if (inGamut(linearLab(lab))) return fromLab(lab);
  let lo = 0,
    hi = 1;
  for (let k = 0; k < 10; k++) {
    const mid = (lo + hi) / 2;
    if (inGamut(linearLab([lab[0], lab[1] * mid, lab[2] * mid]))) lo = mid;
    else hi = mid;
  }
  return fromLab([lab[0], lab[1] * lo, lab[2] * lo]);
}

/** Keep the hue, lifting on dark / lowering on light only as far as reading needs. */
export function legibleInk(lab: RGB, ground: RGB, opacity = 1): RGB {
  const original = toScreen(lab);
  if (inkContrast(original, ground, opacity) >= 4.5) return original;
  const low = toScreen([0, lab[1], lab[2]]),
    high = toScreen([1, lab[1], lab[2]]);
  const target =
    inkContrast(low, ground, opacity) > inkContrast(high, ground, opacity)
      ? 0
      : 1;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 16; i++) {
    const t = (lo + hi) / 2;
    if (
      inkContrast(
        toScreen([mix(lab[0], target, t), lab[1], lab[2]]),
        ground,
        opacity,
      ) >= 4.5
    )
      hi = t;
    else lo = t;
  }
  return toScreen([mix(lab[0], target, hi), lab[1], lab[2]]);
}

/** Native pigment and bleeding fronts. Inputs are normalized paint, never CSS. */
export function livingInkColor(
  stops: readonly RGB[],
  x: number,
  y: number,
  phase: number,
  seed: number,
  through: number,
  ground: RGB,
  hush = false,
  wet = false,
  fill = 1,
): RGB {
  let lab = toLab(stops[0]);
  if (stops.length > 1) {
    const t = clamp(
      through +
        0.24 *
          fbm(
            x * 0.42 + seed * 7.1 + seed * 40 * 0.035,
            y * 0.42 + seed * 40 * 0.035,
          ),
    );
    const at = t * (stops.length - 1),
      i = Math.min(Math.floor(at), stops.length - 2),
      f = at - i;
    const a = toLab(stops[i]),
      b = toLab(stops[i + 1]);
    const rim = 1 + 0.2 * Math.exp(-(((f - 0.5) / 0.05) ** 2));
    lab = [
      mix(a[0], b[0], smooth(0.32, 0.68, f)),
      mix(a[1], b[1], smooth(0.32, 0.68, f)) * rim,
      mix(a[2], b[2], smooth(0.32, 0.68, f)) * rim,
    ];
  }
  // The paint follows arriving words, then remains their chosen family of tones.
  lab = [mix(0.68, lab[0], fill), lab[1] * fill, mix(0.003, lab[2], fill)];
  if (wet) lab = lab.map((v) => v * 0.86) as unknown as RGB;
  const chroma = Math.hypot(lab[1], lab[2]),
    painted = smooth(0.03, 0.07, chroma);
  if (painted > 0) {
    const wx = x * 0.36 + seed * 3.3,
      wy = y * 0.36 + seed * 1.9;
    const warpX = fbm(wx + phase * 0.031, wy + phase * 0.031);
    const warpY = fbm(wx + 5.2 - phase * 0.026, wy + 1.3 - phase * 0.026);
    const d = clamp(
      fbm(wx + 0.9 * warpX + phase * 0.02, wy + 0.9 * warpY + phase * 0.02) *
        1.35 +
        0.16 * fbm(x * 2.7 + phase * 0.055, y * 2.7 + phase * 0.055),
      -1,
      1,
    );
    const h = Math.atan2(lab[2], lab[1]),
      target = h >= -0.35 && h <= 2.62 ? 0.506 : -1.676;
    const toward = clamp(
      Math.atan2(Math.sin(target - h), Math.cos(target - h)),
      -0.7,
      0.7,
    );
    const thick = Math.max(0, -d),
      thin = Math.max(0, d);
    const hue = h + toward * (0.45 * thick - 0.24 * thin);
    const c =
      chroma * LIVING_INK.strength * (1 + 0.08 * thick) * (1 - 0.3 * thin);
    const l = lab[0] - 0.1 * thick + 0.08 * thin;
    lab = [
      mix(lab[0], l, painted),
      mix(lab[1], c * Math.cos(hue), painted),
      mix(lab[2], c * Math.sin(hue), painted),
    ];
  }
  return legibleInk(lab, ground, hush ? 0.6 : 1);
}
