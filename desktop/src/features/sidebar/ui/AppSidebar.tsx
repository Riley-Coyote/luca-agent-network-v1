import * as React from "react";

import type { AddCommunityPrefillRequest } from "@/features/communities/addCommunityPrefill";
import type { Community } from "@/features/communities/types";
import { AddCommunityDialog } from "@/features/communities/ui/AddCommunityDialog";
import { useRoomProjectCatalog } from "@/features/channels/lib/roomProjects";
import { useActiveWorkingChannelsById } from "@/features/sidebar/lib/useActiveWorkingChannelsById";
import { buildChatListItems } from "@/features/sidebar/ui/ChatList";
import { AppSidebarPinnedHeader } from "@/features/sidebar/ui/AppSidebarPinnedHeader";
import { CreateChannelDialog } from "@/features/sidebar/ui/CreateChannelDialog";
import { SidebarRelayConnectionCard } from "@/features/sidebar/ui/SidebarRelayConnectionCard";
import type { useSidebarRelayConnectionCard } from "@/features/sidebar/ui/useSidebarRelayConnectionCard";
import { WorkspaceNavigation } from "@/features/sidebar/ui/WorkspaceNavigation";
import { useDmSidebarMetadata } from "@/features/sidebar/useDmSidebarMetadata";
import { SidebarUpdateCard } from "@/features/settings/SidebarUpdateCard";
import { useUpdaterContext } from "@/features/settings/hooks/UpdaterProvider";
import { shouldShowSidebarUpdateCard } from "@/features/settings/sidebarUpdateCardVisibility";
import type {
  Channel,
  ChannelVisibility,
  PresenceStatus,
  Profile,
  SearchHit,
  UserStatus,
} from "@/shared/api/types";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { useDeferredLoad } from "@/shared/hooks/useDeferredStartup";
import { useDeferredModalOpen } from "@/shared/ui/deferredModalOpen";
import { Sidebar, SidebarRail, useSidebar } from "@/shared/ui/sidebar";

type AppSidebarProps = {
  addCommunityPrefill?: AddCommunityPrefillRequest | null;
  activeCommunity: Community | null;
  channels: Channel[];
  currentPubkey?: string;
  fallbackDisplayName?: string;
  homeBadgeCount: number;
  isAddCommunityOpen?: boolean;
  isLoading: boolean;
  isCreatingChannel: boolean;
  isCreatingForum: boolean;
  profile?: Profile;
  relayConnectionCard: ReturnType<typeof useSidebarRelayConnectionCard>;
  selfPresenceStatus: PresenceStatus;
  errorMessage?: string;
  selectedChannelId: string | null;
  selectedView:
    | "home"
    | "inbox"
    | "channel"
    | "messages"
    | "agents"
    | "workflows"
    | "pulse"
    | "projects";
  unreadChannelCounts: ReadonlyMap<string, number>;
  unreadChannelIds: ReadonlySet<string>;
  communities: Community[];
  onAddCommunity: (community: Community) => void;
  onAddCommunityOpenChange?: (open: boolean) => void;
  onCreateChannel: (input: {
    name: string;
    description?: string;
    visibility: ChannelVisibility;
    ttlSeconds?: number;
    templateId?: string;
  }) => Promise<void>;
  onCreateForum: (input: {
    name: string;
    description?: string;
    visibility: ChannelVisibility;
    ttlSeconds?: number;
    templateId?: string;
  }) => Promise<void>;
  onOpenAddCommunity: () => void;
  onSendFeedback?: () => void;
  onHideDm: (channelId: string) => void;
  onMarkChannelUnread: (channelId: string) => void;
  onMarkChannelRead: (
    channelId: string,
    lastMessageAt: string | null | undefined,
  ) => void;
  onMarkAllChannelsRead: () => void;
  onBrowseChannels?: (onCreated?: (channelId: string) => void) => void;
  onOpenDm: (input: { pubkeys: string[] }) => Promise<void>;
  onUpdateCommunity: (
    id: string,
    updates: Partial<Pick<Community, "name" | "relayUrl" | "token">>,
  ) => void;
  onRemoveCommunity: (id: string) => void;
  onCreateAgent: () => void;
  onSelectAgents: () => void;
  onSelectProjects: () => void;
  onSelectPulse: () => void;
  onSelectWorkflows: () => void;
  onSelectHome: () => void;
  onSelectInbox: () => void;
  onSelectChannel: (channelId: string) => void;
  onOpenSearchResult: (hit: SearchHit) => void;
  searchChannels: Channel[];
  searchFocusRequest: number;
  onSelectSettings: (section?: "profile" | "appearance") => void;
  onSetPresenceStatus?: (status: "online" | "away" | "offline") => void;
  onSetUserStatus: (text: string, emoji: string) => void;
  onClearUserStatus: () => void;
  onSwitchCommunity: (id: string) => void;
  selfUserStatus?: UserStatus;
  isPresencePending?: boolean;
  onNewMessage: () => void;
  isCreateChannelOpen?: boolean;
  onCreateChannelOpenChange?: (open: boolean) => void;
  mutedChannelIds?: ReadonlySet<string>;
  onMuteChannel?: (channelId: string) => void;
  onUnmuteChannel?: (channelId: string) => void;
  starredChannelIds?: ReadonlySet<string>;
  onStarChannel?: (channelId: string) => void;
  onUnstarChannel?: (channelId: string) => void;
};

export function AppSidebar({
  addCommunityPrefill,
  channels,
  currentPubkey,
  fallbackDisplayName,
  homeBadgeCount,
  isAddCommunityOpen,
  isCreatingChannel,
  isCreateChannelOpen,
  onAddCommunity,
  onAddCommunityOpenChange,
  onBrowseChannels,
  onCreateAgent,
  onCreateChannel,
  onCreateChannelOpenChange,
  onNewMessage,
  onOpenDm,
  onOpenSearchResult,
  onSelectAgents,
  onSelectChannel,
  onSelectInbox,
  onSelectProjects,
  onSelectPulse,
  onSelectSettings,
  profile,
  relayConnectionCard,
  searchChannels,
  searchFocusRequest,
  selectedChannelId,
  selectedView,
  unreadChannelIds,
}: AppSidebarProps) {
  const { open: sidebarOpen, openMobile } = useSidebar();
  const isMobile = useIsMobile();
  const { status: updateStatus } = useUpdaterContext();
  const [isUpdateDismissed, setIsUpdateDismissed] = React.useState(false);
  const showUpdate =
    shouldShowSidebarUpdateCard(updateStatus) && !isUpdateDismissed;
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const { openNextFrame } = useDeferredModalOpen();

  React.useEffect(() => {
    if (isCreateChannelOpen) {
      openNextFrame(() => setCreateDialogOpen(true));
    }
  }, [isCreateChannelOpen, openNextFrame]);

  React.useEffect(() => {
    if (!shouldShowSidebarUpdateCard(updateStatus)) {
      setIsUpdateDismissed(false);
    }
  }, [updateStatus]);

  const directMessages = React.useMemo(
    () => channels.filter((channel) => channel.channelType === "dm"),
    [channels],
  );
  const isSelectedDirectMessage = directMessages.some(
    (channel) => channel.id === selectedChannelId,
  );
  const shouldLoadDmMetadata = useDeferredLoad({
    immediate: isSelectedDirectMessage,
    timeoutMs: 200,
  });
  const { dmChannelLabels } = useDmSidebarMetadata({
    currentPubkey,
    directMessages,
    enabled: shouldLoadDmMetadata,
    fallbackDisplayName,
    profileDisplayName: profile?.displayName,
  });
  const { projectByChannelId, projects } = useRoomProjectCatalog(channels);
  const workingByChannelId = useActiveWorkingChannelsById();
  const displayName =
    profile?.displayName?.trim() ||
    fallbackDisplayName?.trim() ||
    "Current identity";
  const items = React.useMemo(
    () =>
      buildChatListItems({
        channels,
        labels: dmChannelLabels,
        currentPubkey,
      }),
    [channels, currentPubkey, dmChannelLabels],
  );

  return (
    <Sidebar
      className="!border-r-0"
      collapsible="offcanvas"
      data-testid="app-sidebar"
      variant="sidebar"
    >
      <WorkspaceNavigation
        currentPubkey={currentPubkey}
        displayName={displayName}
        footer={
          <div className="relative z-30 shrink-0" data-buzz-glass-footer-wrap>
            {showUpdate ? (
              <div className="px-2 pb-2">
                <SidebarUpdateCard
                  onDismiss={() => setIsUpdateDismissed(true)}
                />
              </div>
            ) : null}
            {relayConnectionCard.showSidebarRelayConnectionCard &&
            (isMobile ? openMobile : sidebarOpen) ? (
              <div className="px-2 pb-2">
                <SidebarRelayConnectionCard
                  isConnected={relayConnectionCard.isRelayConnectionSuccess}
                  isReconnectPending={
                    relayConnectionCard.isRelayReconnectPending
                  }
                  isWaitingOnReconnectHook={
                    relayConnectionCard.isWaitingOnReconnectHook
                  }
                  onDismiss={relayConnectionCard.onDismissRelayConnectionCard}
                  onReconnect={relayConnectionCard.onReconnectRelay}
                />
              </div>
            ) : null}
          </div>
        }
        header={
          <AppSidebarPinnedHeader
            channelLabels={dmChannelLabels}
            currentPubkey={currentPubkey}
            onBrowseChannels={onBrowseChannels}
            onCreateAgent={onCreateAgent}
            onCreateChannel={() => {
              onCreateChannelOpenChange?.(true);
              if (!onCreateChannelOpenChange) setCreateDialogOpen(true);
            }}
            onOpenDm={onOpenDm}
            onOpenSearchResult={onOpenSearchResult}
            onSelectChannel={onSelectChannel}
            searchChannels={searchChannels}
            searchFocusRequest={searchFocusRequest}
            suggestionChannels={channels}
          />
        }
        homeBadgeCount={homeBadgeCount}
        items={items}
        onNewMessage={onNewMessage}
        onSelectAgents={onSelectAgents}
        onSelectChannel={onSelectChannel}
        onSelectInbox={onSelectInbox}
        onSelectProjects={onSelectProjects}
        onSelectPulse={onSelectPulse}
        onSelectSettings={() => onSelectSettings()}
        projectByChannelId={projectByChannelId}
        projects={projects}
        selectedChannelId={selectedChannelId}
        selectedView={selectedView}
        unreadChannelIds={unreadChannelIds}
        workingByChannelId={workingByChannelId}
      />

      <CreateChannelDialog
        channelKind={createDialogOpen ? "stream" : null}
        isCreating={isCreatingChannel}
        onCreate={onCreateChannel}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          onCreateChannelOpenChange?.(open);
        }}
      />
      <AddCommunityDialog
        prefill={addCommunityPrefill}
        onOpenChange={onAddCommunityOpenChange ?? (() => {})}
        onSubmit={onAddCommunity}
        open={isAddCommunityOpen ?? false}
      />
      <SidebarRail />
    </Sidebar>
  );
}
