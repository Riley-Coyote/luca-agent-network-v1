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
import { LUCA_GREETING_MARKER } from "@/features/luca/canonicalLucaResident";
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
    agentNamesEnabled = false,
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

    const { nonDmChannelNames: channelNames } = useChannelNavigation();
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
    // Luca's opening offer is part of Luca's greeting: an option list under
    // the words, once they have all arrived, until the owner has said anything.
    const lucaChoices = React.useContext(LucaGreetingChoicesContext);
    const residentStop = React.useContext(ResidentStopContext);
    const showLucaChoices =
      lucaChoices?.active === true &&
      !message.managedPresentation?.streaming &&
      Boolean(
        message.tags?.some(
          (tag) => tag[0] === "client" && tag[1] === LUCA_GREETING_MARKER,
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
              content={message.body}
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
              videoReviewContext={videoReviewContext}
            />
          );
      }
    };

    const isThreadReplyLayout = layoutVariant === "thread-reply";
    const quietAgent = Boolean(message.isAgent && !agentNamesEnabled);
    // Agent replies read directly on the conversation plane. Human contacts
    // keep their avatar; the owner's aligned bubble needs no empty gutter.
    const showResidentMarkGutter = Boolean(
      !message.isAgent && !ownBubble && message.pubkey,
    );
    // Whether this row actually DRAWS something in the 21px mark column, as
    // opposed to holding the slot open. A visit passage runs its connector
    // through that column and reserves the mark's height as a gap, so a row
    // that keeps the slot empty — a continuation, or the owner's own turn in
    // the bubble school — has to be told apart from one that fills it, or the
    // line breaks across it. Read from the reading plane by
    // `message-anatomy.css`; see THE CONNECTOR THROUGH AN EMPTY SLOT there.
    const paintsResidentMark =
      showResidentMarkGutter && !isContinuation && !ownBubble;
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
            quickReactions={quickReactions}
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
    const managedPhase = message.managedPresentation?.phase;
    const residentMarkLive: ResidentMarkLiveState = !message.managedPresentation
      ?.streaming
      ? null
      : managedPhase === "waking" ||
          managedPhase === "thinking" ||
          managedPhase === "working"
        ? "thinking"
        : managedPhase === "writing" || managedPhase === "finalizing"
          ? "writing"
          : null;
    // "waking" is the honest word for a resident the desktop is starting on
    // the owner's behalf: nothing is thinking yet, and saying so is what
    // keeps a longer wait from reading as a broken one.
    const activityWord =
      residentMarkLive === "thinking"
        ? (message.managedPresentation?.activityLabel ??
          (managedPhase === "waking"
            ? "waking"
            : managedPhase === "working"
              ? "working"
              : "thinking"))
        : // The "writing" phase can arrive a beat before the first chunk;
          // until words exist the row keeps a word rather than going bare.
          // The runtime's own narration wins here for the same reason it wins
          // above: it says what is being written, and the phase word only says
          // that something is. Falls back when nothing was narrated.
          residentMarkLive === "writing" && message.body === ""
          ? (message.managedPresentation?.activityLabel ?? "writing")
          : null;

    // In a direct conversation the row is where a reply is stopped: one quiet
    // word at the row's edge while the resident is live, gone once the reply
    // has landed. Rooms carry Stop on the activity shelf instead.
    const stopPubkey =
      residentStop && message.managedPresentation?.streaming && message.pubkey
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
    const stopNode =
      showStop && stopPubkey ? (
        <button
          aria-label={`Stop ${message.author}`}
          className="ml-auto shrink-0 rounded text-xs leading-4 text-ink-faint transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring active:text-ink-muted disabled:cursor-default disabled:text-ink-faint disabled:hover:text-ink-faint"
          data-testid="resident-stop"
          disabled={stopping}
          onClick={() => residentStop?.onStop(stopPubkey)}
          type="button"
        >
          {stopping ? "Stopping" : "Stop"}
        </button>
      ) : null;

    const continuationMetadataNode =
      isContinuation && statusMetadataNode ? (
        <div className="mt-0.5 flex items-baseline gap-2 text-xs">
          {statusMetadataNode}
        </div>
      ) : null;

    const hasVisibleMetadata = Boolean(
      managedWorkDuration ||
        authorVisiting ||
        statusMetadataNode ||
        activityWord ||
        stopNode,
    );
    const headerNode = isContinuation ? null : (
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
        {message.isAgent && agentNamesEnabled && message.pubkey ? (
          <AgentMessageRuntime
            publicKey={message.pubkey}
            personaId={message.residentPersonaId}
          />
        ) : null}
        {inlineMetadataNode}
        {!quietAgent &&
        message.personaDisplayName &&
        message.personaDisplayName !== message.author ? (
          <span className="text-xs text-muted-foreground">
            {message.personaDisplayName}
          </span>
        ) : null}
        {stopNode}
      </MessageHeaderRow>
    );
    const bodyContainerClass =
      isContinuation || (quietAgent && !hasVisibleMetadata)
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
          <LucaGreetingChoices onChoose={lucaChoices.onChoose} />
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

    return (
      <div
        className="relative"
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
            isContinuation ? "items-center" : "items-start",
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
            // 21 px: a multiple of the glyph's 7-cell edge, so the mark's cells
            // sit on whole pixels at 1x and 2x and the live mark can redraw the
            // resting glyph seamlessly. The person's disc shares the slot.
            // The slot stays occupied even when nothing is drawn in it. The
            // visit passage measures its connector from this column — the line
            // is centred on +22.5 px from the passage inset, derived from the
            // article's own padding and this 21 px — so emptying the slot is
            // fine but removing it would move a hairline that is checked to
            // half a pixel.
            <span
              className="mt-0.5 flex w-[21px] shrink-0 justify-center"
              data-message-mark
            >
              {isContinuation || ownBubble ? (
                // Anchored right, the owner's turn says who it is by where it
                // sits; a disc on the far left of the same row would be an
                // orphan pointing back at a column the words no longer use.
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
