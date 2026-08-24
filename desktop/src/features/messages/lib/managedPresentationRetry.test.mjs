import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveManagedPresentationRetry } from "./managedPresentationRetry.ts";

const OWNER = "a".repeat(64);
const RESIDENT = "b".repeat(64);

function turn(overrides = {}) {
  return {
    anchorKey: "owner-event",
    anchorAt: 1,
    bufferedText: "",
    conversationId: "conversation",
    deadlineAt: null,
    dispatchReceiptId: "owner-event",
    durableReceiptId: "owner-event",
    failure: "runtime",
    finalMessageId: null,
    finalReconciliation: null,
    lastFrameAt: 1,
    phase: "failed",
    receivedText: "",
    residentPubkey: RESIDENT,
    responseSurface: "timeline",
    sequence: 3,
    sessionEpoch: 7,
    signedText: null,
    slotOrdinal: 0,
    turnId: "turn",
    uiKey: "managed:turn",
    visibleText: "Partial",
    ...overrides,
  };
}

function ownerMessage(overrides = {}) {
  return {
    author: "You",
    body: "Try the exact request again.",
    createdAt: 1,
    depth: 0,
    id: "owner-event",
    pubkey: OWNER,
    tags: [
      ["h", "conversation"],
      ["p", RESIDENT],
      ["imeta", "url https://example.invalid/file"],
      ["emoji", "wave", "https://example.invalid/wave.png"],
    ],
    time: "now",
    ...overrides,
  };
}

describe("resolveManagedPresentationRetry", () => {
  it("replays only the exact terminal resident and owner anchor", () => {
    assert.deepEqual(
      resolveManagedPresentationRetry({
        currentPubkey: OWNER.toUpperCase(),
        messages: [ownerMessage()],
        residentPubkey: RESIDENT.toUpperCase(),
        turn: turn(),
      }),
      {
        content: "Try the exact request again.",
        mediaTags: [
          ["imeta", "url https://example.invalid/file"],
          ["emoji", "wave", "https://example.invalid/wave.png"],
        ],
        residentPubkey: RESIDENT,
      },
    );
  });

  it("fails closed for a different resident, active turn, or missing anchor", () => {
    for (const candidate of [
      { residentPubkey: "c".repeat(64), turn: turn() },
      { residentPubkey: RESIDENT, turn: turn({ phase: "writing" }) },
      {
        residentPubkey: RESIDENT,
        turn: turn({ failure: null, phase: "needs_attention" }),
      },
      { residentPubkey: RESIDENT, turn: turn({ finalMessageId: "signed" }) },
    ]) {
      assert.equal(
        resolveManagedPresentationRetry({
          currentPubkey: OWNER,
          messages: [ownerMessage()],
          ...candidate,
        }),
        null,
      );
    }
    assert.equal(
      resolveManagedPresentationRetry({
        currentPubkey: OWNER,
        messages: [],
        residentPubkey: RESIDENT,
        turn: turn(),
      }),
      null,
    );
  });

  it("never forwards channel, recipient, or authority tags", () => {
    const retry = resolveManagedPresentationRetry({
      currentPubkey: OWNER,
      messages: [ownerMessage()],
      residentPubkey: RESIDENT,
      turn: turn(),
    });
    assert.deepEqual(
      retry?.mediaTags?.map((tag) => tag[0]),
      ["imeta", "emoji"],
    );
  });
});
