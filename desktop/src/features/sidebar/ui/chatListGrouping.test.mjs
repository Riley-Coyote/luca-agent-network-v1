import assert from "node:assert/strict";
import test from "node:test";

import {
  groupChats,
  isMultiParticipantChat,
  partitionConversationItems,
  sortChats,
} from "./ChatList.tsx";

const room = (id, lastMessageAt, label = id) => ({
  channel: { id, name: id, lastMessageAt },
  label,
  markPubkeys: [],
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
