import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runtimeTaskAction,
  runtimeTaskVisible,
} from "./runtimeTaskPresentation.ts";

describe("runtime task presentation", () => {
  it("routes only controls owned by the exact root state", () => {
    assert.equal(
      runtimeTaskAction({ state: "active", canRetry: false }),
      "stop",
    );
    assert.equal(
      runtimeTaskAction({ state: "failed", canRetry: true }),
      "retry",
    );
    assert.equal(
      runtimeTaskAction({ state: "interrupted", canRetry: false }),
      "dismiss",
    );
    assert.equal(
      runtimeTaskAction({ state: "succeeded", canRetry: false }),
      null,
    );
  });

  it("retires success after four seconds and never leaves stopped work active", () => {
    const now = Date.parse("2026-09-01T12:00:04.000Z");
    const base = {
      taskId: "task-1",
      state: "succeeded",
      completedAt: "2026-09-01T12:00:00.001Z",
    };
    assert.equal(runtimeTaskVisible(base, new Set(), now), true);
    assert.equal(
      runtimeTaskVisible(
        { ...base, completedAt: "2026-09-01T12:00:00.000Z" },
        new Set(),
        now,
      ),
      false,
    );
    assert.equal(
      runtimeTaskVisible({ ...base, state: "stopped" }, new Set(), now),
      false,
    );
    assert.equal(runtimeTaskVisible(base, new Set(["task-1"]), now), false);
  });
});
