import assert from "node:assert/strict";
import test from "node:test";

import { projectManagedTimelineMessages } from "./managedTimelineProjection.ts";

const pubkey = "a".repeat(64);

function message(id, createdAt, overrides = {}) {
  return {
    id,
    createdAt,
    author: "Riley",
    time: "10:00 PM",
    body: id,
    depth: 0,
    ...overrides,
  };
}

function turn(overrides = {}) {
  return {
    anchorAt: 2_000_000_000_000,
    conversationId: "room",
    dispatchReceiptId: "receipt",
    durableReceiptId: "receipt",
    failure: null,
    finalMessageId: null,
    finalReconciliation: null,
    lastFrameAt: 2_000_000_000_000,
    phase: "writing",
    receivedText: "hello",
    residentPubkey: pubkey,
    responseSurface: "timeline",
    sequence: 2,
    sessionEpoch: 1,
    slotOrdinal: 1,
    turnId: "turn",
    uiKey: `managed:${pubkey}:receipt`,
    visibleText: "hello",
    ...overrides,
  };
}

test("projects one stable managed row after its first-visible anchor", () => {
  const result = projectManagedTimelineMessages(
    [message("owner", 1_999_999_999), message("later", 2_000_000_001)],
    [turn()],
  );

  assert.deepEqual(
    result.messages.map((item) => item.id),
    ["owner", `managed:${pubkey}:receipt`, "later"],
  );
  assert.equal(result.messages[1].renderKey, `managed:${pubkey}:receipt`);
  assert.equal(result.messages[1].body, "hello");
});

test("hydrates a signed final in the same render slot without a duplicate", () => {
  const final = message("signed", 2_002, {
    author: "Luca",
    body: "hello",
    pubkey,
  });
  const result = projectManagedTimelineMessages(
    [message("owner", 1_999_999_999), final],
    [turn({ finalMessageId: "signed", phase: "finalizing" })],
  );

  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[1].id, "signed");
  assert.equal(result.messages[1].renderKey, `managed:${pubkey}:receipt`);
  assert.equal(result.messages[1].managedPresentation.finalMessageId, "signed");
  assert.equal(result.suppressedFinalMessageIds.has("signed"), true);
});

test("keeps thinking and thread-surface turns out of the main transcript", () => {
  const result = projectManagedTimelineMessages(
    [message("owner", 1_999_999_999)],
    [
      turn({ visibleText: "", phase: "thinking" }),
      turn({
        responseSurface: "thread",
        uiKey: `managed:${pubkey}:thread`,
      }),
    ],
  );

  assert.deepEqual(
    result.messages.map((item) => item.id),
    ["owner"],
  );
});

test("preserves visible partial text for stopped and failed rows", () => {
  const result = projectManagedTimelineMessages(
    [message("owner", 1_999_999_999)],
    [
      turn({ phase: "stopped", visibleText: "partial" }),
      turn({
        dispatchReceiptId: "failed",
        failure: "runtime",
        phase: "failed",
        slotOrdinal: 2,
        uiKey: `managed:${pubkey}:failed`,
        visibleText: "other partial",
      }),
    ],
  );

  assert.deepEqual(
    result.messages.slice(1).map((item) => item.body),
    ["partial", "other partial"],
  );
});
