import type { AgentManagementRequest } from "../agentManagement";
import type { AttachManagedAgentToChannelResult } from "../channelAgents";
import type { NativeProvisioningReceiptV1 } from "@/shared/api/tauriOperatorForge";

/** The native transaction and the separately completed conversation attachment. */
export type NativeAgentCompletion = {
  receipt: NativeProvisioningReceiptV1;
  attachment:
    | (AttachManagedAgentToChannelResult & { channelId: string })
    | null;
};

/** Build a host setup update without treating a started process as a ready agent. */
export function agentManagementCompletionMessage(
  request: AgentManagementRequest,
  sourceAgentPubkey: string,
  completion: NativeAgentCompletion,
) {
  const { receipt, attachment } = completion;
  if (
    request.action !== "create" ||
    receipt.status !== "complete" ||
    receipt.needsAttention ||
    !attachment ||
    attachment.channelId !== request.request.channelId
  ) {
    throw new Error(
      "The native creation has not completed in its original conversation.",
    );
  }
  const residentPubkey = receipt.residentPubkey?.trim().toLowerCase();
  const sourcePubkey = sourceAgentPubkey.trim().toLowerCase();
  if (
    !residentPubkey ||
    !/^[0-9a-f]{64}$/.test(residentPubkey) ||
    !/^[0-9a-f]{64}$/.test(sourcePubkey) ||
    attachment.agent.pubkey.trim().toLowerCase() !== residentPubkey ||
    attachment.agent.nativeRuntimeBinding?.kind !== receipt.runtime
  ) {
    throw new Error(
      "The completed native resident identity could not be confirmed.",
    );
  }

  const runtimeName =
    receipt.runtime === "hermes" ? "Hermes profile" : "OpenClaw agent";
  const processState =
    attachment.agent.status === "running" ||
    attachment.agent.status === "deployed"
      ? attachment.started
        ? "Its runtime process was started."
        : "Its runtime process was already running."
      : `Its runtime reports ${attachment.agent.status}.`;

  return {
    agentPubkey: sourcePubkey,
    channelId: request.request.channelId,
    content: `Polyphonic setup update: ${attachment.agent.name} was linked to its ${runtimeName} and added to this conversation. ${processState} An authenticated reply has not been verified.`,
    marker: `polyphonic-agent-creation.v1:${encodeURIComponent(request.requestId)}`,
    markerScope: "agent" as const,
  };
}
