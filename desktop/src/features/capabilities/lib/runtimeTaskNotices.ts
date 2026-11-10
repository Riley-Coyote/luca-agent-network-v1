import type { RuntimeTaskProjection } from "@/shared/api/tauriRuntimeTasks";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { runtimeTaskNativeHandoff } from "./runtimeTaskPresentation";

/** Presentation acknowledgements only. Never changes task or permission state. */
export type TaskNoticeMemory = {
  since: number;
  dismissed: Record<string, string>;
};

export const TASK_NOTICE_KEY = "polyphonic.runtime-task-notices.v2";

export function taskNoticeScope(owner: string, community: string): string {
  return JSON.stringify([owner, community]);
}

/** Only failures and blocked result returns interrupt the conversation. */
export function taskNeedsAttention(task: RuntimeTaskProjection): boolean {
  if (task.state === "failed" || task.state === "interrupted") return true;
  return (
    !runtimeTaskNativeHandoff(task) &&
    task.state === "succeeded" &&
    (task.deliveryState === "retryable" ||
      task.deliveryState === "blocked" ||
      task.deliveryState === "rejected")
  );
}

/** Heartbeats/refreshes do not turn an acknowledged problem into a new one. */
export function taskNoticeRevision(task: RuntimeTaskProjection): string {
  // Do not copy diagnostic text, paths or task prompts into browser storage.
  return bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify([task.state, task.error, task.deliveryState ?? null]),
      ),
    ),
  );
}

function taskKey(task: RuntimeTaskProjection): string {
  return JSON.stringify([task.conversationId, task.taskId]);
}

function acknowledgementKey(task: RuntimeTaskProjection): string {
  return JSON.stringify([
    task.conversationId,
    task.taskId,
    taskNoticeRevision(task),
  ]);
}

export function visibleTaskNotices(
  tasks: readonly RuntimeTaskProjection[],
  memory: TaskNoticeMemory,
): RuntimeTaskProjection[] {
  return tasks.filter((task) => {
    const acknowledged = memory.dismissed[taskKey(task)];
    return (
      taskNeedsAttention(task) &&
      Date.parse(task.updatedAt) >= memory.since &&
      acknowledged !== "*" &&
      acknowledged !== taskNoticeRevision(task) &&
      memory.dismissed[acknowledgementKey(task)] !== "1"
    );
  });
}

export function dismissTaskNotices(
  memory: TaskNoticeMemory,
  tasks: readonly RuntimeTaskProjection[],
): TaskNoticeMemory {
  const dismissed = { ...memory.dismissed };
  for (const task of tasks) dismissed[acknowledgementKey(task)] = "1";
  return {
    since: memory.since,
    dismissed,
  };
}

export function readTaskNoticeMemory(
  storage: Pick<Storage, "getItem"> & Partial<Pick<Storage, "key" | "length">>,
  scope: string,
  now: number,
): TaskNoticeMemory {
  try {
    const value = JSON.parse(
      storage.getItem(`${TASK_NOTICE_KEY}:${scope}`) ?? "null",
    );
    if (value && Number.isFinite(value.since) && value.since >= 0) {
      const entries = Object.entries(value.dismissed ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      );
      const memory = {
        since: value.since,
        dismissed: Object.fromEntries(entries),
      };
      // Each acknowledgement also has its own append-only key. Two windows
      // dismissing different issues cannot overwrite one another's decisions.
      const prefix = `${TASK_NOTICE_KEY}:${scope}:dismissed:`;
      for (let index = 0; index < (storage.length ?? 0); index++) {
        const key = storage.key?.(index);
        if (key?.startsWith(prefix) && storage.getItem(key) === "1")
          memory.dismissed[key.slice(prefix.length)] = "1";
      }
      return memory;
    }
  } catch {
    // Unavailable/corrupt storage must not grant or mutate anything.
  }
  // Upgrade boundary: old terminal receipts remain in Activity, not a queue
  // of notifications replayed over the composer. Every later issue is eligible,
  // including issues received while this conversation/window was closed.
  return { since: now, dismissed: {} };
}

export function writeTaskNoticeMemory(
  storage: Pick<Storage, "getItem" | "setItem">,
  scope: string,
  memory: TaskNoticeMemory,
) {
  const key = `${TASK_NOTICE_KEY}:${scope}`;
  storage.setItem(key, JSON.stringify(memory));
  for (const [acknowledgement, value] of Object.entries(memory.dismissed)) {
    const itemKey = `${key}:dismissed:${acknowledgement}`;
    if (value === "1" && storage.getItem(itemKey) !== "1")
      storage.setItem(itemKey, "1");
  }
}

/** A short operation label, never the raw task prompt or test instructions. */
export function taskNoticeTitle(task: RuntimeTaskProjection): string {
  const provider = task.runtimeFamily === "codex" ? "Codex" : "Claude Code";
  if (runtimeTaskNativeHandoff(task)) return `Check delivery in ${provider}`;
  if (task.state === "succeeded") return `Return the ${provider} result`;
  if (task.state === "interrupted") return `${provider} task interrupted`;
  return `${provider} task needs attention`;
}
