/**
 * A visit is a parenthesis in the room's long conversation: from the house
 * note that says a resident stepped in, to the note that says they stepped
 * out. Every row between belongs to the visit. This module finds those spans
 * once, on the flattened item stream, so rows can paint as one plate.
 *
 * Pure (no React, no DOM) like the rest of `lib/`.
 */

import type { TimelineItem } from "@/features/messages/lib/timelineItems";
import { parseVisitEvent } from "@/features/messages/lib/visitEvents";

export type VisitSpanPosition = "start" | "middle" | "end";

type VisitAware = {
  /** Where this row sits in a visit plate; unset when no visit is open. */
  visitSpan?: VisitSpanPosition;
  /** Message rows: the author is a visitor at this point in the conversation. */
  authorVisiting?: boolean;
  /** Arrival rows: the visit has not ended yet (plate open, mark breathing). */
  visitOpen?: boolean;
};

function entryOf(item: TimelineItem) {
  if (item.kind === "message" || item.kind === "system") return item.entry;
  if (item.kind === "system-group")
    return item.entries[item.entries.length - 1];
  return null;
}

/**
 * Annotate items in place with their visit span position. Nested visits (a
 * second resident steps in before the first leaves) share one plate: the
 * plate starts with the first arrival and ends with the last departure.
 */
export function annotateVisitSpans(items: TimelineItem[]): void {
  const open = new Set<string>();
  const arrivalItems = new Map<string, TimelineItem & VisitAware>();

  for (const item of items as (TimelineItem & VisitAware)[]) {
    const entry = entryOf(item);
    const visit = entry ? parseVisitEvent(entry.message) : null;

    if (visit?.type === "visit_arrived") {
      item.visitSpan = open.size === 0 ? "start" : "middle";
      item.visitOpen = true;
      open.add(visit.resident);
      arrivalItems.set(visit.resident, item);
      continue;
    }

    if (visit?.type === "visit_left" && open.has(visit.resident)) {
      open.delete(visit.resident);
      const arrival = arrivalItems.get(visit.resident);
      if (arrival) arrival.visitOpen = false;
      item.visitSpan = open.size === 0 ? "end" : "middle";
      continue;
    }

    if (open.size > 0) item.visitSpan = "middle";
    if (item.kind === "message") {
      const pubkey = item.entry.message.pubkey?.toLowerCase();
      item.authorVisiting = Boolean(pubkey && open.has(pubkey));
    }
  }
}

/** Residents visiting right now: stepped in, not yet stepped out. */
export function openVisitors(
  messages: ReadonlyArray<{
    kind?: number;
    body?: string | null;
    content?: string | null;
  }>,
): ReadonlySet<string> {
  const open = new Set<string>();
  for (const message of messages) {
    const visit = parseVisitEvent(message);
    if (!visit) continue;
    if (visit.type === "visit_arrived") open.add(visit.resident);
    else open.delete(visit.resident);
  }
  return open;
}
