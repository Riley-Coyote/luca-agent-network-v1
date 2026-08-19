import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { relayClient } from "@/shared/api/relayClient";
import { KIND_LUCA_EXCHANGE } from "@/shared/constants/kinds";
import { startExchangeSync } from "./useExchangeSync.ts";

// Same fresh-start gap `startPersonaSync` guards: a live-only subscription
// replays from a since-cursor that stays undefined until the first live event,
// so a device that opens AFTER the head was published would show no exchange at
// all. The backfill fetch is what makes the strip correct on a cold open.
test("startExchangeSync backfills owner-authored heads before going live", () => {
  const fetchCalls = [];
  const liveCalls = [];
  mock.method(relayClient, "fetchEvents", (filter) => {
    fetchCalls.push(filter);
    return Promise.resolve([]);
  });
  mock.method(relayClient, "subscribeLive", (filter) => {
    liveCalls.push(filter);
    return Promise.resolve(() => Promise.resolve());
  });

  startExchangeSync("owner-pubkey", () => false);

  assert.equal(fetchCalls.length, 1, "must do exactly one backfill fetch");
  assert.deepEqual(fetchCalls[0].kinds, [KIND_LUCA_EXCHANGE]);
  assert.deepEqual(fetchCalls[0].authors, ["owner-pubkey"]);
  assert.ok(fetchCalls[0].limit > 0, "backfill must ask for history");

  assert.equal(liveCalls.length, 1, "must open exactly one live subscription");
  assert.deepEqual(liveCalls[0].kinds, [KIND_LUCA_EXCHANGE]);
  assert.deepEqual(liveCalls[0].authors, ["owner-pubkey"]);
  assert.equal(liveCalls[0].limit, 0, "live subscription must not replay");

  mock.restoreAll();
});
