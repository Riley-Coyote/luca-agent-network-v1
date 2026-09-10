import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { reconcileManagedHistoryFinals } from "./managedPresentationHistory.ts";
import {
  getManagedPresentationTurn,
  getManagedPresentationTurnKeysSnapshot,
  getManagedResponseSlotsSnapshot,
  ingestManagedPresentationFrame,
  resetManagedPresentationStore,
  seedManagedPresentations,
} from "./managedPresentationStore.ts";
import { projectManagedTimelineMessages } from "./lib/managedTimelineProjection.ts";

const channel = "11111111-1111-4111-8111-111111111111";
const resident = "11".repeat(32);
const receipt = "22".repeat(32);
const final = {
  id: "33".repeat(32),
  kind: 9,
  pubkey: resident,
  content: "Your review is ready.",
  tags: [
    ["h", channel],
    ["luca-managed-dispatch", receipt],
  ],
};
const current = () =>
  getManagedPresentationTurn(
    getManagedPresentationTurnKeysSnapshot(channel)[0],
  );

afterEach(resetManagedPresentationStore);

test("history settles a retained response after returning from review, without a duplicate or failure", () => {
  seedManagedPresentations(channel, receipt, [resident]);
  const frame = (kind, sequence, extra = {}) => ({
    protocol: "luca.managed.presentation.v1",
    kind,
    sequence,
    resident_pubkey: resident,
    conversation_id: channel,
    turn_id: "turn-1",
    dispatch_receipt_id: receipt,
    session_epoch: 7,
    ...extra,
  });
  ingestManagedPresentationFrame(frame("turn_started", 1));
  ingestManagedPresentationFrame(
    frame("public_chunk", 2, { public_chunk: final.content }),
  );
  ingestManagedPresentationFrame(
    frame("failed", 3, { failure: "unavailable" }),
  );
  assert.equal(current().failure, "unavailable");

  reconcileManagedHistoryFinals(channel, [final]);
  assert.equal(current().finalMessageId, final.id);
  assert.equal(current().failure, null);
  assert.equal(current().signedText, final.content);
  const projection = projectManagedTimelineMessages(
    [{ ...final, body: final.content, createdAt: 1 }],
    getManagedResponseSlotsSnapshot(channel),
  );
  assert.equal(projection.messages.length, 1);
  assert.equal(
    projection.messages[0].managedPresentation.canonicalPresent,
    true,
  );
  const settled = current();
  reconcileManagedHistoryFinals(channel, [final]);
  assert.equal(
    current(),
    settled,
    "unchanged history must not restart reconciliation",
  );
});

test("history requires the exact channel, resident and signed receipt", () => {
  seedManagedPresentations(channel, receipt, [resident]);
  for (const invalid of [
    { ...final, pubkey: "44".repeat(32) },
    {
      ...final,
      tags: [
        ["h", channel],
        ["luca-managed-dispatch", "other"],
      ],
    },
    {
      ...final,
      tags: [
        ["h", "another-channel"],
        ["luca-managed-dispatch", receipt],
      ],
    },
    { ...final, kind: 5 },
    {
      ...final,
      tags: [
        ["h", channel],
        ["e", receipt],
      ],
    },
  ]) {
    reconcileManagedHistoryFinals(channel, [invalid]);
    assert.equal(current().finalMessageId, null);
  }
});
