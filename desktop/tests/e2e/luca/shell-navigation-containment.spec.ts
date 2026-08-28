import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

test("runtime sessions replace stale project and tool surfaces", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/?e2e=mock&projectDemo=1#/brain");
  await expect(page.getByTestId("brain-view")).toBeVisible();

  await page.getByTestId("runtime-rail-codex").click();
  await expect(page.getByTestId("new-message-page")).toBeVisible();
  await expect(page.getByTestId("runtime-sessions-panel")).toBeVisible();
  await expect(page.getByTestId("brain-view")).toHaveCount(0);

  await page.getByTestId("project-row-luca").click();
  await expect(page.getByTestId("project-room-navigator")).toBeVisible();
  await expect(page.getByTestId("runtime-sessions-panel")).toHaveCount(0);

  await page.getByTestId("runtime-rail-codex").click();
  await expect(page.getByTestId("new-message-page")).toBeVisible();
  await expect(page.getByTestId("runtime-sessions-panel")).toBeVisible();
  await expect(page.getByTestId("project-room-navigator")).toHaveCount(0);

  await page.getByTestId("channel-all-replies").click();
  await expect(page.getByTestId("chat-title")).toHaveText("all-replies");
  await expect(page.getByTestId("runtime-sessions-panel")).toHaveCount(0);
});

test("auxiliary presentation follows the stable shell without oscillating", async ({
  page,
}) => {
  await installMockBridge(page, { conversationContextFixture: "multiple" });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();
  await page.getByRole("button", { name: "Open conversation details" }).click();
  await expect(page.getByTestId("conversation-context-panel")).toBeVisible();

  const wideSamples = await page.evaluate(async () => {
    const widths: number[] = [];
    const cardCounts: number[] = [];
    for (let index = 0; index < 18; index += 1) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const conversation = document.querySelector<HTMLElement>(
        '[data-testid="channel-drop-zone"]',
      );
      const rightCards = document.querySelector<HTMLElement>(
        "[data-luca-right-cards]",
      );
      widths.push(conversation?.getBoundingClientRect().width ?? 0);
      cardCounts.push(rightCards?.childElementCount ?? 0);
    }
    return { cardCounts, widths };
  });

  expect(new Set(wideSamples.cardCounts)).toEqual(new Set([1]));
  expect(
    Math.max(...wideSamples.widths) - Math.min(...wideSamples.widths),
  ).toBeLessThan(2);

  await page.setViewportSize({ width: 560, height: 800 });
  await expect(page.getByTestId("conversation-context-panel")).toBeVisible();
  await expect(page.locator("[data-luca-right-cards] > *")).toHaveCount(0);

  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(page.locator("[data-luca-right-cards] > *")).toHaveCount(1);
});

test("file-drop veil retires across route changes", async ({ page }) => {
  await installMockBridge(page);
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();

  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["draft"], "draft.txt", { type: "text/plain" }),
    );
    return transfer;
  });
  const dropZone = page.getByTestId("channel-drop-zone");
  await dropZone.dispatchEvent("dragenter", { dataTransfer });
  await expect(dropZone.getByText("Drop files to upload")).toBeVisible();

  await page.getByTestId("open-brain-setup").click();
  await expect(page.getByTestId("brain-view")).toBeVisible();
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await expect(dropZone.getByText("Drop files to upload")).toHaveCount(0);
});
