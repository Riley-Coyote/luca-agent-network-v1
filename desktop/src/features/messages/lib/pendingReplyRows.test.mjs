import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVITY_ELAPSED_AFTER_MS,
  ACTIVITY_LONG_WAIT_AFTER_MS,
  ACTIVITY_PHASE_WORD_AFTER_MS,
} from "@/features/channels/ui/conversationAgentActivityShelf";
import { formatTime, isSameDay } from "./dateFormatters.ts";
import { isPendingReplyRow, pendingReplyRows } from "./pendingReplyRows.ts";

const LUCA = "a".repeat(64);
const CODEX = "b".repeat(64);

const STARTED_AT = Date.UTC(2026, 7, 18, 8, 22, 0);

/** One resident, mid-turn, narrating a web search. */
function searching(overrides = {}) {
  return new Map([
    [
      LUCA,
      {
        phase: "working",
        startedAt: STARTED_AT,
        steps: [
          {
            step: 1,
            kind: "web",
            label: "Searching the web",
            detail: "https://arxiv.org/abs/1234",
            status: "active",
            count: null,
          },
        ],
        ...overrides,
      },
    ],
  ]);
}

function labelAt(elapsedMs, activity = searching()) {
  const [row] = pendingReplyRows({
    managedActivity: activity,
    observerActivity: undefined,
    slots: [],
    now: STARTED_AT + elapsedMs,
  });
  return row?.managedPresentation.activityLabel;
}

test("a thinking resident with no text gets a tail row stamped in seconds", () => {
  const nowMs = Date.UTC(2026, 7, 18, 8, 22, 0);
  const rows = pendingReplyRows({
    managedActivity: new Map([
      [LUCA, { phase: "thinking", startedAt: nowMs, steps: [] }],
    ]),
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
    managedActivity: new Map([
      [
        LUCA,
        { phase: "thinking", startedAt: Date.UTC(2026, 7, 18), steps: [] },
      ],
    ]),
    observerActivity: undefined,
    slots: [{ residentPubkey: LUCA }],
    now: Date.UTC(2026, 7, 18),
  });
  assert.deepEqual(rows, []);
});

test("the row anchors on the turn's own start, not on the render clock", () => {
  const [row] = pendingReplyRows({
    managedActivity: searching(),
    observerActivity: undefined,
    slots: [],
    // Long after the turn began: the row must still be stamped at its start,
    // or the timestamp creeps forward while the resident is still thinking and
    // no elapsed reading taken from it can be true.
    now: STARTED_AT + 45_000,
  });
  assert.equal(row.createdAt, Math.floor(STARTED_AT / 1000));
});

test("the awaiting row discloses more as the wait grows", () => {
  // Ordinary latency goes unnarrated — the row keeps its plain phase word.
  assert.equal(labelAt(0), undefined);
  assert.equal(labelAt(ACTIVITY_PHASE_WORD_AFTER_MS - 1), undefined);

  // What is being done, in the row's own lowercase voice, with a bare domain.
  assert.equal(
    labelAt(ACTIVITY_PHASE_WORD_AFTER_MS),
    "searching the web · arxiv.org",
  );

  // A long wait is acknowledged without narrating sub-minute latency.
  assert.equal(
    labelAt(ACTIVITY_LONG_WAIT_AFTER_MS),
    "still searching the web · arxiv.org",
  );

  // Whole-minute duration appears only once it is meaningful.
  assert.equal(
    labelAt(ACTIVITY_ELAPSED_AFTER_MS),
    "still searching the web · arxiv.org · 1m",
  );
});

test("an un-narrated turn stays quiet until the clock itself is news", () => {
  const bare = new Map([
    [LUCA, { phase: "thinking", startedAt: STARTED_AT, steps: [] }],
  ]);
  // No steps: at the phase tier there is nothing to add that the row's own
  // fallback word has not already said.
  assert.equal(labelAt(ACTIVITY_PHASE_WORD_AFTER_MS, bare), undefined);
  assert.equal(labelAt(ACTIVITY_LONG_WAIT_AFTER_MS, bare), "still thinking");
  assert.equal(labelAt(ACTIVITY_ELAPSED_AFTER_MS, bare), "still thinking · 1m");
});

test("a path is read from its tail and a command is left verbatim", () => {
  const reading = searching({
    steps: [
      {
        step: 1,
        kind: "file",
        label: "Reading",
        detail: "/very/deep/nested/tree/of/directories/MessageRow.tsx",
        status: "active",
        count: null,
      },
    ],
  });
  assert.match(
    labelAt(ACTIVITY_PHASE_WORD_AFTER_MS, reading),
    /^reading · …\/.*MessageRow\.tsx$/,
  );
});
