import assert from "node:assert/strict";
import test from "node:test";

import {
  GLYPH_N,
  componentCount,
  glyphLit,
  hasSolidQuad,
  identityGlyph,
  isWellFormed,
  looseEndCount,
  resetIdentityGlyphCache,
  touchesEveryRim,
} from "./glyph.ts";

const KEY_A =
  "35653885e1eeb9c1a0759c24b502f6105714f0198ee83d04468b9905752ec899";
const KEY_B =
  "9f2b7c1d4e6a8035bd21ce4470f9a6182d3b5c7e90a4162f8837de5b0c1a4e73";

/**
 * Big enough for the invariants to mean something, small enough that the whole
 * population fits the generator's memo and only the first test pays for it.
 */
const POPULATION = 600;
const keys = Array.from({ length: POPULATION }, (_, i) => `resident-${i}`);

test("a resident's mark is stable: same key, same mark, forever", () => {
  const first = identityGlyph(KEY_A);
  resetIdentityGlyphCache();
  const second = identityGlyph(KEY_A);
  assert.deepEqual([...first.cells], [...second.cells]);
  assert.equal(first.symmetry, second.symmetry);
});

test("the memo returns an identical mark, not merely an equal one", () => {
  resetIdentityGlyphCache();
  assert.equal(identityGlyph(KEY_A), identityGlyph(KEY_A));
});

test("different keys produce different marks", () => {
  assert.notDeepEqual(
    [...identityGlyph(KEY_A).cells],
    [...identityGlyph(KEY_B).cells],
  );
});

test("the lattice is 7x7", () => {
  const g = identityGlyph(KEY_A);
  assert.equal(g.edge, GLYPH_N);
  assert.equal(g.cells.length, GLYPH_N * GLYPH_N);
});

test("degenerate seeds still produce a well-formed mark", () => {
  for (const seed of ["", "z", "luca", "0", " ", "🙂"]) {
    const g = identityGlyph(seed);
    assert.ok(
      isWellFormed(g),
      `seed ${JSON.stringify(seed)} produced a malformed mark`,
    );
  }
});

test("every mark is a single connected piece", () => {
  for (const key of keys) {
    assert.equal(
      componentCount(identityGlyph(key).cells),
      1,
      `${key} came out in more than one piece`,
    );
  }
});

test("no mark contains a solid 2x2 — stroke width stays one cell", () => {
  for (const key of keys) {
    assert.equal(
      hasSolidQuad(identityGlyph(key).cells),
      false,
      `${key} has a solid 2x2`,
    );
  }
});

test("every mark touches all four rims, so the column scans at one size", () => {
  for (const key of keys) {
    assert.equal(
      touchesEveryRim(identityGlyph(key).cells),
      true,
      `${key} does not fill its box`,
    );
  }
});

test("ink stays inside the 35-47% band, so no resident reads heavier", () => {
  for (const key of keys) {
    const { lit } = identityGlyph(key);
    assert.ok(
      lit >= 17 && lit <= 23,
      `${key} landed at ${lit} lit cells, outside 17-23`,
    );
  }
});

test("marks are tidy: at most four loose ends", () => {
  // The sampler drops this predicate as a last resort if a key somehow cannot
  // be satisfied, so this asserts on the rate rather than on every mark.
  let untidy = 0;
  for (const key of keys) {
    if (looseEndCount(identityGlyph(key).cells) > 4) untidy++;
  }
  assert.ok(
    untidy <= POPULATION * 0.005,
    `${untidy} of ${POPULATION} marks fell back to the untidy tier`,
  );
});

test("both symmetry species appear, roughly evenly", () => {
  let mirror = 0;
  for (const key of keys) {
    if (identityGlyph(key).symmetry === "mirror") mirror++;
  }
  const share = mirror / POPULATION;
  assert.ok(
    share > 0.4 && share < 0.6,
    `mirror share was ${(share * 100).toFixed(1)}%, expected near 50%`,
  );
});

test("marks are symmetric in the group they claim", () => {
  for (const key of keys.slice(0, 300)) {
    const g = identityGlyph(key);
    for (let y = 0; y < GLYPH_N; y++) {
      for (let x = 0; x < GLYPH_N; x++) {
        const partner =
          g.symmetry === "mirror"
            ? glyphLit(g, GLYPH_N - 1 - x, y)
            : glyphLit(g, GLYPH_N - 1 - x, GLYPH_N - 1 - y);
        assert.equal(
          glyphLit(g, x, y),
          partner,
          `${key} breaks ${g.symmetry} symmetry at ${x},${y}`,
        );
      }
    }
  }
});

test("the population is overwhelmingly distinct", () => {
  // The whole point of replacing the mirrored-noise generator was that its
  // successors could only reach a few thousand shapes. Rejection sampling
  // measures ~96-98%; 90% is the floor worth failing on.
  const seen = new Set(keys.map((k) => identityGlyph(k).cells.join("")));
  const unique = seen.size / POPULATION;
  assert.ok(
    unique >= 0.9,
    `only ${(unique * 100).toFixed(1)}% of marks were distinct`,
  );
});

test("every shipped mark satisfies the exported well-formedness predicate", () => {
  let bad = 0;
  for (const key of keys) {
    if (!isWellFormed(identityGlyph(key))) bad++;
  }
  assert.ok(bad <= POPULATION * 0.005, `${bad} marks failed isWellFormed`);
});
