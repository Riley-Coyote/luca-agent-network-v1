import assert from "node:assert/strict";
import test from "node:test";

import {
  INK_LIGHT_IDLE_MS,
  INK_LIGHT_SLOPE,
  inkLightAlong,
  inkLightTarget,
  stepInkLight,
} from "./inkLight.ts";

const light = (overrides = {}) => ({
  x: 0,
  y: 0,
  targetX: 300,
  targetY: 200,
  at: 1_000,
  ...overrides,
});

test("the light goes where the pointer is", () => {
  assert.deepEqual(inkLightTarget(light(), 1_500, 800, 600), {
    x: 300,
    y: 200,
  });
  assert.deepEqual(
    inkLightTarget(light(), 1_000 + INK_LIGHT_IDLE_MS, 800, 600),
    {
      x: 300,
      y: 200,
    },
  );
});

test("left alone, it wanders slowly across the window", () => {
  const later = 1_000 + INK_LIGHT_IDLE_MS + 1;
  const a = inkLightTarget(light(), later, 800, 600);
  const b = inkLightTarget(light(), later + 1_000, 800, 600);
  assert.notDeepEqual(a, { x: 300, y: 200 });
  for (const point of [a, b]) {
    assert.ok(point.x >= 800 * 0.08 && point.x <= 800 * 0.92, `${point.x}`);
    assert.ok(point.y >= 600 * 0.1 && point.y <= 600 * 0.6, `${point.y}`);
  }
  // A second of wandering moves it only a little.
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 80);
});

test("it follows a little behind, never jumping", () => {
  const moving = light();
  stepInkLight(moving, { x: 100, y: 0 }, 0.016);
  assert.ok(moving.x > 0 && moving.x < 10, `${moving.x}`);
  // A long frame is capped: it never overshoots.
  stepInkLight(moving, { x: 100, y: 0 }, 10);
  assert.equal(moving.x, 100);
});

test("the gloss leans at 104 degrees, the same on every line", () => {
  assert.equal(inkLightAlong({ x: 150, y: 40 }, { left: 100, top: 40 }), 50);
  assert.equal(
    inkLightAlong({ x: 150, y: 140 }, { left: 100, top: 40 }),
    50 + 100 * INK_LIGHT_SLOPE,
  );
  assert.ok(Math.abs(Math.atan(INK_LIGHT_SLOPE) * (180 / Math.PI) - 15) < 1);
});
