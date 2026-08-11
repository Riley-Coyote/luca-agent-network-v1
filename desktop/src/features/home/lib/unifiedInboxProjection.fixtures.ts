import {
  canonicalInboxActionIdentity,
  canonicalInboxEventIdentity,
  type InboxProjectionCandidateV1,
  type InboxProjectionPageV1,
} from "./unifiedInboxProjection";

export const INBOX_FIXTURE_IDENTITIES = {
  owner: "owner-a",
  otherOwner: "owner-b",
  residentA: "resident-a",
  residentB: "resident-b",
  residentC: "resident-c",
} as const;

const DEFAULT_ATTENTION = {
  read: "unread",
  acknowledgement: "unacknowledged",
  handling: "not_applicable",
} as const;

const DEFAULT_NOTIFICATION = {
  requested: true,
  muted: false,
  allowDuringQuietHours: false,
} as const;

export function inboxFixtureCandidate(
  overrides: Partial<InboxProjectionCandidateV1> &
    Pick<InboxProjectionCandidateV1, "canonicalId" | "categories">,
): InboxProjectionCandidateV1 {
  return {
    revisionId: `${overrides.canonicalId}:revision`,
    source: "message",
    activityAt: 100,
    actorPubkey: INBOX_FIXTURE_IDENTITIES.residentA,
    participantPubkeys: [
      INBOX_FIXTURE_IDENTITIES.owner,
      INBOX_FIXTURE_IDENTITIES.residentA,
    ],
    audience: {
      ownerPubkey: INBOX_FIXTURE_IDENTITIES.owner,
      residentPubkeys: [],
      ownerVisible: true,
    },
    attention: DEFAULT_ATTENTION,
    deepLink: {
      kind: "conversation",
      channelId: "channel-a",
    },
    notification: DEFAULT_NOTIFICATION,
    title: "Fixture item",
    preview: "Body-safe fixture preview",
    ...overrides,
  };
}

export function unifiedInboxFixturePages(): InboxProjectionPageV1[] {
  const sharedEventId = canonicalInboxEventIdentity("event-shared");
  return [
    {
      sourceId: "messages",
      nextCursor: "messages:next",
      hasMore: true,
      items: [
        inboxFixtureCandidate({
          canonicalId: sharedEventId,
          revisionId: "event-shared:old",
          categories: ["direct"],
          activityAt: 120,
          title: "Direct message",
        }),
        inboxFixtureCandidate({
          canonicalId: canonicalInboxEventIdentity("event-thread"),
          categories: ["thread", "mention"],
          activityAt: 110,
          deepLink: {
            kind: "conversation",
            channelId: "channel-a",
            eventId: "event-thread",
            threadRootId: "thread-root",
          },
          title: "Mention in a thread",
        }),
      ],
    },
    {
      sourceId: "actions",
      nextCursor: null,
      hasMore: false,
      items: [
        inboxFixtureCandidate({
          canonicalId: sharedEventId,
          revisionId: "event-shared:new",
          categories: ["needs_action", "agents"],
          activityAt: 130,
          attention: {
            read: "unread",
            acknowledgement: "unacknowledged",
            handling: "open",
          },
          title: "Agent action",
        }),
        inboxFixtureCandidate({
          canonicalId: canonicalInboxActionIdentity("reminder", "reminder-a"),
          source: "reminder",
          categories: ["reminders"],
          activityAt: 90,
          deepLink: {
            kind: "reminder",
            reminderId: "reminder-a",
            channelId: "channel-a",
          },
          title: "Reminder",
        }),
        inboxFixtureCandidate({
          canonicalId: canonicalInboxActionIdentity("draft", "draft-a"),
          source: "draft",
          categories: ["drafts"],
          activityAt: 80,
          attention: {
            read: "read",
            acknowledgement: "acknowledged",
            handling: "not_applicable",
          },
          deepLink: {
            kind: "draft",
            draftKey: "draft-a",
            channelId: "channel-a",
          },
          notification: {
            requested: false,
            muted: false,
            allowDuringQuietHours: false,
          },
          title: "Draft",
        }),
      ],
    },
  ];
}

export function ownerVisibleAgentConversationFixture(): InboxProjectionCandidateV1 {
  return inboxFixtureCandidate({
    canonicalId: canonicalInboxEventIdentity("resident-a-to-resident-b"),
    categories: ["direct", "agents"],
    activityAt: 140,
    actorPubkey: INBOX_FIXTURE_IDENTITIES.residentA,
    participantPubkeys: [
      INBOX_FIXTURE_IDENTITIES.residentA,
      INBOX_FIXTURE_IDENTITIES.residentB,
    ],
    audience: {
      ownerPubkey: INBOX_FIXTURE_IDENTITIES.owner,
      residentPubkeys: [
        INBOX_FIXTURE_IDENTITIES.residentA,
        INBOX_FIXTURE_IDENTITIES.residentB,
      ],
      ownerVisible: true,
    },
    title: "Resident conversation",
  });
}
