import * as React from "react";
import { useWorkingChannels } from "@/features/agents/agentWorkingSignal";
import { useAllExchanges } from "@/features/exchange/exchangeStore";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { Channel } from "@/shared/api/types";
import { railEngagements, type RailResident } from "./agentRailVisibility";
import {
  setAgentsVisibleInRail,
  useCurrentAgentRailVisibility,
} from "./useAgentRailVisibility";

/** Keep discoveries even after work finishes, in every place (not only Chats).
 * Manual hiding is respected until another engagement begins. Historical inbox
 * reloads are not new engagements and never repopulate a deliberately quiet rail. */
export function useRevealEngagedRailAgents(
  residents: readonly RailResident[],
  channels: readonly Channel[],
) {
  const { key } = useCurrentAgentRailVisibility();
  const owner = useIdentityQuery().data?.pubkey;
  const exchanges = useAllExchanges();
  const working = useWorkingChannels();
  const seen = React.useRef({ key, tokens: new Set<string>() });
  React.useEffect(() => {
    if (seen.current.key !== key) seen.current = { key, tokens: new Set() };
    if (!key || !owner) return;
    const revealed = new Set<string>();
    for (const engagement of railEngagements(
      owner,
      residents,
      channels,
      exchanges,
      working,
    )) {
      if (seen.current.tokens.has(engagement.token)) continue;
      seen.current.tokens.add(engagement.token);
      for (const pubkey of engagement.pubkeys) revealed.add(pubkey);
    }
    if (revealed.size) setAgentsVisibleInRail(key, [...revealed], true);
  }, [key, owner, residents, channels, exchanges, working]);
}
