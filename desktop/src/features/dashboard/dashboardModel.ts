import type { RuntimeTaskProjection } from "@/shared/api/tauriRuntimeTasks";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Opaque origin marker: never put a relay URL or its credentials in a handoff URL. */
export function dashboardScopeRef(scope: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(scope)));
}

export function dashboardContextForScope<T extends { origin?: string }>(
  context: T | null | undefined,
  origin: string,
): T | null {
  return context?.origin === origin ? context : null;
}

export type DashboardTab = "overview" | "work" | "usage";
export const HARNESS_NAMES = {
  claude_code: "Claude Code",
  codex: "Codex",
} as const;
export function dashboardTaskActive(
  task: Pick<RuntimeTaskProjection, "state">,
) {
  return ["queued", "active", "stopping"].includes(task.state);
}
/** Failed attempts stay visible until a later, explicitly requested retry replaces them. */
export function dashboardTasksNeedingReview(
  tasks: readonly RuntimeTaskProjection[],
) {
  const retried = new Set(
    tasks.flatMap((task) => (task.retryOfTaskId ? [task.retryOfTaskId] : [])),
  );
  return tasks.filter(
    (task) =>
      !retried.has(task.taskId) &&
      (task.state === "failed" ||
        task.state === "interrupted" ||
        ["blocked", "rejected", "retryable"].includes(
          task.deliveryState ?? "",
        )),
  );
}
/** External delivery is not completion. Only a native success receipt says Done. */
export function dashboardTaskWord(task: Pick<RuntimeTaskProjection, "state">) {
  return (
    {
      queued: "Queued",
      active: "Working",
      stopping: "Stopping",
      awaiting_native: "Sent to native app",
      succeeded: "Done",
      stopped: "Stopped",
      failed: "Failed",
      interrupted: "Interrupted",
    } as const
  )[task.state];
}
export function dashboardTaskTime(at: string, now = Date.now()) {
  const elapsed = now - Date.parse(at);
  if (!Number.isFinite(elapsed)) return "Time unavailable";
  const minutes = Math.max(0, Math.floor(elapsed / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
export function dashboardSummary(
  tasks: readonly RuntimeTaskProjection[],
  needs: number,
) {
  const active = tasks.filter(dashboardTaskActive);
  const review = dashboardTasksNeedingReview(tasks).length;
  return needs
    ? `${needs === 1 ? "One thing needs" : `${needs} things need`} you.`
    : review
      ? `${review === 1 ? "One task needs" : `${review} tasks need`} a look.`
      : active.length
        ? "Your work is moving."
        : tasks.some((task) => task.state === "awaiting_native")
          ? "Waiting on your tools."
          : tasks.length
            ? "You’re caught up."
            : "Start with Luca.";
}
/** Summaries are a bounded reference, not an instruction or a read grant. */
export function dashboardContextText(context: {
  title: string;
  runtimeFamily: "claude_code" | "codex";
  taskId?: string;
  sessionId?: string;
}) {
  return `Selected work (reference only):\n${JSON.stringify({ title: context.title.slice(0, 240), harness: HARNESS_NAMES[context.runtimeFamily], ...(context.taskId ? { taskId: context.taskId.slice(0, 128) } : {}), ...(context.sessionId ? { sessionId: context.sessionId.slice(0, 128) } : {}) })}`;
}
