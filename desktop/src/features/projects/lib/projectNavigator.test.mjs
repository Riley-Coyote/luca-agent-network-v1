import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProjectNavigatorViewModel,
  filterProjectRooms,
} from "./projectNavigator.ts";

const channel = (id, lastMessageAt, description = "") => ({
  id,
  name: id,
  channelType: "stream",
  visibility: "private",
  description,
  topic: null,
  purpose: null,
  memberCount: 2,
  memberPubkeys: ["owner", id],
  lastMessageAt,
  archivedAt: null,
  participants: [],
  participantPubkeys: [],
  isMember: true,
  ttlSeconds: null,
  ttlDeadline: null,
});

test("builds one project view without leaking rooms from another project", () => {
  const channels = [
    channel("older", "2026-08-01T00:00:00Z", "First room"),
    channel("newer", "2026-08-06T00:00:00Z", "Current work"),
    channel("elsewhere", "2026-08-07T00:00:00Z"),
  ];
  const project = {
    id: "luca",
    label: "Luca",
    workingContextStatus: "attached",
  };
  const viewModel = buildProjectNavigatorViewModel({
    channels,
    project,
    projectByChannelId: new Map([
      ["older", project],
      ["newer", project],
      ["elsewhere", { id: "other", label: "Other" }],
    ]),
    selectedRoomId: "older",
  });

  assert.deepEqual(
    viewModel.rooms.map(({ channel: room }) => room.id),
    ["newer", "older"],
  );
  assert.equal(viewModel.selectedRoomId, "older");
  assert.equal(viewModel.workingContextStatus, "attached");
});

test("room search matches names and real previews", () => {
  const project = { id: "luca", label: "Luca" };
  const viewModel = buildProjectNavigatorViewModel({
    channels: [
      channel("runtime", null, "Hermes verification"),
      channel("design", null, "Blackout shell"),
    ],
    project,
    projectByChannelId: new Map([
      ["runtime", project],
      ["design", project],
    ]),
  });

  assert.deepEqual(
    filterProjectRooms(viewModel.rooms, "Hermes").map(
      ({ channel: room }) => room.id,
    ),
    ["runtime"],
  );
  assert.deepEqual(filterProjectRooms(viewModel.rooms, "missing"), []);
});
