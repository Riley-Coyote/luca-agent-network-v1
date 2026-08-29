import { LogIn, PanelRight, PictureInPicture2 } from "lucide-react";
import * as React from "react";

import {
  openChannelPopout,
  usePopoutWindowsEnabled,
} from "@/app/popout/popoutFeature";
import { isPopoutWindow } from "@/app/popout/popoutMode";
import { ChatHeader } from "@/features/chat/ui/ChatHeader";
import type { EphemeralChannelDisplay } from "@/features/channels/lib/ephemeralChannel";
import { getChannelDescription } from "@/features/channels/lib/channelDescription";
import type { ActiveDmHeaderParticipant } from "@/features/channels/useActiveChannelHeader";
import { ChannelHeaderStatusBadge } from "@/features/channels/ui/ChannelHeaderStatusBadge";
import { ConversationPresenceRail } from "@/features/channels/ui/ConversationPresenceRail";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { ProjectNavigatorViewModel } from "@/features/projects/lib/projectNavigator";
import { ProjectRoomPicker } from "@/features/projects/ui/ProjectRoomPicker";
import {
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  ProfileAvatarWithStatus,
  scaleProfileAvatarStatusGeometry,
} from "@/features/profile/ui/ProfileAvatarWithStatus";
import { Button } from "@/shared/ui/button";
import type { Channel, PresenceStatus } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

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
  profiles?: UserProfileLookup;
  projectRoomNavigation?: {
    onSelectRoom: (channelId: string) => void;
    viewModel: ProjectNavigatorViewModel;
  } | null;
  residentPersonaIdLookup?: ReadonlyMap<string, string | null>;
  chromeWrapperRef?: React.Ref<HTMLDivElement>;
  currentPubkey?: string;
  isAddBotOpen?: boolean;
  isJoining?: boolean;
  showHeaderContent?: boolean;
  transparentChrome?: boolean;
  onAddBotOpenChange?: (open: boolean) => void;
  onJoinChannel?: () => Promise<void>;
  onManageChannel: () => void;
  onOpenResident: (pubkey: string) => void;
  onToggleMembers: () => void;
  /** Residents visiting right now — shown after the members, lighter. */
  visitorPubkeys?: ReadonlySet<string>;
};

function conversationResidentPubkeys(
  channel: Channel | null,
  currentPubkey: string | undefined,
  agentPubkeys: ReadonlySet<string>,
): string[] {
  if (!channel) return [];
  const current = currentPubkey ? normalizePubkey(currentPubkey) : null;
  const source = channel.participantPubkeys?.length
    ? channel.participantPubkeys
    : (channel.memberPubkeys ?? []);
  const seen = new Set<string>();
  const residents: string[] = [];
  for (const pubkey of source) {
    const normalized = normalizePubkey(pubkey);
    if (
      !normalized ||
      normalized === current ||
      seen.has(normalized) ||
      !agentPubkeys.has(normalized)
    ) {
      continue;
    }
    seen.add(normalized);
    residents.push(normalized);
  }
  return residents;
}

export function ChannelScreenHeader({
  activeChannel,
  activeChannelEphemeralDisplay,
  activeChannelTitle,
  activeDmAvatarUrl,
  activeDmHeaderParticipants,
  activeDmPresenceStatus,
  agentPubkeys,
  profiles,
  projectRoomNavigation,
  residentPersonaIdLookup,
  chromeWrapperRef,
  currentPubkey,
  isJoining = false,
  onJoinChannel,
  onOpenResident,
  onToggleMembers,
  showHeaderContent = true,
  transparentChrome = false,
  visitorPubkeys,
}: ChannelScreenHeaderProps) {
  const residentPubkeys = React.useMemo(
    () =>
      conversationResidentPubkeys(activeChannel, currentPubkey, agentPubkeys),
    [activeChannel, agentPubkeys, currentPubkey],
  );
  const popoutWindowsEnabled = usePopoutWindowsEnabled();
  const popoutWindow = isPopoutWindow();
  const primaryDmParticipant = activeDmHeaderParticipants[0] ?? null;
  const primaryDmIsResident = Boolean(
    primaryDmParticipant &&
      agentPubkeys.has(normalizePubkey(primaryDmParticipant.pubkey)),
  );
  const showJoinButton =
    activeChannel !== null &&
    !activeChannel.isMember &&
    activeChannel.visibility === "open" &&
    !activeChannel.archivedAt &&
    onJoinChannel;

  if (!showHeaderContent) return null;

  const actions =
    activeChannel && !popoutWindow ? (
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
      ) : (
        <>
          {popoutWindowsEnabled ? (
            <Button
              aria-label="Open as window"
              data-testid="open-channel-popout"
              onClick={() => {
                void openChannelPopout(
                  activeChannel.id,
                  activeChannelTitle,
                ).catch((error) => {
                  console.warn("pop-out window unavailable", error);
                });
              }}
              size="icon"
              title="Open as window"
              type="button"
              variant="ghost"
            >
              <PictureInPicture2 />
            </Button>
          ) : null}
          <Button
            aria-label="Open conversation details"
            onClick={onToggleMembers}
            size="icon"
            title="Conversation details"
            type="button"
            variant="ghost"
          >
            <PanelRight />
          </Button>
        </>
      )
    ) : null;

  const humanDmLeading =
    activeChannel?.channelType === "dm" &&
    primaryDmParticipant &&
    !primaryDmIsResident ? (
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
    ) : (
      <span aria-hidden />
    );

  return (
    <ChatHeader
      belowSystemChrome
      actions={actions}
      centerContent={
        popoutWindow ? null : (
          <ConversationPresenceRail
            onOpenResident={onOpenResident}
            onOpenRoster={onToggleMembers}
            profiles={profiles}
            residentPersonaIdLookup={residentPersonaIdLookup}
            residentPubkeys={residentPubkeys}
            visitorPubkeys={visitorPubkeys}
          />
        )
      }
      channelType={activeChannel?.channelType}
      chromeWrapperRef={chromeWrapperRef}
      conversation
      description={getChannelDescription(activeChannel)}
      leadingContent={humanDmLeading}
      statusBadge={
        <ChannelHeaderStatusBadge
          ephemeralDisplay={activeChannelEphemeralDisplay}
        />
      }
      titleControl={
        projectRoomNavigation ? (
          <ProjectRoomPicker
            onSelectRoom={projectRoomNavigation.onSelectRoom}
            viewModel={projectRoomNavigation.viewModel}
          />
        ) : undefined
      }
      subtitle={getChannelDescription(activeChannel) ?? ""}
      title={activeChannelTitle}
      transparentChrome={transparentChrome}
      visibility={activeChannel?.visibility}
    />
  );
}
