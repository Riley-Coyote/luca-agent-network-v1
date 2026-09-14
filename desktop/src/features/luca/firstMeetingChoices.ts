import type { TimelineMessage } from "@/features/messages/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  FIRST_MEETING_MARKER,
  LUCA_GREETING_MARKER,
  hasClientMarker,
} from "./canonicalLucaResident";

const FENCE = /(?:^|\n)```polyphonic-choices\s*\n([\s\S]*?)\n```\s*$/;
const TRAILING = /(?:^|\n)```polyphonic-choices(?:\s*\n[\s\S]*)?$/;

export function parseFirstMeetingChoices(
  body: string,
): { prose: string; options: string[] } | null {
  const match = FENCE.exec(body);
  if (!match || new TextEncoder().encode(match[1]).length > 2048) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const object = parsed as Record<string, unknown>;
  if (
    Object.keys(object).length !== 1 ||
    !Array.isArray(object.options) ||
    object.options.length < 2 ||
    object.options.length > 4
  )
    return null;
  const options: string[] = [];
  for (const value of object.options) {
    if (typeof value !== "string") return null;
    const option = value.trim();
    if (
      !option ||
      [...option].length > 80 ||
      /[\p{Cc}\p{Cf}<>]/u.test(option) ||
      options.includes(option)
    )
      return null;
    options.push(option);
  }
  return { prose: body.slice(0, match.index).trimEnd(), options };
}

/** A streaming draft never exposes an incomplete final metadata block. */
export function visibleFirstMeetingProse(
  body: string,
  streaming: boolean,
): string {
  if (!streaming) return parseFirstMeetingChoices(body)?.prose ?? body;
  const trailing = TRAILING.exec(body);
  return trailing ? body.slice(0, trailing.index).trimEnd() : body;
}

export function latestFirstMeetingOffer(
  messages: readonly TimelineMessage[],
  ownerPubkey: string,
  lucaPubkey: string,
): { messageId: string; prose: string; options: string[] } | null {
  const owner = normalizePubkey(ownerPubkey);
  const luca = normalizePubkey(lucaPubkey);
  const start = messages.findIndex(
    (message) =>
      message.depth === 0 &&
      normalizePubkey(message.signerPubkey ?? "") === owner &&
      hasClientMarker(message, FIRST_MEETING_MARKER),
  );
  if (
    start < 0 ||
    messages.some((message) => hasClientMarker(message, LUCA_GREETING_MARKER))
  )
    return null;
  let replies = 0;
  let offer: { messageId: string; prose: string; options: string[] } | null =
    null;
  for (const message of messages.slice(start + 1)) {
    if (message.depth !== 0) continue;
    if (
      normalizePubkey(message.signerPubkey ?? message.pubkey ?? "") === owner
    ) {
      replies += 1;
      offer = null;
      if (replies > 5) return null;
    } else if (
      normalizePubkey(message.signerPubkey ?? "") === luca &&
      !message.pending &&
      !message.sendFailed &&
      !message.managedPresentation?.streaming
    ) {
      const parsed = parseFirstMeetingChoices(message.body);
      offer = parsed ? { messageId: message.id, ...parsed } : null;
    }
  }
  return offer;
}

export function firstMeetingPresentation(
  messages: readonly TimelineMessage[],
  ownerPubkey: string,
  lucaPubkey: string,
): { triggerId: string | null; responseIds: Set<string> } {
  const owner = normalizePubkey(ownerPubkey);
  const luca = normalizePubkey(lucaPubkey);
  const responseIds = new Set<string>();
  const start = messages.findIndex(
    (message) =>
      message.depth === 0 &&
      normalizePubkey(message.signerPubkey ?? "") === owner &&
      hasClientMarker(message, FIRST_MEETING_MARKER),
  );
  if (start < 0) return { triggerId: null, responseIds };
  let replies = 0;
  for (const message of messages.slice(start + 1)) {
    if (message.depth !== 0) continue;
    const author = normalizePubkey(
      message.signerPubkey ?? message.pubkey ?? "",
    );
    if (author === owner) {
      replies++;
      if (replies > 5) break;
    } else if (author === luca) {
      responseIds.add(message.id);
    }
  }
  return { triggerId: messages[start].id, responseIds };
}
