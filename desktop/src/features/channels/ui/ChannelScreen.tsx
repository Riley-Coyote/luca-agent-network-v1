import * as React from "react";
import { useAppShell } from "@/app/AppShellContext";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useActiveChannelHeader } from "@/features/channels/useActiveChannelHeader";
import { useChannelPaneHandlers } from "@/features/channels/useChannelPaneHandlers";
import { useMessageEventProfilePubkeys } from "@/features/channels/useMessageEventProfilePubkeys";
import { useMessageOwnerProfiles } from "@/features/channels/useMessageOwnerProfiles";
import { useThreadTargetSync } from "@/features/channels/useThreadTargetSync";
import {
  useChannelMembersQuery,
  useJoinChannelMutation,
} from "@/features/channels/hooks";
import { ChannelScreenEmptyState } from "@/features/channels/ui/ChannelScreenEmptyState";
import { ChannelScreenHeader } from "@/features/channels/ui/ChannelScreenHeader";
import { openVisitors } from "@/features/messages/lib/visitSpans";
import { ChannelPane } from "@/features/channels/ui/ChannelPane";
import { WelcomeAgentCreateDialog } from "@/features/channels/ui/WelcomeAgentCreateDialog";
import { ForumChannelContent } from "@/features/channels/ui/ForumChannelContent";
import {
  latestLiveExchangeAfter,
  useRoomExchangeHistory,
} from "@/features/exchange/exchangeStore";
import { MembersSidebar } from "@/features/channels/ui/MembersSidebar";
import {
  useManagedAgentsQuery,
  useRelayAgentsQuery,
} from "@/features/agents/hooks";
import { mergeChannelKnownAgentPubkeys } from "@/features/agents/knownAgentPubkeys";
import { useKnownAgentPubkeys } from "@/features/agents/useKnownAgentPubkeys";
import { pickWelcomeGuideAgent } from "@/features/onboarding/welcomeGuide";
import { useWelcomeKickoffEntrance } from "@/features/onboarding/useWelcomeKickoffEntrance";
import { useWelcomeKickoffStagePresence } from "@/features/onboarding/useWelcomeKickoffStagePresence";
import { useWelcomeAgentCreate } from "@/features/channels/useWelcomeAgentCreate";
import {
  useChannelMessagesQuery,
  useChannelSubscription,
  useChannelWindowQuery,
  useDeleteMessageMutation,
  useEditMessageMutation,
  useSendMessageMutation,
  useToggleReactionMutation,
} from "@/features/messages/hooks";
import { formatTimelineMessages } from "@/features/messages/lib/formatTimelineMessages";
import { resolveThreadQueryRootId } from "@/features/messages/lib/independentThreadPanel";
import {
  channelWindowThreadSummaries,
  type ChannelWindowThreadSummary,
} from "@/features/messages/lib/channelWindowStore";
import { imetaMediaFromTags } from "@/features/messages/lib/imetaMediaMarkdown";
import {
  resolveTimelineLoadingLatch,
  selectTimelineLoadingState,
} from "@/features/messages/lib/timelineLoadingState";
import { useFetchOlderMessages } from "@/features/messages/useFetchOlderMessages";
import { useIndependentThreadPanel } from "@/features/messages/useIndependentThreadPanel";
import { useThreadReplies } from "@/features/messages/useThreadReplies";
import { useChannelTyping } from "@/features/messages/useChannelTyping";
import type { TimelineMessage } from "@/features/messages/types";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useRelaySelfQuery } from "@/features/moderation/hooks";
import type { RelayEvent } from "@/shared/api/types";
import { useChannelFind } from "@/features/search/useChannelFind";
import { AgentSessionProvider } from "@/shared/context/AgentSessionContext";
import { ProfilePanelProvider } from "@/shared/context/ProfilePanelContext";
import {
  useMainInsetRef,
  useMainInsetWidth,
} from "@/shared/layout/MainInsetContext";
import { channelContentTopPaddingMeasurement } from "@/shared/layout/chromeLayout";
import { useMeasuredCssVariable } from "@/shared/layout/useMeasuredCssVariable";
import { useIsMobile, useMediaBreakpoint } from "@/shared/hooks/use-mobile";
import { useThreadPanelWidth } from "@/shared/hooks/useThreadPanelWidth";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { useChannelActivityTyping } from "./useChannelActivityTyping";
import { useChannelAgentSessions } from "./useChannelAgentSessions";
import { useMessageProfiles } from "./useMessageProfiles";
import { useChannelPanelHistoryState } from "./useChannelPanelHistoryState";
import { useChannelProfilePanel } from "./useChannelProfilePanel";
import { useChannelRouteTarget } from "./useChannelRouteTarget";
import { useChannelUnreadState } from "./useChannelUnreadState";
import { useActiveChannelReadSync } from "./useActiveChannelReadSync";
import { useResolvedChannelMessages } from "./useResolvedChannelMessages";
import { useChannelPersonaLookups } from "./useChannelPersonaLookups";
import {
  PROJECT_NAVIGATOR_COMPACT_MAX_VIEWPORT_PX,
  resolveChannelShellLayout,
} from "./channelShellLayout";
import type { ChannelScreenProps } from "./ChannelScreen.types";
const EMPTY_RELAY_EVENTS: RelayEvent[] = [];
export function ChannelScreen({
  activeChannel,
  autoSendDraftKey,
  currentIdentity,
  currentProfile,
  projectContext,
  projectNavigatorVisible,
  shellWidthPx,
  onCloseForumPost,
  onSelectForumPost,
  selectedForumPostId,
  targetForumReplyId,
  targetMessageEvents,
  targetMessageId,
}: ChannelScreenProps) {
  const { goHome } = useAppNavigation();
  const {
    markChannelRead,
    markChannelUnread,
    getChannelReadAt,
    getMessageReadAt,
    markMessageRead,
    setContextParentResolver,
    openBrowseChannels,
    openCreateChannel,
    openChannelManagement: openGlobalChannelManagement,
    followThread,
    unfollowThread,
    isFollowingThread,
    isNotifiedForThread,
    isThreadMuted,
    readStateVersion,
  } = useAppShell();
  const {
    channelManagementOpen,
    clearAutoSend,
    clearMessageRouteTarget,
    openAgentSessionChannelId,
    openAgentSessionPubkey,
    openThreadHeadId,
    profilePanelPubkey,
    profilePanelTab,
    profilePanelView,
    setChannelManagementOpen,
    setOpenAgentSessionChannelId,
    setOpenAgentSessionPubkey,
    setOpenThreadHeadId,
    setProfilePanelTab,
    setProfilePanelPubkey,
    setProfilePanelView,
  } = useChannelPanelHistoryState();
  const {
    canReset: canResetThreadPanelWidth,
    onResetWidth: handleThreadPanelWidthReset,
    onResizeStart: handleThreadPanelResizeStart,
    widthPx: threadPanelWidthPx,
  } = useThreadPanelWidth();
  const [isMembersSidebarOpen, setIsMembersSidebarOpen] = React.useState(false);
  const [isConversationContextOpen, setIsConversationContextOpen] =
    React.useState(false);
  const [requestedExchangeId, setRequestedExchangeId] = React.useState<
    string | null
  >(null);
  const [isAddBotOpen, setIsAddBotOpen] = React.useState(false);
  const [expandedThreadReplyIds, setExpandedThreadReplyIds] = React.useState(
    () => new Set<string>(),
  );
  const [threadScrollTargetId, setThreadScrollTargetId] = React.useState<
    string | null
  >(null);
  const [threadReplyTargetId, setThreadReplyTargetId] = React.useState<
    string | null
  >(null);
  const [directedReplyTargetId, setDirectedReplyTargetId] = React.useState<
    string | null
  >(null);
  const [editTargetId, setEditTargetId] = React.useState<string | null>(null);
  // URL-backed thread state catches up after navigation; this override keeps urgent open/close renders responsive.
  const [optimisticOpenThreadHeadId, setOptimisticOpenThreadHeadId] =
    React.useState<string | null | undefined>(undefined);
  const clearOptimisticThreadOverride = React.useCallback(() => {
    setOptimisticOpenThreadHeadId(undefined);
  }, []);
  const mainInsetRef = useMainInsetRef();
  const mainInsetWidthPx = useMainInsetWidth();
  const stableShellWidthPx = shellWidthPx ?? mainInsetWidthPx;
  const isMobileViewport = useIsMobile();
  const isCompactProjectNavigator = useMediaBreakpoint(
    PROJECT_NAVIGATOR_COMPACT_MAX_VIEWPORT_PX + 1,
  );
  const currentPubkey = currentIdentity?.pubkey;
  const activeChannelId = activeChannel?.id ?? null;
  const roomExchangeHistory = useRoomExchangeHistory(activeChannelId);
  const relaySelfPubkey = useRelaySelfQuery(activeChannel !== null).data;
  const effectiveOpenThreadHeadId =
    optimisticOpenThreadHeadId === undefined
      ? openThreadHeadId
      : optimisticOpenThreadHeadId;
  const isNotifiedForEffectiveThread =
    effectiveOpenThreadHeadId != null
      ? isNotifiedForThread(effectiveOpenThreadHeadId)
      : false;
  const previousActiveChannelIdRef = React.useRef(activeChannelId);
  React.useEffect(() => {
    const didChangeChannel =
      previousActiveChannelIdRef.current !== activeChannelId;
    previousActiveChannelIdRef.current = activeChannelId;
    if (didChangeChannel) setDirectedReplyTargetId(null);
    setOptimisticOpenThreadHeadId((current) => {
      if (current === undefined) {
        return current;
      }
      return didChangeChannel || openThreadHeadId === current
        ? undefined
        : current;
    });
  }, [activeChannelId, openThreadHeadId]);
  const messagesQuery = useChannelMessagesQuery(activeChannel);
  const windowQuery = useChannelWindowQuery(activeChannel);
  const { handleFindSearchHit, resolvedMessages } = useResolvedChannelMessages({
    activeChannel,
    messages: messagesQuery.data,
    targetMessageEvents,
  });
  const threadQueryRootId = React.useMemo(
    () => resolveThreadQueryRootId(resolvedMessages, effectiveOpenThreadHeadId),
    [effectiveOpenThreadHeadId, resolvedMessages],
  );
  const threadRepliesQuery = useThreadReplies(activeChannel, threadQueryRootId);
  useChannelSubscription(activeChannel);
  const { fetchOlder, hasOlderMessages, historyExhausted, isFetchingOlder } =
    useFetchOlderMessages(activeChannel);
  useActiveChannelReadSync({
    activeChannelId,
    isMember: activeChannel?.isMember,
    markChannelRead,
    messages: messagesQuery.data,
    setContextParentResolver,
  });
  const {
    activeChannelTitle,
    activeDmAvatarUrl,
    activeDmHeaderParticipants,
    activeDmPresenceStatus,
    activeChannelEphemeralDisplay,
  } = useActiveChannelHeader(activeChannel, currentPubkey);
  const toggleReactionMutation = useToggleReactionMutation();
  const deleteMessageMutation = useDeleteMessageMutation(activeChannel);
  const editMessageMutation = useEditMessageMutation(activeChannel);
  const joinChannelMutation = useJoinChannelMutation(activeChannelId);
  const threadReplyEvents = threadRepliesQuery.data ?? EMPTY_RELAY_EVENTS;
  const {
    entranceMessageId: welcomeEntranceMessageId,
    handleEntranceComplete: handleWelcomeEntranceComplete,
  } = useWelcomeKickoffEntrance(
    activeChannel,
    resolvedMessages,
    threadReplyEvents,
  );

  const messageEventProfilePubkeys = useMessageEventProfilePubkeys(
    resolvedMessages,
    threadReplyEvents,
    relaySelfPubkey,
  );
  const latestMessageEvent = React.useMemo(
    () => resolvedMessages[resolvedMessages.length - 1] ?? null,
    [resolvedMessages],
  );
  const typingEntries = useChannelTyping(
    activeChannel,
    currentPubkey,
    latestMessageEvent,
    relaySelfPubkey,
  );
  const activeDmParticipantPubkeys = React.useMemo(
    () =>
      activeChannel?.channelType === "dm"
        ? activeChannel.participantPubkeys
        : [],
    [activeChannel],
  );
  const channelMembersQuery = useChannelMembersQuery(activeChannel?.id ?? null);
  const channelMembers = channelMembersQuery.data;
  const managedAgentsQuery = useManagedAgentsQuery();
  const managedAgents = managedAgentsQuery.data ?? [];
  const managedResidentPubkeys = React.useMemo(
    () => new Set(managedAgents.map((agent) => normalizePubkey(agent.pubkey))),
    [managedAgents],
  );
  const welcomeGuideAgent = React.useMemo(
    () => pickWelcomeGuideAgent(managedAgents),
    [managedAgents],
  );
  const welcomeAgentCreate = useWelcomeAgentCreate({
    activeChannel,
    currentIdentity,
    welcomeGuideAgent,
  });
  const relayAgentsQuery = useRelayAgentsQuery();
  const relayAgents = relayAgentsQuery.data ?? [];
  const knownAgentPubkeys = React.useMemo(
    () =>
      mergeChannelKnownAgentPubkeys(channelMembers, managedAgents, relayAgents),
    [channelMembers, managedAgents, relayAgents],
  );
  const messageProfilePubkeys = React.useMemo(
    () => [
      ...new Set([
        ...messageEventProfilePubkeys,
        ...activeDmParticipantPubkeys,
        ...knownAgentPubkeys,
        ...typingEntries.map((entry) => entry.pubkey),
      ]),
    ],
    [
      activeDmParticipantPubkeys,
      knownAgentPubkeys,
      messageEventProfilePubkeys,
      typingEntries,
    ],
  );
  const messageProfilesQuery = useUsersBatchQuery(messageProfilePubkeys, {
    enabled: messageProfilePubkeys.length > 0,
  });
  const agentPubkeysPending =
    activeChannel?.channelType === "dm" &&
    (channelMembersQuery.isPending ||
      managedAgentsQuery.isPending ||
      relayAgentsQuery.isPending ||
      (messageProfilePubkeys.length > 0 &&
        (messageProfilesQuery.isPending ||
          messageProfilesQuery.isPlaceholderData)));
  const {
    agentSessionCandidates,
    botTypingEntries,
    humanTypingPubkeys,
    threadTypingPubkeys,
  } = useChannelActivityTyping({
    activeChannel,
    activeChannelId,
    channelMembers,
    managedAgents,
    openThreadHeadId: effectiveOpenThreadHeadId,
    relayAgents,
    typingEntries,
  });
  const messageProfiles = useMessageProfiles({
    channelMembers,
    currentProfile,
    currentPubkey,
    managedAgents,
    profiles: messageProfilesQuery.data?.profiles,
    relayAgents,
  });
  const messageOwnerProfiles = useMessageOwnerProfiles(messageProfiles);
  // Agent set for ChannelPane's own consumers (DM huddle member resolution,
  // the agents list): the community-scoped baseline shared by every surface,
  // widened with channel-member roles and this screen's profile lookup.
  // Message rows no longer take this — MessageRow derives agent-ness itself
  // from useKnownAgentPubkeys + per-pubkey profile checks.
  const communityAgentPubkeys = useKnownAgentPubkeys();
  const agentPubkeys = React.useMemo(() => {
    const pubkeys = new Set([...communityAgentPubkeys, ...knownAgentPubkeys]);
    for (const [pubkey, profile] of Object.entries(messageProfiles)) {
      if (profile.isAgent) {
        pubkeys.add(normalizePubkey(pubkey));
      }
    }
    return pubkeys;
  }, [knownAgentPubkeys, messageProfiles, communityAgentPubkeys]);
  const { personaLookup, residentPersonaIdLookup, respondToLookup } =
    useChannelPersonaLookups(managedAgentsQuery.data);
  const timelineMessages = React.useMemo(
    () =>
      formatTimelineMessages(
        resolvedMessages,
        activeChannel,
        currentPubkey,
        currentProfile?.avatarUrl ?? null,
        messageProfiles,
        channelMembers,
        personaLookup,
        respondToLookup,
        relaySelfPubkey,
        messageOwnerProfiles,
        residentPersonaIdLookup,
      ),
    [
      activeChannel,
      channelMembers,
      currentProfile?.avatarUrl,
      currentPubkey,
      messageProfiles,
      residentPersonaIdLookup,
      messageOwnerProfiles,
      personaLookup,
      relaySelfPubkey,
      respondToLookup,
      resolvedMessages,
    ],
  );
  // Use the same formatted timeline that renders the visit affordance as the
  // client-side activation source. The trusted send command independently
  // enforces this boundary from its persisted visit store.
  const visitorPubkeys = React.useMemo(
    () => openVisitors(timelineMessages),
    [timelineMessages],
  );
  const sendMessageMutation = useSendMessageMutation(
    activeChannel,
    currentIdentity,
    managedResidentPubkeys,
    visitorPubkeys,
  );
  const threadSummaries: ReadonlyMap<string, ChannelWindowThreadSummary> =
    React.useMemo(
      () =>
        windowQuery.data
          ? channelWindowThreadSummaries(windowQuery.data)
          : new Map(),
      [windowQuery.data],
    );
  const channelFind = useChannelFind({
    channelId: activeChannelId,
    messages: timelineMessages,
    onSearchHit: handleFindSearchHit,
  });
  const threadPanelData = useIndependentThreadPanel({
    activeChannel,
    channelEvents: resolvedMessages,
    threadReplyEvents,
    rootId: effectiveOpenThreadHeadId,
    replyTargetId: threadReplyTargetId,
    expandedReplyIds: expandedThreadReplyIds,
    currentPubkey,
    currentAvatarUrl: currentProfile?.avatarUrl ?? null,
    profiles: messageProfiles,
    ownerProfiles: messageOwnerProfiles,
    members: channelMembers,
    personaLookup,
    respondToLookup,
    residentPersonaIdLookup,
    relaySelfPubkey,
  });
  const {
    firstUnreadMessageId,
    getFirstReplyIdForMessage,
    getReplyDescendantIdsForMessage,
    handleMarkMessageRead,
    handleMarkMessageUnread,
    isMessageUnread,
    markRevealedRepliesRead,
    openThreadHeadMessage,
    threadFirstUnreadReplyId,
    threadReplyTargetMessage,
    threadReplyUnreadCounts,
    threadUnreadCounts,
    unreadCount,
  } = useChannelUnreadState({
    activeChannelId,
    timelineMessages,
    currentPubkey,
    openThreadHeadId: effectiveOpenThreadHeadId,
    threadReplyTargetId,
    expandedThreadReplyIds,
    openThreadMessages: threadPanelData.visibleReplies,
    getChannelReadAt,
    getMessageReadAt,
    markChannelUnread,
    markMessageRead,
    isThreadMuted,
    readStateVersion,
  });
  const editTargetMessage = React.useMemo(
    () =>
      timelineMessages.find((message) => message.id === editTargetId) ?? null,
    [editTargetId, timelineMessages],
  );
  const directedReplyTargetMessage = React.useMemo(
    () =>
      timelineMessages.find(
        (message) => message.id === directedReplyTargetId,
      ) ?? null,
    [directedReplyTargetId, timelineMessages],
  );
  const {
    handleCancelDirectedReply,
    handleCancelEdit,
    handleCancelThreadReply,
    handleCloseThread,
    handleDelete,
    handleEdit,
    handleEditSave,
    handleExpandThreadReplies,
    handleOpenThread,
    handleSendMessage,
    handleSendDirectedReply,
    handleSendThreadReply,
    handleSelectThreadReplyTarget,
    handleSelectDirectedReplyTarget,
    handleToggleReaction,
  } = useChannelPaneHandlers({
    deleteMessageMutation,
    directedReplyTargetMessage,
    editMessageMutation,
    editTargetId,
    expandedThreadReplyIds,
    getFirstReplyIdForMessage,
    getReplyDescendantIdsForMessage,
    markRevealedRepliesRead,
    openThreadHeadId: effectiveOpenThreadHeadId,
    onOptimisticOpenThreadHeadIdChange: setOptimisticOpenThreadHeadId,
    sendMessageMutation,
    setExpandedThreadReplyIds,
    setEditTargetId,
    setDirectedReplyTargetId,
    setOpenThreadHeadId,
    setThreadReplyTargetId,
    setThreadScrollTargetId,
    threadReplyTargetId,
    toggleReactionMutation,
  });
  const effectiveToggleReaction = React.useMemo(
    () =>
      activeChannel && !activeChannel.archivedAt && activeChannel.isMember
        ? handleToggleReaction
        : undefined,
    [activeChannel, handleToggleReaction],
  );
  const handleMessageMarkUnread = React.useCallback(
    (message: TimelineMessage) => handleMarkMessageUnread(message.id),
    [handleMarkMessageUnread],
  );
  const handleMessageMarkRead = React.useCallback(
    (message: TimelineMessage) => handleMarkMessageRead(message.id),
    [handleMarkMessageRead],
  );
  const sendMessageMutateAsync = sendMessageMutation.mutateAsync;
  const handleSendVideoReviewComment = React.useCallback(
    async (
      message: { id: string },
      content: string,
      mentionPubkeys: string[],
      mediaTags?: string[][],
      parentEventId?: string,
    ) => {
      await sendMessageMutateAsync({
        content,
        mediaTags,
        mentionPubkeys,
        parentEventId: parentEventId ?? message.id,
      });
    },
    [sendMessageMutateAsync],
  );
  const effectiveSendVideoReviewComment =
    activeChannel && !activeChannel.archivedAt && activeChannel.isMember
      ? handleSendVideoReviewComment
      : undefined;
  const handleOpenAddBot = React.useCallback(
    (options?: { beforeSend?: () => void }) =>
      welcomeAgentCreate.openAddAgent(() => setIsAddBotOpen(true), options),
    [welcomeAgentCreate],
  );
  const handleOpenMembersSidebar = React.useCallback(
    () => setIsMembersSidebarOpen(true),
    [],
  );
  const handleCloseChannelManagement = React.useCallback(
    () => setChannelManagementOpen(false),
    [setChannelManagementOpen],
  );
  const handleChannelManagementDeleted = React.useCallback(() => {
    setChannelManagementOpen(false);
    void goHome({ replace: true });
  }, [setChannelManagementOpen, goHome]);
  const {
    agentSessionAgents,
    backFromAgentSession: handleBackFromAgentSession,
    channelAgentSessionAgents,
    closeAgentSession: handleCloseAgentSession,
    hasAgentSessionReturnTarget,
    openAgentSession: handleOpenAgentSession,
    openThreadAndCloseAgentSession: handleOpenThreadAndCloseAgentSession,
  } = useChannelAgentSessions({
    activeChannel,
    activeChannelId,
    agentsLoaded:
      !channelMembersQuery.isLoading &&
      !managedAgentsQuery.isLoading &&
      !relayAgentsQuery.isLoading,
    channelMembers,
    handleOpenThread,
    managedAgents: agentSessionCandidates,
    openAgentSessionPubkey,
    openThreadHeadId: effectiveOpenThreadHeadId,
    profilePanelPubkey,
    setChannelManagementOpen,
    setExpandedThreadReplyIds,
    setOpenAgentSessionChannelId,
    setOpenAgentSessionPubkey,
    setOpenThreadHeadId,
    setProfilePanelPubkey,
    setThreadReplyTargetId,
    setThreadScrollTargetId,
  });
  const { handleOpenProfilePanel, handleCloseProfilePanel, handleOpenDm } =
    useChannelProfilePanel({
      closeAgentSession: handleCloseAgentSession,
      setChannelManagementOpen,
      setConversationContextOpen: setIsConversationContextOpen,
      setExpandedThreadReplyIds,
      setOpenThreadHeadId,
      setProfilePanelPubkey,
      setProfilePanelTab,
      setThreadReplyTargetId,
      setThreadScrollTargetId,
    });
  const settledChannelIdRef = React.useRef<string | null>(null);
  const hasSettledThisChannel =
    activeChannelId !== null && settledChannelIdRef.current === activeChannelId;
  const timelineLoadingNow =
    activeChannel !== null &&
    activeChannel.channelType !== "forum" &&
    selectTimelineLoadingState(
      {
        isPending: messagesQuery.isPending,
        isFetching: messagesQuery.isFetching,
        isPlaceholderData: messagesQuery.isPlaceholderData,
        dataLength: messagesQuery.data?.length ?? null,
      },
      hasSettledThisChannel,
    );
  const { settledChannelId, isLoading: isTimelineLoading } =
    resolveTimelineLoadingLatch(
      settledChannelIdRef.current,
      activeChannelId,
      timelineLoadingNow,
    );
  settledChannelIdRef.current = settledChannelId;
  const { welcomeKickoffStage, welcomeKickoffSettingUp } =
    useWelcomeKickoffStagePresence(
      activeChannel,
      timelineMessages,
      isTimelineLoading,
    );
  const resetComposerTargets = React.useCallback(
    (_channelId: string | null) => {
      setExpandedThreadReplyIds(new Set());
      setThreadScrollTargetId(null);
      setThreadReplyTargetId(null);
      setEditTargetId(null);
    },
    [],
  );
  const handleThreadScrollTargetResolved = React.useCallback(() => {
    setThreadScrollTargetId(null);
  }, []);
  const handleTargetReached = React.useCallback(() => {
    setThreadScrollTargetId(null);
    clearMessageRouteTarget({ replace: true });
  }, [clearMessageRouteTarget]);
  React.useEffect(() => {
    resetComposerTargets(activeChannelId);
  }, [activeChannelId, resetComposerTargets]);
  const mainTimelineTargetMessageId = useChannelRouteTarget({
    activeChannel,
    activeChannelId,
    closeAgentSession: handleCloseAgentSession,
    setEditTargetId,
    setExpandedThreadReplyIds,
    setOpenThreadHeadId,
    setProfilePanelPubkey,
    setThreadReplyTargetId,
    setThreadScrollTargetId,
    targetMessageId,
    timelineMessages,
  });
  useThreadTargetSync({
    clearOptimisticThreadOverride,
    editTargetId,
    editTargetMessage,
    isTimelineLoading,
    openThreadHeadId,
    openThreadHeadMessage,
    setEditTargetId,
    setExpandedThreadReplyIds,
    setOpenThreadHeadId,
    setThreadReplyTargetId,
    setThreadScrollTargetId,
    threadReplyTargetId,
    threadReplyTargetMessage,
  });

  const hasAuxiliaryPanel = Boolean(
    openAgentSessionPubkey ||
      profilePanelPubkey ||
      channelManagementOpen ||
      isConversationContextOpen,
  );
  const displayedThreadHeadMessage = threadPanelData.threadHead;
  const displayedThreadMessages = threadPanelData.visibleReplies;
  const displayedThreadReplyTargetMessage = threadPanelData.replyTargetMessage;
  const displayedThreadFirstUnreadReplyId = displayedThreadHeadMessage
    ? threadFirstUnreadReplyId
    : null;
  const shouldShowThreadSkeleton = Boolean(
    effectiveOpenThreadHeadId && activeChannel && !displayedThreadHeadMessage,
  );
  const { shouldCompactHeaderActions, useSinglePanel: isSinglePanelView } =
    resolveChannelShellLayout({
      hasAuxiliaryPanel,
      hasProjectNavigator: projectNavigatorVisible ?? projectContext != null,
      isCompactProjectNavigator,
      isForum: activeChannel?.channelType === "forum",
      isMobileViewport,
      mainInsetWidthPx: stableShellWidthPx,
    });
  const channelHeaderChromeRef = useMeasuredCssVariable({
    targetRef: mainInsetRef,
    ...channelContentTopPaddingMeasurement,
    resetKey: activeChannelId,
    enabled: !isSinglePanelView,
  });

  const handleManageChannel = React.useCallback(() => {
    if (activeChannel?.channelType === "forum") {
      openGlobalChannelManagement();
      return;
    }

    if (channelManagementOpen) {
      setChannelManagementOpen(false);
      return;
    }

    setOpenThreadHeadId(null);
    setExpandedThreadReplyIds(new Set());
    setThreadScrollTargetId(null);
    setThreadReplyTargetId(null);
    handleCloseAgentSession();
    setProfilePanelPubkey(null);
    setIsConversationContextOpen(false);
    setChannelManagementOpen(true);
  }, [
    activeChannel?.channelType,
    channelManagementOpen,
    openGlobalChannelManagement,
    setChannelManagementOpen,
    setOpenThreadHeadId,
    handleCloseAgentSession,
    setProfilePanelPubkey,
  ]);
  const handleToggleMembers = React.useCallback(() => {
    if (isConversationContextOpen) {
      setIsConversationContextOpen(false);
      setRequestedExchangeId(null);
      return;
    }

    setOpenThreadHeadId(null);
    setExpandedThreadReplyIds(new Set());
    setThreadScrollTargetId(null);
    setThreadReplyTargetId(null);
    handleCloseAgentSession();
    setProfilePanelPubkey(null);
    setChannelManagementOpen(false);
    setRequestedExchangeId(null);
    setIsConversationContextOpen(true);
  }, [
    handleCloseAgentSession,
    isConversationContextOpen,
    setChannelManagementOpen,
    setOpenThreadHeadId,
    setProfilePanelPubkey,
  ]);

  const handleOpenExchange = React.useCallback(
    (exchangeId: string) => {
      setOpenThreadHeadId(null);
      setExpandedThreadReplyIds(new Set());
      setThreadScrollTargetId(null);
      setThreadReplyTargetId(null);
      handleCloseAgentSession();
      setProfilePanelPubkey(null);
      setChannelManagementOpen(false);
      setIsMembersSidebarOpen(false);
      setRequestedExchangeId(exchangeId);
      setIsConversationContextOpen(true);
    },
    [
      handleCloseAgentSession,
      setChannelManagementOpen,
      setOpenThreadHeadId,
      setProfilePanelPubkey,
    ],
  );

  const exchangeObservationRef = React.useRef<{
    channelId: string | null;
    watermark: number;
  } | null>(null);
  React.useEffect(() => {
    const watermark = roomExchangeHistory.reduce(
      (maximum, entry) => Math.max(maximum, entry.liveObservedAt ?? 0),
      0,
    );
    const previous = exchangeObservationRef.current;
    if (!previous || previous.channelId !== activeChannelId) {
      exchangeObservationRef.current = {
        channelId: activeChannelId,
        watermark,
      };
      return;
    }

    const newlyLive = latestLiveExchangeAfter(
      roomExchangeHistory,
      previous.watermark,
    );
    previous.watermark = Math.max(previous.watermark, watermark);
    if (newlyLive) handleOpenExchange(newlyLive.record.exchangeId);
  }, [activeChannelId, handleOpenExchange, roomExchangeHistory]);

  // Intentionally reset a transient drawer selection whenever the room key
  // changes; the dependency is the trigger rather than an effect input.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on room change
  React.useEffect(() => {
    setRequestedExchangeId(null);
  }, [activeChannelId]);

  const handleBackToConversation = React.useCallback(() => {
    setProfilePanelPubkey(null);
    setIsConversationContextOpen(true);
  }, [setProfilePanelPubkey]);

  const channelHeader = React.useMemo(
    () => (
      <ChannelScreenHeader
        activeChannel={activeChannel}
        activeChannelEphemeralDisplay={activeChannelEphemeralDisplay}
        activeChannelTitle={activeChannelTitle}
        actionsVariant={shouldCompactHeaderActions ? "compact" : "inline"}
        activeDmAvatarUrl={activeDmAvatarUrl}
        activeDmHeaderParticipants={activeDmHeaderParticipants}
        activeDmPresenceStatus={activeDmPresenceStatus}
        agentPubkeys={agentPubkeys}
        profiles={messageProfiles}
        residentPersonaIdLookup={residentPersonaIdLookup}
        chromeWrapperRef={channelHeaderChromeRef}
        currentPubkey={currentPubkey}
        isAddBotOpen={isAddBotOpen}
        isJoining={joinChannelMutation.isPending}
        onAddBotOpenChange={setIsAddBotOpen}
        onJoinChannel={joinChannelMutation.mutateAsync}
        onManageChannel={handleManageChannel}
        onOpenResident={(pubkey) =>
          handleOpenProfilePanel(pubkey, { tab: "continuity" })
        }
        onToggleMembers={handleToggleMembers}
        showHeaderContent={!isSinglePanelView}
        transparentChrome={activeChannel?.channelType !== "forum"}
        visitorPubkeys={visitorPubkeys}
      />
    ),
    [
      visitorPubkeys,
      messageProfiles,
      residentPersonaIdLookup,
      activeChannel,
      activeChannelEphemeralDisplay,
      activeChannelTitle,
      shouldCompactHeaderActions,
      activeDmAvatarUrl,
      activeDmHeaderParticipants,
      activeDmPresenceStatus,
      agentPubkeys,
      channelHeaderChromeRef,
      currentPubkey,
      isAddBotOpen,
      joinChannelMutation.isPending,
      joinChannelMutation.mutateAsync,
      handleManageChannel,
      handleOpenProfilePanel,
      handleToggleMembers,
      isSinglePanelView,
    ],
  );

  return (
    <AgentSessionProvider onOpenAgentSession={handleOpenAgentSession}>
      <ProfilePanelProvider onOpenProfilePanel={handleOpenProfilePanel}>
        <WelcomeAgentCreateDialog
          guideName={welcomeGuideAgent?.name ?? "your welcome guide"}
          isSending={welcomeAgentCreate.isSending}
          onCreateInChat={() => void welcomeAgentCreate.createInChat()}
          onCreateManually={welcomeAgentCreate.createManually}
          onOpenChange={welcomeAgentCreate.setIsOpen}
          open={welcomeAgentCreate.isOpen}
          sendError={welcomeAgentCreate.error}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {activeChannel ? (
            activeChannel.channelType === "forum" ? (
              <ForumChannelContent
                canResetPanelWidth={canResetThreadPanelWidth}
                channel={activeChannel}
                currentPubkey={currentPubkey}
                header={channelHeader}
                onClosePost={onCloseForumPost}
                onCloseProfilePanel={handleCloseProfilePanel}
                onOpenDm={handleOpenDm}
                onOpenProfilePanel={handleOpenProfilePanel}
                onPanelResizeStart={handleThreadPanelResizeStart}
                onProfilePanelTabChange={setProfilePanelTab}
                onProfilePanelViewChange={setProfilePanelView}
                onResetPanelWidth={handleThreadPanelWidthReset}
                onSelectPost={onSelectForumPost}
                panelWidthPx={threadPanelWidthPx}
                profilePanelPubkey={profilePanelPubkey}
                profilePanelTab={profilePanelTab}
                profilePanelView={profilePanelView}
                selectedPostId={selectedForumPostId}
                targetReplyId={targetForumReplyId}
              />
            ) : (
              <ChannelPane
                activeChannel={activeChannel}
                activityAgents={channelAgentSessionAgents}
                agentPubkeys={agentPubkeys}
                agentPubkeysPending={agentPubkeysPending}
                agentSessionAgents={agentSessionAgents}
                autoSendDraftKey={autoSendDraftKey}
                onAutoSendComplete={clearAutoSend}
                botTypingEntries={botTypingEntries}
                channelFind={channelFind}
                channelManagementOpen={channelManagementOpen}
                conversationContextOpen={isConversationContextOpen}
                requestedExchangeId={requestedExchangeId}
                currentPubkey={currentPubkey}
                projectContext={projectContext}
                canResetThreadPanelWidth={canResetThreadPanelWidth}
                fetchOlder={fetchOlder}
                header={channelHeader}
                hasOlderMessages={hasOlderMessages}
                historyExhausted={historyExhausted}
                onAddAgent={handleOpenAddBot}
                onBrowseChannels={openBrowseChannels}
                onCreateChannel={openCreateChannel}
                onOpenMembers={handleOpenMembersSidebar}
                isFetchingOlder={isFetchingOlder}
                entranceMessageId={welcomeEntranceMessageId}
                onEntranceMessageComplete={handleWelcomeEntranceComplete}
                welcomeKickoffStage={welcomeKickoffStage}
                welcomeKickoffSettingUp={welcomeKickoffSettingUp}
                editTarget={
                  editTargetMessage
                    ? {
                        author: editTargetMessage.author,
                        body: editTargetMessage.body,
                        id: editTargetMessage.id,
                        imetaMedia: imetaMediaFromTags(editTargetMessage.tags),
                      }
                    : null
                }
                followThreadById={followThread}
                unfollowThreadById={unfollowThread}
                isFollowingThreadById={isFollowingThread}
                isMessageUnreadById={isMessageUnread}
                isFollowingThread={isNotifiedForEffectiveThread}
                isSending={sendMessageMutation.isPending}
                isSinglePanelView={isSinglePanelView}
                isTimelineLoading={isTimelineLoading}
                messages={timelineMessages}
                threadSummaries={threadSummaries}
                onCancelEdit={handleCancelEdit}
                onCancelDirectedReply={handleCancelDirectedReply}
                onCancelThreadReply={handleCancelThreadReply}
                onChannelManagementDeleted={handleChannelManagementDeleted}
                onFollowThread={
                  effectiveOpenThreadHeadId != null &&
                  !isNotifiedForEffectiveThread
                    ? () => followThread(effectiveOpenThreadHeadId)
                    : undefined
                }
                onUnfollowThread={
                  effectiveOpenThreadHeadId != null &&
                  isNotifiedForEffectiveThread
                    ? () => unfollowThread(effectiveOpenThreadHeadId)
                    : undefined
                }
                onCloseAgentSession={handleCloseAgentSession}
                onBackFromAgentSession={
                  hasAgentSessionReturnTarget
                    ? handleBackFromAgentSession
                    : undefined
                }
                onCloseChannelManagement={handleCloseChannelManagement}
                onCloseConversationContext={() => {
                  setIsConversationContextOpen(false);
                  setRequestedExchangeId(null);
                }}
                onOpenExchange={handleOpenExchange}
                onCloseThread={handleCloseThread}
                onDelete={activeChannel?.archivedAt ? undefined : handleDelete}
                onEdit={activeChannel?.archivedAt ? undefined : handleEdit}
                onEditSave={
                  activeChannel?.archivedAt ? undefined : handleEditSave
                }
                onMarkUnread={handleMessageMarkUnread}
                onMarkRead={handleMessageMarkRead}
                onRetryFailedMessage={sendMessageMutation.retryFailedMessage}
                onExpandThreadReplies={handleExpandThreadReplies}
                onOpenDm={handleOpenDm}
                onOpenProfilePanel={handleOpenProfilePanel}
                onBackToConversation={handleBackToConversation}
                onResetThreadPanelWidth={handleThreadPanelWidthReset}
                onCloseProfilePanel={handleCloseProfilePanel}
                onOpenThread={handleOpenThreadAndCloseAgentSession}
                onSelectThreadReplyTarget={handleSelectThreadReplyTarget}
                onSelectDirectedReplyTarget={handleSelectDirectedReplyTarget}
                onSendMessage={handleSendMessage}
                onSendDirectedReply={handleSendDirectedReply}
                onSendVideoReviewComment={effectiveSendVideoReviewComment}
                onSendThreadReply={handleSendThreadReply}
                onThreadScrollTargetResolved={handleThreadScrollTargetResolved}
                onThreadPanelResizeStart={handleThreadPanelResizeStart}
                onTargetReached={handleTargetReached}
                onToggleReaction={effectiveToggleReaction}
                openAgentSessionChannelId={openAgentSessionChannelId}
                openAgentSessionPubkey={openAgentSessionPubkey}
                openThreadHeadId={effectiveOpenThreadHeadId}
                shouldShowThreadSkeleton={shouldShowThreadSkeleton}
                onProfilePanelViewChange={setProfilePanelView}
                onProfilePanelTabChange={setProfilePanelTab}
                profilePanelPubkey={profilePanelPubkey}
                profilePanelTab={profilePanelTab}
                profilePanelView={profilePanelView}
                personaLookup={personaLookup}
                residentPersonaIdLookup={residentPersonaIdLookup}
                profiles={messageProfiles}
                ownerProfiles={messageOwnerProfiles}
                firstUnreadMessageId={firstUnreadMessageId}
                unreadCount={unreadCount}
                targetMessageId={
                  threadScrollTargetId ?? mainTimelineTargetMessageId
                }
                threadHeadMessage={displayedThreadHeadMessage}
                threadMessages={displayedThreadMessages}
                threadMessagesPending={threadRepliesQuery.isPending}
                threadPanelWidthPx={threadPanelWidthPx}
                threadTypingPubkeys={threadTypingPubkeys}
                threadReplyTargetMessage={displayedThreadReplyTargetMessage}
                directedReplyTargetMessage={directedReplyTargetMessage}
                threadScrollTargetId={threadScrollTargetId}
                threadUnreadCounts={threadUnreadCounts}
                threadReplyUnreadCounts={threadReplyUnreadCounts}
                threadFirstUnreadReplyId={displayedThreadFirstUnreadReplyId}
                isJoining={joinChannelMutation.isPending}
                onJoinChannel={joinChannelMutation.mutateAsync}
                typingPubkeys={humanTypingPubkeys}
              />
            )
          ) : (
            <ChannelScreenEmptyState />
          )}
        </div>

        <MembersSidebar
          channel={activeChannel}
          currentPubkey={currentPubkey}
          open={isMembersSidebarOpen}
          onOpenChange={setIsMembersSidebarOpen}
          onViewActivity={handleOpenAgentSession}
        />
      </ProfilePanelProvider>
    </AgentSessionProvider>
  );
}
