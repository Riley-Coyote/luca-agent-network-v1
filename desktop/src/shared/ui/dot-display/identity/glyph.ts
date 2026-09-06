/**
 * A resident's identity glyph.
 *
 * Pure and deterministic: the same public key yields the same mark forever,
 * which is the whole point of an identity mark. No canvas, no DOM — so the
 * generator is testable, and the same function can render a mark to SVG, to a
 * notification icon, or to a test fixture.
 *
 * ## What was wrong with the mirrored-noise generator
 *
 * The previous `sigilPattern` drew independent random bits into a 7x4 half and
 * mirrored it at ~50% density. That is an identicon: bilaterally symmetric
 * *noise*. It has no connected form, so at avatar scale the isolated cells read
 * as grit, and every resident ends up looking like the same Rorschach blot. You
 * cannot describe one of them in words, which is the test a real mark has to
 * pass.
 *
 * ## The shape of the fix: constraints, not construction
 *
 * Two constructive generators were built and rejected before this one. Growing
 * a figure cell by cell builds *trees*, and trees are spiky — every branch ends
 * in a one-cell stub, so the population came out looking like insects.
 * Assembling a figure from straight strokes fixed the spikes and looked
 * genuinely good, but could only ever reach about three thousand distinct
 * marks: at twenty-three cells only two or three strokes fit, and that is a
 * small combinatorial space. Both had the same disease — a dial that traded
 * elegance against distinctness, with no setting that gave both.
 *
 * So nothing is constructed. A mark is a uniformly random symmetric bitfield
 * that survives five predicates, and the predicates *are* the design rules:
 *
 * 1. **Ink band, 17-23 cells (35-47%).** No resident reads heavier or lighter
 *    than another.
 * 2. **Touches all four rims.** The mark fills its box, so a column of avatars
 *    scans at one optical size.
 * 3. **No solid 2x2.** Stroke width stays one cell, so the figure is drawn in
 *    lines rather than in blobs. This is most of what makes the output read as
 *    calligraphy instead of as texture.
 * 4. **At most four loose ends.** A cell with exactly one lit neighbour is a
 *    terminal; a figure with many of them reads as a wiggling maze rather than
 *    as a composed mark. This is the one purely aesthetic predicate, and it is
 *    the difference between "connected" and "designed".
 * 5. **One 4-connected piece.** Checked last, because the flood fill is the
 *    expensive test and the four cheap ones above reject most candidates first.
 *
 * Rejection sampling covers the surviving set close to uniformly, which is why
 * this reaches ~98% distinct marks over thousands of keys where the
 * constructive generators managed 27-34%.
 *
 * ## Cost
 *
 * Acceptance is rare by design: roughly one draw in 2,400 for `rot2` and one in
 * 19,500 for `mirror`, which measures at ~3.7ms per mark on average and ~36ms
 * for the worst key seen over thousands. Marks are memoised per seed, so that
 * is a one-time cost the first time a resident appears. Nothing here allocates
 * per draw.
 *
 * ## The symmetry group that is missing
 *
 * Marks are `mirror` (bilateral, heraldic) or `rot2` (2-fold rotational,
 * dynamic), chosen per key so both species appear equally. Four-fold rotation
 * is the prettiest of the three and is deliberately absent: on a 7x7 lattice,
 * under these constraints, it admits **46 distinct marks in the entire
 * universe** — verified by exhaustive enumeration over all 2^13 orbit
 * assignments. That is a clip-art set, not an identity space, and one resident
 * in three would have drawn from it. Four-fold becomes viable at 9x9 (~4k
 * marks), which would cost the 20-28px legibility this system exists to
 * protect. If the lattice ever moves to 9x9, four-fold should come back.
 */

/** Lattice edge, in cells. Odd so the mark has a true centre. */
export const GLYPH_N = 7;

const AREA = GLYPH_N * GLYPH_N;

/** Ink band: 35%-47% of the lattice. */
const MIN_LIT = 17;
const MAX_LIT = 23;

/** A cell with exactly one lit neighbour. More than this reads as a maze. */
const MAX_LOOSE_ENDS = 4;

/**
 * Per-orbit lighting probability, drawn per candidate. Centred so the expected
 * cell count lands inside the ink band; the exact range barely matters
 * (0.34-0.44 and 0.42-0.52 measure within 0.5% of each other on both
 * distinctness and cost).
 */
const P_MIN = 0.38;
const P_SPAN = 0.1;

/**
 * Draw budget before the aesthetic predicate is dropped. Sized well above the
 * worst key observed over many thousands (~103,000 draws, all `mirror`).
 */
const DRAW_CAP = 150_000;
const RELAXED_CAP = 40_000;

export type GlyphSymmetry = "mirror" | "rot2";

export interface IdentityGlyph {
  /** Row-major lattice, 1 = lit. Length `GLYPH_N * GLYPH_N`. */
  readonly cells: Uint8Array;
  readonly edge: number;
  readonly symmetry: GlyphSymmetry;
  readonly lit: number;
}

const inBounds = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < GLYPH_N && y < GLYPH_N;

/**
 * Cell groups that a symmetry maps onto each other. Lighting an orbit lights
 * every cell in it, so a candidate is symmetric by construction and the draw
 * only ever decides whole orbits.
 */
function orbitsFor(symmetry: GlyphSymmetry): Int32Array[] {
  const partner = (x: number, y: number): [number, number] =>
    symmetry === "mirror"
      ? [GLYPH_N - 1 - x, y]
      : [GLYPH_N - 1 - x, GLYPH_N - 1 - y];
  const claimed = new Uint8Array(AREA);
  const out: Int32Array[] = [];
  for (let y = 0; y < GLYPH_N; y++) {
    for (let x = 0; x < GLYPH_N; x++) {
      const here = y * GLYPH_N + x;
      if (claimed[here]) continue;
      const [px, py] = partner(x, y);
      const there = py * GLYPH_N + px;
      claimed[here] = 1;
      claimed[there] = 1;
      out.push(
        here === there ? Int32Array.of(here) : Int32Array.of(here, there),
      );
    }
  }
  return out;
}

const ORBITS: Record<GlyphSymmetry, Int32Array[]> = {
  mirror: orbitsFor("mirror"),
  rot2: orbitsFor("rot2"),
};

/** xmur3 + a small xorshift. Stable across engines; no Math.random anywhere. */
export function seeded(input: string): () => number {
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

// Scratch buffers, reused across every draw of every glyph. The sampler runs
// tens of thousands of iterations per mark; allocating in that loop would
// dominate its cost.
const scratch = new Uint8Array(AREA);
const visited = new Uint8Array(AREA);
const frontier = new Int32Array(AREA);

function rimsCovered(cells: Uint8Array): boolean {
  let top = 0;
  let bottom = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < GLYPH_N; i++) {
    top |= cells[i];
    bottom |= cells[(GLYPH_N - 1) * GLYPH_N + i];
    left |= cells[i * GLYPH_N];
    right |= cells[i * GLYPH_N + GLYPH_N - 1];
  }
  return Boolean(top && bottom && left && right);
}

function noSolidQuad(cells: Uint8Array): boolean {
  for (let y = 0; y < GLYPH_N - 1; y++) {
    const row = y * GLYPH_N;
    for (let x = 0; x < GLYPH_N - 1; x++) {
      if (
        cells[row + x] &&
        cells[row + x + 1] &&
        cells[row + GLYPH_N + x] &&
        cells[row + GLYPH_N + x + 1]
      ) {
        return false;
      }
    }
  }
  return true;
}

/** Cells with exactly one lit neighbour. Stops counting once over the limit. */
export function looseEndCount(
  cells: Uint8Array,
  stopAt = Number.MAX_SAFE_INTEGER,
): number {
  let ends = 0;
  for (let y = 0; y < GLYPH_N; y++) {
    for (let x = 0; x < GLYPH_N; x++) {
      const i = y * GLYPH_N + x;
      if (!cells[i]) continue;
      let degree = 0;
      if (x > 0 && cells[i - 1]) degree++;
      if (x < GLYPH_N - 1 && cells[i + 1]) degree++;
      if (y > 0 && cells[i - GLYPH_N]) degree++;
      if (y < GLYPH_N - 1 && cells[i + GLYPH_N]) degree++;
      if (degree === 1) {
        ends++;
        if (ends > stopAt) return ends;
      }
    }
  }
  return ends;
}

function isOnePiece(cells: Uint8Array, lit: number): boolean {
  let start = -1;
  for (let i = 0; i < AREA; i++) {
    if (cells[i]) {
      start = i;
      break;
    }
  }
  if (start < 0) return false;
  visited.fill(0);
  let top = 0;
  frontier[top++] = start;
  visited[start] = 1;
  let reached = 0;
  while (top) {
    const k = frontier[--top];
    reached++;
    const x = k % GLYPH_N;
    const y = (k / GLYPH_N) | 0;
    if (x > 0 && cells[k - 1] && !visited[k - 1]) {
      visited[k - 1] = 1;
      frontier[top++] = k - 1;
    }
    if (x < GLYPH_N - 1 && cells[k + 1] && !visited[k + 1]) {
      visited[k + 1] = 1;
      frontier[top++] = k + 1;
    }
    if (y > 0 && cells[k - GLYPH_N] && !visited[k - GLYPH_N]) {
      visited[k - GLYPH_N] = 1;
      frontier[top++] = k - GLYPH_N;
    }
    if (y < GLYPH_N - 1 && cells[k + GLYPH_N] && !visited[k + GLYPH_N]) {
      visited[k + GLYPH_N] = 1;
      frontier[top++] = k + GLYPH_N;
    }
  }
  return reached === lit;
}

/** Number of 4-connected components. For tests; the sampler uses `isOnePiece`. */
export function componentCount(cells: Uint8Array): number {
  const seen = new Uint8Array(AREA);
  let pieces = 0;
  for (let i = 0; i < AREA; i++) {
    if (!cells[i] || seen[i]) continue;
    pieces++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const k = stack.pop() as number;
      const x = k % GLYPH_N;
      const y = (k / GLYPH_N) | 0;
      const neighbours = [
        x > 0 ? k - 1 : -1,
        x < GLYPH_N - 1 ? k + 1 : -1,
        y > 0 ? k - GLYPH_N : -1,
        y < GLYPH_N - 1 ? k + GLYPH_N : -1,
      ];
      for (const j of neighbours) {
        if (j >= 0 && cells[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return pieces;
}

export function hasSolidQuad(cells: Uint8Array): boolean {
  return !noSolidQuad(cells);
}

export function touchesEveryRim(cells: Uint8Array): boolean {
  return rimsCovered(cells);
}

/**
 * Every rule a shipped mark satisfies. Exported so the tests assert the same
 * predicate the sampler enforces, rather than a restatement of it that could
 * drift.
 */
export function isWellFormed(glyph: IdentityGlyph): boolean {
  const { cells, lit } = glyph;
  return (
    lit >= MIN_LIT &&
    lit <= MAX_LIT &&
    rimsCovered(cells) &&
    noSolidQuad(cells) &&
    looseEndCount(cells) <= MAX_LOOSE_ENDS &&
    componentCount(cells) === 1
  );
}

/**
 * One candidate: light each orbit with probability `p`. Returns the cell count
 * so the band check can run before anything more expensive.
 */
function propose(orbits: Int32Array[], p: number, rnd: () => number): number {
  scratch.fill(0);
  let lit = 0;
  for (let i = 0; i < orbits.length; i++) {
    if (rnd() >= p) continue;
    const orbit = orbits[i];
    for (let k = 0; k < orbit.length; k++) scratch[orbit[k]] = 1;
    lit += orbit.length;
  }
  return lit;
}

/**
 * Search for a mark. Predicates run cheapest-first so the flood fill — by far
 * the most expensive — only sees candidates that already passed everything
 * else.
 */
function search(
  orbits: Int32Array[],
  rnd: () => number,
  cap: number,
  requireTidy: boolean,
): Uint8Array | null {
  for (let draw = 0; draw < cap; draw++) {
    const lit = propose(orbits, P_MIN + rnd() * P_SPAN, rnd);
    if (lit < MIN_LIT || lit > MAX_LIT) continue;
    if (!rimsCovered(scratch)) continue;
    if (!noSolidQuad(scratch)) continue;
    if (
      requireTidy &&
      looseEndCount(scratch, MAX_LOOSE_ENDS) > MAX_LOOSE_ENDS
    ) {
      continue;
    }
    if (!isOnePiece(scratch, lit)) continue;
    return scratch.slice();
  }
  return null;
}

/**
 * Memo by seed. A resident's mark is drawn once per session; every later render
 * — every re-mount, theme flip and resize — reuses it.
 */
const cache = new Map<string, IdentityGlyph>();
/**
 * Comfortably above any plausible resident count, so the clear-on-overflow
 * below is a leak guard rather than something the app ever reaches. A network
 * that did exceed it would re-derive marks it had already drawn, which is
 * correct but slow — hence the headroom.
 */
const CACHE_LIMIT = 4096;

/**
 * Derive a resident's mark from their public key.
 *
 * Deterministic: the same key always produces the same mark, including which
 * fallback tier it lands on.
 */
export function identityGlyph(seed: string): IdentityGlyph {
  const hit = cache.get(seed);
  if (hit) return hit;

  const rnd = seeded(seed);
  const symmetry: GlyphSymmetry = rnd() < 0.5 ? "mirror" : "rot2";
  const orbits = ORBITS[symmetry];

  // Tier two drops the loose-end limit, which is the only predicate here that
  // is taste rather than structure. No key has ever needed it in testing, but a
  // mark that is slightly busy beats a mark that never arrives.
  const cells =
    search(orbits, rnd, DRAW_CAP, true) ??
    search(orbits, rnd, RELAXED_CAP, false);

  if (!cells) {
    // Unreachable in practice — retained so the function is total rather than
    // throwing inside a render.
    const fallback = new Uint8Array(AREA);
    for (let i = 0; i < GLYPH_N; i++) {
      fallback[i * GLYPH_N + 3] = 1;
      fallback[3 * GLYPH_N + i] = 1;
    }
    const glyph: IdentityGlyph = {
      cells: fallback,
      edge: GLYPH_N,
      symmetry,
      lit: GLYPH_N * 2 - 1,
    };
    return glyph;
  }

  let lit = 0;
  for (let i = 0; i < AREA; i++) lit += cells[i];
  const glyph: IdentityGlyph = { cells, edge: GLYPH_N, symmetry, lit };

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(seed, glyph);
  return glyph;
}

/** Drop the memo. For tests, and for a community switch. */
export function resetIdentityGlyphCache(): void {
  cache.clear();
}

/** `true` when the cell at (x, y) is lit. Bounds-safe. */
export function glyphLit(glyph: IdentityGlyph, x: number, y: number): boolean {
  return inBounds(x, y) && glyph.cells[y * GLYPH_N + x] === 1;
}
