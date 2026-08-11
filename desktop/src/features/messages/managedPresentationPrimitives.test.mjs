import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  managedPresentationDrainQuota,
  segmentManagedPresentationText,
} from "./managedPresentationGraphemes.ts";
import { classifyManagedFinalReconciliation } from "./managedPresentationReconciliation.ts";
import {
  validManagedPresentationChunk,
  validManagedPresentationFrame,
} from "./managedPresentationProtocol.ts";
import {
  MANAGED_PRESENTATION_PAINT_INTERVAL_MS,
  ManagedPresentationScheduler,
} from "./managedPresentationScheduler.ts";

class FakeClock {
  animationFrames = new Map();
  currentTime = 0;
  nextHandle = 1;
  timers = new Map();

  api = {
    cancelAnimationFrame: (handle) => this.animationFrames.delete(handle),
    clearTimeout: (handle) => this.timers.delete(handle),
    now: () => this.currentTime,
    requestAnimationFrame: (callback) => {
      const handle = this.nextHandle++;
      this.animationFrames.set(handle, callback);
      return handle;
    },
    setTimeout: (callback, delay) => {
      const handle = this.nextHandle++;
      this.timers.set(handle, { at: this.currentTime + delay, callback });
      return handle;
    },
  };

  advance(milliseconds) {
    this.currentTime += milliseconds;
    let ranTimer = true;
    while (ranTimer) {
      ranTimer = false;
      for (const [handle, timer] of [...this.timers]) {
        if (timer.at > this.currentTime) continue;
        this.timers.delete(handle);
        timer.callback();
        ranTimer = true;
      }
    }
  }

  paint() {
    const frames = [...this.animationFrames.values()];
    this.animationFrames.clear();
    for (const callback of frames) callback(this.currentTime);
  }
}

describe("managed presentation primitives", () => {
  const validFrame = {
    protocol: "luca.managed.presentation.v1",
    kind: "phase",
    resident_pubkey: "11".repeat(32),
    conversation_id: "conversation-1",
    turn_id: "turn-1",
    dispatch_receipt_id: "receipt-1",
    session_epoch: 1,
    sequence: 2,
    phase: "working",
  };

  it("segments emoji and combining sequences as whole graphemes", () => {
    assert.deepEqual(segmentManagedPresentationText("A👨‍👩‍👧‍👦e\u0301"), [
      "A",
      "👨‍👩‍👧‍👦",
      "e\u0301",
    ]);
  });

  it("uses the specified adaptive quotas", () => {
    assert.equal(managedPresentationDrainQuota(1), 2);
    assert.equal(managedPresentationDrainQuota(16), 2);
    assert.equal(managedPresentationDrainQuota(17), 4);
    assert.equal(managedPresentationDrainQuota(34), 4);
    assert.equal(managedPresentationDrainQuota(35), 7);
  });

  it("classifies signed bodies exactly without trimming", () => {
    assert.equal(classifyManagedFinalReconciliation("same", "same"), "equal");
    assert.equal(
      classifyManagedFinalReconciliation("same", "same plus"),
      "signed_extends_stream",
    );
    assert.equal(
      classifyManagedFinalReconciliation("same plus", "same"),
      "stream_extends_signed",
    );
    assert.equal(
      classifyManagedFinalReconciliation("same ", "same"),
      "stream_extends_signed",
    );
    assert.equal(
      classifyManagedFinalReconciliation("alpha", "omega"),
      "divergent",
    );
  });

  it("fails malformed or oversized presentation payloads closed", () => {
    assert.equal(validManagedPresentationFrame(validFrame), true);
    assert.equal(
      validManagedPresentationFrame({
        ...validFrame,
        phase: "secret_reasoning",
      }),
      false,
    );
    assert.equal(
      validManagedPresentationFrame({
        ...validFrame,
        kind: "public_chunk",
        public_chunk: 42,
      }),
      false,
    );
    assert.equal(validManagedPresentationChunk("x".repeat(16 * 1024)), true);
    assert.equal(
      validManagedPresentationChunk("x".repeat(16 * 1024 + 1)),
      false,
    );
  });

  it("coalesces all requesters behind one 25Hz scheduler", () => {
    const clock = new FakeClock();
    let remaining = 2;
    let commits = 0;
    const scheduler = new ManagedPresentationScheduler(() => {
      commits += 1;
      remaining -= 1;
      return remaining > 0;
    }, clock.api);
    for (let index = 0; index < 8; index += 1) scheduler.requestPaint();
    assert.equal(clock.animationFrames.size, 1);
    clock.paint();
    assert.equal(commits, 1);
    assert.equal(clock.timers.size, 1);

    clock.advance(MANAGED_PRESENTATION_PAINT_INTERVAL_MS - 1);
    clock.paint();
    assert.equal(commits, 1);
    clock.advance(1);
    assert.equal(clock.animationFrames.size, 1);
    clock.paint();
    assert.equal(commits, 2);
    assert.equal(clock.timers.size, 0);
  });

  it("publishes bursty subscriber work at most once per 40ms boundary", () => {
    const clock = new FakeClock();
    let pendingChunks = 0;
    let publications = 0;
    const scheduler = new ManagedPresentationScheduler(() => {
      assert.ok(pendingChunks > 0);
      pendingChunks = 0;
      publications += 1;
      return false;
    }, clock.api);
    const ingestBurst = () => {
      for (let index = 0; index < 200; index += 1) {
        pendingChunks += 1;
        scheduler.requestPaint();
      }
    };

    ingestBurst();
    assert.equal(clock.animationFrames.size, 1);
    clock.paint();
    assert.equal(publications, 1);

    ingestBurst();
    assert.equal(clock.animationFrames.size, 0);
    assert.equal(clock.timers.size, 1);
    clock.advance(MANAGED_PRESENTATION_PAINT_INTERVAL_MS - 1);
    clock.paint();
    assert.equal(publications, 1);
    clock.advance(1);
    assert.equal(clock.animationFrames.size, 1);
    clock.paint();
    assert.equal(publications, 2);
  });

  it("owns only the nearest deadline timer and cancels it on reset", () => {
    const clock = new FakeClock();
    let deadlines = 0;
    const scheduler = new ManagedPresentationScheduler(() => false, clock.api);
    scheduler.setNearestDeadline(100, () => {
      deadlines += 1;
    });
    scheduler.setNearestDeadline(50, () => {
      deadlines += 1;
    });
    assert.equal(clock.timers.size, 1);
    clock.advance(49);
    assert.equal(deadlines, 0);
    clock.advance(1);
    assert.equal(deadlines, 1);
    scheduler.setNearestDeadline(100, () => {
      deadlines += 1;
    });
    scheduler.reset();
    assert.equal(clock.timers.size, 0);
  });
});
