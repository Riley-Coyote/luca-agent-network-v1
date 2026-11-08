import { expect, type Page, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";
import { waitForAnimations } from "../helpers/animations";
import {
  createHarnessDashboardFixture,
  HARNESS_FIXTURE_FOLDER,
  HARNESS_FIXTURE_LUCA,
  HARNESS_FIXTURE_NEW_FOLDER,
  HARNESS_FIXTURE_SESSION,
  HARNESS_FIXTURE_SOURCE,
} from "../../src/testing/harnessDashboardFixture";

type RecordedInput = {
  conversationId: string;
  residentPubkey: string;
  runtimeFamily: string;
  operation: string;
  workingFolder: string;
  permissionMode: string;
  sourceId?: string;
  sessionId?: string;
  prompt: string;
};

test.use({
  viewport: { width: 1440, height: 900 },
  trace: "off",
  video: "off",
});

async function boot(page: Page, withSource = true, withFailures = false) {
  const fixture = createHarnessDashboardFixture();
  if (withFailures) {
    fixture.tasks[0] = {
      ...fixture.tasks[0],
      state: "failed",
      currentStep: null,
      error:
        "Native continuation failed. Review this exact session before trying again.",
    };
    fixture.tasks[1] = {
      ...fixture.tasks[1],
      state: "interrupted",
      currentStep: null,
      error:
        "Delivery could not be confirmed. Polyphonic will not resend automatically.",
    };
  }
  await page.addInitScript(
    ({ fixture, key }) => {
      window.__BUZZ_E2E_HARNESS_DASHBOARD__ = fixture;
      const previous = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(
        key,
        JSON.stringify({ ...previous, "shell-frame": true }),
      );
    },
    {
      fixture,
      key: FEATURE_OVERRIDES_STORAGE_KEY,
    },
  );
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: HARNESS_FIXTURE_LUCA,
        name: "Luca",
        personaId: "builtin:fizz",
        status: "running",
        channelNames: ["general"],
      },
    ],
  });
  await page.goto("/#/dashboard");
  await expect(page.getByTestId("home-dashboard")).toBeVisible();
  if (!withSource) return null;
  // Test setup creates the one canonical Luca DM; the workspace never does.
  const conversationId = await page.evaluate(async (pubkey) => {
    const runtime = window as typeof window & {
      __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
        command: string,
        input: unknown,
      ) => Promise<unknown>;
      __BUZZ_E2E_QUERY_CLIENT__?: {
        invalidateQueries: (input: { queryKey: string[] }) => Promise<void>;
      };
    };
    if (!runtime.__BUZZ_E2E_INVOKE_MOCK_COMMAND__)
      throw new Error("Mock native bridge is unavailable.");
    const channel = (await runtime.__BUZZ_E2E_INVOKE_MOCK_COMMAND__("open_dm", {
      pubkeys: [pubkey],
    })) as { id: string };
    await runtime.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries({
      queryKey: ["channels"],
    });
    return channel.id;
  }, HARNESS_FIXTURE_LUCA);
  return conversationId;
}

test("Home exposes failed and interrupted receipts without retrying or claiming an all-clear", async ({
  page,
}) => {
  await boot(page, false, true);
  await expect(
    page.getByRole("heading", { name: "2 tasks need a look.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("You’re caught up.", { exact: true }),
  ).toHaveCount(0);
  const attention = page.getByRole("region", {
    name: "Needs you",
    exact: true,
  });
  await expect(
    attention.getByRole("button", { name: "Review task", exact: true }),
  ).toHaveCount(2);
  const review = attention
    .getByRole("button", { name: "Review task", exact: true })
    .first();
  await review.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("harness-workspace")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Check workspace keyboard access",
      exact: true,
    }),
  ).toBeVisible();
  expect(await startCalls(page)).toHaveLength(0);
  expect(await commandCount(page, "cancel_runtime_task")).toBe(0);
});

test("Home failure attention retains the approved layout across themes and widths", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  for (const width of [1440, 1280, 1024, 390]) {
    for (const deviceScaleFactor of [1, 2]) {
      for (const theme of ["dark", "light"] as const) {
        const context = await browser.newContext({
          viewport: { width, height: width === 390 ? 844 : 900 },
          deviceScaleFactor,
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        try {
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await boot(page, false, true);
          const toggle = page.getByRole("button", {
            name: `Switch to ${theme} appearance`,
            exact: true,
          });
          if (await toggle.count()) await toggle.click();
          await expect(
            page.getByRole("heading", {
              name: "2 tasks need a look.",
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            page
              .getByRole("region", { name: "Needs you" })
              .getByRole("button", { name: "Review task", exact: true }),
          ).toHaveCount(2);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBeTruthy();
          await waitForAnimations(page);
          await page.screenshot({
            path: test
              .info()
              .outputPath(
                `home-attention-${theme}-${width}-${deviceScaleFactor}x.png`,
              ),
          });
          expect(errors).toEqual([]);
          expect(await startCalls(page)).toHaveLength(0);
        } finally {
          await context.close();
        }
      }
    }
  }
});

async function openWorkspace(page: Page, family: "claude" | "codex") {
  const row = page.getByTestId(`rail-home-app:${family}`);
  await expect(row).toBeVisible();
  await row
    .getByRole("button", {
      name: family === "claude" ? /^Claude Code/ : /^Codex/,
    })
    .click();
  await expect(page.getByTestId("harness-workspace")).toBeVisible();
  await expect(
    page
      .getByTestId("harness-workspace")
      .getByRole("button", { name: "New task", exact: true })
      .first(),
  ).toBeEnabled();
}

function sessionRow(page: Page, title: string) {
  return page
    .locator(".hws-catalogue")
    .getByRole("button", { name: new RegExp(title) });
}

async function startCalls(page: Page): Promise<RecordedInput[]> {
  return page.evaluate(() => {
    const runtime = window as typeof window & {
      __BUZZ_E2E_COMMAND_PAYLOADS__?: Array<{
        command: string;
        payload: { input?: RecordedInput };
      }>;
    };
    return (runtime.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [])
      .filter((entry) => entry.command === "start_runtime_task")
      .flatMap((entry) => (entry.payload.input ? [entry.payload.input] : []));
  });
}

async function commandCount(page: Page, command: string) {
  return page.evaluate((wanted) => {
    const runtime = window as typeof window & {
      __BUZZ_E2E_COMMANDS__?: string[];
    };
    return (runtime.__BUZZ_E2E_COMMANDS__ ?? []).filter(
      (entry) => entry === wanted,
    ).length;
  }, command);
}

test("native work remains unavailable without an authorized companion source", async ({
  page,
}) => {
  await boot(page, false);
  await page
    .getByTestId("rail-home-app:claude")
    .getByRole("button", { name: /^Claude Code/ })
    .click();
  const workspace = page.getByTestId("harness-workspace");
  await expect(workspace).toBeVisible();
  await expect(
    workspace.getByRole("button", { name: "New task", exact: true }).first(),
  ).toBeDisabled();
  await expect(workspace.getByTestId("send-message")).toHaveCount(0);
  expect(await startCalls(page)).toHaveLength(0);
  expect(await commandCount(page, "open_dm")).toBe(0);
});

test("temporary visitors do not block Luca's existing home or native workspaces", async ({
  page,
}) => {
  const conversationId = await boot(page);
  const dmCalls = await commandCount(page, "open_dm");
  await page.evaluate((id) => {
    type HomeChannel = {
      id: string;
      participantPubkeys: string[];
      guestPubkeys?: string[];
    };
    const runtime = window as unknown as {
      __BUZZ_E2E_QUERY_CLIENT__: {
        setQueryData: (
          key: string[],
          update: (channels: HomeChannel[]) => HomeChannel[],
        ) => void;
      };
    };
    const visitor = "b".repeat(64);
    runtime.__BUZZ_E2E_QUERY_CLIENT__.setQueryData(["channels"], (channels) =>
      channels.map((channel) =>
        channel.id === id
          ? {
              ...channel,
              participantPubkeys: [...channel.participantPubkeys, visitor],
              guestPubkeys: [visitor],
            }
          : channel,
      ),
    );
  }, conversationId);
  await openWorkspace(page, "claude");
  await expect(
    sessionRow(page, "Review native workspace layout"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page
    .getByRole("button", { name: "Open conversation", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Luca conversation" }),
  ).toBeVisible();
  expect(await commandCount(page, "open_dm")).toBe(dmCalls);
  expect(await startCalls(page)).toHaveLength(0);
});

test("closing and reopening Luca keeps the canonical conversation and draft without stopping work", async ({
  page,
}) => {
  const conversationId = await boot(page);
  const dmCalls = await commandCount(page, "open_dm");
  const stopCalls = await commandCount(page, "cancel_runtime_task");
  await page
    .getByRole("button", { name: "Open conversation", exact: true })
    .click();
  const conversation = page.getByRole("complementary", {
    name: "Luca conversation",
  });
  await expect(conversation).toBeVisible();
  await conversation
    .locator('[contenteditable="true"]')
    .first()
    .fill("Keep this draft in Luca’s existing conversation.");
  await conversation
    .getByRole("button", { name: "Close Luca conversation", exact: true })
    .click();
  await expect(conversation).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open conversation", exact: true })
    .click();
  await expect(
    conversation.locator('[contenteditable="true"]').first(),
  ).toContainText("Keep this draft in Luca’s existing conversation.");
  expect(await commandCount(page, "open_dm")).toBe(dmCalls);
  expect(await commandCount(page, "cancel_runtime_task")).toBe(stopCalls);
  await conversation
    .getByRole("button", { name: "Open full conversation", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain(`/channels/${conversationId}`);
  expect(await commandCount(page, "open_dm")).toBe(dmCalls);
  expect(await commandCount(page, "cancel_runtime_task")).toBe(stopCalls);
});

test("Home is above Chats; direct harness navigation preserves separate drafts", async ({
  page,
}) => {
  await boot(page);
  const home = page.getByTestId("open-home-dashboard");
  const chats = page.getByTestId("shell-place-conversations");
  const homeBounds = await home.boundingBox();
  const chatBounds = await chats.boundingBox();
  expect(homeBounds && chatBounds && homeBounds.y < chatBounds.y).toBeTruthy();
  await chats.click();
  await expect(page.getByTestId("chat-list")).toBeVisible();
  await openWorkspace(page, "claude");
  await expect(
    sessionRow(page, "Review native workspace layout"),
  ).toBeVisible();
  await sessionRow(page, "Review native workspace layout").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".hws-transcript")).toContainText(
    "Review this exact native workspace",
  );
  const editor = page
    .getByTestId("harness-workspace")
    .locator('[contenteditable="true"]')
    .first();
  await editor.fill("Keep this Claude draft while I check another session.");
  await sessionRow(page, "Earlier saved fixture").click();
  await expect(page.locator(".hws-transcript")).toContainText(
    "existing permission policy",
  );
  await sessionRow(page, "Review native workspace layout").click();
  await expect(editor).toContainText("Keep this Claude draft");
  await openWorkspace(page, "codex");
  await sessionRow(page, "Codex native follow-up").click();
  await expect(page.locator(".hws-transcript")).toContainText(
    "native Codex transcript",
  );
  await expect(
    page
      .getByTestId("harness-workspace")
      .locator('[contenteditable="true"]')
      .first(),
  ).not.toContainText("Keep this Claude draft");
  await openWorkspace(page, "claude");
  await sessionRow(page, "Review native workspace layout").click();
  await expect(editor).toContainText("Keep this Claude draft");
  expect(await startCalls(page)).toHaveLength(0);
  await home.click();
  await expect(page.getByTestId("home-dashboard")).toBeVisible();
});

test("saved continuation reviews the exact folder and native permission policy before dispatch", async ({
  page,
}) => {
  const conversationId = await boot(page);
  await openWorkspace(page, "claude");
  await sessionRow(page, "Earlier saved fixture").click();
  await page
    .getByRole("button", { name: "Continue session", exact: true })
    .click();
  const review = page.getByTestId("runtime-task-confirmation");
  await expect(review).toBeVisible();
  await expect(review).toContainText(HARNESS_FIXTURE_FOLDER);
  await expect(review).toContainText("Keep this session's native permissions");
  expect(await startCalls(page)).toHaveLength(0);
  await review.getByTestId("runtime-task-confirm").click();
  await expect.poll(() => startCalls(page)).toHaveLength(1);
  expect((await startCalls(page))[0]).toMatchObject({
    conversationId,
    residentPubkey: HARNESS_FIXTURE_LUCA,
    runtimeFamily: "claude_code",
    operation: "continue_session",
    sourceId: HARNESS_FIXTURE_SOURCE.claude_code,
    sessionId: HARNESS_FIXTURE_SESSION.savedClaude,
    workingFolder: HARNESS_FIXTURE_FOLDER,
    permissionMode: "normal",
  });
  await expect(page.locator(".hws-work-line")).toContainText(
    "Reading the requested fixture task",
  );
});

test("a native follow-up keeps exact references and never reports queue acceptance as completion", async ({
  page,
}) => {
  const conversationId = await boot(page);
  await openWorkspace(page, "codex");
  await sessionRow(page, "Codex native follow-up").click();
  await expect(page.locator(".hws-transcript")).toContainText(
    "native Codex transcript",
  );
  const workspace = page.getByTestId("harness-workspace");
  await workspace
    .locator('[contenteditable="true"]')
    .first()
    .fill("Keep this in the same native session.");
  await workspace.getByTestId("send-message").click();
  await expect.poll(() => startCalls(page)).toHaveLength(1);
  expect((await startCalls(page))[0]).toMatchObject({
    conversationId,
    residentPubkey: HARNESS_FIXTURE_LUCA,
    runtimeFamily: "codex",
    operation: "send_message",
    sourceId: HARNESS_FIXTURE_SOURCE.codex,
    sessionId: HARNESS_FIXTURE_SESSION.liveCodex,
    workingFolder: HARNESS_FIXTURE_FOLDER,
    permissionMode: "normal",
    prompt: "Keep this in the same native session.",
  });
  await expect(page.locator(".hws-work-line")).toContainText(
    "work is not complete",
  );
  await expect(
    workspace.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".hws-transcript .hws-turn")).toHaveCount(2);
  await workspace.getByRole("button", { name: "Usage", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Observed usage" }),
  ).toContainText("Unavailable");
  await expect(workspace).not.toContainText("$2.84");
});

test("new tasks use the actual chosen folder and normal permissions", async ({
  page,
}) => {
  const conversationId = await boot(page);
  await openWorkspace(page, "claude");
  const workspace = page.getByTestId("harness-workspace");
  await workspace
    .getByRole("button", { name: "New task", exact: true })
    .first()
    .click();
  await workspace.locator(".hws-folder-picker").click();
  await expect(workspace.locator(".hws-folder-picker")).toContainText(
    HARNESS_FIXTURE_NEW_FOLDER,
  );
  await workspace
    .locator('[contenteditable="true"]')
    .first()
    .fill("Check the chosen project without publishing anything.");
  await workspace.getByTestId("send-message").click();
  await expect.poll(() => startCalls(page)).toHaveLength(1);
  const input = (await startCalls(page))[0];
  expect(input).toMatchObject({
    conversationId,
    residentPubkey: HARNESS_FIXTURE_LUCA,
    runtimeFamily: "claude_code",
    operation: "new_task",
    workingFolder: HARNESS_FIXTURE_NEW_FOLDER,
    permissionMode: "normal",
  });
  expect(input.sourceId).toBeUndefined();
  expect(input.sessionId).toBeUndefined();
  await expect(page.locator(".hws-detail-head h2")).toContainText(
    "Check the chosen project",
  );
  await workspace
    .getByRole("button", { name: "Connection", exact: true })
    .click();
  await expect(
    workspace.getByRole("heading", { name: "Billing source" }),
  ).toBeVisible();
  await expect(workspace.locator('input[type="password"]')).toHaveCount(0);
});

test("a selected native reply refreshes automatically while hidden and inactive views stay quiet", async ({
  page,
}) => {
  await boot(page);
  await openWorkspace(page, "codex");
  await sessionRow(page, "Codex native follow-up").click();
  await expect(page.locator(".hws-transcript")).toContainText(
    "native Codex transcript",
  );
  const workspace = page.getByTestId("harness-workspace");
  const editor = workspace.locator('[contenteditable="true"]').first();
  await editor.fill("Preserve this draft during native transcript refresh.");
  const initialReads = await commandCount(page, "get_harness_session");
  const initialCatalogueReads = await commandCount(
    page,
    "list_harness_sessions",
  );
  const initialConnectionReads = await commandCount(
    page,
    "list_runtime_connection_status",
  );
  const reply =
    "The native assistant appended this reply without a task event.";
  await page.evaluate(
    ({ sessionId, text }) => {
      const fixture = window.__BUZZ_E2E_HARNESS_DASHBOARD__;
      if (!fixture?.transcripts[sessionId])
        throw new Error("Selected native fixture is missing.");
      fixture.transcripts[sessionId].messages.push({ role: "assistant", text });
    },
    { sessionId: HARNESS_FIXTURE_SESSION.liveCodex, text: reply },
  );
  await expect(page.locator(".hws-transcript")).toContainText(reply, {
    timeout: 10_000,
  });
  expect(await commandCount(page, "get_harness_session")).toBeGreaterThan(
    initialReads,
  );
  expect(await commandCount(page, "list_harness_sessions")).toBe(
    initialCatalogueReads,
  );
  expect(await commandCount(page, "list_runtime_connection_status")).toBe(
    initialConnectionReads,
  );
  await expect(editor).toContainText("Preserve this draft");

  await workspace.getByRole("button", { name: "Usage", exact: true }).click();
  const inactiveReads = await commandCount(page, "get_harness_session");
  // A negative assertion must cover a whole native refresh period.
  await page.waitForTimeout(4_300);
  expect(await commandCount(page, "get_harness_session")).toBe(inactiveReads);
  await workspace
    .getByRole("button", { name: "Sessions", exact: true })
    .click();
  await expect
    .poll(() => commandCount(page, "get_harness_session"))
    .toBeGreaterThan(inactiveReads);
  await expect(editor).toContainText("Preserve this draft");

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenReads = await commandCount(page, "get_harness_session");
  await page.waitForTimeout(4_300);
  expect(await commandCount(page, "get_harness_session")).toBe(hiddenReads);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    Reflect.deleteProperty(document, "visibilityState");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() => commandCount(page, "get_harness_session"))
    .toBeGreaterThan(hiddenReads);
  await expect(editor).toContainText("Preserve this draft");
});

test("Home ignores restored work context from another owner or relay scope", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    window.location.hash = `/dashboard?title=Wrong-scope-work&runtime=claude_code&scope=${"0".repeat(64)}`;
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await expect(page.getByTestId("home-dashboard")).toBeVisible();
  await expect(page.locator(".pf-home-context-chip")).toHaveCount(0);
  expect(await startCalls(page)).toHaveLength(0);
});
