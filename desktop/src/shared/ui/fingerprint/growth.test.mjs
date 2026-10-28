import assert from "node:assert/strict";
import test from "node:test";

import {
  CpuGrowth,
  FINGERPRINT_KINDS,
  fingerprintCore,
  GROWTH,
  mulberry32,
  N,
  startGrowth,
  toTextureAngle,
  toTextureUV,
} from "./growth.ts";

test("the growth is the brief's", () => {
  assert.deepEqual(
    { ...GROWTH },
    {
      F: 0.0545,
      k: 0.062,
      Du: 0.2,
      Dv: 0.1,
      dt: 1,
      along: 2.1,
      across: 0.17,
      steps: 4000,
    },
  );
  assert.equal(N, 96);
});

test("a seed always starts the same growth; another seed doesn't", () => {
  const a = startGrowth("whorl", 1234);
  const b = startGrowth("whorl", 1234);
  const c = startGrowth("whorl", 1235);
  assert.deepEqual(a.V, b.V);
  assert.notDeepEqual(a.V, c.V);
});

test("stripes seed V at .25 plus a little noise, and U = 1 − 2V", () => {
  for (const kind of FINGERPRINT_KINDS) {
    const s = startGrowth(kind, 99);
    let on = 0;
    for (let i = 0; i < N * N; i++) {
      if (s.V[i] > 0) {
        on++;
        assert.ok(s.V[i] >= 0.25 && s.V[i] < 0.3);
      }
      assert.ok(Math.abs(s.U[i] - (1 - 2 * s.V[i])) < 1e-12);
      assert.ok(
        Math.abs(Math.hypot(s.tx[i], s.ty[i]) - 1) < 1e-3 || s.tx[i] === 0,
      );
    }
    // sin(2πφ/8) > .2 holds on a little under half the grid.
    assert.ok(on > N * N * 0.3 && on < N * N * 0.6, `${kind}: ${on}`);
  }
});

test("an arch's wave runs from the middle; the others from their core", () => {
  assert.deepEqual(fingerprintCore("arch", 5), [N / 2, N / 2]);
  for (const kind of ["whorl", "loop", "sideloop", "double"]) {
    const core = fingerprintCore(kind, 5);
    assert.deepEqual(core, startGrowth(kind, 5).core);
    const r = mulberry32(5);
    assert.deepEqual(core, [
      (r() - 0.5) * 10 + N / 2,
      (r() - 0.5) * 10 + N / 2,
    ]);
  }
});

test("textures are flipped, row 0 at the bottom, as prints.py exports", () => {
  const s = startGrowth("loop", 7);
  const uv = toTextureUV(s.U, s.V);
  const angle = toTextureAngle(s);
  const top = 3 * N + 11;
  const flipped = (N - 1 - 3) * N + 11;
  assert.equal(uv[flipped * 2 + 1], Math.fround(s.V[top]));
  assert.equal(angle[flipped], Math.fround(Math.atan2(-s.ty[top], s.tx[top])));
});

test("growing ridges: V separates into ridge and valley, in range", () => {
  const g = new CpuGrowth(startGrowth("double", 31));
  assert.equal(g.step(600), false);
  assert.equal(g.done, 600);
  let lo = 1;
  let hi = 0;
  for (let i = 0; i < N * N; i++) {
    lo = Math.min(lo, g.start.V[i]);
    hi = Math.max(hi, g.start.V[i]);
    assert.ok(g.start.U[i] >= 0 && g.start.U[i] <= 1);
  }
  assert.ok(lo < 0.05 && hi > 0.3, `${lo} – ${hi}`);
});
