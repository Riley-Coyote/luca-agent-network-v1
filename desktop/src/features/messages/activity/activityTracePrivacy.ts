import type { Channel } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

/** Only an owner-and-residents private conversation can expose local objects. */
export function canShowPrivateActivityDetails(
  channel: Channel | undefined,
  ownerPubkey: string | null | undefined,
  isResident: (pubkey: string) => boolean,
): boolean {
  if (
    !channel ||
    !ownerPubkey ||
    (channel.channelType !== "dm" && channel.visibility !== "private")
  )
    return false;
  const members = new Set(
    [...channel.memberPubkeys, ...channel.participantPubkeys].map(
      normalizePubkey,
    ),
  );
  const owner = normalizePubkey(ownerPubkey);
  return (
    members.has(owner) &&
    members.size > 1 &&
    [...members].every((pubkey) => pubkey === owner || isResident(pubkey))
  );
}
