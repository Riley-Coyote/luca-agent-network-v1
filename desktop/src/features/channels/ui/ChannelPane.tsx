import * as React from "react";
import { Hash, LogIn } from "lucide-react";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useMediaUpload } from "@/features/messages/lib/useMediaUpload";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import { ComposerTimeoutBanner } from "@/features/moderation/ui/ComposerTimeoutBanner";
import { useTimeoutState } from "@/features/moderation/lib/timeoutStore";
import { isModerationDm } from "@/features/moderation/lib/moderationDm";
import { useRelaySelfQuery } from "@/features/moderation/hooks";
import { DropZoneOverlay } from "@/features/messages/ui/ComposerAttachments";
import {
  MessageTimeline,
  type MessageTimelineHandle,
} from "@/features/messages/ui/MessageTimeline";
import { buildDirectMessageIntro } from "@/features/channels/lib/dmParticipantDisplay";
import {
  getDmHuddleMemberPubkeys,
  hasOtherDmParticipant,
} from "@/features/channels/lib/dmHuddleMembers";
import { useComposerHeightPadding } from "@/features/messages/ui/useComposerHeightPadding";
import { TypingIndicatorRow } from "@/features/messages/ui/TypingIndicatorRow";
import { UserProfilePanel } from "@/features/profile/ui/UserProfilePanel";
import { ChannelFindBar } from "@/features/search/ui/ChannelFindBar";
import { AgentSessionThreadPanel } from "@/features/channels/ui/AgentSessionThreadPanel";
import { ChannelManagementAuxiliaryPanel } from "@/features/channels/ui/ChannelManagementAuxiliaryPanel";
import { RightAuxiliaryPane } from "@/features/channels/ui/RightAuxiliaryPane";
import { useChannelWorkingAgentPubkeys } from "@/features/agents/agentWorkingSignal";
import { BotActivityComposerAction } from "@/features/channels/ui/BotActivityBar";
import { ConversationAgentActivityStrip } from "@/features/channels/ui/ConversationAgentActivityStrip";
import { useManagedPermissions } from "@/features/agents/useManagedPermissions";
import { ManagedPermissionCard } from "@/features/agents/ui/ManagedPermissionCard";
import {
  containsWelcomePersonaMention,
  WelcomeComposerBanner,
  WELCOME_COMPOSER_BANNER_DISMISS_DURATION_SECONDS,
  WELCOME_COMPOSER_BANNER_HIDE_BUFFER_MS,
  WELCOME_COMPOSER_BANNER_SUCCESS_SETTLE_MS,
  WELCOME_PERSONA_ROTATION_MS,
  type WelcomeComposerBannerState,
} from "@/features/channels/ui/WelcomeComposerBanner";
import {
  isWelcomeSetupSystemMessage,
  mentionsKnownAgent,
} from "@/features/channels/ui/ChannelPane.helpers";
import { useChannelIntro } from "@/features/channels/ui/useChannelIntro";
import type { ChannelPaneProps } from "@/features/channels/ui/ChannelPane.types";
import * as agentSessionSelection from "@/features/channels/ui/agentSessionSelection";
import { usePrepareDmSendChannel } from "@/features/channels/ui/usePrepareDmSendChannel";
import { Button } from "@/shared/ui/button";
import {
  buildInlineConversationEntries,
  buildMainTimelineEntries,
} from "@/features/messages/lib/threadPanel";
import { useRenderScopedReactionHydration } from "@/features/messages/lib/useRenderScopedReactionHydration";
import type { TimelineMessage } from "@/features/messages/types";
import { isWelcomeExperienceChannel as isWelcomeExperience } from "@/features/onboarding/welcome";
import { KIND_SYSTEM_MESSAGE } from "@/shared/constants/kinds";
import { useIsThreadPanelOverlay } from "@/shared/hooks/use-mobile";
import { channelChrome } from "@/shared/layout/chromeLayout";
import { cn } from "@/shared/lib/cn";
export const ChannelPane = React.memo(function ChannelPane({
  activeChannel,
  agentPubkeys,
  agentPubkeysPending = false,
  agentSessionAgents,
  activityAgents = agentSessionAgents,
  autoSendDraftKey = null,
  onAutoSendComplete = null,
  channelFind,
  channelManagementOpen = false,
  currentPubkey,
  editTarget = null,
  fetchOlder,
  header,
  hasOlderMessages,
  historyExhausted,
  isFetchingOlder,
  followThreadById,
  isFollowingThreadById,
  isMessageUnreadById,
  isJoining = false,
  isSinglePanelView = false,
  isSending,
  isTimelineLoading,
  entranceMessageId = null,
  onEntranceMessageComplete,
  welcomeKickoffStage = null,
  welcomeKickoffSettingUp = false,
  messages,
  threadSummaries,
  firstUnreadMessageId = null,
  unreadCount = 0,
  canResetThreadPanelWidth,
  onCancelEdit,
  onCancelThreadReply,
  onBackFromAgentSession,
  onCloseAgentSession,
  onCloseChannelManagement,
  onChannelManagementDeleted,
  onCloseProfilePanel,
  onAddAgent,
  onBrowseChannels,
  onCreateChannel,
  onDelete,
  onEdit,
  onEditSave,
  onMarkUnread,
  onMarkRead,
  onExpandThreadReplies,
  onJoinChannel,
  onOpenAgentSession,
  onOpenDm,
  onOpenMembers,
  onOpenProfilePanel,
  onOpenThread,
  onResetThreadPanelWidth,
  onSelectThreadReplyTarget,
  onSendMessage,
  onSendVideoReviewComment,
  onSendThreadReply,
  onThreadPanelResizeStart,
  onTargetReached,
  onToggleReaction,
  unfollowThreadById,
  personaLookup,
  profiles,
  ownerProfiles,
  openThreadHeadId,
  openAgentSessionChannelId,
  openAgentSessionPubkey,
  onProfilePanelViewChange,
  onProfilePanelTabChange,
  profilePanelPubkey,
  profilePanelTab,
  profilePanelView,
  targetMessageId,
  threadHeadMessage,
  threadMessages,
  threadPanelWidthPx,
  threadReplyTargetMessage,
  threadUnreadCounts,
  typingPubkeys,
}: ChannelPaneProps) {
  const timelineScrollRef = React.useRef<HTMLDivElement>(null);
  const messageTimelineRef = React.useRef<MessageTimelineHandle>(null);
  const composerWrapperRef = React.useRef<HTMLDivElement>(null);
  const completedWelcomeBannerChannelIdsRef = React.useRef(new Set<string>());
  const welcomeComposerDismissTimerRef = React.useRef<number | null>(null);
  const welcomeComposerHideTimerRef = React.useRef<number | null>(null);
  const [welcomeComposerBannerState, setWelcomeComposerBannerState] =
    React.useState<WelcomeComposerBannerState>("prompt");
  const pendingManagedPermissions = useManagedPermissions();
  const { goChannel } = useAppNavigation();
  const prepareDmSendChannel = usePrepareDmSendChannel(
    activeChannel,
    currentPubkey,
  );
  const mainComposerMedia = useMediaUpload();
  const isNonMemberView =
    activeChannel !== null &&
    !activeChannel.isMember &&
    activeChannel.visibility === "open" &&
    !activeChannel.archivedAt;
  const hasMainComposerOverlay = !isNonMemberView;
  const activeChannelId = activeChannel?.id ?? null;
  const activePermissionRequests = React.useMemo(
    () =>
      pendingManagedPermissions.filter(
        (pending) => pending.request.conversationId === activeChannelId,
      ),
    [activeChannelId, pendingManagedPermissions],
  );
  const activeChannelIdRef = React.useRef(activeChannelId);
  const channelPaneMountedRef = React.useRef(false);
  activeChannelIdRef.current = activeChannelId;
  React.useEffect(() => {
    channelPaneMountedRef.current = true;
    return () => {
      channelPaneMountedRef.current = false;
    };
  }, []);
  // Clear the ?autoSend search param once the auto-submit fires so
  // back-navigation cannot re-trigger the send.
  // When `onAutoSendComplete` is provided it does a surgical single-key clear
  // that preserves `?thread` and all other panel search state (required for
  // the thread-draft send path so the thread panel does not unmount before the
  // deferred setTimeout(0) submit fires). The goChannel fallback is kept for
  // callers that do not supply the prop (e.g. isolated tests / older wrappers).
  const handleAutoSubmitComplete = React.useCallback(() => {
    if (onAutoSendComplete) {
      onAutoSendComplete();
    } else if (activeChannelId) {
      void goChannel(activeChannelId, { replace: true });
    }
  }, [activeChannelId, goChannel, onAutoSendComplete]);
  const huddleMemberPubkeys = React.useMemo(
    () => getDmHuddleMemberPubkeys(activeChannel, agentPubkeys, currentPubkey),
    [activeChannel, agentPubkeys, currentPubkey],
  );
  const huddleMemberPubkeysPending =
    agentPubkeysPending && hasOtherDmParticipant(activeChannel, currentPubkey);
  const isActiveWelcomeChannel =
    activeChannel !== null && isWelcomeExperience(activeChannel);
  useComposerHeightPadding(
    timelineScrollRef,
    composerWrapperRef,
    `${activeChannelId}:${isSinglePanelView}:${hasMainComposerOverlay}`,
    "css-variable",
  );
  const clearWelcomeComposerDismissTimer = React.useCallback(() => {
    if (welcomeComposerDismissTimerRef.current !== null) {
      window.clearTimeout(welcomeComposerDismissTimerRef.current);
      welcomeComposerDismissTimerRef.current = null;
    }
    if (welcomeComposerHideTimerRef.current !== null) {
      window.clearTimeout(welcomeComposerHideTimerRef.current);
      welcomeComposerHideTimerRef.current = null;
    }
  }, []);

  React.useEffect(
    () => () => clearWelcomeComposerDismissTimer(),
    [clearWelcomeComposerDismissTimer],
  );

  React.useEffect(() => {
    clearWelcomeComposerDismissTimer();

    if (
      activeChannelId &&
      isActiveWelcomeChannel &&
      completedWelcomeBannerChannelIdsRef.current.has(activeChannelId)
    ) {
      setWelcomeComposerBannerState("hidden");
      return;
    }

    setWelcomeComposerBannerState("prompt");
  }, [
    activeChannelId,
    clearWelcomeComposerDismissTimer,
    isActiveWelcomeChannel,
  ]);

  const mainEditTarget = editTarget;

  const findLastOwnEditable = React.useCallback(
    (candidates: TimelineMessage[]): TimelineMessage | null => {
      if (!onEdit || !currentPubkey) return null;
      let best: TimelineMessage | null = null;
      for (const message of candidates) {
        if (
          message.kind === KIND_SYSTEM_MESSAGE ||
          message.pubkey !== currentPubkey ||
          message.pending
        ) {
          continue;
        }
        if (!best || message.createdAt >= best.createdAt) {
          best = message;
        }
      }
      return best;
    },
    [onEdit, currentPubkey],
  );

  const handleEditLastOwnMainMessage = React.useCallback((): boolean => {
    const target = findLastOwnEditable(messages);
    if (!target || !onEdit) return false;
    onEdit(target);
    return true;
  }, [findLastOwnEditable, messages, onEdit]);

  const timeoutState = useTimeoutState();

  // A moderation DM (1:1 with the relay identity) is read-only for the member;
  // only DMs pay for the NIP-11 `self` lookup. Fails open: no `relaySelf` →
  // ordinary DM, composer enabled.
  const relaySelfQuery = useRelaySelfQuery(activeChannel?.channelType === "dm");
  const isModerationDmChannel = isModerationDm(
    activeChannel ?? null,
    currentPubkey,
    relaySelfQuery.data,
  );

  const isComposerDisabled =
    !activeChannel?.isMember ||
    activeChannel.archivedAt !== null ||
    activeChannel.channelType === "forum" ||
    timeoutState.active ||
    isModerationDmChannel ||
    isSending;
  const knownAgentPubkeys = React.useMemo(() => {
    const pubkeys = new Set<string>();

    for (const pubkey of agentPubkeys ?? []) {
      pubkeys.add(pubkey.toLowerCase());
    }
    for (const agent of agentSessionAgents) {
      pubkeys.add(agent.pubkey.toLowerCase());
    }
    for (const agent of activityAgents) {
      pubkeys.add(agent.pubkey.toLowerCase());
    }

    return pubkeys;
  }, [activityAgents, agentPubkeys, agentSessionAgents]);
  const completeWelcomeComposerBanner = React.useCallback(() => {
    if (!activeChannelId || !isActiveWelcomeChannel) {
      return;
    }

    clearWelcomeComposerDismissTimer();
    completedWelcomeBannerChannelIdsRef.current.add(activeChannelId);
    setWelcomeComposerBannerState("complete");
    welcomeComposerDismissTimerRef.current = window.setTimeout(() => {
      setWelcomeComposerBannerState("dismissing");
      welcomeComposerDismissTimerRef.current = null;
      welcomeComposerHideTimerRef.current = window.setTimeout(
        () => {
          setWelcomeComposerBannerState("hidden");
          welcomeComposerHideTimerRef.current = null;
        },
        WELCOME_COMPOSER_BANNER_DISMISS_DURATION_SECONDS * 1000 +
          WELCOME_COMPOSER_BANNER_HIDE_BUFFER_MS,
      );
    }, WELCOME_PERSONA_ROTATION_MS + WELCOME_COMPOSER_BANNER_SUCCESS_SETTLE_MS);
  }, [
    activeChannelId,
    clearWelcomeComposerDismissTimer,
    isActiveWelcomeChannel,
  ]);
  const handleSendMessage = React.useCallback(
    async (
      content: string,
      mentionPubkeys: string[],
      mediaTags?: string[][],
      channelId?: string | null,
    ) => {
      const shouldCompleteWelcomeBanner =
        isActiveWelcomeChannel &&
        (containsWelcomePersonaMention(content) ||
          mentionsKnownAgent(mentionPubkeys, knownAgentPubkeys));

      messageTimelineRef.current?.scrollToBottomOnNextUpdate();
      await onSendMessage(content, mentionPubkeys, mediaTags, channelId);

      if (
        channelId &&
        channelId !== activeChannelId &&
        channelPaneMountedRef.current &&
        activeChannelIdRef.current === activeChannelId
      ) {
        await goChannel(channelId, { replace: true });
      }

      if (shouldCompleteWelcomeBanner) {
        completeWelcomeComposerBanner();
      }
    },
    [
      activeChannelId,
      completeWelcomeComposerBanner,
      goChannel,
      isActiveWelcomeChannel,
      knownAgentPubkeys,
      onSendMessage,
    ],
  );
  const canDropInMainColumn =
    hasMainComposerOverlay && !isComposerDisabled && !isSinglePanelView;
  const hasTypingActivity = typingPubkeys.length > 0;
  // Unified working set for the composer bar: observer-derived turns primary,
  // bot typing fallback (both folded together by agentWorkingSignal). This is
  // what makes the bar show for an agent whose observer stream is live but
  // whose typing signal never arrives — and vice versa.
  const composerWorkingBotPubkeys = useChannelWorkingAgentPubkeys(
    activeChannel?.id ?? null,
  );
  const hasComposerBotActivity = composerWorkingBotPubkeys.length > 0;
  const directMessageIntro = React.useMemo(
    () =>
      buildDirectMessageIntro({
        channel: activeChannel,
        currentPubkey,
        profiles,
      }),
    [activeChannel, currentPubkey, profiles],
  );

  const handleWelcomeAddAgent = React.useCallback(() => {
    onAddAgent?.({
      beforeSend: () =>
        messageTimelineRef.current?.scrollToBottomOnNextUpdate(),
    });
  }, [onAddAgent]);
  const channelIntro = useChannelIntro({
    activeChannel,
    onAddAgent,
    onBrowseChannels,
    onCreateChannel,
    onOpenMembers,
    onWelcomeAddAgent: onAddAgent ? handleWelcomeAddAgent : undefined,
  });
  const visibleMessages = React.useMemo(() => {
    if (!isWelcomeExperience(activeChannel)) {
      return messages;
    }

    return messages.filter((message) => !isWelcomeSetupSystemMessage(message));
  }, [activeChannel, messages]);
  const mainTimelineEntries = React.useMemo(() => {
    const roots = buildMainTimelineEntries(
      visibleMessages,
      new Set(),
      threadSummaries,
      profiles,
    );
    return buildInlineConversationEntries(
      roots,
      openThreadHeadId,
      threadMessages,
    );
  }, [
    openThreadHeadId,
    profiles,
    threadMessages,
    threadSummaries,
    visibleMessages,
  ]);
  useRenderScopedReactionHydration({
    activeChannel,
    mainTimelineEntries,
    threadHeadMessage,
    threadMessages,
  });
  const isOverlay = useIsThreadPanelOverlay();
  const useSplitAuxiliaryPane = !isSinglePanelView && !isOverlay;
  const selectedAgent = React.useMemo(
    () =>
      agentSessionSelection.resolveSelectedAgentSession({
        agentSessionAgents,
        openAgentSessionPubkey,
        profilePanelPubkey,
        profiles,
      }),
    [agentSessionAgents, openAgentSessionPubkey, profilePanelPubkey, profiles],
  );
  const hasSplitAuxiliaryPane =
    useSplitAuxiliaryPane &&
    (channelManagementOpen ||
      Boolean(activeChannel && selectedAgent) ||
      Boolean(profilePanelPubkey));
  const wrapAux = (
    panel: React.ReactNode,
    testId: string,
    options: { key?: string } = {},
  ) =>
    useSplitAuxiliaryPane ? (
      <RightAuxiliaryPane
        canResetWidth={canResetThreadPanelWidth}
        key={options.key ?? testId}
        onResetWidth={onResetThreadPanelWidth}
        onResizeStart={onThreadPanelResizeStart}
        testId={testId}
        widthPx={threadPanelWidthPx}
      >
        {panel}
      </RightAuxiliaryPane>
    ) : (
      <React.Fragment key={options.key ?? testId}>{panel}</React.Fragment>
    );
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
      {!isSinglePanelView ? (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 z-30 bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/70 dark:bg-background/70 dark:backdrop-blur-xl dark:supports-backdrop-filter:bg-background/55",
            channelChrome.headerHeight,
          )}
          data-testid="channel-shared-header-backdrop"
        />
      ) : null}

      {!isSinglePanelView ? (
        <section
          aria-label="Channel messages and composer"
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          data-testid="channel-drop-zone"
          onDragEnter={
            canDropInMainColumn ? mainComposerMedia.handleDragEnter : undefined
          }
          onDragLeave={
            canDropInMainColumn ? mainComposerMedia.handleDragLeave : undefined
          }
          onDragOver={
            canDropInMainColumn ? mainComposerMedia.handleDragOver : undefined
          }
          onDrop={
            canDropInMainColumn
              ? (event) => {
                  void mainComposerMedia.handleDrop(event);
                }
              : undefined
          }
        >
          {header}
          <ConversationAgentActivityStrip
            agents={activityAgents}
            channelId={activeChannel?.id ?? null}
            onOpenAgentSession={onOpenAgentSession}
            sessionAgents={agentSessionAgents}
            workingPubkeys={composerWorkingBotPubkeys}
          />
          {channelFind.isOpen ? (
            <div className={cn("absolute inset-x-0 z-40", channelChrome.top)}>
              <ChannelFindBar
                matchCount={channelFind.matchCount}
                matchIndex={channelFind.activeIndex}
                onClose={channelFind.close}
                onNext={channelFind.goToNext}
                onPrevious={channelFind.goToPrevious}
                onQueryChange={channelFind.setQuery}
                query={channelFind.query}
              />
            </div>
          ) : null}
          <MessageTimeline
            ref={messageTimelineRef}
            channelId={activeChannel?.id}
            channelIntro={channelIntro}
            directMessageIntro={directMessageIntro}
            scrollContainerRef={timelineScrollRef}
            currentPubkey={currentPubkey}
            fetchOlder={fetchOlder}
            followThreadById={followThreadById}
            hasComposerOverlay={hasMainComposerOverlay}
            hasOlderMessages={hasOlderMessages}
            historyExhausted={historyExhausted}
            huddleMemberPubkeys={huddleMemberPubkeys}
            huddleMemberPubkeysPending={huddleMemberPubkeysPending}
            isFetchingOlder={isFetchingOlder}
            isFollowingThreadById={isFollowingThreadById}
            isMessageUnreadById={isMessageUnreadById}
            personaLookup={personaLookup}
            profiles={profiles}
            ownerProfiles={ownerProfiles}
            unfollowThreadById={unfollowThreadById}
            emptyDescription={
              activeChannel?.channelType === "forum"
                ? "Select a stream or DM to load real message history in this first integration pass."
                : "Messages and sub-replies will appear here once the relay has history for this channel."
            }
            emptyTitle={
              activeChannel
                ? activeChannel.channelType === "forum"
                  ? "Forum channels are next"
                  : "No messages yet"
                : "No channel selected"
            }
            isLoading={isTimelineLoading}
            entranceMessageId={entranceMessageId}
            onEntranceMessageComplete={onEntranceMessageComplete}
            mainEntries={mainTimelineEntries}
            threadSummaries={threadSummaries}
            messages={visibleMessages}
            firstUnreadMessageId={firstUnreadMessageId}
            unreadCount={unreadCount}
            onDelete={onDelete}
            onEdit={onEdit}
            onMarkUnread={onMarkUnread}
            onMarkRead={onMarkRead}
            expandedThreadHeadId={openThreadHeadId}
            onExpandThreadReplies={onExpandThreadReplies}
            onReply={
              activeChannel?.archivedAt ? undefined : onSelectThreadReplyTarget
            }
            onToggleThread={
              activeChannel?.archivedAt ? undefined : onOpenThread
            }
            channelName={activeChannel?.name}
            channelType={activeChannel?.channelType ?? null}
            isSendingVideoReviewComment={isSending}
            onSendVideoReviewComment={
              activeChannel?.archivedAt ? undefined : onSendVideoReviewComment
            }
            onTargetReached={onTargetReached}
            onToggleReaction={onToggleReaction}
            searchActiveMessageId={channelFind.activeMatch?.messageId ?? null}
            searchMatchingMessageIds={channelFind.matchingMessageIds}
            searchQuery={channelFind.query}
            targetMessageId={targetMessageId}
            splitThreadPanelOpen={false}
            threadUnreadCounts={threadUnreadCounts}
          />
          {isNonMemberView ? (
            <div
              data-testid="join-banner"
              className="flex items-center gap-3 border-t border-border/80 bg-card/50 px-5 py-3"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
                <Hash className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  Viewing{" "}
                  <span className="font-medium text-foreground">
                    #{activeChannel?.name}
                  </span>
                </span>
              </div>
              <Button
                disabled={isJoining}
                onClick={() => {
                  void onJoinChannel?.();
                }}
                size="sm"
                variant="default"
              >
                <LogIn className="mr-1.5 h-4 w-4" />
                {isJoining ? "Joining..." : "Join to participate"}
              </Button>
            </div>
          ) : (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 z-40 isolate before:absolute before:inset-x-0 before:bottom-0 before:-z-10 before:h-12 before:bg-background before:content-['']"
              data-testid="channel-composer-overlay"
              ref={composerWrapperRef}
            >
              <div className="composer-overlay-corner-masks pointer-events-auto">
                {activePermissionRequests.length > 0 ? (
                  <div className="mx-auto mb-2 grid w-full max-w-[48rem] gap-2">
                    {activePermissionRequests.map((pending) => (
                      <ManagedPermissionCard
                        key={pending.pendingId}
                        pending={pending}
                      />
                    ))}
                  </div>
                ) : null}
                {timeoutState.active ? (
                  <ComposerTimeoutBanner
                    expiresAtMs={timeoutState.expiresAtMs}
                  />
                ) : isActiveWelcomeChannel ? (
                  <div className="relative">
                    {welcomeKickoffStage}
                    <WelcomeComposerBanner
                      settingUp={welcomeKickoffSettingUp}
                      state={welcomeComposerBannerState}
                    />
                  </div>
                ) : null}
                <MessageComposer
                  channelId={activeChannel?.id ?? null}
                  channelName={activeChannel?.name ?? "channel"}
                  channelType={activeChannel?.channelType ?? null}
                  containerClassName="mx-auto w-full max-w-[48rem] px-0"
                  disabled={isComposerDisabled}
                  editTarget={mainEditTarget}
                  autoSubmitDraftKey={autoSendDraftKey}
                  onAutoSubmitComplete={handleAutoSubmitComplete}
                  isSending={isSending}
                  mediaController={mainComposerMedia}
                  onCancelEdit={onCancelEdit}
                  onCancelReply={onCancelThreadReply}
                  onCaptureSendContext={
                    threadReplyTargetMessage && openThreadHeadId
                      ? () => ({
                          parentEventId: threadReplyTargetMessage.id,
                          threadHeadId: openThreadHeadId,
                        })
                      : undefined
                  }
                  onEditLastOwnMessage={handleEditLastOwnMainMessage}
                  onEditSave={onEditSave}
                  onPrepareSendChannel={
                    activeChannel?.channelType === "dm"
                      ? prepareDmSendChannel
                      : undefined
                  }
                  onSend={
                    threadReplyTargetMessage
                      ? onSendThreadReply
                      : handleSendMessage
                  }
                  profiles={profiles}
                  replyTarget={threadReplyTargetMessage}
                  placeholder={
                    timeoutState.active
                      ? "You're timed out by community moderators."
                      : isModerationDmChannel
                        ? "This channel is read-only."
                        : activeChannel?.archivedAt
                          ? "Archived channels are read-only."
                          : activeChannel?.channelType === "forum"
                            ? "Forum posting is not wired in this pass."
                            : activeChannel
                              ? activeChannel.channelType === "dm" &&
                                directMessageIntro
                                ? `Message ${directMessageIntro.displayName}`
                                : `Message #${activeChannel.name}`
                              : "Select a channel"
                  }
                  showTopBorder={false}
                  typingParentEventId={threadReplyTargetMessage?.id ?? null}
                  typingRootEventId={
                    threadReplyTargetMessage ? openThreadHeadId : null
                  }
                />
                <div
                  className="mx-auto min-h-8 w-full max-w-[48rem] overflow-visible bg-background px-0 pb-1.5 pt-0"
                  data-luca-reading-plane
                  data-testid="channel-composer-activity-row"
                >
                  <div className="flex h-full w-full items-center gap-2 overflow-visible">
                    {hasComposerBotActivity ? (
                      <div className="flex min-w-0 flex-1 overflow-visible">
                        <BotActivityComposerAction
                          agents={activityAgents}
                          channelId={activeChannel?.id ?? null}
                          onOpenAgentSession={onOpenAgentSession}
                          openAgentSessionPubkey={openAgentSessionPubkey}
                          profiles={profiles}
                          workingBotPubkeys={composerWorkingBotPubkeys}
                          variant="inline"
                        />
                      </div>
                    ) : null}
                    {hasTypingActivity ? (
                      <TypingIndicatorRow
                        channel={activeChannel}
                        className="min-w-0 flex-1 py-0 pl-[calc(0.75rem+1px)] pr-0 sm:pl-[calc(1rem+1px)]"
                        currentPubkey={currentPubkey}
                        profiles={profiles}
                        typingPubkeys={typingPubkeys}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          )}
          {canDropInMainColumn && mainComposerMedia.isDragOver ? (
            <DropZoneOverlay className="z-30 rounded-none" />
          ) : null}
        </section>
      ) : null}

      <>
        {channelManagementOpen && activeChannel ? (
          <ChannelManagementAuxiliaryPanel
            activeChannel={activeChannel}
            canResetThreadPanelWidth={canResetThreadPanelWidth}
            currentPubkey={currentPubkey}
            isSinglePanelView={isSinglePanelView}
            key="channel-management-panel"
            onChannelManagementDeleted={onChannelManagementDeleted}
            onCloseChannelManagement={onCloseChannelManagement}
            onResetThreadPanelWidth={onResetThreadPanelWidth}
            onThreadPanelResizeStart={onThreadPanelResizeStart}
            threadPanelWidthPx={threadPanelWidthPx}
            useSplitAuxiliaryPane={useSplitAuxiliaryPane}
            transparentChrome={hasSplitAuxiliaryPane}
          />
        ) : activeChannel && selectedAgent ? (
          (() => {
            // When the panel was opened from a different channel than the
            // currently active one, re-scope it to the active channel so
            // that both the content/header AND channel-backed actions (e.g.
            // Stop current turn) operate on the same channel object.
            const effectiveAgentSessionChannelId =
              openAgentSessionChannelId &&
              activeChannel.id !== openAgentSessionChannelId
                ? activeChannelId
                : openAgentSessionChannelId;
            const panel = (
              <AgentSessionThreadPanel
                agent={selectedAgent}
                canInterruptTurn={selectedAgent.canInterruptTurn}
                channel={
                  effectiveAgentSessionChannelId
                    ? effectiveAgentSessionChannelId === activeChannel.id
                      ? activeChannel
                      : null
                    : agentSessionSelection.isAgentInActivityList({
                          activityAgents,
                          selectedAgent,
                        })
                      ? activeChannel
                      : null
                }
                channelId={effectiveAgentSessionChannelId}
                isSinglePanelView={
                  useSplitAuxiliaryPane ? false : isSinglePanelView
                }
                layout={useSplitAuxiliaryPane ? "split" : "standalone"}
                transparentChrome={useSplitAuxiliaryPane}
                profiles={profiles}
                onBack={onBackFromAgentSession}
                onClose={onCloseAgentSession}
                widthPx={threadPanelWidthPx}
              />
            );
            return wrapAux(panel, "agent-session-thread-panel");
          })()
        ) : profilePanelPubkey ? (
          (() => {
            const panel = (
              <UserProfilePanel
                currentPubkey={currentPubkey}
                callerChannelId={activeChannelId}
                isSinglePanelView={
                  useSplitAuxiliaryPane ? false : isSinglePanelView
                }
                layout={useSplitAuxiliaryPane ? "split" : "standalone"}
                transparentChrome={useSplitAuxiliaryPane}
                onClose={onCloseProfilePanel}
                onOpenDm={onOpenDm}
                onOpenProfile={onOpenProfilePanel}
                onTabChange={onProfilePanelTabChange}
                onViewChange={onProfilePanelViewChange}
                pubkey={profilePanelPubkey}
                splitPaneClamp
                tab={profilePanelTab}
                view={profilePanelView}
                widthPx={threadPanelWidthPx}
              />
            );
            return wrapAux(panel, "user-profile-panel");
          })()
        ) : null}
      </>
    </div>
  );
});
