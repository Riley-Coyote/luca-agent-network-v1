import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import {
  applyExchangeSnapshot,
  getPausedExchangeChannelIds,
  getRoomExchanges,
  resetExchangeStore,
  upsertExchangeRecord,
} from "./exchangeStore.ts";

const ROOM = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const OTHER_ROOM = "b5e2f8a1-3c44-5912-9e67-4a8d1f2b3c4e";
const LUCA = "a".repeat(64);
const VEKTOR = "b".repeat(64);
const OWNER = "c".repeat(64);

function record(overrides = {}) {
  return {
    protocol: "luca.exchange.v1",
    exchangeId: "1".repeat(64),
    owner: OWNER,
    members: [LUCA, VEKTOR],
    conversationId: ROOM,
    rootEventId: "2".repeat(64),
    parentExchangeId: null,
    depth: 1,
    bucket: 3,
    state: "open",
    deadline: Math.floor(Date.now() / 1000) + 600,
    openedBy: LUCA,
    ...overrides,
  };
}

beforeEach(() => {
  resetExchangeStore();
});

test("a room's exchanges are scoped to that conversation", () => {
  upsertExchangeRecord(record());
  upsertExchangeRecord(
    record({ exchangeId: "3".repeat(64), conversationId: OTHER_ROOM }),
  );

  assert.equal(getRoomExchanges(ROOM).length, 1);
  assert.equal(getRoomExchanges(ROOM)[0].record.conversationId, ROOM);
  assert.equal(getRoomExchanges(OTHER_ROOM).length, 1);
  assert.equal(getRoomExchanges(null).length, 0);
});

test("closed and expired exchanges leave the room", () => {
  upsertExchangeRecord(record({ state: "closed" }));
  assert.equal(getRoomExchanges(ROOM).length, 0);

  resetExchangeStore();
  upsertExchangeRecord(record({ deadline: Math.floor(Date.now() / 1000) - 1 }));
  assert.equal(getRoomExchanges(ROOM).length, 0);
});

test("the strip renders the most recently opened exchange first", () => {
  upsertExchangeRecord(record({ exchangeId: "1".repeat(64) }));
  upsertExchangeRecord(record({ exchangeId: "4".repeat(64) }));

  assert.deepEqual(
    getRoomExchanges(ROOM).map((entry) => entry.record.exchangeId),
    ["4".repeat(64), "1".repeat(64)],
  );
});

test("spent and phase come from the backend snapshot, never a local tally", () => {
  upsertExchangeRecord(record());
  assert.equal(getRoomExchanges(ROOM)[0].spent, 0);
  assert.equal(getRoomExchanges(ROOM)[0].phase, "open");

  applyExchangeSnapshot({ record: record(), spent: 3, phase: "paused" });
  assert.equal(getRoomExchanges(ROOM)[0].spent, 3);
  assert.equal(getRoomExchanges(ROOM)[0].phase, "paused");
});

test("a paused exchange marks its room, and Stop clears it", () => {
  applyExchangeSnapshot({ record: record(), spent: 3, phase: "paused" });
  assert.deepEqual([...getPausedExchangeChannelIds()], [ROOM]);

  applyExchangeSnapshot({
    record: record({ state: "closed" }),
    spent: 3,
    phase: "closed",
  });
  assert.equal(getPausedExchangeChannelIds().size, 0);
  assert.equal(getRoomExchanges(ROOM).length, 0);
});

test("snapshots are reference-stable until something actually changes", () => {
  applyExchangeSnapshot({ record: record(), spent: 1, phase: "open" });
  const first = getRoomExchanges(ROOM);
  applyExchangeSnapshot({ record: record(), spent: 1, phase: "open" });
  assert.equal(getRoomExchanges(ROOM), first, "re-applying must not churn");

  applyExchangeSnapshot({ record: record(), spent: 2, phase: "open" });
  assert.notEqual(getRoomExchanges(ROOM), first);
});
