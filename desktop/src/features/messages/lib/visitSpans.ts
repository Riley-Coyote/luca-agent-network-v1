/**
 * A visit is a stretch of the room's conversation with a door at each end.
 * This module finds those stretches once, on the flattened item stream, and
 * tells each row what it is inside one:
 *
 *   visitThreshold  the row IS a door — the arrival or departure note
 *   visitSpan       the row is inside the passage between the doors, and
 *                   where it sits on the line that connects the speakers
 *   authorVisiting  this message's author is a guest at this point
 *   visitOpen       an arrival whose visit has not ended yet
 *   activeVisitGuests  guests on the one passage still open at the tail
 *
 * The line connects the marks of people who SPOKE during the visit, so only
 * message rows carry a position on it; anything else inside the passage is
 * `quiet` — inset with the rest, but off the line.
 *
 * Pure (no React, no DOM) like the rest of `lib/`.
 */

import type { TimelineItem } from "@/features/messages/lib/timelineItems";
import { parseVisitEvent } from "@/features/messages/lib/visitEvents";

/** Where a row sits on the line that connects the visit's speakers. */
export type VisitSpanPosition = "first" | "middle" | "last" | "only" | "quiet";

/** A row that is itself a door. */
export type VisitThreshold = "enter" | "leave";

type VisitAware = {
  activeVisitGuests?: readonly string[];
  visitSpan?: VisitSpanPosition;
  visitThreshold?: VisitThreshold;
  authorVisiting?: boolean;
  visitOpen?: boolean;
};

type AwareItem = TimelineItem & VisitAware;

function entryOf(item: TimelineItem) {
  if (item.kind === "message" || item.kind === "system") return item.entry;
  if (item.kind === "system-group")
    return item.entries[item.entries.length - 1];
  return null;
}

/** Give the speakers of one passage their place on the line. */
function closePassage(speakers: AwareItem[], quiet: AwareItem[]) {
  for (const item of quiet) item.visitSpan = "quiet";
  if (speakers.length === 1) {
    speakers[0].visitSpan = "only";
    return;
  }
  speakers.forEach((item, index) => {
    item.visitSpan =
      index === 0 ? "first" : index === speakers.length - 1 ? "last" : "middle";
  });
}

/**
 * Annotate items in place. Nested visits (a second guest steps in before the
 * first leaves) share one passage: it opens at the first arrival and closes at
 * the last departure. A visit still under way simply has no departure yet, so
 * its passage runs to the newest row.
 */
export function annotateVisitSpans(items: TimelineItem[]): void {
  const open = new Set<string>();
  const arrivals = new Map<string, AwareItem>();
  let speakers: AwareItem[] = [];
  let quiet: AwareItem[] = [];

  for (const item of items as AwareItem[]) {
    const entry = entryOf(item);
    const visit = entry ? parseVisitEvent(entry.message) : null;

    if (visit?.type === "visit_arrived") {
      item.visitThreshold = "enter";
      item.visitOpen = true;
      open.add(visit.resident);
      arrivals.set(visit.resident, item);
      continue;
    }

    if (visit?.type === "visit_left" && open.has(visit.resident)) {
      open.delete(visit.resident);
      const arrival = arrivals.get(visit.resident);
      if (arrival) arrival.visitOpen = false;
      item.visitThreshold = "leave";
      if (open.size === 0) {
        closePassage(speakers, quiet);
        speakers = [];
        quiet = [];
      }
      continue;
    }

    if (open.size === 0) continue;

    if (item.kind === "message") {
      const pubkey = item.entry.message.pubkey?.toLowerCase();
      item.authorVisiting = Boolean(pubkey && open.has(pubkey));
      speakers.push(item);
    } else {
      quiet.push(item);
    }
  }

  // A visit that is still open when the timeline ends.
  closePassage(speakers, quiet);
  if (open.size > 0) {
    const activeVisitGuests = [...open];
    for (const item of [...speakers, ...quiet]) {
      item.activeVisitGuests = activeVisitGuests;
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
