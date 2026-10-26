import assert from "node:assert/strict";
import test from "node:test";

import {
  agentStateWord,
  firstPickId,
  paramsOfPick,
  pickIdOf,
  readRememberedPick,
  rememberPick,
  resolvePickId,
  searchForPick,
} from "./placePicks.ts";

const LUCA = "A".repeat(64);

test("agents_pickRoundTripsThroughTheAddress", () => {
  for (const id of [
    `mind:${"a".repeat(64)}`,
    "persona:builtin:wren",
    "connected:hermes:default",
    "group:team-1",
  ]) {
    assert.equal(pickIdOf("agents", paramsOfPick("agents", id)), id, id);
  }
  // A pubkey is the same row in either case.
  assert.equal(pickIdOf("agents", { profile: LUCA }), `mind:${"a".repeat(64)}`);
});

test("activity_andLibrary_pickRoundTrips", () => {
  for (const id of ["now", `record:${"b".repeat(64)}`]) {
    assert.equal(pickIdOf("activity", paramsOfPick("activity", id)), id, id);
  }
  for (const id of [
    "made:all",
    "made:images",
    "skills:all",
    "skills:claude",
    "deleted",
  ]) {
    assert.equal(pickIdOf("library", paramsOfPick("library", id)), id, id);
  }
});

test("addressWords_areNeverNumbers", () => {
  // The router reads `1` in an address as a number, which would lose the pick.
  for (const value of Object.values(paramsOfPick("library", "deleted"))) {
    assert.ok(Number.isNaN(Number(value)), value);
  }
});

test("anAddressWithoutAPick_namesNone", () => {
  assert.equal(pickIdOf("agents", {}), null);
  assert.equal(pickIdOf("agents", { section: "notebook" }), null);
  assert.equal(pickIdOf("activity", { profile: LUCA }), null);
  assert.equal(pickIdOf("library", { made: "nonsense" }), null);
  assert.equal(pickIdOf("library", { deleted: 1 }), null);
});

test("firstVisit_opensOnTheFirstRow", () => {
  assert.equal(firstPickId("agents", LUCA), `mind:${"a".repeat(64)}`);
  assert.equal(firstPickId("agents", null), "luca");
  assert.equal(firstPickId("activity", null), "now");
  assert.equal(firstPickId("library", null), "made:all");
});

test("resolve_addressThenMemoryThenFirst", () => {
  const base = { place: "library", lucaPubkey: null };
  assert.equal(
    resolvePickId({
      ...base,
      remembered: "deleted",
      search: { skills: "all" },
    }),
    "skills:all",
  );
  assert.equal(
    resolvePickId({ ...base, remembered: "deleted", search: {} }),
    "deleted",
  );
  assert.equal(
    resolvePickId({ ...base, remembered: null, search: {} }),
    "made:all",
  );
});

test("searchForPick_clearsThePlacesOtherPicks_keepsTheRest", () => {
  const next = searchForPick(
    "agents",
    { profile: LUCA, section: "notebook", profileTab: "info", e2e: "mock" },
    "group:team-1",
    ["section", "profileTab"],
  );
  assert.deepEqual(next, { e2e: "mock", group: "team-1" });
  assert.deepEqual(
    searchForPick(
      "library",
      { made: "images", deleted: "recently" },
      "skills:codex",
    ),
    { skills: "codex" },
  );
});

test("memory_isKeptPerCommunityAndPlace", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  rememberPick(storage, "community-a", "library", "deleted");
  assert.equal(
    readRememberedPick(storage, "community-a", "library"),
    "deleted",
  );
  assert.equal(readRememberedPick(storage, "community-b", "library"), null);
  assert.equal(readRememberedPick(storage, "community-a", "agents"), null);
  // A storage that throws leaves the pick unremembered, never broken.
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  rememberPick(broken, "community-a", "library", "deleted");
  assert.equal(readRememberedPick(broken, "community-a", "library"), null);
  assert.equal(readRememberedPick(null, "community-a", "library"), null);
});

test("stateWords_followTheRostersOwnFilters", () => {
  assert.equal(
    agentStateWord({ availability: "started", needsAttention: false }),
    "working",
  );
  assert.equal(
    agentStateWord({ availability: "ready", needsAttention: false }),
    "working",
  );
  assert.equal(
    agentStateWord({ availability: "idle", needsAttention: false }),
    "resting",
  );
  assert.equal(
    agentStateWord({ availability: "offline", needsAttention: false }),
    "resting",
  );
  assert.equal(
    agentStateWord({ availability: "failed", needsAttention: true }),
    "needs attention",
  );
  assert.equal(
    agentStateWord({ availability: "offline", needsAttention: true }),
    "needs attention",
  );
});
