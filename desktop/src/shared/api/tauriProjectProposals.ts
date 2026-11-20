import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { invokeTauri } from "@/shared/api/tauri";

/**
 * A resident's ask to start a project, as the host holds it. Only the name and
 * the purpose come from the resident; who asks, where, and who joins are the
 * host's own facts. `kind` leaves room for asking for a new chat inside an
 * existing project later without renaming anything.
 */
export type ProjectProposalV1 = {
  requestId: string;
  kind: "new_project";
  ownerPubkey: string;
  residentPubkey: string;
  conversationId: string;
  projectName: string;
  purpose: string;
  chatName: string;
  /** The asking resident first, then each one it included. */
  residentPubkeys: string[];
  createdAt: string;
};

/** The owner's answer, after the window ran (or did not run) the creation. */
export type ProjectProposalAnswerV1 =
  | { outcome: "created"; projectId: string; chatId: string }
  | {
      outcome: "partial";
      projectId?: string;
      chatId?: string;
      problem: string;
    }
  | { outcome: "declined" };

export type ProjectProposalResolvedV1 = {
  requestId: string;
  conversationId: string;
};

/** Replay this owner's still-waiting project asks after subscribing. */
export function listProjectProposals(): Promise<ProjectProposalV1[]> {
  return invokeTauri("list_project_proposals");
}

/** Recheck the asker and its conversation right before anything is created. */
export function authorizeProjectProposal(requestId: string): Promise<void> {
  return invokeTauri("authorize_project_proposal", { requestId });
}

/** Give the waiting resident the owner's answer; true when it was the answer. */
export function finishProjectProposal(
  requestId: string,
  answer: ProjectProposalAnswerV1,
): Promise<boolean> {
  return invokeTauri("finish_project_proposal", { requestId, answer });
}

export function listenProjectProposals(
  listener: (proposal: ProjectProposalV1) => void,
): Promise<UnlistenFn> {
  return listen<ProjectProposalV1>("luca://project-proposal", ({ payload }) =>
    listener(payload),
  );
}

/** The host answered, expired or ended an ask; its card goes. */
export function listenProjectProposalResolved(
  listener: (resolution: ProjectProposalResolvedV1) => void,
): Promise<UnlistenFn> {
  return listen<ProjectProposalResolvedV1>(
    "luca://project-proposal-resolved",
    ({ payload }) => listener(payload),
  );
}
