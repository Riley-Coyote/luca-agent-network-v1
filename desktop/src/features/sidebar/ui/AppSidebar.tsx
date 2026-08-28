// biome-ignore format: keep compact to stay within file size limit
import * as React from "react";
import { SidebarDndContext } from "@/features/sidebar/ui/SidebarDnd";
import type { AppSidebarProps } from "@/features/sidebar/ui/AppSidebar.types";

import { AddCommunityDialog } from "@/features/communities/ui/AddCommunityDialog";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { useDeferredLoad } from "@/shared/hooks/useDeferredStartup";
import {
  useChannelSections,
  type ChannelSection,
} from "@/features/sidebar/lib/useChannelSections";
import { useActiveWorkingChannelsById } from "@/features/sidebar/lib/useActiveWorkingChannelsById";
import { useDmSidebarMetadata } from "@/features/sidebar/useDmSidebarMetadata";
import { sortDmChannelsForSidebar } from "@/features/sidebar/lib/dmSidebarSort";
import {
  sectionSortGroupKey,
  sortChannelsForSidebar,
} from "@/features/sidebar/lib/channelSortPreference";
import { useChannelSortPreference } from "@/features/sidebar/lib/useChannelSortPreference";
import { useSidebarScrollLock } from "@/features/sidebar/lib/useSidebarScrollLock";
import { useUnreadOverflow } from "@/features/sidebar/lib/useUnreadOverflow";
import {
  CreateSectionDialog,
  DeleteSectionAlertDialog,
  RenameSectionDialog,
  useDeleteChannelDialog,
  useLeaveChannelDialog,
  type SectionDialogValue,
} from "@/features/sidebar/ui/ChannelSectionDialogs";
import {
  AppSidebarPinnedHeader,
  AppSidebarPrimaryMenu,
} from "@/features/sidebar/ui/AppSidebarPinnedHeader";
import { MoreUnreadButton } from "@/features/sidebar/ui/MoreUnreadButton";
import {
  assignRoomProject,
  createEmptyRoomProject,
  useRoomProjectCatalog,
  useRoomProjects,
} from "@/features/channels/lib/roomProjects";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { requestOpenCreateAgent } from "@/features/agents/openCreateAgentEvent";
import { cn } from "@/shared/lib/cn";
import { SidebarSection } from "@/features/sidebar/ui/SidebarSection";
import { buildChatListItems, ChatList } from "@/features/sidebar/ui/ChatList";
import { CreateRoomProjectDialog } from "@/features/projects/ui/CreateRoomProjectDialog";
import { runProjectCreationTransaction } from "@/features/projects/lib/projectCreationTransaction";
import { addChannelMembers } from "@/shared/api/tauri";
import type { RuntimeConnectionStatusV1 } from "@/shared/api/tauriMcp";
import { RuntimeRailSection } from "@/features/runtime-sessions/RuntimeRailSection";
import { RuntimeSessionsPanel } from "@/features/runtime-sessions/RuntimeSessionsPanel";
import {
  runtimeSessionContextScopeKey,
  stageRuntimeSessionContext,
} from "@/features/runtime-sessions/runtimeSessionHandoff";
import { runtimeConnectionKey } from "@/features/runtime-sessions/runtimeSessionModel";

/** PROTOTYPE SWITCH. true = one recency-sorted chat list (the chat-app shape).
 *  false = the original CHANNELS / DIRECT MESSAGES sections. Kept so the two
 *  can be compared side by side before anything is deleted. */
const USE_CHAT_LIST = true;
import {
  ChannelGroupSection,
  CustomChannelSection,
  SectionActionsMenu,
  SectionQuickAction,
} from "@/features/sidebar/ui/CustomChannelSection";
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
import type { Channel, ChannelVisibility } from "@/shared/api/types";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/shared/ui/sidebar";

type CollapsibleSidebarGroup =
  | "starred"
  | "channels"
  | "forums"
  | "directMessages";

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
  selectedProjectId,
  selectedView,
  unreadChannelCounts,
  unreadChannelIds,
  communities,
  onAddCommunity,
  onAddCommunityOpenChange,
  onCreateChannel,
  onCreateForum,
  onOpenAddCommunity,
  onSendFeedback,
  onHideDm,
  onMarkChannelUnread,
  onMarkChannelRead,
  onMarkAllChannelsRead,
  onBrowseChannels,
  onOpenDm,
  onUpdateCommunity,
  onRemoveCommunity,
  onCreateAgent,
  onSelectAgents,
  onSelectBrain,
  onSelectArtifacts,
  onSelectInbox,
  onSelectProjects: _onSelectProjects,
  onSelectPulse,
  onSelectWorkflows: _onSelectWorkflows,
  onSelectHome,
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
  mutedChannelIds,
  onMuteChannel,
  onUnmuteChannel,
  starredChannelIds,
  onStarChannel,
  onUnstarChannel,
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
  const [dmActionsMenuOpen, setDmActionsMenuOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [isRoomListScrolled, setIsRoomListScrolled] = React.useState(false);
  const managedAgentsQuery = useManagedAgentsQuery();
  const projectResidentOptions = React.useMemo(
    () =>
      [...(managedAgentsQuery.data ?? [])]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((resident) => ({
          name: resident.name,
          pubkey: resident.pubkey,
          status: resident.status.replaceAll("_", " "),
        })),
    [managedAgentsQuery.data],
  );
  const roomProjects = useRoomProjects(
    channels,
    currentPubkey,
    activeCommunity?.relayUrl,
  );
  const projectCatalog = useRoomProjectCatalog(
    channels,
    currentPubkey,
    activeCommunity?.relayUrl,
  );
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
  const [isCreateProjectOpen, setIsCreateProjectOpen] = React.useState(false);
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
  const [collapsedGroups, setCollapsedGroups] = React.useState<
    Record<CollapsibleSidebarGroup, boolean>
  >({
    starred: false,
    channels: false,
    forums: false,
    directMessages: false,
  });

  const toggleCollapsedGroup = React.useCallback(
    (group: CollapsibleSidebarGroup) => {
      setCollapsedGroups((current) => ({
        ...current,
        [group]: !current[group],
      }));
    },
    [],
  );

  const [collapsedSections, setCollapsedSections] = React.useState<
    Record<string, boolean>
  >({});
  const toggleCollapsedSection = React.useCallback((sectionId: string) => {
    setCollapsedSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  }, []);

  const {
    sections: channelSections,
    assignments: channelAssignments,
    createSection,
    renameSection,
    deleteSection,
    moveSectionUp,
    moveSectionDown,
    reorderSections,
    assignChannel,
    unassignChannel,
  } = useChannelSections(currentPubkey, activeCommunity?.relayUrl);

  const sectionIds = React.useMemo(
    () => channelSections.map((s) => s.id),
    [channelSections],
  );

  const { sortModeFor, setSortModeFor } = useChannelSortPreference(
    currentPubkey,
    activeCommunity?.relayUrl,
    sectionIds,
  );

  const [createSectionState, setCreateSectionState] = React.useState<{
    open: boolean;
    pendingChannelId: string | null;
  }>({ open: false, pendingChannelId: null });
  const [renameSectionTarget, setRenameSectionTarget] =
    React.useState<ChannelSection | null>(null);
  const [deleteSectionTarget, setDeleteSectionTarget] =
    React.useState<ChannelSection | null>(null);
  const { requestLeaveChannel, dialog: leaveChannelDialog } =
    useLeaveChannelDialog();
  const { requestDeleteChannel, dialog: deleteChannelDialog } =
    useDeleteChannelDialog((channel) => {
      if (channel.id === selectedChannelId) onSelectHome();
    });

  const streamChannels = React.useMemo(
    () => channels.filter((channel) => channel.channelType === "stream"),
    [channels],
  );

  const sectionBuckets = React.useMemo(() => {
    const bySection: Record<string, Channel[]> = {};
    const unassigned: Channel[] = [];
    const sectionIds = new Set(channelSections.map((s) => s.id));

    for (const channel of streamChannels) {
      if (starredChannelIds?.has(channel.id)) continue;
      const sectionId = channelAssignments[channel.id];
      if (sectionId && sectionIds.has(sectionId)) {
        if (!bySection[sectionId]) {
          bySection[sectionId] = [];
        }
        bySection[sectionId].push(channel);
      } else {
        unassigned.push(channel);
      }
    }
    // Apply each grouping's own sort preference; section membership itself
    // is untouched.
    for (const sectionId of Object.keys(bySection)) {
      bySection[sectionId] = sortChannelsForSidebar(
        bySection[sectionId],
        sortModeFor(sectionSortGroupKey(sectionId)),
      );
    }
    return {
      bySection,
      unassigned: sortChannelsForSidebar(unassigned, sortModeFor("channels")),
    };
  }, [
    streamChannels,
    channelSections,
    channelAssignments,
    starredChannelIds,
    sortModeFor,
  ]);

  const starredChannels = React.useMemo(() => {
    if (!starredChannelIds || starredChannelIds.size === 0) return [];
    return sortChannelsForSidebar(
      streamChannels.filter((channel) => starredChannelIds.has(channel.id)),
      sortModeFor("starred"),
    );
  }, [streamChannels, starredChannelIds, sortModeFor]);

  const handleCreateSectionForChannel = React.useCallback(
    (channelId: string) => {
      setCreateSectionState({ open: true, pendingChannelId: channelId });
    },
    [],
  );

  const handleCreateSectionConfirm = React.useCallback(
    (value: SectionDialogValue) => {
      const section = createSection(value.name, value.icon);
      if (!section) {
        return;
      }
      if (createSectionState.pendingChannelId) {
        assignChannel(createSectionState.pendingChannelId, section.id);
      }
      setCreateSectionState({ open: false, pendingChannelId: null });
    },
    [createSection, assignChannel, createSectionState.pendingChannelId],
  );

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
  const { dmChannelLabels, dmParticipantsByChannelId, dmPresenceByChannelId } =
    useDmSidebarMetadata({
      currentPubkey,
      directMessages,
      enabled: shouldLoadDmMetadata,
      fallbackDisplayName,
      profileDisplayName: profile?.displayName,
    });
  const sortedDirectMessages = React.useMemo(
    () =>
      sortDmChannelsForSidebar(
        directMessages,
        dmChannelLabels,
        sortModeFor("dms"),
      ),
    [directMessages, dmChannelLabels, sortModeFor],
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

  const handleCreateChannelInSection = React.useCallback(
    (sectionId: string) => {
      onBrowseChannels?.((channelId) => assignChannel(channelId, sectionId));
    },
    [assignChannel, onBrowseChannels],
  );

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
                  {USE_CHAT_LIST ? (
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
                        onSelectProject={(projectId, preferredRoomId) => {
                          if (isMobile) setOpenMobile(false);
                          onSelectProject(projectId, preferredRoomId);
                        }}
                        onCreateProject={() => setIsCreateProjectOpen(true)}
                        onCreateDm={handleNewMessageNavigation}
                        onMarkChannelRead={onMarkChannelRead}
                        onMarkChannelUnread={onMarkChannelUnread}
                        projectByChannelId={roomProjects}
                        projects={projectCatalog}
                        selectedChannelId={selectedChannelId}
                        selectedProjectId={selectedProjectId}
                        unreadChannelIds={unreadChannelIds}
                        workingByChannelId={activeWorkingByChannelId}
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
                  ) : (
                    <>
                      {starredChannels.length > 0 ? (
                        <ChannelGroupSection
                          hasUnread={starredChannels.some((c) =>
                            unreadChannelIds.has(c.id),
                          )}
                          isCollapsed={collapsedGroups.starred}
                          isActiveChannel={selectedView === "channel"}
                          activeWorkingByChannelId={activeWorkingByChannelId}
                          items={starredChannels}
                          sortMode={sortModeFor("starred")}
                          onSortModeChange={(mode) =>
                            setSortModeFor("starred", mode)
                          }
                          actionsTestId="section-actions-starred"
                          listTestId="starred-list"
                          onMarkAllRead={() => {
                            for (const channel of starredChannels) {
                              onMarkChannelRead(
                                channel.id,
                                channel.lastMessageAt,
                              );
                            }
                          }}
                          onMarkChannelRead={onMarkChannelRead}
                          onMarkChannelUnread={onMarkChannelUnread}
                          onSelectChannel={onSelectChannel}
                          onToggleCollapsed={() =>
                            toggleCollapsedGroup("starred")
                          }
                          selectedChannelId={selectedChannelId}
                          title="Starred"
                          unreadChannelCounts={unreadChannelCounts}
                          unreadChannelIds={unreadChannelIds}
                          mutedChannelIds={mutedChannelIds}
                          onMuteChannel={onMuteChannel}
                          onUnmuteChannel={onUnmuteChannel}
                          starredChannelIds={starredChannelIds}
                          onStarChannel={onStarChannel}
                          onUnstarChannel={onUnstarChannel}
                          onDeleteChannel={requestDeleteChannel}
                          onLeaveChannel={requestLeaveChannel}
                        />
                      ) : null}
                      <SidebarDndContext
                        channels={channels}
                        sections={channelSections}
                        sectionIds={sectionIds}
                        onAssignChannel={assignChannel}
                        onUnassignChannel={unassignChannel}
                        onReorderSections={reorderSections}
                      >
                        {channelSections.map((section, idx) => (
                          <CustomChannelSection
                            key={section.id}
                            section={section}
                            channels={
                              sectionBuckets.bySection[section.id] ?? []
                            }
                            hasUnread={
                              sectionBuckets.bySection[section.id]?.some((c) =>
                                unreadChannelIds.has(c.id),
                              ) ?? false
                            }
                            isCollapsed={collapsedSections[section.id] ?? false}
                            isActiveChannel={selectedView === "channel"}
                            activeWorkingByChannelId={activeWorkingByChannelId}
                            selectedChannelId={selectedChannelId}
                            unreadChannelCounts={unreadChannelCounts}
                            unreadChannelIds={unreadChannelIds}
                            sections={channelSections}
                            assignments={channelAssignments}
                            isFirst={idx === 0}
                            isLast={idx === channelSections.length - 1}
                            sortMode={sortModeFor(
                              sectionSortGroupKey(section.id),
                            )}
                            onSortModeChange={(mode) =>
                              setSortModeFor(
                                sectionSortGroupKey(section.id),
                                mode,
                              )
                            }
                            onToggleCollapsed={() =>
                              toggleCollapsedSection(section.id)
                            }
                            onSelectChannel={onSelectChannel}
                            onMarkChannelRead={onMarkChannelRead}
                            onMarkChannelUnread={onMarkChannelUnread}
                            onMarkSectionRead={() => {
                              for (const channel of sectionBuckets.bySection[
                                section.id
                              ] ?? []) {
                                onMarkChannelRead(
                                  channel.id,
                                  channel.lastMessageAt,
                                );
                              }
                            }}
                            onAssignChannel={assignChannel}
                            onUnassignChannel={unassignChannel}
                            onCreateSectionForChannel={
                              handleCreateSectionForChannel
                            }
                            onCreateChannel={() =>
                              handleCreateChannelInSection(section.id)
                            }
                            onRenameSection={() =>
                              setRenameSectionTarget(section)
                            }
                            onDeleteSection={() =>
                              setDeleteSectionTarget(section)
                            }
                            onMoveSectionUp={() => moveSectionUp(section.id)}
                            onMoveSectionDown={() =>
                              moveSectionDown(section.id)
                            }
                            mutedChannelIds={mutedChannelIds}
                            onMuteChannel={onMuteChannel}
                            onUnmuteChannel={onUnmuteChannel}
                            starredChannelIds={starredChannelIds}
                            onStarChannel={onStarChannel}
                            onUnstarChannel={onUnstarChannel}
                            onDeleteChannel={requestDeleteChannel}
                            onLeaveChannel={requestLeaveChannel}
                          />
                        ))}
                        <ChannelGroupSection
                          draggable
                          hasUnread={unreadChannelIds.size > 0}
                          isCollapsed={collapsedGroups.channels}
                          isActiveChannel={selectedView === "channel"}
                          activeWorkingByChannelId={activeWorkingByChannelId}
                          items={sectionBuckets.unassigned}
                          sortMode={sortModeFor("channels")}
                          onSortModeChange={(mode) =>
                            setSortModeFor("channels", mode)
                          }
                          actionsTestId="section-actions-channels"
                          listTestId="stream-list"
                          quickCreateLabel="Browse channels"
                          onQuickCreateClick={() => onBrowseChannels?.()}
                          showQuickCreate
                          onMarkAllRead={onMarkAllChannelsRead}
                          onMarkChannelRead={onMarkChannelRead}
                          onMarkChannelUnread={onMarkChannelUnread}
                          onSelectChannel={onSelectChannel}
                          onToggleCollapsed={() =>
                            toggleCollapsedGroup("channels")
                          }
                          selectedChannelId={selectedChannelId}
                          title="Channels"
                          unreadChannelCounts={unreadChannelCounts}
                          unreadChannelIds={unreadChannelIds}
                          sections={channelSections}
                          assignments={channelAssignments}
                          onAssignChannel={assignChannel}
                          onUnassignChannel={unassignChannel}
                          onCreateSectionForChannel={
                            handleCreateSectionForChannel
                          }
                          mutedChannelIds={mutedChannelIds}
                          onMuteChannel={onMuteChannel}
                          onUnmuteChannel={onUnmuteChannel}
                          starredChannelIds={starredChannelIds}
                          onStarChannel={onStarChannel}
                          onUnstarChannel={onUnstarChannel}
                          onDeleteChannel={requestDeleteChannel}
                          onLeaveChannel={requestLeaveChannel}
                        />
                      </SidebarDndContext>
                      <SidebarSection
                        action={
                          <div className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5">
                            <SectionQuickAction
                              label="New message"
                              onClick={handleNewMessageNavigation}
                              testId="section-actions-dms-quick-create"
                            />
                            <SectionActionsMenu
                              sectionLabel="direct messages"
                              testId="section-actions-dms"
                              onOpenChange={setDmActionsMenuOpen}
                              onNewMessage={handleNewMessageNavigation}
                              sortMode={sortModeFor("dms")}
                              onSortModeChange={(mode) =>
                                setSortModeFor("dms", mode)
                              }
                            />
                          </div>
                        }
                        dmParticipantsByChannelId={dmParticipantsByChannelId}
                        isCollapsed={collapsedGroups.directMessages}
                        isActiveChannel={selectedView === "channel"}
                        activeWorkingByChannelId={activeWorkingByChannelId}
                        items={sortedDirectMessages}
                        channelLabels={dmChannelLabels}
                        onHideDm={onHideDm}
                        onMarkChannelRead={onMarkChannelRead}
                        onMarkChannelUnread={onMarkChannelUnread}
                        onSelectChannel={onSelectChannel}
                        onToggleCollapsed={() =>
                          toggleCollapsedGroup("directMessages")
                        }
                        presenceByChannelId={dmPresenceByChannelId}
                        selectedChannelId={selectedChannelId}
                        testId="dm-list"
                        title="Direct messages"
                        sectionActionsOpen={dmActionsMenuOpen}
                        unreadChannelCounts={unreadChannelCounts}
                        unreadChannelIds={unreadChannelIds}
                        mutedChannelIds={mutedChannelIds}
                        onMuteChannel={onMuteChannel}
                        onUnmuteChannel={onUnmuteChannel}
                      />
                    </>
                  )}
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
      <CreateRoomProjectDialog
        isCreating={isCreatingChannel}
        onCreate={async (draft, checkpoint) => {
          if (!currentPubkey)
            throw new Error("Your identity is still loading.");
          return runProjectCreationTransaction(draft, checkpoint, {
            createProject: ({ label, sourceIds }) =>
              createEmptyRoomProject(currentPubkey, activeCommunity?.relayUrl, {
                label,
                sourceIds,
              }),
            createRoom: (input, onCreated) =>
              onCreateChannel(
                {
                  ...input,
                  visibility: "private",
                },
                onCreated,
              ),
            assignRoom: (channelId, projectId) =>
              assignRoomProject(
                currentPubkey,
                activeCommunity?.relayUrl,
                channelId,
                projectId,
              ),
            addResidents: (channelId, pubkeys) =>
              addChannelMembers({ channelId, pubkeys, role: "bot" }),
            requestNewResident: ({ channelId, channelName }) => {
              requestOpenCreateAgent({ channelId, channelName });
            },
          });
        }}
        onOpenChange={setIsCreateProjectOpen}
        open={isCreateProjectOpen}
        residentOptions={projectResidentOptions}
        residentsLoading={managedAgentsQuery.isLoading}
      />

      <AddCommunityDialog
        prefill={addCommunityPrefill}
        onOpenChange={onAddCommunityOpenChange ?? (() => {})}
        onSubmit={onAddCommunity}
        open={isAddCommunityOpen ?? false}
      />

      <CreateSectionDialog
        open={createSectionState.open}
        onOpenChange={(open) => {
          if (!open) {
            setCreateSectionState({ open: false, pendingChannelId: null });
          }
        }}
        onConfirm={handleCreateSectionConfirm}
      />

      <RenameSectionDialog
        open={renameSectionTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameSectionTarget(null);
        }}
        sectionName={renameSectionTarget?.name ?? ""}
        sectionIcon={renameSectionTarget?.icon}
        onConfirm={(value) => {
          if (renameSectionTarget) {
            renameSection(renameSectionTarget.id, value.name, value.icon);
          }
          setRenameSectionTarget(null);
        }}
      />

      <DeleteSectionAlertDialog
        open={deleteSectionTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteSectionTarget(null);
        }}
        sectionName={deleteSectionTarget?.name ?? ""}
        channelCount={
          deleteSectionTarget
            ? (sectionBuckets.bySection[deleteSectionTarget.id]?.length ?? 0)
            : 0
        }
        onConfirm={() => {
          if (deleteSectionTarget) {
            deleteSection(deleteSectionTarget.id);
            setCollapsedSections((prev) => {
              const next = { ...prev };
              delete next[deleteSectionTarget.id];
              return next;
            });
          }
          setDeleteSectionTarget(null);
        }}
      />
      {deleteChannelDialog}
      {leaveChannelDialog}
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
