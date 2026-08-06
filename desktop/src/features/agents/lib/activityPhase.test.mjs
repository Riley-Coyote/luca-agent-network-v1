import assert from "node:assert/strict";
import test from "node:test";

import {
  activityLabel,
  deriveActivity,
  visualStateForActivity,
} from "./activityPhase.ts";

const frame = (update, kind = "acp_read") => ({
  seq: 1,
  timestamp: "2026-08-05T12:00:00.000Z",
  kind,
  agentIndex: 0,
  channelId: "c1",
  sessionId: "s1",
  turnId: "t1",
  payload: { method: "session/update", params: { update } },
});

test("thought chunks read as thinking", () => {
  assert.deepEqual(
    deriveActivity(frame({ sessionUpdate: "agent_thought_chunk" })),
    {
      phase: "thinking",
      toolKind: null,
    },
  );
});

test("message chunks read as responding", () => {
  assert.deepEqual(
    deriveActivity(frame({ sessionUpdate: "agent_message_chunk" })),
    { phase: "responding", toolKind: null },
  );
});

test("a tool call carries its kind, never its arguments", () => {
  const activity = deriveActivity(
    frame({
      sessionUpdate: "tool_call",
      kind: "execute",
      title: "grep -r SECRET /etc",
      rawInput: { command: "grep -r SECRET /etc" },
    }),
  );
  assert.deepEqual(activity, { phase: "working", toolKind: "execute" });
  // The label is what reaches a shared room. It must never carry the command.
  const label = activityLabel(activity);
  assert.equal(label, "running a shell command");
  assert.equal(label.includes("SECRET"), false);
  assert.equal(label.includes("grep"), false);
});

test("a completed tool call stops reporting work", () => {
  // Otherwise the mark sticks on a finished call and the resident looks busy
  // after they have gone quiet.
  for (const status of ["completed", "failed"]) {
    assert.equal(
      deriveActivity(frame({ sessionUpdate: "tool_call_update", status })),
      null,
    );
  }
  assert.deepEqual(
    deriveActivity(
      frame({
        sessionUpdate: "tool_call_update",
        status: "in_progress",
        kind: "read",
      }),
    ),
    { phase: "working", toolKind: "read" },
  );
});

test("non-ACP and malformed frames derive nothing rather than throwing", () => {
  assert.equal(
    deriveActivity(frame({ sessionUpdate: "x" }, "turn_liveness")),
    null,
  );
  assert.equal(deriveActivity(frame({ sessionUpdate: "unknown_kind" })), null);
  assert.equal(deriveActivity({ ...frame({}), payload: null }), null);
  assert.equal(
    deriveActivity({ ...frame({}), payload: "not an object" }),
    null,
  );
  assert.equal(
    deriveActivity({ ...frame({}), payload: { method: "session/new" } }),
    null,
  );
});

test("every phase maps to a distinct scene state", () => {
  const states = ["thinking", "working", "responding"].map((phase) =>
    visualStateForActivity({ phase, toolKind: null }),
  );
  assert.deepEqual(states, ["thinking", "working", "responding"]);
  assert.equal(new Set(states).size, 3);
  assert.equal(visualStateForActivity(null), "present");
});

test("an unknown tool kind falls back to the phase, never a raw identifier", () => {
  assert.equal(
    activityLabel({ phase: "working", toolKind: "some_internal_tool_v2" }),
    "working",
  );
  assert.equal(activityLabel({ phase: "working", toolKind: null }), "working");
  assert.equal(activityLabel(null), "");
});

test("tool kinds are matched case-insensitively", () => {
  assert.equal(
    activityLabel({ phase: "working", toolKind: "SEARCH" }),
    "searching",
  );
});
