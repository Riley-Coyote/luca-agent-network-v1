import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  acknowledgeManagedPresentationReconciliation,
  cancelManagedPresentation,
  completeManagedPresentation,
  completeManagedPresentationForConversation,
  dismissManagedPresentationActivity,
  expireManagedPresentationDeadlinesForTests,
  flushManagedPresentationSchedulerForTests,
  getManagedPresentationActivitySnapshot,
  getManagedPresentationSchedulerStatsForTests,
  getManagedPresentationSnapshot,
  getManagedPresentationTurn,
  getManagedPresentationTurnKeysSnapshot,
  hasLiveManagedPresentationForResident,
  getManagedOperationalReceiptSnapshot,
  getManagedResponseSlotsSnapshot,
  hydrateManagedOperationalStatuses,
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
  it("keeps auto-restart inhibited until a managed signed final settles", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    assert.equal(hasLiveManagedPresentationForResident(residentPubkey), true);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(frame("completed", 2));
    assert.equal(hasLiveManagedPresentationForResident(residentPubkey), true);

    reconcileManagedPresentationFinal(
      residentPubkey,
      receiptId,
      conversationId,
      "settled-final",
      "Done",
    );
    assert.equal(hasLiveManagedPresentationForResident(residentPubkey), false);
  });

  it("settles a watchdog cancellation and rejects buffered or late presentation frames", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, {
        public_chunk: "This buffered response must stop revealing immediately.",
      }),
    );
    flushManagedPresentationSchedulerForTests();
    const visibleAtCancel = turn().visibleText;
    assert.ok(visibleAtCancel.length > 0);
    assert.ok(turn().bufferedText.length > 0);

    const cancelled = cancelManagedPresentation(
      residentPubkey,
      receiptId,
      conversationId,
    );
    assert.equal(cancelled.phase, "stopped");
    assert.equal(cancelled.bufferedText, "");
    assert.equal(cancelled.receivedText, visibleAtCancel);
    flushAll();
    assert.equal(turn().visibleText, visibleAtCancel);

    ingestManagedPresentationFrame(
      frame("public_chunk", 3, { public_chunk: " late" }),
    );
    flushAll();
    assert.equal(turn().visibleText, visibleAtCancel);

    reconcileManagedPresentationFinal(
      residentPubkey,
      receiptId,
      conversationId,
      "ambiguous-final",
      "Canonical final",
    );
    assert.equal(turn().signedText, "Canonical final");
  });

  it("hydrates body-free restart outcomes once and preserves sibling partials", () => {
    const sibling = "33".repeat(32);
    seedManagedPresentations(conversationId, receiptId, [
      residentPubkey,
      sibling,
    ]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Keep this partial." }),
    );
    flushAll();

    const status = {
      dispatchReceiptId: receiptId,
      status: "interrupted_after_restart",
    };
    hydrateManagedOperationalStatuses(conversationId, [status, status]);

    const rows = getManagedPresentationSnapshot(conversationId);
    assert.deepEqual(
      [...getManagedOperationalReceiptSnapshot(conversationId)],
      [receiptId],
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.phase === "failed"));
    assert.equal(
      rows.find((row) => row.residentPubkey === residentPubkey).publicText,
      "Keep this partial.",
    );
    assert.equal(
      getManagedPresentationTurn(
        getManagedPresentationTurnKeysSnapshot(conversationId)[0],
      ).phase,
      "needs_attention",
    );
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).size,
      2,
    );
    expireManagedPresentationDeadlinesForTests(Date.now() + 60_000);
    flushManagedPresentationSchedulerForTests(Date.now() + 60_000);
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).size,
      2,
      "restart interruption remains actionable instead of briefly expiring",
    );
  });

  it("consumes only the retried resident interruption without resurfacing", () => {
    const sibling = "33".repeat(32);
    seedManagedPresentations(conversationId, receiptId, [
      residentPubkey,
      sibling,
    ]);
    hydrateManagedOperationalStatuses(conversationId, [
      {
        dispatchReceiptId: receiptId,
        status: "interrupted_after_restart",
      },
    ]);

    const retryReceipt = "retry:exact-resident";
    seedManagedPresentations(conversationId, retryReceipt, [residentPubkey]);
    const activity = getManagedPresentationActivitySnapshot(conversationId);
    assert.equal(activity.size, 2);
    assert.equal(activity.get(sibling).phase, "needs_attention");
    assert.equal(activity.get(residentPubkey).phase, "thinking");
    assert.ok(activity.get(residentPubkey).uiKey.endsWith(`:${retryReceipt}`));

    reconcileManagedPresentationFinal(
      residentPubkey,
      retryReceipt,
      conversationId,
      "retry-final",
      "Retried response",
    );
    const settled = getManagedPresentationActivitySnapshot(conversationId);
    assert.equal(settled.size, 1);
    assert.equal(settled.get(sibling).phase, "needs_attention");
    assert.equal(settled.has(residentPubkey), false);
  });

  it("a same-resident new turn supersedes durable interrupted activity", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    hydrateManagedOperationalStatuses(conversationId, [
      {
        dispatchReceiptId: receiptId,
        status: "interrupted_after_restart",
      },
    ]);
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).get(residentPubkey)
        .phase,
      "needs_attention",
    );

    const nextReceipt = "new:managed-turn";
    seedManagedPresentations(conversationId, nextReceipt, [residentPubkey]);
    const replacement = getManagedPresentationActivitySnapshot(conversationId);
    assert.equal(replacement.size, 1);
    assert.equal(replacement.get(residentPubkey).phase, "thinking");
    assert.ok(
      replacement.get(residentPubkey).uiKey.endsWith(`:${nextReceipt}`),
    );
  });
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

  it("coalesces bursty lifecycle and activity publications into one paint", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    const uiKey = getManagedPresentationTurnKeysSnapshot(conversationId)[0];
    let activityNotifications = 0;
    let legacyNotifications = 0;
    let rowNotifications = 0;
    const disposeActivity = subscribeManagedPresentationActivity(
      conversationId,
      () => {
        activityNotifications += 1;
      },
    );
    const disposeLegacy = subscribeManagedPresentationLegacy(
      conversationId,
      () => {
        legacyNotifications += 1;
      },
    );
    const disposeRow = subscribeManagedPresentationTurn(uiKey, () => {
      rowNotifications += 1;
    });
    const paintsBefore =
      getManagedPresentationSchedulerStatsForTests().paintCommits;

    ingestManagedPresentationFrame(frame("turn_started", 1));
    for (let sequence = 2; sequence <= 41; sequence += 1) {
      ingestManagedPresentationFrame(
        frame("phase", sequence, {
          phase: sequence % 2 === 0 ? "working" : "writing",
        }),
      );
    }

    assert.equal(getManagedPresentationTurn(uiKey).phase, "writing");
    assert.equal(rowNotifications, 0);
    assert.equal(legacyNotifications, 0);
    assert.equal(activityNotifications, 0);

    flushManagedPresentationSchedulerForTests();
    assert.equal(rowNotifications, 1);
    assert.equal(legacyNotifications, 1);
    assert.equal(activityNotifications, 1);
    assert.equal(
      getManagedPresentationSchedulerStatsForTests().paintCommits,
      paintsBefore + 1,
    );
    disposeActivity();
    disposeLegacy();
    disposeRow();
  });

  it("keeps empty completion in activity without creating a response slot", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    let activityNotifications = 0;
    let topologyNotifications = 0;
    const disposeActivity = subscribeManagedPresentationActivity(
      conversationId,
      () => {
        activityNotifications += 1;
      },
    );
    const dispose = subscribeManagedPresentationTopology(conversationId, () => {
      topologyNotifications += 1;
    });

    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(frame("completed", 2));
    assert.equal(turn().phase, "finalizing");
    assert.deepEqual(getManagedResponseSlotsSnapshot(conversationId), []);
    assert.equal(activityNotifications, 0);

    flushManagedPresentationSchedulerForTests();
    assert.deepEqual(getManagedResponseSlotsSnapshot(conversationId), []);
    assert.equal(topologyNotifications, 0);
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).get(residentPubkey)
        .phase,
      "finalizing",
    );
    assert.equal(activityNotifications, 1);
    disposeActivity();
    dispose();
  });

  it("keeps timeout before public text in activity only", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    const deadline = turn().deadlineAt;

    expireManagedPresentationDeadlinesForTests(deadline);
    assert.equal(turn().phase, "needs_attention");
    assert.deepEqual(getManagedResponseSlotsSnapshot(conversationId), []);

    flushManagedPresentationSchedulerForTests(deadline);
    assert.deepEqual(getManagedResponseSlotsSnapshot(conversationId), []);
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).get(residentPubkey)
        .phase,
      "needs_attention",
    );
  });

  it("keeps cancellation before public text in activity only", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(frame("cancelled", 2));

    assert.equal(turn().phase, "stopped");
    assert.deepEqual(getManagedResponseSlotsSnapshot(conversationId), []);
    flushManagedPresentationSchedulerForTests();
    assert.deepEqual(getManagedResponseSlotsSnapshot(conversationId), []);
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).get(residentPubkey)
        .phase,
      "stopped",
    );
  });

  it("keeps failure before public text in activity only", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(frame("failed", 2, { failure: "runtime" }));

    assert.equal(turn().phase, "failed");
    assert.deepEqual(getManagedResponseSlotsSnapshot(conversationId), []);
    flushManagedPresentationSchedulerForTests();
    assert.deepEqual(getManagedResponseSlotsSnapshot(conversationId), []);
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).get(residentPubkey)
        .phase,
      "failed",
    );
  });

  it("creates one response slot when completion has buffered public text", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    let topologyNotifications = 0;
    const dispose = subscribeManagedPresentationTopology(conversationId, () => {
      topologyNotifications += 1;
    });
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Buffered" }),
    );
    ingestManagedPresentationFrame(frame("completed", 3));

    assert.deepEqual(getManagedResponseSlotsSnapshot(conversationId), []);
    flushManagedPresentationSchedulerForTests();
    assert.equal(getManagedResponseSlotsSnapshot(conversationId).length, 1);
    assert.equal(topologyNotifications, 1);
    assert.equal(turn().visibleText.length > 0, true);
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
    assert.equal(firstChanges, 1);
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

  it("a stopped turn keeps every grapheme it received, not only the painted ones", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Partial backlog" }),
    );
    // Two paint ticks of a fifteen-character chunk: the rest is received and
    // verified but still queued behind the 40ms reveal cadence.
    flushManagedPresentationSchedulerForTests();
    flushManagedPresentationSchedulerForTests();
    assert.equal(turn().visibleText, "Part");
    assert.equal(turn().bufferedText, "ial backlog");

    ingestManagedPresentationFrame(frame("cancelled", 3));
    assert.equal(turn().phase, "stopped");
    // Stop is pressed mid-stream by design, so this is the ordinary case. The
    // tail was already in hand; cutting it here would truncate the answer
    // mid-word and then blame the runtime for it.
    assert.equal(turn().visibleText, "Partial backlog");
    assert.equal(turn().receivedText, "Partial backlog");
    assert.equal(turn().bufferedText, "");

    // What arrives AFTER the turn ended is a different question, and still no.
    ingestManagedPresentationFrame(
      frame("public_chunk", 4, { public_chunk: "must stay discarded" }),
    );
    flushAll();
    assert.equal(turn().visibleText, "Partial backlog");
    assert.equal(turn().receivedText, "Partial backlog");
  });

  it("a failed turn keeps every grapheme it received", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Partial failure" }),
    );
    flushManagedPresentationSchedulerForTests();
    flushManagedPresentationSchedulerForTests();
    assert.equal(turn().visibleText, "Part");

    ingestManagedPresentationFrame(
      frame("failed", 3, { failure: "publication" }),
    );
    assert.equal(turn().phase, "failed");
    assert.equal(turn().failure, "publication");
    assert.equal(turn().visibleText, "Partial failure");
    assert.equal(turn().receivedText, "Partial failure");
    assert.equal(turn().bufferedText, "");
  });

  it("a turn that dies before its first paint still lands a row", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Never painted" }),
    );
    // No paint tick at all — every grapheme is still queued.
    assert.equal(turn().visibleText, "");
    ingestManagedPresentationFrame(frame("failed", 3, { failure: "runtime" }));

    // A response slot is granted only to a turn with visible text, so before
    // the flush this turn had no row anywhere and its words were unreachable.
    assert.equal(turn().visibleText, "Never painted");
    flushManagedPresentationSchedulerForTests();
    assert.equal(getManagedResponseSlotsSnapshot(conversationId).length, 1);
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
    assert.equal(
      getManagedResponseSlotsSnapshot(conversationId)[0].finalMessageId,
      "signed-final-message",
    );
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
    assert.equal(turn().visibleText, "Stream");
    assert.equal(turn().receivedText, "Stream");
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
    assert.equal(turn().visibleText, "Omega");
    assert.equal(turn().receivedText, "Omega");
  });

  it("acknowledges only the matching authoritative reconciliation", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Streamed" }),
    );
    flushAll();
    const uiKey = turn().uiKey;
    reconcileManagedPresentationFinal(
      residentPubkey,
      receiptId,
      conversationId,
      "signed-reconciliation",
      "Authoritative",
    );

    assert.equal(turn().finalReconciliation, "divergent");
    assert.equal(turn().visibleText, "Authoritative");
    assert.equal(
      acknowledgeManagedPresentationReconciliation(
        "wrong-ui-key",
        "signed-reconciliation",
      ),
      false,
    );
    assert.equal(
      acknowledgeManagedPresentationReconciliation(uiKey, "stale-message"),
      false,
    );
    assert.equal(turn().finalReconciliation, "divergent");
    assert.equal(
      acknowledgeManagedPresentationReconciliation(
        uiKey,
        "signed-reconciliation",
      ),
      true,
    );
    assert.equal(turn().finalReconciliation, null);
    assert.equal(turn().visibleText, "Authoritative");
    assert.equal(turn().receivedText, "Authoritative");
    assert.equal(
      acknowledgeManagedPresentationReconciliation(
        uiKey,
        "signed-reconciliation",
      ),
      false,
    );
  });

  it("keeps revealing queued graphemes when the signed final wins the first-paint race", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(
      frame("public_chunk", 2, { public_chunk: "Complete signed body" }),
    );

    reconcileManagedPresentationFinal(
      residentPubkey,
      receiptId,
      conversationId,
      "signed-before-paint",
      "Complete signed body",
    );
    assert.equal(turn().visibleText, "");
    assert.equal(turn().bufferedText, "Complete signed body");
    assert.equal(getManagedResponseSlotsSnapshot(conversationId).length, 1);

    flushManagedPresentationSchedulerForTests();
    assert.ok(turn().visibleText.length > 0);
    assert.ok(turn().visibleText.length < "Complete signed body".length);
    assert.ok(turn().bufferedText.length > 0);

    flushAll();
    assert.equal(turn().visibleText, "Complete signed body");
    assert.equal(turn().bufferedText, "");
  });

  it("tombstones a signed final that arrives before the stream", () => {
    completeManagedPresentation(residentPubkey, receiptId);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    assert.deepEqual(
      getManagedPresentationTurnKeysSnapshot(conversationId),
      [],
    );
  });

  it("reconciles concurrent same-resident timeline and thread finals only by exact receipt", () => {
    const firstReceipt = "receipt:first";
    const secondReceipt = "receipt:second";
    seedManagedPresentations(conversationId, firstReceipt, [residentPubkey]);
    seedManagedPresentations(
      conversationId,
      secondReceipt,
      [residentPubkey],
      "thread",
    );

    completeManagedPresentationForConversation(
      residentPubkey,
      firstReceipt,
      conversationId,
      "signed-one",
      "First final",
    );
    const keysByReceipt = new Map(
      getManagedPresentationTurnKeysSnapshot(conversationId).map((uiKey) => {
        const current = getManagedPresentationTurn(uiKey);
        return [current.dispatchReceiptId, uiKey];
      }),
    );
    assert.equal(keysByReceipt.size, 2);
    const firstKey = keysByReceipt.get(firstReceipt);
    const secondKey = keysByReceipt.get(secondReceipt);
    assert.ok(firstKey);
    assert.ok(secondKey);
    assert.equal(
      getManagedPresentationTurn(firstKey).finalMessageId,
      "signed-one",
    );
    assert.equal(
      getManagedPresentationTurn(firstKey).responseSurface,
      "timeline",
    );
    assert.equal(getManagedPresentationTurn(secondKey).finalMessageId, null);
    assert.equal(
      getManagedPresentationTurn(secondKey).responseSurface,
      "thread",
    );

    completeManagedPresentationForConversation(
      residentPubkey,
      "receipt:unrelated",
      conversationId,
      "unrelated-final",
      "Must not bind",
    );
    assert.equal(getManagedPresentationTurn(secondKey).finalMessageId, null);

    completeManagedPresentationForConversation(
      residentPubkey,
      secondReceipt,
      conversationId,
      "signed-two",
      "Second final",
    );
    assert.equal(
      getManagedPresentationTurn(secondKey).finalMessageId,
      "signed-two",
    );
  });

  it("marks overdue work as needs attention without synthesizing completion", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    const deadline = turn().deadlineAt;
    expireManagedPresentationDeadlinesForTests(deadline);
    assert.equal(turn().phase, "needs_attention");
    assert.equal(turn().failure, "unavailable");
    assert.equal(turn().finalMessageId, null);
    flushManagedPresentationSchedulerForTests(deadline);
    assert.equal(getManagedResponseSlotsSnapshot(conversationId).length, 0);
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
    assert.equal(notifications, 0);
    flushManagedPresentationSchedulerForTests();
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
    let activityNotifications = 0;
    let rowNotifications = 0;
    const uiKey = turn().uiKey;
    const disposeActivity = subscribeManagedPresentationActivity(
      conversationId,
      () => {
        activityNotifications += 1;
      },
    );
    const disposeRow = subscribeManagedPresentationTurn(uiKey, () => {
      rowNotifications += 1;
    });
    ingestManagedPresentationFrame(frame("cancelled", 3));
    assert.equal(turn().phase, "stopped");
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).get(residentPubkey)
        .phase,
      "writing",
    );
    assert.equal(activityNotifications, 0);
    assert.equal(rowNotifications, 0);
    flushManagedPresentationSchedulerForTests();
    const stopped = turn();
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).get(residentPubkey)
        .phase,
      "stopped",
    );
    assert.equal(activityNotifications, 1);
    assert.equal(rowNotifications, 1);

    expireManagedPresentationDeadlinesForTests(stopped.lastFrameAt + 4_001);
    flushManagedPresentationSchedulerForTests(stopped.lastFrameAt + 4_001);
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).size,
      0,
    );
    assert.equal(getManagedPresentationTurn(stopped.uiKey).phase, "stopped");
    // The whole chunk, not the two graphemes that had been painted when Stop
    // landed — which is what this test's own title always claimed.
    assert.equal(
      getManagedPresentationTurn(stopped.uiKey).visibleText,
      "Partial response",
    );
    disposeActivity();
    disposeRow();
  });

  it("keeps a needs-attention turn actionable until the owner dismisses it", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    const pending = turn();
    expireManagedPresentationDeadlinesForTests(pending.deadlineAt);
    flushManagedPresentationSchedulerForTests(pending.deadlineAt);
    const attention =
      getManagedPresentationActivitySnapshot(conversationId).get(
        residentPubkey,
      );
    assert.equal(attention.phase, "needs_attention");

    // Far past the brief acknowledgement window a stopped turn would have used.
    const wellBeyondBrief = pending.deadlineAt + 60_000;
    expireManagedPresentationDeadlinesForTests(wellBeyondBrief);
    flushManagedPresentationSchedulerForTests(wellBeyondBrief);
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).get(residentPubkey)
        ?.phase,
      "needs_attention",
      "an unwitnessed failure must still be retryable minutes later",
    );
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).get(residentPubkey)
        .uiKey,
      attention.uiKey,
      "retry needs the same exact presentation identity it was offered with",
    );

    dismissManagedPresentationActivity(attention.uiKey, conversationId);
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).size,
      0,
    );
    assert.equal(turn().phase, "needs_attention");
  });

  it("does not resurrect an outcome the owner already dismissed", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    const pending = turn();
    expireManagedPresentationDeadlinesForTests(pending.deadlineAt);
    flushManagedPresentationSchedulerForTests(pending.deadlineAt);
    const { uiKey } =
      getManagedPresentationActivitySnapshot(conversationId).get(
        residentPubkey,
      );
    dismissManagedPresentationActivity(uiKey, conversationId);

    replaceManagedPresentationReceipt(receiptId, "durable:receipt");
    flushAll();
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).size,
      0,
      "republishing a dismissed turn must not bring its line back",
    );
  });

  it("a retry supersedes the failure it was launched from", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    ingestManagedPresentationFrame(frame("failed", 2, { failure: "runtime" }));
    flushAll();
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).get(residentPubkey)
        .phase,
      "failed",
    );

    const retryReceipt = "retry:after-failure";
    seedManagedPresentations(conversationId, retryReceipt, [residentPubkey]);
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).get(residentPubkey)
        .phase,
      "thinking",
    );

    reconcileManagedPresentationFinal(
      residentPubkey,
      retryReceipt,
      conversationId,
      "retry-final",
      "Second time lucky",
    );
    flushAll();
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).size,
      0,
      "the answered retry must not uncover the failure it replaced",
    );
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

  it("accumulates rich activity while live and retires it after the answer", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(
      frame("turn_started", 1, {
        activity: {
          kind: "web",
          label: "Searching the web",
          detail: "https://www.nodejs.org/docs",
          status: "active",
          step: 1,
        },
      }),
    );
    ingestManagedPresentationFrame(
      frame("phase", 2, {
        phase: "working",
        activity: {
          kind: "web",
          label: "Searching the web",
          detail: "https://www.nodejs.org/docs",
          status: "done",
          count: 8,
          step: 1,
        },
      }),
    );
    ingestManagedPresentationFrame(
      frame("phase", 3, {
        phase: "working",
        activity: {
          kind: "file",
          label: "Reading conversation-shell.css",
          detail: "desktop/src/shared/styles/globals/conversation-shell.css",
          step: 2,
        },
      }),
    );
    flushAll();

    const live =
      getManagedPresentationActivitySnapshot(conversationId).get(
        residentPubkey,
      );
    assert.deepEqual(
      live.steps.map((entry) => [entry.step, entry.kind, entry.status]),
      [
        [1, "web", "done"],
        [2, "file", "active"],
      ],
    );
    assert.equal(live.steps[0].count, 8);
    assert.ok(live.startedAt > 0, "the wait has a desktop-clock anchor");

    reconcileManagedPresentationFinal(
      residentPubkey,
      receiptId,
      conversationId,
      "final-1",
      "Here is the answer.",
    );
    flushAll();
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).get(
        residentPubkey,
      ),
      undefined,
      "the answer retires the transient work summary",
    );
  });

  it("an un-narrated answer still takes its indicator away", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(frame("turn_started", 1));
    flushAll();
    reconcileManagedPresentationFinal(
      residentPubkey,
      receiptId,
      conversationId,
      "final-plain",
      "No tools were harmed.",
    );
    flushAll();
    assert.equal(
      getManagedPresentationActivitySnapshot(conversationId).size,
      0,
    );
  });

  it("ignores malformed activity without disturbing the turn", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(
      frame("turn_started", 1, { activity: { label: 42, kind: 7 } }),
    );
    ingestManagedPresentationFrame(
      frame("phase", 2, { phase: "writing", activity: "not an object" }),
    );
    flushAll();
    const activity =
      getManagedPresentationActivitySnapshot(conversationId).get(
        residentPubkey,
      );
    assert.equal(activity.phase, "writing", "the turn advanced regardless");
    assert.deepEqual(activity.steps, [], "nothing showable, nothing shown");
  });

  it("keeps an unfinished step unfinished when the runtime dies", () => {
    seedManagedPresentations(conversationId, receiptId, [residentPubkey]);
    ingestManagedPresentationFrame(
      frame("turn_started", 1, {
        activity: { kind: "command", label: "Running pnpm test", step: 1 },
      }),
    );
    ingestManagedPresentationFrame(frame("failed", 2, { failure: "runtime" }));
    flushAll();
    const activity =
      getManagedPresentationActivitySnapshot(conversationId).get(
        residentPubkey,
      );
    assert.equal(activity.phase, "failed");
    assert.equal(
      activity.steps[0].status,
      "active",
      "a step that never finished must not be reported as done",
    );
  });
});
