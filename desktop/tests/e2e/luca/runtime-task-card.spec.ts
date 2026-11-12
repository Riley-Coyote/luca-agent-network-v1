import { expect, test, type Page } from "@playwright/test";

import type {
  RuntimeTaskProjection,
  RuntimeTaskProposal,
} from "../../../src/shared/api/tauriRuntimeTasks";
import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";
import {
  TASK_NOTICE_KEY,
  taskNoticeScope,
} from "../../../src/features/capabilities/lib/runtimeTaskNotices";

// A resident DM: no project, so nothing resolves a working folder for it.
// That is the surface where the raised card lives, and where it was inert.
const DM = "alice-tyler";
const DM_ID = "f48efb06-0c93-5025-aac9-2e646bb6bfa8";
const ROOM = "general";
const ROOM_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const LUCA = TEST_IDENTITIES.alice.pubkey;
const PICKED_FOLDER = "/synthetic/projects/picked";
const PRIOR_FOLDER = "/synthetic/projects/last-used";
const TARGET_FOLDER = "/synthetic/projects/exact-native-target";

const browserMessages = new WeakMap<Page, { kind: string; text: string }[]>();

test.beforeEach(({ page }) => {
  const messages: { kind: string; text: string }[] = [];
  browserMessages.set(page, messages);
  page.on("pageerror", (error) =>
    messages.push({ kind: "pageerror", text: error.message }),
  );
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      messages.push({ kind: message.type(), text: message.text() });
    }
  });
});

test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach("runtime-task-browser-messages", {
    body: JSON.stringify(browserMessages.get(page) ?? [], null, 2),
    contentType: "application/json",
  });
});

async function captureMockState(page: Page, filename: string) {
  await waitForAnimations(page);
  await page.screenshot({ path: `output/playwright/${filename}` });
}

type Call = { command: string; payload: unknown };
type HostState = {
  calls: Call[];
  proposals: Record<string, RuntimeTaskProposal>;
  tasks: RuntimeTaskProjection[];
  pickedFolder: string | null;
  runtimeStatusFails: boolean;
  holdLists: boolean;
  pendingListResolvers: Array<() => void>;
  completedListCalls: number;
  suppressDeliveryEvents: boolean;
  heldResultTaskIds: string[];
  pendingResultResolvers: Record<string, () => void>;
  completedResultCalls: number;
  resultBodies: Record<string, string>;
  resultTaskIdOverrides: Record<string, string>;
  resultStateOverrides: Record<string, RuntimeTaskProjection["state"]>;
  stopError: string | null;
  suppressStopEvents: boolean;
  stopReplyTaskId: string | null;
  holdStops: boolean;
  pendingStopResolvers: Array<() => void>;
  completedStopCalls: number;
  heldReceiptActions: string[];
  pendingReceiptActions: Record<string, () => void>;
  completedReceiptActions: number;
};

type HostOptions = {
  tasks?: RuntimeTaskProjection[];
  proposals?: RuntimeTaskProposal[];
  pickedFolder?: string | null;
  runtimeStatusFails?: boolean;
  holdLists?: boolean;
  suppressDeliveryEvents?: boolean;
  heldResultTaskIds?: string[];
  resultBodies?: Record<string, string>;
  resultTaskIdOverrides?: Record<string, string>;
  resultStateOverrides?: Record<string, RuntimeTaskProjection["state"]>;
  stopError?: string;
  suppressStopEvents?: boolean;
  stopReplyTaskId?: string;
  holdStops?: boolean;
  heldReceiptActions?: string[];
};

declare global {
  interface Window {
    __RUNTIME_TASK_CARD_TEST__?: HostState;
  }
}

function proposal(
  overrides: Partial<RuntimeTaskProposal> = {},
): RuntimeTaskProposal {
  return {
    proposalId: "runtime-task-proposal-1",
    conversationId: DM_ID,
    residentPubkey: LUCA,
    runtimeFamily: "claude_code",
    summary: "Update the release notes for beta 7.",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function priorTask(
  overrides: Partial<RuntimeTaskProjection> = {},
): RuntimeTaskProjection {
  return {
    taskId: "runtime-task-prior-1",
    conversationId: DM_ID,
    residentPubkey: LUCA,
    runtimeFamily: "claude_code",
    summary: "Earlier task in this conversation.",
    workingFolder: PRIOR_FOLDER,
    permissionMode: "normal",
    state: "succeeded",
    providerSessionId: null,
    currentStep: null,
    completedSteps: 1,
    steps: [],
    startedAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:01:00Z",
    completedAt: "2026-09-01T00:01:00Z",
    error: null,
    canRetry: false,
    retryOfTaskId: null,
    ...overrides,
  };
}

// Only the proposal bookkeeping is simulated, the way the Rust host keeps it:
// a respond resolves the proposal and the host announces the resolution. The
// rest of the conversation runs on the real mock bridge.
async function installHost(page: Page, options: HostOptions) {
  await page.addInitScript((options) => {
    const state: HostState = {
      calls: [],
      proposals: Object.fromEntries(
        (options.proposals ?? []).map((item) => [item.proposalId, item]),
      ),
      tasks: options.tasks ?? [],
      pickedFolder: options.pickedFolder ?? null,
      runtimeStatusFails: options.runtimeStatusFails ?? false,
      holdLists: options.holdLists ?? false,
      pendingListResolvers: [],
      completedListCalls: 0,
      suppressDeliveryEvents: options.suppressDeliveryEvents ?? false,
      heldResultTaskIds: options.heldResultTaskIds ?? [],
      pendingResultResolvers: {},
      completedResultCalls: 0,
      resultBodies: options.resultBodies ?? {},
      resultTaskIdOverrides: options.resultTaskIdOverrides ?? {},
      resultStateOverrides: options.resultStateOverrides ?? {},
      stopError: options.stopError ?? null,
      suppressStopEvents: options.suppressStopEvents ?? false,
      stopReplyTaskId: options.stopReplyTaskId ?? null,
      holdStops: options.holdStops ?? false,
      pendingStopResolvers: [],
      completedStopCalls: 0,
      heldReceiptActions: options.heldReceiptActions ?? [],
      pendingReceiptActions: {},
      completedReceiptActions: 0,
    };
    window.__RUNTIME_TASK_CARD_TEST__ = state;
    type Invoke = (
      command: string,
      payload?: unknown,
      options?: unknown,
    ) => Promise<unknown>;
    let realInvoke: Invoke | undefined;
    const target = window as unknown as {
      __TAURI_INTERNALS__?: Record<string, unknown>;
    };
    const internals = target.__TAURI_INTERNALS__ ?? {};
    target.__TAURI_INTERNALS__ = internals;
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      set: (invoke: Invoke) => {
        realInvoke = invoke;
      },
      get:
        () =>
        async (command: string, payload?: unknown, invokeOptions?: unknown) => {
          state.calls.push({
            command,
            payload: structuredClone(payload ?? null),
          });
          if (
            command === "list_runtime_task_proposals" ||
            command === "list_runtime_tasks"
          ) {
            const snapshot = structuredClone(
              command === "list_runtime_task_proposals"
                ? Object.values(state.proposals)
                : state.tasks,
            );
            if (state.holdLists) {
              await new Promise<void>((resolve) =>
                state.pendingListResolvers.push(resolve),
              );
            }
            state.completedListCalls += 1;
            return snapshot;
          }
          if (
            command === "open_runtime_task_native_session" ||
            command === "retry_runtime_task_delivery"
          ) {
            const taskId = (payload as { taskId: string }).taskId;
            if (state.heldReceiptActions.includes(taskId)) {
              await new Promise<void>((resolve) => {
                state.pendingReceiptActions[taskId] = resolve;
              });
            }
            state.completedReceiptActions += 1;
          }
          if (command === "open_runtime_task_native_session") return null;
          if (command === "retry_runtime_task_delivery") {
            const taskId = (payload as { taskId: string }).taskId;
            const index = state.tasks.findIndex(
              (task) => task.taskId === taskId,
            );
            const previous = state.tasks[index];
            if (!previous?.deliveryCanRetry)
              throw new Error("This result summary cannot be retried.");
            const retried: RuntimeTaskProjection = {
              ...previous,
              deliveryState: "pending_synthesis",
              deliveryCanRetry: false,
              updatedAt: new Date(
                Date.parse(previous.updatedAt) + 1_000,
              ).toISOString(),
            };
            state.tasks[index] = retried;
            if (!state.suppressDeliveryEvents) {
              window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(
                "luca://runtime-task",
                retried,
              );
            }
            return retried;
          }
          if (command === "get_runtime_task_result") {
            const taskId = (payload as { taskId: string }).taskId;
            if (state.heldResultTaskIds.includes(taskId)) {
              await new Promise<void>((resolve) => {
                state.pendingResultResolvers[taskId] = resolve;
              });
            }
            state.completedResultCalls += 1;
            return {
              taskId: state.resultTaskIdOverrides[taskId] ?? taskId,
              state: state.resultStateOverrides[taskId] ?? "succeeded",
              result:
                state.resultBodies[taskId] ??
                "Synthetic completed task result.",
              error: null,
            };
          }
          if (command === "cancel_runtime_task") {
            if (state.stopError) throw new Error(state.stopError);
            const taskId = (payload as { taskId: string }).taskId;
            const index = state.tasks.findIndex(
              (task) => task.taskId === taskId,
            );
            const task = state.tasks[index];
            if (!task) throw new Error("The exact task is unavailable.");
            const stopped: RuntimeTaskProjection = {
              ...task,
              state: "stopping",
              currentStep: "Stopping task",
              updatedAt: new Date(
                Date.parse(task.updatedAt) + 1_000,
              ).toISOString(),
            };
            state.tasks[index] = stopped;
            if (state.holdStops) {
              await new Promise<void>((resolve) =>
                state.pendingStopResolvers.push(resolve),
              );
            }
            if (!state.suppressStopEvents) {
              window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(
                "luca://runtime-task",
                stopped,
              );
            }
            state.completedStopCalls += 1;
            return { ...stopped, taskId: state.stopReplyTaskId ?? taskId };
          }
          if (
            command === "list_runtime_connection_status" &&
            state.runtimeStatusFails
          )
            throw new Error("The runtime check could not be reached.");
          if (command === "pick_runtime_task_folder") return state.pickedFolder;
          if (command === "resolve_runtime_task_project_folder") return null;
          if (command === "respond_runtime_task_proposal") {
            const input = (payload as { input: { proposalId: string } }).input;
            const pending = state.proposals[input.proposalId];
            if (!pending)
              throw new Error("This runtime task proposal is no longer open.");
            delete state.proposals[input.proposalId];
            window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(
              "luca://runtime-task-proposal-resolved",
              {
                proposalId: pending.proposalId,
                conversationId: pending.conversationId,
              },
            );
            return null;
          }
          if (command === "retry_runtime_task") {
            const taskId = (payload as { taskId: string }).taskId;
            const prior = state.tasks.find((task) => task.taskId === taskId);
            if (prior?.state !== "failed" || !prior.canRetry)
              throw new Error("This task cannot be retried.");
            const updated: RuntimeTaskProjection = {
              ...prior,
              taskId: `retry:${taskId}`,
              retryOfTaskId: taskId,
              state: "queued",
              error: null,
              completedAt: null,
              startedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            state.tasks.unshift(updated);
            window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(
              "luca://runtime-task",
              updated,
            );
            return updated;
          }
          if (!realInvoke) throw new Error("Mock bridge is unavailable.");
          return realInvoke(command, payload, invokeOptions);
        },
    });
  }, options);
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: LUCA,
        name: "Luca",
        status: "running",
        channelNames: [ROOM, DM],
      },
    ],
    searchProfiles: [{ pubkey: LUCA, displayName: "Luca", isAgent: true }],
  });
}

async function open(page: Page, options: HostOptions = {}, channelId = DM_ID) {
  await installHost(page, options);
  await page.goto(`/?e2e=mock#/channels/${channelId}`);
  await expect(page.getByTestId("message-input")).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForFunction(() => {
    const calls = window.__RUNTIME_TASK_CARD_TEST__?.calls ?? [];
    return (
      calls.some((call) => call.command === "list_runtime_task_proposals") &&
      calls.some((call) => call.command === "list_runtime_tasks")
    );
  });
}

async function quietShell(
  page: Page,
  keepHistoryBoundary = false,
  light = false,
) {
  await page.addInitScript(
    ({ flagKey, noticeKey, keepHistoryBoundary, light }) => {
      localStorage.setItem(flagKey, JSON.stringify({ "shell-frame": true }));
      localStorage.setItem("buzz-theme", light ? "paper" : "obsidian");
      localStorage.setItem("buzz-follow-system", "false");
      if (keepHistoryBoundary && !localStorage.getItem(noticeKey))
        localStorage.setItem(
          noticeKey,
          JSON.stringify({ since: 0, dismissed: {} }),
        );
    },
    {
      flagKey: FEATURE_OVERRIDES_STORAGE_KEY,
      noticeKey: `${TASK_NOTICE_KEY}:${taskNoticeScope("deadbeef".repeat(8), "e2e-default-community")}`,
      keepHistoryBoundary,
      light,
    },
  );
}

test.describe("quiet notice Retina rendering", () => {
  test.use({ deviceScaleFactor: 2 });
  for (const light of [false, true]) {
    test(`compact details remain usable by keyboard (${light ? "light" : "dark"})`, async ({
      page,
    }, testInfo) => {
      await quietShell(page, true, light);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await open(page, {
        tasks: [
          priorTask({
            state: "failed",
            error: "Check the selected runtime connection before trying again.",
          }),
        ],
      });
      const notice = page.getByTestId("runtime-task-notice");
      const disclosure = notice.getByRole("button", {
        name: "Review task notices",
      });
      for (const width of [1440, 1280, 1024, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(disclosure).toBeVisible();
        await disclosure.focus();
        await page.keyboard.press("Enter");
        await expect(disclosure).toHaveAttribute("aria-expanded", "true");
        await expect(notice).toContainText(
          "Check the selected runtime connection",
        );
        await expect(page.locator(".luca-first-message-greeting")).toBeHidden();
        await expect(
          page.locator('.luca-room-stack__head[data-kind="work"]'),
        ).toBeHidden();
        await notice
          .getByRole("button", { name: "Dismiss task receipt" })
          .click({ trial: true });
        await waitForAnimations(page);
        await page.screenshot({
          path: testInfo.outputPath(
            `notice-retina-${light ? "light" : "dark"}-${width}.png`,
          ),
        });
        await disclosure.focus();
        await page.keyboard.press("Enter");
        await expect(disclosure).toHaveAttribute("aria-expanded", "false");
      }
    });
  }
});

async function emitTask(page: Page, task: RuntimeTaskProjection) {
  await page.evaluate((task) => {
    const host = window.__RUNTIME_TASK_CARD_TEST__;
    if (!host) throw new Error("Host unavailable");
    host.tasks = [
      task,
      ...host.tasks.filter((item) => item.taskId !== task.taskId),
    ];
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://runtime-task", task);
  }, task);
}

for (const light of [false, true]) {
  test(`short asks stay quiet and real task plans remain visible (${light ? "light" : "dark"})`, async ({
    page,
  }, testInfo) => {
    await quietShell(page, false, light);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const task = priorTask({
      taskId: "short-ask",
      summary: "Write a short poem",
      state: "active",
      options: { purpose: "ask", model: "claude-opus-5-5" },
      currentStep: "Thinking",
      completedAt: null,
      completedSteps: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await open(page, { tasks: [task] });
    const item = page.locator(".luca-runtime-task");
    await expect(item).toContainText("Write a short poem");
    await expect(item.getByRole("button", { name: "Open task" })).toBeVisible();
    await expect(
      page.locator('.luca-room-stack__head[data-kind="work"]'),
    ).toBeHidden();
    await expect(page.getByTestId("runtime-task-notice")).toHaveCount(0);
    await expect(item.getByTestId("work-plan")).toHaveCount(0);
    const next = {
      ...task,
      options: { purpose: "task" as const },
      plan: {
        steps: [
          { content: "Inspect the request", status: "completed" as const },
          {
            content: "Build the requested change",
            status: "in_progress" as const,
          },
          {
            content: "Verify and return the result",
            status: "pending" as const,
          },
        ],
      },
    };
    await emitTask(page, next);
    await expect(item.getByRole("list", { name: "Plan" })).toBeVisible();
    await expect(item.locator('[data-plan-status="pending"]')).toContainText(
      "Verify and return",
    );
    for (const width of [1440, 1280, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        item.getByRole("button", { name: "Stop", exact: true }),
      ).toBeVisible();
      await item.getByRole("button", { name: "Open task" }).focus();
      const bounds = await item.evaluate((el) => ({
        left: el.getBoundingClientRect().left,
        right: el.getBoundingClientRect().right,
        viewport: innerWidth,
      }));
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1);
      await page.screenshot({
        path: testInfo.outputPath(
          `delegation-${light ? "light" : "dark"}-${width}.png`,
        ),
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await emitTask(page, {
      ...next,
      state: "succeeded",
      completedAt: new Date().toISOString(),
      deliveryState: "published",
    });
    await expect(item).toHaveCount(0);
    await expect(page.getByTestId("runtime-task-result-receipt")).toHaveCount(
      0,
    );
  });
}

test("answer-only approval uses its supplied scratch folder without a folder picker", async ({
  page,
}) => {
  await quietShell(page);
  await open(page, {
    proposals: [
      proposal({
        options: { purpose: "ask", model: "claude-opus-5-5" },
        targetWorkingFolder: TARGET_FOLDER,
        summary: "Write a poem",
      }),
    ],
  });
  const run = page.getByTestId("needs-you-proposal-run");
  await expect(run).toBeEnabled();
  await run.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__RUNTIME_TASK_CARD_TEST__?.calls.find(
            (call) => call.command === "respond_runtime_task_proposal",
          )?.payload,
      ),
    )
    .toMatchObject({ input: { approved: true, workingFolder: TARGET_FOLDER } });
  expect(
    await page.evaluate(() =>
      window.__RUNTIME_TASK_CARD_TEST__?.calls.some(
        (call) => call.command === "pick_runtime_task_working_folder",
      ),
    ),
  ).toBe(false);
});

test("quiet notices do not replay historical QA, success, stopped or native acknowledgement", async ({
  page,
}) => {
  await quietShell(page);
  await open(page, {
    tasks: [
      priorTask({
        taskId: "old-failure",
        state: "failed",
        error: "Old QA failure",
      }),
      priorTask({
        taskId: "complete",
        state: "succeeded",
        deliveryState: "published",
      }),
      priorTask({ taskId: "stopped", state: "stopped" }),
      priorTask({
        taskId: "native-queued",
        state: "awaiting_native",
        controlOwner: "native_app",
      }),
    ],
  });
  await expect(page.getByTestId("runtime-task-notice")).toHaveCount(0);
  await expect(page.getByTestId("runtime-task-result-receipt")).toHaveCount(0);
  await expect(page.locator(".luca-runtime-task-item")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__RUNTIME_TASK_CARD_TEST__?.tasks.length),
  ).toBe(4);
});

test("quiet notice batch dismisses durably without a conveyor belt or task mutation", async ({
  page,
}) => {
  await quietShell(page, true);
  const failures = [
    priorTask({ taskId: "failed-one", state: "failed", error: "Failure one" }),
    priorTask({
      taskId: "uncertain-two",
      state: "interrupted",
      controlOwner: "native_app",
      operation: "send_message",
      error: "Delivery not confirmed",
    }),
  ];
  await open(page, { tasks: failures });
  const notice = page.getByTestId("runtime-task-notice");
  await expect(notice).toContainText("2 tasks need attention");
  await expect(notice).not.toContainText(failures[0].summary);
  await expect(notice).not.toContainText("Handle approvals");
  await notice
    .getByRole("button", { name: "Dismiss task notices", exact: true })
    .click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("message-input")).toBeVisible();
  await expect(notice).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.__RUNTIME_TASK_CARD_TEST__?.tasks.map((t) => t.state),
    ),
  ).toEqual(["failed", "interrupted"]);
  const next = priorTask({
    taskId: "new-failure",
    state: "failed",
    updatedAt: new Date(Date.now() + 1000).toISOString(),
    error: "New failure",
  });
  await emitTask(page, next);
  await expect(notice).toContainText("Claude Code task needs attention");
  await notice.getByRole("button", { name: "Review task notices" }).click();
  await expect(notice).toContainText("New failure");
  await expect(notice).not.toContainText("Failure one");
  const calls = await page.evaluate(
    () => window.__RUNTIME_TASK_CARD_TEST__?.calls ?? [],
  );
  expect(
    calls.filter((call) =>
      /^(start|retry|cancel)_runtime_task/.test(call.command),
    ),
  ).toEqual([]);
});

test("a new issue is visible once and a refresh cannot revive its dismissed revision", async ({
  page,
}) => {
  await quietShell(page);
  await open(page);
  const failure = priorTask({
    taskId: "fresh-uncertain",
    state: "interrupted",
    runtimeFamily: "codex",
    controlOwner: "native_app",
    operation: "send_message",
    updatedAt: new Date(Date.now() + 1000).toISOString(),
  });
  await emitTask(page, failure);
  const notice = page.getByTestId("runtime-task-notice");
  await expect(notice).toContainText("Check delivery in Codex");
  await notice.getByRole("button", { name: "Review task notices" }).click();
  await expect(notice).toContainText("no automatic retry will run");
  await expect(
    notice.getByRole("button", { name: "Open in Codex" }),
  ).toBeVisible();
  await expect(notice.getByRole("button", { name: "Retry task" })).toHaveCount(
    0,
  );
  await notice.getByRole("button", { name: "Dismiss task notices" }).click();
  await emitTask(page, {
    ...failure,
    updatedAt: new Date(Date.now() + 2000).toISOString(),
  });
  await expect(notice).toHaveCount(0);
  await emitTask(page, {
    ...failure,
    updatedAt: new Date(Date.now() + 3000).toISOString(),
    error: "A different confirmed failure",
  });
  await expect(notice).toBeVisible();
  await expect(
    notice.getByRole("button", { name: "Review task notices" }),
  ).toHaveAttribute("aria-expanded", "false");
});

test("a quiet result-return failure uses the exact delivery retry without rerunning work", async ({
  page,
}) => {
  await quietShell(page, true);
  const task = priorTask({
    taskId: "return-only",
    deliveryState: "retryable",
    deliveryCanRetry: true,
  });
  await open(page, { tasks: [task], suppressDeliveryEvents: true });
  const notice = page.getByTestId("runtime-task-notice");
  await expect(notice).toContainText("Return the Claude Code result");
  await notice.getByRole("button", { name: "Review task notices" }).click();
  await notice.getByRole("button", { name: "Retry result summary" }).click();
  await expect(notice).toHaveCount(0);
  const calls = await page.evaluate(
    () => window.__RUNTIME_TASK_CARD_TEST__?.calls ?? [],
  );
  expect(
    calls
      .filter((c) => c.command === "retry_runtime_task_delivery")
      .map((c) => c.payload),
  ).toEqual([{ taskId: task.taskId }]);
  expect(
    calls.filter((c) =>
      [
        "start_runtime_task",
        "retry_runtime_task",
        "cancel_runtime_task",
      ].includes(c.command),
    ),
  ).toEqual([]);
});

test("a quiet failed task retries only after an explicit owner click", async ({
  page,
}) => {
  await quietShell(page, true);
  const failed = priorTask({
    taskId: "explicit-retry",
    state: "failed",
    canRetry: true,
    error: "Runtime unavailable",
  });
  await open(page, { tasks: [failed] });
  const notice = page.getByTestId("runtime-task-notice");
  await expect(notice).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.__RUNTIME_TASK_CARD_TEST__?.calls.filter(
        (call) => call.command === "retry_runtime_task",
      ),
    ),
  ).toEqual([]);
  await notice.getByRole("button", { name: "Review task notices" }).click();
  await notice.getByRole("button", { name: "Retry task", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.locator(".luca-runtime-task-item")).toContainText(
    "Starting task",
  );
  expect(
    await page.evaluate(() =>
      window.__RUNTIME_TASK_CARD_TEST__?.calls
        .filter((call) => call.command === "retry_runtime_task")
        .map((call) => call.payload),
    ),
  ).toEqual([{ taskId: failed.taskId }]);
});

for (const light of [false, true]) {
  test(`work-only notices keep their backing over scrolling messages (${light ? "light" : "dark"})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(
      ({ key, light, noticeKey }) => {
        localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
        localStorage.setItem("buzz-theme", light ? "paper" : "obsidian");
        localStorage.setItem("buzz-follow-system", "false");
        localStorage.setItem(
          noticeKey,
          JSON.stringify({ since: 0, dismissed: {} }),
        );
      },
      {
        key: FEATURE_OVERRIDES_STORAGE_KEY,
        light,
        noticeKey: `${TASK_NOTICE_KEY}:${taskNoticeScope("deadbeef".repeat(8), "e2e-default-community")}`,
      },
    );
    const failed = priorTask({
      taskId: "failed-codex-task",
      conversationId: ROOM_ID,
      runtimeFamily: "codex",
      summary: "Continue Codex session 01a1bb31",
      state: "failed",
      error: "The runtime host reported a failed task.",
    });
    await open(
      page,
      {
        tasks: [
          failed,
          priorTask({ conversationId: ROOM_ID, deliveryState: "published" }),
        ],
      },
      ROOM_ID,
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "general",
          }),
        ),
      )
      .toBe(true);
    await page.evaluate(() => {
      for (let i = 0; i < 20; i++) {
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          content: `Report ${i + 1}: The Claude Code continuation completed and its result is in this conversation. This is transcript text, not a runtime notice.\n\nThe Codex failure belongs to a different task. Its notice should stay readable while this long message scrolls behind it.`,
        });
      }
    });
    const stack = page.getByTestId("room-stack");
    const receipt = page.getByTestId("runtime-task-notice");
    const item = stack.locator(".luca-runtime-task-item");
    await expect(item).toHaveCount(0);
    await expect(stack).not.toHaveAttribute("data-has-asks");
    await expect(receipt).toContainText("Codex task needs attention");
    await expect(receipt).not.toContainText("Completed with Claude Code");

    for (const width of [1440, 1280, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(stack).toBeVisible();
      const paint = await stack.evaluate((element) => {
        const style = getComputedStyle(element, "::before");
        const rect = element.getBoundingClientRect();
        return {
          fill: style.backgroundColor,
          content: style.content,
          animation: style.animationName,
          isolation: getComputedStyle(element).isolation,
          left: parseFloat(style.left),
          right: parseFloat(style.right),
          width: rect.width,
        };
      });
      expect(paint.fill).toMatch(/^rgb\(/);
      expect(paint.content).toBe('""');
      expect(paint.animation).toBe("none");
      expect(paint.isolation).toBe("isolate");
      expect(paint.left).toBe(8);
      expect(paint.right).toBe(8);
      for (const control of [
        receipt.getByRole("button", {
          name: "Review task notices",
          exact: true,
        }),
        receipt.getByRole("button", {
          name: "Dismiss task notices",
          exact: true,
        }),
      ]) {
        await control.click({ trial: true });
      }
      // A wheel through the history must not remove the backing or cover its
      // controls; the approved composer keeps its own geometry and material.
      const timeline = page.getByTestId("message-timeline");
      const viewport = await timeline.boundingBox();
      if (!viewport) throw new Error("Missing transcript viewport");
      await page.mouse.move(
        viewport.x + viewport.width / 2,
        viewport.y + viewport.height / 3,
      );
      await page.mouse.wheel(0, -180);
      await page.mouse.move(2, 2);
      await expect(stack).toBeVisible();
      expect(
        await stack.evaluate(
          (element) => getComputedStyle(element, "::before").backgroundColor,
        ),
      ).toBe(paint.fill);
      const receiptBox = await receipt.boundingBox();
      if (!receiptBox) throw new Error("Missing work notice");
      expect(receiptBox.height).toBeLessThan(52);
      await waitForAnimations(page);
      await page.screenshot({
        path: testInfo.outputPath(
          `work-notices-${light ? "light" : "dark"}-${width}.png`,
        ),
        animations: "disabled",
      });
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "20px";
    });
    await receipt
      .getByRole("button", { name: "Review task notices", exact: true })
      .click({ trial: true });
    const enlargedReceipt = await receipt.boundingBox();
    if (!enlargedReceipt) throw new Error("Missing enlarged work notice");
    expect(enlargedReceipt.height).toBeLessThan(60);
    await page.evaluate(() =>
      document.documentElement.style.removeProperty("font-size"),
    );
    await expect(receipt).toBeVisible();
    expect(
      await stack.evaluate(
        (element) => getComputedStyle(element, "::before").backgroundColor,
      ),
    ).toMatch(/^rgb\(/);
    await receipt
      .getByRole("button", { name: "Dismiss task notices", exact: true })
      .click();
    await expect(receipt).toBeHidden();
    expect(
      await stack.evaluate(
        (element) => getComputedStyle(element, "::before").content,
      ),
    ).toBe("none");
    expect(
      await page.evaluate(() =>
        window.__RUNTIME_TASK_CARD_TEST__?.calls.filter((call) =>
          /^(cancel|retry)_runtime_task$/.test(call.command),
        ),
      ),
    ).toEqual([]);
  });
}

async function releaseLists(page: Page) {
  const expectedCompletions = await page.evaluate(() => {
    const state = window.__RUNTIME_TASK_CARD_TEST__;
    if (!state) throw new Error("No host list boundary.");
    state.holdLists = false;
    const pending = state.pendingListResolvers.splice(0);
    const expected = state.completedListCalls + pending.length;
    for (const resolve of pending) resolve();
    return expected;
  });
  await page.waitForFunction(
    (expected) =>
      (window.__RUNTIME_TASK_CARD_TEST__?.completedListCalls ?? 0) >= expected,
    expectedCompletions,
  );
}

async function raise(page: Page, request = proposal()) {
  await page.evaluate((request) => {
    const state = window.__RUNTIME_TASK_CARD_TEST__;
    if (!state || !window.__BUZZ_E2E_EMIT_TAURI_EVENT__)
      throw new Error("No host event boundary.");
    state.proposals[request.proposalId] = request;
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__(
      "luca://runtime-task-proposal",
      request,
    );
  }, request);
  const card = page.getByTestId("runtime-task-confirmation");
  // The shipping shell folds a new ask, then opens its existing detailed
  // form through Change. The legacy surface presents the same form directly.
  if (await page.locator("html[data-luca-frame]").count()) {
    const held = page.getByTestId("pending-held");
    const change = page.getByTestId("needs-you-proposal-change");
    await expect(held.or(change).first()).toBeVisible();
    if (await held.isVisible()) await held.click();
    await expect(change).toBeVisible();
    if (!(await card.isVisible())) await change.click();
  }
  await expect(card).toBeVisible();
  return card;
}

async function responses(page: Page) {
  return page.evaluate(
    () =>
      window.__RUNTIME_TASK_CARD_TEST__?.calls
        .filter((call) => call.command === "respond_runtime_task_proposal")
        .map(
          (call) =>
            (
              call.payload as {
                input: {
                  approved: boolean;
                  workingFolder?: string;
                  runtimeFamily?: string;
                  permissionMode?: string;
                };
              }
            ).input,
        ) ?? [],
  );
}

test("the raised card takes clicks instead of sitting behind the overlay", async ({
  page,
}) => {
  await open(page);
  const card = await raise(page);

  // The composer overlay is pointer-events-none. A card that does not opt
  // back in renders perfectly and answers nothing.
  await expect(card).toHaveCSS("pointer-events", "auto");
  const cancel = card.getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toBeEnabled();

  await cancel.click();
  await expect(card).toHaveCount(0);
  expect(await responses(page)).toEqual([
    { proposalId: "runtime-task-proposal-1", approved: false },
  ]);
});

test("the close control dismisses the card as well", async ({ page }) => {
  await open(page);
  const card = await raise(page);

  const close = card.getByRole("button", { name: "Cancel runtime task" });
  await expect(close).toBeEnabled();
  await close.click();
  await expect(card).toHaveCount(0);
  expect(await responses(page)).toEqual([
    { proposalId: "runtime-task-proposal-1", approved: false },
  ]);
});

test("Run waits for a folder, then starts the task exactly once", async ({
  page,
}) => {
  await open(page, { pickedFolder: PICKED_FOLDER });
  const card = await raise(page);
  await expect(card).toContainText(
    "authorizes this exact task and one result summary by Luca back into this same conversation",
  );
  await expect(card).toContainText("does not authorize another provider task");

  // No project and no earlier task: there is nothing to run in yet.
  const run = card.getByRole("button", { name: "Run", exact: true });
  await expect(run).toBeDisabled();

  await card
    .getByRole("button", { name: "Choose a project or working folder" })
    .click();
  await expect(card.getByText(PICKED_FOLDER)).toBeVisible();
  await expect(run).toBeEnabled();

  await run.click();
  await expect(card).toHaveCount(0);
  expect(await responses(page)).toEqual([
    {
      proposalId: "runtime-task-proposal-1",
      approved: true,
      runtimeFamily: "claude_code",
      workingFolder: PICKED_FOLDER,
      permissionMode: "normal",
    },
  ]);
});

test("the folder the last task ran in is offered again", async ({ page }) => {
  await open(page, { tasks: [priorTask()] });
  const card = await raise(page);

  await expect(card.getByText(PRIOR_FOLDER)).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Run", exact: true }),
  ).toBeEnabled();
});

test("a failed runtime check says so instead of going quiet", async ({
  page,
}) => {
  await open(page, { tasks: [priorTask()], runtimeStatusFails: true });
  const card = await raise(page);

  // The selector has nothing to offer, so the card has to explain itself
  // rather than leave a disabled control and a dead Run button.
  await expect(
    card.getByText(/could not check which runtimes are ready/),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Run", exact: true }),
  ).toBeDisabled();
  await expect(
    card.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeEnabled();
});

test("the card in a resident DM", async ({ page }) => {
  await open(page, { tasks: [priorTask()] });
  await raise(page);
  await captureMockState(page, "runtime-task-card.png");
});

test("a native-app follow-up locks the exact target and preserves its permission policy", async ({
  page,
}) => {
  await open(page, {
    tasks: [priorTask()],
    pickedFolder: PICKED_FOLDER,
    runtimeStatusFails: true,
  });
  const card = await raise(
    page,
    proposal({
      operation: "send_message",
      runtimeFamily: "codex",
      sourceId: "opaque-source-ref",
      sessionId: "opaque-session-ref",
      targetLabel: "The exact requested Codex session",
      targetWorkingFolder: TARGET_FOLDER,
    }),
  );
  await expect(
    card.getByText("The exact requested Codex session"),
  ).toBeVisible();
  await expect(card.getByRole("combobox", { name: "Runtime" })).toBeDisabled();
  await expect(card.getByRole("combobox", { name: "Runtime" })).toHaveValue(
    "codex",
  );
  await expect(
    card.getByRole("button", { name: TARGET_FOLDER }),
  ).toBeDisabled();
  await expect(
    card.getByRole("combobox", { name: "Permission mode" }),
  ).toHaveCount(0);
  await expect(card.getByText(/Full Access/)).toHaveCount(0);
  await expect(card.getByText(PRIOR_FOLDER, { exact: true })).toHaveCount(0);
  await expect(card.getByText("opaque-session-ref")).toHaveCount(0);
  await expect(card).not.toContainText("one result summary");
  await expect(card).toContainText("Delivery is not work completion");
  await captureMockState(page, "runtime-task-send-confirmation.png");
  const send = card.getByRole("button", { name: "Send", exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(card).toHaveCount(0);
  expect(await responses(page)).toEqual([
    {
      proposalId: "runtime-task-proposal-1",
      approved: true,
      runtimeFamily: "codex",
      workingFolder: TARGET_FOLDER,
      permissionMode: "normal",
    },
  ]);
  expect(
    await page.evaluate(() =>
      window.__RUNTIME_TASK_CARD_TEST__?.calls.filter(
        (call) => call.command === "pick_runtime_task_folder",
      ),
    ),
  ).toEqual([]);
});

test("saved-session continuation offers Continue, not a new task or target override", async ({
  page,
}) => {
  await open(page, { runtimeStatusFails: true });
  const card = await raise(
    page,
    proposal({
      operation: "continue_session",
      runtimeFamily: "codex",
      sourceId: "opaque-source-ref",
      sessionId: "opaque-saved-session-ref",
      targetLabel: "Saved Codex work",
      targetWorkingFolder: TARGET_FOLDER,
    }),
  );
  await expect(
    card.getByRole("button", { name: "Run", exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  await expect(card).toContainText(
    "confirm this exact saved CLI session is not running in another client",
  );
  await expect(card).toContainText(
    "File metadata and Polyphonic's local lease do not prove that it is idle everywhere",
  );
  await expect(card).toContainText(
    "authorizes this exact task and one result summary by Luca back into this same conversation",
  );
  await captureMockState(page, "runtime-task-continue-confirmation.png");
  await card.getByRole("button", { name: "Continue", exact: true }).click();
  expect(await responses(page)).toEqual([
    {
      proposalId: "runtime-task-proposal-1",
      approved: true,
      runtimeFamily: "codex",
      workingFolder: TARGET_FOLDER,
      permissionMode: "normal",
    },
  ]);
});

test("missing native refs never fall back to the prior task folder", async ({
  page,
}) => {
  await open(page, { tasks: [priorTask()], pickedFolder: PICKED_FOLDER });
  const card = await raise(
    page,
    proposal({
      operation: "send_message",
      runtimeFamily: "codex",
      targetLabel: "Unresolved native target",
      targetWorkingFolder: TARGET_FOLDER,
    }),
  );
  await expect(card.getByRole("alert")).toContainText("no work will be sent");
  const compact = page.getByTestId("needs-you-proposal-run");
  if (await compact.count()) await expect(compact).toBeDisabled();
  await expect(
    card.getByRole("button", { name: "Send", exact: true }),
  ).toBeDisabled();
  await expect(card.getByRole("combobox", { name: "Runtime" })).toBeDisabled();
  await expect(card.getByText(PRIOR_FOLDER, { exact: true })).toHaveCount(0);
  expect(await responses(page)).toEqual([]);
});

for (const state of ["awaiting_native", "interrupted", "failed"] as const) {
  test(`native ${state} remains a handoff without result, Stop or Retry`, async ({
    page,
  }) => {
    const native = priorTask({
      taskId: `native-${state}`,
      state,
      runtimeFamily: "codex",
      operation: "send_message",
      controlOwner: "native_app",
      targetLabel: "Exact app-owned Codex work",
      targetSessionRef: "opaque-session-ref",
      workingFolder: TARGET_FOLDER,
      canRetry: true,
      deliveryState: "retryable",
      deliveryCanRetry: true,
    });
    await open(page, { tasks: [native] });
    const receipt = page.getByTestId("runtime-task-result-receipt");
    await expect(receipt).toBeVisible();
    await expect(receipt).toContainText(
      state === "awaiting_native"
        ? "Queued in Codex — work is not complete"
        : "Delivery uncertain in Codex",
    );
    await expect(receipt).not.toContainText("Completed with");
    await expect(receipt).not.toContainText("Stopped with");
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Retry", exact: true }),
    ).toHaveCount(0);
    await expect(
      receipt.getByRole("button", { name: "Review task result" }),
    ).toHaveCount(0);
    await expect(
      receipt.getByRole("button", { name: "Retry resident synthesis" }),
    ).toHaveCount(0);
    await expect(
      receipt.getByRole("button", { name: "Retry result summary" }),
    ).toHaveCount(0);
    await expect(receipt).not.toContainText("Resident summary");
    if (state === "awaiting_native") {
      await captureMockState(page, "runtime-task-native-handoff.png");
    }
    await receipt
      .getByRole("button", { name: "Open in Codex", exact: true })
      .click();
    const calls = await page.evaluate(
      () => window.__RUNTIME_TASK_CARD_TEST__?.calls ?? [],
    );
    expect(
      calls
        .filter((call) => call.command === "open_runtime_task_native_session")
        .map((call) => call.payload),
    ).toEqual([{ taskId: native.taskId }]);
    expect(
      calls.filter((call) =>
        [
          "get_runtime_task_result",
          "retry_runtime_task",
          "retry_runtime_task_delivery",
          "cancel_runtime_task",
        ].includes(call.command),
      ),
    ).toEqual([]);
  });
}

for (const state of ["awaiting_native", "interrupted", "failed"] as const) {
  test(`Claude native ${state} never implies completion, synthesis or owned control`, async ({
    page,
  }) => {
    const native = priorTask({
      taskId: `claude-native-${state}`,
      summary: "Exact external Claude follow-up",
      state,
      runtimeFamily: "claude_code",
      operation: "send_message",
      controlOwner: "native_app",
      targetLabel: "Exact native Claude Code work",
      targetSessionRef: "opaque-claude-session-ref",
      workingFolder: TARGET_FOLDER,
      // Even an inconsistent retry/delivery hint must not manufacture
      // ownership or a completed result for an external native session.
      canRetry: true,
      deliveryState: "retryable",
      deliveryCanRetry: true,
    });
    await open(page, { tasks: [native] });
    const receipt = page.getByTestId("runtime-task-result-receipt");
    const label =
      state === "awaiting_native"
        ? "Queued in Claude Code — work is not complete"
        : "Delivery uncertain in Claude Code";
    await expect(receipt).toBeVisible();
    await expect(receipt).toContainText(label);
    await expect(receipt).toContainText(
      "Handle approvals and stopping in Claude Code.",
    );
    if (state !== "awaiting_native") {
      await expect(receipt).toContainText("no automatic retry will run");
    }
    await expect(receipt).not.toContainText("Completed with");
    await expect(receipt).not.toContainText("Stopped with");
    await expect(receipt).not.toContainText("Resident summary");
    await expect(page.locator(".luca-runtime-task-item")).toHaveCount(0);
    for (const name of ["Stop", "Retry", "Open in Codex"]) {
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
        0,
      );
    }
    for (const name of [
      "Review task result",
      "Retry resident synthesis",
      "Retry result summary",
    ]) {
      await expect(receipt.getByRole("button", { name })).toHaveCount(0);
    }
    // The summary button is inert on a handoff: clicking it cannot fetch a
    // result or dispatch manual synthesis under the initiating resident.
    await receipt.getByText(native.summary, { exact: true }).click();
    await expect(receipt).toContainText(label);
    await expect(receipt.locator("pre")).toHaveCount(0);
    const calls = await page.evaluate(
      () => window.__RUNTIME_TASK_CARD_TEST__?.calls ?? [],
    );
    expect(
      calls.filter((call) =>
        [
          "get_runtime_task_result",
          "retry_runtime_task",
          "retry_runtime_task_delivery",
          "cancel_runtime_task",
          "open_runtime_task_native_session",
          "start_runtime_task",
          "send_channel_message",
          "send_message",
        ].includes(call.command),
      ),
    ).toEqual([]);
    expect(
      browserMessages
        .get(page)
        ?.filter((message) => message.kind === "pageerror"),
    ).toEqual([]);
  });
}

for (const [deliveryState, notice] of [
  ["pending_synthesis", "Resident summary queued for this conversation."],
  ["synthesizing", "Preparing the resident summary for this conversation."],
  [
    "prepared",
    "Resident summary prepared; not yet submitted to this conversation.",
  ],
  [
    "submitted",
    "Resident summary submitted; publication is not yet confirmed.",
  ],
  ["published", "Resident summary published in this conversation."],
] as const) {
  test(`a ${deliveryState} summary does not expose the legacy owner-send retry`, async ({
    page,
  }) => {
    await open(page, {
      tasks: [priorTask({ deliveryState, deliveryCanRetry: false })],
    });
    const receipt = page.getByTestId("runtime-task-result-receipt");
    await expect(receipt.getByRole("status")).toHaveText(notice);
    await expect(
      receipt.getByRole("button", { name: "Retry resident synthesis" }),
    ).toHaveCount(0);
    await expect(
      receipt.getByRole("button", { name: "Retry result summary" }),
    ).toHaveCount(0);
    if (deliveryState !== "published") {
      await expect(receipt).not.toContainText("Resident summary published");
    }
    if (deliveryState === "prepared" || deliveryState === "published") {
      await captureMockState(page, `runtime-task-summary-${deliveryState}.png`);
    }
  });
}

test("authorized summary retry only retries delivery for the exact completed task", async ({
  page,
}) => {
  const complete = priorTask({
    deliveryState: "retryable",
    deliveryCanRetry: true,
  });
  await open(page, { tasks: [complete] });
  const receipt = page.getByTestId("runtime-task-result-receipt");
  await expect(receipt).toContainText("Resident summary needs attention");
  await expect(
    receipt.getByRole("button", { name: "Retry resident synthesis" }),
  ).toHaveCount(0);
  await captureMockState(page, "runtime-task-summary-retry.png");
  await receipt.getByRole("button", { name: "Retry result summary" }).click();
  await expect(receipt.getByRole("status")).toHaveText(
    "Resident summary queued for this conversation.",
  );
  await expect(
    receipt.getByRole("button", { name: "Retry result summary" }),
  ).toHaveCount(0);
  const calls = await page.evaluate(
    () => window.__RUNTIME_TASK_CARD_TEST__?.calls ?? [],
  );
  expect(
    calls
      .filter((call) => call.command === "retry_runtime_task_delivery")
      .map((call) => call.payload),
  ).toEqual([{ taskId: complete.taskId }]);
  expect(
    calls.filter((call) =>
      [
        "retry_runtime_task",
        "start_runtime_task",
        "cancel_runtime_task",
        "get_runtime_task_result",
      ].includes(call.command),
    ),
  ).toEqual([]);
  expect(
    calls.some((call) =>
      JSON.stringify(call.payload).includes("Please synthesize the completed"),
    ),
  ).toBe(false);
});

test("summary retry uses its command receipt even when the event is missed", async ({
  page,
}) => {
  const complete = priorTask({
    deliveryState: "retryable",
    deliveryCanRetry: true,
  });
  await open(page, { tasks: [complete], suppressDeliveryEvents: true });
  const receipt = page.getByTestId("runtime-task-result-receipt");
  await receipt.getByRole("button", { name: "Retry result summary" }).click();
  await expect(receipt.getByRole("status")).toHaveText(
    "Resident summary queued for this conversation.",
  );
  await expect(
    receipt.getByRole("button", { name: "Retry result summary" }),
  ).toHaveCount(0);
  const calls = await page.evaluate(
    () => window.__RUNTIME_TASK_CARD_TEST__?.calls ?? [],
  );
  expect(
    calls.filter((call) => call.command === "retry_runtime_task_delivery"),
  ).toHaveLength(1);
  expect(
    calls.filter(
      (call) =>
        call.command === "start_runtime_task" ||
        call.command === "retry_runtime_task",
    ),
  ).toEqual([]);
});

test("a result summary cannot retry without native delivery authority", async ({
  page,
}) => {
  await open(page, {
    tasks: [priorTask({ deliveryState: "retryable", deliveryCanRetry: false })],
  });
  const receipt = page.getByTestId("runtime-task-result-receipt");
  await expect(receipt).toContainText("Resident summary needs attention");
  await expect(
    receipt.getByRole("button", { name: "Retry result summary" }),
  ).toHaveCount(0);
  await expect(
    receipt.getByRole("button", { name: "Retry resident synthesis" }),
  ).toHaveCount(0);
});

test("a legacy receipt retains its explicit manual resident synthesis action", async ({
  page,
}) => {
  await open(page, { tasks: [priorTask()] });
  const receipt = page.getByTestId("runtime-task-result-receipt");
  await expect(
    receipt.getByRole("button", { name: "Retry resident synthesis" }),
  ).toBeEnabled();
  await expect(
    receipt.getByRole("button", { name: "Retry result summary" }),
  ).toHaveCount(0);
  await expect(receipt.getByRole("status")).toHaveCount(0);
});

for (const action of ["summary", "native session"] as const) {
  test(`a pending ${action} action stays with its own task receipt`, async ({
    page,
  }) => {
    const overrides: Partial<RuntimeTaskProjection> =
      action === "summary"
        ? { deliveryState: "retryable", deliveryCanRetry: true }
        : {
            runtimeFamily: "codex",
            operation: "send_message",
            controlOwner: "native_app",
            state: "awaiting_native",
          };
    const first = priorTask({
      ...overrides,
      taskId: `pending-${action}-first`,
      summary: "First action receipt.",
      startedAt: "2026-09-01T00:00:02Z",
    });
    const second = priorTask({
      ...overrides,
      taskId: `pending-${action}-second`,
      summary: "Second action receipt.",
    });
    await open(page, {
      tasks: [first, second],
      heldReceiptActions: [first.taskId, second.taskId],
      suppressDeliveryEvents: true,
    });
    const receipt = page.getByTestId("runtime-task-result-receipt");
    const button = receipt.getByRole("button", {
      name: action === "summary" ? "Retry result summary" : "Open in Codex",
      exact: true,
    });
    await expect(receipt).toContainText(first.summary);
    await button.click();
    await page.waitForFunction(
      (id) =>
        Boolean(window.__RUNTIME_TASK_CARD_TEST__?.pendingReceiptActions[id]),
      first.taskId,
    );
    await receipt.getByRole("button", { name: "Dismiss task receipt" }).click();
    await expect(receipt).toContainText(second.summary);
    await expect(button).toBeEnabled();
    await button.click();
    await page.waitForFunction(
      (id) =>
        Boolean(window.__RUNTIME_TASK_CARD_TEST__?.pendingReceiptActions[id]),
      second.taskId,
    );
    await page.evaluate((id) => {
      window.__RUNTIME_TASK_CARD_TEST__?.pendingReceiptActions[id]?.();
    }, first.taskId);
    await page.waitForFunction(
      () => window.__RUNTIME_TASK_CARD_TEST__?.completedReceiptActions === 1,
    );
    // The old task's completion must not clear the new task's busy state.
    const pending = receipt.getByRole("button", {
      name: action === "summary" ? "Retry result summary" : "Opening…",
      exact: true,
    });
    await expect(pending).toBeDisabled();
    await page.evaluate((id) => {
      window.__RUNTIME_TASK_CARD_TEST__?.pendingReceiptActions[id]?.();
    }, second.taskId);
    await page.waitForFunction(
      () => window.__RUNTIME_TASK_CARD_TEST__?.completedReceiptActions === 2,
    );
    if (action === "native session") await expect(button).toBeEnabled();
    else await expect(receipt).toContainText("Resident summary queued");
  });
}

test("a late raw result cannot cross from a dismissed receipt into another task", async ({
  page,
}) => {
  const first = priorTask({
    taskId: "result-first",
    summary: "First result receipt.",
    startedAt: "2026-09-01T00:00:02Z",
  });
  const second = priorTask({
    taskId: "result-second",
    summary: "Second result receipt.",
  });
  await open(page, {
    tasks: [first, second],
    heldResultTaskIds: [first.taskId],
    resultBodies: {
      [first.taskId]: "PRIVATE_FIRST_RESULT",
      [second.taskId]: "EXACT_SECOND_RESULT",
    },
  });
  const receipt = page.getByTestId("runtime-task-result-receipt");
  await expect(receipt).toContainText(first.summary);
  await receipt
    .getByRole("button", { name: "Review task result", exact: true })
    .click();
  await page.waitForFunction(
    (id) =>
      Boolean(window.__RUNTIME_TASK_CARD_TEST__?.pendingResultResolvers[id]),
    first.taskId,
  );
  await receipt
    .getByRole("button", { name: "Dismiss task receipt", exact: true })
    .click();
  await expect(receipt).toContainText(second.summary);
  await receipt
    .getByRole("button", { name: "Review task result", exact: true })
    .click();
  await expect(receipt).toContainText("EXACT_SECOND_RESULT");
  await page.evaluate(async (id) => {
    window.__RUNTIME_TASK_CARD_TEST__?.pendingResultResolvers[id]?.();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }, first.taskId);
  await page.waitForFunction(
    () => window.__RUNTIME_TASK_CARD_TEST__?.completedResultCalls === 2,
  );
  await expect(receipt).toContainText("EXACT_SECOND_RESULT");
  await expect(receipt).not.toContainText("PRIVATE_FIRST_RESULT");
});

for (const invalid of ["task_id", "completion_state"] as const) {
  test(`raw result rejects an uncorrelated ${invalid} reply`, async ({
    page,
  }) => {
    const task = priorTask({
      taskId: `invalid-result-${invalid}`,
      summary: "Exact raw-result fixture.",
    });
    await open(page, {
      tasks: [task],
      resultBodies: { [task.taskId]: "UNVERIFIED_RESULT_BODY" },
      resultTaskIdOverrides:
        invalid === "task_id" ? { [task.taskId]: "different-task" } : {},
      resultStateOverrides:
        invalid === "completion_state" ? { [task.taskId]: "failed" } : {},
    });
    const receipt = page.getByTestId("runtime-task-result-receipt");
    await receipt
      .getByRole("button", { name: "Review task result", exact: true })
      .click();
    await expect(receipt.getByRole("alert")).toHaveText(
      "The task result could not be verified.",
    );
    await expect(receipt).not.toContainText("UNVERIFIED_RESULT_BODY");
  });
}

function activeOwnedTask() {
  return priorTask({
    taskId: "exact-stop-fixture",
    runtimeFamily: "codex",
    controlOwner: "polyphonic",
    operation: "new_task",
    summary: "Exact owned Stop fixture.",
    state: "active",
    currentStep: "Working in exact Stop fixture",
    completedAt: null,
  });
}

test("an accepted Stop merges its exact receipt even when the native event is missed", async ({
  page,
}) => {
  const task = activeOwnedTask();
  await open(page, { tasks: [task], suppressStopEvents: true });
  const item = page.locator(".luca-runtime-task-item");
  await item.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(item).toHaveAttribute("data-activity-state", "stopping");
  await expect(item).toContainText("Stopping task");
  const stoppedIds = await page.evaluate(() =>
    window.__RUNTIME_TASK_CARD_TEST__?.calls
      .filter((call) => call.command === "cancel_runtime_task")
      .map((call) => (call.payload as { taskId: string }).taskId),
  );
  expect(stoppedIds).toEqual([task.taskId]);
});

test("a rejected Stop is visible and does not invent a stopped state", async ({
  page,
}) => {
  await open(page, {
    tasks: [activeOwnedTask()],
    stopError: "Owner authority changed; nothing was stopped.",
  });
  const item = page.locator(".luca-runtime-task-item");
  await item.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    page.getByText("Owner authority changed; nothing was stopped.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(item).toHaveAttribute("data-activity-state", "active");
  await expect(
    item.getByRole("button", { name: "Stop", exact: true }),
  ).toBeEnabled();
  expect(
    browserMessages
      .get(page)
      ?.filter((message) => message.kind === "pageerror"),
  ).toEqual([]);
});

test("a Stop reply for another task cannot update the requested task", async ({
  page,
}) => {
  await open(page, {
    tasks: [activeOwnedTask()],
    suppressStopEvents: true,
    stopReplyTaskId: "wrong-task",
  });
  const item = page.locator(".luca-runtime-task-item");
  await item.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    page.getByText("The task stop receipt could not be verified.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(item).toHaveAttribute("data-activity-state", "active");
});

test("an in-flight Stop cannot be dispatched twice", async ({ page }) => {
  await open(page, {
    tasks: [activeOwnedTask()],
    holdStops: true,
    suppressStopEvents: true,
  });
  const button = page
    .locator(".luca-runtime-task-item")
    .getByRole("button", { name: "Stop", exact: true });
  await button.click();
  await expect(button).toBeDisabled();
  await button.evaluate((element: HTMLButtonElement) => element.click());
  await page.waitForFunction(
    () =>
      (window.__RUNTIME_TASK_CARD_TEST__?.pendingStopResolvers.length ?? 0) ===
      1,
  );
  expect(
    await page.evaluate(
      () =>
        window.__RUNTIME_TASK_CARD_TEST__?.calls.filter(
          (call) => call.command === "cancel_runtime_task",
        ).length,
    ),
  ).toBe(1);
  await page.evaluate(() => {
    for (const resolve of window.__RUNTIME_TASK_CARD_TEST__?.pendingStopResolvers.splice(
      0,
    ) ?? [])
      resolve();
  });
  await expect(page.locator(".luca-runtime-task-item")).toHaveAttribute(
    "data-activity-state",
    "stopping",
  );
});

test("a newer terminal event wins over a late accepted Stop command receipt", async ({
  page,
}) => {
  const task = activeOwnedTask();
  await open(page, {
    tasks: [task],
    holdStops: true,
    suppressStopEvents: true,
  });
  await page
    .locator(".luca-runtime-task-item")
    .getByRole("button", { name: "Stop", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      (window.__RUNTIME_TASK_CARD_TEST__?.pendingStopResolvers.length ?? 0) ===
      1,
  );
  await page.evaluate((task) => {
    const state = window.__RUNTIME_TASK_CARD_TEST__;
    if (!state) throw new Error("No exact Stop boundary.");
    const terminal: RuntimeTaskProjection = {
      ...task,
      state: "stopped",
      currentStep: null,
      completedAt: "2026-09-01T00:01:02Z",
      updatedAt: "2026-09-01T00:01:02Z",
    };
    state.tasks = [terminal];
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://runtime-task", terminal);
    for (const resolve of state.pendingStopResolvers.splice(0)) resolve();
  }, task);
  await page.waitForFunction(
    () => window.__RUNTIME_TASK_CARD_TEST__?.completedStopCalls === 1,
  );
  await expect(page.locator(".luca-runtime-task-item")).toHaveCount(0);
  if (await page.locator("html[data-luca-frame]").count()) {
    // An acknowledged Stop settles quietly in the home, but the real receipt
    // is still available in history. The late command must not revive it.
    await expect(page.getByTestId("runtime-task-result-receipt")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("runtime-task-notice")).toHaveCount(0);
    await page.evaluate((id) => {
      window.location.hash = `#/apps/codex/tasks/${id}`;
    }, task.taskId);
    const history = page.getByTestId("app-task-card");
    await expect(history).toContainText(task.summary);
    await expect(history.getByText(/· stopped$/i)).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          window.__RUNTIME_TASK_CARD_TEST__?.calls.filter(
            (call) => call.command === "cancel_runtime_task",
          ).length,
      ),
    ).toBe(1);
  } else {
    await expect(page.getByTestId("runtime-task-result-receipt")).toContainText(
      "Stopped with Codex",
    );
  }
});

test("a subscribed event survives an older list backfill and a stale update", async ({
  page,
}) => {
  const older = priorTask({
    state: "active",
    runtimeFamily: "codex",
    controlOwner: "native_app",
  });
  await open(page, { tasks: [older], holdLists: true });
  const acknowledged = {
    ...older,
    state: "awaiting_native" as const,
    updatedAt: "2026-10-04T12:00:00Z",
  };
  await page.evaluate((task) => {
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://runtime-task", task);
  }, acknowledged);
  const receipt = page.getByTestId("runtime-task-result-receipt");
  await expect(receipt).toContainText("Queued in Codex — work is not complete");
  await releaseLists(page);
  await page.evaluate((task) => {
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://runtime-task", task);
  }, older);
  await expect(receipt).toContainText("Queued in Codex — work is not complete");
});

test("a resolved proposal is not resurrected by an in-flight list", async ({
  page,
}) => {
  const request = proposal();
  await open(page, { proposals: [request], holdLists: true });
  const card = await raise(page, request);
  await card.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(card).toHaveCount(0);
  await releaseLists(page);
  await expect(card).toHaveCount(0);
  expect(await responses(page)).toEqual([
    { proposalId: request.proposalId, approved: false },
  ]);
});
