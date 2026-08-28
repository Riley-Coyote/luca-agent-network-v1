import type { ManagedTurnActivityStep } from "@/features/messages/managedPresentationTypes";

export type ConversationActivityState =
  | "waking"
  | "thinking"
  | "working"
  | "writing"
  | "finalizing"
  /** The answer landed; only the record of the work it took remains. */
  | "settled"
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
    case "settled":
      return "Done";
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
 * The compatibility working signal says only that a resident is active. It
 * cannot truthfully claim an internal thought phase. Exact presentation or
 * observer frames replace this neutral fallback as soon as they arrive.
 */
export function fallbackConversationActivityState(
  sessionReady: boolean,
): ConversationActivityState {
  return sessionReady ? "working" : "needs-attention";
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
    if (item.state === "settled") {
      // The line no longer leaves when the answer arrives, so the departure
      // that used to carry this announcement never happens.
      announcements.push(`${item.name} replied`);
    } else if (item.state === "stopped") {
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

/* -------------------------------------------------------------------------
 * How much the shelf says, and when.
 *
 * A wait is not one thing. Under a few seconds it is simply how long a thought
 * takes and narrating it is noise; past ten it is a silence the owner starts
 * to read as a hang; past thirty it is something the app should acknowledge
 * rather than keep presenting as ordinary.
 * ---------------------------------------------------------------------- */

/** The first word arrives almost immediately — the seconds right after a
 * send are when "did it hear me?" is loudest, so the phase word answers
 * at once instead of narrating only abnormal latency. (Was 3s; the feel
 * audit found that window near-silent.) */
export const ACTIVITY_PHASE_WORD_AFTER_MS = 300;
/** Silence starts to read as a hang, and a number is reassurance. */
export const ACTIVITY_ELAPSED_AFTER_MS = 10_000;
/** Long enough that saying "still" is honest rather than fussy. */
export const ACTIVITY_LONG_WAIT_AFTER_MS = 30_000;

export type ActivityWaitTier = "indicator" | "phase" | "elapsed" | "long";

export function activityWaitTier(elapsedMs: number): ActivityWaitTier {
  if (elapsedMs >= ACTIVITY_LONG_WAIT_AFTER_MS) return "long";
  if (elapsedMs >= ACTIVITY_ELAPSED_AFTER_MS) return "elapsed";
  if (elapsedMs >= ACTIVITY_PHASE_WORD_AFTER_MS) return "phase";
  return "indicator";
}

/**
 * How long until the line could say something different.
 *
 * Before the clock appears, the only thing that can change is which tier the
 * wait has reached — so the line sleeps to that boundary instead of waking
 * every second to repaint the same words. That is ten wasted renders per turn
 * in the ten seconds a resident is most likely to be streaming into the row
 * directly above it.
 *
 * Once the clock is on screen it genuinely changes every second, and the wait
 * is aligned to the next whole one so the digits turn on the second rather
 * than on whichever millisecond the turn happened to start.
 */
export function nextActivityWaitChangeMs(elapsedMs: number): number {
  if (elapsedMs < ACTIVITY_PHASE_WORD_AFTER_MS) {
    return ACTIVITY_PHASE_WORD_AFTER_MS - elapsedMs;
  }
  if (elapsedMs < ACTIVITY_ELAPSED_AFTER_MS) {
    return ACTIVITY_ELAPSED_AFTER_MS - elapsedMs;
  }
  return 1_000 - (elapsedMs % 1_000);
}

/**
 * Acknowledge the wait without inventing a new sentence for it. "Still" in
 * front of whatever the resident already said is true for a phase word and
 * for a rich label alike — "Still thinking", "Still reading MessageRow.tsx".
 */
export function activityLongWaitLabel(label: string): string {
  if (label.length === 0) return label;
  if (label.startsWith("Still ")) return label;
  return `Still ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/**
 * The one line a collapsed shelf shows for a narrated run: whatever is running
 * now, or — once everything has settled — the last thing that ran.
 */
export function currentActivityStep(
  steps: readonly ManagedTurnActivityStep[],
): ManagedTurnActivityStep | null {
  if (steps.length === 0) return null;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step?.status === "active") return step;
  }
  return steps[steps.length - 1] ?? null;
}
