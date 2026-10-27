/**
 * The relay's system notes (kind 40099), and the one rule about them
 * (BETA14_RELEASE.md WP-37, Decided 1): a note the timeline has no words for
 * is not a message. It isn't counted, makes no day and draws nothing. The
 * count (the first-message view's "is anything here"), the day groups and the
 * rows all ask `isWordlessSystemNote`, so the rule is said once.
 *
 * The relay writes one such note into every direct conversation it makes,
 * `{"type":"dm_created","actor":…,"participants":[…]}`; the timeline has no
 * words for it.
 *
 * Kept pure (no React), so the lib-level `*.test.mjs` suite covers it.
 */

import { parseVisitEvent } from "@/features/messages/lib/visitEvents";
import { KIND_SYSTEM_MESSAGE } from "@/shared/constants/kinds";

export type SystemNotePayload = {
  type: string;
  actor?: string;
  target?: string;
  targets?: string[];
  topic?: string;
  purpose?: string;
  // Moderation tombstone fields (kind:40099 "message_deleted"). All optional and
  // moderator-authored — present when a moderator removed the message, absent for
  // a plain member self-delete. Reporter identity/evidence never appears here.
  public_reason?: string;
  reason_code?: string;
  action_id?: string;
  // Exchange note fields (kind:40099 "exchange-note"). Owner-authored: one
  // sentence the room is shown when an exchange did something the people in it
  // should know about. The sentence is written by the backend and rendered
  // as-is; `resident` and `exchange_id` are provenance, not copy.
  // `conversation_id` names the room the exchange was placed in (a pair DM),
  // when it was placed somewhere other than this one.
  exchange_id?: string | null;
  resident?: string;
  text?: string;
  conversation_id?: string | null;
};

/** A note's payload, or null when its body is not one. */
export function parseSystemNotePayload(
  body: string | null | undefined,
): SystemNotePayload | null {
  if (!body) return null;
  try {
    const payload = JSON.parse(body) as unknown;
    if (!payload || typeof payload !== "object") return null;
    return payload as SystemNotePayload;
  } catch {
    return null;
  }
}

/**
 * Whether the timeline has words for this payload: the system row's
 * `describeSystemEvent` writes a line for exactly these.
 */
export function systemNoteHasWords(payload: SystemNotePayload): boolean {
  switch (payload.type) {
    case "members_added":
      return Boolean(payload.actor && payload.targets?.length);
    case "members_joined":
      return Boolean(payload.targets?.length);
    case "member_joined":
      return Boolean(payload.actor && payload.target);
    case "member_left":
    case "member_removed":
    case "topic_changed":
    case "purpose_changed":
    case "channel_created":
    case "channel_archived":
    case "channel_unarchived":
    case "message_deleted":
      return true;
    case "exchange-note":
      return typeof payload.text === "string" && payload.text.trim() !== "";
    default:
      return false;
  }
}

type NoteLike = {
  kind?: number;
  body?: string | null;
  content?: string | null;
};

/**
 * A system note the timeline has no words for: not a message. Anything that
 * isn't a system note, and a visit note (the house's own line, whatever its
 * payload says to the system row), is never wordless.
 */
export function isWordlessSystemNote(message: NoteLike): boolean {
  if (message.kind !== KIND_SYSTEM_MESSAGE) return false;
  if (parseVisitEvent(message) !== null) return false;
  const payload = parseSystemNotePayload(message.body ?? message.content);
  return payload === null || !systemNoteHasWords(payload);
}
