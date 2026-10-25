import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOSE,
  LEAD,
  MarkEngine,
  SWELL,
  Spring,
  STEP,
  slideMotions,
  sunk,
  TRAIL,
} from "./marks.ts";

// The engine wakes its clock on the browser's frames; these tests step it by
// hand (`advance`), so a frame request is only noted.
globalThis.requestAnimationFrame ??= () => 1;
globalThis.cancelAnimationFrame ??= () => {};

/** A layer that records the marks drawn on it. */
function fakeLayer() {
  const children = [];
  const layer = {
    children,
    ownerDocument: {
      createElement() {
        const el = {
          attributes: {},
          className: "",
          removed: false,
          style: {
            setProperty(name, value) {
              this[name] = value;
            },
          },
          remove() {
            el.removed = true;
            children.splice(children.indexOf(el), 1);
          },
          setAttribute(name, value) {
            el.attributes[name] = value;
          },
        };
        return el;
      },
    },
    append(el) {
      children.push(el);
    },
  };
  return layer;
}

function engineOf({ reduce = false, scale = 2 } = {}) {
  const layer = fakeLayer();
  const engine = new MarkEngine(layer, {
    reduceMotion: () => reduce,
    scale: () => scale,
  });
  return { engine, group: engine.group("luca-mark"), layer };
}

/** Frames of 1/60 s until nothing moves, each frame's drawn box noted. */
function run(engine, layer, { frames = 600, frame = 1 / 60 } = {}) {
  const drawn = [];
  for (let index = 0; index < frames; index += 1) {
    const moving = engine.advance(frame);
    drawn.push(layer.children.map((el) => boxOf(el)));
    if (!moving) break;
  }
  return drawn;
}

function boxOf(el) {
  const [x, y] = ((el.style.transform ?? "").match(/-?[\d.]+/g) ?? []).map(
    Number,
  );
  return {
    x,
    y,
    w: Number.parseFloat(el.style.width),
    h: Number.parseFloat(el.style.height),
    visible: el.style.visibility === "visible",
    wet: Number.parseFloat(el.style["--wet"] ?? "0"),
  };
}

/** Seconds a spring takes to come to rest from `distance` away. */
function settleTime(motion, distance) {
  const spring = new Spring(0);
  spring.motion = motion;
  spring.to = distance;
  let t = 0;
  while (!spring.resting && t < 5) {
    spring.step(STEP);
    t += STEP;
  }
  return t;
}

test("springs_settleOnTheHouseTimings", () => {
  // From 300 points away, each motion comes to rest well inside a second,
  // the trailing edge after the leading one.
  const lead = settleTime(LEAD, 300);
  const trail = settleTime(TRAIL, 300);
  const close = settleTime(CLOSE, 300);
  const swell = settleTime(SWELL, 300);
  for (const t of [lead, trail, close, swell]) {
    assert.ok(t > 0.2 && t < 1.2, `settles in ${t.toFixed(3)} s`);
  }
  assert.ok(trail > lead, "the trailing edge rests after the leading one");
});

test("springs_leadingEdgeOvershootsALittle_closeBarelyDoes", () => {
  const peak = (motion) => {
    const spring = new Spring(0);
    spring.motion = motion;
    spring.to = 100;
    let max = 0;
    for (let t = 0; t < 2; t += STEP) {
      spring.step(STEP);
      max = Math.max(max, spring.x);
    }
    return max - 100;
  };
  assert.ok(peak(LEAD) > 0.05 && peak(LEAD) < 3, "a small settle");
  assert.ok(peak(CLOSE) < 0.05, "closing does not bounce");
});

test("slideMotions_theEdgeFacingTheMoveLeads", () => {
  const from = { x: 0, y: 0, w: 28, h: 28 };
  const down = slideMotions(from, { x: 0, y: 200, w: 28, h: 28 });
  assert.deepEqual(down, [TRAIL, TRAIL, TRAIL, LEAD]);
  const up = slideMotions({ x: 0, y: 200, w: 28, h: 28 }, from);
  assert.deepEqual(up, [TRAIL, LEAD, TRAIL, TRAIL]);
});

test("sunk_isAPointAtTheMiddle", () => {
  assert.deepEqual(sunk({ x: 10, y: 20, w: 30, h: 40 }), {
    x: 25,
    y: 40,
    w: 0,
    h: 0,
  });
});

test("firstMark_isSimplyThere", () => {
  const { engine, group, layer } = engineOf();
  group.show("a", { x: 8, y: 119, w: 28, h: 28 });
  assert.equal(layer.children.length, 1);
  assert.deepEqual(boxOf(layer.children[0]), {
    x: 8,
    y: 119,
    w: 28,
    h: 28,
    visible: true,
    wet: 0,
  });
  assert.equal(layer.children[0].attributes["aria-hidden"], "true");
  assert.equal(engine.advance(1 / 60), false, "nothing to move");
});

test("slide_stretchesOnTheWay_andSettlesOnWholeDevicePixels", () => {
  const { engine, group, layer } = engineOf({ scale: 2 });
  group.show("luca", { x: 0, y: 6, w: 208, h: 30 });
  group.show("design", { x: 0, y: 460.3, w: 208, h: 30 });
  const drawn = run(engine, layer).map((frame) => frame[0]);
  const tallest = Math.max(...drawn.map((box) => box.h));
  assert.ok(tallest > 60, `stretched to ${tallest.toFixed(1)}`);
  // Moving, the light catches it a little.
  assert.ok(Math.max(...drawn.map((box) => box.wet)) > 0.2);
  const last = drawn.at(-1);
  // 460.3 at 2 device pixels per point rests at 460.5.
  assert.deepEqual(last, {
    x: 0,
    y: 460.5,
    w: 208,
    h: 30,
    visible: true,
    wet: 0,
  });
  for (const value of [last.x, last.y, last.w, last.h]) {
    assert.equal(Number.isInteger(value * 2), true, `${value} on a pixel`);
  }
  // In place in under a second for a move of 450 points (its light then
  // dries over a few more).
  const landed = drawn.findIndex((box) => box.y === last.y && box.h === last.h);
  assert.ok(landed > 0 && landed < 60, `landed after ${landed} frames`);
});

test("askedAgainMidSlide_theSlideGoesOnAsItWas", () => {
  // The page draws again while the mark slides (another render, a resize
  // with nothing moved): the leading edge still leads, so it still stretches.
  const once = engineOf();
  once.group.show("a", { x: 8, y: 119, w: 28, h: 28 });
  once.group.show("b", { x: 8, y: 289, w: 28, h: 28 });
  const asked = engineOf();
  asked.group.show("a", { x: 8, y: 119, w: 28, h: 28 });
  asked.group.show("b", { x: 8, y: 289, w: 28, h: 28 });
  const heights = [[], []];
  for (let index = 0; index < 40; index += 1) {
    once.engine.advance(1 / 60);
    asked.group.show("b", { x: 8, y: 289, w: 28, h: 28 });
    asked.engine.advance(1 / 60);
    heights[0].push(boxOf(once.layer.children[0]).h);
    heights[1].push(boxOf(asked.layer.children[0]).h);
  }
  assert.deepEqual(heights[1], heights[0]);
  assert.ok(Math.max(...heights[1]) > 36, "it stretches on the way");
});

test("slide_leadingEdgeArrivesFirst", () => {
  const { engine, group, layer } = engineOf();
  group.show("a", { x: 0, y: 0, w: 28, h: 28 });
  group.show("b", { x: 0, y: 300, w: 28, h: 28 });
  // A fifth of a second in, the bottom (facing the move) is further along
  // its way than the top.
  for (let index = 0; index < 12; index += 1) engine.advance(1 / 60);
  const box = boxOf(layer.children[0]);
  const bottomShare = (box.y + box.h - 28) / 300;
  const topShare = box.y / 300;
  assert.ok(bottomShare > topShare + 0.05, `${bottomShare} vs ${topShare}`);
});

test("gone_closesToAPointAtItsMiddle_thenIsRemoved", () => {
  const { engine, group, layer } = engineOf();
  group.show("a", { x: 6, y: 6, w: 208, h: 30 });
  group.show(null, null);
  const drawn = run(engine, layer);
  const sizes = drawn
    .filter((frame) => frame.length > 0 && frame[0].visible)
    .map(([box]) => box);
  assert.ok(sizes.length > 3, "it closes over several frames");
  for (const box of sizes) {
    // Always centred on the middle it closes into.
    assert.ok(Math.abs(box.x + box.w / 2 - 110) < 0.5);
    assert.ok(Math.abs(box.y + box.h / 2 - 21) < 0.5);
  }
  for (let index = 1; index < sizes.length; index += 1) {
    assert.ok(sizes[index].w <= sizes[index - 1].w + 0.01, "only narrows");
  }
  assert.equal(layer.children.length, 0, "gone once closed");
  assert.equal(group.count, 0);
});

test("back_swellsFromAPoint", () => {
  const { engine, group, layer } = engineOf();
  group.show("a", { x: 6, y: 6, w: 208, h: 30 });
  group.show(null, null);
  run(engine, layer);
  group.show("a", { x: 6, y: 6, w: 208, h: 30 });
  const first = boxOf(layer.children[0]);
  assert.equal(first.visible, false, "a point is not drawn");
  engine.advance(1 / 60);
  const early = boxOf(layer.children[0]);
  assert.ok(early.w > 0 && early.w < 208);
  assert.ok(Math.abs(early.x + early.w / 2 - 110) < 0.5);
  const last = run(engine, layer).at(-1)[0];
  assert.deepEqual([last.x, last.y, last.w, last.h], [6, 6, 208, 30]);
});

test("sameMarkMoved_followsAtOnce", () => {
  const { engine, group, layer } = engineOf();
  group.show("a", { x: 6, y: 100, w: 208, h: 30 });
  // A section opened above it: the same row, lower, on the next frame.
  group.show("a", { x: 6, y: 160, w: 208, h: 30 });
  assert.equal(engine.advance(1 / 60), false);
  assert.deepEqual(boxOf(layer.children[0]), {
    x: 6,
    y: 160,
    w: 208,
    h: 30,
    visible: true,
    wet: 0,
  });
});

test("reduceMotion_everyMarkIsWhereItBelongs", () => {
  const { engine, group, layer } = engineOf({ reduce: true });
  group.show("a", { x: 8, y: 119, w: 28, h: 28 });
  group.show("b", { x: 8, y: 255, w: 28, h: 28 });
  assert.equal(engine.advance(1 / 60), false, "nothing travels");
  assert.deepEqual(boxOf(layer.children[0]), {
    x: 8,
    y: 255,
    w: 28,
    h: 28,
    visible: true,
    wet: 0,
  });
  group.show(null, null);
  assert.equal(layer.children.length, 0, "gone at once");
  group.show("a", { x: 8, y: 119, w: 28, h: 28 });
  assert.equal(boxOf(layer.children[0]).w, 28, "back at once, whole");
});

test("aLongFrame_isSteppedAsAtMostAThirtiethOfASecond", () => {
  const { engine, group, layer } = engineOf();
  group.show("a", { x: 0, y: 0, w: 28, h: 28 });
  group.show("b", { x: 0, y: 600, w: 28, h: 28 });
  engine.advance(5);
  const box = boxOf(layer.children[0]);
  assert.ok(box.y < 100, `a stalled frame does not jump (${box.y})`);
});

test("clear_removesEveryPiece", () => {
  const { engine, group, layer } = engineOf();
  group.show("a", { x: 0, y: 0, w: 28, h: 28 });
  group.show(null, null);
  group.show("b", { x: 0, y: 60, w: 28, h: 28 });
  assert.equal(layer.children.length, 2, "one closing, one swelling");
  engine.stop();
  assert.equal(layer.children.length, 0);
});
