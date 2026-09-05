import assert from "node:assert/strict";
import test from "node:test";

import {
  makeObservedUnreadEvent,
  projectExchangeUnreadEvents,
  countUnreadAppBadgeObservedEvents,
  observedUnreadEventReadAt,
} from "./unreadChannelCounts.ts";

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

test("owner-return badges reproject when its head arrives without mutating the observed evidence", () => {
  const owner = "a".repeat(64),
    opener = "b".repeat(64),
    sibling = "c".repeat(64),
    id = "d".repeat(64);
  const head = {
    exchangeId: id,
    owner,
    openedBy: opener,
    members: [opener, sibling],
    depth: 1,
    parentExchangeId: null,
    conversationId: "room",
    bucket: 3,
  };
  const routing = {
    signerPubkey: opener,
    tags: [
      ["h", "room"],
      ["exchange", id, "3"],
      ["p", owner],
    ],
  };
  for (const threaded of [false, true]) {
    const raw = makeObservedUnreadEvent({
      ...base,
      rootId: threaded ? "thread" : null,
      isThreadedReply: threaded,
      isExchangeVolley: true,
      exchangeRouting: routing,
    });
    const events = new Map([[raw.id, raw]]);
    assert.equal(
      projectExchangeUnreadEvents(events, owner, "room", () => undefined),
      events,
    );
    for (const state of ["open", "closed"]) {
      const projected = projectExchangeUnreadEvents(
        events,
        owner,
        "room",
        () => ({ ...head, state }),
      );
      assert.equal(projected.get(raw.id).countsTowardBadge, true);
      assert.equal(projected.get(raw.id).countsTowardAppBadge, !threaded);
      assert.equal(projected.get(raw.id).rootId, raw.rootId);
      assert.equal(
        countUnreadAppBadgeObservedEvents(projected, () => base.createdAt),
        0,
      );
      assert.equal(
        observedUnreadEventReadAt(projected.get(raw.id), null, () =>
          threaded ? base.createdAt : null,
        ),
        threaded ? base.createdAt : null,
      );
    }
    assert.equal(raw.countsTowardBadge, false);
    assert.equal(
      projectExchangeUnreadEvents(events, sibling, "room", () => head),
      events,
    );
    assert.equal(
      projectExchangeUnreadEvents(events, owner, "other", () => head),
      events,
    );
  }
});
