import assert from "node:assert/strict";
import test from "node:test";

import { LUCA_IDENTITY_SEED } from "@/features/luca/canonicalLucaResident";
import {
  dendriteSeed,
  fnv1a,
  FINE,
  growNow,
  seededRandom,
  spacingFor,
} from "./tree.ts";
import { Choir, FineMark, FineRenderer } from "./renderer.ts";

function canvas() {
  const context = {
    frames: 0,
    createImageData: (w, h) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData(image) {
      this.frames++;
      this.data = image.data.slice();
    },
  };
  return { width: 0, height: 0, getContext: () => context, context };
}
const mark = (size = 18, options = {}) =>
  new FineMark(canvas(), { size, rand: seededRandom(7), ...options }, 2);

test("resident identity still uses residentGlyphSeed; new growth is not a fixed identity tree", () => {
  const luca = "ab".repeat(32);
  assert.equal(dendriteSeed(luca, luca), fnv1a(LUCA_IDENTITY_SEED));
  const m = mark();
  const first = m.cur.xs.slice();
  m.begin();
  assert.notDeepEqual(m.cur.xs, first);
});

test("growth stays inside the study's 0.46-width boundary (with lattice rounding)", () => {
  for (const size of [18, 28, 40, 72]) {
    const mode = size < FINE.BREAK ? "off" : "pixel";
    const width = mode === "off" ? size * 2 : size;
    for (let seed = 1; seed <= 12; seed++) {
      const t = growNow(mode, width, seededRandom(seed), spacingFor(size));
      assert.equal(t.ps[0], -1);
      // Grid walkers are rounded to cell centres; retain that exact study behavior.
      const tolerance = mode === "pixel" ? Math.SQRT2 : 1e-5;
      for (let k = 1; k < t.n; k++) {
        assert.ok(t.ps[k] >= 0 && t.ps[k] < k);
        assert.ok(
          Math.hypot(t.xs[k] - width / 2, t.ys[k] - width / 2) <=
            0.46 * width + tolerance,
        );
      }
    }
  }
});

test("under 40 is fine, full-grown, small timing; 40 and up is pixel", () => {
  for (const size of [18, 24, 28, 39, 40, 72]) {
    const m = mark(size);
    assert.equal(m.mode, size < 40 ? "off" : "pixel");
    assert.equal(m.small, size < 40);
    assert.equal(m.canvas.width, size * 2);
    if (m.small) {
      assert.equal(m.grow, 9);
      assert.equal(m.cur.shown, m.cur.n);
      assert.ok(m.restFor >= 20 && m.restFor <= 40);
    }
  }
});

test("reveal is timed in seconds, not frames; working grows 1.5x faster", () => {
  const a = mark(72);
  const b = mark(72);
  const working = mark(72, { working: true });
  for (const m of [a, b, working]) m.begin();
  for (let i = 0; i < 60; i++) a.step(1 / 60);
  for (let i = 0; i < 30; i++) b.step(1 / 30);
  for (let i = 0; i < 60; i++) working.step(1 / 60);
  assert.ok(Math.abs(a.u - 1 / 12) < 1e-12);
  assert.ok(Math.abs(a.u - b.u) < 1e-12);
  assert.ok(Math.abs(working.u - a.u * 1.5) < 1e-12);
  assert.equal(FINE.FADE_IN, 0.25);
  assert.ok(a.cur.born.some((time) => Number.isFinite(time)));
});

test("working rests twice as fast, bypasses its choir, and the 120s cap survives", () => {
  const a = mark();
  const b = mark(18, { working: true });
  for (const m of [a, b]) {
    m.rested = 0;
    m.gate = () => false;
  }
  a.step(1);
  b.step(1);
  assert.equal(a.rested, 1);
  assert.equal(b.rested, 2);
  b.rested = b.restFor;
  b.step(0.01);
  assert.equal(b.phase, "grow");
  a.rested = a.restFor + 120.01;
  a.step(0.01);
  assert.equal(a.phase, "grow");
});

test("choir allows one resting regrowth; working may regrow alongside it", () => {
  const choir = new Choir();
  const a = mark();
  const b = mark();
  const work = mark(18, { working: true });
  for (const m of [a, b, work]) {
    m.gate = (entry) => choir.allows(entry);
    m.rested = m.restFor + 1;
  }
  choir.update([a, b, work]);
  a.step(0.01);
  b.step(0.01);
  work.step(0.01);
  assert.equal(a.phase, "grow");
  assert.equal(b.phase, "rest");
  assert.equal(work.phase, "grow");
  // The approved code counts an already-growing working mark as busy, too.
  choir.update([a, b, work]);
  assert.equal(choir.busy, 2);
  assert.equal(choir.allows(b), false);
});

test("Reduce Motion is one settled tree without dust", () => {
  const m = mark(72);
  m.draw(true);
  const first = m.canvas.context.data.slice();
  assert.ok(first.some((v) => v > 0));
  m.step(2);
  m.draw(true);
  assert.deepEqual(m.canvas.context.data, first);
});

test("shared loop pauses hidden/offscreen, draws Reduce Motion once, rebuilds for DPR", () => {
  const saved = Object.fromEntries(
    ["window", "document", "requestAnimationFrame", "IntersectionObserver"].map(
      (k) => [k, globalThis[k]],
    ),
  );
  const media = new Map();
  const raf = [];
  const listeners = new Map();
  let observe;
  globalThis.window = {
    devicePixelRatio: 2,
    matchMedia(query) {
      if (!media.has(query))
        media.set(query, {
          matches: query.includes("reduced-motion"),
          addEventListener: (_type, callback) => listeners.set(query, callback),
          removeEventListener: () => listeners.delete(query),
        });
      return media.get(query);
    },
  };
  globalThis.document = { hidden: false, addEventListener() {} };
  globalThis.requestAnimationFrame = (fn) => {
    raf.push(fn);
    return raf.length;
  };
  globalThis.IntersectionObserver = class {
    constructor(fn) {
      observe = fn;
    }
    observe() {}
    unobserve() {}
  };
  try {
    const renderer = new FineRenderer();
    const c = canvas();
    const h = renderer.register(c, {
      size: 28,
      group: "rail",
      rand: seededRandom(5),
    });
    assert.equal(c.context.frames, 1);
    assert.equal(raf.length, 0, "no animation requested under Reduce Motion");
    assert.ok(h.mark.choir, "28px marks join their choir");
    window.devicePixelRatio = 3;
    listeners.get("(resolution: 2dppx)")();
    assert.equal(c.width, 84);
    assert.ok(listeners.has("(resolution: 3dppx)"));
    renderer.setReducedMotion(false);
    const before = h.mark.t;
    observe([{ target: c, isIntersecting: false }]);
    renderer.tick(renderer.last + 16);
    assert.equal(h.mark.t, before);
    observe([{ target: c, isIntersecting: true }]);
    document.hidden = true;
    renderer.tick(renderer.last + 16);
    assert.equal(h.mark.t, before);
    document.hidden = false;
    renderer.tick(renderer.last + 1000);
    assert.ok(Math.abs(h.mark.t - before - 0.05) < 1e-12, "dt remains clamped");
    h.dispose();
    assert.equal(renderer.marks.size, 0);
  } finally {
    for (const [k, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[k];
      else globalThis[k] = value;
    }
  }
});
