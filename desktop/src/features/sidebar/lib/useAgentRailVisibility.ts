import * as React from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import { useCanonicalLucaPubkey } from "@/features/luca/canonicalLucaResident";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  agentRailVisibilityKey,
  isAgentVisibleInRail,
  parseAgentRailVisibility,
  type RailResident,
} from "./agentRailVisibility";

const CHANGED = "polyphonic:agent-rail-visibility";
// Only a fallback for unavailable/full local storage, scoped by the complete key.
const volatile = new Map<string, string>();

function read(key: string | null): string | null {
  if (!key) return null;
  if (volatile.has(key)) return volatile.get(key) ?? null;
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Best-effort UI preference only: never fail a successful send over storage. */
export function setAgentsVisibleInRail(
  key: string | null,
  pubkeys: readonly string[],
  visible: boolean,
): void {
  if (!key) return;
  const current = parseAgentRailVisibility(read(key));
  const next = { ...current };
  for (const value of pubkeys) {
    const pubkey = value.toLowerCase();
    if (/^[a-f0-9]{64}$/.test(pubkey)) next[pubkey] = visible;
  }
  const raw = JSON.stringify(next);
  if (raw === JSON.stringify(current)) return;
  try {
    globalThis.localStorage.setItem(key, raw);
    volatile.delete(key);
  } catch {
    volatile.set(key, raw);
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

/** Shared by Chats, agent Settings and successful owner-initiated messages. */
export function useCurrentAgentRailVisibility() {
  const owner = useIdentityQuery().data?.pubkey;
  const { activeCommunity } = useCommunities();
  const primary = useCanonicalLucaPubkey();
  const key = agentRailVisibilityKey(
    owner,
    activeCommunity?.relayUrl,
    activeCommunity?.id,
  );
  const subscribe = React.useCallback(
    (notify: () => void) => {
      const storage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) {
          if (key) volatile.delete(key);
          notify();
        }
      };
      window.addEventListener(CHANGED, notify);
      window.addEventListener("storage", storage);
      return () => {
        window.removeEventListener(CHANGED, notify);
        window.removeEventListener("storage", storage);
      };
    },
    [key],
  );
  const snapshot = React.useCallback(() => read(key), [key]);
  const raw = React.useSyncExternalStore(subscribe, snapshot, () => null);
  const choices = React.useMemo(() => parseAgentRailVisibility(raw), [raw]);
  return {
    key,
    primary,
    isVisible: (agent: RailResident) =>
      isAgentVisibleInRail(agent, primary, choices),
    setVisible: (pubkey: string, visible: boolean) =>
      setAgentsVisibleInRail(key, [pubkey], visible),
  };
}
