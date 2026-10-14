import assert from "node:assert/strict";
import test from "node:test";
import { createSmoothCornerScheduler } from "./smoothCornerScheduler.ts";

function harness() {
  const frames = new Map();
  let id = 0;
  const scheduler = createSmoothCornerScheduler(
    (callback) => {
      frames.set(++id, callback);
      return id;
    },
    (key) => frames.delete(key),
  );
  return {
    scheduler,
    frames,
    flush() {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback();
    },
  };
}

test("corner measurements precede all writes and share one frame", () => {
  const h = harness();
  const order = [];
  const a = () => {
    order.push("read a");
    return () => order.push("write a");
  };
  h.scheduler.schedule(a);
  h.scheduler.schedule(a);
  h.scheduler.schedule(() => {
    order.push("read b");
    return () => order.push("write b");
  });
  assert.equal(h.frames.size, 1);
  h.flush();
  assert.deepEqual(order, ["read a", "read b", "write a", "write b"]);
});

test("unmount cancels pending work without cancelling other surfaces", () => {
  const h = harness();
  const a = () => {
    assert.fail("unmounted surface measured");
  };
  let measured = false;
  const b = () => {
    measured = true;
  };
  h.scheduler.schedule(a);
  h.scheduler.schedule(b);
  h.scheduler.cancel(a);
  h.flush();
  assert.equal(measured, true);
  h.scheduler.schedule(a);
  h.scheduler.cancel(a);
  assert.equal(h.frames.size, 0);
});

test("changes arriving during a flush are deferred to the next frame", () => {
  const h = harness();
  const order = [];
  h.scheduler.schedule(() => {
    order.push("read");
    return () => {
      order.push("write");
      h.scheduler.schedule(() => {
        order.push("next read");
      });
    };
  });
  h.flush();
  assert.deepEqual(order, ["read", "write"]);
  assert.equal(h.frames.size, 1);
  h.flush();
  assert.deepEqual(order, ["read", "write", "next read"]);
});
