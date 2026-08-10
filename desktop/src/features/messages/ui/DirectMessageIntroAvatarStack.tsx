import { getDmParticipantPreview } from "@/features/channels/lib/dmParticipantDisplay";
import { useKnownAgentPubkeys } from "@/features/agents/useKnownAgentPubkeys";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { UserAvatar } from "@/shared/ui/UserAvatar";

export type DirectMessageIntroParticipant = {
  avatarUrl: string | null;
  displayName: string;
  pubkey: string;
};

export function DirectMessageIntroAvatarStack({
  participants,
}: {
  participants: DirectMessageIntroParticipant[];
}) {
  const knownAgentPubkeys = useKnownAgentPubkeys();
  const { hiddenCount, visibleParticipants } =
    getDmParticipantPreview(participants);
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center gap-2"
      data-testid="message-dm-intro-avatar-stack"
    >
      {visibleParticipants.map((participant) => (
        <div
          data-testid="message-dm-intro-avatar-stack-participant"
          key={participant.pubkey}
        >
          {knownAgentPubkeys.has(normalizePubkey(participant.pubkey)) ? (
            <AgentIdentitySpecimen
              accessibleName={participant.displayName}
              publicKey={participant.pubkey}
              size={52}
              state="present"
            />
          ) : (
            <UserAvatar
              avatarUrl={participant.avatarUrl}
              className="h-[52px] w-[52px] text-sm"
              displayName={participant.displayName}
              size="md"
            />
          )}
        </div>
      ))}
      {hiddenCount > 0 ? (
        <div data-testid="message-dm-intro-avatar-stack-more">
          <span className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground shadow-xs">
            <span className="text-lg leading-none">+{hiddenCount}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
