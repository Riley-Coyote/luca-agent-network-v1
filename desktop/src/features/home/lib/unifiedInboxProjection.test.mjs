import assert from "node:assert/strict";
import test from "node:test";

import {
  INBOX_FIXTURE_IDENTITIES,
  inboxFixtureCandidate,
  ownerVisibleAgentConversationFixture,
  unifiedInboxFixturePages,
} from "./unifiedInboxProjection.fixtures.ts";
import {
  buildUnifiedInboxViewModel,
  canonicalInboxEventIdentity,
  isInboxCandidateVisibleToViewer,
  isInboxQuietHoursActive,
  resolveInboxNotificationEligibility,
  UNIFIED_INBOX_FILTERS,
} from "./unifiedInboxProjection.ts";

const ownerViewer = {
  kind: "owner",
  ownerPubkey: INBOX_FIXTURE_IDENTITIES.owner,
};

function buildOwnerView(overrides = {}) {
  return buildUnifiedInboxViewModel({
    pages: unifiedInboxFixturePages(),
    viewer: ownerViewer,
    localMinuteOfDay: 12 * 60,
    ...overrides,
  });
}

test("the public Inbox categories omit generic Activity", () => {
  assert.deepEqual(UNIFIED_INBOX_FILTERS, [
    "all",
    "direct",
    "mention",
    "thread",
    "needs_action",
    "agents",
    "reminders",
    "drafts",
  ]);
});

test("pagination merge deduplicates overlapping sources and preserves latest order", () => {
  const view = buildOwnerView();
  assert.equal(view.items.length, 4);
  assert.deepEqual(
    view.items.map((item) => item.activityAt),
    [130, 110, 90, 80],
  );

  const shared = view.items[0];
  assert.equal(shared.revisionId, "event-shared:new");
  assert.deepEqual(shared.categories, ["direct", "needs_action", "agents"]);
  assert.equal(
    view.items.filter((item) => item.canonicalId === shared.canonicalId).length,
    1,
  );
  assert.deepEqual(view.pagination, {
    messages: { nextCursor: "messages:next", hasMore: true },
    actions: { nextCursor: null, hasMore: false },
  });
});

test("All is unique while category filters intentionally overlap", () => {
  const view = buildOwnerView();
  assert.equal(
    new Set(view.itemsByFilter.all.map((item) => item.canonicalId)).size,
    4,
  );
  assert.equal(view.itemsByFilter.direct.length, 1);
  assert.equal(view.itemsByFilter.needs_action.length, 1);
  assert.equal(view.itemsByFilter.agents.length, 1);
  assert.equal(
    view.itemsByFilter.direct[0].canonicalId,
    view.itemsByFilter.agents[0].canonicalId,
  );
});

test("badge counts use explicit read, acknowledgement, and handled state", () => {
  const view = buildOwnerView();
  assert.deepEqual(view.counts.all, {
    total: 4,
    unread: 3,
    needsAttention: 3,
  });
  assert.deepEqual(view.counts.drafts, {
    total: 1,
    unread: 0,
    needsAttention: 0,
  });
});

test("owner-visible resident conversations remain isolated to their owner and participants", () => {
  const candidate = ownerVisibleAgentConversationFixture();
  assert.equal(isInboxCandidateVisibleToViewer(candidate, ownerViewer), true);
  assert.equal(
    isInboxCandidateVisibleToViewer(candidate, {
      kind: "owner",
      ownerPubkey: INBOX_FIXTURE_IDENTITIES.otherOwner,
    }),
    false,
  );
  for (const residentPubkey of [
    INBOX_FIXTURE_IDENTITIES.residentA,
    INBOX_FIXTURE_IDENTITIES.residentB,
  ]) {
    assert.equal(
      isInboxCandidateVisibleToViewer(candidate, {
        kind: "resident",
        ownerPubkey: INBOX_FIXTURE_IDENTITIES.owner,
        residentPubkey,
      }),
      true,
    );
  }
  assert.equal(
    isInboxCandidateVisibleToViewer(candidate, {
      kind: "resident",
      ownerPubkey: INBOX_FIXTURE_IDENTITIES.owner,
      residentPubkey: INBOX_FIXTURE_IDENTITIES.residentC,
    }),
    false,
  );
});

test("resident-to-resident traffic requires explicit owner visibility", () => {
  const candidate = ownerVisibleAgentConversationFixture();
  assert.equal(
    isInboxCandidateVisibleToViewer(
      {
        ...candidate,
        audience: { ...candidate.audience, ownerVisible: false },
      },
      ownerViewer,
    ),
    false,
  );
});

test("reminders and drafts retain structural deep links", () => {
  const view = buildOwnerView();
  assert.deepEqual(view.itemsByFilter.reminders[0].deepLink, {
    kind: "reminder",
    reminderId: "reminder-a",
    channelId: "channel-a",
  });
  assert.deepEqual(view.itemsByFilter.drafts[0].deepLink, {
    kind: "draft",
    draftKey: "draft-a",
    channelId: "channel-a",
  });
});

test("passive projection cannot request agent activation", () => {
  const unsafeCandidate = {
    ...inboxFixtureCandidate({
      canonicalId: canonicalInboxEventIdentity("unsafe-activation"),
      categories: ["agents"],
    }),
    agentActivation: "activate",
  };
  const view = buildUnifiedInboxViewModel({
    pages: [
      {
        sourceId: "unsafe",
        items: [unsafeCandidate],
        nextCursor: null,
        hasMore: false,
      },
    ],
    viewer: ownerViewer,
    localMinuteOfDay: 0,
  });
  assert.equal(view.items[0].agentActivation, "none");
});

test("notification eligibility honors mute, state, and overnight quiet hours", () => {
  const candidate = inboxFixtureCandidate({
    canonicalId: canonicalInboxEventIdentity("notification"),
    categories: ["direct"],
  });
  assert.equal(
    isInboxQuietHoursActive(
      { enabled: true, startMinute: 1320, endMinute: 480 },
      60,
    ),
    true,
  );
  assert.deepEqual(
    resolveInboxNotificationEligibility(candidate, {
      quietHoursActive: true,
    }),
    { eligible: false, reason: "quiet_hours" },
  );
  assert.deepEqual(
    resolveInboxNotificationEligibility(candidate, {
      quietHoursActive: false,
      mutedCanonicalIds: new Set([candidate.canonicalId]),
    }),
    { eligible: false, reason: "muted" },
  );
  assert.deepEqual(
    resolveInboxNotificationEligibility(
      {
        ...candidate,
        attention: { ...candidate.attention, handling: "handled" },
      },
      { quietHoursActive: false },
    ),
    { eligible: false, reason: "handled" },
  );
});

test("generic category-free activity is excluded from every Inbox surface", () => {
  const view = buildUnifiedInboxViewModel({
    pages: [
      {
        sourceId: "generic",
        items: [
          inboxFixtureCandidate({
            canonicalId: canonicalInboxEventIdentity("generic-activity"),
            categories: [],
          }),
        ],
        nextCursor: null,
        hasMore: false,
      },
    ],
    viewer: ownerViewer,
    localMinuteOfDay: 0,
  });
  assert.equal(view.items.length, 0);
  assert.equal(view.counts.all.total, 0);
});
