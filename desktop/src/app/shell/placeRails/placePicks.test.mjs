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
  for (const id of ["needs-you", "now", "side", `record:${"b".repeat(64)}`]) {
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
  assert.equal(firstPickId("activity", null), "needs-you");
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

test("stateWords_comeFromTheLiveSignal_notReadiness", () => {
  const at = (overrides) =>
    agentStateWord({
      availability: "ready",
      lastError: null,
      waking: false,
      working: false,
      ...overrides,
    });
  // Ready but idle is resting: only a running turn is working.
  assert.equal(at({}), "resting");
  assert.equal(at({ availability: "started" }), "resting");
  // A stopped mind (availability idle) is off (WP-25, Decided 3).
  assert.equal(at({ availability: "idle" }), "off");
  assert.equal(at({ availability: "offline" }), "resting");
  assert.equal(at({ working: true }), "working");
  assert.equal(at({ waking: true }), "waking");
  assert.equal(at({ lastError: "exited" }), "needs attention");
  assert.equal(at({ availability: "degraded" }), "needs attention");
  assert.equal(at({ availability: "failed" }), "needs attention");
  // A problem outranks work, as the Chats rail orders them.
  assert.equal(at({ working: true, lastError: "exited" }), "needs attention");
  assert.equal(at({ waking: true, lastError: "exited" }), "waking");
  for (const word of [at({}), at({ working: true }), at({ lastError: "x" })])
    assert.equal(word, word.toLowerCase());
});

test("oneState_talkingIsALiveSideConversation_belowWork", () => {
  const at = (overrides) =>
    agentStateWord({
      availability: "ready",
      lastError: null,
      waking: false,
      working: false,
      ...overrides,
    });
  // WP-18, Decided 2: a side conversation still talking reads talking.
  assert.equal(at({ talking: true }), "talking");
  // Work outranks talk; a problem and waking outrank both.
  assert.equal(at({ talking: true, working: true }), "working");
  assert.equal(at({ talking: true, lastError: "exited" }), "needs attention");
  assert.equal(at({ talking: true, waking: true }), "waking");
  assert.equal(at({ talking: false }), "resting");
});

test("oneState_aStoppedMindIsOff_belowWhatIsLive", () => {
  const at = (overrides) =>
    agentStateWord({
      availability: "idle",
      lastError: null,
      waking: false,
      working: false,
      ...overrides,
    });
  // WP-25, Decided 3: stopped reads off, not resting.
  assert.equal(at({}), "off");
  // Being brought up, a problem, work and talk all outrank it.
  assert.equal(at({ waking: true }), "waking");
  assert.equal(at({ lastError: "exited" }), "needs attention");
  assert.equal(at({ working: true }), "working");
  assert.equal(at({ talking: true }), "talking");
  // Never yet set up, or merely ready, is not off.
  assert.equal(at({ availability: "offline" }), "resting");
  assert.equal(at({ availability: "ready" }), "resting");
});
