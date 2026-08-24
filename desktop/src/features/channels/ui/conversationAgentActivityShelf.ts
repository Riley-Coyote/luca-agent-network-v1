export type ConversationActivityState =
  | "waking"
  | "thinking"
  | "working"
  | "writing"
  | "finalizing"
  | "stopping"
  | "stopped"
  | "interrupted"
  | "needs-attention";

export type ActivityShelfRetryTarget = {
  residentPubkey: string;
  uiKey: string;
};

export type ActivityShelfPresentationPhase =
  | ConversationActivityState
  | "failed"
  | "needs_attention";

export type ActivityStopSettlement = "stopped" | "ambiguous" | "failed";

export type ActivityStopOutcome = {
  result: ActivityStopSettlement;
  state: ConversationActivityState;
};

export type ActivityAnnouncementItem = {
  name: string;
  state: ConversationActivityState;
};

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
  return (
    state === "stopped" ||
    state === "interrupted" ||
    state === "needs-attention"
  );
}

export function conversationActivityLabel(
  state: ConversationActivityState,
): string {
  switch (state) {
    case "waking":
      return "Waking";
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
    case "interrupted":
      return "Interrupted after restart";
    case "needs-attention":
      return "Needs attention";
  }
}

/**
 * Resolve one resident's exact retry identity. Terminal state by itself is not
 * enough: observer and typing fallbacks have no process presentation to retry.
 */
export function activityShelfRetryTarget(
  presentationPhase: ActivityShelfPresentationPhase | null | undefined,
  residentPubkey: string,
  uiKey: string | null | undefined,
  hasTerminalFailure = false,
): ActivityShelfRetryTarget | null {
  const wireTerminal =
    presentationPhase === "failed" ||
    (presentationPhase === "needs_attention" && hasTerminalFailure);
  const conversationTerminal =
    presentationPhase !== "failed" &&
    presentationPhase !== "needs_attention" &&
    presentationPhase !== null &&
    presentationPhase !== undefined &&
    isTerminalConversationActivity(presentationPhase);
  const terminal = wireTerminal || conversationTerminal;
  if (!terminal || !uiKey) return null;
  return { residentPubkey, uiKey };
}

/**
 * Convert exact desktop cancellation settlements into one truthful shelf
 * outcome. An empty result means there was no cancellable managed dispatch; it
 * must never be presented as a successful stop.
 */
export function activityStopOutcome(
  settlements: readonly ActivityStopSettlement[],
): ActivityStopOutcome {
  if (settlements.length === 0 || settlements.includes("failed")) {
    return { result: "failed", state: "needs-attention" };
  }
  if (settlements.includes("ambiguous")) {
    return { result: "ambiguous", state: "needs-attention" };
  }
  return { result: "stopped", state: "stopped" };
}

/** Return only meaningful lifecycle deltas for the shelf's polite live region. */
export function activityAnnouncementDelta(
  previous: ReadonlyMap<string, ActivityAnnouncementItem>,
  current: ReadonlyMap<string, ActivityAnnouncementItem>,
): string {
  const announcements: string[] = [];
  for (const [key, item] of current) {
    const prior = previous.get(key);
    if (prior?.state === item.state) continue;
    if (item.state === "stopped") {
      announcements.push(`${item.name} stopped`);
    } else if (item.state === "interrupted") {
      announcements.push(`${item.name} was interrupted after restart`);
    } else if (item.state === "needs-attention") {
      announcements.push(`${item.name} failed`);
    } else if (item.state === "writing") {
      announcements.push(`${item.name} began writing`);
    } else if (!prior) {
      announcements.push(`${item.name} started`);
    }
  }
  for (const [key, item] of previous) {
    if (
      current.has(key) ||
      item.state === "stopped" ||
      item.state === "needs-attention"
    ) {
      continue;
    }
    announcements.push(`${item.name} replied`);
  }
  return announcements.join(". ");
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
