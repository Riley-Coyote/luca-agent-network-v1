import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

test("an indexed runtime session becomes visible staged New Message context", async ({
  page,
}) => {
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
