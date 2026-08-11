import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  completeManagedPresentation,
  completeManagedPresentationForConversation,
  getManagedPresentationSnapshot,
  ingestManagedPresentationFrame,
  releaseManagedPresentationFinals,
  replaceManagedPresentationReceipt,
  resetManagedPresentationStore,
  seedManagedPresentations,
} from "./managedPresentationStore.ts";

const conversationId = "11111111-1111-4111-8111-111111111111";
const residentPubkey = "11".repeat(32);
const receiptId = "22".repeat(32);

function frame(kind, sequence, extra = {}) {
  return {
    protocol: "luca.managed.presentation.v1",
    kind,
    resident_pubkey: residentPubkey,
    conversation_id: conversationId,
    turn_id: "turn-1",
    dispatch_receipt_id: receiptId,
    session_epoch: 7,
    sequence,
    ...extra,
  };
}

afterEach(resetManagedPresentationStore);

describe("managedPresentationStore", () => {
  it("coalesces public chunks and preserves strict sequence", async () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(frame("phase", 2, { phase: "working" }));
    ingestManagedPresentationFrame(
      frame("public_chunk", 3, { public_chunk: "Hello" }),
    );
    ingestManagedPresentationFrame(
      frame("public_chunk", 5, { public_chunk: " ignored" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      getManagedPresentationSnapshot(conversationId)[0].publicText,
      "Hello",
    );
    assert.equal(getManagedPresentationSnapshot(conversationId)[0].sequence, 3);
  });

  it("handles signed-final-before-stream without leaving a duplicate", () => {
    completeManagedPresentation(residentPubkey, receiptId);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    assert.deepEqual(getManagedPresentationSnapshot(conversationId), []);
  });

  it("keeps the live row until its signed final reaches the rendered timeline", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    completeManagedPresentation(
      residentPubkey,
      receiptId,
      "signed-final-message",
    );

    const [settling] = getManagedPresentationSnapshot(conversationId);
    assert.equal(settling.phase, "finalizing");
    assert.equal(settling.finalMessageId, "signed-final-message");

    releaseManagedPresentationFinals(["different-message"]);
    assert.equal(getManagedPresentationSnapshot(conversationId).length, 1);
    releaseManagedPresentationFinals(["signed-final-message"]);
    assert.deepEqual(getManagedPresentationSnapshot(conversationId), []);
  });

  it("reconciles the only resident row when receipt replacement races the signed final", () => {
    const optimisticReceipt = "optimistic:directed-reply";
    seedManagedPresentations(conversationId, optimisticReceipt, [
      residentPubkey,
    ]);

    completeManagedPresentationForConversation(
      residentPubkey,
      receiptId,
      conversationId,
    );

    assert.deepEqual(getManagedPresentationSnapshot(conversationId), []);
  });

  it("does not guess between concurrent resident turns", () => {
    seedManagedPresentations(conversationId, "optimistic:first", [
      residentPubkey,
    ]);
    seedManagedPresentations(conversationId, "optimistic:second", [
      residentPubkey,
    ]);

    completeManagedPresentationForConversation(
      residentPubkey,
      receiptId,
      conversationId,
    );

    assert.equal(getManagedPresentationSnapshot(conversationId).length, 2);
  });

  it("preserves a stream that arrives before optimistic receipt reconciliation", async () => {
    const optimisticReceipt = "optimistic:message-1";
    seedManagedPresentations(conversationId, optimisticReceipt, [
      residentPubkey,
    ]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Already streaming" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    replaceManagedPresentationReceipt(optimisticReceipt, receiptId);

    const rows = getManagedPresentationSnapshot(conversationId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].dispatchReceiptId, receiptId);
    assert.equal(rows[0].publicText, "Already streaming");
    assert.equal(rows[0].sessionEpoch, 7);
  });

  it("discards partial text on cancellation", async () => {
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Partial" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    ingestManagedPresentationFrame(frame("cancelled", 3));
    const [row] = getManagedPresentationSnapshot(conversationId);
    assert.equal(row.phase, "cancelled");
    assert.equal(row.publicText, "");
    ingestManagedPresentationFrame(
      frame("public_chunk", 4, { public_chunk: "must stay discarded" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      getManagedPresentationSnapshot(conversationId)[0].publicText,
      "",
    );
  });
});
