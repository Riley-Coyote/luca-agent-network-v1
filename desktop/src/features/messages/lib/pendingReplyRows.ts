import { activityLabel } from "@/features/agents/lib/activityPhase";
import type { ChannelAgentActivity } from "@/features/agents/activeAgentTurnsStore";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { TimelineMessage } from "@/features/messages/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { formatTime } from "./dateFormatters";
import type {
  ManagedConversationActivity,
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
      add(pubkey, activity.phase, undefined, now);
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
