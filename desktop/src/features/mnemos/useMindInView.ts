import * as React from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { useCommunities } from "@/features/communities/useCommunities";
import type { PlaceMind, PlaceMinds } from "./api";
import { loadMinds, useMnemosFacts } from "./placeStore";

/** The last mind looked at, kept as every place keeps its last pick: in
 *  sessionStorage, by community (placePicks.ts). */
const key = (scope: string) => `luca-place-pick-v1:${scope}:mnemos-mind`;

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function remembered(scope: string): string | null {
  try {
    return store()?.getItem(key(scope)) ?? null;
  } catch {
    return null;
  }
}

function remember(scope: string, id: string) {
  try {
    store()?.setItem(key(scope), id);
  } catch {
    // Still in view; it just won't be remembered.
  }
}

/** The mind the place opens on: the address's, the last one looked at, a
 *  mind a resident remembers with, then the first. */
export function resolveMind(
  minds: PlaceMinds | null,
  fromAddress: string | null,
  last: string | null,
): PlaceMind | null {
  const list = minds?.minds ?? [];
  const named = (id: string | null) =>
    id ? (list.find((m) => m.id === id) ?? null) : null;
  return (
    named(fromAddress) ??
    named(last) ??
    list.find((m) => m.linked.length > 0) ??
    list[0] ??
    null
  );
}

/** The mind in view, from the address, and a way to look at another. */
export function useMindInView() {
  const facts = useMnemosFacts();
  const { activeCommunity } = useCommunities();
  const scope = activeCommunity?.id ?? "local";
  const navigate = useNavigate();
  const search = useRouterState({
    select: (state) =>
      state.location.pathname === "/mnemos"
        ? (state.location.search as Record<string, unknown>)
        : null,
  });
  const fromAddress = typeof search?.mind === "string" ? search.mind : null;
  React.useEffect(() => {
    void loadMinds();
  }, []);
  const mind = resolveMind(facts.minds, fromAddress, remembered(scope));
  React.useEffect(() => {
    if (mind) remember(scope, mind.id);
  }, [mind, scope]);
  const choose = React.useCallback(
    (id: string) => {
      remember(scope, id);
      void navigate({
        to: "/mnemos",
        search: (previous: Record<string, unknown>) => ({
          room: previous.room,
          mind: id,
        }),
        resetScroll: false,
      } as never);
    },
    [navigate, scope],
  );
  return { facts, mind, inAddress: fromAddress === mind?.id, choose };
}
