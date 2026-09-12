import type { ActivityTrace, ActivityTraceLookup } from "./activityTraceTypes";
import type { TimelineMessage } from "../types";
import { managedDispatchReceiptIdFromTags } from "../managedPresentationProtocol";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import { formatTime } from "../lib/dateFormatters";

/** Resolve only an exact managed key; never substitute a resident's latest turn. */
export function activityReceiptFromUiKey(
  uiKey: string | undefined,
  pubkey: string,
): string | null {
  const prefix = `managed:${pubkey.toLowerCase()}:`;
  return uiKey?.startsWith(prefix) ? uiKey.slice(prefix.length) || null : null;
}

export function activityTraceLookupForMessage(
  conversationId: string | null,
  message: TimelineMessage,
): ActivityTraceLookup | null {
  if (!conversationId || !message.pubkey || !message.isAgent) return null;
  const dispatchReceiptId =
    message.activityTraceReceiptId ??
    activityReceiptFromUiKey(
      message.managedPresentation?.uiKey,
      message.pubkey,
    ) ??
    managedDispatchReceiptIdFromTags(message.tags ?? []);
  return {
    conversationId,
    residentPubkey: message.pubkey.toLowerCase(),
    dispatchReceiptId,
    finalMessageId: message.managedPresentation
      ? message.managedPresentation.finalMessageId
      : message.activityTraceReceiptId
        ? null
        : message.id,
  };
}

/** Restore local work rows that have no signed reply (for example, a stopped turn). */
export function projectActivityTraceMessages(
  conversationId: string,
  messages: readonly TimelineMessage[],
  traces: readonly ActivityTrace[],
  profiles?: UserProfileLookup,
  personaIds?: ReadonlyMap<string, string | null>,
  surface: "timeline" | "thread" = "timeline",
): TimelineMessage[] {
  const projected = [...messages];
  const represented = new Set(
    messages.flatMap((message) => {
      const lookup = activityTraceLookupForMessage(conversationId, message);
      return lookup?.dispatchReceiptId
        ? [`${lookup.residentPubkey}:${lookup.dispatchReceiptId}`]
        : [];
    }),
  );
  for (const trace of traces) {
    const resident = trace.residentPubkey.toLowerCase();
    const key = `${resident}:${trace.dispatchReceiptId}`;
    if (
      trace.conversationId !== conversationId ||
      (trace.responseSurface ?? "timeline") !== surface ||
      trace.finalMessageId ||
      represented.has(key)
    )
      continue;
    // A legacy observer-only pending row already represents this live resident.
    if (
      trace.status === "working" &&
      projected.some(
        (message) =>
          message.pubkey?.toLowerCase() === resident &&
          message.id.startsWith("pending-reply:"),
      )
    )
      continue;
    const anchor = projected.find(
      (message) => message.id === trace.anchorMessageId,
    );
    const createdAt = Math.floor(trace.startedAt / 1000);
    const row: TimelineMessage = {
      id: `activity:${key}`,
      renderKey: `managed:${key}`,
      activityTraceReceiptId: trace.dispatchReceiptId,
      createdAt,
      pubkey: resident,
      author: resolveUserLabel({ pubkey: resident, profiles }),
      isAgent: true,
      residentPersonaId: personaIds?.get(resident) ?? null,
      time: formatTime(createdAt),
      body: "",
      depth: surface === "thread" ? (anchor?.depth ?? 0) + 1 : 0,
      parentId:
        surface === "thread"
          ? (trace.anchorMessageId ?? trace.threadRootId)
          : null,
      rootId:
        surface === "thread"
          ? (trace.threadRootId ?? anchor?.rootId ?? anchor?.id)
          : null,
    };
    let index = projected.length;
    while (index > 0 && projected[index - 1].createdAt > createdAt) index -= 1;
    projected.splice(index, 0, row);
    represented.add(key);
  }
  return projected;
}

/** Remove only proven, exact public narration from a provisional reply body.
 * Signed history, redacted/truncated text and non-prefix matches remain intact.
 */
export function provisionalReplyAfterNarration(
  body: string,
  trace: ActivityTrace | null,
  provisional: boolean,
): string {
  if (!provisional || !trace || trace.truncated) return body;
  let remaining = body;
  for (const entry of trace.entries) {
    if (entry.kind !== "narration" || !entry.text) continue;
    if (!remaining.startsWith(entry.text)) break;
    remaining = remaining.slice(entry.text.length);
  }
  return remaining;
}
