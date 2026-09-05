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
  provisioningIntent: "fresh" | "template" | "advanced" | "import" | null;
  nativeProfileName?: string | null;
  createdAt: string;
};

/** Artifact references the host verifies before returning a setup outcome. */
export type ResidentProposalCompletion =
  | { status: "native_imported" }
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

/** Exact discovery and effects the owner selected in the existing import review. */
export type NativeImportSelection = {
  semanticId: string;
  bindingFingerprint: string;
  startNow: boolean;
  startOnAppLaunch: boolean;
  continuityEnabled: boolean;
};

/** Public facts from the host-correlated native import, never signing material. */
export type NativeImportResult = {
  residentPubkey: string;
  displayName: string;
  nativeProfileName: string;
  reused: boolean;
  processRunning: boolean;
  authenticatedReady: false;
  startupError: string | null;
  warning: string | null;
  preferencesError: string | null;
};

/** Admit an import, inspect its result, or explicitly retry its bound settings/start. */
export function importResidentProposal(
  requestId: string,
  selection?: NativeImportSelection,
  retryStart = false,
  retrySettings = false,
): Promise<NativeImportResult> {
  return invokeTauri("import_resident_proposal", {
    requestId,
    selection,
    retryStart,
    ...(retrySettings ? { retrySettings: true } : {}),
  });
}

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

/** A resolved request can no longer admit an import or startup action. */
export function listenResidentProposalResolutions(
  listener: (requestId: string) => void,
): Promise<UnlistenFn> {
  return listen<{ requestId: string }>(
    "luca://resident-proposal-resolved",
    ({ payload }) => listener(payload.requestId),
  );
}
