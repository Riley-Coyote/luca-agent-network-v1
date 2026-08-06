import assert from "node:assert/strict";
import test from "node:test";

import { sigilPattern } from "./engine.ts";

const KEY_A =
  "35653885e1eeb9c1a0759c24b502f6105714f0198ee83d04468b9905752ec899";
const KEY_B =
  "9f2b7c1d4e6a8035bd21ce4470f9a6182d3b5c7e90a4162f8837de5b0c1a4e73";

test("a resident's mark is stable: same key, same pattern, forever", () => {
  const first = sigilPattern(KEY_A);
  const second = sigilPattern(KEY_A);
  assert.deepEqual(first.grid, second.grid);
  assert.equal(first.phase, second.phase);
});

test("different keys produce different marks", () => {
  assert.notDeepEqual(sigilPattern(KEY_A).grid, sigilPattern(KEY_B).grid);
});

test("the pattern is a 7-row, 4-column half that mirrors to 7 wide", () => {
  const { grid, patternWidth, patternHeight } = sigilPattern(KEY_A);
  assert.equal(patternWidth, 4);
  assert.equal(patternHeight, 7);
  assert.equal(grid.length, 7);
  assert.equal(
    grid.every((row) => row.length === 4),
    true,
  );
});

test("every row carries at least one dot, so a mark never breaks into stripes", () => {
  for (const key of [KEY_A, KEY_B, "", "z", "luca"]) {
    const { grid } = sigilPattern(key);
    assert.equal(
      grid.every((row) => row.some(Boolean)),
      true,
      `row went empty for seed ${JSON.stringify(key)}`,
    );
  }
});

test("density stays inside the legible band for a large sample of keys", () => {
  // Below 40% a mark reads as empty; above 60% it clogs into a block. The
  // generator retries to land in that band, so this is the invariant that keeps
  // every resident's emblem recognisable rather than just most of them.
  for (let i = 0; i < 400; i += 1) {
    const { grid, patternWidth, patternHeight } = sigilPattern(`resident-${i}`);
    const full = patternWidth * 2 - 1;
    let lit = 0;
    for (const row of grid) {
      for (let k = 0; k < patternWidth; k += 1) {
        if (row[k]) lit += k === patternWidth - 1 ? 1 : 2;
      }
    }
    const density = lit / (patternHeight * full);
    assert.ok(
      density >= 0.4 && density <= 0.6,
      `seed resident-${i} landed at density ${density.toFixed(3)}`,
    );
  }
});
