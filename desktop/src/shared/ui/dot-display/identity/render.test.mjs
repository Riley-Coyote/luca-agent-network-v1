import assert from "node:assert/strict";
import test from "node:test";

import { GLYPH_N, identityGlyph } from "./glyph.ts";
import { glyphMetrics, glyphToSvgPath } from "./render.ts";

const glyph = identityGlyph("luca");

/** Every size the app asks for, and both device pixel ratios it runs at. */
const SIZES = [13, 16, 17, 18, 20, 24, 26, 28, 32, 35, 38, 40, 52, 56, 80, 112];
const RATIOS = [1, 2, 3];

test("the lattice never overflows its own canvas", () => {
  for (const dpr of RATIOS) {
    for (const size of SIZES) {
      const m = glyphMetrics(glyph, { size, dpr });
      const span = m.cell * GLYPH_N;
      assert.ok(
        span <= m.extent,
        `size ${size} @${dpr}x: lattice is ${span}dp inside a ${m.extent}dp canvas`,
      );
      assert.ok(
        m.originX >= 0 && m.originY >= 0,
        `size ${size} @${dpr}x: origin went negative (${m.originX})`,
      );
      assert.ok(
        m.originX + span <= m.extent,
        `size ${size} @${dpr}x: lattice runs past the right edge`,
      );
    }
  }
});

test("cell pitch is a whole number of device pixels, so edges stay crisp", () => {
  for (const dpr of RATIOS) {
    for (const size of SIZES) {
      const { cell } = glyphMetrics(glyph, { size, dpr });
      assert.equal(cell, Math.floor(cell), `size ${size} @${dpr}x: ${cell}`);
      assert.ok(cell >= 1, `size ${size} @${dpr}x: pitch collapsed to ${cell}`);
    }
  }
});

test("a mark fills most of its box at the sizes the app actually uses", () => {
  // The rim rule only buys a consistent column if the mark is also allowed to
  // be big. Anything under about two thirds reads as a speck in a frame.
  for (const size of [20, 26, 28, 52, 56]) {
    const m = glyphMetrics(glyph, { size, dpr: 2 });
    const fill = (m.cell * GLYPH_N) / m.extent;
    assert.ok(
      fill >= 0.66,
      `size ${size}: mark fills only ${(fill * 100).toFixed(0)}% of its box`,
    );
  }
});

test("the SVG path covers every lit cell and nothing else", () => {
  const path = glyphToSvgPath(glyph);
  const moves = path.match(/M/g)?.length ?? 0;
  assert.equal(moves, glyph.lit, "one subpath per lit cell");
  assert.ok(path.endsWith("Z"), "every subpath is closed");
  assert.equal(/NaN|undefined/.test(path), false, "path has no bad numbers");
});
