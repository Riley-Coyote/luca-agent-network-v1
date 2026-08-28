import assert from "node:assert/strict";
import test from "node:test";

import {
  getRuntimeSessionContextGeneration,
  readRuntimeSessionContextHandoff,
  resetRuntimeSessionContextHandoff,
  runtimeSessionContextMatchesScope,
  stageRuntimeSessionContext,
} from "./runtimeSessionHandoff.ts";

const context = {
  runtimeId: "codex",
  runtimeLabel: "Codex",
  sessionId: "session-safe",
  title: "Checkpoint plan",
  summary: "Visible bounded context.",
  visibleMessageCount: 2,
  updatedAt: null,
};

test("community reset invalidates late context staging without resurrection", () => {
  resetRuntimeSessionContextHandoff();
  const communityA = {
    communityId: "community-a",
    ownerPubkey: "ABCD",
    relayUrl: "wss://relay-a.example",
  };
  const communityB = {
    communityId: "community-b",
    ownerPubkey: "abcd",
    relayUrl: "wss://relay-a.example",
  };
  const requestGeneration = getRuntimeSessionContextGeneration();

  assert.equal(
    stageRuntimeSessionContext({ ...communityA, context }, requestGeneration),
    true,
  );
  const staged = readRuntimeSessionContextHandoff();
  assert.ok(staged);
  assert.equal(runtimeSessionContextMatchesScope(staged, communityA), true);
  assert.equal(runtimeSessionContextMatchesScope(staged, communityB), false);

  resetRuntimeSessionContextHandoff();
  assert.equal(readRuntimeSessionContextHandoff(), null);
  assert.equal(
    stageRuntimeSessionContext({ ...communityA, context }, requestGeneration),
    false,
  );
  assert.equal(readRuntimeSessionContextHandoff(), null);
});
