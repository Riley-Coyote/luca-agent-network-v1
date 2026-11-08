import * as React from "react";
import { useChannelsQuery, useOpenDmMutation } from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import {
  canonicalLucaResidentPubkey,
  isCanonicalLucaDm,
} from "@/features/luca/canonicalLucaResident";
import { useLucaResidentsQuery } from "@/features/luca/residents/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { Channel } from "@/shared/api/types";

/** Home and harness tasks use the same canonical companion DM, never a new transcript. */
export function useCompanionHome() {
  const identity = useIdentityQuery();
  const registry = useLucaResidentsQuery();
  const channels = useChannelsQuery();
  const { activeCommunity } = useCommunities();
  const residentPubkey = canonicalLucaResidentPubkey(registry.data?.residents);
  const channel =
    (channels.data ?? []).find((candidate) =>
      isCanonicalLucaDm(candidate, identity.data?.pubkey, residentPubkey),
    ) ?? null;
  const openDm = useOpenDmMutation().mutateAsync;
  const scope = `${identity.data?.pubkey}:${activeCommunity?.id}:${activeCommunity?.relayUrl}:${residentPubkey}`;
  const latest = React.useRef(scope);
  latest.current = scope;
  React.useEffect(() => {
    latest.current = scope;
    return () => {
      latest.current = "disposed";
    };
  }, [scope]);
  const pending = React.useRef<{
    scope: string;
    request: Promise<Channel>;
  } | null>(null);
  const ensureChannel = React.useCallback(async () => {
    if (!identity.data || !residentPubkey || !activeCommunity)
      throw new Error("Set up your companion before starting work here.");
    if (channel) return channel;
    const captured = scope;
    const request =
      pending.current?.scope === captured
        ? pending.current.request
        : openDm({ pubkeys: [residentPubkey] });
    pending.current = { scope: captured, request };
    try {
      const result = await request;
      if (latest.current !== captured)
        throw new Error("Your account changed. Nothing was sent; try again.");
      return result;
    } finally {
      if (pending.current?.request === request) pending.current = null;
    }
  }, [activeCommunity, channel, identity.data, openDm, residentPubkey, scope]);
  return {
    channel,
    ensureChannel,
    identity: identity.data,
    residentPubkey,
    ready: Boolean(residentPubkey && identity.data && activeCommunity),
    isLoading: identity.isLoading || registry.isLoading || channels.isLoading,
    scope,
  };
}
