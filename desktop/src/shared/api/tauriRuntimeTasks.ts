import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { invokeTauri } from "@/shared/api/tauri";

export type RuntimeTaskState =
  | "queued"
  | "active"
  | "stopping"
  | "succeeded"
  | "stopped"
  | "failed"
  | "interrupted";

export type RuntimeTaskStep = {
  label: string;
  state: "queued" | "active" | "done" | "failed";
};

export type RuntimeTaskProjection = {
  taskId: string;
  conversationId: string;
  residentPubkey: string;
  runtimeFamily: "codex" | "claude_code";
  summary: string;
  workingFolder: string;
  permissionMode: "normal" | "full_access";
  state: RuntimeTaskState;
  providerSessionId: string | null;
  currentStep: string | null;
  completedSteps: number;
  steps: RuntimeTaskStep[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  canRetry: boolean;
  retryOfTaskId: string | null;
};

export type RuntimeTaskResult = {
  taskId: string;
  state: RuntimeTaskState;
  result: string | null;
  error: string | null;
};

export type RuntimeTaskProposal = {
  proposalId: string;
  conversationId: string;
  residentPubkey: string;
  runtimeFamily: "codex" | "claude_code";
  summary: string;
  createdAt: string;
};

export type RuntimeTaskProposalResolved = {
  proposalId: string;
  conversationId: string;
};

export type StartRuntimeTaskInput = {
  conversationId: string;
  residentPubkey: string;
  runtimeFamily: "codex" | "claude_code";
  summary: string;
  prompt: string;
  workingFolder: string;
  permissionMode: "normal" | "full_access";
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

export function listRuntimeTasks(
  conversationId: string,
): Promise<RuntimeTaskProjection[]> {
  return invokeTauri("list_runtime_tasks", { conversationId });
}

export function getRuntimeTaskResult(
  taskId: string,
): Promise<RuntimeTaskResult> {
  return invokeTauri("get_runtime_task_result", { taskId });
}

export function listRuntimeTaskProposals(
  conversationId: string,
): Promise<RuntimeTaskProposal[]> {
  return invokeTauri("list_runtime_task_proposals", { conversationId });
}

export function respondRuntimeTaskProposal(input: {
  proposalId: string;
  approved: boolean;
  runtimeFamily?: "codex" | "claude_code";
  workingFolder?: string;
  permissionMode?: "normal" | "full_access";
}): Promise<void> {
  return invokeTauri("respond_runtime_task_proposal", { input });
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
