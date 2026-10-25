import assert from "node:assert/strict";
import test from "node:test";

import {
  clearShellUpdateDismissal,
  connectionCardsOf,
  dismissShellUpdate,
  getShellStatusSnapshot,
  publishConnectionProblem,
  resetShellStatus,
  subscribeShellStatus,
  updateAvailableOf,
} from "./shellStatus.ts";

const card = (overrides = {}) => ({
  hasRelayUnreachableError: false,
  isRelayConnectionSuccess: false,
  showSidebarRelayConnectionCard: false,
  ...overrides,
});

test("a quiet relay shows no connection card and is no problem", () => {
  assert.deepEqual(connectionCardsOf(card(), undefined), {
    statusCard: false,
    relayCard: false,
    problem: false,
  });
});

test("an unreachable relay is the relay card, and a problem", () => {
  assert.deepEqual(
    connectionCardsOf(
      card({
        hasRelayUnreachableError: true,
        showSidebarRelayConnectionCard: true,
      }),
      "relay unreachable: could not connect to relay",
    ),
    { statusCard: false, relayCard: true, problem: true },
  );
});

test("a relay that answered badly is the status card, and a problem", () => {
  assert.deepEqual(
    connectionCardsOf(card(), "Relay authentication rejected."),
    { statusCard: true, relayCard: false, problem: true },
  );
});

test("the relay card's brief 'Connected' is no problem", () => {
  assert.deepEqual(
    connectionCardsOf(
      card({
        isRelayConnectionSuccess: true,
        showSidebarRelayConnectionCard: true,
      }),
      undefined,
    ),
    { statusCard: false, relayCard: true, problem: false },
  );
});

test("a dismissed relay card is no longer said anywhere", () => {
  assert.equal(
    connectionCardsOf(
      card({ showSidebarRelayConnectionCard: false }),
      undefined,
    ).problem,
    false,
  );
});

test("an update is available when its card could show and wasn't dismissed", () => {
  for (const state of ["ready", "installing", "manual-required"]) {
    assert.equal(updateAvailableOf({ state }, false), true, state);
    assert.equal(updateAvailableOf({ state }, true), false, state);
  }
  for (const state of [
    "idle",
    "checking",
    "available",
    "downloading",
    "error",
  ]) {
    assert.equal(updateAvailableOf({ state }, false), false, state);
  }
  assert.equal(updateAvailableOf(null, false), false);
  assert.equal(updateAvailableOf(undefined, false), false);
});

test("the store publishes, notifies only on change, and resets", () => {
  resetShellStatus();
  let calls = 0;
  const unsubscribe = subscribeShellStatus(() => {
    calls += 1;
  });
  const first = getShellStatusSnapshot();
  publishConnectionProblem(false);
  assert.equal(calls, 0);
  assert.equal(getShellStatusSnapshot(), first);

  publishConnectionProblem(true);
  dismissShellUpdate();
  assert.equal(calls, 2);
  assert.deepEqual(getShellStatusSnapshot(), {
    connectionProblem: true,
    updateDismissed: true,
  });

  clearShellUpdateDismissal();
  assert.equal(getShellStatusSnapshot().updateDismissed, false);

  resetShellStatus();
  assert.deepEqual(getShellStatusSnapshot(), {
    connectionProblem: false,
    updateDismissed: false,
  });
  unsubscribe();
  publishConnectionProblem(true);
  assert.equal(calls, 4);
  resetShellStatus();
});
