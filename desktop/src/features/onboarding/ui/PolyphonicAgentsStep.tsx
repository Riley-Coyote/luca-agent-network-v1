import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import type { DiscoveredResidentCandidate } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import {
  candidatesFromDiscovery,
  useNativeResidentDiscoveryQuery,
} from "../onboardingAgentImport";
import { stageOnboardingAgentImports } from "../onboardingBackgroundImport";
import type { PolyphonicAgentImportChoice } from "../polyphonicOnboardingState";
import { PolyphonicAgentImportPane } from "./PolyphonicAgentImportPane";
import { PolyphonicStepHeading } from "./PolyphonicSetupFrame";

export type PolyphonicAgentsStepHandle = {
  commit: () => Promise<{ selection: PolyphonicAgentImportChoice[] }>;
};

const EMPTY_MESSAGE =
  "No agents found on this Mac yet. You can bring agents in later from the Agents page.";

function asChoice(
  candidate: DiscoveredResidentCandidate,
): PolyphonicAgentImportChoice {
  return {
    semanticId: candidate.semanticId,
    nativeType: candidate.nativeType,
    displayName: candidate.displayName,
  };
}

/**
 * "Bring in your agents."
 *
 * The third question of setup, and the last one. Every agent the scan found on
 * this Mac is a row with a checkbox, and none is ticked on the owner's behalf.
 * Nothing is read and nothing is imported here: the ones they tick are staged,
 * and the waking step enqueues them to be brought in behind the first
 * conversation, so this answer never costs the owner a second of waiting.
 *
 * The scan itself started a chapter earlier (see the flow), so the rows are
 * normally already there when this chapter opens.
 */
export const PolyphonicAgentsStep = React.forwardRef<
  PolyphonicAgentsStepHandle,
  {
    /** Whether the agents brought in here get memory of their own. */
    residentMemory: boolean;
    /** What the owner had already ticked, when setup is resumed. */
    savedSelection: readonly PolyphonicAgentImportChoice[];
    /** How the footer's one action should read. `found` is 0 on a Mac with
     *  no agents on it, which is a different sentence from "none ticked". */
    onSelectionChange: (state: { found: number; selected: number }) => void;
    onSkip: () => void;
  }
>(function PolyphonicAgentsStep(
  { onSelectionChange, onSkip, residentMemory, savedSelection },
  ref,
) {
  const discovery = useNativeResidentDiscoveryQuery();
  const managedQuery = useManagedAgentsQuery();
  const candidates = React.useMemo(
    () => candidatesFromDiscovery(discovery.data),
    [discovery.data],
  );
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(
    () => new Set(savedSelection.map((choice) => choice.semanticId)),
  );

  // A resumed setup keeps the ticks it can still honour: an identity that is
  // no longer on the Mac drops out rather than being imported blind.
  const knownIds = React.useMemo(
    () => new Set(candidates.map((candidate) => candidate.semanticId)),
    [candidates],
  );
  React.useEffect(() => {
    if (knownIds.size === 0) return;
    setSelected((current) => {
      const next = new Set([...current].filter((id) => knownIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [knownIds]);

  const selectedCandidates = React.useMemo(
    () => candidates.filter((candidate) => selected.has(candidate.semanticId)),
    [candidates, selected],
  );
  const selectedCount = selectedCandidates.length;
  const foundCount = candidates.length;
  React.useEffect(() => {
    onSelectionChange({ found: foundCount, selected: selectedCount });
  }, [foundCount, onSelectionChange, selectedCount]);

  const commit = React.useCallback(async () => {
    const selection = selectedCandidates.map(asChoice);
    // Handed to the waking step, which starts the queue once Luca exists.
    stageOnboardingAgentImports(selectedCandidates, { residentMemory });
    return { selection };
  }, [residentMemory, selectedCandidates]);
  React.useImperativeHandle(ref, () => ({ commit }), [commit]);

  const scanError = discovery.isError
    ? discovery.error instanceof Error
      ? discovery.error.message
      : "Luca couldn’t look for agents on this Mac."
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PolyphonicStepHeading
        description="Agents Luca found on this Mac. Pick the ones that should live here too. Nothing is read now."
        stage="agents"
        title="Bring in your agents"
      />
      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <PolyphonicAgentImportPane
          candidates={candidates}
          compact
          connectedAgents={(managedQuery.data ?? []).map((resident) => ({
            id: resident.pubkey,
            name: resident.name,
          }))}
          emptyMessage={EMPTY_MESSAGE}
          isScanning={discovery.isPending}
          onRescan={
            discovery.isFetching ? undefined : () => void discovery.refetch()
          }
          onToggleCandidate={(candidate) => {
            setSelected((current) => {
              const next = new Set(current);
              if (next.has(candidate.semanticId))
                next.delete(candidate.semanticId);
              else next.add(candidate.semanticId);
              return next;
            });
          }}
          scanError={scanError}
          selectedIds={selected}
          sourceOutcomes={discovery.data?.runtimes ?? []}
        />
      </div>
      {/* The quiet half of the choice. It is offered only while there is
          something to decline: with nothing ticked the primary already says
          "Continue", and a second way past would be the same button twice. */}
      {selectedCount > 0 ? (
        <Button
          className="mt-3 h-8 shrink-0 self-start rounded-md border border-transparent px-1.5 text-xs font-normal text-[var(--prototype-muted)] outline-none hover:bg-[var(--prototype-selection)] hover:text-[var(--prototype-ink)] focus-visible:border-[color-mix(in_srgb,var(--prototype-ink)_40%,transparent)] focus-visible:outline-none"
          data-testid="polyphonic-agents-skip"
          onClick={onSkip}
          type="button"
          variant="ghost"
        >
          Skip for now
        </Button>
      ) : null}
    </div>
  );
});
