import { expect, test, type Page } from "@playwright/test";

import type {
  RuntimeTaskProjection,
  RuntimeTaskProposal,
} from "../../../src/shared/api/tauriRuntimeTasks";
import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

// A resident DM: no project, so nothing resolves a working folder for it.
// That is the surface where the raised card lives, and where it was inert.
const DM = "alice-tyler";
const DM_ID = "f48efb06-0c93-5025-aac9-2e646bb6bfa8";
const ROOM = "general";
const LUCA = TEST_IDENTITIES.alice.pubkey;
const PICKED_FOLDER = "/synthetic/projects/picked";
const PRIOR_FOLDER = "/synthetic/projects/last-used";

type Call = { command: string; payload: unknown };
type HostState = {
  calls: Call[];
  proposals: Record<string, RuntimeTaskProposal>;
  tasks: RuntimeTaskProjection[];
  pickedFolder: string | null;
  runtimeStatusFails: boolean;
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
async function installHost(
  page: Page,
  options: {
    tasks?: RuntimeTaskProjection[];
    pickedFolder?: string | null;
    runtimeStatusFails?: boolean;
  },
) {
  await page.addInitScript((options) => {
    const state: HostState = {
      calls: [],
      proposals: {},
      tasks: options.tasks ?? [],
      pickedFolder: options.pickedFolder ?? null,
      runtimeStatusFails: options.runtimeStatusFails ?? false,
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
          if (command === "list_runtime_task_proposals")
            return Object.values(state.proposals);
          if (command === "list_runtime_tasks") return state.tasks;
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

async function open(
  page: Page,
  options: {
    tasks?: RuntimeTaskProjection[];
    pickedFolder?: string | null;
    runtimeStatusFails?: boolean;
  } = {},
) {
  await installHost(page, options);
  await page.goto(`/?e2e=mock#/channels/${DM_ID}`);
  await expect(page.getByTestId("message-input")).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForFunction(() =>
    window.__RUNTIME_TASK_CARD_TEST__?.calls.some(
      (call) => call.command === "list_runtime_task_proposals",
    ),
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
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/runtime-task-card.png" });
});
