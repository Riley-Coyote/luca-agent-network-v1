import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as React from "react";
import { TaskChatHeader } from "./TaskChatHeader";
import { CorrespondenceComposer } from "./CorrespondenceComposer";
import {
  generalCorrespondenceDraftKey,
  type CorrespondenceIntent,
} from "../correspondenceNavigation";
import { useTaskChatScroll } from "../useTaskChatScroll";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";

import {
  useManagedAgentsQuery,
  useRelayAgentsQuery,
} from "@/features/agents/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import {
  correspondenceDraftKey,
  correspondenceTasks,
  inboxLogicalTaskId,
  correspondencePairFilter,
  correspondenceTitle,
  validateCorrespondenceRead,
  mergeCorrespondenceReads,
  taskConversationEvents,
  taskUnreadCount,
} from "@/features/exchange/correspondenceView";
import {
  exchangeStatusLabel,
  exchangeTaskSubject,
} from "@/features/exchange/sideConversations";
import { parseImetaTags } from "@/features/messages/lib/parseImeta";
import {
  getActiveDraftEntries,
  initDraftStore,
} from "@/features/messages/lib/useDrafts";
import {
  clearPendingInboxReply,
  pendingInboxReplyRequest,
  pendingInboxReplyTarget,
} from "@/features/exchange/pendingInboxReply";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import {
  queryAgentInbox,
  readAgentInboxTask,
  sendAgentInboxReply,
  sendAgentInboxMessage,
  markAgentInboxTaskRead,
  getAgentInboxReadPositions,
  type AgentInboxCursor,
} from "@/shared/api/agentInbox";
import { useIdentityQuery } from "@/shared/api/hooks";
import { getExchange, resolveExchange } from "@/shared/api/exchanges";
import type { AgentInboxTask } from "@/shared/api/agentInbox";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Markdown } from "@/shared/ui/markdown";
import { ExchangeIdentityMark } from "./ExchangeIdentityMark";
import { relayClient } from "@/shared/api/relayClient";
import { subscribeCorrespondenceUpdates } from "@/features/exchange/correspondenceLive";

export type CorrespondenceWindowProps = {
  correspondenceId: string;
  initialTaskId?: string | null;
  initialIntent?: CorrespondenceIntent;
  initialRecipient?: string;
  initialReplyEventId?: string;
  residentPubkeys?: readonly string[];
  onTitleChange?: (title: string) => void;
  embedded?: boolean;
  primary?: boolean;
  /** A retained closing view is passive; task execution is independent. */
  active?: boolean;
  onClose?: () => void;
  onOpenMain?: (
    taskId: string,
    recipient: string,
    intent: CorrespondenceIntent,
    replyEventId?: string,
  ) => void;
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function taskState(task: AgentInboxTask) {
  if (task.record.state === "closed") return "closed" as const;
  if (task.record.deadline < Math.floor(Date.now() / 1000))
    return "expired" as const;
  return "open" as const;
}

/** A passive, source-scoped pair history; only the composer's Send dispatches. */
export function CorrespondenceWindow({
  correspondenceId,
  initialTaskId = null,
  initialIntent = "reply",
  initialRecipient = "",
  initialReplyEventId,
  residentPubkeys,
  onTitleChange,
  embedded = false,
  primary = false,
  active = true,
  onClose,
  onOpenMain,
}: CorrespondenceWindowProps) {
  const conversational = embedded || primary;
  const queryClient = useQueryClient();
  const identity = useIdentityQuery().data;
  const { activeCommunity, reinitKey } = useCommunities();
  const managed = useManagedAgentsQuery({ enabled: active }).data;
  const relay = useRelayAgentsQuery({ enabled: active }).data;
  const ownerPubkey = identity?.pubkey ? normalizePubkey(identity.pubkey) : "";
  const workspace = `${activeCommunity?.id ?? ""}:${reinitKey}:${ownerPubkey}`;
  const queryPrefix = [
    "agent-inbox-window",
    workspace,
    correspondenceId,
  ] as const;
  const [selectedTaskId, setSelectedTaskId] = React.useState(initialTaskId);
  const [recipient, setRecipient] = React.useState(initialRecipient);
  const [composeMode, setComposeMode] = React.useState<"reply" | "new-message">(
    initialIntent,
  );
  const [continuationRequested, setContinuationRequested] =
    React.useState(false);
  const [replyEventId, setReplyEventId] = React.useState(initialReplyEventId);
  const replyReturn = React.useRef<{
    recipient: string;
    mode: CorrespondenceIntent;
  } | null>(null);
  const cancelReply = () => {
    const previous = replyReturn.current;
    if (previous) {
      setRecipient(previous.recipient);
      setComposeMode(previous.mode);
    }
    replyReturn.current = null;
    setReplyEventId(undefined);
  };
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [stopping, setStopping] = React.useState(false);
  const [stopError, setStopError] = React.useState<string | null>(null);
  const viewIdentity = React.useRef("");
  viewIdentity.current = JSON.stringify([
    workspace,
    correspondenceId,
    selectedTaskId,
    composeMode,
    recipient,
    replyEventId,
  ]);
  const [draftStoreScope, setDraftStoreScope] = React.useState<string | null>(
    null,
  );
  React.useEffect(() => {
    if (!ownerPubkey || !activeCommunity?.relayUrl) {
      setDraftStoreScope(null);
      return;
    }
    initDraftStore(ownerPubkey, activeCommunity.relayUrl);
    setDraftStoreScope(workspace);
  }, [activeCommunity?.relayUrl, ownerPubkey, workspace]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const readEndRef = React.useRef<HTMLDivElement>(null);
  const markedRead = React.useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: owner/community/correspondence switches must discard the previous view target and retry identity.
  React.useEffect(() => {
    setSelectedTaskId(initialTaskId);
    setRecipient(initialRecipient);
    setComposeMode(initialIntent);
    replyReturn.current = null;
    setContinuationRequested(false);
    setReplyEventId(initialReplyEventId);
    setSendError(null);
    setStopError(null);
  }, [
    correspondenceId,
    initialTaskId,
    initialRecipient,
    initialIntent,
    initialReplyEventId,
    workspace,
  ]);
  React.useEffect(() => {
    if (!active || !isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ taskId?: string } | string>(
      "luca://correspondence-focus",
      ({ payload }) => {
        const id = typeof payload === "string" ? payload : payload.taskId;
        if (!id || !/^[0-9a-f]{64}$/i.test(id)) return;
        setSelectedTaskId(id);
        setRecipient("");
        setComposeMode("reply");
        setContinuationRequested(false);
        setReplyEventId(undefined);
        setSendError(null);
        setStopError(null);
      },
    ).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active]);
  React.useEffect(() => {
    if (!active || !isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("exchange-updated", () => {
      void queryClient.invalidateQueries({
        queryKey: ["agent-inbox-window", workspace, correspondenceId],
      });
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active, correspondenceId, queryClient, workspace]);

  const taskReads = useInfiniteQuery({
    queryKey: [...queryPrefix, "task", selectedTaskId],
    initialPageParam: undefined as AgentInboxCursor | undefined,
    queryFn: async ({ pageParam }) => {
      const result = await readAgentInboxTask(selectedTaskId ?? "", pageParam);
      return validateCorrespondenceRead(
        result,
        correspondenceId,
        selectedTaskId ?? "",
        ownerPubkey,
      );
    },
    getNextPageParam: (page) => page.nextOwnerReplyCursor ?? undefined,
    enabled: Boolean(active && ownerPubkey && selectedTaskId),
    retry: false,
  });
  const mergedRead = React.useMemo(
    () => mergeCorrespondenceReads(taskReads.data?.pages ?? []),
    [taskReads.data],
  );
  const read = { ...taskReads, data: mergedRead };
  const task = read.data?.task;
  const taskId =
    read.data?.logicalTaskId ?? (task ? inboxLogicalTaskId(task) : undefined);
  const attemptId = read.data?.currentAttemptId ?? task?.record.exchangeId;
  const exchangeState = useQuery({
    queryKey: [...queryPrefix, "exchange", attemptId],
    queryFn: () => getExchange(attemptId ?? ""),
    enabled: Boolean(active && attemptId),
    retry: false,
  });
  const pairFilter = correspondencePairFilter(
    read.data,
    correspondenceId,
    ownerPubkey,
    residentPubkeys,
  );
  const pair = pairFilter
    ? [pairFilter.residentPubkey, pairFilter.correspondentPubkey]
    : [];
  const pages = useInfiniteQuery({
    queryKey: [...queryPrefix, "tasks", pair.join(":")],
    initialPageParam: undefined as AgentInboxCursor | undefined,
    queryFn: ({ pageParam }) => {
      if (!pairFilter)
        throw new Error("Open a task to resolve this correspondence.");
      return queryAgentInbox({ ...pairFilter, cursor: pageParam, limit: 50 });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(active && ownerPubkey && pairFilter),
    retry: false,
  });
  const tasks = React.useMemo(
    () =>
      correspondenceTasks(
        pages.data?.pages ?? [],
        correspondenceId,
        ownerPubkey,
        read.data,
      ),
    [correspondenceId, ownerPubkey, pages.data, read.data],
  );
  const liveSources = [
    ...new Set(tasks.map((item) => item.record.conversationId)),
  ]
    .sort()
    .join(":");
  const liveMembers = pair.join(":");
  React.useEffect(() => {
    if (!active || !ownerPubkey || !liveMembers) return;
    let disposed = false;
    let dispose: (() => Promise<void>) | undefined;
    void subscribeCorrespondenceUpdates(
      relayClient,
      ownerPubkey,
      liveMembers.split(":"),
      liveSources ? liveSources.split(":") : [],
      () => {
        if (!disposed)
          return queryClient.invalidateQueries(
            {
              queryKey: ["agent-inbox-window", workspace, correspondenceId],
            },
            { cancelRefetch: false },
          );
      },
    )
      .then((cleanup) => {
        if (disposed) void cleanup();
        else dispose = cleanup;
      })
      .catch((error) =>
        console.warn("Correspondence live updates unavailable", error),
      );
    return () => {
      disposed = true;
      void dispose?.();
    };
  }, [
    active,
    ownerPubkey,
    liveMembers,
    liveSources,
    workspace,
    correspondenceId,
    queryClient,
  ]);
  const readPosition = useQuery({
    queryKey: [
      "agent-inbox-read-position",
      workspace,
      correspondenceId,
      taskId,
    ],
    queryFn: () => getAgentInboxReadPositions(taskId ? [taskId] : []),
    enabled: Boolean(active && taskId),
    retry: false,
  });
  const participantKeys = [
    ...new Set([
      ...(task?.record.members ?? tasks[0]?.record.members ?? pair),
      ...(read.data?.events.map((event) => event.pubkey) ?? []),
    ]),
  ];
  const profiles = useUsersBatchQuery(participantKeys, {
    enabled: active && participantKeys.length > 0,
  }).data?.profiles;
  const nameOf = React.useCallback(
    (pubkey: string) => {
      const key = normalizePubkey(pubkey);
      if (key === ownerPubkey) return "You";
      const known =
        managed?.find((agent) => normalizePubkey(agent.pubkey) === key)?.name ??
        relay?.find((agent) => normalizePubkey(agent.pubkey) === key)?.name;
      if (known) return known;
      return resolveUserLabel({
        pubkey: key,
        currentPubkey: ownerPubkey,
        profiles,
        fallbackName: known,
      });
    },
    [managed, ownerPubkey, profiles, relay],
  );
  const members = task?.record.members ?? tasks[0]?.record.members ?? pair;
  const title = correspondenceTitle(members, nameOf);
  React.useEffect(() => {
    onTitleChange?.(title);
  }, [onTitleChange, title]);
  const events = read.data?.events ?? [];
  const visibleEvents = taskConversationEvents(events, task);
  const latestReadEvent = events.reduce<(typeof events)[number] | undefined>(
    (latest, event) =>
      !latest ||
      event.created_at > latest.created_at ||
      (event.created_at === latest.created_at && event.id > latest.id)
        ? event
        : latest,
    undefined,
  );
  const latestReadEventId = latestReadEvent?.id;
  useTaskChatScroll(
    active && conversational,
    scrollRef,
    taskId,
    latestReadEventId,
    `${workspace}:${correspondenceId}`,
  );
  const unreadCount = taskId
    ? taskUnreadCount(events, ownerPubkey, readPosition.data?.[taskId])
    : null;
  React.useEffect(() => {
    const end = readEndRef.current;
    const root = scrollRef.current;
    if (!active || !end || !root || !taskId || !latestReadEventId) return;
    let visible = false;
    let pending = false;
    let disposed = false;
    const markerKey = `${workspace}:${taskId}:${latestReadEventId}`;
    const mark = () => {
      if (
        disposed ||
        pending ||
        !visible ||
        document.hidden ||
        markedRead.current === markerKey
      )
        return;
      pending = true;
      void markAgentInboxTaskRead(taskId, latestReadEventId)
        .then((position) => {
          if (!disposed) {
            markedRead.current = markerKey;
            queryClient.setQueryData(
              [
                "agent-inbox-read-position",
                workspace,
                correspondenceId,
                taskId,
              ],
              { [taskId]: position },
            );
          }
        })
        .catch((error) =>
          console.warn("Task read position was not saved", error),
        )
        .finally(() => {
          pending = false;
        });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        mark();
      },
      { root },
    );
    observer.observe(end);
    document.addEventListener("visibilitychange", mark);
    return () => {
      disposed = true;
      observer.disconnect();
      document.removeEventListener("visibilitychange", mark);
    };
  }, [
    active,
    latestReadEventId,
    taskId,
    workspace,
    correspondenceId,
    queryClient,
  ]);
  const root = task
    ? events.find(
        (event) =>
          event.id ===
          (read.data?.logicalRootEventId ?? task.record.rootEventId),
      )
    : undefined;
  const defaultResponder = task?.record.members.find(
    (key) => key !== task.record.openedBy,
  );
  // The task's addressee is the default, never whichever participant spoke last.
  React.useEffect(() => {
    if (conversational && defaultResponder && !recipient)
      setRecipient(defaultResponder);
  }, [conversational, defaultResponder, recipient]);
  const subject = exchangeTaskSubject(
    root?.content,
    recipient
      ? nameOf(recipient)
      : defaultResponder
        ? nameOf(defaultResponder)
        : "agent",
  );
  const state =
    exchangeState.data?.phase ?? (task ? taskState(task) : undefined);
  const needsContinuation =
    state === "closed" || state === "expired" || state === "paused";
  const capabilities = read.data?.writeCapabilities;
  const validReplyTarget =
    !replyEventId ||
    events.some(
      (event) =>
        event.id === replyEventId &&
        event.pubkey === recipient &&
        task?.record.members.includes(event.pubkey),
    );
  const mayCompose =
    validReplyTarget &&
    (composeMode === "new-message"
      ? capabilities?.newMessage === true
      : needsContinuation
        ? capabilities?.continuation === true &&
          (conversational || continuationRequested)
        : capabilities?.reply !== false);
  const validRecipient = task?.record.members.includes(recipient) ?? false;
  const draftKey =
    taskId && read.data
      ? composeMode === "new-message"
        ? generalCorrespondenceDraftKey(
            read.data.scope,
            correspondenceId,
            recipient,
            draftStoreScope === workspace
              ? getActiveDraftEntries().map((entry) => entry.key)
              : [],
          )
        : correspondenceDraftKey(
            read.data.scope,
            correspondenceId,
            taskId,
            recipient,
          )
      : undefined;
  React.useEffect(() => {
    if (draftKey)
      setReplyEventId(
        (current) => current ?? pendingInboxReplyTarget(draftKey),
      );
  }, [draftKey]);
  const partial =
    pages.data?.pages.some((page) => page.partial) || read.data?.partial;

  async function stopSelectedExchange() {
    if (
      !task ||
      !attemptId ||
      !exchangeState.data ||
      !["open", "paused"].includes(exchangeState.data.phase)
    )
      return;
    const exchangeId = attemptId;
    const view = viewIdentity.current;
    setStopping(true);
    setStopError(null);
    try {
      const settled = await resolveExchange(exchangeId, "stop");
      if (!settled)
        throw new Error("This exchange is no longer available to stop.");
      await queryClient.invalidateQueries({ queryKey: queryPrefix });
    } catch (error) {
      if (viewIdentity.current === view) setStopError(errorText(error));
    } finally {
      setStopping(false);
    }
  }

  async function send(
    content: string,
    _mentions: string[],
    mediaTags?: string[][],
  ) {
    if (
      !task ||
      !taskId ||
      !attemptId ||
      !read.data ||
      !validRecipient ||
      !draftKey ||
      !mayCompose
    )
      throw new Error("Choose a task and recipient before sending.");
    setSending(true);
    setSendError(null);
    const view = viewIdentity.current;
    try {
      const pending = await pendingInboxReplyRequest(
        draftKey,
        JSON.stringify([draftKey, replyEventId, content, mediaTags]),
        composeMode === "new-message"
          ? "new-message"
          : needsContinuation
            ? "continuation"
            : "reply",
        composeMode === "reply" ? replyEventId : undefined,
        undefined,
        attemptId,
      );
      const idempotencyKey = pending.idempotencyKey;
      const result =
        pending.operation === "new-message"
          ? await sendAgentInboxMessage({
              sourceExchangeId: pending.exchangeId ?? attemptId,
              recipientPubkey: recipient,
              content,
              mediaTags,
              idempotencyKey,
            })
          : await sendAgentInboxReply({
              exchangeId: pending.exchangeId ?? attemptId,
              recipientPubkey: recipient,
              replyEventId: pending.replyEventId,
              content,
              mediaTags,
              idempotencyKey,
              continuationIntent: pending.operation === "continuation",
            });
      if (
        result.correspondenceId &&
        result.correspondenceId !== correspondenceId
      )
        throw new Error(
          "The message was accepted, but its correspondence could not be reconciled. Keep the unchanged draft.",
        );
      clearPendingInboxReply(draftKey, idempotencyKey);
      await queryClient.invalidateQueries({ queryKey: queryPrefix });
      if (viewIdentity.current === view) {
        replyReturn.current = null;
        setReplyEventId(undefined);
        setContinuationRequested(false);
      }
      if (
        viewIdentity.current === view &&
        composeMode === "new-message" &&
        result.taskId
      ) {
        setSelectedTaskId(result.taskId);
        setComposeMode("reply");
        setContinuationRequested(false);
        setReplyEventId(undefined);
      }
    } catch (error) {
      if (viewIdentity.current === view) setSendError(errorText(error));
      throw error;
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      data-testid="correspondence-window"
      data-presentation={primary ? "main" : embedded ? "beside" : "detached"}
      inert={!active}
    >
      {conversational ? (
        <TaskChatHeader
          primary={primary}
          title={title}
          taskId={taskId}
          tasks={tasks.map((item) => ({
            id: inboxLogicalTaskId(item),
            title:
              inboxLogicalTaskId(item) === taskId
                ? subject
                : exchangeTaskSubject(
                    item.subject,
                    nameOf(
                      item.record.members.find(
                        (key) => key !== item.record.openedBy,
                      ) ?? item.record.openedBy,
                    ),
                  ),
          }))}
          sending={sending}
          onSelect={(id) => {
            setSelectedTaskId(id);
            setComposeMode("reply");
            setRecipient(initialRecipient);
            replyReturn.current = null;
            setReplyEventId(undefined);
            setSendError(null);
            setStopError(null);
          }}
          onRefresh={() =>
            void queryClient.invalidateQueries({ queryKey: queryPrefix })
          }
          onNewMessage={
            !sending && capabilities?.newMessage
              ? () => {
                  setComposeMode("new-message");
                  replyReturn.current = null;
                  setReplyEventId(undefined);
                  setSendError(null);
                }
              : undefined
          }
          onStop={
            !stopping &&
            !sending &&
            exchangeState.data &&
            ["open", "paused"].includes(exchangeState.data.phase)
              ? () => void stopSelectedExchange()
              : undefined
          }
          onLoadOlder={
            pages.hasNextPage && !pages.isFetchingNextPage
              ? () => void pages.fetchNextPage()
              : undefined
          }
          onClose={onClose}
          onOpenMain={
            onOpenMain && taskId
              ? () => onOpenMain(taskId, recipient, composeMode, replyEventId)
              : undefined
          }
        />
      ) : (
        <header className="luca-measure shrink-0 pb-3 pt-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-sm font-medium">Tasks</h1>
            <button
              className="text-xs text-primary hover:underline"
              onClick={() =>
                void queryClient.invalidateQueries({ queryKey: queryPrefix })
              }
              type="button"
            >
              Refresh
            </button>
          </div>
          {partial ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Some task history is not loaded or is unavailable.
            </p>
          ) : null}
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="luca-measure">
          {pages.isPending && pairFilter ? (
            <p className="py-3 text-sm text-muted-foreground">Loading tasks…</p>
          ) : null}
          {!pairFilter && !selectedTaskId && ownerPubkey ? (
            <p className="py-3 text-sm text-muted-foreground">
              Open a task from an agent’s inbox to load this correspondence.
            </p>
          ) : null}
          {pages.error ? (
            <p className="py-3 text-sm text-destructive" role="alert">
              {errorText(pages.error)}
            </p>
          ) : null}
          <nav
            hidden={conversational}
            aria-label="Tasks"
            className="mb-4 flex max-h-40 flex-col gap-1 overflow-y-auto overscroll-contain"
          >
            {tasks.map((item) => (
              <button
                aria-current={
                  taskId === inboxLogicalTaskId(item) ? "true" : undefined
                }
                className="shrink-0 rounded-md px-2 py-2 text-left hover:bg-plate focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary aria-[current=true]:bg-plate"
                key={inboxLogicalTaskId(item)}
                onClick={() => {
                  setSelectedTaskId(inboxLogicalTaskId(item));
                  setComposeMode("reply");
                  setContinuationRequested(false);
                  setRecipient("");
                  setReplyEventId(undefined);
                  setSendError(null);
                  setStopError(null);
                }}
                type="button"
              >
                <span className="block truncate text-sm">
                  {inboxLogicalTaskId(item) === taskId
                    ? subject
                    : exchangeTaskSubject(
                        item.subject,
                        nameOf(
                          item.record.members.find(
                            (key) => key !== item.record.openedBy,
                          ) ?? item.record.openedBy,
                        ),
                      )}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {exchangeStatusLabel(
                    taskState(item),
                    item.outcome === "reply_received",
                  )}{" "}
                  · {new Date(item.recordUpdatedAt * 1000).toLocaleDateString()}
                  {inboxLogicalTaskId(item) === taskId && unreadCount
                    ? ` · ${unreadCount} unread in loaded history`
                    : ""}
                </span>
              </button>
            ))}
          </nav>
          {!conversational && pages.hasNextPage ? (
            <button
              className="mb-4 text-sm text-primary hover:underline"
              disabled={pages.isFetchingNextPage}
              onClick={() => void pages.fetchNextPage()}
              type="button"
            >
              {pages.isFetchingNextPage ? "Loading…" : "Load older tasks"}
            </button>
          ) : null}
          {!pages.isPending && !tasks.length && !pages.error ? (
            <p className="py-3 text-sm text-muted-foreground">
              No tasks in the loaded history.
              {pages.hasNextPage ? " Load more to continue looking." : ""}
            </p>
          ) : null}
          {!selectedTaskId ? (
            <p className="py-4 text-sm text-muted-foreground">
              Choose a task to read or reply.
            </p>
          ) : null}
          {read.isFetching && !read.data && selectedTaskId ? (
            <p className="py-3 text-sm text-muted-foreground">
              Loading conversation…
            </p>
          ) : null}
          {read.error ? (
            <p className="py-3 text-sm text-destructive" role="alert">
              {errorText(read.error)}
            </p>
          ) : null}
          {task ? (
            <article aria-label={subject} className="pb-6">
              <h2 className="sr-only">{subject}</h2>
              <div className="flex flex-col gap-5">
                {visibleEvents.map((event) => (
                  <div
                    className={`group/task-message flex gap-2 ${event.pubkey === ownerPubkey ? "justify-end" : ""}`}
                    key={event.id}
                  >
                    {!conversational ? (
                      <ExchangeIdentityMark
                        name={nameOf(event.pubkey)}
                        pubkey={event.pubkey}
                        avatarUrl={profiles?.[event.pubkey]?.avatarUrl}
                      />
                    ) : null}
                    <div
                      className={
                        conversational && event.pubkey === ownerPubkey
                          ? "min-w-0 max-w-[90%] rounded-2xl bg-plate px-4 py-2"
                          : "min-w-0 flex-1"
                      }
                    >
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        {nameOf(event.pubkey)}
                      </p>
                      <Markdown
                        className="conversation-prose type-body max-w-full text-foreground"
                        content={event.content}
                        imetaByUrl={parseImetaTags(event.tags)}
                      />
                      {task.record.members.includes(event.pubkey) ? (
                        <button
                          className={
                            conversational
                              ? "mt-1 text-xs text-muted-foreground opacity-0 hover:underline focus-visible:opacity-100 group-hover/task-message:opacity-100"
                              : "mt-1 text-xs text-primary hover:underline"
                          }
                          onClick={() => {
                            if (!replyEventId)
                              replyReturn.current = {
                                recipient,
                                mode: composeMode,
                              };
                            setRecipient(event.pubkey);
                            setComposeMode("reply");
                            setContinuationRequested(false);
                            setReplyEventId(event.id);
                          }}
                          type="button"
                        >
                          Reply to {nameOf(event.pubkey)}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              {taskReads.hasNextPage ? (
                <button
                  className="mt-4 text-sm text-primary hover:underline"
                  disabled={taskReads.isFetchingNextPage}
                  onClick={() => void taskReads.fetchNextPage()}
                  type="button"
                >
                  {taskReads.isFetchingNextPage
                    ? "Loading…"
                    : "Load older replies"}
                </button>
              ) : null}
              {!events.length ? (
                <p className="text-sm text-muted-foreground">
                  No messages available for this task.
                </p>
              ) : null}
              <div aria-hidden="true" className="h-px" ref={readEndRef} />
            </article>
          ) : null}
        </div>
      </div>
      {task && read.data ? (
        <>
          {!validRecipient ? (
            <p className="luca-measure py-2 text-sm" role="alert">
              This recipient is not part of this conversation. Open it again
              from the agent’s inbox.
            </p>
          ) : null}
          {!validReplyTarget ? (
            <p className="luca-measure py-2 text-xs" role="alert">
              The message you’re replying to isn’t in the loaded history. Load
              older replies or cancel the reply.
            </p>
          ) : null}
          <CorrespondenceComposer
            {...{
              partial,
              needsContinuation,
              mayCompose,
              nameOf,
              recipient,
              composeMode,
              replyEventId,
              sendError,
              stopError,
              sending,
              stopping,
              capabilities,
              task,
              subject,
              state,
              exchangeState,
              continuationRequested,
              setComposeMode,
              setReplyEventId,
              setSendError,
              setRecipient,
              setContinuationRequested,
              stopSelectedExchange,
            }}
            embedded={conversational}
            cancelReply={cancelReply}
          >
            {validRecipient &&
            draftKey &&
            (mayCompose || conversational) &&
            draftStoreScope === workspace ? (
              <MessageComposer
                fixedAudiencePubkeys={[recipient]}
                channelId={task.record.conversationId}
                channelName={subject}
                containerClassName="px-0"
                disabled={sending || stopping || !mayCompose}
                draftKey={draftKey}
                isSending={sending}
                key={draftKey}
                onPrepareSendChannel={async () => task.record.conversationId}
                onSend={send}
                placeholder={`${composeMode === "new-message" ? "Message" : needsContinuation ? "Continue with" : "Reply to"} ${nameOf(recipient)}…`}
                profiles={profiles}
              />
            ) : null}
          </CorrespondenceComposer>
        </>
      ) : null}
    </section>
  );
}
