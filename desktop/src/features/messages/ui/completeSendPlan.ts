/**
 * Pure decisions for `completeSend` (useMentionSendFlow.ts).
 *
 * The send path has two shapes. Inviting non-members into a DM must
 * prepare the expanded channel — and confirm every mentioned agent can
 * start — BEFORE anything is cleared or sent, because on failure the
 * composer must still hold the text (asserted by the "drops an expanded
 * DM after agent startup fails" e2e). An ordinary send already knows its
 * channel, so nothing is allowed to stand between Enter and the message
 * appearing: the composer clears and the optimistic row lands first, and
 * agent readiness runs behind the send. In the real app the difference is
 * a full resident process start — seconds — that used to gate the
 * user's own message becoming visible.
 */
export type CompleteSendBranch = "invite-dm" | "ordinary";

export function resolveCompleteSendPlan(input: {
  dmParticipantPubkeys: string[];
  hasPrepareSendChannel: boolean;
  capturedChannelId: string | null;
}): { branch: CompleteSendBranch; sendChannelId: string | null } {
  if (input.dmParticipantPubkeys.length > 0 && input.hasPrepareSendChannel) {
    return { branch: "invite-dm", sendChannelId: null };
  }
  return { branch: "ordinary", sendChannelId: input.capturedChannelId };
}

/**
 * The readiness-failure toast, byte-identical on both branches (the
 * invite-DM e2e matches on the raw error substring).
 */
export function formatAgentReadinessError(errors: string[]): string {
  return errors.length === 1
    ? `Could not start agent mention: ${errors[0]}`
    : `Could not start agent mentions: ${errors.join("; ")}`;
}
