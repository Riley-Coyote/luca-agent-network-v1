import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { invokeTauri } from "@/shared/api/tauri";

export type RuntimeTaskState =
  | "queued"
  | "active"
  | "stopping"
  | "awaiting_native"
  | "succeeded"
  | "stopped"
  | "failed"
  | "interrupted";

export type RuntimeTaskOperation =
  | "new_task"
  | "continue_session"
  | "send_message";

export type RuntimeTaskDeliveryState =
  | "awaiting_result"
  | "pending_synthesis"
  | "synthesizing"
  | "prepared"
  | "submitted"
  | "published"
  | "retryable"
  | "rejected"
  | "cancelled"
  | "blocked";

export type RuntimeTaskStep = {
  label: string;
  state: "queued" | "active" | "done" | "failed";
};

export type RuntimeTaskOptions = {
  purpose: "ask" | "task";
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
};

export type RuntimeTaskProjection = {
  /** Provider-reported final evidence, not spending authority or a billing guarantee. */
  actualCostUsd?: number | null;
  budgetExceeded?: boolean | null;
  options?: RuntimeTaskOptions;
  taskId: string;
  conversationId: string;
  residentPubkey: string;
  runtimeFamily: "codex" | "claude_code";
  summary: string;
  workingFolder: string;
  permissionMode: "normal" | "full_access";
  operation?: RuntimeTaskOperation;
  controlOwner?: "polyphonic" | "native_app";
  targetLabel?: string | null;
  targetSessionRef?: string | null;
  state: RuntimeTaskState;
  providerSessionId: string | null;
  currentStep: string | null;
  completedSteps: number;
  steps: RuntimeTaskStep[];
  plan?: import("@/shared/ui/WorkPlan").WorkPlanSnapshot;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  canRetry: boolean;
  retryOfTaskId: string | null;
  deliveryState?: RuntimeTaskDeliveryState | null;
  deliveryCanRetry?: boolean;
};

export type RuntimeTaskResult = {
  taskId: string;
  state: RuntimeTaskState;
  result: string | null;
  error: string | null;
};

export type RuntimeTaskProposal = {
  canRememberPrivateAsk?: boolean;
  options?: RuntimeTaskOptions;
  proposalId: string;
  conversationId: string;
  residentPubkey: string;
  runtimeFamily: "codex" | "claude_code";
  summary: string;
  operation?: RuntimeTaskOperation;
  /** Native-owned opaque references, not user-entered provider session UUIDs. */
  sourceId?: string | null;
  sessionId?: string | null;
  targetLabel?: string | null;
  targetWorkingFolder?: string | null;
  createdAt: string;
};

export type RuntimeTaskProposalResolved = {
  proposalId: string;
  conversationId: string;
};

export type StartRuntimeTaskInput = {
  options?: RuntimeTaskOptions;
  conversationId: string;
  residentPubkey: string;
  runtimeFamily: "codex" | "claude_code";
  summary: string;
  prompt: string;
  workingFolder: string;
  permissionMode: "normal" | "full_access";
  operation?: RuntimeTaskOperation;
  /** Native-owned opaque references, independently revalidated on dispatch. */
  sourceId?: string | null;
  sessionId?: string | null;
};

export function pickRuntimeTaskFolder(): Promise<string | null> {
  return invokeTauri("pick_runtime_task_folder");
}

export function resolveRuntimeTaskProjectFolder(
  sourceIds: string[],
): Promise<string | null> {
  return invokeTauri("resolve_runtime_task_project_folder", { sourceIds });
}

export function startRuntimeTask(
  input: StartRuntimeTaskInput,
): Promise<RuntimeTaskProjection> {
  return invokeTauri("start_runtime_task", { input });
}

export function cancelRuntimeTask(
  taskId: string,
): Promise<RuntimeTaskProjection> {
  return invokeTauri("cancel_runtime_task", { taskId });
}

export function retryRuntimeTask(
  taskId: string,
): Promise<RuntimeTaskProjection> {
  return invokeTauri("retry_runtime_task", { taskId });
}

/** Retry only this task's authorized result summary, never the provider task. */
export function retryRuntimeTaskDelivery(
  taskId: string,
): Promise<RuntimeTaskProjection> {
  return invokeTauri("retry_runtime_task_delivery", { taskId });
}

export function listRuntimeTasks(
  conversationId: string,
): Promise<RuntimeTaskProjection[]> {
  return invokeTauri("list_runtime_tasks", { conversationId });
}

/** Every conversation's runtime tasks, newest first (WP-14): the Activity
 *  place's side conversations and a connected app's history. */
export function listAllRuntimeTasks(): Promise<RuntimeTaskProjection[]> {
  return invokeTauri("list_all_runtime_tasks");
}

export function getRuntimeTaskResult(
  taskId: string,
): Promise<RuntimeTaskResult> {
  return invokeTauri("get_runtime_task_result", { taskId });
}

/** Open the native target resolved from this receipt, never a renderer URL. */
export function openRuntimeTaskSession(taskId: string): Promise<void> {
  return invokeTauri("open_runtime_task_native_session", { taskId });
}

export function listRuntimeTaskProposals(
  conversationId: string,
): Promise<RuntimeTaskProposal[]> {
  return invokeTauri("list_runtime_task_proposals", { conversationId });
}

/** Every conversation's open proposals (WP-14): Activity's Needs you. */
export function listAllRuntimeTaskProposals(): Promise<RuntimeTaskProposal[]> {
  return invokeTauri("list_all_runtime_task_proposals");
}

export function respondRuntimeTaskProposal(input: {
  proposalId: string;
  approved: boolean;
  /** Only the native, exact private writing scope shown in this review. */
  useClaudeApi?: boolean;
  rememberAccess?: boolean;
  runtimeFamily?: "codex" | "claude_code";
  workingFolder?: string;
  permissionMode?: "normal" | "full_access";
}): Promise<void> {
  return invokeTauri("respond_runtime_task_proposal", { input });
}

export function getRememberedRuntimeTaskAccess(): Promise<{ count: number }> {
  return invokeTauri("get_remembered_runtime_task_access");
}

export function forgetRememberedRuntimeTaskAccess(): Promise<void> {
  return invokeTauri("forget_remembered_runtime_task_access");
}

export function listenRuntimeTasks(
  listener: (task: RuntimeTaskProjection) => void,
): Promise<UnlistenFn> {
  return listen<RuntimeTaskProjection>("luca://runtime-task", ({ payload }) => {
    listener(payload);
  });
}

export function listenRuntimeTaskProposals(
  listener: (proposal: RuntimeTaskProposal) => void,
): Promise<UnlistenFn> {
  return listen<RuntimeTaskProposal>(
    "luca://runtime-task-proposal",
    ({ payload }) => listener(payload),
  );
}

export function listenRuntimeTaskProposalResolved(
  listener: (resolution: RuntimeTaskProposalResolved) => void,
): Promise<UnlistenFn> {
  return listen<RuntimeTaskProposalResolved>(
    "luca://runtime-task-proposal-resolved",
    ({ payload }) => listener(payload),
  );
}
