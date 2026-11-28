import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";

async function openApp(page: Page) {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
}

function streamNames(page: Page) {
  return page
    .getByTestId("stream-list")
    .locator("[data-testid^='channel-']")
    .evaluateAll((nodes) =>
      nodes
        .map((n) => n.getAttribute("data-testid") ?? "")
        .filter(
          (id) =>
            !id.startsWith("channel-unread") &&
            !id.startsWith("channel-working") &&
            !id.startsWith("channel-dm-count"),
        )
        .map((id) => id.replace(/^channel-/, "")),
    );
}

test.describe("per-group channel sort", () => {
  test("01 — Channels group defaults to A–Z", async ({ page }) => {
    await installMockBridge(page);
    await openApp(page);

    const names = await streamNames(page);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});
