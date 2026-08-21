import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { type HarnessId, harnessIdForAgent } from "@/shared/ui/HarnessLogo";

/**
 * pubkey → harness for every managed resident, so any mark in the
 * conversation or drawer can show the harness logo without threading a
 * lookup through every row. `null` means no provider is mounted (tests,
 * storybook-style surfaces): marks fall back to identity glyphs.
 */
const ResidentHarnessContext = React.createContext<ReadonlyMap<
  string,
  HarnessId
> | null>(null);

export function useResidentHarnessLookup(): ReadonlyMap<string, HarnessId> {
  const agentsQuery = useManagedAgentsQuery();
  return React.useMemo(
    () =>
      new Map(
        (agentsQuery.data ?? []).map(
          (agent) =>
            [normalizePubkey(agent.pubkey), harnessIdForAgent(agent)] as const,
        ),
      ),
    [agentsQuery.data],
  );
}

export function ResidentHarnessProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const lookup = useResidentHarnessLookup();
  return (
    <ResidentHarnessContext.Provider value={lookup}>
      {children}
    </ResidentHarnessContext.Provider>
  );
}

export function useResidentHarness(publicKey: string): HarnessId | null {
  const lookup = React.useContext(ResidentHarnessContext);
  if (!lookup) return null;
  return lookup.get(normalizePubkey(publicKey)) ?? null;
}
