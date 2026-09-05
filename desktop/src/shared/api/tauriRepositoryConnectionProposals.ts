import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { invokeTauri } from "@/shared/api/tauri";

/** A host-correlated request to review one discovered repository connection. */
export type RepositoryConnectionProposalV1 = {
  requestId: string;
  ownerPubkey: string;
  residentPubkey: string;
  conversationId: string;
  purpose: string;
  createdAt: string;
};

/** Replay this owner's still-pending repository reviews after subscribing. */
export function listRepositoryConnectionProposals(): Promise<
  RepositoryConnectionProposalV1[]
> {
  return invokeTauri("list_repository_connection_proposals");
}

/** Recheck current host authority before discovery or owner review. */
export function authorizeRepositoryConnectionProposal(
  requestId: string,
): Promise<void> {
  return invokeTauri("authorize_repository_connection_proposal", { requestId });
}

/** Return a host-verified result; false acknowledges an already verified replay. */
export function finishRepositoryConnectionProposal(
  requestId: string,
  outcome: "connected" | "closed" | "busy",
): Promise<boolean> {
  return invokeTauri("finish_repository_connection_proposal", {
    requestId,
    outcome,
  });
}

/** Subscribe before requesting the startup snapshot. */
export function listenRepositoryConnectionProposals(
  listener: (proposal: RepositoryConnectionProposalV1) => void,
): Promise<UnlistenFn> {
  return listen<RepositoryConnectionProposalV1>(
    "luca://repository-connection-proposal",
    ({ payload }) => listener(payload),
  );
}

/** Close a review when the host expires, cancels or resolves its request. */
export function listenRepositoryConnectionProposalResolutions(
  listener: (requestId: string) => void,
): Promise<UnlistenFn> {
  return listen<{ requestId: string }>(
    "luca://repository-connection-proposal-resolved",
    ({ payload }) => listener(payload.requestId),
  );
}
