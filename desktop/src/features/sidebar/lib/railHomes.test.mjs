import assert from "node:assert/strict";
import test from "node:test";

import { readExpandedHomes, railHomesStorageKey } from "./agentRailState.ts";
import {
  activeAt,
  activeRailHome,
  buildRailHomes,
  homeIdOfChat,
  railHomeList,
  shownSessions,
} from "./railHomes.ts";

const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);
const PERSON = "e".repeat(64);
const GONE = "f".repeat(64);

let clock = 0;
const chat = (
  id,
  participants,
  channelType = "stream",
  label = id,
  visibility = "private",
) => ({
  channel: {
    id,
    name: channelType === "dm" ? "DM" : id,
    channelType,
    visibility,
    lastMessageAt: new Date(Date.UTC(2026, 9, 1, 0, clock++)).toISOString(),
  },
  label,
  markPubkeys: participants,
  participants,
});

const tidepool = { id: "tidepool", label: "Tidepool" };
const studio = { id: "studio", label: "Studio site" };
const empty = { id: "empty", label: "Field guide" };
const AGENTS = [
  { name: "Luca", pubkey: LUCA },
  { name: "Atlas", pubkey: ATLAS },
  { name: "Wren", pubkey: WREN },
  { name: "Codex", pubkey: "d".repeat(64) },
];

/** Every case WP-11 names, and the ones around them. */
function sceneItems() {
  return [
    chat("luca-dm", [LUCA], "dm", "Luca"),
    // An agent session: a private room with one agent (Luca's is Luca's).
    chat("luca-weekly", [LUCA]),
    chat("atlas-dm", [ATLAS.toUpperCase()], "dm", "Atlas"),
    chat("wren-dm", [WREN], "dm", "Wren"),
    chat("wren-monday", [WREN]),
    chat("wren-tides", [WREN]),
    // Project rooms: whoever is in them, they live under the project.
    chat("landing", [WREN]),
    chat("chapter", [ATLAS, WREN]),
    chat("hero", []),
    chat("press", [PERSON], "stream", "press", "open"),
    // Group conversations: unnamed (named by its members) and named.
    chat("luca-wren", [WREN, LUCA], "dm", "Luca, Wren"),
    chat("review", [ATLAS, WREN], "stream", "Design review"),
    chat("palette", [WREN, ATLAS], "stream", "Palette"),
    // An open room with one agent: a room, not the agent's session.
    chat("open-wren", [WREN], "stream", "Tide watch", "open"),
    // A forum.
    chat("forum", [ATLAS], "forum", "Field notes", "open"),
    // A person: their 1:1 is their row; a private room with them is a room.
    chat("person-dm", [PERSON], "dm", "Alice"),
    chat("person-room", [PERSON], "stream", "Alice and me"),
    // An agent from elsewhere (its profile says so), and its session.
    chat("gone-dm", [GONE], "dm", "Old agent"),
    chat("gone-room", [GONE], "stream", "Old agent's notes"),
    // A room nobody else is in yet.
    chat("lonely", [], "stream", "Scratch"),
  ];
}

function scene(items = sceneItems()) {
  const projectByChannelId = new Map([
    ["landing", tidepool],
    ["chapter", tidepool],
    ["hero", studio],
    ["press", studio],
  ]);
  return buildRailHomes({
    items,
    agents: AGENTS,
    agentPubkeys: new Set([GONE]),
    primaryPubkey: LUCA,
    projects: [tidepool, studio, empty],
    projectByChannelId,
  });
}

const idsOf = (home) =>
  [home.main, ...home.sessions].filter(Boolean).map((item) => item.channel.id);

test("no chat appears twice, and none is lost", () => {
  const items = sceneItems();
  const homes = scene(items);
  const placed = railHomeList(homes).flatMap(idsOf);
  assert.equal(placed.length, items.length);
  assert.equal(new Set(placed).size, placed.length);
  assert.deepEqual(
    [...placed].sort(),
    items.map((item) => item.channel.id).sort(),
  );
});

test("one home per chat, by what it is", () => {
  const homes = scene();
  const byName = new Map(railHomeList(homes).map((home) => [home.name, home]));

  // Luca first: the thread is Luca's own; Luca's sessions nest under it.
  assert.equal(homes.luca?.main?.channel.id, "luca-dm");
  assert.deepEqual(
    homes.luca.sessions.map((item) => item.channel.id),
    ["luca-weekly"],
  );

  // 1. Project rooms under their project, whoever is in them, open or not.
  assert.deepEqual(
    homes.projects.map((home) => home.name),
    ["Studio site", "Tidepool", "Field guide"],
  );
  assert.deepEqual(idsOf(byName.get("Tidepool")).sort(), [
    "chapter",
    "landing",
  ]);
  assert.deepEqual(idsOf(byName.get("Studio site")).sort(), ["hero", "press"]);
  assert.equal(byName.get("Tidepool").main, null);
  assert.deepEqual(idsOf(byName.get("Field guide")), []);

  // 2 and 3. An agent: its 1:1 is its own conversation; a private room with
  // it alone is its session; an open room with it is a room.
  const wren = byName.get("Wren");
  assert.equal(wren.kind, "agent");
  assert.equal(wren.main?.channel.id, "wren-dm");
  assert.deepEqual(wren.sessions.map((item) => item.channel.id).sort(), [
    "wren-monday",
    "wren-tides",
  ]);
  assert.equal(byName.get("Atlas").main?.channel.id, "atlas-dm");
  assert.deepEqual(idsOf(byName.get("Codex")), []);
  // An agent from elsewhere, known by its profile: under Agents, by name.
  const gone = byName.get("Old agent");
  assert.equal(gone.kind, "agent");
  assert.deepEqual(idsOf(gone), ["gone-dm", "gone-room"]);
  // Residents keep their order; the others follow.
  assert.deepEqual(
    homes.agents.map((home) => home.name),
    ["Atlas", "Wren", "Codex", "Old agent"],
  );

  // 4. A person: their 1:1 is their row, under People, and nothing nests.
  assert.deepEqual(
    homes.people.map((home) => [home.name, home.kind, idsOf(home)]),
    [["Alice", "person", ["person-dm"]]],
  );

  // 5. Everything else: a room of its own, by its own name.
  assert.deepEqual(
    homes.rooms.map((home) => [home.name, idsOf(home)]),
    [
      ["Scratch", ["lonely"]],
      ["Alice and me", ["person-room"]],
      ["Field notes", ["forum"]],
      ["Tide watch", ["open-wren"]],
      ["Palette", ["palette"]],
      ["Design review", ["review"]],
      ["Luca + Wren", ["luca-wren"]],
    ],
  );
  for (const room of homes.rooms) {
    assert.equal(room.kind, "room");
    assert.deepEqual(room.sessions, []);
  }
  // A room knows its members, for the + (a new session with all of them).
  assert.equal(byName.get("Design review").membersName, "Atlas + Wren");
  // Fleets are gone.
  assert.equal("fleets" in homes, false);
});

test("a person is an agent when their profile says so", () => {
  const items = [chat("x-dm", [PERSON], "dm", "Kai")];
  const asPerson = buildRailHomes({
    items,
    agents: AGENTS,
    primaryPubkey: LUCA,
    projects: [],
    projectByChannelId: new Map(),
  });
  assert.equal(asPerson.people[0]?.name, "Kai");
  const asAgent = buildRailHomes({
    items,
    agents: AGENTS,
    agentPubkeys: new Set([PERSON]),
    primaryPubkey: LUCA,
    projects: [],
    projectByChannelId: new Map(),
  });
  assert.equal(asAgent.people.length, 0);
  assert.equal(asAgent.agents.at(-1)?.name, "Kai");
  assert.equal(asAgent.agents.at(-1)?.main?.channel.id, "x-dm");
});

test("an unnamed group conversation is named by its members", () => {
  const STRANGER = "9".repeat(64);
  const OTHER = "8".repeat(64);
  const build = (items, names) =>
    buildRailHomes({
      items,
      agents: AGENTS.slice(0, 3),
      primaryPubkey: LUCA,
      projects: [],
      projectByChannelId: new Map(),
      names,
    });
  const items = [
    chat("lw", [WREN, LUCA], "dm", "Wren, Luca"),
    chat("as", [ATLAS, STRANGER], "dm", "Atlas, someone"),
    chat("so", [STRANGER, OTHER], "dm", "someone, someone"),
    // A named one keeps its own name.
    chat("crew", [ATLAS, STRANGER, OTHER], "stream", "Launch crew"),
  ];
  const names = (homes) => homes.rooms.map((home) => home.name).sort();
  assert.deepEqual(names(build(items)), [
    "2 people",
    "Atlas + 1 other",
    "Launch crew",
    "Luca + Wren",
  ]);
  // Profile names fill in members who are not agents.
  assert.deepEqual(names(build(items, new Map([[STRANGER, "Kai"]]))), [
    "Atlas + Kai",
    "Kai + 1 other",
    "Launch crew",
    "Luca + Wren",
  ]);
  // A group dm that has a name of its own keeps it.
  const own = chat("own", [WREN, ATLAS], "dm", "Tide crew");
  own.channel.name = "Tide crew";
  assert.deepEqual(names(build([own])), ["Tide crew"]);
});

test("no chat twice over the mock's stock channels", async () => {
  const { buildChatListItems } = await import("./chatListModel.ts");
  const ME = "deadbeef".repeat(8);
  const ALICE =
    "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f";
  const BOB = "1".repeat(64);
  const channel = (id, channelType, visibility, participantPubkeys) => ({
    id,
    name: id,
    channelType,
    visibility,
    participantPubkeys,
    participants: [],
    memberPubkeys: participantPubkeys,
    lastMessageAt: null,
    archivedAt: null,
    isMember: true,
  });
  // The stock fixture's shapes: open rooms with everyone, a private room, a
  // forum, 1:1s with people, and a group dm.
  const channels = [
    channel("general", "stream", "open", [ME, ALICE, BOB, LUCA]),
    channel("random", "stream", "open", [ME, ALICE]),
    channel("design", "stream", "private", [ME, WREN]),
    channel("watercooler", "forum", "open", [ME, ALICE, BOB]),
    channel("alice-tyler", "dm", "private", [ME, ALICE]),
    channel("bob-tyler", "dm", "private", [ME, BOB]),
    channel("trio", "dm", "private", [ME, ALICE, BOB]),
    channel("luca", "dm", "private", [ME, LUCA]),
  ];
  const items = buildChatListItems({ channels, labels: {}, currentPubkey: ME });
  const homes = buildRailHomes({
    items,
    agents: AGENTS,
    primaryPubkey: LUCA,
    projects: [],
    projectByChannelId: new Map(),
  });
  const placed = railHomeList(homes).flatMap(idsOf);
  assert.equal(placed.length, channels.length);
  assert.equal(new Set(placed).size, placed.length);
  assert.deepEqual(homes.people.map((home) => idsOf(home)[0]).sort(), [
    "alice-tyler",
    "bob-tyler",
  ]);
  assert.equal(homes.luca?.main?.channel.id, "luca");
  assert.deepEqual(idsOf(homes.agents.find((h) => h.name === "Wren")), [
    "design",
  ]);
});

test("a home shows its latest three, and the open one wherever it falls", () => {
  const rooms = [1, 2, 3, 4, 5].map((n) => chat(`r${n}`, [WREN]));
  // Newest first.
  const sessions = [...rooms].reverse();
  const latest = shownSessions(sessions, null);
  assert.deepEqual(
    latest.shown.map((item) => item.channel.id),
    ["r5", "r4", "r3"],
  );
  assert.equal(latest.hidden, 2);
  const open = shownSessions(sessions, "r1");
  assert.deepEqual(
    open.shown.map((item) => item.channel.id),
    ["r5", "r4", "r3", "r1"],
  );
  assert.equal(open.hidden, 1);
  assert.equal(shownSessions(sessions, "r4").hidden, 2);
  assert.equal(shownSessions(sessions, null, true).shown.length, 5);
  assert.equal(shownSessions(sessions.slice(0, 3), null).hidden, 0);
});

test("a chat with no messages yet is as recent as its making", () => {
  const old = chat("old", [WREN]);
  const older = chat("older", [WREN]);
  const fresh = chat("fresh", [WREN]);
  old.channel.lastMessageAt = "2026-10-01T00:00:00.000Z";
  older.channel.lastMessageAt = "2026-09-01T00:00:00.000Z";
  fresh.channel.lastMessageAt = null;
  const build = (createdAtById) =>
    buildRailHomes({
      items: [old, older, fresh],
      agents: AGENTS,
      primaryPubkey: LUCA,
      projects: [],
      projectByChannelId: new Map(),
      createdAtById,
    }).agents.find((home) => home.name === "Wren");
  // Not known yet: it waits last, as before.
  assert.deepEqual(
    build().sessions.map((item) => item.channel.id),
    ["old", "older", "fresh"],
  );
  // Made today: first, and the home is as recent as it.
  const made = build(new Map([["fresh", "2026-10-20T00:00:00.000Z"]]));
  assert.deepEqual(
    made.sessions.map((item) => item.channel.id),
    ["fresh", "old", "older"],
  );
  assert.equal(made.mostRecent, Date.parse("2026-10-20T00:00:00.000Z"));
  assert.equal(activeAt(fresh, new Map([["fresh", "x"]])), "x");
  assert.equal(
    activeAt(old, new Map([["old", "x"]])),
    old.channel.lastMessageAt,
  );
});

test("the active home is the parent of whatever is open", () => {
  const homes = scene();
  assert.equal(activeRailHome(homes, "wren-monday", null)?.name, "Wren");
  assert.equal(activeRailHome(homes, "luca-dm", null)?.id, "luca");
  assert.equal(activeRailHome(homes, "landing", null)?.name, "Tidepool");
  assert.equal(activeRailHome(homes, "person-dm", null)?.name, "Alice");
  assert.equal(activeRailHome(homes, "review", null)?.name, "Design review");
  assert.equal(activeRailHome(homes, null, "empty")?.name, "Field guide");
  assert.equal(activeRailHome(homes, null, null), null);
});

test("a chat's home does not depend on key case or member order", () => {
  const context = { primaryPubkey: LUCA, projectByChannelId: new Map() };
  assert.equal(homeIdOfChat(chat("z", [LUCA.toUpperCase()]), context), "luca");
  assert.equal(
    homeIdOfChat(chat("w", [WREN.toUpperCase()], "dm"), {
      ...context,
      isAgent: (pubkey) => pubkey === WREN,
    }),
    `agent:${WREN}`,
  );
  assert.equal(
    homeIdOfChat(chat("p", [PERSON.toUpperCase()], "dm"), context),
    `person:${PERSON}`,
  );
  assert.equal(homeIdOfChat(chat("g", [WREN, ATLAS]), context), "room:g");
});

test("expansion is stored per home and ignores anything else", () => {
  const key = railHomesStorageKey("OWNER", "wss://relay", "community");
  assert.equal(
    key,
    "polyphonic.rail-homes.v1:wss%3A%2F%2Frelay:community:owner",
  );
  const stored = {
    luca: true,
    [`agent:${WREN}`]: true,
    "project:tidepool": false,
    [`fleet:${ATLAS}+${WREN}`]: true,
    "agent:not-a-key": true,
    "something-else": true,
    "project:bad": "yes",
  };
  const storage = { getItem: () => JSON.stringify(stored) };
  assert.deepEqual(readExpandedHomes(storage, key), {
    luca: true,
    [`agent:${WREN}`]: true,
    "project:tidepool": false,
    [`fleet:${ATLAS}+${WREN}`]: true,
  });
  assert.deepEqual(readExpandedHomes({ getItem: () => "[1]" }, key), {});
  assert.deepEqual(readExpandedHomes({ getItem: () => "{oops" }, key), {});
});

test("project rooms sit in the rail unless Settings says a column", async () => {
  const { parseProjectRoomsPlacement, readProjectRoomsPlacement } =
    await import("./projectRoomsPlacement.ts");
  assert.equal(parseProjectRoomsPlacement(null), "rail");
  assert.equal(parseProjectRoomsPlacement("column"), "column");
  assert.equal(parseProjectRoomsPlacement("sideways"), "rail");
  assert.equal(
    readProjectRoomsPlacement({ getItem: () => "column" }),
    "column",
  );
  assert.equal(
    readProjectRoomsPlacement({
      getItem: () => {
        throw new Error("blocked");
      },
    }),
    "rail",
  );
});
