import assert from "node:assert/strict";
import test from "node:test";

import {
  dequantizeUV,
  fingerprintCacheKey,
  isStoredPrint,
  MemoryFingerprintStore,
  quantizeUV,
} from "./cache.ts";
import { GROWTH_VERSION, N } from "./growth.ts";

test("the key holds the version, the seed and the kind", () => {
  assert.equal(
    fingerprintCacheKey(0xe40c292c, "whorl"),
    `v${GROWTH_VERSION}:${0xe40c292c}:whorl`,
  );
  assert.notEqual(
    fingerprintCacheKey(1, "whorl"),
    fingerprintCacheKey(1, "loop"),
  );
});

test("a print survives the round trip within one 16-bit step", async () => {
  const uv = new Float32Array(N * N * 2);
  for (let i = 0; i < uv.length; i++) uv[i] = (Math.sin(i * 0.37) + 1) / 2;
  uv[0] = -0.2;
  uv[1] = 1.4;
  const store = new MemoryFingerprintStore();
  const key = fingerprintCacheKey(42, "arch");
  assert.equal(await store.get(key), null, "a miss before the put");
  const q = quantizeUV(uv);
  assert.ok(isStoredPrint(q));
  await store.put(key, q);
  const back = await store.get(key);
  assert.ok(isStoredPrint(back));
  assert.deepEqual(back, q);
  const restored = dequantizeUV(back);
  assert.equal(restored[0], 0, "held at 0");
  assert.equal(restored[1], 1, "held at 1");
  for (let i = 2; i < uv.length; i++) {
    assert.ok(Math.abs(restored[i] - uv[i]) <= 0.5 / 65535 + 1e-7);
  }
  // Quantizing what came back changes nothing: a cached print is drawn the
  // same as a fresh one.
  assert.deepEqual(quantizeUV(restored), q);
});

test("a stored print of the wrong shape is not trusted", () => {
  assert.equal(isStoredPrint(new Uint16Array(10)), false);
  assert.equal(isStoredPrint(new Float32Array(N * N * 2)), false);
  assert.equal(isStoredPrint(null), false);
});
