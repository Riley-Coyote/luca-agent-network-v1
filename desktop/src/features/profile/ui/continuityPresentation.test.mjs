import assert from "node:assert/strict";
import test from "node:test";

import {
  handoffFailureDetail,
  handoffJobLabel,
  savedHandoffPresentation,
} from "./continuityPresentation.ts";

test("capacity failures are distinct from invalid handoffs", () => {
  const data = inspector({
    job: { state: "failed", lastErrorCode: "continuity_capacity_exhausted" },
  });
  assert.equal(handoffJobLabel(data), "Storage limit reached");
  assert.match(handoffFailureDetail(data), /Saved memories are intact/);
  assert.doesNotMatch(handoffFailureDetail(data), /invalid|authenticated/);
});

function inspector(overrides = {}) {
  return {
    enabled: true,
    availability: "empty",
    handoff: null,
    job: null,
    ...overrides,
  };
}

test("a stored handoff is described as saved, not loaded", () => {
  const copy = savedHandoffPresentation(
    inspector({ availability: "ready", handoff: { summary: "Private" } }),
  );
  assert.equal(copy.label, "Saved");
  assert.match(copy.detail, /specific turn's context receipt/);
  assert.doesNotMatch(copy.detail, /was loaded|is current|runtime used/);
  assert.doesNotMatch(JSON.stringify(copy), /Private/);
});

test("off and unavailable handoffs remain separate from messaging", () => {
  for (const state of [
    inspector({ enabled: false }),
    inspector({ availability: "locked" }),
    inspector({ availability: "unavailable" }),
    inspector({ availability: "invalid" }),
    null,
  ]) {
    const copy = savedHandoffPresentation(state);
    assert.match(copy.detail, /Messaging still works/);
    assert.match(copy.empty, /Messaging still works/);
  }
  assert.match(
    savedHandoffPresentation(inspector({ enabled: false })).detail,
    /injection are off/,
  );
});

test("save-job labels report only the latest job state", () => {
  assert.equal(handoffJobLabel(null), "Job status unavailable");
  assert.equal(handoffJobLabel(inspector()), "No save job");
  for (const state of ["pending", "running"]) {
    assert.equal(
      handoffJobLabel(inspector({ job: { state } })),
      "Saving handoff",
    );
  }
  assert.equal(
    handoffJobLabel(inspector({ job: { state: "failed" } })),
    "Save failed",
  );
  assert.equal(
    handoffJobLabel(inspector({ job: { state: "completed" } })),
    "Latest save completed",
  );
});
