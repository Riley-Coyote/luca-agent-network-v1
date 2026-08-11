import { formatTime } from "@/features/messages/lib/dateFormatters";
import type { ManagedPresentationTurn } from "@/features/messages/managedPresentationTypes";
import type { TimelineMessage } from "@/features/messages/types";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";

export type ManagedTimelineProjection = {
  messages: TimelineMessage[];
  suppressedFinalMessageIds: ReadonlySet<string>;
};

function unixSeconds(timestamp: number): number {
  return timestamp > 10_000_000_000
    ? Math.floor(timestamp / 1_000)
    : Math.floor(timestamp);
}

function shouldRenderTurn(turn: ManagedPresentationTurn): boolean {
  if (turn.responseSurface !== "timeline") return false;
  if (turn.visibleText.length > 0 || turn.finalMessageId) return true;
  return turn.phase === "stopped" || turn.phase === "failed";
}

function projectTurn(
  turn: ManagedPresentationTurn,
  finalMessage: TimelineMessage | undefined,
  profiles?: UserProfileLookup,
): TimelineMessage {
  const createdAt = unixSeconds(turn.anchorAt);
  const messageId = finalMessage?.id ?? turn.uiKey;

  return {
    ...(finalMessage ?? {}),
    id: messageId,
    renderKey: turn.uiKey,
    createdAt,
    pubkey: finalMessage?.pubkey ?? turn.residentPubkey,
    signerPubkey: finalMessage?.signerPubkey ?? turn.residentPubkey,
    author:
      finalMessage?.author ??
      resolveUserLabel({ pubkey: turn.residentPubkey, profiles }),
    isAgent: true,
    time: finalMessage?.time ?? formatTime(createdAt),
    body: turn.visibleText,
    parentId: finalMessage?.parentId ?? null,
    rootId: finalMessage?.rootId ?? null,
    depth: finalMessage?.depth ?? 0,
    pending: false,
    managedPresentation: {
      failure: turn.failure,
      finalMessageId: turn.finalMessageId,
      phase: turn.phase,
      uiKey: turn.uiKey,
    },
  };
}

/**
 * Replaces signed managed finals with their process-memory response slot for
 * the mounted conversation. The slot keeps one React/Virtua key from first
 * public text through final reconciliation; durable history remains unchanged.
 */
export function projectManagedTimelineMessages(
  messages: readonly TimelineMessage[],
  turns: readonly ManagedPresentationTurn[],
  profiles?: UserProfileLookup,
): ManagedTimelineProjection {
  const renderableTurns = [...turns.filter(shouldRenderTurn)].sort(
    (left, right) =>
      left.anchorAt - right.anchorAt ||
      (left.slotOrdinal ?? Number.MAX_SAFE_INTEGER) -
        (right.slotOrdinal ?? Number.MAX_SAFE_INTEGER) ||
      left.uiKey.localeCompare(right.uiKey),
  );
  const suppressedFinalMessageIds = new Set(
    renderableTurns.flatMap((turn) =>
      turn.finalMessageId ? [turn.finalMessageId] : [],
    ),
  );
  const finalById = new Map(
    messages
      .filter((message) => suppressedFinalMessageIds.has(message.id))
      .map((message) => [message.id, message]),
  );
  const projected = messages.filter(
    (message) => !suppressedFinalMessageIds.has(message.id),
  );

  for (const turn of renderableTurns) {
    const message = projectTurn(
      turn,
      turn.finalMessageId ? finalById.get(turn.finalMessageId) : undefined,
      profiles,
    );
    let insertAt = projected.length;
    for (let index = projected.length - 1; index >= 0; index -= 1) {
      if (projected[index].createdAt <= message.createdAt) {
        insertAt = index + 1;
        break;
      }
      insertAt = index;
    }
    projected.splice(insertAt, 0, message);
  }

  return { messages: projected, suppressedFinalMessageIds };
}
