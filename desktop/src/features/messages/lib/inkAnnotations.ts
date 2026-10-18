import { type InkHeard, inkHeardOf } from "@/shared/lib/inkHeard";
import { normalizePubkey } from "@/shared/lib/pubkey";

/** What living ink needs to know of a message, in reading order. */
export type InkMessage = {
  id: string;
  pubkey?: string | null;
  body: string;
  createdAt: number;
};

export type InkAnnotations = {
  /** Messages before the owner's latest one: their wet ink has dried. */
  answered: ReadonlySet<string>;
  /** Each owner message's words that the replies answering it echo. */
  heard: ReadonlyMap<string, InkHeard[]>;
};

/** An echo warms in once, for a moment after it first appears. */
const INK_HEARD_FRESH_MS = 1500;
/** Only a reply this recent can still be landing. */
const INK_HEARD_RECENT_SECONDS = 300;
const inkHeardFirstSeen = new Map<string, number>();

function inkHeardFresh(key: string, replyCreatedAt: number): boolean {
  const now = Date.now();
  if (now / 1000 - replyCreatedAt > INK_HEARD_RECENT_SECONDS) return false;
  const first = inkHeardFirstSeen.get(key) ?? now;
  if (!inkHeardFirstSeen.has(key)) {
    inkHeardFirstSeen.set(key, now);
    if (inkHeardFirstSeen.size > 500) {
      const oldest = inkHeardFirstSeen.keys().next().value;
      if (oldest !== undefined) inkHeardFirstSeen.delete(oldest);
    }
  }
  return now - first < INK_HEARD_FRESH_MS;
}

/**
 * Living ink across a conversation, from its messages in reading order: wet
 * ink dries once the owner answers, so every message before the owner's
 * latest one is answered; and a reply's echo lights words in the owner
 * message it answers, the nearest one before it. The main timeline and a
 * thread panel read their own messages the same way.
 */
export function inkAnnotations(
  messages: readonly InkMessage[],
  ownerPubkey?: string,
): InkAnnotations {
  const answered = new Set<string>();
  const heard = new Map<string, InkHeard[]>();
  if (!ownerPubkey) return { answered, heard };
  const owner = normalizePubkey(ownerPubkey);
  const isOwner = (message: InkMessage) =>
    Boolean(message.pubkey) && normalizePubkey(message.pubkey ?? "") === owner;
  let latest = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isOwner(messages[index])) {
      latest = index;
      break;
    }
  }
  for (let index = 0; index < latest; index += 1)
    answered.add(messages[index].id);
  let answering: InkMessage | null = null;
  for (const message of messages) {
    if (isOwner(message)) {
      answering = message;
      continue;
    }
    if (!answering) continue;
    const echo = inkHeardOf(message.body);
    if (!echo) continue;
    const key = `${answering.id}:${message.id}:${echo.phrase}`;
    heard.set(answering.id, [
      ...(heard.get(answering.id) ?? []),
      { ...echo, fresh: inkHeardFresh(key, message.createdAt) },
    ]);
  }
  return { answered, heard };
}
