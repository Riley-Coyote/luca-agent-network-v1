import type {
  RuntimeTaskOperation,
  RuntimeTaskProjection,
} from "@/shared/api/tauriRuntimeTasks";

export type RuntimeTaskAction = "stop" | "retry" | "dismiss" | null;
export type RuntimeTaskTarget = "codex" | "claude_code";

export function isExistingRuntimeTask(
  operation: RuntimeTaskOperation | null | undefined,
): boolean {
  return operation === "continue_session" || operation === "send_message";
}

/** A native queue acknowledgement is not evidence that the work completed. */
export function runtimeTaskNativeHandoff(
  task: Pick<RuntimeTaskProjection, "state" | "controlOwner">,
): boolean {
  return task.controlOwner === "native_app" || task.state === "awaiting_native";
}

export function runtimeTaskReceiptLabel(
  task: Pick<RuntimeTaskProjection, "state" | "controlOwner" | "runtimeFamily">,
): string {
  const provider = task.runtimeFamily === "codex" ? "Codex" : "Claude Code";
  if (runtimeTaskNativeHandoff(task)) {
    if (task.state === "awaiting_native") {
      return `Queued in ${provider} — work is not complete`;
    }
    if (task.state === "failed" || task.state === "interrupted") {
      return `Delivery uncertain in ${provider}`;
    }
    return `Native handoff to ${provider} — check the session`;
  }
  return `${task.state === "succeeded" ? "Completed" : "Stopped"} with ${provider}`;
}

export function runtimeTaskDeliveryLabel(
  task: Pick<
    RuntimeTaskProjection,
    "state" | "controlOwner" | "operation" | "deliveryState"
  >,
): string | null {
  if (runtimeTaskNativeHandoff(task) || task.operation === "send_message")
    return null;
  switch (task.deliveryState) {
    case "awaiting_result":
      return "Waiting for the task result before preparing the resident summary.";
    case "pending_synthesis":
      return "Resident summary queued for this conversation.";
    case "synthesizing":
      return "Preparing the resident summary for this conversation.";
    case "prepared":
      return "Resident summary prepared; not yet submitted to this conversation.";
    case "submitted":
      return "Resident summary submitted; publication is not yet confirmed.";
    case "published":
      return "Resident summary published in this conversation.";
    case "retryable":
      return "Resident summary needs attention. Retrying the summary will not rerun the provider task.";
    case "rejected":
      return "Resident summary delivery was rejected.";
    case "cancelled":
      return "Resident summary delivery was cancelled.";
    case "blocked":
      return "Resident summary delivery is blocked. Check the initiating resident and conversation.";
    default:
      return null;
  }
}

/** Native delivery authority replaces the legacy owner-sent synthesis prompt. */
export function runtimeTaskSummaryRetry(
  task: Pick<
    RuntimeTaskProjection,
    | "state"
    | "controlOwner"
    | "operation"
    | "deliveryState"
    | "deliveryCanRetry"
  >,
): "delivery" | "manual" | null {
  if (
    task.state !== "succeeded" ||
    runtimeTaskNativeHandoff(task) ||
    task.operation === "send_message"
  )
    return null;
  if (task.deliveryState == null) return "manual";
  if (
    task.deliveryState === "awaiting_result" ||
    task.deliveryState === "pending_synthesis" ||
    task.deliveryState === "synthesizing" ||
    task.deliveryState === "published"
  )
    return null;
  return task.deliveryCanRetry === true ? "delivery" : null;
}

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
  task: Pick<RuntimeTaskProjection, "state" | "canRetry" | "controlOwner">,
): RuntimeTaskAction {
  if (runtimeTaskNativeHandoff(task)) return null;
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
  task: Pick<
    RuntimeTaskProjection,
    "taskId" | "state" | "completedAt" | "controlOwner"
  >,
  dismissedTaskIds: ReadonlySet<string>,
  now: number,
): boolean {
  // The activity strip has controls for Polyphonic-owned work only. Native
  // handoffs use the existing receipt surface instead of implying live control.
  if (
    runtimeTaskNativeHandoff(task) ||
    dismissedTaskIds.has(task.taskId) ||
    task.state === "stopped"
  ) {
    return false;
  }
  if (task.state !== "succeeded") return true;
  const completedAt = task.completedAt
    ? Date.parse(task.completedAt)
    : Number.NaN;
  return Number.isFinite(completedAt) && now - completedAt < 4_000;
}

function finishedTask(task: RuntimeTaskProjection): boolean {
  return (
    task.state === "succeeded" ||
    task.state === "stopped" ||
    task.state === "failed" ||
    task.state === "interrupted"
  );
}

function taskStateOrder(task: RuntimeTaskProjection): number {
  if (finishedTask(task)) return 4;
  if (task.state === "awaiting_native") return 3;
  if (task.state === "stopping") return 2;
  return task.state === "active" ? 1 : 0;
}

/** Merge list backfills and events without replacing newer task evidence. */
export function mergeRuntimeTasks(
  current: readonly RuntimeTaskProjection[],
  incoming: readonly RuntimeTaskProjection[],
): RuntimeTaskProjection[] {
  const tasks = new Map(current.map((task) => [task.taskId, task]));
  for (const task of incoming) {
    const previous = tasks.get(task.taskId);
    if (previous) {
      const previousTime = Date.parse(previous.updatedAt);
      const incomingTime = Date.parse(task.updatedAt);
      if (
        !Number.isFinite(incomingTime) ||
        (Number.isFinite(previousTime) && incomingTime < previousTime) ||
        (finishedTask(previous) && !finishedTask(task)) ||
        (previous.state === "awaiting_native" && taskStateOrder(task) < 3) ||
        (incomingTime === previousTime &&
          task.state !== previous.state &&
          taskStateOrder(task) <= taskStateOrder(previous))
      ) {
        continue;
      }
    }
    tasks.set(
      task.taskId,
      previous
        ? {
            ...task,
            operation: task.operation ?? previous.operation,
            controlOwner: task.controlOwner ?? previous.controlOwner,
            targetLabel: task.targetLabel ?? previous.targetLabel,
            targetSessionRef:
              task.targetSessionRef ?? previous.targetSessionRef,
            deliveryState:
              previous.deliveryState === "published"
                ? "published"
                : (task.deliveryState ?? previous.deliveryState),
            deliveryCanRetry:
              previous.deliveryState === "published"
                ? false
                : (task.deliveryCanRetry ?? previous.deliveryCanRetry),
          }
        : task,
    );
  }
  return [...tasks.values()]
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, 512);
}
