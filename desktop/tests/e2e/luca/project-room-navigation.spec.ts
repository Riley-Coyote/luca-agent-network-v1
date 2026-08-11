import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("projects open their room navigator and remember the selected room", async ({
  page,
}) => {
  await page.goto("/?e2e=mock&projectDemo=1");

  await page.getByTestId("project-row-luca").click();
  const navigator = page.getByTestId("project-room-navigator");
  await expect(navigator).toBeVisible();
  await expect(page.getByTestId("chat-title")).toBeVisible();

  await navigator.getByRole("button", { name: /engineering/i }).click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");

  await page.getByTestId("channel-alice-tyler").click();
  await expect(navigator).toHaveCount(0);
  await expect(page.getByTestId("chat-title")).toHaveText("alice-tyler");

  await page.getByTestId("project-row-luca").click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  await expect(navigator).toBeVisible();
});

test("project search and empty-project navigation stay purposeful", async ({
  page,
}) => {
  await page.goto("/?e2e=mock&projectDemo=1");

  await page.getByTestId("project-row-luca").click();
  const navigator = page.getByTestId("project-room-navigator");
  const search = navigator.getByRole("searchbox");
  await search.fill("not-a-room");
  await expect(navigator).toContainText("No rooms match");
  await search.fill("");
  await expect(navigator).toContainText("engineering");

  await page.getByTestId("project-row-field-unit").click();
  await expect(page).toHaveURL(/#\/projects\/field-unit$/);
  await expect(
    page.getByRole("heading", { name: /has no conversations yet/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create first room" }),
  ).toBeVisible();
});

test("mobile projects move from their room list into the conversation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?e2e=mock&projectDemo=1");

  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByTestId("project-row-luca").click();
  const mobileBack = page.locator(".luca-project-mobile-back");
  await expect(mobileBack).toBeVisible();
  await mobileBack.click();

  const navigator = page.getByTestId("project-room-navigator");
  await expect(navigator).toBeVisible();
  await navigator.getByRole("button", { name: /engineering/i }).click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  await expect(mobileBack).toBeVisible();
});

test("a new project creates its first real room with chosen connected context", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("create-room-project").click();
  const dialog = page.getByTestId("create-room-project-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("create-project-name").fill("Launch Work");
  await dialog.getByTestId("create-project-room-name").fill("planning");
  await expect(dialog.getByText("luca-agent-network")).toBeVisible();
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByTestId("project-row-launch-work")).toBeVisible();
  await expect(page.getByTestId("chat-title")).toHaveText("planning");
  const navigator = page.getByTestId("project-room-navigator");
  await expect(navigator).toBeVisible();
  await expect(navigator).toContainText("2 connected sources");

  await navigator.getByRole("button", { name: "New room" }).click();
  const roomDialog = page.getByTestId("create-channel-dialog");
  await expect(roomDialog).toContainText("Create a new room");
  await roomDialog.getByTestId("create-channel-name").fill("shipping");
  await roomDialog.getByTestId("create-channel-submit").click();
  await expect(page.getByTestId("chat-title")).toHaveText("shipping");
  await expect(navigator.getByText("shipping", { exact: true })).toBeVisible();
});
