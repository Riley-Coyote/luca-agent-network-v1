import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as React from "react";
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
  taskUnreadCount,
} from "@/features/exchange/correspondenceView";
import {
  exchangeStatusLabel,
  exchangeTaskSubject,
} from "@/features/exchange/sideConversations";
import { parseImetaTags } from "@/features/messages/lib/parseImeta";
import { initDraftStore } from "@/features/messages/lib/useDrafts";
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

export type CorrespondenceWindowProps = {
  correspondenceId: string;
  initialTaskId?: string | null;
  residentPubkeys?: readonly string[];
  onTitleChange?: (title: string) => void;
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
  residentPubkeys,
  onTitleChange,
}: CorrespondenceWindowProps) {
  const queryClient = useQueryClient();
  const identity = useIdentityQuery().data;
  const { activeCommunity, reinitKey } = useCommunities();
  const managed = useManagedAgentsQuery().data;
  const relay = useRelayAgentsQuery().data;
  const ownerPubkey = identity?.pubkey ? normalizePubkey(identity.pubkey) : "";
  const workspace = `${activeCommunity?.id ?? ""}:${reinitKey}:${ownerPubkey}`;
  const queryPrefix = [
    "agent-inbox-window",
    workspace,
    correspondenceId,
  ] as const;
  const [selectedTaskId, setSelectedTaskId] = React.useState(initialTaskId);
  const [recipient, setRecipient] = React.useState("");
  const [composeMode, setComposeMode] = React.useState<"reply" | "new-message">(
    "reply",
  );
  const [continuationRequested, setContinuationRequested] =
    React.useState(false);
  const [replyEventId, setReplyEventId] = React.useState<string | undefined>();
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
    setRecipient("");
    setComposeMode("reply");
    setContinuationRequested(false);
    setReplyEventId(undefined);
    setSendError(null);
    setStopError(null);
  }, [correspondenceId, initialTaskId, workspace]);
  React.useEffect(() => {
    if (!isTauri()) return;
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
  }, []);
  React.useEffect(() => {
    if (!isTauri()) return;
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
  }, [correspondenceId, queryClient, workspace]);

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
    enabled: Boolean(ownerPubkey && selectedTaskId),
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
    enabled: Boolean(attemptId),
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
    enabled: Boolean(ownerPubkey && pairFilter),
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
  const readPosition = useQuery({
    queryKey: [
      "agent-inbox-read-position",
      workspace,
      correspondenceId,
      taskId,
    ],
    queryFn: () => getAgentInboxReadPositions(taskId ? [taskId] : []),
    enabled: Boolean(taskId),
    retry: false,
  });
  const participantKeys = [
    ...new Set([
      ...(task?.record.members ?? tasks[0]?.record.members ?? pair),
      ...(read.data?.events.map((event) => event.pubkey) ?? []),
    ]),
  ];
  const profiles = useUsersBatchQuery(participantKeys, {
    enabled: participantKeys.length > 0,
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
  const unreadCount = taskId
    ? taskUnreadCount(events, ownerPubkey, readPosition.data?.[taskId])
    : null;
  React.useEffect(() => {
    const end = readEndRef.current;
    const root = scrollRef.current;
    if (!end || !root || !taskId || !latestReadEventId) return;
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
  }, [latestReadEventId, taskId, workspace, correspondenceId, queryClient]);
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
  const mayCompose =
    composeMode === "new-message"
      ? capabilities?.newMessage === true
      : needsContinuation
        ? capabilities?.continuation === true && continuationRequested
        : capabilities?.reply !== false;
  const validRecipient = task?.record.members.includes(recipient) ?? false;
  const draftKey =
    taskId && read.data
      ? correspondenceDraftKey(
          read.data.scope,
          correspondenceId,
          composeMode === "new-message" ? `new-topic:${taskId}` : taskId,
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
    >
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
            aria-label="Tasks"
            className="mb-4 flex max-h-40 flex-col gap-1 overflow-y-auto overscroll-contain"
          >
            {tasks.map((item) => (
              <button
                aria-current={
                  selectedTaskId === inboxLogicalTaskId(item)
                    ? "true"
                    : undefined
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
                    : `Conversation with ${nameOf(item.record.members.find((key) => key !== item.record.openedBy) ?? item.record.openedBy)}`}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {exchangeStatusLabel(taskState(item))} ·{" "}
                  {new Date(item.recordUpdatedAt * 1000).toLocaleDateString()}
                  {inboxLogicalTaskId(item) === taskId && unreadCount
                    ? ` · ${unreadCount} unread in loaded history`
                    : ""}
                </span>
              </button>
            ))}
          </nav>
          {pages.hasNextPage ? (
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
          {read.isFetching && selectedTaskId ? (
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
                {events.map((event) => (
                  <div className="flex gap-2" key={event.id}>
                    <ExchangeIdentityMark
                      name={nameOf(event.pubkey)}
                      pubkey={event.pubkey}
                      avatarUrl={profiles?.[event.pubkey]?.avatarUrl}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="mb-1 text-xs font-medium">
                        {nameOf(event.pubkey)}
                      </p>
                      <Markdown
                        className="conversation-prose type-body max-w-full text-foreground"
                        content={event.content}
                        imetaByUrl={parseImetaTags(event.tags)}
                      />
                      {task.record.members.includes(event.pubkey) ? (
                        <button
                          className="mt-1 text-xs text-primary hover:underline"
                          onClick={() => {
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
        <footer className="shrink-0 pb-3 pt-2">
          <div className="luca-measure grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
            <div className="col-start-2 row-start-1 mb-2 text-xs">
              {composeMode === "new-message" ? (
                <button
                  className="text-primary hover:underline"
                  disabled={sending}
                  onClick={() => {
                    setComposeMode("reply");
                    setReplyEventId(undefined);
                    setSendError(null);
                  }}
                  type="button"
                >
                  Back to task
                </button>
              ) : (
                <button
                  className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                  disabled={sending || capabilities?.newMessage !== true}
                  onClick={() => {
                    setComposeMode("new-message");
                    setContinuationRequested(false);
                    setReplyEventId(undefined);
                    setSendError(null);
                  }}
                  title={
                    capabilities?.newMessage
                      ? undefined
                      : "New topics are not available from this host yet."
                  }
                  type="button"
                >
                  New message
                </button>
              )}
            </div>
            <label className="col-start-1 row-start-1 mb-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              {composeMode === "new-message" ? "Message to" : "Reply to"}
              <select
                aria-label="Reply recipient"
                className="min-w-0 rounded-md bg-plate px-2 py-1 text-sm text-foreground"
                onChange={(event) => {
                  setRecipient(event.target.value);
                  setReplyEventId(undefined);
                }}
                value={recipient}
              >
                <option value="">Choose an agent</option>
                {task.record.members.map((key) => (
                  <option key={key} value={key}>
                    {nameOf(key)}
                  </option>
                ))}
              </select>
            </label>
            <p className="col-start-1 row-start-2 mb-2 min-w-0 truncate text-xs text-muted-foreground">
              {composeMode === "new-message"
                ? `Source: ${subject}`
                : `${subject} · ${exchangeStatusLabel(state)}`}
            </p>
            {composeMode === "reply" &&
            exchangeState.data &&
            ["open", "paused"].includes(exchangeState.data.phase) ? (
              <button
                className="col-start-2 row-start-2 mb-2 text-xs text-destructive hover:underline disabled:opacity-50"
                disabled={stopping || sending}
                onClick={() => void stopSelectedExchange()}
                type="button"
              >
                {stopping ? "Stopping exchange…" : "Stop exchange"}
              </button>
            ) : null}
            {stopError ? (
              <p
                className="col-span-2 mb-2 text-xs text-destructive"
                role="alert"
              >
                {stopError}
              </p>
            ) : null}
            {composeMode === "reply" &&
            needsContinuation &&
            capabilities?.continuation ? (
              <label className="col-span-2 mb-2 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={continuationRequested}
                  onChange={(event) =>
                    setContinuationRequested(event.target.checked)
                  }
                  disabled={sending}
                />
                Continue this task with a new bounded attempt
              </label>
            ) : composeMode === "reply" && needsContinuation ? (
              <p className="col-span-2 mb-2 text-xs text-muted-foreground">
                This task is {state}. Continuing it is not available here yet.
              </p>
            ) : null}
            {sendError ? (
              <p
                className="col-span-2 mb-2 text-xs text-destructive"
                role="alert"
              >
                {sendError} Your draft is kept. Sending it again uses the same
                request identity.
              </p>
            ) : null}
          </div>
          {validRecipient &&
          draftKey &&
          mayCompose &&
          draftStoreScope === workspace ? (
            <MessageComposer
              fixedAudiencePubkeys={[recipient]}
              channelId={task.record.conversationId}
              channelName={subject}
              containerClassName="px-0"
              disabled={sending || stopping}
              draftKey={draftKey}
              isSending={sending}
              key={draftKey}
              onPrepareSendChannel={async () => task.record.conversationId}
              onSend={send}
              placeholder={`${composeMode === "new-message" ? "Message" : needsContinuation ? "Continue with" : "Reply to"} ${nameOf(recipient)}`}
              profiles={profiles}
            />
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
