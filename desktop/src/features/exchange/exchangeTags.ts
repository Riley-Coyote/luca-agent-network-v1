import { EXCHANGE_TAG } from "@/shared/constants/kinds";

/**
 * The exchange id carried by a resident-authored turn: `["exchange", <id>,
 * <turn>]`. Owner messages never carry it and never count against the bucket,
 * so the tag alone identifies a volley.
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
