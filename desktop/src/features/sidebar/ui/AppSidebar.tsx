import * as React from "react";
import { Plus } from "lucide-react";

import type { Community } from "@/features/communities/types";
import { useActiveWorkingChannelsById } from "@/features/sidebar/lib/useActiveWorkingChannelsById";
import { useDmSidebarMetadata } from "@/features/sidebar/useDmSidebarMetadata";
import {
  AppSidebarPinnedHeader,
  AppSidebarPrimaryMenu,
} from "@/features/sidebar/ui/AppSidebarPinnedHeader";
import { buildChatListItems, ChatList } from "@/features/sidebar/ui/ChatList";
import {
  LucaSidebarCollections,
  type LucaCollectionSelection,
} from "@/features/sidebar/ui/LucaSidebarCollections";
import { SidebarProfileCard } from "@/features/sidebar/ui/SidebarProfileCard";
import { SidebarRelayConnectionCard } from "@/features/sidebar/ui/SidebarRelayConnectionCard";
import type { useSidebarRelayConnectionCard } from "@/features/sidebar/ui/useSidebarRelayConnectionCard";
import type {
  Channel,
  PresenceStatus,
  Profile,
  SearchHit,
  UserStatus,
} from "@/shared/api/types";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "@/shared/ui/sidebar";

type AppSidebarProps = {
  activeCommunity: Community | null;
  channels: Channel[];
  currentPubkey?: string;
  fallbackDisplayName?: string;
  homeBadgeCount: number;
  isLoading: boolean;
  profile?: Profile;
  relayConnectionCard: ReturnType<typeof useSidebarRelayConnectionCard>;
  selfPresenceStatus: PresenceStatus;
  errorMessage?: string;
  selectedChannelId: string | null;
  selectedView:
    | "home"
    | "channel"
    | "messages"
    | "agents"
    | "workflows"
    | "pulse"
    | "projects";
  selectedCollection: LucaCollectionSelection;
  unreadChannelIds: ReadonlySet<string>;
  communities: Community[];
  searchChannels: Channel[];
  searchFocusRequest: number;
  selfUserStatus?: UserStatus;
  isPresencePending?: boolean;
  onCreateAgent: () => void;
  onAddCommunity: (community: Community) => void;
  onNewMessage: () => void;
  onOpenAddCommunity: () => void;
  onOpenDm: (input: { pubkeys: string[] }) => Promise<void>;
  onOpenSearchResult: (hit: SearchHit) => void;
  onRemoveCommunity: (id: string) => void;
  onSelectAgent: (pubkey: string) => void;
  onSelectAgents: () => void;
  onSelectChannel: (channelId: string) => void;
  onSelectHome: () => void;
  onSelectProject: (projectId: string) => void;
  onSelectProjects: () => void;
  onSelectPulse: () => void;
  onSelectSettings: (section?: "profile" | "appearance") => void;
  onSendFeedback?: () => void;
  onSetPresenceStatus?: (status: "online" | "away" | "offline") => void;
  onSetUserStatus: (text: string, emoji: string) => void;
  onClearUserStatus: () => void;
  onSwitchCommunity: (id: string) => void;
  onUpdateCommunity: (
    id: string,
    updates: Partial<Pick<Community, "name" | "relayUrl" | "token">>,
  ) => void;
  [key: string]: unknown;
};

export function AppSidebar(props: AppSidebarProps) {
  const {
    activeCommunity,
    channels,
    currentPubkey,
    fallbackDisplayName,
    homeBadgeCount,
    isLoading,
    profile,
    relayConnectionCard,
    selfPresenceStatus,
    errorMessage,
    selectedChannelId,
    selectedView,
    selectedCollection,
    unreadChannelIds,
    communities,
    searchChannels,
    searchFocusRequest,
    selfUserStatus,
    isPresencePending,
    onCreateAgent,
    onNewMessage,
    onOpenAddCommunity,
    onOpenDm,
    onOpenSearchResult,
    onRemoveCommunity,
    onSelectAgent,
    onSelectAgents,
    onSelectChannel,
    onSelectHome,
    onSelectProject,
    onSelectProjects,
    onSelectPulse,
    onSelectSettings,
    onSendFeedback,
    onSetPresenceStatus,
    onSetUserStatus,
    onClearUserStatus,
    onSwitchCommunity,
    onUpdateCommunity,
  } = props;
  const {
    isMobile,
    open: sidebarOpen,
    openMobile,
    setOpenMobile,
  } = useSidebar();
  const closeMobileSidebar = React.useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);
  const activeWorkingByChannelId = useActiveWorkingChannelsById();
  const directMessages = React.useMemo(
    () => channels.filter((channel) => channel.channelType === "dm"),
    [channels],
  );
  const { dmChannelLabels } = useDmSidebarMetadata({
    currentPubkey,
    directMessages,
    enabled: true,
    fallbackDisplayName,
    profileDisplayName: profile?.displayName,
  });
  const resolvedDisplayName =
    profile?.displayName?.trim() ||
    fallbackDisplayName?.trim() ||
    "Current identity";

  return (
    <Sidebar
      className="!border-r-0"
      collapsible="offcanvas"
      data-testid="app-sidebar"
      variant="sidebar"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AppSidebarPinnedHeader
          channelLabels={dmChannelLabels}
          currentPubkey={currentPubkey}
          onCreateAgent={onCreateAgent}
          onCreateChannel={onNewMessage}
          onOpenDm={onOpenDm}
          onOpenSearchResult={onOpenSearchResult}
          onSelectChannel={onSelectChannel}
          searchChannels={searchChannels}
          searchFocusRequest={searchFocusRequest}
          suggestionChannels={channels}
        />
        <AppSidebarPrimaryMenu
          homeBadgeCount={homeBadgeCount}
          onSelectAgents={onSelectAgents}
          onSelectHome={onSelectHome}
          onSelectProjects={onSelectProjects}
          onSelectPulse={onSelectPulse}
          onSelectSettings={onSelectSettings}
          selectedView={selectedView}
        />
        <SidebarContent className="buzz-sidebar-scrollbar overscroll-none">
          {isLoading ? (
            <div className="px-4 py-3 text-sm text-sidebar-foreground/55">
              Loading chats…
            </div>
          ) : (
            <>
              <SidebarGroup
                className="px-2 py-1"
                data-testid="sidebar-chats-section"
              >
                <SidebarGroupLabel>Chats</SidebarGroupLabel>
                <SidebarGroupAction
                  aria-label="New chat"
                  data-testid="sidebar-new-chat"
                  onClick={onNewMessage}
                  title="New chat"
                  type="button"
                >
                  <Plus />
                </SidebarGroupAction>
                <ChatList
                  items={buildChatListItems({
                    channels,
                    labels: dmChannelLabels,
                    currentPubkey,
                  })}
                  onSelectChannel={onSelectChannel}
                  selectedChannelId={selectedChannelId}
                  unreadChannelIds={unreadChannelIds}
                  workingByChannelId={activeWorkingByChannelId}
                />
              </SidebarGroup>
              <LucaSidebarCollections
                onCreateAgent={onCreateAgent}
                onOpenAgents={onSelectAgents}
                onOpenProjects={onSelectProjects}
                onSelectAgent={(pubkey) => {
                  closeMobileSidebar();
                  onSelectAgent(pubkey);
                }}
                onSelectProject={(projectId) => {
                  closeMobileSidebar();
                  onSelectProject(projectId);
                }}
                selection={selectedCollection}
              />
            </>
          )}
          {errorMessage && !relayConnectionCard.hasRelayUnreachableError ? (
            <div className="px-4 py-2 text-sm text-destructive">
              {errorMessage}
            </div>
          ) : null}
        </SidebarContent>
        <SidebarFooter>
          {relayConnectionCard.showSidebarRelayConnectionCard &&
          (openMobile || sidebarOpen) ? (
            <SidebarRelayConnectionCard
              className="mb-2"
              isConnected={relayConnectionCard.isRelayConnectionSuccess}
              isReconnectPending={relayConnectionCard.isRelayReconnectPending}
              isWaitingOnReconnectHook={
                relayConnectionCard.isWaitingOnReconnectHook
              }
              onDismiss={relayConnectionCard.onDismissRelayConnectionCard}
              onReconnect={relayConnectionCard.onReconnectRelay}
            />
          ) : null}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarProfileCard
                activeCommunity={activeCommunity}
                isPresencePending={isPresencePending}
                onOpenAddCommunity={onOpenAddCommunity}
                onOpenSettings={onSelectSettings}
                onSendFeedback={onSendFeedback}
                onRemoveCommunity={onRemoveCommunity}
                onSetPresenceStatus={onSetPresenceStatus}
                onSetUserStatus={onSetUserStatus}
                onClearUserStatus={onClearUserStatus}
                onSwitchCommunity={onSwitchCommunity}
                onUpdateCommunity={onUpdateCommunity}
                profile={profile}
                resolvedDisplayName={resolvedDisplayName}
                selfPresenceStatus={selfPresenceStatus}
                selfUserStatus={selfUserStatus}
                communities={communities}
              />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </div>
    </Sidebar>
  );
}
