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

/**
 * Whose tree: FNV-1a of the resident's glyph seed, so Luca's comes from
 * Luca's fixed seed (the same for every owner) and every other agent's from
 * its key. A model or runtime change never touches it.
 */
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

export type Dendrite = {
  /** Each particle's place in the unit disc; the seed's is the first, at the centre. */
  px: Float64Array;
  py: Float64Array;
  /** The particle each one stuck to (-1 for the seed). */
  parent: Int32Array;
  /** How many steps from the seed along the tree. */
  depth: Int32Array;
  /** How many particles hang from each one, itself included. */
  sub: Int32Array;
  count: number;
  maxDepth: number;
};

/**
 * An agent's dendrite: particles wander in from far away and stick where they
 * first touch the growing tree (diffusion-limited aggregation, off any grid,
 * inside the unit disc). Grown once from the seed; the same seed always grows
 * the same tree. This is the design lab's grower, number for number, so the
 * app's trees are the ones the study showed (shell-lab-rail,
 * design-lab/agent-marks/family).
 */
export function growDendrite(
  seed: number,
  radius = 0.03,
  target = 300,
): Dendrite {
  const rand = seededRandom((seed ^ 0x9e3779b9) >>> 0);
  const reach = 2 * radius;
  const px = [0];
  const py = [0];
  const parent = [-1];
  const depth = [0];
  const grid = new Map<number, number[]>();
  const keyOf = (x: number, y: number) =>
    Math.floor((x + 1.3) / reach) * 1000 + Math.floor((y + 1.3) / reach);
  const add = (x: number, y: number) => {
    const key = keyOf(x, y);
    const cell = grid.get(key);
    if (cell) cell.push(px.length - 1);
    else grid.set(key, [px.length - 1]);
  };
  add(0, 0);
  const near = (x: number, y: number) => {
    const gx = Math.floor((x + 1.3) / reach);
    const gy = Math.floor((y + 1.3) / reach);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const cell = grid.get((gx + a) * 1000 + gy + b);
        if (!cell) continue;
        for (const q of cell) {
          if ((px[q] - x) ** 2 + (py[q] - y) ** 2 < reach * reach) return q;
        }
      }
    }
    return -1;
  };
  let rmax = 0;
  let guard = 0;
  while (px.length < target && rmax < 0.86 && guard++ < 20000) {
    const start = rmax + 5 * radius;
    const a0 = rand() * Math.PI * 2;
    let x = start * Math.cos(a0);
    let y = start * Math.sin(a0);
    for (let s = 0; s < 40000; s++) {
      const rw = Math.hypot(x, y);
      if (rw > start + 0.5) break;
      // Far from the tree a walk can jump: where it first meets a circle round
      // it is uniform, so it lands there in one step.
      if (rw > rmax + 4 * radius) {
        const jump = rw - rmax - 2 * radius;
        const b = rand() * Math.PI * 2;
        x += jump * Math.cos(b);
        y += jump * Math.sin(b);
        continue;
      }
      const b = rand() * Math.PI * 2;
      const nx = x + 0.55 * radius * Math.cos(b);
      const ny = y + 0.55 * radius * Math.sin(b);
      const hit = near(nx, ny);
      if (hit >= 0) {
        const dx = x - px[hit];
        const dy = y - py[hit];
        const dl = Math.hypot(dx, dy) || 1;
        const qx = px[hit] + (dx / dl) * reach;
        const qy = py[hit] + (dy / dl) * reach;
        if (Math.hypot(qx, qy) > 0.9) break;
        px.push(qx);
        py.push(qy);
        parent.push(hit);
        depth.push(depth[hit] + 1);
        add(qx, qy);
        rmax = Math.max(rmax, Math.hypot(qx, qy));
        break;
      }
      x = nx;
      y = ny;
    }
  }
  const count = px.length;
  const sub = new Int32Array(count).fill(1);
  for (let i = count - 1; i > 0; i--) sub[parent[i]] += sub[i];
  let maxDepth = 0;
  for (const d of depth) maxDepth = Math.max(maxDepth, d);
  return {
    px: Float64Array.from(px),
    py: Float64Array.from(py),
    parent: Int32Array.from(parent),
    depth: Int32Array.from(depth),
    sub,
    count,
    maxDepth,
  };
}
