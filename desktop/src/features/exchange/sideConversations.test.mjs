import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSideConversations,
  exchangeStatusLabel,
  exchangeTaskSubject,
  exchangeWord,
  exchangeTimesFromMessages,
  isLucas,
  lucaRowLabel,
  shownAt,
  sideDays,
  sideLiveWord,
  sideTitle,
  taskWord,
  turnsLabel,
} from "./sideConversations.ts";

const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);
const OWNER = "d".repeat(64);
const NAMES = new Map([
  [LUCA, "Luca"],
  [ATLAS, "Atlas"],
  [WREN, "Wren"],
]);
const nameOf = (pubkey) => NAMES.get(pubkey) ?? "Someone";
const ROOMS = new Map([
  ["room-tide", "Tidepool"],
  ["room-studio", "Studio site"],
]);
const roomOf = (id) => ROOMS.get(id) ?? "";

test("native-owned tasks never imply observed ongoing execution", () => {
  for (const state of ["active", "queued", "stopping", "awaiting_native"]) {
    const [item] = buildSideConversations({
      exchanges: [],
      tasks: [
        task("native", {
          state,
          controlOwner: "native_app",
        }),
      ],
    });
    assert.equal(item.live, false);
    assert.equal(sideLiveWord(item), null);
  }
});

test("a verified reply is not shown as ongoing work or a claim of success", () => {
  assert.equal(exchangeStatusLabel("open", true), "Replied");
  assert.equal(exchangeStatusLabel("closed", true), "Replied");
  assert.equal(exchangeStatusLabel("closed"), "Closed");
  assert.equal(exchangeStatusLabel("expired"), "Expired");
  for (const phase of ["open", "paused", "closed", "expired"]) {
    const entry = {
      ...exchange("answered", {}, 2, phase),
      replyReceived: true,
    };
    const [item] = buildSideConversations({ exchanges: [entry], tasks: [] });
    assert.equal(item.word, "replied");
    assert.equal(item.live, false);
    assert.equal(sideLiveWord(item), null);
  }
});

const at = (iso) => Math.floor(Date.parse(iso) / 1000);

function exchange(id, overrides = {}, spent = 0, phase = "open") {
  return {
    record: {
      protocol: "luca.exchange.v1",
      exchangeId: id,
      owner: OWNER,
      members: [ATLAS, LUCA],
      conversationId: "room-tide",
      rootEventId: `root-${id}`,
      parentExchangeId: null,
      depth: 1,
      bucket: 3,
      state: "open",
      deadline: at("2026-10-26T12:00:00Z"),
      openedBy: LUCA,
      ...overrides,
    },
    spent,
    phase,
  };
}

function task(id, overrides = {}) {
  return {
    taskId: id,
    conversationId: "room-studio",
    residentPubkey: LUCA,
    runtimeFamily: "claude_code",
    summary: "Fix the build",
    workingFolder: "/tmp",
    permissionMode: "normal",
    state: "succeeded",
    providerSessionId: null,
    currentStep: null,
    completedSteps: 1,
    steps: [],
    startedAt: "2026-10-26T01:00:00Z",
    updatedAt: "2026-10-26T01:40:00Z",
    completedAt: "2026-10-26T01:40:00Z",
    error: null,
    canRetry: false,
    retryOfTaskId: null,
    ...overrides,
  };
}

test("gathering_joinsExchangesAndTasks_newestFirst", () => {
  const times = new Map([
    ["x-open", { latestTurnAt: at("2026-10-26T10:18:00Z") }],
    ["x-done", { rootAt: at("2026-10-25T08:16:00Z") }],
  ]);
  const items = buildSideConversations({
    exchanges: [
      exchange("x-open", {}, 2, "open"),
      exchange(
        "x-done",
        { state: "closed", openedBy: WREN, members: [LUCA, WREN] },
        1,
        "closed",
      ),
      // No turn and no first message loaded: its deadline.
      exchange(
        "x-paused",
        { deadline: at("2026-10-26T09:30:00Z") },
        3,
        "paused",
      ),
    ],
    tasks: [
      task("t-build"),
      task("t-atlas", {
        residentPubkey: ATLAS,
        runtimeFamily: "codex",
        state: "active",
        completedAt: null,
        updatedAt: "2026-10-26T11:00:00Z",
      }),
    ],
    times,
  });
  assert.deepEqual(
    items.map((item) => item.id),
    ["t-atlas", "x-open", "x-paused", "t-build", "x-done"],
  );
  const byId = Object.fromEntries(items.map((item) => [item.id, item]));
  assert.equal(byId["x-open"].atFrom, "turn");
  assert.equal(byId["x-done"].atFrom, "root");
  assert.equal(byId["x-paused"].atFrom, "deadline");
  assert.deepEqual(
    items.map((item) => item.word),
    ["working", "talking", "paused", "done", "closed"],
  );
  assert.deepEqual(
    items.map((item) => item.live),
    [true, true, false, false, false],
  );
  assert.equal(byId["x-open"].turns, 2);
  assert.equal(
    buildSideConversations({ exchanges: [exchange("x0")], tasks: [] })[0].turns,
    null,
  );
});

test("transport closure and expiry never claim successful task completion", () => {
  assert.equal(exchangeWord("closed"), "closed");
  assert.equal(exchangeWord("expired"), "expired");
  assert.equal(exchangeStatusLabel("closed"), "Closed");
  assert.equal(exchangeStatusLabel("expired"), "Expired");
  assert.equal(exchangeStatusLabel(undefined), "Status unavailable");
});

test("task subjects use a bounded first line and neutral missing-brief fallback", () => {
  assert.equal(
    exchangeTaskSubject(
      "\n### **Review** the [onboarding](https://example.com)\nPrivate details",
      "Anima",
    ),
    "Review the onboarding",
  );
  assert.equal(
    exchangeTaskSubject(undefined, "Anima"),
    "Conversation with Anima",
  );
  assert.equal(exchangeTaskSubject("x".repeat(200)).length, 96);
  assert.equal(
    exchangeTaskSubject("\u0001\u0002", "Anima"),
    "Conversation with Anima",
  );
});

test("gathering_saysWhoAskedWhom", () => {
  const [ex] = buildSideConversations({
    exchanges: [exchange("x", { members: [ATLAS, LUCA, WREN] })],
    tasks: [],
  });
  assert.equal(sideTitle(ex, nameOf), "Luca asked Atlas and Wren");
  const [run] = buildSideConversations({ exchanges: [], tasks: [task("t")] });
  assert.equal(sideTitle(run, nameOf), "Luca asked Claude Code");
  assert.equal(turnsLabel(1), "1 turn");
  assert.equal(turnsLabel(3), "3 turns");
  assert.equal(turnsLabel(null), "");
  assert.equal(taskWord("awaiting_native"), "in the app");
  assert.equal(taskWord("stopping"), "working");
});

test("lucaRows_areLucasOnly_andNamedByTheOthersAndTheRoom", () => {
  const items = buildSideConversations({
    exchanges: [
      exchange("mine"),
      exchange("theirs", { openedBy: ATLAS, members: [ATLAS, WREN] }),
    ],
    tasks: [task("t"), task("atlas-task", { residentPubkey: ATLAS })],
  });
  const lucas = items.filter((item) => isLucas(item, LUCA));
  assert.deepEqual(lucas.map((item) => item.id).sort(), ["mine", "t"]);
  const labels = Object.fromEntries(
    lucas.map((item) => [item.id, lucaRowLabel(item, LUCA, nameOf, roomOf)]),
  );
  assert.equal(labels.mine, "Atlas · Tidepool");
  assert.equal(labels.t, "Claude Code · Fix the build");
});

test("turnTimes_readFromLoadedMessages", () => {
  const roots = new Map([["root-x", "x"]]);
  const times = exchangeTimesFromMessages(
    [
      { id: "root-x", created_at: 100, tags: [["h", "room"]] },
      { id: "m1", created_at: 120, tags: [["exchange", "X", "1"]] },
      { id: "m2", created_at: 150, tags: [["exchange", "x", "2"]] },
      { id: "m3", created_at: 140, tags: [["exchange", "x", "3"]] },
      { id: "m4", created_at: 999, tags: [["h", "room"]] },
    ],
    roots,
  );
  assert.deepEqual(times.get("x"), { rootAt: 100, latestTurnAt: 150 });
});

test("feed_isByDay", () => {
  const now = new Date(2026, 9, 26, 12, 0);
  const days = sideDays(
    [
      { at: new Date(2026, 9, 26, 10, 18).getTime() },
      { at: new Date(2026, 9, 26, 8, 0).getTime() },
      { at: new Date(2026, 9, 25, 23, 0).getTime() },
      { at: new Date(2026, 9, 20, 9, 0).getTime() },
    ],
    now,
    "en-US",
  );
  assert.deepEqual(
    days.map((day) => [day.label, day.items.length]),
    [
      ["Today", 2],
      ["Yesterday", 1],
      ["Tuesday, Oct 20", 1],
    ],
  );
});

test("words_andTimes_sayOnlyWhatIsKnown", () => {
  const [talking, paused, done, deadlineOnly, working] = buildSideConversations(
    {
      exchanges: [
        exchange("a", {}, 1, "open"),
        exchange("b", {}, 3, "paused"),
        exchange("c", { state: "closed" }, 2, "closed"),
      ],
      tasks: [],
      times: new Map([
        ["a", { latestTurnAt: 300 }],
        ["b", { latestTurnAt: 200 }],
        ["c", { latestTurnAt: 100 }],
      ]),
    },
  ).concat(
    buildSideConversations({ exchanges: [exchange("d")], tasks: [] }),
    buildSideConversations({
      exchanges: [],
      tasks: [task("t", { state: "active", completedAt: null })],
    }),
  );
  assert.deepEqual(
    [talking, paused, done, deadlineOnly, working].map(sideLiveWord),
    ["talking", "paused", null, "talking", "working"],
  );
  assert.equal(shownAt(talking), 300_000);
  // A deadline is not when anything was said.
  assert.equal(shownAt(deadlineOnly), null);
});
