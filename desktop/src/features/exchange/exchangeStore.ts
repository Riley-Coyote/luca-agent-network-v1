import * as React from "react";

import {
  deriveExchangePhase,
  type ExchangeSnapshot,
} from "@/shared/api/exchanges";
import type { ExchangePhase, ExchangeRecord } from "@/shared/api/types";

/**
 * One exchange as this client knows it: the owner-signed head, plus the two
 * derivations that are never written into it — `spent` (the relay's count of
 * accepted turn-tagged messages) and `phase`.
 *
 * `spent` is only ever what the backend answered; nothing here counts loaded
 * history, so a second device with no messages loaded shows the same number.
 */
export type ExchangeEntry = {
  record: ExchangeRecord;
  spent: number;
  phase: ExchangePhase;
  /** First-seen ordinal — the strip renders the most recent exchange first. */
  observedAt: number;
  /**
   * Ordinal assigned only when a brand-new head arrives on the live relay
   * subscription. Backfill and authoritative snapshot refreshes leave this
   * null, so presentation can distinguish a genuinely new conversation from
   * data merely being reloaded.
   */
  liveObservedAt: number | null;
};

const entries = new Map<string, ExchangeEntry>();
const listeners = new Set<() => void>();
let observedCounter = 0;
let liveObservedCounter = 0;

// Reference-stable snapshots for useSyncExternalStore: React reads a snapshot
// before it subscribes, so these must survive with no listeners attached.
const roomCache = new Map<string, readonly ExchangeEntry[]>();
let pausedChannelIdsCache: ReadonlySet<string> | null = null;

const EMPTY_ENTRIES: readonly ExchangeEntry[] = [];
const EMPTY_CHANNEL_IDS: ReadonlySet<string> = new Set<string>();

function invalidateCaches() {
  roomCache.clear();
  historyCache.clear();
  pausedChannelIdsCache = null;
}

function notify() {
  invalidateCaches();
  for (const listener of listeners) listener();
}

export function subscribeExchangeStore(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function sameEntry(a: ExchangeEntry | undefined, b: ExchangeEntry): boolean {
  if (!a) return false;
  return (
    a.spent === b.spent &&
    a.phase === b.phase &&
    a.liveObservedAt === b.liveObservedAt &&
    a.record.bucket === b.record.bucket &&
    a.record.state === b.record.state &&
    a.record.deadline === b.record.deadline &&
    a.record.conversationId === b.record.conversationId &&
    a.record.members.length === b.record.members.length &&
    a.record.members.every(
      (member, index) => member === b.record.members[index],
    )
  );
}

function put(
  entry: Omit<ExchangeEntry, "observedAt" | "liveObservedAt">,
  liveObservation = false,
) {
  const key = entry.record.exchangeId;
  const existing = entries.get(key);
  const next: ExchangeEntry = {
    ...entry,
    observedAt: existing?.observedAt ?? ++observedCounter,
    liveObservedAt:
      existing?.liveObservedAt ??
      (liveObservation && !existing ? ++liveObservedCounter : null),
  };
  if (sameEntry(existing, next)) return;
  entries.set(key, next);
  notify();
}

/**
 * Record a head straight off the relay. `spent` is not knowable from an event,
 * so an entry seen this way carries the previous count (0 when brand new) until
 * `applyExchangeSnapshot` lands the backend's answer.
 */
export function upsertExchangeRecord(
  record: ExchangeRecord,
  options: { liveObservation?: boolean } = {},
) {
  const existing = entries.get(record.exchangeId);
  const spent = existing?.spent ?? 0;
  put(
    {
      record,
      spent,
      phase: deriveExchangePhase(record, spent, Math.floor(Date.now() / 1000)),
    },
    options.liveObservation,
  );
}

/** Record the authoritative `{record, spent, phase}` from the backend. */
export function applyExchangeSnapshot(snapshot: ExchangeSnapshot) {
  put(snapshot);
}

/** Forget an exchange the backend no longer recognises as ours. */
export function removeExchange(exchangeId: string) {
  if (!entries.delete(exchangeId.toLowerCase())) return;
  notify();
}

export function getExchangeEntry(
  exchangeId: string,
): ExchangeEntry | undefined {
  return entries.get(exchangeId.toLowerCase());
}

function isLive(entry: ExchangeEntry): boolean {
  return entry.phase !== "closed" && entry.phase !== "expired";
}

/**
 * Live exchanges in one conversation, most recently opened first. Closed and
 * expired exchanges are gone from the room: there is nothing left to decide.
 */
export function getRoomExchanges(
  channelId: string | null | undefined,
): readonly ExchangeEntry[] {
  if (!channelId) return EMPTY_ENTRIES;
  const cached = roomCache.get(channelId);
  if (cached) return cached;
  const matched = [...entries.values()]
    .filter(
      (entry) => entry.record.conversationId === channelId && isLive(entry),
    )
    .sort((a, b) => b.observedAt - a.observedAt);
  const result = matched.length === 0 ? EMPTY_ENTRIES : matched;
  roomCache.set(channelId, result);
  return result;
}

const historyCache = new Map<string, readonly ExchangeEntry[]>();

/**
 * Every exchange that ever happened in one conversation — live, paused, and
 * closed — most recent first. The drawer's "Between agents" is the record of
 * what the residents said to each other here, so closed exchanges stay.
 */
export function getRoomExchangeHistory(
  channelId: string | null | undefined,
): readonly ExchangeEntry[] {
  if (!channelId) return EMPTY_ENTRIES;
  const cached = historyCache.get(channelId);
  if (cached) return cached;
  // Live first (the one the owner may still act on), then by when the
  // exchange opened — the deadline is opened-at plus a fixed window, so it
  // orders by recency without a stored timestamp — then by first-seen.
  const matched = [...entries.values()]
    .filter((entry) => entry.record.conversationId === channelId)
    .sort((a, b) => {
      const liveA = isLive(a) ? 1 : 0;
      const liveB = isLive(b) ? 1 : 0;
      if (liveA !== liveB) return liveB - liveA;
      if (a.record.deadline !== b.record.deadline) {
        return b.record.deadline - a.record.deadline;
      }
      return b.observedAt - a.observedAt;
    });
  const result = matched.length === 0 ? EMPTY_ENTRIES : matched;
  historyCache.set(channelId, result);
  return result;
}

/** Every exchange in one conversation, live and closed, most recent first. */
export function useRoomExchangeHistory(
  channelId: string | null | undefined,
): readonly ExchangeEntry[] {
  return React.useSyncExternalStore(subscribeExchangeStore, () =>
    getRoomExchangeHistory(channelId),
  );
}

/** Newest genuinely live-observed exchange after a caller-owned watermark. */
export function latestLiveExchangeAfter(
  roomEntries: readonly ExchangeEntry[],
  after: number,
): ExchangeEntry | null {
  return (
    roomEntries
      .filter(
        (entry) =>
          entry.liveObservedAt !== null &&
          entry.liveObservedAt > after &&
          isLive(entry),
      )
      .sort((a, b) => (b.liveObservedAt ?? 0) - (a.liveObservedAt ?? 0))[0] ??
    null
  );
}

/**
 * Rooms holding a paused exchange. A paused exchange is waiting on the owner,
 * so its room reads as unread and high-priority even though the volleys that
 * spent the bucket never badge.
 */
export function getPausedExchangeChannelIds(): ReadonlySet<string> {
  if (pausedChannelIdsCache) return pausedChannelIdsCache;
  const paused = new Set<string>();
  for (const entry of entries.values()) {
    if (entry.phase === "paused") paused.add(entry.record.conversationId);
  }
  const result = paused.size === 0 ? EMPTY_CHANNEL_IDS : paused;
  pausedChannelIdsCache = result;
  return result;
}

/** Live exchanges in one conversation, most recently opened first. */
export function useRoomExchanges(
  channelId: string | null | undefined,
): readonly ExchangeEntry[] {
  return React.useSyncExternalStore(subscribeExchangeStore, () =>
    getRoomExchanges(channelId),
  );
}

/** Rooms whose exchange is paused, waiting on the owner. */
export function usePausedExchangeChannelIds(): ReadonlySet<string> {
  return React.useSyncExternalStore(
    subscribeExchangeStore,
    getPausedExchangeChannelIds,
  );
}

/** Community-switch reset (see resetCommunityState in useCommunityInit). */
export function resetExchangeStore() {
  entries.clear();
  observedCounter = 0;
  liveObservedCounter = 0;
  notify();
}
