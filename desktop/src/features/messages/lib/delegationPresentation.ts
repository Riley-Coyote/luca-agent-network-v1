import type { ExchangeEntry } from "@/features/exchange/exchangeStore";
import type { MainTimelineEntry } from "./threadPanel";
import { parseSystemNotePayload } from "./systemNotes";
import { parseVisitEvent } from "./visitEvents";
import { KIND_SYSTEM_MESSAGE } from "@/shared/constants/kinds";

/** Presentation only: keep canonical transport/membership events available to task history. */
export function delegationPresentation(
  entries: readonly MainTimelineEntry[],
  exchanges: readonly ExchangeEntry[],
  context?: { ownerPubkey?: string; channelId?: string | null },
) {
  const hidden = new Set<string>();
  const anchors = new Map<string, string>();
  const owner = context?.ownerPubkey?.toLowerCase();
  if (!owner || !context?.channelId) return { hidden, anchors };
  const scoped = exchanges.filter(
    ({ record }) =>
      record.owner.toLowerCase() === owner &&
      record.conversationId === context.channelId,
  );
  const byId = new Map(scoped.map(({ record }) => [record.exchangeId, record]));
  const byRoot = new Map(
    scoped.map(({ record }) => [record.rootEventId, record]),
  );
  const visits: { resident: string; at: number; type: string }[] = [];
  for (const { message } of entries) {
    const visit = parseVisitEvent(message);
    if (
      message.kind === KIND_SYSTEM_MESSAGE &&
      visit?.exchangeId &&
      byId.has(visit.exchangeId)
    ) {
      hidden.add(message.id);
      visits.push({
        resident: visit.resident,
        at: message.createdAt,
        type: visit.type,
      });
    }
    const record = byRoot.get(message.id);
    // Never hide an owner's request or infer an anchor from its words alone.
    if (
      record &&
      record.openedBy !== owner &&
      message.signerPubkey?.toLowerCase() === record.openedBy.toLowerCase() &&
      message.body.startsWith("Task:")
    )
      anchors.set(message.id, record.exchangeId);
  }
  for (const { message } of entries) {
    if (message.kind !== KIND_SYSTEM_MESSAGE) continue;
    const note = parseSystemNotePayload(message.body);
    if (!note || note.actor?.toLowerCase() !== owner || !note.target) continue;
    const arrival = note.type === "member_joined";
    if (!arrival && note.type !== "member_removed") continue;
    if (
      visits.some(
        (visit) =>
          visit.resident === note.target?.toLowerCase() &&
          visit.type === (arrival ? "visit_arrived" : "visit_left") &&
          Math.abs(visit.at - message.createdAt) <= 15,
      )
    )
      hidden.add(message.id);
  }
  return { hidden, anchors };
}
