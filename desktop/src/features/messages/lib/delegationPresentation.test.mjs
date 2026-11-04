import assert from "node:assert/strict";
import test from "node:test";
import { delegationPresentation } from "./delegationPresentation.ts";
import { buildTimelineItems } from "./timelineItems.ts";

const owner = "a".repeat(64),
  luca = "b".repeat(64),
  peer = "c".repeat(64),
  task = "d".repeat(64);
const context = { ownerPubkey: owner, channelId: "home" };
const exchange = {
  record: {
    exchangeId: task,
    owner,
    openedBy: luca,
    conversationId: "home",
    rootEventId: "anchor",
    members: [luca, peer],
  },
  phase: "open",
  spent: 1,
};
const entry = (
  id,
  body,
  signerPubkey = owner,
  createdAt = 100,
  kind = 9,
  tags = [],
) => ({
  message: {
    id,
    body,
    signerPubkey,
    pubkey: signerPubkey,
    createdAt,
    kind,
    tags,
  },
  depth: 0,
});
const note = (id, type, extra = {}, at = 100) =>
  entry(id, JSON.stringify({ type, ...extra }), owner, at, 40099);
const rows = () => [
  entry("request", "Ask Vektor to review this"),
  entry("anchor", "Task: Review this", luca),
  note("join", "member_joined", { actor: owner, target: peer }),
  note("arrive", "visit_arrived", { resident: peer, exchange_id: task }),
  entry("internal", "Review this", luca, 101, 9, [["exchange", task, "1"]]),
  note("leave", "visit_left", { resident: peer, exchange_id: task }, 110),
  note("remove", "member_removed", { actor: owner, target: peer }, 110),
];

test("only task-linked bookkeeping is quiet; owner text and failures remain", () => {
  const data = [
    ...rows(),
    note("failure", "exchange-note", { text: "Runtime needs sign-in" }),
    note("manual", "member_joined", { actor: owner, target: peer }, 200),
  ];
  const result = delegationPresentation(data, [exchange], context);
  assert.deepEqual([...result.hidden].sort(), [
    "arrive",
    "join",
    "leave",
    "remove",
  ]);
  assert.equal(result.anchors.get("anchor"), task);
  assert.equal(result.hidden.has("failure"), false);
  assert.equal(result.hidden.has("manual"), false);
  assert.equal(result.hidden.has("request"), false);
});
test("other owner/community records cannot quiet this conversation", () => {
  for (const record of [
    { ...exchange.record, owner: peer },
    { ...exchange.record, conversationId: "other" },
  ]) {
    const result = delegationPresentation(
      rows(),
      [{ ...exchange, record }],
      context,
    );
    assert.equal(result.hidden.size, 0);
    assert.equal(result.anchors.size, 0);
  }
});
test("Task words alone never hide a user or agent message", () => {
  const result = delegationPresentation(
    [
      entry("anchor", "Task: mine"),
      entry("other", "Task: not an anchor", luca),
    ],
    [exchange],
    context,
  );
  assert.equal(result.anchors.size, 0);
});
test("one stable card replaces anchor and internal turns, not the user's request", () => {
  const first = buildTimelineItems(rows(), null, [exchange], context).items;
  assert.deepEqual(
    first.filter((i) => i.kind !== "day-divider").map((i) => i.kind),
    ["message", "exchange-receipt"],
  );
  const card = first.find((i) => i.kind === "exchange-receipt");
  assert.equal(card.entry.message.id, "anchor");
  const later = buildTimelineItems(
    [
      ...rows(),
      entry("internal2", "Done", peer, 120, 9, [["exchange", task, "2"]]),
    ],
    null,
    [exchange],
    context,
  ).items;
  assert.equal(
    later.find((i) => i.kind === "exchange-receipt").entry.message.id,
    "anchor",
  );
  assert.equal(later.filter((i) => i.kind === "exchange-receipt").length, 1);
});
