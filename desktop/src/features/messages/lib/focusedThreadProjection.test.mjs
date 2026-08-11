import assert from "node:assert/strict";
import test from "node:test";

import { projectFocusedThreadTimeline } from "./focusedThreadProjection.ts";

const residentPubkey = "a".repeat(64);

function message(id, createdAt, overrides = {}) {
  return {
    id,
    createdAt,
    pubkey: "owner",
    author: "Riley",
    time: "10:00 PM",
    body: id,
    parentId: null,
    rootId: null,
    depth: 0,
    accent: false,
    kind: 9,
    tags: [],
    ...overrides,
  };
}

function entry(item, summary = null) {
  return { message: item, summary };
}

function slot(overrides = {}) {
  return {
    anchorAt: 4_000,
    anchorKey: "thread-reply",
    conversationId: "room",
    finalMessageId: null,
    residentPubkey,
    responseSurface: "thread",
    slotOrdinal: 1,
    uiKey: `managed:${residentPubkey}:receipt`,
    ...overrides,
  };
}

test("rebuilds a focused thread from fetched replies after relaunch", () => {
  const head = message("thread-head", 1);
  const reply = message("thread-reply", 2, {
    parentId: head.id,
    rootId: head.id,
    depth: 1,
  });
  const nested = message("nested-reply", 3, {
    parentId: reply.id,
    rootId: head.id,
    depth: 2,
  });
  const retainedSummary = {
    threadHeadId: reply.id,
    replyCount: 4,
    lastReplyAt: 9,
    participants: [],
  };

  const result = projectFocusedThreadTimeline({
    focusedHeadId: head.id,
    managedResponseSlots: [],
    roomMessages: [head, message("unrelated", 4)],
    threadHeadMessage: head,
    threadMessages: [entry(reply, retainedSummary), entry(nested)],
  });

  assert.equal(result.head, head);
  assert.deepEqual(
    result.entries.map((item) => item.message.id),
    [head.id, reply.id, nested.id],
  );
  assert.equal(result.entries[1].summary, retainedSummary);
  assert.equal(
    result.entries.some((item) => item.message.id === "unrelated"),
    false,
  );
});

test("adds only process-memory slots belonging to the focused thread surface", () => {
  const head = message("thread-head", 1);
  const reply = message("thread-reply", 2, {
    parentId: head.id,
    rootId: head.id,
    depth: 1,
  });
  const threadSlot = slot();
  const timelineSlot = slot({
    responseSurface: "timeline",
    uiKey: `managed:${residentPubkey}:timeline`,
  });

  const result = projectFocusedThreadTimeline({
    focusedHeadId: head.id,
    managedResponseSlots: [threadSlot, timelineSlot],
    roomMessages: [head],
    threadHeadMessage: null,
    threadMessages: [entry(reply)],
  });

  assert.deepEqual(
    result.entries.map((item) => item.message.renderKey ?? item.message.id),
    [head.id, reply.id, threadSlot.uiKey],
  );
  assert.equal(result.entries[2].message.parentId, reply.id);
  assert.equal(result.entries[2].message.rootId, head.id);
});

test("hydrates a fetched signed thread final in its stable process-memory slot", () => {
  const head = message("thread-head", 1);
  const reply = message("owner-reply", 2, {
    parentId: head.id,
    rootId: head.id,
    depth: 1,
  });
  const final = message("signed-final", 3, {
    author: "Luca",
    isAgent: true,
    parentId: reply.id,
    pubkey: residentPubkey,
    rootId: head.id,
    depth: 2,
  });
  const stableSlot = slot({
    anchorKey: reply.id,
    finalMessageId: final.id,
  });

  const result = projectFocusedThreadTimeline({
    focusedHeadId: head.id,
    managedResponseSlots: [stableSlot],
    roomMessages: [head],
    threadHeadMessage: head,
    threadMessages: [entry(reply), entry(final)],
  });

  assert.deepEqual(
    result.entries.map((item) => item.message.id),
    [head.id, reply.id, final.id],
  );
  assert.equal(result.entries[2].message.renderKey, stableSlot.uiKey);
  assert.equal(
    result.entries.filter((item) => item.message.id === final.id).length,
    1,
  );
});
