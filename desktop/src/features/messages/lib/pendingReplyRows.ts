import { activityLabel } from "@/features/agents/lib/activityPhase";
import type { ChannelAgentActivity } from "@/features/agents/activeAgentTurnsStore";
import {
  activityWaitTier,
  currentActivityStep,
} from "@/features/channels/ui/conversationAgentActivityShelf";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { TimelineMessage } from "@/features/messages/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { formatTime } from "./dateFormatters";
import {
  managedActivityStepDetail,
  managedActivityStepLabel,
  managedElapsedReadout,
} from "./managedOperationalStatus";
import type {
  ManagedConversationActivity,
  ManagedResidentActivity,
  ManagedResponseSlot,
} from "../managedPresentationTypes";

/**
 * "A reply is coming, here."
 *
 * A resident who is waking, thinking, working — or already "writing" but
 * whose first public chunk has not landed — has no response slot, so nothing
 * represents them in the timeline. This projects one row per such resident at
 * the tail of the conversation — the same row their reply will stream into —
 * with the phase on it, so the mark carries the state and one quiet word
 * beside the name says what. Tail placement is correct by construction:
 * replies are chronological. The "writing" case matters: the phase frame
 * arrives a beat before the first chunk, and without it the row blinked out
 * between "thinking" and the first words.
 */

const PENDING_PREFIX = "pending-reply:";

/**
 * WHAT THE ROW SAYS WHILE THE OWNER WAITS.
 *
 * In a direct conversation the shelf deliberately stands down and this row is
 * the whole indicator — that is the design in `ChannelPane`. But the row was
 * being handed `undefined` on the managed path, so everything the runtime
 * narrates arrived and was thrown away one line short of the screen: no step
 * lines, no detail, no elapsed, no "still". A DM is where the owner actually
 * talks to their agent, so in practice that was the entire rich-activity
 * system, unshipped.
 *
 * The disclosure ramp is the shelf's, unchanged, because the wait is the same
 * wait: silence under three seconds, then what is being done, then how long it
 * has taken, then an acknowledgement that it is taking a while. It is spoken
 * in the row's own voice — lowercase, one line, no punctuation the row does
 * not already use — because it sits beside a name, not on a status shelf.
 *
 * Under three seconds this returns undefined and the row keeps the plain phase
 * word it has always fallen back to. Latency that ordinary is not news.
 */
function managedWaitLabel(
  activity: ManagedResidentActivity,
  now: number,
): string | undefined {
  const tier = activityWaitTier(Math.max(0, now - activity.startedAt));
  if (tier === "indicator") return undefined;
  const step = currentActivityStep(activity.steps);
  // With no narration there is nothing to say that the phase word did not
  // already say — until the wait is long enough that the clock itself is news.
  if (!step && tier === "phase") return undefined;
  const spoken = step ? managedActivityStepLabel(step) : activity.phase;
  const said = `${spoken.charAt(0).toLowerCase()}${spoken.slice(1)}`;
  const detail = step ? managedActivityStepDetail(step) : null;
  const parts = [tier === "long" ? `still ${said}` : said];
  if (detail) parts.push(detail);
  if (tier === "long") {
    const elapsed = managedElapsedReadout(
      Math.max(0, now - activity.startedAt),
    );
    if (elapsed) parts.push(elapsed);
  }
  return parts.join(" · ");
}

export function pendingReplyRows({
  managedActivity,
  observerActivity,
  slots,
  profiles,
  residentPersonaIdLookup,
  now = Date.now(),
}: {
  managedActivity: ManagedConversationActivity | undefined;
  observerActivity: readonly ChannelAgentActivity[] | undefined;
  slots: readonly ManagedResponseSlot[] | undefined;
  profiles?: UserProfileLookup;
  residentPersonaIdLookup?: ReadonlyMap<string, string | null>;
  now?: number;
}): TimelineMessage[] {
  const withText = new Set(
    (slots ?? []).map((slot) => normalizePubkey(slot.residentPubkey)),
  );
  const rows = new Map<string, TimelineMessage>();

  const add = (
    pubkey: string,
    phase: "waking" | "thinking" | "working" | "writing",
    label: string | undefined,
    anchorAt: number,
  ) => {
    const key = normalizePubkey(pubkey);
    if (!key || withText.has(key) || rows.has(key)) return;
    // Timeline rows carry Nostr `created_at` (seconds); activity anchors are
    // wall-clock ms. Convert here or the day divider lands in year 58598.
    const createdAt = Math.floor(anchorAt / 1000);
    rows.set(key, {
      id: `${PENDING_PREFIX}${key}`,
      renderKey: `${PENDING_PREFIX}${key}`,
      createdAt,
      pubkey: key,
      signerPubkey: key,
      author: resolveUserLabel({ pubkey: key, profiles }),
      isAgent: true,
      residentPersonaId: residentPersonaIdLookup?.get(key) ?? null,
      time: formatTime(createdAt),
      body: "",
      parentId: null,
      rootId: null,
      depth: 0,
      pending: false,
      managedPresentation: {
        canonicalPresent: false,
        failure: null,
        finalReconciliation: null,
        finalMessageId: null,
        phase,
        streaming: true,
        uiKey: `${PENDING_PREFIX}${key}`,
        activityLabel: label,
      },
    } as TimelineMessage);
  };

  for (const [pubkey, activity] of managedActivity ?? []) {
    if (
      activity.phase === "waking" ||
      activity.phase === "thinking" ||
      activity.phase === "working" ||
      activity.phase === "writing"
    ) {
      // `startedAt`, not `now`: the turn's own anchor is when the owner began
      // waiting. `now` re-read on every recomputation, so the row's timestamp
      // crept forward while the resident was still thinking and no elapsed
      // reading taken from it could be true.
      add(
        pubkey,
        activity.phase,
        managedWaitLabel(activity, now),
        // A zero anchor is not a time the owner started waiting; it would put
        // this row under a 1970 day divider at the tail of the conversation.
        activity.startedAt || now,
      );
    }
  }
  for (const row of observerActivity ?? []) {
    const phase = row.activity?.phase;
    if (phase === "thinking" || phase === "working") {
      add(row.agentPubkey, phase, activityLabel(row.activity), row.anchorAt);
    }
  }
  return [...rows.values()];
}

export function isPendingReplyRow(message: TimelineMessage) {
  return message.id.startsWith(PENDING_PREFIX);
}
