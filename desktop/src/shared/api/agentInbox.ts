import { normalizeExchangeRecord } from "@/shared/api/exchanges";
import { invokeTauri } from "@/shared/api/tauri";
import type {
  ExchangeRecord,
  RelayEvent,
  SendChannelMessageResult,
} from "@/shared/api/types";

export type AgentInboxScope = { communityId: string; ownerPubkey: string };
export type AgentInboxCursor = {
  scope: AgentInboxScope;
  until: number;
  beforeId: string;
};
export type AgentInboxQuery = {
  residentPubkey?: string;
  correspondentPubkey?: string;
  exchangeId?: string;
  cursor?: AgentInboxCursor;
  limit?: number;
};
export type AgentInboxTask = {
  subject?: string | null;
  logicalTaskId?: string;
  correspondenceId: string | null;
  record: ExchangeRecord;
  recordEventId: string;
  recordUpdatedAt: number;
  outcome: string;
};
type RawTask = Omit<AgentInboxTask, "record"> & {
  record: Parameters<typeof normalizeExchangeRecord>[0];
};
export type AgentInboxPage = {
  scope: AgentInboxScope;
  tasks: AgentInboxTask[];
  nextCursor: AgentInboxCursor | null;
  historySource: string;
  partial: boolean;
};
export type AgentInboxTaskRead = {
  /** Host-verified continuation lineage, not caller-selected aliases. */
  attemptIds?: string[];
  logicalTaskId?: string;
  currentAttemptId?: string;
  logicalRootEventId?: string;
  scope: AgentInboxScope;
  task: AgentInboxTask;
  events: RelayEvent[];
  historySource: string;
  partial: boolean;
  rootAvailable?: boolean;
  nextOwnerReplyCursor?: AgentInboxCursor | null;
  /** Host-advertised implemented write paths; never probed by attempting a send. */
  writeCapabilities?: {
    reply: boolean;
    continuation: boolean;
    newMessage: boolean;
  };
};

function normalizeTask(raw: RawTask): AgentInboxTask {
  const record = normalizeExchangeRecord(raw.record);
  if (!record) throw new Error("Inbox returned an invalid task record.");
  return { ...raw, record };
}

/** Passive, authorized and paginated task references, never a dispatch. */
export async function queryAgentInbox(
  query: AgentInboxQuery = {},
): Promise<AgentInboxPage> {
  const page = await invokeTauri<
    Omit<AgentInboxPage, "tasks"> & { tasks: RawTask[] }
  >("query_agent_inbox", { query });
  return { ...page, tasks: page.tasks.map(normalizeTask) };
}

/** Read the original signed events for exactly one authorized task. */
export async function readAgentInboxTask(
  exchangeId: string,
  cursor?: AgentInboxCursor,
): Promise<AgentInboxTaskRead> {
  const read = await invokeTauri<
    Omit<AgentInboxTaskRead, "task"> & { task: RawTask }
  >("read_agent_inbox_task", { exchangeId, cursor });
  return { ...read, task: normalizeTask(read.task) };
}

export type AgentInboxReplyInput = {
  exchangeId: string;
  replyEventId?: string;
  recipientPubkey: string;
  content: string;
  mediaTags?: string[][];
  idempotencyKey: string;
  continuationIntent: boolean;
};

export type AgentInboxMessageInput = {
  /** Explicit, authorized source context; this is not the new logical task. */
  sourceExchangeId: string;
  recipientPubkey: string;
  content: string;
  mediaTags?: string[][];
  idempotencyKey: string;
};
export type AgentInboxSendResult = SendChannelMessageResult & {
  taskId?: string;
  attemptId?: string;
  correspondenceId?: string;
};
type RawInboxSendResult = {
  event_id: string;
  parent_event_id: string | null;
  root_event_id: string | null;
  depth: number;
  created_at: number;
  task_id?: string;
  attempt_id?: string;
  correspondence_id?: string;
};
function normalizeInboxSendResult(
  response: RawInboxSendResult,
): AgentInboxSendResult {
  return {
    eventId: response.event_id,
    parentEventId: response.parent_event_id,
    rootEventId: response.root_event_id,
    depth: response.depth,
    createdAt: response.created_at,
    taskId: response.task_id,
    attemptId: response.attempt_id,
    correspondenceId: response.correspondence_id,
  };
}

/** An explicit owner-authored send; opening or reading never invokes this. */
export async function sendAgentInboxReply(
  input: AgentInboxReplyInput,
): Promise<AgentInboxSendResult> {
  return normalizeInboxSendResult(
    await invokeTauri<RawInboxSendResult>("send_agent_inbox_reply", { input }),
  );
}

/** Explicit new topic in a selected authorized pair/source; never a new room. */
export async function sendAgentInboxMessage(
  input: AgentInboxMessageInput,
): Promise<AgentInboxSendResult> {
  return normalizeInboxSendResult(
    await invokeTauri<RawInboxSendResult>("send_agent_inbox_message", {
      input,
    }),
  );
}

export type AgentInboxReadPosition = { createdAt: number; eventId: string };

/** Only task event markers; never marks the unrelated source chat as read. */
export function markAgentInboxTaskRead(
  exchangeId: string,
  eventId: string,
): Promise<AgentInboxReadPosition> {
  return invokeTauri("mark_agent_inbox_task_read", { exchangeId, eventId });
}

/** Missing positions are uninitialized, not proof of an unread history. */
export function getAgentInboxReadPositions(
  exchangeIds: string[],
): Promise<Record<string, AgentInboxReadPosition>> {
  return invokeTauri("get_agent_inbox_read_positions", { exchangeIds });
}
