import { useAgentChatPicture } from "@/features/agents/lib/agentChatPicture";
import { useIdentityQuery } from "@/shared/api/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { AgentDendrite } from "@/shared/ui/dendrite/AgentDendrite";
import { UserAvatar } from "@/shared/ui/UserAvatar";

/** Exchange authors use their uploaded picture or the approved static mark. */
export function ExchangeIdentityMark({
  name,
  pubkey,
  avatarUrl,
}: {
  name: string;
  pubkey: string;
  avatarUrl?: string | null;
}) {
  const ownerPubkey = useIdentityQuery().data?.pubkey;
  const chatPicture = useAgentChatPicture(ownerPubkey, pubkey);
  const isOwner = Boolean(
    ownerPubkey && normalizePubkey(ownerPubkey) === normalizePubkey(pubkey),
  );
  if (isOwner)
    return (
      <UserAvatar
        avatarUrl={avatarUrl ?? null}
        displayName={name}
        fallbackDelayMs={0}
        size="xs"
        testId="exchange-owner-avatar"
      />
    );
  const picture = chatPicture ?? avatarUrl;
  return picture ? (
    <UserAvatar avatarUrl={picture} displayName={name} size="xs" />
  ) : (
    <AgentDendrite residentKey={pubkey} size={20} />
  );
}
