import type { TimelineMessage } from "@/features/messages/types";
import { KIND_SYSTEM_MESSAGE } from "@/shared/constants/kinds";
import { isLucaGreeting } from "./canonicalLucaResident";

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

/** Only a fully loaded, untouched greeting may use the composer-first view.
 * Pending and failed sends count as conversation so recovery stays visible. */
export function isUntouchedLucaGreeting(
  messages: readonly TimelineMessage[],
  lucaPubkey: string | null,
  historyExhausted: boolean,
  isLoading: boolean,
): boolean {
  if (!lucaPubkey || !historyExhausted || isLoading) return false;
  return (
    messages.some((message) => isLucaGreeting(message, lucaPubkey)) &&
    messages.every(
      (message) =>
        isLucaGreeting(message, lucaPubkey) || isDmCreationNotice(message),
    )
  );
}
