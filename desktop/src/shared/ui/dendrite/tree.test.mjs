import assert from "node:assert/strict";
import test from "node:test";

import { LUCA_IDENTITY_SEED } from "@/features/luca/canonicalLucaResident";

import { dendriteSeed, fnv1a, growDendrite, seededRandom } from "./tree.ts";

const LUCA = "4fb94373fb5cfb7fe322d95a48d8cc4c4bb04a990cf43d4f38b895a52635d5bb";
const key = (n) => n.toString(16).padStart(2, "0").repeat(32);

test("FNV-1a is the 0x811c9dc5 / 0x01000193 form", () => {
  assert.equal(fnv1a(""), 0x811c9dc5);
  assert.equal(fnv1a("a"), 0xe40c292c);
  assert.equal(fnv1a("foobar"), 0xbf9cf968);
});

test("the seed is FNV-1a of residentGlyphSeed", () => {
  // Luca's tree comes from Luca's fixed seed, whatever Luca's key is.
  assert.equal(dendriteSeed(LUCA, LUCA), fnv1a(LUCA_IDENTITY_SEED));
  assert.equal(
    dendriteSeed(key(7), key(7)),
    dendriteSeed(LUCA, LUCA),
    "the same Luca tree for every owner",
  );
  assert.notEqual(dendriteSeed(key(7), LUCA), dendriteSeed(key(8), LUCA));
});

test("the generator is the design lab's", () => {
  const next = seededRandom(1);
  assert.deepEqual(
    [next(), next(), next()].map((v) => v.toFixed(12)),
    ["0.627073940588", "0.002735721180", "0.527447039960"],
  );
});

test("the same seed grows the same tree, forever", () => {
  const a = growDendrite(fnv1a(LUCA_IDENTITY_SEED));
  const b = growDendrite(fnv1a(LUCA_IDENTITY_SEED));
  assert.deepEqual(a, b);
});

// The design lab's own trees (shell-lab-rail, design-lab/agent-marks/family),
// grown by its grower: the app must grow exactly these, so every agent wears
// the mark the study showed.
const LAB = [
  [4043197479, 93, 19, 8.327658883, -3.588458145, [0.791476878, 0.378547311]],
  [
    1607413886,
    100,
    20,
    0.633083263,
    -4.112138087,
    [-0.474999881, -0.747634398],
  ],
  [2676239084, 120, 20, 4.358489679, 7.727388444, [0.250267735, 0.843000629]],
  [3047167575, 98, 22, 7.045772736, -6.569740097, [0.293300503, -0.81734556]],
  [2170318068, 100, 21, 5.947112031, 9.787418996, [-0.104635874, 0.889286068]],
];

test("the trees are the design lab's, number for number", () => {
  assert.equal(LAB[0][0], fnv1a(LUCA_IDENTITY_SEED), "the first is Luca's");
  for (const [seed, count, maxDepth, sumX, sumY, last] of LAB) {
    const tree = growDendrite(seed);
    assert.equal(tree.count, count, `${seed}: particles`);
    assert.equal(tree.maxDepth, maxDepth, `${seed}: depth`);
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < tree.count; i++) {
      sx += tree.px[i];
      sy += tree.py[i];
    }
    assert.ok(Math.abs(sx - sumX) < 1e-6, `${seed}: x ${sx} vs ${sumX}`);
    assert.ok(Math.abs(sy - sumY) < 1e-6, `${seed}: y ${sy} vs ${sumY}`);
    assert.ok(Math.abs(tree.px[tree.count - 1] - last[0]) < 1e-6);
    assert.ok(Math.abs(tree.py[tree.count - 1] - last[1]) < 1e-6);
  }
});

test("a tree is whole: each particle hangs from one before it, inside the disc", () => {
  for (let n = 1; n <= 12; n++) {
    const tree = growDendrite(dendriteSeed(key(n), LUCA));
    assert.equal(tree.parent[0], -1);
    assert.equal(tree.sub[0], tree.count, "everything hangs from the seed");
    for (let q = 1; q < tree.count; q++) {
      const p = tree.parent[q];
      assert.ok(p >= 0 && p < q, "stuck to one already there");
      assert.equal(tree.depth[q], tree.depth[p] + 1);
      assert.ok(Math.hypot(tree.px[q], tree.py[q]) <= 0.9 + 1e-9);
    }
  }
});
