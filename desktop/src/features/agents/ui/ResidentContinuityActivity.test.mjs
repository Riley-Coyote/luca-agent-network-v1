import assert from "node:assert/strict";
import test from "node:test";

import { continuityActivityPresentation } from "./ResidentContinuityActivity.tsx";

function activity(overrides = {}) {
  return {
    enabled: true,
    availability: "ready",
    job: {
      jobId: "job-one",
      state: "completed",
      lastErrorCode: null,
      updatedAt: "2026-08-05T12:00:00.000Z",
      canRetry: false,
    },
    ...overrides,
  };
}

test("continuity activity exposes only compact body-free states", () => {
  assert.deepEqual(
    continuityActivityPresentation(
      activity({ job: { ...activity().job, state: "running" } }),
      true,
    ),
    { label: "Updating handoff", tone: "active" },
  );
  assert.deepEqual(
    continuityActivityPresentation(
      activity({ job: { ...activity().job, state: "failed" } }),
      true,
    ),
    { label: "Handoff needs attention", tone: "fault" },
  );
});

test("chat hides old completed handoffs while Activity keeps the status", () => {
  const now = Date.parse("2026-08-05T12:02:00.000Z");
  assert.equal(continuityActivityPresentation(activity(), true, now), null);
  assert.deepEqual(continuityActivityPresentation(activity(), false, now), {
    label: "Handoff updated",
    tone: "quiet",
  });
});

test("disabled continuity produces no activity indicator", () => {
  assert.equal(
    continuityActivityPresentation(activity({ enabled: false }), false),
    null,
  );
});
