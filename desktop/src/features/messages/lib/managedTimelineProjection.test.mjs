import assert from "node:assert/strict";
import test from "node:test";

import { projectManagedTimelineMessages } from "./managedTimelineProjection.ts";

const pubkey = "a".repeat(64);

function message(id, createdAt, overrides = {}) {
  return {
    id,
    createdAt,
    author: "Riley",
    time: "10:00 PM",
    body: id,
    depth: 0,
    ...overrides,
  };
}

function slot(overrides = {}) {
  return {
    anchorAt: 2_000_000_000_000,
    anchorKey: "owner",
    conversationId: "room",
    finalMessageId: null,
    residentPubkey: pubkey,
    responseSurface: "timeline",
    slotOrdinal: 1,
    uiKey: `managed:${pubkey}:receipt`,
    ...overrides,
  };
}

test("projects one stable managed row after its first-visible anchor", () => {
  const result = projectManagedTimelineMessages(
    [message("owner", 1_999_999_999), message("later", 2_000_000_001)],
    [slot()],
  );

  assert.deepEqual(
    result.messages.map((item) => item.id),
    ["owner", `managed:${pubkey}:receipt`, "later"],
  );
  assert.equal(result.messages[1].renderKey, `managed:${pubkey}:receipt`);
  assert.equal(result.messages[1].body, "");
});

test("hydrates a signed final in the same render slot without a duplicate", () => {
  const final = message("signed", 2_002, {
    author: "Luca",
    body: "hello",
    depth: 1,
    parentId: "owner",
    rootId: "owner",
    pubkey,
  });
  const result = projectManagedTimelineMessages(
    [message("owner", 1_999_999_999), final],
    [slot({ finalMessageId: "signed" })],
  );

  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[1].id, "signed");
  assert.equal(result.messages[1].renderKey, `managed:${pubkey}:receipt`);
  assert.equal(result.messages[1].managedPresentation.finalMessageId, "signed");
  assert.equal(result.messages[1].depth, 0);
  assert.equal(result.messages[1].parentId, null);
  assert.equal(result.messages[1].rootId, null);
  assert.equal(result.suppressedFinalMessageIds.has("signed"), true);
});

test("keeps thread-surface slots out of the main transcript", () => {
  const result = projectManagedTimelineMessages(
    [message("owner", 1_999_999_999)],
    [
      slot({
        responseSurface: "thread",
        uiKey: `managed:${pubkey}:thread`,
      }),
    ],
  );

  assert.deepEqual(
    result.messages.map((item) => item.id),
    ["owner"],
  );
});

test("anchors a thread-surface slot beneath the owner reply", () => {
  const ownerReply = message("owner-reply", 1_999_999_999, {
    depth: 1,
    parentId: "thread-head",
    rootId: "thread-head",
  });
  const result = projectManagedTimelineMessages(
    [message("thread-head", 1_999_999_998), ownerReply],
    [slot({ anchorKey: "owner-reply", responseSurface: "thread" })],
    undefined,
    undefined,
    "thread",
  );

  const response = result.messages[2];
  assert.equal(response.parentId, "owner-reply");
  assert.equal(response.rootId, "thread-head");
  assert.equal(response.depth, 2);
});

test("projects multiple stable slots in first-visible order", () => {
  const result = projectManagedTimelineMessages(
    [message("owner", 1_999_999_999)],
    [
      slot(),
      slot({
        slotOrdinal: 2,
        uiKey: `managed:${pubkey}:failed`,
      }),
    ],
  );

  assert.deepEqual(
    result.messages.slice(1).map((item) => item.renderKey),
    [`managed:${pubkey}:receipt`, `managed:${pubkey}:failed`],
  );
});

test("carries trusted persona metadata into the provisional slot", () => {
  const personaIds = new Map([[pubkey, "builtin:direct-runtime:codex"]]);
  const result = projectManagedTimelineMessages(
    [message("owner", 1_999_999_999)],
    [slot()],
    undefined,
    personaIds,
  );

  assert.equal(
    result.messages[1].residentPersonaId,
    "builtin:direct-runtime:codex",
  );
});
