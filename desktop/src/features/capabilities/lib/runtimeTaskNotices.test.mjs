import assert from "node:assert/strict";
import { it } from "node:test";
import {
  TASK_NOTICE_KEY,
  taskNoticeScope,
  taskNeedsAttention,
  taskNoticeRevision,
  taskNoticeTitle,
  visibleTaskNotices,
  dismissTaskNotices,
  readTaskNoticeMemory,
  writeTaskNoticeMemory,
} from "./runtimeTaskNotices.ts";

const issue = (patch = {}) => ({
  taskId: "first",
  conversationId: "conversation-a",
  residentPubkey: "resident-a",
  runtimeFamily: "codex",
  operation: "continue_session",
  controlOwner: "polyphonic",
  summary: "Private test prompt. Reply exactly QA_MARKER",
  state: "failed",
  updatedAt: "2026-11-09T20:01:00Z",
  error: "A diagnostic /private/path",
  ...patch,
});
const since = Date.parse("2026-11-09T20:00:00Z");
const empty = () => ({ since, dismissed: {} });

it("keeps routine outcomes and acknowledged native handoffs quiet", () => {
  for (const state of [
    "queued",
    "active",
    "stopping",
    "succeeded",
    "stopped",
    "awaiting_native",
  ]) {
    assert.equal(taskNeedsAttention(issue({ state })), false);
  }
  assert.equal(
    taskNeedsAttention(
      issue({ state: "succeeded", deliveryState: "retryable" }),
    ),
    true,
  );
  assert.equal(
    taskNeedsAttention(
      issue({
        state: "succeeded",
        controlOwner: "native_app",
        deliveryState: "retryable",
      }),
    ),
    false,
  );
  assert.equal(
    taskNeedsAttention(
      issue({ state: "interrupted", controlOwner: "native_app" }),
    ),
    true,
  );
});

it("archives pre-upgrade terminal receipts without changing their history", () => {
  const old = issue({ updatedAt: "2026-11-08T12:30:00Z" });
  const tasks = [old, issue()];
  assert.deepEqual(visibleTaskNotices(tasks, empty()), [tasks[1]]);
  assert.equal(old.state, "failed");
  assert.equal(tasks.length, 2);
});

it("dismissing the current batch does not reveal the next old receipt", () => {
  const tasks = [issue(), issue({ taskId: "second", state: "interrupted" })];
  const saved = dismissTaskNotices(empty(), tasks);
  assert.deepEqual(visibleTaskNotices(tasks, saved), []);
  assert.deepEqual(
    visibleTaskNotices([...tasks, issue({ taskId: "new" })], saved).map(
      (t) => t.taskId,
    ),
    ["new"],
  );
});

it("acknowledgement survives refresh but a changed failure is eligible", () => {
  const task = issue();
  const saved = dismissTaskNotices(empty(), [task]);
  assert.deepEqual(
    visibleTaskNotices([issue({ updatedAt: "2026-11-10T20:01:00Z" })], saved),
    [],
  );
  assert.equal(
    visibleTaskNotices(
      [issue({ error: "A genuinely different failure" })],
      saved,
    ).length,
    1,
  );
  assert.equal(taskNoticeRevision(task).includes("private"), false);
  assert.equal(taskNoticeRevision(task).length, 64);
});

it("same task id in another conversation is not acknowledged", () => {
  const saved = dismissTaskNotices(empty(), [issue()]);
  assert.equal(
    visibleTaskNotices([issue({ conversationId: "conversation-b" })], saved)
      .length,
    1,
  );
});

it("restores acknowledgements only in their owner/community scope", () => {
  const scope = taskNoticeScope("owner-a", "community-a");
  const saved = dismissTaskNotices(empty(), [issue()]);
  const storage = {
    getItem: (key) =>
      key === `${TASK_NOTICE_KEY}:${scope}` ? JSON.stringify(saved) : null,
  };
  assert.deepEqual(readTaskNoticeMemory(storage, scope, since + 100), saved);
  for (const other of [
    taskNoticeScope("owner-b", "community-a"),
    taskNoticeScope("owner-a", "community-b"),
  ])
    assert.deepEqual(readTaskNoticeMemory(storage, other, since + 100), {
      since: since + 100,
      dismissed: {},
    });
});

it("corrupt/unavailable storage degrades to session-only presentation", () => {
  for (const storage of [
    { getItem: () => "{" },
    {
      getItem: () => {
        throw new Error("unavailable");
      },
    },
  ]) {
    assert.deepEqual(readTaskNoticeMemory(storage, "scope", since), empty());
  }
});

it("never shows raw task prompts as notice titles", () => {
  assert.equal(taskNoticeTitle(issue()), "Codex task needs attention");
  assert.equal(
    taskNoticeTitle(issue({ controlOwner: "native_app" })),
    "Check delivery in Codex",
  );
  assert.equal(
    taskNoticeTitle(issue({ state: "succeeded", deliveryState: "blocked" })),
    "Return the Codex result",
  );
});

it("two windows acknowledging different problems cannot overwrite each other", () => {
  const values = new Map();
  const storage = {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const first = issue();
  const second = issue({ taskId: "other-window" });
  // Both windows started from the same old snapshot, like concurrent writers.
  writeTaskNoticeMemory(storage, "scope", dismissTaskNotices(empty(), [first]));
  writeTaskNoticeMemory(
    storage,
    "scope",
    dismissTaskNotices(empty(), [second]),
  );
  const restored = readTaskNoticeMemory(storage, "scope", since + 1000);
  assert.deepEqual(visibleTaskNotices([first, second], restored), []);
  assert.equal(
    visibleTaskNotices([issue({ error: "A new problem" })], restored).length,
    1,
  );
});
