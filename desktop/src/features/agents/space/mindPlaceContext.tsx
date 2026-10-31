import * as React from "react";

import { useResidentPlace } from "@/features/agents/place/useResidentPlace";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { ResidentPlace } from "@/shared/api/tauriResidentPlace";

export type ResidentPlaceView = ResidentPlace;

export type MindPlaceState = ReturnType<typeof useResidentPlace>;

const MindPlaceContext = React.createContext<MindPlaceState | null>(null);

/** Their place (their words, what they're exploring, their pinned piece),
 *  read once for their page and Settings alike. */
export function useMindPlace(): MindPlaceState | null {
  return React.useContext(MindPlaceContext);
}

/**
 * The place is a local, scope-bound record (`useResidentPlace`): it is
 * re-read whenever the owner, the community or the resident changes, as
 * `ResidentPlaceSection` keys it. A mind not on this Mac has none.
 */
export function MindPlaceProvider({
  children,
  residentPubkey,
}: {
  children: React.ReactNode;
  residentPubkey: string | null;
}) {
  const identity = useIdentityQuery();
  const { activeCommunity, reinitKey } = useCommunities();
  const owner = identity.data?.pubkey;
  if (!residentPubkey || !owner || !activeCommunity)
    return (
      <MindPlaceContext.Provider value={null}>
        {children}
      </MindPlaceContext.Provider>
    );
  return (
    <ScopedPlace
      key={`${owner}:${activeCommunity.id}:${reinitKey}:${residentPubkey}`}
      residentPubkey={residentPubkey}
    >
      {children}
    </ScopedPlace>
  );
}

function ScopedPlace({
  children,
  residentPubkey,
}: {
  children: React.ReactNode;
  residentPubkey: string;
}) {
  const state = useResidentPlace(residentPubkey);
  return (
    <MindPlaceContext.Provider value={state}>
      {children}
    </MindPlaceContext.Provider>
  );
}
