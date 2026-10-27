import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";
import { railGlassAtRest } from "./flagOffSettle";

/**
 * WP-35, an app's task, as the work (docs/luca/BETA14_RELEASE.md): a task
 * row under an app in the Chats rail opens the task's page in the card,
 * live or finished. The head (the app's mark, its name, the summary, who it
 * is for, where, and when), Now with its breathing dot (still under Reduce
 * Motion), the steps as a thread, what came back (the result, or the error
 * and Try again), and what passed between whoever sent it and the app. The
 * page follows the task live into its finished state. The handoff to the
 * app's own session and the retry are spied on the bridge. Plus WP-35's
 * three additions: Settings › Agents says Apps; New conversation with Luca
 * alone lands in Luca's one chat; a finished task opens the same page.
 * Classic layout (the flag off) is compared by hash with WP35_BASE_URL.
 * Screenshots land in WP35_SHOTS, measurements in WP35_SHOTS/measures.
 */

const SHOTS = process.env.WP35_SHOTS ?? "test-results/shell-app-task";
const BASE_URL = process.env.WP35_BASE_URL ?? "http://127.0.0.1:4300";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const CODEX_SESSION = "0f8b2a5c-6d1e-4c3b-9a7f-2e5d8c1b4a90";
const STUDIO = "/synthetic/projects/studio";

const NOW = Date.now();
const iso = (minutesAgo: number) =>
  new Date(NOW - minutesAgo * 60_000).toISOString();

type Mode = "dark" | "light";
type Step = { label: string; state: "queued" | "active" | "done" | "failed" };
type Task = Record<string, unknown> & {
  taskId: string;
  state: string;
  steps: Step[];
  updatedAt: string;
};

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

const shotHashes: Record<string, string> = {};

async function shot(
  page: Page,
  name: string,
  { still = false }: { still?: boolean } = {},
) {
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({
    path,
    ...(still
      ? {
          animations: "disabled" as const,
          mask: [page.locator("[data-flagoff-mask]")],
        }
      : {}),
  });
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  shotHashes[name] = hash;
  return hash;
}

/** How many colours a shot holds (a blank one proves nothing). */
async function colorsOf(page: Page, name: string) {
  const data = readFileSync(`${SHOTS}/${name}.png`).toString("base64");
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const small = document.createElement("canvas");
    small.width = 120;
    small.height = 75;
    small.getContext("2d")?.drawImage(image, 0, 0, 120, 75);
    const sample = small.getContext("2d")?.getImageData(0, 0, 120, 75).data;
    const seen = new Set<number>();
    for (let index = 0; sample && index < sample.length; index += 4)
      seen.add(
        ((sample[index] >> 3) << 10) |
          ((sample[index + 1] >> 3) << 5) |
          (sample[index + 2] >> 3),
      );
    return seen.size;
  }, data);
}

test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1440, height: 900 },
});
test.describe.configure({ timeout: 300_000 });

const AGENTS = [
  { name: "Luca", pubkey: LUCA, personaId: "builtin:fizz", status: "running" },
  { name: "Atlas", pubkey: ATLAS, status: "running" },
] as const;

function projection(task: Partial<Task> & Pick<Task, "taskId">): Task {
  return {
    canRetry: false,
    completedAt: null,
    completedSteps: 0,
    controlOwner: "polyphonic",
    conversationId: GENERAL,
    currentStep: null,
    deliveryCanRetry: false,
    deliveryState: null,
    error: null,
    operation: "new_task",
    permissionMode: "normal",
    providerSessionId: null,
    residentPubkey: LUCA,
    retryOfTaskId: null,
    runtimeFamily: "claude_code",
    startedAt: iso(10),
    state: "active",
    steps: [],
    summary: "",
    targetLabel: null,
    targetSessionRef: null,
    updatedAt: iso(1),
    workingFolder: `${STUDIO}/desktop`,
    ...task,
  } as Task;
}

/** Claude Code at work for Luca in the Studio project; done for Luca a
 *  while ago; failed for Atlas, and can be tried again; and a Codex chat
 *  that a send left behind, with its own session to open. */
const TASKS: Task[] = [
  projection({
    currentStep: "Running the rail's glass spec",
    completedSteps: 2,
    startedAt: iso(12),
    steps: [
      { label: "Read ShellRail.tsx and shell-rail.css", state: "done" },
      { label: "Set the plates' tone by night and by day", state: "done" },
      { label: "Running the rail's glass spec", state: "active" },
      { label: "Commit the change", state: "queued" },
    ],
    summary: "Rail glass plates",
    taskId: "task-glass",
    updatedAt: iso(1),
  }),
  projection({
    completedAt: iso(160),
    completedSteps: 3,
    startedAt: iso(180),
    state: "succeeded",
    steps: [
      { label: "Ran the build", state: "done" },
      { label: "Fixed the missing import in AppShell.tsx", state: "done" },
      { label: "Ran the build again", state: "done" },
    ],
    summary: "Fix the failing build",
    taskId: "task-build",
    updatedAt: iso(160),
    workingFolder: "/synthetic/scratch/build-check",
  }),
  projection({
    canRetry: true,
    completedAt: iso(40),
    completedSteps: 1,
    error: "Two of 48 tests failed in release.spec.ts.",
    residentPubkey: ATLAS,
    startedAt: iso(55),
    state: "failed",
    steps: [
      { label: "Ran the release script with --dry-run", state: "done" },
      { label: "Ran the release tests", state: "failed" },
    ],
    summary: "Release script check",
    taskId: "task-release",
    updatedAt: iso(40),
  }),
  projection({
    controlOwner: "native_app",
    operation: "send_message",
    providerSessionId: CODEX_SESSION,
    runtimeFamily: "codex",
    startedAt: iso(30),
    state: "awaiting_native",
    summary: "Tidy the landing page copy",
    targetLabel: "Landing copy",
    taskId: "task-codex",
    updatedAt: iso(30),
  }),
];

const RESULTS: Record<string, string> = {
  "task-build":
    "The build passes again. AppShell.tsx imported ShellLip from its old path; it now imports it from app/shell.",
  "task-glass":
    "The rail's glass spec passes: 14 of 14. The plates are a step above the card by night and by day.",
};

/** The bridge's runtime-task commands, answered from the tasks above, and
 *  every call recorded (the spy): the handoff, the retry, the result. */
async function installTaskBridge(page: Page) {
  await page.addInitScript(
    ({ tasks, results, studio }) => {
      type Invoke = (
        command: string,
        payload?: unknown,
        options?: unknown,
      ) => Promise<unknown>;
      const state = {
        calls: [] as Array<{ command: string; payload: unknown }>,
        results: results as Record<string, string>,
        tasks: structuredClone(tasks) as Array<Record<string, unknown>>,
      };
      (window as unknown as { __WP35__: typeof state }).__WP35__ = state;
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
          async (command: string, payload?: unknown, options?: unknown) => {
            const id = (payload as { taskId?: string } | null)?.taskId;
            if (
              /runtime_task|resolve_runtime_task_project_folder/.test(command)
            )
              state.calls.push({
                command,
                payload: structuredClone(payload ?? null),
              });
            if (command === "list_all_runtime_tasks")
              return structuredClone(state.tasks);
            if (command === "list_runtime_tasks") {
              const room = (payload as { conversationId?: string } | null)
                ?.conversationId;
              return structuredClone(
                state.tasks.filter((task) => task.conversationId === room),
              );
            }
            if (command === "get_runtime_task_result") {
              const task = state.tasks.find((each) => each.taskId === id);
              return {
                error: null,
                result: id ? (state.results[id] ?? null) : null,
                state: task?.state ?? "failed",
                taskId: id,
              };
            }
            if (command === "open_runtime_task_native_session") return null;
            if (command === "retry_runtime_task") {
              const failed = state.tasks.find((each) => each.taskId === id);
              if (!failed?.canRetry) throw new Error("Not retryable.");
              const next = {
                ...failed,
                canRetry: false,
                completedAt: null,
                completedSteps: 0,
                currentStep: "Running the release script",
                error: null,
                retryOfTaskId: id,
                startedAt: new Date().toISOString(),
                state: "active",
                steps: [
                  { label: "Running the release script", state: "active" },
                ],
                taskId: `${id}-again`,
                updatedAt: new Date().toISOString(),
              };
              state.tasks.unshift(next);
              return structuredClone(next);
            }
            if (command === "resolve_runtime_task_project_folder")
              return studio;
            if (!realInvoke) throw new Error("The mock bridge is not ready.");
            return realInvoke(command, payload, options);
          },
      });
    },
    { results: RESULTS, studio: STUDIO, tasks: TASKS },
  );
}

/** A project whose sources resolve to the Studio folder. */
async function seedProject(page: Page) {
  await page.evaluate(async () => {
    const community = (
      JSON.parse(window.localStorage.getItem("buzz-communities") ?? "[]") as {
        pubkey: string;
        relayUrl: string;
      }[]
    )[0];
    if (!community) throw new Error("Expected the seeded community.");
    const scope = (value: string) =>
      encodeURIComponent(value.trim().toLowerCase());
    window.localStorage.setItem(
      `luca-room-projects.v1:${scope(community.pubkey)}:${scope(community.relayUrl)}`,
      JSON.stringify({
        assignments: {},
        projects: [
          { id: "studio", label: "Studio", sourceIds: ["src-studio"] },
        ],
        version: 1,
      }),
    );
    window.dispatchEvent(new Event("luca:room-projects-changed"));
    await (
      window as unknown as {
        __BUZZ_E2E_QUERY_CLIENT__?: { invalidateQueries: () => Promise<void> };
      }
    ).__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries();
  });
}

async function boot(
  page: Page,
  {
    hash,
    mode = "dark",
    origin,
    shell = true,
    tasks = true,
  }: {
    hash: string;
    mode?: Mode;
    origin?: string;
    shell?: boolean;
    tasks?: boolean;
  },
) {
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      console.log("BROWSER ERROR", message.text());
  });
  if (tasks) await installTaskBridge(page);
  await installMockBridge(page, {
    managedAgents: AGENTS.map((agent) => ({ ...agent })),
  });
  await page.addInitScript(
    ({ key, light, on }) => {
      let overrides: Record<string, boolean> = {};
      try {
        overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        overrides = {};
      }
      overrides["shell-frame"] = on;
      localStorage.setItem(key, JSON.stringify(overrides));
      if (light) {
        localStorage.setItem("buzz-theme", "paper");
        localStorage.setItem("buzz-follow-system", "false");
      }
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, light: mode === "light", on: shell },
  );
  await expect(async () => {
    await page.goto(`${origin ?? ""}/#${hash}`);
    await expect(
      page
        .locator(
          "[data-testid='app-sidebar'], [data-testid='settings-content-scroll']",
        )
        .first(),
    ).toBeVisible({ timeout: 20_000 });
  }).toPass({ timeout: 60_000 });
  if (tasks && shell) await seedProject(page);
}

/** What the page says, read from the DOM. */
async function readPage(page: Page) {
  return page.getByTestId("app-task-card").evaluate((card) => {
    const text = (selector: string) =>
      card.querySelector(selector)?.textContent?.trim() ?? null;
    const head = card.querySelector('[data-testid="place-page-head"]');
    const nowLine = card.querySelector<HTMLElement>(".luca-app-task-now");
    const dot = nowLine ? getComputedStyle(nowLine, "::before") : null;
    const steps = [
      ...card.querySelectorAll<HTMLElement>(
        '[data-testid="app-task-steps"] .luca-place-row',
      ),
    ].map((row) => ({
      glyph: row
        .querySelector(".luca-place-row-face svg")
        ?.getAttribute("aria-label"),
      state: row.dataset.stepState,
      title: row.querySelector(".luca-place-row-title")?.textContent,
    }));
    const between = [
      ...card.querySelectorAll<HTMLElement>(
        '[data-testid="app-task-between"] .luca-place-row',
      ),
    ].map((row) => ({
      detail: row.querySelector(".luca-place-row-detail")?.textContent,
      face: row.querySelector(".luca-agent-mark")
        ? "agent-mark"
        : row.querySelector(
              ".luca-place-row-face svg, .luca-place-row-face img",
            )
          ? "app-mark"
          : null,
      note: row.querySelector(".luca-place-row-note")?.textContent,
      title: row.querySelector(".luca-place-row-title")?.textContent,
    }));
    // The thread runs under the steps' faces: its x against the face's
    // centre.
    const firstStep = card.querySelector<HTMLElement>(
      '[data-testid="app-task-steps"] .luca-place-row',
    );
    const face = firstStep
      ?.querySelector(".luca-place-row-face")
      ?.getBoundingClientRect();
    const line = firstStep ? getComputedStyle(firstStep, "::after") : null;
    const threadX =
      firstStep && line && face
        ? firstStep.getBoundingClientRect().left +
          Number.parseFloat(line.left) +
          Number.parseFloat(line.width) / 2 -
          (face.left + face.width / 2)
        : null;
    return {
      action: text('[data-testid="app-task-open-native"]'),
      betweenLabel: text('[data-testid="app-task-between"] h2'),
      between,
      cameBack: text(".luca-app-task-came-back-text"),
      cameBackLabel: text('[data-testid="app-task-came-back"] h2'),
      dot: dot
        ? {
            animation: dot.animationName,
            content: dot.content,
            opacity: dot.opacity,
          }
        : null,
      eyebrow: head
        ?.querySelector(".luca-place-page-eyebrow")
        ?.textContent?.trim(),
      faceTile: Boolean(
        head?.querySelector(
          '[data-testid="place-page-face"] img, [data-testid="place-page-face"] svg',
        ),
      ),
      name: text(".luca-place-page-name"),
      now: nowLine?.textContent?.trim() ?? null,
      retry: text('[data-testid="app-task-retry"]'),
      state: text('[data-testid="place-page-state"]'),
      steps,
      stepsCount: text(
        '[data-testid="app-task-steps"] .luca-place-section-count',
      ),
      threadX,
    };
  });
}

async function openTask(page: Page, taskId: string) {
  const row = page
    .getByTestId("chat-list")
    .getByTestId(`rail-side-task:${taskId}`);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByTestId("app-task-card")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator(".luca-place-page-name")).toBeVisible({
    timeout: 20_000,
  });
}

const calls = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __WP35__: { calls: Array<{ command: string; payload: unknown }> };
        }
      ).__WP35__.calls,
  );

for (const mode of ["dark", "light"] as const) {
  const when = mode === "dark" ? "night" : "day";
  test(`a live, a finished and a failed task by ${when}`, async ({ page }) => {
    await boot(page, { hash: `/channels/${GENERAL}`, mode });
    const out: Record<string, unknown> = {};

    // Live: opened from its row under Claude Code.
    await openTask(page, "task-glass");
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toContain("/apps/claude/tasks/task-glass");
    await expect(page.getByTestId("place-page-state")).toContainText("Studio", {
      timeout: 20_000,
    });
    const rail = page.getByTestId("chat-list");
    await expect(rail.getByTestId("rail-side-task:task-glass")).toHaveAttribute(
      "data-current",
      "true",
    );
    await expect(page.getByTestId("rail-home-app:claude")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(page.getByTestId("shell-lip")).toContainText(
      /Claude Code\s*\/\s*Rail glass plates/,
    );
    const live = await readPage(page);
    out.live = live;
    expect(live.eyebrow).toBe("Claude Code");
    expect(live.name).toBe("Rail glass plates");
    expect(live.faceTile).toBe(true);
    expect(live.state).toMatch(/^For Luca · Studio · working since \S/);
    expect(live.action).toBeNull();
    expect(live.now).toBe("Running the rail's glass spec");
    expect(live.dot?.animation).toBe("luca-app-task-breathe");
    expect(live.stepsCount).toBe("4");
    expect(live.steps.map((step) => step.glyph)).toEqual([
      "Done",
      "Done",
      "Working",
      "Queued",
    ]);
    expect(live.threadX).toBe(0);
    expect(live.cameBack).toBeNull();
    expect(live.betweenLabel).toBe("Between Luca and Claude Code");
    expect(live.between).toHaveLength(1);
    expect(live.between[0]).toMatchObject({
      detail: "Luca",
      face: "agent-mark",
      title: "Rail glass plates",
    });
    await shot(page, `task-live-${when}`);

    // Finished: its row under Claude Code opens the same page, finished.
    await openTask(page, "task-build");
    await expect(page.locator(".luca-app-task-came-back-text")).toBeVisible({
      timeout: 20_000,
    });
    const done = await readPage(page);
    out.finished = done;
    expect(done.name).toBe("Fix the failing build");
    expect(done.state).toMatch(/^For Luca · build-check · finished \S/);
    expect(done.now).toBeNull();
    expect(done.steps.every((step) => step.glyph === "Done")).toBe(true);
    expect(done.cameBackLabel).toBe("What came back");
    expect(done.cameBack).toBe(RESULTS["task-build"]);
    expect(done.retry).toBeNull();
    expect(done.between.map((row) => row.face)).toEqual([
      "agent-mark",
      "app-mark",
    ]);
    expect(done.between[1]?.detail).toBe("Claude Code");
    await expect(rail.getByTestId("rail-side-task:task-build")).toHaveAttribute(
      "data-current",
      "true",
    );
    await shot(page, `task-finished-${when}`);

    // Failed, for Atlas: the error, and Try again.
    await page.evaluate(() => {
      window.location.hash = "#/apps/claude/tasks/task-release";
    });
    await expect(page.getByTestId("app-task-retry")).toBeVisible({
      timeout: 20_000,
    });
    const failed = await readPage(page);
    out.failed = failed;
    expect(failed.state).toBe("For Atlas · Studio · failed");
    expect(failed.steps.map((step) => step.glyph)).toEqual(["Done", "Failed"]);
    expect(failed.cameBack).toBe("Two of 48 tests failed in release.spec.ts.");
    expect(failed.retry).toBe("Try again");
    expect(failed.betweenLabel).toBe("Between Atlas and Claude Code");
    await shot(page, `task-failed-${when}`);
    measure(`pages-${when}`, out);
  });
}

test("the page follows the task live into its finished state", async ({
  page,
}) => {
  await boot(page, { hash: "/apps/claude/tasks/task-glass" });
  await expect(page.locator(".luca-app-task-now")).toHaveText(
    "Running the rail's glass spec",
    { timeout: 20_000 },
  );
  // A marker that a reload would clear.
  await page.evaluate(() => {
    (window as unknown as { __wp35Stayed?: boolean }).__wp35Stayed = true;
  });
  const emit = (patch: Record<string, unknown>) =>
    page.evaluate(
      ({ patch }) => {
        const state = (
          window as unknown as {
            __WP35__: { tasks: Array<Record<string, unknown>> };
          }
        ).__WP35__;
        const index = state.tasks.findIndex(
          (task) => task.taskId === "task-glass",
        );
        const next = {
          ...state.tasks[index],
          ...patch,
          updatedAt: new Date().toISOString(),
        };
        state.tasks[index] = next;
        window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://runtime-task", next);
      },
      { patch },
    );
  await emit({
    completedSteps: 3,
    currentStep: "Commit the change",
    steps: [
      { label: "Read ShellRail.tsx and shell-rail.css", state: "done" },
      { label: "Set the plates' tone by night and by day", state: "done" },
      { label: "Ran the rail's glass spec", state: "done" },
      { label: "Commit the change", state: "active" },
    ],
  });
  await expect(page.locator(".luca-app-task-now")).toHaveText(
    "Commit the change",
  );
  const mid = await readPage(page);
  expect(mid.steps.map((step) => step.glyph)).toEqual([
    "Done",
    "Done",
    "Done",
    "Working",
  ]);
  await emit({
    completedAt: new Date().toISOString(),
    completedSteps: 4,
    currentStep: null,
    state: "succeeded",
    steps: [
      { label: "Read ShellRail.tsx and shell-rail.css", state: "done" },
      { label: "Set the plates' tone by night and by day", state: "done" },
      { label: "Ran the rail's glass spec", state: "done" },
      { label: "Committed the change", state: "done" },
    ],
  });
  await expect(page.locator(".luca-app-task-came-back-text")).toHaveText(
    RESULTS["task-glass"],
    { timeout: 20_000 },
  );
  const after = await readPage(page);
  measure("live", { after, mid });
  expect(after.now).toBeNull();
  expect(after.state).toMatch(/finished \S/);
  expect(
    await page.evaluate(
      () => (window as unknown as { __wp35Stayed?: boolean }).__wp35Stayed,
    ),
  ).toBe(true);
  // The rail moves on with it: the row no longer says working.
  await expect(
    page.getByTestId("chat-list").getByTestId("rail-side-task:task-glass"),
  ).not.toContainText("working");
  await shot(page, "task-live-then-finished-night");
});

test("Open in Codex hands off to the app's own session", async ({ page }) => {
  await boot(page, { hash: `/channels/${GENERAL}` });
  await openTask(page, "task-codex");
  const button = page.getByTestId("app-task-open-native");
  await expect(button).toHaveText("Open in Codex");
  const head = await readPage(page);
  expect(head.eyebrow).toBe("Codex");
  expect(head.state).toBe("For Luca · Studio · in the app");
  await shot(page, "task-codex-handoff-night");
  await button.click();
  await expect
    .poll(async () =>
      (await calls(page)).filter(
        (call) => call.command === "open_runtime_task_native_session",
      ),
    )
    .toEqual([
      {
        command: "open_runtime_task_native_session",
        payload: { taskId: "task-codex" },
      },
    ]);
  // A Claude Code task carries no session to open: no action.
  await openTask(page, "task-glass");
  await expect(page.getByTestId("app-task-open-native")).toHaveCount(0);
  measure("open_in_app", {
    calls: (await calls(page)).filter((call) =>
      call.command.startsWith("open_runtime"),
    ),
    codexHead: head,
  });
});

test("Try again runs the existing retry, and the page follows the new run", async ({
  page,
}) => {
  await boot(page, { hash: "/apps/claude/tasks/task-release" });
  const retry = page.getByTestId("app-task-retry");
  await expect(retry).toBeVisible({ timeout: 20_000 });
  await retry.click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain("/apps/claude/tasks/task-release-again");
  await expect(page.locator(".luca-app-task-now")).toHaveText(
    "Running the release script",
    { timeout: 20_000 },
  );
  const retried = (await calls(page)).filter(
    (call) => call.command === "retry_runtime_task",
  );
  expect(retried).toEqual([
    { command: "retry_runtime_task", payload: { taskId: "task-release" } },
  ]);
  await expect(
    page
      .getByTestId("chat-list")
      .getByTestId("rail-side-task:task-release-again"),
  ).toHaveAttribute("data-current", "true", { timeout: 20_000 });
  measure("retry", { calls: retried, page: await readPage(page) });
  await shot(page, "task-retried-night");
});

test("Reduce Motion holds the dot still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await boot(page, { hash: "/apps/claude/tasks/task-glass" });
  await expect(page.locator(".luca-app-task-now")).toBeVisible({
    timeout: 20_000,
  });
  const sample = () =>
    page.locator(".luca-app-task-now").evaluate((line) => {
      const dot = getComputedStyle(line, "::before");
      return {
        animation: dot.animationName,
        opacity: dot.opacity,
        running: line.getAnimations({ subtree: true }).length,
      };
    });
  const first = await sample();
  await page.waitForTimeout(1200);
  const second = await sample();
  measure("reduce_motion", { first, second });
  expect(first.animation).toBe("none");
  expect(first.opacity).toBe("1");
  expect(second).toEqual(first);
  await shot(page, "task-live-reduce-motion-night");
});

/** The task page as every way in lands on it: the address, the lip, the
 *  task's row lit under its app, and the app's row holding the glass. */
async function landedOnTask(page: Page, taskId: string, summary: string) {
  await expect
    .poll(() => page.evaluate(() => window.location.hash), { timeout: 20_000 })
    .toContain(`/apps/claude/tasks/${taskId}`);
  await expect(page.getByTestId("app-task-card")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator(".luca-place-page-name")).toHaveText(summary);
  await expect(page.getByTestId("shell-lip")).toContainText(
    new RegExp(`Claude Code\\s*/\\s*${summary}`),
  );
  await expect(
    page.getByTestId("chat-list").getByTestId(`rail-side-task:${taskId}`),
  ).toHaveAttribute("data-current", "true", { timeout: 20_000 });
  await expect(page.getByTestId("rail-home-app:claude")).toHaveAttribute(
    "data-active",
    "true",
  );
}

test("All activity's task rows open the task's page", async ({ page }) => {
  await boot(page, { hash: "/pulse?stream=all" });
  const row = page.getByTestId("all-activity-task:task-glass");
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.locator(".luca-place-row-open").click();
  await landedOnTask(page, "task-glass", "Rail glass plates");
  await expect(page.locator(".luca-app-task-now")).toHaveText(
    "Running the rail's glass spec",
  );
  // A finished one too.
  await page.evaluate(() => {
    window.location.hash = "#/pulse?stream=all";
  });
  const done = page.getByTestId("all-activity-task:task-build");
  await expect(done).toBeVisible({ timeout: 20_000 });
  await done.locator(".luca-place-row-open").click();
  await landedOnTask(page, "task-build", "Fix the failing build");
  await expect(page.locator(".luca-app-task-came-back-text")).toHaveText(
    RESULTS["task-build"],
  );
  measure("from_all_activity", { page: await readPage(page) });
  await shot(page, "task-from-all-activity-night");
});

test("the app page's What Luca did with it rows open the task's page", async ({
  page,
}) => {
  await boot(page, { hash: "/apps/claude" });
  const row = page.getByTestId("connected-task-task-build");
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("button").click();
  await landedOnTask(page, "task-build", "Fix the failing build");
  measure("from_app_page", { page: await readPage(page) });
  await shot(page, "task-from-app-page-night");
});

test("Settings › Agents lists the apps under Apps", async ({ page }) => {
  await boot(page, { hash: "/settings?section=agents", tasks: false });
  const section = page.getByTestId("settings-agents-connected");
  await expect(section).toBeVisible({ timeout: 20_000 });
  await expect(section.locator("h2")).toHaveText("Apps");
  await expect(section).toHaveAttribute("aria-label", "Apps");
  measure("apps_label", { label: await section.locator("h2").textContent() });
});

test("New conversation with Luca alone lands in Luca's one chat", async ({
  page,
}) => {
  await boot(page, { hash: `/channels/${GENERAL}`, tasks: false });
  const channels = () =>
    page.evaluate(async () => {
      const list = (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
        "get_channels",
        null,
      )) as Array<{ id: string }>;
      return list.map((channel) => channel.id).sort();
    });
  // Luca's one chat, from the rail.
  await page
    .getByTestId("rail-home-luca")
    .locator('[data-rail-focus="home"]')
    .click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .not.toContain(GENERAL);
  const lucaChat = (await page.evaluate(() => window.location.hash)).match(
    /channels\/([^/?]+)/,
  )?.[1];
  expect(lucaChat).toBeTruthy();
  const before = await channels();

  // ⌘N, Luca alone, a message.
  await page.keyboard.press("ControlOrMeta+n");
  await expect(page.getByTestId("new-message-page")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId("new-dm-search").fill("Luca");
  await page.getByTestId(`new-dm-result-${LUCA}`).click();
  await expect(page.getByTestId(`new-dm-selected-${LUCA}`)).toBeVisible();
  await page.getByTestId("message-input").fill("One more thing for today.");
  await page.getByTestId("send-message").click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash), { timeout: 20_000 })
    .toContain(`/channels/${lucaChat}`);
  const after = await channels();
  measure("new_conversation_luca", {
    after: after.length,
    before: before.length,
    lucaChat,
  });
  expect(after).toEqual(before);
  await expect(page.getByTestId("rail-home-luca")).toHaveAttribute(
    "data-active",
    "true",
  );
});

test("flag off: the same as the base build", async ({ browser }) => {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, hash, ready] of [
    ["chats", `/channels/${GENERAL}`, "chat-list"],
    ["agents", "/agents", "agents-view"],
    ["new-message", "/messages/new", "new-message-page"],
  ] as const) {
    const hashes: string[] = [];
    const colors: number[] = [];
    for (const [index, origin] of ["", BASE_URL, BASE_URL].entries()) {
      const context = await browser.newContext({
        deviceScaleFactor: 2,
        viewport: { width: 1440, height: 900 },
      });
      await context.clock.install({ time: new Date("2026-10-26T18:30:00") });
      const page = await context.newPage();
      await boot(page, { hash, origin, shell: false, tasks: false });
      await expect(page.getByTestId(ready).first()).toBeVisible({
        timeout: 20_000,
      });
      await page.waitForTimeout(1500);
      await railGlassAtRest(page);
      // The residents' eyes over the composer glance on a timer: both
      // builds mask that one small patch (140 × 70), and nothing else.
      await page.evaluate(() => {
        const patch = document.createElement("div");
        patch.setAttribute("data-flagoff-mask", "");
        Object.assign(patch.style, {
          height: "70px",
          left: "570px",
          pointerEvents: "none",
          position: "fixed",
          top: "720px",
          width: "140px",
        });
        document.body.append(patch);
      });
      const shotName = `flagoff-${name}-${["here", "base", "base-again"][index]}`;
      hashes.push(await shot(page, shotName, { still: true }));
      colors.push(await colorsOf(page, shotName));
      await context.close();
    }
    result[name] = {
      base: hashes[1],
      baseAgain: hashes[2],
      colors,
      here: hashes[0],
      same: hashes[0] === hashes[1],
    };
  }
  measure("flag_off", result);
  for (const each of Object.values(result)) {
    expect(each.same).toBe(true);
    for (const count of each.colors as number[])
      expect(count).toBeGreaterThan(8);
  }
});

test.afterAll(() => {
  if (Object.keys(shotHashes).length === 0) return;
  const existing = (() => {
    try {
      return JSON.parse(
        readFileSync(`${SHOTS}/measures/shot_hashes.json`, "utf8"),
      ) as Record<string, string>;
    } catch {
      return {};
    }
  })();
  measure("shot_hashes", { ...existing, ...shotHashes });
});
