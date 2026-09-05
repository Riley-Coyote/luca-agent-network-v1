import { useEffect, useEffectEvent } from "react";
import {
  defaultScheduler,
  notifyManager,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

import {
  channelMessagesKey,
  channelWindowKey,
  threadRepliesKey,
} from "@/features/messages/lib/messageQueryKeys";
import { isMissingPrimaryContextSendError } from "@/features/messages/lib/conversationContextSendError";
import {
  buildReplyTags,
  getThreadReference,
  isBroadcastReply,
  normalizeMentionPubkeys,
  resolveReplyRootId,
} from "@/features/messages/lib/threading";
import {
  projectChannelWindowMessages,
  refreshChannelWindowMessages,
} from "@/features/messages/lib/projectChannelWindow";
import { reconcileChannelWindowMessages } from "@/features/messages/lib/channelWindowReconciliation";
import {
  mergeMessages,
  mergeTimelineCacheMessages,
} from "@/features/messages/lib/messageMerge";

export { mergeMessages, mergeTimelineCacheMessages };
import { splitOutgoingTags } from "@/features/messages/lib/imetaMediaMarkdown";
import { messageMentionPubkeys } from "@/features/messages/lib/messageMentionPubkeys";
import {
  deriveManagedAudience,
  managedAudiencePubkeys,
  type ManagedAudienceIntentV1,
  type ManagedResponseSurface,
} from "@/features/messages/lib/managedAudience";
import {
  completeManagedPresentationForConversation,
  removeManagedPresentationByFinalMessageId,
  failManagedPresentationWake,
  removeManagedPresentationsByReceipt,
  replaceManagedPresentationReceipt,
  seedManagedPresentations,
} from "@/features/messages/managedPresentationStore";
import { managedAgentsQueryKey } from "@/features/agents/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { startManagedAgent } from "@/shared/api/tauriManagedAgents";
import { managedDispatchReceiptIdFromTags } from "@/features/messages/managedPresentationProtocol";
import {
  clearTimeoutState,
  recordTimeoutFromRejection,
} from "@/features/moderation/lib/timeoutStore";
import { relayClient, setVisibleChannel } from "@/shared/api/relayClient";
import { customEmojiQueryKey } from "@/features/custom-emoji/hooks";
import { channelsQueryKey } from "@/features/channels/hooks";
import { reactionEmojiUrl } from "@/shared/api/customEmoji";
import type { CustomEmoji } from "@/shared/lib/remarkCustomEmoji";
import {
  addReaction,
  deleteMessage,
  editMessage,
  removeReaction,
  sendChannelMessage,
} from "@/shared/api/tauri";
import { getChannelWindowEvents } from "@/shared/api/channelWindow";
import type {
  Channel,
  Identity,
  ManagedAgent,
  RelayEvent,
} from "@/shared/api/types";
// Same .mjs the renderer uses, so the cache-update projection can't drift
// from the on-render overlay.
import { applyEditTagOverlay } from "@/features/messages/lib/applyEditTagOverlay.mjs";
import {
  emptyChannelWindowStore,
  mapChannelWindowEvents,
  mergeLiveChannelWindowEvent,
  mergeLiveThreadSummary,
  replaceNewestChannelWindow,
  setOptimisticSendState,
  type ChannelWindowStore,
} from "@/features/messages/lib/channelWindowStore";
import { retainOptimisticSendError } from "@/features/messages/lib/retainedOptimisticSendError";
import {
  failedSendRetry,
  removeFailedSendRetry,
  retainFailedSendRetry,
} from "@/features/messages/lib/failedSendRetryState";
import {
  parseChannelWindowResponse,
  parseLiveThreadSummary,
} from "@/features/messages/lib/channelWindowResponse";
import {
  CHANNEL_AUX_EVENT_KINDS,
  CHANNEL_TIMELINE_CONTENT_KINDS,
  KIND_CHANNEL_THREAD_SUMMARY,
  KIND_DELETION,
  KIND_NIP29_DELETE_EVENT,
  KIND_STREAM_MESSAGE,
  KIND_SYSTEM_MESSAGE,
} from "@/shared/constants/kinds";

export type SendMessageVariables = {
  channelId?: string;
  targetChannel?: Channel;
  content: string;
  mentionPubkeys?: string[];
  explicitMentionPubkeys?: string[];
  parentEventId?: string | null;
  replyAuthorPubkey?: string | null;
  managedAudience?: ManagedAudienceIntentV1;
  responseSurface?: ManagedResponseSurface;
  mediaTags?: string[][];
  /** Local-only completion owned by the composer (for example draft cleanup). */
  onAccepted?: () => void;
  /** Internal: retry the retained optimistic row instead of inserting another. */
  retryOptimisticId?: string;
};

type MessageQueryContext = {
  optimisticId: string;
  channelId: string;
};

const CHANNEL_TIMELINE_KINDS = new Set<number>(CHANNEL_TIMELINE_CONTENT_KINDS);
const CHANNEL_AUX_KINDS = new Set<number>(CHANNEL_AUX_EVENT_KINDS);

export function createOptimisticMessage(
  channelId: string,
  content: string,
  identity: Identity,
  currentMessages: RelayEvent[],
  mentionPubkeys: string[] = [],
  parentEventId: string | null = null,
  mediaTags: string[][] = [],
  responseSurface: ManagedResponseSurface = "timeline",
): RelayEvent {
  const localKey = `optimistic-${crypto.randomUUID()}`;
  const tags: string[][] = [];

  if (parentEventId) {
    tags.push(
      ...buildReplyTags(
        channelId,
        identity.pubkey,
        parentEventId,
        resolveReplyRootId(parentEventId, currentMessages),
        mentionPubkeys,
      ),
    );
    if (responseSurface === "timeline") {
      tags.push(["broadcast", "1"]);
    }
  } else {
    tags.push(["h", channelId]);
    tags.push(["p", identity.pubkey]);
    for (const pubkey of normalizeMentionPubkeys(
      mentionPubkeys,
      identity.pubkey,
    )) {
      tags.push(["p", pubkey]);
    }
  }

  for (const tag of mediaTags) {
    tags.push(tag);
  }

  return {
    id: localKey,
    localKey,
    pubkey: identity.pubkey,
    created_at: Math.floor(Date.now() / 1_000),
    kind: KIND_STREAM_MESSAGE,
    tags,
    content,
    sig: "",
    pending: true,
  };
}

/**
 * Resolves the effective target channel for a send operation.
 *
 * When `capturedChannelId` is supplied (non-null), the target is looked up from
 * `channelsCache` — this pins the send to the compose-time channel regardless
 * of any subsequent navigation. If the id is supplied but resolves to nothing,
 * returns `null` (caller should throw — don't silently fall back to the live
 * channel). When `capturedChannelId` is null, the caller didn't capture one and
 * the closed-over `fallbackChannel` is the intended target.
 *
 * Exported for unit testing.
 */
export function resolveEffectiveChannel(
  capturedChannelId: string | null | undefined,
  channelsCache: Channel[] | undefined,
  fallbackChannel: Channel | null,
): Channel | null {
  if (capturedChannelId == null) {
    return fallbackChannel;
  }
  return channelsCache?.find((c) => c.id === capturedChannelId) ?? null;
}

/**
 * Resolves a send target captured as either the channel object itself or its id.
 * A relay-returned channel remains authoritative even when the shared channel
 * list is temporarily stale and does not contain it.
 *
 * Exported for unit testing.
 */
export function resolveSendChannel(
  targetChannel: Channel | undefined,
  capturedChannelId: string | null | undefined,
  channelsCache: Channel[] | undefined,
  fallbackChannel: Channel | null,
): Channel | null {
  return (
    targetChannel ??
    resolveEffectiveChannel(capturedChannelId, channelsCache, fallbackChannel)
  );
}

/**
 * Resolves the thread reply target from a submit-time captured context or,
 * for callers that predate the capture pattern, from live refs.
 *
 * When `threadContext` is supplied (non-null), its values are used exclusively
 * — no live-ref reads occur. This is the race-free path: the context was
 * captured synchronously at submit time before any async awaits.
 *
 * When `threadContext` is null/undefined (legacy callers), falls back to
 * `liveReplyTargetId ?? liveThreadHeadId`.
 *
 * Returns null when no parentEventId can be resolved (caller should bail).
 */
export function resolveThreadReplyTarget(
  threadContext:
    | { parentEventId: string | null; threadHeadId: string | null }
    | null
    | undefined,
  liveReplyTargetId: string | null | undefined,
  liveThreadHeadId: string | null | undefined,
): { parentEventId: string; threadHeadId: string | null } | null {
  if (threadContext != null) {
    // Captured context: use exclusively — no ?? fallback to live refs.
    if (!threadContext.parentEventId) {
      return null;
    }
    return {
      parentEventId: threadContext.parentEventId,
      threadHeadId: threadContext.threadHeadId,
    };
  }
  // Legacy path: read from live refs.
  const parentEventId = liveReplyTargetId ?? liveThreadHeadId ?? null;
  if (!parentEventId) {
    return null;
  }
  return {
    parentEventId,
    threadHeadId: liveThreadHeadId ?? null,
  };
}

export function useChannelWindowQuery(channel: Channel | null) {
  const queryClient = useQueryClient();
  const queryKey = channelWindowKey(channel?.id ?? "none");
  return useQuery({
    enabled: channel !== null && channel.channelType !== "forum",
    queryKey,
    queryFn: () =>
      queryClient.getQueryData<ChannelWindowStore>(queryKey) ??
      emptyChannelWindowStore(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useChannelMessagesQuery(channel: Channel | null) {
  const queryClient = useQueryClient();
  const queryKey = channelMessagesKey(channel?.id ?? "none");
  const windowKey = channelWindowKey(channel?.id ?? "none");

  return useQuery({
    enabled: channel !== null && channel.channelType !== "forum",
    queryKey,
    queryFn: async () => {
      if (!channel) throw new Error("No channel selected.");
      const previousMessages =
        queryClient.getQueryData<RelayEvent[]>(queryKey) ?? [];
      const events = await getChannelWindowEvents(channel.id);
      const page = parseChannelWindowResponse(events, channel.id, null);
      const current =
        queryClient.getQueryData<ChannelWindowStore>(windowKey) ??
        emptyChannelWindowStore();
      const next = replaceNewestChannelWindow(current, page);
      queryClient.setQueryData(windowKey, next);
      return reconcileChannelWindowMessages(next, previousMessages);
    },
    staleTime: 5 * 60 * 1_000,
    gcTime: 60 * 60 * 1_000,
  });
}

export function useChannelSubscription(channel: Channel | null) {
  const queryClient = useQueryClient();
  const channelId = channel?.id ?? null;
  const channelType = channel?.channelType ?? null;
  const refreshNewestWindow = useEffectEvent(async () => {
    if (!channelId) return;
    await refreshChannelWindowMessages(queryClient, channelId);
  });

  const appendMessage = useEffectEvent((event: RelayEvent) => {
    if (!channelId) return;
    if (
      event.kind === KIND_DELETION ||
      event.kind === KIND_NIP29_DELETE_EVENT
    ) {
      for (const tag of event.tags) {
        if (tag[0] === "e" && typeof tag[1] === "string") {
          removeManagedPresentationByFinalMessageId(tag[1]);
        }
      }
    }
    if (event.kind === KIND_CHANNEL_THREAD_SUMMARY) {
      // Relay-pushed live badge recount — window-store overlay only, never a
      // timeline row (mirrors the page path, where 39005 is metadata).
      const parsed = parseLiveThreadSummary(event);
      if (!parsed) return;
      const windowKey = channelWindowKey(channelId);
      const current =
        queryClient.getQueryData<ChannelWindowStore>(windowKey) ??
        emptyChannelWindowStore();
      const next = mergeLiveThreadSummary(current, parsed.rootId, parsed.live);
      if (next !== current) queryClient.setQueryData(windowKey, next);
      return;
    }
    const isTimelineRow = CHANNEL_TIMELINE_KINDS.has(event.kind);
    const threadReference = isTimelineRow
      ? getThreadReference(event.tags)
      : null;
    const managedDispatchReceiptId = isTimelineRow
      ? managedDispatchReceiptIdFromTags(event.tags)
      : null;
    if (managedDispatchReceiptId) {
      completeManagedPresentationForConversation(
        event.pubkey,
        managedDispatchReceiptId,
        channelId,
        event.id,
        event.content,
      );
    }
    if (threadReference?.parentId != null) {
      const rootId = threadReference?.rootId;
      if (rootId) {
        queryClient.setQueryData<RelayEvent[]>(
          threadRepliesKey(channelId, rootId),
          (current = []) => mergeMessages(current, event),
        );
      }
      if (!isBroadcastReply(event.tags)) return;
    }
    if (!isTimelineRow && !CHANNEL_AUX_KINDS.has(event.kind)) return;
    if (!isTimelineRow) {
      queryClient.setQueriesData<RelayEvent[]>(
        { queryKey: ["thread-replies", channelId] },
        (current = []) => mergeMessages(current, event),
      );
    }

    const windowKey = channelWindowKey(channelId);
    const current =
      queryClient.getQueryData<ChannelWindowStore>(windowKey) ??
      emptyChannelWindowStore();
    const next = mergeLiveChannelWindowEvent(current, event, isTimelineRow);
    if (next !== current) {
      queryClient.setQueryData(windowKey, next);
      projectChannelWindowMessages(queryClient, channelId);
    }

    if (event.kind === KIND_SYSTEM_MESSAGE) {
      try {
        const payload = JSON.parse(event.content) as { type?: string };
        if (
          payload.type === "member_joined" ||
          payload.type === "member_left" ||
          payload.type === "member_removed"
        ) {
          void queryClient.invalidateQueries({
            queryKey: ["channels", channelId, "members"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["channels"],
            exact: true,
          });
        }
      } catch {
        // Non-JSON system message — ignore.
      }
    }
  });

  // Notify the relay client which channel is currently visible so its live
  // subscriptions are replayed first on reconnect, reducing latency on
  // degraded networks.
  useEffect(() => {
    if (!channelId || channelType === "forum") return;
    setVisibleChannel(channelId);
    return () => {
      setVisibleChannel(null);
    };
  }, [channelId, channelType]);

  useEffect(() => {
    if (!channelId || channelType === "forum") {
      return;
    }

    let isDisposed = false;
    let cleanup: (() => Promise<void>) | undefined;
    const disposeReconnectListener = relayClient.subscribeToReconnects(() => {
      void refreshNewestWindow().catch((error) => {
        if (!isDisposed) {
          console.error(
            "Failed to refresh channel window after reconnecting",
            channelId,
            error,
          );
        }
      });
    });

    relayClient
      .subscribeToChannelLive(channelId, (event) => {
        if (!isDisposed) {
          appendMessage(event);
        }
      })
      .then((dispose) => {
        if (isDisposed) {
          void dispose();
          return;
        }

        cleanup = dispose;
        void refreshNewestWindow().catch((error) => {
          if (!isDisposed) {
            console.error(
              "Failed to refresh channel window after subscribing",
              channelId,
              error,
            );
          }
        });
      })
      .catch((error) => {
        console.error("Failed to subscribe to channel", channelId, error);
      });

    return () => {
      isDisposed = true;
      disposeReconnectListener();
      if (cleanup) {
        void cleanup();
      }
    };
  }, [channelId, channelType]);
}

/** Managed residents in the audience whose local process is not running. */
function sleepingManagedResidents(
  audiencePubkeys: readonly string[],
  managedAgents: readonly ManagedAgent[] | undefined,
): ReadonlySet<string> {
  const byPubkey = new Map(
    (managedAgents ?? []).map((agent) => [
      normalizePubkey(agent.pubkey),
      agent,
    ]),
  );
  const sleeping = new Set<string>();
  for (const pubkey of audiencePubkeys) {
    const agent = byPubkey.get(normalizePubkey(pubkey));
    if (agent?.status === "stopped") sleeping.add(normalizePubkey(pubkey));
  }
  return sleeping;
}

export function useSendMessageMutation(
  channel: Channel | null,
  identity: Identity | undefined,
  managedResidentPubkeys?: ReadonlySet<string>,
  visitorPubkeys?: ReadonlySet<string>,
) {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    RelayEvent,
    Error,
    SendMessageVariables,
    MessageQueryContext | undefined
  >({
    mutationFn: async ({
      channelId: capturedChannelId,
      targetChannel,
      content,
      mentionPubkeys,
      explicitMentionPubkeys,
      parentEventId,
      replyAuthorPubkey,
      managedAudience,
      responseSurface = "timeline",
      mediaTags,
    }) => {
      // Prefer a channel captured by the caller at compose time. Otherwise,
      // resolve a captured id from the shared channel cache so navigation
      // cannot redirect the message. Legacy callers without either value use
      // the closed-over `channel`.
      const effectiveChannel = resolveSendChannel(
        targetChannel,
        capturedChannelId,
        queryClient.getQueryData<Channel[]>(channelsQueryKey),
        channel,
      );

      if (effectiveChannel == null) {
        if (capturedChannelId != null) {
          throw new Error("Channel is no longer available.");
        }
        throw new Error("This channel does not support message sending yet.");
      }

      if (effectiveChannel.channelType === "forum") {
        throw new Error("This channel does not support message sending yet.");
      }

      if (!identity) {
        throw new Error("No identity available for sending messages.");
      }

      // `mediaTags` arrives as the merged outgoing tag set (imeta + NIP-30
      // emoji). Split it so each kind goes to its own validated Tauri arg —
      // emoji tags must NOT ride the imeta-only `media` channel (that gate
      // rejects any non-imeta prefix, which silently dropped emoji sends).
      const {
        mediaTags: imetaTags,
        emojiTags,
        mentionTags,
      } = splitOutgoingTags(mediaTags);
      // `mentionPubkeys` is the delivery set assembled by the composer and may
      // already contain every DM participant. Only the separately captured
      // explicit set is evidence that the owner intentionally addressed them.
      const audience =
        managedAudience ??
        (managedResidentPubkeys
          ? deriveManagedAudience({
              channel: effectiveChannel,
              managedResidentPubkeys,
              explicitMentionPubkeys,
              replyAuthorPubkey,
              visitorPubkeys,
            })
          : undefined);
      const recipientPubkeys = messageMentionPubkeys(
        effectiveChannel,
        identity.pubkey,
        [
          ...(mentionPubkeys ?? []),
          ...(replyAuthorPubkey ? [replyAuthorPubkey] : []),
          ...(audience ? managedAudiencePubkeys(audience) : []),
        ],
      );

      // Luca keeps Buzz's composer and exact event/tag behavior, but routes
      // every send through the trusted desktop command so managed-resident
      // dispatch authority is staged before relay I/O. The returned optimistic
      // projection remains identical to the former media/reply command path.
      const cachedMessages =
        queryClient.getQueryData<RelayEvent[]>(
          channelMessagesKey(effectiveChannel.id),
        ) ?? [];
      const result = await sendChannelMessage(
        effectiveChannel.id,
        content,
        parentEventId ?? null,
        imetaTags,
        recipientPubkeys,
        undefined,
        emojiTags,
        mentionTags,
        audience,
        responseSurface,
        explicitMentionPubkeys,
      );
      const replyTags = parentEventId
        ? buildReplyTags(
            effectiveChannel.id,
            identity.pubkey,
            parentEventId,
            resolveReplyRootId(parentEventId, cachedMessages),
            recipientPubkeys,
          )
        : [];
      const baseTags = parentEventId
        ? replyTags
        : [
            ["h", effectiveChannel.id],
            ["p", identity.pubkey],
          ];

      return {
        id: result.eventId,
        pubkey: identity.pubkey,
        created_at: result.createdAt,
        kind: KIND_STREAM_MESSAGE,
        tags: [
          ...baseTags,
          ...(parentEventId && responseSurface === "timeline"
            ? [["broadcast", "1"]]
            : []),
          ...(!parentEventId
            ? normalizeMentionPubkeys(recipientPubkeys, identity.pubkey).map(
                (pk) => ["p", pk],
              )
            : []),
          ...imetaTags,
          ...emojiTags,
          ...mentionTags,
        ],
        content: content.trim(),
        sig: "",
      };
    },
    onMutate: async (variables) => {
      const {
        channelId: capturedChannelId,
        targetChannel,
        content,
        mentionPubkeys,
        explicitMentionPubkeys,
        parentEventId,
        replyAuthorPubkey,
        managedAudience,
        responseSurface = "timeline",
        mediaTags,
        retryOptimisticId,
      } = variables;
      // Mirror mutationFn's target resolution so the optimistic message lands
      // in the cache for the same channel as the real send. A caller-supplied
      // channel remains valid even when a stale channel-list read omitted it.
      const effectiveChannel = resolveSendChannel(
        targetChannel,
        capturedChannelId,
        queryClient.getQueryData<Channel[]>(channelsQueryKey),
        channel,
      );

      if (
        !effectiveChannel ||
        !identity ||
        effectiveChannel.channelType === "forum"
      ) {
        return undefined;
      }

      const queryKey = channelMessagesKey(effectiveChannel.id);
      // Cancellation starts synchronously, but waiting for its bookkeeping
      // before publishing the optimistic row makes acknowledgement latency
      // depend on an unrelated in-flight history request. Paint the local row
      // in this turn; the cancellation still prevents the stale fetch from
      // replacing it before the network mutation begins.
      const cancellation = queryClient.cancelQueries({ queryKey });

      const previousMessages =
        queryClient.getQueryData<RelayEvent[]>(queryKey) ?? [];
      const windowKey = channelWindowKey(effectiveChannel.id);
      const previousWindow =
        queryClient.getQueryData<ChannelWindowStore>(windowKey);
      const audience =
        managedAudience ??
        (managedResidentPubkeys
          ? deriveManagedAudience({
              channel: effectiveChannel,
              managedResidentPubkeys,
              explicitMentionPubkeys,
              replyAuthorPubkey,
              visitorPubkeys,
            })
          : undefined);
      const recipientPubkeys = messageMentionPubkeys(
        effectiveChannel,
        identity.pubkey,
        [
          ...(mentionPubkeys ?? []),
          ...(replyAuthorPubkey ? [replyAuthorPubkey] : []),
          ...(audience ? managedAudiencePubkeys(audience) : []),
        ],
      );
      const optimisticMessage = retryOptimisticId
        ? previousMessages.find((event) => event.id === retryOptimisticId)
        : createOptimisticMessage(
            effectiveChannel.id,
            content.trim(),
            identity,
            previousMessages,
            recipientPubkeys,
            parentEventId ?? null,
            mediaTags ?? [],
            responseSurface,
          );
      if (!optimisticMessage) {
        throw new Error("The failed message is no longer available to retry.");
      }
      if (audience) {
        // Wake-on-send. A resident whose process is not running cannot hear
        // this message, and until now the row said "thinking" for twelve
        // seconds before admitting nobody was home. Start it here, alongside
        // the send: the harness's first subscription replays sends from just
        // before its own start, so this message is exactly what the new
        // session will answer. The row says "waking" — honest, and enough to
        // carry a longer wait — and flips to "thinking" on the first frame.
        const audiencePubkeys = managedAudiencePubkeys(audience);
        const sleeping = sleepingManagedResidents(
          audiencePubkeys,
          queryClient.getQueryData<ManagedAgent[]>(managedAgentsQueryKey),
        );
        seedManagedPresentations(
          effectiveChannel.id,
          optimisticMessage.id,
          audiencePubkeys,
          responseSurface,
          { wakingResidentPubkeys: sleeping },
        );
        for (const pubkey of sleeping) {
          void startManagedAgent(pubkey)
            .then(() => {
              void queryClient.invalidateQueries({
                queryKey: managedAgentsQueryKey,
              });
            })
            .catch(() => {
              failManagedPresentationWake(
                effectiveChannel.id,
                optimisticMessage.id,
                pubkey,
              );
            });
        }
      }

      retainFailedSendRetry(optimisticMessage.id, {
        ...variables,
        retryOptimisticId: undefined,
      });
      const currentWindow = previousWindow ?? emptyChannelWindowStore();
      const nextWindow = retryOptimisticId
        ? setOptimisticSendState(currentWindow, optimisticMessage.id, "sending")
        : mergeLiveChannelWindowEvent(currentWindow, optimisticMessage);
      queryClient.setQueryData(windowKey, nextWindow);
      // React Query intentionally batches ordinary cache notifications behind
      // a timer. For the owner's optimistic row that can burn several frames
      // before React even sees the new transcript. Queue this one projection
      // in the current microtask checkpoint; restore the library scheduler
      // immediately so background query traffic keeps its normal batching.
      notifyManager.setScheduler(queueMicrotask);
      try {
        projectChannelWindowMessages(queryClient, effectiveChannel.id);
      } finally {
        notifyManager.setScheduler(defaultScheduler);
      }

      await cancellation;

      return {
        optimisticId: optimisticMessage.id,
        channelId: effectiveChannel.id,
      };
    },
    onError: (error, _variables, context) => {
      // A community timeout surfaces here as the relay's `OK false` reason.
      // Record it so the composer can show the timeout chip and block further
      // sends until it expires; other errors fall through to the caller.
      recordTimeoutFromRejection(error?.message);
      if (!context) {
        return;
      }
      if (isMissingPrimaryContextSendError(error)) {
        // The folder can move after the last context read. Re-resolve the
        // native view immediately so the preserved draft gains the inline
        // Relink / Continue without it recovery instead of failing silently.
        void queryClient.invalidateQueries({
          queryKey: ["conversation-context", context.channelId],
        });
      }
      removeManagedPresentationsByReceipt(context.optimisticId);
      retainOptimisticSendError(error, context.channelId);
      const windowKey = channelWindowKey(context.channelId);
      queryClient.setQueryData<ChannelWindowStore>(windowKey, (current) =>
        setOptimisticSendState(
          current ?? emptyChannelWindowStore(),
          context.optimisticId,
          "failed",
        ),
      );
      projectChannelWindowMessages(queryClient, context.channelId);
    },
    onSuccess: (message, variables, context) => {
      // An accepted send proves the write-block is lifted; clear any recorded
      // timeout so the chip and disable state fall away immediately.
      clearTimeoutState();
      try {
        variables.onAccepted?.();
      } catch (error) {
        // Local draft bookkeeping must never turn a relay-accepted message
        // back into a failed send and invite a duplicate retry.
        console.warn("accepted message cleanup failed", error);
      }
      if (!context) {
        return;
      }
      removeFailedSendRetry(context.optimisticId);
      replaceManagedPresentationReceipt(context.optimisticId, message.id);

      const windowKey = channelWindowKey(context.channelId);
      const current =
        queryClient.getQueryData<ChannelWindowStore>(windowKey) ??
        emptyChannelWindowStore();
      const withoutPending: ChannelWindowStore = {
        ...current,
        liveOverlay: current.liveOverlay.filter(
          (event) => event.id !== context.optimisticId,
        ),
      };
      const next = mergeLiveChannelWindowEvent(withoutPending, {
        ...message,
        localKey: context.optimisticId,
      });
      queryClient.setQueryData(windowKey, next);
      projectChannelWindowMessages(queryClient, context.channelId);
    },
  });

  return {
    ...mutation,
    retryFailedMessage: async (optimisticId: string) => {
      const variables = failedSendRetry<SendMessageVariables>(optimisticId);
      if (!variables) {
        throw new Error("The failed message is no longer available to retry.");
      }
      await mutation.mutateAsync({
        ...variables,
        retryOptimisticId: optimisticId,
      });
    },
  };
}

export function useToggleReactionMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    {
      eventId: string;
      emoji: string;
      remove: boolean;
    }
  >({
    mutationFn: async ({ eventId, emoji, remove }) => {
      if (remove) {
        await removeReaction(eventId, emoji);
        return;
      }

      // Custom-emoji reaction: emoji is `:shortcode:`. Resolve its image URL
      // from the cached community palette so the kind:7 carries the NIP-30
      // `["emoji", shortcode, url]` tag. Unicode reactions resolve to no URL.
      const emojiUrl = reactionEmojiUrl(
        emoji,
        queryClient.getQueryData<CustomEmoji[]>(customEmojiQueryKey),
      );
      await addReaction(eventId, emoji, emojiUrl);
    },
  });
}

export function useDeleteMessageMutation(channel: Channel | null) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { eventId: string }>({
    mutationFn: async ({ eventId }) => {
      if (!channel) {
        throw new Error("No channel selected.");
      }
      await deleteMessage(channel.id, eventId);
    },
    onSuccess: (_data, { eventId }) => {
      if (!channel) return;
      queryClient.setQueryData<RelayEvent[]>(
        channelMessagesKey(channel.id),
        (current = []) => current.filter((message) => message.id !== eventId),
      );
    },
    onError: (error) => {
      toast.error(`Failed to delete message: ${error.message}`);
    },
  });
}

export function useEditMessageMutation(channel: Channel | null) {
  const queryClient = useQueryClient();

  return useMutation<
    void,
    Error,
    {
      eventId: string;
      content: string;
      mediaTags?: string[][];
      // Pubkeys of mentions *newly added* by this edit, diffed at the composer.
      // Only these receive a `p` tag so a typo-fix edit re-wakes nobody.
      mentionPubkeys?: string[];
    }
  >({
    mutationFn: async ({ eventId, content, mediaTags, mentionPubkeys }) => {
      if (!channel) {
        throw new Error("No channel selected.");
      }

      // `mediaTags` arrives as the merged outgoing set (imeta + NIP-30 emoji).
      // Split so each rides its own validated Tauri arg — emoji tags must NOT
      // go through the imeta-only `mediaTags` channel (the Rust `imeta_tags`
      // guard rejects any non-imeta prefix), mirroring the send path.
      const { mediaTags: imetaTags, emojiTags } = splitOutgoingTags(mediaTags);

      await editMessage(
        channel.id,
        eventId,
        content,
        imetaTags,
        emojiTags,
        mentionPubkeys,
      );
    },
    onSuccess: (_data, { eventId, content, mediaTags }) => {
      if (!channel) {
        return;
      }

      // Apply-on-success cache update: reflect the edit's new content and
      // imeta tag set immediately, so the local cache matches what the
      // receiver overlay (formatTimelineMessages) will produce when the
      // edit event arrives back from the relay. (Not a true optimistic
      // update — runs in onSuccess, not onMutate. Worth bearing the cost
      // only because the edit event round-trip can lag perceptibly.)
      const applyEdit = (message: RelayEvent): RelayEvent => {
        if (message.id !== eventId) return message;
        const nextTags = mediaTags
          ? applyEditTagOverlay(message.tags, mediaTags)
          : message.tags;
        return { ...message, content, tags: nextTags };
      };

      // The WINDOW STORE is the source of truth: every live merge
      // re-flattens it over `channelMessagesKey`, so patching only the
      // flattened array gets reverted by the next live event (see
      // mapChannelWindowEvents). Update the store first, then keep the
      // flattened cache in step for immediate paint.
      queryClient.setQueryData<ChannelWindowStore>(
        channelWindowKey(channel.id),
        (current) =>
          current ? mapChannelWindowEvents(current, applyEdit) : current,
      );
      queryClient.setQueryData<RelayEvent[]>(
        channelMessagesKey(channel.id),
        (current = []) => current.map(applyEdit),
      );
    },
  });
}
