import type { RuntimeTaskProjection } from "@/shared/api/tauriRuntimeTasks";

export type RuntimeTaskAction = "stop" | "retry" | "dismiss" | null;
export type RuntimeTaskTarget = "codex" | "claude_code";

export function runtimeTaskTargetForFamily(
  runtimeFamily: string | null | undefined,
): RuntimeTaskTarget | null {
  return runtimeFamily === "codex" || runtimeFamily === "claude_code"
    ? runtimeFamily
    : null;
}

export function verifiedRuntimeTaskTarget(
  residentRuntimeFamily: string | null | undefined,
  readyRuntimeFamilies: readonly string[],
): RuntimeTaskTarget | null {
  const target = runtimeTaskTargetForFamily(residentRuntimeFamily);
  return target && readyRuntimeFamilies.includes(target) ? target : null;
}

export function runtimeTaskAction(
  task: Pick<RuntimeTaskProjection, "state" | "canRetry">,
): RuntimeTaskAction {
  if (task.state === "queued" || task.state === "active") return "stop";
  if (task.state === "failed" && task.canRetry) return "retry";
  if (
    (task.state === "failed" && !task.canRetry) ||
    task.state === "interrupted"
  ) {
    return "dismiss";
  }
  return null;
}

export function runtimeTaskVisible(
  task: Pick<RuntimeTaskProjection, "taskId" | "state" | "completedAt">,
  dismissedTaskIds: ReadonlySet<string>,
  now: number,
): boolean {
  if (dismissedTaskIds.has(task.taskId) || task.state === "stopped") {
    return false;
  }
  if (task.state !== "succeeded") return true;
  const completedAt = task.completedAt
    ? Date.parse(task.completedAt)
    : Number.NaN;
  return Number.isFinite(completedAt) && now - completedAt < 4_000;
}
