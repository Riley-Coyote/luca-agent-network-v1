/**
 * Pure frontend projection for Luca's unified Inbox.
 *
 * This module intentionally contains no transport, signing, decryption, or
 * agent-dispatch behavior. Callers supply already-authorized source records;
 * the projection only deduplicates, scopes, classifies, and orders them for
 * display.
 */

import type { FeedItem, HomeFeedResponse } from "@/shared/api/types";
import type {
  OwnerNativeInboxPresentationItem,
  OwnerNativeInboxResponse,
} from "@/shared/api/tauri";

export const UNIFIED_INBOX_FILTERS = [
  "all",
  "direct",
  "mention",
  "thread",
  "needs_action",
  "agents",
  "reminders",
  "drafts",
] as const;

export type UnifiedInboxFilter = (typeof UNIFIED_INBOX_FILTERS)[number];
export type UnifiedInboxCategory = Exclude<UnifiedInboxFilter, "all">;

export type InboxViewerScopeV1 =
  | {
      kind: "owner";
      ownerPubkey: string;
    }
  | {
      kind: "resident";
      ownerPubkey: string;
      residentPubkey: string;
    };

export type InboxAudienceV1 = {
  /** Owner whose local workspace is authoritative for this projection item. */
  ownerPubkey: string;
  /** Residents who may see this item in their own scoped Inbox. */
  residentPubkeys: string[];
  /** Explicit owner-visible audit projection for resident-to-resident traffic. */
  ownerVisible: boolean;
};

export type InboxAttentionStateV1 = {
  read: "read" | "unread";
  acknowledgement: "unacknowledged" | "acknowledged";
  handling: "not_applicable" | "open" | "handled";
};

export type InboxDeepLinkDescriptorV1 =
  | {
      kind: "conversation";
      channelId: string;
      eventId?: string;
      threadRootId?: string;
    }
  | {
      kind: "reminder";
      reminderId: string;
      channelId?: string;
      eventId?: string;
    }
  | {
      kind: "draft";
      draftKey: string;
      channelId?: string;
      threadRootId?: string;
    };

export type InboxNotificationPolicyV1 = {
  /** Whether this source is eligible to request an OS/app notification. */
  requested: boolean;
  /** Conversation- or source-level mute, resolved before projection. */
  muted: boolean;
  /** Explicit policy exception; never inferred from content. */
  allowDuringQuietHours: boolean;
};

export type InboxProjectionCandidateV1 = {
  /** `event:<event-id>` or a stable action identity such as `reminder:<d-tag>`. */
  canonicalId: string;
  /** Stable revision/event identity used to break equal-time pagination ties. */
  revisionId: string;
  source: "message" | "approval" | "reminder" | "draft";
  categories: UnifiedInboxCategory[];
  activityAt: number;
  actorPubkey: string | null;
  participantPubkeys: string[];
  conversationId?: string;
  audience: InboxAudienceV1;
  attention: InboxAttentionStateV1;
  deepLink: InboxDeepLinkDescriptorV1;
  notification: InboxNotificationPolicyV1;
  title: string;
  preview: string;
};

export type InboxProjectionPageV1 = {
  sourceId: string;
  items: InboxProjectionCandidateV1[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type InboxQuietHoursV1 = {
  enabled: boolean;
  /** Inclusive local minute of day, 0...1439. */
  startMinute: number;
  /** Exclusive local minute of day, 0...1439. */
  endMinute: number;
};

export type InboxNotificationEligibilityV1 =
  | { eligible: true; reason: "eligible" }
  | {
      eligible: false;
      reason:
        | "not_requested"
        | "already_read"
        | "acknowledged"
        | "handled"
        | "muted"
        | "quiet_hours";
    };

export type UnifiedInboxItemV1 = InboxProjectionCandidateV1 & {
  /** Passive Inbox projection must never activate or dispatch an agent. */
  agentActivation: "none";
  notificationEligibility: InboxNotificationEligibilityV1;
};

export type InboxFilterCountV1 = {
  total: number;
  unread: number;
  needsAttention: number;
};

export type UnifiedInboxViewModelV1 = {
  items: UnifiedInboxItemV1[];
  itemsByFilter: Record<UnifiedInboxFilter, UnifiedInboxItemV1[]>;
  counts: Record<UnifiedInboxFilter, InboxFilterCountV1>;
  pagination: Record<
    string,
    {
      nextCursor: string | null;
      hasMore: boolean;
    }
  >;
};

function nativePresentationFeedItem(
  item: OwnerNativeInboxPresentationItem,
  category: "activity" | "agent_activity",
): FeedItem {
  return {
    id: item.sourceEventId,
    kind: item.kind,
    pubkey: item.authorPubkey,
    content: item.content,
    createdAt: item.createdAt,
    channelId: item.channelId,
    channelName: item.channelName,
    // Resolve ordinary room type from the canonical channels query. Direct
    // membership is exact and may be represented immediately.
    channelType: item.channelType === "direct" ? "dm" : undefined,
    tags: item.structuralTags,
    category,
  };
}

function mergeFeedItems(
  existing: readonly FeedItem[],
  additions: readonly FeedItem[],
): FeedItem[] {
  const byEventId = new Map(existing.map((item) => [item.id, item]));
  // The native adapter has stricter membership and author admission than the
  // legacy feed. Prefer its structural representation for an overlapping ID.
  for (const item of additions) {
    byEventId.set(item.id, item);
  }
  return [...byEventId.values()].sort(
    (left, right) =>
      right.createdAt - left.createdAt || right.id.localeCompare(left.id),
  );
}

/**
 * Add authorized Direct and managed-Agent events to the existing Inbox feed.
 * Mentions and action sources remain exactly as provided by the legacy feed;
 * no source failure creates a placeholder or synthetic Inbox row.
 */
export function mergeOwnerNativeInboxIntoHomeFeed(input: {
  legacy: HomeFeedResponse;
  native?: OwnerNativeInboxResponse;
  threadActivity?: readonly FeedItem[];
}): HomeFeedResponse {
  const nativeItems = input.native?.presentationItems ?? [];
  const nativeDirect = nativeItems
    .filter((item) => item.categories.includes("direct"))
    .map((item) => nativePresentationFeedItem(item, "activity"));
  const nativeAgents = nativeItems
    .filter((item) => item.categories.includes("agents"))
    .map((item) => nativePresentationFeedItem(item, "agent_activity"));
  const activity = mergeFeedItems(input.legacy.feed.activity, [
    ...(input.threadActivity ?? []),
    ...nativeDirect,
  ]);
  const agentActivity = mergeFeedItems(
    input.legacy.feed.agentActivity,
    nativeAgents,
  );
  const uniqueVisibleIds = new Set(
    [
      ...input.legacy.feed.mentions,
      ...input.legacy.feed.needsAction,
      ...activity,
      ...agentActivity,
    ].map((item) => item.id),
  );

  return {
    feed: {
      mentions: input.legacy.feed.mentions,
      needsAction: input.legacy.feed.needsAction,
      activity,
      agentActivity,
    },
    meta: {
      ...input.legacy.meta,
      total: Math.max(input.legacy.meta.total, uniqueVisibleIds.size),
    },
  };
}

const CATEGORY_ORDER = new Map<UnifiedInboxCategory, number>(
  UNIFIED_INBOX_FILTERS.filter(
    (filter): filter is UnifiedInboxCategory => filter !== "all",
  ).map((category, index) => [category, index]),
);

function normalizedIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => normalizedIdentity(value)))]
    .filter(Boolean)
    .sort();
}

function uniqueCategories(
  categories: readonly UnifiedInboxCategory[],
): UnifiedInboxCategory[] {
  return [...new Set(categories)].sort(
    (left, right) =>
      (CATEGORY_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (CATEGORY_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function canonicalInboxEventIdentity(eventId: string): string {
  return `event:${eventId.trim().toLowerCase()}`;
}

export function canonicalInboxActionIdentity(
  action: "approval" | "reminder" | "draft",
  actionId: string,
): string {
  return `${action}:${actionId.trim()}`;
}

export function isInboxCandidateVisibleToViewer(
  candidate: InboxProjectionCandidateV1,
  viewer: InboxViewerScopeV1,
): boolean {
  if (
    normalizedIdentity(candidate.audience.ownerPubkey) !==
    normalizedIdentity(viewer.ownerPubkey)
  ) {
    return false;
  }

  if (viewer.kind === "owner") {
    return (
      candidate.audience.residentPubkeys.length === 0 ||
      candidate.audience.ownerVisible
    );
  }

  const residentPubkey = normalizedIdentity(viewer.residentPubkey);
  return candidate.audience.residentPubkeys.some(
    (candidatePubkey) => normalizedIdentity(candidatePubkey) === residentPubkey,
  );
}

function compareCandidateRecency(
  left: InboxProjectionCandidateV1,
  right: InboxProjectionCandidateV1,
): number {
  if (left.activityAt !== right.activityAt) {
    return left.activityAt - right.activityAt;
  }
  return left.revisionId.localeCompare(right.revisionId);
}

/**
 * Merge overlapping paginated sources without broadening the newest record's
 * audience, state, or notification authority. Only category membership is
 * unioned across duplicate representations of the same event/action.
 */
export function mergeInboxProjectionPages(
  pages: readonly InboxProjectionPageV1[],
): InboxProjectionCandidateV1[] {
  const itemByScopedIdentity = new Map<string, InboxProjectionCandidateV1>();

  for (const page of pages) {
    for (const candidate of page.items) {
      const scopedIdentity = `${normalizedIdentity(candidate.audience.ownerPubkey)}:${candidate.canonicalId}`;
      const previous = itemByScopedIdentity.get(scopedIdentity);
      if (!previous) {
        itemByScopedIdentity.set(scopedIdentity, {
          ...candidate,
          categories: uniqueCategories(candidate.categories),
          participantPubkeys: uniqueSorted(candidate.participantPubkeys),
          audience: {
            ...candidate.audience,
            ownerPubkey: normalizedIdentity(candidate.audience.ownerPubkey),
            residentPubkeys: uniqueSorted(candidate.audience.residentPubkeys),
          },
        });
        continue;
      }

      const newest =
        compareCandidateRecency(previous, candidate) <= 0
          ? candidate
          : previous;
      itemByScopedIdentity.set(scopedIdentity, {
        ...newest,
        categories: uniqueCategories([
          ...previous.categories,
          ...candidate.categories,
        ]),
        participantPubkeys: uniqueSorted(newest.participantPubkeys),
        audience: {
          ...newest.audience,
          ownerPubkey: normalizedIdentity(newest.audience.ownerPubkey),
          residentPubkeys: uniqueSorted(newest.audience.residentPubkeys),
        },
      });
    }
  }

  return [...itemByScopedIdentity.values()].sort((left, right) => {
    if (left.activityAt !== right.activityAt) {
      return right.activityAt - left.activityAt;
    }
    return left.canonicalId.localeCompare(right.canonicalId);
  });
}

export function isInboxQuietHoursActive(
  quietHours: InboxQuietHoursV1 | undefined,
  localMinuteOfDay: number,
): boolean {
  if (!quietHours?.enabled) {
    return false;
  }

  const minute = Math.max(0, Math.min(1_439, Math.floor(localMinuteOfDay)));
  const start = Math.max(0, Math.min(1_439, quietHours.startMinute));
  const end = Math.max(0, Math.min(1_439, quietHours.endMinute));
  if (start === end) {
    return true;
  }
  return start < end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}

export function resolveInboxNotificationEligibility(
  candidate: InboxProjectionCandidateV1,
  options: {
    quietHoursActive: boolean;
    mutedCanonicalIds?: ReadonlySet<string>;
  },
): InboxNotificationEligibilityV1 {
  if (!candidate.notification.requested) {
    return { eligible: false, reason: "not_requested" };
  }
  if (candidate.attention.handling === "handled") {
    return { eligible: false, reason: "handled" };
  }
  if (candidate.attention.acknowledgement === "acknowledged") {
    return { eligible: false, reason: "acknowledged" };
  }
  if (candidate.attention.read === "read") {
    return { eligible: false, reason: "already_read" };
  }
  if (
    candidate.notification.muted ||
    options.mutedCanonicalIds?.has(candidate.canonicalId)
  ) {
    return { eligible: false, reason: "muted" };
  }
  if (
    options.quietHoursActive &&
    !candidate.notification.allowDuringQuietHours
  ) {
    return { eligible: false, reason: "quiet_hours" };
  }
  return { eligible: true, reason: "eligible" };
}

function matchesUnifiedInboxFilter(
  item: UnifiedInboxItemV1,
  filter: UnifiedInboxFilter,
): boolean {
  return filter === "all" || item.categories.includes(filter);
}

function countItems(items: readonly UnifiedInboxItemV1[]): InboxFilterCountV1 {
  let unread = 0;
  let needsAttention = 0;
  for (const item of items) {
    if (item.attention.read === "unread") {
      unread += 1;
    }
    if (
      item.attention.read === "unread" ||
      (item.attention.handling === "open" &&
        item.attention.acknowledgement === "unacknowledged")
    ) {
      needsAttention += 1;
    }
  }
  return { total: items.length, unread, needsAttention };
}

export function buildUnifiedInboxViewModel(input: {
  pages: readonly InboxProjectionPageV1[];
  viewer: InboxViewerScopeV1;
  localMinuteOfDay: number;
  quietHours?: InboxQuietHoursV1;
  mutedCanonicalIds?: ReadonlySet<string>;
}): UnifiedInboxViewModelV1 {
  const visiblePages = input.pages.map((page) => ({
    ...page,
    items: page.items.filter((candidate) =>
      isInboxCandidateVisibleToViewer(candidate, input.viewer),
    ),
  }));
  const quietHoursActive = isInboxQuietHoursActive(
    input.quietHours,
    input.localMinuteOfDay,
  );
  const items = mergeInboxProjectionPages(visiblePages)
    // Generic activity is deliberately absent: every Inbox row must belong to
    // at least one meaningful product category.
    .filter((candidate) => candidate.categories.length > 0)
    .map(
      (candidate): UnifiedInboxItemV1 => ({
        ...candidate,
        agentActivation: "none",
        notificationEligibility: resolveInboxNotificationEligibility(
          candidate,
          {
            quietHoursActive,
            mutedCanonicalIds: input.mutedCanonicalIds,
          },
        ),
      }),
    );

  const itemsByFilter = Object.fromEntries(
    UNIFIED_INBOX_FILTERS.map((filter) => [
      filter,
      items.filter((item) => matchesUnifiedInboxFilter(item, filter)),
    ]),
  ) as Record<UnifiedInboxFilter, UnifiedInboxItemV1[]>;
  const counts = Object.fromEntries(
    UNIFIED_INBOX_FILTERS.map((filter) => [
      filter,
      countItems(itemsByFilter[filter]),
    ]),
  ) as Record<UnifiedInboxFilter, InboxFilterCountV1>;
  const pagination = Object.fromEntries(
    input.pages.map((page) => [
      page.sourceId,
      { nextCursor: page.nextCursor, hasMore: page.hasMore },
    ]),
  );

  return { items, itemsByFilter, counts, pagination };
}
