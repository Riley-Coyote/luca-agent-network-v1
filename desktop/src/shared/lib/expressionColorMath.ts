/** Bounded color math for resident-authored text; no input becomes raw CSS. */
export type RGB = readonly [number, number, number];
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const linear = (n: number) =>
  n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
const gamma = (n: number) =>
  clamp(n <= 0.0031308 ? 12.92 * n : 1.055 * n ** (1 / 2.4) - 0.055);

/** Parse a hex or numeric HSL color, rejecting CSS functions and out-of-range values. */
export function parseExpressionColor(value: string): RGB | undefined {
  if (/^#[\da-f]{3}([\da-f]{3})?$/i.test(value)) {
    const hex =
      value.length === 4
        ? value
            .slice(1)
            .split("")
            .map((c) => c + c)
            .join("")
        : value.slice(1);
    return [0, 2, 4].map(
      (i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255,
    ) as unknown as RGB;
  }
  const match =
    /^hsl\((\d+(?:\.\d+)?),(\d+(?:\.\d+)?)%,(\d+(?:\.\d+)?)%\)$/i.exec(value);
  if (!match) return;
  const [h, s, l] = match.slice(1).map(Number);
  if (h > 360 || s > 100 || l > 100) return;
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** Serialize the chosen sRGB color without theme or contrast adjustments. */
export function formatExpressionColor(rgb: RGB): string {
  return `#${rgb
    .map((n) =>
      Math.round(clamp(n) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function toLab(rgb: RGB): RGB {
  const [r, g, b] = rgb.map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromLab([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Perceptual interpolation keeps changes smooth across arbitrary stop counts. */
export function mixExpressionColors(
  stops: readonly RGB[],
  progress: number,
): RGB {
  if (stops.length === 1) return stops[0];
  const position = clamp(progress) * (stops.length - 1);
  if (Number.isInteger(position)) return stops[position];
  const index = Math.min(Math.floor(position), stops.length - 2);
  const a = toLab(stops[index]),
    b = toLab(stops[index + 1]);
  return fromLab(
    a.map((n, i) => n + (b[i] - n) * (position - index)) as unknown as RGB,
  );
}
