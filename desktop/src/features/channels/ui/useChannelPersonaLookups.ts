import * as React from "react";

import { usePersonasQuery } from "@/features/agents/hooks";
import type { ManagedAgent, RespondToMode } from "@/shared/api/types";

/** Trusted resident presentation metadata shared by header and timeline rows. */
export function useChannelPersonaLookups(
  managedAgents: readonly ManagedAgent[] | undefined,
) {
  const personasQuery = usePersonasQuery();
  return React.useMemo(() => {
    const personaById = new Map(
      (personasQuery.data ?? []).map((persona) => [
        persona.id,
        persona.displayName,
      ]),
    );
    const personaLookup = new Map<string, string>();
    const residentPersonaIdLookup = new Map<string, string | null>();
    const respondToLookup = new Map<string, RespondToMode>();

    for (const agent of managedAgents ?? []) {
      const pubkey = agent.pubkey.toLowerCase();
      respondToLookup.set(pubkey, agent.respondTo);
      residentPersonaIdLookup.set(pubkey, agent.personaId);
      const personaName = agent.personaId
        ? personaById.get(agent.personaId)
        : null;
      if (personaName) personaLookup.set(pubkey, personaName);
    }

    return { personaLookup, residentPersonaIdLookup, respondToLookup };
  }, [managedAgents, personasQuery.data]);
}
