import assert from "node:assert/strict";
import test from "node:test";

import {
  canvasWindowRectsAreNear,
  planConversationCanvasWindow,
} from "./conversationCanvasWindow.ts";

const workArea = { height: 1100, width: 2200, x: 0, y: 24 };

test("keeps the left edge fixed when the display has room on the right", () => {
  const plan = planConversationCanvasWindow({
    current: { height: 820, width: 1080, x: 80, y: 100 },
    workArea,
  });

  assert.deepEqual(plan, {
    mode: "expanded",
    target: { height: 820, width: 1800, x: 80, y: 100 },
  });
});

test("shifts left only by the unavailable part of the requested expansion", () => {
  const plan = planConversationCanvasWindow({
    current: { height: 820, width: 1080, x: 980, y: 100 },
    workArea,
  });

  assert.equal(plan.mode, "expanded");
  assert.equal(plan.target.width, 1800);
  assert.equal(plan.target.x, 392);
});

test("uses a contained presentation when expansion would be too narrow", () => {
  const current = { height: 820, width: 1120, x: 152, y: 80 };
  assert.deepEqual(
    planConversationCanvasWindow({
      current,
      workArea: { height: 900, width: 1440, x: 0, y: 24 },
    }),
    { mode: "contained", target: current },
  );
});

test("uses focus mode when the work area cannot hold both readable planes", () => {
  const current = { height: 760, width: 940, x: 30, y: 40 };
  assert.deepEqual(
    planConversationCanvasWindow({
      current,
      workArea: { height: 820, width: 1000, x: 0, y: 24 },
    }),
    { mode: "focus", target: current },
  );
});

test("does not resize maximized or fullscreen windows", () => {
  const current = { height: 980, width: 1800, x: 0, y: 24 };
  assert.deepEqual(
    planConversationCanvasWindow({ current, maximized: true, workArea }),
    { mode: "contained", target: current },
  );
  assert.deepEqual(
    planConversationCanvasWindow({ current, fullscreen: true, workArea }),
    { mode: "contained", target: current },
  );
});

test("geometry comparison tolerates native frame rounding", () => {
  const rect = { height: 800, width: 1600, x: 20, y: 40 };
  assert.equal(
    canvasWindowRectsAreNear(rect, {
      height: 798,
      width: 1604,
      x: 21,
      y: 40,
    }),
    true,
  );
  assert.equal(canvasWindowRectsAreNear(rect, { ...rect, width: 1640 }), false);
});
