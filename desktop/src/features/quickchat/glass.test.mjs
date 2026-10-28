import assert from "node:assert/strict";
import test from "node:test";
import {
  DRAIN,
  GROW,
  isResting,
  LAUNCHER,
  markShown,
  PANEL_RADIUS,
  panelClip,
  risen,
  settle,
  shapeAt,
  stepSpring,
  wordsShown,
} from "./glass.ts";

const corner = { right: 1080, bottom: 700 };

test("the shape is a disc at the launcher, a capsule while only its width has grown, and the panel's corners once both have", () => {
  assert.deepEqual(shapeAt(corner, LAUNCHER, LAUNCHER), {
    x: 1034,
    y: 654,
    w: 46,
    h: 46,
    r: 23,
  });
  assert.equal(shapeAt(corner, 420, LAUNCHER).r, 23);
  assert.equal(shapeAt(corner, 420, 560).r, PANEL_RADIUS);
  const half = shapeAt(corner, 420, LAUNCHER + 20).r;
  assert.ok(half < 23 && half > PANEL_RADIUS);
  // The corner the launcher and the panel share never moves.
  for (const [w, h] of [
    [46, 46],
    [200, 46],
    [420, 300],
    [420, 560],
  ]) {
    const shape = shapeAt(corner, w, h);
    assert.equal(shape.x + shape.w, corner.right);
    assert.equal(shape.y + shape.h, corner.bottom);
  }
});

test("a spring arrives on its target at any frame rate and settles exactly", () => {
  for (const frame of [1 / 120, 1 / 60, 1 / 30]) {
    let spring = { value: 46, velocity: 0, target: 560 };
    let seconds = 0;
    while (!isResting(spring) && seconds < 3) {
      spring = stepSpring(spring, GROW, frame);
      seconds += frame;
    }
    assert.ok(isResting(spring), `rests within 3 s at ${frame}`);
    assert.ok(seconds < 1.2, `the grow spring takes ${seconds} s`);
    assert.deepEqual(settle(spring), { value: 560, velocity: 0, target: 560 });
  }
});

test("growing hardly overshoots, and draining home never does", () => {
  const peak = (spec, from, to) => {
    let spring = { value: from, velocity: 0, target: to };
    let furthest = from;
    for (let step = 0; step < 240; step += 1) {
      spring = stepSpring(spring, spec, 1 / 120);
      furthest =
        to > from
          ? Math.max(furthest, spring.value)
          : Math.min(furthest, spring.value);
    }
    return furthest;
  };
  assert.ok(peak(GROW, 46, 560) - 560 < 0.01 * (560 - 46));
  assert.ok(46 - peak(DRAIN, 560, 46) < 0.002 * (560 - 46));
});

test("the words come in once the window has mostly risen, and go first on the way home", () => {
  assert.equal(risen(LAUNCHER, 560), 0);
  assert.equal(risen(560, 560), 1);
  assert.equal(wordsShown(0.4, true), 0);
  assert.equal(wordsShown(1, true), 1);
  assert.ok(wordsShown(0.7, true) > 0 && wordsShown(0.7, true) < 1);
  // Closing, they are gone while the window is still nearly whole.
  assert.equal(wordsShown(0.8, false), 0);
  assert.equal(wordsShown(1, false), 1);
});

test("the launcher's mark leaves as the disc spreads and is back once it is home", () => {
  assert.equal(markShown(LAUNCHER, LAUNCHER), 1);
  assert.equal(markShown(LAUNCHER + 18, LAUNCHER), 0);
  assert.equal(markShown(420, 560), 0);
});

test("the panel is cut to the shape as an inset of its own box, never inside out", () => {
  const panel = { x: 660, y: 140, w: 420, h: 560 };
  assert.equal(
    panelClip(panel, shapeAt(corner, 420, 560)),
    "inset(0px 0px 0px 0px round 16px)",
  );
  assert.equal(
    panelClip(panel, shapeAt(corner, LAUNCHER, LAUNCHER)),
    "inset(514px 0px 0px 374px round 23px)",
  );
  // A spring's last hair past the panel clips nothing away.
  assert.equal(
    panelClip(panel, shapeAt(corner, 422, 561)),
    "inset(0px 0px 0px 0px round 16px)",
  );
});
