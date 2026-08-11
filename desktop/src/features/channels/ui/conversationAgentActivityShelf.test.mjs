import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  EMPTY_ACTIVITY_SHELF_SLOTS,
  activityShelfOverflow,
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
