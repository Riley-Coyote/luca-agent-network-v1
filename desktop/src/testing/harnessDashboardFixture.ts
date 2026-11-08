import type {
  HarnessRuntimeFamily,
  HarnessSessionDetail,
  HarnessSessionList,
} from "@/shared/api/tauriHarnessDashboard";
import type {
  RuntimeTaskProjection,
  StartRuntimeTaskInput,
} from "@/shared/api/tauriRuntimeTasks";

export const HARNESS_FIXTURE_LUCA = "a".repeat(64);
export const HARNESS_FIXTURE_FOLDER = "/synthetic/harness/project";
export const HARNESS_FIXTURE_NEW_FOLDER = "/synthetic/harness/new-project";
export const HARNESS_FIXTURE_SOURCE = {
  claude_code: "fixture-source-claude",
  codex: "fixture-source-codex",
} as const;
export const HARNESS_FIXTURE_SESSION = {
  liveClaude: "fixture-session-claude-live",
  savedClaude: "fixture-session-claude-saved",
  liveCodex: "fixture-session-codex-live",
} as const;
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const AT = "2026-11-07T15:00:00.000Z";

export type HarnessDashboardFixture = {
  lists: Record<HarnessRuntimeFamily, HarnessSessionList>;
  transcripts: Record<string, HarnessSessionDetail>;
  tasks: RuntimeTaskProjection[];
  results: Record<string, string>;
  nextTask: number;
};

declare global {
  interface Window {
    /** Opt-in E2E state, never loaded by production code. */
    __BUZZ_E2E_HARNESS_DASHBOARD__?: HarnessDashboardFixture;
  }
}

function fixtureTask(
  input: Partial<RuntimeTaskProjection> &
    Pick<RuntimeTaskProjection, "taskId" | "summary">,
): RuntimeTaskProjection {
  return {
    conversationId: GENERAL,
    residentPubkey: HARNESS_FIXTURE_LUCA,
    runtimeFamily: "claude_code",
    workingFolder: HARNESS_FIXTURE_FOLDER,
    permissionMode: "normal",
    operation: "new_task",
    controlOwner: "polyphonic",
    state: "active",
    providerSessionId: null,
    currentStep: "Reading the focused fixture",
    completedSteps: 0,
    steps: [],
    startedAt: AT,
    updatedAt: AT,
    completedAt: null,
    error: null,
    canRetry: false,
    retryOfTaskId: null,
    ...input,
  };
}

/** A small deterministic native-shaped dataset, deliberately separate from the study. */
export function createHarnessDashboardFixture(): HarnessDashboardFixture {
  return {
    nextTask: 0,
    tasks: [
      fixtureTask({
        taskId: "fixture-claude-working",
        summary: "Check workspace keyboard access",
      }),
      fixtureTask({
        taskId: "fixture-codex-handoff",
        summary: "Codex native follow-up",
        runtimeFamily: "codex",
        state: "awaiting_native",
        controlOwner: "native_app",
        operation: "send_message",
        targetSessionRef: HARNESS_FIXTURE_SESSION.liveCodex,
        currentStep: "Accepted by the native inbox; work is not complete",
      }),
      fixtureTask({
        taskId: "fixture-claude-complete",
        summary: "Earlier saved fixture",
        state: "succeeded",
        currentStep: null,
        completedAt: "2026-11-07T15:02:00.000Z",
      }),
    ],
    lists: {
      claude_code: {
        sourceId: HARNESS_FIXTURE_SOURCE.claude_code,
        runtimeFamily: "claude_code",
        truncated: false,
        notice: null,
        sessions: [
          {
            selectionKey: "stable-fixture-claude-live",
            sessionId: HARNESS_FIXTURE_SESSION.liveClaude,
            title: "Review native workspace layout",
            workspace: "project",
            workingFolder: HARNESS_FIXTURE_FOLDER,
            updatedAt: AT,
            routing: "claude_live",
            liveState: "live",
            canSend: true,
            canContinue: false,
            latestTaskId: null,
            reason: null,
          },
          {
            selectionKey: "stable-fixture-claude-saved",
            sessionId: HARNESS_FIXTURE_SESSION.savedClaude,
            title: "Earlier saved fixture",
            workspace: "project",
            workingFolder: HARNESS_FIXTURE_FOLDER,
            updatedAt: "2026-11-06T15:00:00.000Z",
            routing: "saved_claude",
            liveState: "saved",
            canSend: false,
            canContinue: true,
            latestTaskId: "fixture-claude-complete",
            reason: null,
          },
        ],
      },
      codex: {
        sourceId: HARNESS_FIXTURE_SOURCE.codex,
        runtimeFamily: "codex",
        truncated: false,
        notice: null,
        sessions: [
          {
            selectionKey: "stable-fixture-codex-live",
            sessionId: HARNESS_FIXTURE_SESSION.liveCodex,
            title: "Codex native follow-up",
            workspace: "project",
            workingFolder: HARNESS_FIXTURE_FOLDER,
            updatedAt: AT,
            routing: "codex_app",
            liveState: "live",
            canSend: true,
            canContinue: false,
            latestTaskId: "fixture-codex-handoff",
            reason: null,
          },
        ],
      },
    },
    transcripts: {
      [HARNESS_FIXTURE_SESSION.liveClaude]: {
        sessionId: HARNESS_FIXTURE_SESSION.liveClaude,
        title: "Review native workspace layout",
        messages: [
          {
            role: "user",
            text: "Review this exact native workspace without starting another conversation.",
          },
          {
            role: "assistant",
            text: "I’m keeping the original session and its working folder. Native requests remain in Claude Code.",
          },
        ],
        truncated: false,
        usage: null,
      },
      [HARNESS_FIXTURE_SESSION.savedClaude]: {
        sessionId: HARNESS_FIXTURE_SESSION.savedClaude,
        title: "Earlier saved fixture",
        messages: [
          {
            role: "user",
            text: "Keep the saved context and the existing permission policy.",
          },
          {
            role: "assistant",
            text: "The saved fixture is ready for explicit continuation review.",
          },
        ],
        truncated: false,
        usage: null,
      },
      [HARNESS_FIXTURE_SESSION.liveCodex]: {
        sessionId: HARNESS_FIXTURE_SESSION.liveCodex,
        title: "Codex native follow-up",
        messages: [
          { role: "user", text: "Follow up in the exact Codex session." },
          {
            role: "assistant",
            text: "This is the native Codex transcript, not a copied Luca conversation.",
          },
        ],
        truncated: false,
        usage: null,
      },
    },
    results: {
      "fixture-claude-complete":
        "The saved fixture was checked. The original session remains available.",
    },
  };
}

type FixtureResponse = { handled: false } | { handled: true; value: unknown };

/** Intercept only an explicitly installed fixture; every native command stays observable in the bridge log. */
export function harnessDashboardFixtureCommand(
  command: string,
  payload: unknown,
): FixtureResponse {
  const fixture = window.__BUZZ_E2E_HARNESS_DASHBOARD__;
  if (!fixture) return { handled: false };
  const args = (payload ?? {}) as {
    runtimeFamily?: HarnessRuntimeFamily;
    conversationId?: string;
    taskId?: string;
    input?: StartRuntimeTaskInput;
  };
  const result = (value: unknown): FixtureResponse => ({
    handled: true,
    value: structuredClone(value),
  });
  const changed = (task: RuntimeTaskProjection) => {
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(
      "luca://runtime-task",
      structuredClone(task),
    );
  };
  switch (command) {
    case "list_harness_sessions": {
      if (!args.runtimeFamily || !fixture.lists[args.runtimeFamily])
        throw new Error("Unknown fixture runtime.");
      return result(fixture.lists[args.runtimeFamily]);
    }
    case "get_harness_session": {
      const input = args.input;
      const list = input && fixture.lists[input.runtimeFamily];
      if (
        !input ||
        !list ||
        list.sourceId !== input.sourceId ||
        !list.sessions.some((session) => session.sessionId === input.sessionId)
      )
        throw new Error("The exact fixture session is unavailable.");
      return result(fixture.transcripts[input.sessionId ?? ""]);
    }
    case "list_all_runtime_tasks":
      return result(fixture.tasks);
    case "list_runtime_tasks":
      return result(
        fixture.tasks.filter(
          (task) => task.conversationId === args.conversationId,
        ),
      );
    case "get_runtime_task_result": {
      const task = fixture.tasks.find(
        (candidate) => candidate.taskId === args.taskId,
      );
      if (!task) throw new Error("Fixture task not found.");
      return result({
        taskId: task.taskId,
        state: task.state,
        result: fixture.results[task.taskId] ?? null,
        error: task.error,
      });
    }
    case "pick_runtime_task_folder":
      return result(HARNESS_FIXTURE_NEW_FOLDER);
    case "start_runtime_task": {
      const input = args.input;
      if (
        input?.permissionMode !== "normal" ||
        !input.conversationId ||
        input.residentPubkey !== HARNESS_FIXTURE_LUCA ||
        !input.workingFolder ||
        !input.prompt
      )
        throw new Error("Exact fixture task authority is missing.");
      const list = fixture.lists[input.runtimeFamily];
      const session =
        input.operation !== "new_task"
          ? list.sessions.find(
              (candidate) => candidate.sessionId === input.sessionId,
            )
          : null;
      if (
        input.operation !== "new_task" &&
        (!session ||
          list.sourceId !== input.sourceId ||
          session.workingFolder !== input.workingFolder)
      )
        throw new Error(
          "Fixture dispatch attempted to substitute the native target.",
        );
      if (input.operation === "send_message" && !session?.canSend)
        throw new Error(
          "This fixture session cannot receive a native follow-up.",
        );
      if (input.operation === "continue_session" && !session?.canContinue)
        throw new Error("This fixture session cannot be continued.");
      const native = input.operation === "send_message";
      const task = fixtureTask({
        ...input,
        taskId: `fixture-dispatch-${++fixture.nextTask}`,
        summary: input.summary,
        state: native ? "awaiting_native" : "active",
        controlOwner: native ? "native_app" : "polyphonic",
        targetSessionRef: input.sessionId ?? null,
        targetLabel: session?.title ?? null,
        currentStep: native
          ? "Accepted by the native inbox; work is not complete"
          : "Reading the requested fixture task",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      fixture.tasks.unshift(task);
      if (session) {
        session.latestTaskId = task.taskId;
        if (!native) session.canContinue = false;
      }
      changed(task);
      return result(task);
    }
    case "cancel_runtime_task": {
      const task = fixture.tasks.find(
        (candidate) => candidate.taskId === args.taskId,
      );
      if (!task || task.controlOwner === "native_app")
        throw new Error("Native-owned stopping stays in the native app.");
      task.state = "stopped";
      task.completedAt = new Date().toISOString();
      task.updatedAt = task.completedAt;
      changed(task);
      return result(task);
    }
    case "open_runtime_task_native_session":
      return result(null);
    default:
      return { handled: false };
  }
}
