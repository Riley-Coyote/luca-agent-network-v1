import * as React from "react";
import { AnimatePresence } from "motion/react";

import {
  isDeferredTimelineSnapshotStale,
  isRenderedTimelineBehindHistoryPrepend,
  mergeUrgentOwnSendSuffix,
  selectRenderedTimelineEntries,
  selectTimelineBodySurface,
  selectTimelineIntroSurface,
} from "@/features/messages/lib/timelineSnapshot";
import { preloadTimelineImages } from "@/features/messages/lib/timelineImagePreload";
import { openVisitors } from "@/features/messages/lib/visitSpans";
import { useAgentNamesInMessages } from "@/features/messages/lib/conversationAppearancePreference";
import type { TimelineMessage } from "@/features/messages/types";
import type { ExchangeEntry } from "@/features/exchange/exchangeStore";
import type { MainTimelineEntry } from "@/features/messages/lib/threadPanel";
import type { ChannelWindowThreadSummary } from "@/features/messages/lib/channelWindowStore";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { ChannelType } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { formatDayHeading } from "@/features/messages/lib/dateFormatters";
import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { channelChrome } from "@/shared/layout/chromeLayout";
import { Spinner } from "@/shared/ui/spinner";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { UnreadPill, unreadCountLabel } from "@/shared/ui/UnreadPill";
import type { ChannelIntro } from "./ChannelIntroBlock";
import { FirstMessageSurface } from "./FirstMessageView";
import { TimelineSkeleton, useTimelineSkeletonRows } from "./TimelineSkeleton";
import { useShellLipPresenceSlot } from "@/app/shell/lipPresenceSlot";
import { ConversationPresence } from "@/features/channels/ui/ConversationPresence";
import { TimelineMessageList } from "./TimelineMessageList";
import { VisitPresenceRail } from "./VisitPresenceRail";
import type { TimelineVirtualizerApi } from "./TimelineMessageList";
import { isAtBottomNow, useAnchoredScroll } from "./useAnchoredScroll";
import { useLoadOlderOnScroll } from "./useLoadOlderOnScroll";
import { useBufferedTimelineMessages } from "./useBufferedTimelineMessages";
import type { DirectMessageIntro } from "@/features/channels/lib/dmParticipantDisplay";
import { useSettleGatedPrependMessages } from "./useSettleGatedPrependMessages";

function newResponseLabel(count: number): string {
  return count === 1 ? "New response" : `${count} new responses`;
}

export type MessageTimelineHandle = {
  scrollToBottomOnNextUpdate: () => void;
};

/** The page's gap between the companion's badge and the reading area under
 *  the shell (WP-29), as the room's stack keeps from the card's top. */
const TIMELINE_TOP_GAP = 12;
/** The room the next day's pill keeps above it as it pushes the stuck one
 *  up (WP-29). */
const STUCK_DAY_PUSH_GAP = 6;
/** Under the shell, what floats at the timeline's top starts where its
 *  reading area does: below the companion's badge while it shows (WP-29). */
const TIMELINE_TOP_STYLE: React.CSSProperties = {
  top: "calc(var(--luca-timeline-top-inset, 0px) + var(--buzz-channel-content-top-padding, 5.75rem))",
};
/** The reading area's top edge while it starts below the badge: the words
 *  fade out over the scroller's top padding (the card's top veil's ramp). */
const TIMELINE_TOP_FADE =
  "linear-gradient(to bottom, transparent, #000 var(--buzz-channel-content-top-padding, 22px))";

type MessageTimelineProps = {
  channelId?: string | null;
  channelIntro?: ChannelIntro | null;
  channelName?: string;
  channelType?: ChannelType | null;
  huddleMemberPubkeys?: readonly string[];
  huddleMemberPubkeysPending?: boolean;
  messages: TimelineMessage[];
  mainEntries?: MainTimelineEntry[];
  /** Relay thread summaries (root id → summary) for the deferred-pass entry
   *  fallback, so badge rows survive while a scrollback page commits. */
  threadSummaries?: ReadonlyMap<string, ChannelWindowThreadSummary>;
  directMessageIntro?: DirectMessageIntro | null;
  /** A direct conversation with a resident, before its first message: the
   *  timeline opens on still water with the conversation's ink in it. */
  firstMessageOpen?: boolean;
  /** The timeline shows one exchange (the focused view), under the shell:
   *  the new-messages pill sits below the day label, with room made for it
   *  (WP-14 review). */
  focusedView?: boolean;
  isLoading?: boolean;
  entranceMessageId?: string | null;
  onEntranceMessageComplete?: (messageId: string) => void;
  /** Acknowledge this exact admitted row after it has painted in the viewport. */
  presentationMessageId?: string | null;
  onMessagePresented?: (messageId: string) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  currentPubkey?: string;
  fetchOlder?: () => Promise<void>;
  hasOlderMessages?: boolean;
  /**
   * True when the loaded window provably starts at the channel's beginning
   * (a resolved tail page with `hasMore: false`) — NOT merely the absence of
   * a paging signal. Gates the oldest loaded day's divider.
   */
  historyExhausted?: boolean;
  /** Optional external ref to the scroll container — used by the parent to
   *  observe scroll position or adjust padding dynamically. */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  /** True when the timeline has the composer overlay below it. */
  hasComposerOverlay?: boolean;
  isFetchingOlder?: boolean;
  messageFooters?: Record<string, React.ReactNode>;
  /** Map from lowercase pubkey → persona display name for bot members. */
  personaLookup?: Map<string, string>;
  profiles?: UserProfileLookup;
  ownerProfiles?: UserProfileLookup;
  followThreadById?: (rootId: string) => void;
  isFollowingThreadById?: (rootId: string) => boolean;
  isMessageUnreadById?: (messageId: string) => boolean;
  onDelete?: (message: TimelineMessage) => void;
  onEdit?: (message: TimelineMessage) => void;
  onMarkUnread?: (message: TimelineMessage) => void;
  onMarkRead?: (message: TimelineMessage) => void;
  onReply?: (message: TimelineMessage) => void;
  onToggleThread?: (message: TimelineMessage) => void;
  onExpandThreadReplies?: (message: TimelineMessage) => void;
  expandedThreadHeadId?: string | null;
  isSendingVideoReviewComment?: boolean;
  onSendVideoReviewComment?: (
    message: TimelineMessage,
    content: string,
    mentionPubkeys: string[],
    mediaTags?: string[][],
    parentEventId?: string,
  ) => Promise<void>;
  unfollowThreadById?: (rootId: string) => void;
  onToggleReaction?: (
    message: TimelineMessage,
    emoji: string,
    remove: boolean,
  ) => Promise<void>;
  /** The message ID of the currently active find-in-channel match. */
  searchActiveMessageId?: string | null;
  /** Set of message IDs that match the current find-in-channel query. */
  searchMatchingMessageIds?: Set<string>;
  /** The current find-in-channel query string. */
  searchQuery?: string;
  targetMessageId?: string | null;
  onTargetReached?: (messageId: string) => void;
  splitThreadPanelOpen?: boolean;
  /** Event id of the oldest unread top-level message at channel open, or null. */
  firstUnreadMessageId?: string | null;
  exchangeEntries?: readonly ExchangeEntry[];
  onOpenExchange?: (exchangeId: string) => void;
  /** Count of unread top-level messages at channel open. */
  unreadCount?: number;
  /** Per-thread unread counts keyed by thread root id. */
  threadUnreadCounts?: ReadonlyMap<string, number>;
  /** Under the shell, the agent at the top of a conversation with one
   *  agent; the reading area starts below it. Memoize it: an object made
   *  fresh each render would re-render the whole timeline. */
  presence?: React.ComponentProps<typeof ConversationPresence> | null;
};

/** Stable empty reference used as the `useDeferredValue` initial value so the
 *  first render on channel entry stays light instead of blocking on the full
 *  message list. Must be module-level so its identity never changes. */
const EMPTY_MESSAGES: TimelineMessage[] = [];

type TimelineSnapshot = {
  channelId: string | null;
  messages: TimelineMessage[];
  mainEntries?: MainTimelineEntry[];
  /**
   * History-exhaustion proof captured with the SAME rows it was derived from.
   * The oldest-day divider may only exist when this is true, and rows and
   * proof must travel every transport stage (deferral, buffering, settle
   * gating) as one value: delivering a fresh proof on the urgent render path
   * while the rows ride the deferred path lets an intermediate commit mint a
   * divider against the previous, partially-loaded oldest day — which breaks
   * Virtua's exact-suffix shift admission when the withheld same-day rows
   * finally land (the pass-1 tear, ledgered 2026-07-11).
   */
  historyExhausted: boolean;
};

const EMPTY_TIMELINE_SNAPSHOT: TimelineSnapshot = {
  channelId: null,
  messages: EMPTY_MESSAGES,
  historyExhausted: false,
};

const MessageTimelineBase = React.forwardRef<
  MessageTimelineHandle,
  MessageTimelineProps
>(function MessageTimeline(
  {
    channelId,
    channelIntro = null,
    directMessageIntro = null,
    firstMessageOpen = false,
    focusedView = false,
    presence = null,
    messages,
    mainEntries,
    threadSummaries,
    isLoading = false,
    entranceMessageId = null,
    onEntranceMessageComplete,
    presentationMessageId = null,
    onMessagePresented,
    emptyTitle = "No messages yet",
    emptyDescription = "Send the first message to start the thread.",
    currentPubkey,
    fetchOlder,
    hasComposerOverlay = true,
    hasOlderMessages = true,
    historyExhausted = false,
    isFetchingOlder = false,
    followThreadById,
    huddleMemberPubkeys,
    huddleMemberPubkeysPending = false,
    isFollowingThreadById,
    isMessageUnreadById,
    messageFooters,
    personaLookup,
    profiles,
    ownerProfiles,
    onDelete,
    onEdit,
    onMarkUnread,
    onMarkRead,
    onReply,
    onToggleThread,
    onExpandThreadReplies,
    expandedThreadHeadId = null,
    channelName,
    channelType,
    isSendingVideoReviewComment = false,
    onSendVideoReviewComment,
    onToggleReaction,
    unfollowThreadById,
    scrollContainerRef: externalScrollRef,
    searchActiveMessageId = null,
    searchMatchingMessageIds,
    searchQuery,
    targetMessageId = null,
    onTargetReached,
    splitThreadPanelOpen = false,
    firstUnreadMessageId = null,
    exchangeEntries = [],
    onOpenExchange,
    unreadCount = 0,
    threadUnreadCounts,
  }: MessageTimelineProps,
  ref,
) {
  const agentNamesEnabled = useAgentNamesInMessages(currentPubkey);
  const visitorPubkeys = React.useMemo(
    () => openVisitors(messages),
    [messages],
  );
  const shellFrame = useShellFrameEnabled();
  const internalScrollRef = React.useRef<HTMLDivElement>(null);
  const scrollContainerRef = externalScrollRef ?? internalScrollRef;
  const contentRef = React.useRef<HTMLDivElement>(null);
  const topSentinelRef = React.useRef<HTMLDivElement>(null);
  const [virtualizerScrollParent, setVirtualizerScrollParent] =
    React.useState<HTMLDivElement | null>(null);
  const [virtualizerRenderVersion, bumpVirtualizerRenderVersion] =
    React.useReducer((version: number) => version + 1, 0);
  const [timelineVirtualizerApi, setTimelineVirtualizerApi] =
    React.useState<TimelineVirtualizerApi | null>(null);
  const useTimelineVirtualizer = true;
  const activeScrollContainerRef = React.useMemo(
    () => ({
      get current() {
        return virtualizerScrollParent ?? scrollContainerRef.current;
      },
    }),
    [scrollContainerRef, virtualizerScrollParent],
  );

  // Gate the heavy timeline render (each row runs a synchronous
  // react-markdown parse) behind React concurrency. `useDeferredValue` lets the
  // commit that rebuilds the message list yield to higher-priority work, so the
  // main thread stops freezing and the OS no longer shows the busy cursor when
  // entering a channel. We pass `initialValue: []` so even the FIRST render on
  // channel entry stays light — the heavy list streams in on a deferred commit
  // rather than blocking the initial paint. We deliberately drive BOTH the
  // scroll manager and the rendered list off the same deferred value —
  // scroll/autoscroll/deep-link logic reads the DOM (`scrollIntoView`,
  // ResizeObserver on the content), so it must stay consistent with what's
  // actually painted. You can't scroll to a row that hasn't committed yet.
  // Channel id travels with the deferred message snapshot. Without that guard, a
  // route change can paint the previous channel's deferred rows for a frame even
  // though the sidebar/header already moved to the new channel.
  const liveSnapshot = React.useMemo<TimelineSnapshot>(
    () => ({
      channelId: channelId ?? null,
      messages,
      mainEntries,
      historyExhausted,
    }),
    [channelId, historyExhausted, mainEntries, messages],
  );
  const deferredSnapshot = React.useDeferredValue(
    liveSnapshot,
    EMPTY_TIMELINE_SNAPSHOT,
  );
  const deferredMessages = deferredSnapshot.messages;
  const renderMessages = React.useMemo(
    () =>
      mergeUrgentOwnSendSuffix({
        currentPubkey,
        deferred: deferredMessages,
        live: messages,
        sameChannel: deferredSnapshot.channelId === liveSnapshot.channelId,
      }),
    [
      currentPubkey,
      deferredMessages,
      deferredSnapshot.channelId,
      liveSnapshot.channelId,
      messages,
    ],
  );
  const imagePreloadStateRef = React.useRef({
    activeImages: new Set<HTMLImageElement>(),
    requestedUrls: new Set<string>(),
  });
  React.useEffect(() => {
    preloadTimelineImages(messages, imagePreloadStateRef.current);
  }, [messages]);
  const isDeferredSnapshotStale = isDeferredTimelineSnapshotStale({
    deferredSnapshot,
    liveSnapshot,
  });
  const isRenderPending = deferredSnapshot !== liveSnapshot;
  const scrollRestorationId = targetMessageId
    ? `message-timeline:${channelId ?? "none"}:target:${targetMessageId}`
    : `message-timeline:${channelId ?? "none"}`;
  // Keep the scroll node's DOM lifetime scoped to a channel. TanStack Router's
  // scroll-restoration listener runs outside React and may write a saved
  // scrollTop into the current scroll element during navigation; reusing the
  // same node across channel routes can leave the newly-loaded message list
  // painted at a stale offset until the user's next scroll event forces layout.
  const scrollContainerDomKey = channelId ?? "none";

  React.useLayoutEffect(() => {
    // Re-read after `scrollContainerDomKey` swaps the keyed scroll DOM node.
    void scrollContainerDomKey;
    if (!useTimelineVirtualizer) {
      setVirtualizerScrollParent(scrollContainerRef.current);
    }
    setTimelineVirtualizerApi(null);
  }, [scrollContainerRef, scrollContainerDomKey]);

  const timelineBodySurface = selectTimelineBodySurface({
    deferredCount: renderMessages.length,
    hasPersistentIntro: channelIntro !== null || directMessageIntro !== null,
    isLoading: isLoading || isDeferredSnapshotStale,
    liveCount: messages.length,
  });
  const showTimelineSkeleton = timelineBodySurface === "skeleton";
  const [isSemanticallyAtBottom, setIsSemanticallyAtBottom] =
    React.useState(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset semantic tail state when the active channel changes
  React.useEffect(() => {
    setIsSemanticallyAtBottom(true);
  }, [channelId]);
  // Zulip-style data semantics: once the reader leaves the bottom, keep the
  // virtualizer's logical tail frozen. Live arrivals accumulate behind the
  // "new messages" affordance instead of changing Virtua's item model under
  // the reading position. Prepends still flow through immediately and Virtua's
  // `shift` transaction preserves the stable keyed row.
  const bufferedTimeline = useBufferedTimelineMessages({
    channelId,
    isAtBottom:
      isSemanticallyAtBottom ||
      targetMessageId !== null ||
      searchActiveMessageId !== null,
    messages: renderMessages,
  });
  const projectionMeta = React.useMemo(
    () => ({
      historyExhausted: deferredSnapshot.historyExhausted,
      mainEntries: selectRenderedTimelineEntries({
        messages: renderMessages,
        entries: deferredSnapshot.mainEntries,
        // Only the existing urgent own-send suffix may cross deferral.
        supplementalEntries:
          renderMessages !== deferredMessages ? mainEntries : undefined,
      }),
    }),
    [deferredMessages, deferredSnapshot, mainEntries, renderMessages],
  );
  // Hold older-page render commits until the scroller is at rest: WKWebView
  // can drop scrollTop compensation writes during live trackpad momentum.
  // Full rationale in useSettleGatedPrependMessages.
  //
  // The history-exhaustion proof rides through this gate as snapshot metadata
  // (`meta`), so while a prepend is withheld the rendered rows keep the proof
  // they were projected with. The buffering stage above cannot split the pair:
  // it only freezes the TAIL (live arrivals) and passes history prepends
  // through unchanged, so the oldest rows the proof speaks about are exactly
  // the deferred snapshot's oldest rows.
  const {
    messages: renderedMessages,
    meta: renderedProjectionMeta,
    isHoldingPrepend,
  } = useSettleGatedPrependMessages({
    channelId,
    messages: bufferedTimeline.messages,
    meta: projectionMeta,
    scrollElementRef: activeScrollContainerRef,
  });
  const renderedMainEntries = React.useMemo(
    () =>
      selectRenderedTimelineEntries({
        messages: renderedMessages,
        entries: renderedProjectionMeta.mainEntries,
      }),
    [renderedMessages, renderedProjectionMeta.mainEntries],
  );

  const {
    highlightedMessageId,
    isAtBottom,
    newMessageCount,
    onScroll,
    scrollToBottom,
    scrollToBottomOnNextUpdate,
    scrollToMessage,
    onVirtualizerAtBottomStateChange,
  } = useAnchoredScroll({
    channelId,
    contentRef,
    isLoading: showTimelineSkeleton,
    messages: renderedMessages,
    onTargetReached,
    scrollContainerRef: activeScrollContainerRef,
    splitPanelOpen: splitThreadPanelOpen,
    targetMessageId,
    virtualScrollToMessage: timelineVirtualizerApi?.scrollToMessage,
    virtualScrollToBottom: timelineVirtualizerApi?.scrollToBottom,
    virtualSettleAtBottom: timelineVirtualizerApi?.settleAtBottom,
    virtualizerOwnsPrependAnchoring: useTimelineVirtualizer,
    virtualizerRenderVersion,
  });

  const hasConfirmedVirtualizerBottomRef = React.useRef(false);
  const bottomConfirmationChannelRef = React.useRef(channelId);
  if (bottomConfirmationChannelRef.current !== channelId) {
    bottomConfirmationChannelRef.current = channelId;
    hasConfirmedVirtualizerBottomRef.current = false;
  }
  const suppressNextSemanticBottomRef = React.useRef(false);
  const forceSemanticBottomUntilSettledRef = React.useRef(false);
  const semanticAtBottomRef = React.useRef(isSemanticallyAtBottom);
  semanticAtBottomRef.current = isSemanticallyAtBottom;
  const semanticBottomRafRef = React.useRef<number | null>(null);
  const queueSemanticBottom = React.useCallback((atBottom: boolean) => {
    semanticAtBottomRef.current = atBottom;
    if (semanticBottomRafRef.current !== null) {
      window.cancelAnimationFrame(semanticBottomRafRef.current);
    }
    semanticBottomRafRef.current = window.requestAnimationFrame(() => {
      semanticBottomRafRef.current = null;
      setIsSemanticallyAtBottom(atBottom);
    });
  }, []);
  React.useEffect(
    () => () => {
      if (semanticBottomRafRef.current !== null) {
        window.cancelAnimationFrame(semanticBottomRafRef.current);
      }
    },
    [],
  );
  const handleVirtualizerAtBottomStateChange = React.useCallback(
    (atBottom: boolean) => {
      // Virtua can emit an intermediate non-bottom offset while its initial
      // scroll-to-end is still converging. Do not turn that mount transient
      // into a semantic dataset freeze: wait until this channel has reached a
      // confirmed bottom once, then track genuine bottom -> history movement.
      if (atBottom) {
        forceSemanticBottomUntilSettledRef.current = false;
        hasConfirmedVirtualizerBottomRef.current = true;
        onVirtualizerAtBottomStateChange(true);
        if (suppressNextSemanticBottomRef.current) {
          // Freezing the tail shortens Virtua's model and can itself make the
          // current offset report "at bottom". That synthetic transition must
          // not immediately release the snapshot and oscillate forever.
          suppressNextSemanticBottomRef.current = false;
        } else if (!semanticAtBottomRef.current) {
          queueSemanticBottom(true);
        }
      } else if (
        hasConfirmedVirtualizerBottomRef.current &&
        !forceSemanticBottomUntilSettledRef.current
      ) {
        onVirtualizerAtBottomStateChange(false);
        if (semanticAtBottomRef.current) {
          suppressNextSemanticBottomRef.current = true;
          queueSemanticBottom(false);
        }
      }
    },
    [onVirtualizerAtBottomStateChange, queueSemanticBottom],
  );

  // Under the shell, a room opens on its newest message and stays on it
  // until the owner moves (SHELL_BUILD.md WP-27, Decided 1): its stack
  // arrives, grows and folds after the first paint, and rows land late, above
  // as well as below; Virtua keeps the top row still for rows that land
  // above. So while the owner hasn't scrolled away, any change in the list's
  // size or the space under it is met at the bottom. Scrolling up lets go;
  // reaching the bottom again takes hold. A room opened on a message, or a
  // jump to one, starts let go.
  const holdBottomRef = React.useRef(!targetMessageId);
  const holdBottomForRef = React.useRef(channelId);
  if (holdBottomForRef.current !== channelId) {
    holdBottomForRef.current = channelId;
    holdBottomRef.current = !targetMessageId;
  }
  if (targetMessageId) holdBottomRef.current = false;
  // Each change asks for the bottom over the next frames, until the list has
  // settled there: Virtua measures new rows a frame or two after they commit.
  // Nothing here observes Virtua's own nodes, which it resizes inside its
  // ResizeObserver callback (WebKit then reports a loop).
  const holdBottomSoonRef = React.useRef<() => void>(() => {});
  React.useEffect(() => {
    const scroller = virtualizerScrollParent;
    if (!shellFrame || !scroller || typeof ResizeObserver === "undefined")
      return;
    let moved = false;
    let frame = 0;
    let frames = 0;
    let still = 0;
    const fromBottom = () =>
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const step = () => {
      frame = 0;
      if (!holdBottomRef.current) return;
      if (fromBottom() > 1) {
        still = 0;
        if (timelineVirtualizerApi)
          timelineVirtualizerApi.scrollToBottom("auto");
        else scroller.scrollTop = scroller.scrollHeight;
      } else still += 1;
      frames += 1;
      if (still < 4 && frames < 40) frame = window.requestAnimationFrame(step);
    };
    const hold = () => {
      frames = 0;
      still = 0;
      if (!frame) frame = window.requestAnimationFrame(step);
    };
    holdBottomSoonRef.current = hold;
    // Only a move away from the bottom lets go: a wheel or drag upwards, a
    // key that scrolls up, a press on the scrollbar. A click on a message
    // does not.
    const letGo = (event: Event) => {
      const up =
        event instanceof WheelEvent
          ? event.deltaY < 0
          : event instanceof KeyboardEvent
            ? ["ArrowUp", "Home", "PageUp"].includes(event.key)
            : event instanceof PointerEvent
              ? event.offsetX > scroller.clientWidth
              : true;
      if (!up) return;
      moved = true;
      holdBottomRef.current = false;
    };
    const onScroll = () => {
      if (moved && fromBottom() <= 2) {
        moved = false;
        holdBottomRef.current = true;
      }
    };
    // The room's own size, and the stack under it (the composer's overlay):
    // neither is Virtua's.
    const sizes = new ResizeObserver(hold);
    sizes.observe(scroller);
    const overlay = scroller
      .closest('[data-testid="channel-drop-zone"]')
      ?.querySelector('[data-testid="channel-composer-overlay"]');
    if (overlay) sizes.observe(overlay);
    const inputs = ["wheel", "touchmove", "pointerdown", "keydown"] as const;
    for (const name of inputs)
      scroller.addEventListener(name, letGo, { passive: true });
    scroller.addEventListener("scroll", onScroll, { passive: true });
    hold();
    return () => {
      window.cancelAnimationFrame(frame);
      holdBottomSoonRef.current = () => {};
      sizes.disconnect();
      for (const name of inputs) scroller.removeEventListener(name, letGo);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [shellFrame, timelineVirtualizerApi, virtualizerScrollParent]);
  // Rows that land, wherever they sort.
  React.useEffect(() => {
    void renderedMessages;
    holdBottomSoonRef.current();
  }, [renderedMessages]);

  // ── the timeline's top edge, under the shell (SHELL_BUILD.md WP-29) ──
  // The day you're reading always shows, just inside the card's top: a
  // virtualized list can't keep one day's pill stuck across that day's rows
  // (each pill sticks only inside its own row), so once a day's own pill has
  // gone up past the line, this one stands in for it there, and the passed
  // one hides. While the companion's badge shows over the conversation, the
  // reading area starts below it, by the page's gap, so nothing is ever
  // under the badge; the stuck pill sits below it. When the badge goes, the
  // area returns, and the bottom-hold keeps the newest message in place.
  // Under the agent's mark alone (Riley, Nov 2: "the text should just run to
  // near the top and blur out as it leaves the page and goes behind the
  // mark") the area keeps the card's top: only its first words start below
  // the mark, and the words scrolling up run on under it, through the top
  // edge (conversation-shell.css), the days' pills with them.
  const timelineRootRef = React.useRef<HTMLDivElement>(null);
  const stuckDayRef = React.useRef<HTMLDivElement>(null);
  const messageTimesRef = React.useRef(new Map<string, number>());
  messageTimesRef.current = React.useMemo(
    () =>
      new Map(
        renderedMessages.map((message) => [message.id, message.createdAt]),
      ),
    [renderedMessages],
  );
  const placeTopEdgeRef = React.useRef<() => void>(() => {});
  const hasPresence = shellFrame && presence !== null;
  const presenceSlot = useShellLipPresenceSlot();
  React.useEffect(() => {
    const scroller = virtualizerScrollParent;
    const root = timelineRootRef.current;
    const stuck = stuckDayRef.current;
    const viewport = scrollContainerRef.current;
    if (!shellFrame || !scroller || !root || !stuck || !viewport) return;
    const label = stuck.firstElementChild as HTMLElement | null;
    let frame = 0;
    const place = () => {
      frame = 0;
      const rootBox = root.getBoundingClientRect();
      // The badge: the reading area starts the page's gap below it.
      const badge = document
        .querySelector(".polyphonic-control-badge")
        ?.getBoundingClientRect();
      // The agent at the top of a one-agent conversation, risen into the
      // lip (its presence slot): the same rule.
      const presenceBox = hasPresence
        ? presenceSlot
            ?.querySelector("[data-luca-presence]")
            ?.getBoundingClientRect()
        : undefined;
      const presenceShown = presenceBox !== undefined && presenceBox.height > 0;
      const badgeInset =
        badge &&
        badge.left < rootBox.right &&
        badge.right > rootBox.left &&
        badge.bottom > rootBox.top
          ? Math.ceil(badge.bottom - rootBox.top + TIMELINE_TOP_GAP)
          : 0;
      const presenceInset =
        presenceBox && presenceShown
          ? Math.ceil(presenceBox.bottom - rootBox.top + TIMELINE_TOP_GAP)
          : 0;
      const inset = Math.max(badgeInset, presenceInset);
      // Under the mark alone, the words run on under it; under the badge,
      // the area itself starts below.
      const under = presenceInset > 0 && badgeInset === 0;
      const offset = inset > 0 ? `${inset}px` : "";
      const top = under ? "" : offset;
      if (
        viewport.style.top !== top ||
        root.style.getPropertyValue("--luca-timeline-top-inset") !== offset ||
        root.hasAttribute("data-luca-top-edge") !== under
      ) {
        viewport.style.top = top;
        // What floats at the timeline's top starts here either way.
        if (offset) root.style.setProperty("--luca-timeline-top-inset", offset);
        else root.style.removeProperty("--luca-timeline-top-inset");
        root.toggleAttribute("data-luca-top-edge", under);
        // An area started below the badge fades over the scroller's top
        // padding, as the card's top veil does where the badge isn't.
        const fade = top ? TIMELINE_TOP_FADE : "";
        viewport.style.maskImage = fade;
        viewport.style.setProperty("-webkit-mask-image", fade);
        holdBottomSoonRef.current();
      }
      // The line a stuck pill sits on: the scroller's padding edge, or under
      // the mark the card's top, which nothing is caught on.
      const box = scroller.getBoundingClientRect();
      const line =
        box.top +
        scroller.clientTop +
        (under
          ? 0
          : Number.parseFloat(getComputedStyle(scroller).paddingTop || "0"));
      // The day of the first row read below the line.
      let first: { top: number; time: number } | null = null;
      for (const row of scroller.querySelectorAll<HTMLElement>(
        "[data-message-id]",
      )) {
        const time = messageTimesRef.current.get(row.dataset.messageId ?? "");
        if (time === undefined) continue;
        const r = row.getBoundingClientRect();
        if (r.height === 0 || r.bottom <= line + 1 || r.top >= box.bottom)
          continue;
        if (!first || r.top < first.top) first = { top: r.top, time };
      }
      const day = first ? formatDayHeading(first.time) : null;
      // Each day's own pill: hidden once it has gone up past the line; one
      // standing on the line is the stuck pill itself. The next day's pill,
      // coming up from below, pushes the stand-in up ahead of it (clipped at
      // the card's top), so the two never overlap and the line is never
      // empty while that day is read.
      let own: "passed" | "here" | "below" | null = null;
      let incoming = Number.POSITIVE_INFINITY;
      const pillHeight = label?.offsetHeight || 26;
      for (const divider of scroller.querySelectorAll<HTMLElement>(
        '[data-testid="message-timeline-day-divider"]',
      )) {
        const pill = divider.firstElementChild?.getBoundingClientRect();
        if (!pill) continue;
        const passed = pill.top < line - 0.5;
        divider.toggleAttribute("data-day-passed", passed);
        // Caught on the line over the words scrolling under it: its glass
        // gathers (conversation-shell.css, "the day, said plainly").
        divider.toggleAttribute(
          "data-day-stuck",
          !passed && pill.top <= line + 0.5,
        );
        if (!passed && pill.top > line + 0.5)
          incoming = Math.min(incoming, pill.top);
        if (divider.dataset.dayLabel === day)
          own = passed ? "passed" : pill.top <= line + 0.5 ? "here" : "below";
      }
      // Under the agent's mark and line, a third thing stacked at the top
      // is one too many: each day's own pill still passes in the flow.
      const show =
        !presenceShown && day !== null && (own === null || own === "passed");
      stuck.toggleAttribute("data-shown", show);
      if (label && day !== null && label.textContent !== day)
        label.textContent = day;
      const at = Math.min(line, incoming - pillHeight - STUCK_DAY_PUSH_GAP);
      stuck.style.top = `${at - rootBox.top}px`;
      stuck.style.left = `${box.left + scroller.clientLeft - rootBox.left}px`;
      stuck.style.width = `${scroller.clientWidth}px`;
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(place);
    };
    placeTopEdgeRef.current = schedule;
    const sizes = new ResizeObserver(schedule);
    sizes.observe(root);
    sizes.observe(scroller);
    // The badge comes and goes as a child of the body (a portal).
    const portals = new MutationObserver(schedule);
    portals.observe(document.body, { childList: true });
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    place();
    return () => {
      window.cancelAnimationFrame(frame);
      placeTopEdgeRef.current = () => {};
      sizes.disconnect();
      portals.disconnect();
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      viewport.style.top = "";
      root.style.removeProperty("--luca-timeline-top-inset");
      root.removeAttribute("data-luca-top-edge");
      viewport.style.maskImage = "";
      viewport.style.removeProperty("-webkit-mask-image");
      for (const divider of scroller.querySelectorAll(
        "[data-day-passed], [data-day-stuck]",
      )) {
        divider.removeAttribute("data-day-passed");
        divider.removeAttribute("data-day-stuck");
      }
    };
  }, [
    hasPresence,
    presenceSlot,
    scrollContainerRef,
    shellFrame,
    virtualizerScrollParent,
  ]);
  React.useEffect(() => {
    void renderedMessages;
    placeTopEdgeRef.current();
  }, [renderedMessages]);

  const timelineIntroSurface = selectTimelineIntroSurface({
    hasChannelIntro: channelIntro !== null && directMessageIntro === null,
    hasDirectMessageIntro: directMessageIntro !== null,
    hasReachedChannelStart:
      !isRenderedTimelineBehindHistoryPrepend(deferredMessages, messages) &&
      !isHoldingPrepend &&
      (messages.length === 0 || (!hasOlderMessages && !isFetchingOlder)),
    isSkeletonVisible: showTimelineSkeleton,
  });
  // A fresh DM opens bare, straight at its first message — the glyph-and-name
  // intro block is retired. The surface selector still classifies DM-intro
  // eligibility so those conversations stay bare instead of getting the
  // generic dashed placeholder.
  // Conversations open directly on their timeline. Channel and DM identity
  // remain in the compact header instead of consuming a second intro surface.
  const showIntro = false;
  const showGenericEmpty =
    timelineBodySurface === "empty" && timelineIntroSurface === null;
  const showMessageList = timelineBodySurface === "list";
  const showChannelIntroOnly = false;
  const presentationAdmitted =
    presentationMessageId !== null &&
    renderedMessages.some((message) => message.id === presentationMessageId);
  React.useEffect(() => {
    // Cancel this observer even if another channel reuses the same event ID.
    void channelId;
    if (
      !presentationMessageId ||
      !onMessagePresented ||
      !showMessageList ||
      !presentationAdmitted
    )
      return;
    let frame = 0;
    let visibleLastFrame = false;
    const observe = () => {
      const scroller = activeScrollContainerRef.current;
      const row = scroller?.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(presentationMessageId)}"]`,
      );
      const bounds = row?.getBoundingClientRect();
      const viewport = scroller?.getBoundingClientRect();
      const visible = Boolean(
        bounds &&
          viewport &&
          bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.bottom > Math.max(0, viewport.top) &&
          bounds.top < Math.min(window.innerHeight, viewport.bottom) &&
          bounds.right > Math.max(0, viewport.left) &&
          bounds.left < Math.min(window.innerWidth, viewport.right),
      );
      if (visible && visibleLastFrame) {
        onMessagePresented(presentationMessageId);
        return;
      }
      visibleLastFrame = visible;
      frame = window.requestAnimationFrame(observe);
    };
    frame = window.requestAnimationFrame(observe);
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeScrollContainerRef,
    channelId,
    onMessagePresented,
    presentationAdmitted,
    presentationMessageId,
    showMessageList,
  ]);

  const prepareForOwnMessage = React.useCallback(() => {
    // The user's own send is the deliberate Zulip exception: release buffered
    // output before arming the next-append bottom pin so the sent row can enter
    // Virtua's model and become the new physical floor.
    forceSemanticBottomUntilSettledRef.current = true;
    semanticAtBottomRef.current = true;
    setIsSemanticallyAtBottom(true);
    scrollToBottomOnNextUpdate();
  }, [scrollToBottomOnNextUpdate]);

  React.useImperativeHandle(
    ref,
    () => ({
      scrollToBottomOnNextUpdate: prepareForOwnMessage,
    }),
    [prepareForOwnMessage],
  );

  // Jump-to-message is purely DOM-based now: all loaded rows are mounted, so
  // `scrollToMessage` always finds the target row. No virtualizer convergence.
  const jumpToMessage = React.useCallback(
    (messageId: string, options?: { behavior?: ScrollBehavior }) => {
      holdBottomRef.current = false;
      return scrollToMessage(messageId, { highlight: true, ...options });
    },
    [scrollToMessage],
  );

  // The unread pill is a transient, per-open affordance: dismiss it once the
  // user acts on it (jumps to the oldest unread) or catches up by reaching the
  // bottom of the timeline. Reset when the channel changes so a freshly opened
  // channel shows its own pill.
  const [isUnreadPillDismissed, setIsUnreadPillDismissed] =
    React.useState(false);
  // The pill points up at unread history the reader cannot see, so it earns
  // its place only once a settled look at the scroller has confirmed there is
  // something above the fold to jump to. It is not shown before that look:
  // the rows a fresh channel commits are not always the rows it settles with.
  const [isUnreadPillEarned, setIsUnreadPillEarned] = React.useState(false);
  // Track whether the pill has been shown at least once this channel visit.
  // This prevents the dismiss effect from firing on mount (when isAtBottom
  // initializes as true) before the pill ever renders.
  const hasShownPillRef = React.useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on channel switch only
  React.useEffect(() => {
    setIsUnreadPillDismissed(false);
    setIsUnreadPillEarned(false);
    hasShownPillRef.current = false;
  }, [channelId]);
  React.useEffect(() => {
    if (isAtBottom && hasShownPillRef.current) {
      setIsUnreadPillDismissed(true);
    }
  }, [isAtBottom]);
  const unreadPillCandidate =
    !isUnreadPillDismissed &&
    unreadCount > 0 &&
    firstUnreadMessageId !== null &&
    !showTimelineSkeleton;
  const showUnreadPill = unreadPillCandidate && isUnreadPillEarned;
  if (showUnreadPill) hasShownPillRef.current = true;
  // The look itself. At the floor with the oldest unread row on screen — a
  // short conversation, a few new lines at the tail of a long one, a reply
  // taller than the fold that is being read — there is nothing to jump to
  // and the pill is dismissed. At the floor with that row above the fold, or
  // unrealized by the virtualizer (off screen by construction), or away from
  // the floor altogether, the pill is earned. The floor is measured live from
  // the DOM, after the anchor's own settle frame; the row is any part on
  // screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: virtualizerRenderVersion re-checks once the virtualizer realizes rows near the fold
  React.useLayoutEffect(() => {
    if (!unreadPillCandidate || !firstUnreadMessageId) return;
    const container = activeScrollContainerRef.current;
    if (!container) return;
    const look = () => {
      if (container.clientHeight === 0) return;
      if (!isAtBottomNow(container)) {
        setIsUnreadPillEarned(true);
        return;
      }
      const row = container.querySelector(
        `[data-message-id="${CSS.escape(firstUnreadMessageId)}"]`,
      );
      if (!row) {
        setIsUnreadPillEarned(true);
        return;
      }
      const rowRect = row.getBoundingClientRect();
      const fold = container.getBoundingClientRect();
      // Under the agent's mark the words run on up under it, going soft
      // (conversation-shell.css, "the top edge"): a row there is not read
      // yet, so the fold starts where the words come clear.
      const clear =
        fold.top +
        (Number.parseFloat(
          getComputedStyle(container).getPropertyValue("--luca-timeline-rise"),
        ) || 0);
      if (rowRect.height === 0) return;
      if (rowRect.bottom > clear + 1 && rowRect.top < fold.bottom - 1) {
        setIsUnreadPillDismissed(true);
      } else {
        setIsUnreadPillEarned(true);
      }
    };
    const settle = requestAnimationFrame(() => {
      requestAnimationFrame(look);
    });
    container.addEventListener("scroll", look, { passive: true });
    return () => {
      cancelAnimationFrame(settle);
      container.removeEventListener("scroll", look);
    };
  }, [
    activeScrollContainerRef,
    firstUnreadMessageId,
    unreadPillCandidate,
    virtualizerRenderVersion,
  ]);
  const handleJumpToOldestUnread = React.useCallback(() => {
    setIsUnreadPillDismissed(true);
    if (firstUnreadMessageId) {
      jumpToMessage(firstUnreadMessageId);
    }
  }, [firstUnreadMessageId, jumpToMessage]);

  // Scroll to the active search match when it changes. `jumpToMessage` updates
  // the scroll anchor (so the post-commit restore won't yank the view back off
  // the match) and, when virtualized, converges on the target through the index
  // model — the row may be windowed out of the DOM.
  const prevSearchActiveRef = React.useRef<string | null>(null);
  const pendingSearchTargetRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (showTimelineSkeleton) return;
    if (!searchActiveMessageId) {
      pendingSearchTargetRef.current = null;
    }
    if (
      !searchActiveMessageId ||
      searchActiveMessageId === prevSearchActiveRef.current
    ) {
      prevSearchActiveRef.current = searchActiveMessageId;
      return;
    }
    pendingSearchTargetRef.current = null;
    prevSearchActiveRef.current = searchActiveMessageId;
    if (!jumpToMessage(searchActiveMessageId, { behavior: "smooth" })) {
      pendingSearchTargetRef.current = searchActiveMessageId;
    }
  }, [jumpToMessage, searchActiveMessageId, showTimelineSkeleton]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: deferredMessages and virtualizerRenderVersion are intentional retry triggers — a search hit may be spliced into messages asynchronously, and in virtualized mode a phase-1 index jump only realizes the row; retry when the rendered range changes so the DOM-visible path can center and highlight it.
  React.useEffect(() => {
    const target = pendingSearchTargetRef.current;
    if (!target || showTimelineSkeleton) return;
    if (
      useTimelineVirtualizer &&
      !activeScrollContainerRef.current?.querySelector(
        `[data-message-id="${CSS.escape(target)}"]`,
      )
    ) {
      // Phase 1: ask the virtualizer to realize the match's index. The retry effect
      // runs again on range change and the DOM-visible path does the actual
      // center + highlight once the row exists.
      void jumpToMessage(target, { behavior: "auto" });
      return;
    }
    if (jumpToMessage(target, { behavior: "auto" })) {
      pendingSearchTargetRef.current = null;
    }
  }, [
    deferredMessages,
    jumpToMessage,
    showTimelineSkeleton,
    virtualizerRenderVersion,
  ]);

  const loadOlderViaVirtualizer = React.useCallback((): boolean => {
    // Indexed find navigation can legitimately land near the current history
    // boundary. Do not mistake that programmatic jump for scrollback intent and
    // prepend underneath the active match.
    // A settle-gate hold means the reader is still parked at the OLD
    // boundary — don't stack more page fetches behind the held commit.
    if (
      searchActiveMessageId ||
      !fetchOlder ||
      isFetchingOlder ||
      isHoldingPrepend ||
      showTimelineSkeleton ||
      !hasOlderMessages
    ) {
      return false;
    }
    void fetchOlder();
    return true;
  }, [
    fetchOlder,
    hasOlderMessages,
    isFetchingOlder,
    isHoldingPrepend,
    searchActiveMessageId,
    showTimelineSkeleton,
  ]);

  useLoadOlderOnScroll({
    fetchOlder: useTimelineVirtualizer ? undefined : fetchOlder,
    hasOlderMessages,
    isLoading: showTimelineSkeleton,
    scrollContainerRef: activeScrollContainerRef,
    sentinelRef: topSentinelRef,
  });

  const timelineSkeletonRows = useTimelineSkeletonRows({
    channelId,
    isLoading: showTimelineSkeleton,
    messages: showTimelineSkeleton ? EMPTY_MESSAGES : deferredMessages,
  });

  const virtualizedLeadingContent = null;

  const handleVirtualizerRangeChanged = React.useCallback(() => {
    bumpVirtualizerRenderVersion();
  }, []);

  const timelineList = showMessageList ? (
    <TimelineMessageList
      key={scrollContainerDomKey}
      channelId={channelId}
      channelName={channelName}
      channelType={channelType}
      currentPubkey={currentPubkey}
      firstUnreadMessageId={firstUnreadMessageId}
      exchangeEntries={exchangeEntries}
      followThreadById={followThreadById}
      highlightedMessageId={highlightedMessageId}
      huddleMemberPubkeys={huddleMemberPubkeys}
      huddleMemberPubkeysPending={huddleMemberPubkeysPending}
      isFollowingThreadById={isFollowingThreadById}
      isMessageUnreadById={isMessageUnreadById}
      entranceMessageId={entranceMessageId}
      onEntranceMessageComplete={onEntranceMessageComplete}
      messageFooters={messageFooters}
      mainEntries={renderedMainEntries}
      leadingContent={virtualizedLeadingContent}
      historyExhausted={renderedProjectionMeta.historyExhausted}
      threadSummaries={threadSummaries}
      messages={renderedMessages}
      onDelete={onDelete}
      onEdit={onEdit}
      onOpenExchange={onOpenExchange}
      onMarkUnread={onMarkUnread}
      onMarkRead={onMarkRead}
      onReply={onReply}
      onToggleThread={onToggleThread}
      onExpandThreadReplies={onExpandThreadReplies}
      expandedThreadHeadId={expandedThreadHeadId}
      isSendingVideoReviewComment={isSendingVideoReviewComment}
      onSendVideoReviewComment={onSendVideoReviewComment}
      onStartReached={loadOlderViaVirtualizer}
      onToggleReaction={onToggleReaction}
      onVirtualizerApiChange={setTimelineVirtualizerApi}
      onVirtualizerRangeChanged={handleVirtualizerRangeChanged}
      onVirtualizerScrollerChange={setVirtualizerScrollParent}
      onAtBottomStateChange={handleVirtualizerAtBottomStateChange}
      personaLookup={personaLookup}
      profiles={profiles}
      agentNamesEnabled={agentNamesEnabled}
      ownerProfiles={ownerProfiles}
      searchActiveMessageId={searchActiveMessageId}
      searchMatchingMessageIds={searchMatchingMessageIds}
      searchQuery={searchQuery}
      useVirtualizer={useTimelineVirtualizer}
      threadUnreadCounts={threadUnreadCounts}
      unfollowThreadById={unfollowThreadById}
    />
  ) : null;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        data-focused-view={focusedView ? "" : undefined}
        ref={timelineRootRef}
      >
        {/* Under everything else in the timeline: the water paints first.
            Under the frame the film is a small pool around the face, which
            the greeting holds (FirstMessageView.tsx). */}
        <AnimatePresence>
          {firstMessageOpen && !shellFrame ? (
            <FirstMessageSurface key={channelId ?? "none"} />
          ) : null}
        </AnimatePresence>
        <VisitPresenceRail visitorPubkeys={visitorPubkeys} />
        {hasPresence && presence ? (
          <ConversationPresence {...presence} />
        ) : null}
        {showUnreadPill ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4",
              // Under the shell, below the day stuck at the top, never on it
              // (WP-29), as the focused view has always placed it.
              focusedView || shellFrame ? "translate-y-9" : "translate-y-3",
              channelChrome.top,
            )}
            style={shellFrame ? TIMELINE_TOP_STYLE : undefined}
          >
            <UnreadPill
              direction="up"
              label={unreadCountLabel(unreadCount)}
              onClick={handleJumpToOldestUnread}
              testId="message-unread-pill"
            />
          </div>
        ) : null}
        {/* `isFetchingOlder` clears on fetch resolve, but rows paint a frame
            later (deferred snapshot / settle-gate hold) — keep the spinner up
            until the page actually renders. */}
        {isFetchingOlder ||
        isHoldingPrepend ||
        isRenderedTimelineBehindHistoryPrepend(deferredMessages, messages) ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 z-30 flex translate-y-3 justify-center px-4",
              channelChrome.top,
            )}
            data-testid="message-timeline-fetching-older"
            style={shellFrame ? TIMELINE_TOP_STYLE : undefined}
          >
            <span className="flex items-center rounded-full bg-background/80 p-1.5 shadow-sm ring-1 ring-border/40 backdrop-blur-sm">
              <Spinner className="h-4 w-4 border-2 text-muted-foreground" />
            </span>
          </div>
        ) : null}
        <div
          className={cn(
            "absolute inset-0 overflow-hidden",
            (!useTimelineVirtualizer || !showMessageList) &&
              cn(
                "overflow-y-auto overflow-x-hidden overscroll-contain px-2 pt-1",
                hasComposerOverlay
                  ? "pb-[var(--composer-overlay-height,6rem)]"
                  : "pb-4",
              ),
          )}
          data-luca-timeline-viewport
          data-buzz-conversation-scroll={
            useTimelineVirtualizer && showMessageList ? undefined : "true"
          }
          data-scroll-restoration-id={scrollRestorationId}
          data-testid={
            useTimelineVirtualizer && showMessageList
              ? undefined
              : "message-timeline"
          }
          key={scrollContainerDomKey}
          onScroll={useTimelineVirtualizer ? undefined : onScroll}
          ref={scrollContainerRef}
        >
          {useTimelineVirtualizer && timelineList ? (
            <div
              className="h-full min-h-0 w-full"
              data-render-pending={isRenderPending ? "true" : undefined}
            >
              {timelineList}
            </div>
          ) : (
            <div
              className={cn(
                "flex w-full flex-col gap-2",
                showChannelIntroOnly
                  ? "pt-[var(--channel-top-chrome-height,4.5rem)]"
                  : channelChrome.contentPadding,
                (showIntro || showGenericEmpty || showMessageList) &&
                  "min-h-full",
              )}
              ref={contentRef}
            >
              {showChannelIntroOnly ? null : (
                <div ref={topSentinelRef} aria-hidden className="h-px" />
              )}

              {/* Fixed-height history slot keeps the virtual spacer's offset
                  stable across load-older fetches. The intro-only state has no
                  history to anchor, so omitting it matches the virtualized
                  leading row's top geometry when the first message arrives. */}
              {showChannelIntroOnly ? null : (
                <div aria-hidden className="h-8" />
              )}

              <div
                className={cn(
                  "flex min-h-[18rem] min-w-0 flex-col gap-2",
                  useTimelineVirtualizer && "min-h-0 flex-1",
                  (showIntro || showGenericEmpty) && "min-h-full",
                  showMessageList &&
                    !showIntro &&
                    !useTimelineVirtualizer &&
                    "mt-auto",
                )}
              >
                {showTimelineSkeleton ? (
                  <TimelineSkeleton rows={timelineSkeletonRows} />
                ) : null}
                {showGenericEmpty ? (
                  <div
                    className="mt-auto rounded-2xl border border-dashed border-border/80 bg-card/70 px-6 py-10 text-center shadow-xs"
                    data-testid="message-empty"
                  >
                    <p className="text-base font-semibold tracking-tight">
                      {emptyTitle}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {emptyDescription}
                    </p>
                  </div>
                ) : null}

                {showMessageList ? (
                  <div
                    className={cn(
                      "flex flex-col gap-2",
                      !showIntro && !useTimelineVirtualizer && "mt-auto",
                      useTimelineVirtualizer && "min-h-0 flex-1",
                    )}
                    data-render-pending={isRenderPending ? "true" : undefined}
                  >
                    {timelineList}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {shellFrame ? (
          // Under the agent's mark, the words going soft as they leave
          // (conversation-shell.css, "the top edge"), drawn while the root
          // says the words run on under it.
          <div aria-hidden className="luca-top-edge">
            <span className="luca-top-edge-blur" />
            <span className="luca-top-edge-blur" />
            <span className="luca-top-edge-blur" />
            <span className="luca-top-edge-blur" />
            <span className="luca-top-edge-blur" />
          </div>
        ) : null}
        {shellFrame ? (
          // The day you're reading, stuck at the card's top once its own
          // pill has gone up past it (WP-29); placed and named by the
          // top-edge effect above, drawn as DayDivider draws its pill.
          <div
            aria-hidden
            className="pointer-events-none absolute z-20 hidden justify-center px-2 data-[shown]:flex"
            data-testid="message-timeline-stuck-day"
            ref={stuckDayRef}
          >
            {/* The label takes the pointer, as a solid thing over the
                words would: nothing under its glass is readable anyway. */}
            <p
              className="luca-day-label pointer-events-auto relative z-10 shrink-0"
              data-stuck=""
            />
          </div>
        ) : null}
        {!isAtBottom ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 z-50 flex justify-center px-4",
              // Under the shell, above the room's stack, never across a row
              // of it (WP-23, Decided 4): ChannelPane measures the overlay.
              hasComposerOverlay
                ? shellFrame
                  ? "bottom-[calc(var(--luca-composer-overlay-height,9rem)+0.75rem)]"
                  : "bottom-36"
                : "bottom-4",
            )}
          >
            <UnreadPill
              direction="down"
              label={
                bufferedTimeline.pendingCount > 0
                  ? newResponseLabel(bufferedTimeline.pendingCount)
                  : newMessageCount > 0
                    ? newResponseLabel(newMessageCount)
                    : "Jump to latest"
              }
              onClick={() => {
                setIsSemanticallyAtBottom(true);
                window.requestAnimationFrame(() => scrollToBottom("auto"));
              }}
              testId="message-scroll-to-latest"
            />
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
});

export const MessageTimeline = React.memo(MessageTimelineBase);
