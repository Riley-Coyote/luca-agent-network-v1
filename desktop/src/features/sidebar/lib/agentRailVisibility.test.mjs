import assert from "node:assert/strict";
import test from "node:test";
import {
  agentRailVisibilityKey,
  directlyAddressedRailAgents,
  isAgentVisibleInRail,
  parseAgentRailVisibility,
} from "./agentRailVisibility.ts";

const OWNER = "f".repeat(64);
const LUCA = "a".repeat(64);
const MIRA = "b".repeat(64);
const VEKTOR = "c".repeat(64);
const ANIMA = "d".repeat(64);
const residents = [
  { pubkey: LUCA, personaId: "builtin:fizz" },
  { pubkey: VEKTOR, personaId: "builtin:honey" },
  { pubkey: ANIMA, personaId: "builtin:bumble" },
  { pubkey: MIRA, personaId: "builtin:mira" },
];

test("only the three core residents show by default, independent of names or online state", () => {
  assert.deepEqual(
    residents.filter((agent) => isAgentVisibleInRail(agent, LUCA, {})),
    residents.slice(0, 3),
  );
  assert.equal(
    isAgentVisibleInRail({ pubkey: MIRA, personaId: "custom" }, LUCA, {}),
    false,
  );
  assert.equal(
    isAgentVisibleInRail({ pubkey: MIRA, personaId: "builtin:mira" }, MIRA, {
      [MIRA]: false,
    }),
    true,
  );
});

test("explicit show/hide choices persist while the companion cannot disappear", () => {
  const choices = parseAgentRailVisibility(
    JSON.stringify({ [MIRA]: true, [VEKTOR]: false, [LUCA]: false }),
  );
  assert.equal(isAgentVisibleInRail(residents[3], LUCA, choices), true);
  assert.equal(isAgentVisibleInRail(residents[1], LUCA, choices), false);
  assert.equal(isAgentVisibleInRail(residents[0], LUCA, choices), true);
});

test("display preferences are scoped by owner, relay and community", () => {
  const key = agentRailVisibilityKey(OWNER, "ws://local", "one");
  assert.equal(
    key,
    agentRailVisibilityKey(OWNER.toUpperCase(), "ws://local", "one"),
  );
  assert.notEqual(key, agentRailVisibilityKey(MIRA, "ws://local", "one"));
  assert.notEqual(key, agentRailVisibilityKey(OWNER, "ws://other", "one"));
  assert.notEqual(key, agentRailVisibilityKey(OWNER, "ws://local", "two"));
  assert.equal(agentRailVisibilityKey(null, "ws://local", "one"), null);
  assert.equal(agentRailVisibilityKey(OWNER, "", "one"), null);
});

test("corrupt preferences fall back safely and reject non-boolean or non-key entries", () => {
  for (const raw of ["{", "null", "[]", "false", '"text"'])
    assert.deepEqual(parseAgentRailVisibility(raw), {});
  assert.deepEqual(
    parseAgentRailVisibility(
      JSON.stringify({ [MIRA]: true, [LUCA]: "yes", __invalid: false }),
    ),
    { [MIRA]: true },
  );
});

const dm = {
  channelType: "dm",
  participantPubkeys: [OWNER, MIRA],
  guestPubkeys: [],
};
test("a direct owner conversation and an explicit tag reveal only known agents", () => {
  assert.deepEqual(directlyAddressedRailAgents(dm, OWNER, [], residents), [
    MIRA,
  ]);
  assert.deepEqual(
    directlyAddressedRailAgents(
      { ...dm, channelType: "stream" },
      OWNER,
      [ANIMA.toUpperCase(), ANIMA, OWNER],
      residents,
    ),
    [ANIMA],
  );
});

test("group membership and guest visits do not repopulate the rail", () => {
  assert.deepEqual(
    directlyAddressedRailAgents(
      { ...dm, participantPubkeys: [OWNER, MIRA, VEKTOR] },
      OWNER,
      [],
      residents,
    ),
    [],
  );
  assert.deepEqual(
    directlyAddressedRailAgents(
      { ...dm, participantPubkeys: [OWNER, LUCA, MIRA], guestPubkeys: [MIRA] },
      OWNER,
      [],
      residents,
    ),
    [LUCA],
  );
  assert.deepEqual(
    directlyAddressedRailAgents(
      { ...dm, channelType: "stream" },
      OWNER,
      [],
      residents,
    ),
    [],
  );
});
