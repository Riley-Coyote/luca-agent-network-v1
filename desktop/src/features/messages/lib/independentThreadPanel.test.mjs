import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIndependentThreadPanel,
  resolveThreadQueryRootId,
} from "./independentThreadPanel.ts";

const CHANNEL_ID = "channel-1";
const OWNER = "a".repeat(64);
const RESIDENT = "b".repeat(64);

function event(id, createdAt, pubkey, tags) {
  return {
    id,
    pubkey,
    created_at: createdAt,
    kind: 9,
    tags: [["h", CHANNEL_ID], ...tags],
    content: id,
    sig: "c".repeat(128),
  };
}

test("a depth-one focused head fetches by canonical root and projects only its depth-two branch", () => {
  const canonicalRoot = event("root", 1, OWNER, []);
  const selectedHead = event("selected-head", 2, RESIDENT, [
    ["e", canonicalRoot.id, "", "reply"],
    ["broadcast", "1"],
  ]);
  const unrelatedRootChild = event("other-root-child", 3, OWNER, [
    ["e", canonicalRoot.id, "", "reply"],
  ]);
  const ownerReply = event("owner-reply", 4, OWNER, [
    ["e", canonicalRoot.id, "", "root"],
    ["e", selectedHead.id, "", "reply"],
  ]);
  const residentReply = event("resident-reply", 5, RESIDENT, [
    ["e", canonicalRoot.id, "", "root"],
    ["e", selectedHead.id, "", "reply"],
  ]);

  assert.equal(
    resolveThreadQueryRootId([canonicalRoot, selectedHead], selectedHead.id),
    canonicalRoot.id,
  );

  const panel = buildIndependentThreadPanel(
    [canonicalRoot, selectedHead],
    [selectedHead, unrelatedRootChild, ownerReply, residentReply],
    selectedHead.id,
    null,
    new Set(),
    null,
    OWNER,
    null,
  );

  assert.equal(panel.threadHead?.id, selectedHead.id);
  assert.equal(panel.totalReplyCount, 2);
  assert.deepEqual(
    panel.visibleReplies.map((reply) => reply.message.id),
    [ownerReply.id, residentReply.id],
  );
});

test("thread query root falls back to the selected id until its event is loaded", () => {
  assert.equal(resolveThreadQueryRootId([], "not-loaded"), "not-loaded");
  assert.equal(resolveThreadQueryRootId([], null), null);
});
