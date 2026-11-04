import type {
  AgentInboxPage,
  AgentInboxScope,
  AgentInboxTask,
  AgentInboxTaskRead,
  AgentInboxReadPosition,
} from "@/shared/api/agentInbox";
import type { RelayEvent } from "@/shared/api/types";
import { truncatePubkey } from "@/shared/lib/pubkey";

/** New hosts preserve logical focus while exposing the current attempt record. */
export function inboxLogicalTaskId(task: AgentInboxTask): string {
  return task.logicalTaskId ?? task.record.exchangeId;
}

/** Loaded references for this pair only, retaining the newest canonical head. */
export function correspondenceTasks(
  pages: readonly AgentInboxPage[],
  correspondenceId: string,
  ownerPubkey: string,
  focusedRead?: AgentInboxTaskRead,
): AgentInboxTask[] {
  const unique = new Map<string, AgentInboxTask>();
  const communityId =
    focusedRead?.scope.communityId ?? pages[0]?.scope.communityId;
  for (const page of pages) {
    if (
      page.scope.ownerPubkey !== ownerPubkey ||
      page.scope.communityId !== communityId
    )
      continue;
    for (const task of page.tasks) {
      if (
        task.correspondenceId !== correspondenceId ||
        task.record.owner !== ownerPubkey
      )
        continue;
      const id = inboxLogicalTaskId(task);
      const previous = unique.get(id);
      if (!previous || previous.recordUpdatedAt < task.recordUpdatedAt)
        unique.set(id, task);
    }
  }
  const focused = focusedRead?.task;
  if (
    focusedRead &&
    focused &&
    focusedRead.scope.ownerPubkey === ownerPubkey &&
    focused.record.owner === ownerPubkey &&
    focused.correspondenceId === correspondenceId
  ) {
    const id = focusedRead.logicalTaskId ?? inboxLogicalTaskId(focused);
    const previous = unique.get(id);
    if (!previous || previous.recordUpdatedAt < focused.recordUpdatedAt)
      unique.set(id, focused);
  }
  return [...unique.values()];
}

/** Resolve pair filters from the exact native read, never an owner-wide scan. */
export function correspondencePairFilter(
  read: AgentInboxTaskRead | undefined,
  correspondenceId: string,
  ownerPubkey: string,
  fallback: readonly string[] = [],
): { residentPubkey: string; correspondentPubkey: string } | null {
  if (
    read &&
    (read.scope.ownerPubkey !== ownerPubkey ||
      read.task.record.owner !== ownerPubkey ||
      read.task.correspondenceId !== correspondenceId)
  )
    return null;
  const members = [
    ...new Set(
      (read?.task.record.members ?? fallback).map((key) => key.toLowerCase()),
    ),
  ].sort();
  return members.length === 2
    ? { residentPubkey: members[0], correspondentPubkey: members[1] }
    : null;
}

/** A read cannot substitute a different task, pair, owner or scope. */
export function validateCorrespondenceRead(
  read: AgentInboxTaskRead,
  correspondenceId: string,
  taskId: string,
  ownerPubkey: string,
  scope?: AgentInboxScope,
): AgentInboxTaskRead {
  if (
    read.scope.ownerPubkey !== ownerPubkey ||
    read.task.record.owner !== ownerPubkey ||
    read.task.correspondenceId !== correspondenceId ||
    ((read.logicalTaskId ?? inboxLogicalTaskId(read.task)) !== taskId &&
      !read.attemptIds?.includes(taskId)) ||
    (read.logicalTaskId &&
      read.task.logicalTaskId &&
      read.logicalTaskId !== read.task.logicalTaskId) ||
    (read.currentAttemptId &&
      read.currentAttemptId !== read.task.record.exchangeId) ||
    (scope && read.scope.communityId !== scope.communityId)
  ) {
    throw new Error("This task no longer belongs to this inbox.");
  }
  return read;
}

/** Distinct tasks, recipients, owners and communities never share a draft. */
export function correspondenceDraftKey(
  scope: AgentInboxScope,
  correspondenceId: string,
  taskId: string,
  recipient: string,
): string {
  return `agent-inbox:${JSON.stringify([scope.communityId, scope.ownerPubkey, correspondenceId, taskId, recipient])}`;
}

/** Canonical event IDs deduplicate repeated root/turns across reply pages. */
export function mergeCorrespondenceReads(
  pages: readonly AgentInboxTaskRead[],
): AgentInboxTaskRead | undefined {
  const first = pages[0];
  if (!first) return undefined;
  const events = new Map(first.events.map((event) => [event.id, event]));
  for (const page of pages.slice(1)) {
    validateCorrespondenceRead(
      page,
      first.task.correspondenceId ?? "",
      first.logicalTaskId ?? inboxLogicalTaskId(first.task),
      first.scope.ownerPubkey,
      first.scope,
    );
    for (const event of page.events) events.set(event.id, event);
  }
  return {
    ...first,
    events: [...events.values()].sort(
      (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
    ),
    partial: pages.some((page) => page.partial),
    nextOwnerReplyCursor: pages[pages.length - 1].nextOwnerReplyCursor,
  };
}

/** Only loaded canonical messages after an initialized owner marker count. */
export function taskUnreadCount(
  events: readonly RelayEvent[],
  ownerPubkey: string,
  position: AgentInboxReadPosition | undefined,
): number | null {
  if (!position) return null;
  const unique = new Set<string>();
  for (const event of events) {
    if (event.pubkey === ownerPubkey) continue;
    if (
      event.created_at > position.createdAt ||
      (event.created_at === position.createdAt && event.id > position.eventId)
    )
      unique.add(event.id);
  }
  return unique.size;
}

/** Registry names lead; fingerprints appear only for genuinely identical names. */
export function correspondenceTitle(
  members: readonly string[],
  nameOf: (pubkey: string) => string,
): string {
  if (members.length !== 2) return "Agent correspondence";
  const names = members.map(nameOf);
  return names[0] === names[1]
    ? members
        .map((key, index) => `${names[index]} (${truncatePubkey(key)})`)
        .join(" & ")
    : names.join(" & ");
}
