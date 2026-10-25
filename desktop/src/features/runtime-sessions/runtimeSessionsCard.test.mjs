import assert from "node:assert/strict";
import test from "node:test";

import {
  CONVERSATION_MIN_REM,
  OPEN_WAIT_MAX_MS,
  QUIET_FRAME_MS,
  railStepsAside,
  whenFramesFlow,
} from "./runtimeSessionsCard.ts";

// Beside the open rail the conversation's card rests at 44 + 220 + 4 + the
// runtime card (22 rem) + 4; the window's edge is 6.
const besideOpenRail = (rem) => 44 + 220 + 4 + 22 * rem + 4;

test("the conversation's card keeps 24 rem beside the runtime card", () => {
  assert.equal(CONVERSATION_MIN_REM, 24);
});

test("the smallest window (800) asks the rail to step aside", () => {
  // 800 - 6 - 624 leaves 170, under 384.
  assert.equal(
    railStepsAside({
      conversationLeft: besideOpenRail(16),
      rem: 16,
      viewportWidth: 800,
    }),
    true,
  );
});

test("1024 and 1440 leave the rail where it is", () => {
  for (const viewportWidth of [1024, 1440]) {
    assert.equal(
      railStepsAside({
        conversationLeft: besideOpenRail(16),
        rem: 16,
        viewportWidth,
      }),
      false,
    );
  }
});

test("the minimum follows the text size", () => {
  // At 150% the card is 528 and the minimum 576: 1440 leaves 1440-6-800 = 634.
  assert.equal(
    railStepsAside({
      conversationLeft: besideOpenRail(24),
      rem: 24,
      viewportWidth: 1440,
    }),
    false,
  );
  // 1300 leaves 494, under 576.
  assert.equal(
    railStepsAside({
      conversationLeft: besideOpenRail(24),
      rem: 24,
      viewportWidth: 1300,
    }),
    true,
  );
});

/** A frame clock driven by hand: each `frame(at)` runs the requested step. */
function fakeClock() {
  let pending = null;
  let now = 0;
  let next = 1;
  return {
    clock: {
      request: (step) => {
        pending = step;
        return next++;
      },
      cancel: () => {
        pending = null;
      },
      now: () => now,
    },
    frame(at) {
      now = at;
      const step = pending;
      pending = null;
      step?.(at);
    },
    waiting: () => pending !== null,
  };
}

test("it waits through a long frame and opens on the first steady one", () => {
  const { clock, frame } = fakeClock();
  let opened = 0;
  whenFramesFlow(() => {
    opened += 1;
  }, clock);
  frame(16); // the commit's frame
  frame(110); // the route's long task
  assert.equal(opened, 0);
  frame(110 + QUIET_FRAME_MS - 1); // steady again
  assert.equal(opened, 1);
});

test("it never opens on the first frame alone", () => {
  const { clock, frame } = fakeClock();
  let opened = 0;
  whenFramesFlow(() => {
    opened += 1;
  }, clock);
  frame(1);
  assert.equal(opened, 0);
  frame(9);
  assert.equal(opened, 1);
});

test("it opens anyway once the wait runs out", () => {
  const { clock, frame } = fakeClock();
  let opened = 0;
  whenFramesFlow(() => {
    opened += 1;
  }, clock);
  for (let at = 40; at < OPEN_WAIT_MAX_MS; at += 40) frame(at);
  assert.equal(opened, 0);
  frame(OPEN_WAIT_MAX_MS + 10);
  assert.equal(opened, 1);
});

test("stopping the wait cancels the open", () => {
  const { clock, frame, waiting } = fakeClock();
  let opened = 0;
  const stop = whenFramesFlow(() => {
    opened += 1;
  }, clock);
  frame(16);
  stop();
  assert.equal(waiting(), false);
  frame(24);
  assert.equal(opened, 0);
});
