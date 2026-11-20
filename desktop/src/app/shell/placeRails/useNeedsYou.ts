import * as React from "react";

import { needsYouCount } from "@/app/shell/placeRails/needsYou";
import { useManagedPermissions } from "@/features/agents/useManagedPermissions";
import { useAllRuntimeTaskProposals } from "@/features/capabilities/useAllRuntimeTasks";
import { useManagedInputs } from "@/features/capabilities/useManagedInputs";
import { useAllProjectProposals } from "@/features/projects/useProjectProposals";
import {
  type ExchangeEntry,
  useAllExchanges,
} from "@/features/exchange/exchangeStore";
import type { PendingManagedInput } from "@/shared/api/managedInputs";
import type { ProjectProposalV1 } from "@/shared/api/tauriProjectProposals";
import type { RuntimeTaskProposal } from "@/shared/api/tauriRuntimeTasks";
import type { PendingManagedPermission } from "@/shared/api/types";

/**
 * What is waiting on you, from the lists that hold it (WP-14,
 * Decided 3): permission requests and questions, app-wide; every
 * conversation's open runtime-task proposals and project asks (WP-44); every
 * exchange paused for your word. `count` is what the Activity icon and the rail's row say.
 */
export type NeedsYou = {
  permissions: PendingManagedPermission[];
  questions: PendingManagedInput[];
  proposals: RuntimeTaskProposal[];
  projects: ProjectProposalV1[];
  paused: ExchangeEntry[];
  count: number;
};

export function useNeedsYou(): NeedsYou {
  const permissions = useManagedPermissions();
  const questions = useManagedInputs();
  const proposals = useAllRuntimeTaskProposals();
  const projects = useAllProjectProposals();
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
        projects: projects.length,
        proposals: proposals.length,
        questions: questions.length,
      }),
      paused,
      permissions,
      projects,
      proposals,
      questions,
    }),
    [paused, permissions, projects, proposals, questions],
  );
}
