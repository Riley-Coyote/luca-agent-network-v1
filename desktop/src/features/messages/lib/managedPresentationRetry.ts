import type { ManagedPresentationTurn } from "@/features/messages/managedPresentationTypes";
import type { TimelineMessage } from "@/features/messages/types";

const RETRYABLE_PHASES = new Set<ManagedPresentationTurn["phase"]>([
  "stopped",
  "needs_attention",
  "failed",
]);

export type ManagedPresentationRetry = {
  content: string;
  mediaTags: string[][] | undefined;
  residentPubkey: string;
};

/**
 * Resolves an explicit retry back to the exact owner message that staged the
 * failed resident turn. The renderer never invents a retry prompt or widens
 * its resident audience when the durable anchor is unavailable.
 */
export function resolveManagedPresentationRetry({
  currentPubkey,
  messages,
  residentPubkey,
  turn,
}: {
  currentPubkey: string | undefined;
  messages: readonly TimelineMessage[];
  residentPubkey: string;
  turn: ManagedPresentationTurn | null;
}): ManagedPresentationRetry | null {
  const normalizedOwner = currentPubkey?.toLowerCase();
  const normalizedResident = residentPubkey.toLowerCase();
  if (
    !normalizedOwner ||
    !turn ||
    turn.residentPubkey.toLowerCase() !== normalizedResident ||
    !RETRYABLE_PHASES.has(turn.phase) ||
    turn.finalMessageId !== null
  ) {
    return null;
  }

  const anchorIds = new Set(
    [turn.durableReceiptId, turn.dispatchReceiptId, turn.anchorKey].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    ),
  );
  const anchor = messages.find(
    (message) =>
      anchorIds.has(message.id) &&
      message.pubkey?.toLowerCase() === normalizedOwner,
  );
  if (!anchor) return null;

  const mediaTags = anchor.tags?.filter((tag) =>
    ["emoji", "imeta"].includes(tag[0] ?? ""),
  );
  if (anchor.body.trim().length === 0 && !mediaTags?.length) return null;

  return {
    content: anchor.body,
    mediaTags: mediaTags?.length ? mediaTags : undefined,
    residentPubkey: normalizedResident,
  };
}
