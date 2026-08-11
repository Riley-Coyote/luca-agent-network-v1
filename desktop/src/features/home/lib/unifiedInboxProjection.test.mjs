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
  mergeOwnerNativeInboxIntoHomeFeed,
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

function legacyFeedItem(id, category, overrides = {}) {
  return {
    id,
    kind: 9,
    pubkey: "a".repeat(64),
    content: `legacy ${id}`,
    createdAt: 10,
    channelId: "room-1",
    channelName: "Room one",
    tags: [["h", "room-1"]],
    category,
    ...overrides,
  };
}

function nativePresentationItem(id, categories, overrides = {}) {
  return {
    sourceEventId: id,
    kind: 9,
    authorPubkey: "b".repeat(64),
    content: `native ${id}`,
    createdAt: 20,
    channelId: "dm-1",
    channelName: "Direct one",
    channelType: "direct",
    structuralTags: [["h", "dm-1"]],
    categories,
    ...overrides,
  };
}

function legacyHomeFeed() {
  return {
    feed: {
      mentions: [legacyFeedItem("mention-1", "mention")],
      needsAction: [legacyFeedItem("action-1", "needs_action")],
      activity: [legacyFeedItem("activity-1", "activity")],
      agentActivity: [legacyFeedItem("agent-1", "agent_activity")],
    },
    meta: { since: 0, total: 4, generatedAt: 10 },
  };
}

test("native Inbox projection augments Direct and Agent views without replacing legacy authority", () => {
  const merged = mergeOwnerNativeInboxIntoHomeFeed({
    legacy: legacyHomeFeed(),
    native: {
      presentationItems: [
        nativePresentationItem("human-dm", ["direct"]),
        nativePresentationItem("agent-dm", ["direct", "agents"]),
        nativePresentationItem("agent-room", ["agents"], {
          channelId: "room-2",
          channelName: "Room two",
          channelType: "room",
        }),
      ],
      sources: [],
    },
  });

  assert.deepEqual(
    merged.feed.mentions.map((item) => item.id),
    ["mention-1"],
  );
  assert.deepEqual(
    merged.feed.needsAction.map((item) => item.id),
    ["action-1"],
  );
  assert.equal(
    merged.feed.activity.find((item) => item.id === "human-dm")?.channelType,
    "dm",
  );
  assert.ok(merged.feed.activity.some((item) => item.id === "agent-dm"));
  assert.ok(merged.feed.agentActivity.some((item) => item.id === "agent-dm"));
  assert.equal(
    merged.feed.agentActivity.find((item) => item.id === "agent-room")
      ?.channelType,
    undefined,
  );
});

test("native source failure stays empty and thread activity remains passive", () => {
  const merged = mergeOwnerNativeInboxIntoHomeFeed({
    legacy: legacyHomeFeed(),
    native: {
      presentationItems: [],
      sources: [
        {
          source: "direct_messages",
          availability: "unavailable",
          diagnosticCode: "membership_unavailable",
        },
      ],
    },
    threadActivity: [legacyFeedItem("thread-1", "activity")],
  });

  assert.deepEqual(
    merged.feed.activity.map((item) => item.id),
    ["thread-1", "activity-1"],
  );
  assert.equal(merged.feed.agentActivity.length, 1);
});

test("stricter native representation replaces an overlapping legacy event once", () => {
  const legacy = legacyHomeFeed();
  legacy.feed.activity.push(
    legacyFeedItem("same-event", "activity", {
      content: "less constrained legacy copy",
    }),
  );
  const merged = mergeOwnerNativeInboxIntoHomeFeed({
    legacy,
    native: {
      presentationItems: [nativePresentationItem("same-event", ["direct"])],
      sources: [],
    },
  });
  const overlap = merged.feed.activity.filter(
    (item) => item.id === "same-event",
  );
  assert.equal(overlap.length, 1);
  assert.equal(overlap[0].content, "native same-event");
});
