import assert from "node:assert/strict";
import test from "node:test";

import {
  agentActivity,
  chatParticipants,
  chatsWithAgent,
  groupChats,
  isMultiParticipantChat,
  partitionConversationItems,
  sortChats,
} from "../lib/chatListModel.ts";

test("a resident's activity is the newest message anywhere they are, and any unread", () => {
  const atlas = "a".repeat(64);
  const bex = "b".repeat(64);
  const chat = (id, lastMessageAt, participants) => ({
    channel: { id, name: id, lastMessageAt, channelType: "dm" },
    label: id,
    markPubkeys: participants,
    participants,
  });
  const items = [
    chat("atlas-dm", "2026-09-01T00:00:00.000Z", [atlas]),
    chat("atlas-and-bex", "2026-09-03T00:00:00.000Z", [atlas, bex]),
    chat("bex-dm", null, [bex]),
    chat("someone-else", "2026-09-05T00:00:00.000Z", ["c".repeat(64)]),
  ];
  const activity = agentActivity(
    items,
    [{ pubkey: atlas.toUpperCase() }, { pubkey: bex }],
    new Set(["atlas-dm"]),
  );
  assert.equal(activity.size, 2);
  assert.deepEqual(activity.get(atlas), {
    newest: "2026-09-03T00:00:00.000Z",
    unread: true,
  });
  assert.deepEqual(activity.get(bex), {
    newest: "2026-09-03T00:00:00.000Z",
    unread: false,
  });
  assert.equal(agentActivity(items, [], new Set()).size, 0);
});

const room = (id, lastMessageAt, label = id) => ({
  channel: { id, name: id, lastMessageAt },
  label,
  markPubkeys: [],
  participants: [],
});

const projects = (assignments) =>
  new Map(
    Object.entries(assignments).map(([id, label]) => [
      id,
      { id: label.toLowerCase(), label },
    ]),
  );

test("ungrouped rooms always come first, and carry no project", () => {
  // Even when a project has the newest activity in the whole list.
  const groups = groupChats(
    [
      room("loose", "2026-08-01T00:00:00Z"),
      room("work", "2026-08-06T00:00:00Z"),
    ],
    projects({ work: "Luca" }),
  );
  assert.equal(groups[0].project, null);
  assert.deepEqual(
    groups[0].items.map((i) => i.channel.id),
    ["loose"],
  );
  assert.equal(groups[1].project.label, "Luca");
});

test("groups are ordered by their most recent room, not alphabetically", () => {
  // This is the whole difference from a Slack sidebar: whatever you are
  // actually working in floats to the top.
  const groups = groupChats(
    [
      room("a1", "2026-08-01T00:00:00Z"), // Alpha: older
      room("z1", "2026-08-06T00:00:00Z"), // Zeta: newer
    ],
    projects({ a1: "Alpha", z1: "Zeta" }),
  );
  assert.deepEqual(
    groups.filter((g) => g.project).map((g) => g.project.label),
    ["Zeta", "Alpha"],
  );
});

test("a group's recency is its NEWEST room, not its oldest or its average", () => {
  const groups = groupChats(
    [
      room("old", "2026-01-01T00:00:00Z"),
      room("new", "2026-08-06T00:00:00Z"), // same project as `old`
      room("mid", "2026-06-01T00:00:00Z"),
    ],
    new Map([
      ["old", { id: "p1", label: "One" }],
      ["new", { id: "p1", label: "One" }],
      ["mid", { id: "p2", label: "Two" }],
    ]),
  );
  // One contains the newest room, so it outranks Two despite also holding the
  // oldest. A group is as current as its liveliest conversation.
  assert.deepEqual(
    groups.filter((g) => g.project).map((g) => g.project.label),
    ["One", "Two"],
  );
});

test("equal recency falls back to a stable alphabetical order", () => {
  const same = "2026-08-06T00:00:00Z";
  const groups = groupChats(
    [room("b", same), room("a", same)],
    new Map([
      ["b", { id: "b", label: "Beta" }],
      ["a", { id: "a", label: "Alpha" }],
    ]),
  );
  assert.deepEqual(
    groups.filter((g) => g.project).map((g) => g.project.label),
    ["Alpha", "Beta"],
  );
});

test("rooms inside a group are themselves recency-sorted", () => {
  const groups = groupChats(
    [
      room("older", "2026-08-01T00:00:00Z"),
      room("newer", "2026-08-06T00:00:00Z"),
    ],
    new Map([
      ["older", { id: "p", label: "P" }],
      ["newer", { id: "p", label: "P" }],
    ]),
  );
  assert.deepEqual(
    groups[0].items.map((i) => i.channel.id),
    ["newer", "older"],
  );
});

test("never-messaged rooms sink to the bottom, alphabetically", () => {
  // A resident you have not written to still belongs in the list — your
  // household is permanent, not assembled from history — but it should not
  // outrank a live conversation.
  const sorted = sortChats([
    room("zeta", null),
    room("active", "2026-08-06T00:00:00Z"),
    room("alpha", null),
  ]);
  assert.deepEqual(
    sorted.map((i) => i.channel.id),
    ["active", "alpha", "zeta"],
  );
});

test("no projects at all degrades to exactly one ungrouped list", () => {
  // Production behaviour today: no assignments means the rail must render the
  // flat list it renders now, with no empty headers.
  const groups = groupChats(
    [room("a", "2026-08-01T00:00:00Z"), room("b", null)],
    new Map(),
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].project, null);
  assert.equal(groups[0].items.length, 2);
});

test("rail icons distinguish one-to-one chats from group conversations", () => {
  assert.equal(isMultiParticipantChat({ markPubkeys: ["alice"] }), false);
  assert.equal(
    isMultiParticipantChat({ markPubkeys: ["alice", "charlie"] }),
    true,
  );
});

test("the rail keeps shared channels separate from durable DMs", () => {
  const shared = room("shared", "2026-08-01T00:00:00Z");
  shared.channel.channelType = "stream";
  const direct = room("direct", "2026-08-03T00:00:00Z");
  direct.channel.channelType = "dm";
  const group = room("group", "2026-08-02T00:00:00Z");
  group.channel.channelType = "dm";

  const result = partitionConversationItems([shared, group, direct]);
  assert.deepEqual(
    result.channels.map((item) => item.channel.id),
    ["shared"],
  );
  assert.deepEqual(
    result.directMessages.map((item) => item.channel.id),
    ["direct", "group"],
  );
});

test("a chat belongs to an agent by its whole membership, not its few marks", () => {
  // The row can only wear three marks; a five-person group with Luca in it
  // is still one of Luca's chats.
  const luca = "f".repeat(64);
  const people = ["a", "b", "c", "d"].map((c) => c.repeat(64));
  const big = {
    channel: {
      id: "big",
      name: "big",
      channelType: "dm",
      lastMessageAt: null,
      participantPubkeys: [...people, luca],
    },
    label: "big",
    markPubkeys: people.slice(0, 3),
    participants: [...people, luca],
  };
  const pair = {
    channel: {
      id: "pair",
      name: "pair",
      channelType: "dm",
      lastMessageAt: null,
    },
    label: "Luca",
    markPubkeys: [luca],
    participants: [luca],
  };
  const human = {
    channel: {
      id: "human",
      name: "human",
      channelType: "dm",
      lastMessageAt: null,
    },
    label: "alice",
    markPubkeys: [people[0]],
    participants: [people[0]],
  };
  assert.deepEqual(
    chatsWithAgent([big, pair, human], luca.toUpperCase()).map(
      (i) => i.channel.id,
    ),
    ["big", "pair"],
  );
});

test("participants are everyone but the owner, members as the fallback", () => {
  const me = "0".repeat(64);
  const other = "1".repeat(64);
  assert.deepEqual(chatParticipants({ participantPubkeys: [me, other] }, me), [
    other,
  ]);
  assert.deepEqual(
    chatParticipants(
      { participantPubkeys: [], memberPubkeys: [other, me] },
      me,
    ),
    [other],
  );
  assert.deepEqual(chatParticipants({}, me), []);
});
