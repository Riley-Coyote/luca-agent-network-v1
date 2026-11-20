import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import {
  useProjectProposals,
  useSettledProjectProposals,
} from "@/features/projects/useProjectProposals";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  ProjectProposalAsk,
  ProjectProposalSettled,
} from "./ProjectProposalAsk";

/** A resident's name for a project card, by its key. */
export function useResidentNameOf(): (pubkey: string) => string {
  const agents = useManagedAgentsQuery().data;
  return React.useMemo(() => {
    const names = new Map(
      (agents ?? []).map((agent) => [
        normalizePubkey(agent.pubkey),
        agent.name,
      ]),
    );
    return (pubkey: string) =>
      names.get(normalizePubkey(pubkey)) ?? "Your resident";
  }, [agents]);
}

/**
 * One conversation's project asks, for its own stack of asks: the waiting
 * cards (`li`s, counted with the conversation's other asks) and the quiet
 * lines the created ones leave among its current work.
 */
export function useConversationProjectAsks(conversationId: string | null) {
  const proposals = useProjectProposals(conversationId);
  const { dismiss, focused, lines } =
    useSettledProjectProposals(conversationId);
  const nameOf = useResidentNameOf();
  const asks = proposals.map((proposal) => (
    <ProjectProposalAsk
      common={{ "data-testid": "project-proposal-row" }}
      focusLineOnCreate
      key={proposal.requestId}
      nameOf={nameOf}
      proposal={proposal}
      summary={`${nameOf(proposal.residentPubkey)} asks`}
    />
  ));
  const settled = lines.map((line) => (
    <ProjectProposalSettled
      key={line.requestId}
      line={line}
      onDismiss={() => dismiss(line.requestId)}
      onFocused={() => focused(line.requestId)}
    />
  ));
  return { asks, count: proposals.length, settled };
}
