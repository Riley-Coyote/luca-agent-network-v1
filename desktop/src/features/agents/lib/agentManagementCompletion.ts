import type { AgentManagementRequest } from "../agentManagement";
import type { AttachManagedAgentToChannelResult } from "../channelAgents";
import type { NativeProvisioningReceiptV1 } from "@/shared/api/tauriOperatorForge";
import { buildChannelLink } from "@/features/messages/lib/messageLink";

/** The native transaction and the separately completed conversation attachment. */
export type NativeAgentCompletion = {
  receipt: NativeProvisioningReceiptV1;
  originChannelId: string | null;
  attachment: AttachManagedAgentToChannelResult | null;
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
    completion.originChannelId !== request.request.channelId
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

  const runtimeName = receipt.runtime === "hermes" ? "Hermes" : "OpenClaw";
  const nextStep =
    attachment.agent.status === "running" ||
    attachment.agent.status === "deployed"
      ? "Send a first message to check the connection."
      : `Its status is ${attachment.agent.status}. Review its setup in Agents before sending a message.`;
  const expandedDm = attachment.channelId !== completion.originChannelId;
  const targetName = attachment.channelName
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\`*_[\]<>]/g, "\\$&");
  const destination = expandedDm
    ? `the group conversation “${targetName}”`
    : "this conversation";
  const targetLink = expandedDm
    ? ` [Open group conversation](${buildChannelLink(attachment.channelId)})`
    : "";

  return {
    agentPubkey: sourcePubkey,
    channelId: request.request.channelId,
    content: `Polyphonic setup update: ${attachment.agent.name} was added to ${destination} with ${runtimeName}. ${nextStep}${targetLink}`,
    marker: `polyphonic-agent-creation.v1:${encodeURIComponent(request.requestId)}`,
    markerScope: "agent" as const,
  };
}
