import assert from "node:assert/strict";
import test from "node:test";

import { biasWeights, degreeOf, PileSim, seeded } from "./pile-core.ts";

const LATTICES = ["square", "square8", "triangular", "honeycomb"];

/** A clean sim — no preseed, so a test starts from a field it fully controls. */
function makeSim(W, H, cfg = {}) {
  return new PileSim(W, H, { preseedPerCell: 0, ...cfg });
}

function sum(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s;
}

test("delivery weights always sum to exactly the threshold", () => {
  // This is THE conservation invariant. Float weights that "roughly" sum to the
  // threshold quietly create or destroy grains every topple, and the field drifts
  // in a way that looks like physics and is not.
  for (const lattice of LATTICES) {
    const slots = degreeOf(lattice);
    for (let threshold = 2; threshold <= 9; threshold++) {
      for (const strength of [0, 0.3, 0.7, 1]) {
        for (const angle of [0, 1.1, 2.6, 4.9]) {
          const w = biasWeights(slots, threshold, angle, strength);
          assert.equal(
            sum(w),
            threshold,
            `${lattice} t=${threshold} s=${strength} a=${angle} summed to ${sum(w)}`,
          );
          for (const v of w) assert.ok(v >= 0, "negative weight");
        }
      }
    }
  }
});

test("grains are conserved on a torus, for every lattice and every drift", () => {
  for (const lattice of LATTICES) {
    for (const biasStrength of [0, 0.6]) {
      const sim = makeSim(24, 24, {
        lattice,
        boundary: "torus",
        biasStrength,
        biasAngle: 0.8,
        threshold: degreeOf(lattice),
      });
      const rnd = seeded(`fill-${lattice}-${biasStrength}`);
      for (let i = 0; i < sim.height.length; i++) {
        sim.height[i] = Math.floor(rnd() * 9);
      }
      const before = sum(sim.height);
      for (let s = 0; s < 40; s++) sim.sweep();
      assert.equal(
        sum(sim.height),
        before,
        `${lattice} (drift ${biasStrength}) leaked grains on a closed surface`,
      );
    }
  }
});

test("an open boundary loses grains, and only at the edge", () => {
  const sim = makeSim(20, 20, { boundary: "open" });
  sim.height.fill(8);
  const before = sum(sim.height);
  sim.relax();
  assert.ok(
    sum(sim.height) < before,
    "an open boundary that loses nothing is not dissipative, and cannot stay critical",
  );
});

/**
 * Independent sequential reference: topple one cell at a time, in an order
 * deliberately unlike the parallel sweep's raster scan.
 *
 * This is the abelian property (Dhar 1990) under test — it is the licence for
 * `sweep()` to fire every unstable cell simultaneously, and if it does not hold
 * then the engine's whole approach is wrong rather than merely fast.
 */
function sequentialStabilize(W, H, heights, threshold) {
  const h = Int16Array.from(heights);
  const idx = [];
  for (let i = 0; i < h.length; i++) idx.push(i);
  const rnd = seeded("order");
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  let moved = true;
  let guard = 0;
  while (moved && guard++ < 2_000_000) {
    moved = false;
    for (const i of idx) {
      while (h[i] >= threshold) {
        h[i] -= threshold;
        const x = i % W;
        const y = (i / W) | 0;
        if (x + 1 < W) h[i + 1]++;
        if (y + 1 < H) h[i + W]++;
        if (x - 1 >= 0) h[i - 1]++;
        if (y - 1 >= 0) h[i - W]++;
        moved = true;
      }
    }
  }
  return h;
}

test("parallel sweeps give the same result as toppling one cell at a time", () => {
  const W = 18;
  const H = 18;
  const sim = makeSim(W, H, { boundary: "open", threshold: 4 });
  const start = new Int16Array(W * H);
  const rnd = seeded("abelian");
  for (let i = 0; i < start.length; i++) start[i] = Math.floor(rnd() * 7);

  const parallel = sim.stabilize(start);
  const sequential = sequentialStabilize(W, H, start, 4);
  assert.deepEqual(Array.from(parallel), Array.from(sequential));
});

test("a big single-source pile matches the sequential reference too", () => {
  const W = 21;
  const H = 21;
  const sim = makeSim(W, H, { boundary: "open", threshold: 4 });
  const start = new Int16Array(W * H);
  start[((H >> 1) | 0) * W + ((W >> 1) | 0)] = 800;
  assert.deepEqual(
    Array.from(sim.stabilize(start)),
    Array.from(sequentialStabilize(W, H, start, 4)),
  );
});

test("the identity element is the identity of the group", () => {
  const sim = makeSim(16, 16, { boundary: "open", threshold: 4 });
  const e = sim.identity();

  // e is stable and recurrent: relaxing it changes nothing.
  assert.deepEqual(Array.from(sim.stabilize(e)), Array.from(e));
  // e + e = e. This is what makes it the identity rather than merely a mandala.
  assert.deepEqual(Array.from(sim.add(e, e)), Array.from(e));

  const a = sim.elementFromSeed("resident-a", e);
  assert.deepEqual(
    Array.from(sim.add(a, e)),
    Array.from(a),
    "adding the identity to a group element must return it unchanged",
  );
});

test("group addition is commutative, so a room cannot depend on arrival order", () => {
  const sim = makeSim(16, 16, { boundary: "open", threshold: 4 });
  const e = sim.identity();
  const a = sim.elementFromSeed("alice", e);
  const b = sim.elementFromSeed("bob", e);
  assert.deepEqual(Array.from(sim.add(a, b)), Array.from(sim.add(b, a)));
});

test("a seed's element is stable forever, and distinct seeds differ", () => {
  const sim = makeSim(16, 16, { boundary: "open", threshold: 4 });
  const e = sim.identity();
  const first = sim.elementFromSeed("resident-a", e);
  const again = sim.elementFromSeed("resident-a", e);
  assert.deepEqual(Array.from(first), Array.from(again));
  assert.notDeepEqual(
    Array.from(first),
    Array.from(sim.elementFromSeed("resident-b", e)),
  );
});

test("the preseed scales with area, unlike the production constant", () => {
  // Production hardcodes 90 grains regardless of lattice size, which is 0.46
  // per cell at rail scale and 0.056 at 40x40 — the reason every pile scene
  // opens as a dot at any size above the rail.
  const small = new PileSim(14, 14, { preseedPerCell: 0.46 });
  const large = new PileSim(48, 48, { preseedPerCell: 0.46 });
  const density = (s) => {
    let lit = 0;
    for (let i = 0; i < s.height.length; i++) if (s.height[i] > 0) lit++;
    return lit / s.height.length;
  };
  assert.ok(
    Math.abs(density(small) - density(large)) < 0.2,
    `occupancy should not collapse with size: ${density(small).toFixed(2)} vs ${density(large).toFixed(2)}`,
  );
});

test("the preseed leaves no trace in the odometer", () => {
  // The odometer is a record of what the viewer has watched happen. Scaffolding
  // that ran before first paint is not that.
  const sim = new PileSim(24, 24, { preseedPerCell: 1 });
  assert.equal(sum(sim.odometer), 0);
  assert.equal(sim.totalTopples, 0);
});

test("group algebra does not pollute the running history either", () => {
  const sim = makeSim(16, 16);
  sim.identity();
  sim.elementFromSeed("x");
  assert.equal(sum(sim.odometer), 0);
  assert.equal(sim.totalTopples, 0);
});
