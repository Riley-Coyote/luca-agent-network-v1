import assert from "node:assert/strict";
import { test, afterEach, beforeEach } from "node:test";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import {
  applyActivityTraceSnapshot,
  getActivityTrace,
  getConversationActivityTraces,
  resetActivityTraceStore,
  refreshActivityTraces,
  subscribeActivityTraces,
} from "./activityTraceStore.ts";

beforeEach(() => {
  globalThis.window = {};
});
afterEach(() => {
  resetActivityTraceStore();
  clearMocks();
  delete globalThis.window;
});
const trace = (fields = {}) => ({
  conversationId: "conversation-a",
  residentPubkey: "resident-a",
  dispatchReceiptId: "dispatch-a",
  turnId: "turn-a",
  finalMessageId: null,
  startedAt: 100,
  endedAt: null,
  status: "working",
  entries: [],
  truncated: false,
  ...fields,
});

test("exact dispatch and signed final lookup never use latest resident heuristics", () => {
  applyActivityTraceSnapshot([
    trace(),
    trace({
      dispatchReceiptId: "dispatch-b",
      turnId: "turn-b",
      finalMessageId: "final-b",
      status: "completed",
    }),
    trace({ conversationId: "other", finalMessageId: "final-a" }),
  ]);
  assert.equal(
    getActivityTrace({
      conversationId: "conversation-a",
      residentPubkey: "resident-a",
    }),
    null,
  );
  assert.equal(
    getActivityTrace({
      conversationId: "conversation-a",
      residentPubkey: "resident-a",
      finalMessageId: "final-b",
    })?.dispatchReceiptId,
    "dispatch-b",
  );
  assert.equal(
    getActivityTrace({
      conversationId: "conversation-a",
      residentPubkey: "resident-a",
      dispatchReceiptId: "dispatch-a",
      finalMessageId: "final-b",
    }),
    null,
  );
  assert.equal(
    getActivityTrace({
      conversationId: "conversation-a",
      residentPubkey: "wrong",
      dispatchReceiptId: "dispatch-a",
    }),
    null,
  );
});

test("hydration restores terminal turns without signed messages and preserves stable references", () => {
  const stopped = trace({ status: "cancelled", endedAt: 200 });
  applyActivityTraceSnapshot([stopped]);
  const snapshot = getConversationActivityTraces("conversation-a");
  let notified = 0;
  const dispose = subscribeActivityTraces(() => {
    notified += 1;
  });
  applyActivityTraceSnapshot([{ ...stopped }]);
  assert.equal(getConversationActivityTraces("conversation-a"), snapshot);
  assert.equal(notified, 0);
  applyActivityTraceSnapshot([
    stopped,
    trace({ residentPubkey: "resident-b" }),
  ]);
  assert.equal(getConversationActivityTraces("conversation-a")[0], snapshot[0]);
  assert.equal(notified, 1);
  dispose();
});

test("community reset clears every trace including terminal history", () => {
  applyActivityTraceSnapshot([trace({ status: "interrupted", endedAt: 200 })]);
  resetActivityTraceStore();
  assert.deepEqual(getConversationActivityTraces("conversation-a"), []);
  assert.equal(
    getActivityTrace({
      conversationId: "conversation-a",
      residentPubkey: "resident-a",
      dispatchReceiptId: "dispatch-a",
    }),
    null,
  );
});

test("a native snapshot resolved after community reset cannot restore old data", async () => {
  let resolve;
  mockIPC(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = refreshActivityTraces();
  resetActivityTraceStore();
  resolve([trace()]);
  await pending;
  assert.deepEqual(getConversationActivityTraces("conversation-a"), []);
});

test("concurrent refresh requests share one in-flight IPC and exact row reads do not hydrate", async () => {
  let resolve;
  let requests = 0;
  mockIPC(() => {
    requests += 1;
    return requests === 1
      ? new Promise((done) => {
          resolve = done;
        })
      : [];
  });
  const pending = refreshActivityTraces();
  void refreshActivityTraces();
  void refreshActivityTraces();
  for (let i = 0; i < 50; i += 1)
    getActivityTrace({
      conversationId: "conversation-a",
      residentPubkey: "resident-a",
      dispatchReceiptId: `dispatch-${i}`,
    });
  assert.equal(requests, 1);
  resolve([]);
  await pending;
  await Promise.resolve();
  assert.equal(
    requests,
    2,
    "invalidation during hydration gets one coalesced follow-up",
  );
});
