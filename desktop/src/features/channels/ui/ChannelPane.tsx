import * as React from "react";
import { Hash, LogIn } from "lucide-react";
import { toast } from "sonner";
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
import { ConversationContextPanel } from "@/features/channels/ui/ConversationContextPanel";
import { RightAuxiliaryPane } from "@/features/channels/ui/RightAuxiliaryPane";
import { getManagedPresentationTurn } from "@/features/messages/managedPresentationStore";
import { useManagedResponseSlots } from "@/features/messages/managedPresentationHooks";
import { resolveManagedPresentationRetry } from "@/features/messages/lib/managedPresentationRetry";
import { projectManagedTimelineMessages } from "@/features/messages/lib/managedTimelineProjection";
import { projectFocusedThreadTimeline } from "@/features/messages/lib/focusedThreadProjection";
import { ConversationAgentActivityStrip } from "@/features/channels/ui/ConversationAgentActivityStrip";
import type { ActivityShelfRetryTarget } from "@/features/channels/ui/conversationAgentActivityShelf";
import { useConversationPresentation } from "@/features/channels/ui/useConversationPresentation";
import {
  isLucaGreeting,
  LUCA_INTRO_ROLE,
  ownerHasSpoken,
} from "@/features/luca/canonicalLucaResident";
import { useLucaArrival } from "@/features/luca/lucaArrival";
import { pendingReplyRows } from "@/features/messages/lib/pendingReplyRows";
import { LucaGreetingChoicesContext } from "@/features/luca/ui/lucaGreetingChoicesContext";
import {
  ResidentStopContext,
  type ResidentStopContextValue,
} from "@/features/messages/ui/residentStopContext";
import { useResidentStopControl } from "@/features/channels/ui/useResidentStopControl";
import { isTerminalConversationActivity } from "@/features/channels/ui/conversationAgentActivityShelf";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { useNativeAgentNotice } from "@/features/luca/useNativeAgentNotice";
import { useManagedPermissions } from "@/features/agents/useManagedPermissions";
import { ManagedPermissionCard } from "@/features/agents/ui/ManagedPermissionCard";
import { useRoomExchanges } from "@/features/exchange/exchangeStore";
import { useExchangeTurnRefresh } from "@/features/exchange/useExchangeSync";
import { ExchangeStrip } from "@/features/exchange/ui/ExchangeStrip";
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
import { buildMainTimelineEntries } from "@/features/messages/lib/threadPanel";
import { FocusedThreadBar } from "@/features/messages/ui/FocusedThreadBar";
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
  conversationContextOpen = false,
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
  onCancelDirectedReply,
  onCancelThreadReply,
  onBackFromAgentSession,
  onCloseAgentSession,
  onCloseChannelManagement,
  onCloseConversationContext,
  onChannelManagementDeleted,
  onCloseProfilePanel,
  onCloseThread,
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
  onOpenDm,
  onOpenMembers,
  onOpenProfilePanel,
  onBackToConversation,
  onOpenThread,
  onResetThreadPanelWidth,
  onSelectThreadReplyTarget,
  onSelectDirectedReplyTarget,
  onSendMessage,
  onSendDirectedReply,
  onSendVideoReviewComment,
  onSendThreadReply,
  onThreadPanelResizeStart,
  onTargetReached,
  onToggleReaction,
  unfollowThreadById,
  personaLookup,
  residentPersonaIdLookup,
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
  directedReplyTargetMessage,
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
  useNativeAgentNotice({ activeChannel, currentPubkey, messages });
  const lucaArrival = useLucaArrival({
    activeChannel,
    currentPubkey,
    messages,
  });
  const activePermissionRequests = React.useMemo(
    () =>
      pendingManagedPermissions.filter(
        (pending) => pending.request.conversationId === activeChannelId,
      ),
    [activeChannelId, pendingManagedPermissions],
  );
  // Live exchanges belonging to this room, plus a re-read of the relay's spent
  // count whenever a turn-tagged message lands here.
  const roomExchanges = useRoomExchanges(activeChannelId);
  useExchangeTurnRefresh(messages);
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
    isModerationDmChannel;
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
  const {
    agentActivityRows,
    composerWorkingBotPubkeys,
    managedActivity,
    pendingActivityByPubkey,
    presentationStateByPubkey,
  } = useConversationPresentation(activeChannelId);
  const managedResponseSlots = useManagedResponseSlots(activeChannelId);
  const handleRetryResident = React.useCallback(
    async ({ residentPubkey, uiKey }: ActivityShelfRetryTarget) => {
      if (!activeChannelId) return;
      const retry = resolveManagedPresentationRetry({
        currentPubkey,
        messages,
        residentPubkey,
        turn: getManagedPresentationTurn(uiKey),
      });
      if (!retry) {
        toast.error("The original request is no longer available to retry.");
        return;
      }
      try {
        await handleSendMessage(
          retry.content,
          [retry.residentPubkey],
          retry.mediaTags,
          activeChannelId,
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "The resident could not be retried.",
        );
      }
    },
    [activeChannelId, currentPubkey, handleSendMessage, messages],
  );
  const directMessageIntro = React.useMemo(() => {
    const intro = buildDirectMessageIntro({
      channel: activeChannel,
      currentPubkey,
      profiles,
    });
    if (!intro) return null;
    // The one resident whose role the app can vouch for. Other residents and
    // people carry their name alone; nothing is invented for them.
    return lucaArrival.isLucaDm ? { ...intro, role: LUCA_INTRO_ROLE } : intro;
  }, [activeChannel, currentPubkey, lucaArrival.isLucaDm, profiles]);
  const handleWelcomeAddAgent = React.useCallback(() => {
    onAddAgent?.({
      beforeSend: () =>
        messageTimelineRef.current?.scrollToBottomOnNextUpdate(),
    });
  }, [onAddAgent]);
  const handleSendDirectedMessage = React.useCallback(
    async (
      content: string,
      mentionPubkeys: string[],
      mediaTags?: string[][],
      channelId?: string | null,
    ) => {
      messageTimelineRef.current?.scrollToBottomOnNextUpdate();
      await onSendDirectedReply(content, mentionPubkeys, mediaTags, channelId);
    },
    [onSendDirectedReply],
  );
  const channelIntro = useChannelIntro({
    activeChannel,
    currentPubkey,
    onAddAgent,
    onBrowseChannels,
    onCreateChannel,
    onOpenMembers,
    onWelcomeAddAgent: onAddAgent ? handleWelcomeAddAgent : undefined,
  });
  const visibleMessages = React.useMemo(() => {
    const base = lucaArrival.visibleMessages;
    if (!isWelcomeExperience(activeChannel)) {
      return base;
    }

    return base.filter((message) => !isWelcomeSetupSystemMessage(message));
  }, [activeChannel, lucaArrival.visibleMessages]);
  // Luca's opening offer stays until the owner has said anything at all. It
  // renders inside Luca's greeting row; the pane supplies the send.
  const showLucaChoices =
    lucaArrival.isLucaDm &&
    !lucaArrival.arriving &&
    lucaArrival.lucaPubkey !== null &&
    currentPubkey !== undefined &&
    messages.some((message) =>
      isLucaGreeting(message, lucaArrival.lucaPubkey as string),
    ) &&
    !ownerHasSpoken(messages, currentPubkey);
  // In a direct conversation the reply row itself is the indicator — the
  // resident's mark carries the state and Stop sits on the row — so the
  // activity strip carries no live agent activity there. It still surfaces
  // the terminal states that need the owner (interrupted, needs attention),
  // because a resident who failed before saying anything has no row. Rooms
  // with several residents keep the full shelf.
  const isDirectConversation = activeChannel?.channelType === "dm";
  const stripActivity = isDirectConversation
    ? undefined
    : pendingActivityByPubkey;
  const attentionResidentKeys = React.useMemo(() => {
    if (!isDirectConversation) return null;
    const keys = new Set<string>();
    for (const [pubkey, state] of presentationStateByPubkey ?? []) {
      if (isTerminalConversationActivity(state)) {
        keys.add(normalizePubkey(pubkey));
      }
    }
    return keys;
  }, [isDirectConversation, presentationStateByPubkey]);
  const stripPresentationState = React.useMemo(() => {
    if (!attentionResidentKeys) return presentationStateByPubkey;
    return new Map(
      [...(presentationStateByPubkey ?? [])].filter(([pubkey]) =>
        attentionResidentKeys.has(normalizePubkey(pubkey)),
      ),
    );
  }, [attentionResidentKeys, presentationStateByPubkey]);
  const stripPresentationActivity = React.useMemo(() => {
    if (!attentionResidentKeys) return managedActivity;
    return new Map(
      [...(managedActivity ?? [])].filter(([pubkey]) =>
        attentionResidentKeys.has(normalizePubkey(pubkey)),
      ),
    );
  }, [attentionResidentKeys, managedActivity]);
  // Stop for the reply row. Keyed by normalized pubkey, as the row will ask.
  const stoppablePresentationActivity = React.useMemo(
    () =>
      new Map(
        [...(managedActivity ?? [])].map(([pubkey, activity]) => [
          normalizePubkey(pubkey),
          activity,
        ]),
      ),
    [managedActivity],
  );
  const residentStop = useResidentStopControl({
    channelId: activeChannelId,
    presentationActivity: stoppablePresentationActivity,
  });
  const residentStopContext = React.useMemo<ResidentStopContextValue | null>(
    () =>
      isDirectConversation && activeChannelId
        ? {
            canStop: (pubkey) => {
              const key = normalizePubkey(pubkey);
              const activity = stoppablePresentationActivity.get(key);
              if (!activity?.uiKey) return false;
              const state =
                residentStop.localStates.get(key) ??
                presentationStateByPubkey?.get(key) ??
                presentationStateByPubkey?.get(pubkey);
              // A resident still being started has no turn to cancel yet.
              if (state === "waking") return false;
              return state === undefined
                ? true
                : !isTerminalConversationActivity(state);
            },
            isStopping: (pubkey) =>
              residentStop.localStates.get(normalizePubkey(pubkey)) ===
              "stopping",
            onStop: (pubkey) => void residentStop.stopResidents([pubkey]),
          }
        : null,
    [
      activeChannelId,
      isDirectConversation,
      presentationStateByPubkey,
      residentStop.localStates,
      residentStop.stopResidents,
      stoppablePresentationActivity,
    ],
  );
  const lucaChoicesContext = React.useMemo(
    () => ({
      active: showLucaChoices,
      onChoose: (choice: string) =>
        onSendMessage(choice, [], undefined, activeChannelId),
    }),
    [activeChannelId, onSendMessage, showLucaChoices],
  );
  const stripWorkingPubkeys = React.useMemo(
    () => (isDirectConversation ? [] : composerWorkingBotPubkeys),
    [composerWorkingBotPubkeys, isDirectConversation],
  );
  // A reply is coming, here: one row per resident who is thinking or working
  // but has no text yet, at the tail of the conversation.
  const pendingRows = React.useMemo(
    () =>
      pendingReplyRows({
        managedActivity,
        observerActivity: agentActivityRows,
        slots: managedResponseSlots,
        profiles,
        residentPersonaIdLookup,
      }),
    [
      agentActivityRows,
      managedActivity,
      managedResponseSlots,
      profiles,
      residentPersonaIdLookup,
    ],
  );
  const projectedRoomMessages = React.useMemo(() => {
    const projected = projectManagedTimelineMessages(
      visibleMessages,
      managedResponseSlots,
      profiles,
      residentPersonaIdLookup,
      "timeline",
    ).messages;
    return pendingRows.length ? [...projected, ...pendingRows] : projected;
  }, [
    managedResponseSlots,
    pendingRows,
    profiles,
    residentPersonaIdLookup,
    visibleMessages,
  ]);
  const focusedThread = React.useMemo(
    () =>
      projectFocusedThreadTimeline({
        focusedHeadId: openThreadHeadId,
        managedResponseSlots,
        profiles,
        residentPersonaIdLookup,
        roomMessages: visibleMessages,
        threadHeadMessage,
        threadMessages,
      }),
    [
      managedResponseSlots,
      openThreadHeadId,
      profiles,
      residentPersonaIdLookup,
      threadHeadMessage,
      threadMessages,
      visibleMessages,
    ],
  );
  const focusedThreadHead = focusedThread.head;
  const projectedTimelineMessages = openThreadHeadId
    ? focusedThread.messages
    : projectedRoomMessages;
  const mainTimelineEntries = React.useMemo(
    () =>
      openThreadHeadId
        ? focusedThread.entries
        : buildMainTimelineEntries(
            projectedRoomMessages,
            new Set(),
            threadSummaries,
            profiles,
          ),
    [
      focusedThread.entries,
      openThreadHeadId,
      profiles,
      projectedRoomMessages,
      threadSummaries,
    ],
  );
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
      conversationContextOpen ||
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
    <LucaGreetingChoicesContext.Provider value={lucaChoicesContext}>
      <ResidentStopContext.Provider value={residentStopContext}>
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
                canDropInMainColumn
                  ? mainComposerMedia.handleDragEnter
                  : undefined
              }
              onDragLeave={
                canDropInMainColumn
                  ? mainComposerMedia.handleDragLeave
                  : undefined
              }
              onDragOver={
                canDropInMainColumn
                  ? mainComposerMedia.handleDragOver
                  : undefined
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
              {channelFind.isOpen ? (
                <div
                  className={cn("absolute inset-x-0 z-40", channelChrome.top)}
                >
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
              {focusedThreadHead ? (
                <FocusedThreadBar
                  authorName={focusedThreadHead.author}
                  onExit={onCloseThread}
                  replyCount={Math.max(0, mainTimelineEntries.length - 1)}
                />
              ) : null}
              <MessageTimeline
                ref={messageTimelineRef}
                channelId={activeChannel?.id}
                // The channel intro is the top of the ROOM. In the focused view you
                // are looking at one exchange, so showing "this is the beginning of
                // #general" above it is simply false.
                channelIntro={focusedThreadHead ? null : channelIntro}
                directMessageIntro={
                  focusedThreadHead ? null : directMessageIntro
                }
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
                messages={projectedTimelineMessages}
                firstUnreadMessageId={firstUnreadMessageId}
                unreadCount={unreadCount}
                onDelete={onDelete}
                onEdit={onEdit}
                onMarkUnread={onMarkUnread}
                onMarkRead={onMarkRead}
                expandedThreadHeadId={openThreadHeadId}
                onExpandThreadReplies={onExpandThreadReplies}
                onReply={
                  activeChannel?.archivedAt
                    ? undefined
                    : openThreadHeadId
                      ? onSelectThreadReplyTarget
                      : onSelectDirectedReplyTarget
                }
                onToggleThread={
                  activeChannel?.archivedAt ? undefined : onOpenThread
                }
                channelName={activeChannel?.name}
                channelType={activeChannel?.channelType ?? null}
                isSendingVideoReviewComment={isSending}
                onSendVideoReviewComment={
                  activeChannel?.archivedAt
                    ? undefined
                    : onSendVideoReviewComment
                }
                onTargetReached={onTargetReached}
                onToggleReaction={onToggleReaction}
                searchActiveMessageId={
                  channelFind.activeMatch?.messageId ?? null
                }
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
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-40 isolate"
                  data-testid="channel-composer-overlay"
                  ref={composerWrapperRef}
                >
                  <div className="pointer-events-none">
                    {roomExchanges.length > 0 ? (
                      <div className="pointer-events-auto mx-auto mb-2 grid w-full max-w-[48rem] gap-1">
                        {roomExchanges.map((exchange) => (
                          <ExchangeStrip
                            exchange={exchange}
                            key={exchange.record.exchangeId}
                            profiles={profiles}
                            residentPersonaIdLookup={residentPersonaIdLookup}
                          />
                        ))}
                      </div>
                    ) : null}
                    {activePermissionRequests.length > 0 ? (
                      <div className="pointer-events-auto mx-auto mb-2 grid w-full max-w-[48rem] gap-2">
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
                    <ConversationAgentActivityStrip
                      agents={activityAgents}
                      channelId={activeChannel?.id ?? null}
                      idleContent={
                        hasTypingActivity ? (
                          <TypingIndicatorRow
                            channel={activeChannel}
                            className="min-w-0 flex-1 py-0 pl-[calc(0.75rem+1px)] pr-0 sm:pl-[calc(1rem+1px)]"
                            currentPubkey={currentPubkey}
                            profiles={profiles}
                            typingPubkeys={typingPubkeys}
                          />
                        ) : null
                      }
                      onOpenResident={(pubkey) =>
                        onOpenProfilePanel(pubkey, { tab: "continuity" })
                      }
                      onRetryResident={(target) =>
                        void handleRetryResident(target)
                      }
                      sessionAgents={agentSessionAgents}
                      activityByPubkey={stripActivity}
                      presentationActivityByPubkey={stripPresentationActivity}
                      presentationStateByPubkey={stripPresentationState}
                      workingPubkeys={stripWorkingPubkeys}
                    />
                    <MessageComposer
                      channelId={activeChannel?.id ?? null}
                      channelName={activeChannel?.name ?? "channel"}
                      channelType={activeChannel?.channelType ?? null}
                      containerClassName="pointer-events-auto mx-auto w-full max-w-[48rem] px-0"
                      disabled={isComposerDisabled}
                      editTarget={mainEditTarget}
                      autoSubmitDraftKey={autoSendDraftKey}
                      onAutoSubmitComplete={handleAutoSubmitComplete}
                      isSending={false}
                      mediaController={mainComposerMedia}
                      onCancelEdit={onCancelEdit}
                      onCancelReply={
                        openThreadHeadId
                          ? onCancelThreadReply
                          : onCancelDirectedReply
                      }
                      onCaptureSendContext={
                        openThreadHeadId
                          ? () => ({
                              parentEventId:
                                threadReplyTargetMessage?.id ??
                                openThreadHeadId,
                              threadHeadId: openThreadHeadId,
                              replyAuthorPubkey:
                                threadReplyTargetMessage?.pubkey ??
                                threadHeadMessage?.pubkey ??
                                null,
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
                        openThreadHeadId
                          ? onSendThreadReply
                          : directedReplyTargetMessage
                            ? handleSendDirectedMessage
                            : handleSendMessage
                      }
                      profiles={profiles}
                      replyTarget={
                        openThreadHeadId
                          ? threadReplyTargetMessage
                          : directedReplyTargetMessage
                      }
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
                                    : `Message ${activeChannel.name}`
                                  : "Select a channel"
                      }
                      showTopBorder={false}
                      typingParentEventId={
                        openThreadHeadId
                          ? (threadReplyTargetMessage?.id ?? openThreadHeadId)
                          : (directedReplyTargetMessage?.id ?? null)
                      }
                      typingRootEventId={openThreadHeadId ?? null}
                    />
                  </div>
                </div>
              )}
              {canDropInMainColumn && mainComposerMedia.isDragOver ? (
                <DropZoneOverlay className="z-30 rounded-none" />
              ) : null}
            </section>
          ) : null}

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
          ) : conversationContextOpen && activeChannel ? (
            (() => {
              const panel = (
                <ConversationContextPanel
                  agents={agentSessionAgents}
                  canResetWidth={canResetThreadPanelWidth}
                  channel={activeChannel}
                  currentPubkey={currentPubkey}
                  isSinglePanelView={
                    useSplitAuxiliaryPane ? false : isSinglePanelView
                  }
                  layout={useSplitAuxiliaryPane ? "split" : "standalone"}
                  messages={visibleMessages}
                  onClose={onCloseConversationContext ?? (() => undefined)}
                  onManageParticipants={onOpenMembers ?? (() => undefined)}
                  onOpenResident={(pubkey) =>
                    onOpenProfilePanel(pubkey, { tab: "continuity" })
                  }
                  onResetWidth={onResetThreadPanelWidth}
                  onResizeStart={onThreadPanelResizeStart}
                  profiles={profiles}
                  transparentChrome={useSplitAuxiliaryPane}
                  widthPx={threadPanelWidthPx}
                />
              );
              return wrapAux(panel, "conversation-context-panel-shell");
            })()
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
                  onBackToConversation={onBackToConversation}
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
        </div>
      </ResidentStopContext.Provider>
    </LucaGreetingChoicesContext.Provider>
  );
});
