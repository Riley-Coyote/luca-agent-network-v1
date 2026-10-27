import assert from "node:assert/strict";
import test from "node:test";

import { agentWorkRows, appTaskRows } from "./railWork.ts";

const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);

const names = new Map([
  [LUCA, "Luca"],
  [ATLAS, "Atlas"],
  [WREN, "Wren"],
]);
const nameOf = (pubkey) => names.get(pubkey) ?? "Someone";
const roomOf = (id) => (id === "tidepool" ? "Tidepool" : "");

const exchange = (id, openedBy, members, fields = {}) => ({
  kind: "exchange",
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

test("an exchange hangs under each agent it asks, never under who opened it", () => {
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
  assert.equal(atlas?.label, "Luca and Wren · Tidepool");
  assert.equal(atlas?.word, "talking");
  assert.equal(atlas?.messageId, "root-x1");
  assert.equal(rows.get(WREN)?.[0]?.label, "Luca and Atlas · Tidepool");
});

test("an exchange asking no agent in the rail hangs nowhere", () => {
  const rows = agentWorkRows(
    [exchange("x2", ATLAS, [ATLAS, LUCA])],
    new Set([ATLAS, WREN]),
    nameOf,
    roomOf,
  );
  // Luca is asked, and Luca nests nothing; Atlas opened it.
  assert.equal(rows.size, 0);
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
