import * as React from "react";

import { useSideConversations } from "@/features/exchange/useSideConversations";
import { useAgentInbox } from "@/features/exchange/useAgentInbox";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import { buildSideConversations } from "@/features/exchange/sideConversations";
import { deriveExchangePhase } from "@/shared/api/exchanges";
import type { RailSideRow } from "@/features/sidebar/lib/railHomes";
import {
  agentWorkRows,
  appTaskRows,
  resolveRailInboxSnapshot,
  type RailInboxSnapshot,
} from "@/features/sidebar/lib/railWork";
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
  /** False is unresolved/loading/unavailable, not an authoritative empty inbox. */
  agentWorkReady: boolean;
  /** Whose row it is, said as its home is named in the rail. */
  homeName: (rowId: string) => string | null;
};

export function useRailWork(): RailWork {
  const side = useSideConversations();
  const inbox = useAgentInbox();
  const { activeCommunity, reinitKey } = useCommunities();
  const ownerPubkey = useIdentityQuery().data?.pubkey?.toLowerCase();
  const epoch = JSON.stringify([activeCommunity?.id, reinitKey, ownerPubkey]);
  const snapshot = React.useRef<RailInboxSnapshot | null>(null);
  snapshot.current = resolveRailInboxSnapshot(
    snapshot.current,
    inbox.data?.pages,
    epoch,
    inbox.isFetching,
    inbox.isError,
  );
  const authorizedPages = snapshot.current?.pages;
  return React.useMemo(() => {
    const pages = authorizedPages ?? [];
    const firstPage = pages[0];
    const scope =
      firstPage && firstPage.scope.ownerPubkey.toLowerCase() === ownerPubkey
        ? firstPage.scope
        : undefined;
    const tasks = pages
      .filter(
        (page) =>
          page.scope.communityId === scope?.communityId &&
          page.scope.ownerPubkey === scope?.ownerPubkey,
      )
      .flatMap((page) => page.tasks);
    const correspondenceIds = new Map(
      tasks.flatMap((task) =>
        task.correspondenceId
          ? [[task.record.exchangeId, task.correspondenceId] as const]
          : [],
      ),
    );
    const authorizedTaskIds = new Set(
      tasks.map((task) => task.record.exchangeId),
    );
    const known = new Set(side.items.map((item) => item.id));
    const older = buildSideConversations({
      exchanges: tasks
        .filter((task) => !known.has(task.record.exchangeId))
        .map((task) => ({
          record: task.record,
          spent: 0,
          phase: deriveExchangePhase(
            task.record,
            0,
            Math.floor(Date.now() / 1000),
          ),
        })),
      tasks: [],
      times: new Map(),
    }).map((item) => ({ ...item, live: false })); // A historical open head is not proof of current execution.
    const byAgent = scope
      ? agentWorkRows(
          [...side.items, ...older],
          null,
          side.nameOf,
          side.roomOf,
          { ...scope, correspondenceIds, authorizedTaskIds },
        )
      : new Map<string, RailSideRow[]>();
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
      agentWorkReady: Boolean(scope),
      byApp,
      homeName: (rowId: string) => owner.get(rowId) ?? null,
      rows: [...byAgent.values(), ...byApp.values()].flat(),
    };
  }, [side.items, side.nameOf, side.roomOf, authorizedPages, ownerPubkey]);
}
