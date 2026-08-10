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
    ),
    { label: "Saving continuity", tone: "active" },
  );
  assert.deepEqual(
    continuityActivityPresentation(
      activity({ job: { ...activity().job, state: "failed" } }),
    ),
    { label: "Continuity needs attention", tone: "fault" },
  );
});

test("Activity keeps a quiet status for completed continuity", () => {
  assert.deepEqual(continuityActivityPresentation(activity()), {
    label: "Continuity current",
    tone: "quiet",
  });
});

test("disabled continuity produces no activity indicator", () => {
  assert.equal(
    continuityActivityPresentation(activity({ enabled: false })),
    null,
  );
});
