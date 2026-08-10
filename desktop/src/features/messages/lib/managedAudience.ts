import type { Channel } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

export type ManagedAudienceIntentV1 =
  | { mode: "conversation"; resident_pubkeys: string[] }
  | { mode: "directed"; resident_pubkeys: string[] }
  | { mode: "none" };

export type ManagedResponseSurface = "timeline" | "thread";

type ManagedAudienceInput = {
  channel: Channel;
  managedResidentPubkeys: ReadonlySet<string>;
  explicitMentionPubkeys?: readonly string[];
  replyAuthorPubkey?: string | null;
};

function normalizedManagedSubset(
  candidates: readonly string[],
  managedResidentPubkeys: ReadonlySet<string>,
): string[] {
  const managed = new Set(
    [...managedResidentPubkeys].map((pubkey) => normalizePubkey(pubkey)),
  );
  return [...new Set(candidates.map((pubkey) => normalizePubkey(pubkey)))]
    .filter((pubkey) => pubkey.length > 0 && managed.has(pubkey))
    .sort();
}

/**
 * Derive resident activation independently from relay delivery visibility.
 *
 * Replies and explicit agent mentions are exact directed subsets. Only a
 * message with neither becomes conversation-wide among managed residents who
 * are actual members of the current conversation.
 */
export function deriveManagedAudience({
  channel,
  managedResidentPubkeys,
  explicitMentionPubkeys = [],
  replyAuthorPubkey = null,
}: ManagedAudienceInput): ManagedAudienceIntentV1 {
  const explicitResidents = normalizedManagedSubset(
    explicitMentionPubkeys,
    managedResidentPubkeys,
  );
  if (replyAuthorPubkey) {
    const directed = normalizedManagedSubset(
      [replyAuthorPubkey, ...explicitResidents],
      managedResidentPubkeys,
    );
    return directed.length > 0
      ? { mode: "directed", resident_pubkeys: directed }
      : { mode: "none" };
  }
  if (explicitResidents.length > 0) {
    return { mode: "directed", resident_pubkeys: explicitResidents };
  }
  if (explicitMentionPubkeys.length > 0) {
    return { mode: "none" };
  }

  const conversationResidents = normalizedManagedSubset(
    [...channel.memberPubkeys, ...channel.participantPubkeys],
    managedResidentPubkeys,
  );
  return conversationResidents.length > 0
    ? { mode: "conversation", resident_pubkeys: conversationResidents }
    : { mode: "none" };
}

export function managedAudiencePubkeys(
  intent: ManagedAudienceIntentV1,
): string[] {
  return intent.mode === "none" ? [] : intent.resident_pubkeys;
}
