import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { invokeTauri } from "@/shared/api/tauri";

/** A host-scoped request to open the existing resident creation review. */
export type ResidentProposal = {
  requestId: string;
  ownerPubkey: string;
  residentPubkey: string;
  conversationId: string;
  displayName: string;
  systemPrompt: string;
  runtimeFamily: "codex" | "claude_code" | "hermes" | "openclaw" | null;
  provisioningIntent: "fresh" | "template" | "advanced" | null;
  createdAt: string;
};

/** Artifact references the host verifies before returning a setup outcome. */
export type ResidentProposalCompletion =
  | {
      status: "native_created";
      transactionId: string;
      attachedConversationId?: string;
    }
  | {
      status: "managed_created";
      residentPubkey: string;
      personaId: string;
      attachedConversationId?: string;
    }
  | { status: "definition_saved"; personaId: string }
  | { status: "closed"; busy: boolean };

/** Replay this owner's live pending review after renderer initialization. */
export function listResidentProposals(): Promise<ResidentProposal[]> {
  return invokeTauri("list_resident_proposals");
}

/** Recheck current session, ownership and conversation before an owner action. */
export function authorizeResidentProposal(requestId: string): Promise<void> {
  return invokeTauri("authorize_resident_proposal", { requestId });
}

/** Verify and return an outcome; false acknowledges an already verified retry. */
export function finishResidentProposal(
  requestId: string,
  completion: ResidentProposalCompletion,
): Promise<boolean> {
  return invokeTauri("finish_resident_proposal", { requestId, completion });
}

/** Subscribe before replaying pending requests to avoid a startup delivery gap. */
export function listenResidentProposals(
  listener: (proposal: ResidentProposal) => void,
): Promise<UnlistenFn> {
  return listen<ResidentProposal>("luca://resident-proposal", ({ payload }) =>
    listener(payload),
  );
}
