import * as React from "react";

import { useSideConversations } from "@/features/exchange/useSideConversations";
import type { RailSideRow } from "@/features/sidebar/lib/railHomes";
import { agentWorkRows, appTaskRows } from "@/features/sidebar/lib/railWork";
import {
  HARNESS_LABELS,
  harnessIdFromRuntimeId,
} from "@/shared/ui/HarnessLogo";

/**
 * The work under whoever does it (WP-34, Decided 3), live: each agent's
 * exchanges by its key, each app's tasks by its family, and every row in one
 * list for the rail's mark and the lip's name (`useOpenSideId`).
 */
export type RailWork = {
  byAgent: ReadonlyMap<string, RailSideRow[]>;
  byApp: ReadonlyMap<string, RailSideRow[]>;
  rows: readonly RailSideRow[];
  /** Whose row it is, said as its home is named in the rail. */
  homeName: (rowId: string) => string | null;
};

export function useRailWork(): RailWork {
  const side = useSideConversations();
  return React.useMemo(() => {
    const byAgent = agentWorkRows(side.items, null, side.nameOf, side.roomOf);
    const byApp = appTaskRows(side.items);
    const owner = new Map<string, string>();
    for (const [key, rows] of byAgent)
      for (const row of rows)
        if (!owner.has(row.id)) owner.set(row.id, side.nameOf(key));
    for (const [family, rows] of byApp)
      for (const row of rows)
        if (!owner.has(row.id))
          owner.set(row.id, HARNESS_LABELS[harnessIdFromRuntimeId(family)]);
    return {
      byAgent,
      byApp,
      homeName: (rowId: string) => owner.get(rowId) ?? null,
      rows: [...byAgent.values(), ...byApp.values()].flat(),
    };
  }, [side.items, side.nameOf, side.roomOf]);
}
