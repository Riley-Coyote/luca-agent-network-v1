import type { RelayEvent } from "@/shared/api/types";

/** Explicit native-response fixtures; used only by the existing E2E mock bridge. */
export type AgentInboxFixture = {
  pages: Array<{
    scope: { communityId: string; ownerPubkey: string };
    tasks: unknown[];
    nextCursor: { beforeId: string } | null;
    [key: string]: unknown;
  }>;
  reads: Record<
    string,
    {
      scope: { communityId: string; ownerPubkey: string };
      task: unknown;
      events: RelayEvent[];
      [key: string]: unknown;
    }
  >;
  sendFailuresRemaining?: number;
  /** Mock-only acceptance uncertainty; never evidence of a native dispatch. */
  sendAcceptedFailuresRemaining?: number;
};

declare global {
  interface Window {
    __BUZZ_E2E_AGENT_INBOX__?: AgentInboxFixture;
  }
}

const sent = new Map<string, unknown>();
const reads = new Map<string, { createdAt: number; eventId: string }>();

/** The mock never dispatches: it returns deterministic canonical-shaped data. */
export function agentInboxFixtureCommand(
  command: string,
  payload: unknown,
): unknown {
  const fixture = window.__BUZZ_E2E_AGENT_INBOX__;
  if (!fixture) {
    if (command === "query_agent_inbox")
      throw new Error("Agent inbox fixture is not configured.");
    throw new Error("Inbox task is unavailable or unauthorized.");
  }
  const args = (payload ?? {}) as {
    query?: { cursor?: { beforeId: string } };
    exchangeId?: string;
    eventId?: string;
    exchangeIds?: string[];
    input?: {
      exchangeId: string;
      sourceExchangeId?: string;
      continuationIntent?: boolean;
      recipientPubkey: string;
      idempotencyKey: string;
      content: string;
      replyEventId?: string;
    };
  };
  if (command === "query_agent_inbox") {
    const cursor = args.query?.cursor;
    const index = cursor
      ? fixture.pages.findIndex(
          (page) => page.nextCursor?.beforeId === cursor.beforeId,
        ) + 1
      : 0;
    return (
      fixture.pages[index] ?? {
        ...fixture.pages[0],
        tasks: [],
        nextCursor: null,
      }
    );
  }
  if (command === "get_agent_inbox_read_positions")
    return Object.fromEntries(
      (args.exchangeIds ?? []).flatMap((id) =>
        reads.has(id) ? [[id, reads.get(id)]] : [],
      ),
    );
  const task =
    fixture.reads[
      args.exchangeId ??
        args.input?.exchangeId ??
        args.input?.sourceExchangeId ??
        ""
    ];
  if (!task) throw new Error("Inbox task is unavailable or unauthorized.");
  if (command === "read_agent_inbox_task") return task;
  if (command === "mark_agent_inbox_task_read") {
    const event = task.events.find((event) => event.id === args.eventId);
    if (!event) throw new Error("Read marker is not a task message.");
    const position = { createdAt: event.created_at, eventId: event.id };
    reads.set(args.exchangeId ?? "", position);
    return position;
  }
  if (
    (command === "send_agent_inbox_reply" ||
      command === "send_agent_inbox_message") &&
    args.input
  ) {
    const input = args.input;
    const previous = sent.get(input.idempotencyKey);
    if (previous) return previous;
    if (fixture.sendFailuresRemaining) {
      fixture.sendFailuresRemaining -= 1;
      throw new Error("Temporarily disconnected.");
    }
    const event = {
      id: crypto.randomUUID().replaceAll("-", "").padEnd(64, "0"),
      pubkey: task.scope.ownerPubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: 40002,
      tags: [["e", input.replyEventId ?? "", "", "reply"]],
      content: input.content,
      sig: "",
    };
    if (command !== "send_agent_inbox_message") task.events.push(event);
    const sourceTask = task.task as {
      logicalTaskId?: string;
      correspondenceId: string;
      record: { exchange_id: string; root_event_id: string; state: string };
      [key: string]: unknown;
    };
    const newTopic = command === "send_agent_inbox_message";
    const newAttempt = newTopic || input.continuationIntent === true;
    const logicalId = newTopic
      ? "fa".repeat(32)
      : (sourceTask.logicalTaskId ?? input.exchangeId);
    const attemptId = newAttempt
      ? (newTopic ? "fd" : "ef").repeat(32)
      : sourceTask.record.exchange_id;
    if (newAttempt) {
      const nextTask = {
        ...sourceTask,
        logicalTaskId: logicalId,
        record: {
          ...sourceTask.record,
          exchange_id: attemptId,
          root_event_id: newTopic ? event.id : sourceTask.record.root_event_id,
          state: "open",
        },
      };
      const nextRead = {
        ...task,
        task: nextTask,
        logicalTaskId: logicalId,
        currentAttemptId: attemptId,
        logicalRootEventId: newTopic
          ? event.id
          : (task.logicalRootEventId ?? sourceTask.record.root_event_id),
        events: newTopic ? [event] : task.events,
      };
      fixture.reads[logicalId] = nextRead;
      fixture.reads[attemptId] = nextRead;
      fixture.pages[0].tasks = [
        nextTask,
        ...fixture.pages[0].tasks.filter(
          (candidate) =>
            newTopic ||
            (candidate as { record: { exchange_id: string } }).record
              .exchange_id !== sourceTask.record.exchange_id,
        ),
      ];
    }
    const result = {
      event_id: event.id,
      parent_event_id: input.replyEventId ?? null,
      root_event_id: null,
      depth: 1,
      created_at: event.created_at,
      task_id: logicalId,
      attempt_id: attemptId,
      correspondence_id: sourceTask.correspondenceId,
    };
    sent.set(input.idempotencyKey, result);
    if (fixture.sendAcceptedFailuresRemaining) {
      fixture.sendAcceptedFailuresRemaining -= 1;
      throw new Error(
        "The reply was accepted, but wake confirmation is unavailable.",
      );
    }
    return result;
  }
  throw new Error(`Unsupported inbox fixture command: ${command}`);
}
