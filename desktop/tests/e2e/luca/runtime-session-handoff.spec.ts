import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

test("an indexed runtime session becomes visible staged New Message context", async ({
  page,
}, testInfo) => {
  await installMockBridge(page);
  await page.goto("/?e2e=mock");

  await page.getByTestId("runtime-rail-codex").click();
  const panel = page.getByTestId("runtime-sessions-panel");
  const session = panel.getByTestId("runtime-session-session-codex-checkpoint");
  await expect(session).toContainText(
    "Shape the runtime-session context checkpoint",
  );
  await session
    .getByRole("button", { name: /Start with this context/ })
    .click();

  await expect(page.getByTestId("new-message-page")).toBeVisible();
  const stagedContext = page.getByTestId("new-message-runtime-context");
  await expect(stagedContext).toContainText("Starting with Codex context");
  await expect(stagedContext).toContainText(
    "Shape the runtime-session context checkpoint",
  );
  await expect(stagedContext).toContainText(
    "Make installed runtimes visible in the left rail.",
  );
  await waitForAnimations(page);
  await page.screenshot({ path: testInfo.outputPath("session-handoff.png") });
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (command: string, payload: unknown) => Promise<unknown>;
      };
      attachmentCalls: Array<{ command: string; payload: unknown }>;
    };
    w.attachmentCalls = [];
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (command, payload) => {
      if (
        command === "attach_connected_runtime_session" ||
        command === "send_channel_message"
      ) {
        w.attachmentCalls.push({ command, payload });
      }
      return invoke(command, payload);
    };
  });
  await page.getByTestId("new-dm-search").fill("charlie");
  await page
    .getByTestId(`new-dm-result-${TEST_IDENTITIES.charlie.pubkey}`)
    .click();
  await page
    .getByTestId("message-composer")
    .locator('[contenteditable="true"]')
    .fill("Continue from the attached session.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByTestId("new-message-page")).toHaveCount(0);
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          attachmentCalls: Array<{
            command: string;
            payload: Record<string, unknown>;
          }>;
        }
      ).attachmentCalls,
  );
  expect(calls.map((call) => call.command)).toEqual([
    "attach_connected_runtime_session",
    "send_channel_message",
  ]);
  expect(calls[0].payload.input).toEqual({
    runtimeId: "codex",
    sessionId: "session-codex-checkpoint",
  });
  expect(JSON.stringify(calls[1])).not.toContain("transcript_path");
});

test("switching runtimes cancels a stale context handoff", async ({ page }) => {
  await installMockBridge(page, { runtimeSessionContextDelayMs: 350 });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await expect(page.getByTestId("new-message-page")).toHaveCount(0);

  await page.getByTestId("runtime-rail-codex").click();
  await expect(page.getByTestId("new-message-page")).toBeVisible();
  const codexSession = page
    .getByTestId("runtime-sessions-panel")
    .getByTestId("runtime-session-session-codex-checkpoint");
  await codexSession
    .getByRole("button", { name: /Start with this context/ })
    .click();
  await page.getByTestId("runtime-rail-claude_code").click();

  const panel = page.getByTestId("runtime-sessions-panel");
  await expect(panel).toContainText("Claude Code sessions");
  await expect(
    panel.getByTestId("runtime-session-session-claude_code-checkpoint"),
  ).toBeVisible();
  await page.waitForTimeout(450);
  await expect(page.getByTestId("new-message-page")).toBeVisible();
  await expect(page.getByTestId("new-message-runtime-context")).toHaveCount(0);
  await expect(panel).toContainText("Claude Code sessions");
  await expect(page.getByTestId("chat-title")).toHaveCount(0);
});
