import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";

import { installMockBridge } from "../helpers/bridge";

async function seedLongThread(page: import("@playwright/test").Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__ === "function",
      ),
    )
    .toBe(true);
  return page.evaluate(() => {
    const root = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "general",
      content: "Focus mode integration thread",
      createdAt: 1_700_900_000,
    });
    if (!root) throw new Error("Failed to seed focus thread root");

    for (let index = 0; index < 48; index += 1) {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: `Focus reply ${index}: this deliberately wraps across several lines so changing the thread measure causes real layout reflow.`,
        parentEventId: root.id,
        createdAt: 1_700_900_001 + index,
      });
    }
    return root.id;
  });
}

// Luca uses one focused main timeline; the split drawer was retired in
// docs/luca/project-navigation/RUN_LOG.md. Visibility alone missed the actual
// exit being painted beneath the channel header, so guard bounds and hit tests.
async function expectUsableThreadBar(page: import("@playwright/test").Page) {
  const bar = page.getByTestId("focused-thread-bar");
  await expect(bar).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const bar = document.querySelector(
          '[data-testid="focused-thread-bar"]',
        );
        const header = document.querySelector('[data-testid="chat-header"]');
        const exit = document.querySelector('[aria-label="Show all messages"]');
        if (!bar || !header || !exit) return false;
        const b = bar.getBoundingClientRect(),
          h = header.getBoundingClientRect(),
          e = exit.getBoundingClientRect();
        const hit = document.elementFromPoint(
          e.x + e.width / 2,
          e.y + e.height / 2,
        );
        return (
          b.top >= h.bottom - 1 &&
          b.left >= 0 &&
          b.right <= innerWidth &&
          b.bottom <= innerHeight &&
          e.top >= b.top &&
          e.bottom <= b.bottom &&
          Boolean(hit && exit.contains(hit))
        );
      }),
    )
    .toBe(true);
  await expect(page.getByTestId("message-input")).toHaveCount(1);
  await expect(page.getByTestId("channel-drop-zone")).not.toHaveAttribute(
    "inert",
    "",
  );
  await expect(page.getByTestId("message-thread-panel")).toHaveCount(0);
  await expect(page.getByTestId("thread-view-mode-toggle")).toHaveCount(0);
}

test("focused threads preserve reading context and interaction ownership", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey:
          "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f",
        name: "alice",
        status: "stopped",
      },
    ],
  });
  await page.goto("/");
  const rootId = await seedLongThread(page);
  await page.getByTestId("channel-general").click();
  const summary = page.locator(
    `[data-testid="message-thread-summary"][data-thread-head-id="${rootId}"]`,
  );
  await summary.click();
  await expectUsableThreadBar(page);
  await expect(page).toHaveURL(new RegExp(`thread=${rootId}`));
  const timeline = page.getByTestId("message-timeline");
  await timeline.evaluate((el) => {
    el.scrollTop = el.scrollHeight * 0.4;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const anchor = await timeline.evaluate((el) => {
    const top =
      document
        .querySelector('[data-testid="focused-thread-bar"]')
        ?.getBoundingClientRect().bottom ?? el.getBoundingClientRect().top;
    return [...el.querySelectorAll<HTMLElement>("[data-message-id]")].find(
      (row) => row.getBoundingClientRect().top > top,
    )?.dataset.messageId;
  });
  expect(anchor).toBeTruthy();
  await page.setViewportSize({ width: 1100, height: 800 });
  await expectUsableThreadBar(page);
  await expect(
    timeline.locator(`[data-message-id="${anchor}"]`),
  ).toBeInViewport();
  await expect(page).toHaveURL(new RegExp(`thread=${rootId}`));
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("focused-thread-reading.png"),
  });
  // The actual exit must accept pointer input, without forced clicks.
  await page.getByRole("button", { name: "Show all messages" }).click();
  await expect(page.getByTestId("focused-thread-bar")).toHaveCount(0);
  await expect(page).not.toHaveURL(/thread=/);
  await summary.click();
  await expectUsableThreadBar(page);
  const input = page.getByTestId("message-input");
  await input.click();
  await input.pressSequentially("@al");
  await expect(page.getByTestId("mention-autocomplete")).toBeVisible();
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("focused-thread-bar")).toHaveCount(0);
  await expect(page).not.toHaveURL(/thread=/);
});

test("compact focused threads keep the exit usable at 150 percent", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installMockBridge(page);
  await page.goto("/");
  const rootId = await seedLongThread(page);
  await page.getByTestId("channel-general").click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "24px";
  });
  const summary = page.locator(
    `[data-testid="message-thread-summary"][data-thread-head-id="${rootId}"]`,
  );
  await summary.click();
  await expectUsableThreadBar(page);
  await expect(page).toHaveURL(new RegExp(`thread=${rootId}`));
  const exit = page.getByRole("button", { name: "Show all messages" });
  await exit.focus();
  await expect(exit).toBeFocused();
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("focused-thread-compact-zoom150.png"),
  });
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("focused-thread-bar")).toHaveCount(0);
  await expect(page).not.toHaveURL(/thread=/);
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await expect(page.getByTestId("message-input")).toHaveCount(1);
});
