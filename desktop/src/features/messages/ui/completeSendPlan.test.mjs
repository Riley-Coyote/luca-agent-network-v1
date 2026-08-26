import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatAgentReadinessError,
  resolveCompleteSendPlan,
} from "./completeSendPlan.ts";

test("participants with a prepare hook take the invite-dm branch", () => {
  const plan = resolveCompleteSendPlan({
    dmParticipantPubkeys: ["ab".repeat(32)],
    hasPrepareSendChannel: true,
    capturedChannelId: "channel-1",
  });
  assert.equal(plan.branch, "invite-dm");
  assert.equal(plan.sendChannelId, null);
});

test("participants without a prepare hook stay ordinary", () => {
  const plan = resolveCompleteSendPlan({
    dmParticipantPubkeys: ["ab".repeat(32)],
    hasPrepareSendChannel: false,
    capturedChannelId: "channel-1",
  });
  assert.equal(plan.branch, "ordinary");
  assert.equal(plan.sendChannelId, "channel-1");
});

test("an ordinary send carries the captured channel id", () => {
  const plan = resolveCompleteSendPlan({
    dmParticipantPubkeys: [],
    hasPrepareSendChannel: true,
    capturedChannelId: "channel-2",
  });
  assert.equal(plan.branch, "ordinary");
  assert.equal(plan.sendChannelId, "channel-2");
});

test("an ordinary send with no captured channel resolves null", () => {
  const plan = resolveCompleteSendPlan({
    dmParticipantPubkeys: [],
    hasPrepareSendChannel: false,
    capturedChannelId: null,
  });
  assert.equal(plan.branch, "ordinary");
  assert.equal(plan.sendChannelId, null);
});

test("the readiness toast keeps its exact singular string", () => {
  assert.equal(
    formatAgentReadinessError(["Mara: Could not prepare agent."]),
    "Could not start agent mention: Mara: Could not prepare agent.",
  );
});

test("the readiness toast keeps its exact plural string", () => {
  assert.equal(
    formatAgentReadinessError(["one", "two"]),
    "Could not start agent mentions: one; two",
  );
});
