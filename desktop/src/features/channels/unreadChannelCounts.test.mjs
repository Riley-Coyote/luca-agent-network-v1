import assert from "node:assert/strict";
import test from "node:test";

import { makeObservedUnreadEvent } from "./unreadChannelCounts.ts";

const base = {
  id: "event-1",
  createdAt: 1_700_000_000,
  rootId: null,
  highPriority: true,
  channelType: "stream",
  isThreadedReply: false,
};

test("a mention badges the room it lands in", () => {
  const observed = makeObservedUnreadEvent(base);
  assert.equal(observed.countsTowardBadge, true);
  assert.equal(observed.countsTowardAppBadge, true);
});

test("an exchange volley is recorded but badges nothing", () => {
  const observed = makeObservedUnreadEvent({ ...base, isExchangeVolley: true });
  assert.equal(observed.countsTowardBadge, false);
  assert.equal(observed.countsTowardAppBadge, false);
  // Still an observed unread event: the room keeps its quiet dot.
  assert.equal(observed.id, base.id);
  assert.equal(observed.createdAt, base.createdAt);
});

test("a volley in a DM does not badge either", () => {
  const observed = makeObservedUnreadEvent({
    ...base,
    channelType: "dm",
    highPriority: false,
    isExchangeVolley: true,
  });
  assert.equal(observed.countsTowardBadge, false);
  assert.equal(observed.countsTowardAppBadge, false);
});

test("a DM still badges when it is not a volley", () => {
  const observed = makeObservedUnreadEvent({
    ...base,
    channelType: "dm",
    highPriority: false,
  });
  assert.equal(observed.countsTowardBadge, true);
  assert.equal(observed.countsTowardAppBadge, true);
});
