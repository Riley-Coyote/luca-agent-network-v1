import assert from "node:assert/strict";
import test from "node:test";

import { readExpandedHomes, railHomesStorageKey } from "./agentRailState.ts";
import {
  activeRailHome,
  buildRailHomes,
  homeIdOfChat,
  railHomeList,
} from "./railHomes.ts";

const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);
const PERSON = "e".repeat(64);
const GONE = "f".repeat(64);

let clock = 0;
const chat = (id, participants, channelType = "stream", label = id) => ({
  channel: {
    id,
    name: id,
    channelType,
    lastMessageAt: new Date(Date.UTC(2026, 9, 1, 0, clock++)).toISOString(),
  },
  label,
  markPubkeys: participants,
  participants,
});

const tidepool = { id: "tidepool", label: "Tidepool" };
const studio = { id: "studio", label: "Studio site" };
const empty = { id: "empty", label: "Field guide" };

function scene() {
  const items = [
    chat("luca-dm", [LUCA], "dm", "Luca"),
    chat("luca-weekly", [LUCA]),
    chat("atlas-dm", [ATLAS.toUpperCase()], "dm", "Atlas"),
    chat("wren-dm", [WREN], "dm", "Wren"),
    chat("wren-monday", [WREN]),
    chat("wren-tides", [WREN]),
    // Project rooms: whoever is in them, they live under the project.
    chat("landing", [WREN]),
    chat("chapter", [ATLAS, WREN]),
    chat("hero", []),
    // Groups: one fleet per set of members, whatever order they come in.
    chat("luca-wren", [WREN, LUCA], "dm", "Luca, Wren"),
    chat("review", [ATLAS, WREN]),
    chat("palette", [WREN, ATLAS]),
    // A person, and an agent that was removed: under Agents by name.
    chat("person-dm", [PERSON], "dm", "Alice"),
    chat("person-room", [PERSON]),
    chat("gone-dm", [GONE], "dm", "Old agent"),
    // A room nobody else is in yet.
    chat("lonely", [], "stream", "Scratch"),
  ];
  const projectByChannelId = new Map([
    ["landing", tidepool],
    ["chapter", tidepool],
    ["hero", studio],
  ]);
  return buildRailHomes({
    items,
    agents: [
      { name: "Luca", pubkey: LUCA },
      { name: "Atlas", pubkey: ATLAS },
      { name: "Wren", pubkey: WREN },
      { name: "Codex", pubkey: "d".repeat(64) },
    ],
    primaryPubkey: LUCA,
    projects: [tidepool, studio, empty],
    projectByChannelId,
  });
}

const idsOf = (home) =>
  [home.main, ...home.sessions].filter(Boolean).map((item) => item.channel.id);

test("no chat appears twice, and none is lost", () => {
  const homes = scene();
  const placed = railHomeList(homes).flatMap(idsOf);
  assert.equal(placed.length, 16);
  assert.equal(new Set(placed).size, placed.length);
});

test("one home per chat, by the four rules", () => {
  const homes = scene();
  const byName = new Map(railHomeList(homes).map((home) => [home.name, home]));

  // Luca first: the thread is Luca's own, other sessions nest under it.
  assert.equal(homes.luca?.main?.channel.id, "luca-dm");
  assert.deepEqual(idsOf(homes.luca).slice(1), ["luca-weekly"]);

  // 1. Project rooms under their project, whoever is in them.
  assert.deepEqual(
    homes.projects.map((home) => home.name),
    ["Studio site", "Tidepool", "Field guide"],
  );
  assert.deepEqual(idsOf(byName.get("Tidepool")).sort(), [
    "chapter",
    "landing",
  ]);
  assert.equal(byName.get("Tidepool").main, null);
  assert.deepEqual(idsOf(byName.get("Field guide")), []);

  // 2. Groups under Fleets, one per member set, named by their members.
  const atlasWren = byName.get("Atlas + Wren");
  assert.equal(atlasWren.kind, "fleet");
  assert.deepEqual(idsOf(atlasWren).sort(), ["palette", "review"]);
  assert.equal(atlasWren.main, null);
  const lucaWren = byName.get("Luca + Wren");
  assert.equal(lucaWren.main?.channel.id, "luca-wren");

  // 3. One agent: under that agent, the 1:1 as its own conversation.
  const wren = byName.get("Wren");
  assert.equal(wren.main?.channel.id, "wren-dm");
  assert.deepEqual(wren.sessions.map((item) => item.channel.id).sort(), [
    "wren-monday",
    "wren-tides",
  ]);
  assert.equal(byName.get("Atlas").main?.channel.id, "atlas-dm");
  assert.deepEqual(idsOf(byName.get("Codex")), []);

  // 4. Someone not in the agent list: under Agents, by their name.
  assert.equal(byName.get("Alice").kind, "agent");
  assert.deepEqual(idsOf(byName.get("Alice")), ["person-dm", "person-room"]);
  assert.equal(byName.get("Old agent").kind, "agent");

  // Residents keep their order; the others follow.
  assert.deepEqual(
    homes.agents.map((home) => home.name),
    ["Atlas", "Wren", "Codex", "Old agent", "Alice"],
  );
  // A room only the owner is in is kept, under Fleets by its name.
  assert.deepEqual(idsOf(byName.get("Scratch")), ["lonely"]);
});

test("the active home is the parent of whatever is open", () => {
  const homes = scene();
  assert.equal(activeRailHome(homes, "wren-monday", null)?.name, "Wren");
  assert.equal(activeRailHome(homes, "luca-dm", null)?.id, "luca");
  assert.equal(activeRailHome(homes, "landing", null)?.name, "Tidepool");
  assert.equal(activeRailHome(homes, null, "empty")?.name, "Field guide");
  assert.equal(activeRailHome(homes, null, null), null);
});

test("a chat's home does not depend on key case or member order", () => {
  const context = { primaryPubkey: LUCA, projectByChannelId: new Map() };
  assert.equal(
    homeIdOfChat(chat("x", [WREN, ATLAS.toUpperCase()]), context),
    homeIdOfChat(chat("y", [ATLAS, WREN]), context),
  );
  assert.equal(homeIdOfChat(chat("z", [LUCA.toUpperCase()]), context), "luca");
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
