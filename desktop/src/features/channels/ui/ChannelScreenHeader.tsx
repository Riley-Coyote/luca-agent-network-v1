import { LogIn } from "lucide-react";
import * as React from "react";

import { useChannelAgentActivity } from "@/features/agents/activeAgentTurnsStore";
import { activityLabel } from "@/features/agents/lib/activityPhase";
import { conversationMarkSeeds } from "@/features/channels/lib/conversationMarks";

import { ChatHeader } from "@/features/chat/ui/ChatHeader";
import type { EphemeralChannelDisplay } from "@/features/channels/lib/ephemeralChannel";
import type { ActiveDmHeaderParticipant } from "@/features/channels/useActiveChannelHeader";
import { getChannelDescription } from "@/features/channels/lib/channelDescription";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import { getDmParticipantPreview } from "@/features/channels/lib/dmParticipantDisplay";
import { ChannelHeaderStatusBadge } from "@/features/channels/ui/ChannelHeaderStatusBadge";
import { ChannelMembersBar } from "@/features/channels/ui/ChannelMembersBar";
import {
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  ProfileAvatarWithStatus,
  scaleProfileAvatarStatusGeometry,
} from "@/features/profile/ui/ProfileAvatarWithStatus";
import { Button } from "@/shared/ui/button";
import type { Channel, PresenceStatus } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  AgentIdentitySpecimen,
  shortAgentFingerprint,
} from "@/shared/ui/AgentIdentitySpecimen";
import { UserAvatar } from "@/shared/ui/UserAvatar";

const DM_HEADER_AVATAR_SIZE = 32;
const DM_HEADER_AVATAR_STATUS_GEOMETRY = scaleProfileAvatarStatusGeometry(
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  DM_HEADER_AVATAR_SIZE,
);

type ChannelScreenHeaderProps = {
  activeChannel: Channel | null;
  activeChannelEphemeralDisplay: EphemeralChannelDisplay | null;
  activeChannelTitle: string;
  actionsVariant?: "inline" | "compact";
  activeDmAvatarUrl: string | null;
  activeDmHeaderParticipants: ActiveDmHeaderParticipant[];
  activeDmPresenceStatus: PresenceStatus | null;
  agentPubkeys: ReadonlySet<string>;
  /** Names for the live-state line; without it the subtitle can only say
   *  "a resident", which is true but impersonal. */
  profiles?: UserProfileLookup;
  chromeWrapperRef?: React.Ref<HTMLDivElement>;
  currentPubkey?: string;
  isAddBotOpen?: boolean;
  isJoining?: boolean;
  showHeaderContent?: boolean;
  transparentChrome?: boolean;
  onAddBotOpenChange?: (open: boolean) => void;
  onJoinChannel?: () => Promise<void>;
  onManageChannel: () => void;
  onToggleMembers: () => void;
};

/** PROTOTYPE SWITCH. true = the chat-app conversation header (mark stack +
 *  live subtitle). false = the original room header (channel icon, fingerprint
 *  meta, member count). */
const CONVERSATION_HEADER = true;

export function ChannelScreenHeader({
  activeChannel,
  activeChannelEphemeralDisplay,
  activeChannelTitle,
  actionsVariant = "inline",
  activeDmAvatarUrl,
  activeDmHeaderParticipants,
  activeDmPresenceStatus,
  agentPubkeys,
  profiles,
  chromeWrapperRef,
  currentPubkey,
  isAddBotOpen,
  isJoining = false,
  onAddBotOpenChange,
  showHeaderContent = true,
  transparentChrome = false,
  onJoinChannel,
  onManageChannel,
  onToggleMembers,
}: ChannelScreenHeaderProps) {
  const isGroupDm =
    activeChannel?.channelType === "dm" &&
    activeDmHeaderParticipants.length > 1;
  const showJoinButton =
    activeChannel !== null &&
    !activeChannel.isMember &&
    activeChannel.visibility === "open" &&
    !activeChannel.archivedAt &&
    onJoinChannel;
  const primaryDmParticipant = activeDmHeaderParticipants[0] ?? null;
  const primaryDmIsAgent = Boolean(
    primaryDmParticipant &&
      agentPubkeys.has(normalizePubkey(primaryDmParticipant.pubkey)),
  );
  const groupAgentCount = activeDmHeaderParticipants.filter((participant) =>
    agentPubkeys.has(normalizePubkey(participant.pubkey)),
  ).length;

  const actions = activeChannel ? (
    showJoinButton ? (
      <Button
        disabled={isJoining}
        onClick={() => void onJoinChannel()}
        size="sm"
        variant="default"
      >
        <LogIn className="mr-1.5 h-4 w-4" />
        {isJoining ? "Joining…" : "Join"}
      </Button>
    ) : CONVERSATION_HEADER ? null : (
      // The mark stack beside the title already says who is here, more legibly
      // than a number does. A count is org-speak; a chat app shows faces.
      <ChannelMembersBar
        channel={activeChannel}
        currentPubkey={currentPubkey}
        isAddBotOpen={isAddBotOpen}
        onAddBotOpenChange={onAddBotOpenChange}
        onManageChannel={onManageChannel}
        onToggleMembers={onToggleMembers}
        variant={actionsVariant}
      />
    )
  ) : null;

  // Everyone in the room but you. A room with no other participants falls back
  // to its own id so it still carries a mark — same rule as the rail.
  const headerMarkSeeds = React.useMemo(
    () => conversationMarkSeeds(activeChannel, currentPubkey),
    [activeChannel, currentPubkey],
  );

  // Live state beats a static description. Every messenger puts presence on
  // this line; ours can say what the resident is actually doing.
  const headerActivity = useChannelAgentActivity(activeChannel?.id ?? null);
  const workingSeeds = React.useMemo(
    () =>
      new Set(
        headerActivity.map((row: { agentPubkey: string }) => row.agentPubkey),
      ),
    [headerActivity],
  );
  const conversationSubtitle = React.useMemo(() => {
    if (headerActivity.length > 1) {
      return `${headerActivity.length} residents are working…`;
    }
    const one = headerActivity[0];
    if (one) {
      const name =
        resolveUserLabel({ profiles, pubkey: one.agentPubkey }) ||
        activeDmHeaderParticipants?.find(
          (participant) =>
            normalizePubkey(participant.pubkey) ===
            normalizePubkey(one.agentPubkey),
        )?.displayName ||
        "A resident";
      return `${name} is ${activityLabel(one.activity) || "working"}…`;
    }
    return getChannelDescription(activeChannel) ?? "";
  }, [activeChannel, activeDmHeaderParticipants, headerActivity, profiles]);

  if (!showHeaderContent) {
    return null;
  }

  return (
    <ChatHeader
      belowSystemChrome
      chromeWrapperRef={chromeWrapperRef}
      actions={actions}
      channelType={activeChannel?.channelType}
      description={getChannelDescription(activeChannel)}
      identityMeta={
        CONVERSATION_HEADER ? null : activeChannel?.channelType === "dm" ? (
          isGroupDm ? (
            `${groupAgentCount} ${groupAgentCount === 1 ? "agent" : "agents"}`
          ) : primaryDmIsAgent && primaryDmParticipant ? (
            <>
              {shortAgentFingerprint(primaryDmParticipant.pubkey)}
              <span className="ml-3" data-luca-agent-state>
                {activeDmPresenceStatus === "offline"
                  ? "unavailable"
                  : "present"}
              </span>
            </>
          ) : null
        ) : null
      }
      conversation
      subtitle={conversationSubtitle}
      leadingContent={
        CONVERSATION_HEADER ? (
          <span className="mr-1.5 flex shrink-0 -space-x-1.5">
            {headerMarkSeeds.map((seed) => (
              <AgentIdentitySpecimen
                accessibleName={activeChannelTitle ?? "conversation"}
                className="ring-2 ring-background"
                key={seed}
                publicKey={seed}
                size={20}
                state={workingSeeds.has(seed) ? "working" : "present"}
              />
            ))}
          </span>
        ) : activeChannel?.channelType === "dm" ? (
          isGroupDm ? (
            <DmHeaderParticipantStack
              agentPubkeys={agentPubkeys}
              participants={activeDmHeaderParticipants}
            />
          ) : primaryDmIsAgent && primaryDmParticipant ? (
            <AgentIdentitySpecimen
              accessibleName={primaryDmParticipant.displayName}
              className="mr-1.5"
              publicKey={primaryDmParticipant.pubkey}
              size={26}
              state={
                activeDmPresenceStatus === "offline" ? "unavailable" : "present"
              }
            />
          ) : (
            <ProfileAvatarWithStatus
              avatarClassName="text-xs"
              avatarUrl={activeDmAvatarUrl}
              className="mr-1.5 h-8 w-8"
              geometry={DM_HEADER_AVATAR_STATUS_GEOMETRY}
              iconClassName="h-4 w-4"
              label={activeChannelTitle}
              size={DM_HEADER_AVATAR_SIZE}
              status={activeDmPresenceStatus ?? "offline"}
              statusTestId="chat-presence-badge"
              testId="chat-header-dm-avatar"
            />
          )
        ) : undefined
      }
      statusBadge={
        <ChannelHeaderStatusBadge
          ephemeralDisplay={activeChannelEphemeralDisplay}
        />
      }
      title={activeChannelTitle}
      transparentChrome={transparentChrome}
      visibility={activeChannel?.visibility}
    />
  );
}

function DmHeaderParticipantStack({
  agentPubkeys,
  participants,
}: {
  agentPubkeys: ReadonlySet<string>;
  participants: ActiveDmHeaderParticipant[];
}) {
  const { hiddenCount, visibleParticipants } =
    getDmParticipantPreview(participants);
  const stackItemCount = visibleParticipants.length + (hiddenCount > 0 ? 1 : 0);

  return (
    <div
      aria-hidden="true"
      className="mr-1.5 flex shrink-0 items-center"
      data-testid="chat-header-dm-avatar-stack"
    >
      {visibleParticipants.map((participant, index) => (
        <div
          className={index > 0 ? "-ml-2" : ""}
          data-testid="chat-header-dm-avatar-stack-participant"
          key={participant.pubkey}
          style={{
            zIndex: index + 1,
            ...(index < stackItemCount - 1 && {
              mask: "radial-gradient(circle 18px at calc(100% + 4px) 50%, transparent 99%, #fff 100%)",
              WebkitMask:
                "radial-gradient(circle 18px at calc(100% + 4px) 50%, transparent 99%, #fff 100%)",
            }),
          }}
        >
          {agentPubkeys.has(normalizePubkey(participant.pubkey)) ? (
            <AgentIdentitySpecimen
              accessibleName={participant.displayName}
              publicKey={participant.pubkey}
              size={26}
              state="present"
            />
          ) : (
            <UserAvatar
              avatarUrl={participant.avatarUrl}
              className="h-[26px] w-[26px] text-[10px]"
              displayName={participant.displayName}
              size="sm"
            />
          )}
        </div>
      ))}
      {hiddenCount > 0 ? (
        <div
          className={visibleParticipants.length > 0 ? "-ml-2" : ""}
          data-testid="chat-header-dm-avatar-stack-more"
          style={{ zIndex: stackItemCount }}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground shadow-xs">
            <span className="text-2xs leading-none">+{hiddenCount}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
