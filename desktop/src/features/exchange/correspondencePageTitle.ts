import * as React from "react";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";

let current: { scope: string; pair: string; title: string } | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => current;

export function useCorrespondenceScope() {
  const { activeCommunity, reinitKey } = useCommunities();
  const owner = useIdentityQuery().data?.pubkey?.toLowerCase() ?? "";
  return `${activeCommunity?.id ?? ""}:${reinitKey}:${owner}`;
}

export function publishCorrespondenceTitle(
  scope: string,
  pair: string,
  title: string,
) {
  if (
    current?.scope === scope &&
    current.pair === pair &&
    current.title === title
  )
    return;
  current = { scope, pair, title };
  for (const listener of listeners) listener();
}

export function clearCorrespondenceTitle(scope: string, pair: string) {
  if (current?.scope !== scope || current.pair !== pair) return;
  current = null;
  for (const listener of listeners) listener();
}

export function useCorrespondenceTitle(pair: string | null) {
  const scope = useCorrespondenceScope();
  const value = React.useSyncExternalStore(subscribe, snapshot, () => null);
  return value?.scope === scope && value.pair === pair
    ? value.title
    : "Agent conversation";
}
