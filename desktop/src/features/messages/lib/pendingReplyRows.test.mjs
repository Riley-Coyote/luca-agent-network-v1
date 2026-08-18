import assert from "node:assert/strict";
import test from "node:test";

import { formatTime, isSameDay } from "./dateFormatters.ts";
import { isPendingReplyRow, pendingReplyRows } from "./pendingReplyRows.ts";

const LUCA = "a".repeat(64);
const CODEX = "b".repeat(64);

test("a thinking resident with no text gets a tail row stamped in seconds", () => {
  const nowMs = Date.UTC(2026, 7, 18, 8, 22, 0);
  const rows = pendingReplyRows({
    managedActivity: new Map([[LUCA, { phase: "thinking" }]]),
    observerActivity: undefined,
    slots: [],
    now: nowMs,
  });

  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.ok(isPendingReplyRow(row));
  // Timeline rows carry Nostr created_at (seconds), never wall-clock ms —
  // otherwise the day divider reads a year like 58598.
  assert.equal(row.createdAt, Math.floor(nowMs / 1000));
  assert.ok(isSameDay(row.createdAt, Math.floor(nowMs / 1000)));
  assert.equal(row.time, formatTime(row.createdAt));
  assert.equal(row.managedPresentation.phase, "thinking");
});

test("observer activity anchors are converted from ms and carry the label", () => {
  const anchorMs = Date.UTC(2026, 7, 18, 3, 5, 9, 750);
  const rows = pendingReplyRows({
    managedActivity: undefined,
    observerActivity: [
      {
        agentPubkey: CODEX,
        turnId: "turn-1",
        anchorAt: anchorMs,
        activity: { phase: "working", tool: null, summary: null },
      },
    ],
    slots: [],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].createdAt, Math.floor(anchorMs / 1000));
  assert.equal(rows[0].managedPresentation.phase, "working");
});

test("a resident who already has a response slot gets no pending row", () => {
  const rows = pendingReplyRows({
    managedActivity: new Map([[LUCA, { phase: "thinking" }]]),
    observerActivity: undefined,
    slots: [{ residentPubkey: LUCA }],
    now: Date.UTC(2026, 7, 18),
  });
  assert.deepEqual(rows, []);
});
