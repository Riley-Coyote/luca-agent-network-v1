import assert from "node:assert/strict";
import test from "node:test";
import {
  agentRailStorageKey,
  readExpandedAgents,
  standaloneConversations,
} from "./agentRailState.ts";
const primary = "a".repeat(64),
  other = "b".repeat(64);
const item = (id, participants) => ({
  channel: { id, channelType: "dm" },
  participants,
});
test("expansion persists by identity, owner and workspace and tolerates damaged storage", () => {
  const key = agentRailStorageKey("owner", "wss://one", "home");
  for (const otherKey of [
    agentRailStorageKey("other", "wss://one", "home"),
    agentRailStorageKey("owner", "wss://two", "home"),
    agentRailStorageKey("owner", "wss://one", "other"),
  ])
    assert.notEqual(key, otherKey);
  const storage = {
    getItem: () =>
      JSON.stringify({
        [primary]: false,
        [other]: true,
        Luca: true,
        bad: "true",
      }),
  };
  assert.deepEqual(readExpandedAgents(storage, key), {
    [primary]: false,
    [other]: true,
  });
  assert.deepEqual(readExpandedAgents({ getItem: () => "broken" }, key), {});
});
test("primary's groups, unrelated DMs and ambiguous old pair histories remain accessible", () => {
  const pair = item("canonical", [primary]),
    group = item("group", [primary, other]),
    human = item("human", ["c".repeat(64)]),
    agent = item("agent", [other]);
  const agents = [{ pubkey: primary }, { pubkey: other }];
  assert.deepEqual(
    standaloneConversations([pair, group, human, agent], agents, primary),
    [group, human],
  );
  const historical = item("old", [primary]);
  assert.deepEqual(
    standaloneConversations([pair, historical, group], agents, primary),
    [pair, historical, group],
  );
});

test("the primary identity is registry-backed, never inferred from Luca casing", async () => {
  const { canonicalLucaResidentPubkey } = await import(
    "../../luca/canonicalLucaResident.ts"
  );
  const named = { residentPubkey: other, displayName: "luca", personaId: null };
  const canonical = {
    residentPubkey: primary,
    displayName: "Different display name",
    personaId: "builtin:fizz",
  };
  assert.equal(canonicalLucaResidentPubkey([named, canonical]), primary);
  assert.equal(canonicalLucaResidentPubkey([named]), null);
  assert.equal(
    canonicalLucaResidentPubkey([
      canonical,
      { ...canonical, residentPubkey: other },
    ]),
    null,
  );
});

test("Luca's home keeps its identity while a temporary guest is visiting", async () => {
  const { isCanonicalLucaDm } = await import(
    "../../luca/canonicalLucaResident.ts"
  );
  const owner = "c".repeat(64);
  const channel = {
    id: "existing-home",
    channelType: "dm",
    participantPubkeys: [owner, primary, other.toUpperCase()],
    guestPubkeys: [other],
  };
  assert.equal(isCanonicalLucaDm(channel, owner, primary), true);
  assert.equal(
    isCanonicalLucaDm({ ...channel, guestPubkeys: [] }, owner, primary),
    false,
    "a permanent third participant must not become Luca's home",
  );
  assert.equal(
    isCanonicalLucaDm({ ...channel, guestPubkeys: undefined }, owner, primary),
    false,
    "missing guest evidence must not relax the participant check",
  );
  for (const required of [owner, primary]) {
    assert.equal(
      isCanonicalLucaDm(
        { ...channel, guestPubkeys: [other, required] },
        owner,
        primary,
      ),
      false,
      "owner and Luca must both remain permanent participants",
    );
  }
});
