import * as React from "react";

import type { ConnectedRuntimeSessionContext } from "@/shared/api/tauriRuntimeSessions";

export type RuntimeSessionContextScope = {
  communityId: string;
  ownerPubkey: string;
  relayUrl: string;
};

export type RuntimeSessionContextHandoff = RuntimeSessionContextScope & {
  context: ConnectedRuntimeSessionContext;
};

export type RuntimeSessionStartAuthority = {
  handoffGeneration: number;
  runtimeKey: string;
  scopeKey: string;
};

type Subscriber = () => void;

let pendingHandoff: RuntimeSessionContextHandoff | null = null;
let handoffGeneration = 0;
const subscribers = new Set<Subscriber>();

function notify() {
  for (const subscriber of subscribers) subscriber();
}

function subscribe(subscriber: Subscriber) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function snapshot() {
  return pendingHandoff;
}

export function stageRuntimeSessionContext(
  handoff: RuntimeSessionContextHandoff,
  expectedGeneration: number,
) {
  if (expectedGeneration !== handoffGeneration) return false;
  handoffGeneration += 1;
  pendingHandoff = handoff;
  notify();
  return true;
}

export function clearRuntimeSessionContext(sessionId?: string) {
  if (sessionId && pendingHandoff?.context.sessionId !== sessionId) {
    return false;
  }
  handoffGeneration += 1;
  pendingHandoff = null;
  notify();
  return true;
}

export function resetRuntimeSessionContextHandoff() {
  handoffGeneration += 1;
  pendingHandoff = null;
  notify();
}

export function getRuntimeSessionContextGeneration() {
  return handoffGeneration;
}

export function readRuntimeSessionContextHandoff() {
  return pendingHandoff;
}

export function runtimeSessionContextScopeKey(
  scope: RuntimeSessionContextScope,
) {
  return [
    scope.communityId.trim(),
    scope.ownerPubkey.trim().toLowerCase(),
    scope.relayUrl.trim(),
  ].join("\u001f");
}

export function runtimeSessionContextMatchesScope(
  handoff: RuntimeSessionContextHandoff,
  scope: RuntimeSessionContextScope,
) {
  return (
    runtimeSessionContextScopeKey(handoff) ===
    runtimeSessionContextScopeKey(scope)
  );
}

export function useRuntimeSessionContextHandoff() {
  return React.useSyncExternalStore(subscribe, snapshot, () => null);
}
