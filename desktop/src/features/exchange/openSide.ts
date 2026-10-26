import * as React from "react";

import type { SideConversation } from "@/features/exchange/sideConversations";

/**
 * Which side conversation is open, for the Chats rail's mark (SHELL_BUILD.md
 * WP-18, Decided 1; SPEC.md, "Selection"). An exchange says so in the
 * address (its room, at its first message, in its thread); a runtime task has
 * no address of its own, only its room, so opening one is noted here. The
 * note holds while its room stays open and clears once another opens.
 */

type OpenTask = {
  /** The rail's row id: `task:<taskId>`. */
  id: string;
  conversationId: string;
  /** When it was noted, before its room has opened. */
  at: number;
  /** Its room has opened since. */
  reached: boolean;
};

/** How long a note waits for its room to open before it is dropped. */
const REACH_MS = 5000;

let open: OpenTask | null = null;
const listeners = new Set<() => void>();

function set(next: OpenTask | null) {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Note that a side conversation is being opened (a task's note; an
 *  exchange needs none, its address says it, and clears any task's). */
export function noteOpenSide(
  item: Pick<SideConversation, "id" | "kind" | "conversationId">,
) {
  set(
    item.kind === "task"
      ? {
          at: performance.now(),
          conversationId: item.conversationId,
          id: `task:${item.id}`,
          reached: false,
        }
      : null,
  );
}

/** Forget the open task: another row of the rail was opened. */
export function clearOpenSide() {
  set(null);
}

/** For a community switch (resetCommunityState). */
export function resetOpenSide() {
  set(null);
}

function snapshot() {
  return open;
}

/**
 * The rail's id of the side conversation open in `selectedChannelId`, or
 * null: an exchange whose room is open at its first message (`thread`, or
 * the `messageId` it arrives with), else the task last opened while its
 * room stays open.
 */
export function useOpenSideId(
  selectedChannelId: string | null,
  threadTarget: string | null,
  exchanges: readonly {
    id: string;
    conversationId: string;
    messageId: string | null;
  }[],
): string | null {
  const task = React.useSyncExternalStore(subscribe, snapshot, snapshot);
  // The room opened (the note is reached), or another did (it clears).
  React.useEffect(() => {
    if (!task) return;
    if (selectedChannelId === task.conversationId) {
      if (!task.reached) set({ ...task, reached: true });
      return;
    }
    if (task.reached || performance.now() - task.at > REACH_MS) set(null);
  }, [selectedChannelId, task]);
  if (!selectedChannelId) return null;
  const target = threadTarget?.toLowerCase() ?? null;
  if (target) {
    const exchange = exchanges.find(
      (row) =>
        row.conversationId === selectedChannelId &&
        row.messageId?.toLowerCase() === target,
    );
    if (exchange) return exchange.id;
  }
  return task && task.conversationId === selectedChannelId ? task.id : null;
}
