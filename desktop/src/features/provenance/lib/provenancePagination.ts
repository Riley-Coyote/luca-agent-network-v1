import type { RelayEvent } from "@/shared/api/types";

/** Rows shown in the normal Activity page fetch. */
export const PROVENANCE_PAGE_SIZE = 60;

/**
 * The relay clamps one historical REQ to this many rows. Keep this in step
 * with `MAX_HISTORICAL_LIMIT` in `crates/buzz-relay/src/handlers/req.rs`.
 */
export const PROVENANCE_RELAY_LIMIT = 2_000;

/**
 * A timestamp-only Nostr cursor cannot move through a second with more rows
 * than the relay will return. Fail closed instead of claiming that older rows
 * were reached when part of the boundary is unknowable.
 */
export class ProvenanceTimestampBoundaryLimitError extends Error {
  constructor(createdAt: number) {
    super(
      `Activity history has at least ${PROVENANCE_RELAY_LIMIT} records at ${createdAt}; this relay read cannot safely continue past that second.`,
    );
    this.name = "ProvenanceTimestampBoundaryLimitError";
  }
}

export type ProvenanceCursor =
  | { kind: "boundary"; createdAt: number; seenEventIds: string[] }
  | { kind: "before"; until: number };

/** Newest first, with a deterministic event-id tiebreak. */
function sortEvents(events: RelayEvent[]): RelayEvent[] {
  return [...events].sort(
    (left, right) =>
      right.created_at - left.created_at || right.id.localeCompare(left.id),
  );
}

/**
 * The full first-page response fixes the boundary timestamp. A short response
 * is already exhaustive, so it needs no additional relay read.
 */
export function boundaryCursor(events: RelayEvent[]): ProvenanceCursor | null {
  if (events.length < PROVENANCE_PAGE_SIZE) return null;
  const createdAt = events.reduce(
    (oldest, event) => Math.min(oldest, event.created_at),
    Number.POSITIVE_INFINITY,
  );
  return {
    kind: "boundary",
    createdAt,
    seenEventIds: events
      .filter((event) => event.created_at === createdAt)
      .map((event) => event.id),
  };
}

/**
 * Combine the regular page with a complete same-second read. Events at the
 * boundary appear in both reads; collapse by id before the next cursor moves
 * strictly before the second.
 */
export function unseenBoundaryEvents(
  boundaryEvents: RelayEvent[],
  cursor: Extract<ProvenanceCursor, { kind: "boundary" }>,
): RelayEvent[] {
  if (boundaryEvents.length >= PROVENANCE_RELAY_LIMIT) {
    throw new ProvenanceTimestampBoundaryLimitError(cursor.createdAt);
  }

  const seenEventIds = new Set(cursor.seenEventIds);
  return sortEvents(
    boundaryEvents.filter(
      (event) =>
        event.created_at === cursor.createdAt && !seenEventIds.has(event.id),
    ),
  );
}

export function nextCursorAfterPage(
  pageEvents: RelayEvent[],
): ProvenanceCursor | null {
  if (pageEvents.length === 0) return null;
  return boundaryCursor(pageEvents);
}

export function cursorBefore(createdAt: number): ProvenanceCursor {
  return { kind: "before", until: createdAt - 1 };
}
