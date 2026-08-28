import * as React from "react";

import type { ConnectedRuntimeSessionContext } from "@/shared/api/tauriRuntimeSessions";

export type RuntimeSessionContextHandoff = {
  context: ConnectedRuntimeSessionContext;
  ownerPubkey: string;
  relayUrl: string;
};

type Subscriber = () => void;

let pendingHandoff: RuntimeSessionContextHandoff | null = null;
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
) {
  pendingHandoff = handoff;
  notify();
}

export function clearRuntimeSessionContext(sessionId?: string) {
  if (sessionId && pendingHandoff?.context.sessionId !== sessionId) {
    return;
  }
  pendingHandoff = null;
  notify();
}

export function useRuntimeSessionContextHandoff() {
  return React.useSyncExternalStore(subscribe, snapshot, () => null);
}
