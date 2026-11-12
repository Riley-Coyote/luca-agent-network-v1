import assert from "node:assert/strict";
import test from "node:test";

import {
  agentWorkRows,
  appTaskRows,
  resolveRailInboxSnapshot,
  runtimeTaskRailVisible,
  activeRuntimeRailRows,
} from "./railWork.ts";

const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);
const OWNER = "d".repeat(64);

test("runtime rail settles only acknowledged returns or native sends, not worker success", () => {
  for (const deliveryState of [
    undefined,
    "awaiting_result",
    "pending_synthesis",
    "synthesizing",
    "prepared",
    "submitted",
  ]) {
    assert.equal(
      runtimeTaskRailVisible({ state: "succeeded", deliveryState }, false),
      true,
      deliveryState,
    );
  }
  for (const deliveryState of ["published", "cancelled"]) {
    assert.equal(
      runtimeTaskRailVisible({ state: "succeeded", deliveryState }, true),
      false,
    );
  }
  for (const state of ["queued", "active", "stopping"]) {
    assert.equal(runtimeTaskRailVisible({ state }, false), true);
    assert.equal(
      runtimeTaskRailVisible({ state, controlOwner: "native_app" }, false),
      true,
    );
  }
  for (const state of ["awaiting_native", "succeeded"]) {
    assert.equal(
      runtimeTaskRailVisible({ state, controlOwner: "native_app" }, false),
      false,
    );
  }
});

test("runtime rail follows the exact current issue, not a perpetual failure badge", () => {
  for (const state of ["failed", "interrupted"]) {
    for (const controlOwner of ["polyphonic", "native_app"]) {
      assert.equal(runtimeTaskRailVisible({ state, controlOwner }, true), true);
      assert.equal(
        runtimeTaskRailVisible({ state, controlOwner }, false),
        false,
      );
    }
  }
  for (const deliveryState of ["retryable", "blocked", "rejected"]) {
    assert.equal(
      runtimeTaskRailVisible({ state: "succeeded", deliveryState }, true),
      true,
    );
    assert.equal(
      runtimeTaskRailVisible({ state: "succeeded", deliveryState }, false),
      false,
    );
  }
});

test("settlement filters presentation without mutating history; selected, pinned or focused IDs survive", () => {
  const rows = ["delivered", "pending", "old-failure", "fresh-failure"].map(
    (id) => ({
      id: `task:${id}`,
      label: id,
      live: false,
    }),
  );
  const tasks = new Map([
    ["delivered", { state: "succeeded", deliveryState: "published" }],
    ["pending", { state: "succeeded", deliveryState: "submitted" }],
    ["old-failure", { state: "failed" }],
    ["fresh-failure", { state: "failed" }],
  ]);
  const before = structuredClone(rows);
  const issues = new Set(["fresh-failure"]);
  assert.deepEqual(
    activeRuntimeRailRows(rows, tasks, issues, new Set()).map((row) => row.id),
    ["task:pending", "task:fresh-failure"],
  );
  assert.equal(
    activeRuntimeRailRows(rows, tasks, issues, new Set(["task:delivered"]))[0]
      .id,
    "task:delivered",
  );
  assert.deepEqual(rows, before);
  assert.equal(tasks.size, 4);
  assert.equal(
    activeRuntimeRailRows(rows, tasks, issues, new Set()).every(
      (row) => row.live,
    ),
    true,
  );
});

const names = new Map([
  [LUCA, "Luca"],
  [ATLAS, "Atlas"],
  [WREN, "Wren"],
]);
const nameOf = (pubkey) => names.get(pubkey) ?? "Someone";
const roomOf = (id) => (id === "tidepool" ? "Tidepool" : "");

const exchange = (id, openedBy, members, fields = {}) => ({
  kind: "exchange",
  ownerPubkey: OWNER,
  id,
  conversationId: "tidepool",
  at: 1_000,
  atFrom: "turn",
  live: true,
  openedBy,
  others: members.filter((member) => member !== openedBy),
  members,
  phase: "open",
  word: "talking",
  turns: 2,
  rootEventId: `root-${id}`,
  ...fields,
});

const task = (id, runtimeFamily, fields = {}) => ({
  kind: "task",
  id,
  conversationId: "tidepool",
  at: 2_000,
  live: true,
  residentPubkey: LUCA,
  runtimeFamily,
  summary: `task ${id}`,
  state: "active",
  word: "working",
  ...fields,
});

test("a group retains its full audience and is not split into pair correspondence", () => {
  const rows = agentWorkRows(
    [exchange("x1", LUCA, [LUCA, ATLAS, WREN])],
    new Set([ATLAS, WREN]),
    nameOf,
    roomOf,
  );
  assert.deepEqual([...rows.keys()].sort(), [ATLAS, WREN].sort());
  const atlas = rows.get(ATLAS)?.[0];
  assert.equal(atlas?.id, "exchange:x1");
  // Under Atlas's row Atlas goes without saying: who else, then where.
  assert.equal(atlas?.label, "Group with Luca and Wren");
  assert.equal(atlas?.correspondenceId, undefined);
  assert.equal(atlas?.word, "talking");
  assert.equal(atlas?.messageId, "root-x1");
  assert.equal(rows.get(WREN)?.[0]?.label, "Group with Luca and Atlas");
});

test("the initiating resident sees the reciprocal correspondence too", () => {
  const rows = agentWorkRows(
    [exchange("x2", ATLAS, [ATLAS, LUCA])],
    new Set([ATLAS, WREN]),
    nameOf,
    roomOf,
  );
  assert.equal(rows.size, 1);
  assert.equal(rows.get(ATLAS)?.[0]?.label, "With Luca");
});

const scope = (ids, ownerPubkey = OWNER, communityId = "house-a") => ({
  communityId,
  ownerPubkey,
  correspondenceIds: new Map(ids),
});

test("three requests and a reverse request share one authorized reciprocal pair row", () => {
  const items = [
    exchange("one", LUCA, [LUCA, ATLAS], { at: 3000 }),
    exchange("two", LUCA, [LUCA, ATLAS], {
      conversationId: "other-room",
      at: 2000,
    }),
    exchange("three", ATLAS, [ATLAS, LUCA], { at: 1000 }),
  ];
  const rows = agentWorkRows(
    items,
    new Set([ATLAS, LUCA]),
    nameOf,
    roomOf,
    scope(items.map((item) => [item.id, "pair-1"])),
  );
  assert.equal(rows.get(ATLAS)?.length, 1);
  assert.equal(rows.get(LUCA)?.length, 1);
  const row = rows.get(ATLAS)[0];
  assert.equal(row.id, "correspondence:pair-1");
  assert.equal(row.id, rows.get(LUCA)[0].id);
  assert.equal(row.label, "With Luca");
  assert.deepEqual(row.taskIds, ["one", "two", "three"]);
  assert.deepEqual(row.sourceReferences[1], {
    taskId: "two",
    conversationId: "other-room",
    rootEventId: "root-two",
  });
  assert.equal(rows.get(LUCA)[0].label, "With Atlas");
  const renamed = agentWorkRows(
    items,
    new Set([ATLAS]),
    () => "Renamed",
    roomOf,
    scope(items.map((item) => [item.id, "pair-1"])),
  );
  assert.equal(renamed.get(ATLAS)[0].id, row.id);
  assert.equal(renamed.get(ATLAS)[0].label, "With Renamed");
});

test("no backend mapping means no invented pair identity or cross-owner merge", () => {
  const items = [
    exchange("one", LUCA, [LUCA, ATLAS]),
    exchange("two", LUCA, [LUCA, ATLAS]),
  ];
  assert.equal(
    agentWorkRows(items, new Set([ATLAS]), nameOf, roomOf).get(ATLAS).length,
    2,
  );
  assert.equal(
    agentWorkRows(
      items,
      new Set([ATLAS]),
      nameOf,
      roomOf,
      scope([["one", "pair"]], WREN),
    ).size,
    0,
  );
  const rows = agentWorkRows(
    items,
    new Set([ATLAS]),
    nameOf,
    roomOf,
    scope(
      [
        ["one", "house-b-pair"],
        ["two", "house-b-pair"],
      ],
      OWNER,
      "house-b",
    ),
  );
  assert.equal(rows.get(ATLAS)[0].id, "correspondence:house-b-pair");
});

test("opening a pair seeds its latest real activity regardless of page order", () => {
  const older = exchange("older", LUCA, [LUCA, ATLAS], { at: 1000 });
  const newer = exchange("newer", LUCA, [LUCA, ATLAS], { at: 3000 });
  for (const items of [
    [older, newer],
    [newer, older],
  ]) {
    const rows = agentWorkRows(
      items,
      new Set([ATLAS]),
      nameOf,
      roomOf,
      scope(items.map((item) => [item.id, "pair"])),
    );
    assert.equal(rows.get(ATLAS)[0].taskIds[0], "newer");
    assert.equal(rows.get(ATLAS)[0].messageId, "root-newer");
  }
});

test("pair activity uses actual messages, not future deadlines, and rows have stable order", () => {
  const items = [
    exchange("unknown", LUCA, [LUCA, ATLAS], {
      at: 99999999,
      atFrom: "deadline",
    }),
    exchange("known", LUCA, [LUCA, ATLAS], {
      at: 1000,
      live: false,
      phase: "closed",
    }),
    exchange("other", WREN, [WREN, ATLAS], { at: 5000 }),
  ];
  const rows = agentWorkRows(
    items,
    new Set([ATLAS]),
    nameOf,
    roomOf,
    scope([
      ["unknown", "pair-a"],
      ["known", "pair-a"],
      ["other", "pair-b"],
    ]),
  ).get(ATLAS);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["correspondence:pair-a", "correspondence:pair-b"],
  );
  assert.equal(rows[0].at, 1000);
  assert.equal(rows[0].shownAt, 1000);
  assert.equal(rows[0].live, true);
  assert.equal(rows[0].word, "talking");
});

test("an exchange known only by its deadline says no time", () => {
  const rows = agentWorkRows(
    [
      exchange("x3", LUCA, [LUCA, ATLAS], {
        atFrom: "deadline",
        live: false,
        phase: "closed",
        word: "done",
      }),
    ],
    new Set([ATLAS]),
    nameOf,
    roomOf,
  );
  const row = rows.get(ATLAS)?.[0];
  assert.equal(row?.shownAt, null);
  assert.equal(row?.word, null);
  assert.equal(row?.live, false);
});

test("a runtime task hangs under the app that runs it, live and finished", () => {
  const rows = appTaskRows([
    task("t1", "claude_code"),
    task("t2", "codex", { live: false, state: "succeeded", word: "done" }),
    exchange("x4", LUCA, [LUCA, ATLAS]),
  ]);
  assert.deepEqual([...rows.keys()].sort(), ["claude", "codex"]);
  const claude = rows.get("claude")?.[0];
  assert.equal(claude?.id, "task:t1");
  // Under the app's row the app goes without saying: the summary alone.
  assert.equal(claude?.label, "task t1");
  assert.equal(claude?.word, "working");
  assert.equal(claude?.messageId, null);
  const codex = rows.get("codex")?.[0];
  assert.equal(codex?.word, null);
  assert.equal(codex?.shownAt, 2_000);
});

test("a thousand task references stay one row without hydrating transcripts", () => {
  const items = Array.from({ length: 1000 }, (_, i) =>
    exchange(`task-${i}`, i % 2 ? LUCA : ATLAS, [LUCA, ATLAS], { at: i + 1 }),
  );
  const rows = agentWorkRows(
    items,
    new Set([ATLAS]),
    nameOf,
    roomOf,
    scope(items.map((item) => [item.id, "pair-1000"])),
  );
  assert.equal(rows.get(ATLAS).length, 1);
  assert.equal(rows.get(ATLAS)[0].taskIds.length, 1000);
  assert.equal(rows.get(ATLAS)[0].sourceReferences.length, 1000);
  assert.equal(rows.get(ATLAS)[0].shownAt, 1000);
});

test("native task authorization filters cached pairs and groups independently of known pair identity", () => {
  const items = [
    exchange("allowed-pair", LUCA, [LUCA, ATLAS]),
    exchange("cached-same-pair", LUCA, [LUCA, ATLAS]),
    exchange("allowed-group", LUCA, [LUCA, ATLAS, WREN]),
    exchange("cached-group", LUCA, [LUCA, ATLAS, WREN]),
  ];
  const authority = {
    ...scope([
      ["allowed-pair", "pair-1"],
      ["cached-same-pair", "pair-1"],
    ]),
    authorizedTaskIds: new Set(["allowed-pair", "allowed-group"]),
  };
  const rows = agentWorkRows(
    items,
    new Set([ATLAS]),
    nameOf,
    roomOf,
    authority,
  ).get(ATLAS);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["correspondence:pair-1", "exchange:allowed-group"],
  );
  assert.deepEqual(rows[0].taskIds, ["allowed-pair"]);
  assert.equal(
    agentWorkRows(items, null, nameOf, roomOf, {
      ...authority,
      authorizedTaskIds: new Set(),
    }).size,
    0,
  );
});

test("missing pages are unresolved, while a confirmed native empty page is authoritative", () => {
  assert.equal(
    resolveRailInboxSnapshot(null, undefined, "owner-house", true, false),
    null,
  );
  assert.equal(
    resolveRailInboxSnapshot(null, [], "owner-house", false, false),
    null,
  );
  const confirmedEmpty = [
    { scope: { communityId: "house-a", ownerPubkey: OWNER }, tasks: [] },
  ];
  const snapshot = resolveRailInboxSnapshot(
    null,
    confirmedEmpty,
    "owner-house",
    false,
    false,
  );
  assert.equal(snapshot.pages, confirmedEmpty);
});

test("only same-scope native authorization survives an in-flight refresh", () => {
  const previous = {
    epoch: "owner-a:house-a:revision-1",
    pages: [
      {
        scope: { communityId: "house-a", ownerPubkey: OWNER },
        tasks: [{ record: { exchangeId: "allowed" } }],
      },
    ],
  };
  assert.equal(
    resolveRailInboxSnapshot(previous, undefined, previous.epoch, true, false),
    previous,
  );
  assert.equal(
    resolveRailInboxSnapshot(
      previous,
      undefined,
      "owner-b:house-a:revision-1",
      true,
      false,
    ),
    null,
  );
  assert.equal(
    resolveRailInboxSnapshot(
      previous,
      undefined,
      "owner-a:house-b:revision-1",
      true,
      false,
    ),
    null,
  );
  assert.equal(
    resolveRailInboxSnapshot(
      previous,
      undefined,
      "owner-a:house-a:revision-2",
      true,
      false,
    ),
    null,
  );
  assert.equal(
    resolveRailInboxSnapshot(
      previous,
      previous.pages,
      previous.epoch,
      false,
      true,
    ),
    null,
  );
  assert.equal(
    resolveRailInboxSnapshot(previous, undefined, previous.epoch, false, false),
    null,
  );
});
