import { LogIn, PanelRight, PictureInPicture2 } from "lucide-react";
import type * as React from "react";
import { createPortal } from "react-dom";

import {
  openChannelPopout,
  usePopoutWindowsEnabled,
} from "@/app/popout/popoutFeature";
import { isPopoutWindow } from "@/app/popout/popoutMode";
import { useShellLipActionsSlot } from "@/app/shell/lipActionsSlot";
import { ChatHeader } from "@/features/chat/ui/ChatHeader";
import type { EphemeralChannelDisplay } from "@/features/channels/lib/ephemeralChannel";
import { getChannelDescription } from "@/features/channels/lib/channelDescription";
import type { ActiveDmHeaderParticipant } from "@/features/channels/useActiveChannelHeader";
import { ChannelHeaderStatusBadge } from "@/features/channels/ui/ChannelHeaderStatusBadge";
import {
  useConversationWorkspace,
  WorkspaceLayoutMenuButton,
} from "@/features/conversation-workspace";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { ProjectNavigatorViewModel } from "@/features/projects/lib/projectNavigator";
import { ProjectRoomPicker } from "@/features/projects/ui/ProjectRoomPicker";
import {
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  ProfileAvatarWithStatus,
  scaleProfileAvatarStatusGeometry,
} from "@/features/profile/ui/ProfileAvatarWithStatus";
import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { useRightCardsSlot } from "@/shared/layout/RightCardsSlot";
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
/** In the lip the presence avatar sits on the lip's line, inside its tiles'
 *  24 (shell-header.css). */
const DM_LIP_AVATAR_SIZE = 22;
const DM_LIP_AVATAR_STATUS_GEOMETRY = scaleProfileAvatarStatusGeometry(
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  DM_LIP_AVATAR_SIZE,
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
  /** The conversation details card is open: the lip's details button shows
   *  it (SHELL_BUILD.md, WP-04b). */
  detailsOpen?: boolean;
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
  projectRoomNavigation,
  chromeWrapperRef,
  detailsOpen = false,
  isJoining = false,
  onJoinChannel,
  onToggleMembers,
  showHeaderContent = true,
  transparentChrome = false,
}: ChannelScreenHeaderProps) {
  const popoutWindowsEnabled = usePopoutWindowsEnabled();
  const popoutWindow = isPopoutWindow();
  const shellFrame = useShellFrameEnabled();
  const lipSlot = useShellLipActionsSlot();
  // The pane that holds the shell's right cards is the focused one (the
  // others are isolated from them: RightCardsSlotBoundary); only it speaks
  // in the lip, as only its name does.
  const ownsRightCards = useRightCardsSlot() !== null;
  // Several panes side by side: each other pane names its conversation
  // quietly at its own top (SHELL_SPEC.md, Decided 5).
  const workspace = useConversationWorkspace();
  const quietPaneName =
    !ownsRightCards &&
    workspace !== null &&
    workspace.layout.preset !== "single";
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

  // A pop-out draws ONE bar, and it is the window's own (`PopoutShell`): it
  // carries the conversation's name as a picker and the window controls. This
  // header would restate the title 36px below it and offer actions that are
  // inert in a second window — two bars, ~92px of chrome, one message visible.
  if (popoutWindow) return null;

  // Under the shell's frame the card has no header (SHELL_SPEC.md, "The
  // conversation's card"; SHELL_BUILD.md, WP-04): the name is the lip's, and
  // the actions, the Join button, a person's presence and the ephemeral badge
  // stand at the lip's right end. A forum's too (WP-04b): its actions move
  // into the lip like every other conversation's, and its band goes. The lip
  // is the frame, not the card: while a side card fills the conversation's
  // card at a small window (the single-panel view), the lip keeps its actions
  // so Details can show it is open and close it (WP-04b); only what sits in
  // the card itself (the fade, a pane's quiet name, a room's picker) goes.
  if (shellFrame) {
    return (
      <ShellChannelHeader
        activeChannel={activeChannel}
        activeChannelEphemeralDisplay={activeChannelEphemeralDisplay}
        activeChannelTitle={activeChannelTitle}
        activeDmAvatarUrl={activeDmAvatarUrl}
        activeDmPresenceStatus={activeDmPresenceStatus}
        chromeWrapperRef={chromeWrapperRef}
        detailsOpen={detailsOpen}
        isJoining={isJoining}
        lipSlot={ownsRightCards ? lipSlot : null}
        onJoinChannel={showJoinButton ? onJoinChannel : undefined}
        onToggleMembers={onToggleMembers}
        popoutWindowsEnabled={popoutWindowsEnabled}
        projectRoomNavigation={projectRoomNavigation}
        quietPaneName={quietPaneName}
        showCardContent={showHeaderContent}
        showDmPresence={
          activeChannel?.channelType === "dm" &&
          primaryDmParticipant !== null &&
          !primaryDmIsResident
        }
        transparentChrome={transparentChrome}
      />
    );
  }

  if (!showHeaderContent) return null;

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
        ) : undefined
      }
      subtitle={null}
      title={activeChannelTitle}
      transparentChrome={transparentChrome}
      visibility={activeChannel?.visibility}
    />
  );
}

/**
 * The conversation's header under the shell's frame: its occupants portal into
 * the lip's right-hand slot (lipActionsSlot.ts), in the order the lip reads
 * them: a person's presence, the ephemeral badge, then Join or the actions
 * (layout, open as window, conversation details), the last 8 from the card's
 * right edge. The card keeps only a short fade under its top edge, the height
 * of its reading area's top padding (22, chromeLayout.ts). A project room
 * keeps its room picker in the card until the rail's room setting lands
 * (WP-02).
 */
function ShellChannelHeader({
  activeChannel,
  activeChannelEphemeralDisplay,
  activeChannelTitle,
  activeDmAvatarUrl,
  activeDmPresenceStatus,
  chromeWrapperRef,
  detailsOpen,
  isJoining,
  lipSlot,
  onJoinChannel,
  onToggleMembers,
  popoutWindowsEnabled,
  projectRoomNavigation,
  quietPaneName,
  showCardContent,
  showDmPresence,
  transparentChrome,
}: {
  activeChannel: Channel | null;
  activeChannelEphemeralDisplay: EphemeralChannelDisplay | null;
  activeChannelTitle: string;
  activeDmAvatarUrl: string | null;
  activeDmPresenceStatus: PresenceStatus | null;
  chromeWrapperRef?: React.Ref<HTMLDivElement>;
  detailsOpen: boolean;
  isJoining: boolean;
  lipSlot: HTMLElement | null;
  /** Present only while the Join button stands in the actions' place. */
  onJoinChannel?: () => Promise<void>;
  onToggleMembers: () => void;
  popoutWindowsEnabled: boolean;
  projectRoomNavigation: ChannelScreenHeaderProps["projectRoomNavigation"];
  /** An unfocused pane beside others: its name, quietly, at its own top. */
  quietPaneName: boolean;
  /** False while a side card fills the conversation's card (the
   *  single-panel view): only the lip's actions are drawn. */
  showCardContent: boolean;
  showDmPresence: boolean;
  transparentChrome: boolean;
}) {
  const lipActions = activeChannel ? (
    <>
      {showDmPresence ? (
        <span className="luca-lip-presence">
          <ProfileAvatarWithStatus
            avatarClassName="luca-lip-presence__face text-xs"
            avatarUrl={activeDmAvatarUrl}
            className="luca-lip-presence__avatar"
            geometry={DM_LIP_AVATAR_STATUS_GEOMETRY}
            iconClassName="h-3 w-3"
            label={activeChannelTitle}
            size={DM_LIP_AVATAR_SIZE}
            sizeUnit="px"
            status={activeDmPresenceStatus ?? "offline"}
            statusTestId="chat-presence-badge"
            testId="chat-header-dm-avatar"
          />
        </span>
      ) : null}
      {activeChannelEphemeralDisplay ? (
        <span
          className="luca-lip-glyph"
          title={activeChannelEphemeralDisplay.tooltipLabel}
        >
          <ChannelHeaderStatusBadge
            ephemeralDisplay={activeChannelEphemeralDisplay}
          />
        </span>
      ) : null}
      {onJoinChannel ? (
        <Button
          className="luca-lip-join"
          data-testid="shell-lip-join"
          disabled={isJoining}
          onClick={() => void onJoinChannel()}
          size="xs"
          variant="default"
        >
          <LogIn />
          <span className="text-lip">{isJoining ? "Joining…" : "Join"}</span>
        </Button>
      ) : (
        <>
          <WorkspaceLayoutMenuButton />
          {popoutWindowsEnabled ? (
            <button
              aria-label="Open as window"
              className="luca-lip-button"
              data-testid="open-channel-popout"
              onClick={() => {
                void openChannelPopout(
                  activeChannel.id,
                  activeChannelTitle,
                ).catch((error) => {
                  console.warn("pop-out window unavailable", error);
                });
              }}
              title="Open as window"
              type="button"
            >
              <PictureInPicture2 />
            </button>
          ) : null}
          <button
            aria-expanded={detailsOpen}
            aria-label={
              detailsOpen
                ? "Close conversation details"
                : "Open conversation details"
            }
            className="luca-lip-button"
            data-testid="shell-lip-details"
            onClick={onToggleMembers}
            title={
              detailsOpen
                ? "Close conversation details"
                : "Conversation details"
            }
            type="button"
          >
            <PanelRight />
          </button>
        </>
      )}
    </>
  ) : null;

  return (
    <>
      {lipSlot && lipActions ? createPortal(lipActions, lipSlot) : null}
      {!showCardContent ? null : projectRoomNavigation ? (
        <ChatHeader
          belowSystemChrome
          channelType={activeChannel?.channelType}
          chromeWrapperRef={chromeWrapperRef}
          conversation
          description={getChannelDescription(activeChannel)}
          subtitle={null}
          title={activeChannelTitle}
          titleControl={
            <ProjectRoomPicker
              onSelectRoom={projectRoomNavigation.onSelectRoom}
              viewModel={projectRoomNavigation.viewModel}
            />
          }
          transparentChrome={transparentChrome}
          visibility={activeChannel?.visibility}
        />
      ) : (
        <div className="luca-shell-card-top" data-testid="shell-card-top-veil">
          <div
            aria-hidden="true"
            className="luca-conversation-veil-top luca-shell-veil-top"
          />
          {quietPaneName ? (
            <p
              className="luca-shell-pane-name text-2xs"
              data-testid="shell-pane-name"
              title={getChannelDescription(activeChannel)}
            >
              {activeChannelTitle}
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
