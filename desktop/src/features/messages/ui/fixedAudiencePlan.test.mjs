import assert from "node:assert/strict";
import test from "node:test";
import { resolveFixedAudience } from "./fixedAudiencePlan.ts";
import {
  resolveCompleteSendPlan,
  shouldPrepareAgentReadiness,
} from "./completeSendPlan.ts";

const AGENT = "a".repeat(64);
test("ordinary composers retain their existing invitation and readiness paths", () => {
  assert.equal(resolveFixedAudience(undefined), undefined);
  assert.equal(
    resolveCompleteSendPlan({
      dmParticipantPubkeys: [AGENT],
      hasPrepareSendChannel: true,
      capturedChannelId: "source",
    }).branch,
    "invite-dm",
  );
  assert.equal(shouldPrepareAgentReadiness("ordinary"), true);
});
test("fixed audience never prepares an expanded conversation or wakes mentioned agents", () => {
  const recipients = resolveFixedAudience([AGENT.toUpperCase(), AGENT]);
  assert.deepEqual(recipients, [AGENT]);
  const plan = resolveCompleteSendPlan({
    dmParticipantPubkeys: ["b".repeat(64)],
    hasPrepareSendChannel: true,
    capturedChannelId: "source",
    fixedAudience: true,
  });
  assert.deepEqual(plan, { branch: "ordinary", sendChannelId: "source" });
  assert.equal(shouldPrepareAgentReadiness(plan.branch, true), false);
});
test("invalid or missing fixed recipients fail closed instead of falling back to mention routing", () => {
  assert.throws(() => resolveFixedAudience([]), /valid fixed recipient/);
  assert.throws(() => resolveFixedAudience(["Anima"]), /valid fixed recipient/);
});
