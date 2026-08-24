import * as React from "react";

import { nextActivityWaitChangeMs } from "@/features/channels/ui/conversationAgentActivityShelf";
import type {
  ManagedConversationActivity,
  ManagedResponseSlot,
} from "@/features/messages/managedPresentationTypes";
import { normalizePubkey } from "@/shared/lib/pubkey";

/**
 * The clock behind the awaiting row's disclosure ramp.
 *
 * The row's label grows as the wait does — what is being done at three
 * seconds, how long it has taken at ten, "still" at thirty — and something has
 * to advance time for it. That something cannot be a one-second interval in
 * the pane: this hook's value feeds the timeline's own memo, so every tick
 * re-renders the conversation.
 *
 * So it wakes only when the sentence could actually read differently.
 * `nextActivityWaitChangeMs` puts that at the tier boundaries while there is
 * no clock on screen and at the next whole second once there is: **zero** extra
 * renders for a wait under three seconds, which is most of them, one more
 * before ten, and only then a per-second cadence — by which point the owner is
 * watching an apparently hung screen and a moving number is the point.
 *
 * It also stops entirely when no resident is waiting, and `slots` is what makes
 * that true rather than merely intended. A turn's activity stays live through
 * the whole stream — its phase is "writing", not finished — so keying off the
 * activity alone kept the clock running once per second for the length of
 * every response, which is the one moment in the app where an extra render of
 * the conversation costs something. A resident with a response slot has a real
 * row and no awaiting row, so there is nothing here left to advance.
 */
export function usePendingReplyClock(
  managedActivity: ManagedConversationActivity | undefined,
  slots: readonly ManagedResponseSlot[] | undefined,
): number {
  const [now, setNow] = React.useState(() => Date.now());
  // The earliest live turn governs: it reaches every tier boundary first, and
  // a wake for it is a wake for the whole conversation's rows.
  let earliestStartedAt: number | null = null;
  const withText = new Set(
    (slots ?? []).map((slot) => normalizePubkey(slot.residentPubkey)),
  );
  for (const activity of managedActivity?.values() ?? []) {
    if (withText.has(normalizePubkey(activity.residentPubkey))) continue;
    if (
      activity.phase !== "waking" &&
      activity.phase !== "thinking" &&
      activity.phase !== "working" &&
      activity.phase !== "writing"
    ) {
      continue;
    }
    if (earliestStartedAt === null || activity.startedAt < earliestStartedAt) {
      earliestStartedAt = activity.startedAt;
    }
  }

  React.useEffect(() => {
    if (earliestStartedAt === null) return;
    const id = setTimeout(
      () => setNow(Date.now()),
      nextActivityWaitChangeMs(Math.max(0, now - earliestStartedAt)),
    );
    return () => clearTimeout(id);
    // `now` re-arms the chain; each wake schedules the one after it.
  }, [earliestStartedAt, now]);

  return now;
}
