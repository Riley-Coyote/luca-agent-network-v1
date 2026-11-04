import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPendingInboxReply,
  pendingInboxReplyKey,
  pendingInboxReplyTarget,
  pendingInboxReplyRequest,
} from "./pendingInboxReply.ts";

function store() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("unchanged retries reuse persisted identity across task and window lifetimes", async () => {
  const storage = store();
  const keyA = await pendingInboxReplyKey(
    "task-a",
    "payload-a",
    undefined,
    storage,
  );
  const keyB = await pendingInboxReplyKey(
    "task-b",
    "payload-b",
    undefined,
    storage,
  );
  assert.notEqual(keyA, keyB);
  assert.equal(
    await pendingInboxReplyKey("task-a", "payload-a", undefined, storage),
    keyA,
  );
  assert.equal(
    [...storage.values.values()].some((value) => value.includes("payload-a")),
    false,
  );
});

test("editing payload or successful acknowledgement rotates identity", async () => {
  const storage = store();
  const first = await pendingInboxReplyKey(
    "task-a",
    "first",
    undefined,
    storage,
  );
  const edited = await pendingInboxReplyKey(
    "task-a",
    "edited",
    undefined,
    storage,
  );
  assert.notEqual(first, edited);
  clearPendingInboxReply("task-a", first, storage);
  assert.equal(
    await pendingInboxReplyKey("task-a", "edited", undefined, storage),
    edited,
  );
  clearPendingInboxReply("task-a", edited, storage);
  assert.notEqual(
    await pendingInboxReplyKey("task-a", "edited", undefined, storage),
    edited,
  );
});

test("explicit message target survives reopening without copying message content", async () => {
  const storage = store();
  const target = "a".repeat(64);
  await pendingInboxReplyKey("draft", "payload", target, storage);
  assert.equal(pendingInboxReplyTarget("draft", storage), target);
});

test("unwritable retry identity fails before dispatch rather than using a temporary key", async () => {
  await assert.rejects(
    pendingInboxReplyKey("draft", "payload", undefined, {
      getItem: () => null,
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {},
    }),
    /Nothing was sent/,
  );
});

test("an accepted continuation keeps its original operation after native phase changes", async () => {
  const storage = store();
  const first = await pendingInboxReplyRequest(
    "logical-task",
    "unchanged-body",
    "continuation",
    undefined,
    storage,
    "original-attempt",
  );
  const afterNativeOpened = await pendingInboxReplyRequest(
    "logical-task",
    "unchanged-body",
    "reply",
    undefined,
    storage,
    "new-current-attempt",
  );
  assert.equal(afterNativeOpened.idempotencyKey, first.idempotencyKey);
  assert.equal(afterNativeOpened.operation, "continuation");
  assert.equal(afterNativeOpened.exchangeId, "original-attempt");
  const edited = await pendingInboxReplyRequest(
    "logical-task",
    "edited-body",
    "reply",
    undefined,
    storage,
  );
  assert.notEqual(edited.idempotencyKey, first.idempotencyKey);
  assert.equal(edited.operation, "reply");
});
