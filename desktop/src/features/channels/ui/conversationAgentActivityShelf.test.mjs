import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  ACTIVITY_ELAPSED_AFTER_MS,
  ACTIVITY_LONG_WAIT_AFTER_MS,
  ACTIVITY_PHASE_WORD_AFTER_MS,
  EMPTY_ACTIVITY_SHELF_SLOTS,
  activityAnnouncementDelta,
  activityLongWaitLabel,
  activityShelfRetryTarget,
  activityShelfOverflow,
  activityStopOutcome,
  activityWaitTier,
  conversationActivityLabel,
  currentActivityStep,
  isTerminalConversationActivity,
  nextActivityWaitChangeMs,
  reconcileActivityShelfSlots,
} from "./conversationAgentActivityShelf.ts";

function step(overrides = {}) {
  return {
    count: null,
    detail: null,
    kind: "other",
    label: "Working",
    status: "active",
    step: 1,
    ...overrides,
  };
}

describe("conversationAgentActivityShelf", () => {
  it("keeps visible residents in stable positions as hidden work advances", () => {
    const four = reconcileActivityShelfSlots(EMPTY_ACTIVITY_SHELF_SLOTS, [
      "anima",
      "luca",
      "codex",
      "claude",
    ]);
    assert.deepEqual(four.slots, ["anima", "luca", "codex"]);
    assert.deepEqual(activityShelfOverflow(four), ["claude"]);
    assert.equal(four.capacity, 3);

    const promoted = reconcileActivityShelfSlots(four, [
      "anima",
      "codex",
      "claude",
    ]);
    assert.deepEqual(promoted.slots, ["anima", "claude", "codex"]);
    assert.equal(promoted.capacity, 3);
  });

  it("preserves activation order and deduplicates repeated sources", () => {
    const first = reconcileActivityShelfSlots(EMPTY_ACTIVITY_SHELF_SLOTS, [
      "luca",
      "luca",
      "codex",
    ]);
    const eight = reconcileActivityShelfSlots(first, [
      "luca",
      "codex",
      "claude",
      "hermes",
      "openclaw",
      "anima",
      "vektor",
      "mara",
    ]);

    assert.deepEqual(eight.slots, ["luca", "codex", "claude"]);
    assert.deepEqual(eight.order, [
      "luca",
      "codex",
      "claude",
      "hermes",
      "openclaw",
      "anima",
      "vektor",
      "mara",
    ]);
    assert.deepEqual(activityShelfOverflow(eight), [
      "hermes",
      "openclaw",
      "anima",
      "vektor",
      "mara",
    ]);
  });

  it("does not shrink sibling geometry until the batch fully ends", () => {
    const three = reconcileActivityShelfSlots(EMPTY_ACTIVITY_SHELF_SLOTS, [
      "a",
      "b",
      "c",
    ]);
    const one = reconcileActivityShelfSlots(three, ["c"]);
    assert.deepEqual(one.slots, [null, null, "c"]);
    assert.equal(one.capacity, 3);

    const empty = reconcileActivityShelfSlots(one, []);
    assert.deepEqual(empty, EMPTY_ACTIVITY_SHELF_SLOTS);
  });

  it("provides complete, truthful state labels", () => {
    assert.equal(conversationActivityLabel("thinking"), "Thinking");
    assert.equal(conversationActivityLabel("working"), "Working");
    assert.equal(conversationActivityLabel("writing"), "Writing");
    assert.equal(conversationActivityLabel("finalizing"), "Finalizing");
    assert.equal(conversationActivityLabel("stopping"), "Stopping");
    assert.equal(conversationActivityLabel("stopped"), "Stopped");
    assert.equal(
      conversationActivityLabel("interrupted"),
      "Interrupted after restart",
    );
    assert.equal(
      conversationActivityLabel("needs-attention"),
      "Needs attention",
    );
    assert.equal(conversationActivityLabel("settled"), "Done");
    assert.equal(
      isTerminalConversationActivity("settled"),
      false,
      "a run that answered is finished, not unfinished business",
    );
    assert.equal(isTerminalConversationActivity("stopped"), true);
    assert.equal(isTerminalConversationActivity("interrupted"), true);
    assert.equal(isTerminalConversationActivity("needs-attention"), true);
    assert.equal(isTerminalConversationActivity("writing"), false);
  });

  it("never classifies a missing exact cancellation as stopped", () => {
    assert.deepEqual(activityStopOutcome([]), {
      result: "failed",
      state: "needs-attention",
    });
    assert.deepEqual(activityStopOutcome(["failed"]), {
      result: "failed",
      state: "needs-attention",
    });
    assert.deepEqual(activityStopOutcome(["stopped", "ambiguous"]), {
      result: "ambiguous",
      state: "needs-attention",
    });
    assert.deepEqual(activityStopOutcome(["stopped"]), {
      result: "stopped",
      state: "stopped",
    });
  });

  it("offers retry only for an exact terminal presentation", () => {
    assert.deepEqual(
      activityShelfRetryTarget(
        "interrupted",
        "resident",
        "managed:resident:restart",
      ),
      {
        residentPubkey: "resident",
        uiKey: "managed:resident:restart",
      },
    );
    assert.deepEqual(
      activityShelfRetryTarget("stopped", "resident", "managed:resident:1"),
      { residentPubkey: "resident", uiKey: "managed:resident:1" },
    );
    assert.equal(
      activityShelfRetryTarget("needs-attention", "resident", null),
      null,
    );
    assert.deepEqual(
      activityShelfRetryTarget("failed", "resident", "managed:resident:2"),
      { residentPubkey: "resident", uiKey: "managed:resident:2" },
    );
    assert.deepEqual(
      activityShelfRetryTarget(
        "needs_attention",
        "resident",
        "managed:resident:3",
      ),
      { residentPubkey: "resident", uiKey: "managed:resident:3" },
    );
    assert.equal(
      activityShelfRetryTarget("writing", "resident", "managed:resident:1"),
      null,
    );
  });

  it("announces only meaningful resident lifecycle deltas", () => {
    const started = new Map([
      ["luca", { name: "Luca", state: "thinking" }],
      ["codex", { name: "Codex", state: "working" }],
    ]);
    assert.equal(
      activityAnnouncementDelta(new Map(), started),
      "Luca started. Codex started",
    );
    const writing = new Map([
      ["luca", { name: "Luca", state: "writing" }],
      ["codex", { name: "Codex", state: "working" }],
    ]);
    assert.equal(
      activityAnnouncementDelta(started, writing),
      "Luca began writing",
    );
    assert.equal(activityAnnouncementDelta(writing, writing), "");
    const stopped = new Map([
      ["luca", { name: "Luca", state: "stopped" }],
      ["codex", { name: "Codex", state: "working" }],
    ]);
    assert.equal(activityAnnouncementDelta(writing, stopped), "Luca stopped");
    assert.equal(
      activityAnnouncementDelta(
        writing,
        new Map([
          ["luca", { name: "Luca", state: "interrupted" }],
          ["codex", { name: "Codex", state: "working" }],
        ]),
      ),
      "Luca was interrupted after restart",
    );
    assert.equal(
      activityAnnouncementDelta(
        stopped,
        new Map([["codex", { name: "Codex", state: "working" }]]),
      ),
      "",
    );
    assert.equal(
      activityAnnouncementDelta(
        new Map([["codex", { name: "Codex", state: "finalizing" }]]),
        new Map(),
      ),
      "Codex replied",
    );
    assert.equal(
      activityAnnouncementDelta(
        new Map([["mara", { name: "Mara", state: "working" }]]),
        new Map([["mara", { name: "Mara", state: "needs-attention" }]]),
      ),
      "Mara failed",
    );
  });

  it("keeps the resident details control at a 28px minimum target", async () => {
    const css = await readFile(
      new URL("./conversationAgentActivityShelf.css", import.meta.url),
      "utf8",
    );
    const residentRule = css.match(
      /\.luca-activity-item__resident\s*\{([\s\S]*?)\}/,
    );

    assert.ok(residentRule);
    assert.match(residentRule[1], /min-height:\s*28px/);
  });

  it("still announces the reply when the work summary stays behind", () => {
    const working = new Map([["luca", { name: "Luca", state: "writing" }]]);
    assert.equal(
      activityAnnouncementDelta(
        working,
        new Map([["luca", { name: "Luca", state: "settled" }]]),
      ),
      "Luca replied",
      "the line no longer departs, so the departure cannot carry the news",
    );
  });
});

describe("wait disclosure", () => {
  it("says nothing about ordinary latency and more as the wait grows", () => {
    assert.equal(activityWaitTier(0), "indicator");
    assert.equal(
      activityWaitTier(ACTIVITY_PHASE_WORD_AFTER_MS - 1),
      "indicator",
    );
    assert.equal(activityWaitTier(ACTIVITY_PHASE_WORD_AFTER_MS), "phase");
    assert.equal(activityWaitTier(ACTIVITY_ELAPSED_AFTER_MS - 1), "phase");
    assert.equal(activityWaitTier(ACTIVITY_ELAPSED_AFTER_MS), "elapsed");
    assert.equal(activityWaitTier(ACTIVITY_LONG_WAIT_AFTER_MS - 1), "elapsed");
    assert.equal(activityWaitTier(ACTIVITY_LONG_WAIT_AFTER_MS), "long");
    assert.equal(activityWaitTier(10 * 60_000), "long");
    assert.ok(
      ACTIVITY_PHASE_WORD_AFTER_MS < ACTIVITY_ELAPSED_AFTER_MS &&
        ACTIVITY_ELAPSED_AFTER_MS < ACTIVITY_LONG_WAIT_AFTER_MS,
    );
  });

  it("sleeps to the next thing it would say, not to the next second", () => {
    // Below the clock the words are fixed, so the only wake worth taking is
    // the tier boundary itself.
    assert.equal(nextActivityWaitChangeMs(0), ACTIVITY_PHASE_WORD_AFTER_MS);
    assert.equal(nextActivityWaitChangeMs(ACTIVITY_PHASE_WORD_AFTER_MS - 1), 1);
    assert.equal(
      nextActivityWaitChangeMs(ACTIVITY_PHASE_WORD_AFTER_MS),
      ACTIVITY_ELAPSED_AFTER_MS - ACTIVITY_PHASE_WORD_AFTER_MS,
    );
    // Once the clock is on screen, align to the whole second so the digits
    // turn on the second rather than on the turn's own start offset.
    assert.equal(nextActivityWaitChangeMs(ACTIVITY_ELAPSED_AFTER_MS), 1_000);
    assert.equal(
      nextActivityWaitChangeMs(ACTIVITY_ELAPSED_AFTER_MS + 250),
      750,
    );
    assert.equal(
      nextActivityWaitChangeMs(ACTIVITY_LONG_WAIT_AFTER_MS - 400),
      400,
    );
    // Never zero: a zero-delay chain would spin.
    for (const elapsed of [0, 1, 999, 3_000, 9_999, 10_000, 61_234]) {
      assert.ok(
        nextActivityWaitChangeMs(elapsed) > 0,
        `expected a positive wait at ${elapsed}ms`,
      );
    }
  });

  it("acknowledges a long wait without inventing a new sentence", () => {
    assert.equal(activityLongWaitLabel("Thinking"), "Still thinking");
    assert.equal(
      activityLongWaitLabel("Reading MessageRow.tsx"),
      "Still reading MessageRow.tsx",
    );
    assert.equal(activityLongWaitLabel("Still thinking"), "Still thinking");
    assert.equal(activityLongWaitLabel(""), "");
  });

  it("collapses a run to whatever is happening now", () => {
    assert.equal(currentActivityStep([]), null);
    const steps = [
      step({ status: "done", step: 1 }),
      step({ label: "Reading", status: "active", step: 2 }),
      step({ label: "Waiting", status: "active", step: 3 }),
    ];
    assert.equal(
      currentActivityStep(steps).step,
      3,
      "the newest live step wins",
    );
    const finished = [
      step({ status: "done", step: 1 }),
      step({ label: "Reading", status: "done", step: 2 }),
    ];
    assert.equal(
      currentActivityStep(finished).step,
      2,
      "with nothing live, the last thing that ran is the line",
    );
  });
});
