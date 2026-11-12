import type {
  SideConversation,
  TaskSide,
} from "@/features/exchange/sideConversations";
import {
  namesAsList,
  sideLiveWord,
} from "@/features/exchange/sideConversations";
import { runtimeRailFamilyFromRuntimeId } from "@/features/runtime-sessions/runtimeRailPreferences";
import { normalizePubkey } from "@/shared/lib/pubkey";

import type { RailSideRow } from "./railHomes";
import type { AgentInboxPage } from "@/shared/api/agentInbox";
import type { RuntimeTaskProjection } from "@/shared/api/tauriRuntimeTasks";
import { runtimeTaskNativeHandoff } from "@/features/capabilities/lib/runtimeTaskPresentation";

/** Presentation only: a saved result is not delivered until acknowledged. */
export function runtimeTaskRailVisible(
  task: RuntimeTaskProjection,
  currentIssue: boolean,
): boolean {
  if (task.state === "failed" || task.state === "interrupted")
    return currentIssue;
  if (["queued", "active", "stopping"].includes(task.state)) return true;
  if (runtimeTaskNativeHandoff(task)) return false;
  if (task.state !== "succeeded") return false;
  if (["published", "cancelled"].includes(task.deliveryState ?? ""))
    return false;
  if (["retryable", "blocked", "rejected"].includes(task.deliveryState ?? ""))
    return currentIssue;
  // Legacy success without delivery evidence stays reachable, not "delivered".
  return true;
}

/** Filter the rail, never the source history. Protected identities stay put. */
export function activeRuntimeRailRows(
  rows: readonly RailSideRow[],
  tasks: ReadonlyMap<string, RuntimeTaskProjection>,
  currentIssueIds: ReadonlySet<string>,
  protectedRowIds: ReadonlySet<string>,
): RailSideRow[] {
  const visible: RailSideRow[] = [];
  for (const row of rows) {
    const taskId = row.runtimeTaskId ?? row.id.slice("task:".length);
    const task = tasks.get(taskId);
    if (!task) {
      if (protectedRowIds.has(row.id)) visible.push(row);
      continue;
    }
    if (
      !runtimeTaskRailVisible(
        task,
        currentIssueIds.size > 0 && currentIssueIds.has(taskId),
      ) &&
      (protectedRowIds.size === 0 || !protectedRowIds.has(row.id))
    )
      continue;
    // Pending delivery/issues must not disappear behind the latest-three fold.
    // This is reachability, not a claim that the provider is still working.
    visible.push(row.live ? row : { ...row, live: true });
  }
  return visible;
}

/** IDs supplied by the authorized native inbox query for this exact scope. */
export type RailCorrespondenceScope = {
  communityId: string;
  ownerPubkey: string;
  correspondenceIds: ReadonlyMap<string, string>;
  /** Exact task references authorized by loaded native pages, including groups. */
  authorizedTaskIds?: ReadonlySet<string>;
};

export type RailInboxSnapshot = {
  epoch: string;
  pages: readonly AgentInboxPage[];
};

/** Keep trusted rows through a refresh, never through scope changes or errors. */
export function resolveRailInboxSnapshot(
  previous: RailInboxSnapshot | null,
  incoming: readonly AgentInboxPage[] | undefined,
  epoch: string,
  refreshing: boolean,
  failed: boolean,
): RailInboxSnapshot | null {
  if (failed) return null;
  if (incoming?.[0]) return { epoch, pages: incoming };
  return refreshing && previous?.epoch === epoch ? previous : null;
}

/**
 * The work in the Chats rail (BETA14_RELEASE.md WP-34, Decided 3): what is
 * handed to an agent or an app hangs on the thread under whoever does it.
 * Luca, a project and a room are one ongoing chat each and nest nothing, so
 * the side conversations that sat under Luca (WP-14) move: an exchange under
 * each agent it asks, a runtime task under the app that runs it. Pure, so it
 * is unit-tested under node.
 */

/** A side conversation as a rail row: its id, when it moved, its word. */
function rowOf(item: SideConversation, label: string): RailSideRow {
  return {
    at: item.at,
    shownAt:
      item.kind === "exchange" && item.atFrom === "deadline"
        ? null
        : item.at > 0
          ? item.at
          : null,
    conversationId: item.conversationId,
    id: `${item.kind}:${item.id}`,
    label,
    live: item.live,
    messageId: item.kind === "exchange" ? item.rootEventId : null,
    word: sideLiveWord(item),
  };
}

/**
 * Each resident's authorized pair correspondence, reciprocal and grouped by
 * native identity. Legacy exchanges without an inbox mapping stay inspectable
 * individually. Group exchanges retain their whole audience, never pair splits.
 */
export function agentWorkRows(
  items: readonly SideConversation[],
  agentKeys: ReadonlySet<string> | null,
  nameOf: (pubkey: string) => string,
  _roomOf: (conversationId: string) => string,
  scope?: RailCorrespondenceScope,
): Map<string, RailSideRow[]> {
  const byAgent = new Map<string, RailSideRow[]>();
  for (const item of items) {
    if (item.kind !== "exchange") continue;
    if (scope?.authorizedTaskIds && !scope.authorizedTaskIds.has(item.id))
      continue;
    const members = [...new Set(item.members.map(normalizePubkey))].sort();
    const isPair =
      members.length === 2 && members.includes(normalizePubkey(item.openedBy));
    if (
      scope &&
      normalizePubkey(item.ownerPubkey) !== normalizePubkey(scope.ownerPubkey)
    )
      continue;
    const correspondenceId =
      isPair && scope?.communityId
        ? scope.correspondenceIds.get(item.id)
        : undefined;
    for (const key of members) {
      if (agentKeys && !agentKeys.has(key)) continue;
      const others = members.filter((member) => member !== key);
      const who = namesAsList(others.map(nameOf));
      const label = isPair ? `With ${who}` : `Group with ${who}`;
      const rows = byAgent.get(key) ?? [];
      const row = rowOf(item, label);
      row.residentPubkeys = members;
      row.taskIds = [item.id];
      row.sourceReferences = [
        {
          taskId: item.id,
          conversationId: item.conversationId,
          rootEventId: item.rootEventId,
        },
      ];
      if (correspondenceId) {
        row.correspondenceId = correspondenceId;
        row.id = `correspondence:${correspondenceId}`;
        const existing = rows.find((candidate) => candidate.id === row.id);
        if (existing) {
          if (!existing.taskIds?.includes(item.id)) {
            existing.taskIds?.push(item.id);
            existing.sourceReferences?.push(...row.sourceReferences);
          }
          // Deadlines are not activity. Keep a known activity reference even
          // when a newly loaded zero-turn task has a later expiry date.
          if (
            row.shownAt != null &&
            (existing.shownAt == null || row.shownAt > existing.shownAt)
          ) {
            existing.at = row.at;
            existing.shownAt = row.shownAt;
            existing.conversationId = row.conversationId;
            existing.messageId = row.messageId;
            // The main view opens the most recently active history, not the
            // first task encountered while pages were being merged.
            existing.taskIds = [
              item.id,
              ...(existing.taskIds ?? []).filter((id) => id !== item.id),
            ];
          }
          existing.live ||= row.live;
          if (
            row.word === "talking" ||
            (existing.word !== "talking" && row.word)
          )
            existing.word = row.word;
          continue;
        }
        row.at = row.shownAt ?? 0;
      }
      rows.push(row);
      byAgent.set(key, rows);
    }
  }
  for (const rows of byAgent.values())
    rows.sort((a, b) => a.id.localeCompare(b.id));
  return byAgent;
}

/** The app a task runs in, as the rail's families name them. */
export function taskFamily(task: Pick<TaskSide, "runtimeFamily">) {
  return runtimeRailFamilyFromRuntimeId(task.runtimeFamily);
}

/**
 * Each app's tasks, by its rail family ("claude", "codex"): every runtime
 * task it runs, for anyone, live and finished, newest first. The row is the
 * task's own summary: under the app's row the app goes without saying.
 */
export function appTaskRows(
  items: readonly SideConversation[],
): Map<string, RailSideRow[]> {
  const byApp = new Map<string, RailSideRow[]>();
  for (const item of items) {
    if (item.kind !== "task") continue;
    const family = taskFamily(item);
    if (!family) continue;
    const row = rowOf(item, item.summary);
    row.runtimeTaskId = item.id;
    const rows = byApp.get(family);
    if (rows) rows.push(row);
    else byApp.set(family, [row]);
  }
  return byApp;
}
