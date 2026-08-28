import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeSessionContextEnvelope,
  indexedRuntimeId,
  installedRuntimeConnections,
  isRuntimeSessionStartCurrent,
  runtimeSessionActionLabel,
} from "./runtimeSessionModel.ts";

function runtime(runtimeId, executable) {
  return {
    runtimeId,
    label: runtimeId,
    executable,
    version: null,
    readiness: executable ? "ready" : "unavailable",
    authentication: "ready",
    lastVerifiedAt: null,
    reason: null,
  };
}

test("the rail includes only installed runtimes and prioritizes Codex and Claude", () => {
  const presented = installedRuntimeConnections([
    runtime("openclaw", "/bin/openclaw"),
    runtime("claude_code", "/bin/claude"),
    runtime("hermes", null),
    runtime("codex", "/bin/codex"),
  ]);

  assert.deepEqual(
    presented.map(({ runtimeId }) => runtimeId),
    ["codex", "claude_code", "openclaw"],
  );
  assert.equal(indexedRuntimeId("codex"), "codex");
  assert.equal(indexedRuntimeId("claude_code"), "claude_code");
  assert.equal(indexedRuntimeId("openclaw"), null);
});

test("the visible context envelope names the new-conversation boundary", () => {
  const envelope = buildRuntimeSessionContextEnvelope({
    runtimeId: "codex",
    runtimeLabel: "Codex",
    sessionId: "session-safe",
    title: "Checkpoint plan",
    summary: "2 visible messages were indexed.\n\n- Keep this bounded.",
    visibleMessageCount: 2,
    updatedAt: null,
  });

  assert.match(envelope, /Context from local Codex session/);
  assert.match(envelope, /Keep this bounded/);
  assert.match(envelope, /new Polyphonic conversation/);
  assert.match(envelope, /does not resume or synchronize the Codex session/);
});

test("late starts fail closed across unmount, runtime, request, and community changes", () => {
  const expected = {
    mounted: true,
    requestId: 4,
    runtimeKey: "codex",
    scopeKey: "community-a",
  };
  assert.equal(isRuntimeSessionStartCurrent(expected, expected), true);
  for (const changed of [
    { ...expected, mounted: false },
    { ...expected, requestId: 5 },
    { ...expected, runtimeKey: "claude-code" },
    { ...expected, scopeKey: "community-b" },
  ]) {
    assert.equal(isRuntimeSessionStartCurrent(expected, changed), false);
  }
});

test("session actions have unique title-derived accessible labels", () => {
  assert.equal(
    runtimeSessionActionLabel("Checkpoint plan", 1),
    "Start with this context: Checkpoint plan (1)",
  );
  assert.notEqual(
    runtimeSessionActionLabel("Checkpoint plan", 1),
    runtimeSessionActionLabel("Checkpoint plan", 2),
  );
});
