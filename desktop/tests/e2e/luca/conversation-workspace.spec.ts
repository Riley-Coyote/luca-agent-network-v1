import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

async function visibleChannelIds(page: Page): Promise<string[]> {
  return page
    .locator("[data-channel-id]")
    .evaluateAll((elements) => [
      ...new Set(
        elements
          .map((element) => element.getAttribute("data-channel-id"))
          .filter((value): value is string => Boolean(value)),
      ),
    ]);
}

async function openInNewPane(page: Page, channelId: string) {
  await page.evaluate((requestedChannelId) => {
    window.dispatchEvent(
      new CustomEvent("luca:open-conversation-in-pane", {
        detail: { channelId: requestedChannelId },
      }),
    );
  }, channelId);
}

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("conversation panes focus, hide, restore, and persist without storing content", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();

  const ids = await visibleChannelIds(page);
  const generalId = await page
    .getByTestId("channel-general")
    .getAttribute("data-channel-id");
  if (!generalId) throw new Error("Expected the general channel id.");
  const secondId = ids.find((channelId) => channelId !== generalId);
  if (!secondId) throw new Error("Expected a second mock conversation.");

  const workspace = page.getByTestId("conversation-workspace");
  await expect(workspace).toBeVisible();
  await expect(page.getByTestId("workspace-pane-slot-1")).toBeVisible();

  await openInNewPane(page, secondId);
  await expect(page.getByTestId("workspace-pane-slot-2")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/channels/${secondId}`));

  await page
    .getByTestId("workspace-pane-slot-1")
    .locator('[data-testid="chat-header"]')
    .click();
  await expect(page).toHaveURL(new RegExp(`#/channels/${generalId}`));

  await page.getByTestId("open-brain-setup").click();
  await expect(page.getByTestId("brain-view")).toBeVisible();
  await expect(workspace).toHaveCount(0);
  await page.goBack();
  await expect(page.getByTestId("workspace-pane-slot-1")).toBeVisible();
  await expect(page.getByTestId("workspace-pane-slot-2")).toBeVisible();

  const persisted = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((candidate) =>
      candidate.startsWith("luca.conversation-workspace.v1:"),
    );
    return key ? window.localStorage.getItem(key) : null;
  });
  expect(persisted).toContain(generalId);
  expect(persisted).toContain(secondId);
  expect(persisted).not.toContain("message");
  expect(persisted).not.toContain("prompt");

  await page.reload();
  await expect(page.getByTestId("workspace-pane-slot-1")).toBeVisible();
  await expect(page.getByTestId("workspace-pane-slot-2")).toBeVisible();
});

test("compact windows show only the focused pane while retaining the layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();

  const ids = await visibleChannelIds(page);
  const generalId = await page
    .getByTestId("channel-general")
    .getAttribute("data-channel-id");
  const secondId = ids.find((channelId) => channelId !== generalId);
  if (!secondId) throw new Error("Expected a second mock conversation.");
  await openInNewPane(page, secondId);
  await expect(page.locator('[data-testid^="workspace-pane-"]')).toHaveCount(2);

  await page.setViewportSize({ width: 720, height: 760 });
  const workspace = page.getByTestId("conversation-workspace");
  await expect(workspace).toHaveAttribute("data-compact", "true");
  await expect(page.locator('[data-testid^="workspace-pane-"]')).toHaveCount(1);

  await page.setViewportSize({ width: 1280, height: 820 });
  await expect(page.locator('[data-testid^="workspace-pane-"]')).toHaveCount(2);
});
