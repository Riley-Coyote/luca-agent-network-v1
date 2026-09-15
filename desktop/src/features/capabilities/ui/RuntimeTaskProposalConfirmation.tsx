import { useQuery } from "@tanstack/react-query";
import {
  listRuntimeTasks,
  resolveRuntimeTaskProjectFolder,
  respondRuntimeTaskProposal,
  type RuntimeTaskProposal,
} from "@/shared/api/tauriRuntimeTasks";
import {
  RuntimeTaskConfirmationCard,
  type RuntimeTaskDraft,
} from "./RuntimeTaskConfirmationCard";

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
  const hasProjectSources = projectSourceIds.length > 0;
  const projectFolderQuery = useQuery({
    queryKey: ["runtime-task-project-folder", projectSourceIds],
    queryFn: () => resolveRuntimeTaskProjectFolder(projectSourceIds),
    enabled: Boolean(proposal) && hasProjectSources,
    retry: false,
    staleTime: 10_000,
  });
  // A plain DM carries no project, so nothing resolves a working folder and
  // Run would sit disabled with no way to see why. Fall back to the folder
  // the last task in this conversation ran in — the picker still overrides
  // it, and when there is no prior task the field stays empty.
  const conversationId = proposal?.conversationId ?? null;
  const priorTasksQuery = useQuery({
    queryKey: ["runtime-tasks", conversationId],
    queryFn: () => listRuntimeTasks(conversationId ?? ""),
    enabled: Boolean(conversationId) && !hasProjectSources,
    retry: false,
    staleTime: 1_000,
  });
  if (!proposal) return null;
  const lastUsedFolder =
    (priorTasksQuery.data ?? [])
      .slice()
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .find((task) => Boolean(task.workingFolder))?.workingFolder ?? null;
  const draft: RuntimeTaskDraft = {
    conversationId: proposal.conversationId,
    residentPubkey: proposal.residentPubkey,
    residentName: residentNames.get(proposal.residentPubkey) ?? "Your resident",
    runtimeFamily: proposal.runtimeFamily,
    summary: proposal.summary,
    prompt: proposal.summary,
    workingFolder: projectFolderQuery.data ?? lastUsedFolder,
  };

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
