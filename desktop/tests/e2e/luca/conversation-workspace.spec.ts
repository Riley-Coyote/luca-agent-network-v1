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

test("Dock focuses an existing main-window conversation", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "isTauri", {
      configurable: true,
      value: true,
    });
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();

  const ids = await visibleChannelIds(page);
  const generalId = await page
    .getByTestId("channel-general")
    .getAttribute("data-channel-id");
  if (!generalId) throw new Error("Expected the general channel id.");
  const secondId = ids.find((channelId) => channelId !== generalId);
  if (!secondId) throw new Error("Expected a second mock conversation.");
  await expect(page.getByTestId("conversation-workspace")).toBeVisible();
  await expect(page.getByTestId("workspace-pane-slot-1")).toBeVisible();

  await openInNewPane(page, secondId);
  await expect(page.getByTestId("workspace-pane-slot-2")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/channels/${secondId}$`));
  await expect(page.getByTestId("workspace-pane-slot-2")).toHaveAttribute(
    "data-focused",
    "true",
  );

  await expect
    .poll(async () => {
      await page.evaluate((channelId) => {
        window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://popout-open-in-main", {
          channelId,
        });
      }, generalId);
      return page.url();
    })
    .toMatch(new RegExp(`#/channels/${generalId}$`));
  await expect(page.getByTestId("workspace-pane-slot-1")).toHaveAttribute(
    "data-focused",
    "true",
  );
});

test("conversation cards keep a floor gap and expose draggable split handles", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();

  const ids = await visibleChannelIds(page);
  const generalId = await page
    .getByTestId("channel-general")
    .getAttribute("data-channel-id");
  const secondId = ids.find((channelId) => channelId !== generalId);
  if (!secondId) throw new Error("Expected a second mock conversation.");
  await openInNewPane(page, secondId);

  await expect(page.locator("[data-workspace-tab]")).toHaveCount(0);
  await expect(page.locator(".luca-chat-header__presence-wide")).toHaveCount(0);
  await expect(page.getByTestId("chat-subtitle")).toHaveCount(0);
  await expect(page.getByTestId("conversation-intro")).toHaveCount(0);
  const focusedPane = page.locator('[data-focused="true"]');
  await focusedPane.getByTestId("workspace-layout-menu").click();
  await expect(page.getByTestId("workspace-preset-single")).toBeVisible();
  await expect(page.getByTestId("workspace-preset-grid-4")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("workspace-preset-grid-4")).toBeHidden();
  const handle = page.getByTestId("workspace-resize-vertical");
  await expect(handle).toBeVisible();
  const before = await page.getByTestId("workspace-pane-slot-1").boundingBox();
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  const after = await page.getByTestId("workspace-pane-slot-1").boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(after?.width ?? 0).toBeGreaterThan(before?.width ?? 0);
});

test("a project room picker changes only its own tile", async ({ page }) => {
  await page.goto("/?e2e=mock&projectDemo=1");
  await page.getByTestId("project-row-luca").click();

  const navigator = page.getByTestId("project-room-navigator");
  const engineeringRow = navigator.getByRole("button", {
    name: /engineering/i,
  });
  const engineeringTestId = await engineeringRow.getAttribute("data-testid");
  const engineeringId = engineeringTestId?.replace("project-room-", "");
  const generalTestId = await navigator
    .getByRole("button", { name: /general/i })
    .getAttribute("data-testid");
  const generalId = generalTestId?.replace("project-room-", "");
  if (!engineeringId) throw new Error("Expected the engineering room id.");
  if (!generalId) throw new Error("Expected the general room id.");
  const initialRoom = await page.getByTestId("chat-title").innerText();

  await openInNewPane(page, engineeringId);
  const firstPane = page.getByTestId("workspace-pane-slot-1");
  const secondPane = page.getByTestId("workspace-pane-slot-2");
  await expect(firstPane.getByTestId("chat-title")).toHaveText(initialRoom);
  await expect(secondPane.getByTestId("chat-title")).toHaveText("engineering");

  await firstPane.getByTestId("project-room-picker-trigger").click();
  await page
    .getByTestId("project-room-picker")
    .getByRole("option", { name: /general/i })
    .click();

  await expect(firstPane.getByTestId("chat-title")).toHaveText("general");
  await expect(secondPane.getByTestId("chat-title")).toHaveText("engineering");
  await expect(page).toHaveURL(new RegExp(`#/channels/${generalId}$`));
});
