/**
 * Needs you: everything waiting on you, in one list (NAVIGATION.md,
 * "Activity"; SHELL_BUILD.md WP-14, Decided 3 and 4). Five real lists feed
 * it: permission requests and questions (app-wide already), Luca's proposals
 * to run Codex or Claude Code, a resident's ask to start a project (WP-44),
 * and exchanges paused for your word. Pure, so
 * the order and the count are unit-tested under node.
 */

export type NeedsYouKind =
  | "permission"
  | "question"
  | "proposal"
  | "project"
  | "exchange";

export type NeedsYouEntry<T = unknown> = {
  kind: NeedsYouKind;
  /** Unique across kinds. */
  key: string;
  conversationId: string;
  /** Who is asking (lowercase). */
  askedBy: string;
  /** When it began waiting (ms), or null when its record carries no time:
   *  permission requests and questions hold a turn open right now. */
  at: number | null;
  value: T;
};

/** Newest first. A request with no time is waiting this moment, so it
 *  comes first, in the order its list gives. */
export function orderNeedsYou<E extends Pick<NeedsYouEntry, "at">>(
  entries: readonly E[],
): E[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const at = a.entry.at ?? Number.POSITIVE_INFINITY;
      const bt = b.entry.at ?? Number.POSITIVE_INFINITY;
      if (at !== bt) return bt - at;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/** The count on the Activity icon and at the row's end (Decided 4): every
 *  item in Needs you; nothing at zero. */
export function needsYouCount(lists: {
  permissions: number;
  questions: number;
  proposals: number;
  /** Residents' asks to start a project (WP-44). */
  projects?: number;
  pausedExchanges: number;
}): number {
  return (
    lists.permissions +
    lists.questions +
    lists.proposals +
    (lists.projects ?? 0) +
    lists.pausedExchanges
  );
}

/** The row's count as the rail says it: empty at zero, 99+ past 99. */
export function needsYouNote(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 99 ? "99+" : String(count);
}
