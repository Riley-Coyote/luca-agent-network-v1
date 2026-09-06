import { seeded } from "./glyph";

/**
 * A resident's rune: one self-avoiding stroke across a 5x5 lattice, diagonals
 * allowed, no hairpins, sometimes with a detached dot, occasionally mirrored
 * into a heraldic pair. Deterministic per seed, like the lattice glyph.
 *
 * Measured over 4,000 keys (design-lab/identity-marks.html): 98.1% distinct.
 * Mirroring is rationed to 12% because a mirrored stroke becomes a little
 * house, and houses look alike. Design decision 2026-08-31: this is the agent
 * mark. It is behind a lab switch until the port is complete.
 */

export type RunePoint = readonly [number, number];

export interface IdentityRune {
  /** The stroke, in a `0 0 100 100` box. */
  readonly points: readonly RunePoint[];
  /** A detached dot, or null. */
  readonly dot: RunePoint | null;
  /** Drawn twice, the second reflected about the vertical centre. */
  readonly mirror: boolean;
}

export interface RuneOptions {
  lenMin?: number;
  lenMax?: number;
  dotP?: number;
  mirrorP?: number;
}

const LATTICE = 5;
const PAD = 14;
const MOVES: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const cache = new Map<string, IdentityRune>();

export function identityRune(
  seed: string,
  options: RuneOptions = {},
): IdentityRune {
  const key = `${seed}|${options.lenMin ?? 4}|${options.lenMax ?? 7}|${options.dotP ?? 0.4}|${options.mirrorP ?? 0.12}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const lenMin = options.lenMin ?? 4;
  const lenMax = options.lenMax ?? 7;
  const dotP = options.dotP ?? 0.4;
  const mirrorP = options.mirrorP ?? 0.12;
  const rnd = seeded(`rune:${seed}`);
  const mirror = rnd() < mirrorP;

  let walk: Array<[number, number]> | null = null;
  for (let attempt = 0; attempt < 600 && !walk; attempt++) {
    const w: Array<[number, number]> = [
      [Math.floor(rnd() * LATTICE), Math.floor(rnd() * LATTICE)],
    ];
    const used = new Set<string>([`${w[0][0]},${w[0][1]}`]);
    const len = lenMin + Math.floor(rnd() * (lenMax - lenMin + 1));
    let ok = true;
    let last: readonly [number, number] | null = null;
    for (let i = 0; i < len; i++) {
      const [x, y] = w[w.length - 1];
      const candidates: Array<readonly [number, number]> = [];
      for (const [dx, dy] of MOVES) {
        if (last && dx === -last[0] && dy === -last[1]) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= LATTICE || ny >= LATTICE) continue;
        if (used.has(`${nx},${ny}`)) continue;
        candidates.push([dx, dy]);
      }
      if (!candidates.length) {
        ok = false;
        break;
      }
      const move = candidates[Math.floor(rnd() * candidates.length)];
      last = move;
      const next: [number, number] = [x + move[0], y + move[1]];
      used.add(`${next[0]},${next[1]}`);
      w.push(next);
    }
    if (!ok) continue;
    const xs = w.map((p) => p[0]);
    const ys = w.map((p) => p[1]);
    if (
      Math.max(...xs) - Math.min(...xs) < 2 ||
      Math.max(...ys) - Math.min(...ys) < 2
    )
      continue;
    walk = w;
  }
  const stroke = walk ?? [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
  ];

  let dot: [number, number] | null = null;
  if (rnd() < dotP) {
    const occupied = new Set(stroke.map(([x, y]) => `${x},${y}`));
    const free: Array<[number, number]> = [];
    for (let y = 0; y < LATTICE; y++) {
      for (let x = 0; x < LATTICE; x++) {
        let clear = true;
        for (let dy = -1; dy <= 1 && clear; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (occupied.has(`${x + dx},${y + dy}`)) {
              clear = false;
              break;
            }
          }
        }
        if (clear) free.push([x, y]);
      }
    }
    if (free.length) dot = free[Math.floor(rnd() * free.length)];
  }

  const all = dot ? [...stroke, dot] : stroke;
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // A walk that spans fewer than four cells is scaled up so its larger span
  // fills the box: a column of residents then scans at one optical weight,
  // and marks differ by shape rather than by size (look-alike pairs drop
  // four-fold; distinctness is unchanged — scale never carried identity).
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const grow = span < LATTICE - 1 ? (LATTICE - 1) / span : 1;
  const cell = ((100 - PAD * 2) / (LATTICE - 1)) * grow;
  const ox = ((LATTICE - 1) / grow - (maxX - minX)) / 2 - minX;
  const oy = ((LATTICE - 1) / grow - (maxY - minY)) / 2 - minY;
  const map = ([x, y]: readonly [number, number]): RunePoint => [
    PAD + (x + ox) * cell,
    PAD + (y + oy) * cell,
  ];

  const rune: IdentityRune = {
    points: stroke.map(map),
    dot: dot ? map(dot) : null,
    mirror,
  };
  if (cache.size >= 4096) cache.clear();
  cache.set(key, rune);
  return rune;
}

/** The stroke as an SVG path `d` for a `0 0 100 100` viewBox. */
export function runePathD(points: readonly RunePoint[]): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("");
}

export function mirrorRunePoints(points: readonly RunePoint[]): RunePoint[] {
  return points.map(([x, y]) => [100 - x, y]);
}

/** Stroke width in the 100-unit box. Lighter than the lab's 13: the row is where the mark lives. */
export const RUNE_WEIGHT = 11;

const LAB_MARKS_KEY = "luca.lab.marks";

export type LabMarksMode = "lattice" | "polished" | "rune";

/**
 * Design-lab switch: `?marks=polished` or `?marks=rune` on the shell lab.
 * "lattice" (the shipped pixel-font rendering) everywhere else.
 */
export function labMarksMode(): LabMarksMode {
  try {
    const value = globalThis.localStorage?.getItem(LAB_MARKS_KEY);
    return value === "rune" || value === "polished" ? value : "lattice";
  } catch {
    return "lattice";
  }
}

export function runeMarksEnabled(): boolean {
  return labMarksMode() === "rune";
}

export function setRuneMarksEnabled(enabled: boolean): void {
  try {
    if (enabled) globalThis.localStorage?.setItem(LAB_MARKS_KEY, "rune");
    else globalThis.localStorage?.removeItem(LAB_MARKS_KEY);
  } catch {
    // device-local; best effort
  }
}
