import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  completeManagedPresentation,
  completeManagedPresentationForConversation,
  expireManagedPresentationDeadlinesForTests,
  flushManagedPresentationSchedulerForTests,
  getManagedPresentationActivitySnapshot,
  getManagedPresentationSchedulerStatsForTests,
  getManagedPresentationSnapshot,
  getManagedPresentationTurn,
  getManagedPresentationTurnKeysSnapshot,
  getManagedResponseSlotsSnapshot,
  ingestManagedPresentationFrame,
  reconcileManagedPresentationFinal,
  releaseManagedPresentationFinals,
  removeManagedPresentationByFinalMessageId,
  replaceManagedPresentationReceipt,
  resetManagedPresentationStore,
  seedManagedPresentations,
  subscribeManagedPresentationLegacy,
  subscribeManagedPresentationTopology,
  subscribeManagedPresentationTurn,
  subscribeManagedPresentationActivity,
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

function turn() {
  const [uiKey] = getManagedPresentationTurnKeysSnapshot(conversationId);
  return uiKey ? getManagedPresentationTurn(uiKey) : null;
}

function flushAll() {
  let pending = true;
  let paints = 0;
  while (pending && paints < 100) {
    pending = flushManagedPresentationSchedulerForTests(
      Date.now() + paints * 40,
    );
    paints += 1;
  }
  assert.ok(paints < 100, "presentation backlog should settle");
}

afterEach(resetManagedPresentationStore);

describe("managedPresentationStore", () => {
  it("rejects unseeded frames before and after a community reset", () => {
    ingestManagedPresentationFrame(frame("turn_started", 1));
    assert.deepEqual(
      getManagedPresentationTurnKeysSnapshot(conversationId),
      [],
    );

    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    resetManagedPresentationStore();
    ingestManagedPresentationFrame(frame("turn_started", 1));
    assert.deepEqual(
      getManagedPresentationTurnKeysSnapshot(conversationId),
      [],
    );
  });

  it("drains chunks adaptively and preserves strict sequence", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(frame("phase", 2, { phase: "working" }));
    ingestManagedPresentationFrame(
      frame("public_chunk", 3, { public_chunk: "Hello" }),
    );
    ingestManagedPresentationFrame(
      frame("public_chunk", 5, { public_chunk: " ignored" }),
    );

    flushManagedPresentationSchedulerForTests();
    assert.equal(turn().visibleText, "He");
    flushAll();
    assert.equal(turn().visibleText, "Hello");
    assert.equal(turn().sequence, 3);
    assert.equal(turn().receivedText, "Hello");
  });

  it("assigns immutable placement only when text first becomes visible", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    const uiKey = getManagedPresentationTurnKeysSnapshot(conversationId)[0];
    assert.equal(getManagedPresentationTurn(uiKey).anchorAt, 0);
    assert.equal(getManagedPresentationTurn(uiKey).slotOrdinal, null);
    assert.deepEqual(getManagedResponseSlotsSnapshot(conversationId), []);

    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Visible" }),
    );
    flushManagedPresentationSchedulerForTests();
    const activated = getManagedPresentationTurn(uiKey);
    assert.ok(activated.anchorAt > 0);
    assert.equal(activated.slotOrdinal, 0);
    assert.equal(
      getManagedResponseSlotsSnapshot(conversationId)[0].uiKey,
      uiKey,
    );
  });

  it("uses one global paint commit for eight resident backlogs", () => {
    const residents = Array.from({ length: 8 }, (_, index) =>
      index.toString(16).padStart(2, "0").repeat(32),
    );
    seedManagedPresentations(conversationId, receiptId, residents);
    residents.forEach((pubkey, index) => {
      ingestManagedPresentationFrame(
        frame("turn_started", 1, {
          resident_pubkey: pubkey,
          turn_id: `turn-${index}`,
        }),
      );
      ingestManagedPresentationFrame(
        frame("public_chunk", 2, {
          public_chunk: "abcdefgh",
          resident_pubkey: pubkey,
          turn_id: `turn-${index}`,
        }),
      );
    });

    flushManagedPresentationSchedulerForTests();
    assert.equal(
      getManagedPresentationSchedulerStatsForTests().paintCommits,
      1,
    );
    for (const uiKey of getManagedPresentationTurnKeysSnapshot(
      conversationId,
    )) {
      assert.equal(getManagedPresentationTurn(uiKey).visibleText, "ab");
    }
  });

  it("keeps bursty chunk ingestion private until one scheduled publish", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    const uiKey = getManagedPresentationTurnKeysSnapshot(conversationId)[0];
    let rowNotifications = 0;
    const dispose = subscribeManagedPresentationTurn(uiKey, () => {
      rowNotifications += 1;
    });
    const rebuildsBefore =
      getManagedPresentationSchedulerStatsForTests().legacySnapshotRebuilds;

    for (let index = 0; index < 200; index += 1) {
      ingestManagedPresentationFrame(
        frame("public_chunk", index + 2, { public_chunk: "x" }),
      );
    }

    assert.equal(rowNotifications, 0);
    assert.equal(getManagedPresentationTurn(uiKey).visibleText, "");
    assert.equal(getManagedPresentationTurn(uiKey).receivedText.length, 200);
    assert.equal(
      getManagedPresentationSchedulerStatsForTests().legacySnapshotRebuilds,
      rebuildsBefore,
    );

    flushManagedPresentationSchedulerForTests();
    assert.equal(rowNotifications, 1);
    assert.equal(getManagedPresentationTurn(uiKey).visibleText, "xxxxxxx");
    assert.equal(
      getManagedPresentationSchedulerStatsForTests().legacySnapshotRebuilds,
      rebuildsBefore + 1,
    );
    dispose();
  });

  it("rebuilds and notifies one legacy snapshot per conversation per tick", () => {
    const residents = Array.from({ length: 8 }, (_, index) =>
      (index + 1).toString(16).padStart(2, "0").repeat(32),
    );
    seedManagedPresentations(conversationId, receiptId, residents);
    residents.forEach((pubkey, index) => {
      ingestManagedPresentationFrame(
        frame("turn_started", 1, {
          resident_pubkey: pubkey,
          turn_id: `turn-${index}`,
        }),
      );
      ingestManagedPresentationFrame(
        frame("public_chunk", 2, {
          public_chunk: "abcdefgh",
          resident_pubkey: pubkey,
          turn_id: `turn-${index}`,
        }),
      );
    });
    const rebuildsBefore =
      getManagedPresentationSchedulerStatsForTests().legacySnapshotRebuilds;
    let legacyNotifications = 0;
    const dispose = subscribeManagedPresentationLegacy(conversationId, () => {
      legacyNotifications += 1;
    });

    flushManagedPresentationSchedulerForTests();

    assert.equal(legacyNotifications, 1);
    assert.equal(
      getManagedPresentationSchedulerStatsForTests().legacySnapshotRebuilds,
      rebuildsBefore + 1,
    );
    dispose();
  });

  it("notifies only the dirty row plus topology on first visibility", () => {
    const secondPubkey = "33".repeat(32);
    seedManagedPresentations(conversationId, receiptId, [
      residentPubkey,
      secondPubkey,
    ]);
    const [firstKey, secondKey] =
      getManagedPresentationTurnKeysSnapshot(conversationId);
    let firstChanges = 0;
    let secondChanges = 0;
    let topologyChanges = 0;
    const disposeFirst = subscribeManagedPresentationTurn(firstKey, () => {
      firstChanges += 1;
    });
    const disposeSecond = subscribeManagedPresentationTurn(secondKey, () => {
      secondChanges += 1;
    });
    const disposeTopology = subscribeManagedPresentationTopology(
      conversationId,
      () => {
        topologyChanges += 1;
      },
    );

    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Hello" }),
    );
    flushManagedPresentationSchedulerForTests();
    assert.ok(firstChanges >= 2);
    assert.equal(secondChanges, 0);
    assert.equal(topologyChanges, 1);
    disposeFirst();
    disposeSecond();
    disposeTopology();
  });

  it("keeps a stable uiKey after the receipt is authenticated", () => {
    const optimisticReceipt = "optimistic:message-1";
    seedManagedPresentations(conversationId, optimisticReceipt, [
      residentPubkey,
    ]);
    const originalUiKey =
      getManagedPresentationTurnKeysSnapshot(conversationId)[0];
    replaceManagedPresentationReceipt(optimisticReceipt, receiptId);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Already streaming" }),
    );
    flushAll();

    const keys = getManagedPresentationTurnKeysSnapshot(conversationId);
    assert.deepEqual(keys, [originalUiKey]);
    assert.equal(
      getManagedPresentationTurn(originalUiKey).visibleText,
      "Already streaming",
    );
    assert.equal(
      getManagedPresentationTurn(originalUiKey).dispatchReceiptId,
      receiptId,
    );
    assert.equal(getManagedPresentationTurn(originalUiKey).sessionEpoch, 7);
  });

  it("preserves visible partial text and discards unseen text on cancellation", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Partial backlog" }),
    );
    flushManagedPresentationSchedulerForTests();
    flushManagedPresentationSchedulerForTests();
    assert.equal(turn().visibleText, "Part");

    ingestManagedPresentationFrame(frame("cancelled", 3));
    assert.equal(turn().phase, "stopped");
    assert.equal(turn().visibleText, "Part");
    assert.equal(turn().receivedText, "Part");
    assert.equal(turn().bufferedText, "");
    ingestManagedPresentationFrame(
      frame("public_chunk", 4, { public_chunk: "must stay discarded" }),
    );
    flushAll();
    assert.equal(turn().visibleText, "Part");
  });

  it("preserves visible partial text on failure", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Partial failure" }),
    );
    flushManagedPresentationSchedulerForTests();
    flushManagedPresentationSchedulerForTests();
    ingestManagedPresentationFrame(
      frame("failed", 3, { failure: "publication" }),
    );
    assert.equal(turn().phase, "failed");
    assert.equal(turn().failure, "publication");
    assert.equal(turn().visibleText, "Part");
  });

  it("classifies exact signed reconciliation and retains the finalized turn", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Stream" }),
    );
    flushAll();
    const uiKey = turn().uiKey;
    reconcileManagedPresentationFinal(
      residentPubkey,
      receiptId,
      conversationId,
      "signed-final-message",
      "Stream plus signed suffix",
    );
    assert.equal(turn().uiKey, uiKey);
    assert.equal(turn().finalReconciliation, "signed_extends_stream");
    assert.equal(turn().finalMessageId, "signed-final-message");
    flushAll();
    assert.equal(turn().visibleText, "Stream plus signed suffix");

    releaseManagedPresentationFinals(["signed-final-message"]);
    assert.equal(turn().uiKey, uiKey);
  });

  it("classifies stream-longer and divergent signed finals without duplicating", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Stream is longer" }),
    );
    flushAll();
    reconcileManagedPresentationFinal(
      residentPubkey,
      receiptId,
      conversationId,
      "short-final",
      "Stream",
    );
    assert.equal(turn().finalReconciliation, "stream_extends_signed");
    assert.equal(turn().signedText, "Stream");
    assert.equal(getManagedResponseSlotsSnapshot(conversationId).length, 1);

    resetManagedPresentationStore();
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Alpha" }),
    );
    flushAll();
    reconcileManagedPresentationFinal(
      residentPubkey,
      receiptId,
      conversationId,
      "divergent-final",
      "Omega",
    );
    assert.equal(turn().finalReconciliation, "divergent");
  });

  it("tombstones a signed final that arrives before the stream", () => {
    completeManagedPresentation(residentPubkey, receiptId);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    assert.deepEqual(
      getManagedPresentationTurnKeysSnapshot(conversationId),
      [],
    );
  });

  it("reconciles only an unambiguous resident fallback", () => {
    seedManagedPresentations(conversationId, "optimistic:one", [
      residentPubkey,
    ]);
    completeManagedPresentationForConversation(
      residentPubkey,
      receiptId,
      conversationId,
      "signed-one",
      "Final",
    );
    assert.equal(turn().finalMessageId, "signed-one");

    resetManagedPresentationStore();
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
      "ambiguous",
      "Final",
    );
    assert.equal(
      getManagedPresentationTurnKeysSnapshot(conversationId).length,
      2,
    );
    assert.ok(
      getManagedPresentationTurnKeysSnapshot(conversationId).every(
        (uiKey) => getManagedPresentationTurn(uiKey).finalMessageId === null,
      ),
    );
  });

  it("marks overdue work as needs attention without synthesizing completion", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    const deadline = turn().deadlineAt;
    expireManagedPresentationDeadlinesForTests(deadline);
    assert.equal(turn().phase, "needs_attention");
    assert.equal(turn().failure, "unavailable");
    assert.equal(turn().finalMessageId, null);
    assert.equal(getManagedResponseSlotsSnapshot(conversationId).length, 1);
  });

  it("keeps the compatibility projection bounded to visible store state", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Legacy" }),
    );
    flushAll();
    assert.equal(
      getManagedPresentationSnapshot(conversationId)[0].publicText,
      "Legacy",
    );
  });

  it("keeps activity snapshots stable across public-text paints", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    const initial = getManagedPresentationActivitySnapshot(conversationId);
    let notifications = 0;
    const dispose = subscribeManagedPresentationActivity(conversationId, () => {
      notifications += 1;
    });
    ingestManagedPresentationFrame(frame("turn_started", 1));
    assert.equal(notifications, 0);
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Streaming body" }),
    );
    assert.equal(notifications, 1);
    const writing = getManagedPresentationActivitySnapshot(conversationId);
    assert.notEqual(writing, initial);
    assert.equal(writing.get(residentPubkey).phase, "writing");

    flushAll();
    assert.equal(notifications, 1);
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId),
      writing,
    );
    ingestManagedPresentationFrame(
      frame("public_chunk", 3, { public_chunk: " more" }),
    );
    flushAll();
    assert.equal(notifications, 1);
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId),
      writing,
    );
    dispose();
  });

  it("omits settled signed finals while retaining their response slots", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    const uiKey = getManagedPresentationTurnKeysSnapshot(conversationId)[0];
    reconcileManagedPresentationFinal(
      residentPubkey,
      receiptId,
      conversationId,
      "signed-final",
      "Signed body",
    );
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).size,
      0,
    );
    assert.equal(
      getManagedPresentationTurn(uiKey).finalMessageId,
      "signed-final",
    );
    assert.equal(
      getManagedResponseSlotsSnapshot(conversationId)[0].uiKey,
      uiKey,
    );
  });

  it("removes a retained response slot when its signed event is deleted", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    reconcileManagedPresentationFinal(
      residentPubkey,
      receiptId,
      conversationId,
      "signed-final",
      "Signed body",
    );

    removeManagedPresentationByFinalMessageId("SIGNED-FINAL");

    assert.deepEqual(getManagedResponseSlotsSnapshot(conversationId), []);
    assert.deepEqual(
      getManagedPresentationTurnKeysSnapshot(conversationId),
      [],
    );
  });

  it("shows terminal activity briefly without deleting retained partial text", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Partial response" }),
    );
    flushManagedPresentationSchedulerForTests();
    ingestManagedPresentationFrame(frame("cancelled", 3));
    const stopped = turn();
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).get(residentPubkey)
        .phase,
      "stopped",
    );

    expireManagedPresentationDeadlinesForTests(stopped.lastFrameAt + 4_001);
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).size,
      0,
    );
    assert.equal(getManagedPresentationTurn(stopped.uiKey).phase, "stopped");
    assert.equal(getManagedPresentationTurn(stopped.uiKey).visibleText, "Pa");
  });

  it("briefly projects needs-attention state and then expires only the activity", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    const pending = turn();
    expireManagedPresentationDeadlinesForTests(pending.deadlineAt);
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).get(residentPubkey)
        .phase,
      "needs_attention",
    );
    expireManagedPresentationDeadlinesForTests(pending.deadlineAt + 4_001);
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).size,
      0,
    );
    assert.equal(turn().phase, "needs_attention");
  });

  it("aggregates concurrent turns to one resident and reveals the surviving turn", () => {
    const firstReceipt = "optimistic:first";
    const secondReceipt = "optimistic:second";
    seedManagedPresentations(conversationId, firstReceipt, [residentPubkey]);
    const firstUiKey =
      getManagedPresentationTurnKeysSnapshot(conversationId)[0];
    seedManagedPresentations(conversationId, secondReceipt, [residentPubkey]);
    const secondUiKey =
      getManagedPresentationTurnKeysSnapshot(conversationId)[1];
    const activity = getManagedPresentationActivitySnapshot(conversationId);
    assert.equal(activity.size, 1);
    assert.equal(activity.get(residentPubkey).uiKey, secondUiKey);

    reconcileManagedPresentationFinal(
      residentPubkey,
      secondReceipt,
      conversationId,
      "second-final",
      "Done",
    );
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).get(residentPubkey)
        .uiKey,
      firstUiKey,
    );
  });

  it("clears and notifies activity subscribers during a community reset", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    let notifications = 0;
    const dispose = subscribeManagedPresentationActivity(conversationId, () => {
      notifications += 1;
    });
    resetManagedPresentationStore();
    assert.equal(notifications, 1);
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).size,
      0,
    );
    dispose();
  });
});
