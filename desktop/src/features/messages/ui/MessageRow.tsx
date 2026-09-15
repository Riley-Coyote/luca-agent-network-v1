import { canShowPrivateActivityDetails } from "../activity/activityTracePrivacy";
import { useActivityTrace } from "@/features/messages/activity/useActivityTrace";
import {
  activityTraceLookupForMessage,
  provisionalReplyAfterNarration,
} from "@/features/messages/activity/activityTraceProjection";
import { ResidentActivityTrace } from "./ResidentActivityTrace";
import * as React from "react";

import {
  depthGuideActionsEqual,
  numberArrayEqual,
  reactionsEqual,
  tagsEqual,
} from "@/features/messages/lib/messageRowEquality";
import type { TimelineMessage } from "@/features/messages/types";
import { useKnownAgentPubkeys } from "@/features/agents/useKnownAgentPubkeys";
import { NativeAgentNoticeCard } from "@/features/agents/ui/NativeAgentNoticeCard";
import {
  FIRST_MEETING_MARKER,
  hasClientMarker,
} from "@/features/luca/canonicalLucaResident";
import { visibleFirstMeetingProse } from "@/features/luca/firstMeetingChoices";
import { LucaGreetingChoices } from "@/features/luca/ui/LucaGreetingChoices";
import { LucaGreetingChoicesContext } from "@/features/luca/ui/lucaGreetingChoicesContext";
import { ResidentStopContext } from "./residentStopContext";
import { NATIVE_AGENT_NOTICE_MARKER } from "@/features/luca/useNativeAgentNotice";
import { HuddleAttachment } from "@/features/huddle/components/HuddleAttachment";
import type { ResidentMarkLiveState } from "@/features/channels/ui/ResidentIdentityMark";
import { AgentMessageRuntime } from "./AgentMessageRuntime";
import { MessageReactions } from "@/features/messages/ui/MessageReactions";
import { useReactionHandler } from "@/features/messages/ui/useReactionHandler";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { useRemindLater } from "@/features/reminders/ui/RemindMeLaterProvider";
import {
  getThreadReplyAnchorCenterRem,
  getThreadReplyAnchorCenterYRem,
  getThreadReplyDescendantRailStartYRem,
  getThreadReplyConnectorLayout,
  getThreadReplyIndentRem,
  threadReplyLength,
  THREAD_REPLY_LINE_WIDTH_REM,
} from "@/features/messages/lib/threadTreeLayout";
import {
  KIND_HUDDLE_STARTED,
  KIND_STREAM_MESSAGE_DIFF,
} from "@/shared/constants/kinds";
import { getConfigNudgeAuthorPubkey } from "@/features/messages/ui/configNudgeAuthPubkey";
import { formatFullDateTime } from "@/features/messages/lib/dateFormatters";
import { useIdentityQuery } from "@/shared/api/hooks";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { useChannelNavigation } from "@/shared/context/ChannelNavigationContext";
import { parseImetaTags } from "@/features/messages/lib/parseImeta";
import {
  managedElapsedReadout,
  managedOperationalCopy,
} from "@/features/messages/lib/managedOperationalStatus";
import {
  getManagedOperationalReceiptSnapshot,
  subscribeManagedOperationalReceipts,
} from "@/features/messages/managedPresentationStore";
import { useMessageEmoji } from "@/features/messages/lib/useMessageEmoji";
import { parseWaveMessageContent } from "@/features/messages/lib/waveMessage";
import { resolveSnapshotSharedBy } from "@/features/messages/lib/snapshotSharedBy";
import { resolveMentionProps } from "@/shared/lib/resolveMentionNames";
import { Markdown } from "@/shared/ui/markdown";
import type { VideoReviewContext } from "@/shared/ui/VideoPlayer";
import { MessageActionBar } from "./MessageActionBar";
import { MessageAuthorText, MessageHeaderRow } from "./MessageHeader";
import { CollapsibleMessageBody } from "./CollapsibleMessageBody";
import { jumpToMessage } from "@/features/messages/lib/jumpToMessage";
import { QuotedParent } from "./QuotedParent";
import { MessageTimestamp } from "./MessageTimestamp";
import { WaveMessageAttachment } from "./WaveMessageAttachment";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { useChatMarkAppearance } from "@/features/messages/lib/chatMarkAppearancePreference";
import { useStreamingTextEffect } from "@/features/messages/lib/streamingTextPreference";
import { InChatAgentMark } from "./InChatAgentMark";

const DiffMessage = React.lazy(() => import("./DiffMessage"));
const DiffMessageExpanded = React.lazy(() => import("./DiffMessageExpanded"));
const EMPTY_INTERRUPTED_RECEIPTS: ReadonlySet<string> = new Set();

/**
 * Which school the timeline draws the owner's turn in.
 *
 *   bubble   the owner's turn is a compact plate anchored right; the
 *            resident keeps the full reading measure, the gutter mark and
 *            the name row. A person's turns are short and gain from a
 *            bubble's compactness; a resident's are documents — code,
 *            tables, long prose — and need the whole measure.
 *   surface  both turns stay left at full width and the owner's is set
 *            apart by a quiet plate instead of by position.
 *
 * COMPARISON AFFORDANCE, not a product setting: `?anatomy=surface` in the
 * URL switches schools so the two can be seen side by side in the lab. Read
 * once at module load — the schools are not something the running app moves
 * between, and re-reading per row would cost a URL parse on every render.
 */
type MessageAnatomy = "bubble" | "surface";

function readMessageAnatomy(): MessageAnatomy {
  if (typeof window === "undefined") return "bubble";
  const { hash, search } = window.location;
  // Hash routes carry their own query string; look in both so the switch
  // works whichever entry point the lab was opened through.
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?")) : "";
  const value =
    new URLSearchParams(search).get("anatomy") ??
    new URLSearchParams(hashQuery).get("anatomy");
  return value === "surface" ? "surface" : "bubble";
}

const MESSAGE_ANATOMY: MessageAnatomy = readMessageAnatomy();

/**
 * How young a row must be, at its first render, to still count as landing.
 * A mount alone cannot mean "just arrived" — the virtualized list remounts
 * rows every time they scroll back into view, and animating those would make
 * the whole history twitch. Five seconds is far longer than any send takes
 * and far shorter than the gap to the previous session's messages.
 */
const OWN_ROW_LANDING_WINDOW_MS = 5_000;

export type ThreadDepthGuideAction = {
  active?: boolean;
  depth: number;
  label: string;
  message: TimelineMessage;
};

/**
 * WP-STRIP1 · how long this resident has been working, at the right of the
 * row. Seconds while seconds are the news, then minutes, then hours — the
 * lab's reading, unchanged.
 */
function elapsedLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * A clock that only exists while a resident is working. It is mounted by the
 * live row and unmounted the moment the turn settles, so a quiet thread runs
 * no timers at all.
 */
function LiveElapsed({ startedAtMs }: { startedAtMs: number }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAtMs) / 1_000));
  return (
    <span
      className="shrink-0 text-xs leading-[1.35] tabular-nums text-white/[0.3]"
      data-testid="resident-elapsed"
    >
      {elapsedLabel(seconds)}
    </span>
  );
}

export const MessageRow = React.memo(
  function MessageRow({
    channelId = null,
    collapseDepthGuideActions,
    connectDescendants = false,
    depthGuideDepths,
    highlighted = false,
    highlightDescendantRail = false,
    highlightReplyConnector = false,
    highlightThreadLineDepths,
    hoverBackground = true,
    huddleMemberPubkeys,
    huddleMemberPubkeysPending = false,
    actionBarPlacement = "floating",
    collapseDescendantsLabel,
    isFollowingThread,
    isContinuation = false,
    isUnread,
    authorVisiting = false,
    layoutVariant = "default",
    message,
    onCollapseDepthGuide,
    onCollapseDepthGuideHoverChange,
    onCollapseDescendants,
    onCollapseDescendantsHoverChange,
    onDelete,
    onEdit,
    onFollowThread,
    onMarkUnread,
    onMarkRead,
    onToggleReaction,
    onReply,
    onReplyInThread,
    onEntranceComplete,
    playEntrance = false,
    onUnfollowThread,
    profiles,
    searchQuery,
    quotedParent = null,
    collapseLongBody = true,
    quickReactions = true,
    agentNamesEnabled = true,
    showDepthGuides = true,
    videoReviewContext,
  }: {
    channelId?: string | null;
    collapseDepthGuideActions?: ReadonlyArray<ThreadDepthGuideAction>;
    connectDescendants?: boolean;
    depthGuideDepths?: ReadonlyArray<number>;
    highlighted?: boolean;
    highlightDescendantRail?: boolean;
    highlightReplyConnector?: boolean;
    highlightThreadLineDepths?: ReadonlyArray<number>;
    hoverBackground?: boolean;
    huddleMemberPubkeys?: readonly string[];
    huddleMemberPubkeysPending?: boolean;
    actionBarPlacement?: "floating" | "inside";
    collapseDescendantsLabel?: string;
    isFollowingThread?: boolean;
    isContinuation?: boolean;
    isUnread?: boolean;
    /** The author is visiting this room right now (stepped in, not yet out). */
    authorVisiting?: boolean;
    layoutVariant?: "default" | "thread-reply";
    message: TimelineMessage;
    onCollapseDepthGuide?: (message: TimelineMessage) => void;
    onCollapseDepthGuideHoverChange?: (
      message: TimelineMessage,
      hovered: boolean,
    ) => void;
    onCollapseDescendants?: (message: TimelineMessage) => void;
    onCollapseDescendantsHoverChange?: (
      message: TimelineMessage,
      hovered: boolean,
    ) => void;
    onDelete?: (message: TimelineMessage) => void;
    onEdit?: (message: TimelineMessage) => void;
    onFollowThread?: (message: TimelineMessage) => void;
    onMarkUnread?: (message: TimelineMessage) => void;
    onMarkRead?: (message: TimelineMessage) => void;
    onToggleReaction?: (
      message: TimelineMessage,
      emoji: string,
      remove: boolean,
    ) => Promise<void>;
    onReply?: (message: TimelineMessage) => void;
    onReplyInThread?: (message: TimelineMessage) => void;
    onUnfollowThread?: (message: TimelineMessage) => void;
    onEntranceComplete?: (messageId: string) => void;
    playEntrance?: boolean;
    profiles?: UserProfileLookup;
    searchQuery?: string;
    /** The message this one replies to, shown as a quote above the body.
     *  Present only in the quote-reply presentation. */
    quotedParent?: {
      id: string;
      author: string;
      body: string;
      resolved: boolean;
    } | null;
    collapseLongBody?: boolean;
    /** One-tap emoji row in the hover bar; off in direct conversations. */
    quickReactions?: boolean;
    agentNamesEnabled?: boolean;
    showDepthGuides?: boolean;
    videoReviewContext?: VideoReviewContext;
  }) {
    const [expandedDiffId, setExpandedDiffId] = React.useState<string | null>(
      null,
    );
    const [badgeBurstEmoji, setBadgeBurstEmoji] = React.useState<string | null>(
      null,
    );
    // Whose turn this is. The identity query is cached forever and shared by
    // every consumer, so a row asking for it costs one subscription to a value
    // that never changes — cheaper than threading a pubkey down through five
    // components that have no other use for it.
    const identityQuery = useIdentityQuery();
    const ownerPubkey = identityQuery.data?.pubkey;
    const chatMarkAppearance = useChatMarkAppearance(ownerPubkey);
    const streamingTextEffect = useStreamingTextEffect(ownerPubkey);
    const isOwnMessage = Boolean(
      ownerPubkey &&
        message.pubkey &&
        normalizePubkey(ownerPubkey) === normalizePubkey(message.pubkey),
    );
    const ownBubble = isOwnMessage && MESSAGE_ANATOMY === "bubble";
    // Captured on the FIRST render only: a row that scrolls back into view
    // must not re-land. See OWN_ROW_LANDING_WINDOW_MS.
    const rowIsFresh = React.useRef(
      Date.now() - message.createdAt * 1_000 < OWN_ROW_LANDING_WINDOW_MS,
    ).current;
    const handleEntranceAnimationEnd = React.useCallback(
      (event: React.AnimationEvent<HTMLElement>) => {
        if (
          playEntrance &&
          event.animationName === "motion-enter-conversation"
        ) {
          onEntranceComplete?.(message.id);
        }
      },
      [message.id, onEntranceComplete, playEntrance],
    );
    const {
      reactions,
      canToggle: canToggleReactions,
      pending: reactionPending,
      errorMessage: reactionErrorMessage,
      select: handleReactionSelect,
    } = useReactionHandler(message, onToggleReaction);
    const { openReminder, activeReminderEventIds } = useRemindLater();
    const hasActiveReminder = activeReminderEventIds.has(message.id);
    const handleRemindLater = React.useCallback(
      (msg: TimelineMessage) => {
        openReminder({
          eventId: msg.id,
          channelId: channelId ?? "",
          preview: msg.body.slice(0, 100),
          authorPubkey: msg.pubkey ?? "",
        });
      },
      [channelId, openReminder],
    );
    const { mentionNames, mentionPubkeysByName } = React.useMemo(
      () => resolveMentionProps(message.tags, profiles),
      [profiles, message.tags],
    );
    // "Is this pubkey an agent" = the community-scoped baseline every surface
    // shares (managed ∪ relay) plus the pubkey's own profile `isAgent` flag from this surface's lookup. Both are per-pubkey
    // O(1) checks — no per-row rescan of `profiles` (that duplicated parent
    // work in every mounted row and re-ran on each profile-lookup change).
    const knownAgentPubkeys = useKnownAgentPubkeys();
    const isKnownAgentPubkey = React.useCallback(
      (pubkey: string) => {
        const normalized = normalizePubkey(pubkey);
        return (
          knownAgentPubkeys.has(normalized) ||
          profiles?.[normalized]?.isAgent === true
        );
      },
      [knownAgentPubkeys, profiles],
    );
    const profilePopoverRole =
      message.role === "bot" ||
      (message.pubkey && isKnownAgentPubkey(message.pubkey))
        ? "bot"
        : message.role;
    const agentMentionPubkeysByName = React.useMemo(() => {
      if (!mentionPubkeysByName) {
        return undefined;
      }

      const values: Record<string, string> = {};
      for (const [name, pubkey] of Object.entries(mentionPubkeysByName)) {
        if (isKnownAgentPubkey(pubkey)) {
          values[name] = pubkey;
        }
      }

      return Object.keys(values).length > 0 ? values : undefined;
    }, [isKnownAgentPubkey, mentionPubkeysByName]);

    const imetaByUrl = React.useMemo(
      () => (message.tags ? parseImetaTags(message.tags) : undefined),
      [message.tags],
    );
    const snapshotSharedBy = React.useMemo(
      () =>
        resolveSnapshotSharedBy(
          { signerPubkey: message.signerPubkey },
          profiles,
        ),
      [message.signerPubkey, profiles],
    );

    const { customEmoji, emojiOnly } = useMessageEmoji(
      message.body,
      message.tags,
    );
    const bodyOffsetClass = emojiOnly ? "mt-1" : "-mt-0.5";

    const { nonDmChannelNames: channelNames, channels } =
      useChannelNavigation();
    const traceLookup = React.useMemo(
      () => activityTraceLookupForMessage(channelId, message),
      [channelId, message],
    );
    const activityTrace = useActivityTrace(traceLookup);
    const traceChannel = channels.find((channel) => channel.id === channelId);
    const privateTraceConversation = canShowPrivateActivityDetails(
      traceChannel,
      ownerPubkey,
      isKnownAgentPubkey,
    );
    const interruptedReceipts = React.useSyncExternalStore(
      React.useCallback(
        (listener) =>
          channelId
            ? subscribeManagedOperationalReceipts(channelId, listener)
            : () => undefined,
        [channelId],
      ),
      React.useCallback(
        () =>
          channelId
            ? getManagedOperationalReceiptSnapshot(channelId)
            : EMPTY_INTERRUPTED_RECEIPTS,
        [channelId],
      ),
    );
    const interruptedOwnerReceipt = interruptedReceipts.has(message.id);

    const indentRem = getThreadReplyIndentRem(message.depth);
    const descendantGuideOffsetRem = connectDescendants
      ? getThreadReplyAnchorCenterRem(message.depth)
      : null;
    const replyConnector = React.useMemo(() => {
      return getThreadReplyConnectorLayout(message.depth);
    }, [message.depth]);
    const depthGuideItems = React.useMemo(() => {
      const depths =
        depthGuideDepths ??
        Array.from(
          { length: Math.max(0, message.depth - 1) },
          (_, index) => index + 1,
        );

      return depths.map((depth) => ({
        depth,
        offset: getThreadReplyAnchorCenterRem(depth),
      }));
    }, [depthGuideDepths, message.depth]);
    const handleCollapseDescendants = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onCollapseDescendants?.(message);
      },
      [message, onCollapseDescendants],
    );
    const handleCollapseDescendantsHoverChange = React.useCallback(
      (hovered: boolean) => {
        onCollapseDescendantsHoverChange?.(message, hovered);
      },
      [message, onCollapseDescendantsHoverChange],
    );
    const handleCollapseDepthGuide = React.useCallback(
      (
        event: React.MouseEvent<HTMLButtonElement>,
        targetMessage: TimelineMessage,
      ) => {
        event.preventDefault();
        event.stopPropagation();
        onCollapseDepthGuide?.(targetMessage);
      },
      [onCollapseDepthGuide],
    );
    const handleCollapseDepthGuideHoverChange = React.useCallback(
      (targetMessage: TimelineMessage, hovered: boolean) => {
        onCollapseDepthGuideHoverChange?.(targetMessage, hovered);
      },
      [onCollapseDepthGuideHoverChange],
    );
    const collapseDepthGuideActionsByDepth = React.useMemo(() => {
      if (!collapseDepthGuideActions?.length) {
        return new Map<number, ThreadDepthGuideAction>();
      }

      return new Map(
        collapseDepthGuideActions.map((action) => [action.depth, action]),
      );
    }, [collapseDepthGuideActions]);
    const getTag = (name: string) =>
      message.tags?.find((tag) => tag[0] === name)?.[1];
    const hasNativeAgentNoticeMarker = message.tags?.some(
      (tag) => tag[0] === "client" && tag[1] === NATIVE_AGENT_NOTICE_MARKER,
    );
    const lucaChoices = React.useContext(LucaGreetingChoicesContext);
    const residentStop = React.useContext(ResidentStopContext);
    const showLucaChoices =
      lucaChoices?.activeMessageId === message.id &&
      !message.managedPresentation?.streaming;

    const replyBody = provisionalReplyAfterNarration(
      lucaChoices?.responseIds.has(message.id)
        ? visibleFirstMeetingProse(
            message.body,
            Boolean(message.managedPresentation?.streaming),
          )
        : message.body,
      activityTrace,
      Boolean(
        message.managedPresentation &&
          !message.managedPresentation.finalMessageId,
      ),
    );
    const renderBody = () => {
      switch (message.kind) {
        case KIND_STREAM_MESSAGE_DIFF:
          return (
            <React.Suspense
              fallback={
                <div className="p-3 text-sm text-muted-foreground">
                  Loading diff…
                </div>
              }
            >
              <DiffMessage
                commitSha={getTag("commit")}
                content={message.body}
                description={getTag("description")}
                filePath={getTag("file")}
                onExpand={() => {
                  setExpandedDiffId(message.id);
                }}
                repoUrl={getTag("repo")}
                truncated={getTag("truncated") === "true"}
              />
            </React.Suspense>
          );
        case KIND_HUDDLE_STARTED:
          return (
            <HuddleAttachment
              channelId={channelId}
              message={message}
              onOpenThread={onReply}
            />
          );
        default:
          {
            const waveMessage = parseWaveMessageContent(message.body);
            if (waveMessage) {
              return (
                <WaveMessageAttachment
                  channelId={channelId}
                  fallbackText={waveMessage.fallbackText}
                  huddleMemberPubkeys={huddleMemberPubkeys}
                  huddleMemberPubkeysPending={huddleMemberPubkeysPending}
                />
              );
            }
          }

          return (
            <Markdown
              channelNames={channelNames}
              // `type-body` is the reading step from the type ramp — the
              // reading face, its size, leading and tracking applied together,
              // since taking one without the others is what let message copy
              // drift from the scale it was supposed to be on. Full-strength
              // ink, not `/90`: the ladder expresses hierarchy through its own
              // roles, and an alpha on top of near-black ink is what dropped
              // light mode below AA.
              className={cn(
                "max-w-full text-foreground",
                emojiOnly
                  ? "text-4xl leading-tight [&_p]:leading-tight [&_img[data-custom-emoji]]:h-[1.45em] [&_img[data-custom-emoji]]:align-middle [&_button:has(img[data-custom-emoji])]:align-middle"
                  : "type-body",
              )}
              // Only pass the author pubkey for agent-authored messages so
              // config-nudge cards can authenticate the sender. Uses the
              // raw event signer (signerPubkey), not a relay-delegated display
              // author, because the agent itself must have signed the card.
              configNudgeAuthorPubkey={getConfigNudgeAuthorPubkey(
                message,
                isKnownAgentPubkey,
              )}
              content={replyBody}
              customEmoji={customEmoji}
              imetaByUrl={imetaByUrl}
              agentMentionPubkeysByName={agentMentionPubkeysByName}
              mentionNames={mentionNames}
              mentionPubkeysByName={mentionPubkeysByName}
              progressive={Boolean(message.managedPresentation)}
              interactive={
                !message.managedPresentation ||
                (Boolean(message.managedPresentation.finalMessageId) &&
                  !message.managedPresentation.streaming)
              }
              searchQuery={searchQuery}
              snapshotSharedBy={snapshotSharedBy}
              streaming={message.managedPresentation?.streaming ?? false}
              streamingTextEffect={streamingTextEffect}
              videoReviewContext={videoReviewContext}
            />
          );
      }
    };

    const isThreadReplyLayout = layoutVariant === "thread-reply";
    // A visitor's name is structural: hiding it would leave a bare
    // “visiting” label with no speaker. An explicit quiet-name preference
    // still applies to agent turns outside a visit.
    const quietAgent = Boolean(
      message.isAgent && !agentNamesEnabled && !authorVisiting,
    );
    // Agent replies read directly on the conversation plane. Inside a visit
    // they reserve the connector's column so its hairline cannot cross their
    // words; human contacts keep their avatar there.
    // Hoisted above the mark gutter on purpose: the gutter has to know whether
    // this row is a live resident turn BEFORE it decides to open, because that
    // is the row that paints the activity mark.
    const managedPhase = message.managedPresentation?.phase;
    const residentMarkLive: ResidentMarkLiveState = activityTrace
      ? activityTrace.status === "working"
        ? "thinking"
        : null
      : !message.managedPresentation?.streaming
        ? null
        : managedPhase === "waking" ||
            managedPhase === "thinking" ||
            managedPhase === "working"
          ? "thinking"
          : managedPhase === "writing" || managedPhase === "finalizing"
            ? "writing"
            : null;
    // The pending reply and its final message keep the same mark column, so
    // choosing a quiet in-chat identity never moves the text.
    const showResidentMarkGutter = Boolean(!ownBubble && message.pubkey);
    const showInChatAgentMark = Boolean(
      showResidentMarkGutter &&
        message.isAgent &&
        activityTrace?.status !== "working" &&
        chatMarkAppearance.visible &&
        chatMarkAppearance.style !== "sphere",
    );
    // Whether this row actually DRAWS something in the 21px mark column, as
    // opposed to holding the slot open. A visit passage runs its connector
    // through that column and reserves the mark's height as a gap, so a row
    // that keeps the slot empty — a continuation, or the owner's own turn in
    // the bubble school — has to be told apart from one that fills it, or the
    // line breaks across it. Read from the reading plane by
    // `message-anatomy.css`; see THE CONNECTOR THROUGH AN EMPTY SLOT there.
    const paintsResidentMark =
      showResidentMarkGutter &&
      !ownBubble &&
      (showInChatAgentMark || (!message.isAgent && !isContinuation));
    const guideBleedRem = isThreadReplyLayout ? 0.25 : 0;
    const authorNode = message.pubkey ? (
      <MessageAuthorText hoverUnderline>{message.author}</MessageAuthorText>
    ) : (
      <MessageAuthorText as="h3">{message.author}</MessageAuthorText>
    );
    const actionBarNode =
      message.managedPresentation?.finalMessageId === null ||
      message.managedPresentation?.streaming ? null : (
        <div
          className={cn(
            "absolute right-2 top-1 z-10 sm:pointer-events-none",
            actionBarPlacement === "floating"
              ? "sm:top-0 sm:-translate-y-1/2"
              : "sm:top-1 sm:translate-y-0",
          )}
          // The seam `message-anatomy.css` needs to give this pill a real
          // elevation over the owner's plate. MessageActionBar takes no
          // className, so the anchor has to sit on the wrapper.
          data-message-action-bar
        >
          <MessageActionBar
            channelId={channelId}
            isFollowingThread={isFollowingThread}
            isUnread={isUnread}
            message={message}
            onDelete={onDelete}
            onEdit={onEdit}
            onFollowThread={onFollowThread}
            onMarkUnread={onMarkUnread}
            onMarkRead={onMarkRead}
            onReactionBadgeBurstRequest={
              reactionPending ? undefined : setBadgeBurstEmoji
            }
            onReactionSelect={
              canToggleReactions ? handleReactionSelect : undefined
            }
            onRemindLater={handleRemindLater}
            onReply={onReply}
            onReplyInThread={onReplyInThread}
            onUnfollowThread={onUnfollowThread}
            quickReactions={quickReactions && !privateTraceConversation}
            reactionErrorMessage={reactionErrorMessage}
            reactions={reactions}
          />
        </div>
      );

    // Nothing marks a send in flight. The message is on screen — that is the
    // feedback. The uppercase accent label that used to sit here fired on
    // every message, spent the one signal colour on a non-event, and read as
    // a warning. A slow send discloses itself elsewhere, on its own clock.
    const statusMetadataNode = message.edited ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <p className="text-ink-faint">(edited)</p>
        </TooltipTrigger>
        <TooltipContent>This message has been edited</TooltipContent>
      </Tooltip>
    ) : null;

    const managedStatusNode = (() => {
      if (interruptedOwnerReceipt) {
        return (
          <p
            className="mt-1 text-2xs leading-4 text-ink-faint"
            data-testid="managed-interrupted-status"
            role="status"
          >
            Previous resident response interrupted after restart
          </p>
        );
      }
      const managed = message.managedPresentation;
      if (!managed) return null;
      if (managed.phase === "finalizing") return null;
      // A failed handoff is already reduced to one compact timeline sentence
      // ("Couldn’t reach Luca."). Repeating it as metadata immediately below
      // recreates the duplicate failure treatment this projection removes.
      if (managed.handoffTargetName) return null;
      const status = managedOperationalCopy(
        managed.phase,
        managed.failure,
        managed.handoffTargetName ?? null,
      );
      if (!status) return null;
      return (
        <p
          className={cn(
            "mt-1 text-xs",
            // A recoverable state is not an alarm. This sentence sits in the
            // reading column at full measure, and painting it `destructive`
            // spent the system's one signal colour on a paragraph — the shape
            // the canon allows on a status MARK and nowhere else. The
            // resident's mark carries the hue; the sentence states the outcome
            // in ink. Same division the activity shelf makes.
            status.tone === "attention"
              ? "text-ink-muted"
              : "text-muted-foreground",
          )}
          data-testid="managed-response-status"
          role="status"
        >
          {status.label}
        </p>
      );
    })();

    // While a reply is coming, the resident's own mark carries the continuous
    // live signal and one quiet word beside the name says what — "thinking",
    // "reading files", "writing". This row owns that state in a direct
    // conversation, where the multi-resident activity shelf stands down.
    // "waking" is the honest word for a resident the desktop is starting on
    // the owner's behalf: nothing is thinking yet, and saying so is what
    // keeps a longer wait from reading as a broken one.
    //
    // WP-STRIP1 · decision 1 splits this in two. The HEADER carries a plain
    // verb phrase — the one word that says what kind of thing is happening —
    // and the NARRATION, everything the runtime actually says as it works,
    // moves to the line below in body type, where there is room to read it.
    // Cramming both into the header is what made the old line a status strip.
    const activityWord =
      residentMarkLive === "thinking"
        ? managedPhase === "waking"
          ? "waking"
          : managedPhase === "working"
            ? "working"
            : "thinking"
        : // The "writing" phase can arrive a beat before the first chunk;
          // until words exist the row keeps a word rather than going bare.
          residentMarkLive === "writing" && message.body === ""
          ? "writing"
          : null;
    // What the runtime narrated, when it said anything the verb did not.
    const narration =
      privateTraceConversation &&
      activityWord &&
      message.managedPresentation?.activityLabel &&
      message.managedPresentation.activityLabel !== activityWord
        ? message.managedPresentation.activityLabel
        : null;

    // Every working row retains its own scoped Stop control.
    const stopPubkey =
      residentStop &&
      (message.managedPresentation?.streaming ||
        activityTrace?.status === "working") &&
      message.pubkey
        ? message.pubkey
        : null;
    const stopping =
      residentStop && stopPubkey ? residentStop.isStopping(stopPubkey) : false;
    const showStop =
      residentStop !== null &&
      stopPubkey !== null &&
      (stopping || residentStop.canStop(stopPubkey));
    const managedWorkDuration =
      message.managedPresentation?.workDurationMs !== undefined &&
      !message.managedPresentation.streaming
        ? managedElapsedReadout(message.managedPresentation.workDurationMs)
        : null;

    const inlineMetadataNode = (
      <div className="flex shrink-0 items-baseline gap-2 text-xs">
        {managedWorkDuration ? (
          <span
            className="text-ink-faint"
            data-managed-work-duration
            title="Elapsed resident work time"
          >
            {managedWorkDuration}
          </span>
        ) : null}
        {/* The clock is available, not announced: it fades in when the row is
            hovered or holds focus (see message-anatomy.css) and reserves its
            box the rest of the time, so revealing it never moves a word.
            Hover is a pointer-only gesture and reaches neither the keyboard
            nor a screen reader, so the exact moment rides on `title` (the
            accessible description) and on `datetime` — both readable whether
            or not a pointer ever crosses the row. */}
        <time
          data-message-time
          dateTime={new Date(message.createdAt * 1_000).toISOString()}
          title={formatFullDateTime(message.createdAt)}
        >
          <MessageTimestamp createdAt={message.createdAt} time={message.time} />
        </time>
        {authorVisiting ? (
          // Presence is lighter, words are equal: one whispered word after the
          // time is the only thing that marks a guest's message.
          <span
            className="text-2xs leading-4 text-ink-faint"
            data-testid="resident-visiting-word"
          >
            <span className="pr-1">·</span>visiting
          </span>
        ) : null}
        {statusMetadataNode}
        {activityWord ? (
          <span
            className="text-ink-faint"
            data-testid="resident-activity-word"
            role="status"
          >
            {stopping ? "stopping" : activityWord}
          </span>
        ) : null}
      </div>
    );
    // WP-STRIP1 · decision 3. Stop belongs to the row whose work it stops, and
    // it is a text button — never a checkbox, never a square. It occupies its
    // slot at all times and only opacity changes, so revealing it never moves
    // a word. Five states: rest, hover, active, focus, disabled — and focus is
    // this element's own border brightening in place, no second ring.
    //
    // `!outline-none` is deliberate: `conversation-shell.css` sets an
    // UNLAYERED global `:focus-visible` outline that beats any component's own
    // treatment. WP-BASE1 removes that rule; until it lands the `!` is the only
    // way this object can express the baseline.
    const stopNode =
      showStop && stopPubkey ? (
        <span className={cn("ml-auto flex h-4 shrink-0 items-center")}>
          <button
            aria-label={`Stop ${message.author}`}
            className={cn(
              // Exactly the header's own 16px line box (`leading-4` on
              // `MessageHeaderRow`, which aligns on the baseline): an object
              // one pixel taller would grow the row while a resident works and
              // fold it back when the signed final lands. The row must not
              // move when the answer arrives — that is the whole argument for
              // putting the wait here.
              "inline-flex h-4 select-none items-center rounded-[4px] border px-1.5",
              "text-xs leading-none",
              "transition-[color,background-color,border-color] duration-150",
              "border-transparent bg-transparent text-white/[0.45]",
              "hover:text-white/[0.78] active:text-white/50",
              "focus-visible:border-white/50 focus-visible:!outline-none",
              "disabled:cursor-default disabled:text-white/[0.45]",
            )}
            data-testid="resident-stop"
            disabled={stopping}
            onClick={() => residentStop?.onStop(stopPubkey)}
            type="button"
          >
            {stopping ? "Stopping" : "Stop"}
          </button>
        </span>
      ) : null;

    // WP-STRIP1 · decision 1: elapsed at the right of a working row, beside
    // the row's own Stop. It ticks on its own so the reading is true — the
    // pending-reply clock only advances when the row's sentence changes, and
    // an elapsed derived from it would sit still while the seconds ran.
    const liveTailNode = residentMarkLive ? (
      <span className="ml-auto flex shrink-0 items-center gap-3">
        <LiveElapsed startedAtMs={message.createdAt * 1_000} />
        {stopNode}
      </span>
    ) : (
      stopNode
    );

    // Human messages can collapse into a compact continuation. Agent turns
    // keep attribution on every row because adjacent residents may share a
    // runtime and a multi-agent transcript must identify each authored turn.
    const hideContinuationHeader = isContinuation && !message.isAgent;
    const continuationMetadataNode =
      hideContinuationHeader && statusMetadataNode ? (
        <div className="mt-0.5 flex items-baseline gap-2 text-xs">
          {statusMetadataNode}
        </div>
      ) : null;

    const hasVisibleMetadata = Boolean(
      managedWorkDuration ||
        authorVisiting ||
        statusMetadataNode ||
        activityWord ||
        stopNode ||
        residentMarkLive,
    );
    const headerNode = activityTrace ? (
      <ResidentActivityTrace
        trace={activityTrace}
        residentName={message.author}
        privateConversation={privateTraceConversation}
        // WP-R2-5: the working row says "Writing" once the reply is actually
        // arriving, instead of holding the last finished tool step.
        streaming={
          managedPhase === "writing" ||
          managedPhase === "finalizing" ||
          replyBody.length > 0
        }
        showIdentity={!quietAgent}
        identityNode={
          message.pubkey && !quietAgent ? (
            <UserProfilePopover
              pubkey={message.pubkey}
              role={profilePopoverRole}
              botIdenticonValue={message.author}
            >
              {authorNode}
            </UserProfilePopover>
          ) : undefined
        }
        stopping={stopping}
        onStop={
          showStop && stopPubkey
            ? () => residentStop?.onStop(stopPubkey)
            : undefined
        }
      />
    ) : hideContinuationHeader ? null : (
      <MessageHeaderRow
        className={cn(
          "luca-msg-header",
          quietAgent && !hasVisibleMetadata && "sr-only",
        )}
      >
        {/* Anchored right, the owner's turn needs no name: position says whose
            it is. The words stay in the markup — a screen reader still hears
            who spoke — but the popover trigger goes, because an invisible
            control that can still take focus is worse than no control. */}
        {quietAgent ? (
          <span className="sr-only">{authorNode}</span>
        ) : message.pubkey && !ownBubble ? (
          <UserProfilePopover
            pubkey={message.pubkey}
            role={profilePopoverRole}
            botIdenticonValue={message.author}
          >
            {authorNode}
          </UserProfilePopover>
        ) : (
          authorNode
        )}
        {message.isAgent && !quietAgent && message.pubkey ? (
          <AgentMessageRuntime publicKey={message.pubkey} />
        ) : null}
        {inlineMetadataNode}
        {!quietAgent &&
        message.personaDisplayName &&
        message.personaDisplayName !== message.author ? (
          <span className="text-xs text-muted-foreground">
            {message.personaDisplayName}
          </span>
        ) : null}
        {liveTailNode}
      </MessageHeaderRow>
    );
    const bodyContainerClass =
      hideContinuationHeader || (quietAgent && !hasVisibleMetadata)
        ? "mt-0"
        : bodyOffsetClass;

    const messageBodyNode = (
      <>
        {quotedParent ? (
          <QuotedParent
            author={quotedParent.author}
            body={quotedParent.body}
            onJump={() => jumpToMessage(quotedParent.id)}
            resolved={quotedParent.resolved}
          />
        ) : null}
        {collapseLongBody ? (
          <CollapsibleMessageBody>{renderBody()}</CollapsibleMessageBody>
        ) : (
          renderBody()
        )}
        {hasNativeAgentNoticeMarker ? (
          <NativeAgentNoticeCard signerPubkey={message.signerPubkey} />
        ) : null}
        {showLucaChoices && lucaChoices ? (
          <LucaGreetingChoices
            options={lucaChoices.options}
            onChoose={lucaChoices.onChoose}
          />
        ) : null}
        {!activityTrace && activityWord && message.body === "" ? (
          // THE BODY SLOT THE FIRST WORD WILL LAND IN. Held open at one line
          // so the arrival of text does not push the thread, and carrying the
          // narration in the meantime — the row is already at the exact x and
          // y the answer will occupy, which is the whole point of putting the
          // wait here instead of above the composer.
          <div
            className="min-h-[22px] text-chat leading-[1.5] text-ink-muted"
            data-testid="resident-narration"
            role="status"
          >
            {narration}
          </div>
        ) : null}
        {managedStatusNode}
        {continuationMetadataNode}
        <MessageReactions
          messageId={message.id}
          reactions={reactions}
          canToggle={canToggleReactions}
          pending={reactionPending}
          burstEmojiOnRender={badgeBurstEmoji}
          onBurstEmojiRendered={(emoji) => {
            setBadgeBurstEmoji((current) =>
              current === emoji ? null : current,
            );
          }}
          onSelect={(emoji) => {
            void handleReactionSelect(emoji);
          }}
        />
        {reactionErrorMessage ? (
          <p className="mt-1.5 text-xs text-destructive">
            {reactionErrorMessage}
          </p>
        ) : null}
        {expandedDiffId === message.id ? (
          <React.Suspense
            fallback={
              <div className="p-3 text-sm text-muted-foreground">
                Loading diff viewer…
              </div>
            }
          >
            <DiffMessageExpanded
              content={message.body}
              filePath={getTag("file")}
              onClose={() => {
                setExpandedDiffId(null);
              }}
            />
          </React.Suspense>
        ) : null}
      </>
    );

    if (
      lucaChoices?.triggerId === message.id &&
      hasClientMarker(message, FIRST_MEETING_MARKER) &&
      isOwnMessage
    ) {
      return (
        <div
          className="py-2 text-center text-xs text-ink-muted"
          data-testid="luca-first-meeting-action"
        >
          Meet Luca
        </div>
      );
    }
    return (
      <div
        className="group/row relative"
        // On the row's outermost box, which the visit connector is matched
        // against from the reading plane two levels up
        // (`[data-visit-span] > div > this`). `message-anatomy.css` spells
        // that depth out with `:has(> * > …)` rather than a loose descendant,
        // so a quoted parent's nested row cannot satisfy it. If this box ever
        // moves relative to the plane, that selector moves with it.
        data-row-mark={paintsResidentMark ? "mark" : "none"}
        style={
          isThreadReplyLayout && indentRem > 0
            ? { paddingLeft: threadReplyLength(indentRem) }
            : undefined
        }
      >
        {isThreadReplyLayout &&
        showDepthGuides &&
        depthGuideItems.length > 0 ? (
          <div
            aria-hidden={
              collapseDepthGuideActionsByDepth.size > 0 ? undefined : true
            }
            className={cn(
              "absolute left-0",
              collapseDepthGuideActionsByDepth.size === 0 &&
                "pointer-events-none",
            )}
            style={{
              bottom: threadReplyLength(-guideBleedRem),
              top: threadReplyLength(-guideBleedRem),
            }}
          >
            {depthGuideItems.map(({ depth, offset }) => {
              const collapseAction =
                collapseDepthGuideActionsByDepth.get(depth);
              const isHighlighted =
                Boolean(collapseAction?.active) ||
                Boolean(highlightThreadLineDepths?.includes(depth));
              if (collapseAction) {
                return (
                  <React.Fragment key={`${message.id}-depth-guide-${offset}`}>
                    <div
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute bottom-0 top-0 border-l transition-[border-color]",
                        isHighlighted ? "border-primary" : "border-border/45",
                      )}
                      style={{
                        borderLeftWidth: threadReplyLength(
                          THREAD_REPLY_LINE_WIDTH_REM,
                        ),
                        left: threadReplyLength(offset),
                      }}
                    />
                    <button
                      aria-label={collapseAction.label}
                      className="absolute bottom-0 top-0 z-20 w-5 -translate-x-1/2 cursor-pointer rounded-full focus-visible:outline-hidden"
                      data-thread-head-id={collapseAction.message.id}
                      data-testid="thread-collapse-guide"
                      onBlur={() =>
                        handleCollapseDepthGuideHoverChange(
                          collapseAction.message,
                          false,
                        )
                      }
                      onClick={(event) =>
                        handleCollapseDepthGuide(event, collapseAction.message)
                      }
                      onFocus={() =>
                        handleCollapseDepthGuideHoverChange(
                          collapseAction.message,
                          true,
                        )
                      }
                      onMouseEnter={() =>
                        handleCollapseDepthGuideHoverChange(
                          collapseAction.message,
                          true,
                        )
                      }
                      onMouseLeave={() =>
                        handleCollapseDepthGuideHoverChange(
                          collapseAction.message,
                          false,
                        )
                      }
                      style={{ left: threadReplyLength(offset) }}
                      type="button"
                    />
                  </React.Fragment>
                );
              }

              return (
                <div
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute bottom-0 top-0 border-l transition-[border-color]",
                    isHighlighted ? "border-primary" : "border-border/45",
                  )}
                  key={`${message.id}-depth-guide-${offset}`}
                  style={{
                    borderLeftWidth: threadReplyLength(
                      THREAD_REPLY_LINE_WIDTH_REM,
                    ),
                    left: threadReplyLength(offset),
                  }}
                />
              );
            })}
          </div>
        ) : null}
        {isThreadReplyLayout &&
        showDepthGuides &&
        descendantGuideOffsetRem !== null ? (
          <>
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute bottom-0 z-0 border-l transition-[border-color]",
                highlightDescendantRail ? "border-primary" : "border-border/45",
              )}
              style={{
                bottom: threadReplyLength(-guideBleedRem),
                borderLeftWidth: threadReplyLength(THREAD_REPLY_LINE_WIDTH_REM),
                left: threadReplyLength(descendantGuideOffsetRem),
                top: threadReplyLength(getThreadReplyDescendantRailStartYRem()),
              }}
            />
            {onCollapseDescendants ? (
              <button
                aria-label={
                  collapseDescendantsLabel ?? "Collapse replies to this message"
                }
                className="absolute bottom-0 z-20 w-5 -translate-x-1/2 cursor-pointer rounded-full p-0 focus-visible:outline-hidden"
                data-thread-head-id={message.id}
                data-testid="thread-collapse-rail"
                onBlur={() => handleCollapseDescendantsHoverChange(false)}
                onClick={handleCollapseDescendants}
                onFocus={() => handleCollapseDescendantsHoverChange(true)}
                onMouseEnter={() => handleCollapseDescendantsHoverChange(true)}
                onMouseLeave={() => handleCollapseDescendantsHoverChange(false)}
                style={{
                  left: threadReplyLength(descendantGuideOffsetRem),
                  top: threadReplyLength(getThreadReplyAnchorCenterYRem()),
                }}
                type="button"
              />
            ) : null}
          </>
        ) : null}
        {isThreadReplyLayout && showDepthGuides && replyConnector ? (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute left-0 top-0 rounded-bl-2xl border-b border-l transition-[border-color]",
              highlightReplyConnector ? "border-primary" : "border-border/45",
            )}
            style={{
              borderBottomWidth: threadReplyLength(THREAD_REPLY_LINE_WIDTH_REM),
              borderLeftWidth: threadReplyLength(THREAD_REPLY_LINE_WIDTH_REM),
              height: threadReplyLength(
                replyConnector.heightRem + guideBleedRem,
              ),
              left: threadReplyLength(replyConnector.parentOffsetRem),
              top: threadReplyLength(-guideBleedRem),
              width: threadReplyLength(replyConnector.widthRem),
            }}
          />
        ) : null}

        <article
          className={cn(
            "group/message relative z-10 rounded-[10px] transition-colors",
            playEntrance &&
              !message.managedPresentation &&
              "motion-enter-conversation",
            // Your own words land; a resident's arrive. Both are quick and
            // unblurred because this is frequent UI. The resident travels one
            // pixel farther and takes one beat longer — enough asymmetry to
            // read as incoming without making text wait behind an effect.
            isOwnMessage &&
              rowIsFresh &&
              !playEntrance &&
              !message.managedPresentation &&
              "motion-land-own",
            // The arriving half of that grammar: a complete incoming message
            // rises into place. The age
            // gate (rowIsFresh) is what keeps history, scroll-back remounts
            // and channel switches still.
            !isOwnMessage &&
              rowIsFresh &&
              !playEntrance &&
              !message.managedPresentation &&
              "motion-enter-conversation",
            // A streaming reply mounts as a near-empty bubble that grows. It
            // and the DM pending placeholder use the same quick, unblurred rise
            // so reflowing text never smears behind an entrance effect.
            !isOwnMessage &&
              rowIsFresh &&
              Boolean(message.managedPresentation) &&
              "motion-enter-managed",
            "py-1.5",
            hoverBackground || isThreadReplyLayout ? "mx-1 px-2" : "px-2",
            "flex",
            (isThreadReplyLayout || showResidentMarkGutter) && "gap-2.5",
            hideContinuationHeader ? "items-center" : "items-start",
            hasActiveReminder ? "bg-foreground/[0.045]" : "",
            highlighted
              ? "-mx-4 rounded-none px-6 before:absolute before:-inset-y-1.5 before:inset-x-0 before:animate-[route-target-highlight-fade_2s_ease-out_forwards] before:bg-primary/10 before:content-[''] motion-reduce:before:animate-none sm:-mx-6 sm:px-8"
              : "",
          )}
          data-message-anatomy={MESSAGE_ANATOMY}
          data-message-highlighted={highlighted ? "" : undefined}
          data-message-reminder={hasActiveReminder ? "" : undefined}
          data-message-side={isOwnMessage ? "own" : "other"}
          data-message-id={message.id}
          data-managed-response-phase={message.managedPresentation?.phase}
          data-managed-final-reconciliation={
            message.managedPresentation?.finalReconciliation ?? undefined
          }
          data-managed-response-ui-key={message.managedPresentation?.uiKey}
          data-signed-message-id={
            message.managedPresentation?.finalMessageId ?? undefined
          }
          data-testid="message-row"
          aria-label={`${message.author}, ${formatFullDateTime(message.createdAt)}`}
          title={
            quietAgent
              ? `${message.author} · ${formatFullDateTime(message.createdAt)}`
              : undefined
          }
          onAnimationEnd={handleEntranceAnimationEnd}
        >
          {isThreadReplyLayout ? (
            <span aria-hidden className="w-4 shrink-0" />
          ) : null}
          {showResidentMarkGutter && message.pubkey ? (
            <span
              className={cn(
                "relative mt-0.5 flex shrink-0 justify-center",
                "w-[21px]",
              )}
              data-message-mark
            >
              {showInChatAgentMark && chatMarkAppearance.style !== "sphere" ? (
                <InChatAgentMark
                  name={message.author}
                  publicKey={message.pubkey}
                  style={chatMarkAppearance.style}
                />
              ) : message.isAgent || isContinuation || ownBubble ? (
                <span aria-hidden className="size-[21px]" />
              ) : (
                <UserAvatar
                  avatarUrl={message.avatarUrl ?? null}
                  displayName={message.author}
                  fallbackClassName="bg-primary/20 text-2xs font-medium text-primary"
                  size="xs"
                />
              )}
            </span>
          ) : null}
          <div
            className="flex min-w-0 flex-1 flex-col gap-0.5"
            data-message-column
          >
            {headerNode}
            <div
              className={cn(
                bodyContainerClass,
                message.managedPresentation && "managed-response-content",
              )}
              data-message-plate
            >
              {messageBodyNode}
            </div>
          </div>
          {actionBarNode}
        </article>
      </div>
    );
    // Callbacks (onReply, onToggleReaction) intentionally excluded: inline arrows
    // from parent create new refs every render — including them defeats memo.
  },
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.pubkey === next.message.pubkey &&
    prev.message.body === next.message.body &&
    prev.message.author === next.message.author &&
    prev.message.isAgent === next.message.isAgent &&
    prev.message.ownerPubkey === next.message.ownerPubkey &&
    prev.message.ownerLabel === next.message.ownerLabel &&
    prev.message.avatarUrl === next.message.avatarUrl &&
    prev.message.accent === next.message.accent &&
    prev.message.time === next.message.time &&
    prev.message.depth === next.message.depth &&
    prev.message.kind === next.message.kind &&
    prev.message.pending === next.message.pending &&
    prev.message.edited === next.message.edited &&
    prev.message.managedPresentation?.uiKey ===
      next.message.managedPresentation?.uiKey &&
    prev.message.managedPresentation?.canonicalPresent ===
      next.message.managedPresentation?.canonicalPresent &&
    prev.message.managedPresentation?.phase ===
      next.message.managedPresentation?.phase &&
    prev.message.managedPresentation?.finalMessageId ===
      next.message.managedPresentation?.finalMessageId &&
    prev.message.managedPresentation?.finalReconciliation ===
      next.message.managedPresentation?.finalReconciliation &&
    prev.message.managedPresentation?.failure ===
      next.message.managedPresentation?.failure &&
    prev.message.managedPresentation?.streaming ===
      next.message.managedPresentation?.streaming &&
    prev.message.activityTraceReceiptId ===
      next.message.activityTraceReceiptId &&
    prev.message.managedPresentation?.activityLabel ===
      next.message.managedPresentation?.activityLabel &&
    prev.message.managedPresentation?.workDurationMs ===
      next.message.managedPresentation?.workDurationMs &&
    // Value comparisons, not identity: these arrays are rebuilt with fresh
    // identities on every ingest/refetch even when unchanged — identity
    // checks made every row re-render on every streamed event in an open
    // thread (see messageRowEquality.ts).
    reactionsEqual(prev.message.reactions, next.message.reactions) &&
    tagsEqual(prev.message.tags, next.message.tags) &&
    prev.message.role === next.message.role &&
    prev.message.personaDisplayName === next.message.personaDisplayName &&
    prev.message.residentPersonaId === next.message.residentPersonaId &&
    depthGuideActionsEqual(
      prev.collapseDepthGuideActions,
      next.collapseDepthGuideActions,
    ) &&
    prev.collapseLongBody === next.collapseLongBody &&
    prev.authorVisiting === next.authorVisiting &&
    prev.quickReactions === next.quickReactions &&
    prev.collapseDescendantsLabel === next.collapseDescendantsLabel &&
    prev.connectDescendants === next.connectDescendants &&
    numberArrayEqual(prev.depthGuideDepths, next.depthGuideDepths) &&
    prev.highlightDescendantRail === next.highlightDescendantRail &&
    prev.highlighted === next.highlighted &&
    prev.highlightReplyConnector === next.highlightReplyConnector &&
    numberArrayEqual(
      prev.highlightThreadLineDepths,
      next.highlightThreadLineDepths,
    ) &&
    prev.hoverBackground === next.hoverBackground &&
    prev.huddleMemberPubkeys === next.huddleMemberPubkeys &&
    prev.huddleMemberPubkeysPending === next.huddleMemberPubkeysPending &&
    prev.isContinuation === next.isContinuation &&
    prev.isFollowingThread === next.isFollowingThread &&
    prev.isUnread === next.isUnread &&
    prev.layoutVariant === next.layoutVariant &&
    prev.onCollapseDepthGuide === next.onCollapseDepthGuide &&
    prev.onCollapseDepthGuideHoverChange ===
      next.onCollapseDepthGuideHoverChange &&
    prev.onCollapseDescendants === next.onCollapseDescendants &&
    prev.onCollapseDescendantsHoverChange ===
      next.onCollapseDescendantsHoverChange &&
    prev.onEntranceComplete === next.onEntranceComplete &&
    prev.playEntrance === next.playEntrance &&
    prev.profiles === next.profiles &&
    prev.agentNamesEnabled === next.agentNamesEnabled &&
    prev.searchQuery === next.searchQuery &&
    prev.videoReviewContext === next.videoReviewContext,
);

MessageRow.displayName = "MessageRow";
