import { LogIn, PanelRight, PictureInPicture2 } from "lucide-react";
import type * as React from "react";

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
import { WorkspaceLayoutMenuButton } from "@/features/conversation-workspace";
import { ResidentMote } from "@/features/luca/residents/ResidentMote";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { ProjectNavigatorViewModel } from "@/features/projects/lib/projectNavigator";
import { ProjectRoomPicker } from "@/features/projects/ui/ProjectRoomPicker";
import {
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  ProfileAvatarWithStatus,
  scaleProfileAvatarStatusGeometry,
} from "@/features/profile/ui/ProfileAvatarWithStatus";
import { Button } from "@/shared/ui/button";
import type {
  Channel,
  ChannelMember,
  PresenceStatus,
} from "@/shared/api/types";
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
  channelMembers?: readonly ChannelMember[];
  profiles?: UserProfileLookup;
  projectRoomNavigation?: {
    onSelectRoom: (channelId: string) => void;
    viewModel: ProjectNavigatorViewModel;
  } | null;
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

export function ChannelScreenHeader({
  activeChannel,
  activeChannelEphemeralDisplay,
  activeChannelTitle,
  activeDmAvatarUrl,
  activeDmHeaderParticipants,
  activeDmPresenceStatus,
  agentPubkeys,
  channelMembers,
  projectRoomNavigation,
  chromeWrapperRef,
  currentPubkey,
  isJoining = false,
  onJoinChannel,
  onToggleMembers,
  showHeaderContent = true,
  transparentChrome = false,
  visitorPubkeys,
}: ChannelScreenHeaderProps) {
  const popoutWindowsEnabled = usePopoutWindowsEnabled();
  const popoutWindow = isPopoutWindow();
  const primaryDmParticipant = activeDmHeaderParticipants[0] ?? null;
  const primaryDmIsResident = Boolean(
    primaryDmParticipant &&
      agentPubkeys.has(normalizePubkey(primaryDmParticipant.pubkey)),
  );
  const presentResidentPubkeys = new Set<string>();
  if (channelMembers) {
    for (const member of channelMembers) {
      if (member.isAgent || member.role === "bot") {
        presentResidentPubkeys.add(normalizePubkey(member.pubkey));
      }
    }
  } else {
    for (const participant of activeDmHeaderParticipants) {
      if (agentPubkeys.has(normalizePubkey(participant.pubkey))) {
        presentResidentPubkeys.add(normalizePubkey(participant.pubkey));
      }
    }
  }
  for (const visitorPubkey of visitorPubkeys ?? []) {
    presentResidentPubkeys.add(normalizePubkey(visitorPubkey));
  }
  if (currentPubkey) {
    presentResidentPubkeys.delete(normalizePubkey(currentPubkey));
  }
  const showResidentMote =
    activeChannel?.channelType === "dm" && presentResidentPubkeys.size > 0;
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
          <WorkspaceLayoutMenuButton />
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
        ) : showResidentMote ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <ResidentMote count={presentResidentPubkeys.size} />
            <h1
              className="min-w-0 truncate text-chat font-medium leading-6"
              data-testid="chat-title"
            >
              {activeChannelTitle}
            </h1>
          </div>
        ) : undefined
      }
      subtitle={null}
      title={activeChannelTitle}
      transparentChrome={transparentChrome}
      visibility={activeChannel?.visibility}
    />
  );
}
