import { useQuery } from "@tanstack/react-query";
import {
  resolveRuntimeTaskProjectFolder,
  respondRuntimeTaskProposal,
  type RuntimeTaskProposal,
} from "@/shared/api/tauriRuntimeTasks";
import { isExistingRuntimeTask } from "../lib/runtimeTaskPresentation";
import { useRuntimeTasks } from "../useRuntimeTasks";
import {
  RuntimeTaskConfirmationCard,
  type RuntimeTaskDraft,
} from "./RuntimeTaskConfirmationCard";

/**
 * The task a proposal asks for, with the details its card opens on: the
 * project's folder, or the folder this conversation's last task ran in, or
 * the existing session's own. Shared by the card and by Activity's Needs you
 * (WP-14), whose row runs it with these defaults.
 */
export function useProposalDraft(
  proposal: RuntimeTaskProposal | undefined,
  projectSourceIds: string[],
  residentNames: ReadonlyMap<string, string>,
): RuntimeTaskDraft | null {
  const existingSession = isExistingRuntimeTask(proposal?.operation);
  const hasProjectSources = projectSourceIds.length > 0;
  const projectFolderQuery = useQuery({
    queryKey: ["runtime-task-project-folder", projectSourceIds],
    queryFn: () => resolveRuntimeTaskProjectFolder(projectSourceIds),
    enabled: Boolean(proposal) && hasProjectSources && !existingSession,
    retry: false,
    staleTime: 10_000,
  });
  // A plain DM carries no project, so nothing resolves a working folder and
  // Run would sit disabled with no way to see why. Fall back to the folder
  // the last task in this conversation ran in — the picker still overrides
  // it, and when there is no prior task the field stays empty.
  const priorTasksQuery = useRuntimeTasks(
    !existingSession && !hasProjectSources
      ? (proposal?.conversationId ?? null)
      : null,
  );
  if (!proposal) return null;
  const lastUsedFolder =
    (priorTasksQuery.data ?? [])
      .slice()
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .find((task) => Boolean(task.workingFolder))?.workingFolder ?? null;
  return {
    conversationId: proposal.conversationId,
    residentPubkey: proposal.residentPubkey,
    residentName: residentNames.get(proposal.residentPubkey) ?? "Your resident",
    runtimeFamily: proposal.runtimeFamily,
    summary: proposal.summary,
    prompt: proposal.summary,
    workingFolder: existingSession
      ? proposal.targetWorkingFolder
      : (projectFolderQuery.data ?? lastUsedFolder),
    operation: proposal.operation,
    sourceId: proposal.sourceId,
    sessionId: proposal.sessionId,
    targetLabel: proposal.targetLabel,
    targetWorkingFolder: proposal.targetWorkingFolder,
  };
}

export function RuntimeTaskProposalConfirmation({
  proposals,
  projectSourceIds,
  residentNames,
}: {
  proposals: RuntimeTaskProposal[];
  projectSourceIds: string[];
  residentNames: ReadonlyMap<string, string>;
}) {
  const proposal = proposals[0];
  const draft = useProposalDraft(proposal, projectSourceIds, residentNames);
  if (!proposal || !draft) return null;

  return (
    <RuntimeTaskConfirmationCard
      draft={draft}
      key={proposal.proposalId}
      onCancel={() => {
        void respondRuntimeTaskProposal({
          proposalId: proposal.proposalId,
          approved: false,
        });
      }}
      onConfirm={(details) =>
        respondRuntimeTaskProposal({
          proposalId: proposal.proposalId,
          approved: true,
          runtimeFamily: details.runtimeFamily,
          workingFolder: details.workingFolder,
          permissionMode: details.permissionMode,
        })
      }
      onConfirmed={() => {}}
    />
  );
}
