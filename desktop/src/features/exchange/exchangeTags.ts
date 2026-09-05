import {
  EXCHANGE_BUCKET_CEILING,
  EXCHANGE_TAG,
} from "@/shared/constants/kinds";
import type { ExchangeRecord } from "@/shared/api/types";

/** Body-free signed routing used by timeline and unread projections. */
export type ExchangeMessageRouting = {
  signerPubkey?: string;
  tags?: readonly (readonly string[])[];
};

/** Recognize the host's bounded owner return against this owner's exchange head. */
export function isExchangeOwnerReturn(
  message: ExchangeMessageRouting,
  record: ExchangeRecord | null | undefined,
  ownerPubkey: string | null | undefined,
  channelId: string | null | undefined,
): boolean {
  if (!record || !ownerPubkey || !channelId) return false;
  const owner = ownerPubkey.toLowerCase();
  const signer = message.signerPubkey?.toLowerCase();
  const validKey = (value: string) => /^[0-9a-f]{64}$/i.test(value);
  const members = record.members.map((member) => member.toLowerCase());
  if (
    !validKey(owner) ||
    !signer ||
    !validKey(signer) ||
    record.owner.toLowerCase() !== owner ||
    record.conversationId !== channelId ||
    record.depth !== 1 ||
    record.parentExchangeId !== null ||
    !Number.isInteger(record.bucket) ||
    record.bucket < 1 ||
    record.bucket > EXCHANGE_BUCKET_CEILING ||
    members.length !== 2 ||
    new Set(members).size !== 2 ||
    !members.every(validKey) ||
    members.includes(owner) ||
    !members.includes(signer) ||
    record.openedBy.toLowerCase() !== signer
  )
    return false;
  const tags = message.tags ?? [];
  const exchanges = tags.filter((tag) => tag[0] === EXCHANGE_TAG);
  const recipients = tags.filter((tag) => tag[0] === "p");
  const rooms = tags.filter((tag) => tag[0] === "h");
  return (
    exchanges.length === 1 &&
    exchanges[0].length === 3 &&
    validKey(exchanges[0][1]) &&
    exchanges[0][1].toLowerCase() === record.exchangeId.toLowerCase() &&
    /^[1-9]\d*$/.test(exchanges[0][2]) &&
    Number.isSafeInteger(Number(exchanges[0][2])) &&
    Number(exchanges[0][2]) <= record.bucket &&
    recipients.length === 1 &&
    recipients[0].length === 2 &&
    validKey(recipients[0][1]) &&
    recipients[0][1].toLowerCase() === owner &&
    rooms.length === 1 &&
    rooms[0].length === 2 &&
    rooms[0][1] === channelId
  );
}

/**
 * The exchange id carried by a resident-authored turn: `["exchange", <id>,
 * <turn>]`. Counted owner-directed returns retain it; distinguishing those
 * from internal volleys requires the verified exchange head.
 */
export function exchangeIdFromTags(
  tags: readonly (readonly string[])[] | undefined,
): string | null {
  for (const tag of tags ?? []) {
    if (tag[0] !== EXCHANGE_TAG) continue;
    const id = tag[1];
    if (typeof id === "string" && id.length > 0) return id.toLowerCase();
  }
  return null;
}

/** True when this event is a turn spoken inside an exchange. */
export function hasExchangeTurnTag(
  tags: readonly (readonly string[])[] | undefined,
): boolean {
  return exchangeIdFromTags(tags) !== null;
}
