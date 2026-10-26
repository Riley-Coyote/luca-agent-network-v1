import * as React from "react";

import { needsYouCount } from "@/app/shell/placeRails/needsYou";
import { useManagedPermissions } from "@/features/agents/useManagedPermissions";
import { useAllRuntimeTaskProposals } from "@/features/capabilities/useAllRuntimeTasks";
import { useManagedInputs } from "@/features/capabilities/useManagedInputs";
import {
  type ExchangeEntry,
  useAllExchanges,
} from "@/features/exchange/exchangeStore";
import type { PendingManagedInput } from "@/shared/api/managedInputs";
import type { RuntimeTaskProposal } from "@/shared/api/tauriRuntimeTasks";
import type { PendingManagedPermission } from "@/shared/api/types";

/**
 * What is waiting on you, from the four lists that hold it (WP-14,
 * Decided 3): permission requests and questions, app-wide; every
 * conversation's open runtime-task proposals; every exchange paused for your
 * word. `count` is what the Activity icon and the rail's row say.
 */
export type NeedsYou = {
  permissions: PendingManagedPermission[];
  questions: PendingManagedInput[];
  proposals: RuntimeTaskProposal[];
  paused: ExchangeEntry[];
  count: number;
};

export function useNeedsYou(): NeedsYou {
  const permissions = useManagedPermissions();
  const questions = useManagedInputs();
  const proposals = useAllRuntimeTaskProposals();
  const exchanges = useAllExchanges();
  const paused = React.useMemo(
    () => exchanges.filter((entry) => entry.phase === "paused"),
    [exchanges],
  );
  return React.useMemo(
    () => ({
      count: needsYouCount({
        pausedExchanges: paused.length,
        permissions: permissions.length,
        proposals: proposals.length,
        questions: questions.length,
      }),
      paused,
      permissions,
      proposals,
      questions,
    }),
    [paused, permissions, proposals, questions],
  );
}
