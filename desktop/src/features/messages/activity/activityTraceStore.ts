import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { ActivityTrace, ActivityTraceLookup } from "./activityTraceTypes";

const EMPTY_TRACES: readonly ActivityTrace[] = [];
const listeners = new Set<() => void>();
const conversations = new Map<string, number>();
const snapshots = new Map<string, readonly ActivityTrace[]>();
let generation = 0;
let unlisten: UnlistenFn | null = null;
let listenerPromise: Promise<void> | null = null;
let refreshPromise: Promise<void> | null = null;
let refreshAgain = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

/** Native snapshots are already owner/community scoped and contain public data. */
export function applyActivityTraceSnapshot(
  traces: readonly ActivityTrace[],
): void {
  const next = new Map<string, ActivityTrace[]>();
  for (const trace of traces) {
    const items = next.get(trace.conversationId) ?? [];
    items.push(trace);
    next.set(trace.conversationId, items);
  }
  let changed = false;
  for (const conversationId of new Set([...next.keys(), ...snapshots.keys()])) {
    const items = next.get(conversationId) ?? EMPTY_TRACES;
    const previous = snapshots.get(conversationId) ?? EMPTY_TRACES;
    if (JSON.stringify(items) === JSON.stringify(previous)) continue;
    // Preserve individual row references when an unrelated resident updates.
    const stable = items.map((trace) => {
      const old = previous.find(
        (item) =>
          item.residentPubkey === trace.residentPubkey &&
          item.dispatchReceiptId === trace.dispatchReceiptId,
      );
      return old && JSON.stringify(old) === JSON.stringify(trace) ? old : trace;
    });
    snapshots.set(conversationId, stable);
    changed = true;
  }
  if (changed) notify();
}

function scheduleRefresh(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const unsettled = [...conversations.keys()].some((conversationId) =>
    getConversationActivityTraces(conversationId).some(
      (trace) =>
        trace.status === "working" ||
        (trace.status === "completed" &&
          !trace.finalMessageId &&
          Date.now() - (trace.endedAt ?? trace.startedAt) < 120_000),
    ),
  );
  if (!unsettled) return;
  timer = setTimeout(() => {
    timer = null;
    void refreshActivityTraces();
  }, 1000);
}

/** One shared hydration request, regardless of the number of timeline rows. */
export function refreshActivityTraces(): Promise<void> {
  if (refreshPromise) {
    refreshAgain = true;
    return refreshPromise;
  }
  const epoch = generation;
  const pending = invoke<ActivityTrace[]>("luca_list_activity_traces")
    .then((traces) => {
      if (epoch === generation) applyActivityTraceSnapshot(traces);
    })
    .catch(() => undefined)
    .finally(() => {
      if (epoch !== generation) return;
      refreshPromise = null;
      if (refreshAgain) {
        refreshAgain = false;
        void refreshActivityTraces();
      } else scheduleRefresh();
    });
  refreshPromise = pending;
  return pending;
}

/** Mount once in the community-scoped app. Native capture survives route changes. */
export async function ensureActivityTraceListener(): Promise<void> {
  if (listenerPromise) return listenerPromise;
  if (unlisten) return;
  const epoch = generation;
  listenerPromise = listen("luca://activity-trace-changed", () => {
    // The event carries no body, so an old host cannot inject another owner's
    // text. Hydration always resolves the active scope in the native backend.
    if (epoch === generation && conversations.size > 0)
      void refreshActivityTraces();
  })
    .then((dispose) => {
      if (epoch !== generation) {
        dispose();
        return;
      }
      unlisten = dispose;
      return refreshActivityTraces();
    })
    .catch(() => undefined)
    .finally(() => {
      if (epoch === generation) listenerPromise = null;
    });
  return listenerPromise;
}

export function subscribeActivityTraces(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A visible conversation owns refresh/polling; individual rows only subscribe. */
export function retainActivityTraceConversation(
  conversationId: string,
): () => void {
  const epoch = generation;
  const count = conversations.get(conversationId) ?? 0;
  conversations.set(conversationId, count + 1);
  void ensureActivityTraceListener();
  if (count === 0) void refreshActivityTraces();
  return () => {
    if (epoch !== generation) return;
    const count = conversations.get(conversationId) ?? 0;
    if (count <= 1) conversations.delete(conversationId);
    else conversations.set(conversationId, count - 1);
    scheduleRefresh();
  };
}

export function getConversationActivityTraces(
  conversationId: string | null,
): readonly ActivityTrace[] {
  return conversationId
    ? (snapshots.get(conversationId) ?? EMPTY_TRACES)
    : EMPTY_TRACES;
}

export function getActivityTrace(
  lookup: ActivityTraceLookup | null,
): ActivityTrace | null {
  if (!lookup || (!lookup.dispatchReceiptId && !lookup.finalMessageId))
    return null;
  return (
    getConversationActivityTraces(lookup.conversationId).find(
      (trace) =>
        trace.residentPubkey === lookup.residentPubkey &&
        (!lookup.dispatchReceiptId ||
          trace.dispatchReceiptId === lookup.dispatchReceiptId) &&
        (!lookup.finalMessageId ||
          trace.finalMessageId === lookup.finalMessageId),
    ) ?? null
  );
}

/** Clear all process caches and pending scopes before the next community mounts. */
export function resetActivityTraceStore(): void {
  generation += 1;
  unlisten?.();
  unlisten = null;
  listenerPromise = null;
  refreshPromise = null;
  refreshAgain = false;
  if (timer) clearTimeout(timer);
  timer = null;
  snapshots.clear();
  conversations.clear();
  notify();
}
