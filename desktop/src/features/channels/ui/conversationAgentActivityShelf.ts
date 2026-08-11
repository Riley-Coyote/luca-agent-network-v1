export type ConversationActivityState =
  | "thinking"
  | "working"
  | "writing"
  | "finalizing"
  | "stopping"
  | "stopped"
  | "needs-attention";

export type ActivityShelfSlotState = {
  /** Stable visible positions. A null entry is intentionally left empty. */
  slots: Array<string | null>;
  /** Activation order for the complete activity disclosure. */
  order: string[];
  /** Highest visible population in this batch; never shrinks mid-batch. */
  capacity: number;
};

export const EMPTY_ACTIVITY_SHELF_SLOTS: ActivityShelfSlotState = {
  slots: [null, null, null],
  order: [],
  capacity: 0,
};

export function isTerminalConversationActivity(
  state: ConversationActivityState,
): boolean {
  return state === "stopped" || state === "needs-attention";
}

export function conversationActivityLabel(
  state: ConversationActivityState,
): string {
  switch (state) {
    case "thinking":
      return "Thinking";
    case "working":
      return "Working";
    case "writing":
      return "Writing";
    case "finalizing":
      return "Finalizing";
    case "stopping":
      return "Stopping";
    case "stopped":
      return "Stopped";
    case "needs-attention":
      return "Needs attention";
  }
}

/**
 * Reconciles active residents into three stable shelf positions.
 *
 * Residents already on screen keep their exact slot. When one leaves, the
 * oldest hidden resident takes only that vacated position; siblings never
 * slide sideways. `capacity` remembers the largest visible population until
 * the batch fully ends so completion cannot resize the remaining slots.
 */
export function reconcileActivityShelfSlots(
  previous: ActivityShelfSlotState,
  activeKeys: readonly string[],
): ActivityShelfSlotState {
  const uniqueActive = [...new Set(activeKeys)];
  if (uniqueActive.length === 0) {
    return EMPTY_ACTIVITY_SHELF_SLOTS;
  }

  const active = new Set(uniqueActive);
  const slots = Array.from({ length: 3 }, (_, index) => {
    const prior = previous.slots[index] ?? null;
    return prior && active.has(prior) ? prior : null;
  });
  const retained = new Set(slots.filter((key): key is string => key !== null));
  const order = [
    ...previous.order.filter((key) => active.has(key)),
    ...uniqueActive.filter((key) => !previous.order.includes(key)),
  ];

  for (const key of order) {
    if (retained.has(key)) continue;
    const emptyIndex = slots.indexOf(null);
    if (emptyIndex === -1) break;
    slots[emptyIndex] = key;
    retained.add(key);
  }

  return {
    slots,
    order,
    capacity: Math.max(previous.capacity, Math.min(3, uniqueActive.length)),
  };
}

export function activityShelfOverflow(state: ActivityShelfSlotState): string[] {
  const visible = new Set(
    state.slots.filter((key): key is string => key !== null),
  );
  return state.order.filter((key) => !visible.has(key));
}
