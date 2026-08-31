// biome-ignore format: keep compact to stay within file size limit
import * as React from "react";
import type { AppSidebarProps } from "@/features/sidebar/ui/AppSidebar.types";

import { AddCommunityDialog } from "@/features/communities/ui/AddCommunityDialog";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { useDeferredLoad } from "@/shared/hooks/useDeferredStartup";
import { useActiveWorkingChannelsById } from "@/features/sidebar/lib/useActiveWorkingChannelsById";
import { useDmSidebarMetadata } from "@/features/sidebar/useDmSidebarMetadata";
import { useSidebarScrollLock } from "@/features/sidebar/lib/useSidebarScrollLock";
import { useUnreadOverflow } from "@/features/sidebar/lib/useUnreadOverflow";
import {
  AppSidebarPinnedHeader,
  AppSidebarPrimaryMenu,
} from "@/features/sidebar/ui/AppSidebarPinnedHeader";
import { MoreUnreadButton } from "@/features/sidebar/ui/MoreUnreadButton";
import { cn } from "@/shared/lib/cn";
import { buildChatListItems, ChatList } from "@/features/sidebar/ui/ChatList";
import { LucaSidebarCollections } from "@/features/sidebar/ui/LucaSidebarCollections";
import type { RuntimeConnectionStatusV1 } from "@/shared/api/tauriMcp";
import { RuntimeRailSection } from "@/features/runtime-sessions/RuntimeRailSection";
import { RuntimeSessionsPanel } from "@/features/runtime-sessions/RuntimeSessionsPanel";
import {
  runtimeSessionContextScopeKey,
  stageRuntimeSessionContext,
} from "@/features/runtime-sessions/runtimeSessionHandoff";
import { runtimeConnectionKey } from "@/features/runtime-sessions/runtimeSessionModel";

import { CreateChannelDialog } from "@/features/sidebar/ui/CreateChannelDialog";
import { SidebarProfileCard } from "@/features/sidebar/ui/SidebarProfileCard";
import { SidebarConnectionStatusCard } from "@/features/sidebar/ui/SidebarConnectionStatusCard";
import { SidebarRelayConnectionCard } from "@/features/sidebar/ui/SidebarRelayConnectionCard";
import {
  SidebarLoadingContent,
  useSidebarLoadingShape,
} from "@/features/sidebar/ui/sidebarLoadingSkeleton";
import { useDeferredModalOpen } from "@/shared/ui/deferredModalOpen";
import { resolveSelfDisplayName } from "@/features/profile/lib/identity";
import { SidebarBackgroundTaskCard } from "@/features/sidebar/ui/SidebarBackgroundTaskCard";
import { SidebarUpdateCard } from "@/features/settings/SidebarUpdateCard";
import { useUpdaterContext } from "@/features/settings/hooks/UpdaterProvider";
import { shouldShowSidebarUpdateCard } from "@/features/settings/sidebarUpdateCardVisibility";
import type { ChannelVisibility } from "@/shared/api/types";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/shared/ui/sidebar";

type CreateChannelKind = "stream" | "forum";

export function AppSidebar({
  addCommunityPrefill,
  activeCommunity,
  channels,
  currentPubkey,
  fallbackDisplayName,
  homeBadgeCount,
  isAddCommunityOpen,
  isLoading,
  isCreatingChannel,
  isCreatingForum,
  profile,
  relayConnectionCard,
  selfPresenceStatus,
  errorMessage,
  selectedChannelId,
  selectedCollection,
  selectedView,
  unreadChannelIds,
  communities,
  onAddCommunity,
  onAddCommunityOpenChange,
  onCreateChannel,
  onCreateForum,
  onOpenAddCommunity,
  onSendFeedback,
  onMarkChannelUnread,
  onMarkChannelRead,
  onBrowseChannels,
  onOpenDm,
  onUpdateCommunity,
  onRemoveCommunity,
  onCreateAgent,
  onSelectAgent,
  onSelectAgents,
  onSelectBrain,
  onSelectArtifacts,
  onSelectInbox,
  onSelectProjects,
  onSelectPulse,
  onSelectWorkflows: _onSelectWorkflows,
  onSelectChannel,
  onSelectProject,
  onOpenSearchResult,
  searchChannels,
  searchFocusRequest,
  onSelectSettings,
  onSetPresenceStatus,
  onSetUserStatus,
  onClearUserStatus,
  onSwitchCommunity,
  selfUserStatus,
  isPresencePending,
  onNewMessage,
  isCreateChannelOpen: isCreateChannelOpenProp,
  onCreateChannelOpenChange,
}: AppSidebarProps) {
  const activeWorkingByChannelId = useActiveWorkingChannelsById();
  const { status: updateStatus } = useUpdaterContext();
  const canShowSidebarUpdateCard = shouldShowSidebarUpdateCard(updateStatus);
  const { open: sidebarOpen, openMobile, setOpenMobile } = useSidebar();
  const isMobile = useIsMobile();
  const [selectedRuntime, setSelectedRuntime] =
    React.useState<RuntimeConnectionStatusV1 | null>(null);
  const runtimeContextScope =
    currentPubkey && activeCommunity
      ? {
          communityId: activeCommunity.id,
          ownerPubkey: currentPubkey,
          relayUrl: activeCommunity.relayUrl,
        }
      : null;
  const runtimeContextScopeKey = runtimeContextScope
    ? runtimeSessionContextScopeKey(runtimeContextScope)
    : null;
  const runtimeContextScopeRef = React.useRef(runtimeContextScope);
  const selectedRuntimeRef = React.useRef(selectedRuntime);
  const pendingRuntimeSelectionRef =
    React.useRef<RuntimeConnectionStatusV1 | null>(null);
  runtimeContextScopeRef.current = runtimeContextScope;
  selectedRuntimeRef.current = selectedRuntime;
  React.useEffect(() => {
    if (selectedView === "messages") {
      const pendingRuntime = pendingRuntimeSelectionRef.current;
      if (!pendingRuntime) return;
      pendingRuntimeSelectionRef.current = null;
      selectedRuntimeRef.current = pendingRuntime;
      setSelectedRuntime(pendingRuntime);
      return;
    }

    pendingRuntimeSelectionRef.current = null;
    selectedRuntimeRef.current = null;
    setSelectedRuntime(null);
  }, [selectedView]);
  const [isSidebarUpdateCardDismissed, setIsSidebarUpdateCardDismissed] =
    React.useState(false);
  const showSidebarUpdateCard =
    canShowSidebarUpdateCard && !isSidebarUpdateCardDismissed;
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [isRoomListScrolled, setIsRoomListScrolled] = React.useState(false);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setIsRoomListScrolled(el.scrollTop > 2);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useSidebarScrollLock(scrollRef);

  React.useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;

      const maxScrollTop =
        scrollElement.scrollHeight - scrollElement.clientHeight;
      if (maxScrollTop <= 0) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const atTop = scrollElement.scrollTop <= 0;
      const atBottom = scrollElement.scrollTop >= maxScrollTop - 1;
      const scrollingPastTop = event.deltaY < 0 && atTop;
      const scrollingPastBottom = event.deltaY > 0 && atBottom;

      if (scrollingPastTop || scrollingPastBottom) {
        event.preventDefault();
        event.stopPropagation();
        scrollElement.scrollTop = scrollingPastTop ? 0 : maxScrollTop;
      }
    };

    scrollElement.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });
    return () => {
      scrollElement.removeEventListener("wheel", handleWheel, {
        capture: true,
      });
    };
  }, []);

  const [createDialogKind, setCreateDialogKind] =
    React.useState<CreateChannelKind | null>(null);
  const { openNextFrame: openModalNextFrame } = useDeferredModalOpen();
  const openCreateDialog = React.useCallback(
    (kind: CreateChannelKind) => {
      setCreateDialogKind(null);
      openModalNextFrame(() => setCreateDialogKind(kind));
    },
    [openModalNextFrame],
  );

  React.useEffect(() => {
    if (!canShowSidebarUpdateCard) {
      setIsSidebarUpdateCardDismissed(false);
    }
  }, [canShowSidebarUpdateCard]);

  // Allow the create-channel dialog to be opened from outside (e.g. the
  // ⌘⇧N global shortcut in AppShell), mirroring the controlled new-DM lift.
  // When the external flag flips on, open the "stream" create dialog; the
  // close direction is reported back via `onCreateChannelOpenChange` in the
  // dialog's `onOpenChange` below.
  React.useEffect(() => {
    if (isCreateChannelOpenProp) {
      openCreateDialog("stream");
    }
  }, [isCreateChannelOpenProp, openCreateDialog]);
  const directMessages = React.useMemo(
    () => channels.filter((channel) => channel.channelType === "dm"),
    [channels],
  );
  const isSelectedDirectMessage =
    selectedView === "channel" &&
    directMessages.some((channel) => channel.id === selectedChannelId);
  const shouldLoadDmMetadata = useDeferredLoad({
    immediate: isSelectedDirectMessage,
    timeoutMs: 400,
  });
  const { dmChannelLabels } = useDmSidebarMetadata({
    currentPubkey,
    directMessages,
    enabled: shouldLoadDmMetadata,
    fallbackDisplayName,
    profileDisplayName: profile?.displayName,
  });
  const streamChannels = React.useMemo(
    () => channels.filter((channel) => channel.channelType === "stream"),
    [channels],
  );
  const sidebarLoadingShape = useSidebarLoadingShape({
    activeCommunityId: activeCommunity?.id,
    currentPubkey,
    directMessages,
    dmChannelLabels,
    isLoading,
    streamChannels,
  });
  const resolvedDisplayName = resolveSelfDisplayName({
    identityDisplayName: fallbackDisplayName,
    profileDisplayName: profile?.displayName,
    pubkey: currentPubkey,
  });
  const {
    scrollToNextAbove,
    scrollToNextBelow,
    unreadAboveCount,
    unreadBelowCount,
  } = useUnreadOverflow({ scrollRef, unreadChannelIds });

  const isCreatingAny =
    createDialogKind === "stream"
      ? isCreatingChannel
      : createDialogKind === "forum"
        ? isCreatingForum
        : false;

  const handleCreateFromDialog = React.useCallback(
    async (
      input: {
        name: string;
        description?: string;
        visibility: ChannelVisibility;
        ttlSeconds?: number;
        templateId?: string;
      },
      onCreated?: (channelId: string) => void | Promise<void>,
    ) => {
      if (createDialogKind === "stream") {
        await onCreateChannel(input, onCreated);
      } else if (createDialogKind === "forum") {
        await onCreateForum(input);
      }
    },
    [createDialogKind, onCreateChannel, onCreateForum],
  );

  const handleOpenCreateChannel = React.useCallback(() => {
    if (onCreateChannelOpenChange) {
      onCreateChannelOpenChange(true);
      return;
    }

    openCreateDialog("stream");
  }, [onCreateChannelOpenChange, openCreateDialog]);

  const closeRuntimePanel = React.useCallback(() => {
    const selectedKey = selectedRuntime
      ? runtimeConnectionKey(selectedRuntime)
      : null;
    selectedRuntimeRef.current = null;
    setSelectedRuntime(null);
    if (isMobile) setOpenMobile(true);
    if (!selectedKey) return;
    window.requestAnimationFrame(() => {
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>(
          "[data-runtime-connection-key]",
        ),
      ].find(
        (candidate) => candidate.dataset.runtimeConnectionKey === selectedKey,
      );
      button?.focus({ preventScroll: true });
    });
  }, [isMobile, selectedRuntime, setOpenMobile]);

  const handleNewMessageNavigation = React.useCallback(() => {
    pendingRuntimeSelectionRef.current = null;
    selectedRuntimeRef.current = null;
    setSelectedRuntime(null);
    onNewMessage();
  }, [onNewMessage]);

  const handleSelectRuntime = React.useCallback(
    (runtime: RuntimeConnectionStatusV1) => {
      if (selectedView !== "messages") {
        pendingRuntimeSelectionRef.current = runtime;
        selectedRuntimeRef.current = null;
        setSelectedRuntime(null);
        onNewMessage();
      } else {
        const key = runtimeConnectionKey(runtime);
        setSelectedRuntime((current) => {
          const next =
            current && runtimeConnectionKey(current) === key ? null : runtime;
          selectedRuntimeRef.current = next;
          return next;
        });
      }
      if (isMobile) setOpenMobile(false);
    },
    [isMobile, onNewMessage, selectedView, setOpenMobile],
  );

  return React.createElement(
    React.Fragment,
    null,
    <Sidebar
      className="!border-r-0"
      // Full rail or nothing — the industry standard, and what Claude, ChatGPT,
      // Linear and Notion all do. An icon-only rail earns its place in apps with
      // many top-level destinations (Slack workspaces, VS Code activity bar,
      // Discord servers); Luca has five nav items and a resident list. And a
      // resident's sigil at 20px WITHOUT ITS NAME is not identifiable, which
      // defeats the point of an identity mark.
      collapsible="offcanvas"
      data-testid="app-sidebar"
      variant="sidebar"
    >
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        data-testid="app-sidebar-scroll-anchor"
      >
        <AppSidebarPinnedHeader
          channelLabels={dmChannelLabels}
          currentPubkey={currentPubkey}
          onBrowseChannels={onBrowseChannels}
          onCreateAgent={onCreateAgent}
          onCreateChannel={handleOpenCreateChannel}
          onOpenDm={onOpenDm}
          onOpenSearchResult={onOpenSearchResult}
          onSelectChannel={onSelectChannel}
          searchChannels={searchChannels}
          searchFocusRequest={searchFocusRequest}
          suggestionChannels={channels}
        />

        {/* Search and nav are CHROME; only the rooms scroll. They used to
            scroll away with the list, which is why the rail had no stable
            division. The hairline below is not permanent furniture — it fades
            in only once content has actually passed under it, so at rest the
            rail is unbroken. That is the detail people feel and cannot name. */}
        <div
          className={cn(
            "shrink-0 px-[3px] pb-1 transition-[border-color] duration-200",
            "border-b",
            isRoomListScrolled ? "border-border/60" : "border-transparent",
          )}
        >
          <AppSidebarPrimaryMenu
            homeBadgeCount={homeBadgeCount}
            onNewMessage={handleNewMessageNavigation}
            onSelectAgents={onSelectAgents}
            onSelectBrain={onSelectBrain}
            onSelectArtifacts={onSelectArtifacts}
            onSelectInbox={onSelectInbox}
            onSelectPulse={onSelectPulse}
            onSelectSettings={onSelectSettings}
            selectedView={selectedView}
          />
        </div>

        <div
          className="relative flex min-h-0 flex-1 flex-col"
          data-testid="sidebar-channel-content"
        >
          {unreadAboveCount > 0 ? (
            <MoreUnreadButton
              count={unreadAboveCount}
              onClick={scrollToNextAbove}
              position="top"
              testId="sidebar-more-unread-above"
            />
          ) : null}

          <SidebarContent
            className="buzz-sidebar-scrollbar overscroll-none"
            ref={scrollRef}
          >
            <div
              className="flex w-full flex-col gap-1 px-[3px]"
              data-testid="sidebar-scroll-content"
            >
              {isLoading ? (
                <SidebarLoadingContent shape={sidebarLoadingShape} />
              ) : null}

              {!isLoading ? (
                <>
                  {/* Luca navigation: loose conversations remain immediately
                      available under Rooms while projects open their contextual
                      room navigator in the main application card. */}
                  {
                    <>
                      <ChatList
                        items={buildChatListItems({
                          channels,
                          labels: dmChannelLabels,
                          currentPubkey,
                        })}
                        onSelectChannel={(channelId) => {
                          if (isMobile) setOpenMobile(false);
                          onSelectChannel(channelId);
                        }}
                        onCreateDm={handleNewMessageNavigation}
                        onMarkChannelRead={onMarkChannelRead}
                        onMarkChannelUnread={onMarkChannelUnread}
                        selectedChannelId={selectedChannelId}
                        unreadChannelIds={unreadChannelIds}
                        workingByChannelId={activeWorkingByChannelId}
                      />
                      <LucaSidebarCollections
                        onCreateAgent={onCreateAgent}
                        onOpenAgents={onSelectAgents}
                        onOpenProjects={onSelectProjects}
                        onSelectAgent={onSelectAgent}
                        onSelectProject={(projectId) =>
                          onSelectProject(projectId, null)
                        }
                        selection={selectedCollection}
                      />
                      <RuntimeRailSection
                        onSelect={handleSelectRuntime}
                        selectedRuntimeKey={
                          selectedRuntime
                            ? runtimeConnectionKey(selectedRuntime)
                            : null
                        }
                      />
                    </>
                  }
                </>
              ) : null}
            </div>
          </SidebarContent>
        </div>

        <div className="relative z-30 shrink-0" data-buzz-glass-footer-wrap>
          {unreadBelowCount > 0 ? (
            <MoreUnreadButton
              bottomClassName="bottom-full"
              count={unreadBelowCount}
              onClick={scrollToNextBelow}
              position="bottom"
              testId="sidebar-more-unread-below"
            />
          ) : null}

          <SidebarFooter>
            {/* One slot for connection state. The unreachable case and the
                answered-badly case never coexist — `useSidebarRelayConnectionCard`
                suppresses its card whenever the error is application-level —
                so they belong in the same place, wearing the same card, rather
                than one in the footer and one as loose red text halfway up the
                channel list. */}
            {errorMessage &&
            !relayConnectionCard.hasRelayUnreachableError &&
            (isMobile ? openMobile : sidebarOpen) ? (
              <SidebarConnectionStatusCard
                className="mb-2"
                errorMessage={errorMessage}
              />
            ) : null}
            {relayConnectionCard.showSidebarRelayConnectionCard &&
            (isMobile ? openMobile : sidebarOpen) ? (
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
            {(isMobile ? openMobile : sidebarOpen) ? (
              <SidebarBackgroundTaskCard className="mb-2" />
            ) : null}
            {showSidebarUpdateCard ? (
              <div className="mb-2">
                <SidebarUpdateCard
                  onDismiss={() => setIsSidebarUpdateCardDismissed(true)}
                />
              </div>
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
      </div>

      <CreateChannelDialog
        channelKind={createDialogKind}
        isCreating={isCreatingAny}
        onOpenChange={(open) => {
          if (!open) {
            // If a "stream" dialog driven by the external controller is
            // closing, report it back so AppShell's open state resets.
            if (createDialogKind === "stream") {
              onCreateChannelOpenChange?.(false);
            }
            setCreateDialogKind(null);
          }
        }}
        onCreate={handleCreateFromDialog}
      />
      <AddCommunityDialog
        prefill={addCommunityPrefill}
        onOpenChange={onAddCommunityOpenChange ?? (() => {})}
        onSubmit={onAddCommunity}
        open={isAddCommunityOpen ?? false}
      />

      <SidebarRail />
    </Sidebar>,
    <RuntimeSessionsPanel
      contextScopeKey={runtimeContextScopeKey}
      isMobile={isMobile}
      onClose={closeRuntimePanel}
      onOpenBrain={() => {
        selectedRuntimeRef.current = null;
        setSelectedRuntime(null);
        onSelectBrain();
      }}
      onStartContext={(context, authority) => {
        const currentScope = runtimeContextScopeRef.current;
        const currentRuntime = selectedRuntimeRef.current;
        if (
          !currentScope ||
          !currentRuntime ||
          authority.scopeKey !== runtimeSessionContextScopeKey(currentScope) ||
          authority.runtimeKey !== runtimeConnectionKey(currentRuntime)
        ) {
          return false;
        }
        const staged = stageRuntimeSessionContext(
          {
            ...currentScope,
            context,
          },
          authority.handoffGeneration,
        );
        if (!staged) return false;
        selectedRuntimeRef.current = null;
        setSelectedRuntime(null);
        onNewMessage();
        return true;
      }}
      runtime={selectedView === "messages" ? selectedRuntime : null}
    />,
  );
}
