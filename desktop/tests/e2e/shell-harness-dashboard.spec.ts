import { expect, type Page, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";
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

async function boot(page: Page, withSource = true) {
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
      fixture: createHarnessDashboardFixture(),
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
