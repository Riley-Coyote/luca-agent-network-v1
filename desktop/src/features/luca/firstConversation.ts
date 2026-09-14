import type { TimelineMessage } from "@/features/messages/types";
import { KIND_SYSTEM_MESSAGE } from "@/shared/constants/kinds";
import {
  FIRST_MEETING_MARKER,
  hasClientMarker,
  isFirstMeetingTimelineRow,
} from "./canonicalLucaResident";
import { normalizePubkey } from "@/shared/lib/pubkey";

function isDmCreationNotice(message: TimelineMessage): boolean {
  if (
    message.kind !== KIND_SYSTEM_MESSAGE ||
    message.pending ||
    message.sendFailed
  )
    return false;
  try {
    return JSON.parse(message.body).type === "dm_created";
  } catch {
    return false;
  }
}

/** Only a fully loaded, untouched first reply may use the composer-first view.
 * Pending and failed sends count as conversation so recovery stays visible. */
export function isUntouchedLucaGreeting(
  messages: readonly TimelineMessage[],
  lucaPubkey: string | null,
  ownerPubkey: string | undefined,
  historyExhausted: boolean,
  isLoading: boolean,
): boolean {
  if (!lucaPubkey || !ownerPubkey || !historyExhausted || isLoading)
    return false;
  const trigger = messages.some(
    (message) =>
      isFirstMeetingTimelineRow(message) &&
      normalizePubkey(message.signerPubkey ?? "") ===
        normalizePubkey(ownerPubkey) &&
      hasClientMarker(message, FIRST_MEETING_MARKER),
  );
  return (
    trigger &&
    messages.some(
      (message) =>
        isFirstMeetingTimelineRow(message) &&
        !message.pending &&
        !message.sendFailed &&
        !message.managedPresentation?.streaming &&
        normalizePubkey(message.signerPubkey ?? "") ===
          normalizePubkey(lucaPubkey),
    ) &&
    messages.every(
      (message) =>
        hasClientMarker(message, FIRST_MEETING_MARKER) ||
        (isFirstMeetingTimelineRow(message) &&
          normalizePubkey(message.signerPubkey ?? message.pubkey ?? "") ===
            normalizePubkey(lucaPubkey)) ||
        isDmCreationNotice(message),
    )
  );
}
