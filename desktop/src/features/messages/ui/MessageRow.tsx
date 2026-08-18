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
import {
  ResidentIdentityMark,
  type ResidentMarkLiveState,
} from "@/features/channels/ui/ResidentIdentityMark";
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
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { useChannelNavigation } from "@/shared/context/ChannelNavigationContext";
import { parseImetaTags } from "@/features/messages/lib/parseImeta";
import { managedOperationalCopy } from "@/features/messages/lib/managedOperationalStatus";
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
    residentMarksEnabled = true,
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
    residentMarksEnabled?: boolean;
    showDepthGuides?: boolean;
    videoReviewContext?: VideoReviewContext;
  }) {
    const [expandedDiffId, setExpandedDiffId] = React.useState<string | null>(
      null,
    );
    const [badgeBurstEmoji, setBadgeBurstEmoji] = React.useState<string | null>(
      null,
    );
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
              className={cn(
                "max-w-full text-base leading-[1.68] text-foreground/90",
                emojiOnly &&
                  "text-4xl leading-tight [&_p]:leading-tight [&_img[data-custom-emoji]]:h-[1.45em] [&_img[data-custom-emoji]]:align-middle [&_button:has(img[data-custom-emoji])]:align-middle",
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
    // One gutter for everyone who speaks: residents wear their identity glyph,
    // people wear the lettered circle they carry in the sidebar. Otherwise the
    // owner's rows start a column early and read as a hole in the timeline.
    const showResidentMarkGutter = Boolean(
      residentMarksEnabled && message.pubkey,
    );
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

    const statusMetadataNode =
      message.pending || message.edited ? (
        <>
          {message.pending ? (
            <p className="font-medium uppercase tracking-[0.14em] text-primary/80">
              Sending
            </p>
          ) : null}
          {message.edited ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-muted-foreground/70">(edited)</p>
              </TooltipTrigger>
              <TooltipContent>This message has been edited</TooltipContent>
            </Tooltip>
          ) : null}
        </>
      ) : null;

    const managedStatusNode = (() => {
      if (interruptedOwnerReceipt) {
        return (
          <p
            className="mt-1 text-2xs leading-4 text-muted-foreground/55"
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
      const status = managedOperationalCopy(managed.phase, managed.failure);
      if (!status) return null;
      return (
        <p
          className={cn(
            "mt-1 text-xs",
            status.tone === "attention"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
          data-testid="managed-response-status"
          role="status"
        >
          {status.label}
        </p>
      );
    })();

    // While a reply is coming and no text has arrived, the mark carries the
    // state and one quiet word beside the name says what — "thinking",
    // "reading files". Once words stream, the mark holds lit and the word goes.
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
          residentMarkLive === "writing" && message.body === ""
          ? "writing"
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

    const inlineMetadataNode = (
      <div className="flex shrink-0 items-baseline gap-2 text-xs">
        <MessageTimestamp createdAt={message.createdAt} time={message.time} />
        {statusMetadataNode}
        {activityWord ? (
          <span
            className="text-muted-foreground/70"
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
          className="ml-auto shrink-0 rounded text-xs leading-4 text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring active:text-foreground/80 disabled:cursor-default disabled:text-muted-foreground/40 disabled:hover:text-muted-foreground/40"
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

    const headerNode = isContinuation ? null : (
      <MessageHeaderRow>
        {message.pubkey ? (
          <UserProfilePopover
            pubkey={message.pubkey}
            role={profilePopoverRole}
            botIdenticonValue={message.author}
          >
            <button
              className="truncate rounded leading-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              type="button"
            >
              {authorNode}
            </button>
          </UserProfilePopover>
        ) : (
          authorNode
        )}
        {inlineMetadataNode}
        {message.personaDisplayName &&
        message.personaDisplayName !== message.author ? (
          <span className="text-xs text-muted-foreground">
            {message.personaDisplayName}
          </span>
        ) : null}
        {stopNode}
      </MessageHeaderRow>
    );
    const bodyContainerClass = isContinuation ? "mt-0" : bodyOffsetClass;

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
            "py-1.5",
            hoverBackground
              ? "mx-1 px-2 hover:bg-muted/45 focus-within:bg-muted/45"
              : isThreadReplyLayout
                ? "mx-1 px-2"
                : "px-2",
            "flex",
            (isThreadReplyLayout || showResidentMarkGutter) && "gap-2.5",
            isContinuation ? "items-center" : "items-start",
            hasActiveReminder ? "bg-foreground/[0.045]" : "",
            highlighted
              ? "-mx-4 rounded-none px-6 before:absolute before:-inset-y-1.5 before:inset-x-0 before:animate-[route-target-highlight-fade_2s_ease-out_forwards] before:bg-primary/10 before:content-[''] motion-reduce:before:animate-none sm:-mx-6 sm:px-8"
              : "",
          )}
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
          onAnimationEnd={handleEntranceAnimationEnd}
        >
          {isThreadReplyLayout ? (
            <span aria-hidden className="w-4 shrink-0" />
          ) : null}
          {showResidentMarkGutter && message.pubkey ? (
            // 21 px: a multiple of the glyph's 7-cell edge, so the mark's cells
            // sit on whole pixels at 1x and 2x and the live mark can redraw the
            // resting glyph seamlessly. The person's disc shares the slot.
            <span className="mt-0.5 flex w-[21px] shrink-0 justify-center">
              {isContinuation ? (
                <span aria-hidden className="size-[21px]" />
              ) : message.isAgent ? (
                <ResidentIdentityMark
                  accessibleName={message.author}
                  decorative
                  live={residentMarkLive}
                  personaId={message.residentPersonaId}
                  publicKey={message.pubkey}
                  size={21}
                />
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
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {headerNode}
            <div
              className={cn(
                bodyContainerClass,
                message.managedPresentation && "managed-response-content",
              )}
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
    prev.residentMarksEnabled === next.residentMarksEnabled &&
    prev.searchQuery === next.searchQuery &&
    prev.videoReviewContext === next.videoReviewContext,
);

MessageRow.displayName = "MessageRow";
