import assert from "node:assert/strict";
import test from "node:test";

import { residentDrawerPresentation } from "./residentDrawerPresentation.ts";

const conversationId = "room-a";
const residentPubkey = "AbCd";

function input(overrides = {}) {
  return {
    conversationId,
    residentPubkey,
    runtimeStatus: "running",
    managed: null,
    observer: null,
    working: null,
    permissions: [],
    traces: [],
    ...overrides,
  };
}

function managed(phase, overrides = {}) {
  return {
    conversationId,
    activity: new Map([
      [
        residentPubkey.toLowerCase(),
        {
          residentPubkey: residentPubkey.toLowerCase(),
          phase,
          failure: null,
          settled: false,
          uiKey: "dispatch-a",
          ...overrides,
        },
      ],
    ]),
  };
}

function permission(overrides = {}) {
  return {
    pendingId: "permission-a",
    request: {
      conversationId,
      residentPubkey,
      turnId: "turn-a",
      ...overrides,
    },
  };
}

function trace(status, overrides = {}) {
  return {
    conversationId,
    residentPubkey,
    dispatchReceiptId: "dispatch-a",
    turnId: "turn-a",
    startedAt: 100,
    status,
    ...overrides,
  };
}

test("a started process is not presented as ready, and absent status stays unknown", () => {
  assert.deepEqual(residentDrawerPresentation(input()), {
    label: "Started",
    mark: "present",
    replying: false,
  });
  assert.equal(
    residentDrawerPresentation(input({ runtimeStatus: "deployed" })).label,
    "Started",
  );
  assert.equal(
    residentDrawerPresentation(input({ runtimeStatus: "stopped" })).label,
    "Unavailable",
  );
  assert.equal(
    residentDrawerPresentation(input({ runtimeStatus: null })).label,
    "Status unknown",
  );
});

test("managed turn phases use one scoped resident and retain model lock while live", () => {
  for (const [phase, label, mark] of [
    ["thinking", "Preparing reply", "thinking"],
    ["working", "Working", "working"],
    ["writing", "Responding", "responding"],
    ["finalizing", "Finishing reply", "responding"],
  ]) {
    assert.deepEqual(
      residentDrawerPresentation(input({ managed: managed(phase) })),
      {
        label,
        mark,
        replying: true,
      },
    );
  }
  assert.equal(
    residentDrawerPresentation(
      input({ managed: { ...managed("working"), conversationId: "room-b" } }),
    ).label,
    "Started",
  );
  assert.equal(
    residentDrawerPresentation(
      input({ residentPubkey: "other", managed: managed("working") }),
    ).label,
    "Started",
  );
});

test("permission wait requires the exact conversation and resident", () => {
  assert.deepEqual(
    residentDrawerPresentation(
      input({ managed: managed("working"), permissions: [permission()] }),
    ),
    { label: "Waiting for permission", mark: "idle", replying: true },
  );
  for (const wrong of [
    permission({ conversationId: "room-b" }),
    permission({ residentPubkey: "other" }),
  ]) {
    assert.equal(
      residentDrawerPresentation(
        input({ managed: managed("working"), permissions: [wrong] }),
      ).label,
      "Working",
    );
  }
  assert.equal(
    residentDrawerPresentation(
      input({
        managed: managed("working", {
          dispatchReceiptId: "dispatch-b",
          uiKey: "dispatch-b",
        }),
        permissions: [permission()],
        traces: [trace("completed")],
      }),
    ).label,
    "Working",
  );
  assert.equal(
    residentDrawerPresentation(
      input({
        managed: managed("working"),
        permissions: [permission()],
        traces: [trace("working")],
      }),
    ).label,
    "Waiting for permission",
  );
});

test("observer and typing are scoped fallbacks, without invented inner phase", () => {
  const observer = {
    conversationId,
    activity: [
      { agentPubkey: residentPubkey, activity: { phase: "responding" } },
    ],
  };
  assert.equal(
    residentDrawerPresentation(input({ observer })).label,
    "Responding",
  );
  assert.equal(
    residentDrawerPresentation(
      input({ observer: { ...observer, conversationId: "room-b" } }),
    ).label,
    "Started",
  );
  assert.equal(
    residentDrawerPresentation(
      input({ working: { conversationId, pubkeys: [residentPubkey] } }),
    ).label,
    "Active in this conversation",
  );
});

test("published final and distinct terminal outcomes stay historical", () => {
  const cases = [
    ["completed", "Last turn completed", "present"],
    ["cancelled", "Last turn cancelled", "present"],
    ["failed", "Last turn failed", "fault"],
    ["interrupted", "Last turn interrupted", "unavailable"],
  ];
  for (const [status, label, mark] of cases) {
    assert.deepEqual(
      residentDrawerPresentation(input({ traces: [trace(status)] })),
      { label, mark, replying: false },
    );
  }
  assert.equal(
    residentDrawerPresentation(
      input({ traces: [trace("completed", { conversationId: "room-b" })] }),
    ).label,
    "Started",
  );
  assert.equal(
    residentDrawerPresentation(
      input({ traces: [trace("completed", { residentPubkey: "other" })] }),
    ).label,
    "Started",
  );
});

test("restored working traces cannot claim live work or mask a stopped runtime", () => {
  assert.deepEqual(
    residentDrawerPresentation(input({ traces: [trace("working")] })),
    { label: "Started", mark: "present", replying: false },
  );
  assert.deepEqual(
    residentDrawerPresentation(
      input({
        runtimeStatus: "stopped",
        traces: [trace("working"), trace("completed", { startedAt: 200 })],
      }),
    ),
    { label: "Unavailable", mark: "unavailable", replying: false },
  );
  assert.equal(
    residentDrawerPresentation(
      input({
        runtimeStatus: "stopped",
        managed: managed("thinking"),
        permissions: [permission()],
      }),
    ).label,
    "Unavailable",
  );
  assert.equal(
    residentDrawerPresentation(
      input({ runtimeStatus: "stopped", managed: managed("waking") }),
    ).label,
    "Starting",
  );
});

test("a concurrent resident stays independent and terminal failure outranks lagging work", () => {
  const other = trace("working", {
    residentPubkey: "other",
    dispatchReceiptId: "dispatch-other",
    startedAt: 200,
  });
  assert.equal(
    residentDrawerPresentation(input({ traces: [trace("completed"), other] }))
      .label,
    "Last turn completed",
  );
  assert.deepEqual(
    residentDrawerPresentation(
      input({
        managed: managed("failed", { failure: "publication" }),
        permissions: [permission()],
        observer: {
          conversationId,
          activity: [
            { agentPubkey: residentPubkey, activity: { phase: "working" } },
          ],
        },
      }),
    ),
    { label: "Reply not published", mark: "fault", replying: false },
  );
  assert.deepEqual(
    residentDrawerPresentation(input({ managed: managed("stopped") })),
    { label: "Cancelled", mark: "present", replying: false },
  );
  assert.equal(
    residentDrawerPresentation(
      input({
        managed: managed("needs_attention", {
          dispatchReceiptId: "dispatch-a",
        }),
        traces: [trace("interrupted")],
      }),
    ).label,
    "Interrupted",
  );
  assert.equal(
    residentDrawerPresentation(
      input({
        managed: managed("needs_attention", {
          dispatchReceiptId: "dispatch-b",
        }),
        traces: [trace("interrupted")],
      }),
    ).label,
    "Needs attention",
  );
});
