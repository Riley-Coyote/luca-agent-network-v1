import type {
  HarnessRuntimeFamily,
  HarnessSession,
  HarnessSessionList,
} from "@/shared/api/tauriHarnessDashboard";
import type { RuntimeTaskProjection } from "@/shared/api/tauriRuntimeTasks";

export type HarnessRowState =
  | "working"
  | "waiting"
  | "ready"
  | "saved"
  | "failed"
  | "unknown";

export type HarnessRow = {
  id: string;
  title: string;
  workspace: string;
  workingFolder: string;
  updatedAt: string | null;
  state: HarnessRowState;
  activity: string;
  session: HarnessSession | null;
  task: RuntimeTaskProjection | null;
};

/** Lifecycle comes from a receipt or an explicit native live signal, never mtime. */
export function taskPresentation(task: RuntimeTaskProjection): {
  state: HarnessRowState;
  activity: string;
} {
  if (task.controlOwner === "native_app" || task.state === "awaiting_native") {
    return {
      state:
        task.state === "failed" || task.state === "interrupted"
          ? "failed"
          : "waiting",
      activity:
        task.state === "awaiting_native"
          ? "Queued in the native app · work is not complete"
          : (task.error ?? "Check progress and approvals in the native app"),
    };
  }
  switch (task.state) {
    case "queued":
      return { state: "working", activity: "Queued" };
    case "active":
      return {
        state: "working",
        activity: task.currentStep ?? "Working in Polyphonic",
      };
    case "stopping":
      return { state: "working", activity: "Stopping this task…" };
    case "succeeded":
      return { state: "ready", activity: "Task completed" };
    case "stopped":
      return { state: "ready", activity: "Task stopped" };
    case "failed":
      return { state: "failed", activity: task.error ?? "Task failed" };
    case "interrupted":
      return { state: "failed", activity: task.error ?? "Task interrupted" };
  }
}

function workspaceName(folder: string): string {
  return (
    folder.split(/[\\/]/).filter(Boolean).at(-1) ?? "Working folder unavailable"
  );
}

/** Only native-resolved task IDs may join a task to a catalogue session. */
export function projectHarnessRows(
  runtimeFamily: HarnessRuntimeFamily,
  catalogue: HarnessSessionList | null,
  tasks: readonly RuntimeTaskProjection[],
): HarnessRow[] {
  const runtimeTasks = tasks.filter(
    (task) => task.runtimeFamily === runtimeFamily,
  );
  const byTask = new Map(runtimeTasks.map((task) => [task.taskId, task]));
  const joined = new Set<string>();
  const rows: HarnessRow[] = [];
  if (catalogue?.runtimeFamily === runtimeFamily) {
    for (const session of catalogue.sessions) {
      const task = session.latestTaskId
        ? (byTask.get(session.latestTaskId) ?? null)
        : null;
      if (task) joined.add(task.taskId);
      const native =
        session.liveState === "live"
          ? {
              state: "unknown" as const,
              activity: "Open in the native app · progress is native-owned",
            }
          : session.liveState === "saved"
            ? {
                state: "saved" as const,
                activity: session.canContinue
                  ? "Saved session · continue after review"
                  : (session.reason ?? "Saved session"),
              }
            : {
                state: "unknown" as const,
                activity: session.reason ?? "Native activity is not available",
              };
      rows.push({
        id: `session:${session.selectionKey}`,
        title: session.title,
        workspace: session.workspace || workspaceName(session.workingFolder),
        workingFolder: session.workingFolder,
        updatedAt: task?.updatedAt ?? session.updatedAt,
        ...(task ? taskPresentation(task) : native),
        session,
        task,
      });
    }
  }
  for (const task of runtimeTasks) {
    if (joined.has(task.taskId)) continue;
    rows.push({
      id: `task:${task.taskId}`,
      title: task.summary,
      workspace: workspaceName(task.workingFolder),
      workingFolder: task.workingFolder,
      updatedAt: task.updatedAt,
      ...taskPresentation(task),
      session: null,
      task,
    });
  }
  return rows.sort(
    (left, right) =>
      (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") ||
      left.id.localeCompare(right.id),
  );
}

/** A deep link is an exact selection, not a request to create a conversation. */
export function findInitialHarnessRow(
  rows: readonly HarnessRow[],
  taskId?: string,
  sessionId?: string,
): HarnessRow | null {
  return (
    rows.find((row) =>
      taskId
        ? row.task?.taskId === taskId
        : sessionId
          ? row.session?.sessionId === sessionId ||
            row.session?.selectionKey === sessionId
          : false,
    ) ?? null
  );
}

/** A receipt can acquire its original session after discovery catches up. */
export function reconcileHarnessSelection(
  rows: readonly HarnessRow[],
  selectedId: string | null,
  previous: HarnessRow | null,
): HarnessRow | null {
  if (!selectedId) return null;
  const exact = rows.find((row) => row.id === selectedId);
  if (exact) return exact;
  if (previous?.id !== selectedId) return null;
  return (
    rows.find(
      (row) =>
        (previous.session &&
          row.session?.selectionKey === previous.session.selectionKey) ||
        (previous.task && row.task?.taskId === previous.task.taskId),
    ) ?? null
  );
}

export function harnessDraftKey(
  runtimeFamily: HarnessRuntimeFamily,
  conversationId: string | null,
  residentPubkey: string | null,
  rowId: string,
  ownerScope = "",
): string {
  return `harness-workspace:${JSON.stringify([runtimeFamily, conversationId, residentPubkey, rowId, ownerScope])}`;
}

/** Composer authority stays with the initiating resident; native onSend owns routing. */
export function harnessComposerAudience(
  residentPubkey: string | null,
): readonly string[] {
  return residentPubkey ? [residentPubkey] : [];
}

export function canStopHarnessTask(
  task: RuntimeTaskProjection | null,
): boolean {
  return Boolean(
    task &&
      task.controlOwner !== "native_app" &&
      (task.state === "active" || task.state === "queued"),
  );
}

/** "Open now" needs an explicit live session or an admitted nonterminal task. */
export function isHarnessRowOpen(row: HarnessRow): boolean {
  return (
    row.session?.liveState === "live" ||
    Boolean(
      row.task &&
        ["queued", "active", "stopping", "awaiting_native"].includes(
          row.task.state,
        ),
    )
  );
}

export function harnessTaskUsage(
  tasks: readonly RuntimeTaskProjection[],
  now = Date.now(),
) {
  let durationMs = 0;
  let timedTasks = 0;
  for (const task of tasks) {
    const start = Date.parse(task.startedAt);
    const end = task.completedAt
      ? Date.parse(task.completedAt)
      : task.state === "queued" ||
          task.state === "active" ||
          task.state === "stopping"
        ? now
        : Number.NaN;
    if (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      end >= start &&
      task.controlOwner !== "native_app"
    ) {
      durationMs += end - start;
      timedTasks += 1;
    }
  }
  return {
    total: tasks.length,
    working: tasks.filter(
      (task) =>
        ["queued", "active", "stopping"].includes(task.state) &&
        task.controlOwner !== "native_app",
    ).length,
    completed: tasks.filter(
      (task) =>
        task.state === "succeeded" && task.controlOwner !== "native_app",
    ).length,
    durationMs,
    timedTasks,
  };
}

export function formatHarnessDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes}m`;
}
