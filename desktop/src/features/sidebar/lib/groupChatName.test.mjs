import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveGroupChatMembersName } from "./channelLabels.ts";
import { buildChatListItems } from "./chatListModel.ts";
import { buildRailHomes } from "./railHomes.ts";

const ME = "0".repeat(64);
const LUCA = "a".repeat(64);
const WREN = "c".repeat(64);
const PERSON = "e".repeat(64);
const STRANGER = "f".repeat(64);

const channel = (id, name, participantPubkeys, channelType = "dm") => ({
  id,
  name,
  channelType,
  visibility: "private",
  participantPubkeys,
  participants: participantPubkeys.map(() => ""),
  memberPubkeys: participantPubkeys,
  lastMessageAt: null,
  archivedAt: null,
  isMember: true,
});

const agents = [
  { name: "Wren", pubkey: WREN },
  { name: "Luca", pubkey: LUCA },
];

describe("an unnamed group chat is named by its members (WP-04b)", () => {
  it("is Luca + Wren, Luca first, never the comma form", () => {
    const group = channel("g", "Group DM (3)", [WREN, LUCA, ME]);
    const name = resolveGroupChatMembersName(group, {
      agents,
      channels: [group],
      currentPubkey: ME,
      primaryPubkey: LUCA,
      profiles: undefined,
    });
    assert.equal(name, "Luca + Wren");
  });

  it("names a person by their 1:1, then by their profile, and counts the rest", () => {
    const direct = channel("d", "pat", [PERSON, ME]);
    const group = channel("g", "DM", [PERSON, WREN, STRANGER, ME]);
    const name = resolveGroupChatMembersName(group, {
      agents,
      channels: [direct, group],
      currentPubkey: ME,
      primaryPubkey: LUCA,
      profiles: undefined,
    });
    assert.equal(name, "pat + Wren + 1 other");
  });

  it("leaves named chats, 1:1s and rooms to their own names", () => {
    const options = {
      agents,
      channels: [],
      currentPubkey: ME,
      primaryPubkey: LUCA,
      profiles: undefined,
    };
    assert.equal(
      resolveGroupChatMembersName(
        channel("n", "launch crew", [LUCA, WREN, ME]),
        options,
      ),
      null,
    );
    assert.equal(
      resolveGroupChatMembersName(channel("o", "DM", [WREN, ME]), options),
      null,
    );
    assert.equal(
      resolveGroupChatMembersName(
        channel("s", "general", [LUCA, WREN, ME], "stream"),
        options,
      ),
      null,
    );
  });

  it("is the same name the rail gives the group's home", () => {
    const direct = channel("d", "pat", [PERSON, ME]);
    const group = channel("g", "Group DM (3)", [PERSON, WREN, LUCA, ME]);
    const channels = [direct, group];
    const items = buildChatListItems({
      channels,
      labels: { d: "pat", g: "pat, Wren, Luca" },
      currentPubkey: ME,
    });
    const homes = buildRailHomes({
      items,
      agents,
      primaryPubkey: LUCA,
      projects: [],
      projectByChannelId: new Map(),
    });
    const home = homes.fleets.find((each) => each.main?.channel.id === "g");
    assert.ok(home);
    assert.equal(
      resolveGroupChatMembersName(group, {
        agents,
        channels,
        currentPubkey: ME,
        primaryPubkey: LUCA,
        profiles: undefined,
      }),
      home.name,
    );
    assert.equal(home.name, "Luca + pat + Wren");
  });
});
