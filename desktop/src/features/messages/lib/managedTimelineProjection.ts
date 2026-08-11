import { formatTime } from "@/features/messages/lib/dateFormatters";
import type { ManagedResponseSurface } from "@/features/messages/lib/managedAudience";
import type { ManagedResponseSlot } from "@/features/messages/managedPresentationTypes";
import type { TimelineMessage } from "@/features/messages/types";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";

export type ManagedTimelineProjection = {
  messages: TimelineMessage[];
  suppressedFinalMessageIds: ReadonlySet<string>;
};

function deduplicateMessagesById(
  messages: readonly TimelineMessage[],
): TimelineMessage[] {
  const positions = new Map<string, number>();
  const unique: TimelineMessage[] = [];
  for (const message of messages) {
    const existingIndex = positions.get(message.id);
    if (existingIndex === undefined) {
      positions.set(message.id, unique.length);
      unique.push(message);
      continue;
    }
    const existing = unique[existingIndex];
    // A relay echo can overlap its optimistic copy for one render. Preserve
    // the first timeline position while preferring the durable canonical row.
    if (existing.pending && !message.pending) {
      unique[existingIndex] = message;
    } else if (existing.pending === message.pending) {
      unique[existingIndex] = message;
    }
  }
  return unique;
}

function unixSeconds(timestamp: number): number {
  return timestamp > 10_000_000_000
    ? Math.floor(timestamp / 1_000)
    : Math.floor(timestamp);
}

function projectSlot(
  slot: ManagedResponseSlot,
  finalMessage: TimelineMessage | undefined,
  anchorMessage: TimelineMessage | undefined,
  profiles?: UserProfileLookup,
  residentPersonaIdLookup?: ReadonlyMap<string, string | null>,
): TimelineMessage {
  const createdAt = unixSeconds(slot.anchorAt);
  const messageId = finalMessage?.id ?? slot.uiKey;
  const isThreadResponse = slot.responseSurface === "thread";

  return {
    ...(finalMessage ?? {}),
    id: messageId,
    renderKey: slot.uiKey,
    createdAt,
    pubkey: finalMessage?.pubkey ?? slot.residentPubkey,
    signerPubkey: finalMessage?.signerPubkey ?? slot.residentPubkey,
    author:
      finalMessage?.author ??
      resolveUserLabel({ pubkey: slot.residentPubkey, profiles }),
    isAgent: true,
    residentPersonaId:
      finalMessage?.residentPersonaId ??
      residentPersonaIdLookup?.get(slot.residentPubkey.toLowerCase()) ??
      null,
    time: finalMessage?.time ?? formatTime(createdAt),
    body: finalMessage?.body ?? "",
    // Timeline finals keep their causal NIP-10 reference in the signed event,
    // but `broadcast=1` makes their visual surface top-level. Never let the
    // durable event's causal depth indent the stable in-memory response slot
    // when signing hydrates it.
    parentId: isThreadResponse
      ? (finalMessage?.parentId ?? anchorMessage?.id ?? slot.anchorKey)
      : null,
    rootId: isThreadResponse
      ? (finalMessage?.rootId ??
        anchorMessage?.rootId ??
        anchorMessage?.id ??
        slot.anchorKey)
      : null,
    depth: isThreadResponse
      ? (finalMessage?.depth ?? (anchorMessage?.depth ?? 0) + 1)
      : 0,
    pending: false,
    managedPresentation: {
      canonicalPresent: Boolean(finalMessage),
      failure: null,
      finalMessageId: slot.finalMessageId,
      finalReconciliation: null,
      phase: slot.finalMessageId ? "finalizing" : "writing",
      streaming: true,
      uiKey: slot.uiKey,
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
  slots: readonly ManagedResponseSlot[],
  profiles?: UserProfileLookup,
  residentPersonaIdLookup?: ReadonlyMap<string, string | null>,
  responseSurface: ManagedResponseSurface = "timeline",
): ManagedTimelineProjection {
  const uniqueMessages = deduplicateMessagesById(messages);
  const renderableSlots = [
    ...slots.filter((slot) => slot.responseSurface === responseSurface),
  ].sort(
    (left, right) =>
      left.anchorAt - right.anchorAt ||
      left.slotOrdinal - right.slotOrdinal ||
      left.uiKey.localeCompare(right.uiKey),
  );
  const suppressedFinalMessageIds = new Set(
    renderableSlots.flatMap((slot) =>
      slot.finalMessageId ? [slot.finalMessageId] : [],
    ),
  );
  const finalById = new Map(
    uniqueMessages
      .filter((message) => suppressedFinalMessageIds.has(message.id))
      .map((message) => [message.id, message]),
  );
  const messageById = new Map(
    uniqueMessages.map((message) => [message.id, message]),
  );
  const projected = uniqueMessages.filter(
    (message) => !suppressedFinalMessageIds.has(message.id),
  );

  for (const slot of renderableSlots) {
    const message = projectSlot(
      slot,
      slot.finalMessageId ? finalById.get(slot.finalMessageId) : undefined,
      slot.anchorKey ? messageById.get(slot.anchorKey) : undefined,
      profiles,
      residentPersonaIdLookup,
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
