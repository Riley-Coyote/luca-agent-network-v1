import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GROWING_TAIL_FOLLOW_INTERVAL_MS,
  GrowingTimelineTailScheduler,
} from "./growingTimelineTailScheduler.ts";

function fakeClock() {
  let now = 0;
  let nextHandle = 1;
  const frames = new Map();
  const timers = new Map();
  const clock = {
    cancelAnimationFrame: (handle) => frames.delete(handle),
    clearTimeout: (handle) => timers.delete(handle),
    now: () => now,
    requestAnimationFrame: (callback) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    setTimeout: (callback, delayMs) => {
      const handle = nextHandle++;
      timers.set(handle, { at: now + delayMs, callback });
      return handle;
    },
  };
  return {
    clock,
    frameCount: () => frames.size,
    runFrames() {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(now);
    },
    tick(ms) {
      now += ms;
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= now);
      for (const [handle, timer] of due) {
        timers.delete(handle);
        timer.callback();
      }
    },
    timerCount: () => timers.size,
  };
}

describe("GrowingTimelineTailScheduler", () => {
  it("coalesces resize bursts into one frame-aligned follow", () => {
    const harness = fakeClock();
    let follows = 0;
    const scheduler = new GrowingTimelineTailScheduler(() => {
      follows += 1;
    }, harness.clock);

    for (let index = 0; index < 20; index += 1) scheduler.request();
    assert.equal(harness.frameCount(), 1);
    harness.runFrames();
    assert.equal(follows, 1);
  });

  it("caps follow writes at the 25 Hz presentation boundary", () => {
    const harness = fakeClock();
    let follows = 0;
    const scheduler = new GrowingTimelineTailScheduler(() => {
      follows += 1;
    }, harness.clock);

    scheduler.request();
    harness.runFrames();
    scheduler.request();
    assert.equal(harness.timerCount(), 1);
    assert.equal(harness.frameCount(), 0);

    harness.tick(GROWING_TAIL_FOLLOW_INTERVAL_MS - 1);
    assert.equal(harness.frameCount(), 0);
    harness.tick(1);
    assert.equal(harness.frameCount(), 1);
    harness.runFrames();
    assert.equal(follows, 2);
  });

  it("retires every pending write as soon as the reader leaves the tail", () => {
    const harness = fakeClock();
    let follows = 0;
    const scheduler = new GrowingTimelineTailScheduler(() => {
      follows += 1;
    }, harness.clock);

    scheduler.request();
    scheduler.setEnabled(false);
    harness.runFrames();
    harness.tick(GROWING_TAIL_FOLLOW_INTERVAL_MS);
    assert.equal(follows, 0);

    scheduler.setEnabled(true);
    scheduler.request();
    harness.runFrames();
    assert.equal(follows, 1);
    scheduler.request();
    assert.equal(harness.timerCount(), 1);
    scheduler.dispose();
    assert.equal(harness.timerCount(), 0);
  });
});
