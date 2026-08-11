import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  EMPTY_ACTIVITY_SHELF_SLOTS,
  activityAnnouncementDelta,
  activityShelfRetryTarget,
  activityShelfOverflow,
  activityStopOutcome,
  conversationActivityLabel,
  isTerminalConversationActivity,
  reconcileActivityShelfSlots,
} from "./conversationAgentActivityShelf.ts";

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
      conversationActivityLabel("needs-attention"),
      "Needs attention",
    );
    assert.equal(isTerminalConversationActivity("stopped"), true);
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
});
