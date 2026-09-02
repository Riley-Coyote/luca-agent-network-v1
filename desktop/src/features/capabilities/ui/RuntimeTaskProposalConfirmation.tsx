import { useQuery } from "@tanstack/react-query";
import {
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
  const projectFolderQuery = useQuery({
    queryKey: ["runtime-task-project-folder", projectSourceIds],
    queryFn: () => resolveRuntimeTaskProjectFolder(projectSourceIds),
    enabled: Boolean(proposal && projectSourceIds.length > 0),
    retry: false,
    staleTime: 10_000,
  });
  if (!proposal) return null;
  const draft: RuntimeTaskDraft = {
    conversationId: proposal.conversationId,
    residentPubkey: proposal.residentPubkey,
    residentName: residentNames.get(proposal.residentPubkey) ?? "Your resident",
    runtimeFamily: proposal.runtimeFamily,
    summary: proposal.summary,
    prompt: proposal.summary,
    workingFolder: projectFolderQuery.data ?? null,
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
