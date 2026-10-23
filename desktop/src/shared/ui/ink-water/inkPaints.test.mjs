import assert from "node:assert/strict";
import test from "node:test";

import {
  hexToInk,
  paintIndexForWord,
  varyInk,
  WATER_PAINTS,
  waterPalette,
} from "./inkPaints.ts";
import { linearColor } from "./inkWaterEngine.ts";

test("the water carries the app's own Living Ink colours", () => {
  const palette = waterPalette();
  assert.equal(palette.length, WATER_PAINTS.length);
  assert.deepEqual(hexToInk("#a65cff"), [166 / 255, 92 / 255, 1]);
  for (const color of palette) {
    for (const channel of color) assert.ok(channel >= 0 && channel <= 1);
  }
});

test("neighbouring words never share a paint, and six words use all six", () => {
  const paints = WATER_PAINTS.length;
  const picked = Array.from({ length: paints }, (_, word) =>
    paintIndexForWord(word, paints),
  );
  assert.equal(new Set(picked).size, paints);
  for (let word = 0; word < 40; word += 1) {
    assert.notEqual(
      paintIndexForWord(word, paints),
      paintIndexForWord(word + 1, paints),
    );
  }
});

test("beads of one word vary a little and stay in gamut", () => {
  const violet = hexToInk("#a65cff");
  const beads = Array.from({ length: 12 }, (_, bead) => varyInk(violet, bead));
  assert.ok(new Set(beads.map((bead) => bead.join())).size > 6);
  for (const bead of beads) {
    for (const channel of bead) assert.ok(channel >= 0 && channel <= 1);
  }
});

test("paint is mixed in linear light", () => {
  const [r, g, b] = linearColor([1, 0.5, 0]);
  assert.equal(r, 1);
  assert.ok(Math.abs(g - 0.214) < 0.001);
  assert.equal(b, 0);
});
