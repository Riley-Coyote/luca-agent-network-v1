/* Identity glyphs, generated at build time so no glyph code ships to the browser.
   identityGlyph() is ported verbatim from the app's
   desktop/src/shared/ui/dot-display/identity/glyph.ts and glyphToSvgPath() from its render.ts
   (types removed). A seed drives a symmetric 7x7 lattice, sampled until it has 17-23 lit cells,
   touches all four rims, has no solid 2x2, has at most four loose ends and is one connected piece.
   It renders as filled, joined cells: only corners facing empty space are rounded (corner 0.3).

   Run `node scripts/glyphs.mjs` to print each seed's cells and path; the paths are pasted into
   index.html as <svg viewBox="0 0 7 7"><path d="..."></svg> marks. Seeds:
     Luca      LUCA_IDENTITY_SEED (features/luca/canonicalLucaResident.ts), the same for every owner
     Fifty     embedded cells; the real mark comes from Riley's public key, which stays off the page
     Trinity   the same
     everyone  their lowercase name
*/
const GLYPH_N = 7;
const AREA = GLYPH_N * GLYPH_N;
const MIN_LIT = 17;
const MAX_LIT = 23;
const MAX_LOOSE_ENDS = 4;
const P_MIN = 0.38;
const P_SPAN = 0.1;
const DRAW_CAP = 150_000;
const RELAXED_CAP = 40_000;
const inBounds = (x, y) => x >= 0 && y >= 0 && x < GLYPH_N && y < GLYPH_N;
function orbitsFor(symmetry) {
  const partner = (x, y) =>
    symmetry === 'mirror' ? [GLYPH_N - 1 - x, y] : [GLYPH_N - 1 - x, GLYPH_N - 1 - y];
  const claimed = new Uint8Array(AREA);
  const out = [];
  for (let y = 0; y < GLYPH_N; y++) {
    for (let x = 0; x < GLYPH_N; x++) {
      const here = y * GLYPH_N + x;
      if (claimed[here]) continue;
      const [px, py] = partner(x, y);
      const there = py * GLYPH_N + px;
      claimed[here] = 1;
      claimed[there] = 1;
      out.push(here === there ? Int32Array.of(here) : Int32Array.of(here, there));
    }
  }
  return out;
}
const ORBITS = { mirror: orbitsFor('mirror'), rot2: orbitsFor('rot2') };
function seeded(input) {
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
const scratch = new Uint8Array(AREA);
const visited = new Uint8Array(AREA);
const frontier = new Int32Array(AREA);
function rimsCovered(cells) {
  let top = 0, bottom = 0, left = 0, right = 0;
  for (let i = 0; i < GLYPH_N; i++) {
    top |= cells[i];
    bottom |= cells[(GLYPH_N - 1) * GLYPH_N + i];
    left |= cells[i * GLYPH_N];
    right |= cells[i * GLYPH_N + GLYPH_N - 1];
  }
  return Boolean(top && bottom && left && right);
}
function noSolidQuad(cells) {
  for (let y = 0; y < GLYPH_N - 1; y++) {
    const row = y * GLYPH_N;
    for (let x = 0; x < GLYPH_N - 1; x++) {
      if (cells[row + x] && cells[row + x + 1] && cells[row + GLYPH_N + x] && cells[row + GLYPH_N + x + 1]) return false;
    }
  }
  return true;
}
function looseEndCount(cells, stopAt = Number.MAX_SAFE_INTEGER) {
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
function isOnePiece(cells, lit) {
  let start = -1;
  for (let i = 0; i < AREA; i++) {
    if (cells[i]) { start = i; break; }
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
    if (x > 0 && cells[k - 1] && !visited[k - 1]) { visited[k - 1] = 1; frontier[top++] = k - 1; }
    if (x < GLYPH_N - 1 && cells[k + 1] && !visited[k + 1]) { visited[k + 1] = 1; frontier[top++] = k + 1; }
    if (y > 0 && cells[k - GLYPH_N] && !visited[k - GLYPH_N]) { visited[k - GLYPH_N] = 1; frontier[top++] = k - GLYPH_N; }
    if (y < GLYPH_N - 1 && cells[k + GLYPH_N] && !visited[k + GLYPH_N]) { visited[k + GLYPH_N] = 1; frontier[top++] = k + GLYPH_N; }
  }
  return reached === lit;
}
function propose(orbits, p, rnd) {
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
function search(orbits, rnd, cap, requireTidy) {
  for (let draw = 0; draw < cap; draw++) {
    const lit = propose(orbits, P_MIN + rnd() * P_SPAN, rnd);
    if (lit < MIN_LIT || lit > MAX_LIT) continue;
    if (!rimsCovered(scratch)) continue;
    if (!noSolidQuad(scratch)) continue;
    if (requireTidy && looseEndCount(scratch, MAX_LOOSE_ENDS) > MAX_LOOSE_ENDS) continue;
    if (!isOnePiece(scratch, lit)) continue;
    return scratch.slice();
  }
  return null;
}
const cache = new Map();
const CACHE_LIMIT = 4096;
export function identityGlyph(seed) {
  const hit = cache.get(seed);
  if (hit) return hit;
  const rnd = seeded(seed);
  const symmetry = rnd() < 0.5 ? 'mirror' : 'rot2';
  const orbits = ORBITS[symmetry];
  const cells = search(orbits, rnd, DRAW_CAP, true) ?? search(orbits, rnd, RELAXED_CAP, false);
  if (!cells) {
    const fallback = new Uint8Array(AREA);
    for (let i = 0; i < GLYPH_N; i++) {
      fallback[i * GLYPH_N + 3] = 1;
      fallback[3 * GLYPH_N + i] = 1;
    }
    return { cells: fallback, edge: GLYPH_N, symmetry, lit: GLYPH_N * 2 - 1 };
  }
  let lit = 0;
  for (let i = 0; i < AREA; i++) lit += cells[i];
  const glyph = { cells, edge: GLYPH_N, symmetry, lit };
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(seed, glyph);
  return glyph;
}
function glyphLit(glyph, x, y) {
  return inBounds(x, y) && glyph.cells[y * GLYPH_N + x] === 1;
}
const CORNER_LARGE = 0.3;
export function glyphToSvgPath(glyph, corner = CORNER_LARGE) {
  const parts = [];
  for (let y = 0; y < glyph.edge; y++) {
    for (let x = 0; x < glyph.edge; x++) {
      if (!glyphLit(glyph, x, y)) continue;
      const n = glyphLit(glyph, x, y - 1);
      const s = glyphLit(glyph, x, y + 1);
      const w = glyphLit(glyph, x - 1, y);
      const e = glyphLit(glyph, x + 1, y);
      const tl = !n && !w ? corner : 0;
      const tr = !n && !e ? corner : 0;
      const br = !s && !e ? corner : 0;
      const bl = !s && !w ? corner : 0;
      const x0 = x, y0 = y, x1 = x + 1, y1 = y + 1;
      parts.push(
        `M${x0 + tl} ${y0}` +
          `H${x1 - tr}` +
          (tr ? `A${tr} ${tr} 0 0 1 ${x1} ${y0 + tr}` : '') +
          `V${y1 - br}` +
          (br ? `A${br} ${br} 0 0 1 ${x1 - br} ${y1}` : '') +
          `H${x0 + bl}` +
          (bl ? `A${bl} ${bl} 0 0 1 ${x0} ${y1 - bl}` : '') +
          `V${y0 + tl}` +
          (tl ? `A${tl} ${tl} 0 0 1 ${x0 + tl} ${y0}` : '') +
          'Z'
      );
    }
  }
  return parts.join(' ');
}
/* Luca's seed is the same for every owner. Fifty's and Trinity's marks come from Riley's real
   public keys, which stay out of the page: their generated cells are embedded (row-major, 1 = lit). */
export const LUCA_IDENTITY_SEED = '9dee6768a16dc99a2f399672eabffe3d1c2d30cd9daaeda8ae0c36074751b9f2';
export const GLYPH_CELLS = {
  fifty: '1110111100000110000011000001100000111111110010100',
  trinity: '0000010001001011101111011101111011101001000100000'
};
export function glyphFor(key) {
  const bits = GLYPH_CELLS[key];
  return bits
    ? { cells: Uint8Array.from(bits, c => +c), edge: GLYPH_N }
    : identityGlyph(key === 'luca' ? LUCA_IDENTITY_SEED : key);
}
export function pathFor(key) {
  return glyphToSvgPath(glyphFor(key));
}
export function cellsFor(key) {
  return Array.from(glyphFor(key).cells).join('');
}

/* The page's marks, in one place. */
export const SEEDS = ['luca', 'fifty', 'trinity', 'mira', 'iris', 'otto', 'ziggy', 'wren', 'nia', 'vektor'];

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = {};
  for (const key of SEEDS) out[key] = { cells: cellsFor(key), d: pathFor(key) };
  console.log(JSON.stringify(out, null, 2));
}
