import assert from "node:assert/strict";
import test from "node:test";
import {
  correspondenceDraftKey,
  correspondenceTitle,
  correspondencePairFilter,
  inboxLogicalTaskId,
  correspondenceTasks,
  validateCorrespondenceRead,
  mergeCorrespondenceReads,
  taskUnreadCount,
} from "./correspondenceView.ts";

const scope = { communityId: "community-a", ownerPubkey: "owner-a" };
const task = (id, at = 1, correspondenceId = "pair-a", owner = "owner-a") => ({
  correspondenceId,
  record: { exchangeId: id, owner },
  recordUpdatedAt: at,
});
const page = (tasks, overrides = {}) => ({ scope, tasks, ...overrides });

test("task pages preserve identity and newest heads without leaking another pair or scope", () => {
  const newest = task("one", 3);
  const result = correspondenceTasks(
    [
      page([
        task("one"),
        task("other-pair", 1, "pair-b"),
        task("other-owner", 1, "pair-a", "owner-b"),
      ]),
      page([newest, task("two")]),
      page([task("foreign")], {
        scope: { ...scope, communityId: "community-b" },
      }),
    ],
    "pair-a",
    "owner-a",
  );
  assert.deepEqual(
    result.map((item) => item.record.exchangeId),
    ["one", "two"],
  );
  assert.equal(result[0], newest);
});

test("draft key isolates every authority and destination dimension", () => {
  const original = correspondenceDraftKey(
    scope,
    "pair-a",
    "task-a",
    "resident-a",
  );
  assert.equal(
    original,
    correspondenceDraftKey(scope, "pair-a", "task-a", "resident-a"),
  );
  for (const value of [
    correspondenceDraftKey(
      { ...scope, communityId: "community-b" },
      "pair-a",
      "task-a",
      "resident-a",
    ),
    correspondenceDraftKey(
      { ...scope, ownerPubkey: "owner-b" },
      "pair-a",
      "task-a",
      "resident-a",
    ),
    correspondenceDraftKey(scope, "pair-b", "task-a", "resident-a"),
    correspondenceDraftKey(scope, "pair-a", "task-b", "resident-a"),
    correspondenceDraftKey(scope, "pair-a", "task-a", "resident-b"),
  ])
    assert.notEqual(value, original);
});

test("exact task reads cannot substitute task, correspondence, source owner or community", () => {
  const read = { scope, task: task("one"), events: [] };
  assert.equal(
    validateCorrespondenceRead(read, "pair-a", "one", "owner-a", scope),
    read,
  );
  const substitutions = [
    { ...read, task: task("two") },
    { ...read, task: task("one", 1, "pair-b") },
    { ...read, task: task("one", 1, "pair-a", "owner-b") },
    { ...read, scope: { ...scope, ownerPubkey: "owner-b" } },
    { ...read, scope: { ...scope, communityId: "community-b" } },
  ];
  for (const changed of substitutions)
    assert.throws(
      () =>
        validateCorrespondenceRead(changed, "pair-a", "one", "owner-a", scope),
      /no longer belongs/,
    );
});

test("empty filtered pages do not imply the end of history", () => {
  const pages = [
    page([], { nextCursor: { scope, until: 1, beforeId: "cursor" } }),
    page([task("later")]),
  ];
  assert.deepEqual(
    correspondenceTasks(pages, "pair-a", "owner-a").map(
      (item) => item.record.exchangeId,
    ),
    ["later"],
  );
});

test("reply pagination deduplicates canonical roots and keeps event chronology", () => {
  const root = { id: "root", created_at: 1 };
  const first = {
    scope,
    task: task("one"),
    events: [root, { id: "recent", created_at: 3 }],
    nextOwnerReplyCursor: { scope, until: 2, beforeId: "cursor" },
    partial: true,
  };
  const older = {
    ...first,
    events: [root, { id: "older", created_at: 2 }],
    nextOwnerReplyCursor: null,
  };
  const merged = mergeCorrespondenceReads([first, older]);
  assert.deepEqual(
    merged.events.map((event) => event.id),
    ["root", "older", "recent"],
  );
  assert.equal(merged.nextOwnerReplyCursor, null);
  assert.equal(merged.partial, true);
  assert.throws(
    () =>
      mergeCorrespondenceReads([first, { ...older, task: task("different") }]),
    /no longer belongs/,
  );
});

test("missing markers never make migrated history unread and owner sends do not inflate counts", () => {
  const events = [
    { id: "a", pubkey: "resident", created_at: 1 },
    { id: "b", pubkey: "resident", created_at: 1 },
    { id: "c", pubkey: "owner", created_at: 2 },
    { id: "d", pubkey: "resident", created_at: 2 },
    { id: "d", pubkey: "resident", created_at: 2 },
  ];
  assert.equal(taskUnreadCount(events, "owner", undefined), null);
  assert.equal(
    taskUnreadCount(events, "owner", { createdAt: 1, eventId: "a" }),
    2,
  );
  assert.equal(
    taskUnreadCount(events, "owner", { createdAt: 2, eventId: "d" }),
    0,
  );
});

test("correspondence titles use resident names and only disambiguate identical names", () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  assert.equal(
    correspondenceTitle([a, b], (key) => (key === a ? "Luca" : "Anima")),
    "Luca & Anima",
  );
  const duplicate = correspondenceTitle([a, b], () => "Alex");
  assert.match(duplicate, /^Alex \(.+\) & Alex \(.+\)$/);
  assert.notEqual(duplicate.split(" & ")[0], duplicate.split(" & ")[1]);
  assert.equal(
    correspondenceTitle([a, b, "c"], () => "Agent"),
    "Agent correspondence",
  );
});

test("validated initial task derives an exact pair without scanning other owner correspondences", () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  const selected = {
    scope,
    task: {
      ...task("old-task", 1),
      record: { ...task("old-task").record, members: [b, a] },
    },
    events: [],
  };
  assert.equal(correspondencePairFilter(undefined, "pair-a", "owner-a"), null);
  assert.deepEqual(correspondencePairFilter(selected, "pair-a", "owner-a"), {
    residentPubkey: a,
    correspondentPubkey: b,
  });
  assert.equal(
    correspondencePairFilter(selected, "other-pair", "owner-a"),
    null,
  );
  assert.equal(
    correspondencePairFilter(selected, "pair-a", "other-owner"),
    null,
  );
  const unrelated = Array.from({ length: 1000 }, (_, i) =>
    task(`other-task-${i}`, 1000 - i, `other-pair-${i}`),
  );
  assert.deepEqual(
    correspondenceTasks([page(unrelated)], "pair-a", "owner-a", selected).map(
      (item) => item.record.exchangeId,
    ),
    ["old-task"],
  );
});

test("a focused task older than loaded pages remains visible without duplication or foreign scope data", () => {
  const selected = { scope, task: task("old-task", 1), events: [] };
  assert.deepEqual(
    correspondenceTasks(
      [page([task("new-task", 10)])],
      "pair-a",
      "owner-a",
      selected,
    ).map((item) => item.record.exchangeId),
    ["new-task", "old-task"],
  );
  const updated = task("old-task", 20);
  assert.deepEqual(
    correspondenceTasks([page([updated])], "pair-a", "owner-a", selected),
    [updated],
  );
  const foreignPage = page([task("foreign-task")], {
    scope: { ...scope, communityId: "community-b" },
  });
  assert.deepEqual(
    correspondenceTasks([foreignPage], "pair-a", "owner-a", selected),
    [selected.task],
  );
});

test("host-verified lineage keeps logical focus while requiring the exact current attempt record", () => {
  const current = { ...task("attempt-2", 20), logicalTaskId: "logical-task" };
  const read = {
    scope,
    logicalTaskId: "logical-task",
    currentAttemptId: "attempt-2",
    task: current,
    events: [],
  };
  assert.equal(inboxLogicalTaskId(current), "logical-task");
  assert.equal(
    validateCorrespondenceRead(
      read,
      "pair-a",
      "logical-task",
      "owner-a",
      scope,
    ),
    read,
  );
  assert.throws(
    () =>
      validateCorrespondenceRead(
        { ...read, currentAttemptId: "wrong" },
        "pair-a",
        "logical-task",
        "owner-a",
        scope,
      ),
    /no longer belongs/,
  );
  assert.throws(
    () =>
      validateCorrespondenceRead(
        { ...read, logicalTaskId: "different" },
        "pair-a",
        "logical-task",
        "owner-a",
        scope,
      ),
    /no longer belongs/,
  );
  const prior = { ...task("attempt-1", 10), logicalTaskId: "logical-task" };
  const withLineage = { ...read, attemptIds: ["attempt-1", "attempt-2"] };
  assert.equal(
    validateCorrespondenceRead(
      withLineage,
      "pair-a",
      "attempt-2",
      "owner-a",
      scope,
    ),
    withLineage,
  );
  assert.equal(
    validateCorrespondenceRead(
      withLineage,
      "pair-a",
      "attempt-1",
      "owner-a",
      scope,
    ),
    withLineage,
  );
  assert.throws(
    () =>
      validateCorrespondenceRead(
        withLineage,
        "pair-a",
        "unrelated",
        "owner-a",
        scope,
      ),
    /no longer belongs/,
  );
  assert.throws(
    () =>
      validateCorrespondenceRead(
        withLineage,
        "other-pair",
        "attempt-2",
        "owner-a",
        scope,
      ),
    /no longer belongs/,
  );
  assert.deepEqual(
    correspondenceTasks([page([prior, current])], "pair-a", "owner-a", read),
    [current],
  );
});
