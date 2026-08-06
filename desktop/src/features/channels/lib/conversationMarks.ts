import type { Channel } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

/**
 * Who a conversation is WITH — the seeds for its identity marks.
 *
 * One rule, because three surfaces render this stack and they must agree: the
 * rail row, the header, and the conversation opener. If they disagree, the same
 * room wears different faces in different places, which is exactly the kind of
 * incoherence people register without being able to name.
 *
 * DMs carry `participantPubkeys`; rooms carry `memberPubkeys` and leave
 * participants empty. Reading only one of them made every room fall back to its
 * id and show a single generic mark instead of the people in it.
 *
 * You are always excluded — a conversation is named and marked by who you are
 * talking TO. A room with nobody else in it falls back to its own id, so it
 * still has a stable, deterministic mark rather than an empty gap.
 */
export function conversationMarkSeeds(
  channel: Pick<Channel, "id" | "participantPubkeys" | "memberPubkeys"> | null,
  currentPubkey?: string | null,
  limit = 4,
): string[] {
  if (!channel) return [];
  const me = currentPubkey ? normalizePubkey(currentPubkey) : null;
  const source = channel.participantPubkeys?.length
    ? channel.participantPubkeys
    : (channel.memberPubkeys ?? []);
  const others = source.filter((pubkey) => normalizePubkey(pubkey) !== me);
  return (others.length ? others : [channel.id]).slice(0, limit);
}
